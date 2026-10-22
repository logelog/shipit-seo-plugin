import { compareStoredValue, supportsConditionalStorage } from "./conditional-storage.ts";
import type { PluginContext } from "emdash";

const OPERATION_LEASE_STORAGE_VERSION = 1 as const;
const DEFAULT_LEASE_TTL_MS = 120_000;
const DEFAULT_ACQUIRE_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_MS = 20;
const MAX_VISIBLE_CONTENDERS = 100;
const MAX_GLOBAL_STALE_SWEEP = 25;
const LEASE_RENEWAL_GUARD_MS = 20_000;
const LEASE_RECLAIM_GRACE_MS = 60_000;

interface StoredOperationLease {
	id: string;
	ownerToken: string;
	storageVersion: typeof OPERATION_LEASE_STORAGE_VERSION;
	scope: string;
	ticket: number;
	choosing: boolean;
	createdAt: string;
	expiresAt: string;
	reclaimAfter: string;
}

export interface OperationLeaseOwner {
	ownerToken: string;
	durable: boolean;
	signal: AbortSignal;
	renew(): Promise<boolean>;
}

export type OperationLeaseResult<T> =
	| { acquired: true; value: T }
	| { acquired: false; reason: "busy" | "saturated" | "unavailable" }
	| { acquired: false; reason: "lost"; value?: T };

const localOperationTails = new Map<string, Promise<void>>();

function operationLeaseStore(ctx: PluginContext): any | null {
	const store = (ctx.storage as any)?.operationLeases;
	return store &&
			typeof store.get === "function" &&
			supportsConditionalStorage(store) &&
			typeof store.query === "function"
		? store
		: null;
}

function validStoredLease(id: string, value: unknown): StoredOperationLease | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const candidate = value as Partial<StoredOperationLease>;
	if (
		candidate.id !== id ||
		candidate.ownerToken !== id ||
		candidate.storageVersion !== OPERATION_LEASE_STORAGE_VERSION ||
		typeof candidate.scope !== "string" ||
		!Number.isInteger(candidate.ticket) ||
		(candidate.ticket ?? -1) < 0 ||
		typeof candidate.choosing !== "boolean" ||
		typeof candidate.createdAt !== "string" ||
		typeof candidate.expiresAt !== "string" ||
		typeof candidate.reclaimAfter !== "string"
	)
		return null;
	return candidate as StoredOperationLease;
}

function leaseNonce(): string {
	const bytes = globalThis.crypto.getRandomValues(new Uint8Array(12));
	return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withLocalOperationLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
	const previous = localOperationTails.get(key) ?? Promise.resolve();
	let release!: () => void;
	const current = new Promise<void>((resolve) => {
		release = resolve;
	});
	localOperationTails.set(key, current);
	await previous;
	try {
		return await operation();
	} finally {
		release();
		if (localOperationTails.get(key) === current) localOperationTails.delete(key);
	}
}

async function deleteOwnedLease(store: any, lease: StoredOperationLease): Promise<void> {
	await deleteMatchingLeaseSnapshot(store, lease);
}

function storedLeaseEquals(left: StoredOperationLease, right: StoredOperationLease): boolean {
	return (
		left.id === right.id &&
		left.ownerToken === right.ownerToken &&
		left.storageVersion === right.storageVersion &&
		left.scope === right.scope &&
		left.ticket === right.ticket &&
		left.choosing === right.choosing &&
		left.createdAt === right.createdAt &&
		left.expiresAt === right.expiresAt &&
		left.reclaimAfter === right.reclaimAfter
	);
}

async function deleteMatchingLeaseSnapshot(
	store: any,
	lease: StoredOperationLease,
): Promise<StoredOperationLease | null> {
	const deleted = await compareStoredValue(
		store,
		lease.id,
		{ state: "value", value: lease },
		{ action: "delete" },
	);
	if (deleted) return null;
	const current = validStoredLease(lease.id, await store.get(lease.id));
	if (!current) return null;
	if (!storedLeaseEquals(current, lease)) return current;
	throw new Error("Operation lease cleanup made no progress");
}

async function putLeaseVerified(
	store: any,
	lease: StoredOperationLease,
	expected: { state: "missing" } | { state: "value"; value: StoredOperationLease },
): Promise<void> {
	try {
		const committed = await compareStoredValue(
			store,
			lease.id,
			expected,
			{ action: "put", value: lease },
		);
		if (!committed) throw new Error("Operation lease snapshot changed");
	} catch (error: unknown) {
		const current = validStoredLease(lease.id, await store.get(lease.id));
		if (current && storedLeaseEquals(current, lease)) return;
		throw error;
	}
}

