/**
 * Signing in to sitegloss.dev and talking to it (DEC-039): PKCE, the tokens
 * and their rotation, the API over HTTP, and the events stream. The server
 * here is a `fetch` that answers as the real one's token endpoint does.
 */

import { describe, expect, test } from "bun:test";
import {
	ApiFailure,
	httpApi,
	MAX_IMAGE_BYTES,
	MAX_JSON_BYTES,
	SMALL_PAGE,
	TOO_LARGE,
} from "../src/lib/cloud/api.ts";
import {
	AuthError,
	beginSignIn,
	CLIENT_ID,
	challengeOf,
	codeFrom,
	discover,
	ENDPOINTS_KEY,
	type Endpoints,
	exchangeCode,
	OfflineError,
	type PendingSignIn,
	pendingSignIns,
	refreshTokens,
	revokeTokens,
	Session,
	stateOf,
	TOKENS_KEY,
	type Tokens,
} from "../src/lib/cloud/auth.ts";
import {
	DEVELOPMENT_SERVER,
	DEVELOPMENT_SERVERS,
	PRODUCTION_SERVER,
	scopedKv,
	serverKind,
	serverLabel,
	serverNote,
	serverOrigin,
	serverProblem,
} from "../src/lib/cloud/servers.ts";
import {
	changeCursor,
	EventParser,
	listen,
	MAX_LINE,
	StreamTooLong,
} from "../src/lib/cloud/sse.ts";
import { memoryKv } from "../src/lib/kv.ts";

const SERVER = "https://app.sitegloss.dev";
const REDIRECT = "https://ldmcfigcnobhnbaigehcaodheklibeon.chromiumapp.org/";

/** Where the server signs people in, as its discovery document says. */
const ENDPOINTS: Endpoints = {
	authorize: `${SERVER}/api/auth/oauth2/authorize`,
	token: `${SERVER}/api/auth/oauth2/token`,
	revoke: `${SERVER}/api/auth/oauth2/revoke`,
};
const DISCOVERY = `${SERVER}/.well-known/oauth-authorization-server/api/auth`;

/**
 * A token endpoint whose refresh tokens rotate, as the real one's: a used
 * one gives the same answer again for 30 s (the answer may have been lost),
 * and ends the grant after that.
 */
function tokenServer(clock: { ms: number } = { ms: 0 }) {
	let n = 0;
	/** The refresh token before this one, its answer, and when it was used. */
	let last: { refresh: string; answer: object; at: number } | undefined;
	const state = {
		refresh: "r0",
		revoked: false,
		/** The next so many refresh requests arrive, and their answers do not. */
		loseAnswers: 0,
		/** What the token endpoint answers instead, when set: a server in trouble. */
		trouble: undefined as Response | undefined,
		/** How often the server was asked where it signs people in. */
		discoveries: 0,
		requests: [] as URLSearchParams[],
		offline: false,
		/** Leave the new refresh token out of the next answer. */
		keepRefresh: false,
	};
	const fetcher = async (
		input: string,
		init?: RequestInit,
	): Promise<Response> => {
		if (state.offline) throw new TypeError("Failed to fetch");
		if (input === DISCOVERY) {
			state.discoveries++;
			return Response.json({
				issuer: `${SERVER}/api/auth`,
				authorization_endpoint: ENDPOINTS.authorize,
				token_endpoint: ENDPOINTS.token,
				revocation_endpoint: ENDPOINTS.revoke,
				jwks_uri: `${SERVER}/api/auth/jwks`,
			});
		}
		const body = new URLSearchParams(String(init?.body ?? ""));
		state.requests.push(body);
		if (input.endsWith("/revoke")) {
			// Only this client's own, current refresh token ends the grant.
			if (
				body.get("client_id") !== CLIENT_ID ||
				body.get("token") !== state.refresh
			)
				return Response.json({ error: "invalid_request" }, { status: 400 });
			state.revoked = true;
			return Response.json({});
		}
		if (state.trouble !== undefined) return state.trouble.clone();
		if (body.get("grant_type") === "authorization_code") {
			if (body.get("code") !== "the-code")
				return Response.json({ error: "invalid_grant" }, { status: 400 });
			state.refresh = `r${++n}`;
			return Response.json({
				access_token: `a${n}`,
				refresh_token: state.refresh,
				expires_in: 3600,
				token_type: "Bearer",
				somethingNew: true,
			});
		}
		const used = body.get("refresh_token");
		const lose = () => {
			if (state.loseAnswers === 0) return false;
			state.loseAnswers--;
			return true;
		};
		// The one before, again, within the grace period: the same answer.
		if (
			!state.revoked &&
			last !== undefined &&
			used === last.refresh &&
			clock.ms - last.at <= 30_000
		) {
			if (lose()) throw new TypeError("Failed to fetch");
			return Response.json(last.answer);
		}
		if (state.revoked || used !== state.refresh) {
			// An old refresh token: the whole grant is gone.
			state.revoked = true;
			return Response.json(
				{ error: "invalid_grant", error_description: "session not found" },
				{ status: 400 },
			);
		}
		const before = state.refresh;
		state.refresh = state.keepRefresh ? before : `r${++n}`;
		if (state.keepRefresh) n++;
		const answer = {
			access_token: `a${n}`,
			...(state.keepRefresh ? {} : { refresh_token: state.refresh }),
			expires_in: 3600,
		};
		if (!state.keepRefresh) last = { refresh: before, answer, at: clock.ms };
		if (lose()) throw new TypeError("Failed to fetch");
		return Response.json(answer);
	};
	fetchers.set(state, fetcher);
	return { state, fetcher };
}

