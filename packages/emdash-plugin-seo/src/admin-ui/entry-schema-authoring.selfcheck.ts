import assert from "node:assert/strict";
import {
	ENTRY_SCHEMA_JSON_MAX_BYTES,
	ENTRY_SCHEMA_MAX_DEPTH,
	ENTRY_SCHEMA_MAX_VALUES,
	validateEntrySchemaJson,
} from "../entry-schemas.ts";
import {
	ENTRY_SCHEMA_AUTHORING_TYPES,
	createEntrySchemaAuthoring,
	decodeEntrySchemaAuthoring,
	encodeEntrySchemaAuthoring,
	entrySchemaAuthoringErrors,
	entrySchemaAuthoringFields,
	entrySchemaAuthoringVariable,
	type EntrySchemaAuthoringDraft,
	type EntrySchemaAuthoringPatch,
	type EntrySchemaAuthoringType,
	type EntrySchemaAuthoringVariable,
} from "./entry-schema-authoring.ts";

let assertions = 0;
function check(name: string, assertion: () => void): void {
	assertion();
	assertions += 1;
}
function read(json: string): EntrySchemaAuthoringDraft {
	const result = decodeEntrySchemaAuthoring(json);
	if (!result.ok) throw new Error(result.message);
	return result;
}
function edit(json: string, patch: EntrySchemaAuthoringPatch): string {
	const result = encodeEntrySchemaAuthoring(json, patch);
	if (!result.ok) throw new Error(result.message);
	return result.json;
}
const document = (extra: Record<string, unknown> = {}) => JSON.stringify({
	"@context": "https://schema.org", "@type": "Service", name: "Consultation", ...extra,
});

for (const type of ENTRY_SCHEMA_AUTHORING_TYPES) {
	check(`${type} is created only from documented saved-value tokens`, () => {
		const json = createEntrySchemaAuthoring(type);
		const decoded = read(json);
		assert.equal(decoded.type, type);
		assert.equal(decoded.fields[type === "Article" || type === "BlogPosting" ? "headline" : "name"], "{{title}}");
		assert.equal(decoded.fields.description, "{{description}}");
		assert.equal(decoded.fields.url, "");
		assert.equal(Object.hasOwn(JSON.parse(json), "url"), false, "A new draft must not depend on an explicitly saved canonical URL.");
		assert.equal(Object.hasOwn(JSON.parse(json), "@id"), false);
		assert.deepEqual(Object.keys(JSON.parse(json)).sort(), [
			"@context", "@type", "description",
			type === "Article" || type === "BlogPosting" ? "headline" : "name",
			...(type === "FAQPage" ? ["mainEntity"] : []),
		].sort());
		assert.equal(validateEntrySchemaJson(json).ok, true);
		assert.deepEqual(entrySchemaAuthoringErrors(decoded), type === "FAQPage" ? { questions: "Add at least one question and answer." } : {});
	});
	check(`${type} no-op round trip retains raw bytes`, () => {
		const json = ` \n${createEntrySchemaAuthoring(type)}\n `;
		assert.equal(read(json).json, json);
		assert.equal(edit(json, {}), json);
		assert.equal(edit(json, { fields: { description: "{{description}}" } }), json);
	});
	check(`${type} adds a canonical source only after an explicit field choice`, () => {
		const original = createEntrySchemaAuthoring(type);
		const selected = edit(original, { fields: { url: entrySchemaAuthoringVariable("canonical") } });
		assert.deepEqual(JSON.parse(selected), { ...JSON.parse(original), url: "{{canonical}}" });
		assert.equal(read(selected).fields.url, "{{canonical}}");
		assert.equal(validateEntrySchemaJson(selected).ok, true);
		assert.deepEqual(JSON.parse(edit(selected, { fields: { url: undefined } })), JSON.parse(original));
	});
	check(`${type} preserves existing literal and variable URL sources`, () => {
		for (const url of ["{{canonical}}", "{{ canonical }}", "https://example.test/dental?language=nl"]) {
			const json = ` \n${edit(createEntrySchemaAuthoring(type), { fields: { url } })}\n `;
			assert.equal(read(json).fields.url, url);
			assert.equal(edit(json, {}), json);
			assert.equal(edit(json, { fields: { url } }), json);
			assert.equal(read(edit(json, { fields: { description: "Updated summary" } })).fields.url, url);
		}
	});
}

