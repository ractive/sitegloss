/**
 * Drawing the sync (DEC-021, DEC-025): its section on Home, and the banner
 * above every view while it is paused or has failed, which cannot be
 * dismissed while that holds. Both are drawn again only when what they show
 * changed, so a click survives every other render.
 */

import { BROWSER, FIREFOX } from "../lib/browser.ts";
import { DOWNLOADS_FOLDER } from "../lib/sync.ts";
import { byId, formatDate, h } from "./dom.ts";
import type { PanelState } from "./state.ts";

/** What the user can do about the sync; `sync.ts` carries it out. */
export interface SyncActions {
	/** "Copy to Downloads", "Use Downloads instead": Chrome's prompt, in the click. */
	syncDownloads(): void;
	/** "Choose a folder…": Chrome's picker, in the click. */
	syncChoose(): void;
	syncChange(): void;
	syncCancelChange(): void;
	syncStop(): void;
	/** "Allow access": Chrome's prompt for the folder, in the click. */
	syncAllow(): void;
	/** "Allow downloads": Chrome's prompt, in the click. */
	syncAllowDownloads(): void;
	syncRetry(): void;
	/** "Show in folder": the newest file the sync saved. */
	syncShow(): void;
}

type Sync = PanelState["sync"];

/**
 * The actions of the latest render: a part not drawn again keeps its
 * buttons, which call these.
 */
let now: SyncActions | undefined;
const act = (pick: (a: SyncActions) => void) => () => {
	if (now !== undefined) pick(now);
};

/** Where the cases go, as the panel names it. */
export const DOWNLOADS_PLACE = `Downloads/${DOWNLOADS_FOLDER}`;

/** The tooltips of the sync's buttons. */
export const SYNC_DOWNLOADS_TITLE = `Write each case to the folder “${DOWNLOADS_FOLDER}” in your downloads, as its own .zip file as Export does, and again whenever it changes. ${BROWSER} asks once whether Sitegloss may manage your downloads. A deleted case keeps its file. Nothing is read back.`;
export const SYNC_CHOOSE_TITLE =
	"Choose a folder, in iCloud Drive or Dropbox say: Sitegloss writes each case there as its own .zip file, as Export does, and again whenever it changes. A deleted case keeps its file. Nothing is read from the folder.";
const SYNC_CHANGE_TITLE =
	"Copy to Downloads or to another folder: the files written so far stay";
const SYNC_CANCEL_TITLE = "Keep copying where it copies now";
const SYNC_STOP_TITLE = "Stop writing the cases; the files written so far stay";
const SYNC_SHOW_TITLE =
	"Open the folder with the copied files in your system's file manager";
const SYNC_ALLOW_TITLE = `${BROWSER} asks whether Sitegloss may edit files in the folder again; then the cases changed meanwhile are written`;
const SYNC_ALLOW_DOWNLOADS_TITLE = `${BROWSER} asks whether Sitegloss may manage your downloads again; then the cases changed meanwhile are written`;
const SYNC_USE_DOWNLOADS_TITLE = `Write the cases to ${DOWNLOADS_PLACE} from now on, which needs no OK after a restart; the files in the folder stay`;
const SYNC_RETRY_TITLE = "Write the cases that are not written yet";

const SYNC_OFF_TEXT =
	"Keep a copy of every case as a file, written again whenever the case changes. One way: nothing is read back.";
export const SYNC_OFF_NOTE = FIREFOX
	? "Downloads: a folder “Sitegloss” in your downloads, asked once, works with this panel closed. Firefox does not let extensions write to a folder of your choice."
	: "Downloads: a folder “Sitegloss” in your downloads, asked once, works with this panel closed. A folder of your choice (iCloud Drive, Dropbox): Chrome asks for access again after each restart.";
export const SYNC_ASKING_TEXT = `${BROWSER} asks whether Sitegloss may manage your downloads. With a yes, the cases are written to ${DOWNLOADS_PLACE}.`;

