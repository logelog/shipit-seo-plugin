import seoRuntime from "./sandbox-entry.ts";

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
	if (ok) {
		console.log(`  PASS  ${name}`);
		return;
	}
	failures += 1;
	console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
}

function createStore(initial: Array<[string, unknown]> = []) {
	const values = new Map(initial);
	let puts = 0;
	return {
		get puts() {
			return puts;
		},
		has: (id: string) => values.has(id),
		get: async (id: string) => structuredClone(values.get(id) ?? null),
		put: async (id: string, value: unknown) => {
			puts += 1;
			values.set(id, structuredClone(value));
		},
		compareAndSet: async (id: string, expected: any, next: any) => {
			const present = values.has(id);
			if (expected.state === "missing" ? present : !present) return false;
			if (
				expected.state === "value" &&
				JSON.stringify(values.get(id)) !== JSON.stringify(expected.value)
			)
				return false;
			if (next.action === "delete") return values.delete(id);
			puts += 1;
			values.set(id, structuredClone(next.value));
			return true;
		},
		delete: async (id: string) => values.delete(id),
		count: async () => values.size,
		query: async ({ limit = 100 }: { limit?: number } = {}) => ({
			items: [...values.entries()].slice(0, limit).map(([id, data]) => ({ id, data: structuredClone(data) })),
			cursor: undefined,
			hasMore: values.size > limit,
		}),
	};
}

function span(text: string) {
	return { _type: "span", text, marks: [] };
}

function block(text: string, style = "normal") {
	return { _type: "block", style, markDefs: [], children: [span(text)] };
}

const post = {
	id: "post-1",
	type: "posts",
	slug: "growth-guide",
	status: "published",
	locale: "en",
	seo: {
		title: "Growth marketing guide for sustainable demand",
		description: "A practical growth marketing guide for teams that want clearer positioning, useful content and measurable long-term demand.",
		image: "https://example.com/og/growth-guide.png",
		canonical: "https://example.com/blog/growth-guide",
		noIndex: false,
	},
	data: {
		title: "Growth guide",
		excerpt: "A practical growth marketing guide for sustainable demand.",
		content: [
			block("Growth marketing foundations", "h2"),
			...Array.from({ length: 20 }, () => block("Growth marketing connects research, useful content, measurement, and sustained customer demand.")),
		],
	},
	createdAt: "2026-07-14T09:00:00.000Z",
	updatedAt: "2026-07-14T10:00:00.000Z",
	publishedAt: "2026-07-14T10:00:00.000Z",
};

const secondPost = {
	...post,
	id: "post-2",
	slug: "growth-guide-alternate",
	updatedAt: "2026-07-14T09:30:00.000Z",
};

const scores = createStore();
const emptyStore = () => createStore();
const metaOverrides = emptyStore();
const scoreAnalysisRevisions = emptyStore();
const kv = new Map<string, unknown>([
	["settings:global:v1", {
		version: 1, updatedAt: "2026-10-15T00:00:00.000Z",
		siteName: "Example", siteUrl: "https://example.com",
		organizationName: "Example", organizationLogo: "", socialProfiles: [],
		defaultSocialImage: "", twitterHandle: "", noindex: false,
		contentScoringEnabled: true, contentScoringResourceNoticeVersion: 1,
	}],
	["configuration:analysis-profile:v1:posts", {
		profile: "article", version: 1, updatedAt: "2026-10-15T00:00:00.000Z",
	}],
]);
let contentListCalls = 0;
const contentGets: string[] = [];
const context = {
	plugin: { id: "shipit-seo", version: "test" },
	schema: { listCollections: async () => [{
		slug: "posts", label: "Blog posts", labelSingular: "Post", hasSeo: true,
		urlPattern: "/blog/{slug}", routable: true, hidden: false,
	}] },
	kv: {
		get: async (key: string) => structuredClone(kv.get(key) ?? null),
		// Published hosts read settings with revisions; unchanged rows keep one.
		getVersioned: async (key: string) => kv.has(key) ? { value: structuredClone(kv.get(key)), revision: "r1" } : null,
		set: async (key: string, value: unknown) => kv.set(key, structuredClone(value)),
		delete: async (key: string) => kv.delete(key),
		list: async () => [],
	},
	storage: {
		overrides: emptyStore(),
		metaOverrides,
		schemas: emptyStore(),
		scores,
		scoreAnalysisRevisions,
		migrations: emptyStore(),
	},
	content: {
		getPublicUrl: async (collection: string, id: string) => {
			if (collection !== "posts") return null;
			const item = id === post.id ? post : id === secondPost.id ? secondPost : null;
			return item ? `https://example.com/blog/${encodeURIComponent(item.slug)}` : null;
		},
		list: async (collection: string) => {
			contentListCalls += 1;
			return {
				items:
					collection === "posts"
						? [structuredClone(post), structuredClone(secondPost)]
						: [],
				cursor: undefined,
				hasMore: false,
			};
		},
		get: async (collection: string, id: string) => {
			contentGets.push(`${collection}:${id}`);
			if (collection !== "posts") return null;
			if (id === post.id) return structuredClone(post);
			if (id === secondPost.id) return structuredClone(secondPost);
			return null;
		},
	},
	url: (path: string) => new URL(path, "https://example.com").href,
	log: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined },
};

