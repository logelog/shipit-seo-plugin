import {
	duplicateSchemaDefinitionIds,
	schemaDefinitionIdentities,
} from "./lib.ts";

export type SeoSchemaSuppressionReason =
	| "duplicate-definition"
	| "entity-conflict"
	| "duplicate-contribution";

export interface SeoSchemaResolutionState {
	claimedContributionIds: Set<string>;
	claimedEntityIds: Set<string>;
}

export interface SeoSchemaResolution {
	emitted: boolean;
	reason: SeoSchemaSuppressionReason | null;
	conflictId: string | null;
}

export function createSeoSchemaResolutionState(): SeoSchemaResolutionState {
	return {
		claimedContributionIds: new Set<string>(),
		claimedEntityIds: new Set<string>(),
	};
}

export function resolveSeoSchemaCandidate(
	state: SeoSchemaResolutionState,
	id: string,
	graph: unknown,
): SeoSchemaResolution {
	const duplicateDefinitions = duplicateSchemaDefinitionIds(graph);
	if (duplicateDefinitions.length > 0) {
		return {
			emitted: false,
			reason: "duplicate-definition",
			conflictId: duplicateDefinitions[0] ?? null,
		};
	}

	const identities = schemaDefinitionIdentities(graph);
	const entityConflict = identities.find((entityId) =>
		state.claimedEntityIds.has(entityId),
	);
	if (entityConflict) {
		return {
			emitted: false,
			reason: "entity-conflict",
			conflictId: entityConflict,
		};
	}

	if (state.claimedContributionIds.has(id)) {
		return {
			emitted: false,
			reason: "duplicate-contribution",
			conflictId: id,
		};
	}

	for (const entityId of identities) state.claimedEntityIds.add(entityId);
	state.claimedContributionIds.add(id);
	return { emitted: true, reason: null, conflictId: null };
}
