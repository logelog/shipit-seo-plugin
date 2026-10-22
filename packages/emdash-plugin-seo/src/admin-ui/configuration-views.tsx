import * as React from "react";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Collapsible } from "@cloudflare/kumo/components/collapsible";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Input, Textarea } from "@cloudflare/kumo/components/input";
import { Select } from "@cloudflare/kumo/components/select";
import { Switch } from "@cloudflare/kumo/components/switch";
import { Tabs } from "@cloudflare/kumo/components/tabs";
import {
	Article,
	ArrowBendUpRight,
	ArrowClockwise,
	ArrowCounterClockwise,
	ArrowRight,
	BracketsCurly,
	Briefcase,
	Buildings,
	CalendarBlank,
	ChartBar,
	ChartLineUp,
	CopySimple,
	FileCode,
	FloppyDisk,
	GlobeHemisphereWest,
	ImageSquare,
	MapPin,
	Package,
	Path,
	PencilSimple,
	Plus,
	Question,
	Sparkle,
	Trash,
	TreeStructure,
	UserCircle,
	VideoCamera,
	WarningCircle,
} from "@phosphor-icons/react";
import {
	SEO_SCHEMA_COMPOSER_RECIPES,
	SEO_SCHEMA_CONTENT_TYPE_ROLES,
	SEO_SCHEMA_CONTENT_TYPE_ROLE_LABELS,
	composeSeoSchema,
	extractSeoSchemaTypes,
	type SchemaLibraryTemplate,
	type SeoAdminCustomSchema,
	type SeoAdminCustomSchemaErrors,
	type SeoAdminCustomSchemaInput,
	type SeoAdminCustomSchemaReadResult,
	type SeoAdminSchemaPresetConfiguration,
	type SeoAdminModuleConfiguration,
	type SeoAdminModuleErrors,
	type SeoAdminModuleValues,
	type SeoAdminSchemaConfiguration,
	type SeoAdminSchemaContentTypeConfiguration,
	type SeoAdminSchemaPresetGroup,
	type SeoAdminSchemaPresetErrors,
	type SeoAdminSchemaPresetValues,
	type SeoModuleKey,
	type SeoSchemaComposerErrors,
	type SeoSchemaComposerFieldKey,
	type SeoSchemaComposerRecipe,
	type SeoSchemaContentTypeRole,
	type SeoSchemaPresetKey,
	validateSeoAdminCustomSchemaInput,
	validateSeoAdminModuleValues,
	validateSeoAdminSchemaPresetValues,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import { SchemaMapView, type SchemaMapViewProps } from "./schema-map-view.tsx";

import { SCHEMA_PRESET_DATA_CONTAINERS, SCHEMA_PRESET_REQUIREMENTS } from "../lib.ts";
import {
	composeSeoAdminSchema,
	deleteSeoAdminCustomSchema,
	fetchSeoAdminCustomSchema,
	fetchSeoAdminSchemaPresets,
	fetchSeoAdminSchemaContentTypes,
	resetSeoAdminModules,
	resetSeoAdminSchemaContentTypes,
	resetSeoAdminSchemaPresets,
	saveSeoAdminCustomSchema,
	saveSeoAdminModules,
	saveSeoAdminSchemaContentTypes,
	saveSeoAdminSchemaPresets,
} from "./api.ts";
import {
	createSeoSchemaComposerDraft,
	duplicateSeoAdminCustomSchemaInput,
	parseSeoSchemaScope,
	seoSchemaComposerDraftInput,
	serializeSeoSchemaScope,
	type SeoSchemaComposerDraft,
	type SeoSchemaScopeDraft,
	type SeoSchemaScopeMode,
	filterSeoSchemaComposerRecipes,
	moveSeoSchemaComposerHighlight,
	seoSchemaComposerTypeUses,
	visibleSeoSchemaComposerFields,
} from "./schema-composer-view-model.ts";
import {
	ENTRY_SCHEMA_DEADLINES,
	classifyEntrySchemaRequestError,
	withEntrySchemaDeadline,
} from "./entry-schema-model.ts";
import {
	contentTypeRoleInactiveReason,
	contentTypesConfirmation,
	contentTypesConflictDifferences,
	contentTypesDirty,
	createContentTypesPanelStore,
	type ContentTypesConfirmation,
	type ContentTypesIntent,
} from "./schema-content-types-model.ts";
import {
	createSchemaWorkspaceMutationGate,
	createSchemaWorkspacePresetDraft,
	captureSchemaWorkspaceAttempt,
	newSchemaWorkspaceId,
	schemaWorkspacePresetReviewRequired,
	schemaWorkspaceReviewedIdentity,
	type SchemaWorkspaceAttempt,
	reconcileSchemaWorkspacePresetDraft,
	type SchemaWorkspacePresetDraftState,
	schemaWorkspaceTemplateCopy,
	patchSchemaWorkspacePresets,
	upsertSchemaWorkspaceCustom,
	removeSchemaWorkspaceCustom,
	schemaWorkspaceScopeLabel,
	schemaComposerDraftDirty,
	schemaWorkspacePresetDraftDirty,
	schemaWorkspaceRoute,
	schemaWorkspaceSectionForRoute,
	type SchemaWorkspaceRoute,
	type SchemaWorkspaceSection,
} from "./schema-workspace-model.ts";
import { SchemaLibraryView } from "./schema-library-view.tsx";
import { SeoViewBoundary, useSeoToasts, useWorkspaceDraftHold, useWorkspacePageActive } from "./workspace-shell.tsx";
import { PublisherOwnershipPanel, loadPublisherOwnership } from "./publisher-ownership-view.tsx";
import { ContentAnalysisActivation } from "./content-scoring-controls.tsx";
import { PluginCoexistenceView } from "./plugin-coexistence-view.tsx";
import { SettingsActionBar } from "./settings-action-bar.tsx";
import type { SeoAdminView, SeoWorkQueueScope } from "./content-extension-model.ts";
import { SEO_MODULE_SETTING_IDS } from "./workspace-model.ts";
import { WRAPPING_TABS, useTablistName } from "./workspace-tabs.ts";

function readableDate(value: string | null) {
	if (!value) return "Not saved yet";
	const date = new Date(value);
	return Number.isNaN(date.valueOf())
		? "Unknown"
		: new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function ConfigurationActions({
	active = true,
	dirty,
	saving,
	restoring,
	locked = false,
	message,
	updatedAt,
	onReset,
	onRestore,
	canRestore,
	restoreTitle,
	restoreDescription,
	saveLabel,
}: {
	active?: boolean;
	dirty: boolean;
	saving: boolean;
	restoring: boolean;
	/** Keeps Save, Discard and Restore off until the page reads its stored state again. */
	locked?: boolean;
	message: string | null;
	updatedAt: string | null;
	onReset: () => void;
	onRestore: () => Promise<void>;
	canRestore: boolean;
	restoreTitle: string;
	restoreDescription: string;
	saveLabel: string;
}) {
	const busy = saving || restoring || locked;
	const [restoreOpen, setRestoreOpen] = React.useState(false);
	React.useEffect(() => { if (!active) setRestoreOpen(false); }, [active]);
	const restore = (
		<Dialog.Root role="alertdialog" open={active && restoreOpen && canRestore} onOpenChange={setRestoreOpen}>
			<Dialog.Trigger render={(props) => (
				<Button {...props} type="button" variant="secondary-destructive" icon={ArrowCounterClockwise} disabled={!canRestore || busy}>
					Restore inherited
				</Button>
			)} />
			<Dialog size="sm" className="shipit-seo-delete-dialog">
				<Dialog.Title>{restoreTitle}</Dialog.Title>
				<Dialog.Description>{restoreDescription}</Dialog.Description>
				<div className="shipit-seo-dialog-actions">
					<Dialog.Close render={(props) => <Button {...props} type="button" variant="secondary">Cancel</Button>} />
					<Dialog.Close render={(props) => (
						<Button {...props} type="button" variant="destructive" loading={restoring} onClick={() => void onRestore()}>
							Restore inherited
						</Button>
					)} />
				</div>
			</Dialog>
		</Dialog.Root>
	);
	return (
		<SettingsActionBar
			status={message ?? (dirty ? "Unsaved changes" : canRestore ? `Saved: ${readableDate(updatedAt)}` : "Using inherited configuration")}
			restore={restore}
			discardDisabled={!dirty || busy}
			onDiscard={onReset}
			saveLabel={saveLabel}
			saveDisabled={!dirty || busy}
			saving={saving}
		/>
	);
}

const MODULE_ICONS = {
	seoAnalyzer: ChartLineUp,
	schema: BracketsCurly,
	sitemap: TreeStructure,
	redirections: ArrowBendUpRight,
	monitor404: WarningCircle,
	analytics: ChartBar,
	localSeo: MapPin,
	imageSeo: ImageSquare,
	contentAi: Sparkle,
} satisfies Record<SeoModuleKey, typeof ChartLineUp>;

/** Where a module saved on is managed; a key without an entry has no Open link. */
const MODULE_DESTINATIONS: Partial<Record<SeoModuleKey, { view: SeoAdminView; queueScope?: SeoWorkQueueScope }>> = {
	schema: { view: "schema" },
	sitemap: { view: "sitemap" },
	monitor404: { view: "monitor404" },
	imageSeo: { view: "queue", queueScope: "images" },
};

function moduleValues(configuration: SeoAdminModuleConfiguration): SeoAdminModuleValues {
	return Object.fromEntries(configuration.items.map((item) => [item.key, item.enabled])) as SeoAdminModuleValues;
}

/** Unsaved switches and the stored revision they started from, which a save must name. */
interface ModuleForm {
	revision: string | null;
	base: SeoAdminModuleValues;
	draft: SeoAdminModuleValues;
}

function moduleForm(configuration: SeoAdminModuleConfiguration): ModuleForm {
	const values = moduleValues(configuration);
	return { revision: configuration.revision, base: values, draft: values };
}

function sameModuleValues(left: SeoAdminModuleValues, right: SeoAdminModuleValues): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export function ModulesView({
	configuration,
	onSaved,
	onOverviewRefresh,
	onReload,
	onOpenIdentity,
	onOpenView,
}: {
	configuration: SeoAdminModuleConfiguration;
	onSaved: (configuration: SeoAdminModuleConfiguration) => void;
	onOverviewRefresh: () => Promise<void>;
	/** Reads the stored configuration again after a conflict or a save whose outcome is unknown; null when that read failed. */
	onReload: () => Promise<SeoAdminModuleConfiguration | null>;
	onOpenIdentity?: () => void;
	onOpenView?: (view: SeoAdminView, queueScope?: SeoWorkQueueScope) => void;
}) {
	const toasts = useSeoToasts();
	const [form, setForm] = React.useState<ModuleForm>(() => moduleForm(configuration));
	const [errors, setErrors] = React.useState<SeoAdminModuleErrors>({});
	const [saving, setSaving] = React.useState(false);
	const [restoring, setRestoring] = React.useState(false);
	const [message, setMessage] = React.useState<string | null>(null);
	const [conflict, setConflict] = React.useState(false);
	const [unconfirmed, setUnconfirmed] = React.useState(false);
	const [reloading, setReloading] = React.useState(false);
	const [reloadFailed, setReloadFailed] = React.useState(false);

	// A newer configuration replaces the form only while nothing is unsaved, so
	// unsaved switches keep the revision they started from and a save conflicts.
	React.useEffect(() => {
		setForm((state) => (sameModuleValues(state.draft, state.base) ? moduleForm(configuration) : state));
	}, [configuration]);

	const current = React.useMemo(() => moduleValues(configuration), [configuration]);
	const draft = form.draft;
	const dirty = !sameModuleValues(form.draft, form.base);
	useWorkspaceDraftHold("module-switches", dirty || saving || restoring || conflict || unconfirmed || reloading);
	const pageActive = useWorkspacePageActive();
	const switchable = configuration.items.filter((item) => item.editable);
	const enabled = switchable.filter((item) => draft[item.key]).length;

	const update = (key: SeoModuleKey, value: boolean) => {
		setForm((state) => ({ ...state, draft: { ...state.draft, [key]: value } }));
		setErrors((state) => {
			const next = { ...state };
			delete next[key];
			delete next._form;
			return next;
		});
		setMessage(null);
	};

	const save = async () => {
		if (unconfirmed || reloading) return;
		const validation = validateSeoAdminModuleValues(draft);
		if (!validation.success) {
			setErrors(validation.errors);
			return;
		}
		setSaving(true);
		setErrors({});
		setMessage(null);
		try {
			const result = await saveSeoAdminModules(validation.values, form.revision);
			if (!result.success) {
				setErrors(result.errors);
				if (result.conflict) setConflict(true);
				return;
			}
			setConflict(false);
			setForm(moduleForm(result.modules));
			onSaved(result.modules);
			// The status beside Save reports the save; a toast would cover the action bar.
			setMessage("Module settings saved");
			// The publisher row shows the Schema switch as its separate gate.
			void loadPublisherOwnership();
			await onOverviewRefresh();
		} catch {
			// A lost or failed response can follow a committed write, so only a fresh read shows what is stored.
			setUnconfirmed(true);
			setMessage("Save not confirmed");
			toasts.error("Feature controls save not confirmed", "The change may have been saved. Reload the latest choices before saving again.");
		} finally {
			setSaving(false);
		}
	};

	const restoreInherited = async () => {
		setRestoring(true);
		setErrors({});
		setMessage(null);
		try {
			const result = await resetSeoAdminModules(configuration.revision);
			if (!result.success) {
				setErrors(result.errors);
				if (result.conflict) setConflict(true);
				return;
			}
			setConflict(false);
			setForm(moduleForm(result.modules));
			onSaved(result.modules);
			setMessage("Inherited module settings restored");
			toasts.success("Inherited module settings restored");
			await onOverviewRefresh();
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : "Failed to restore inherited modules";
			setErrors({ _form: detail });
			toasts.error("Inherited modules not restored", detail);
		} finally {
			setRestoring(false);
		}
	};

	const reloadLatest = async () => {
		if (reloading) return;
		setReloading(true);
		setReloadFailed(false);
		setErrors({});
		try {
			// The lock and the draft stay until a fresh read answers; only that read decides what is safe to show.
			const fresh = await onReload();
			if (!fresh) {
				setReloadFailed(true);
				return;
			}
			setConflict(false);
			setUnconfirmed(false);
			setMessage(null);
			// The same revision means nothing was stored, so the draft stays for an explicit Save.
			setForm((state) => fresh.revision === state.revision
				? { revision: fresh.revision, base: moduleValues(fresh), draft: state.draft }
				: moduleForm(fresh));
		} finally {
			setReloading(false);
		}
	};

	return (
		<>
		<PluginCoexistenceView />
		<form className="shipit-seo-panel shipit-seo-module-panel" onSubmit={(event) => { event.preventDefault(); void save(); }}>
			<div className="shipit-seo-section-heading">
				<div>
					<span className="shipit-seo-eyebrow">Runtime settings</span>
					<h2>Feature controls</h2>
				</div>
				<div className="shipit-seo-heading-badges">
					<Badge variant="outline">Save to apply</Badge>
					<Badge variant="secondary">{enabled} of {switchable.length} on</Badge>
				</div>
			</div>
			<p className="shipit-seo-muted">Only controls that change SEO behavior appear here. Switch changes apply when you save modules.</p>

			<div className="shipit-seo-module-list">
				{switchable.map((item) => {
					const Icon = MODULE_ICONS[item.key];
					const destination = current[item.key] ? MODULE_DESTINATIONS[item.key] : undefined;
					return (
						<div key={item.key} className="shipit-seo-module-row">
							<span className="shipit-seo-module-icon"><Icon size={20} aria-hidden="true" /></span>
							<div className="shipit-seo-module-copy">
								<div>
									<strong>{item.label}</strong>
									<Badge variant={draft[item.key] ? "success" : "secondary"}>{draft[item.key] ? "On" : "Off"}</Badge>
								</div>
								<p>{item.description}</p>
								{errors[item.key] ? <span className="shipit-seo-form-error">{errors[item.key]}</span> : null}
							</div>
							<div className="shipit-seo-module-controls">
								{destination && onOpenView ? (
									<Button type="button" variant="ghost" size="sm" icon={ArrowRight} aria-label={`Open ${item.label}`}
										onClick={() => onOpenView(destination.view, destination.queueScope)}>
										Open
									</Button>
								) : null}
								<Switch
									aria-label={item.label}
									data-seo-setting={SEO_MODULE_SETTING_IDS[item.key]}
									checked={draft[item.key]}
									disabled={saving || restoring || unconfirmed || reloading || !configuration.writable}
									onCheckedChange={(checked) => update(item.key, checked)}
								/>
							</div>
						</div>
					);
				})}
			</div>
			{conflict ? (
				<Banner
					variant="alert"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title="Feature controls changed elsewhere"
					description="Nothing was saved. Reload to review the latest choices; your unsaved switches are discarded."
					action={<Button type="button" size="sm" variant="secondary" icon={ArrowClockwise} loading={reloading} disabled={reloading} onClick={() => void reloadLatest()}>Reload latest</Button>}
				/>
			) : unconfirmed ? (
				<Banner
					variant="alert"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title="Feature controls save not confirmed"
					description="The change may have been saved. Reload to read the saved choices before saving again. If the save did not land, your switches stay for another Save; otherwise the saved choices replace them."
					action={<Button type="button" size="sm" variant="secondary" icon={ArrowClockwise} loading={reloading} disabled={reloading} onClick={() => void reloadLatest()}>Reload latest</Button>}
				/>
			) : errors._form ? <p className="shipit-seo-form-error">{errors._form}</p> : null}
			{reloadFailed ? <p className="shipit-seo-form-error" role="alert">The saved choices could not be read. Your switches are kept and saving stays off; choose Reload latest again.</p> : null}
			{!configuration.writable ? (
				<p className="shipit-seo-muted">Saving is unavailable: this host cannot store Feature controls with a revision check.</p>
			) : null}
			<ConfigurationActions
				active={pageActive}
				dirty={dirty}
				saving={saving}
				restoring={restoring}
				locked={unconfirmed || reloading}
				message={message}
				updatedAt={configuration.updatedAt}
				onReset={conflict ? () => void reloadLatest() : () => { setForm(moduleForm(configuration)); setErrors({}); setMessage(null); }}
				onRestore={restoreInherited}
				canRestore={configuration.updatedAt !== null && configuration.writable}
				restoreTitle="Restore inherited module settings?"
				restoreDescription="The saved module snapshot will be removed. Schema, Image alt checks, and 404 Monitor return to their inherited settings."
				saveLabel="Save modules"
			/>
		</form>
		<ContentAnalysisActivation />
		<PublisherOwnershipPanel variant="feature" {...(onOpenIdentity ? { onOpenIdentity } : {})} />
		</>
	);
}

const PRESET_ICONS = {
	organization: Buildings,
	website: GlobeHemisphereWest,
	webPage: FileCode,
	blogPosting: Article,
	service: Briefcase,
	breadcrumbList: Path,
	person: UserCircle,
	faqPage: Question,
	localBusiness: MapPin,
	product: Package,
	event: CalendarBlank,
	videoObject: VideoCamera,
} satisfies Record<SeoSchemaPresetKey, typeof Buildings>;


const PRESET_GROUPS: readonly {
	key: SeoAdminSchemaPresetGroup;
	label: string;
	description: string;
}[] = [
	{
		key: "core",
		label: "Core graph",
		description: "Stable site and page identities shared across the graph.",
	},
	{
		key: "content",
		label: "Content graph",
		description: "Entities derived from editorial content and page context.",
	},
	{
		key: "rich",
		label: "Rich data",
		description: "Strict presets that emit only when their required fields are complete.",
	},
];


interface SchemaEditorState {
	writeId: string;
	expectedRevision: string | null;
	values: SeoAdminCustomSchemaInput;
	scopeMode: SeoSchemaScopeMode;
	collection: string;
	entry: string;
}

function editorFromSchema(schema?: SeoAdminCustomSchema | SeoAdminCustomSchemaInput, revision: string | null = null): SchemaEditorState {
	const scope = schema?.scope ?? "global";
	const scopeDraft = parseSeoSchemaScope(scope);
	return {
		writeId: schema?.id ?? newSchemaWorkspaceId(),
		expectedRevision: revision,
		values: {
			...(schema ? { id: schema.id } : {}),
			name: schema?.name ?? "",
			scope,
			json: schema?.json ?? "",
			enabled: schema?.enabled ?? true,
		},
		scopeMode: scopeDraft.mode,
		collection: scopeDraft.collection,
		entry: scopeDraft.entry,
	};
}

function editorInput(editor: SchemaEditorState): SeoAdminCustomSchemaInput {
	const scope = serializeSeoSchemaScope({
		mode: editor.scopeMode,
		collection: editor.collection,
		entry: editor.entry,
	});
	return { ...editor.values, scope };
}

const SCOPE_MODE_LABELS: Record<SeoSchemaScopeMode, string> = {
	global: "All pages",
	collection: "A collection",
	entry: "One entry",
};

function SchemaScopeFields({
	value,
	error,
	modes = ["global", "collection", "entry"],
	description,
	contentTypes,
	onChange,
}: {
	value: SeoSchemaScopeDraft;
	error?: string;
	modes?: readonly SeoSchemaScopeMode[];
	description?: string;
	contentTypes?: SeoAdminSchemaContentTypeConfiguration;
	onChange: (value: SeoSchemaScopeDraft) => void;
}) {
	return (
		<div className="shipit-seo-schema-scope-wrap">
			<div className="shipit-seo-schema-scope">
				<Select<SeoSchemaScopeMode>
					label="Applies to"
					description={description}
					value={value.mode}
					onValueChange={(mode) => mode && onChange({ ...value, mode })}
					items={Object.fromEntries(
						(Object.keys(SCOPE_MODE_LABELS) as SeoSchemaScopeMode[])
							.filter((mode) => mode === value.mode || modes.includes(mode))
							.map((mode) => [mode, SCOPE_MODE_LABELS[mode]]),
					)}
				/>
				{value.mode !== "global" ? (
					contentTypes?.discoveryAvailable && contentTypes.items.length ? (
					<Select<string>
						label="Content type"
						value={value.collection}
						items={Object.fromEntries([
							["", "Choose content type"],
							...contentTypes.items.map((item) => [item.collection, item.label]),
							...(value.collection && !contentTypes.items.some((item) => item.collection === value.collection) ? [[value.collection, value.collection]] : []),
						])}
						onValueChange={(collection) => collection !== null && onChange({ ...value, collection })}
					/>
				) : (
					<Input label="Collection key" placeholder="posts" value={value.collection} aria-required="true" onChange={(event) => onChange({ ...value, collection: event.target.value })} />
				)
				) : null}
				{value.mode === "entry" ? (
					<Input
						label="Entry ID or slug"
						placeholder="article-slug"
						value={value.entry}
						aria-required="true"
						onChange={(event) => onChange({ ...value, entry: event.target.value })}
					/>
				) : null}
			</div>
			{error ? <p className="shipit-seo-form-error" aria-live="polite">{error}</p> : null}
		</div>
	);
}

function newComposerDraft(recipe: SeoSchemaComposerRecipe): SeoSchemaComposerDraft {
	const draft = createSeoSchemaComposerDraft(recipe);
	if (draft.input.scope) return draft;
	return { ...draft, scope: { mode: "entry", collection: "", entry: "" } };
}

function composerScopeDescription(scopes: readonly SeoSchemaScopeMode[]): string | undefined {
	if (scopes.includes("collection")) return undefined;
	return scopes.includes("global")
		? "All pages for the business behind this site, or one entry for a single location."
		: "The values describe one real-world item, so this schema applies to one entry.";
}

/** Focus stays in the search field; arrow keys move the highlight and Enter chooses it. */
function SchemaTypePicker({ value, usedTypes, disabled, onChoose }: {
	value: SeoSchemaComposerRecipe;
	/** Saved custom schemas per schema.org type; context only, never a reason to change them. */
	usedTypes: ReadonlyMap<string, number>;
	disabled: boolean;
	onChoose: (recipe: SeoSchemaComposerRecipe) => void;
}) {
	const id = React.useId();
	const [query, setQuery] = React.useState("");
	const [highlight, setHighlight] = React.useState<SeoSchemaComposerRecipe | null>(null);
	const shown = filterSeoSchemaComposerRecipes(SEO_SCHEMA_COMPOSER_RECIPES, query);
	const keys = shown.map((recipe) => recipe.key);
	const active = highlight && keys.includes(highlight) ? highlight : keys.includes(value) ? value : keys[0] ?? null;
	const optionId = (key: string) => `${id}-type-${key}`;
	return (
		<div className="shipit-seo-schema-type-picker">
			<Input
				label="Schema type"
				description="Search, then use the arrow keys and Enter, or choose a type in the list."
				type="search"
				role="combobox"
				aria-autocomplete="list"
				aria-expanded={shown.length > 0}
				aria-controls={`${id}-types`}
				aria-activedescendant={active ? optionId(active) : undefined}
				placeholder="Search schema types"
				autoComplete="off"
				value={query}
				disabled={disabled}
				onChange={(event) => { setQuery(event.target.value); setHighlight(null); }}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						// Enter inside the guided form would otherwise submit a save.
						event.preventDefault();
						if (active && !disabled) onChoose(active);
						return;
					}
					if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
					event.preventDefault();
					setHighlight(moveSeoSchemaComposerHighlight(keys, active, event.key));
				}}
			/>
			{shown.length ? (
				<ul id={`${id}-types`} className="shipit-seo-schema-type-picker__list" role="listbox" aria-label="Schema types">
					{shown.map((recipe) => {
						const used = usedTypes.get(recipe.schemaType) ?? 0;
						return (
							<li
								key={recipe.key}
								id={optionId(recipe.key)}
								role="option"
								aria-selected={recipe.key === value}
								aria-disabled={disabled || undefined}
								data-active={recipe.key === active || undefined}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => { if (!disabled) onChoose(recipe.key); }}
							>
								<strong>{recipe.label}</strong>
								<span>{recipe.description}</span>
								{used ? <small>{used === 1 ? "1 saved custom schema uses this type" : `${used} saved custom schemas use this type`}</small> : null}
							</li>
						);
					})}
				</ul>
			) : <p className="shipit-seo-muted" role="status">No schema type matches</p>}
		</div>
	);
}

