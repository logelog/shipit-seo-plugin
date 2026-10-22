import { Badge } from "@cloudflare/kumo/components/badge";
import { Button } from "@cloudflare/kumo/components/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { fetchSeoCollectionAnalysisProfile, saveSeoCollectionAnalysisProfile } from "./api.ts";
import { invalidateScoreData } from "./score-refresh.ts";

export const collectionAnalysisProfileKey = (collection: string) =>
	["shipit-seo", "collection-analysis-profile", collection] as const;

export function useCollectionAnalysisProfile(collection: string, enabled = true) {
	return useQuery({
		queryKey: collectionAnalysisProfileKey(collection),
		queryFn: ({ signal }) => fetchSeoCollectionAnalysisProfile(collection, { signal }),
		enabled: enabled && collection.length > 0,
		staleTime: 0,
		retry: false,
		refetchOnWindowFocus: false,
	});
}

type Selection = Awaited<ReturnType<typeof fetchSeoCollectionAnalysisProfile>>["selection"];
type Purpose = "article" | "general";

/** The badge names the saved state only while the selection shown is the saved one. */
export function assessmentProfileBadge(input: { baseline: Selection | null; dirty: boolean; pending: boolean }): {
	text: "Unsaved" | "Saved" | "Loading" | "Choose a profile"; variant: "secondary" | "outline";
} {
	if (input.baseline && input.dirty) return { text: "Unsaved", variant: "outline" };
	if (input.baseline?.state === "configured") return { text: "Saved", variant: "secondary" };
	return { text: input.pending ? "Loading" : "Choose a profile", variant: "outline" };
}

