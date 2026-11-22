---
type: design
title: "Sitegloss design"
description: >-
  What Sitegloss is for, the workflow from a PO's mark on prod to a dev's fix on
  localhost and the check on dev and prod, the parts of the extension, the case format,
  how an element is found again in another environment, and the tools an AI app gets through
  tab-mcp.
tags:
  - design
  - architecture
timestamp: 2026-11-05T08:00:00+01:00
---

# Sitegloss design

Sitegloss is a Chrome (and Edge) extension for marking any web page: pick an element,
draw boxes, arrows and freehand marks, and comment on each. The marks are saved
as a named **case**. A case can be loaded onto the same page in another environment (localhost,
dev, prod), exported as a file, and read or extended by an AI app such as Claude through
a [tab-mcp](https://github.com/ractive/tab-mcp) relay.

## Workflow

1. A PO, designer or PM sees an issue on `https://www.example.com/…`, clicks the
   Sitegloss icon, marks the page and saves the case. They talk it through with
   their AI app, which adds its findings to the marks and records the summary for the
   developer in the case (DEC-019).
2. A dev opens `http://localhost:3000/…` themselves, loads the case onto that tab
   (from the extension, or from an exported file), sees what was meant, and fixes it
   with their AI app.
3. After the rollout the PO loads the case onto
   `https://dev.example.com/…`, later prod, and checks the fix.

Sitegloss never opens or switches environments itself: a case's marks are drawn on
whatever tab is in front (DEC-022). A team shares its cases through sitegloss.dev, for
whoever signs in (DEC-039); tickets and links to other tools are out of scope.

## The screenshot is the record

Finding the same element in another environment is unreliable: class names from CSS modules
change, generated ids change, content differs between environments, layouts differ by
window size, and the fix itself changes the element. So the **screenshot with its marks**
is what a case is about, and finding the element again is a best-effort extra:

- When a mark is drawn, Sitegloss captures the visible part of the page as the user sees
  it (DEC-012); marks drawn while nothing scrolled or changed share that capture.
  Adding a mark draws it onto its copy of the screenshot and cuts its crop.
- A case is created the moment "New case for this page" is clicked, with the page's title
  and no marks, and every action is stored at once: no drafts, no save step (DEC-026).
  Marks go into the case one by one, each as soon as its comment is done, with a
  screenshot of its own (DEC-014); "Rename" beside the title changes the title. A case
  left as it was made goes again when it is left.
- The page's toolbar always adds to a case, and only while that case is open in the side
  panel (DEC-023, DEC-026): "New case for this page" on Home creates a case and opens it,
  "Add marks" adds to the open case, and "← All cases" ends the toolbar (as its Done,
  then without a case: `overlay:end`) and takes the case's marks off the tab in front.
  A panel opened again opens the case the tab in front shows.
- A press on a loaded mark's pin on the page opens its comment there, with "Delete
  mark" and "Done", and shows the mark in the side panel; the page asks, the panel
  that drew the case on that tab does the change (DEC-027).
- Shapes are stored in the screenshot's own coordinates (CSS pixels of that viewport).
  They never have to follow the live page.
- Each mark also stores the details of its element (tag, role, accessible name,
  text, test id, the readable part of its classes, the heading above it, its landmark,
  its ancestors, its position). They are hints for the AI app and the dev to find the
  code, and the input of the matching below. A mark's own element also keeps how it
  looked when the mark was made: computed styles, the colour behind it, its neighbours'
  boxes (DEC-048), for contrast and alignment questions; matching never reads them.
- Opening a case in the side panel draws the marks of the page in front on the tab in
  front: a mark is that page's when it was made on the same path and hash route,
  whatever the host (DEC-057). Each one's element is highlighted where it can be found
  ("found", "probable", "ambiguous" with candidates, or "not found"); a mark of another
  page is not looked for, drawn or counted, and the panel names its page as a link that
  opens it and shows the mark there. While the case is open the marks follow the tab in front (another tab, a reload,
  a navigation, a single-page app's next route); "← All cases" takes them off,
  whoever drew them (DEC-023), and a Hide holds on its tab, also through a reload
  (DEC-022). When the case has no mark of the page in front, it says where its marks
  are. The side panel always shows the marked screenshots, so a case makes sense even
  when nothing is found.

## Parts

| Part | Job |
|---|---|
| Content script (`src/content/`) | Toolbar and drawing overlay in a shadow DOM, element picker, element details, a screenshot per mark as it is drawn, highlighting a loaded case |
| Service worker (`src/background.ts`, `src/worker/`) | Opens the side panel and injects the content script on the icon click; `captureVisibleTab`; WebP conversion, drawing the marks and crops at saving; writes cases; `TabMcp` with the tools and their questions (DEC-015); the one writer of the sync, to Downloads or a folder, also with the panel closed, and the icon's badge ("?" a question, "!" the sync paused or failed, "…" connecting; DEC-021, DEC-025) |
| Offscreen document (`src/offscreen/`) | Opened by the worker for a sync run to Downloads: exports a case and makes the blob URL the worker downloads (a service worker has none, DEC-025) |
| Side panel (`src/sidepanel/`) | Three views under one top bar (back button, AI pill): Home (this page, the case list, files and the sync's choice), a case (its marks follow the tab in front, `follow.ts`; summary for the developer, AI findings, export) and Settings (the AI connection's card: status, pairing; the options). The questions show in a modal dialog over the panel (DEC-037); each connected AI app's "Allow all changes" shows under the top bar on Home and in a case (DEC-036), and the sync's banner while it is paused or failed above every view |
| Library (`src/lib/`) | Case format, element details, matching, zip, export, IndexedDB store, images |

The look (DEC-024): the side panel is paper with ink on it, in light and dark, from one
token block in `style.css`; amber is a view's one action that starts drawing, the other
main actions are ink, and a mark's colour is its status (open, to verify, verified,
dismissed). The marks list has a margin with each mark's pin on a rail: the pin's colour is
the status, its fill the match. The page's overlay has one fixed
look on every page and in both schemes: ink bars with a white ring, every stroke over a
white casing, solid when the mark's element is found and dashed when it is unsure.
`test/contrast.test.ts` holds every colour pair to its WCAG ratio.

Storage is IndexedDB in the extension's origin (database `sitegloss`, stores `cases` and
`images`), shared by the service worker and the side panel. A content script runs in
the page's origin and never touches it directly.

