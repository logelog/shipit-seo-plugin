import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { BracketsCurly, Buildings, Files, Stack, TreeStructure } from "@phosphor-icons/react";
import { buildSchemaMapModel, type SchemaMapInput, type SchemaMapRow } from "./schema-map-model.ts";

export interface SchemaMapViewProps extends SchemaMapInput {
	onOpenIdentity: () => void;
	onOpenDefaults: () => void;
	onOpenCustom: () => void;
}

function MapStatus({ value }: { value: SchemaMapRow }) {
	return <Badge variant={value.state === "invalid" ? "error" : value.state === "unknown" ? "warning" : "secondary"}>{value.status}</Badge>;
}

function MapRows({ items }: { items: readonly SchemaMapRow[] }) {
	return <ul className="shipit-seo-schema-map__rows">{items.map((item) => <li key={item.id}>
		<div className="shipit-seo-schema-map__row-heading"><strong>{item.name}</strong><MapStatus value={item} /></div>
		<p>{item.detail}</p>
	</li>)}</ul>;
}

export function SchemaMapView({ onOpenIdentity, onOpenDefaults, onOpenCustom, ...input }: SchemaMapViewProps) {
	const model = buildSchemaMapModel(input);
	const core = model.builtIns.filter((item) => item.id === "website" || item.id === "webPage");
	const other = model.builtIns.filter((item) => item.id !== "website" && item.id !== "webPage");
	return <section className="shipit-seo-schema-map" aria-labelledby="seo-schema-map-title">
		<header className="shipit-seo-schema-map__header">
			<div><span className="shipit-seo-eyebrow">Saved configuration</span><h2 id="seo-schema-map-title"><TreeStructure size={21} aria-hidden="true" />Configured schema</h2></div>
			<MapStatus value={model.gate} />
		</header>
		<p className="shipit-seo-schema-map__intro">{model.gate.detail}</p>
		<div className="shipit-seo-schema-map__site"><strong>{model.siteName}</strong><span>Publisher, built-ins and matching custom schemas</span></div>
		<div className="shipit-seo-schema-map__branches">
			<section className="shipit-seo-schema-map__card" aria-labelledby="seo-schema-map-publisher">
				<h3 id="seo-schema-map-publisher"><Buildings size={19} aria-hidden="true" />Publisher</h3>
				<MapRows items={[model.publisher]} />
				{model.publisherDraft ? <p>Unsaved identity edits are excluded.</p> : null}
				<Button type="button" variant="secondary" size="sm" onClick={onOpenIdentity}>Open Local SEO</Button>
			</section>
			<section className="shipit-seo-schema-map__card" aria-labelledby="seo-schema-map-builtins">
				<h3 id="seo-schema-map-builtins"><BracketsCurly size={19} aria-hidden="true" />Built-in schemas</h3>
				<MapRows items={core} />
				{other.length ? <details><summary>Other built-ins ({other.length})</summary><MapRows items={other} /></details> : null}
				<Button type="button" variant="secondary" size="sm" onClick={onOpenDefaults}>Review defaults</Button>
			</section>
			<section className="shipit-seo-schema-map__card" aria-labelledby="seo-schema-map-types">
				<h3 id="seo-schema-map-types"><Files size={19} aria-hidden="true" />Content types</h3>
				{model.contentTypes.length ? <MapRows items={model.contentTypes.slice(0, 3)} /> : <p>No content types are listed in this read.</p>}
				{model.contentTypes.length > 3 ? <details><summary>Other content types ({model.contentTypes.length - 3})</summary><MapRows items={model.contentTypes.slice(3)} /></details> : null}
				{model.contentTypesNotice ? <p>{model.contentTypesNotice}</p> : null}
				{model.retainedRoles ? <p>{model.retainedRoles} saved {model.retainedRoles === 1 ? "mapping is" : "mappings are"} outside the listed content types.</p> : null}
				<Button type="button" variant="secondary" size="sm" onClick={onOpenDefaults}>Edit content-type defaults</Button>
			</section>
			<section className="shipit-seo-schema-map__card" aria-labelledby="seo-schema-map-custom">
				<h3 id="seo-schema-map-custom"><Stack size={19} aria-hidden="true" />Custom schemas</h3>
				<dl className="shipit-seo-schema-map__counts">{model.customGroups.map((group) => <div key={group.id}><dt>{group.label}</dt><dd>{group.items.length}</dd></div>)}</dl>
				{model.customTruncated ? <p>This custom-schema list is incomplete. Counts cover {model.customCount} returned records.</p> : null}
				{model.customCount ? <details><summary>Review {model.customCount} listed custom schemas</summary>
					{model.customGroups.filter((group) => group.items.length).map((group) => <section key={group.id} aria-label={group.label}><h4>{group.label}</h4><MapRows items={group.items} /></section>)}
				</details> : <p>No custom schemas are listed.</p>}
				<Button type="button" variant="secondary" size="sm" onClick={onOpenCustom}>Manage custom schemas</Button>
			</section>
		</div>
		<p className="shipit-seo-schema-map__boundary">This map shows saved choices, not emitted markup. Entry overrides, required page data, conflicts, themes and core markup are outside this map. Preview a saved entry to review its resolved schema.</p>
	</section>;
}