/** The token server a state is of, for a second session over the same server. */
const fetchers = new WeakMap<
	object,
	(input: string, init?: RequestInit) => Promise<Response>
>();
const tokenServerOf = (state: object) =>
	fetchers.get(state) as (
		input: string,
		init?: RequestInit,
	) => Promise<Response>;

const pending = (at = 1000): PendingSignIn => ({
	server: SERVER,
	token: ENDPOINTS.token,
	verifier: "the-verifier",
	state: "the-state",
	redirect: REDIRECT,
	at,
});

describe("the server's address", () => {
	test("https anywhere, plain http only on this machine", () => {
		expect(serverProblem("https://app.sitegloss.dev")).toBeUndefined();
		expect(serverProblem("http://localhost:3200")).toBeUndefined();
		expect(serverProblem("http://127.0.0.1:3200/")).toBeUndefined();
		expect(serverProblem("http://sitegloss.example")).toBe(
			"Plain http: works only for localhost; use https: for other hosts.",
		);
		expect(serverProblem("ftp://x")).toBe("Use an https: address.");
		expect(serverProblem("not an address")).toBe("Not an address.");
		// Kept as its origin: a path or a slash typed after it means nothing.
		expect(serverOrigin("http://localhost:3200/app/")).toBe(
			"http://localhost:3200",
		);
		expect(serverOrigin("javascript:alert(1)")).toBeUndefined();
	});
});

describe("the servers there are to choose from (DEC-041)", () => {
	test("the service, its development server under either of its addresses, and any other", () => {
		expect(PRODUCTION_SERVER).toBe("https://app.sitegloss.dev");
		expect(DEVELOPMENT_SERVERS).toEqual([
			"https://app.dev.sitegloss.dev",
			"https://app-dev.sitegloss.dev",
		]);
		expect(DEVELOPMENT_SERVER).toBe(DEVELOPMENT_SERVERS[0] as string);
		expect(serverKind(PRODUCTION_SERVER)).toBe("production");
		for (const dev of DEVELOPMENT_SERVERS)
			expect(serverKind(dev)).toBe("development");
		expect(serverKind("http://localhost:3200")).toBe("other");
		expect(serverLabel(PRODUCTION_SERVER)).toBe(
			"Sitegloss (app.sitegloss.dev)",
		);
		expect(serverLabel(DEVELOPMENT_SERVER)).toBe("Development server");
		expect(serverLabel("http://localhost:3200")).toBe("localhost:3200");
	});

	test("a server that is not the service is said to be none, in words", () => {
		expect(serverNote(PRODUCTION_SERVER)).toBeUndefined();
		expect(serverNote(DEVELOPMENT_SERVER)).toBe(
			"Development server (app.dev.sitegloss.dev): not the real Sitegloss",
		);
		expect(serverNote("http://localhost:3200")).toBe(
			"Another server (localhost:3200): not sitegloss.dev",
		);
	});

	test("each server has its own part of the database, and sees no other's", async () => {
		const kv = memoryKv();
		const a = scopedKv(kv, PRODUCTION_SERVER);
		const b = scopedKv(kv, DEVELOPMENT_SERVER);
		await a.set({ tokens: "A's", cursor: 7 });
		await b.set({ tokens: "B's" });
		expect(await a.get("tokens")).toBe("A's");
		expect(await b.get("tokens")).toBe("B's");
		expect(await b.get("cursor")).toBeUndefined();
		expect(await a.all()).toEqual({ tokens: "A's", cursor: 7 });
		await a.remove("tokens");
		expect(await a.all()).toEqual({ cursor: 7 });
		expect(await b.all()).toEqual({ tokens: "B's" });
		expect([...kv.data.keys()].sort()).toEqual([
			"@https://app.dev.sitegloss.dev tokens",
			"@https://app.sitegloss.dev cursor",
		]);
	});
});

describe("where a server signs people in", () => {
	const doc =
		(body: unknown, status = 200) =>
		async () =>
			Response.json(body, { status });

	test("a document that names addresses elsewhere is refused", async () => {
		const elsewhere = doc({
			issuer: `${SERVER}/api/auth`,
			authorization_endpoint: "https://evil.example/authorize",
			token_endpoint: ENDPOINTS.token,
		});
		await expect(discover(elsewhere, SERVER)).rejects.toThrow(
			"app.sitegloss.dev does not answer as a Sitegloss server (its sign-in addresses are missing or lead elsewhere).",
		);
		await expect(discover(doc({}), SERVER)).rejects.toThrow(
			"missing or lead elsewhere",
		);
		// Another server's document, handed out here: not this server's.
		await expect(
			discover(
				doc({
					issuer: "https://evil.example/api/auth",
					authorization_endpoint: ENDPOINTS.authorize,
					token_endpoint: ENDPOINTS.token,
				}),
				SERVER,
			),
		).rejects.toThrow("missing or lead elsewhere");
		await expect(discover(doc("not found", 404), SERVER)).rejects.toThrow(
			"it answered 404",
		);
		// Nowhere to end a grant: the server is only forgotten here.
		expect(
			await discover(
				doc({
					issuer: `${SERVER}/api/auth`,
					authorization_endpoint: ENDPOINTS.authorize,
					token_endpoint: ENDPOINTS.token,
					revocation_endpoint: "https://evil.example/revoke",
				}),
				SERVER,
			),
		).toEqual({ authorize: ENDPOINTS.authorize, token: ENDPOINTS.token });
	});

	test("a server that is not reached is said to be that", async () => {
		await expect(
			discover(async () => {
				throw new TypeError("Failed to fetch");
			}, SERVER),
		).rejects.toBeInstanceOf(OfflineError);
	});
});

