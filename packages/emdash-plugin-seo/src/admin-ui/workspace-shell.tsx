import * as React from "react";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Input } from "@cloudflare/kumo/components/input";
import { Select } from "@cloudflare/kumo/components/select";
import { useKumoToastManager } from "@cloudflare/kumo/components/toast";
import {
	ArrowBendUpRight, ArrowClockwise, ArrowsClockwise, ArrowsLeftRight, Books,
	BracketsCurly, ChartLine, FileMagnifyingGlass, FileText,
	GlobeHemisphereWest, House, ListChecks, ListMagnifyingGlass, MagnifyingGlass, MapPin, PaperPlaneTilt, Plugs, Robot,
	ShareNetwork, ShieldCheck, SlidersHorizontal, TreeStructure, WarningCircle, X,
	type Icon,
} from "@phosphor-icons/react";

import { useSeoBrand } from "./brand-context.ts";
import { SeoBrandMark } from "./brand-mark.tsx";
import type { SeoAdminView } from "./content-extension-model.ts";
import { useSeoI18n } from "./i18n/index.ts";
import {
	SEO_WORKSPACE_INDEXING_VIEWS,
	describeSeoContractMismatch,
	isSeoContractMismatchError,
	seoWorkspaceIndexingTools,
	seoWorkspaceRail,
	seoWorkspaceSearch,
	seoWorkspaceTopScroll,
	seoWorkspaceVisibleNavGroups,
	type SeoScrollAncestor,
	type SeoSettingSearchEntry,
} from "./workspace-model.ts";

const DESTINATION_ICONS: Record<SeoAdminView, Icon> = {
	overview: House, queue: ListChecks, content: FileMagnifyingGlass, trends: ChartLine,
	templates: FileText, schema: BracketsCurly, library: Books, identity: MapPin, indexing: ListChecks,
	site: GlobeHemisphereWest, social: ShareNetwork, modules: SlidersHorizontal, verification: ShieldCheck,
	migration: ArrowsClockwise, portability: ArrowsLeftRight,
	sitemap: TreeStructure, robots: Robot, indexnow: PaperPlaneTilt, llms: FileText,
	crawl: MagnifyingGlass, monitor404: ArrowBendUpRight,
};

const SETTING_FOCUS_TIMEOUT_MS = 4_000;
const FOCUSABLE_CONTROL = "input, textarea, select, button, [tabindex]";
/** A radio group is focused on its checked option: focusing another option can select it. */
const CHECKED_RADIO = '[role="radio"][aria-checked="true"]';
let settingFocusRequest = 0;

/** Waits for the marked field to render, opens enclosing disclosures and focuses it; a newer request cancels an older one. */
export function focusSettingField(id: string, timeoutMs = SETTING_FOCUS_TIMEOUT_MS): void {
	if (typeof document === "undefined" || typeof window === "undefined") return;
	const request = ++settingFocusRequest;
	const deadline = Date.now() + timeoutMs;
	const attempt = () => {
		if (request !== settingFocusRequest) return;
		const marked = document.querySelector<HTMLElement>(`[data-seo-setting="${id}"]`);
		const control = marked?.matches(FOCUSABLE_CONTROL) ? marked
			: marked?.querySelector<HTMLElement>(CHECKED_RADIO) ?? marked?.querySelector<HTMLElement>(FOCUSABLE_CONTROL) ?? null;
		if (control && !control.closest("[hidden]")) {
			for (let node = control.parentElement; node; node = node.parentElement) {
				if (node.tagName === "DETAILS" && !(node as HTMLDetailsElement).open) (node as HTMLDetailsElement).open = true;
			}
			control.focus();
			control.scrollIntoView?.({ block: "center" });
			return;
		}
		if (Date.now() < deadline) window.setTimeout(attempt, 100);
	};
	window.setTimeout(attempt, 0);
}

/** Brings the workspace top back into view after a page change, scrolling only the container `seoWorkspaceTopScroll` chooses. */
export function revealWorkspaceTop(workspace: HTMLElement): void {
	if (typeof document === "undefined" || typeof window === "undefined") return;
	const ancestors: SeoScrollAncestor<HTMLElement>[] = [];
	for (let node = workspace.parentElement; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
		ancestors.push({ node, overflowY: window.getComputedStyle(node).overflowY, scrollable: node.scrollHeight > node.clientHeight, top: node.getBoundingClientRect().top });
	}
	const scroll = seoWorkspaceTopScroll(workspace.getBoundingClientRect().top, ancestors);
	if (!scroll) return;
	const container = scroll.container ?? document.scrollingElement ?? document.documentElement;
	container.scrollTop += scroll.by;
}

