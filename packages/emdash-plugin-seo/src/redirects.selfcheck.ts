import assert from "node:assert/strict";

import {
	REDIRECT_CHAIN_MAX_HOPS,
	REDIRECT_CHAIN_MAX_READS,
	REDIRECT_CURSOR_MAX_LENGTH,
	REDIRECT_EDIT_INPUT_MAX_LENGTH,
	REDIRECT_EDIT_PREFLIGHT_MS,
	REDIRECT_GROUP_MAX_LENGTH,
	REDIRECT_ID_MAX_LENGTH,
	REDIRECT_LIST_MAX_PAGE_SIZE,
	REDIRECT_LIST_PAGE_SIZE,
	REDIRECT_LOOKUP_PAGES,
	REDIRECT_PATH_MAX_LENGTH,
	RedirectHostError,
	createRedirectRule,
	interpolateRedirectDestination,
	interpolateRedirectDestinationWithin,
	findRedirectRuleBySource,
	listRedirectRules,
	loadRedirectRule,
	normalizeRedirectRuleListQuery,
	reconcileRedirectRule,
	reconcileRedirectRuleUpdate,
	redirectAliasKey,
	redirectRequestPathname,
	redirectRuleConfiguration,
	redirectRuleEditability,
	updateRedirectRule,
	validateRedirectRuleDraft,
	type RedirectHost,
	type RedirectHostListOptions,
	type RedirectHostPage,
	type RedirectRule,
	type RedirectRuleDraft,
	type RedirectRuleEditDraft,
	type RedirectRulePatch,
	type VersionedRedirectRule,
} from "./redirects.ts";

// ---------------------------------------------------------------------------
// Validation follows the host middleware: pathname only, one trailing-slash
// alternate, no /_emdash, /_image or file-extension sources.
// ---------------------------------------------------------------------------

function sourceIssue(source: string): string | undefined {
	const result = validateRedirectRuleDraft({ source, destination: "/target", type: 301 });
	return result.valid ? undefined : result.errors.source?.code;
}

function destinationIssue(destination: string, source = "/origin"): string | undefined {
	const result = validateRedirectRuleDraft({ source, destination, type: 301 });
	return result.valid ? undefined : result.errors.destination?.code;
}

{
	const valid = validateRedirectRuleDraft({ source: "  /old-page ", destination: "/new-page", type: 302 });
	assert.deepEqual(valid, { valid: true, rule: { source: "/old-page", destination: "/new-page", type: 302 } });

	const encoded = validateRedirectRuleDraft({ source: "/café menu", destination: "/caf%c3%a9/new?ref=old#top", type: 301 });
	assert.ok(encoded.valid);
	assert.equal(encoded.rule.source, "/caf%C3%A9%20menu", "raw characters are encoded as a browser requests them");
	assert.equal(encoded.rule.destination, "/caf%c3%a9/new?ref=old#top", "destinations keep their escapes, query and fragment");
	// Astro decodes and re-encodes the request pathname before the middleware
	// compares it, so every spelling of the same path is stored one way.
	for (const spelling of ["/caf%c3%a9", "/café", "/caf%C3%A9", "/caf%25c3%25a9"]) {
		const result = validateRedirectRuleDraft({ source: spelling, destination: "/cafe", type: 301 });
		assert.ok(result.valid, spelling);
		assert.equal(result.rule.source, "/caf%C3%A9", spelling);
		assert.equal(redirectRequestPathname(new URL(`https://site.example${spelling}?ref=menu`).pathname), result.rule.source,
			`a request for ${spelling} reaches the stored source`);
	}
	assert.equal(validateRedirectRuleDraft({ source: "/a//b", destination: "/c", type: 301 }).valid &&
		redirectRequestPathname("/a//b"), "/a/b", "repeated slashes collapse");
	assert.equal(sourceIssue("/a/%5Bslug%5D"), "pattern", "decoded brackets would make a pattern");
	assert.equal(sourceIssue("/a/%255C"), "invalid-encoding");
	assert.equal(sourceIssue("/a/%252e%252e/b"), "invalid-encoding", "decoded dot segments would resolve away");
	assert.equal(redirectRequestPathname("/a%2fb"), "/a%2fb", "reserved escapes stay as sent");

	const issues: Array<[string, string]> = [
		["", "required"],
		["old-page", "not-a-path"],
		["https://example.com/old", "absolute-url"],
		["//example.com/old", "protocol-relative"],
		["/\\example.com", "protocol-relative"],
		["/old\\page", "backslash"],
		["/old\tpage", "control-characters"],
		["/old?ref=1", "query"],
		["/old#section", "fragment"],
		["/a/../b", "dot-segment"],
		["/a/%2e%2e/b", "dot-segment"],
		["/./a", "dot-segment"],
		["/a%zz", "invalid-encoding"],
		["/blog/[slug]", "pattern"],
		["/_emdash/admin", "reserved-path"],
		["/_image/photo", "reserved-path"],
		["/old-page.html", "file-extension"],
		["/release/v1.2", "file-extension"],
		[`/${"a".repeat(REDIRECT_PATH_MAX_LENGTH)}`, "too-long"],
	];
	for (const [source, code] of issues) assert.equal(sourceIssue(source), code, `source ${JSON.stringify(source)}`);

	assert.equal(destinationIssue("https://example.com/new"), "absolute-url", "destinations stay on this site");
	assert.equal(destinationIssue("/files/report.pdf"), undefined, "a destination may be a file");
	assert.equal(destinationIssue("/new?x=1#top"), undefined);
	assert.equal(destinationIssue("/new#top?x"), undefined);
	assert.equal(destinationIssue("/new/[slug]"), "pattern");
	assert.equal(destinationIssue("//evil.example"), "protocol-relative");

	for (const [source, destination] of [
		["/a", "/a/"], ["/a/", "/a"], ["/a", "/a?utm=1"], ["/a", "/a/#top"], ["/", "/?ref=home"], ["/a", "/a"],
	]) {
		assert.equal(destinationIssue(destination, source), "same-address", `${source} to ${destination} loops`);
	}
	assert.equal(destinationIssue("/a", "/a//"), "same-address", "Astro collapses /a// to /a/, an alias of /a");
	assert.equal(destinationIssue("/a", "/a/b/"), undefined);

	const several = validateRedirectRuleDraft({ source: "/old.html", destination: "example.com", type: 307 });
	assert.equal(several.valid, false);
	assert.deepEqual(Object.keys(several.valid ? {} : several.errors).sort(), ["destination", "source", "type"]);
	assert.equal(validateRedirectRuleDraft(null).valid, false);
	assert.equal(redirectAliasKey("/"), "/");
	assert.equal(redirectAliasKey("/a/"), "/a");
}

// ---------------------------------------------------------------------------
// An in-memory host with the published list semantics: newest first, substring
// search on source or destination, exact group, at most 100 rows per page.
// ---------------------------------------------------------------------------

interface FakeHostOptions {
	readOnly?: boolean;
	createBehavior?: (draft: RedirectRuleDraft, store: FakeStore) => Promise<RedirectRule>;
	listFailure?: (options: RedirectHostListOptions, call: number) => Error | null;
	/** Rewrites a page after the published semantics produced it. */
	pageTransform?: (page: RedirectHostPage, options: RedirectHostListOptions) => RedirectHostPage;
	getBehavior?: (id: string, store: FakeStore, call: number) => Promise<VersionedRedirectRule | null>;
	updateBehavior?: (id: string, patch: RedirectRulePatch, revision: string, store: FakeStore) => Promise<VersionedRedirectRule>;
}

interface FakeStore {
	rules: RedirectRule[];
	revisions: Map<string, string>;
	insert(draft: Partial<RedirectRule> & { source: string; destination: string }): RedirectRule;
	/** A serialized copy, as a host read returns it. */
	version(id: string): VersionedRedirectRule | null;
	/** A committed configuration write: rotates the revision, keeps activity. */
	apply(id: string, patch: Partial<RedirectRule>): VersionedRedirectRule;
	/** The published conditional update, without its final read. */
	conditionalUpdate(id: string, patch: RedirectRulePatch, revision: string): VersionedRedirectRule;
	/** A public request: activity changes, the configuration revision does not. */
	hit(id: string): void;
	remove(id: string): void;
}

function fakeHost(options: FakeHostOptions = {}) {
	let sequence = 0;
	let revisionSequence = 0;
	const nextRevision = () => `r1.fake-${(revisionSequence += 1)}`;
	const find = (id: string) => store.rules.findIndex((rule) => rule.id === id);
	const store: FakeStore = {
		rules: [],
		revisions: new Map(),
		insert(draft) {
			sequence += 1;
			const at = new Date(Date.UTC(2026, 9, 2, 12, 0, sequence)).toISOString();
			const rule: RedirectRule = {
				id: `r${String(sequence).padStart(4, "0")}`,
				type: 301, isPattern: false, enabled: true, hits: 0, lastHitAt: null,
				groupName: null, auto: false, createdAt: at, updatedAt: at,
				...draft,
			};
			store.rules.push(rule);
			store.revisions.set(rule.id, nextRevision());
			return rule;
		},
		version(id) {
			const index = find(id);
			return index === -1 ? null : structuredClone({ rule: store.rules[index]!, revision: store.revisions.get(id)! });
		},
		apply(id, patch) {
			const index = find(id);
			store.rules[index] = { ...store.rules[index]!, ...patch, updatedAt: new Date(Date.UTC(2026, 9, 3, 12, 0, sequence += 1)).toISOString() };
			store.revisions.set(id, nextRevision());
			return store.version(id)!;
		},
		conditionalUpdate(id, patch, revision) {
			const index = find(id);
			if (index === -1) throw new RedirectHostError("failed", `Redirect "${id}" not found`);
			if (store.revisions.get(id) !== revision) throw new RedirectHostError("stale", "Redirect changed since it was read");
			const next = { ...store.rules[index]!, ...patch };
			if (patch.source !== undefined && store.rules.some((rule) => rule.id !== id && rule.source === patch.source)) {
				throw new RedirectHostError("conflict", `A redirect from "${patch.source}" already exists`);
			}
			if (next.source === next.destination) {
				throw new RedirectHostError("validation", "Source and destination must be different");
			}
			return store.apply(id, patch);
		},
		hit(id) {
			const index = find(id);
			const at = new Date(Date.UTC(2026, 9, 3, 18, 0, sequence += 1)).toISOString();
			store.rules[index] = { ...store.rules[index]!, hits: store.rules[index]!.hits + 1, lastHitAt: at, updatedAt: at };
		},
		remove(id) {
			store.rules.splice(find(id), 1);
			store.revisions.delete(id);
		},
	};
	const listCalls: RedirectHostListOptions[] = [];
	const creates: RedirectRuleDraft[] = [];
	const gets: string[] = [];
	const updates: Array<{ id: string; patch: RedirectRulePatch; revision: string }> = [];
	const host: RedirectHost = {
		async list(query) {
			listCalls.push(query);
			const failure = options.listFailure?.(query, listCalls.length);
			if (failure) throw failure;
			const term = query.search?.toLowerCase();
			const matching = store.rules
				.filter((rule) => !term || rule.source.toLowerCase().includes(term) || rule.destination.toLowerCase().includes(term))
				.filter((rule) => query.group === undefined || rule.groupName === query.group)
				.filter((rule) => query.enabled === undefined || rule.enabled === query.enabled)
				.filter((rule) => query.auto === undefined || rule.auto === query.auto)
				.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
			const limit = Math.min(Math.max(query.limit, 1), REDIRECT_LIST_MAX_PAGE_SIZE);
			let start = 0;
			if (query.cursor) {
				if (!query.cursor.startsWith("after:")) throw new RedirectHostError("invalid-cursor", "Invalid cursor");
				start = matching.findIndex((rule) => rule.id === query.cursor!.slice(6)) + 1;
			}
			const items = matching.slice(start, start + limit);
			const page = { items, cursor: start + limit < matching.length ? `after:${items.at(-1)!.id}` : null };
			return options.pageTransform ? options.pageTransform(page, query) : page;
		},
		async get(id) {
			gets.push(id);
			if (options.getBehavior) return options.getBehavior(id, store, gets.length);
			return store.version(id);
		},
	};
	if (!options.readOnly) {
		host.create = async (draft) => {
			creates.push(draft);
			if (options.createBehavior) return options.createBehavior(draft, store);
			if (store.rules.some((rule) => rule.source === draft.source)) {
				throw new RedirectHostError("conflict", `A redirect from "${draft.source}" already exists`);
			}
			return store.insert(draft);
		};
		host.update = async (id, patch, revision) => {
			updates.push({ id, patch, revision });
			if (options.updateBehavior) return options.updateBehavior(id, patch, revision, store);
			return store.conditionalUpdate(id, patch, revision);
		};
	}
	return { host, store, listCalls, creates, gets, updates };
}