export function AssessmentProfileControl({
	collection, disabled = false, onChanged, onDraftChange,
}: {
	collection: string;
	disabled?: boolean;
	onChanged?: () => void;
	onDraftChange?: (dirty: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const query = useCollectionAnalysisProfile(collection);
	const [baseline, setBaseline] = React.useState<Selection | null>(null);
	const [draft, setDraft] = React.useState<Purpose | "">("");
	const [saving, setSaving] = React.useState(false);
	const [reloading, setReloading] = React.useState(false);
	const [mustReload, setMustReload] = React.useState(false);
	const inFlight = React.useRef(false);
	const selectRef = React.useRef<HTMLSelectElement>(null);
	const reloadRef = React.useRef<HTMLButtonElement>(null);
	const focusRecovery = React.useRef<{
		finish: (target: HTMLSelectElement | HTMLButtonElement | null) => void;
		cancel: () => void;
	} | null>(null);
	const [message, setMessage] = React.useState("");
	const [error, setError] = React.useState("");
	const baselineProfile = baseline?.state === "configured" ? baseline.profile : "";
	const dirty = draft !== baselineProfile;
	const badge = assessmentProfileBadge({ baseline, dirty, pending: query.isPending });
	const id = React.useId();
	React.useLayoutEffect(() => () => {
		focusRecovery.current?.cancel();
		focusRecovery.current = null;
	}, [collection]);
	React.useLayoutEffect(() => {
		if (saving || reloading) return;
		const recovery = focusRecovery.current;
		focusRecovery.current = null;
		recovery?.finish(error ? reloadRef.current : selectRef.current);
	}, [saving, reloading, error, collection]);
	React.useEffect(() => { onDraftChange?.(dirty); }, [dirty, onDraftChange]);

	React.useEffect(() => {
		if (!query.data || dirty || saving || reloading) return;
		setBaseline(query.data.selection);
		setDraft(query.data.selection.state === "configured" ? query.data.selection.profile : "");
	}, [query.data, dirty, saving, reloading]);

	const unavailable = query.isError || baseline?.state === "unavailable";
	const locked = disabled || saving || reloading || mustReload || query.isPending || unavailable || baseline === null;
	const beginFocusRecovery = (trigger: HTMLButtonElement) => {
		const owner = trigger.ownerDocument;
		if (owner.activeElement === trigger) {
			let moved = false;
			const cancel = () => { moved = true; };
			const trackFocus = (event: FocusEvent) => {
				if (event.target !== trigger && event.target !== owner.body) cancel();
			};
			const cleanup = () => {
				owner.removeEventListener("focusin", trackFocus, true);
				owner.removeEventListener("pointerdown", cancel, true);
				owner.removeEventListener("keydown", cancel, true);
			};
			owner.addEventListener("focusin", trackFocus, true);
			owner.addEventListener("pointerdown", cancel, true);
			owner.addEventListener("keydown", cancel, true);
			focusRecovery.current = {
				cancel: () => { cancel(); cleanup(); },
				finish: (target) => {
					cleanup();
					if (!moved && owner.hasFocus() && owner.activeElement === owner.body &&
						target?.isConnected && target.ownerDocument === owner && !target.disabled) target.focus();
				},
			};
		}
	};
	const reload = async (trigger: HTMLButtonElement) => {
		if (inFlight.current) return;
		inFlight.current = true;
		beginFocusRecovery(trigger);
		setReloading(true);
		try {
			const result = await query.refetch();
			if (!result.data || result.isError || result.data.selection.state === "unavailable") {
				if (result.data?.selection.state === "unavailable") setBaseline(result.data.selection);
				setError("The saved profile could not be loaded. Your selection is kept.");
				return;
			}
			setBaseline(result.data.selection);
			setDraft(dirty ? draft : result.data.selection.state === "configured" ? result.data.selection.profile : "");
			setError("");
			setMessage(dirty ? "Saved profile reloaded. Review your selection before saving again." : "");
			setMustReload(false);
		} catch {
			setError("The saved profile could not be loaded. Your selection is kept.");
		} finally {
			inFlight.current = false;
			setReloading(false);
		}
	};
	const save = async (trigger: HTMLButtonElement) => {
		if (locked || inFlight.current || !draft || !baseline) return;
		beginFocusRecovery(trigger);
		inFlight.current = true;
		const requestedCollection = collection;
		setSaving(true);
		setError("");
		setMessage("");
		try {
			const result = await saveSeoCollectionAnalysisProfile({
				collection: requestedCollection, profile: draft,
				expectedRevision: baseline.state === "configured" ? baseline.revision : null,
			});
			if (!result.success) {
				setMustReload(true);
				setError(result.error === "conflict"
					? "The saved profile changed. Reload it before saving your selection again."
					: "The profile could not be saved. Your selection is kept.");
				return;
			}
			if (result.selection.state !== "configured") {
				setMustReload(true);
				setError("The saved profile could not be confirmed. Reload it before trying again.");
				return;
			}
			setBaseline(result.selection);
			setDraft(result.selection.profile);
			queryClient.setQueryData(collectionAnalysisProfileKey(requestedCollection),
				{ ...query.data, selection: result.selection });
			setMessage("Profile saved. Existing results stay as recorded until you analyze again.");
			onChanged?.();
			void invalidateScoreData(queryClient);
		} catch {
			setMustReload(true);
			setError("The save could not be confirmed. Reload the saved profile before trying again.");
		} finally {
			inFlight.current = false;
			setSaving(false);
		}
	};

	return (
		<div className="shipit-seo-assessment-profile">
			<div className="shipit-seo-assessment-profile__heading">
				<label htmlFor={id}>Assessment profile</label>
				<Badge variant={badge.variant}>{badge.text}</Badge>
			</div>
			<p id={id + "-help"}>Choose the checks for this content type. Published schema stays unchanged.</p>
			<div className="shipit-seo-assessment-profile__controls">
				<select ref={selectRef} id={id} aria-describedby={id + "-help"} value={draft} disabled={locked}
					onChange={(event) => { setDraft(event.target.value as Purpose | ""); setError(""); setMessage(""); }}>
					<option value="">Choose a profile</option>
					<option value="article">Article</option>
					<option value="general">General content</option>
				</select>
				<Button type="button" size="sm" variant="secondary" loading={saving} data-keep-mobile-sidebar-open
					disabled={locked || !draft || !dirty} onClick={(event) => void save(event.currentTarget)}>Save profile</Button>
			</div>
			{draft ? <p>{draft === "article"
				? "Article checks include editorial structure and reading guidance."
				: "General content checks focus on metadata and supported page content."}</p> : null}
			{unavailable ? <p role="alert">The assessment profile is unavailable. Analysis stays off for this content type.</p> : null}
			{error ? <p className="shipit-seo-form-error" role="alert">{error}</p> : null}
			{message ? <p role="status">{message}</p> : null}
			{unavailable || error ? <Button ref={reloadRef} type="button" size="sm" variant="secondary" loading={reloading} disabled={saving || reloading} data-keep-mobile-sidebar-open
				onClick={(event) => void reload(event.currentTarget)}>Reload saved profile</Button> : null}
		</div>
	);
}
