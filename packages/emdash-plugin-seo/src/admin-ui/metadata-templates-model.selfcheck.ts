import assert from "node:assert/strict";

import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_OUTPUT_SUPPORT,
	SEO_ADMIN_TEMPLATES_STORAGE_VERSION,
	SEO_ENGINE_VERSION,
	type SeoAdminTemplateConfiguration,
	type SeoAdminTemplateItem,
	type SeoAdminTemplatesSaveResult,
	type SeoAdminTemplateValues,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import {
	canSaveTemplate,
	createTemplatesStore,
	currentTemplatePreview,
	runTemplatePreview,
	runTemplateReset,
	runTemplateSave,
	templateConflictResolvable,
	templateFormValues,
	templateReadToRequest,
	templateWritesBlocked,
	type TemplatePreviewRequest,
	type TemplatesPort,
	type TemplatesStore,
} from "./metadata-templates-model.ts";

const A: SeoAdminTemplateValues = { title: "{{title}} A", description: "{{description}}", socialTitle: "{{title}}", socialDescription: "{{description}}" };
const B: SeoAdminTemplateValues = { ...A, title: "{{title}} B" };
const C: SeoAdminTemplateValues = { ...A, title: "{{title}} C" };
const guard = { fields: { title: null, description: null, socialTitle: null, socialDescription: null } };

function item(values: SeoAdminTemplateValues, source: SeoAdminTemplateItem["source"] = "override", collection = "posts"): SeoAdminTemplateItem {
	return {
		collection,
		label: collection,
		description: "",
		source,
		values,
		inheritanceGuard: guard,
		inherited: { source: "default", values: A, ignoredLegacyFields: [] },
	};
}

function target(entryId: string, locale = "en") {
	return { entryId, locale, title: `Entry ${entryId}`, slug: entryId };
}

function configuration(revision: string | null, items: SeoAdminTemplateItem[], state: SeoAdminTemplateConfiguration["state"] = "saved"): SeoAdminTemplateConfiguration {
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		storageVersion: SEO_ADMIN_TEMPLATES_STORAGE_VERSION,
		engineVersion: SEO_ENGINE_VERSION,
		state,
		revision: state === "absent" || state === "unavailable" ? null : revision,
		discovery: "available",
		allowedVariables: ["title"],
		outputSupport: SEO_ADMIN_OUTPUT_SUPPORT,
		retainedCollections: [],
		items: state === "absent" || state === "saved" ? items : [],
	};
}

function read(store: TemplatesStore, at: number, config: SeoAdminTemplateConfiguration) {
	store.dispatch({ type: "read", read: { configuration: config, requestedAt: at } });
}

function edit(store: TemplatesStore, value: string) {
	store.dispatch({ type: "edit", collection: "posts", field: "title", value });
}

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
}
function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function port(options: {
	save?: (request: any) => Promise<SeoAdminTemplatesSaveResult>;
	reset?: (request: any) => Promise<SeoAdminTemplatesSaveResult>;
	preview?: (request: TemplatePreviewRequest) => Promise<any>;
	clock: { now: number };
	deadline?: boolean;
}): TemplatesPort & { saves: any[]; resets: any[]; previews: TemplatePreviewRequest[] } {
	const saves: any[] = [];
	const resets: any[] = [];
	const previews: TemplatePreviewRequest[] = [];
	let id = 0;
	return {
		saves,
		resets,
		previews,
		save: (request) => {
			saves.push(request);
			return options.save ? options.save(request) : Promise.reject(new Error("unexpected"));
		},
		reset: (request) => {
			resets.push(request);
			return options.reset ? options.reset(request) : Promise.reject(new Error("unexpected"));
		},
		preview: (request) => {
			previews.push(request);
			return options.preview ? options.preview(request) : Promise.reject(new Error("unexpected"));
		},
		now: () => ++options.clock.now,
		newId: () => `op-${++id}`,
		withDeadline: (request, ms) => options.deadline
			? Promise.reject(new DOMException(`timed out after ${ms}`, "TimeoutError"))
			: request(new AbortController().signal),
	};
}

// A -> B -> A leaves a clean draft; a newer saved C replaces it without a conflict.
{
	const store = createTemplatesStore();
	read(store, 1, configuration("r1", [item(A)]));
	edit(store, B.title);
	edit(store, A.title);
	read(store, 2, configuration("r2", [item(C)]));
	const state = store.get();
	assert.equal(state.drafts.posts, undefined, "a clean draft follows the newer read");
	assert.equal(state.conflicts.posts, undefined);
	assert.deepEqual(templateFormValues(state, "posts"), C);
}

