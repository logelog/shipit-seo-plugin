// Opt-in developer preview of the native fixture with the Shipit admin entry
// served from package source. Astro runs in this process, so every child stays
// in the toolkit runner's process group. Run it through
// `node ./tooling/plugin-dev/cli.mjs dev-admin --target NAME`, which
// refreshes the runtime package once and holds the development lock.
import { fileURLToPath } from "node:url";
import { createEnvironment, runtimeExport } from "./environment.mjs";
import { readCompatibility } from "../compatibility.mjs";

const supportedNativeTargets = new Set(Object.keys(readCompatibility().targets));
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--target" || !supportedNativeTargets.has(args[1])) {
  throw new Error("Usage: node ./tooling/plugin-dev/cli.mjs dev-admin --target " + [...supportedNativeTargets].join("|"));
}
if (process.env.SHIPIT_HOST_TARGET !== args[1] || !process.env.SHIPIT_PUBLISHED_HOST) {
  throw new Error("Start the admin source preview through the toolkit so the native host and lock are selected.");
}
const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 24 || minor < 19) throw new Error("Use Node >=24.19.0 <25 for the published-host dev app");

const environment = createEnvironment();
if (environment.target.name !== args[1]) throw new Error(`The admin source preview requires ${args[1]}; selected ${environment.target.name}`);
environment.assertVersions();
process.env.ASTRO_TELEMETRY_DISABLED = "1";
const { dev } = await import(runtimeExport(environment, "astro").href);
await dev({
  root: fileURLToPath(environment.target.fixtureRoot),
  configFile: "astro.native-admin.config.mjs",
  server: { host: "127.0.0.1", port: environment.target.port, open: false },
});
