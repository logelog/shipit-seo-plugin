import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import * as jsx from "react/jsx-runtime";
import * as ts from "typescript";

import { BUSINESS_IDENTITY_LIMITS, BUSINESS_IDENTITY_LOGO_MIN_PIXELS, businessIdentityFamily } from "../business-identity.ts";
import {
	IDENTITY_STEPS,
	IDENTITY_STEP_LABELS,
	INITIAL_IDENTITY_EDITOR,
	createIdentityEditorStore,
	draftErrors,
	draftFromFacts,
	identityStepCompletion,
	stepForField,
	type IdentityDraft,
	type IdentityEditorEvent,
	type IdentityEditorState,
} from "./business-identity-model.ts";
import { createSeoI18n } from "./i18n/messages.ts";

const source = readFileSync(new URL("./business-identity-view.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("business-identity-view.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name: string) {
	const declarations = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
	assert.equal(declarations.length, 1, "Exact production declaration: " + name);
	return declarations[0].getText(parsed);
}
function compile(names: string[], scope: Record<string, unknown>) {
	const output = ts.transpileModule(names.map(declaration).join("\n") + `\nexport { ${names.join(", ")} };`, {
		fileName: "local-seo-probe.tsx",
		reportDiagnostics: true,
		compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
	});
	assert.deepEqual(output.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), []);
	const module = { exports: {} as Record<string, any> };
	new Function("require", "module", "exports", ...Object.keys(scope), output.outputText)(
		(name: string) => { assert.equal(name, "react/jsx-runtime"); return jsx; },
		module, module.exports, ...Object.values(scope),
	);
	return module.exports;
}
type Element = React.ReactElement<Record<string, any>>;
function elements(tree: unknown): Element[] {
	if (Array.isArray(tree)) return tree.flatMap(elements);
	if (!React.isValidElement(tree)) return [];
	const node = tree as Element;
	return [node, ...elements(node.props.children)];
}
function text(node: unknown): string {
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(text).join("");
	return React.isValidElement(node) ? text((node as Element).props.children) : "";
}

let store = createIdentityEditorStore();
let locale = "en";
const events: IdentityEditorEvent[] = [];
const identityStore = { dispatch: (event: IdentityEditorEvent) => { events.push(event); store.dispatch(event); }, get: () => store.get() };
const { LocalSeoNavigation } = compile(["LocalSeoNavigation"], {
	CheckCircle, WarningCircle, IDENTITY_STEPS, IDENTITY_STEP_LABELS, identityStepCompletion, identityStore,
	useIdentityEditor: () => store.get(),
	useSeoI18n: () => createSeoI18n(locale),
});
function reset(state: IdentityEditorState = INITIAL_IDENTITY_EDITOR) {
	store = createIdentityEditorStore(state); events.length = 0;
}
function render() {
	const nav = LocalSeoNavigation() as Element;
	assert.equal(nav.type, "nav");
	assert.equal(nav.props["aria-label"], createSeoI18n(locale).t("nav.view.identity"));
	const buttons = React.Children.toArray(nav.props.children) as Element[];
	assert.ok(buttons.every((button) => button.type === "button" && button.props.type === "button"));
	assert.equal(buttons.filter((button) => button.props["aria-current"] === "step").length, 1, "exactly one current step");
	assert.equal(buttons.filter((button) => button.props["aria-current"] === "page").length, 0, "steps are not pages");
	return {
		buttons,
		html: renderToStaticMarkup(nav),
		values: buttons.map((button) => button.props["data-local-seo-view"] as string),
		current: buttons.find((button) => button.props["aria-current"] === "step")!.props["data-local-seo-view"] as string,
		markers: buttons.map((button) => button.props["data-step-state"] as string | undefined),
		labels: buttons.map((button) => text(button.props.children)),
		click: (value: string) => buttons.find((button) => button.props["data-local-seo-view"] === value)?.props.onClick(),
	};
}
const draft = draftFromFacts({ kind: "Organization", name: "Harbour Bakery", contactPoints: [],
	sameAs: ["https://social.example/harbour"], areaServed: [], target: { kind: "home" } });
assert.deepEqual(draftErrors(draft), {}, "control: the fixture draft passes the Review validation");

// Without a draft only the first step exists and nothing is marked.
reset();
let nav = render();
assert.deepEqual(nav.values, ["identity"]);
assert.deepEqual(nav.markers, [undefined]);
assert.equal(nav.labels[0], "1" + IDENTITY_STEP_LABELS.identity);
assert.doesNotMatch(nav.html, /Website/, "Website is no longer a step");
nav.click("identity"); nav.click("review");
assert.deepEqual(events, [], "Opening setup never creates, saves or jumps");

