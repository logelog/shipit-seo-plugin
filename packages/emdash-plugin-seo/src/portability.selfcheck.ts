import {
	SEO_ADMIN_MODULE_DEFINITIONS,
	SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS,
	SEO_PORTABILITY_FORMAT,
	SEO_PORTABILITY_MAX_BYTES,
	defaultSeoAdminSitemapValues,
	defaultSeoAdminTemplateSet,
	type SeoAdminModuleValues,
	type SeoAdminSchemaPresetValues,
	type SeoPortabilityBundle,
	type SeoPortabilityMode,
} from "./admin-contract.ts";
import { defaultIndexNowSettings } from "./indexnow.ts";
import {
	applySeoPortabilityBundleToState,
	createSeoPortabilityBundle,
	planSeoPortabilityWrites,
	previewSeoPortabilityImport,
	seoPortabilityFingerprint,
	seoPortabilityPlanFingerprint,
	seoPortabilityStoredRecords,
	validateSeoPortabilityBundle,
	type SeoPortabilityState,
	type SeoPortabilityStoredRecords,
	type SeoPortabilityTargetContext,
} from "./portability.ts";

let failures = 0;

function check(label: string, condition: boolean) {
	if (condition) console.log(`  PASS  ${label}`);
	else {
		failures += 1;
		console.error(`  FAIL  ${label}`);
	}
}

function clone<T>(value: T): T {
	return structuredClone(value);
}

function state(): SeoPortabilityState {
	return {
		settings: {
			siteName: "Current site",
			siteUrl: "https://current.example",
			publisherType: "organization",
			organizationName: "Current organization",
			organizationLogo: "https://current.example/logo.svg",
			personName: "",
			personProfiles: [],
			socialProfiles: ["https://social.example/current"],
			defaultSocialImage: "https://current.example/social.jpg",
			twitterHandle: "@current",
			noindex: false,
			contentScoringEnabled: true,
		},
		sitemap: defaultSeoAdminSitemapValues(),
		modules: Object.fromEntries(
			SEO_ADMIN_MODULE_DEFINITIONS.map((definition) => [definition.key, definition.defaultEnabled]),
		) as SeoAdminModuleValues,
		schemaPresets: Object.fromEntries(
			SEO_ADMIN_SCHEMA_PRESET_DEFINITIONS.map((definition) => [definition.key, definition.defaultEnabled]),
		) as SeoAdminSchemaPresetValues,
		templates: defaultSeoAdminTemplateSet(),
		customSchemas: [{
			id: "local-schema",
			name: "Local schema",
			scope: "pages",
			json: JSON.stringify({
				"@context": "https://schema.org",
				"@type": "WebPage",
				"@id": "https://current.example/#local-page",
			}),
			enabled: true,
		}],
		indexNow: {
			...defaultIndexNowSettings(),
			enabled: true,
			apiKey: "12345678-abcd",
		},
		schemaContentTypes: {},
	};
}

const current = state();
const exported = createSeoPortabilityBundle(current, new Date("2026-07-14T17:30:00.000Z"));
const serialized = JSON.stringify(exported);
check("export format is explicit", exported.format === SEO_PORTABILITY_FORMAT);
check("export timestamp is deterministic", exported.exportedAt === "2026-07-14T17:30:00.000Z");
check("export never contains the IndexNow key", !serialized.includes(current.indexNow.apiKey));
check("export declares secret omission", exported.safeguards.secrets === "omitted");
check("export carries sitemap policy", exported.configuration.sitemap.contentTypes.posts === true);
check("export validates", validateSeoPortabilityBundle(exported).success === true);
const oversizedState = state();
oversizedState.customSchemas = Array.from({ length: 12 }, (_, index) => ({
	id: `large-schema-${index}`,
	name: `Large schema ${index}`,
	scope: "pages",
	json: JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage", description: "x".repeat(90_000) }),
	enabled: false,
}));
const singleLargeSchema = createSeoPortabilityBundle({
	...oversizedState,
	customSchemas: oversizedState.customSchemas.slice(0, 1),
});
check("large schema is otherwise importable", validateSeoPortabilityBundle(singleLargeSchema).success === true);
let oversizedExportRejected = false;
try {
	createSeoPortabilityBundle(oversizedState);
} catch (cause) {
	oversizedExportRejected = cause instanceof Error && cause.message.includes(`${SEO_PORTABILITY_MAX_BYTES}-byte import limit`);
}
check("export rejects configuration that the importer cannot accept", oversizedExportRejected);
const selectedContentTypes = state();
selectedContentTypes.indexNow.autoSubmitContentTypes = ["pages"];
const selectedBundle = createSeoPortabilityBundle(selectedContentTypes);
const selectedImport = validateSeoPortabilityBundle(selectedBundle);
check("IndexNow content selection survives export and import",
	selectedImport.success &&
	applySeoPortabilityBundleToState(selectedImport.bundle, current, "merge").indexNow.autoSubmitContentTypes?.[0] === "pages");