function admin(input: Record<string, unknown>) {
	const handler = (seoRuntime as any).routes.admin.handler as (routeContext: any, pluginContext: any) => Promise<any>;
	return handler({ input, request: { url: "https://example.com/_emdash/api/plugins/shipit-seo/admin", method: "POST", headers: {} } }, context);
}

function pluginRoute(name: string, input: Record<string, unknown>) {
	const handler = (seoRuntime as any).routes[name].handler as (
		routeContext: any,
		pluginContext: any,
	) => Promise<any>;
	return handler(
		{
			input,
			request: {
				url: `https://example.com/_emdash/api/plugins/shipit-seo/${name}`,
				method: "POST",
				headers: {},
			},
		},
		context,
	);
}

function findBlock(blocks: any[], predicate: (block: any) => boolean): any | undefined {
	for (const block of blocks) {
		if (predicate(block)) return block;
		for (const key of ["blocks", "columns", "elements"]) {
			const nested = block?.[key];
			if (!Array.isArray(nested)) continue;
			const flat = key === "columns" ? nested.flat() : nested;
			const match = findBlock(flat, predicate);
			if (match) return match;
		}
	}
	return undefined;
}

const initial = await admin({ page: "analyzer" });
const analyzerForm = findBlock(initial.blocks, (block) => block.block_id === "seo_content_analyzer");
const contentField = analyzerForm?.fields?.find((field: any) => field.action_id === "ref");
const categoryField = analyzerForm?.fields?.find((field: any) => field.action_id === "category");
const refreshButton = findBlock(
	initial.blocks,
	(block) => block.action_id === "refresh_analyzer_scores",
);
const refreshAction = JSON.parse(refreshButton?.value ?? "null");
check("content analyzer renders its workspace", Boolean(findBlock(initial.blocks, (block) => block.title === "Content analysis workspace")));
check(
	"duplicate titles receive readable unique labels",
	contentField?.options?.find((option: any) => option.value === contentField.initial_value)?.label ===
		"Blog posts · Growth guide (1)",
);
check(
	"content selector keeps storage refs behind readable labels",
	contentField?.initial_value === "posts:post-1" &&
		contentField?.options?.every((option: any) => option.label !== option.value),
);
check("category selector exposes a readable value", categoryField?.initial_value === "All checks", String(categoryField?.initial_value));
check("category selector exposes Image SEO", categoryField?.options?.some((option: any) => option.value === "Images") === true);
check(
	"score refresh names and scopes one bounded collection page",
	refreshButton?.label === "Refresh first 100 posts scores" &&
		refreshAction?.collection === "posts" &&
		refreshAction?.cursor === undefined,
);
check(
	"opening the analyzer leaves scores and analysis reservations unchanged",
	scores.puts === 0 && scoreAnalysisRevisions.puts === 0,
	`score puts ${scores.puts}, reservation puts ${scoreAnalysisRevisions.puts}`,
);

const rejectedDashboardRefresh = await admin({ action_id: "refresh_scores" });
check(
	"dashboard refresh fails closed without a collection choice",
	rejectedDashboardRefresh.toast?.type === "error" && scores.puts === 0,
);

