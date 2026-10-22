import { Button } from "@cloudflare/kumo/components/button";
import { Loader } from "@cloudflare/kumo/components/loader";
import { ArrowCounterClockwise, FloppyDisk } from "@phosphor-icons/react";
import type * as React from "react";

export interface SettingsActionBarProps {
	status: React.ReactNode;
	statusTone?: "default" | "error";
	/** The page's own restore trigger and confirmation; it always sits at the left. */
	restore?: React.ReactNode;
	discardLabel?: string;
	discardDisabled: boolean;
	onDiscard: () => void;
	saveLabel: string;
	saveDisabled: boolean;
	saving?: boolean;
	/** Without a handler the button submits the enclosing form. */
	onSave?: () => void;
}

/**
 * Restore at the left; status, Discard and the primary Save at the right, in that order.
 * Discard and Save turn unavailable as they are pressed, and a disabled button drops the focus
 * it holds to the page body, so they are only aria-disabled and their click refuses instead.
 */
export function SettingsActionBar({
	status,
	statusTone = "default",
	restore,
	discardLabel = "Discard changes",
	discardDisabled,
	onDiscard,
	saveLabel,
	saveDisabled,
	saving = false,
	onSave,
}: SettingsActionBarProps) {
	const saveUnavailable = saveDisabled || saving;
	return (
		<div className="shipit-seo-action-bar">
			<div className="shipit-seo-action-bar__restore">{restore}</div>
			<div className="shipit-seo-action-bar__commit">
				<p role="status" className={statusTone === "error" ? "shipit-seo-form-error" : undefined}>{status}</p>
				<div className="shipit-seo-action-bar__buttons">
					<Button type="button" variant="secondary" icon={ArrowCounterClockwise} aria-disabled={discardDisabled || undefined}
						onClick={() => { if (!discardDisabled) onDiscard(); }}>
						{discardLabel}
					</Button>
					<Button
						type={onSave ? "button" : "submit"}
						variant="primary"
						// Kumo's loader is labelled "Loading" in English, which would join the Save label; the status line reports the save.
						icon={saving ? <span aria-hidden="true" style={{ display: "inline-flex" }}><Loader size={14} /></span> : FloppyDisk}
						aria-disabled={saveUnavailable || undefined}
						onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
							// Also cancels the form submission that Enter in a field sends through this button.
							if (saveUnavailable) event.preventDefault();
							else onSave?.();
						}}
					>
						{saveLabel}
					</Button>
				</div>
			</div>
		</div>
	);
}
