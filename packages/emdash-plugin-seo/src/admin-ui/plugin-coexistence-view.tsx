import * as React from "react";
import { apiFetch, parseApiResponse } from "@emdash-cms/admin";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { ArrowClockwise, ArrowRight, CheckCircle, WarningCircle } from "@phosphor-icons/react";

import type { CoexistencePeer, CoexistenceSurface } from "../plugin-coexistence.ts";
import { seoAdminApiUrl } from "./api-routes.ts";
import type { SeoAdminView } from "./content-extension-model.ts";
import {
	PLUGIN_COEXISTENCE_SURFACE_LABELS,
	PLUGIN_COEXISTENCE_VIEW_SURFACES,
	boundedPluginCoexistenceResponse,
	createPluginCoexistenceReader,
	pluginOverlapForView,
	pluginOverlapRows,
	type PluginCoexistenceReader,
	type PluginCoexistenceReadState,
	type PluginOverlapRow,
} from "./plugin-coexistence-model.ts";

const PLUGINS_MANAGER_PATH = "/_emdash/admin/plugins-manager";

async function readPluginCoexistence(signal: AbortSignal): Promise<unknown> {
	const response = await apiFetch(seoAdminApiUrl("admin-plugin-coexistence"), { signal, cache: "no-store" });
	return parseApiResponse<unknown>(await boundedPluginCoexistenceResponse(response, signal), "Plugin status could not be read.");
}

// One read serves every notice in this admin document; Feature controls and Check again read again.
let sharedState: PluginCoexistenceReadState = { status: "loading" };
let sharedRequested = false;
let sharedReader: PluginCoexistenceReader | null = null;
const sharedListeners = new Set<() => void>();

function coexistenceReader(): PluginCoexistenceReader {
	sharedReader ??= createPluginCoexistenceReader({
		read: readPluginCoexistence,
		onState: (next) => {
			sharedState = next;
			for (const listener of sharedListeners) listener();
		},
	});
	return sharedReader;
}

function subscribeCoexistence(listener: () => void): () => void {
	sharedListeners.add(listener);
	return () => { sharedListeners.delete(listener); };
}

function coexistenceSnapshot(): PluginCoexistenceReadState {
	return sharedState;
}

function usePluginCoexistence(refresh: boolean): { state: PluginCoexistenceReadState; retry: () => void } {
	const state = React.useSyncExternalStore(subscribeCoexistence, coexistenceSnapshot, coexistenceSnapshot);
	React.useEffect(() => {
		if (!refresh && sharedRequested) return;
		sharedRequested = true;
		void coexistenceReader().load();
	}, [refresh]);
	return { state, retry: () => { sharedRequested = true; void coexistenceReader().load(); } };
}

function peerStatus(peer: CoexistencePeer): string {
	if (peer.state === "absent") return "Not installed";
	if (peer.state === "inactive") return "Inactive";
	if (peer.assessment === "inspection-only") return "Inspection tool";
	if (peer.assessment === "unassessed") return "Unassessed version";
	return peer.assessment === "potential-overlap" ? "Potential overlap" : "Output overlap";
}

function overlapStatus(row: PluginOverlapRow): string {
	return `${row.assessment === "observed-overlap" ? "Output overlap" : "Potential overlap"}${row.versionUnassessed ? " (unassessed version)" : ""}`;
}

