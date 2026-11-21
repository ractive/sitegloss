/**
 * Builds the unpacked extension into `dist/` (or `--outdir`).
 *
 *   bun scripts/build.ts            development build with the fixed key (DEC-006)
 *   bun scripts/build.ts --store    no `key`, for the Chrome Web Store
 *   bun scripts/build.ts --test     grants `<all_urls>` and `downloads` at install, for the end-to-end tests
 *   bun scripts/build.ts --zip      also packs sitegloss-<version>.zip
 *   bun scripts/build.ts --firefox  the Firefox build into `dist-firefox/`
 *   bun scripts/build.ts --firefox --test
 *                                   the Firefox build with host access,
 *                                   `downloads` and the data collection
 *                                   granted at install, and the panel's page
 *                                   usable in a tab (automation cannot reach
 *                                   Firefox's sidebar)
 *   bun scripts/build.ts --firefox --store [--zip]
 *                                   the package for addons.mozilla.org into
 *                                   `dist-firefox-store/`, not minified, no
 *                                   source maps; `--zip` packs
 *                                   sitegloss-firefox-<version>-store.zip
 */

import { readdir, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { DATA_COLLECTION } from "../src/lib/browser.ts";
import { CONTENT_SCRIPT, PAIRING_SCRIPT } from "../src/lib/messages.ts";
import { writeZip } from "../src/lib/zip.ts";
import { ICON_SIZES } from "./icons.ts";

const ROOT = join(import.meta.dir, "..");

export interface BuildOptions {
	outdir?: string;
	/** Leave out `key` (Chrome Web Store upload). */
	store?: boolean;
	/**
	 * Grant `<all_urls>` and `downloads` at install, so tests need no click on
	 * the icon and no answer to Chrome's prompt (DEC-020).
	 */
	test?: boolean;
	/**
	 * The Firefox build: an event page for the service worker, a sidebar for
	 * the side panel, no offscreen document; into `dist-firefox/` (with
	 * `store`, `dist-firefox-store/`). No key: Firefox's id is in
	 * `browser_specific_settings`.
	 */
	firefox?: boolean;
	minify?: boolean;
}

export interface BuildResult {
	outdir: string;
	manifest: Record<string, unknown>;
	/** The extension ID the key gives; `undefined` for a store build. */
	id: string | undefined;
}

/** The extension ID Chrome derives from a public key (base64 DER). */
export function extensionId(base64Key: string): string {
	const der = Buffer.from(base64Key, "base64");
	const hex = new Bun.CryptoHasher("sha256").update(der).digest("hex");
	return [...hex.slice(0, 32)]
		.map((c) => String.fromCharCode(97 + Number.parseInt(c, 16)))
		.join("");
}

export async function readKey(): Promise<string> {
	return (await Bun.file(join(ROOT, "manifest-key.txt")).text()).trim();
}

/** The licences of all that a build contains, in the build and so in its zips. */
export const NOTICES_FILE = "LICENSES.txt";

const CLIENT = "node_modules/@ractive-ch/tab-mcp-client";

/**
 * Where each bundled package's licence is, from the repository's root.
 * `@cfworker/json-schema` publishes none; tab-mcp-client passes on its notice.
 */
const LICENCES: Readonly<Record<string, string>> = {
	"@cfworker/json-schema": `${CLIENT}/THIRD-PARTY-NOTICES.txt`,
	"@ractive-ch/tab-mcp-client": `${CLIENT}/LICENSE`,
};

/** The licence in a package's notice file; one without an MIT text stops the build. */
export function mitText(name: string, file: string): string {
	const start = file.indexOf("MIT License");
	if (start < 0) throw new Error(`no MIT licence text for ${name}`);
	return file.slice(start);
}

/** Sitegloss's licence and those of `packages`; a package without one stops the build. */
export async function notices(packages: Iterable<string>): Promise<string> {
	const text = (path: string) => Bun.file(join(ROOT, path)).text();
	const parts = [
		`Sitegloss\n\n${await text("LICENSE")}\n${await text("AI_NOTICE")}`,
	];
	for (const name of [...packages].sort()) {
		const path = LICENCES[name];
		if (path === undefined)
			throw new Error(`no licence known for the bundled package ${name}`);
		parts.push(`${name}\n\n${mitText(name, await text(path))}`);
	}
	return parts.join(`\n${"-".repeat(78)}\n\n`);
}

export function createManifest(
	version: string,
	options: { key?: string; test?: boolean },
): Record<string, unknown> {
	const icons = Object.fromEntries(
		ICON_SIZES.map((s) => [String(s), `icons/icon-${s}.png`]),
	);
	return {
		manifest_version: 3,
		name: "Sitegloss",
		version,
		description:
			"Mark what is wrong on a web page, open the marks in another environment to fix it, and talk them through with your AI app.",
		minimum_chrome_version: "116",
		icons,
		action: { default_title: "Sitegloss", default_icon: icons },
		background: { service_worker: "background.js", type: "module" },
		side_panel: { default_path: "sidepanel/index.html" },
		permissions: [
			"activeTab",
			"alarms",
			// The browser's own sign-in window, for sitegloss.dev (DEC-039).
			"identity",
			"notifications",
			// The sync to Downloads makes its blob URLs there (DEC-025).
			"offscreen",
			"scripting",
			"sidePanel",
			"storage",
			"unlimitedStorage",
			...(options.test ? ["downloads"] : []),
		],
		// Export asks for it, to say where the file went (DEC-020), and the
		// sync to Downloads writes through it (DEC-025).
		...(options.test ? {} : { optional_permissions: ["downloads"] }),
		optional_host_permissions: ["<all_urls>"],
		...(options.test ? { host_permissions: ["<all_urls>"] } : {}),
		commands: {
			_execute_action: {
				suggested_key: { default: "Alt+Shift+O" },
				description: "Open Sitegloss on this tab",
			},
		},
		...(options.key ? { key: options.key } : {}),
	};
}

/** The Firefox build's add-on id (`browser_specific_settings.gecko.id`). */
export const FIREFOX_ID = "sitegloss@ractive.ch";

/**
 * The Firefox build's manifest: Manifest V3 as Firefox has it. The
 * background is an event page (`background.scripts`: Firefox has no
 * extension service workers), the side panel a sidebar (`sidebar_action`),
 * and there is no offscreen document (the event page has a DOM and makes the
 * sync's blob URLs itself). Firefox 153, the ESR since 2026-07 (ESR 140's
 * last release was 2026-09-29), is the first to tell a message's
 * `documentId`, which Undo of a mark just added needs, and the first where
 * "Access local files on your computer" is what
 * `extension.isAllowedFileSchemeAccess` answers. The data collection consent
 * (from 140): Sitegloss sends nothing anywhere until the user turns AI
 * access on, and then the pages' content and addresses go to the AI app, so
 * that is optional and asked for at that click (a test build has it at
 * install, as it has host access and `downloads`).
 */
export function createFirefoxManifest(
	version: string,
	options: { test?: boolean },
): Record<string, unknown> {
	const icons = Object.fromEntries(
		ICON_SIZES.map((s) => [String(s), `icons/icon-${s}.png`]),
	);
	return {
		manifest_version: 3,
		name: "Sitegloss",
		version,
		description:
			"Mark what is wrong on a web page, open the marks in another environment to fix it, and talk them through with your AI app.",
		browser_specific_settings: {
			gecko: {
				id: FIREFOX_ID,
				strict_min_version: "153.0",
				data_collection_permissions: options.test
					? { required: [...DATA_COLLECTION] }
					: { required: ["none"], optional: [...DATA_COLLECTION] },
			},
		},
		icons,
		action: { default_title: "Sitegloss", default_icon: icons },
		background: { scripts: ["background.js"], type: "module" },
		sidebar_action: {
			default_title: "Sitegloss",
			default_panel: "sidepanel/index.html",
			default_icon: icons,
			open_at_install: false,
		},
		permissions: [
			"activeTab",
			"alarms",
			// The browser's own sign-in window, for sitegloss.dev (DEC-039).
			"identity",
			"notifications",
			"scripting",
			"storage",
			"unlimitedStorage",
			...(options.test ? ["downloads"] : []),
		],
		...(options.test ? {} : { optional_permissions: ["downloads"] }),
		optional_host_permissions: ["<all_urls>"],
		...(options.test ? { host_permissions: ["<all_urls>"] } : {}),
		commands: {
			_execute_action: {
				suggested_key: { default: "Alt+Shift+O" },
				description: "Open Sitegloss on this tab",
			},
		},
		// Chrome's default for Manifest V3. Firefox's adds
		// `upgrade-insecure-requests`, which turns a relay on the loopback
		// (ws://127.0.0.1, which the library allows) into wss: and fails.
		content_security_policy: {
			extension_pages: "script-src 'self'; object-src 'self'",
		},
	};
}

/** How every entry point is bundled. */
interface BundleOptions {
	minify: boolean;
	sourcemap: "none" | "linked";
	test: boolean;
	firefox: boolean;
}

async function bundle(
	entrypoint: string,
	outdir: string,
	format: "esm" | "iife",
	options: BundleOptions,
	naming?: string,
): Promise<string[]> {
	const result = await Bun.build({
		entrypoints: [join(ROOT, entrypoint)],
		outdir,
		target: "browser",
		format,
		...(naming ? { naming } : {}),
		// Always defined: left to run time, an element with that id on the page
		// would answer for it and open the overlay's shadow root.
		define: {
			SITEGLOSS_TEST_BUILD: String(options.test),
			SITEGLOSS_FIREFOX: String(options.firefox),
		},
		minify: options.minify,
		splitting: format === "esm" && entrypoint.endsWith(".html"),
		sourcemap: options.sourcemap,
		metafile: true,
	});
	if (!result.success) {
		throw new AggregateError(result.logs, `build of ${entrypoint} failed`);
	}
	return Object.keys(result.metafile?.inputs ?? {}).flatMap(
		(path) => /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(path)?.[1] ?? [],
	);
}

/**
 * Refuse to empty a directory that is not a build: the repository, one of its
 * parents, or a folder with other files in it and no `manifest.json`.
 */
export async function checkOutdir(outdir: string): Promise<void> {
	const target = resolve(outdir);
	if (`${ROOT}${sep}`.startsWith(`${target}${sep}`))
		throw new Error(`refusing to empty ${target}: it holds the repository`);
	let names: string[];
	try {
		names = await readdir(target);
	} catch (error) {
		// Only a folder that does not exist yet is fine; a file there (ENOTDIR)
		// or one we may not read must not be deleted.
		if ((error as { code?: string }).code === "ENOENT") return;
		throw new Error(
			`refusing to use ${target}: ${(error as { code?: string }).code === "ENOTDIR" ? "it is a file" : String(error)}`,
		);
	}
	if (names.length > 0 && !names.includes("manifest.json"))
		throw new Error(
			`refusing to empty ${target}: not empty and not a build (no manifest.json)`,
		);
}

export async function build(options: BuildOptions = {}): Promise<BuildResult> {
	const firefox = options.firefox === true;
	const outdir = resolve(
		options.outdir ??
			join(
				ROOT,
				firefox
					? options.store
						? "dist-firefox-store"
						: "dist-firefox"
					: "dist",
			),
	);
	await checkOutdir(outdir);
	const how: BundleOptions = {
		// Not the Firefox store package: addons.mozilla.org reviews the code
		// itself, which it can read unminified.
		minify: options.minify ?? !(firefox && options.store),
		sourcemap: firefox && options.store ? "none" : "linked",
		test: options.test === true,
		firefox,
	};
	const pkg = (await Bun.file(join(ROOT, "package.json")).json()) as {
		version: string;
	};
	await rm(outdir, { recursive: true, force: true });
	const packages = new Set([
		...(await bundle("src/background.ts", outdir, "esm", how)),
		...(await bundle(
			"src/content/index.ts",
			outdir,
			"iife",
			how,
			CONTENT_SCRIPT,
		)),
		// The relay's pairing page (DEC-044): the library's content script.
		...(await bundle(
			"src/content/pairing.ts",
			outdir,
			"iife",
			how,
			PAIRING_SCRIPT,
		)),
		...(await bundle(
			"src/sidepanel/index.html",
			join(outdir, "sidepanel"),
			"esm",
			how,
		)),
		// The sync to Downloads' blob URLs (DEC-025); Firefox's event page
		// makes them itself.
		...(firefox
			? []
			: await bundle(
					"src/offscreen/index.html",
					join(outdir, "offscreen"),
					"esm",
					{ ...how, test: false },
				)),
	]);
	await Bun.write(join(outdir, NOTICES_FILE), await notices(packages));
	for (const size of ICON_SIZES) {
		const name = `icon-${size}.png`;
		await Bun.write(
			join(outdir, "icons", name),
			Bun.file(join(ROOT, "assets/icons", name)),
		);
	}
	const key = options.store || firefox ? undefined : await readKey();
	const manifest = firefox
		? createFirefoxManifest(pkg.version, {
				...(options.test ? { test: true } : {}),
			})
		: createManifest(pkg.version, {
				...(key ? { key } : {}),
				...(options.test ? { test: true } : {}),
			});
	await Bun.write(
		join(outdir, "manifest.json"),
		`${JSON.stringify(manifest, null, "\t")}\n`,
	);
	return { outdir, manifest, id: key ? extensionId(key) : undefined };
}

/**
 * The zip's file name: `sitegloss-<version>.zip`, the store package
 * `sitegloss-<version>-store.zip`, Firefox's `sitegloss-firefox-<version>-store.zip`.
 */
export function zipName(
	version: string,
	options: { store?: boolean; firefox?: boolean } = {},
): string {
	return `sitegloss-${options.firefox ? "firefox-" : ""}${version}${options.store ? "-store" : ""}.zip`;
}

async function filesOf(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { recursive: true, withFileTypes: true });
	return entries
		.filter((e) => e.isFile())
		.map((e) => relative(dir, join(e.parentPath, e.name)))
		.filter((p) => !p.endsWith(".map"))
		.sort();
}

