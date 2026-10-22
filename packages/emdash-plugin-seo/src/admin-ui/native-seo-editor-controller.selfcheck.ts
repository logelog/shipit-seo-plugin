import assert from "node:assert/strict";
import type { UpdateContentInput } from "@emdash-cms/admin";

import {
	createNativeSeoEditorController,
	NATIVE_SEO_REQUEST_DEADLINE_MS,
	type NativeSeoEditorClock,
	type NativeSeoEditorControllerDependencies,
} from "./native-seo-editor-controller.ts";
import type { NativeSeoSnapshot, NativeSeoTarget } from "./native-seo-editor-state.ts";

class ControlledApiResponseError extends Error {
	status: number;
	code: string;
	details?: Record<string, unknown>;
	constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
		super(message); this.name = "ApiResponseError"; this.status = status; this.code = code; this.details = details;
	}
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}
function controlledClock() {
	let time = 0;
	let counter = 0;
	const pending = new Map<number, { at: number; callback: () => void }>();
	const clock: NativeSeoEditorClock = {
		now: () => time,
		setTimeout(callback, milliseconds) {
			const handle = ++counter;
			pending.set(handle, { at: time + milliseconds, callback });
			return handle;
		},
		clearTimeout(handle) { pending.delete(handle as number); },
	};
	return {
		clock,
		pending: () => pending.size,
		nextDeadline: () => Math.min(...[...pending.values()].map((timer) => timer.at)),
		advance(milliseconds: number) {
			time += milliseconds;
			for (;;) {
				const next = [...pending.entries()].filter(([, timer]) => timer.at <= time).sort((a, b) => a[1].at - b[1].at)[0];
				if (!next) break;
				pending.delete(next[0]);
				next[1].callback();
			}
		},
	};
}
async function flush() { for (let count = 0; count < 12; count++) await Promise.resolve(); }
const target: NativeSeoTarget = {
	principal: { id: "synthetic-editor", role: 40 }, collection: "posts", entryId: "entry-a", locale: "nl",
};
const values = { title: "Native title", description: "Native description", image: "/_emdash/api/media/file/a.jpg" };
function item(revision = "opaque-a", title = values.title, entryId = target.entryId, locale = target.locale) {
	return { id: entryId, type: "posts", locale, _rev: revision,
		seo: { ...values, title, canonical: "https://example.invalid/kept", noIndex: true },
		data: { title: "Unrelated content title", content: "Retained body" } };
}
function fixture() {
	const time = controlledClock();
	let current: unknown = item();
	let reading: (() => Promise<unknown>) | null = null;
	let writing: (() => Promise<unknown>) | null = null;
	const reads: Array<{ collection: string; id: string; options: { locale?: string } | undefined }> = [];
	const writes: Array<{ collection: string; id: string; input: UpdateContentInput; options: { locale?: string } | undefined }> = [];
	const confirmed: NativeSeoSnapshot[] = [];
	const dependencies: NativeSeoEditorControllerDependencies = {
		clock: time.clock,
		ApiResponseError: ControlledApiResponseError,
		async fetchContent(collection, id, options) {
			reads.push({ collection, id, options });
			return reading ? reading() : current;
		},
		async updateContent(collection, id, input, options) {
			writes.push({ collection, id, input, options });
			if (writing) return writing();
			current = { ...item("opaque-b"), seo: { ...item().seo, ...input.seo } };
			return current;
		},
	};
	const controller = createNativeSeoEditorController(target, dependencies, (snapshot) => { confirmed.push(snapshot); });
	return { time, reads, writes, confirmed, dependencies, controller,
		setCurrent(next: unknown) { current = next; },
		setRead(next: (() => Promise<unknown>) | null) { reading = next; },
		setWrite(next: (() => Promise<unknown>) | null) { writing = next; } };
}

