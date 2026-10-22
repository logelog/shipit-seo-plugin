import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SEO_ADMIN_CONTRACT_VERSION, type RedirectRule } from "../admin-contract.ts";
import type {
	RedirectEditLoadOutcome,
	RedirectEditRecoveryOutcome,
	RedirectEditSubmission,
	RedirectEditUpdateOutcome,
} from "./redirect-edit-api.ts";
import {
	REDIRECT_EDIT_DEADLINES,
	checkRedirectEdit,
	closeRedirectEdit,
	createRedirectEditStore,
	dismissRedirectEditCompletion,
	firstInvalidRedirectEditField,
	hideRedirectEdit,
	openRedirectEdit,
	redirectEditAnnouncement,
	redirectEditCanSave,
	redirectEditNeedsReview,
	redirectEditRetained,
	redirectEditUnresolved,
	redirectRowAction,
	releaseRedirectEdit,
	reloadRedirectEdit,
	rememberRedirectEditFilters,
	retryRedirectEditLoad,
	saveRedirectEdit,
	updateRedirectEditDraft,
	type RedirectEditActions,
	type RedirectEditSession,
	type RedirectEditStore,
} from "./redirect-edit-model.ts";
import type { RedirectListFilters } from "./redirect-rules-model.ts";

const version = SEO_ADMIN_CONTRACT_VERSION;
const rule: RedirectRule = {
	id: "01J9EDIT", source: "/old", destination: "/target", type: 301, enabled: true, isPattern: false,
	groupName: "Imported", auto: true, hits: 7, lastHitAt: "2026-10-04T10:00:00Z",
	createdAt: "2026-10-03T10:00:00Z", updatedAt: "2026-10-04T10:00:00Z",
};
const other: RedirectRule = { ...rule, id: "01J9OTHER", source: "/other", groupName: null, auto: false };
const fast = { loadMs: 25, saveMs: 25, checkMs: 25 };

const loaded = (value: RedirectRule, revision: string, update: "available" | "no-permission" | "read-only" = "available"): RedirectEditLoadOutcome =>
	({ contractVersion: version, status: "loaded", rule: value, revision, update });
const updated = (value: RedirectRule, revision: string, confirmedBy: "host" | "recovery" = "host"): RedirectEditUpdateOutcome =>
	({ contractVersion: version, status: "updated", rule: value, revision, confirmedBy });
const recovered = (value: RedirectRule, revision: string): RedirectEditRecoveryOutcome =>
	({ contractVersion: version, status: "updated", rule: value, revision, confirmedBy: "recovery" });
const pendingRecovery: RedirectEditRecoveryOutcome =
	{ contractVersion: version, status: "uncertain", reason: "pending", message: "EmDash still has the version you opened." };
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void }
function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
	return { promise, resolve, reject };
}

/** Every command call waits until the check settles it, so ordering is explicit. */
function harness() {
	const load: Array<{ id: string; signal: AbortSignal; reply: Deferred<RedirectEditLoadOutcome> }> = [];
	const update: Array<{ submission: RedirectEditSubmission; signal: AbortSignal; reply: Deferred<RedirectEditUpdateOutcome> }> = [];
	const reconcile: Array<{ submission: RedirectEditSubmission; signal: AbortSignal; reply: Deferred<RedirectEditRecoveryOutcome> }> = [];
	const refreshes: RedirectListFilters[] = [];
	const actions: RedirectEditActions = {
		load(id, signal) {
			const reply = deferred<RedirectEditLoadOutcome>();
			load.push({ id, signal, reply });
			return reply.promise;
		},
		update(submission, signal) {
			const reply = deferred<RedirectEditUpdateOutcome>();
			update.push({ submission, signal, reply });
			return reply.promise;
		},
		reconcile(submission, signal) {
			const reply = deferred<RedirectEditRecoveryOutcome>();
			reconcile.push({ submission, signal, reply });
			return reply.promise;
		},
		refresh(filters) {
			refreshes.push(filters);
		},
	};
	return { actions, load, update, reconcile, refreshes };
}
type Harness = ReturnType<typeof harness>;

const session = (store: RedirectEditStore): RedirectEditSession => {
	const value = store.get().session;
	assert.ok(value, "a session is open");
	return value;
};

async function openLoaded(store: RedirectEditStore, h: Harness, value: RedirectRule, revision: string) {
	const opening = openRedirectEdit(store, h.actions, value.id, fast);
	h.load.at(-1)!.reply.resolve(loaded(value, revision));
	assert.equal(await opening, "opened");
	assert.equal(session(store).phase, "editing");
}

