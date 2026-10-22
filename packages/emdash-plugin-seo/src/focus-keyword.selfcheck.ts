import assert from "node:assert/strict";

import {
	focusKeywordIsValid,
	focusKeywordsValidationError,
	normaliseFocusKeywords,
	persistAnalysisProfile,
	readAnalysisProfile,
	resolveEffectiveFocusKeyword,
	resolveEffectiveFocusKeywords,
	resolveFocusKeywordOwnership,
} from "./focus-keyword.ts";
import { normaliseSeoKeywordText, seoKeywordFirstPosition, seoKeywordOccurrenceCount } from "./keyword-match.ts";

const records = new Map<string, unknown>();
let reads = 0;
const context = {
	storage: {
		analysisProfiles: {
			get: async (id: string) => {
				reads += 1;
				return structuredClone(records.get(id) ?? null);
			},
			put: async (id: string, value: unknown) => records.set(id, structuredClone(value)),
			delete: async (id: string) => records.delete(id),
		},
	},
} as any;

assert.equal(focusKeywordIsValid(" keyword "), true);
assert.equal(focusKeywordIsValid("x".repeat(121)), false);
assert.deepEqual(normaliseFocusKeywords([" primary  keyword ", "PRIMARY KEYWORD", "secondary"]), [
	"primary keyword",
	"secondary",
]);
assert.equal(focusKeywordsValidationError(["one", "two", "three", "four", "five"]), null);
assert.equal(focusKeywordsValidationError(["one", "two", "three", "four", "five", "six"]), "too_many_keywords");
assert.equal(focusKeywordsValidationError(["valid", "x".repeat(121)]), "keyword_too_long");
assert.equal(focusKeywordsValidationError(["valid", 42]), "invalid_keyword");
assert.equal(
	await resolveEffectiveFocusKeyword(context, "posts:one", " request   keyword ", "content keyword"),
	"request keyword",
);
assert.equal(reads, 0, "a transient keyword must not read storage");
assert.deepEqual(
	await resolveEffectiveFocusKeywords(
		context,
		"posts:one",
		[" request keyword ", "secondary keyword"],
		"content keyword",
	),
	["request keyword", "secondary keyword"],
);
assert.equal(reads, 0, "transient keyword lists must not read storage");

const stored = await persistAnalysisProfile(context, "posts:one", [
	" saved   keyword ",
	"secondary keyword",
	"SAVED KEYWORD",
]);
assert.equal(stored?.keyword, "saved keyword");
assert.deepEqual(stored?.keywords, ["saved keyword", "secondary keyword"]);
assert.equal((await readAnalysisProfile(context, "posts:one"))?.keyword, "saved keyword");
assert.deepEqual(
	await resolveEffectiveFocusKeywords(context, "posts:one", undefined, "content keyword"),
	["saved keyword", "secondary keyword"],
);
assert.equal(
	await resolveEffectiveFocusKeyword(context, "posts:one", undefined, "content keyword"),
	"saved keyword",
);

records.set("posts:legacy", {
	storageVersion: 1,
	ref: "posts:legacy",
	keyword: "legacy keyword",
	updatedAt: "2026-07-17T10:00:00.000Z",
});
const migrated = await readAnalysisProfile(context, "posts:legacy");
assert.equal(migrated?.storageVersion, 4);
assert.deepEqual(migrated?.keywords, ["legacy keyword"]);
assert.equal(migrated?.pillar, false, "v1 profiles migrate with pillar unset");
assert.deepEqual(records.get("posts:legacy"), migrated, "legacy profiles must migrate lazily on read");

records.set("posts:legacy-v2", {
	storageVersion: 2,
	ref: "posts:legacy-v2",
	keyword: "second keyword",
	keywords: ["second keyword", "another keyword"],
	updatedAt: "2026-07-18T10:00:00.000Z",
});
const migratedV2 = await readAnalysisProfile(context, "posts:legacy-v2");
assert.equal(migratedV2?.storageVersion, 4);
assert.deepEqual(migratedV2?.keywords, ["second keyword", "another keyword"]);
assert.equal(migratedV2?.pillar, false, "v2 profiles migrate with pillar unset");

