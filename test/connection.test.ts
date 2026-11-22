/**
 * The worker's connection (`Connection`) with the real tab-mcp client 0.18
 * and a relay in this process: Disconnect, the end of a session by the
 * relay, and Disconnect all apps after a takeover, as the panel sees them. Chrome is
 * a fake that keeps the session area, the alarms and the badge; the settings
 * database is a memory one. From the review of PR 58 (its harness).
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import {
	MemoryTokenStore,
	type RevokeOptions,
	type RevokeSelector,
} from "@ractive-ch/tab-mcp";
import { startTestRelay, tokenFor } from "@ractive-ch/tab-mcp/testing";
import { TabMcp } from "@ractive-ch/tab-mcp-client";
import { pagePort, runPairingPage } from "@ractive-ch/tab-mcp-client/extension";
import { Window } from "happy-dom";
import { type Kv, memoryKv } from "../src/lib/kv.ts";
import type { CaseStore } from "../src/lib/store.ts";
import { Connection } from "../src/worker/connection.ts";
import type { AiState } from "../src/worker/protocol.ts";
import { DEFAULT_RELAY, settleFillCode } from "../src/worker/settings.ts";
import type { Capture } from "../src/worker/tab.ts";
import { pairingPage, portPair } from "./pair-fill-page.ts";

/**
 * A memory store whose revocations wait `slowMs`, and fail while `failing`;
 * `log`, while set, records what the relay asked it in order (each
 * `grant.revoke` starts with `listGrants`).
 */
class SlowStore extends MemoryTokenStore {
	failing = false;
	slowMs = 0;
	log: string[] | undefined;
	override listGrants(addressId: string, now: number) {
		this.log?.push("listGrants");
		return super.listGrants(addressId, now);
	}
	override async revoke(selector: RevokeSelector, options: RevokeOptions) {
		this.log?.push("revoke");
		try {
			if (this.slowMs > 0) await Bun.sleep(this.slowMs);
			if (this.failing) throw new Error("store down");
			return await super.revoke(selector, options);
		} finally {
			this.log?.push("revoke answered");
		}
	}
}

const globals = globalThis as unknown as Record<string, unknown>;
const before = { chrome: globals["chrome"], WebSocket: globals["WebSocket"] };
/** What Chrome keeps across workers: the session area and the alarms. */
const session = new Map<string, unknown>();
const alarms = new Map<string, unknown>();
/** The icon's spark needs the built icons, which Bun cannot fetch: only that warning is dropped. */
const warn = console.warn;
const warnSpy = spyOn(console, "warn").mockImplementation((...args) => {
	if (args[0] !== "Sitegloss: the toolbar icon") warn(...args);
});

beforeAll(() => {
	globals["chrome"] = {
		storage: {
			local: {
				setAccessLevel: async () => {},
				get: async () => ({}),
				remove: async () => {},
			},
			session: {
				get: async (keys: string[]) =>
					Object.fromEntries(
						keys.filter((k) => session.has(k)).map((k) => [k, session.get(k)]),
					),
				set: async (entries: Record<string, unknown>) => {
					for (const [k, v] of Object.entries(entries)) session.set(k, v);
				},
			},
		},
		notifications: {
			getAll: async () => ({}),
			clear: async () => true,
			create: async () => {},
		},
		alarms: {
			get: async (name: string) => alarms.get(name),
			create: async (name: string, info: unknown) => {
				alarms.set(name, info);
			},
			clear: async (name: string) => alarms.delete(name),
		},
		action: {
			setBadgeText: async () => {},
			setBadgeBackgroundColor: async () => {},
			setBadgeTextColor: async () => {},
			setTitle: async () => {},
			setIcon: async () => {},
		},
		runtime: {
			id: "sitegloss-id",
			getManifest: () => ({ version: "0.0.0" }),
			sendMessage: async () => {},
			getURL: (path: string) => `chrome-extension://x/${path}`,
		},
		tabs: {
			query: async () => [],
			sendMessage: async () => {},
			get: async (id: number) => {
				const url = fake.tabs.get(id);
				if (url === undefined) throw new Error("No tab");
				return { id, url };
			},
		},
		windows: { get: async () => ({ focused: false }) },
		permissions: {
			contains: async (p: { origins: string[] }) =>
				p.origins.every((o) => fake.granted.has(o)),
			remove: async (p: { origins: string[] }) => {
				fake.removed.push(...p.origins);
				for (const o of p.origins) fake.granted.delete(o);
				return true;
			},
		},
		// The library's script in the pairing page: it reads the form (as
		// `fake.form` says it), opens its port to the worker, and fills in
		// what comes back.
		scripting: {
			executeScript: async (injection: {
				target: { tabId: number; frameIds?: number[] };
				files: string[];
			}) => {
				const { tabId } = injection.target;
				const url = fake.tabs.get(tabId);
				if (url === undefined) throw new Error("No tab");
				if (!fake.granted.has(`${new URL(url).origin}/*`))
					throw new Error("Cannot access contents of the page");
				fake.injected.push({ tabId, files: injection.files });
				const window = new Window({ url });
				fake.windows.push(window);
				window.document.write(
					pairingPage({
						app: fake.form.app,
						name: fake.form.clientName,
						host: fake.form.clientHost,
						requestId: fake.form.requestId,
					}),
				);
				window.document
					.querySelector("form")
					?.addEventListener("submit", (e) => {
						e.preventDefault();
						const field = window.document.querySelector(
							"[data-tab-mcp-field=code]",
						) as unknown as HTMLInputElement;
						fake.filled.push(field.value);
					});
				runPairingPage({
					app: "sitegloss",
					connect: () => {
						const pair = portPair({
							id: "sitegloss-id",
							url,
							origin: new URL(url).origin,
							tab: { id: tabId },
							frameId: 0,
						});
						fake.ports.set(tabId, pair);
						queueMicrotask(() =>
							fake.connection?.pairingPage(pagePort(pair.worker)),
						);
						return pair.content;
					},
					page: {
						document: window.document as unknown as Document,
						topLevel: true,
						pathname: new URL(url).pathname,
					},
				});
				return [{ result: undefined }];
			},
		},
	};
});

