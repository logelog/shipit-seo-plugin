import * as React from "react";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Empty } from "@cloudflare/kumo/components/empty";
import { Input } from "@cloudflare/kumo/components/input";
import { Tabs } from "@cloudflare/kumo/components/tabs";
import { useQuery } from "@tanstack/react-query";
import { ArrowBendUpRight, ArrowClockwise, ArrowSquareOut, CheckCircle, MagnifyingGlass } from "@phosphor-icons/react";
import {
	CORE_404_PAGE_SIZE,
	CORE_404_SUMMARY_LIMIT,
	classifyCore404ReadError,
	core404FailureNotice,
	core404PageRequest,
	core404PageState,
	core404RequestKey,
	core404ResultOwned,
	core404TimestampMs,
	initialCore404Paging,
	nextCore404Paging,
	previousCore404Paging,
	refreshCore404Paging,
	searchCore404Paging,
	shouldRetryCore404Read,
} from "../core-404-activity.ts";
import { fetchCore404Records, fetchCore404Summary } from "./api.ts";
import { seoWorkspaceKeys } from "./workspace-model.ts";
import { WRAPPING_TABS, useTablistName } from "./workspace-tabs.ts";

const readOptions = {
	refetchOnWindowFocus: false,
	refetchOnReconnect: false,
	staleTime: 20_000,
	gcTime: 60_000,
	retry: shouldRetryCore404Read,
};

function RecordedDate({ value }: { value: string }) {
	const timestamp = core404TimestampMs(value);
	if (timestamp === null) return null;
	const date = new Date(timestamp);
	return <time dateTime={date.toISOString()}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)}</time>;
}

function ReadFailure({ error, earlier, page = 0, onRetry, onFirstPage }: {
	error: unknown; earlier: boolean; page?: number; onRetry: () => void; onFirstPage?: () => void;
}) {
	const notice = core404FailureNotice(classifyCore404ReadError(error), { page, earlierRows: earlier });
	return <Banner
		role="alert"
		variant="error"
		title={notice.title}
		description={notice.message}
		action={notice.firstPage && onFirstPage
			? <Button size="sm" variant="secondary" onClick={onFirstPage}>First page</Button>
			: notice.retry ? <Button size="sm" variant="secondary" onClick={onRetry}>Retry</Button> : undefined}
	/>;
}

function CreateRedirectAction({ path, onCreateRedirect }: { path: string; onCreateRedirect?: (path: string) => void }) {
	if (!onCreateRedirect) return null;
	return <Button size="sm" variant="secondary" icon={ArrowBendUpRight} aria-label={`Create redirect from ${path}`} onClick={() => onCreateRedirect(path)}>
		Create redirect
	</Button>;
}

function RetainedPaths({ onCreateRedirect }: { onCreateRedirect?: (path: string) => void }) {
	const [paging, setPaging] = React.useState(initialCore404Paging);
	const [search, setSearch] = React.useState("");
	const [searchError, setSearchError] = React.useState<string | null>(null);
	const request = core404PageRequest(paging);
	const queryKey = [...seoWorkspaceKeys.all, ...core404RequestKey(request)];
	const query = useQuery({ ...readOptions, queryKey, queryFn: ({ signal }) => fetchCore404Records(request, signal) });
	const refresh = () => setPaging(refreshCore404Paging(paging));
	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		const update = searchCore404Paging(paging, search);
		if (!update.valid) {
			setSearchError(update.problem === "too-long" ? "Search must contain at most 200 characters." : "Search contains an incomplete Unicode character. Edit it and try again.");
			return;
		}
		setSearchError(null);
		setPaging(update.paging);
	};
	const result = query.data && core404ResultOwned(paging, query.data) ? query.data : undefined;
	const items = result?.items;
	const next = result ? nextCore404Paging(paging, result) : null;
	const emptyState = result ? core404PageState(result) : null;
	return <div className="shipit-core-404__content">
		<p className="shipit-core-404__note">Search all retained paths in the EmDash log. Recorded is when EmDash created the retained record, not its last visit or necessarily its first-ever visit. Repeat hits appear in Top by hits.</p>
		<form className="shipit-core-404__search" onSubmit={submit}>
			<Input label="Search retained paths" type="search" value={search} error={searchError ?? undefined} onChange={(event) => setSearch(event.target.value)} placeholder="Enter part of a missing path" />
			<Button size="sm" variant="secondary" type="submit" icon={MagnifyingGlass}>Search</Button>
			<Button size="sm" variant="secondary" icon={ArrowClockwise} disabled={query.isFetching} onClick={refresh}>Refresh</Button>
		</form>
		{searchError ? <p role="alert" className="shipit-core-404__note">{searchError}</p> : null}
		{query.isError ? <ReadFailure error={query.error} earlier={Boolean(items?.length)} page={paging.page} onRetry={() => void query.refetch()} onFirstPage={refresh} /> : null}
		{result?.nextCursor && !next && !query.isError ? <Banner role="alert" variant="error" title="This page cannot be continued" description="EmDash returned a cursor already used for this search. Refresh to start from the first page." action={<Button size="sm" variant="secondary" onClick={refresh}>First page</Button>} /> : null}
		<div className="shipit-core-404__paging">
			<p role="status" aria-live="polite">{query.isFetching ? `Loading page ${paging.page + 1}...` : items ? `Page ${paging.page + 1}, ${items.length} records shown${query.isError ? " from the earlier read" : ""}.` : "No readable page loaded."}</p>
			<div>
				<Button size="sm" variant="secondary" disabled={paging.page === 0 || query.isFetching} onClick={() => setPaging(previousCore404Paging(paging))}>Previous</Button>
				<Button size="sm" variant="secondary" disabled={!next || query.isFetching || query.isError} onClick={() => { if (next) setPaging(next); }}>Next</Button>
			</div>
		</div>
		{items?.length ? <ul className="shipit-core-404__rows" aria-label="Retained missing paths" aria-busy={query.isFetching}>
			{items.map((item) => <li key={item.id}>
				<code>{item.path}</code>
				<dl><div><dt>Recorded</dt><dd><RecordedDate value={item.createdAt} /></dd></div></dl>
				<CreateRedirectAction path={item.path} onCreateRedirect={onCreateRedirect} />
			</li>)}
		</ul> : !query.isFetching && !query.isError && items ? <Empty size="sm" icon={paging.page > 0 || request.search ? <MagnifyingGlass size={32} aria-hidden="true" /> : <CheckCircle size={32} aria-hidden="true" />}
			title={emptyState === "empty-continues" ? "No retained records on this page" : emptyState === "page-emptied" ? "This page no longer has retained records" : emptyState === "no-matches" ? "No paths match your search" : "No missing paths recorded by EmDash"}
			description={emptyState === "empty-continues" ? next ? "The log changed while you browsed. Continue to the next page or refresh to start again." : "The log changed while you browsed. Refresh to start from the first page." : emptyState === "page-emptied" ? "The log can change while you browse. Go back or refresh to start from the first page." : emptyState === "no-matches" ? "Try another part of the path or clear the search." : "Eligible public 404 responses recorded by EmDash will appear here."}
		/> : null}
		<p className="shipit-core-404__note">Up to {CORE_404_PAGE_SIZE} records per page. Pages follow the live log; new captures and retention can change later pages.</p>
	</div>;
}

