/**
 * End to end: the account and the sync with a team (DEC-039), in the real
 * extension against a real sitegloss.dev server:
 *
 *   SITEGLOSS_SERVER=http://localhost:3200 SITEGLOSS_PASSWORD=… bun test test/e2e/cloud.test.ts
 *
 * Skipped without the variable (CI has no server) and without Chromium.
 * Nothing is stood in for: "Sign in" opens the browser's own sign-in window
 * (`identity.launchWebAuthFlow`), the test types the demo user's e-mail
 * address and password into the server's page there, and the window ends on
 * the extension's address. The tokens are in the worker, the server's
 * address is typed into the panel, and what a teammate does arrives over the
 * events stream the panel listens to.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type Case, withTitle } from "../../src/lib/case.ts";
import {
	addMark,
	change,
	removeCase,
	signIn,
	startCase,
} from "../cloud-helpers.ts";
import { PASSWORD, real, SERVER } from "../cloud-real.ts";
import { browserBinary, type Harness, startHarness } from "./harness.ts";
import { type Db, openCase, panelHome, READ_DB, until } from "./steps.ts";

const id = (name: string) => `document.getElementById(${JSON.stringify(name)})`;
const text = (name: string) => `(${id(name)}?.textContent ?? "")`;
/** The row of the case `title` in the panel's list. */
const row = (title: string) =>
	`[...document.querySelectorAll("[data-case]")].find((b) => b.querySelector(".title")?.textContent === ${JSON.stringify(title)})`;