const legacyBundle = clone(exported) as SeoPortabilityBundle & { configuration: { indexNow: Record<string, unknown> } };
delete (legacyBundle.configuration.indexNow as Partial<typeof legacyBundle.configuration.indexNow>).autoSubmitContentTypes;
delete (legacyBundle.configuration.settings as Partial<typeof legacyBundle.configuration.settings>).publisherType;
delete (legacyBundle.configuration.settings as Partial<typeof legacyBundle.configuration.settings>).personName;
const legacyImport = validateSeoPortabilityBundle(legacyBundle);
check("older portable bundles retain the all-eligible default",
	legacyImport.success && legacyImport.bundle.configuration.indexNow.autoSubmitContentTypes === null);
check("older portable bundles retain Organization identity",
	legacyImport.success && legacyImport.bundle.configuration.settings.publisherType === "organization");
check("fingerprint is deterministic", seoPortabilityFingerprint(exported) === seoPortabilityFingerprint(clone(exported)));
check(
	"plan fingerprint is deterministic",
	seoPortabilityPlanFingerprint(exported, current, "merge") === seoPortabilityPlanFingerprint(clone(exported), clone(current), "merge"),
);
const changedTarget = clone(current);
changedTarget.customSchemas.push({
	id: "concurrent-schema",
	name: "Concurrent schema",
	scope: "services",
	json: JSON.stringify({ "@context": "https://schema.org", "@type": "Service" }),
	enabled: false,
});
check(
	"plan fingerprint changes with target state",
	seoPortabilityPlanFingerprint(exported, current, "merge") !== seoPortabilityPlanFingerprint(exported, changedTarget, "merge"),
);
check(
	"plan fingerprint changes with import mode",
	seoPortabilityPlanFingerprint(exported, current, "merge") !== seoPortabilityPlanFingerprint(exported, current, "replace"),
);

const leakedSecret = clone(exported) as SeoPortabilityBundle & { configuration: { indexNow: Record<string, unknown> } };
leakedSecret.configuration.indexNow.apiKey = "should-not-travel";
const rejectedSecret = validateSeoPortabilityBundle(leakedSecret);
check("portable IndexNow policy rejects secrets", rejectedSecret.success === false);

const wrongFormat = { ...clone(exported), format: "another-plugin" };
check("foreign bundle formats are rejected", validateSeoPortabilityBundle(wrongFormat).success === false);

const incoming = clone(exported);
incoming.source.siteName = "Imported site";
incoming.source.siteUrl = "https://imported.example";
incoming.configuration.settings.siteName = "Imported site";
incoming.configuration.settings.siteUrl = "https://imported.example";
incoming.configuration.settings.noindex = true;
incoming.configuration.sitemap.excludedPaths = ["/private"];
incoming.configuration.customSchemas = [{
	...incoming.configuration.customSchemas[0],
	name: "Updated local schema",
}, {
		id: "imported-schema",
		name: "Imported schema",
		scope: "posts",
		json: JSON.stringify({ "@context": "https://schema.org", "@type": "Article" }),
		enabled: false,
}];

const mergePreview = previewSeoPortabilityImport(incoming, current, "merge", new Date("2026-07-14T17:31:00.000Z"));
check("merge preview succeeds", mergePreview.success === true);
check(
	"merge preview reports one added schema",
	mergePreview.success && mergePreview.plan.summary.added === 1,
);
check(
	"merge preview reports one updated schema",
	mergePreview.success && mergePreview.plan.sections.find((section) => section.key === "customSchemas")?.updated === 1,
);
check(
	"domain changes are explicit",
	mergePreview.success && mergePreview.plan.warnings.some((warning) => warning.includes("Production URL will change")),
);
check(
	"noindex changes are destructive",
	mergePreview.success && mergePreview.plan.summary.destructive === true,
);
check(
	"noindex warning names the supported-page metadata and separate core sitemap",
	mergePreview.success && mergePreview.plan.warnings.some((warning) =>
		warning.includes("noindex metadata on supported pages") && warning.includes("EmDash sitemap")),
);
check(
	"domain changes disable IndexNow",
	mergePreview.success && mergePreview.plan.summary.indexNowWillBeDisabled === true,
);

const merged = applySeoPortabilityBundleToState(incoming, current, "merge");
check("merge keeps the local IndexNow secret", merged.indexNow.apiKey === current.indexNow.apiKey);
check("merge disables IndexNow after a domain change", merged.indexNow.enabled === false);
check("merge applies imported schema values", merged.customSchemas[0]?.name === "Updated local schema");
check("merge applies sitemap policy", merged.sitemap.excludedPaths[0] === "/private");
check("merge adds imported schemas", merged.customSchemas.some((schema) => schema.id === "imported-schema"));
check("merge does not mutate the current state", current.settings.siteUrl === "https://current.example");

const targetWithLocalCollection = clone(current);
targetWithLocalCollection.templates.portfolio = {
	...targetWithLocalCollection.templates.pages,
	title: "{{title}} | Portfolio",
};
const mergedCollections = applySeoPortabilityBundleToState(incoming, targetWithLocalCollection, "merge");
check("merge preserves target-only collection templates",
	mergedCollections.templates.portfolio?.title === "{{title}} | Portfolio");
const mergedCollectionPlan = previewSeoPortabilityImport(incoming, targetWithLocalCollection, "merge");
check("merge preview counts preserved target templates",
	mergedCollectionPlan.success &&
	mergedCollectionPlan.plan.sections.find((section) => section.key === "templates")?.deleted === 0);
