// The four private internal-link commands over the shared runtime. Each
// command bounds and checks its parsed JSON input before it looks for a host
// or reads anything, then runs one runtime over fresh ports from the
// injected host. Find, Next and Verify
// authorize the selected destination against fresh exact schema metadata
// when the runtime resolves its scope; Check saved link reads the exact
// source only. Nothing outlives a command except the inert host.

import type { PluginContext } from "emdash";

import {
	createLinkSuggestionRuntime,
	validateLinkFindRequest,
	validateLinkNextRequest,
	type LinkPageResult,
	type LinkSavedLinkResult,
	type LinkSuggestionRuntime,
	type LinkVerifyResult,
} from "./internal-link-runtime.ts";
import type { LinkCandidatePort, LinkScopeRequest, LinkScopeResolution, LinkSuggestionPorts } from "./internal-link-source.ts";
import { LINK_SUGGESTION_LIMITS, validateLinkSuggestionRequest, type LinkSuggestionRequest } from "./internal-link-suggestions.ts";
import { jsonUtf8LengthWithin } from "./lib.ts";

/** Find and Next JSON bodies, as their routes declare and as the commands measure them again. */
export const LINK_PAGE_REQUEST_MAX_BYTES = 16_384;
/**
 * Verify and Check JSON bodies: the shared request validator's own limit, so a
 * suggestion Find returned, whose per-character decorators can pass 16 KiB,
 * is accepted unchanged.
 */
export const LINK_SUGGESTION_REQUEST_MAX_BYTES = LINK_SUGGESTION_LIMITS.responseBytes;
/** The host returns a route result as `{"success":true,"data":result}`, 24 bytes around it. */
export const LINK_ROUTE_RESPONSE_BYTES = LINK_SUGGESTION_LIMITS.responseBytes - 24;

/** Fresh ports for exactly one command invocation; opening them reads nothing. */
export interface LinkCommandHost {
	open(ctx: PluginContext): LinkSuggestionPorts;
}

export interface LinkCommands {
	find(input: unknown, ctx: PluginContext): Promise<LinkPageResult>;
	next(input: unknown, ctx: PluginContext): Promise<LinkPageResult>;
	verify(input: unknown, ctx: PluginContext): Promise<LinkVerifyResult>;
	checkSaved(input: unknown, ctx: PluginContext): Promise<LinkSavedLinkResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The JSON form of a parsed command input, in UTF-8 bytes, within `limit`. */
export function linkRouteInputWithinBytes(value: unknown, limit: number): boolean {
	try {
		return jsonUtf8LengthWithin(value, limit) !== null;
	} catch {
		return false;
	}
}

interface Shape {
	keys: readonly string[];
	nested?: Record<string, Shape>;
}

// Exactly the objects a Find response hands back for a suggestion. The shared
// validator checks their values but tolerates extra fields; this does not.
const SUGGESTION_REQUEST: Shape = {
	keys: ["owner", "policyVersion", "suggestion"],
	nested: {
		owner: {
			keys: ["source", "scope", "generation"],
			nested: {
				source: { keys: ["collection", "entryId", "locale", "sourceVersion", "revisionId", "field"] },
				scope: { keys: ["collection", "locale", "taxonomy", "termIds", "afterId", "scopeVersion"] },
			},
		},
		suggestion: {
			keys: ["target", "anchor", "reason"],
			nested: {
				target: { keys: ["collection", "entryId", "locale", "title", "publicUrl", "route", "version", "targetPolicyVersion"] },
				anchor: {
					keys: ["blockKey", "spanKey", "blockKind", "start", "end", "text", "paragraph", "paragraphStart", "paragraphEnd", "decorators", "occurrence", "heading"],
					nested: { occurrence: { keys: ["ordinal", "total"] } },
				},
				reason: { keys: ["kind", "field", "quote", "tokens"] },
			},
		},
	},
};

function hasShape(value: unknown, shape: Shape): boolean {
	if (!isRecord(value)) return false;
	const own = Object.keys(value);
	if (own.length !== shape.keys.length || !shape.keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))) return false;
	return Object.entries(shape.nested ?? {}).every(([key, inner]) => hasShape(value[key], inner));
}

