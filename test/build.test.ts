import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	build,
	checkOutdir,
	createFirefoxManifest,
	createManifest,
	extensionId,
	FIREFOX_ID,
	mitText,
	NOTICES_FILE,
	notices,
	readKey,
	zipBuild,
	zipName,
} from "../scripts/build.ts";
import { readZip } from "../src/lib/zip.ts";

const dirs: string[] = [];
const tempDir = () => {
	const dir = mkdtempSync(join(tmpdir(), "sitegloss-build-"));
	dirs.push(dir);
	return dir;
};

afterAll(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * A classic script with everything inside one function: module syntax does not
 * parse, and injecting it twice into a page declares nothing twice.
 */
function isWrappedScript(code: string): boolean {
	try {
		new Function(code); // only parses it
	} catch {
		return false;
	}
	return /^\(\(\)=>\{[\s\S]*\}\)\(\);\s*(\/\/#.*\s*)*$/.test(code);
}

describe("extension ID", () => {
	test("the committed key gives the documented ID", async () => {
		expect(extensionId(await readKey())).toBe(
			"ldmcfigcnobhnbaigehcaodheklibeon",
		);
	});
});

describe("manifest", () => {
	test("development: key, activeTab, alarms, notifications and offscreen, optional downloads and <all_urls> only", () => {
		const m = createManifest("1.2.3", { key: "abc" });
		expect(m["manifest_version"]).toBe(3);
		expect(m["version"]).toBe("1.2.3");
		expect(m["key"]).toBe("abc");
		expect(m["permissions"]).toEqual([
			"activeTab",
			"alarms",
			// The browser's sign-in window, for sitegloss.dev (DEC-039).
			"identity",
			"notifications",
			"offscreen",
			"scripting",
			"sidePanel",
			"storage",
			"unlimitedStorage",
		]);
		expect(m["optional_permissions"]).toEqual(["downloads"]);
		expect(m["optional_host_permissions"]).toEqual(["<all_urls>"]);
		expect(m["host_permissions"]).toBeUndefined();
		// Chrome 130: the first that honours `use_dynamic_url` (DEC-064). A
		// WebSocket that carries messages keeps the service worker alive from
		// 116 (DEC-015).
		expect(m["minimum_chrome_version"]).toBe("130");
		// One page reachable from web pages, the comment field's, and only
		// at this session's address (DEC-064).
		expect(m["web_accessible_resources"]).toEqual([
			{
				resources: ["field/*"],
				matches: ["<all_urls>"],
				use_dynamic_url: true,
			},
		]);
	});

	test("test builds get host access, and downloads without asking", () => {
		const m = createManifest("1.0.0", { test: true });
		expect(m["host_permissions"]).toEqual(["<all_urls>"]);
		expect(m["permissions"]).toContain("downloads");
		expect(m["optional_permissions"]).toBeUndefined();
	});
});

describe("Firefox manifest", () => {
	test("an event page, a sidebar, no offscreen document or side panel, the add-on id and Firefox 153", () => {
		const m = createFirefoxManifest("1.2.3", {});
		expect(m["manifest_version"]).toBe(3);
		expect(m["version"]).toBe("1.2.3");
		expect(m["browser_specific_settings"]).toEqual({
			gecko: {
				id: FIREFOX_ID,
				strict_min_version: "153.0",
				// Nothing goes anywhere until the user turns AI access on, and
				// asks for it then.
				data_collection_permissions: {
					required: ["none"],
					optional: ["websiteContent", "browsingActivity"],
				},
			},
		});
		expect(FIREFOX_ID).toBe("sitegloss@ractive.ch");
		expect(m["background"]).toEqual({
			scripts: ["background.js"],
			type: "module",
		});
		expect(m["sidebar_action"]).toMatchObject({
			default_panel: "sidepanel/index.html",
			open_at_install: false,
		});
		expect(m["permissions"]).toEqual([
			"activeTab",
			"alarms",
			"identity",
			"notifications",
			"scripting",
			"storage",
			"unlimitedStorage",
		]);
		expect(m["optional_permissions"]).toEqual(["downloads"]);
		expect(m["optional_host_permissions"]).toEqual(["<all_urls>"]);
		expect(m["host_permissions"]).toBeUndefined();
		// Chrome's CSP: Firefox's own would turn ws://127.0.0.1 into wss:.
		expect(m["content_security_policy"]).toEqual({
			extension_pages: "script-src 'self'; object-src 'self'",
		});
		for (const key of [
			"key",
			"minimum_chrome_version",
			"side_panel",
			"offscreen",
		])
			expect(m[key]).toBeUndefined();
		expect(JSON.stringify(m)).not.toContain("gecko_android");
		// The comment field's page, with no key Firefox does not know: each
		// install has an address of its own there (DEC-064).
		expect(m["web_accessible_resources"]).toEqual([
			{ resources: ["field/*"], matches: ["<all_urls>"] },
		]);
		// The same commands as Chrome's: the icon's click, Alt+Shift+O.
		expect(m["commands"]).toEqual(createManifest("1.2.3", {})["commands"]);
	});

	test("the test build has host access, downloads and the data collection at install", () => {
		const m = createFirefoxManifest("1.0.0", { test: true });
		expect(m["host_permissions"]).toEqual(["<all_urls>"]);
		expect(m["permissions"]).toContain("downloads");
		expect(m["optional_permissions"]).toBeUndefined();
		expect(
			(m["browser_specific_settings"] as { gecko: Record<string, unknown> })
				.gecko["data_collection_permissions"],
		).toEqual({ required: ["websiteContent", "browsingActivity"] });
	});

	test("the zips' names: the release takes sitegloss-*.zip, the Chrome store sitegloss-<version>-store.zip", () => {
		expect(zipName("1.2.3")).toBe("sitegloss-1.2.3.zip");
		expect(zipName("1.2.3", { store: true })).toBe("sitegloss-1.2.3-store.zip");
		expect(zipName("1.2.3", { store: true, firefox: true })).toBe(
			"sitegloss-firefox-1.2.3-store.zip",
		);
	});
});

describe("build", () => {
	test("writes the bundles, the side panel, the icons and the manifest", async () => {
		const outdir = tempDir();
		const result = await build({ outdir });
		expect(result.id).toBe("ldmcfigcnobhnbaigehcaodheklibeon");
		for (const file of [
			"background.js",
			"content.js",
			"pairing.js",
			"sidepanel/index.html",
			"offscreen/index.html",
			"viewer/index.html",
			"icons/icon-16.png",
			"icons/icon-128.png",
		]) {
			expect(await Bun.file(join(outdir, file)).exists()).toBe(true);
		}
		const html = await Bun.file(join(outdir, "sidepanel/index.html")).text();
		expect(html).not.toContain("main.ts");
		const manifest = await Bun.file(join(outdir, "manifest.json")).json();
		expect(manifest.key).toBe(await readKey());
		const content = await Bun.file(join(outdir, "content.js")).text();
		expect(isWrappedScript(content)).toBe(true);
		// The relay pairing page's script (DEC-044): the library's, small.
		const pairing = await Bun.file(join(outdir, "pairing.js")).text();
		expect(isWrappedScript(pairing)).toBe(true);
		expect(Bun.gzipSync(pairing).length).toBeLessThan(1200);
	});

	test("no bundle loads code later: no dynamic import(), one script per page", async () => {
		const outdir = tempDir();
		await build({ outdir });
		// A service worker refuses import(); the content script is a plain
		// script. Both are bundled whole, the client's lazy chunks included.
		for (const file of ["background.js", "content.js", "pairing.js"])
			expect(await Bun.file(join(outdir, file)).text()).not.toMatch(
				/\bimport\s*\(/,
			);
		// The pages are split, which names every chunk chunk-<hash>.js: a
		// lazy one (the client's WebMCP mirror since 0.16.1, say, for
		// `webmcp: true`, which Sitegloss leaves off) would be one more script.
		// Each page's files, exactly: the html, one chunk with its map, and
		// the side panel's stylesheet.
		const pages = {
			sidepanel: ["chunk-#.css", "chunk-#.js", "chunk-#.js.map", "index.html"],
			offscreen: ["chunk-#.js", "chunk-#.js.map", "index.html"],
		};
		for (const [page, expected] of Object.entries(pages)) {
			const files = [
				...new Bun.Glob(`${page}/**/*`).scanSync({ cwd: outdir }),
			].sort();
			// Sorted after the hashes are taken out: the order of the names
			// with them depends on what the hashes happen to be.
			expect(
				files
					.map((f) => f.slice(page.length + 1).replace(/-[a-z0-9]+\./, "-#."))
					.sort(),
			).toEqual(expected);
			for (const file of files.filter((f) => f.endsWith(".js")))
				expect(await Bun.file(join(outdir, file)).text()).not.toMatch(
					/\bimport\s*\(/,
				);
		}
	});

	test("the content script's check tells a module from a wrapped script", async () => {
		for (const code of [
			"export{a as b};",
			'import{x}from"./y.js";',
			'import"./y.js";',
			"(()=>{export{a as b};})();",
			"(()=>{console.log(import.meta.url)})();",
		])
			expect(isWrappedScript(code)).toBe(false);
		// The real entry as a module: it exports nothing, so only the wrapper differs.
		const esm = await Bun.build({
			entrypoints: [join(import.meta.dir, "../src/content/index.ts")],
			target: "browser",
			format: "esm",
			minify: true,
		});
		expect(isWrappedScript(await (esm.outputs[0] as Blob).text())).toBe(false);
	});

	test("a store build has no key, and its zip holds no source maps", async () => {
		const outdir = tempDir();
		const result = await build({ outdir, store: true });
		expect(result.id).toBeUndefined();
		expect(result.manifest["key"]).toBeUndefined();
		const target = join(tempDir(), "x.zip");
		await zipBuild(outdir, target);
		const files = await readZip(
			new Uint8Array(await Bun.file(target).arrayBuffer()),
		);
		expect(files.has("manifest.json")).toBe(true);
		expect(files.has("content.js")).toBe(true);
		expect([...files.keys()].some((n) => n.endsWith(".map"))).toBe(false);
	});

	test("a zip does not depend on when it is made", async () => {
		const dir = tempDir();
		await Bun.write(join(dir, "manifest.json"), "{}\n");
		const target = join(tempDir(), "x.zip");
		await zipBuild(dir, target);
		const bytes = new DataView(
			(await Bun.file(target).arrayBuffer()) as ArrayBuffer,
		);
		// The first entry's DOS time and date: midnight, 1 January 1980.
		expect(bytes.getUint16(10, true)).toBe(0);
		expect(bytes.getUint16(12, true)).toBe(33);
	});

	test("every build and its zip carry the licences of what they bundle", async () => {
		for (const options of [{}, { store: true }, { test: true }]) {
			const outdir = tempDir();
			await build({ outdir, ...options });
			const target = join(tempDir(), "x.zip");
			await zipBuild(outdir, target);
			const files = await readZip(
				new Uint8Array(await Bun.file(target).arrayBuffer()),
			);
			const text = new TextDecoder().decode(files.get(NOTICES_FILE));
			expect(text).toBe(await Bun.file(join(outdir, NOTICES_FILE)).text());
			expect(text).toContain("Copyright (c) 2026 Jean-Pierre Bergamin");
			expect(text).toContain("AI-GENERATED CODE NOTICE");
			expect(text).toContain("@ractive-ch/tab-mcp-client\n\nMIT License");
			expect(text).toContain("@cfworker/json-schema\n\nMIT License");
			expect(text).toContain("Copyright (c) 2020 Jeremy Danyow");
			// The public suffix list, for the sites (DEC-067).
			expect(text).toContain(
				"tldts\n\nCopyright (c) 2017 Thomas Parisot, 2018 Rémi Berson",
			);
			expect(text).not.toContain("CDN build");
		}
	});

	test("the fonts: one copy at the root for the extension's own pages, none for a web page, their licences in every build", async () => {
		for (const options of [
			{},
			{ store: true },
			{ test: true },
			{ firefox: true },
			{ firefox: true, store: true },
		]) {
			const outdir = tempDir();
			await build({ outdir, ...options });
			const names = [...new Bun.Glob("**/*").scanSync({ cwd: outdir })];
			expect(names.filter((n) => n.endsWith(".woff2")).sort()).toEqual([
				"fonts/inter-latin-wght-normal.woff2",
				"fonts/manrope-latin-wght-normal.woff2",
			]);
			// Copied as they are: the files the source holds.
			for (const file of [
				"inter-latin-wght-normal.woff2",
				"manrope-latin-wght-normal.woff2",
			])
				expect(
					Bun.hash(await Bun.file(join(outdir, "fonts", file)).arrayBuffer()),
				).toBe(
					Bun.hash(
						await Bun.file(
							join(import.meta.dir, "..", "src/fonts", file),
						).arrayBuffer(),
					),
				);
			const css = async (dir: string) =>
				(
					await Promise.all(
						names
							.filter((n) => n.startsWith(`${dir}/`) && n.endsWith(".css"))
							.map((n) => Bun.file(join(outdir, n)).text()),
					)
				).join("");
			for (const page of ["sidepanel", "viewer"])
				expect(await css(page)).toMatch(
					/url\("?\/fonts\/inter-latin-wght-normal\.woff2"?\)/,
				);
			// The comment field sits in a page's dialog, in the page's face.
			expect(await css("field")).not.toContain("woff2");
			const content = await Bun.file(join(outdir, "content.js")).text();
			expect(content).not.toContain("woff2");
			const licences = await Bun.file(join(outdir, NOTICES_FILE)).text();
			expect(licences).toContain("Copyright 2016 The Inter Project Authors");
			expect(licences).toContain("Copyright 2019 The Manrope Project Authors");
			expect(licences).toContain("SIL Open Font License, Version 1.1");
		}
	});

	test("only the development build's panel offers the development server (DEC-041)", async () => {
		const panelText = async (options: Parameters<typeof build>[0]) => {
			const outdir = mkdtempSync(join(tmpdir(), "sitegloss-devserver-"));
			try {
				await build({ outdir, ...options });
				let text = "";
				for await (const file of new Bun.Glob("sidepanel/**/*.js").scan(outdir))
					text += await Bun.file(join(outdir, file)).text();
				return text;
			} finally {
				rmSync(outdir, { recursive: true, force: true });
			}
		};
		// The chooser reads one constant, the build's define; the label stays in
		// the code of every build (a stored development server is named).
		const dev = await panelText({ minify: false });
		const store = await panelText({ minify: false, store: true });
		const zipped = await panelText({ minify: false, forPeople: true });
		expect(dev).toContain("DEV_SERVER_OFFERED = true");
		expect(store).toContain("DEV_SERVER_OFFERED = false");
		expect(zipped).toContain("DEV_SERVER_OFFERED = false");
	});

	test("a package has no test switch left for a page to answer", async () => {
		// Nor can one be built as a test build.
		await expect(
			build({ outdir: tempDir(), store: true, test: true }),
		).rejects.toThrow("a store package is never a test build");
		const outdir = mkdtempSync(join(tmpdir(), "sitegloss-flag-"));
		try {
			await build({ outdir, store: true });
			const content = await Bun.file(join(outdir, "content.js")).text();
			// The store package runs minified bundles.
			expect(content.startsWith("(()=>{")).toBe(true);
			expect(content).not.toContain("SITEGLOSS_TEST_BUILD");
			expect(content).toContain('"closed"');
			// Nor the worker's way to pause a folder that cannot be (DEC-025).
			const worker = await Bun.file(join(outdir, "background.js")).text();
			expect(worker).not.toContain("SITEGLOSS_TEST_BUILD");
			expect(worker).not.toContain("test:access");
			// Nor the worker's record of what went wrong, for the tests.
			expect(worker).not.toContain("siteglossTestLog");
			// Nor the waits a test may shorten for itself (DEC-053).
			expect(worker).not.toContain("siteglossTestWaits");
			// Nor the side panel's way to take a folder without the picker (DEC-021).
			const panel = new Bun.Glob("sidepanel/**/*.js");
			let scripts = 0;
			for await (const file of panel.scan(outdir)) {
				scripts++;
				const text = await Bun.file(join(outdir, file)).text();
				expect(text).not.toContain("siteglossUseFolder");
				expect(text).not.toContain("siteglossTestWaits");
				expect(text).not.toContain("SITEGLOSS_TEST_BUILD");
			}
			expect(scripts).toBeGreaterThan(0);
		} finally {
			rmSync(outdir, { recursive: true, force: true });
		}
	});

	test("Firefox: the bundles and the sidebar, no offscreen document, no key", async () => {
		const outdir = tempDir();
		const result = await build({ outdir, firefox: true });
		expect(result.id).toBeUndefined();
		expect(result.manifest["browser_specific_settings"]).toBeDefined();
		const manifest = await Bun.file(join(outdir, "manifest.json")).json();
		expect(manifest.key).toBeUndefined();
		for (const file of [
			"background.js",
			"content.js",
			"pairing.js",
			"sidepanel/index.html",
			"viewer/index.html",
			"icons/icon-128.png",
			NOTICES_FILE,
		])
			expect(await Bun.file(join(outdir, file)).exists()).toBe(true);
		expect(await Bun.file(join(outdir, "offscreen/index.html")).exists()).toBe(
			false,
		);
		// The build decides: the define is gone, its value in.
		const worker = await Bun.file(join(outdir, "background.js")).text();
		expect(worker).toContain("sidebarAction");
		expect(worker).not.toContain("SITEGLOSS_FIREFOX");
		const content = await Bun.file(join(outdir, "content.js")).text();
		expect(isWrappedScript(content)).toBe(true);
		expect(content).toContain("sidebar");
	});

	test("Firefox's store package: not minified, no source maps, no test hooks", async () => {
		const outdir = tempDir();
		await build({ outdir, firefox: true, store: true });
		const names = [...new Bun.Glob("**/*").scanSync({ cwd: outdir })].sort();
		expect(names.some((n) => n.endsWith(".map"))).toBe(false);
		const worker = await Bun.file(join(outdir, "background.js")).text();
		// Readable: one statement a line, names kept.
		expect(worker.split("\n").length).toBeGreaterThan(1000);
		expect(worker).toContain("function isPanelSender(");
		expect(worker).not.toContain("test:access");
		expect(worker).not.toContain("SITEGLOSS_");
		for (const file of names.filter((n) => n.endsWith(".js"))) {
			const text = await Bun.file(join(outdir, file)).text();
			expect(text).not.toContain("siteglossUseFolder");
			expect(text).not.toContain("siteglossTestWaits");
			// The panel's page in a tab is no panel there (`window.ts`).
			if (file.startsWith("sidepanel/"))
				expect(text).not.toContain("location.search");
		}
		const target = join(tempDir(), "x.zip");
		await zipBuild(outdir, target);
		const files = await readZip(
			new Uint8Array(await Bun.file(target).arrayBuffer()),
		);
		expect(files.has("manifest.json")).toBe(true);
		expect(files.has("offscreen/index.html")).toBe(false);
	});

	test("Firefox's test build lets the panel's page in a tab be the panel", async () => {
		const outdir = tempDir();
		await build({ outdir, firefox: true, test: true });
		const panel = [...new Bun.Glob("sidepanel/*.js").scanSync({ cwd: outdir })];
		const texts = await Promise.all(
			panel.map((f) => Bun.file(join(outdir, f)).text()),
		);
		expect(texts.some((t) => t.includes("location.search"))).toBe(true);
	});

	test("a licence that is not the expected MIT text stops the build", () => {
		expect(mitText("x", "Copyright\n\nMIT License\n\nText")).toBe(
			"MIT License\n\nText",
		);
		const bare =
			'Copyright (c) 2017 A\n\nPermission is hereby granted, free of charge, to any person\n\nTHE SOFTWARE IS PROVIDED "AS IS"';
		expect(mitText("x", bare)).toBe(bare);
		expect(() => mitText("x", "Apache License 2.0")).toThrow(
			"no MIT licence text for x",
		);
	});

	test("a bundled package without a known licence stops the build", async () => {
		await expect(notices(["left-pad"])).rejects.toThrow(
			"no licence known for the bundled package left-pad",
		);
	});
});

describe("checkOutdir", () => {
	const root = join(import.meta.dir, "..");

	test("refuses the repository and its parents", async () => {
		await expect(checkOutdir(root)).rejects.toThrow("holds the repository");
		await expect(checkOutdir(dirname(root))).rejects.toThrow(
			"holds the repository",
		);
		await expect(checkOutdir(`${root}/.`)).rejects.toThrow(
			"holds the repository",
		);
	});

	test("refuses a folder with other files", async () => {
		const dir = tempDir();
		writeFileSync(join(dir, "notes.txt"), "keep me");
		await expect(checkOutdir(dir)).rejects.toThrow("not a build");
		await expect(build({ outdir: dir })).rejects.toThrow("not a build");
		expect(await Bun.file(join(dir, "notes.txt")).text()).toBe("keep me");
	});

	test("refuses a file in place of the folder, and keeps it", async () => {
		const dir = tempDir();
		const file = join(dir, "manifest-key.txt");
		writeFileSync(file, "keep me");
		await expect(checkOutdir(file)).rejects.toThrow("it is a file");
		await expect(build({ outdir: file })).rejects.toThrow("it is a file");
		expect(await Bun.file(file).text()).toBe("keep me");
	});

	test("accepts a missing or empty folder and an earlier build", async () => {
		const dir = tempDir();
		await checkOutdir(dir);
		await checkOutdir(join(dir, "missing"));
		mkdirSync(join(dir, "old"));
		writeFileSync(join(dir, "old", "manifest.json"), "{}");
		writeFileSync(join(dir, "old", "content.js"), "");
		await checkOutdir(join(dir, "old"));
	});
});

describe("the sitegloss.dev API's types (DEC-039)", () => {
	test("api.gen.ts is what the committed OpenAPI document gives", async () => {
		const { SPEC, TYPES, typesOf } = await import("../scripts/api-types.ts");
		expect(await Bun.file(TYPES).text()).toBe(await typesOf(SPEC));
	}, 60_000);

	test("the generator is a dev dependency: the build holds no code of it, and no package but the client and the suffix list", async () => {
		const pkg = (await Bun.file(
			join(import.meta.dir, "..", "package.json"),
		).json()) as {
			dependencies: Record<string, string>;
			devDependencies: Record<string, string>;
		};
		expect(Object.keys(pkg.dependencies)).toEqual([
			"@ractive-ch/tab-mcp-client",
			"tldts",
		]);
		expect(pkg.devDependencies["openapi-typescript"]).toMatch(
			/^\d+\.\d+\.\d+$/,
		);
		// TypeScript 5 for the generator alone: this repository's is 7.
		expect(pkg.devDependencies["typescript-5"]).toMatch(
			/^npm:typescript@5\.\d+\.\d+$/,
		);
		const outdir = tempDir();
		await build({ outdir });
		const licences = await Bun.file(join(outdir, NOTICES_FILE)).text();
		expect(licences).not.toContain("openapi-typescript");
		const worker = await Bun.file(join(outdir, "background.js")).text();
		// The sync is in the worker, in its own words.
		expect(worker).toContain("sitegloss-cloud");
		expect(worker).not.toContain("openapi-typescript");
		// The public suffix list is the panel's and the worker's, never in the
		// script that runs in every web page (DEC-067). `xn--p1ai` (.рф) is an
		// entry of the list's data, whichever code reaches it.
		const LIST = "xn--p1ai";
		expect(worker).toContain(LIST);
		const panelCode = await Promise.all(
			[...new Bun.Glob("sidepanel/*.js").scanSync({ cwd: outdir })].map((f) =>
				Bun.file(join(outdir, f)).text(),
			),
		);
		expect(panelCode.some((t) => t.includes(LIST))).toBe(true);
		const content = await Bun.file(join(outdir, "content.js")).text();
		expect(content).not.toContain(LIST);
	}, 60_000);
});
