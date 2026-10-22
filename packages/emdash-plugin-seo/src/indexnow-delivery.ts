import type { PluginContext } from "emdash";
import { INDEXNOW_ENDPOINT } from "./indexnow.ts";

export const INDEXNOW_DELIVERY_TIMEOUT_MS = 10_000;

export class IndexNowDeliveryTimeoutError extends Error {
	constructor() {
		super("The IndexNow request timed out. Acceptance could not be confirmed; the provider may have received these URLs. A retry may submit them again.");
		this.name = "IndexNowDeliveryTimeoutError";
	}
}

function leaseAbortError(): DOMException {
	return new DOMException("IndexNow delivery stopped because queue ownership was lost.", "AbortError");
}

function cancelUnusedResponse(response: Response): void {
	try {
		void response.body?.cancel().catch(() => {});
	} catch {
		// Response cleanup cannot delay or replace the delivery outcome.
	}
}

export async function requestIndexNowDelivery(
	ctx: PluginContext,
	payload: unknown,
	leaseSignal?: AbortSignal,
): Promise<Response> {
	if (leaseSignal?.aborted) throw leaseAbortError();
	if (!ctx.http) throw new Error("IndexNow network access is unavailable.");
	const controller = new AbortController();
	let rejectAbort!: (reason: Error) => void;
	const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
	// A host may throw during dispatch after synchronously losing the lease.
	void aborted.catch(() => {});
	const abort = (reason: Error) => {
		if (controller.signal.aborted) return;
		rejectAbort(reason);
		controller.abort(reason);
	};
	const onLeaseAbort = () => abort(leaseAbortError());
	leaseSignal?.addEventListener("abort", onLeaseAbort, { once: true });
	const timer = setTimeout(
		() => abort(new IndexNowDeliveryTimeoutError()),
		INDEXNOW_DELIVERY_TIMEOUT_MS,
	);
	try {
		const request = ctx.http.fetch(INDEXNOW_ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				Accept: "application/json, text/plain, */*",
			},
			body: JSON.stringify(payload),
			signal: controller.signal,
		});
		// Headers carry the outcome; late responses still need body cleanup.
		void request.then(cancelUnusedResponse, () => {});
		const response = await Promise.race([request, aborted]);
		if (controller.signal.aborted) throw controller.signal.reason;
		return response;
	} catch (error: unknown) {
		if (leaseSignal?.aborted) throw leaseAbortError();
		throw error;
	} finally {
		clearTimeout(timer);
		leaseSignal?.removeEventListener("abort", onLeaseAbort);
	}
}
