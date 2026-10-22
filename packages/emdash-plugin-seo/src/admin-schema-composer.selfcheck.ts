import seoRuntime from "./sandbox-entry.ts";

let failures = 0;

function check(name: string, ok: boolean, detail = "") {
	if (ok) {
		console.log(`  PASS  ${name}`);
		return;
	}
	failures += 1;
	console.error(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
}

function createStore(initial: Array<[string, unknown]> = []) {
	const values = new Map(initial);
	let puts = 0;
	let deletes = 0;
	let sequence = 0;
	const revisions = new Map<string, string>();
	return {
		get puts() {
			return puts;
		},
		get deletes() {
			return deletes;
		},
		get ids() {
			return [...values.keys()];
		},
		value: (id: string) => structuredClone(values.get(id)),
		get: async (id: string) => structuredClone(values.get(id) ?? null),
		put: async (id: string, value: unknown) => {
			puts += 1;
			values.set(id, structuredClone(value));
		},
		getVersioned: async (id: string) => values.has(id)
			? { value: structuredClone(values.get(id)), revision: revisions.get(id) ?? `initial:${id}` } : null,
		compareAndSet: async (id: string, expected: string | null, next: unknown) => {
			const current = values.has(id) ? revisions.get(id) ?? `initial:${id}` : null;
			if (current !== expected) return { applied: false };
			const revision = `schema:${++sequence}`;
			puts += 1; values.set(id, structuredClone(next)); revisions.set(id, revision);
			return { applied: true, revision };
		},
		compareAndDelete: async (id: string, expected: string) => {
			if (!values.has(id) || (revisions.get(id) ?? `initial:${id}`) !== expected) return { applied: false };
			deletes += 1; values.delete(id); revisions.delete(id); return { applied: true };
		},
		delete: async (id: string) => {
			deletes += 1;
			return values.delete(id);
		},
		count: async () => values.size,
		query: async ({ limit = 100 }: { limit?: number } = {}) => ({
			items: [...values.entries()].slice(0, limit).map(([id, data]) => ({ id, data: structuredClone(data) })),
			cursor: undefined,
			hasMore: values.size > limit,
		}),
	};
}

const schemas = createStore();
const emptyStore = () => createStore();
const kv = new Map<string, unknown>();
const context = {
	plugin: { id: "shipit-seo", version: "test" },
	kv: {
		get: async (key: string) => structuredClone(kv.get(key) ?? null),
		// Published hosts read settings with revisions; unchanged rows keep one.
		getVersioned: async (key: string) => kv.has(key) ? { value: structuredClone(kv.get(key)), revision: "r1" } : null,
		compareAndSet: async () => ({ applied: false }),
		compareAndDelete: async () => ({ applied: false }),
		set: async (key: string, value: unknown) => kv.set(key, structuredClone(value)),
		delete: async (key: string) => kv.delete(key),
		list: async () => [],
	},
	storage: {
		overrides: emptyStore(),
		schemas,
		scores: emptyStore(),
		scoreAnalysisRevisions: emptyStore(),
		migrations: emptyStore(),
	},
	url: (path: string) => new URL(path, "https://example.com").href,
	log: { warn: () => undefined, info: () => undefined, error: () => undefined, debug: () => undefined },
};

function admin(input: Record<string, unknown>) {
	const handler = (seoRuntime as any).routes.admin.handler as (routeContext: any, pluginContext: any) => Promise<any>;
	return handler({
		input,
		request: {
			url: "https://example.com/_emdash/api/plugins/shipit-seo/admin",
			method: "POST",
			headers: {},
		},
	}, context);
}

function route(name: string, input: Record<string, unknown>) {
	const handler = (seoRuntime as any).routes[name].handler as (routeContext: any, pluginContext: any) => Promise<any>;
	return handler({
		input,
		request: {
			url: `https://example.com/_emdash/api/plugins/shipit-seo/${name}`,
			method: "POST",
			headers: {},
		},
	}, context);
}

const baseValues = {
	name: "{{title}}",
	description: "{{description}}",
	url: "{{canonical}}",
	image: "{{image}}",
	steps: "Only one step",
	totalTime: "PT2H",
	tools: "Content editor",
	supplies: "Approved brief",
	estimatedCost: "",
	currency: "EUR",
};

const legacySchemaPage = await admin({ page: "schemas" });
check(
	"the legacy page no longer offers a schema editor",
	!JSON.stringify(legacySchemaPage.blocks).includes("seo_schema_compose") &&
		!JSON.stringify(legacySchemaPage.blocks).includes("seo_add_schema"),
);
const legacyWrite = await admin({
	type: "form_submit",
	block_id: "seo_schema_compose:howTo",
	values: { schemaName: "Publishing guide", scope: "posts", enabled: true, ...baseValues },
});
check("the legacy page rejects schema writes", legacyWrite.toast?.type === "error" && schemas.puts === 0);

const invalid = await route("compose-admin-schema", {
	id: "invalid-guide", expectedRevision: null,
	recipe: "howTo",
	schemaName: "Publishing guide",
	scope: "posts",
	enabled: true,
	values: baseValues,
});
check("invalid composer input is rejected", invalid.success === false && Boolean(invalid.errors?.steps));
check("invalid composer input performs no writes", schemas.puts === 0);

const created = await route("compose-admin-schema", {
	id: "publishing-guide", expectedRevision: null,
	recipe: "howTo",
	schemaName: "Publishing guide",
	scope: "posts",
	enabled: true,
	values: { ...baseValues, steps: "Plan | Confirm the outcome\nPublish | Complete and review the work" },
});
check("valid composer input is saved", created.success === true && schemas.puts === 1);
const schemaId = created.schema?.id as string;
const stored = schemas.value(schemaId) as any;
const graph = JSON.parse(stored.json) as any;
check("composer stores validated JSON-LD", graph["@type"] === "HowTo" && graph.step.length === 2);
check("composer preserves safe page variables", graph["@id"] === "{{canonical}}#how-to");
check("saved schema reports detected types", created.schema?.types.includes("HowTo") === true);

const invalidEdit = await route("save-admin-custom-schema", {
	id: schemaId, expectedRevision: created.schema.revision,
	name: "Publishing guide",
	scope: "posts",
	json: "not json",
	enabled: true,
});
check("invalid raw edits fail safely", invalidEdit.success === false && schemas.puts === 1);
const updated = await route("save-admin-custom-schema", {
	id: schemaId, expectedRevision: created.schema.revision,
	name: "Publishing guide v2",
	scope: "posts",
	json: stored.json,
	enabled: false,
});
check("valid raw edits update the same schema", updated.success === true && updated.schema?.id === schemaId && schemas.puts === 2);
check("raw edit can disable schema output", (schemas.value(schemaId) as any).enabled === false);

console.log(failures === 0 ? "\nALL SEO ADMIN SCHEMA COMPOSER CHECKS PASSED" : `\n${failures} SEO ADMIN SCHEMA COMPOSER CHECK(S) FAILED`);
if (failures > 0) throw new Error(`${failures} SEO admin schema composer self-check(s) failed`);
