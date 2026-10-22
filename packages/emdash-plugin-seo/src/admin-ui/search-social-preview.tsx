import { ImageSquare, WarningCircle } from "@phosphor-icons/react";
import * as React from "react";

import type { SeoAdminMetadataSource } from "../admin-contract.ts";
import type { SerpPreviewModel } from "./serp-preview-model.ts";
import type { SocialPreviewFieldBasis, SocialPreviewModel } from "./social-preview-model.ts";
import type { FittedSnippetText, PreviewField, SnippetTextProfile } from "./snippet-preview.ts";

const FIELD_STATES = { saved: "Saved", draft: "Draft", unavailable: "Unavailable" } as const;
const NATIVE_CARD_PADDING = 16;

function NativePreviewFrame({ label, width, children, framed = true }: {
	label: string;
	width: number;
	children: React.ReactNode;
	framed?: boolean;
}) {
	const frameRef = React.useRef<HTMLDivElement>(null);
	const cardRef = React.useRef<HTMLDivElement>(null);
	const fullWidth = width + (framed ? NATIVE_CARD_PADDING * 2 + 2 : 0);
	const [size, setSize] = React.useState<{ scale: number; height: number } | null>(null);
	React.useLayoutEffect(() => {
		const frame = frameRef.current;
		const card = cardRef.current;
		if (!frame || !card) return;
		const measure = () => {
			if (frame.clientWidth <= 0) return;
			const scale = Math.min(1, frame.clientWidth / fullWidth);
			const height = Math.ceil(card.offsetHeight * scale);
			setSize((previous) => previous?.scale === scale && previous.height === height
				? previous : { scale, height });
		};
		measure();
		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", measure);
			return () => window.removeEventListener("resize", measure);
		}
		const observer = new ResizeObserver(measure);
		observer.observe(frame);
		observer.observe(card);
		return () => observer.disconnect();
	}, [fullWidth]);
	return (
		<div ref={frameRef} data-preview-frame data-preview-fit="scaled" data-preview-framed={framed} role="region" aria-label={label}
			style={{ width: "100%", maxWidth: fullWidth, minWidth: 0, height: size?.height, overflow: "hidden" }}>
			<div ref={cardRef} data-preview-card data-preview-width={width} data-preview-framed={framed}
				style={{ width, minWidth: width, maxWidth: width, boxSizing: "content-box", padding: framed ? NATIVE_CARD_PADDING : 0,
					border: framed ? "1px solid var(--shipit-seo-preview-border, currentColor)" : 0, color: "inherit",
					backgroundColor: framed ? "var(--shipit-seo-preview-background, inherit)" : "transparent",
					boxShadow: framed ? undefined : "none",
					transform: `scale(${size?.scale ?? 1})`, transformOrigin: "top left" }}>
				{children}
			</div>
		</div>
	);
}

/**
 * Shows the fitted card at its full model size. A container narrower than the
 * card scrolls only this canvas, which is then focusable for keyboard scrolling.
 */
function FixedPreviewFrame({ label, width, children, framed = true }: {
	label: string;
	width: number;
	children: React.ReactNode;
	framed?: boolean;
}) {
	const frameRef = React.useRef<HTMLDivElement>(null);
	const fullWidth = width + (framed ? NATIVE_CARD_PADDING * 2 + 2 : 0);
	const [scrollable, setScrollable] = React.useState(false);
	React.useLayoutEffect(() => {
		const frame = frameRef.current;
		if (!frame) return;
		const measure = () => setScrollable(frame.scrollWidth - frame.clientWidth > 1);
		measure();
		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", measure);
			return () => window.removeEventListener("resize", measure);
		}
		const observer = new ResizeObserver(measure);
		observer.observe(frame);
		return () => observer.disconnect();
	}, [fullWidth]);
	return (
		<div ref={frameRef} data-preview-frame data-preview-fit="fixed" data-preview-framed={framed}
			data-preview-scrollable={scrollable || undefined} role="region"
			aria-label={scrollable ? `${label}, scroll horizontally to see the full card` : label}
			tabIndex={scrollable ? 0 : undefined}
			style={{ width: "100%", maxWidth: fullWidth, minWidth: 0, overflowX: "auto", overflowY: "hidden" }}>
			<div data-preview-card data-preview-width={width} data-preview-framed={framed}
				style={{ width, minWidth: width, maxWidth: width, boxSizing: "content-box", padding: framed ? NATIVE_CARD_PADDING : 0,
					border: framed ? "1px solid var(--shipit-seo-preview-border, currentColor)" : 0, color: "inherit",
					backgroundColor: framed ? "var(--shipit-seo-preview-background, inherit)" : "transparent",
					boxShadow: framed ? undefined : "none" }}>
				{children}
			</div>
		</div>
	);
}

