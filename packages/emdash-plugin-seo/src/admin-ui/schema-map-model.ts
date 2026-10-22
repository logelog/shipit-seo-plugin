import type { SeoAdminSchemaConfiguration, SeoAdminSettings } from "@shipitseo/emdash-plugin-seo/admin-contract";
import type { BusinessIdentityView } from "../business-identity-commands.ts";
import type { PublisherSourceSummary } from "./business-identity-model.ts";

export type SchemaMapState = "eligible" | "off" | "unknown" | "invalid" | "not-applicable";

export interface SchemaMapRow {
	id: string;
	name: string;
	state: SchemaMapState;
	status: string;
	detail: string;
}

export interface SchemaMapInput {
	configuration: SeoAdminSchemaConfiguration;
	outputEnabled: boolean;
	settings: SeoAdminSettings | null;
	publisher: PublisherSourceSummary;
	publisherOutput: BusinessIdentityView["publisherOutput"] | null;
	refreshFailed?: boolean;
}

export interface SchemaMapModel {
	siteName: string;
	gate: SchemaMapRow;
	publisher: SchemaMapRow;
	publisherDraft: boolean;
	builtIns: SchemaMapRow[];
	contentTypes: SchemaMapRow[];
	contentTypesNotice: string | null;
	retainedRoles: number;
	customGroups: Array<{ id: "global" | "collection" | "entry"; label: string; items: SchemaMapRow[] }>;
	customCount: number;
	customTruncated: boolean;
}

const ROLE_LABELS = { none: "No type-specific schema", blogPosting: "BlogPosting", service: "Service", webPage: "WebPage" } as const;

function row(id: string, name: string, state: SchemaMapState, detail: string, status?: string): SchemaMapRow {
	return { id, name, state, status: status ?? ({ eligible: "Can contribute", off: "Off", unknown: "Not confirmed", invalid: "Needs repair", "not-applicable": "Not applicable" } as const)[state], detail };
}