check("field definitions offer only relevant documented variable controls", () => {
	for (const type of ENTRY_SCHEMA_AUTHORING_TYPES) {
		const fields = entrySchemaAuthoringFields(type);
		assert.equal(Object.isFrozen(fields), true);
		assert.deepEqual(fields.find((item) => item.key === "description")?.variables, ["description"]);
		assert.deepEqual(fields.find((item) => item.key === "url")?.variables, ["canonical"]);
		assert.equal(fields.find((item) => item.key === "@id")?.required, false);
		for (const definition of fields) assert.equal(Object.isFrozen(definition.variables), true);
	}
	assert.deepEqual(entrySchemaAuthoringFields("Service").find((item) => item.key === "serviceType")?.variables, []);
	for (const variable of ["title", "description", "canonical"] as const) assert.equal(entrySchemaAuthoringVariable(variable), `{{${variable}}}`);
	assert.throws(() => entrySchemaAuthoringVariable("author" as EntrySchemaAuthoringVariable));
	assert.throws(() => createEntrySchemaAuthoring("Dentist" as EntrySchemaAuthoringType));
});

check("field edits preserve Unicode, escaping, whitespace and other known properties", () => {
	const text = '  Dişçi "advies" \\ путь\n日本語 👩🏽‍⚕️ e\u0301\u2028  ';
	const original = document({ "@id": "{{canonical}}#service", serviceType: "Dental advice", description: "Original" });
	const changed = edit(original, { fields: { name: text } });
	assert.equal(read(changed).fields.name, text);
	assert.deepEqual(JSON.parse(changed), { ...JSON.parse(original), name: text });
	assert.equal(JSON.parse(original).name, "Consultation");
	const latest = edit(changed, { fields: { description: "Second edit" } });
	assert.equal(read(latest).fields.name, text, "A new patch must retain an interleaved edit in the latest JSON.");
	assert.equal(read(latest).fields.serviceType, "Dental advice");
});

check("an existing accepted schema.org context is preserved rather than rewritten", () => {
	const original = document({ "@context": "http://schema.org/" });
	assert.equal(JSON.parse(edit(original, { fields: { description: "A summary" } }))["@context"], "http://schema.org/");
});

check("optional fields are explicitly removed without blank placeholders or unrelated changes", () => {
	const original = document({ "@id": "{{canonical}}#service", description: "A summary", url: "{{canonical}}", serviceType: "Consultation" });
	const cleared = edit(original, { fields: { description: undefined, url: undefined, "@id": undefined } });
	assert.deepEqual(JSON.parse(cleared), {
		"@context": "https://schema.org", "@type": "Service", name: "Consultation", serviceType: "Consultation",
	});
	assert.equal(read(cleared).fields.description, "");
	assert.deepEqual(entrySchemaAuthoringErrors(read(cleared)), {});
	assert.equal(validateEntrySchemaJson(cleared).ok, true);
	const blank = edit(original, { fields: { description: "" } });
	assert.equal(Object.hasOwn(JSON.parse(blank), "description"), true, "A literal string remains distinct from an explicit removal.");
	assert.equal(Object.hasOwn(JSON.parse(edit(blank, { fields: { description: undefined } })), "description"), false);
});

check("omitted patches and removal of absent optional fields preserve exact source bytes", () => {
	const original = ` \n${document()}\n `;
	assert.equal(edit(original, {}), original);
	assert.equal(edit(original, { fields: {} }), original);
	assert.equal(edit(original, { fields: { description: undefined, serviceType: undefined, "@id": undefined } }), original);
	const changed = edit(original, { fields: { name: "Updated", description: undefined } });
	assert.equal(read(changed).fields.name, "Updated");
	assert.equal(Object.hasOwn(JSON.parse(changed), "description"), false);
});