function ResponsivePreviewFrame({ label, width, children }: {
	label: string;
	width: number;
	children: React.ReactNode;
}) {
	return (
		<div data-preview-frame data-preview-fit="responsive" data-preview-framed role="region" aria-label={label}
			style={{ width: "100%", maxWidth: width + NATIVE_CARD_PADDING * 2 + 2, minWidth: 0 }}>
			<div data-preview-card data-preview-width={width} data-preview-framed
				style={{ width: "100%", minWidth: 0, maxWidth: "100%", boxSizing: "border-box", padding: NATIVE_CARD_PADDING,
					border: "1px solid var(--shipit-seo-preview-border, currentColor)", color: "inherit",
					backgroundColor: "var(--shipit-seo-preview-background, inherit)" }}>
				{children}
			</div>
		</div>
	);
}

function PreviewFrame({ label, width, children, native = false, framed = true, responsive = false, fixed = false }: {
	label: string;
	width: number;
	children: React.ReactNode;
	native?: boolean;
	framed?: boolean;
	responsive?: boolean;
	fixed?: boolean;
}) {
	if (native && responsive) return <ResponsivePreviewFrame label={label} width={width}>{children}</ResponsivePreviewFrame>;
	if (native && fixed) return <FixedPreviewFrame label={label} width={width} framed={framed}>{children}</FixedPreviewFrame>;
	if (native) return <NativePreviewFrame label={label} width={width} framed={framed}>{children}</NativePreviewFrame>;
	return (
		<div data-preview-frame role="region" aria-label={`${label}, horizontally scrollable`} tabIndex={0}
			style={{ width: "100%", maxWidth: "100%", minWidth: 0, overflowX: "auto", paddingBottom: 4 }}>
			<div data-preview-card data-preview-width={width}
				style={{ width, minWidth: width, maxWidth: width, boxSizing: "content-box",
					border: "1px solid var(--shipit-seo-preview-border, currentColor)", color: "inherit",
					backgroundColor: "var(--shipit-seo-preview-background, inherit)" }}>
				{children}
			</div>
		</div>
	);
}

/** Ranges are [start, end) offsets into the fitted display text. */
export type PreviewEmphasis = ReadonlyArray<readonly [number, number]>;

/**
 * Lines come from wrapping the display text, so each one starts where the
 * previous ended or one dropped space later. A line that cannot be located
 * that way leaves every line plain.
 */
function emphasisedLines(displayText: string, lines: readonly string[], emphasis?: PreviewEmphasis): React.ReactNode[] {
	if (!emphasis?.length) return [...lines];
	const starts: number[] = [];
	let position = 0;
	for (const line of lines) {
		const start = displayText.startsWith(line, position) ? position
			: displayText[position] === " " && displayText.startsWith(line, position + 1) ? position + 1 : -1;
		if (start < 0) return [...lines];
		starts.push(start);
		position = start + line.length;
	}
	return lines.map((line, index) => {
		const offset = starts[index]!;
		const parts: React.ReactNode[] = [];
		let cursor = 0;
		for (const [from, to] of emphasis) {
			const start = Math.max(from - offset, cursor);
			const end = Math.min(to - offset, line.length);
			if (end <= start) continue;
			if (start > cursor) parts.push(line.slice(cursor, start));
			parts.push(<strong key={start} data-preview-emphasis>{line.slice(start, end)}</strong>);
			cursor = end;
		}
		if (!parts.length) return line;
		if (cursor < line.length) parts.push(line.slice(cursor));
		return parts;
	});
}