// Dirty draft: a changed item asks; an unchanged item rebases silently.
{
	const store = createTemplatesStore();
	read(store, 1, configuration("r1", [item(A), item(A, "default", "pages")]));
	edit(store, B.title);
	read(store, 2, configuration("r2", [item(A), item(C, "override", "pages")]));
	assert.equal(store.get().drafts.posts.loadedRevision, "r2", "a draft rebases when its own collection is unchanged");
	assert.equal(store.get().conflicts.posts, undefined);
	read(store, 3, configuration("r3", [item(C), item(C, "override", "pages")]));
	assert.ok(store.get().conflicts.posts, "a changed collection asks before saving over it");
	assert.equal(canSaveTemplate(store.get(), "posts"), false);
	store.dispatch({ type: "keep-edits", collection: "posts" });
	assert.equal(store.get().drafts.posts.loadedRevision, "r3", "keeping edits binds to the newest displayed read");
	assert.ok(canSaveTemplate(store.get(), "posts"));
	read(store, 2, configuration("r2", [item(A)]));
	assert.equal(store.get().base?.configuration.revision, "r3", "an older read never replaces a newer one");
}

// Two saves in one tick send one command, against the draft's own revision; inputs freeze.
{
	const clock = { now: 10 };
	const store = createTemplatesStore();
	read(store, 1, configuration("r1", [item(A)]));
	edit(store, B.title);
	const answer = deferred<SeoAdminTemplatesSaveResult>();
	const transport = port({ clock, save: () => answer.promise });
	const first = runTemplateSave(store, transport, "posts");
	const second = runTemplateSave(store, transport, "posts");
	edit(store, "frozen");
	assert.equal(transport.saves.length, 1, "duplicate activations send one command");
	assert.equal(transport.saves[0].expectedRevision, "r1");
	assert.equal(store.get().drafts.posts.values.title, B.title, "inputs of a collection are frozen while its command runs");
	answer.resolve({ success: true, outcome: "saved", collection: "posts", templates: configuration("r2", [item(B)]) });
	assert.deepEqual(await first, { sent: true, changed: true });
	assert.deepEqual(await second, { sent: false, changed: false });
	assert.equal(store.get().drafts.posts, undefined);
	assert.ok(store.get().barrier > 10, "a confirmed write sets a read barrier at its arrival");
}

// A read requested during the write returns A before the commit; the answer B is then not the newest.
{
	const clock = { now: 100 };
	const store = createTemplatesStore();
	read(store, 1, configuration("r1", [item(A)]));
	edit(store, B.title);
	const answer = deferred<SeoAdminTemplatesSaveResult>();
	const transport = port({ clock, save: () => answer.promise });
	const run = runTemplateSave(store, transport, "posts");
	// Requested while the write is in flight, answered before it commits.
	read(store, ++clock.now, configuration("r1", [item(A)]));
	answer.resolve({ success: true, outcome: "saved", collection: "posts", templates: configuration("r2", [item(B)]) });
	await run;
	let state = store.get();
	assert.ok(state.drafts.posts, "the draft is kept when no applied read shows the write");
	assert.ok(state.observing, "the confirmed write waits for a read that shows it");
	assert.ok(templateWritesBlocked(state));
	const after = state.observing!.after;
	assert.equal(templateReadToRequest(state, false, 0), after);
	read(store, after - 1, configuration("r1", [item(A)]));
	assert.ok(store.get().observing, "a read requested before the answer arrived is ignored");
	read(store, after + 1, configuration("r2", [item(B)]));
	state = store.get();
	assert.equal(state.observing, null);
	assert.equal(state.drafts.posts, undefined, "the read that shows the saved values ends the draft");
	assert.match(state.notice?.text ?? "", /shown as stored/);
}

// A fresh success answer is applied; a read requested during the write and answered later is ignored.
{
	const clock = { now: 150 };
	const store = createTemplatesStore();
	read(store, 1, configuration("r1", [item(A)]));
	edit(store, B.title);
	const answer = deferred<SeoAdminTemplatesSaveResult>();
	const transport = port({ clock, save: () => answer.promise });
	const run = runTemplateSave(store, transport, "posts");
	const requestedDuringWrite = ++clock.now;
	answer.resolve({ success: true, outcome: "saved", collection: "posts", templates: configuration("r2", [item(B)]) });
	await run;
	assert.equal(store.get().base?.configuration.revision, "r2");
	read(store, requestedDuringWrite, configuration("r1", [item(A)]));
	assert.equal(store.get().base?.configuration.revision, "r2", "a read that may predate the confirmed write never replaces its answer");
	assert.deepEqual(templateFormValues(store.get(), "posts"), B);
}

