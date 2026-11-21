/**
 * Filling in the code on the relay's pairing page (DEC-044 and its review),
 * with the client library's parts (`@ractive-ch/tab-mcp-client/extension`,
 * tab-mcp's DEC-206): its content script in a page of the relay's markup,
 * its `CodeFiller` in the worker, and between them a port as Chrome gives
 * one; Sitegloss's own part is the question (`FillQuestion`). The library's
 * own tests cover its rules one by one; these check that, put together as
 * Sitegloss puts them, the rules of Sitegloss's audit still hold, or how
 * they changed. Against a fixture with the relay's markup (tab-mcp's
 * `oauth/server.ts`, relay 0.12, the hooks of its DEC-199): the testing
 * package's relay cannot show the form for a test client.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { PairingCode } from "@ractive-ch/tab-mcp-client";
import {
	CodeFiller,
	type CodeSource,
	type FillHost,
	pagePort,
	runPairingPage,
} from "@ractive-ch/tab-mcp-client/extension";
import { Window } from "happy-dom";
import { FillQuestion } from "../src/worker/fill-question.ts";
import { HOSTED_ORIGIN, PAIR_FILL_SITE } from "../src/worker/pair-fill.ts";
import { fillAppLabel } from "../src/worker/protocol.ts";
import { pairingPage, portPair } from "./pair-fill-page.ts";

const EXTENSION = "sitegloss-id";
const PAGE = `${HOSTED_ORIGIN}/authorize?response_type=code&x=1`;

const open: Window[] = [];
afterEach(() => {
	for (const w of open.splice(0)) void w.happyDOM.close();
});

/** One page load in a tab. */
interface Load {
	url: string;
	window: Window;
	/** The codes its form posted (Connect). */
	submitted: string[];
	/** It opened a port to the worker (it has Sitegloss's form). */
	port: ReturnType<typeof portPair> | undefined;
}

/** A fake browser and library around the library's filler and Sitegloss's question. */
function setup(
	options: {
		holdMs?: number;
		askMs?: number;
		problemMs?: number;
		grants?: string[];
	} = {},
) {
	const holds: boolean[] = [];
	const notices: (string | undefined)[] = [];
	const tabs = new Map<number, Load>();
	let clock = Date.parse("2026-11-21T12:00:00Z");
	let code: PairingCode | undefined = {
		code: "BCDF-GHJK",
		expiresAt: new Date(clock + 60_000).toISOString(),
	};
	const codeListeners = new Set<() => void>();
	const source: CodeSource = {
		current: () => code,
		onChange: (l) => {
			codeListeners.add(l);
			return () => codeListeners.delete(l);
		},
	};
	const state = { enabled: true, aiOn: true, origin: HOSTED_ORIGIN as string };
	const question = new FillQuestion(
		{
			notify: (view) => notices.push(view?.id),
			changed: () => {},
			visible: (text) => text,
			hold: (on) => holds.push(on),
			codes: () => source,
			now: () => clock,
		},
		options,
	);
	const host: FillHost = {
		extensionId: EXTENSION,
		app: "sitegloss",
		relayOrigin: () => state.origin,
		aiOn: () => state.aiOn,
		enabled: () => state.enabled,
		ask: (tabId, client, signal) => question.ask(tabId, client, signal),
		code: (signal) => question.code(signal),
		release: () => question.release(),
		failed: (why) => question.failed(why),
		now: () => clock,
	};
	const filler = new CodeFiller(host, {
		...(options.grants ? { grants: options.grants } : {}),
		closeAfterMs: 20,
	});
	const pages: Promise<void>[] = [];
	return {
		filler,
		question,
		state,
		holds,
		notices,
		/**
		 * Tab `id` loads `url` with `html` (its old document goes), and the
		 * worker puts the library's script in.
		 */
		load(
			id: number,
			url: string,
			html: string,
			where: { framed?: boolean; extension?: string } = {},
		): Load {
			tabs.get(id)?.port?.gone();
			const window = new Window({ url });
			open.push(window);
			window.document.write(html);
			const load: Load = { url, window, submitted: [], port: undefined };
			window.document.querySelector("form")?.addEventListener("submit", (e) => {
				e.preventDefault();
				const field = window.document.querySelector(
					"[data-tab-mcp-field=code]",
				) as unknown as HTMLInputElement | null;
				load.submitted.push(field?.value ?? "");
			});
			tabs.set(id, load);
			const parsed = new URL(url);
			// Once per document: each load here is a document of its own.
			delete (globalThis as Record<string, unknown>)["__tabMcpPairingPage"];
			runPairingPage({
				app: "sitegloss",
				connect: () => {
					const pair = portPair({
						id: where.extension ?? EXTENSION,
						url,
						origin: parsed.origin,
						tab: { id },
						frameId: where.framed ? 3 : 0,
					});
					load.port = pair;
					// Chrome's onConnect comes after connect() returned.
					queueMicrotask(() => pages.push(filler.page(pagePort(pair.worker))));
					return pair.content;
				},
				page: {
					document: window.document as unknown as Document,
					topLevel: !where.framed,
					pathname: parsed.pathname,
				},
			});
			return load;
		},
		/** Tab `id` closes. */
		close(id: number) {
			tabs.get(id)?.port?.gone();
			tabs.delete(id);
		},
		/** Withdraw everything, as the connection does (AI access off, turned off). */
		withdraw() {
			filler.withdrawAll();
			question.withdraw();
		},
		/** The relay sends `next` as the code (or the same again). */
		sendCode(next: PairingCode | undefined) {
			code = next;
			for (const l of [...codeListeners]) l();
		},
		setCode(next: PairingCode | undefined) {
			code = next;
		},
		tick(ms: number) {
			clock += ms;
		},
		get now() {
			return clock;
		},
		/** Until every page the filler took is done with. */
		settled: () => Promise.all(pages),
	};
}

