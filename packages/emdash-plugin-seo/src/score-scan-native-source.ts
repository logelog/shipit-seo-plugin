import {
	SCORE_SCAN_CANDIDATE_BUDGET,
	SCORE_SCAN_EXPANDED_TERM_LIMIT,
	SCORE_SCAN_MATCH_BUDGET,
	SCORE_SCAN_SELECTED_TERM_LIMIT,
	SCORE_SCAN_TAXONOMY_LIMIT,
	SCORE_SCAN_TERM_PAGE_LIMIT,
	SCORE_SCAN_TERM_CURSOR_LIMIT,
	ScoreScanSelectionError,
	type ScoreScanResolvedTaxonomy,
	type ScoreScanSource,
	type ScoreScanSourceScope,
	type ScoreScanStatus,
} from "./score-scan-source.ts";

// The native EmDash 1.1.0 Kysely connection quotes identifiers and binds values.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HostDatabase = any;

interface Candidate {
	id: string;
	locale: string;
	translation_group: string | null;
	status: string;
	deleted_at: string | null;
}

const COLLECTION_KEY = /^[a-z][a-z0-9_]{0,62}$/;
const STATUSES: readonly string[] = ["all", "draft", "published", "scheduled"];

function textKey(value: unknown, label: string): asserts value is string {
	if (typeof value !== "string" || value.length === 0 || value.length > 256 ||
		value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
		throw new Error("Invalid " + label + ".");
	}
}

function collectionKey(value: unknown): asserts value is string {
	if (typeof value !== "string" || !COLLECTION_KEY.test(value)) {
		throw new Error("Invalid score scan collection key.");
	}
}

function allowedCollection(collection: string, allowed: readonly string[]): void {
	collectionKey(collection);
	if (!Array.isArray(allowed) || !allowed.includes(collection)) {
		throw new Error("Select an eligible collection for the score scan.");
	}
}

function localeKey(locale: unknown): asserts locale is string | null {
	if (locale === null) return;
	textKey(locale, "score scan locale");
	if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(locale)) throw new Error("Invalid score scan locale.");
}

function statusKey(status: unknown): asserts status is ScoreScanStatus {
	if (!STATUSES.includes(status as string)) throw new Error("Invalid score scan status.");
}

function positiveLimit(value: number, maximum: number, label: string): void {
	if (!Number.isInteger(value) || value < 1 || value > maximum) {
		throw new Error(label + " must be between 1 and " + maximum + ".");
	}
}

function validateSelection<T>(validate: () => T): T {
	try {
		return validate();
	} catch (error) {
		if (error instanceof Error) throw new ScoreScanSelectionError(error.message);
		throw error;
	}
}

function selectedTerms(selection: {
	taxonomy: string; termIds: readonly string[]; includeDescendants: boolean;
}): void {
	textKey(selection.taxonomy, "taxonomy");
	if (!Array.isArray(selection.termIds)) throw new Error("Select exact taxonomy term IDs.");
	positiveLimit(selection.termIds.length, SCORE_SCAN_SELECTED_TERM_LIMIT, "Selected terms per taxonomy");
	for (const id of selection.termIds) textKey(id, "taxonomy term ID");
	if (typeof selection.includeDescendants !== "boolean") throw new Error("Invalid descendant selection.");
}

function taxonomySelections(selections: readonly { taxonomy: string; termIds: readonly string[]; includeDescendants: boolean }[]): void {
	if (!Array.isArray(selections) || selections.length > SCORE_SCAN_TAXONOMY_LIMIT) {
		throw new Error("Select at most " + SCORE_SCAN_TAXONOMY_LIMIT + " taxonomies.");
	}
	const names = new Set<string>();
	for (const selection of selections) {
		if (!selection || typeof selection !== "object") throw new Error("Invalid taxonomy selection.");
		selectedTerms(selection);
		if (names.has(selection.taxonomy)) throw new Error("Combine terms in one selection per taxonomy.");
		names.add(selection.taxonomy);
	}
}