function FittedLines({ name, field, fitted, profile, responsive = false, emphasis }: {
	name: "title" | "description";
	field: PreviewField;
	fitted: FittedSnippetText;
	profile: SnippetTextProfile;
	responsive?: boolean;
	emphasis?: PreviewEmphasis;
}) {
	const label = name === "title" ? "Title" : "Description";
	const lineStyle: React.CSSProperties = {
		width: responsive ? "100%" : profile.width, fontFamily: profile.fontFamily, fontSize: profile.fontSize,
		fontWeight: profile.weight === "bold" ? 700 : 400, lineHeight: profile.lineHeight,
		letterSpacing: 0, whiteSpace: responsive ? "normal" : "nowrap", overflowWrap: responsive ? "anywhere" : "normal", wordBreak: "normal",
		textTransform: "none", textIndent: 0, textAlign: "start",
	};
	return (
		<div data-preview-field={name} data-preview-clipped={fitted.clipped} dir="auto">
			{field.state === "unavailable" ? (
				<div style={lineStyle}>{label} unavailable</div>
			) : fitted.lines.length ? emphasisedLines(fitted.displayText, responsive ? [fitted.displayText] : fitted.lines, emphasis).map((line, index) => (
				<div key={index} data-preview-line={name} dir="auto" style={lineStyle}>{line}</div>
			)) : (
				<div style={lineStyle}>{fitted.prefixClipped ? `${label} cannot fit this preview` : `No ${name}`}</div>
			)}
		</div>
	);
}

function PreviewUrl({ field, value = field.value, native = false }: { field: PreviewField; value?: string | null; native?: boolean }) {
	if (native) {
		let host: string | null = null;
		if (field.state !== "unavailable" && value) {
			try {
				host = new URL(value).host || null;
			} catch { /* An unresolved address is displayed exactly as supplied. */ }
		}
		return (
			<div data-preview-url dir="auto">
				<strong data-preview-host>{field.state === "unavailable" ? "Address unavailable" : host || value || "No public address"}</strong>
				{host ? <span data-preview-address dir="auto">{value}</span> : null}
			</div>
		);
	}
	return (
		<div dir="auto" style={{ fontSize: 13, lineHeight: 1.5, overflowWrap: "anywhere" }}>
			{field.state === "unavailable" ? "URL unavailable" : value || "No URL"}
		</div>
	);
}

function FieldSources({ fields, compact = false }: { fields: readonly { label: string; field: PreviewField; showValue?: boolean }[]; compact?: boolean }) {
	return (
		<dl data-preview-sources aria-label="Preview sources" style={{ display: "grid", gridTemplateColumns: "minmax(0, max-content) minmax(0, 1fr)",
			gap: "0.25rem 0.75rem", margin: "0.75rem 0 0", fontSize: compact ? "0.75rem" : "0.875rem" }}>
			{fields.map(({ label, field, showValue }) => (
				<React.Fragment key={label}>
					<dt style={{ overflowWrap: "anywhere" }}>{label}</dt>
					<dd style={{ margin: 0, overflowWrap: "anywhere" }}>
						<span data-preview-state={field.state}>{FIELD_STATES[field.state]}</span>
						{"; source: "}<bdi>{field.source || "Unspecified"}</bdi>
						{showValue && <div dir="auto">{field.state === "unavailable" ? "Value unavailable" : field.value || "No value"}</div>}
					</dd>
				</React.Fragment>
			))}
		</dl>
	);
}

type NativeFieldName = "title" | "description" | "image" | "url";
type NativeSourceField = { name: NativeFieldName; label: string; field: PreviewField; showValue?: boolean; basis?: SocialPreviewFieldBasis };

