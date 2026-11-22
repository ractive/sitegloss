/**
 * End to end: a case's thread, closing it, and the person beside the app
 * (DEC-046), in the real side panel against a real sitegloss.dev server:
 *
 *   SITEGLOSS_SERVER=http://localhost:3200 SITEGLOSS_PASSWORD=… bun test test/e2e/thread.test.ts
 *
 * With `SITEGLOSS_SHOTS` naming a folder, pictures of the panel go there.
 * Skipped without a server (CI has none) and without Chromium. Tess signs in
 * in the panel as a user does; Dana is a second device of this build.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { type Case, withCaseComment, withTitle } from "../../src/lib/case.ts";
import {
	addMark,
	change,
	removeCase,
	signIn,
	startCase,
} from "../cloud-helpers.ts";
import { real, SERVER } from "../cloud-real.ts";
import type { Page } from "./browser.ts";
import { signInPanel } from "./cloud-steps.ts";
import { browserBinary, type Harness, startHarness } from "./harness.ts";
import { type Db, openCase, panelHome, READ_DB, until } from "./steps.ts";

const id = (name: string) => `document.getElementById(${JSON.stringify(name)})`;
const text = (name: string) => `(${id(name)}?.textContent ?? "")`;
const SHOTS = process.env["SITEGLOSS_SHOTS"];

/** A picture of the panel, with `expression`'s element scrolled into view. */
async function shot(
	panel: Page,
	name: string,
	expression?: string,
): Promise<void> {
	if (SHOTS === undefined) return;
	// As wide as a side panel, then back.
	await panel.send("Emulation.setDeviceMetricsOverride", {
		width: 400,
		height: 820,
		deviceScaleFactor: 2,
		mobile: false,
	});
	try {
		if (expression)
			await panel.eval(`${expression}?.scrollIntoView({ block: "start" })`);
		await new Promise((r) => setTimeout(r, 300));
		const { data } = (await panel.send("Page.captureScreenshot", {
			format: "png",
		})) as { data: string };
		await Bun.write(join(SHOTS, name), Buffer.from(data, "base64"));
	} finally {
		await panel.send("Emulation.clearDeviceMetricsOverride");
	}
}

