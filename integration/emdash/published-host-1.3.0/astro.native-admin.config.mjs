// Developer-only admin source preview of the native fixture. It keeps the native
// database, development login guard, media and sessions, serves only the exact
// Shipit admin entry from package source, and keeps its own Astro and Vite
// caches and output so the packed preview's caches stay valid. Never used for
// verification or packaging.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import nativeConfig from "./astro.native.config.mjs";
import { createEnvironment, runtimeExport, sourceRoot } from "../../../scripts/published-host/environment.mjs";

const environment = createEnvironment();
if (environment.target.name !== "native-1.3.0") {
  throw new Error(`The admin source preview requires native-1.3.0; selected ${environment.target.name}`);
}
const stateRoot = new URL("admin-source/", environment.target.stateRoot);
const packageSource = fileURLToPath(new URL("packages/emdash-plugin-seo/src/", sourceRoot));
// Exact match only: every other package export still resolves to built output.
const adminSource = { find: /^@shipitseo\/emdash-plugin-seo\/admin$/, replacement: fileURLToPath(new URL("packages/emdash-plugin-seo/src/admin-ui/admin.tsx", sourceRoot)) };
// The Node adapter's default session store lives under cacheDir, so moving the
// cache would silently start a second login store. Pin that default to the
// native preview's store; an explicit native session setting is kept as is.
const { sessionDrivers } = await import(runtimeExport(environment, "astro", "./config").href);
const session = nativeConfig.session === false || nativeConfig.session?.driver ? nativeConfig.session
  : { ...nativeConfig.session, driver: sessionDrivers.fsLite({ base: join(nativeConfig.cacheDir, "sessions") }) };

export default {
  ...nativeConfig,
  outDir: fileURLToPath(new URL("dist/", stateRoot)),
  cacheDir: fileURLToPath(new URL("astro/", stateRoot)),
  session,
  vite: {
    ...nativeConfig.vite,
    cacheDir: fileURLToPath(new URL("vite/", stateRoot)),
    // Package source is outside the fixture root, which Vite does not watch by default.
    plugins: [...(nativeConfig.vite.plugins ?? []), { name: "shipit-admin-source-watch", configureServer(server) { server.watcher.add(packageSource); } }],
    resolve: { ...nativeConfig.vite.resolve, alias: [adminSource, ...nativeConfig.vite.resolve.alias] },
  },
};
