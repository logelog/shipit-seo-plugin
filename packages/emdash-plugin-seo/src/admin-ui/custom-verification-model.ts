import type { SeoAdminReadableSettings, SeoAdminSettings } from "../admin-contract.ts";
import { isStoredCustomVerificationTags, validateCustomVerificationTags, type CustomVerificationTag } from "../custom-verification-tags.ts";

export type CustomVerificationSnapshot = Pick<SeoAdminReadableSettings, "revision" | "legacyGuard"> & { tags: CustomVerificationTag[] };
export interface CustomVerificationState {
	owner: string | null;
	snapshot: CustomVerificationSnapshot | null;
	draft: CustomVerificationTag[];
	editVersion: number;
	busy: "idle" | "read" | "save";
	pending: "none" | "saving" | "uncertain";
	review: CustomVerificationSnapshot | null;
	needsReload: boolean;
	message: string;
	error: string;
}
interface Ticket { id: number; owner: string | null; epoch: number; editVersion: number; kind: "reload" | "check" | "save" }
interface Attempt { ticket: Ticket; tags: CustomVerificationTag[] }
const copyTags = (tags: readonly CustomVerificationTag[]) => tags.map((tag) => ({ ...tag }));
export const sameCustomVerificationTags = (a: readonly CustomVerificationTag[], b: readonly CustomVerificationTag[]) =>
	JSON.stringify(a) === JSON.stringify(b);