export function WorkspaceNavigation({ value, counts, hiddenViews = [], onChange }: {
	value: SeoAdminView;
	counts?: Partial<Record<SeoAdminView, number>>;
	hiddenViews?: readonly SeoAdminView[];
	onChange: (view: SeoAdminView) => void;
}) {
	const { locale, t } = useSeoI18n();
	const brand = useSeoBrand();
	const [search, setSearch] = React.useState("");
	const searchInput = React.useRef<HTMLInputElement>(null);
	const idBase = React.useId();
	React.useEffect(() => { setSearch(""); }, [value]);
	const groups = seoWorkspaceVisibleNavGroups(hiddenViews);
	const allViews = groups.flatMap((group) => [...group.views]);
	const rail = seoWorkspaceRail(value, hiddenViews);
	const query = search.trim();
	const results = seoWorkspaceSearch(search, {
		locale,
		views: allViews,
		viewLabel: (view) => t(`nav.view.${view}`),
		settingLabel: (id) => t(`nav.setting.${id}`),
	});
	const matchCount = results.views.length + results.settings.length;
	const clearSearch = () => { setSearch(""); searchInput.current?.focus(); };
	const select = (view: SeoAdminView) => {
		if (view === value) return;
		if (query) searchInput.current?.focus();
		onChange(view);
	};
	const openSetting = (entry: SeoSettingSearchEntry) => {
		if (entry.view === value) clearSearch();
		else select(entry.view);
		if (entry.field) focusSettingField(entry.id);
	};
	const row = (view: SeoAdminView, current: "page" | "true" | null, group?: "indexing") => {
		const count = counts?.[view] ?? 0;
		const ItemIcon = group ? ListMagnifyingGlass : DESTINATION_ICONS[view];
		return <button key={view} type="button" data-destination={view} data-rail-group={group}
			className={`shipit-seo-workspace-nav__item${current ? " shipit-seo-workspace-nav__item--active" : ""}`}
			aria-current={current ?? undefined}
			onClick={() => { if (current !== "true") select(view); }}>
			{ItemIcon ? <ItemIcon size={18} aria-hidden="true" /> : null}
			<span className="shipit-seo-workspace-nav__label">{group ? t(`nav.group.${group}`) : t(`nav.view.${view}`)}</span>
			{count > 0 ? <span className="shipit-seo-workspace-nav__count" aria-label={t("nav.attentionCount", { count })}>{count > 99 ? "99+" : count}</span> : null}
		</button>;
	};
	const settingRow = (entry: SeoSettingSearchEntry) => {
		const ItemIcon = DESTINATION_ICONS[entry.view];
		return <button key={entry.id} type="button" data-setting={entry.id}
			className="shipit-seo-workspace-nav__item shipit-seo-workspace-nav__item--setting" onClick={() => openSetting(entry)}>
			<ItemIcon size={18} aria-hidden="true" />
			<span className="shipit-seo-workspace-nav__label">
				{t("nav.settingResult", { setting: t(`nav.setting.${entry.id}`), page: t(`nav.view.${entry.view}`) })}
			</span>
		</button>;
	};
	if (!allViews.length) return null;
	return <nav className="shipit-seo-workspace-nav" aria-label={t("nav.workspace")}>
		<div className="shipit-seo-workspace-nav__brand" data-brand={brand.kind}>
			<SeoBrandMark brand={brand} /><h1>{brand.name}</h1>
		</div>
		<div className="shipit-seo-workspace-nav__search">
			<MagnifyingGlass size={18} aria-hidden="true" className="shipit-seo-workspace-nav__search-icon" />
			<Input ref={searchInput} type="search" aria-label={t("nav.searchLabel")} placeholder={t("nav.searchPlaceholder")}
				value={search} maxLength={120} onChange={(event) => setSearch(event.target.value)}
				onKeyDown={(event) => { if (event.key === "Escape" && search) { event.preventDefault(); clearSearch(); } }} />
			{search ? <button type="button" className="shipit-seo-workspace-nav__clear" aria-label={t("nav.clearSearch")} onClick={clearSearch}><X size={16} aria-hidden="true" /></button> : null}
		</div>
		{query ? <div className="shipit-seo-workspace-nav__results" role="group" aria-label={t("nav.searchLabel")}>
			<p role="status" className={matchCount ? "sr-only" : "shipit-seo-workspace-nav__empty"}>{matchCount ? t("nav.searchResults", { count: matchCount }) : t("nav.searchEmpty")}</p>
			{results.views.map((view) => row(view, view === value ? "page" : null))}
			{results.settings.map(settingRow)}
		</div> : <>
			<div className="shipit-seo-workspace-nav__compact">
				<Select<SeoAdminView> label={t("nav.destination")} placeholder={t("nav.chooseDestination")}
					value={allViews.includes(value) ? value : null}
					items={Object.fromEntries(allViews.map((view) => [view, t(`nav.view.${view}`)]))}
					onValueChange={(next) => { if (next && allViews.includes(next)) select(next); }}>
					{groups.map((group) => <Select.Group key={group.id}>
						{group.id === "overview" ? null : <Select.GroupLabel>{t(`nav.group.${group.id}`)}</Select.GroupLabel>}
						{group.views.map((view) => <Select.Option key={view} value={view}>{t(`nav.view.${view}`)}</Select.Option>)}
					</Select.Group>)}
				</Select>
			</div>
			<div className="shipit-seo-workspace-nav__desktop">
				{rail.map((group) => {
					const headingId = `${idBase}-${group.id}`;
					return <div key={group.id} className="shipit-seo-workspace-nav__section" role="group"
						{...(group.heading ? { "aria-labelledby": headingId } : { "aria-label": t(`nav.group.${group.id}`) })}>
						{group.heading ? <p id={headingId} className="shipit-seo-workspace-nav__heading">{t(`nav.group.${group.id}`)}</p> : null}
						{group.rows.map((item) => row(item.view, item.current, item.kind === "group" ? item.group : undefined))}
					</div>;
				})}
			</div>
		</>}
	</nav>;
}

