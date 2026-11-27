/**
 * A small zip writer and reader (DEC-007): stored and deflated entries, no
 * zip64, no encryption. Deflate goes through `CompressionStream`, which
 * browsers and Bun both have.
 */

import { debugLog } from "./debug.ts";

export interface ZipEntry {
	/** Path inside the archive, `/`-separated. */
	name: string;
	data: Uint8Array;
}

export interface WriteZipOptions {
	/** Deflate this entry (default: every entry that is not already compressed). */
	compress?: (name: string) => boolean;
	/** The entries' modification time (default: now). */
	date?: Date;
}

/** Limits that keep a hostile archive from exhausting memory. */
export interface ReadZipOptions {
	maxEntries?: number;
	/** The most bytes all included entries may unpack to together. */
	maxTotalBytes?: number;
	/**
	 * Unpack only the entries this accepts (default: all); `size` is what the
	 * entry declares it unpacks to.
	 */
	include?: (name: string, size: number) => boolean;
}

export class ZipError extends Error {
	override name = "ZipError";
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const UTF8 = 0x0800;

const ALREADY_COMPRESSED = /\.(webp|png|jpe?g|gif|zip|woff2?)$/i;

let table: Uint32Array | undefined;

/** CRC-32 (IEEE), as zip and PNG use it. */
export function crc32(data: Uint8Array): number {
	if (table === undefined) {
		table = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			table[n] = c >>> 0;
		}
	}
	let crc = 0xffffffff;
	for (const byte of data)
		crc = (table[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
	const body = new Blob([data as Uint8Array<ArrayBuffer>])
		.stream()
		.pipeThrough(new CompressionStream("deflate-raw"));
	return new Uint8Array(await new Response(body).arrayBuffer());
}

/**
 * Inflate an entry's raw-deflate body, stopping as soon as it grows past its
 * declared size: a hostile archive's declared sizes say nothing about the
 * real ones, so the limits are enforced on the output itself.
 */
async function inflate(
	body: Uint8Array,
	size: number,
	name: string,
): Promise<Uint8Array> {
	const reader = new Blob([body as Uint8Array<ArrayBuffer>])
		.stream()
		.pipeThrough(new DecompressionStream("deflate-raw"))
		.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	for (;;) {
		const { done, value } = await reader.read().catch((error: unknown) => {
			debugLog("zip entry read", error);
			throw new ZipError(`damaged entry: ${name}`);
		});
		if (done) break;
		length += value.length;
		if (length > size) {
			await reader.cancel();
			throw new ZipError(`entry ${name} unpacks to more than it says`);
		}
		chunks.push(value);
	}
	const out = new Uint8Array(length);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
}

function dosTime(date: Date): { time: number; day: number } {
	const year = Math.max(1980, date.getFullYear());
	return {
		time:
			(date.getHours() << 11) |
			(date.getMinutes() << 5) |
			Math.floor(date.getSeconds() / 2),
		day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
	};
}

/** Pack `entries` into a zip archive. */
export async function writeZip(
	entries: readonly ZipEntry[],
	options: WriteZipOptions = {},
): Promise<Uint8Array> {
	if (entries.length > 0xffff)
		throw new ZipError("more than 65535 entries (zip64 is not supported)");
	const encoder = new TextEncoder();
	const { time, day } = dosTime(options.date ?? new Date());
	const compress =
		options.compress ?? ((name: string) => !ALREADY_COMPRESSED.test(name));
	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	const seen = new Set<string>();
	let offset = 0;
	for (const entry of entries) {
		if (seen.has(entry.name))
			throw new ZipError(`duplicate entry: ${entry.name}`);
		seen.add(entry.name);
		const name = encoder.encode(entry.name);
		const crc = crc32(entry.data);
		let method = 0;
		let body = entry.data;
		if (compress(entry.name) && entry.data.length > 0) {
			const deflated = await deflate(entry.data);
			if (deflated.length < entry.data.length) {
				method = 8;
				body = deflated;
			}
		}
		const local = new Uint8Array(30 + name.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, LOCAL, true);
		lv.setUint16(4, 20, true);
		lv.setUint16(6, UTF8, true);
		lv.setUint16(8, method, true);
		lv.setUint16(10, time, true);
		lv.setUint16(12, day, true);
		lv.setUint32(14, crc, true);
		lv.setUint32(18, body.length, true);
		lv.setUint32(22, entry.data.length, true);
		lv.setUint16(26, name.length, true);
		local.set(name, 30);
		const central = new Uint8Array(46 + name.length);
		const cv = new DataView(central.buffer);
		cv.setUint32(0, CENTRAL, true);
		cv.setUint16(4, 20, true);
		cv.setUint16(6, 20, true);
		cv.setUint16(8, UTF8, true);
		cv.setUint16(10, method, true);
		cv.setUint16(12, time, true);
		cv.setUint16(14, day, true);
		cv.setUint32(16, crc, true);
		cv.setUint32(20, body.length, true);
		cv.setUint32(24, entry.data.length, true);
		cv.setUint16(28, name.length, true);
		cv.setUint32(42, offset, true);
		central.set(name, 46);
		locals.push(local, body);
		centrals.push(central);
		offset += local.length + body.length;
		if (offset > 0xffffffff)
			throw new ZipError("more than 4 GiB (zip64 is not supported)");
	}
	const centralSize = centrals.reduce((n, c) => n + c.length, 0);
	if (offset + centralSize > 0xffffffff)
		throw new ZipError("more than 4 GiB (zip64 is not supported)");
	const end = new Uint8Array(22);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, END, true);
	ev.setUint16(8, entries.length, true);
	ev.setUint16(10, entries.length, true);
	ev.setUint32(12, centralSize, true);
	ev.setUint32(16, offset, true);
	const out = new Uint8Array(offset + centralSize + end.length);
	let at = 0;
	for (const part of [...locals, ...centrals, end]) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

/** Unpack a zip archive into its files (directories are skipped). */
export async function readZip(
	bytes: Uint8Array,
	options: ReadZipOptions = {},
): Promise<Map<string, Uint8Array>> {
	const maxEntries = options.maxEntries ?? 1000;
	const maxTotal = options.maxTotalBytes ?? 256 * 1024 * 1024;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let endAt = -1;
	for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
		if (view.getUint32(i, true) === END) {
			endAt = i;
			break;
		}
	}
	if (endAt < 0) throw new ZipError("not a zip archive");
	const count = view.getUint16(endAt + 10, true);
	const centralOffset = view.getUint32(endAt + 16, true);
	if (count > maxEntries) throw new ZipError(`more than ${maxEntries} entries`);
	const decoder = new TextDecoder();
	const files = new Map<string, Uint8Array>();
	let total = 0;
	let at = centralOffset;
	for (let i = 0; i < count; i++) {
		if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL)
			throw new ZipError("broken central directory");
		const flags = view.getUint16(at + 8, true);
		const method = view.getUint16(at + 10, true);
		const crc = view.getUint32(at + 16, true);
		const compressedSize = view.getUint32(at + 20, true);
		const size = view.getUint32(at + 24, true);
		const nameLength = view.getUint16(at + 28, true);
		const extraLength = view.getUint16(at + 30, true);
		const commentLength = view.getUint16(at + 32, true);
		const localOffset = view.getUint32(at + 42, true);
		if (at + 46 + nameLength + extraLength + commentLength > bytes.length)
			throw new ZipError("broken central directory");
		const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
		at += 46 + nameLength + extraLength + commentLength;
		if (name.endsWith("/")) continue;
		if (options.include !== undefined && !options.include(name, size)) continue;
		if (flags & 1) throw new ZipError(`encrypted entry: ${name}`);
		if (compressedSize === 0xffffffff || size === 0xffffffff)
			throw new ZipError(`zip64 entry: ${name}`);
		total += size;
		if (total > maxTotal) throw new ZipError(`more than ${maxTotal} bytes`);
		if (
			localOffset + 30 > bytes.length ||
			view.getUint32(localOffset, true) !== LOCAL
		)
			throw new ZipError(`broken entry: ${name}`);
		const start =
			localOffset +
			30 +
			view.getUint16(localOffset + 26, true) +
			view.getUint16(localOffset + 28, true);
		if (start + compressedSize > bytes.length)
			throw new ZipError(`truncated entry: ${name}`);
		const body = bytes.subarray(start, start + compressedSize);
		let data: Uint8Array;
		if (method === 0) data = body.slice();
		else if (method === 8) data = await inflate(body, size, name);
		else throw new ZipError(`unsupported compression ${method}: ${name}`);
		if (data.length !== size || crc32(data) !== crc)
			throw new ZipError(`damaged entry: ${name}`);
		files.set(name, data);
	}
	return files;
}