// The fresh read shows someone else's later change: the draft stays for an explicit choice.
{
	const clock = { now: 200 };
	const store = createTemplatesStore();
	read(store, 1, configuration("r1", [item(A)]));
	edit(store, B.title);
	const transport = port({ clock, save: async () => ({ success: true, outcome: "saved", collection: "posts", templates: null }) });
	await runTemplateSave(store, transport, "posts");
	const after = store.get().observing!.after;
	read(store, after + 1, configuration("r3", [item(C)]));
	assert.ok(store.get().drafts.posts, "a read showing other values does not discard the edits");
	assert.ok(store.get().conflicts.posts);
	assert.match(store.get().notice?.text ?? "", /changed again/);
}

// A success answer that cannot show the collection keeps the draft and reads again.
{
	const clock = { now: 300 };
	const store = createTemplatesStore();
	read(store, 1, configuration("r1", [item(A)]));
	edit(store, B.title);
	const transport = port({ clock, save: async () => ({ success: true, outcome: "saved", collection: "posts", templates: configuration("r9", [], "corrupt") }) });
	await runTemplateSave(store, transport, "posts");
	assert.ok(store.get().drafts.posts, "an unreadable answer does not discard the draft");
	assert.ok(store.get().observing);
}

// A conflict without a readable answer offers no choice until a read requested after it.
{
	const clock = { now: 400 };
	const store = createTemplatesStore();
	read(store, 1, configuration("r1", [item(A)]));
	edit(store, B.title);
	const transport = port({ clock, save: async () => ({ success: false, error: "conflict", message: "changed", templates: null }) });
	await runTemplateSave(store, transport, "posts");
	const awaiting = store.get().conflicts.posts.awaitingReadAfter!;
	assert.ok(awaiting > 0);
	assert.equal(templateConflictResolvable(store.get(), "posts"), false);
	store.dispatch({ type: "keep-edits", collection: "posts" });
	assert.ok(store.get().conflicts.posts, "a choice is ignored while the conflict is unshown");
	read(store, awaiting - 1, configuration("r2", [item(C)]));
	assert.equal(store.get().conflicts.posts.awaitingReadAfter, awaiting, "a read requested before the conflict keeps the marker");
	assert.equal(templateConflictResolvable(store.get(), "posts"), false);
	read(store, awaiting + 1, configuration("r2", [item(C)]));
	assert.ok(templateConflictResolvable(store.get(), "posts"));
	store.dispatch({ type: "keep-edits", collection: "posts" });
	assert.equal(store.get().drafts.posts.loadedRevision, "r2");
	assert.equal(store.get().notice, null, "a conflict choice clears the earlier command's message");
}

// Using the saved values ends the conflict and its "your edits are kept" message.
{
	const clock = { now: 450 };
	const store = createTemplatesStore();
	read(store, 1, configuration("r1", [item(A)]));
	edit(store, B.title);
	await runTemplateSave(store, port({ clock, save: async () => ({ success: false, error: "conflict", message: "changed", templates: configuration("r2", [item(C)]) }) }), "posts");
	assert.ok(store.get().notice);
	store.dispatch({ type: "discard", collection: "posts" });
	assert.equal(store.get().drafts.posts, undefined);
	assert.equal(store.get().notice, null);
	assert.deepEqual(templateFormValues(store.get(), "posts"), C);
}

// An unknown outcome blocks writes until a readable read lists the collection.
{
	const clock = { now: 500 };
	const store = createTemplatesStore();
	read(store, 1, configuration("r1", [item(A)]));
	edit(store, B.title);
	const transport = port({ clock, save: async () => { throw Object.assign(new Error("Bad gateway"), { status: 502 }); } });
	await runTemplateSave(store, transport, "posts");
	const at = store.get().unknown!.at;
	assert.ok(templateWritesBlocked(store.get()));
	assert.equal(await runTemplateSave(store, transport, "posts").then((run) => run.sent), false);
	read(store, at - 1, configuration("r1", [item(A)]));
	assert.ok(store.get().unknown, "a read requested before the outcome does not settle it");
	read(store, at + 1, configuration("r5", [], "corrupt"));
	assert.ok(store.get().unknown, "an unreadable read does not settle it");
	read(store, at + 2, configuration("r6", [item(A, "default", "pages")]));
	assert.ok(store.get().unknown, "a read without the collection does not settle it");
	read(store, at + 3, configuration("r7", [item(B)]));
	assert.equal(store.get().unknown, null);
	assert.ok(store.get().drafts.posts, "the read is shown without claiming the command committed");
	assert.equal(transport.saves.length, 1, "nothing is retried");
}

