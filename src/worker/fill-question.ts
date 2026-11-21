/**
 * Sitegloss's part of filling in the code on the relay's pairing page
 * (DEC-044 and its review), around the client library's `CodeFiller`
 * (`@ractive-ch/tab-mcp-client/extension`, tab-mcp's DEC-206). The library
 * checks the page's port, decides when a page is asked about, when a code
 * goes to it and what withdraws a question; this module is how Sitegloss
 * asks, what it says when nothing was filled in, and how long pairing is
 * held on for a fill (the library's `FillHost` `ask`, `failed`, `code` and
 * `release`).
 *
 * - One question at a time. A page in another tab while one waits is not
 *   asked about and not dropped unseen: the panel says so (`problem`), and
 *   the library hears `busy`; so is one while a code is on its way to a page
 *   in another tab. The same tab's new page replaces its question, with a new
 *   id, so the panel's wait before a yes counts starts again.
 * - The question ends with a yes or a no, after `askMs`, and when the
 *   library withdraws it (the page went, AI access or the setting went off,
 *   another relay, the AI app connected meanwhile).
 * - Pairing is held on (codes come only while it is) from the yes until
 *   `holdMs` after the last code went to a page; at once when no code went
 *   and none went within `holdMs` before; at once when the library says no
 *   fill needs it any more (`release`, which may come with nothing held).
 */

import {
	type CodeSource,
	type FillAnswer,
	type FillContext,
	type FillFailure,
	takeCode,
} from "@ractive-ch/tab-mcp-client/extension";
import { type FillView, fillAppLabel } from "./protocol.ts";

/** How long the question waits for an answer: a code's own life. */
export const FILL_ASK_MS = 120_000;
/** How long pairing stays on after a fill, for the relay to check the code. */
export const FILL_HOLD_MS = 30_000;
/** How long the panel says why a fill-in did not happen. */
export const FILL_PROBLEM_MS = 20_000;

/** What the question needs of the connection and the panel. */
export interface FillQuestionHost {
	/** Tell the user with no panel on screen; `undefined`: the question went. */
	notify(view: FillView | undefined): void;
	changed(): void;
	/** Escapes invisible and direction characters: the names come from a page. */
	visible(text: string): string;
	/** Hold pairing on for a fill, or let it go. */
	hold(on: boolean): void;
	/** The relay's codes (`pairingCodes(mcp)` of the connection now). */
	codes(): CodeSource;
	now(): number;
}

interface Question {
	view: FillView;
	tabId: number;
	resolve: (answer: FillAnswer) => void;
}

export class FillQuestion {
	readonly #host: FillQuestionHost;
	readonly #holdMs: number;
	readonly #askMs: number;
	readonly #problemMs: number;
	#question: Question | undefined;
	#problem: { text: string; timer: ReturnType<typeof setTimeout> } | undefined;
	/** The tabs whose code is being fetched for a fill (the library's `FillContext`). */
	readonly #fetching: number[] = [];
	#holding = false;
	#release: ReturnType<typeof setTimeout> | undefined;

	constructor(
		host: FillQuestionHost,
		options: { holdMs?: number; askMs?: number; problemMs?: number } = {},
	) {
		this.#host = host;
		this.#holdMs = options.holdMs ?? FILL_HOLD_MS;
		this.#askMs = options.askMs ?? FILL_ASK_MS;
		this.#problemMs = options.problemMs ?? FILL_PROBLEM_MS;
	}

	/** The question that waits, for the panel. */
	get question(): FillView | undefined {
		return this.#question?.view;
	}

	/** Why the last fill-in did not happen, or why a page was not asked about. */
	get problem(): string | undefined {
		return this.#problem?.text;
	}

	/** A question waits, or a code is on its way (Firefox's event page stays). */
	get busy(): boolean {
		return this.#question !== undefined || this.#fetching.length > 0;
	}