### Permissions

- `activeTab`: clicking the icon (or the keyboard shortcut) on a tab allows Sitegloss on
  that tab until it navigates: injecting the content script and `captureVisibleTab`.
- `scripting`, `sidePanel`.
- `alarms`: wakes the service worker once a minute while AI access is on, so the
  connection comes back after a sleep. No install warning.
- `notifications`: a tool's question when no side panel is open in the window in front
  (DEC-015). Chrome's install warning "Display notifications".
- `storage`: `chrome.storage.session` for the toolbar's Undo and for AI access being on
  until the browser closes. The AI connection's settings and its address secret are in
  the worker's own IndexedDB (`sitegloss-settings`, DEC-016), not in `chrome.storage.local`,
  which content scripts may reach.
- `offscreen`: the sync to Downloads makes its blob URLs in an offscreen document
  (DEC-025). No install warning.
- `unlimitedStorage`: IndexedDB holds the only copy of the cases, so the browser must not
  evict it when disk space runs low. Chrome documents the permission as exempt from quota
  and eviction, and it adds no install warning, which keeps DEC-003's small warning.
- Optional `downloads`, asked in the click of Export (to show where the file went,
  DEC-020) or of "Sync to Downloads" (DEC-025), which writes every case to
  `Sitegloss/` in Chrome's downloads folder through it. The test build has it at install.
- Optional `<all_urls>`, asked for in the side panel ("Allow on all sites", in the options
  in Settings and in the notice the panel shows on a tab Sitegloss may not run on yet, DEC-022) only
  when the user wants Sitegloss without clicking the icon on each tab. `captureVisibleTab` accepts
  `activeTab` or `<all_urls>`, not a single site's permission. One site of it is asked for
  by itself: `https://tab-mcp.ractive.ch/*`, with the click on "Fill in the code for me"
  under the pairing code (a setting of its own, off by default, also with all sites), to
  fill in the code on the hosted relay's pairing page after asking (DEC-044; the client
  library's filler since DEC-049); "Stop filling in the code" gives it back. Nothing is
  required at install.