// v3 keyword arrays keep their meaning verbatim: an empty v3 array was an
// intentional clear and must stay `[]` after migration, never become `null`.
records.set("posts:legacy-v3", {
	storageVersion: 3,
	ref: "posts:legacy-v3",
	keyword: "",
	keywords: [],
	pillar: true,
	updatedAt: "2026-07-19T10:00:00.000Z",
});
const migratedV3 = await readAnalysisProfile(context, "posts:legacy-v3");
assert.equal(migratedV3?.storageVersion, 4);
assert.deepEqual(migratedV3?.keywords, [], "v3 empty statements stay intentional clears");
assert.equal(migratedV3?.pillar, true, "v3 pillar survives migration");

records.set("posts:broken", { storageVersion: 99, ref: "posts:broken", keyword: "poisoned", updatedAt: "today" });
assert.equal(
	await resolveEffectiveFocusKeyword(context, "posts:broken", undefined, "content keyword"),
	"content keyword",
	"invalid records must not become analyzer input",
);

// Pillar is part of the profile: keyword-only saves preserve it, and a
// pillar-only profile (no keywords) is a valid stored state.
const pillarProfile = await persistAnalysisProfile(context, "posts:pillar", [], { pillar: true });
assert.equal(pillarProfile?.pillar, true);
assert.deepEqual(pillarProfile?.keywords, []);
assert.equal(pillarProfile?.keyword, "");
assert.equal((await readAnalysisProfile(context, "posts:pillar"))?.pillar, true);
const pillarWithKeyword = await persistAnalysisProfile(context, "posts:pillar", ["cluster topic"]);
assert.equal(pillarWithKeyword?.pillar, true, "keyword-only saves must preserve pillar");
const pillarCleared = await persistAnalysisProfile(context, "posts:pillar", ["cluster topic"], { pillar: false });
assert.equal(pillarCleared?.pillar, false);
const emptyPillarProfile = await persistAnalysisProfile(context, "posts:pillar", [], { pillar: false });
assert.deepEqual(emptyPillarProfile?.keywords, []);
assert.equal(records.has("posts:pillar"), true, "empty keywords preserve the explicit analyzer choice");

const emptyProfile = await persistAnalysisProfile(context, "posts:one", [], { pillar: false });
assert.deepEqual(emptyProfile?.keywords, []);
assert.equal(records.has("posts:one"), true);
assert.equal(
	await resolveEffectiveFocusKeyword(context, "posts:one", undefined, " content   keyword "),
	undefined,
	"an explicit empty profile must suppress the legacy content fallback",
);

await assert.rejects(
	() => persistAnalysisProfile({ storage: {} } as any, "posts:one", "keyword"),
	/analysis_profile_storage_unavailable/,
);

// --- Keyword ownership resolution -----------------------------------------
// The five states the admin contract distinguishes: transient, profile,
// intentionally cleared profile, inherited content keyword, and none.

const transientOwnership = await resolveFocusKeywordOwnership(
	context,
	"posts:one",
	"request keyword",
	"content keyword",
);
assert.equal(transientOwnership.source, "transient");
assert.deepEqual(transientOwnership.keywords, ["request keyword"]);
assert.deepEqual(
	transientOwnership.profileKeywords,
	[],
	"transient requests still report the stored statement",
);

await persistAnalysisProfile(context, "posts:owned", ["profile keyword"], {
	pillar: true,
});
const profileOwnership = await resolveFocusKeywordOwnership(
	context,
	"posts:owned",
	undefined,
	"content keyword",
);
assert.equal(profileOwnership.source, "profile");
assert.deepEqual(profileOwnership.keywords, ["profile keyword"]);
assert.deepEqual(profileOwnership.profileKeywords, ["profile keyword"]);
assert.equal(profileOwnership.pillar, true);

const clearedOwnership = await resolveFocusKeywordOwnership(
	context,
	"posts:one",
	undefined,
	"content keyword",
);
assert.equal(clearedOwnership.source, "none", "a cleared profile suppresses the fallback");
assert.deepEqual(clearedOwnership.keywords, []);
assert.deepEqual(clearedOwnership.profileKeywords, []);

