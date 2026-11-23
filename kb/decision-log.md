---
type: decision-log
title: "Decision log"
description: Decisions for Sitegloss with their reasons, newest last. Owner decisions are marked as such and are not reopened.
tags:
  - decisions
timestamp: 2026-11-04T17:00:00+01:00
---

# Decision log

## DEC-001: Scope, name and home (owner)

Owner, 2026-11-04, in the planning conversation:

- A Chrome extension for marking any page (elements, boxes, arrows, freehand,
  comments), saving named cases, loading a case onto another build of the page, and
  talking it through with an AI app over tab-mcp. Forwarding cases to a team is handled
  elsewhere.
- The user opens the other environment's page themselves and loads the case; there are
  no "open on local/dev/prod" buttons and no environment settings.
- Its own repository, `ractive/overmark`, not an employer's. The name is Overmark
  ("Folie" was dropped: hard to say for English speakers).
- Vibe Annotations was checked and found too limited ([prior art](research/prior-art.md)).
- Before/after evidence per check, a backend with share links, and links to Jira and
  GitHub are follow-ups.

## DEC-002: The screenshot with its marks is the record; matching is best effort

Finding an element again across builds cannot be made reliable (generated classes and
ids, different content, layouts, and the fix itself). A case therefore centres on
screenshots with their marks plus a crop per mark; element details are hints and the
input of a similarity score (after Similo). The case format is Overmark's own
(`overmark/1`); the CSS selector is named after the W3C `CssSelector`, and a full W3C
Web Annotation export waits for a consumer that needs it.

## DEC-003: Chrome and Edge, Manifest V3, `activeTab` first (Firefox amended by DEC-034)

Firefox and Safari give every install a random extension ID, which a relay's allow
list cannot name. `activeTab` covers drawing, reading the page and `captureVisibleTab`
after a click on the icon; `<all_urls>` is optional and asked for at runtime. This keeps
Chrome's install warning small and the store review short.

## DEC-004: The tab-mcp connection lives in the side panel (replaced by DEC-015)

A content script's WebSocket carries the page's origin, so the relay would have to allow
every site. The side panel is an extension page (origin `chrome-extension://<id>`), has
a document for the connect dialog and the confirmations, `localStorage` for the address
secret and `BroadcastChannel`. The service worker has no document.

## DEC-005: Fixed tools only

No tool runs JavaScript sent by the AI app: the Chrome Web Store forbids remotely hosted
code, and it would hand the page to whoever controls the AI app's context. General page
inspection (clicking, scripting, network) stays with Claude in Chrome or a DevTools MCP.

## DEC-006: A fixed extension ID from our own key

`manifest-key.txt` holds a public key (base64 DER) that development and test builds put
into the manifest's `key`, so the ID is `fphhchhlgklidhnodoleiebmdhnfdadg` everywhere and
a relay can allow it. The private key was not kept: it is not needed for unpacked
extensions. Store builds leave `key` out; after the first upload the store's key replaces
ours (iteration 5).

## DEC-007: No runtime dependency besides the tab-mcp client

Zip reading and writing (store and deflate through `CompressionStream`), base64, images
(`OffscreenCanvas`) and the UI are a few hundred lines of own code; the owner prefers
that to packages for such things. The only runtime dependency is
`@ractive-ch/tab-mcp-client`.

## DEC-008: Every change an AI app asks for is confirmed, every time (replaced in part by DEC-018)

The PR #4 review found that `alwaysAllow: true` let one click on "Always allow" wave
through every later `delete_case` of that AI app, for example one steered by
instructions hidden in page text. tab-mcp-client 0.10.0 offers "Always allow" for every
consequential tool of a `TabMcp` or for none, so Overmark turns it off: `add_mark`,
`set_verdict` and `delete_case` ask in the side panel each time. The question names the
case and the page (an `onConfirm` that adds them to the description, then hands over to
`confirmInPage`). A per-tool "Always allow" would need a client release that offers it.

## DEC-009: What is recorded about an element is an allow-list

The reviews found typed text leaking into element details twice (through an editor's
wrapper, through a textarea's text). Instead of subtracting cases from "the element's
text", `src/lib/element.ts` names every recorded field with its source and limit, and
`ATTRIBUTE_RULES` every recorded attribute with its rule; an attribute without a rule is
never read. Text comes only from `pageText`, which skips fields, editors, scripts and
styles. Links keep their path only: a query string or fragment can carry personal data
or tokens. Matching compares link paths, which is enough to tell links apart.

## DEC-010: The page's one state machine

The content script guarded the user's save against an AI app's screenshot (and the
other way round) with flags spread over three files (`#saving`, `#hideAfterSave`,
`#showAfterSave`, the temporary mark, blur holders); every review found another race.
`PageActivity` (`src/content/activity.ts`) holds exactly one of idle, saving, an AI
mark or an AI capture. What arrives during a save is refused (AI) or recorded as what
to do afterwards (toolbar: show another case, or hide if the save worked). An AI
activity ends by itself after 10 s, so a side panel that crashed cannot block saving.

## DEC-011: The side panel draws one state

The panel kept its state in a dozen module variables (the tab, the overlay, the open
case, the loaded results, object URLs, render counters) and re-rendered from several
places; the second review found five races there. Now `PanelState` (`src/sidepanel/state.ts`)
holds all of it, actions in `main.ts` change it only through `update`, which schedules
one `render` (`view.ts`), and every asynchronous read goes through a `Latest`, so an
older read never overwrites a newer one. The verdict field stays the same element while
its case is open, so typing, focus and cursor survive every render; the other parts are
redrawn when what they show changed.

## DEC-012: A mark's screenshot is taken when the mark is drawn

The full review found the same fault behind several findings: screenshots were taken at
saving, sometimes long after the mark. By then a container had scrolled, the app had
moved to another route, the menu the mark was about had closed, or the layout had moved,
and the save put the mark on whatever was there. Since the screenshot is the record
(DEC-002), it has to show what the user saw when marking.

Now each mark gets its screenshot at once, under a pending path, with the element's
details read at the same moment. Marks drawn while nothing scrolled or changed in the DOM
share one screenshot. Screenshots show the page alone: saving draws the marks onto them
(`paintMark`, the same shapes the overlay shows in SVG), so undoing a mark and renumbering
marks for another case never touch an image. Saving no longer scrolls the page, which
made the planning of screenshot windows unnecessary. A shot records the page's address,
because one case can span an app's routes.

The page is never moved while the user works: a first version went back to where a mark
was drawn when the page had moved on before its turn, and a click in that moment hit
the wrong element. Now such a mark waits, and saving takes its screenshot from where it
was drawn, when nobody is using the page. That is the rare case (the screenshot waits
for Chrome's two captures a second, or for an AI app's screenshot); what the page
showed then is gone, but the scroll position is right.

The price: every new view flashes the overlay away for about 100 ms, and pending
screenshots live as long as their marks, so they are swept after 7 days instead of
10 minutes.

## DEC-013: An AI app may read a mark's element from the live page

The owner, 2026-11-09: the AI app could not help find solutions to a case's marks, since
it had no access to the page structure, only screenshots and the stored details. So
`get_mark_element` reads one mark's element from the tab in front: its outer HTML, box,
the window's size, a fixed list of computed styles without those at their initial value,
the style rules that match it from the sheets the page may read, four ancestors with
their layout styles and up to twelve children. It is a fixed, read-only tool (DEC-005
still holds: no code from the AI app runs, the selector is only matched), so it does not
ask first, like the other reading tools.

A CSS selector reads another element, but only among the mark's element's ancestors and
inside it: a page-wide lookup would let the AI app read anything on whatever tab is in
front, hidden content included. For a mark without an element (box, arrow, pen, note)
there is nothing to start from, so the selector is looked for on the whole page, and only
when the tab in front shows the case's page (`isPageUrl`). Selectors that name only `*`
are refused; the whole page is queried only for such a mark, and the first visible match
wins.

Whether a selector matches is itself an answer, so a selector may name only what the
markup shows (`src/lib/selector.ts`, from the November 2026 code review, CR-01): an
allow-list of tags, classes, ids, attributes that hold no field value (`id`, `class`,
`role`, `name`, `type`, `aria-label`, the test ids and the other markup attributes a
field keeps, but not `style` or `title`), the structural pseudo-classes and `:is()`,
`:where()`, `:not()`, the markup ones (`:required`, `:optional`, `:disabled`,
`:enabled`, `:read-only`, `:read-write`) and the combinators. Refused: pseudo-classes of
form or page state (`:checked`, `:placeholder-shown`, `:autofill`, `:valid`, `:focus`,
`:target`, `:visited`, …), `:has()` and `:empty`, which look inside an element and so
into fields and editors, `[value]`, `[checked]`, `[selected]`, `aria-value*`, `href`,
`src` and other `data-*` than a test id, pseudo-elements, namespaces and comments. The
selector is read as CSS tokenizes it (escapes decoded, any case). A match inside a
select, a text area or an editor counts as none, and an `option` keeps neither `value`
nor `selected`. The same rules hold for `add_mark`'s selector.

The answer follows the same line (the review of PR 45): a page's own style rule whose
selector says a state (`:checked`, `:hover`, `:has()`, `:empty`, `[checked]`, …) is
never listed among the matching rules, matched or not, and not counted; the tool's
description says so. An editor, a select or a text area is read without its children,
and its markup always carries the left-out note, empty or not; an element inside a
hidden one is not named by a selector, substring operators (`^=`, `$=`, `*=`) only test
`id`, `class` and the test ids, and the ancestors listed for an element inside an editor
start at the editor. The markup and the rules never carry what was typed or chosen; the
computed styles and the position of an element can reflect a field's state where the
page's own CSS styles it by state (a ticked checkbox's colour, an autofilled field's
background), as a screenshot does. Closing that would leave the tool without the styles
it is for.

Nothing of it is stored, so DEC-009's allow-list of recorded details does not apply, but
its reasons do: the HTML is written by Overmark's own serializer (`src/lib/inspect.ts`),
not taken from `outerHTML`. Form fields keep an allow-list of attributes (never `value`,
`checked`, `selected` or `aria-value*`); the content of text areas, selects and editable
regions (with Monaco, CodeMirror 5 and Ace) is left out, also when the element itself is
inside one; hidden subtrees (`display: none`, `visibility: hidden`) are left out, with a
note. URLs lose their query, fragment and user name and password, found by the
attribute's name (`href`, `data-src`, `*srcset`, …) and by the value (anything that
parses as an absolute, root-relative or query-carrying URL, also inside a longer value
and in CSS `url()`s); other schemes than http(s) keep only the scheme (`mailto:…`), as
DEC-009's links do. The head, `meta`, `link`, `script`, `style`, `title`, `base`,
`noscript` and `template` are never the element read, and their content is never sent;
a meta tag named like a secret loses its `content`, `srcdoc` its document, event
handlers their code, attributes named like a secret (`data-csrf-token`) their value.
Everything is capped (about 16 KB of markup, 30 rules), and a cut is said in the result;
for a small relay message limit the page sends a second markup cut at 4 KB. The result opens with a note that the page's content is data, not
instructions, and is marked `untrustedContentHint`. It is refused while the page is busy
with a save or a screenshot, whose blur is inline style the page does not have.

## DEC-014: Marks for a case go into it as they are done

