import assert from "node:assert/strict";

const productionFlagCounts = new Map([["native-1.2.0", 1], ["native-1.3.0", 1], ["native-1.5.0", 2]]);

export function runtimeProductionSource(targetName, source) {
  const expected = productionFlagCounts.get(targetName);
  assert.notEqual(expected, undefined, "the released runtime has a reviewed Astro production flag count");
  assert.equal((source.match(/import\.meta\.env\.DEV/g) ?? []).length, expected,
    "the harness replaces only the released runtime's reviewed Astro production flags");
  return source.replaceAll("import.meta.env.DEV", "false");
}
