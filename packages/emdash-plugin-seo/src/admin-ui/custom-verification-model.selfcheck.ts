import assert from "node:assert/strict";
import type { SeoAdminSettings } from "../admin-contract.ts";
import { createCustomVerificationModel, customVerificationDirty, customVerificationSnapshot, customVerificationTagText, type CustomVerificationSnapshot } from "./custom-verification-model.ts";


assert.equal(
	customVerificationTagText({ name: "service-verification", content: 'token"&\'x' }),
	'<meta name="service-verification" content="token&quot;&amp;&#39;x">',
	"copyable saved tags escape quotes and ampersands exactly as the public renderer",
);

const a = [{ name: "service-verification", content: "first-code" }];
const b = [{ name: "service-verification", content: "second-code" }];
const c = [{ name: "service-verification", content: "newer-draft" }];
const snap = (tags = a, revision = "r1"): CustomVerificationSnapshot => ({ tags: structuredClone(tags), revision, legacyGuard: null });
function loaded() {
	const model = createCustomVerificationModel();
	model.owner("admin-a:50");
	const read = model.beginRead("reload")!;
	assert.ok(read);
	model.read(read, snap());
	return model;
}

assert.equal(customVerificationSnapshot({ values: null } as SeoAdminSettings), null);
assert.equal(customVerificationSnapshot({ values: { customVerificationTags: [{ name: "robots", content: "noindex" }] } } as unknown as SeoAdminSettings), null);
assert.deepEqual(customVerificationSnapshot({ values: {}, revision: "old", legacyGuard: null } as unknown as SeoAdminSettings), { tags: [], revision: "old", legacyGuard: null });

{
	const model = loaded();
	model.edit(b);
	const operation = model.beginSave()!;
	assert.ok(operation);
	assert.equal(operation.loaded.revision, "r1");
	assert.deepEqual(operation.tags, b);
	assert.equal(model.beginSave(), null, "one conditional save at a time");
	model.owner("admin-a:50");
	assert.equal(model.beginSave(), null, "remounting the same owner cannot replay a pending save");
	model.edit(c);
	model.saved(operation.ticket, snap(b, "r2"));
	assert.deepEqual(model.current().snapshot?.tags, b);
	assert.deepEqual(model.current().draft, c, "a completed save does not erase edits made after submission");
	assert.equal(customVerificationDirty(model.current()), true);
}
{
	const model = loaded();
	model.edit(b);
	const operation = model.beginSave()!;
	model.uncertain(operation.ticket);
	assert.equal(model.current().pending, "uncertain");
	assert.equal(model.beginSave(), null);
	assert.equal(model.beginRead("reload"), null, "ordinary reload cannot bypass uncertain-outcome recovery");
	model.owner("admin-a:50");
	assert.equal(model.current().pending, "uncertain");
	const check = model.beginRead("check")!;
	assert.ok(check);
	model.readFailed(check);
	assert.equal(model.current().pending, "uncertain");
	assert.equal(model.beginSave(), null, "a failed recovery read never authorizes replay");
	const retry = model.beginRead("check")!;
	model.edit(c);
	model.read(retry, snap(b, "r2"));
	assert.equal(model.current().pending, "none");
	assert.deepEqual(model.current().draft, c);
	assert.deepEqual(model.current().snapshot?.tags, b);
	assert.equal(model.current().message, "Current saved tags match the submitted values.");
}
{
	const model = loaded();
	model.edit(b);
	const operation = model.beginSave()!;
	model.uncertain(operation.ticket);
	model.read(model.beginRead("check")!, snap(c, "r3"));
	assert.equal(model.beginSave(), null, "different readback needs an explicit reviewed baseline");
	assert.deepEqual(model.current().draft, b);
	assert.deepEqual(model.current().review?.tags, c);
	model.resolve(false);
	assert.deepEqual(model.current().draft, b);
	assert.equal(model.beginSave()?.loaded.revision, "r3");
}
{
	const model = loaded();
	model.edit(b);
	const operation = model.beginSave()!;
	model.refused(operation.ticket, "Settings changed.", true);
	assert.equal(model.beginSave(), null);
	model.read(model.beginRead("reload")!, snap(a, "neighbor-r2"));
	assert.deepEqual(model.current().draft, b, "reloading preserves a dirty draft");
	assert.equal(model.beginSave()?.loaded.revision, "neighbor-r2", "an observed unchanged tag value permits the new global revision");
}
{
	const model = loaded();
	model.edit(b);
	model.read(model.beginRead("reload")!, snap(c, "r3"));
	assert.deepEqual(model.current().draft, b);
	assert.equal(model.beginSave(), null);
	model.resolve(true);
	assert.deepEqual(model.current().draft, c);
	assert.equal(customVerificationDirty(model.current()), false);
}
{
	const model = loaded();
	const oldRead = model.beginRead("reload")!;
	model.owner("admin-b:50");
	model.read(oldRead, snap(b, "wrong-owner"));
	assert.equal(model.current().snapshot, null, "an earlier owner's read cannot populate another account");
}
{
	const model = loaded();
	model.edit(b);
	const operation = model.beginSave()!;
	model.owner("admin-b:50");
	assert.equal(model.current().snapshot, null);
	assert.equal(model.beginRead("reload"), null, "another owner cannot read a pre-settlement baseline during an in-flight write");
	model.saved(operation.ticket, snap(b, "r2"));
	assert.equal(model.current().snapshot, null, "a previous owner's acknowledgement never adopts its tags");
	assert.equal(model.current().needsReload, true);
	assert.equal(model.beginSave(), null);
	model.read(model.beginRead("reload")!, snap(c, "r3"));
	assert.deepEqual(model.current().snapshot?.tags, c);
}
{
	const model = loaded();
	model.edit([{ name: "robots", content: "noindex" }]);
	assert.equal(model.beginSave(), null, "invalid and reserved names cannot start a save");
	model.edit(b);
	const read = model.beginRead("reload")!;
	model.edit(c);
	model.read(read, snap());
	assert.deepEqual(model.current().draft, c, "a delayed ordinary read preserves newer edits");
	model.discard();
	assert.deepEqual(model.current().draft, a);
}
{
	const model = loaded();
	model.edit(b);
	const operation = model.beginSave()!;
	model.saved(operation.ticket, snap(c, "unexpected"));
	assert.equal(model.current().pending, "uncertain", "an acknowledgement with different tags cannot confirm the submitted write");
	assert.deepEqual(model.current().snapshot?.tags, a);
}
console.log("Custom verification owner and recovery self-check passed.");
