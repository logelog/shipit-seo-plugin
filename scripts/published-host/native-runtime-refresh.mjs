import { lstatSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";

export async function preflightNativeRuntimeRefresh(environment, { checkPort = assertPreviewPortAvailable } = {}) {
  if (!["native-1.1.0", "native-1.2.0", "native-1.3.0"].includes(environment?.target?.name)) throw new Error("Runtime-only refresh requires the native-1.1.0, native-1.2.0 or native-1.3.0 target");
  await environment.assertVersions();
  await checkPort(environment.target.port);
}

export function assertPreviewPortAvailable(port, { createProbe = createServer, timeoutMs = 2_000, timers = globalThis } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) {
    throw new TypeError("Invalid native preview port probe");
  }
  return new Promise((resolve, reject) => {
    const probe = createProbe();
    const controller = new AbortController();
    let settled = false;
    let timeout = null;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (timeout !== null) timers.clearTimeout(timeout);
      if (error) {
        controller.abort();
        try { probe.close(() => {}); } catch {}
        reject(error);
      } else resolve();
    };
    probe.on("connection", (socket) => socket.destroy());
    probe.once("error", (error) => finish(new Error(`Native preview port ${port} is unavailable; stop the preview before refreshing`, { cause: error })));
    probe.once("listening", () => {
      try { probe.close((error) => finish(error ? new Error("Native preview port probe did not close", { cause: error }) : null)); }
      catch (error) { finish(error); }
    });
    timeout = timers.setTimeout(() => finish(new Error("Native preview port probe timed out")), timeoutMs);
    try { probe.listen({ host: "127.0.0.1", port, signal: controller.signal }); }
    catch (error) { finish(error); }
  });
}

export function writeRuntimeAdminEntry(packageRoot) {
  for (const name of ["admin.js", "admin.css"]) {
    const file = new URL(`dist/admin-ui/${name}`, packageRoot);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size === 0) throw new Error(`Missing compiled admin output: ${file.pathname}`);
  }
  writeFileSync(new URL("dist/admin-ui/admin-entry.js", packageRoot),
    'import "./admin.css";\nexport * from "./admin.js";\n');
}