function validateScope(scope: ScoreScanSourceScope): void {
	collectionKey(scope.collection);
	statusKey(scope.status);
	localeKey(scope.locale);
	taxonomySelections(scope.taxonomies);
	if (scope.upperId !== null) textKey(scope.upperId, "score scan upper ID");
	let expanded = 0;
	for (const selection of scope.taxonomies) {
		if (!Array.isArray(selection.termGroups) || selection.termGroups.length === 0) {
			throw new Error("Resolve taxonomy term groups before scanning.");
		}
		for (const group of selection.termGroups) textKey(group, "taxonomy translation group");
		if (new Set(selection.termGroups).size !== selection.termGroups.length) {
			throw new Error("Resolved taxonomy groups must be deduplicated.");
		}
		expanded += selection.termGroups.length;
	}
	if (expanded > SCORE_SCAN_EXPANDED_TERM_LIMIT) expansionError();
}

function expansionError(ErrorType: new (message: string) => Error = Error): never {
	throw new ErrorType("The selected terms expand beyond " + SCORE_SCAN_EXPANDED_TERM_LIMIT +
		" term groups. Select fewer terms or turn off descendants.");
}

function content(db: HostDatabase, collection: string) {
	collectionKey(collection);
	return db.selectFrom("ec_" + collection).select(["id", "locale", "translation_group", "status", "deleted_at"]);
}

async function taxonomyDefinition(db: HostDatabase, collection: string, taxonomy: string): Promise<boolean> {
	textKey(taxonomy, "taxonomy");
	const row = await db.selectFrom("_emdash_taxonomy_defs as d")
		.leftJoin("_emdash_taxonomy_def_groups as g", "g.name", "d.name")
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		.select((eb: any) => [
			eb.fn.coalesce("g.collections", "d.collections").as("collections"),
			eb.fn.coalesce("g.hierarchical", "d.hierarchical").as("hierarchical"),
		])
		.where("d.name", "=", taxonomy)
		.orderBy("d.id")
		.limit(1)
		.executeTakeFirst() as { collections: string | null; hierarchical: number } | undefined;
	if (!row) throw new ScoreScanSelectionError('Taxonomy "' + taxonomy + '" is no longer available.');
	let collections: unknown;
	try {
		collections = JSON.parse(row.collections ?? "null");
	} catch {
		throw new Error('Taxonomy "' + taxonomy + '" has malformed collection attachments.');
	}
	if (!Array.isArray(collections) || !collections.every((value) => typeof value === "string")) {
		throw new Error('Taxonomy "' + taxonomy + '" has malformed collection attachments.');
	}
	if (row.hierarchical !== 0 && row.hierarchical !== 1) {
		throw new Error('Taxonomy "' + taxonomy + '" has malformed hierarchy settings.');
	}
	if (!collections.includes(collection)) throw new ScoreScanSelectionError('Taxonomy "' + taxonomy + '" is not attached to "' + collection + '".');
	return row.hierarchical === 1;
}

function rowMatches(scope: ScoreScanSourceScope, row: Candidate): boolean {
	textKey(row.id, "content ID");
	textKey(row.locale, "content locale");
	return row.deleted_at === null &&
		(scope.status === "all" || row.status === scope.status) &&
		(scope.locale === null || row.locale === scope.locale);
}

async function matchesTaxonomies(db: HostDatabase, scope: ScoreScanSourceScope, row: Candidate): Promise<boolean> {
	if (scope.taxonomies.length === 0) return true;
	if (row.translation_group === null) return false;
	textKey(row.translation_group, "content translation group");
	const groups = [...new Set(scope.taxonomies.flatMap((selection) => [...selection.termGroups]))];
	const memberships = await db.selectFrom("content_taxonomies")
		.select("taxonomy_id")
		.where("collection", "=", scope.collection)
		.where("entry_id", "=", row.translation_group)
		.where("taxonomy_id", "in", groups)
		.limit(groups.length)
		.execute() as { taxonomy_id: string }[];
	const assigned = new Set(memberships.map((membership) => membership.taxonomy_id));
	return scope.taxonomies.every((selection) => selection.termGroups.some((group) => assigned.has(group)));
}

function termCursor(collection: string, taxonomy: string, locale: string | null, search: string, afterId: string): string {
	return JSON.stringify(["score-scan-terms-v1", collection, taxonomy, locale, search, afterId]);
}

function readTermCursor(cursor: string | null, collection: string, taxonomy: string, locale: string | null, search: string): string | null {
	if (cursor === null) return null;
	if (typeof cursor !== "string" || cursor.length > SCORE_SCAN_TERM_CURSOR_LIMIT) throw new Error("Invalid term-option cursor.");
	let decoded: unknown;
	try {
		decoded = JSON.parse(cursor);
	} catch {
		throw new Error("Invalid term-option cursor.");
	}
	if (!Array.isArray(decoded) || decoded.length !== 6 || decoded[0] !== "score-scan-terms-v1" ||
		decoded[1] !== collection || decoded[2] !== taxonomy || decoded[3] !== locale || decoded[4] !== search) {
		throw new Error("The term-option cursor does not match this selection or search.");
	}
	textKey(decoded[5], "term-option cursor ID");
	return decoded[5];
}

