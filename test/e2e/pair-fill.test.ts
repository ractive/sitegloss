/**
 * End to end, in Chromium: an AI app opens the relay's pairing page in this
 * browser, Sitegloss asks in its side panel, and only a yes fills in its
 * code and clicks Connect (DEC-044). Off until "Fill in the code for me"
 * (the review of DEC-044), also with access to all sites, which a test build
 * has. The page is a fixture with the relay's
 * markup (`pairingPage`, as the unit tests use it) served on a port of its own:
 * the testing package's relay cannot show its form for a test client. The
 * test build takes that origin through `siteglossTestFillOrigin`; other
 * builds fill in only the hosted relay's page.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startTestRelay } from "@ractive-ch/tab-mcp/testing";
import { pairingPage } from "../pair-fill-page.ts";
import {
	byId,
	connectAi,
	newNotification,
	notifications,
	openSidePanel,
	setRelay,
} from "./ai.ts";
import type { Page } from "./browser.ts";
import { browserBinary, type Harness, startHarness } from "./harness.ts";
import { worker } from "./steps.ts";

describe.skipIf(browserBinary === undefined)(
	"filling in the code on the relay's pairing page",
	() => {
		let h: Harness;
		let panel: Page;
		const relay = startTestRelay();
		/** The codes the fixture's form posted. */
		const posted: string[] = [];
		const fixture = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch: async (req) => {
				const url = new URL(req.url);
				if (req.method === "POST") {
					const form = await req.formData();
					posted.push(String(form.get("code")));
					return new Response("posted");
				}
				if (url.pathname !== "/authorize")
					return new Response("Not found", { status: 404 });
				return new Response(
					pairingPage({
						app: url.searchParams.get("app") ?? "sitegloss",
						name: "Test AI",
						host: url.searchParams.get("host") ?? "client.example",
						requestId: url.searchParams.get("r") ?? "r_1",
					}),
					{ headers: { "content-type": "text/html" } },
				);
			},
		});
		const origin = `http://127.0.0.1:${fixture.port}`;
		const ASK = byId("pair-fill-ask");
		const PROBLEM = byId("pair-fill-problem");
		const close = (page: Page) =>
			h.browser.send("Target.closeTarget", { targetId: page.targetId });

		beforeAll(async () => {
			h = await startHarness(browserBinary as string);
			const w = await worker(h);
			await w.eval(
				`globalThis.siteglossTestFillOrigin = ${JSON.stringify(origin)}`,
			);
			panel = await openSidePanel(h);
			await connectAi(panel, relay.url);
			await panel.send("Emulation.setFocusEmulationEnabled", {
				enabled: true,
			});
		}, 60_000);

		afterAll(async () => {
			await h?.stop();
			await relay.stop();
			await fixture.stop(true);
		});

		test("off by default, also with access to all sites: a pairing page gets no question; Fill in the code for me turns it on", async () => {
			const tab = await h.browser.newPage(`${origin}/authorize?r=0`);
			await Bun.sleep(1500);
			expect(await panel.eval(`${ASK}.hidden`)).toBe(true);
			await close(tab);
			await panel.waitFor(`!${byId("pair-fill")}.hidden`, 10_000);
			expect(await panel.eval(`${byId("pair-fill-off")}.hidden`)).toBe(true);
			await panel.eval(`${byId("pair-fill-on")}.click()`);
			await panel.waitFor(`${byId("pair-fill-on")}.hidden`, 10_000);
			expect(await panel.eval(`${byId("pair-fill-off")}.hidden`)).toBe(false);
			expect(
				await panel.eval<string>(`${byId("pair-fill-text")}.textContent`),
			).toBe(
				"When an AI app opens tab-mcp.ractive.ch's pairing page in this browser, Sitegloss asks you, then fills in the code.",
			);
		});

		test("a form for Sitegloss: the panel asks, naming the verified host first; Fill in the code types the code and clicks Connect", async () => {
			const tab = await h.browser.newPage(`${origin}/authorize?r=1`);
			await panel.waitFor(`!${ASK}.hidden`, 10_000);
			expect(
				await panel.eval<string>(`${byId("pair-fill-ask-text")}.textContent`),
			).toBe(
				"An AI app at client.example (it calls itself “Test AI”) wants to connect to Sitegloss on the relay's page in this browser. Fill in the code there?",
			);
			// The code is shown by the card (no app paired: the pairing view is open).
			await panel.waitFor(
				`/^[A-Z]{4}-[A-Z]{4}$/.test(${byId("pair-code")}.textContent)`,
				10_000,
			);
			const code = await panel.eval<string>(`${byId("pair-code")}.textContent`);
			// Nothing was filled in before the answer.
			expect(posted).toEqual([]);
			expect(
				await tab.eval<string>(
					`document.querySelector("[data-tab-mcp-field=code]").value`,
				),
			).toBe("");
			const yes = byId("pair-fill-yes");
			await panel.waitFor(`!${yes}.disabled`, 10_000);
			await panel.eval(`${yes}.click()`);
			await panel.waitFor(`${ASK}.hidden`, 10_000);
			const end = Date.now() + 10_000;
			while (posted.length === 0 && Date.now() < end) await Bun.sleep(50);
			expect(posted).toEqual([code]);
			await close(tab);
		});

		test("No: nothing is filled in, the form stays as it was", async () => {
			const tab = await h.browser.newPage(`${origin}/authorize?r=2`);
			await panel.waitFor(`!${ASK}.hidden`, 10_000);
			await panel.eval(`${byId("pair-fill-no")}.click()`);
			await panel.waitFor(`${ASK}.hidden`, 10_000);
			await Bun.sleep(500);
			expect(posted).toHaveLength(1);
			expect(
				await tab.eval<string>(
					`document.querySelector("[data-tab-mcp-field=code]").value`,
				),
			).toBe("");
			await close(tab);
		});

		test("a second pairing page while a question waits: not asked about, and the panel says so", async () => {
			const first = await h.browser.newPage(`${origin}/authorize?r=3`);
			await panel.waitFor(`!${ASK}.hidden`, 10_000);
			const second = await h.browser.newPage(
				`${origin}/authorize?r=4&host=second.example`,
			);
			await panel.waitFor(`!${PROBLEM}.hidden`, 10_000);
			expect(await panel.eval<string>(`${PROBLEM}.textContent`)).toContain(
				"An AI app at second.example (it calls itself “Test AI”) also opened the relay's page.",
			);
			expect(
				await panel.eval<string>(`${byId("pair-fill-ask-text")}.textContent`),
			).toContain("client.example");
			await panel.eval(`${byId("pair-fill-no")}.click()`);
			await panel.waitFor(`${ASK}.hidden`, 10_000);
			expect(posted).toHaveLength(1);
			await close(first);
			await close(second);
		});

		test("closing the page withdraws its question", async () => {
			const tab = await h.browser.newPage(`${origin}/authorize?r=6`);
			await panel.waitFor(`!${ASK}.hidden`, 10_000);
			await close(tab);
			await panel.waitFor(`${ASK}.hidden`, 10_000);
			expect(posted).toHaveLength(1);
		});

		test("a form for another app, or a page of another origin: no question", async () => {
			const other = await h.browser.newPage(`${origin}/authorize?app=other`);
			const elsewhere = await h.browser.newPage(`${h.base}/v1?/authorize`);
			await Bun.sleep(1500);
			expect(await panel.eval(`${ASK}.hidden`)).toBe(true);
			expect(posted).toHaveLength(1);
			await close(other);
			await close(elsewhere);
		});

		test("Stop AI access withdraws the question at once", async () => {
			const tab = await h.browser.newPage(`${origin}/authorize?r=7`);
			await panel.waitFor(`!${ASK}.hidden`, 10_000);
			await panel.eval(`${byId("stop-ai")}.click()`);
			await panel.waitFor(`${ASK}.hidden`, 10_000);
			await panel.eval(`${byId("connect")}.click()`);
			await panel.waitFor(
				`document.documentElement.dataset.aiState === "connected"`,
				10_000,
			);
			await Bun.sleep(500);
			expect(await panel.eval(`${ASK}.hidden`)).toBe(true);
			expect(posted).toHaveLength(1);
			await close(tab);
		});

		test("with the panel covered, a notification asks to answer in the panel; it goes with the question", async () => {
			const cover = (hidden: boolean) =>
				panel.eval(`(() => {
					Object.defineProperty(document, "visibilityState", {
						configurable: true,
						get: () => ${JSON.stringify(hidden ? "hidden" : "visible")},
					});
					document.dispatchEvent(new Event("visibilitychange"));
				})()`);
			await cover(true);
			try {
				const tab = await h.browser.newPage(`${origin}/authorize?r=8`);
				expect(await newNotification(h)).toBe("sitegloss-fill");
				await panel.eval(`${byId("pair-fill-no")}.click()`);
				const end = Date.now() + 10_000;
				while ((await notifications(h)).length > 0 && Date.now() < end)
					await Bun.sleep(100);
				expect(await notifications(h)).toEqual([]);
				await close(tab);
			} finally {
				await cover(false);
			}
		});

		test("Stop filling in the code: no question any more", async () => {
			await panel.eval(`${byId("pair-fill-off")}.click()`);
			await panel.waitFor(`!${byId("pair-fill-on")}.hidden`, 10_000);
			const tab = await h.browser.newPage(`${origin}/authorize?r=5`);
			await Bun.sleep(1500);
			expect(await panel.eval(`${ASK}.hidden`)).toBe(true);
			await close(tab);
		});

		test("Review of #29, 1: the pairing view open across a relay switch shows the new relay's code (the panel turns pairing off and on again)", async () => {
			// A code, not the placeholder the card shows while there is none.
			const CODE = `/^[A-Z]{4}-[A-Z]{4}$/.test(${byId("pair-code")}.textContent)`;
			/** Another relay in the Relay field, then Turn on AI access once the switch shows. */
			const switchTo = async (url: string) => {
				await setRelay(panel, url);
				await panel.waitFor(
					`document.documentElement.dataset.aiState !== "connected" && !${byId("connect")}.hidden`,
					10_000,
				);
				await panel.eval(`${byId("connect")}.click()`);
				await panel.waitFor(
					`${byId("pair-address")}.textContent.startsWith(${JSON.stringify(url)})`,
					10_000,
				);
			};
			await panel.waitFor(CODE, 10_000);
			const other = startTestRelay();
			try {
				await switchTo(other.url);
				// A code comes only from the connection of now: pairing is on
				// with the new relay, as the panel asked once it connected.
				await panel.waitFor(CODE, 10_000);
			} finally {
				await switchTo(relay.url);
				await other.stop();
			}
		});
	},
);
