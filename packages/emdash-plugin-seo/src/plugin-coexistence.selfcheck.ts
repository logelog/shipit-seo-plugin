import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
	COEXISTENCE_MAX_CONFIGURED,
	COEXISTENCE_MAX_IDS,
	COEXISTENCE_MAX_OBSERVATION_BYTES,
	COEXISTENCE_PROFILES,
	COEXISTENCE_ROBOTS_KEY,
	classifyNativePluginInventory,
	prepareCoexistenceInventory,
	projectCoexistenceRobots,
	unavailableCoexistenceInventory,
	type CoexistenceConfiguredPlugin,
	type CoexistenceStateRow,
} from "./plugin-coexistence.ts";

let groups = 0;
function check(name: string, run: () => void): void {
	run();
	groups += 1;
	console.log("PASS " + name);
}

function registryRow(index = 0, changes: Partial<CoexistenceStateRow> = {}): CoexistenceStateRow {
	const profile = COEXISTENCE_PROFILES[index]!;
	return {
		id: profile.runtimeId, source: "registry", version: profile.assessedVersion,
		status: "active", publisherDid: profile.publisherDid, slug: profile.slug, ...changes,
	};
}

function configRow(item: CoexistenceConfiguredPlugin, changes: Partial<CoexistenceStateRow> = {}): CoexistenceStateRow {
	return { id: item.id, source: "config", version: item.version, status: "active", publisherDid: null, slug: null, ...changes };
}

function unavailable(configured: unknown, rows: unknown): void {
	const result = classifyNativePluginInventory({ configured, rows });
	assert.equal(result.status, "unavailable");
	assert.deepEqual(result.paused, ["metadata", "robots", "schema", "indexnow"]);
	assert.deepEqual(result.peers, []);
}

check("catalog IDs bind the stable DID and slug, independently of names", () => {
	const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
	for (const profile of COEXISTENCE_PROFILES) {
		const digest = createHash("sha256").update(profile.publisherDid + "\n" + profile.slug).digest();
		let bits = "";
		for (const byte of digest) bits += byte.toString(2).padStart(8, "0");
		let suffix = "";
		for (let index = 0; index < 80; index += 5) suffix += alphabet[Number.parseInt(bits.slice(index, index + 5), 2)];
		assert.equal(profile.runtimeId, "r_" + suffix);
	}
	assert.equal(new Set(COEXISTENCE_PROFILES.map((profile) => profile.runtimeId)).size, 4);
	assert.equal(COEXISTENCE_MAX_IDS, 32);
	assert.equal(COEXISTENCE_MAX_CONFIGURED, 28);
	assert.equal(COEXISTENCE_MAX_OBSERVATION_BYTES, 24576);
});

check("authoritative absence and inactive observations resume only the checked catalog", () => {
	const absent = classifyNativePluginInventory({ configured: [], rows: [] });
	assert.equal(absent.status, "available");
	assert.equal(absent.scope, "checked-catalog");
	assert.deepEqual(absent.paused, []);
	assert.ok(absent.peers.every((peer) => peer.state === "absent" && peer.assessment === "none"));
	const inactive = classifyNativePluginInventory({ configured: [], rows: COEXISTENCE_PROFILES.map((_, index) => registryRow(index, { status: "inactive" })) });
	assert.equal(inactive.status, "available");
	assert.deepEqual(inactive.paused, []);
	assert.ok(inactive.peers.every((peer) => peer.state === "inactive" && peer.assessment === "none"));
});

check("surface pauses distinguish known releases, potential owners and inspection", () => {
	const expected = [["robots", "schema"], ["metadata", "robots", "schema"], ["indexnow"], []];
	for (let index = 0; index < COEXISTENCE_PROFILES.length; index += 1) {
		const result = classifyNativePluginInventory({ configured: [], rows: [registryRow(index)] });
		assert.equal(result.status, "available");
		assert.deepEqual(result.paused, expected[index]);
		assert.equal(result.peers[index]!.versionAssessment, "assessed");
		assert.equal(result.peers[index]!.assessment, COEXISTENCE_PROFILES[index]!.assessment);
	}
	const combined = classifyNativePluginInventory({ configured: [], rows: [registryRow(0), registryRow(2)] });
	assert.deepEqual(combined.paused, ["robots", "schema", "indexnow"]);
	const future = classifyNativePluginInventory({ configured: [], rows: [registryRow(0, { version: "9.0.0" }), registryRow(3, { version: "9.0.0" })] });
	assert.equal(future.status, "available");
	assert.equal(future.peers[0]!.assessment, "potential-overlap");
	assert.equal(future.peers[0]!.versionAssessment, "unassessed");
	assert.equal(future.peers[3]!.assessment, "unassessed");
	assert.deepEqual(future.peers[3]!.surfaces, []);
	assert.deepEqual(future.paused, ["robots", "schema"]);
});

