
Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun check` instead of `tsc --noEmit`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Type checking

Use `bun check` to type check the project. It reads `tsconfig.json` and reports the same errors as `tsc`.

- `bun check src/index.ts` checks one file and what it imports
- `bun --check src/index.ts`, `bun test --check` and `bun build --check` type check first, and do nothing else if there is an error

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.


## This project

Sitegloss: a Chrome (and Edge) Manifest V3 extension for marking web pages, loading the
marks onto another build of the page, and talking them through with an AI app over
a tab-mcp relay. Design, plans and decisions live in `kb/` (hyalo, OKF profile): start
with `kb/design/overview.md` and `kb/iterations/`.

- Layout: `src/background.ts` (service worker), `src/content/` (overlay, drawing, save,
  highlighting; `activity.ts` is the page's one state machine), `src/sidepanel/`
  (`state.ts` the panel's one state, `view.ts` draws it, `main.ts` the actions; `mcp.ts`
  and `tools.ts` for the AI app), `src/lib/` (case format, element details with the
  allow-list of what is recorded, matching and `candidates.ts`, zip, export, store,
  images, `marks.ts` how a mark looks), `src/lib/cloud/` (the account at sitegloss.dev
  and the sync with a team, DEC-039: `servers.ts` the servers there are and each one's
  own part of the database (DEC-041), `auth.ts` sign-in and tokens, `api.ts` the client,
  `wire.ts` what differs and how it merges, `engine.ts` a run, `book.ts` its
  bookkeeping; `src/worker/cloud.ts` runs it, `src/sidepanel/cloud.ts` and
  `cloud-view.ts` show it). `scripts/build.ts` builds `dist/` (load it unpacked); `scripts/icons.ts` makes
  the icons; `bun test/e2e/pilot.ts <url>` measures matching on a real page;
  `bun scripts/api-types.ts` writes `src/lib/cloud/api.gen.ts` from the committed
  OpenAPI document (DEC-040).
- Which page an address is: `pageKey` in `src/lib/case/pages.ts`, and nothing else (DEC-038).
  It is the server's function; `test/page-key.json` is a copy of the server's
  `packages/api/vectors/page-key.json`. Every vector of the server (`test/<name>.json`) and its
  OpenAPI document (`src/lib/cloud/openapi-v1.json`) are copied byte for byte by
  `bun scripts/sync-vectors.ts [../sitegloss.dev]`, which checks them against the server's
  `vectors/manifest.json` and records their hashes in `test/vectors.json`
  (`test/vectors.test.ts` fails on a copy edited by hand): never edit a copy, sync it.
  Whether a mark is drawn on the page in front is `pathKey` (a home page on any host),
  and Home's offer `exactPage` (DEC-050). What a screenshot keeps of its query is
  `keptQuery` in `src/lib/query.ts`, the server's too: `test/kept-query.json` is a copy
  of its `packages/api/vectors/kept-query.json`, held the same way; so is
  `test/case-file.json` (the server's member download, which `validateCase` and
  case.md have to match), `test/case-md.json` (a whole case.md, byte for byte),
  `test/agent-instructions.json` (the web app's text for an AI app, which
  `src/lib/agent-instructions.ts` has to give) and `test/case-state.json` (where a case
  stands and whose turn it is, `src/lib/case-state.ts`, DEC-071).
- Commands: `bun run verify` (Biome CI, type check, the unit tests and the end-to-end
  smoke set; about two minutes) before every commit; `bun run fix` to format;
  `bun run build`, `bun run zip`. The full end-to-end sets are `bun run test:e2e`
  (Chromium, about six minutes here; `--shard=1/2` and `2/2` split it) and
  `bun run test:firefox`; run them by hand when a change is about what only a browser
  shows. CI runs `verify` on every pull request and on main; the full sets run nightly,
  on a release tag before anything is built, and by hand (`e2e.yml`, DEC-053). The
  price: a break only a browser shows is found the next night or at the release, not
  before the commit.
- Firefox: `bun scripts/build.ts --firefox` (`--test`, `--store --zip`) builds it from the
  same code; `src/lib/browser.ts` holds every difference (the build's define
  `SITEGLOSS_FIREFOX`, never the user agent). `bun scripts/firefox-dev.ts [URL] [--test]`
  runs it in Firefox through ff-rdp; use a debug port of your own (`--port`).
- End-to-end tests (`test/e2e/`) need Chromium or Chrome for Testing (`CHROME_PATH`, or
  Playwright's Chromium); branded Chrome ignores `--load-extension`. They are skipped
  without one locally and required in CI. Which run is set in one place,
  `test/e2e/mode.ts` (`SITEGLOSS_E2E=full` for all): a describe is `inFullSet`, or
  `inBothSets` for the smoke tests in it, whose other tests are `fullTest`s.
- An end-to-end test only where a real browser is the thing under test (capture
  pixels, the icon and `activeTab`, the side panel, sender checks, layout, downloads,
  IndexedDB, the relay, Firefox's event page); a decision is a unit test, and a test
  that only proves a fix once is no test (DEC-053). The test build's guards are short;
  a test that must outwait one sleeps `PAST_GUARD_MS`, and one that needs a failure
  timeout or the searches again sooner sets `testWaits` (`src/lib/test-waits.ts`).
  Name a test after the behaviour it guards, never after a review or a pull request.
- Firefox end-to-end tests (`test/e2e/firefox/`, under half a minute): a small suite
  through the `ff-rdp` CLI (`FF_RDP_PATH`) and Firefox (`FIREFOX_PATH`), headless on a
  free port; full set only (`bun run test:firefox`), skipped without them locally,
  required in `e2e.yml`, which pins both; a lock lets one run at a time.
- Runtime dependencies: `@ractive-ch/tab-mcp-client`, and `tldts` (the public suffix list for
  a case's sites, DEC-067), which only the side panel and the worker may load, never
  `content.js` (`test/build.test.ts` checks it). Prefer a few lines of own code over a package.
  No JavaScript from an AI app or server ever runs (fixed tools only).
- Tests against a real sitegloss.dev server run only with `SITEGLOSS_SERVER` set (and
  its demo users' password in `SITEGLOSS_PASSWORD`): `bun run test:server`
  (`test/cloud-server.test.ts`, `test/e2e/cloud.test.ts`, `test/e2e/firefox/cloud.test.ts`),
  before every release;
  the rest of the sync is tested against `test/cloud-fake.ts`, which keeps the server's rules.
- Always the latest versions of Bun, TypeScript, Biome and every dependency, pinned
  exactly.
- Biome ignores `.claude/` and `kb/`.
- No `kb/log.md` (removed by the owner, 2026-11-17): a change is described in its commit
  and its pull request, a decision in `kb/decision-log.md`.
- Commits: author email james@ractive.ch. MIT licence with `AI_NOTICE`.