/**
 * Every entry's time: a zip of the same files is the same bytes whenever it
 * is made, so a reviewer who rebuilds the package from the source gets the
 * same SHA-256.
 */
const ZIP_DATE = new Date(1980, 0, 1);

/** Pack a build into a zip for "Load unpacked" or the store. */
export async function zipBuild(outdir: string, target: string): Promise<void> {
	const entries = [];
	for (const name of await filesOf(outdir)) {
		entries.push({
			name: name.split("\\").join("/"),
			data: new Uint8Array(await Bun.file(join(outdir, name)).arrayBuffer()),
		});
	}
	await Bun.write(target, await writeZip(entries, { date: ZIP_DATE }));
}

if (import.meta.main) {
	const { values } = parseArgs({
		options: {
			store: { type: "boolean" },
			test: { type: "boolean" },
			firefox: { type: "boolean" },
			zip: { type: "boolean" },
			outdir: { type: "string" },
		},
	});
	// Firefox installs no unsigned zip for good: only the store's is of use.
	if (values.firefox && values.zip && !values.store) {
		console.error("--firefox --zip packs only the store package: add --store");
		process.exit(2);
	}
	const result = await build({
		...(values.outdir ? { outdir: values.outdir } : {}),
		...(values.store ? { store: true } : {}),
		...(values.test ? { test: true } : {}),
		...(values.firefox ? { firefox: true } : {}),
	});
	const where = relative(process.cwd(), result.outdir) || ".";
	console.log(
		result.id
			? `Built ${where} (extension ID ${result.id})`
			: values.firefox
				? `Built ${where} for Firefox (add-on id ${FIREFOX_ID})`
				: `Built ${where} (no key: store build)`,
	);
	if (values.zip) {
		const target = join(
			ROOT,
			zipName(String(result.manifest["version"]), {
				...(values.store ? { store: true } : {}),
				...(values.firefox ? { firefox: true } : {}),
			}),
		);
		await zipBuild(result.outdir, target);
		console.log(`Packed ${relative(process.cwd(), target)}`);
	}
}
