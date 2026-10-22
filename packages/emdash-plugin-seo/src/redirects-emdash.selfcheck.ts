import assert from "node:assert/strict";

import type { PluginContext } from "emdash";

import {
	RedirectHostError,
	createRedirectRule,
	listRedirectRules,
	loadRedirectRule,
	reconcileRedirectRule,
	updateRedirectRule,
	type RedirectRuleUpdateResult,
} from "./redirects.ts";
import { canManageRedirects, emdashRedirectHost } from "./redirects-emdash.ts";

function record(overrides: Record<string, unknown> = {}) {
	return {
		id: "01J9REDIRECT", source: "/a", destination: "/b", type: 301, isPattern: false, enabled: true,
		hits: 0, lastHitAt: null, groupName: null, auto: false,
		createdAt: "2026-10-02T12:00:00.000Z", updatedAt: "2026-10-02T12:00:00.000Z",
		...overrides,
	};
}

// The published RedirectAccessError carries a string code.
function accessError(code: string, message: string): Error {
	return Object.assign(new Error(message), { name: "RedirectAccessError", code });
}

function context(redirects: unknown): PluginContext {
	return { redirects } as unknown as PluginContext;
}

const draft = { source: "/a", destination: "/b", type: 301 };

// Capability shapes: none, read-only, read and write.
{
	assert.equal(emdashRedirectHost(context(undefined)), null);
	const readOnly = emdashRedirectHost(context({ list: async () => ({ items: [], hasMore: false }), get: async () => null }));
	assert.ok(readOnly && !readOnly.create);
	assert.equal(canManageRedirects({ id: "u", role: 50 }), true);
	assert.equal(canManageRedirects({ id: "u", role: 40 }), false);
	assert.equal(canManageRedirects(undefined), false);
}

// Pages pass through; the create payload is the validated rule, enabled, and
// never carries the host-managed automatic marker.
{
	const listed: unknown[] = [];
	const created: unknown[] = [];
	const host = emdashRedirectHost(context({
		list: async (options: unknown) => {
			listed.push(options);
			return { items: [record()], cursor: "next", hasMore: true };
		},
		create: async (input: Record<string, unknown>) => {
			created.push(input);
			return { redirect: record({ ...input, id: "01J9CREATED" }), _rev: "r1.x" };
		},
	}))!;
	const page = await host.list({ limit: 25, search: "/a", enabled: true });
	assert.deepEqual(listed, [{ limit: 25, search: "/a", enabled: true }]);
	assert.equal(page.cursor, "next");
	assert.equal(page.items[0]!.source, "/a");
	const rule = await host.create!({ source: "/x", destination: "/y", type: 302 });
	assert.deepEqual(created, [{ source: "/x", destination: "/y", type: 302, enabled: true }]);
	assert.equal(rule.id, "01J9CREATED");
}

// Inconsistent pages are errors, never the end of the list.
for (const page of [
	{ items: [], hasMore: true },
	{ items: [], hasMore: true, cursor: "" },
	{ items: [], hasMore: false, cursor: "stale" },
	{ items: "none", hasMore: false },
	{ items: [{ source: "/a" }], hasMore: false },
	null,
]) {
	const host = emdashRedirectHost(context({ list: async () => page }))!;
	await assert.rejects(host.list({ limit: 10 }), (error: unknown) =>
		error instanceof RedirectHostError && error.code === "failed", JSON.stringify(page));
}

// Failure injection: a create that may have committed, followed by a lookup
// page that claims more results without a cursor, stays uncertain.
{
	let phase: "check" | "recover" = "check";
	const writes: unknown[] = [];
	const host = emdashRedirectHost(context({
		list: async () => phase === "check" ? { items: [], hasMore: false } : { items: [], hasMore: true },
		create: async (input: unknown) => {
			writes.push(input);
			phase = "recover";
			throw accessError("REDIRECT_CREATE_ERROR", "Failed to create redirect");
		},
	}));
	const result = await createRedirectRule(host, draft);
	assert.equal(result.status, "uncertain", "a malformed lookup page cannot prove the rule absent");
	assert.equal(writes.length, 1, "nothing is retried");

	const recovery = emdashRedirectHost(context({ list: async () => ({ items: [], hasMore: true }) }));
	assert.equal((await reconcileRedirectRule(recovery, draft)).status, "uncertain");
	const complete = emdashRedirectHost(context({ list: async () => ({ items: [], hasMore: false }) }));
	const absent = await reconcileRedirectRule(complete, draft);
	assert.equal(absent.status, "uncertain", "a lost request may still write after a complete, empty lookup");
}