// A denied command says nothing was changed and does not block writes.
{
	const store = createTemplatesStore();
	read(store, 1, configuration("r1", [item(A)]));
	edit(store, B.title);
	await runTemplateSave(store, port({ clock: { now: 600 }, save: async () => { throw Object.assign(new Error("Forbidden"), { status: 403 }); } }), "posts");
	assert.match(store.get().notice?.text ?? "", /plugins:manage/);
	assert.equal(store.get().unknown, null);
}

// One read is requested per outcome, after a running read finishes, and never retried.
{
	const store = createTemplatesStore();
	read(store, 1, configuration("r1", [item(A)]));
	edit(store, B.title);
	await runTemplateSave(store, port({ clock: { now: 700 }, save: async () => ({ success: true, outcome: "saved", collection: "posts", templates: null }) }), "posts");
	const after = store.get().observing!.after;
	assert.equal(templateReadToRequest(store.get(), true, 0), null, "a running read may predate the outcome, so the request waits");
	assert.equal(templateReadToRequest(store.get(), false, 0), after, "after it finishes, one fresh read is requested");
	assert.equal(templateReadToRequest(store.get(), false, after), null, "a failed read is not retried automatically");
}

// The reset review captures what the editor saw; a newer read does not change it.
{
	const clock = { now: 800 };
	const store = createTemplatesStore();
	read(store, 1, configuration("r1", [item(B)]));
	store.dispatch({ type: "open-reset", collection: "posts" });
	read(store, 2, configuration("r2", [item(B)]));
	const transport = port({ clock, reset: async () => ({ success: false, error: "conflict", message: "changed", templates: null }) });
	await runTemplateReset(store, transport);
	assert.equal(transport.resets[0].expectedRevision, "r1", "a reset sends the revision shown in the review");
	assert.deepEqual(transport.resets[0].inheritanceGuard, guard);
}

// Preview: one request per explicit action, late answers dropped, edits mark it out of date, one deadline.
{
	const clock = { now: 900 };
	const store = createTemplatesStore();
	read(store, 1, configuration("r1", [item(A)]));
	const request: TemplatePreviewRequest = { collection: "posts", entryId: "e1", locale: "en", values: A };
	const first = deferred<any>();
	const second = deferred<any>();
	const answers = [first, second];
	const transport = port({ clock, preview: () => answers.shift()!.promise });
	const running = runTemplatePreview(store, transport, request);
	assert.equal(await runTemplatePreview(store, transport, request), false, "a duplicate of a pending preview is not sent");
	const changed = { ...request, values: B };
	const replacing = runTemplatePreview(store, transport, changed);
	first.resolve({ success: true, preview: { late: true } });
	await running;
	assert.equal(currentTemplatePreview(store.get(), changed).kind, "pending", "a late answer for a replaced request is dropped");
	second.resolve({ success: false, error: "not_published", message: "not published" });
	await replacing;
	assert.equal(currentTemplatePreview(store.get(), changed).kind, "settled");
	assert.equal(currentTemplatePreview(store.get(), { ...changed, values: C }).kind, "stale", "an edit marks the preview out of date");
	const timed = port({ clock, deadline: true });
	await runTemplatePreview(store, timed, { ...request, entryId: "e2" });
	const outcome = currentTemplatePreview(store.get(), { ...request, entryId: "e2" });
	assert.ok(outcome.kind === "settled" && outcome.outcome.kind === "failed" && /in time/.test(outcome.outcome.message));
}

