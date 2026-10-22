import assert from "node:assert/strict";

import type { SeoAdminContentScores } from "@shipitseo/emdash-plugin-seo/admin-contract";
import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_SCORE_VERSION,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import { loadSeoWorkQueueScores, SEO_WORK_QUEUE_PAGE_LIMIT } from "./work-queue-data.ts";

function scorePage(
	collection: string,
	{
		cursor,
		hasMore = false,
		items = [{ collection } as SeoAdminContentScores["items"][number]],
	}: {
		cursor?: string;
		hasMore?: boolean;
		items?: SeoAdminContentScores["items"];
	} = {},
): SeoAdminContentScores {
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		generatedAt: "2026-07-15T07:59:00.000Z",
		engineVersion: "test-engine",
		scoreVersion: SEO_SCORE_VERSION,
		items,
		cursor,
		hasMore,
	};
}

const requested: Array<{ collection?: string; limit?: number; cursor?: string; storedOnly?: boolean }> = [];
const first = await loadSeoWorkQueueScores({
	collection: "posts",
	fetchContentScores: async (query = {}) => {
		requested.push(query);
		return scorePage("posts", { cursor: "next", hasMore: true });
	},
});
const second = await loadSeoWorkQueueScores({
	collection: "posts",
	cursor: first.cursor,
	fetchContentScores: async (query = {}) => {
		requested.push(query);
		return scorePage("posts");
	},
});
assert.deepEqual(requested, [
	{ collection: "posts", limit: SEO_WORK_QUEUE_PAGE_LIMIT, storedOnly: true },
	{ collection: "posts", limit: SEO_WORK_QUEUE_PAGE_LIMIT, storedOnly: true, cursor: "next" },
]);
assert.equal(first.hasMore, true);
assert.equal(second.hasMore, false);

for (const invalidPage of [
		scorePage("posts", { hasMore: true }),
		scorePage("posts", { cursor: "same", hasMore: true }),
		scorePage("posts", { items: Array.from({ length: SEO_WORK_QUEUE_PAGE_LIMIT + 1 },
		() => ({ collection: "posts" } as SeoAdminContentScores["items"][number])) }),
]) {
	await assert.rejects(
		loadSeoWorkQueueScores({ collection: "posts", cursor: "same", fetchContentScores: async () => invalidPage }),
		/pagination did not advance/,
	);
}
const emptyFilteredPage = await loadSeoWorkQueueScores({
	collection: "posts",
	fetchContentScores: async () => scorePage("posts", { cursor: "next", hasMore: true, items: [] }),
});
assert.equal(emptyFilteredPage.items.length, 0);
assert.equal(emptyFilteredPage.cursor, "next", "a filtered empty page must keep its advancing cursor");

let invalidCalls = 0;
await assert.rejects(
	loadSeoWorkQueueScores({ collection: "all", fetchContentScores: async () => {
		invalidCalls += 1;
		return scorePage("posts");
	} }),
	/Choose a content type/,
);
assert.equal(invalidCalls, 0, "an unselected queue must not read score tables");

console.log("SEO work queue data self-check passed.");
