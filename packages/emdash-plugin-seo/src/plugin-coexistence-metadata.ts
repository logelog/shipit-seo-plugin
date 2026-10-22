import { validateCustomVerificationTags } from "./custom-verification-tags.ts";
import { COEXISTENCE_ROBOTS_KEY, projectCoexistenceRobots } from "./plugin-coexistence.ts";

export const COEXISTENCE_METADATA_INSPECTION_LIMIT = 1024;

const owned = new WeakSet<object>();
const SEO_META_NAMES = new Set(["title", "description", "keywords"]);
const SEO_PREFIXES = ["og:", "twitter:", "article:", "profile:", "book:", "music:", "video:"];

function object(value: unknown): value is object {
	return value !== null && typeof value === "object";
}

export function markOwnMetadataContributions(value: unknown): void {
	if (Array.isArray(value)) {
		for (const contribution of value) if (object(contribution)) owned.add(contribution);
	} else if (object(value)) {
		owned.add(value);
	}
}

function ownField(value: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function token(value: unknown, maximum = 128): string | null {
	return typeof value === "string" && value.length > 0 && value.length <= maximum &&
		/^[A-Za-z][A-Za-z0-9:._-]*$/.test(value) ? value.toLowerCase() : null;
}

type Description = {
	kind: "robots";
	content: unknown;
	valid: boolean;
} | { kind: "ordinary" | "jsonld" | "other" | "unclassifiable" } | {
	kind: "other-meta";
	name: string;
	content: string;
};

function describe(value: unknown): Description {
	if (!object(value) || Array.isArray(value)) return { kind: "unclassifiable" };
	try {
		const kind = ownField(value, "kind");
		const key = Object.getOwnPropertyDescriptor(value, "key");
		if (key && (!Object.hasOwn(key, "value") || (key.value !== undefined && (typeof key.value !== "string" || key.value.length > 512))))
			return { kind: "unclassifiable" };
		if (kind === "jsonld") {
			const graph = ownField(value, "graph");
			return object(graph) ? { kind: "jsonld" } : { kind: "unclassifiable" };
		}
		if (kind === "meta" || kind === "property") {
			const name = token(ownField(value, kind === "meta" ? "name" : "property"));
			const content = ownField(value, "content");
			if (!name) return { kind: "unclassifiable" };
			if (kind === "meta" && name === "robots") return { kind: "robots", content, valid: typeof content === "string" };
			if (typeof content !== "string") return { kind: "unclassifiable" };
			if (SEO_META_NAMES.has(name) || SEO_PREFIXES.some((prefix) => name.startsWith(prefix))) return { kind: "ordinary" };
			return kind === "meta" ? { kind: "other-meta", name, content } : { kind: "other" };
		}
		if (kind === "link") {
			const rel = token(ownField(value, "rel"));
			const href = ownField(value, "href");
			if (!rel || typeof href !== "string") return { kind: "unclassifiable" };
			return rel === "canonical" || rel === "alternate" ? { kind: "ordinary" } : { kind: "other" };
		}
	} catch {
		return { kind: "unclassifiable" };
	}
	return { kind: "unclassifiable" };
}

function metadataKey(value: unknown): string | null {
	if (!object(value)) return null;
	try {
		if (ownField(value, "kind") !== "meta") return null;
		const key = ownField(value, "key") ?? ownField(value, "name");
		return typeof key === "string" && key.length <= 512 ? key : null;
	} catch {
		return null;
	}
}

function customVerification(description: Description): description is Extract<Description, { kind: "other-meta" }> {
	return description.kind === "other-meta" && validateCustomVerificationTags([
		{ name: description.name, content: description.content },
	]).success;
}

/** Detailed overlap inspection is capped; filtering the host's collected array remains linear. */
export function finalizeOwnMetadataContributions(value: readonly unknown[], pageRobots: unknown): unknown[] {
	if (!value.some((entry) => object(entry) && owned.has(entry))) return [...value];
	let fallback = value.length > COEXISTENCE_METADATA_INSPECTION_LIMIT;
	let pauseMetadata = false;
	let pauseSchema = false;
	let pauseRobots = false;
	const foreignMetaNames = new Set<string>();
	const usedMetaKeys = new Set<string>();
	for (let index = 0; index < Math.min(value.length, COEXISTENCE_METADATA_INSPECTION_LIMIT); index += 1) {
		const contribution = value[index];
		const key = metadataKey(contribution);
		if (key !== null && !(object(contribution) && owned.has(contribution))) usedMetaKeys.add(key);
		const description = describe(contribution);
		if (description.kind === "unclassifiable" || (description.kind === "robots" && !description.valid)) fallback = true;
		if (object(contribution) && owned.has(contribution)) continue;
		if (description.kind === "ordinary") pauseMetadata = true;
		if (description.kind === "jsonld") pauseSchema = true;
		if (description.kind === "robots") pauseRobots = true;
		if (description.kind === "other-meta") foreignMetaNames.add(description.name);
	}
	// Past the classification limit, only data descriptors needed for the host meta key are read.
	for (let index = COEXISTENCE_METADATA_INSPECTION_LIMIT; index < value.length; index += 1) {
		const contribution = value[index];
		if (!object(contribution) || owned.has(contribution)) continue;
		try {
			const descriptor = Object.getOwnPropertyDescriptor(contribution, "key");
			if (descriptor && !Object.hasOwn(descriptor, "value")) continue;
			if (descriptor?.value !== null && descriptor?.value !== undefined) {
				if (typeof descriptor.value === "string" && descriptor.value.length <= 512) usedMetaKeys.add(descriptor.value);
				continue;
			}
			const kind = Object.getOwnPropertyDescriptor(contribution, "kind");
			if (!kind || !Object.hasOwn(kind, "value") || kind.value !== "meta") continue;
			const name = Object.getOwnPropertyDescriptor(contribution, "name");
			if (name && Object.hasOwn(name, "value") && typeof name.value === "string" && name.value.length <= 512)
				usedMetaKeys.add(name.value);
		} catch {
			// An unreadable peer key remains opaque, like the rest of its contribution.
		}
	}
	const projectRobots = fallback || pauseMetadata || pauseRobots;
	const result: unknown[] = [];
	let nextRobotKey = 0;
	const projectedContents = new Set<string>();
	const appendRestrictions = (source: unknown) => {
		const projection = projectCoexistenceRobots({ sources: [source] });
		if (!projection.contribution) return;
		const contentKey = projection.contribution.content.toLowerCase();
		if (projectedContents.has(contentKey)) return;
		projectedContents.add(contentKey);
		let key = COEXISTENCE_ROBOTS_KEY;
		while (usedMetaKeys.has(key)) key = COEXISTENCE_ROBOTS_KEY + ":" + ++nextRobotKey;
		usedMetaKeys.add(key);
		const contribution = { ...projection.contribution, key };
		owned.add(contribution);
		result.push(contribution);
	};
	let pageRestrictionsAdded = false;
	for (const contribution of value) {
		if (!object(contribution) || !owned.has(contribution)) {
			result.push(contribution);
			continue;
		}
		const description = describe(contribution);
		if (projectRobots && !pageRestrictionsAdded) {
			appendRestrictions(pageRobots);
			pageRestrictionsAdded = true;
		}
		if (description.kind === "robots") {
			if (projectRobots) appendRestrictions(description.content);
			else result.push(contribution);
			continue;
		}
		if (fallback || description.kind === "unclassifiable") continue;
		if (description.kind === "jsonld" && pauseSchema) continue;
		if (description.kind === "ordinary" && pauseMetadata) continue;
		if (customVerification(description) && foreignMetaNames.has(description.name)) continue;
		result.push(contribution);
	}
	return result;
}
