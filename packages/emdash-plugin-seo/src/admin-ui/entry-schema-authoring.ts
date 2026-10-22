import {
	ENTRY_SCHEMA_JSON_MAX_BYTES,
	ENTRY_SCHEMA_MAX_DEPTH,
	ENTRY_SCHEMA_MAX_VALUES,
	validateEntrySchemaJson,
} from "../entry-schemas.ts";

export const ENTRY_SCHEMA_AUTHORING_TYPES = Object.freeze([
	"Article", "BlogPosting", "WebPage", "Service", "FAQPage",
] as const);

export type EntrySchemaAuthoringType = (typeof ENTRY_SCHEMA_AUTHORING_TYPES)[number];
export type EntrySchemaAuthoringVariable = "title" | "description" | "canonical";

export interface EntrySchemaAuthoringField {
	key: string;
	label: string;
	required: boolean;
	multiline: boolean;
	variables: readonly EntrySchemaAuthoringVariable[];
}

export interface EntrySchemaAuthoringQuestion {
	question: string;
	answer: string;
}

/** Derived from the current JSON; the entry editor remains its only owner. */
export interface EntrySchemaAuthoringDraft {
	json: string;
	type: EntrySchemaAuthoringType;
	fields: Record<string, string>;
	questions: EntrySchemaAuthoringQuestion[];
}

export interface EntrySchemaAuthoringRefusal {
	ok: false;
	reason: "empty" | "invalid" | "unsupported";
	message: string;
}

export type EntrySchemaAuthoringResult =
	| ({ ok: true } & EntrySchemaAuthoringDraft)
	| EntrySchemaAuthoringRefusal;

export type EntrySchemaAuthoringEncodeResult =
	| { ok: true; json: string }
	| EntrySchemaAuthoringRefusal;

export interface EntrySchemaAuthoringPatch {
	/** An explicit undefined removes an optional property; an absent key leaves it unchanged. */
	fields?: Partial<Record<string, string | undefined>>;
	questions?: readonly EntrySchemaAuthoringQuestion[];
}

function field(
	key: string,
	label: string,
	required = false,
	multiline = false,
	variables: EntrySchemaAuthoringVariable[] = [],
): EntrySchemaAuthoringField {
	return Object.freeze({ key, label, required, multiline, variables: Object.freeze(variables) });
}

const HEADLINE = field("headline", "Headline", true, false, ["title"]);
const NAME = field("name", "Name", true, false, ["title"]);
const DESCRIPTION = field("description", "Description", false, true, ["description"]);
const URL = field("url", "Page URL", false, false, ["canonical"]);
const ENTITY_ID = field("@id", "Entity ID", false, false, ["canonical"]);
const SERVICE_TYPE = field("serviceType", "Service type");
const FIELDS: Readonly<Record<EntrySchemaAuthoringType, readonly EntrySchemaAuthoringField[]>> = Object.freeze({
	Article: Object.freeze([HEADLINE, DESCRIPTION, URL, ENTITY_ID]),
	BlogPosting: Object.freeze([HEADLINE, DESCRIPTION, URL, ENTITY_ID]),
	WebPage: Object.freeze([NAME, DESCRIPTION, URL, ENTITY_ID]),
	Service: Object.freeze([NAME, DESCRIPTION, URL, SERVICE_TYPE, ENTITY_ID]),
	FAQPage: Object.freeze([field("name", "Name", false, false, ["title"]), DESCRIPTION, URL, ENTITY_ID]),
});

export function entrySchemaAuthoringFields(type: EntrySchemaAuthoringType): readonly EntrySchemaAuthoringField[] {
	return FIELDS[type];
}

export function entrySchemaAuthoringVariable(variable: EntrySchemaAuthoringVariable): string {
	if (!["title", "description", "canonical"].includes(variable)) throw new Error("Choose a supported saved value.");
	return `{{${variable}}}`;
}

function supportedType(value: unknown): value is EntrySchemaAuthoringType {
	return typeof value === "string" && (ENTRY_SCHEMA_AUTHORING_TYPES as readonly string[]).includes(value);
}

function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function refusal(reason: EntrySchemaAuthoringRefusal["reason"], message: string): EntrySchemaAuthoringRefusal {
	return { ok: false, reason, message };
}

function rawRequired(): EntrySchemaAuthoringRefusal {
	return refusal("unsupported", "This schema contains details the form cannot preserve. Continue editing JSON-LD.");
}

/** The form permits incomplete strings while typing; saving has stricter validation. */
function boundedJson(json: string): { ok: true; value: unknown } | EntrySchemaAuthoringRefusal {
	if (!json.trim()) return refusal("empty", "Choose a schema type or enter JSON-LD.");
	if (new TextEncoder().encode(json.trim()).byteLength > ENTRY_SCHEMA_JSON_MAX_BYTES)
		return refusal("invalid", `Use at most ${ENTRY_SCHEMA_JSON_MAX_BYTES.toLocaleString("en-US")} bytes of JSON-LD.`);
	let value: unknown;
	try { value = JSON.parse(json); }
	catch { return refusal("invalid", "Enter valid JSON-LD before opening the form."); }
	const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
	let count = 0;
	while (pending.length) {
		const current = pending.pop()!;
		count += 1;
		if (count > ENTRY_SCHEMA_MAX_VALUES)
			return refusal("invalid", `Use at most ${ENTRY_SCHEMA_MAX_VALUES.toLocaleString("en-US")} values.`);
		if (current.depth > ENTRY_SCHEMA_MAX_DEPTH)
			return refusal("invalid", `Nest objects and lists at most ${ENTRY_SCHEMA_MAX_DEPTH} levels deep.`);
		if (current.value !== null && typeof current.value === "object") {
			for (const child of Object.values(current.value)) pending.push({ value: child, depth: current.depth + 1 });
		}
	}
	return { ok: true, value };
}