export function createNativeScoreScanSource(db: HostDatabase): ScoreScanSource {
	return {
		async resolveScope(request, allowedCollectionKeys) {
			validateSelection(() => {
				allowedCollection(request.collection, allowedCollectionKeys);
				statusKey(request.status);
				localeKey(request.locale);
				taxonomySelections(request.taxonomies);
			});
			const taxonomies: ScoreScanResolvedTaxonomy[] = [];
			let expanded = 0;
			for (const selection of request.taxonomies) {
				const hierarchical = await taxonomyDefinition(db, request.collection, selection.taxonomy);
				if (selection.includeDescendants && !hierarchical) {
					throw new ScoreScanSelectionError('Taxonomy "' + selection.taxonomy + '" does not support descendants.');
				}
				const termIds = [...selection.termIds];
				const ids = [...new Set(termIds)];
				const rows = await db.selectFrom("taxonomies")
					.select(["id", "translation_group", "locale"])
					.where("name", "=", selection.taxonomy)
					.where("id", "in", ids)
					.limit(ids.length)
					.execute() as { id: string; translation_group: string | null; locale: string }[];
				if (rows.length !== ids.length) throw new ScoreScanSelectionError('A selected "' + selection.taxonomy + '" term is missing. Select its current term ID.');
				const seen = new Set<string>();
				for (const row of rows) {
					textKey(row.translation_group, "taxonomy translation group");
					textKey(row.locale, "taxonomy term locale");
					seen.add(row.translation_group);
				}
				expanded += seen.size;
				if (expanded > SCORE_SCAN_EXPANDED_TERM_LIMIT) expansionError(ScoreScanSelectionError);
				if (selection.includeDescendants) {
					let frontier = [...seen];
					while (frontier.length > 0) {
						const children = await db.selectFrom("taxonomies")
							.select("translation_group").distinct()
							.where("name", "=", selection.taxonomy)
							.where("parent_id", "in", frontier)
							// Cycles and translated term rows cannot consume the expansion budget.
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							.where((eb: any) => eb.or([
								eb("translation_group", "is", null),
								eb("translation_group", "not in", [...seen]),
							]))
							.limit(SCORE_SCAN_EXPANDED_TERM_LIMIT - expanded + 1)
							.execute() as { translation_group: string | null }[];
						frontier = [];
						for (const child of children) {
							textKey(child.translation_group, "descendant translation group");
							if (seen.has(child.translation_group)) continue;
							seen.add(child.translation_group);
							frontier.push(child.translation_group);
							if (++expanded > SCORE_SCAN_EXPANDED_TERM_LIMIT) expansionError(ScoreScanSelectionError);
						}
					}
				}
				taxonomies.push({
					taxonomy: selection.taxonomy, termIds, termGroups: [...seen].sort(),
					includeDescendants: selection.includeDescendants,
				});
			}
			const upper = await db.selectFrom("ec_" + request.collection).select("id")
				.orderBy("id", "desc").limit(1).executeTakeFirst() as { id: string } | undefined;
			if (upper) textKey(upper.id, "content upper ID");
			return {
				collection: request.collection, status: request.status, locale: request.locale,
				taxonomies, upperId: upper?.id ?? null,
			};
		},

		async page(scope, afterId, budget) {
			validateScope(scope);
			if (afterId !== null) textKey(afterId, "score scan cursor");
			positiveLimit(budget.candidateBudget, SCORE_SCAN_CANDIDATE_BUDGET, "Candidate budget");
			positiveLimit(budget.matchBudget, SCORE_SCAN_MATCH_BUDGET, "Match budget");
			if (scope.upperId === null) {
				return { references: [], nextAfterId: afterId, exhausted: true, fetchedCandidates: 0, examinedCandidates: 0, matchedReferences: 0 };
			}
			// The ID window is bounded before any live membership predicate.
			let query = content(db, scope.collection).where("id", "<=", scope.upperId);
			if (afterId !== null) query = query.where("id", ">", afterId);
			const rows = await query.orderBy("id").limit(budget.candidateBudget).execute() as Candidate[];
			const references = [];
			let examinedCandidates = 0;
			let nextAfterId = afterId;
			for (const row of rows) {
				examinedCandidates++;
				nextAfterId = row.id;
				if (!rowMatches(scope, row)) continue;
				if (!await matchesTaxonomies(db, scope, row)) continue;
				references.push({ collection: scope.collection, id: row.id, locale: row.locale, afterId: row.id });
				if (references.length === budget.matchBudget) break;
			}
			let exhausted = examinedCandidates === rows.length &&
				(rows.length < budget.candidateBudget || nextAfterId === scope.upperId);
			if (!exhausted && examinedCandidates === rows.length) {
				// This ID-only sentinel is fetched separately and is never consumed.
				const sentinel = await db.selectFrom("ec_" + scope.collection).select("id")
					.where("id", ">", nextAfterId).where("id", "<=", scope.upperId)
					.orderBy("id").limit(1).executeTakeFirst();
				exhausted = sentinel === undefined;
			}
			return {
				references, nextAfterId, exhausted, fetchedCandidates: rows.length,
				examinedCandidates, matchedReferences: references.length,
			};
		},

		async revalidate(scope, reference) {
			validateScope(scope);
			textKey(reference.id, "content reference ID");
			textKey(reference.locale, "content reference locale");
			if (reference.collection !== scope.collection || reference.afterId !== reference.id) {
				throw new Error("The content reference does not match its score scan.");
			}
			const row = await content(db, scope.collection).where("id", "=", reference.id)
				.limit(1).executeTakeFirst() as Candidate | undefined;
			if (!row) return "missing";
			if (scope.upperId === null) return "no-longer-matching";
			const withinBoundary = await db.selectFrom("ec_" + scope.collection).select("id")
				.where("id", "=", reference.id).where("id", "<=", scope.upperId)
				.limit(1).executeTakeFirst();
			if (!withinBoundary || row.locale !== reference.locale || !rowMatches(scope, row)) return "no-longer-matching";
			return await matchesTaxonomies(db, scope, row) ? "matching" : "no-longer-matching";
		},

		async termOptions(request, allowedCollectionKeys) {
			const { search, afterId } = validateSelection(() => {
				allowedCollection(request.collection, allowedCollectionKeys);
				textKey(request.taxonomy, "taxonomy");
				localeKey(request.locale);
				positiveLimit(request.limit, SCORE_SCAN_TERM_PAGE_LIMIT, "Term-option limit");
				if (typeof request.search !== "string" || request.search.length > 256 || /[\u0000-\u001f\u007f]/.test(request.search)) {
					throw new Error("Invalid term-option search.");
				}
				const search = request.search.trim();
				return { search, afterId: readTermCursor(request.cursor, request.collection, request.taxonomy, request.locale, search) };
			});
			await taxonomyDefinition(db, request.collection, request.taxonomy);
			let query = db.selectFrom("taxonomies").select(["id", "translation_group", "label", "locale"])
				.where("name", "=", request.taxonomy);
			if (request.locale !== null) query = query.where("locale", "=", request.locale);
			if (afterId !== null) query = query.where("id", ">", afterId);
			if (search !== "") {
				// Native SQLite substring search keeps '%' and '_' literal.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				query = query.where((eb: any) => eb.or([
					eb(eb.fn("instr", [eb.fn("lower", ["label"]), eb.fn("lower", [eb.val(search)])]), ">", 0),
					eb(eb.fn("instr", [eb.fn("lower", ["slug"]), eb.fn("lower", [eb.val(search)])]), ">", 0),
				]));
			}
			const rows = await query.orderBy("id").limit(request.limit + 1).execute() as {
				id: string; translation_group: string | null; label: string; locale: string;
			}[];
			const terms = rows.slice(0, request.limit).map((row) => {
				textKey(row.id, "taxonomy term ID");
				textKey(row.translation_group, "taxonomy translation group");
				textKey(row.locale, "taxonomy term locale");
				if (typeof row.label !== "string") throw new Error("Invalid taxonomy term label.");
				return { id: row.id, translationGroup: row.translation_group, label: row.label, locale: row.locale };
			});
			return {
				terms,
				nextCursor: rows.length > request.limit
					? termCursor(request.collection, request.taxonomy, request.locale, search, terms[terms.length - 1].id)
					: null,
			};
		},
	};
}
