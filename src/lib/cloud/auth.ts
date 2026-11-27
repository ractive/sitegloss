/**
 * Signing in to sitegloss.dev (DEC-039): OAuth 2.1 with PKCE as a public
 * client, in plain `fetch` and Web Crypto. The browser's own sign-in window
 * (`identity.launchWebAuthFlow`) is the caller's: this file only makes the
 * address it opens and reads the address it ends on, so it runs in a test as
 * it does in the worker.
 *
 * Refresh tokens rotate: every answer carries a new one, which is stored
 * before anything else is done with the access token, and an old one used
 * again ends the grant at the server. So one place refreshes (the service
 * worker), one refresh at a time.
 */

import { debugLog } from "../debug.ts";
import type { Kv } from "../kv.ts";
import { MAX_SMALL_BYTES, readJson, TooLarge } from "./body.ts";

/** The extension, as the server knows it: a public client, no secret. */
export const CLIENT_ID = "sitegloss-extension";

export const SCOPE =
	"openid profile email offline_access cases:read cases:write";

/** The API's name in a token request: what makes the access token one for it. */
const resourceOf = (server: string) => `${server}/api`;

/**
 * Where a server signs people in, as its own discovery document says
 * (RFC 8414). Nothing here knows these paths: they are what the server at
 * the chosen address answers, and they have to be at that address.
 */
export interface Endpoints {
	authorize: string;
	token: string;
	/** Where a grant is ended; a server without one is only forgotten here. */
	revoke?: string;
}

/** The discovery document of the server at `server` (its issuer is `<server>/api/auth`). */
export const discoveryUrl = (server: string) =>
	`${server}/.well-known/oauth-authorization-server/api/auth`;

/** The key a server's endpoints are kept under, in that server's part of the database. */
export const ENDPOINTS_KEY = "endpoints";

/**
 * Ask the server where it signs people in. An endpoint anywhere else than at
 * the server's own address is refused: the address the user chose (or never
 * had to choose) is where the password and the tokens go, nowhere else.
 */
export async function discover(
	fetcher: Fetch,
	server: string,
): Promise<Endpoints> {
	let response: Response;
	try {
		response = await fetcher(discoveryUrl(server), {
			credentials: "omit",
			// The chosen server answers, nobody it points at.
			redirect: "error",
			cache: "no-store",
		});
	} catch (error) {
		throw new OfflineError(error);
	}
	const body = (response.ok ? await smallJson(response) : undefined) as
		| Record<string, unknown>
		| undefined;
	const at = (name: string): string | undefined => {
		const value = body?.[name];
		try {
			return typeof value === "string" && new URL(value).origin === server
				? value
				: undefined;
		} catch {
			// Not an address.
			return undefined;
		}
	};
	const authorize = at("authorization_endpoint");
	const token = at("token_endpoint");
	// The document has to be this server's own (RFC 8414, 3.3).
	const own = body?.["issuer"] === `${server}/api/auth`;
	if (!own || authorize === undefined || token === undefined)
		throw new AuthError(
			`${hostOf(server)} does not answer as a Sitegloss server (${response.ok ? "its sign-in addresses are missing or lead elsewhere" : `it answered ${response.status}`}).`,
		);
	const revoke = at("revocation_endpoint");
	return { authorize, token, ...(revoke === undefined ? {} : { revoke }) };
}

const hostOf = (server: string): string => {
	try {
		return new URL(server).host;
	} catch {
		// Not an address.
		return server;
	}
};

/** What the server gave at sign-in or at the last refresh. */
export interface Tokens {
	access: string;
	refresh: string;
	/** When the access token runs out (ms since the epoch). */
	expiresAt: number;
}

/** A sign-in under way: kept until the browser's window comes back. */
export interface PendingSignIn {
	/**
	 * Its answer came and is being changed for tokens: no second answer is
	 * taken for it, and it still counts as a sign-in under way (the server
	 * is not chosen anew) until the account is written or the try failed.
	 */
	finishing?: true;
	server: string;
	/** Where the code is changed for tokens, as the server said when it began. */
	token: string;
	verifier: string;
	state: string;
	redirect: string;
	/** When it started (ms): an old one is not finished. */
	at: number;
}

/** The sign-in cannot go on, or the session is over: said to the user as it is. */
export class AuthError extends Error {
	override name = "AuthError";
	constructor(
		message: string,
		/** The grant is gone (revoked, expired, used twice): sign in again. */
		readonly signedOut = false,
	) {
		super(message);
	}
}