The owner's feedback: after "Add marks" a new mark was only stored after "Save…",
which then asked "Add to case" or "Back"; nobody expects either step. Now the toolbar
has two modes. Without a case, marks are drafts and "Save case…" stores them as a new
case with a title, as before (its form's other button is "Keep drawing"). With a case
(the side panel's "Add marks", "Continue annotating", or after that first save), the
toolbar says "Adding to “<case>”" and each mark goes into the case as soon as it is done:
its comment confirmed, or the comment closed with the mark kept. Done tries the marks
not in the case yet once more and closes the toolbar when all are in; while one is not,
the toolbar stays up and says so, and Done again discards it.

- One queue in the content script adds the marks in order, one save each, and also
  runs Undo and New case, so nothing overtakes an add. Before each add the worker says
  whether the mark's number is still free (`case:number`); if an AI app took it, the
  marks not added yet are renumbered; a number taken between that check and the save is
  checked once more and the save tried again.
- Each queued mark records the case it was queued for. When the side panel switches the
  toolbar to another case meanwhile, the mark is not added there: it waits as a failed
  mark that names its case, until "Add mark N" (the user's choice) puts it into the
  case the toolbar adds to now.
- The screenshot is taken when the mark is drawn, as before (DEC-012). Each added mark
  gets a shot of its own in the case, drawn with its mark and the lower-numbered marks
  this toolbar added before on the same view (so it looks as one save would have; the
  worker draws no higher number, so Undo never leaves a pin behind). Marks on one view
  still share the one capture: its pending image stays (`keepPending`) until the page
  no longer looks like it and no mark waits for it. No extra captures, and Undo never
  has to redraw a screenshot. The price is storage: a case grows by one full screenshot
  per mark (some 100 to 300 KB each), so a case may hold as many shots as marks (1000;
  it was 200), and a full case says so before anything is drawn.
- Undo takes the mark with the highest number: a draft from the page, or a mark added
  since the toolbar was last shown out of the case (`case:undo-add`), with its crop and
  its shot. Since its pin was on no other screenshot, its number is free again, unlike a
  delete in the side panel, which keeps the number (a pin may stay on shared shots).
- `case:undo-add` deletes, so the worker allows it only for a mark it recorded when
  that add was saved, from the same tab and document (`chrome.storage.session`, hence
  the `storage` permission; it has no install warning and is gone when the browser
  closes), and only once. The mark must also still be as the add stored it (not
  resolved, comment unchanged, the user's), the highest number in the case, on a
  screenshot of its own taken less than a day ago. Anything else is deleted in the
  side panel.
- A failed add leaves the mark on the page as a draft with the reason and an "Add mark
  N" button; a mark whose screenshot was given up (the page moved before its turn)
  waits for that button or for Done, when nobody is using the page and scrolling back
  to take it is safe ("Add mark N" turns the tool off first). A failure shows the
  toolbar again if it was closed meanwhile. The status is one element with
  `role="status"`, changed in place; the reason of a failure is in one with
  `role="alert"`; the button that had the focus has it again after the toolbar changes.
- A new case gets its own id instead of the pending images' id, so one id holds a
  page's pending screenshots for as long as the page is open.
- **Replaced in part by DEC-026:** the toolbar has one mode. There are no drafts and no
  "Save case…" with its form ("Keep drawing", the title it kept): "Annotate this page"
  creates the case at once, and every mark goes into it as above. A page no longer
  creates a case through `case:save` (`isNew` is refused from a page).

## DEC-015: The AI connection lives in the service worker; questions in the panel or a notification (storage replaced by DEC-016)

The owner, 2026-11-09: the connection to the AI app must stay while the side panel is
closed, as the tab-mcp extension's does (its DEC-116). This replaces DEC-004's home for
the connection; its reason stays true, since the worker is an extension context too and
its WebSocket carries the extension's origin.

- **Where.** `TabMcp` and the tools run in the service worker (iteration 8). A WebSocket
  that carries messages keeps the worker alive since Chrome 116,
  and the relay's heartbeat (a ping every 25 s) carries some on a quiet connection. The
  library runs there without a document: its address secret in a write-through cache over
  `chrome.storage.local` (IndexedDB since DEC-016), `connect({ resume: true })`, and a bundle without dynamic
  `import()`. An alarm once a minute while AI access is on, and every worker start,
  connect again. "Keep AI access on" keeps its meaning (also after a browser start and an
  idle session); without it AI access stays on until "Stop AI access", the relay's end of
  the session, or the browser closes. The flag for that lives in `chrome.storage.session`,
  which Chrome also clears when the extension is updated, reloaded or disabled: without
  "Keep AI access on", an update or reload ends AI access too.
- **Who may command it.** Only the side panel's own page, over one named port whose
  sender is checked (this extension, the panel's path, not in a tab). Content scripts
  reach `chrome.runtime` too; their one-off messages stay the old ones and no AI command
  is among them. `chrome.storage.local`, which now holds the secret, is for trusted
  contexts only (`setAccessLevel`, for the local area from Chrome 140, so that is now the
  manifest's minimum). Where Chrome refuses it, the worker fails closed: it removes the
  stored secrets, keeps none, and AI access stays off with a message saying why.
  (Replaced by DEC-016: the settings and the secret are in the worker's IndexedDB,
  `setAccessLevel` is best effort, the minimum is Chrome 116 again.) The panel's page
  opened in a tab gets no port: it is not where the user answers questions.
- **Questions.** Every call that changes something still asks (DEC-008), now in the side
  panel of the window in front when it is open and focused, and otherwise also in a Chrome
  notification: `requireInteraction`, an id per call, Don't allow first, an Allow within
  500 ms of showing does not count, a click on the body or closing it is Don't allow, a
  click on a settled call is dropped. No answer in 60 s is Don't allow (the library tells
  the AI app "The user declined", as for any no). The panel's Allow
  arms after the panel was visible and focused for 750 ms. While a question waits the
  icon shows "?", so a user whose notifications are off can answer in the panel. The text
  is the same as before (`confirmLines`: the case, the mark, the page).
- **The address.** The panel's `localStorage` secret (and its relay, Keep AI access on and
  Blur form fields) is handed to the worker once, when the side panel first opens, so an
  AI app keeps working with the address it was given.
- **Cost.** `notifications` adds Chrome's install warning "Display notifications"; Overmark
  is not in the store yet. `alarms` adds none.

## DEC-016: The AI settings and the address secret in the worker's IndexedDB

2026-11-09, after overmark#26: DEC-015 kept the address secret and the AI settings in
`chrome.storage.local`, closed to content scripts with `setAccessLevel({ accessLevel:
"TRUSTED_CONTEXTS" })`, treated a refusal as fail closed, and raised the minimum to Chrome
140 because the local area's access level was said to apply only from there. The sources
disagree (Chromium's `storage.json` and MDN say the access level applies to the session
area only), and a level that silently does not apply would not throw: the fail-closed
path guarded nothing it could see. Content scripts can read and write
`chrome.storage.local` by default, so a page whose renderer was compromised could, in
Overmark's content-script world, have read the secret, or written a `relay` of its own
for the next start to connect to with it. The tab-mcp extension made the same move (its
PR 89 and PR 91, DEC-116); this follows it.

- **Where.** The relay, "Keep AI access on", "Blur form fields in screenshots", the
  takeover (`replaced`), the panel-handover marker and the address secret are in an
  IndexedDB database of their own, `overmark-settings` (object store `settings`,
  `src/worker/kv.ts`), in the extension's origin. Content scripts run in the page's
  origin and cannot open it, in any Chrome version. Only the service worker uses it; the
  cases' database (`overmark`) and its schema are untouched. No package: a few lines
  over IndexedDB.
- **The panel.** It neither reads nor writes these settings in storage. It sends
  `keep-on`, `set-relay` and the new `blur-forms` over its port, and shows the state the
  worker sends, which now carries `blurForms`. A setting changes in the worker's memory
  only after its write to the database succeeded; a failed write keeps the old value and
  shows the problem, so the panel, the tools and the database agree. The tools read blur
  from the worker's settings at each call, so a change while connected holds for the
  next screenshot (the fix from overmark#26). The worker tells open overlays its blur
  value (`overlay:settings`) when it changes, when the worker starts and when a panel
  attaches, so an overlay a panel started before it knew the value is corrected. A panel
  that has no state from the worker within 2 s, or whose worker failed to start, starts
  an overlay with blur on (the safe side), as does the panel's page opened in a tab,
  which has no port and whose blur box is disabled like its other AI controls. A worker
  whose connection cannot start (its database cannot be opened) tells the panel why, and
  the panel says "AI access is not available" instead of nothing.
- **The database closing.** Chrome may close the connection (`onclose`), and deleting or
  upgrading the database elsewhere asks it to close (`onversionchange`): the worker
  closes it, and the next read or write opens it again.
- **The session flag stays in `chrome.storage.session`.** "AI access is on until the
  browser closes, or the extension is updated, reloaded or disabled" is exactly that
  area's lifetime, and the area is for trusted contexts only unless the extension opens
  it (Overmark never does, and calls no `setAccessLevel` on it). In IndexedDB it would
  need a browser-start marker from `runtime.onStartup` and `onInstalled`, and no event
  says the extension was disabled and enabled again, so it could not keep the meaning.
  The flag cannot redirect anything either: it only connects to the user's own relay
  with the user's own secret.
- **Nothing is taken from `chrome.storage.local`.** Only the owner's own build of
  overmark#26 ever wrote settings there; it was never released. Every worker start
  removes the setting keys found there (`relay`, `keepAiOn`, `blurForms`, `replaced`,
  `migrated`, the secrets) and imports none of them, whoever wrote them. A one-off import
  would need a marker that lives in the database it guards (lost with the site's data, after
  which a content script's value would be imported), or `onInstalled`, which fires after
  the worker has already loaded its settings and may have made a new secret. Cost: the
  owner's build loses its relay, Keep AI access on, Blur form fields and its address once,
  and the AI apps paired with it pair once more.
- **The panel's handover stays.** The side panel's `localStorage` (builds before
  overmark#26) is in the extension's origin, out of content scripts' reach, so its
  handover stays: the secrets are adopted first, then Keep AI access on, the relay, Blur
  form fields and the marker `panelHandedOver` are written in one transaction, and only
  then does the worker connect or switch relay. The panel deletes its copy only once the
  marker is set; a handover cut short before that runs again, whole, at the panel's next
  connection (a secret the worker has is not taken twice).
- **`setAccessLevel` is best effort.** The worker still asks for `TRUSTED_CONTEXTS` on
  the local area as an extra layer; a refusal is logged, nothing fails closed, and
  nothing of the AI connection is kept there any more.
- **Chrome 116 again.** The minimum from before overmark#26: a WebSocket that carries
  messages keeps the service worker alive from there (DEC-015); nothing else in the code
  needs a newer Chrome.

## DEC-017: The tab-mcp extension's AI app card

2026-11-09, after the owner's "wait until Tab MCP finishes it and then just copy it": the
tab-mcp extension's PR 88 settled its side panel's AI access UI, and DEC-015's plain
pairing view gives way to it.

- **The card** (`src/sidepanel/card.ts`, the tab-mcp extension's rules on Overmark's
  state): an "AI access" switch in its header (on also while connecting or retrying, so
  the user can stop that); off, "Turn on AI access" is the one primary button; on with no
  AI app paired, the address and the code show at once (pairing runs only then); with
  apps paired, "+ Add another AI app" shows them again, with Done. The address shows only
  while pairing. Disconnect asks first, and the second click of a double click confirms
  nothing. The switch shows the user's flip until a state that matches it comes, for at
  most 10 s.
- **Overmark's own parts stay.** The relay field and "Keep AI access on" sit under the
  card (the tab-mcp extension has no Keep AI access on: its worker always retries). The
  header keeps its status pill and "Stop AI access", which also show in a case; the pill
  leads to the card on the home view, turning AI access on if it was off.
- **A covered panel is not on screen.** Another extension's panel for the tab (Claude in
  Chrome's) can cover Overmark's while it stays open. The panel tells the worker its
  visibility (`visible`); a hidden panel's questions go out as notifications, as a
  closed panel's do, and a question asked meanwhile is a notification at once.
- **The panel opens with the tab** (2026-11-10). As in the tab-mcp extension,
  `sidePanel.open({ tabId, windowId })`, so that it shows over a panel another extension
  opened for the tab: with the window alone Chrome resolves and shows nothing, and the
  owner saw exactly that in branded Chrome with Claude in Chrome's panel open. The call
  was left out of iteration 10 because the store package's end-to-end test failed in CI
  (Chrome for Testing 156 on Linux, twice in a row; it passed on macOS). The likely
  cause: the panel takes its width a moment after the click, and a click measured
  before that went past the overlay onto the test page's submit button (the log shows
  `#overmark-root` gone after it). The icon-click tests now wait until the panel has
  taken its width and the viewport keeps its size, and marking waits for the Element
  tool to be on; with that the test passed in CI on Linux. The covered-panel test hides the panel's page itself: in Overmark's harness a
  second extension's worker did not start.
- **Notifications keep Don't allow and Allow.** The tab-mcp extension's Allow and Always
  allow do not apply: every change asks each time (DEC-008). (Replaced by DEC-018: Allow
  and Always allow, closing it is Don't allow.)

## DEC-018: Always allow, per tool or for all, until the AI app is disconnected (owner; the switch's place amended by DEC-036)

The owner, 2026-11-10: bring "Always allow" back, per tool and also as "allow
everything" for an AI app, lasting until that app is disconnected. This replaces
DEC-008's "every time"; its reason stays true and is the risk accepted here: an AI app
steered by instructions hidden in page text (or in a case's own texts) can run an
always-allowed tool, `delete_case` included, without the user seeing it. The user takes
that on knowingly, for one app and one tool at a time, or for all of one app's changes.

- **Per AI app and tool.** A question in the side panel has "Don't allow", "Allow" and
  "Always allow", with one line under them: "Always allow: <tool> runs without asking for
  <app>, until you disconnect it." Always allow arms with Allow (the panel visible and
  focused for 750 ms). A notification has "Allow" and "Always allow" (Chrome allows two
  buttons); closing it or a click on its body is Don't allow, and either button within
  500 ms of showing does not count, as before. The exception (the review of PR 45): a
  notification shows the case and the arguments whole, and where the arguments do not
  fit (over 150 characters, or the message over 300), it offers only "Don't allow" and
  says to open Overmark's side panel to read all of them and answer there, since the
  user would otherwise allow text they were not shown. Nobody answering ends as
  unanswered, as before; the notification does not open the side panel. The app is the grant (one pairing), not
  its name: an app paired again, or another app with the same name, is asked again.
  Unlike the tab-mcp extension's Always allow, it is not tied to the page: Overmark's
  tools are fixed and act on cases, not on a page's own tools.
- **Allow all changes.** Under each app in the AI app card, a switch "Allow all
  changes" lets every tool that changes something run without asking (adding a mark,
  the verdict, a mark's status, deleting a case), with a line saying so while it is on.
  Below it, the tools always allowed for the app, each with "Ask again".
- **Where and how long.** In the worker's settings database (`overmark-settings`, key
  `alwaysAllowed`, by grant id; DEC-016), so it survives the panel closing, a worker
  restart and a browser restart. An app's entry goes when its grant goes: each list of
  grants the relay sends (at every connection, and when one is added or removed) drops
  the entries of apps not on it. That covers Disconnect, New address (which revokes
  every grant), and a takeover the user answers with New address. "Stop AI access" and
  the AI access switch keep the pairing, and so keep the entry. Switching to another
  relay drops the entries of the first relay's apps at its first connection (the safe
  side: they ask again after switching back).
- **What limits it.** Only tools that change something ask at all; the reading tools
  never did. An Always allow from a question is kept only if the app is still connected
  when the answer comes; the panel's switch works only for an app the card lists, so
  nothing is allowed that the card does not show. The panel changes them only over its
  port, its commands checked in `protocol.ts` (DEC-015). A write that fails changes
  nothing: the call that was answered runs, the next one asks. The last AI call shows in
  the panel's header as before, also for calls that did not ask.

## DEC-019: AI findings on marks, and the summary for the developer (owner)

The owner, 2026-11-10: an AI app records what it finds out about a mark as findings of
its own, apart from the user's comment; and the case's "Verdict" becomes the "Summary for
the developer".

- **Findings per mark.** A mark has a list of findings (`findings`, oldest first, absent
  when there are none): each with its text (at most 5,000 characters), the AI app that
  wrote it (`app`: its client id, its declared name and the verified host, as the relay
  gave them for the call), when it was written (`at`) and last changed (`editedAt`). A
  mark holds at most 20. The user's comment stays the user's: no tool changes it.
- **A case holds at most 200,000 characters of findings.** All marks' finding texts
  together: `add_finding` and `edit_finding` refuse a change past it ("The case holds
  too much finding text … Shorten or delete findings of your own first"); a change
  that shrinks the total passes, so a case from a file over the limit can still be
  tidied. Why this value: get_case sends a case whole while it takes at most half of the
  result budget (768 KiB of the relay's 1 MiB message, so 384 KiB); a case of 30 marks
  with comments of a few lines and 200,000 characters of plain findings is about 250 KB,
  well under it. Text that is not ASCII is larger in UTF-8; such a case goes compact,
  where each finding shows its first 200 characters with `cut: true`, so a large case
  stays readable.
- **Characters are code points.** Every length limit of the case (findings, comments,
  notes, the summary) counts characters as JSON Schema's `maxLength` does, an emoji
  one: the tools' schemas, the case's validation and the cuts agree, and a cut never
  splits a surrogate pair.
- **Own is the client id.** An app may edit or delete only its own findings: those whose
  `app.id` is the calling app's client id (its Client ID Metadata Document URL, such as
  `https://claude.ai/oauth`). Not the grant: that changes when the app pairs again or
  the address is renewed, and the app's findings stay its own. Not the name: any app can
  declare any name. get_case says `own` for each finding. Another app's finding is
  refused with a message that says whose it is. The user can delete any finding in the
  side panel (Delete, then "Really delete?"); a finding's id is unique on its mark only,
  so the panel keys this on the mark and the finding, and a mark's open, unsaved
  comment or resolve form stays open through it.
- **A finding from a file is no app's own.** An import marks every finding
  `imported: true`, whatever the file says: the app a file names is whoever wrote the
  file's, so no app may change it, and the panel and case.md say "as the file says".
  Findings are AI-written text the next AI app reads: the instructions and case.md say
  they are data, never instructions, like the comments and the summary.
- **They ask first.** `add_finding`, `edit_finding` and `delete_finding` change the case,
  so they go through the same question as the other changing tools, and DEC-018's Always
  allow and Allow all changes cover them per tool. The question names the case, the mark
  and, for an edit or a delete, the finding and its app; for another app's finding it
  says the change will be refused whatever the answer. (Refusing before the question
  would need a check the library does not offer; the tool refuses in the same
  transaction that would write.)
- **Summary for the developer.** What should change overall, as agreed; whoever loads
  the case reads it first. The panel's label, its placeholder ("What should change, as
  agreed. Whoever loads this case sees it first."), "Save summary", the case list's
  preview, case.md's heading, the tool `set_summary` (replacing `set_verdict`, argument
  `summary`) and the `summary` key in list_cases and get_case.
- **The stored field stays `verdict`.** Cases in IndexedDB and exported files keep the
  field `verdict`: no migration, old files import as they are, and files from this
  build still open in an older one. The panel's internal names and element ids
  (`verdict`, `save-verdict`) stay with the field. An Always allow kept for
  `set_verdict` names a tool that no longer exists and allows nothing.

## DEC-020: Export says where the file went; Export all cases; tooltips (owner)

The owner, 2026-11-10: after Export the side panel shows where the file went; one more
button exports every case at once; the panel's buttons say in a tooltip what they do.

- **Where the file went, with the optional `downloads` permission.** The manifest lists
  `downloads` under `optional_permissions`; nothing is asked at install. A click on
  Export (or Export all cases) calls `chrome.permissions.request` first, before anything
  is awaited, since Chrome shows its prompt only during a click; where Overmark has the
  permission already the answer is yes at once and nothing shows. While Chrome's prompt
  is open, the panel says under the button what the answer does. With a yes the file
  goes through `chrome.downloads.download({ url: <blob URL>, filename: <the export's
  name> })`; the panel waits for the download to complete (`downloads.onChanged`),
  reads its absolute path with `downloads.search({ id })` and shows it under the button
  ("Saved as", the path, Copy and Show in folder, `downloads.show(id)`), then revokes
  the blob URL. Chrome's own settings decide the folder, and a name that exists already
  becomes `name (1)`, which is why the path is worth showing.
- **A no changes nothing.** Declined, or no `downloads` API, or `downloads.download`
  refusing the file: the export is saved exactly as before (a link's `download`) and the
  panel shows nothing more. Overmark asks again only at the next click on Export, never
  otherwise: Chrome shows its own prompt each time, the panel nags in no other way. A
  Save as dialog cancelled by the user shows nothing; a download Chrome stopped
  (`interrupted`) says so under the button.
- **Export all cases: one zip, a folder per case.** `overmark-cases-<YYYY-MM-DD>.overmark.zip`
  holds one folder per case, named after its title as an export's file name is
  (`login-button-contrast/`), with `-2`, `-3` for a title that comes again; inside each,
  exactly the single-case layout (`case.json`, `case.md`, `shots/`, `crops/`). Nothing
  else at the top: a single-case export has `case.json` at the top, a file of all cases
  does not, which is how Import tells them apart. Cases in the order of the list (newest
  change first). A file Import would refuse is no use, so Export all checks first, from
  the sizes of what is stored, what Import checks: a case that unpacks to more than
  150 MB (or whose `case.json` is over 20 MB) refuses the export, naming each such case
  by its title ("too large to be imported again … Export the other cases one at a
  time"); all cases together may unpack to at most 256 MB, and the zip itself, with its
  headers, may be at most 256 MB too ("Export them one at a time"). 256 MB, not more, as
  the panel holds the file in memory: the cases' files while the zip is built (let go as
  soon as it is), then the zip, put into a Blob at once for saving. The button sits next
  to "Import a case…" and is disabled with no cases.
- **Import a case… reads both.** A `case.json` at the top: one case, as before (at most
  150 MB). Otherwise each `<folder>/case.json` is a case, read and checked with the same
  rules as a single case; one bad case, or a case id twice, refuses the whole file with
  a message naming the folder (`In login-button-contrast/: The export lacks
  crops/m1.webp.`), and nothing is stored. The file may be at most 256 MB, and what it
  unpacks to is counted for the whole file, not per case: the sizes its cases' entries
  declare are added up before anything is unpacked (an entry never unpacks to more than
  it declares), and what each case did unpack to is added up as it is read; past 256 MB
  the file is refused (`The cases in the file unpack to more than 256 MB.`), so a small
  zip of zero-padded images cannot unpack to gigabytes. The check reads every case and
  its images and lets the images go again; each case's images are unpacked (and
  checked) once more when that case is stored, one case at a time, so the panel never
  holds the images of all cases at once. Then the cases go in one after the other: one
  that is not here is stored at once; one whose id is here already asks the same
  question as a single import ("Replace it", "Keep both", and "Skip" instead of
  "Cancel"), saying which case of the file it is. Each case is stored in its own
  transaction, as a single import. At the end the panel says how many were imported
  (`Imported all 3 cases of …`, or `Imported 1 of the 3 cases of …, 2 left as they
  were`); a file of several cases opens none of them. A file with one folder imports
  as a single file does. One import at a time: while a file is read or its cases stored,
  or while its question is open, "Import a case…" and "Export all cases" are disabled,
  their tooltips say why, and the panel shows `Importing <file>…` under them; a file
  chosen anyway is not read.
- **Tooltips.** A `title` on the buttons whose label does not say enough: Export and
  Export all cases (what the file holds, that it is one .zip, that Import a case… reads
  it), Import a case…, Show and Hide marks on this tab and the list's Load, Delete (case,
  mark, finding), New address, Connect again, + Add another AI app, Done, the copy
  buttons, Stop AI access (pauses from any view; the same as the AI access switch, both
  turn Keep AI access on off), the switch, Keep AI access on, Blur form fields, Match
  size, Resolve, Reopen, Change, Show, Next candidate, Disconnect, Allow all changes, Ask
  again, the question's three answers, the import prompt's answers and the header's
  status. What a user needs before clicking stays visible text (the note while Chrome
  asks, the import prompt, the AI card's explanations). The page's toolbar keeps its
  tooltips as they were.
- **The test build has `downloads` at install** (required, not optional), since CDP
  cannot answer Chrome's prompt; the end-to-end tests stub `chrome.permissions.request`
  to answer no for the old way. The test browser's profile sends downloads to a folder
  of its own: under CDP's `Browser.setDownloadBehavior` "allow" the `downloads` API's
  `filename` is ignored and files are named by a GUID.

## DEC-021: One-way sync of the cases to a folder the user chose (owner)

The owner, 2026-11-10: Overmark keeps the cases in a folder the user picks once with the
File System Access API (`showDirectoryPicker({ mode: "readwrite" })` from the side
panel), one in iCloud Drive or Dropbox for instance; no `downloads` permission and no
download UI for it. One-way: Overmark writes, the folder is a mirror. Each case is its
own file in the single-case Export format, overwritten when the case changes; a deleted
case keeps its file, so a mistaken delete can be undone with Import a case…; nothing is
read back from the folder. After a browser restart Chrome may want the permission again
(it can be asked only in a window, with a click): the panel says "Sync paused: allow
access again" with a button, never failing silently. The rest was worked out here:

- **What Chrome does, tried in Chrome for Testing 151 (headless and headed).** A
  `FileSystemDirectoryHandle` is structured-cloned through IndexedDB: the side panel
  stores it, the service worker reads it back and uses it. `FileSystemHandle`,
  `queryPermission`, `requestPermission` and `createWritable` all exist in the
  extension's service worker. The permission is the extension origin's, shared by the
  panel and the worker: a real folder (handed to the panel by a dropped folder, since
  CDP cannot answer the picker: `Page.setInterceptFileChooserDialog` sees the picker but
  only aborts it) granted for reading in the panel was listed by the worker, and a folder
  of the origin's private file system was written by the worker. Write access to a real
  folder needs Chrome's dialog ("Save changes to …?"), which `requestPermission` from the
  panel showed and, clicked by hand, answered "granted"; the worker's write after it was
  not recorded (the Mac's screen locked before the run was repeated), so the worker
  writing a real folder rests on the shared grant shown for reading. And: **Chrome takes
  the grant back the moment the extension's last page closes.** One second after the
  panel closed the worker got `prompt` (and `NotAllowedError` listing the folder), and a
  panel opened again too. So the worker can write only while the side panel (or another
  Overmark page) is open, unless Chrome keeps the permission ("Allow on every visit", if
  its prompt offers it for an extension; not tried).
- **The worker writes, always.** One writer for every change, wherever it comes from:
  saves and Undo from a page and the AI tools (`deps.onChange`, through
  `ConnectionDeps.changed`) are the worker's own; the side panel's changes reach it as
  the `cases:changed` it announces anyway (accepted only from an extension page, never
  from a content script), and the panel sends `sync:run` when it opens and after Allow
  access, Try again and a new folder. Runs never overlap: a change during a run starts
  one more run after it (`Sync.request`). The zip is built in the worker, so a large
  case never blocks the panel. Each run compares every case with what was written, so
  writing from the panel and catching up on open, the fallback the owner named, is what
  the worker's run does anyway: whatever changed while the grant was gone (an AI app's
  change with the panel closed, a browser restart) is written on the first run that has
  it again.
- **Where it lives.** A database of its own, `overmark-sync` (a `Kv` of `src/lib/kv.ts`, store
  `settings`), in the extension's origin: the panel writes `folder` (the handle, its
  name and an id) and `folders` (every folder chosen so far, each with its handle and
  id); the worker writes `files:<folder id>`, one record for each folder synced, and
  `status`. The AI settings' database stays the worker's alone (DEC-016); content
  scripts reach neither. It is opened at its first use, and opened again at the next
  use after an open that failed; the panel shows "Could not read the sync's state"
  while it cannot read it.
- **What was written, per case.** A folder's record holds the folder's id and, by case id, the
  version written (`updatedAt`, and `importedAt`: an import may keep `updatedAt`) and
  the file's name, saved after each file so that a worker stopped in the middle goes on
  from there. A case whose version matches is not written again. Deleted cases stay in
  it, as their files stay in the folder. Since nothing is read from the folder, a file
  the user deletes or changes there is not noticed: the case's next change writes it
  again.
- **File names.** Export's own: `exportFileName`, `login-button-contrast.overmark.zip`.
  A name another case has already (a deleted one too) gets `-2`, `-3`; so does a name of
  a file in the folder that Overmark did not write for that case (only whether the name
  exists is looked at, `getFileHandle` without `create`): such a file is never
  overwritten. A case keeps its file while its title gives the same name.
- **A renamed case**: its file of the new name is written, then its old file is
  removed. It is the same case, so two files of it would only mislead; deleted cases
  keep theirs. *(In Downloads, where nothing can be removed, a case keeps the name it
  was first written under: DEC-025 as amended after the review of PR 57.)*
- **Another folder starts afresh** (a new id: nothing written to the old one counts).
  Choosing a folder synced before, at any time (Change folder… back to it, after Stop
  syncing, after other folders in between), gives it its id back, compared with
  `isSameEntry` against every folder in `folders`; its record is still there, so
  Overmark's files in it are its own and are updated in place, never written again
  under `-2` names.
  Stop syncing keeps the files, and a run under way stops before its next file.
- **Writing.** `getFileHandle(name, { create: true })`, `createWritable()`, one
  `write` of the zip, `close()`: Chrome writes to a temporary file and moves it into
  place on `close`, so the folder never holds half a case; on an error the stream is
  aborted.
- **Failures, in the panel with what to do.** No permission (`queryPermission` not
  `granted`, or `NotAllowedError` / `SecurityError` while writing): "Sync paused: allow
  access again", why Chrome asks again, Last synced, and Allow access (primary), Change
  folder…, Stop syncing; Allow access calls `requestPermission` in the click and, with a
  yes, asks the worker to run; a no says so. The folder gone (`NotFoundError`): "The
  folder “…” is no longer there: it was moved, renamed or deleted. Click Change folder…
  to choose it again, or another one." No space (`QuotaExceededError`), a locked file
  (`NoModificationAllowedError`), anything else: what happened, and Try again; Overmark
  also tries again at the next change. A case that cannot be exported (an image
  missing) is named, and the other cases are still written.
- **The panel.** Under the case list, apart from Export and Import by a rule: "Sync to a
  folder…" (its tooltip says what it does: a file per case as Export writes it, a deleted
  case keeps its file, nothing is read); then "Syncing to <folder>" with "Last synced
  <date>" or "Writing 3 cases…", Change folder… and Stop syncing, each with a tooltip;
  the paused and failed states as above. Colours from the panel's tokens, so light and
  dark alike; the paused line in the warning colour.
- **Tests.** Unit tests of `Sync` with a folder in memory (writes, skips unchanged,
  import, rename, deleted case, same titles, foreign files, another folder, paused and
  back, permission lost in a run, folder gone, no space, one case failing, no overlap,
  Stop during a run). End to end, as pickers cannot be automated: the test build gives
  the panel `overmarkUseFolder(handle)` (left out of the store package, checked by the
  build test), and the test hands it a folder of the private file system
  (`navigator.storage.getDirectory()`); a case saved on a page appears there as its
  export, an AI app's `set_summary` writes it again (the worker), a case deleted in the
  panel keeps its file, and after Stop syncing nothing more is written.

## DEC-022: Opening a case shows its marks on the tab in front, and they follow it (owner)

The owner, 2026-11-12: "you never want to load a case without showing the marks … When a
tab becomes active and the case is loaded, just try to show the marks. If none of them
are found, show a warning." And, about the side panel without access to the tab: a
warning icon beside "Overmark may not run on this tab yet …", with "Allow on all sites"
there.

- **Opening a case draws its marks on the tab in front, whatever page that is.** Not only
  on the case's own path (`isPageOf`) as before: the main use is another origin, such as
  `localhost`. The same for a case that an import opens. The case list's Load button goes:
  a click on the case does what it did.
- **The marks follow the open case to the tab in front.** While a case is open, a tab
  that comes to the front of the panel's window (`tabs.onActivated`) gets its marks, and
  so does the tab in front once it has loaded, reloaded or navigated (`tabs.onUpdated`
  with `complete` or a new address); the marks are taken off the tab they were on
  before, where it is still there (failures do not matter). A tab still loading is
  drawn on once it has loaded; a page no content script runs on (an extension's own
  page, `chrome://`) is left alone. A tab whose page shows the case already (the panel
  drew it, or an AI app's `load_case` did) is not drawn on again, which would drop the
  candidates chosen: so a new address within the page (a hash, `pushState`) keeps the
  marks, and only a page that loaded again (it shows no case) is drawn on. A tab where
  the panel drew the case and an AI app has put another case since is left to the AI
  app. Only the newest of these steps acts: one that waited for a slow page while
  another tab came to the front does nothing, and a draw that fails after that writes
  no hint. The searches again at 1 s and 2 s (marks a script
  draws late) run for every such draw. What a draw found goes under the case's buttons
  only while the user's own actions there (Match size, Export, Hide) have not written
  since: a draw that happens on its own never wipes their outcome (`Latest.peek`).
- **"← All cases" takes the panel's marks off the page.** The panel remembers where it
  drew them; marks an AI app loaded through the tools are the page's (`state.loadedCase`
  in the worker) and stay, as before. Closing the side panel leaves the marks where they
  are, as before.
- **Hide holds on that tab.** "Hide marks on this tab", or the Hide on the page's own
  bar (which also stops the searches again), keeps the case's marks off that tab while the case stays open: through switching
  to other tabs and back, and through reloads of that tab. "Show marks on this tab" on
  it, or opening the case again, ends that. Why through a switch back: the user took
  them off that tab on purpose, and a switch is no change of mind.
- **None found: the case says so.** When the draw is over (after the searches again)
  and none of the marks that recorded an element is there (every one `lost`; resolved
  marks count as any other, a mark without an element says nothing about the page),
  the case shows a warning with a warning sign: "None of this case's marks were found
  on this page. It is probably for another page: <the case's short address>." with
  "Open the case's page" (`openPage`). On a page with the case's own path (another
  build) only the first sentence shows, without the button. Some found: the marks'
  states as before.
- **Without access to the tab, a notice, and only what needs the page is off.** Chrome
  hides a tab's address until Overmark may run there (`activeTab` from the icon or
  Alt+Shift+O; a click in the side panel grants nothing). The home view (above "Annotate
  this page") and the open case (above "Show marks on this tab") then show the notice
  with a warning sign and "Allow on all sites", which asks for `<all_urls>` in the click
  (`chrome.permissions.request`, nothing awaited before it); with a yes the notice goes
  and the open case's marks are drawn (`permissions.onAdded`). The icon's click on that
  tab draws them too, as before. Where Overmark may run on all sites and Chrome still
  hides the address (its own pages, the Web Store), the notice says that Overmark
  cannot run there, without the button; where Overmark may not read files either
  (`chrome.extension.isAllowedFileSchemeAccess`), it may be a file, so the notice says
  that too and offers "Open Overmark's details" (chrome://extensions, where "Allow
  access to file URLs" is). The panel cannot tell which, as Chrome hides the address. Only the actions that need the page are
  disabled, each with a tooltip pointing at the notice: Annotate this page, Show/Hide
  marks on this tab, Add marks, and a mark's Show. The case list, editing a case,
  import, export, the summary and the AI app card work without the tab. A tab still
  loading has no address yet and shows no notice. The "Allow on all sites" checkbox in
  the options stays. "Show marks on this tab" no longer asks for the case's site on such
  a tab (it is off there); the case's address still does as it opens the page.
- **One heading.** The home view's "This tab" heading becomes "This page"; under it the
  tab's address, else its title, else nothing (it said "This page" a second time).

## DEC-023: A toolbar belongs to the open case or to a new one; All cases closes the case; Verify (owner)

The owner, 2026-11-12: "The goal is to have a tested, user friendly experience to
annotate a page and then fixing it", checked from three roles: the tester who marks
and hands the case over, the developer who fixes on their build, and the tester again
who verifies each fix. On the flow: "I'd expect that you open a case, you can annotate
and add marks, stop annotating etc. When you go back to '← All cases', the current case
should be 'closed' and the annotations be removed and you shouldn't be able to 'Continue
annotating'." On "← All cases": "I missed it at first glance." On Verify: build it, the
tester gets Verified or Reopen (with a comment) per mark, and the case shows open /
fixed, to verify / verified. The details are the
[UX review](design/ux-review-2026-11.md)'s, which the owner asked for.

- **One rule for the toolbar.** On the tab in front, the page's toolbar belongs to a new
  case being drawn (the panel is on Home) or to the open case (the panel shows it):
  *toolbar adding to case X ⇔ case X is open in the panel*. "Annotate this page" always
  starts a new case; "Continue annotating" no longer exists. The toolbar's "New case"
  button goes (it made a toolbar with no case open). *DEC-026 replaces the first half:
  no toolbar belongs to a new case being drawn; "Annotate this page" creates the case
  and opens it, so a toolbar always adds to the open case.*
- **"← All cases" closes the case.** The toolbar adding to it is ended (as its Done,
  then its target cleared: the page message `overlay:end`), and the case's marks are
  taken off the tab in front whoever drew them. This changes DEC-022, which left the
  marks an AI app's `load_case` drew. A mark that could not be added keeps the toolbar
  up and the panel in the case, which says so; a second click leaves without it. The
  back button is a real button in a top bar (32 px high), not a 12 px link.
- **The panel adopts what the page shows.** On Home, a toolbar on the tab in front that
  adds to a stored case opens that case (so "Save case…" opens the new case; *with
  DEC-026 there is no "Save case…": the adopt stays for a panel opened again, and a
  toolbar whose case is gone ends instead of drawing a new case*). When the
  panel starts, the case whose marks the tab in front shows is opened too: closing the
  side panel leaves marks and toolbar on the page as before (PR 42's open question),
  and opening it again is in that case again, not on Home with orphaned marks.
- **Hide holds through a reload of that tab** (PR 42's other open question): it ends
  with Show marks, with closing the case, or with closing the panel.
- **The owner, 2026-11-14, on the case view.** "Show marks" was a link and was
  overlooked: it is a button with an edge, in the marks' bar beside "Expand all", and
  absent on a case without marks. The status block (the bar and its chips) moves from
  the header to just under the "Marks" heading, where its chips filter the list below;
  the header keeps what the tab in front says in words. "Add marks" also shows the
  case's marks on that tab: a Hide there ends with it, and a mark added is drawn like
  the others; Hide still hides while adding. A mark's head answers the pointer as one block (a wash), not with an
  underline, which made each line of a comment look like a link of its own.
- **A Settings view** holds the AI app card and the options. The AI pill opens it and
  keeps the case open: it closed the case before, which would now also end marking
  and clear the page.
- **Verify is stored as additions, never as a new `resolution.kind`.** An older build
  refuses a file with a kind it does not know, and drops fields it does not know. A
  mark's status is derived: open (no `resolution`), fixed and to verify (`kind: fixed`),
  verified (`kind: fixed` with `resolution.verified { at, app? }`), won't fix, can't
  reproduce. A reopen moves the whole resolution it ends into `mark.reopens[]`
  (`note?`, `at`, `app?`, `was`; at most 20, a note at most 2,000 characters), so the
  claimed fix and its note survive. Older cases need no migration: their fixed marks
  are to verify, which is true. A file of this build read by an older one loses
  `verified` and the reopen notes; `case.md` in the same zip keeps them.
- **Who may do what.** In the panel: Resolve… (fixed and to verify, fixed and verified,
  won't fix, can't reproduce), Verified on a fixed mark, Reopen… with a comment that is
  required. An AI app's `set_mark_status` gains `verified`, only for a mark that is
  fixed and, as its description says, only when the user says so, never for its own
  fix; `open` on a resolved mark records a reopen, its note optional so that existing
  calls keep working. An Always allow for `set_mark_status` covers `verified` too.
  For an AI app a verified mark changes only by a reopen (decided in the review of
  pull request 47): `open` records the reopen with the verified fix as `was`;
  `fixed` and `verified` on a verified mark change nothing and say so (`fixed`:
  "add a finding" to say more); `wontfix` and `cantreproduce` on it are refused
  with an error, since the AI app asked for a change it did not get (the owner,
  2026-11-13, after the live test: as a plain result it read as done). The
  question to the user says beforehand when a call will change nothing or be
  refused, by the same rule the tool then holds to (`statusOutcome`). This departs from the
  UX review's "`fixed` on a verified mark changes only the note", which let an AI
  app's text stand as the user's note. In the panel, the user's Change… still
  changes a verified mark.
- **No role switch.** One panel for tester and developer: each mark offers the action
  its status calls for, and the case's status chips (Open, To verify, Verified, Closed)
  are legend and filter in one. The case list, `get_case`, `list_cases` and `case.md`
  carry the same counts.

## DEC-024: The look: paper and ink, colour is the status, amber once (owner)

The owner, 2026-11-12: "Redesign: free hand", and about the case header: dark on dark
without much contrast. The [UX review](design/ux-review-2026-11.md) measured it: the
text was fine (7.8:1); the surfaces and boundaries were not (the band against the sheet
1.22:1, button borders 1.67:1, in light 1.29:1), so buttons, chips and fields had no
shape.

- **No ink band.** The panel is paper (`--paper`) with sheets on it; structure comes
  from spacing, rules and boundaries that reach 3:1 (`--edge`). Every text pair reaches
  4.5:1 in light and dark; a unit test reads the tokens from `style.css` and the page's
  constants and asserts each pair of the review's tables.
- **Amber once per view**, for the action that starts drawing (Annotate this page, Add
  marks). Other main actions are the ink "strong" button; three ambers on one screen
  made none primary.
- **Colour is a mark's status, the dash its match.** Open stays `#e5195f` on the page
  (as on its screenshot), to verify is indigo, verified green, closed grey; found is
  solid, unsure dashed. Green meant "found" before, where a reader expects "fine".
  Every stroke on the page has a white casing and the bars a white ring, so they show
  on any page; the page's overlay keeps one fixed look in both schemes.
- **The margin rail.** The marks list has a margin column with each mark's pin on a
  rail: its colour the status, its fill the match.
- System fonts only; the extension loads nothing.

As built (PR d), where the review's figures did not hold on the real toolbar: no page
width decides its layout (the review said 720 px; on macOS the tools with their words
measure about 740 px, another system's font gives another width, and a classic
scrollbar takes 15 px of the page). The toolbar
measures itself when its parts change, when it shows and when the page is resized, and
takes the first layout that fits: the status beside the tools; the status on a second
row; the tools as icons; Undo and Close as icons too; the buttons closer. Their words
stay as accessible names. The side panel holds at 345 px of content (Chrome's 360 px
less a classic scrollbar): there the AI pill's words give way first. The found line keeps "3 of 4
marks found on …" and adds "Dashed: unsure." only when a dashed mark is drawn. The AI
pill also says "AI connecting…". A problem (the panel's page in a tab, an update under
an open panel, a connection that cannot start, failed, was lost or taken over) is said
without hovering: the pill's dot is red and it names the problem in two or three
words, and the sentence shows under the top bar on every view. The whole status stays
in the pill's name and tooltip. The rail is a
mix of `--edge` and `--paper` (decoration, between a rule and an edge); the banner's
button stands right of the text only where it is the only one and the panel is at
least 400 px wide.

## DEC-025: Sync to Downloads by default, to any folder as an option, and an Allow that cannot be missed (owner)

The owner, 2026-11-12, on the sync's "Allow access" (DEC-021): "It was not obvious",
it was missed. The decision: offer both. Default: a subfolder of Downloads written
through `chrome.downloads` (`conflictAction: "overwrite"`), which never asks again and
works with the side panel closed; its limits: only inside Downloads, each write shows
in Chrome's download list, the optional `downloads` permission is asked once. Option:
any folder through the File System Access API as in DEC-021, with an Allow access that
cannot be missed.

- **Two targets, one engine.** `Sync` (one writer, a record per target of what was
  written, names with `-2`) writes to a target: Downloads (`Overmark/` in Chrome's
  downloads folder) or the folder. *Amended after the review of PR 57:* in Downloads,
  where nothing can be removed, **a case keeps the file name it was first written
  under**; a rename changes the file's content, not its name, so no stale file is left
  (it left its old file before, and under DEC-026 every case starts with the page's
  title and is renamed afterwards). The folder removes the old file and writes the new
  name, as before. Someone syncing to a folder keeps doing so; nothing switches by
  itself. "Use Downloads instead" is offered where the folder needs access.
- **What needs the user is above every view and on the icon.** While the sync is paused
  (the folder needs access again, or the downloads permission is gone) or has failed, a
  banner sits above Home, the case and Settings with the one button that helps (Allow
  access, Allow downloads, Try again), and the toolbar icon shows "!" (amber paused,
  red failed) with a title that says why. The worker runs the sync when it starts, so
  the "!" is there after a browser restart before the panel is opened.
- **How the worker downloads, tried in Chrome for Testing 151 (headless) before it was
  built on.** The worker has no `URL.createObjectURL` (`undefined` there). An offscreen
  document (`chrome.offscreen.createDocument`, reason `BLOBS`, the `offscreen`
  permission, which adds no install warning) made a blob URL and answered with it over
  `runtime.sendMessage`; the worker downloaded it with
  `chrome.downloads.download({ url, filename: "Overmark/<name>", conflictAction:
  "overwrite", saveAs: false })` into `Overmark/` under the profile's downloads folder.
  A second write of the same name replaced the file: no `(1)` copy, no dialog. It worked
  with no extension page open but the offscreen document (the only other page was the
  browser's `about:blank` tab), also for a 5 MB file, and again after the document was
  closed and opened anew. Erasing the earlier entry (`downloads.erase`) left the file and
  the newer entry. So the fallback (the panel making the URL, data URLs for small cases)
  is not built. The offscreen document builds the case's export itself from the
  extension's database, as a message carries JSON only; it answers only the worker's
  messages. One run opens it at its first file and closes it at its end; each download
  is waited for (`downloads.onChanged`, 60 s, then cancelled), its URL revoked, and the
  entry written before it erased. **With Chrome's "Ask where to save each file before
  downloading" on, `saveAs: false` does not stop the dialog**: headless, the download
  ended `interrupted` with `USER_CANCELED`. The sync then fails with what to do (turn
  the setting off, or choose a folder), and also when Chrome saved the file somewhere
  other than `Overmark/<name>` (the user answered that dialog, or another extension
  moved it). Such a failure only the user can end is kept until Try again or a new
  choice, so no run downloads (and asks) again by itself. **Not shown: the store
  build's way to the permission**, where the worker starts without `downloads` and the
  user's yes in the panel must make `chrome.downloads` appear in that running worker.
  Tried headless with an optional `downloads`: `permissions.request` from a click in
  an extension page neither resolved nor rejected within 10 s (Chrome's prompt cannot
  be answered there), so whether the API appears without a worker restart is not
  known, and is on the owner's list to try by hand. If it does not, the worker sees the
  permission (`permissions.contains`) without the API: the sync fails saying so, that
  it starts once Chrome restarts Overmark's background part (by itself after a while
  without use), and how to do it now (Overmark off and on in chrome://extensions); every
  change and start tries again. The e2e tests run with `downloads` at install. Not tried either: a headed
  Chrome's download bubble on each write (changes in a row now wait 2 s of quiet, so a
  burst is one download per case), and Edge.
- **After the review of PR 48.** A title Windows reserves (`con`, `nul`, `com1`…) is
  written as `_con.overmark.zip`, and a name Chrome refuses is that case's problem, not
  the run's. Choosing Downloads writes every case again into its own file (nothing is
  read back, so this brings deleted files back). The offscreen document failing stops
  the run; a run names at most three failing cases. The worker calls an extension API
  every 20 s while it waits for a download, so Chrome does not stop it; should it stop
  all the same, the download under way is in `downloads:pending` (its id, case,
  version and name), a top-level `downloads.onChanged` wakes a new worker at its end,
  and the next run settles it from Chrome's list (complete in `Overmark/`: written;
  otherwise its entry goes and the case is written again; still under way: waited for)
  before it closes a document left open. *Amended after an end-to-end failure on CI,
  2026-11-15:* `downloads:pending` is cleared only once the new entry is kept (the one
  before erased) or a failed one erased, not as soon as the wait is over: a worker
  stopped in between left the entry before in Chrome's list beside the new one and
  wrote the case again. A worker stopped after that, before its record is saved, still
  writes the case again (one entry stays: the newest). A failure only the user can end (a Save
  dialog cancelled, the file saved elsewhere) is not tried again until Try again or a
  new choice. Changes in a row wait 2 s of quiet before a run to Downloads; a folder is
  written at once. Only an entry this extension wrote into `Overmark/` is erased or
  shown; Stop syncing forgets its id, and gives the permission back when "Sync to
  Downloads" asked for it (not when Export had it). Choosing Downloads (again) writes
  every case into its file, which is the way to bring back files deleted there.
  **Limit:** `Overmark/` is shared by every profile and browser syncing to Downloads,
  and nothing there can be looked at, so one install overwrites another's file of the
  same name: one profile per downloads folder, or choose a folder (the README says so).
- **The badge, built.** One decision for the icon (`src/worker/badge.ts`): an AI app's
  question "?" first (it waits for an answer now), then the sync's "!" (amber `#ffb000`
  with `#1b2130` paused, red `#b3261e` with white failed, its title saying why and, with
  AI access on, that too), then "…" while connecting. The spark stays in the icon beside
  the "!" while AI access is on. The worker reruns the sync when the `downloads`
  permission is taken back or given (`permissions.onRemoved` / `onAdded`), so a
  permission taken back in Chrome's settings shows as "paused" at once. Stop syncing
  clears the status and the "!".

## DEC-026: A case is created at once; every action is stored; no drafts (owner)

The owner, 2026-11-13, after getting lost in the flow of DEC-023: "I opened a page,
clicked on 'Annotate this page' and I stayed on the main screen. What do I do now? I
can't see the mark I added and I can't seem to 'save' the case." Then: "Why not directly
creating the case (without saving in the beginning), switching into the case 'view' (as
if you'd choose an existing case now) and show the marks there." And, asked whether a
draft with a Save button or no save step: "Store it the moment it's created. Probably
also true for all the marks you add. Every action should save immediately. Then we
wouldn't have drafts — which is ok I think."

- **"Annotate this page" creates the case and opens it.** The side panel asks the page
  what it is (`page:info`: address, title, language, viewport, user agent, as a mark's
  screenshot records them), stores the case at once with the page's title as its title
  (its short address where it has none, cut to 500 characters), no marks and no
  screenshots, opens it as if it had been chosen from the list, and puts the toolbar up
  adding to it (the "Adding" state, "Done adding"). The panel writes the case, as it
  writes every change to a case but a mark's add; the page's info passes
  `validateCase`. A page no longer creates a case: `case:save` from a page with `isNew`
  is refused, so a case has one creator.
- **No drafts, no new-case mode.** The toolbar always adds to a case (`overlay:show`
  requires its target): its "Save case…", the save form with its title field and "Keep
  drawing", Close, "New case: …" and the panel's "Stop annotating" with its hint lines go,
  and so do `overlay:hide` and the panel's hiding of a new case's toolbar. Home's button
  is always "Annotate this page". Every mark goes into the case when its comment is done
  (DEC-014). A mark that could not be added (the worker unreachable, a number taken, its
  screenshot given up or failed) stays on the page with "Add mark N": a failed write, not
  a draft; one whose screenshot failed says so ("its screenshot could not be taken
  (…)"). The case keeps its marks in the order of their numbers, whatever order they
  went in.
- **Rename where the title is shown.** A quiet "Rename" beside the case's title (named
  "Rename this case") turns it into a field: Enter or Save stores it at once
  (`withTitle`: trimmed, at most 500 characters), Escape or Cancel leaves it, an empty
  title is refused (Save off, "A case needs a title."). The toolbar adding to the case is
  told (`overlay:title`) and says "Adding to “<new title>”"; the list, the export,
  `case.md` and the AI tools read the stored title.
- **An untouched case does not litter.** A case left as "Annotate this page" made it
  goes again, silently, when "← All cases" leaves it (after "Done adding" too) or when the
  last tab with its toolbar closes while it is open. Untouched (`isUntouched`, pure):
  no marks and no screenshots, no mark ever deleted (`lastNumber`), not imported, no
  summary stored or typed, and still the title it was given. It is known from the case
  itself, not from a flag, so it holds across a panel closed and opened again. **A case
  that has once had a mark is the user's** (after the review of PR 57, replacing "Undo
  leaves it untouched"): the toolbar's Undo frees the mark's number and sets
  `lastNumber` to the highest number left (0 for none), as a delete in the panel sets
  it, so a case undone back to empty stays in the list, and a sync file written for it
  always has its case. A rename, a summary or a mark deleted in the panel make it the
  user's too. The check runs in the delete's transaction (`deleteCaseIf`), so a mark an AI
  app adds meanwhile is never lost. **Closing the side panel** leaves the case and its
  toolbar on the page as before; opening it again opens the case. If the tab closes or
  reloads while the panel is closed, the empty case stays in the list until it is
  opened and left, and then goes by the same rule: nothing deletes a case nobody is
  looking at.
- **The sync writes no file for a case without marks** until its first mark: a file in
  Downloads cannot be taken back. A case renamed later keeps its file name in Downloads
  (the name it had at its first mark; DEC-025 as amended), and gets the new name in a
  folder. A case written before whose marks were all deleted is written again, empty.
- **What follows from it.** "← All cases" with a mark still on its way waits for it, and
  with a mark that could not be added stays two-step as DEC-023 has it; with no mark
  left, the case is checked as above. A case deleted while its toolbar is up (Delete in
  the panel, an AI app's `delete_case`, another window) ends that toolbar on every tab
  (`overlay:end` with `discard`), the panel goes to Home, and only a mark lost so is said
  under This page ("“<title>” was deleted, and 1 mark not in it yet is gone with it.").
  The icon's click and the keyboard shortcut are unchanged: on a tab Overmark may not run
  on yet, "Annotate this page" is off with the access notice. Undo right after the first
  mark takes it out; the case stays, empty, and is the user's. A reload or navigation takes
  the toolbar with the page, the panel stays in the case ("Add marks" again); a tab
  switch leaves the toolbar on its tab and the marks follow (DEC-022). The panel draws
  a case on the page once it has a mark: an empty one has nothing to show ("0 of 0
  marks found" is not said). `list_cases` and `get_case` show an empty case with zero
  marks; `add_mark` adds to a case as before.
- **The owner, 2026-11-14: the button is "New case for this page".** "Annotate this
  page" named what one does next and hid what the click does: it always creates a case,
  also on a page that has one in the list, where it read as "continue". The entries
  above and the log keep the old name where they were written with it.
- **The owner, 2026-11-15: Home offers the page's case.** "Hey look, for this page we
  already have a case, do you want to open it? Maybe this is more common than having
  multiple cases for one page." A page's own cases stand under "This page", with the
  sentence "This page already has a case. Open it to go on with its marks, or start a
  new one." For one case, "Open this case" is the view's one amber button (DEC-024) and
  "New case for this page" a plain one under it; for several, each row opens its case
  and no button picks one. The list below holds the cases of other pages under "Other
  cases", so the small "For this page" and "Other pages" headings are gone; the headings
  within a section (Files, Sync) are 13 px bold in ink, where they were 12 px in grey.
- **After the review of PR 57.** *Never delete on doubt:* an untouched case is deleted
  only when every tab in every window has answered that it holds nothing of the case (no
  toolbar adding to it); a tab that does not answer in time, or an `overlay:end` that
  timed out, keeps it (`mayHold`, pure). *The tab clicked for:* "Annotate this page"
  makes the case from that tab's page and shows the toolbar there, whatever tab is in
  front when the page answers; a page that does not answer within 5 s gets "This page
  did not answer. Reload it and try again." and the button works again. *The first
  mark's page:* when a mark goes into a case with no screenshot yet, the case's `page`
  becomes that mark's (address, title, language, viewport), in the same transaction;
  the title is not touched. *A rename* is told to toolbars on every tab, and an add or
  undo under way no longer puts the old title back. *The first mark's draw* asks a page
  busy with the next mark again until it is free, without its busy sentence. *A title
  typed in Rename* and not saved keeps an empty case, as a typed summary does. *Enter*
  ending an IME composition does not save a rename. *A title needs a character that
  shows* (`cleanTitle`): the C0 and C1 controls (U+0000–U+001F, U+007F–U+009F) and the
  bidi embeddings, overrides (U+202A–U+202E) and isolates (U+2066–U+2069) are taken out
  of a title from Rename or a page; titles already stored stay as they are. *A mark
  whose screenshot the page moved away from* is taken again by itself once the page has
  not scrolled or resized for 800 ms and nobody draws or types a comment (5 s at most,
  three times), scrolled back to and given up again if the page moves; only then does
  it wait with "Add mark N". A screenshot that failed still waits for the user. Found on
  the way: a mark added after a delete was refused by the format (`lastNumber` below
  its number); `saveCase` now raises `lastNumber` with the new marks.

## DEC-027: A loaded mark's pin on the page opens its comment there; the panel does the change (owner)

The owner, 2026-11-14, with the toolbar on and marks drawn: "I can't interact with the
marks on the page. Could you show the action buttons and the same overlay that you show
when creating a mark?"

- **The pin is what is clicked.** A press on a loaded mark's pin (the numbered circle)
  opens the popover a new mark's comment is typed in: the pin in the status's colour,
  the status in words when the mark is not open, the comment in a field, "Delete mark"
  and "Done". The mark's shape stays out of the pointer's way: it lies on the page's own
  buttons and links, which must stay clickable. With a tool on, the layer that takes the
  pointer covers the pins, so a press there is tested against where the pins were drawn
  and opens the comment instead of starting a mark; the cursor says so. On the press,
  not the click: the marks are drawn anew at every scroll and twice a second.
- **Done** stores a changed comment; **Escape** drops what was typed; a press beside the
  popover, or another popover opening (another pin, a new mark's comment), keeps it, as
  a new mark's comment is kept. **Delete mark** asks twice ("Really delete?", four
  seconds, no double click), as in the panel. What could not be done is said in the
  popover, which stays with the text.
- **The side panel shows the mark**: its row opens, comes into view and is tinted a
  moment; a filter by a chip ends. Resolve, Verified, Reopen and the findings stay
  there. They need a form or the mark's history, and the panel is the complete,
  keyboard-reachable place for every action; the pins are a shortcut for the pointer
  (they are redrawn too often to hold the focus).
- **The page asks, the panel does** (`mark:picked`, `mark:comment`, `mark:delete`). A
  panel answers only for the case it has open and drew on that tab itself
  (`markAsked`), and changes it as its own buttons do; the worker ignores these
  messages. No panel showing the case: "Open this case in Overmark's side panel to
  change its marks." The price, against DEC-014's rule for `case:undo-add` (a page takes
  back only what it added): a page whose renderer was compromised can, while the user
  has a case drawn on it, rewrite the comment of or delete any mark of that case, where
  before it could add marks to it and read it (CR-06, CR-07). It reaches no other case
  and nothing once the case is closed or drawn on another tab. The owner asked for the
  page to change marks; a stricter variant (the page only picks, every change is made in
  the panel) is one line away and is listed in the open questions.
- The mark adder's own faint copies of marks it saved (shown only after a Hide while
  adding) are not clickable: "Add marks" now draws the case's marks (DEC-023).
- **The owner, the same day: "Would be cool to have the available commands also in the
  overlay of a mark … 'Reopen…', 'Change…', 'Resolve…' etc."** The popover has the
  panel's commands for the mark's status, in its order and with its words: Resolve…
  for an open mark; Verified, Reopen… and Change… for one to verify; Reopen… and
  Change… for a verified or closed one; Delete mark and Done always. Resolve… and
  Change… show the panel's four ways and its optional note in the popover, Reopen…
  its required "What is still wrong?", each with Cancel back to the comment. A comment
  typed is stored before a command acts on the mark; a command done closes the
  popover (the pin's colour says the rest); what the panel refuses is said in the form.
  When the case changes under an open popover, its commands follow the mark's new
  status, a comment being typed stays, and one changed elsewhere shows. This replaces
  "Resolve, Verified, Reopen stay in the panel" above; the findings stay there. The
  page's requests grow by `mark:resolve`, `mark:verify` and `mark:reopen`, done by the
  panel as its own buttons do them, so the price named above now covers a mark's
  status too.
- **Which panel answers, corrected.** The panel that has the case open answers for the
  tab it drew the case on, and also for the tab in front of its window whose page says
  it shows that case, the same two the panel redraws and hides (`redrawLoaded`). A panel
  opened again finds the marks on the page without drawing them, and answered nobody.
  The second is the page's own word: a compromised page in front, which had the case
  before, could say so after "Hide marks" too.

## DEC-028: A case can carry a link (owner)

The owner, 2026-11-15: "It would be great to be able to attach an URL to a case, like a
Jira ticket or so. This URL needs to be editable per case, but normally is just
clickable."

- **One link per case**, optional: `link` in the case (absent: none), at most 2048
  characters. Only an `http:` or `https:` address (`cleanLink`, `new URL`): it is shown
  as a link that opens, so never `javascript:`, `data:`, `file:` or an address relative
  to the panel. A file's case with any other link is refused on import, as a file
  Overmark wrote never has one.
- **In the case view, under the meta line**: the link, short (host and path), opening in
  a new tab with no opener and no referrer, the whole address in its tooltip, and a
  quiet "Edit"; without one only "Add a link". A long address is cut with an ellipsis,
  the panel never widens.
- **Edited as the title in Rename (DEC-026)**: a field with the stored link, Save and
  Cancel; Enter saves, Escape cancels, the Enter that ends an IME composition is the
  composition's. An empty field removes the link; text that is no link keeps the form
  open with "A link starts with https:// or http://". Stored at once; the focus goes
  back to Edit or Add a link. Leaving the case drops an open form.
- **It goes where the case goes**: in `case.json` and the synced file by itself, in
  `case.md` under the page, written as the page's address (an autolink only for a web
  address, else a code span), and in `get_case`. An AI app reads it and cannot set it;
  `list_cases` leaves it out.
- A case with a link is the user's: "New case for this page" left without a mark does
  not delete it (DEC-026).
- **From the review of PR 2.** The link is kept without a user name and password, as
  the page's address is (they would go to the export, the synced file and a connected AI
  app). A text that is an http(s) address but too long as the browser reads it says "A
  link has at most 2048 characters."; the field no longer cuts a pasted address. A link
  being typed and not saved keeps an otherwise untouched case, as a typed title does. The
  link counts as someone else's text for an AI app and in the imported-case notice, as it
  does in `case.md`. A save that finishes closes only the form it was started from.

## DEC-029: The logo: a pen loop round </> (owner)

The owner, 2026-11-15, after many rounds: the amber ring on a dark square was "ok-ish
but a bit boring".

- **What it shows.** A light `</>` on the dark tile with a hand-drawn amber pen loop
  round it: marks on a web page, a tag circled by hand. The loop starts near the top,
  runs counterclockwise once and ends just above its own start.
- **Two drawings.** The full one from 48 px; at 16 and 32 px a simpler one, `< >`
  without the slash and a heavier loop, because `</>` is illegible there.
- **A white tile for dark backgrounds,** with the glyph in ink and the same amber loop.
- **The store's icon** is the full drawing in the middle 96 × 96 of 128 px, with 16 px
  of transparent padding on every side, as the Chrome Web Store asks.
- **One geometry.** It lives in `src/lib/logo.ts`; `bun scripts/icons.ts` draws the
  icons (`assets/icons/`), the store's icon (`assets/store/`) and SVGs (`assets/brand/`)
  from it, and a test fails when a committed file differs from what the script draws.
  The bars on the page show the small drawing's loop alone.
- **The wordmark** is the plain name "Overmark" with a marker swipe over "mark". It
  comes with the store graphics, not in this change.

## DEC-030: Overmark is renamed Sitegloss (owner)

The owner, 2026-11-15: the product is called Sitegloss from version 0.2.0. The reason is
that the old name had namesakes among annotation tools.

- **New name from 0.2.0:** the product, the repository (`ractive/sitegloss`), the site
  path (`/sitegloss/`), the case format (`sitegloss/1`, files `<title>.sitegloss.zip`), the
  databases (`sitegloss`, `sitegloss-sync`, `sitegloss-settings`), the downloads folder
  (`Sitegloss/`) and the AI app's server name (`sitegloss`; the tools keep their names).
- **Nothing is migrated.** Data under the old name is not read, and nothing is forwarded
  from the old addresses; Sitegloss starts empty. 0.1.0 stays as released under the old
  name. The extension ID is unchanged.
- **The icon is unchanged;** the wordmark's swipe now lies over "gloss" (this supersedes
  the wordmark line of DEC-029).
- **The wordmark's letters are outlines,** not text: "Sitegloss" in Inter Bold (SIL OFL
  1.1), the nearest free font to the system fonts the site uses, taken once from the
  font file into `src/lib/logo.ts` with the swipe's geometry. An SVG cannot count on a
  font, and with outlines the swipe covers "gloss" wherever the file is opened, for about
  2.5 KB. `bun scripts/icons.ts` draws `assets/brand/wordmark.svg` and `lockup.svg` (for
  light backgrounds) and their `-light` versions (for dark ones); `assets/store/` gets
  nothing new until the store graphics are made.
