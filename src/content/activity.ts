/**
 * The page's one state machine (DEC-010): what is happening to the page now.
 * A mark's screenshot and an AI app's screenshot both blur and capture the
 * page, so only one of them runs at a time; whatever arrives meanwhile is
 * refused, or (for the toolbar) done once it is over.
 *
 *   idle ──mark drawn──▶ shot ──end──▶ idle
 *   idle ──mark added──▶ saving ──end──▶ idle   (then: stay, hide if added, or show another case)
 *   idle ──AI mark / AI capture──▶ ai-mark / ai-capture ──end or 10 s──▶ idle
 */

import type { MarkTarget } from "../lib/messages.ts";

export interface ShowOptions {
	/** The case the toolbar adds to: always one (DEC-026). */
	target: MarkTarget;
	blurForms?: boolean;
}

/** What to do when a mark's add is over. */
export type Afterwards =
	| { kind: "stay" }
	/** Hidden during the add: hide, but only if the add worked. */
	| { kind: "hide" }
	/** "Add marks" for another case during the add: switch to it. */
	| { kind: "show"; options: ShowOptions };

export type Activity =
	| { kind: "idle" }
	| { kind: "saving"; afterwards: Afterwards }
	| { kind: "shot" }
	| { kind: "ai-mark" }
	| { kind: "ai-capture" };

/** The activities that hold the page. */
export type Exclusive = Exclude<Activity["kind"], "idle">;

export const BUSY: Record<Exclusive, string> = {
	saving:
		"The user is saving marks on this page right now; try again in a few seconds.",
	shot: "The user is marking this page right now; try again in a moment.",
	"ai-mark": "An AI app is taking a screenshot; try again in a moment.",
	"ai-capture": "An AI app is taking a screenshot; try again in a moment.",
};

/** An AI app's screenshot never takes longer: one that did was abandoned. */
export const AI_TIMEOUT_MS = 10_000;

export class PageActivity {
	#now: Activity = { kind: "idle" };
	#timer: ReturnType<typeof setTimeout> | undefined;
	#onTimeout: (() => void) | undefined;

	get now(): Activity {
		return this.#now;
	}

	get saving(): boolean {
		return this.#now.kind === "saving";
	}

	/** Why the page cannot be touched now, if it cannot. */
	get busy(): string | undefined {
		return this.#now.kind === "idle" ? undefined : BUSY[this.#now.kind];
	}

	/**
	 * Start an activity, or say why not. An AI activity ends by itself after
	 * `AI_TIMEOUT_MS`, calling `onTimeout` (to remove its mark and blur).
	 */
	begin(
		kind: Exclusive,
		onTimeout?: () => void,
		timeoutMs = AI_TIMEOUT_MS,
	): { ok: true } | { ok: false; error: string } {
		if (this.#now.kind !== "idle")
			return { ok: false, error: BUSY[this.#now.kind] };
		this.#now =
			kind === "saving" ? { kind, afterwards: { kind: "stay" } } : { kind };
		if (kind === "ai-mark" || kind === "ai-capture") {
			this.#onTimeout = onTimeout;
			this.#timer = setTimeout(() => {
				const cleanup = this.#onTimeout;
				this.end(kind);
				cleanup?.();
			}, timeoutMs);
		}
		return { ok: true };
	}

	/** End `kind` if it is the activity now; returns a save's afterwards. */
	end(kind: Exclusive): Afterwards | undefined {
		if (this.#now.kind !== kind) return undefined;
		const afterwards =
			this.#now.kind === "saving" ? this.#now.afterwards : undefined;
		this.#now = { kind: "idle" };
		clearTimeout(this.#timer);
		this.#timer = undefined;
		this.#onTimeout = undefined;
		return afterwards;
	}

	/** During an add: what is to be done once it is over. */
	get deferred(): Afterwards | undefined {
		return this.#now.kind === "saving" ? this.#now.afterwards : undefined;
	}

	/** During an add: remember what to do once it is over. `false` otherwise. */
	defer(afterwards: Afterwards): boolean {
		if (this.#now.kind !== "saving") return false;
		this.#now = { kind: "saving", afterwards };
		return true;
	}
}
