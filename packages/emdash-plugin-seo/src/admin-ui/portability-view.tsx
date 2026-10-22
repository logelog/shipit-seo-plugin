import * as React from "react";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Input, Textarea } from "@cloudflare/kumo/components/input";
import { Select } from "@cloudflare/kumo/components/select";
import {
	ArrowCounterClockwise,
	CheckCircle,
	DownloadSimple,
	FileArrowDown,
	FileArrowUp,
	ShieldCheck,
	UploadSimple,
	WarningCircle,
} from "@phosphor-icons/react";
import {
	SEO_PORTABILITY_CONFIRMATION,
	SEO_PORTABILITY_MAX_BYTES,
	type SeoPortabilityBundle,
	type SeoPortabilityImportPlan,
	type SeoPortabilityMode,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

import {
	applySeoPortabilityImport,
	fetchSeoPortabilityExport,
	previewSeoPortabilityImport,
} from "./api.ts";
import { useSeoToasts } from "./workspace-shell.tsx";

function safeFilename(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48) || "site";
}

function backupFilename(bundle: SeoPortabilityBundle, prefix = "seo-configuration"): string {
	return `${prefix}-${safeFilename(bundle.source.siteName)}-${bundle.exportedAt.slice(0, 10)}.json`;
}

function downloadBundle(bundle: SeoPortabilityBundle, filename = backupFilename(bundle)): void {
	const blob = new Blob([JSON.stringify(bundle)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.hidden = true;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

function PlanSummary({ plan }: { plan: SeoPortabilityImportPlan }) {
	return (
		<div className="shipit-seo-portability-plan">
			<div className="shipit-seo-portability-stats" aria-label="Import change summary">
				<div><span>Sections</span><strong>{plan.summary.changedSections}</strong><small>will change</small></div>
				<div><span>Added</span><strong>{plan.summary.added}</strong><small>records</small></div>
				<div><span>Updated</span><strong>{plan.summary.updated}</strong><small>records</small></div>
				<div><span>Deleted</span><strong>{plan.summary.deleted}</strong><small>records</small></div>
			</div>
			<div className="shipit-seo-portability-sections">
				<div className="shipit-seo-portability-section shipit-seo-portability-section--head">
					<span>Section</span><span>Change</span><span>Records</span>
				</div>
				{plan.sections.map((section) => (
					<div key={section.key} className="shipit-seo-portability-section">
						<strong>{section.label}</strong>
						<Badge variant={section.changed ? (section.deleted ? "warning" : "beta") : "secondary"}>
							{section.changed ? "Changes" : "Unchanged"}
						</Badge>
						<span>
							{section.added ? `+${section.added} ` : ""}
							{section.updated ? `~${section.updated} ` : ""}
							{section.deleted ? `-${section.deleted}` : ""}
							{!section.added && !section.updated && !section.deleted ? section.unchanged : ""}
						</span>
					</div>
				))}
			</div>
			<div className="shipit-seo-portability-fingerprint">
				<span>Import plan fingerprint</span>
				<code>{plan.fingerprint}</code>
			</div>
		</div>
	);
}

export function PortabilityView({ onApplied }: { onApplied: () => Promise<void> }) {
	const toasts = useSeoToasts();
	const [mode, setMode] = React.useState<SeoPortabilityMode>("merge");
	const [source, setSource] = React.useState("");
	const [filename, setFilename] = React.useState<string | null>(null);
	const [preview, setPreview] = React.useState<{ plan: SeoPortabilityImportPlan; bundle: SeoPortabilityBundle } | null>(null);
	const [errors, setErrors] = React.useState<string[]>([]);
	const [message, setMessage] = React.useState<string | null>(null);
	const [confirmation, setConfirmation] = React.useState("");
	const [exporting, setExporting] = React.useState(false);
	const [previewing, setPreviewing] = React.useState(false);
	const [applying, setApplying] = React.useState(false);

	const clearPreview = React.useCallback(() => {
		setPreview(null);
		setConfirmation("");
		setErrors([]);
		setMessage(null);
	}, []);

	const exportBackup = async () => {
		setExporting(true);
		setErrors([]);
		setMessage(null);
		try {
			const result = await fetchSeoPortabilityExport();
			downloadBundle(result.bundle);
			setMessage(`SEO configuration downloaded for ${result.bundle.source.siteName}.`);
			toasts.success("SEO configuration downloaded", result.bundle.source.siteName);
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : "Failed to export SEO configuration.";
			setErrors([detail]);
			toasts.error("SEO configuration export failed", detail);
		} finally {
			setExporting(false);
		}
	};

	const readFile = async (file: File | undefined) => {
		if (!file) return;
		clearPreview();
		setFilename(file.name);
		if (file.size > SEO_PORTABILITY_MAX_BYTES) {
			setSource("");
			setErrors([`Choose a JSON file smaller than ${Math.round(SEO_PORTABILITY_MAX_BYTES / 1_000)} KB.`]);
			return;
		}
		try {
			setSource(await file.text());
		} catch (cause) {
			setSource("");
			setErrors([cause instanceof Error ? cause.message : "Could not read the selected file."]);
		}
	};

	const runPreview = async () => {
		clearPreview();
		const raw = source.trim();
		if (!raw) {
			setErrors(["Choose a configuration file or paste a bundle first."]);
			return;
		}
		if (new TextEncoder().encode(raw).byteLength > SEO_PORTABILITY_MAX_BYTES) {
			setErrors([`Bundle exceeds the ${Math.round(SEO_PORTABILITY_MAX_BYTES / 1_000)} KB limit.`]);
			return;
		}
		let bundle: unknown;
		try {
			bundle = JSON.parse(raw);
		} catch {
			setErrors(["The selected file is not valid JSON."]);
			return;
		}
		setPreviewing(true);
		try {
			const result = await previewSeoPortabilityImport(bundle, mode);
			if (!result.success) {
				setErrors(result.errors);
				return;
			}
			setPreview({ plan: result.plan, bundle: result.bundle });
		} catch (cause) {
			setErrors([cause instanceof Error ? cause.message : "Failed to validate SEO import."]);
		} finally {
			setPreviewing(false);
		}
	};

	const applyImport = async () => {
		if (!preview || confirmation !== SEO_PORTABILITY_CONFIRMATION) return;
		setApplying(true);
		setErrors([]);
		setMessage(null);
		try {
			const result = await applySeoPortabilityImport(
				preview.bundle,
				mode,
				preview.plan.fingerprint,
				confirmation,
			);
			if (!result.success) {
				setErrors([result.detail, ...(result.errors ?? [])]);
				toasts.error("SEO import not applied", result.detail);
				return;
			}
			downloadBundle(result.backup, backupFilename(result.backup, "seo-pre-import-configuration"));
			setSource("");
			setFilename(null);
			setPreview(null);
			setConfirmation("");
			setMessage("SEO configuration imported. A copy of the previous configuration was downloaded automatically.");
			toasts.success("SEO configuration imported", "The previous configuration was downloaded automatically.");
			await onApplied();
		} catch (cause) {
			const detail = cause instanceof Error ? cause.message : "Failed to apply SEO import.";
			setErrors([detail]);
			toasts.error("SEO import failed", detail);
		} finally {
			setApplying(false);
		}
	};

	return (
		<div className="shipit-seo-portability-layout">
			<section className="shipit-seo-panel shipit-seo-portability-export" aria-labelledby="seo-portability-export-title">
				<div className="shipit-seo-section-heading">
					<div>
						<span className="shipit-seo-eyebrow">Portable configuration</span>
						<h2 id="seo-portability-export-title">Export configuration</h2>
					</div>
					<FileArrowDown size={21} aria-hidden="true" />
				</div>
				<div className="shipit-seo-portability-safety">
					<ShieldCheck size={22} weight="fill" aria-hidden="true" />
					<div>
						<strong>Configuration export, not a full site backup</strong>
						<span>Excluded: content and media, EmDash core SEO, per-entry SEO, social, robots and focus data, business identity, schema library templates, 404 events, scores, IndexNow secret key and queues, and migration journals.</span>
					</div>
				</div>
				<ul className="shipit-seo-portability-includes">
					<li><CheckCircle size={16} weight="fill" aria-hidden="true" /> Site and social settings</li>
					<li><CheckCircle size={16} weight="fill" aria-hidden="true" /> Sitemap and module settings</li>
					<li><CheckCircle size={16} weight="fill" aria-hidden="true" /> Schema presets, templates, and custom schemas</li>
					<li><CheckCircle size={16} weight="fill" aria-hidden="true" /> Non-secret IndexNow policy</li>
				</ul>
				<Button icon={DownloadSimple} loading={exporting} disabled={exporting || applying} onClick={() => void exportBackup()}>
					Download SEO configuration
				</Button>
			</section>

			<section className="shipit-seo-panel shipit-seo-portability-import" aria-labelledby="seo-portability-import-title">
				<div className="shipit-seo-section-heading">
					<div>
						<span className="shipit-seo-eyebrow">Review before applying</span>
						<h2 id="seo-portability-import-title">Import configuration</h2>
					</div>
					<FileArrowUp size={21} aria-hidden="true" />
				</div>
				<p className="shipit-seo-template-intro">Imports only the configuration listed in the export panel. Content, per-entry SEO data, and activity history are not restored.</p>
				<div className="shipit-seo-portability-controls">
					<Select<SeoPortabilityMode>
						label="Import mode"
						value={mode}
						disabled={previewing || applying}
						onValueChange={(value) => {
							if (value !== "merge" && value !== "replace") return;
							setMode(value);
							clearPreview();
						}}
						items={{ merge: "Merge with local schemas", replace: "Replace custom schemas" }}
					/>
					<label className="shipit-seo-portability-file">
						<span>Configuration file</span>
						<input
							type="file"
							accept="application/json,.json"
							disabled={previewing || applying}
							onChange={(event) => {
								const file = event.currentTarget.files?.[0];
								event.currentTarget.value = "";
								void readFile(file);
							}}
						/>
						<strong><UploadSimple size={16} aria-hidden="true" /> {filename ?? "Choose JSON file"}</strong>
					</label>
				</div>
				<Textarea
					label="Bundle JSON"
					description="File contents appear here for review before validation."
					rows={8}
					value={source}
					disabled={previewing || applying}
					placeholder={`{\n  "format": "shipit-seo-portable"\n}`}
					onChange={(event) => {
						setSource(event.target.value);
						setFilename(null);
						clearPreview();
					}}
				/>
				<div className="shipit-seo-schema-editor-actions">
					<Button
						type="button"
						variant="secondary"
						icon={ArrowCounterClockwise}
						disabled={(!source && !preview) || previewing || applying}
						onClick={() => {
							setSource("");
							setFilename(null);
							clearPreview();
						}}
					>
						Clear
					</Button>
					<Button type="button" icon={ShieldCheck} loading={previewing} disabled={!source.trim() || previewing || applying} onClick={() => void runPreview()}>
						Validate and preview
					</Button>
				</div>

				{errors.length ? (
					<Banner
						variant="error"
						icon={<WarningCircle size={19} weight="fill" aria-hidden="true" />}
						title="Import blocked"
						description={errors.join(" ")}
					/>
				) : null}
				{message ? (
					<Banner
						variant="default"
						icon={<CheckCircle size={19} weight="fill" aria-hidden="true" />}
						title="Portability operation complete"
						description={message}
					/>
				) : null}

				{preview ? (
					<div className="shipit-seo-portability-preview">
						<PlanSummary plan={preview.plan} />
						{preview.plan.warnings.length ? (
							<Banner
								variant={preview.plan.summary.destructive ? "error" : "alert"}
								icon={<WarningCircle size={19} weight="fill" aria-hidden="true" />}
								title={preview.plan.summary.destructive ? "Destructive changes require review" : "Review import warnings"}
								description={preview.plan.warnings.join(" ")}
							/>
						) : null}
						<Input
							label="Confirmation phrase"
							description={`Type ${SEO_PORTABILITY_CONFIRMATION} exactly.`}
							value={confirmation}
							disabled={applying}
							onChange={(event) => setConfirmation(event.target.value)}
						/>
						<Button
							type="button"
							variant={preview.plan.summary.destructive ? "destructive" : "primary"}
							icon={UploadSimple}
							loading={applying}
							disabled={confirmation !== SEO_PORTABILITY_CONFIRMATION || applying}
							onClick={() => void applyImport()}
						>
							Apply import
						</Button>
					</div>
				) : null}
			</section>
		</div>
	);
}
