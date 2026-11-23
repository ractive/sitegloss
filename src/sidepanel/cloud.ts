/**
 * The side panel's part of the account and the sync with a team at
 * sitegloss.dev (DEC-039): signing in (the browser's own sign-in window
 * needs a page that stays open, which the panel is), the team, the answers
 * to the sync's questions, and the server's address. The service worker
 * syncs and holds the tokens; the panel reads what it wrote down (the
 * account, the status, how each case syncs) and asks it to act.
 *
 * While the panel is open and a team is chosen it also listens to the
 * server's events stream, and tells the worker of each change there, so
 * what a teammate does shows here within a moment. The worker is not kept
 * running for that.
 */

import { askDataConsent, BROWSER, PANEL, webAuthFlow } from "../lib/browser.ts";
import { eventsUrl } from "../lib/cloud/api.ts";
import {
	type Account,
	CLOUD_DATABASE,
	type CloudStatus,
	casesForgotten,
	KEYS,
	type SyncMode,
} from "../lib/cloud/book.ts";
import { chosenServer, scopedKv, serverProblem } from "../lib/cloud/servers.ts";
import { listen } from "../lib/cloud/sse.ts";
import { type Kv, kvWhenOpen, openKv } from "../lib/kv.ts";
import type { CloudAnswer, CloudRequest } from "../lib/messages.ts";
import type { CloudActions } from "./cloud-view.ts";
import type { PanelState } from "./state.ts";

type Update = (change: (s: PanelState) => void) => void;

const message = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

/** Ask the worker; a worker that does not answer is a failure like any other. */
async function ask(request: CloudRequest): Promise<CloudAnswer> {
	try {
		const answer = (await chrome.runtime.sendMessage(request)) as
			| CloudAnswer
			| undefined;
		return (
			answer ?? { ok: false, error: "Sitegloss's background did not answer." }
		);
	} catch (error) {
		return { ok: false, error: message(error) };
	}
}

/** The panel's view of the account and the sync, and its actions. */
export interface PanelCloud extends CloudActions {
	/** Read what the worker wrote down again. */
	refresh(): Promise<void>;
	/**
	 * The panel came into view (shown, or focused): the worker asks for the
	 * account's teams again if that was more than a minute ago (DEC-045).
	 * At most once a minute from here, and only on being shown: no loop.
	 */
	shown(): void;
}

/** How long between two looks at the account from the panel being shown. */
export const SHOWN_CHECK_MS = 60_000;

/** The actions, for `Actions`, before the panel's cloud is started. */
export function cloudActions(cloud: () => CloudActions): CloudActions {
	return {
		cloudSignIn: () => cloud().cloudSignIn(),
		cloudSignOut: () => cloud().cloudSignOut(),
		cloudTeam: (id) => cloud().cloudTeam(id),
		cloudSyncNow: () => cloud().cloudSyncNow(),
		cloudDecide: (share) => cloud().cloudDecide(share),
		cloudShare: (caseId) => cloud().cloudShare(caseId),
		cloudServer: (text) => cloud().cloudServer(text),
	};
}

/** How long the stream may be closed before the status line says so. */
export const STREAM_GAP_MS = 10_000;

