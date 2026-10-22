// Sandboxed entry for the registry build. It is bundled into one self-contained
// backend file, so import only modules that stay free of route wiring and zod.
import type { SandboxedPlugin } from "emdash/plugin";

import { seoOverviewRoutes } from "./registry-panel.ts";

export default { routes: seoOverviewRoutes } satisfies SandboxedPlugin;