// Creation and local changes have no API effects; one explicit read owns its deadline.
const basic = fixture();
assert.equal(basic.controller.getSnapshot().phase, "unknown");
assert.equal(basic.reads.length, 0);
assert.equal(basic.writes.length, 0);
let notifications = 0;
const unsubscribe = basic.controller.subscribe(() => { notifications++; });
const baseRead = deferred<unknown>();
basic.setRead(() => baseRead.promise);
const opening = basic.controller.read();
assert.equal(basic.reads.length, 1);
assert.ok(basic.controller.getSnapshot().readback);
assert.equal(basic.time.pending(), 1);
await basic.controller.read();
await basic.controller.save();
assert.equal(basic.reads.length, 1);
assert.equal(basic.writes.length, 0);
baseRead.resolve(item());
await opening;
assert.equal(basic.controller.getSnapshot().phase, "idle");
assert.equal(basic.time.pending(), 0);
assert.equal(basic.confirmed.length, 0, "loading saved fields is not a save confirmation");
basic.setRead(null);
basic.controller.change({ title: "New native title" });
assert.equal(basic.controller.getSnapshot().phase, "editing");
assert.equal(basic.writes.length, 0);
await basic.controller.save();
assert.equal(basic.writes.length, 1);
assert.equal(basic.reads.length, 2, "an acknowledgement has exactly one mandatory independent readback");
assert.deepEqual(basic.writes[0], { collection: "posts", id: "entry-a", input: { seo: { title: "New native title" }, _rev: "opaque-a" }, options: { locale: "nl" } });
assert.equal(basic.controller.getSnapshot().phase, "confirmed");
assert.equal(basic.confirmed.length, 1);
assert.equal(basic.confirmed[0].values.title, "New native title");
assert.equal(basic.time.pending(), 0);
await basic.controller.read();
assert.equal(basic.confirmed.length, 1, "an ordinary refresh does not replay the confirmation callback");
unsubscribe();
const notificationsBeforeChange = notifications;
basic.controller.change({ description: "Local only" });
assert.equal(notifications, notificationsBeforeChange);
basic.controller.discard();
assert.deepEqual(basic.controller.getSnapshot().draft, {});

// New local edits survive confirmation of the immutable older attempt.
const newer = fixture();
await newer.controller.read();
const pendingWrite = deferred<unknown>();
newer.setWrite(() => pendingWrite.promise);
newer.controller.change({ title: "Submitted title" });
const savingNewer = newer.controller.save();
await newer.controller.save();
await newer.controller.read();
assert.equal(newer.writes.length, 1);
assert.equal(newer.reads.length, 1, "a pending writer excludes a concurrent read");
newer.controller.change({ title: "Typed after save started" });
newer.setCurrent(item("opaque-b", "Submitted title"));
pendingWrite.resolve(item("opaque-b", "Submitted title"));
await savingNewer;
assert.equal(newer.controller.getSnapshot().phase, "editing");
assert.equal(newer.controller.getSnapshot().draft.title, "Typed after save started");
assert.equal(newer.confirmed.length, 1, "readback confirms the attempted values even when a newer draft is kept");
assert.equal(newer.confirmed[0].values.title, "Submitted title");

// Network uncertainty preserves the attempt, with no automatic read or write retry.
const uncertain = fixture();
await uncertain.controller.read();
uncertain.controller.change({ title: "Possibly saved" });
uncertain.setWrite(async () => { throw new TypeError("Lost connection"); });
await uncertain.controller.save();
const uncertainAttempt = uncertain.controller.getSnapshot().attempt;
assert.ok(uncertainAttempt);
assert.equal(uncertain.controller.getSnapshot().phase, "unknown");
assert.equal(uncertain.reads.length, 1);
assert.equal(uncertain.writes.length, 1);
await uncertain.controller.save();
uncertain.controller.review();
uncertain.controller.discard();
assert.equal(uncertain.controller.getSnapshot().attempt, uncertainAttempt);
assert.equal(uncertain.writes.length, 1);
await uncertain.controller.read();
assert.equal(uncertain.controller.getSnapshot().phase, "editing", "the same guard with the pre-save values shows the write did not land");
assert.equal(uncertain.controller.getSnapshot().problem, "not_saved");
assert.equal(uncertain.controller.getSnapshot().attempt, null);
assert.equal(uncertain.controller.getSnapshot().reviewSnapshot, null);
assert.equal(uncertain.controller.getSnapshot().draft.title, "Possibly saved");
assert.equal(uncertain.confirmed.length, 0, "an unsaved result is not a confirmation");
assert.equal(uncertain.writes.length, 1, "the check never retries the write");
// The original request lands after the check. The fresh attempt carries the same guard and is refused.
uncertain.setCurrent(item("opaque-b", "Possibly saved"));
uncertain.setWrite(async () => { throw new ControlledApiResponseError(409, "CONFLICT", "Changed"); });
await uncertain.controller.save();
assert.equal(uncertain.writes.length, 2);
assert.deepEqual(uncertain.writes[1]!.input, { seo: { title: "Possibly saved" }, _rev: "opaque-a" });
assert.equal(uncertain.controller.getSnapshot().phase, "conflict");
await uncertain.controller.read();
assert.equal(uncertain.controller.getSnapshot().phase, "confirmed", "a read finds the attempted values saved");
assert.equal(uncertain.confirmed.length, 1);
assert.equal(uncertain.writes.length, 2);