const base64url = (bytes: Uint8Array): string =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

/** 32 random bytes as base64url: a PKCE verifier, or a state. */
export function randomToken(): string {
	return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** The S256 challenge of a PKCE verifier. */
export async function challengeOf(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(verifier),
	);
	return base64url(new Uint8Array(digest));
}

/** A sign-in's secret parts, and the address the browser's window opens. */
export async function beginSignIn(
	server: string,
	endpoints: Endpoints,
	redirect: string,
	now: number,
): Promise<{ pending: PendingSignIn; url: string }> {
	const pending: PendingSignIn = {
		server,
		token: endpoints.token,
		verifier: randomToken(),
		state: randomToken(),
		redirect,
		at: now,
	};
	const query = new URLSearchParams({
		response_type: "code",
		client_id: CLIENT_ID,
		redirect_uri: redirect,
		scope: SCOPE,
		state: pending.state,
		code_challenge: await challengeOf(pending.verifier),
		code_challenge_method: "S256",
		resource: resourceOf(server),
	});
	return { pending, url: `${endpoints.authorize}?${query}` };
}

/** How long a sign-in's window may stay open. */
export const SIGN_IN_MAX_MS = 15 * 60_000;

/**
 * The code in the address the browser's window ended on. Refused: an address
 * that is not this sign-in's (another redirect, another state), and the
 * server's own "no" (`error`), in its words.
 */
export function codeFrom(
	pending: PendingSignIn,
	ended: string,
	now: number,
): string {
	let url: URL;
	try {
		url = new URL(ended);
	} catch {
		// Not an address: said below.
		throw new AuthError("The sign-in did not come back with an address.");
	}
	if (now - pending.at > SIGN_IN_MAX_MS)
		throw new AuthError("The sign-in took too long. Try again.");
	const back = new URL(pending.redirect);
	if (url.origin !== back.origin || url.pathname !== back.pathname)
		throw new AuthError("The sign-in came back to another address.");
	// Whose answer it is comes first: also a "no" is taken only from the
	// sign-in it answers (the server returns the state with an error too).
	if (url.searchParams.get("state") !== pending.state)
		throw new AuthError("The sign-in's answer is not for this sign-in.");
	const failed = url.searchParams.get("error");
	if (failed !== null)
		throw new AuthError(
			failed === "access_denied"
				? "The sign-in was not allowed."
				: `The sign-in failed: ${(url.searchParams.get("error_description") ?? failed).slice(0, 300)}`,
		);
	const code = url.searchParams.get("code");
	if (code === null || code === "")
		throw new AuthError("The sign-in came back without a code.");
	return code;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The token endpoint's answer, as far as it is used. */
function tokensOf(body: unknown, now: number, before?: Tokens): Tokens {
	const o = (typeof body === "object" && body !== null ? body : {}) as Record<
		string,
		unknown
	>;
	const access = o["access_token"];
	const refresh = o["refresh_token"] ?? before?.refresh;
	const expires = o["expires_in"];
	if (typeof access !== "string" || typeof refresh !== "string")
		throw new AuthError("The server's answer holds no tokens.");
	return {
		access,
		refresh,
		expiresAt:
			now + (typeof expires === "number" && expires > 0 ? expires : 300) * 1000,
	};
}

async function tokenRequest(
	fetcher: Fetch,
	server: string,
	endpoint: string,
	fields: Record<string, string>,
	now: number,
	before?: Tokens,
): Promise<Tokens> {
	let response: Response;
	try {
		response = await fetcher(endpoint, {
			method: "POST",
			// No cookies, ever: the browser has the user's session with the
			// server after the sign-in window, and a request that carries it
			// from the extension's origin is refused there (and rightly: the
			// extension is its tokens, not the user's session).
			credentials: "omit",
			// The chosen server answers, nobody it points at.
			redirect: "error",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				...fields,
				client_id: CLIENT_ID,
				resource: resourceOf(server),
			}).toString(),
		});
	} catch (error) {
		throw new OfflineError(error);
	}
	const body = await smallJson(response);
	if (response.ok) return tokensOf(body, now, before);
	const code = (body as { error?: unknown } | undefined)?.error;
	// The grant is gone only when the server says so of this token or code
	// (`invalid_grant`). Any other no (`invalid_client` after a bad deploy,
	// `invalid_request`, a 400 or 401 from a proxy in front) is the server's
	// trouble, tried again later: it must not sign everybody out.
	if (code === "invalid_grant")
		throw new AuthError("The sign-in is no longer valid. Sign in again.", true);
	throw new AuthError(
		`The server answered ${response.status}${typeof code === "string" ? ` (${code.slice(0, 80)})` : ""} to the sign-in.`,
	);
}