// With a draft: six numbered steps, all done for a valid draft.
reset({ ...INITIAL_IDENTITY_EDITOR, draft, step: "social" });
nav = render();
assert.deepEqual(nav.values, [...IDENTITY_STEPS]);
assert.deepEqual(nav.labels, IDENTITY_STEPS.map((step, index) => `${index + 1}${IDENTITY_STEP_LABELS[step]}, done`));
assert.equal(nav.labels[5], "6Review and save, done");
assert.equal(nav.current, "social");
assert.deepEqual(nav.markers, IDENTITY_STEPS.map(() => "done"));
assert.equal((nav.html.match(/<svg\b/g) ?? []).length, 6, "every step shows its marker icon");
nav.click("social"); assert.deepEqual(events, [], "the current step is not dispatched again");
nav.click("contact");
assert.deepEqual(events, [{ type: "step", step: "contact" }]);
assert.equal(store.get().step, "contact"); assert.equal(store.get().draft, draft, "navigation never edits the draft");

// Markers come from the Review validation and the last server field errors.
const missingName: IdentityDraft = { ...draft, name: "" };
assert.ok(Object.keys(draftErrors(missingName)).some((field) => stepForField(field) === "identity"), "control: an empty name is an Identity error");
reset({ ...INITIAL_IDENTITY_EDITOR, draft: missingName, step: "identity" });
nav = render();
assert.equal(nav.markers[0], "attention");
assert.equal(nav.labels[0], "1Identity, needs attention");
assert.deepEqual(nav.markers.slice(1), ["done", "done", "done", "done", "done"]);
const badProfile: IdentityDraft = { ...draft, sameAs: ["not a url"] };
reset({ ...INITIAL_IDENTITY_EDITOR, draft: badProfile, step: "identity" });
assert.equal(render().markers[2], "attention", "an invalid profile marks Social");
reset({ ...INITIAL_IDENTITY_EDITOR, draft, step: "identity", errors: { target: "Choose a published page." } });
assert.equal(render().markers[5], "attention", "a refused target marks Review");
assert.deepEqual(identityStepCompletion(draft, { "address.streetAddress": "Required" }).address, "attention");
assert.deepEqual(Object.values(identityStepCompletion(draft)), IDENTITY_STEPS.map(() => "done"));

// Marker text follows the admin language.
for (const language of ["tr", "nl-BE"]) {
	locale = language;
	reset({ ...INITIAL_IDENTITY_EDITOR, draft: missingName });
	nav = render();
	assert.ok(nav.labels[0].endsWith(", " + createSeoI18n(language).t("localSeo.step.attention")));
	assert.ok(nav.labels[1].endsWith(", " + createSeoI18n(language).t("localSeo.step.done")));
}
locale = "en";

// Arrow keys move focus only; Tab and Enter keep native behavior.
reset({ ...INITIAL_IDENTITY_EDITOR, draft, step: "social" });
nav = render();
const focused: string[] = [];
const keyboardButtons = nav.buttons.map((button) => ({
	focus: () => { focused.push(button.props["data-local-seo-view"]); }, parentElement: null as unknown,
}));
const keyboardParent = { querySelectorAll: () => keyboardButtons };
for (const button of keyboardButtons) button.parentElement = keyboardParent;
let prevented = 0;
const key = (index: number, name: string) => nav.buttons[index].props.onKeyDown({
	key: name, currentTarget: keyboardButtons[index], preventDefault: () => { prevented += 1; },
});
key(0, "ArrowRight"); key(0, "ArrowLeft"); key(3, "Home"); key(0, "End");
assert.deepEqual(focused, ["contact", "review", "identity", "review"]);
assert.equal(prevented, 4);
key(0, "Tab"); key(0, "Enter");
assert.equal(prevented, 4);
assert.deepEqual(events, []);

// Protected states: navigation never settles or unlocks an operation.
for (const state of [
	{ ...INITIAL_IDENTITY_EDITOR, draft, step: "contact" as const, pending: "save" as const },
	{ ...INITIAL_IDENTITY_EDITOR, draft, step: "social" as const, notice: { kind: "uncertain" as const, message: "Read stored values first" } },
]) {
	reset(state); render().click("address");
	const current = store.get();
	assert.equal(current.draft, state.draft); assert.equal(current.pending, state.pending); assert.equal(current.notice, state.notice);
	assert.equal(current.step, "address");
	assert.ok(events.every((event: IdentityEditorEvent) => event.type === "step"));
}

