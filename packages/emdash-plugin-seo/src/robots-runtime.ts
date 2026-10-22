// The admin route behind the Robots.txt editor. It reports build-time
// ownership facts and the origin EmDash core falls back to; the text itself
// is read and saved through EmDash's own settings endpoint.
import {
	SEO_ADMIN_CONTRACT_VERSION,
	SEO_ENGINE_VERSION,
	type SeoAdminRobotsTxtFacts,
} from "./admin-contract.ts";
import type { RobotsInstallation } from "./robots-installation.ts";
import { robotsConfiguredOrigin } from "./robots-txt.ts";

type Environment = Readonly<Record<string, string | undefined>>;

// Core reads the same variables from `process.env` in the same process.
function processEnvironment(): Environment | undefined {
	const env = (globalThis as { process?: { env?: unknown } }).process?.env;
	return env && typeof env === "object" ? env as Environment : undefined;
}

export function buildRobotsTxtFacts(
	installation: RobotsInstallation | null,
	env: Environment | undefined = processEnvironment(),
): SeoAdminRobotsTxtFacts {
	const common = { contractVersion: SEO_ADMIN_CONTRACT_VERSION, engineVersion: SEO_ENGINE_VERSION } as const;
	if (!installation) {
		return { ...common, owner: "not-installed", ownerDetail: null, hostVersion: null, configuredOrigin: null, configuredOriginKnown: false };
	}
	return {
		...common,
		owner: installation.owner,
		ownerDetail: installation.detail,
		hostVersion: installation.hostVersion,
		configuredOrigin: robotsConfiguredOrigin(installation.emdashSiteUrl, env),
		configuredOriginKnown: true,
	};
}
