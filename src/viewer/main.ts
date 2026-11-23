/**
 * The picture viewer (DEC-060): one mark's pictures at a size the side panel
 * cannot give. Read from the extension's own store, so it works for a case
 * that is not synced; nothing is asked of a server.
 *
 * Where it is (DEC-064): over the page in the tab in front, in a frame the
 * content script puts there (`embedded`: what to show comes over the
 * frame's port, never in its address, which the page's resource timing
 * lists); in a small window of its own where there is no content script
 * (`?window=1`); or in a tab, from "Open in a tab".
 */

import { framePort } from "../lib/frame-port.ts";
import { IdbStore } from "../lib/store.ts";
import {
	markPictures,
	pictureIndex,
	type ViewerInit,
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
const embedded = window.parent !== window;
const params = new URLSearchParams(location.search);
const framed = embedded ? await framePort<ViewerInit>() : undefined;
const where: "frame" | "window" | "tab" = embedded
	? "frame"
	: params.get("window") === "1"
		? "window"
		: "tab";
document.documentElement.dataset["where"] = where;
const caseId = framed?.init.caseId ?? params.get("case") ?? "";
const markId = framed?.init.markId ?? params.get("mark") ?? "";
const firstPicture = framed?.init.pictureId ?? params.get("picture") ?? "";
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
	// The address says the picture only in a window or a tab of its own.
	if (where !== "frame")
		history.replaceState(
			null,
			"",
			`?${new URLSearchParams({ case: caseId, mark: markId, picture: picture.id, ...(where === "window" ? { window: "1" } : {}) })}`,
		);
}

function fit(on: boolean): void {
	stage.toggleAttribute("data-fit", on);
	// Pressed: actual size.
	size.setAttribute("aria-pressed", String(!on));
}

/** It goes: the frame over the page, the window, or the tab opened for it. */
function closeViewer(): void {
	if (framed !== undefined) {
		framed.port.postMessage({ type: "close" });
		return;
	}
	if (where === "window") {
		window.close();
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
		})
		.then(closeViewer);
});
close.addEventListener("click", closeViewer);
// Over the page: a click on the dimmed page beside it closes it, as a modal's backdrop.
document.body.addEventListener("click", (e) => {
	if (where === "frame" && e.target === document.body) closeViewer();
});
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
// Over the page, the keyboard goes where the viewer is.
if (where !== "tab") close.focus();
// The side panel's keys while it keeps the focus (DEC-064): the same as here.
framed?.port.addEventListener(
	"message",
	(e: MessageEvent<{ type: string; key?: string }>) => {
		if (e.data.type !== "key" || e.data.key === undefined) return;
		document.dispatchEvent(new KeyboardEvent("keydown", { key: e.data.key }));
	},
);
framed?.port.start();