No JavaScript from an AI app or a server ever runs: the tools are fixed (Chrome Web Store
rules on remote code, and safety).

### The tab-mcp connection

`TabMcp` from `@ractive-ch/tab-mcp-client` runs in the service worker (DEC-015), an
extension context. Its WebSocket therefore carries the extension's origin
`chrome-extension://<id>`, which a website cannot fake. A content script's requests would
carry the page's origin, so the connection must not live there. The relay must allow the
extension's origin (relay 0.7.0 and later take it in `TAB_MCP_SITES`) and be relay
0.12.0 or later (client 0.17 and later need it, and Sitegloss's is newer; `package.json`
has the version). The MCP address names the app, `<relay>/s/sitegloss/mcp`,
the same for every installation and the Firefox build (DEC-042); the pairing code alone
says which installation an AI app is paired with. The connection
stays while the side panel is closed; the panel is a view that talks to it over one named
port, whose sender the worker checks (the panel's own page, not in a tab). "Keep AI access
on" connects at every worker start and after an idle session; without it AI access stays
on until "Stop AI access", the relay's end of the session, the browser closing, or an
update or reload of the extension (`chrome.storage.session` is cleared then too).

The extension ID is fixed by the `key` in the manifest (`manifest-key.txt`, a public key).
It is the Chrome Web Store item's key, so unpacked builds and the store version have the
same ID, `ldmcfigcnobhnbaigehcaodheklibeon`. The store package itself leaves the key out; the store adds it.

## Case format

A case is JSON (`format: "sitegloss/2"`) with its images referenced by relative path; a
mark's id is `m<number>`. A file of another format is not read: one of `sitegloss/1`
(marks under another key, ids `a<number>`) is refused with a sentence that says so
(DEC-051). The same JSON is stored in IndexedDB and written into the export, so an
export is the case plus its images. The database's version 2 started empty: its upgrade
emptied the cases and images kept in `sitegloss/1`, and the sync read the team's cases
again (`store.ts`, `forgetCases` in `cloud/book.ts`):

```text
<title>.sitegloss.zip
  case.json      the case
  case.md        generated: summary, comments, AI findings, element details, image links
  shots/s1.webp  screenshots with their marks
  crops/m1.webp  one crop per mark
```

```json
{
  "format": "sitegloss/2",
  "id": "c_…", "title": "Login button contrast",
  "createdAt": "…", "updatedAt": "…",
  "page": { "url": "https://www.example.com/cart", "title": "…", "lang": "de",
            "viewport": { "width": 1440, "height": 900, "dpr": 2 }, "userAgent": "…" },
  "pages": [{ "url": "https://www.example.com/cart", "title": "…", "lang": "de" },
            { "url": "https://www.example.com/checkout", "title": "…", "lang": "de" }],
  "shots": [{ "id": "s1", "image": "shots/s1.webp", "scrollX": 0, "scrollY": 0,
              "viewport": { "width": 1440, "height": 900, "dpr": 2 }, "capturedAt": "…",
              "url": "https://www.example.com/cart" }],
  "marks": [{
    "id": "m1", "number": 1, "shot": "s1", "comment": "…", "author": "user",
    "shape": { "kind": "box", "rect": { "x": 10, "y": 20, "width": 200, "height": 40 } },
    "crop": "crops/m1.webp",
    "element": { "tag": "button", "role": "button", "name": "Anmelden", "…": "…" },
    "resolution": { "kind": "fixed", "note": "…", "at": "…",
                    "app": { "id": "https://claude.ai/oauth", "name": "Claude", "host": "claude.ai" },
                    "verified": { "at": "…" } },
    "reopens": [{ "note": "Still pale on hover", "at": "…",
                  "was": { "kind": "fixed", "note": "…", "at": "…" } }],
    "findings": [{ "id": "f_…", "text": "…", "at": "…",
                   "app": { "id": "https://claude.ai/oauth", "name": "Claude", "host": "claude.ai" } }]
  }],
  "verdict": null
}
```

`verdict` holds the summary for the developer: the field kept its name from before
DEC-019. `findings` is there only when a mark has some; a finding has `editedAt` once its
app changed it, and `imported: true` once it came in from a file.

A mark's status is derived, never stored as such (DEC-023): open (no `resolution`),
fixed and to verify (`kind: "fixed"`), verified (`kind: "fixed"` with
`resolution.verified`), won't fix (`wontfix`), can't reproduce (`cantreproduce`).
`resolution.kind` never gets another value: an older build refuses a kind it does not
know, and with it the whole file. Every Verify field is optional: `verified { at, app? }`
is read only on a fix (dropped on another kind), `app` names the AI app that set a
status through a tool (absent: set in the panel), and `reopens` lists, oldest first and
at most 20, each time the mark was opened again with its note (at most 2,000
characters) and the whole resolution it ended, its note cut to the same 2,000 when the reopen is written
and when a file is read: a mark's history stays under about 85,000 characters. Like a finding, a resolution, its
verification and each reopen that came in from a file get `imported: true` on import,
whatever the file says: who set them and when is the file's word. An older build reading a file of this one
drops `verified`, `reopens` and `app`; `case.md` in the same zip still has them.

Shape kinds: `element` (a picked element's box), `box`, `arrow` (`from`, `to`), `pen`
(`points`), `note` (`at`). The element details carry a best-effort CSS selector as a
W3C Web Annotation `CssSelector`; a full W3C export is a follow-up if a consumer needs it
(DEC-002).

`page.url` is the origin and the path, with a hash route (`#/path`) if the page has one:
`plainUrl` in `src/lib/case.ts`. A case that came from a file also has `importedAt`, set
on import whatever the file says.

A case spans pages (DEC-038): a tester goes through a flow and marks each page of it in
one case. `pages` lists them in order, the first one being `page`, which stays as it was
for builds that know only it; every screenshot has the address of its page (`url`), and a
mark's page is its screenshot's. A case stored before `pages` has none, and its pages are
read from `page` and its screenshots (`casePages`). A page is told by its path, whatever
the origin, as a case's page always was.

## A team at sitegloss.dev

Sitegloss is local first: the cases are in the browser, and nothing needs an account.
Someone signed in to sitegloss.dev (DEC-039) has their cases synced with their team in
both directions, by the service worker:

- **Sign-in** is OAuth 2.1 with PKCE as a public client, in the browser's own window
  (`identity.launchWebAuthFlow`); the tokens are in the worker's database
  `sitegloss-cloud`, out of the pages' reach.
- **Which server** (DEC-041): the service, unless the user chose its development server
  or another address under "Server" while signed out; the Account section says so when
  it is not the service. Where a server signs people in is read from its discovery
  document. Everything below is kept per server, so nothing synced with one reaches
  another unless the user shares that case there.
- **Sending:** each synced case is compared with what the server last had of it, and
  the difference becomes operations (a new mark, a changed comment, a status, a finding,
  a delete), written down with ids of their own before they are sent, images first. The
  server applies an operation's id once.
- **Fetching:** everything after the team's revision this browser has seen; what was
  not changed here becomes the server's, what was changed here stays and is sent next.
- **Ids:** `m<number>` and `s<n>` stay what they are here; the server knows marks and
  screenshots by ids of their own, and the bookkeeping maps one to the other. A mark's
  number is the server's to give when two people drew the same one.
- **Live:** the open side panel listens to the server's events stream and tells the
  worker; without a panel an alarm looks every five minutes.

The case format gains only who did something, where the server wrote it down:
`user { id, name }` on a resolution, a verification, a reopen and a finding, and
`createdBy` on a mark. The sync to a folder (DEC-021) is apart from this and unchanged.

## Finding an element again

Sitegloss stores a fingerprint of the element, not a selector, and scores every candidate
on the new page by weighted similarity (after Similo, see
[prior art](../research/prior-art.md)):

| Feature | Weight | Comparison |
|---|---|---|
| test id (`data-testid`, `data-test`, `data-test-id`, `data-qa`, `data-cy`) | 3 | equal |
| hand-written id | 1.5 | equal |
| tag | 1.5 | equal |
| role (explicit or implied) | 1 | equal |
| accessible name | 1.5 | text similarity |
| text | 1.5 | text similarity |
| readable classes | 1 | Jaccard |
| attributes (`name`, `type`, `href` path, `src` file, `placeholder`, `alt`, `title`) | 1 | share equal |
| heading above | 1 | text similarity |
| landmark | 0.5 | equal |
| ancestors | 0.5 | sequence similarity |
| position on the page | 0.5 | distance, relative to the page size |
| size | 0.5 | area ratio |

Only features the stored fingerprint has count. Siblings share most of these
features, so a candidate that shares none of what identifies the stored element (its
test id, id, accessible name or text; similarity below 0.5) keeps only half its score,
rising to all of it at 0.7: the neighbour of a removed element is "not found" rather
than "found". An element whose text the fix rewrote completely is then not found
either; the screenshot still shows what was meant. Classes are reduced to their readable
part (`Button_primary__x7Yz2` → `Button_primary`); random ones (`sc-…`, `css-…`,
`kLmNoP`) and generated ids (React `:r1:`, UUIDs, long numbers) are ignored. A best
score of 0.75 or more is "found", 0.5 or more "probable"; when the second-best score is
within 0.03 of the best, the result is "ambiguous" and the side panel steps through the
candidates. Of tied candidates, the only visible one wins. A test id, id,
image file or link address counts as identity only when it is unique on the page, and an
element without identity is at most "probable". An element the page replaces after
loading is searched for again.

## Tools for the AI app

| Tool | What it does | Asks first |
|---|---|---|
| `list_cases` | Cases with title, pages, their marks by status (`open`, `toVerify`, `verified`, `dismissed`: won't fix or can't reproduce), the start of the summary for the developer | no |
| `get_case` | A case's pages and summary, its screenshots with their pages, marks with their page, status, resolution (`verified`, `by`), reopens and findings (`own` for the caller's), element details and crops | no |
| `get_image` | One screenshot or crop, scaled to at most 1568 px | no |
| `load_case` | Loads a case onto the tab in front and reports what was found | no |
| `highlight` | Scrolls to and outlines one mark's element (or another candidate) | no |
| `get_mark_element` | Reads one mark's element (or, by selector, an ancestor or an element inside it; for a mark without an element, an element of the mark's page) from the tab in front: trimmed HTML, box, computed styles, matching CSS rules, ancestors and children (DEC-013) | no |
| `capture` | A screenshot of the tab in front | no |
| `add_mark` | Adds a comment on an element (by CSS selector) to a case | yes |
| `set_summary` | Writes the case's summary for the developer (stored as `verdict`, DEC-019) | yes |
| `set_mark_status` | Sets a mark fixed (to verify), verified (only a fixed mark, and only when the user says so), won't fix or can't reproduce, or opens it again with a note, which records a reopen (DEC-023) | yes |
| `add_finding` | Adds a finding of the calling AI app to a mark (DEC-019) | yes |
| `edit_finding` | Changes the text of one of the calling app's own findings | yes |
| `delete_finding` | Deletes one of the calling app's own findings | yes |
| `delete_case` | Deletes a case | yes |

Every call that changes something asks, every time (DEC-008): in the side panel of the
window in front when it is open and focused, else also in a Chrome notification; no
answer in 60 s is Don't allow (DEC-015). The question names the case (title, page, number
of marks) and, for `add_mark`, the page in front, next to the raw arguments. "The
tab in front" is the active tab of the last focused normal window.

The tools that act on the tab (`load_case`, `highlight`, `get_mark_element`, `capture`,
`add_mark`) run
one at a time: they share the page's one loaded case and one temporary mark. An AI app's
screenshots blur form fields as the user's own do (password fields always, all fields
with the side panel's setting), go through the service worker's capture queue, and are
refused when the tab is no longer in front.

Results that carry page content are marked `untrustedContentHint`: page text can contain
instructions aimed at the AI app. A result stays within three quarters of the relay's
message limit (1 MiB by default), its text included: a large case is sent with element
summaries and shortened texts, and crops that do not fit are listed for `get_image`.
Images are WebP; crops of at most 800 px go as they are stored.