describe("a sign-in", () => {
	test("the challenge is the verifier's SHA-256 (RFC 7636's example)", async () => {
		expect(
			await challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
		).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
	});

	test("the window's address asks for the code with PKCE, the scopes and the API as resource", async () => {
		const { pending: p, url } = await beginSignIn(
			SERVER,
			ENDPOINTS,
			REDIRECT,
			1000,
		);
		const at = new URL(url);
		expect(`${at.origin}${at.pathname}`).toBe(
			`${SERVER}/api/auth/oauth2/authorize`,
		);
		const q = at.searchParams;
		expect(q.get("response_type")).toBe("code");
		expect(q.get("client_id")).toBe(CLIENT_ID);
		expect(q.get("redirect_uri")).toBe(REDIRECT);
		expect(q.get("scope")).toBe(
			"openid profile email offline_access cases:read cases:write",
		);
		expect(q.get("code_challenge_method")).toBe("S256");
		expect(q.get("code_challenge")).toBe(await challengeOf(p.verifier));
		expect(q.get("resource")).toBe(`${SERVER}/api`);
		expect(q.get("state")).toBe(p.state);
		// Each sign-in has secrets of its own, and none of them is in the address.
		const again = await beginSignIn(SERVER, ENDPOINTS, REDIRECT, 1000);
		expect(again.pending.verifier).not.toBe(p.verifier);
		expect(again.pending.state).not.toBe(p.state);
		expect(url).not.toContain(p.verifier);
		expect(p.verifier.length).toBeGreaterThanOrEqual(43);
	});

	test("only this sign-in's answer is taken", () => {
		const ok = `${REDIRECT}?code=the-code&state=the-state&iss=x`;
		expect(codeFrom(pending(), ok, 2000)).toBe("the-code");
		expect(() =>
			codeFrom(pending(), `${REDIRECT}?code=c&state=another`, 2000),
		).toThrow("not for this sign-in");
		expect(() =>
			codeFrom(pending(), "https://evil.example/?code=c&state=the-state", 2000),
		).toThrow("another address");
		expect(() =>
			codeFrom(
				pending(),
				`${REDIRECT}?error=access_denied&state=the-state`,
				2000,
			),
		).toThrow("The sign-in was not allowed.");
		expect(() =>
			codeFrom(
				pending(),
				`${REDIRECT}?error=server_error&error_description=Try+later&state=the-state`,
				2000,
			),
		).toThrow("The sign-in failed: Try later");
		// A "no" is this sign-in's only with this sign-in's state, as a code
		// is: one without it, or with another's, is nobody's word.
		for (const foreign of [
			`${REDIRECT}?error=server_error&error_description=Made+up`,
			`${REDIRECT}?error=access_denied&state=another`,
		])
			expect(() => codeFrom(pending(), foreign, 2000)).toThrow(
				"The sign-in's answer is not for this sign-in.",
			);
		expect(() =>
			codeFrom(pending(), `${REDIRECT}?state=the-state`, 2000),
		).toThrow("without a code");
		expect(() => codeFrom(pending(), ok, 1000 + 16 * 60_000)).toThrow(
			"took too long",
		);
		expect(() => codeFrom(pending(), "", 2000)).toThrow(AuthError);
	});

	test("the code is changed for tokens with the verifier, as a public client", async () => {
		const { state, fetcher } = tokenServer();
		const tokens = await exchangeCode(fetcher, pending(), "the-code", 5000);
		expect(tokens).toEqual({
			access: "a1",
			refresh: "r1",
			expiresAt: 5000 + 3600_000,
		});
		const sent = state.requests[0] as URLSearchParams;
		expect(Object.fromEntries(sent)).toEqual({
			grant_type: "authorization_code",
			code: "the-code",
			redirect_uri: REDIRECT,
			code_verifier: "the-verifier",
			client_id: CLIENT_ID,
			resource: `${SERVER}/api`,
		});
		await expect(
			exchangeCode(fetcher, pending(), "wrong", 5000),
		).rejects.toThrow("no longer valid");
	});
});

