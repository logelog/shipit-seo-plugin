import {
	SEO_SCORE_INPUT_IDENTITY_TAG,
	SEO_SCORE_VERSION,
	type SeoAdminContentScore,
	type SeoAdminSavedAnalysisResult,
} from "@shipitseo/emdash-plugin-seo/admin-contract";

export interface SavedAnalysisReadbackTarget {
	ref: string;
	locale: string | null;
	savedVersion: string;
}

export type SavedAnalysisReadbackOutcome = "verified" | "changed" | "unavailable" | "superseded";

export interface SavedAnalysisReadbackState {
	target: SavedAnalysisReadbackTarget | null;
	score: SeoAdminContentScore | null;
	pending: boolean;
	failure: "changed" | "unavailable" | null;
}

type SavedAnalysisSuccess = Extract<SeoAdminSavedAnalysisResult, { success: true }>;

const inputIdentityPattern = new RegExp(`^${SEO_SCORE_INPUT_IDENTITY_TAG}-sha256-[0-9a-f]{64}$`);

function sameTarget(left: SavedAnalysisReadbackTarget, right: SavedAnalysisReadbackTarget): boolean {
	return left.ref === right.ref && left.locale === right.locale && left.savedVersion === right.savedVersion;
}

function durableScoreForTarget(score: SeoAdminContentScore, target: SavedAnalysisReadbackTarget): boolean {
	return score.persistence !== "session" && score.scoreVersion === SEO_SCORE_VERSION &&
		score.ref === target.ref && score.ref === `${score.collection}:${score.entryId}` &&
		score.sourceVersion === target.savedVersion && target.savedVersion.length > 0 &&
		Number.isSafeInteger(score.analysisRevision) && score.analysisRevision > 0 &&
		typeof score.inputIdentity === "string" && inputIdentityPattern.test(score.inputIdentity);
}

/** A proof belongs to the editor's exact saved entry and language, never a later mount or save. */
export function verifiedSavedAnalysisForTarget(
	state: SavedAnalysisReadbackState,
	target: SavedAnalysisReadbackTarget,
): SeoAdminContentScore | null {
	return state.target && sameTarget(state.target, target) && state.score?.freshness === "current" &&
		durableScoreForTarget(state.score, target) ? state.score : null;
}

/**
 * One explicit saved-analysis action, or the stored result found when the
 * editor loads, may be read back with server-verified freshness. This
 * controller never analyzes, retries or writes.
 */
export function createSavedAnalysisReadback(options: {
	read: (ref: string, signal: AbortSignal) => Promise<SeoAdminContentScore | null>;
	onChange: (state: SavedAnalysisReadbackState) => void;
	deadlineMs?: number;
}) {
	let generation = 0;
	let active: AbortController | null = null;
	const cancel = () => {
		generation += 1;
		active?.abort();
		active = null;
	};
	const emit = (
		target: SavedAnalysisReadbackTarget | null,
		score: SeoAdminContentScore | null,
		pending: boolean,
		failure: SavedAnalysisReadbackState["failure"] = null,
	) => options.onChange({ target, score, pending, failure });
	const check = async (
		ref: string,
		item: SeoAdminContentScore,
		requestedTarget: SavedAnalysisReadbackTarget,
		requestToken: number,
	): Promise<SavedAnalysisReadbackOutcome> => {
		if (requestToken !== generation) return "superseded";
		cancel();
		const target = { ...requestedTarget };
		if (ref !== target.ref || !durableScoreForTarget(item, target)) {
			emit(target, null, false, "changed");
			return "changed";
		}
		const request = generation;
		const controller = new AbortController();
		active = controller;
		let timedOut = false;
		const superseded = () => generation !== request || (controller.signal.aborted && !timedOut);
		let rejectAborted!: () => void;
		const aborted = new Promise<never>((_resolve, reject) => {
			rejectAborted = () => reject(new Error("Stored analysis verification was interrupted."));
		});
		controller.signal.addEventListener("abort", rejectAborted, { once: true });
		const deadline = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, options.deadlineMs ?? 15_000);
		emit(target, null, true);
		try {
			const score = await Promise.race([options.read(target.ref, controller.signal), aborted]);
			if (superseded()) return "superseded";
			if (!score || !durableScoreForTarget(score, target) || score.freshness !== "current" ||
				score.inputIdentity !== item.inputIdentity || score.analysisRevision !== item.analysisRevision) {
				emit(target, null, false, "changed");
				return "changed";
			}
			emit(target, score, false);
			return "verified";
		} catch {
			if (superseded()) return "superseded";
			emit(target, null, false, "unavailable");
			return "unavailable";
		} finally {
			clearTimeout(deadline);
			controller.signal.removeEventListener("abort", rejectAborted);
			if (active === controller) active = null;
		}
	};

	return {
		isCurrent: (requestToken: number): boolean => requestToken === generation,
		begin(): number {
			cancel();
			emit(null, null, false);
			return generation;
		},
		verify(result: SavedAnalysisSuccess, requestedTarget: SavedAnalysisReadbackTarget, requestToken: number): Promise<SavedAnalysisReadbackOutcome> {
			return check(result.ref, result.item, requestedTarget, requestToken);
		},
		/** A stored result read when the editor loads; the same freshness read decides whether it is shown. */
		confirmStored(score: SeoAdminContentScore, requestedTarget: SavedAnalysisReadbackTarget, requestToken: number): Promise<SavedAnalysisReadbackOutcome> {
			return check(score.ref, score, requestedTarget, requestToken);
		},
		invalidate() {
			cancel();
			emit(null, null, false);
		},
	};
}

export function savedAnalysisReadbackWarning(outcome: SavedAnalysisReadbackOutcome): string | null {
	if (outcome === "unavailable")
		return "The stored result could not be checked against the current saved content and settings. Current checks are unconfirmed.";
	if (outcome === "changed")
		return "The saved result could not be confirmed as the current analysis for this entry. Refresh checks to see current results.";
	return null;
}