check("configured ownership requires the exact entrypoint and uses the host absent-state fallback", () => {
	const configured = { id: "seo", entrypoint: "@moorage/plugin-seo/sandbox", version: "0.1.4" };
	const active = classifyNativePluginInventory({ configured: [configured], rows: [] });
	assert.equal(active.status, "available");
	assert.deepEqual(active.paused, ["robots", "schema"]);
	assert.equal(active.peers[4]!.state, "active");
	const inactive = classifyNativePluginInventory({ configured: [configured], rows: [configRow(configured, { status: "inactive" })] });
	assert.equal(inactive.status, "available");
	assert.deepEqual(inactive.paused, []);
	for (const entrypoint of ["another-plugin", "/node_modules/@moorage/plugin-seo/sandbox", "@moorage/plugin-seo/sandbox/extra"]) {
		const result = classifyNativePluginInventory({ configured: [{ ...configured, entrypoint }], rows: [] });
		assert.equal(result.status, "available");
		assert.deepEqual(result.paused, []);
		assert.equal(result.uncheckedConfiguredCount, 1);
		assert.equal(result.peers.length, 4);
	}
	const sameName = classifyNativePluginInventory({ configured: [{ id: "instant-indexer", entrypoint: "unrelated", version: "1.0.1" }], rows: [] });
	assert.deepEqual(sameName.paused, []);
	unavailable([configured], [configRow(configured, { version: "0.1.3" })]);
	unavailable([configured], [configRow(configured, { source: "registry" })]);
	unavailable([configured], [configRow(configured, { source: "marketplace" })]);
});

check("exact ID sets and bounded primitive facts reject ambiguity without truncation", () => {
	const configured = Array.from({ length: 28 }, (_, index) => ({ id: "plugin-" + index, entrypoint: "unrelated", version: "1" }));
	const prepared = prepareCoexistenceInventory(configured);
	assert.equal(prepared.status, "ready");
	assert.equal(prepared.ids.length, 32);
	assert.equal(new Set(prepared.ids).size, 32);
	assert.equal(classifyNativePluginInventory({ configured, rows: configured.map((item) => configRow(item)) }).status, "available");
	unavailable([...configured, { id: "overflow", entrypoint: "x", version: "1" }], []);
	unavailable([configured[0], configured[0]], []);
	unavailable([{ id: "Not-canonical", entrypoint: "x", version: "1" }], []);
	unavailable([{ id: "plugin/path", entrypoint: "x", version: "1" }], []);
	unavailable([{ id: COEXISTENCE_PROFILES[0]!.runtimeId, entrypoint: "x", version: "1" }], []);
	unavailable([], [registryRow(), registryRow()]);
	unavailable([], [{ ...registryRow(), id: "unrequested" }]);
	unavailable([], Array.from({ length: 33 }, () => registryRow()));
	unavailable([], [{ ...registryRow(), status: "installed" }]);
	unavailable([], [{ ...registryRow(), source: "marketplace" }]);
	unavailable([], [{ ...registryRow(), publisherDid: COEXISTENCE_PROFILES[1]!.publisherDid }]);
	unavailable([], [{ ...registryRow(), slug: "different" }]);
	unavailable([], [{ ...registryRow(), version: "1".repeat(129) }]);
	unavailable([], [{ ...registryRow(), version: "1\n" }]);
	unavailable([], [{ ...registryRow(), displayName: "Moorage SEO" }]);
	unavailable([], null);
	unavailable(null, []);
	const accessor = Object.defineProperty({ ...registryRow() }, "version", { get: () => { throw new Error("must not read accessor"); }, enumerable: true });
	unavailable([], [accessor]);
	assert.equal(prepareCoexistenceInventory([{ id: "x", entrypoint: "é".repeat(256), version: "1" }]).status, "ready");
	assert.equal(prepareCoexistenceInventory([{ id: "x", entrypoint: "é".repeat(257), version: "1" }]).status, "unavailable");
	assert.equal(prepareCoexistenceInventory([{ id: "x", entrypoint: "x\u200b", version: "1" }]).status, "unavailable");
	assert.deepEqual(unavailableCoexistenceInventory().paused, ["metadata", "robots", "schema", "indexnow"]);
});

check("24 KiB observation is inclusive, with one-byte overflow unavailable", () => {
	const configured = Array.from({ length: 28 }, (_, index) => ({ id: "plugin-" + index, entrypoint: "x", version: "1".repeat(128) }));
	const rows = configured.map((item) => configRow(item));
	const byteLength = () => new TextEncoder().encode(JSON.stringify({ configured, rows })).byteLength;
	for (const item of configured) {
		const added = Math.min(511, COEXISTENCE_MAX_OBSERVATION_BYTES - byteLength());
		if (added > 0) item.entrypoint += "x".repeat(added);
	}
	assert.equal(byteLength(), COEXISTENCE_MAX_OBSERVATION_BYTES);
	assert.equal(classifyNativePluginInventory({ configured, rows }).status, "available");
	const item = configured.find((candidate) => candidate.entrypoint.length < 512)!;
	assert.ok(item);
	item.entrypoint += "x";
	assert.equal(byteLength(), COEXISTENCE_MAX_OBSERVATION_BYTES + 1);
	unavailable(configured, rows);
});

