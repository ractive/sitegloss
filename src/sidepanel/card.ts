/**
 * What the side panel's "AI app" card shows for a state, as in the tab-mcp
 * extension's panel: the next step is the one that stands out. Off: "Turn on
 * AI access". On with no app paired: the address and the code at once. Apps
 * paired: the apps, and "+ Add another AI app" as a link, which shows the
 * address and code again.
 */

import type { AiState } from "../worker/protocol.ts";
import { wentOffText } from "../worker/went-off.ts";

export type CardStatus = "off" | "connecting" | "retrying" | "waiting" | "on";

const STATUS_TEXT: Record<CardStatus, string> = {
	off: "AI access is off · paired apps stay paired",
	connecting: "Connecting…",
	retrying: "Connection lost · retrying",
	waiting: "On · no AI app paired yet",
	on: "Connected",
};

/**
 * Why AI access went off by itself, as a sentence (DEC-072): only when it is
 * off with nothing wrong now (no problem, no takeover, no try waiting).
 */
export function wentOffSentence(
	a: Pick<AiState, "state" | "retrying" | "problem" | "replaced" | "wentOff">,
): string | undefined {
	return a.wentOff !== undefined &&
		a.state === "disconnected" &&
		!a.retrying &&
		a.problem === undefined &&
		a.replaced === undefined
		? wentOffText(a.wentOff)
		: undefined;
}

/** The card's status for the worker's state. */
export function cardStatus(a: AiState): CardStatus {
	if (a.state === "connected") return a.grants.length > 0 ? "on" : "waiting";
	if (a.state === "connecting") return "connecting";
	// The library reconnecting, or "Keep AI access on" waiting to try again.
	if (a.state === "reconnecting" || a.retrying) return "retrying";
	return "off";
}

export interface CardView {
	status: CardStatus;
	stateText: string;
	/** The AI access switch is on (also while connecting or retrying). */
	switchOn: boolean;
	/** The primary "Turn on AI access". */
	turnOn: boolean;
	/** The address and the code (pairing on in the worker). */
	pairing: boolean;
	/** "+ Add another AI app". */
	addApp: boolean;
	/** "Done" under the code: only when adding another app. */
	done: boolean;
	/** The address, shown only while pairing. */
	address: string;
}

/** The card for `a`; `adding`: the user asked to add another app. */
export function cardView(a: AiState, adding: boolean): CardView {
	const status = cardStatus(a);
	const connected = status === "waiting" || status === "on";
	const paired = a.grants.length > 0;
	const pairing = connected && (!paired || adding);
	const names = a.grants.map((g) => g.name || g.host);
	return {
		status,
		stateText:
			status === "on"
				? `Connected · ${names.join(", ")}`
				: ((status === "off" ? wentOffSentence(a) : undefined) ??
					STATUS_TEXT[status]),
		switchOn: status !== "off",
		turnOn: status === "off",
		pairing,
		addApp: connected && paired && !pairing,
		done: pairing && paired,
		address: pairing ? (a.address ?? "") : "",
	};
}

/**
 * Whether `a` has a grant that is not in `known`: the AI app being added has
 * connected, which ends adding it (the pairing box closes).
 */
export function hasNewGrant(known: ReadonlySet<string>, a: AiState): boolean {
	return a.grants.some((g) => !known.has(g.grantId));
}

/**
 * The app paired since the pairing box showed (`before`: the apps paired
 * then; none: it did not show), with the name it is said by: what to do
 * next is said.
 */
export function pairedSince(
	before: ReadonlySet<string> | undefined,
	a: AiState,
): { grantId: string; name: string } | undefined {
	if (before === undefined) return undefined;
	const grant = a.grants.find((g) => !before.has(g.grantId));
	return grant === undefined
		? undefined
		: { grantId: grant.grantId, name: grant.name || grant.host };
}

/** Whether what was said of a pairing still holds: connected, and that app still paired. */
export function stillPaired(grantId: string, a: AiState): boolean {
	return a.state === "connected" && a.grants.some((g) => g.grantId === grantId);
}

// The test build's guards and delays below are short (DEC-053): its clicks
// and pages come fast, and its tests need not sit them out.
declare const SITEGLOSS_TEST_BUILD: boolean | undefined;

/** A confirming click this soon after the first one (a double click) counts as nothing. */
export const CONFIRM_DELAY_MS =
	typeof SITEGLOSS_TEST_BUILD !== "undefined" && SITEGLOSS_TEST_BUILD
		? 100
		: 750;

/** Whether a second click, `now`, confirms a first one at `armedAt`. */
export function confirms(armedAt: number, now: number): boolean {
	return now - armedAt >= CONFIRM_DELAY_MS;
}

