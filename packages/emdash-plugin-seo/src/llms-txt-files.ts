// Build-time directory reads for /llms.txt ownership. Runs in the site's Astro
// config process only. A missing directory is "absent"; any other failure is
// "unreadable" so it can never be mistaken for a site without its own file.
import { readdirSync, statSync, type Dirent } from "node:fs";

import { isLlmsTxtName, type LlmsTxtDirectoryEntry, type LlmsTxtDirectoryListing } from "./llms-txt-installation.ts";

function errorCode(error: unknown): string {
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" && code ? code : "read error";
}

function entryIsDirectory(directory: URL, entry: Dirent): boolean | "unreadable" {
	if (!entry.isSymbolicLink()) return entry.isDirectory();
	try {
		return statSync(new URL(entry.name, directory)).isDirectory();
	} catch {
		return "unreadable";
	}
}

/** Lists one directory; an entry named llms.txt that is a directory also gets its own listing. */
export function listLlmsTxtDirectory(directory: URL, nested = true): LlmsTxtDirectoryListing {
	let entries: Dirent[];
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch (error) {
		const code = errorCode(error);
		return code === "ENOENT" ? { state: "absent" } : { state: "unreadable", code };
	}
	return {
		state: "listed",
		entries: entries.map((entry): LlmsTxtDirectoryEntry => {
			const kind = entryIsDirectory(directory, entry);
			if (kind === "unreadable") return { name: entry.name, directory: false, unreadable: "unresolved symbolic link" };
			return kind && nested && isLlmsTxtName(entry.name)
				? { name: entry.name, directory: true, children: listLlmsTxtDirectory(new URL(`${entry.name}/`, directory), false) }
				: { name: entry.name, directory: kind };
		}),
	};
}