// Opening reads the exact ID once; a confirmed save refreshes the list once,
// keeps the filters and keeps its summary after closing and unmounting.
{
	const store = createRedirectEditStore();
	const h = harness();
	const filters: RedirectListFilters = { search: "/old", status: "enabled", origin: "automatic", group: "Imported" };
	rememberRedirectEditFilters(store, filters);

	const opening = openRedirectEdit(store, h.actions, rule.id, fast);
	assert.equal(h.load.length, 1);
	assert.equal(h.load[0].id, rule.id, "the request carries the exact ID, not list-row values");
	assert.equal(session(store).phase, "loading");
	assert.equal(redirectEditCanSave(session(store)), false);
	h.load[0].reply.resolve(loaded(rule, "rev-1"));
	assert.equal(await opening, "opened");
	assert.deepEqual(session(store).draft, { source: "/old", destination: "/target", type: 301, enabled: true });
	assert.equal(session(store).loaded?.revision, "rev-1");
	assert.ok(redirectEditCanSave(session(store)));

	updateRedirectEditDraft(store, { destination: "/next", enabled: false });
	assert.deepEqual(session(store).loaded?.rule, rule, "the enabled switch stays a draft until a save is confirmed");

	let notified = 0;
	const unsubscribe = store.subscribe(() => { notified += 1; });
	const saving = saveRedirectEdit(store, h.actions, fast);
	assert.equal(session(store).phase, "saving");
	assert.equal(h.update.length, 1);
	const sent = h.update[0].submission;
	assert.deepEqual(sent.request, { id: rule.id, revision: "rev-1", source: "/old", destination: "/next", type: 301, enabled: false });
	assert.deepEqual(sent.snapshot.baseline, {
		source: "/old", destination: "/target", type: 301, enabled: true, isPattern: false, groupName: "Imported", auto: true,
	});
	assert.ok(Object.isFrozen(sent.request) && Object.isFrozen(sent.snapshot.draft), "the operation is frozen before the request");
	assert.equal(session(store).operation, sent);
	assert.ok(redirectEditUnresolved(session(store)));

	// Nothing replaces, unlocks or repeats the running save.
	updateRedirectEditDraft(store, { destination: "/changed" });
	assert.equal(session(store).draft?.destination, "/next");
	await saveRedirectEdit(store, h.actions, fast);
	assert.equal(h.update.length, 1, "a second click starts no second update");
	assert.equal(closeRedirectEdit(store), "kept");
	assert.equal(await openRedirectEdit(store, h.actions, other.id, fast), "unresolved");
	assert.equal(h.load.length, 1, "another row cannot load over the running save");
	assert.equal(session(store).id, rule.id);
	assert.equal(session(store).deferred, other.id, "the dialog can say why the other redirect did not open");
	assert.equal(redirectRowAction(rule, session(store)), "review");
	assert.equal(redirectRowAction(other, session(store)), "edit");

	// The list view leaves before the answer arrives.
	unsubscribe();
	const before = notified;
	const result = { ...rule, destination: "/next", enabled: false, hits: 9 };
	h.update[0].reply.resolve(updated(result, "rev-2"));
	await saving;
	assert.equal(notified, before, "an unmounted view is not called");
	assert.equal(session(store).phase, "saved");
	assert.deepEqual(session(store).confirmed, { rule: result, revision: "rev-2", confirmedBy: "host" });
	assert.deepEqual(h.refreshes, [filters], "one refresh with the retained filters");
	const completion = store.get().completion;
	assert.ok(completion && completion.id === rule.id && completion.rule.enabled === false,
		"the summary is kept although the rule no longer matches the enabled filter");
	assert.equal(store.get().filters, filters, "a save never resets the filters");
	assert.equal(h.reconcile.length, 0);

	assert.equal(closeRedirectEdit(store), "closed");
	assert.equal(store.get().session, null);
	assert.equal(store.get().completion, completion, "closing keeps the confirmed summary");
	rememberRedirectEditFilters(store, { ...filters, status: "all" });
	assert.equal(store.get().completion, completion);
	assert.equal(h.refreshes.length, 1, "closing or changing filters refreshes nothing more");
	dismissRedirectEditCompletion(store);
	assert.equal(store.get().completion, null);

	// A second confirmed save gets a new sequence for the list to apply once.
	await openLoaded(store, h, result, "rev-2");
	updateRedirectEditDraft(store, { enabled: true });
	const again = saveRedirectEdit(store, h.actions, fast);
	h.update[1].reply.resolve(updated({ ...result, enabled: true }, "rev-3"));
	await again;
	assert.ok(store.get().completion!.sequence > completion.sequence);
	assert.equal(h.refreshes.length, 2);
}

// No-op: the shared command reports unchanged and nothing is refreshed.
{
	const store = createRedirectEditStore();
	const h = harness();
	await openLoaded(store, h, rule, "rev-1");
	const saving = saveRedirectEdit(store, h.actions, fast);
	assert.deepEqual(h.update[0].submission.request, { id: rule.id, revision: "rev-1", source: "/old", destination: "/target", type: 301, enabled: true });
	h.update[0].reply.resolve({ contractVersion: version, status: "unchanged", rule, revision: "rev-1" });
	await saving;
	const current = session(store);
	assert.equal(current.phase, "editing");
	assert.equal(current.notice?.title, "No changes to save");
	assert.equal(current.confirmed, null);
	assert.equal(store.get().completion, null);
	assert.deepEqual(h.refreshes, []);
	assert.ok(redirectEditCanSave(current));
}

// Disable-only sends the stored legacy source unchanged; the server decides.
{
	const store = createRedirectEditStore();
	const h = harness();
	const legacy = { ...rule, source: "/Old Page/index.html?x=1" };
	await openLoaded(store, h, legacy, "rev-1");
	updateRedirectEditDraft(store, { enabled: false });
	const saving = saveRedirectEdit(store, h.actions, fast);
	assert.equal(h.update[0].submission.request.source, legacy.source, "an unchanged source is never normalized or validated here");
	assert.equal(h.update[0].submission.snapshot.baseline.source, legacy.source);
	h.update[0].reply.resolve(updated({ ...legacy, enabled: false }, "rev-2"));
	await saving;
	assert.equal(session(store).phase, "saved");
}