function NativeFieldSource({ name, field, basis }: { name: NativeFieldName; field: PreviewField; basis?: SocialPreviewFieldBasis }) {
	if (basis !== undefined) {
		const effective = field.state === "unavailable" ? "unavailable" : basis;
		const empty = !field.value?.trim();
		const message = effective === "unavailable" ? "Value unavailable until metadata is refreshed."
			: effective === "local" ? empty ? "No value in the local preview." : "Local preview value."
			: effective === "confirmed" ? empty ? "Confirmed empty sharing field." : "Confirmed sharing value."
			: empty ? "No saved value." : "Saved value.";
		return <span data-preview-state={field.state} data-preview-basis={effective}>{message}</span>;
	}

	if (field.state === "unavailable") return <span data-preview-state={field.state}>Could not be read.</span>;
	const origins = {
		"legacy-override": "earlier SEO settings",
		"plugin-social-override": `your sharing ${name === "url" ? "settings" : name}`,
		"core-seo": `the ${name === "url" ? "preferred URL" : name} in this entry's SEO settings`,
		template: name === "title" || name === "description" ? `your ${name} template` : "your template",
		content: name === "title" ? "your content title" : "your content",
		"site-default": "your site defaults",
		generated: name === "url" ? "this entry's public address" : "an automatically generated value",
	} satisfies Record<SeoAdminMetadataSource, string>;
	const origin = Object.hasOwn(origins, field.source) ? origins[field.source as SeoAdminMetadataSource] : null;
	const status = field.state === "draft" ? "Unsaved" : "Saved";
	const empty = !field.value?.trim();
	const emptyMessage = field.state === "draft"
		? `No ${name === "url" ? "address" : name} in the draft.`
		: `No saved ${name === "url" ? "address" : name}.`;
	const message = empty
		? `${emptyMessage}${origin ? ` From ${origin}.` : " Source information unavailable."}`
		: origin ? `${status} value from ${origin}.` : `${status} value. Source information unavailable.`;
	return <span data-preview-state={field.state}>{message}</span>;
}

function NativeFieldSources({ fields }: { fields: readonly NativeSourceField[] }) {
	return (
		<dl data-preview-sources aria-label="Preview information" style={{ display: "grid", gridTemplateColumns: "minmax(0, max-content) minmax(0, 1fr)",
			gap: "0.25rem 0.75rem", margin: "0.75rem 0 0", fontSize: "0.75rem" }}>
			{fields.map(({ name, label, field, showValue, basis }) => (
				<React.Fragment key={label}>
					<dt style={{ overflowWrap: "anywhere" }}>{label}</dt>
					<dd style={{ margin: 0, overflowWrap: "anywhere" }}>
						<NativeFieldSource name={name} field={field} basis={basis} />
						{showValue && field.state !== "unavailable" && field.value ? <>
							<div dir="auto">{field.value}</div>
							{name === "title" || name === "description" ? <span data-preview-character-count={name}>{[...field.value].length} characters</span> : null}
						</> : null}
					</dd>
				</React.Fragment>
			))}
		</dl>
	);
}

function PreviewMetadata({ children }: { children: React.ReactNode }) {
	return <aside className="sr-only" data-preview-metadata aria-label="Full preview metadata">{children}</aside>;
}

function PreviewSummary({ label, draft, lastLoaded = false, updating = false }: { label: string; draft: boolean; lastLoaded?: boolean; updating?: boolean }) {
	return (
		<figcaption data-preview-summary>
			<span>{label} (approximate)</span>
			<span data-preview-summary-state>{lastLoaded ? "Last-loaded values" : updating ? "Updating preview..." : draft ? "Unsaved changes" : "Saved values"}</span>
		</figcaption>
	);
}

/**
 * A device card wider than the space it is given reflows instead of clipping
 * inside a scroller; the fitted text and its cut stay those of the device.
 */
export function searchPreviewReflows(cardWidth: number, available: number | null): boolean {
	return available !== null && available > 0 && available + 1 < cardWidth;
}

