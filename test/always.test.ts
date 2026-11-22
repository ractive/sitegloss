/**
 * Always allow and Allow all changes (DEC-018, DEC-043): kept by the tab-mcp
 * client library per AI app (grant) and tool, in the storage Sitegloss
 * passes it, gone with the grant; honoured before Sitegloss's `onConfirm` is
 * asked; and what a call of a tool that changes something gets from them.
 */

import { afterAll, describe, expect, test } from "bun:test";
import {
	Client,
	StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { startTestRelay, tokenFor } from "@ractive-ch/tab-mcp/testing";
import { type ConfirmRequest, TabMcp } from "@ractive-ch/tab-mcp-client";
import {
	AlwaysAllowed,
	OLD_ALWAYS_KEY,
	removeOldStore,
} from "../src/worker/always.ts";
import { type Decider, decide } from "../src/worker/decide.ts";
import { memoryKv } from "../src/worker/kv.ts";
import { type Answer, APP_ID } from "../src/worker/protocol.ts";

/** Wait for `ok`, up to 5 s. */
async function until(ok: () => boolean): Promise<void> {
	const end = Date.now() + 5000;
	while (!ok()) {
		if (Date.now() > end) throw new Error("timed out");
		await Bun.sleep(10);
	}
}

describe("the library keeps them, and asks Sitegloss only for the rest", () => {
	const relay = startTestRelay();
	afterAll(() => relay.stop());

	const CLAUDE = "https://claude.example/client.json";
	const OTHER = "https://other.example/client.json";
	const TOOLS = ["set_summary", "delete_case"];

	/** Sitegloss's kind of page on `storage`, its tools registered for the relay only. */
	async function page(storage: Map<string, string>, asked: string[]) {
		const mcp = new TabMcp({
			relay: relay.url,
			server: { name: "sitegloss", version: "0.0.0" },
			app: APP_ID,
			storage: {
				getItem: (key) => storage.get(key) ?? null,
				setItem: (key, value) => void storage.set(key, value),
			},
			// Sitegloss's question, which allows here, counted.
			onConfirm: (request) => {
				asked.push(request.tool.name);
				return true;
			},
		});
		for (const name of TOOLS)
			await mcp.registerTool(
				{
					name,
					description: `${name}, asks first.`,
					annotations: {
						consequentialHint: true,
						destructiveHint: name === "delete_case",
					},
					execute: () => "done",
				},
				{ callers: ["relay"] },
			);
		return mcp;
	}

	/** A page with two AI apps paired, Claude and Other, and calls from each. */
	async function sitegloss() {
		const storage = new Map<string, string>();
		const asked: string[] = [];
		const mcp = await page(storage, asked);
		const { address } = await mcp.connect();
		const secret = storage.get(`tab-mcp:secret:${relay.url}:sitegloss`);
		const token = (clientId: string, clientName: string) =>
			tokenFor(relay, address, {
				secret: secret as string,
				clientId,
				clientName,
			});
		const tokens = {
			claude: await token(CLAUDE, "Claude"),
			other: await token(OTHER, "Other"),
		};
		// The relay lists the grants from its store at the next connection.
		mcp.disconnect();
		await mcp.connect();
		await until(() => mcp.grants.length === 2);
		const grantOf = (clientId: string) =>
			mcp.grants.find((g) => g.client.id === clientId)?.grantId as string;
		const call = async (app: "claude" | "other", name: string) => {
			const client = new Client(
				{ name: "test", version: "1.0.0" },
				{ versionNegotiation: { mode: { pin: "2026-07-28" } } },
			);
			await client.connect(
				new StreamableHTTPClientTransport(new URL(address), {
					requestInit: {
						headers: { Authorization: `Bearer ${tokens[app]}` },
					},
				}),
			);
			try {
				return await client.callTool({ name, arguments: {} });
			} finally {
				await client.close();
			}
		};
		return {
			mcp,
			storage,
			asked,
			always: AlwaysAllowed.of(mcp),
			claude: grantOf(CLAUDE),
			other: grantOf(OTHER),
			call,
		};
	}

	test("not allowed: Sitegloss is asked for every call", async () => {
		const s = await sitegloss();
		try {
			expect((await s.call("claude", "set_summary")).isError).toBeFalsy();
			expect((await s.call("claude", "set_summary")).isError).toBeFalsy();
			expect(s.asked).toEqual(["set_summary", "set_summary"]);
		} finally {
			s.mcp.disconnect();
		}
	});

	test("Always allow: that tool runs without a question for that app; another tool, and another app, still ask", async () => {
		const s = await sitegloss();
		try {
			s.always.addTool(s.claude, "set_summary");
			expect(s.always.entry(s.claude)).toEqual({
				all: false,
				tools: ["set_summary"],
			});
			expect((await s.call("claude", "set_summary")).isError).toBeFalsy();
			expect(s.asked).toEqual([]);
			await s.call("claude", "delete_case");
			expect(s.asked).toEqual(["delete_case"]);
			// The second app inherits nothing of the first's.
			expect(s.always.entry(s.other)).toEqual({ all: false, tools: [] });
			await s.call("other", "set_summary");
			expect(s.asked).toEqual(["delete_case", "set_summary"]);
			// Ask again takes it back.
			s.always.removeTool(s.claude, "set_summary");
			await s.call("claude", "set_summary");
			expect(s.asked).toEqual(["delete_case", "set_summary", "set_summary"]);
		} finally {
			s.mcp.disconnect();
		}
	});

	test("Allow all changes: every tool runs without a question for that app until it is off", async () => {
		const s = await sitegloss();
		try {
			s.always.setAll(s.claude, true);
			expect(s.always.entry(s.claude).all).toBe(true);
			await s.call("claude", "set_summary");
			await s.call("claude", "delete_case");
			expect(s.asked).toEqual([]);
			// Not for the other app.
			await s.call("other", "delete_case");
			expect(s.asked).toEqual(["delete_case"]);
			s.always.setAll(s.claude, false);
			await s.call("claude", "delete_case");
			expect(s.asked).toEqual(["delete_case", "delete_case"]);
			// Ask again for one tool while it is on turns it off (the library's rule).
			s.always.setAll(s.claude, true);
			s.always.removeTool(s.claude, "set_summary");
			expect(s.always.entry(s.claude).all).toBe(false);
		} finally {
			s.mcp.disconnect();
		}
	});

	test("kept in the storage Sitegloss passes, beside the secret: a new worker has them", async () => {
		const s = await sitegloss();
		s.always.addTool(s.claude, "set_summary");
		s.always.setAll(s.other, true);
		s.mcp.disconnect();
		const kept = s.storage.get(`tab-mcp:secret:${relay.url}:sitegloss#allowed`);
		expect(kept).toBeString();
		// Grant ids, tool names, what the user saw; no arguments, no results.
		expect(kept).not.toContain("done");
		const next = await page(s.storage, []);
		try {
			await next.connect();
			await until(() => next.grants.length === 2);
			const always = AlwaysAllowed.of(next);
			expect(always.has(s.claude, "set_summary")).toBe(true);
			expect(always.has(s.claude, "delete_case")).toBe(false);
			expect(always.entry(s.other).all).toBe(true);
		} finally {
			next.disconnect();
		}
	});

	test("a disconnected app's allowances are gone; the other app keeps its own", async () => {
		const s = await sitegloss();
		try {
			s.always.setAll(s.claude, true);
			s.always.addTool(s.claude, "set_summary");
			s.always.addTool(s.other, "delete_case");
			await s.mcp.revoke(s.claude);
			await until(() => !s.mcp.grants.some((g) => g.grantId === s.claude));
			expect(s.always.entry(s.claude)).toEqual({ all: false, tools: [] });
			expect(s.always.has(s.claude, "set_summary")).toBe(false);
			expect(s.always.entry(s.other)).toEqual({
				all: false,
				tools: ["delete_case"],
			});
			// Nothing is kept for an app that is not connected.
			s.always.addTool(s.claude, "delete_case");
			s.always.setAll(s.claude, true);
			expect(s.always.entry(s.claude)).toEqual({ all: false, tools: [] });
		} finally {
			s.mcp.disconnect();
		}
	});

	test("Disconnect all apps ends every app's allowances", async () => {
		const s = await sitegloss();
		try {
			s.always.setAll(s.claude, true);
			s.always.addTool(s.other, "set_summary");
			await s.mcp.disconnectAll();
			expect(s.always.entry(s.claude)).toEqual({ all: false, tools: [] });
			expect(s.always.entry(s.other)).toEqual({ all: false, tools: [] });
		} finally {
			s.mcp.disconnect();
		}
	});
});

describe("Sitegloss's store from before", () => {
	test("is removed at the worker's start, with nothing taken over", async () => {
		const kv = memoryKv({
			[OLD_ALWAYS_KEY]: { g1: { all: true, tools: ["delete_case"] } },
			relay: "https://relay.example",
		});
		await removeOldStore(kv);
		expect(kv.data.has(OLD_ALWAYS_KEY)).toBe(false);
		expect(kv.data.get("relay")).toBe("https://relay.example");
	});
});

function request(tool = "delete_case", grantId = "g1"): ConfirmRequest {
	return {
		tool: { name: tool, title: tool, description: "" },
		arguments: {},
		client: {
			kind: "relay",
			grantId,
			id: "https://claude.ai/oauth",
			host: "claude.ai",
		},
		signal: new AbortController().signal,
	};
}

/** Allowances in memory, as `decide` sees them. */
class FakeAllowed {
	readonly kept = new Map<string, Set<string>>();
	readonly all = new Set<string>();
	has(grantId: string, tool: string): boolean {
		return (
			this.all.has(grantId) || (this.kept.get(grantId)?.has(tool) ?? false)
		);
	}
	addTool(grantId: string, tool: string): void {
		const tools = this.kept.get(grantId) ?? new Set<string>();
		tools.add(tool);
		this.kept.set(grantId, tools);
	}
}

/** A decider whose user answers `answer`; `asked` counts the questions. */
function decider(answer: Answer | "timeout", connected = true) {
	const always = new FakeAllowed();
	const d: Decider & {
		always: FakeAllowed;
		asked: number;
		kept: () => void;
		keptCount: number;
	} = {
		always,
		asked: 0,
		keptCount: 0,
		ask: async () => {
			d.asked++;
			return answer;
		},
		connected: () => connected,
		kept: () => {
			d.keptCount++;
		},
	};
	return d;
}

describe("a call of a tool that changes something", () => {
	test("asks; Allow and Don't allow hold for this call only", async () => {
		for (const [answer, allowed] of [
			["allow", true],
			["deny", false],
			["timeout", "unanswered"],
		] as const) {
			const d = decider(answer);
			expect(await decide(d, request())).toBe(allowed);
			expect(await decide(d, request())).toBe(allowed);
			expect(d.asked).toBe(2);
		}
	});

	test("Always allow: the next call of that tool from that app does not ask; another tool or app does", async () => {
		const d = decider("always");
		expect(await decide(d, request("set_summary"))).toBe(true);
		expect(d.asked).toBe(1);
		expect(await decide(d, request("set_summary"))).toBe(true);
		expect(d.asked).toBe(1);
		await decide(d, request("delete_case"));
		await decide(d, request("set_summary", "g2"));
		expect(d.asked).toBe(3);
		// Each kept Always allow lets the questions it covers through.
		expect(d.keptCount).toBe(3);
	});

	test("Allow all changes: nothing asks for that app", async () => {
		const d = decider("deny");
		d.always.all.add("g1");
		for (const tool of ["add_mark", "set_summary", "delete_case"])
			expect(await decide(d, request(tool))).toBe(true);
		expect(d.asked).toBe(0);
		expect(await decide(d, request("delete_case", "g2"))).toBe(false);
		expect(d.asked).toBe(1);
	});

	test("a call through WebMCP is refused: no question, Allow all changes does not cover it", async () => {
		const d = decider("allow");
		d.always.all.add("g1");
		const refused: string[] = [];
		d.refused = (r) => refused.push(r.tool.name);
		const r: ConfirmRequest = { ...request(), client: { kind: "webmcp" } };
		expect(await decide(d, r)).toBe(false);
		expect(d.asked).toBe(0);
		expect(refused).toEqual(["delete_case"]);
		// So is a caller over a message port (`serve`, client 0.15), which
		// Sitegloss never opens: only an AI app through the relay is asked about.
		const local: ConfirmRequest = {
			...request(),
			client: { kind: "local", id: "port-1" },
		};
		expect(await decide(d, local)).toBe(false);
		expect(d.asked).toBe(0);
		expect(refused).toEqual(["delete_case", "delete_case"]);
		// An AI app through the relay is as before.
		expect(await decide(d, request())).toBe(true);
	});

	test("Always allow from an app disconnected meanwhile allows this call, keeps nothing", async () => {
		const d = decider("always", false);
		expect(await decide(d, request())).toBe(true);
		expect(d.always.has("g1", "delete_case")).toBe(false);
		expect(d.keptCount).toBe(0);
	});
});
