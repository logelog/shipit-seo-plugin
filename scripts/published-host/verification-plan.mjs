const fullTargets = new Set(["native-1.3.0", "native-1.5.0"]);

export function hasFullVerificationPlan(targetName) {
  return fullTargets.has(targetName);
}

export function requireFullVerificationPlan(targetName) {
  if (!hasFullVerificationPlan(targetName)) {
    throw new Error(`Full verification has no implemented plan for ${targetName}; review and register its installed-package and SQLite checks before declaring full support.`);
  }
}

export function verificationImplementationErrors(policy) {
  const errors = [];
  for (const [name, target] of Object.entries(policy.targets)) {
    if (!target.verifyModes.includes("full")) continue;
    try { requireFullVerificationPlan(name); }
    catch (error) { errors.push(error.message); }
  }
  return errors;
}

export function fullVerificationPlan(targetName, { socialArchive, socialReceipt } = {}) {
  requireFullVerificationPlan(targetName);
  return [
    ["engine-build", "build-engine.mjs"],
    ["install-lifecycle", "install-lifecycle-smoke.mjs"],
    ["packed-single-plugin", "packed-single-seo.mjs"],
    ["npm-packed-plugin", "npm-packed-native.mjs"],
    ["social-save-recovery", "social-save-recovery-smoke.mjs", "--target", targetName,
      "--mode", "green", "--archive", socialArchive, "--receipt", socialReceipt],
    ["sqlite", "sqlite-smoke.mjs"],
    ["sitemap-sqlite", "sitemap-smoke.mjs"],
    ["robots-sqlite", "robots-smoke.mjs"],
    ["llms-sqlite", "llms-txt-smoke.mjs"],
    ["indexing-defaults-sqlite", "indexing-defaults-smoke.mjs"],
    ["taxonomy-archive-html", "taxonomy-archive-smoke.mjs"],
    ["schema-library-sqlite", "schema-library-smoke.mjs"],
    ["metadata-templates-sqlite", "metadata-templates-smoke.mjs"],
    ["publisher-ownership-sqlite", "publisher-ownership-smoke.mjs"],
    ["checklist-evidence-sqlite", "checklist-evidence-smoke.mjs"],
    ["saved-score-lifecycle-sqlite", "saved-score-lifecycle-smoke.mjs"],
    ["score-scan-source-sqlite", "score-scan-source-smoke.mjs", "--target", targetName],
    ["score-scan-lifecycle-sqlite", "score-scan-lifecycle-smoke.mjs"],
    ["content-health-readback-sqlite", "content-health-readback-smoke.mjs"],
    ["ownership-conflicts-sqlite", "ownership-conflicts-smoke.mjs"],
  ];
}