function joinNames(names: readonly string[]): string {
	if (names.length < 2) return names[0] ?? "";
	return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function surfaceList(surfaces: readonly CoexistenceSurface[]): string {
	return surfaces.map((surface) => PLUGIN_COEXISTENCE_SURFACE_LABELS[surface]).join(", ");
}

export function PluginCoexistenceView() {
	const { state, retry } = usePluginCoexistence(true);
	return <PluginCoexistenceNotice state={state} onRetry={retry} />;
}

export function PluginCoexistenceNotice({ state, onRetry }: {
	state: PluginCoexistenceReadState;
	onRetry: () => void;
}) {
	const inventory = state.status === "ready" ? state.inventory : null;
	const available = inventory?.status === "available" ? inventory : null;
	const rows = available ? pluginOverlapRows(available) : [];
	const others = available?.peers.filter((peer) => peer.state === "active" && peer.surfaces.length === 0) ?? [];
	const unassessed = others.filter((peer) => peer.assessment === "unassessed");
	if (state.status === "loading") return <p className="shipit-seo-muted" role="status">Checking SEO plugin compatibility...</p>;
	if (available && rows.length === 0 && unassessed.length === 0 && available.uncheckedConfiguredCount === 0) {
		return (
			<aside className="shipit-seo-plugin-notice shipit-seo-plugin-notice--clear" aria-label="SEO plugin compatibility">
				<p role="status"><CheckCircle size={18} weight="fill" aria-hidden="true" />No overlapping SEO plugins found.</p>
				<Button type="button" variant="ghost" size="sm" icon={ArrowClockwise} onClick={onRetry}>Check again</Button>
			</aside>
		);
	}

	const title = state.status === "error" ? state.kind === "denied" ? "Plugin access required" : "Plugin status not verified" :
		inventory?.status === "unavailable" ? "SEO compatibility check unavailable" :
		inventory?.status === "unsupported" ? "Compatibility checks unavailable on this host" :
		rows.length > 1 ? "Overlapping SEO plugins detected" : rows.length === 1 ? "Overlapping SEO plugin detected" : "Some plugins are not assessed";
	const description = state.status === "error" ? state.message :
		inventory?.status === "unavailable" ? "This plugin pauses overlapping output until plugin status can be checked." :
		inventory?.status === "unsupported" ? inventory.message :
		rows.length > 0 ? "This plugin paused the features listed for each plugin. Deactivate one of the overlapping plugins in the plugins manager, then check again." :
		"Compatibility checks cover a limited catalog. Review the details for unassessed plugins.";
	const warning = state.status === "error" || inventory?.status === "unavailable" || rows.length > 0;
	return (
		<aside className="shipit-seo-plugin-notice" aria-label="SEO plugin compatibility" aria-live="polite">
			<Banner variant={warning ? "alert" : "secondary"} icon={<WarningCircle size={20} aria-hidden="true" />}
				title={title} description={description} />
			{rows.length ? (
				<ul className="shipit-seo-plugin-notice__rows">
					{rows.map((row) => (
						<li key={row.profileId}>
							<div className="shipit-seo-plugin-notice__name">
								<strong>{row.name}</strong>
								{row.versions.length ? <span>{row.versions.join(", ")}</span> : null}
								<span>{overlapStatus(row)}</span>
							</div>
							<p>Paused in this plugin: {surfaceList(row.surfaces)}</p>
						</li>
					))}
				</ul>
			) : null}
			<div className="shipit-seo-plugin-notice__actions">
				<a href={PLUGINS_MANAGER_PATH}>Manage plugins</a>
				<Button type="button" variant="secondary" size="sm" icon={ArrowClockwise} onClick={onRetry}>Check again</Button>
			</div>
			{inventory && inventory.status !== "unsupported" ? <details>
				<summary>Compatibility details</summary>
				{others.length ? <ul>
					{others.map((peer) => <li key={peer.id}>
						<strong>{peer.name}</strong>{peer.version ? ` ${peer.version}` : ""}: {peerStatus(peer)}
					</li>)}
				</ul> : inventory.status === "unavailable" ? <p>{inventory.reason}</p> : null}
				{available && available.uncheckedConfiguredCount > 0 ? <p>{available.uncheckedConfiguredCount} configured {available.uncheckedConfiguredCount === 1 ? "plugin is" : "plugins are"} outside this catalog.</p> : null}
				{!rows.length && inventory.paused.length > 0 ? <p>Paused features in this plugin: {surfaceList(inventory.paused)}.</p> : null}
				<p>Only the checked catalog is assessed. Other plugins and theme markup may overlap.</p>
				<p>This plugin resumes affected features after a fresh check finds their assessed peers inactive or absent. Checking status does not change plugins or saved settings.</p>
				{inventory.paused.includes("robots") ? <p>Readable saved robots restrictions are carried separately. Unrecognized rules need review. Google combines restrictive rules across tags; other crawlers may differ.</p> : null}
			</details> : null}
		</aside>
	);
}

/** A one-line notice on Overview and on pages whose output is paused; it renders nothing otherwise. */
export function PluginOverlapLine({ view, onOpenModules }: { view: SeoAdminView; onOpenModules: () => void }) {
	if (view !== "overview" && !PLUGIN_COEXISTENCE_VIEW_SURFACES[view]) return null;
	return <PluginOverlapLineContent view={view} onOpenModules={onOpenModules} />;
}

function PluginOverlapLineContent({ view, onOpenModules }: { view: SeoAdminView; onOpenModules: () => void }) {
	const { state } = usePluginCoexistence(false);
	return <PluginOverlapText overlap={pluginOverlapForView(state, view)} overview={view === "overview"} onOpenModules={onOpenModules} />;
}

export function PluginOverlapText({ overlap, overview, onOpenModules }: {
	overlap: ReturnType<typeof pluginOverlapForView>;
	overview: boolean;
	onOpenModules: () => void;
}) {
	if (!overlap) return null;
	const names = joinNames(overlap.names);
	const text = overview
		? `${overlap.names.length === 1 ? "An overlapping SEO plugin is" : "Overlapping SEO plugins are"} active: ${names}. Paused in this plugin: ${surfaceList(overlap.surfaces)}.`
		: `Paused while ${names} ${overlap.names.length === 1 ? "is" : "are"} active: ${surfaceList(overlap.surfaces)}.`;
	return (
		<div className="shipit-seo-overlap-line" role="status">
			<WarningCircle size={18} weight="fill" aria-hidden="true" />
			<span>{text}</span>
			<Button type="button" variant="ghost" size="sm" icon={ArrowRight} aria-label="Review in Feature controls" onClick={onOpenModules}>Review</Button>
		</div>
	);
}