const scoreWritesBeforeCollectionRefresh = scores.puts;
const collectionRefresh = await admin({
	action_id: "refresh_analyzer_scores",
	value: refreshButton.value,
});
check(
	"explicit analyzer refresh analyzes and saves its selected collection page",
	collectionRefresh.toast?.type === "success" &&
		collectionRefresh.toast?.message?.includes("2 posts entries processed, 2 scores saved") &&
		scores.puts === scoreWritesBeforeCollectionRefresh + 2,
	collectionRefresh.toast?.message,
);

const scoreWritesBeforeFormSubmit = scores.puts;
const reservationPutsBeforeFormSubmit = scoreAnalysisRevisions.puts;
const filtered = await admin({
	type: "form_submit",
	block_id: "seo_content_analyzer",
	values: {
		ref: "posts:post-2",
		keyword: "growth marketing",
		category: "Readability",
	},
});
check("form submission analyzes the selected entry", filtered.toast?.type === "success", filtered.toast?.message);
check("explicit keyword is reflected in analyzer output", JSON.stringify(filtered.blocks).includes("growth marketing"));
check("readability filter is preserved", Boolean(findBlock(filtered.blocks, (block) => block.text === "Readability (2)")));
check(
	"a trial keyword is analyzed without touching the stored score",
	scores.puts === scoreWritesBeforeFormSubmit && scoreAnalysisRevisions.puts === reservationPutsBeforeFormSubmit &&
		filtered.toast?.message?.includes("(not saved)") === true,
	`puts ${scores.puts}`,
);
const ownedKeywordSubmit = await admin({
	type: "form_submit",
	block_id: "seo_content_analyzer",
	values: { ref: "posts:post-2", category: "All checks" },
});
check(
	"a submission without a trial keyword reuses the unchanged persisted score",
	ownedKeywordSubmit.toast?.type === "success" && ownedKeywordSubmit.toast?.message?.includes("(reused)") === true &&
		scores.puts === scoreWritesBeforeFormSubmit && scoreAnalysisRevisions.puts === reservationPutsBeforeFormSubmit,
	`puts ${scores.puts}`,
);
const scoreBeforeSavedChange = await scores.get("posts:post-2") as any;
secondPost.data = { ...secondPost.data, excerpt: "A changed saved excerpt, so the analysis inputs differ." };
const changedSubmit = await admin({
	type: "form_submit",
	block_id: "seo_content_analyzer",
	values: { ref: "posts:post-2", category: "All checks" },
});
check(
	"a submission after a saved change recomputes and persists the score",
	changedSubmit.toast?.message?.includes("(saved)") === true && scores.puts === scoreWritesBeforeFormSubmit + 1 &&
		(await scores.get("posts:post-2") as any)?.inputIdentity !== scoreBeforeSavedChange?.inputIdentity &&
		(await scores.get("posts:post-2") as any)?.analysisRevision > scoreBeforeSavedChange?.analysisRevision,
	`puts ${scores.puts}`,
);
check("duplicate-title selection resolves the intended entry", scores.has("posts:post-2"));
const dataSources = findBlock(changedSubmit.blocks, (block) => block.type === "accordion" && block.label === "Recommendations and data sources");
const shownSources: string[] = (findBlock(dataSources?.blocks ?? [], (block) => block.type === "fields")?.fields ?? [])
	.map((field: any) => /Source: (.*)\.$/.exec(String(field.value))?.[1] ?? "");
check(
	"the analyzer names every data source in words, never a snake_case storage key",
	shownSources.length > 0 && shownSources.every((source) => source !== "" && !/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/i.test(source)) &&
		shownSources.includes("saved featured image or image field"),
	JSON.stringify(shownSources),
);

const invalid = await admin({
	type: "form_submit",
	block_id: "seo_content_analyzer",
	values: { ref: "Posts · Missing entry", category: "All checks" },
});
check("invalid content selection fails safely", invalid.toast?.type === "error");
check("invalid content selection does not create a missing score", !scores.has("posts:missing"));