const replacedCollections = applySeoPortabilityBundleToState(incoming, targetWithLocalCollection, "replace");
check("replace removes target-only collection templates",
	!("portfolio" in replacedCollections.templates));
const replacedCollectionPlan = previewSeoPortabilityImport(incoming, targetWithLocalCollection, "replace");
check("replace preview counts and warns about removed collection templates",
	replacedCollectionPlan.success &&
	replacedCollectionPlan.plan.sections.find((section) => section.key === "templates")?.deleted === 1 &&
	replacedCollectionPlan.plan.warnings.some((warning) => warning.includes("content-type template")));
const inheritedTargetPlan = previewSeoPortabilityImport(incoming, targetWithLocalCollection, "replace", undefined, {
	templateCollections: Object.keys(targetWithLocalCollection.templates),
	indexNowContentTypes: ["posts", "pages"],
	savedTemplateCollections: [],
});
check("replace preview does not count templates the target never saved as deletions",
	inheritedTargetPlan.success &&
	inheritedTargetPlan.plan.sections.find((section) => section.key === "templates")?.deleted === 0 &&
	!inheritedTargetPlan.plan.warnings.some((warning) => warning.includes("content-type template")));
const savedTargetPlan = previewSeoPortabilityImport(incoming, targetWithLocalCollection, "replace", undefined, {
	templateCollections: Object.keys(targetWithLocalCollection.templates),
	indexNowContentTypes: ["posts", "pages"],
	savedTemplateCollections: ["portfolio"],
});
check("replace preview counts a saved target-only template as a deletion",
	savedTargetPlan.success &&
	savedTargetPlan.plan.sections.find((section) => section.key === "templates")?.deleted === 1);

const legacyModuleBundle = clone(incoming);
legacyModuleBundle.configuration.modules = {
	...legacyModuleBundle.configuration.modules,
	seoAnalyzer: true,
	redirections: true,
	localSeo: true,
};
const legacyModulePreview = previewSeoPortabilityImport(legacyModuleBundle, current, "merge");
check("bundles with retired default module switches still import",
	legacyModulePreview.success &&
	legacyModulePreview.bundle.configuration.modules.seoAnalyzer === false &&
	legacyModulePreview.bundle.configuration.modules.redirections === false &&
	legacyModulePreview.bundle.configuration.modules.localSeo === false);
check("retired module switches are named in the import preview",
	legacyModulePreview.success &&
	legacyModulePreview.plan.warnings.some((warning) =>
		warning.includes("SEO Analyzer") && warning.includes("import as off")));

const typedIndexNowBundle = clone(incoming);
typedIndexNowBundle.configuration.indexNow.autoSubmitContentTypes = ["pages", "portfolio"];
const targetPreview = previewSeoPortabilityImport(typedIndexNowBundle, current, "merge", undefined, {
	templateCollections: ["posts", "pages"],
	indexNowContentTypes: ["posts", "pages"],
});
check("missing IndexNow content types on the target are named",
	targetPreview.success &&
	targetPreview.plan.warnings.some((warning) =>
		warning.includes("IndexNow") && warning.includes("portfolio") && !warning.includes("pages,")));
check("imported templates without a matching target content type are named",
	targetPreview.success &&
	targetPreview.plan.warnings.some((warning) => warning.startsWith("Templates for services")));
const sitemapTargetBundle = clone(typedIndexNowBundle);
sitemapTargetBundle.configuration.sitemap.contentTypes.portfolio = false;
const sitemapTargetPreview = previewSeoPortabilityImport(sitemapTargetBundle, current, "merge", undefined, {
	templateCollections: ["posts", "pages"],
	indexNowContentTypes: ["posts", "pages"],
});
check("sitemap choices without a matching target content type are named",
	sitemapTargetPreview.success &&
	sitemapTargetPreview.plan.warnings.some((warning) =>
		warning.startsWith("Sitemap choices for") && warning.includes("portfolio") && !warning.includes("staticRoutes")));
check("a known target replaces the generic IndexNow review warning",
	targetPreview.success &&
	!targetPreview.plan.warnings.some((warning) => warning.startsWith("Review the imported IndexNow")));
const undiscoveredTargetPreview = previewSeoPortabilityImport(typedIndexNowBundle, current, "merge", undefined, {
	templateCollections: null,
	indexNowContentTypes: null,
});
check("an undiscoverable target says content types could not be checked",
	undiscoveredTargetPreview.success &&
	undiscoveredTargetPreview.plan.warnings.some((warning) => warning.includes("could not list its content types")));

const mappedSource = state();
mappedSource.schemaContentTypes = { articles: "blogPosting", posts: "none" };
const mappedBundle = createSeoPortabilityBundle(mappedSource);
const mappedImport = validateSeoPortabilityBundle(mappedBundle);
check("content type schema survives export and import",
	mappedImport.success &&
	JSON.stringify(applySeoPortabilityBundleToState(mappedImport.bundle, current, "merge").schemaContentTypes) ===
		JSON.stringify({ articles: "blogPosting", posts: "none" }));
const mappedPreview = previewSeoPortabilityImport(mappedBundle, current, "merge", undefined, {
	templateCollections: ["posts", "pages", "services"],
	indexNowContentTypes: ["posts", "pages"],
});
check("the import preview lists content type schema as a changed section",
	mappedPreview.success &&
	mappedPreview.plan.sections.some((section) => section.key === "schemaContentTypes" && section.changed));
