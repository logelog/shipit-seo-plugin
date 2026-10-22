import { defaultSeoAdminTemplateSet } from "./admin-contract.ts";
import { jsonUtf8LengthWithin } from "./lib.ts";
import {
	LEGACY_TEMPLATE_REVISIONS_KEY,
	METADATA_TEMPLATES_KEY,
	METADATA_TEMPLATES_MAX_RECORD_BYTES,
	decodeMetadataTemplatesRecord,
	inheritedMetadataTemplate,
	legacyRevisionTokens,
	readMetadataTemplates,
	recordTokens,
	resetMetadataTemplate,
	rollbackPortabilityTemplates,
	saveMetadataTemplate,
	scoreTokenFor,
	writePortabilityTemplates,
	type MetadataTemplatesHost,
} from "./metadata-templates.ts";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
	if (ok) console.log(`  PASS  ${name}`);
	else {
		failures += 1;
		console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
	}
}

const defaults = defaultSeoAdminTemplateSet(["posts", "pages", "services"]);
const custom = { ...defaults.posts, description: "Read {{description}}" };

/** Plugin KV with a new revision on every write, as on the published hosts. */
function createKv(initial: Record<string, unknown> = {}) {
	const values = new Map<string, unknown>(Object.entries(initial));
	const revisions = new Map<string, string>();
	let counter = 0;
	for (const key of values.keys()) revisions.set(key, `r${++counter}`);
	const calls = { compareAndSet: 0, compareAndDelete: 0, getVersioned: 0 };
	let beforeVersionedRead: ((key: string, count: number) => void) | null = null;
	let compareAndSetFailure: "throw" | "no-revision" | null = null;
	const kv = {
		get: async (key: string) => structuredClone(values.get(key) ?? null),
		getVersioned: async (key: string) => {
			calls.getVersioned += 1;
			beforeVersionedRead?.(key, calls.getVersioned);
			return values.has(key) ? { value: structuredClone(values.get(key)), revision: revisions.get(key)! } : null;
		},
		compareAndSet: async (key: string, expected: string | null, value: unknown) => {
			calls.compareAndSet += 1;
			if (compareAndSetFailure === "throw") throw new Error("transport closed after the write");
			if ((revisions.get(key) ?? null) !== expected) return { applied: false };
			values.set(key, structuredClone(value));
			revisions.set(key, `r${++counter}`);
			if (compareAndSetFailure === "no-revision") return { applied: true };
			return { applied: true, revision: revisions.get(key) };
		},
		compareAndDelete: async (key: string, expected: string) => {
			calls.compareAndDelete += 1;
			if (revisions.get(key) !== expected) return { applied: false };
			values.delete(key);
			revisions.delete(key);
			return { applied: true };
		},
	};
	return {
		kv,
		values,
		revisions,
		calls,
		/** An unconditional host write: a new revision even for equal bytes. */
		set(key: string, value: unknown) {
			values.set(key, structuredClone(value));
			revisions.set(key, `r${++counter}`);
		},
		onVersionedRead(hook: ((key: string, count: number) => void) | null) {
			beforeVersionedRead = hook;
		},
		failCompareAndSet(mode: "throw" | "no-revision" | null) {
			compareAndSetFailure = mode;
		},
	};
}

function host(store: ReturnType<typeof createKv>, targets: readonly string[] | null = ["posts", "pages", "services"], now = Date.parse("2026-10-03T08:00:00.000Z")): MetadataTemplatesHost {
	return { kv: store.kv, targets: async () => targets, now: () => now };
}

const noGuard = { fields: { title: null, description: null, socialTitle: null, socialDescription: null } };
const absentGuard = { ...noGuard, revisions: null };
function guardFor(store: ReturnType<typeof createKv>, collection: string, absent: boolean) {
	const field = (name: string) => store.revisions.get(`tpl:${collection}:${name}`) ?? null;
	return {
		fields: { title: field("title"), description: field("description"), socialTitle: field("socialTitle"), socialDescription: field("socialDescription") },
		...(absent ? { revisions: store.revisions.get(LEGACY_TEMPLATE_REVISIONS_KEY) ?? null } : {}),
	};
}