// Definite rejection and revision conflict have separate deliberate recovery paths.
const refused = fixture();
await refused.controller.read();
refused.controller.change({ title: "Refused title" });
refused.setWrite(async () => { throw new ControlledApiResponseError(403, "FORBIDDEN", "Rejected"); });
await refused.controller.save();
assert.equal(refused.controller.getSnapshot().phase, "editing");
assert.equal(refused.controller.getSnapshot().problem, "rejected");
assert.equal(refused.controller.getSnapshot().attempt, null);
assert.equal(refused.controller.getSnapshot().draft.title, "Refused title");
assert.equal(refused.reads.length, 1);
// Another editor's entry lock refuses the write before storing anything: one request, no review, no check, no retry.
const locked = fixture();
await locked.controller.read();
locked.controller.change({ title: "Held entry title" });
locked.setWrite(async () => {
	throw new ControlledApiResponseError(409, "ENTRY_LOCKED", "Another editor is holding this entry", { userId: "other-editor" });
});
await locked.controller.save();
assert.equal(locked.writes.length, 1, "a lock refusal is one request");
assert.equal(locked.controller.getSnapshot().phase, "editing", "a lock refusal opens no conflict review");
assert.equal(locked.controller.getSnapshot().problem, "locked");
assert.equal(locked.controller.getSnapshot().attempt, null);
assert.equal(locked.controller.getSnapshot().reviewSnapshot, null);
assert.equal(locked.controller.getSnapshot().draft.title, "Held entry title");
assert.equal(locked.reads.length, 1, "a lock refusal starts no check");
assert.equal(locked.time.pending(), 0);
locked.time.advance(NATIVE_SEO_REQUEST_DEADLINE_MS);
await flush();
assert.equal(locked.writes.length, 1, "nothing retries on its own");
assert.equal(locked.confirmed.length, 0);
// After Take over in the host, the next explicit save is one fresh guarded write confirmed by readback.
locked.setWrite(null);
await locked.controller.save();
assert.equal(locked.writes.length, 2);
assert.deepEqual(locked.writes[1]!.input, { seo: { title: "Held entry title" }, _rev: "opaque-a" });
assert.equal(locked.reads.length, 2);
assert.equal(locked.controller.getSnapshot().phase, "confirmed");
assert.equal(locked.confirmed.length, 1);
const conflict = fixture();
await conflict.controller.read();
conflict.controller.change({ title: "My native title" });
conflict.setWrite(async () => { throw new ControlledApiResponseError(409, "CONFLICT", "Changed"); });
await conflict.controller.save();
assert.equal(conflict.controller.getSnapshot().phase, "conflict");
assert.equal(conflict.reads.length, 1);
conflict.controller.review();
assert.equal(conflict.controller.getSnapshot().phase, "conflict");
conflict.setCurrent(item("opaque-other", "Other native title"));
await conflict.controller.read();
assert.equal(conflict.controller.getSnapshot().phase, "conflict");
assert.equal(conflict.controller.getSnapshot().baseline?.revision, "opaque-a");
assert.equal(conflict.controller.getSnapshot().reviewSnapshot?.revision, "opaque-other");
assert.equal(conflict.confirmed.length, 0);
assert.equal(conflict.writes.length, 1);
conflict.controller.review();
assert.equal(conflict.controller.getSnapshot().phase, "editing");
assert.equal(conflict.controller.getSnapshot().baseline?.revision, "opaque-other");
assert.equal(conflict.writes.length, 1, "review never schedules a write");
conflict.controller.discard();
assert.deepEqual(conflict.controller.getSnapshot().draft, {});

// Both public read and write promises have deterministic finite deadlines, without abort support.
const readTimeout = fixture();
const slowRead = deferred<unknown>();
readTimeout.setRead(() => slowRead.promise);
const timingRead = readTimeout.controller.read();
readTimeout.time.advance(NATIVE_SEO_REQUEST_DEADLINE_MS);
await timingRead;
const timedReadState = readTimeout.controller.getSnapshot();
assert.equal(timedReadState.phase, "unknown");
assert.equal(timedReadState.problem, "readback_unavailable");
assert.equal(timedReadState.baseline, null);
assert.equal(readTimeout.time.pending(), 0);
slowRead.resolve(item());
await flush();
assert.equal(readTimeout.controller.getSnapshot(), timedReadState, "a late read cannot settle the timed-out request");
assert.equal(readTimeout.confirmed.length, 0);