/** The rail has one Indexing row, so this is where every width lists the Indexing tools. */
export function IndexingNavigation({ value, hiddenViews = [], onChange }: {
	value: SeoAdminView;
	hiddenViews?: readonly SeoAdminView[];
	onChange: (view: SeoAdminView) => void;
}) {
	const { t } = useSeoI18n();
	const focused = React.useRef(false);
	const active = SEO_WORKSPACE_INDEXING_VIEWS.includes(value);
	const tools = seoWorkspaceIndexingTools(hiddenViews);
	React.useLayoutEffect(() => {
		if (active || !focused.current) return;
		focused.current = false;
		if (typeof document !== "undefined") document.querySelector<HTMLInputElement>(".shipit-seo-workspace-nav__search input")?.focus();
	}, [active]);
	if (!active || !tools.length) return null;
	return <nav className="shipit-seo-indexing-nav" aria-label={t("nav.indexingTools")}
		onFocusCapture={() => { focused.current = true; }}
		onBlurCapture={(event) => { focused.current = event.currentTarget.contains(event.relatedTarget as Node | null); }}>
		{tools.map((view) => {
			const ItemIcon = DESTINATION_ICONS[view];
			return <button key={view} type="button" data-indexing-destination={view}
				aria-current={view === value ? "page" : undefined} onClick={() => { if (view !== value) onChange(view); }}>
				<ItemIcon size={16} aria-hidden="true" />
				<span>{t(`nav.view.${view}`)}</span>
			</button>;
		})}
	</nav>;
}

export function ViewSkeleton({ label }: { label: string }) {
	return (
		<div className="shipit-seo-loading" role="status" aria-live="polite">
			<div className="shipit-seo-loading__bar" />
			<div className="shipit-seo-loading__grid">
				<div />
				<div />
				<div />
			</div>
			<span>{label}</span>
		</div>
	);
}

export function ContractMismatchScreen({
	error,
	onRetry,
}: {
	error: unknown;
	onRetry?: () => void;
}) {
	const brand = useSeoBrand();
	const details = describeSeoContractMismatch(error);
	if (!details) return null;
	return (
		<section
			className="shipit-seo-panel shipit-seo-contract-mismatch"
			role="alert"
			aria-labelledby="seo-contract-mismatch-title"
		>
			<span className="shipit-seo-contract-mismatch__icon" aria-hidden="true">
				<Plugs size={26} weight="fill" />
			</span>
			<h2 id="seo-contract-mismatch-title">
				{details.kind === "version"
					? "SEO engine and admin versions do not match"
					: "The SEO engine sent an unexpected response"}
			</h2>
			<p>
				{details.kind === "version"
					? `The ${brand.name} engine answered with a different admin contract version than this admin build understands. Data is left untouched until the versions match.`
					: "The response did not match the strict admin contract this build was compiled against. This usually means the engine and admin packages are from different releases."}
			</p>
			<dl className="shipit-seo-contract-mismatch__versions">
				<div>
					<dt>Admin expects contract</dt>
					<dd>v{details.expected}</dd>
				</div>
				<div>
					<dt>Engine reported</dt>
					<dd>{details.received ?? "Unknown"}</dd>
				</div>
			</dl>
			<ol className="shipit-seo-contract-mismatch__steps">
				<li>Rebuild {brand.name} so its engine and admin come from the same release.</li>
				<li>Restart EmDash so the rebuilt plugins are loaded.</li>
				<li>If the versions are pinned, install a matching {brand.name} engine and admin pair.</li>
			</ol>
			<details className="shipit-seo-contract-mismatch__detail">
				<summary>Technical detail</summary>
				<code>{details.message}</code>
			</details>
			{onRetry ? (
				<div>
					<Button type="button" variant="secondary" icon={ArrowClockwise} onClick={onRetry}>
						Check again
					</Button>
				</div>
			) : null}
		</section>
	);
}

