import assert from "node:assert/strict";

import type { RedirectRule } from "@shipitseo/emdash-plugin-seo/admin-contract";

import {
	INITIAL_REDIRECT_FORM,
	INITIAL_REDIRECT_SNAPSHOT,
	checkRedirectRule,
	classifyRedirectRequestError,
	createRedirectFormStore,
	firstInvalidRedirectField,
	redirectEmptyPage,
	redirectFieldAnnouncement,
	redirectFormUnresolved,
	resetRedirectForm,
	saveRedirectRule,
	initialRedirectPaging,
	nextRedirectPage,
	prefillRedirectForm,
	previousRedirectPage,
	redirectFiltersActive,
	redirectFormAfterCheckError,
	redirectFormAfterCreateError,
	redirectFormAfterResult,
	redirectFormLocked,
	redirectListRequest,
	withRedirectFilters,
} from "./redirect-rules-model.ts";

const rule: RedirectRule = {
	id: "01J9REDIRECT", source: "/old", destination: "/new", type: 301, isPattern: false, enabled: true,
	hits: 0, lastHitAt: null, groupName: null, auto: false,
	createdAt: "2026-10-02T12:00:00.000Z", updatedAt: "2026-10-02T12:00:00.000Z",
};

// Paging: explicit page size; a cursor only continues the filters it came with.
{
	let paging = initialRedirectPaging();
	assert.deepEqual(redirectListRequest(paging), {
		search: null, enabled: null, auto: null, group: null, limit: 25, cursor: null,
	});
	assert.equal(redirectFiltersActive(paging.filters), false);
	paging = withRedirectFilters(paging, { search: "  /blog ", status: "disabled", origin: "automatic", group: " Imported " });
	assert.deepEqual(redirectListRequest(paging), {
		search: "/blog", enabled: false, auto: true, group: " Imported ", limit: 25, cursor: null,
	});
	paging = nextRedirectPage(paging, "c1");
	paging = nextRedirectPage(paging, "c2");
	assert.equal(redirectListRequest(paging).cursor, "c2");
	assert.equal(redirectListRequest(paging).search, "/blog", "later pages keep the filters");
	paging = previousRedirectPage(paging);
	assert.equal(redirectListRequest(paging).cursor, "c1");
	paging = nextRedirectPage(paging, "c2b");
	assert.deepEqual(paging.cursors, [null, "c1", "c2b"], "a new forward step replaces the old trail");
	paging = withRedirectFilters(paging, { status: "enabled" });
	assert.deepEqual([paging.page, paging.cursors], [0, [null]], "changing a filter starts again on page one");
	assert.equal(previousRedirectPage(initialRedirectPaging()).page, 0);
	assert.equal(redirectListRequest(paging, 100).limit, 100);
}

// Request errors: only refusals before the handler prove nothing was written.
{
	assert.equal(classifyRedirectRequestError({ status: 401 }), "denied");
	assert.equal(classifyRedirectRequestError({ status: 403 }), "denied");
	assert.equal(classifyRedirectRequestError({ status: 400 }), "rejected");
	assert.equal(classifyRedirectRequestError({ status: 404 }), "rejected");
	assert.equal(classifyRedirectRequestError({ status: 429 }), "rejected");
	assert.equal(classifyRedirectRequestError({ status: 408 }), "unknown");
	assert.equal(classifyRedirectRequestError({ status: 500 }), "unknown");
	assert.equal(classifyRedirectRequestError({ status: 502 }), "unknown");
	assert.equal(classifyRedirectRequestError(new TypeError("Failed to fetch")), "unknown");
	assert.equal(classifyRedirectRequestError(new DOMException("The operation timed out.", "TimeoutError")), "unknown");
	assert.equal(classifyRedirectRequestError(new Error("Invalid SEO admin response: redirects.create")), "unknown",
		"an unreadable success response may follow a committed write");
}