/** Let the ports' messages and the filler's awaits run. */
const turns = () => Bun.sleep(5);

describe("which page counts", () => {
	test("only the hosted relay's site is asked for", () => {
		expect(HOSTED_ORIGIN).toBe("https://tab-mcp.ractive.ch");
		expect(PAIR_FILL_SITE).toEqual({
			origins: ["https://tab-mcp.ractive.ch/*"],
		});
	});

	test("Review 7: a look-alike origin, another port of the relay's host, a frame or another extension's script gets no question; a form for another app opens no port", async () => {
		const f = setup();
		f.load(1, "https://tab-mcp.ractive.ch:8443/authorize", pairingPage());
		f.load(
			2,
			"https://tab-mcp.ractive.ch.example.com/authorize",
			pairingPage(),
		);
		f.load(3, PAGE, pairingPage(), { framed: true });
		f.load(4, PAGE, pairingPage(), { extension: "another-extension" });
		const other = f.load(5, PAGE, pairingPage({ app: "tab-mcp-extension" }));
		await turns();
		expect(f.question.question).toBeUndefined();
		expect(other.port).toBeUndefined();
	});

	test("not as documented: no port, no question", async () => {
		const f = setup();
		const pages = [
			f.load(1, PAGE, pairingPage({ forms: 2 })),
			f.load(2, PAGE, pairingPage({ requestId: "" })),
			f.load(3, PAGE, pairingPage({ host: "" })),
			f.load(4, `${HOSTED_ORIGIN}/other`, pairingPage()),
		];
		await turns();
		expect(pages.map((p) => p.port)).toEqual([
			undefined,
			undefined,
			undefined,
			undefined,
		]);
		expect(f.question.question).toBeUndefined();
	});
});