// Definite refusals keep the draft and allow saving again with the same revision.
{
	const store = createRedirectEditStore();
	const h = harness();
	await openLoaded(store, h, rule, "rev-1");
	updateRedirectEditDraft(store, { source: " /Typed Path ", destination: "/next" });

	let saving = saveRedirectEdit(store, h.actions, fast);
	h.update[0].reply.reject(httpError(403, "Insufficient permissions"));
	await saving;
	let current = session(store);
	assert.equal(current.phase, "editing");
	assert.equal(current.notice?.tone, "error");
	assert.match(current.notice?.message ?? "", /Insufficient permissions.*manage redirects/);
	assert.equal(current.draft?.source, " /Typed Path ", "the typed source is kept exactly");
	assert.equal(current.operation, null);
	assert.ok(redirectEditCanSave(current));
	assert.equal(h.reconcile.length, 0, "a refusal before the handler needs no check");

	saving = saveRedirectEdit(store, h.actions, fast);
	assert.equal(h.update[1].submission.request.revision, "rev-1");
	h.update[1].reply.resolve({
		contractVersion: version, status: "invalid", reason: "fields",
		errors: { source: { code: "invalid-encoding", message: "Use a valid path." } },
	});
	const attempt = store.get().attempt;
	await saving;
	current = session(store);
	assert.equal(store.get().attempt, attempt + 1, "a stopped save moves focus and is announced");
	assert.equal(current.fieldErrors.source?.code, "invalid-encoding");
	assert.equal(firstInvalidRedirectEditField(current.fieldErrors), "source");
	assert.equal(redirectEditAnnouncement(current.fieldErrors), "The change was not saved. Source path: Use a valid path.");
	assert.equal(current.draft?.source, " /Typed Path ");
	updateRedirectEditDraft(store, { source: "/typed-path" });
	assert.equal(session(store).fieldErrors.source, undefined, "typing clears that field's error");

	saving = saveRedirectEdit(store, h.actions, fast);
	h.update[2].reply.resolve({
		contractVersion: version, status: "conflict", reason: "duplicate", message: "A redirect from /typed-path already exists.", existing: other,
	});
	await saving;
	current = session(store);
	assert.equal(current.notice?.title, "A redirect for this path already exists");
	assert.equal(current.related, other);
	assert.equal(current.draft?.source, "/typed-path");

	for (const [index, outcome] of [
		{ contractVersion: version, status: "busy", message: "Another change was running.", retryable: true },
		{ contractVersion: version, status: "not-saved", reason: "write-failed", message: "EmDash did not save it.", retryable: true },
		{ contractVersion: version, status: "refused", reason: "host-validation", message: "EmDash refused it." },
	].entries()) {
		saving = saveRedirectEdit(store, h.actions, fast);
		h.update[3 + index].reply.resolve(outcome as RedirectEditUpdateOutcome);
		await saving;
		assert.equal(session(store).phase, "editing");
		assert.ok(redirectEditCanSave(session(store)), `${outcome.status} allows another save`);
		assert.equal(h.update[3 + index].submission.request.revision, "rev-1", "a retry keeps its retained revision");
	}
	assert.equal(h.reconcile.length, 0);

	saving = saveRedirectEdit(store, h.actions, fast);
	h.update[6].reply.reject(httpError(400, "Invalid input"));
	await saving;
	assert.equal(session(store).phase, "editing");

	// A draft the client cannot send is refused before any request.
	updateRedirectEditDraft(store, { destination: `/${"x".repeat(4_096)}` });
	await saveRedirectEdit(store, h.actions, fast);
	assert.equal(h.update.length, 7);
	assert.equal(session(store).fieldErrors.destination?.code, "too-long");
}

// Unknown outcomes stay locked with a check; the browser abort proves nothing.
{
	for (const [label, settleUpdate] of [
		["network", (reply: Deferred<RedirectEditUpdateOutcome>) => reply.reject(new TypeError("Failed to fetch"))],
		["server error", (reply: Deferred<RedirectEditUpdateOutcome>) => reply.reject(httpError(500, "Internal error"))],
		["unusable", (reply: Deferred<RedirectEditUpdateOutcome>) => reply.resolve({ status: "unusable", reason: "malformed" })],
		["reported", (reply: Deferred<RedirectEditUpdateOutcome>) => reply.resolve({
			contractVersion: version, status: "uncertain", reason: "unreadable", message: "This plugin could not read it back.",
		})],
	] as const) {
		const store = createRedirectEditStore();
		const h = harness();
		await openLoaded(store, h, rule, "rev-1");
		updateRedirectEditDraft(store, { type: 302 });
		const saving = saveRedirectEdit(store, h.actions, fast);
		settleUpdate(h.update[0].reply);
		await saving;
		assert.equal(session(store).phase, "uncertain", label);
		assert.equal(session(store).operation, h.update[0].submission, `${label} keeps the frozen operation`);
		assert.equal(redirectEditCanSave(session(store)), false);
		assert.equal(session(store).notice?.coreAdmin, true);
	}
	const store = createRedirectEditStore();
	const h = harness();
	await openLoaded(store, h, rule, "rev-1");
	const saving = saveRedirectEdit(store, h.actions, fast);
	h.update[0].reply.resolve({ status: "unusable", reason: "request" });
	await saving;
	assert.equal(session(store).phase, "editing", "a request refused before sending proves nothing was written");
}

// Timeout, recovery seeing the baseline while the write may run, then the
// changed version confirmed by one recovery read. No write is replayed.
{
	const store = createRedirectEditStore();
	const h = harness();
	await openLoaded(store, h, rule, "rev-1");
	updateRedirectEditDraft(store, { destination: "/next", type: 302 });
	await saveRedirectEdit(store, h.actions, fast);
	assert.equal(session(store).phase, "uncertain", "the save deadline leaves the outcome unknown");
	assert.equal(h.update[0].signal.aborted, true, "the request was told to stop");
	assert.match(session(store).notice?.message ?? "", /Check the saved redirect/);
	const operation = session(store).operation!;

	// The original answer arrives after the deadline and is not trusted.
	h.update[0].reply.resolve(updated({ ...rule, destination: "/next", type: 302 }, "rev-2"));
	await Promise.resolve();
	assert.equal(session(store).phase, "uncertain");
	assert.equal(store.get().completion, null);

	let checking = checkRedirectEdit(store, h.actions, fast);
	assert.equal(session(store).phase, "checking");
	assert.equal(h.reconcile[0].submission, operation, "recovery sends the same snapshot");
	assert.equal(closeRedirectEdit(store), "kept");
	h.reconcile[0].reply.resolve(pendingRecovery);
	await checking;
	assert.equal(session(store).phase, "uncertain", "the baseline while the write may run stays locked");
	assert.equal(session(store).loaded?.revision, "rev-1");
	assert.equal(redirectEditCanSave(session(store)), false);
	assert.equal(await openRedirectEdit(store, h.actions, rule.id, fast), "unresolved",
		"reopening the same row does not load over the unresolved save");
	assert.equal(h.load.length, 1);

	// A check that never answers ends at its own deadline; its late answer is ignored.
	await checkRedirectEdit(store, h.actions, fast);
	assert.equal(session(store).phase, "uncertain");
	assert.equal(h.reconcile[1].signal.aborted, true);
	h.reconcile[1].reply.resolve(recovered({ ...rule, destination: "/next", type: 302 }, "rev-2"));
	await Promise.resolve();
	assert.equal(session(store).phase, "uncertain");

	checking = checkRedirectEdit(store, h.actions, fast);
	const current = { ...rule, destination: "/next", type: 302, hits: 12 };
	h.reconcile[2].reply.resolve(recovered(current, "rev-2"));
	await checking;
	assert.equal(session(store).phase, "saved");
	assert.deepEqual(session(store).confirmed, { rule: current, revision: "rev-2", confirmedBy: "recovery" });
	assert.equal(store.get().completion?.confirmedBy, "recovery");
	assert.equal(h.refreshes.length, 1);
	assert.equal(h.update.length, 1, "recovery never replays the write");
	assert.equal(h.reconcile.length, 3);
}

