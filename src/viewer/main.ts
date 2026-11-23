/**
 * The picture viewer (DEC-060): one mark's pictures at a size the side panel
 * cannot give. Read from the extension's own store, so it works for a case
 * that is not synced; nothing is asked of a server.
 *
 * Where it is (DEC-064): in a small window of the extension's own over the
 * browser window (`?window=1&from=<its id>`), which it sizes to the picture;
 * or in a tab, from "Open in a tab". Never in the page in front.
 */

import { IdbStore } from "../lib/store.ts";
import {
	markPictures,
	pictureIndex,
	type ViewerPicture,
	viewerPath,
} from "./pictures.ts";

const byId = <T extends HTMLElement>(id: string) =>
	document.getElementById(id) as T;
const caption = byId<HTMLSpanElement>("caption-title");
const detail = byId<HTMLSpanElement>("caption-detail");
const close = byId<HTMLButtonElement>("close");
const position = byId<HTMLSpanElement>("position");
const previous = byId<HTMLButtonElement>("previous");
const next = byId<HTMLButtonElement>("next");
const size = byId<HTMLButtonElement>("size");
const stage = byId<HTMLElement>("stage");
const img = byId<HTMLImageElement>("picture");
const problem = byId<HTMLParagraphElement>("problem");

const inTab = byId<HTMLButtonElement>("in-tab");
const params = new URLSearchParams(location.search);
const where: "window" | "tab" = params.get("window") === "1" ? "window" : "tab";
document.documentElement.dataset["where"] = where;
/** The browser window the viewer's window is over, and goes back to. */
const from = Number(params.get("from") ?? "");
const caseId = params.get("case") ?? "";
const markId = params.get("mark") ?? "";
const firstPicture = params.get("picture") ?? "";
const store = new IdbStore();

let pictures: ViewerPicture[] = [];
let at = 0;
let url: string | undefined;

function say(text: string): void {
	problem.textContent = text;
	problem.hidden = false;
	img.hidden = true;
	caption.textContent = text;
	detail.textContent = "";
	for (const b of [previous, next, size]) b.disabled = true;
}

async function show(index: number): Promise<void> {
	const picture = pictures[index];
	if (picture === undefined) return;
	at = index;
	const stored = await store.getImage(caseId, picture.path);
	if (index !== at) return;
	if (url !== undefined) URL.revokeObjectURL(url);
	url = undefined;
	caption.textContent = picture.title;
	detail.textContent = picture.detail;
	position.textContent = `${index + 1} of ${pictures.length}`;
	document.title = `${picture.title} · Sitegloss`;
	previous.disabled = index === 0;
	next.disabled = index === pictures.length - 1;
	if (stored === undefined) {
		problem.textContent = "This picture is not in this browser's Sitegloss.";
		problem.hidden = false;
		img.hidden = true;
		return;
	}
	url = URL.createObjectURL(stored.blob);
	img.src = url;
	img.alt = picture.alt;
	img.hidden = false;
	problem.hidden = true;
	history.replaceState(
		null,
		"",
		`?${new URLSearchParams({ case: caseId, mark: markId, picture: picture.id, ...(where === "window" ? { window: "1", from: String(from) } : {}) })}`,
	);
}

function fit(on: boolean): void {
	stage.toggleAttribute("data-fit", on);
	// Pressed: actual size.
	size.setAttribute("aria-pressed", String(!on));
}

/** It goes: the window, back to the browser window it was over; or the tab. */
function closeViewer(): void {
	if (where === "window") {
		const back = Number.isInteger(from)
			? chrome.windows.update(from, { focused: true }).catch(() => undefined)
			: Promise.resolve();
		void back.then(() => window.close());
		return;
	}
	void chrome.tabs
		.getCurrent()
		.then((tab) =>
			tab?.id === undefined ? window.close() : chrome.tabs.remove(tab.id),
		)
		.catch(() => window.close());
}

inTab.hidden = where === "tab";
inTab.addEventListener("click", () => {
	const picture = pictures[at];
	void chrome.tabs
		.create({
			url: chrome.runtime.getURL(viewerPath(caseId, markId, picture?.id ?? "")),
			...(Number.isInteger(from) ? { windowId: from } : {}),
		})
		.then(() => window.close());
});
close.addEventListener("click", closeViewer);
/**
 * The window as large as the picture needs, within the screen, centred over
 * the browser window (DEC-064): the picture at its size where it fits, its
 * bar above it; never more than the screen leaves.
 */
async function sizeToPicture(): Promise<void> {
	if (where !== "window" || img.hidden || img.naturalWidth === 0) return;
	const me = await chrome.windows.getCurrent().catch(() => undefined);
	const over = Number.isInteger(from)
		? await chrome.windows.get(from).catch(() => undefined)
		: undefined;
	if (me?.id === undefined) return;
	const frameX = window.outerWidth - window.innerWidth;
	const frameY = window.outerHeight - window.innerHeight;
	const bar = document.querySelector<HTMLElement>(".bar")?.offsetHeight ?? 48;
	const room = { w: screen.availWidth - 32, h: screen.availHeight - 32 };
	const width = Math.round(
		Math.max(
			Math.min(560, room.w),
			Math.min(room.w, img.naturalWidth + 34 + frameX),
		),
	);
	const height = Math.round(
		Math.max(
			Math.min(360, room.h),
			Math.min(room.h, img.naturalHeight + 34 + bar + frameY),
		),
	);
	const x = over
		? (over.left ?? 0) + (over.width ?? width) / 2
		: screen.availWidth / 2;
	const y = over
		? (over.top ?? 0) + (over.height ?? height) / 2
		: screen.availHeight / 2;
	const left = Math.round(
		Math.min(Math.max(x - width / 2, 16), 16 + room.w - width),
	);
	const top = Math.round(
		Math.min(Math.max(y - height / 2, 16), 16 + room.h - height),
	);
	await chrome.windows
		.update(me.id, { width, height, left, top })
		.catch(() => undefined);
}
img.addEventListener("load", () => void sizeToPicture());
previous.addEventListener("click", () => void show(at - 1));
next.addEventListener("click", () => void show(at + 1));
size.addEventListener("click", () => fit(!stage.hasAttribute("data-fit")));
document.addEventListener("keydown", (e) => {
	if (e.metaKey || e.ctrlKey || e.altKey) return;
	if (e.key === "ArrowLeft" && at > 0) void show(at - 1);
	else if (e.key === "ArrowRight" && at < pictures.length - 1)
		void show(at + 1);
	else if (e.key === "f" || e.key === "F") fit(!stage.hasAttribute("data-fit"));
	else if (e.key === "Escape") closeViewer();
	else return;
	e.preventDefault();
});
addEventListener("pagehide", () => {
	if (url !== undefined) URL.revokeObjectURL(url);
});

fit(true);
const c = await store.getCase(caseId).catch(() => undefined);
if (c === undefined) say("This case is not in this browser's Sitegloss.");
else {
	pictures = markPictures(c, markId);
	if (pictures.length === 0) say("This mark is no longer in the case.");
	else await show(pictureIndex(pictures, firstPicture));
}
// In its window, the keyboard is the viewer's: Escape closes it at once.
if (where === "window") close.focus();
