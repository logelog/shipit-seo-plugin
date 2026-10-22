import type { SeoAdminEntryPreview } from "@shipitseo/emdash-plugin-seo/admin-contract";
import { useSeoBrand } from "./brand-context.ts";
import { SEO_OWNERSHIP_SOURCE_LABELS } from "./content-extension-model.ts";

type ReviewField = "title" | "description" | "slug";

/** Where to go when a legacy record, not the entry's own SEO field, decides a value. */
export function legacyRecordGuidance(brand: string): string {
	return `Review saved SEO ownership for this entry and ${brand} > Settings > Migration before replacing this value.`;
}

function owningEditorGuidance(preview: SeoAdminEntryPreview, field: ReviewField, brand: string): string {
	if (field === "slug") {
		return "The keyword check uses the saved slug, or the resolved URL when the slug is blank; that URL can be canonical. The card URL may differ from the checked slug. Review Slug under Settings > URL & language; a custom public route may also need a route configuration change.";
	}
	const owner = preview.sources[field];
	if (owner === "core-seo") {
		return `Edit ${field === "title" ? "SEO Title" : "Meta Description"} under Settings > SEO, where enabled for this content type.`;
	}
	if (owner === "template") {
		return `Review ${brand} > Templates for this content type and the entry fields used by the template. Template changes can affect other entries of this type. An entry override under Settings > SEO, where enabled, affects this entry's resolved ${field === "title" ? "title suggestion" : "description"}.`;
	}
	if (owner === "legacy-override") {
		return legacyRecordGuidance(brand);
	}
	if (owner === "content" || owner === "generated") {
		return field === "title"
			? "Review the entry's Title or configured title field; Name or the slug may supply a fallback."
			: "Review the entry's Excerpt, Summary or Description field, or its body when the description is generated.";
	}
	return "Review the reported metadata source and its site defaults.";
}

export function SavedMetadataReview({ preview, field, previewError = false }: {
	preview: SeoAdminEntryPreview;
	field: ReviewField | null;
	previewError?: boolean;
}) {
	const brand = useSeoBrand();
	const rows = [
		{ field: "title", label: "Title suggestion", value: preview.search.title, source: preview.sources.title },
		{ field: "description", label: "Meta description", value: preview.search.description, source: preview.sources.description },
		{ field: "slug", label: "Preview URL", value: preview.search.url, source: preview.sources.canonical },
	] as const;
	const guidanceFields = field ? rows.filter((row) => row.field === field) : rows;
	const reviewLabel = field === "title" ? "Review saved title suggestion."
		: field === "description" ? "Review saved meta description." : "Review saved URL and slug.";
	return (
		<section className="shipit-seo-saved-metadata" data-review-field={field ?? undefined}>
			<div className="shipit-seo-saved-metadata__header">
				<h3>Saved metadata</h3>
				<span className="shipit-seo-saved-metadata__badge">{previewError ? "Last loaded" : "Saved values"}</span>
			</div>
			<p className="shipit-seo-saved-metadata__instruction">
				Read-only. Save edits in the owning field or template, then analyze saved content again.
			</p>
			<dl className="shipit-seo-saved-metadata__rows">
				{rows.map((row) => (
					<div key={row.field} className={`shipit-seo-saved-metadata__row${field === row.field ? " shipit-seo-saved-metadata__row--review" : ""}`}
						data-review-field={field === row.field ? field : undefined}>
						<dt>{row.label}</dt>
						<dd className="shipit-seo-saved-metadata__meta">
							<span>{[...row.value].length} characters</span>
							<span>Source: {SEO_OWNERSHIP_SOURCE_LABELS[row.source]}</span>
						</dd>
						<dd className="shipit-seo-saved-metadata__value" dir="auto">{row.value}</dd>
					</div>
				))}
			</dl>
			<details className="shipit-seo-saved-metadata__guidance">
				<summary>Where to edit</summary>
				<div className="shipit-seo-saved-metadata__guidance-body">
					{field ? <p><strong>{reviewLabel}</strong></p> : null}
					{guidanceFields.map((row) => (
						<p key={row.field}>
							{owningEditorGuidance(preview, row.field, brand.name)}
							{row.field === "title" ? " The site template controls the served page title." : null}
						</p>
					))}
					<p>{previewError ? "These are the last loaded values." : "This preview shows the resolved saved values."}</p>
				</div>
			</details>
		</section>
	);
}
