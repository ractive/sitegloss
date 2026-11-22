/**
 * The questions of tools that change something (DEC-008; DEC-018: unless
 * the user chose Always allow for the tool, or Allow all changes, for that
 * AI app), now that the connection has no page of its own to ask in
 * (DEC-015). A
 * question shows in every open side panel; unless a side panel is open, on
 * screen, in the focused window of the tab in front, it also goes out as a Chrome
 * notification, with Allow and Always allow. The first answer counts;
 * closing the notification or a click on its body, or the AI app cancelling,
 * is Don't allow; nobody answering within the time limit is `"timeout"`,
 * which `decide` reports to the AI app as unanswered (the call does not run).
 * Each notification carries
 * its call: a click answers only that call, and a click on a call that is
 * already settled is dropped.
 */

import type { ConfirmRequest } from "@ractive-ch/tab-mcp-client";
import { escapeInvisible } from "@ractive-ch/tab-mcp-client/visible";
import { FIREFOX, PANEL } from "../lib/browser.ts";
import {
	type Answer,
	QUESTION_TIMEOUT_MS,
	type QuestionView,
} from "./protocol.ts";

export { QUESTION_TIMEOUT_MS };

// The test build's guards and delays below are short (DEC-053): its clicks
// and pages come fast, and its tests need not sit them out.
declare const SITEGLOSS_TEST_BUILD: boolean | undefined;

/** An Allow or Always allow this soon after a notification showed does not count. */
export const NOTIFICATION_GUARD_MS =
	typeof SITEGLOSS_TEST_BUILD !== "undefined" && SITEGLOSS_TEST_BUILD
		? 100
		: 500;
/**
 * The arguments in a notification are cut to this; the panel shows all of
 * them (CR-03), which the tools' schemas bound (the library checks them
 * before it asks): `set_summary` takes 20,000 characters.
 */
export const MAX_ARGS_NOTIFICATION = 150;
/** A notification's message is cut to this. */
export const MAX_NOTIFICATION_MESSAGE = 300;
/** A tool's title in a notification's title is cut to this. */
export const MAX_NOTIFICATION_TITLE = 60;

/**
 * The buttons of a notification, in order. Don't allow is closing it (or a
 * click on its body): Chrome gives a notification at most two buttons.
 */
export const NOTIFICATION_BUTTONS = ["Allow", "Always allow"] as const;
/** The one button of a notification that cannot show all the arguments. */
export const REFUSE_ONLY = ["Don't allow"] as const;
/**
 * Firefox's notifications have no buttons and close by themselves: one only
 * tells, and the question is answered in the sidebar, which only the
 * Sitegloss icon's click opens (Firefox lets `sidebarAction.open` run only in
 * a user input handler, and a notification's click is none); the icon shows
 * "?" meanwhile. A click on the notification brings the question's window
 * to the front. Firefox leaves the focus in the page, and Allow counts only
 * in a focused panel: so the click into the sidebar.
 */
export const NO_BUTTONS: readonly string[] = [];
export const FIREFOX_ANSWER =
	"Answer in Sitegloss's sidebar: click the Sitegloss icon (it shows “?”), then click into the sidebar.";

/** What a question needs from Chrome and from the panels. */
export interface QuestionsHost {
	/** The window of tab `tabId`, `undefined` if it is gone. */
	windowOf(tabId: number): Promise<number | undefined>;
	/** A side panel is open in window `windowId`, and the window is focused. */
	panelInFocus(windowId: number): Promise<boolean>;
	/** Show notification `id`; rejects if it could not be shown. */
	notify(id: string, text: NotificationText): Promise<void>;
	clear(id: string): void;
	/** The list of questions changed: tell the panels, set the badge. */
	changed(): void;
	now(): number;
}

export interface NotificationText {
	title: string;
	message: string;
	contextMessage: string;
	/** `NOTIFICATION_BUTTONS`, or `REFUSE_ONLY` when the arguments did not fit. */
	buttons: readonly string[];
}

const cut = (text: string, max: number) =>
	text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Characters that are invisible, blank or turn the text's direction (U+202E,
 * say) written as `\uXXXX`, so the AI app cannot make the arguments look like
 * something else; line breaks and tabs stay (in JSON only the layout). The
 * library's escaping, the same as its confirmation dialog's and the tab-mcp
 * extension's. The tool gets the text unchanged.
 */
export const visible: (text: string) => string = escapeInvisible;

/**
 * Who calls through the browser's WebMCP: not paired, nothing known of it.
 * Sitegloss leaves WebMCP off and refuses such calls (`decide.ts`).
 */
