export const SOCIAL_REQUEST_DEADLINE_MS = 15_000 as const;

export class SocialRequestTimeoutError extends Error {
	constructor() {
		super("The social request result could not be confirmed within 15 seconds. A save may already be stored; check saved values before saving again.");
		this.name = "SocialRequestTimeoutError";
	}
}

interface SocialRequestInternalOptions {
	/** Deterministic timer scheduling for self-checks; the production deadline stays fixed. */
	scheduleDeadline?: (expire: () => void, delayMs: number) => () => void;
}

function scheduleDeadline(expire: () => void, delayMs: number): () => void {
	const timer = globalThis.setTimeout(expire, delayMs);
	return () => globalThis.clearTimeout(timer);
}

/** Bound the complete operation, including response-body reads, without retrying it. */
export function runSocialRequest<T>(
	operation: (signal: AbortSignal) => Promise<T>,
	externalSignal?: AbortSignal,
	internalOptions: SocialRequestInternalOptions = {},
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const controller = new AbortController();
		let settled = false;
		let disposeTimer: (() => void) | undefined;
		const cleanup = () => {
			const dispose = disposeTimer;
			disposeTimer = undefined;
			try { dispose?.(); } catch { /* Timer disposal is best effort. */ }
			externalSignal?.removeEventListener("abort", onExternalAbort);
		};
		const settle = (success: boolean, value: unknown) => {
			if (settled) return;
			settled = true;
			cleanup();
			if (success) resolve(value as T);
			else reject(value);
		};
		const interrupt = (reason: unknown) => {
			if (settled) return;
			settle(false, reason);
			try { controller.abort(reason); } catch { /* Settlement does not depend on abort support. */ }
		};
		const onExternalAbort = () => {
			const reason = externalSignal?.reason;
			interrupt(reason === undefined
				? new DOMException("The social request result could not be confirmed.", "AbortError")
				: reason);
		};
		if (externalSignal?.aborted) {
			onExternalAbort();
			return;
		}
		externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
		if (externalSignal?.aborted) {
			onExternalAbort();
			return;
		}
		try {
			const dispose = (internalOptions.scheduleDeadline ?? scheduleDeadline)(() => {
				if (externalSignal?.aborted) onExternalAbort();
				else interrupt(new SocialRequestTimeoutError());
			}, SOCIAL_REQUEST_DEADLINE_MS);
			if (settled) dispose();
			else disposeTimer = dispose;
		} catch (error) {
			settle(false, error);
		}
		if (settled) return;
		try {
			// Both handlers remain attached after interruption, consuming late rejection.
			Promise.resolve(operation(controller.signal)).then(
				(value) => externalSignal?.aborted ? onExternalAbort() : settle(true, value),
				(error) => externalSignal?.aborted ? onExternalAbort() : settle(false, error),
			);
		} catch (error) {
			if (externalSignal?.aborted) onExternalAbort();
			else settle(false, error);
		}
	});
}
