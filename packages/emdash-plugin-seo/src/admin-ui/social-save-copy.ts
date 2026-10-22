import type { SocialSaveNotice } from "./social-save-state.ts";

function rejectedMessage(error?: string): string {
	if (error === "title_too_long") return "The social title is too long; the change was not saved.";
	if (error === "description_too_long") return "The social description is too long; the change was not saved.";
	if (error === "not_found") return "This content entry no longer exists; the change was not saved.";
	if (error === "storage_unavailable") return "Social metadata storage is unavailable; the change was not saved.";
	return "The change was not saved.";
}

/**
 * An unconfirmed outcome is never described as unsaved or retried by copy;
 * "currently saved" names a matching readback, not the request that wrote it.
 */
export function socialSaveNoticeMessage(
	notice: SocialSaveNotice,
	newerDraft: boolean,
): string | null {
	if (!notice) return null;
	const draftKept = newerDraft ? " Your newer edits remain local." : "";
	switch (notice.kind) {
		case "saved":
			return `Social metadata saved.${draftKept}`;
		case "unchanged":
			return `The saved values already matched; nothing was written.${draftKept}`;
		case "current":
			return `The stored values match your submission; they are currently saved.${draftKept}`;
		case "rejected":
			return rejectedMessage(notice.error) + draftKept;
		case "conflict":
			return `Another change landed before this save. Your edits are kept; review the stored values before saving again.${draftKept}`;
		case "unconfirmed":
			return `The save result could not be confirmed; the values may already be stored. Check saved values shows the current record.${draftKept}`;
		case "recovery-unavailable":
			return `The saved record could not be read, so the result is still unknown. Check saved values tries again.${draftKept}`;
		case "review":
			return `The stored values differ from your edits. Your local changes are kept; review the stored values before saving again.${draftKept}`;
		case "rebased":
			return `Your local edits are kept; the stored record is now the baseline.${draftKept}`;
		case "loaded":
			return `The stored values were refreshed.${draftKept}`;
	}
}
