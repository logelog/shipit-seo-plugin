import assert from "node:assert/strict";

import { COEXISTENCE_ROBOTS_KEY } from "./plugin-coexistence.ts";
import {
	COEXISTENCE_METADATA_INSPECTION_LIMIT,
	finalizeOwnMetadataContributions,
	markOwnMetadataContributions,
} from "./plugin-coexistence-metadata.ts";

let groups = 0;
function check(name: string, run: () => void): void {
	run(); groups += 1; console.log("PASS " + name);
}
function own(...values: Record<string, unknown>[]): readonly Record<string, unknown>[] {
	values.forEach(Object.freeze);
	const result = Object.freeze(values);
	markOwnMetadataContributions(result);
	return result;
}
function robots(output: readonly unknown[]): Array<Record<string, unknown>> {
	return output.filter((value): value is Record<string, unknown> => value !== null && typeof value === "object" &&
		(value as Record<string, unknown>).kind === "meta" && (value as Record<string, unknown>).name === "robots");
}
function content(output: readonly unknown[]): string {
	return robots(output).map((value) => String(value.content)).join(",");
}
function peerOrder(output: readonly unknown[], peers: readonly object[]): void {
	const actual = output.filter((value) => peers.includes(value as object));
	assert.equal(actual.length, peers.length);
	peers.forEach((peer, index) => assert.equal(actual[index], peer));
}
function ordinary() {
	return [
		{ kind: "meta", name: "description", content: "Own description" },
		{ kind: "property", property: "og:title", content: "Own social title" },
		{ kind: "meta", name: "twitter:card", content: "summary_large_image" },
		{ kind: "link", rel: "canonical", href: "https://example.test/own" },
		{ kind: "link", rel: "alternate", href: "https://example.test/nl/own", hreflang: "nl" },
	];
}

check("ownership uses exact references rather than lookalike IDs, names or keys", () => {
	const ours = own({ kind: "jsonld", id: "primary", graph: Object.freeze({ "@type": "WebSite" }) });
	const clone = Object.freeze({ ...ours[0] });
	const unrelated = Object.freeze({ kind: "meta", name: "theme-color", content: "#112233", key: "shipit-seo:ordinary" });
	const raw = Object.freeze([ours[0], clone, unrelated]);
	const output = finalizeOwnMetadataContributions(raw, "noindex");
	assert.notEqual(output, raw);
	assert.equal(output.includes(ours[0]), false);
	assert.equal(output[0], clone);
	assert.equal(output[1], unrelated);
	assert.equal(robots(output).length, 0);
	markOwnMetadataContributions(null); markOwnMetadataContributions("description");
});

check("robots-only overlap retains search and social in both orders and preserves core restrictions", () => {
	for (const foreignFirst of [false, true]) {
		const fields = ordinary();
		const ours = own(...fields, { kind: "meta", name: "robots", content: "index,follow,nofollow,CustomRule" });
		const peer = Object.freeze({ kind: "meta", name: "robots", content: "index,follow" });
		const unrelated = Object.freeze({ kind: "meta", name: "theme-color", content: "black" });
		const peers = [peer, unrelated];
		const raw = Object.freeze(foreignFirst ? [...peers, ...ours] : [...ours, ...peers]);
		const snapshot = JSON.stringify(raw);
		const output = finalizeOwnMetadataContributions(raw, "noindex");
		fields.forEach((field) => assert.ok(output.includes(field)));
		peerOrder(output, peers);
		assert.ok(content(output).includes("noindex"));
		assert.ok(content(output).includes("nofollow"));
		assert.ok(content(output).includes("CustomRule"));
		robots(output).filter((value) => value !== peer).forEach((value) => assert.notEqual(value.key, "robots"));
		assert.equal(JSON.stringify(raw), snapshot);
	}
});