describe.skipIf(SERVER === undefined || browserBinary === undefined)(
	"the thread and closing in the side panel, against a real server",
	() => {
		const base = SERVER as string;
		let h: Harness;

		beforeAll(async () => {
			h = await startHarness(browserBinary as string);
		}, 60_000);

		afterAll(async () => {
			await h?.stop();
		});

		test("comment by hand and through an app, edit and delete one's own, close, filed under Closed, a new mark opens it again", async () => {
			const panel = await panelHome(h);
			await signInPanel(h.browser, panel, base);
			const CLAUDE = {
				id: "https://claude.ai/oauth",
				name: "Claude",
				host: "claude.ai",
			};

			// Dana's case, with two marks: it arrives in the panel.
			const dana = await real(base, "dana", "dana@example.com");
			await signIn(dana.device);
			const caseId = `c_e2t${Date.now().toString(36)}`;
			const title = `Thread ${caseId}`;
			await startCase(dana.device, caseId);
			await change(dana.device, caseId, (c, now) => withTitle(c, title, now));
			await addMark(dana.device, caseId, "Total is cut off", {
				element: true,
			});
			await addMark(dana.device, caseId, "Pay button too pale", {
				element: true,
			});
			await dana.device.engine.request();
			const row = `[...document.querySelectorAll("[data-case]")].find((b) => b.textContent.includes(${JSON.stringify(title)}))`;
			await panel.waitFor(row, 15_000);
			await openCase(panel, title);
			await panel.waitFor(`${text("thread-heading")} === "Comments 0"`);

			// Tess comments on mark 1, by hand.
			const db = await panel.eval<Db>(READ_DB);
			const here = db.cases.find((c) => c.id === caseId) as unknown as Case;
			const first = here.marks.find((a) => a.number === 1)?.id as string;
			await panel.eval(
				`(() => { const f = ${id("comment-new")}; f.value = "Seen on the phone too."; f.dispatchEvent(new Event("input")); const m = ${id("comment-mark")}; m.value = ${JSON.stringify(first)}; m.dispatchEvent(new Event("change")); return true; })()`,
			);
			await panel.click(
				`document.querySelector('[data-action="comment-add"]')`,
			);
			await panel.waitFor(`${text("thread-heading")} === "Comments 1"`);
			// It reaches the team, with who wrote it, about mark 1.
			const arrived = await until(
				async () => {
					await dana.device.engine.request();
					return (await dana.device.store.getCase(caseId)) as Case;
				},
				(c) => (c.comments?.length ?? 0) === 1,
				15_000,
			);
			const k = arrived.comments?.[0];
			expect(k?.text).toBe("Seen on the phone too.");
			expect(k?.user?.name).toBe("Tess Tester");
			expect(k?.app).toBeUndefined();
			expect(arrived.marks.find((a) => a.id === k?.mark)?.number).toBe(1);

			// Dana's comment, written through Claude: "Dana Developer via Claude".
			await change(dana.device, caseId, (c, now) =>
				withCaseComment(
					c,
					{ id: `k_${caseId}_d`, text: "Fixed in PR 12.", app: CLAUDE },
					now,
				),
			);
			await dana.device.engine.request();
			await panel.waitFor(
				`${text("case-thread")}.includes("Dana Developer via Claude")`,
				15_000,
			);
			// Hers has no Edit or Delete here; Tess's has.
			expect(
				await panel.eval<boolean>(
					`!document.querySelector('[data-comment="k_${caseId}_d"] [data-action="comment-delete"]') && !!document.querySelector('[data-comment]:not([data-comment="k_${caseId}_d"]) [data-action="comment-delete"]')`,
				),
			).toBe(true);
			// The mark says it has a comment.
			expect(
				await panel.eval<string>(
					`document.querySelector(".comments-count")?.textContent ?? ""`,
				),
			).toBe("1 comment");
			await shot(panel, "01-thread.png", id("case-thread"));

			// Tess edits hers, then deletes it (Delete asks twice).
			const mine = `document.querySelector('[data-comment]:not([data-comment="k_${caseId}_d"])')`;
			await panel.click(
				`${mine}.querySelector('[data-action="comment-edit"]')`,
			);
			await panel.eval(
				`(() => { const f = document.querySelector(".comment-edit"); f.value = "Seen on the phone too, in Safari."; f.dispatchEvent(new Event("input")); return true; })()`,
			);
			await panel.click(
				`document.querySelector('[data-action="comment-save"]')`,
			);
			await until(
				async () => {
					await dana.device.engine.request();
					return (await dana.device.store.getCase(caseId)) as Case;
				},
				(c) =>
					c.comments?.some(
						(x) => x.text === "Seen on the phone too, in Safari." && x.edited,
					) === true,
				15_000,
			);
			await panel.waitFor(`${text("case-thread")}.includes("edited")`);
			await panel.click(
				`${mine}.querySelector('[data-action="comment-delete"]')`,
			);
			await new Promise((r) => setTimeout(r, 700));
			await panel.click(
				`${mine}.querySelector('[data-action="comment-delete"]')`,
			);
			await panel.waitFor(`${text("thread-heading")} === "Comments 1"`);
			await until(
				async () => {
					await dana.device.engine.request();
					return (await dana.device.store.getCase(caseId)) as Case;
				},
				(c) => c.comments?.map((x) => x.id).join() === `k_${caseId}_d`,
				15_000,
			);

			// Close case: who closed it shows; the team has it closed.
			await panel.click(id("close-case"));
			await panel.waitFor(`${text("close-case")} === "Reopen case"`);
			await panel.waitFor(
				`!${id("case-closed")}.hidden && ${text("case-closed")}.startsWith("Closed ")`,
			);
			const closed = await until(
				async () => {
					await dana.device.engine.request();
					return (await dana.device.store.getCase(caseId)) as Case;
				},
				(c) => c.closed !== undefined,
				15_000,
			);
			expect(closed.closed?.user?.name).toBe("Tess Tester");
			await panel.waitFor(
				`${text("case-closed")}.includes("by Tess Tester")`,
				15_000,
			);
			await shot(panel, "02-closed-case.png", id("case-view"));

			// Home: filed under Closed, folded.
			await panel.click(id("back"));
			await panel.waitFor(`!${id("home")}.hidden`);
			await panel.waitFor(
				`!!${id("closed-cases")} && !${id("closed-cases")}.open && !!${id("closed-cases")}.querySelector('[data-case]') && [...${id("closed-cases")}.querySelectorAll("[data-case]")].some((b) => b.textContent.includes(${JSON.stringify(title)}))`,
			);
			await shot(panel, "03-home-closed-folded.png", id("closed-cases"));
			await panel.eval(`${id("closed-cases")}.open = true`);
			await shot(panel, "04-home-closed-open.png", id("closed-cases"));

			// Dana adds an open mark: the case is open again, here too.
			await addMark(dana.device, caseId, "One more", { element: true });
			await dana.device.engine.request();
			await panel.waitFor(
				`![...${id("closed-cases")}?.querySelectorAll("[data-case]") ?? []].some((b) => b.textContent.includes(${JSON.stringify(title)}))`,
				15_000,
			);

			await removeCase(dana.device, caseId);
			await dana.device.engine.request();
			await dana.session.end(base);
			await panel.click(
				`${id("cloud")}.querySelector('[data-action="cloud-sign-out"]')`,
			);
			await panel.waitFor(`${id("cloud")}?.dataset.cloud === "off"`, 10_000);
		}, 180_000);
	},
);
