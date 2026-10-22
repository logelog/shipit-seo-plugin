import * as React from "react";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Collapsible } from "@cloudflare/kumo/components/collapsible";
import { Input, InputArea } from "@cloudflare/kumo/components/input";
import { Select } from "@cloudflare/kumo/components/select";
import { Article, Briefcase, Browser, Code, Newspaper, Plus, Question, Trash, Warning } from "@phosphor-icons/react";

import {
	ENTRY_SCHEMA_AUTHORING_TYPES,
	decodeEntrySchemaAuthoring,
	entrySchemaAuthoringErrors,
	entrySchemaAuthoringFields,
	entrySchemaAuthoringVariable,
	type EntrySchemaAuthoringField,
	type EntrySchemaAuthoringType,
	type EntrySchemaAuthoringVariable,
	type EntrySchemaAuthoringQuestion,
} from "./entry-schema-authoring.ts";
import type { EntrySchemaAuthoringMode } from "./entry-schema-model.ts";
import { validateEntrySchemaJson } from "@shipitseo/emdash-plugin-seo/admin-contract";

const TYPES = {
	Article: { label: "Article", description: "An editorial or informational article.", icon: Article },
	BlogPosting: { label: "Blog post", description: "A post in this site's blog.", icon: Newspaper },
	WebPage: { label: "Web page", description: "An individual page on this site.", icon: Browser },
	Service: { label: "Service", description: "A service described on this page.", icon: Briefcase },
	FAQPage: { label: "FAQ", description: "Questions and answers visible on this page.", icon: Question },
} satisfies Record<EntrySchemaAuthoringType, { label: string; description: string; icon: typeof Article }>;

const TEMPLATE_DESCRIPTIONS: Record<EntrySchemaAuthoringType, string> = {
	Article: "Editorial or informational content.",
	BlogPosting: "A reusable blog post structure.",
	WebPage: "A reusable page structure.",
	Service: "Details of a service.",
	FAQPage: "Questions and answers for the page.",
};

const VARIABLE_LABELS: Record<EntrySchemaAuthoringVariable, string> = {
	title: "Resolved SEO title",
	description: "Resolved meta description",
	canonical: "Canonical URL",
};

const VARIABLE_HELP: Record<EntrySchemaAuthoringVariable, string> = {
	title: "Uses the entry's SEO title after overrides and templates; it may differ from the content title.",
	description: "Uses the entry's meta description after overrides and templates; it may differ from the content text.",
	canonical: "Uses the canonical URL when the schema resolves.",
};

const TEMPLATE_VARIABLE_LABELS: Record<EntrySchemaAuthoringVariable, string> = {
	title: "Resolved SEO title",
	description: "Resolved meta description",
	canonical: "Page canonical URL",
};

const TEMPLATE_VARIABLE_HELP: Record<EntrySchemaAuthoringVariable, string> = {
	title: "Uses the destination page's SEO title when a copy resolves, including overrides and templates.",
	description: "Uses the destination page's meta description when a copy resolves, including overrides and templates.",
	canonical: "Uses the page's canonical URL when a copy is resolved.",
};

function overlappingOutputTypes(json: string, emitted: ReadonlySet<string>): string[] {
	if (!emitted.size) return [];
	const review = validateEntrySchemaJson(json);
	if (!review.ok) return [];
	const types = new Set<string>();
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const node of value) visit(node);
			return;
		}
		if (!value || typeof value !== "object") return;
		const node = value as Record<string, unknown>;
		const declared = Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]];
		for (const type of declared) {
			if (typeof type === "string" && emitted.has(type.trim())) types.add(type.trim());
		}
		// Nested authors and addresses describe related entities, not another top-level graph.
		if (node["@graph"]) visit(node["@graph"]);
	};
	visit(review.parsed);
	return [...types];
}

