/** The panel's icons (DEC-078): each is decoration, in the text's colour. */

import { beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const window = new Window();
let icons: typeof import("../src/sidepanel/icons.ts");

beforeAll(async () => {
	icons = await import("../src/sidepanel/icons.ts");
});

describe("icons", () => {
	test("every icon draws an svg hidden from readers, in the text's colour, with its paths", () => {
		const doc = window.document as unknown as Document;
		const names = Object.keys(icons.ICONS) as (keyof typeof icons.ICONS)[];
		expect(names.length).toBeGreaterThan(0);
		for (const name of names) {
			const svg = icons.icon(name, doc);
			expect(svg.tagName.toLowerCase()).toBe("svg");
			expect(svg.getAttribute("aria-hidden")).toBe("true");
			expect(svg.getAttribute("focusable")).toBe("false");
			expect(svg.getAttribute("stroke")).toBe("currentColor");
			expect(svg.getAttribute("fill")).toBe("none");
			expect(svg.querySelectorAll("path").length).toBe(
				icons.ICONS[name].length,
			);
		}
	});

	test("setLabel puts the icon before the words, and changes nothing that says it already", () => {
		const doc = window.document as unknown as Document;
		const button = doc.createElement("button");
		icons.setLabel(button, "copy", "Copy");
		expect(button.textContent).toBe("Copy");
		const first = button.firstElementChild;
		expect(first?.getAttribute("data-icon")).toBe("copy");
		icons.setLabel(button, "copy", "Copy");
		expect(button.firstElementChild === first).toBe(true);
		icons.setLabel(button, "check", "Copied");
		expect(button.textContent).toBe("Copied");
		expect(button.firstElementChild?.getAttribute("data-icon")).toBe("check");
		icons.setLabel(button, undefined, "Done");
		expect(button.childElementCount).toBe(0);
		expect(button.textContent).toBe("Done");
	});

	test("an icon-only Copy shows its icon alone, the check once copied", () => {
		const doc = window.document as unknown as Document;
		const button = doc.createElement("button");
		button.className = "copy icon-only";
		icons.setCopyLabel(button, "Copy");
		expect(button.textContent).toBe("");
		expect(button.firstElementChild?.getAttribute("data-icon")).toBe("copy");
		icons.setCopyLabel(button, "Copied");
		expect(button.childElementCount).toBe(1);
		expect(button.firstElementChild?.getAttribute("data-icon")).toBe("check");
	});
});
