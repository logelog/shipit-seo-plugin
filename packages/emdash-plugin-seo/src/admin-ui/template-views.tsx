import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Input, Textarea } from "@cloudflare/kumo/components/input";
import { Select } from "@cloudflare/kumo/components/select";
import {
	ArrowCounterClockwise,
	Browser,
	CheckCircle,
	ImageSquare,
	ShareNetwork,
	WarningCircle,
} from "@phosphor-icons/react";
import {
	type SeoAdminEntryPreview,
	type SeoAdminTemplateField,
	type SeoAdminTemplateItem,
	type SeoAdminTemplatePreview,
	validateSeoAdminTemplateValues,
} from "@shipitseo/emdash-plugin-seo/admin-contract";
import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import {
	fetchSeoAdminTemplateExample,
	fetchSeoAdminTemplateExamples,
	previewSeoAdminTemplate,
	resetSeoAdminTemplate,
	saveSeoAdminTemplate,
} from "./api.ts";
import { withEntrySchemaDeadline } from "./entry-schema-model.ts";
import {
	TEMPLATE_FIELDS,
	canResetTemplate,
	canSaveTemplate,
	currentTemplatePreview,
	nextTemplateStamp,
	runTemplatePreview,
	runTemplateReset,
	runTemplateSave,
	templateConflictResolvable,
	templateDraftDirty,
	templateFormValues,
	templateReadToRequest,
	templatesStore,
	type TemplateExampleTarget,
	type TemplatePreviewRequest,
	type TemplatesPort,
	type TemplatesRead,
} from "./metadata-templates-model.ts";
import {
	IDLE_TEMPLATE_EXAMPLE_LOOKUP,
	resolveTemplateExampleSelection,
	templateExampleLookup,
	templateExampleQueryPolicy,
	templateExampleTarget,
	type TemplateExampleSelection,
} from "./template-example-selection-model.ts";
import { seoWorkspaceKeys, type SeoSettingSearchId } from "./workspace-model.ts";
import { SettingsActionBar } from "./settings-action-bar.tsx";
import {
	TEMPLATE_DEFAULT_INSERT_FIELD,
	insertTemplateVariable,
	templateFieldExamples,
	templateTypeLabel,
	templateTypePickerMode,
} from "./template-editor-model.ts";

function sourceLabel(
	source: SeoAdminEntryPreview["sources"][keyof SeoAdminEntryPreview["sources"]],
) {
	if (source === "legacy-override") return "Legacy override";
	if (source === "core-seo") return "Entry SEO";
	if (source === "site-default") return "Site default";
	return source[0].toUpperCase() + source.slice(1);
}

/** A plain count: search engines set no title or description length, so no range is judged here. */
function lengthLabel(field: "Title" | "Description", length: number) {
	return `${field}: ${length} ${length === 1 ? "character" : "characters"}`;
}

function domainLabel(value: string) {
	try {
		return new URL(value).hostname;
	} catch {
		return value || "Public URL unavailable";
	}
}

// An entry value hides the template; show what the template would produce.
function UnusedTemplateValue({
	source,
	value,
	fallback,
}: {
	source: string;
	value: string;
	fallback?: string;
}) {
	if ((source !== "core-seo" && source !== "legacy-override") || !fallback || fallback === value) return null;
	return (
		<small className="shipit-seo-muted">
			Template value, not used while the entry value is set: {fallback}
		</small>
	);
}

