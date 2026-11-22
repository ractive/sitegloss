/**
 * A picture's size as its file declares it, read from the header without
 * decoding anything (DEC-058): a small file can declare a huge picture, and
 * a decode allocates the whole of it. PNG, JPEG, GIF and WebP; whether it is
 * animated where the header says so cheaply (PNG `acTL`, WebP's animation
 * flag, a GIF with more than one frame). Anything that cannot be read is
 * `undefined`, and is not taken.
 */

export interface DeclaredSize {
	width: number;
	height: number;
	/** More than one frame: only the first is kept. */
	animated: boolean;
}

/**
 * Width and height from a WebP file's header (`VP8 `, `VP8L` or `VP8X`),
 * without decoding it; `undefined` when it is no WebP.
 */
export function webpSize(
	data: Uint8Array,
): { width: number; height: number } | undefined {
	const ascii = (from: number, to: number) =>
		String.fromCharCode(...data.subarray(from, to));
	if (data.length < 30 || ascii(0, 4) !== "RIFF" || ascii(8, 12) !== "WEBP")
		return undefined;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const u24 = (at: number) =>
		(data[at] ?? 0) | ((data[at + 1] ?? 0) << 8) | ((data[at + 2] ?? 0) << 16);
	switch (ascii(12, 16)) {
		case "VP8X":
			return { width: u24(24) + 1, height: u24(27) + 1 };
		case "VP8L": {
			if (data[20] !== 0x2f) return undefined;
			const bits = view.getUint32(21, true);
			return {
				width: (bits & 0x3fff) + 1,
				height: ((bits >>> 14) & 0x3fff) + 1,
			};
		}
		case "VP8 ":
			if (data[23] !== 0x9d || data[24] !== 0x01 || data[25] !== 0x2a)
				return undefined;
			return {
				width: view.getUint16(26, true) & 0x3fff,
				height: view.getUint16(28, true) & 0x3fff,
			};
		default:
			return undefined;
	}
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngSize(data: Uint8Array): DeclaredSize | undefined {
	if (data.length < 33 || PNG_SIGNATURE.some((b, i) => data[i] !== b))
		return undefined;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const type = (at: number) =>
		String.fromCharCode(...data.subarray(at, at + 4));
	if (type(12) !== "IHDR") return undefined;
	const width = view.getUint32(16);
	const height = view.getUint32(20);
	// An APNG says so in `acTL`, before the first `IDAT`.
	let animated = false;
	for (let at = 8; at + 8 <= data.length; ) {
		const length = view.getUint32(at);
		const name = type(at + 4);
		if (name === "acTL") animated = true;
		if (name === "IDAT" || name === "IEND") break;
		at += 12 + length;
	}
	return { width, height, animated };
}

/** The JPEG markers that start a frame and carry its size (SOF0…SOF15 but DHT, JPG, DAC). */
const SOF = new Set([
	0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function jpegSize(data: Uint8Array): DeclaredSize | undefined {
	if (data[0] !== 0xff || data[1] !== 0xd8) return undefined;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	for (let at = 2; at + 4 <= data.length; ) {
		if (data[at] !== 0xff) return undefined;
		const marker = data[at + 1] as number;
		// Fill bytes, and markers that stand alone.
		if (marker === 0xff) {
			at += 1;
			continue;
		}
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			at += 2;
			continue;
		}
		if (marker === 0xd9 || marker === 0xda) return undefined;
		const length = view.getUint16(at + 2);
		if (length < 2) return undefined;
		if (SOF.has(marker)) {
			if (at + 9 > data.length) return undefined;
			return {
				height: view.getUint16(at + 5),
				width: view.getUint16(at + 7),
				animated: false,
			};
		}
		at += 2 + length;
	}
	return undefined;
}

function gifSize(data: Uint8Array): DeclaredSize | undefined {
	const head = String.fromCharCode(...data.subarray(0, 6));
	if ((head !== "GIF87a" && head !== "GIF89a") || data.length < 13)
		return undefined;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const width = view.getUint16(6, true);
	const height = view.getUint16(8, true);
	const table = (flags: number) =>
		flags & 0x80 ? 3 * 2 ** ((flags & 7) + 1) : 0;
	/** Past a run of sub-blocks, at the byte after its terminator. */
	const skip = (from: number) => {
		let at = from;
		while (at < data.length && data[at] !== 0) at += (data[at] as number) + 1;
		return at + 1;
	};
	// Frames, counted up to two: the second makes it animated.
	let frames = 0;
	let at = 13 + table(data[10] as number);
	while (at < data.length && frames < 2) {
		const block = data[at];
		if (block === 0x2c) {
			frames++;
			at = skip(at + 10 + table(data[at + 9] as number) + 1);
		} else if (block === 0x21) at = skip(at + 2);
		else break;
	}
	return { width, height, animated: frames > 1 };
}

/** The picture's declared size and whether it is animated, by its type; none: not readable. */
export function declaredSize(
	data: Uint8Array,
	type: string,
): DeclaredSize | undefined {
	switch (type) {
		case "image/png":
			return pngSize(data);
		case "image/jpeg":
			return jpegSize(data);
		case "image/gif":
			return gifSize(data);
		case "image/webp": {
			const size = webpSize(data);
			if (size === undefined) return undefined;
			// VP8X's flags: bit 1 is animation.
			const extended = String.fromCharCode(...data.subarray(12, 16)) === "VP8X";
			return { ...size, animated: extended && ((data[20] ?? 0) & 0x02) !== 0 };
		}
		default:
			return undefined;
	}
}