/** The banner's text, after its bold "The copy to a folder is paused." or "… failed.". */
export function bannerText(sync: Sync): string | undefined {
	const status = sync.status;
	if (sync.target === undefined || status === undefined) return undefined;
	if (status.state === "paused")
		return status.reason === "downloads"
			? "Sitegloss may no longer save to your downloads."
			: `${BROWSER} needs your OK to write to “${sync.folder ?? ""}” again.`;
	if (status.state === "failed") return status.problem ?? "";
	return undefined;
}

/** Under the banner's text, after a no to Chrome's prompt. */
export const refusedText = (sync: Sync) =>
	sync.status?.reason === "downloads"
		? `${BROWSER} did not allow it. Click Allow downloads to ask again${FIREFOX ? "" : ", or choose a folder"}.`
		: `${BROWSER} did not allow it. Click Allow access to ask again, or use Downloads instead.`;

function button(
	action: string,
	label: string,
	title: string,
	onclick: () => void,
	primary = false,
): HTMLButtonElement {
	return h(
		"button",
		{
			type: "button",
			"data-action": action,
			title,
			onclick,
			// The green of a main action, without the size of the view's one that starts drawing (DEC-077).
			...(primary ? { class: "strong" } : {}),
		},
		label,
	);
}

/** The one button that helps: Allow access, Allow downloads, or Try again. */
function helpButtons(sync: Sync): HTMLButtonElement[] {
	const status = sync.status;
	if (status?.state === "failed")
		return [
			button(
				"sync-retry",
				"Try again",
				SYNC_RETRY_TITLE,
				act((a) => a.syncRetry()),
			),
		];
	if (status?.state !== "paused") return [];
	if (status.reason === "downloads")
		return [
			button(
				"sync-allow-downloads",
				"Allow downloads",
				SYNC_ALLOW_DOWNLOADS_TITLE,
				act((a) => a.syncAllowDownloads()),
				true,
			),
		];
	return [
		button(
			"sync-allow",
			"Allow access",
			SYNC_ALLOW_TITLE,
			act((a) => a.syncAllow()),
			true,
		),
		button(
			"sync-use-downloads",
			"Use Downloads instead",
			SYNC_USE_DOWNLOADS_TITLE,
			act((a) => a.syncDownloads()),
		),
	];
}

/** "Copying to Downloads/Sitegloss", or to “<folder>”. */
function place(sync: Sync): HTMLElement {
	return h(
		"p",
		{ class: "sync-state" },
		"Copying to ",
		sync.target === "downloads"
			? h("strong", { class: "folder" }, DOWNLOADS_PLACE)
			: h("strong", { class: "folder" }, `“${sync.folder ?? ""}”`),
	);
}

/** "Last written …", or what the worker is at. */
function syncLine(status: Sync["status"]): string {
	if (status?.state === "syncing")
		return status.left === 1
			? "Writing 1 case…"
			: `Writing ${status.left ?? 0} cases…`;
	if (status?.lastSyncedAt !== undefined)
		return `Last written ${formatDate(status.lastSyncedAt)}`;
	return status === undefined ? "Starting…" : "Nothing written yet";
}

/** The Off state's buttons and its note; with Cancel while changing. */
function choices(sync: Sync): HTMLElement[] {
	return [
		h("p", {}, SYNC_OFF_TEXT),
		h(
			"div",
			{ class: "row" },
			button(
				"sync-downloads",
				"Copy to Downloads",
				SYNC_DOWNLOADS_TITLE,
				act((a) => a.syncDownloads()),
				true,
			),
			// Firefox has no folder picker for extensions: Downloads only.
			...(FIREFOX
				? []
				: [
						button(
							"sync-choose",
							"Choose a folder…",
							SYNC_CHOOSE_TITLE,
							act((a) => a.syncChoose()),
						),
					]),
			...(sync.changing
				? [
						button(
							"sync-cancel",
							"Cancel",
							SYNC_CANCEL_TITLE,
							act((a) => a.syncCancelChange()),
						),
					]
				: []),
		),
		h("p", { class: "meta sync-note" }, SYNC_OFF_NOTE),
	];
}