const COMPOSER_TYPE_SCOPES = new Map<string, readonly SeoSchemaScopeMode[]>(
	SEO_SCHEMA_COMPOSER_RECIPES.map((recipe) => [recipe.schemaType, recipe.scopes]),
);

function scopeRepeatsEntity(schema: SeoAdminCustomSchema): boolean {
	const mode = parseSeoSchemaScope(schema.scope).mode;
	return schema.types.some((type) => {
		const scopes = COMPOSER_TYPE_SCOPES.get(type);
		return scopes ? !scopes.includes(mode) : false;
	});
}

// Follows the saved content type mapping so a new mapping shows its preset
// without reloading the preset configuration.
function presetApplicable(
	key: SeoSchemaPresetKey,
	serverApplicable: boolean | undefined,
	contentTypes: SeoAdminSchemaContentTypeConfiguration,
): boolean {
	const role = SCHEMA_PRESET_REQUIREMENTS[key]?.contentTypeRole;
	if (!role) return true;
	if (!contentTypes.discoveryAvailable) return serverApplicable !== false;
	return contentTypes.items.some((item) => item.role === role);
}

const contentTypesStore = createContentTypesPanelStore();
const CONTENT_TYPES_CHECK_MS = 15_000;

function ConfirmAction({
	active,
	label,
	title,
	description,
	confirmLabel,
	variant,
	disabled,
	loading,
	open,
	onOpenChange,
	onConfirm,
}: {
	active: boolean;
	label: string;
	title: string;
	description: string;
	confirmLabel: string;
	variant: "primary" | "secondary";
	disabled: boolean;
	loading: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}) {
	return (
		<Dialog.Root role="alertdialog" open={active && open} onOpenChange={onOpenChange}>
			<Dialog.Trigger
				render={(props) => (
					<Button {...props} type="button" variant={variant} loading={loading} disabled={disabled}>
						{label}
					</Button>
				)}
			/>
			<Dialog size="sm" className="shipit-seo-delete-dialog">
				<Dialog.Title>{title}</Dialog.Title>
				<Dialog.Description>{description}</Dialog.Description>
				<div className="shipit-seo-dialog-actions">
					<Dialog.Close render={(props) => <Button {...props} type="button" variant="secondary">Cancel</Button>} />
					<Dialog.Close
						render={(props) => (
							<Button {...props} type="button" variant="destructive" onClick={onConfirm}>
								{confirmLabel}
							</Button>
						)}
					/>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}

function ContentTypeSchemaPanel({
	active,
	configuration,
	outputEnabled,
	onContentTypesSaved,
	onOverviewRefresh,
}: {
	active: boolean;
	configuration: SeoAdminSchemaConfiguration;
	outputEnabled: boolean;
	/** Patches only the mapping in the current cache; may run after this view unmounts. */
	onContentTypesSaved: (contentTypes: SeoAdminSchemaContentTypeConfiguration) => void;
	onOverviewRefresh: () => Promise<void>;
}) {
	const toasts = useSeoToasts();
	const state = React.useSyncExternalStore(contentTypesStore.subscribe, contentTypesStore.get, contentTypesStore.get);
	const dispatch = contentTypesStore.dispatch;
	React.useEffect(() => { if (!active) dispatch({ type: "confirm-close" }); }, [active, dispatch]);
	const statusRef = React.useRef<HTMLDivElement>(null);
	const headingRef = React.useRef<HTMLHeadingElement>(null);
	const hadNotice = React.useRef(false);

	React.useEffect(() => {
		dispatch({ type: "receive", configuration: configuration.contentTypes });
	}, [configuration.contentTypes, dispatch]);

	const notice = state.notice;
	// Save and Restore disable themselves on success, so the outcome takes focus;
	// a notice whose buttons unmount hands focus back to the section heading.
	React.useEffect(() => {
		if (active && notice) statusRef.current?.focus();
		else if (active && hadNotice.current) headingRef.current?.focus();
		hadNotice.current = notice !== null;
	}, [notice, active]);

	const base = state.base ?? configuration.contentTypes;
	const dirty = contentTypesDirty(state);
	const pending = state.pending;
	const unsettled = notice?.kind === "unconfirmed" || notice?.kind === "conflict";
	const canEdit = base.writable && base.discoveryAvailable && !pending && notice?.kind !== "unconfirmed";
	const canSave = canEdit && !unsettled && (dirty || base.record === "invalid");
	const canReset = base.writable && !pending && !unsettled && base.record !== "absent" && base.revision !== null;
	const overflow = base.discoveryAvailable && base.discoveredCount > base.items.length;
	const presetEnabled = (key: "blogPosting" | "service") =>
		configuration.presets.items.find((item) => item.key === key)?.enabled === true;

	const publish = onContentTypesSaved;

	const write = async (intent: ContentTypesIntent) => {
		if (contentTypesStore.get().pending || contentTypesStore.get().notice?.kind === "unconfirmed") return;
		dispatch({ type: "start", pending: intent.action });
		try {
			const result = await withEntrySchemaDeadline(
				(signal) =>
					intent.action === "save"
						? saveSeoAdminSchemaContentTypes(
							{
								values: intent.values,
								expectedRevision: intent.expectedRevision,
								...(intent.replaceInvalid ? { replaceInvalid: true } : {}),
							},
							signal,
						)
						: resetSeoAdminSchemaContentTypes(intent.expectedRevision, signal),
				ENTRY_SCHEMA_DEADLINES.writeMs,
			);
			dispatch({ type: "result", intent, result });
			if (result.success) {
				publish(result.contentTypes);
				toasts.success(intent.action === "save" ? "Content type schema saved" : "Default content type schema restored");
				await onOverviewRefresh();
			}
		} catch (cause) {
			dispatch({
				type: "request-failed",
				intent,
				failure: classifyEntrySchemaRequestError(cause),
				message: cause instanceof Error ? cause.message : "Content type schema was not changed.",
			});
		}
	};

	const save = () => {
		if (!state.base) return;
		const values = Object.fromEntries(state.base.items.map((item) => [item.collection, state.draft[item.collection] ?? item.role]));
		void write({ action: "save", values, expectedRevision: state.base.revision });
	};

	// The confirmed write is the one fixed when its dialog opened.
	const openConfirmation = (action: ContentTypesConfirmation["action"]) => (open: boolean) => {
		if (!open) {
			dispatch({ type: "confirm-close" });
			return;
		}
		const confirmation = contentTypesConfirmation(contentTypesStore.get(), action);
		if (confirmation) dispatch({ type: "confirm-open", confirmation });
	};
	const confirm = () => {
		const confirmation = contentTypesStore.get().confirming;
		if (!confirmation) return;
		void write(
			confirmation.action === "reset"
				? confirmation
				: { action: "save", values: confirmation.values, expectedRevision: confirmation.expectedRevision, replaceInvalid: true },
		);
	};
	const differences = contentTypesConflictDifferences(state);

	const checkCurrentState = async () => {
		if (notice?.kind !== "unconfirmed") return;
		const { intent } = notice;
		dispatch({ type: "start", pending: "check" });
		try {
			const read = await withEntrySchemaDeadline(
				(signal) =>
					fetchSeoAdminSchemaContentTypes(
						{
							expectedRevision: intent.expectedRevision,
							check: intent.action === "save"
								? { action: "save", values: intent.values, ...(intent.replaceInvalid ? { replaceInvalid: true as const } : {}) }
								: { action: "reset" },
						},
						signal,
					),
				CONTENT_TYPES_CHECK_MS,
			);
			dispatch({ type: "check-result", check: read.check, configuration: read.contentTypes });
			publish(read.contentTypes);
			if (read.check === "applied") await onOverviewRefresh();
		} catch (cause) {
			dispatch({ type: "check-failed", message: cause instanceof Error ? cause.message : "The check did not finish." });
		}
	};

	const roleItems = Object.fromEntries(SEO_SCHEMA_CONTENT_TYPE_ROLES.map((role) => [role, SEO_SCHEMA_CONTENT_TYPE_ROLE_LABELS[role]]));

	return (
		<section className="shipit-seo-panel shipit-seo-preset-panel" aria-labelledby="schema-content-types-heading">
			<div className="shipit-seo-section-heading">
				<div>
					<span className="shipit-seo-eyebrow">Content types</span>
					<h2 id="schema-content-types-heading" ref={headingRef} tabIndex={-1}>Content type schema</h2>
				</div>
			</div>
			<p className="shipit-seo-muted">
				Choose the main schema graph for each public content type. Saving changes published pages right away.
				No type-specific schema adds no content type graph; site, entry and EmDash schema still apply.
			</p>
			<Collapsible.Root>
				<Collapsible.DefaultTrigger>How content type defaults work</Collapsible.DefaultTrigger>
				<Collapsible.DefaultPanel>
					<p className="shipit-seo-muted">
						Web page makes a WebPage the page's main graph, linked to the WebSite; it does not need the WebPage switch below.
						Blog posting and Service emit only while their preset is on. Without a mapped graph, WebSite is the page's main
						graph. An entry can still turn off a preset in its own SEO settings.
					</p>
				</Collapsible.DefaultPanel>
			</Collapsible.Root>
			{!base.writable ? (
				<Banner
					variant="alert"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title="Changes cannot be saved on this site"
					description="Its storage cannot guard against replacing another change. The saved mapping, or the defaults, stays in place."
				/>
			) : null}
			{base.record === "invalid" ? (
				<Banner
					variant="error"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title="The saved mapping cannot be read"
					description="Until it is replaced or the defaults are restored, content pages get no content type graph from this plugin. Saving replaces it with the choices below."
				/>
			) : null}
			{!base.discoveryAvailable ? (
				<Banner
					variant="alert"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title="Content types could not be listed"
					description="Saved choices still apply. They can be changed once content types can be listed."
				/>
			) : null}
			{overflow ? (
				<Banner
					variant="alert"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title={`Only the first ${base.items.length} of ${base.discoveredCount} content types are listed`}
					description="Saving changes only the listed types. Saved choices for the others are kept."
				/>
			) : null}
			{notice ? (
				<div ref={statusRef} tabIndex={-1} className="shipit-seo-entry-schema__status" role={notice.kind === "info" ? "status" : "alert"}>
					{notice.kind === "conflict" ? (
						<Banner
							variant="alert"
							icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
							title="Changed elsewhere"
							description={
								differences.length
									? `${notice.message} Saved now: ${differences.map((item) => `${item.label} ${SEO_SCHEMA_CONTENT_TYPE_ROLE_LABELS[item.saved]}`).join(", ")}. Keep my edits would save your choices instead.`
									: notice.message
							}
							action={
								<div className="shipit-seo-entry-schema__actions">
									<Button type="button" size="sm" variant="secondary" disabled={pending !== null} onClick={() => dispatch({ type: "use-latest" })}>
										Use the saved version
									</Button>
									<Button type="button" size="sm" variant="secondary" disabled={pending !== null} onClick={() => dispatch({ type: "keep-edits" })}>
										Keep my edits
									</Button>
								</div>
							}
						/>
					) : notice.kind === "unconfirmed" ? (
						<Banner
							variant="alert"
							icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
							title={notice.intent.action === "save" ? "Save not confirmed" : "Restore not confirmed"}
							description={notice.message}
							action={
								<Button type="button" size="sm" variant="secondary" loading={pending === "check"} onClick={() => void checkCurrentState()}>
									Check current state
								</Button>
							}
						/>
					) : (
						<Banner
							variant={notice.kind === "info" ? "default" : "error"}
							title={notice.kind === "info" ? notice.message : notice.kind === "denied" ? "Not allowed" : notice.kind === "invalid_stored" ? "The saved mapping cannot be read" : "Not saved"}
							description={notice.kind === "info" ? undefined : notice.message}
						/>
					)}
				</div>
			) : null}
			{base.discoveryAvailable && base.items.length === 0 ? (
				<p className="shipit-seo-muted">No public content types were found on this site.</p>
			) : base.items.length ? (
				<div className="shipit-seo-content-type-list">
					{base.items.map((item) => {
						const role = state.draft[item.collection] ?? item.role;
						const inactive = contentTypeRoleInactiveReason(role, {
							outputEnabled,
							recordInvalid: base.record === "invalid",
							presetEnabled,
						});
						const savedNow = differences.find((difference) => difference.collection === item.collection);
						const sourceText = savedNow
							? `Yours: ${SEO_SCHEMA_CONTENT_TYPE_ROLE_LABELS[savedNow.draft]}. Saved now: ${SEO_SCHEMA_CONTENT_TYPE_ROLE_LABELS[savedNow.saved]}.`
							: role !== item.role
								? "Changed, not saved yet."
								: item.source === "saved" ? "Saved." : "Default.";
						return (
							<div key={item.collection} className="shipit-seo-composer-select">
								<Select<string>
									label={item.label}
									value={role}
									disabled={!canEdit}
									description={`${item.collection}. ${sourceText}${inactive ? ` ${inactive}` : ""}`}
									error={state.errors[item.collection]}
									onValueChange={(next) => {
										if (next === null) return;
										dispatch({ type: "edit", collection: item.collection, role: next as SeoSchemaContentTypeRole });
									}}
									items={roleItems}
								/>
							</div>
						);
					})}
				</div>
			) : null}
			{base.unlisted.length ? (
				<Collapsible.Root>
					<Collapsible.DefaultTrigger>{`Saved for content types not listed here (${base.unlisted.length})`}</Collapsible.DefaultTrigger>
					<Collapsible.DefaultPanel>
						<p className="shipit-seo-muted">These choices are kept and still apply if such a page is rendered.</p>
						<ul className="shipit-seo-muted">
							{base.unlisted.map((item) => (
								<li key={item.collection}>
									<code>{item.collection}</code>: {SEO_SCHEMA_CONTENT_TYPE_ROLE_LABELS[item.role]}
								</li>
							))}
						</ul>
					</Collapsible.DefaultPanel>
				</Collapsible.Root>
			) : null}
			{base.writable && (base.discoveryAvailable || base.record !== "absent") ? (
				<div className="shipit-seo-schema-editor-actions">
					{base.discoveryAvailable ? (
						<Button type="button" variant="secondary" icon={ArrowCounterClockwise} disabled={!dirty || pending !== null || notice?.kind === "unconfirmed"} onClick={() => dispatch({ type: "discard" })}>
							Discard changes
						</Button>
					) : null}
					{base.record !== "absent" ? (
						<ConfirmAction
							active={active}
							label="Restore defaults"
							title="Restore the default mapping?"
							description="Posts return to Blog posting, services to Service and every other content type to No type-specific schema. Published pages change right away."
							confirmLabel="Restore defaults"
							variant="secondary"
							disabled={!canReset}
							loading={pending === "reset"}
							open={state.confirming?.action === "reset"}
							onOpenChange={openConfirmation("reset")}
							onConfirm={confirm}
						/>
					) : null}
					{base.discoveryAvailable ? (
						base.record === "invalid" ? (
							<ConfirmAction
							active={active}
								label="Replace saved mapping"
								title="Replace the unreadable mapping?"
								description="The saved mapping cannot be read, so it is replaced with the choices shown. Choices it held for other content types are lost."
								confirmLabel="Replace mapping"
								variant="primary"
								disabled={!canSave}
								loading={pending === "save"}
								open={state.confirming?.action === "replace"}
								onOpenChange={openConfirmation("replace")}
								onConfirm={confirm}
							/>
						) : (
							<Button type="button" variant="primary" icon={FloppyDisk} loading={pending === "save"} disabled={!canSave} onClick={() => save()}>
								Save content types
							</Button>
						)
					) : null}
				</div>
			) : null}
		</section>
	);
}

function PresetRequirements({
	presetKey,
	contentTypes,
}: {
	presetKey: SeoSchemaPresetKey;
	contentTypes: SeoAdminSchemaContentTypeConfiguration;
}) {
	const requirements = SCHEMA_PRESET_REQUIREMENTS[presetKey];
	if (!requirements) return null;
	const role = requirements.contentTypeRole;
	const mapped = role ? contentTypes.items.filter((item) => item.role === role) : [];
	return (
		<>
			{role ? (
				<p>
					{mapped.length ? (
						<>
							Emits on entries in{" "}
							{mapped.map((item, index) => (
								<React.Fragment key={item.collection}>
									{index ? ", " : null}
									<code>{item.collection}</code>
								</React.Fragment>
							))}
							. Change this under Content type schema.
						</>
					) : contentTypes.discoveryAvailable
						? "No content type is mapped to this schema type, so it does not emit. Map one under Content type schema."
						: null}
					{!contentTypes.discoveryAvailable
						? `${mapped.length ? " " : ""}This site could not list its content types. Unless a saved mapping says otherwise, ${role === "blogPosting" ? "posts" : "services"} use this type by default.`
						: null}
				</p>
			) : null}
			{requirements.breadcrumbs ? <p>Emits only on pages whose theme passes breadcrumbs.</p> : null}
			{requirements.data ? (
				<p>
					Needs entry data:{" "}
					{requirements.data.map((group, index) => (
						<React.Fragment key={group.join("|")}>
							{index ? ", " : null}
							{group.map((path, pathIndex) => (
								<React.Fragment key={path}>
									{pathIndex ? " or " : null}
									<code>{path}</code>
								</React.Fragment>
							))}
						</React.Fragment>
					))}
					. These fields can also sit inside <code>{SCHEMA_PRESET_DATA_CONTAINERS[0]}</code>.
				</p>
			) : null}
			{requirements.note ? <p>{requirements.note}</p> : null}
		</>
	);
}

function previewJson(raw: string): { formatted: string; types: string[]; error: string | null } {
	if (!raw.trim()) return { formatted: "", types: [], error: null };
	try {
		const parsed = JSON.parse(raw) as unknown;
		return { formatted: JSON.stringify(parsed, null, 2), types: extractSeoSchemaTypes(parsed), error: null };
	} catch {
		return { formatted: raw, types: [], error: "JSON preview is unavailable until the syntax is valid." };
	}
}

function normalizeComposerErrors(
	errors: SeoSchemaComposerErrors | SeoAdminCustomSchemaErrors,
): SeoSchemaComposerErrors {
	const source = errors as Record<string, string | undefined>;
	return {
		...errors,
		...(source.name && !source.schemaName ? { schemaName: source.name } : {}),
		...(source.json && !source._form ? { _form: source.json } : {}),
	};
}

type SchemaStoredRead = Extract<SeoAdminCustomSchemaReadResult, { success: true }>;
type SchemaWorkspaceReview =
	| { kind: "custom"; read: SchemaStoredRead }
	| { kind: "presets"; presets: SeoAdminSchemaPresetConfiguration };
type CustomSchemaDeleteOutcome = "deleted" | "review-required" | "blocked" | "unknown" | "failed";

function customSchemaDeleteFailure(error: string): CustomSchemaDeleteOutcome {
	return error === "conflict" || error === "not_found" ? "review-required" : error === "unconfirmed" ? "unknown" : "failed";
}

function CustomSchemaDelete({
	active, schema, deleting, disabled, onLoad, onDelete, scopeLabel,
}: {
	active: boolean;
	schema: SeoAdminCustomSchema;
	/** Names a saved scope as the workspace lists it, never by its stored key. */
	scopeLabel: (scope: string) => string;
	deleting: boolean;
	disabled: boolean;
	onLoad: () => Promise<SeoAdminCustomSchemaReadResult>;
	onDelete: (read: SchemaStoredRead) => Promise<CustomSchemaDeleteOutcome>;
}) {
	const [open, setOpen] = React.useState(false);
	const [read, setRead] = React.useState<SeoAdminCustomSchemaReadResult | null>(null);
	const [loading, setLoading] = React.useState(false);
	const sequence = React.useRef(0);
	React.useEffect(() => { if (!active) { sequence.current += 1; setOpen(false); setRead(null); setLoading(false); } }, [active]);
	const changeOpen = (next: boolean) => {
		const request = ++sequence.current;
		setOpen(next); setRead(null);
		if (!next) { setLoading(false); return; }
		setLoading(true);
		void onLoad().then((result) => { if (request === sequence.current) setRead(result); })
			.finally(() => { if (request === sequence.current) setLoading(false); });
	};
	const loaded = read?.success ? read : null;
	const deleteBlocked = disabled || deleting || loading || !loaded || loaded.state === "absent";
	const confirmDelete = () => {
		if (!loaded || deleteBlocked) return;
		const request = sequence.current;
		void onDelete(loaded).then((outcome) => {
			// Cancel or reopening advances the sequence, so a late result cannot close a newer confirmation.
			if (request === sequence.current && (outcome === "deleted" || outcome === "review-required")) changeOpen(false);
		});
	};
	return (
		<Dialog.Root role="alertdialog" open={active && open} onOpenChange={changeOpen}>
			<Dialog.Trigger render={(props) => <Button {...props} type="button" shape="square" size="sm" variant="ghost" disabled={disabled} icon={Trash} aria-label={"Delete " + schema.name} title="Delete custom schema" />} />
			<Dialog size="sm" className="shipit-seo-delete-dialog">
				<Dialog.Title>Delete custom schema?</Dialog.Title>
				<Dialog.Description>{loaded?.state === "saved" ? loaded.schema.name : schema.name} will stop contributing JSON-LD to matching pages.</Dialog.Description>
				{loading ? <p role="status">Loading the saved record...</p> : loaded?.state === "saved" ? <div className="shipit-seo-json-preview"><p>{scopeLabel(loaded.schema.scope)}</p><details><summary>Review saved JSON-LD</summary><pre>{loaded.schema.json}</pre></details></div> : <p role="alert">{loaded?.state === "absent" ? "This schema is no longer saved." : loaded?.state === "invalid" ? "The stored record is invalid. Deleting removes this exact version." : read && !read.success ? read.message : "The saved record could not be loaded."}</p>}
				<div className="shipit-seo-dialog-actions">
					<Dialog.Close render={(props) => <Button {...props} type="button" variant="secondary">Cancel</Button>} />
					<Button type="button" variant="destructive" loading={deleting} disabled={deleteBlocked} onClick={confirmDelete}>Delete</Button>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}

export function SchemaView({
	route,
	onRouteChange,
	mapContext,
	active,
	configuration,
	outputEnabled,
	onSaved,
	onContentTypesSaved,
	onOverviewRefresh,
}: {
	/** "library" while `?view=library` is open; every other tab shares `?view=schema`. */
	route: SchemaWorkspaceRoute;
	onRouteChange: (route: SchemaWorkspaceRoute) => void;
	mapContext: Omit<SchemaMapViewProps, "configuration" | "outputEnabled" | "onOpenDefaults" | "onOpenCustom">;
	active: boolean;
	configuration: SeoAdminSchemaConfiguration;
	/** False while the Schema feature switch is off; nothing configured here is emitted then. */
	outputEnabled: boolean;
	onSaved: (update: (current: SeoAdminSchemaConfiguration) => SeoAdminSchemaConfiguration) => void;
	onContentTypesSaved: (contentTypes: SeoAdminSchemaContentTypeConfiguration) => void;
	onOverviewRefresh: () => Promise<void>;
	onReload: () => Promise<boolean>;
}) {
	const toasts = useSeoToasts();
	const sectionTabsRef = useTablistName<HTMLElement>({ label: "Schema sections" });
	const builderTabsRef = useTablistName<HTMLElement>({ labelledBy: "schema-builder-title" });
	const [section, setSection] = React.useState<SchemaWorkspaceSection>(() => route === "library" ? "library" : "overview");
	const previousSection = React.useRef<Exclude<SchemaWorkspaceSection, "library">>("overview");
	const showSection = (next: SchemaWorkspaceSection) => {
		if (next !== "library") previousSection.current = next;
		setSection(next);
		if (active && schemaWorkspaceRoute(next) !== route) onRouteChange(schemaWorkspaceRoute(next));
	};
	React.useEffect(() => {
		setSection((current) => schemaWorkspaceSectionForRoute(route, current, previousSection.current));
	}, [route]);
	const [builderOpen, setBuilderOpen] = React.useState(false);
	const customHeading = React.useRef<HTMLHeadingElement>(null);
	const defaultsRegion = React.useRef<HTMLDivElement>(null);
	const sectionFocus = React.useRef<"custom" | "defaults" | null>(null);
	const [sectionFocusVersion, setSectionFocusVersion] = React.useState(0);
	const openSchemaSection = (next: "custom" | "defaults") => {
		sectionFocus.current = next;
		showSection(next); setSectionFocusVersion((value) => value + 1);
	};
	React.useEffect(() => {
		if (!active || sectionFocus.current !== section) return;
		const target = section === "custom" ? customHeading.current : defaultsRegion.current;
		if (target) { target.focus(); sectionFocus.current = null; }
	}, [active, section, sectionFocusVersion]);
	const builderHeading = React.useRef<HTMLHeadingElement>(null);
	const addButton = React.useRef<HTMLButtonElement>(null);
	const wasBuilderOpen = React.useRef(false);
	const [builderFocusVersion, setBuilderFocusVersion] = React.useState(0);
	const mutationGate = React.useRef(createSchemaWorkspaceMutationGate()).current;
	const attempt = React.useRef<SchemaWorkspaceAttempt | null>(null);
	const [unconfirmed, setUnconfirmed] = React.useState<string | null>(null);
	const [review, setReview] = React.useState<SchemaWorkspaceReview | null>(null);
	const [reviewedSaved, setReviewedSaved] = React.useState(false);
	const [checkingSaved, setCheckingSaved] = React.useState(false);
	const [transportPending, setTransportPending] = React.useState(false);
	const [loadingSchema, setLoadingSchema] = React.useState(false);
	const [repairRevision, setRepairRevision] = React.useState<string | null>(null);
	const [replacement, setReplacement] = React.useState<{ title: string; apply: () => void } | null>(null);
	const editorBaseline = React.useRef<string | null>(null);
	const [presetState, setPresetState] = React.useState<SchemaWorkspacePresetDraftState>(() => createSchemaWorkspacePresetDraft(configuration.presets));
	const presetDraft = presetState.draft;
	const [presetErrors, setPresetErrors] = React.useState<SeoAdminSchemaPresetErrors>({});
	const [savingPresets, setSavingPresets] = React.useState(false);
	const [restoringPresets, setRestoringPresets] = React.useState(false);
	const [presetMessage, setPresetMessage] = React.useState<string | null>(null);
	const [builderMode, setBuilderMode] = React.useState<"guided" | "raw">("guided");
	const [composer, setComposer] = React.useState<SeoSchemaComposerDraft>(() => newComposerDraft("howTo"));
	const [composerIdentity, setComposerIdentity] = React.useState(() => ({ id: newSchemaWorkspaceId(), expectedRevision: null as string | null }));
	const [composerErrors, setComposerErrors] = React.useState<SeoSchemaComposerErrors>({});
	const [savingComposer, setSavingComposer] = React.useState(false);
	const [composerMessage, setComposerMessage] = React.useState<string | null>(null);
	const [editor, setEditor] = React.useState<SchemaEditorState | null>(null);
	const [schemaErrors, setSchemaErrors] = React.useState<SeoAdminCustomSchemaErrors>({});
	const [savingSchema, setSavingSchema] = React.useState(false);
	const [deletingId, setDeletingId] = React.useState<string | null>(null);
	const [schemaMessage, setSchemaMessage] = React.useState<string | null>(null);
	const savedNote = outputEnabled ? "" : " Not published while Schema output is off.";
	const presetSignature = JSON.stringify(configuration.presets);
	React.useEffect(() => { setPresetState((state) => reconcileSchemaWorkspacePresetDraft(state, configuration.presets)); }, [presetSignature]);
	React.useEffect(() => {
		if (active && builderOpen && section === "custom") builderHeading.current?.focus();
		else if (active && wasBuilderOpen.current && section === "custom") addButton.current?.focus();
		wasBuilderOpen.current = builderOpen;
	}, [active, builderOpen, section, builderFocusVersion]);
	React.useEffect(() => { if (!active) setReplacement(null); if (!active || section !== "defaults") setRepairRevision(null); }, [active, section]);

	const presetsDirty = schemaWorkspacePresetDraftDirty(presetState);
	const presetsChangedElsewhere = schemaWorkspacePresetReviewRequired(presetState, configuration.presets);
	const applicablePresets = configuration.presets.items.filter((item) => presetApplicable(item.key, item.applicable, configuration.contentTypes));
	const enabledPresets = applicablePresets.filter((item) => presetDraft[item.key]).length;
	const editorPreview = React.useMemo(() => previewJson(editor?.values.json ?? ""), [editor?.values.json]);
	const composedDraftInput = React.useMemo(() => seoSchemaComposerDraftInput(composer), [composer]);
	const composerPreview = React.useMemo(() => composeSeoSchema(composedDraftInput), [composedDraftInput]);
	const composerRecipe = SEO_SCHEMA_COMPOSER_RECIPES.find((item) => item.key === composer.input.recipe)!;
	const usedCustomTypes = React.useMemo(() => {
		const counts = new Map<string, number>();
		for (const schema of configuration.customSchemas) for (const type of new Set(schema.types)) counts.set(type, (counts.get(type) ?? 0) + 1);
		return counts;
	}, [configuration.customSchemas]);
	const composerTypeUses = seoSchemaComposerTypeUses(composerRecipe.schemaType, configuration.customSchemas, configuration.presets.items,
		composerIdentity.expectedRevision === null ? null : composerIdentity.id);
	const composerFields = visibleSeoSchemaComposerFields(composer.input.recipe, composer.input.values);
	const busy = savingPresets || restoringPresets || savingComposer || savingSchema || deletingId !== null || transportPending || loadingSchema;
	const composerDirty = schemaComposerDraftDirty(composer, newComposerDraft(composer.input.recipe));
	const editorDirty = editor !== null && JSON.stringify(editor) !== editorBaseline.current;
	const hasBuilderDraft = composerDirty || editor !== null;
	const requestReplacement = (title: string, apply: () => void, dirty: boolean) => {
		if (busy || unconfirmed) return;
		if (dirty) setReplacement({ title, apply }); else apply();
	};
	const resetComposer = (recipe: SeoSchemaComposerRecipe) => {
		setComposer(newComposerDraft(recipe));
		setComposerIdentity({ id: newSchemaWorkspaceId(), expectedRevision: null });
		setComposerErrors({}); setComposerMessage(null);
	};
	const requireReview = (message: string) => {
		mutationGate.markUnconfirmed(); setReviewedSaved(false); setReview(null); setUnconfirmed(message);
	};
	const reportUnconfirmed = (cause: unknown) => {
		if (classifyEntrySchemaRequestError(cause) === "unknown")
			requireReview("The request may still finish or may have completed. Your draft and exact target are kept. Read the saved version before choosing what to do next.");
	};
	const handleFailure = (result: { error: string; message: string }) => {
		if (result.error === "conflict" || result.error === "not_found") requireReview("The saved version changed or was removed. Your draft is kept. Read it before choosing a new save baseline.");
		else if (result.error === "unconfirmed") requireReview("The change is not confirmed. Your draft and exact target are kept. Read the saved version; no write is retried.");
	};
	const runMutation = <T,>(next: SchemaWorkspaceAttempt, request: () => Promise<T>): Promise<T> => {
		attempt.current = captureSchemaWorkspaceAttempt(next);
		mutationGate.beginTransport(); setReviewedSaved(false); setReview(null); setTransportPending(true);
		const pending = Promise.resolve().then(request).finally(() => {
			mutationGate.settleTransport(); setReviewedSaved(false); setTransportPending(false);
		});
		return withEntrySchemaDeadline(() => pending, ENTRY_SCHEMA_DEADLINES.writeMs);
	};
	const loadSchema = async (id: string): Promise<SeoAdminCustomSchemaReadResult> => {
		if (!mutationGate.claim()) return { success: false, error: "unavailable", message: "Finish the current operation before loading another schema." };
		setLoadingSchema(true);
		try { return await withEntrySchemaDeadline(() => fetchSeoAdminCustomSchema(id), ENTRY_SCHEMA_DEADLINES.writeMs); }
		catch (cause) { return { success: false, error: "unavailable", message: cause instanceof Error ? cause.message : "The saved schema could not be read." }; }
		finally { mutationGate.release(); setLoadingSchema(false); }
	};
	const checkSaved = async () => {
		const target = attempt.current;
		if (!target || !mutationGate.beginReview()) return;
		setCheckingSaved(true); setReviewedSaved(false); setReview(null);
		try {
			if (target.kind === "custom") {
				const read = await withEntrySchemaDeadline(() => fetchSeoAdminCustomSchema(target.command.id), ENTRY_SCHEMA_DEADLINES.writeMs);
				if (!read.success) throw new Error(read.message);
				setReview({ kind: "custom", read });
				if (read.state === "saved") onSaved((current) => upsertSchemaWorkspaceCustom(current, read.schema));
				else if (read.state === "absent") onSaved((current) => removeSchemaWorkspaceCustom(current, read.id));
				mutationGate.completeReview(true); setReviewedSaved(true);
			} else {
				const presets = await withEntrySchemaDeadline(() => fetchSeoAdminSchemaPresets(), ENTRY_SCHEMA_DEADLINES.writeMs);
				if (presets.record === "unavailable") throw new Error("The saved presets could not be read.");
				setReview({ kind: "presets", presets });
				onSaved((current) => patchSchemaWorkspacePresets(current, presets));
				mutationGate.completeReview(true); setReviewedSaved(true);
			}
		} catch (cause) {
			mutationGate.completeReview(false);
			setUnconfirmed(cause instanceof Error ? cause.message : "The saved version could not be read. Your draft is kept.");
		} finally { setCheckingSaved(false); }
	};
	const reviewPresets = () => {
		if (busy || unconfirmed) return;
		attempt.current = { kind: "presets", source: "review", command: null };
		requireReview("Review the saved presets before selecting a new baseline. Reading them does not replace your choices.");
		void checkSaved();
	};
	const applyReview = (keepDraft: boolean) => {
		const target = attempt.current;
		if (!review || !target || review.kind !== target.kind) return;
		if (review.kind === "custom" && target.kind === "custom" && review.read.state !== "invalid" && !schemaWorkspaceReviewedIdentity(target.command.id, review.read)) return;
		if (!mutationGate.allowAfterReview()) return;
		if (review.kind === "presets") {
			setPresetState(createSchemaWorkspacePresetDraft(review.presets, keepDraft ? presetDraft : undefined));
		} else if (target.kind === "custom" && target.source !== "delete" && review.read.state !== "invalid") {
			const saved = review.read.state === "saved" ? review.read.schema : null;
			const identity = schemaWorkspaceReviewedIdentity(target.command.id, review.read);
			if (!identity) return;
			if (target.source === "raw") {
				if (keepDraft) setEditor((state) => state?.writeId === target.command.id ? {
					...state, expectedRevision: identity.expectedRevision,
					values: { ...state.values, id: saved?.id },
				} : state);
				else {
					const next = saved ? editorFromSchema(saved, saved.revision) : null;
					editorBaseline.current = next ? JSON.stringify(next) : null; setEditor(next);
					setBuilderMode("raw"); showSection("custom"); setBuilderOpen(next !== null);
				}
			} else if (keepDraft) { setComposerIdentity(identity); setBuilderMode("guided"); setBuilderOpen(true); showSection("custom"); }
			else {
				resetComposer(composer.input.recipe);
				setBuilderOpen(false);
			}
		}
		attempt.current = null; setUnconfirmed(null); setReview(null); setReviewedSaved(false);
		setSchemaErrors({}); setPresetErrors({});
		setSchemaMessage(review.kind === "custom" && review.read.state === "invalid" ? "The stored record is invalid. Your draft is kept without adopting a save baseline." : keepDraft ? "Draft kept. Saving again is a new explicit change." : "Current stored state reviewed.");
	};
	const selectComposerRecipe = (recipe: SeoSchemaComposerRecipe) => requestReplacement("Replace this guided draft?", () => resetComposer(recipe), composerDirty);
	const updateComposerInput = (values: Partial<SeoSchemaComposerDraft["input"]>) => {
		setComposer((state) => ({ ...state, input: { ...state.input, ...values } })); setComposerErrors({}); setComposerMessage(null);
	};
	const updateComposerValue = (key: SeoSchemaComposerFieldKey, value: string) => {
		setComposer((state) => ({ ...state, input: { ...state.input, values: { ...state.input.values, [key]: value } } })); setComposerErrors({}); setComposerMessage(null);
	};
	const openRawEditor = (schema?: SeoAdminCustomSchema | SeoAdminCustomSchemaInput, message: string | null = null) => {
		requestReplacement("Replace this JSON-LD draft?", () => { void (async () => {
			let source = schema;
			let revision: string | null = null;
			if (schema && "valid" in schema) {
				const read = await loadSchema(schema.id);
				if (!read.success || read.state !== "saved") { setSchemaMessage(read.success ? "This schema is missing or invalid. The draft was not replaced." : read.message); return; }
				source = read.schema; revision = read.schema.revision;
			}
			const next = editorFromSchema(source, revision);
			editorBaseline.current = source && !("valid" in source) ? null : JSON.stringify(next);
			showSection("custom"); setBuilderOpen(true); setBuilderFocusVersion((value) => value + 1);
			setBuilderMode("raw"); setEditor(next); setSchemaErrors({}); setSchemaMessage(message);
		})(); }, editorDirty);
	};
	const openTemplateCopy = (template: SchemaLibraryTemplate) => {
		const copy = schemaWorkspaceTemplateCopy(template);
		requestReplacement("Replace the current schema draft?", () => {
			const next = editorFromSchema(copy);
			editorBaseline.current = null;
			setEditor(next); resetComposer(composer.input.recipe);
			setSchemaErrors({}); setSchemaMessage(`Independent copy of "${template.name}". Editing or deleting the template later does not change it. Choose where it applies, review the values, and enable it before saving to publish.`);
			setBuilderMode("raw"); showSection("custom"); setBuilderOpen(true);
			setBuilderFocusVersion((value) => value + 1);
		}, editorDirty || composerDirty);
	};
	const duplicateCustomSchema = (schema: SeoAdminCustomSchema) => openRawEditor(duplicateSeoAdminCustomSchemaInput(schema), "Duplicate opened as a disabled draft. Review it before saving.");
	const refreshOverview = () => { void onOverviewRefresh().catch(() => toasts.error("Change saved; overview refresh unavailable")); };
	const saveComposedSchema = async () => {
		const validation = composeSeoSchema(composedDraftInput);
		if (!validation.success) { setComposerErrors(validation.errors); setComposerMessage(null); return; }
		if (!mutationGate.claim()) return;
		const output = validation.output;
		const command = { id: composerIdentity.id, expectedRevision: composerIdentity.expectedRevision, recipe: output.recipe, schemaName: output.schemaName, scope: output.scope, enabled: output.enabled, values: { ...output.values } };
		setSavingComposer(true); setComposerErrors({}); setComposerMessage(null);
		try {
			const result = await runMutation({ kind: "custom", source: "guided", command }, () => composeSeoAdminSchema(command));
			if (!result.success) { handleFailure(result); setComposerErrors({ ...normalizeComposerErrors(result.errors), _form: result.errors._form ?? result.message }); return; }
			onSaved((current) => upsertSchemaWorkspaceCustom(current, result.schema));
			resetComposer(result.recipe); setBuilderOpen(false);
			setComposerMessage(result.schema.name + " saved." + savedNote); toasts.success("Schema saved", result.schema.name + "." + savedNote); refreshOverview();
		} catch (cause) { reportUnconfirmed(cause); setComposerErrors({ _form: cause instanceof Error ? cause.message : "Schema could not be saved." }); }
		finally { mutationGate.release(); setSavingComposer(false); }
	};
	const savePresets = async (replaceInvalid = false, reviewedRepairRevision?: string) => {
		const validation = validateSeoAdminSchemaPresetValues(presetDraft);
		if (!validation.success) { setPresetErrors(validation.errors); return; }
		if (replaceInvalid && (!reviewedRepairRevision || reviewedRepairRevision !== presetState.revision)) return;
		if ((!presetState.writable && !(replaceInvalid && presetState.record === "invalid")) || !mutationGate.claim()) return;
		const command = { values: { ...validation.values }, expectedRevision: presetState.revision, ...(replaceInvalid ? { replaceInvalid: true as const } : {}) };
		setSavingPresets(true); setPresetErrors({}); setPresetMessage(null);
		try {
			const result = await runMutation({ kind: "presets", source: "save", command }, () => saveSeoAdminSchemaPresets(command));
			if (!result.success) { handleFailure(result); setPresetErrors({ ...result.errors, _form: result.errors._form ?? result.message }); return; }
			onSaved((current) => patchSchemaWorkspacePresets(current, result.presets));
			setPresetState(createSchemaWorkspacePresetDraft(result.presets)); void loadPublisherOwnership();
			setPresetMessage("Schema presets saved." + savedNote); toasts.success("Schema presets saved", savedNote.trim() || undefined); refreshOverview();
		} catch (cause) { reportUnconfirmed(cause); setPresetErrors({ _form: cause instanceof Error ? cause.message : "Presets could not be saved." }); }
		finally { mutationGate.release(); setSavingPresets(false); }
	};
	const restoreInheritedPresets = async () => {
		if (!presetState.writable || !presetState.revision || presetState.record !== "valid" || !mutationGate.claim()) return;
		const command = { expectedRevision: presetState.revision };
		setRestoringPresets(true); setPresetErrors({}); setPresetMessage(null);
		try {
			const result = await runMutation({ kind: "presets", source: "reset", command }, () => resetSeoAdminSchemaPresets(command));
			if (!result.success) { handleFailure(result); setPresetErrors({ ...result.errors, _form: result.errors._form ?? result.message }); return; }
			onSaved((current) => patchSchemaWorkspacePresets(current, result.presets));
			setPresetState(createSchemaWorkspacePresetDraft(result.presets)); void loadPublisherOwnership();
			setPresetMessage("Inherited schema presets restored"); toasts.success("Inherited schema presets restored"); refreshOverview();
		} catch (cause) { reportUnconfirmed(cause); setPresetErrors({ _form: cause instanceof Error ? cause.message : "Presets could not be restored." }); }
		finally { mutationGate.release(); setRestoringPresets(false); }
	};
	const updateEditor = (values: Partial<SchemaEditorState["values"]>) => {
		setEditor((state) => state ? { ...state, values: { ...state.values, ...values } } : state); setSchemaErrors({}); setSchemaMessage(null);
	};
	const saveCustomSchema = async () => {
		if (!editor) return;
		const validation = validateSeoAdminCustomSchemaInput(editorInput(editor));
		if (!validation.success) { setSchemaErrors(validation.errors); return; }
		if (!mutationGate.claim()) return;
		const command = { ...validation.values, id: editor.writeId, expectedRevision: editor.expectedRevision };
		setSavingSchema(true); setSchemaErrors({});
		try {
			const result = await runMutation({ kind: "custom", source: "raw", command }, () => saveSeoAdminCustomSchema(command));
			if (!result.success) { handleFailure(result); setSchemaErrors({ ...result.errors, _form: result.errors._form ?? result.message }); return; }
			onSaved((current) => upsertSchemaWorkspaceCustom(current, result.schema));
			setEditor(null); setBuilderOpen(false); setSchemaMessage(result.schema.name + " saved." + savedNote);
			toasts.success("Custom schema saved", result.schema.name + "." + savedNote); refreshOverview();
		} catch (cause) { reportUnconfirmed(cause); setSchemaErrors({ _form: cause instanceof Error ? cause.message : "Schema could not be saved." }); }
		finally { mutationGate.release(); setSavingSchema(false); }
	};
	const deleteCustomSchema = async (read: SchemaStoredRead): Promise<CustomSchemaDeleteOutcome> => {
		if (read.state === "absent" || !mutationGate.claim()) return "blocked";
		const command = { id: read.id, expectedRevision: read.state === "saved" ? read.schema.revision : read.revision };
		setDeletingId(read.id); setSchemaMessage(null);
		try {
			const result = await runMutation({ kind: "custom", source: "delete", command }, () => deleteSeoAdminCustomSchema(command));
			if (!result.success) { handleFailure(result); setSchemaMessage(result.message); return customSchemaDeleteFailure(result.error); }
			onSaved((current) => removeSchemaWorkspaceCustom(current, read.id));
			if (editor?.writeId === read.id && !editorDirty) setEditor(null);
			setSchemaMessage("Custom schema deleted"); toasts.success("Custom schema deleted"); refreshOverview();
			return "deleted";
		} catch (cause) {
			reportUnconfirmed(cause); setSchemaMessage(cause instanceof Error ? cause.message : "Schema could not be deleted.");
			return classifyEntrySchemaRequestError(cause) === "unknown" ? "unknown" : "failed";
		}
		finally { mutationGate.release(); setDeletingId(null); }
	};

	return (
		<>
			{!outputEnabled ? (
				<Banner
					variant="alert"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title="Schema output is off"
					description="The Schema switch in Feature controls is off, so no preset or custom schema on this page is published. Changes saved here apply once it is turned back on."
				/>
			) : null}

			<section className="shipit-seo-panel shipit-seo-schema-workspace-intro" aria-labelledby="schema-workspace-title">
				<div className="shipit-seo-section-heading">
					<div><span className="shipit-seo-eyebrow">Structured data</span><h2 id="schema-workspace-title">Schema</h2></div>
					<div className="shipit-seo-schema-workspace-actions">
						<Button ref={addButton} type="button" variant={section === "library" ? "secondary" : "primary"} icon={hasBuilderDraft ? undefined : Plus} disabled={busy} onClick={() => { if (builderMode === "raw" && !editor && composerDirty) setBuilderMode("guided"); else if (builderMode === "guided" && !composerDirty && editor !== null) setBuilderMode("raw"); showSection("custom"); setBuilderOpen(true); setBuilderFocusVersion((value) => value + 1); }}>{hasBuilderDraft ? "Resume draft" : "Add schema"}</Button>
					</div>
				</div>
				<p className="shipit-seo-muted">See your site-wide schema setup, manage content type defaults, and keep reusable templates in the library.</p>
				<nav ref={sectionTabsRef} aria-label="Schema sections"><Tabs variant="segmented" {...WRAPPING_TABS} tabs={[{ value: "overview", label: "Schema map" }, { value: "custom", label: "Custom schemas" }, { value: "library", label: "Library" }, { value: "defaults", label: presetsDirty ? "Defaults · unsaved" : "Defaults" }]} value={section} onValueChange={(value) => { if (value === "overview" || value === "custom" || value === "library" || value === "defaults") showSection(value); }} /></nav>
			</section>
			<div className="shipit-seo-schema-pane" hidden={section !== "library"}>
				{active && section === "library" ? (
					<SeoViewBoundary resetKey="schema-library"><SchemaLibraryView onUseTemplate={openTemplateCopy} /></SeoViewBoundary>
				) : null}
			</div>
			<div className="shipit-seo-schema-pane" hidden={section !== "overview"}>
				<SchemaMapView {...mapContext} configuration={configuration} outputEnabled={outputEnabled} onOpenDefaults={() => openSchemaSection("defaults")} onOpenCustom={() => openSchemaSection("custom")} />
			</div>
			{unconfirmed ? <Banner variant="alert" title="Review saved version" description={review && reviewedSaved ? "Current stored state is ready to review. Your draft is kept. Choose how to continue below." : unconfirmed} action={<Button type="button" variant="secondary" loading={checkingSaved} disabled={busy || checkingSaved} onClick={() => void checkSaved()}>Read saved version</Button>} /> : null}
			{review && reviewedSaved ? (
				<section className="shipit-seo-panel shipit-seo-schema-review" aria-label="Saved version review">
					<h3>Stored now</h3>
					<p className="shipit-seo-muted">This read shows the current state. It does not prove which earlier request wrote it. Your draft has not been replaced.</p>
					{review.kind === "custom" ? review.read.state === "saved" ? (
						<div className="shipit-seo-json-preview"><strong>{review.read.schema.name}</strong><p>{schemaWorkspaceScopeLabel(review.read.schema.scope, configuration.contentTypes)} · {review.read.schema.enabled ? "Enabled" : "Disabled"}</p><details><summary>Review saved JSON-LD</summary><pre>{review.read.schema.json}</pre></details></div>
					) : <p>{review.read.state === "absent" ? "No record is currently saved for this exact identifier." : "The stored record is invalid. Its revision is known, but its values cannot be used as a save baseline."}</p> : (
						<div><p>{review.presets.record === "invalid" ? "The stored presets are invalid. Keep your choices to prepare an explicitly confirmed repair." : review.presets.record === "absent" ? "No preset snapshot is saved. These are the current inherited choices." : "Current saved preset choices:"}</p>{review.presets.record !== "invalid" ? <ul>{review.presets.items.filter((item) => item.enabled).map((item) => <li key={item.key}>{item.label}</li>)}</ul> : null}</div>
					)}
					<div className="shipit-seo-schema-workspace-actions">
						{review.kind === "custom" && (attempt.current?.source === "delete" || review.read.state === "invalid") ? (
							<Button type="button" variant="secondary" disabled={busy || checkingSaved} onClick={() => applyReview(false)}>Close review</Button>
						) : review.kind === "presets" && review.presets.record === "invalid" ? (
							<Button type="button" variant="secondary" disabled={busy || checkingSaved} onClick={() => applyReview(true)}>Keep choices for repair</Button>
						) : <>
							<Button type="button" variant="secondary" disabled={busy || checkingSaved} onClick={() => applyReview(false)}>Use stored {review.kind === "custom" ? "schema" : "choices"}</Button>
							<Button type="button" variant="secondary" disabled={busy || checkingSaved} onClick={() => applyReview(true)}>Keep my draft for a new save</Button>
						</>}
					</div>
				</section>
			) : null}

			<div className="shipit-seo-schema-pane" hidden={section !== "custom"}>
			<section className="shipit-seo-panel shipit-seo-custom-schema-panel" aria-labelledby="custom-schema-title">
				<div className="shipit-seo-section-heading">
					<div>
						<span className="shipit-seo-eyebrow">Custom contributions</span>
						<h2 id="custom-schema-title" ref={customHeading} tabIndex={-1}>Saved custom schemas</h2>
					</div>
					<Badge variant="secondary">{configuration.customSchemas.length} saved</Badge>
				</div>
				{schemaMessage ? <p className="shipit-seo-inline-message" aria-live="polite">{schemaMessage}</p> : null}
				{configuration.hasMore ? (
					<Banner variant="alert" title="Only the first 100 schemas are shown" description="Narrow the schema set before editing additional records." />
				) : null}
				{configuration.customSchemas.length ? (
					<div className="shipit-seo-custom-schema-list">
						{configuration.customSchemas.map((schema) => (
							<div key={schema.id} className={`shipit-seo-custom-schema-row ${schema.valid ? "" : "shipit-seo-custom-schema-row--invalid"}`}>
								<span className="shipit-seo-module-icon"><FileCode size={19} aria-hidden="true" /></span>
								<div className="shipit-seo-custom-schema-copy">
									<div>
										<strong>{schema.name}</strong>
										<Badge variant={schema.valid ? (schema.enabled ? "success" : "secondary") : "error"}>
											{schema.valid ? (schema.enabled ? (outputEnabled ? "Saved · enabled" : "Saved · output off") : "Saved · disabled") : "Needs repair"}
										</Badge>
									</div>
									<p>{schemaWorkspaceScopeLabel(schema.scope, configuration.contentTypes)}</p>
									{scopeRepeatsEntity(schema) ? (
										<span className="shipit-seo-form-error">
											Its fixed values repeat on every page this scope matches. Edit it to apply to one entry.
										</span>
									) : null}
									<div className="shipit-seo-schema-types">
										{schema.types.length ? schema.types.map((type) => <Badge key={type} variant="secondary">{type}</Badge>) : <span>No @type detected</span>}
									</div>
									{schema.validationError ? <span className="shipit-seo-form-error">{schema.validationError}</span> : null}
								</div>
								<time dateTime={schema.updatedAt}>{readableDate(schema.updatedAt)}</time>
								<div className="shipit-seo-row-actions">
									<Button
										type="button"
										shape="square"
										size="sm"
										variant="ghost"
										icon={PencilSimple}
										aria-label={`Edit ${schema.name}`}
										title="Edit custom schema"
										disabled={busy || unconfirmed !== null}
										onClick={() => openRawEditor(schema)}
									/>
									<Button
										type="button"
										shape="square"
										size="sm"
										variant="ghost"
										icon={CopySimple}
										aria-label={`Duplicate ${schema.name}`}
										title="Duplicate as disabled draft"
										disabled={busy || unconfirmed !== null}
										onClick={() => duplicateCustomSchema(schema)}
									/>
									<CustomSchemaDelete active={active && section === "custom"} schema={schema} disabled={busy || unconfirmed !== null} deleting={deletingId === schema.id} onLoad={() => loadSchema(schema.id)} onDelete={deleteCustomSchema}
										scopeLabel={(scope) => schemaWorkspaceScopeLabel(scope, configuration.contentTypes)} />
								</div>
							</div>
						))}
					</div>
				) : (
					<div className="shipit-seo-schema-empty">
						<FileCode size={24} aria-hidden="true" />
						<div><h3>No custom schemas yet</h3><p>Add a schema when the content needs information beyond your content-type defaults.</p></div>
					</div>
				)}
			</section>
			<div className="shipit-seo-schema-pane" hidden={!builderOpen}>
			<section ref={builderTabsRef} className="shipit-seo-panel shipit-seo-schema-builder" aria-labelledby="schema-builder-title">
				<div className="shipit-seo-section-heading">
					<div>
						<span className="shipit-seo-eyebrow">Custom graph</span>
						<h2 id="schema-builder-title" ref={builderHeading} tabIndex={-1}>Schema draft</h2>
					</div>
					<Button type="button" variant="secondary" disabled={busy} onClick={() => setBuilderOpen(false)}>Close builder</Button>
				</div>
				<Tabs
					variant="segmented"
					{...WRAPPING_TABS}
					tabs={[
						{ value: "guided", label: "Guided builder" },
						{ value: "raw", label: "Raw JSON-LD" },
					]}
					value={builderMode}
					onValueChange={(value) => {
						if (value === "guided" || value === "raw") setBuilderMode(value);
					}}
				/>

				<p className="shipit-seo-muted">This draft stays here while you move between workspace views. Refreshing or leaving the workspace can discard it. Saving an enabled schema can change published pages immediately.</p>
				<fieldset className="shipit-seo-schema-fieldset" disabled={busy || unconfirmed !== null}>
				{builderMode === "guided" ? (
					<form className="shipit-seo-composer" onSubmit={(event) => { event.preventDefault(); void saveComposedSchema(); }}>
						<SchemaTypePicker
							value={composer.input.recipe}
							usedTypes={usedCustomTypes}
							disabled={busy || unconfirmed !== null}
							onChoose={(recipe) => recipe !== composer.input.recipe && selectComposerRecipe(recipe)}
						/>

						<div className="shipit-seo-composer-heading">
							<div>
								<h3>Compose {composerRecipe.label}</h3>
								<p>{composerRecipe.description}</p>
							</div>
							<Switch
								label="Enable after saving"
								controlFirst={false}
								checked={composer.input.enabled}
								disabled={savingComposer}
								onCheckedChange={(enabled) => updateComposerInput({ enabled })}
							/>
						</div>
						{composerTypeUses.customs.length || composerTypeUses.defaults.length ? (
							<Banner
								variant="secondary"
								icon={<WarningCircle size={20} aria-hidden="true" />}
								title={`${composerRecipe.label} is already in use`}
								description={[
									composerTypeUses.customs.length ? `Saved custom schemas: ${composerTypeUses.customs.slice(0, 3).join(", ")}${composerTypeUses.customs.length > 3 ? ` and ${composerTypeUses.customs.length - 3} more` : ""}.` : "",
									composerTypeUses.defaults.length ? `The ${composerTypeUses.defaults[0]} default is on and adds this type where a page has its data.` : "",
									`This may add another ${composerRecipe.schemaType} graph; existing schemas are not replaced or merged.`,
								].filter(Boolean).join(" ")}
							/>
						) : null}

						<div className="shipit-seo-composer-meta">
							<Input
								label="Internal schema name"
								description="Used only to identify this record in the admin."
								value={composer.input.schemaName}
								aria-required="true"
								maxLength={120}
								error={composerErrors.schemaName}
								onChange={(event) => updateComposerInput({ schemaName: event.target.value })}
							/>
							<SchemaScopeFields
							contentTypes={configuration.contentTypes}
								value={composer.scope}
								error={composerErrors.scope}
								modes={composerRecipe.scopes}
								description={composerScopeDescription(composerRecipe.scopes)}
								onChange={(scope) => {
									setComposer((state) => ({ ...state, scope }));
									setComposerErrors({});
									setComposerMessage(null);
								}}
							/>
						</div>

						<div className="shipit-seo-composer-fields">
							{composerFields.map((field) => {
								const value = String(composer.input.values[field.key] ?? "");
								const label = `${field.label}${field.required ? " *" : ""}`;
								if (field.options?.length) {
									return (
										<div key={field.key} className="shipit-seo-composer-select">
											<Select<string>
												label={label}
												value={value}
												onValueChange={(next) => next !== null && updateComposerValue(field.key, next)}
												items={Object.fromEntries([
													...(!field.required ? [["", "Not set"]] : []),
													...field.options.map((option) => [option.value, option.label]),
												])}
											/>
											<p>{field.description}</p>
											{composerErrors[field.key] ? <span className="shipit-seo-form-error">{composerErrors[field.key]}</span> : null}
										</div>
									);
								}
								if (field.multiline) {
									return (
										<Textarea
											key={field.key}
											className="shipit-seo-composer-field--wide"
											label={label}
											description={field.description}
											placeholder={field.placeholder}
											value={value}
											aria-required={field.required || undefined}
											rows={field.key === "steps" ? 6 : 4}
											error={composerErrors[field.key]}
											onChange={(event) => updateComposerValue(field.key, event.target.value)}
										/>
									);
								}
								return (
									<Input
										key={field.key}
										label={label}
										description={field.description}
										placeholder={field.placeholder}
										value={value}
										aria-required={field.required || undefined}
										error={composerErrors[field.key]}
										onChange={(event) => updateComposerValue(field.key, event.target.value)}
									/>
								);
							})}
						</div>

						<div className="shipit-seo-json-preview shipit-seo-composer-preview">
							<div>
								<strong>Draft JSON-LD</strong>
								<Badge variant={composerPreview.success ? "success" : "secondary"}>
									{composerPreview.success ? composerRecipe.schemaType : "Draft incomplete"}
								</Badge>
							</div>
							{composerPreview.success ? (
								<pre>{composerPreview.output.json}</pre>
							) : (
								<p>Complete the required fields to generate draft JSON-LD. This does not inspect a public page.</p>
							)}
						</div>
						{composerErrors._form ? <p className="shipit-seo-form-error">{composerErrors._form}</p> : null}
						{composerMessage ? <p className="shipit-seo-inline-message" aria-live="polite">{composerMessage}</p> : null}
						<div className="shipit-seo-schema-editor-actions">
							<Button
								type="button"
								variant="secondary"
								icon={ArrowCounterClockwise}
								disabled={savingComposer}
								onClick={() => selectComposerRecipe(composer.input.recipe)}
							>
								Reset recipe
							</Button>
							<Button type="submit" variant="primary" loading={savingComposer} disabled={savingComposer}>
								Save schema
							</Button>
						</div>
					</form>
				) : editor ? (
					<form className="shipit-seo-schema-editor shipit-seo-schema-editor--embedded" onSubmit={(event) => { event.preventDefault(); void saveCustomSchema(); }}>
						<div className="shipit-seo-section-heading">
							<div>
								<span className="shipit-seo-eyebrow">{editor.values.id ? "Edit snippet" : "New snippet"}</span>
								<h2>{editor.values.id ? "Custom schema" : "Add custom schema"}</h2>
							</div>
							<Switch
								label="Enabled"
								controlFirst={false}
								checked={editor.values.enabled}
								disabled={savingSchema}
								onCheckedChange={(enabled) => updateEditor({ enabled })}
							/>
						</div>
						{schemaMessage ? <p className="shipit-seo-inline-message" aria-live="polite">{schemaMessage}</p> : null}
						<Input
							label="Name"
							value={editor.values.name}
							aria-required="true"
							maxLength={120}
							error={schemaErrors.name}
							onChange={(event) => updateEditor({ name: event.target.value })}
						/>
						<SchemaScopeFields
							contentTypes={configuration.contentTypes}
							value={{ mode: editor.scopeMode, collection: editor.collection, entry: editor.entry }}
							error={schemaErrors.scope}
							onChange={(scope) => {
								setEditor((state) => state ? {
									...state,
									scopeMode: scope.mode,
									collection: scope.collection,
									entry: scope.entry,
								} : state);
								setSchemaErrors({});
							}}
						/>
						<Textarea
							label="JSON-LD"
							description="Advanced data-only JSON-LD. Scripts and duplicate entity identifiers are rejected."
							value={editor.values.json}
							aria-required="true"
							rows={14}
							error={schemaErrors.json}
							onChange={(event) => updateEditor({ json: event.target.value })}
						/>
						<div className="shipit-seo-json-preview">
							<div>
								<strong>Parsed draft JSON-LD</strong>
								<div className="shipit-seo-schema-types">
									{editorPreview.types.map((type) => <Badge key={type} variant="secondary">{type}</Badge>)}
								</div>
							</div>
							{editorPreview.error ? <p className="shipit-seo-form-error">{editorPreview.error}</p> : null}
							{editorPreview.formatted ? <pre>{editorPreview.formatted}</pre> : null}
						</div>
						{schemaErrors._form ? <p className="shipit-seo-form-error">{schemaErrors._form}</p> : null}
						<div className="shipit-seo-schema-editor-actions">
							<Button type="button" variant="secondary" disabled={savingSchema} onClick={() => requestReplacement("Discard this JSON-LD draft?", () => { setEditor(null); setSchemaErrors({}); setBuilderOpen(false); }, editorDirty)}>
								Discard draft
							</Button>
							<Button type="submit" variant="primary" loading={savingSchema} disabled={savingSchema}>
								Save schema
							</Button>
						</div>
					</form>
				) : (
					<div className="shipit-seo-raw-schema-empty">
						<span className="shipit-seo-module-icon"><BracketsCurly size={20} aria-hidden="true" /></span>
						<div>
							<h3>Write advanced JSON-LD</h3>
							<p>Use this editor for supported schema types that are not yet available as guided recipes.</p>
						</div>
						<Button type="button" variant="secondary" icon={Plus} onClick={() => openRawEditor()}>
							Open raw editor
						</Button>
					</div>
				)}
				</fieldset>
			</section>

			</div>
			</div>
			<div className="shipit-seo-schema-pane" hidden={section !== "defaults"} ref={defaultsRegion} role="region" aria-label="Schema defaults" tabIndex={-1}>
			<ContentTypeSchemaPanel
				active={active && section === "defaults"}
				configuration={configuration}
				outputEnabled={outputEnabled}
				onContentTypesSaved={onContentTypesSaved}
				onOverviewRefresh={onOverviewRefresh}
			/>
			{configuration.presets.migrationNeeded ? (
				<Banner
					variant="alert"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title="Inherited schema presets are active"
					description="Saving creates a versioned snapshot from the currently resolved legacy choices and safe plugin defaults. Legacy data remains available as rollback evidence."
				/>
			) : null}
			<form className="shipit-seo-panel shipit-seo-preset-panel" onSubmit={(event) => { event.preventDefault(); void savePresets(); }}>
				{presetsChangedElsewhere ? <Banner variant="alert" title="Saved presets changed" description="Your reviewed version and choices are kept. Read the saved version before choosing a new baseline." action={<Button type="button" variant="secondary" disabled={busy || unconfirmed !== null} onClick={reviewPresets}>Review saved presets</Button>} /> : null}
				{configuration.presets.record === "unavailable" ? <Banner variant="error" title="Presets unavailable" description="The stored presets could not be read. No save or reset is allowed." action={<Button type="button" variant="secondary" disabled={busy || unconfirmed !== null} onClick={reviewPresets}>Read saved presets</Button>} /> : null}
				{presetState.record === "invalid" ? <Banner variant="alert" title="Stored presets are invalid" description="The stored choices cannot be read. Prepare the choices below, then review an explicit replacement. No repair happens automatically." /> : null}
				<p className="shipit-seo-muted">These switches allow automatic contributions when a page supplies the required data. Saving can change published pages immediately.</p>
				<fieldset className="shipit-seo-schema-fieldset" disabled={busy || unconfirmed !== null || configuration.presets.record === "unavailable"}>

				<div className="shipit-seo-section-heading">
					<div>
						<span className="shipit-seo-eyebrow">Automatic contributions</span>
						<h2>Built-in schemas</h2>
					</div>
					<Badge variant={presetsDirty ? "warning" : "secondary"}>
						{enabledPresets} selected
					</Badge>
				</div>
				<div className="shipit-seo-preset-groups">
					{PRESET_GROUPS.map((group) => {
						const items = applicablePresets.filter((item) => item.group === group.key);
						if (!items.length) return null;
						const active = items.filter((item) => presetDraft[item.key]).length;
						return (
							<section key={group.key} className="shipit-seo-preset-group" aria-labelledby={`schema-group-${group.key}`}>
								<header>
									<div>
										<h3 id={`schema-group-${group.key}`}>{group.label}</h3>
										<p>{group.description}</p>
									</div>
									<span>{active}/{items.length} selected</span>
								</header>
								<div className="shipit-seo-preset-list">
									{items.map((item) => {
										const Icon = PRESET_ICONS[item.key];
										return (
											<div key={item.key} className="shipit-seo-preset-row">
												<span className="shipit-seo-module-icon"><Icon size={19} aria-hidden="true" /></span>
												<div>
													<strong>{item.label}</strong>
													<p>{item.description}</p>
													<details className="shipit-seo-schema-requirements"><summary>When this applies</summary><p>{item.scope}</p><PresetRequirements presetKey={item.key} contentTypes={configuration.contentTypes} /></details>
													{presetErrors[item.key] ? <span className="shipit-seo-form-error">{presetErrors[item.key]}</span> : null}
												</div>
												<div className="shipit-seo-preset-meta">

													{item.emission === "data-required" ? <Badge variant="secondary">Data required</Badge> : null}
												</div>
												<Switch
													aria-label={item.label}
													checked={presetDraft[item.key]}
											disabled={savingPresets || restoringPresets}
													onCheckedChange={(checked) => {
														setPresetState((state) => ({ ...state, draft: { ...state.draft, [item.key]: checked } }));
														setPresetMessage(null);
													}}
												/>
											</div>
										);
									})}
								</div>
							</section>
						);
					})}
				</div>
				{presetErrors._form ? <p className="shipit-seo-form-error">{presetErrors._form}</p> : null}
				{presetState.record === "invalid" ? <div className="shipit-seo-settings-actions"><p>Replacing discards unreadable stored choices and can change published pages.</p><Button type="button" variant="primary" disabled={!presetState.revision || busy} onClick={() => setRepairRevision(presetState.revision)}>Review preset replacement</Button></div> : <ConfigurationActions
					active={active && section === "defaults"}
					dirty={presetsDirty}
					saving={savingPresets}
					restoring={restoringPresets}
					message={presetMessage}
					updatedAt={configuration.presets.updatedAt}
					onReset={() => requestReplacement("Discard preset changes?", () => { setPresetState((state) => ({ ...state, draft: state.baseline })); setPresetErrors({}); setPresetMessage(null); }, presetsDirty)}
					onRestore={restoreInheritedPresets}
					canRestore={presetState.record === "valid" && presetState.writable && presetState.revision !== null}
					restoreTitle="Restore inherited schema presets?"
					restoreDescription="The versioned preset snapshot will be removed. Legacy preset choices and safe plugin defaults will become active again."
					saveLabel="Save presets"
				/>}
				</fieldset>
			</form>

			</div>

			<Dialog.Root role="alertdialog" open={active && section === "defaults" && repairRevision !== null} onOpenChange={(open) => { if (!open) setRepairRevision(null); }}>
				<Dialog size="sm" className="shipit-seo-delete-dialog"><Dialog.Title>Replace invalid presets?</Dialog.Title><Dialog.Description>The unreadable saved choices will be replaced with the selections shown. This can change published pages. Other settings and custom schemas stay intact.</Dialog.Description><div className="shipit-seo-dialog-actions"><Button type="button" variant="secondary" onClick={() => setRepairRevision(null)}>Cancel</Button><Button type="button" variant="destructive" disabled={busy || unconfirmed !== null} onClick={() => { const revision = repairRevision; setRepairRevision(null); if (revision) void savePresets(true, revision); }}>Replace presets</Button></div></Dialog>
			</Dialog.Root>

			<Dialog.Root open={active && replacement !== null} onOpenChange={(open) => { if (!open) setReplacement(null); }}>
				<Dialog size="sm" className="shipit-seo-delete-dialog"><Dialog.Title>{replacement?.title ?? "Discard draft?"}</Dialog.Title><Dialog.Description>Your unsaved input will be replaced. Saved schemas and templates will stay unchanged.</Dialog.Description><div className="shipit-seo-dialog-actions"><Button type="button" variant="secondary" onClick={() => setReplacement(null)}>Keep draft</Button><Button type="button" variant="destructive" disabled={busy || unconfirmed !== null} onClick={() => { const change = replacement; setReplacement(null); change?.apply(); }}>{replacement?.title.startsWith("Discard") ? "Discard draft" : "Replace draft"}</Button></div></Dialog>
			</Dialog.Root>

		</>
	);
}