/** The panel's cloud; `kv` is the cloud's database (tests pass their own). */
export function startCloud(
	update: Update,
	kv: Kv = kvWhenOpen(() => openKv(CLOUD_DATABASE)),
	send: (request: CloudRequest) => Promise<CloudAnswer> = ask,
): PanelCloud {
	/** The stream listened to: the server and team it is of, and its end. */
	let stream: { key: string; end: AbortController } | undefined;

	const problem = (text: string | undefined) =>
		update((s) => {
			s.cloud.problem = text;
		});

	/**
	 * Whether the stream is open, as the status line says it. A stream the
	 * server ends (every quarter of an hour) is open again within seconds:
	 * only one closed for longer counts as closed.
	 */
	let closing: ReturnType<typeof setTimeout> | undefined;
	function live(open: boolean | undefined): void {
		clearTimeout(closing);
		if (open === false) {
			closing = setTimeout(
				() => update((s) => (s.cloud.live = false)),
				STREAM_GAP_MS,
			);
			return;
		}
		update((s) => (s.cloud.live = open));
	}
	// "5 minutes ago" is said anew each minute.
	const ticking = setInterval(
		() => update((s) => (s.cloud.minute = Math.floor(Date.now() / 60_000))),
		60_000,
	) as unknown as { unref?: () => void };
	// (In tests, under Bun: it holds no run open.)
	ticking.unref?.();

	/** Listen to the team's changes while there is a team; another team, another stream. */
	function follow(account: Account | undefined): void {
		const teamId = account?.expired ? undefined : account?.teamId;
		const key =
			account === undefined || teamId === undefined
				? ""
				: `${account.server} ${teamId}`;
		if (stream?.key === key) return;
		stream?.end.abort();
		stream = undefined;
		live(undefined);
		if (account === undefined || teamId === undefined) return;
		const end = new AbortController();
		stream = { key, end };
		void listen({
			url: eventsUrl(account.server, teamId),
			// For this server and team, and no other: should this stream ever
			// outlive its account, the worker gives it nothing.
			token: async (fresh) => {
				const answer = await send({
					type: "cloud:token",
					server: account.server,
					teamId,
					fresh,
				});
				return answer.ok ? answer.token : undefined;
			},
			onChange: (cursor) => void send({ type: "cloud:run", cursor }),
			onConnected: (open) => {
				if (stream?.end === end) live(open);
			},
			signal: end.signal,
		}).then(() => {
			// It ended by itself (nobody signed in any more): the next news
			// of an account starts it again.
			if (stream?.end === end) stream = undefined;
		});
	}

	async function refresh(): Promise<void> {
		// Only what the panel shows, of the server chosen (each server has its
		// own part of the database): the books, which may be large, stay unread.
		const all: Record<string, unknown> = {};
		let server: string;
		try {
			server = await chosenServer(kv);
			const mine = scopedKv(kv, server);
			// What is about cases only once the worker forgot those of before
			// (DEC-051): until then they may be a build before this one's.
			const ours = await casesForgotten(kv);
			for (const key of ours
				? [KEYS.account, KEYS.status, KEYS.modes]
				: [KEYS.account])
				all[key] = await mine.get(key);
		} catch (error) {
			problem(
				`Could not read the account: ${message(error)} Close and open the ${PANEL} to try again.`,
			);
			return;
		}
		const account = all[KEYS.account] as Account | undefined;
		update((s) => {
			s.cloud.server = server;
			s.cloud.account =
				account === undefined
					? undefined
					: {
							name: account.user.name,
							email: account.user.email,
							userId: account.user.id,
							server: account.server,
							teams: account.teams.map((t) => ({
								id: t.id,
								name: t.name,
								...(t.slug ? { slug: t.slug } : {}),
								permissions: [...(t.permissions ?? [])],
							})),
							teamId: account.teamId,
							expired: account.expired === true,
						};
			s.cloud.status = all[KEYS.status] as CloudStatus | undefined;
			s.cloud.modes = (all[KEYS.modes] as Record<string, SyncMode>) ?? {};
		});
		follow(account);
	}

	/** Ask the worker and say why not, if not; then read what changed. */
	async function act(request: CloudRequest): Promise<boolean> {
		const answer = await send(request);
		problem(answer.ok ? undefined : answer.error);
		await refresh();
		return answer.ok;
	}

	/** The rest of a sign-in, once the browser's window ended on `redirect`. */
	async function finish(redirect: string): Promise<void> {
		await act({ type: "cloud:finish", redirect });
	}

	function cloudSignIn(): void {
		// Firefox asks for its data consent only during a click: before any await.
		const consent = askDataConsent();
		update((s) => {
			s.cloud.signingIn = true;
			s.cloud.problem = undefined;
		});
		void (async () => {
			if (!(await consent.catch(() => false))) {
				problem(
					`${BROWSER} did not allow it: without that consent nothing is sent, and Sitegloss cannot sync. Click Sign in to ask again.`,
				);
				return;
			}
			const begun = await send({ type: "cloud:begin" });
			if (!begun.ok || begun.url === undefined) {
				problem(begun.ok ? "The sign-in could not start." : begun.error);
				return;
			}
			let ended: string | undefined;
			try {
				ended = await webAuthFlow(begun.url);
			} catch (error) {
				// Closed without signing in: nothing changes, and nothing is wrong.
				// The worker forgets the sign-in, so the server can be chosen again.
				await send({ type: "cloud:abandon", url: begun.url });
				const text = message(error);
				problem(
					/cancel|closed|did not approve|not approve/i.test(text)
						? undefined
						: `The sign-in did not finish: ${text}`,
				);
				return;
			}
			if (ended === undefined) {
				await send({ type: "cloud:abandon", url: begun.url });
				return;
			}
			await finish(ended);
		})().finally(() => update((s) => (s.cloud.signingIn = false)));
	}

	void refresh().then(() => send({ type: "cloud:run" }));
	let checkedAt = Number.NEGATIVE_INFINITY;
	function shown(): void {
		const now = Date.now();
		if (now - checkedAt < SHOWN_CHECK_MS) return;
		checkedAt = now;
		// A change comes back as the worker's news, as any other.
		void send({ type: "cloud:check" }).catch(() => undefined);
	}

	return {
		refresh,
		shown,
		cloudSignIn,
		cloudSignOut: () => void act({ type: "cloud:sign-out" }),
		cloudTeam: (teamId) => void act({ type: "cloud:team", teamId }),
		cloudSyncNow: () => void act({ type: "cloud:run", retry: true }),
		cloudDecide: (share) => void act({ type: "cloud:decide", share }),
		cloudShare: (caseId) => void act({ type: "cloud:share", caseId }),
		cloudServer(text) {
			const value = text.trim();
			const wrong = value === "" ? undefined : serverProblem(value);
			if (wrong !== undefined) {
				problem(wrong);
				return;
			}
			void act({ type: "cloud:server", server: value });
		},
	};
}