check("content type schema for a missing target content type is named",
	mappedPreview.success &&
	mappedPreview.plan.warnings.some((warning) => warning.startsWith("Content type schema for articles")));
const mappedTarget = clone(current);
mappedTarget.schemaContentTypes = { offerings: "service", posts: "none" };
const preMappingBundle = clone(mappedBundle) as SeoPortabilityBundle;
delete (preMappingBundle.configuration as Partial<SeoPortabilityBundle["configuration"]>).schemaContentTypes;
const preMappingImport = validateSeoPortabilityBundle(preMappingBundle);
check("bundles exported before content type schema keep the target mapping",
	preMappingImport.success &&
	(["merge", "replace"] as const).every((mode) =>
		JSON.stringify(applySeoPortabilityBundleToState(preMappingImport.bundle, mappedTarget, mode).schemaContentTypes) ===
			JSON.stringify(mappedTarget.schemaContentTypes)));
const unmappedImport = validateSeoPortabilityBundle(createSeoPortabilityBundle(state()));
check("merge keeps target-only mappings",
	unmappedImport.success &&
	applySeoPortabilityBundleToState(unmappedImport.bundle, mappedTarget, "merge").schemaContentTypes.offerings === "service");
check("replace returns target mappings to defaults when the source has none",
	unmappedImport.success &&
	Object.keys(applySeoPortabilityBundleToState(unmappedImport.bundle, mappedTarget, "replace").schemaContentTypes).length === 0);
const defaultRoleBundle = clone(mappedBundle);
defaultRoleBundle.configuration.schemaContentTypes = { posts: "blogPosting" };
check("an imported default role clears the target override instead of storing it",
	!("posts" in applySeoPortabilityBundleToState(defaultRoleBundle, mappedTarget, "merge").schemaContentTypes));
const invalidRoleBundle = clone(mappedBundle) as unknown as { configuration: Record<string, unknown> };
invalidRoleBundle.configuration.schemaContentTypes = { articles: "recipe" };
check("unsupported content type schema roles are rejected", validateSeoPortabilityBundle(invalidRoleBundle).success === false);
const crowdedTarget = clone(current);
crowdedTarget.schemaContentTypes = Object.fromEntries(
	Array.from({ length: 60 }, (_, index) => [`local${index}`, "service" as const]),
);
const crowdedBundle = clone(mappedBundle);
crowdedBundle.configuration.schemaContentTypes = Object.fromEntries(
	Array.from({ length: 60 }, (_, index) => [`imported${index}`, "blogPosting" as const]),
);
check("a merge that would exceed the mapping limit is rejected before writes",
	previewSeoPortabilityImport(crowdedBundle, crowdedTarget, "merge").success === false);

const localMediaBundle = clone(incoming);
localMediaBundle.configuration.settings.organizationLogo = "/_emdash/api/media/file/logo.png";
localMediaBundle.configuration.settings.defaultSocialImage = "/_emdash/api/media/file/social.png";
const localMediaPreview = previewSeoPortabilityImport(localMediaBundle, current, "merge");
check(
	"import warns that local logo and social image files are not transferred",
	localMediaPreview.success && localMediaPreview.plan.warnings.some((warning) =>
		warning.includes("organization logo and default social image") &&
		warning.includes("Media files are not included")),
);

const replaceBundle = clone(incoming);
replaceBundle.configuration.customSchemas = [replaceBundle.configuration.customSchemas[1]];
const replacePreview = previewSeoPortabilityImport(replaceBundle, current, "replace");
check("replace preview succeeds", replacePreview.success === true);
check(
	"replace preview reports local deletions",
	replacePreview.success && replacePreview.plan.summary.deleted === 1,
);
check(
	"replace preview warns before deletion",
	replacePreview.success && replacePreview.plan.warnings.some((warning) => warning.includes("will be deleted")),
);
const replaced = applySeoPortabilityBundleToState(replaceBundle, current, "replace");
check("replace removes schemas absent from the bundle", !replaced.customSchemas.some((schema) => schema.id === "local-schema"));

const conflicting = clone(exported);
conflicting.configuration.customSchemas.push({
		id: "duplicate-identity",
		name: "Duplicate identity",
		scope: "global",
		json: JSON.stringify({
			"@context": "https://schema.org",
			"@type": "WebPage",
			"@id": "https://current.example/#local-page",
		}),
		enabled: true,
});
const rejectedConflict = previewSeoPortabilityImport(conflicting, current, "replace");
check("duplicate entity identities are rejected before writes", rejectedConflict.success === false);

const malformedSource = clone(exported);
malformedSource.source.siteUrl = "https://spoofed.example";
check("source identity cannot contradict settings", validateSeoPortabilityBundle(malformedSource).success === false);

const withProfiles = state();
withProfiles.analysisProfiles = { posts: { profile: "article", version: 1 } };
(withProfiles.settings as any).contentScoringResourceNoticeVersion = 1;
(withProfiles.analysisProfiles.posts as any).revision = "server-only-revision";
const profileBundle = createSeoPortabilityBundle(withProfiles);
const profileExport = JSON.stringify(profileBundle);
check("export carries assessment intentions without server acknowledgement or revisions",
	profileBundle.configuration.analysisProfiles?.posts.profile === "article" &&
	!profileExport.includes("contentScoringResourceNoticeVersion") && !profileExport.includes("server-only-revision"));