// --- Decoding -----------------------------------------------------------------

const baseRecord = { version: 1, updatedAt: "2026-07-01T00:00:00.000Z", values: { posts: custom } };
check("a record written by an earlier version decodes", decodeMetadataTemplatesRecord(baseRecord).ok);
check("an empty override map decodes when it carries tokens",
	decodeMetadataTemplatesRecord({ version: 1, updatedAt: "x", values: {}, collectionUpdatedAt: {} }).ok);
check("an empty override map without tokens is corrupt",
	!decodeMetadataTemplatesRecord({ version: 1, updatedAt: "x", values: {} }).ok);
check("an unknown field is corrupt", !decodeMetadataTemplatesRecord({ ...baseRecord, extra: true }).ok);
check("a wrong version is corrupt", !decodeMetadataTemplatesRecord({ ...baseRecord, version: 2 }).ok);
check("an untrimmed override is corrupt rather than rewritten",
	!decodeMetadataTemplatesRecord({ ...baseRecord, values: { posts: { ...custom, title: ` ${custom.title}` } } }).ok);
check("an override with a fifth field is corrupt",
	!decodeMetadataTemplatesRecord({ ...baseRecord, values: { posts: { ...custom, note: "x" } } }).ok);
check("an oversized stored string is refused before validation",
	!decodeMetadataTemplatesRecord({ ...baseRecord, values: { posts: { ...custom, description: "x".repeat(5_000_000) } } }).ok);
const manyCollections = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`c${index}`, custom]));
check("more than 100 overrides are corrupt", !decodeMetadataTemplatesRecord({ ...baseRecord, values: manyCollections }).ok);
check("a non-string fallback token is corrupt", !decodeMetadataTemplatesRecord({ ...baseRecord, fallbackScoreRevision: 5 }).ok);
check("an overlong score token is corrupt",
	!decodeMetadataTemplatesRecord({ ...baseRecord, collectionUpdatedAt: { posts: "x".repeat(65) } }).ok);

const maximal = {
	version: 1,
	updatedAt: "2026-10-03T08:00:00.000Z",
	fallbackScoreRevision: null,
	values: Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`c${index}`.padEnd(64, "x"), {
		title: "\u20ac".repeat(300),
		description: "\u20ac".repeat(1_000),
		socialTitle: "\u20ac".repeat(300),
		socialDescription: "\u20ac".repeat(1_000),
	}])),
	collectionUpdatedAt: Object.fromEntries(Array.from({ length: 1_000 }, (_, index) => [`t${index}`.padEnd(64, "x"), "y".repeat(64)])),
};
check("the largest valid record decodes", decodeMetadataTemplatesRecord(maximal).ok);
check("the largest valid record stays under the host's 1 MiB conditional value limit",
	jsonUtf8LengthWithin(maximal, METADATA_TEMPLATES_MAX_RECORD_BYTES) !== null);

{
	const store = createKv();
	check("no row reads as absent", (await readMetadataTemplates(store.kv)).state === "absent");
	store.set(METADATA_TEMPLATES_KEY, { version: 1, values: "broken" });
	const corrupt = await readMetadataTemplates(store.kv);
	check("an invalid row reads as corrupt with its revision", corrupt.state === "corrupt" && corrupt.revision === store.revisions.get(METADATA_TEMPLATES_KEY));
	check("a missing versioned API reads as unavailable", (await readMetadataTemplates({ get: store.kv.get })).state === "unavailable");
	check("a thrown read (unparsable JSON) reads as unavailable",
		(await readMetadataTemplates({ getVersioned: async () => { throw new SyntaxError("Unexpected token"); } })).state === "unavailable");
	check("a malformed revision envelope reads as unavailable",
		(await readMetadataTemplates({ getVersioned: async () => ({ value: baseRecord }) })).state === "unavailable");
}