- **The fresh start ends two parts of DEC-016:** the removal of setting keys from
  `chrome.storage.local` at every worker start, and the panel's hand-over from its
  `localStorage`. Both served only builds before 0.2.0, and nothing reads either place now.
- **What 0.1.0 stored under the same extension ID stays in the browser** until the
  extension is removed. Only the owner ran 0.1.0, so no current text says so.
- **Current texts do not mention the old name** (the owner, 2026-11-15): it stays in the
  git history, in this entry and in the notes that keep it, nowhere else.
- **Earlier entries, the log and finished iterations keep the old name.**

## DEC-031: The store's key replaces the development key

`manifest-key.txt` now holds the public key of the Chrome Web Store item, so unpacked
builds and the store version share the ID `ldmcfigcnobhnbaigehcaodheklibeon`. This replaces the earlier
development key, which was published with the repository.

## DEC-032: A release publishes itself to the Chrome Web Store, as a CRX we sign (owner)

2026-11-16, after 0.2.0 went public. The owner asked for Sitegloss and tab-mcp for
Chrome to deploy automatically, with Verified CRX uploads, through
ractive/release-workflows, keeping the GitHub attestation (tab-mcp's DEC-190 is the same
decision).

- `release.yml` runs the job `publish` after it creates the release:
  `chrome-extension-publish.yml` of ractive/release-workflows, pinned to a commit, in the
  environment `chrome-web-store` (the owner approves each run). It replaces
  mnao305/chrome-extension-upload; `publish.yml` runs the same job by hand.
- The zip's build provenance is verified before anything is signed, and the CRX wraps
  exactly the verified bytes: the attestation stays the record of what the store got.
- Verified CRX uploads: the item takes only uploads signed with our RSA key (CRX id
  `fhagiknobniheomfcadmfdpanogmpmka`), so the Google account alone cannot publish an
  update. The key lives on the owner's machine, in the password manager and as an
  environment secret; never in the Google account. A secret with another key fails
  before the upload (`signing-key-id`).
- No third-party code where the keys are: the CRX is packed by inline Python (standard
  library, `openssl`), byte for byte Chrome's `--pack-extension`; the API is called with
  `curl`.

## DEC-033: A release publishes itself to Microsoft Edge Add-ons too (owner)

2026-11-17, after Sitegloss 0.2.0 went live in Edge Add-ons, uploaded by hand. The owner
asked for the Edge upload to be automated as well (tab-mcp's DEC-194 is the same decision).

- `release.yml` runs the job `publish-edge` after it creates the release:
  `edge-extension-publish.yml` of ractive/release-workflows (v0.7.0, pinned to a commit),
  in the environment `edge-add-ons` (required reviewer, tags `v*` only), with the Publish
  API's `EDGE_CLIENT_ID` and `EDGE_API_KEY`. `publish.yml` runs it by hand (store `edge` or
  `both`).
- Beside the Chrome Web Store job, not after it: one store's failure or rejection does not
  hold back the other, and each waits for its own approval.
- The same verified zip: its build provenance is checked before the upload, so the
  attestation is the record of what Edge got too. Edge has no signed uploads, so whoever
  holds the API key could upload another zip; the key lives only in the environment and in
  the owner's password manager, and it expires.
- No third-party code in the job: the API is called with `curl`, as for Chrome (DEC-032).

## DEC-034: A Firefox build (owner)