check("exported assessment profiles validate", validateSeoPortabilityBundle(profileBundle).success);
const profileCurrent = state();
profileCurrent.analysisProfiles = { pages: { profile: "general", version: 1 } };
const profileMerged = applySeoPortabilityBundleToState(profileBundle, profileCurrent, "merge");
const profileReplaced = applySeoPortabilityBundleToState(profileBundle, profileCurrent, "replace");
check("merge preserves other assessment choices",
	profileMerged.analysisProfiles?.pages.profile === "general" && profileMerged.analysisProfiles?.posts.profile === "article");
check("replace follows the explicit assessment map",
	profileReplaced.analysisProfiles?.pages === undefined && profileReplaced.analysisProfiles?.posts.profile === "article");
const oldProfileBundle = clone(profileBundle);
delete oldProfileBundle.configuration.analysisProfiles;
check("legacy bundles preserve current assessment choices",
	applySeoPortabilityBundleToState(oldProfileBundle, profileCurrent, "replace").analysisProfiles?.pages.profile === "general");
const badProfileBundle = clone(profileBundle);
badProfileBundle.configuration.analysisProfiles = { posts: { profile: "article", version: 2 } } as any;
check("unknown assessment versions are refused", !validateSeoPortabilityBundle(badProfileBundle).success);
const manyProfiles = clone(profileBundle);
manyProfiles.configuration.analysisProfiles = Object.fromEntries(Array.from({ length: 101 }, (_, i) =>
	[`type${i}`, { profile: "general", version: 1 }])) as any;
check("assessment imports are bounded to 100 content types", !validateSeoPortabilityBundle(manyProfiles).success);
const profilePreview = previewSeoPortabilityImport(profileBundle, profileCurrent, "merge");
check("import warns that analysis requires fresh local acknowledgement",
	profilePreview.success && profilePreview.plan.warnings.some((warning) => warning.includes("resource-use acknowledgement")));

const archiveState = state();
archiveState.settings.taxonomyArchiveNoindex = ["category", "custom_type"];
const archiveBundle = createSeoPortabilityBundle(archiveState);
check("export retains explicit taxonomy archive policy",
	JSON.stringify(archiveBundle.configuration.settings.taxonomyArchiveNoindex) === JSON.stringify(["category", "custom_type"]));
archiveBundle.configuration.settings.taxonomyArchiveNoindex!.push("tag");
check("exported archive selection does not alias source settings", archiveState.settings.taxonomyArchiveNoindex.length === 2);
archiveBundle.configuration.settings.taxonomyArchiveNoindex = ["category", "custom_type"];
const archiveImport = validateSeoPortabilityBundle(archiveBundle);
check("explicit archive policy survives bundle validation", archiveImport.success &&
	JSON.stringify(archiveImport.bundle.configuration.settings.taxonomyArchiveNoindex) === JSON.stringify(["category", "custom_type"]));
const oldArchiveBundle = clone(archiveBundle);
delete oldArchiveBundle.configuration.settings.taxonomyArchiveNoindex;
const oldArchiveImport = validateSeoPortabilityBundle(oldArchiveBundle);
check("older bundles keep archive policy omitted", oldArchiveImport.success &&
	!Object.hasOwn(oldArchiveImport.bundle.configuration.settings, "taxonomyArchiveNoindex"));
for (const mode of ["merge", "replace"] as const) {
	const keptArchivePolicy = applySeoPortabilityBundleToState(oldArchiveBundle, archiveState, mode);
	check(mode + " of an older bundle keeps target archive choices",
		JSON.stringify(keptArchivePolicy.settings.taxonomyArchiveNoindex) === JSON.stringify(["category", "custom_type"]));
	keptArchivePolicy.settings.taxonomyArchiveNoindex!.push("tag");
	check(mode + " policy copy does not mutate target settings", archiveState.settings.taxonomyArchiveNoindex.length === 2);
	const clearingArchiveBundle = clone(archiveBundle);
	clearingArchiveBundle.configuration.settings.taxonomyArchiveNoindex = [];
	const clearedArchivePolicy = applySeoPortabilityBundleToState(clearingArchiveBundle, archiveState, mode);
	check(mode + " respects an explicit empty archive selection",
		Object.hasOwn(clearedArchivePolicy.settings, "taxonomyArchiveNoindex") && clearedArchivePolicy.settings.taxonomyArchiveNoindex?.length === 0);
	check(mode + " archive policy does not change the site-wide indexing choice", clearedArchivePolicy.settings.noindex === false);
}
const additionalArchiveBundle = clone(archiveBundle);
additionalArchiveBundle.configuration.settings.taxonomyArchiveNoindex = ["category", "custom_type", "tag"];
const additionalArchivePreview = previewSeoPortabilityImport(additionalArchiveBundle, archiveState, "merge");
check("import previews newly restricted archives and keeps assigned posts separate", additionalArchivePreview.success &&
	additionalArchivePreview.plan.summary.destructive && additionalArchivePreview.plan.warnings.some((warning) =>
		warning.startsWith("Noindex will apply to integrated taxonomy archive templates for: tag.") &&
		warning.includes("Assigned posts keep their own indexing settings.")));