// --- Tokens -----------------------------------------------------------------

{
	const record = decodeMetadataTemplatesRecord({ ...baseRecord, collectionUpdatedAt: { posts: null } });
	const tokens = record.ok ? recordTokens(record.record) : null;
	check("an explicit null token stays null", tokens !== null && scoreTokenFor(tokens, "posts") === null);
	check("an older record falls back to updatedAt", tokens !== null && scoreTokenFor(tokens, "pages") === "2026-07-01T00:00:00.000Z");
	const withFallback = decodeMetadataTemplatesRecord({ ...baseRecord, fallbackScoreRevision: null, collectionUpdatedAt: {} });
	check("an own null fallback is used instead of updatedAt",
		withFallback.ok && scoreTokenFor(recordTokens(withFallback.record), "pages") === null);
}
check("an unreadable legacy token map counts as empty", Object.keys(legacyRevisionTokens({ collectionUpdatedAt: { posts: 5 } }) ?? { x: 1 }).length === 0);
check("legacy keys that are not content types never decide a token",
	JSON.stringify(legacyRevisionTokens({ collectionUpdatedAt: { posts: "a", "not a key": "b" } })) === JSON.stringify({ posts: "a" }));
check("a legacy token map beyond the record's limits is refused, not shortened",
	legacyRevisionTokens({ collectionUpdatedAt: Object.fromEntries(Array.from({ length: 1_001 }, (_, index) => [`c${index}`, "t"])) }) === null);

// --- Legacy inheritance -----------------------------------------------------

{
	const inherited = inheritedMetadataTemplate("posts", { title: "{{title}} | Legacy", description: null, socialTitle: null, socialDescription: null });
	check("a readable legacy field is inherited over the defaults", inherited.source === "legacy" && inherited.values.title === "{{title}} | Legacy" && inherited.values.description === defaults.posts.description);
	const invalid = inheritedMetadataTemplate("posts", { title: "{{nope}}", description: "x".repeat(2_000_000), socialTitle: null, socialDescription: null });
	check("invalid and oversized legacy fields fall back to defaults and are reported",
		invalid.source === "default" && invalid.values.title === defaults.posts.title &&
			invalid.ignoredLegacyFields.join(",") === "title,description");
}

// --- Save -------------------------------------------------------------------

