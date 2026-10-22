import * as React from "react";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { CodeBlock } from "@cloudflare/kumo/components/code";
import { Dialog } from "@cloudflare/kumo/components/dialog";
import { Input, InputArea } from "@cloudflare/kumo/components/input";
import { useQuery } from "@tanstack/react-query";
import { ArrowClockwise, Books, Info, MagnifyingGlass, Plus, Warning, WarningCircle } from "@phosphor-icons/react";
import {
	ENTRY_SCHEMA_NAME_MAX_LENGTH,
	TEMPLATE_VARIABLE_NAMES,
	validateEntrySchemaJson,
	type SchemaLibraryTemplate,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import { deleteSeoSchemaLibraryTemplate, fetchSeoSchemaLibrary, saveSeoSchemaLibraryTemplate } from "./api.ts";
import { EntrySchemaAuthoringControls, type EntrySchemaAuthoringControlsProps } from "./entry-schema-authoring-controls.tsx";
import { createEntrySchemaAuthoring, decodeEntrySchemaAuthoring, encodeEntrySchemaAuthoring, entrySchemaAuthoringErrors } from "./entry-schema-authoring.ts";
import {
	classifySchemaLibraryRequestError,
	filterSchemaLibraryTemplates,
	newSchemaLibraryTemplateId,
	runSchemaLibraryDelete,
	runSchemaLibrarySave,
	schemaLibraryDraftDirty,
	schemaLibraryStore,
	schemaLibraryWritable,
	type SchemaLibraryPort,
	type SchemaLibraryRead,
} from "./schema-library-model.ts";
import { seoWorkspaceKeys } from "./workspace-model.ts";

const utf8 = new TextEncoder();
const bytes = (text: string) => utf8.encode(text).byteLength;
const number = (value: number) => value.toLocaleString("en-US");

type AuthoringMode = EntrySchemaAuthoringControlsProps["mode"];

function initialAuthoringMode(json: string): AuthoringMode {
	return !json.trim() ? "choose" : decodeEntrySchemaAuthoring(json).ok ? "guided" : "advanced";
}

const port: SchemaLibraryPort = {
	save: (request) => saveSeoSchemaLibraryTemplate(request),
	remove: (request) => deleteSeoSchemaLibraryTemplate(request),
	now: () => performance.now(),
};

// Each read is stamped when it is requested, so an unknown write outcome is
// settled only by a read sent after it, never by a cached or earlier one.
async function readLibrary(signal: AbortSignal): Promise<SchemaLibraryRead> {
	const requestedAt = port.now();
	return { library: await fetchSeoSchemaLibrary({ signal }), requestedAt };
}

function bannerIcon(variant: "default" | "alert" | "error") {
	return variant === "default"
		? <Info size={20} weight="fill" aria-hidden="true" />
		: variant === "alert"
			? <Warning size={20} weight="fill" aria-hidden="true" />
			: <WarningCircle size={20} weight="fill" aria-hidden="true" />;
}

// Use template unmounts this view, so the template whose copy was opened is kept
// here for Back to return focus to its button when the view mounts again.
const libraryReturn: { templateId: string | null } = { templateId: null };

/** True when the node can keep focus: still in the document, enabled and visible. */
function canHoldFocus(node: HTMLElement): boolean {
	if (!node.isConnected || (node as HTMLButtonElement).disabled === true) return false;
	return typeof node.checkVisibility === "function" ? node.checkVisibility() : node.closest("[hidden]") === null;
}

/** True when nothing that can keep focus holds it, as after Back hides the control that had it. */
function focusLeftThePage(): boolean {
	if (typeof document === "undefined") return false;
	const active = document.activeElement as HTMLElement | null;
	return !active || active === document.body || !canHoldFocus(active);
}

export function SchemaLibraryView({ onUseTemplate }: {
	onUseTemplate: (template: SchemaLibraryTemplate) => void;
}) {
	const store = schemaLibraryStore;
	const state = React.useSyncExternalStore(store.subscribe, store.get, store.get);
	const dispatch = store.dispatch;
	const { editor, fieldErrors, notice, unconfirmed, confirmingDelete, pending, search } = state;
	const library = useQuery({
		queryKey: seoWorkspaceKeys.schemaLibrary,
		queryFn: ({ signal }) => readLibrary(signal),
		staleTime: 0,
		retry: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
	const loaded = library.data?.library ?? null;
	const nameRef = React.useRef<HTMLInputElement>(null);
	const jsonRef = React.useRef<HTMLTextAreaElement>(null);
	const noticeRef = React.useRef<HTMLDivElement>(null);
	const recoveryRef = React.useRef<HTMLDivElement>(null);
	const addRef = React.useRef<HTMLButtonElement>(null);
	const headingRef = React.useRef<HTMLHeadingElement>(null);
	const returnButtonRef = React.useRef<HTMLButtonElement>(null);
	const [returnTemplateId] = React.useState(() => libraryReturn.templateId);
	const returnPending = React.useRef(returnTemplateId !== null);
	const hadEditor = React.useRef(editor !== null);
	const mountNotice = React.useRef(notice);
	// The Library control that last received focus, including controls in its dialogs.
	const lastFocus = React.useRef<HTMLElement | null>(null);
	const focusDropped = React.useRef(false);
	// Whether the previous render held a save request or its unknown outcome; the person may have moved focus meanwhile.
	const outcomeOpen = React.useRef(pending === "save" || unconfirmed?.action === "save");
	const recordFocus = (event: React.FocusEvent<HTMLElement>) => {
		lastFocus.current = event.target as HTMLElement;
	};
	const focusHeading = () => {
		headingRef.current?.setAttribute("tabindex", "-1");
		headingRef.current?.focus();
	};
	const [discardOpen, setDiscardOpen] = React.useState(false);
	const editorIdentity = editor ? `${editor.mode}:${editor.id}` : null;
	const editorOriginal = editor?.mode === "update" ? editor.original : null;
	const [authoring, setAuthoring] = React.useState<{
		identity: string | null;
		original: SchemaLibraryTemplate | null;
		mode: AuthoringMode;
		error: string | null;
		generation: number;
	}>(() => ({ identity: editorIdentity, original: editorOriginal, mode: initialAuthoringMode(editor?.draft.json ?? ""), error: null, generation: 0 }));
	const currentAuthoring = authoring.identity === editorIdentity && authoring.original === editorOriginal;
	const authoringMode = currentAuthoring ? authoring.mode : initialAuthoringMode(editor?.draft.json ?? "");
	const authoringError = currentAuthoring ? authoring.error : null;
	const changeAuthoringMode = (mode: AuthoringMode, error: string | null = null) =>
		setAuthoring((current) => ({ identity: editorIdentity, original: editorOriginal, mode, error,
			generation: current.generation + (current.identity === editorIdentity && current.original === editorOriginal ? 0 : 1) }));
	React.useEffect(() => {
		setAuthoring((current) => current.identity === editorIdentity && current.original === editorOriginal ? current :
			{ identity: editorIdentity, original: editorOriginal, mode: initialAuthoringMode(editor?.draft.json ?? ""), error: null, generation: current.generation + 1 });
	}, [editorIdentity, editorOriginal]);

	React.useEffect(() => {
		if (library.data) dispatch({ type: "loaded", read: library.data });
	}, [library.data, dispatch]);
	React.useEffect(() => {
		// A notice the store kept from before this mount is not news, after Back or a tab switch alike.
		if (notice && notice !== mountNotice.current && notice.kind !== "info") noticeRef.current?.focus();
	}, [notice]);
	React.useEffect(() => {
		if (unconfirmed) recoveryRef.current?.focus();
	}, [unconfirmed]);
	React.useEffect(() => {
		if (fieldErrors.name) nameRef.current?.focus();
		else if (fieldErrors.json) jsonRef.current?.focus();
	}, [fieldErrors]);
	React.useEffect(() => {
		if (editor && !hadEditor.current) nameRef.current?.focus();
		// A form closed by a save answer, or by the read that settles an unknown save, moves focus only when it left the page.
		if (!editor && hadEditor.current && (!outcomeOpen.current || focusLeftThePage())) addRef.current?.focus();
		hadEditor.current = editor !== null;
	}, [editor]);
	const listShown = loaded !== null;
	React.useEffect(() => {
		if (!returnPending.current || !listShown) return;
		returnPending.current = false;
		// Focus moved on by the person, such as onto the Library tab, stays where it is.
		if (!focusLeftThePage()) return;
		const button = returnButtonRef.current;
		button?.focus();
		if (button && document.activeElement === button) return;
		focusHeading();
	}, [listShown]);

	const reload = () => void library.refetch();
	const readFailed = library.isError;
	const denied = readFailed && classifySchemaLibraryRequestError(library.error) === "denied";
	// Runs after every render and after every focus move above. Focus lost because the Library control
	// that held it was removed or disabled goes to the heading once no read or request runs and the
	// store holds what this render drew. Focus on any control that can keep it is never moved.
	React.useEffect(() => {
		outcomeOpen.current = pending === "save" || unconfirmed?.action === "save";
		if (typeof document === "undefined") return;
		if (!focusLeftThePage()) {
			if (document.activeElement !== lastFocus.current) lastFocus.current = null;
			focusDropped.current = false;
			return;
		}
		const last = lastFocus.current;
		if (last && !canHoldFocus(last)) focusDropped.current = true;
		if (!focusDropped.current || library.isFetching || pending !== null || store.get() !== state || !headingRef.current) return;
		focusDropped.current = false;
		focusHeading();
	});

	if (library.isPending) {
		return <section className="shipit-seo-panel shipit-seo-library" role="status">Loading the schema library</section>;
	}
	// A failed refresh keeps the last read on screen, so an unconfirmed outcome and the form stay visible.
	if (!loaded) {
		return (
			<section className="shipit-seo-panel shipit-seo-library" onFocus={recordFocus}>
				<Banner
					variant="error"
					icon={bannerIcon("error")}
					title={denied ? "The schema library needs administrator access" : "The schema library could not be loaded"}
					description={denied
						? "Reading and changing saved templates needs the plugin administrator permission (plugins:manage)."
						: "Nothing is shown rather than an incomplete list. Your form, if any, is kept."}
					action={<Button size="sm" variant="secondary" icon={ArrowClockwise} loading={library.isFetching} onClick={reload}>Try again</Button>}
				/>
			</section>
		);
	}

	// Writes stay off after a failed read until a later read succeeds.
	const writable = !readFailed && schemaLibraryWritable(state, loaded);
	const templates = loaded.templates;
	const libraryReady = (loaded.state === "absent" || loaded.state === "saved") && loaded.conditionalStorage;
	const shown = filterSchemaLibraryTemplates(templates, search);
	const draft = editor?.draft ?? null;
	const review = draft ? validateEntrySchemaJson(draft.json) : null;
	const decoded = draft ? decodeEntrySchemaAuthoring(draft.json) : null;
	const guidedReady = authoringMode !== "guided" || Boolean(decoded?.ok && Object.keys(entrySchemaAuthoringErrors(decoded)).length === 0);
	const nameLength = draft?.name.trim().length ?? 0;
	// A conflict is answered first: by reloading, or by choosing a version of a changed template.
	const canSave = Boolean(draft && draft.name.trim() && nameLength <= ENTRY_SCHEMA_NAME_MAX_LENGTH && review?.ok) &&
		authoringMode !== "choose" && guidedReady && !authoringError && writable;
	const atLimit = templates.length >= loaded.limits.templates;
	const busy = pending !== null;
	const editing = editor?.mode === "update" ? templates.find((template) => template.id === editor.id) ?? null : null;

	const save = async () => {
		if (!canSave) return;
		if (await runSchemaLibrarySave(store, port, loaded)) void library.refetch();
	};

	const remove = async () => {
		if (readFailed) return;
		if (await runSchemaLibraryDelete(store, port)) void library.refetch();
	};

	const close = () => {
		if (schemaLibraryDraftDirty(store.get().editor)) setDiscardOpen(true);
		else dispatch({ type: "close" });
	};

	const statusLine = !editor
		? null
		: pending === "save"
			? "Saving"
			: unconfirmed?.action === "save"
				? "Outcome unknown until the library is reloaded"
				: schemaLibraryDraftDirty(editor)
					? "Unsaved changes. This form stays open if you leave this view."
					: editor.mode === "update"
						? `Saved ${new Date(editor.original.updatedAt).toLocaleString()}`
						: "Not saved";

	const renderNotice = () => {
		if (!notice) return null;
		const variant = notice.kind === "info" ? "default" : notice.kind === "conflict" ? "alert" : "error";
		return (
			<div ref={noticeRef} tabIndex={-1} className="shipit-seo-library__status" role={notice.kind === "info" ? "status" : "alert"}>
				<Banner
					variant={variant}
					icon={bannerIcon(variant)}
					title={notice.kind === "conflict" ? "Changed elsewhere" : notice.message}
					description={notice.kind === "conflict" ? notice.message : undefined}
					action={notice.kind === "conflict" && notice.revision === null
						? <Button size="sm" variant="secondary" icon={ArrowClockwise} loading={library.isFetching} onClick={reload}>Reload library</Button>
						: undefined}
				/>
				{notice.kind === "conflict" && notice.current && editor ? (
					<>
						<p className="shipit-seo-library__hint">Saved version of "{notice.current.name}"</p>
						<CodeBlock lang="jsonc" code={notice.current.json} />
						<div className="shipit-seo-library__actions">
							<Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => dispatch({ type: "use-saved" })}>
								Use the saved version
							</Button>
							<Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => dispatch({ type: "keep-edits" })}>
								Keep my edits
							</Button>
						</div>
					</>
				) : null}
				{notice.kind === "conflict" && !notice.current && notice.revision !== null && editor ? (
					<div className="shipit-seo-library__actions">
						<Button type="button" size="sm" variant="secondary" disabled={busy || atLimit} onClick={() => dispatch({ type: "save-as-new", id: newSchemaLibraryTemplateId() })}>
							Save as a new template
						</Button>
					</div>
				) : null}
			</div>
		);
	};

	const renderForm = () => {
		if (!editor || !draft) return null;
		const jsonBytes = bytes(draft.json.trim());
		const jsonError = fieldErrors.json ?? (review && !review.ok && draft.json.trim() ? review.message : undefined);
		const title = editor.mode === "create" ? "New template" : `Edit ${editor.original.name}`;
		return (
			<form
				className="shipit-seo-library__form"
				aria-label={title}
				onSubmit={(event) => {
					event.preventDefault();
					void save();
				}}
				onKeyDown={(event) => {
					if (event.key === "Escape" && !busy && unconfirmed?.action !== "save") {
						event.stopPropagation();
						close();
					}
				}}
			>
				<h3 className="shipit-seo-library__form-title">{title}</h3>
				<EntrySchemaAuthoringControls
					key={authoring.generation}
					context="template"
					json={draft.json}
					mode={authoringMode}
					disabled={busy || unconfirmed !== null}
					onModeChange={(mode) => changeAuthoringMode(mode)}
					onChooseType={(type) => {
						dispatch({ type: "edit", patch: { json: createEntrySchemaAuthoring(type) } });
						changeAuthoringMode("guided");
					}}
					onPatch={(patch) => {
						const current = store.get().editor;
						if (!current) return;
						const changed = encodeEntrySchemaAuthoring(current.draft.json, patch);
						if (changed.ok) {
							dispatch({ type: "edit", patch: { json: changed.json } });
							changeAuthoringMode("guided");
						} else changeAuthoringMode("guided", changed.message);
					}}
				/>
				{authoringError ? <p className="shipit-seo-entry-schema__error" role="alert">{authoringError}</p> : null}
				{authoringMode !== "choose" ? <>
				<Input
					ref={nameRef}
					label="Name"
					value={draft.name}
					maxLength={ENTRY_SCHEMA_NAME_MAX_LENGTH}
					error={fieldErrors.name}
					description={`Shown in the library and when choosing a schema template. ${nameLength} of ${ENTRY_SCHEMA_NAME_MAX_LENGTH} characters.`}
					disabled={busy || unconfirmed !== null}
					onChange={(event) => dispatch({ type: "edit", patch: { name: event.target.value } })}
				/>
				{authoringMode === "advanced" ? <InputArea
					ref={jsonRef}
					label="JSON-LD"
					className="shipit-seo-library__code-input"
					rows={14}
					value={draft.json}
					spellCheck={false}
					placeholder={'{"@context": "https://schema.org", "@type": "Article", "headline": "{{title}}"}'}
					error={jsonError}
					description={`${number(jsonBytes)} of ${number(loaded.limits.templateBytes)} bytes. Saved with its variables as written. An entry that uses a copy keeps them too; they are filled in with that entry's values in its schema preview and on its public page.`}
					disabled={busy || unconfirmed !== null}
					onChange={(event) => {
						dispatch({ type: "edit", patch: { json: event.target.value } });
						changeAuthoringMode("advanced");
					}}
				/> : jsonError ? <p className="shipit-seo-entry-schema__error" role="alert">{jsonError}</p> : null}
				</> : null}
				<details className="shipit-seo-library__help">
					<summary>Variables and rules</summary>
					<p>
						A template is never added to a page by itself: creating, editing or deleting one changes no page. Titles and
						descriptions are set in Templates. Schema manages output and content type rules; Local SEO manages the publisher.
					</p>
					<p>
						Write a variable as {"{{title}}"} inside a text value. Supported variables:{" "}
						{TEMPLATE_VARIABLE_NAMES.map((name) => `{{${name}}}`).join(", ")}. Filters, other braces and variables in
						property names are refused. A variable's value is inserted as text and never read as another variable.
					</p>
					<p>
						Each template follows the entry schema rules: "@context": "https://schema.org" on every top-level object,
						an @type or @graph, at most {number(loaded.limits.templateBytes)} bytes, {loaded.limits.depth} levels of nesting
						and {number(loaded.limits.values)} values. Passing these checks does not make a page eligible for a Google
						search feature, and it does not rule out the same entity being described by a theme or another plugin.
					</p>
				</details>
				<div className="shipit-seo-library__actions">
					<Button type="submit" variant="primary" loading={pending === "save"} disabled={!canSave}>
						{editor.mode === "create" ? "Save template" : "Save changes"}
					</Button>
					<Button type="button" variant="secondary" disabled={busy || unconfirmed?.action === "save"} onClick={close}>
						{schemaLibraryDraftDirty(editor) ? "Discard" : "Close"}
					</Button>
					{statusLine ? <span className="shipit-seo-library__hint" role="status">{statusLine}</span> : null}
				</div>
			</form>
		);
	};

	const stateBanner = () => {
		if (loaded.state === "corrupt") {
			return (
				<Banner
					variant="error"
					icon={bannerIcon("error")}
					title="The stored library is invalid"
					description={`${loaded.corrupt?.detail ?? "It cannot be read."} Saving and deleting are off so nothing is overwritten. Entry schemas copied from templates are separate records and keep working. Recovery steps are in the plugin guide under "Schema workspace".`}
					action={<Button size="sm" variant="secondary" icon={ArrowClockwise} loading={library.isFetching} onClick={reload}>Reload library</Button>}
				/>
			);
		}
		if (loaded.state === "unavailable" || !loaded.conditionalStorage) {
			return (
				<Banner
					variant="error"
					icon={bannerIcon("error")}
					title="The library could not be read"
					description="This EmDash installation did not return the library with a revision, so it cannot be changed safely. Nothing is shown rather than an incomplete list."
					action={<Button size="sm" variant="secondary" icon={ArrowClockwise} loading={library.isFetching} onClick={reload}>Reload library</Button>}
				/>
			);
		}
		return null;
	};

	return (
		<section className="shipit-seo-panel shipit-seo-library" aria-labelledby="seo-library-title" onFocus={recordFocus}>
			<div className="shipit-seo-section-heading shipit-seo-library__heading">
				<div>
					<span className="shipit-seo-eyebrow">Reusable templates</span>
					<div className="shipit-seo-library__title">
						<h2 ref={headingRef} id="seo-library-title">Schema library</h2>
						{libraryReady ? <span className="shipit-seo-library__count">{templates.length} of {loaded.limits.templates} templates</span> : null}
					</div>
				</div>
				<Button
					ref={addRef}
					type="button"
					variant="primary"
					icon={Plus}
					disabled={!writable || editor !== null || confirmingDelete !== null || atLimit}
					onClick={() => dispatch({ type: "open-create", id: newSchemaLibraryTemplateId(), library: loaded })}
				>
					New template
				</Button>
			</div>
			<p className="shipit-seo-library__copy">
				Save reusable schemas here. A template is never added to a page by itself: Use template opens an independent
				copy in Custom schemas, and an entry's SEO panel can copy one too. Editing or deleting a template later does not
				change those copies.
			</p>

			{stateBanner()}
			{unconfirmed ? (
				<div ref={recoveryRef} tabIndex={-1} className="shipit-seo-library__status" role="alert">
					<Banner
						variant="alert"
						icon={bannerIcon("alert")}
						title={unconfirmed.action === "save" ? "Save not confirmed" : `Deletion of "${unconfirmed.template.name}" not confirmed`}
						description={`${unconfirmed.message} Nothing is retried automatically.`}
						action={<Button size="sm" variant="secondary" icon={ArrowClockwise} loading={library.isFetching} onClick={reload}>Reload library</Button>}
					/>
				</div>
			) : null}
			{readFailed ? (
				<div className="shipit-seo-library__status" role="alert">
					<Banner
						variant="error"
						icon={bannerIcon("error")}
						title={denied ? "The schema library needs administrator access" : "The schema library could not be read again"}
						description={denied
							? "Reading and changing saved templates needs the plugin administrator permission (plugins:manage). Your form, if any, is kept."
							: "The templates shown are from the last successful read. Your form, if any, is kept, and changes stay off until the library is read."}
						action={<Button size="sm" variant="secondary" icon={ArrowClockwise} loading={library.isFetching} onClick={reload}>Try again</Button>}
					/>
				</div>
			) : null}
			{renderNotice()}
			{renderForm()}

			{templates.length || search.trim() ? (
				<div className="shipit-seo-library__toolbar">
					<Input
						label="Search templates"
						value={search}
						placeholder="Name or JSON-LD text"
						description={search.trim() ? `${shown.length} of ${templates.length} templates match.` : undefined}
						onChange={(event) => dispatch({ type: "search", value: event.target.value })}
					/>
				</div>
			) : null}
			{atLimit ? <p className="shipit-seo-library__hint">The library holds at most {loaded.limits.templates} templates. Delete one to add another.</p> : null}

			{shown.length ? (
				<ul className="shipit-seo-library__list" aria-label="Saved templates">
					{shown.map((template) => (
						<TemplateRow
							key={template.id}
							template={template}
							editing={editing?.id === template.id}
							disabled={!writable || editor !== null || confirmingDelete !== null}
							useButtonRef={template.id === returnTemplateId ? returnButtonRef : undefined}
							onUse={() => {
								libraryReturn.templateId = template.id;
								onUseTemplate({ ...template });
							}}
							onEdit={() => dispatch({ type: "open-edit", template, library: loaded })}
							onDelete={() => dispatch({ type: "confirm-delete", template, library: loaded })}
						/>
					))}
				</ul>
			) : templates.length ? (
				<p className="shipit-seo-library__empty"><MagnifyingGlass size={16} aria-hidden="true" /> No template matches this search.</p>
			) : !editor && libraryReady ? (
				<div className="shipit-seo-library__empty-state">
					<Books size={24} aria-hidden="true" />
					<div>
						<h3>No templates yet</h3>
						<p>Choose New template to get started. Saving a template does not change any page.</p>
					</div>
				</div>
			) : null}

			<Dialog.Root role="alertdialog" open={confirmingDelete !== null} onOpenChange={(open) => { if (!open && !busy) dispatch({ type: "cancel-delete" }); }}>
				<Dialog size="sm" className="shipit-seo-delete-dialog">
					<Dialog.Title>Delete "{confirmingDelete?.template.name}"?</Dialog.Title>
					<Dialog.Description>
						Only this template is removed from the library. Entry schemas that were copied from it are separate
						records and stay on their pages unchanged. If the library changed since you opened this, nothing is deleted.
					</Dialog.Description>
					{confirmingDelete ? (
						<div className="shipit-seo-library__review">
							<CodeBlock lang="jsonc" code={confirmingDelete.template.json} />
						</div>
					) : null}
					<div className="shipit-seo-dialog-actions">
						<Button type="button" variant="secondary" disabled={busy} onClick={() => dispatch({ type: "cancel-delete" })}>Cancel</Button>
						<Button type="button" variant="destructive" loading={pending === "delete"} disabled={busy || readFailed} onClick={() => void remove()}>Delete template</Button>
					</div>
				</Dialog>
			</Dialog.Root>

			<Dialog.Root role="alertdialog" open={discardOpen} onOpenChange={setDiscardOpen}>
				<Dialog size="sm" className="shipit-seo-delete-dialog">
					<Dialog.Title>Discard your changes?</Dialog.Title>
					<Dialog.Description>The form is closed and its unsaved name and JSON-LD are lost. The library is not changed.</Dialog.Description>
					<div className="shipit-seo-dialog-actions">
						<Button type="button" variant="secondary" onClick={() => setDiscardOpen(false)}>Keep editing</Button>
						<Button type="button" variant="destructive" onClick={() => { setDiscardOpen(false); dispatch({ type: "close" }); }}>Discard</Button>
					</div>
				</Dialog>
			</Dialog.Root>
		</section>
	);
}

function TemplateRow({ template, editing, disabled, useButtonRef, onUse, onEdit, onDelete }: {
	template: SchemaLibraryTemplate;
	editing: boolean;
	disabled: boolean;
	useButtonRef?: React.Ref<HTMLButtonElement>;
	onUse: () => void;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const types = React.useMemo(() => {
		const review = validateEntrySchemaJson(template.json);
		if (!review.ok) return [];
		const nodes = Array.isArray(review.parsed) ? review.parsed : [review.parsed];
		return [...new Set(nodes.flatMap((node) => {
			const type = node["@type"];
			return Array.isArray(type) ? type.map(String) : typeof type === "string" ? [type] : ["Graph"];
		}))];
	}, [template.json]);
	return (
		<li className="shipit-seo-library__item" aria-current={editing ? "true" : undefined}>
			<div className="shipit-seo-library__item-text">
				<strong>{template.name}</strong>
				<span className="shipit-seo-library__hint">
					{types.join(", ") || "JSON-LD"}; {number(bytes(template.json))} bytes; updated {new Date(template.updatedAt).toLocaleString()}
				</span>
			</div>
			<div className="shipit-seo-library__actions">
				<Button ref={useButtonRef} type="button" size="sm" variant="secondary" disabled={disabled} onClick={onUse} aria-label={`Use template ${template.name}`}>Use template</Button>
				<Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={onEdit} aria-label={`Edit ${template.name}`}>Edit</Button>
				<Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={onDelete} aria-label={`Delete ${template.name}`}>Delete</Button>
			</div>
		</li>
	);
}
