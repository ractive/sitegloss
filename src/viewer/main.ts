/**
 * The picture viewer (DEC-060): one mark's pictures at a size the side panel
 * cannot give. Read from the extension's own store, so it works for a case
 * that is not synced; nothing is asked of a server.
 *
 * Where it is (DEC-064): in a small window of the extension's own over the
 * browser window (`?window=1&from=<its id>`), opened at its size and place
 * by whoever opens it (`viewerBounds`), never resized once shown; or in a
 * tab, from "Open in a tab". Never in the page in front. A picture shows
 * once it is decoded; Previous and Next only for more than one picture;
 * "Actual size" only where it changes something.
 */

import { IdbStore } from "../lib/store.ts";
import { offersNavigation, PICTURE_PAD, sizeChoice } from "./layout.ts";
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
const zoom = byId<HTMLSpanElement>("zoom");
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
	// One picture (most marks): nothing to go through (the owner, DEC-064).
	const several = offersNavigation(pictures.length);
	for (const e of [position, previous, next]) e.hidden = !several;
	position.textContent = several ? `${index + 1} of ${pictures.length}` : "";
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
	// Shown once decoded: no half-drawn picture, no jump as it arrives.
	img.hidden = true;
	img.src = url;
	img.alt = picture.alt;
	await img.decode().catch(() => undefined);
	if (index !== at) return;
	fit(true);
	img.hidden = false;
	problem.hidden = true;
	offerSize();
	history.replaceState(
		null,
		"",
		`?${new URLSearchParams({ case: caseId, mark: markId, picture: picture.id, ...(where === "window" ? { window: "1", from: String(from) } : {}) })}`,
	);
}

/** The stage's room for the picture, inside its padding and the picture's edge. */
const room = () => ({
	width: stage.clientWidth - PICTURE_PAD,
	height: stage.clientHeight - PICTURE_PAD,
});

/**
 * What the size control says and does, in words (DEC-064): "Actual size
 * (100%)" while fitted smaller, "Fit to window" at the actual size; a
 * picture that fits is shown at 100% and there is nothing to switch.
 */
function offerSize(): void {
	if (img.hidden || img.naturalWidth === 0) return;
	const natural = { width: img.naturalWidth, height: img.naturalHeight };
	const { canSwitch, fitted } = sizeChoice(natural, room());
	const fittedNow = stage.hasAttribute("data-fit");
	size.disabled = !canSwitch;
	size.textContent =
		canSwitch && !fittedNow ? "Fit to window" : "Actual size (100%)";
	size.title = canSwitch
		? fittedNow
			? "Show the picture at its actual size, one pixel to one (F)"
			: "Show the whole picture, fitted to the window (F)"
		: "This picture is shown at its actual size";
	zoom.textContent =
		canSwitch && fittedNow ? `Fitted: ${Math.round(fitted * 100)}%` : "100%";
}

function fit(on: boolean): void {
	stage.toggleAttribute("data-fit", on);
	if (!on) {
		// At its actual size, the view starts on the picture's middle.
		stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2;
		stage.scrollTop = (stage.scrollHeight - stage.clientHeight) / 2;
	}
	offerSize();
}

/** The switch, only where it changes something. */
function toggleSize(): void {
	if (!size.disabled) fit(!stage.hasAttribute("data-fit"));
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
// The person resized the window: what fits now decides what is offered.
addEventListener("resize", offerSize);
previous.addEventListener("click", () => void show(at - 1));
next.addEventListener("click", () => void show(at + 1));
size.addEventListener("click", toggleSize);
document.addEventListener("keydown", (e) => {
	if (e.metaKey || e.ctrlKey || e.altKey) return;
	const several = offersNavigation(pictures.length);
	if (e.key === "ArrowLeft" && several && at > 0) void show(at - 1);
	else if (e.key === "ArrowRight" && several && at < pictures.length - 1)
		void show(at + 1);
	else if (e.key === "f" || e.key === "F") toggleSize();
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
if (where === "window") {
	close.focus();
	// The frame above the page, for the next window's size (DEC-064).
	void chrome.runtime
		.sendMessage({ type: "viewer:frame", height: outerHeight - innerHeight })
		.catch(() => undefined);
}
