import assert from "node:assert/strict";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const customerFiles = new Set([
  "package.json", "README.md", "CHANGELOG.md", "INSTALL-PROMPT.md", "UPGRADE.md", "UNINSTALL-PROMPT.md",
  "THIRD-PARTY-NOTICES.md", "LICENSE",
]);
const requiredFiles = [...customerFiles].filter((name) => !["LICENSE", "UPGRADE.md", "UNINSTALL-PROMPT.md"].includes(name));
const versionsWithoutRemovalGuide = new Set([
  "0.4.0-beta.1", "0.4.0-beta.2", "0.4.0-beta.3", "0.4.0-beta.4",
  "0.4.0-beta.5", "0.4.0-beta.6", "0.4.0-beta.7", "0.4.0-beta.8",
  "0.4.0-beta.9", "0.4.0-beta.10", "0.4.0-beta.11", "0.4.0-beta.12",
  "0.4.0-beta.13", "0.4.0-beta.14",
]);
const developmentName = /(?:^|[./_-])(?:selfchecks?|fixtures?|debug|mocks?|tests?)(?:[./_-]|$)/i;
const privateReference = /(?:https?:\/\/(?:github\.com|raw\.githubusercontent\.com)\/[^/\s]+\/(?:private|internal)[-_][^/\s]+(?:[/?#]|\b)|file:\/\/|(?:\/\/|\\\\)wsl\.localhost|\/(?:home|Users)\/[^/\s"'<>]+\/|[a-z]:[\\/](?:Users|home)[\\/])/i;

function markdownLinks(text) {
  const links = [];
  for (const pattern of [
    /!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g,
    /^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm,
    /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi,
  ]) {
    for (const match of text.matchAll(pattern)) links.push(match[1] ?? match[2]);
  }
  return links;
}

function insideRoot(root, target) {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path);
}

export function assertPackedArtifact(packageDirectory) {
  const root = resolve(packageDirectory);
  assert.equal(lstatSync(root).isDirectory(), true, "Packed package must be a real directory");
  const files = new Set();

  function inspect(directory, prefix = "") {
    for (const entry of readdirSync(directory)) {
      const path = prefix ? prefix + "/" + entry : entry;
      const absolute = resolve(directory, entry);
      const stat = lstatSync(absolute);
      assert.equal(stat.isSymbolicLink(), false, "Packed artifact contains a symlink: " + path);
      assert.ok(stat.isFile() || stat.isDirectory(), "Packed artifact contains a nonregular entry: " + path);
      if (!prefix && path !== "dist") {
        assert.ok(customerFiles.has(path) && stat.isFile(), "Unexpected packed path: " + path);
      } else {
        assert.ok(path === "dist" || path.startsWith("dist/"), "Unexpected packed path: " + path);
        assert.equal(developmentName.test(path), false, "Development file in packed artifact: " + path);
        if (stat.isFile()) {
          assert.match(path, /\.(?:js|d\.ts|css)$/, "Unexpected compiled file: " + path);
          const text = readFileSync(absolute, "utf8");
          assert.equal(privateReference.test(text), false, "Private reference in compiled file: " + path);
          assert.equal(text.includes("sourceMappingURL="), false, "Source map in compiled file: " + path);
        }
      }
      if (stat.isDirectory()) inspect(absolute, path);
      else files.add(path);
    }
  }

  inspect(root);
  for (const path of requiredFiles) assert.ok(files.has(path), "Missing customer file: " + path);
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.match(manifest.name ?? "", /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/, "Invalid package name");
  if (!versionsWithoutRemovalGuide.has(manifest.version)) {
    assert.ok(files.has("UNINSTALL-PROMPT.md"), "Missing customer file: UNINSTALL-PROMPT.md");
  }

  function exportedFile(path, label) {
    assert.equal(typeof path, "string", label + " must name a compiled file");
    assert.match(path, /^\.\/dist\//, label + " must point into dist");
    assert.equal(path.includes("\\"), false, label + " must use a package-relative path");
    const absolute = resolve(root, path);
    assert.ok(insideRoot(resolve(root, "dist"), absolute), label + " escapes dist");
    assert.ok(files.has(relative(root, absolute).split(sep).join("/")), label + " is missing: " + path);
  }

  exportedFile(manifest.main, "main");
  assert.ok(manifest.exports && typeof manifest.exports === "object" && !Array.isArray(manifest.exports), "Package exports must be explicit");
  assert.ok(manifest.exports["."], "Package root export is missing");
  for (const [subpath, entry] of Object.entries(manifest.exports)) {
    assert.ok(subpath === "." || /^\.\/[a-z0-9-]+$/.test(subpath), "Unexpected export: " + subpath);
    assert.ok(entry && typeof entry === "object" && !Array.isArray(entry), "Export conditions missing: " + subpath);
    for (const condition of ["types", "default"]) {
      exportedFile(entry[condition], subpath + " " + condition);
      assert.match(entry[condition], condition === "types" ? /\.d\.ts$/ : /\.js$/, "Unexpected export file type: " + subpath + " " + condition);
    }
  }

  for (const lifecycle of ["preinstall", "install", "postinstall", "prepare"]) {
    assert.equal(manifest.scripts?.[lifecycle], undefined, "Packed package must not run " + lifecycle);
  }
  assert.equal(manifest.bin, undefined, "Packed package must not install executables");
  if (manifest.private !== true) {
    assert.ok(typeof manifest.license === "string" && manifest.license.trim(), "Public package needs a license");
    assert.ok(files.has("LICENSE"), "Public package needs LICENSE");
    assert.equal(manifest.publishConfig?.access, "public", "Public beta needs explicit public access");
    assert.equal(manifest.publishConfig?.tag, "beta", "Public beta must use the beta tag");
    assert.ok(files.has("UPGRADE.md"), "Missing customer file: UPGRADE.md");
  }

  for (const name of customerFiles) {
    if (name === "package.json" || !files.has(name)) continue;
    const readme = readFileSync(resolve(root, name), "utf8");
    assert.equal(privateReference.test(readme), false, name + " contains a private reference");
    for (const link of markdownLinks(readme)) {
      if (link.startsWith("#") || /^(?:https?:|mailto:|\/\/)/i.test(link)) continue;
      assert.equal(/^[a-z][a-z0-9+.-]*:/i.test(link), false, "Unsupported customer link in " + name + ": " + link);
      const path = decodeURIComponent(link.split(/[?#]/, 1)[0]);
      if (!path) continue;
      const target = resolve(root, path);
      assert.ok(insideRoot(root, target), "Customer link escapes package: " + link);
      assert.ok(files.has(relative(root, target).split(sep).join("/")), "Customer link is missing from package: " + link);
    }
  }
  const notice = readFileSync(resolve(root, "THIRD-PARTY-NOTICES.md"), "utf8");
  assert.match(notice, /Schema\.org/i, "Schema.org attribution is missing");
  assert.match(notice, /CC BY-SA 3\.0/i, "Schema.org license attribution is missing");
  assert.match(notice, /https:\/\/creativecommons\.org\/licenses\/by-sa\/3\.0\/?/, "Schema.org license URL is missing");

  return manifest;
}

// Shipped text may name the product only in its default name and in the
// earlier wording that the admin cleans from stored analysis rows. Bundled
// files mark each source module with `//#region <path>` comments.
const BRAND_TEXT = /Shipit|SHIPIT/g;
const BRAND_LITERALS = new Map([
  ["src/branding.ts", new Set(["SHIPIT SEO"])],
  ["src/legacy-brand-text.ts", null],
]);
const REGEX_AFTER_WORDS = new Set([
  "return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await",
]);
const IDENTIFIER = /[A-Za-z0-9_$\u0080-\uffff]/;

/** Comment and literal spans of one compiled file, each literal with its source module; code is everything else. */
function scanModule(text) {
  const comments = [];
  const literals = [];
  const stack = [];
  const templates = [];
  let last = null;
  let index = 0;
  const region = () => stack.at(-1) ?? null;
  const readQuoted = (quote) => {
    const start = index;
    index += 1;
    while (index < text.length && text[index] !== quote) {
      if (text[index] === "\\") index += 1;
      else if (text[index] === "\n") throw new Error("Unterminated string literal at offset " + start);
      index += 1;
    }
    if (index >= text.length) throw new Error("Unterminated string literal at offset " + start);
    index += 1;
    literals.push({ start, end: index, value: text.slice(start + 1, index - 1), region: region() });
  };
  const readTemplate = () => {
    const start = index;
    while (index < text.length) {
      const char = text[index];
      if (char === "\\") { index += 2; continue; }
      if (char === "`") { index += 1; literals.push({ start, end: index, value: text.slice(start, index), region: region() }); return; }
      if (char === "$" && text[index + 1] === "{") {
        literals.push({ start, end: index, value: text.slice(start, index), region: region() });
        index += 2;
        templates.push(0);
        return;
      }
      index += 1;
    }
    throw new Error("Unterminated template literal at offset " + start);
  };
  const readRegex = () => {
    const start = index;
    let inClass = false;
    index += 1;
    while (index < text.length) {
      const char = text[index];
      if (char === "\n") throw new Error("Unterminated regular expression at offset " + start);
      if (char === "\\") { index += 2; continue; }
      if (char === "[") inClass = true;
      else if (char === "]") inClass = false;
      else if (char === "/" && !inClass) break;
      index += 1;
    }
    index += 1;
    while (index < text.length && /[a-z]/i.test(text[index])) index += 1;
    literals.push({ start, end: index, value: text.slice(start, index), region: region() });
  };
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "/" && next === "/") {
      const start = index;
      const end = text.indexOf("\n", index);
      index = end < 0 ? text.length : end;
      const comment = text.slice(start, index);
      const marker = /^\/\/#(region|endregion)\b ?(.*)$/.exec(comment);
      if (marker?.[1] === "region") stack.push(marker[2].trim());
      else if (marker?.[1] === "endregion") stack.pop();
      comments.push({ start, end: index });
      continue;
    }
    if (char === "/" && next === "*") {
      const start = index;
      const end = text.indexOf("*/", index + 2);
      if (end < 0) throw new Error("Unterminated comment at offset " + start);
      index = end + 2;
      comments.push({ start, end: index });
      continue;
    }
    if (char === "'" || char === "\"") { readQuoted(char); last = { type: "literal" }; continue; }
    if (char === "`") { index += 1; readTemplate(); last = { type: "literal" }; continue; }
    if (char === "}" && templates.length && templates.at(-1) === 0) {
      templates.pop();
      index += 1;
      readTemplate();
      last = { type: "literal" };
      continue;
    }
    if (char === "/") {
      const regexAllowed = last === null || (last.type === "punctuator" && !")]}".includes(last.value)) ||
        (last.type === "word" && REGEX_AFTER_WORDS.has(last.value));
      if (regexAllowed) { readRegex(); last = { type: "literal" }; continue; }
    }
    if (IDENTIFIER.test(char)) {
      const start = index;
      while (index < text.length && IDENTIFIER.test(text[index])) index += 1;
      last = { type: "word", value: text.slice(start, index) };
      continue;
    }
    if (!/\s/.test(char)) {
      if (templates.length) {
        if (char === "{") templates[templates.length - 1] += 1;
        else if (char === "}") templates[templates.length - 1] -= 1;
      }
      last = { type: "punctuator", value: char };
    }
    index += 1;
  }
  return { comments, literals };
}

function within(spans, position) {
  return spans.find((span) => span.start <= position && position < span.end) ?? null;
}

/** Brand text in one compiled file that no allowed module accounts for. */
export function shippedBrandLeaks(text, path = "file") {
  const leaks = [];
  const lineOf = (position) => text.slice(0, position).split("\n").length;
  const describe = (position, region, reason) =>
    `${path}:${lineOf(position)}${region ? " (" + region + ")" : ""}: ${reason}: ${JSON.stringify(text.slice(Math.max(0, position - 40), position + 60))}`;
  if (path.endsWith(".css")) {
    const code = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => " ".repeat(comment.length));
    for (const match of code.matchAll(BRAND_TEXT)) leaks.push(describe(match.index, null, "style text"));
    return leaks;
  }
  const { comments, literals } = scanModule(text);
  for (const match of text.matchAll(BRAND_TEXT)) {
    const position = match.index;
    if (within(comments, position)) continue;
    const literal = within(literals, position);
    if (!literal) {
      const before = text[position - 1] ?? "";
      const after = text[position + match[0].length] ?? "";
      if (IDENTIFIER.test(before) || IDENTIFIER.test(after)) continue;
      leaks.push(describe(position, null, "unreadable code"));
      continue;
    }
    if (literal.region && BRAND_LITERALS.has(literal.region)) {
      const allowed = BRAND_LITERALS.get(literal.region);
      if (allowed === null || allowed.has(literal.value)) continue;
    }
    leaks.push(describe(position, literal.region, "product name in shipped text"));
  }
  return leaks;
}

/** Fails when compiled files name the product outside its default name and the stored-text cleaning table. */
export function assertBrandNeutralArtifact(packageDirectory) {
  const root = resolve(packageDirectory, "dist");
  const leaks = [];
  function inspect(directory, prefix) {
    for (const entry of readdirSync(directory)) {
      const path = prefix + "/" + entry;
      const absolute = resolve(directory, entry);
      if (lstatSync(absolute).isDirectory()) inspect(absolute, path);
      else if (/\.(?:js|css)$/.test(entry)) leaks.push(...shippedBrandLeaks(readFileSync(absolute, "utf8"), path));
    }
  }
  inspect(root, "dist");
  assert.deepEqual(leaks.slice(0, 20), [], "Product name in shipped text:\n" + leaks.slice(0, 20).join("\n"));
}