// List: explicit page size, filters only when set, cursor continues them.
{
	assert.deepEqual(normalizeRedirectRuleListQuery(undefined), {
		search: null, enabled: null, auto: null, group: null, limit: REDIRECT_LIST_PAGE_SIZE, cursor: null,
	});
	const normalized = normalizeRedirectRuleListQuery({ search: "  /blog ", group: " Imported ", limit: 500, cursor: "", enabled: false });
	assert.equal(normalized.search, "/blog");
	assert.equal(normalized.group, " Imported ", "group names match exactly");
	assert.equal(normalized.limit, REDIRECT_LIST_MAX_PAGE_SIZE);
	assert.equal(normalized.cursor, null);
	assert.equal(normalizeRedirectRuleListQuery({ limit: 0 }).limit, 1);

	const { host, store, listCalls } = fakeHost();
	for (let index = 0; index < 30; index += 1) {
		store.insert({ source: `/old-${index}`, destination: `/new-${index}`, enabled: index % 3 !== 0, groupName: index < 5 ? "Imported" : null });
	}
	const first = await listRedirectRules(host, { limit: 10, enabled: true }, { canManage: true });
	assert.equal(first.status, "ok");
	if (first.status !== "ok") throw new Error("unreachable");
	assert.equal(first.items.length, 10);
	assert.ok(first.items.every((rule) => rule.enabled));
	assert.equal(first.hasMore, true);
	assert.equal(first.create, "available");
	assert.deepEqual(listCalls.at(-1), { limit: 10, enabled: true }, "unset filters are not sent");
	const pages = [first.items];
	let cursor = first.cursor;
	while (cursor) {
		const next = await listRedirectRules(host, { limit: 10, enabled: true, cursor }, { canManage: true });
		assert.equal(next.status, "ok");
		if (next.status !== "ok") throw new Error("unreachable");
		assert.deepEqual(listCalls.at(-1), { limit: 10, enabled: true, cursor }, "the cursor keeps the same filters");
		pages.push(next.items);
		cursor = next.cursor;
	}
	assert.deepEqual(pages.map((page) => page.length), [10, 10]);
	assert.equal(new Set(pages.flat().map((rule) => rule.id)).size, 20, "pages do not repeat rules");

	const grouped = await listRedirectRules(host, { group: "Imported", search: "old-" }, { canManage: false });
	assert.ok(grouped.status === "ok" && grouped.items.length === 5 && grouped.create === "no-permission");
	const invalid = await listRedirectRules(host, { cursor: "forged" }, { canManage: true });
	assert.equal(invalid.status, "invalid-cursor");
	const readOnly = await listRedirectRules(fakeHost({ readOnly: true }).host, {}, { canManage: true });
	assert.ok(readOnly.status === "ok" && readOnly.create === "read-only");
	assert.equal((await listRedirectRules(null, {}, { canManage: true })).status, "unavailable");
	const failing = fakeHost({ listFailure: () => new Error("database is locked") });
	assert.equal((await listRedirectRules(failing.host, {}, { canManage: true })).status, "failed");
}

// Create: access, validation, duplicates and trailing-slash aliases.
{
	assert.equal((await createRedirectRule(null, {})).status, "unavailable");
	const readOnly = await createRedirectRule(fakeHost({ readOnly: true }).host, { source: "/a", destination: "/b", type: 301 });
	assert.ok(readOnly.status === "unavailable" && readOnly.reason === "read-only");

	const invalid = fakeHost();
	const rejected = await createRedirectRule(invalid.host, { source: "/old.html", destination: "/new", type: 301 });
	assert.equal(rejected.status, "invalid");
	assert.equal(invalid.listCalls.length + invalid.creates.length, 0, "invalid input never reaches the host");

	const fresh = fakeHost();
	const created = await createRedirectRule(fresh.host, { source: "/old-page", destination: "/new-page", type: 301 });
	assert.ok(created.status === "created" && created.confirmedBy === "host");
	assert.equal(created.rule.source, "/old-page");
	assert.equal(fresh.store.rules.length, 1);
	assert.deepEqual(fresh.listCalls, [
		{ limit: REDIRECT_LIST_MAX_PAGE_SIZE, search: "/old-page" },
		{ limit: REDIRECT_LIST_MAX_PAGE_SIZE, search: "/new-page" },
		{ limit: REDIRECT_LIST_MAX_PAGE_SIZE, search: "[", enabled: true },
	], "one alias read, one chain read and one pattern read");

	const again = await createRedirectRule(fresh.host, { source: "/old-page", destination: "/elsewhere", type: 302 });
	assert.ok(again.status === "conflict" && again.reason === "duplicate");
	assert.equal(again.existing?.destination, "/new-page");
	assert.equal(fresh.creates.length, 1, "a known duplicate is not sent to the host");

	const alias = await createRedirectRule(fresh.host, { source: "/old-page/", destination: "/other", type: 301 });
	assert.ok(alias.status === "conflict" && alias.reason === "trailing-slash");
	assert.equal(alias.existing?.source, "/old-page");
	fresh.store.insert({ source: "/blog/[slug]", destination: "/posts/[slug]", isPattern: true });
	const patternNeighbour = await createRedirectRule(fresh.host, { source: "/blog/[slug]x", destination: "/b", type: 301 });
	assert.equal(patternNeighbour.status, "invalid");
	const overridesPattern = await createRedirectRule(fresh.host, { source: "/blog/launch", destination: "/posts/launch", type: 301 });
	assert.equal(overridesPattern.status, "created", "an exact rule may sit in front of a pattern");

	const busy = fakeHost();
	for (let index = 0; index < REDIRECT_LIST_MAX_PAGE_SIZE * REDIRECT_LOOKUP_PAGES + 1; index += 1) {
		busy.store.insert({ source: `/shop/item-${index}`, destination: "/shop" });
	}
	const unchecked = await createRedirectRule(busy.host, { source: "/shop", destination: "/store", type: 301 });
	assert.ok(unchecked.status === "conflict" && unchecked.reason === "check-incomplete");
	assert.equal(busy.listCalls.length, REDIRECT_LOOKUP_PAGES, "the alias check stops at its page bound");
	assert.equal(busy.creates.length, 0);

	const root = fakeHost();
	for (let index = 0; index < 400; index += 1) root.store.insert({ source: `/p${index}`, destination: "/" });
	const home = await createRedirectRule(root.host, { source: "/", destination: "/home", type: 302 });
	assert.ok(home.status === "created", "the root path has no alias to search for");
	assert.deepEqual(root.listCalls.map((call) => call.search), ["/home", "["], "only the chain is read");

	const unreadable = fakeHost({ listFailure: () => new Error("timeout") });
	const notChecked = await createRedirectRule(unreadable.host, { source: "/a", destination: "/b", type: 301 });
	assert.ok(notChecked.status === "conflict" && notChecked.reason === "check-incomplete");
	assert.equal(unreadable.creates.length, 0);
}

// Create: host rejections keep their meaning.
{
	const busy = fakeHost({ createBehavior: async () => { throw new RedirectHostError("busy", "Another redirect change is in progress"); } });
	const busyResult = await createRedirectRule(busy.host, { source: "/a", destination: "/b", type: 301 });
	assert.ok(busyResult.status === "failed" && busyResult.reason === "busy" && busyResult.retryable);

	const loop = fakeHost({
		createBehavior: async () => { throw new RedirectHostError("validation", "This redirect would create a loop:\n/b → /a", true); },
	});
	const loopResult = await createRedirectRule(loop.host, { source: "/a", destination: "/b", type: 301 });
	assert.ok(loopResult.status === "conflict" && loopResult.reason === "loop");
	assert.match(loopResult.message, /would create a loop/);

	const hostValidation = fakeHost({
		createBehavior: async () => { throw new RedirectHostError("validation", "URL must not contain path traversal segments"); },
	});
	const hostRejected = await createRedirectRule(hostValidation.host, { source: "/a", destination: "/b", type: 301 });
	assert.ok(hostRejected.status === "failed" && hostRejected.reason === "host-rejected" && !hostRejected.retryable);

	// A rule created by someone else between the alias check and the write.
	const race = fakeHost({
		createBehavior: async (draft, store) => {
			store.insert({ source: draft.source, destination: "/theirs" });
			throw new RedirectHostError("conflict", `A redirect from "${draft.source}" already exists`);
		},
	});
	const raced = await createRedirectRule(race.host, { source: "/a", destination: "/b", type: 301 });
	assert.ok(raced.status === "conflict" && raced.reason === "duplicate");
	assert.equal(raced.existing?.destination, "/theirs");
}