export const WEBMCP_CALLER = "An agent in the browser (WebMCP)";

/** The AI app as a question names it: its declared name beside its verified host. */
export function appName(client: ConfirmRequest["client"]): string {
	if (client.kind !== "relay") return WEBMCP_CALLER;
	return client.name ? `${visible(client.name)} (${client.host})` : client.host;
}

const characters = (n: number) =>
	`${n.toLocaleString("en-US")} character${n === 1 ? "" : "s"}`;

/**
 * A notification's text for a question: the case it is about and the
 * arguments (`args`, in one line), whole. Where they do not fit, it says to
 * read them in the side panel and offers only Don't allow: nobody allows
 * text they were not shown (CR-03, DEC-018). The case's lines are cut
 * before the arguments are.
 */
export function notificationText(
	view: QuestionView,
	args: string,
	firefox = FIREFOX,
): NotificationText {
	const what = cut(view.title ?? view.tool, MAX_NOTIFICATION_TITLE);
	const head = `${view.app} wants to run ${view.tool}: `;
	const about = view.lines.join(" ");
	if (firefox)
		return {
			title: `Allow ${what}?`,
			message: `${cut(`${head}${about}`, MAX_NOTIFICATION_MESSAGE - FIREFOX_ANSWER.length - 1)} ${FIREFOX_ANSWER}`,
			contextMessage: "Sitegloss · answer in its sidebar",
			buttons: NO_BUTTONS,
		};
	const shown = about === "" ? args : ` Arguments: ${args}`;
	const room = MAX_NOTIFICATION_MESSAGE - shown.length;
	const text = (message: string, buttons: readonly string[]) => ({
		title: `Allow ${what}?`,
		message,
		contextMessage: "Sitegloss · close it to not allow",
		buttons,
	});
	if (args.length <= MAX_ARGS_NOTIFICATION && head.length < room)
		return text(
			`${cut(`${head}${about}`, room)}${shown}`,
			NOTIFICATION_BUTTONS,
		);
	const note = `Its arguments (${characters(args.length)}) do not fit here: open Sitegloss's ${PANEL} to read all of them and answer there.`;
	return text(
		`${cut(`${head}${about}`, MAX_NOTIFICATION_MESSAGE - note.length - 1)} ${note}`,
		REFUSE_ONLY,
	);
}

interface Pending {
	view: QuestionView;
	/** The AI app that asked. */
	grantId: string;
	/** The arguments in one line, for a notification. */
	args: string;
	windowId: number | undefined;
	/** The notification showing it, if one does, and its creation. */
	notification?: string;
	/** Its buttons allow (the arguments fit in it); else its one button refuses. */
	canAllow?: boolean;
	created?: Promise<void>;
	shownAt: number;
	settle(answer: Answer | "timeout"): void;
}

export class Questions {
	readonly #host: QuestionsHost;
	readonly #timeoutMs: number;
	readonly #pending = new Map<string, Pending>();
	#shown = 0;

	constructor(host: QuestionsHost, timeoutMs = QUESTION_TIMEOUT_MS) {
		this.#host = host;
		this.#timeoutMs = timeoutMs;
	}

