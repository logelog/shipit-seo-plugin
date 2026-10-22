// Presentation state for the Forwarded paths tab, derived only from the
// monitor contract. `enabled` is the capture setting: it does not show that the
// site forwards missing paths, so an empty list is never presented as success.
import type { SeoAdmin404Monitor } from "@shipitseo/emdash-plugin-seo/admin-contract";

export type ForwardedPathsState =
	| { kind: "off-empty" }
	| { kind: "on-empty" }
	| { kind: "records"; captureOff: boolean };

export function forwardedPathsState(
	monitor: Pick<SeoAdmin404Monitor, "enabled" | "items" | "summary">,
): ForwardedPathsState {
	const stored = monitor.items.length > 0 || monitor.summary.uniquePaths > 0;
	if (!stored) return { kind: monitor.enabled ? "on-empty" : "off-empty" };
	// Records stored before capture was turned off stay visible.
	return { kind: "records", captureOff: !monitor.enabled };
}
