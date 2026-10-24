import type { PluginContext } from "emdash";
import { SEO_ADMIN_INDEXNOW_STORAGE_VERSION, type SeoAdminIndexNowSetupStep } from "./admin-contract.ts";
import { supportsConditionalStorage } from "./conditional-storage.ts";
import {
	INDEXNOW_DEFAULT_KEY_LOCATION,
	UNKNOWN_INDEXNOW_INSTALLATION,
	createIndexNowKey,
	defaultIndexNowSettings,
	indexNowSetupIssue,
	type IndexNowInstallation,
} from "./indexnow.ts";
import {
	hasVersionedIndexNowSettings,
	nextIndexNowSettingsUpdatedAt,
	readVersionedIndexNowSettings,
	resumeVerifiedIndexNowQueue,
	withIndexNowQueueLease,
	writeVersionedIndexNowSettings,
	type StoredIndexNowSettings,
} from "./indexnow-runtime.ts";
import { IndexNowSetupError, indexNowVerificationUrl, readExistingIndexNowKey, verifyIndexNowKey } from "./indexnow-verification.ts";
import type { OperationLeaseOwner } from "./operation-lease.ts";

function settingsChanged(step: SeoAdminIndexNowSetupStep): never {
	throw new IndexNowSetupError("IndexNow settings changed during setup. Refresh the saved settings and try again.", step);
}

async function setupIndexNowUnlocked(
	ctx: PluginContext,
	expectedUpdatedAt: string | null,
	getSiteUrl: () => Promise<string>,
	installation: IndexNowInstallation,
	owner: OperationLeaseOwner,
): Promise<StoredIndexNowSettings> {
	if (!hasVersionedIndexNowSettings(ctx) ||
		!supportsConditionalStorage(ctx.storage.operationLeases) ||
		!supportsConditionalStorage(ctx.storage.indexnowJobs))
		throw new IndexNowSetupError("Automatic setup requires EmDash 0.38 or later with conditional storage.", "origin");
	if (!ctx.http) throw new IndexNowSetupError("IndexNow requires network access from the host.", "origin");
	const snapshot = await readVersionedIndexNowSettings(ctx);
	if ((snapshot.settings?.updatedAt ?? null) !== expectedUpdatedAt) settingsChanged("origin");
	const siteUrl = await getSiteUrl();
	const issue = indexNowSetupIssue(installation, siteUrl);
	if (issue) throw new IndexNowSetupError(issue.description, "origin");
	const stored = snapshot.settings?.values ?? defaultIndexNowSettings();
	// A site that was never turned on starts without automatic submission; a
	// site that was on before keeps its saved choice when it is verified again.
	const activatedBefore = stored.enabled || snapshot.settings?.verification !== undefined;
	const values = { ...stored, autoSubmit: activatedBefore ? stored.autoSubmit : false };
	const pendingSetup = snapshot.settings?.pendingSetup;
	const resumesGeneratedKey = pendingSetup?.siteOrigin === new URL(siteUrl).origin;
	const adoptExistingKey = (!stored.apiKey || resumesGeneratedKey) && !activatedBefore &&
		installation.mode === "astro" && installation.keyRoute === "existing" &&
		values.keyLocation === INDEXNOW_DEFAULT_KEY_LOCATION;
	values.apiKey ||= createIndexNowKey();
	const verificationUrl = indexNowVerificationUrl(values, siteUrl);
	let revision = snapshot.revision;
	let updatedAt = snapshot.settings?.updatedAt ?? null;

	// The public file must expose the key before verification; delivery stays off for a new key.
	if (!snapshot.settings?.values.apiKey) {
		if (!(await owner.renew())) throw new IndexNowSetupError("IndexNow setup lost queue ownership. Refresh and try again.", "key");
		const pending: StoredIndexNowSettings = {
			version: SEO_ADMIN_INDEXNOW_STORAGE_VERSION,
			updatedAt: nextIndexNowSettingsUpdatedAt(updatedAt),
			values: { ...values, enabled: false },
			...(adoptExistingKey ? { pendingSetup: {
				siteOrigin: new URL(siteUrl).origin, apiKey: values.apiKey,
				keyLocation: INDEXNOW_DEFAULT_KEY_LOCATION,
			} } : {}),
		};
		revision = await writeVersionedIndexNowSettings(ctx, revision, pending);
		if (revision === null) settingsChanged("key");
		updatedAt = pending.updatedAt;
	}
	const verification = adoptExistingKey
		? await readExistingIndexNowKey(ctx, values, siteUrl)
		: await verifyIndexNowKey(ctx, values, siteUrl);
	if (adoptExistingKey) values.apiKey = verification.apiKey;
	if (indexNowVerificationUrl(values, await getSiteUrl()) !== verificationUrl)
		throw new IndexNowSetupError("The website address changed during setup. Refresh the settings and try again.", "verify");
	if (!(await owner.renew())) throw new IndexNowSetupError("IndexNow setup lost queue ownership. Refresh and try again.", "enable");
	const next: StoredIndexNowSettings = {
		version: SEO_ADMIN_INDEXNOW_STORAGE_VERSION,
		updatedAt: nextIndexNowSettingsUpdatedAt(updatedAt),
		values: { ...values, enabled: true },
		verification,
	};
	// The checked key, location and all delivery settings must still be the same revision.
	if (await writeVersionedIndexNowSettings(ctx, revision, next) === null) settingsChanged("enable");
	// Waiting URLs of a site that was on before resume with the verified key.
	try {
		await resumeVerifiedIndexNowQueue(ctx, owner);
	} catch {
		throw new IndexNowSetupError("The key was verified, but pending URLs could not be scheduled. Process the queue manually or verify again to resume automatic delivery.", "enable");
	}
	return next;
}

export async function setupIndexNow(
	ctx: PluginContext,
	expectedUpdatedAt: string | null,
	getSiteUrl: () => Promise<string>,
	options: { installation?: IndexNowInstallation } = {},
): Promise<StoredIndexNowSettings> {
	const installation = options.installation ?? UNKNOWN_INDEXNOW_INSTALLATION;
	const leased = await withIndexNowQueueLease(ctx, (owner) =>
		setupIndexNowUnlocked(ctx, expectedUpdatedAt, getSiteUrl, installation, owner));
	if (leased.acquired) return leased.value;
	throw new IndexNowSetupError("IndexNow setup could not retain queue ownership. Refresh and try again.", "origin");
}