const inheritedOwnership = await resolveFocusKeywordOwnership(
	context,
	"posts:untouched",
	undefined,
	" content   keyword ",
);
assert.equal(inheritedOwnership.source, "content");
assert.deepEqual(inheritedOwnership.keywords, ["content keyword"]);
assert.equal(
	inheritedOwnership.profileKeywords,
	null,
	"an inherited keyword is never presented as profile data",
);

const noneOwnership = await resolveFocusKeywordOwnership(
	context,
	"posts:untouched",
	undefined,
	undefined,
);
assert.equal(noneOwnership.source, "none");
assert.deepEqual(noneOwnership.keywords, []);
assert.equal(noneOwnership.profileKeywords, null);

// --- Pillar-only saves (`keywords: null`) ----------------------------------
// A pillar toggle with no prior profile stores `keywords: null`, so the
// inherited content keyword keeps driving analysis and is never adopted.

const pillarOnly = await persistAnalysisProfile(context, "posts:pillar-only", null, {
	pillar: true,
});
assert.equal(pillarOnly?.pillar, true);
assert.equal(pillarOnly?.keywords, null, "pillar-only saves make no keyword statement");
assert.equal(pillarOnly?.keyword, "");
const pillarOnlyOwnership = await resolveFocusKeywordOwnership(
	context,
	"posts:pillar-only",
	undefined,
	"content keyword",
);
assert.equal(
	pillarOnlyOwnership.source,
	"content",
	"a null statement leaves the content fallback in charge",
);
assert.equal(pillarOnlyOwnership.pillar, true);
assert.equal(pillarOnlyOwnership.profileKeywords, null);

// `keywords: null` on an existing explicit statement preserves it verbatim.
await persistAnalysisProfile(context, "posts:owned", null, { pillar: false });
const preserved = await readAnalysisProfile(context, "posts:owned");
assert.deepEqual(preserved?.keywords, ["profile keyword"]);
assert.equal(preserved?.pillar, false);

// A null-statement profile survives a read round-trip (validator accepts it).
assert.equal(
	(await readAnalysisProfile(context, "posts:pillar-only"))?.pillar,
	true,
	"null-statement profiles must read back",
);

const strictRef = "posts:strict";
const strictRecords = new Map<string, unknown>();
let strictReads = 0;
let strictWrites = 0;
const strictContext = {
	storage: { analysisProfiles: {
		get: async (id: string) => { strictReads += 1; return strictRecords.get(id); },
		put: async (id: string, value: unknown) => { strictWrites += 1; strictRecords.set(id, structuredClone(value)); },
		delete: async () => { throw new Error("Unexpected delete"); },
	} },
} as any;
for (const absent of [undefined, null]) {
	strictRecords.set(strictRef, absent);
	assert.equal(await readAnalysisProfile(strictContext, strictRef, { requireReadable: true, persistMigration: false }), null,
		"only a confirmed absent record becomes an empty editable profile");
}
for (const invalid of [
	"unreadable",
	[],
	{ storageVersion: 99, ref: strictRef, keyword: "future keyword", updatedAt: "2026-10-17T10:00:00.000Z" },
	{ storageVersion: 4, ref: "posts:other", keyword: "other keyword", keywords: ["other keyword"], pillar: true, updatedAt: "2026-10-17T10:00:00.000Z" },
	{ storageVersion: 4, ref: strictRef, keyword: "wrong primary", keywords: ["saved keyword"], pillar: false, updatedAt: "2026-10-17T10:00:00.000Z" },
]) {
	strictRecords.set(strictRef, structuredClone(invalid));
	await assert.rejects(() => readAnalysisProfile(strictContext, strictRef, { requireReadable: true, persistMigration: false }),
		/analysis_profile_unreadable/);
	for (const keywords of [null, ["replacement"]]) {
		await assert.rejects(() => persistAnalysisProfile(strictContext, strictRef, keywords, { pillar: false }),
			/analysis_profile_unreadable/);
	}
	assert.deepEqual(strictRecords.get(strictRef), invalid, "an unreadable record is never replaced by defaults or edits");
}
assert.equal(strictWrites, 0);
await assert.rejects(() => readAnalysisProfile({ storage: {} } as any, strictRef, { requireReadable: true }),
	/analysis_profile_storage_unavailable/);