/** The section's parts for the state it is in. */
function sectionParts(sync: Sync): HTMLElement[] {
	// While the banner is up it says it, above every view.
	const problem =
		sync.problem === undefined || bannerText(sync) !== undefined
			? []
			: [h("p", { class: "hint", role: "alert" }, sync.problem)];
	if (sync.asking) return [h("p", {}, SYNC_ASKING_TEXT), ...problem];
	if (sync.target === undefined)
		return [
			h("p", { class: "sync-state" }, "Off."),
			...choices(sync),
			...problem,
		];
	if (sync.changing) return [place(sync), ...choices(sync), ...problem];
	const status = sync.status;
	const state = status?.state ?? "syncing";
	const parts: HTMLElement[] = [];
	if (state === "paused")
		parts.push(
			h(
				"p",
				{ class: "sync-state" },
				status?.reason === "downloads"
					? "Paused: Sitegloss may no longer save to your downloads."
					: `Paused: ${BROWSER} wants your OK for “${sync.folder ?? ""}” again.`,
			),
		);
	else parts.push(place(sync));
	parts.push(h("p", { class: "meta sync-line" }, syncLine(status)));
	if (state === "failed" && status?.problem !== undefined)
		parts.push(h("p", { class: "hint", role: "alert" }, status.problem));
	parts.push(...problem);
	parts.push(
		h(
			"div",
			{ class: "row" },
			...helpButtons(sync),
			...(state === "synced" && sync.target === "downloads"
				? [
						button(
							"sync-show",
							"Show in folder",
							SYNC_SHOW_TITLE,
							act((a) => a.syncShow()),
						),
					]
				: []),
			button(
				"sync-change",
				"Change…",
				SYNC_CHANGE_TITLE,
				act((a) => a.syncChange()),
			),
			button(
				"sync-stop",
				"Stop copying",
				SYNC_STOP_TITLE,
				act((a) => a.syncStop()),
			),
		),
	);
	return parts;
}

/** The section on Home: Off, Asking, Syncing, Synced, Paused, Failed. */
export function renderSyncSection(
	state: PanelState,
	actions: SyncActions,
): void {
	now = actions;
	const box = byId<HTMLDivElement>("sync");
	const { sync } = state;
	const status = sync.status;
	const key = JSON.stringify([
		sync.target,
		sync.folder,
		sync.asking,
		sync.changing,
		status?.state,
		status?.reason,
		status?.lastSyncedAt,
		status?.left,
		status?.problem,
		sync.problem,
	]);
	if (box.dataset["key"] === key) return;
	box.dataset["key"] = key;
	box.dataset["sync"] = sync.asking
		? "asking"
		: sync.target === undefined
			? "off"
			: (status?.state ?? "syncing");
	box.replaceChildren(...sectionParts(sync));
}

/**
 * The banner above every view while the sync is paused or failed: what
 * happened, and the button that helps. No way to dismiss it: it goes when the
 * state does.
 */
export function renderSyncBanner(
	state: PanelState,
	actions: SyncActions,
): void {
	now = actions;
	const banner = byId<HTMLDivElement>("sync-banner");
	const { sync } = state;
	const text = bannerText(sync);
	const key = JSON.stringify([
		text,
		sync.status?.state,
		sync.status?.reason,
		sync.refused,
		sync.problem,
	]);
	if (banner.dataset["key"] === key) return;
	banner.dataset["key"] = key;
	if (text === undefined || sync.status === undefined) {
		banner.hidden = true;
		delete banner.dataset["sync"];
		banner.replaceChildren();
		return;
	}
	const failed = sync.status.state === "failed";
	banner.hidden = false;
	banner.dataset["sync"] = sync.status.state;
	banner.replaceChildren(
		h(
			"p",
			{ class: "sync-banner-text" },
			h(
				"strong",
				{},
				failed
					? "The copy to a folder failed."
					: "The copy to a folder is paused.",
			),
			" ",
			text,
		),
		...(sync.refused && !failed
			? [h("p", { class: "sync-banner-refused" }, refusedText(sync))]
			: []),
		...(sync.problem === undefined
			? []
			: [
					h("p", { class: "sync-banner-problem", role: "alert" }, sync.problem),
				]),
		h("div", { class: "row" }, ...helpButtons(sync)),
	);
}
