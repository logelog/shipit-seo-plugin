export const CORE_SEO_MIGRATION_VERSION = 1 as const;

export type CoreSeoMigrationConflictPolicy = "skip" | "prefer-core" | "prefer-legacy";
export type CoreSeoMigrationStatus = "ready" | "conflict" | "empty";
export type CoreSeoField = "title" | "description" | "image" | "canonical" | "noIndex";
export type CoreSeoFieldAction =
	| "ignore"
	| "copy"
	| "same"
	| "conflict"
	| "keep-core"
	| "overwrite-core";

export interface CoreSeoSnapshot {
	title: string | null;
	description: string | null;
	image: string | null;
	canonical: string | null;
	noIndex: boolean;
}

export interface LegacySeoOverrideSnapshot {
	ref: string;
	title?: string;
	description?: string;
	canonical?: string;
	robots?: string;
	ogImage?: string;
	updatedAt?: string;
}

export interface CoreSeoFieldPlan {
	field: CoreSeoField;
	action: CoreSeoFieldAction;
	legacy: string | boolean | null;
	current: string | boolean | null;
	target: string | boolean | null;
	conflict: boolean;
}

export interface CoreSeoMigrationPlan {
	migrationVersion: typeof CORE_SEO_MIGRATION_VERSION;
	ref: string;
	conflictPolicy: CoreSeoMigrationConflictPolicy;
	status: CoreSeoMigrationStatus;
	before: CoreSeoSnapshot;
	target: CoreSeoSnapshot;
	fields: CoreSeoFieldPlan[];
	conflicts: CoreSeoField[];
	mappedFields: CoreSeoField[];
	/**
	 * Legacy robots directives core SEO cannot hold. Migrating would drop them,
	 * so the plan is a conflict under every policy while any remain. Absent in
	 * journal records written before this field existed.
	 */
	unmappedRobots?: string[];
}

export function planLegacyOverrideMigration(input: {
	ref: string;
	override: LegacySeoOverrideSnapshot;
	currentSeo?: Partial<CoreSeoSnapshot> | null;
	conflictPolicy?: CoreSeoMigrationConflictPolicy;
}): CoreSeoMigrationPlan {
	const conflictPolicy = input.conflictPolicy ?? "skip";
	const before = normaliseCoreSeo(input.currentSeo);
	const legacy = normaliseLegacyOverride(input.override);

	const fields: CoreSeoFieldPlan[] = [
		planStringField("title", legacy.title, before.title, conflictPolicy),
		planStringField("description", legacy.description, before.description, conflictPolicy),
		planStringField("image", legacy.ogImage, before.image, conflictPolicy),
		planStringField("canonical", legacy.canonical, before.canonical, conflictPolicy),
		planNoIndexField(robotsToNoIndex(legacy.robots), before.noIndex, conflictPolicy),
	];

	const target: CoreSeoSnapshot = { ...before };
	for (const field of fields) {
		if (field.action === "ignore" || field.action === "conflict" || field.action === "keep-core") continue;
		assignTarget(target, field.field, field.target);
	}

	const mappedFields = fields.filter((field) => field.action !== "ignore").map((field) => field.field);
	const conflicts = fields.filter((field) => field.conflict).map((field) => field.field);
	const unmappedRobots = unmappedRobotsDirectives(legacy.robots, target.noIndex);
	const status: CoreSeoMigrationStatus = unmappedRobots.length
		? "conflict"
		: mappedFields.length === 0
			? "empty"
			: conflictPolicy === "skip" && conflicts.length > 0
				? "conflict"
				: "ready";

	return {
		migrationVersion: CORE_SEO_MIGRATION_VERSION,
		ref: input.ref,
		conflictPolicy,
		status,
		before,
		target,
		fields,
		conflicts,
		mappedFields,
		unmappedRobots,
	};
}

export function normaliseCoreSeo(value?: Partial<CoreSeoSnapshot> | null): CoreSeoSnapshot {
	return {
		title: cleanNullable(value?.title),
		description: cleanNullable(value?.description),
		image: cleanNullable(value?.image),
		canonical: cleanNullable(value?.canonical),
		noIndex: value?.noIndex === true,
	};
}

export function coreSeoEquals(a: Partial<CoreSeoSnapshot> | null | undefined, b: Partial<CoreSeoSnapshot> | null | undefined): boolean {
	const left = normaliseCoreSeo(a);
	const right = normaliseCoreSeo(b);
	return (
		left.title === right.title &&
		left.description === right.description &&
		left.image === right.image &&
		left.canonical === right.canonical &&
		left.noIndex === right.noIndex
	);
}