{
	const store = createKv({
		[LEGACY_TEMPLATE_REVISIONS_KEY]: { version: 1, updatedAt: "2026-06-01T00:00:00.000Z", collectionUpdatedAt: { services: null, pages: "2026-06-01T00:00:00.000Z" } },
	});
	const legacyRow = store.revisions.get(LEGACY_TEMPLATE_REVISIONS_KEY);
	const created = await saveMetadataTemplate(host(store), {
		collection: "posts", expectedRevision: null, inheritanceGuard: { ...noGuard, revisions: legacyRow }, values: custom,
	});
	const record = store.values.get(METADATA_TEMPLATES_KEY) as any;
	check("a first save creates the record with one conditional write", created.success && created.changed && store.calls.compareAndSet === 1);
	check("creation keeps a null fallback token", Object.hasOwn(record, "fallbackScoreRevision") && record.fallbackScoreRevision === null);
	check("creation copies the legacy token map exactly",
		record.collectionUpdatedAt.services === null && record.collectionUpdatedAt.pages === "2026-06-01T00:00:00.000Z" &&
			typeof record.collectionUpdatedAt.posts === "string");
	const tokens = recordTokens(decodeMetadataTemplatesRecord(record).ok ? (decodeMetadataTemplatesRecord(record) as any).record : null);
	check("an unlisted collection keeps its null token after creation", scoreTokenFor(tokens, "unlisted") === null);
	check("legacy rows are never written", store.values.get(LEGACY_TEMPLATE_REVISIONS_KEY) !== undefined && store.revisions.get(LEGACY_TEMPLATE_REVISIONS_KEY) === legacyRow);

	const revision = store.revisions.get(METADATA_TEMPLATES_KEY)!;
	const before = structuredClone(record);
	const pages = { ...defaults.pages, description: "Page {{description}}" };
	await saveMetadataTemplate(host(store, undefined, Date.parse("2026-10-03T09:00:00.000Z")), {
		collection: "pages", expectedRevision: revision, inheritanceGuard: guardFor(store, "pages", false), values: pages,
	});
	const after = store.values.get(METADATA_TEMPLATES_KEY) as any;
	check("a later save keeps updatedAt, the fallback and every other token byte for byte",
		after.updatedAt === before.updatedAt && after.fallbackScoreRevision === null &&
			after.collectionUpdatedAt.posts === before.collectionUpdatedAt.posts &&
			after.collectionUpdatedAt.services === null &&
			after.collectionUpdatedAt.pages !== before.collectionUpdatedAt.pages);
	check("a later save keeps the other override", JSON.stringify(after.values.posts) === JSON.stringify(custom));

	const writes = store.calls.compareAndSet;
	const stale = await saveMetadataTemplate(host(store), {
		collection: "posts", expectedRevision: revision, inheritanceGuard: noGuard, values: { ...custom, title: "Other {{title}}" },
	});
	check("a stale revision is a conflict without a write", !stale.success && stale.error === "conflict" && store.calls.compareAndSet === writes);
	const same = await saveMetadataTemplate(host(store), {
		collection: "posts", expectedRevision: store.revisions.get(METADATA_TEMPLATES_KEY)!, inheritanceGuard: noGuard, values: custom,
	});
	check("saving the override in effect writes nothing", same.success && !same.changed && store.calls.compareAndSet === writes);
	const pinned = await saveMetadataTemplate(host(store), {
		collection: "services", expectedRevision: store.revisions.get(METADATA_TEMPLATES_KEY)!, inheritanceGuard: guardFor(store, "services", false), values: defaults.services,
	});
	check("saving inherited values unchanged does not pin them",
		pinned.success && !pinned.changed && !("services" in (store.values.get(METADATA_TEMPLATES_KEY) as any).values));
	const hidden = await saveMetadataTemplate(host(store, ["posts"]), {
		collection: "pages", expectedRevision: store.revisions.get(METADATA_TEMPLATES_KEY)!, inheritanceGuard: noGuard, values: pages,
	});
	check("a collection that is not a target is refused", !hidden.success && hidden.error === "collection_unavailable");
	const noDiscovery = await saveMetadataTemplate(host(store, null), {
		collection: "posts", expectedRevision: store.revisions.get(METADATA_TEMPLATES_KEY)!, inheritanceGuard: noGuard, values: custom,
	});
	check("unavailable discovery refuses a save", !noDiscovery.success && noDiscovery.error === "unavailable");
	const missingGuard = await saveMetadataTemplate(host(store), { collection: "posts", expectedRevision: null, values: custom });
	check("a command without its loaded guard is refused", !missingGuard.success && missingGuard.error === "invalid_input");
}

// An earlier version's full-set record keeps its global fallback.
{
	const store = createKv({ [METADATA_TEMPLATES_KEY]: { version: 1, updatedAt: "2026-07-01T00:00:00.000Z", values: { posts: custom, pages: defaults.pages } } });
	await saveMetadataTemplate(host(store), {
		collection: "posts", expectedRevision: store.revisions.get(METADATA_TEMPLATES_KEY)!, inheritanceGuard: noGuard, values: { ...custom, title: "New {{title}}" },
	});
	const record = store.values.get(METADATA_TEMPLATES_KEY) as any;
	check("an older record gains only the selected token and no fallback field",
		record.updatedAt === "2026-07-01T00:00:00.000Z" && !Object.hasOwn(record, "fallbackScoreRevision") &&
			Object.keys(record.collectionUpdatedAt).join(",") === "posts");
}