check("restrictive robots combine independent sources instead of choosing one owner", () => {
	const sources = ["index,follow,max-image-preview:large", "noindex", "nofollow,noarchive", "none,nosnippet,noimageindex,notranslate"];
	const before = structuredClone(sources);
	const result = projectCoexistenceRobots({ sources });
	assert.equal(result.status, "preserved");
	assert.deepEqual(result.unresolved, []);
	assert.deepEqual(result.contribution, {
		kind: "meta", name: "robots", key: COEXISTENCE_ROBOTS_KEY,
		content: "noindex,nofollow,noarchive,nosnippet,noimageindex,notranslate",
	});
	assert.deepEqual(sources, before);
	assert.equal(projectCoexistenceRobots({ sources: ["index,follow"], siteNoindex: true }).contribution!.content, "noindex,nofollow");
	assert.equal(projectCoexistenceRobots({ sources: ["index,follow,all,indexifembedded,max-image-preview:large,max-snippet:-1,max-video-preview:-1"] }).contribution, null);
	assert.equal(projectCoexistenceRobots({ sources: [null, undefined, "", "   "] }).status, "preserved");
});

check("known preview limits keep the most restrictive bounded value", () => {
	const result = projectCoexistenceRobots({ sources: ["max-snippet: 160,max-video-preview:30,max-image-preview:standard", "max-snippet:80,max-video-preview:0,max-image-preview:none", "max-snippet:-1,max-video-preview:-1,max-image-preview:large"] });
	assert.equal(result.status, "preserved");
	assert.equal(result.contribution!.content, "max-snippet:80,max-video-preview:0,max-image-preview:none");
	assert.equal(projectCoexistenceRobots({ sources: ["MAX-SNIPPET: 2147483647"] }).status, "preserved");
	const overflow = projectCoexistenceRobots({ sources: ["max-snippet:2147483648"] });
	assert.equal(overflow.status, "unresolved");
	assert.equal(overflow.contribution!.content, "max-snippet:2147483648");
});

check("unclassified bounded rules are carried as unresolved without invented noindex", () => {
	const result = projectCoexistenceRobots({ sources: ["noindex,CustomBot: review, unavailable_after: Wed, 03 Dec 2027 13:00:00 GMT", "noindex,CustomBot: review"] });
	assert.equal(result.status, "unresolved");
	assert.equal(result.unresolved.length, 1);
	assert.equal(result.contribution!.content, "noindex,CustomBot: review,unavailable_after: Wed,03 Dec 2027 13:00:00 GMT");
	assert.equal(projectCoexistenceRobots({ sources: ["custom-rule"] }).contribution!.content, "custom-rule");
	assert.equal(projectCoexistenceRobots({ sources: ["nosnippet max-snippet:100"] }).status, "unresolved");
	assert.equal(projectCoexistenceRobots({ sources: ["review=\"a&b\""] }).contribution!.content, "review=\"a&b\"");
});

check("malformed sources stay unresolved while independent saved restrictions survive", () => {
	for (const source of ["noindex\nfollow", "noindex\u0000", "noindex\u200b", "<meta name=robots>", "\ud800", 42, {}]) {
		const result = projectCoexistenceRobots({ sources: [source, "noindex"] });
		assert.equal(result.status, "unresolved");
		assert.equal(result.contribution!.content, "noindex");
	}
	const invalidSite = projectCoexistenceRobots({ sources: [], siteNoindex: "false" });
	assert.equal(invalidSite.status, "unresolved");
	assert.equal(invalidSite.contribution, null);
	for (const sources of [null, Array.from({ length: 9 }, () => "noindex")]) {
		const result = projectCoexistenceRobots({ sources, siteNoindex: true });
		assert.equal(result.status, "unresolved");
		assert.equal(result.contribution!.content, "noindex,nofollow");
	}
});

check("robots UTF-8 and aggregate bounds remain explicit", () => {
	const atSource = projectCoexistenceRobots({ sources: ["é".repeat(1024)] });
	assert.equal(atSource.status, "unresolved");
	assert.equal(atSource.contribution!.content, "é".repeat(1024));
	assert.equal(projectCoexistenceRobots({ sources: ["é".repeat(1025)] }).contribution, null);
	const atTotal = projectCoexistenceRobots({ sources: Array.from({ length: 4 }, (_, index) => String(index) + "x".repeat(2047)) });
	assert.equal(atTotal.status, "unresolved");
	assert.equal(atTotal.contribution!.content.split(",").length, 4);
	const over = projectCoexistenceRobots({ sources: [...Array.from({ length: 4 }, () => "x".repeat(2048)), "extra"] });
	assert.equal(over.status, "unresolved");
	assert.ok(!over.contribution!.content.includes("extra"));
	assert.equal(projectCoexistenceRobots({ sources: ["x".repeat(2049)], siteNoindex: true }).contribution!.content, "noindex,nofollow");
});

console.log("Plugin coexistence checks passed (" + groups + " groups).");