// Create: an error that can follow a committed write is settled by a bounded
// lookup, never by a second create.
{
	const committed = fakeHost({
		createBehavior: async (draft, store) => {
			store.insert({ ...draft });
			throw new RedirectHostError("failed", "Failed to create redirect");
		},
	});
	const recovered = await createRedirectRule(committed.host, { source: "/a", destination: "/b", type: 302 });
	assert.ok(recovered.status === "created" && recovered.confirmedBy === "lookup");
	assert.equal(recovered.rule.type, 302);
	assert.equal(committed.creates.length, 1);
	assert.equal(committed.store.rules.length, 1);

	const lost = fakeHost({ createBehavior: async () => { throw new TypeError("fetch failed"); } });
	const notSaved = await createRedirectRule(lost.host, { source: "/a", destination: "/b", type: 301 });
	assert.ok(notSaved.status === "failed" && notSaved.reason === "not-saved" && notSaved.retryable);
	assert.equal(lost.creates.length, 1, "nothing is retried automatically");

	// The root path skips the alias check, so only the lookup meets its bound.
	const crowded = fakeHost({ createBehavior: async () => { throw new RedirectHostError("failed", "Failed to create redirect"); } });
	for (let index = 0; index < REDIRECT_LIST_MAX_PAGE_SIZE * REDIRECT_LOOKUP_PAGES + 1; index += 1) {
		crowded.store.insert({ source: `/p${index}`, destination: "/landing" });
	}
	const uncertain = await createRedirectRule(crowded.host, { source: "/", destination: "/home", type: 301 });
	assert.equal(uncertain.status, "uncertain");
	assert.match(uncertain.status === "uncertain" ? uncertain.message : "", /EmDash Redirects/);
	assert.equal(crowded.listCalls.filter((call) => call.search === "/").length, REDIRECT_LOOKUP_PAGES,
		"the lookup stops at its page bound");
	assert.equal(crowded.creates.length, 1);

	const differs = fakeHost({
		createBehavior: async (draft, store) => {
			store.insert({ source: draft.source, destination: "/someone-else" });
			throw new RedirectHostError("failed", "Created redirect not found");
		},
	});
	const conflict = await createRedirectRule(differs.host, { source: "/a", destination: "/b", type: 301 });
	assert.ok(conflict.status === "conflict" && conflict.reason === "duplicate" && conflict.existing?.destination === "/someone-else");
}