// --- Loaded inheritance guards ---------------------------------------------

{
	const store = createKv({ "tpl:posts:title": "{{title}} | Legacy" });
	const loaded = guardFor(store, "posts", true);
	store.set("tpl:posts:title", "{{title}} | Changed");
	const raced = await saveMetadataTemplate(host(store), { collection: "posts", expectedRevision: null, inheritanceGuard: loaded, values: custom });
	check("a legacy change between load and command is a conflict", !raced.success && raced.error === "conflict" && store.calls.compareAndSet === 0);

	const reloaded = guardFor(store, "posts", true);
	store.set("tpl:posts:title", "{{title}} | Changed");
	const aba = await saveMetadataTemplate(host(store), { collection: "posts", expectedRevision: null, inheritanceGuard: reloaded, values: custom });
	check("an equal legacy value written again is still a conflict", !aba.success && aba.error === "conflict" && store.calls.compareAndSet === 0);

	const current = guardFor(store, "posts", true);
	store.set(LEGACY_TEMPLATE_REVISIONS_KEY, { collectionUpdatedAt: {} });
	const tokenRow = await saveMetadataTemplate(host(store), { collection: "posts", expectedRevision: null, inheritanceGuard: current, values: custom });
	check("a legacy token row change while absent is a conflict", !tokenRow.success && tokenRow.error === "conflict");

	const fresh = guardFor(store, "posts", true);
	const { revisions: _omit, ...withoutRows } = fresh;
	const noRow = await saveMetadataTemplate(host(store), { collection: "posts", expectedRevision: null, inheritanceGuard: withoutRows, values: custom });
	check("an absent-state command without the token-row guard is a conflict", !noRow.success && noRow.error === "conflict");

	// A legacy write after the first check and before the conditional write is caught by the final recheck.
	let titleReads = 0;
	store.onVersionedRead((key) => {
		if (key === "tpl:posts:title" && ++titleReads === 2) store.set("tpl:posts:title", "{{title}} | Late");
	});
	const late = await saveMetadataTemplate(host(store), { collection: "posts", expectedRevision: null, inheritanceGuard: fresh, values: custom });
	store.onVersionedRead(null);
	check("the final recheck before the write catches a late legacy change", !late.success && late.error === "conflict" && store.calls.compareAndSet === 0);
}

// --- Reset ------------------------------------------------------------------

{
	const store = createKv({ "tpl:posts:title": "{{title}} | Legacy" });
	const absent = await resetMetadataTemplate(host(store), { collection: "posts", expectedRevision: null, inheritanceGuard: absentGuard });
	check("resetting with no record writes nothing", absent.success && !absent.changed && store.calls.compareAndSet === 0);
	store.set(METADATA_TEMPLATES_KEY, {
		version: 1, updatedAt: "2026-07-01T00:00:00.000Z", fallbackScoreRevision: null,
		values: { posts: custom, pages: defaults.pages },
		collectionUpdatedAt: { posts: "2026-07-02T00:00:00.000Z", pages: "2026-07-03T00:00:00.000Z" },
	});
	const reviewed = guardFor(store, "posts", false);
	store.set("tpl:posts:title", "{{title}} | Unreviewed");
	const unreviewed = await resetMetadataTemplate(host(store), {
		collection: "posts", expectedRevision: store.revisions.get(METADATA_TEMPLATES_KEY)!, inheritanceGuard: reviewed,
	});
	check("a reset never applies inheritance the editor did not review", !unreviewed.success && unreviewed.error === "conflict");
	const reset = await resetMetadataTemplate(host(store), {
		collection: "posts", expectedRevision: store.revisions.get(METADATA_TEMPLATES_KEY)!, inheritanceGuard: guardFor(store, "posts", false),
	});
	let record = store.values.get(METADATA_TEMPLATES_KEY) as any;
	check("a reset that changes values advances that token only",
		reset.success && reset.changed && !("posts" in record.values) &&
			record.collectionUpdatedAt.posts !== "2026-07-02T00:00:00.000Z" && record.collectionUpdatedAt.pages === "2026-07-03T00:00:00.000Z");
	const equal = await resetMetadataTemplate(host(store), {
		collection: "pages", expectedRevision: store.revisions.get(METADATA_TEMPLATES_KEY)!, inheritanceGuard: guardFor(store, "pages", false),
	});
	record = store.values.get(METADATA_TEMPLATES_KEY) as any;
	check("removing an override equal to inheritance changes ownership and keeps its token",
		equal.success && equal.changed && !("pages" in record.values) && record.collectionUpdatedAt.pages === "2026-07-03T00:00:00.000Z");
	check("the record is kept with no overrides", Object.keys(record.values).length === 0 && decodeMetadataTemplatesRecord(record).ok);
}

