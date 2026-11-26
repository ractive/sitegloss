/**
 * The server's events stream (DEC-039), read with `fetch` and a streaming
 * body: an `EventSource` cannot send the access token. The stream only says
 * "the team is at revision N now"; whoever listens then asks for the changes.
 *
 * The server ends a stream after a quarter of an hour and sends comment
 * lines in between, so a connection that died is noticed; `listen` connects
 * again, sooner after a clean end than after a failure.
 */

/** One event of a stream, as the format has it. */
export interface StreamEvent {
	event: string;
	data: string;
}

/**
 * The longest line, and the most data of one event, in characters: this
 * API's events are a line of a few dozen. More is given up (`StreamTooLong`).
 */
export const MAX_LINE = 64 * 1024;

/** How long one connection is kept before it is made anew. */
export const MAX_STREAM_AGE_MS = 20 * 60_000;

/** A line or an event longer than any of this API's. */
export class StreamTooLong extends Error {
	override name = "StreamTooLong";
	constructor() {
		super("the stream sent a line longer than a line may be");
	}
}

/**
 * Reads server-sent events from text as it arrives: `push` returns the
 * events that are complete now. Comment lines and fields other than `event`,
 * `data` and `retry` are left out, as the format asks.
 */
export class EventParser {
	#rest = "";
	#event = "";
	#data: string[] = [];
	#size = 0;
	/** The server's `retry:`, in ms, once it sent one. */
	retry: number | undefined;

	push(text: string): StreamEvent[] {
		const events: StreamEvent[] = [];
		this.#rest += text;
		for (;;) {
			const end = this.#rest.search(/\r\n|\n|\r/);
			// A line that does not end, or an event that does not: no stream
			// of this API's, and not held in memory any longer.
			if ((end < 0 ? this.#rest.length : end) > MAX_LINE)
				throw new StreamTooLong();
			if (end < 0) break;
			const line = this.#rest.slice(0, end);
			// A lone \r at the very end may be the first half of \r\n.
			if (this.#rest[end] === "\r" && end === this.#rest.length - 1) break;
			this.#rest = this.#rest.slice(
				end + (this.#rest.startsWith("\r\n", end) ? 2 : 1),
			);
			if (line === "") {
				if (this.#data.length > 0)
					events.push({
						event: this.#event || "message",
						data: this.#data.join("\n"),
					});
				this.#event = "";
				this.#data = [];
				this.#size = 0;
				continue;
			}
			if (line.startsWith(":")) continue;
			const colon = line.indexOf(":");
			const field = colon < 0 ? line : line.slice(0, colon);
			const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
			if (field === "event") this.#event = value.slice(0, 200);
			else if (field === "data") {
				this.#size += value.length + 1;
				if (this.#size > MAX_LINE) throw new StreamTooLong();
				this.#data.push(value);
			} else if (field === "retry" && /^\d+$/.test(value))
				this.retry = Number(value);
		}
		return events;
	}
}

/** The cursor of a `change` event's data; `undefined` for anything else. */
export function changeCursor(event: StreamEvent): number | undefined {
	if (event.event !== "change") return undefined;
	try {
		const cursor = (JSON.parse(event.data) as { cursor?: unknown }).cursor;
		return typeof cursor === "number" && Number.isFinite(cursor)
			? cursor
			: undefined;
	} catch {
		// Not JSON.
		return undefined;
	}
}

export interface ListenOptions {
	/** The stream's address. */
	url: string;
	/**
	 * An access token; `fresh` after the server refused the last one.
	 * `undefined`: nobody is signed in, and the listening ends.
	 */
	token: (fresh: boolean) => Promise<string | undefined>;
	/** The team is at this revision now. */
	onChange: (cursor: number) => void;
	/**
	 * The stream is open (`true`: the server answered and its body flows),
	 * or no longer (`false`: it ended or failed, a new one is on its way).
	 */
	onConnected?: (open: boolean) => void;
	signal: AbortSignal;
	fetch?: (input: string, init?: RequestInit) => Promise<Response>;
	sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
	/** No line for this long (the server sends one every 20 s): connect again. */
	silenceMs?: number;
	/** A connection older than this is made anew (`MAX_STREAM_AGE_MS`). */
	maxAgeMs?: number;
}

/** The longest wait between two tries. */
export const MAX_BACKOFF_MS = 60_000;
const FIRST_BACKOFF_MS = 2000;

const wait = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve) => {
		if (signal.aborted) return resolve();
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		}
		signal.addEventListener("abort", done);
	});

/**
 * Listen to the stream until `signal` aborts, or nobody is signed in any
 * more: connect, hand each `change` on, and connect again when the stream
 * ends (after the server's `retry`) or fails (after a wait that doubles up
 * to a minute). Resolves when it is over; never rejects.
 */
export async function listen(options: ListenOptions): Promise<void> {
	const fetcher = options.fetch ?? fetch;
	const sleep = options.sleep ?? wait;
	const silence = options.silenceMs ?? 60_000;
	const maxAge = options.maxAgeMs ?? MAX_STREAM_AGE_MS;
	let backoff = FIRST_BACKOFF_MS;
	let fresh = false;
	while (!options.signal.aborted) {
		let pause = backoff;
		const quiet = new AbortController();
		const stop = () => quiet.abort();
		options.signal.addEventListener("abort", stop);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const heard = () => {
			clearTimeout(timer);
			timer = setTimeout(stop, silence);
		};
		// Any byte counts as heard, so a server could hold one connection
		// for ever: it has an age, after which it is made anew.
		let aged = false;
		let open = false;
		const age = setTimeout(() => {
			aged = true;
			stop();
		}, maxAge);
		try {
			const token = await options.token(fresh);
			if (token === undefined) return;
			heard();
			const response = await fetcher(options.url, {
				headers: {
					authorization: `Bearer ${token}`,
					accept: "text/event-stream",
				},
				cache: "no-store",
				credentials: "omit",
				// The chosen server answers, nobody it points at.
				redirect: "error",
				signal: quiet.signal,
			});
			if (response.status === 401 && !fresh) {
				// Once with a new token, at once; a second no waits.
				fresh = true;
				pause = 0;
			} else if (!response.ok || response.body === null) {
				fresh = false;
				backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
			} else {
				fresh = false;
				open = true;
				options.onConnected?.(true);
				const parser = new EventParser();
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				for (;;) {
					const { value, done } = await reader.read();
					if (done) break;
					heard();
					for (const event of parser.push(
						decoder.decode(value, { stream: true }),
					)) {
						const cursor = changeCursor(event);
						if (cursor !== undefined) options.onChange(cursor);
					}
				}
				// It ended as the server ends it: soon again.
				backoff = FIRST_BACKOFF_MS;
				pause = parser.retry ?? FIRST_BACKOFF_MS;
			}
		} catch {
			// Its time was up: nothing went wrong, soon again.
			if (aged) {
				backoff = FIRST_BACKOFF_MS;
				pause = FIRST_BACKOFF_MS;
			} else backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
		} finally {
			// Whatever ended it, the connection is let go.
			if (open) options.onConnected?.(false);
			quiet.abort();
			clearTimeout(timer);
			clearTimeout(age);
			options.signal.removeEventListener("abort", stop);
		}
		if (options.signal.aborted) return;
		await sleep(pause, options.signal);
	}
}