// Host error codes keep their meaning.
{
	const empty = async () => ({ items: [], hasMore: false });
	const outcome = async (error: Error) => createRedirectRule(emdashRedirectHost(context({
		list: empty,
		create: async () => { throw error; },
	})), draft);

	const loop = await outcome(accessError("VALIDATION_ERROR", "This redirect would create a loop:\n/b → /a"));
	assert.ok(loop.status === "conflict" && loop.reason === "loop");
	const traversal = await outcome(accessError("VALIDATION_ERROR", "URL must not contain path traversal segments"));
	assert.ok(traversal.status === "failed" && traversal.reason === "host-rejected");
	const conflict = await outcome(accessError("CONFLICT", "A redirect from \"/a\" already exists"));
	assert.ok(conflict.status === "conflict" && conflict.reason === "duplicate");
	const busy = await outcome(accessError("REDIRECT_BUSY", "Another redirect change is in progress"));
	assert.ok(busy.status === "failed" && busy.reason === "busy" && busy.retryable);
	// NOT_FOUND follows a committed create whose read-back failed.
	const unread = await outcome(accessError("NOT_FOUND", "Created redirect not found"));
	assert.ok(unread.status === "failed" && unread.reason === "not-saved", "an empty, complete lookup proves absence");

	const cursor = await listRedirectRules(emdashRedirectHost(context({
		list: async () => { throw accessError("INVALID_CURSOR", "Invalid cursor"); },
	})), { cursor: "forged" }, { canManage: true });
	assert.equal(cursor.status, "invalid-cursor");
}

// A stand-in for the published 1.1.0 get/update: an opaque r1. revision over
// the configuration revision, the conditional write, then the context's final
// versioned read, which can fault after the write committed.
interface PublishedAccessOptions {
	finalRead?: "null" | "throw" | "deleted" | "malformed";
	/** Fulfils with an unparseable readback; `write` decides whether it committed first. */
	fulfilMalformed?: { write: boolean; otherWriter?: boolean };
	beforeWrite?: (rows: Map<string, { redirect: Record<string, unknown>; configRevision: string }>) => void;
	refuse?: Error;
	foreignRevision?: string;
}

