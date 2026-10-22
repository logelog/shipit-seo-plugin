// The entry Schema tab's library picker and unsaved-candidate preview. The
// picker copies a loaded template into the existing form; the preview runs
// only when the owner asks for it. Neither saves anything.
import * as React from "react";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { CodeBlock } from "@cloudflare/kumo/components/code";
import { Collapsible } from "@cloudflare/kumo/components/collapsible";
import { Input } from "@cloudflare/kumo/components/input";
import { Books, Eye, Info, Warning, WarningCircle } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

import { fetchSavedContentSnapshot, fetchSavedContentVersion, fetchSeoSchemaLibrary, previewSeoEntrySchemaCandidate } from "./api.ts";
import { SEO_WORKSPACE_URL } from "./api-routes.ts";
import {
	createEntrySchemaCandidateStore,
	entrySchemaCandidateOutputState,
	entrySchemaCandidateView,
	newEntrySchemaId,
	requestEntrySchemaCandidatePreview,
	savedContentCandidatePort,
	type EntrySchemaCandidatePort,
	type EntrySchemaCandidateStore,
	type EntrySchemaCandidateTarget,
	type EntrySchemaPanelStore,
} from "./entry-schema-model.ts";
import { filterSchemaLibraryTemplates } from "./schema-library-model.ts";

function bannerIcon(variant: "default" | "alert" | "error") {
	return variant === "default"
		? <Info size={20} weight="fill" aria-hidden="true" />
		: variant === "alert"
			? <Warning size={20} weight="fill" aria-hidden="true" />
			: <WarningCircle size={20} weight="fill" aria-hidden="true" />;
}

const candidateStores = new Map<string, EntrySchemaCandidateStore>();
/** One store per entry for the editor session, like the schema panel's own store. */
export function entrySchemaCandidateStoreFor(ref: string): EntrySchemaCandidateStore {
	let store = candidateStores.get(ref);
	if (!store) {
		store = createEntrySchemaCandidateStore();
		candidateStores.set(ref, store);
	}
	return store;
}

const candidatePort: EntrySchemaCandidatePort = savedContentCandidatePort({
	readSnapshot: (ref, signal) => fetchSavedContentSnapshot(ref, { signal }),
	readVersion: (ref, signal) => fetchSavedContentVersion(ref, { signal }),
	preview: (request, signal) => previewSeoEntrySchemaCandidate(request, { signal }),
});

/**
 * Copies one saved template into the form. The list is read when the picker
 * opens; copying uses that read and never fetches the template again.
 */