// Recovery that sees another version, a missing record or refused fields settles the lock.
{
	const cases: Array<[RedirectEditRecoveryOutcome, string]> = [
		[{ contractVersion: version, status: "stale", reason: "changed", message: "EmDash has another version.", current: { ...rule, destination: "/theirs" } }, "stale"],
		[{ contractVersion: version, status: "missing", message: "EmDash no longer has this redirect." }, "blocked"],
		[{ contractVersion: version, status: "invalid", reason: "fields", errors: { destination: { code: "same-address", message: "Loops." } } }, "editing"],
		[{ contractVersion: version, status: "invalid", reason: "input", message: "Unreadable." }, "uncertain"],
		[{ contractVersion: version, status: "unavailable", reason: "no-access", message: "No access." }, "uncertain"],
		[{ status: "unusable", reason: "version" }, "uncertain"],
	];
	for (const [outcome, phase] of cases) {
		const store = createRedirectEditStore();
		const h = harness();
		await openLoaded(store, h, rule, "rev-1");
		updateRedirectEditDraft(store, { destination: "/mine" });
		const saving = saveRedirectEdit(store, h.actions, fast);
		h.update[0].reply.reject(new TypeError("Failed to fetch"));
		await saving;
		const checking = checkRedirectEdit(store, h.actions, fast);
		h.reconcile[0].reply.resolve(outcome);
		await checking;
		assert.equal(session(store).phase, phase, `${outcome.status} after recovery`);
		assert.equal(session(store).draft?.destination, "/mine");
		assert.equal(h.update.length, 1);
		assert.equal(h.refreshes.length, 0);
		if (phase === "blocked") {
			assert.equal(closeRedirectEdit(store), "closed", "a missing record is never recreated and ends the session");
		}
	}
	const store = createRedirectEditStore();
	const h = harness();
	await openLoaded(store, h, rule, "rev-1");
	const saving = saveRedirectEdit(store, h.actions, fast);
	h.update[0].reply.reject(new TypeError("Failed to fetch"));
	await saving;
	const checking = checkRedirectEdit(store, h.actions, fast);
	h.reconcile[0].reply.reject(httpError(403, "Insufficient permissions"));
	await checking;
	assert.equal(session(store).phase, "uncertain", "a refused check says nothing about the write");
	assert.match(session(store).notice?.message ?? "", /^EmDash refused the check for this sign-in/, "a refusal is not reported as unreachable");
	const again = checkRedirectEdit(store, h.actions, fast);
	h.reconcile[1].reply.reject(httpError(400, "Invalid input"));
	await again;
	assert.match(session(store).notice?.message ?? "", /^EmDash refused the check request/);
	const unreachable = checkRedirectEdit(store, h.actions, fast);
	h.reconcile[2].reply.reject(new TypeError("Failed to fetch"));
	await unreachable;
	assert.match(session(store).notice?.message ?? "", /^The check could not reach EmDash/);
	assert.equal(h.update.length, 1);
}

// Stale: an explicit exact-ID reload reviews the current version and keeps the draft.
{
	const store = createRedirectEditStore();
	const h = harness();
	await openLoaded(store, h, rule, "rev-1");
	updateRedirectEditDraft(store, { destination: "/mine" });
	let saving = saveRedirectEdit(store, h.actions, fast);
	const theirs = { ...rule, destination: "/theirs", hits: 8 };
	h.update[0].reply.resolve({ contractVersion: version, status: "stale", reason: "revision", message: "This redirect changed.", current: theirs });
	await saving;
	assert.equal(session(store).phase, "stale");
	assert.equal(session(store).related, theirs);
	assert.equal(session(store).draft?.destination, "/mine");
	assert.equal(redirectEditCanSave(session(store)), false);
	assert.equal(h.load.length, 1, "no new revision is fetched automatically");
	updateRedirectEditDraft(store, { destination: "/ignored" });
	assert.equal(session(store).draft?.destination, "/mine");
	await saveRedirectEdit(store, h.actions, fast);
	assert.equal(h.update.length, 1, "a stale form cannot be saved before review");

	// A failed reload returns to review; the draft stays.
	let reloading = reloadRedirectEdit(store, h.actions, fast);
	assert.equal(session(store).phase, "reloading");
	assert.equal(h.load[1].id, rule.id);
	h.load[1].reply.resolve({ contractVersion: version, status: "failed", message: "Try again.", retryable: true });
	await reloading;
	assert.equal(session(store).phase, "stale");
	assert.equal(session(store).draft?.destination, "/mine");

	reloading = reloadRedirectEdit(store, h.actions, fast);
	h.load[2].reply.resolve(loaded(theirs, "rev-5"));
	await reloading;
	const current = session(store);
	assert.equal(current.phase, "editing");
	assert.equal(current.loaded?.revision, "rev-5");
	assert.deepEqual(current.loaded?.rule, theirs);
	assert.equal(current.draft?.destination, "/mine", "the draft survives the review reload");
	assert.equal(current.notice?.title, "Review the current settings");

	saving = saveRedirectEdit(store, h.actions, fast);
	assert.equal(h.update[1].submission.request.revision, "rev-5");
	assert.equal(h.update[1].submission.snapshot.baseline.destination, "/theirs");
	h.update[1].reply.resolve({ contractVersion: version, status: "refused", reason: "precondition", message: "Reload first." });
	await saving;
	assert.equal(session(store).phase, "stale", "a precondition refusal also needs an explicit reload");
	assert.equal(session(store).notice?.title, "EmDash did not accept this version", "it does not claim the record changed");
	assert.equal(h.load.length, 3);
}