check("required fields cannot be removed but their empty edit state remains recoverable", () => {
	for (const type of ["Article", "BlogPosting", "WebPage", "Service"] as const) {
		const key = type === "Article" || type === "BlogPosting" ? "headline" : "name";
		const original = createEntrySchemaAuthoring(type);
		const result = encodeEntrySchemaAuthoring(original, { fields: { [key]: undefined } });
		assert.equal(result.ok, false);
		assert.equal(!result.ok && result.reason, "invalid");
		assert.equal(read(original).fields[key], "{{title}}");
		const empty = edit(original, { fields: { [key]: "" } });
		assert.equal(Object.hasOwn(JSON.parse(empty), key), true);
		assert.ok(entrySchemaAuthoringErrors(read(empty))[key]);
		assert.equal(read(edit(empty, { fields: { [key]: "Restored" } })).fields[key], "Restored");
	}
	const faq = edit(createEntrySchemaAuthoring("FAQPage"), { fields: { name: undefined } });
	assert.equal(Object.hasOwn(JSON.parse(faq), "name"), false, "FAQ name is optional; question and answer requirements are separate.");
	assert.ok(entrySchemaAuthoringErrors(read(faq)).questions);
});

check("partially empty form values remain editable and have local required-field errors", () => {
	for (const type of ["Article", "BlogPosting", "WebPage", "Service"] as const) {
		const key = type === "Article" || type === "BlogPosting" ? "headline" : "name";
		const json = edit(createEntrySchemaAuthoring(type), { fields: { [key]: "  " } });
		assert.equal(read(json).fields[key], "  ");
		assert.ok(entrySchemaAuthoringErrors(read(json))[key]);
		assert.equal(validateEntrySchemaJson(json).ok, true, "Form completeness is separate from backend data-safety validation.");
	}
	const typing = edit(createEntrySchemaAuthoring("Article"), { fields: { headline: "{{ti" } });
	assert.equal(read(typing).fields.headline, "{{ti");
	assert.ok(entrySchemaAuthoringErrors(read(typing))._form);
	assert.deepEqual(entrySchemaAuthoringErrors(read(edit(typing, { fields: { headline: "{{title}}" } }))), {});
});

check("FAQ starts empty, accepts explicit rows and preserves their order and literal values", () => {
	const questions = [
		{ question: 'Wanneer is "intake"?', answer: "Neem contact op.\nDetails verschillen per afspraak." },
		{ question: "İlk görüşme nasıl? 👋", answer: "Sorularınızı hazırlayın; hiçbir tıbbi sonuç vaat edilmez." },
	];
	const populated = edit(createEntrySchemaAuthoring("FAQPage"), { questions });
	assert.deepEqual(read(populated).questions, questions);
	const raw = ` \n${populated}\n `;
	assert.equal(edit(raw, { questions: questions.map((item) => ({ answer: item.answer, question: item.question })) }), raw,
		"Equivalent row values with reordered object keys must not dirty or reserialize the raw draft.");
	assert.deepEqual(entrySchemaAuthoringErrors(read(populated)), {});
	assert.deepEqual(JSON.parse(populated).mainEntity[0], {
		"@type": "Question", name: questions[0].question, acceptedAnswer: { "@type": "Answer", text: questions[0].answer },
	});
	const reordered = edit(populated, { questions: questions.slice().reverse() });
	assert.deepEqual(read(reordered).questions, questions.slice().reverse());
	const partial = edit(populated, { questions: [{ question: "", answer: "" }, questions[1]] });
	assert.ok(entrySchemaAuthoringErrors(read(partial))["questions.0.question"]);
	assert.ok(entrySchemaAuthoringErrors(read(partial))["questions.0.answer"]);
	assert.ok(entrySchemaAuthoringErrors(read(edit(populated, { questions: [] }))).questions);
});