export function EntrySchemaTemplatePicker({ store, disabled }: { store: EntrySchemaPanelStore; disabled: boolean }) {
	const state = React.useSyncExternalStore(store.subscribe, store.get, store.get);
	const [open, setOpen] = React.useState(false);
	const [search, setSearch] = React.useState("");
	const searchRef = React.useRef<HTMLInputElement>(null);
	const triggerRef = React.useRef<HTMLButtonElement>(null);
	const library = useQuery({
		queryKey: ["shipit-seo-schema-library-picker"],
		queryFn: ({ signal }) => fetchSeoSchemaLibrary({ signal }),
		enabled: open,
		staleTime: 0,
		gcTime: 0,
		retry: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});
	const wasOpen = React.useRef(false);
	// The trigger is rendered again only after the picker closes, so focus moves once it exists.
	React.useEffect(() => {
		if (open) searchRef.current?.focus();
		else if (wasOpen.current) triggerRef.current?.focus();
		wasOpen.current = open;
	}, [open]);
	const pendingTemplate = state.pendingTemplate;
	const close = () => {
		setOpen(false);
		setSearch("");
	};
	const loaded = library.data;
	const usable = loaded && (loaded.state === "saved" || loaded.state === "absent");
	const shown = usable ? filterSchemaLibraryTemplates(loaded.templates, search) : [];

	return (
		<div className="shipit-seo-entry-schema__library">
			{pendingTemplate ? (
				<div className="shipit-seo-entry-schema__status" role="alertdialog" aria-label="Replace the JSON-LD in this form">
					<Banner
						variant="alert"
						icon={bannerIcon("alert")}
						title={`Replace this form's JSON-LD with "${pendingTemplate.name}"?`}
						description="The JSON-LD you edited in this form is replaced. Nothing is saved until you choose Save schema."
					/>
					<div className="shipit-seo-entry-schema__actions">
						<Button type="button" size="sm" variant="secondary" onClick={() => store.dispatch({ type: "apply-template", template: pendingTemplate, id: newEntrySchemaId(), replace: true })}>
							Replace
						</Button>
						<Button type="button" size="sm" variant="secondary" onClick={() => store.dispatch({ type: "cancel-template" })}>
							Keep my JSON-LD
						</Button>
					</div>
				</div>
			) : null}
			{open ? (
				<div
					className="shipit-seo-entry-schema__picker"
					role="group"
					aria-label="Saved templates"
					onKeyDown={(event) => {
						if (event.key !== "Escape") return;
						event.stopPropagation();
						close();
					}}
				>
					<Input
						ref={searchRef}
						label="Search saved templates"
						value={search}
						placeholder="Name or JSON-LD text"
						onChange={(event) => setSearch(event.target.value)}
						// The picker sits inside the schema form, where Enter would submit a save.
						onKeyDown={(event) => {
							if (event.key === "Enter") event.preventDefault();
						}}
					/>
					{library.isPending ? <p className="shipit-seo-entry-schema__context" role="status">Loading saved templates</p> : null}
					{library.isError || (loaded && !usable) ? (
						<p className="shipit-seo-entry-schema__context" role="alert">
							{loaded?.state === "corrupt"
								? "The stored library is invalid, so no template can be copied. The form is unchanged."
								: "Saved templates could not be loaded. The form is unchanged."}
						</p>
					) : null}
					{usable && !shown.length ? (
						<p className="shipit-seo-entry-schema__context">
							{loaded.templates.length ? "No template matches this search." : "No saved templates yet. Save one in the Schema library."}
						</p>
					) : null}
					{shown.length ? (
						<ul className="shipit-seo-entry-schema__picker-list">
							{shown.map((template) => (
								<li key={template.id}>
									<span>{template.name}</span>
									<Button
										type="button"
										size="sm"
										variant="secondary"
										disabled={disabled}
										aria-label={`Copy ${template.name} into this form`}
										onClick={() => {
											store.dispatch({ type: "apply-template", template: { id: template.id, name: template.name, json: template.json }, id: newEntrySchemaId(), replace: false });
											close();
										}}
									>
										Copy
									</Button>
								</li>
							))}
						</ul>
					) : null}
					<p className="shipit-seo-entry-schema__context">
						Copying fills this form only. The copy is saved with Save schema as this entry's own record and does not
						change when the template is edited or deleted. <a href={`${SEO_WORKSPACE_URL}?view=library`}>Open the Schema library</a>
					</p>
					<div className="shipit-seo-entry-schema__actions">
						<Button type="button" size="sm" variant="secondary" onClick={close}>Close</Button>
					</div>
				</div>
			) : (
				<Button
					ref={triggerRef}
					type="button"
					size="sm"
					variant="secondary"
					icon={<Books size={14} aria-hidden="true" />}
					disabled={disabled || pendingTemplate !== null}
					aria-expanded={false}
					onClick={() => setOpen(true)}
				>
					Copy from library
				</Button>
			)}
		</div>
	);
}