const unchangedArchivePreview = previewSeoPortabilityImport(archiveBundle, archiveState, "merge");
check("unchanged archive choices do not add a noindex warning", unchangedArchivePreview.success &&
	!unchangedArchivePreview.plan.warnings.some((warning) => warning.startsWith("Noindex will apply to integrated taxonomy archive templates")));
check("archive selection participates in the reviewed import fingerprint",
	seoPortabilityPlanFingerprint(archiveBundle, archiveState, "merge") !==
	seoPortabilityPlanFingerprint(additionalArchiveBundle, archiveState, "merge"));
for (const taxonomyArchiveNoindex of [null, "category", ["a/b"], Array(101).fill("category")]) {
	const invalidArchiveBundle = clone(archiveBundle);
	(invalidArchiveBundle.configuration.settings as unknown as Record<string, unknown>).taxonomyArchiveNoindex = taxonomyArchiveNoindex;
	check("invalid imported archive policy is refused", !validateSeoPortabilityBundle(invalidArchiveBundle).success);
}

// Content type rules round-trip like archive policy and keep the target's list when omitted.
const typeState = state();
typeState.settings.contentTypeNoindex = ["events", "posts"];
const typeBundle = createSeoPortabilityBundle(typeState);
check("export retains content type rules",
	JSON.stringify(typeBundle.configuration.settings.contentTypeNoindex) === JSON.stringify(["events", "posts"]));
typeBundle.configuration.settings.contentTypeNoindex!.push("pages");
check("exported rules do not alias source settings", typeState.settings.contentTypeNoindex.length === 2);
typeBundle.configuration.settings.contentTypeNoindex = ["events", "posts"];
const typeImport = validateSeoPortabilityBundle(JSON.parse(JSON.stringify(typeBundle)));
check("content type rules survive a JSON round trip and validation", typeImport.success &&
	JSON.stringify(typeImport.bundle.configuration.settings.contentTypeNoindex) === JSON.stringify(["events", "posts"]));
const typeRoundTrip = typeImport.success ? applySeoPortabilityBundleToState(typeImport.bundle, state(), "replace") : null;
check("applying the bundle restores the same rules", JSON.stringify(typeRoundTrip?.settings.contentTypeNoindex) === JSON.stringify(["events", "posts"]));
check("re-exporting the applied state yields the same rules", typeRoundTrip !== null &&
	JSON.stringify(createSeoPortabilityBundle(typeRoundTrip).configuration.settings.contentTypeNoindex) === JSON.stringify(["events", "posts"]));
const oldTypeBundle = clone(typeBundle);
delete oldTypeBundle.configuration.settings.contentTypeNoindex;
const oldTypeImport = validateSeoPortabilityBundle(oldTypeBundle);
check("older bundles keep content type rules omitted", oldTypeImport.success &&
	!Object.hasOwn(oldTypeImport.bundle.configuration.settings, "contentTypeNoindex"));
check("an omitted field exports nothing for state without rules",
	!Object.hasOwn(createSeoPortabilityBundle(state()).configuration.settings, "contentTypeNoindex"));
for (const mode of ["merge", "replace"] as const) {
	const keptTypes = applySeoPortabilityBundleToState(oldTypeBundle, typeState, mode);
	check(mode + " of an older bundle keeps the target's rules", JSON.stringify(keptTypes.settings.contentTypeNoindex) === JSON.stringify(["events", "posts"]));
	const clearing = clone(typeBundle);
	clearing.configuration.settings.contentTypeNoindex = [];
	const cleared = applySeoPortabilityBundleToState(clearing, typeState, mode);
	check(mode + " respects an explicit empty rule list", cleared.settings.contentTypeNoindex?.length === 0 && cleared.settings.noindex === false);
}
const widerTypes = clone(typeBundle);
widerTypes.configuration.settings.contentTypeNoindex = ["events", "pages", "posts"];
const widerPreview = previewSeoPortabilityImport(widerTypes, typeState, "merge", new Date(), {
	templateCollections: ["pages", "posts"], indexNowContentTypes: ["pages", "posts"],
} as any);
check("newly restricted content types are a destructive, warned change", widerPreview.success && widerPreview.plan.summary.destructive &&
	widerPreview.plan.warnings.some((warning) => warning.startsWith("Noindex will apply to every entry of these content types") && warning.includes("pages")));
check("rules for content types the target lacks are named", widerPreview.success &&
	widerPreview.plan.warnings.some((warning) => warning.startsWith("Content type noindex rules for events have no matching content type on this site.")));
const sameTypes = previewSeoPortabilityImport(typeBundle, typeState, "merge");
check("unchanged rules add no noindex warning", sameTypes.success &&
	!sameTypes.plan.warnings.some((warning) => warning.startsWith("Noindex will apply to every entry")));
check("rules participate in the reviewed import fingerprint",
	seoPortabilityPlanFingerprint(typeBundle, typeState, "merge") !== seoPortabilityPlanFingerprint(widerTypes, typeState, "merge"));
