import assert from "node:assert/strict";
import { SEO_SCORE_VERSION, analyzeSeoContent } from "./analysis.ts";
import { currentSeoScoreAssessmentProblem } from "./score-result-validation.ts";

const assessment = analyzeSeoContent({
	ref: "pages:assessment-example", collection: "pages", entryId: "assessment-example",
	slug: "assessment-example", title: "Saved example title", description: "Saved example description.",
	url: "https://example.test/assessment-example", body: "", document: [],
	image: "https://example.test/social.png", imageSeoEnabled: true, noindex: false, schemaEnabled: false, schemaPreset: "",
	assessmentProfile: { profile: "general", version: 1 }, publicationStatus: "published",
});
assert.equal(assessment.scoreVersion, SEO_SCORE_VERSION);
assert.equal(currentSeoScoreAssessmentProblem(assessment), null);
const original = JSON.stringify(assessment);
assert.equal(currentSeoScoreAssessmentProblem({ ...assessment, score: assessment.score === 100 ? 99 : assessment.score + 1 }), "score");
assert.equal(currentSeoScoreAssessmentProblem({ ...assessment, status: assessment.status === "pass" ? "fail" : "pass" }), "status");
assert.equal(currentSeoScoreAssessmentProblem({ ...assessment, grade: "excellent" }), "grade");
for (const key of ["earnedWeight", "totalWeight", "rawScore", "score", "reviewCredit"] as const) {
	const calculation = { ...assessment.calculation, [key]: assessment.calculation[key] + 1 };
	assert.equal(currentSeoScoreAssessmentProblem({ ...assessment, calculation }), "calculation." + key);
}
assert.equal(currentSeoScoreAssessmentProblem({
	...assessment, calculation: { ...assessment.calculation, limit: { reason: "high-failure", cap: 49, checkIds: ["title"] } },
}), "calculation.limit", "current uncapped calculations cannot carry a legacy cap");
for (const key of ["evaluated", "measured", "heuristic", "unavailable", "notApplicable", "unweighted"] as const) {
	const coverage = { ...assessment.coverage, [key]: assessment.coverage[key] + 1 };
	assert.equal(currentSeoScoreAssessmentProblem({ ...assessment, coverage }), "coverage." + key);
}
assert.equal(currentSeoScoreAssessmentProblem({ ...assessment, checks: [] }), "checks.aggregate");
assert.equal(currentSeoScoreAssessmentProblem({
	...assessment, checks: [...assessment.checks, assessment.checks[0]],
}), "checks.aggregate", "duplicate valid rows cannot inflate eligibility");
for (const id of ["title", "description"]) {
	assert.equal(currentSeoScoreAssessmentProblem({
		...assessment, checks: assessment.checks.filter((check) => check.id !== id),
	}), "checks.aggregate", "mandatory metadata must be represented even when missing");
	const unavailable = assessment.checks.map((check) => check.id === id
		? { ...check, basis: "unavailable", severity: "info", weight: 0, status: "review" } : check);
	assert.equal(currentSeoScoreAssessmentProblem({ ...assessment, checks: unavailable }), "checks.aggregate");
}
assert.equal(currentSeoScoreAssessmentProblem({
	...assessment, checks: assessment.checks.filter((check) => check.weight === 0),
}), "checks.aggregate", "zero eligible evidence is not a numeric current assessment");
assert.equal(currentSeoScoreAssessmentProblem({
	...assessment, checks: assessment.checks.map((check) => check.id === "title" ? { ...check, weight: check.weight + 1 } : check),
}), "checks.row");
assert.equal(currentSeoScoreAssessmentProblem({
	...assessment, checks: assessment.checks.map((check) => check.id === "title" ? { ...check, evidence: { ...check.evidence, actual: "copied metadata text" } } : check),
}), "checks.row", "presence evidence is boolean in current scores");
assert.equal(currentSeoScoreAssessmentProblem({
	...assessment, checks: assessment.checks.map((check) => check.id === "title" ? { ...check, condition: null } : check),
}), "checks.row");
assert.equal(currentSeoScoreAssessmentProblem({ ...assessment, scoreVersion: SEO_SCORE_VERSION - 1 }), "scoreVersion");
const missingTitle = analyzeSeoContent({
	ref: "pages:missing-title", collection: "pages", entryId: "missing-title", slug: "missing-title",
	title: "", description: "Saved description.", url: "https://example.test/missing-title",
	body: "", document: [], image: "https://example.test/social.png", noindex: false, schemaEnabled: false, schemaPreset: "",
	assessmentProfile: { profile: "general", version: 1 },
});
assert.equal(currentSeoScoreAssessmentProblem(missingTitle), null,
	"a genuine failing assessment remains valid; validation does not require a passing score");
assert.equal(missingTitle.status, "fail");
assert.equal(JSON.stringify(assessment), original, "validation never mutates or rewrites evidence");
console.log("Current score assessment validation: aggregate, duplicates, mandatory evidence, calculation and coverage passed.");