// --- Write outcomes ---------------------------------------------------------

{
	const store = createKv();
	store.failCompareAndSet("throw");
	const thrown = await saveMetadataTemplate(host(store), { collection: "posts", expectedRevision: null, inheritanceGuard: absentGuard, values: custom });
	check("a thrown write is unconfirmed after one attempt", !thrown.success && thrown.error === "unconfirmed" && store.calls.compareAndSet === 1);
	store.failCompareAndSet("no-revision");
	const noRevision = await saveMetadataTemplate(host(createKv()), { collection: "posts", expectedRevision: null, inheritanceGuard: absentGuard, values: custom });
	const blind = createKv();
	blind.failCompareAndSet("no-revision");
	const applied = await saveMetadataTemplate(host(blind), { collection: "posts", expectedRevision: null, inheritanceGuard: absentGuard, values: custom });
	check("an applied write without a revision is unconfirmed", noRevision.success && !applied.success && applied.error === "unconfirmed");
	const corruptStore = createKv({ [METADATA_TEMPLATES_KEY]: { version: 9 } });
	const corrupt = await saveMetadataTemplate(host(corruptStore), {
		collection: "posts", expectedRevision: corruptStore.revisions.get(METADATA_TEMPLATES_KEY)!, inheritanceGuard: noGuard, values: custom,
	});
	check("a corrupt record is never replaced", !corrupt.success && corrupt.error === "corrupt" &&
		JSON.stringify(corruptStore.values.get(METADATA_TEMPLATES_KEY)) === JSON.stringify({ version: 9 }));
	const oversizedTokens = createKv({ [LEGACY_TEMPLATE_REVISIONS_KEY]: { collectionUpdatedAt: Object.fromEntries(Array.from({ length: 1_001 }, (_, index) => [`c${index}`, null])) } });
	const promoted = await saveMetadataTemplate(host(oversizedTokens), {
		collection: "posts", expectedRevision: null,
		inheritanceGuard: { ...noGuard, revisions: oversizedTokens.revisions.get(LEGACY_TEMPLATE_REVISIONS_KEY)! }, values: custom,
	});
	check("an oversized legacy token map is not promoted", !promoted.success && promoted.error === "unavailable" && oversizedTokens.calls.compareAndSet === 0);
}

// --- Portability (templates key only) ---------------------------------------