contentListCalls = 0;
contentGets.length = 0;
const scoresHandler = (seoRuntime as any).routes.scores.handler as (
	routeContext: any,
	pluginContext: any,
) => Promise<any>;
const visibleScores = await scoresHandler(
	{
		input: {
			refs: ["posts:post-1", "posts:post-2", "posts:post-1"],
			limit: 3,
		},
		request: {
			url: "https://example.com/_emdash/api/plugins/shipit-seo/scores",
			method: "POST",
			headers: {},
		},
	},
	context,
);
check("bounded score requests do not list the collection", contentListCalls === 0);
check(
	"bounded score requests read only unique visible entries",
	JSON.stringify(contentGets) === JSON.stringify(["posts:post-1", "posts:post-2"]),
	JSON.stringify(contentGets),
);
check("bounded score requests return the requested entries", visibleScores.items?.length === 2);
check(
	"bounded score requests do not expose hidden pagination",
	visibleScores.hasMore === false && visibleScores.cursor === undefined,
);

// Legacy snapshots allow arbitrary numbers for indexed ordering and cursor cases.
const scoreTemplate = { ...(await scores.get("posts:post-1") as any), scoreVersion: 19 };
const storedRows = [
	["posts:high", { ...scoreTemplate, ref: "posts:high", entryId: "high", score: 90 }],
	["posts:low-b", { ...scoreTemplate, ref: "posts:low-b", entryId: "low-b", score: 5 }],
	["posts:middle", { ...scoreTemplate, ref: "posts:middle", entryId: "middle", score: 40 }],
	["posts:low-a", { ...scoreTemplate, ref: "posts:low-a", entryId: "low-a", score: 5 }],
] as const;
const storedQueries: any[] = [];
const orderedScoresContext = {
	...context,
	storage: {
		...context.storage,
		scores: {
			query: async (query: any) => {
				storedQueries.push(query);
				const rows = query.orderBy?.score === "asc"
					? [...storedRows].sort((left, right) => left[1].score - right[1].score || left[0].localeCompare(right[0]))
					: [...storedRows];
				const start = query.cursor ? rows.findIndex(([id]) => id === query.cursor) + 1 : 0;
				const page = rows.slice(start, start + query.limit);
				return {
					items: page.map(([id, data]) => ({ id, data })),
					cursor: start + query.limit < rows.length ? page.at(-1)?.[0] : undefined,
					hasMore: start + query.limit < rows.length,
				};
			},
		},
	},
};
const storedPage = (cursor?: string) => scoresHandler(
	{ input: { collection: "posts", storedOnly: true, limit: 2, ...(cursor ? { cursor } : {}) } },
	orderedScoresContext,
);
const firstStoredPage = await storedPage();
const secondStoredPage = await storedPage(firstStoredPage.cursor);
check(
	"stored score pages start with the lowest numeric scores, including ties",
	JSON.stringify(firstStoredPage.items.map((item: any) => item.ref)) ===
		JSON.stringify(["posts:low-a", "posts:low-b"]),
);
check(
	"stored score cursor continues after tied scores",
	firstStoredPage.hasMore === true && secondStoredPage.hasMore === false &&
		JSON.stringify(secondStoredPage.items.map((item: any) => item.ref)) ===
			JSON.stringify(["posts:middle", "posts:high"]),
);
check(
	"stored score pages use the indexed score order for every cursor",
	storedQueries.length === 2 && storedQueries.every((query) =>
		query.where?.collection === "posts" && query.orderBy?.score === "asc" && query.limit === 2),
);

