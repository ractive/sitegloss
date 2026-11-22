/**
 * The pairing code the AI app card shows. When a code is typed in, the relay
 * sends the next one at once (reason `used`), a moment before the app that
 * used it is listed: shown as it came, the card flashed a new code nobody
 * asked for between the two. So the used code stays, said to be used, until
 * an app connects (and the card shows it paired) or until it is clear none
 * will: then the new code, for the next try. As the client library's own
 * connect dialog does (`CODE_USED_WAIT_MS` there, the same 10 seconds).
 */

import type { PairingCode } from "@ractive-ch/tab-mcp-client";

/** How long a used code waits for its app before the next code shows. */
export const CODE_USED_WAIT_MS = 10_000;

export interface CodeShown {
	code?: string;
	/** `code` was typed in; the apps listed when it was, and until when it waits. */
	used?: { grants: readonly string[]; until: number };
}

/**
 * What to show after `shown`, with the relay's code now `current` and the
 * apps `grants` listed (their ids).
 */
export function nextCodeShown(
	shown: CodeShown,
	current: PairingCode | undefined,
	grants: readonly string[],
	now: number,
): CodeShown {
	if (current === undefined) return {};
	const fresh: CodeShown = { code: current.code };
	if (shown.used !== undefined) {
		const before = shown.used.grants;
		const connected = grants.some((g) => !before.includes(g));
		// Another reason (it ran out, a new start) is news of its own.
		const waits = current.reason === "used" && now < shown.used.until;
		return connected || !waits ? fresh : shown;
	}
	if (current.code === shown.code) return shown;
	if (current.reason === "used" && shown.code !== undefined)
		return {
			code: shown.code,
			used: { grants: [...grants], until: now + CODE_USED_WAIT_MS },
		};
	return fresh;
}

export interface CodeClock {
	now(): number;
	setTimer(run: () => void, ms: number): ReturnType<typeof setTimeout>;
	clearTimer(timer: ReturnType<typeof setTimeout>): void;
}

/**
 * The code shown, moved on where the facts arrive (a code, the apps listed)
 * and when a used code's wait is over, whether a panel is open or not: a
 * panel opened later reads what is true then. One timer at a time.
 */
export class CodeWatch {
	#shown: CodeShown = {};
	#current: PairingCode | undefined;
	#grants: readonly string[] = [];
	#timer: ReturnType<typeof setTimeout> | undefined;
	readonly #clock: CodeClock;
	readonly #changed: () => void;

	constructor(clock: CodeClock, changed: () => void) {
		this.#clock = clock;
		this.#changed = changed;
	}

	get shown(): CodeShown {
		return this.#shown;
	}

	/** The relay's code is `current` now, and the apps listed are `grants`. */
	update(current: PairingCode | undefined, grants: readonly string[]): void {
		this.#current = current;
		this.#grants = grants;
		const before = this.#shown;
		this.#shown = nextCodeShown(before, current, grants, this.#clock.now());
		const used = this.#shown.used;
		if (used === before.used) return;
		this.#clear();
		if (used !== undefined)
			this.#timer = this.#clock.setTimer(
				() => {
					this.#timer = undefined;
					this.update(this.#current, this.#grants);
					this.#changed();
				},
				Math.max(0, used.until - this.#clock.now()) + 1,
			);
	}

	/** Watching another connection, or none: nothing shown, no timer. */
	stop(): void {
		this.#clear();
		this.#shown = {};
		this.#current = undefined;
		this.#grants = [];
	}

	#clear(): void {
		if (this.#timer !== undefined) this.#clock.clearTimer(this.#timer);
		this.#timer = undefined;
	}
}
