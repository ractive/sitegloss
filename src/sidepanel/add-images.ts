/**
 * The dialog that adds images to a mark (DEC-058): pasted, dropped or chosen,
 * each re-encoded at once and shown before anything is kept. Nothing is added
 * without "Add". It lives in the side panel, never on the page: the page's
 * own scripts would see a paste or a drop there.
 *
 * The rules (`fileProblem`, `placesFor`, `prepareImage`) are apart from the
 * dialog so a table can test them without a canvas.
 */

import { MAX_MARK_IMAGES } from "../lib/case.ts";
import { sha256Of } from "../lib/cloud/api.ts";
import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from "../lib/export.ts";
import { TooManyPixels, toAddedImage } from "../lib/images.ts";
import type { StoredImage } from "../lib/store.ts";
import { h } from "./dom.ts";

/** What the browser decodes and Sitegloss takes; no SVG (it can run script). */
export const ACCEPTED_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
	"image/avif",
] as const;

export const NOT_READABLE =
	"This file is not an image Sitegloss can read: PNG, JPEG, WebP, GIF or AVIF.";
export const NO_IMAGE_PASTED =
	"The clipboard holds no image. Copy a screenshot first.";
export const TOO_MANY_BYTES = `This image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`;
export const TOO_MANY_PIXELS = `This image has more than ${MAX_IMAGE_PIXELS / 1024 / 1024} million pixels.`;
export const ON_THE_MARK = "This image is on the mark already.";

/** Why a file cannot be taken before it is decoded; none: it may be tried. */
export function fileProblem(file: {
	type: string;
	size: number;
}): string | undefined {
	if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type))
		return NOT_READABLE;
	if (file.size > MAX_IMAGE_BYTES) return TOO_MANY_BYTES;
	return undefined;
}

/**
 * How many of `wanted` new pictures fit on mark `number`, which holds `taken`
 * (its images and the previews), and what is said about the rest.
 */
export function placesFor(
	number: number,
	taken: number,
	wanted: number,
): { fit: number; problem?: string } {
	const free = Math.max(0, MAX_MARK_IMAGES - taken);
	if (wanted <= free) return { fit: wanted };
	return {
		fit: free,
		problem:
			free === 0
				? `Mark ${number} holds at most ${MAX_MARK_IMAGES} images; no more fit.`
				: `Mark ${number} holds at most ${MAX_MARK_IMAGES} images; ${free} more ${free === 1 ? "fits" : "fit"}.`,
	};
}

/** A picture re-encoded and ready to add. */
export interface PreparedImage {
	image: StoredImage;
	sha256: string;
	/** A GIF: only its first frame is kept. */
	firstFrame: boolean;
}

/** Re-encodes a picture; `toAddedImage` in the panel, a fake in tests. */
export type Encode = (file: Blob, maxPixels: number) => Promise<StoredImage>;

/**
 * One picture checked and re-encoded, or the sentence that says why not.
 * `known`: the SHA-256 of what the mark holds and the dialog shows already.
 */
export async function prepareImage(
	file: Blob,
	known: ReadonlySet<string>,
	encode: Encode = toAddedImage,
): Promise<PreparedImage | { problem: string }> {
	const problem = fileProblem(file);
	if (problem !== undefined) return { problem };
	let image: StoredImage;
	try {
		image = await encode(file, MAX_IMAGE_PIXELS);
	} catch (error) {
		return {
			problem: error instanceof TooManyPixels ? TOO_MANY_PIXELS : NOT_READABLE,
		};
	}
	const sha256 = await sha256Of(image.blob);
	if (known.has(sha256)) return { problem: ON_THE_MARK };
	return { image, sha256, firstFrame: file.type === "image/gif" };
}

/** The pictures of a clipboard or a drop that are files. */
export function filesOf(data: DataTransfer | null): File[] {
	if (data === null) return [];
	const out: File[] = [];
	for (const item of Array.from(data.items ?? []))
		if (item.kind === "file") {
			const file = item.getAsFile();
			if (file !== null) out.push(file);
		}
	// A drop's files, where the items list them not (or not all).
	return out.length > 0 ? out : Array.from(data.files ?? []);
}

export interface AddImagesOptions {
	/** The mark's number, as the panel shows it. */
	number: number;
	/** The mark's own screenshot (its crop) as an object URL; none: not here. */
	screenshot: string | undefined;
	/** How many images the mark holds already. */
	have: number;
	/** The SHA-256 of each of them. */
	known: ReadonlySet<string>;
	/** Keeps the images; throws with the sentence to say when it cannot. */
	add: (images: StoredImage[]) => Promise<void>;
	/** Where the focus goes back to when the dialog closes. */
	returnTo?: () => HTMLElement | null | undefined;
	encode?: Encode;
}

export interface AddImagesDialog {
	dialog: HTMLDialogElement;
	/** Take pictures as if pasted or dropped (also the paste into an open mark). */
	offer(
		files: readonly Blob[],
		from: "paste" | "drop" | "choose",
	): Promise<void>;
	close(): void;
}

/** `Add 1 image`, `Add 2 images`. */
const addLabel = (n: number) =>
	n === 0 ? "Add images" : `Add ${n} image${n === 1 ? "" : "s"}`;