// Missing, unsupported and read-only records cannot be saved here.
{
	let store = createRedirectEditStore();
	let h = harness();
	let opening = openRedirectEdit(store, h.actions, rule.id, fast);
	h.load[0].reply.resolve({ contractVersion: version, status: "missing", message: "EmDash has no redirect with this ID." });
	await opening;
	assert.equal(session(store).phase, "blocked");
	assert.equal(session(store).notice?.coreAdmin, true);
	assert.equal(redirectEditCanSave(session(store)), false);

	opening = openRedirectEdit(store, h.actions, rule.id, fast);
	const pattern = { ...rule, isPattern: true };
	h.load[1].reply.resolve({ contractVersion: version, status: "unsupported", reason: "pattern", rule: pattern, message: "Edit pattern redirects in EmDash Redirects." });
	await opening;
	assert.equal(session(store).phase, "blocked");
	assert.equal(session(store).related, pattern);

	for (const access of ["no-permission", "read-only"] as const) {
		opening = openRedirectEdit(store, h.actions, rule.id, fast);
		h.load.at(-1)!.reply.resolve(loaded(rule, "rev-1", access));
		await opening;
		assert.equal(session(store).phase, "editing");
		assert.equal(redirectEditCanSave(session(store)), false, access);
		updateRedirectEditDraft(store, { enabled: false });
		assert.equal(session(store).draft?.enabled, true);
		await saveRedirectEdit(store, h.actions, fast);
		assert.equal(h.update.length, 0);
	}

	store = createRedirectEditStore();
	h = harness();
	await openLoaded(store, h, rule, "rev-1");
	let saving = saveRedirectEdit(store, h.actions, fast);
	h.update[0].reply.resolve({ contractVersion: version, status: "missing", message: "EmDash has no redirect with this ID." });
	await saving;
	assert.equal(session(store).phase, "blocked", "a record missing before the write ends the session");
	assert.equal(h.reconcile.length, 0);

	await openLoaded(store, h, rule, "rev-1");
	saving = saveRedirectEdit(store, h.actions, fast);
	h.update[1].reply.resolve({ contractVersion: version, status: "unavailable", reason: "read-only", message: "Read only." });
	await saving;
	assert.equal(session(store).loaded?.access, "read-only");
	assert.equal(redirectEditCanSave(session(store)), false);

	opening = openRedirectEdit(store, h.actions, rule.id, fast);
	h.load.at(-1)!.reply.reject(httpError(403, "Insufficient permissions"));
	await opening;
	assert.equal(session(store).phase, "blocked");
	assert.equal(session(store).notice?.title, "You cannot view this redirect");
}

// Request identity: a response for an earlier selection or request is ignored.
{
	const store = createRedirectEditStore();
	const h = harness();
	const first = openRedirectEdit(store, h.actions, rule.id, fast);
	assert.equal(closeRedirectEdit(store), "closed");
	const second = openRedirectEdit(store, h.actions, other.id, fast);
	h.load[0].reply.resolve(loaded(rule, "rev-1"));
	await first;
	assert.equal(session(store).id, other.id);
	assert.equal(session(store).phase, "loading", "the closed selection's answer is ignored");
	const third = openRedirectEdit(store, h.actions, rule.id, fast);
	h.load[1].reply.resolve(loaded(other, "rev-9"));
	await second;
	assert.equal(session(store).id, rule.id);
	assert.equal(session(store).loaded, null, "a replaced selection's answer is ignored");
	h.load[2].reply.resolve(loaded(rule, "rev-1"));
	await third;
	assert.equal(session(store).loaded?.rule.id, rule.id);

	// A load that times out can be retried; its late answer is ignored.
	const slow = openRedirectEdit(store, h.actions, other.id, fast);
	await slow;
	assert.equal(session(store).phase, "load-failed");
	assert.equal(h.load[3].signal.aborted, true);
	h.load[3].reply.resolve(loaded(other, "rev-old"));
	await Promise.resolve();
	assert.equal(session(store).phase, "load-failed");
	const retry = retryRedirectEditLoad(store, h.actions, fast);
	assert.equal(h.load[4].id, other.id);
	h.load[4].reply.resolve({ status: "unusable", reason: "identity" });
	await retry;
	assert.equal(session(store).phase, "load-failed", "an answer for another ID is never used");
	const retried = retryRedirectEditLoad(store, h.actions, fast);
	h.load[5].reply.resolve(loaded(other, "rev-9"));
	await retried;
	assert.equal(session(store).loaded?.revision, "rev-9");

	// A save answer that arrives after the dialog closed and finished closing
	// applies once to that same session; only then does a reopen read again.
	const view = createRedirectEditStore();
	const v = harness();
	await openLoaded(view, v, rule, "rev-1");
	updateRedirectEditDraft(view, { destination: "/next" });
	const saving = saveRedirectEdit(view, v.actions, fast);
	const token = session(view).token;
	assert.equal(hideRedirectEdit(view), "hidden");
	releaseRedirectEdit(view);
	assert.equal(session(view).phase, "saving", "the end of the close animation does not end a pending save");
	assert.equal(await openRedirectEdit(view, v.actions, other.id, fast), "unresolved");
	assert.equal(hideRedirectEdit(view), "hidden");
	v.update[0].reply.resolve(updated({ ...rule, destination: "/next" }, "rev-2"));
	await saving;
	assert.equal(session(view).token, token);
	assert.equal(session(view).phase, "saved");
	assert.equal(view.get().completion?.id, rule.id);
	assert.equal(v.refreshes.length, 1);
	assert.equal(redirectEditNeedsReview(session(view)), false, "the list summary reports a confirmed save");
	assert.equal(redirectRowAction(rule, session(view)), "edit");
	const reopened = openRedirectEdit(view, v.actions, rule.id, fast);
	assert.equal(v.load.length, 2);
	v.load[1].reply.resolve(loaded({ ...rule, destination: "/next" }, "rev-2"));
	assert.equal(await reopened, "opened");
	assert.equal(session(view).loaded?.revision, "rev-2");
	assert.equal(v.update.length, 1);
	assert.equal(v.refreshes.length, 1);
}

