import assert from "node:assert/strict";

import {
	deleteMetaOverride,
	isSeoAdminMetaOverride,
	mergeRobotsDirectives,
	normaliseDisabledPresets,
	normaliseRobotsDirectives,
	persistMetaOverride,
	readMetaOverride,
	robotsDirectivesActive,
	updateMetaOverride,
} from "./meta-overrides.ts";

const records = new Map<string, unknown>();
const context = {
	storage: {
		metaOverrides: {
			get: async (id: string) => structuredClone(records.get(id) ?? null),
			put: async (id: string, value: unknown) => records.set(id, structuredClone(value)),
			delete: async (id: string) => records.delete(id),
			compareAndSet: async (id: string, expected: any, next: any) => {
				const present = records.has(id);
				if (expected.state === "missing" ? present : !present) return false;
				if (
					expected.state === "value" &&
					JSON.stringify(records.get(id)) !== JSON.stringify(expected.value)
				)
					return false;
				if (next.action === "delete") return records.delete(id);
				records.set(id, structuredClone(next.value));
				return true;
			},
		},
	},
} as any;

// Normalisation: missing flags default false, non-boolean flags reject.
assert.deepEqual(normaliseRobotsDirectives({}), {
	nofollow: false,
	noarchive: false,
	nosnippet: false,
	noimageindex: false,
	notranslate: false,
});
assert.equal(normaliseRobotsDirectives({ nofollow: "yes" }), null);
assert.equal(normaliseRobotsDirectives(null), null);
assert.equal(normaliseRobotsDirectives([]), null);
assert.equal(
	normaliseRobotsDirectives({ nofollow: true })?.nofollow,
	true,
);

assert.equal(robotsDirectivesActive(null), false);
assert.equal(
	robotsDirectivesActive(normaliseRobotsDirectives({})),
	false,
);
assert.equal(
	robotsDirectivesActive(normaliseRobotsDirectives({ nosnippet: true })),
	true,
);

// Merge: extends the base robots value, dedupes, never invents index/noindex.
assert.equal(mergeRobotsDirectives("", null), "");
assert.equal(
	mergeRobotsDirectives("", normaliseRobotsDirectives({ nofollow: true, noarchive: true })),
	"nofollow,noarchive",
);
assert.equal(
	mergeRobotsDirectives(
		"noindex,nofollow",
		normaliseRobotsDirectives({ nofollow: true, notranslate: true }),
	),
	"noindex,nofollow,notranslate",
	"tokens already present in the base must not duplicate",
);
assert.equal(
	mergeRobotsDirectives("NOINDEX, Nofollow", normaliseRobotsDirectives({ noarchive: true })),
	"noindex,nofollow,noarchive",
	"base tokens are normalised to lowercase and trimmed",
);
assert.equal(
	mergeRobotsDirectives(
		"index, follow",
		normaliseRobotsDirectives({ nofollow: true }),
	),
	"index,nofollow",
	"an enabled directive removes its contradicted positive counterpart",
);

// Persist / read round-trip; all-false deletes the record.
const active = normaliseRobotsDirectives({ nofollow: true, noimageindex: true });
assert.ok(active);
const saved = await persistMetaOverride(context, "posts:one", active);
assert.equal(saved?.storageVersion, 1);
assert.equal(saved?.ref, "posts:one");
assert.equal((await readMetaOverride(context, "posts:one"))?.robots.noimageindex, true);
assert.equal(isSeoAdminMetaOverride("posts:one", records.get("posts:one")), true);
assert.equal(
	isSeoAdminMetaOverride("posts:other", records.get("posts:one")),
	false,
	"records must match the requested ref",
);

const cleared = await persistMetaOverride(
	context,
	"posts:one",
	normaliseRobotsDirectives({})!,
);
assert.equal(cleared, null);
assert.equal(records.has("posts:one"), false, "inactive directives delete the record");

// Invalid stored values never surface.
records.set("posts:poisoned", { storageVersion: 9, ref: "posts:poisoned", robots: { nofollow: "x" }, updatedAt: "today" });
assert.equal(await readMetaOverride(context, "posts:poisoned"), null);

await persistMetaOverride(context, "posts:two", normaliseRobotsDirectives({ nosnippet: true })!);
await deleteMetaOverride(context, "posts:two");
assert.equal(records.has("posts:two"), false);

// Missing storage: reads degrade to null, writes throw.
assert.equal(await readMetaOverride({ storage: {} } as any, "posts:one"), null);
await assert.rejects(
	() => persistMetaOverride({ storage: {} } as any, "posts:one", active),
	/meta_override_storage_unavailable/,
);

// --- Per-entry disabled presets ---------------------------------------------
assert.deepEqual(normaliseDisabledPresets(undefined), []);
assert.deepEqual(normaliseDisabledPresets(["blogPosting", "blogPosting", "service"]), [
	"blogPosting",
	"service",
]);
assert.equal(normaliseDisabledPresets("blogPosting"), null);
assert.equal(normaliseDisabledPresets([42]), null);
assert.equal(normaliseDisabledPresets([""]), null);

// A record with only disabled presets (all-false robots) still persists…
const presetsOnly = await persistMetaOverride(
	context,
	"posts:three",
	normaliseRobotsDirectives({})!,
	["blogPosting"],
);
assert.deepEqual(presetsOnly?.disabledPresets, ["blogPosting"]);
assert.equal(
	(await readMetaOverride(context, "posts:three"))?.disabledPresets?.[0],
	"blogPosting",
);
// …and clearing both dimensions deletes it.
assert.equal(
	await persistMetaOverride(context, "posts:three", normaliseRobotsDirectives({})!, []),
	null,
);
assert.equal(records.has("posts:three"), false);

// Records written before disabledPresets existed read back with an empty list.
records.set("posts:legacy-record", {
	storageVersion: 1,
	ref: "posts:legacy-record",
	robots: {
		nofollow: true,
		noarchive: false,
		nosnippet: false,
		noimageindex: false,
		notranslate: false,
	},
	updatedAt: "2026-07-19T10:00:00.000Z",
});
assert.deepEqual(
	(await readMetaOverride(context, "posts:legacy-record"))?.disabledPresets,
	[],
);

// Independent robots and schema updates merge even when they start together.
await Promise.all([
	updateMetaOverride(context, "posts:concurrent", {
		robots: normaliseRobotsDirectives({ nofollow: true })!,
	}),
	updateMetaOverride(context, "posts:concurrent", {
		disabledPresets: ["blogPosting"],
	}),
]);
const concurrent = await readMetaOverride(context, "posts:concurrent");
assert.equal(concurrent?.robots.nofollow, true);
assert.deepEqual(concurrent?.disabledPresets, ["blogPosting"]);

// An explicit empty list remains a deliberate preset reset.
const resetPresets = await updateMetaOverride(context, "posts:concurrent", {
	disabledPresets: [],
});
assert.equal(resetPresets?.robots.nofollow, true);
assert.deepEqual(resetPresets?.disabledPresets, []);

console.log("SEO meta overrides self-check passed.");
