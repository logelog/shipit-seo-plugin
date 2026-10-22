import assert from "node:assert/strict";
import { SEO_ADMIN_CONTRACT_VERSION, SEO_ENGINE_VERSION } from "@shipitseo/emdash-plugin-seo/admin-contract";
import { parseSeoAdminSocialOverrideReadResult, parseSeoAdminSocialOverrideSaveResult } from "./contract.ts";

const ref = "posts:one";
const request = { ref, title: "Saved title", description: "Saved description" };
const snapshot = { ref, revision: "revision-one", override: { storageVersion: 1, ref,
	title: request.title, description: request.description, updatedAt: "2026-10-15T10:00:00.000Z" } };
const envelope = { contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION };
const saved = { ...envelope, success: true, ref, outcome: "saved", snapshot };
const read = { ...envelope, success: true, ref, snapshot };
assert.equal(parseSeoAdminSocialOverrideSaveResult(saved, request).success, true);
assert.equal(parseSeoAdminSocialOverrideSaveResult({ ...saved, outcome: "unchanged" }, request).success, true);
assert.equal(parseSeoAdminSocialOverrideReadResult(read, ref).success, true);
for (const revision of [undefined, "", 1, "x".repeat(129)]) {
	assert.throws(() => parseSeoAdminSocialOverrideReadResult({ ...read, snapshot: { ...snapshot, revision } }, ref), /socialOverride.snapshot/);
}
assert.throws(() => parseSeoAdminSocialOverrideReadResult({ ...read, snapshot: { ...snapshot, override: null } }, ref), /socialOverride.snapshot/);
assert.throws(() => parseSeoAdminSocialOverrideReadResult({ ...read, snapshot: { ...snapshot, revision: null } }, ref), /socialOverride.snapshot/);
assert.throws(() => parseSeoAdminSocialOverrideReadResult({ ...read, ref: "posts:other" }, ref), /socialOverride.requestedRef/);
assert.throws(() => parseSeoAdminSocialOverrideReadResult({ ...read, snapshot: { ...snapshot, ref: "posts:legacy-slug" } }, ref), /socialOverride.snapshot/);
assert.throws(() => parseSeoAdminSocialOverrideReadResult({ ...read, snapshot: { ...snapshot, override: { ...snapshot.override, ref: "posts:other" } } }, ref), /socialOverride.snapshot/);
assert.throws(() => parseSeoAdminSocialOverrideSaveResult(saved, { ...request, ref: "posts:other" }), /socialOverride.requestedRef/);
assert.throws(() => parseSeoAdminSocialOverrideSaveResult(saved, { ...request, title: "Another draft" }), /socialOverride.submittedValues/);
assert.throws(() => parseSeoAdminSocialOverrideSaveResult({ ...saved, preview: {} , outcome: undefined }, request), /socialOverride.outcome/);
const cleared = { ...saved, snapshot: { ref, revision: null, override: null } };
assert.equal(parseSeoAdminSocialOverrideSaveResult(cleared, { ref, title: "", description: "" }).success, true);
assert.throws(() => parseSeoAdminSocialOverrideSaveResult(cleared, request), /socialOverride.submittedValues/);
for (const error of ["record_invalid", "storage_unavailable", "conflict"]) {
	assert.equal(parseSeoAdminSocialOverrideSaveResult({ ...envelope, success: false, ref, outcome: "rejected", error }, request).success, false);
}
assert.equal(parseSeoAdminSocialOverrideSaveResult({ ...envelope, success: false, ref, outcome: "unconfirmed", error: "unconfirmed" }, request).success, false);
assert.throws(() => parseSeoAdminSocialOverrideSaveResult({ ...envelope, success: false, ref, outcome: "rejected", error: "unconfirmed" }, request), /socialOverride.outcome/);
assert.throws(() => parseSeoAdminSocialOverrideReadResult({ ...envelope, success: false, ref, error: "conflict" }, ref), /socialOverride.error/);
assert.throws(() => parseSeoAdminSocialOverrideSaveResult({ ...saved, contractVersion: SEO_ADMIN_CONTRACT_VERSION - 1 }, request), /contractVersion/);
console.log("Social wire identity, acknowledgement and unavailable-state checks passed.");