// A definite answer that arrives after the dialog closed or the list
// unmounted is kept with its draft until reviewed. Reopening shows it as it
// is, with no read, and nothing is retried or written.
{
	const theirs = { ...rule, destination: "/theirs", hits: 8 };
	const outcomes: Array<[string, RedirectEditUpdateOutcome, RedirectEditSession["phase"]]> = [
		["conflict", { contractVersion: version, status: "conflict", reason: "duplicate", message: "A redirect from /old already exists.", existing: other }, "editing"],
		["stale", { contractVersion: version, status: "stale", reason: "revision", message: "This redirect changed.", current: theirs }, "stale"],
		["precondition", { contractVersion: version, status: "refused", reason: "precondition", message: "Reload first." }, "stale"],
		["host refusal", { contractVersion: version, status: "refused", reason: "host-validation", message: "EmDash refused it." }, "editing"],
		["field error", { contractVersion: version, status: "invalid", reason: "fields", errors: { destination: { code: "same-address", message: "Loops." } } }, "editing"],
		["not saved", { contractVersion: version, status: "not-saved", reason: "write-failed", message: "EmDash did not save it.", retryable: true }, "editing"],
	];
	for (const [label, outcome, phase] of outcomes) {
		for (const leave of ["dialog", "unmount"] as const) {
			const store = createRedirectEditStore();
			const h = harness();
			await openLoaded(store, h, rule, "rev-1");
			updateRedirectEditDraft(store, { destination: "/mine" });
			const saving = saveRedirectEdit(store, h.actions, fast);
			if (leave === "dialog") {
				assert.equal(hideRedirectEdit(store), "hidden");
				releaseRedirectEdit(store);
			} else {
				assert.equal(closeRedirectEdit(store), "kept");
			}
			h.update[0].reply.resolve(outcome);
			await saving;
			const kept = session(store);
			const name = `${label} after ${leave}`;
			assert.equal(kept.phase, phase, name);
			assert.equal(kept.draft?.destination, "/mine", `${name} keeps the draft`);
			assert.ok(redirectEditRetained(kept) && redirectEditNeedsReview(kept), name);
			assert.equal(redirectRowAction(rule, kept), "review", `${name} stays reachable from its row`);
			releaseRedirectEdit(store);
			assert.equal(closeRedirectEdit(store), "kept", `${name} survives a late close animation and unmounting`);
			assert.equal(session(store), kept);

			assert.equal(await openRedirectEdit(store, h.actions, rule.id, fast), "retained");
			const shown = session(store);
			assert.equal(h.load.length, 1, `${name} reopens without a load`);
			assert.equal(shown.visibility, "shown");
			assert.equal(shown.deferred, null);
			assert.deepEqual([shown.phase, shown.notice, shown.fieldErrors, shown.related, shown.draft],
				[kept.phase, kept.notice, kept.fieldErrors, kept.related, kept.draft], `${name} is shown as it was kept`);
			assert.equal(redirectEditCanSave(shown), phase === "editing", `${name} allows the retry its result permits`);
			assert.deepEqual([h.update.length, h.reconcile.length, h.refreshes.length], [1, 0, 0], `${name} retries and writes nothing`);

			// Once seen, closing ends it after the dialog has closed.
			assert.equal(hideRedirectEdit(store), "dismissed");
			assert.ok(store.get().session, "the dialog keeps its content while it closes");
			releaseRedirectEdit(store);
			assert.equal(store.get().session, null);
		}
	}

	// Another row shows the kept result first, without a read; once that
	// result has been seen and closed, the other redirect opens normally.
	const store = createRedirectEditStore();
	const h = harness();
	await openLoaded(store, h, rule, "rev-1");
	updateRedirectEditDraft(store, { destination: "/mine" });
	const saving = saveRedirectEdit(store, h.actions, fast);
	assert.equal(hideRedirectEdit(store), "hidden");
	h.update[0].reply.resolve({ contractVersion: version, status: "busy", message: "Another change was running.", retryable: true });
	await saving;
	assert.equal(await openRedirectEdit(store, h.actions, other.id, fast), "retained");
	assert.equal(session(store).id, rule.id);
	assert.equal(session(store).deferred, other.id, "the dialog says why the other redirect did not open");
	assert.equal(session(store).draft?.destination, "/mine");
	assert.equal(h.load.length, 1);
	assert.equal(hideRedirectEdit(store), "dismissed");
	releaseRedirectEdit(store);
	const opening = openRedirectEdit(store, h.actions, other.id, fast);
	assert.equal(h.load[1].id, other.id);
	h.load[1].reply.resolve(loaded(other, "rev-9"));
	assert.equal(await opening, "opened");
	assert.equal(h.update.length, 1);
}