describe("the tokens", () => {
	async function signedIn(now = { ms: 10_000 }) {
		const server = tokenServer(now);
		const kv = memoryKv();
		/** The waits between tries of one refresh; the clock goes on with them. */
		const slept: number[] = [];
		const session = new Session(
			kv,
			server.fetcher,
			() => now.ms,
			async (ms) => {
				slept.push(ms);
				now.ms += ms;
			},
		);
		await session.store(
			await exchangeCode(server.fetcher, pending(), "the-code", now.ms),
		);
		// As after a sign-in: where the server signs people in is known.
		await session.endpoints(SERVER, true);
		return { ...server, kv, session, now, slept };
	}

	test("an access token is used while it holds, and renewed a minute before it runs out", async () => {
		const { state, session, now, kv } = await signedIn();
		expect(await session.access(SERVER)).toBe("a1");
		now.ms += 3600_000 - 61_000;
		expect(await session.access(SERVER)).toBe("a1");
		expect(state.requests).toHaveLength(1);
		now.ms += 2000;
		expect(await session.access(SERVER)).toBe("a2");
		// The refresh request names the API again, and the new refresh token is stored.
		const refresh = state.requests[1] as URLSearchParams;
		expect(Object.fromEntries(refresh)).toEqual({
			grant_type: "refresh_token",
			refresh_token: "r1",
			client_id: CLIENT_ID,
			resource: `${SERVER}/api`,
		});
		expect((kv.data.get(TOKENS_KEY) as Tokens).refresh).toBe("r2");
		// Where to renew was asked of the server, once, and kept.
		expect(kv.data.get(ENDPOINTS_KEY)).toEqual(ENDPOINTS);
		expect(state.discoveries).toBe(1);
		// The next renewal uses the new one: the grant lives on.
		expect(await session.access(SERVER, true)).toBe("a3");
		expect(state.revoked).toBe(false);
		expect((kv.data.get(TOKENS_KEY) as Tokens).refresh).toBe("r3");
	});

	test("two who need a new token at once share one renewal", async () => {
		const { state, session } = await signedIn();
		const [a, b, c] = await Promise.all([
			session.access(SERVER, true),
			session.access(SERVER, true),
			session.access(SERVER, true),
		]);
		expect([a, b, c]).toEqual(["a2", "a2", "a2"]);
		expect(state.requests).toHaveLength(2);
		expect(state.revoked).toBe(false);
	});

	test("an answer without a new refresh token keeps the one there is", async () => {
		const { state, session, kv } = await signedIn();
		state.keepRefresh = true;
		expect(await session.access(SERVER, true)).toBe("a2");
		expect((kv.data.get(TOKENS_KEY) as Tokens).refresh).toBe("r1");
	});

	test("a grant that is gone says so: sign in again", async () => {
		const { state, session } = await signedIn();
		state.revoked = true;
		const failed = await session.access(SERVER, true).catch((e: unknown) => e);
		expect(failed).toBeInstanceOf(AuthError);
		expect((failed as AuthError).signedOut).toBe(true);
		// And with no tokens at all.
		const none = new Session(memoryKv(), state === undefined ? fetch : fetch);
		const nobody = await none.access(SERVER).catch((e: unknown) => e);
		expect((nobody as AuthError).signedOut).toBe(true);
	});

	test("a server that is not reached is no sign-out: the tokens stay", async () => {
		const { state, session, kv, slept } = await signedIn();
		state.offline = true;
		await expect(session.access(SERVER, true)).rejects.toBeInstanceOf(
			OfflineError,
		);
		// Asked again a few times within the server's 30 s, then given up.
		expect(slept).toEqual([2000, 6000, 10_000]);
		expect((kv.data.get(TOKENS_KEY) as Tokens).refresh).toBe("r1");
		state.offline = false;
		expect(await session.access(SERVER, true)).toBe("a2");
	});

	test("a refresh that arrived and whose answer was lost is asked again in time: no sign-out", async () => {
		const { state, session, kv, slept } = await signedIn();
		// The server rotates the token; the answer does not come, twice.
		state.loseAnswers = 2;
		expect(await session.access(SERVER, true)).toBe("a2");
		expect(slept).toEqual([2000, 6000]);
		// The same request three times, with the token the server had rotated.
		expect(state.requests.slice(-3).map((r) => r.get("refresh_token"))).toEqual(
			["r1", "r1", "r1"],
		);
		expect(state.revoked).toBe(false);
		expect((kv.data.get(TOKENS_KEY) as Tokens).refresh).toBe("r2");
		expect(await session.access(SERVER, true)).toBe("a3");
	});

	test("signed out while a renewal waits for its next try: the tokens do not come back", async () => {
		const { state, kv } = await signedIn();
		// The same token server, with a session whose wait is the moment the
		// user signs out and the network returns.
		let session: Session;
		const waits: number[] = [];
		session = new Session(
			kv,
			(input, init) => tokenServerOf(state)(input, init),
			() => 10_000,
			async (ms) => {
				waits.push(ms);
				await session.forget();
				state.offline = false;
			},
		);
		state.offline = true;
		const asked = state.requests.length;
		const failed = await session.access(SERVER, true).catch((e: unknown) => e);
		expect(failed).toBeInstanceOf(AuthError);
		expect((failed as AuthError).signedOut).toBe(true);
		expect(waits).toEqual([2000]);
		// Not tried again after the sign-out, and nothing written back.
		expect(state.requests.length).toBe(asked);
		expect(kv.data.has(TOKENS_KEY)).toBe(false);
	});

	test("signed out, or signed in as someone else, while the answer is on its way: it is thrown away and its grant ended", async () => {
		for (const then of ["out", "another"] as const) {
			const { state, kv } = await signedIn();
			let release: () => void = () => undefined;
			const held = new Promise<void>((done) => {
				release = done;
			});
			const real = tokenServerOf(state);
			const session = new Session(
				kv,
				async (input, init) => {
					const answer = await real(input, init);
					// The refresh's answer waits on the wire.
					if (String(init?.body ?? "").includes("grant_type=refresh_token"))
						await held;
					return answer;
				},
				() => 10_000,
			);
			const renewing = session.access(SERVER, true).catch((e: unknown) => e);
			await Bun.sleep(5);
			const theirs = { access: "a-dana", refresh: "r-dana", expiresAt: 9e12 };
			if (then === "out") await session.forget();
			else await session.store(theirs);
			release();
			const failed = await renewing;
			expect((failed as AuthError).signedOut).toBe(true);
			// What is stored is what the sign-out or the sign-in left.
			expect(kv.data.get(TOKENS_KEY)).toEqual(
				then === "out" ? undefined : theirs,
			);
			// The tokens that came were live and nobody's: ended at the server.
			expect(state.revoked).toBe(true);
			expect(state.requests.at(-1)?.get("token")).toBe("r2");
		}
	});

	test("only the server's word that the grant is gone signs out; any other no is its trouble, tried again", async () => {
		for (const trouble of [
			Response.json({ error: "invalid_client" }, { status: 401 }),
			Response.json({ error: "invalid_request" }, { status: 400 }),
			Response.json({ error: "invalid_target" }, { status: 400 }),
			new Response("<html>Bad Request</html>", { status: 400 }),
			new Response("Bad Gateway", { status: 502 }),
		]) {
			const { state, session, kv } = await signedIn();
			state.trouble = trouble;
			const failed = await session
				.access(SERVER, true)
				.catch((e: unknown) => e);
			expect(failed).toBeInstanceOf(AuthError);
			expect((failed as AuthError).signedOut).toBe(false);
			expect((failed as AuthError).message).toStartWith(
				`The server answered ${trouble.status}`,
			);
			// The API says "the server's fault" of it, which a run tries again.
			const api = httpApi({
				server: SERVER,
				token: (fresh) => session.access(SERVER, fresh || true),
				fetch: async () => Response.json({}),
			});
			await expect(api.me()).rejects.toMatchObject({ kind: "server" });
			// Nothing was given up: the tokens are there, and work once it is over.
			expect((kv.data.get(TOKENS_KEY) as Tokens).refresh).toBe("r1");
			state.trouble = undefined;
			expect(await session.access(SERVER, true)).toBe("a2");
		}
	});

	test("signing out wipes the tokens here and ends the grant at the server", async () => {
		const { state, session, kv } = await signedIn();
		await session.end(SERVER);
		expect(kv.data.has(TOKENS_KEY)).toBe(false);
		const revoke = state.requests.at(-1) as URLSearchParams;
		expect(Object.fromEntries(revoke)).toEqual({
			token: "r1",
			token_type_hint: "refresh_token",
			client_id: CLIENT_ID,
		});
		// Offline: wiped here all the same.
		const other = await signedIn();
		other.state.offline = true;
		await other.session.end(SERVER);
		expect(other.kv.data.has(TOKENS_KEY)).toBe(false);
	});
});

