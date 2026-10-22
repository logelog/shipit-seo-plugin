import assert from "node:assert/strict";

import { SEO_ADMIN_CONTRACT_VERSION, type SeoAdminTemplateExample, type SeoAdminTemplateExampleResult } from "@shipitseo/emdash-plugin-seo/admin-contract";
import { QueryClient, QueryObserver } from "@tanstack/react-query";

import {
	IDLE_TEMPLATE_EXAMPLE_LOOKUP,
	parseTemplateExampleRef,
	resolveTemplateExampleSelection,
	templateExampleLookup,
	templateExampleQueryPolicy,
	type TemplateExampleLookup,
	type TemplateExampleSelectionInput,
} from "./template-example-selection-model.ts";

const listedEntry = (entryId: string, title = `Entry ${entryId}`): SeoAdminTemplateExample =>
	({ entryId, title, slug: entryId, locale: "en", publishedAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" });
const target = (entryId: string, title = `Entry ${entryId}`) => ({ entryId, title, slug: entryId, locale: "en" });
const firstPage = Array.from({ length: 25 }, (_, index) => listedEntry(`p${index + 1}`));
const secondPage = Array.from({ length: 25 }, (_, index) => listedEntry(`p${index + 26}`));
const answered = (result: SeoAdminTemplateExampleResult): TemplateExampleLookup => ({ status: "answered", result });
const found = (entryId: string, collection = "posts"): SeoAdminTemplateExampleResult => ({
	success: true, contractVersion: SEO_ADMIN_CONTRACT_VERSION, collection, entryId,
	example: { ...listedEntry(entryId, `Exact ${entryId}`), locale: "fr" },
});
const refused = (entryId: string, error: "not_found" | "not_published" | "invalid_locale" = "not_published"): SeoAdminTemplateExampleResult =>
	({ success: false, error, collection: "posts", entryId, message: `refused ${error}` });

function resolve(patch: Partial<TemplateExampleSelectionInput>) {
	return resolveTemplateExampleSelection({
		request: null, active: "posts", activeAvailable: true, remembered: null, listed: null, lookup: IDLE_TEMPLATE_EXAMPLE_LOOKUP,
		...patch,
	});
}

// ---- References: only collection:entryId within the exact read's limits ----
{
	assert.deepEqual(parseTemplateExampleRef("posts:p1"), { ref: "posts:p1", collection: "posts", entryId: "p1" });
	assert.deepEqual(parseTemplateExampleRef("posts:a:b"), { ref: "posts:a:b", collection: "posts", entryId: "a:b" }, "only the first separator splits");
	for (const ref of ["posts", ":p1", "posts:", "", "Bad Type:p1", `posts:${"x".repeat(129)}`]) {
		const parsed = parseTemplateExampleRef(ref);
		assert.equal(parsed.collection, null, `${JSON.stringify(ref)} is malformed`);
		assert.equal(parsed.entryId, null);
		assert.equal(parsed.ref, ref, "the malformed reference stays visible as requested");
	}
}

// ---- Without a request: the first published entry once, then the remembered one ----
{
	const fresh = resolve({ listed: firstPage });
	assert.deepEqual(fresh.selection, { kind: "none" });
	assert.deepEqual(fresh.first, target("p1"), "the ordinary first published example is chosen automatically");
	assert.equal(fresh.lookup, false, "and needs no exact read");
	assert.equal(resolve({ listed: null }).first, null, "a page that has not loaded chooses nothing");
	assert.equal(resolve({ listed: [] }).first, null, "an empty page chooses nothing");
	const remembered = resolve({ listed: firstPage, remembered: target("p7") });
	assert.deepEqual(remembered.selection, { kind: "selected", requested: false, example: target("p7") });
	assert.equal(remembered.first, null, "a remembered example is never replaced by the first row");
	assert.deepEqual(resolve({ listed: secondPage, remembered: target("p7") }).selection.kind, "selected", "paging keeps the remembered example");
}

// ---- An off-page request is read exactly, once, and never substituted ----
{
	const request = parseTemplateExampleRef("posts:p40");
	const pending = resolve({ request, listed: firstPage });
	assert.deepEqual(pending.selection, { kind: "loading", collection: "posts", entryId: "p40" });
	assert.equal(pending.lookup, true, "an entry outside the listed page needs one exact read");
	assert.equal(pending.first, null, "the first row is not chosen while a request is open");
	assert.equal(resolve({ request, listed: null }).lookup, true, "the read does not wait for the page");
	assert.equal(resolve({ request, listed: firstPage, lookup: { status: "pending" } }).lookup, false, "a running read is not sent again");
	const exact = resolve({ request, listed: firstPage, remembered: target("p3"), lookup: answered(found("p40")) });
	assert.deepEqual(exact.selection, { kind: "selected", requested: true, example: { entryId: "p40", title: "Exact p40", slug: "p40", locale: "fr" } },
		"the exact answer is shown with its actual locale, not the remembered entry");
	assert.equal(exact.lookup, false);
	assert.deepEqual(resolve({ request, listed: secondPage, remembered: target("p40") }).selection,
		{ kind: "selected", requested: true, example: target("p40") }, "once resolved, paging keeps the requested entry without another read");
	assert.equal(resolve({ request, listed: secondPage, remembered: target("p40") }).lookup, false);
}

// ---- A listed or remembered option for the same entry needs no read ----
{
	const request = parseTemplateExampleRef("posts:p5");
	const listed = resolve({ request, listed: firstPage, remembered: target("p1") });
	assert.deepEqual(listed.selection, { kind: "selected", requested: true, example: target("p5") });
	assert.equal(listed.lookup, false);
	const remembered = resolve({ request, remembered: target("p5") });
	assert.equal(remembered.selection.kind, "selected");
	assert.equal(remembered.lookup, false);
	for (const locale of ["", "x".repeat(36)]) {
		const unlisted = resolve({ request, listed: firstPage.map((entry) => entry.entryId === "p5" ? { ...entry, locale } : entry) });
		assert.deepEqual([unlisted.selection.kind, unlisted.lookup], ["loading", true], `a listed option with locale ${JSON.stringify(locale.slice(0, 3))} needs the exact read`);
		const unremembered = resolve({ request, remembered: { ...target("p5"), locale } });
		assert.deepEqual([unremembered.selection.kind, unremembered.lookup], ["loading", true], "so does a remembered one");
	}
}

// ---- Refusals and failures keep the request and choose nothing else ----
{
	const request = parseTemplateExampleRef("posts:p5");
	for (const error of ["not_found", "not_published", "invalid_locale"] as const) {
		const result = resolve({ request, listed: firstPage, remembered: target("p1"), lookup: answered(refused("p5", error)) });
		assert.deepEqual(result.selection, { kind: "refused", collection: "posts", entryId: "p5", message: `refused ${error}` }, `${error} selects nothing`);
		assert.equal(result.first, null);
	}
	const outranked = resolve({ request, listed: firstPage, remembered: target("p5"), lookup: answered(refused("p5")) });
	assert.equal(outranked.selection.kind, "refused", "a cached refusal outranks a listed or remembered option for the same entry until Retry");
	assert.equal(outranked.lookup, false, "and is not read again automatically");
	assert.deepEqual(resolve({ request, listed: firstPage, lookup: { status: "failed" } }).selection, { kind: "failed", collection: "posts", entryId: "p5" });
	for (const foreign of [{ ...refused("p5"), entryId: "p6" }, { ...refused("p5"), collection: "pages" }] as SeoAdminTemplateExampleResult[]) {
		const result = resolve({ request, listed: firstPage, lookup: answered(foreign) });
		assert.deepEqual(result.selection, { kind: "failed", collection: "posts", entryId: "p5" },
			`a refusal for ${JSON.stringify([(foreign as any).collection, (foreign as any).entryId])} is not attributed to posts:p5 or its message shown`);
	}
	assert.deepEqual(resolve({ request, lookup: answered({ success: false, error: "invalid_input", message: "Choose." }) }).selection,
		{ kind: "refused", collection: "posts", entryId: "p5", message: "Choose." }, "malformed input has no bound identity by contract");
	assert.equal(resolve({ request, lookup: answered({ ...found("p5"), example: { ...listedEntry("p5"), locale: "" } } as SeoAdminTemplateExampleResult) }).selection.kind,
		"failed", "an exact answer without a usable locale is never selected");
	const mismatched = resolve({ request, listed: firstPage, lookup: answered(found("p6")) });
	assert.equal(mismatched.selection.kind, "failed", "an answer for another entry is never shown as the request");
	assert.equal(resolve({ request, lookup: answered(found("p5", "pages")) }).selection.kind, "failed", "or for another collection");
	assert.equal(resolve({ request, listed: [], lookup: answered(refused("p5")) }).first, null, "an empty page does not clear the refusal");
}

// ---- Malformed requests and unavailable types are visible states ----
{
	const malformed = resolve({ request: parseTemplateExampleRef("posts"), listed: firstPage });
	assert.deepEqual(malformed.selection, { kind: "invalid", ref: "posts" });
	assert.equal(malformed.first, null, "a malformed request is not an absent request");
	assert.equal(malformed.lookup, false);
	const requested = resolve({ request: parseTemplateExampleRef("internal:i1"), active: "internal", activeAvailable: false, listed: firstPage });
	assert.deepEqual(requested.selection, { kind: "type-unavailable", collection: "internal", entryId: "i1" });
	assert.equal(requested.lookup, false, "an ineligible type is not read");
	assert.equal(requested.first, null);
	assert.deepEqual(resolve({ activeAvailable: false, remembered: target("p1") }).selection, { kind: "type-unavailable", collection: "posts", entryId: null },
		"a removed active type shows as unavailable instead of its remembered example");
	assert.deepEqual(resolve({ active: null }).selection, { kind: "none" });
}

// ---- The query cache maps to the newest outcome ----
{
	assert.deepEqual(templateExampleLookup({ fetching: true, status: "success", data: refused("p5") }), { status: "pending" }, "Retry shows as reading");
	assert.deepEqual(templateExampleLookup({ fetching: false, status: "error", data: refused("p5") }), { status: "failed" }, "a failed Retry replaces the earlier answer");
	assert.deepEqual(templateExampleLookup({ fetching: false, status: "success", data: found("p5") }), answered(found("p5")));
	assert.deepEqual(templateExampleLookup({ fetching: false, status: "pending", data: undefined }), IDLE_TEMPLATE_EXAMPLE_LOOKUP, "a disabled query that never ran is idle");
}

// ---- Query policy on the real observer: a cached failure waits for Retry when its key returns ----
{
	const client = new QueryClient();
	const calls: string[] = [];
	let failA = true;
	let holdC = true;
	const exampleKey = (entryId: string) => ["shipit-seo-workspace", "template-example", "posts", entryId] as const;
	const options = (entryId: string, wanted = true) => ({
		queryKey: exampleKey(entryId),
		queryFn: ({ signal }: { signal: AbortSignal }) => {
			calls.push(entryId);
			if (entryId === "A" && failA) return Promise.reject(new Error("network"));
			if (entryId === "C" && holdC) {
				return new Promise<SeoAdminTemplateExampleResult>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
			}
			return Promise.resolve(entryId === "R" ? refused("R") : found(entryId));
		},
		...templateExampleQueryPolicy(wanted),
	});
	const settle = async (done: () => boolean, label: string) => {
		for (let turn = 0; turn < 50 && !done(); turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
		assert.ok(done(), label);
	};
	const observer = new QueryObserver<SeoAdminTemplateExampleResult>(client, options("A") as any);
	const unsubscribe = observer.subscribe(() => undefined);
	await settle(() => observer.getCurrentResult().status === "error", "a fresh request is read once and its transport failure is kept");
	assert.deepEqual(calls, ["A"]);
	observer.setOptions(options("B") as any);
	await settle(() => observer.getCurrentResult().status === "success", "another request is read");
	observer.setOptions(options("A") as any);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(calls, ["A", "B"], "returning to A with a cached failure and no data sends no read");
	assert.equal(observer.getCurrentResult().status, "error");
	failA = false;
	await observer.refetch();
	assert.deepEqual(calls, ["A", "B", "A"], "Retry repeats that one read");
	assert.equal(observer.getCurrentResult().data?.success, true);

	observer.setOptions(options("R") as any);
	await settle(() => observer.getCurrentResult().status === "success", "a refusal is an answer");
	observer.setOptions(options("B") as any);
	observer.setOptions(options("R") as any);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(calls.filter((id) => id === "R"), ["R"], "a cached refusal is not read again");

	observer.setOptions(options("C") as any);
	await settle(() => calls.includes("C"), "a read starts");
	observer.setOptions(options("B") as any);
	holdC = false;
	observer.setOptions(options("C") as any);
	await settle(() => observer.getCurrentResult().status === "success", "a canceled read is recovered when its key returns");
	assert.deepEqual(calls.filter((id) => id === "C"), ["C", "C"]);

	const before = calls.length;
	observer.setOptions(options("D", false) as any);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(calls.length, before, "an entry known from the list or memory is not read");
	unsubscribe();
	client.clear();
}

console.log("template example selection model selfcheck passed");