/** A Verify or Check input: bounded, exactly shaped at every object level, then the shared validator. */
export function strictLinkSuggestionRequest(value: unknown): LinkSuggestionRequest | null {
	if (!linkRouteInputWithinBytes(value, LINK_SUGGESTION_REQUEST_MAX_BYTES) || !hasShape(value, SUGGESTION_REQUEST)) return null;
	return validateLinkSuggestionRequest(value);
}

/**
 * Scope resolution behind a fresh exact read of the selected collection's
 * schema: it must exist under that slug, visible and routable. Unreadable
 * metadata is an unavailable scope, never a changed or authorized one. The
 * scope port then checks persisted definitions and membership itself.
 */
async function authorizedScope(ctx: PluginContext, candidates: LinkCandidatePort, request: LinkScopeRequest, allowed: readonly string[]): Promise<LinkScopeResolution> {
	const schema = ctx.schema;
	if (typeof schema?.getCollection !== "function") return { kind: "unavailable" };
	let info: unknown;
	try {
		info = await schema.getCollection(request.collection);
	} catch {
		return { kind: "unavailable" };
	}
	if (info === null) return { kind: "invalid", reason: "collection-unavailable" };
	if (!isRecord(info) || info.slug !== request.collection || typeof info.hidden !== "boolean" || typeof info.routable !== "boolean") {
		return { kind: "unavailable" };
	}
	if (info.hidden || !info.routable) return { kind: "invalid", reason: "collection-unavailable" };
	return candidates.resolveScope(request, allowed);
}

function absentRuntime(): LinkSuggestionRuntime {
	return createLinkSuggestionRuntime({
		ports: { kind: "unavailable", reason: "adapter-absent" },
		allowedCollections: [],
		responseBytes: LINK_ROUTE_RESPONSE_BYTES,
	});
}

/** One runtime over fresh ports. The destination is allowed here only because the gate authorizes it. */
function commandRuntime(host: LinkCommandHost, ctx: PluginContext, destination: string | null): LinkSuggestionRuntime {
	const ports = host.open(ctx);
	const gated: LinkSuggestionPorts = destination === null ? ports : {
		...ports,
		candidates: {
			resolveScope: (request, allowed) => authorizedScope(ctx, ports.candidates, request, allowed),
			page: (scope, afterId, budget) => ports.candidates.page(scope, afterId, budget),
		},
	};
	return createLinkSuggestionRuntime({
		ports: { kind: "available", ports: gated },
		allowedCollections: destination === null ? [] : [destination],
		responseBytes: LINK_ROUTE_RESPONSE_BYTES,
	});
}

/**
 * The commands for one engine. Every input is bounded and validated first,
 * so an invalid one is refused whether or not a host exists. A valid input
 * without a host answers `adapter-absent`; neither case opens or reads
 * anything.
 */
export function createLinkCommands(host: LinkCommandHost | null): LinkCommands {
	return {
		async find(input, ctx) {
			const request = linkRouteInputWithinBytes(input, LINK_PAGE_REQUEST_MAX_BYTES) ? validateLinkFindRequest(input) : null;
			if (!request) return { kind: "invalid", reason: "request" };
			if (!host) return absentRuntime().find(request);
			return commandRuntime(host, ctx, request.destination.collection).find(request);
		},
		async next(input, ctx) {
			const request = linkRouteInputWithinBytes(input, LINK_PAGE_REQUEST_MAX_BYTES) ? validateLinkNextRequest(input) : null;
			if (!request) return { kind: "invalid", reason: "receipt" };
			if (!host) return absentRuntime().next(request);
			return commandRuntime(host, ctx, request.receipt.scope.collection).next(request);
		},
		async verify(input, ctx) {
			const request = strictLinkSuggestionRequest(input);
			if (!request) return { kind: "invalid", reason: "request" };
			if (!host) return absentRuntime().verify(request);
			return commandRuntime(host, ctx, request.owner.scope.collection).verify(request);
		},
		async checkSaved(input, ctx) {
			const request = strictLinkSuggestionRequest(input);
			if (!request) return { kind: "invalid", reason: "request" };
			if (!host) return absentRuntime().checkSaved(request);
			// Exact source only: no destination gate, scope, policy, target or candidate read.
			return commandRuntime(host, ctx, null).checkSaved(request);
		},
	};
}
