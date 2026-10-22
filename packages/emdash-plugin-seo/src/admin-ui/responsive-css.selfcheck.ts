import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { SEO_ADMIN_VIEWS } from "./content-extension-model.ts";
import { SEO_WORKSPACE_NAV_GROUPS } from "./workspace-model.ts";

const css = readFileSync(new URL("./admin.css", import.meta.url), "utf8");
const editorCss = readFileSync(
	new URL("./content-editor.css", import.meta.url),
	"utf8",
);
const shellSource = readFileSync(new URL("./workspace-shell.tsx", import.meta.url), "utf8");

assert.doesNotMatch(
	css,
	/@container \(min-width: 860px\)[\s\S]*?\.shipit-seo-native-panel--sidebar/,
	"The shared workspace stylesheet must not own the editor panel's wide layout.",
);
assert.match(
	editorCss,
	/\.shipit-seo-native-panel--sidebar \.shipit-seo-native-panel__body-inner\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
	"The editor panel body must keep one bounded root track.",
);
assert.match(
	editorCss,
	/@container shipit-seo-panel \(min-width: 720px\)[\s\S]*?\.shipit-seo-native-panel__analysis-layout\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(330px,\s*1fr\)\)/,
	"Only the analysis layout may split into the prototype's two-column editor workspace.",
);
assert.match(
	css,
	/@container shipit-seo-panel \(max-width: 460px\)[\s\S]*?\.shipit-seo-native-advanced__directives-grid,[\s\S]*?\.shipit-seo-entry-schema__presets\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
	"Advanced directives and schema presets must collapse against the native editor panel, not only the admin workspace.",
);
assert.match(
	css,
	/\.shipit-seo-snippet-dialog__panel\s*\{[\s\S]*?container-name:\s*shipit-seo-dialog;[\s\S]*?container-type:\s*inline-size/,
	"The SEO settings dialog panels must establish a responsive container.",
);
const snippetDialogRule = css.match(/\[role="dialog"\]\.shipit-seo-snippet-dialog\s*\{([^}]*)\}/)?.[1];
assert.ok(snippetDialogRule, "The native dialog must override the host's minimum width.");
assert.match(snippetDialogRule, /width:\s*min\(960px,\s*calc\(100vw - 2rem\)\)/,
	"Wide native dialogs must leave room for a full search or social preview.");
assert.match(snippetDialogRule, /min-width:\s*0/,
	"The host dialog's minimum width must not force narrow viewport overflow.");
assert.match(snippetDialogRule, /max-width:\s*calc\(100vw - 2rem\)/,
	"The native dialog must keep an inset within the viewport.");
const dialogSocialGridRule = css.match(/\.shipit-seo-snippet-dialog__panel > \.shipit-seo-native-social\s*\{([^}]*)\}/)?.[1];
assert.ok(dialogSocialGridRule, "Native social settings must establish a bounded grid.");
assert.match(dialogSocialGridRule, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/,
	"Social settings and previews must stack in narrow dialogs.");