2026-11-17. The owner asked for Sitegloss in Firefox too, after the hosted tab-mcp relay
began to admit Firefox extensions (tab-mcp's DEC-189, since 2026-11-16). That was DEC-003's
reason against Firefox: an installation's origin is `moz-extension://<a UUID per
installation>`, so no list can name one extension; a relay now admits all of them
(`moz-extension://*`, relay 0.11.0 or later) or none. This amends DEC-003: Chrome, Edge and
desktop Firefox (153 or later, the ESR since 2026-07 and the first to tell a message's
`documentId`, which Undo of a mark just added needs; ESR 140's last release was
2026-09-29; not Firefox for Android).

- One codebase. The difference is decided at build time (`SITEGLOSS_FIREFOX`, `--firefox`
  in `scripts/build.ts`, everything in `src/lib/browser.ts`), never by the user agent. The
  add-on id is `sitegloss@ractive.ch`.
- Firefox has no extension service workers, so the background is an event page, and no
  side panel API, so Sitegloss is a sidebar opened by the toolbar icon. Texts say Firefox
  and "sidebar". Firefox stops an idle event page after 30 s, and its WebSocket with it:
  while AI access is on, or a question waits, the background calls an extension API every
  20 s.
- Sync writes to a subfolder of Downloads only (no `showDirectoryPicker`: "Choose a folder"
  is not offered); overwriting replaces the file without a dialog. A notification has no
  buttons and closes by itself: a question's notification says to click the Sitegloss icon
  (which shows "?") and answer in the sidebar; its click only brings the question's window
  to the front, as `sidebarAction.open()` needs a user gesture and a notification's click
  is none in Firefox; its closing is no answer (in Chrome it is Don't allow). The tab's size in the panel is
  read every 3 s while the sidebar shows (no `windows.onBoundsChanged`). For `file:`
  pages there is no button: the user turns on "Access local files on your computer" in
  Firefox's add-on settings, the notice says where, and the panel reads the setting on
  each look at the tab (Firefox does not reload the extension when it changes).
- Firefox's built-in data collection consent (`data_collection_permissions`): nothing is
  required at install (`required: ["none"]`); `websiteContent` and `browsingActivity` are
  optional and asked for at the click that turns AI access on. AI access does not start
  without it and ends when the user takes it back in Firefox's add-on settings. Without AI
  access nothing leaves the computer, as in Chrome.
- The package for addons.mozilla.org (`--firefox --store --zip`) is not minified and has no
  source maps, so that its reviewers can read it; they get the source archive and rebuild
  it. The zip's entries have a fixed time, so the rebuild has the same SHA-256.

## DEC-035: A release publishes itself to addons.mozilla.org too (owner)

2026-11-17, with DEC-034. The owner asked for the Firefox upload to be automated like
Chrome's (DEC-032) and Edge's (DEC-033).

- `release.yml` builds the Firefox store zip and `sitegloss-<version>-source.zip`
  (`git archive` of the built commit) beside the other zips, attests all of them, and runs
  the job `publish-firefox` after it creates the release: `firefox-extension-publish.yml`
  of ractive/release-workflows (v0.8.1, pinned by its commit), in the environment `firefox-add-ons` (required reviewer, tags
  `v*` only), with `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`. `publish.yml` runs it by hand
  (store `firefox`, or `all` for the three stores; `both` is gone).
- Beside the other store jobs, not after them: one store's failure or rejection does not
  hold back the others.
- The same verified zip: its build provenance, and the source archive's, is checked before
  the upload. The job uploads the zip as a new listed version of the existing add-on (the
  first version and the listing are made by hand, as for Chrome and Edge) and attaches the
  source in the same request. addons.mozilla.org has no draft, so a version is always
  submitted for review; the job ends successfully when AMO already has that version
  number.
- The reviewers' notes (what the extension does, how to try it, how to build it) are the
  job's `notes`. Not yet checked: that addons.mozilla.org keeps them with the version
  (see `operations/firefox-add-ons.md`).
- No third-party code in the job: the API is called with `curl`, as for Chrome and Edge.

## DEC-036: "Allow all changes" is also under the top bar (owner)

The owner, 2026-11-17, testing the Firefox build with an AI app: the switch "Allow all
changes" was only in the AI app card, behind the pill "AI on · 1 app", and nothing on
the view the user is on while the app asks says that it exists. It belongs where the
user is: below the top bar.

- Under the top bar, on Home and in an open case, one row for each connected AI app: the
  switch "Allow all changes · <app>" with the app's verified host beside the name it
  gave itself (two apps may give the same name), and while it is on the line DEC-018 asks for
  ("Every change <app> asks for runs without asking you, deleting a case too, until you
  disconnect it."). Above the last AI call.
- Only while AI access is connected and an app is paired: otherwise no app can ask.
  Only apps the card lists, as DEC-018 limits it; the same command to the worker.
- The card keeps its switch, with the tools always allowed and "Ask again". Settings
  shows the card and hides the row, so the switch is never there twice.
- It is set between questions: while one waits, the dialog (DEC-037) is over the panel,
  and its card has Always allow for that tool.

## DEC-037: Questions in a modal dialog, as the tab-mcp extension's (owner)

The owner, 2026-11-17, testing the Firefox build: with a case scrolled down, an AI app's
question appeared at the panel's top, out of sight; one has to scroll up to see it. The
tab-mcp extension had the same and solved it with a dialog over the panel (its DEC-185),
"which turned out to be much better". The owner also asked to take over what else
tab-mcp's panel decided since it took Sitegloss's look (its DEC-160), such as the switch
that is green when on.

Taken over:

- **A modal dialog.** The questions are in a native `<dialog>` opened with `showModal()`:
  in the top layer, at the panel's top wherever it is scrolled to, the rest inert, the
  backdrop the token `--scrim`. It opens with the first question and closes with the
  last. Escape does not close it (the key and the `cancel` event are prevented, and a
  dialog closed while questions wait opens again): a question ends with an answer or its
  60 s. The arguments take the focus (they are focusable, to scroll them by keyboard), so
  no key pressed as the question came answers it. Allow waits as before (DEC-018). A
  short line is said for screen readers, not the card with its arguments.
- **"Stop AI access" is in the dialog too**, under the questions: the top bar's Stop is
  inert under it, and an app that keeps asking must not keep the user from stopping it.
  It refuses what waits. A card whose question ended without the worker saying so (the
  worker stopped, or its timer and the clock disagree) goes by itself, so the panel is
  never held under a dialog that waits for nothing.
- **Focus.** A card answered with others waiting hands the focus to the next one's
  arguments; when the dialog closes, the focus goes back to the control of the AI app
  it was on. A relay address half typed when a question takes the focus is not saved.
- **After the dialog closes, "Allow all changes" turns nothing on for 750 ms**: the second
  click of a double click on the dialog's last Allow lands on the panel under it, where
  DEC-036 put that switch. Not shown (nothing moved); `data-quiet` on the body is for the
  tests.
- **Three answer buttons that look alike** (tab-mcp's DEC-180): Allow is no longer the
  strong button; the card does not nudge towards allowing.
- **The time left** (tab-mcp's EQ 13): the card says "N s left to answer; no answer is
  Don't allow." and a bar at its top drains. The worker sends when the question ends
  (`expiresAt`). Firefox's line "Click into the sidebar to answer" is right under the
  buttons, above the time left: it says why two of them wait (owner).
- **"Allow all changes" is green when on** (tab-mcp's DEC-184), as the connected dot: on,
  it grants. Off is not red: off is the safe side. The AI access switch keeps ink.

Not taken over, for the owner to decide:

- tab-mcp's label "Allow once" for Allow (DEC-018's words are "Allow" and "Always allow",
  in the panel and the notification).
- "Not answered in time: <tool> did not run." for 15 s after a question ran out unseen.
- One notification button only ("Allow once"; tab-mcp's DEC-139: a standing permission
  needs the whole question). Sitegloss's notification has Allow and Always allow.

## DEC-038: A case spans several pages

2026-11-19. The owner asked for it, with the plan for sitegloss.dev: a tester goes
through a feature across pages (the cart, then the payment page) and marks all of it in
one case. Until now a case had one page (`page.url`), though every screenshot already
recorded its own address (DEC-012). How it is done is decided here and is the owner's to
change.

- **The format stays `sitegloss/1`,** and grows by one optional field: `pages`, the
  case's pages in order, each `{ url, title, lang }` with the address as `plainUrl` keeps
  it. `page` stays what it was, the first page with the window and browser the case was
  started in, so a build before this one reads a new file: `validateCase` builds its
  result from the fields it knows and leaves out the rest, and it knew `shots[].url`. Such
  a build shows the first page only and loses `pages` when it stores the case again; the
  screenshots keep their addresses, from which the pages are derived again.
- **Nothing is migrated.** A case stored before has no `pages`; `casePages` reads its
  pages from `page` and its screenshots' addresses. It gets the list with its next mark.
- **Every screenshot says which page it is of.** The two that did not are fixed: an AI
  app's `add_mark` (the page in front), and an import, which now cuts the query off
  the screenshots' and the pages' addresses as it did for `page.url`.
- **A mark on another page adds that page to the open case.** The toolbar adds to the
  open case on whatever page the tab shows (it always did; a navigation ends the toolbar,
  "Add marks" starts it again on the new page), and saving the mark records the page. The
  first mark's page is still the case's first page (a case started on one page and first
  marked on another is that one's).
- **A page is its path, in whatever environment,** as everywhere in Sitegloss (DEC-001):
  a mark added on `localhost:3000/cart` to a case from `www.example.com/cart` is on the
  same page, not on a second one. Two sites' home pages are two pages. One function
  says which page an address is (`pageKey`, see "After the review" below).
- **Pages of another site are allowed.** A flow crosses from a shop to its payment
  provider. Nothing in the code needs one origin: a mark belongs to a screenshot, a
  screenshot has an address, and Sitegloss asks for each site as it always did (the
  icon's click, or the prompt when a case's page is opened). The cost of telling pages by
  path only: two pages of different sites with the same path (other than `/`) count as
  one page. Accepted; a host mapping per case would be the fix, and DEC-001 ruled
  environment settings out.
- **A page leaves the list with its last screenshot** (a mark deleted, an Undo), and
  `page` then follows the first page left. A case without screenshots keeps the page it
  was started on.
- **What is judged per page:** "This page" on Home lists a case for any of its pages. A
  mark without an element is drawn only on its own page (it was already). After a draw on
  one of the case's pages, the marks of its other pages that are not there are "on
  another page", neither lost nor counted ("2 of 2 marks found on …. 1 more is on other
  pages of the case."), and "None of this case's marks were found" is said of the page's
  own marks. On a page that is none of the case's, every mark is looked for as before.
  The size "the marks were made at", and Match size, are those of the first screenshot of
  the page in front. `get_mark_element` looks for a selector, for a mark without an
  element, only on the mark's own page.
- **The case's header** lists the pages of a case that has several, each with its marks
  counted and a link that opens it; a case of one page looks as before.
- **AI tools, additive:** `list_cases` has `pages` (addresses) beside `url`; `get_case`
  has `pages` (address, title, language, marks) beside `page`, each screenshot's `url` and
  `viewport`, and each mark's `page`; `load_case` says each mark's `page` and
  `onThisPage`. `case.md` lists the pages, and says each mark's and each screenshot's page
  where the case has several; a case of one page gives the same file as before.

**After the review of this decision's commit** (2026-11-19, the same day; each point
was a finding, checked here before it was fixed):

- **One rule for "the same page", and it is the server's.** Four rules had grown
  (`samePath`, `samePage`, `isPageUrl`, an exact comparison) and disagreed for a home
  page and for a hash route at `/`. Now `pageKey(url)` alone decides, for the list, the
  counts, "This page", what a draw found, `onThisPage` and the content script: the path
  without the slashes at its end, plus the hash route written `#/…` without the slashes
  at its end; the origin only when both are empty (a home page). It is the function of
  sitegloss.dev (`packages/api/src/v1/page.ts`), and `test/page-key.json` is a copy of
  the server's vectors that it has to pass. So a hash route at `/`
  (`app.example.com/#/cart`) is a page of its own in any environment, a slash at the end
  of a hash route says nothing, and `/demo/` and `/demo/#/` are one page. The price: a
  site's home page on localhost is not its home page on production, anywhere; before,
  a mark drawn on no element showed on any home page once the case was opened there.
- **Pages told apart only by their query are one page.** The query is cut from every
  address that is kept (DEC-009: it carries tokens and personal data), so
  `index.php?route=cart` and `index.php?route=checkout`, or `/product?id=1` and
  `?id=2`, are one page: such a case never gets a second page, and a box drawn on no
  element shows on all of them. Known and accepted; the README says so.
- **A page's short name keeps its hash route** (`x.example/demo/#/book`), which is all
  that tells a hash-routed app's pages apart in the panel and in an AI app's question.
- **When `page` follows the first page left, it takes that page's window** (its first
  screenshot's), not the window of the page that left. A screenshot that named no page
  is given the leaving page's address first, so it does not move with `page`.
- **`page`, the list and the screenshots are made to agree where a case comes in** (an
  import, and the sync): every screenshot names its page (one that did not is of
  `page`), `page` is the first of the list (put there when missing), a page is there
  once. A file can say otherwise and `validateCase` checks shapes only.
- **The list of a started case is built from its screenshots at every save,** so the
  first page of a case from before the list, kept when its last mark went, is not
  written into the list with 0 marks.
- **A round trip through 0.3.0 loses the titles and languages of all pages but the
  first.** 0.3.0 drops `pages` when it stores the case; the pages come back from the
  screenshots, in the screenshots' order, without titles. Accepted: the addresses, the
  marks and their pages are whole. `test/case-0-3-0.ts` is 0.3.0's own case module, and
  a test reads a new file with it.
- **The 201st page is refused before anything is stored,** in the words of the other
  limits ("holds marks on 200 pages, the most a case can"), not by the format's check
  after the screenshot was made.
- **Counting the marks of every page is one pass** (`marksByPage`), not one scan of the
  screenshots per mark and page: a second per render at the format's limits before.
- **`list_cases` names a case's first five pages and says how many it has**
  (`pages`, each address cut to 300 characters, and `pageCount`); `get_case` has them
  all. An entry too large by itself is left out of a list that does not fit and the
  other entries stay, where before nothing was left once the first entry alone was too
  large (an imported case of 200 long addresses emptied `list_cases`). The compact
  `get_case` leaves out each screenshot's `viewport`.
- **A single-page app's next route.** The case stays drawn when the address changes
  within the page (as before: a draw again would drop the candidates chosen), but the
  page in front is another one now. The content script notices (its tick compares
  `pageKey(location.href)`), looks again for the marks that were not there, a few a
  tick and twice more for content that comes after the address, and judges anew which
  mark is on its own page. The panel, when the tab's address is another page than the
  one its numbers are about (or has none: Chrome reports "loading" for a `pushState`
  too, at which the panel drops what was found, so in a real browser the line under
  the case went empty), asks the page for the matches again (`case:matches`) and
  once more a moment later; "found on …", "on another page" and the page list then say
  the same thing. An AI app's `highlight` and `get_mark_element` ask about one mark and
  get it looked for at once.
- **A mark found on another page of the case than its own is never sure.** A flow's
  pages share look-alikes (the same "Continue" button on the cart and the payment
  page). Such a find is drawn dashed, the row says "Also on this page?", it is not
  among the page's marks found ("1 of 2 marks found on …. 1 of the case's other pages
  may be here too (dashed)."), and it does not make up for the page's own marks when
  none of those is found. `highlight` and `get_mark_element` say the mark's page and
  `onThisPage` (`markPage` in `get_mark_element`, where `page` has always been the
  page's size), and `otherPageNote` when the element was read on another page of the
  case. **Narrower than the review proposed, on purpose:** on a page that is none of
  the case's, every mark is looked for and counted as before. A case is loaded there
  by a click, to compare another version of its page under another path (the
  extension's own end-to-end fixture does exactly that, `/v1` to `/v2`); calling every
  find there unsure would make the dash say nothing.

Not done: a toolbar that comes back by itself after a navigation while marks are being
added. The panel keeps the case open and "Add marks" is one click; whether the toolbar
should follow is the owner's to decide (it touches DEC-023 and DEC-026).

## DEC-039: Sign in to sitegloss.dev, and cases sync with a team both ways

2026-11-19. The owner asked for it with the plan for sitegloss.dev, a service of the
owner's (accounts, teams, an API for cases): the extension gets an account, and a
signed-in user's cases sync with their team in both directions. The numbered constraints
are the plan's, given to this work as decided; what is under "Decided here" is this
work's and the owner's to change. This amends DEC-001 ("Forwarding cases to a team is
handled elsewhere") and DEC-007's spirit holds: no new runtime dependency.

**The plan's constraints, as built:**

1. **Local first stays.** Without an account Sitegloss works as before; nothing asks for
   one. Signed in, every action is still stored in the browser first and sent after. A
   server that is away or fails never blocks an action and loses no change: what is not
   sent waits.
2. **No new runtime dependency.** Plain `fetch`, Web Crypto and
   `identity.launchWebAuthFlow` (new permission `identity`; the same call in Chrome and
   Firefox, wrapped in `browser.ts`). The API's types are generated (DEC-040).
   "Version 1 only grows; ignore what you do not know" holds: an unknown field, error
   code or kind of removed thing never fails anything.
3. **Identity of things.** Ids here stay as they are (`m<number>`, `a<number>` before
   DEC-051, and `s<n>`): they say
   where a thing is on this device. At the server a mark and a screenshot have ids of
   their own (`m_…`, `sh_…`), made once on the device that makes them. Which is which is
   in the sync's own bookkeeping, a new database `sitegloss-cloud` beside `sitegloss-sync`:
   the account, the tokens, the team, the team's revision read so far, and per case the
   two id maps, what the server last had of it (its "shadow") and the operations not
   confirmed yet. The case format gains only optional provenance: `user { id, name }` on
   a resolution, a verification, a reopen and a finding, and `createdBy` on a mark, as
   the server writes them down. Nothing here sets them; they survive files, and builds
   before this one leave them out.
4. **Images** go before the operations that name them (`HEAD`, then `PUT` when the team
   lacks one; named by the SHA-256 of their bytes) and are fetched when a case arrives.
5. **Changes are found by comparing, not by hooks.** After any change (the worker's own
   saves, the AI tools, the panel's `cases:changed`) each synced case is compared with its
   shadow, and the difference becomes operations: `case.create` or `case.patch` (title,
   link, summary, pages, the highest number used), `shot.create`, `mark.create`,
   `mark.patch` with only what changed (comment and author; resolution and reopens
   together; findings added, changed or removed one by one), `mark.delete`, `case.delete`.
   They are written down with their `opId` before they are sent, so a reply that never
   came costs nothing. Then the fetch: everything after the revision seen, in pages, and
   the cursor moves on. Sending comes first, always, and a failed send ends the run, so
   nothing waits to be sent while a fetch is applied; a change made here during a fetch
   is kept by merging field by field (what was not changed here since the server last
   had it becomes the server's; what was changed here stays and is sent next). `reset`
   means the server's history is another one: its state is taken whole, but nothing is
   deleted here on its word. What a restored server no longer has (a case, a mark) stays
   in the browser and is sent again, under the ids it had.
6. **Mark numbers.** When the server gives a new mark another number than it was sent
   with, the mark here takes it: its id, its crop's path and the bookkeeping follow, in
   one store transaction. The same when a mark from the team has a number that a mark
   here, not sent yet, holds: the unsent one moves. The pin painted into the screenshot
   (and the crop) keeps the old number: accepted, see the open questions.
7. **Live.** While the side panel is open it listens to the server's events stream
   (`fetch` with a streaming body; reconnects after the server's 15 minutes, and after a
   failure with a wait that doubles up to a minute) and tells the worker of each change;
   the worker fetches when the stream's revision is ahead of what it has seen. The
   worker also syncs at its start (not within a minute of the last sync: a worker starts
   often), when the panel opens, after every send, and on an alarm every 5 minutes. The
   worker is never kept alive for the stream; while a run is under way it resets the
   browser's idle timer every 20 seconds, so a long upload is not cut in the middle.
8. **What syncs.** With a team chosen, cases sync with that team. Cases that were in
   the browser before are not sent silently: a banner above every view says how many
   there are and that the team's members will see them, and offers "Sync them" or "Keep
   them on this device"; a kept case has "Share with team" in its view. A case without
   marks is not sent until it has one. Deleting a synced case deletes it for the team,
   and the button and its tooltip say so ("Really delete for the team?"); an AI app's
   `delete_case` question says so too. A case deleted for the team goes here. Signing
   out stops the sync, keeps the cases on this device only, ends the grant at the server
   and wipes the tokens.
9. **Not an import.** A case that came from the server gets no `importedAt` and no
   `imported` flags of its own (it carries those the server has, which are true of its
   texts).
10. **Permissions and errors.** What the user may do in a team is its `permissions`
    from `GET /me`, never the role's name: sharing needs `case:create`, deleting a synced
    case `case:delete` (the Delete button is off without it), and an operation the user
    may not make is not sent. What the server refuses is said in the Account section, by
    case, in plain words, and is not sent again while it is the same change; "Sync now"
    tries again. `blob_missing`: the image is uploaded and the operation sent once more.
    A 401: one try with new tokens, then "Sign in again", with everything kept.
11. **The panel.** An Account section on Home: signed out, "Sign in to sync with your
    team" with one sentence on what leaves the device; signed in, who, the team (a
    chooser when there are several), the sync's status, "Sync now" and "Sign out". The
    server is chosen there too, while signed out (DEC-041). The folder sync (DEC-021,
    DEC-025) stays and knows nothing of this.
12. **Privacy and stores.** `PRIVACY.md` has the fourth way data leaves the computer and
    what the service keeps; the manifests have `identity`; the listings' changes are in
    the two operations runbooks, for the owner to enter.

**Decided here:**

- **The service worker syncs and holds the tokens; the panel asks.** One place sends, so
  two windows' panels never send a change twice; one place refreshes, one refresh at a
  time, because refresh tokens rotate and a used one ends the grant. The panel's
  messages (`CloudRequest`) are taken from an extension page only, never from a content
  script. The browser's sign-in window is opened by the panel, a page that stays open
  while the user signs in; the PKCE verifier stays in the worker's database.
- **No cookies, ever.** Every request to the server is sent with `credentials: "omit"`:
  the token says who calls. After the sign-in window the browser holds the user's
  session with the server, and the server refuses a request that carries that cookie
  from the extension's origin (403, "Invalid origin"): found with the real window, where
  the token exchange failed until the cookies were left out.
- **The shadow is what the server confirmed, never what is hoped for.** It moves on an
  operation's confirmation and on a fetch, in the form a case here stores things (what
  comes in is cut exactly as `validateCase` cuts it), so "changed here" is a plain
  comparison. Who did something (`user`) is left out of that comparison: only the
  server says it.
- **A crash between two writes costs nothing.** Ids for new marks and screenshots are
  written to the bookkeeping before they are used, in both directions; a mark renumbered
  in the store but not in the bookkeeping is put together with the server's again by its
  drawing. Sent twice, a create is the server's "duplicate", by its id.
- **A refusal is remembered by what was refused** (the operation without its id, hashed):
  the same change is not sent again, another change to the same mark is. As a last guard,
  the very same changes found again three times in a row, though the server took them,
  are not sent a fourth time: the server and this device then disagree on how something
  is written, and sending it again would never end.
- **A case that is here and at the server, with no record of what the server had** (it
  came in from a file exported elsewhere): its marks are matched to the server's by
  number and drawing, the server's copy counts for those, and a mark only here is sent.
- **Signing in again goes on where it was.** The bookkeeping of a case stays when the
  user signs out; the same team later takes it up again, so nothing is sent twice. A
  case the team deleted meanwhile stays on this device.
- **A finding is its app's own only for the person it was written for.** With a team,
  the same AI app is connected to several people's browsers, so `isOwnFinding` also
  asks whose finding it is: Claude for Dana may not rewrite Claude for Tess's.
- **Firefox:** the data collection consent (website content, browsing activity) is
  asked for at "Sign in" as it is at "Turn on AI access", and taking it back signs out.
  The manifest's declaration is unchanged.
- **Tests.** The engine is tested against an API in memory that keeps the server's
  rules (`test/cloud-fake.ts`), also over HTTP for the worker's part. Three suites run
  against a real server when `SITEGLOSS_SERVER` names one: the engine alone, and the
  extension in Chromium and in Firefox, where "Sign in" opens the browser's real sign-in
  window and the test types the demo user's password into the server's page. No test
  build hook stands in for the window.
- **No version bump.** The version is set by a release (as 0.3.0 was); this is a
  feature branch.

**Known limits** are in the open questions (item 10).

**The pages of a synced case** (added 2026-11-19, after the server's review):

- **The list of pages is the server's.** It keeps the list from the screenshots: a
  `shot.create` of a page the case does not have adds the page, a page leaves with its
  last screenshot (the last page of all stays), and which page an address is, is
  `pageKey` on both sides (DEC-038). So the extension sends no list: a new case names
  no pages, a `shot.create` says its address (`shotUrl`) and, in `page`, what the page
  is called (title, language), and no `case.patch` ever carries `pages`. A patch of
  the list replaces the whole list with one device's view of it, and two people
  adding different pages dropped each other's entry.
- **What comes in is taken as sent.** The server's `pages` become the case's `pages`.
  `page` is the first of them, with the window of that page's first screenshot; an
  empty list: the first screenshot's page; without screenshots, what the case had. A
  page only this device has yet (its screenshot is not sent, or was not taken) stays
  after the server's, with its title. A screenshot from before screenshots named their
  page is given `page`'s address first, so it does not move when `page` becomes
  another one.
- **Lengths.** The server counts UTF-16 units where this format counts code points, so
  a text of many emoji within the limit here can be over it there. It is refused as
  any other refused change: said in the Account section with its reason, left out,
  not sent again, and nothing behind it waits (below).
- **What is refused, and what is tried again.** An operation the server rejects
  (`invalid`, `limit`, `forbidden`, `not_found`, `conflict`) leaves the queue, is said
  by case in plain words, and is not sent again while the change is the same; the
  operations after it go. A whole request refused for what it holds (400, 409, 413,
  422) is found out one operation at a time. An image the server does not take (507
  `quota`: the team's storage is full; too large) is said as "An image was not taken,
  so its mark is not shared: …" and not uploaded again at every run. Only what may
  pass is tried again by itself: no network, a 5xx, a 429, and a 401 once with new
  tokens. "Sync now" tries everything once more.
- **What the team sees of a page.** Every page's address (site, path, hash route; no
  query) goes to the team with the case, also a payment provider's or a reset link's
  path. The sign-in text, the question about the cases that were here before, and
  `PRIVACY.md` say so.

**After the review of the sign-in, the tokens and the server chooser** (2026-11-19;
eleven findings, each confirmed with the reviewer's proof before it was fixed; finding 1
is in DEC-041):

- **No request follows a redirect** (`redirect: "error"` on discovery, the token
  request, the revoke, every API call and the events stream). `discover` held the
  endpoints to the chosen origin for the first hop only: a 307 from the chosen server
  sent the refresh token, the code or the API's token on, or brought another site's
  content back as a screenshot.
- **A fetched image is taken only when it is the image named:** its SHA-256 is the name
  it was asked by, its type is `image/webp`, and it is no larger than the API holds
  (30 MiB, read up to that and no further). One that is not, also one the server does
  not have, is not stored; the new mark or screenshot that needs it is left out and
  that is said, and the rest of the case and of the run go on. "Sync now" reads the
  team's whole state again, which brings it once the image is right.
- **Answers have a size.** JSON up to 64 MiB; a page of `changes` over that is asked
  for again with `limit=20` (20 things, or what one request changed when that is more:
  the server never splits a revision). A line of the events stream, and the data of one
  event, up to 64 KiB; one connection of the stream lives 20 minutes and is then made
  anew.
- **A refresh whose answer is lost is asked again in time.** The server rotates the
  token when the request arrives, gives the same answer again for 30 s, and ends the
  grant on a later second use. The stored token is the old one until the answer is
  here, so the same request is sent again after 2, 8 and 18 s before it is given up as
  offline; the worker's own retry (half a minute at the earliest) was the try that
  signed the user out.
- **Only `invalid_grant` is "the grant is gone".** Any other no from the token endpoint
  (`invalid_client` after a bad deploy, `invalid_request`, a 400 or 401 from a proxy) is
  the server's trouble and is tried again with back-off; it marked the account expired
  before, which only a new sign-in cleared.
- **A sign-in that fails after the code was changed for tokens ends them** at the
  server and removes them here: tokens without an account had no "Sign out".
- **Sign-ins under way are kept by their `state`**, so two windows do not take each
  other's secrets. An answer is matched to its sign-in before anything else is read of
  it, also a "no" (`error`); an answer that is nobody's takes nothing away. The panel
  tells the worker when the window closed without an answer (`cloud:abandon`).
- **Sign-out removes the tokens first,** then tells the server (10 s at most) and the
  engine: a run under way ends at its next request and does not hold the click.
- **The server is not chosen while a sign-in is under way** (the chooser is off, and
  the worker refuses), so nobody ends up signed in at one server with the chooser at
  another.
- **`cloud:token` names the server and the team** the stream is of, and the worker
  refuses any other.
- **The question about the cases that were here names the host** on a server that is
  not the service ("… with “Acme” on sync.example.org?"): the team's name is that
  server's word.

**After the review of the sync engine** (2026-11-19; fifteen findings, each confirmed
with the reviewer's proof before it was fixed; the proofs are tests now):

- **A case with no record at the server is never sent blind.** The run is: what waits
  in the queue; the changes of cases the server is known to have; the fetch; then the
  cases without a record, each as `case.create` alone. `duplicate` to that means the
  team has a case of that id (the same file on two devices, or this device's own case
  from a request whose answer was lost): nothing else is sent, the case is read from
  the server by itself (`GET …/cases/{id}`) and the two are joined, and only then what
  the team lacks is sent. Before, every mark was made a second time for the whole
  team.
- **Joining a case with the team's** (an import the team already has, "Share with
  team", "Sync them"): marks and screenshots the team has and this device lacks are
  added here, marks only here are sent, and for a mark both have (the same number and
  drawing) with other words the team's are kept (point 9 above: the server's copy
  counts). Nothing is replaced without the user having been told: a case kept back
  that the team has is said in the Account section, and the question about the cases
  that were here says it too, with the count ("The team already has this case; where
  both differ the team's text is kept: 2 marks"). The count is made from the team's
  marks as last seen (`CaseBook.theirs`).
- **A case can be marked to be read again** (`CaseBook.reread`: a join, a change that
  could not be stored, a case missing here, a book taken up again). Of a join, a
  missing case and a book taken up again nothing is sent before the read; a read that
  fails waits 1, 5, 30 minutes and then 6 hours, and what is wrong stays on the screen
  until it works. "Sync now" reads them at once.
- **A case that fails to apply is not passed by.** The cursor goes on (one case must
  not hold the others), and the case gets that mark; before, the change never arrived
  and nothing said so after the next run. An image the server cannot give, or that is
  not the image named, is that case's matter in the same way: the case is stored
  without the marks that need it, the run goes on, the cursor is written, and the case
  is read again later. (The decision was to skip the whole case; it is stored without
  those marks instead, so one lost image does not keep a case of fifty marks away.)
- **Ids written down before their case is stored are checkable** (`announced`: each
  with its mark's drawing, its screenshot's time). The order stays "ids first, then the
  case", which closes the stop between the case and the book; a stop before the case,
  or a failed write of the case, is closed by taking the ids back (on failure) and by
  taking an announced id only for the mark it was meant for (after a stop). Before, a
  mark the user made under such an id was taken for the teammate's.
- **What an id here stands for is checked before anything is derived** (`relink`): a
  screenshot is the server's only when it was taken at the same time (`capturedAt` is
  kept in the shadow: `s<n>` is given again after an Undo or a delete), a mark only
  with the same drawing on the same screenshot. A mark without an id is put together
  with a mark of the server's that no mark stands for when it has the same number, or
  when that mark's id here is gone or was shown to be another mark's (a renumbering
  whose bookkeeping was not written; the decision asked for "the same number" alone,
  which would undo what `relink` is for).
- **A book taken up again derives no delete from its old shadow** (signed out and in,
  another team or server and back): the case is read whole first, what was deleted of
  it meanwhile and the team still has comes back, and that is said once ("2 marks
  deleted while not syncing are back: the team still has them"). Edits and new marks
  made meanwhile are sent as before. The reasoning is DEC-041's for a whole case.
- **A delete for the team is the user's delete.** Only a case with a record of its
  delete becomes a `case.delete` (first a message to the worker and a note in the
  book; since the re-check the store's own record, see below). A synced case that is merely not in the store
  (its database lost, or made anew) is read from the server again; before, a lost
  database deleted every synced case for the team. Marks have no such record.
- **What never changes of a mark is compared as it goes to the server and comes back**
  (`fixedOf`: the element cut as it is sent, then read as it is received). An element
  whose `id`, `testId` or `role` was longer than the server takes was "another mark"
  at every comparison: deleted and made again, under a new number, for ever.
- **The queue and the book are written in one transaction;** an image that was not at
  the server when operations from the queue were sent (they have none at hand) is not
  held against the case: the same run's look at the case has the images.
- **Refusals:** a book's refusals go when a fetch leaves the case as the server has it
  (a change to a mark a teammate deleted was said for ever). When a case has as many
  refusals as are kept (50), nothing more of it is sent and that is said, instead of
  sending the ones that fell off the list again in turns.
- **A case that cannot be sent is passed by** until it or the role changes
  (`CaseBook.idle`, with what there is to say about it), and what is held back or not
  allowed is found out before any image is read (an operation's key no longer hangs
  on its image). A new case goes alone before any of its images is read. A run with
  nothing to do reads the cases once and the sync's database once; the progress
  while sending reads nothing again. A worker's start looks at when the last sync was,
  whatever came of it. Not done: keeping each image's SHA-256 in the book (it would
  grow with every image; with the above no image of a case that cannot go is hashed,
  and one that can is hashed when it is sent).
- **A form open on a mark follows that mark** (`markKey`: when its screenshot was
  taken, and its drawing), and a change made in the panel is held to the mark it was
  opened on in the same transaction that writes it. The team's sync can give a mark
  another number while its form is open, and the id it had is then a teammate's mark.
- **The server in memory holds every request to the API's JSON schemas**
  (`src/lib/cloud/openapi-v1.json`, with `ajv`, a dev dependency for the tests alone)
  and to the limits of one request, so the contract is met in every test run and not
  only against a real server.
- **Notes are no problems** (`CloudStatus.notes`): a case kept on this device whose
  id the team names, and marks that are back after a time without syncing, are told in
  the Account section in plain text, do not make the state "problem", and so give no
  reason to look at the server more often. A problem is something that did not go.
- **A cursor of 0 is a revision like any other.** (For a few commits it was read as
  "none", because the server answered `since=0` as the whole state, which names no
  deletes. The server answers it properly now, and the special case made an empty team
  read whole and say "syncing" at every run.)

**After the re-check of both reviews** (2026-11-19):

- **A delete is on record in the case store, written with the delete itself**
  (`CaseStore.deletedCases`), in place of a message to the worker and a note in the
  book: the note waited behind a run under way, and a note that was not written undid
  the delete without a word. Every delete path records it without knowing of the sync;
  the panel's Delete and `delete_case` return at once; there is no time limit. The
  engine sends `case.delete` for a synced case that is gone and has a record; a book
  taken up again honours only a delete made since (a case deleted while it did not
  sync has no book any more and comes back, DEC-041; what records there are leave
  when the book is taken up, so no times are compared). A record leaves when it was taken
  up, when no book here could need it, or after 30 days; a case stored again under the
  id takes it away. Each record the store writes takes those older than 30 days away
  in its transaction, so they do not pile up for someone who never signs in (no
  engine run forgets them then). The records are kept in the `images` object store under a key no
  case's images can have (`!deleted/<id>`), not in a store of their own: a new store
  needs a new version of the database, which an older build can no longer open, so a
  rolled-back release, or the main branch on a profile this branch has used, would
  find no cases at all.
- **A join nobody was told about stops when it would replace text.** A case that is to
  be the team's and that the team turns out to have (the server answers `duplicate`,
  or the fetch brings it) is joined at once when no mark both have says something
  else here. When one does, the case goes back to the question, which then says the
  count; "Sync them" after that joins.
- **A mark is held to by its screenshot's time and its drawing wherever its id is held
  across a wait:** the panel's form and its "Really delete?", the popover on the page
  (it follows its mark to its new number, and its requests name the mark), an AI
  app's change the user was asked about (refused when the number is another mark's by
  the time they answer), and `highlight` and `get_mark_element` (the page answers
  "not loaded as you have it" and the case is loaded again). Twins (the same element
  marked twice on one screenshot) have nothing else that tells them apart, so their
  key also names the ids all twins had when it was taken: while those ids stay, each
  twin is its own and can be changed; once a renumbering moves any (or a twin is made
  meanwhile), the key names no mark, and nothing is changed and that is said. (Asked
  for: "ambiguous whatever the ids say" for twins; that would refuse every change and
  delete of either twin for good, also in the panel.)
- **A screenshot's time is compared as it is sent, as an instant;** every id that
  stands for another mark of the server's than before is announced, not only new ones,
  and after a stop the book is made true to the case with `relink`.
- **A renewal of the tokens gives up when a sign-in or a sign-out happened while it
  waited** (a generation in `Session`), throws its answer away and ends that answer's
  grant; a sign-in is "finishing" from its answer to the written account; the
  discovery document, the token endpoint's answer and an error's body are read up to a
  megabyte; a case too large to read by itself waits with its own back-off.

## DEC-040: The API's types are generated, with TypeScript 5 for the generator alone

2026-11-19, with DEC-039. `src/lib/cloud/api.gen.ts` is generated from a copy of the
server's OpenAPI document kept here (`src/lib/cloud/openapi-v1.json`) by
`bun scripts/api-types.ts`; both files are committed, so a build and CI need neither the
server's repository nor the network. A test fails when the two disagree.

The generator is `openapi-typescript` (a dev dependency, pinned; nothing of it is in the
extension). It builds its output with TypeScript's compiler API, which TypeScript 7
(this repository's, the native compiler) no longer has, so it does not run here as it is
installed. Bun has no way to give one package another version of a peer dependency, so
TypeScript 5 is a second dev dependency under the name `typescript-5`
(`npm:typescript@5.9.3`), and the script bundles the generator with `typescript` pointed
at it. When `openapi-typescript` runs on TypeScript 7, `typescript-5` and the bundling
go. The alternative was a generator of our own for the part of OpenAPI the document
uses; rejected for now because the plan named the tool, and because the document will
grow.

## DEC-041: The server is chosen from three, and each server's state is its own

2026-11-19, with DEC-039, asked for by the owner while it was built. There are two
servers: the service (`https://app.sitegloss.dev`) and its development server
(`https://app.dev.sitegloss.dev`, which may become `https://app-dev.sitegloss.dev`).
Both addresses of the second are known, in one module with the first
(`src/lib/cloud/servers.ts`); the chooser sets the first of them, and either is named
"Development server".

- **A chooser, folded away.** "Server" in the Account section, shown while nobody is
  signed in: "Sitegloss (app.sitegloss.dev)", "Development server", "Another
  address…" (a field: https, or http on this computer only). Whoever never opens it
  signs in to the service and is never asked. The server is chosen before signing in
  and can be changed only while signed out: another server is another account.
- **Not the service: said in words.** Whenever the server is not the service, the
  Account section says so beside the account and before the sign-in ("Development
  server (app.dev.sitegloss.dev): not the real Sitegloss", "Another server
  (localhost:3200): not sitegloss.dev"), so nobody takes test data for real or the
  other way round.
- **Everything the sync keeps is kept per server.** The cloud's database holds one
  entry that is nobody's, the server chosen; every other key is under the server's
  origin (`@<origin> <key>`, `scopedKv`): the tokens, the sign-in under way, the
  account and team, how far the changes were read, the queue of operations, the
  status, each case's book (which mark here is which there, what the server last
  confirmed) and so each case's local-only flag. The worker has one engine and one
  session per server and uses the chosen one's. So a case synced with the development
  server is never sent to the service by a switch, and switching back finds what was
  there: the same marks at the server, no second copy.
- **A case another server has is on this device only here, until shared.** At a
  sign-in, the cases that were here before are asked about in one go (DEC-039, 6);
  the ones that synced with another server are left out of that question and are
  "This device only" for this server. "Share with team" on such a case sends it,
  that one case, because the user said so. The alternative, asking about all of them
  together, makes one click on "Sync them" copy a team's real cases to a test
  server.
- **A case deleted while signed out is not deleted for the team by signing in.** The
  book of such a case is dropped at the sign-in and the team's copy comes back with
  the next read: with several servers, deleting a case while with another one is
  ordinary, and nobody was told it would delete anything elsewhere. The same for a
  case deleted while the sign-in had run out: the panel says "from this browser"
  then, so the engine notes which deletes were on record when it ran out
  (`Account.liveDeletes`) and forgets every later one at the next sign-in; the case
  comes back. Only a delete made with a live sign-in, of a synced case, is sent.
- **Where a server signs people in is what it says itself.** The authorization, token
  and revocation addresses are read from the server's discovery document
  (`<origin>/.well-known/oauth-authorization-server/api/auth`, RFC 8414) at each
  sign-in and kept with that server's tokens for the renewals; no path of them is
  written in the extension. A document whose issuer is not `<origin>/api/auth`, or
  whose addresses are not at the chosen origin, is refused ("… does not answer as a
  Sitegloss server"): the password and the tokens go to the address the user chose
  and nowhere else. A server that names no revocation address is only forgotten here
  at sign-out. The client id (`sitegloss-extension`), the scopes and the redirect
  addresses are the same for every server.
- **A case kept on this device is not the team's because a server names its id**
  (review B, finding 1). An id is no secret: it is in every export, every connected AI
  app reads it, and every server and team the case was shared with has it. Before, a
  case in `changes` with the id of a case here was merged and adopted whatever its book
  said, so a server (or a teammate who imported the same file) got the marks and
  screenshots of a case the user had kept local, or of another server's case. Now a
  case here whose book for this server is `local` or `undecided` is neither merged nor
  adopted: it is skipped, the book notes it (`theirs`), and the Account section says "…
  is on this device only, and the team has a case with the same id. … “Share with
  team” on the case joins the two." Sharing (or "Sync them") then reads the team's copy
  first, so the same marks become one, and sends what the team lacks. A case without a
  book here (made or imported since the sign-in) is the team's as before.
- **A mark keeps its identity at one server when another renumbers it.** Marks are
  `m<number>` here (`a<number>` before DEC-051), and a server's numbers count while with that server; the other
  servers' books are not told. A book entry whose mark here has another drawing than
  the server's mark is therefore dropped, and the server's mark finds its own again by
  its drawing (`relink`), instead of being deleted and made anew.
- **Tested** in `test/cloud-worker.test.ts` ("each server is kept apart") with two
  servers in memory: a case synced with one never reaches the other, the first is
  not asked anything while the second is chosen, its tokens go nowhere else, and
  back at the first the case goes on with the marks it had.

## DEC-042: One MCP address for every installation, tab-mcp client 0.18 (owner)

2026-11-20. The hosted relay `tab-mcp.ractive.ch` moved to relay 0.12.0, which has one
fixed MCP address per app and refuses clients before 0.17.0 (tab-mcp's DEC-196 to
DEC-198): an organisation that allows custom connectors only by one exact URL can then
allow Sitegloss. Installed copies lose AI access until an update with client 0.17 or
later ships. The owner asked for the update on the 0.3.0 line, with client 0.18.1.
(Numbered after DEC-038 to DEC-041, which are on the `cloud-sync` branch, so the
numbers stay unique once both lines meet.)

- **The address** is `<relay>/s/sitegloss/mcp`, the same for every installation, the
  Firefox build's too. Sitegloss names its app, `app: "sitegloss"` (`APP_ID` in
  `src/worker/protocol.ts`), rather than leaving the library to derive it from the
  server's name, so that renaming the server cannot move the address. The pairing code
  alone says which installation an AI app is paired with.
- **The Firefox build shares the app id.** A relay may reserve an app for listed origins
  (tab-mcp's DEC-197); no list can name one Firefox extension, so on a relay that
  reserved `sitegloss` for the Chrome origin the Firefox build would be refused
  (`app_not_allowed`). The hosted relay reserves only its sign-in example's app, so
  `sitegloss` stays open to the Chrome, Edge and Firefox builds. Should it ever be
  reserved, the Firefox build needs an id of its own (as tab-mcp's extension has
  `tab-mcp-extension-firefox`), and its users pair again.
- **Every pairing from before is gone.** The relay knows an installation by its app id
  and its secret together and deleted the tokens of the old addresses; the secret
  itself stays under its key. Users remove the old connector (`<relay>/a/<id>/mcp`)
  from their AI app, add the new address and pair again. Always allow and Allow all
  changes go with the old grants (DEC-018).
- **The code** is 8 letters, shown as the relay sends it, `XXXX-XXXX`; it was shown as
  two groups of three characters. It is typed with or without the dash. A code has no
  attempts of its own any more (no `locked`); Sitegloss never showed that reason.
- **"New address" is "Disconnect all apps"**, as in the library's dialogs and tab-mcp's
  extension. It still disconnects every AI app and makes a new secret (the library's
  `newAddress()`, DEC-017); the address stays, and each app pairs again with a new code.
  The takeover notice and the status say Sitegloss's *connection* is in use elsewhere,
  not its address, since everyone has that address.
- **Relays before 0.12.0 do not work** with this version, also as a relay the user
  entered; the README's local relay is `ractive/tab-mcp:0.12.0`. The worker's handling
  of relays before 0.10.2 (a revoke's error that names no grant) stays: it is harmless
  and goes with a later clean-up.
- **Client 0.18 changes nothing Sitegloss uses yet.** Its allowances of its own
  (`alwaysAllow`, `allowedTools`, tab-mcp's DEC-200) stay unused: Sitegloss keeps
  Always allow and Allow all changes itself (DEC-018) and answers every question in
  its `onConfirm`; with nothing allowed in the library, every call that changes
  something still reaches it. Moving onto `allowedTools` is later work.
- Not in this change: filling in the code on the relay's `/authorize` page from the
  extension after asking the user (tab-mcp's DEC-199).

## DEC-043: Always allow and Allow all changes are the library's allowances (owner)

2026-11-20. The owner asked for Sitegloss's own Always allow store (DEC-018) to give way
to the tab-mcp client library's allowances (`allowedTools` of
`@ractive-ch/tab-mcp-client/allowed`, client 0.18, tab-mcp's DEC-200), which keep the
same thing: per AI app (grant) the tools that run without asking, and a switch for
everything.

- **One store.** The library keeps them in the `storage` Sitegloss already passes it,
  under the secret's key with `#allowed` (`tab-mcp:secret:<relay origin>:sitegloss#allowed`,
  in the worker's IndexedDB through `CachedSecretStorage`, out of content scripts'
  reach as before, DEC-016): grant ids, tool names, the title and description the user
  saw, a fingerprint of the secret; no arguments. `src/worker/always.ts` is a thin
  wrapper in Sitegloss's words ("Always allow" is `allow`, "Ask again" `ask`, "Allow
  all changes" `everything`). Sitegloss's key `alwaysAllowed` is removed at every
  worker start and nothing in it is taken over: its grants ended with client 0.17's new
  addresses (DEC-042), so it holds nothing that could still apply.
- **Honoured first.** The library checks an allowance before it asks `onConfirm`, so an
  allowed call runs without Sitegloss's question and the "Last AI call" still records
  it. Every other call that changes something still reaches `onConfirm` and asks, in
  the panel or a notification; `decide` keeps its own check for a call allowed while
  its question was on the way, and refuses WebMCP and served ports as before. The
  library's `alwaysAllow` option stays unset: Sitegloss never shows its dialogs.
- **Where the library differs, it wins**, and the texts say so:
  - An allowance ends with its grant as the relay reports it: Disconnect, Disconnect
    all apps (the new secret ends them all), or the grant expiring. That is what
    `keepGrants` did; a dropped connection or Stop AI access keeps them, as before.
  - A tool allowed one by one asks again once its title or description changed, for
    example after an update of Sitegloss. The question's line and the README say so.
    "Allow all changes" covers every tool, also changed and later ones.
  - "Ask again" for one tool while "Allow all changes" is on turns that off too (asking
    again errs towards asking). Its tooltip says so.
  - Nothing is kept for an app that is not connected (as `decide` already did for
    Always allow), and "Allow all changes" cannot be turned on for one either.
  - A write to the database that fails no longer shows "Always allow could not be
    saved": the library keeps the allowance in memory and the cache logs the failure.
- What the user sees is otherwise the same: Always allow in the question and the
  notification, the card's list with "Ask again", and the switch under the top bar
  (DEC-036).

## DEC-044: Sitegloss fills in its code on the relay's pairing page, after asking (owner)

2026-11-20. The owner asked for tab-mcp's DEC-199 in Sitegloss: when an AI app opens the
relay's `/authorize` page in the browser Sitegloss runs in, Sitegloss asks its user and,
on a yes, fills in its own code there. Typing the code stays the way that always works
(another browser, profile or device, or a user who says no).

- **No new required permission.** A new host permission in the manifest would make
  Chrome disable the extension on update until the user accepts it. The manifest
  already has the optional `<all_urls>` (DEC-022); one site of it,
  `https://tab-mcp.ractive.ch/*`, is asked for by itself with a click on "Allow on that
  site" under the pairing code (`permissions.request`, as `askForSite` does). Chrome
  then asks "Read and change your data on tab-mcp.ractive.ch". Without it Sitegloss
  cannot see the page, and nothing changes. Whoever allowed all sites has it already.
  `scripting`, `tabs` events and `notifications` were there before.
- **Only the hosted relay's page.** The tab's URL must have the origin
  `https://tab-mcp.ractive.ch` exactly and the path `/authorize`, Sitegloss's relay
  must be the hosted one, AI access must be connected, and the script runs in the
  tab's top frame only. Of the page it reads only the form's hooks (version 1): exactly
  one `form[data-tab-mcp-pairing="1"]` with exactly one `data-tab-mcp-field="code"`
  input and one `data-tab-mcp-action="connect"` button, and its `data-app`, which must
  be `sitegloss`, `data-client-name` and `data-client-host`. A page not as documented
  gets no question. The listener is added by the connection while the worker runs, not
  at its top level, so no page load wakes the worker.
- **The question is Sitegloss's own**, under the top bar on every view: "<name>
  (<host>) wants to connect to Sitegloss on the relay's page in this browser. Fill in
  the code there?", the name and host as the form gives them, escaped as in the
  questions and set as text. "Fill in the code" counts only once the panel has been in
  front for 750 ms, as Allow does; "No" ends it. It ends by itself after 2 minutes (a
  code's life), when the tab leaves the page or closes, when AI access is no longer
  connected, and when a newer pairing page replaces it. With no panel on screen, a
  notification says to click the icon and answer in the panel (it has no buttons: an
  answer is given in the panel only), and the icon counts it as a question ("?").
- **The fill-in.** On a yes, Sitegloss checks that the tab still shows the pairing page
  and that the form still names the same app and host, turns pairing on for 2 minutes
  if no panel had it on, types the current code into the code field (with an `input`
  event) and clicks Connect. The code is passed only to that script and written only
  into the field: no attribute, no log, no message. If anything is off, the panel says
  Sitegloss could not fill in the code and to type it.
- **Chromium and Firefox** share the code (`tabs.onUpdated`, `scripting.executeScript`,
  `permissions.request` all exist in Firefox's MV3). The end-to-end test runs in
  Chromium only: Firefox's suite drives its sidebar through a tab and has no test of it.
- **Tested** against a fixture with the relay's markup (`test/pair-fill-page.ts`, relay
  0.12.0's `oauth/server.ts`): the testing package's relay cannot show its form for a
  test client, since it fetches an AI app's metadata over HTTPS. The test build takes
  the fixture's origin from `siteglossTestFillOrigins` on the worker's global; other
  builds drop that.
- **After review (2026-11-21), against tab-mcp's DEC-203 (the review of its pull request
  177 found nine weaknesses in the version it took from Sitegloss).** What applied is
  fixed; the rules of the question and the fill moved from the connection into
  `src/worker/code-filler.ts` (`CodeFiller`, the shape of the client library's coming
  `CodeFiller`, tab-mcp's DEC-206, which Sitegloss can take once client 0.19 is out).
  - **A setting of its own, off by default.** "Fill in the code for me" under the pairing
    code turns it on (and asks for the relay's site when Sitegloss does not have it, as
    "Allow on that site" did); "Stop filling in the code" turns it off, withdraws a
    question that waits, and gives the relay's site back unless the user gave access to
    all sites, which is not this feature's. Off, no page is read. Kept in the worker's
    IndexedDB (`fillCode`). Access to all sites, or the site allowed in 0.3.0, no longer
    turns it on: a user upgrading from 0.3.0 finds it off. The first start of this version
    stores the setting off and gives back the relay's site that 0.3.0's "Allow on that
    site" granted, unless the user gave access to all sites (`settleFillCode`); the
    setting is written first, so this happens once and never takes a grant given later.
    Turning it on again asks the browser for the site once more.
  - **Bound to the request.** The form must carry the relay's hidden `request_id`, and a
    yes fills in only the same tab, at the relay's origin and path, with the same app, AI
    app and request id, checked again in the page by the page's function itself (its own
    `location` and `window.top`), after the code came. A tab that moved on meanwhile
    (an opener can send a tab it opened to a look-alike page), or a new request of the
    same AI app in that tab, gets nothing. Sitegloss never fills in without a yes, also
    not the relay's wrong-code page (the same form again): that page load asks again.
    tab-mcp's one unasked retry is therefore not needed here.
  - **Withdrawn at once** when AI access is no longer connected (as before), when the
    setting goes off, and when another relay is set (the old connection's events are no
    longer heard then, so the question used to stay). A yes whose code is still on its
    way fills in nothing once withdrawn or once its tab left the page (each judged by its
    own page's origin). Stop AI access, Stop filling in the code and another relay
    withdraw on receipt, before the panel's queue of commands, and the yes does not hold
    that queue while it waits for its code (up to 10 s), as Disconnect does not: else
    the code was typed and the AI app connected before the Stop ran (review of the pull
    request).
  - **One page, one question, one fill.** A new document in the question's tab ends the
    question, also when it gets none (an expired request, a form for another app, the
    site taken away), and withdraws a fill there that has not started; a reload of the
    same request asks again and fills once, never twice.
  - **Which code.** The current code when it has 5 s left by this computer's clock (or
    an end it cannot read); else the next one the relay sends; if none comes within
    10 s, the current one after all, so a clock that runs ahead never keeps a code from
    being filled in. Pairing is held on from the yes until 30 s after the fill (was 2
    minutes), also when Connect's own post leaves the page.
  - **One question at a time, nothing dropped unseen.** A pairing page in another tab
    while one question waits is not asked about; the panel says that it also opened and
    to answer first and reload it, or type the code (it used to replace the waiting
    question silently), for as long as that question can be answered at most. While only
    a fill is under way, it says so instead, for 20 s. The same tab loading a pairing page again replaces its question
    with a new id, so the wait before "Fill in the code" counts starts again.
  - **The verified host first.** The question says "An AI app at <host> (it calls itself
    “<name>”) wants to connect…", the notification "Connect an AI app at <host>?": a
    name can say anything, "Claude (claude.ai)" too. A form with no name is asked about
    by its host alone.
  - **The wait before a yes counts from the panel coming in front**, as Allow's does
    (`armed` in `src/sidepanel/card.ts`, shared by both): it counted from the question
    being shown, so a question that had waited unseen took a click the moment the panel
    was focused.
  - **What did not apply.** No port to close and no messages to check: the page sends
    the worker nothing, the worker reads and fills by `scripting.executeScript` into the
    tab's top frame, after checking the tab's address against the hosted relay's origin
    exactly (port included) and `/authorize`, and the form's `data-app`. The code is
    shown as the relay sends it, `XXXX-XXXX`.
  - **Only the hosted relay, as before.** A relay entered in the panel's Relay field gets
    no fill-in and no offer: its pairing page may be another version, and its site is
    one more host Sitegloss would ask to read and change. tab-mcp's extension follows its
    configured relay; Sitegloss can, once the library's `CodeFiller` takes the relay's
    origin as given.
  - Tested in `test/pair-fill.test.ts` (the page's functions on look-alike origins, ports,
    paths and frames, without a request id or with another; which code, with a clock an
    hour ahead, the wait timed by that clock; `CodeFiller`'s rules, also the ones from the
    review of the pull request), `test/connection.test.ts` (off by default with access
    to all sites, on and kept, off withdraws and gives the site back, Stop AI access and
    another relay withdraw, a yes fills in the code the card shows; each of Stop AI
    access, Stop filling in the code and another relay while a yes waits for its code
    fills in nothing; the upgrade's one give-back, `settleFillCode`),
    `test/e2e/pair-fill.test.ts` (off by default, turned on with the panel's button, the
    verified host first, a second page not asked about and said, turned off), and
    `test/card.test.ts` (`armed`). The
    fixture now has the relay's `request_id` (it had a field of another name).

## DEC-045: Home in four parts, the sync's state in words, the step after pairing (owner)

2026-11-20. The owner's first test of 0.3.0 against the service: sign-in and live sync
work; the panel's guidance does not. Four points, settled here (open question 10 (h)
with them).

- **Home reads in order: This page, Cases, Team, Files.** Each is a section with its
  own heading of the same level (`h2`), as a newcomer reads them; under Files the
  copy to a folder has its own `h3`. Before, Files, Account and Sync were small headings
  under Cases, which read as parts of the case list, and two things were called sync.
  The account stays on Home, not in Settings: it says what happens to every case, and
  its status line belongs where the cases are. Its heading is "Team", as that is what
  it is about (who is signed in, the team, the sync with it). The copy of every case
  to Downloads or a folder is "Copy to a folder": "Copy to Downloads", "Copying to …",
  "Last written …", "Stop copying", and its banner and the icon's tooltip say "The copy
  to a folder is paused/failed". "Sync" now only means the team's.
- **The status line says the state, not a time.** From the worker's last run (its
  state, and `waiting`: the cases with changes the team does not have yet and that can
  go, counted in the engine's status) and from this panel's events stream (open or
  not, `listen`'s `onConnected`). "Up to date. Changes sync as you work." only while the
  stream is open and nothing waits; "Syncing…"; "2 cases wait to be sent.";
  "Offline: changes are kept and sync when the server can be reached." with what
  waits; "Last synced 5 minutes ago." while the stream is being opened, and with "The
  team's changes are not coming in live right now: they come at the next sync, or
  with Sync now." once it has been closed for more than 10 s (the server ends a
  stream every quarter of an hour and it is open again within seconds, which is no
  news). A time is relative ("just now", "5 minutes ago", "on <date>" after a day),
  said anew each minute. "Sync now" is there only when it can do something: something
  waits, a refusal to try again, no live changes, or no team yet; not while it syncs or
  is up to date. A server that stops gracefully keeps its open streams: the panel then
  says up to date until its next run finds it offline, which is true of the stream.
- **After pairing: what now, and the way back.** When an AI app pairs while the card's
  pairing box shows (also when the connection drops meanwhile and the app is listed
  only once it is back), the card says "<app> is connected." with what to ask it ("Look
  at the Sitegloss case open in my browser and fix its marks") and that it asks before
  changing a case unless all changes are allowed, and a strong button back: "Back to
  the cases", or "Back to the case" when the card was opened over one. Said once: it
  goes when the card is left. The card stays open after pairing rather than going back
  by itself: what one sets right after pairing (Allow all changes, Disconnect) is
  there, and a view that changes under the user while they read is the confusion the
  owner had. The button makes the way back as plain as the confirmation.
- **The team's web app in front.** When the tab in front is at the origin of the server
  the account is signed in to, Home's "This page" and an open case's tab section say
  "This tab is your team's web app at <host>: it shows the same cases as this panel."
  Only that origin (the service's pages are not the development server's web app), and
  only where the panel knows the tab's address: with no access to the tab, no
  permission is asked for this. Nothing else changes there; marking the web app itself
  stays possible.
- **After review of the pull request.** The time's words change in place each minute:
  the Team section is drawn anew only when what it shows changes, so the focus stays
  and the live region does not say the section again. The pairing note is held to its
  app: said only when the pairing ends in the open card, and gone as soon as that app
  is disconnected or AI access is off. With "Sync now" hidden while up to date, the
  panel being shown or focused asks the worker to look at the account's teams again
  when that was more than a minute ago (`cloud:check`): one request, at most once a
  minute from the panel, nothing on its answer starts another; only a change (a team
  joined or left, a role) is written, said, and followed by a run. The count of what
  waits holds a case back exactly as sending does (the same test, with the role's
  permissions), so a role that allows again says "waits" before it is sent.
- **Tested** in `test/view.test.ts` (Home's headings in order; the status line's
  states and Sync now; the web-app line, by origin; the pairing note and its way back),
  `test/cloud.test.ts` ("the status line, from the engine's real states": up to date,
  closed stream, offline with one case waiting, syncing, and what does not count as
  waiting), `test/cloud-auth.test.ts` (the stream says open and closed), and
  `test/card.test.ts` (`pairedSince`). Seen in the real side panel against a local
  server, before and after, with the stream dropped and the server gone.


## DEC-046: A case's thread, closing a case, and the person beside the app

2026-11-20. Extension 0.3.1, with the server of sitegloss.dev 1d50d8c (its DEC-017 to
DEC-019 and `kb/design/extension-0.3.1-handover.md`). Everything is additive: the file
stays `sitegloss/1`, and a 0.3.0 browser on the same team keeps working.

- **The thread.** A case has `comments`, oldest first in the server's order of arrival:
  `{ id, mark?, markGone?, text, at, user?, app?, edited?: { at, user?, app? },
  imported? }`. A comment is about the case, or about one mark (`mark`, the mark's id in
  the case, as everything else in a case names a mark; the handover's `markNumber`
  would break when marks are renumbered). A comment on a mark that is deleted keeps
  its text and says so (`markGone`). The id is of the writer's making (`k_…`) and is the
  server's id too, so a comment is the same one on every device without a map; a
  "Keep both" import gives the copy's comments new ids, as the original's are taken.
  At most 1,000 comments of at most 20,000 characters, as the server allows.
- **Whose comment.** One's own is one with no person (written here, not synced yet) or
  the person signed in; a synced comment whose writer the server no longer names
  (`writerGone`) is nobody's. The panel changes and deletes only one's own, also in a role
  with `comment:moderate`: moderating is the website's. An AI app changes only a
  comment of the same person written through the same app (by its id), as the server
  requires; a comment from a file is no app's own (`imported`, as findings, DEC-019).
  A comment not one's own that is missing here is never deleted for the team, and one
  whose text differs here is never patched: a lost or changed local copy is not a
  decision. Its text is the server's again at the next merge, and it does not hold
  the case as unsent. Editing to the same text changes nothing.
- **Sync.** `comment.create`, `comment.patch` and `comment.delete`, queued and sent like
  any op. A create waits until its mark has a wire id. A removed comment arrives
  without a `caseId` (so that 0.3.0 passes it by); the engine finds its case by the
  comment ids it holds. Read whole, the thread takes the server's order; between whole
  reads a changed comment keeps its place here. A server restored from a copy that
  lacks comments gets them sent again (the shadow forgets what the server lost).
  Comments only here that would take a merged case past 1,000 are parked in the book,
  unsent, with a problem line, and go back into the case when there is room: the
  merge never fails on them.
- **Closed.** `closed: { at, user?, app? }` on the case: filed away, not frozen. Sent
  as `case.close` / `case.reopen`, never as a field of `case.patch`. A reopen goes
  before the run's mark ops and a close after them, so a mark added to a case being
  closed does not leave it open at the server. A new open mark (saved by hand or by an
  app), or a mark reopened, drops `closed` here as the server does there. Closing needs `case:close`; the
  button is disabled with a reason in a role without it. The panel lists closed cases
  under "Closed", folded, after the others, and not among the page's own cases.
- **The person beside the app (`via`).** What a paired AI app changes through the
  extension's tools carries `via` (the app's id, name and host, as findings send them)
  on each op it caused; what the person does by hand never does. Each thing says its
  own app, so a hand change and an app's in one push are each credited right:
  - a new mark: `createdVia`; a comment: its `app`, an edit `edited.app`;
  - a change to a mark: the mark's note `via: { app, of }`, `of` a hash of the mark's
    content as the app left it (`markSignature`): any later change to that mark, by
    hand too, ends it;
  - a comment's delete: `deletedVia` on the case, kept until the server has it;
  - the case's making: `createdVia` on the case, set only when an app's call made
    the case (a mark added to no case); a case shared by hand names no app. (Before
    the review the engine sent `case.create` without `via` in every case);
  - the case's own changes (`case.patch`, `case.close`, `case.reopen`): the case's
    note `via: { app, at }`, valid only while `at` is the case's `updatedAt`, so any
    later change, by hand too, ends it. A change the sync itself makes (a merge, a
    renumbering) carries it over while the title, link, summary and closed are as the
    app left them.

  These are this browser's notes and never go into a file, in or out.
  The server's record (`createdVia`, `commentBy`, `summaryBy`, `closed`) is kept beside
  what the patches compare, never in it. Shown as "Dana via Claude" wherever the panel,
  case.md and the tools say who did something.
- **From a file.** A comment keeps its writer as the file says, flagged `imported`, and
  is sent without `via`; the server then names the person importing it. A mark's
  `createdVia` from a file is dropped: sent, it would claim the app did it now.
  "Replace it" puts the file's marks and screenshots in place of the case's, not its
  thread: the thread stays as it is here, and the file's is not read. The thread is
  the conversation the case has here and with the team, and a file is a copy of an
  earlier moment: taken from it, it would delete what was written since (a file
  without comments, from 0.3.0, would delete all of one's own) or put an old text in
  place of a newer one. The button's tooltip says the comments stay. A comment kept
  about a mark the file does not have is about a deleted mark. New cases and "Keep
  both" take the file's thread.
- **0.3.0.** Reading a file with comments, 0.3.0's `validateCase` drops the fields it
  does not know (comments, closed, summaryBy, createdVia, commentBy): the case and its
  marks import as before, without the thread; exporting it again from 0.3.0 loses the
  thread. On a team, 0.3.0 syncs marks as before, passes by removed comments, and
  does not see comments or closing; a mark it adds reopens a closed case at the server,
  which this build follows.
- **A browser that ran 0.3.0.** Its cases, books and account are read as they are:
  the stores, the account and the tokens are as 0.3.0 wrote them, and a book only
  gained optional fields. But 0.3.0 read past the team's comments and closings in
  `changes` and moved its cursor on, so those would never come. A book whose shadow
  has no thread (only a book from before this decision: a new case's shadow starts
  with an empty one) has its case read whole once, at the first run after the
  start; what is here is sent as usual meanwhile, and nothing deleted here is
  forgotten. Tested in `test/compat-0-3-0.test.ts` (0.3.0's sync, then this build on
  the same stores) and against a local server in `test/cloud-server.test.ts`.
  What a 0.3.0 book is to this code: its fingerprints are computed as 0.3.0 computed
  them (`fixedOf`, `markContent`, `caseContent`, the patches' comparisons and
  `canonical` are the same code; shadows of screenshots had `capturedAt` already;
  `markSignature` is never in a book), and its shadow lacks only `closed` and
  `comments`, which read as open and as no thread. So it is clean as it is, and the
  read above writes nothing to the team. `test/e2e/upgrade.test.ts` shows it with the
  real stores: 0.3.0's build signs in and syncs (a case of the team's and one it
  sends itself, with marks and screenshots), the build before the thread
  (`panel-guidance`) runs over the same profile, then this one; the server's own
  record (`applied_ops`, `blobs`, the team's revision, the images' files) is
  unchanged by it, the panel shows the cases with their marks, and a comment written
  afterwards is the one operation it sends. Chrome keeps running the service worker
  script it cached for an unpacked extension of the same version until the
  extension is reloaded in chrome://extensions: new files on disk and a restart are
  not enough (the test drops the worker cache to get there).
- **AI tools.** `list_comments`, `add_comment` (also about a mark), `edit_comment`,
  `delete_comment`, `set_case_status`; `get_case` shows the newest 20 comments with
  `own`, and `closed`; `list_cases` says `closed: true`. The changing ones ask first
  under the existing rules, and the confirmation names the comment, whether it is the
  app's own, and that the team will see it (a delete: that it is deleted for the
  team too).
- **Weak.** Changes to the case's own content (title, link, summary) made by hand and
  by an app between two syncs go as one `case.patch`: with `via` when the app's came
  last, without when the hand's came last. The same holds within one mark: a hand
  change and an app's to the same mark before a sync go as one `mark.patch`, credited
  to whichever came last. Different marks, comments and the case's making are each
  credited right. The thread's order
  after edits is the local one until the next whole read. Another's comment lost
  locally comes back only at a whole read.
- **Tested** in `test/cloud-thread.test.ts` (the thread, closing and `via` against the
  server in memory, which checks every op against the OpenAPI document),
  `test/compat-0-3-0.test.ts` (an unchanged copy of 0.3.0's sync in `test/compat/v0.3.0`
  beside this build on one team; a file of this build read by 0.3.0 and back),
  `test/tools.test.ts`, `test/view.test.ts`, `test/markdown.test.ts` and
  `test/export.test.ts`; after review also `test/case.test.ts`, and in
  `test/cloud-thread.test.ts` a hand delete and an app's change in one push, a hand
  edit of a mark after an app's change, a case shared by hand, an app's change kept
  over a merge, a restored server, another's text, the limit, and a file put in place
  of a synced case; the 0.3.0 file test goes through `exportCase`, `readExport` and
  `storeImport`.

## DEC-047: Crops for marks made at the server, and what a mark records of the page

2026-11-20. Items D and E of the 0.3.1 hand-over. Each capture defect was reproduced
first on a copy of Sitegloss's demo page (`test/e2e/pages/demo.html`, from
ractive.ch/sitegloss/demo/): `test/e2e/capture.test.ts` fails on the code before
this decision with a link's `href` of `/demo` (not `/demo#book`), the e-bike's "New"
badge and the gravel bike's picture under the previous card's title ("Gravel bike",
"City bike"), an arrow ending on a bare `strong`, and an underline taken for the
whole card under "Our bikes".

- **A crop for a mark made at the server (D).** MCP `add_mark` stores a mark with
  `element: null` and the whole screenshot as its crop (its SHA-256 is the
  screenshot's). When such a mark first arrives, the engine cuts a crop from the
  screenshot around the shape, with the margin a drawn mark's crop has
  (`cropRectFor`), and stores that as the mark's crop here (`wholeShotCrops`,
  `cutCrop` in the worker). Where cutting fails, or the shape is not on its
  screenshot, or the part would be under 8 CSS px either way, the whole screenshot
  stays, as before: it at least shows something. The case is read for this only
  when such a mark is among what came. **Not sent back.** A mark's crop is sent only in `mark.create`; this
  mark's create was the server's, so nothing is sent, and that is right: the crop is
  derived from the screenshot the server has, the web app already shows the region
  with CSS (`isWholeShot`), and an upload would be a write the person never made,
  done by every device that receives the mark, credited to whoever synced first.
  If a real crop is wanted at the server, the server is the place to cut it (it
  has the image and the shape). Marks that arrived before this keep the whole
  screenshot until their case is read anew from scratch.
- **A link's fragment (E1).** `href` keeps the path, as before, and now the fragment
  where it names a place of the page: on a link to the same site, a hash route
  (`#/cart`, as page addresses keep, DEC-038), or `#id` on a link to the page itself
  when an element with that id exists there (`#book`). Another site's fragment is
  dropped, its route too. Any other fragment is dropped (`#access_token=…`,
  `#private`, another page's `#shipping`, which cannot be checked from here): it can
  carry a token, the reason DEC-009 dropped them all. One value, not raw and
  resolved both: the path with the place is the resolved form, and the raw form is
  in the live HTML `get_mark_element` reads. Where one side of a comparison has a
  fragment and the other none (a mark stored before; a target rendered later, or
  not yet, when one of the two was described), the links are compared without it;
  two fragments still tell same-page links apart (the demo's Bikes, Prices and
  Book).
- **The heading (E2).** Inside a section or card (`article`, `section`, `aside`,
  `nav`, `dialog`, `li`, such roles, or a class naming a card, tile or panel), the
  heading is that part's title: the nearest heading before the element within it,
  skipping the titles of parts inside it that the element is not in; when nothing in
  it comes before (a badge, a picture above the title), its first own heading after
  the element (not for a heading itself, whose sub-headings come after it); then the
  same for the part around it. Outside any section or card, the nearest heading
  before it, as before (a footer note after the last section keeps that section's
  title, as it did). The search looks at no more than 64 headings, and remembers the
  sections and cards around each element for a page's scan; past that it gives the
  old answer. A whole-page scan checks its deadline while it describes.
- **Marks stored before (E2).** Their `heading` is the old rule's, often the
  previous card's title. A page's candidates are described with both (the old
  answer comes from the same search, as `headingBefore`, never stored), and a
  stored heading counts with the better of the two. On repeated cards that makes the
  old mark's own card and the card before tie on the heading; the rest (position,
  above all) decides, where before the card before won outright. A new mark gets
  the same better-of-two, so a neighbouring card's old-rule heading can tie with it
  too: the price of not knowing which rule a stored heading followed, as `element`
  carries no version.
- **The element of a drawn mark (E3).** A note, the ends of an arrow, and a box's or
  stroke's best overlap are taken to the element that means something there: the
  whole SVG picture, not a path of it; the link, button, label or other control a
  piece of it is in (also from inside a component's shadow root); the text a
  `strong`, `span` or the like is in, unless that piece has an id, a test id or a
  readable class (a badge) of its own. The Element tool is
  unchanged: it marks what its highlight showed. A flat pen stroke (under 16 px high
  and three times as long) is an underline or a strike-through: its element is the
  line of text over it, found by a box reaching 24 px up.
- **Both ends (E3).** An arrow, and a pen stroke that goes from one place to another
  (its ends further apart than 40 % of its diagonal, and not flat), record `ends:
  { start, end }`: the elements under its first and last point, each `null` where
  there is none. `element` stays the mark's element (an arrow's: its head's, as
  before). Optional in `sitegloss/1`: a 0.3.0 import drops it. get_case shows it,
  case.md says "From:" and "To:". Sent with the new mark since the server took the
  field (below).
- **Proposed for the server's contract (API v1, additive).** On `Mark` (in `changes`,
  `getCase`, MCP `get_case`) and on `mark.create`'s `mark`: an optional
  `ends: { start: Element | null, end: Element | null }`, where `Element` is the
  schema `element` uses, with the same limits. Part of the drawing like `shape` and
  `element`: set at create, never patched (not in `mark.patch`), returned as stored;
  absent for marks that have none (0.3.0's, MCP `add_mark`'s, notes, boxes). The
  server need not check the kind. Once the OpenAPI document has it, the extension
  sends it in `mark.create` and reads it back in the merge.
- **Taken by the server** (sitegloss.dev 5a63313, its DEC-020), and in the extension
  with the A–C pull request (DEC-046): `ends` goes with `mark.create`, cut as
  `element` is; it stays out of what `mark.patch` compares and out of `fixedOf` (a
  mark drawn with `ends` before this was sent without them: in `fixedOf` it would read
  as another drawing, and be deleted and made again). A mark made on another device
  takes the server's; one drawn here keeps its own.
- **Tested** in `test/e2e/capture.test.ts` (the demo page, in Chromium),
  `test/element.test.ts` (fragments, another site's route; headings on the demo page,
  in nested cards, of a heading), `test/match.test.ts` (a link with a fragment on one
  side; an old mark on a badge in repeated cards), `test/candidates.test.ts` (a large
  page: the heading's cost against the old search; the deadline during a scan),
  `test/anchor.test.ts` (the element of a drawn mark, across a shadow root; open
  strokes), `test/cloud-crops.test.ts` (the crop of a mark made at the server; none
  sent back; a shape off the screenshot; no extra read), `test/case.test.ts` and
  `test/markdown.test.ts` (`ends`).

## DEC-048: How a marked element looked: computed styles, the colour behind it, its neighbours

2026-11-21. With the server of sitegloss.dev's DEC-021 (pull request ractive/sitegloss.dev#21).
An AI session that fixed a real case through the MCP server missed "computed styles for
the marked element: colour, background, font size, and height compared with its
siblings", to find the cause of a contrast or alignment issue without building the page.

- **What.** Three optional fields on `ElementDetails`: `styles` (property name → computed
  value), `backdrop` (`{ color, depth?, image? }`: the element's background colour,
  composited over its ancestors' while transparent or translucent, up to the first
  opaque one, the page's canvas under all; `depth` how many steps up that opaque one is;
  `image` when a background image or gradient on the way may show instead) and
  `siblings` (up to three element siblings with a box before and three after:
  `{ offset, tag, rect }`). Only on the mark's own element; not on a stroke's ends (an
  arrow's element is already the end it points at; the start's `rect` answers
  alignment between the two; three times the record for little).
- **Which properties.** The full set `get_mark_element` reads from the live page
  (`pickStyles` in `inspect.ts`), so that what was recorded and what the page shows now
  compare name for name: colour, background colour (and a background image only as a
  gradient), opacity, visibility; font family, size, weight, line height, letter
  spacing, text alignment, white space, text overflow; display, position and offsets,
  box sizing, width and height with their limits, margin, padding, border, corners;
  flex and grid container and item properties, gap, vertical alignment; overflow,
  z-index, transform, shadow, aspect ratio, pointer events. Plus font style, text
  transform and text decoration. Values at their initial value are left out as
  `get_mark_element` leaves them out, sides come together (`padding: 8px 16px`). At most
  40, colour and type first when there would be more. **Never**: a property whose value
  can hold an address (cursor, content, mask, filter, clip-path, list-style-image,
  border-image, shape-outside), a custom property (its value is the author's text), or
  any value that names a URL after all (`namesUrl`: a fetching function, `://`, a
  quoted path or query, also behind CSS comments and escapes) — the server drops such a
  value too, as a backstop.
- **When.** Once per mark, when it is made: the toolbar's marks (`#add` in the
  mark adder) and an AI app's `add_mark` (`look.ts`'s `withLook`). Never while a
  page's marks are found again: `describeElement`, which the candidates' scan calls
  thousands of times within its time budget, records none of it (tested).
- **Matching and the fingerprint take no part.** Matching compares the fields it names;
  `fixedOf` strips the three fields explicitly (`withoutLook`) after the way out and in,
  and `markPatch` never had the element. A mark synced by the build before this one has
  the same fingerprint here, with or without a look (frozen fingerprints of main at
  c4e97c9 in `test/cloud-wire.test.ts`): no mark is made anew, the lesson of `ends`
  (DEC-047). A look goes out once, with `mark.create`, within what the server keeps
  (`lookOf` again in `elementOut`); what the server sends back may lack what it dropped,
  which the fingerprint does not see either. A mark made elsewhere takes the server's.
- **The server drops, never refuses** (its DEC-021 after review): a style it does not
  keep never costs the mark. The extension keeps the same rules (`stylesWithin`,
  `backdropWithin`, `siblingsWithin` in `case.ts`) when a file is read and before
  anything is sent.
- **The file `sitegloss/1`** takes the fields as an optional addition; a file's entries
  outside the rules are left out, never a failed import. 0.3.0 reads such a file and
  drops them (its `validateCase` maps an element field by field; tested in
  `test/compat-0-3-0.test.ts`), and on a team it passes them by (its `elementIn` maps
  field by field), sending nothing more.
- **Shown.** `get_case`: on the element, `styles` in one line, `backdrop` and each sibling
  in a line, and `look` (the text colour on the colour behind, the font, the display);
  compact `get_case` gives `look` beside the summary. `get_mark_element` gives
  `recorded` beside what the page shows now, to compare with only when the element read
  is the mark's own (`relation` "mark"); for an ancestor, a descendant or another
  element it says whose look it is. case.md says "Look:" with the same line. The panel
  shows nothing new.
- **Never a contrast ratio known not to hold** (review of #26). The ratio is WCAG's,
  the text laid over the backdrop where it is translucent, and shown only with an
  opaque background found (`depth`). Else the line says the pair and why there is no
  ratio:
  - the element's own `opacity` below 1: it is drawn paler than its colours, and what
    is recorded cannot blend it, as the backdrop folds the element's own background
    in with what lies behind it (the parent's backdrop is not kept apart). Recording
    that would take a field the server does not keep yet; the reason is said instead;
  - no opaque background up to the page (no `depth`): the canvas colour is the
    browser's and not reported; the backdrop takes the browser's default canvas for the
    colour scheme the page uses (the root's `color-scheme`, else its
    `<meta name="color-scheme">`, with the reader's preference where it takes both):
    white, or #121212 (Chromium) / #1c1b22 (Firefox) for a dark page;
  - a colour in a form this does not read (`oklch()`, `color()`): the walk stops there,
    without `depth`;
  - a filter, a backdrop filter or a blend mode on the element or an ancestor, or an
    ancestor's opacity: no backdrop is recorded at all, as no colour found by the walk
    holds then.

  Over a background image or gradient the ratio is shown and flagged, as it may not
  hold where the picture shows. So `depth` means "an opaque background was found this
  many steps up" and nothing else.
- **Siblings** are the children of the element's parent node: an element's, or a shadow
  root's for an element at the top of one (not the host's children, which are what is
  slotted into it). When the screenshot is taken, the element's `rect` becomes its box
  then, and the siblings are measured again at that same moment (`atShot`), so that one
  record holds one moment's positions; with none that has a box then, none.
- **Weak.** The canvas for a page that sets no background is the browser's default for
  its colour scheme, not read from the browser (it reports none); a user's forced
  colours are not seen. A background colour this does not read gives no ratio, nor does
  an element at its own opacity. A text colour over a gradient or picture has no
  reliable contrast (`image: true` says so).
- **Tested** in `test/look.test.ts` (colours, contrast, the backdrop, siblings, what a
  file keeps, the lines; describing a candidate records none), `test/cloud-wire.test.ts`
  (the fingerprints of the build before; once with `mark.create`; never in
  `mark.patch`), `test/compat-0-3-0.test.ts` (a 0.3.0 browser on the team; a file read
  by 0.3.0), `test/tools.test.ts`, `test/markdown.test.ts`, and in Chromium on the demo
  page (`test/e2e/capture.test.ts`: the low-contrast Book link's colour and amber
  background, its neighbours, no look on a stroke's ends).

## DEC-049: The pairing-code fill-in takes the client library's filler (owner)

2026-11-21. The owner decided that Sitegloss moves to `CodeFiller` of
`@ractive-ch/tab-mcp-client/extension` (tab-mcp's DEC-206), with client 0.19.0 and, for
the tests, relay 0.13.0. Sitegloss tried 0.19.0-rc.1 and rc.2 first; its seven points
against rc.1 (the same code sent again taken for the next one, no way to turn off the
unasked second fill, no tab or AI app in `code` and `failed`, no origin check after the
page's hello, the once-per-document mark on the global, no word when a fill ends
without its code, a rename the type check misses) are fixed in 0.19.0. What DEC-044 says
the user sees does not change.

- **What goes.** `src/worker/code-filler.ts` and most of `pair-fill.ts`: the worker no
  longer reads the page and types the code itself with `scripting.executeScript`. It
  puts the library's content script (`src/content/pairing.ts`, built as `pairing.js`)
  into the pairing page's top frame; the script reads the form's hooks, opens a port of
  its own with a nonce of this page load, and fills in only the code that comes back on
  that port with that nonce. The port is taken at the worker's top level (the library
  needs its first message), but only a script the worker put in opens one, so no page
  load wakes the worker; the tabs listener stays the connection's.
- **`retry: false`.** By default the library fills the same request's page once more
  without asking when the relay brings it back after a wrong code. Built with
  `retry: false`, that page is asked about like any other: one page load, one question;
  one yes, one fill; never without a yes (DEC-044's "after review").
- **What stays Sitegloss's** (`src/worker/fill-question.ts`, the library's `FillHost`):
  - the question in the panel and its texts, the verified host first, the wait before
    a yes counting from the panel in front (`armed`);
  - one question at a time: a page in another tab while a question waits, or while a
    code is on its way to another tab, is answered `busy` and the panel says which (the
    tab comes from the library's `FillContext`);
  - the notification while no panel is on screen;
  - holding pairing on: a flag, not a count, from the yes until 30 s after the last code
    went to a page; at once when no code went and no earlier fill's 30 s still run; at
    once on the library's `release()` (the AI app connected, or a fill ended without its
    code and no other needs pairing), which may come with nothing held and is then
    ignored. A yes always turns pairing on with the connection of now, also while a
    panel shows the code: a panel's flag can still be about the relay before a switch
    until the panel, which shows no code while not connected, turns it off and on again.
    Sent again, `pairing.start` is answered with the code that shows (relay 0.13.0's
    `PairingCodes.start`), which `takeCode` does not take for the next one;
  - the setting "Fill in the code for me", its own, off by default, also with access to
    all sites, and the relay's site asked for with its click and given back when it is
    turned off (`settleFillCode` as before); the script is put in only while it is on,
    AI access is connected and the relay is the hosted one.
- **DEC-044's rules after review, in the library:**
  - *Bound to the request*: one port per document; the sender is checked (this
    extension's script, a tab, the top frame, exactly the relay's origin with its port,
    `/authorize`) when the port comes, after the page's hello, after the answer and once
    the code is there; the hello must name `sitegloss` and carry the relay's
    `request_id`. The code goes only to that port and nonce, so a tab that moved on (a new
    document, a new port) gets nothing: this replaces the page's own re-check of its
    `location` and `window.top`.
  - *Withdrawn at once*: `withdrawAll()` (Stop AI access, the setting off, AI access no
    longer connected) and `reset()` (another relay) abort a waiting question and a code
    on its way; the setting, AI access and the sender are checked again before the code
    is sent. Sitegloss still calls them on receipt, before the panel's queue.
  - *One page, one question, one fill*: one hello per port, one question per page load,
    the content script fills once per page load, and `retry: false`.
  - *Which code*: `takeCode`, as before: the current code with 5 s left by this clock,
    else the next one the relay sends (the same code sent again counts only if its
    expiry now leaves 5 s), else the current one after 10 s.
  - *Nothing dropped unseen*: `ask` may answer `busy`, and the library reports it
    (`failed("busy", context)`); Sitegloss says it in `ask`, where it knows why. What
    the panel says is about one tab: a code that comes for a tab clears only what was
    said about that tab (a fill that failed there), not that a page in another tab was
    not asked about; that stays until its own time runs out or something replaces it.
  - *Only the hosted relay*: `relayOrigin()` gives the hosted relay's origin only, as
    before.
- **A fault of 0.3.1 fixed on the way.** In 0.3.1 a yes cleared the hold of a fill
  before it: a second fill (another tab, after the first had filled in its code) that
  then ended without a code turned pairing off at once, while the relay could still be
  checking the first code. The hold now runs out on its own time.
- **The rest of the bump**: `newAddress()` is `disconnectAll()`, a rejection's
  `addressChanged` is `secretChanged`, the reason `new_address` is `disconnect_all`.
- Tested in `test/pair-fill.test.ts` (the library's real content script and
  `CodeFiller` with Chrome-like ports, built as the connection builds it: every rule
  above, the seven points, the hold), `test/connection.test.ts` and in Chromium
  (`test/e2e/pair-fill.test.ts`, `test/e2e/connection.test.ts`). Not tested: a whole
  pairing end to end (the testing package's relay cannot show its form for a test
  client), and the fill-in in Firefox (its suite has no test of it, as before).

## DEC-050: Where a mark was made: the exact offer, drawing by path, the query kept (owner)

2026-11-21. The owner decided it with sitegloss.dev (its DEC-023), against one contract
both sides build on: a mark shows exactly where it was made, the address keeps its query
so a result list opens again as it was, Home offers a case only on an exact match, a
case opened by hand anywhere else draws the marks of the path in front, and nothing opens
by itself. This amends DEC-009's "links keep their path only" for the screenshot's own
address (an element's link still keeps its path only), DEC-038's "a home page is one
site's only" for drawing, and DEC-038's review ("the query is cut from every address
that is kept").

- **The offer is exact.** Home's "This page" lists a case when one of its screenshots
  was taken on the tab's origin and the same page (`exactPage`: the origin and
  `pageKey`; `isOfferedOn`); a case with no screenshot yet, on its page. Not closed
  cases first, closed ones after with a "Closed" tag (they leave the Closed group then);
  the texts are as before and say nothing about other sites. The query takes no part:
  `?q=boots` offers a case marked on `?q=shoes`. On `localhost:3000` or staging the case
  is in the list below and opened with a click.
- **A case opened by hand draws by path.** `pathKey` is `pageKey` except that a home page
  is `/` on any host, so production's home page is the home page on `localhost:3000/`;
  `samePath` and `pageInFront` (the case's page whose marks are drawn on the page in
  front: by path, the one of the same site first when two sites' home pages both are)
  are the extension's own. `pageKey`, its vectors and everything about the case's list
  of pages (the list, the counts, what is sent to the team, a mark adding a page) do not
  change. Every user of "the same page" was looked at:
  - stays `pageKey` (the case's list): `casePages`, `marksByPage`, `marksOnPage`,
    `pageAt`, `withPagesOfShots`, `withPagesAgreed` (`case.ts`), the save's list and its
    limit (`save.ts`), `pageOfShot`, the pages merged from the server and a case from the
    server's first page (`wire.ts`), the counts in case.md, `list_cases` and `get_case`'s
    pages, the case header's counts, the content script's "the address moved on to
    another page" (`#checkPage`) and the panel's `movedOn` (one document, one origin);
  - now `onPageInFront(c, a, url)` (should this mark be drawn or offered here: its page
    is the one `pageInFront` picks, so of two sites' home pages in one case only the
    site's own counts on either site, and the first listed on a third host): which marks
    are the page's own in what a draw found and the line under the case (`findsOn`,
    `dashDrawn`, `noneHere`), "on another page" in the marks list, "None of this case's
    marks were found on this page" and its "Open the case's page" button, the page list's
    "this tab", the window the marks were made in and Match size (`viewportAt`), the
    content script's own page of a mark (`#own`: dashed "Also on this page?"), where a
    mark on no element is drawn (`#whereItWas`), `get_mark_element`'s selector for a mark
    on no element, and the AI tools' `onThisPage` and `otherPageNote`;
  - now `exactPage`: Home's offer.
  On a page that is none of the case's, every mark is looked for as before (DEC-038).
- **The query is kept** (`src/lib/query.ts`). `keptQuery` is the server's function
  (`packages/api/src/v1/query.ts`); `test/kept-query.json` is a copy of the server's
  vectors and word lists, which this one passes, as `page-key.json` is held. A piece is
  dropped when a word of its name says secret (token, key, code, session, email and the
  rest of the lists) or the words joined are a known name (`apiKey`, `PHPSESSID`), when
  its name or value has an `@`, holds a JWT or is 40 or more characters of
  `A-Za-z0-9_-.~+/=` (tested on the decoded text and on up to two more decodings, so
  `%2540` is an `@` too), when a query inside its value says or looks secret on any of
  those decodings (cut at `?`, `&`, `;` and `#`, one level a round: `next=/reset?token=…`,
  amendment 5), when it holds a raw `#` or a malformed escape; the rest is kept
  as it was, in order; a result over 1024 code points is dropped whole, never cut (a cut
  query opens another page), and an input over 8000 units gives nothing before it is
  parsed. Linear on any input (no expression that backtracks). `countryCode` is dropped
  (the word `code`), and so is a slug of 40 or more such characters: a wrong keep is
  worse than a wrong drop. The server took the decodings, the input limit and the
  linear JWT test after its review (its d63a0af); the vectors changed with them, and
  this follows them.
  - **Where a screenshot is made it records `query` beside the plain `url`**: the
    toolbar's marks and `add_mark` both through `saveCase`, which takes it from the
    address the screenshot was taken on and never from a `query` the sender put on it;
    an import keeps a file's `query` and, for a file whose addresses still have a query
    (from elsewhere), what `keptQuery` keeps of it. `plainUrl` and what it returns do not
    change, nor does any page's address in the list.
  - **The file `sitegloss/1`** grows by the optional `shots[].query`. `validateCase`
    reads it filtered again; one that is no text, keeps nothing, or is over the limit is
    left out, never a failed file. The export writes it. A build before this one reads
    such a file: its `validateCase` builds each screenshot from the fields it knows
    (tested with 0.3.0's own module, `test/case-0-3-0.ts`).
  - **Sync.** `shot.create` sends it; a screenshot from the team keeps it, filtered here
    too. Screenshots never change after `shot.create`, so nothing else carries it. The
    released server (sitegloss.dev main at d8a6ebe) validates operations with zod
    objects that strip unknown keys: a `shot.create` with `query` was parsed by its own
    `OpsRequest` and taken without the field (checked against that code, not only its
    OpenAPI document). So this build may go out before the server; until the server has
    the field the team's other browsers get no query. 0.3.0 on the same team takes
    such a screenshot without the query and sends nothing (`test/compat-0-3-0.test.ts`).
  - **Who sees it.** This browser and its export (the user's file), the team and an AI
    app connected to the service (the server's), and the extension's own AI tools. Never
    a share link: the server strips it there.
  - **Out of scope, on purpose:** a plain fragment (`#section`) and the parameters inside
    a hash route (`#/search?q=shoes`), which `hashRoute` cuts as before; the query of a
    link inside an element (DEC-009) and the tab in front's address in `capture` and
    `load_case`'s `url` (no screenshot of a case).
  - **case.md** writes a screenshot's page, with its query, for it and its marks in a
    case of several pages as before, and now also where the screenshot has a query, in
    a case of one page too; the case's own `- Page:` line and the list stay plain. The
    server's member download writes the same: `test/case-file.json` is a copy of its
    `packages/api/vectors/case-file.json`, and `validateCase` keeps its `case.json` as it
    is.
- **A link on each mark.** In the panel each mark says "Marked on <its address with the
  query>", a link (a button, named for screen readers "Open …, where mark N was made, in
  this tab") that opens that address in the tab in front, keeps the case open, and,
  once the page has loaded and its marks are drawn, brings the mark into view and
  outlines it (`case:show`, as Show does); it waits while the draw still looks for a mark
  not found yet, and while the page is busy (making a mark) or does not answer, and is
  used up only once the page showed the mark or after two minutes (a sign-in in
  between: `tryShow`). With the tab at that very address the page is never loaded
  again (its fields and scroll would go): where it holds the case, an AI app's
  `load_case` too, the mark is shown at once, else the case is drawn there
  (`linkStep`). With the case
  open on another origin than the mark's, "Open on <origin>" sends the mark's path, kept
  query and hash route to the origin it names: the host with its port, and the scheme
  too where host and port are the mark's (`Open on http://shop.example`), so it is never
  taken for the first link. It is offered on any web page in front, also one that is
  none of the case's, because opening a case elsewhere is a deliberate act and a
  developer on `localhost:3000/` has to get to the case's `/cart` there. Chrome's
  question for the site is asked in the click, as for a page of the case; a Hide on that
  tab ends. The line is shown for every mark, not only in a
  case of several pages (it replaces "On <page>").
- **AI apps.** `get_case` (each screenshot and mark), `load_case`, `highlight` and
  `get_mark_element` give `address` (the page with its query) beside `page` where the
  screenshot had a query; `add_mark` says the address with its kept query. New
  tool **`open_case`**: asks the side panel of the tab's window to open the case, and the
  panel does exactly what a person's clicks do: "← All cases" on the case it shows
  (`leaveCase`: its toolbars end, an untouched new case goes, DEC-026), a click on the
  case, whose marks are then drawn on the tab in front by path and follow the tab
  (DEC-022). The tool reports that draw; what the panel knew of a draw of another case,
  or of the same case on another tab, is dropped first (`keepsLoaded`). It asks the user first (`consequentialHint`:
  "Always allow" and "Allow all changes" cover it as any other, DEC-043); its question
  names the case and the page in front (its address as kept). **Nothing a person typed
  is ever lost to it:** while the case shown has a mark's form open, its title or link
  being typed, a "← All cases" under way, or its toolbar up on any tab, or while the
  toolbar on that tab adds marks to another case, the panel stays, nothing is drawn, and
  the call fails saying which case and why (`aiOpenRefusal`). It navigates nowhere and
  opens no tab. Without a side panel open in that window the tool draws the marks
  itself, and the case opens when the user opens the panel there (the panel opens the
  case a page shows, DEC-023). The panel takes the request only from the extension's
  background (`fromBackground`: this extension, no tab, and the background's own
  address, `background.js` in Chromium and the event page Firefox makes,
  `_generated_background_page.html`), so neither a content script nor another extension
  page can switch it, and only for its own window.
- **Not done, on purpose:** no learned or synced hosts and no host settings, no matching
  by title or metadata, nothing opens by itself (not even an exact match), the query
  takes no part in matching (`/search?q=shoes` and `?q=boots` are one page), no change
  to `pageKey`. Two sites' home pages in one case: on either site its own counts, on a
  third host the first listed.
- **Tested** in `test/query.test.ts` (the contract's table, the server's vectors and
  lists, hostile input in linear time, what a screenshot keeps), `test/address.test.ts`
  (`exactPage`, `pathKey`, the offer, the page in front, a draw on localhost's home page,
  the toolbar's save, a file read and written, an import, 0.3.0 reading the file,
  case.md and the server's case file, the mark's link),
  `test/view.test.ts` (the offer and its order, the link's texts and names),
  `test/tools.test.ts` (`address`, `onThisPage` on localhost's home page, `open_case`,
  its refusals and its question), `test/ai-open.test.ts` (every refusal),
  `test/address.test.ts` (the link's wait, a busy page, the very address; the draw
  `open_case` keeps),
  `test/browser.test.ts` (`fromBackground`), two sites' home pages in
  `test/address.test.ts` (`findsOn`, `pageView` on each site and a third host),
  `test/compat-0-3-0.test.ts` (the sync, 0.3.0 beside it), in Chromium
  (`test/e2e/address.test.ts`: the offer on the same site only, a case opened on
  another host's home page, both links; `test/e2e/open-case.test.ts`: refused with a
  comment half typed, which stays, then the clean switch) and in Firefox (the event
  page's address). The fake server keeps the query as the server does.

## DEC-051: The thing a person adds is a mark, in the code too; the case format is `sitegloss/2`; the update starts with no case (owner)

2026-11-21/22. The owner: the domain word is **mark**, everywhere in the code and its
language. "No need to support backwards compatibility", and "in descriptions and on the
webpage you can mention it, but in the domain language of the code, use mark all over."
Then, 2026-11-22: a mark's id no longer keeps the letter of the old word, and "You can
also wipe the cases and marks db. No one besides me is using it right now." Every text a
person sees, the server, its API and its database said "mark" already; the extension's
inside said "annotation", from before the product was called Sitegloss. The server's
side of it is its DEC-024.

- **The update wipes the cases in the browser.** A case that was only in this browser,
  never synced with a team, is gone with it; the owner knows and accepts that. Its file
  in the folder or Downloads mirror stays (below), but this version cannot open it.
- **Renamed by meaning, not by a blind replace**: the type `Annotation` is `Mark`
  (`AnnotationMatch` `MarkMatch`, `AnnotationDraft` `MarkDraft`, `AnnotateTarget`
  `MarkTarget`, `MAX_ANNOTATIONS` `MAX_MARKS`, `withoutAnnotation` `withoutMark`), a
  case's `annotations` are its `marks`, `annotationId` is `markId` in every message,
  `nextAnnotation` is `nextMark`. The content script's toolbar, `annotator.ts` with its
  `Annotator`, is `adding.ts` with its `MarkAdder`; the overlay's `annotating` is
  `addingMarks`. The panel's "New case for this page" button is `#new-case` (its action
  `startNewCase`), a mark in the panel's list is `.mark` with `data-mark`. Names that
  already said mark and meant something else kept their meaning: where both met, the
  other one moved (the book's wire ids in `renumber`, a mark found by number in two
  tools).
- **The case format is `sitegloss/2`**: the list of marks is `marks`, and a mark's id is
  `m<number>` (`m1`, `m2`…; it was `a<number>`), made in one place (`markIdOf`): its crop
  is `crops/m<number>.webp`, and comments and the sync's books name it by that id.
  Screenshot and case ids keep their forms. This build reads and writes only
  `sitegloss/2`. A case file of `sitegloss/1` is refused in one sentence, by its
  format: "This case file is in the old format sitegloss/1; this version of Sitegloss
  reads sitegloss/2 only." Nothing converts it on import. So a file written before this
  version (an export someone kept, a mirror file, a download from a sitegloss.dev
  without its DEC-024) no longer opens in this version; Sitegloss 0.3.1 and older still
  open it, and refuse a `sitegloss/2` file in turn.
- **Stored cases are not converted: the store's upgrade empties it** (database version
  2, `store.ts`): the cases, their images, the delete records and the screenshots of
  saves that never finished go, in IndexedDB's upgrade transaction, before any
  connection opens. A failed upgrade aborts and leaves the database as it was, at
  version 1; the error says what failed by its name only, once in the console, and for
  ten seconds every call (the panel's list, the folder sync, the cloud sync) gets the
  same error without opening again. A build before this one cannot open version 2. The
  cloud's database forgets what it kept about cases (`forgetCases` in `cloud/book.ts`):
  every server's books, how far the team's changes were read, what waited to be sent,
  the whole-read and status notes, and the deletes an expired sign-in recorded. It
  keeps the server chosen, the account and its team, and the tokens; settings and the
  AI connection are in other databases and stay. Undo (the ledger in `storage.session`)
  and the drafts on open pages end with the update anyway. So the first run has no
  case, no book, no cursor and no delete on record: it sends nothing and reads the
  team's whole state, and every case of the team comes back with `m` ids.
- **The forgetting happens once, in one place, in one step, and only after the case
  store is open at version 2.** Only the service worker forgets (`casesReady` in
  `worker/cloud.ts`): it opens the case store first, and only when that answers version
  2 does it run `forgetCases`, whose look at the marker (`cases`), removals and marker
  are one readwrite transaction (`Kv.update`); a second call finds the marker and
  removes nothing, so nothing written after it is touched. The engine does nothing
  (no run, no choice, no book read or written, nothing sent) until `casesReady` has
  said yes once; the panel shows no sync status and no case's sync mode until the
  marker is there. Two builds running at once are guarded only this far: while one of
  the build before holds the case store at version 1, this build neither forgets nor
  syncs, so the old engine keeps its books and its cases as they were; once this
  build has opened version 2, a build before cannot open the store at all.
- **The open waits for no one for ever**: a store has at most one open request under
  way, and every call waits on it for at most five seconds unless its upgrade has begun
  (IndexedDB fires `blocked` only for the first request in line; the others just wait,
  so the time counts from each call, not from that event). Then the call fails with a
  sentence that says what to close; the request stays, so the upgrade runs once the old
  connection goes, and no request piles up; no failed or pending promise is kept as the
  store's connection. A connection of this build closes when another context upgrades
  or deletes the database, as the settings' database does.
- **The folder and Downloads mirror (DEC-025) leaves files of before alone.** It reads
  nothing back. A file whose record has no format in its version (written before this
  version) is moved aside in the records: never written over, never removed, its name
  still taken. On the first run after the update the store is empty, so nothing is
  written and nothing removed. When the team's cases come back, each is written to a
  file of its own beside its old one (`login-2.sitegloss.zip` beside
  `login.sitegloss.zip`); the old one stays, in `sitegloss/1`, for 0.3.1 and older.
- **The AI tool `add_annotation` is `add_mark`**, the name sitegloss.dev's MCP server has
  for its own tool (without a live page); its parameters were `caseId`, `selector` and
  `comment` already and stay. An "Always allow" given to `add_annotation` does not carry
  over: the app is asked again (DEC-043 keeps a tool allowed one by one by its name;
  "Allow all changes" still covers it). Crops are `crops/m<number>.webp` in
  `get_case` and `get_image`, as at the server.
- **What keeps the word**: the describing verb where a sentence tells someone who does
  not know the product what it does (the README's opening, `PRIVACY.md`'s first
  sentence, the store's listing); the MCP protocol's tool `annotations` (`readOnlyHint`
  and the rest); W3C's Web Annotation, git's annotated tags, other tools' names; the
  copies of 0.3.0 under `test/` (its names, as it shipped); and in this log and the
  design documents, the owner's own words in quotes and the panel's old labels ("Annotate
  this page", "Stop annotating", "Continue annotating") as they were.
- Tests: `test/compat-0-3-0.test.ts` (a 0.3.0 browser's data after the update: no
  operation at all, not even the delete 0.3.0 had on record; the team's cases back with
  `m` ids; the case only 0.3.0 had is gone), `test/forget-cases.test.ts` (once, in one
  step, two callers), `test/cloud-worker.test.ts` (nothing forgotten and nothing sent
  while the store is at version 1), `test/kv-contract.ts` (`update`, also in IndexedDB),
  `test/sync.test.ts` (the mirror after the update, to a folder and to Downloads),
  `test/export.test.ts` (a `sitegloss/1` file refused in that sentence),
  `test/case.test.ts` (an `a<number>` id refused), `test/e2e/store.test.ts` (a database
  written by 0.3.0's `IdbStore` emptied by the upgrade, an older build's open refused;
  the blocked open, again after the retry time and from a second context, and the
  version change), and with a real server
  `test/cloud-server.test.ts` and `test/e2e/upgrade.test.ts` (a profile of 0.3.0 and a
  later build opened by this one: nothing sent, the team's cases back in `sitegloss/2`
  with `m` ids).

## DEC-052: tab-mcp client 0.20.0 changes nothing for Sitegloss: the tools stay for the relay only (owner)

2026-11-22. The owner approved the bump of `@ractive-ch/tab-mcp-client` from 0.19.0 to
0.20.0 (relay for the tests stays 0.13.0: the changelog asks for no other). Its one
breaking change is the library's DEC-209: with `webmcp: true`, tools that ask the user
(`consequentialHint`, or `destructiveHint`) are mirrored into WebMCP too, unless their
`callers` leave `"webmcp"` out; a WebMCP call asks by `consequentialHint ??
destructiveHint`, a relay call still only by `consequentialHint`.

- **Nothing changes here.** Sitegloss offers its tools to AI apps through the relay only,
  by decision (privacy and identity: a web page must never be able to call them).
  `src/worker/connection.ts` registers every tool with `callers: ["relay"]`, which stays
  explicit, and leaves `webmcp` off (a worker has no document); `src/worker/tools.ts`
  refuses other callers too. In 0.20.0 `callers` without `"webmcp"` still keeps a tool out
  of the mirror, and without `"local"` out of a served port; who is asked before a
  consequential tool runs for a relay caller is as before.
- Tests: `test/client.test.ts` (relay only: listed through the relay, not over a served
  port), `test/tools.test.ts` (other callers refused). No new test.

## DEC-053: A smoke set before every commit, the full end-to-end sets nightly and before a release; what deserves an end-to-end test (owner)

2026-11-22. The owner: "check what e2e tests really make sense and which can be dropped
again, because they've been proven to work. Often I have the feeling you start to add
gigantic test harnesses for a bug which may get solved, and everything after starts to
add more and more tests on top because the huge harness is there." And: "consider
running full e2e tests maybe only nightly or on a new release". An audit of every test
(2026-11-22) found that the harness itself is cheap (a Chrome launch, the build and the
control page take about 0.6 s a file); the time went to waiting on clocks (the
extension's own guards and timeouts sat out at full length, about a hundred fixed
sleeps, a helper that ran out its 8 s without failing, Firefox's 35 s), and a quarter of
the end-to-end tests proved again through a browser what a unit test written for the
same review already asserted.

- **The sets.** `bun run verify` (before every commit, and CI on every pull request and
  on main) is Biome, the type check, the unit tests and a **smoke set** of end-to-end
  tests, each across a boundary only a browser has: the overlay injected and shown, marks
  drawn and saved with real screenshots, Add marks, a case drawn on the tab in front and
  following it, the relay with a real MCP client, a closed side panel handing a question
  to a notification, the worker stopped by Chrome coming back, the store package's host
  access, install warning and icon click, the IndexedDB contract, export and import, Sync
  to Downloads. The **full sets**, every Chromium test (`bun run test:e2e`) and the
  Firefox tests (`bun run test:firefox`), run in `e2e.yml`: every night on main, unless
  main is still the commit the last green run tested; on a release tag, before
  `release.yml` builds anything, so a red run releases and publishes nothing; and by
  hand. The tests against a real server (`bun run test:server`) run before every
  release, by hand: no workflow has a server.
- **The price.** A break that only a browser shows is found the next night or at the
  release, not before the commit. A change that is about what only a browser shows
  (layout, capture, the side panel, Firefox) runs the full set by hand before it is
  merged.
- **One switch.** `SITEGLOSS_E2E=full` (`test/e2e/mode.ts`) runs every end-to-end test;
  without it only the smoke set runs. A describe is `inFullSet`, or `inBothSets` for the
  smoke tests in it, whose other tests are `fullTest`s; the Firefox and the real-server
  describes are of the full set. Every test runs in the full set, none in neither.
- **A nightly failure reaches the owner** as GitHub's notice of a failed scheduled run: it
  goes to the account that last changed the workflow's schedule (whoever pushed that
  commit, here the owner's), by e-mail and on the web as that account's notification
  settings for Actions say. A failed run is retried the next night as long as main has
  not had a green run.
- **What deserves an end-to-end test**: a behaviour of the browser itself (real capture
  pixels and scale, the icon click and `activeTab`, installation warnings and host
  access, the side panel opening and closing, `sender` checks, `pushState` and reloads,
  layout and the top layer, downloads and the offscreen document, IndexedDB, the relay
  and an MCP client, Firefox's event page). A decision is a unit test, also when a review
  found the bug; a test whose only purpose is to prove once that a fix worked is not
  kept. A new harness, or a knob in one, for a single finding is a sign the test belongs
  lower. A test is named after the behaviour it guards, never after a review, a pull
  request or a finding: the commit says where it came from.
- **The test build's clocks** (`scripts/build.ts --test` only, the define as before): the
  guards against a click that comes too soon are 100 ms (Delete's and the back button's
  double click, a yes to a question, Disconnect's confirm, a notification's button), and
  the delays short (Keep AI access on's retries, the Downloads sync's quiet time, a page
  standing still, a busy page asked again). The waits after which Sitegloss calls
  something failed stay real unless a test sets its own in the context it drives
  (`globalThis.siteglossTestWaits`, `src/lib/test-waits.ts`: the toolbars' end, a page's
  answer, Chrome's capture, the panel's searches again and its look after a route
  change): a short timeout in every test would fail a real but slow capture. Firefox's
  test profile stops an idle event page after 3 s (`extensions.background.idle.timeout`)
  and the test build keeps it alive every second; without the keepalive the idle test
  fails. A test that outwaits a guard sleeps `PAST_GUARD_MS`. No package carries the
  waits hook (`test/build.test.ts`). Chrome's two captures a second are no knob.
- **What was removed, and why.** Each end-to-end test dropped was checked against the
  test said to cover it, and kept where that test did not assert the same; where one
  assert was missing, the unit test got it first. The full Chromium set runs 37 tests
  fewer (230 to 193): 30 that a unit test or a sibling end-to-end test already asserted,
  and 7 merged into another with the same setup; `upgrade.test.ts` and `thread.test.ts`,
  which no workflow ran, went too. About 45 unit tests that repeated another, or the
  tab-mcp library's own suite, went too, two that could not fail now assert what they
  say, and the six slow unit tests take an injected wait or a fake clock (the unit suite
  from 66 s to about 21 s). The tests of
  relays before 0.10.2 stay: client 0.19 and 0.20 still talk to such a relay, so that code
  is not dead.
- **The 0.3.0 copies went with the wipe** (DEC-051): nobody runs a released extension
  yet, and the update empties the stored cases, so a 0.3.0 browser beside this build
  protects no one. `test/compat/v0.3.0`, `compat-0-3-0.test.ts`, `case-0-3-0.ts` (which was
  0.2.0's case module), `e2e/upgrade.test.ts`, `e2e/thread.test.ts` and `e2e/cloud-steps.ts`
  are gone. What they held that still matters stays tested: the store's upgrade empties a
  database of version 1 (`e2e/store.test.ts`, now with plain IndexedDB), after it the sync
  sends nothing and only reads (`cloud-worker.test.ts`), and what is forgotten
  (`forget-cases.test.ts`). DEC-051's list of tests names some of the files that went.
- Tests: `test/workflows.test.ts` (CI runs `verify` and no full set; the full sets run
  nightly, by hand and before a release is built; one Chrome for Testing; the nightly
  skip), `test/delete.test.ts` (Delete's two clicks, pulled out of `main.ts` for it),
  `test/browser.test.ts` (Firefox's keepalive within its idle time).

## DEC-054: The marks of won't fix and can't reproduce are "dismissed"; the pin's pink is `#e0185c` (owner)

2026-11-22. The owner: "do it", to a change made in the server of sitegloss.dev at the
same time. "Closed" meant two things: a case filed away (DEC-046), and the group of the
mark statuses `wontfix` and `cantreproduce`, so a case in the list could read "2 closed"
while it was open.

- **"Closed" means only the case.** The group is **dismissed**: the chip and the filter
  "Dismissed", the counts "2 dismissed" (the panel's list and the import prompt, the
  case's bar, case.md's `- Marks:` line), "All marks are verified or dismissed." under
  the chips, "all verified or dismissed" on the page's bar, the key `dismissed` in
  `list_cases`' `marks` and its description. The two statuses keep their names and
  labels; the other groups keep theirs.
- **In the code too**: `StatusGroup` `dismissed`, `STATUS_COLOUR.dismissed`, the tokens
  `--st-dismissed` and `--st-dismissed-bg`, `[data-group="dismissed"]`. The list of
  closed cases keeps its `data-group="closed"`: it is the case's word, and it no longer
  picks up the dismissed marks' tone by accident.
- **What keeps "closed"**: the case (`closed` in the case, in the case file `sitegloss/2`,
  in `get_case` and `list_cases`, `set_case_status`), a panel, a popover, a tab, a port,
  a stream, a shadow root. The case file has no group word; nothing in it changed. The
  v1 API keeps its wire names (the server's DEC-004): its `CaseCounts.closed` counts the
  dismissed marks, and the extension does not read it. Earlier entries in this log keep
  the word as they had it.
- **The pin's pink is `#e0185c`** (4.71:1 against white), for the strokes, boxes and
  arrows too (one colour, `MARK_COLOUR`): `#e5195f` was 4.53:1 by the formula, so close
  to the 4.5:1 a small bold number needs that a rendering difference decided it. The
  icons, the logo and the store's pictures were not drawn again. Measured once in
  Chromium (a loaded case, computed styles): the pin's fill `rgb(224, 24, 92)`, its
  number `rgb(255, 255, 255)`, no opacity on the way: 4.71:1. The 4.45:1 the server's
  check reported does not come from the extension's colours: its pins were pure white on
  the pure pink before as well (4.53:1). 4.45:1 is what a number of `#fdfdfd`, or the pink
  at 98 % over white, would give; a pin read from a screenshot's pixels can be off too,
  as screenshots are stored as WebP at quality 0.85.
- Tests: `test/contrast.test.ts` (the open stroke and pin 4.71:1), the rest renamed in
  place. No new test.

## DEC-055: The audit's judgment calls on the tests: race tests on a faked browser go or move down, pinned sentences become fragments (owner)

2026-11-22. After DEC-053 the owner settled the audit's open questions: "do them". The
rule for each end-to-end test that replaced a `chrome.*` function to stage a race, or
that proved a decision a unit test can hold: it goes when it proved one fix once and a
user would not notice its behaviour breaking; it moves down when it is the only guard of
something that matters and a small piece pulled out of the code gives it a seam. No
broad restructuring of `src/sidepanel/main.ts`, and no new harness.

- **Seams pulled out**, each behaving as before and called where the code was:
  `markChange` (`src/sidepanel/mark-change.ts`, what a command in the page's popover does
  to the case), `linkFromField` (`src/sidepanel/case-link.ts`, the case link's field),
  `Reviewer.clearFor` (`src/content/review.ts`, which case a `case:clear` takes off),
  `panelAsker` (the same file: a mark request no panel answers is "no panel shows the
  case").
  The marks' screenshot rules were testable already: `end.test.ts` drives `MarkAdder`
  with a fake worker.
- **What moved down**: the popover's commands and what it says with no panel, a clear
  for another case, the link field,
  which screenshot a mark gets (shared, after a typed value, after an undo or a failed
  capture, a mark from another route, Add mark N twice, an add held by an AI app,
  leaving with a mark not in the case), the sync's banner, Allow access and Use
  Downloads instead, who verified a mark, and a comment form surviving a finding's
  delete.
- **What went with no test left**: the wiring in `main.ts` that the races went through
  (a follow overtaken by a newer one, a stale draw's error, a busy page asked again, the
  tab New case was clicked for, an import ending while another case is open, the import
  marker kept through a save), and the worker's one line that hands the sync's status to
  the icon. A break there is found by a person, not a test.
- **Kept against the audit**, each the only test of what it asserts: the panel asking the
  page again after a draw's answer; a case opened again while its searches again wait;
  deleting a finding keeping an open comment form (`main.ts`'s `keepEdit`: every unit
  test passes without it); an AI app's mark taking the visible copy (real sizes); the
  real pen and arrow drags; a second pairing page; the marks' casing in a real shadow
  root.
- **Unit tests**: repeated tests are tables; a sentence a test pinned whole is one
  fragment that still identifies it, except where the text is the behaviour (a count, a
  name, a plural, a status, a security sentence). The ~10 MB round trip of a case at its
  history caps and the redirect test on real sockets went: every call site still passes
  `redirect: "error"`, but that Bun's fetch honours it is no longer shown. A review of
  the folds found guards they had lost (a contract case of the fake server, a bound, a
  fragment that was the test's own input, a list held by construction); each is back.
  **The price**: a wording regression no longer fails a unit test.
- Tests: `test/mark-change.test.ts`, `test/case-link.test.ts`, `test/end.test.ts`
  ("which screenshot a mark gets"), `test/review.test.ts` ("a clear for another case…"),
  `test/sync.test.ts` ("Allow access asks Chrome for the paused folder…").

## DEC-056: tab-mcp client 0.21.0 changes nothing for Sitegloss (owner)

2026-11-22. The owner approved the bump of `@ractive-ch/tab-mcp-client` from 0.20.0 to
0.21.0, once it was stable. Its breaking change is the library's DEC-215: a WebMCP call
that the tab-mcp browser extension did not vouch for is no longer asked about; the
dialog is not shown, and a tool that asks runs unless the page's `onConfirm` refuses it.

- **Not reached.** Sitegloss has WebMCP off and registers every tool with
  `callers: ["relay"]` (`src/worker/connection.ts`), so no WebMCP call can arrive. Relay
  calls are unchanged, and its `onConfirm` (`#decide`) still decides them.
- **Output schemas** are now checked when a tool is registered (`registerTool` throws on
  one the validator cannot use). Sitegloss's tools declare none.
- **`ui.strings.clientWebMcp` is gone.** Sitegloss sets no `ui.strings`.
- **`./extension`** (the pairing-code filler, DEC-049) is unchanged in 0.21.0's changelog.
- **`disconnectAll()`**: 0.21.0 fixes the case where the storage can be read but not
  written, which kept the old secret in use. Sitegloss's Disconnect behaves the same:
  `CachedSecretStorage` (`src/worker/secret.ts`) sets the new secret in memory first and
  reads from memory, so the library's failing path is not reached; a failed IndexedDB
  write is only logged, as before.
- Tests: none added; the existing ones in `test/client.test.ts`, `test/tools.test.ts` and
  `test/connection.test.ts` cover the relay-only registration and Disconnect.

## DEC-057: A mark is looked for, drawn and counted only on its own page (owner)

2026-11-22. The owner, after testing: "On the login screen I added a mark to make the
logo larger. Now on this page [another page of the same app, with the same logo in its
header], the logo is also 'marked'. That makes no sense. The URL for sure does not
match." The panel showed that mark dashed, with Show and "Unsure", while the case's
other marks said "On another page".

**The cause.** The owner's panel said "1 of 1 marks found on
app.sitegloss.dev/t/…/settings. 1 of the case's other pages may be here too (dashed).
11 more are on other pages of the case.": the logo mark, made on the sign-in page, was
looked for on the settings page, one of the case's pages, found in its header and
drawn dashed as a look-alike (`otherPage`, DEC-038 and DEC-050). A second path ends
the same way: on a page that is none of the case's every mark was looked for, and when
a mark added there made it one of the case's, `Reviewer.update` kept the earlier finds
without judging them again, so they stayed finds of this page.

The rule now:

- **A mark is the page in front's** when that page has the same path and hash route
  as the page the mark was made on, whatever the host (`onPageInFront`, `pageInFront`
  and `pathKey` of DEC-050, unchanged). Only such a mark is looked for, drawn and
  counted. A mark without an element followed this already.
- **Every other mark is not looked for**, on a page of the case that is not its own
  and on a page that is none of the case's alike: no search, nothing drawn, neither
  found nor lost in any count. The content script reports it `lost` without
  candidates (`no-element` for a mark drawn on no element); the panel says "On
  another page" for it, with its "Marked on …" link to open its page. A page that joins or leaves the case (a mark added or deleted) judges
  the marks again, and a single-page app's next route takes the previous route's marks
  off and looks for its own.
- **The look-alike goes:** `otherPage` on a match, "Also on this page?", the panel's
  "may be here too (dashed)" count, the AI tools' `otherPageNote`. The AI tools say the
  rule in one sentence: a mark is on the page in front when that page has the same path
  and hash route as the mark's page, whatever the host; otherwise it is not looked for
  (`onThisPage` false; lost, or no-element for a mark drawn on no element), and the
  mark's page is to be opened. `get_mark_element` on another page answers that the mark is not looked for there and names its page.
- **The floating bar** counts the page in front's marks only ("N of M found", still the
  open ones and those to verify); with none of them it says "no marks on this page".
- **No mark of the page in front:** the page shows none, and the case view says "This
  case has no marks on this page. They are on …" with the case's pages, and "Open the
  case's page"; "None of this case's marks were found on this page." stays for a page
  whose own marks were not found.

**What it replaces.** Of DEC-038: "On a page that is none of the case's, every mark is
looked for as before", and that a mark of another page is "on another page" only on
one of the case's pages and only when it was not found. Of DEC-050: the content
script's dashed "Also on this page?" (`#own`), `otherPageNote`, and the repeated "On a
page that is none of the case's, every mark is looked for as before".

**The price.** A case no longer loads onto the same page under another path (a build
at `/v2/cart` for a case of `/cart`): its marks are on another page there. The page is
its path, as everywhere in Sitegloss (DEC-001); the other environment is another host.
The end-to-end tests that drew a case of `/v1` on `/v2` now draw it on
`localhost:<port>/v1`, which the test server serves as the next build (`v2.html`,
`nextBuild` in `test/e2e/harness.ts`).

- Tests: `test/review.test.ts` ("a mark is looked for and drawn only on its own page,
  also once the page in front joins the case", the report's steps; the single-page
  app's next route), `test/pages.test.ts`, `test/view.test.ts`, `test/tools.test.ts`.
  The tests of the look-alike are gone.

## DEC-058: Images a person adds to a mark: by id in the case, added in the side panel, always re-encoded (owner)

2026-11-22. The owner: "When a mark is open, I'd like to have an 'add screenshot...'
button. The dialog that opens needs to support a simple cmd-v to get the image in the
clipboard, but obviously also have a classic 'Upload...' button and the possibility to
drag/drop images onto it." For what Sitegloss cannot capture, such as a menu that closes as
soon as a tool is picked. The owner settled the design's open questions the same day
(`kb/design/mark-images.md`): the word is "image", the button "Add image…" ("screenshot"
stays the case's own capture, which adds a page); at most 6 per mark, the longest side
2048 px, input up to 30 MB; the side panel first; a share link shows them; adding from the
web app comes later.

- **The format.** `sitegloss/2` gains an optional `marks[].images`, a list of
  `{ id, image, added: { at, user? } }` (`MarkImage`), absent when there are none, as
  `findings`; the zip gains `images/<id>.webp`. `validateCase` takes at most 6 per mark, an
  id unique in the whole case, the path exactly `images/<id>.webp`, and `added` as every
  stamp. The import requires each file as it does a crop ("The export lacks
  images/….webp."). The format is not released, so it keeps its name: a reader from before
  builds its marks from the fields it knows and reads only the files it names, so it drops
  the images and imports the rest.
- **By the image's id, not the mark's number.** An image is only added or removed, never
  changed, so its id (`newId("i")`) is the same here, on the wire and in a file, and needs
  no mapping in the sync's book. A crop is named after its mark (`crops/m3.webp`) and moves
  when the sync gives the mark another number; an image named by its own id never moves.
- **What counts as a change.** `fixedOf` (the drawing the sync compares) leaves images
  out: an added picture is not another drawing (the lesson of `ends`, DEC-047).
  `markSignature` counts the images' ids where a mark has any, unlike the design, which
  left them out: an image added by hand after an AI app's change must end the app's note,
  or the sync would send the image as the app's doing. A mark without images keeps the
  signature it had, so no note made before this ends.
- **The side panel, not the page.** The page's own scripts see `paste` and `drop` on
  `window` in their capture phase before the overlay's shadow root does, so a picture
  pasted on the page (maybe of another app's window) would reach the site being marked; its
  bytes would also cross from the content script to the panel as text, and the panel owns
  the store (DEC-027). The panel's open mark gets "Add image…"; later the page's popover
  only asks the panel to open the dialog for that mark. No picture touches the page. The
  panel reads the clipboard only from a paste into its dialog, so no `clipboardRead`
  permission and no install warning.
- **Limits and re-encoding.** At most 6 per mark; input up to 30 MB and 64 million pixels,
  the import's own limits (`MAX_IMAGE_BYTES`, `MAX_IMAGE_PIXELS`). The pixels are read from
  the file's header before anything is decoded (`declaredSize`): a small file can declare a
  picture whose decode alone takes gigabytes and ends the panel. So only formats whose
  header says the size the decoder will use: PNG, JPEG and WebP, what a screenshot is. No
  GIF (its decoder grows to the first frame's bounds, which its screen size does not
  bound), no AVIF (its size sits deep in the file), no SVG. A JPEG with a stray `FF 00` or
  a marker no JPEG has is refused, so the reader walks the segments as the decoder does.
  An animated picture (APNG, animated WebP) keeps its first frame, and its preview says so. Every picture is re-encoded in the panel
  (`toAddedImage`): WebP at the crops' quality 0.85, the longest side at most 2048 px
  (`ADDED_MAX_SIDE`), turned as its EXIF orientation says. 2048 px stays readable enlarged
  and mostly fits what an AI app is sent. The canvas writes no EXIF, XMP or GPS, so the
  re-encoding is what removes a photo's camera, place and time; no file name is kept; and
  the server takes WebP only.
- **case.md**: after the mark's crop, `- Images added: 2`, then each image as
  `![Mark 3, added image 1](images/<id>.webp)`, a link only where the path is the one its
  id gives.
- **From a file**: an imported image keeps the file's time, is marked `imported` and names
  nobody (as the server stores it); the panel says "from an imported file".
- **The panel**: the open mark's pictures are a grid of equal tiles with the mark's own
  screenshot first ("Screenshot", no Remove, refused by `withoutImage` by any name), then
  the added images ("Image 1"…, numbered without the screenshot), then "+ Add another
  image…". A closed mark says "+2 images". The page's popover only asks the panel to open
  the dialog (`mark:add-image`).
- **Sync** (the server's DEC-032): an image goes with a new mark (`mark.create`'s `images`)
  or as `mark.patch`'s `images.add`, removed by id in `images.remove`; its picture is
  uploaded first, as a crop's, and the blob route takes `mark:update` too. Merged by id as
  findings: the server's order, removed here stays away, added here stays, gone there goes.
  A server mark without `images` is "not told": nothing here is removed, and the shadow
  keeps what it knew. An added image whose picture does not come is left out of that read
  and said; nothing here is removed for it.
- **Never deleted unsent, never past six.** An image this device has not sent (not in the
  shadow) is never removed by a merge. `Mark.images` holds six at most, everywhere: here, in
  a file, in an operation. What does not fit once the team's images come back is held back
  in `Mark.heldImages`, this browser's own like `via` (left out of the file, the Markdown,
  the AI tools and the wire), its file kept, its tile "Not sent: the mark already holds six
  images" with its Remove. When a place frees up, here or at the server, the oldest held
  image moves into `images` and is sent as an ordinary add. So no patch carries an add that
  cannot fit, and a held image never holds back the mark's other changes (a first answer
  had it in the patch, refused whole with `limit` at every edit). A refusal for the
  storage or the role leaves the image out of the patch, said on its tile ("Not sent:" and
  why, with "Try again"); a role is looked at again at every run. Only an image the server
  took, or that the person removes, leaves the device.
- **From a file, again.** The panel re-encodes the images of an imported case as the
  dialog does, so a file's metadata or animation is not stored or synced. One case's file
  may have as many entries as the format allows (`MAX_CASE_ENTRIES`).
- **Keyboard.** A Delete or Remove clicked once redraws the list; the focus stays on the
  armed control (mark Delete, a finding's Delete, an image's Remove), and moves to the
  next picture when an image goes.
- **AI tools**: `get_case` lists a mark's images (path, when, who) and sends them after
  every crop within the size budget; `get_image` reads `images/<id>.webp`.
- Tests: `test/case.test.ts` ("images added to a mark"), `test/image-size.test.ts` (the headers), `test/export.test.ts` (round trip,
  a missing file refused), `test/markdown.test.ts`, `test/add-images.test.ts` (the
  dialog's rules), `test/view.test.ts` (the grid), `test/cloud-wire.test.ts`,
  `test/cloud.test.ts` (two devices), `test/tools.test.ts`, `test/review.test.ts`,
  `test/cloud-server.test.ts` (a real server), `test/e2e/images.test.ts` (full set: a
  pasted PNG kept as WebP of at most 2048 px).

## DEC-059: Asked once whether to keep AI access on; never on by default (owner)

2026-11-22. AI access is a session: after a reload or an update of Sitegloss, an idle or
expired session, or a browser start it is off unless "Keep AI access on" is ticked. The
owner was surprised that it had gone off, and asked to move the checkbox next to the AI
access switch and to ask about it when AI access is first turned on.

- **Where.** "Keep AI access on" and its sentence sit right under the AI access switch and
  its state line in the AI app card: it decides whether that switch comes back on by itself.
- **Asked once.** When the person turns AI access on (the card's switch, its "Turn on AI
  access" button, the top bar's pill), keep-on is not ticked, this browser never answered,
  and the connection is not taken over by another browser or program, the card asks under
  the checkbox: "Keep AI access on after a reload, an update of Sitegloss or a restart of
  the browser? Without it, you turn AI access on again each time." with "Keep it on" and
  "Not now" (`asksKeepOn` in `src/sidepanel/card.ts`). Not when AI access comes on by
  itself. It shows only once AI access is really on after that action, and goes whenever
  it is not on (a refused consent, an unreachable relay, turned off, a session that ended;
  `nextKeepOnAsk`): unanswered, it comes again the next time. A note in the card, a status
  region, not a dialog: pairing goes on, no focus is taken, nothing scrolls; while it
  shows, the sentence under the checkbox, which says the same, is hidden, so the address
  and the code stay in the first view of a narrow panel. After an answer, or when it goes
  while one of its buttons has the focus, the focus goes to the switch. Neither button is
  amber (DEC-024).
- **One answer.** "Keep it on" is the same as ticking the checkbox (the same handler,
  Firefox's consent step included). The answer is kept in this browser's own storage (the
  panel's `localStorage`, not a case, not synced) when it holds: "Not now" and unticking
  by hand at once; "Keep it on" and ticking by hand once keep-on is really on
  (`keepOnChosen`), so a refused consent leaves the question to come again. An answer in
  one panel takes the question away in another (the `storage` event). It does not come
  again.
- **Not on by default.** AI access left on means every paired AI app can reach Sitegloss
  whenever the browser runs, with the person's cases and the pages in front. That stays
  the person's choice, made once and visibly, and always undone by the same checkbox.
- Tests: `test/card.test.ts` (the table: each way AI access comes on, keep-on ticked or
  not, answered or not, taken over; the question's course; when an answer is kept),
  `test/view.test.ts` (the question's markup, its two answers, the focus when it goes).

## DEC-060: Nothing jumps; pictures at their size in a tab of the extension's own; placeholders only as hints (owner)

2026-11-22. The owner, on a case of 25 marks: Verify "lets the content jump around", the
screenshots cannot be seen larger than the panel, and the placeholders "almost look like
there's real text in it". The rules of the redesign (rules 5, 6 and 7, shared with the web
app) apply.

- **Nothing jumps.** Measured in the real panel before the change, a Verify moved the acted
  row 190 px down at 340 px wide (134 px at 460); so did Resolve's and Reopen's Save and the
  second click of Delete mark (95 to 190 px), and the focus fell to the page's start. The
  open case's mark list is drawn anew for every change, its pictures come after it, and the
  browser's own scroll anchoring cannot hold a row that is replaced. So the panel holds it
  (`src/sidepanel/scroll-anchor.ts`): a click on a mark's control or a filter chip notes where the
  row (or chip) was on screen; for 2.5 s, every frame, the page is scrolled by however far
  it moved, and when the row went (deleted, or left out by a filter) the mark that takes
  its place is held there instead. The person's own scroll (wheel, touch, a key, a press
  elsewhere) ends it. The row may still change below its top (two buttons fewer). The focus
  goes to the same row's next control that shows (its head when none does); the row's head
  is found again after a second redraw. After: 0 px for each of these at 340 and 460 px.
- **Pictures at their size.** "Open larger" on a picture shown large opens the viewer, an
  extension page (`viewer/index.html`) in a new tab: the picture fitted to the window
  (never larger than it is) or at its actual size, its caption (which mark of which case;
  for an added image who added it and when), the mark's other pictures with Previous and
  Next, ← → and F from the keyboard. It reads the case and its pictures from the extension's
  own store, so it works for a case that is not synced, and asks nothing of a server. Not in
  the web page: a picture of one site never goes through another site's page (as the add
  dialog, DEC-058). An extension page needs no permission and no `web_accessible_resources`
  (it is opened by the extension itself); the store build only gains the page's files.
- **Placeholders.** A field with a label that shows gets no placeholder that repeats it;
  a comment box gets none. A hint worth keeping becomes help under the label (the summary,
  a reopen's note), a note without a label gets one that shows (a resolution's note). What
  stays is only an address's form (`https://…`, a case's link, another server), in
  `--placeholder`: `#6e7583` on the white field (4.63:1), `#7f8797` on the dark one
  (4.62:1), clearly lighter than typed text (16.07:1 and 14.37:1); the page's dialogs, white
  in both schemes, use the same light value. `test/contrast.test.ts` holds both pairs.
- Tests: `test/scroll-anchor.test.ts` (which element is held and how far), `test/viewer.test.ts`
  (the pictures, their order and captions, the address), `test/view.test.ts` (the fields'
  help and labels, no placeholder on the comment box, "Open larger"), `test/build.test.ts`
  (the viewer in both builds), `test/contrast.test.ts`.

## DEC-061: Panel round 3, a draft for the owner to judge: the bar, Stop, the case's head, Verify, comments at the mark

2026-11-22. What the owner asked for over several messages and was parked "to discuss" is
built as a draft on `panel-round-3`, for the owner to look at on their own machine. Not
settled: what follows is what was built, and why, to be judged.

- **The bar on the page moves.** Dragged by its body (the pill by any part, once the pointer
  moved 4 px; a press without a move is its click), by the arrow keys on a handle (Shift: four
  times as far; Home puts it back), and back to the top right with a double click. It stays
  inside the window, also when the window gets smaller. Its place is the profile's, kept by
  the service worker (`bar:place`): a content script may not reach `storage.local` here, and
  a page has no say in it (two numbers or nothing, `storedBarPlace`).
- **Two states only.** "Hide marks", on the bar or in the panel, hides the marks and keeps
  the case: the bar becomes a pill with the logo ("Show the marks of «case»") at the same
  place, which brings them back. Closing the case in the panel takes it off for good. Adding
  marks shows hidden marks; hiding them ends the adding. The panel and the page are one
  switch: the page's news says which case is hidden (`hiddenCase`), and a pill pressed on the
  page shows the marks in the panel too.
- **"Add marks" on the bar**, beside "Hide marks", in the panel's words; none of the two is
  primary. While marks are added the bar steps aside (hidden): the toolbar is up with its
  Done, and nothing of Sitegloss covers what is being marked. Taken from `bar-gives-way`:
  the bar hidden while adding, "Hide marks" as the word. Left: hiding it while the side panel
  is open (a bar that moves does not cover, and a bar that comes and goes with the panel
  confuses), with the worker plumbing for it.
- **No Stop in the top bar.** The AI pill leads to the AI view, whose switch does what Stop
  did (the same command); the switch's tooltip says that it stops at once.
- **The case's head** after the web's case page: the title and a "…" menu (Rename…, Add a
  link…/Change link…, Export…, Delete case, which asks twice), the counts, one action (Add
  marks), then one quiet block of facts: Pages (folded to three, "Show all n"), Team, Link,
  Made at. "This tab is your team's web app…" is no longer in the case (Home still says it,
  DEC-045). "n of m marks found" is said only to a screen reader (a status line kept out of
  sight): the page filter's counts and each mark's word show it. "Match size" shows only when
  the tab's width differs by 24 px or more (a breakpoint can sit that close; a classic
  scrollbar is 15 px) or its height by 100 px or more. What the tab shows (the access notice,
  no marks found here, the size, adding) is under the head, where the marks start, so the head
  does not move with the tab.
- **Verify closes its mark**; the focus goes to the next mark waiting to be verified (after
  it, else before it) where it is on screen, else to the closed row's head: a focus out of
  sight would scroll the list away. Reopen… does not close it. Round 2's hold keeps the row
  in place, and now lends room below the list while it holds (taken back at the person's
  next own scroll or press): a row that closes near the list's end no longer lets the
  browser scroll the page back by itself.
- **A mark's comments are at the mark**, the last three with "Show n earlier", each with its
  own Edit and Delete, and "Add comment" there (as the web's `markThread`). The thread at the
  bottom keeps the comments about the case as a whole (and one about a deleted mark).
- **A picture opens in one step**: its tile opens the viewer; the in-panel large view is
  gone. The viewer's caption is two lines (case, mark, which picture; who and when), and
  Escape or Close closes its tab.
- **The focus lost after Reopen's Save (round 2's measurement at 460 px)**: the press never
  reached Save. The hold of the click that opened the form scrolled the list back while the
  test scrolled it, so the press landed on the field. A real person's scroll ends a hold;
  what could still pull against it was the panel's own scroll (a form's field focused out of
  sight, a Tab): both now let the hold go.
- Tests: `test/overlay.test.ts` (the bar's place, steps aside, the pill), `test/review.test.ts`
  (hide, the pill, Add marks on the bar), `test/view.test.ts` (no Stop; the menu, counts and
  facts; Match size's threshold; Verify closing and the focus; comments at the mark; the tile),
  `test/viewer.test.ts` (the caption), `test/card.test.ts` unchanged.

## DEC-062: tab-mcp client 0.22.0 changes nothing for Sitegloss (owner)

2026-11-23. The owner: "if there's no change, I recommend just bumping the library to the
latest version." `@ractive-ch/tab-mcp-client` goes from 0.21.0 to 0.22.0, and the relay
used by the tests, `@ractive-ch/tab-mcp`, from 0.13.0 to 0.13.3. (DEC-060 and DEC-061 are
taken by the panel's rounds 2 and 3, which are on branches.)

- **Not reached: `BrowserExtension` has no `version` any more** (the library's DEC-221).
  That is the state a web page reads about the tab-mcp browser extension
  (`TabMcp.extension`, the `extensionchange` event). Sitegloss is not such a page: its
  `TabMcp` runs in the service worker as a server over the relay with WebMCP off
  (`src/worker/connection.ts`), and nothing in `src` or `test` reads `extension` or
  listens for `extensionchange`. The `version` it passes is `server.version`, the MCP
  server's own, which is unchanged.
- **Not reached: a page on 0.21.0 loses the extension's state** with the tab-mcp browser
  extension after 0.3.2. Same reason.
- **The relay 0.13.1 to 0.13.3** changes its own connect page (the code shown as boxes)
  and fixes two faults in how it limits and frames requests. The filler of the pairing
  code (`./extension`, DEC-049) writes into one input, which the page still is.
- Tests: none added. `bun run verify`, and the connection and always-allowed end-to-end
  files against the new relay, were run once with the new versions.

## DEC-063: Panel round 4, a draft for the owner to judge: full width, a tool bar, folding lists, the matcher's names, images from the page's dialog

2026-11-23. On `panel-round-4`, after round 3's pictures. The owner: "Make it left
aligned. It's a pity to spoil this space on the left." and "The rest is fine", plus what he
asked in chat that night (the findings page's D10, D12, D13).

- **An opened mark uses the panel's width.** Its body starts at the panel's gutter, under
  the pin; it covers the rail there. The pictures are four a row (three below 360 px), so
  three pictures and "Add another image…" fit one row at 400 px. Verify and Reopen… show
  once: in the row's head while it is closed, in the body while it is open.
- **"Add marks" always in reach (D10).** The open case ends in a tool bar, sticky at the
  panel's bottom: "Add marks" (or "Done adding", dark while adding is on) and "Show marks" /
  "Hide marks". Being last in the flow, it rests after the content at the end, so it never
  covers the last row. The head's Add marks, the one under the list and Hide marks in the
  list's bar are gone. The scroll hold (DEC-060) lends its room above the bar, so the bar
  stays at the window's bottom while a row is held. On the page's bar, "Add marks" is amber.
- **The pages list (D13).** More than three pages: the label is a disclosure "Pages n",
  closed at first, showing only the page in front when the tab shows one; its state is kept
  per case for the session. Where the tab shows none of the case's pages it is open. One row
  per page across hosts: a page is its `pageKey` (path and hash route, DEC-038, DEC-057), as
  the list already was; a row now names its hosts under it, the last marked first, where the
  page was marked on more than one or not on the host most pages were marked on, and a click
  opens it on the tab's host when it was marked there, else on the host it was marked on
  last. Titles that differ between hosts: the row keeps the title the case's list of pages
  has (the first one recorded); the others show in no place. The owner's "Settings ·
  Sitegloss" twice is most likely two paths, not two hosts: the team's slug differs between
  app.sitegloss.dev and the local demo data (`/t/e2e-test-88406e/…` against the demo team's),
  and those stay two pages; the case itself could not be read to confirm it.
- **Comments.** The case's "Comments n" is a disclosure: open when the case has comments,
  closed when it has none, as the person leaves it per case for the session. "Seen" is not
  tracked; this is the brief's simplest rule. At a mark, "Add comment" is a button that
  opens the box with the focus in it; Cancel closes it.
- **The warning "no marks on this page" goes.** In a case of many pages a page without
  marks is normal. One quiet line where the marks start, only: "None of this case's pages is
  in this tab." (with the pages list open), "This case's page is not in this tab." for a case
  of one page, without a button, since the page's address in the facts two lines above
  opens it, or "None of this page's marks were found here." when the page's own marks were
  all looked for and none was found.
- **The page filter's menu** stood past the panel's edge: the filter is a grid item, whose
  minimum was the menu's longest option (503 px in a 340 px panel, measured). It now has no
  minimum, and the menu shrinks with an ellipsis (324 px of 340).
- **The matcher (mark 47).** In the web app's case page the mark's text and a comment each
  have a button reading "Edit", named "Edit the text of mark 47" and "Edit the comment by
  Dana Developer via Claude Code". `identity` took the better of name and text, so the text
  alone made the other Edit identified (score 0.85, "found") when the comment's was not on
  the page, during a load or while it was edited. A name that says more than the text now
  decides together with the text: the lower of the two similarities. The other Edit scores
  0.43 (lost), the comment's Delete, which shares the name's words, 0.40. With both on the
  page the right one is found (1.0). The own-page rule is unchanged.
- **Mark 48's offset box: not reproduced.** Ruled out: a box drawn before the page settles
  and never redrawn; the reviewer redraws every mark on each scroll, on resize and twice a
  second from the element's box at that moment. Left: a box is placed in proportion to the
  element it was recorded on; recorded on a container whose width changed between then and
  now (another window width, another environment), a box around a button inside it
  shrinks; and a page that zooms or transforms the root moves fixed boxes. Neither can be
  told without the mark's recorded details.
- **The AI chip shows that an app is talking.** The worker counts the tool calls running
  (`toolcall`, `toolcallend`); while one runs and 1.5 s after the last, the chip's dot
  pulses a ring in its green; with reduced motion a steady ring. A box shadow only: nothing
  moves. The chip's name does not change and no live region speaks: calls come in bursts,
  and the AI card already says the last call in words.
- **Images from the page's mark dialog (D12): tested first.** In Chrome, with trusted input
  from CDP, into a textarea in a closed shadow root and into Sitegloss's own dialog, a
  listener of the page on `window` or `document` in the capture phase:

  | What the person does | The page sees | The page can read the file |
  | --- | --- | --- |
  | Pastes an image | `paste`, its target the shadow host | Yes: `clipboardData.files`, bytes read |
  | Drops a file | `dragenter`, `dragover` with the type "Files", then `drop` | Yes: `dataTransfer.files`, bytes read |
  | Picks a file with a file input | `input`, its target the host; no `change` | No: the input is out of reach |

  So the dialog takes no pasted or dropped image. It has "Add another image…" (the words of
  a loaded mark's popover): the mark is done, the worker opens the side panel with the
  click's gesture (it opened a closed panel in the test) and the panel's own dialog opens
  for the mark once it is in the case. A file picker in the page's dialog would be safe, but
  is not built: the panel's dialog picks, pastes and drops with the same limits (six per
  mark, PNG, JPEG or WebP, re-encoded), and a second way of adding images would diverge.
  The wish passes through the worker (session storage), for the panel beside that tab only:
  the panel itself touches no storage.
- Tests: `test/match.test.ts` (two buttons named Edit in one card: failed before),
  `test/page-hosts.test.ts`, `test/view.test.ts` (the tool bar, the disclosures, the quiet
  line, the chip, Add comment at a mark), `test/e2e/panel.test.ts` (the quiet line).

## DEC-064: Panel round 5, a draft for the owner to judge: the picture in a window of its own, the page's fields in a frame, corners, the weak points

2026-11-23. On `panel-round-5`. The owner, on round 4: a picture opening in a new tab is
"super confusing", it should be a modal that Escape or an ✕ closes; the paste into the
mark's dialog on the page that the page can read: "fix it"; buttons and elements "a bit
less rounded"; the lead's weak points: "all valid. Please fix them."

- **Probes first (Chrome, trusted input from CDP; listeners of the page on `window` and
  `document`, capture phase, registered before Sitegloss's content script):**

  | Shown or typed | Inside the closed shadow root | In a frame of another origin in it |
  | --- | --- | --- |
  | Keys typed | every `keydown`, `keypress`, `keyup` with `key`; `beforeinput` and `input` with `data` | nothing |
  | Text pasted | `paste` with the text in `clipboardData`; `beforeinput`/`input` with it as `data` | nothing |
  | A picture | its bytes in the page's process; a `blob:` URL the page can fetch if it learns it (not listed in resource timing) | nothing of it; `window.length` 0; `window[0]` and navigating the frame refused |
  | What the page still learns | that the host exists and covers a point (`elementsFromPoint`) | the same; that the focus moved to the host (`focusin`, `blur`); for an http frame resource timing lists its address, for the extension's frame nothing |

  The order of listeners cannot help: Sitegloss's content script is injected when needed,
  after every script of the page; only a content script registered at `document_start`
  (which needs the host permission ahead) runs before a page's own. The frame does not
  depend on order.
- **The page's fields in a frame.** A new mark's comment, a loaded mark's comment and the
  resolve and reopen notes on the page are `field/index.html`, a page of the extension in a
  frame (`src/content/page-field.ts`), talking to the content script over a MessageChannel
  handed to it once; nothing is posted to the page's window and no address carries data.
  End-to-end test (`adding.test.ts`): keys and a paste of text in the dialog; on round 4
  the page heard every key and the pasted text, now nothing, and the comment is saved.
- **What the field's frame needs in the manifest, for the stores.** A page of the
  extension in a frame on a web page has to be listed in `web_accessible_resources`:
  `field/*` (its HTML, script, style sheet and source map), for `<all_urls>`, since a
  person may mark any page Sitegloss is allowed on. Nothing else is listed (the viewer
  opens in a window of the extension's own and needs no entry). What a page could learn
  that it could not before: in Chrome, any page could load
  `chrome-extension://<the store id>/field/index.html` and so learn that Sitegloss is
  installed, on every site, also where Sitegloss was never used; before, a page could
  only see Sitegloss's host element, on a tab where the person had opened Sitegloss.
  So Chrome's entry has `use_dynamic_url: true`: only this browser session's address
  works (Chrome 130 and later; older versions ignore the key). Measured in Chrome 156: a
  page's fetch of the fixed address is refused (it was answered 200 without the key), and
  the field still loads from `chrome.runtime.getURL`. So Sitegloss now needs Chrome 130
  (October 2024) or later; Chrome 116 to 129, and Edge before 130, can no longer install
  or update it. Firefox has no such key and needs
  none: each install has an address of its own (`moz-extension://<a random id>`), so a
  page cannot try one. The field page shows nothing and reads nothing until the content
  script hands it its port; loaded by a page itself, it is an empty, disabled field.
- **The picture in a window of its own (the owner's choice).** The owner, between the
  two candidates: "That would be great if you wouldn't need to modify the page that is
  actually shown." So a tile's click asks the worker for the viewer in a small window
  of the extension's own (`type: "popup"`, `src/worker/viewer-window.ts`), centred over
  the panel's browser window; the viewer sizes it to the picture once loaded, within the
  screen (measured: a 640×300 picture in 674×476, a 1200×2400 one in 1234×1168 on a
  1920×1200 screen, both centred). One per browser window: the next picture is shown in
  it (the same window id). Escape or ✕ Close closes it and focuses the browser window
  again; the panel puts the focus back on the tile. It closes when the case is left or
  closed and when its browser window closes (the worker hears it; measured). No tab in
  the tab strip; "Open in a tab" stays in the viewer. Nothing of it touches the page in
  front (no mutation measured). An overlay on the page was built first and taken out
  before this was pushed again; its probe had run: the page saw no frame, resource or
  key, only that Sitegloss's host covered it.
- **Full screen on macOS and small screens: not checked.** The test browser has no
  macOS full-screen space; a popup of a full-screen window may open in a space of its
  own there. Nothing is done differently for it yet; on a small screen the window is
  the screen less 16 px on each side.
- **Firefox (160, headless, the Firefox end-to-end set):** the field's frame works:
  the focus is in it when the dialog opens, text typed goes in (inserted as an input
  method does), Ctrl with Enter and Escape close the dialog with the comment kept, and
  the page's listeners heard nothing. A real paste could not be driven there (no
  trusted clipboard in that harness). A picture opens in a window of type "popup" with
  one tab, and Close closes it; how Firefox draws the popup's reduced address bar was
  not seen (headless).
- **Corners:** controls 6 px (the top bar's buttons, the page filter's menu, the page
  counts, a tile's remove), cards and the mark's body 8 px, the page's bar and dialog
  10 px with 6 px buttons; status chips and pins stay round.
- **A closed mark to verify** has Verify, small and secondary, in its title line; Reopen…
  only in the body. Its row is two lines like the others (104 px before, 88 at 340 px
  where the title wraps beside the two buttons).
- **The tool bar is calmer:** 6 px padding, 30 px buttons, Add marks in the secondary
  look at rest; while adding it is amber and reads "Adding marks: Done". What is scrolled
  into view stops above the bar (`scroll-padding-bottom`).
- **The case card:** the summary right under the title in the text's colour, 13 px, a gap
  before the facts; no band without marks.
- **The pin in new screenshots** is 20 px (a note's 24), its number 11 px; on the page the
  same. Pictures taken before keep their pins.
- **The list rebuilt on every change (not changed):** a list that updates its rows in
  place would key each row by mark with a key of its own (status, comment, match, open,
  thread), replace only the rows whose key changed and move rows by `insertBefore`. It
  touches `renderCase`'s list block and `markItem` in `src/sidepanel/view.ts` (about 600
  of its 3980 lines to read, 250 to 400 to change), makes most of
  `src/sidepanel/scroll-anchor.ts` (203 lines) unneeded, and changes about ten tests in
  `test/view.test.ts` that hold rows found before a render.
- **The `extension` test that failed now and then ("v1 on v2", mark 4 probable at 98%):**
  its mark 4 was the filler above the footer, not the footer. The screenshot of mark 3
  scrolled the page while the test aimed at the footer, and the click landed one element
  higher; v2 has the filler. The test now waits for that screenshot (5 of 5 passed after,
  3 of 5 failed before).
- Tests: `test/view.test.ts`, `test/review.test.ts` (the frame field driven by its
  messages), end-to-end `adding` (keys and paste never reach the page), `images` (Add
  another image… from the page's dialog), `look`, `panel`, `extension`, `verify`, and in
  Firefox the field (focus on open, typing, Ctrl+Enter, Escape, nothing heard by the page)
  and the viewer's popup window.
- **Review of pull request 53 (23 findings), what changed of the above:**
  - Matching: a name that says more than the text weighs 0.7 and the text 0.3, instead of
    both having to match (that lost a "Notifications" button whose badge changed, a
    labelled region with other data, an Edit under another user's name). The other Edit
    and the Delete beside it still come out lost or probable, never found.
  - The field's frame: the hello names a token the content script put in the frame's
    address fragment, carries one port and is taken once; the frame says it is ready, and
    where it does not come up within 4 s the dialog says so and offers "Write it in the
    side panel", which opens that mark's comment, resolve or reopen form there. Measured:
    a page with `frame-src 'none'` does not stop the field in Chrome or in Firefox (both
    exempt the extension's frame). A frame that loads again (the overlay moved into a
    modal dialog of the page) gets back its text, label, state and focus; where the
    browser has `moveBefore` it is not loaded again, and the overlay is not moved for
    order alone while a field is open. Enter and Escape of an input method do nothing.
  - The scroll hold's room is no longer taken back at a press; it goes back only as it
    scrolls out of sight, so nothing on screen moves. The status line says what a draw
    found once it settled (after the searches again), and only when that changed.
- **Second review of those fixes (8 findings):**
  - Matching, reworked again so the four cases hold together (one test for all four):
    the same text under another name is never found (the two "Edit"); a text that changed
    under a name only that element carries is found when the text is short (a count, 12
    then 3); a name several candidates carry ("Open case" on every row) counts only with
    the text; and a text long enough to compare that is another text altogether leaves
    the candidate probable at best, also when one row is left and its name is now on no
    other element. The price: a labelled region whose whole content changed is drawn as
    probable, not found; nothing recorded tells it from the one row left of a list
    (recording whether the name was shared when the mark was made would, and needs the
    case format to grow).
  - The field's token is used once: every load of the frame gets a new address and token
    before anything is handed, the frame takes one hello per load, and the frame cannot
    be seen or typed in until it answered that load's hello. Measured in Chrome 156 and
    Firefox 160, with the page's own listeners and a PerformanceObserver: the page sees
    no resource or navigation entry for the field's frame, before or after it moves the
    overlay itself (a plain append, which loads the frame again), `window.length` stays 0
    and `window[0]` is undefined; so the page cannot read the frame's address or token.
    After the page's move the field was at its second address with a new token.
  - Also: a late "ready" puts the focus into the field; the focus is restored after a
    move from what the overlay saw before it, not from the frame's blur; an action's hint
    is said again when it repeats; a draw that stops early stops settling; the viewer's
    queue leaves no rejection unhandled; tests now exercise what their names say.
- **The picture viewer, after the owner tried it** ("much better now", three points):
  - "Actual size" changes something only for a picture larger than the window; one that
    fits (or fits exactly) shows at 100% and the control is disabled with "This picture
    is shown at its actual size". The control reads "Actual size (100%)" while fitted
    and "Fit to window" at the actual size, the zoom beside it ("Fitted: 77%", "100%");
    the picture stays centred in both states (at its actual size the view starts on its
    middle), and the bar does not move. Measured: 400×200 and 640×300 shown at 100%,
    nothing to switch; 2400×900 fitted at 77% and 800×2400 at 41%, their centres the
    same before and after the switch, every control of the bar at the same place.
  - The window opens at its size and place in one step: the panel reads the picture's
    size from the store, the worker works out the bounds before `chrome.windows.create`
    (with the frame above the page the last viewer measured, 88 px at first), the
    page paints the viewer's ground from its first frame and shows the picture once it
    is decoded. Measured: each window's bounds took one value from creation on; a reused
    window changes its bounds and its picture together. (The headless test browser kept
    its first window at its default 1280×800, which a real browser does not.)
  - One picture: no Previous, no Next, no "1 of 1", and the arrow keys do nothing.


## DEC-065: "Pages" is a heading that opens and closes its list, and the list is flush left

2026-11-23. The owner, on the panel as merged: "Keep the list of sites left aligned and
let the 'Pages' title bar be collapsible like '> Comments' and '> Screenshots'". The
list of a case's pages sat in the second column of the facts block, beside the label
"Pages", so a third of the panel's width was empty on its left.

- A case with several pages has a section of its own in the case's head, before the
  facts: the heading "Pages 12" is the control (the same look and behaviour as
  "Comments"), and the list is under it at the panel's full width.
- The heading is there from two pages on. Not chosen by the person: open up to three
  pages, closed for more, open where the tab shows none of the case's pages. A choice
  holds for the case, this session (DEC-063, DEC-064's review).
- Closed is closed: no row of the list shows. DEC-063's "closed, it still shows the page
  in front" is gone: a closed list that keeps one row does not read as closed. Instead
  (the owner: "why not having 'Current page' above the collapsible '> Pages'? Give it a
  try") the page in front has a row of its own above the heading, under the label
  "Current page", whether the list is open or closed; there is none where the tab shows
  none of the case's pages. The label names it, so only the list's row has
  `aria-current`.
- A list that closes by itself (the tab moved to a page of the case) while the keyboard's
  focus is in it hands the focus to the heading.
- A case with one page keeps its address among the facts, under the label "Page".

## DEC-066: The Highlight tool, and marks of a kind made with a newer Sitegloss

2026-11-23. On `highlight`. The owner, with the logo's swipe behind "gloss": "I'd like to
be able to highlight a text and then add a note to this highlighted text and this could
then be marked like in the sitegloss logo." On the lead's proposal of a Highlight tool:
"I like The 'highlighted' tool. Do it." On compatibility: "For now it's ok. But for the
future, make it backwards compatible and load the mark somehow as 'Unknown' or however."
The service's side is its DEC-040; the format both build to is one contract.

- **The format.** A highlight is no new kind of shape: a mark with shape `box` (the box
  round the text's lines) and an optional `highlight`: `text` (whitespace collapsed, 1 to
  500 characters), `before` and `after` (at most 32 each, the text right around it in its
  element), `rects` (1 to 40 line boxes, in the shape's coordinates, each with a width and
  a height above zero and inside the shape's box, 4 px of tolerance). Its element is the
  nearest element that holds all of the selection. Outside the limits the highlight is
  dropped and the mark kept, here as at the server. A version that does not know the
  field sees a box with the same comment.
- **Selecting through the layer that takes the pointer.** The tools' layer covers the page
  and stops every press there, so a page's link or button is never activated. For the
  Highlight tool it stays: on the press and each move the place in the page's text under
  the pointer is read with `caretPositionFromPoint` (`caretRangeFromPoint` where that is
  missing) while the layer is let through for that synchronous call alone, and the page's
  own selection is set to it (`setBaseAndExtent`). Over Sitegloss's own (a pin, the
  toolbar) Chrome gives the caret as the host's place in its parent (measured: `(HTML, 3)`),
  so a point where `elementFromPoint` is the host has no caret, and a drag keeps its last
  one; a caret inside an editor is refused too, as setting the selection there focuses
  it. A double click takes a word, a triple click a paragraph: counted by `click`, since
  `pointerdown`'s `detail` is 0 in Chrome (measured, presses 1 to 3); a double click waits
  450 ms for a third before it takes its word, or its dialog would be closed by the third
  press. A selection made before the tool is chosen counts too, taken at the press of the
  button (the press would clear it). Probed in Chrome, listeners of the page
  in the capture phase on `window`: during a drag the page hears `pointerdown`,
  `pointermove`, `pointerup` and `click` retargeted to Sitegloss's host (as with every
  tool), no `mousedown`, and `selectionchange`; it can read which of its own text is
  selected, as with any selection. Typing the comment it hears no key (the field's frame,
  DEC-064). The selection is cleared when the dialog opens. Nothing typed into fields and
  editors is read: such text cannot be highlighted, and their text is left out of
  `before` and `after`.
- **Limits, said in the toolbar.** Text in a form field, an editor, an image, a canvas,
  an SVG, a frame or a component's shadow root (the caret does not reach into one): the
  dialog does not open, the hint names the Box tool. Text that is there but shows nowhere
  says so. An element's text is read up to 50,000 text nodes with words (one look at that many: about 66 ms in Chrome; 200,000 took 337 ms); past that a
  selection says it reaches too far, and a quote not found is not called changed. A selection
  longer than 500 characters or 40 lines is cut to that and the toolbar says so. Frames
  as for the other tools: the page's top document only.
- **The stroke (decided here).** The logo's swipe (`swipe` in `logo.ts`: its uneven
  corners and its lean) round each line box, a little wider than the text, in the logo's
  amber. It turns as the swipe does only as far as its ends move no more than the logo's,
  or a long line would climb onto the next. The pin sits just left of the first line,
  centred on it: above it, it covered the line before; on it, the first letters. On a
  light ground the stroke is multiplied with the page, in a layer of its own outside the
  overlay's stacking context (inside it, there is nothing to multiply with); on a dark
  ground (the element's backdrop below the luminance where black and white text are equal)
  it is laid over the page at 30 % opacity. Text under it, measured (a unit test holds
  it): ink #1b2130 on white 16.1:1 becomes 9.8:1, grey #535c6e 6.7:1 becomes 5.5:1, #767676
  4.5:1 becomes 3.9:1 (as under a real marker); #eceef3 on #121212 16.1:1 becomes 7.1:1,
  on #1b2130 13.8:1 becomes 6.1:1. 40 % was the first choice; it took light text on the
  ink colour down to 4.5:1. The same stroke is painted into the screenshot and the crop.
- **States (decided here).** The stroke stays amber in every state: it is the highlight.
  The pin takes the status colour, as every mark's; verified and dismissed fade the
  stroke as they fade every mark; an unsure match (probable, a tie, the text changed) adds
  a dashed edge in the status colour round each line, as the other marks are dashed;
  the mark looked for adds a solid one. Not found: not drawn, as before.
- **Finding it again.** The element as for every mark, then the text in it (`quoteIn`:
  of several places, the one whose text around it is most like `before` and `after`),
  drawn on the lines that text has now, from a live range. Where the text is not in the
  element any more, often the fix itself, the element is drawn as a box, a found match is
  only probable (`textChanged` in the match), and the panel says "Text changed" and why.
  While the case is drawn, a change under the live range (it collapsed, left the page, or
  holds other text: a fix that set one of its text nodes) has it looked for again. A text
  that was gone is looked for again only after the page changed (a MutationObserver
  counts changes, Sitegloss's own host left out), one such highlight every 2 s, in turn:
  each look reads all of its element's text. Show, and an AI app's add_mark, scroll to the
  text's first line in every pane it is inside (innermost first), then the window; text
  that shows nowhere scrolls its element into view. A highlight in an element too long to
  read says so in the panel ("Text not looked for") and to an AI app (`textUnread`).
- **Where it shows.** The panel's row quotes the text on one line, cut, beside the status;
  the toolbar names the tool with a tooltip; get_case carries the highlight (its text and
  the number of lines in a large case); add_mark takes an optional `text` to highlight
  inside the selector's element; the match views say `textChanged`; case.md has
  "Highlighted text:" as the server's does; files and the team carry it as is.
- **Marks of a kind this version does not know.** Until now a file or a team's case with
  one was refused ("unknown shape") and that case stopped syncing. Now such a shape is
  kept as `{ kind: "unknown", given }`, `given` exactly as it came; a file and the server
  get `given` back (`shapeOut`), and a read looks at it anew, so a version that knows the
  kind draws it. The mark is listed with its number, comment, status and thread, named
  "Newer kind" with a hint to update, and can be commented, settled and reopened; it is
  not drawn and has no pin on the page (its element is outlined while it is looked for);
  Show is not offered when it has no element. A shape without a kind's name (1 to 64
  characters, no control characters), or larger than 256 KB, is still refused: that is a
  broken file, not a newer one; from the server a kind without such a name is kept under
  "unnamed", and a shape over the size as its kind alone (the server keeps all of it).
  **Not sent to a team that does not have it**: API v1 takes only the kinds it names, so
  `mark.create` would be refused for good. Such a mark waits here, comments about it wait
  with it, and the sync counts both as nothing to send; a newer version sends them. The panel's hint says so.
- **Unknown fields, where they survive.** `validateCase` keeps every field it does not
  know on a case, a screenshot and a mark (it ran on every change, so they were lost on
  the first comment), each up to 16 KB as JSON, at most 32 on one part and 256 KB on a
  whole case; what is over is left out without a word (the import has no place for such a
  note, and no version writes fields that large). So they survive an import, a change in the
  panel, adding a mark (`saveCase` carries the case's), the store and an export. Not on an element's details, whose allow-list is a privacy rule (DEC-009), nor
  inside a resolution, a finding, a comment or an image. They are never sent: the sync
  builds what it sends from known fields, and a teammate's mark comes in from the
  server's known fields only. An AI app's views name their fields, so it sees none of
  them. **A rule for later versions:** a field from a file is kept unmarked, so a field
  that only the browser may write (as `via` and `createdVia` now) cannot be told from one
  a crafted file brought, once a later version knows it. Such a field must be dropped on
  import by name, as `storeImport` drops those of today, and dropped again when read
  from a case that has `importedAt`, unless the field is about something done here after
  the import.
- **What the released version (0.3.1) does with a highlight.** Its case format is the old
  one; a file of this version is refused by it, and the other way round. Through the
  team: it drops `highlight` when it takes in a teammate's mark, but what it sends of a
  change to that mark (comment, status, findings) is a `mark.patch` that does not carry
  it, and the server keeps it. Only a `mark.create` built by 0.3.1 (a mark the server
  does not have) comes without it, which a teammate's existing highlight never needs. A
  highlight made now is therefore not lost by a teammate on 0.3.1; they see a box.
- **case.md and page text.** `inline()` now also escapes a scheme's colon before `//`,
  the dot after `www` and `@`, as the server's does: a previewer makes no live link of an
  address in someone else's text (highlighted text, titles, element names).
- **What remains.** Auto-scrolling while dragging near the window's edge, as a native
  selection does, is not built. Text in a component's shadow root and in frames cannot be
  selected with the tool (refused with a hint). Firefox runs the same code (it has `caretPositionFromPoint`)
  and was not driven through a highlight by hand.

## DEC-068: tab-mcp client 0.23.0: the WebMCP mirror, on by default there, stays off here (owner)

2026-11-23. The owner: "yes, bump it to 0.23.0". `@ractive-ch/tab-mcp-client` goes from
0.22.0 to 0.23.0; the relay used by the tests stays `@ractive-ch/tab-mcp` 0.13.3, its
latest. (DEC-067 is taken by the panel's pages grouped by site, which is on a branch.)

- **Breaking in the library (its DEC-222): `webmcp` is on by default.** A `TabMcp` then
  also registers its tools with the browser's WebMCP in its own document. Sitegloss has
  one `TabMcp`, in the service worker (`src/worker/connection.ts`), and it now says
  `webmcp: false`: its tools are for the AI apps that connect over the relay, not for
  whatever calls WebMCP in an extension's document, and the mirror is a chunk loaded
  with `import()`, which a service worker refuses and the build test forbids. Nothing
  changes for a user: the mirror was off before, by the old default (DEC-062).
- **Not reached:** several `TabMcp` of one app in a page now tell the tab-mcp browser
  extension one list of AI apps. Sitegloss has one, and not in a page.

## DEC-067: A case's sites: on its card, and its pages grouped by site in its head (owner, a try)

2026-11-23. The owner: "To make word 'site' of the name 'sitegloss' appear somewhere, let's
gather the 'sites' of a case [...] What about 'domain' == 'site', incl. all subdomains? Maybe
exclude 'localhost' or 127.0.0. and ::1 etc. [...] We just discussed the '> Pages' collapsible
section. Maybe this could be a main heading 'Sites' and then per site a collapsible section." On
grouping only cases of two or more sites: "Maybe it's ok if the only site is by default
expanded? I'd give it a try to see how it feels." A try, built properly; sitegloss.dev has the
same on its case card (its DEC-041).

**The rule is the server's** (`packages/api/src/v1/site.ts`); `siteOf` and `sitesOf` in
`src/lib/site.ts` are this repository's own, and `test/site.json` is a byte copy of the server's
`packages/api/vectors/site.json` that they pass, held as `page-key.json` is. A site is the
registrable domain of an address's host by the public suffix list with its private section
(`app.dev.sitegloss.dev` is `sitegloss.dev`, `foo.vercel.app` its own, `shop.example.co.uk` is
`example.co.uk`). No site: a host whose ending is on neither section of the list (`.lan`,
`.home`, `.corp`, `.localdomain`, `.intranet`, `.local`, `.test`, `.internal`, `.invalid`),
except `.example`, the one named exception, which tests and demos use; `localhost` and names
under it; `home.arpa` and names under it (on the list, but the home network's); IP addresses; a
host without a dot; a host with an empty label (`.com`, `a..com`); anything but http and https.
Every trailing dot is dropped first. (The lead decided the ending rule after the review, in place
of a growing list of local endings, for both repositories.) Lower case; an international name in its ASCII form
(`xn--bcher-kva.de`), as `new URL` gives the host. A case's sites come from its pages and its
screenshots, most pages first, then by name. Never stored: no change to the case format, the
sync or the manifest.

- **`tldts` 7.5.5 holds the list** (MIT, with `tldts-core`; both in `LICENSES.txt`, the build's
  `mitText` taking an MIT text without its title). The second runtime dependency after the
  tab-mcp client: the public suffix list changes every week and is not a few lines of own code.
  Only the side panel and the worker load it: the panel's chunk grew from 231,500 to 365,163
  bytes and `background.js` from 353,660 to 485,676; `content.js`, which runs in every web page,
  is 125,709 bytes before and after, and a build test checks that it holds none of it.
- **The card**: "sitegloss.dev · 8 pages", two or three sites named, more counted ("a.ch, b.ch
  and 2 more sites · 30 pages"); a case only on local addresses says its first page's host; a case
  of one page on one site keeps its address, which names the site. Its name for a screen reader:
  "on sitegloss.dev, 8 pages".
- **The case's head** (DEC-065's section): "Current page" stays above, as it was. Under it the
  heading "Site" (one group) or "Sites" (several), not a control. Each site is a heading of its own
  that opens and closes its list, "› sitegloss.dev 12", the same disclosure as "Comments"
  (`aria-expanded`, `aria-controls`, the whole heading the hit area). The rows are the rows of
  before: one per page whatever the host, its hosts under it where they differ.
  - One site: its list is open at first, however many pages it has (the owner's wish; DEC-065's
    "closed above three pages" goes). Several: the sites of the page in front are open, the others
    closed; where the tab shows none of the case's pages, all are open. A choice holds per case
    and site for the session. A list that closes by itself with the focus in it hands the focus
    to its heading.
  - A page marked only on local addresses is under the case's site when it has one; with no site
    at all, the one group is named by the first page's host ("localhost:3000"); with several sites
    such pages are in a group of their own at the end, **"Local addresses"** (decided here: right
    for the usual case, a development server; a public IP lands there too).
  - A page marked on two sites is in both lists; the page in front gets `aria-current` once.
  - A case of one page keeps its "Page" fact and gets "Site" (or "Sites") beside it.
- **AI tools**: `list_cases` and `get_case` give `sites`, a list of strings; nothing else changes.

**What remains**: two sites' pages with the same path are still one page (DEC-038), listed under
both sites. Making the site part of a page's identity would take a new `pageKey` on both sides
(site and path, with local addresses taking the case's site, which is ambiguous once a case has
two), new vectors, the server recomputing every case's list of pages, and every installed
version agreeing on it, since each computes `pageKey` itself: a change of the contract, not of
the display. The page filter's menu does not group by site (the web's does).

**After the review** (the same day):

- **A row under a site's heading names only what the heading does not**: another host of that
  site, or a local host; never the site's own name, nor another site (the row is under that
  site's heading too). The row above the heading ("Current page") keeps all its hosts.
- **A site none of the listed pages is on gets no heading**: a case keeps 200 pages, but its
  screenshots of later pages still count for its sites (the card, `sites`).
- **The rule runs once per address and per case**: `siteOf` keeps the last 5,000 answers, and a
  case's sites and groups are kept per case object while its change time and its counts of pages
  and screenshots stay the same.
- **When the sites change, their headings are kept by name and only moved**, and the focus goes
  back to the heading or the row it was on; a row whose site left goes to the same page in the
  first list that has it.
- **The build test checks the list's data** (`xn--p1ai`), not an option's name: in the worker and
  the panel, never in `content.js`.
- `CLAUDE.md` names `tldts` beside the tab-mcp client, and where it may be loaded.

## DEC-069: What comes next on the open case, and the hand-over's small part

2026-11-23. The owner, on 22 November: the panel should tell the user the next step once
marking is done, copy the share link from the extension, and copy the instructions for
the AI agent there too. On 23 November: "Yesterday we also discussed the flow of a case
and that we should help the user do the next step. So when the PO or the tester tested
things, how will he proceed? How will he hand this over to a dev? Or when the dev or AI
agent is done, how is it handed back to a PO? [...] I think this also never appeared,
even if we discussed it multiple times."

One block on the open case, directly under the counts: one sentence on where the case
stands and the buttons that move it on. Quiet: a line of text and the panel's small
buttons, no colour or banner of its own. The counts stand right above it, so the sentence
does not repeat them. No change to the service's API or the case format. The rule is one
pure function (`nextStep` in `src/sidepanel/next-step.ts`); the block is drawn by
`next-step-view.ts`.

| The case | It says | It offers |
|---|---|---|
| Closed | (no block) | |
| No marks | Draw on the page and say what is wrong. | Add marks (not while adding: the tool bar's button is Done then) |
| Every mark settled | Every mark is settled. | Close case, where the role lets |
| Marks fixed, none open | Check the fixed marks on the page that has the fix. | Start verifying |
| Marks fixed and open | That sentence, then the open marks' sentence below | Start verifying, then the open marks' buttons |
| Open, the server has it in this team | Send the case to whoever fixes the open marks. | Copy link; Copy for your AI app |
| Open, the team's, the server not known to have it | It is being sent to the team / It is not with the team yet: the server cannot be reached / The team does not have it yet: Team in the list of cases says why / It goes to the team with the next sync; its link works once it is there. | nothing |
| Open, the sign-in ran out | Your sign-in ran out, so changes stay in this browser: sign in again under Team in the list of cases. | nothing |
| Open, only in this browser, may be shared | It is only in this browser. Share it so whoever fixes it can open it. | Share with team |
| ... the role may not share | It is only in this browser. Your role in "T" does not let you share it: export it to send it as a file. | Export… |
| ... nobody signed in, or no team chosen | It is only in this browser. Export it to send it as a file, or sign in (choose a team) under Team in the list of cases to share it. | Export… |

Decided, and why:

- **The link only on the sync's own word.** A case's link and the AI app's instructions
  are offered only where the server confirmed the case, as its book is now, in the team
  chosen now (`confirmedTeam` in `book.ts`): a synced book with the server's copy
  (`shadow`) and no read of it pending that holds back what is sent. A book taken up
  again after a sign-out or a switch of team (`resumed`), joined with the team's copy
  (`join`) or missing here holds a copy of before until the server answers; a `failed`
  read leaves the server's copy as it was. The worker publishes the result beside the
  modes (`atTeam`: case id to team id) at the end of every run and wherever the modes
  change, writing only when it differs from what is stored, so a run stopped before the
  write is made good by the next. Nothing of the case itself is proof:
  an imported file's marks carry `createdBy` too, and a case the sync has not seen counts
  as the team's. The sync's overall status is no proof either: cases held back or waiting
  to be read again are not in its count of what waits. The team id in it keeps a case of
  the team before a switch from getting the new team's address. Until then the block
  says why there is no link yet.
- **Settled and to verify come before sharing.** Closing a settled case and verifying a
  fix are the same whether the case is the team's or this browser's. With fixed and open
  marks both, both are said and both offered (Start verifying first): the open ones still
  need handing over while a fix waits to be checked.
- **Copy link** copies `<server>/t/<team slug>/cases/<case id>`, the address the web app
  gives a member. The panel had no such address before: the slug, which the server always
  sent with the teams, is now kept in the panel's account (`slug`). It says: "Link copied.
  It opens the case for the members of "T"; for anyone else, use Share… in the web app."
  A refused clipboard (mostly a panel without the focus) says "Copying did not work.
  Click in the side panel and try again." Either is said for eight seconds, and only
  while the step still offers that copy.
- **Copy for your AI app** copies the web app's case template word for word
  (`caseInstructions` in sitegloss.dev's `apps/app/src/lib/agent-instructions.ts`),
  copied into `src/lib/agent-instructions.ts`, with one line of the extension's own: that
  reading the live page is the extension's AI app connection and the MCP server has the
  case as stored, as the web app's AI app page says it. The two files are kept in step by
  hand (no test can read the other repository); the file's header lists where they
  differ. The service's copy lacks the extension's line until it takes it.
- **"Start verifying", not "Verify".** A mark's own Verify settles it; a second button of
  the same name that only filters and scrolls would be taken for "verify all". It shows
  the marks to verify on every page, opens the lowest-numbered and brings it into view,
  as a pin clicked on the page does. If none is left by then (verified by the team
  meanwhile), it says so and lets go of that filter.
- **The same actions as their other places.** Add marks is the tool bar's `addMarks` and
  is off (with its title) where that one is; Share with team is the Team row's
  `cloudShare`; Export… is the menu's `exportCase`; Close case is the footer's
  `setCaseClosed`. Those places stay as they were.
- **Keyboard and screen reader.** The block is a `section` named "Next step"; its
  sentence is an `aria-live` paragraph written only when its words change; what a copy
  did is a `role="status"` line under the buttons. Both stay rendered while empty (out
  of sight, not `hidden`), so a reader hears what is written into them; the section has
  its name only while it says something, so an empty one is no landmark. A copy clicked
  after the case stopped being confirmed copies nothing and says so. A click that
  changes the buttons keeps the focus on the same action where it is still offered,
  else on the block's first button, else on the block.

What step 2 (an assignee, the case's states, "my cases", a mail on hand-over and
hand-back) will need from this block: `Where`'s team branch gains the assignee, and
`nextStep` a row per hand-over state (open and assigned to someone: say to whom, offer
"Hand over…"; all fixed: "Hand back to" the reporter); "Copy link" stays as the way
outside the mail. The API needs the assignee and the case's state first; the block needs
no new place in the panel.

## DEC-070: Escape takes a new mark back while its comment is empty (owner)

2026-11-23. The dialog that opens as a mark is drawn got "Cancel" where it said "Delete
mark" (pull request 57), and Escape still did the opposite: it kept the mark. The lead
asked whether Escape should discard a new mark while its comment is empty; the owner:
"Yes".

- Escape with nothing written (blanks count as nothing) takes the mark back, exactly as
  Cancel does, and the toolbar says "Mark N taken back". With something written, Escape
  keeps the mark and the words, as before: Escape never throws words away.
- A mark without a comment is still possible (an arrow or a stroke that says it all):
  Done, the save key and a click beside the dialog keep it. Only Escape changed.
- The window's Escape handler takes the person's own key only (`isTrusted`): before,
  a page's script could close the dialog with a made-up key; now it could have taken a
  mark back with one.

## DEC-071: A case is handed over: its assignee, its state, whose turn it is, My cases

2026-11-23. The owner, on 22 November: "I think it could make sense if a case had a
status like open, assigned, closed." On 23 November, on the flow: "when the PO or the
tester tested things, how will he proceed? How will he hand this over to a dev? Or when
the dev or AI agent is done, how is it handed back to a PO?" Answering the lead's
proposal (one assignee per case, the state worked out from the marks, "my cases", a mail
both ways): "Yes. [...] I also want to filter for 'my cases' in the extension", with the
flow described "on the website, the web app and the extension". The contract between
service and extension is one document; the service's side is its DEC-042 (pull request
ractive/sitegloss.dev#54; the API types here are from its document as of 7a9247b, after
its review). This is the extension's side of step 2; step 1 is DEC-069.

- **The rule is the server's, copied.** `src/lib/case-state.ts` has `caseState`,
  `caseTurn` and `isMine` as the service's `packages/api/src/v1/case-state.ts` has
  them, and `test/case-state.json` is a byte copy of its vectors (17 states, 24 turns,
  36 answers for "mine"), held as `pageKey`'s are. `caseTurn` takes, as the server's
  does since its second review, whether the reporter is a member of the team
  (`reporterHere`, default true): the reporter's turn is nobody's once they left or
  when none is on record. Here that is read from the members list. The state is worked out from the
  marks here, never stored and never read from the server: a case here has all its
  marks. The list's `state` and `turn` that the API sends with `GET …/cases` are not
  used, because the extension syncs through `changes` and never lists cases.
- **The case keeps the server's records as given.** `createdBy` (the reporter),
  `assignee` (`null`: nobody; absent: not told, a server from before) and `assignedBy`
  (a stamp) come from the server's case and are stored, exported and imported as they
  came. They are never sent back. What is sent is `assign`, an assignment made in this
  browser (by the person, or by their AI app, whose name goes with it as `via`): the
  next sync sends it as a `case.patch` of its own that says only `assignee`, a member's
  id or `null`, and it goes once the server is known to have it (the operation was
  taken, or the server's copy says the same). Offline it waits, as every change of a
  case does, and the block says so. The shadow keeps the server's assignee id beside
  its other fields, so a patch is sent only while the two differ; a pick is kept as
  `assign` even when it is the record here again (that record may be older than what
  the server took), so only the sync decides there is nothing to send; once the book's
  shadow says that assignee (the operation was applied or a duplicate, or nothing had
  to be sent), the sync drops it and the case's record says that assignee. **Refused**
  (the person left the team, the role does not allow it): its own operation, so the
  title, summary, link and marks are never held back by it; the waiting assignment is
  dropped, the server's record shows again, and the case says why in its block,
  `assignRefused`, this browser's note: "Gone is not in the team any more, so the case
  was not assigned to them." only where the server said the operation was invalid and
  the person is not among the members as last listed; otherwise "The server did not
  take the assignment to Dana: <its reason>". It is said while marks are open, until
  the next assignment here or until the server's hand-over is another one (someone
  assigned the case since). **To another
  team**: sharing a case with a team other than the one it was of drops what the first
  team said of it and any assignment waiting for it; the new team's server says its
  own. A `case.patch` that names no assignee, as every other
  change does, leaves it at the server (tested against the fake, which now keeps the
  server's rule: a member or nobody, stamped from the caller).
- **Files.** `assign` is this browser's note and never in a file, in or out (as `via`).
  An import keeps the file's records for a case that is not here, the records of the
  case it replaces for one that is, and none for a copy (another case, which nobody
  started or was given yet). A crafted file's `assignee` is only ever shown: nothing
  sends it.
- **The members.** `GET …/members` (id and name) is asked for with the account's teams
  (at most every ten minutes, and at once for a team just chosen) and stored beside the
  account (`members`), so the Assign menu works offline from the last list. A server
  from before answers 404: no members, stored as none. **That is how a server that
  assigns cases is told from one that does not**: without members nothing about
  assignees shows (no Assign, no My cases, no "Assigned to" on cards, no turn in the
  tools); every case there would read as unassigned. Signing out forgets them.
- **Cases synced before this version** have no reporter and no assignee here, and the
  changes feed does not bring them again for a case nobody changed. Once per team and
  start, where the server assigns cases, every synced book whose shadow has no
  `assignee` is read again whole (as `#readThreadsOnce` does for the thread, DEC-046),
  at most 25 a run (`HAND_OVER_READS`), so the sync is not held for a whole team at
  once; the next runs take the rest.
  Until then the case's hand-over is not known (`handOverKnown`): it is in nobody's My
  cases, and its block says nothing about whose turn it is. A team's case whose
  reporter is not on record is nobody's either (an earlier draft took it for the
  person's own, which put every old case under everybody's My cases).
- **The next step block** (DEC-069) in the team's case, once the server told the
  assignee, in the service's words (`apps/app/src/lib/next-step.ts` on its branch),
  counts included: "2 marks are open: assign the case to whoever fixes them." with
  Assign (for whoever may change the case, `case:update`, while the members are known)
  and the copies; without the right "2 marks are open, and nobody is on it yet."; the
  assignee "It is assigned to you: 2 marks are open." with Copy for your AI app; anyone
  else "Dana is on it: 2 marks are open." with Copy link. Fixed: the reporter "Every
  open mark is fixed: check them and verify." with Start verifying; the others "Every
  open mark is fixed: Tess checks them and verifies." Settled: "Every mark is settled:
  close the case." or "... Tess closes the case." A reporter who left the team (or none
  on record): "Every open mark is fixed, and whoever started the case is no longer in
  the team: check them and verify." for whoever may settle marks (`mark:update`), the
  same without the instruction for the others; settled likewise with "close the case"
  for whoever may close. The panel's one addition: while marks are open and others
  wait to be verified, the reporter reads "Check the fixed marks on the page that has
  the fix." before the open marks' sentence. An assignment waiting to be sent adds "The
  change goes to the team with the next sync." or, offline, "The change waits here
  until the server can be reached." A case only in this browser, one not at the server
  yet, or one whose hand-over is not known reads as before (DEC-069).
- **Assign is a menu button** ("Assign", "Reassign" where someone has it, a chevron
  pointing down, as the owner asked of a menu on 23 November): the person looking first
  as "You", the others by name, then "Nobody"; radio items, the one who has it checked;
  arrows and Tab as the case's "…" menu; Escape (on the menu or its button) closes it
  with the focus back on the button, and a press anywhere outside it closes it, as the
  "…" menu's capturing `pointerdown` does. Offered with open marks only: once
  they are fixed the turn is the reporter's whoever is assigned, and a reopened mark
  makes it the assignee's again.
- **My cases** is a chip above the list of cases, as the open case's status chips
  filter its marks: "My cases" with its count; on, it is filled in the text's colour
  with a tick (`aria-pressed`), off a quiet chip with an edge. Mine: the team's open
  cases where it is the person's turn (`isMine`), and every open case kept only in this
  browser, which nobody else has. Only for someone signed in with a team chosen whose
  server assigns cases; otherwise no chip and nothing about assignees. It narrows the
  list under "Cases" and hides the Closed group (nobody's turn); the cases under "This
  page" stay, they are about the tab, and the count takes them in: with the person's
  one case there, the list says "No other case waits for you." A press keeps the focus
  on the chip, and a redraw of the list keeps it on the card that had it; a card (or
  the Closed group's heading) that leaves the list hands it to the chip. **Kept for the panel's session** (`sessionStorage`): the panel touches
  no storage of the extension's (a test holds it), and keeping a view filter across
  browser restarts through the worker was not worth a message of its own; a reopened
  panel shows every case.
- **The cards** say the state as one quiet badge before the counts where it adds to
  them: "New" and "In progress" (whether anything was settled yet). "To verify" and
  "Settled" said what the counts beside them say ("2 to verify"), so they are left
  out, as for an empty case ("No marks yet") and a closed one (its own tag); and, in the team's case with open marks
  once the server told, who has them after the date ("Assigned to Dana", "Assigned to
  you", "Nobody assigned"). The card's name for a screen reader says both.
- **The AI app's tools.** `list_cases` gives every case's `state`, and in the team's
  case `turn`, `assignee` and `startedBy`; it takes `mine`. `get_case` gives the same and
  `assignedBy`, or `assignmentNotSentYet`. `assign_case` takes `me`, a member's id or a
  name only one member has, or `null`; it asks first, as every changing tool, and the
  question names who gets it ("Assign to: Dana.", "Assign to: nobody.") or says, by
  the same checks in the same order as the call, why it will be refused, in one short
  sentence (the members' list goes to the app only); it refuses a
  case only in this browser, a role without `case:update` and a name that is no member
  (with the members to choose from), and goes through the sync. The instructions tell
  the flow in three sentences, in step with the service's MCP server.
- **The flow in the panel's words**: the empty list (signed out, or where the server
  assigns cases) and the Team section before signing in say "With a team, a case is handed over. Assign it to whoever fixes its open
  marks: it is under My cases for them, and the case says what is theirs to do. When
  every open mark is fixed, it is back under My cases for whoever started it, to check
  the fixes, verify them and close the case." No new screen.
- **What a released extension does with it.** 0.3.1 and 0.4.0 know none of the fields:
  their sync builds a case from the fields they name and never sends `assignee`, so the
  server keeps it whatever they change; 0.4.0 keeps the case-level fields of a file as
  unknown ones (DEC-066) and writes them out again. Nothing is lost at the server; they
  show no assignee and have no My cases. An assignment made here and not sent yet is
  left unsent by an older build the browser is taken back to (it is an unknown field
  there), and sent when this build is back.

## DEC-072: AI access that went off by itself says why

2026-11-23. The owner asked: "Why did AI access turn off; is it because I switched to
another macOS user?" The code's answer: the relay ends a session no AI app used for a long
time (`idle`) or an old one (`expired`); without Keep AI access on nothing connects again
(`sessionOnAfter`, DEC-015). A browser restart or an update or reload of Sitegloss clears
`chrome.storage.session`, the session's "on" flag, so AI access is off after it too (DEC-015,
DEC-059). Switching to another macOS user is not among the causes; the browser of the other
user is another browser. The panel said only "AI access is off · paired apps stay paired" and
"Not connected", and `endedProblem` deliberately has no words for `idle` and `expired`.

- **What is shown.** In the AI card's state line and the status (the pill's tooltip and the
  status text), one sentence each, with the way back:
  - idle: "AI access went off because no AI app used it for a while. Paired apps stay paired.
    Turn it on again, or tick “Keep AI access on”."
  - expired: "AI access went off because a connection ends after a long time. Paired apps stay
    paired. Turn it on again, or tick “Keep AI access on”."
  - restart: "AI access was on before the browser or Sitegloss restarted, so it is off now.
    Paired apps stay paired. Turn it on again, or tick “Keep AI access on”."

  The status has "Not connected: " before it. It is information (DEC-024): `problemOf` says
  nothing of it, so no red line under the top bar; the pill keeps "AI off". It shows only
  while AI access is off with nothing wrong now: not while connecting, retrying, taken over
  or with a problem of the last connect. The state line is a live region: its text is
  assigned only when it changes, so a redraw does not read the sentence again.
- **What is kept.** A record `{ reason, at }` in the worker's settings database (`kv`, DEC-016),
  so it outlives a stopped worker and a browser restart: no page content, no AI app. It is
  written when the relay ends an idle or old session without Keep AI access on, and when a
  worker starts as a restart. It is forgotten when AI access is on again (connected, the
  Turn on command, Keep AI access on ticked), when the person stops it (in memory at
  once, the store after the disconnect) and when the relay is changed. A takeover needs no
  clearing: it happens while connected, when no record exists, and a takeover's own words
  win over a record. A record older than 7 days is not shown and is removed at start (`at`
  is for that): a sentence about last week helps nobody. At start a record is not read
  either while the session is on or Keep AI access on holds.
- **How a restart is told.** The smallest honest way: a second flag, `aiWasOn`, written in
  the one place the session's flag is written (`#setSessionOn`), after it. A worker that
  starts with `aiWasOn` true and the session's flag gone, with no stop of the person's, no
  Keep AI access on and no takeover, was on when the browser or Sitegloss restarted: it
  records `restart` and clears the flag, so one restart is told once. A worker that was only
  stopped by the browser keeps the session's flag, so it says nothing. The reason cannot say
  whether it was the browser or Sitegloss (an update, a reload) that restarted; it says both.
- **A failed store write** is accepted: the memory holds, a console warning is logged. A
  failed removal could bring an old sentence back after the next start; the rules above
  (not read with the session on or keep-on, gone after 7 days) cover the visible cases.
- **Unchanged.** Keep AI access on ticked: nothing is recorded, it reconnects as before. No
  new permission, the manifest is untouched, Chrome and Firefox alike. The connection's
  behaviour, the alarm and the session's flag are as before.
- Tests: `test/went-off.test.ts` (the reasons, the sentences, age, nothing for a stop, a
  takeover, keep-on or a live state), `test/connection.test.ts` (idle and expired through the
  Connection with a test relay that ends them: record, store, forgotten on connect, nothing
  with keep-on; a restart, kept over a second start, forgotten on connect, Stop, ticking
  keep-on and a change of relay; nothing after a stop; a stale record).

## DEC-074: tab-mcp client 0.24.0: WebMCP that comes late, pictures through the extension; none of it reaches Sitegloss (owner)

2026-11-23. The owner's plan: the candidate first, then the release. `@ractive-ch/tab-mcp-client`
goes from 0.23.0 to 0.24.0 (tested first as 0.24.0-rc.1 on a branch); the relay used by the tests
stays `@ractive-ch/tab-mcp` 0.13.3.

- **What 0.24.0 changes in the library:** a `TabMcp` that found no WebMCP when it was made listens
  on `document` for `tab-mcp-webmcp` (`WEBMCP_EVENT`, from `./extension`) and mirrors its tools
  when WebMCP arrives later; a WebMCP call the tab-mcp browser extension announces gets the whole
  MCP result (pictures included) instead of text; `client.via` is `'tab-mcp-extension'` also for
  read-only tools, and the new `client.allowed` says whether the user allowed the call (code that
  read `via` as "the user allowed it" must read `allowed`); `WebMcpClient` has the new field
  `allowed`.
- **Not reached:** Sitegloss has one `TabMcp`, in the service worker, with `webmcp: false`
  (DEC-068). The library returns before it touches `document` in that case, so there is no
  listener and no mirror. Nothing in Sitegloss reads `client.via` as permission; the worker looks
  only at `client.kind`, `name` and `host`. No code change.
- **Checked:** on 0.24.0-rc.1: type check, Biome, both builds, `bun run verify` and the full
  Chromium end-to-end set (the connection, pairing and tools files all pass; two toolbar layout
  tests fail the same way on main). On 0.24.0: the published package equals the candidate except
  for the version strings and the bundler's own chunk and debug ids; then type check, Biome,
  both builds and `bun run verify` again.
