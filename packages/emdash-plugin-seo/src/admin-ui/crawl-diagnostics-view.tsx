import * as React from "react";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Table } from "@cloudflare/kumo/components/table";
import { Tabs } from "@cloudflare/kumo/components/tabs";
import {
	ArrowClockwise,
	CheckCircle,
	LinkBreak,
	PencilSimple,
	WarningCircle,
} from "@phosphor-icons/react";
import type { SeoAdminCrawlDiagnostics } from "@shipitseo/emdash-plugin-seo/admin-contract";

import { fetchSeoAdminCrawlDiagnostics } from "./api.ts";
import { contentEditorUrl } from "./content-editor-url.ts";
import { CrawlResultControls } from "./crawl-diagnostics-controls.tsx";
import { crawlResultTypes, pageCrawlResults, type CrawlResultFilter } from "./crawl-diagnostics-model.ts";
import { RenderedCrawlView } from "./rendered-crawl-view.tsx";
import { WRAPPING_TABS, useTablistName } from "./workspace-tabs.ts";

function InternalGraphView() {
	const [data, setData] = React.useState<SeoAdminCrawlDiagnostics | null>(null);
	const [loading, setLoading] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const [linkFilter, setLinkFilter] = React.useState<CrawlResultFilter>({ query: "", type: "", page: 1 });
	const [orphanFilter, setOrphanFilter] = React.useState<CrawlResultFilter>({ query: "", type: "", page: 1 });
	const request = React.useRef(0);
	React.useEffect(() => () => { request.current += 1; }, []);
	const load = React.useCallback(async () => {
		const current = ++request.current;
		setData(null);
		setLoading(true);
		setError(null);
		try {
			const result = await fetchSeoAdminCrawlDiagnostics();
			if (current !== request.current) return;
			setData(result);
			setLinkFilter({ query: "", type: "", page: 1 });
			setOrphanFilter({ query: "", type: "", page: 1 });
		} catch (cause) {
			if (current === request.current) setError(cause instanceof Error ? cause.message : "Failed to load crawl diagnostics");
		} finally {
			if (current === request.current) setLoading(false);
		}
	}, []);

	const links = pageCrawlResults(data?.unresolvedLinks ?? [], linkFilter, (item) => ({ type: item.sourceCollection, text: `${item.sourceTitle} ${item.sourcePath} ${item.targetPath} ${item.anchorText}` }));
	const orphans = pageCrawlResults(data?.orphanEntries ?? [], orphanFilter, (item) => ({ type: item.collection, text: `${item.title} ${item.path}` }));
	if (!data && !loading && !error) return <section className="shipit-seo-panel shipit-seo-rendered-intro">
		<Empty size="sm" icon={<LinkBreak size={32} aria-hidden="true" />} title="Check a content sample" description="Compare links in up to 1,000 content records across all content types. This checks saved content, without fetching public pages or changing content." />
		<Button onClick={() => void load()}>Analyze sample</Button>
		<p className="shipit-seo-muted">Large sites receive a bounded sample, not a complete site audit.</p>
	</section>;

	if (loading && !data) {
		return <section className="shipit-seo-panel shipit-seo-crawl-loading" aria-busy="true">Analyzing the content sample...</section>;
	}

	return (
		<div className="shipit-seo-crawl-view">
			{error ? (
				<Banner
					variant="error"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title="Crawl diagnostics unavailable"
					description={error}
					action={<Button size="sm" variant="secondary" onClick={() => void load()}>Retry</Button>}
				/>
			) : null}

			{data ? (
				<>
					<section className="shipit-seo-panel shipit-seo-crawl-overview">
						<div className="shipit-seo-section-heading">
							<div>
								<span className="shipit-seo-eyebrow">Internal link graph</span>
								<h2>Content link sample</h2>
								<p>Checks published routes and structured body links in the sampled records. Unresolved links and unlinked entries need review against the live site.</p>
							</div>
							<Button variant="secondary" icon={ArrowClockwise} loading={loading} disabled={loading} onClick={() => void load()}>
								Analyze again
							</Button>
						</div>

						<div className="shipit-seo-crawl-summary" aria-label="Crawl diagnostics summary">
							<div><span>Published entries checked</span><strong>{data.summary.scannedEntries}</strong></div>
							<div><span>Links matched in sample</span><strong>{data.summary.matchedInternalLinks}</strong></div>
							<div><span>Unresolved links</span><strong>{data.summary.unresolvedInternalLinks}</strong></div>
							<div><span>Possible orphans</span><strong>{data.summary.possibleOrphans}</strong></div>
						</div>

						<p className="shipit-seo-muted">{data.limits.inspectedRecords} records inspected · {data.summary.scannedLinks} links checked. Limits: {data.limits.maxEntries.toLocaleString()} records total, {data.limits.maxLinks.toLocaleString()} links. Results describe this sample only.</p>
						{data.coverage === "partial" ? (
							<Banner
								variant="alert"
								icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
								title="Sample coverage is limited"
								description={`Findings cover only the sampled routes and links. ${data.limits.reachedEntryLimit ? "The record limit was reached. " : ""}${data.limits.reachedLinkLimit ? "The link limit was reached. " : ""}${data.limits.reachedDocumentLimit ? "Some body content exceeded the reading limit. " : ""}${data.summary.partialSources ? "Template or unstructured content is not fully read. " : ""}Routes outside the sample, navigation and custom templates may explain these findings.`}
							/>
						) : null}
						{data.summary.scannedEntries === 0 ? (
							<Banner
								variant="alert"
								icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
								title="No published entries in this sample"
								description="The content graph has no published EmDash entries with public routes. Run the rendered crawl to inspect the live site."
							/>
						) : null}
					</section>

					<section className="shipit-seo-panel shipit-seo-crawl-section">
						<div className="shipit-seo-section-heading shipit-seo-crawl-section__heading">
							<div>
								<span className="shipit-seo-eyebrow">Link integrity</span>
								<h3>Unresolved internal links</h3>
								<p>These destinations did not match a route among the scanned entries. Confirm the rendered URL before changing content.</p>
							</div>
							<Badge variant={data.unresolvedLinks.length ? "warning" : "success"}>{data.summary.unresolvedInternalLinks}</Badge>
						</div>

						{data.unresolvedLinks.length ? <>
							<p className="shipit-seo-muted">{data.unresolvedLinks.length} available of {data.summary.unresolvedInternalLinks} unresolved links in this sample.{data.limits.unresolvedLinksOmitted ? ` ${data.limits.unresolvedLinksOmitted} additional findings are outside the result limit.` : ""} Search and filters apply to available results.</p>
							<CrawlResultControls label="unresolved links" filter={linkFilter} page={links} types={crawlResultTypes(data.unresolvedLinks, (item) => item.sourceCollection).map((value) => ({ value, label: value }))} typeLabel="Content type" onChange={setLinkFilter} />
							{!links.filteredCount ? <p role="status">No matching links. Clear the filters to see available results.</p> : null}
							<div className="shipit-seo-table-wrap shipit-seo-table-wrap--fluid">
								<Table>
									<Table.Header>
										<Table.Row>
											<Table.Head>Source</Table.Head>
											<Table.Head>Target</Table.Head>
											<Table.Head>Link text</Table.Head>
											<Table.Head><span className="sr-only">Action</span></Table.Head>
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{links.items.map((item) => (
											<Table.Row key={item.id}>
												<Table.Cell>
													<div className="shipit-seo-crawl-source">
														<strong>{item.sourceTitle}</strong>
														<code>{item.sourcePath}</code>
													</div>
													<div className="shipit-seo-mobile-meta">
														<p>Links to <code>{item.targetPath}</code></p>
														<p>{item.anchorText ? `Link text: ${item.anchorText}` : "No link text"}</p>
														<div>
															<Button size="sm" variant="secondary" icon={PencilSimple}
																onClick={() => window.location.assign(contentEditorUrl(item.sourceCollection, item.sourceEntryId))}>
																Edit source
															</Button>
														</div>
													</div>
												</Table.Cell>
												<Table.Cell><code className="shipit-seo-crawl-target">{item.targetPath}</code></Table.Cell>
												<Table.Cell>{item.anchorText || <span className="shipit-seo-muted">No text</span>}</Table.Cell>
												<Table.Cell>
												<Button
													size="sm"
													variant="secondary"
													icon={PencilSimple}
													onClick={() => window.location.assign(contentEditorUrl(item.sourceCollection, item.sourceEntryId))}
													>
														Edit source
													</Button>
												</Table.Cell>
											</Table.Row>
										))}
									</Table.Body>
								</Table>
							</div>
						</> : (
							<Empty
								size="sm"
								icon={<CheckCircle size={32} aria-hidden="true" />}
								title={data.summary.scannedEntries ? "No unresolved links in the scanned content" : "No entries to inspect"}
								description={data.summary.scannedEntries
								? "Links found in the scanned structured content match routes known to this graph."
								: "Published EmDash entries will appear here when they have public routes."}
							/>
						)}
					</section>

					<section className="shipit-seo-panel shipit-seo-crawl-section">
						<div className="shipit-seo-section-heading shipit-seo-crawl-section__heading">
							<div>
								<span className="shipit-seo-eyebrow">Discovery</span>
								<h3>Possible unlinked entries</h3>
								<p>Published entries with no resolved noindex directive and no incoming link in this content graph. Confirm the rendered page before acting.</p>
							</div>
							<Badge variant={data.orphanEntries.length ? "warning" : "success"}>{data.summary.possibleOrphans}</Badge>
						</div>

						{data.orphanEntries.length ? <>
							<p className="shipit-seo-muted">{data.orphanEntries.length} available of {data.summary.possibleOrphans} unlinked candidates in this sample.{data.limits.orphanEntriesOmitted ? ` ${data.limits.orphanEntriesOmitted} additional findings are outside the result limit.` : ""} Search and filters apply to available results.</p>
							<CrawlResultControls label="unlinked candidates" filter={orphanFilter} page={orphans} types={crawlResultTypes(data.orphanEntries, (item) => item.collection).map((value) => ({ value, label: value }))} typeLabel="Content type" onChange={setOrphanFilter} />
							{!orphans.filteredCount ? <p role="status">No matching entries. Clear the filters to see available results.</p> : null}
							<div className="shipit-seo-table-wrap shipit-seo-table-wrap--fluid">
								<Table>
									<Table.Header>
										<Table.Row>
											<Table.Head>Entry</Table.Head>
											<Table.Head>Collection</Table.Head>
											<Table.Head>Confidence</Table.Head>
											<Table.Head><span className="sr-only">Action</span></Table.Head>
										</Table.Row>
									</Table.Header>
									<Table.Body>
										{orphans.items.map((item) => (
											<Table.Row key={item.ref}>
												<Table.Cell>
													<div className="shipit-seo-crawl-source">
														<strong>{item.title}</strong>
														<code>{item.path}</code>
													</div>
													<div className="shipit-seo-mobile-meta">
														<div>
															<span>{item.collection}</span>
															<Badge variant={item.confidence === "high" ? "error" : "warning"}>
																{item.confidence === "high" ? "High" : "Review"}
															</Badge>
														</div>
														<div>
															<Button size="sm" variant="secondary" icon={PencilSimple}
																onClick={() => window.location.assign(contentEditorUrl(item.collection, item.entryId))}>
																Edit entry
															</Button>
														</div>
													</div>
												</Table.Cell>
												<Table.Cell>{item.collection}</Table.Cell>
												<Table.Cell>
													<Badge variant={item.confidence === "high" ? "error" : "warning"}>
														{item.confidence === "high" ? "High" : "Review"}
													</Badge>
												</Table.Cell>
												<Table.Cell>
												<Button
													size="sm"
													variant="secondary"
													icon={PencilSimple}
													onClick={() => window.location.assign(contentEditorUrl(item.collection, item.entryId))}
													>
														Edit entry
													</Button>
												</Table.Cell>
											</Table.Row>
										))}
									</Table.Body>
								</Table>
							</div>
						</> : (
							<Empty
								size="sm"
								icon={<LinkBreak size={32} aria-hidden="true" />}
								title={data.summary.scannedEntries ? "No unlinked candidates in the scanned content" : "No entries to inspect"}
								description={data.summary.scannedEntries
								? "No scanned entry qualifies as unlinked in the available graph."
								: "Published EmDash entries will appear here when they have public routes."}
							/>
						)}
					</section>
				</>
			) : null}
		</div>
	);
}

export function CrawlDiagnosticsView() {
	const [mode, setMode] = React.useState<"graph" | "rendered">("graph");
	const tabsRef = useTablistName<HTMLDivElement>({ label: "Crawl diagnostics sections" });
	return (
		<div ref={tabsRef} className="shipit-seo-crawl-workspace">
			<Tabs
				variant="segmented"
				{...WRAPPING_TABS}
				tabs={[
					{ value: "graph", label: "Content graph" },
					{ value: "rendered", label: "Rendered crawl" },
				]}
				value={mode}
				onValueChange={(value) => {
					if (value === "graph" || value === "rendered") setMode(value);
				}}
			/>
			{mode === "graph" ? <InternalGraphView /> : <RenderedCrawlView />}
		</div>
	);
}
