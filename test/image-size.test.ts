import { describe, expect, test } from "bun:test";
import { declaredSize } from "../src/lib/image-size.ts";
import { pngHeader } from "./fixtures.ts";

const bytes = (...parts: (number[] | string)[]) =>
	new Uint8Array(
		parts.flatMap((p) =>
			typeof p === "string" ? [...new TextEncoder().encode(p)] : p,
		),
	);
const be16 = (n: number) => [n >> 8, n & 255];
const le16 = (n: number) => [n & 255, n >> 8];
const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];

/** A JPEG: SOI, an APP1 to skip, then SOF0 declaring `width`×`height`. */
const jpeg = (width: number, height: number) =>
	bytes([0xff, 0xd8], [0xff, 0xe1, ...be16(8)], "Exif\0\0", [
		0xff,
		0xc0,
		...be16(11),
		8,
		...be16(height),
		...be16(width),
		1,
		1,
		0x11,
		0,
	]);

/** A GIF of `frames` frames, each an image descriptor with one empty sub-block run. */
const gif = (width: number, height: number, frames: number) =>
	bytes(
		"GIF89a",
		[...le16(width), ...le16(height), 0, 0, 0],
		[0x21, 0xf9, 4, 0, 0, 0, 0, 0],
		...Array.from({ length: frames }, () => [
			0x2c,
			0,
			0,
			0,
			0,
			...le16(width),
			...le16(height),
			0,
			2,
			1,
			0,
			0,
		]),
		[0x3b],
	);

/** A WebP with a VP8X header declaring `width`×`height`, `animated` by its flag. */
const webp = (width: number, height: number, animated = false) =>
	bytes(
		"RIFF",
		[0, 0, 0, 0],
		"WEBPVP8X",
		[10, 0, 0, 0, animated ? 0x02 : 0, 0, 0, 0],
		[...le24(width - 1), ...le24(height - 1)],
	);

describe("the size a picture declares, read before any decode (DEC-058)", () => {
	test.each([
		["a PNG", pngHeader(1440, 900), "image/png", [1440, 900, false]],
		[
			"an APNG",
			pngHeader(400, 300, { apng: true }),
			"image/png",
			[400, 300, true],
		],
		[
			"a PNG declaring 23000 × 23000",
			pngHeader(23_000, 23_000),
			"image/png",
			[23_000, 23_000, false],
		],
		[
			"a JPEG after an EXIF segment",
			jpeg(1440, 900),
			"image/jpeg",
			[1440, 900, false],
		],
		[
			"a JPEG declaring 65535 × 65535",
			jpeg(65_535, 65_535),
			"image/jpeg",
			[65_535, 65_535, false],
		],
		["a GIF of one frame", gif(320, 200, 1), "image/gif", [320, 200, false]],
		["an animated GIF", gif(320, 200, 3), "image/gif", [320, 200, true]],
		[
			"a GIF declaring 65535 × 65535",
			gif(65_535, 65_535, 1),
			"image/gif",
			[65_535, 65_535, false],
		],
		["a WebP", webp(1440, 900), "image/webp", [1440, 900, false]],
		[
			"an animated WebP",
			webp(1440, 900, true),
			"image/webp",
			[1440, 900, true],
		],
		[
			"a WebP declaring 16384 × 16384",
			webp(16_384, 16_384),
			"image/webp",
			[16_384, 16_384, false],
		],
	])("%s", (_name, data, type, [width, height, animated]) => {
		expect(declaredSize(data, type)).toEqual({
			width,
			height,
			animated,
		} as never);
	});

	test.each([
		["text called a PNG", bytes("not a png at all, really not"), "image/png"],
		["a PNG cut short", pngHeader(10, 10).subarray(0, 20), "image/png"],
		[
			"a JPEG whose scan starts before any size",
			bytes([0xff, 0xd8, 0xff, 0xda, 0, 2]),
			"image/jpeg",
		],
		["a GIF header only", bytes("GIF89a"), "image/gif"],
		["a PNG called an AVIF", pngHeader(10, 10), "image/avif"],
	])("%s: not readable", (_name, data, type) => {
		expect(declaredSize(data, type)).toBeUndefined();
	});
});
