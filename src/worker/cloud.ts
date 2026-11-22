/**
 * The service worker's part of the sync with sitegloss.dev (DEC-039): it is
 * the one that syncs and the one that holds the tokens, so the side panel in
 * two windows, or a panel and a worker, never send the same change twice or
 * use a refresh token twice. The panel asks (`CloudRequest`, over
 * `runtime.sendMessage`, from an extension page only); the worker answers
 * and tells of news (`cloud:changed`).
 *
 * The worker is not kept alive for this: a run is started by what happens
 * (a case changed, the panel opened, the panel heard of a change on the
 * server's events stream, an alarm every few minutes) and the worker may
 * stop when it is over. While a run is under way a call to an extension API
 * every 20 seconds keeps the browser from stopping the worker in the middle
 * of it; what a stopped run left is taken up by the next one.
 *
 * Everything is one server's (DEC-041): the server chosen in the panel (the
 * service itself, unless the user chose another) has its own part of the
 * database, its own tokens and its own engine. Another server never sees
 * what synced with this one.
 */

import { dataConsent, FIREFOX } from "../lib/browser.ts";
import { ApiFailure, httpApi } from "../lib/cloud/api.ts";
import {
	AuthError,
	beginSignIn,
	codeFrom,
	exchangeCode,
	OfflineError,
	PENDING_KEY,
	type PendingSignIns,
	pendingSignIns,
	Session,
	stateOf,
	type Tokens,
} from "../lib/cloud/auth.ts";
import {
	BOOK,
	type CaseBook,
	type CloudStatus,
	casesForgotten,
	forgetCases,
	KEYS,
	readAccount,
	teamOf,
} from "../lib/cloud/book.ts";
import { CloudSync } from "../lib/cloud/engine.ts";
import {
	chosenServer,
	SERVER_KEY,
	scopedKv,
	scopeOf,
	serverOrigin,
	serverProblem,
} from "../lib/cloud/servers.ts";
import { cropImages } from "../lib/images.ts";
import type { Kv } from "../lib/kv.ts";
import type { CloudAnswer, CloudRequest } from "../lib/messages.ts";
import { type CaseStore, DB_VERSION } from "../lib/store.ts";

/** The alarm that looks for the team's changes while no panel listens. */
export const CLOUD_ALARM = "sitegloss-cloud";
/** One more try after the server was not reached. */
export const CLOUD_RETRY_ALARM = "sitegloss-cloud-retry";

/** How often the fallback looks, in minutes. */
export const LOOK_EVERY_MINUTES = 5;

/** A worker that starts this soon after a sync does not ask the server again. */
export const START_QUIET_MS = 60_000;

/** Changes in a row are one run: a mark's save is several writes. */
const QUIET_MS = 300;

const KEEPALIVE_MS = 20_000;

export interface CloudDeps {
	store: CaseStore;
	/** The cloud's database. */
	kv: Kv;
	/** A case here was changed by what came from the team. */
	changed: (caseId: string) => void;
	/** The status changed, or the account: the panels read it again. */
	news: () => void;
	/** Where the browser's sign-in window ends (`identity.getRedirectURL`). */
	redirect: () => string;
	fetch?: (input: string, init?: RequestInit) => Promise<Response>;
	now?: () => number;
	/** The alarms, as `chrome.alarms` has them. */
	alarms?: Pick<typeof chrome.alarms, "create" | "clear" | "get">;
	/** Something that resets the browser's idle timer for the worker. */
	keepAlive?: () => void;
}

const describe = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

/** One server's part: its database, its tokens, its engine. */
export interface ServerScope {
	server: string;
	kv: Kv;
	session: Session;
	engine: CloudSync;
}

/** The account and the sync, as the worker runs them. */
export class Cloud {
	readonly #deps: CloudDeps;
	readonly #scopes = new Map<string, ServerScope>();
	readonly #fetch: (input: string, init?: RequestInit) => Promise<Response>;
	readonly #now: () => number;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#running = 0;
	#keep: ReturnType<typeof setInterval> | undefined;
	/** Tries in a row that did not reach the server. */
	#failures = 0;

	constructor(deps: CloudDeps) {
		this.#deps = deps;
		this.#fetch = deps.fetch ?? ((input, init) => fetch(input, init));
		this.#now = deps.now ?? Date.now;
	}