// An explicit reference selects its type once; a malformed one stays a visible request.
{
	const store = createTemplatesStore();
	read(store, 1, configuration("r1", [item(A), item(A, "default", "pages")]));
	assert.equal(store.get().active, "posts");
	store.dispatch({ type: "request-example", ref: "pages:a9" });
	assert.equal(store.get().active, "pages", "the request selects its content type");
	assert.deepEqual(store.get().request, { ref: "pages:a9", collection: "pages", entryId: "a9" });
	const applied = store.get();
	store.dispatch({ type: "request-example", ref: "pages:a9" });
	assert.equal(store.get(), applied, "the same reference reported again changes nothing");
	store.dispatch({ type: "auto-example", collection: "pages", example: target("a1") });
	assert.equal(store.get().examples.pages, undefined, "the first listed entry never replaces an open request");
	store.dispatch({ type: "request-example", ref: "pages" });
	assert.equal(store.get().active, "pages", "a malformed reference keeps the visible type");
	assert.deepEqual(store.get().request, { ref: "pages", collection: null, entryId: null });
	store.dispatch({ type: "auto-example", collection: "pages", example: target("a1") });
	assert.equal(store.get().examples.pages, undefined, "a malformed request is not an absent request");
}

// Only the current request's own entry is remembered, and only for an available type.
{
	const store = createTemplatesStore();
	read(store, 1, configuration("r1", [item(A)]));
	store.dispatch({ type: "select-example", collection: "posts", example: target("p1") });
	store.dispatch({ type: "request-example", ref: "posts:p40" });
	store.dispatch({ type: "resolve-example", ref: "posts:p39", example: target("p39") });
	store.dispatch({ type: "resolve-example", ref: "posts:p40", example: target("p41") });
	assert.deepEqual(store.get().examples.posts, target("p1"), "a late answer for another reference or entry changes nothing");
	store.dispatch({ type: "resolve-example", ref: "posts:p40", example: target("p40") });
	assert.deepEqual(store.get().examples.posts, target("p40"));
	assert.ok(store.get().request, "resolving keeps the request in control");
	const settled = store.get();
	store.dispatch({ type: "resolve-example", ref: "posts:p40", example: target("p40") });
	assert.equal(store.get(), settled, "an equal answer is a no-op, so effects cannot loop");
	store.dispatch({ type: "request-example", ref: "posts:p50" });
	read(store, 2, configuration("r2", [item(A, "default", "pages")]));
	store.dispatch({ type: "resolve-example", ref: "posts:p50", example: target("p50") });
	assert.deepEqual(store.get().examples.posts, target("p40"), "an answer for a type that stopped being a target is not applied");
}

// Choosing an entry or a type ends the request; the choice is the applied reference.
{
	const store = createTemplatesStore();
	read(store, 1, configuration("r1", [item(A), item(A, "default", "pages")]));
	store.dispatch({ type: "request-example", ref: "posts:p40" });
	store.dispatch({ type: "select-example", collection: "posts", example: target("p2") });
	assert.equal(store.get().request, null);
	assert.equal(store.get().appliedRef, "posts:p2");
	store.dispatch({ type: "request-example", ref: "posts:p2" });
	assert.equal(store.get().request, null, "the choice reported back by the view is not a new request");
	store.dispatch({ type: "request-example", ref: "posts:p40" });
	store.dispatch({ type: "select", collection: "pages" });
	assert.equal(store.get().request, null, "choosing another type ends the request");
	assert.equal(store.get().appliedRef, null);
	store.dispatch({ type: "auto-example", collection: "pages", example: target("a1") });
	assert.deepEqual(store.get().examples.pages, target("a1"), "the first listed entry applies once to a type without a request or example");
	store.dispatch({ type: "auto-example", collection: "pages", example: target("a2") });
	assert.deepEqual(store.get().examples.pages, target("a1"), "and never replaces it");
	store.dispatch({ type: "select", collection: "posts" });
	assert.equal(store.get().appliedRef, "posts:p2", "returning to a type applies its remembered example, not the old request");
}

// A removed active type stays active with its edits; it is never switched to another type.
{
	const store = createTemplatesStore();
	read(store, 1, configuration("r1", [item(A, "default", "pages"), item(A)]));
	store.dispatch({ type: "select", collection: "posts" });
	edit(store, B.title);
	read(store, 2, configuration("r2", [item(A, "default", "pages")]));
	assert.equal(store.get().active, "posts", "a refreshed read does not switch the form to another type");
	assert.equal(store.get().drafts.posts.values.title, B.title, "the edits are kept");
	assert.equal(canSaveTemplate(store.get(), "posts"), false, "and cannot be saved while the type is not a target");
	read(store, 3, configuration("r3", [item(A, "default", "pages"), item(A)]));
	assert.equal(store.get().active, "posts");
	assert.equal(store.get().drafts.posts.values.title, B.title);
}