{
	const store = createKv({ [METADATA_TEMPLATES_KEY]: { version: 1, updatedAt: "2026-07-01T00:00:00.000Z", values: { posts: custom }, collectionUpdatedAt: { posts: "a" } } });
	const bound = { revision: store.revisions.get(METADATA_TEMPLATES_KEY)!, value: structuredClone(store.values.get(METADATA_TEMPLATES_KEY)) };
	const legacy = async () => ({ title: null, description: null, socialTitle: null, socialDescription: null });
	const unchanged = await writePortabilityTemplates(store.kv, bound, { posts: custom }, legacy, null, Date.now());
	check("an import with the same overrides writes nothing", unchanged.status === "unchanged" && store.calls.compareAndSet === 0);

	store.set(METADATA_TEMPLATES_KEY, store.values.get(METADATA_TEMPLATES_KEY));
	const afterSnapshot = await writePortabilityTemplates(store.kv, bound, { posts: custom, pages: defaults.pages }, legacy, null, Date.now());
	check("an import never adopts a revision written after its snapshot", afterSnapshot.status === "refused" && afterSnapshot.reason === "conflict");

	const rebound = { revision: store.revisions.get(METADATA_TEMPLATES_KEY)!, value: structuredClone(store.values.get(METADATA_TEMPLATES_KEY)) };
	const written = await writePortabilityTemplates(store.kv, rebound, { posts: { ...custom, title: "Imported {{title}}" } }, legacy, null, Date.now());
	check("an import writes under its bound revision", written.status === "written");
	if (written.status === "written") {
		store.set(METADATA_TEMPLATES_KEY, store.values.get(METADATA_TEMPLATES_KEY));
		const aba = await rollbackPortabilityTemplates(store.kv, written.revision, rebound);
		check("rollback preserves a later write with equal values (ABA)", aba === "conflict" &&
			(store.values.get(METADATA_TEMPLATES_KEY) as any).values.posts.title === "Imported {{title}}");
	}
	const own = await writePortabilityTemplates(store.kv, { revision: store.revisions.get(METADATA_TEMPLATES_KEY)!, value: structuredClone(store.values.get(METADATA_TEMPLATES_KEY)) },
		{ posts: custom }, legacy, null, Date.now());
	if (own.status === "written") {
		const prior = { revision: "unused", value: { version: 1, updatedAt: "2026-07-01T00:00:00.000Z", values: { posts: { ...custom, title: "Imported {{title}}" } }, collectionUpdatedAt: { posts: "a" } } };
		const restored = await rollbackPortabilityTemplates(store.kv, own.revision, prior);
		check("rollback restores the prior value on the import's own revision", restored === "restored" &&
			(store.values.get(METADATA_TEMPLATES_KEY) as any).values.posts.title === "Imported {{title}}");
	} else check("rollback restores the prior value on the import's own revision", false, own.status);

	const empty = createKv();
	const created = await writePortabilityTemplates(empty.kv, { revision: null, value: null }, { posts: custom }, legacy, null, Date.now());
	check("an import into an absent record keeps a null fallback",
		created.status === "written" && (empty.values.get(METADATA_TEMPLATES_KEY) as any).fallbackScoreRevision === null);
	if (created.status === "written") {
		const deleted = await rollbackPortabilityTemplates(empty.kv, created.revision, { revision: null, value: null });
		check("rollback restores true prior absence with compareAndDelete", deleted === "restored" && !empty.values.has(METADATA_TEMPLATES_KEY) && empty.calls.compareAndDelete === 1);
	}
	const corrupt = await writePortabilityTemplates(empty.kv, { revision: "r1", value: { version: 7 } }, { posts: custom }, legacy, null, Date.now());
	check("an import refuses a corrupt bound record", corrupt.status === "refused" && corrupt.reason === "corrupt");
	check("rollback without conditional APIs leaves the bytes", await rollbackPortabilityTemplates({ get: async () => null }, "r1", { revision: null, value: null }) === "unavailable");
	const throwing = await rollbackPortabilityTemplates({ compareAndSet: async () => { throw new Error("closed"); } }, "r1", { revision: "r0", value: {} });
	check("a thrown rollback is unconfirmed", throwing === "unconfirmed");
}

if (failures) {
	console.error(`\n${failures} metadata template self-check(s) failed.`);
	process.exit(1);
}
console.log("\nAll metadata template self-checks passed.");