describe.skipIf(SERVER === undefined || browserBinary === undefined)(
	"the account and the sync with a team, against a real server",
	() => {
		const base = SERVER as string;
		let h: Harness;

		beforeAll(async () => {
			h = await startHarness(browserBinary as string);
		}, 60_000);

		afterAll(async () => {
			await h?.stop();
		});

		test("sign in, the team's cases arrive, a teammate's change shows at once, and what is done here reaches the team", async () => {
			const panel = await panelHome(h);
			// Signed out: what signing in sends where is said before the click.
			await panel.waitFor(`${id("cloud")}?.dataset.cloud === "off"`);
			expect(await panel.eval<string>(text("cloud"))).toContain(
				"Sign in to sync with your team.",
			);
			expect(await panel.eval<string>(text("cloud"))).toContain(
				"your cases go to app.sitegloss.dev and to the members of your team",
			);

			// The service itself: no word about the server, the chooser folded away.
			expect(
				await panel.eval<boolean>(
					`${id("cloud-server-name")} === null && !document.querySelector(".cloud-server").open && ${id("cloud-server-choice")}.value === "production"`,
				),
			).toBe(true);

			// Another server (DEC-041): "Another address…", typed, saved when the
			// field is left.
			await panel.eval(
				`(() => { document.querySelector(".cloud-server").open = true; const choice = ${id("cloud-server-choice")}; choice.value = "other"; choice.dispatchEvent(new Event("change")); const field = ${id("cloud-server")}; field.value = ${JSON.stringify(base)}; field.dispatchEvent(new Event("change")); field.blur(); return true; })()`,
			);
			await panel.waitFor(
				`${id("cloud-server-name")}?.textContent === ${JSON.stringify(`Another server (${new URL(base).host}): not sitegloss.dev`)}`,
			);
			await panel.waitFor(
				`${text("cloud")}.includes(${JSON.stringify(new URL(base).host)})`,
			);

			// The sign-in, as a user does it: "Sign in" opens the browser's own
			// window (`identity.launchWebAuthFlow`) on the server's sign-in page.
			const before = new Set(
				(await h.browser.targets()).map((t) => t.targetId),
			);
			await panel.click(
				`${id("cloud")}.querySelector('[data-action="cloud-sign-in"]')`,
			);
			const opened = (
				await until(
					() => h.browser.targets(),
					(now) =>
						now.some((t) => !before.has(t.targetId) && t.url.startsWith(base)),
					20_000,
				)
			).find((t) => !before.has(t.targetId) && t.url.startsWith(base));
			const asked = new URL(opened?.url as string);
			expect(asked.pathname).toBe("/api/auth/oauth2/authorize");
			// Where the browser's window ends for this extension.
			expect(asked.searchParams.get("redirect_uri")).toBe(
				`https://${h.extensionId}.chromiumapp.org/`,
			);
			expect(asked.searchParams.get("code_challenge_method")).toBe("S256");
			const sign = await h.browser.attachPage(opened?.targetId as string);
			await sign.waitFor(
				`document.querySelector('input[type="email"]')`,
				20_000,
			);
			await sign.click(`document.querySelector('input[type="email"]')`);
			await sign.type("tess@example.com");
			await sign.click(`document.querySelector('input[type="password"]')`);
			await sign.type(PASSWORD);
			await sign.click(`document.querySelector('button[type="submit"]')`);
			// The first time, the server asks whether Sitegloss may; then the
			// window ends on the extension's address and closes by itself.
			await until(
				async () => {
					const allow = `[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Allow")`;
					// The window closes by itself once it is done: a command sent to
					// it then is never answered, so none is waited for long.
					const asks = await Promise.race([
						sign
							.eval<boolean>(
								`location.pathname.startsWith("/consent") && !!${allow}`,
							)
							.catch(() => false),
						Bun.sleep(2000).then(() => false),
					]);
					if (asks)
						await Promise.race([
							sign.click(allow).catch(() => undefined),
							Bun.sleep(2000),
						]);
					return (await h.browser.targets()).some(
						(t) => t.targetId === opened?.targetId,
					);
				},
				(open) => !open,
				30_000,
			);
			await panel.waitFor(
				`${text("cloud-who")}.includes("Tess Tester")`,
				20_000,
			);
			expect(await panel.eval<string>(text("cloud-team-name"))).toBe(
				"Team: Pedal & Pine web",
			);
			await panel.waitFor(
				// The state in words since DEC-045: up to date while it listens.
				`${text("cloud-status")}.startsWith("Up to date")`,
				30_000,
			);
			// Signed in at a server that is not the service: said beside the account.
			expect(await panel.eval<string>(text("cloud-server-name"))).toBe(
				`Another server (${new URL(base).host}): not sitegloss.dev`,
			);
			expect(
				await panel.eval<boolean>(`${id("cloud-server-choice")} === null`),
			).toBe(true);

			// The team's demo case is here, with its marks and pictures.
			const demo = "Home and booking: what is off before the launch";
			await panel.waitFor(row(demo), 20_000);
			const db = await panel.eval<Db>(READ_DB);
			const stored = db.cases.find((c) => c.title === demo) as unknown as Case;
			expect(stored.marks.length).toBeGreaterThanOrEqual(5);
			expect(stored.pages?.length).toBe(2);
			expect(stored.importedAt).toBeUndefined();
			const keys = db.images.map((image) => image.key);
			for (const a of stored.marks)
				expect(keys).toContain(`${stored.id}/${a.crop}`);
			await openCase(panel, demo);
			expect(
				await panel.eval<string>(
					`${id("case-team")}.firstElementChild.textContent`,
				),
			).toBe("Synced with “Pedal & Pine web”");
			expect(await panel.eval<boolean>(`${id("share-case")}.hidden`)).toBe(
				true,
			);
			// Two pages, each with its marks; who settled a mark.
			expect(
				await panel.eval<number>(
					`${id("case-pages")}.querySelectorAll("li").length`,
				),
			).toBe(2);
			expect(await panel.eval<string>(text("case-view"))).toContain(
				"Dana Developer",
			);
			// Deleting it would delete it for the team: the button says so.
			await panel.click(id("delete-case"));
			expect(await panel.eval<string>(text("delete-case"))).toBe(
				"Really delete for the team?",
			);
			await panel.click(id("back"));
			await panel.waitFor(`!${id("home")}.hidden`);

			// A teammate, on a device of her own, makes a case: it shows here
			// within a moment, with nothing reloaded (the events stream).
			const dana = await real(base, "dana", "dana@example.com");
			await signIn(dana.device);
			const caseId = `c_e2e${Date.now().toString(36)}`;
			const title = `Seen live ${caseId}`;
			await startCase(dana.device, caseId);
			await change(dana.device, caseId, (c, now) => withTitle(c, title, now));
			await addMark(dana.device, caseId, "Dana's mark", { element: true });
			const sent = Date.now();
			await dana.device.engine.request();
			await panel.waitFor(row(title), 10_000);
			const took = Date.now() - sent;
			console.log(
				`a teammate's case showed in the open panel after ${took} ms`,
			);
			expect(took).toBeLessThan(10_000);

			// And a change to it.
			await change(dana.device, caseId, (c, now) =>
				withTitle(c, `${title}, renamed`, now),
			);
			await dana.device.engine.request();
			await panel.waitFor(row(`${title}, renamed`), 10_000);

			// What is done here reaches the team: renamed in the panel.
			await openCase(panel, `${title}, renamed`);
			await panel.click(id("rename-case"));
			await panel.eval(
				`(() => { const f = ${id("rename-field")}; f.value = ${JSON.stringify(`${title}, by Tess`)}; f.dispatchEvent(new Event("input")); })()`,
			);
			await panel.click(id("rename-save"));
			await until(
				async () => {
					await dana.device.engine.request();
					return (await dana.device.store.getCase(caseId))?.title;
				},
				(now) => now === `${title}, by Tess`,
				15_000,
			);
			await panel.click(id("back"));
			await panel.waitFor(`!${id("home")}.hidden`);

			// Deleted for the team by the teammate: it goes here.
			await removeCase(dana.device, caseId);
			await dana.device.engine.request();
			await panel.waitFor(`!(${row(`${title}, by Tess`)})`, 10_000);
			await dana.session.end(base);

			// Signing out stops the sync and keeps the cases.
			await panel.click(
				`${id("cloud")}.querySelector('[data-action="cloud-sign-out"]')`,
			);
			await panel.waitFor(`${id("cloud")}?.dataset.cloud === "off"`, 10_000);
			expect(await panel.eval<boolean>(`!!(${row(demo)})`)).toBe(true);
			const after = await panel.eval<Db>(READ_DB);
			expect(after.cases.some((c) => c.title === demo)).toBe(true);
		}, 180_000);
	},
);
