import {
	CORE_SEO_MIGRATION_VERSION,
	coreSeoEquals,
	planLegacyOverrideMigration,
	type CoreSeoSnapshot,
	type LegacySeoOverrideSnapshot,
} from "./migration.ts";

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
	if (ok) {
		console.log(`  PASS  ${name}`);
		return;
	}
	failures += 1;
	console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
}

const emptyCore: CoreSeoSnapshot = {
	title: null,
	description: null,
	image: null,
	canonical: null,
	noIndex: false,
};

const legacy: LegacySeoOverrideSnapshot = {
	ref: "posts:legacy-article",
	title: "Legacy article title",
	description: "Legacy article description",
	ogImage: "https://shipitdigital.nl/og/legacy.png",
	canonical: "https://shipitdigital.nl/blog/legacy-article",
	robots: "noindex,follow",
	updatedAt: "2026-07-14T12:00:00.000Z",
};

const copyPlan = planLegacyOverrideMigration({ ref: legacy.ref, override: legacy, currentSeo: emptyCore });
check("migration contract is versioned", copyPlan.migrationVersion === CORE_SEO_MIGRATION_VERSION);
check("empty core SEO is ready to receive legacy values", copyPlan.status === "ready");
check("all legacy fields map to core SEO", copyPlan.mappedFields.length === 5, `got ${copyPlan.mappedFields.length}`);
check("legacy robots maps to core noIndex", copyPlan.target.noIndex === true);
check("legacy social image maps to core image", copyPlan.target.image === legacy.ogImage);

const conflictPlan = planLegacyOverrideMigration({
	ref: legacy.ref,
	override: legacy,
	currentSeo: { ...emptyCore, title: "New core title" },
});
check("default policy blocks conflicting string values", conflictPlan.status === "conflict");
check("conflicting fields are explicit", conflictPlan.conflicts.includes("title"));
check("blocked plans preserve the core value", conflictPlan.target.title === "New core title");

const preferCore = planLegacyOverrideMigration({
	ref: legacy.ref,
	override: legacy,
	currentSeo: { ...emptyCore, title: "New core title" },
	conflictPolicy: "prefer-core",
});
check("prefer-core resolves the plan without overwriting core", preferCore.status === "ready" && preferCore.target.title === "New core title");
check("prefer-core records the conflict decision", preferCore.fields.find((field) => field.field === "title")?.action === "keep-core");

const preferLegacy = planLegacyOverrideMigration({
	ref: legacy.ref,
	override: legacy,
	currentSeo: { ...emptyCore, title: "New core title" },
	conflictPolicy: "prefer-legacy",
});
check("prefer-legacy explicitly overwrites core", preferLegacy.status === "ready" && preferLegacy.target.title === legacy.title);
check("prefer-legacy records the overwrite", preferLegacy.fields.find((field) => field.field === "title")?.action === "overwrite-core");

const explicitIndex = planLegacyOverrideMigration({
	ref: legacy.ref,
	override: { ref: legacy.ref, robots: "index,follow" },
	currentSeo: { ...emptyCore, noIndex: true },
});
check("legacy index conflicts with an existing core noIndex", explicitIndex.status === "conflict" && explicitIndex.conflicts.includes("noIndex"));

const emptyPlan = planLegacyOverrideMigration({
	ref: legacy.ref,
	override: { ref: legacy.ref, title: "  ", robots: "inherit" },
	currentSeo: emptyCore,
});
check("unmappable legacy records are classified as empty", emptyPlan.status === "empty");

const droppedDirectives = planLegacyOverrideMigration({
	ref: legacy.ref,
	override: { ref: legacy.ref, title: "Legacy title", robots: "noindex,nofollow,noarchive,max-snippet:50" },
	currentSeo: emptyCore,
	conflictPolicy: "prefer-legacy",
});
check(
	"robots directives core SEO cannot hold block the migration under every policy",
	droppedDirectives.status === "conflict" &&
		droppedDirectives.unmappedRobots?.join(",") === "noarchive,max-snippet:50" &&
		droppedDirectives.target.noIndex === true,
);
const indexedNofollow = planLegacyOverrideMigration({
	ref: legacy.ref,
	override: { ref: legacy.ref, title: "Legacy title", robots: "index,nofollow" },
	currentSeo: emptyCore,
});
check(
	"nofollow on an indexed entry is not carried by core SEO",
	indexedNofollow.status === "conflict" && indexedNofollow.unmappedRobots?.join(",") === "nofollow",
);
check(
	"robots none maps to core noIndex and carries its nofollow",
	planLegacyOverrideMigration({
		ref: legacy.ref,
		override: { ref: legacy.ref, robots: "none" },
		currentSeo: emptyCore,
	}).target.noIndex === true,
);
check("fully mapped robots leave nothing behind", copyPlan.unmappedRobots?.length === 0);

const repeated = planLegacyOverrideMigration({ ref: legacy.ref, override: legacy, currentSeo: emptyCore });
check("migration planning is deterministic", JSON.stringify(copyPlan) === JSON.stringify(repeated));
check("normalised null and blank core values compare equally", coreSeoEquals(emptyCore, { ...emptyCore, title: "  " }));

console.log(failures === 0 ? "\nALL SEO MIGRATION CHECKS PASSED" : `\n${failures} SEO MIGRATION CHECK(S) FAILED`);
if (failures > 0) throw new Error(`${failures} SEO migration self-check(s) failed`);
