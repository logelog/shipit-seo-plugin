import { createPluginCoexistenceMiddleware } from "./plugin-coexistence-middleware.ts";

export const onRequest = createPluginCoexistenceMiddleware();