// Create: chains are followed the way the middleware serves them, so loops
// through a trailing slash or a query string are refused before any write.
{
	const trailing = fakeHost();
	trailing.store.insert({ source: "/a", destination: "/b/" });
	const slashLoop = await createRedirectRule(trailing.host, { source: "/b", destination: "/a", type: 301 });
	assert.ok(slashLoop.status === "conflict" && slashLoop.reason === "loop");
	assert.match(slashLoop.message, /\/b -> \/a -> \/b\//);
	assert.equal(trailing.creates.length, 0, "the host's literal check would have accepted this rule");

	const query = fakeHost();
	query.store.insert({ source: "/b", destination: "/a" });
	const queryLoop = await createRedirectRule(query.host, { source: "/a", destination: "/b?x=1", type: 302 });
	assert.ok(queryLoop.status === "conflict" && queryLoop.reason === "loop");
	assert.equal(query.creates.length, 0);

	const cycle = fakeHost();
	cycle.store.insert({ source: "/x", destination: "/y" });
	cycle.store.insert({ source: "/y/", destination: "/x" });
	const intoCycle = await createRedirectRule(cycle.host, { source: "/start", destination: "/x", type: 301 });
	assert.ok(intoCycle.status === "conflict" && intoCycle.reason === "loop", "an existing loop is not fed new visitors");
	assert.match(intoCycle.message, /\/start -> \/x -> \/y -> \/x/);

	const ends = fakeHost();
	ends.store.insert({ source: "/b", destination: "/c" });
	ends.store.insert({ source: "/b/", destination: "/a" });
	ends.store.insert({ source: "/c", destination: "/a", enabled: false });
	ends.store.insert({ source: "/gone", destination: "", type: 410 });
	const exactFirst = await createRedirectRule(ends.host, { source: "/a", destination: "/b", type: 301 });
	assert.equal(exactFirst.status, "created", "the exact /b rule wins over /b/, and disabled rules are not served");
	const terminal = await createRedirectRule(ends.host, { source: "/old", destination: "/gone", type: 301 });
	assert.equal(terminal.status, "created", "a 410 ends the chain");
	const before = ends.listCalls.length;
	const asset = await createRedirectRule(ends.host, { source: "/report", destination: "/files/report.pdf", type: 301 });
	assert.equal(asset.status, "created");
	assert.deepEqual(ends.listCalls.slice(before).map((call) => call.search), ["/report"],
		"the middleware never redirects a file path, so the chain is not read");

	const long = fakeHost();
	for (let hop = 0; hop <= REDIRECT_CHAIN_MAX_HOPS; hop += 1) long.store.insert({ source: `/h${hop}`, destination: `/h${hop + 1}` });
	const tooLong = await createRedirectRule(long.host, { source: "/start", destination: "/h0", type: 301 });
	assert.ok(tooLong.status === "conflict" && tooLong.reason === "check-incomplete");
	assert.equal(long.creates.length, 0);
	assert.ok(long.listCalls.length <= REDIRECT_LOOKUP_PAGES + REDIRECT_CHAIN_MAX_READS);

	const wide = fakeHost();
	for (let index = 0; index < REDIRECT_LIST_MAX_PAGE_SIZE * REDIRECT_CHAIN_MAX_READS + 1; index += 1) {
		wide.store.insert({ source: `/w${index}`, destination: `/v${index}` });
	}
	const home = await createRedirectRule(wide.host, { source: "/old-home", destination: "/", type: 301 });
	assert.ok(home.status === "conflict" && home.reason === "check-incomplete", "the read budget bounds the root lookup");
	assert.equal(wide.listCalls.filter((call) => call.search === "/").length, REDIRECT_CHAIN_MAX_READS);
	assert.equal(wide.creates.length, 0);

	const failing = fakeHost({ listFailure: (query) => query.search === "/b" ? new Error("database is locked") : null });
	const unread = await createRedirectRule(failing.host, { source: "/a", destination: "/b", type: 301 });
	assert.ok(unread.status === "conflict" && unread.reason === "check-incomplete");
	assert.equal(failing.creates.length, 0);
}

// Existing destinations are followed as Astro serves them, even when new input
// in the same form would be refused: the core only decodes them once.
{
	const nested = fakeHost();
	nested.store.insert({ source: "/next", destination: "/a/%252e%252e/start" });
	const dotLoop = await createRedirectRule(nested.host, { source: "/start", destination: "/next", type: 301 });
	assert.ok(dotLoop.status === "conflict" && dotLoop.reason === "loop", "Astro decodes twice and the URL setter resolves /a/../start");
	assert.match(dotLoop.message, /\/start -> \/next -> \/start/);
	assert.equal(nested.creates.length, 0);
	assert.equal(redirectRequestPathname("/a/%252e%252e/start"), "/start");
	assert.equal(sourceIssue("/a/%252e%252e/start"), "invalid-encoding", "the same text is refused as new input");

	const deep = fakeHost();
	// "A" escaped eleven times: Astro gives up after ten further decodes.
	deep.store.insert({ source: "/next", destination: `/x%${"25".repeat(10)}41` });
	const unknown = await createRedirectRule(deep.host, { source: "/start", destination: "/next", type: 301 });
	assert.ok(unknown.status === "conflict" && unknown.reason === "check-incomplete",
		"a destination Astro marks as invalid encoding is never treated as a safe end");
	assert.equal(redirectRequestPathname(`/x%${"25".repeat(10)}41`), null);
	assert.equal(redirectRequestPathname(`/x%${"25".repeat(9)}41`), "/xA");
	assert.equal(redirectRequestPathname("/a%zz//b"), "/a%zz/b", "a malformed escape stays as sent");
}

// Patterns: an existing core pattern rule can close the loop, so enabled
// patterns are evaluated in the host's order when no exact rule applies.
{
	const pattern = fakeHost();
	pattern.store.insert({ source: "/b/[slug]", destination: "/a/", isPattern: true });
	const patternLoop = await createRedirectRule(pattern.host, { source: "/a", destination: "/b/x", type: 301 });
	assert.ok(patternLoop.status === "conflict" && patternLoop.reason === "loop");
	assert.match(patternLoop.message, /\/a -> \/b\/x -> \/a\//);
	assert.equal(pattern.creates.length, 0);
	assert.ok(pattern.listCalls.some((call) => call.search === "[" && call.enabled === true), "patterns are read once, enabled only");

	const older = fakeHost();
	older.store.insert({ source: "/b/[slug]", destination: "/c", isPattern: true });
	older.store.insert({ source: "/b/[...rest]", destination: "/a", isPattern: true });
	assert.equal((await createRedirectRule(older.host, { source: "/a", destination: "/b/x", type: 301 })).status, "created",
		"the oldest matching pattern wins");
	const newer = fakeHost();
	newer.store.insert({ source: "/b/[...rest]", destination: "/a", isPattern: true });
	newer.store.insert({ source: "/b/[slug]", destination: "/c", isPattern: true });
	const newerLoop = await createRedirectRule(newer.host, { source: "/a", destination: "/b/x", type: 301 });
	assert.ok(newerLoop.status === "conflict" && newerLoop.reason === "loop");

	const ignored = fakeHost();
	ignored.store.insert({ source: "/b/[slug]", destination: "/a", isPattern: true, enabled: false });
	ignored.store.insert({ source: "/b/x[slug]", destination: "/a", isPattern: true });
	ignored.store.insert({ source: "/b/[id]/gone", destination: "", type: 410, isPattern: true });
	assert.equal((await createRedirectRule(ignored.host, { source: "/a", destination: "/b/x", type: 301 })).status, "created",
		"disabled patterns and patterns the host skips as invalid are not served");
	assert.equal((await createRedirectRule(ignored.host, { source: "/c", destination: "/b/1/gone", type: 301 })).status, "created",
		"a 410 pattern ends the chain");

	const many = fakeHost();
	for (let index = 0; index < REDIRECT_LIST_MAX_PAGE_SIZE * (REDIRECT_CHAIN_MAX_READS - 1) + 1; index += 1) {
		many.store.insert({ source: `/p${index}/[slug]`, destination: `/q${index}/[slug]`, isPattern: true });
	}
	const unchecked = await createRedirectRule(many.host, { source: "/a", destination: "/b/x", type: 301 });
	assert.ok(unchecked.status === "conflict" && unchecked.reason === "check-incomplete",
		"patterns that do not fit in the read budget cannot be ruled out");
	assert.equal(many.creates.length, 0);
	assert.ok(many.listCalls.length <= REDIRECT_LOOKUP_PAGES + REDIRECT_CHAIN_MAX_READS);

	const unreadable = fakeHost({ listFailure: (query) => query.search === "[" ? new Error("database is locked") : null });
	const failed = await createRedirectRule(unreadable.host, { source: "/a", destination: "/b/x", type: 301 });
	assert.ok(failed.status === "conflict" && failed.reason === "check-incomplete");
}

// Create: the host's readback must be the requested rule; a changed record is
// never reported as this rule being created.
{
	for (const [label, change] of [
		["destination", { destination: "/elsewhere" }],
		["source", { source: "/other" }],
		["type", { type: 308 }],
		["state", { enabled: false }],
		["kind", { isPattern: true }],
	] as const) {
		const changed = fakeHost({ createBehavior: async (draft, store) => store.insert({ ...draft, ...change }) });
		const result = await createRedirectRule(changed.host, { source: "/a", destination: "/b", type: 301 });
		assert.equal(result.status, "uncertain", `a changed ${label} is not success`);
		assert.match(result.status === "uncertain" ? result.message : "", /differs from the request/);
		assert.equal(changed.creates.length, 1);
	}
}

// Recovery while the original request is still running: a reconcile before its
// write stays uncertain; once the write lands, the same check confirms it.
{
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const delayed = fakeHost({
		createBehavior: async (draft, store) => {
			await gate;
			return store.insert({ ...draft });
		},
	});
	const original = createRedirectRule(delayed.host, { source: "/slow", destination: "/done", type: 301 });
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(delayed.creates.length, 1, "the original create is waiting before its write");
	const early = await reconcileRedirectRule(delayed.host, { source: "/slow", destination: "/done", type: 301 });
	assert.equal(early.status, "uncertain", "momentary absence does not unlock another save");
	release();
	const finished = await original;
	assert.ok(finished.status === "created" && finished.confirmedBy === "host");
	const late = await reconcileRedirectRule(delayed.host, { source: "/slow", destination: "/done", type: 301 });
	assert.ok(late.status === "created" && late.confirmedBy === "lookup");
	assert.equal(delayed.store.rules.filter((rule) => rule.source === "/slow").length, 1);
}

// Reconcile: the admin's recovery after a response never arrived.
{
	const { host, store, creates } = fakeHost();
	const notYet = await reconcileRedirectRule(host, { source: "/a", destination: "/b", type: 301 });
	assert.equal(notYet.status, "uncertain", "a lost request may still be running, so absence is not final");
	store.insert({ source: "/a", destination: "/b", type: 301 });
	const found = await reconcileRedirectRule(host, { source: "/a", destination: "/b", type: 301 });
	assert.ok(found.status === "created" && found.confirmedBy === "lookup");
	const other = await reconcileRedirectRule(host, { source: "/a", destination: "/c", type: 301 });
	assert.ok(other.status === "conflict" && other.reason === "duplicate");
	assert.equal(creates.length, 0, "reconciliation never writes");
	assert.equal((await reconcileRedirectRule(host, { source: "a", destination: "/b", type: 301 })).status, "invalid");
	assert.equal((await reconcileRedirectRule(null, { source: "/a", destination: "/b", type: 301 })).status, "unavailable");

	const many = fakeHost();
	for (let index = 0; index < REDIRECT_LIST_MAX_PAGE_SIZE * REDIRECT_LOOKUP_PAGES + 1; index += 1) {
		many.store.insert({ source: `/sale/${index}`, destination: "/sale" });
	}
	assert.deepEqual(await findRedirectRuleBySource(many.host, "/sale"), { state: "unknown", reason: "too-many" });
	assert.equal(many.listCalls.length, REDIRECT_LOOKUP_PAGES);
	const unreachable = fakeHost({ listFailure: () => new Error("offline") });
	assert.deepEqual(await findRedirectRuleBySource(unreachable.host, "/a"), { state: "unknown", reason: "failed" });
}

// ---------------------------------------------------------------------------
// Editing one rule by its exact ID, with the host's opaque revision.
// ---------------------------------------------------------------------------

function editInput(rule: RedirectRule, revision: string, changes: Partial<RedirectRuleEditDraft> = {}) {
	return {
		id: rule.id, revision, source: rule.source, destination: rule.destination, type: rule.type, enabled: rule.enabled,
		...changes,
	};
}

function editSnapshot(rule: RedirectRule, revision: string, changes: Partial<RedirectRuleEditDraft> = {}) {
	const { id: _id, revision: _revision, ...draft } = editInput(rule, revision, changes);
	return { id: rule.id, revision, baseline: redirectRuleConfiguration(rule), draft };
}

function revisionOf(store: { revisions: Map<string, string> }, rule: RedirectRule): string {
	return store.revisions.get(rule.id)!;
}

function activity(rule: RedirectRule) {
	return { groupName: rule.groupName, auto: rule.auto, hits: rule.hits, lastHitAt: rule.lastHitAt, createdAt: rule.createdAt, isPattern: rule.isPattern };
}

// Load: one exact-ID read, the opaque revision, and eligibility.
{
	const { host, store, listCalls, gets } = fakeHost();
	const rule = store.insert({ source: "/a", destination: "/b", groupName: "Imported", auto: true, hits: 3 });
	const loaded = await loadRedirectRule(host, { id: rule.id }, { canManage: true });
	assert.ok(loaded.status === "loaded" && loaded.update === "available");
	assert.deepEqual(loaded.rule, rule);
	assert.equal(loaded.revision, revisionOf(store, rule), "the revision is passed through unchanged");
	assert.deepEqual([gets.length, listCalls.length], [1, 0], "opening the form makes one read");
	const viewer = await loadRedirectRule(host, { id: rule.id }, { canManage: false });
	assert.ok(viewer.status === "loaded" && viewer.update === "no-permission");
	const readOnly = fakeHost({ readOnly: true });
	const readOnlyRule = readOnly.store.insert({ source: "/a", destination: "/b" });
	const shown = await loadRedirectRule(readOnly.host, { id: readOnlyRule.id }, { canManage: true });
	assert.ok(shown.status === "loaded" && shown.update === "read-only");
	assert.equal((await loadRedirectRule(host, { id: "r9999" }, { canManage: true })).status, "missing");

	const before = gets.length;
	for (const input of [null, {}, { id: "" }, { id: "x".repeat(REDIRECT_ID_MAX_LENGTH + 1) }, { id: rule.id, extra: true }, { id: 7 }]) {
		const invalid = await loadRedirectRule(host, input, { canManage: true });
		assert.ok(invalid.status === "invalid" && invalid.reason === "input", JSON.stringify(input));
	}
	assert.equal(gets.length, before, "malformed input never reaches the host");

	const pattern = store.insert({ source: "/blog/[slug]", destination: "/posts/[slug]", isPattern: true });
	const gone = store.insert({ source: "/gone", destination: "", type: 410 });
	const strict = store.insert({ source: "/strict", destination: "/x", type: 308 });
	for (const [record, reason] of [[pattern, "pattern"], [gone, "type"], [strict, "type"]] as const) {
		const result = await loadRedirectRule(host, { id: record.id }, { canManage: true });
		assert.ok(result.status === "unsupported" && result.reason === reason && result.rule?.id === record.id, record.source);
		assert.match(result.message, /EmDash Redirects/);
	}
	for (const oversized of [
		{ groupName: "g".repeat(REDIRECT_GROUP_MAX_LENGTH + 1) },
		{ source: `/${"a".repeat(REDIRECT_PATH_MAX_LENGTH)}` },
		{ hits: -1 },
		{ hits: 0.5 },
		{ updatedAt: "t".repeat(200) },
	]) {
		const record = store.insert({ source: "/big", destination: "/b", ...oversized });
		assert.equal(redirectRuleEditability(record), "envelope");
		const result = await loadRedirectRule(host, { id: record.id }, { canManage: true });
		assert.ok(result.status === "unsupported" && result.reason === "envelope" && result.rule === null,
			`an oversized record is never truncated into an editable copy: ${Object.keys(oversized)[0]}`);
	}
	const malformed = fakeHost({ getBehavior: async () => { throw new RedirectHostError("malformed", "unexpected record"); } });
	const unreadable = await loadRedirectRule(malformed.host, { id: "r0001" }, { canManage: true });
	assert.ok(unreadable.status === "unsupported" && unreadable.reason === "envelope");
	const failing = fakeHost({ getBehavior: async () => { throw new RedirectHostError("failed", "database is locked"); } });
	const failed = await loadRedirectRule(failing.host, { id: "r0001" }, { canManage: true });
	assert.ok(failed.status === "failed" && failed.retryable);
	assert.equal((await loadRedirectRule(null, { id: "r0001" }, { canManage: true })).status, "unavailable");
	assert.equal((await loadRedirectRule({ list: host.list }, { id: "r0001" }, { canManage: true })).status, "unavailable");
}

// Update: the patch carries only changed configuration; group, origin and
// activity stay with EmDash.
{
	const { host, store, listCalls, gets, updates } = fakeHost();
	const rule = store.insert({
		source: "/old", destination: "/new", groupName: "Imported", auto: true, hits: 7, lastHitAt: "2026-10-01T00:00:00.000Z",
	});
	const revision = revisionOf(store, rule);
	const result = await updateRedirectRule(host, editInput(rule, revision, { destination: "/newer" }));
	assert.ok(result.status === "updated" && result.confirmedBy === "host");
	assert.deepEqual(updates, [{ id: rule.id, patch: { destination: "/newer" }, revision }], "one field and the opaque revision");
	assert.notEqual(result.revision, revision);
	assert.deepEqual(activity(result.rule), activity(rule), "automatic origin, group, hits and creation time are preserved");
	assert.equal(result.rule.source, "/old");
	assert.deepEqual(listCalls.map((call) => call.search), ["/old", "/newer", "["],
		"an active edge is checked for source ownership and for its chain");
	assert.equal(gets.length, 1);

	const typeOnly = await updateRedirectRule(host, editInput(result.rule, result.revision, { type: 302 }));
	assert.ok(typeOnly.status === "updated" && typeOnly.rule.type === 302 && typeOnly.revision !== result.revision);
	assert.deepEqual(updates.at(-1)!.patch, { type: 302 });
	assert.deepEqual(listCalls.slice(3).map((call) => call.search), ["/old", "/newer", "["],
		"a status change on an enabled rule is still an active edge");

	const moved = await updateRedirectRule(host, editInput(typeOnly.rule, typeOnly.revision, { source: "/Café menu" }));
	assert.ok(moved.status === "updated");
	assert.deepEqual(updates.at(-1)!.patch, { source: "/Caf%C3%A9%20menu" }, "a changed source is stored as EmDash matches it");
	assert.equal(moved.rule.auto, true);
	assert.equal(moved.rule.id, rule.id, "a changed source still belongs to the same record");
}

// No-op: compared as stored first, then again after normalizing changed fields.
{
	const { host, store, listCalls, updates, gets } = fakeHost();
	const rule = store.insert({ source: "/caf%C3%A9", destination: "/new%20page", type: 302 });
	const revision = revisionOf(store, rule);
	const raw = await updateRedirectRule(host, editInput(rule, revision));
	assert.ok(raw.status === "unchanged" && raw.revision === revision);
	assert.equal(gets.length, 1, "a raw no-op makes exactly one read");
	for (const changes of [
		{ source: "/caf%c3%a9" },
		{ source: " /café " },
		{ destination: "/new page" },
		{ source: "/café", destination: " /new%20page" },
	]) {
		const before: number = gets.length;
		const normalized = await updateRedirectRule(host, editInput(rule, revision, changes));
		assert.equal(normalized.status, "unchanged", JSON.stringify(changes));
		assert.equal(gets.length - before, 1, `a normalized no-op makes exactly one read: ${JSON.stringify(changes)}`);
	}
	assert.deepEqual([listCalls.length, updates.length], [0, 0], "a no-op never lists or writes, and never sends only a revision");
}

// Disable-only: zero list reads, only enabled:false, and an unchanged legacy
// path is neither rewritten nor allowed to block it.
{
	const { host, store, listCalls, updates, gets } = fakeHost();
	for (const source of ["/Old Page", "/legacy.html", "/q?x=1", "/café"]) {
		const rule = store.insert({ source, destination: "/target", groupName: "Legacy" });
		const revision = revisionOf(store, rule);
		const [getsBefore, updatesBefore] = [gets.length, updates.length];
		const result = await updateRedirectRule(host, editInput(rule, revision, { enabled: false }));
		assert.deepEqual([gets.length - getsBefore, updates.length - updatesBefore], [1, 1],
			"disabling makes exactly one read and one update");
		assert.ok(result.status === "updated" && !result.rule.enabled, source);
		assert.equal(result.rule.source, source, "the legacy source is kept exactly");
		assert.deepEqual(updates.at(-1), { id: rule.id, patch: { enabled: false }, revision });
		assert.equal(result.rule.groupName, "Legacy");
	}
	assert.equal(listCalls.length, 0, "disabling reads no list pages");

	// The host still validates the saved configuration and may refuse.
	const selfLoop = store.insert({ source: "/loop", destination: "/loop" });
	const refused = await updateRedirectRule(host, editInput(selfLoop, revisionOf(store, selfLoop), { enabled: false }));
	assert.ok(refused.status === "refused" && refused.reason === "host-validation");
	assert.match(refused.message, /must be different/);
	assert.equal(listCalls.length, 0);

	// Turning a legacy rule on, or editing it while it serves, needs an explicit fix.
	const disabledLegacy = store.insert({ source: "/Old Page 2", destination: "/target", enabled: false });
	const enabling = await updateRedirectRule(host, editInput(disabledLegacy, revisionOf(store, disabledLegacy), { enabled: true }));
	assert.ok(enabling.status === "invalid" && enabling.reason === "fields" && enabling.errors.source?.code === "stored-path");
	assert.match(enabling.errors.source!.message, /\/Old%20Page%202/);
	const servingLegacy = store.insert({ source: "/served.html", destination: "/target" });
	const retargeted = await updateRedirectRule(host, editInput(servingLegacy, revisionOf(store, servingLegacy), { destination: "/other" }));
	assert.ok(retargeted.status === "invalid" && retargeted.reason === "fields" && retargeted.errors.source?.code === "file-extension");
	const legacyDestination = store.insert({ source: "/fine", destination: "https://example.com/", enabled: false });
	const enableExternal = await updateRedirectRule(host, editInput(legacyDestination, revisionOf(store, legacyDestination), { enabled: true }));
	assert.ok(enableExternal.status === "invalid" && enableExternal.reason === "fields" &&
		enableExternal.errors.destination?.code === "absolute-url");
	// While it stays off, another field may change without touching the legacy source.
	const staysOff = await updateRedirectRule(host, editInput(disabledLegacy, revisionOf(store, disabledLegacy), { destination: "/elsewhere" }));
	assert.ok(staysOff.status === "updated" && staysOff.rule.source === "/Old Page 2");
	assert.deepEqual(updates.at(-1)!.patch, { destination: "/elsewhere" });
	assert.equal(listCalls.length, 0, "an edit that stays disabled with its source unchanged reads nothing");
}

// Field validation of changed fields happens before any list read.
{
	const { host, store, listCalls, updates } = fakeHost();
	const rule = store.insert({ source: "/a", destination: "/b" });
	const revision = revisionOf(store, rule);
	const invalid = await updateRedirectRule(host, editInput(rule, revision, { source: "/a.html", destination: "example.com" }));
	assert.ok(invalid.status === "invalid" && invalid.reason === "fields");
	assert.deepEqual([invalid.errors.source?.code, invalid.errors.destination?.code], ["file-extension", "not-a-path"]);
	const sameDestination = await updateRedirectRule(host, editInput(rule, revision, { destination: "/a/?x=1" }));
	assert.ok(sameDestination.status === "invalid" && sameDestination.reason === "fields" &&
		sameDestination.errors.destination?.code === "same-address");
	const sameSource = await updateRedirectRule(host, editInput(rule, revision, { source: "/b/" }));
	assert.ok(sameSource.status === "invalid" && sameSource.reason === "fields" && sameSource.errors.source?.code === "same-address");
	const tooLong = await updateRedirectRule(host, editInput(rule, revision, { source: `/${"a".repeat(REDIRECT_EDIT_INPUT_MAX_LENGTH - 1)}` }));
	assert.ok(tooLong.status === "invalid" && tooLong.reason === "fields" && tooLong.errors.source?.code === "too-long",
		"input up to the raw bound is explained against the path limit");
	for (const input of [
		editInput(rule, revision, { source: `/${"a".repeat(REDIRECT_EDIT_INPUT_MAX_LENGTH)}` }),
		{ ...editInput(rule, revision), type: 307 },
		{ ...editInput(rule, revision), enabled: "yes" },
		{ ...editInput(rule, revision), groupName: "Imported" },
		{ ...editInput(rule, revision), auto: false },
		{ ...editInput(rule, revision), revision: "" },
		{ ...editInput(rule, revision), revision: "r".repeat(1_025) },
		{ ...editInput(rule, revision), id: "" },
	]) {
		const refused = await updateRedirectRule(host, input);
		assert.ok(refused.status === "invalid" && refused.reason === "input", JSON.stringify(input).slice(0, 80));
	}
	assert.deepEqual([listCalls.length, updates.length], [0, 0]);
	assert.equal((await updateRedirectRule(null, editInput(rule, revision))).status, "unavailable");
	const readOnly = fakeHost({ readOnly: true });
	const readOnlyRule = readOnly.store.insert({ source: "/a", destination: "/b" });
	const blocked = await updateRedirectRule(readOnly.host, editInput(readOnlyRule, revisionOf(readOnly.store, readOnlyRule)));
	assert.ok(blocked.status === "unavailable" && blocked.reason === "read-only");
}

// The graph after replacement: the edited rule's old edge is removed and the
// proposed edge is checked in its place.
{
	// A chain through the old source no longer loops once that source moves.
	const moved = fakeHost();
	const x = moved.store.insert({ source: "/a", destination: "/b" });
	moved.store.insert({ source: "/b", destination: "/a" });
	const away = await updateRedirectRule(moved.host, editInput(x, revisionOf(moved.store, x), { source: "/c" }));
	assert.ok(away.status === "updated", "the old /a edge is gone, so /c -> /b -> /a ends");

	// The proposed edge is not invisible to the check.
	const closing = fakeHost();
	const y = closing.store.insert({ source: "/a", destination: "/b" });
	closing.store.insert({ source: "/c", destination: "/a" });
	const loop = await updateRedirectRule(closing.host, editInput(y, revisionOf(closing.store, y), { destination: "/c" }));
	assert.ok(loop.status === "conflict" && loop.reason === "loop");
	assert.match(loop.message, /\/a -> \/c -> \/a/);
	assert.equal(closing.updates.length, 0);

	// The moved source's trailing-slash twin is the old source.
	const twin = fakeHost();
	const z = twin.store.insert({ source: "/a", destination: "/z" });
	twin.store.insert({ source: "/b", destination: "/a" });
	const slash = await updateRedirectRule(twin.host, editInput(z, revisionOf(twin.store, z), { source: "/a/", destination: "/b" }));
	assert.ok(slash.status === "conflict" && slash.reason === "loop", "/a falls through to its alias /a/, the edited rule");

	// Following a chain: the exact rule first, then the one trailing-slash alternate.
	const alias = fakeHost();
	const p = alias.store.insert({ source: "/p", destination: "/z" });
	alias.store.insert({ source: "/b", destination: "/q/" });
	alias.store.insert({ source: "/q", destination: "/p" });
	const viaAlias = await updateRedirectRule(alias.host, editInput(p, revisionOf(alias.store, p), { destination: "/b" }));
	assert.ok(viaAlias.status === "conflict" && viaAlias.reason === "loop");
	alias.store.insert({ source: "/q/", destination: "/end" });
	const exactFirst = await updateRedirectRule(alias.host, editInput(p, revisionOf(alias.store, p), { destination: "/b" }));
	assert.equal(exactFirst.status, "updated", "the exact /q/ rule wins over its alternate /q");

	// Exact rules win over patterns; an enabled pattern can close the loop.
	const patterns = fakeHost();
	const a = patterns.store.insert({ source: "/a", destination: "/z" });
	patterns.store.insert({ source: "/blog/[slug]", destination: "/a/", isPattern: true });
	const viaPattern = await updateRedirectRule(patterns.host, editInput(a, revisionOf(patterns.store, a), { destination: "/blog/x?ref=1" }));
	assert.ok(viaPattern.status === "conflict" && viaPattern.reason === "loop", "query-free matching and the pattern lead back to /a/");
	patterns.store.insert({ source: "/blog/x", destination: "/end" });
	const exactOverPattern = await updateRedirectRule(patterns.host, editInput(a, revisionOf(patterns.store, a), { destination: "/blog/x" }));
	assert.equal(exactOverPattern.status, "updated");
}

// The edited rule is left out before any match or early end of pagination.
{
	const { host, store, listCalls } = fakeHost();
	store.insert({ source: "/a/", destination: "/s" });
	for (let index = 0; index < 120; index += 1) store.insert({ source: `/af${index}`, destination: "/elsewhere" });
	store.insert({ source: "/b", destination: "/a" });
	const x = store.insert({ source: "/a", destination: "/z" });
	const result = await updateRedirectRule(host, editInput(x, revisionOf(store, x), { source: "/s", destination: "/b" }));
	assert.ok(result.status === "conflict" && result.reason === "loop",
		"the old /a rule on the first page neither matches nor ends the lookup before /a/ on the next page");
	assert.match(result.status === "conflict" ? result.message : "", /\/s -> \/b -> \/a/);
	assert.equal(listCalls.filter((call) => call.search === "/a").length, 2);

	// Turning a rule on is checked against other owners of its source, not itself.
	const own = fakeHost();
	const off = own.store.insert({ source: "/m", destination: "/n", enabled: false });
	const on = await updateRedirectRule(own.host, editInput(off, revisionOf(own.store, off), { enabled: true }));
	assert.ok(on.status === "updated" && on.rule.enabled);
	assert.deepEqual(own.updates.at(-1)!.patch, { enabled: true });
	assert.deepEqual(own.listCalls.map((call) => call.search), ["/m", "/n", "["]);
}

// Legacy duplicate sources survive migration: EmDash serves the newest enabled
// one, and the newest-first list must not let an older or disabled duplicate
// replace it.
{
	const newestEnds = fakeHost();
	const x = newestEnds.store.insert({ source: "/a", destination: "/z" });
	newestEnds.store.insert({ source: "/d", destination: "/a" });
	newestEnds.store.insert({ source: "/d", destination: "/end" });
	newestEnds.store.insert({ source: "/d", destination: "/a", enabled: false });
	const ends = await updateRedirectRule(newestEnds.host, editInput(x, revisionOf(newestEnds.store, x), { destination: "/d" }));
	assert.equal(ends.status, "updated", "the newest enabled /d ends the chain");

	const newestLoops = fakeHost();
	const y = newestLoops.store.insert({ source: "/a", destination: "/z" });
	newestLoops.store.insert({ source: "/d", destination: "/end" });
	newestLoops.store.insert({ source: "/d", destination: "/a" });
	const loops = await updateRedirectRule(newestLoops.host, editInput(y, revisionOf(newestLoops.store, y), { destination: "/d" }));
	assert.ok(loops.status === "conflict" && loops.reason === "loop", "the newest enabled /d leads back to /a");

	const aliasDuplicates = fakeHost();
	const w = aliasDuplicates.store.insert({ source: "/a", destination: "/z" });
	aliasDuplicates.store.insert({ source: "/d/", destination: "/a" });
	aliasDuplicates.store.insert({ source: "/d/", destination: "/end" });
	const aliasEnds = await updateRedirectRule(aliasDuplicates.host, editInput(w, revisionOf(aliasDuplicates.store, w), { destination: "/d" }));
	assert.equal(aliasEnds.status, "updated", "the same precedence holds for the trailing-slash alternate");
}

// Source ownership: a disabled rule's new source is still checked, because the
// host reserves sources even for disabled rules; it needs no chain walk.
{
	const { host, store, listCalls, updates } = fakeHost();
	const x = store.insert({ source: "/x", destination: "/y", enabled: false });
	store.insert({ source: "/taken", destination: "/t", enabled: false });
	const duplicate = await updateRedirectRule(host, editInput(x, revisionOf(store, x), { source: "/taken" }));
	assert.ok(duplicate.status === "conflict" && duplicate.reason === "duplicate" && duplicate.existing?.source === "/taken");
	const alias = await updateRedirectRule(host, editInput(x, revisionOf(store, x), { source: "/taken/" }));
	assert.ok(alias.status === "conflict" && alias.reason === "trailing-slash");
	assert.deepEqual(listCalls.map((call) => call.search), ["/taken", "/taken"], "one ownership read each, no chain");
	const free = await updateRedirectRule(host, editInput(x, revisionOf(store, x), { source: "/free" }));
	assert.ok(free.status === "updated" && !free.rule.enabled);
	assert.deepEqual(updates.map((update) => update.patch), [{ source: "/free" }]);
}

// Stale and missing records: refused before any write, the draft kept for review.
{
	const { host, store, listCalls, updates, creates } = fakeHost();
	const rule = store.insert({ source: "/a", destination: "/b" });
	const loaded = revisionOf(store, rule);
	const stale = await updateRedirectRule(host, editInput(rule, "r1.fake-older", { destination: "/c" }));
	assert.ok(stale.status === "stale" && stale.reason === "revision" && stale.current?.id === rule.id);
	assert.equal("revision" in stale, false, "a stale result never hands back a fresh revision to resubmit");
	// The revision check comes before the no-op shortcut.
	assert.equal((await updateRedirectRule(host, editInput(rule, "r1.fake-older"))).status, "stale");

	// Public hits change activity without rotating the configuration revision.
	store.hit(rule.id);
	store.hit(rule.id);
	const afterHits = await updateRedirectRule(host, editInput(rule, loaded, { destination: "/c" }));
	assert.ok(afterHits.status === "updated" && afterHits.rule.hits === 2, "hit activity is not a conflict");

	// A content URL change can rewrite or delete a manual rule between load and save.
	const manual = store.insert({ source: "/post-old", destination: "/post", auto: false });
	const manualRevision = revisionOf(store, manual);
	store.apply(manual.id, { destination: "/post-renamed" });
	const changed = await updateRedirectRule(host, editInput(manual, manualRevision, { type: 302 }));
	assert.ok(changed.status === "stale" && changed.current?.destination === "/post-renamed");
	store.remove(manual.id);
	const missing = await updateRedirectRule(host, editInput(manual, manualRevision, { type: 302 }));
	assert.equal(missing.status, "missing");

	// A writer between this command's read and its update: the host refuses.
	const race = fakeHost({
		updateBehavior: async (id, patch, revision, raceStore) => {
			raceStore.apply(id, { destination: "/theirs" });
			return raceStore.conditionalUpdate(id, patch, revision);
		},
	});
	const raced = race.store.insert({ source: "/a", destination: "/b" });
	const lost = await updateRedirectRule(race.host, editInput(raced, revisionOf(race.store, raced), { type: 302 }));
	assert.ok(lost.status === "stale" && lost.reason === "revision");
	assert.equal(race.store.rules[0]!.destination, "/theirs", "the newer version is not overwritten");
	assert.equal(race.updates.length, 1, "a stale save is never retried with a fresh revision");
	assert.equal(updates.length, 1);
	assert.equal(creates.length, 0, "a missing rule is never recreated");
	assert.ok(listCalls.every((call) => call.search !== "/post-old"), "nothing is searched by source");
}

// The host can commit and then fail its final read: one exact-ID recovery read
// settles it, and only a settled host call can prove the write failed.
{
	const commitThenReadFault = fakeHost({
		updateBehavior: async (id, patch, revision, store) => {
			store.conditionalUpdate(id, patch, revision);
			throw new RedirectHostError("failed", "Updated redirect not found");
		},
	});
	const rule = commitThenReadFault.store.insert({ source: "/a", destination: "/b", groupName: "Imported", auto: true });
	const recovered = await updateRedirectRule(commitThenReadFault.host, editInput(rule, revisionOf(commitThenReadFault.store, rule), { type: 302 }));
	assert.ok(recovered.status === "updated" && recovered.confirmedBy === "recovery");
	assert.deepEqual(activity(recovered.rule), activity(rule));
	assert.deepEqual([commitThenReadFault.gets.length, commitThenReadFault.updates.length], [2, 1]);

	const commitThenOther = fakeHost({
		updateBehavior: async (id, patch, revision, store) => {
			store.conditionalUpdate(id, patch, revision);
			store.apply(id, { destination: "/later" });
			throw new RedirectHostError("failed", "Updated redirect not found");
		},
	});
	const other = commitThenOther.store.insert({ source: "/a", destination: "/b" });
	const changed = await updateRedirectRule(commitThenOther.host, editInput(other, revisionOf(commitThenOther.store, other), { type: 302 }));
	assert.ok(changed.status === "stale" && changed.reason === "changed" && changed.current?.destination === "/later");

	const laterInReadback = fakeHost({
		updateBehavior: async (id, patch, revision, store) => {
			store.conditionalUpdate(id, patch, revision);
			return store.apply(id, { enabled: false });
		},
	});
	const readback = laterInReadback.store.insert({ source: "/a", destination: "/b" });
	const notOurs = await updateRedirectRule(laterInReadback.host, editInput(readback, revisionOf(laterInReadback.store, readback), { type: 302 }));
	assert.ok(notOurs.status === "stale" && notOurs.reason === "changed",
		"a readback that already holds a later edit is not reported as this save");
	assert.equal(laterInReadback.gets.length, 1);

	const failedWrite = fakeHost({ updateBehavior: async () => { throw new RedirectHostError("failed", "Failed to update redirect"); } });
	const unsaved = failedWrite.store.insert({ source: "/a", destination: "/b" });
	const notSaved = await updateRedirectRule(failedWrite.host, editInput(unsaved, revisionOf(failedWrite.store, unsaved), { type: 302 }));
	assert.ok(notSaved.status === "not-saved" && notSaved.reason === "write-failed" && notSaved.retryable);
	assert.equal(failedWrite.updates.length, 1, "the retry is left to an explicit save");

	// A fulfilled update whose readback cannot be parsed never proves the write
	// failed, while the same recovery read still confirms or reports a change.
	for (const [label, commit, other, status] of [
		["an unchanged baseline", false, false, "uncertain"],
		["the requested configuration", true, false, "updated"],
		["another writer's change", true, true, "stale"],
	] as const) {
		const unparsed = fakeHost({
			updateBehavior: async (id, patch, revision, store) => {
				if (commit) store.conditionalUpdate(id, patch, revision);
				if (other) store.apply(id, { destination: "/theirs" });
				throw new RedirectHostError("malformed", "EmDash returned an unexpected redirect version");
			},
		});
		const record = unparsed.store.insert({ source: "/a", destination: "/b", enabled: false });
		const result = await updateRedirectRule(unparsed.host, editInput(record, revisionOf(unparsed.store, record), { destination: "/c" }));
		assert.equal(result.status, status, `a malformed readback followed by ${label}`);
		if (result.status === "uncertain") assert.equal(result.reason, "pending");
		if (result.status === "updated") assert.equal(result.confirmedBy, "recovery");
		assert.deepEqual([unparsed.gets.length, unparsed.updates.length], [2, 1], label);
	}

	for (const [label, error] of [
		["a pending transport error", new RedirectHostError("failed", "timed out", false, true)],
		["an error from outside the host call", new TypeError("fetch failed")],
	] as const) {
		const pending = fakeHost({ updateBehavior: async () => { throw error; } });
		const record = pending.store.insert({ source: "/a", destination: "/b" });
		const result = await updateRedirectRule(pending.host, editInput(record, revisionOf(pending.store, record), { type: 302 }));
		assert.ok(result.status === "uncertain" && result.reason === "pending", `${label} never proves the write failed`);
	}

	for (const [label, behavior, status] of [
		["a failed recovery read", async () => { throw new RedirectHostError("failed", "database is locked"); }, "uncertain"],
		["a malformed recovery read", async () => { throw new RedirectHostError("malformed", "unexpected"); }, "uncertain"],
		["a deleted record", async () => null, "missing"],
	] as const) {
		const ambiguous = fakeHost({
			getBehavior: async (id, store, call) => call === 1 ? store.version(id) : behavior(),
			updateBehavior: async (id, patch, revision, store) => {
				store.conditionalUpdate(id, patch, revision);
				throw new RedirectHostError("failed", "Updated redirect not found");
			},
		});
		const record = ambiguous.store.insert({ source: "/a", destination: "/b" });
		const result = await updateRedirectRule(ambiguous.host, editInput(record, revisionOf(ambiguous.store, record), { type: 302 }));
		assert.equal(result.status, status, label);
		assert.equal(ambiguous.creates.length, 0);
	}
	const oversizedReadback = fakeHost({
		getBehavior: async (id, store, call) => {
			const version = store.version(id);
			return call === 1 || !version ? version : { ...version, rule: { ...version.rule, groupName: "g".repeat(500) } };
		},
		updateBehavior: async (id, patch, revision, store) => {
			store.conditionalUpdate(id, patch, revision);
			throw new RedirectHostError("failed", "Updated redirect not found");
		},
	});
	const record = oversizedReadback.store.insert({ source: "/a", destination: "/b" });
	const outside = await updateRedirectRule(oversizedReadback.host, editInput(record, revisionOf(oversizedReadback.store, record), { type: 302 }));
	assert.ok(outside.status === "uncertain" && outside.reason === "unreadable");
}

// Host refusals keep their meaning and never trigger recovery reads.
{
	for (const [label, error, check] of [
		["busy", new RedirectHostError("busy", "Another redirect change is in progress"),
			(result: Awaited<ReturnType<typeof updateRedirectRule>>) => result.status === "busy" && result.retryable],
		["precondition", new RedirectHostError("precondition", "Invalid redirect revision"),
			(result: Awaited<ReturnType<typeof updateRedirectRule>>) => result.status === "refused" && result.reason === "precondition"],
		["duplicate", new RedirectHostError("conflict", "A redirect from \"/c\" already exists"),
			(result: Awaited<ReturnType<typeof updateRedirectRule>>) => result.status === "conflict" && result.reason === "duplicate"],
		["host loop", new RedirectHostError("validation", `This redirect would create a loop:\n${"/x → /y\n".repeat(100)}`, true),
			(result: Awaited<ReturnType<typeof updateRedirectRule>>) =>
				result.status === "conflict" && result.reason === "loop" && result.message.length <= 300],
	] as const) {
		const refusing = fakeHost({ updateBehavior: async () => { throw error; } });
		const rule = refusing.store.insert({ source: "/a", destination: "/b" });
		const result = await updateRedirectRule(refusing.host, editInput(rule, revisionOf(refusing.store, rule), { type: 302 }));
		assert.ok(check(result), label);
		assert.equal(refusing.gets.length, 1, `${label} is definite, so nothing is read back`);
	}
}

// Late writes: a separate recovery request cannot tell a write still running
// from one that failed, so the baseline stays uncertain; it never writes.
{
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const delayed = fakeHost({
		updateBehavior: async (id, patch, revision, store) => {
			await gate;
			return store.conditionalUpdate(id, patch, revision);
		},
	});
	const rule = delayed.store.insert({ source: "/slow", destination: "/done", groupName: "Imported" });
	const revision = revisionOf(delayed.store, rule);
	const original = updateRedirectRule(delayed.host, editInput(rule, revision, { destination: "/later" }));
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.equal(delayed.updates.length, 1, "the original update is waiting before its write");
	const lists = delayed.listCalls.length;
	const snapshot = editSnapshot(rule, revision, { destination: "/later" });
	const early = await reconcileRedirectRuleUpdate(delayed.host, snapshot);
	assert.ok(early.status === "uncertain" && early.reason === "pending", "the baseline does not unlock another save");
	release();
	const finished = await original;
	assert.ok(finished.status === "updated" && finished.confirmedBy === "host");
	const late = await reconcileRedirectRuleUpdate(delayed.host, snapshot);
	assert.ok(late.status === "updated" && late.confirmedBy === "recovery" && late.rule.groupName === "Imported");
	delayed.store.hit(rule.id);
	assert.equal((await reconcileRedirectRuleUpdate(delayed.host, snapshot)).status, "updated", "hits are not a configuration change");
	delayed.store.apply(rule.id, { destination: "/someone-else" });
	const other = await reconcileRedirectRuleUpdate(delayed.host, snapshot);
	assert.ok(other.status === "stale" && other.reason === "changed" && other.current?.destination === "/someone-else");
	delayed.store.remove(rule.id);
	assert.equal((await reconcileRedirectRuleUpdate(delayed.host, snapshot)).status, "missing");
	assert.deepEqual([delayed.updates.length, delayed.creates.length, delayed.listCalls.length], [1, 0, lists],
		"recovery never writes, recreates or searches by source");

	const gets = delayed.gets.length;
	for (const input of [
		{ ...snapshot, completed: true },
		{ ...snapshot, baseline: { ...snapshot.baseline, groupName: "g".repeat(REDIRECT_GROUP_MAX_LENGTH + 1) } },
		{ ...snapshot, baseline: { ...snapshot.baseline, isPattern: true } },
		{ ...snapshot, baseline: { ...snapshot.baseline, hits: 3 } },
		{ ...snapshot, draft: { ...snapshot.draft, groupName: null } },
		{ ...snapshot, revision: "" },
	]) {
		const refused = await reconcileRedirectRuleUpdate(delayed.host, input);
		assert.ok(refused.status === "invalid" && refused.reason === "input");
	}
	assert.equal(delayed.gets.length, gets, "a client cannot claim the write finished or widen the snapshot");
	assert.equal((await reconcileRedirectRuleUpdate(null, snapshot)).status, "unavailable");
}

// Finite work: three ownership pages, nine chain and pattern pages, one read,
// one update and one recovery read per attempt.
{
	const worst = fakeHost({
		updateBehavior: async (id, patch, revision, store) => {
			store.conditionalUpdate(id, patch, revision);
			throw new RedirectHostError("failed", "Updated redirect not found");
		},
	});
	for (let index = 0; index < 250; index += 1) worst.store.insert({ source: `/m-${index}`, destination: "/elsewhere" });
	for (let hop = 0; hop < 7; hop += 1) worst.store.insert({ source: `/h${hop}`, destination: hop === 6 ? "/end" : `/h${hop + 1}` });
	const x = worst.store.insert({ source: "/x", destination: "/y" });
	const result = await updateRedirectRule(worst.host, editInput(x, revisionOf(worst.store, x), { source: "/m", destination: "/h0" }));
	assert.ok(result.status === "updated" && result.confirmedBy === "recovery");
	assert.equal(worst.listCalls.length, REDIRECT_LOOKUP_PAGES + REDIRECT_CHAIN_MAX_READS);
	assert.ok(worst.listCalls.every((call) => call.limit === REDIRECT_LIST_MAX_PAGE_SIZE));
	assert.equal(worst.gets.length + worst.listCalls.length + worst.updates.length, 15, "at most 15 adapter calls");

	const crowded = fakeHost();
	for (let index = 0; index < REDIRECT_LIST_MAX_PAGE_SIZE * REDIRECT_LOOKUP_PAGES + 1; index += 1) {
		crowded.store.insert({ source: `/shop/item-${index}`, destination: "/shop-all" });
	}
	const y = crowded.store.insert({ source: "/y", destination: "/z" });
	const unchecked = await updateRedirectRule(crowded.host, editInput(y, revisionOf(crowded.store, y), { source: "/shop" }));
	assert.ok(unchecked.status === "conflict" && unchecked.reason === "check-incomplete");
	assert.deepEqual([crowded.listCalls.length, crowded.updates.length], [REDIRECT_LOOKUP_PAGES, 0]);

	const long = fakeHost();
	for (let hop = 0; hop <= REDIRECT_CHAIN_MAX_HOPS; hop += 1) long.store.insert({ source: `/h${hop}`, destination: `/h${hop + 1}` });
	const z = long.store.insert({ source: "/start", destination: "/a" });
	const tooLong = await updateRedirectRule(long.host, editInput(z, revisionOf(long.store, z), { destination: "/h0" }));
	assert.ok(tooLong.status === "conflict" && tooLong.reason === "check-incomplete");
	assert.ok(long.listCalls.filter((call) => call.search !== "/start").length <= REDIRECT_CHAIN_MAX_READS);
	assert.equal(long.updates.length, 0);

	// Pages outside the envelope never prove absence.
	for (const [label, transform] of [
		["too many rows", (page: RedirectHostPage) => ({ ...page, items: Array.from({ length: REDIRECT_LIST_MAX_PAGE_SIZE + 1 }, () => page.items[0]!) })],
		["an oversized cursor", (page: RedirectHostPage) => ({ ...page, cursor: "c".repeat(REDIRECT_CURSOR_MAX_LENGTH + 1) })],
		["an oversized source", (page: RedirectHostPage) => ({ ...page, items: page.items.map((rule) => ({ ...rule, source: `/${"s".repeat(REDIRECT_PATH_MAX_LENGTH)}` })) })],
		["an unrelated row with a huge group name", (page: RedirectHostPage) => ({ ...page, items: [...page.items, { ...page.items[0]!, id: "big", source: "/big", groupName: "é".repeat(5_000_000) }] })],
		["an unrelated row with huge timestamps", (page: RedirectHostPage) => ({ ...page, items: [...page.items, { ...page.items[0]!, id: "old", source: "/old", createdAt: "t".repeat(1_000_000) }] })],
		["negative hits", (page: RedirectHostPage) => ({ ...page, items: [...page.items, { ...page.items[0]!, id: "neg", source: "/neg", hits: -1 }] })],
		["an unknown status", (page: RedirectHostPage) => ({ ...page, items: [...page.items, { ...page.items[0]!, id: "odd", source: "/odd", type: 999 }] })],
		["a malformed flag", (page: RedirectHostPage) => ({ ...page, items: [...page.items, { ...page.items[0]!, id: "flag", source: "/flag", enabled: "yes" as unknown as boolean }] })],
	] as const) {
		const odd = fakeHost({ pageTransform: (page, query) => query.search === "/c" ? transform(page) : page });
		odd.store.insert({ source: "/c", destination: "/elsewhere" });
		const rule = odd.store.insert({ source: "/a", destination: "/b" });
		const result = await updateRedirectRule(odd.host, editInput(rule, revisionOf(odd.store, rule), { destination: "/c" }));
		assert.ok(result.status === "conflict" && result.reason === "check-incomplete", label);
		assert.equal(odd.updates.length, 0, label);
	}

	// A pattern's interpolated destination is bounded before it is built.
	const capture = "c".repeat(2_000);
	const repeated = `/${"[...rest]".repeat(200)}`;
	assert.ok(repeated.length <= REDIRECT_PATH_MAX_LENGTH);
	assert.equal(interpolateRedirectDestinationWithin(repeated, { rest: capture }, REDIRECT_PATH_MAX_LENGTH), null,
		"200 copies of a 2,000-character capture are refused before about 400 KB is built");
	for (const [template, params] of [
		["/posts/[slug]?ref=[slug]#[...rest]", { slug: "a", rest: "b/c" }],
		["/[...rest]/[slug]", { rest: "x/[slug]", slug: "s" }],
		["/[missing]/[constructor]", {}],
	] as const) {
		assert.equal(interpolateRedirectDestinationWithin(template, params, REDIRECT_PATH_MAX_LENGTH),
			interpolateRedirectDestination(template, params), `the bounded form matches the host for ${template}`);
	}
	const multiplied = fakeHost();
	multiplied.store.insert({ source: "/p/[...rest]", destination: repeated, isPattern: true });
	const v = multiplied.store.insert({ source: "/v", destination: "/u" });
	const refusedEarly = await updateRedirectRule(multiplied.host, editInput(v, revisionOf(multiplied.store, v), { destination: `/p/${capture}` }));
	assert.ok(refusedEarly.status === "conflict" && refusedEarly.reason === "check-incomplete");
	assert.match(refusedEarly.message, /where \/p\/c/, "the hop that would interpolate is the one reported");
	const interpolated = fakeHost();
	interpolated.store.insert({ source: "/p/[...rest]", destination: `/${"x".repeat(2_040)}/[...rest]`, isPattern: true });
	const w = interpolated.store.insert({ source: "/w", destination: "/v" });
	const bounded = await updateRedirectRule(interpolated.host, editInput(w, revisionOf(interpolated.store, w), { destination: "/p/abcdefghij" }));
	assert.ok(bounded.status === "conflict" && bounded.reason === "check-incomplete");
	assert.ok(bounded.message.length < 600, "messages show bounded paths");

	// One deadline covers the reads; an expired check never continues into the update.
	let now = 0;
	const slow = fakeHost({ listFailure: () => { now += 6_000; return null; } });
	for (let index = 0; index < 250; index += 1) slow.store.insert({ source: `/m-${index}`, destination: "/elsewhere" });
	const s = slow.store.insert({ source: "/s", destination: "/t" });
	const late = await updateRedirectRule(slow.host, editInput(s, revisionOf(slow.store, s), { source: "/m" }), { clock: () => now });
	assert.ok(late.status === "not-saved" && late.reason === "deadline" && late.retryable);
	assert.deepEqual([slow.listCalls.length, slow.updates.length], [3, 0], "no read starts after the deadline");

	let later = 0;
	const stalled = fakeHost({
		getBehavior: async (id, store) => {
			later += REDIRECT_EDIT_PREFLIGHT_MS;
			return store.version(id);
		},
	});
	const t = stalled.store.insert({ source: "/t", destination: "/u" });
	const expired = await updateRedirectRule(stalled.host, editInput(t, revisionOf(stalled.store, t), { enabled: false }), { clock: () => later });
	assert.ok(expired.status === "not-saved" && expired.reason === "deadline");
	assert.equal(stalled.updates.length, 0, "the deadline is checked immediately before the write");
}

// Every save of an enabled rule is an active edge: a status-only change is
// checked for an executable source, its owner and the chain, while no-op and
// disable-only saves still read nothing.
{
	const legacy = fakeHost();
	const old = legacy.store.insert({ source: "/Old Page", destination: "/target" });
	const statusOnly = await updateRedirectRule(legacy.host, editInput(old, revisionOf(legacy.store, old), { type: 302 }));
	assert.ok(statusOnly.status === "invalid" && statusOnly.reason === "fields" && statusOnly.errors.source?.code === "stored-path");
	assert.deepEqual([legacy.listCalls.length, legacy.updates.length], [0, 0]);
	const off = await updateRedirectRule(legacy.host, editInput(old, revisionOf(legacy.store, old), { enabled: false }));
	assert.ok(off.status === "updated" && legacy.listCalls.length === 0, "disabling the same legacy rule reads nothing");

	const looping = fakeHost();
	const x = looping.store.insert({ source: "/a", destination: "/b" });
	looping.store.insert({ source: "/b", destination: "/a" });
	const intoLoop = await updateRedirectRule(looping.host, editInput(x, revisionOf(looping.store, x), { type: 302 }));
	assert.ok(intoLoop.status === "conflict" && intoLoop.reason === "loop");
	assert.equal(looping.updates.length, 0);

	const twins = fakeHost();
	const y = twins.store.insert({ source: "/a", destination: "/b" });
	twins.store.insert({ source: "/a/", destination: "/c" });
	for (const changes of [{ type: 302 as const }, { destination: "/d" }]) {
		const owned = await updateRedirectRule(twins.host, editInput(y, revisionOf(twins.store, y), changes));
		assert.ok(owned.status === "conflict" && owned.reason === "trailing-slash" && owned.existing?.source === "/a/",
			JSON.stringify(changes));
	}
	assert.equal(twins.updates.length, 0);
	const before = twins.listCalls.length;
	assert.equal((await updateRedirectRule(twins.host, editInput(y, revisionOf(twins.store, y)))).status, "unchanged");
	assert.equal((await updateRedirectRule(twins.host, editInput(y, revisionOf(twins.store, y), { source: " /a" }))).status, "unchanged");
	assert.equal(twins.listCalls.length, before, "raw and normalized no-ops still read nothing");
}

// Host error text is cut to a bounded prefix before it is cleaned.
{
	const verbose = fakeHost({
		updateBehavior: async () => { throw new RedirectHostError("validation", `Invalid redirect: ${"\n x".repeat(500_000)}`); },
	});
	const rule = verbose.store.insert({ source: "/a", destination: "/b", enabled: false });
	const refused = await updateRedirectRule(verbose.host, editInput(rule, revisionOf(verbose.store, rule), { destination: "/c" }));
	assert.ok(refused.status === "refused" && refused.reason === "host-validation");
	assert.ok(refused.message.length <= 300 && refused.message.startsWith("Invalid redirect:"));
	assert.equal(/[\n\r]/.test(refused.message), false);
}

// Confirmation needs the requested configuration under a new revision. A host
// response that shows it under the baseline revision is malformed: it stays
// uncertain through the direct readback and through exact-ID recovery.
{
	const sameRevision = fakeHost({
		updateBehavior: async (id, patch, revision, store) => {
			const index = store.rules.findIndex((rule) => rule.id === id);
			store.rules[index] = { ...store.rules[index]!, ...patch };
			return { rule: structuredClone(store.rules[index]!), revision };
		},
	});
	const rule = sameRevision.store.insert({ source: "/a", destination: "/b", enabled: false });
	const revision = revisionOf(sameRevision.store, rule);
	const direct = await updateRedirectRule(sameRevision.host, editInput(rule, revision, { destination: "/c" }));
	assert.ok(direct.status === "uncertain" && direct.reason === "unreadable", "the readback alone confirms nothing");
	assert.deepEqual([sameRevision.gets.length, sameRevision.updates.length], [2, 1], "one recovery read, no second write");
	const recovery = await reconcileRedirectRuleUpdate(sameRevision.host, editSnapshot(rule, revision, { destination: "/c" }));
	assert.ok(recovery.status === "uncertain" && recovery.reason === "unreadable");
	sameRevision.store.revisions.set(rule.id, "r1.fake-rotated");
	const rotated = await reconcileRedirectRuleUpdate(sameRevision.host, editSnapshot(rule, revision, { destination: "/c" }));
	assert.ok(rotated.status === "updated" && rotated.revision === "r1.fake-rotated");
}

// Another writer's change to a preserved field never confirms this save, in
// the host's readback, in the command's recovery read or in a later recovery.
for (const [field, change] of [
	["groupName", { groupName: "Theirs" }],
	["auto", { auto: true }],
	["isPattern", { isPattern: true }],
] as const) {
	const readback = fakeHost({
		updateBehavior: async (id, patch, revision, store) => {
			store.conditionalUpdate(id, patch, revision);
			return store.apply(id, change);
		},
	});
	const first = readback.store.insert({ source: "/a", destination: "/b", enabled: false });
	const direct = await updateRedirectRule(readback.host, editInput(first, revisionOf(readback.store, first), { destination: "/c" }));
	assert.ok(direct.status === "stale" && direct.reason === "changed", `readback with a changed ${field}`);

	const recovered = fakeHost({
		updateBehavior: async (id, patch, revision, store) => {
			store.conditionalUpdate(id, patch, revision);
			store.apply(id, change);
			throw new RedirectHostError("failed", "Updated redirect not found");
		},
	});
	const second = recovered.store.insert({ source: "/a", destination: "/b", enabled: false });
	const viaRecovery = await updateRedirectRule(recovered.host, editInput(second, revisionOf(recovered.store, second), { destination: "/c" }));
	assert.ok(viaRecovery.status === "stale" && viaRecovery.reason === "changed", `recovery read with a changed ${field}`);
	assert.equal(recovered.gets.length, 2);

	const later = fakeHost();
	const third = later.store.insert({ source: "/a", destination: "/b", enabled: false });
	const snapshot = editSnapshot(third, revisionOf(later.store, third), { destination: "/c" });
	later.store.apply(third.id, { destination: "/c", ...change });
	const separate = await reconcileRedirectRuleUpdate(later.host, snapshot);
	assert.ok(separate.status === "stale" && separate.reason === "changed", `separate recovery with a changed ${field}`);
	assert.equal(later.updates.length, 0);
}

// Single-record results stay within 64 KiB even for records at the envelope.
{
	const { host, store } = fakeHost();
	const wide = "€".repeat(REDIRECT_PATH_MAX_LENGTH - 1);
	const existing = store.insert({ source: "/dup", destination: `/${wide}`, groupName: "€".repeat(REDIRECT_GROUP_MAX_LENGTH) });
	const x = store.insert({ source: `/${wide}x`.slice(0, REDIRECT_PATH_MAX_LENGTH), destination: "/b", enabled: false });
	const conflict = await updateRedirectRule(host, editInput(x, revisionOf(store, x), { source: "/dup" }));
	assert.ok(conflict.status === "conflict" && conflict.existing?.id === existing.id);
	const stale = await updateRedirectRule(host, editInput(existing, "r1.fake-older", { type: 302 }));
	for (const result of [conflict, stale]) {
		assert.ok(new TextEncoder().encode(JSON.stringify(result)).length < 64 * 1_024, result.status);
	}
}

console.log("SEO redirect rule command self-check passed.");