function SocialPreviewImage({ src }: { src: string | null }) {
	const [failed, setFailed] = React.useState(false);
	React.useEffect(() => setFailed(false), [src]);
	if (!src || failed) {
		return (
			<div className="shipit-seo-card-placeholder">
				<ImageSquare size={30} aria-hidden="true" />
				{src ? "Social image unavailable" : "No plugin social image; EmDash's default image applies if set"}
			</div>
		);
	}
	return <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export function TemplatePreview({
	preview,
	loading,
}: {
	preview: SeoAdminEntryPreview | null;
	loading: boolean;
}) {
	if (loading && !preview) {
		return (
			<div className="shipit-seo-template-loading" role="status">
				Resolving entry metadata…
			</div>
		);
	}
	if (!preview) {
		return (
			<Empty
				size="sm"
				icon={<Browser size={32} aria-hidden="true" />}
				title="Choose content to preview"
				description="The preview resolves template values for search and social metadata. The theme controls the browser title."
			/>
		);
	}
	return (
		<div
			className={`shipit-seo-entry-preview${loading ? " shipit-seo-entry-preview--loading" : ""}`}
		>
			<div className="shipit-seo-preview-heading">
				<div>
					<strong>{preview.content.title}</strong>
					<span>{preview.content.collectionLabel}</span>
				</div>
				<Badge variant={preview.indexable ? "success" : "error"}>
					{preview.indexable ? "Indexable" : "Noindex"}
				</Badge>
			</div>

			<section className="shipit-seo-serp-preview" aria-label="Search metadata preview">
				<div className="shipit-seo-preview-label">
					<Browser size={16} aria-hidden="true" /> Search metadata preview
				</div>
				<span className="shipit-seo-serp-domain">{domainLabel(preview.search.url)}</span>
				<strong>{preview.search.title || "SEO title missing"}</strong>
				<p>The title is an SEO suggestion. The site's theme sets the published page title.</p>
				<p>{preview.search.description || "Meta description missing"}</p>
				<div className="shipit-seo-preview-metrics">
					<Badge variant="secondary">{lengthLabel("Title", preview.search.titleLength)}</Badge>
					<Badge variant="secondary">{lengthLabel("Description", preview.search.descriptionLength)}</Badge>
				</div>
			</section>

			<section className="shipit-seo-card-preview" aria-label="Social card preview">
				<div className="shipit-seo-preview-label">
					<ShareNetwork size={16} aria-hidden="true" /> Social card
				</div>
				<SocialPreviewImage src={preview.social.image} />
				<div className="shipit-seo-card-copy">
					<span>{domainLabel(preview.search.url)}</span>
					<strong>{preview.social.title || "Social title missing"}</strong>
					<p>{preview.social.description || "Social description missing"}</p>
				</div>
			</section>

			<dl className="shipit-seo-source-grid">
				<div>
					<dt>Search title</dt>
					<dd>
						{sourceLabel(preview.sources.title)}
						<UnusedTemplateValue
							source={preview.sources.title}
							value={preview.search.title}
							fallback={preview.search.fallbackTitle}
						/>
					</dd>
				</div>
				<div>
					<dt>Description</dt>
					<dd>
						{sourceLabel(preview.sources.description)}
						<UnusedTemplateValue
							source={preview.sources.description}
							value={preview.search.description}
							fallback={preview.search.fallbackDescription}
						/>
					</dd>
				</div>
				<div>
					<dt>Social title</dt>
					<dd>{sourceLabel(preview.sources.socialTitle)}</dd>
				</div>
				<div>
					<dt>Social description</dt>
					<dd>{sourceLabel(preview.sources.socialDescription)}</dd>
				</div>
				<div>
					<dt>Canonical</dt>
					<dd>{sourceLabel(preview.sources.canonical)}</dd>
				</div>
				<div>
					<dt>Image</dt>
					<dd>{sourceLabel(preview.sources.image)}</dd>
				</div>
			</dl>
			{preview.schemaTypes.length ? (
				<div className="shipit-seo-preview-schema">
					<span>Schema</span>
					<div>
						{preview.schemaTypes.map((type) => (
							<Badge key={type} variant="secondary">
								{type}
							</Badge>
						))}
				</div>
				</div>
			) : null}
		</div>
	);
}

const EXAMPLES_PAGE_SIZE = 25;

function ownerLabel(item: SeoAdminTemplateItem): string {
	if (item.source === "override") return "Own template";
	return item.source === "legacy" ? "Inherited: older saved values" : "Inherited: built-in defaults";
}

function inheritedSourceLabel(source: "legacy" | "default"): string {
	return source === "legacy" ? "older saved values kept from an earlier version" : "this plugin's built-in defaults";
}

function previewSourceLabel(source: string): string {
	switch (source) {
		case "template":
			return "This template";
		case "core-seo":
			return "Entry SEO (wins over the template)";
		case "legacy-override":
			return "Older entry override (wins over the template)";
		case "plugin-social-override":
			return "Entry social override (wins over the template)";
		case "content":
			return "The entry's own content";
		case "site-default":
			return "Site default";
		default:
			return "Generated";
	}
}

const TEMPLATE_SETTING_IDS = {
	title: "titleTemplate",
	description: "descriptionTemplate",
	socialTitle: "socialTitleTemplate",
	socialDescription: "socialDescriptionTemplate",
} as const satisfies Record<SeoAdminTemplateField, SeoSettingSearchId>;

const FIELD_LABELS: Record<SeoAdminTemplateField, string> = {
	title: "SEO title suggestion",
	description: "Meta description",
	socialTitle: "Social title",
	socialDescription: "Social description",
};

function PreviewTag({ label, tags, field }: { label: string; tags: string; field: SeoAdminTemplatePreview["description"] }) {
	return (
		<div className="shipit-seo-template-tag">
			<dt>
				{label} <code>{tags}</code>
			</dt>
			<dd>
				{field.value ? <p>{field.value}</p> : <p className="shipit-seo-muted">Empty, so this tag is not emitted.</p>}
				<small className="shipit-seo-muted">Source: {previewSourceLabel(field.source)}</small>
			</dd>
		</div>
	);
}

function TemplateMetadataPreview({
	view,
	example,
}: {
	view: ReturnType<typeof currentTemplatePreview>;
	example: TemplateExampleTarget | null;
}) {
	if (!example) return null;
	if (view.kind === "none") {
		return <p className="shipit-seo-template-intro">Press Preview to resolve the form against this published entry. Nothing is sent while you type.</p>;
	}
	if (view.kind === "pending") {
		return <div className="shipit-seo-template-loading" role="status">Resolving the published entry...</div>;
	}
	if (view.kind === "stale") {
		return (
			<p className="shipit-seo-template-intro" role="status">
				The form or the example changed since the last preview. Press Preview to see the current values.
			</p>
		);
	}
	const outcome = view.outcome;
	if (outcome.kind === "failed") return <p className="shipit-seo-form-error" role="alert">{outcome.message}</p>;
	const result = outcome.result;
	if (!result.success) {
		const message = result.error === "invalid_values"
			? Object.values(result.errors)[0] ?? "Fix the template fields."
			: result.message;
		return <p className="shipit-seo-form-error" role="alert">{message}</p>;
	}
	const preview = result.preview;
	return (
		<div className="shipit-seo-entry-preview" aria-live="polite">
			<div className="shipit-seo-preview-heading">
				<div>
					<strong>{example.title}</strong>
					<span>
						Published, {preview.locale}, <a href={preview.publicUrl} target="_blank" rel="noreferrer">{preview.publicUrl}</a>
					</span>
				</div>
				{preview.noindex ? <Badge variant="error">noindex</Badge> : null}
			</div>
			<p className="shipit-seo-template-intro">
				This plugin's tags for the published version of this entry with the values in the form. The site's route and
				theme are not checked, and the entry, its SEO fields and its URL were read separately.
			</p>
			<dl className="shipit-seo-template-tags">
				<PreviewTag label="Meta description" tags="description" field={preview.description} />
				<PreviewTag label="Social title" tags="og:title, twitter:title" field={preview.socialTitle} />
				<PreviewTag label="Social description" tags="og:description, twitter:description" field={preview.socialDescription} />
			</dl>
			<div className="shipit-seo-template-title-note">
				<strong>Title suggestion: {preview.titleSuggestion.value || "empty"}</strong>
				<p>
					Suggested title only. Your theme controls the browser title (<code>&lt;title&gt;</code>).
					Source: {previewSourceLabel(preview.titleSuggestion.source)}.
				</p>
			</div>
			{preview.noindex ? (
				<p className="shipit-seo-template-intro">This page also carries noindex, so search engines are asked not to list it.</p>
			) : null}
		</div>
	);
}

/** A requested example that is not shown: why, and what the editor can do. No other entry is chosen. */
function RequestedExampleStatus({
	selection,
	retrying,
	onRetry,
}: {
	selection: TemplateExampleSelection;
	retrying: boolean;
	onRetry: () => void;
}) {
	if (selection.kind === "loading") {
		return <p className="shipit-seo-template-loading" role="status">Reading the requested entry {selection.entryId}...</p>;
	}
	if (selection.kind === "invalid") {
		return (
			<p className="shipit-seo-form-error" role="alert">
				Templates was opened for content it cannot identify, so no example was chosen. Choose a published entry below.
			</p>
		);
	}
	if (selection.kind !== "refused" && selection.kind !== "failed") return null;
	return (
		<div className="shipit-seo-form-error" role="alert">
			<p>
				{selection.kind === "refused" ? selection.message : `The requested entry ${selection.entryId} could not be read.`} No other
				entry was chosen. Choose a published entry below or another content type.
			</p>
			<Button type="button" size="sm" variant="secondary" loading={retrying} onClick={onRetry}>
				Retry
			</Button>
		</div>
	);
}

const templatesPort: TemplatesPort = {
	save: (request, signal) => saveSeoAdminTemplate(request, { signal }),
	reset: (request, signal) => resetSeoAdminTemplate(request, { signal }),
	preview: (request, signal) => previewSeoAdminTemplate(request, { signal }),
	now: () => nextTemplateStamp(),
	newId: () => crypto.randomUUID(),
	withDeadline: withEntrySchemaDeadline,
};

export function TemplatesView({
	read,
	reloading,
	onReload,
	requestedRef,
	onRequestedRefChange,
	onChanged,
}: {
	read: TemplatesRead;
	reloading: boolean;
	onReload: () => void;
	requestedRef: string | null;
	onRequestedRefChange: (ref: string | null) => void;
	onChanged: () => void;
}) {
	const store = templatesStore;
	const state = React.useSyncExternalStore(store.subscribe, store.get, store.get);
	React.useEffect(() => store.dispatch({ type: "read", read }), [read, store]);
	// A confirmed or unknown outcome and an unshown conflict each need one read requested after them.
	const requestedFor = React.useRef(0);
	const readToRequest = templateReadToRequest(state, reloading, requestedFor.current);
	React.useEffect(() => {
		if (readToRequest === null) return;
		requestedFor.current = readToRequest;
		onReload();
	}, [readToRequest, onReload]);
	// Each new reference reaches the store once; a choice made here is applied before it is reported.
	React.useEffect(() => store.dispatch({ type: "request-example", ref: requestedRef }), [requestedRef, store]);
	const configuration = state.base?.configuration ?? read.configuration;
	const items = configuration.items;
	const active = state.active ?? items[0]?.collection ?? null;
	const item = active ? items.find((candidate) => candidate.collection === active) ?? null : null;
	const [cursors, setCursors] = React.useState<Record<string, Array<string | undefined>>>({});
	const cursorStack = (active && cursors[active]) || [undefined];
	const cursor = cursorStack[cursorStack.length - 1];
	const examplesQuery = useQuery({
		queryKey: seoWorkspaceKeys.templateExamples(active ?? "", cursor),
		queryFn: ({ signal }) => fetchSeoAdminTemplateExamples({ collection: active!, limit: EXAMPLES_PAGE_SIZE, ...(cursor ? { cursor } : {}) }, { signal }),
		enabled: Boolean(item),
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		retry: 1,
		staleTime: 30_000,
	});
	const page = examplesQuery.data?.success ? examplesQuery.data : null;
	const exactRequest = state.request && state.request.collection !== null && state.request.collection === active && item
		? { collection: state.request.collection, entryId: state.request.entryId! }
		: null;
	const selectionInput = {
		request: state.request,
		active,
		activeAvailable: Boolean(item),
		remembered: active ? state.examples[active] ?? null : null,
		listed: page ? page.items : null,
	};
	const exampleQuery = useQuery({
		queryKey: seoWorkspaceKeys.templateExample(exactRequest?.collection ?? "", exactRequest?.entryId ?? ""),
		queryFn: ({ signal }) => exactRequest
			? fetchSeoAdminTemplateExample(exactRequest, { signal })
			: Promise.reject(new Error("No example was requested.")),
		...templateExampleQueryPolicy(resolveTemplateExampleSelection({ ...selectionInput, lookup: IDLE_TEMPLATE_EXAMPLE_LOOKUP }).lookup),
	});
	const resolution = resolveTemplateExampleSelection({
		...selectionInput,
		lookup: exactRequest
			? templateExampleLookup({ fetching: exampleQuery.isFetching, status: exampleQuery.status, data: exampleQuery.data })
			: IDLE_TEMPLATE_EXAMPLE_LOOKUP,
	});
	const selection = resolution.selection;
	const example = selection.kind === "selected" ? selection.example : null;
	const resolvedRequest = selection.kind === "selected" && selection.requested && state.request ? state.request.ref : null;
	React.useEffect(() => {
		if (resolvedRequest && example) store.dispatch({ type: "resolve-example", ref: resolvedRequest, example });
	}, [resolvedRequest, example?.entryId, example?.locale, example?.title, example?.slug, store]);
	// The first published entry is chosen without a request; Preview sends one.
	const first = resolution.first;
	React.useEffect(() => {
		if (active && first) store.dispatch({ type: "auto-example", collection: active, example: first });
	}, [active, first?.entryId, first?.locale, first?.title, first?.slug, store]);
	const fieldElements = React.useRef<Partial<Record<SeoAdminTemplateField, HTMLInputElement | HTMLTextAreaElement | null>>>({});
	const lastFocusedField = React.useRef<SeoAdminTemplateField | null>(null);
	const pendingCaret = React.useRef<{ field: SeoAdminTemplateField; caret: number } | null>(null);
	// The caret is placed after the controlled value carrying the inserted token has rendered.
	React.useLayoutEffect(() => {
		const next = pendingCaret.current;
		if (!next) return;
		pendingCaret.current = null;
		const element = fieldElements.current[next.field];
		if (!element) return;
		element.focus();
		element.setSelectionRange(next.caret, next.caret);
	});

	const reloadButton = (
		<Button type="button" variant="secondary" size="sm" loading={reloading} onClick={onReload}>
			Reload templates
		</Button>
	);
	if (configuration.state === "corrupt") {
		return (
			<Banner
				variant="error"
				title="Stored templates are invalid"
				description="This plugin keeps the stored Templates record exactly as it is and does not show, preview or change it here. Public pages use each entry's own title and description until it is repaired from a backup or by correcting the options row plugin:shipit-seo:configuration:templates:v1."
				action={reloadButton}
			/>
		);
	}
	if (configuration.state === "unavailable") {
		return (
			<Banner
				variant="error"
				title="Templates could not be read"
				description="Nothing is shown or changed while plugin storage cannot be read. Public pages use each entry's own title and description meanwhile."
				action={reloadButton}
			/>
		);
	}
	if (configuration.discovery === "unavailable") {
		return (
			<Banner
				variant="alert"
				title="Content types unavailable"
				description="EmDash could not provide the site's content types. Saved templates are kept; reload when discovery is available."
				action={reloadButton}
			/>
		);
	}
	if (!active) {
		return (
			<Empty
				icon={<Browser size={32} aria-hidden="true" />}
				title="No SEO templates available"
				description="EmDash did not provide a visible, routable content type. Hidden and unroutable content types are not template targets."
			/>
		);
	}
	const selectCollection = (collection: string) => {
		store.dispatch({ type: "select", collection });
		onRequestedRefChange(store.get().appliedRef);
	};
	const pickerMode = templateTypePickerMode(items.length);
	const typeLabel = (candidate: SeoAdminTemplateItem) =>
		templateTypeLabel(candidate.label, templateDraftDirty(state.drafts[candidate.collection]));
	const typeSelect = (
		<div className="shipit-seo-template-type-select">
			<Select<string>
				label="Content type"
				placeholder="Choose a content type"
				value={item ? active : null}
				items={Object.fromEntries(items.map((candidate) => [candidate.collection, typeLabel(candidate)]))}
				onValueChange={(value) => {
					if (typeof value === "string" && items.some((candidate) => candidate.collection === value)) selectCollection(value);
				}}
			/>
		</div>
	);
	const typeList = pickerMode === "list" ? (
		<div className="shipit-seo-template-types" role="group" aria-label="Content type">
			{items.map((candidate) => (
				<button
					key={candidate.collection}
					type="button"
					data-template-type={candidate.collection}
					aria-current={candidate.collection === active ? "true" : undefined}
					onClick={() => { if (candidate.collection !== active) selectCollection(candidate.collection); }}
				>
					{typeLabel(candidate)}
				</button>
			))}
		</div>
	) : null;
	const typePicker = <>{typeList}{typeSelect}</>;
	if (!item) {
		// The type stopped being a target, or a request named one that is not: nothing else is selected for it.
		const retained = state.drafts[active];
		const requestedEntry = selection.kind === "type-unavailable" ? selection.entryId : null;
		return (
			<div className="shipit-seo-panel shipit-seo-template-editor">
				<div className="shipit-seo-section-heading">
					<div>
						<span className="shipit-seo-eyebrow">Metadata defaults</span>
						<h2>SEO templates</h2>
					</div>
				</div>
				<Banner
					variant="alert"
					title={`${active} is not a template target now`}
					description={`${requestedEntry ? `Templates was opened for entry ${requestedEntry} of ${active}. ` : ""}This content type is hidden, unroutable or missing, so it cannot be edited or previewed here, and no other content type or entry was chosen in its place. Any saved template for it is kept.${retained ? " Your unsaved edits are kept below but cannot be saved." : ""}${items.length ? " Choose an available content type to continue." : ""}`}
					action={reloadButton}
				/>
				{items.length ? <div className={`shipit-seo-template-body shipit-seo-template-body--${pickerMode}`}>{typePicker}</div> : null}
				{retained ? (
					<details className="shipit-seo-template-saved" open>
						<summary>Unsaved edits kept for {active}</summary>
						<dl className="shipit-seo-template-tags">
							{TEMPLATE_FIELDS.map((name) => (
								<div className="shipit-seo-template-tag" key={name}>
									<dt>{FIELD_LABELS[name]}</dt>
									<dd>{retained.values[name] ? <p>{retained.values[name]}</p> : <p className="shipit-seo-muted">empty</p>}</dd>
								</div>
							))}
						</dl>
					</details>
				) : null}
			</div>
		);
	}

	const values = templateFormValues(state, active) ?? item.values;
	const draft = state.drafts[active];
	const dirty = templateDraftDirty(draft);
	const errors = draft?.errors ?? {};
	const pendingHere = state.pending?.collection === active ? state.pending : null;
	const conflict = state.conflicts[active];
	const conflictResolvable = templateConflictResolvable(state, active);
	const notice = state.notice?.collection === active ? state.notice : null;
	const review = state.confirmingReset?.collection === active ? state.confirmingReset : null;
	const previewValidation = validateSeoAdminTemplateValues(values, active);
	const previewRequest: TemplatePreviewRequest | null = example && previewValidation.success
		? { collection: active, entryId: example.entryId, locale: example.locale, values: previewValidation.values }
		: null;
	const previewView = currentTemplatePreview(state, previewRequest);

	const save = async (event: React.FormEvent) => {
		event.preventDefault();
		const run = await runTemplateSave(store, templatesPort, active);
		if (run.changed) onChanged();
	};
	const reset = async () => {
		const run = await runTemplateReset(store, templatesPort);
		if (run.changed) onChanged();
	};
	const preview = () => {
		if (previewRequest) void runTemplatePreview(store, templatesPort, previewRequest);
	};
	const exampleItems = Object.fromEntries((page?.items ?? []).map((entry) => [
		entry.entryId,
		`${entry.title} (${entry.locale || "no locale"})`,
	]));
	if (example && !exampleItems[example.entryId]) exampleItems[example.entryId] = `${example.title} (${example.locale || "no locale"})`;
	const field = (name: SeoAdminTemplateField) => ({
		value: values[name],
		error: errors[`${active}.${name}`],
		disabled: Boolean(pendingHere),
		"data-seo-setting": TEMPLATE_SETTING_IDS[name],
		ref: (element: HTMLInputElement | HTMLTextAreaElement | null) => { fieldElements.current[name] = element; },
		onFocus: () => { lastFocusedField.current = name; },
		onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
			store.dispatch({ type: "edit", collection: active, field: name, value: event.target.value }),
	});
	const insertVariable = (variable: string) => {
		const name = lastFocusedField.current ?? TEMPLATE_DEFAULT_INSERT_FIELD;
		const element = lastFocusedField.current ? fieldElements.current[name] : null;
		const next = insertTemplateVariable(values[name], variable, element?.selectionStart, element?.selectionEnd);
		pendingCaret.current = { field: name, caret: next.caret };
		store.dispatch({ type: "edit", collection: active, field: name, value: next.value });
	};
	const examples = templateFieldExamples(previewView);
	const fieldExample = (name: SeoAdminTemplateField) => examples ? (
		<p className="shipit-seo-template-example">
			<span>Example:</span> {examples[name] || (name === "title" ? "empty" : "empty, so this tag is not emitted")}
		</p>
	) : null;

	return (
		<>
			{state.unknown ? (
				<Banner
					variant="error"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title="Outcome unknown"
					description={`${state.unknown.message} Saving and resetting stay off until the templates are read again; that read shows what is stored without telling whether the earlier change was applied.`}
					action={reloadButton}
				/>
			) : null}
			{configuration.retainedCollections.length ? (
				<Banner
					variant="default"
					title="Saved templates kept for unavailable content types"
					description={`${configuration.retainedCollections.join(", ")}: these content types are hidden, unroutable or missing now. Their saved templates are kept and are not changed here.`}
				/>
			) : null}
			<div className="shipit-seo-template-workspace">
				<form className="shipit-seo-panel shipit-seo-template-editor" onSubmit={save}>
					<div className="shipit-seo-section-heading">
						<div>
							<span className="shipit-seo-eyebrow">Metadata defaults</span>
							<h2>SEO templates</h2>
						</div>
						<Badge variant={item.source === "override" ? "success" : "secondary"}>{ownerLabel(item)}</Badge>
					</div>
					<p className="shipit-seo-template-intro">
						{item.description} Saving changes this content type only, and its public pages at once.
					</p>
					<div className={`shipit-seo-template-body shipit-seo-template-body--${pickerMode}`}>
					{typePicker}
					<div className="shipit-seo-template-main">
					{item.inherited.ignoredLegacyFields.length ? (
						<Banner
							variant="alert"
							title="Some older saved values are not used"
							description={`${item.inherited.ignoredLegacyFields.map((name) => FIELD_LABELS[name]).join(", ")}: the value kept from an earlier version is invalid, so the built-in default applies. The stored value is left as it is.`}
						/>
					) : null}
					{conflict ? (
						<Banner
							variant="alert"
							title="Saved values changed"
							description={conflictResolvable
								? `${conflict.message} The form below still holds your edits.`
								: `${conflict.message} The form below still holds your edits. Reading the saved values before you choose.`}
							action={conflictResolvable ? (
								<div className="shipit-seo-inline-actions">
									<Button type="button" size="sm" variant="secondary" onClick={() => store.dispatch({ type: "discard", collection: active })}>
										Use saved values
									</Button>
									<Button type="button" size="sm" variant="secondary" onClick={() => store.dispatch({ type: "keep-edits", collection: active })}>
										Keep my edits
									</Button>
								</div>
							) : reloadButton}
						/>
					) : null}
					{conflict && conflictResolvable ? (
						<details className="shipit-seo-template-saved">
							<summary>Saved values now in effect ({ownerLabel(item).toLowerCase()})</summary>
							<dl className="shipit-seo-template-tags">
								{TEMPLATE_FIELDS.map((name) => (
									<div className="shipit-seo-template-tag" key={name}>
										<dt>{FIELD_LABELS[name]}</dt>
										<dd>{item.values[name] ? <p>{item.values[name]}</p> : <p className="shipit-seo-muted">empty</p>}</dd>
									</div>
								))}
							</dl>
						</details>
					) : null}
					<div className="shipit-seo-template-fields">
						<div className="shipit-seo-template-field">
							<Input
								label="SEO title suggestion template"
								description="Suggested title; your theme controls the browser title. Used for social titles when no social title template is set."
								required
								maxLength={300}
								{...field("title")}
							/>
							{fieldExample("title")}
						</div>
						<div className="shipit-seo-template-field">
							<Textarea
								label="Meta description template"
								description="Used when an entry has no SEO description of its own."
								required
								rows={3}
								maxLength={1_000}
								{...field("description")}
							/>
							{fieldExample("description")}
						</div>
						<div className="shipit-seo-template-field">
							<Input label="Social title template" required={false} maxLength={300} {...field("socialTitle")} />
							{fieldExample("socialTitle")}
						</div>
						<div className="shipit-seo-template-field">
							<Textarea label="Social description template" required={false} rows={3} maxLength={1_000} {...field("socialDescription")} />
							{fieldExample("socialDescription")}
						</div>
					</div>
					<div className="shipit-seo-template-vars" role="group" aria-label="Insert a template variable">
						<span>Variables</span>
						<p>Inserts at the cursor in the template field used last.</p>
						<div>
							{configuration.allowedVariables.map((variable) => (
								<button
									key={variable}
									type="button"
									data-template-variable={variable}
									disabled={Boolean(pendingHere)}
									onMouseDown={(event) => event.preventDefault()}
									onClick={() => insertVariable(variable)}
								>
									<code>{`{{${variable}}}`}</code>
								</button>
							))}
						</div>
					</div>
					{errors._form ? <p className="shipit-seo-form-error">{errors._form}</p> : null}
					</div>
					</div>
					<SettingsActionBar
						status={pendingHere
							? pendingHere.kind === "save" ? "Saving..." : "Restoring the inherited template..."
							: notice?.text ?? (dirty ? "Unsaved changes" : `In effect: ${ownerLabel(item).toLowerCase()}`)}
						statusTone={notice?.tone === "error" && !pendingHere ? "error" : "default"}
						restore={(
							<Button
								type="button"
								variant="secondary-destructive"
								icon={ArrowCounterClockwise}
								disabled={!canResetTemplate(state, active)}
								onClick={() => store.dispatch({ type: "open-reset", collection: active })}
							>
								Use inherited
							</Button>
						)}
						discardDisabled={!dirty || Boolean(pendingHere)}
						onDiscard={() => store.dispatch({ type: "discard", collection: active })}
						saveLabel="Save template"
						saveDisabled={!canSaveTemplate(state, active)}
						saving={pendingHere?.kind === "save"}
					/>
				</form>

				<aside className="shipit-seo-panel shipit-seo-template-preview-panel">
					<div className="shipit-seo-section-heading">
						<div>
							<span className="shipit-seo-eyebrow">Published example</span>
							<h2>Preview</h2>
						</div>
						{previewView.kind === "settled" && previewView.outcome.kind === "result" && previewView.outcome.result.success ? (
							<CheckCircle size={20} weight="fill" aria-label="Preview resolved" />
						) : null}
					</div>
					<RequestedExampleStatus selection={selection} retrying={exampleQuery.isFetching} onRetry={() => void exampleQuery.refetch()} />
					{examplesQuery.isError || (examplesQuery.data && !examplesQuery.data.success) ? (
						<p className="shipit-seo-form-error" role="alert">
							{examplesQuery.data && !examplesQuery.data.success ? examplesQuery.data.message : "Published entries could not be listed."}{" "}
							<Button type="button" size="sm" variant="secondary" onClick={() => void examplesQuery.refetch()}>Retry</Button>
						</p>
					) : null}
					{page && page.items.length === 0 && cursorStack.length === 1 && !example ? (
						<Empty
							size="sm"
							icon={<Browser size={32} aria-hidden="true" />}
							title={`No published ${item.label} yet`}
							description="Publish an entry of this type to preview the template with real content. Drafts are not listed because they have no public page."
						/>
					) : null}
					{Object.keys(exampleItems).length ? (
						<Select<string>
							label="Published entry"
							value={example?.entryId ?? ""}
							onValueChange={(entryId) => {
								const chosen = page?.items.find((entry) => entry.entryId === entryId) ?? (example?.entryId === entryId ? example : undefined);
								if (!chosen) return;
								store.dispatch({ type: "select-example", collection: active, example: templateExampleTarget(chosen) });
								onRequestedRefChange(store.get().appliedRef);
							}}
							items={exampleItems}
						/>
					) : null}
					{example ? (
						<p className="shipit-seo-template-intro">
							Previewing {example.title}{example.locale ? ` (${example.locale})` : ""}{example.slug ? `, slug ${example.slug}` : ""}.
						</p>
					) : null}
					<div className="shipit-seo-inline-actions">
						<Button
							type="button"
							size="sm"
							variant="secondary"
							disabled={cursorStack.length < 2 || examplesQuery.isFetching}
							onClick={() => setCursors((current) => ({ ...current, [active]: cursorStack.slice(0, -1) }))}
						>
							Previous page
						</Button>
						<span className="shipit-seo-muted">
							{examplesQuery.isPending ? "Loading published entries..." : `Page ${cursorStack.length}: ${page?.items.length ?? 0} published`}
						</span>
						<Button
							type="button"
							size="sm"
							variant="secondary"
							disabled={!page?.hasMore || !page.cursor || examplesQuery.isFetching}
							onClick={() => page?.cursor && setCursors((current) => ({ ...current, [active]: [...cursorStack, page.cursor] }))}
						>
							Next page
						</Button>
					</div>
					<Button
						type="button"
						variant="primary"
						icon={Browser}
						disabled={!previewRequest || previewView.kind === "pending"}
						loading={previewView.kind === "pending"}
						onClick={preview}
					>
						Preview
					</Button>
					{example && !previewValidation.success ? (
						<p className="shipit-seo-form-error">Fix the template fields to preview them.</p>
					) : null}
					<TemplateMetadataPreview view={previewView} example={example} />
					<div className="shipit-seo-output-support">
						<strong>What this plugin controls</strong>
						<ul>
							<li>
								<CheckCircle size={15} weight="fill" aria-hidden="true" />
								<span>Description, Open Graph and X tags</span>
							</li>
							<li>
								<WarningCircle size={15} weight="fill" aria-hidden="true" />
								<span>
									Browser title: controlled by your theme. This template does not change{" "}
									<code>&lt;title&gt;</code>.
								</span>
							</li>
						</ul>
					</div>
				</aside>
			</div>
			<Dialog.Root
				role="alertdialog"
				open={review !== null}
				onOpenChange={(open) => {
					if (!open && !pendingHere) store.dispatch({ type: "close-reset" });
				}}
			>
				<Dialog size="sm" className="shipit-seo-delete-dialog">
					<Dialog.Title>Use the inherited template for {item.label}?</Dialog.Title>
					<Dialog.Description>
						{item.label} will no longer have its own template. Its public pages then use{" "}
						{review ? inheritedSourceLabel(review.inherited.source) : "the inherited values"}:
					</Dialog.Description>
					{review ? (
						<dl className="shipit-seo-template-tags">
							{TEMPLATE_FIELDS.map((name) => (
								<div className="shipit-seo-template-tag" key={name}>
									<dt>{FIELD_LABELS[name]}</dt>
									<dd>{review.inherited.values[name] || <span className="shipit-seo-muted">empty</span>}</dd>
								</div>
							))}
						</dl>
					) : null}
					<div className="shipit-seo-dialog-actions">
						<Button type="button" variant="secondary" disabled={Boolean(pendingHere)} onClick={() => store.dispatch({ type: "close-reset" })}>
							Cancel
						</Button>
						<Button type="button" variant="destructive" loading={pendingHere?.kind === "reset"} onClick={() => void reset()}>
							Use inherited
						</Button>
					</div>
				</Dialog>
			</Dialog.Root>
		</>
	);
}