async function visibleContenders(
	store: any,
	scope: string,
	now: number,
	onCleanupError: (error: unknown) => void,
): Promise<{ leases: StoredOperationLease[]; saturated: boolean }> {
	const result = await store.query({
		where: { scope },
		limit: MAX_VISIBLE_CONTENDERS,
	});
	const leases: StoredOperationLease[] = [];
	for (const item of result.items ?? []) {
		const id = String(item.id ?? "");
		const lease = validStoredLease(id, item.data ?? item);
		if (!lease) continue;
		const reclaimAfter = Date.parse(lease.reclaimAfter);
		if (!Number.isFinite(reclaimAfter) || reclaimAfter <= now) {
			try {
				const changed = await deleteMatchingLeaseSnapshot(store, lease);
				if (changed) leases.push(changed);
			} catch (error: unknown) {
				// An unverifiable cleanup remains a contender. Acquisition cannot pass
				// while a renewed owner may still hold this scope.
				leases.push(lease);
				onCleanupError(error);
			}
			continue;
		}
		leases.push(lease);
	}
	return { leases, saturated: result.hasMore === true };
}

async function sweepStaleLeases(
	store: any,
	now: number,
	onCleanupError: (error: unknown) => void,
): Promise<void> {
	let result: any;
	try {
		result = await store.query({
			orderBy: { expiresAt: "asc" },
			limit: MAX_GLOBAL_STALE_SWEEP,
		});
	} catch (error: unknown) {
		onCleanupError(error);
		return;
	}
	for (const item of result.items ?? []) {
		const id = String(item.id ?? "");
		const lease = validStoredLease(id, item.data ?? item);
		if (!lease) continue;
		const reclaimAfter = Date.parse(lease.reclaimAfter);
		if (Number.isFinite(reclaimAfter) && reclaimAfter > now) continue;
		try {
			await deleteMatchingLeaseSnapshot(store, lease);
		} catch (error: unknown) {
			onCleanupError(error);
		}
	}
}

async function acquireDurableLease(
	store: any,
	scope: string,
	options: { ttlMs: number; acquireTimeoutMs: number; pollMs: number },
	onCleanupError: (error: unknown) => void,
): Promise<{ lease: StoredOperationLease } | { reason: "busy" | "saturated" }> {
	const startedAt = Date.now();
	const ownerToken = `lease:${leaseNonce()}`;
	let lease: StoredOperationLease = {
		id: ownerToken,
		ownerToken,
		storageVersion: OPERATION_LEASE_STORAGE_VERSION,
		scope,
		ticket: 0,
		choosing: true,
		createdAt: new Date(startedAt).toISOString(),
		expiresAt: new Date(startedAt + options.ttlMs).toISOString(),
		reclaimAfter: new Date(startedAt + options.ttlMs + LEASE_RECLAIM_GRACE_MS).toISOString(),
	};
	let ownsCriticalSection = false;

	try {
		// Every acquisition performs a small indexed sweep so crash records from
		// one-off entry scopes do not require that exact scope to be used again.
		await sweepStaleLeases(store, Date.now(), onCleanupError);
		await putLeaseVerified(store, lease, { state: "missing" });
		const initial = await visibleContenders(store, scope, Date.now(), onCleanupError);
		if (initial.saturated) return { reason: "saturated" };
		const choosingLease = lease;
		lease = {
			...lease,
			ticket: Math.max(0, ...initial.leases.map((candidate) => candidate.ticket)) + 1,
			choosing: false,
			expiresAt: new Date(Date.now() + options.ttlMs).toISOString(),
			reclaimAfter: new Date(Date.now() + options.ttlMs + LEASE_RECLAIM_GRACE_MS).toISOString(),
		};
		await putLeaseVerified(store, lease, {
			state: "value",
			value: choosingLease,
		});

		while (Date.now() - startedAt <= options.acquireTimeoutMs) {
			const visible = await visibleContenders(store, scope, Date.now(), onCleanupError);
			if (visible.saturated) return { reason: "saturated" };
			const blocked = visible.leases.some(
				(candidate) =>
					candidate.ownerToken !== ownerToken &&
					(candidate.choosing ||
						candidate.ticket < lease.ticket ||
						(candidate.ticket === lease.ticket && candidate.ownerToken < ownerToken)),
			);
			if (!blocked) {
				ownsCriticalSection = true;
				return { lease };
			}
			await sleep(options.pollMs);
		}
		return { reason: "busy" };
	} finally {
		// The winner keeps its record until the caller releases it. Failed
		// contenders clean up here so they never become stale blockers.
		if (!ownsCriticalSection) {
			try {
				const current = validStoredLease(ownerToken, await store.get(ownerToken));
				if (current) await deleteOwnedLease(store, current);
			} catch (error: unknown) {
				// Cleanup must not replace the authoritative busy/saturated outcome.
				// A delete can commit and still reject; any remaining record is bounded
				// by reclaimAfter and will be removed by a later contender.
				onCleanupError(error);
			}
		}
	}
}