// A preview belongs to its selection generation: A to B to A and removal/restoration need another Preview.
{
	const clock = { now: 1_000 };
	const store = createTemplatesStore();
	read(store, 1, configuration("r1", [item(A)]));
	const forA: TemplatePreviewRequest = { collection: "posts", entryId: "p1", locale: "en", values: A };
	store.dispatch({ type: "select-example", collection: "posts", example: target("p1") });
	const answers: Array<Deferred<any>> = [];
	const transport = port({ clock, preview: () => {
		const answer = deferred<any>();
		answers.push(answer);
		return answer.promise;
	} });

	const settledRun = runTemplatePreview(store, transport, forA);
	answers[0].resolve({ success: true, preview: { entryId: "p1" } });
	await settledRun;
	assert.equal(currentTemplatePreview(store.get(), forA).kind, "settled");
	store.dispatch({ type: "select-example", collection: "posts", example: target("p2") });
	store.dispatch({ type: "request-example", ref: "posts:p1" });
	assert.equal(currentTemplatePreview(store.get(), forA).kind, "stale", "a settled A result is not revived after A to B to A");

	const late = runTemplatePreview(store, transport, forA);
	store.dispatch({ type: "select-example", collection: "posts", example: target("p2") });
	store.dispatch({ type: "select-example", collection: "posts", example: target("p1") });
	answers[1].resolve({ success: true, preview: { entryId: "p1", late: true } });
	await late;
	assert.equal(currentTemplatePreview(store.get(), forA).kind, "stale", "a pending A answer that settles after A to B to A is not shown");
	const again = runTemplatePreview(store, transport, forA);
	assert.equal(transport.previews.length, 3, "another Preview action is sent");
	answers[2].resolve({ success: true, preview: { entryId: "p1" } });
	assert.equal(await again, true);
	assert.equal(currentTemplatePreview(store.get(), forA).kind, "settled", "that action's answer belongs to the current generation");

	read(store, 2, configuration("r2", []));
	read(store, 3, configuration("r3", [item(A)]));
	assert.equal(store.get().active, "posts");
	assert.equal(currentTemplatePreview(store.get(), forA).kind, "stale", "removing and restoring the type needs another Preview");

	const before = store.get().generation;
	edit(store, B.title);
	edit(store, A.title);
	read(store, 4, configuration("r4", [item(A)]));
	assert.equal(store.get().generation, before, "edits and an unchanged read keep the generation");
}

// The actual locale is part of the selection: p1/en to p1/fr to p1/en needs another Preview.
{
	const clock = { now: 2_000 };
	const store = createTemplatesStore();
	read(store, 1, configuration("r1", [item(A)]));
	const english: TemplatePreviewRequest = { collection: "posts", entryId: "p1", locale: "en", values: A };
	store.dispatch({ type: "select-example", collection: "posts", example: target("p1", "en") });
	const answers: Array<Deferred<any>> = [];
	const transport = port({ clock, preview: () => {
		const answer = deferred<any>();
		answers.push(answer);
		return answer.promise;
	} });
	const settledRun = runTemplatePreview(store, transport, english);
	answers[0].resolve({ success: true, preview: { entryId: "p1", locale: "en" } });
	await settledRun;
	assert.equal(currentTemplatePreview(store.get(), english).kind, "settled");
	store.dispatch({ type: "select-example", collection: "posts", example: target("p1", "fr") });
	store.dispatch({ type: "select-example", collection: "posts", example: target("p1", "en") });
	assert.equal(currentTemplatePreview(store.get(), english).kind, "stale", "a settled p1/en result is not revived after p1/fr");

	const pendingRun = runTemplatePreview(store, transport, english);
	assert.equal(currentTemplatePreview(store.get(), english).kind, "pending");
	store.dispatch({ type: "select-example", collection: "posts", example: target("p1", "fr") });
	store.dispatch({ type: "select-example", collection: "posts", example: target("p1", "en") });
	answers[1].resolve({ success: true, preview: { entryId: "p1", locale: "en", late: true } });
	await pendingRun;
	assert.equal(currentTemplatePreview(store.get(), english).kind, "stale", "nor is a pending p1/en answer that settles after p1/fr");

	store.dispatch({ type: "select-example", collection: "posts", example: target("p2") });
	store.dispatch({ type: "request-example", ref: "posts:p1" });
	assert.ok(store.get().request, "a reference other than the applied choice opens a request");
	const requested = store.get().generation;
	store.dispatch({ type: "resolve-example", ref: "posts:p1", example: target("p1", "fr") });
	assert.notEqual(store.get().generation, requested, "resolving a request to another actual locale is a new selection");
}

console.log("metadata templates model selfcheck passed");