/** Saved configuration only; no content inventory, JSON parsing or emission prediction. */
export function buildSchemaMapModel(input: SchemaMapInput): SchemaMapModel {
	const { configuration, settings, publisher, publisherOutput } = input;
	const gate = !settings
		? row("output", "Schema output", "unknown", "Site settings are not available in this view.")
		: !settings.values
			? row("output", "Schema output", "unknown", "This plugin adds no metadata while site settings cannot be read.", "Settings unreadable")
			: input.refreshFailed
				? row("output", "Schema output", "unknown", "The last configuration read is shown. Reload it before relying on these choices.", "Refresh failed")
				: !input.outputEnabled
					? row("output", "Schema output", "off", "Saved schemas do not contribute while Schema output is off.")
					: row("output", "Schema output", "eligible", "Page data, entry overrides and output conflicts still decide each page.");
	const presetReadable = configuration.presets.record !== "invalid" && configuration.presets.record !== "unavailable";
	const preset = (key: string) => configuration.presets.items.find((item) => item.key === key);
	const eligibleState = (enabled: boolean): SchemaMapState => !enabled ? "off" : gate.state;
	const builtIns = configuration.presets.items.filter((item) => item.key !== "organization").map((item) => row(
		item.key, item.label,
		!presetReadable ? "unknown" : !item.enabled ? "off" : gate.state !== "eligible" ? gate.state : item.applicable === false ? "not-applicable" : "eligible",
		!presetReadable ? "Saved preset choices cannot be read." : item.key === "blogPosting" ? "Content types mapped to Blog posting" : item.key === "service" ? "Content types mapped to Service" : item.scope,
	));

	let publisherName = "Publisher";
	let publisherDetail = "Read the saved publisher in Local SEO.";
	let publisherState: SchemaMapState = "unknown";
	if (publisher.kind === "business") {
		publisherName = publisher.saved.name || publisher.saved.kind;
		publisherDetail = publisher.saved.kind === "LocalBusiness" ? publisher.saved.businessType || "LocalBusiness" : publisher.saved.kind;
	} else if (publisher.kind === "legacy" && settings?.values) {
		const values = settings.values;
		publisherName = (values.publisherType === "person" ? values.personName : values.organizationName) || values.siteName || "Publisher";
		publisherDetail = values.publisherType === "person" ? "Person from website settings" : "Organization from website settings";
	}
	const publisherUnconfirmed = publisher.kind === "loading" || publisher.kind === "unavailable" || publisher.kind === "unknown" ||
		publisher.selection !== "settled" || Boolean(publisher.refreshError) || publisher.reading;
	if (gate.state !== "eligible") publisherState = gate.state;
	else if (publisherUnconfirmed) publisherState = "unknown";
	else if (publisherOutput === "none") {
		publisherState = "off";
		publisherDetail = "Automatic publisher output is off.";
	} else if (publisherOutput === "automatic" && presetReadable && preset("organization")) {
		if (!preset("organization")!.enabled) {
			publisherState = "off";
			publisherDetail = "The Site publisher preset is off.";
		} else if ((publisher.kind === "business" || publisher.kind === "legacy") &&
			publisher.selection === "settled" && !publisher.refreshError && !publisher.reading) publisherState = "eligible";
	}
	const publisherDraft = publisher.kind === "business" && publisher.draft !== null;

	const contentTypes = configuration.contentTypes.items.slice(0, 100).map((item) => {
		const role = ROLE_LABELS[item.role];
		if (configuration.contentTypes.record === "invalid") return row(item.collection, item.label, "invalid", "Saved content-type mapping cannot be read.");
		if (item.role === "none") return row(item.collection, item.label, "not-applicable", role, "No type-specific schema");
		// A WebPage role emits independently of the optional global WebPage switch.
		if (item.role === "webPage") return row(item.collection, item.label, gate.state, role);
		const selected = preset(item.role);
		return row(item.collection, item.label,
			!presetReadable || !selected ? "unknown" : eligibleState(selected.enabled),
			!presetReadable || !selected ? `${role}: preset state cannot be read.` : selected.enabled ? role : `${role}: its preset is off.`);
	});
	const contentTypesNotice = !configuration.contentTypes.discoveryAvailable
		? "Content types could not be discovered. Saved mappings are retained."
		: configuration.contentTypes.discoveredCount > contentTypes.length
			? `Showing ${contentTypes.length} of ${configuration.contentTypes.discoveredCount} discovered content types.`
			: null;
	const customGroups: SchemaMapModel["customGroups"] = [
		{ id: "global", label: "All pages", items: [] },
		{ id: "collection", label: "Content types", items: [] },
		{ id: "entry", label: "Individual entries", items: [] },
	];
	for (const schema of configuration.customSchemas.slice(0, 100)) {
		const kind = schema.scope === "global" ? "global" : schema.scope.includes(":") ? "entry" : "collection";
		const collection = schema.scope.split(":", 1)[0];
		const label = configuration.contentTypes.discoveryAvailable
			? configuration.contentTypes.items.find((item) => item.collection === collection)?.label : null;
		const scope = kind === "global" ? "All pages" : kind === "collection" ? label || schema.scope
			: label ? `${label}: ${schema.scope.slice(collection.length + 1)}` : schema.scope;
		customGroups.find((group) => group.id === kind)!.items.push(row(
			schema.id, schema.name, !schema.valid ? "invalid" : eligibleState(schema.enabled),
			`${scope}${schema.types.length ? ` · ${schema.types.join(", ")}` : ""}`,
		));
	}
	return {
		siteName: settings?.values?.siteName || "Website",
		gate,
		publisher: row("publisher", publisherName, publisherState, publisherDetail),
		publisherDraft,
		builtIns,
		contentTypes,
		contentTypesNotice,
		retainedRoles: configuration.contentTypes.unlisted.length,
		customGroups,
		customCount: customGroups.reduce((count, group) => count + group.items.length, 0),
		customTruncated: configuration.hasMore || configuration.customSchemas.length > 100,
	};
}