/** The browser around the pairing page, as the fake Chrome above answers it. */
const fake = {
	/** Tab ids and their addresses. */
	tabs: new Map<number, string>(),
	/** Host patterns Sitegloss has. */
	granted: new Set<string>(),
	/** What `permissions.remove` was asked for. */
	removed: [] as string[],
	form: {
		app: "sitegloss",
		clientName: "Claude",
		clientHost: "claude.ai",
		requestId: "r_1",
	},
	/** The codes filled in. */
	filled: [] as string[],
	/** The scripts put into tabs. */
	injected: [] as { tabId: number; files: string[] }[],
	/** The pairing pages' ports, by tab. */
	ports: new Map<number, ReturnType<typeof portPair>>(),
	windows: [] as Window[],
	/** The worker the pages' ports go to. */
	connection: undefined as Connection | undefined,
};

afterAll(() => {
	warnSpy.mockRestore();
	globals["chrome"] = before.chrome;
	globals["WebSocket"] = before.WebSocket;
});

/** Wait for `ok`, up to `ms`. */
async function until(ok: () => boolean, ms = 5000): Promise<void> {
	const end = Date.now() + ms;
	while (!ok()) {
		if (Date.now() > end) throw new Error("timed out");
		await Bun.sleep(10);
	}
}

/**
 * A relay before 0.10.2, as the page hears it: its error frames name no
 * request (no `for`, no `grantId`). Until `globals.WebSocket` is restored.
 */
function olderRelay(): void {
	const Real = before.WebSocket as typeof WebSocket;
	globals["WebSocket"] = class extends Real {
		override addEventListener(
			type: string,
			listener: EventListenerOrEventListenerObject,
			options?: boolean | AddEventListenerOptions,
		): void {
			if (type !== "message" || typeof listener !== "function") {
				super.addEventListener(type, listener, options);
				return;
			}
			super.addEventListener(
				type,
				(event) => {
					const data = (event as MessageEvent).data;
					const message =
						typeof data === "string" ? JSON.parse(data) : undefined;
					if (message?.type !== "error") return listener(event);
					delete message.for;
					delete message.grantId;
					listener(
						new MessageEvent("message", { data: JSON.stringify(message) }),
					);
				},
				options,
			);
		}
	};
}

interface Worker {
	/** Every state the panel was sent. */
	states: AiState[];
	last(): AiState;
	send(command: Record<string, unknown>): void;
}

/** A worker as Chrome starts it, on `kv`, with one side panel open. */
async function startWorker(
	kv: Kv,
): Promise<Worker & { connection: Connection }> {
	const connection = await Connection.start({
		store: {} as CaseStore,
		capture: (async () => {
			throw new Error("no capture");
		}) as unknown as Capture,
		kv,
	});
	const states: AiState[] = [];
	let receive: (raw: unknown) => void = () => {};
	connection.addPanel({
		postMessage: (m: { state: AiState }) => states.push(m.state),
		onMessage: { addListener: (fn: (raw: unknown) => void) => (receive = fn) },
		onDisconnect: { addListener: () => {} },
	} as unknown as chrome.runtime.Port);
	return {
		connection,
		states,
		last: () => states.at(-1) as AiState,
		send: (command) => receive(command),
	};
}