/** Opens the dialog for one mark over the panel; it removes itself on close. */
export function openAddImages(o: AddImagesOptions): AddImagesDialog {
	const encode = o.encode ?? toAddedImage;
	const previews: (PreparedImage & { url: string })[] = [];
	const status = h("p", { class: "add-images-status", role: "status" });
	const list = h("ul", {
		class: "add-images-list",
		"aria-label": "Images to add",
	});
	const input = h("input", {
		type: "file",
		multiple: true,
		accept: ACCEPTED_TYPES.join(","),
		hidden: true,
		tabindex: "-1",
	});
	const choose = h(
		"button",
		{ type: "button", "data-action": "choose", onclick: () => input.click() },
		"Choose files…",
	);
	const addButton = h(
		"button",
		{ type: "button", class: "primary", "data-action": "add", disabled: true },
		addLabel(0),
	);
	const cancel = h(
		"button",
		{ type: "button", "data-action": "cancel", onclick: () => close() },
		"Cancel",
	);
	const titleId = `add-images-title-${o.number}`;
	const dialog = h(
		"dialog",
		{ class: "add-images", "aria-labelledby": titleId },
		h("h2", { id: titleId }, `Add images to mark ${o.number}`),
		h(
			"div",
			{ class: "add-images-head" },
			o.screenshot
				? h("img", {
						src: o.screenshot,
						alt: `Screenshot of mark ${o.number}, taken by Sitegloss`,
					})
				: null,
			h(
				"p",
				{},
				o.screenshot
					? `Mark ${o.number} has its screenshot already. Add a picture of what it does not show, for example a menu that closes or another state of the page.`
					: `Mark ${o.number}'s screenshot is not here yet. Add a picture of what it does not show, for example a menu that closes or another state of the page.`,
			),
		),
		h(
			"div",
			{ class: "add-images-drop" },
			h(
				"p",
				{},
				"Paste an image (Ctrl+V or ⌘V), drop one here, or choose a file.",
			),
			h(
				"p",
				{ class: "hint" },
				"To capture a menu that closes: ⌘⇧⌃4 on a Mac, Windows+Shift+S on Windows, then paste.",
			),
			choose,
			input,
		),
		list,
		status,
		h("div", { class: "add-images-foot" }, addButton, cancel),
	);

	let busy = false;
	const say = (text: string) => {
		status.textContent = text;
	};

	function draw(): void {
		list.replaceChildren(
			...previews.map((p, i) =>
				h(
					"li",
					{},
					h("img", { src: p.url, alt: `Image ${o.have + i + 1}` }),
					h(
						"span",
						{},
						`Image ${o.have + i + 1}, ${p.image.width} × ${p.image.height}${p.firstFrame ? ", first frame only" : ""}`,
					),
					h(
						"button",
						{
							type: "button",
							"data-action": "remove",
							"aria-label": `Remove image ${o.have + i + 1}`,
							onclick: () => {
								const [gone] = previews.splice(i, 1);
								if (gone) URL.revokeObjectURL(gone.url);
								say("");
								draw();
								(
									list.querySelector<HTMLElement>(
										`li:nth-child(${Math.min(i + 1, previews.length)}) button`,
									) ?? choose
								).focus();
							},
						},
						"Remove",
					),
				),
			),
		);
		addButton.textContent = addLabel(previews.length);
		addButton.disabled = busy || previews.length === 0;
		choose.disabled = busy;
	}

	async function offer(
		files: readonly Blob[],
		from: "paste" | "drop" | "choose",
	): Promise<void> {
		if (busy) return;
		if (files.length === 0) {
			say(from === "paste" ? NO_IMAGE_PASTED : NOT_READABLE);
			return;
		}
		const places = placesFor(o.number, o.have + previews.length, files.length);
		busy = true;
		say(files.length === 1 ? "Reading the image…" : "Reading the images…");
		draw();
		const problems: string[] = [];
		try {
			for (const file of files.slice(0, places.fit)) {
				const known = new Set([...o.known, ...previews.map((p) => p.sha256)]);
				const done = await prepareImage(file, known, encode);
				if ("problem" in done) problems.push(done.problem);
				else
					previews.push({ ...done, url: URL.createObjectURL(done.image.blob) });
			}
		} finally {
			busy = false;
		}
		if (places.problem !== undefined) problems.push(places.problem);
		say([...new Set(problems)].join(" "));
		draw();
	}

	addButton.addEventListener("click", async () => {
		if (busy || previews.length === 0) return;
		busy = true;
		say("");
		draw();
		try {
			await o.add(previews.map((p) => p.image));
			busy = false;
			close();
		} catch (error) {
			busy = false;
			say(error instanceof Error ? error.message : String(error));
			draw();
		}
	});
	input.addEventListener("change", () => {
		const files = Array.from(input.files ?? []);
		input.value = "";
		void offer(files, "choose");
	});
	// The paste of a focused control in the dialog (no text field is in it).
	const onPaste = (event: ClipboardEvent) => {
		if (!dialog.open) return;
		event.preventDefault();
		void offer(filesOf(event.clipboardData), "paste");
	};
	document.addEventListener("paste", onPaste);
	// Anywhere on the dialog: missing the area by a little drops nothing elsewhere.
	dialog.addEventListener("dragover", (event) => {
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
	});
	dialog.addEventListener("drop", (event) => {
		event.preventDefault();
		void offer(filesOf(event.dataTransfer), "drop");
	});
	// Escape cancels: the dialog's own `cancel`, then its close.
	dialog.addEventListener("close", () => close());

	let closed = false;
	function close(): void {
		if (closed) return;
		closed = true;
		document.removeEventListener("paste", onPaste);
		for (const p of previews) URL.revokeObjectURL(p.url);
		if (dialog.open) dialog.close();
		dialog.remove();
		o.returnTo?.()?.focus();
	}

	document.body.append(dialog);
	dialog.showModal();
	choose.focus();
	draw();
	return { dialog, offer, close };
}
