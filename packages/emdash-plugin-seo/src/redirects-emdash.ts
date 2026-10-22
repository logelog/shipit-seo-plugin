// EmDash adapter for the shared redirect commands, written against the
// published 1.1.0 `ctx.redirects` contract. `ctx.redirects` exists only when the
// plugin declares a redirect capability, and gains create and update with
// redirects:write.
import type { PluginContext } from "emdash";

import {
	RedirectHostError,
	type RedirectHost,
	type RedirectRule,
	type RedirectRulePatch,
	type VersionedRedirectRule,
} from "./redirects.ts";

// EmDash 1.1.0 grants redirects:manage to administrators only. This drives
// whether the form is offered; the route permission is what the host enforces.
const REDIRECTS_MANAGE_ROLE = 50;
const LOOP_MESSAGE_PREFIX = "This redirect would create a loop";
const DUPLICATE_MESSAGE_PREFIX = "A redirect from ";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): value is string | null {
	return value === null || typeof value === "string";
}

function toRule(value: unknown): RedirectRule {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" || typeof value.source !== "string" ||
		typeof value.destination !== "string" || !Number.isInteger(value.type) ||
		typeof value.isPattern !== "boolean" || typeof value.enabled !== "boolean" ||
		!Number.isInteger(value.hits) || !nullableString(value.lastHitAt) || !nullableString(value.groupName) ||
		typeof value.auto !== "boolean" || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string"
	) {
		throw new RedirectHostError("failed", "EmDash returned an unexpected redirect record");
	}
	return {
		id: value.id,
		source: value.source,
		destination: value.destination,
		type: value.type as number,
		isPattern: value.isPattern,
		enabled: value.enabled,
		hits: value.hits as number,
		lastHitAt: value.lastHitAt,
		groupName: value.groupName,
		auto: value.auto,
		createdAt: value.createdAt,
		updatedAt: value.updatedAt,
	};
}

function hostError(error: unknown): RedirectHostError {
	if (error instanceof RedirectHostError) return error;
	const code = isRecord(error) ? error.code : undefined;
	const message = error instanceof Error && error.message ? error.message : "EmDash could not complete the redirect request";
	switch (code) {
		case "VALIDATION_ERROR":
			return new RedirectHostError("validation", message, message.startsWith(LOOP_MESSAGE_PREFIX));
		case "CONFLICT":
			return new RedirectHostError("conflict", message);
		case "REDIRECT_BUSY":
			return new RedirectHostError("busy", message);
		case "INVALID_CURSOR":
			return new RedirectHostError("invalid-cursor", message);
		default:
			// Includes REDIRECT_CREATE_ERROR and NOT_FOUND, which can follow a
			// committed create.
			return new RedirectHostError("failed", message);
	}
}

function toVersioned(value: unknown): VersionedRedirectRule {
	if (!isRecord(value) || typeof value._rev !== "string") {
		throw new RedirectHostError("malformed", "EmDash returned an unexpected redirect version");
	}
	try {
		return { rule: toRule(value.redirect), revision: value._rev };
	} catch {
		throw new RedirectHostError("malformed", "EmDash returned an unexpected redirect record");
	}
}

// Only refusals EmDash makes before its conditional write keep a definite
// code. NOT_FOUND and REDIRECT_UPDATE_ERROR can follow a committed write whose
// final read failed, so they stay `failed`.
function updateError(error: unknown, patch: RedirectRulePatch): RedirectHostError {
	const code = isRecord(error) ? error.code : undefined;
	const message = error instanceof Error && error.message ? error.message : "EmDash could not update the redirect";
	switch (code) {
		case "VALIDATION_ERROR":
			return new RedirectHostError("validation", message, message.startsWith(LOOP_MESSAGE_PREFIX));
		case "CONFLICT":
			// EmDash reports both a changed revision and a duplicate source as
			// CONFLICT; only a patch that moves the source can meet a duplicate.
			return new RedirectHostError(
				patch.source !== undefined && message.startsWith(DUPLICATE_MESSAGE_PREFIX) ? "conflict" : "stale",
				message,
			);
		case "REDIRECT_BUSY":
			return new RedirectHostError("busy", message);
		case "INVALID_PRECONDITION":
			return new RedirectHostError("precondition", message);
		default:
			return new RedirectHostError("failed", message);
	}
}

// Copies only the editable fields, so group, origin and activity never reach
// the host from here.
function updatePayload(patch: RedirectRulePatch): RedirectRulePatch | null {
	const payload: RedirectRulePatch = {};
	if (patch.source !== undefined) payload.source = patch.source;
	if (patch.destination !== undefined) payload.destination = patch.destination;
	if (patch.type !== undefined) payload.type = patch.type;
	if (patch.enabled !== undefined) payload.enabled = patch.enabled;
	return Object.keys(payload).length ? payload : null;
}

export function emdashRedirectHost(ctx: PluginContext): RedirectHost | null {
	const access = (ctx as unknown as { redirects?: Record<string, unknown> }).redirects;
	if (!access || typeof access.list !== "function") return null;
	const list = access.list as (options: unknown) => Promise<unknown>;
	const create = typeof access.create === "function"
		? access.create as (input: unknown) => Promise<unknown>
		: null;
	const get = typeof access.get === "function" ? access.get as (id: string) => Promise<unknown> : null;
	const update = typeof access.update === "function"
		? access.update as (id: string, input: unknown) => Promise<unknown>
		: null;
	const host: RedirectHost = {
		async list(options) {
			let page: unknown;
			try {
				page = await list.call(access, options);
			} catch (error) {
				throw hostError(error);
			}
			// A page that claims more results without a usable cursor must not read
			// as the end of the list: lookups would then prove absence falsely.
			const continues = isRecord(page) && page.hasMore === true;
			const cursor = isRecord(page) && typeof page.cursor === "string" && page.cursor ? page.cursor : null;
			if (
				!isRecord(page) || !Array.isArray(page.items) || typeof page.hasMore !== "boolean" ||
				continues !== (cursor !== null) || (!continues && page.cursor !== undefined && page.cursor !== null)
			) {
				throw new RedirectHostError("failed", "EmDash returned an inconsistent redirect page");
			}
			return { items: page.items.map(toRule), cursor };
		},
	};
	if (create) {
		host.create = async (input) => {
			let created: unknown;
			try {
				created = await create.call(access, { ...input, enabled: true });
			} catch (error) {
				throw hostError(error);
			}
			if (!isRecord(created)) throw new RedirectHostError("failed", "EmDash returned an unexpected redirect");
			return toRule(created.redirect);
		};
	}
	if (get) {
		host.get = async (id) => {
			let version: unknown;
			try {
				version = await get.call(access, id);
			} catch (error) {
				throw hostError(error);
			}
			return version === null ? null : toVersioned(version);
		};
	}
	if (update) {
		host.update = async (id, patch, revision) => {
			const payload = updatePayload(patch);
			if (!payload) throw new RedirectHostError("validation", "A redirect update needs at least one changed field");
			let saved: unknown;
			try {
				// The revision is passed through exactly as EmDash issued it.
				saved = await update.call(access, id, { ...payload, _rev: revision });
			} catch (error) {
				throw updateError(error, payload);
			}
			return toVersioned(saved);
		};
	}
	return host;
}

export function canManageRedirects(user: unknown): boolean {
	return isRecord(user) && typeof user.role === "number" && user.role >= REDIRECTS_MANAGE_ROLE;
}