describe("the API over HTTP", () => {
	function server(answers: (Response | Error)[]) {
		const calls: {
			url: string;
			auth: string | null;
			method: string;
		}[] = [];
		const tokens: boolean[] = [];
		const api = httpApi({
			server: SERVER,
			token: async (fresh) => {
				tokens.push(fresh);
				return fresh ? "new" : "old";
			},
			fetch: async (url, init) => {
				calls.push({
					url,
					auth: new Headers(init?.headers).get("authorization"),
					method: init?.method ?? "GET",
				});
				const next = answers.shift();
				if (next === undefined) throw new Error("no answer left");
				if (next instanceof Error) throw next;
				return next;
			},
		});
		return { api, calls, tokens };
	}

	test("every call carries the token; a refused token is renewed once", async () => {
		const { api, calls, tokens } = server([
			Response.json(
				{ error: { code: "unauthorized", message: "no" } },
				{ status: 401 },
			),
			Response.json({
				user: { id: "u", name: "Tess", email: "t@e", image: null },
				teams: [],
				later: 1,
			}),
		]);
		const me = await api.me();
		expect(me.user.name).toBe("Tess");
		expect(calls.map((c) => c.auth)).toEqual(["Bearer old", "Bearer new"]);
		expect(tokens).toEqual([false, true]);
		expect(calls[0]?.url).toBe(`${SERVER}/api/v1/me`);
	});

	test("refused twice: the sign-in is over", async () => {
		const { api } = server([
			new Response("", { status: 401 }),
			new Response("", { status: 401 }),
		]);
		const failed = (await api.me().catch((e: unknown) => e)) as ApiFailure;
		expect(failed).toBeInstanceOf(ApiFailure);
		expect(failed.kind).toBe("unauthorized");
	});

	test("what went wrong is told apart: not reached, the server's fault, the server's no", async () => {
		const offline = server([new TypeError("Failed to fetch")]);
		expect(
			((await offline.api.me().catch((e: unknown) => e)) as ApiFailure).kind,
		).toBe("offline");
		const broken = server([new Response("oops", { status: 502 })]);
		expect(
			((await broken.api.me().catch((e: unknown) => e)) as ApiFailure).kind,
		).toBe("server");
		const refused = server([
			Response.json(
				{
					error: {
						code: "forbidden",
						message: "Your role does not allow this.",
					},
				},
				{ status: 403 },
			),
		]);
		const no = (await refused.api
			.changes("team 1", 7)
			.catch((e: unknown) => e)) as ApiFailure;
		expect([no.kind, no.status, no.code, no.message]).toEqual([
			"refused",
			403,
			"forbidden",
			"Your role does not allow this.",
		]);
		expect(refused.calls[0]?.url).toBe(
			`${SERVER}/api/v1/teams/team%201/changes?since=7`,
		);
	});

	test("images: asked for by HEAD, sent as WebP, a missing one is an answer", async () => {
		const sha = "a".repeat(64);
		const { api, calls } = server([
			new Response(null, { status: 404 }),
			Response.json({ sha256: sha, bytes: 3, width: 1, height: 1 }),
			new Response(new Blob(["abc"]), {
				headers: { "content-type": "image/webp" },
			}),
		]);
		expect(await api.hasBlob("t", sha)).toBe(false);
		await api.putBlob("t", sha, new Blob(["abc"]));
		expect(await (await api.getBlob("t", sha)).text()).toBe("abc");
		expect(calls.map((c) => c.method)).toEqual(["HEAD", "PUT", "GET"]);
		expect(calls[1]?.url).toBe(`${SERVER}/api/v1/teams/t/blobs/${sha}`);
	});
});