const navigationSource = declaration("LocalSeoNavigation");
assert.doesNotMatch(navigationSource, /<Tabs|overflow|scrollLeft|scrollIntoView|website|Website/,
	"the steps neither scroll sideways nor include Website");
assert.doesNotMatch(navigationSource, /fetch|refresh|useEffect|setTimeout|setInterval|saveSeo|requestBusinessIdentityFocus/,
	"the step row reads the existing store and performs local navigation only");

// The form: Website summary on the Identity step, footer order, status actions on Review.
const formSource = declaration("BusinessIdentitySection");
assert.match(formSource, /showStepNavigation = true/, "standalone forms keep their own step tabs");
assert.match(formSource, /\{stepProps && state\.step === "identity" \? websiteSummary : null\}\s*\{stepProps && state\.step === "identity" \? \(\s*<IdentityStepView/,
	"the Website summary leads the Identity step");
assert.match(formSource, /\{!draft \? websiteSummary : null\}/, "the summary also shows before setup, where the site URL matters");
assert.match(formSource, /Local SEO's Website settings first/);
assert.match(formSource, />Edit website<\/Button>/);
const footer = formSource.slice(formSource.indexOf('className="shipit-seo-identity-footer"'), formSource.indexOf("</form>"));
const previous = footer.indexOf(">\n\t\t\t\t\t\t\t\tPrevious");
const discard = footer.indexOf("Discard changes");
const next = footer.indexOf("Next\n");
const saveLabel = footer.indexOf("identitySaveLabel(state)");
assert.ok(previous > 0 && discard > previous && saveLabel > discard && next > saveLabel, "Previous, Discard, then Save on Review or Next on steps 1 to 5");
assert.match(footer, /state\.step === "review" \? \(\s*<Button type="submit"/, "only Review submits");
assert.match(formSource, /\{state\.step !== "review" \? <button type="submit" hidden tabIndex=\{-1\} aria-hidden="true" \/> : null\}/,
	"Enter on steps 1 to 5 still reaches Review through the guarded save path");
assert.match(formSource, /if \(state\.step !== "review"\) \{\s*identityStore\.dispatch\(\{ type: "step", step: "review" \}\);\s*return;/,
	"an early submit only opens Review and writes nothing");
assert.doesNotMatch(footer, /Turn off|Turn on|Move ID to site address|view\.transitions/, "the footer carries no status or entity actions");
assert.match(formSource, /statusActions=\{<IdentityStatusActions state=\{state\} view=\{view\} disabled=\{disabled\} dirty=\{dirty\} \/>\}/);
const statusSource = declaration("IdentityStatusActions");
assert.match(statusSource, /record\.active \? \(\s*<Button[\s\S]*?disabled=\{disabled\}[\s\S]*?action: "deactivate", expectedRevision: revision[\s\S]*?Turn off/);
assert.match(statusSource, /disabled=\{disabled \|\| dirty\}[\s\S]*?action: "reactivate", expectedRevision: revision[\s\S]*?Turn on/);
assert.match(statusSource, /view\.transitions\.map[\s\S]*?disabled=\{disabled \|\| dirty\}[\s\S]*?action: "transition"/);
assert.match(declaration("ReviewStepView"), /<\/dl>\s*\{statusActions\}/, "status actions sit in the Review body, under the status summary");

// L3: logo guidance and fields that apply only to organizations and businesses.
const Stub = (name: string) => Object.assign(() => null, { displayName: name });
const Input = Stub("Input");
const InputArea = Stub("InputArea");
const RadioGroup = Stub("Radio.Group");
const RadioItem = Stub("Radio.Item");
const MultiChoice = Stub("MultiChoice");
const MediaField = Stub("MediaField");
const Select = Stub("Select");
const Button = Stub("Button");
const BusinessTypePicker = Stub("BusinessTypePicker");
const steps = compile(["IdentityStepView", "ContactStepView", "AddressStepView", "LocationStepView"], {
	Input, InputArea, Radio: { Group: RadioGroup, Item: RadioItem }, MultiChoice, MediaField, Select, Button, BusinessTypePicker,
	Switch: Stub("Switch"), SingleChoice: Stub("SingleChoice"), HoursEditor: Stub("HoursEditor"),
	KIND_LABELS: { Person: "Person", Organization: "Organization", LocalBusiness: "Local business" },
	CONTACT_TYPE_LABELS: {}, AREA_KIND_LABELS: {}, BUSINESS_IDENTITY_LIMITS, BUSINESS_IDENTITY_LOGO_MIN_PIXELS,
	IDENTITY_PUBLIC_NAME_ID: "public-name", IDENTITY_PROFILES_CONTROL_ID: "profiles",
	businessIdentityFamily, identityStore, edit: () => {}, replaceAt: () => [], removeAt: () => [],
	errorFor: (errors: Record<string, string>, path: string) => errors[path], groupError: () => undefined,
	languages: () => [], countries: () => [], precisionNote: () => "", isFoodEstablishmentType: () => false,
	Plus: Stub("Plus"), Trash: Stub("Trash"),
});
const stepProps = (value: IdentityDraft) => ({ draft: value, errors: {}, disabled: false, adopted: null, legacyFamily: "organization",
	keptFamily: null, allowNewFamily: true, siteUrl: "https://example.test", onPickMedia: () => {} });
const withPoint: IdentityDraft = { ...draft, legalName: "Harbour Bakery B.V.", logo: { url: "https://example.test/logo.png", width: 200, height: 200 },
	contactPoints: [{ contactType: "customer service", telephone: "+31 20 123 4567", email: "", availableLanguage: [], areaServed: ["NL"] }] };
const identityTree = (value: IdentityDraft) => elements(steps.IdentityStepView(stepProps(value)));
const inputLabels = (tree: Element[]) => tree.filter((node) => node.type === Input).map((node) => node.props.label);
const organization = identityTree(withPoint);
assert.deepEqual(inputLabels(organization), ["Public name", "Alternate name", "Legal name"]);
assert.equal(organization.find((node) => node.props.label === "Legal name")!.props.value, "Harbour Bakery B.V.");
const logo = organization.find((node) => node.type === MediaField && node.props.label === "Logo");
assert.ok(logo, "organizations choose a logo");
assert.equal(logo.props.description, "Square image, at least 112 x 112 px.");
assert.equal(BUSINESS_IDENTITY_LOGO_MIN_PIXELS, 112);
const contactLabels = (value: IdentityDraft) => elements(steps.ContactStepView(stepProps(value)))
	.filter((node) => node.type === MultiChoice).map((node) => node.props.label);
assert.deepEqual(contactLabels(withPoint), ["Languages spoken", "Countries served"]);

const person: IdentityDraft = { ...withPoint, kind: "Person" };
const personTree = identityTree(person);
assert.deepEqual(inputLabels(personTree), ["Public name", "Alternate name"], "a person has no legal name");
assert.equal(personTree.some((node) => node.type === MediaField && node.props.label === "Logo"), false, "a person has no logo");
assert.deepEqual(contactLabels(person), ["Languages spoken"], "a person has no countries served");
assert.match(text(steps.AddressStepView(stepProps(person))), /not published by this workflow/);
assert.match(text(steps.LocationStepView(stepProps(person))), /apply to a local business/);
assert.equal(identityTree(withPoint).some((node) => node.type === BusinessTypePicker), false, "only a local business picks a business type");
assert.equal(identityTree({ ...withPoint, kind: "LocalBusiness" }).some((node) => node.type === BusinessTypePicker), true);

// Switching to a person and back keeps every typed value; only the request leaves them out.
// The kind radio dispatches select-kind; a new setup changes only the draft's kind.
reset({ ...INITIAL_IDENTITY_EDITOR, latest: { writable: true, state: "absent" } as IdentityEditorState["latest"], draft: withPoint });
store.dispatch({ type: "select-kind", kind: "Person" });
assert.equal(store.get().draft!.kind, "Person", "control: the kind change was applied");
assert.equal(store.get().draft!.legalName, "Harbour Bakery B.V.");
store.dispatch({ type: "select-kind", kind: "Organization" });
assert.equal(store.get().draft!.kind, "Organization");
const restored = identityTree(store.get().draft!);
assert.equal(restored.find((node) => node.props.label === "Legal name")!.props.value, "Harbour Bakery B.V.", "switching back restores the draft value");
assert.equal(restored.find((node) => node.type === MediaField && node.props.label === "Logo")!.props.value, withPoint.logo);
assert.deepEqual(store.get().draft!.contactPoints[0]!.areaServed, ["NL"]);

console.log("Local SEO navigation checks passed (numbered steps with markers, footer order, Review status actions, logo guidance and kind-dependent fields).");