function normaliseLegacyOverride(value: LegacySeoOverrideSnapshot): LegacySeoOverrideSnapshot {
	return {
		ref: value.ref.trim(),
		...(clean(value.title) ? { title: clean(value.title) } : {}),
		...(clean(value.description) ? { description: clean(value.description) } : {}),
		...(clean(value.canonical) ? { canonical: clean(value.canonical) } : {}),
		...(clean(value.robots) ? { robots: clean(value.robots) } : {}),
		...(clean(value.ogImage) ? { ogImage: clean(value.ogImage) } : {}),
		...(clean(value.updatedAt) ? { updatedAt: clean(value.updatedAt) } : {}),
	};
}

function planStringField(
	field: Exclude<CoreSeoField, "noIndex">,
	legacy: string | undefined,
	current: string | null,
	policy: CoreSeoMigrationConflictPolicy,
): CoreSeoFieldPlan {
	if (legacy === undefined) return fieldPlan(field, "ignore", null, current, current, false);
	if (current === null) return fieldPlan(field, "copy", legacy, current, legacy, false);
	if (current === legacy) return fieldPlan(field, "same", legacy, current, current, false);
	if (policy === "prefer-core") return fieldPlan(field, "keep-core", legacy, current, current, true);
	if (policy === "prefer-legacy") return fieldPlan(field, "overwrite-core", legacy, current, legacy, true);
	return fieldPlan(field, "conflict", legacy, current, current, true);
}

function planNoIndexField(
	legacy: boolean | undefined,
	current: boolean,
	policy: CoreSeoMigrationConflictPolicy,
): CoreSeoFieldPlan {
	if (legacy === undefined) return fieldPlan("noIndex", "ignore", null, current, current, false);
	if (legacy === current) return fieldPlan("noIndex", "same", legacy, current, current, false);

	// Core exposes false both for an absent row and an explicit index choice. A
	// legacy noindex=true therefore has to be treated as a copy from the default;
	// otherwise every historical noindex rule would be blocked as a conflict.
	if (legacy && !current) return fieldPlan("noIndex", "copy", legacy, current, legacy, false);
	if (policy === "prefer-core") return fieldPlan("noIndex", "keep-core", legacy, current, current, true);
	if (policy === "prefer-legacy") return fieldPlan("noIndex", "overwrite-core", legacy, current, legacy, true);
	return fieldPlan("noIndex", "conflict", legacy, current, current, true);
}

function fieldPlan(
	field: CoreSeoField,
	action: CoreSeoFieldAction,
	legacy: string | boolean | null,
	current: string | boolean | null,
	target: string | boolean | null,
	conflict: boolean,
): CoreSeoFieldPlan {
	return { field, action, legacy, current, target, conflict };
}

function assignTarget(target: CoreSeoSnapshot, field: CoreSeoField, value: string | boolean | null): void {
	if (field === "noIndex") {
		target.noIndex = value === true;
		return;
	}
	target[field] = typeof value === "string" ? value : null;
}

function robotsToNoIndex(value: string | undefined): boolean | undefined {
	if (!value) return undefined;
	const tokens = value
		.toLocaleLowerCase("en")
		.split(",")
		.map((token) => token.trim());
	if (tokens.includes("noindex") || tokens.includes("none")) return true;
	if (tokens.includes("index")) return false;
	return undefined;
}

// Directives crawlers act on that core SEO has no field for. Unknown tokens are
// ignored by crawlers, so dropping them changes nothing.
const CRAWLER_ROBOTS_DIRECTIVES = new Set([
	"nofollow",
	"noarchive",
	"nocache",
	"nosnippet",
	"noimageindex",
	"notranslate",
	"indexifembedded",
	"max-snippet",
	"max-image-preview",
	"max-video-preview",
	"unavailable_after",
]);

// Core SEO renders noIndex as "noindex, nofollow", so nofollow is carried only
// when the migrated entry is noindex.
function unmappedRobotsDirectives(value: string | undefined, noIndex: boolean): string[] {
	if (!value) return [];
	return [...new Set(
		value
			.toLocaleLowerCase("en")
			.split(",")
			.map((token) => token.trim())
			.filter((token) => CRAWLER_ROBOTS_DIRECTIVES.has(token.split(":")[0].trim()))
			.filter((token) => !(noIndex && token === "nofollow")),
	)];
}

function clean(value: unknown): string | undefined {
	const cleaned = typeof value === "string" ? value.trim() : "";
	return cleaned || undefined;
}

function cleanNullable(value: unknown): string | null {
	return clean(value) ?? null;
}