function useAvailableWidth(initial: number | null): [React.RefObject<HTMLElement | null>, number | null] {
	const ref = React.useRef<HTMLElement>(null);
	const [width, setWidth] = React.useState<number | null>(initial);
	React.useLayoutEffect(() => {
		const element = ref.current?.parentElement;
		if (!element) return;
		const measure = () => {
			const style = window.getComputedStyle(element);
			const content = element.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
			if (content > 0) setWidth(content);
		};
		measure();
		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", measure);
			return () => window.removeEventListener("resize", measure);
		}
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return [ref, width];
}

function MissingPreviewUrl({ field }: { field: PreviewField }) {
	if (field.state !== "unavailable" && field.value) return null;
	return <p data-preview-unavailable role="note">{field.state === "unavailable"
		? "The public address could not be read."
		: "No public address is available for this entry."}</p>;
}

const DESCRIPTION_SOURCE_LABELS: Record<SeoAdminMetadataSource, string> = {
	"core-seo": "Entry SEO settings",
	"legacy-override": "Earlier SEO settings",
	template: "Metadata template",
	content: "Saved content",
	"site-default": "Site defaults",
	generated: "Generated fallback",
	"plugin-social-override": "Sharing override",
};

function SearchDescriptionReadout({ field, lastLoaded }: {
	field: PreviewField;
	lastLoaded: boolean;
}) {
	const available = field.state !== "unavailable";
	const text = available ? field.value ?? "" : "";
	const characters = available ? [...text].length : null;
	const empty = !text.trim();
	const state = !available ? "unavailable" : empty ? "empty" : "resolved";
	const source = Object.hasOwn(DESCRIPTION_SOURCE_LABELS, field.source)
		? DESCRIPTION_SOURCE_LABELS[field.source as SeoAdminMetadataSource] : "Not reported";
	const value = <p data-preview-description-text dir="auto">{!available ? "The resolved description could not be read."
		: empty ? "No description is resolved." : text}</p>;
	return (
		<div data-preview-description-info data-description-state={state} data-description-freshness={lastLoaded ? "last-loaded" : undefined}>
			<div data-preview-description-heading>
				<span>Resolved description</span>
				<strong data-preview-description-count>{characters === null ? "Count unavailable" : `${characters.toLocaleString("en")} characters`}</strong>
			</div>
			<p data-preview-description-source>{lastLoaded ? "Last loaded. " : field.state === "draft" ? "Local preview. " : ""}Source: {source}.</p>
			{value}
		</div>
	);
}

export interface SearchPreviewProps {
	model: SerpPreviewModel;
	presentation?: "native" | "result-page";
	descriptionDisplay?: "compact" | "full" | "external";
	lastLoaded?: boolean;
	/** Bold ranges of the fitted description's display text. */
	descriptionEmphasis?: PreviewEmphasis;
	/** Newer saved values are loading; the card still shows the earlier ones. */
	updating?: boolean;
	/** Width the card's container offers before it is measured. */
	containerWidth?: number;
}

export function SearchPreview({ model, presentation, descriptionDisplay = "compact", lastLoaded = false, descriptionEmphasis, updating = false, containerWidth }: SearchPreviewProps) {
	const label = `${model.device === "desktop" ? "Desktop" : "Mobile"} search preview`;
	const native = presentation === "native" || presentation === "result-page";
	const resultPage = presentation === "result-page";
	const [figureRef, available] = useAvailableWidth(containerWidth ?? null);
	const cardWidth = model.profile.title.width + (resultPage ? 0 : NATIVE_CARD_PADDING * 2 + 2);
	const reflowed = native && descriptionDisplay !== "compact" && searchPreviewReflows(cardWidth, available);
	const responsive = native && ((!resultPage && descriptionDisplay === "compact") || reflowed);
	const description = native && !model.description.value?.trim() && model.description.state !== "unavailable"
		? { text: "", displayText: "", lines: [], clipped: false, inputLimited: false, prefixClipped: false }
		: model.fittedDescription;
	const sources = [
		{ label: "Title", field: model.title, showValue: true },
		{ label: "Description", field: model.description, showValue: true },
		{ label: "Permalink", field: model.permalink, showValue: true },
		{ label: "Canonical", field: model.canonical, showValue: true },
	];
	const nativeSources: NativeSourceField[] = [
		{ name: "title", label: "Title", field: model.title, showValue: true },
		{ name: "description", label: "Description", field: model.description },
		{ name: "url", label: model.canonical.source === "core-seo" || model.canonical.source === "legacy-override" ? "Preferred URL" : "Address", field: model.canonical, showValue: true },
	];
	if (model.permalink.state !== "unavailable" && model.permalink.value && model.permalink.value !== model.canonical.value) {
		nativeSources.push({ name: "url", label: "Page address", field: model.permalink, showValue: true });
	}
	return (
		<figure ref={figureRef} data-preview-kind="search" data-preview-presentation={presentation} data-preview-reflowed={reflowed || undefined}
			aria-label={`${label} (approximate)`}
			style={{ margin: native && !resultPage ? "0 auto" : 0, minWidth: 0, color: "inherit",
				width: native ? "100%" : undefined, maxWidth: native ? cardWidth : undefined }}>
			<PreviewFrame label={label} width={model.profile.title.width} native={native} framed={!resultPage} responsive={responsive} fixed={!responsive}>
				<PreviewUrl field={model.canonical} value={model.displayUrl} native={native} />
				<FittedLines name="title" field={model.title} fitted={model.fittedTitle} profile={model.profile.title} responsive={responsive} />
				<FittedLines name="description" field={model.description} fitted={description} profile={model.profile.description} responsive={responsive}
					emphasis={description === model.fittedDescription ? descriptionEmphasis : undefined} />
			</PreviewFrame>
			{reflowed ? <p data-preview-reflow-note>Reflowed to fit this screen. The text is cut where a {model.device === "desktop" ? "desktop" : "phone"} result cuts it; line breaks differ.</p> : null}
			{native && descriptionDisplay === "full" ? <SearchDescriptionReadout field={model.description} lastLoaded={lastLoaded} /> : null}
			<PreviewSummary label={`${model.device === "desktop" ? "Desktop" : "Mobile"} search`} draft={model.isDraft} lastLoaded={lastLoaded} updating={updating} />
			<MissingPreviewUrl field={model.canonical} />
			<PreviewMetadata>
				{native ? <>
					{descriptionDisplay !== "full" ? <SearchDescriptionReadout field={model.description} lastLoaded={lastLoaded} /> : null}
					<NativeFieldSources fields={nativeSources} />
				</> : <FieldSources fields={sources} />}
			</PreviewMetadata>
		</figure>
	);
}

type ImagePresentationStatus = "loading" | "loaded" | "failed";

class SocialImagePresentation extends React.Component<{ url: string; native?: boolean }, { status: ImagePresentationStatus }> {
	state: { status: ImagePresentationStatus } = { status: "loading" };

	render() {
		const { status } = this.state;
		const native = this.props.native === true;
		const text = status === "loaded" ? "Image loaded." : status === "failed" ? "Image could not load." : "Loading image.";
		return <div data-preview-image-presentation={status} style={{ width: "100%", height: "100%", position: "relative", display: "grid", placeItems: "center" }}>
			{status !== "failed" && <img src={this.props.url} alt="Social sharing image" loading="lazy"
				onLoad={() => this.setState({ status: "loaded" })}
				onError={() => this.setState({ status: "failed" })}
				style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "center",
					visibility: status === "loaded" ? "visible" : "hidden" }} />}
			<p className={status === "loaded" ? "sr-only" : undefined} data-preview-image-status={native ? status : undefined} role="status" aria-live="polite" style={{ margin: 0, padding: native ? "0.5rem 0.75rem" : "1rem", textAlign: "center",
				position: status === "loaded" ? "absolute" : undefined, insetInline: 0, bottom: 0,
				backgroundColor: "var(--shipit-seo-preview-background, Canvas)",
				color: "var(--shipit-seo-preview-foreground, CanvasText)" }}>{text}</p>
		</div>;
	}
}

