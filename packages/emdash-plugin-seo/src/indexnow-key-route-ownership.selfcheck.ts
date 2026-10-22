import assert from "node:assert/strict";
import { settleIndexNowKeyRoute } from "./indexnow-integration.ts";

const own = { patternRegex: /^\/indexnow-key\.txt\/?$/, entrypoint: "shipit-route" };
const other = { patternRegex: /^\/indexnow-key\.txt\/?$/, entrypoint: "site-route" };
const isShipit = (entrypoint: string) => entrypoint === "shipit-route";
assert.equal(settleIndexNowKeyRoute("injected", [own, other], isShipit), "injected");
assert.equal(settleIndexNowKeyRoute("injected", [other, own], isShipit), "existing");
assert.equal(settleIndexNowKeyRoute("injected", [{patternRegex:/^\/indexnow-key\.txt\/$/}, own], isShipit), "existing");
assert.equal(settleIndexNowKeyRoute("injected", [{patternRegex:/^\/.*$/,entrypoint:"rest-route"}, own], isShipit), "existing");
assert.equal(settleIndexNowKeyRoute("injected", [], isShipit), "unavailable");
assert.equal(settleIndexNowKeyRoute("injected", [{patternRegex:/^\/elsewhere$/}], isShipit), "unavailable");
assert.equal(settleIndexNowKeyRoute("existing", [], isShipit), "existing");
assert.equal(settleIndexNowKeyRoute("unavailable", [own], isShipit), "unavailable");
console.log("IndexNow resolved key ownership selfcheck passed (8 cases).");
