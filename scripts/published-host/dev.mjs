import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { childEnvironment, createEnvironment, parseOptions, sourceRoot } from "./environment.mjs";

const options = parseOptions(process.argv.slice(2));
if (options.quick) throw new Error("--quick applies only to verification");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 24 || minor < 19) throw new Error("Use Node >=24.19.0 <25 for the published-host dev app");
const environment = createEnvironment(options.hostPath ?? fileURLToPath(options.target.fixtureRoot), options.target);
environment.assertVersions();
const child = spawn(process.execPath, [fileURLToPath(new URL("serve.mjs", import.meta.url))], {
  cwd: fileURLToPath(sourceRoot), env: childEnvironment(environment), stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
child.once("error", error => { console.error(error.message); process.exitCode = 1; });
child.once("exit", (code, signal) => { process.exitCode = code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1); });