function publishedAccess(options: PublishedAccessOptions = {}) {
	let sequence = 0;
	const rows = new Map<string, { redirect: Record<string, unknown>; configRevision: string }>();
	const encode = (id: string, revision: string) =>
		`r1.${btoa(`${id}\0${revision}`).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
	const decode = (id: string, revision: unknown) => {
		if (typeof revision !== "string" || !revision.startsWith("r1.")) throw accessError("INVALID_PRECONDITION", "Invalid redirect revision");
		try {
			const [revisionId, value, extra] = atob(revision.slice(3).replaceAll("-", "+").replaceAll("_", "/")).split("\0");
			if (revisionId !== id || !value || extra !== undefined) throw new Error("invalid");
			return value;
		} catch {
			throw accessError("INVALID_PRECONDITION", "Invalid redirect revision");
		}
	};
	const read = (id: string) => {
		const row = rows.get(id);
		if (!row) return null;
		return { redirect: structuredClone(row.redirect), _rev: options.foreignRevision ?? encode(id, row.configRevision) };
	};
	const calls = { get: [] as string[], update: [] as Array<{ id: string; input: Record<string, unknown> }>, create: 0 };
	const access = {
		list: async () => ({ items: [...rows.values()].map((row) => structuredClone(row.redirect)), hasMore: false }),
		get: async (id: string) => {
			calls.get.push(id);
			return read(id);
		},
		create: async () => {
			calls.create += 1;
			throw new Error("not used");
		},
		update: async (id: string, input: Record<string, unknown>) => {
			calls.update.push({ id, input: structuredClone(input) });
			if (Object.hasOwn(input, "auto")) throw accessError("VALIDATION_ERROR", "The automatic redirect marker is managed by EmDash");
			const { _rev, ...patch } = input;
			const expected = decode(id, _rev);
			if (!Object.values(patch).some((value) => value !== undefined)) {
				throw accessError("VALIDATION_ERROR", "At least one field must be provided");
			}
			options.beforeWrite?.(rows);
			const row = rows.get(id);
			if (!row) throw accessError("NOT_FOUND", `Redirect "${id}" not found`);
			if (row.configRevision !== expected) throw accessError("CONFLICT", "Redirect changed since it was read");
			if (patch.source !== undefined &&
				[...rows.values()].some((other) => other.redirect.id !== id && other.redirect.source === patch.source)) {
				throw accessError("CONFLICT", `A redirect from "${String(patch.source)}" already exists`);
			}
			const next = { ...row.redirect, ...patch };
			if (next.source === next.destination) throw accessError("VALIDATION_ERROR", "Source and destination must be different");
			if (options.refuse) throw options.refuse;
			if (options.fulfilMalformed && !options.fulfilMalformed.write) return { redirect: { id }, _rev: 7 };
			sequence += 1;
			rows.set(id, { redirect: { ...next, updatedAt: `2026-10-04T12:00:${String(sequence).padStart(2, "0")}.000Z` }, configRevision: `c${sequence}` });
			if (options.fulfilMalformed) {
				if (options.fulfilMalformed.otherWriter) {
					const written = rows.get(id)!;
					rows.set(id, { redirect: { ...written.redirect, destination: "/theirs" }, configRevision: `c${sequence}-theirs` });
				}
				return { redirect: { id }, _rev: 7 };
			}
			switch (options.finalRead) {
				case "null":
					throw accessError("NOT_FOUND", "Updated redirect not found");
				case "throw":
					throw new Error("SQLITE_BUSY: database is locked");
				case "deleted":
					rows.delete(id);
					throw accessError("NOT_FOUND", "Updated redirect not found");
				case "malformed":
					return { redirect: { id }, _rev: 7 };
				default:
					return read(id);
			}
		},
	};
	const insert = (overrides: Record<string, unknown> = {}) => {
		const redirect = record(overrides);
		rows.set(redirect.id, { redirect, configRevision: `c0-${redirect.id}` });
		return redirect;
	};
	return { access, rows, calls, insert };
}

async function opened(host: ReturnType<typeof emdashRedirectHost>, id: string) {
	const loaded = await loadRedirectRule(host, { id }, { canManage: true });
	if (loaded.status !== "loaded") throw new Error(`expected a loaded redirect, got ${loaded.status}`);
	return loaded;
}

function save(loaded: { rule: { id: string; source: string; destination: string; type: number; enabled: boolean }; revision: string },
	changes: Record<string, unknown>) {
	const { id, source, destination, type, enabled } = loaded.rule;
	return { id, revision: loaded.revision, source, destination, type, enabled, ...changes };
}

const EDITABLE_KEYS = new Set(["source", "destination", "type", "enabled", "_rev"]);

// Exact get/update shapes: the opaque revision passes through unchanged and
// only changed editable fields are sent.
{
	const fixture = publishedAccess();
	fixture.insert({ id: "01J9EDIT", source: "/a", destination: "/b", groupName: "Imported", auto: true, hits: 4 });
	const host = emdashRedirectHost(context(fixture.access))!;
	assert.ok(host.get && host.update);
	const loaded = await opened(host, "01J9EDIT");
	assert.ok(loaded.revision.startsWith("r1.") && loaded.update === "available");
	const result = await updateRedirectRule(host, save(loaded, { destination: "/c" }));
	assert.ok(result.status === "updated" && result.confirmedBy === "host");
	assert.deepEqual(fixture.calls.update, [{ id: "01J9EDIT", input: { destination: "/c", _rev: loaded.revision } }]);
	assert.notEqual(result.revision, loaded.revision);
	assert.deepEqual([result.rule.groupName, result.rule.auto, result.rule.hits], ["Imported", true, 4]);
	assert.deepEqual(fixture.calls.get, ["01J9EDIT", "01J9EDIT"], "one read to open, one before the save");

	// Public hits change activity without rotating the revision.
	const row = fixture.rows.get("01J9EDIT")!;
	row.redirect = { ...row.redirect, hits: 9, lastHitAt: "2026-10-04T13:00:00.000Z" };
	const afterHits = await updateRedirectRule(host, save({ rule: result.rule, revision: result.revision }, { type: 302 }));
	assert.ok(afterHits.status === "updated" && afterHits.rule.hits === 9);

	const off = await updateRedirectRule(host, save({ rule: afterHits.rule, revision: afterHits.revision }, { enabled: false }));
	assert.ok(off.status === "updated" && !off.rule.enabled);
	assert.deepEqual(fixture.calls.update.at(-1)!.input, { enabled: false, _rev: afterHits.revision });
	assert.ok(fixture.calls.update.every((call) => Object.keys(call.input).every((key) => EDITABLE_KEYS.has(key))),
		"group, origin and activity never reach the host update");

	await assert.rejects(host.update!("01J9EDIT", {}, off.revision), (error: unknown) =>
		error instanceof RedirectHostError && error.code === "validation");
	assert.equal(fixture.calls.update.length, 3, "an empty patch never reaches EmDash with only _rev");
}

// Capability shapes: read access opens the form read-only and cannot save.
{
	const fixture = publishedAccess();
	fixture.insert({ id: "01J9READ" });
	const readOnly = emdashRedirectHost(context({ list: fixture.access.list, get: fixture.access.get }))!;
	assert.ok(readOnly.get && !readOnly.update);
	const loaded = await opened(readOnly, "01J9READ");
	assert.equal(loaded.update, "read-only");
	const blocked = await updateRedirectRule(readOnly, save(loaded, { destination: "/c" }));
	assert.ok(blocked.status === "unavailable" && blocked.reason === "read-only");
	const listOnly = emdashRedirectHost(context({ list: fixture.access.list }))!;
	assert.equal((await loadRedirectRule(listOnly, { id: "01J9READ" }, { canManage: true })).status, "unavailable");
	const unreachable = emdashRedirectHost(context({
		list: fixture.access.list,
		get: async () => { throw new Error("SQLITE_BUSY: database is locked"); },
		update: fixture.access.update,
	}))!;
	const failed = await loadRedirectRule(unreachable, { id: "01J9READ" }, { canManage: true });
	assert.ok(failed.status === "failed" && failed.retryable, "a failed read is not reported as a missing record");
	const notSaved = await updateRedirectRule(unreachable, save(loaded, { destination: "/c" }));
	assert.ok(notSaved.status === "not-saved" && notSaved.reason === "read-failed" && notSaved.retryable);
	assert.equal(fixture.calls.update.length, 0, "a save whose first read failed never writes");
	const malformed = emdashRedirectHost(context({ list: fixture.access.list, get: async () => ({ redirect: record() }) }))!;
	const unsupported = await loadRedirectRule(malformed, { id: "01J9REDIRECT" }, { canManage: true });
	assert.ok(unsupported.status === "unsupported" && unsupported.reason === "envelope" && unsupported.rule === null);
}

// Commit, then a fault in the context's final versioned read. NOT_FOUND from
// update is not a pre-write refusal: one exact-ID read settles it.
for (const [finalRead, expected] of [
	["null", "updated"],
	["throw", "updated"],
	["malformed", "updated"],
	["deleted", "missing"],
] as const) {
	const fixture = publishedAccess({ finalRead });
	fixture.insert({ id: "01J9FAULT", source: "/a", destination: "/b", groupName: "Imported" });
	const host = emdashRedirectHost(context(fixture.access))!;
	const loaded = await opened(host, "01J9FAULT");
	const result = await updateRedirectRule(host, save(loaded, { destination: "/c" }));
	assert.equal(result.status, expected, finalRead);
	if (result.status === "updated") {
		assert.equal(result.confirmedBy, "recovery");
		assert.equal(result.rule.groupName, "Imported");
	}
	assert.deepEqual([fixture.calls.update.length, fixture.calls.get.length, fixture.calls.create], [1, 3, 0],
		`${finalRead}: one update and one recovery read; a missing rule is never recreated`);
}

// The update call fulfils but its readback cannot be parsed: the call proves
// nothing about failure, so an unchanged baseline stays uncertain and locked,
// while the recovery read still confirms the requested record or a change.
for (const [label, fulfilMalformed, check] of [
	["an unchanged baseline", { write: false },
		(result: RedirectRuleUpdateResult) => result.status === "uncertain" && result.reason === "pending"],
	["the requested record", { write: true },
		(result: RedirectRuleUpdateResult) => result.status === "updated" && result.confirmedBy === "recovery" &&
			result.rule.destination === "/c" && result.rule.groupName === "Imported"],
	["another writer's change", { write: true, otherWriter: true },
		(result: RedirectRuleUpdateResult) => result.status === "stale" && result.reason === "changed" &&
			result.current?.destination === "/theirs"],
] as const) {
	const fixture = publishedAccess({ fulfilMalformed });
	fixture.insert({ id: "01J9UNPARSED", source: "/a", destination: "/b", groupName: "Imported" });
	const host = emdashRedirectHost(context(fixture.access))!;
	const result = await updateRedirectRule(host, save(await opened(host, "01J9UNPARSED"), { destination: "/c" }));
	assert.ok(check(result), `${label}: ${result.status}`);
	assert.deepEqual([fixture.calls.update.length, fixture.calls.get.length, fixture.calls.create], [1, 3, 0],
		`${label}: one update and one recovery read, never retried or recreated`);
}

// Refusals EmDash makes before its conditional write keep their meaning.
{
	const stale = publishedAccess({
		beforeWrite: (rows) => {
			const row = rows.get("01J9RACE")!;
			rows.set("01J9RACE", { redirect: { ...row.redirect, destination: "/theirs" }, configRevision: "c-theirs" });
		},
	});
	stale.insert({ id: "01J9RACE", source: "/a", destination: "/b" });
	const staleHost = emdashRedirectHost(context(stale.access))!;
	const raced = await updateRedirectRule(staleHost, save(await opened(staleHost, "01J9RACE"), { source: "/moved" }));
	assert.ok(raced.status === "stale" && raced.reason === "revision", "a changed revision is stale, even for a source move");
	assert.equal(stale.rows.get("01J9RACE")!.redirect.destination, "/theirs");
	assert.equal(stale.calls.update.length, 1);

	const duplicate = publishedAccess({ beforeWrite: (rows) => { rows.set("01J9OTHER", { redirect: record({ id: "01J9OTHER", source: "/moved", destination: "/x" }), configRevision: "c-other" }); } });
	duplicate.insert({ id: "01J9MOVE", source: "/a", destination: "/b" });
	const duplicateHost = emdashRedirectHost(context(duplicate.access))!;
	const taken = await updateRedirectRule(duplicateHost, save(await opened(duplicateHost, "01J9MOVE"), { source: "/moved" }));
	assert.ok(taken.status === "conflict" && taken.reason === "duplicate");

	const foreign = publishedAccess({ foreignRevision: "opaque-from-elsewhere" });
	foreign.insert({ id: "01J9FOREIGN", source: "/a", destination: "/b" });
	const foreignHost = emdashRedirectHost(context(foreign.access))!;
	const precondition = await updateRedirectRule(foreignHost, save(await opened(foreignHost, "01J9FOREIGN"), { type: 302 }));
	assert.ok(precondition.status === "refused" && precondition.reason === "precondition");

	const selfLoop = publishedAccess();
	selfLoop.insert({ id: "01J9SELF", source: "/loop", destination: "/loop" });
	const selfLoopHost = emdashRedirectHost(context(selfLoop.access))!;
	const loaded = await opened(selfLoopHost, "01J9SELF");
	const notDisabled = await updateRedirectRule(selfLoopHost, save(loaded, { enabled: false }));
	assert.ok(notDisabled.status === "refused" && notDisabled.reason === "host-validation");
	assert.deepEqual(selfLoop.calls.update[0]!.input, { enabled: false, _rev: loaded.revision });

	for (const [label, error, check] of [
		["busy", accessError("REDIRECT_BUSY", "Another redirect change is in progress"),
			(result: RedirectRuleUpdateResult) => result.status === "busy"],
		["loop", accessError("VALIDATION_ERROR", "This redirect would create a loop:\n/b → /a"),
			(result: RedirectRuleUpdateResult) => result.status === "conflict" && result.reason === "loop"],
		["failed before the write", accessError("REDIRECT_UPDATE_ERROR", "Failed to update redirect"),
			(result: RedirectRuleUpdateResult) => result.status === "not-saved" && result.reason === "write-failed"],
	] as const) {
		const refusing = publishedAccess({ refuse: error });
		refusing.insert({ id: "01J9REFUSE", source: "/a", destination: "/b", enabled: false });
		const refusingHost = emdashRedirectHost(context(refusing.access))!;
		const result = await updateRedirectRule(refusingHost, save(await opened(refusingHost, "01J9REFUSE"), { destination: "/c" }));
		assert.ok(check(result), label);
		assert.equal(refusing.calls.update.length, 1, `${label} is never retried`);
	}
}

console.log("SEO redirect EmDash adapter self-check passed.");