assert.match(
	css,
	/@container shipit-seo-dialog \(min-width: 760px\)[\s\S]*?\.shipit-seo-snippet-dialog__panel > \.shipit-seo-native-social\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.2fr\) minmax\(260px,\s*1fr\)/,
	"Wide social dialogs lead with the shrinkable fixed-profile preview and keep the form a readable track beside it.",
);
assert.match(
	css,
	/@container shipit-seo-dialog \(max-width: 460px\)[\s\S]*?\.shipit-seo-entry-schema__presets\[data-catalog\]\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
	"Schema catalog cards must use a readable single-column layout in narrow editor panels.",
);
assert.match(
	css,
	/\.shipit-seo-entry-schema__source input\s*\{[\s\S]*?width:\s*14px;[\s\S]*?height:\s*14px/,
	"Schema source radios must not inherit full-width form control sizing.",
);

const templateGridRule = css.match(
	/\.shipit-seo-template-editor,[\s\S]*?\.shipit-seo-output-support\s*\{([\s\S]*?)\}/,
)?.[1];

assert.ok(templateGridRule, "Template workspace grid rule must exist.");
assert.match(
	templateGridRule,
	/grid-template-columns:\s*minmax\(0,\s*1fr\)/,
	"Template grid tracks must be allowed to shrink below their intrinsic content width.",
);
assert.match(
	templateGridRule,
	/min-width:\s*0/,
	"Template grid items must not force horizontal overflow.",
);

const templateSelectRule = css.match(
	/\.shipit-seo-template-workspace\s+\[data-kumo-component="Select"\]\[data-kumo-part="trigger"\]\s*\{([\s\S]*?)\}/,
)?.[1];

assert.ok(templateSelectRule, "Template Select containment rule must exist.");
assert.match(templateSelectRule, /width:\s*100%/, "Template Select triggers must fill the available track.");
assert.match(templateSelectRule, /min-width:\s*0/, "Template Select triggers must be shrinkable.");
assert.match(templateSelectRule, /max-width:\s*100%/, "Template Select triggers must stay inside their panel.");

const compactSelectRule = css.match(
	/\.shipit-seo-workspace-nav__compact\s+\[data-kumo-component="Select"\]\[data-kumo-part="trigger"\]\s*\{([\s\S]*?)\}/,
)?.[1];

assert.ok(compactSelectRule, "Compact workspace section Select containment rule must exist.");
assert.match(compactSelectRule, /width:\s*100%/, "Compact workspace section Select must fill its track.");
assert.match(compactSelectRule, /min-width:\s*0/, "Compact workspace section Select must be shrinkable.");
assert.match(compactSelectRule, /max-width:\s*100%/, "Compact workspace section Select must stay inside the viewport.");
assert.match(
	css,
	/\.shipit-seo-admin\s*\{[\s\S]*?container-type:\s*inline-size/,
	"Workspace navigation must respond to the available admin content width.",
);
assert.match(
	css,
	/\.shipit-seo-workspace-shell\s*\{[\s\S]*?grid-template-columns:\s*minmax\(210px,\s*230px\) minmax\(0,\s*1fr\)/,
	"The selected desktop rail is bounded while the main content track can shrink.",
);
assert.match(
	css,
	/\.shipit-seo-workspace-nav__item--active[^\{]*\{[\s\S]*?font-weight:\s*600/,
	"The current workspace destination must remain visually distinct.",
);
const narrowNavigationRule = css.match(
	/@container shipit-seo-admin \(max-width: 760px\)[\s\S]*?\.shipit-seo-workspace-nav\s*\{([^}]*)\}/,
)?.[1];
assert.ok(narrowNavigationRule, "The same navigation owner must adapt to constrained admin content areas.");
assert.match(narrowNavigationRule, /position:\s*static/, "Compact navigation must remain in normal document flow.");
assert.match(narrowNavigationRule, /max-block-size:\s*none/, "Compact navigation must not inherit the bounded desktop height.");
assert.doesNotMatch(narrowNavigationRule, /display:\s*none/, "Constrained width must not hide the shared navigation owner.");
assert.match(
	css,
	/@container shipit-seo-admin \(max-width: 760px\)[\s\S]*?\.shipit-seo-workspace-nav__compact\s*\{[^}]*display:\s*block/,
	"The shared navigation's flat page chooser must be visible in constrained areas.",
);
assert.doesNotMatch(css, /\.shipit-seo-mobile-nav\b/, "The obsolete separate mobile destination selector must not return.");
const navigationCss = css.slice(css.indexOf(".shipit-seo-workspace-shell {"), css.indexOf(".shipit-seo-header h1,"));
assert.doesNotMatch(navigationCss, /position:\s*(?:sticky|fixed)|overflow(?:-[xy])?:\s*(?:auto|scroll)|max-(?:height|block-size):/,
	"The rail stays in document flow without an inner scrollbar or height cap.");
assert.doesNotMatch(shellSource, /shipit-seo-workspace-nav__primary/,
	"Permanent stacked primary/contextual tab bars must not return.");
assert.match(navigationCss, /\.shipit-seo-workspace-nav__label\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere/,
	"Long translated destination labels must wrap inside the bounded rail.");
assert.doesNotMatch(shellSource, /openGroup/, "Workspace destinations use a flat rail without accordion sections.");
assert.doesNotMatch(shellSource, /aria-expanded=/, "The rail has no disclosure; Indexing is one row.");
assert.match(css, /@container shipit-seo-admin \(max-width: 760px\)[\s\S]*?\.shipit-seo-workspace-shell\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
	"At 390px and other narrow admin widths the rail becomes one bounded column.");
assert.match(css, /@container shipit-seo-admin \(max-width: 760px\)[\s\S]*?\.shipit-seo-workspace-nav__desktop\s*\{[^}]*display:\s*none/,
	"The compact flat picker replaces the desktop destination list.");
const indexingToolsRules = Array.from(css.matchAll(/([^{}]*\.shipit-seo-indexing-nav\b[^{}]*)\{([^{}]*)\}/g));
const indexingToolsRule = indexingToolsRules.find(([, selectors]) => selectors.trim().endsWith(".shipit-seo-indexing-nav"))?.[2];
assert.ok(indexingToolsRule, "The Indexing tools list has one base rule.");
assert.match(indexingToolsRule, /display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*min-width:\s*0;[^}]*max-width:\s*100%/,
	"The Indexing tools wrap onto further rows inside the content width.");
for (const [, selectors, declarations] of indexingToolsRules) {
	assert.doesNotMatch(declarations, /display:\s*(?:none|grid)|overflow(?:-[xy])?:|white-space:\s*nowrap/,
		`The Indexing tools show at every width without sideways scrolling: ${selectors.trim()}`);
}
assert.match(css, /\.shipit-seo-indexing-nav button\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*overflow-wrap:\s*anywhere/,
	"A long translated tool label wraps inside its button.");
assert.match(css, /\.shipit-seo-indexing-nav button\[aria-current="page"\]\s*\{[^}]*font-weight:\s*600/,
	"The open tool is marked by text weight as well as colour.");
assert.match(css, /\.shipit-seo-indexing-nav button:focus-visible\s*\{[^}]*outline:\s*2px solid/, "Indexing tools keep a visible focus ring.");
assert.match(navigationCss, /\.shipit-seo-workspace-nav__search input\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%/,
	"The local search field cannot force rail or mobile overflow.");

assert.match(
	css,
	/@container shipit-seo-workspace \(max-width: 840px\)[\s\S]*?\.shipit-seo-summary,[\s\S]*?\.shipit-seo-template-workspace\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
	"Overview and template layouts must stack against the usable workspace width.",
);
assert.match(
	css,
	/@container shipit-seo-workspace \(max-width: 840px\)[\s\S]*?\.shipit-seo-stats\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
	"Summary tiles must use two readable tracks in a constrained workspace.",
);
assert.match(shellSource, /aria-label=\{t\("nav\.workspace"\)\}/, "Workspace navigation needs a translated accessible name.");
assert.match(shellSource, /aria-current=\{current \?\? undefined\}/, "The selected page or its parent row needs programmatic state.");
assert.match(css, /\.shipit-seo-action-bar\s*\{[^}]*flex-wrap:\s*wrap;[^}]*min-width:\s*0;/, "The shared action bar wraps instead of overflowing.");
assert.match(css, /\.shipit-seo-action-bar__commit\s*\{[^}]*flex-wrap:\s*wrap;[^}]*min-width:\s*0;[^}]*margin-inline-start:\s*auto;/,
	"Status, Discard and Save stay at the right even without a restore action.");
