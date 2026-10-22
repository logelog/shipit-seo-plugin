import * as React from "react";
import { useCurrentUser } from "@emdash-cms/admin";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Input } from "@cloudflare/kumo/components/input";
import { Plus, Trash, WarningCircle } from "@phosphor-icons/react";
import { validateCustomVerificationTags } from "../custom-verification-tags.ts";
import { verificationRoleHints } from "../site-verification.ts";
import { fetchSeoAdminSettings, saveSeoCustomVerificationTags } from "./api.ts";
import { createCustomVerificationModel, customVerificationDirty, customVerificationSnapshot, customVerificationTagText } from "./custom-verification-model.ts";

// Pending and uncertain writes belong to this admin document, including view remounts.
const customTags = createCustomVerificationModel();

export function CustomVerificationView() {
	const user = useCurrentUser();
	const hints = verificationRoleHints({ status: user.status, role: user.data?.role });
	const actor = user.status === "success" && typeof user.data?.id === "string"
		? user.data.id + ":" + String(user.data.role) : null;
	const state = React.useSyncExternalStore(customTags.subscribe, customTags.current, customTags.current);
	const owned = actor !== null && state.owner === actor;
	const dirty = customVerificationDirty(state);
	const validation = validateCustomVerificationTags(state.draft);
	const editable = owned && hints.manage === "allowed" && state.snapshot !== null;
	const canSave = editable && dirty && validation.success && state.busy === "idle" &&
		state.pending === "none" && !state.review && !state.needsReload;

	async function read(kind: "reload" | "check") {
		const token = customTags.beginRead(kind);
		if (!token) return;
		try {
			const snapshot = customVerificationSnapshot(await fetchSeoAdminSettings());
			if (!snapshot) { customTags.readFailed(token); return; }
			customTags.read(token, snapshot);
		} catch {
			customTags.readFailed(token);
		}
	}
	React.useEffect(() => {
		customTags.owner(actor);
		if (actor !== null) void read("reload");
	}, [actor]);
	React.useEffect(() => {
		if (!owned || (!dirty && state.pending === "none" && !state.review)) return;
		const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [owned, dirty, state.pending, state.review]);

	async function save() {
		if (!canSave) return;
		const operation = customTags.beginSave();
		if (!operation) return;
		try {
			const result = await saveSeoCustomVerificationTags(operation.tags, operation.loaded);
			if (!result.success) {
				customTags.refused(operation.ticket, result.errors.customVerificationTags ?? result.errors._form ?? "The tags were not saved.", result.conflict === true);
				return;
			}
			const snapshot = customVerificationSnapshot(result.settings);
			if (!snapshot) { customTags.uncertain(operation.ticket); return; }
			customTags.saved(operation.ticket, snapshot);
		} catch {
			customTags.uncertain(operation.ticket);
		}
	}

	const title = <div className="shipit-seo-section-heading"><div><h2 id="seo-custom-verification-title">Custom verification tags</h2></div></div>;
	if (!owned) return <section className="shipit-seo-panel shipit-seo-verification-panel" aria-labelledby="seo-custom-verification-title">
		{title}<p className="shipit-seo-verification-copy">Waiting for your signed-in account before loading custom tags.</p>
	</section>;
	return (
		<section className="shipit-seo-panel shipit-seo-verification-panel shipit-seo-custom-verification" aria-labelledby="seo-custom-verification-title">
			{title}
			<p className="shipit-seo-verification-copy">Add the meta name and code supplied by another service. Save here, then finish verification with that service. Google and Bing use their own cards above.</p>
			{state.error ? <Banner role="alert" variant="alert" icon={<WarningCircle size={20} aria-hidden="true" />} title={state.error} /> : null}
			{state.pending === "saving" ? <p role="status">A custom-tags save is still running. Another save is blocked.</p> : null}
			{state.pending === "uncertain" ? <div className="shipit-seo-custom-verification__actions">
				<Button type="button" variant="secondary" loading={state.busy === "read"} disabled={state.busy !== "idle"} onClick={() => void read("check")}>Check saved tags</Button>
				<span>Reads the current tags without retrying the save.</span>
			</div> : null}
			{state.snapshot ? <>
				<div className="shipit-seo-custom-verification__rows">
					{state.draft.map((tag, index) => (
						<div className="shipit-seo-custom-verification__row" key={index} role="group" aria-label={"Custom tag " + (index + 1)}>
							<label><span>Meta name</span><Input value={tag.name} readOnly={!editable}
								onChange={(event) => customTags.edit(state.draft.map((row, position) => position === index ? { ...row, name: event.target.value } : row))}
								placeholder="service-verification" /></label>
							<label><span>Verification code</span><Input value={tag.content} readOnly={!editable} autoComplete="off"
								onChange={(event) => customTags.edit(state.draft.map((row, position) => position === index ? { ...row, content: event.target.value } : row))}
								placeholder="Code from the service" /></label>
							<Button type="button" variant="secondary" disabled={!editable} aria-label={"Remove custom tag " + (tag.name || String(index + 1))}
								onClick={() => customTags.edit(state.draft.filter((_, position) => position !== index))}><Trash size={16} aria-hidden="true" />Remove</Button>
							<code className="shipit-seo-custom-verification__tag">{customVerificationTagText({ name: tag.name || "service-verification", content: tag.content || "YOUR_CODE" })}</code>
						</div>
					))}
				</div>
				{state.draft.length === 0 ? <p className="shipit-seo-verification-copy">No custom tags. Add one when a service asks for an HTML meta tag.</p> : null}
				<div className="shipit-seo-custom-verification__actions">
					<Button type="button" variant="secondary" disabled={!editable || state.draft.length >= 10}
						onClick={() => customTags.edit([...state.draft, { name: "", content: "" }])}><Plus size={16} aria-hidden="true" />Add tag</Button>
					<span className="shipit-seo-verification-copy">{state.draft.length}/10 tags. Paste the code only, without HTML.</span>
				</div>
				{dirty && !validation.success ? <p className="shipit-seo-form-error" role="status">{validation.error}</p> : null}
				{state.review ? <div className="shipit-seo-custom-verification__review">
					<strong>Review the current saved tags</strong>
					{state.review.tags.length ? state.review.tags.map((tag) => <code key={tag.name}>{tag.name + ": " + tag.content}</code>) : <p>No custom tags are currently saved.</p>}
					<div className="shipit-seo-custom-verification__actions">
						<Button type="button" variant="secondary" disabled={state.busy !== "idle"} onClick={() => customTags.resolve(true)}>Use saved tags</Button>
						<Button type="button" variant="secondary" disabled={state.busy !== "idle"} onClick={() => customTags.resolve(false)}>Keep my draft</Button>
					</div>
				</div> : null}
				<details className="shipit-seo-custom-verification__saved">
					<summary>Last loaded saved tags</summary>
					{state.snapshot.tags.length ? state.snapshot.tags.map((tag) => <code key={tag.name}>{customVerificationTagText(tag)}</code>) : <p>No custom tags were saved in this snapshot.</p>}
				</details>
			</> : <p role="status">{state.busy === "read" ? "Loading saved tags..." : "Saved tags are unavailable. Reload before editing."}</p>}
			{hints.manage !== "allowed" ? <p className="shipit-seo-verification-copy">Changing custom tags needs an Administrator. The server checks every request.</p> : null}
			<p className="shipit-seo-verification-copy">Saves only the custom tags. Google and Bing codes have their own save above.</p>
			<div className="shipit-seo-custom-verification__actions">
				<Button type="button" variant="primary" loading={state.busy === "save"} disabled={!canSave} onClick={() => void save()}>Save custom tags</Button>
				<Button type="button" variant="secondary" loading={state.busy === "read"} disabled={state.busy !== "idle" || state.pending !== "none"} onClick={() => void read("reload")}>Reload saved tags</Button>
				{dirty ? <Button type="button" variant="secondary" disabled={state.busy !== "idle" || state.pending !== "none" || Boolean(state.review) || state.needsReload} onClick={() => customTags.discard()}>Discard draft</Button> : null}
			</div>
			{state.message ? <p role="status">{state.message}</p> : null}
			<p className="shipit-seo-verification-copy">Saved tags appear on pages using EmDashHead. Check the public page source for conflicts with your theme or another plugin. Saved does not mean verified.</p>
		</section>
	);
}