describe("the worker's connection with client 0.18", () => {
	const store = new SlowStore();
	// Workers of earlier tests stay connected: more than the 5 sessions a
	// network may have by default.
	const relay = startTestRelay({ store, maxSessionsPerIp: 50 });
	const workers: Worker[] = [];
	afterAll(async () => {
		for (const w of workers) w.send({ type: "stop" });
		await Bun.sleep(50);
		await relay.stop();
	});

	/** Where the library keeps Sitegloss's secret for this relay. */
	const secretKey = () => `tab-mcp:secret:${relay.url}:sitegloss`;

	/** A worker on a fresh database, connected, with `names` paired, each with Allow all changes. */
	async function paired(names: string[]) {
		session.clear();
		alarms.clear();
		store.failing = false;
		store.slowMs = 0;
		const kv = memoryKv({ relay: relay.url });
		currentKv = kv;
		const w = await startWorker(kv);
		workers.push(w);
		w.send({ type: "connect" });
		await until(() => w.last()?.state === "connected");
		const address = w.last().address as string;
		// Several workers are connected at the app's one address: the
		// secret says which one is paired.
		for (const name of names)
			await tokenFor(relay, address, {
				secret: (await kv.get(secretKey())) as string,
				clientId: `https://${name.toLowerCase()}.example/client.json`,
				clientName: name,
			});
		// The relay lists the grants from its store at the next connection.
		w.send({ type: "stop" });
		await until(() => w.last().state === "disconnected");
		w.send({ type: "connect" });
		await until(
			() =>
				w.last().state === "connected" &&
				w.last().grants.length === names.length,
		);
		const ids: Record<string, string> = {};
		for (const g of w.last().grants) {
			ids[g.name] = g.grantId;
			w.send({ type: "allow-all", grantId: g.grantId, on: true });
		}
		await until(() => w.last().grants.every((g) => g.allowAll));
		return { w, kv, address, ids };
	}

	/** The settings database of the last worker `paired` started. */
	let currentKv: Kv | undefined;
	const grant = (w: Worker, name: string) =>
		w.last().grants.find((g) => g.name === name);

	/**
	 * Two Disconnects in flight: One is gone at the relay (it was not told),
	 * Two's revoke waits in the store when One's is asked for, and then
	 * fails. The relay answers One at once: it knows no such grant.
	 */
	async function twoDisconnects() {
		const { w, ids } = await paired(["One", "Two"]);
		await store.revoke(
			{ grantId: ids["One"] as string },
			{ now: Date.now(), keepUntil: Date.now() },
		);
		const listed = w.last().grants.map((g) => g.name);
		store.slowMs = 300;
		store.failing = true;
		store.log = [];
		w.send({ type: "revoke", grantId: ids["Two"] });
		await Bun.sleep(20);
		w.send({ type: "revoke", grantId: ids["One"] });
		await until(() => grant(w, "Two")?.problem !== undefined);
		await Bun.sleep(50);
		const log = store.log;
		store.log = undefined;
		// Two stays, in its place, with its own answer and its Allow all changes.
		expect(grant(w, "Two")?.problem).toBe(
			"Two was not disconnected: the relay could not save this. Try again.",
		);
		expect(grant(w, "Two")?.allowAll).toBe(true);
		return { w, ids, listed, log };
	}

	test("two Disconnects at once each get their own answer, and an app the relay does not know leaves the list", async () => {
		const { w, ids, listed } = await twoDisconnects();
		// The relay names the grant its unknown_id is for: One leaves the
		// list (client 0.16.1), with its Always allow, and nothing is said.
		expect(w.last().grants.map((g) => g.name)).toEqual(
			listed.filter((name) => name !== "One"),
		);
		// The library's allowances, beside the secret (DEC-043): Two's only.
		const kept = String(await currentKv?.get(`${secretKey()}#allowed`));
		expect(kept).toContain(ids["Two"] as string);
		expect(kept).not.toContain(ids["One"] as string);
	});

	test("with a relay before 0.10.2 (its errors name nothing) the Disconnects go one at a time", async () => {
		olderRelay();
		try {
			const { w, listed, log } = await twoDisconnects();
			// One's revoke reached the relay only once Two's was answered.
			expect(log).toEqual([
				"listGrants",
				"revoke",
				"revoke answered",
				"listGrants",
			]);
			await until(() => grant(w, "One")?.problem !== undefined);
			// The library cannot tell which grant it is: One stays listed.
			expect(w.last().grants.map((g) => g.name)).toEqual(listed);
			expect(grant(w, "One")?.problem).toBe(
				"The relay no longer knows One, so it cannot reach Sitegloss any more. It leaves this list when AI access next connects.",
			);
			expect(grant(w, "One")?.allowAll).toBe(false);
		} finally {
			globals["WebSocket"] = before.WebSocket;
		}
	});

	test("with a relay before 0.10.2, an answer that comes after its revoke timed out is not taken for the next", async () => {
		olderRelay();
		const realSetTimeout = globalThis.setTimeout;
		try {
			const { w, ids } = await paired(["One", "Two"]);
			// The library waits 15 s for a revoke's answer (its `timing`, not
			// exported): here 500 ms, for the revokes only.
			globals["setTimeout"] = ((fn: () => void, ms?: number) =>
				realSetTimeout(
					fn,
					ms === 15_000 ? 500 : ms,
				)) as typeof globalThis.setTimeout;
			// One's store write takes longer than the library waits, and then
			// fails, before Two (next in the queue) times out.
			store.slowMs = 750;
			store.failing = true;
			w.send({ type: "revoke", grantId: ids["One"] });
			w.send({ type: "revoke", grantId: ids["Two"] });
			await until(() => grant(w, "One")?.problem !== undefined);
			expect(grant(w, "One")?.problem).toBe(
				"One was not disconnected: the relay did not answer. Try again.",
			);
			// One's late store_unavailable, naming nothing, rejects Two's.
			await until(() => grant(w, "Two")?.problem !== undefined);
			expect(grant(w, "Two")?.problem).toBe(
				"Two was not disconnected: the relay's answer may be for an earlier Disconnect it was slow to answer. Try again.",
			);
			expect(grant(w, "Two")?.allowAll).toBe(true);
		} finally {
			globals["setTimeout"] = realSetTimeout;
			globals["WebSocket"] = before.WebSocket;
			store.slowMs = 0;
			store.failing = false;
		}
	});

	test("a Disconnect sent and then cut off by Stop could not be confirmed; the next connection's list says what happened", async () => {
		const { w, ids } = await paired(["One"]);
		store.slowMs = 300;
		w.send({ type: "revoke", grantId: ids["One"] });
		await Bun.sleep(20);
		w.send({ type: "stop" });
		await until(() => grant(w, "One")?.problem !== undefined);
		expect(grant(w, "One")?.problem).toBe(
			"Sitegloss could not confirm that One was disconnected: the connection ended first. It shows when AI access is next on.",
		);
		// The next connection's list is the truth: the relay did revoke it.
		await Bun.sleep(400);
		store.slowMs = 0;
		w.send({ type: "connect" });
		await until(() => w.last().state === "connected");
		await until(() => w.last().grants.length === 0);
	});

	test("a Disconnect while off is not sent: not connected, try again", async () => {
		const { w, ids } = await paired(["One"]);
		w.send({ type: "stop" });
		await until(() => w.last().state === "disconnected");
		w.send({ type: "revoke", grantId: ids["One"] });
		await until(() => grant(w, "One")?.problem !== undefined);
		expect(grant(w, "One")?.problem).toBe(
			"One was not disconnected: Sitegloss is not connected to the relay. Turn on AI access and try again.",
		);
		// Its Allow all changes stays: the grant is not gone.
		expect(grant(w, "One")?.allowAll).toBe(true);
	});

	test.each([false, true])(
		"a session the relay ends as rate_limited says why, and tries again only with Keep AI access on (on: %p)",
		async (keepOn) => {
			const { w } = await paired([]);
			if (keepOn) {
				w.send({ type: "keep-on", on: true });
				await until(() => w.last().keepOn);
			}
			// More control frames at once than the relay's budget allows.
			for (let i = 0; i < 20; i++) {
				w.send({ type: "pair", on: true });
				w.send({ type: "pair", on: false });
			}
			await until(() => w.last().state === "disconnected");
			await Bun.sleep(100);
			expect(w.last().problem).toBe(
				"The relay ended the connection: Sitegloss sent it too many messages at once.",
			);
			// Never at once: the next try waits (5 s first).
			expect(w.last().retrying).toBe(keepOn);
			expect(w.last().state).toBe("disconnected");
			// Without Keep AI access on, it stays off: the alarm does not connect.
			expect(session.get("aiOn")).toBe(keepOn);
			expect(alarms.has("sitegloss-ai")).toBe(keepOn);
			w.send({ type: "keep-on", on: false });
			w.send({ type: "stop" });
			await until(() => !w.last().retrying);
		},
	);

	test("after a takeover, Disconnect all apps clears it even when the connect after it fails", async () => {
		const first = await paired([]);
		const secret = await first.kv.get(secretKey());
		first.w.send({ type: "stop" });
		await until(() => first.w.last().state === "disconnected");
		// A new worker after a takeover it did not see.
		await first.kv.set({ replaced: { sibling: false } });
		session.clear();
		const w = await startWorker(first.kv);
		workers.push(w);
		await until(() => w.last()?.replaced !== undefined);
		// The take-back connects (one socket); the connect after it cannot.
		const Real = before.WebSocket as typeof WebSocket;
		let sockets = 0;
		globals["WebSocket"] = class extends Real {
			constructor(url: string | URL, protocols?: string | string[]) {
				sockets++;
				super(sockets > 1 ? "ws://127.0.0.1:1/tab" : url, protocols);
			}
		};
		try {
			w.send({ type: "new-address" });
			await until(() => w.last().problem !== undefined, 10_000);
		} finally {
			globals["WebSocket"] = before.WebSocket;
		}
		expect(sockets).toBe(2);
		expect(w.last().replaced).toBeUndefined();
		expect(await first.kv.get("replaced")).toBeUndefined();
		// The connect again works, at the same address (it names the app),
		// with a new secret behind it.
		w.send({ type: "connect" });
		await until(() => w.last().state === "connected");
		expect(w.last().address).toBe(first.address);
		expect(await first.kv.get(secretKey())).not.toBe(secret);
	});

	test("a stored relay the library refuses gives a note, and the default relay", async () => {
		const w = await startWorker(
			memoryKv({ relay: "http://192.168.1.20:8080" }),
		);
		workers.push(w);
		expect(w.last().relay).toBe(DEFAULT_RELAY);
		expect(w.last().relayNote).toContain(
			"The saved relay http://192.168.1.20:8080 cannot be used",
		);
		expect(w.last().relayNote).toContain(`using ${DEFAULT_RELAY}.`);
	});

	test("Disconnect all apps after a takeover this worker saw: a rejection after the secret changed clears the takeover", async () => {
		const { w, kv, address } = await paired([]);
		// A program with a copy of the address secret takes the connection over.
		const key = secretKey();
		const secret = (await kv.get(key)) as string;
		expect(typeof secret).toBe("string");
		const other = new TabMcp({
			relay: relay.url,
			server: { name: "sitegloss", version: "0.0.0" },
			app: "sitegloss",
			storage: {
				getItem: (k) => (k === key ? secret : null),
				setItem() {},
			},
		});
		await other.connect();
		try {
			await until(() => w.last().replaced !== undefined);
			// The library takes the connection back and connects with the new
			// secret itself (it saw the takeover); that connect cannot.
			const Real = before.WebSocket as typeof WebSocket;
			let sockets = 0;
			globals["WebSocket"] = class extends Real {
				constructor(url: string | URL, protocols?: string | string[]) {
					sockets++;
					super(sockets > 1 ? "ws://127.0.0.1:1/tab" : url, protocols);
				}
			};
			try {
				w.send({ type: "new-address" });
				await until(() => w.last().problem !== undefined, 10_000);
			} finally {
				globals["WebSocket"] = before.WebSocket;
			}
			expect(sockets).toBe(2);
			// The secret is new all the same: no takeover notice for it.
			expect(w.last().replaced).toBeUndefined();
			expect(await kv.get("replaced")).toBeUndefined();
			w.send({ type: "connect" });
			await until(() => w.last().state === "connected");
			expect(w.last().address).toBe(address);
			expect(await kv.get(key)).not.toBe(secret);
		} finally {
			other.disconnect();
		}
	});
});