/**
 * Serialize one plugin operation in-process and advertise the owner durably.
 */
export async function withOperationLease<T>(
	ctx: PluginContext,
	scope: string,
	operation: (owner: OperationLeaseOwner) => Promise<T>,
	options: { ttlMs?: number; acquireTimeoutMs?: number; pollMs?: number } = {},
): Promise<OperationLeaseResult<T>> {
	const localKey = `${ctx.plugin.id}:${ctx.site?.url ?? ""}:${scope}`;
	return withLocalOperationLock(localKey, async () => {
		const store = operationLeaseStore(ctx);
		if (!store) {
			return { acquired: false, reason: "unavailable" };
		}

		const settings = {
			ttlMs: Math.max(1_000, options.ttlMs ?? DEFAULT_LEASE_TTL_MS),
			acquireTimeoutMs: Math.max(0, options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS),
			pollMs: Math.max(5, options.pollMs ?? DEFAULT_POLL_MS),
		};
		const acquired = await acquireDurableLease(store, scope, settings, (error) => {
			ctx.log.warn("seo: failed operation contender cleanup failed", {
				scope,
				error: String(error),
			});
		});
		if (!("lease" in acquired)) return { acquired: false, reason: acquired.reason };

		let lease = acquired.lease;
		const leaseController = new AbortController();
		const loseOwnership = (error?: unknown) => {
			if (leaseController.signal.aborted) return;
			const reason =
				error instanceof Error
					? error
					: new Error(`Operation lease ownership was lost for ${scope}.`);
			leaseController.abort(reason);
		};
		let renewalTail = Promise.resolve();
		const renewLease = async (): Promise<boolean> => {
			if (leaseController.signal.aborted) return false;
			try {
				const current = validStoredLease(lease.id, await store.get(lease.id));
				if (current?.ownerToken !== lease.ownerToken) {
					loseOwnership();
					return false;
				}
				const now = Date.now();
				const expiresAt = Date.parse(current.expiresAt);
				const renewalGuard = Math.min(
					LEASE_RENEWAL_GUARD_MS,
					Math.max(100, Math.floor(settings.ttlMs / 4)),
				);
				// Renewal stops before the reclaim window so an owner can never
				// resurrect itself after another isolate is allowed to proceed.
				if (!Number.isFinite(expiresAt) || now >= expiresAt - renewalGuard) {
					loseOwnership();
					return false;
				}
				const nextLease = {
					...current,
					expiresAt: new Date(now + settings.ttlMs).toISOString(),
					reclaimAfter: new Date(
						now + settings.ttlMs + LEASE_RECLAIM_GRACE_MS,
					).toISOString(),
				};
				await putLeaseVerified(store, nextLease, {
					state: "value",
					value: current,
				});
				lease = nextLease;
				return true;
			} catch (error: unknown) {
				// An unverifiable owner must stop just like a confirmed stale owner.
				loseOwnership(error);
				throw error;
			}
		};
		const owner: OperationLeaseOwner = {
			ownerToken: lease.ownerToken,
			durable: true,
			signal: leaseController.signal,
			renew: () => {
				const result = renewalTail.then(renewLease);
				renewalTail = result.then(
					() => undefined,
					() => undefined,
				);
				return result;
			},
		};
		const heartbeat = setInterval(
			() => {
				void owner
					.renew()
					.then((renewed) => {
						if (!renewed)
							ctx.log.warn("seo: operation lease heartbeat lost ownership", {
								scope,
							});
					})
					.catch((error: unknown) => {
						ctx.log.warn("seo: operation lease heartbeat failed", {
							scope,
							error: String(error),
						});
					});
			},
			Math.max(100, Math.floor(settings.ttlMs / 3)),
		);

		let outcome:
			| { completed: true; value: T }
			| { completed: false; error: unknown };
		try {
			try {
				outcome = { completed: true, value: await operation(owner) };
			} catch (error: unknown) {
				outcome = { completed: false, error };
			}
		} finally {
			clearInterval(heartbeat);
			await renewalTail;
			try {
				await deleteOwnedLease(store, lease);
			} catch (releaseError: unknown) {
				let stillOwned: boolean | null = null;
				try {
					const current = validStoredLease(lease.id, await store.get(lease.id));
					stillOwned = current?.ownerToken === lease.ownerToken;
				} catch {
					// The operation result remains authoritative. An unverifiable record
					// is bounded by the same stale-owner reclaim window.
				}
				ctx.log.warn("seo: operation lease cleanup failed", {
					scope,
					stillOwned,
					error: String(releaseError),
				});
			}
		}
		if (leaseController.signal.aborted)
			return outcome.completed
				? { acquired: false, reason: "lost", value: outcome.value }
				: { acquired: false, reason: "lost" };
		if (!outcome.completed) throw outcome.error;
		return { acquired: true, value: outcome.value };
	});
}
