/**
 * Why AI access went off by itself (DEC-072): the relay ended a session no AI
 * app used for a long time (`idle`) or an old one (`expired`), or the browser
 * or Sitegloss restarted while it was on (`restart`), each without "Keep AI
 * access on". Kept in the worker's settings database, so the reason outlives
 * a stopped worker and a browser restart, until AI access is turned on again
 * or the person turns it off. It holds no page content and no AI app.
 */

import type { StateChangeDetail } from "@ractive-ch/tab-mcp-client";

export type WentOffReason = "idle" | "expired" | "restart";

export interface WentOff {
	reason: WentOffReason;
	/** When it was found out, ms since the epoch. */
	at: number;
}

/** The record, as kept in the settings database. */
export const WENT_OFF_KEY = "aiWentOff";
/** Whether AI access was on for the session when the worker last wrote it: `restart` is told by it. */
export const WAS_ON_KEY = "aiWasOn";

/** A record older than this says nothing a person needs: it is not shown, and removed at start. */
export const WENT_OFF_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The record as stored, when whole and not older than a week at `now`. */
export function wentOffOf(
	value: unknown,
	now: number = Date.now(),
): WentOff | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const { reason, at } = value as Partial<WentOff>;
	return (reason === "idle" || reason === "expired" || reason === "restart") &&
		typeof at === "number" &&
		now - at <= WENT_OFF_MAX_AGE_MS
		? { reason, at }
		: undefined;
}

/**
 * The reason a change of the library's state ends AI access by itself:
 * `idle` or `expired`, and only without "Keep AI access on", which connects
 * again. Nothing for the person's own stop, a takeover or another reason
 * (those have their own words).
 */
export function wentOffAfter(
	{ state, reason }: StateChangeDetail,
	keepOn: boolean,
): "idle" | "expired" | undefined {
	if (state !== "disconnected" || keepOn) return undefined;
	return reason === "idle" || reason === "expired" ? reason : undefined;
}

/**
 * A worker starts: AI access was on, the session's flag is gone (the
 * browser restarted, or Sitegloss was updated, reloaded or disabled: a
 * stopped worker keeps it), and nothing connects again by itself.
 */
export function wentOffAtStart(s: {
	wasOn: boolean;
	sessionOn: boolean;
	stopped: boolean;
	keepOn: boolean;
	replaced: boolean;
}): boolean {
	return s.wasOn && !s.sessionOn && !s.stopped && !s.keepOn && !s.replaced;
}

/** What the panel says of a reason: the pairing stays, and the way back is the same for each. */
const WAY_BACK =
	"Paired apps stay paired. Turn it on again, or tick \u201cKeep AI access on\u201d.";
const SENTENCE: Record<WentOffReason, string> = {
	idle: `AI access went off because no AI app used it for a while. ${WAY_BACK}`,
	expired: `AI access went off because a connection ends after a long time. ${WAY_BACK}`,
	restart: `AI access was on before the browser or Sitegloss restarted, so it is off now. ${WAY_BACK}`,
};

export function wentOffText(reason: WentOffReason): string {
	return SENTENCE[reason];
}