function TopPaths({ onCreateRedirect }: { onCreateRedirect?: (path: string) => void }) {
	const query = useQuery({ ...readOptions, queryKey: [...seoWorkspaceKeys.all, "core404", "summary"], queryFn: ({ signal }) => fetchCore404Summary(CORE_404_SUMMARY_LIMIT, signal) });
	return <div className="shipit-core-404__content">
		<div className="shipit-core-404__summary-heading">
			<p className="shipit-core-404__note">Up to {CORE_404_SUMMARY_LIMIT} retained paths ranked by hits. This summary has no search or further pages; use Recorded paths to search the log.</p>
			<Button size="sm" variant="secondary" icon={ArrowClockwise} disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh</Button>
		</div>
		{query.isError ? <ReadFailure error={query.error} earlier={Boolean(query.data?.length)} onRetry={() => void query.refetch()} /> : null}
		<p role="status" aria-live="polite">{query.isFetching ? "Loading top paths..." : query.data ? `${query.data.length} paths shown${query.isError ? " from the earlier read" : ""}.` : "No readable summary loaded."}</p>
		{query.data?.length ? <ul className="shipit-core-404__rows" aria-label="Missing paths ranked by hits" aria-busy={query.isFetching}>
			{query.data.map((item) => <li key={item.path}>
				<code>{item.path}</code>
				<dl><div><dt>Hits</dt><dd>{item.count}</dd></div><div><dt>Last seen</dt><dd><RecordedDate value={item.lastSeen} /></dd></div></dl>
				<CreateRedirectAction path={item.path} onCreateRedirect={onCreateRedirect} />
			</li>)}
		</ul> : !query.isFetching && !query.isError && query.data ? <Empty size="sm" icon={<CheckCircle size={32} aria-hidden="true" />} title="No missing paths recorded by EmDash" description="Eligible public 404 responses recorded by EmDash will appear here." /> : null}
	</div>;
}

export function Core404Activity({ onCreateRedirect }: { onCreateRedirect?: (path: string) => void } = {}) {
	const [mode, setMode] = React.useState("records");
	const tabsRef = useTablistName<HTMLDivElement>({ label: "404 activity view" });
	return <section className="shipit-seo-panel shipit-core-404" aria-labelledby="seo-core-404-title">
		<div className="shipit-seo-section-heading">
			<div><span className="shipit-seo-eyebrow">EmDash core activity</span><h2 id="seo-core-404-title">Missing paths</h2></div>
			<Button size="sm" variant="secondary" icon={ArrowSquareOut} onClick={() => window.location.assign("/_emdash/admin/redirects")}>Manage in EmDash</Button>
		</div>
		<div ref={tabsRef} className="shipit-core-404__modes" role="group" aria-label="404 activity view"><Tabs variant="segmented" {...WRAPPING_TABS} tabs={[{ value: "records", label: "Recorded paths" }, { value: "top", label: "Top by hits" }]} value={mode} onValueChange={(value) => { if (value === "records" || value === "top") setMode(value); }} /></div>
		{mode === "records" ? <RetainedPaths onCreateRedirect={onCreateRedirect} /> : <TopPaths onCreateRedirect={onCreateRedirect} />}
	</section>;
}
