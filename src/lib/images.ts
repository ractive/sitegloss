/**
 * Screenshots and crops as WebP, with `createImageBitmap` and
 * `OffscreenCanvas` (service worker and side panel; DEC-007).
 */

import type { Rect } from "./case.ts";
import { paintMark, type RenderedMark } from "./marks.ts";
import type { StoredImage } from "./store.ts";

/** The longest side Claude looks at; larger images are scaled down anyway. */
export const MAX_SIDE = 1568;

const QUALITY = 0.85;

/** Screenshots waiting for their marks are encoded a second time at saving. */
export const PENDING_QUALITY = 0.95;

async function render(
	source: ImageBitmap,
	crop: { x: number; y: number; width: number; height: number },
	maxSide: number,
	quality = QUALITY,
): Promise<StoredImage> {
	const scale = Math.min(1, maxSide / Math.max(crop.width, crop.height));
	const width = Math.max(1, Math.round(crop.width * scale));
	const height = Math.max(1, Math.round(crop.height * scale));
	const canvas = new OffscreenCanvas(width, height);
	const ctx = canvas.getContext("2d");
	if (ctx === null) throw new Error("no 2d canvas");
	ctx.drawImage(
		source,
		crop.x,
		crop.y,
		crop.width,
		crop.height,
		0,
		0,
		width,
		height,
	);
	const blob = await canvas.convertToBlob({ type: "image/webp", quality });
	return { blob, width, height };
}

/** A `captureVisibleTab` data URL as a full-size WebP. */
export async function screenshotToWebp(
	dataUrl: string,
	quality = QUALITY,
): Promise<StoredImage> {
	return toWebp(await (await fetch(dataUrl)).blob(), quality);
}

/** Any image as a full-size WebP. */
export async function toWebp(
	image: Blob,
	quality = QUALITY,
): Promise<StoredImage> {
	const bitmap = await createImageBitmap(image);
	try {
		return await render(
			bitmap,
			{ x: 0, y: 0, width: bitmap.width, height: bitmap.height },
			Number.POSITIVE_INFINITY,
			quality,
		);
	} finally {
		bitmap.close();
	}
}

/** A screenshot with `marks` on it, as the overlay showed them; `dpr` as for `cropImages`. */
export async function drawMarks(
	image: Blob,
	marks: readonly RenderedMark[],
	dpr: number,
): Promise<StoredImage> {
	const bitmap = await createImageBitmap(image);
	try {
		const { width, height } = bitmap;
		const canvas = new OffscreenCanvas(width, height);
		const ctx = canvas.getContext("2d");
		if (ctx === null) throw new Error("no 2d canvas");
		ctx.drawImage(bitmap, 0, 0);
		ctx.scale(dpr, dpr);
		for (const mark of marks) paintMark(ctx, mark);
		const blob = await canvas.convertToBlob({
			type: "image/webp",
			quality: QUALITY,
		});
		return { blob, width, height };
	} finally {
		bitmap.close();
	}
}

/**
 * Parts of a screenshot, cut from one decode of it: each `rect` in CSS pixels
 * of the shot, `dpr` its pixels per CSS pixel. Crops are clamped to the image
 * and at most `maxSide` long.
 */
export async function cropImages(
	image: Blob,
	rects: readonly Rect[],
	dpr: number,
	maxSide = MAX_SIDE,
): Promise<StoredImage[]> {
	const bitmap = await createImageBitmap(image);
	try {
		const out: StoredImage[] = [];
		for (const rect of rects) {
			const x = Math.min(
				bitmap.width - 1,
				Math.max(0, Math.floor(rect.x * dpr)),
			);
			const y = Math.min(
				bitmap.height - 1,
				Math.max(0, Math.floor(rect.y * dpr)),
			);
			const width = Math.max(
				1,
				Math.min(bitmap.width - x, Math.ceil(rect.width * dpr)),
			);
			const height = Math.max(
				1,
				Math.min(bitmap.height - y, Math.ceil(rect.height * dpr)),
			);
			out.push(await render(bitmap, { x, y, width, height }, maxSide));
		}
		return out;
	} finally {
		bitmap.close();
	}
}

/** The longest side of an image a person adds to a mark (DEC-058). */
export const ADDED_MAX_SIDE = 2048;

/** A picture with more pixels than may be added; nothing was encoded. */
export class TooManyPixels extends Error {}

/**
 * A picture a person adds to a mark (pasted, chosen or dropped), re-encoded:
 * WebP at the crops' quality, its longest side at most `ADDED_MAX_SIDE`, turned
 * as its EXIF orientation says. The canvas writes no EXIF, XMP or GPS, so the
 * re-encoding is what strips its metadata (DEC-058). An animated GIF gives its
 * first frame. More than `maxPixels` throws `TooManyPixels` before anything is
 * drawn; what `createImageBitmap` cannot decode throws its own error.
 */
export async function toAddedImage(
	image: Blob,
	maxPixels: number,
): Promise<StoredImage> {
	const bitmap = await createImageBitmap(image, {
		imageOrientation: "from-image",
	});
	try {
		if (bitmap.width * bitmap.height > maxPixels) throw new TooManyPixels();
		return await render(
			bitmap,
			{ x: 0, y: 0, width: bitmap.width, height: bitmap.height },
			ADDED_MAX_SIDE,
		);
	} finally {
		bitmap.close();
	}
}

/**
 * The whole image, scaled down to at most `maxSide`: for images handed to AI
 * apps (iteration 4's `get_image` and `capture`).
 */
export async function scaleImage(
	image: Blob,
	maxSide = MAX_SIDE,
): Promise<StoredImage> {
	const bitmap = await createImageBitmap(image);
	try {
		return await render(
			bitmap,
			{ x: 0, y: 0, width: bitmap.width, height: bitmap.height },
			maxSide,
		);
	} finally {
		bitmap.close();
	}
}
