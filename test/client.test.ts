/**
 * What the worker reads from the tab-mcp client library, checked against the
 * library itself and a relay in this process: the events and states the
 * connection (`connection.ts`) and Keep AI access on (`keep-on.ts`) follow,
 * what `revoke()` answers, who sees the tools, the address, and what
 * `disconnectAll()` ("Disconnect all apps") does after a takeover. The fakes in `keep-on.test.ts` send the same
 * shapes; this is where a change of the library shows.
 */

import { afterAll, describe, expect, test } from "bun:test";
import {
	Client,
	StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import {
	MemoryTokenStore,
	type RevokeOptions,
	type RevokeSelector,
} from "@ractive-ch/tab-mcp";
import { startTestRelay, tokenFor } from "@ractive-ch/tab-mcp/testing";
import {
	type ConnectionState,
	type StateChangeDetail,
	TabMcp,
} from "@ractive-ch/tab-mcp-client";
import { createTunnelFetch } from "@ractive-ch/tab-mcp-client/tunnel";
import {
	badgeOf,
	revokeProblem,
	sessionOnAfter,
	unattributed,
} from "../src/worker/connection.ts";
import { KeepOn } from "../src/worker/keep-on.ts";
import { APP_ID } from "../src/worker/protocol.ts";

/** A memory store whose revocations fail while `failing`, as a store that is down. */
class FlakyStore extends MemoryTokenStore {
	failing = false;
	/** How long a revocation takes. */
	slowMs = 0;
	override async revoke(selector: RevokeSelector, options: RevokeOptions) {
		if (this.slowMs > 0) await Bun.sleep(this.slowMs);
		if (this.failing) throw new Error("store down");
		return super.revoke(selector, options);
	}
}

/** A page of Sitegloss's kind on `relay`, and the `statechange` details it heard. */
function page(relay: string, storage: Map<string, string> | null = null) {
	const mcp = new TabMcp({
		relay,
		server: { name: "sitegloss", version: "0.0.0" },
		app: APP_ID,
		storage:
			storage === null
				? null
				: {
						getItem: (key) => storage.get(key) ?? null,
						setItem: (key, value) => void storage.set(key, value),
					},
	});
	const heard: StateChangeDetail[] = [];
	mcp.addEventListener("statechange", (e) => heard.push(e.detail));
	return { mcp, heard };
}

/** Wait for `ok`, up to 5 s. */
async function until(ok: () => boolean): Promise<void> {
	const end = Date.now() + 5000;
	while (!ok()) {
		if (Date.now() > end) throw new Error("timed out");
		await Bun.sleep(10);
	}
}

describe("the library's state, as the worker reads it", () => {
	test("AI access on for the session follows connected, the user's stop and an ended session", () => {
		const on = (detail: StateChangeDetail, keepOn = false) =>
			sessionOnAfter(detail, keepOn);
		expect(on({ state: "connected" })).toBe(true);
		expect(on({ state: "disconnected", reason: "user" })).toBe(false);
		expect(on({ state: "disconnected", reason: "user" }, true)).toBe(false);
		for (const reason of ["idle", "expired"] as const) {
			expect(on({ state: "disconnected", reason })).toBe(false);
			// Keep AI access on connects again: it stays on.
			expect(on({ state: "disconnected", reason }, true)).toBeUndefined();
		}
		// Ended by the relay for another reason: off, unless Keep AI access on
		// tries again (KeepOn names the reason either way).
		for (const reason of [
			"rate_limited",
			"too_large",
			"policy",
			"closed",
		] as const) {
			expect(on({ state: "disconnected", reason })).toBe(false);
			expect(on({ state: "disconnected", reason }, true)).toBeUndefined();
		}
		// Taken over (the `replaced` event turns it off), Disconnect all apps
		// (`disconnect_all`): unchanged, as before.
		for (const reason of ["replaced", "disconnect_all"] as const)
			expect(on({ state: "disconnected", reason })).toBeUndefined();
		// A failed connect, reconnecting, connecting: unchanged.
		expect(on({ state: "disconnected" })).toBeUndefined();
		expect(on({ state: "reconnecting", reason: "network" })).toBeUndefined();
		expect(on({ state: "reconnecting" })).toBeUndefined();
		expect(on({ state: "connecting" })).toBeUndefined();
	});

	test("the icon says … while connecting and while reconnecting", () => {
		const states: ConnectionState[] = [
			"disconnected",
			"connecting",
			"reconnecting",
			"connected",
		];
		expect(states.map(badgeOf)).toEqual([
			"off",
			"connecting",
			"connecting",
			"connected",
		]);
	});

	test("Disconnect that did not work says why, for each of revoke's rejections", () => {
		const relayError = (code: string, named = false) =>
			Object.assign(
				new Error(`Relay error ${code}: x`),
				{ code },
				named ? { for: "grant.revoke", grantId: "g" } : {},
			);
		const problem = (
			error: unknown,
			state: ConnectionState = "connected",
			unattributed = false,
		) => revokeProblem({ error, state, unattributed }, "Claude");
		expect(problem(relayError("store_unavailable"))).toBe(
			"Claude was not disconnected: the relay could not save this. Try again.",
		);
		expect(problem(relayError("unknown_id"))).toBe(
			"The relay no longer knows Claude, so it cannot reach Sitegloss any more. It leaves this list when AI access next connects.",
		);
		const notSent = new DOMException(
			"TabMcp: not connected",
			"InvalidStateError",
		);
		expect(problem(notSent, "disconnected")).toBe(
			"Claude was not disconnected: Sitegloss is not connected to the relay. Turn on AI access and try again.",
		);
		// AI access is on: the connection is on its way back, or closing.
		for (const state of ["reconnecting", "connecting", "connected"] as const)
			expect(problem(notSent, state)).toBe(
				"Claude was not disconnected: the connection to the relay is being restored. Try again once it is connected.",
			);
		expect(
			problem(
				new DOMException("TabMcp: the relay did not answer", "TimeoutError"),
			),
		).toBe("Claude was not disconnected: the relay did not answer. Try again.");
		// Sent, then the session ended: the relay may have done it.
		expect(
			problem(
				new DOMException(
					"TabMcp: the session ended before the relay answered",
					"NetworkError",
				),
				"disconnected",
			),
		).toBe(
			"Sitegloss could not confirm that Claude was disconnected: the connection ended first. It shows when AI access is next on.",
		);
		expect(problem(new Error("odd"))).toBe("Claude was not disconnected: odd");
		// An older relay's answer after an earlier revoke timed out.
		expect(problem(relayError("unknown_id"), "connected", true)).toBe(
			"Claude was not disconnected: the relay's answer may be for an earlier Disconnect it was slow to answer. Try again.",
		);
	});

	test("an older relay's error after a revoke timed out may be that revoke's answer", () => {
		const error = (code: string, named: boolean) =>
			Object.assign(
				new Error(code),
				{ code },
				named ? { for: "grant.revoke", grantId: "g" } : {},
			);
		for (const code of ["unknown_id", "store_unavailable"]) {
			// Named (relay 0.10.2): always its own.
			expect(unattributed(error(code, true), true)).toBe(false);
			// Unnamed: its own unless a revoke timed out before.
			expect(unattributed(error(code, false), false)).toBe(false);
			expect(unattributed(error(code, false), true)).toBe(true);
		}
		expect(unattributed(new DOMException("x", "TimeoutError"), true)).toBe(
			false,
		);
	});
});

describe("tab-mcp client 0.18 with a relay", () => {
	const store = new FlakyStore();
	// A session nobody paired with ends as idle at the first heartbeat after
	// 300 ms.
	const relay = startTestRelay({
		store,
		unpairedIdleTimeoutMs: 300,
		heartbeatMs: 200,
	});
	afterAll(() => relay.stop());

	test("connect and disconnect: statechange with the state, the reason on the way out", async () => {
		const { mcp, heard } = page(relay.url);
		const session = await mcp.connect();
		expect(mcp.state).toBe("connected");
		expect(mcp.session?.address).toBe(session.address);
		mcp.disconnect();
		expect(mcp.session).toBeUndefined();
		expect(heard).toEqual([
			{ state: "connecting" },
			{ state: "connected" },
			{ state: "disconnected", reason: "user" },
		]);
		expect(heard.map((d) => sessionOnAfter(d, false))).toEqual([
			undefined,
			true,
			false,
		]);
	});

	test("an idle session ends as disconnected with reason idle, and Keep AI access on connects again", async () => {
		const { mcp, heard } = page(relay.url);
		const keep = new KeepOn(
			() => true,
			() => {},
		);
		keep.watch(mcp);
		try {
			await mcp.connect();
			await until(() => heard.some((d) => d.reason === "idle"));
			expect(heard).toContainEqual({ state: "disconnected", reason: "idle" });
			// KeepOn's own connect, not the library's reconnecting.
			expect(heard.some((d) => d.state === "reconnecting")).toBe(false);
			await until(
				() => heard.filter((d) => d.state === "connected").length === 2,
			);
		} finally {
			keep.stop();
			mcp.disconnect();
		}
	});

	test("revoke: resolves once the grant is gone, rejects with the relay's code or while not connected", async () => {
		const { mcp } = page(relay.url);
		const named = async (clientId: string) => {
			const { address } = await mcp.connect();
			await tokenFor(relay, address, {
				clientId,
				clientName: "Test",
			});
			// The relay lists a grant from its store at the next connection.
			mcp.disconnect();
			await mcp.connect();
			const grant = mcp.grants.find((g) => g.client.id === clientId);
			expect(grant).toBeDefined();
			return grant?.grantId as string;
		};
		try {
			// Not connected: nothing to send it to.
			mcp.disconnect();
			await expect(mcp.revoke("g_none")).resolves.toBeUndefined();
			const first = await named("https://one.example/client.json");
			mcp.disconnect();
			await expect(mcp.revoke(first)).rejects.toMatchObject({
				name: "InvalidStateError",
			});
			await mcp.connect();

			// The store fails: store_unavailable, and the grant stays.
			store.failing = true;
			await expect(mcp.revoke(first)).rejects.toMatchObject({
				code: "store_unavailable",
			});
			store.failing = false;
			expect(mcp.grants.some((g) => g.grantId === first)).toBe(true);

			// Works: resolves with the grant gone from `grants`.
			const changes: number[] = [];
			mcp.addEventListener("grantschange", (e) =>
				changes.push(e.detail.grants.length),
			);
			await mcp.revoke(first);
			expect(mcp.grants.some((g) => g.grantId === first)).toBe(false);
			expect(changes.length).toBeGreaterThan(0);

			// Gone from the relay's store behind the session's back: the
			// relay's unknown_id names it (0.10.2), so the library drops it
			// from `grants` and the revoke resolves (0.16.1).
			const second = await named("https://two.example/client.json");
			await relay.store.revoke(
				{ grantId: second },
				{ now: Date.now(), keepUntil: Date.now() },
			);
			await expect(mcp.revoke(second)).resolves.toBeUndefined();
			expect(mcp.grants.some((g) => g.grantId === second)).toBe(false);

			// Sent, and the session ends before the answer: NetworkError (the
			// relay may have done it); nothing sent is InvalidStateError above.
			const third = await named("https://three.example/client.json");
			store.slowMs = 300;
			const cut = mcp.revoke(third);
			await Bun.sleep(20);
			mcp.disconnect();
			await expect(cut).rejects.toMatchObject({ name: "NetworkError" });
		} finally {
			store.failing = false;
			store.slowMs = 0;
			mcp.disconnect();
		}
	});

	test("callers: relay only: the tools are listed through the relay and not over a served port; the old webmcp option is refused", async () => {
		const { mcp } = page(relay.url);
		const tool = {
			name: "t",
			description: "A tool",
			execute: () => "ok",
		};
		await mcp.registerTool(tool, { callers: ["relay"] });
		await expect(
			mcp.registerTool({ ...tool, name: "u" }, { webmcp: false } as unknown as {
				callers: [];
			}),
		).rejects.toBeInstanceOf(TypeError);
		type Fetch = (url: string | URL, init?: RequestInit) => Promise<Response>;
		const listed = async (fetch?: Fetch, token?: string) => {
			const client = new Client(
				{ name: "test", version: "1.0.0" },
				{ versionNegotiation: { mode: { pin: "2026-07-28" } } },
			);
			const address =
				fetch === undefined
					? (mcp.session?.address as string)
					: "https://tab.invalid/mcp";
			await client.connect(
				new StreamableHTTPClientTransport(new URL(address), {
					...(fetch !== undefined ? { fetch } : {}),
					...(token !== undefined
						? { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
						: {}),
				}),
			);
			try {
				const names = (await client.listTools()).tools.map((t) => t.name);
				const call = await client.callTool({ name: "t", arguments: {} }).then(
					(r) => r as { isError?: boolean; content: { text?: string }[] },
					(error: unknown) => ({
						isError: true,
						content: [{ text: String(error) }],
					}),
				);
				return { names, call };
			} finally {
				await client.close();
			}
		};
		const { address } = await mcp.connect();
		const channel = new MessageChannel();
		const served = await mcp.serve(channel.port1, {
			client: { id: "local-test" },
		});
		const tunnel = createTunnelFetch({
			send: (message) => channel.port2.postMessage(message),
		});
		channel.port2.onmessage = (event) => tunnel.receive(event.data);
		try {
			const relayed = await listed(undefined, await tokenFor(relay, address));
			expect(relayed.names).toEqual(["t"]);
			expect(relayed.call.isError).toBeFalsy();
			const local = await listed(tunnel.fetch);
			expect(local.names).toEqual([]);
			expect(local.call.isError).toBe(true);
			expect(JSON.stringify(local.call.content)).toContain("not found");
		} finally {
			served.close();
			tunnel.close();
			channel.port1.close();
			channel.port2.close();
			mcp.disconnect();
		}
	});

	test("the address names the app: the same for every installation, and after Disconnect all apps", async () => {
		const one = page(relay.url);
		const two = page(relay.url);
		try {
			const { address } = await one.mcp.connect();
			expect(address).toBe(`${relay.url}/s/${APP_ID}/mcp`);
			// Another installation (another secret): the same address.
			expect((await two.mcp.connect()).address).toBe(address);
			two.mcp.disconnect();
			await one.mcp.disconnectAll();
			expect(one.mcp.session?.address).toBe(address);
		} finally {
			one.mcp.disconnect();
			two.mcp.disconnect();
		}
	});

	test("taken over, disconnectAll() takes the connection back itself, also in a page that never saw the takeover", async () => {
		const storage = new Map<string, string>();
		const a = page(relay.url, storage);
		const b = page(relay.url, storage);
		try {
			const { address: old } = await a.mcp.connect();
			const secret = [...storage.values()][0] as string;
			// An AI app paired before the takeover.
			const token = await tokenFor(relay, old, { secret });
			// A program with a copy of the secret takes the connection over.
			await b.mcp.connect();
			await until(() => a.mcp.state === "disconnected");
			expect(a.heard.at(-1)).toEqual({
				state: "disconnected",
				reason: "replaced",
			});
			// A new worker's library: same secret, nothing heard of it.
			const fresh = page(relay.url, storage);
			await fresh.mcp.disconnectAll();
			// It was off: it stays off, so the worker connects after it.
			expect(fresh.mcp.state).toBe("disconnected");
			expect(fresh.heard.some((d) => d.state === "connected")).toBe(false);
			await until(() => b.mcp.state === "disconnected");
			// The address stays (it names the app); the secret behind it is new,
			// under the same key.
			expect([...storage.keys()]).toEqual([
				`tab-mcp:secret:${relay.url}:sitegloss`,
			]);
			expect([...storage.values()][0]).not.toBe(secret);
			const { address } = await fresh.mcp.connect();
			expect(address).toBe(old);
			expect(fresh.mcp.grants).toEqual([]);
			// The AI app paired before is disconnected: its token is refused.
			const call = await fetch(old, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
					Accept: "application/json, text/event-stream",
					"MCP-Protocol-Version": "2026-07-28",
				},
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
			});
			expect(call.status).toBe(401);
			fresh.mcp.disconnect();
		} finally {
			a.mcp.disconnect();
			b.mcp.disconnect();
		}
	});

	test('tools/list: no "usually in the page\'s browser tab" for a page that asks with its own onConfirm, as Sitegloss does', async () => {
		const SENTENCE =
			"The page may ask the user to allow each call, usually in the page's browser tab.";
		const description = async (onConfirm: boolean) => {
			const mcp = new TabMcp({
				relay: relay.url,
				server: { name: "sitegloss", version: "0.0.0" },
				storage: null,
				...(onConfirm ? { onConfirm: () => true } : {}),
			});
			await mcp.registerTool(
				{
					name: "change",
					description: "Changes something. The user is asked first.",
					annotations: { consequentialHint: true },
					execute: () => "ok",
				},
				{ callers: ["relay"] },
			);
			const { address } = await mcp.connect();
			const client = new Client(
				{ name: "test", version: "1.0.0" },
				{ versionNegotiation: { mode: { pin: "2026-07-28" } } },
			);
			await client.connect(
				new StreamableHTTPClientTransport(new URL(address), {
					requestInit: {
						headers: {
							Authorization: `Bearer ${await tokenFor(relay, address)}`,
						},
					},
				}),
			);
			try {
				return (await client.listTools()).tools[0]?.description;
			} finally {
				await client.close();
				mcp.disconnect();
			}
		};
		expect(await description(true)).toBe(
			"Changes something. The user is asked first.",
		);
		// Without one the library's own dialog asks, in the page: it says so.
		expect(await description(false)).toBe(
			`Changes something. The user is asked first. ${SENTENCE}`,
		);
	});

	// Last: it stops the relay.
	test("the relay going away: reconnecting with the reason; a refusal ends it with error, then statechange", async () => {
		const { mcp, heard } = page(relay.url);
		await mcp.connect();
		const keep = new KeepOn(() => true, () => {}, [60_000]);
		keep.watch(mcp);
		const order: string[] = [];
		mcp.addEventListener("error", () => order.push(`error:${mcp.state}`));
		mcp.addEventListener("statechange", (e) =>
			order.push(`statechange:${e.detail.state}:${e.detail.reason ?? ""}`),
		);
		let refusing: ReturnType<typeof Bun.serve> | undefined;
		try {
			await relay.stop();
			await until(() => mcp.state === "reconnecting");
			expect(heard.at(-1)).toEqual({
				state: "reconnecting",
				reason: "shutdown",
			});
			expect(mcp.reconnecting?.attempt).toBe(1);
			expect(badgeOf(mcp.state)).toBe("connecting");
			// The library's to do: Keep AI access on does not connect over it.
			keep.connect();
			expect(keep.retrying).toBe(false);
			expect(mcp.state).toBe("reconnecting");

			// On the relay's port now: something that refuses every hello.
			refusing = Bun.serve({
				hostname: "127.0.0.1",
				port: relay.relay.port,
				fetch(req, server) {
					return server.upgrade(req, {
						headers: { "Sec-WebSocket-Protocol": "tab-mcp.v1" },
						data: undefined,
					})
						? undefined
						: new Response("no", { status: 400 });
				},
				websocket: {
					message(ws) {
						ws.send(
							JSON.stringify({
								type: "error",
								code: "forbidden",
								message: "not here",
							}),
						);
					},
				},
			});
			order.length = 0;
			// The next attempt at once.
			await mcp.connect().catch(() => undefined);
			await until(() => mcp.state === "disconnected");
			expect(order).toEqual([
				"error:disconnected",
				"statechange:disconnected:",
			]);
			expect(mcp.reconnecting).toBeUndefined();
			expect(keep.problem).toContain("not here");
			expect(keep.retrying).toBe(true);
		} finally {
			keep.stop();
			mcp.disconnect();
			refusing?.stop(true);
		}
	});
});