/** A small answer (tokens, a discovery document), read as one: up to a megabyte. */
async function smallJson(response: Response): Promise<unknown> {
	try {
		return await readJson(response, MAX_SMALL_BYTES);
	} catch (error) {
		if (error instanceof TooLarge) throw new AuthError(error.message);
		throw new OfflineError(error);
	}
}

/** The server could not be reached at all: try again later. */
export class OfflineError extends Error {
	override name = "OfflineError";
	constructor(cause: unknown) {
		super(
			`The server could not be reached${cause instanceof Error && cause.message ? ` (${cause.message})` : ""}.`,
		);
	}
}

/** Change a sign-in's code for tokens. */
export function exchangeCode(
	fetcher: Fetch,
	pending: PendingSignIn,
	code: string,
	now: number,
): Promise<Tokens> {
	return tokenRequest(
		fetcher,
		pending.server,
		pending.token,
		{
			grant_type: "authorization_code",
			code,
			redirect_uri: pending.redirect,
			code_verifier: pending.verifier,
		},
		now,
	);
}

/** New tokens for a refresh token; the old one is used up by this. */
export function refreshTokens(
	fetcher: Fetch,
	server: string,
	endpoints: Endpoints,
	tokens: Tokens,
	now: number,
): Promise<Tokens> {
	return tokenRequest(
		fetcher,
		server,
		endpoints.token,
		{ grant_type: "refresh_token", refresh_token: tokens.refresh },
		now,
		tokens,
	);
}

/** End the grant at the server; a server that cannot be reached is left. */
/** How long the server has to answer a sign-out. */
export const REVOKE_TIMEOUT_MS = 10_000;

export async function revokeTokens(
	fetcher: Fetch,
	endpoints: Endpoints,
	tokens: Tokens,
): Promise<boolean> {
	if (endpoints.revoke === undefined) return false;
	try {
		const response = await fetcher(endpoints.revoke, {
			method: "POST",
			credentials: "omit",
			// The chosen server answers, nobody it points at.
			redirect: "error",
			// A sign-out does not wait for a server that does not answer.
			signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				token: tokens.refresh,
				token_type_hint: "refresh_token",
				client_id: CLIENT_ID,
			}).toString(),
		});
		return response.ok;
	} catch (error) {
		debugLog("token revoke", error);
		return false;
	}
}

/** Keys of the tokens in the cloud's database (book.ts has the rest). */
export const TOKENS_KEY = "tokens";
export const PENDING_KEY = "sign-in";

/** The sign-ins under way, by their `state`: two windows may each have one. */
export type PendingSignIns = Record<string, PendingSignIn>;

/** What is kept under `PENDING_KEY`, without the sign-ins that took too long. */
export function pendingSignIns(stored: unknown, now: number): PendingSignIns {
	const live: PendingSignIns = {};
	if (typeof stored !== "object" || stored === null) return live;
	for (const [state, pending] of Object.entries(stored as PendingSignIns))
		if (
			typeof pending?.state === "string" &&
			pending.state === state &&
			now - pending.at <= SIGN_IN_MAX_MS
		)
			live[state] = pending;
	return live;
}

/** The `state` in an address (the window's, or the one it ended on); none: "". */
export function stateOf(address: string): string {
	try {
		return new URL(address).searchParams.get("state") ?? "";
	} catch {
		// Not an address.
		return "";
	}
}

/** The waits between the tries of one refresh request whose answer did not come. */
export const REFRESH_RETRY_MS: readonly number[] = [2000, 6000, 10_000];

/** An access token is renewed this long before it runs out. */
const EARLY_MS = 60_000;

/**
 * The tokens of whoever is signed in at one server (`kv` is that server's
 * part of the database): read at each use (a worker restarts), renewed when
 * they are about to run out, one renewal at a time. Where the server signs
 * people in is what it said itself (`discover`), kept beside the tokens.
 */
export class Session {
	#renewing: Promise<Tokens> | undefined;
	/**
	 * Raised whenever the tokens are set or forgotten from outside a
	 * renewal (a sign-in, a sign-out): a renewal under way, which can wait
	 * for seconds between its tries, sees by it that its tokens are no
	 * longer the ones to renew.
	 */
	#generation = 0;

