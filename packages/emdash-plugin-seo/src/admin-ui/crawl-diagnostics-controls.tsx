import * as React from "react";
import { Button } from "@cloudflare/kumo/components/button";
import { CRAWL_RESULT_SEARCH_MAX, type CrawlResultFilter, type CrawlResultPage } from "./crawl-diagnostics-model.ts";

export function CrawlResultControls<T>({ label, filter, page, types, typeLabel, onChange }: {
	label: string;
	filter: CrawlResultFilter;
	page: CrawlResultPage<T>;
	types: readonly { value: string; label: string }[];
	typeLabel: string;
	onChange: (value: CrawlResultFilter) => void;
}) {
	return <div className="shipit-seo-crawl-controls">
		<div className="shipit-seo-crawl-filters" role="search" aria-label={`Filter ${label}`}>
			<label>Search {label}<input type="search" value={filter.query} maxLength={CRAWL_RESULT_SEARCH_MAX} placeholder="Title, path or link text" onChange={(event) => onChange({ ...filter, query: event.target.value, page: 1 })} /></label>
			<label>{typeLabel}<select value={filter.type} onChange={(event) => onChange({ ...filter, type: event.target.value, page: 1 })}>
				<option value="">All {typeLabel.toLocaleLowerCase("en")}s</option>
				{types.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
			</select></label>
		</div>
		<div className="shipit-seo-crawl-pagination" aria-label={`${label} pages`}>
			<span role="status">{page.start}–{page.end} of {page.filteredCount} matching {page.totalCount !== page.filteredCount ? `(${page.totalCount} available)` : ""}</span>
			<div>
				<Button size="sm" variant="secondary" disabled={page.page <= 1} onClick={() => onChange({ ...filter, page: page.page - 1 })}>Previous</Button>
				<span>Page {page.page} of {page.pageCount}</span>
				<Button size="sm" variant="secondary" disabled={page.page >= page.pageCount} onClick={() => onChange({ ...filter, page: page.page + 1 })}>Next</Button>
			</div>
		</div>
	</div>;
}