export function ViewErrorState({
	title,
	error,
	onRetry,
	retryLabel = "Retry",
}: {
	title: string;
	error: unknown;
	onRetry?: () => void;
	retryLabel?: string;
}) {
	if (isSeoContractMismatchError(error)) {
		return <ContractMismatchScreen error={error} onRetry={onRetry} />;
	}
	const description = error instanceof Error ? error.message : "The request failed.";
	return (
		<Banner
			role="alert"
			variant="error"
			icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
			title={title}
			description={description}
			action={onRetry ? (
				<Button size="sm" variant="secondary" onClick={onRetry}>{retryLabel}</Button>
			) : undefined}
		/>
	);
}

interface ViewBoundaryProps {
	/** Changing this key clears a captured render error (e.g. on view switch). */
	resetKey: string;
	children: React.ReactNode;
}

interface ViewBoundaryState {
	error: Error | null;
}

/**
 * Containment for render-time throws: one broken view shows an inline failure
 * card instead of blanking the whole plugin page.
 */
export class SeoViewBoundary extends React.Component<ViewBoundaryProps, ViewBoundaryState> {
	state: ViewBoundaryState = { error: null };

	static getDerivedStateFromError(error: Error): ViewBoundaryState {
		return { error };
	}

	componentDidUpdate(previous: ViewBoundaryProps) {
		if (previous.resetKey !== this.props.resetKey && this.state.error) {
			this.setState({ error: null });
		}
	}

	render() {
		if (this.state.error) {
			if (isSeoContractMismatchError(this.state.error)) {
				return (
					<ContractMismatchScreen
						error={this.state.error}
						onRetry={() => this.setState({ error: null })}
					/>
				);
			}
			return (
				<section className="shipit-seo-panel shipit-seo-view-crash" role="alert">
					<span className="shipit-seo-view-crash__icon" aria-hidden="true">
						<WarningCircle size={22} weight="fill" />
					</span>
					<div>
						<strong>This view failed to render</strong>
						<p>{this.state.error.message || "An unexpected rendering error occurred."}</p>
					</div>
					<Button
						type="button"
						size="sm"
						variant="secondary"
						icon={ArrowClockwise}
						onClick={() => this.setState({ error: null })}
					>
						Reset view
					</Button>
				</section>
			);
		}
		return this.props.children;
	}
}

export interface SeoToastApi {
	success: (title: string, description?: string) => void;
	error: (title: string, description?: string) => void;
}

/**
 * Toast feedback for save/reset flows. Must be used below the <Toasty>
 * provider that SeoAdminPage renders. Inline aria-live text stays in place;
 * toasts add visibility when the status line is scrolled out of view.
 */
export function useSeoToasts(): SeoToastApi {
	const manager = useKumoToastManager();
	return React.useMemo(
		() => ({
			success: (title: string, description?: string) => {
				manager.add({
					title,
					...(description ? { description } : {}),
					variant: "success",
					timeout: 5_000,
				});
			},
			error: (title: string, description?: string) => {
				manager.add({
					title,
					...(description ? { description } : {}),
					variant: "error",
					timeout: 8_000,
				});
			},
		}),
		[manager],
	);
}

/** Reports whether the form under `key` holds work that unmounting its view would lose. */
export type WorkspaceDraftReport = (key: string, held: boolean) => void;

const WorkspaceDraftContext = React.createContext<WorkspaceDraftReport | null>(null);

/**
 * The workspace keeps a page mounted, hidden, while any form in it holds work,
 * and unmounts it once none does, so a clean page reads its stored state again
 * when it is next opened. Nothing is saved automatically.
 */
export const WorkspaceDraftProvider = WorkspaceDraftContext.Provider;

/**
 * Holds this form's page while it has unsaved edits, a write in flight or an
 * outcome it still has to show. Unmounting releases the hold.
 */
export function useWorkspaceDraftHold(key: string, held: boolean): void {
	const report = React.useContext(WorkspaceDraftContext);
	React.useEffect(() => {
		report?.(key, held);
	}, [report, key, held]);
	React.useEffect(() => () => report?.(key, false), [report, key]);
}

const WorkspacePageActiveContext = React.createContext(true);

/** False while a kept page is hidden behind the open page. */
export const WorkspacePageActiveProvider = WorkspacePageActiveContext.Provider;

/**
 * Dialogs portal outside their page, so a kept page closes them while it is
 * hidden; otherwise one would stay over the open page or reopen on return.
 */
export function useWorkspacePageActive(): boolean {
	return React.useContext(WorkspacePageActiveContext);
}