/** The Preview action and its answer for the open form. */
export function EntrySchemaCandidatePreview({
	panel,
	candidates,
	target,
	canPreview,
	actions,
}: {
	panel: EntrySchemaPanelStore;
	candidates: EntrySchemaCandidateStore;
	target: EntrySchemaCandidateTarget;
	canPreview: boolean;
	actions?: React.ReactNode;
}) {
	const panelState = React.useSyncExternalStore(panel.subscribe, panel.get, panel.get);
	const state = React.useSyncExternalStore(candidates.subscribe, candidates.get, candidates.get);
	const editor = panelState.editor;
	const view = entrySchemaCandidateView(state, editor, target);
	const resultRef = React.useRef<HTMLDivElement>(null);
	React.useEffect(() => {
		if (view.status === "shown") resultRef.current?.focus();
	}, [view.status, state.settled?.requestId]);
	if (!editor) return null;

	const run = () => {
		const current = panel.get().editor;
		if (current) void requestEntrySchemaCandidatePreview(candidates, candidatePort, target, current);
	};

	const renderOutcome = () => {
		if (view.status === "stale") {
			return <p className="shipit-seo-entry-schema__context" role="status">The form changed after the last preview. Choose Preview to see this version.</p>;
		}
		if (view.status !== "shown") return null;
		const outcome = view.outcome;
		if (outcome.kind === "error") {
			return <Banner variant="error" icon={bannerIcon("error")} title="No preview" description={outcome.message} />;
		}
		const result = outcome.value;
		if (!result.success) {
			const description = result.error === "invalid_values"
				? Object.values(result.errors).join(" ")
				: result.message;
			return <Banner variant={result.error === "conflict" ? "alert" : "error"} icon={bannerIcon(result.error === "conflict" ? "alert" : "error")} title="No preview" description={description} />;
		}
		const output = entrySchemaCandidateOutputState(result);
		const candidate = result.items.find((item) => item.id === result.candidate.graphId);
		const others = result.items.filter((item) => item.id !== result.candidate.graphId);
		return (
			<div className="shipit-seo-entry-schema__candidate" ref={resultRef} tabIndex={-1} role="region" aria-label="Unsaved preview">
				<p className="shipit-seo-entry-schema__context">
					The predicted JSON-LD from this plugin for this entry if this form were saved now, from the saved content shown in this
					editor and the schemas read for this preview at {new Date(result.generatedAt).toLocaleTimeString()}. It is not
					the whole page: EmDash, your theme and other plugins can add JSON-LD. A later save reads the stored records again.
				</p>
				<p className="shipit-seo-entry-schema__candidate-state" data-tone={output.tone}>{output.label}</p>
				{result.canonicalSource === "page" ? (
					<p className="shipit-seo-entry-schema__context">
						The preview uses the registered public URL when available. A canonical URL set by your site's template may differ.
					</p>
				) : null}

				{!result.saveCheck.ok ? (
					<Banner variant="alert" icon={bannerIcon("alert")} title="Saving would be refused now" description={result.saveCheck.message} />
				) : null}
				{candidate && candidate.graph !== null ? (
					<div className="shipit-seo-entry-schema__code" role="group" aria-label="Resolved JSON-LD of this form">
						<CodeBlock lang="jsonc" code={JSON.stringify(candidate.graph, null, 2)} />
						<p className="shipit-seo-entry-schema__context">
							{(result.candidate.resolvedBytes ?? 0).toLocaleString("en-US")} of {result.limits.candidateBytes.toLocaleString("en-US")} bytes after variables are filled in.
						</p>
					</div>
				) : null}
				{others.length ? (
					<Collapsible.Root className="shipit-seo-entry-schema__details">
						<Collapsible.DefaultTrigger>Other output from this plugin on this page ({others.length})</Collapsible.DefaultTrigger>
						<Collapsible.DefaultPanel>
							<ul className="shipit-seo-entry-schema__list">
								{others.map((item) => (
									<li key={item.id}>
										<strong>
											{item.name}
											<small>{item.types.join(", ") || "No type"}</small>
											<small className="shipit-seo-entry-schema__output" data-tone={item.emitted ? "active" : "inactive"}>
												{item.emitted ? "Added" : `Not added: ${item.suppressedReason ?? "invalid"}${item.conflictId ? ` (${item.conflictId})` : ""}`}
											</small>
										</strong>
									</li>
								))}
							</ul>
						</Collapsible.DefaultPanel>
					</Collapsible.Root>
				) : null}
			</div>
		);
	};

	return (
		<div className="shipit-seo-entry-schema__preview">
			<div className="shipit-seo-entry-schema__actions">
				<Button
					type="button"
					size="sm"
					variant="secondary"
					icon={<Eye size={14} aria-hidden="true" />}
					loading={view.status === "loading"}
					disabled={!canPreview || view.status === "loading"}
					onClick={run}
				>
					Preview
				</Button>
				{actions ?? <span className="shipit-seo-entry-schema__context">Shows what this unsaved form would add. Nothing is saved.</span>}
			</div>
			{actions ? <p className="shipit-seo-entry-schema__context">Preview predicts this draft. Nothing is saved.</p> : null}
			{renderOutcome()}
		</div>
	);
}