	/** The questions waiting, oldest first. */
	get list(): QuestionView[] {
		return [...this.#pending.values()].map((p) => p.view);
	}

	/**
	 * Ask whether `request` may run; `lines` say what it is about, `tabId` is
	 * the tab in front (where the user looks). Resolves with the first
	 * answer, `"timeout"` when nobody answered in time, `"deny"` when the AI
	 * app cancelled, and at once, without a question, for a caller that is
	 * not an AI app through the relay.
	 */
	ask(
		request: ConfirmRequest,
		lines: string[],
		tabId: number | undefined,
	): Promise<Answer | "timeout"> {
		// Only an AI app through the relay is asked (`decide` refuses the
		// rest before): any other caller gets a no, and no question shows.
		const { client } = request;
		if (client.kind !== "relay") return Promise.resolve("deny");
		const id = crypto.randomUUID();
		const json = visible(JSON.stringify(request.arguments, null, 2) ?? "{}");
		const view: QuestionView = {
			id,
			app: appName(request.client),
			tool: request.tool.name,
			...(request.tool.title ? { title: visible(request.tool.title) } : {}),
			lines: lines.map(visible),
			// All of it: the user allows what they were shown (CR-03).
			args: json,
			expiresAt: this.#host.now() + this.#timeoutMs,
		};
		const args = visible(JSON.stringify(request.arguments) ?? "{}");
		return new Promise((resolve) => {
			if (request.signal.aborted) {
				resolve("deny");
				return;
			}
			let timer: ReturnType<typeof setTimeout> | undefined;
			const cancelled = () => pending.settle("deny");
			const pending: Pending = {
				view,
				grantId: client.grantId,
				args,
				windowId: undefined,
				shownAt: 0,
				settle: (answer) => {
					if (this.#pending.get(id) !== pending) return;
					this.#pending.delete(id);
					clearTimeout(timer);
					request.signal.removeEventListener("abort", cancelled);
					if (pending.notification !== undefined)
						this.#clear(pending.notification, pending.created);
					this.#host.changed();
					resolve(answer);
				},
			};
			this.#pending.set(id, pending);
			timer = setTimeout(() => pending.settle("timeout"), this.#timeoutMs);
			request.signal.addEventListener("abort", cancelled, { once: true });
			this.#host.changed();
			void this.#route(pending, tabId);
		});
	}

	/** In the panel of the tab's focused window, or else in a notification too. */
	async #route(pending: Pending, tabId: number | undefined): Promise<void> {
		try {
			pending.windowId =
				tabId === undefined ? undefined : await this.#host.windowOf(tabId);
			if (
				pending.windowId !== undefined &&
				(await this.#host.panelInFocus(pending.windowId))
			)
				return;
		} catch {
			// Not known where: a notification.
		}
		this.#notify(pending);
	}

	#notify(pending: Pending): void {
		if (this.#pending.get(pending.view.id) !== pending) return;
		const id = `${pending.view.id}:${++this.#shown}`;
		pending.notification = id;
		pending.shownAt = this.#host.now();
		const text = notificationText(pending.view, pending.args);
		pending.canAllow = text.buttons === NOTIFICATION_BUTTONS;
		pending.created = this.#host.notify(id, text).catch((error: unknown) =>
			// Notifications off for Chrome: the badge and the panel remain.
			console.warn("Sitegloss: notification", error),
		);
	}

	/**
	 * Clear notification `id` once Chrome has made it: cleared before, it
	 * would come afterwards and stay, asking for a call that is settled.
	 */
	#clear(id: string, created: Promise<void> | undefined): void {
		void (created ?? Promise.resolve()).then(() => this.#host.clear(id));
	}

	/** An answer from a side panel. */
	/**
	 * Allow every waiting question that `covered` now lets through (an
	 * Always allow or Allow all changes given meanwhile for its AI app and
	 * tool): it would otherwise still wait, and time out unanswered.
	 */
	allowCovered(covered: (grantId: string, tool: string) => boolean): void {
		for (const pending of [...this.#pending.values()])
			if (covered(pending.grantId, pending.view.tool)) pending.settle("allow");
	}

	answer(id: string, answer: Answer): void {
		this.#pending.get(id)?.settle(answer);
	}

	#byNotification(id: string): Pending | undefined {
		for (const pending of this.#pending.values())
			if (pending.notification === id) return pending;
		return undefined;
	}

	/** A button of notification `id`: 0 Allow, 1 Always allow. */
	notificationButton(id: string, index: number): void {
		const pending = this.#byNotification(id);
		if (pending === undefined) return; // settled, or an older notification
		if (!pending.canAllow) {
			// Its one button is Don't allow.
			if (index === 0) pending.settle("deny");
			return;
		}
		const answer: Answer | undefined =
			index === 0 ? "allow" : index === 1 ? "always" : undefined;
		if (answer === undefined) return;
		if (this.#host.now() - pending.shownAt < NOTIFICATION_GUARD_MS) {
			// Too soon to be read: show it again rather than take it.
			const created = pending.created;
			this.#notify(pending);
			this.#clear(id, created);
			return;
		}
		pending.settle(answer);
	}

	/**
	 * The window of the question notification `id` asks, if it is still
	 * open and its window known (Firefox brings it to the front at a click).
	 */
	windowOfNotification(id: string): number | undefined {
		return this.#byNotification(id)?.windowId;
	}

	/** A click on the notification's body, or its closing: Don't allow. */
	notificationDismissed(id: string): void {
		this.#byNotification(id)?.settle("deny");
	}

	/**
	 * The side panel of window `windowId` closed, or another extension's
	 * panel covered it: its questions that showed only there go out as
	 * notifications.
	 */
	panelClosed(windowId: number): void {
		for (const pending of this.#pending.values())
			if (pending.windowId === windowId && pending.notification === undefined)
				this.#notify(pending);
	}
}