	/** The part of `server`: made once, and kept apart from every other server's. */
	#scope(server: string): ServerScope {
		const known = this.#scopes.get(server);
		if (known !== undefined) return known;
		const deps = this.#deps;
		const kv = scopedKv(deps.kv, server);
		const session = new Session(kv, this.#fetch, this.#now);
		const api = httpApi({
			server,
			token: (fresh) => session.access(server, fresh),
			fetch: this.#fetch,
		});
		const engine = new CloudSync({
			store: deps.store,
			kv,
			api: () => api,
			now: () => new Date(this.#now()),
			onChange: (ids) => {
				for (const id of ids) deps.changed(id);
			},
			onStatus: (status) => this.#heard(status),
			// The panel's question is answered once the choice is written down.
			later: (run) => void this.#run(() => run),
			elsewhere: () => this.#elsewhere(server),
			casesReady: () => this.#casesReady(),
			// A crop for a mark an AI app added at the server (DEC-047).
			cutCrop: async (shot, rect, viewportWidth) => {
				const [crop] = await cropImages(
					shot.blob,
					[rect],
					shot.width / viewportWidth,
				);
				if (crop === undefined) throw new Error("no crop");
				return crop;
			},
		});
		const scope: ServerScope = { server, kv, session, engine };
		this.#scopes.set(server, scope);
		return scope;
	}

	/**
	 * Whether the cases and the books are this build's (DEC-051): the case
	 * store opened at its version 2 (its upgrade emptied it), then the cloud's
	 * database brought along in one step (`forgetCases`): here, in the
	 * worker, and nowhere else. The store not open yet (held up by a build
	 * before this one, say): no, and nothing is forgotten.
	 */
	async #casesReady(): Promise<boolean> {
		const deps = this.#deps;
		if ((await deps.store.version()) !== DB_VERSION) return false;
		await forgetCases(deps.kv);
		return casesForgotten(deps.kv);
	}

	/**
	 * The cases another server than `server` had from this device: its books
	 * that say what that server last confirmed.
	 */
	async #elsewhere(server: string): Promise<Set<string>> {
		const mine = scopeOf(server);
		const found = new Set<string>();
		for (const [key, value] of Object.entries(await this.#deps.kv.all())) {
			if (!key.startsWith("@") || key.startsWith(mine)) continue;
			const at = key.indexOf(` ${BOOK}`);
			if (at < 0) continue;
			if ((value as CaseBook | undefined)?.shadow !== undefined)
				found.add(key.slice(at + 1 + BOOK.length));
		}
		return found;
	}

