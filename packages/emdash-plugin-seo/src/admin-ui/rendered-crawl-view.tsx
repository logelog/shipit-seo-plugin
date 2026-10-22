import * as React from "react";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Empty } from "@cloudflare/kumo/components/empty";
import {
	ArrowClockwise,
	ArrowSquareOut,
	CheckCircle,
	GlobeHemisphereWest,
	Play,
	WarningCircle,
} from "@phosphor-icons/react";

import { CrawlResultControls } from "./crawl-diagnostics-controls.tsx";
import { crawlResultTypes, pageCrawlResults, type CrawlResultFilter } from "./crawl-diagnostics-model.ts";

import {
	runSeoRenderedCrawl,
	type SeoRenderedCrawlFinding,
	type SeoRenderedCrawlReport,
	type SeoRenderedCrawlSeverity,
} from "./rendered-crawl.ts";

const FINDING_LABELS: Record<SeoRenderedCrawlFinding["code"], string> = {
	"sitemap-fetch-failed": "Sitemap request failed",
	"sitemap-http-error": "Sitemap HTTP error",
	"sitemap-invalid": "Invalid sitemap",
	"sitemap-too-large": "Sitemap response too large",
	"page-fetch-failed": "Page request failed",
	"page-http-error": "Broken page or link",
	"page-too-large": "Page response too large",
	"page-redirect": "Redirected URL",
	"page-non-html": "Non-HTML response",
	"page-not-in-sitemap": "Missing from sitemap",
	"title-missing": "Missing page title",
	"title-duplicate": "Duplicate title elements",
	"description-missing": "Missing meta description",
	"canonical-missing": "Missing canonical",
	"canonical-invalid": "Invalid canonical",
	"canonical-mismatch": "Canonical mismatch",
	"robots-noindex": "Sitemap URL is noindex",
	"h1-missing": "Missing H1",
	"h1-multiple": "Multiple H1 headings",
	"open-graph-incomplete": "Incomplete Open Graph metadata",
};

function severityVariant(severity: SeoRenderedCrawlSeverity): "error" | "warning" | "secondary" {
	if (severity === "error") return "error";
	if (severity === "warning") return "warning";
	return "secondary";
}

function severityLabel(severity: SeoRenderedCrawlSeverity): string {
	if (severity === "error") return "Error";
	if (severity === "warning") return "Review";
	return "Notice";
}

function openPublicPath(path: string): void {
	const url = new URL(path, window.location.origin);
	if (url.origin !== window.location.origin) return;
	window.open(url.href, "_blank", "noopener,noreferrer");
}

function formatTime(value: string): string {
	try {
		return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
	} catch {
		return value;
	}
}

function limitedCoverageDescription(report: SeoRenderedCrawlReport): string {
	if (report.limits.reachedPageLimit) {
		return `The scan reached its ${report.limits.maxPages}-page safety limit. This is a sample, not a full site audit. Rerunning uses the same scope and does not resume beyond the limit.`;
	}
	if (report.limits.reachedLinkLimit) {
		return `Link discovery reached its reading limit (${report.limits.maxLinksPerPage} links per page or ${report.limits.maxTotalLinks.toLocaleString()} links total). Fetched-page metadata was checked, but internal-link coverage is incomplete.`;
	}
	if (report.limits.reachedSitemapLimit || report.findings.some((item) => item.code.startsWith("sitemap-"))) {
		return "One or more sitemap documents could not be fully read. Findings are valid for fetched pages, but the report is not site-complete.";
	}
	return "One or more pages could not be fully fetched or read. Findings are valid for completed requests, but internal-link coverage may be incomplete.";
}

function FindingRow({ item }: { item: SeoRenderedCrawlFinding }) {
	return (
		<li className="shipit-seo-rendered-finding">
			<div className="shipit-seo-rendered-finding__status">
				<Badge variant={severityVariant(item.severity)}>{severityLabel(item.severity)}</Badge>
			</div>
			<div className="shipit-seo-rendered-finding__body">
				<strong>{FINDING_LABELS[item.code]}</strong>
				<p>{item.detail}</p>
				<div className="shipit-seo-rendered-finding__paths">
					<code>{item.path}</code>
					{item.target ? <><span>to</span><code>{item.target}</code></> : null}
				</div>
				{item.sources.length ? (
					<span className="shipit-seo-muted">Linked from {item.sources.slice(0, 3).join(", ")}{item.sources.length > 3 ? ` and ${item.sources.length - 3} more` : ""}</span>
				) : null}
			</div>
			<Button
				size="sm"
				variant="secondary"
				icon={ArrowSquareOut}
				onClick={() => openPublicPath(item.path)}
			>
				Open
			</Button>
		</li>
	);
}

