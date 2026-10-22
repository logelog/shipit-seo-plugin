import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { shipitSeo } from "../../../packages/emdash-plugin-seo/src/astro.ts";
import { createEnvironment, runtimeExport, sourceRoot } from "../../../scripts/published-host/environment.mjs";
import { viteAliases } from "../../../scripts/published-host/vite-aliases.mjs";

const environment = createEnvironment();
if (environment.target.name !== "native-1.3.0") {
  throw new Error(`This configuration requires native-1.3.0; selected ${environment.target.name}`);
}
environment.assertVersions();
const { default: node } = await import(runtimeExport(environment, "@astrojs/node").href);
const { default: react } = await import(runtimeExport(environment, "@astrojs/react").href);
const { default: emdash } = await import(runtimeExport(environment, "emdash", "./astro").href);
const { sqlite } = await import(runtimeExport(environment, "emdash", "./db").href);
const stateRoot = environment.target.stateRoot;
const origin = `http://127.0.0.1:${environment.target.port}`;
mkdirSync(stateRoot, { recursive: true });

export default {
  site: origin,
  srcDir: "./src-native",
  output: "server",
  outDir: fileURLToPath(new URL("dist/", stateRoot)),
  cacheDir: fileURLToPath(new URL("astro/", stateRoot)),
  devToolbar: { enabled: false },
  server: { host: "127.0.0.1", port: environment.target.port, open: false },
  adapter: node({ mode: "standalone" }),
  integrations: [
    react(),
    shipitSeo(emdash, {
      database: sqlite({ url: `file:${fileURLToPath(new URL("dev.sqlite", stateRoot))}` }),
      registry: false,
    }),
  ],
  vite: {
    cacheDir: fileURLToPath(new URL("vite/", stateRoot)),
    resolve: { alias: viteAliases(environment), dedupe: ["react", "react-dom", "@tanstack/react-query"] },
    ssr: { external: ["react", "react-dom"], noExternal: ["@shipitseo/emdash-plugin-seo"] },
    server: {
      strictPort: true,
      fs: { allow: [fileURLToPath(sourceRoot), fileURLToPath(environment.hostRoot)] },
      watch: { ignored: ["**/dev.sqlite*", "**/artifacts/**", "**/.dev/**"] },
    },
  },
};
