// Native host assembly for the internal-link commands. A factory keeps only
// how to open the host database. Each command invocation gets fresh source,
// policy, candidate and target ports, and opens the database at most once,
// when a candidate or target port first needs it. A failed opening is not
// retried and no other connection is made.

import type { PluginContext } from "emdash";

import { createLinkHostPorts } from "./internal-link-host-ports.ts";
import { createNativeLinkCandidatePort } from "./internal-link-native-source.ts";
import { createNativeLinkTargetPort } from "./internal-link-native-target.ts";
import type { LinkCommandHost } from "./internal-link-routes.ts";
import type { LinkCandidatePort, LinkSuggestionPorts, LinkTargetPort } from "./internal-link-source.ts";

/**
 * `openDatabase` resolves the host's existing lazily opened database. The
 * returned factory is inert: it opens nothing until a command uses a port.
 */
export function createLinkNativeHostFactory(options: { openDatabase: () => Promise<unknown> }): LinkCommandHost {
	const openDatabase = options?.openDatabase;
	if (typeof openDatabase !== "function") throw new TypeError("The native link host needs a database opener.");
	return {
		open(ctx: PluginContext): LinkSuggestionPorts {
			// The policy observation the target port reads belongs to this invocation's host ports only.
			const host = createLinkHostPorts(ctx);
			let opened: Promise<{ candidates: LinkCandidatePort; targets: LinkTargetPort }> | null = null;
			const native = () => opened ??= (async () => {
				const db = await openDatabase();
				return {
					candidates: createNativeLinkCandidatePort(db),
					targets: createNativeLinkTargetPort({ db, ctx, policyObservation: host.policyObservation }),
				};
			})();
			return {
				source: host.source,
				policy: host.policy,
				candidates: {
					resolveScope: async (request, allowed) => (await native()).candidates.resolveScope(request, allowed),
					page: async (scope, afterId, budget) => (await native()).candidates.page(scope, afterId, budget),
				},
				targets: {
					readTarget: async (ref, scope, globalPolicyVersion) => (await native()).targets.readTarget(ref, scope, globalPolicyVersion),
				},
			};
		},
	};
}