check("each actual search/social/canonical/alternate owner pauses the own ordinary family only", () => {
	for (const peer of [
		{ kind: "meta", name: "description", content: "Peer description" },
		{ kind: "property", property: "og:title", content: "Peer social title", key: "different-key" },
		{ kind: "meta", name: "twitter:title", content: "Peer social title" },
		{ kind: "link", rel: "canonical", href: "https://example.test/peer" },
		{ kind: "link", rel: "alternate", href: "https://example.test/de/peer", hreflang: "de" },
	]) {
		Object.freeze(peer);
		const fields = ordinary();
		const schema = { kind: "jsonld", id: "own", graph: Object.freeze({ "@type": "WebSite" }) };
		const verification = { kind: "meta", name: "custom-verification", content: "own-code" };
		const author = { kind: "meta", name: "author", content: "Site owner" };
		const ours = own(...fields, schema, verification, author, { kind: "meta", name: "robots", content: "noindex,nofollow" });
		const raw = Object.freeze([...ours, peer]);
		const output = finalizeOwnMetadataContributions(raw, "index,follow");
		fields.forEach((field) => assert.equal(output.includes(field), false));
		assert.ok(output.includes(schema)); assert.ok(output.includes(verification)); assert.ok(output.includes(author));
		assert.ok(output.includes(peer)); assert.ok(content(output).includes("noindex,nofollow"));
	}
});

check("foreign JSON-LD owns schema regardless of script key and installation order", () => {
	for (const id of ["primary", "distinct-peer-id", undefined]) for (const foreignFirst of [false, true]) {
		const ours = own(
			{ kind: "jsonld", id: "primary", graph: Object.freeze({ "@type": "Organization" }) },
			{ kind: "jsonld", id: "custom-own", graph: Object.freeze({ "@type": "BlogPosting" }) },
			{ kind: "meta", name: "description", content: "Keep own metadata" },
		);
		const peer = Object.freeze({ kind: "jsonld", id, graph: Object.freeze({ "@type": "Article" }) });
		const output = finalizeOwnMetadataContributions(Object.freeze(foreignFirst ? [peer, ...ours] : [...ours, peer]), "noindex");
		assert.equal(output.includes(ours[0]), false); assert.equal(output.includes(ours[1]), false);
		assert.ok(output.includes(ours[2])); assert.ok(output.includes(peer));
		assert.equal(robots(output).length, 0);
	}
});

check("Moorage-shaped robots and primary graph leave own ordinary metadata intact", () => {
	const ours = own(...ordinary(), { kind: "jsonld", id: "primary", graph: Object.freeze({ "@type": "WebSite" }) }, { kind: "meta", name: "robots", content: "noindex,nofollow" });
	const peers = Object.freeze([
		Object.freeze({ kind: "meta", name: "robots", content: "index,follow" }),
		Object.freeze({ kind: "jsonld", id: "primary", graph: Object.freeze({ "@context": "https://schema.org", "@type": "BlogPosting" }) }),
	]);
	for (const raw of [Object.freeze([...ours, ...peers]), Object.freeze([...peers, ...ours])]) {
		const output = finalizeOwnMetadataContributions(raw, "index,follow");
		ours.slice(0, 5).forEach((value) => assert.ok(output.includes(value)));
		assert.equal(output.includes(ours[5]), false);
		assert.ok(content(output).includes("noindex,nofollow"));
		peerOrder(output, peers);
	}
});

check("a matching verification name yields only that own custom tag even under different keys", () => {
	const ours = own(
		{ kind: "meta", name: "custom-one", content: "one" },
		{ kind: "meta", name: "custom-two", content: "two" },
		...ordinary(),
	);
	const peer = Object.freeze({ kind: "meta", name: "CUSTOM-ONE", content: "peer-value", key: "different" });
	const unrelated = Object.freeze({ kind: "property", property: "custom:theme", content: "dark" });
	const output = finalizeOwnMetadataContributions(Object.freeze([...ours, peer, unrelated]), "noindex");
	assert.equal(output.includes(ours[0]), false);
	ours.slice(1).forEach((value) => assert.ok(output.includes(value)));
	peerOrder(output, [peer, unrelated]);
	assert.equal(robots(output).length, 0);
});

