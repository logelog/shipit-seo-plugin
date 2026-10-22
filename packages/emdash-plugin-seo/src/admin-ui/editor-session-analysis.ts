import {
	SEO_SCORE_VERSION,
	type SeoAdminContentScore,
	type SeoAdminEntryAnalysisIdentity,
	type SeoAdminEntryAnalysisIdentityResult,
} from "@shipitseo/emdash-plugin-seo/admin-contract";
import { savedContentVersion } from "./saved-content-snapshot.ts";

export interface EditorSessionAnalysisOptions {
	keywords: readonly string[] | null;
	pillar: boolean | null;
}

export interface EditorSessionAnalysisState {
	score: SeoAdminContentScore | null;
	savedVersion: string | null;
	analysisOptions?: EditorSessionAnalysisOptions;
	pending: boolean;
	error: string | null;
}

export const editorSavedVersion = savedContentVersion;
const cacheLimit = 100;
const scoreCache = new Map<string, SeoAdminContentScore>();

function copyAnalysisOptions(value: EditorSessionAnalysisOptions): EditorSessionAnalysisOptions {
	return { keywords: value.keywords === null ? null : [...value.keywords], pillar: value.pillar };
}

/**
 * A session result describes the current analyzer and configuration only when
 * every recorded input equals the identity the engine reads now.
 */
export function sessionScoreMatchesIdentity(
	score: Pick<SeoAdminContentScore, "scoreVersion" | "configurationFingerprint" | "templateUpdatedAt" | "modulesUpdatedAt" | "metaOverrideUpdatedAt" | "entryInputFingerprint">,
	identity: SeoAdminEntryAnalysisIdentity,
): boolean {
	return score.scoreVersion === SEO_SCORE_VERSION &&
		identity.scoreVersion === SEO_SCORE_VERSION &&
		typeof score.entryInputFingerprint === "string" &&
		score.entryInputFingerprint === identity.entryInputFingerprint &&
		score.configurationFingerprint === identity.configurationFingerprint &&
		score.templateUpdatedAt === identity.templateUpdatedAt &&
		score.modulesUpdatedAt === identity.modulesUpdatedAt &&
		score.metaOverrideUpdatedAt === identity.metaOverrideUpdatedAt;
}

/** The engine's row read now is the saved version the result analyzed, in the expected locale. */
export function sessionScoreBoundToEntry(
	score: Pick<SeoAdminContentScore, "sourceVersion">,
	identity: SeoAdminEntryAnalysisIdentity,
	expected: { savedVersion: string; locale?: string | null },
): boolean {
	return typeof score.sourceVersion === "string" &&
		identity.sourceVersion === score.sourceVersion &&
		identity.sourceVersion === expected.savedVersion &&
		(expected.locale === undefined || expected.locale === null || identity.locale === expected.locale);
}

export function editorSessionScoreForSavedVersion(
	score: SeoAdminContentScore | null,
	savedUpdatedAt: string | null,
	analyzedVersion?: string | null,
	currentVersion?: string,
): SeoAdminContentScore | null {
	return score && (score.sourceUpdatedAt !== savedUpdatedAt ||
		(currentVersion !== undefined && analyzedVersion !== currentVersion))
		? { ...score, freshness: "stale" }
		: score;
}

type RunMode = "force" | "auto" | "resume" | "revalidate";