describe("the question and the fill", () => {
	test("a form for Sitegloss gets the question, naming the verified host first; a yes fills in that page", async () => {
		const f = setup();
		const t = f.load(
			1,
			PAGE,
			pairingPage({ name: "Claude (claude.ai)", host: "evil.example" }),
		);
		await turns();
		const q = f.question.question;
		expect(q).toMatchObject({
			name: "Claude (claude.ai)",
			host: "evil.example",
		});
		expect(fillAppLabel(q as never)).toBe(
			"An AI app at evil.example (it calls itself “Claude (claude.ai)”)",
		);
		expect(f.notices).toEqual([q?.id]);
		expect(t.submitted).toEqual([]);
		f.question.answer(q?.id as string, true);
		await turns();
		expect(t.submitted).toEqual(["BCDF-GHJK"]);
		expect(f.question.question).toBeUndefined();
		expect(f.question.problem).toBeUndefined();
		// The filled page's port is closed after a while.
		await Bun.sleep(40);
		expect(t.port?.connected).toBe(false);
	});

	test("a form with no name is asked about by its host alone", async () => {
		const f = setup();
		f.load(1, PAGE, pairingPage({ name: "" }));
		await turns();
		expect(fillAppLabel(f.question.question as never)).toBe(
			"An AI app at claude.ai",
		);
	});

	test("No fills in nothing; a stale id does nothing", async () => {
		const f = setup();
		const t = f.load(1, PAGE, pairingPage());
		await turns();
		f.question.answer("not-the-id", true);
		await turns();
		expect(t.submitted).toEqual([]);
		f.question.answer(f.question.question?.id as string, false);
		await turns();
		expect(t.submitted).toEqual([]);
		expect(f.question.question).toBeUndefined();
		expect(t.port?.connected).toBe(false);
	});

	test("Review 1, changed by the library: the relay's wrong-code page (same tab, same request) within 30 s is filled once more without asking; a third time neither fills nor asks", async () => {
		const f = setup();
		const first = f.load(1, PAGE, pairingPage({ requestId: "r_1" }));
		await turns();
		f.question.answer(f.question.question?.id as string, true);
		await turns();
		expect(first.submitted).toHaveLength(1);
		// The relay answers the post with the same form, an error above it.
		const again = f.load(
			1,
			`${HOSTED_ORIGIN}/authorize`,
			pairingPage({ requestId: "r_1", error: "Wrong code" }),
		);
		await turns();
		expect(f.question.question).toBeUndefined();
		expect(again.submitted).toEqual(["BCDF-GHJK"]);
		const third = f.load(
			1,
			`${HOSTED_ORIGIN}/authorize`,
			pairingPage({ requestId: "r_1", error: "Wrong code" }),
		);
		await turns();
		expect(f.question.question).toBeUndefined();
		expect(third.submitted).toEqual([]);
		// A new request of the AI app in that tab: asked.
		const next = f.load(1, PAGE, pairingPage({ requestId: "r_2" }));
		await turns();
		expect(next.submitted).toEqual([]);
		expect(f.question.question).toBeDefined();
	});

	test("Review 1: after 30 s the same request's page is asked about again", async () => {
		const f = setup();
		f.load(1, PAGE, pairingPage({ requestId: "r_1" }));
		await turns();
		f.question.answer(f.question.question?.id as string, true);
		await turns();
		f.tick(31_000);
		const again = f.load(1, PAGE, pairingPage({ requestId: "r_1" }));
		await turns();
		expect(again.submitted).toEqual([]);
		expect(f.question.question).toBeDefined();
	});

	test("Review 1 and 2: a yes whose code is on its way fills in nothing once its tab loaded another page, a look-alike or another request", async () => {
		const f = setup();
		f.setCode(undefined);
		f.load(1, PAGE, pairingPage({ requestId: "r_1" }));
		await turns();
		f.question.answer(f.question.question?.id as string, true);
		await turns();
		// The AI app's page sends the tab elsewhere, with a look-alike form.
		const evil = f.load(1, "https://evil.example/authorize", pairingPage());
		const next = f.load(2, PAGE, pairingPage({ requestId: "r_2" }));
		f.sendCode({
			code: "BCDF-GHJK",
			expiresAt: new Date(f.now + 60_000).toISOString(),
		});
		await turns();
		expect(evil.submitted).toEqual([]);
		expect(next.submitted).toEqual([]);
		// Nothing went into a page: pairing is let go at once.
		expect(f.holds).toEqual([true, false]);
	});

	test("Review 2: withdrawn (AI access off, turned off, another relay), the question goes at once, and a yes waiting for its code fills in nothing", async () => {
		const f = setup();
		f.load(1, PAGE, pairingPage());
		await turns();
		expect(f.question.question).toBeDefined();
		f.withdraw();
		expect(f.question.question).toBeUndefined();
		expect(f.notices.at(-1)).toBeUndefined();

		f.setCode(undefined);
		const t = f.load(2, PAGE, pairingPage({ requestId: "r_2" }));
		await turns();
		f.question.answer(f.question.question?.id as string, true);
		await turns();
		expect(f.question.busy).toBe(true);
		f.withdraw();
		f.sendCode({
			code: "BCDF-GHJK",
			expiresAt: new Date(f.now + 60_000).toISOString(),
		});
		await turns();
		expect(t.submitted).toEqual([]);
		expect(f.question.problem).toBeUndefined();
		expect(f.question.busy).toBe(false);
		// Pairing is let go at once, not after the hold.
		expect(f.holds).toEqual([true, false]);
	});

	test("Review 2: the setting or AI access off at the moment the code comes: nothing is sent", async () => {
		for (const off of ["enabled", "aiOn"] as const) {
			const f = setup();
			f.setCode(undefined);
			const t = f.load(1, PAGE, pairingPage());
			await turns();
			f.question.answer(f.question.question?.id as string, true);
			await turns();
			f.state[off] = false;
			f.sendCode({
				code: "BCDF-GHJK",
				expiresAt: new Date(f.now + 60_000).toISOString(),
			});
			await turns();
			expect(t.submitted).toEqual([]);
		}
	});

	test("Review 3: not turned on, or AI access not connected: the page is not asked about", async () => {
		const f = setup();
		f.state.enabled = false;
		const t = f.load(1, PAGE, pairingPage());
		await turns();
		expect(f.question.question).toBeUndefined();
		expect(t.port?.connected).toBe(false);
		f.state.enabled = true;
		f.state.aiOn = false;
		f.load(2, PAGE, pairingPage());
		await turns();
		expect(f.question.question).toBeUndefined();
	});

	test("Review 5: a pairing page in another tab while a question waits is not asked about, and the panel says so; the same tab's new page replaces its question", async () => {
		const f = setup();
		f.load(1, PAGE, pairingPage({ host: "first.example" }));
		await turns();
		const first = f.question.question?.id;
		const second = f.load(2, PAGE, pairingPage({ host: "second.example" }));
		await turns();
		expect(f.question.question?.id).toBe(first as string);
		expect(f.question.question?.host).toBe("first.example");
		expect(f.question.problem).toBe(
			"An AI app at second.example (it calls itself “Claude”) also opened the relay's page. Sitegloss asks about one at a time: answer the question above first, then reload that page; or type the code there.",
		);
		expect(second.submitted).toEqual([]);
		expect(second.port?.connected).toBe(false);
		// Tab 1 loads a pairing page again: a new question, with a new id.
		f.load(1, PAGE, pairingPage({ host: "third.example", requestId: "r_3" }));
		await turns();
		expect(f.question.question?.host).toBe("third.example");
		expect(f.question.question?.id).not.toBe(first as string);
	});

	test("Review of #27: a pairing page in another tab while a code is on its way is not asked about, and the panel says so", async () => {
		const f = setup();
		f.setCode(undefined);
		const first = f.load(1, PAGE, pairingPage({ host: "first.example" }));
		await turns();
		f.question.answer(f.question.question?.id as string, true);
		await turns();
		const second = f.load(2, PAGE, pairingPage({ host: "second.example" }));
		await turns();
		expect(f.question.question).toBeUndefined();
		expect(f.question.problem).toBe(
			"An AI app at second.example (it calls itself “Claude”) also opened the relay's page while Sitegloss was filling in the code on another one. Reload that page in a moment to be asked, or type the code there.",
		);
		expect(second.port?.connected).toBe(false);
		f.sendCode({
			code: "BCDF-GHJK",
			expiresAt: new Date(f.now + 60_000).toISOString(),
		});
		await turns();
		expect(first.submitted).toEqual(["BCDF-GHJK"]);
		expect(second.submitted).toEqual([]);
	});

	test("Review 6: pairing is held on from the yes until a while after the fill, also when Connect's post leaves the page; the AI app connecting lets it go at once", async () => {
		const f = setup({ holdMs: 40, grants: [] });
		const t = f.load(1, PAGE, pairingPage());
		await turns();
		f.question.answer(f.question.question?.id as string, true);
		await turns();
		// Connect's own post: the document goes.
		t.port?.gone();
		expect(f.holds).toEqual([true]);
		await Bun.sleep(80);
		expect(f.holds).toEqual([true, false]);
		expect(f.question.busy).toBe(false);

		const g = setup({ holdMs: 10_000, grants: [] });
		g.load(1, PAGE, pairingPage({ host: "claude.ai" }));
		await turns();
		g.question.answer(g.question.question?.id as string, true);
		await turns();
		expect(g.holds).toEqual([true]);
		g.filler.grantsChanged([{ grantId: "g1", host: "claude.ai" }]);
		expect(g.holds).toEqual([true, false]);
	});

	test("the AI app connecting meanwhile (typed by hand) withdraws its question; the relay's first list is taken as it is", async () => {
		const f = setup();
		f.filler.grantsChanged([{ grantId: "old", host: "claude.ai" }]);
		f.load(1, PAGE, pairingPage({ host: "claude.ai" }));
		await turns();
		expect(f.question.question).toBeDefined();
		f.filler.grantsChanged([
			{ grantId: "old", host: "claude.ai" },
			{ grantId: "new", host: "claude.ai" },
		]);
		await turns();
		expect(f.question.question).toBeUndefined();
	});

	test("the question runs out with a code's life", async () => {
		const f = setup({ askMs: 30 });
		const t = f.load(1, PAGE, pairingPage());
		await turns();
		expect(f.question.question).toBeDefined();
		await Bun.sleep(60);
		expect(f.question.question).toBeUndefined();
		expect(t.port?.connected).toBe(false);
	});

	test("the tab closing ends its question", async () => {
		const f = setup();
		f.load(1, PAGE, pairingPage());
		await turns();
		f.close(1);
		await turns();
		expect(f.question.question).toBeUndefined();
	});

	test("no code from the relay: the panel says to type it, naming the AI app, for a while", async () => {
		const f = setup({ problemMs: 1000 });
		f.setCode(undefined);
		f.load(1, PAGE, pairingPage({ host: "claude.ai" }));
		await turns();
		const answered = f.question.answer(f.question.question?.id as string, true);
		expect(answered).toBeUndefined();
		// takeCode waits 10 s for a code that never comes.
		await Bun.sleep(10_200);
		expect(f.question.problem).toBe(
			"Sitegloss could not fill in the code for the AI app at claude.ai. Type the code from the AI app card on the relay's page.",
		);
		expect(f.holds).toEqual([true, false]);
		await Bun.sleep(1100);
		expect(f.question.problem).toBeUndefined();
	}, 15_000);
});