check("an invocation with no owned output never invents a core or site rule", () => {
	for (const page of ["noindex,nofollow", "none", "UnknownRule", undefined]) {
		const peer = Object.freeze({ kind: "meta", name: "description", content: "Peer" });
		const raw = Object.freeze([peer]);
		const output = finalizeOwnMetadataContributions(raw, page);
		assert.notEqual(output, raw); assert.deepEqual(output, [peer]); assert.equal(output[0], peer);
	}
});

check("without overlap owned identities, permissive rules and unrelated contributions stay unchanged", () => {
	const ours = own(...ordinary(), { kind: "meta", name: "robots", content: "index,follow,max-image-preview:large" });
	const peer = Object.freeze({ kind: "link", rel: "license", href: "https://example.test/license" });
	const raw = Object.freeze([...ours, peer]);
	const output = finalizeOwnMetadataContributions(raw, "noindex");
	assert.deepEqual(output, raw); raw.forEach((value, index) => assert.equal(output[index], value));
});

check("multiple own robots sources retain all bounded rules with distinct keys and no invented noindex", () => {
	const values = Array.from({ length: 12 }, (_, index) => ({ kind: "meta", name: "robots", content: "CustomRule" + index }));
	const ours = own(...values);
	const peer = Object.freeze({ kind: "meta", name: "robots", content: "index,follow", key: COEXISTENCE_ROBOTS_KEY });
	const output = finalizeOwnMetadataContributions(Object.freeze([peer, ...ours]), "index,follow");
	const projected = robots(output).filter((value) => value !== peer);
	assert.equal(projected.length, 12);
	assert.equal(new Set(projected.map((value) => value.key)).size, 12);
	assert.ok(projected.every((value) => value.key !== peer.key));
	values.forEach((value) => assert.ok(content(output).includes(value.content)));
	assert.ok(!content(output).includes("noindex"));
	const onlyPermissive = own({ kind: "meta", name: "robots", content: "index,follow,all,max-snippet:-1" });
	assert.deepEqual(finalizeOwnMetadataContributions(Object.freeze([...onlyPermissive, peer]), "index,follow"), [peer]);
	const ordinaryOnly = own(...ordinary());
	assert.ok(content(finalizeOwnMetadataContributions(Object.freeze([...ordinaryOnly, peer]), "noindex")).includes("noindex"));
});

check("malformed fields conservatively pause only own output without invoking accessors or changing peers", () => {
	let accessed = 0;
	const malformed = Object.freeze(Object.defineProperty({ kind: "meta", name: "description" }, "content", { get() { accessed += 1; return "Never read"; }, enumerable: true }));
	const ours = own(...ordinary(), { kind: "meta", name: "custom-check", content: "keep-only-within-classified-input" }, { kind: "meta", name: "robots", content: "noindex,RawUnknownRule" });
	const raw = Object.freeze([...ours, malformed]);
	const output = finalizeOwnMetadataContributions(raw, "index,follow");
	assert.equal(accessed, 0); assert.equal(output.includes(malformed), true);
	ours.slice(0, -1).forEach((value) => assert.equal(output.includes(value), false));
	assert.ok(content(output).includes("noindex,RawUnknownRule"));
	const badOwn = own({ kind: "meta", name: "robots", content: null });
	const peer = Object.freeze({ kind: "meta", name: "theme-color", content: "black" });
	assert.deepEqual(finalizeOwnMetadataContributions(Object.freeze([...badOwn, peer]), "index,follow"), [peer]);
});

