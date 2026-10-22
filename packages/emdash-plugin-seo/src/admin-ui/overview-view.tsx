import { Button } from "@cloudflare/kumo/components/button";
import {
  ArrowClockwise,
  ArrowRight,
  CheckCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import type { SeoAdminOverview, SeoAdminSettings } from "@shipitseo/emdash-plugin-seo/admin-contract";
import * as React from "react";
import type { SeoAdminView } from "./content-extension-model.ts";
import { buildSeoOverviewModel, priorityViewForArea } from "./overview-model.ts";
import { SEO_WORKSPACE_VIEW_LABELS } from "./workspace-model.ts";

export interface OverviewViewProps {
  data: SeoAdminOverview;
  settings?: SeoAdminSettings;
  onOpenPriority: (view: SeoAdminView) => void;
  onRefresh: () => void;
  refreshing: boolean;
  hideNextStep?: boolean;
}

export function OverviewView({ data, settings, onOpenPriority, onRefresh, refreshing, hideNextStep = false }: OverviewViewProps) {
  const model = buildSeoOverviewModel(data, settings);
  const headingId = React.useId();
  const statsId = React.useId();
  const next = model.nextStep;
  const reviewed = data.checks.filter((check) => check.status !== "pass").length;
  const stats = [
    { label: "Saved score average", value: model.contentSummary.averageValue, detail: model.contentSummary.averageDetail },
    { label: "Need attention", value: model.contentSummary.needsWorkValue, detail: model.contentSummary.needsWorkDetail },
    { label: "Saved sample", value: model.sampleSize ?? "--", detail: model.sampleState === "unavailable" ? "Results unavailable" : model.sampleState === "empty" ? "No saved analyses yet" : `Recent ${model.sampleSize === 1 ? "entry" : "entries"}` },
  ];

  return (
    <div className="shipit-seo-overview">
      {!hideNextStep ? <section className={`shipit-seo-overview__next shipit-seo-overview__next--${next.tone}`} aria-labelledby={headingId}>
        <span className="shipit-seo-eyebrow">Next step</span>
        <h2 id={headingId}>{next.title}</h2>
        <p>{next.description}</p>
        <Button type="button" variant="primary" size="sm" icon={ArrowRight} onClick={() => onOpenPriority(next.view)}>
          {next.actionLabel}
        </Button>
      </section> : null}

      <section aria-labelledby={statsId} className="shipit-seo-overview__results">
        <h2 id={statsId}>Saved content results</h2>
        <dl className="shipit-seo-overview__stats">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt>{stat.label}</dt>
              <dd><strong>{stat.value}</strong><small>{stat.detail}</small></dd>
            </div>
          ))}
        </dl>
        <p className="shipit-seo-overview__note">Saved results only. Open an entry to check whether its analysis is up to date.</p>
      </section>

      <details className="shipit-seo-overview__details" open>
        <summary><span>Setup details</span><small>{model.setupSnapshotCurrent ? `${reviewed} ${reviewed === 1 ? "check" : "checks"} to review` : "Refresh needed"}</small></summary>
        <div className="shipit-seo-overview__detail-body">
          {model.setupSnapshotCurrent ? (
            <>
              <p><strong>Setup score: {data.readiness.score}/100.</strong> This describes configuration, separately from content quality.</p>
              <p>Snapshot from {new Date(data.generatedAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}. Refresh to include more recent changes.</p>
              <ul className="shipit-seo-overview__checks">
                {data.checks.map((check) => {
                  const priority = data.priorities.find((item) => item.check === check.check);
                  const destination = priority ? priorityViewForArea(priority.area, priority.check) : null;
                  return (
                    <li key={`${check.group}:${check.check}`}>
                      {check.status === "pass" ? <CheckCircle size={17} aria-hidden="true" /> : <WarningCircle size={17} aria-hidden="true" />}
                      <div><strong>{check.check}</strong><span>{check.detail}</span><small>{check.status === "pass" ? "Passed in snapshot" : check.status === "fail" ? "Needs attention in snapshot" : "Review snapshot"}</small></div>
                      {destination && priority ? <Button type="button" variant="ghost" size="sm" onClick={() => onOpenPriority(destination)}>Open {SEO_WORKSPACE_VIEW_LABELS[destination]}</Button> : null}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : <p>Settings changed or could not be read. Refresh this overview before reviewing setup checks.</p>}
          <Button type="button" variant="secondary" size="sm" icon={ArrowClockwise} disabled={refreshing} onClick={onRefresh}>
            {refreshing ? "Refreshing…" : "Refresh overview"}
          </Button>
        </div>
      </details>

      <details className="shipit-seo-overview__details">
        <summary>About these results</summary>
        <div className="shipit-seo-overview__detail-body">
          <p>The saved sample is limited to recent analyses. It does not measure all content or predict search rankings. Setup checks review this plugin's configuration; they do not verify search engine acceptance.</p>
          <p>Opening settings does not enable features or start an analysis. Manage resource use in Feature controls.</p>
          <dl className="shipit-seo-overview__metadata"><div><dt>Updated</dt><dd>{new Date(data.generatedAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</dd></div><div><dt>Plugin version</dt><dd>{data.engineVersion}</dd></div></dl>
        </div>
      </details>
    </div>
  );
}