/** Refuse richer shapes instead of silently flattening or deleting their data. */
export function decodeEntrySchemaAuthoring(json: string): EntrySchemaAuthoringResult {
	const parsed = boundedJson(json);
	if (!parsed.ok) return parsed;
	const node = parsed.value;
	if (!object(node) || !supportedType(node["@type"])) return rawRequired();
	if (typeof node["@context"] !== "string" || !/^https?:\/\/schema\.org\/?$/.test(node["@context"]))
		return rawRequired();
	const type = node["@type"];
	const definitions = entrySchemaAuthoringFields(type);
	const allowed = new Set(["@context", "@type", ...definitions.map((item) => item.key), ...(type === "FAQPage" ? ["mainEntity"] : [])]);
	if (Object.keys(node).some((key) => !allowed.has(key))) return rawRequired();
	const fields: Record<string, string> = {};
	for (const definition of definitions) {
		const value = node[definition.key];
		if (value !== undefined && typeof value !== "string") return rawRequired();
		fields[definition.key] = typeof value === "string" ? value : "";
	}
	const questions: EntrySchemaAuthoringQuestion[] = [];
	if (type === "FAQPage" && node.mainEntity !== undefined) {
		if (!Array.isArray(node.mainEntity)) return rawRequired();
		for (const question of node.mainEntity) {
			if (!object(question) || question["@type"] !== "Question" || typeof question.name !== "string" ||
				Object.keys(question).some((key) => !["@type", "name", "acceptedAnswer"].includes(key))) return rawRequired();
			const answer = question.acceptedAnswer;
			if (!object(answer) || answer["@type"] !== "Answer" || typeof answer.text !== "string" ||
				Object.keys(answer).some((key) => !["@type", "text"].includes(key))) return rawRequired();
			questions.push({ question: question.name, answer: answer.text });
		}
	}
	return { ok: true, json, type, fields, questions };
}

/** Called only after the editor explicitly chooses a type. */
export function createEntrySchemaAuthoring(type: EntrySchemaAuthoringType): string {
	if (!supportedType(type)) throw new Error("Choose a supported schema type.");
	return JSON.stringify({
		"@context": "https://schema.org",
		"@type": type,
		[type === "Article" || type === "BlogPosting" ? "headline" : "name"]: entrySchemaAuthoringVariable("title"),
		description: entrySchemaAuthoringVariable("description"),
		...(type === "FAQPage" ? { mainEntity: [] } : {}),
	}, null, 2);
}

/** Patch the latest raw draft, never an independently retained form snapshot. */
export function encodeEntrySchemaAuthoring(sourceJson: string, patch: EntrySchemaAuthoringPatch): EntrySchemaAuthoringEncodeResult {
	const decoded = decodeEntrySchemaAuthoring(sourceJson);
	if (!decoded.ok) return decoded;
	const node = JSON.parse(sourceJson) as Record<string, unknown>;
	let changed = false;
	const allowed = new Map(entrySchemaAuthoringFields(decoded.type).map((item) => [item.key, item]));
	for (const [key, value] of Object.entries(patch.fields ?? {})) {
		const definition = allowed.get(key);
		if (!definition) return rawRequired();
		if (value === undefined) {
			if (definition.required) return refusal("invalid", `${definition.label} is required by this form. Clear its text to edit it.`);
			if (Object.hasOwn(node, key)) {
				delete node[key];
				changed = true;
			}
			continue;
		}
		if (typeof value !== "string") return rawRequired();
		if (decoded.fields[key] !== value) {
			node[key] = value;
			changed = true;
		}
	}
	if (patch.questions !== undefined) {
		if (decoded.type !== "FAQPage" || !Array.isArray(patch.questions) || patch.questions.some((item) =>
			!object(item) || typeof item.question !== "string" || typeof item.answer !== "string" ||
			Object.keys(item).some((key) => key !== "question" && key !== "answer"))) return rawRequired();
		if (decoded.questions.length !== patch.questions.length || decoded.questions.some((item, index) =>
			item.question !== patch.questions![index].question || item.answer !== patch.questions![index].answer)) {
			node.mainEntity = patch.questions.map((item) => ({
				"@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer },
			}));
			changed = true;
		}
	}
	if (!changed) return { ok: true, json: sourceJson };
	const pretty = JSON.stringify(node, null, 2);
	const compact = new TextEncoder().encode(pretty).byteLength > ENTRY_SCHEMA_JSON_MAX_BYTES;
	const json = compact ? JSON.stringify(node) : pretty;
	const bounded = boundedJson(json);
	return bounded.ok ? { ok: true, json } : bounded;
}

/** Form completeness and existing write validation; neither proves resolved or public output. */
export function entrySchemaAuthoringErrors(draft: EntrySchemaAuthoringDraft): Record<string, string> {
	const errors: Record<string, string> = {};
	for (const definition of entrySchemaAuthoringFields(draft.type)) {
		if (definition.required && !draft.fields[definition.key]?.trim()) errors[definition.key] = `Enter ${definition.label.toLowerCase()}.`;
	}
	if (draft.type === "FAQPage") {
		if (!draft.questions.length) errors.questions = "Add at least one question and answer.";
		for (const [index, item] of draft.questions.entries()) {
			if (!item.question.trim()) errors[`questions.${index}.question`] = "Enter a question.";
			if (!item.answer.trim()) errors[`questions.${index}.answer`] = "Enter an answer.";
		}
	}
	const validation = validateEntrySchemaJson(draft.json);
	if (!validation.ok) errors._form = validation.message;
	return errors;
}