	/** The server chosen: the service, unless the user chose another. */
	server(): Promise<string> {
		return chosenServer(this.#deps.kv);
	}

	/** The chosen server's part. */
	async current(): Promise<ServerScope> {
		return this.#scope(await this.server());
	}

	/** Who is signed in at the chosen server, by id; none: nobody. */
	async me(): Promise<string | undefined> {
		return (await readAccount((await this.current()).kv))?.user.id;
	}

	/** The team a case syncs with, by name; none: it is on this device only. */
	async teamOf(caseId: string): Promise<string | undefined> {
		const { kv } = await this.current();
		const account = await readAccount(kv);
		const team = teamOf(account);
		if (team === undefined || account?.expired) return undefined;
		const modes = (await kv.get(KEYS.modes)) as
			| Record<string, string>
			| undefined;
		const mode = modes?.[caseId];
		return mode === undefined || mode === "synced" ? team.name : undefined;
	}

	/**
	 * The worker started: take up what a stopped run left, and look for the
	 * team's changes, unless it just did: a worker is started often (an alarm
	 * of the AI connection every minute, each message), and each start is no
	 * reason to ask the server.
	 */
	start(): void {
		void this.#schedule();
		void (async () => {
			const { kv } = await this.current();
			const [status, queue] = await Promise.all([
				kv.get(KEYS.status).catch(() => undefined),
				kv.get(KEYS.queue).catch(() => undefined),
			]);
			const last = Date.parse(
				(status as CloudStatus | undefined)?.lastSyncedAt ?? "",
			);
			// Whatever came of it (a refusal held back leaves the state at
			// "problem" for long): it looked, and need not at every start.
			const fresh = this.#now() - last < START_QUIET_MS;
			if (queue === undefined && fresh) return;
			this.request();
		})();
	}

	/** A case changed, or it is time to look: one run, after a quiet moment. */
	request(): void {
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.#run(), QUIET_MS);
	}

	async #run(
		work: () => Promise<void> = async () =>
			(await this.current()).engine.request(),
	) {
		this.#running++;
		// A long upload makes no extension API call by itself.
		this.#keep ??= setInterval(() => this.#deps.keepAlive?.(), KEEPALIVE_MS);
		try {
			await work();
		} finally {
			if (--this.#running === 0) {
				clearInterval(this.#keep);
				this.#keep = undefined;
			}
		}
	}

	/** What a run came to: tell the panels, and try again later if it did not get through. */
	#heard(status: CloudStatus): void {
		this.#deps.news();
		const alarms = this.#deps.alarms;
		if (alarms === undefined) return;
		if (
			status.state === "offline" ||
			(status.state === "problem" && status.text)
		) {
			this.#failures++;
			// Half a minute, then one, two, and five at most.
			const minutes = Math.min(5, 0.5 * 2 ** (this.#failures - 1));
			void alarms.create(CLOUD_RETRY_ALARM, { delayInMinutes: minutes });
		} else if (status.state !== "syncing") {
			this.#failures = 0;
			void alarms.clear(CLOUD_RETRY_ALARM);
		}
	}

	/** The alarm that looks now and then: there while a team is chosen. */
	async #schedule(): Promise<void> {
		const alarms = this.#deps.alarms;
		if (alarms === undefined) return;
		const account = await readAccount((await this.current()).kv).catch(
			() => undefined,
		);
		if (teamOf(account) === undefined || account?.expired) {
			await alarms.clear(CLOUD_ALARM);
			return;
		}
		// Made once: making it again at each start would begin its wait anew.
		if ((await alarms.get(CLOUD_ALARM)) === undefined)
			await alarms.create(CLOUD_ALARM, { periodInMinutes: LOOK_EVERY_MINUTES });
	}

	/** An alarm of the browser's; whether it was one of these. */
	alarm(name: string): boolean {
		if (name !== CLOUD_ALARM && name !== CLOUD_RETRY_ALARM) return false;
		this.request();
		return true;
	}

	/**
	 * Firefox's data collection consent was taken back: nothing may go to the
	 * server any more, so the account is signed out (the cases stay here).
	 */
	async consentChanged(): Promise<void> {
		if (!FIREFOX || (await dataConsent())) return;
		if ((await readAccount((await this.current()).kv)) !== undefined)
			await this.#signOut();
	}

	async #signOut(): Promise<void> {
		const { kv, engine, session, server } = await this.current();
		// The tokens go first, and at once: a run under way (a long upload, a
		// request that never answers) ends at its next request instead of
		// going on after the click, and the sign-out is not lost behind it.
		// They go whatever the server says; it is told if it answers.
		const tokens = await session.forget();
		const told =
			tokens === undefined
				? Promise.resolve()
				: session.revoke(server, tokens).catch(() => undefined);
		await kv.remove(PENDING_KEY);
		await engine.signOut();
		await told;
		await this.#schedule();
		this.#deps.news();
	}

	/** What a side panel asks. Never rejects: a failure is an answer. */
	async handle(request: CloudRequest): Promise<CloudAnswer> {
		try {
			return await this.#handle(request);
		} catch (error) {
			return {
				ok: false,
				error:
					error instanceof AuthError ||
					error instanceof OfflineError ||
					error instanceof ApiFailure
						? error.message
						: `Sitegloss could not do that: ${describe(error)}`,
			};
		}
	}