// The same holds for a pending check, and a kept stale result is reviewed
// by an explicit exact-ID reload that preserves the draft.
{
	for (const [label, outcome, phase] of [
		["stale", { contractVersion: version, status: "stale", reason: "changed", message: "EmDash has another version.", current: { ...rule, destination: "/theirs" } }, "stale"],
		["field error", { contractVersion: version, status: "invalid", reason: "fields", errors: { source: { code: "stored-path", message: "Retype this source." } } }, "editing"],
		["missing", { contractVersion: version, status: "missing", message: "EmDash no longer has this redirect." }, "blocked"],
	] as const) {
		const store = createRedirectEditStore();
		const h = harness();
		await openLoaded(store, h, rule, "rev-1");
		updateRedirectEditDraft(store, { destination: "/mine" });
		const saving = saveRedirectEdit(store, h.actions, fast);
		h.update[0].reply.reject(new TypeError("Failed to fetch"));
		await saving;
		const checking = checkRedirectEdit(store, h.actions, fast);
		assert.equal(closeRedirectEdit(store), "kept", "unmounting during a check keeps it");
		h.reconcile[0].reply.resolve(outcome as RedirectEditRecoveryOutcome);
		await checking;
		assert.equal(session(store).phase, phase, label);
		assert.ok(redirectEditRetained(session(store)), label);
		assert.equal(await openRedirectEdit(store, h.actions, rule.id, fast), "retained");
		assert.equal(h.load.length, 1);
		assert.equal(session(store).draft?.destination, "/mine");
	}

	const store = createRedirectEditStore();
	const h = harness();
	await openLoaded(store, h, rule, "rev-1");
	updateRedirectEditDraft(store, { destination: "/mine" });
	const saving = saveRedirectEdit(store, h.actions, fast);
	assert.equal(hideRedirectEdit(store), "hidden");
	const theirs = { ...rule, destination: "/theirs" };
	h.update[0].reply.resolve({ contractVersion: version, status: "stale", reason: "revision", message: "This redirect changed.", current: theirs });
	await saving;
	assert.equal(await openRedirectEdit(store, h.actions, rule.id, fast), "retained");
	assert.equal(session(store).phase, "stale");
	assert.equal(h.load.length, 1, "no new revision is fetched without the explicit reload");
	const reloading = reloadRedirectEdit(store, h.actions, fast);
	assert.equal(h.load.length, 2);
	assert.equal(h.load[1].id, rule.id);
	h.load[1].reply.resolve(loaded(theirs, "rev-5"));
	await reloading;
	assert.equal(session(store).phase, "editing");
	assert.equal(session(store).loaded?.revision, "rev-5");
	assert.equal(session(store).draft?.destination, "/mine", "the reviewed reload keeps the draft");
	assert.equal(h.update.length, 1);
}

// Filters changed while a save runs, even after the list unmounted, are the
// ones refreshed when it settles.
{
	const store = createRedirectEditStore();
	const h = harness();
	const before: RedirectListFilters = { search: "", status: "all", origin: "all", group: null };
	const after: RedirectListFilters = { search: "/old", status: "disabled", origin: "manual", group: "Imported" };
	rememberRedirectEditFilters(store, before);
	await openLoaded(store, h, rule, "rev-1");
	updateRedirectEditDraft(store, { enabled: false });
	const saving = saveRedirectEdit(store, h.actions, fast);
	rememberRedirectEditFilters(store, after);
	assert.equal(closeRedirectEdit(store), "kept");
	h.update[0].reply.resolve(updated({ ...rule, enabled: false }, "rev-2"));
	await saving;
	assert.equal(h.refreshes.length, 1);
	assert.equal(h.refreshes[0], after, "the filters applied when the save settles are refreshed");
	assert.equal(store.get().filters, after);
	assert.equal(store.get().completion?.rule.enabled, false);
}

// Each identical refusal counts as a new stopped save, so it is announced again.
{
	const store = createRedirectEditStore();
	const h = harness();
	await openLoaded(store, h, rule, "rev-1");
	updateRedirectEditDraft(store, { source: "/same" });
	const start = store.get().attempt;
	for (const round of [1, 2]) {
		const saving = saveRedirectEdit(store, h.actions, fast);
		h.update[round - 1].reply.resolve({
			contractVersion: version, status: "invalid", reason: "fields",
			errors: { source: { code: "same-address", message: "Loops." } },
		});
		await saving;
		assert.equal(store.get().attempt, start + round);
		assert.equal(redirectEditAnnouncement(session(store).fieldErrors), "The change was not saved. Source path: Loops.");
	}
	updateRedirectEditDraft(store, { source: "/fixed" });
	assert.equal(redirectEditAnnouncement(session(store).fieldErrors), "", "fixing the field leaves nothing to announce");
}

// Both paths empty, then only Source path fixed: the error set changes, so
// the text announced for the stopped save no longer describes it. The view
// shows its alert only while that text matches the current errors.
{
	const store = createRedirectEditStore();
	const h = harness();
	await openLoaded(store, h, rule, "rev-1");
	updateRedirectEditDraft(store, { source: "", destination: "" });
	const saving = saveRedirectEdit(store, h.actions, fast);
	h.update[0].reply.resolve({
		contractVersion: version, status: "invalid", reason: "fields",
		errors: {
			source: { code: "required", message: "Enter the source path." },
			destination: { code: "required", message: "Enter the destination path." },
		},
	});
	await saving;
	const announced = redirectEditAnnouncement(session(store).fieldErrors);
	assert.equal(announced, "The change was not saved. Source path: Enter the source path. Destination path: Enter the destination path.");
	updateRedirectEditDraft(store, { source: "/old" });
	const current = redirectEditAnnouncement(session(store).fieldErrors);
	assert.equal(session(store).fieldErrors.destination?.code, "required", "the other field stays invalid");
	assert.notEqual(current, announced, "the stopped save's text is stale once one field is fixed");
	assert.doesNotMatch(current, /Source path/);
	const view = readFileSync(new URL("./redirect-rules-view.tsx", import.meta.url), "utf8");
	assert.match(view, /const shownAnnouncement = announcement\.token === token && announcement\.text === redirectEditAnnouncement\(fieldErrors\)/,
		"the alert is bound to this session's current errors, not to any remaining error");
	assert.match(view, /<p className="sr-only" role="alert">\{shownAnnouncement\}<\/p>/);
}

