import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hostPackageRoot, sourceRoot, target } from "./host-loader.mjs";
import { seoPackageName } from "./environment.mjs";

for (const [name, version] of ["emdash", "@emdash-cms/admin", "astro"].map(name => [name, target.versions.get(name)])) {
	const root = hostPackageRoot(name);
	const resolved = realpathSync(fileURLToPath(import.meta.resolve(name)));
	assert.ok(resolved.startsWith(fileURLToPath(root)), `${name} must resolve from the selected published host graph`);
	assert.equal(JSON.parse(readFileSync(new URL("package.json", root), "utf8")).version, version);
	console.log(`${name}@${version}: ${resolved}`);
}
assert.equal(
	import.meta.resolve(seoPackageName + "/admin-contract"),
	new URL("packages/emdash-plugin-seo/dist/admin-contract.js", sourceRoot).href,
);
console.log("Canonical SEO admin contract and selected published host resolutions verified.");