describe("filling in the code on the relay's pairing page, in the worker, with the library's filler (DEC-044)", () => {
	const relay = startTestRelay({ maxSessionsPerIp: 50 });
	/** The pairing page's origin: a test build fills in the origin it is given. */
	const PAGE_ORIGIN = "https://pair.example";
	const PAGE = `${PAGE_ORIGIN}/authorize?x=1`;
	const workers: Worker[] = [];
	beforeAll(() => {
		globals["SITEGLOSS_TEST_BUILD"] = true;
		globals["siteglossTestFillOrigin"] = PAGE_ORIGIN;
	});
	afterAll(async () => {
		delete globals["SITEGLOSS_TEST_BUILD"];
		delete globals["siteglossTestFillOrigin"];
		for (const w of workers) w.send({ type: "stop" });
		for (const window of fake.windows.splice(0)) void window.happyDOM.close();
		await Bun.sleep(50);
		await relay.stop();
	});

	/** A connected worker on `stored` settings, every site allowed unless `granted` says otherwise. */
	async function connected(
		stored: Record<string, unknown> = {},
		granted = ["<all_urls>", `${PAGE_ORIGIN}/*`],
	) {
		session.clear();
		alarms.clear();
		fake.tabs.clear();
		fake.ports.clear();
		fake.granted = new Set(granted);
		fake.removed = [];
		fake.filled = [];
		fake.injected = [];
		const kv = memoryKv({ relay: relay.url, ...stored });
		const w = await startWorker(kv);
		fake.connection = w.connection;
		workers.push(w);
		w.send({ type: "connect" });
		await until(() => w.last()?.state === "connected");
		fake.tabs.set(7, PAGE);
		return { w, kv };
	}

	test("off by default, also with access to every site: a pairing page gets no script and no question; Fill in the code for me turns it on and is kept", async () => {
		const { w, kv } = await connected();
		await w.connection.pageLoaded(7, PAGE);
		await Bun.sleep(20);
		expect(fake.injected).toEqual([]);
		expect(w.last().fill).toBeUndefined();
		expect(w.last().fillCode).toBe(false);
		expect(w.last().fillHere).toBe(true);
		w.send({ type: "fill-code", on: true });
		await until(() => w.last().fillCode);
		expect(await kv.get("fillCode")).toBe(true);
		await w.connection.pageLoaded(7, PAGE);
		await until(() => w.last().fill !== undefined);
		expect(fake.injected).toEqual([{ tabId: 7, files: ["pairing.js"] }]);
		expect(w.last().fill).toMatchObject({ name: "Claude", host: "claude.ai" });
	});

	test("only the relay's /authorize at its origin gets the script; without the site the browser refuses and nothing happens", async () => {
		const { w } = await connected({ fillCode: true }, []);
		await w.connection.pageLoaded(7, PAGE);
		await Bun.sleep(20);
		expect(fake.injected).toEqual([]);
		expect(w.last().fill).toBeUndefined();
		fake.granted = new Set([`${PAGE_ORIGIN}/*`, "https://pair.example:8443/*"]);
		for (const url of [
			`${PAGE_ORIGIN}/authorize/x`,
			"https://pair.example:8443/authorize",
			"https://pair.example.evil.example/authorize",
		]) {
			fake.tabs.set(8, url);
			await w.connection.pageLoaded(8, url);
		}
		expect(fake.injected).toEqual([]);
	});

	test("a relay that is not the hosted one: nothing to fill in (relayOrigin undefined)", async () => {
		delete globals["siteglossTestFillOrigin"];
		try {
			const { w } = await connected({ fillCode: true });
			expect(w.last().fillHere).toBe(false);
			fake.tabs.set(9, "https://tab-mcp.ractive.ch/authorize");
			fake.granted.add("https://tab-mcp.ractive.ch/*");
			await w.connection.pageLoaded(9, "https://tab-mcp.ractive.ch/authorize");
			await Bun.sleep(20);
			expect(fake.injected).toEqual([]);
		} finally {
			globals["siteglossTestFillOrigin"] = PAGE_ORIGIN;
		}
	});

	test("Stop filling in the code withdraws a waiting question and gives the relay's site back; with access to all sites it keeps that", async () => {
		const { w, kv } = await connected({ fillCode: true }, [`${PAGE_ORIGIN}/*`]);
		await w.connection.pageLoaded(7, PAGE);
		await until(() => w.last().fill !== undefined);
		w.send({ type: "fill-code", on: false });
		await until(() => !w.last().fillCode);
		expect(w.last().fill).toBeUndefined();
		expect(fake.ports.get(7)?.connected).toBe(false);
		expect(await kv.get("fillCode")).toBe(false);
		expect(fake.removed).toEqual(["https://tab-mcp.ractive.ch/*"]);

		const all = await connected({ fillCode: true });
		all.w.send({ type: "fill-code", on: false });
		await until(() => !all.w.last().fillCode);
		expect(fake.removed).toEqual([]);
	});

	test("Stop AI access withdraws a waiting question at once", async () => {
		const { w } = await connected({ fillCode: true });
		await w.connection.pageLoaded(7, PAGE);
		await until(() => w.last().fill !== undefined);
		expect(w.last().questions).toEqual([]);
		const id = w.last().fill?.id;
		w.send({ type: "stop" });
		await until(() => w.last().state === "disconnected");
		expect(w.last().fill).toBeUndefined();
		// A yes for it now does nothing.
		w.send({ type: "fill", id, yes: true });
		await Bun.sleep(50);
		expect(fake.filled).toEqual([]);
	});

	test("a yes queued behind Stop AI access (the panel's commands run in order) fills in nothing", async () => {
		const { w } = await connected({ fillCode: true });
		await w.connection.pageLoaded(7, PAGE);
		await until(() => w.last().fill !== undefined);
		const id = w.last().fill?.id;
		w.send({ type: "stop" });
		w.send({ type: "fill", id, yes: true });
		await until(() => w.last().state === "disconnected");
		await Bun.sleep(100);
		expect(fake.filled).toEqual([]);
	});

	/**
	 * Pairing codes from the relay are held back until `release()`, so a
	 * yes waits for its code; until `globals.WebSocket` is restored.
	 */
	function holdCodes() {
		const held: (() => void)[] = [];
		const Real = before.WebSocket as typeof WebSocket;
		globals["WebSocket"] = class extends Real {
			override addEventListener(
				type: string,
				listener: EventListenerOrEventListenerObject,
				options?: boolean | AddEventListenerOptions,
			): void {
				if (type !== "message" || typeof listener !== "function") {
					super.addEventListener(type, listener, options);
					return;
				}
				super.addEventListener(
					type,
					(event) => {
						const data = (event as MessageEvent).data;
						if (typeof data === "string" && data.includes('"pairing.code"'))
							held.push(() => listener(event));
						else listener(event);
					},
					options,
				);
			}
		};
		return {
			waiting: () => held.length,
			release() {
				globals["WebSocket"] = before.WebSocket;
				for (const deliver of held.splice(0)) deliver();
			},
		};
	}

	for (const [what, command] of [
		["Stop AI access", { type: "stop" }],
		["Stop filling in the code", { type: "fill-code", on: false }],
		["another relay", { type: "set-relay", relay: "http://127.0.0.1:9/" }],
	] as const)
		test(`${what} while a yes waits for its code: nothing is filled in, no AI app is connected`, async () => {
			const codes = holdCodes();
			try {
				const { w } = await connected({ fillCode: true });
				await w.connection.pageLoaded(7, PAGE);
				await until(() => w.last().fill !== undefined);
				w.send({ type: "fill", id: w.last().fill?.id, yes: true });
				// Pairing turned on for the yes; its code is held back.
				await until(() => codes.waiting() > 0);
				w.send(command);
				await until(() => w.last().fill === undefined);
				codes.release();
				await Bun.sleep(300);
				expect(fake.filled).toEqual([]);
				expect(w.last().grants).toEqual([]);
			} finally {
				codes.release();
			}
		});

	test("upgraded from 0.3.0, the relay's site goes back once; never again, nor with all sites, nor once the setting is stored", async () => {
		const SITE = "https://tab-mcp.ractive.ch/*";
		const permissions = {
			granted: new Set<string>(),
			removed: [] as string[],
			contains: async (p: { origins?: string[] }) =>
				(p.origins ?? []).every((o) => permissions.granted.has(o)),
			remove: async (p: { origins?: string[] }) => {
				for (const o of p.origins ?? []) {
					permissions.granted.delete(o);
					permissions.removed.push(o);
				}
				return true;
			},
		};
		const api = permissions as unknown as typeof chrome.permissions;
		// 0.3.0's "Allow on that site", the setting never stored.
		const kv = memoryKv({ relay: DEFAULT_RELAY });
		permissions.granted.add(SITE);
		await settleFillCode(kv, api);
		expect(permissions.removed).toEqual([SITE]);
		expect(await kv.get("fillCode")).toBe(false);
		// Granted again later (for marking a page there, say): kept.
		permissions.granted.add(SITE);
		await settleFillCode(kv, api);
		expect(permissions.removed).toEqual([SITE]);
		// With access to all sites: the setting is stored, nothing removed.
		const all = memoryKv({});
		permissions.granted.add("<all_urls>");
		await settleFillCode(all, api);
		expect(await all.get("fillCode")).toBe(false);
		expect(permissions.removed).toEqual([SITE]);
		// Turned on before: nothing.
		permissions.granted.delete("<all_urls>");
		await settleFillCode(memoryKv({ fillCode: true }), api);
		expect(permissions.removed).toEqual([SITE]);
	});

	test("another relay withdraws a waiting question", async () => {
		const { w } = await connected({ fillCode: true });
		await w.connection.pageLoaded(7, PAGE);
		await until(() => w.last().fill !== undefined);
		const id = w.last().fill?.id;
		w.send({ type: "set-relay", relay: "http://127.0.0.1:9/" });
		await until(() => w.last().relay === "http://127.0.0.1:9/");
		expect(w.last().fill).toBeUndefined();
		w.send({ type: "fill", id, yes: true });
		await Bun.sleep(50);
		expect(fake.filled).toEqual([]);
	});

	test("the page going (closed, or another page loaded) withdraws its question", async () => {
		const { w } = await connected({ fillCode: true });
		await w.connection.pageLoaded(7, PAGE);
		await until(() => w.last().fill !== undefined);
		fake.ports.get(7)?.gone();
		await until(() => w.last().fill === undefined);
	});

	test("the same request's page again in the same tab after a fill is asked about again: no code is filled in without a yes", async () => {
		const { w } = await connected({ fillCode: true });
		await w.connection.pageLoaded(7, PAGE);
		await until(() => w.last().fill !== undefined);
		w.send({ type: "fill", id: w.last().fill?.id, yes: true });
		await until(() => fake.filled.length > 0);
		// The relay answers the post with the same request's page (a code
		// it did not take). The library would fill that once more unasked.
		await w.connection.pageLoaded(7, PAGE);
		await until(() => w.last().fill !== undefined || fake.filled.length > 1);
		expect(w.last().fill).toBeDefined();
		await Bun.sleep(50);
		expect(fake.filled).toHaveLength(1);
	});

	test("pairing is held on for a fill; a yes sends pairing.start also while the panel shows the code, and the code the card shows is filled in", async () => {
		const start = spyOn(TabMcp.prototype, "startPairing");
		try {
			const { w } = await connected({ fillCode: true });
			w.send({ type: "pair", on: true });
			await until(() => w.last().code !== undefined);
			const shown = w.last().code as string;
			expect(start).toHaveBeenCalledTimes(1);
			await w.connection.pageLoaded(7, PAGE);
			await until(() => w.last().fill !== undefined);
			w.send({ type: "fill", id: w.last().fill?.id, yes: true });
			await until(() => fake.filled.length > 0, 15_000);
			// The relay answers the second pairing.start with the code it
			// shows; that one is filled in, at once.
			expect(start).toHaveBeenCalledTimes(2);
			expect(fake.filled).toEqual([shown]);
			// The panel's pairing view closes: the fill holds pairing on.
			w.send({ type: "pair", on: false });
			await Bun.sleep(50);
			expect(w.last().code).toBeDefined();
		} finally {
			start.mockRestore();
		}
	});

	test("a panel's pairing view from before a relay switch does not keep a yes from turning pairing on with the new relay", async () => {
		const other = startTestRelay({ maxSessionsPerIp: 50 });
		try {
			const { w } = await connected({ fillCode: true });
			w.send({ type: "pair", on: true });
			await until(() => w.last().code !== undefined);
			// The relay changes; the panel's flag is still set (its own
			// pair off has not come yet).
			w.send({ type: "set-relay", relay: other.url });
			await until(() => w.last().relay === other.url);
			w.send({ type: "connect" });
			await until(() => w.last().state === "connected");
			expect(w.last().pairing).toBe(true);
			expect(w.last().code).toBeUndefined();
			await w.connection.pageLoaded(7, PAGE);
			await until(() => w.last().fill !== undefined);
			w.send({ type: "fill", id: w.last().fill?.id, yes: true });
			// Without pairing on the new relay no code would come, and after
			// 10 s the panel would say it could not fill in the code.
			await until(() => fake.filled.length > 0, 5_000);
			expect(fake.filled).toEqual([w.last().code as string]);
			expect(w.last().fillProblem).toBeUndefined();
		} finally {
			await other.stop();
		}
	});

	test("without a panel's pairing view, a yes turns pairing on for the fill and fills in the code the card shows", async () => {
		const start = spyOn(TabMcp.prototype, "startPairing");
		try {
			const { w } = await connected({ fillCode: true });
			await w.connection.pageLoaded(7, PAGE);
			await until(() => w.last().fill !== undefined);
			expect(start).toHaveBeenCalledTimes(0);
			w.send({ type: "fill", id: w.last().fill?.id, yes: true });
			await until(() => fake.filled.length > 0, 15_000);
			expect(start).toHaveBeenCalledTimes(1);
			expect(fake.filled).toEqual([w.last().code as string]);
			expect(w.last().fill).toBeUndefined();
			expect(w.last().pairing).toBe(false);
		} finally {
			start.mockRestore();
		}
	});
});