const writeTimeout = fixture();
await writeTimeout.controller.read();
const slowWrite = deferred<unknown>();
writeTimeout.setWrite(() => slowWrite.promise);
writeTimeout.controller.change({ title: "Slow title" });
const timingWrite = writeTimeout.controller.save();
writeTimeout.time.advance(NATIVE_SEO_REQUEST_DEADLINE_MS);
await timingWrite;
const timedWriteState = writeTimeout.controller.getSnapshot();
assert.equal(timedWriteState.phase, "unknown");
assert.equal(timedWriteState.problem, "unconfirmed");
assert.ok(timedWriteState.attempt);
assert.equal(writeTimeout.time.pending(), 0);
assert.equal(writeTimeout.reads.length, 1);
slowWrite.resolve(item("opaque-b", "Slow title"));
await flush();
assert.equal(writeTimeout.controller.getSnapshot(), timedWriteState, "late write acknowledgement is ignored after its deadline");
assert.equal(writeTimeout.confirmed.length, 0);
writeTimeout.setCurrent(item("opaque-b", "Slow title"));
await writeTimeout.controller.read();
assert.equal(writeTimeout.confirmed.length, 1);
assert.equal(writeTimeout.writes.length, 1);

// A slow acknowledgement cannot receive another full 15 seconds for its mandatory readback.
const shared = fixture();
await shared.controller.read();
const sharedWrite = deferred<unknown>();
const sharedRead = deferred<unknown>();
shared.setWrite(() => sharedWrite.promise);
shared.setRead(() => sharedRead.promise);
shared.controller.change({ title: "Shared deadline" });
const sharedSaving = shared.controller.save();
shared.time.advance(10_000);
sharedWrite.resolve(item("opaque-b", "Shared deadline"));
await flush();
assert.equal(shared.reads.length, 2);
assert.equal(shared.time.nextDeadline(), 15_000);
shared.time.advance(5_000);
await sharedSaving;
const sharedTimedOut = shared.controller.getSnapshot();
assert.equal(sharedTimedOut.phase, "unknown");
assert.equal(sharedTimedOut.problem, "readback_unavailable");
assert.ok(sharedTimedOut.attempt);
sharedRead.resolve(item("opaque-b", "Shared deadline"));
await flush();
assert.equal(shared.controller.getSnapshot(), sharedTimedOut);
assert.equal(shared.confirmed.length, 0);
assert.equal(shared.time.pending(), 0);

// Foreign results never gain authority, even when an operation is otherwise successful.
const foreign = fixture();
foreign.setCurrent(item("opaque-foreign", values.title, "entry-b"));
await foreign.controller.read();
assert.equal(foreign.controller.getSnapshot().baseline, null);
assert.equal(foreign.confirmed.length, 0);
foreign.setCurrent(item());
await foreign.controller.read();
foreign.controller.change({ title: "Own title" });
foreign.setWrite(async () => item("opaque-b", "Own title", "entry-b"));
await foreign.controller.save();
assert.equal(foreign.controller.getSnapshot().phase, "unknown");
assert.equal(foreign.confirmed.length, 0);
assert.equal(foreign.reads.length, 2, "an unusable acknowledgement starts no automatic read");

// Disposal withdraws all metadata/drafts, releases timers/listeners and fences late settlements.
for (const kind of ["read", "write"] as const) {
	const disposed = fixture();
	if (kind === "write") await disposed.controller.read();
	const pending = deferred<unknown>();
	if (kind === "read") disposed.setRead(() => pending.promise);
	else {
		disposed.controller.change({ title: "Abandoned title" });
		disposed.setWrite(() => pending.promise);
	}
	let calls = 0;
	disposed.controller.subscribe(() => { calls++; });
	const waiting = kind === "read" ? disposed.controller.read() : disposed.controller.save();
	assert.equal(disposed.time.pending(), 1);
	disposed.controller.dispose();
	await waiting;
	assert.equal(disposed.controller.live(), false);
	assert.equal(disposed.time.pending(), 0);
	assert.equal(disposed.controller.getSnapshot().baseline, null);
	assert.equal(disposed.controller.getSnapshot().attempt, null);
	assert.deepEqual(disposed.controller.getSnapshot().draft, {});
	const ended = disposed.controller.getSnapshot();
	const endedCalls = calls;
	const readCount = disposed.reads.length;
	const writeCount = disposed.writes.length;
	pending.resolve(item("opaque-late", "Abandoned title"));
	await flush();
	disposed.controller.change({ title: "Not accepted" });
	disposed.controller.review();
	disposed.controller.discard();
	await disposed.controller.read();
	await disposed.controller.save();
	disposed.controller.dispose();
	assert.equal(disposed.controller.getSnapshot(), ended);
	assert.equal(calls, endedCalls);
	assert.equal(disposed.reads.length, readCount);
	assert.equal(disposed.writes.length, writeCount);
	assert.equal(disposed.confirmed.length, 0);
}

for (const fixture of [basic, newer, uncertain, refused, locked, conflict, readTimeout, writeTimeout, shared, foreign]) {
	fixture.controller.dispose();
	assert.equal(fixture.time.pending(), 0);
}
console.log("Native SEO editor controller self-checks passed.");