/** How long the panel must be visible and focused, with a question shown, before a yes counts. */
export const ALLOW_DELAY_MS =
	typeof SITEGLOSS_TEST_BUILD !== "undefined" && SITEGLOSS_TEST_BUILD
		? 100
		: 750;

/**
 * Whether a yes to a question shown at `shownAt` counts at `now`: the panel
 * has been visible and focused since `focusedSince` (`undefined`: it is not)
 * and the question shown, both for ALLOW_DELAY_MS. Leaving the panel starts
 * the wait again, so a click meant for the page cannot land on a yes the
 * moment the panel comes in front.
 */
export function armed(
	shownAt: number,
	focusedSince: number | undefined,
	now: number,
): boolean {
	return (
		focusedSince !== undefined &&
		now - Math.max(shownAt, focusedSince) >= ALLOW_DELAY_MS
	);
}

/** How long the switch shows the user's flip while waiting for the worker. */
export const SWITCH_WAIT_MS = 10_000;

/** The user's last flip of the AI access switch, until the state follows. */
export interface SwitchIntent {
	on: boolean;
	until: number;
}

/**
 * The switch as shown: the user's flip, until a state that matches it comes
 * (a state sent before the connect or stop was done would flip it back) or
 * the wait runs out.
 */
export function switchShown(
	stateOn: boolean,
	intent: SwitchIntent | undefined,
	now: number,
): { checked: boolean; intent: SwitchIntent | undefined } {
	if (intent === undefined || stateOn === intent.on || now >= intent.until)
		return { checked: stateOn, intent: undefined };
	return { checked: intent.on, intent };
}

/**
 * How AI access came on: by the person, with the card's switch, its "Turn
 * on AI access" button or the top bar's pill; or by itself (Keep AI access
 * on, after a reload, an update, an idle or expired session, a start).
 */
export type TurnedOn = "switch" | "button" | "pill" | "by-itself";

/**
 * Whether to ask once whether to keep AI access on (DEC-059): when the
 * person turned it on, it is not kept on, this browser never answered, and
 * the connection is not taken over by another browser or program.
 */
export function asksKeepOn(
	way: TurnedOn,
	a: Pick<AiState, "keepOn" | "replaced">,
	answered: boolean,
): boolean {
	return (
		way !== "by-itself" && !a.keepOn && !answered && a.replaced === undefined
	);
}

/** How long a person's turning on may take to connect and still be asked about. */
export const KEEP_ON_ASK_WAIT_MS = 60_000;

/**
 * The question's course (DEC-059): due once the person turned AI access on
 * (`pending`), shown only once it is really on, gone whenever it is not.
 */
export interface KeepOnAsk {
	/** Turned on by the person, not on yet: whether it was seen connecting, and until when it may come on. */
	pending?: { seenActive: boolean; until: number };
	/** The question shows. */
	asking: boolean;
}

export const NOT_ASKING: KeepOnAsk = { asking: false };

/** The person turned AI access on `way`: the question is due, where `asksKeepOn` says so. */
export function keepOnAskStarts(
	way: TurnedOn,
	a: Pick<AiState, "keepOn" | "replaced">,
	answered: boolean,
	now: number,
): KeepOnAsk {
	return asksKeepOn(way, a, answered)
		? {
				pending: { seenActive: false, until: now + KEEP_ON_ASK_WAIT_MS },
				asking: false,
			}
		: NOT_ASKING;
}

/**
 * The question after the state `a`: shown once AI access is connected after
 * the person's own turning on; gone when it is not on (it never came on,
 * the attempt failed, it went off, the session ended), when keep-on is on,
 * when the connection is taken over, and once this browser answered (in
 * another panel too).
 */
export function nextKeepOnAsk(
	ask: KeepOnAsk,
	a: Pick<AiState, "state" | "retrying" | "keepOn" | "replaced">,
	answered: boolean,
	now: number,
): KeepOnAsk {
	if (a.keepOn || a.replaced !== undefined || answered) return NOT_ASKING;
	if (ask.asking) return a.state === "connected" ? ask : NOT_ASKING;
	const p = ask.pending;
	if (p === undefined) return ask;
	if (a.state === "connected") return { asking: true };
	if (now > p.until) return NOT_ASKING;
	if (a.state === "connecting" || a.state === "reconnecting" || a.retrying)
		return p.seenActive
			? ask
			: { asking: false, pending: { ...p, seenActive: true } };
	// Off: before the worker took the command up it is still to come; after
	// it was seen connecting, the attempt failed.
	return p.seenActive ? NOT_ASKING : ask;
}

/**
 * Whether the answer is to be kept now: keep-on is really on (the box
 * ticked, or "Keep it on", went through: Firefox's consent given, the
 * worker took it), and nothing was kept yet. "Not now" and unticking by
 * hand are kept at once.
 */
export const keepOnChosen = (answered: boolean, a: Pick<AiState, "keepOn">) =>
	!answered && a.keepOn;