// Form: saved, refused, and unknown outcomes.
{
	assert.equal(redirectFormLocked(INITIAL_REDIRECT_FORM), false);
	const saved = redirectFormAfterResult({ status: "created", rule, confirmedBy: "host" });
	assert.equal(saved.phase, "saved");
	assert.equal(saved.saved?.id, rule.id);
	assert.equal(saved.notice?.message, "EmDash saved this rule.", "persistence is reported, not serving");
	assert.ok(redirectFormLocked(saved));
	const recovered = redirectFormAfterResult({ status: "created", rule, confirmedBy: "lookup" });
	assert.match(recovered.notice?.message ?? "", /Nothing was saved twice/);

	const invalid = redirectFormAfterResult({
		status: "invalid", errors: { source: { code: "file-extension", message: "EmDash does not redirect paths that end in a file extension, such as .html." } },
	});
	assert.equal(invalid.phase, "editing");
	assert.equal(invalid.fieldErrors.source?.code, "file-extension");

	const conflict = redirectFormAfterResult({ status: "conflict", reason: "trailing-slash", message: "same address", existing: rule });
	assert.ok(conflict.phase === "editing" && conflict.existing?.id === rule.id && conflict.notice?.tone === "error");
	const loop = redirectFormAfterResult({ status: "conflict", reason: "loop", message: "/a -> /b -> /a/", existing: null });
	assert.equal(loop.notice?.title, "This redirect would loop");

	const notSaved = redirectFormAfterResult({ status: "failed", reason: "not-saved", message: "kept", retryable: true });
	assert.ok(notSaved.phase === "editing" && notSaved.notice?.tone === "warning", "a proven absence allows saving again");
	const rejected = redirectFormAfterResult({ status: "failed", reason: "host-rejected", message: "no", retryable: false });
	assert.equal(rejected.notice?.tone, "error");
	const unavailable = redirectFormAfterResult({ status: "unavailable", reason: "read-only", message: "read only" });
	assert.equal(unavailable.phase, "editing");

	const uncertain = redirectFormAfterResult({ status: "uncertain", message: "Search for it in EmDash Redirects." });
	assert.equal(uncertain.phase, "uncertain");
	assert.ok(redirectFormLocked(uncertain), "an unknown outcome offers a check, not another save");

	assert.equal(redirectFormAfterCreateError(new TypeError("Failed to fetch")), "check");
	assert.equal(redirectFormAfterCreateError(Object.assign(new Error("Internal error"), { status: 500 })), "check");
	const denied = redirectFormAfterCreateError(Object.assign(new Error("Insufficient permissions"), { status: 403 }));
	assert.ok(denied !== "check" && denied.phase === "editing" && /manage redirects/.test(denied.notice?.message ?? ""));
	const badRequest = redirectFormAfterCreateError(Object.assign(new Error("Invalid input"), { status: 400 }));
	assert.ok(badRequest !== "check" && badRequest.phase === "editing");

	const unreachable = redirectFormAfterCheckError();
	assert.ok(unreachable.phase === "uncertain" && redirectFormLocked(unreachable));
}

// Empty pages and field errors.
{
	assert.equal(redirectEmptyPage(initialRedirectPaging()), "no-rules");
	assert.equal(redirectEmptyPage(withRedirectFilters(initialRedirectPaging(), { search: "/x" })), "no-matches");
	assert.equal(redirectEmptyPage(nextRedirectPage(initialRedirectPaging(), "c1")), "page-emptied",
		"an emptied later page keeps paging and claims nothing about the whole list");
	const errors = {
		destination: { code: "same-address" as const, message: "Loops." },
		type: { code: "type" as const, message: "Choose 301 or 302." },
	};
	assert.equal(firstInvalidRedirectField(errors), "destination");
	assert.equal(redirectFieldAnnouncement(errors), "The redirect was not saved. Destination path: Loops. Status code: Choose 301 or 302.");
	assert.equal(redirectFieldAnnouncement({}), "");
}