assert.equal(await readAnalysisProfile({ storage: {} } as any, strictRef), null, "non-strict analyzer reads keep compatibility");
const readFailureContext = { storage: { analysisProfiles: {
	get: async () => { throw new Error("storage read failed"); },
	put: async () => { strictWrites += 1; },
	delete: async () => { throw new Error("Unexpected delete"); },
} } } as any;
await assert.rejects(() => readAnalysisProfile(readFailureContext, strictRef, { requireReadable: true }), /storage read failed/);
await assert.rejects(() => persistAnalysisProfile(readFailureContext, strictRef, ["replacement"]), /storage read failed/);
assert.equal(strictWrites, 0);
const readableLegacy = { storageVersion: 3, ref: strictRef, keyword: "", keywords: [], pillar: true, updatedAt: "2026-10-17T10:00:00.000Z" };
strictRecords.set(strictRef, readableLegacy);
assert.deepEqual((await readAnalysisProfile(strictContext, strictRef, { requireReadable: true, persistMigration: false }))?.keywords, []);
assert.deepEqual(strictRecords.get(strictRef), readableLegacy, "strict legacy reads normalize without storage migration");
strictRecords.delete(strictRef);
strictReads = 0;
await persistAnalysisProfile(strictContext, strictRef, ["new keyword"]);
assert.equal(strictReads, 1, "a save performs one strict prior read, with no extra verification read");
assert.equal(strictWrites, 1);

// Literal keyword matching keeps marks that change a word and folds only case and removable accents.
for (const [text, keyword, expected, reason] of [
	["เสื้อผ้าสีขาว ขาว ขาวสะอาด", "ข้าว", 0, "a Thai tone mark distinguishes rice from white"],
	["ข้าวผัด ข้าว", "ข้าว", 2, "an unspaced Thai keyword matches as a substring"],
	["ทางไกล", "ไก่", 0, "a Thai tone mark distinguishes chicken from far"],
	["आप क्या कर रहे हैं", "कार", 0, "a Devanagari vowel sign distinguishes car from do"],
	["करो", "कर", 0, "a Devanagari vowel sign ends no word early"],
	["नई कार खरीदें", "कार", 1, "a Devanagari word still matches between spaces"],
	["Işık kirliliği nedir", "ışık kirliliği", 1, "Turkish capital I folds to the dotless keyword"],
	["IŞIK KIRMIZI", "ışık", 1, "upper-case Turkish text matches its lower-case keyword"],
	["İstanbul", "istanbul", 1, "Turkish dotted capital I folds to i"],
	["iPhoneの設定", "iPhone", 1, "a Latin keyword ends at an unspaced-script character"],
	["ガiPhone", "iphone", 1, "a Latin keyword starts after a kana character with a mark"],
	["iphones", "iphone", 0, "a Latin keyword still needs a word boundary"],
	["ガイド", "カイト", 0, "kana voicing marks distinguish words"],
	["ガイドのガイド", "ガイド", 2, "a kana keyword with voicing marks matches each occurrence"],
	["Café crème", "cafe creme", 1, "Latin accents stay removable"],
	["boiler repair. Boiler repair!", "boiler repair", 2, "punctuation and case stay presentation-only"],
] as const) assert.equal(seoKeywordOccurrenceCount(text, keyword), expected, reason);
assert.equal(normaliseSeoKeywordText("IŞIK"), normaliseSeoKeywordText("ışık"), "Turkish case variants share one keyword identity");
assert.notEqual(normaliseSeoKeywordText("ข้าว"), normaliseSeoKeywordText("ขาว"), "Thai tone marks are part of the keyword identity");
assert.equal(seoKeywordFirstPosition("設定iPhone", "iphone"), 2, "the first position follows the same boundaries as the count");
assert.equal(seoKeywordFirstPosition("ทางไกล", "ไก่"), -1);

console.log("SEO focus keyword storage self-check passed.");
