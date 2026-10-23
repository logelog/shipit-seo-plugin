import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const privateDirectories = new Set([".dev", "artifacts", ".emdash", "handoffs", "upstream-drafts"]);
const binaryExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".otf", ".pdf"]);
const sensitiveText = [
  [/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,})\b/, "access token"],
  [/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/, "private key"],
  [/(?:\/home\/[^/\s]+\/|\/Users\/[^/\s]+\/|[A-Z]:[\\/]Users[\\/][^\\/\s]+[\\/]|wsl\.localhost)/i, "local user path"],
  [new RegExp("https?://(?:github\\.com|raw\\.githubusercontent\\.com)/logelog/" + "shipit-emdash-" + "seo(?:[/?#]|$)", "i"), "private workspace reference"],
];

function hasWorkstationAdminUrl(contents) {
  for (const match of contents.matchAll(/\bhttps?:\/\/[^\s<>"`]+/gi)) {
    let url;
    try { url = new URL(match[0]); } catch { continue; }
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    const local = host === "localhost" || host.endsWith(".localhost") ||
      /^127\./.test(host) || ["0.0.0.0", "[::1]", "[::]"].includes(host);
    if (local && /^\/_emdash(?:\/|$)/.test(url.pathname)) return true;
  }
  return false;
}

export function checkPublicFile(path, contents, symbolicLink = false) {
  const errors = [];
  const parts = path.split("/");
  const name = basename(path);
  if (symbolicLink) errors.push("symbolic link");
  if (parts.some((part) => privateDirectories.has(part))) errors.push("private development directory");
  if ((/^\.env(?:\.|$)/.test(name) && name !== ".env.example") || name === ".npmrc" || /^\.dev\.vars(?:\.|$)/.test(name) ||
      /\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$/.test(name) ||
      /\.(?:log|tgz|pem|key)$/.test(name)) errors.push("local or sensitive file");
  if (typeof contents === "string") {
    if (/\.mdx?$/i.test(path)) {
      if (hasWorkstationAdminUrl(contents)) errors.push("workstation admin URL in published prose");
      if (/(?:\b[a-z]:[\\/]|file:\/\/\/)/i.test(contents)) errors.push("absolute workstation path in published prose");
    }
    if (contents.includes("\0") && !binaryExtensions.has(extname(path).toLowerCase())) errors.push("NUL byte in text file");
    for (const [pattern, label] of sensitiveText) {
      if (pattern.test(contents)) errors.push(label);
    }
  }
  return errors.map((error) => path + ": " + error);
}

export function checkPublicFiles(directory = root) {
  const files = [...new Set(execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: directory, encoding: "utf8" }).split("\0").filter(Boolean))].sort();
  const errors = [];
  for (const file of files) {
    const absolute = resolve(directory, file);
    const stat = lstatSync(absolute);
    const text = stat.isFile() ? readFileSync(absolute) : undefined;
    errors.push(...checkPublicFile(file, text?.toString("utf8"), stat.isSymbolicLink()));
  }
  return { files: files.length, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = checkPublicFiles();
    if (result.errors.length) {
      console.error(result.errors.join("\n"));
      process.exitCode = 1;
    } else {
      console.log("Public repository checks passed for " + result.files + " files.");
    }
  } catch (error) {
    console.error("Could not check public repository files: " + error.message);
    process.exitCode = 1;
  }
}