function overlapTitle(types: readonly string[]): string {
	const labels = types.slice(0, 3).map((type) => Object.hasOwn(TYPES, type)
		? TYPES[type as EntrySchemaAuthoringType].label : type);
	return `${labels.join(", ")}${types.length > 3 ? ` and ${types.length - 3} more` : ""} in this plugin's saved output`;
}

const OVERLAP_DESCRIPTION = "This may add another graph of the same type; existing graphs are not replaced or merged.";

export interface EntrySchemaAuthoringPatch {
	fields?: Partial<Record<string, string | undefined>>;
	questions?: EntrySchemaAuthoringQuestion[];
}

export interface EntrySchemaAuthoringControlsProps {
	json: string;
	mode: EntrySchemaAuthoringMode;
	context?: "entry" | "template";
	disabled: boolean;
	/** Emitted @type values for this entry, excluding the record under edit; entry context only. */
	existingOutputTypes?: readonly string[];
	/** Reveals this entry's existing schema output. */
	onShowExistingOutput?(): void;
	onModeChange(mode: EntrySchemaAuthoringMode): void;
	onChooseType(type: EntrySchemaAuthoringType): void;
	onPatch(patch: EntrySchemaAuthoringPatch): void;
}

/** Local fields are decoded from the current JSON; this view owns no copy of their values. */
export function EntrySchemaAuthoringControls({ json, mode, context = "entry", disabled, existingOutputTypes, onShowExistingOutput, onModeChange, onChooseType, onPatch }: EntrySchemaAuthoringControlsProps) {
	const decoded = decodeEntrySchemaAuthoring(json);
	const template = context === "template";
	const variableLabels = template ? TEMPLATE_VARIABLE_LABELS : VARIABLE_LABELS;
	const variableHelp = template ? TEMPLATE_VARIABLE_HELP : VARIABLE_HELP;
	const emitted = new Set(existingOutputTypes ?? []);
	const alreadyEmitted = (type: string) => !template && emitted.has(type);
	const overlappingTypes = template ? [] : overlappingOutputTypes(json, emitted);
	const [replacement, setReplacement] = React.useState<EntrySchemaAuthoringType | null>(null);
	const [overlap, setOverlap] = React.useState<EntrySchemaAuthoringType | null>(null);
	const replacementFocus = React.useRef<HTMLDivElement>(null);
	const overlapFocus = React.useRef<HTMLDivElement>(null);
	const modeFocus = React.useRef<HTMLElement>(null);
	const typeFocus = React.useRef<Partial<Record<EntrySchemaAuthoringType, HTMLButtonElement>>>({});
	const returnFocus = React.useRef<EntrySchemaAuthoringType | null>(null);
	const previousMode = React.useRef<"guided" | "advanced">("advanced");
	React.useEffect(() => {
		if (replacement) replacementFocus.current?.focus();
		else if (overlap) overlapFocus.current?.focus();
		else if (returnFocus.current) {
			typeFocus.current[returnFocus.current]?.focus();
			returnFocus.current = null;
		}
	}, [replacement, overlap]);
	React.useEffect(() => {
		if (mode !== "choose") modeFocus.current?.focus();
	}, [mode]);
	const keepDraft = () => {
		returnFocus.current = replacement;
		setReplacement(null);
	};
	const keepOverlap = () => {
		returnFocus.current = overlap;
		setOverlap(null);
	};
	const confirmOverlap = () => {
		const type = overlap;
		setOverlap(null);
		if (!type) return;
		if (json.trim()) setReplacement(type);
		else onChooseType(type);
	};
	const [touched, setTouched] = React.useState<ReadonlySet<string>>(() => new Set());
	const [typeSearch, setTypeSearch] = React.useState("");
	const errors = decoded.ok ? entrySchemaAuthoringErrors(decoded) : {};
	const markTouched = (key: string) => setTouched((current) => new Set([...current, key]));
	const choose = (type: EntrySchemaAuthoringType) => {
		if (disabled) return;
		if (alreadyEmitted(type)) setOverlap(type);
		else if (json.trim()) setReplacement(type);
		else onChooseType(type);
	};
	const changeMode = (next: EntrySchemaAuthoringMode) => {
		if (next === "choose" && mode !== "choose") previousMode.current = mode;
		setReplacement(null);
		setOverlap(null);
		onModeChange(next);
	};

	if (mode === "choose") {
		const typeNeedle = typeSearch.trim().toLowerCase();
		const shownTypes = typeNeedle
			? ENTRY_SCHEMA_AUTHORING_TYPES.filter((type) => TYPES[type].label.toLowerCase().includes(typeNeedle) || type.toLowerCase().includes(typeNeedle))
			: ENTRY_SCHEMA_AUTHORING_TYPES;
		return (
			<div className="shipit-seo-entry-authoring">
				<p className="shipit-seo-entry-schema__context">{template
					? "Choose a reusable schema structure. Saving a template does not add it to pages."
					: "Choose what this page describes. Existing default and shared schemas stay in place."}</p>
				{replacement ? (
					<div ref={replacementFocus} tabIndex={-1} role="alertdialog" aria-label="Replace draft JSON-LD" onKeyDown={(event) => {
						if (event.key !== "Escape") return;
						event.preventDefault();
						event.stopPropagation();
						if (!disabled) keepDraft();
					}}>
						<Banner variant="alert" icon={<Warning size={20} aria-hidden="true" />} title={`Replace this draft with ${TYPES[replacement].label} fields?`} description={template
							? "This replaces the template draft's JSON-LD. Existing page copies stay unchanged."
							: "This replaces the draft's JSON-LD. Nothing changes on the page until you save."} />
						<div className="shipit-seo-entry-schema__actions">
							<Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => { onChooseType(replacement); setReplacement(null); setTouched(new Set()); }}>Replace draft</Button>
							<Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={keepDraft}>Keep current draft</Button>
						</div>
					</div>
				) : overlap ? (
					<div ref={overlapFocus} tabIndex={-1} role="alertdialog" aria-label={overlapTitle([overlap])} onKeyDown={(event) => {
						if (event.key !== "Escape") return;
						event.preventDefault();
						event.stopPropagation();
						if (!disabled) keepOverlap();
					}}>
						<Banner variant="alert" icon={<Warning size={20} aria-hidden="true" />} title={overlapTitle([overlap])} description={OVERLAP_DESCRIPTION} />
						<div className="shipit-seo-entry-schema__actions">
							<Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={confirmOverlap}>Add {TYPES[overlap].label} anyway</Button>
							{onShowExistingOutput ? <Button type="button" size="sm" variant="secondary" onClick={onShowExistingOutput}>Show current output</Button> : null}
							<Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={keepOverlap}>Choose another type</Button>
						</div>
					</div>
				) : (<>
					<Input
						label="Search schema types"
						type="search"
						autoComplete="off"
						value={typeSearch}
						disabled={disabled}
						onChange={(event) => setTypeSearch(event.target.value)}
						onKeyDown={(event) => {
							if (event.key !== "Enter") return;
							// The chooser sits inside a save form; Enter picks the first match instead.
							event.preventDefault();
							if (shownTypes.length) choose(shownTypes[0]);
						}}
					/>
					{shownTypes.length ? <div className="shipit-seo-entry-authoring__types" role="group" aria-label="Choose a schema type">
						{shownTypes.map((type) => {
							const item = TYPES[type];
							const Icon = item.icon;
							return (
								<button key={type} ref={(element) => { if (element) typeFocus.current[type] = element; else delete typeFocus.current[type]; }} type="button" className="shipit-seo-entry-authoring__type" autoFocus={type === "Article"} disabled={disabled} onClick={() => choose(type)}>
									<Icon size={20} aria-hidden="true" />
									<span className="shipit-seo-entry-authoring__type-heading">{item.label}</span>
									<span className="shipit-seo-entry-authoring__type-description">{template ? TEMPLATE_DESCRIPTIONS[type] : item.description}</span>
									{alreadyEmitted(type) ? <span className="shipit-seo-entry-authoring__type-description">In this plugin's saved output.</span> : null}
								</button>
							);
						})}
					</div> : <p className="shipit-seo-entry-schema__context" role="status">No schema type matches</p>}
				</>)}
				<div className="shipit-seo-entry-schema__actions">
					<Button type="button" size="sm" variant="secondary" icon={<Code size={14} aria-hidden="true" />} disabled={disabled} onClick={() => changeMode("advanced")}>Advanced JSON-LD</Button>
					{json.trim() ? <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => changeMode(previousMode.current)}>Back to current draft</Button> : null}
				</div>
			</div>
		);
	}

	if (mode !== "guided" || !decoded.ok) {
		return (
			<div className="shipit-seo-entry-authoring">
				<div className="shipit-seo-entry-authoring__mode">
					<strong ref={modeFocus} tabIndex={-1}>Advanced JSON-LD</strong>
					{decoded.ok ? <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => changeMode("guided")}>Edit fields</Button> : null}
					<Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => changeMode("choose")}>Choose a type</Button>
				</div>
				{overlappingTypes.length > 0 ? (
					<Banner variant="secondary" icon={<Warning size={20} aria-hidden="true" />} title={overlapTitle(overlappingTypes)} description={OVERLAP_DESCRIPTION} action={onShowExistingOutput ? <Button type="button" size="sm" variant="secondary" onClick={onShowExistingOutput}>Show current output</Button> : undefined} />
				) : null}
				{!decoded.ok && decoded.reason === "unsupported" ? <p className="shipit-seo-entry-schema__context">This schema has details that need the JSON editor. All properties are kept.</p> : null}
			</div>
		);
	}

	const renderField = (field: EntrySchemaAuthoringField) => {
		const value = decoded.fields[field.key] ?? "";
		const variable = field.variables.find((key) => value === entrySchemaAuthoringVariable(key));
		const source = variable ?? "custom";
		const label = `${field.label}${field.required ? " *" : ""}`;
		const customLabel = field.variables.length ? `Custom ${field.label.toLowerCase()}${field.required ? " *" : ""}` : label;
		const error = touched.has(field.key) ? errors[field.key] : undefined;
		const update = (next: string) => onPatch({ fields: { [field.key]: !field.required && !next.trim() ? undefined : next } });
		return (
			<div key={field.key}>
				{field.variables.length ? (
					<div className="shipit-seo-entry-authoring__field-source">
						<Select<string>
							label={label}
							value={source}
							items={[{ value: "custom", label: "Custom value" }, ...field.variables.map((key) => ({ value: key, label: variableLabels[key] }))]}
							disabled={disabled}
							onValueChange={(next) => {
								if (next === "custom") update("");
								else if (field.variables.includes(next as EntrySchemaAuthoringVariable)) update(entrySchemaAuthoringVariable(next as EntrySchemaAuthoringVariable));
							}}
						/>
						{variable ? <p className="shipit-seo-entry-schema__context">{variableHelp[variable]}</p> : null}
					</div>
				) : null}
				{!variable ? field.multiline ? (
					<InputArea label={customLabel} aria-required={field.required || undefined} value={value} rows={3} disabled={disabled} error={error} onChange={(event) => update(event.target.value)} onBlur={() => markTouched(field.key)} />
				) : (
					<Input label={customLabel} aria-required={field.required || undefined} value={value} disabled={disabled} error={error} onChange={(event) => update(event.target.value)} onBlur={() => markTouched(field.key)} />
				) : null}
			</div>
		);
	};
	const fields = entrySchemaAuthoringFields(decoded.type);
	const required = fields.filter((field) => field.required);
	const optional = fields.filter((field) => !field.required);
	const questions = decoded.questions;
	const updateQuestion = (index: number, patch: Partial<EntrySchemaAuthoringQuestion>) => onPatch({ questions: questions.map((question, current) => current === index ? { ...question, ...patch } : question) });

	return (
		<div className="shipit-seo-entry-authoring">
			<div className="shipit-seo-entry-authoring__mode">
				<strong ref={modeFocus} tabIndex={-1}>{TYPES[decoded.type].label} fields</strong>
				<div className="shipit-seo-entry-schema__actions">
					<Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => changeMode("choose")}>Change type</Button>
					<Button type="button" size="sm" variant="secondary" icon={<Code size={14} aria-hidden="true" />} disabled={disabled} onClick={() => changeMode("advanced")}>Edit JSON-LD</Button>
				</div>
			</div>
			{overlappingTypes.length > 0 ? (
				<Banner variant="secondary" icon={<Warning size={20} aria-hidden="true" />} title={overlapTitle(overlappingTypes)} description={OVERLAP_DESCRIPTION} action={onShowExistingOutput ? <Button type="button" size="sm" variant="secondary" onClick={onShowExistingOutput}>Show current output</Button> : undefined} />
			) : null}
			<p className="shipit-seo-entry-schema__context">{template
				? "* Required by this form. Use a copy only on pages that show the content it describes."
				: "* Required by this form. Describe only content visible on this page."}</p>
			<div className="shipit-seo-entry-authoring__fields">{required.map(renderField)}</div>
			{decoded.type === "FAQPage" ? (
				<section className="shipit-seo-entry-authoring__questions" aria-label="Questions and answers">
					<div className="shipit-seo-entry-authoring__question-heading">
						<strong>Questions and answers</strong>
						<Button type="button" size="sm" variant="secondary" icon={<Plus size={14} aria-hidden="true" />} disabled={disabled} onClick={() => onPatch({ questions: [...questions, { question: "", answer: "" }] })}>Add question</Button>
					</div>
					{questions.length === 0 ? <p className="shipit-seo-entry-schema__context">{template
						? "Add questions and answers that will be visible where this template is used."
						: "Add at least one question and answer shown on this page."}</p> : null}
					{questions.map((question, index) => (
						<fieldset key={index} className="shipit-seo-entry-authoring__question" disabled={disabled}>
							<legend>Question {index + 1}</legend>
							<div className="shipit-seo-entry-authoring__question-heading">
								<span>{index + 1} of {questions.length}</span>
								<Button type="button" size="sm" variant="ghost" shape="square" icon={<Trash size={16} aria-hidden="true" />} aria-label={`Remove question ${index + 1}`} disabled={disabled} onClick={() => onPatch({ questions: questions.filter((_, current) => current !== index) })} />
							</div>
							<Input label="Question *" aria-required="true" value={question.question} disabled={disabled} error={touched.has(`questions.${index}.question`) ? errors[`questions.${index}.question`] : undefined} onChange={(event) => updateQuestion(index, { question: event.target.value })} onBlur={() => markTouched(`questions.${index}.question`)} />
							<InputArea label="Answer *" aria-required="true" value={question.answer} rows={3} disabled={disabled} error={touched.has(`questions.${index}.answer`) ? errors[`questions.${index}.answer`] : undefined} onChange={(event) => updateQuestion(index, { answer: event.target.value })} onBlur={() => markTouched(`questions.${index}.answer`)} />
						</fieldset>
					))}
				</section>
			) : null}
			{optional.length ? (
				<Collapsible.Root className="shipit-seo-entry-authoring__optional">
					<Collapsible.DefaultTrigger>Optional details</Collapsible.DefaultTrigger>
					<Collapsible.DefaultPanel><div className="shipit-seo-entry-authoring__fields">{optional.map(renderField)}</div></Collapsible.DefaultPanel>
				</Collapsible.Root>
			) : null}
			{errors._form ? <p className="shipit-seo-entry-schema__error" role="alert">{errors._form}</p> : null}
		</div>
	);
}
