import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as ts from "typescript";
import { ApiResponseError } from "@emdash-cms/admin";
import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ADMIN_SETTINGS_STORAGE_VERSION,
	validateSeoAdminSettings,
	type SeoAdminReadableSettings,
	type SeoAdminSettings,
	type SeoAdminSettingsSaveResult,
	type SeoAdminSettingsValues,
} from "../admin-contract.ts";
import { defaultSettingsValues } from "../settings-state.ts";
import { buildSeoAdminSearch, parseSeoAdminLocation } from "./content-extension-model.ts";
import { createSeoI18n } from "./i18n/messages.ts";
import { indexingSitemapServing, listedIndexingRuleStatus, rebaseIndexingNameLists, siteIndexingStatus } from "./indexing-rules-model.ts";
import * as model from "./workspace-model.ts";

const source = readFileSync(new URL("./admin.tsx", import.meta.url), "utf8");
function declaration(name: string) {
	const parsed = ts.createSourceFile("admin.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const found = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
	assert.equal(found.length, 1, "Exact production declaration: " + name);
	return found[0]!.getText(parsed);
}

type Cell = { value: any; deps?: readonly unknown[]; set?: (value: any) => void };
let owner: HookOwner;
class HookOwner {
	cells: Cell[] = [];
	cursor = 0;
	updates = 0;
	effects: Array<() => unknown> = [];
	render<T>(render: () => T): T {
		const previous = owner;
		owner = this; this.cursor = 0;
		try { return render(); } finally { owner = previous; }
	}
	flush() { for (const effect of this.effects.splice(0)) effect(); }
	/** As in React, the setter keeps its identity across renders and a same-value update is no update. */
	state<T>(initial: T | (() => T)): [T, (value: T | ((current: T) => T)) => void] {
		const index = this.cursor++;
		const cell = this.cells[index] ??= { value: typeof initial === "function" ? (initial as () => T)() : initial };
		cell.set ??= (value: T | ((current: T) => T)) => {
			const next = typeof value === "function" ? (value as (current: T) => T)(cell.value) : value;
			if (!Object.is(next, cell.value)) this.updates += 1;
			cell.value = next;
		};
		return [cell.value, cell.set];
	}
	ref<T>(initial: T) {
		const index = this.cursor++;
		this.cells[index] ??= { value: { current: initial } };
		return this.cells[index]!.value as { current: T };
	}
	effect(effect: () => unknown, deps: readonly unknown[]) {
		const index = this.cursor++;
		const previous = this.cells[index];
		if (!previous?.deps || deps.length !== previous.deps.length || deps.some((value, i) => value !== previous.deps![i])) this.effects.push(effect);
		this.cells[index] = { value: null, deps };
	}
}
const localReact = {
	...React,
	useState: <T,>(initial: T | (() => T)) => owner.state(initial),
	useRef: <T,>(initial: T) => owner.ref(initial),
	useEffect: (effect: () => unknown, deps: readonly unknown[]) => owner.effect(effect, deps),
	useLayoutEffect: (effect: () => unknown, deps: readonly unknown[]) => owner.effect(effect, deps),
	useCallback: <T,>(callback: T) => callback,
};
const Button = () => null;
const IndexingChoiceGroup = () => null;
const IndexingSavedState = () => null;
const IndexingPendingState = () => null;
const Banner = () => null;
const WorkspaceNavigation = () => null;
const SiteIdentitySettings = () => null;
const SearchSocialSettings = () => null;
const TaxonomyIndexingContainer = () => null;
const ContentTypeIndexingContainer = () => null;
const ViewSkeleton = () => null;
const ViewErrorState = () => null;
const inert = () => null;
const Dialog = Object.assign(() => null, { Root: () => null, Trigger: () => null, Title: () => null, Description: () => null });
const barSource = readFileSync(new URL("./settings-action-bar.tsx", import.meta.url), "utf8");
const barParsed = ts.createSourceFile("settings-action-bar.tsx", barSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const barDeclaration = barParsed.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === "SettingsActionBar");
assert.equal(barDeclaration.length, 1, "Exact production declaration: SettingsActionBar");
const barCompiled = ts.transpileModule(barDeclaration[0]!.getText(barParsed) + "\nexport { SettingsActionBar };", { fileName: "action-bar-probe.tsx",
	compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
const barOutput = { exports: {} as Record<string, any> };
new Function("require", "module", "exports", "Button", "Loader", "ArrowCounterClockwise", "FloppyDisk", barCompiled.outputText)(
	(name: string) => { assert.equal(name, "react/jsx-runtime"); return jsx; }, barOutput, barOutput.exports, Button, inert, inert, inert);
const SettingsActionBar = barOutput.exports.SettingsActionBar as (props: Record<string, unknown>) => React.ReactElement;
type Element = React.ReactElement<Record<string, any>>;
function elements(tree: React.ReactNode): Element[] {
	if (Array.isArray(tree)) return tree.flatMap(elements);
	if (!React.isValidElement(tree)) return [];
	const node = tree as Element;
	return [node, ...elements(node.props.children)];
}
function text(tree: React.ReactNode): string {
	if (typeof tree === "string" || typeof tree === "number") return String(tree);
	if (Array.isArray(tree)) return tree.map(text).join("");
	return React.isValidElement(tree) ? text((tree as Element).props.children) : "";
}
function one(tree: React.ReactNode, predicate: (node: Element) => boolean) {
	const found = elements(tree).filter(predicate);
	assert.equal(found.length, 1);
	return found[0]!;
}
const clone = <T,>(value: T): T => structuredClone(value);
const values = (): SeoAdminSettingsValues => ({
	...defaultSettingsValues({ siteName: "Example practice", siteUrl: "https://fixture.example" }),
	customVerificationTags: [{ name: "example-verification", content: "retained" }],
});
function readable(patch: Partial<SeoAdminSettingsValues> = {}, revision = "settings-1"): SeoAdminReadableSettings {
	return {
		contractVersion: SEO_ADMIN_CONTRACT_VERSION,
		storageVersion: SEO_ADMIN_SETTINGS_STORAGE_VERSION,
		engineVersion: "fixture",
		hostSiteUrl: "https://fixture.example",
		state: "saved",
		revision,
		legacyGuard: null,
		legacyPresent: false,
		indexingPreferenceConfirmed: true,
		updatedAt: "2026-10-16T10:00:00.000Z",
		contentScoring: { state: "enabled", revision, intentEnabled: true, acknowledgedNoticeVersion: 1, currentNoticeVersion: 1 },
		values: { ...values(), ...patch },
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => { resolve = accept; });
	return { promise, resolve };
}

let active: Fixture;
let locale = "en";
const useSeoI18n = () => createSeoI18n(locale);
const scope = {
	React: localReact, Button, IndexingChoiceGroup, IndexingSavedState, IndexingPendingState, siteIndexingStatus, indexingSitemapServing, rebaseIndexingNameLists,
	useSitemapQuery: (enabled = true) => { active.sitemapModes.push(enabled); return { data: active.sitemap }; }, Banner, TaxonomyIndexingContainer, ContentTypeIndexingContainer, WebsiteSummaryCard: inert, WorkspaceNavigation, IndexingNavigation: () => null, LocalSeoNavigation: () => null, SiteIdentitySettings, SearchSocialSettings,
	ViewSkeleton, ViewErrorState, ...model, useSeoI18n, validateSeoAdminSettings, buildSeoAdminSearch, parseSeoAdminLocation,
	useQueryClient: () => active.client,
	useSettingsQuery: (enabled = true) => active.query(enabled),
	useOverviewQuery: () => ({ data: null }),
	useSeoToasts: () => ({
		error: (...message: unknown[]) => active.toasts.push(["error", ...message]),
		success: (...message: unknown[]) => active.toasts.push(["success", ...message]),
	}),
	saveSeoAdminSettings: (draft: SeoAdminSettingsValues, loaded: SeoAdminReadableSettings) => active.save(draft, loaded),
	resetSeoAdminSettings: () => { active.restoreCalls += 1; throw new Error("Unexpected restore"); },
	refreshBusinessIdentity: () => { active.identityRefreshes += 1; },
	cancelBusinessIdentityProfileFocus: inert, requestBusinessIdentityFocus: inert,
	ContractMismatchScreen: inert, WarningCircle: inert, ShipitLogo: inert, SlidersHorizontal: inert,
	Badge: inert, SeoViewBoundary: inert, OverviewContainer: inert, ContentScoringControls: inert,
	ContentAuditContainer: inert, WorkQueueView: inert, TrendsView: inert, CrawlDiagnosticsView: inert,
	NotFoundView: inert, TemplatesContainer: inert, BusinessIdentitySection: inert, ModulesContainer: inert,
	SitemapContainer: inert, RobotsTxtView: inert, LlmsTxtView: inert, SchemaLibraryView: inert,
	IndexNowView: inert, SiteVerificationView: inert, CustomVerificationView: inert, MigrationContainer: inert,
	PortabilityView: inert, SchemaContainer: inert, PluginOverlapLine: inert, SettingsActionBar,
	Dialog, ArrowCounterClockwise: inert, ApiResponseError,
	WorkspaceDraftProvider: ({ children }: { children?: React.ReactNode }) => children,
	WorkspacePageActiveProvider: ({ children }: { children?: React.ReactNode }) => children,
};
const probed = ["readableDate", "SettingsReloadBanner", "SettingsActions", "IndexingSettings", "SettingsSectionContainer", "SeoAdminWorkspace"]
	.filter((name) => name !== "SettingsReloadBanner" || /\nfunction SettingsReloadBanner\(/.test(source));
const compiled = ts.transpileModule(
	probed.map(declaration).join("\n") + "\nexport { " + probed.join(", ") + " };",
	{ fileName: "indexing-settings-probe.tsx", reportDiagnostics: true,
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } },
);
assert.deepEqual(compiled.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
const output = { exports: {} };
new Function("require", "module", "exports", ...Object.keys(scope), compiled.outputText)(
	(name: string) => { assert.equal(name, "react/jsx-runtime"); return jsx; },
	output, output.exports, ...Object.values(scope),
);
const { SettingsSectionContainer, IndexingSettings, SeoAdminWorkspace, SettingsReloadBanner, SettingsActions } = output.exports as Record<string, any>;

// Only query responses, cache operations and presentational controls are fixtures.
// Form/save/navigation closures above come from the actual production declarations.
class Fixture {
	current: SeoAdminSettings;
	pending = false;
	error: unknown = null;
	nextRead: SeoAdminSettings | null = null;
	readFailure: Error | null = null;
	readGate: Promise<void> | null = null;
	reply: SeoAdminSettingsSaveResult | Promise<SeoAdminSettingsSaveResult> | Error | null = null;
	reads = 0;
	restoreCalls = 0;
	identityRefreshes = 0;
	writes: Array<{ values: SeoAdminSettingsValues; loaded: SeoAdminReadableSettings }> = [];
	cacheWrites: SeoAdminSettings[] = [];
	invalidations: unknown[] = [];
	removals: unknown[] = [];
	toasts: unknown[][] = [];
	queryModes: Array<{ section: string; enabled: boolean }> = [];
	sitemapModes: boolean[] = [];
	sitemap: { owner: string } | undefined = undefined;
	parent = new HookOwner();
	/** `mounts` counts how often React would mount the section's child view: once per change of the rendered component. */
	owners = new Map<string, { container: HookOwner; view: HookOwner; panel: Element | null; mounts: number }>();
	client = {
		setQueryData: (key: unknown, snapshot: SeoAdminSettings) => {
			assert.deepEqual(key, model.seoWorkspaceKeys.settings);
			this.cacheWrites.push(clone(snapshot)); this.current = snapshot;
		},
		invalidateQueries: async (options: unknown) => { this.invalidations.push(options); },
		removeQueries: (options: unknown) => { this.removals.push(options); },
	};
	constructor(snapshot: SeoAdminSettings = readable()) { this.current = snapshot; }
	query(enabled = true) {
		const section = owner === this.parent ? "workspace"
			: [...this.owners].find(([, instance]) => instance.container === owner)?.[0];
		assert.ok(section, "Query belongs to an actual mounted controller or workspace");
		this.queryModes.push({ section, enabled });
		return { data: this.current, isPending: this.pending, isError: this.error !== null, error: this.error,
			refetch: async () => {
				this.reads += 1;
				if (this.readGate) await this.readGate;
				// A failed refetch keeps the earlier snapshot as data, as the query cache does.
				if (this.readFailure) { this.error = this.readFailure; return { data: this.current, isError: true, error: this.readFailure }; }
				this.error = null;
				if (this.nextRead) this.current = this.nextRead;
				return { data: this.current, isError: false };
			} };
	}
	async save(draft: SeoAdminSettingsValues, loaded: SeoAdminReadableSettings) {
		this.writes.push({ values: clone(draft), loaded: clone(loaded) });
		assert.notEqual(this.reply, null, "Every simulated backend result is explicit");
		if (this.reply instanceof Error) throw this.reply;
		return this.reply;
	}
	parentTree(): Element {
		active = this;
		const tree = this.parent.render(() => SeoAdminWorkspace()) as Element;
		this.parent.flush();
		const updates = this.parent.updates;
		const entries = elements(tree).filter((node) => node.type === SettingsSectionContainer);
		const mounted = new Set(entries.map((node) => node.props.section as string));
		assert.equal(mounted.size, entries.length, "Each settings section has one mounted owner");
		for (const section of this.owners.keys()) if (!mounted.has(section)) this.owners.delete(section);
		for (const entry of entries) {
			let instance = this.owners.get(entry.props.section);
			if (!instance) {
				instance = { container: new HookOwner(), view: new HookOwner(), panel: null, mounts: 0 };
				this.owners.set(entry.props.section, instance);
			}
			const before = instance.panel?.type ?? null;
			instance.panel = instance.container.render(() => SettingsSectionContainer(entry.props)) as Element | null;
			instance.container.flush();
			if ((instance.panel?.type ?? null) !== before) {
				instance.view = new HookOwner();
				if (instance.panel) instance.mounts += 1;
			}
		}
		// React renders again before painting when a section's layout effect updates the workspace state.
		return this.parent.updates === updates ? tree : this.parentTree();
	}
	panel(view: "site" | "social" | "indexing" = "indexing", language = locale): Element {
		locale = language;
		let tree = this.parentTree();
		const nav = one(tree, (node) => node.type === WorkspaceNavigation);
		if (nav.props.value !== view) { nav.props.onChange(view); tree = this.parentTree(); }
		const section = view === "site" ? "identity" : view;
		one(tree, (node) => node.type === SettingsSectionContainer && node.props.section === section);
		const panel = this.owners.get(section)!.panel;
		assert.ok(React.isValidElement(panel), "Active settings controller renders its child UI");
		return panel as Element;
	}
	indexing(language = locale) {
		const panel = this.panel("indexing", language);
		assert.equal(panel.type, IndexingSettings);
		const instance = this.owners.get("indexing")!;
		const tree = instance.view.render(() => IndexingSettings(panel.props)) as Element;
		instance.view.flush();
		assert.equal(tree.type, "form");
		const bar = one(tree, (node) => node.type === SettingsActionBar);
		assert.equal(bar.props.restore, undefined, "Indexing rules has no restore action, so the bar's restore slot stays empty");
		const barTree = SettingsActionBar(bar.props) as Element;
		const buttons = elements(barTree).filter((node) => node.type === Button);
		assert.equal(buttons.length, 2, "Indexing has only discard and save actions");
		assert.deepEqual(buttons.map((node) => node.props.variant), ["secondary", "primary"], "Discard, then the primary Save at the right");
		assert.equal(buttons[1]!.props.type, "submit");
		assert.equal(buttons.some((node) => node.props.onClick === panel.props.onRestore), false, "No whole-settings restore action in Indexing");
		assert.equal(elements(tree).filter((node) => node.type === Button).length, 0, "The form has no second action row");
		return { panel, tree, all: [tree, barTree], siteChoice: one(tree, (node) => node.type === IndexingChoiceGroup), buttons };
	}
}

let cases = 0;
async function check(run: () => unknown) { await run(); cases += 1; }

// Indexing rules stays mounted, hidden and with passive reads, while another page is open.
await check(async () => {
	locale = "en";
	for (const away of ["sitemap", "social"] as const) {
		const fixture = new Fixture(readable({ contentTypeNoindex: [] }));
		const types = () => one(fixture.indexing("en").tree, (node) => node.type === ContentTypeIndexingContainer);
		types().props.onChange(["posts"]);
		const instance = fixture.owners.get("indexing")!;
		assert.equal(instance.mounts, 1, "control: the form mounted once");
		const leave = () => {
			one(fixture.parentTree(), (node) => node.type === WorkspaceNavigation).props.onChange(away);
			return fixture.parentTree();
		};
		leave();
		fixture.indexing("en");
		assert.equal(fixture.owners.get("indexing")!.mounts, 1, away + ": returning shows the same form, never remounted");
		const tree = leave();
		const pane = one(tree, (node) => node.props.className === "shipit-seo-settings-pane" && node.props["data-settings-view"] === "indexing");
		assert.equal(pane.props.hidden, true, away + ": control: Indexing rules is hidden");
		const hidden = fixture.owners.get("indexing")!.panel!;
		assert.equal(hidden.type, IndexingSettings, away + ": the hidden section keeps rendering its form");
		assert.equal(hidden.props.active, false);
		const hiddenForm = instance.view.render(() => IndexingSettings(hidden.props)) as Element;
		assert.deepEqual([ContentTypeIndexingContainer, TaxonomyIndexingContainer].map((type) => one(hiddenForm, (node) => node.type === type).props.active), [false, false],
			away + ": hidden rule lists read nothing");
		assert.equal(fixture.sitemapModes.at(-1), false, away + ": the hidden sitemap read is passive");
		assert.equal(fixture.queryModes.filter((mode) => mode.section === "indexing").at(-1)!.enabled, false, away + ": the hidden settings read is passive");
		const back = fixture.indexing("en");
		assert.equal(back.panel.props.active, true);
		assert.deepEqual([fixture.sitemapModes.at(-1), one(back.tree, (node) => node.type === ContentTypeIndexingContainer).props.active], [true, true]);
		assert.deepEqual(types().props.selected, ["posts"], away + ": the draft is kept");
		assert.equal(fixture.owners.get("indexing")!.mounts, 1);
		assert.deepEqual([fixture.writes.length, fixture.reads, fixture.toasts.length], [0, 0, 0], away + ": moving away saved, read and announced nothing");
		if (away !== "social") continue;
		leave();
		fixture.panel("social").props.onChange("twitterHandle", "@sibling");
		fixture.reply = { success: true, settings: readable({ contentTypeNoindex: [], twitterHandle: "@sibling" }, "settings-2") };
		await fixture.panel("social").props.onSave();
		assert.equal(fixture.writes.length, 1, "control: Search & social saved while Indexing rules was hidden");
		const kept = fixture.indexing("en");
		assert.equal(fixture.owners.get("indexing")!.mounts, 1, "control: the same form, still not remounted");
		assert.deepEqual([kept.panel.props.source.revision, kept.panel.props.saved.twitterHandle, kept.panel.props.draft.twitterHandle], ["settings-2", "@sibling", "@sibling"],
			"The kept form shows the settings saved on Search & social");
		assert.deepEqual([types().props.selected, types().props.saved], [["posts"], []], "and keeps its own draft beside them");
		fixture.reply = { success: true, settings: readable({ contentTypeNoindex: ["posts"], twitterHandle: "@sibling" }, "settings-3") };
		await fixture.indexing("en").panel.props.onSave();
		assert.deepEqual([fixture.writes[1]!.loaded.revision, fixture.writes[1]!.values.twitterHandle, fixture.writes[1]!.values.contentTypeNoindex], ["settings-2", "@sibling", ["posts"]],
			"Its next save starts from that save and keeps it");
	}
});

await check(async () => {
	const fixture = new Fixture();
	fixture.indexing("en").siteChoice.props.onChange("noindex");
	const instance = fixture.owners.get("indexing");
	const pending = deferred<SeoAdminSettingsSaveResult>();
	fixture.reply = pending.promise;
	const saving = fixture.indexing().panel.props.onSave();
	try {
		assert.equal(fixture.indexing().siteChoice.props.disabled, true);
		fixture.panel("social").props.onChange("twitterHandle", "@sibling");
		assert.equal(fixture.owners.get("indexing")!.panel!.props.active, false, "The hidden pending section keeps its form, told it is hidden");
		assert.equal(fixture.queryModes.filter((mode) => mode.section === "indexing").at(-1)!.enabled, false, "Hidden controller's query is passive");
		assert.equal(fixture.queryModes.filter((mode) => mode.section === "social").at(-1)!.enabled, true);
		const back = fixture.indexing();
		assert.ok(fixture.owners.get("indexing") === instance, "Pending Indexing owner survives navigation through Social");
		assert.equal(fixture.owners.get("social")!.panel, null, "Leaving Social unmounts its media-picker subtree");
		assert.equal(back.siteChoice.props.disabled, true, "Returning to a pending save cannot enable the site-wide choice");
		assert.equal(back.buttons.every((node) => node.props["aria-disabled"] === true), true, "Save and Discard read as disabled while the save runs");
		back.tree.props.onSubmit({ preventDefault() {} });
		assert.equal(fixture.writes.length, 1, "Returning to a pending save cannot submit a second write");
		assert.equal(back.panel.props.draft.noindex, true);
		assert.equal((fixture.current as SeoAdminReadableSettings).values.noindex, false);
		assert.equal(fixture.panel("site").type, SiteIdentitySettings);
		fixture.indexing();
		assert.equal(fixture.owners.get("identity")!.panel, null, "Leaving General unmounts its restore-dialog subtree");
		assert.equal(fixture.queryModes.filter((mode) => mode.section === "identity").at(-1)!.enabled, false);
	} finally {
		pending.resolve({ success: true, settings: readable({ noindex: true }, "saved-2") });
		await saving;
	}
	const saved = fixture.indexing();
	assert.ok(fixture.owners.get("indexing") === instance);
	assert.equal(saved.siteChoice.props.disabled, false);
	assert.equal(saved.panel.props.dirty, false, "Only the completed request clears its owner's overrides");
	assert.equal(saved.panel.props.draft.noindex, true);
	assert.equal(fixture.panel("social").props.draft.twitterHandle, "@sibling", "Completing Indexing never clears the sibling draft");
	assert.equal(fixture.writes.length, 1);
});

await check(async () => {
	locale = "en";
	const fixture = new Fixture();
	fixture.indexing().siteChoice.props.onChange("noindex");
	fixture.panel("social").props.onChange("twitterHandle", "@unsaved");
	fixture.panel("site").props.onChange("siteName", "Unsaved website");
	assert.equal(fixture.indexing().panel.props.draft.noindex, true);
	fixture.indexing().buttons[0]!.props.onClick();
	assert.equal(fixture.indexing().panel.props.dirty, false);
	assert.equal(fixture.panel("social").props.draft.twitterHandle, "@unsaved");
	assert.equal(fixture.panel("site").props.draft.siteName, "Unsaved website");
	fixture.indexing().siteChoice.props.onChange("noindex");
	const remote = readable({ organizationName: "Updated elsewhere", defaultSocialImage: "https://fixture.example/latest.jpg" }, "remote-2");
	fixture.current = remote;
	const pending = deferred<SeoAdminSettingsSaveResult>();
	fixture.reply = pending.promise;
	const saving = fixture.indexing().panel.props.onSave();
	assert.equal(fixture.writes.length, 1);
	assert.deepEqual(fixture.writes[0]!.values, { ...remote.values, noindex: true });
	assert.equal(fixture.writes[0]!.loaded.revision, "remote-2");
	const busy = fixture.indexing();
	assert.equal(busy.siteChoice.props.disabled, true);
	assert.equal(busy.buttons.every((node) => node.props["aria-disabled"] === true), true);
	assert.equal(text(one(busy.all, (node) => node.props.role === "status")), createSeoI18n("en").t("indexing.status.saving"));
	const indexed = readable({ ...remote.values, noindex: true }, "settings-3");
	pending.resolve({ success: true, settings: indexed });
	await saving;
	assert.equal(fixture.indexing().panel.props.dirty, false);
	assert.equal(fixture.panel("social").props.draft.twitterHandle, "@unsaved", "Saving Indexing preserves Social's draft");
	assert.equal(fixture.panel("site").props.draft.siteName, "Unsaved website", "Saving Indexing preserves General's draft");
	fixture.reply = { success: true, settings: readable({ ...indexed.values, twitterHandle: "@unsaved" }, "settings-4") };
	await fixture.panel("social").props.onSave();
	assert.deepEqual(fixture.writes[1]!.values, { ...indexed.values, twitterHandle: "@unsaved" });
	assert.equal(fixture.panel("site").props.draft.siteName, "Unsaved website");
	const social = fixture.current as SeoAdminReadableSettings;
	fixture.reply = { success: true, settings: readable({ ...social.values, siteName: "Unsaved website" }, "settings-5") };
	await fixture.panel("site").props.onSave();
	assert.deepEqual(fixture.writes[2]!.values, { ...social.values, siteName: "Unsaved website" });
	assert.equal(fixture.indexing().panel.props.draft.noindex, true);
	assert.equal(fixture.cacheWrites.length, 3);
	assert.deepEqual(fixture.invalidations.filter((item) => JSON.stringify(item) === JSON.stringify({ queryKey: model.seoWorkspaceKeys.sitemap })).length, 1,
		"Only the Indexing save refreshes the sitemap configuration that content type rules change");
	assert.equal(fixture.invalidations.length, 4);
	assert.equal(fixture.removals.length, 3);
	assert.equal(fixture.identityRefreshes, 3);
	assert.equal(fixture.reads, 0);
	assert.equal(fixture.restoreCalls, 0);
});

await check(async () => {
	locale = "en";
	const fixture = new Fixture();
	fixture.indexing().siteChoice.props.onChange("noindex");
	const fresh = readable({ twitterHandle: "@remote" }, "remote-2");
	fixture.nextRead = fresh;
	fixture.reply = { success: false, conflict: true, errors: { _form: "Settings changed elsewhere." } };
	await fixture.indexing().panel.props.onSave();
	const conflict = fixture.indexing();
	assert.equal(fixture.reads, 1);
	assert.equal(fixture.cacheWrites.length, 0);
	assert.equal(conflict.panel.props.draft.noindex, true);
	assert.equal(conflict.panel.props.draft.twitterHandle, "@remote");
	assert.equal(conflict.panel.props.errors._form, "Settings changed elsewhere.");
	assert.equal(conflict.panel.props.saving, false);
	assert.notEqual(conflict.panel.props.savedMessage, createSeoI18n("en").t("indexing.status.saved"));
	fixture.reply = { success: true, settings: readable({ ...fresh.values, noindex: true }, "settings-3") };
	await conflict.panel.props.onSave();
	assert.equal(fixture.writes[1]!.loaded.revision, "remote-2");
	assert.deepEqual(fixture.writes[1]!.values, { ...fresh.values, noindex: true });
	assert.equal(fixture.indexing().panel.props.dirty, false);
});

// After a conflict each rule list keeps only this draft's own changes, applied to the list the other editor saved.
await check(async () => {
	locale = "en";
	const fixture = new Fixture(readable({ contentTypeNoindex: [], taxonomyArchiveNoindex: ["genre"] }));
	const lists = () => {
		const tree = fixture.indexing("en").tree;
		return [ContentTypeIndexingContainer, TaxonomyIndexingContainer].map((type) => one(tree, (node) => node.type === type).props);
	};
	const pending = (own: "type" | "archive", props: Record<string, any>, names: string[]) =>
		names.filter((name) => listedIndexingRuleStatus(own, props as never, name).after !== null);
	lists()[0]!.onChange(["posts"]);
	lists()[1]!.onChange([]);
	assert.deepEqual(pending("type", lists()[0]!, ["pages", "posts"]), ["posts"], "control: this editor changed Posts");
	fixture.nextRead = readable({ contentTypeNoindex: ["pages"], taxonomyArchiveNoindex: ["genre", "region"], twitterHandle: "@remote" }, "remote-2");
	fixture.reply = { success: false, conflict: true, errors: { _form: "Settings changed elsewhere." } };
	await fixture.indexing().panel.props.onSave();
	assert.equal(fixture.reads, 1, "control: the conflict read the stored settings again");
	const [types, archives] = lists();
	assert.deepEqual([types!.selected, types!.saved], [["pages", "posts"], ["pages"]], "The kept draft holds the other editor's Pages rule plus Posts");
	assert.deepEqual(pending("type", types!, ["pages", "posts"]), ["posts"], "Only Posts reads After saving");
	assert.deepEqual([archives!.selected, archives!.saved], [["region"], ["genre", "region"]], "The removed genre rule stays removed and region is kept");
	assert.deepEqual(pending("archive", archives!, ["genre", "region"]), ["genre"]);
	assert.equal(fixture.indexing().panel.props.draft.twitterHandle, "@remote", "Fields this draft never changed show the stored value");
	assert.deepEqual(one(fixture.parentTree(), (node) => node.type === SettingsSectionContainer && node.props.section === "indexing").props.overrides,
		{ contentTypeNoindex: ["pages", "posts"], taxonomyArchiveNoindex: ["region"] }, "Only the rebased lists remain as the draft");
	fixture.reply = { success: true, settings: readable({ contentTypeNoindex: ["pages", "posts"], taxonomyArchiveNoindex: ["region"], twitterHandle: "@remote" }, "settings-3") };
	await fixture.indexing().panel.props.onSave();
	assert.deepEqual([fixture.writes[1]!.values.contentTypeNoindex, fixture.writes[1]!.values.taxonomyArchiveNoindex], [["pages", "posts"], ["region"]],
		"The next save keeps the other editor's rules");
	assert.equal(fixture.writes[1]!.loaded.revision, "remote-2");

	const same = new Fixture(readable({ contentTypeNoindex: [] }));
	one(same.indexing("en").tree, (node) => node.type === ContentTypeIndexingContainer).props.onChange(["posts"]);
	same.nextRead = readable({ contentTypeNoindex: ["posts"] }, "remote-2");
	same.reply = { success: false, conflict: true, errors: { _form: "Settings changed elsewhere." } };
	await same.indexing().panel.props.onSave();
	assert.equal(same.indexing().panel.props.dirty, false, "A list the other editor saved the same way is no longer a draft");
	const overrides = (target: Fixture) => one(target.parentTree(), (node) => node.type === SettingsSectionContainer && node.props.section === "indexing").props.overrides;
	assert.deepEqual(overrides(same), {});
	assert.deepEqual(overrides(fixture), {}, "control: a saved draft leaves no overrides");
});

// A newer stored list read without a conflict, as on return after the staleTime, moves the kept list draft
// onto it too, so a later conflict counts only this draft's own edits.
await check(async () => {
	locale = "en";
	for (const [later, expected] of [[["events", "pages"], ["events", "pages", "posts"]], [["events"], ["events", "posts"]]] as const) {
		const name = later.join(" and ") + " saved later: ";
		const fixture = new Fixture(readable({ contentTypeNoindex: [] }));
		const types = () => one(fixture.indexing("en").tree, (node) => node.type === ContentTypeIndexingContainer).props;
		const pending = (props: Record<string, any>, names: string[]) => names.filter((entry) => listedIndexingRuleStatus("type", props as never, entry).after !== null);
		types().onChange(["posts"]);
		one(fixture.parentTree(), (node) => node.type === WorkspaceNavigation).props.onChange("sitemap");
		fixture.parentTree();
		fixture.current = readable({ contentTypeNoindex: ["pages"] }, "remote-2");
		const back = types();
		assert.deepEqual(back.saved, ["pages"], name + "control: the page read the Pages rule another editor saved");
		assert.deepEqual(back.selected, ["pages", "posts"], name + "The kept draft holds the newer Pages rule beside its own Posts");
		assert.deepEqual(pending(back, ["pages", "posts"]), ["posts"], name + "Pages, which this editor never changed, reads no After saving");
		fixture.nextRead = readable({ contentTypeNoindex: [...later] }, "remote-3");
		fixture.reply = { success: false, conflict: true, errors: { _form: "Settings changed elsewhere." } };
		await fixture.indexing().panel.props.onSave();
		assert.deepEqual([fixture.writes[0]!.values.contentTypeNoindex, fixture.writes[0]!.loaded.revision], [["pages", "posts"], "remote-2"],
			name + "A save sent after that read keeps the Pages rule");
		const rebased = types();
		assert.deepEqual([rebased.selected, rebased.saved], [expected, later], name + "After the conflict the list holds the later save plus Posts");
		assert.deepEqual(pending(rebased, ["events", "pages", "posts"]), ["posts"], name + "Only Posts reads After saving after the conflict");
		fixture.reply = { success: true, settings: readable({ contentTypeNoindex: [...expected] }, "settings-4") };
		await fixture.indexing().panel.props.onSave();
		assert.deepEqual([fixture.writes[1]!.values.contentTypeNoindex, fixture.writes[1]!.loaded.revision], [expected, "remote-3"],
			name + "The next save undoes no other editor's change");
		assert.equal(fixture.indexing().panel.props.dirty, false);
	}
});

await check(async () => {
	for (const state of ["absent", "historical-seed"] as const) {
		const initial = readable({ noindex: state === "historical-seed" });
		initial.state = state; initial.updatedAt = null; initial.indexingPreferenceConfirmed = false;
		if (state === "absent") { initial.revision = null; initial.legacyGuard = "legacy-v1:" + "a".repeat(64); }
		const fixture = new Fixture(initial);
		const form = fixture.indexing("en");
		assert.equal(form.siteChoice.props.value, state === "historical-seed" ? "noindex" : "index");
		assert.equal(form.panel.props.dirty, false);
		assert.equal(fixture.writes.length, 0, "Reading defaults never records an indexing preference");
		form.siteChoice.props.onChange(initial.values.noindex ? "index" : "noindex");
		const expected = { ...initial.values, noindex: !initial.values.noindex };
		fixture.reply = { success: true, settings: readable(expected, "confirmed-2") };
		await fixture.indexing().panel.props.onSave();
		assert.deepEqual(fixture.writes[0]!.values, expected);
		assert.equal(fixture.writes[0]!.loaded.revision, initial.revision);
		assert.equal(fixture.writes[0]!.loaded.legacyGuard, initial.legacyGuard);
		assert.equal(fixture.restoreCalls, 0);
	}
});

await check(async () => {
	for (const state of ["corrupt", "unavailable"] as const) {
		const initial: SeoAdminSettings = { ...readable(), state, values: null, updatedAt: null,
			revision: state === "corrupt" ? "broken-1" : null, legacyGuard: null, legacyPresent: false,
			indexingPreferenceConfirmed: false, contentScoring: { state: "unavailable", reason: "unreadable" } };
		const fixture = new Fixture(initial);
		const refusal = fixture.panel("indexing", "tr");
		assert.equal(refusal.type, Banner);
		assert.equal(refusal.props.title, createSeoI18n("tr").t("indexing.unreadableTitle"));
		assert.equal(elements(refusal).some((node) => node.type === "form"), false);
		assert.equal(refusal.props.action.type, Button);
		refusal.props.action.props.onClick();
		assert.equal(fixture.reads, 1);
		assert.equal(fixture.writes.length, 0);
		assert.equal(fixture.restoreCalls, 0);
		assert.equal(fixture.cacheWrites.length, 0);
	}
});

await check(async () => {
	const fixture = new Fixture();
	const initial = fixture.indexing("en");
	initial.siteChoice.props.onChange("noindex");
	const english = fixture.indexing("en");
	const turkish = fixture.indexing("tr");
	assert.equal(turkish.siteChoice.props.value, "noindex");
	assert.equal(turkish.siteChoice.props.legend, createSeoI18n("tr").t("indexing.site.legend"));
	assert.equal(text(turkish.buttons[1]), createSeoI18n("tr").t("indexing.save"));
	assert.equal(text(one(turkish.all, (node) => node.props.role === "status")), createSeoI18n("tr").t("indexing.status.unsaved"));
	assert.deepEqual(turkish.panel.props.draft, english.panel.props.draft);
	assert.equal(fixture.writes.length, 0);
	assert.equal(fixture.reads, 0);
	fixture.reply = { success: true, settings: readable({ noindex: true }, "saved-2") };
	await turkish.panel.props.onSave();
	for (const language of ["tr", "nl-BE", "en"]) {
		const saved = fixture.indexing(language);
		assert.equal(text(one(saved.all, (node) => node.props.role === "status")), createSeoI18n(language).t("indexing.status.saved"), "Saved notice is translated at render time");
		assert.equal(saved.panel.props.dirty, false);
		assert.equal(saved.siteChoice.props.value, "noindex");
	}
	assert.equal(fixture.writes.length, 1);
	assert.equal(fixture.reads, 0);
});

await check(async () => {
	const fixture = new Fixture();
	const initial = fixture.indexing("nl");
	let prevented = 0;
	initial.tree.props.onSubmit({ preventDefault: () => prevented += 1 });
	assert.equal(prevented, 1);
	assert.equal(fixture.writes.length, 0, "An unchanged form cannot submit");
	const expectedDate = new Intl.DateTimeFormat("nl", { dateStyle: "medium" }).format(new Date("2026-10-16T10:00:00.000Z"));
	assert.equal(text(one(initial.all, (node) => node.props.role === "status")), createSeoI18n("nl").t("indexing.status.savedAt", { date: expectedDate }));
	initial.siteChoice.props.onChange("noindex");
	fixture.reply = new Error("Response unavailable.");
	await fixture.indexing().panel.props.onSave();
	const failed = fixture.indexing();
	assert.equal(failed.panel.props.draft.noindex, true);
	assert.equal(failed.panel.props.errors._form, undefined, "A thrown save is not reported as a refused one");
	assert.equal(text(one(failed.all, (node) => node.props.role === "status")), createSeoI18n("nl").t("indexing.status.unconfirmed"));
	assert.equal(failed.panel.props.savedMessage, null);
	assert.equal(fixture.cacheWrites.length, 0);
	assert.equal(fixture.restoreCalls, 0);
});

await check(async () => {
	const fixture = new Fixture(readable({ taxonomyArchiveNoindex: ["retired"] }));
	const archives = () => one(fixture.indexing("en").tree, (node) => node.type === TaxonomyIndexingContainer);
	assert.deepEqual(archives().props.selected, ["retired"]);
	archives().props.onChange(["region", "retired"]);
	fixture.panel("social").props.onChange("twitterHandle", "@separateDraft");
	assert.deepEqual(archives().props.selected, ["region", "retired"], "Archive draft survives navigation");
	const pending = deferred<SeoAdminSettingsSaveResult>(); fixture.reply = pending.promise;
	const saving = fixture.indexing().panel.props.onSave();
	assert.equal(archives().props.disabled, true);
	assert.deepEqual(fixture.writes[0]!.values.taxonomyArchiveNoindex, ["region", "retired"]);
	assert.equal(fixture.writes[0]!.values.twitterHandle, values().twitterHandle, "Archive save does not commit Social's draft");
	fixture.panel("site"); assert.equal(fixture.owners.get("indexing")!.panel!.props.active, false);
	pending.resolve({ success: false, errors: { taxonomyArchiveNoindex: "Definition unavailable" } });
	await saving;
	assert.deepEqual(archives().props.selected, ["region", "retired"]);
	assert.equal(archives().props.validationError, "Definition unavailable");
	assert.equal(archives().props.disabled, false);
	fixture.reply = { success: true, settings: readable({ taxonomyArchiveNoindex: ["region", "retired"] }, "saved-archives") };
	await fixture.indexing().panel.props.onSave();
	assert.equal(fixture.indexing().panel.props.dirty, false);
	assert.equal(fixture.panel("social").props.draft.twitterHandle, "@separateDraft");
	archives().props.onChange([]);
	assert.deepEqual(fixture.indexing().panel.props.draft.taxonomyArchiveNoindex, []);
	fixture.indexing().buttons[0]!.props.onClick();
	assert.deepEqual(archives().props.selected, ["region", "retired"], "Discard restores the saved archive policy");
});

await check(async () => {
	const fixture = new Fixture(readable({ contentTypeNoindex: ["retired"] }));
	const types = () => one(fixture.indexing("en").tree, (node) => node.type === ContentTypeIndexingContainer);
	const order = elements(fixture.indexing("en").tree).filter((node) => node.type === ContentTypeIndexingContainer || node.type === TaxonomyIndexingContainer)
		.map((node) => node.type);
	assert.deepEqual(order, [ContentTypeIndexingContainer, TaxonomyIndexingContainer], "Content type rules come before taxonomy archives");
	assert.deepEqual(types().props.selected, ["retired"]);
	assert.equal(types().props.siteNoindex, false);
	types().props.onChange(["posts", "retired"]);
	fixture.panel("social").props.onChange("twitterHandle", "@separateDraft");
	assert.deepEqual(types().props.selected, ["posts", "retired"], "The content type draft survives navigation");
	const pending = deferred<SeoAdminSettingsSaveResult>(); fixture.reply = pending.promise;
	const saving = fixture.indexing().panel.props.onSave();
	assert.equal(types().props.disabled, true);
	assert.deepEqual(fixture.writes[0]!.values.contentTypeNoindex, ["posts", "retired"]);
	assert.equal(fixture.writes[0]!.values.twitterHandle, values().twitterHandle, "A rule save does not commit Social's draft");
	pending.resolve({ success: false, errors: { contentTypeNoindex: "Choose available content types." } });
	await saving;
	assert.deepEqual(types().props.selected, ["posts", "retired"]);
	assert.equal(types().props.validationError, "Choose available content types.");
	fixture.reply = { success: true, settings: readable({ contentTypeNoindex: ["posts", "retired"] }, "saved-types") };
	await fixture.indexing().panel.props.onSave();
	assert.equal(fixture.indexing().panel.props.dirty, false);
	types().props.onChange(["posts"]);
	assert.deepEqual(fixture.indexing().panel.props.draft.contentTypeNoindex, ["posts"], "A removed type's rule can be removed");
	fixture.indexing().buttons[0]!.props.onClick();
	assert.deepEqual(types().props.selected, ["posts", "retired"], "Discard restores the saved rules");
	const precedence = one(fixture.indexing("en").tree, (node) => node.props.className === "shipit-seo-indexing-help");
	const en = createSeoI18n("en");
	assert.equal(precedence.type, "details");
	assert.equal(precedence.props.open, undefined, "the help is closed by default");
	assert.equal(text(one(precedence, (node) => node.type === "summary")), en.t("indexing.help.summary"));
	for (const key of ["indexing.precedence.site", "indexing.precedence.type", "indexing.precedence.entry", "indexing.precedence.optIn"] as const) {
		assert.ok(text(precedence).includes(en.t(key)), "Precedence names " + key);
	}
	assert.ok(text(precedence).indexOf(en.t("indexing.precedence.siteLabel")) < text(precedence).indexOf(en.t("indexing.precedence.typeLabel")) &&
		text(precedence).indexOf(en.t("indexing.precedence.typeLabel")) < text(precedence).indexOf(en.t("indexing.precedence.entryLabel")),
		"Site-wide, then content type, then entry");
	types().props.onOpenSitemaps();
	assert.equal(one(fixture.parentTree(), (node) => node.type === WorkspaceNavigation).props.value, "sitemap", "Edit in Sitemaps opens Sitemaps");
});

await check(async () => {
	const fixture = new Fixture(readable());
	const types = one(fixture.indexing("en").tree, (node) => node.type === ContentTypeIndexingContainer);
	assert.deepEqual(types.props.selected, [], "Records without rules read as no rule");
	assert.equal(Object.hasOwn(fixture.indexing().panel.props.draft, "contentTypeNoindex"), false, "Loading never adds the field");
	fixture.indexing().siteChoice.props.onChange("noindex");
	fixture.reply = { success: true, settings: readable({ noindex: true }, "saved-2") };
	await fixture.indexing().panel.props.onSave();
	assert.equal(Object.hasOwn(fixture.writes[0]!.values, "contentTypeNoindex"), false, "A save that never touched the rules omits them, so the server keeps what is stored");
	assert.equal(one(fixture.indexing().tree, (node) => node.type === ContentTypeIndexingContainer).props.siteNoindex, true);
});

// Pending choices read only as after-saving lines, and site-wide noindex never rewrites the rules below it.
await check(async () => {
	const en = createSeoI18n("en");
	locale = "en";
	const fixture = new Fixture(readable({ contentTypeNoindex: ["posts"], taxonomyArchiveNoindex: ["genre"] }));
	const view = () => fixture.indexing("en");
	const heading = one(view().tree, (node) => node.props.className === "shipit-seo-section-heading");
	assert.equal(elements(heading).some((node) => node.type === "p"), false, "no description paragraph under the heading");
	const site = () => one(view().tree, (node) => node.props.className === "shipit-seo-indexing-site");
	const saved = () => one(site(), (node) => node.type === IndexingSavedState).props;
	const pending = () => one(site(), (node) => node.type === IndexingPendingState).props;
	const effect = () => text(one(site(), (node) => node.props.className === "shipit-seo-indexing-site__effect"));
	const notes = () => elements(view().tree).filter((node) => node.props.className === "shipit-seo-indexing-override");
	const lists = () => [ContentTypeIndexingContainer, TaxonomyIndexingContainer].map((type) => {
		const props = one(view().tree, (node) => node.type === type).props;
		return [props.selected, props.saved, props.siteNoindex, props.savedSiteNoindex];
	});
	assert.deepEqual(saved(), { effect: { choice: "index", source: null }, withSource: false });
	assert.equal(pending().effect, null, "a clean draft has no pending line");
	one(one(site(), (node) => node.props["data-seo-setting"] === "siteNoindex"), (node) => node.type === IndexingChoiceGroup);
	assert.equal(effect(), en.t("indexing.site.indexEffect"));
	assert.equal(notes().length, 0);
	assert.deepEqual(lists(), [[["posts"], ["posts"], false, false], [["genre"], ["genre"], false, false]]);

	view().siteChoice.props.onChange("noindex");
	assert.deepEqual(saved().effect, { choice: "index", source: null }, "the saved state stays the live one");
	assert.deepEqual(pending().effect, { choice: "noindex", source: "site" });
	assert.equal(effect(), en.t("indexing.site.noindexEffect"));
	assert.equal(notes().length, 1);
	assert.equal(notes()[0]!.props.role, "note");
	assert.equal(text(notes()[0]), en.t("indexing.site.overrideNote"));
	assert.deepEqual(lists(), [[["posts"], ["posts"], true, false], [["genre"], ["genre"], true, false]], "site-wide noindex keeps each stored rule");
	view().siteChoice.props.onChange("index");
	assert.equal(view().panel.props.dirty, false, "turning site-wide noindex on and off again leaves nothing to save");
	assert.deepEqual(lists(), [[["posts"], ["posts"], false, false], [["genre"], ["genre"], false, false]]);
	one(view().tree, (node) => node.type === ContentTypeIndexingContainer).props.onChange(["pages", "posts"]);
	one(view().tree, (node) => node.type === TaxonomyIndexingContainer).props.onChange([]);
	assert.deepEqual(lists(), [[["pages", "posts"], ["posts"], false, false], [[], ["genre"], false, false]],
		"the rows get the draft as selected and the stored rules as saved");
	view().buttons[0]!.props.onClick();
	view().siteChoice.props.onChange("noindex");
	fixture.reply = { success: true, settings: readable({ noindex: true, contentTypeNoindex: ["posts"], taxonomyArchiveNoindex: ["genre"] }, "saved-2") };
	await view().panel.props.onSave();
	assert.deepEqual([fixture.writes[0]!.values.contentTypeNoindex, fixture.writes[0]!.values.taxonomyArchiveNoindex], [["posts"], ["genre"]],
		"saving site-wide noindex keeps the stored rules");
	assert.deepEqual(saved().effect, { choice: "noindex", source: "site" });
	assert.equal(pending().effect, null);

	const help = () => one(view().tree, (node) => node.type === "details");
	const helpWith = (owner?: string) => { fixture.sitemap = owner ? { owner } : undefined; return text(help()); };
	assert.equal([en.t("indexing.help.sitemapServed"), en.t("indexing.help.sitemapNotServed")].some((line) => helpWith().includes(line)), false,
		"no sitemap ownership is claimed before the sitemap read");
	assert.ok(helpWith("shipit").includes(en.t("indexing.help.sitemapServed")));
	assert.ok(helpWith("site-route").includes(en.t("indexing.help.sitemapNotServed")));
	for (const key of ["indexing.help.sitemap", "indexing.help.archives", "indexing.help.robots"] as const) assert.ok(text(help()).includes(en.t(key)), key);
	assert.equal(fixture.writes.length, 1);
	const css = readFileSync(new URL("./indexing-settings.css", import.meta.url), "utf8");
	for (const selector of [".shipit-seo-indexing-site__effect", ".shipit-seo-indexing-site .shipit-seo-indexing-pending"]) {
		assert.match(css.match(new RegExp("\\n" + selector.replaceAll(".", "\\.") + " \\{([^}]*)\\}"))?.[1] ?? "", /color: var\(--text-color-kumo-default,/,
			selector + ": text on the tinted Site-wide block keeps 4.5:1 contrast");
	}
	const rule = (selector: string) => css.match(new RegExp("\\n" + selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{([^}]*)\\}"))?.[1] ?? "";
	assert.match(rule('.shipit-seo-indexing-site [role="radio"]:focus-visible'),
		/^\s*box-shadow: 0 0 0 2px var\(--color-kumo-tint, #f3f4f6\), 0 0 0 4px var\(--text-color-kumo-link, #1769c2\);\s*$/,
		"Site-wide radios draw their focus ring in the link colour, at least 3:1 on the tinted block in both themes, set off from the checked fill by a gap");
	assert.match(rule(".shipit-seo-indexing-site"), /background: var\(--color-kumo-tint, #f3f4f6\);/, "control: the gap has the block's own background");
	assert.match(rule(".shipit-seo-indexing-settings > .shipit-seo-section-heading h2:focus-visible"), /^\s*border-radius: 4px;\s*outline: 2px solid var\(--border-color-kumo-focus, #2b7bbb\);\s*outline-offset: 2px;\s*$/,
		"The Indexing rules heading shows focus as the Content types heading does");
	assert.match(readFileSync(new URL("./taxonomy-indexing-controls.css", import.meta.url), "utf8"),
		/\n\.shipit-seo-taxonomy-indexing__head h3:focus-visible \{\s*border-radius: 4px;\s*outline: 2px solid var\(--border-color-kumo-focus, #2b7bbb\);\s*outline-offset: 2px;\s*\}/,
		"control: the Content types and archive headings use that outline");
	const pendingText = rule(".shipit-seo-indexing-pending > svg + span");
	assert.match(pendingText, /min-inline-size: 0;/);
	assert.match(pendingText, /max-inline-size: calc\(100% - 14px - 0\.375rem\);/, "the After saving text stays beside its icon, so the tag wraps after it");
	assert.doesNotMatch(pendingText, /flex(?:-grow)?:/, "the text never grows, so a short line keeps its tag right after the text");
	assert.match(rule(".shipit-seo-indexing-state,\n.shipit-seo-indexing-pending,\n.shipit-seo-indexing-kept"), /gap: 0\.25rem 0\.375rem;/,
		"control: the cap subtracts the column gap of the line");
	assert.match(readFileSync(new URL("./indexing-rule-status.tsx", import.meta.url), "utf8"),
		/<p className="shipit-seo-indexing-pending">\s*<PencilSimple size=\{14\} aria-hidden="true" \/>\s*<span>/, "control: the cap subtracts the 14px icon before the text");
});

/** The error a 504 answer raises through the production request helper. */
async function gatewayTimeout(): Promise<Error> {
	const realFetch = globalThis.fetch;
	globalThis.fetch = (async () => new Response("Gateway Timeout", { status: 504 })) as typeof fetch;
	try {
		const { saveSeoAdminSettings } = await import("./api.ts");
		await saveSeoAdminSettings(values(), readable());
	} catch (error) {
		assert.ok(error instanceof Error);
		assert.equal((error as Error & { status?: number }).status, 504);
		return error;
	} finally {
		globalThis.fetch = realFetch;
	}
	throw new Error("A 504 answer resolved as a save result");
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const failures: Array<[string, Error]> = [["TypeError", new TypeError("Failed to fetch")], ["504", await gatewayTimeout()]];

/** The error a refused answer raises through the production request helper. */
async function refusedSave(status: number): Promise<Error> {
	const realFetch = globalThis.fetch;
	globalThis.fetch = (async () => new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "Sign in again to save." } }),
		{ status, headers: { "Content-Type": "application/json" } })) as typeof fetch;
	try {
		const { saveSeoAdminSettings } = await import("./api.ts");
		await saveSeoAdminSettings(values(), readable());
	} catch (error) {
		assert.ok(error instanceof ApiResponseError, "control: the helper raises the host error class");
		return error;
	} finally {
		globalThis.fetch = realFetch;
	}
	throw new Error("A refused answer resolved as a save result");
}

// A 4xx refusal other than a timeout, conflict or rate limit wrote nothing, so it says not saved and asks for no reload.
await check(async () => {
	const en = createSeoI18n("en");
	locale = "en";
	const fixture = new Fixture();
	fixture.indexing().siteChoice.props.onChange("noindex");
	fixture.reply = await refusedSave(403);
	await fixture.indexing().panel.props.onSave();
	const refused = fixture.indexing();
	assert.equal(refused.panel.props.reloadNotice, null, "a definite refusal needs no reload");
	assert.equal(refused.panel.props.draft.noindex, true, "the draft is kept");
	assert.deepEqual(fixture.toasts.map((toast) => toast[1]), [en.t("indexing.status.saveFailed")]);
	assert.equal(refused.siteChoice.props.disabled, false);
	assert.equal(refused.buttons[1]!.props["aria-disabled"], undefined, "Save is available again");
	assert.equal(fixture.writes.length, 1);
});

// A reload read that fails while settings are loaded keeps the page, its draft and its lock, and
// says so beside the reload notice; only a later successful read unlocks saving.
await check(async () => {
	const actions = (props: Record<string, unknown>) => new HookOwner().render(() => SettingsActions({ ...props, saveLabel: "Save" })) as Element;
	const banner = (panel: Element) => SettingsReloadBanner({ notice: panel.props.reloadNotice, onReload: panel.props.onReload }) as Element;
	const scenarios = [
		["indexing", "noindex", true, IndexingSettings, "en"], ["indexing", "noindex", true, IndexingSettings, "nl"],
		["indexing", "noindex", true, IndexingSettings, "tr"], ["site", "siteName", "Unconfirmed website", SiteIdentitySettings, "en"],
		["social", "twitterHandle", "@unconfirmed", SearchSocialSettings, "en"],
	] as const;
	for (const [view, field, value, View, language] of scenarios) {
		locale = language;
		const name = view + " (" + language + "): ";
		const failureText = view === "indexing" ? createSeoI18n(language).t("indexing.reloadFailed")
			: "The saved settings could not be read. Your draft is kept and saving stays off; reload the saved settings again.";
		const fixture = new Fixture();
		fixture.panel(view).props.onChange(field, value);
		fixture.reply = new TypeError("Failed to fetch");
		await fixture.panel(view).props.onSave();
		assert.notEqual(fixture.panel(view).props.reloadNotice, null, name + "control: the save outcome is unknown");
		fixture.readFailure = new Error("Settings read failed");
		fixture.panel(view).props.onReload();
		await settle();
		assert.equal(fixture.reads, 1, name + "Reload sends one read");
		assert.ok(fixture.error, name + "control: the query reports the failed read");
		const failed = fixture.panel(view);
		assert.equal(failed.type, View, name + "a failed read with loaded settings keeps the page mounted");
		assert.equal(failed.props.reloadNotice?.failure, failureText, name + "the failed read is reported inline");
		assert.equal(failed.props.reloadNotice.reloading, false);
		assert.equal(failed.props.draft[field], value, name + "the draft is kept");
		assert.equal(failed.props.dirty, true);
		assert.equal(text(one(banner(failed), (node) => node.type === "p" && node.props.role === "alert")), failureText);
		if (view === "indexing") {
			const form = fixture.indexing(language);
			one(form.tree, (node) => node.type === SettingsReloadBanner);
			assert.equal(form.siteChoice.props.disabled, true, name + "the lock stays after a failed read");
			assert.equal(form.buttons.every((node) => node.props["aria-disabled"] === true), true);
			form.tree.props.onSubmit({ preventDefault() {} });
		} else {
			const locked = actions(failed.props);
			assert.deepEqual([locked.props.saveDisabled, locked.props.discardDisabled], [true, true], name + "the lock stays after a failed read");
		}
		await failed.props.onSave();
		assert.equal(fixture.writes.length, 1, name + "no write before a successful read");
		const gate = deferred<void>();
		fixture.readGate = gate.promise;
		fixture.readFailure = null;
		fixture.panel(view).props.onReload();
		const busy = fixture.panel(view);
		assert.equal(busy.props.reloadNotice.reloading, true, name + "the reload shows that its read is running");
		assert.equal(busy.props.reloadNotice.failure, null, name + "the earlier failure clears while the read runs");
		assert.equal(one(banner(busy), (node) => node.type === Banner).props.action.props.loading, true);
		busy.props.onReload();
		assert.equal(fixture.reads, 2, name + "a second press while reading sends no second read");
		gate.resolve();
		await settle();
		const reloaded = fixture.panel(view);
		assert.equal(reloaded.props.reloadNotice, null, name + "a successful read ends the lock");
		assert.equal(reloaded.props.draft[field], value, name + "the draft survives the reload");
		assert.equal(reloaded.props.dirty, true);
		assert.equal(fixture.writes.length, 1);
	}
	locale = "en";
	const empty = new Fixture();
	empty.current = undefined as unknown as SeoAdminSettings;
	empty.error = new Error("First read failed");
	const page = empty.panel("indexing");
	assert.equal(page.type, ViewErrorState, "With nothing loaded, a failed read shows the error page");
	assert.equal(page.props.title, createSeoI18n("en").t("indexing.unavailable"));
	page.props.onRetry();
	assert.equal(empty.reads, 1);
	empty.error = new Error("Read failed again");
	for (const language of ["en", "nl", "tr"]) {
		const t = createSeoI18n(language).t;
		const failed = empty.panel("indexing", language);
		assert.deepEqual([failed.props.title, failed.props.retryLabel], [t("indexing.unavailable"), t("indexing.retry")],
			language + ": the error page names its own Reload action in the admin language");
	}
	assert.notEqual(createSeoI18n("tr").t("indexing.retry"), "Retry", "control: the catalogue translates the action");
	locale = "en";
	const social = new Fixture();
	social.current = undefined as unknown as SeoAdminSettings;
	social.error = new Error("First read failed");
	assert.equal(social.panel("social").props.retryLabel, undefined, "Search & social keeps the default Retry label");
});

// Reload on the error or unreadable page: the form that replaces the page takes focus at its heading.
await check(async () => {
	locale = "en";
	const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
	const body = {};
	const focused: string[] = [];
	const fake = { body, activeElement: body as unknown, getElementById: (id: string) => ({ focus: () => { focused.push(id); } }) };
	Object.defineProperty(globalThis, "document", { configurable: true, value: fake });
	try {
		const unreadable: SeoAdminSettings = { ...readable(), state: "unavailable", values: null, updatedAt: null, revision: null, legacyGuard: null, legacyPresent: false,
			indexingPreferenceConfirmed: false, contentScoring: { state: "unavailable", reason: "unreadable" } };
		for (const start of ["error", "unreadable"] as const) {
			const fixture: Fixture = new Fixture(unreadable);
			if (start === "error") { fixture.current = undefined as unknown as SeoAdminSettings; fixture.error = new Error("First read failed"); }
			const page: Element = fixture.panel("indexing");
			assert.equal(page.type, start === "error" ? ViewErrorState : Banner, start + ": control: the page without a form");
			fixture.nextRead = readable();
			if (start === "error") page.props.onRetry(); else page.props.action.props.onClick();
			assert.deepEqual(focused, [], start + ": control: nothing is focused while the page shows no form");
			const form: ReturnType<Fixture["indexing"]> = fixture.indexing("en");
			assert.deepEqual(focused, ["seo-indexing-title"], start + ": Reload moves focus to the Indexing rules heading once the form replaces the page");
			assert.equal(one(form.tree, (node) => node.type === "h2").props.tabIndex, -1, start + ": the heading takes programmatic focus");
			fixture.indexing("en");
			assert.equal(focused.length, 1, start + ": later renders leave focus alone");
			focused.length = 0;
		}
		const moved = new Fixture();
		moved.current = undefined as unknown as SeoAdminSettings;
		moved.error = new Error("First read failed");
		moved.nextRead = readable();
		moved.panel("indexing").props.onRetry();
		fake.activeElement = { name: "Find a setting" };
		moved.indexing("en");
		assert.deepEqual(focused, [], "Focus the user moved elsewhere while the read ran stays there");
		fake.activeElement = body;
		const first = new Fixture();
		first.pending = true;
		assert.equal(first.panel("indexing").type, ViewSkeleton, "control: the first read is loading");
		first.pending = false;
		first.indexing("en");
		assert.deepEqual(focused, [], "The first read showing the form moves no focus");
	} finally {
		if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument); else Reflect.deleteProperty(globalThis, "document");
	}
});

// A thrown or non-2xx save may have committed: the draft stays, the page says the outcome is
// unknown, and no write is accepted until the stored settings are read again.
await check(async () => {
	const en = createSeoI18n("en");
	const tagged = (tree: Element) => [IndexingPendingState, ContentTypeIndexingContainer, TaxonomyIndexingContainer]
		.map((type) => one(tree, (node) => node.type === type).props.unconfirmed);
	for (const [label, failure] of failures) {
		for (const committed of [true, false]) {
			locale = "en";
			const name = label + (committed ? ", committed: " : ", not committed: ");
			const fixture = new Fixture();
			fixture.indexing().siteChoice.props.onChange("noindex");
			fixture.reply = failure;
			await fixture.indexing().panel.props.onSave();
			const unknown = fixture.indexing();
			assert.equal(unknown.panel.props.draft.noindex, true, name + "the draft is kept");
			assert.deepEqual(fixture.toasts, [["error", en.t("indexing.unconfirmedTitle"), en.t("indexing.unconfirmedHelp")]],
				name + "the toast says the save is not confirmed, not that it failed");
			assert.equal(text(one(unknown.all, (node) => node.props.role === "status")), en.t("indexing.status.unconfirmed"));
			assert.deepEqual(unknown.panel.props.reloadNotice, { title: en.t("indexing.unconfirmedTitle"), description: en.t("indexing.unconfirmedHelp"),
				action: en.t("indexing.reloadSaved"), status: en.t("indexing.status.unconfirmed"), reloading: false, failure: null });
			assert.equal(unknown.panel.props.errors._form, undefined);
			assert.deepEqual(tagged(unknown.tree), [true, true, true], name + "no pending line calls the sent draft unsaved");
			assert.equal(unknown.siteChoice.props.disabled, true, name + "the sent draft cannot change before the reload");
			assert.equal(unknown.buttons.every((node) => node.props["aria-disabled"] === true), true, name + "Save and Discard wait for the reload");
			unknown.tree.props.onSubmit({ preventDefault() {} });
			await unknown.panel.props.onSave();
			assert.equal(fixture.writes.length, 1, name + "no second write before the reload");
			assert.equal(fixture.cacheWrites.length, 0);
			assert.equal(typeof SettingsReloadBanner, "function", "Exact production declaration: SettingsReloadBanner");
			const banner = one(SettingsReloadBanner(one(unknown.tree, (node) => node.type === SettingsReloadBanner).props), (node) => node.type === Banner);
			assert.equal(banner.props.title, en.t("indexing.unconfirmedTitle"));
			assert.equal(text(banner.props.action), en.t("indexing.reloadSaved"));
			fixture.nextRead = committed ? readable({ noindex: true }, "settings-2") : readable();
			banner.props.action.props.onClick();
			await settle();
			assert.equal(fixture.reads, 1, name + "Reload reads the stored settings once");
			const reloaded = fixture.indexing();
			assert.equal(reloaded.panel.props.reloadNotice, null, name + "a fresh read ends the unknown state");
			assert.deepEqual(tagged(reloaded.tree), [false, false, false], name + "a fresh read lets a pending line say unsaved again");
			assert.equal(reloaded.panel.props.draft.noindex, true, name + "Reload shows noindex on");
			assert.equal(reloaded.siteChoice.props.disabled, false);
			const owed = (key: unknown) => fixture.invalidations.some((item) => JSON.stringify(item) === JSON.stringify({ queryKey: key }));
			assert.equal(owed(model.seoWorkspaceKeys.overview) && owed(model.seoWorkspaceKeys.sitemap), committed,
				name + "a reload that finds the save committed refreshes the overview and sitemap files, and only then");
			assert.equal(fixture.identityRefreshes, committed ? 1 : 0, name + "the business identity follows a committed save only");
			if (committed) {
				assert.equal(reloaded.panel.props.dirty, false, name + "the stored change is not a draft");
				fixture.current = readable({ noindex: false }, "settings-3");
				assert.equal(fixture.indexing().panel.props.draft.noindex, false, name + "no stale override hides a later change");
			} else {
				assert.equal(reloaded.panel.props.dirty, true, name + "a change that did not land is still a draft");
				assert.equal(reloaded.buttons[1]!.props["aria-disabled"], undefined, name + "Save is available again");
				fixture.reply = { success: true, settings: readable({ noindex: true }, "settings-2") };
				await reloaded.panel.props.onSave();
				assert.equal(fixture.writes.length, 2);
				assert.equal(fixture.writes[1]!.loaded.revision, "settings-1", name + "the next save names the revision just read");
			}
		}
	}
});

await check(async () => {
	const actions = (props: Record<string, unknown>) => new HookOwner().render(() => SettingsActions({ ...props, saveLabel: "Save" })) as Element;
	for (const [label, failure] of failures) {
		for (const [view, field, value, title] of [["site", "siteName", "Unconfirmed website", "Website"], ["social", "twitterHandle", "@unconfirmed", "Search & social"]] as const) {
			locale = "en";
			const name = title + ", " + label + ": ";
			const fixture = new Fixture();
			fixture.panel(view).props.onChange(field, value);
			fixture.reply = failure;
			await fixture.panel(view).props.onSave();
			const unknown = fixture.panel(view);
			assert.equal(unknown.props.draft[field], value, name + "the draft is kept");
			assert.deepEqual(fixture.toasts.map((toast) => toast[1]), [title + " save not confirmed"], name + "the toast does not call the change unsaved");
			assert.deepEqual(unknown.props.reloadNotice, { title: title + " save not confirmed",
				description: "The change may have been saved. Your draft is kept. Reload the saved settings before saving again.",
				action: "Reload saved settings", status: "Save not confirmed", reloading: false, failure: null });
			assert.equal(unknown.props.errors._form, undefined);
			await unknown.props.onSave();
			assert.equal(fixture.writes.length, 1, name + "no second write before the reload");
			const locked = actions(unknown.props);
			assert.equal(locked.type, SettingsActionBar);
			assert.equal(locked.props.status, "Save not confirmed");
			assert.deepEqual([locked.props.saveDisabled, locked.props.discardDisabled], [true, true], name + "Save and Discard wait for the reload");
			const restore = one(locked.props.restore, (node) => node.type === Dialog.Trigger).props.render({}) as Element;
			assert.equal(restore.props.disabled, true, name + "Restore inherited waits for the reload");
			unknown.props.onReload();
			await settle();
			assert.equal(fixture.reads, 1);
			const reloaded = fixture.panel(view);
			assert.equal(reloaded.props.reloadNotice, null);
			assert.equal(reloaded.props.draft[field], value, name + "the draft survives the reload");
			assert.equal(reloaded.props.dirty, true);
			const unlocked = actions(reloaded.props);
			assert.deepEqual([unlocked.props.saveDisabled, unlocked.props.status], [false, "Unsaved changes"]);
		}
	}
	for (const view of ["SiteIdentitySettings", "SearchSocialSettings", "IndexingSettings"]) {
		assert.match(declaration(view), /\{reloadNotice \? <SettingsReloadBanner notice=\{reloadNotice\} onReload=\{onReload\} \/>/, view + " shows the reload notice");
	}
	for (const view of ["SiteIdentitySettings", "SearchSocialSettings"]) {
		assert.match(declaration(view), /savedMessage,\s+reloadNotice,\s+source,\s+onReset,\s+onRestore,\s+\}\}/, view + " locks its action bar");
	}
});

console.log("indexing-settings component selfcheck: " + cases + " groups passed");