for (const contentTypeNoindex of [null, "posts", ["Posts"], ["a/b"], Array(101).fill("posts")]) {
	const invalid = clone(typeBundle);
	(invalid.configuration.settings as unknown as Record<string, unknown>).contentTypeNoindex = contentTypeNoindex;
	check("invalid imported content type rules are refused", !validateSeoPortabilityBundle(invalid).success);
}

// The write plan must hold exactly the changes the preview reports.
const storedState = state();
storedState.settings.contentScoringEnabled = false;
storedState.settings.taxonomyArchiveNoindex = ["category", "tag"];
storedState.templates = {
	...defaultSeoAdminTemplateSet(),
	pages: { ...defaultSeoAdminTemplateSet().pages, title: "{{title}} | Stored pages" },
};
storedState.analysisProfiles = { posts: { profile: "article", version: 1 } };
const storedRecords: SeoPortabilityStoredRecords = seoPortabilityStoredRecords(
	{
		version: 1, updatedAt: "2026-10-18T11:00:00.000Z", ...storedState.settings,
		indexingPreferenceConfirmed: true, contentScoringResourceNoticeVersion: 1,
	},
	{ version: 1, updatedAt: "2026-10-18T11:00:00.000Z", values: { pages: storedState.templates.pages } },
);
check("stored records name the stored templates, the indexing confirmation and the stored acknowledgement",
	JSON.stringify(storedRecords) === JSON.stringify({
		templateCollections: ["pages"],
		settingsMarkers: { indexingPreferenceConfirmed: true },
		resourceNoticeAcknowledged: true,
	}));
check("stored records keep no malformed indexing marker and report a malformed acknowledgement as stored",
	JSON.stringify(seoPortabilityStoredRecords({ indexingPreferenceConfirmed: "yes", contentScoringResourceNoticeVersion: "1" }, null)) ===
		JSON.stringify({ templateCollections: [], settingsMarkers: {}, resourceNoticeAcknowledged: true }));
check("absent stored records have no markers, no acknowledgement and no stored templates",
	JSON.stringify(seoPortabilityStoredRecords(null, null)) ===
		JSON.stringify({ templateCollections: [], settingsMarkers: {}, resourceNoticeAcknowledged: false }));
const unacknowledgedRecords = { ...storedRecords, resourceNoticeAcknowledged: false };
const storedTarget: SeoPortabilityTargetContext = {
	templateCollections: ["pages", "posts"],
	indexNowContentTypes: ["pages", "posts"],
	savedTemplateCollections: ["pages"],
};
function plannedWrites(
	label: string,
	bundle: SeoPortabilityBundle,
	target: SeoPortabilityState,
	mode: SeoPortabilityMode,
	stored: SeoPortabilityStoredRecords = storedRecords,
	context: SeoPortabilityTargetContext = storedTarget,
) {
	const preview = previewSeoPortabilityImport(bundle, target, mode, undefined, context);
	const writes = planSeoPortabilityWrites(bundle, target, mode, stored, context);
	check(`${label}: written sections are the sections the preview reports as changed`, preview.success &&
		JSON.stringify(writes.sections) === JSON.stringify(preview.plan.sections.filter((section) => section.changed).map((section) => section.key)));
	return writes;
}
const sameStateImport = validateSeoPortabilityBundle(JSON.parse(JSON.stringify(createSeoPortabilityBundle(storedState))));
check("an export of the stored state validates after a JSON round trip", sameStateImport.success);
const sameStateBundle = sameStateImport.success ? sameStateImport.bundle : createSeoPortabilityBundle(storedState);
for (const mode of ["merge", "replace"] as const) {
	const writes = plannedWrites(`${mode} of the same state`, sameStateBundle, storedState, mode);
	check(`${mode} of an export of the same state writes no section and no schema`,
		writes.sections.length === 0 && writes.customSchemas.put.length === 0 && writes.customSchemas.remove.length === 0);
	check(`${mode} of the same state stores only the templates that were stored`,
		JSON.stringify(writes.templates) === JSON.stringify({ pages: storedState.templates.pages }));
	check(`${mode} of the same state keeps the indexing confirmation and withdraws the stored acknowledgement alone`,
		JSON.stringify(writes.settingsMarkers) === JSON.stringify({ indexingPreferenceConfirmed: true }) &&
		writes.withdrawAcknowledgement === true);
	const unacknowledged = plannedWrites(`${mode} of the same state without an acknowledgement`, sameStateBundle, storedState, mode, unacknowledgedRecords);
	check(`${mode} of the same state without a stored acknowledgement plans no write at all`,
		unacknowledged.sections.length === 0 && unacknowledged.withdrawAcknowledgement === false &&
		unacknowledged.customSchemas.put.length === 0 && unacknowledged.customSchemas.remove.length === 0);
}
const editedTarget = clone(storedState);
editedTarget.settings.taxonomyArchiveNoindex = ["tag"];
const restoreRuleWrites = plannedWrites("restoring one rule", sameStateBundle, editedTarget, "merge");
check("restoring one settings rule writes only the settings record",
	JSON.stringify(restoreRuleWrites.sections) === JSON.stringify(["settings"]) &&
	JSON.stringify(restoreRuleWrites.state.settings.taxonomyArchiveNoindex) === JSON.stringify(["category", "tag"]));