for (const [name, raw] of [
	["unknown scalar", document({ identifier: "Keep this ID" })],
	["unknown nested author", document({ author: { "@type": "Person", name: "Actual author" } })],
	["nested provider", document({ provider: { "@id": "https://example.test/#practice" } })],
	["rich known property", document({ description: { "@value": "Description", "@language": "nl" } })],
	["null known property", document({ description: null })],
	["remote context", document({ "@context": "https://example.test/context" })],
	["context object", document({ "@context": { "@vocab": "https://schema.org/" } })],
	["unsupported type", document({ "@type": "Dentist" })],
	["multiple types", document({ "@type": ["Service", "Thing"] })],
	["graph", JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "WebPage", name: "Keep graph" }] })],
	["top-level array", `[${document()}]`],
	["unknown prototype key", document({ ["__proto__"]: { keep: true } })],
	["FAQ answer metadata", JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Question?", acceptedAnswer: { "@type": "Answer", text: "Answer.", author: "Actual author" } }] })],
	["FAQ question ID", JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: [{ "@type": "Question", "@id": "#question", name: "Question?", acceptedAnswer: { "@type": "Answer", text: "Answer." } }] })],
	["FAQ object instead of list", JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: { "@type": "Question", name: "Question?" } })],
] as const) {
	check(`${name} refuses guided conversion and any patch without changing raw input`, () => {
		const before = raw;
		const decoded = decodeEntrySchemaAuthoring(raw);
		assert.equal(decoded.ok, false);
		assert.equal(!decoded.ok && decoded.reason, "unsupported");
		assert.equal(encodeEntrySchemaAuthoring(raw, { fields: { name: "Replacement" } }).ok, false);
		assert.equal(raw, before);
	});
}

check("empty and malformed JSON do not fabricate a guided draft", () => {
	for (const value of ["", "   "]) assert.equal((decodeEntrySchemaAuthoring(value) as { reason: string }).reason, "empty");
	for (const value of ["{", "undefined", '{"@type":"Article",}', '"text"', "null", "42"]) assert.equal(decodeEntrySchemaAuthoring(value).ok, false);
	assert.equal(encodeEntrySchemaAuthoring("{", {}).ok, false);
});

check("unsupported field and question patches cannot inject or silently discard data", () => {
	assert.equal(encodeEntrySchemaAuthoring(document(), { fields: { provider: "Unknown" } }).ok, false);
	assert.equal(encodeEntrySchemaAuthoring(document(), { questions: [] }).ok, false);
	assert.equal(encodeEntrySchemaAuthoring(createEntrySchemaAuthoring("FAQPage"), { questions: [{ question: "Q", answer: "A", author: "Keep" }] as never }).ok, false);
});

check("all entry JSON byte, depth and value limits remain enforced", () => {
	const overBytes = document({ name: "界".repeat(11_000) });
	assert.ok(new TextEncoder().encode(overBytes).byteLength > ENTRY_SCHEMA_JSON_MAX_BYTES);
	assert.equal(decodeEntrySchemaAuthoring(overBytes).ok, false);
	assert.equal(encodeEntrySchemaAuthoring(document(), { fields: { name: "界".repeat(11_000) } }).ok, false);
	let nested: unknown = "end";
	for (let index = 0; index <= ENTRY_SCHEMA_MAX_DEPTH; index += 1) nested = { nested };
	assert.equal((decodeEntrySchemaAuthoring(document({ nested })) as { reason: string }).reason, "invalid");
	const manyValues = document({ nested: Array.from({ length: ENTRY_SCHEMA_MAX_VALUES }, () => 0) });
	assert.equal((decodeEntrySchemaAuthoring(manyValues) as { reason: string }).reason, "invalid");
	const exact = document({ name: "" });
	const atLimit = document({ name: "a".repeat(ENTRY_SCHEMA_JSON_MAX_BYTES - new TextEncoder().encode(exact).byteLength) });
	assert.equal(new TextEncoder().encode(atLimit).byteLength, ENTRY_SCHEMA_JSON_MAX_BYTES);
	assert.equal(decodeEntrySchemaAuthoring(` \n${atLimit}\n `).ok, true, "Outer whitespace follows the existing validator's trimmed-byte rule.");
	const changed = edit(atLimit, { fields: { name: `b${"a".repeat(read(atLimit).fields.name.length - 1)}` } });
	assert.equal(new TextEncoder().encode(changed).byteLength, ENTRY_SCHEMA_JSON_MAX_BYTES, "Pretty-printing must not reject an otherwise valid compact edit.");
	assert.equal(validateEntrySchemaJson(changed).ok, true);
});

console.log(`Entry Schema authoring selfcheck passed (${assertions} cases).`);