export function createEditorSessionAnalysis(options: {
	ref: string;
	savedUpdatedAt: string | null;
	savedVersion?: string;
	/** The entry's locale; a reused result must come from a row in this locale. */
	locale?: string | null;
	analysisOptions?: EditorSessionAnalysisOptions;
	analyze: (ref: string, signal: AbortSignal, analysisOptions: EditorSessionAnalysisOptions) => Promise<SeoAdminContentScore>;
	/**
	 * Reads the engine's current identity for this entry without analyzing.
	 * Without it a cached result is never reused and a fresh result is not
	 * checked again after it arrives.
	 */
	currentIdentity?: (ref: string, signal: AbortSignal) => Promise<SeoAdminEntryAnalysisIdentityResult>;
	onChange: (state: EditorSessionAnalysisState) => void;
}) {
	let savedUpdatedAt = options.savedUpdatedAt;
	let savedVersion = options.savedVersion ?? savedUpdatedAt ?? "";
	let analysisOptions = copyAnalysisOptions(options.analysisOptions ?? { keywords: null, pillar: null });
	let enabled = false;
	let active: { controller: AbortController; key: string; mode: RunMode; promise: Promise<void> } | null = null;
	let lastAttemptKey: string | null = null;
	// The last accepted or reused result, the inputs it belongs to, and whether
	// the engine has confirmed it since anything could have changed.
	let result: SeoAdminContentScore | null = null;
	let resultKey: string | null = null;
	let resultSavedVersion: string | null = null;
	let resultOptions: EditorSessionAnalysisOptions | undefined;
	let confirmed = false;
	const currentKey = () => JSON.stringify([options.ref, savedVersion, savedUpdatedAt, analysisOptions.keywords, analysisOptions.pillar]);
	const view = (): SeoAdminContentScore | null => {
		if (!result) return null;
		const current = confirmed && resultKey === currentKey() && result.sourceUpdatedAt === savedUpdatedAt &&
			resultSavedVersion === savedVersion;
		return current ? result : { ...result, freshness: "stale" };
	};
	const emit = (pending: boolean, error: string | null) => {
		options.onChange({
			score: view(),
			savedVersion: resultSavedVersion,
			...(resultOptions ? { analysisOptions: copyAnalysisOptions(resultOptions) } : {}),
			pending,
			error,
		});
	};
	const matchesSavedContent = (score: SeoAdminContentScore) => score.ref === options.ref &&
		score.sourceUpdatedAt === savedUpdatedAt &&
		(score.sourceVersion === undefined || score.sourceVersion === savedVersion) && score.freshness === "current";
	const confirmedBy = (score: SeoAdminContentScore, answer: SeoAdminEntryAnalysisIdentityResult | null) =>
		Boolean(answer?.success && sessionScoreMatchesIdentity(score, answer.identity) &&
			sessionScoreBoundToEntry(score, answer.identity, { savedVersion, locale: options.locale }));
	const keep = (score: SeoAdminContentScore, key: string, isConfirmed: boolean) => {
		result = score;
		resultKey = key;
		resultSavedVersion = savedVersion;
		resultOptions = copyAnalysisOptions(analysisOptions);
		confirmed = isConfirmed;
	};
	// A failed or unreadable identity read confirms nothing.
	const readIdentity = (signal: AbortSignal) => options.currentIdentity
		? options.currentIdentity(options.ref, signal).catch(() => null)
		: Promise.resolve(null);
	const cancelActive = () => {
		if (active) {
			active.controller.abort();
			if (lastAttemptKey === active.key && active.mode !== "revalidate") lastAttemptKey = null;
		}
		active = null;
	};
	const run = (mode: RunMode): Promise<void> => {
		const key = currentKey();
		if (mode === "revalidate") {
			if (!options.currentIdentity || !result || resultKey !== key || active) return Promise.resolve();
		} else {
			if (mode !== "resume") enabled = true;
			if (mode !== "force" && active?.key === key && active.mode !== "revalidate") return active.promise;
			if (mode !== "force" && lastAttemptKey === key) return Promise.resolve();
		}
		const cachedCandidate = mode === "auto" || mode === "resume" ? scoreCache.get(key) : undefined;
		const cached = cachedCandidate && matchesSavedContent(cachedCandidate) && options.currentIdentity
			? cachedCandidate
			: undefined;
		if (mode === "resume" && !cached) return Promise.resolve();
		cancelActive();
		if (mode !== "revalidate") lastAttemptKey = key;
		const controller = new AbortController();
		const requestedOptions = copyAnalysisOptions(analysisOptions);
		const superseded = () => controller.signal.aborted || active?.controller !== controller || currentKey() !== key;
		let resolve!: () => void;
		let reject!: (error: unknown) => void;
		const promise = new Promise<void>((settle, fail) => { resolve = settle; reject = fail; });
		active = { controller, key, mode, promise };
		// No current claim while the engine has not confirmed the result.
		if (mode === "revalidate") confirmed = false;
		emit(mode !== "revalidate", null);
		void (async () => {
			try {
				if (mode === "revalidate") {
					const answer = await readIdentity(controller.signal);
					if (superseded()) return;
					confirmed = confirmedBy(result!, answer);
					emit(false, null);
					return;
				}
				if (cached) {
					const answer = await readIdentity(controller.signal);
					if (superseded()) return;
					if (confirmedBy(cached, answer)) {
						scoreCache.delete(key);
						scoreCache.set(key, cached);
						keep(structuredClone(cached), key, true);
						enabled = true;
						emit(false, null);
						return;
					}
					scoreCache.delete(key);
					if (mode === "resume") {
						emit(false, null);
						return;
					}
				}
				const score = await options.analyze(options.ref, controller.signal, requestedOptions);
				if (superseded()) return;
				if (!matchesSavedContent(score)) {
					throw new Error("Saved content changed during analysis. Recheck this entry.");
				}
				// A response held back while settings or the entry changed must not become current.
				if (options.currentIdentity) {
					const answer = await readIdentity(controller.signal);
					if (superseded()) return;
					if (!confirmedBy(score, answer)) {
						keep(score, key, false);
						emit(false, "Settings or saved content changed during analysis, or could not be confirmed. Refresh analysis.");
						return;
					}
				}
				scoreCache.set(key, structuredClone(score));
				if (scoreCache.size > cacheLimit) scoreCache.delete(scoreCache.keys().next().value!);
				keep(score, key, true);
				emit(false, null);
			} catch (error) {
				if (controller.signal.aborted || active?.controller !== controller) return;
				// A failed refresh keeps the last result only as an unconfirmed snapshot.
				confirmed = false;
				emit(false, error instanceof Error ? error.message : "Analysis failed. Try again.");
			} finally {
				if (active?.controller === controller) active = null;
			}
		})().then(resolve, reject);
		return promise;
	};
	return {
		start: () => run("auto"),
		/**
		 * One explicit analysis. New inputs passed here replace the current ones
		 * without starting an automatic run first, so one call sends one request.
		 */
		analyze: (nextOptions?: EditorSessionAnalysisOptions) => {
			if (nextOptions && JSON.stringify(copyAnalysisOptions(nextOptions)) !== JSON.stringify(analysisOptions)) {
				analysisOptions = copyAnalysisOptions(nextOptions);
				cancelActive();
				lastAttemptKey = null;
			}
			return run("force");
		},
		/** Reuses a cached result for these inputs after the engine confirms it; never analyzes. */
		resume: () => run("resume"),
		/** Confirms the shown result again; it is not current until the answer arrives. */
		revalidate: () => run("revalidate"),
		cancel() {
			enabled = false;
			const running = active !== null;
			cancelActive();
			// A cancelled run must not leave the panel waiting on it.
			if (running) emit(false, null);
		},
		/** Withdraws the current claim of the shown result without a request, for example after a failed read. */
		invalidate() {
			if (!result || !confirmed) return;
			confirmed = false;
			emit(active !== null && active.mode !== "revalidate", null);
		},
		/** Whether these are already the analysis inputs, so nothing needs cancelling. */
		hasAnalysisOptions(next: EditorSessionAnalysisOptions): boolean {
			return JSON.stringify(copyAnalysisOptions(next)) === JSON.stringify(analysisOptions);
		},
		updateSavedVersion(nextUpdatedAt: string | null, nextVersion = nextUpdatedAt ?? ""): Promise<void> | undefined {
			if (nextUpdatedAt === savedUpdatedAt && nextVersion === savedVersion) return;
			savedUpdatedAt = nextUpdatedAt;
			savedVersion = nextVersion;
			cancelActive();
			lastAttemptKey = null;
			emit(false, null);
			if (enabled) return run("auto");
		},
		updateAnalysisOptions(next: EditorSessionAnalysisOptions): Promise<void> | undefined {
			const nextOptions = copyAnalysisOptions(next);
			if (JSON.stringify(nextOptions) === JSON.stringify(analysisOptions)) return;
			analysisOptions = nextOptions;
			cancelActive();
			lastAttemptKey = null;
			emit(false, null);
			if (enabled) return run("auto");
		},
	};
}