describe("Review 4: which code is filled in, by Sitegloss's clock", () => {
	test("the current one while it has 5 s left", async () => {
		const f = setup();
		f.setCode({
			code: "AAAA-AAAA",
			expiresAt: new Date(f.now + 5000).toISOString(),
		});
		const t = f.load(1, PAGE, pairingPage());
		await turns();
		f.question.answer(f.question.question?.id as string, true);
		await turns();
		expect(t.submitted).toEqual(["AAAA-AAAA"]);
	});

	test("about to end: the next one the relay sends", async () => {
		const f = setup();
		f.setCode({
			code: "AAAA-AAAA",
			expiresAt: new Date(f.now + 4999).toISOString(),
		});
		const t = f.load(1, PAGE, pairingPage());
		await turns();
		f.question.answer(f.question.question?.id as string, true);
		await turns();
		expect(t.submitted).toEqual([]);
		f.sendCode({
			code: "BBBB-BBBB",
			expiresAt: new Date(f.now + 120_000).toISOString(),
		});
		await turns();
		expect(t.submitted).toEqual(["BBBB-BBBB"]);
	});

	test("library gap: the same code sent again counts as the next one (the relay answers pairing.start so)", async () => {
		const f = setup();
		const ending = {
			code: "AAAA-AAAA",
			expiresAt: new Date(f.now + 2000).toISOString(),
		};
		f.setCode(ending);
		const t = f.load(1, PAGE, pairingPage());
		await turns();
		f.question.answer(f.question.question?.id as string, true);
		await turns();
		f.sendCode({ ...ending });
		await turns();
		// Sitegloss's own filler waited for another code here.
		expect(t.submitted).toEqual(["AAAA-AAAA"]);
	});
});
