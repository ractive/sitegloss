/**
 * Filling in the code on the relay's pairing page (DEC-044 and its review),
 * with the client library's parts (`@ractive-ch/tab-mcp-client/extension`,
 * tab-mcp's DEC-206): its content script in a page of the relay's markup,
 * its `CodeFiller` in the worker, and between them a port as Chrome gives
 * one; Sitegloss's own part is the question (`FillQuestion`). The library's
 * own tests cover its rules one by one; these check that, put together as
 * Sitegloss puts them (`retry: false`), the rules of Sitegloss's audit
 * hold. Against a fixture with the relay's markup (tab-mcp's
 * `oauth/server.ts`, relay 0.12, the hooks of its DEC-199): the testing
 * package's relay cannot show the form for a test client.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { PairingCode } from "@ractive-ch/tab-mcp-client";
import {
	CodeFiller,
	type CodeSource,
	type FillContext,
	type FillHost,
	pagePort,
	runPairingPage,
	takeCode,
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
	/** The library's calls of `code`, `failed` and `release`, in order. */
	const calls: (
		| { call: "code"; context: FillContext }
		| { call: "failed"; why: string; context: FillContext }
		| { call: "release" }
	)[] = [];
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
		code: (signal, context) => {
			calls.push({ call: "code", context });
			return question.code(signal, context);
		},
		release: () => {
			calls.push({ call: "release" });
			question.release();
		},
		failed: (why, context) => {
			calls.push({ call: "failed", why, context });
			question.failed(why, context);
		},
		now: () => clock,
	};
	// As the connection makes it: no fill without a yes of its own.
	const filler = new CodeFiller(host, {
		...(options.grants ? { grants: options.grants } : {}),
		retry: false,
		closeAfterMs: 20,
	});
	const pages: Promise<void>[] = [];
	return {
		filler,
		question,
		state,
		holds,
		calls,
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
			// Once per document: the library marks the document given.
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

	test("Review 1: the relay's wrong-code page (same tab, same request) within 30 s is asked about again, never filled without a yes; each yes fills once", async () => {
		const f = setup();
		const first = f.load(1, PAGE, pairingPage({ requestId: "r_1" }));
		await turns();
		f.question.answer(f.question.question?.id as string, true);
		await turns();
		expect(first.submitted).toEqual(["BCDF-GHJK"]);
		// The relay answers the post with the same form, an error above it.
		for (const n of [1, 2]) {
			const again = f.load(
				1,
				`${HOSTED_ORIGIN}/authorize`,
				pairingPage({ requestId: "r_1", error: "Wrong code" }),
			);
			await turns();
			expect(again.submitted).toEqual([]);
			const q = f.question.question;
			expect(q).toBeDefined();
			if (n === 1) {
				f.question.answer(q?.id as string, true);
				await turns();
				expect(again.submitted).toEqual(["BCDF-GHJK"]);
			} else {
				f.question.answer(q?.id as string, false);
				await turns();
				expect(again.submitted).toEqual([]);
				expect(again.port?.connected).toBe(false);
			}
		}
		// One question per page load: the filled page's port asks nothing more.
		expect(f.notices.filter((n) => n !== undefined)).toHaveLength(3);
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
		// The library says which page: its tab and AI app.
		expect(f.calls.filter((c) => c.call === "failed")).toEqual([
			{
				call: "failed",
				why: "no-code",
				context: { tabId: 1, client: { name: "Claude", host: "claude.ai" } },
			},
		]);
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

	test("Bug 1 of 0.19.0-rc.1 gone: the same code sent again (the relay's answer to pairing.start) is not the next one; the next code is", async () => {
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
		expect(t.submitted).toEqual([]);
		f.sendCode({
			code: "BBBB-BBBB",
			expiresAt: new Date(f.now + 120_000).toISOString(),
		});
		await turns();
		expect(t.submitted).toEqual(["BBBB-BBBB"]);
	});

	test("the same code sent again with an expiry that now leaves 5 s counts", async () => {
		const f = setup();
		f.setCode({
			code: "AAAA-AAAA",
			expiresAt: new Date(f.now + 2000).toISOString(),
		});
		const t = f.load(1, PAGE, pairingPage());
		await turns();
		f.question.answer(f.question.question?.id as string, true);
		await turns();
		f.sendCode({
			code: "AAAA-AAAA",
			expiresAt: new Date(f.now + 60_000).toISOString(),
		});
		await turns();
		expect(t.submitted).toEqual(["AAAA-AAAA"]);
	});

	test("takeCode by itself: the same code again does not end the wait; a code that looks about to end by this clock (one ahead of the relay's) comes after the whole wait", async () => {
		let current: PairingCode | undefined = {
			code: "AAAA-AAAA",
			expiresAt: "2026-11-21T12:00:02Z",
		};
		const listeners = new Set<() => void>();
		const source: CodeSource = {
			current: () => current,
			onChange: (l) => {
				listeners.add(l);
				return () => listeners.delete(l);
			},
		};
		const now = Date.parse("2026-11-21T12:00:00Z");
		const started = Date.now();
		const taken = takeCode(source, new AbortController().signal, {
			now,
			waitMs: 200,
		});
		let settled = false;
		void taken.then(() => {
			settled = true;
		});
		await Bun.sleep(20);
		current = { ...(current as PairingCode) };
		for (const l of [...listeners]) l();
		await Bun.sleep(20);
		expect(settled).toBe(false);
		// No other code comes: the current one, after the whole wait.
		expect(await taken).toBe("AAAA-AAAA");
		expect(Date.now() - started).toBeGreaterThanOrEqual(190);
		expect(listeners.size).toBe(0);
	});
});

describe("client 0.19.0-rc.2: what was raised against rc.1", () => {
	test("Point 3: code and failed say which page, its tab and AI app; a second tab while a code is on its way is told so, the same tab is asked", async () => {
		const f = setup();
		f.setCode(undefined);
		f.load(2, PAGE, pairingPage({ host: "first.example", name: "" }));
		await turns();
		f.question.answer(f.question.question?.id as string, true);
		await turns();
		expect(f.calls).toEqual([
			{
				call: "code",
				context: { tabId: 2, client: { name: "", host: "first.example" } },
			},
		]);
		const other = f.load(1, PAGE, pairingPage({ host: "second.example" }));
		await turns();
		expect(f.question.question).toBeUndefined();
		expect(f.question.problem).toContain("while Sitegloss was filling in");
		expect(other.port?.connected).toBe(false);
		expect(f.calls.at(-1)).toEqual({
			call: "failed",
			why: "busy",
			context: {
				tabId: 1,
				client: { name: "Claude", host: "second.example" },
			},
		});
		// Tab 2 loads a new page: the old one went with its fill; asked.
		f.load(2, PAGE, pairingPage({ host: "third.example", requestId: "r_3" }));
		await turns();
		expect(f.question.question?.host).toBe("third.example");
	});

	test("Point 4: the relay changing while the page's hello is awaited, or while the question waits, asks nothing and fills nothing", async () => {
		const f = setup();
		const pair = portPair({
			id: EXTENSION,
			url: PAGE,
			origin: HOSTED_ORIGIN,
			tab: { id: 1 },
			frameId: 0,
		});
		const done = f.filler.page(pagePort(pair.worker));
		await turns();
		// Another relay, no reset() from the host: the library's own check.
		f.state.origin = "https://other-relay.example";
		pair.content.postMessage({
			type: "pairing-page",
			nonce: "n".repeat(32),
			app: "sitegloss",
			clientName: "Claude",
			clientHost: "claude.ai",
			requestId: "r_1",
		});
		await done;
		expect(f.question.question).toBeUndefined();
		expect(pair.connected).toBe(false);

		const g = setup();
		const t = g.load(1, PAGE, pairingPage());
		await turns();
		expect(g.question.question).toBeDefined();
		g.state.origin = "https://other-relay.example";
		g.question.answer(g.question.question?.id as string, true);
		await turns();
		expect(t.submitted).toEqual([]);
		expect(t.port?.connected).toBe(false);
		expect(g.calls).toEqual([]);
		expect(g.holds).toEqual([]);
	});

	test("Point 5: a test's page carries the once-per-document mark, not the global; the same document is run once", async () => {
		const f = setup();
		const a = f.load(1, PAGE, pairingPage());
		const b = f.load(2, PAGE, pairingPage({ requestId: "r_2" }));
		expect(a.port).toBeDefined();
		expect(b.port).toBeDefined();
		expect(
			(globalThis as Record<string, unknown>)["__tabMcpPairingPage"],
		).toBeUndefined();
		const again = runPairingPage({
			app: "sitegloss",
			connect: () => {
				throw new Error("not again");
			},
			page: {
				document: a.window.document as unknown as Document,
				topLevel: true,
				pathname: "/authorize",
			},
		});
		expect(again).toBe(false);
	});

	test("Point 6: a fill that ends without its code releases pairing once, and Sitegloss lets go once", async () => {
		const f = setup();
		f.setCode(undefined);
		f.load(1, PAGE, pairingPage());
		await turns();
		f.question.answer(f.question.question?.id as string, true);
		await turns();
		f.close(1);
		await turns();
		expect(f.calls.map((c) => c.call)).toEqual(["code", "release"]);
		expect(f.holds).toEqual([true, false]);
		// release() again with nothing held: nothing.
		f.question.release();
		expect(f.holds).toEqual([true, false]);
	});

	test("Point 6: a fill that ends without its code keeps pairing on while an earlier fill's code may still be checked; that AI app connecting lets it go, once", async () => {
		const f = setup({ holdMs: 10_000, grants: [] });
		const a = f.load(1, PAGE, pairingPage({ host: "first.example" }));
		await turns();
		f.question.answer(f.question.question?.id as string, true);
		await turns();
		expect(a.submitted).toEqual(["BCDF-GHJK"]);
		expect(f.holds).toEqual([true]);
		// Another AI app's page, allowed; it goes before its code came.
		f.setCode(undefined);
		f.load(2, PAGE, pairingPage({ host: "second.example", requestId: "r_2" }));
		await turns();
		f.question.answer(f.question.question?.id as string, true);
		await turns();
		f.close(2);
		await turns();
		expect(f.calls.map((c) => c.call)).toEqual(["code", "code"]);
		expect(f.holds).toEqual([true]);
		// The first AI app connects: its fill is done with.
		f.filler.grantsChanged([{ grantId: "g1", host: "first.example" }]);
		expect(f.calls.at(-1)).toEqual({ call: "release" });
		expect(f.holds).toEqual([true, false]);
		// Another grant of that host: no fill left, no release.
		f.filler.grantsChanged([
			{ grantId: "g1", host: "first.example" },
			{ grantId: "g2", host: "first.example" },
		]);
		expect(f.calls.filter((c) => c.call === "release")).toHaveLength(1);
		expect(f.holds).toEqual([true, false]);
	});
});
