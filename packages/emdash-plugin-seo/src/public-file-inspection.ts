// Build-time ownership facts only. A failed inspection never proves an address free.
import { lstatSync, readdirSync, statSync, type Dirent } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface PageEntry {
	name: string;
	directory: boolean;
	children?: readonly string[];
}

interface RootFilePolicy {
	address: (name: string) => boolean;
	page: (entry: PageEntry) => boolean;
}

type DirectoryListing =
	| { state: "listed"; entries: Dirent[] }
	| { state: "absent" }
	| { state: "unreadable"; reason: string };

export interface PublicFileInspection {
	publicFiles: string[];
	pageEntries: PageEntry[];
	inspectionError: string | null;
}

function errorCode(error: unknown): string {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" && code ? code : "read error";
}

// ENOENT can also mean a dangling directory link, including one in an ancestor.
function missingDirectoryLink(directory: URL): string | null {
	let path = resolve(fileURLToPath(directory));
	while (true) {
		try {
			if (lstatSync(path).isSymbolicLink()) {
				try { statSync(path); } catch (error) { return `symbolic link could not be resolved (${errorCode(error)})`; }
			}
			return null;
		} catch (error) {
			if (errorCode(error) !== "ENOENT") return `could not be read (${errorCode(error)})`;
			const parent = dirname(path);
			if (parent === path) return null;
			path = parent;
		}
	}
}

function directoryEntries(directory: URL): DirectoryListing {
	try {
		return { state: "listed", entries: readdirSync(directory, { withFileTypes: true }) };
	} catch (error) {
		if (errorCode(error) === "ENOENT") {
			const link = missingDirectoryLink(directory);
			return link ? { state: "unreadable", reason: link } : { state: "absent" };
		}
		return { state: "unreadable", reason: `could not be read (${errorCode(error)})` };
	}
}

function entryDirectory(directory: URL, entry: Dirent): boolean | string {
	if (!entry.isSymbolicLink()) return entry.isDirectory();
	try {
		return statSync(new URL(encodeURIComponent(entry.name), directory)).isDirectory();
	} catch (error) {
		return `symbolic link could not be resolved (${errorCode(error)})`;
	}
}

/** Inspects only root addresses and their conventional index routes, never unrelated children. */
export function inspectPublicFiles(publicDirectory: URL, pagesDirectory: URL, policy: RootFilePolicy): PublicFileInspection {
	const result: PublicFileInspection = { publicFiles: [], pageEntries: [], inspectionError: null };
	const failed = (path: string, reason: string) => {
		result.inspectionError ??= `${path} ${reason}`.slice(0, 300);
	};
	const publicFiles = directoryEntries(publicDirectory);
	if (publicFiles.state === "unreadable") failed("public", publicFiles.reason);
	if (publicFiles.state === "listed") for (const entry of publicFiles.entries) {
		if (!policy.address(entry.name)) continue;
		const kind = entryDirectory(publicDirectory, entry);
		if (typeof kind === "string") failed(`public/${entry.name}`, kind);
		else if (!kind) result.publicFiles.push(entry.name);
	}
	// A public file answers before every page route, so no page read can change that owner.
	if (result.publicFiles.length > 0) return result;
	const pages = directoryEntries(pagesDirectory);
	if (pages.state === "unreadable") failed("src/pages", pages.reason);
	if (pages.state === "listed") for (const entry of pages.entries) {
		if (!policy.address(entry.name) && !policy.page({ name: entry.name, directory: false })) continue;
		const kind = entryDirectory(pagesDirectory, entry);
		if (typeof kind === "string") {
			failed(`src/pages/${entry.name}`, kind);
			continue;
		}
		const page: PageEntry = { name: entry.name, directory: kind };
		if (kind && policy.address(entry.name)) {
			const directory = new URL(`${encodeURIComponent(entry.name)}/`, pagesDirectory);
			const children = directoryEntries(directory);
			if (children.state !== "listed") {
				failed(`src/pages/${entry.name}`, children.state === "unreadable" ? children.reason : "could not be read (ENOENT)");
				continue;
			}
			page.children = children.entries.filter((child) => {
				if (!policy.page({ ...page, children: [child.name] })) return false;
				const childKind = entryDirectory(directory, child);
				if (typeof childKind === "string") failed(`src/pages/${entry.name}/${child.name}`, childKind);
				return childKind === false;
			}).map((child) => child.name);
		}
		if (policy.page(page)) result.pageEntries.push(page);
	}
	return result;
}