	constructor(
		private readonly kv: Kv,
		private readonly fetcher: Fetch,
		private readonly now: () => number = Date.now,
		private readonly sleep: (ms: number) => Promise<void> = (ms) =>
			new Promise((done) => setTimeout(done, ms)),
	) {}

	async tokens(): Promise<Tokens | undefined> {
		const stored = (await this.kv.get(TOKENS_KEY)) as Tokens | undefined;
		return typeof stored?.access === "string" &&
			typeof stored.refresh === "string"
			? stored
			: undefined;
	}

	/**
	 * The server's sign-in addresses: asked for now (`fresh`, at a sign-in),
	 * else as last answered, and asked for when never answered.
	 */
	async endpoints(server: string, fresh = false): Promise<Endpoints> {
		const kept = (await this.kv.get(ENDPOINTS_KEY)) as Endpoints | undefined;
		if (!fresh && typeof kept?.token === "string") return kept;
		const now = await discover(this.fetcher, server);
		await this.kv.set({ [ENDPOINTS_KEY]: now });
		return now;
	}

	/**
	 * An access token that still holds; `fresh`: a new one whatever the old
	 * one's time says (the server refused it). `AuthError` with `signedOut`
	 * when there are no tokens or the grant is gone.
	 */
	async access(server: string, fresh = false): Promise<string> {
		const tokens = await this.tokens();
		if (tokens === undefined)
			throw new AuthError("Not signed in. Sign in again.", true);
		if (!fresh && tokens.expiresAt - EARLY_MS > this.now())
			return tokens.access;
		return (await this.#renew(server, tokens)).access;
	}

	#renew(server: string, tokens: Tokens): Promise<Tokens> {
		// One at a time: the second caller's refresh token would be the used one.
		this.#renewing ??= (async () => {
			// Whose tokens these are: a sign-out, or a sign-in of someone
			// else, while this waits between its tries makes them nobody's.
			const mine = this.#generation;
			const over = () =>
				new AuthError("The sign-in changed meanwhile. Sign in again.", true);
			try {
				const endpoints = await this.endpoints(server);
				// A request whose answer did not come may have arrived: the
				// server has then rotated the token, and gives the same answer
				// again for a short while (30 s), after which a second use ends
				// the grant. So the same request is sent again soon, a few
				// times within that while, before it is given up as offline;
				// waiting for the next run would be the try that signs out.
				for (let attempt = 0; ; attempt++) {
					if (this.#generation !== mine) throw over();
					try {
						const next = await refreshTokens(
							this.fetcher,
							server,
							endpoints,
							tokens,
							this.now(),
						);
						// Signed out, or signed in anew, while the answer was on
						// its way: these tokens are live and nobody's. They are
						// not stored (they would bring a signed-out account's
						// tokens back, or put one person's under another's
						// account), and their grant is ended at the server.
						if (this.#generation !== mine) {
							await revokeTokens(this.fetcher, endpoints, next);
							throw over();
						}
						// Stored before it is used: the old refresh token is spent.
						await this.kv.set({ [TOKENS_KEY]: next });
						return next;
					} catch (error) {
						const wait = REFRESH_RETRY_MS[attempt];
						if (!(error instanceof OfflineError) || wait === undefined)
							throw error;
						await this.sleep(wait);
					}
				}
			} finally {
				this.#renewing = undefined;
			}
		})();
		return this.#renewing;
	}

	async store(tokens: Tokens): Promise<void> {
		this.#generation++;
		await this.kv.set({ [TOKENS_KEY]: tokens });
	}

	/** Forget the tokens here, at once; what they were, for the server to be told. */
	async forget(): Promise<Tokens | undefined> {
		this.#generation++;
		const tokens = await this.tokens();
		await this.kv.remove(TOKENS_KEY);
		return tokens;
	}

	/** End the grant of `tokens` at the server, if it answers. */
	async revoke(server: string, tokens: Tokens): Promise<void> {
		const endpoints = await this.endpoints(server).catch((error: unknown) =>
			debugLog("sign-in endpoints", error),
		);
		if (endpoints !== undefined)
			await revokeTokens(this.fetcher, endpoints, tokens);
	}

	/** Forget the tokens here, and end the grant at the server if it answers. */
	async end(server: string | undefined): Promise<void> {
		const tokens = await this.forget();
		if (tokens !== undefined && server !== undefined)
			await this.revoke(server, tokens);
	}
}
