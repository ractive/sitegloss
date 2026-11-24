/**
 * The panel's icons (DEC-078): the web app's family, Heroicons' outline set
 * (24 px grid, 1.5 stroke), so one action has the same picture in both. The
 * paths are copied from heroicons 2.2.0 (MIT, Tailwind Labs; its licence is
 * in the build's LICENSES.txt): data, not code, and no runtime dependency.
 *
 * One icon is one action. Each is decoration (`aria-hidden`): a button's name
 * is its words or its `aria-label`. Drawn in `currentColor`, sized by CSS.
 */

const SVG = "http://www.w3.org/2000/svg";

/** Each icon by the action it stands for, with the heroicon it is. */
export const ICONS = {
	/** Verify, Start verifying (check); and the tick of a done copy, as in the web app. */
	check: ["m4.5 12.75 6 6 9-13.5"],
	/** Close case (check-circle). */
	close: ["M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"],
	/** Reopen…, Reopen case (arrow-uturn-left). */
	reopen: ["M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3"],
	/** Copy for your AI app, Copy (clipboard-document). */
	copy: [
		"M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5A3.375 3.375 0 0 0 6.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0 0 15 2.25h-1.5a2.251 2.251 0 0 0-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 0 0-9-9Z",
	],
	/** Share with team (share). */
	share: [
		"M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z",
	],
	/** Edit comment, Edit, Rename… (pencil-square). */
	edit: [
		"m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10",
	],
	/** Delete mark, Delete case, Delete (trash). */
	delete: [
		"m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0",
	],
	/** Add comment (chat-bubble-left). */
	comment: [
		"M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z",
	],
	/** Assign, Reassign (user). */
	assign: [
		"M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z",
	],
	/** Export…, Export all cases: a file to the computer (arrow-down-tray). */
	export: [
		"M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3",
	],
	/** Import a case…: a file from the computer (arrow-up-tray). */
	import: [
		"M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5",
	],
	/** All cases, Back (chevron-left). */
	back: ["M15.75 19.5 8.25 12l7.5-7.5"],
	/** Something new: New case for this page, Add marks, Add another image… (plus). */
	add: ["M12 4.5v15m7.5-7.5h-15"],
	/** Show marks: the case's marks drawn on the tab (eye). */
	"show-marks": [
		"M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z",
		"M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
	],
	/** Hide marks (eye-slash). */
	"hide-marks": [
		"M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88",
	],
	/** Show one mark: scroll to it on the page and outline it (viewfinder-circle, the web app's "The mark"). */
	"show-mark": [
		"M7.5 3.75H6A2.25 2.25 0 0 0 3.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0 1 20.25 6v1.5m0 9V18A2.25 2.25 0 0 1 18 20.25h-1.5m-9 0H6A2.25 2.25 0 0 1 3.75 18v-1.5M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
	],
	/** Copy link: the case's address in the web app (link). */
	link: [
		"M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244",
	],
	/** Disconnect an AI app, Disconnect all apps (link-slash). */
	disconnect: [
		"M13.181 8.68a4.503 4.503 0 0 1 1.903 6.405m-9.768-2.782L3.56 14.06a4.5 4.5 0 0 0 6.364 6.365l3.129-3.129m5.614-5.615 1.757-1.757a4.5 4.5 0 0 0-6.364-6.365l-4.5 4.5c-.258.26-.479.541-.661.84m1.903 6.405a4.495 4.495 0 0 1-1.242-.88 4.483 4.483 0 0 1-1.062-1.683m6.587 2.345 5.907 5.907m-5.907-5.907L8.898 8.898M2.991 2.99 8.898 8.9",
	],
	/** Sign in (arrow-right-end-on-rectangle). */
	"sign-in": [
		"M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15M12 9l3 3m0 0-3 3m3-3H2.25",
	],
	/** Sign out (arrow-right-start-on-rectangle, the web app's). */
	"sign-out": [
		"M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9",
	],
	/** Sync now (arrow-path). */
	sync: [
		"M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99",
	],
	/** Allow on all sites (globe-alt). */
	"all-sites": [
		"M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418",
	],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICONS;

/** `name`'s icon: `<svg class="icon" aria-hidden="true">` in the text's colour. */
export function icon(name: IconName, doc: Document = document): SVGSVGElement {
	const svg = doc.createElementNS(SVG, "svg");
	svg.setAttribute("class", "icon");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-width", "1.5");
	svg.setAttribute("stroke-linecap", "round");
	svg.setAttribute("stroke-linejoin", "round");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("focusable", "false");
	svg.setAttribute("data-icon", name);
	for (const d of ICONS[name]) {
		const path = doc.createElementNS(SVG, "path");
		path.setAttribute("d", d);
		svg.append(path);
	}
	return svg;
}

/** A button's content: `name`'s icon, then its words. */
export function withIcon(
	name: IconName,
	label: string,
): [SVGSVGElement, string] {
	return [icon(name), label];
}

/**
 * A Copy button's content in either state: its icon, and its words in a box
 * as wide as "Copied", so the button keeps its width when it says so and
 * nothing beside it moves (style.css, `.copy-words`).
 */
export function setCopyLabel(el: HTMLElement, what: "Copy" | "Copied"): void {
	const doc = el.ownerDocument;
	const words = doc.createElement("span");
	words.className = "copy-words";
	words.setAttribute("data-wide", "Copied");
	words.textContent = what;
	el.replaceChildren(icon(what === "Copied" ? "check" : "copy", doc), words);
}

/**
 * Set a button's icon and words, where `textContent` set them before; left as
 * it is when it says that already.
 */
export function setLabel(
	el: HTMLElement,
	name: IconName | undefined,
	label: string,
): void {
	const first = el.firstElementChild;
	const shown =
		first?.namespaceURI === SVG
			? (first.getAttribute("data-icon") ?? undefined)
			: undefined;
	if (shown === name && el.textContent === label) return;
	el.replaceChildren(
		...(name === undefined ? [] : [icon(name, el.ownerDocument)]),
		label,
	);
}