/** The same attribute escapes used by the host metadata renderer. */
export function customVerificationTagText(tag: CustomVerificationTag): string {
	const escapes: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
	const escape = (value: string) => value.replace(/[&<>"']/g, (character) => escapes[character] ?? character);
	return '<meta name="' + escape(tag.name) + '" content="' + escape(tag.content) + '">';
}

export function customVerificationSnapshot(settings: SeoAdminSettings): CustomVerificationSnapshot | null {
	if (!settings.values) return null;
	const tags = settings.values.customVerificationTags ?? [];
	if (!isStoredCustomVerificationTags(tags)) return null;
	return { tags: copyTags(tags), revision: settings.revision, legacyGuard: settings.legacyGuard };
}

export function customVerificationDirty(state: CustomVerificationState): boolean {
	return state.snapshot !== null && !sameCustomVerificationTags(state.draft, state.snapshot.tags);
}

export function createCustomVerificationModel() {
	let state: CustomVerificationState = { owner: null, snapshot: null, draft: [], editVersion: 0, busy: "idle",
		pending: "none", review: null, needsReload: false, message: "", error: "" };
	let epoch = 0, sequence = 0;
	let active: Ticket | null = null;
	let attempt: Attempt | null = null;
	const listeners = new Set<() => void>();
	const update = (patch: Partial<CustomVerificationState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
	const owns = (ticket: Ticket) => ticket.epoch === epoch && ticket.owner === state.owner;
	const ticket = (kind: Ticket["kind"]): Ticket => ({ id: ++sequence, epoch, owner: state.owner, editVersion: state.editVersion, kind });
	const settleForeign = () => update({ busy: "idle", pending: attempt ? "uncertain" : "none", needsReload: true,
		error: "An earlier save finished. Read the saved tags before continuing." });
	return {
		current: () => state,
		subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
		owner(owner: string | null) {
			if (owner === state.owner) return;
			epoch += 1;
			active = null;
			update({ owner, snapshot: null, draft: [], editVersion: 0, review: null, message: "", error: "",
				busy: attempt?.ticket.kind === "save" && state.pending === "saving" ? "save" : "idle",
				pending: attempt ? state.pending : "none", needsReload: Boolean(attempt) });
		},
		edit(tags: CustomVerificationTag[]) {
			if (!state.snapshot || state.owner === null) return;
			update({ draft: copyTags(tags), editVersion: state.editVersion + 1, message: "", error: "" });
		},
		beginRead(kind: "reload" | "check"): Ticket | null {
			if (state.owner === null || state.busy !== "idle" || state.pending === "saving" ||
				(kind === "reload" && state.pending === "uncertain") || (kind === "check" && state.pending !== "uncertain")) return null;
			const next = ticket(kind); active = next; update({ busy: "read", error: "" }); return next;
		},
		readFailed(token: Ticket) {
			if (!owns(token) || active?.id !== token.id) return;
			active = null;
			update({ busy: "idle", error: "Saved tags could not be read. Your draft is kept; try the read again." });
		},
		read(token: Ticket, snapshot: CustomVerificationSnapshot) {
			if (!owns(token) || active?.id !== token.id) return;
			active = null;
			const dirty = customVerificationDirty(state);
			const changed = state.snapshot !== null && !sameCustomVerificationTags(state.snapshot.tags, snapshot.tags);
			const checking = token.kind === "check" && attempt !== null;
			const matches = checking && sameCustomVerificationTags(attempt!.tags, snapshot.tags);
			const unchangedDraft = checking && state.editVersion === attempt!.ticket.editVersion;
			if (checking) attempt = null;
			if (checking && !matches || dirty && changed && !matches) {
				update({ busy: "idle", pending: "none", review: snapshot, needsReload: false, message: "",
					error: "Saved tags differ. Review the saved version before another save." });
				return;
			}
			update({ busy: "idle", pending: "none", snapshot, review: null, needsReload: false,
				draft: !dirty || unchangedDraft ? copyTags(snapshot.tags) : state.draft,
				message: matches ? "Current saved tags match the submitted values." : dirty ? "Saved tags reloaded. Your draft is kept." : "Saved tags loaded.",
				error: "" });
		},
		resolve(useSaved: boolean) {
			if (!state.review || state.busy !== "idle" || state.pending !== "none") return;
			update({ snapshot: state.review, review: null, needsReload: false,
				draft: useSaved ? copyTags(state.review.tags) : state.draft,
				editVersion: state.editVersion + 1, message: useSaved ? "Using the saved tags." : "Your draft is kept against the reviewed revision.", error: "" });
		},
		discard() {
			if (!state.snapshot || state.busy !== "idle" || state.pending !== "none" || state.review || state.needsReload) return;
			update({ draft: copyTags(state.snapshot.tags), editVersion: state.editVersion + 1, error: "", message: "Draft discarded." });
		},
		beginSave(): { ticket: Ticket; tags: CustomVerificationTag[]; loaded: CustomVerificationSnapshot } | null {
			const validation = validateCustomVerificationTags(state.draft);
			if (!state.owner || !state.snapshot || !customVerificationDirty(state) || state.busy !== "idle" ||
				state.pending !== "none" || state.review || state.needsReload || !validation.success) return null;
			const next = ticket("save");
			attempt = { ticket: next, tags: copyTags(validation.tags) };
			update({ busy: "save", pending: "saving", message: "", error: "" });
			return { ticket: next, tags: copyTags(validation.tags), loaded: state.snapshot };
		},
		saved(token: Ticket, snapshot: CustomVerificationSnapshot) {
			if (attempt?.ticket.id !== token.id) return;
			if (!sameCustomVerificationTags(attempt.tags, snapshot.tags)) { this.uncertain(token); return; }
			attempt = null;
			if (!owns(token)) { settleForeign(); return; }
			update({ snapshot, busy: "idle", pending: "none", review: null, needsReload: false,
				draft: state.editVersion === token.editVersion ? copyTags(snapshot.tags) : state.draft,
				message: "Custom tags saved. Finish verification with the service.", error: "" });
		},
		refused(token: Ticket, message: string, conflict: boolean) {
			if (attempt?.ticket.id !== token.id) return;
			attempt = null;
			if (!owns(token)) { settleForeign(); return; }
			update({ busy: "idle", pending: "none", needsReload: conflict, message: "", error: message });
		},
		uncertain(token: Ticket) {
			if (attempt?.ticket.id !== token.id) return;
			if (!owns(token)) { settleForeign(); return; }
			update({ busy: "idle", pending: "uncertain", needsReload: true, message: "",
				error: "Save not confirmed. Read the saved tags before trying another save." });
		},
	};
}
