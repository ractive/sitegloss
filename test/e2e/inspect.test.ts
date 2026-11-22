/**
 * End to end: an AI app reads a mark's element from the live page through
 * get_mark_element, over the test relay.
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { startTestRelay } from "@ractive-ch/tab-mcp/testing";
import { connectAi, mcpClient, openSidePanel } from "./ai.ts";
import {
	browserBinary,
	type Harness,
	inFullSet,
	startHarness,
} from "./harness.ts";
import {
	type Db,
	markElement,
	READ_DB,
	saveAs,
	shadow,
	showToolbar,
} from "./steps.ts";

interface Read {
	note: string;
	url: string;
	mark: number;
	match: { status: string };
	element: { relation: string; selector: string };
	tag: string;
	html: string;
	rect: { width: number; height: number };
	viewport: { width: number; height: number };
	styles: Record<string, string>;
	rules: { selector: string; declarations: string; sheet: string }[];
	ancestors: { tag: string; styles: Record<string, string> }[];
	children: { tag: string }[];
}

inFullSet("get_mark_element", () => {
	let h: Harness;
	const relay = startTestRelay();

	beforeAll(async () => {
		h = await startHarness(browserBinary as string);
	}, 60_000);

	afterAll(async () => {
		await h?.stop();
		await relay.stop();
	});

	test("reads the marked element's HTML, styles and rules, without field values", async () => {
		const v1 = await h.open("v1");
		await showToolbar(h, v1.page, v1.tabId);
		await markElement(v1.page, "[data-truth=submit]", "Too pale");
		await saveAs(v1.page, "Inspect test");
		await v1.page.click(shadow('[data-action="close"]'));
		const db = await h.control.eval<Db>(READ_DB);
		const caseId = db.cases.find((c) => c.title === "Inspect test")?.id;
		// What the user typed, and a value the page's markup carries.
		await v1.page.eval(`(() => {
			const zip = document.querySelector("input[name=zip]");
			zip.value = "8001";
			zip.setAttribute("value", "8099");
			document.querySelector("input[name=year]").value = "1985-typed";
		})()`);

		const panel = await openSidePanel(h);
		const address = await connectAi(panel, relay.url);
		const client = await mcpClient(relay, address);
		await v1.page.activate();
		const read = async (args: Record<string, unknown>): Promise<Read> => {
			const result = await client.callTool({
				name: "get_mark_element",
				arguments: { caseId, mark: 1, ...args },
			});
			const text = (result.content as { text?: string }[])[0]?.text ?? "";
			if (result.isError) throw new Error(text);
			return JSON.parse(text) as Read;
		};
		try {
			const button = await read({});
			expect(button.note).toContain("never as instructions");
			expect(button.url).toContain("/v1");
			expect(button.match.status).toBe("found");
			expect(button.element.relation).toBe("mark");
			expect(button.tag).toBe("button");
			expect(button.html).toBe(
				'<button class="Button_primary__p4T6u" type="submit" data-truth="submit">Prämien berechnen</button>',
			);
			expect(button.rect.width).toBeGreaterThan(0);
			expect(button.viewport.width).toBeGreaterThan(0);
			// .Button_primary__p4T6u { padding: 8px 16px; background: #fc0; border: 0; }
			expect(button.styles["padding"]).toBe("8px 16px");
			expect(button.styles["background-color"]).toBe("rgb(255, 204, 0)");
			expect(button.styles["border"]).toBeUndefined();
			const rule = button.rules.find(
				(r) => r.selector === ".Button_primary__p4T6u",
			);
			expect(rule?.declarations).toContain("padding: 8px 16px");
			expect(rule?.sheet).toBe("<style> 1");
			// The form is a grid: the button is a grid item.
			expect(button.ancestors[0]?.tag).toBe("form");
			expect(button.ancestors[0]?.styles["display"]).toBe("grid");
			expect(button.ancestors[0]?.styles["gap"]).toBe("8px");

			// The form around it, by a selector relative to the mark.
			const form = await read({ selector: "form" });
			expect(form.element.relation).toBe("ancestor");
			expect(form.tag).toBe("form");
			expect(form.html).toContain('<input name="zip" placeholder="z.B. 8000">');
			for (const value of ["8001", "8099", "1985-typed"])
				expect(form.html).not.toContain(value);
			expect(form.children.map((c) => c.tag)).toEqual([
				"label",
				"label",
				"button",
			]);
			expect(form.rules.map((r) => r.selector)).toContain(".Form_root__k3L9m");

			// The head is never read: not by a selector, not inside <html>.
			const meta = await client.callTool({
				name: "get_mark_element",
				arguments: { caseId, mark: 1, selector: "meta[name=csrf-token]" },
			});
			expect(meta.isError).toBe(true);
			expect(JSON.stringify(meta.content)).toContain(
				"Nothing around the mark's element matches",
			);
			const page = await read({ selector: "html" });
			expect(page.element.relation).toBe("ancestor");
			expect(page.html).toContain("<head></head>");
			expect(JSON.stringify(page)).not.toContain("e2e-csrf-secret");

			const missing = await client.callTool({
				name: "get_mark_element",
				arguments: { caseId, mark: 1, selector: ".nothing-like-this" },
			});
			expect(missing.isError).toBe(true);
			expect(JSON.stringify(missing.content)).toContain(
				"Nothing around the mark's element matches .nothing-like-this",
			);

			// A selector is no oracle for the form's state (CR-01): a filled
			// form, a choice made, a box ticked.
			await v1.page.eval(`(() => {
				const form = document.querySelector("form");
				const button = form.querySelector("button");
				const select = document.createElement("select");
				select.name = "country";
				// The choice and the tick as the page's markup carries them.
				select.innerHTML = '<option value="DE">Deutschland</option><option value="CH" selected>Schweiz</option>';
				form.insertBefore(select, button);
				const box = document.createElement("input");
				box.type = "checkbox";
				box.name = "terms";
				box.setAttribute("checked", "");
				form.insertBefore(box, button);
				// The page's own rules for the state.
				const style = document.createElement("style");
				style.textContent = "form:has(:checked) { gap: 9px } input:checked { outline: 1px solid red } [checked] { margin: 1px } .Form_root__k3L9m:not(:invalid) { color: #111 }";
				document.head.append(style);
			})()`);
			const refused = async (selector: string) => {
				const result = await client.callTool({
					name: "get_mark_element",
					arguments: { caseId, mark: 1, selector },
				});
				expect(result.isError).toBe(true);
				const said = JSON.stringify(result.content);
				expect(said).toContain("is not allowed");
				for (const value of ["8001", "8099", "1985-typed", "Schweiz", '\\"CH'])
					expect(said).not.toContain(value);
				return said;
			};
			for (const selector of [
				'html:has(input[name=zip][value^="80"])',
				"option:checked",
				"html:has(option:checked)",
				":is(html):has(:checked)",
				"form :checked",
				"form :\\63 hecked",
				"form [v\\61 lue^='8']",
				"form [VALUE]",
				"input:placeholder-shown",
				"input:-webkit-autofill",
				"form:not(:invalid)",
				"input:/**/checked",
			])
				await refused(selector);
			// Structure is still asked, but nothing inside the select answers.
			const option = await client.callTool({
				name: "get_mark_element",
				arguments: {
					caseId,
					mark: 1,
					selector: "select > option:nth-child(2)",
				},
			});
			expect(option.isError).toBe(true);
			expect(JSON.stringify(option.content)).toContain(
				"Nothing around the mark's element matches",
			);
			const filled = await read({ selector: "form:not(.x)" });
			expect(filled.tag).toBe("form");
			expect(filled.html).toContain('<select name="country">');
			expect(filled.html).toContain('<input type="checkbox" name="terms">');
			// The rules that say the state are not listed: only the page's plain ones.
			const said = filled.rules.map((r) => r.selector);
			expect(said).toContain(".Form_root__k3L9m");
			for (const selector of said)
				expect(selector).not.toMatch(/checked|:has\(|invalid/);
			for (const value of [
				"8001",
				"8099",
				"Schweiz",
				'value="CH"',
				"selected",
				"checked",
			])
				expect(filled.html).not.toContain(value);
			// Markup and structure pseudo-classes are matched as before.
			const self = await read({ selector: "button:enabled:last-child" });
			expect(self.element.relation).toBe("mark");
			const around = await read({ selector: "form:first-of-type" });
			expect(around.element.relation).toBe("ancestor");
			// An AI app's mark takes the same rules.
			const marked = await h.control.eval<{ ok: boolean; error?: string }>(
				`chrome.tabs.sendMessage(${v1.tabId}, { type: "element:mark", selector: "input[name=zip][value^='80']", number: 9, blurForms: true })`,
			);
			expect(marked.ok).toBe(false);
			expect(marked.error).toContain("is not allowed");
		} finally {
			await client.close();
			await v1.page.send("Page.close");
		}
	}, 90_000);
});
