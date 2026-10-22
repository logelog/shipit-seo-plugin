import * as React from "react";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Select } from "@cloudflare/kumo/components/select";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
	ArrowSquareOut,
	ChartLineUp,
	Minus,
	TrendDown,
	TrendUp,
} from "@phosphor-icons/react";
import {
	SEO_SCORE_VERSION,
	type SeoAdminScoreTrendDirection,
	type SeoAdminScoreTrends,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import { cleanStoredSeoText } from "../check-presentation.ts";
import { fetchSeoAdminContentOptions, fetchSeoScoreTrends } from "./api.ts";
import { contentEditorUrl } from "./content-editor-url.ts";
import { seoWorkspaceKeys } from "./workspace-model.ts";
import { ViewErrorState } from "./workspace-shell.tsx";

const RANGE_ITEMS = {
	"7": "Last 7 days",
	"30": "Last 30 days",
	"90": "Last 90 days",
} as const;

type RangeKey = keyof typeof RANGE_ITEMS;

function collectionLabel(value: string) {
	return value
		.split(/[-_]/g)
		.filter(Boolean)
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
		.join(" ");
}

function readableDate(value: string) {
	return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(
		new Date(value),
	);
}

function issueVariant(status: "review" | "fail") {
	return status === "fail" ? "error" : "warning";
}

function directionCopy(direction: SeoAdminScoreTrendDirection) {
	if (direction === "improved") return "Paired average increased";
	if (direction === "declined") return "Paired average decreased";
	if (direction === "stable") return "Paired average unchanged";
	return "No comparable pairs";
}

function DirectionIcon({ direction }: { direction: SeoAdminScoreTrendDirection }) {
	if (direction === "improved") return <TrendUp size={18} weight="bold" aria-hidden="true" />;
	if (direction === "declined") return <TrendDown size={18} weight="bold" aria-hidden="true" />;
	return <Minus size={18} weight="bold" aria-hidden="true" />;
}

function deltaLabel(value: number | null) {
	if (value === null) return "--";
	return value > 0 ? `+${value}` : String(value);
}

function countLabel(value: number, singular: string, plural = `${singular}s`) {
	return `${value} ${value === 1 ? singular : plural}`;
}

function Summary({ data }: { data: SeoAdminScoreTrends }) {
	const { summary, comparison } = data;
	return (
		<dl className="shipit-seo-trend-summary" aria-label="SEO trend summary">
			<div>
				<dt>Latest retained average</dt>
				<dd>{summary.currentAverage ?? "--"}</dd>
				<span>{countLabel(summary.trackedEntries, "observed entry", "observed entries")}</span>
			</div>
			<div data-direction={comparison.direction}>
				<dt>Paired score change</dt>
				<dd><DirectionIcon direction={comparison.direction} />{deltaLabel(comparison.scoreDelta)}</dd>
				<span>{directionCopy(comparison.direction)}</span>
			</div>
			<div>
				<dt>Latest retained issues</dt>
				<dd>{summary.openIssues}</dd>
				<span>{comparison.openedIssues === null ? "No paired comparison" : `${countLabel(comparison.openedIssues, "issue")} opened in pairs`}</span>
			</div>
			<div>
				<dt>Resolved in pairs</dt>
				<dd>{comparison.resolvedIssues ?? "--"}</dd>
				<span>{comparison.pairedEntries ? `${countLabel(comparison.improvedEntries, "entry", "entries")} with a higher saved score` : "No comparable pairs"}</span>
			</div>
		</dl>
	);
}

function ComparisonCoverage({ data }: { data: SeoAdminScoreTrends }) {
	const { comparison } = data;
	const exclusions = [
		[comparison.exclusions.missingContext, "missing context"],
		[comparison.exclusions.invalidContext, "invalid context"],
		[comparison.exclusions.changedProfile, "changed profile"],
		[comparison.exclusions.ambiguousTime, "ambiguous time"],
	].filter(([count]) => Number(count) > 0).map(([count, label]) => `${count} ${label}`);
	return (
		<section className="shipit-seo-trend-section" aria-label="Paired comparison coverage">
			<p>{countLabel(comparison.pairedEntries, "paired entry", "paired entries")} of {comparison.observedEntries} observed in this window. {comparison.singleSampleEntries} single-sample; {comparison.excludedEntries} excluded.</p>
			<p>Paired average: {comparison.baselineAverage ?? "--"} to {comparison.currentAverage ?? "--"}. {comparison.unchangedEntries} unchanged; {comparison.declinedEntries} lower. {comparison.scopeChangedPairs} {comparison.scopeChangedPairs === 1 ? "pair has" : "pairs have"} changed check coverage.</p>
			{exclusions.length ? <p>Excluded: {exclusions.join(", ")}.</p> : null}
			<p className="shipit-seo-trend-muted">Retained saved checks only; this does not measure traffic, rankings or all site content.</p>
		</section>
	);
}

const SCORE_AXIS_TICKS = [100, 75, 50, 25, 0] as const;

function ScoreChart({ data }: { data: SeoAdminScoreTrends }) {
	const first = data.points[0]?.date;
	const middle = data.points[Math.floor(data.points.length / 2)]?.date;
	const last = data.points[data.points.length - 1]?.date;
	return (
		<section className="shipit-seo-trend-chart" aria-labelledby="seo-trend-chart-title">
			<div className="shipit-seo-trend-section-head">
				<div>
					<span className="shipit-seo-eyebrow">Saved content analysis</span>
					<h3 id="seo-trend-chart-title">Retained daily average</h3>
				</div>
				<Badge variant="secondary">{countLabel(data.summary.snapshotCount, "snapshot")}</Badge>
			</div>
			<div className="shipit-seo-trend-plot-frame">
				<div className="shipit-seo-trend-plot-scale" aria-hidden="true">
					{SCORE_AXIS_TICKS.map((tick) => (
						<span key={tick}>{tick}</span>
					))}
				</div>
				<div className="shipit-seo-trend-plot-area">
					<div className="shipit-seo-trend-plot-grid" aria-hidden="true">
						{SCORE_AXIS_TICKS.map((tick) => (
							<span key={tick} />
						))}
					</div>
					<div
						className="shipit-seo-trend-plot"
						role="img"
						aria-label={`${data.scope.days}-day retained saved score observations on a 0 to 100 scale. Latest retained average ${data.summary.currentAverage ?? "not available"}.`}
						style={{ gridTemplateColumns: `repeat(${Math.max(data.points.length, 1)}, minmax(3px, 1fr))` }}
					>
						{data.points.map((point) => (
							<div
								key={point.date}
								className="shipit-seo-trend-bar-track"
								title={`${point.date}: ${point.averageScore ?? "No score"}`}
							>
								<span
									className="shipit-seo-trend-bar"
									data-empty={point.averageScore === null ? "true" : undefined}
									data-tone={point.averageScore === null ? "empty" : "neutral"}
									style={{ height: `${point.averageScore === null ? 3 : Math.max(point.averageScore, 3)}%` }}
								/>
							</div>
						))}
					</div>
				</div>
			</div>
			<div className="shipit-seo-trend-axis" aria-hidden="true">
				<span>{first ? readableDate(first) : ""}</span>
				<span>{middle ? readableDate(middle) : ""}</span>
				<span>{last ? readableDate(last) : ""}</span>
			</div>
		</section>
	);
}

function TopIssues({ data }: { data: SeoAdminScoreTrends }) {
	return (
		<section className="shipit-seo-trend-section" aria-labelledby="seo-trend-issues-title">
			<div className="shipit-seo-trend-section-head">
				<div>
					<span className="shipit-seo-eyebrow">Latest retained observations</span>
					<h3 id="seo-trend-issues-title">Most common issues</h3>
				</div>
			</div>
			{data.topIssues.length ? (
				<ol className="shipit-seo-trend-issues">
					{data.topIssues.map((issue) => (
						<li key={issue.id}>
							<div>
								<strong>{cleanStoredSeoText(issue.label)}</strong>
								<span>{collectionLabel(issue.category)}</span>
							</div>
							<div>
								<Badge variant={issueVariant(issue.status)}>{issue.status}</Badge>
								<span>{countLabel(issue.affectedEntries, "entry", "entries")}</span>
							</div>
						</li>
					))}
				</ol>
			) : (
				<p className="shipit-seo-trend-muted">No weighted issues are open in this scope.</p>
			)}
		</section>
	);
}

function RecentChanges({ data }: { data: SeoAdminScoreTrends }) {
	return (
		<section className="shipit-seo-trend-section" aria-labelledby="seo-trend-changes-title">
			<div className="shipit-seo-trend-section-head">
				<div>
					<span className="shipit-seo-eyebrow">Comparable saved pairs</span>
					<h3 id="seo-trend-changes-title">Recent changes</h3>
				</div>
			</div>
			{data.changes.items.length ? (
				<div className="shipit-seo-trend-changes">
					{data.changes.items.map((change) => (
						<div key={`${change.ref}:${change.capturedAt}`} className="shipit-seo-trend-change">
							<div className="shipit-seo-trend-change-title">
								<a href={contentEditorUrl(change.collection, change.entryId)}>{change.title}</a>
								<span>{collectionLabel(change.collection)}</span>
							</div>
							<div className="shipit-seo-trend-change-score">
								<Badge variant="secondary">{change.previousScore} → {change.currentScore}</Badge>
								<strong data-positive={change.delta > 0 ? "true" : undefined} data-negative={change.delta < 0 ? "true" : undefined}>
									{deltaLabel(change.delta)}
								</strong>
							</div>
							<div className="shipit-seo-trend-change-issues">
								<span>{change.resolvedIssues} resolved</span>
								<span>{change.openedIssues} opened</span>
								{change.scopeChanged ? <span>Check coverage changed</span> : null}
								<span>{change.baselineBasis === "before-window" ? "Before-window baseline" : "First observation in window"}</span>
								<time dateTime={change.previousCapturedAt}>{readableDate(change.previousCapturedAt)}</time>
								<span>to</span>
								<time dateTime={change.capturedAt}>{readableDate(change.capturedAt)}</time>
							</div>
							<a className="shipit-seo-open" href={contentEditorUrl(change.collection, change.entryId)} title={`Edit ${change.title}`}>
								<ArrowSquareOut size={17} aria-hidden="true" />
								<span className="sr-only">Edit {change.title}</span>
							</a>
						</div>
					))}
				</div>
			) : (
				<p className="shipit-seo-trend-muted">{data.comparison.pairedEntries ? "No score or issue changes in comparable saved pairs." : "No comparable saved pairs in this range."}</p>
			)}
			{data.changes.hasMore ? <p className="shipit-seo-trend-muted">Showing {data.changes.items.length} of {data.changes.total} changed entries. Comparison totals include every qualified pair.</p> : null}
		</section>
	);
}

export function TrendsView() {
	const [range, setRange] = React.useState<RangeKey>("30");
	const [collection, setCollection] = React.useState("all");

	const trendsQuery = useQuery({
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		queryKey: seoWorkspaceKeys.trends(Number(range), collection === "all" ? null : collection),
		queryFn: () =>
			fetchSeoScoreTrends({
				days: Number(range),
				collection: collection === "all" ? undefined : collection,
			}),
		retry: 1,
		staleTime: 20_000,
		placeholderData: keepPreviousData,
	});
	const optionsQuery = useQuery({
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		queryKey: seoWorkspaceKeys.contentOptionPage(null),
		queryFn: () => fetchSeoAdminContentOptions(),
		retry: 1,
		staleTime: 30_000,
	});

	const data = trendsQuery.data ?? null;
	const loading = trendsQuery.isPending || trendsQuery.isFetching;
	const earlierSnapshots = Boolean(data?.items.some((item) => item.scoreVersion !== SEO_SCORE_VERSION));
	const collectionItems = React.useMemo(() => {
		const merged: Record<string, string> = { all: "All content types" };
		for (const item of data?.items ?? []) {
			if (!merged[item.collection]) merged[item.collection] = collectionLabel(item.collection);
		}
		for (const item of optionsQuery.data?.collections ?? []) {
			merged[item.collection] = item.label || collectionLabel(item.collection);
		}
		if (collection !== "all" && !merged[collection]) {
			merged[collection] = collectionLabel(collection);
		}
		return merged;
	}, [collection, data, optionsQuery.data]);

	return (
		<section
			className="shipit-seo-panel shipit-seo-trends"
			aria-busy={loading}
			aria-labelledby="seo-trends-title"
		>
			<div className="shipit-seo-trends-head">
				<div>
					<span className="shipit-seo-eyebrow">Historical content health</span>
					<h2 id="seo-trends-title">SEO trends</h2>
					<p>Changes are derived from saved analyzer snapshots, not estimated traffic or rankings.</p>
				</div>
				<div className="shipit-seo-trend-filters">
					<Select<RangeKey>
						label="Date range"
						value={range}
						items={RANGE_ITEMS}
						onValueChange={(next) => next && setRange(next)}
					/>
					<Select<string>
						label="Content type"
						value={collection}
						items={collectionItems}
						onValueChange={(next) => next && setCollection(next)}
					/>
				</div>
			</div>

			{loading && data ? (
				<span className="sr-only" role="status" aria-live="polite">Updating SEO trends...</span>
			) : null}

			{trendsQuery.isError ? (
				<ViewErrorState
					title="SEO trends unavailable"
					error={trendsQuery.error}
					onRetry={() => void trendsQuery.refetch()}
				/>
			) : null}

			{loading && !data ? (
				<div className="shipit-seo-trend-loading" role="status" aria-live="polite">Loading score history...</div>
			) : null}

			{data && data.summary.snapshotCount === 0 ? (
				<Empty
					size="sm"
					icon={<ChartLineUp size={34} aria-hidden="true" />}
					title="No saved score snapshots in this range"
					description={data.summary.trackedEntries
						? "Older saved scores exist, but no new snapshot was recorded in the selected range."
						: "Refresh scores for a content type to record history. Session audits do not appear here."}
				/>
			) : null}

			{data && data.summary.snapshotCount > 0 ? (
				<>
					{earlierSnapshots ? (
						<p className="shipit-seo-trend-muted">
							Snapshots saved with an earlier analyzer stay in history but are not averaged or compared.
							The next save or scan analyzes each entry again and starts new points.
						</p>
					) : null}
					<Summary data={data} />
					<ComparisonCoverage data={data} />
					<ScoreChart data={data} />
					<div className="shipit-seo-trend-columns">
						<TopIssues data={data} />
						<RecentChanges data={data} />
					</div>
				</>
			) : null}
		</section>
	);
}