	/** The library's `ask`: Sitegloss's question, in the panel or a notification. */
	ask(
		tabId: number,
		client: { name: string; host: string },
		signal: AbortSignal,
	): Promise<FillAnswer> {
		const host = this.#host;
		if (signal.aborted) return Promise.resolve("deny");
		const view: FillView = {
			id: crypto.randomUUID(),
			name: host.visible(client.name),
			host: host.visible(client.host),
		};
		const waiting = this.#question;
		if (waiting !== undefined && waiting.tabId !== tabId) {
			// Said here, not in `failed("busy")`: only here is it known what
			// keeps Sitegloss busy, a question or a code on its way.
			this.#setProblem(
				`${fillAppLabel(view)} also opened the relay's page. Sitegloss asks about one at a time: answer the question above first, then reload that page; or type the code there.`,
				this.#askMs,
			);
			return Promise.resolve("busy");
		}
		if (this.#fetching.some((id) => id !== tabId)) {
			this.#setProblem(
				`${fillAppLabel(view)} also opened the relay's page while Sitegloss was filling in the code on another one. Reload that page in a moment to be asked, or type the code there.`,
			);
			return Promise.resolve("busy");
		}
		// The same tab's page again: the one the old question was about is gone.
		this.#end("deny");
		return new Promise<FillAnswer>((resolve) => {
			const timer = setTimeout(() => end("timeout"), this.#askMs);
			const end = (answer: FillAnswer) => {
				if (this.#question?.view.id === view.id) this.#end(answer);
			};
			const withdrawn = () => end("deny");
			signal.addEventListener("abort", withdrawn, { once: true });
			this.#question = {
				view,
				tabId,
				resolve: (answer) => {
					clearTimeout(timer);
					signal.removeEventListener("abort", withdrawn);
					resolve(answer);
				},
			};
			host.notify(view);
			host.changed();
		});
	}

	/** The user's answer to question `id`; a stale id does nothing. */
	answer(id: string, yes: boolean): void {
		const q = this.#question;
		if (q === undefined || q.view.id !== id) return;
		this.#end(yes ? "allow" : "deny");
	}

	/** The library's `failed`: the page `context` got no code. */
	failed(why: FillFailure, context: FillContext): void {
		// `busy` was said by `ask`, which knows whether a question waits or a
		// code is on its way.
		if (why === "busy") return;
		this.#setProblem(
			`Sitegloss could not fill in the code for the AI app at ${this.#host.visible(context.client.host)}. Type the code from the AI app card on the relay's page.`,
		);
	}

	/**
	 * The library's `code`: the code to fill in on the page `context`
	 * (`takeCode`), with pairing held on for it. Held until `holdMs` after a
	 * code was given; let go at once when none was (withdrawn, the page went,
	 * no code came), unless an earlier fill's `holdMs` still runs: the relay
	 * may still be checking that code.
	 */
	async code(
		signal: AbortSignal,
		context: FillContext,
	): Promise<string | undefined> {
		const host = this.#host;
		const { tabId } = context;
		this.#fetching.push(tabId);
		if (!this.#holding) {
			this.#holding = true;
			host.hold(true);
		}
		let code: string | undefined;
		try {
			code = await takeCode(host.codes(), signal, { now: host.now() });
		} finally {
			this.#fetching.splice(this.#fetching.indexOf(tabId), 1);
		}
		if (code === undefined || signal.aborted) {
			if (this.#release === undefined) this.#letGo();
			return undefined;
		}
		this.#setProblem(undefined);
		clearTimeout(this.#release);
		this.#release = setTimeout(() => {
			this.#release = undefined;
			this.#letGo();
		}, this.#holdMs);
		return code;
	}

	/**
	 * The library's `release`: no fill needs pairing held any more (a
	 * filled-in code paired its AI app, or a fill ended without sending its
	 * code and no other one is under way or waits for the relay's check). It
	 * may come with nothing held, also again: nothing to do then.
	 */
	release(): void {
		if (!this.#holding) return;
		clearTimeout(this.#release);
		this.#release = undefined;
		this.#letGo();
	}

	/**
	 * Turned off, AI access off, another relay (with the library's
	 * `withdrawAll()` or `reset()`): the question goes at once, and pairing
	 * is no longer held on.
	 */
	withdraw(): void {
		this.#end("deny");
		this.#setProblem(undefined);
		clearTimeout(this.#release);
		this.#release = undefined;
		this.#letGo();
		this.#host.changed();
	}

	#end(answer: FillAnswer): void {
		const q = this.#question;
		if (q === undefined) return;
		this.#question = undefined;
		this.#host.notify(undefined);
		q.resolve(answer);
		this.#host.changed();
	}

	#letGo(): void {
		if (!this.#holding || this.#fetching.length > 0) return;
		this.#holding = false;
		this.#host.hold(false);
	}

	#setProblem(text: string | undefined, ms = this.#problemMs): void {
		clearTimeout(this.#problem?.timer);
		this.#problem =
			text === undefined
				? undefined
				: {
						text,
						timer: setTimeout(() => {
							this.#problem = undefined;
							this.#host.changed();
						}, ms),
					};
		this.#host.changed();
	}
}