describe("the events stream", () => {
	test("events are read as they arrive, whatever the pieces", () => {
		const parser = new EventParser();
		expect(parser.push("retry: 3000\n\nevent: cha")).toEqual([]);
		expect(parser.retry).toBe(3000);
		expect(parser.push('nge\ndata: {"cur')).toEqual([]);
		const [event] = parser.push('sor":12}\n\n: still here\n\n');
		expect(event).toEqual({ event: "change", data: '{"cursor":12}' });
		expect(event && changeCursor(event)).toBe(12);
		// Other line ends, a field without a value, an event this build does not know.
		expect(parser.push("event: later\r\ndata: x\r\n\r\ndata\n\n")).toEqual([
			{ event: "later", data: "x" },
			{ event: "message", data: "" },
		]);
		expect(changeCursor({ event: "later", data: "x" })).toBeUndefined();
		expect(changeCursor({ event: "change", data: "not json" })).toBeUndefined();
	});

	test("a line that does not end, or an event that does not, is given up and not held", () => {
		const parser = new EventParser();
		// Long, and still within what a line may be.
		expect(parser.push(`data: ${"x".repeat(MAX_LINE - 100)}\n\n`)).toHaveLength(
			1,
		);
		expect(() => {
			for (let i = 0; i < 100; i++) parser.push("y".repeat(1024));
		}).toThrow(StreamTooLong);
		const many = new EventParser();
		expect(() => {
			for (let i = 0; i < 100; i++) many.push(`data: ${"z".repeat(1000)}\n`);
		}).toThrow(StreamTooLong);
	});

	test("it says when the stream is open and when not: open once the server answered and the body flows, closed when it ended or failed (DEC-045)", async () => {
		const said: boolean[] = [];
		const end = new AbortController();
		let calls = 0;
		await listen({
			url: "https://app.sitegloss.dev/api/v1/teams/t/events",
			token: async () => "a",
			onChange: () => undefined,
			onConnected: (open) => void said.push(open),
			signal: end.signal,
			fetch: async () => {
				calls++;
				// A refusal: never open. Then a stream that ends after a line.
				if (calls === 1) return new Response("no", { status: 503 });
				return new Response(": still here\n\n");
			},
			sleep: async () => {
				if (calls >= 2) end.abort();
			},
		});
		expect(calls).toBe(2);
		expect(said).toEqual([true, false]);
	});

	test("a stream that never ends its line is let go and connected again; one connection has an age", async () => {
		// A server that sends bytes for ever and never a line end.
		let pulled = 0;
		const endless = () =>
			new Response(
				new ReadableStream<Uint8Array>({
					pull(controller) {
						pulled++;
						controller.enqueue(new TextEncoder().encode("x".repeat(8192)));
					},
				}),
			);
		const end = new AbortController();
		const waits: number[] = [];
		let request: AbortSignal | undefined;
		const letGo: boolean[] = [];
		await listen({
			url: "https://app.sitegloss.dev/api/v1/teams/t/events",
			token: async () => "a",
			onChange: () => undefined,
			signal: end.signal,
			fetch: async (_url, init) => {
				request = init?.signal ?? undefined;
				return endless();
			},
			sleep: async (ms) => {
				waits.push(ms);
				letGo.push(request?.aborted === true);
				end.abort();
			},
		});
		// Given up after about 64 KiB, not read on and on; then a wait as after a failure.
		expect(pulled).toBeLessThan(20);
		expect(waits).toEqual([2000]);
		// Let go before the wait: the request is aborted, which ends its stream.
		expect(letGo).toEqual([true]);

		// Comment lines all the time (each resets the silence): after its
		// age the connection is made anew, soon, as nothing went wrong.
		const again = new AbortController();
		const pauses: number[] = [];
		let connections = 0;
		await listen({
			url: "https://app.sitegloss.dev/api/v1/teams/t/events",
			token: async () => "a",
			onChange: () => undefined,
			signal: again.signal,
			maxAgeMs: 60,
			fetch: async (_url, init) => {
				connections++;
				let timer: ReturnType<typeof setInterval>;
				return new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							timer = setInterval(
								() =>
									controller.enqueue(new TextEncoder().encode(": ping\n\n")),
								5,
							);
							init?.signal?.addEventListener("abort", () => {
								clearInterval(timer);
								controller.error(new DOMException("aborted", "AbortError"));
							});
						},
						cancel() {
							clearInterval(timer);
						},
					}),
				);
			},
			sleep: async (ms) => {
				pauses.push(ms);
				if (pauses.length === 2) again.abort();
			},
		});
		expect(connections).toBe(2);
		expect(pauses).toEqual([2000, 2000]);
	});

	/** A stream that sends `text` and ends. */
	const stream = (text: string) =>
		new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode(text));
					controller.close();
				},
			}),
		);

	test("each change is handed on; an ended stream is connected again, with a fresh token after a no", async () => {
		const end = new AbortController();
		const cursors: number[] = [];
		const asked: boolean[] = [];
		const auths: (string | null)[] = [];
		const waits: number[] = [];
		const answers = [
			stream('retry: 3000\n\nevent: change\ndata: {"cursor":5}\n\n'),
			new Response("", { status: 401 }),
			stream(
				'event: change\ndata: {"cursor":6}\n\nevent: change\ndata: {"cursor":7}\n\n',
			),
		];
		await listen({
			url: "https://x/events",
			token: async (fresh) => {
				asked.push(fresh);
				return fresh ? "new" : "old";
			},
			onChange: (cursor) => {
				cursors.push(cursor);
				if (cursor === 7) end.abort();
			},
			signal: end.signal,
			fetch: async (_url, init) => {
				auths.push(new Headers(init?.headers).get("authorization"));
				return answers.shift() ?? new Response("", { status: 500 });
			},
			sleep: async (ms) => {
				waits.push(ms);
			},
		});
		expect(cursors).toEqual([5, 6, 7]);
		expect(asked).toEqual([false, false, true]);
		expect(auths).toEqual(["Bearer old", "Bearer old", "Bearer new"]);
		// After a clean end: the server's retry. After the no: at once.
		expect(waits).toEqual([3000, 0]);
	});

	test("failures wait longer each time, up to a minute; nobody signed in ends it", async () => {
		const waits: number[] = [];
		let tries = 0;
		await listen({
			url: "https://x/events",
			token: async () => (++tries > 8 ? undefined : "t"),
			onChange: () => undefined,
			signal: new AbortController().signal,
			fetch: async () => {
				throw new TypeError("Failed to fetch");
			},
			sleep: async (ms) => {
				waits.push(ms);
			},
		});
		expect(waits).toEqual([
			2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000,
		]);
	});
});