assert.match(css, /\.shipit-seo-template-types > button\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere;/, "Long content type names wrap in the vertical list.");
assert.match(css, /@container shipit-seo-template-form \(min-width: 600px\)\s*\{[\s\S]*?\.shipit-seo-template-body--list\s*\{[^}]*grid-template-columns:\s*minmax\(130px,\s*180px\) minmax\(0,\s*1fr\)/,
	"The type list sits beside the fields only in a wide template form.");
assert.match(css, /\.shipit-seo-template-types\s*\{\s*display:\s*none;/, "Narrow template forms use the Select instead of the list.");
assert.doesNotMatch(css.slice(css.indexOf("/* Workspace navigation, shared action bar")), /overflow(?:-[xy])?:\s*(?:auto|scroll)|max-(?:height|block-size):|white-space:\s*nowrap/,
	"The new navigation, action bar and template rules add no inner scrollbar or unbreakable line.");
assert.match(css, /\.shipit-seo-local-navigation\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%/,
	"The shared Local SEO tab row stays inside the usable workspace width.");
assert.match(css, /\.shipit-seo-local-navigation\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*gap:\s*4px/,
	"Local SEO destinations wrap at their natural label widths without expanded columns.");
assert.doesNotMatch(css, /\.shipit-seo-local-navigation(?:\[.*?\])?\s*\{[^}]*grid-template-columns/,
	"Local navigation does not spread destinations across equal-width tracks.");
assert.match(css, /\.shipit-seo-local-navigation > button\s*\{[^}]*min-height:\s*38px;[^}]*max-width:\s*100%/);
assert.match(css, /\.shipit-seo-local-navigation > button\s*\{[^}]*font-family:\s*inherit;[^}]*white-space:\s*normal/);
assert.match(css, /\.shipit-seo-local-navigation > button:focus-visible\s*\{[^}]*outline:\s*2px solid/);
assert.doesNotMatch(css, /\.shipit-seo-local-navigation(?: > \*)?\s*\{[^}]*overflow(?:-x)?:\s*(?:auto|scroll|hidden)/,
	"Local SEO labels neither clip nor require horizontal scrolling.");
