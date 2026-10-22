import { dev } from "astro";
import { fileURLToPath } from "node:url";
import { hostTarget } from "./environment.mjs";

await dev({
  root: fileURLToPath(hostTarget.fixtureRoot),
  configFile: hostTarget.configFile,
  server: { host: "127.0.0.1", port: hostTarget.port, open: false },
});