// The shipped deadlines: 15 seconds to load, reload or check, 20 seconds to
// save. The timer is replaced for this block so each deadline fires by hand.
{
	const delays: number[] = [];
	const timers: Array<() => void> = [];
	const realSetTimeout = globalThis.setTimeout;
	const realClearTimeout = globalThis.clearTimeout;
	globalThis.setTimeout = ((callback: () => void, ms?: number) => {
		delays.push(ms ?? 0);
		timers.push(callback);
		return timers.length;
	}) as unknown as typeof setTimeout;
	globalThis.clearTimeout = (() => {}) as typeof clearTimeout;
	try {
		assert.deepEqual({ ...REDIRECT_EDIT_DEADLINES }, { loadMs: 15_000, saveMs: 20_000, checkMs: 15_000 });
		const store = createRedirectEditStore();
		const h = harness();

		const opening = openRedirectEdit(store, h.actions, rule.id);
		assert.deepEqual(delays, [15_000], "opening waits 15 seconds");
		timers[0]();
		await opening;
		assert.equal(session(store).phase, "load-failed");
		assert.equal(h.load[0].signal.aborted, true);

		const retry = retryRedirectEditLoad(store, h.actions);
		assert.equal(delays[1], 15_000);
		h.load[1].reply.resolve(loaded(rule, "rev-1"));
		await retry;
		updateRedirectEditDraft(store, { destination: "/next" });

		const saving = saveRedirectEdit(store, h.actions);
		assert.equal(delays[2], 20_000, "a save waits 20 seconds");
		timers[2]();
		await saving;
		assert.equal(session(store).phase, "uncertain", "the save deadline leaves the outcome unknown");
		assert.equal(h.update[0].signal.aborted, true);

		let checking = checkRedirectEdit(store, h.actions);
		assert.equal(delays[3], 15_000, "a check waits 15 seconds");
		timers[3]();
		await checking;
		assert.equal(session(store).phase, "uncertain");

		checking = checkRedirectEdit(store, h.actions);
		assert.equal(delays[4], 15_000);
		h.reconcile[1].reply.resolve({
			contractVersion: version, status: "stale", reason: "changed", message: "EmDash has another version.", current: { ...rule, destination: "/theirs" },
		});
		await checking;
		const reloading = reloadRedirectEdit(store, h.actions);
		assert.equal(delays[5], 15_000, "a review reload waits 15 seconds");
		timers[5]();
		await reloading;
		assert.equal(session(store).phase, "stale");
		assert.equal(session(store).draft?.destination, "/next");
		assert.deepEqual([h.update.length, delays.length], [1, 6]);
	} finally {
		globalThis.setTimeout = realSetTimeout;
		globalThis.clearTimeout = realClearTimeout;
	}
}

// Row actions are guidance; the commands still decide.
{
	assert.equal(redirectRowAction(rule, null), "edit");
	assert.equal(redirectRowAction({ ...rule, enabled: false }, null), "edit");
	assert.equal(redirectRowAction({ ...rule, isPattern: true }, null), "core");
	assert.equal(redirectRowAction({ ...rule, type: 308 }, null), "core");
	assert.equal(redirectRowAction({ ...rule, source: "/".repeat(2_049) }, null), "core");
}

// The renderer sequences commands only; it neither validates edits nor writes elsewhere.
{
	const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
	const model = read("./redirect-edit-model.ts");
	const view = read("./redirect-rules-view.tsx");
	assert.doesNotMatch(model, /validateRedirectRuleDraft|normalizePath|apiFetch|fetch\(/, "no create validator or direct request in the edit model");
	const editStart = view.indexOf("function RuleRecord(");
	const editEnd = view.indexOf("export function RedirectRulesView(");
	const wiringStart = view.indexOf("const editActions");
	const wiringEnd = view.indexOf("const editUnresolved");
	assert.ok(editStart > 0 && editEnd > editStart && wiringStart > editEnd && wiringEnd > wiringStart, "the edit sections of the view were found");
	for (const part of [view.slice(editStart, editEnd), view.slice(wiringStart, wiringEnd)]) {
		assert.doesNotMatch(part, /validateRedirectRuleDraft|normalizePath/, "the edit dialog and its commands never use the create validator");
	}
	assert.match(view.slice(0, editStart), /validateRedirectRuleDraft\(draft\)/, "control: the same search finds the create form's validator");
	assert.match(view, /aria-label=\{review \? `Review change: the redirect from \$\{rule\.source\}`/, "the accessible name contains the visible label");
	assert.match(view, /aria-label=\{`Edit in EmDash: the redirect from \$\{rule\.source\}`\}/, "the accessible name contains the visible label");
	assert.match(view, /^const redirectEditStore = createRedirectEditStore\(\);$/m, "the edit store lives outside the components");
	assert.doesNotMatch(view, /method:\s*"PUT"|\/_emdash\/api\/redirects/, "no core REST write");
	assert.doesNotMatch(view, /setInterval|refetchInterval/, "no polling");
	const firstCell = view.indexOf("<RowEditAction");
	assert.ok(firstCell > 0 && firstCell < view.indexOf("shipit-seo-redirect-rules__destination\">"),
		"the edit action sits in the source cell that stays visible at narrow widths");
	assert.match(view, /onOpenChangeComplete=/, "focus returns after the dialog has closed");
	assert.match(view, /if \(!next\) hideRedirectEdit\(redirectEditStore\);/, "hiding is decided at close intent");
	assert.match(view, /phase === "editing" \? "Saved in EmDash" : "Version you opened"/,
		"a pending or stale baseline is not presented as what EmDash has");
}

console.log("Redirect edit session model self-check passed.");