assert.doesNotMatch(css, /\.shipit-seo-identity-form\s*>\s*:first-child/,
	"Suppressing the form tab row must not clip or scroll its first field section.");
const navigableViews = new Set(SEO_WORKSPACE_NAV_GROUPS.flatMap((group) => [...group.views]));
for (const view of SEO_ADMIN_VIEWS) {
	assert.ok(
		navigableViews.has(view),
		`Workspace navigation must expose the ${view} destination.`,
	);
}

const queueSelectRule = css.match(
	/\.shipit-seo-queue-filters\s+\[data-kumo-component="Select"\]\[data-kumo-part="trigger"\]\s*\{([\s\S]*?)\}/,
)?.[1];

assert.ok(queueSelectRule, "Work queue Select containment rule must exist.");
assert.match(queueSelectRule, /width:\s*100%/, "Work queue Selects must fill their tracks.");
assert.match(queueSelectRule, /min-width:\s*0/, "Work queue Selects must be shrinkable.");
assert.match(queueSelectRule, /max-width:\s*100%/, "Work queue Selects must stay inside their panel.");
assert.match(
	css,
	/\.shipit-seo-queue-filters\s*\{[\s\S]*?grid-template-columns:\s*minmax\(220px,\s*1\.5fr\) repeat\(3,\s*minmax\(150px,\s*0\.75fr\)\)/,
	"The image scope must fit in a bounded four-track work queue filter grid.",
);
assert.match(
	css,
	/@media \(max-width: 680px\)[\s\S]*?\.shipit-seo-queue-filters\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
	"Work queue filters must collapse to one track on mobile.",
);
assert.match(
	css,
	/@media \(max-width: 680px\)[\s\S]*?\.shipit-seo-queue-item\s*\{[\s\S]*?grid-template-columns:\s*30px minmax\(0,\s*1fr\) 28px/,
	"Work queue rows must keep a bounded mobile grid.",
);

assert.match(
	css,
	/@container \(max-width: 900px\)[\s\S]*?\.shipit-seo-trend-summary\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
	"Trend summaries must collapse to two tracks in constrained admin panels.",
);
assert.match(
	css,
	/@container \(max-width: 900px\)[\s\S]*?\.shipit-seo-trend-columns\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
	"Trend issue and change sections must stack before their content becomes cramped.",
);
assert.match(
	css,
	/@container \(max-width: 560px\)[\s\S]*?\.shipit-seo-trend-filters\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
	"Trend filters must use one shrinkable track in narrow editor panels.",
);
assert.match(
	css,
	/@container \(max-width: 560px\)[\s\S]*?\.shipit-seo-trend-change\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) auto 30px/,
	"Trend change rows must retain a bounded mobile action column.",
);

assert.match(
	css,
	/\.shipit-seo-not-found-summary\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
	"404 summaries must use four balanced tracks when space allows.",
);
assert.match(
	css,
	/@container \(max-width: 800px\)[\s\S]*?\.shipit-seo-not-found-summary\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
	"404 summaries must collapse to two tracks in constrained admin panels.",
);
assert.match(
	css,
	/@container \(max-width: 520px\)[\s\S]*?\.shipit-seo-not-found-summary\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
	"404 summaries must use one shrinkable track in narrow editor panels.",
);
assert.match(
	css,
	/\.shipit-seo-crawl-summary\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
	"Crawl summaries must use four balanced tracks when space allows.",
);
assert.match(
	css,
	/@container \(max-width: 760px\)[\s\S]*?\.shipit-seo-crawl-summary\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
	"Crawl summaries must collapse to two tracks in constrained admin panels.",
);
assert.match(
	css,
	/@container \(max-width: 460px\)[\s\S]*?\.shipit-seo-crawl-summary\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/,
	"Crawl summaries must use one shrinkable track in narrow editor panels.",
);
assert.match(
	css,
	/\.shipit-seo-rendered-finding\s*\{[\s\S]*?grid-template-columns:\s*72px minmax\(0,\s*1fr\) auto/,
	"Rendered crawl findings must reserve a stable status and action column.",
);
assert.match(
	css,
	/@container \(max-width: 460px\)[\s\S]*?\.shipit-seo-rendered-finding\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) auto/,
	"Rendered crawl findings must collapse to a bounded mobile row.",
);
// --- Focus keyword chips (live layer) ---------------------------------------
// The pre-chip keyword layer (keyword-list/-save/-head/-add/-actions) must
// stay deleted — a resurrected block would compete with the chip editor.
assert.doesNotMatch(css, /__keyword-list/, "The dead keyword-list layer must not return.");
assert.doesNotMatch(css, /__keyword-save/, "The dead keyword-save layer must not return.");
assert.doesNotMatch(css, /__keyword-head[^i]/, "The dead keyword-head layer must not return.");
assert.match(
	css,
	/\.shipit-seo-native-panel__keyword-field\s*\{[\s\S]*?flex-wrap:\s*wrap/,
	"Keyword chips must wrap inside the field at narrow sidebar widths.",
);
assert.match(
	css,
	/\.shipit-seo-native-panel__keyword-field input\s*\{[\s\S]*?flex:\s*1[\s\S]*?min-width:\s*110px/,
	"The chip input must flex without forcing horizontal overflow.",
);
assert.match(
	css,
	/\.shipit-seo-native-panel__keyword-status\s*\{[\s\S]*?flex-wrap:\s*wrap/,
	"The save status line (message + Retry) must wrap before it can overflow.",
);
assert.match(
	css,
	/\.shipit-seo-native-panel__summary\s*\{[\s\S]*?minmax\(0,\s*1fr\)/,
	"The score summary must keep a shrinkable copy track at 280px sidebars.",
);

const previewWrapperRule = css.match(/\.shipit-seo-native-preview-model\s*\{([\s\S]*?)\}/)?.[1];
assert.ok(previewWrapperRule, "Native model previews must establish a bounded wrapper.");
assert.match(previewWrapperRule, /min-width:\s*0/);
assert.match(previewWrapperRule, /max-width:\s*100%/);
assert.match(previewWrapperRule, /--shipit-seo-preview-background:\s*var\(--color-kumo-base/);
assert.match(css, /\.shipit-seo-native-preview-model \[data-preview-frame\]\s*\{[^}]*overflow-x:\s*auto/,
	"Fixed model widths must scroll inside narrow native panels.");
assert.match(css, /\.shipit-seo-native-preview-model \[data-preview-frame\]:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--border-color-kumo-focus/,
	"The keyboard scroll region must show a host-colored focus ring.");
assert.match(css, /\.shipit-seo-native-preview-model \[data-preview-sources\] bdi\s*\{[^}]*overflow-wrap:\s*anywhere/,
	"Long provenance text must wrap separately from fitted preview lines.");
assert.match(css, /:is\(\.dark, \[data-theme="dark"\], \[data-mode="dark"\]\) \.shipit-seo-native-preview-model\s*\{[^}]*--shipit-seo-preview-background:\s*var\(--color-kumo-base/,
	"Native preview colors must follow the existing dark-theme entry points.");
const previewRules = Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
	.filter(([, selectors]) => selectors.includes(".shipit-seo-native-preview-model"));
assert.ok(previewRules.length >= 8);
for (const [, selectors, declarations] of previewRules) {
	assert.ok(selectors.replace(/:is\([^)]*\)/g, ":is-theme").split(",")
		.every((selector) => selector.includes(".shipit-seo-native-preview-model")),
		"Preview rules must remain scoped to the native model wrapper.");
	assert.doesNotMatch(declarations, /(?:font-family|white-space|word-break|letter-spacing):/,
		"Native wrapper styles must preserve model font metrics and fitted line boundaries.");
}

assert.doesNotMatch(editorCss,
	/\.shipit-seo-native-panel__strip\s+button svg\s*\{[^}]*display:\s*none/,
	"Narrow editor sections retain their semantic icons with the labels.");
assert.match(editorCss, /\.shipit-seo-native-panel--sidebar \.shipit-seo-native-panel__strip \{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
	"The two section tabs share the strip at every sidebar width.");
assert.doesNotMatch(editorCss, /__strip[^{]*\{[^}]*repeat\(4/, "No four-entry strip layout remains.");
assert.match(editorCss, /\.shipit-seo-native-panel__openers \{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
	"Social and Schema openers share one row that can shrink.");
assert.match(editorCss, /\.shipit-seo-native-panel__opener > span \{[^}]*min-width:\s*0;[^}]*text-overflow:\s*ellipsis/,
	"Opener labels truncate instead of widening the sidebar.");
assert.match(editorCss, /\.shipit-seo-native-panel__check-detail \{[^}]*-webkit-line-clamp:\s*3;[^}]*line-clamp:\s*3/,
	"Closed rows clamp the finding to three lines.");
assert.match(editorCss, /__check-details\[open\]\s*\.shipit-seo-native-panel__check-detail \{[^}]*-webkit-line-clamp:\s*unset/,
	"An open row shows the whole finding.");
assert.match(css, /\.shipit-seo-snippet-dialog__footer-primary \{[^}]*margin-left:\s*auto/,
	"Close and the saves stay together at the footer end.");

console.log("SEO admin responsive CSS self-check passed.");