check("a settings write keeps only the indexing confirmation and needs no separate withdrawal",
	JSON.stringify(restoreRuleWrites.settingsMarkers) === JSON.stringify({ indexingPreferenceConfirmed: true }) &&
	restoreRuleWrites.withdrawAcknowledgement === false);
check("a settings write leaves an equal inherited template inherited",
	JSON.stringify(Object.keys(restoreRuleWrites.templates)) === JSON.stringify(["pages"]));
const resumingBundle = clone(sameStateBundle);
resumingBundle.configuration.settings.contentScoringEnabled = true;
const resumingWrites = plannedWrites("turning analysis on", resumingBundle, storedState, "merge");
check("turning analysis on writes the settings with only the indexing confirmation",
	JSON.stringify(resumingWrites.sections) === JSON.stringify(["settings"]) &&
	JSON.stringify(resumingWrites.settingsMarkers) === JSON.stringify({ indexingPreferenceConfirmed: true }));
const enabledTarget = clone(storedState);
enabledTarget.settings.contentScoringEnabled = true;
const pausingWrites = plannedWrites("pausing analysis", sameStateBundle, enabledTarget, "merge");
check("pausing analysis writes the settings with only the indexing confirmation",
	JSON.stringify(pausingWrites.settingsMarkers) === JSON.stringify({ indexingPreferenceConfirmed: true }) &&
	pausingWrites.state.settings.contentScoringEnabled === false);
const storedTemplateBundle = clone(sameStateBundle);
storedTemplateBundle.configuration.templates.pages.title = "{{title}} | Imported pages";
const storedTemplateWrites = plannedWrites("changing a stored template", storedTemplateBundle, storedState, "merge");
check("changing a stored template rewrites it and keeps the inherited one inherited",
	JSON.stringify(storedTemplateWrites.sections) === JSON.stringify(["templates"]) &&
	JSON.stringify(Object.keys(storedTemplateWrites.templates)) === JSON.stringify(["pages"]) &&
	storedTemplateWrites.templates.pages.title === "{{title}} | Imported pages");
check("a templates-only import withdraws a stored acknowledgement without writing the settings",
	storedTemplateWrites.withdrawAcknowledgement === true);
const inheritedTemplateBundle = clone(sameStateBundle);
inheritedTemplateBundle.configuration.templates.posts.title = "{{title}} | Imported posts";
const inheritedTemplateWrites = plannedWrites("changing an inherited template", inheritedTemplateBundle, storedState, "merge");
check("changing an inherited template stores it",
	JSON.stringify(Object.keys(inheritedTemplateWrites.templates).sort()) === JSON.stringify(["pages", "posts"]) &&
	inheritedTemplateWrites.templates.posts.title === "{{title}} | Imported posts");
const portfolioTarget = clone(storedState);
portfolioTarget.templates.portfolio = { ...portfolioTarget.templates.pages, title: "{{title}} | Portfolio" };
const portfolioStored = { ...storedRecords, templateCollections: ["pages", "portfolio"] };
const keptPortfolioWrites = plannedWrites("replace keeping an equal stored template", sameStateBundle, portfolioTarget, "replace", portfolioStored);
check("replace keeps a stored template equal to its inherited value when the preview reports no change",
	keptPortfolioWrites.sections.length === 0 &&
	JSON.stringify(Object.keys(keptPortfolioWrites.templates)) === JSON.stringify(["pages", "portfolio"]));
const droppedPortfolioWrites = plannedWrites("replace dropping a saved template", sameStateBundle, portfolioTarget, "replace", portfolioStored,
	{ ...storedTarget, savedTemplateCollections: ["pages", "portfolio"] });
check("replace drops a saved template the bundle omits",
	JSON.stringify(droppedPortfolioWrites.sections) === JSON.stringify(["templates"]) &&
	JSON.stringify(Object.keys(droppedPortfolioWrites.templates)) === JSON.stringify(["pages"]));
const schemaBundle = clone(sameStateBundle);
schemaBundle.configuration.customSchemas = [{
	id: "imported-schema",
	name: "Imported schema",
	scope: "posts",
	json: JSON.stringify({ "@context": "https://schema.org", "@type": "Article" }),
	enabled: false,
}];
const mergedSchemaWrites = plannedWrites("merging a new schema", schemaBundle, storedState, "merge");
check("merge writes only the new schema and removes none",
	JSON.stringify(mergedSchemaWrites.customSchemas) === JSON.stringify({ put: ["imported-schema"], remove: [] }));
const replacedSchemaWrites = plannedWrites("replacing the schemas", schemaBundle, storedState, "replace");
check("replace writes the new schema and removes the omitted local one",
	JSON.stringify(replacedSchemaWrites.customSchemas) === JSON.stringify({ put: ["imported-schema"], remove: ["local-schema"] }));
const editedSchemaBundle = clone(sameStateBundle);
editedSchemaBundle.configuration.customSchemas[0].name = "Edited local schema";
check("an edited schema is the only schema written",
	JSON.stringify(plannedWrites("editing a schema", editedSchemaBundle, storedState, "merge").customSchemas) ===
		JSON.stringify({ put: ["local-schema"], remove: [] }));

if (failures) {
	console.error(`\n${failures} SEO portability self-check(s) failed.`);
	process.exitCode = 1;
} else {
	console.log("\nAll SEO portability self-checks passed.");
}
