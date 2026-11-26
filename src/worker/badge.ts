/**
 * The toolbar icon's badge and title, from what needs the user (DEC-025):
 * an AI app's question ("?"), the sync paused or failed ("!"), the AI
 * connection on the way ("…"). One decision for all, in that order: a
 * question waits for an answer now, a paused sync only falls behind. The
 * green spark (AI access on) is in the icon itself, beside the badge, as
 * before except while a question waits.
 */

import { PANEL } from "../lib/browser.ts";
import { debugLog } from "../lib/debug.ts";
import type { SyncStatus } from "../lib/sync.ts";
import { showSpark } from "./icon.ts";

/** What the AI connection has to say (connection.ts). */
export interface AiBadge {
	/** Questions waiting for the user's answer. */
	questions: number;
	ai: "connected" | "connecting" | "off";
}

export interface Badge {
	text: string;
	color: string;
	textColor: string;
	title: string;
	spark: boolean;
}

/** Amber with dark text: paused. Red with white: failed. */
export const SYNC_PAUSED_COLOR = "#ffb000";
export const SYNC_PAUSED_TEXT = "#1b2130";
export const SYNC_FAILED_COLOR = "#b3261e";

/** The sync's part: a status that needs the user, else nothing. */
export function syncBadge(
	status: SyncStatus | undefined,
): Omit<Badge, "spark"> | undefined {
	if (status?.state === "paused")
		return {
			text: "!",
			color: SYNC_PAUSED_COLOR,
			textColor: SYNC_PAUSED_TEXT,
			title:
				status.reason === "downloads"
					? "Sitegloss: the copy to a folder is paused. Click to allow downloads."
					: "Sitegloss: the copy to a folder is paused. Click to allow access.",
		};
	if (status?.state === "failed")
		return {
			text: "!",
			color: SYNC_FAILED_COLOR,
			textColor: "#ffffff",
			title:
				"Sitegloss: the copy to a folder failed. Click to see why and try again.",
		};
	return undefined;
}

export function decideBadge(ai: AiBadge, sync: SyncStatus | undefined): Badge {
	if (ai.questions > 0)
		return {
			text: "?",
			color: "#b45309",
			textColor: "#ffffff",
			title: `Sitegloss: ${ai.questions === 1 ? "an AI app asks" : `${ai.questions} questions wait`} for your answer. Open the ${PANEL} to answer.`,
			spark: false,
		};
	const spark = ai.ai === "connected";
	const fromSync = syncBadge(sync);
	if (fromSync !== undefined)
		return {
			...fromSync,
			title: spark ? `${fromSync.title} AI access is on.` : fromSync.title,
			spark,
		};
	if (spark)
		return {
			text: "",
			color: "#15803d",
			textColor: "#ffffff",
			title: "Sitegloss: AI access is on",
			spark,
		};
	if (ai.ai === "connecting")
		return {
			text: "…",
			color: "#6b7280",
			textColor: "#ffffff",
			title: "Sitegloss: connecting to the AI app",
			spark,
		};
	return {
		text: "",
		color: "#6b7280",
		textColor: "#ffffff",
		title: "Sitegloss",
		spark,
	};
}

/** What the badge needs of Chrome (fakes in the tests). */
export interface BadgeDeps {
	apply(badge: Badge): void;
}

/** The badge from both parts, set again whenever either changes. */
export function badgeOf(deps: BadgeDeps) {
	let ai: AiBadge = { questions: 0, ai: "off" };
	let sync: SyncStatus | undefined;
	const show = () => deps.apply(decideBadge(ai, sync));
	return {
		ai(next: AiBadge): void {
			ai = next;
			show();
		},
		sync(next: SyncStatus | undefined): void {
			sync = next;
			show();
		},
	};
}

/** Sitegloss's toolbar badge, title and spark. */
export const badge = badgeOf({
	apply(b) {
		void showSpark(b.spark);
		void chrome.action
			.setBadgeText({ text: b.text })
			.catch((error: unknown) => debugLog("badge text", error));
		void chrome.action
			.setBadgeBackgroundColor({ color: b.color })
			.catch((error: unknown) => debugLog("badge color", error));
		// Chrome 110 and later.
		if (typeof chrome.action.setBadgeTextColor === "function")
			void chrome.action
				.setBadgeTextColor({ color: b.textColor })
				.catch((error: unknown) => debugLog("badge text color", error));
		void chrome.action
			.setTitle({ title: b.title })
			.catch((error: unknown) => debugLog("badge title", error));
	},
});