export function RenderedCrawlView() {
	const [report, setReport] = React.useState<SeoRenderedCrawlReport | null>(null);
	const [running, setRunning] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);

	const [filter, setFilter] = React.useState<CrawlResultFilter>({ query: "", type: "", page: 1 });
	const request = React.useRef(0);
	const controller = React.useRef<AbortController | null>(null);
	React.useEffect(() => () => { request.current += 1; controller.current?.abort(); }, []);
	const results = pageCrawlResults(report?.findings ?? [], filter, (item) => ({ type: item.code, text: `${FINDING_LABELS[item.code]} ${item.path} ${item.target ?? ""} ${item.detail} ${item.sources.join(" ")}` }));
	const run = React.useCallback(async () => {
		const current = ++request.current;
		controller.current?.abort();
		const currentController = new AbortController();
		controller.current = currentController;
		setReport(null);
		setRunning(true);
		setError(null);
		try {
			const result = await runSeoRenderedCrawl({ origin: window.location.origin, signal: currentController.signal });
			if (current !== request.current) return;
			setReport(result);
			setFilter({ query: "", type: "", page: 1 });
		} catch (cause) {
			if (current === request.current) setError(cause instanceof Error ? cause.message : "Rendered crawl failed");
		} finally {
			if (current === request.current) setRunning(false);
		}
	}, []);

	if (!report && !running && !error) {
		return (
			<section className="shipit-seo-panel shipit-seo-rendered-intro">
				<div className="shipit-seo-rendered-intro__body">
					<Empty
						size="sm"
						icon={<GlobeHemisphereWest size={36} aria-hidden="true" />}
						title="Verify the rendered site"
						description="Read the live sitemap and discovered same-origin pages to check HTTP responses, redirects and rendered SEO metadata. The scan starts only when requested and is not stored. It checks up to 100 pages and 10 sitemap documents, with bounded link discovery; large sites receive a sample, not a full site audit."
					/>
					<Button icon={Play} onClick={() => void run()}>Run rendered crawl</Button>
				</div>
			</section>
		);
	}

	return (
		<div className="shipit-seo-rendered-view">
			{error ? (
				<Banner
					variant="error"
					icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
					title="Rendered crawl unavailable"
					description={error}
					action={<Button size="sm" variant="secondary" onClick={() => void run()}>Retry</Button>}
				/>
			) : null}

			{running && !report ? (
				<section className="shipit-seo-panel shipit-seo-crawl-loading" aria-busy="true">Crawling sitemap and internal links...</section>
			) : null}

			{report ? (
				<>
					<section className="shipit-seo-panel shipit-seo-crawl-overview">
						<div className="shipit-seo-section-heading">
							<div>
								<span className="shipit-seo-eyebrow">Live site verification</span>
								<h2>Rendered Crawl</h2>
								<p>Fetched from {report.origin}. Last run {formatTime(report.generatedAt)}.</p>
							</div>
							<Button variant="secondary" icon={ArrowClockwise} loading={running} disabled={running} onClick={() => void run()}>
								Run again
							</Button>
						</div>

						<div className="shipit-seo-crawl-summary" aria-label="Rendered crawl summary">
							<div><span>Crawled pages</span><strong>{report.summary.crawledPages}</strong></div>
							<div><span>Healthy pages</span><strong>{report.summary.healthyPages}</strong></div>
							<div><span>Broken pages</span><strong>{report.summary.brokenPages}</strong></div>
							<div><span>Metadata issues</span><strong>{report.summary.metadataIssues}</strong></div>
						</div>

						<p className="shipit-seo-muted">{report.summary.crawledPages} page requests · {report.limits.sitemapDocuments} sitemap requests. Limits: {report.limits.maxPages} pages and {report.limits.maxSitemaps} sitemaps. Results cover fetched pages only.</p>
						{report.coverage === "limited" ? (
							<Banner
								variant="alert"
								icon={<WarningCircle size={20} weight="fill" aria-hidden="true" />}
								title="Crawl coverage is limited"
								description={limitedCoverageDescription(report)}
							/>
						) : null}
					</section>

					<section className="shipit-seo-panel shipit-seo-crawl-section">
						<div className="shipit-seo-section-heading shipit-seo-crawl-section__heading">
							<div>
								<span className="shipit-seo-eyebrow">Rendered findings</span>
								<h3>HTTP and metadata issues</h3>
								<p>Errors are actionable failures. Review items can affect crawlability or search presentation; notices provide coverage context.</p>
							</div>
							<Badge variant={report.findings.some((item) => item.severity === "error") ? "error" : report.findings.length ? "warning" : "success"}>
								{report.findings.length}
							</Badge>
						</div>

						{report.findings.length ? <>
							<CrawlResultControls label="rendered findings" filter={filter} page={results} types={crawlResultTypes(report.findings, (item) => item.code).map((value) => ({ value, label: FINDING_LABELS[value as keyof typeof FINDING_LABELS] }))} typeLabel="Issue type" onChange={setFilter} />
							{results.filteredCount ? <ul className="shipit-seo-rendered-findings">
								{results.items.map((item) => <FindingRow key={item.id} item={item} />)}
							</ul> : <p role="status">No matching findings. Clear the filters to see available results.</p>}
						</> : (
							<Empty
								size="sm"
								icon={<CheckCircle size={32} aria-hidden="true" />}
								title="No rendered SEO issues found"
								description="Every fetched sitemap page returned successfully with the required rendered metadata."
							/>
						)}
					</section>
				</>
			) : null}
		</div>
	);
}