check("1024 boundary retains unmatched verification while overflow removes all own nonrobots", () => {
	assert.equal(COEXISTENCE_METADATA_INSPECTION_LIMIT, 1024);
	const fields = own(...ordinary(), { kind: "meta", name: "custom-check", content: "own" }, { kind: "meta", name: "robots", content: "noindex,RawUnknownRule" });
	const peers = Array.from({ length: 1024 - fields.length }, (_, index) => Object.freeze({ kind: "meta", name: "theme-color", content: String(index) }));
	const exact = Object.freeze([...fields, ...peers]);
	assert.equal(exact.length, 1024);
	assert.ok(finalizeOwnMetadataContributions(exact, "index,follow").includes(fields[5]));
	const extra = Object.freeze({ kind: "meta", name: "custom-check", content: "peer" });
	const raw = Object.freeze([...exact, extra]);
	const snapshot = JSON.stringify(raw);
	const output = finalizeOwnMetadataContributions(raw, "index,follow");
	fields.slice(0, -1).forEach((value) => assert.equal(output.includes(value), false));
	peerOrder(output, [...peers, extra]);
	assert.ok(content(output).includes("noindex,RawUnknownRule"));
	assert.equal(JSON.stringify(raw), snapshot);
});

check("overflow reserves only explicit keys without reading remaining peer fields or accessors", () => {
	let accessed = 0;
	const collision: Record<string, unknown> = { key: COEXISTENCE_ROBOTS_KEY };
	for (const name of ["kind", "name", "content", "graph"])
		Object.defineProperty(collision, name, { get() { accessed += 1; throw new Error("Uninspected field"); }, enumerable: true });
	Object.freeze(collision);
	const opaque = Object.freeze(Object.defineProperty({}, "key", { get() { accessed += 1; throw new Error("Uninspected accessor"); }, enumerable: true }));
	const peers = Array.from({ length: 1024 }, () => Object.freeze({ kind: "meta", name: "theme-color", content: "black" }));
	const ours = own({ kind: "meta", name: "description", content: "Paused" }, { kind: "meta", name: "robots", content: "noindex,UnknownRule" });
	const raw = Object.freeze([...peers, collision, opaque, ...ours]);
	const output = finalizeOwnMetadataContributions(raw, "index,follow");
	assert.equal(accessed, 0);
	assert.equal(output.includes(ours[0]), false);
	peerOrder(output, [...peers, collision, opaque]);
	const projected = robots(output.filter((value) => value !== collision && value !== opaque));
	assert.equal(projected.length, 1);
	assert.notEqual(projected[0]!.key, COEXISTENCE_ROBOTS_KEY);
	assert.equal(projected[0]!.content, "noindex,UnknownRule");
});

check("overflow reserves the host fallback name of an actual meta contribution before owned output", () => {
	for (const key of [undefined, null]) {
		const peers = Array.from({ length: 1024 }, () => Object.freeze({ kind: "meta", name: "theme-color", content: "black" }));
		const collision = Object.freeze({ kind: "meta", name: COEXISTENCE_ROBOTS_KEY, content: "index,follow", ...(key === undefined ? {} : { key }) });
		const ours = own({ kind: "meta", name: "robots", content: "noindex,nofollow" });
		const raw = Object.freeze([...peers, collision, ...ours]);
		const output = finalizeOwnMetadataContributions(raw, "index,follow");
		peerOrder(output, [...peers, collision]);
		const projected = robots(output);
		assert.equal(projected.length, 1);
		assert.notEqual(projected[0]!.key, collision.key ?? collision.name);
		assert.equal(projected[0]!.content, "noindex,nofollow");
	}
});

check("repeated finalization preserves derived ownership without accumulating core restriction tags", () => {
	const ours = own(...ordinary(), { kind: "meta", name: "robots", content: "nofollow,UnknownRule" });
	const peer = Object.freeze({ kind: "meta", name: "robots", content: "index,follow" });
	const raw = Object.freeze([...ours, peer]);
	const first = finalizeOwnMetadataContributions(raw, "noindex");
	const second = finalizeOwnMetadataContributions(Object.freeze(first), "noindex");
	const again = finalizeOwnMetadataContributions(raw, "noindex");
	assert.deepEqual(second, first); assert.deepEqual(again, first);
	assert.equal(first.filter((value) => value === peer).length, 1);
	assert.equal(second.filter((value) => value === peer).length, 1);
	assert.equal(robots(first).length, 3);
});

console.log("Metadata coexistence finalization checks passed (" + groups + " groups).");
