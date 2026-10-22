import { compareStoredValue, supportsConditionalStorage } from "./conditional-storage.ts";
import type { PluginContext } from "emdash";

import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ENGINE_VERSION,
	type SeoAdmin404Monitor,
	type SeoAdmin404TriageResult,
} from "./admin-contract.ts";
import {
	SEO_404_MONITOR_LEGACY_STORAGE_VERSION,
	SEO_404_MONITOR_MAX_RECORDS,
	SEO_404_MONITOR_STORAGE_VERSION,
	legacyNotFoundRecordId,
	normalizeNotFoundPath,
	notFoundRecordId,
	prepareRedirectSuggestionIndex,
	shouldTrackNotFoundPath,
	suggestRedirectsFromIndex,
	type SeoNotFoundRecord,
	type SeoNotFoundStatus,
	type SeoRedirectCandidate,
} from "./monitor404.ts";
import { withOperationLease } from "./operation-lease.ts";

export interface Seo404RuntimeDependencies {
	isEnabled(ctx: PluginContext): Promise<boolean>;
	loadRedirectCandidates(ctx: PluginContext): Promise<readonly SeoRedirectCandidate[]>;
	valuesEqual(left: unknown, right: unknown): boolean;
}

export function createSeo404Runtime(dependencies: Seo404RuntimeDependencies) {
	const monitorReadLimit = SEO_404_MONITOR_MAX_RECORDS * 2;

	function storedNotFoundRecord(value: unknown): SeoNotFoundRecord | null {
		if (!value || typeof value !== "object" || Array.isArray(value)) return null;
		const candidate = value as Partial<SeoNotFoundRecord>;
		const path = normalizeNotFoundPath(candidate.path);
		if (
			(candidate.storageVersion !== SEO_404_MONITOR_LEGACY_STORAGE_VERSION &&
				candidate.storageVersion !== SEO_404_MONITOR_STORAGE_VERSION) ||
			typeof candidate.id !== "string" ||
			!path ||
			typeof candidate.hits !== "number" ||
			!Number.isFinite(candidate.hits) ||
			candidate.hits < 1 ||
			typeof candidate.firstSeenAt !== "string" ||
			typeof candidate.lastSeenAt !== "string" ||
			!(["open", "ignored", "resolved"] as const).includes(candidate.status as SeoNotFoundStatus)
		)
			return null;
		let legacyMove: SeoNotFoundRecord["legacyMove"];
		if (candidate.legacyMove !== undefined) {
			const move = candidate.legacyMove as Partial<
				NonNullable<SeoNotFoundRecord["legacyMove"]>
			>;
			if (
				candidate.storageVersion !== SEO_404_MONITOR_STORAGE_VERSION ||
				!move ||
				typeof move !== "object" ||
				typeof move.sourceId !== "string" ||
				!/^sha256-[a-f0-9]{64}$/.test(String(move.sourceFingerprint ?? ""))
			)
				return null;
			legacyMove = {
				sourceId: move.sourceId,
				sourceFingerprint: String(move.sourceFingerprint),
			};
		}
		return {
			storageVersion: candidate.storageVersion,
			id: candidate.id,
			path,
			hits: Math.floor(candidate.hits),
			firstSeenAt: candidate.firstSeenAt,
			lastSeenAt: candidate.lastSeenAt,
			status: candidate.status as SeoNotFoundStatus,
			redirectTarget: normalizeNotFoundPath(candidate.redirectTarget) ?? null,
			...(legacyMove ? { legacyMove } : {}),
		};
	}

	type NotFoundLogResult = {
		success: boolean;
		recorded: boolean;
		reason?: "disabled" | "ignored" | "capacity" | "collision" | "busy";
		path?: string;
	};

	function stableNotFoundStorageValue(value: unknown): unknown {
		if (Array.isArray(value)) return value.map(stableNotFoundStorageValue);
		if (!value || typeof value !== "object") return value;
		const record = value as Record<string, unknown>;
		return Object.fromEntries(
			Object.keys(record)
				.sort()
				.map((key) => [key, stableNotFoundStorageValue(record[key])]),
		);
	}

	async function notFoundStorageFingerprint(value: unknown): Promise<string> {
		const payload = JSON.stringify(stableNotFoundStorageValue(value));
		const digest = await globalThis.crypto.subtle.digest(
			"SHA-256",
			new TextEncoder().encode(payload),
		);
		return `sha256-${Array.from(new Uint8Array(digest), (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("")}`;
	}

	async function deleteLegacyNotFoundSource(
		ctx: PluginContext,
		sourceId: string,
		sourceFingerprint: string,
	): Promise<"deleted" | "changed" | "unavailable"> {
		if (!supportsConditionalStorage(ctx.storage.notFoundHits)) return "unavailable";
		const current = await ctx.storage.notFoundHits.get(sourceId);
		if (current == null) return "deleted";
		if ((await notFoundStorageFingerprint(current)) !== sourceFingerprint)
			return "changed";
		try {
			const deleted = await compareStoredValue(
				ctx.storage.notFoundHits,
				sourceId,
				{ state: "value", value: current },
				{ action: "delete" },
			);
			if (deleted) return "deleted";
		} catch {
			const afterError = await ctx.storage.notFoundHits.get(sourceId);
			if (afterError == null) return "deleted";
			if ((await notFoundStorageFingerprint(afterError)) !== sourceFingerprint)
				return "changed";
			return "unavailable";
		}
		const after = await ctx.storage.notFoundHits.get(sourceId);
		if (after == null) return "deleted";
		return (await notFoundStorageFingerprint(after)) === sourceFingerprint
			? "unavailable"
			: "changed";
	}

	type NotFoundCompareResult = "committed" | "changed" | "unavailable";

	async function compareNotFoundAndSet(
		ctx: PluginContext,
		id: string,
		expected: unknown | null,
		next: { action: "delete" } | { action: "put"; value: SeoNotFoundRecord },
	): Promise<NotFoundCompareResult> {
		if (!supportsConditionalStorage(ctx.storage.notFoundHits)) return "unavailable";
		const expectedState =
			expected === null
				? { state: "missing" as const }
				: { state: "value" as const, value: expected };
		try {
			if (
				await compareStoredValue(
					ctx.storage.notFoundHits,
					id,
					expectedState,
					next,
				)
			)
				return "committed";
		} catch {
			// The verification below distinguishes a committed write from a transport
			// failure without repeating a mutation against a newer snapshot.
		}
		let current: unknown;
		try {
			current = await ctx.storage.notFoundHits.get(id);
		} catch {
			return "unavailable";
		}
		if (next.action === "delete" && current == null) return "committed";
		if (
			next.action === "put" &&
			current != null &&
			dependencies.valuesEqual(current, next.value)
		)
			return "committed";
		return dependencies.valuesEqual(current, expected) ? "unavailable" : "changed";
	}

	async function reconcileNotFoundLegacyMove(
		ctx: PluginContext,
		id: string,
		path: string,
	): Promise<
		| { status: "ready"; record: SeoNotFoundRecord; raw: unknown }
		| { status: "missing" | "collision" | "unavailable" }
	> {
		for (let attempt = 0; attempt < 4; attempt += 1) {
			const raw = await ctx.storage.notFoundHits.get(id);
			if (raw == null) return { status: "missing" };
			const record = storedNotFoundRecord(raw);
			if (
				!record ||
				record.storageVersion !== SEO_404_MONITOR_STORAGE_VERSION ||
				record.id !== id ||
				record.path !== path
			)
				return { status: "collision" };
			if (!record.legacyMove) return { status: "ready", record, raw };
			if (record.legacyMove.sourceId !== legacyNotFoundRecordId(path))
				return { status: "collision" };
			const cleanup = await deleteLegacyNotFoundSource(
				ctx,
				record.legacyMove.sourceId,
				record.legacyMove.sourceFingerprint,
			);
			if (cleanup === "changed") {
				const rolledBack = await compareNotFoundAndSet(ctx, id, raw, {
					action: "delete",
				});
				if (rolledBack === "committed") return { status: "missing" };
				if (rolledBack === "unavailable") return { status: "unavailable" };
				continue;
			}
			if (cleanup === "unavailable") return { status: "unavailable" };
			const { legacyMove: _legacyMove, ...cleanRecord } = record;
			const cleared = await compareNotFoundAndSet(ctx, id, raw, {
				action: "put",
				value: cleanRecord,
			});
			if (cleared === "unavailable") return { status: "unavailable" };
		}
		return { status: "unavailable" };
	}

	async function admitNewNotFoundPath(
		ctx: PluginContext,
		path: string,
		id: string,
		now: string,
	): Promise<NotFoundLogResult> {
		const admission = await withOperationLease(
			ctx,
			"404-monitor:capacity-admission",
			async (): Promise<NotFoundLogResult> => {
				if (
					(await ctx.storage.notFoundHits.count()) >=
					SEO_404_MONITOR_MAX_RECORDS
				)
					return { success: true, recorded: false, reason: "capacity", path };
				const record: SeoNotFoundRecord = {
					storageVersion: SEO_404_MONITOR_STORAGE_VERSION,
					id,
					path,
					hits: 1,
					firstSeenAt: now,
					lastSeenAt: now,
					status: "open",
					redirectTarget: null,
				};
				const inserted = await compareNotFoundAndSet(ctx, id, null, {
					action: "put",
					value: record,
				});
				if (inserted !== "committed")
					return {
						success: true,
						recorded: false,
						reason: inserted === "changed" ? "collision" : "busy",
						path,
					};
				if (
					(await ctx.storage.notFoundHits.count()) >
					SEO_404_MONITOR_MAX_RECORDS
				) {
					const rolledBack = await compareNotFoundAndSet(ctx, id, record, {
						action: "delete",
					});
					return {
						success: true,
						recorded: false,
						reason:
							rolledBack === "committed"
								? "capacity"
								: rolledBack === "changed"
									? "collision"
									: "busy",
						path,
					};
				}
				return { success: true, recorded: true, path };
			},
			{ acquireTimeoutMs: 250 },
		);
		if (admission.acquired) return admission.value;
		if ("value" in admission && admission.value !== undefined)
			return admission.value;
		return { success: true, recorded: false, reason: "busy", path };
	}

	async function updateNotFoundPath(
		ctx: PluginContext,
		path: string,
		id: string,
	): Promise<NotFoundLogResult> {
		const now = new Date().toISOString();
		for (let attempt = 0; attempt < 4; attempt += 1) {
			const canonical = await reconcileNotFoundLegacyMove(ctx, id, path);
			if (canonical.status === "collision")
				return { success: true, recorded: false, reason: "collision", path };
			if (canonical.status === "unavailable")
				return { success: true, recorded: false, reason: "busy", path };
			if (canonical.status === "ready") {
				const updated: SeoNotFoundRecord = {
					...canonical.record,
					hits: Math.min(canonical.record.hits + 1, Number.MAX_SAFE_INTEGER),
					lastSeenAt: now,
				};
				const committed = await compareNotFoundAndSet(
					ctx,
					id,
					canonical.raw,
					{ action: "put", value: updated },
				);
				if (committed === "committed")
					return { success: true, recorded: true, path };
				if (committed === "unavailable")
					return { success: true, recorded: false, reason: "busy", path };
				continue;
			}
			break;
		}

		const legacyId = legacyNotFoundRecordId(path);
		const legacyValue = await ctx.storage.notFoundHits.get(legacyId);
		const legacy = storedNotFoundRecord(legacyValue);
		if (
			legacy?.storageVersion === SEO_404_MONITOR_LEGACY_STORAGE_VERSION &&
			legacy.id === legacyId &&
			legacy.path === path
		) {
			if (!supportsConditionalStorage(ctx.storage.notFoundHits))
				return { success: true, recorded: false, reason: "busy", path };
			const sourceFingerprint = await notFoundStorageFingerprint(legacyValue);
			const migrated: SeoNotFoundRecord = {
				...legacy,
				storageVersion: SEO_404_MONITOR_STORAGE_VERSION,
				id,
				hits: Math.min(legacy.hits + 1, Number.MAX_SAFE_INTEGER),
				lastSeenAt: now,
				legacyMove: {
					sourceId: legacyId,
					sourceFingerprint,
				},
			};
			let canonicalCommitted = false;
			try {
				canonicalCommitted = await compareStoredValue(
					ctx.storage.notFoundHits,
					id,
					{ state: "missing" },
					{ action: "put", value: migrated },
				);
			} catch {
				const afterError = storedNotFoundRecord(
					await ctx.storage.notFoundHits.get(id),
				);
				canonicalCommitted =
					afterError?.storageVersion === SEO_404_MONITOR_STORAGE_VERSION &&
					afterError.id === id &&
					afterError.path === path &&
					afterError.legacyMove?.sourceId === legacyId &&
					afterError.legacyMove?.sourceFingerprint === sourceFingerprint;
			}
			if (!canonicalCommitted) {
				const currentCanonical = storedNotFoundRecord(
					await ctx.storage.notFoundHits.get(id),
				);
				if (
					currentCanonical?.storageVersion !== SEO_404_MONITOR_STORAGE_VERSION ||
					currentCanonical.id !== id ||
					currentCanonical.path !== path ||
					currentCanonical.legacyMove?.sourceId !== legacyId ||
					currentCanonical.legacyMove?.sourceFingerprint !== sourceFingerprint
				)
					return { success: true, recorded: false, reason: "collision", path };
			}
			const cleanup = await deleteLegacyNotFoundSource(
				ctx,
				legacyId,
				sourceFingerprint,
			);
			if (cleanup === "deleted") {
				const reconciled = await reconcileNotFoundLegacyMove(ctx, id, path);
				return reconciled.status === "ready"
					? { success: true, recorded: true, path }
					: {
							success: true,
							recorded: false,
							reason:
								reconciled.status === "collision" ? "collision" : "busy",
							path,
						};
			}
			if (cleanup === "changed") {
				const canonicalValue = await ctx.storage.notFoundHits.get(id);
				const rolledBack = dependencies.valuesEqual(canonicalValue, migrated)
					? await compareNotFoundAndSet(ctx, id, canonicalValue, {
							action: "delete",
						})
					: "changed";
				return {
					success: true,
					recorded: false,
					reason: rolledBack === "unavailable" ? "busy" : "collision",
					path,
				};
			}
			return { success: true, recorded: false, reason: "busy", path };
		}

		return admitNewNotFoundPath(ctx, path, id, now);
	}

	async function logNotFoundPath(
		ctx: PluginContext,
		inputPath: unknown,
	): Promise<NotFoundLogResult> {
		const enabled = await dependencies.isEnabled(ctx);
		if (!enabled) return { success: true, recorded: false, reason: "disabled" };
		const path = normalizeNotFoundPath(inputPath);
		if (!path || !shouldTrackNotFoundPath(path))
			return { success: true, recorded: false, reason: "ignored" };
		const id = await notFoundRecordId(path);
		const result = await withOperationLease(
			ctx,
			`404-monitor:${id}`,
			() => updateNotFoundPath(ctx, path, id),
			{ acquireTimeoutMs: 250 },
		);
		if (result.acquired) return result.value;
		if ("value" in result && result.value !== undefined) return result.value;
		return { success: true, recorded: false, reason: "busy", path };
	}

	async function buildAdmin404Monitor(
		ctx: PluginContext,
		limit = 100,
	): Promise<SeoAdmin404Monitor> {
		const enabled = await dependencies.isEnabled(ctx);
		const storedItems: any[] = [];
		const seenCursors = new Set<string>();
		let cursor: string | undefined;
		try {
			do {
				const result = await ctx.storage.notFoundHits.query({
					limit: Math.min(100, monitorReadLimit - storedItems.length),
					...(cursor ? { cursor } : {}),
				});
				storedItems.push(...(result.items ?? []));
				if (!result.hasMore || storedItems.length >= monitorReadLimit) {
					if (result.hasMore) {
						ctx.log.warn(
							"seo: 404 monitor storage exceeds its declared record cap",
						);
					}
					break;
				}
				const nextCursor = typeof result.cursor === "string" ? result.cursor : "";
				if (!nextCursor || seenCursors.has(nextCursor)) {
					throw new Error("404 monitor pagination did not advance");
				}
				seenCursors.add(nextCursor);
				cursor = nextCursor;
			} while (cursor);
		} catch (error: unknown) {
			ctx.log.warn("seo: failed to load 404 monitor records", {
				error: String(error),
			});
			throw error;
		}
		const rawById = new Map(
			storedItems.map((item: any) => [
				String(item.id ?? item.data?.id ?? ""),
				item.data ?? item,
			]),
		);
		const parsedRecords = storedItems
			.map((item: any) => storedNotFoundRecord(item.data ?? item))
			.filter((item: SeoNotFoundRecord | null): item is SeoNotFoundRecord =>
				Boolean(item),
			);
		const parsedById = new Map(parsedRecords.map((item) => [item.id, item]));
		const hiddenLegacyIds = new Set<string>();
		const hiddenMarkerIds = new Set<string>();
		for (const record of parsedRecords) {
			if (
				record.storageVersion !== SEO_404_MONITOR_STORAGE_VERSION ||
				!record.legacyMove
			)
				continue;
			const legacyRaw = rawById.get(record.legacyMove.sourceId);
			if (legacyRaw === undefined || !parsedById.has(record.legacyMove.sourceId))
				continue;
			if (
				(await notFoundStorageFingerprint(legacyRaw)) ===
				record.legacyMove.sourceFingerprint
			) {
				hiddenLegacyIds.add(record.legacyMove.sourceId);
			} else {
				hiddenMarkerIds.add(record.id);
			}
		}
		const records: SeoNotFoundRecord[] = parsedRecords
			.filter(
				(item) =>
					!hiddenLegacyIds.has(item.id) && !hiddenMarkerIds.has(item.id),
			)
			.map((item) => {
				const { legacyMove: _legacyMove, ...visible } = item;
				return visible;
			})
			.sort(
				(left, right) =>
					right.lastSeenAt.localeCompare(left.lastSeenAt) ||
					left.id.localeCompare(right.id),
			);
		if (records.length > SEO_404_MONITOR_MAX_RECORDS) {
			ctx.log.warn("seo: 404 monitor storage exceeds its declared record cap");
		}
		const requestedLimit = Math.max(1, Math.min(Math.floor(limit), 200));
		const visibleRecords = records.slice(0, requestedLimit);
		const candidates = visibleRecords.some((item) => item.status === "open")
			? await dependencies.loadRedirectCandidates(ctx)
			: [];
		const suggestionIndex = prepareRedirectSuggestionIndex(candidates);
		return {
			contractVersion: SEO_ADMIN_CONTRACT_VERSION,
			engineVersion: SEO_ENGINE_VERSION,
			generatedAt: new Date().toISOString(),
			enabled,
			summary: {
				totalHits: records.reduce((total, item) => total + item.hits, 0),
				uniquePaths: records.length,
				openPaths: records.filter((item) => item.status === "open").length,
				resolvedPaths: records.filter((item) => item.status === "resolved").length,
			},
			items: visibleRecords.map((item) => ({
				...item,
				suggestions:
					item.status === "open"
						? suggestRedirectsFromIndex(item.path, suggestionIndex, 3).suggestions
						: [],
			})),
		};
	}

	async function triageNotFoundPath(
		ctx: PluginContext,
		input: {
			id: string;
			status: SeoNotFoundStatus;
			redirectTarget?: string | null;
			limit?: number;
		},
	): Promise<SeoAdmin404TriageResult> {
		try {
			const submitted = storedNotFoundRecord(
				await ctx.storage.notFoundHits.get(input.id),
			);
			if (!submitted || submitted.id !== input.id)
				return { success: false, error: "not_found" };
			const canonicalId = await notFoundRecordId(submitted.path);
			const legacyId = legacyNotFoundRecordId(submitted.path);
			if (
				(submitted.storageVersion === SEO_404_MONITOR_STORAGE_VERSION &&
					input.id !== canonicalId) ||
				(submitted.storageVersion === SEO_404_MONITOR_LEGACY_STORAGE_VERSION &&
					input.id !== legacyId)
			) {
				return { success: false, error: "not_found" };
			}
			const mutation = await withOperationLease(
				ctx,
				`404-monitor:${canonicalId}`,
				async (): Promise<
					| { success: true }
					| {
							success: false;
							error: "not_found" | "invalid_target" | "storage_unavailable";
					  }
				> => {
					const redirectTarget =
						input.status === "resolved"
							? normalizeNotFoundPath(input.redirectTarget)
							: null;
					if (
						input.status === "resolved" &&
						(!redirectTarget || redirectTarget === submitted.path)
					) {
						return { success: false, error: "invalid_target" };
					}
					for (let attempt = 0; attempt < 4; attempt += 1) {
						const canonicalState = await reconcileNotFoundLegacyMove(
							ctx,
							canonicalId,
							submitted.path,
						);
						if (canonicalState.status === "collision")
							return { success: false, error: "not_found" };
						if (canonicalState.status === "unavailable")
							return { success: false, error: "storage_unavailable" };
						let current: SeoNotFoundRecord | null = null;
						let raw: unknown = null;
						if (canonicalState.status === "ready") {
							current = canonicalState.record;
							raw = canonicalState.raw;
						} else {
							raw = await ctx.storage.notFoundHits.get(legacyId);
							const legacy = storedNotFoundRecord(raw);
							if (
								legacy?.storageVersion ===
									SEO_404_MONITOR_LEGACY_STORAGE_VERSION &&
								legacy.id === legacyId &&
								legacy.path === submitted.path
							)
								current = legacy;
						}
						if (!current || raw == null)
							return { success: false, error: "not_found" };
						const updated: SeoNotFoundRecord = {
							...current,
							status: input.status,
							redirectTarget,
						};
						const committed = await compareNotFoundAndSet(
							ctx,
							current.id,
							raw,
							{ action: "put", value: updated },
						);
						if (committed === "committed") return { success: true };
						if (committed === "unavailable")
							return { success: false, error: "storage_unavailable" };
					}
					return { success: false, error: "storage_unavailable" };
				},
			);
			if (!mutation.acquired)
				return { success: false, error: "storage_unavailable" };
			if (!mutation.value.success) return mutation.value;
			return {
				success: true,
				monitor: await buildAdmin404Monitor(ctx, input.limit),
			};
		} catch {
			return { success: false, error: "storage_unavailable" };
		}
	}

	return {
		buildAdmin404Monitor,
		logNotFoundPath,
		triageNotFoundPath,
	};
}
