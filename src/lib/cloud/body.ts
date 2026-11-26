/**
 * An answer's body, read up to a limit. No server's answer is held in
 * memory whole whatever its size: one that says it is longer than it may be,
 * or turns out to be, is given up.
 */

/** The answer is larger than an answer of its kind may be. */
export class TooLarge extends Error {
	override name = "TooLarge";
	constructor() {
		super("The server's answer is larger than an answer may be.");
	}
}

/** The answer broke off before its end. */
export class BrokenOff extends Error {
	override name = "BrokenOff";
	constructor(cause: unknown) {
		super(
			`The server's answer broke off${cause instanceof Error && cause.message ? ` (${cause.message})` : ""}.`,
		);
	}
}

/** What a small answer may weigh: an error, a set of tokens, a discovery document. */
export const MAX_SMALL_BYTES = 1024 * 1024;

/** The body's bytes, at most `max` of them (`TooLarge`, `BrokenOff`). */
export async function readBody(
	response: Response,
	max: number,
): Promise<Uint8Array> {
	const declared = Number(response.headers.get("content-length") ?? "");
	const reader = response.body?.getReader();
	if (Number.isFinite(declared) && declared > max) {
		// Best effort: the body is dropped anyway.
		await reader?.cancel().catch(() => undefined);
		throw new TooLarge();
	}
	if (reader === undefined) return new Uint8Array(0);
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const piece = await reader.read().catch((error: unknown) => {
			throw new BrokenOff(error);
		});
		if (piece.done) break;
		size += piece.value.byteLength;
		if (size > max) {
			// Best effort: the body is dropped anyway.
			await reader.cancel().catch(() => undefined);
			throw new TooLarge();
		}
		chunks.push(piece.value);
	}
	const bytes = new Uint8Array(size);
	let at = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, at);
		at += chunk.byteLength;
	}
	return bytes;
}

/** The body as JSON, read up to `max` bytes; `undefined` when it is none. */
export async function readJson(
	response: Response,
	max: number,
): Promise<unknown> {
	const bytes = await readBody(response, max);
	try {
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		// Not JSON.
		return undefined;
	}
}