// Orchestration: deadlines, recovery, and state that outlives the components.
{
	const never = () => new Promise<never>(() => {});
	const fast = { createMs: 20, checkMs: 20 };
	const draft = { source: "/old", destination: "/new", type: 301 as const };

	const invalid = createRedirectFormStore({ ...INITIAL_REDIRECT_SNAPSHOT, draft: { ...draft, source: "/old.html" } });
	let calls = 0;
	await saveRedirectRule(invalid, { create: async () => { calls += 1; return { status: "created", rule, confirmedBy: "host" }; }, reconcile: never }, fast);
	assert.equal(calls, 0, "client validation stops the request");
	assert.equal(invalid.get().attempt, 1, "a stopped save is counted so focus moves and it is announced");
	assert.equal(invalid.get().form.fieldErrors.source?.code, "file-extension");

	const serverInvalid = createRedirectFormStore({ ...INITIAL_REDIRECT_SNAPSHOT, draft });
	await saveRedirectRule(serverInvalid, {
		create: async () => ({ status: "invalid", errors: { destination: { code: "same-address", message: "Loops." } } }),
		reconcile: never,
	}, fast);
	assert.equal(serverInvalid.get().attempt, 1);

	// A create without a response is reconciled; a reconcile that never answers
	// ends at its deadline as uncertain instead of locking the dialog.
	const lost = createRedirectFormStore({ ...INITIAL_REDIRECT_SNAPSHOT, draft });
	const started = Date.now();
	await saveRedirectRule(lost, { create: never, reconcile: never }, fast);
	assert.equal(lost.get().form.phase, "uncertain");
	assert.ok(Date.now() - started < 2_000, "both deadlines apply");

	// Leaving the tab unsubscribes the view; the unresolved save stays locked.
	let notified = 0;
	const unsubscribe = lost.subscribe(() => { notified += 1; });
	unsubscribe();
	const remounted = lost.get();
	assert.ok(redirectFormUnresolved(remounted.form) && redirectFormLocked(remounted.form));
	assert.equal(remounted.draft.source, "/old");
	await saveRedirectRule(lost, { create: async () => { throw new Error("must not be called"); }, reconcile: never }, fast);
	assert.equal(lost.get().form.phase, "uncertain", "Save does nothing while the outcome is unknown");

	// Check again: absence stays uncertain; a found rule settles it.
	await checkRedirectRule(lost, { create: never, reconcile: async () => ({ status: "uncertain", message: "Not found yet." }) }, fast);
	assert.equal(lost.get().form.phase, "uncertain");
	const saved: string[] = [];
	await checkRedirectRule(lost, {
		create: never,
		reconcile: async () => ({ status: "created", rule, confirmedBy: "lookup" }),
		onSaved: (found) => { saved.push(found.id); },
	}, fast);
	assert.equal(lost.get().form.phase, "saved");
	assert.deepEqual(saved, [rule.id]);
	assert.equal(notified, 0, "an unsubscribed view is not called");

	const refused = createRedirectFormStore({ ...INITIAL_REDIRECT_SNAPSHOT, draft });
	await saveRedirectRule(refused, {
		create: async () => { throw Object.assign(new Error("Insufficient permissions"), { status: 403 }); },
		reconcile: async () => { throw new Error("a refused create needs no check"); },
	}, fast);
	assert.equal(refused.get().form.phase, "editing");
}

// Invalid save, correction, success, then Create another: the reset form is
// empty and untouched, and nothing counts as a new stopped save.
{
	const store = createRedirectFormStore();
	const actions = { create: async () => ({ status: "created" as const, rule, confirmedBy: "host" as const }), reconcile: async () => { throw new Error("unused"); } };
	await saveRedirectRule(store, actions);
	assert.equal(store.get().attempt, 1, "the empty form is stopped once");
	store.update((current) => ({ ...current, draft: { source: "/old", destination: "/new", type: 301 } }));
	await saveRedirectRule(store, actions);
	assert.equal(store.get().form.phase, "saved");
	assert.equal(store.get().attempt, 1);
	resetRedirectForm(store);
	const fresh = store.get();
	assert.deepEqual([fresh.form.phase, fresh.draft.source, fresh.touched.source, fresh.attempt], ["editing", "", false, 1],
		"a reset keeps the counter, so the view neither announces nor focuses");
}

// Create redirect from a 404 row starts the existing form with that source.
{
	const store = createRedirectFormStore();
	store.update((current) => ({ ...current, draft: { source: "/typed", destination: "/elsewhere", type: 302 }, attempt: 3 }));
	assert.equal(prefillRedirectForm(store, "/missing-page"), "prefilled");
	const started = store.get();
	assert.deepEqual(started.draft, { source: "/missing-page", destination: "", type: 301 }, "a fresh draft with the missing path as source");
	assert.deepEqual([started.touched.source, started.touched.destination], [true, false], "the source shows its validation at once");
	assert.deepEqual([started.form, started.attempt], [INITIAL_REDIRECT_FORM, 3], "the stopped-save counter only grows");
	store.update((current) => ({ ...current, form: { ...current.form, phase: "saved", saved: rule } }));
	assert.equal(prefillRedirectForm(store, "/second"), "prefilled", "a confirmed earlier save starts a new form");
	assert.equal(store.get().form.phase, "editing");
	for (const phase of ["saving", "checking", "uncertain"] as const) {
		store.update((current) => ({ ...current, draft: { source: "/pending", destination: "/new", type: 301 }, form: { ...INITIAL_REDIRECT_FORM, phase } }));
		const before = store.get();
		assert.equal(prefillRedirectForm(store, "/missing-page"), "unresolved");
		assert.equal(store.get(), before, phase + ": an unresolved save keeps its draft for review");
	}
}

console.log("SEO redirect rules view model self-check passed.");