describe("the chosen server answers, nobody it points at (review B, 2)", () => {
	type Served = ReturnType<typeof Bun.serve>;
	const up: Served[] = [];
	const serve = (
		answer: (request: Request) => Response | Promise<Response>,
	) => {
		const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: answer });
		up.push(s);
		return { origin: `http://127.0.0.1:${s.port}` };
	};
	const real = (input: string, init?: RequestInit) => fetch(input, init);

	test("a redirect is never followed: the tokens, the code and the API's token go to the chosen server only, and no other site's content comes back", async () => {
		try {
			// Somewhere else: it would get what is sent on, and answer in the
			// chosen server's stead.
			const got: string[] = [];
			const elsewhere = serve(async (request) => {
				got.push(
					`${request.method} ${new URL(request.url).pathname} ${await request.text()} ${request.headers.get("authorization") ?? ""}`,
				);
				return new URL(request.url).pathname.includes("/blobs/")
					? new Response("ROUTER ADMIN PAGE", {
							headers: { "content-type": "image/webp" },
						})
					: Response.json({
							access_token: "theirs",
							refresh_token: "theirs",
							expires_in: 3600,
							user: { id: "u", name: "n", email: "e" },
							teams: [],
						});
			});
			let asked = 0;
			const chosen = serve((request) => {
				asked++;
				const { pathname, search } = new URL(request.url);
				return new Response(null, {
					status: 307,
					headers: { location: `${elsewhere.origin}${pathname}${search}` },
				});
			});
			const endpoints: Endpoints = {
				authorize: `${chosen.origin}/api/auth/oauth2/authorize`,
				token: `${chosen.origin}/api/auth/oauth2/token`,
				revoke: `${chosen.origin}/api/auth/oauth2/revoke`,
			};
			const tokens: Tokens = {
				access: "ACCESS",
				refresh: "REFRESH",
				expiresAt: 0,
			};
			// Discovery, the code, a refresh, the revoke.
			await expect(discover(real, chosen.origin)).rejects.toBeInstanceOf(
				OfflineError,
			);
			await expect(
				exchangeCode(
					real,
					{ ...pending(), server: chosen.origin, token: endpoints.token },
					"the-code",
					2000,
				),
			).rejects.toBeInstanceOf(OfflineError);
			await expect(
				refreshTokens(real, chosen.origin, endpoints, tokens, 1000),
			).rejects.toBeInstanceOf(OfflineError);
			expect(await revokeTokens(real, endpoints, tokens)).toBe(false);
			// The API: a call, and an image.
			const api = httpApi({
				server: chosen.origin,
				token: async () => "ACCESS",
				fetch: real,
			});
			await expect(api.me()).rejects.toMatchObject({ kind: "offline" });
			await expect(api.getBlob("t", "a".repeat(64))).rejects.toMatchObject({
				kind: "offline",
			});
			// The events stream: tried, never read.
			const end = new AbortController();
			const heard: number[] = [];
			await listen({
				url: `${chosen.origin}/api/v1/teams/t/events`,
				token: async () => "ACCESS",
				onChange: (cursor) => heard.push(cursor),
				signal: end.signal,
				fetch: real,
				sleep: async () => end.abort(),
			});
			expect(heard).toEqual([]);
			// The chosen server was asked each time; nobody else ever was.
			expect(asked).toBe(7);
			expect(got).toEqual([]);
		} finally {
			for (const s of up.splice(0)) s.stop(true);
		}
	});

	test("every request says so, and none carries the browser's cookies", async () => {
		const sent: RequestInit[] = [];
		const spy = async (_input: string, init?: RequestInit) => {
			sent.push(init ?? {});
			return Response.json({});
		};
		await discover(spy, SERVER).catch(() => undefined);
		await exchangeCode(spy, pending(), "the-code", 2000).catch(() => undefined);
		await refreshTokens(
			spy,
			SERVER,
			ENDPOINTS,
			{ access: "a", refresh: "r", expiresAt: 0 },
			1000,
		).catch(() => undefined);
		await revokeTokens(spy, ENDPOINTS, {
			access: "a",
			refresh: "r",
			expiresAt: 0,
		});
		await httpApi({ server: SERVER, token: async () => "a", fetch: spy }).me();
		const end = new AbortController();
		await listen({
			url: `${SERVER}/api/v1/teams/t/events`,
			token: async () => "a",
			onChange: () => undefined,
			signal: end.signal,
			fetch: spy,
			sleep: async () => end.abort(),
		});
		expect(sent).toHaveLength(6);
		expect(sent.map((init) => init.redirect)).toEqual(Array(6).fill("error"));
		expect(sent.map((init) => init.credentials)).toEqual(Array(6).fill("omit"));
	});

	test("an image is read with its type and up to the API's limit; a larger one is given up, not held", async () => {
		const sha = "a".repeat(64);
		const api = (answer: Response) =>
			httpApi({
				server: SERVER,
				token: async () => "a",
				fetch: async () => answer,
			});
		const image = await api(
			new Response(new Blob(["abc"]), {
				headers: { "content-type": "image/webp; charset=binary" },
			}),
		).getBlob("t", sha);
		expect(image.type).toBe("image/webp");
		expect((await api(new Response("<html>")).getBlob("t", sha)).type).not.toBe(
			"image/webp",
		);
		// Said to be too large: not read at all.
		let read = 0;
		const endless = () =>
			new ReadableStream<Uint8Array>({
				pull(controller) {
					read++;
					controller.enqueue(new Uint8Array(1024 * 1024));
				},
			});
		await expect(
			api(
				new Response(endless(), {
					headers: { "content-length": String(MAX_IMAGE_BYTES + 1) },
				}),
			).getBlob("t", sha),
		).rejects.toMatchObject({ code: TOO_LARGE });
		expect(read).toBeLessThan(3);
		// Not said, and it goes on and on: given up at the limit.
		read = 0;
		await expect(
			api(new Response(endless())).getBlob("t", sha),
		).rejects.toMatchObject({ code: TOO_LARGE });
		expect(read).toBeGreaterThan(29);
		expect(read).toBeLessThan(35);
	});
});

