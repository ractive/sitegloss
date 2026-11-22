/**
 * "Keep AI access on", in the service worker (DEC-015): the library
 * reconnects by itself only after a broken connection; this also connects
 * after an idle or expired session, and goes on trying after a connect that
 * failed or a session the relay ended (too many messages, say), while the
 * user wants it.
 */

import type { DisconnectReason, TabMcp } from "@ractive-ch/tab-mcp-client";
import { Latest } from "../lib/latest.ts";

// The test build's guards and delays below are short (DEC-053): its clicks
// and pages come fast, and its tests need not sit them out.
declare const SITEGLOSS_TEST_BUILD: boolean | undefined;

/** The waits between tries to connect, in ms; the last one repeats. */
const KEEP_ON_DELAYS_MS =
	typeof SITEGLOSS_TEST_BUILD !== "undefined" && SITEGLOSS_TEST_BUILD
		? [200, 400, 800, 1600, 3000]
		: [5000, 10_000, 20_000, 40_000, 60_000];

/**
 * Why a session ended, in the user's words, for every reason nobody here
 * chose (`user`, `disconnect_all`, a takeover) that is not the end of an idle
 * or old session either. The last three come only without the library's
 * reconnecting, which Sitegloss leaves on.
 */
const ENDED: Record<
	Exclude<
		DisconnectReason,
		"user" | "disconnect_all" | "replaced" | "idle" | "expired"
	>,
	string
> = {
	rate_limited:
		"The relay ended the connection: Sitegloss sent it too many messages at once.",
	too_large: "The relay ended the connection: a message was too large for it.",
	policy: "The relay ended the connection: it refused a message.",
	closed: "The relay closed the connection.",
	shutdown: "The relay shut down.",
	heartbeat: "The relay stopped answering.",
	network: "The network connection to the relay broke.",
};

/** Why the relay ended a session for `reason`, or `undefined` for one somebody chose or an idle or old session. */
export function endedProblem(
	reason: DisconnectReason | undefined,
): string | undefined {
	return reason !== undefined && reason in ENDED
		? ENDED[reason as keyof typeof ENDED]
		: undefined;
}

/** The part of `TabMcp` that `KeepOn` uses. */
export type KeptConnection = Pick<
	TabMcp,
	"state" | "connect" | "addEventListener"
>;

/**
 * "Keep AI access on": the library reconnects by itself only after a broken
 * connection. While `wanted` says so, this also connects after an idle or
 * expired session, and goes on trying after a connect that failed or a
 * session the relay ended for another reason, saying why (`problem`) also
 * when not wanted. It leaves alone what the user or another tab ended
 * (`disconnect()`, `replaced`, `disconnect_all`).
 */
export class KeepOn {
	/** Why the last try failed; `undefined` once connected or stopped. */
	problem: string | undefined;
	readonly #wanted: () => boolean;
	readonly #changed: () => void;
	readonly #delaysMs: readonly number[];
	readonly #tries = new Latest();
	#connection: KeptConnection | undefined;
	#listening = new AbortController();
	#timer: ReturnType<typeof setTimeout> | undefined;
	#failures = 0;

	/** `changed` is called when `problem` or `retrying` changed. */
	constructor(
		wanted: () => boolean,
		changed: () => void,
		delaysMs: readonly number[] = KEEP_ON_DELAYS_MS,
	) {
		this.#wanted = wanted;
		this.#changed = changed;
		this.#delaysMs = delaysMs;
	}

	/** A next try is waiting for its time. */
	get retrying(): boolean {
		return this.#timer !== undefined;
	}

	/** Look after `connection` instead of the one before. */
	watch(connection: KeptConnection): void {
		this.#listening.abort();
		this.#listening = new AbortController();
		this.stop();
		this.#connection = connection;
		const { signal } = this.#listening;
		connection.addEventListener(
			"statechange",
			({ detail: { state, reason } }) => {
				if (state === "connected") this.stop();
				// The relay ended an idle or old session; the library connects
				// again by itself only after a broken one (state `reconnecting`).
				else if (
					state === "disconnected" &&
					(reason === "idle" || reason === "expired")
				)
					this.connect();
				// Ended by the relay for another reason: say why, and try again
				// after the waits of a failed connect, never at once (a relay
				// that ends every session must get no tight loop).
				else if (state === "disconnected") {
					const ended = endedProblem(reason);
					if (ended !== undefined) this.failed(new Error(ended));
				}
			},
			{ signal },
		);
		// The library gave up reconnecting: the relay refused an attempt. It
		// says so with `error`, its state already `disconnected`, just before
		// the `statechange` to it.
		connection.addEventListener(
			"error",
			({ detail: { error } }) => {
				if (connection.state === "disconnected") this.failed(error);
			},
			{ signal },
		);
	}

	/** Connect if wanted and nothing is on its way. */
	connect(): void {
		clearTimeout(this.#timer);
		this.#timer = undefined;
		const connection = this.#connection;
		// Not while connecting, connected, or reconnecting by itself.
		if (
			connection === undefined ||
			!this.#wanted() ||
			connection.state !== "disconnected"
		)
			return;
		const attempt = this.#tries.start();
		connection.connect({ resume: true }).catch((error: unknown) => {
			if (attempt.current()) this.failed(error);
		});
	}

	/** A connect failed: say why and, if wanted, try again later. */
	failed(error: unknown): void {
		this.problem = error instanceof Error ? error.message : String(error);
		const replaced = (error as { reason?: string }).reason === "replaced";
		if (this.#wanted() && !replaced) {
			const delay = this.#delaysMs[this.#failures] ?? this.#delaysMs.at(-1);
			this.#failures++;
			clearTimeout(this.#timer);
			this.#timer = setTimeout(() => this.connect(), delay);
		}
		this.#changed();
	}

	/** Forget the tries so far; one still running no longer counts. */
	stop(): void {
		this.#tries.cancel();
		clearTimeout(this.#timer);
		this.#timer = undefined;
		this.#failures = 0;
		this.problem = undefined;
		this.#changed();
	}
}
