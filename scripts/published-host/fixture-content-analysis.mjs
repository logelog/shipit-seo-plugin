import assert from "node:assert/strict";

/** Explicit resource acknowledgement for disposable native fixtures. */
export async function setFixtureContentAnalysis(call, enabled) {
	const loaded = (await call("admin-settings", {})).data;
	const result = await call("save-content-scoring", {
		contentScoringEnabled: enabled,
		expectedContentScoringEnabled: loaded.values.contentScoringEnabled,
		expectedRevision: loaded.revision,
		...(loaded.revision === null ? { expectedLegacyGuard: loaded.legacyGuard } : {}),
		...(enabled ? { resourceNoticeVersion: loaded.contentScoring.currentNoticeVersion } : {}),
	});
	assert.equal(result.data.success, true, JSON.stringify(result.data));
	return result.data;
}

export async function setFixtureAssessmentProfile(call, collection, profile) {
	const loaded = (await call("admin-analysis-profile", { collection })).data;
	assert.notEqual(loaded.selection.state, "unavailable");
	const result = await call("save-analysis-profile", { collection, profile, expectedRevision: loaded.selection.revision });
	assert.equal(result.data.success, true, JSON.stringify(result.data));
	return result.data;
}