describe("an answer is read up to what an answer may be (review B, 11)", () => {
	test("JSON: a page of changes can be asked for in fewer things; an answer over the limit is given up", async () => {
		const urls: string[] = [];
		let read = 0;
		const api = (answer: () => Response) =>
			httpApi({
				server: SERVER,
				token: async () => "a",
				fetch: async (url) => {
					urls.push(url);
					return answer();
				},
			});
		const page = () => Response.json({ cursor: 3, more: false });
		expect((await api(page).changes("t", undefined)).cursor).toBe(3);
		await api(page).changes("t", 7, SMALL_PAGE);
		await api(page).changes("t", undefined, SMALL_PAGE);
		expect(urls.map((u) => u.slice(u.indexOf("/changes")))).toEqual([
			"/changes",
			`/changes?since=7&limit=${SMALL_PAGE}`,
			`/changes?limit=${SMALL_PAGE}`,
		]);
		const endless = () =>
			new Response(
				new ReadableStream<Uint8Array>({
					pull(controller) {
						read++;
						controller.enqueue(new Uint8Array(4 * 1024 * 1024).fill(32));
					},
				}),
			);
		await expect(api(endless).changes("t", undefined)).rejects.toMatchObject({
			kind: "server",
			code: TOO_LARGE,
		});
		// 64 MiB in pieces of 4 MiB: given up there.
		expect(read).toBeGreaterThanOrEqual(MAX_JSON_BYTES / (4 * 1024 * 1024));
		expect(read).toBeLessThan(MAX_JSON_BYTES / (4 * 1024 * 1024) + 4);
	});
});

describe("the sign-ins under way", () => {
	test("are kept by their state, and one that took too long is no longer one", () => {
		const a = { ...pending(1000), state: "s-a" };
		const b = { ...pending(1000 + 16 * 60_000), state: "s-b" };
		const stored = { "s-a": a, "s-b": b, "s-x": { ...a, state: "other" } };
		expect(pendingSignIns(stored, 1000 + 60_000)).toEqual({
			"s-a": a,
			"s-b": b,
		});
		expect(pendingSignIns(stored, 1000 + 17 * 60_000)).toEqual({ "s-b": b });
		// What an older build kept there (one sign-in, not by state) is none.
		expect(pendingSignIns(pending(), 2000)).toEqual({});
		expect(pendingSignIns(undefined, 2000)).toEqual({});
		expect(stateOf(`${REDIRECT}?code=c&state=s-a`)).toBe("s-a");
		expect(stateOf(`${REDIRECT}?code=c`)).toBe("");
		expect(stateOf("not an address")).toBe("");
	});
});

describe("small answers are read as small (review B, re-check C)", () => {
	/** An answer that goes on for 80 MiB, and counts what was taken of it. */
	function huge(status = 200) {
		let pulled = 0;
		const response = () =>
			new Response(
				new ReadableStream<Uint8Array>({
					pull(controller) {
						if (pulled++ >= 80) controller.close();
						else controller.enqueue(new Uint8Array(1024 * 1024).fill(32));
					},
				}),
				{ status, headers: { "content-type": "application/json" } },
			);
		return { response, pulled: () => pulled };
	}

	test("the discovery document, the token endpoint's answer and an error's body: a megabyte at most", async () => {
		const discovery = huge();
		await expect(
			discover(async () => discovery.response(), SERVER),
		).rejects.toThrow("larger than an answer may be");
		expect(discovery.pulled()).toBeLessThan(4);

		const token = huge();
		await expect(
			refreshTokens(
				async () => token.response(),
				SERVER,
				ENDPOINTS,
				{ access: "a", refresh: "r", expiresAt: 0 },
				0,
			),
		).rejects.toThrow("larger than an answer may be");
		expect(token.pulled()).toBeLessThan(4);

		const refused = huge(400);
		const api = httpApi({
			server: SERVER,
			token: async () => "a",
			fetch: async () => refused.response(),
		});
		// Its words are lost with it, its status is not.
		await expect(api.me()).rejects.toMatchObject({
			kind: "refused",
			status: 400,
			message: "The server answered 400.",
		});
		expect(refused.pulled()).toBeLessThan(4);
	});
});
