import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";

const admin = new URL("../dist/admin-ui/admin.js", import.meta.url);
const types = new URL("../dist/admin-ui/admin.d.ts", import.meta.url);
const styles = new URL("../dist/admin-ui/admin.css", import.meta.url);

for (const file of [admin, types, styles]) {
  assert.equal(existsSync(file), true, `Missing compiled admin output: ${file.pathname}`);
}

writeFileSync(new URL("../dist/admin-ui/admin-entry.js", import.meta.url),
  'import "./admin.css";\nexport * from "./admin.js";\n');