export interface SocialPreviewProps {
	model: SocialPreviewModel;
	loadImage?: boolean;
	presentation?: "native";
	fieldBasis?: Partial<Record<NativeFieldName, SocialPreviewFieldBasis>>;
	caption?: string;
}

export function SocialPreview({ model, loadImage = false, presentation, fieldBasis, caption }: SocialPreviewProps) {
	const label = `${model.profile.platform === "facebook" ? "Facebook" : "X"} sharing preview`;
	const native = presentation === "native";
	const compactImage = native && model.imageState !== "available";
	const socialCaption = caption ?? (fieldBasis ? "Local preview" : undefined);
	const sources = [
		{ label: "Title", field: model.fields.title, showValue: true },
		{ label: "Description", field: model.fields.description, showValue: true },
		{ label: "Image", field: model.fields.image, showValue: true },
		{ label: "URL", field: model.fields.url, showValue: true },
	];
	const imageText = native ? model.imageState === "unavailable" ? "Sharing image could not be read."
		: model.imageState === "missing" ? "No sharing image set." : "Image set; preview not loaded."
		: model.imageState === "unavailable"
		? "Image unavailable; source could not be read."
		: model.imageState === "missing"
			? "No image source."
			: "Source specified; image not loaded.";
	return (
		<figure data-preview-kind="social" data-preview-presentation={presentation} aria-label={`${label} (approximate)`}
			style={{ margin: native ? "0 auto" : 0, minWidth: 0, color: "inherit",
				width: native ? "100%" : undefined, maxWidth: native ? model.profile.title.width + NATIVE_CARD_PADDING * 2 + 2 : undefined }}>
			<PreviewFrame label={label} width={model.profile.title.width} native={native}>
				<div data-preview-image-state={model.imageState} data-preview-image-compact={compactImage || undefined} dir="auto"
					style={{ width: model.profile.title.width, height: compactImage ? 48 : model.profile.title.width / model.profile.imageAspectRatio,
						aspectRatio: compactImage ? undefined : model.profile.imageAspectRatio,
						display: "grid", placeItems: "center", borderBottom: "1px solid var(--shipit-seo-preview-border, currentColor)" }}>
					{loadImage && model.imageState === "available" && model.fields.image.value
						? <SocialImagePresentation key={model.fields.image.value} url={model.fields.image.value} native={native} />
						: <p data-preview-image-presentation={model.imageState === "available" ? "supplied" : model.imageState}
							style={{ margin: 0, padding: native ? "0.5rem 0.75rem" : "1rem", textAlign: "center" }}>
							{compactImage ? model.imageState === "unavailable" ? <WarningCircle size={18} aria-hidden="true" /> : <ImageSquare size={18} aria-hidden="true" /> : null}
							{imageText}</p>}
				</div>
				<PreviewUrl field={model.fields.url} native={native} />
				<FittedLines name="title" field={model.fields.title} fitted={model.fittedTitle} profile={model.profile.title} />
				<FittedLines name="description" field={model.fields.description} fitted={model.fittedDescription} profile={model.profile.description} />
			</PreviewFrame>
			{socialCaption === undefined
				? <PreviewSummary label={`${model.profile.platform === "facebook" ? "Facebook" : "X"} sharing`} draft={model.isDraft} />
				: <figcaption data-preview-summary><span>{model.profile.platform === "facebook" ? "Facebook" : "X"} sharing (approximate)</span>
					<span data-preview-summary-state>{socialCaption}</span></figcaption>}
			<MissingPreviewUrl field={model.fields.url} />
			<PreviewMetadata>
				{native ? <NativeFieldSources fields={[
					{ name: "title", label: "Title", field: model.fields.title, basis: fieldBasis?.title, showValue: true },
					{ name: "description", label: "Description", field: model.fields.description, basis: fieldBasis?.description, showValue: true },
					{ name: "image", label: "Image", field: model.fields.image, basis: fieldBasis?.image, showValue: true },
					{ name: "url", label: model.fields.url.source === "core-seo" || model.fields.url.source === "legacy-override" ? "Preferred URL" : "Address", field: model.fields.url, basis: fieldBasis?.url, showValue: true },
				]} /> : <FieldSources fields={sources} />}
			</PreviewMetadata>
		</figure>
	);
}