	async #handle(request: CloudRequest): Promise<CloudAnswer> {
		const { kv, engine, session, server } = await this.current();
		switch (request.type) {
			case "cloud:begin": {
				// Where this server signs people in: asked of the server itself.
				const { pending, url } = await beginSignIn(
					server,
					await session.endpoints(server, true),
					this.#deps.redirect(),
					this.#now(),
				);
				// Kept by its state: a second window's sign-in is another one,
				// and neither takes the other's secrets.
				await kv.set({
					[PENDING_KEY]: {
						...pendingSignIns(await kv.get(PENDING_KEY), this.#now()),
						[pending.state]: pending,
					},
				});
				return { ok: true, url };
			}
			case "cloud:abandon": {
				// Its window closed without an answer: no sign-in is under way.
				const { [stateOf(request.url)]: _gone, ...rest } = pendingSignIns(
					await kv.get(PENDING_KEY),
					this.#now(),
				);
				if (Object.keys(rest).length > 0) await kv.set({ [PENDING_KEY]: rest });
				else await kv.remove(PENDING_KEY);
				return { ok: true };
			}
			case "cloud:finish": {
				const all = ((await kv.get(PENDING_KEY)) ?? {}) as PendingSignIns;
				const state = stateOf(request.redirect);
				const pending = Object.hasOwn(all, state) ? all[state] : undefined;
				if (
					pending === undefined ||
					pending.state !== state ||
					pending.server !== server
				)
					throw new AuthError(
						Object.keys(all).length > 0
							? "The sign-in's answer is not for this sign-in."
							: "No sign-in is under way. Try again.",
					);
				// One try: a second answer for it is not taken. It stays in the
				// book as "finishing" until the account is written (or the try
				// failed): until then a sign-in is under way, and the server
				// is not chosen anew from another window.
				if (pending.finishing)
					throw new AuthError("No sign-in is under way. Try again.");
				await kv.set({
					[PENDING_KEY]: { ...all, [state]: { ...pending, finishing: true } },
				});
				const over = async () => {
					const { [state]: _used, ...others } = ((await kv.get(PENDING_KEY)) ??
						{}) as PendingSignIns;
					if (Object.keys(others).length > 0)
						await kv.set({ [PENDING_KEY]: others });
					else await kv.remove(PENDING_KEY);
				};
				let tokens: Tokens;
				try {
					const code = codeFrom(pending, request.redirect, this.#now());
					tokens = await exchangeCode(this.#fetch, pending, code, this.#now());
				} catch (error) {
					await over();
					throw error;
				}
				try {
					// Still the server this sign-in began at: tokens of one
					// server are never kept as another's.
					if ((await this.server()) !== server)
						throw new AuthError(
							"The server was changed while signing in. Sign in again.",
						);
					await session.store(tokens);
					const me = await httpApi({
						server,
						token: (fresh) => session.access(server, fresh),
						fetch: this.#fetch,
					}).me();
					await engine.signedIn(server, me);
				} catch (error) {
					// Signed in at the server, and not here: tokens without an
					// account have no "Sign out" to end them, so they are ended
					// now, here and at the server.
					await session.forget();
					await session.revoke(server, tokens).catch(() => undefined);
					await over();
					throw error;
				}
				// Signed in: any other sign-in begun is over.
				await kv.remove(PENDING_KEY);
				await this.#schedule();
				this.#deps.news();
				return { ok: true };
			}
			case "cloud:sign-out":
				await this.#signOut();
				return { ok: true };
			case "cloud:team":
				await engine.chooseTeam(request.teamId);
				await this.#schedule();
				this.#deps.news();
				return { ok: true };
			case "cloud:decide":
				await engine.decide(request.share);
				this.#deps.news();
				return { ok: true };
			case "cloud:share":
				await engine.share(request.caseId);
				this.#deps.news();
				return { ok: true };
			case "cloud:check":
				if (await engine.checkAccount()) this.#deps.news();
				return { ok: true };
			case "cloud:run": {
				// The events stream says where the team is: nothing to fetch when
				// this device is there already.
				if (request.cursor !== undefined) {
					const seen = await kv.get(KEYS.cursor);
					if (typeof seen === "number" && seen >= request.cursor)
						return { ok: true };
				}
				if (request.retry) void this.#run(() => engine.retry());
				else this.request();
				return { ok: true };
			}
			case "cloud:token": {
				const account = await readAccount(kv);
				const team = teamOf(account);
				if (account === undefined || team === undefined || account.expired)
					return { ok: false, error: "Not signed in." };
				// For the server and team the stream is of, and no other: a
				// stream that outlived its account gets nothing.
				if (
					request.server !== server ||
					account.server !== server ||
					request.teamId !== team.id
				)
					return { ok: false, error: "Not signed in there." };
				return {
					ok: true,
					token: await session.access(server, request.fresh === true),
				};
			}
			case "cloud:server": {
				// Another server is another account: signed out here first, so
				// nothing of this one's is ever sent there by a switch.
				if ((await readAccount(kv)) !== undefined)
					throw new AuthError("Sign out before choosing another server.");
				// A sign-in under way would end at the server it began at,
				// with the chooser at another: first finished, or its window closed.
				const open = pendingSignIns(await kv.get(PENDING_KEY), this.#now());
				if (Object.keys(open).length > 0)
					throw new AuthError(
						"A sign-in is under way. Finish it, or close its window, before choosing another server.",
					);
				const text = request.server.trim();
				if (text === "") {
					await this.#deps.kv.remove(SERVER_KEY);
				} else {
					const problem = serverProblem(text);
					if (problem !== undefined) throw new AuthError(problem);
					await this.#deps.kv.set({ [SERVER_KEY]: serverOrigin(text) });
				}
				await this.#schedule();
				this.#deps.news();
				return { ok: true };
			}
		}
	}
}