const presetSave = await pluginRoute("save-entry-directives", {
	ref: "posts:post-1",
	disabledPresets: ["blogPosting"],
});
check(
	"entry schema presets can be disabled",
	presetSave.success === true &&
		JSON.stringify(presetSave.item?.disabledPresets) === JSON.stringify(["blogPosting"]),
);
const robotsOnlySave = await pluginRoute("save-entry-directives", {
	ref: "posts:post-1",
	robots: { nofollow: true },
});
check(
	"robots-only saves preserve disabled schema presets",
	robotsOnlySave.success === true &&
		robotsOnlySave.item?.robots?.nofollow === true &&
		JSON.stringify(robotsOnlySave.item?.disabledPresets) === JSON.stringify(["blogPosting"]),
);
const explicitPresetReset = await pluginRoute("save-entry-directives", {
	ref: "posts:post-1",
	robots: { nofollow: true },
	disabledPresets: [],
});
check(
	"an explicit empty preset list still enables every preset",
	explicitPresetReset.success === true &&
		explicitPresetReset.item?.robots?.nofollow === true &&
		explicitPresetReset.item?.disabledPresets?.length === 0,
);
await pluginRoute("save-entry-directives", {
	ref: "posts:post-1",
	robots: {},
	disabledPresets: [],
});
await Promise.all([
	pluginRoute("save-entry-directives", {
		ref: "posts:post-1",
		robots: { nofollow: true },
	}),
	pluginRoute("save-entry-directives", {
		ref: "posts:post-1",
		disabledPresets: ["blogPosting"],
	}),
]);
const concurrentDirectives = await pluginRoute("entry-directives", {
	ref: "posts:post-1",
});
check(
	"concurrent robots and schema saves preserve both dimensions",
	concurrentDirectives.success === true &&
		concurrentDirectives.item?.robots?.nofollow === true &&
		JSON.stringify(concurrentDirectives.item?.disabledPresets) ===
			JSON.stringify(["blogPosting"]),
);
const invalidNullPresets = await pluginRoute("save-entry-directives", {
	ref: "posts:post-1",
	disabledPresets: null,
});
check(
	"explicit null cannot masquerade as an empty preset list",
	invalidNullPresets.success === false && invalidNullPresets.error === "invalid_values",
);

const originalRevisionCompareAndSet = scoreAnalysisRevisions.compareAndSet;
scoreAnalysisRevisions.compareAndSet = async () => {
	throw new Error("Injected score refresh failure");
};
const savedWithoutScoreRefresh = await pluginRoute("save-entry-directives", {
	ref: "posts:post-1",
	robots: { nofollow: true, noarchive: true },
});
scoreAnalysisRevisions.compareAndSet = originalRevisionCompareAndSet;
check(
	"a committed directives save remains successful when score refresh fails",
	savedWithoutScoreRefresh.success === true &&
		savedWithoutScoreRefresh.item?.robots?.noarchive === true,
);

await metaOverrides.put("posts:post-1", { poisoned: true });
const poisonedDirectives = await pluginRoute("entry-directives", {
	ref: "posts:post-1",
});
check(
	"invalid directives storage never appears as an empty successful record",
	poisonedDirectives.success === false && poisonedDirectives.error === "storage_unavailable",
);
await metaOverrides.delete("posts:post-1");
const availableMetaOverrides = context.storage.metaOverrides;
delete (context.storage as any).metaOverrides;
const unavailableDirectives = await pluginRoute("entry-directives", {
	ref: "posts:post-1",
});
(context.storage as any).metaOverrides = availableMetaOverrides;
check(
	"missing directives storage is reported as unavailable",
	unavailableDirectives.success === false &&
		unavailableDirectives.error === "storage_unavailable",
);

check("an indexable entry shows no exclusion banner", !findBlock(changedSubmit.blocks, (block) => block.title === "Excluded from search"));
secondPost.seo = { ...secondPost.seo, noIndex: true };
const excludedSubmit = await admin({
	type: "form_submit",
	block_id: "seo_content_analyzer",
	values: { ref: "posts:post-2", category: "All checks" },
});
secondPost.seo = { ...secondPost.seo, noIndex: false };
const exclusionBanner = findBlock(excludedSubmit.blocks, (block) => block.type === "banner" && block.title === "Excluded from search");
check(
	"a published noindex entry names its exclusion, as the editor does, without a checklist row",
	/marked noindex/.test(exclusionBanner?.description ?? "") && !JSON.stringify(excludedSubmit.blocks).includes('"Excluded from search: '),
	JSON.stringify(exclusionBanner),
);

console.log(failures === 0 ? "\nALL SEO ADMIN ANALYZER CHECKS PASSED" : `\n${failures} SEO ADMIN ANALYZER CHECK(S) FAILED`);
if (failures > 0) throw new Error(`${failures} SEO admin analyzer self-check(s) failed`);
