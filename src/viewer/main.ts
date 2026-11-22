/**
 * The picture viewer (DEC-060): one mark's pictures at a size the side panel
 * cannot give, in a tab of their own. Read from the extension's own store,
 * so it works for a case that is not synced; nothing is asked of a server.
 */

import { IdbStore } from "../lib/store.ts";
import { markPictures, pictureIndex, type ViewerPicture } from "./pictures.ts";

const byId = <T extends HTMLElement>(id: string) =>
	document.getElementById(id) as T;
const caption = byId<HTMLParagraphElement>("caption");
const position = byId<HTMLSpanElement>("position");
const previous = byId<HTMLButtonElement>("previous");
const next = byId<HTMLButtonElement>("next");
const size = byId<HTMLButtonElement>("size");
const stage = byId<HTMLElement>("stage");
const img = byId<HTMLImageElement>("picture");
const problem = byId<HTMLParagraphElement>("problem");

const params = new URLSearchParams(location.search);
const caseId = params.get("case") ?? "";
const markId = params.get("mark") ?? "";
const store = new IdbStore();

let pictures: ViewerPicture[] = [];
let at = 0;
let url: string | undefined;

function say(text: string): void {
	problem.textContent = text;
	problem.hidden = false;
	img.hidden = true;
	caption.textContent = text;
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
	caption.textContent = picture.caption;
	position.textContent = `${index + 1} of ${pictures.length}`;
	document.title = `${picture.caption} · Sitegloss`;
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
		`?${new URLSearchParams({ case: caseId, mark: markId, picture: picture.id })}`,
	);
}

function fit(on: boolean): void {
	stage.toggleAttribute("data-fit", on);
	// Pressed: actual size.
	size.setAttribute("aria-pressed", String(!on));
}

previous.addEventListener("click", () => void show(at - 1));
next.addEventListener("click", () => void show(at + 1));
size.addEventListener("click", () => fit(!stage.hasAttribute("data-fit")));
document.addEventListener("keydown", (e) => {
	if (e.metaKey || e.ctrlKey || e.altKey) return;
	if (e.key === "ArrowLeft" && at > 0) void show(at - 1);
	else if (e.key === "ArrowRight" && at < pictures.length - 1)
		void show(at + 1);
	else if (e.key === "f" || e.key === "F") fit(!stage.hasAttribute("data-fit"));
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
	else await show(pictureIndex(pictures, params.get("picture") ?? ""));
}
