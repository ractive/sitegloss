---
type: design
title: "UX review, November 2026: one flow for tester, developer and tester again"
description: >-
  Review of the whole extension from three roles (tester, developer, tester again) on
  feat/auto-show, and the design iteration 17 builds from: marking only inside an open
  case, the Verify step and its stored format, sync to Downloads or a folder with an Allow
  access that cannot be missed, design tokens with computed contrast for light and dark,
  and the changes and tests for the four PRs (flow, Verify, sync, look).
tags:
  - design
  - ux
  - ui
  - verify
  - sync
timestamp: 2026-11-13T01:00:00+01:00
---
# UX review, November 2026

> Note (2026-11-22): DEC-054 renamed the mark group "closed" (won't fix, can't
> reproduce) to "dismissed": its names, its tokens (`--st-dismissed`) and the
> `list_cases` key. The old names below are history; this review is kept as written.

The brief is [iteration 17](../iterations/iteration-17-ux-rework.md); the owner's decisions
there are fixed. This document settles everything else, so the four PRs can be built
without further questions. Where a point was open, the choice and its reason are in
[Settled here](#settled-here).

## How the review was done

The test build of `feat/auto-show` (main + PR 42) ran in headless Chromium through the
e2e harness: the real side panel at 380 × 860 px, light and dark, on `test/e2e/pages/v1`,
then the case followed to `v2`, `ui` (no marks found) and `chrome://version` (no
access). 40 views were captured and looked at. Not seen, and written from the code:

- Chrome's own prompts (`downloads`, the folder picker, the folder's "Allow access"):
  the DevTools Protocol cannot show them. "Sync paused" was produced by writing
  `state: "paused"` into the sync's status record, not by a browser restart.
- The AI app was a test client on the test relay (`client.example`), not Claude; the
  two findings in the views were written into the store directly.
- The access notice's "Allow on all sites" variant: the test build has host access.

## Today, per role

### Tester: mark, save, hand over

| Step | What happens | Problem |
|---|---|---|
| Open the panel | Home: "This page", "Annotate this page", Cases, AI app, Options | Three amber fills on one screen (the header's "Turn on", "Annotate this page", "Turn on AI access"): no single primary. The AI card and Options take half of the first screen once a case exists. |
| Mark, comment | Toolbar at the bottom; comment popover with "Remove mark" / "Done" | Works. Borders of the popover's field and buttons (`#c8cdd8`) are 1.59:1 on white. |
| "Save case…" | Title field, "Save case" / "Keep drawing". Afterwards the toolbar says `Saved “…”`, its buttons change to "New case" and "Done" | The toolbar now adds to the saved case, but the panel stays on Home with "Stop annotating"; nothing says a case is open. |
| "Done" on the toolbar | Home shows **"Continue annotating"** | Continues a case that is not open (the owner's finding). The label comes from the page: `MarkAdder.hide()` keeps `#target`. |
| "← All cases" while the toolbar is up | The case's marks leave the page; **the toolbar stays** with `Adding to “…”`; Home says "Stop annotating" | Measured: a mark drawn then went into the closed case (3 → 4 marks). |
| Hand over by file | "Export" is a small button between "Add marks" and "Delete" | Not findable as the hand-over step; next to a destructive action. "Saved as …" stays under the buttons and shows again when the case is opened later. |
| Hand over by sync | "Sync to a folder…" under the list, below Import/Export | Paused state ("Sync paused: allow access again", "Allow access") is only on Home, under the case list (361 px down with one case, lower with each case), not in a case, nothing on the icon. The owner missed it. |
| Hand over to an AI app | AI card on Home | Clicking the AI pill inside a case closes the case (`startAi(update, () => closeCase())`). |

### Developer: open on the own build, work through, set statuses

| Step | What happens | Problem |
|---|---|---|
| Import, case opens | Marks are drawn on the tab in front (DEC-022) | Works well. |
| Case header | Back link, title, 3 chips, "Hide marks on this tab" (full width), Add marks / Export / Delete, hint, summary label + "Save summary" + textarea | 8 controls and 390 of 860 px before the first mark. The most prominent control is "Hide marks", a secondary action. The empty summary field shows to everyone, always. |
| "← All cases" | 12 px, muted `#b8c0d0`, a 65 × 17 px target | Too small (the owner's finding). |
| Dark scheme | Band `#232b3c` on sheet `#161b26` | Text is fine (7.8:1). Surfaces and boundaries are not: band against sheet 1.22:1, button borders against the band 1.67:1. Buttons, chips and the field have no visible shape: this is the "dark on dark". Light has the same flaw: button borders `#dfe3ea` on white 1.29:1. |
| Marks on the page | Green outline = found, amber dashed = unsure | Green on the page's green button is 1.68:1: the outline of mark 1 on `v2` is nearly invisible. Green says "found" where a reader expects "fine"; the hint has to explain the colours ("Green: found. Amber, dashed: …"). |
| A mark in the list | Collapsed head: number, comment, state pill, "Show" | "Resolve…" is one of four equal small buttons, inside the collapsed body: expand, Resolve…, choose, Resolve = four clicks. Up to three red "Delete" per card (mark, each finding). |
| Resolved mark | Pill "Fixed" replaces "Found"; crop greyed; on the page at 30 % opacity (1.47:1 on white) | The match state disappears from the head; the crop can no longer be compared. |
| None found | Notice with "Open the case's page" | Correct. The wide button above still says "Hide marks on this tab" with nothing drawn. |
| Hand back | Export, then the tester's Import → "Replace it / Keep both / Cancel" | The prompt compares two dates only; it does not say what differs (statuses). |

### Tester again: verify on the new build

| Step | What happens | Problem |
|---|---|---|
| Check a fix | Nothing: "Fixed" is the last state | No Verified. |
| A fix that is none | "Reopen" removes the resolution and its note at once (`withResolution(…, null)`) | No comment asked, nothing the developer can read; the note of the claimed fix is gone. |
| Find what to check | Fixed marks are the grey, faded ones (page, pin, crop) | The marks to verify are the least visible ones. |
| Case progress | "1 open, 1 fixed, 1 won't fix" and a three-colour bar | No "to verify" / "verified". |
| Panel closed and opened again | Marks stay on the page; the panel opens on Home | Marks with no case open; only the page's own "Hide" removes them. |

## Settled here

| Point | Choice | Why |
|---|---|---|
| Hide through a reload of that tab | Yes. It ends with "Show marks", with closing the case, or with closing the panel. | It is what the code does (`hiddenOn` outlives a reload); the user took the marks off that tab on purpose. |
| Closing the side panel | Leaves the marks and the toolbar on the page. Opening the panel again opens the case the tab in front shows. | Yes as before, but without the orphaned marks: the panel adopts what the page shows, once, at its start. |
| "← All cases" and marks an AI app loaded | Takes the open case's marks off the tab in front whoever drew them (changes DEC-022, which left an AI app's marks). | The owner: "the current case should be 'closed' and the annotations be removed". Marks of another case stay. |
| The toolbar's "New case" button | Goes. A new case starts with "← All cases", then "Annotate this page". | It creates a toolbar without an open case, and the toolbar already wraps to two rows at 900 px. |
| The AI pill inside a case | Opens a Settings view (AI app + Options); the case stays open. | Closing the case there would now also end marking and clear the page. |
| Role switch (tester / developer) | None. One panel; each mark offers the action its status calls for; status chips filter the list. | No accounts, and one person is often both. |
| Verify as a stored value | Additive fields on `resolution`, no new `kind`. | An older build refuses an unknown `kind` and with it the whole file; unknown fields it drops. |
| "Verified" from an open mark | Allowed in the panel ("Fixed and verified"), not for an AI app. | A tester whose copy never got the developer's statuses verifies in one step. |
| Reopen's comment | Required in the panel; optional for an AI app's `set_mark_status`. | The owner: "Reopen (with a comment)". Existing tool calls keep working. |
| Colour on the page | Colour = status, dash = match confidence, white casing under every stroke. | Green must mean verified, not found; a casing keeps any stroke visible on any page. |
| Primary colour | Amber stays, once per view, for marking. Card actions use the ink "strong" button. | Amber is the icon's and the toolbar's; three ambers per screen made none primary. |
| Sync from the worker | Through an offscreen document (blob URL), `offscreen` permission. | A service worker has no `URL.createObjectURL`; a data URL fails for cases over about 1.5 MB. |

## Flow and information architecture

### The rule

A toolbar on the page belongs to exactly one of two things, and the panel shows which:

1. **A new case** being drawn: the panel is on Home. Marks are drafts until "Save
   case…".
2. **The open case**: the panel shows that case. Each mark goes into it when its
   comment is done (DEC-014).

Invariant for the tab in front: *toolbar adding to case X ⇔ case X is open in the panel*.
The panel enforces it in both directions (see [Transitions](#transitions)).

### Views

| View | Shows | The one primary (amber) | Leaves by |
|---|---|---|---|
| Home | This page, the cases, files and sync | "Annotate this page" | opening a case; the AI pill |
| Case | One case: status, this tab, summary, marks, screenshots | "Add marks" | "← All cases" (closes the case); the AI pill (keeps it open) |
| Settings | AI app card, Options | none ("Turn on AI access" is a strong button) | "← Back" to where it came from |

Above every view, in this order: the top bar, the last AI call (one line), AI questions
(`#questions`), the sync banner (`#sync-banner`, see [Sync](#sync)).

**Top bar** (sticky, 44 px, on paper with a rule below): left the back button (Case:
"← All cases", Settings: "← Back", Home: empty); right the AI pill, and "Stop" while AI
access is on (it keeps its job: pause from any view).

The pill is a small default button with a dot: grey "AI off", amber "AI on, no app
yet", green "AI on · 1 app". Its tooltip says what a click does ("Click to set it up",
"Click for the address and code", "Click to manage them").

### Home

Top to bottom:

1. **This page** (`h2`), the tab's short address (mono, 12 px).
2. Access notice where Overmark may not run (texts as today).
3. Primary button, full width, and a hint line under it:

| Page state | Button | Hint under it |
|---|---|---|
| No toolbar | **Annotate this page** (primary) | none |
| No toolbar, drafts on the page | **Annotate this page** (primary) | "3 marks on this page are not saved yet. Annotate this page shows them again." |
| Toolbar up, no drafts | **Stop annotating** (default) | "Draw on the page with the toolbar at its bottom." |
| Toolbar up, drafts | **Stop annotating** (default) | "3 marks drawn. Click Save case… on the page's toolbar to keep them." |
| Saving | **Stop annotating**, disabled | "Saving…" |

"Annotate this page" always sends `overlay:show` **without** a target (today it passes
the last case's): it starts a new case, never continues one. "Continue annotating" no
longer exists.

4. **Cases** (`h2`). Groups "For this page" / "Other pages" as today. A case row:
   title (14 px / 600), short address and date (12 px, muted), the status bar (4 px),
   and the counts: "2 open · 1 to verify" (only the counts above zero; "All verified or
   closed" with a check when nothing is open or to verify). The summary preview goes.
   Empty: "No cases yet. Annotate a page and save it as a case, or import a case
   someone sent you."
5. **Files** (`h3`): "Import a case…", "Export all cases" (default buttons), their
   results as today.
6. **Sync** (`h3`): see [Sync](#sync).

The AI app card and Options move to Settings. Their element ids stay.

### Case

Top to bottom:

1. Title (18 px / 700, at most two lines).
2. Meta line, 12 px muted, one row: `127.0.0.1/v1` (link, "Open this page in a new tab
   and load the case there") · `894×649` · `13 Nov 2026`. No chips.
3. "Imported from a file on …" hint (as today) where it applies.
4. **Status block** (see [Verify](#verify)): the bar and the status chips.
5. **Action row**: "Add marks" (primary), "Export" (default). Nothing else.
6. **This tab** block, one line plus a quiet button:

| State | Line | Button |
|---|---|---|
| Drawing | "Looking for the marks on this tab…" | none |
| Found some | "3 of 4 marks found on 127.0.0.1/v2. Dashed: unsure." | "Hide marks" |
| Found all | "All 4 marks found on 127.0.0.1/v2." | "Hide marks" |
| Hidden | "Marks are hidden on this tab." | "Show marks" |
| None found | warning notice: "None of this case's marks were found on this page. It is probably for another page: …" + "Open the case's page" (as today) | "Hide marks" goes |
| No access | the access notice (as today) | none |
| Another size | "This tab is 1200×800, the marks were made at 894×649." | "Match size" |
| Adding | "Adding marks: draw on the page. Each mark is saved into this case when its comment is done." | the action row's primary becomes "Done adding" (default) |

7. **Summary for the developer**: label, textarea (2 rows, grows to 8). "Save summary"
   (strong, small) shows only while the text differs from what is stored, with "Not
   saved yet"; "Saved" for 2.5 s after. Placeholder as today.
8. **Marks**: heading with the count, "Expand all" / "Collapse all", the list.
   Empty: "No marks yet. Click Add marks and draw on the page."
9. **Screenshots** (collapsed, as today).
10. **Delete this case** (danger, quiet), alone at the bottom; armed: "Really delete?"
    (danger, filled). Tooltip as today.

The export's "Saved as …" block shows under the action row and is cleared when the case
closes.

### Settings

"← Back", then the AI app card (unchanged inside) and Options (unchanged). Opened by the
AI pill from Home or a case; the case stays open underneath, its marks and toolbar stay.
State: `PanelState.settings: boolean`, drawn instead of Home or Case while true.

### The page's toolbar

| Mode | Status text | Buttons after the tools |
|---|---|---|
| New case, no marks | "New case: choose a tool" | Undo · Save case… (disabled) · Close |
| New case, marks | "New case: 3 marks" | Undo · **Save case…** (amber) · Close |
| Save form | title field | **Save case** · Keep drawing |
| Adding to a case | `Adding to “<case>”` | Undo · Done |
| Adding, a mark failed | `Mark 4 is not in “<case>” yet` | Undo · **Add mark 4** · Done |

"New case" goes from the adding mode. Everything else stays.

### Transitions

| Event | Toolbar on the tab in front | Marks | Panel |
|---|---|---|---|
| Home: Annotate this page | shown, no target | none | Home |
| Home: Stop annotating | hidden; drafts stay on the page | none | Home |
| Toolbar: Save case… succeeds | target = the new case | drafts become the case's | **opens the new case**, "Adding" state |
| Home: a case is clicked | a new-case toolbar is hidden first (drafts stay) | drawn on the tab in front | Case |
| Case: Add marks | shown, target = the case | stay | Case, "Adding" state |
| Case: Done adding, or the toolbar's Done | finished, hidden | stay | Case |
| Case: ← All cases | **ended**: finished as Done, hidden, target cleared | **taken off** | Home |
| Case: Delete (confirmed) | ended, marks not yet in the case discarded | taken off | Home |
| The case is deleted elsewhere (AI app, other window) | falls back to a new case, drafts kept (as today) | taken off | Home |
| Another tab comes to the front | per tab: stays where it is | follow the case (DEC-022) | Case |
| AI pill | unchanged | unchanged | Settings |
| Panel closed | stays | stay | — |
| Panel opened | unchanged | unchanged | adopts: opens the case the tab in front shows |

How the panel carries them out:

- **End** is a new message to the page, `{ type: "overlay:end", caseId, discard? }`.
  If the toolbar's target is that case, the page runs what "Done" runs (`#finish()`)
  and, once the toolbar is hidden, clears `#target`; it answers with `OverlayState`.
  `closeCase()` sends it to the tab in front and to every tab where the panel started
  the toolbar for this case (a set kept like `drawn`), then `case:clear` for the case
  on the tab in front (whoever drew the marks) and on `drawn`.
- **A mark that could not be added** keeps the toolbar up (`visible` in the answer).
  The panel stays in the case and says under the action row: "1 mark is not in the case
  yet; the toolbar on the page says why. Click ← All cases again to leave without it."
  The second click sends `discard: true`. While the answer is awaited the back button
  is disabled and the line says "Finishing the marks…".
- **Adopt, continuously**: on Home, when the tab in front reports a visible toolbar
  with a target whose case is stored (`overlay:changed`, `refreshTab`), the panel opens
  that case. This opens the case after "Save case…".
- **Adopt, once**: on the panel's first read of the tab in front, a stored case named
  by `overlay.loadedCase` is opened too and `drawn` set to it.
- **Drafts and "Add marks"**: unsaved drafts of a new case go into the open case with
  "Add marks" (DEC-014, `#addDone`). The This-tab block says so first: "3 unsaved marks
  are on this page. Add marks puts them into this case; go back to All cases to save
  them as a new one."

## Verify

### The state model

A mark has one of five statuses, derived, never stored as such:

| Status (`markStatus`) | Label | Short | Stored |
|---|---|---|---|
| `open` | Open | Open | no `resolution` |
| `fixed` | Fixed, to verify | To verify | `resolution.kind = "fixed"`, no `resolution.verified` |
| `verified` | Verified | Verified | `resolution.kind = "fixed"` and `resolution.verified` |
| `wontfix` | Won't fix | Closed | `resolution.kind = "wontfix"` |
| `cantreproduce` | Can't reproduce | Closed | `resolution.kind = "cantreproduce"` |

The format stays `overmark/1`; every new field is optional:

```json
{ "id": "a1", "number": 1, "comment": "Too pale",
  "resolution": { "kind": "fixed", "note": "Hover state too", "at": "2026-11-14T09:00:00Z",
    "app": { "id": "https://claude.ai/oauth", "name": "Claude", "host": "claude.ai" },
    "verified": { "at": "2026-11-14T15:00:00Z" } },
  "reopens": [{ "note": "Still pale on hover", "at": "2026-11-13T16:00:00Z",
    "was": { "kind": "fixed", "note": "Darker text, 7:1 now", "at": "2026-11-13T11:00:00Z" } }] }
```

- `resolution.verified`: `{ at, app? }`. Read only with `kind: "fixed"`; on any other
  kind validation drops it (a file is not refused for it).
- `resolution.app`, `verified.app`, `reopens[].app`: the AI app that set it through a
  tool (a `FindingApp`, as on a finding). Absent: set in the panel.
- `reopens`: oldest first, at most 20 (`MAX_REOPENS`; the oldest goes when full). Each:
  `note?` (at most 2,000 characters, `MAX_REOPEN_NOTE`), `at`, `app?`, and `was`: the
  resolution it ended, whole. So the claimed fix and its note survive a reopen.

### Transitions

| From | Action | To | What is written | In the panel | AI tool (`set_mark_status`) |
|---|---|---|---|---|---|
| open | Resolve as fixed | fixed | `resolution` | Resolve… → "Fixed, to verify" | `status: "fixed"` |
| open | Resolve as won't fix / can't reproduce | wontfix / cantreproduce | `resolution` | Resolve… | `"wontfix"`, `"cantreproduce"` |
| open | Fixed and verified | verified | `resolution` with `verified` | Resolve… → "Fixed and verified" | refused |
| fixed | Verify | verified | `resolution.verified = { at }` | **Verified** | `"verified"` |
| fixed, verified, wontfix, cantreproduce | Reopen | open | `resolution` moves into a new `reopens` entry with the note | **Reopen…** (note required) | `"open"`, `note` optional |
| any resolved | Change | another resolved status | `resolution` replaced; `verified` only if chosen | Change… (same form) | the other `status`; `"fixed"` on a verified mark changes only the note |
| open | `"open"` | open | nothing, no `reopens` entry | — | idempotent |

Library (`src/lib/case.ts`): `markStatus(a)`, `STATUS_LABEL`, `caseCounts(c)` →
`{ open, toVerify, verified, closed }`, `withResolution` (takes `verified?: boolean`,
`app?`), `withVerified(c, id, app, now)`, `withReopen(c, id, { note, app }, now)`.

### Older cases, older builds

- A case without the new fields needs no migration: its fixed marks are "Fixed, to
  verify", which is true, nobody verified them.
- A file from this build opens in an older build: it drops `verified`, `reopens` and
  `app` (its validation rebuilds each mark from the keys it knows). A verified mark
  shows as "Fixed", a reopened one as open **without the reopen note**. `case.md` in the
  same zip still has it. Both sides should run the new build; the README says so.
- `resolution.kind` gets no new value, ever, for that reason.

### The case's summary

The status block, in the case view and (bar and counts) in the case list:

- A bar, 8 px, one segment per status with a count above zero, in the order open, to
  verify, verified, closed; 2 px gaps.
- Under it four chips, the legend and the filter in one: `● Open 2` `◐ To verify 1`
  `✓ Verified 1` `– Closed 1` (a chip with count 0 is left out). A click filters the
  list to that status (`aria-pressed`), a second click shows all again. Above a
  filtered list: "Showing 1 of 4 marks." and "Show all".
- When nothing is open or to verify: a line with a check, "All marks are verified or
  closed."

The page's review bar says: `<title> · 3 of 4 found · 1 to verify` and "Hide".

### A mark's card

Collapsed head, two rows: (1) pin, comment (two lines at most), "Show"; (2) status pill,
match state as text ("Found here (83%)", "Unsure", "Not found on this page"), "2 AI
findings". For a reopened open mark, row 2 starts with "Reopened:" and the note's first
line, in the open colour.

| Status | Pill | Strong button | Other buttons |
|---|---|---|---|
| open | none ("Reopened" if `reopens`) | **Resolve…** | Edit comment · Delete |
| fixed | To verify | **Verified** | Reopen… · Change… · Edit comment · Delete |
| verified | Verified | none | Reopen… · Change… · Edit comment · Delete |
| wontfix / cantreproduce | Won't fix / Can't reproduce | none | Reopen… · Change… · Edit comment · Delete |

The strong button and "Reopen…" also sit in the collapsed head's second row for a mark
that is to verify, so verifying needs no expanding. The developer and the tester see the
same card; what differs is which chip they filter by (Open; To verify).

The expanded body, in order: crop (never greyed), the history, AI findings, the
element line, the match, the buttons. The history lists, oldest first, each reopen and
then the current resolution:

```text
Fixed 13 Nov, 11:00 · Darker text, 7:1 now
Reopened 13 Nov, 16:00 · Still pale on hover
Fixed 14 Nov, 09:00 by Claude (claude.ai) · Hover state too
Verified 14 Nov, 15:00
```

Forms:

- **Resolve… / Change…**: legend "Mark 3 is"; radios "Fixed, to verify", "Fixed and
  verified", "Won't fix", "Can't reproduce"; note field, placeholder "Note (optional):
  what was done, or why"; "Save", "Cancel".
- **Verified**: no form. Tooltip: "The fix holds on the page you checked".
- **Reopen…**: legend "Reopen mark 3"; textarea, placeholder "What is still wrong? The
  developer reads this first."; "Reopen" (strong, disabled while the text is empty),
  "Cancel".

On the page: an open mark and a mark to verify are drawn in full; a verified or closed
mark is faded as a resolved one is today (pin solid). A mark shown with "Show" is always
drawn in full.

### Import

The prompt for a case that is here already gains one line per copy, so a hand-back is
readable: "Here: 3 open. In the file: 1 open, 2 to verify." (from `caseCounts`).

### AI tools

`set_mark_status`:

- Title: "Set a mark's status". `status` enum: `open`, `fixed`, `verified`, `wontfix`,
  `cantreproduce`.
- Description: "Set a mark's status. fixed: the change is in, and the mark waits for the
  tester to verify it. verified: the user checked the fix on the new build and it holds;
  set it only when the user says so, never for a fix of your own, and only on a mark
  that is fixed. wontfix: left as it is on purpose. cantreproduce: could not be seen.
  open: reopens a resolved mark; say in note what is still wrong. note is kept with the
  status. The user is asked first."
- `verified` on a mark that is not fixed is refused: "Mark 3 is open: only a fixed mark
  can be verified. Set it fixed once the fix is in; verifying is the user's."
- Results: "Mark 3 is fixed, to verify." / "Mark 3 is verified." / "Mark 3 is open
  again (it was Fixed)." / "Mark 3 is resolved: Won't fix."
- The question's mark line: `Mark 3: “…”, now Fixed, to verify.`

`get_case`: each mark gains `status` (the five values) and `reopens` (`note`, `at`,
`was` as the kind, `by` where an app did it); `resolution` gains `verified` (`at`,
`by`). `list_cases`: each case gains `marks: { open, toVerify, verified, closed }`.

`INSTRUCTIONS`, in place of the sentence on `set_mark_status`: "set_mark_status moves a
mark between open, fixed (waiting to be verified), verified, wontfix and cantreproduce:
set your fixes fixed, leave verified to the user who checks the new build, and reopen
with a note that says what is still wrong. A mark's reopens in get_case say why it came
back."

### case.md

After the head, one line: `- Marks: 2 open, 1 fixed (to verify), 1 verified, 1 closed`.
Per mark, in place of "Resolved: …" / "Open":

```text
- Status: Fixed, to verify (2026-11-14T09:00:00Z, by Claude (claude.ai))
- Note: Hover state too
- Verified: 2026-11-14T15:00:00Z
- Reopened 2026-11-13T16:00:00Z, was Fixed (Darker text, 7:1 now):
  > Still pale on hover
```

Notes go through `inline` / `block` as comments do: they are data.

## Sync

### Two targets

| | Downloads (default) | A folder (option, DEC-021) |
|---|---|---|
| Where | `Overmark/` in Chrome's downloads folder | any folder, chosen once with the picker |
| How | `chrome.downloads.download({ url, filename: "Overmark/<name>", conflictAction: "overwrite", saveAs: false })` | File System Access handle, as now |
| Asks | the `downloads` permission, once, in the click | the picker, then "Allow access" after each restart or panel close |
| Panel closed | writes | waits |
| A renamed case | new file; the old one stays | the old file is removed |
| Chrome's download list | each write shows; Overmark erases its previous entry after each write and keeps the newest (for "Show in folder") | nothing |

The engine (`Sync`, records per target, `-2` names, one writer, no overlap) stays. It
gets a target: `write(name, case)`, `remove?(name)`, `permission()`. The Downloads
target has the fixed id `downloads` (`files:downloads`). The choice is stored as
`target: "downloads" | "folder"` in `overmark-sync`.

**Someone syncing to a folder today** keeps doing so: no `target` and a `folder` means
`"folder"`. Nothing switches by itself. The paused banner and the sync section offer
"Use Downloads instead"; the folder's files stay.

Writing to Downloads from the worker: the worker opens an offscreen document
(`reasons: ["BLOBS"]`), which builds the case's export, makes a blob URL and answers
with it; the worker downloads it, waits for `complete` or `interrupted`
(`downloads.onChanged`, 60 s), has the URL revoked, erases the entry written before,
and closes the document when the run is over.

### Where it lives

The settings: Home, section **Sync**, under Files. What needs the user: a banner above
every view, and the toolbar icon.

| State | Sync section | Banner | Icon |
|---|---|---|---|
| Off | "Sync is off." "Keep a copy of every case as a file, written again whenever the case changes. One way: nothing is read back." **Sync to Downloads** (strong), "Choose a folder…" (default). Below, 12 px: "Downloads: a folder “Overmark” in your downloads, asked once, works with this panel closed. A folder of your choice (iCloud Drive, Dropbox): Chrome asks for access again after each restart." | none | plain |
| Asking for downloads | "Chrome asks whether Overmark may manage your downloads. With a yes, the cases are written to Downloads/Overmark." | none | plain |
| Syncing | "Syncing to Downloads/Overmark" (or `“<folder>”`), "Writing 3 cases…" | none | plain |
| Synced | "Syncing to Downloads/Overmark", "Last synced 13 Nov, 00:26", "Show in folder" · "Change…" · "Stop syncing" | none | plain |
| Paused: folder needs access | "Paused: Chrome wants your OK for “<folder>” again." + the banner's buttons | warning: "**Sync is paused.** Chrome needs your OK to write to “<folder>” again." **Allow access** (strong) · "Use Downloads instead" | badge "!" amber |
| Paused: downloads permission gone | "Paused: Overmark may no longer save to your downloads." | warning: "**Sync is paused.** Overmark may no longer save to your downloads." **Allow downloads** | badge "!" amber |
| Failed | the problem and "Try again" | danger: "**Sync failed.** <problem>" **Try again** | badge "!" red |

- "Change…" shows the Off state's two buttons with "Cancel"; the current target keeps
  running until one is chosen.
- A no to "Allow access": under the banner's text, "Chrome did not allow it. Click
  Allow access to ask again, or use Downloads instead."
- The banner (`#sync-banner`, `role="status"`) is drawn by `render` for every view, and
  cannot be dismissed while the state holds.
- The icon: the worker sets it whenever it saves a status: `action.setBadgeText("!")`,
  background `#ffb000` with `setBadgeTextColor("#1b2130")` for paused, `#b3261e` with
  white for failed, and `action.setTitle("Overmark: sync is paused. Click to allow
  access.")`; cleared with the state. The worker runs the sync when it starts, so the
  "!" is there right after a browser restart, before the panel is opened. The green
  spark (AI access) is in the icon itself and stays.

## Visual direction

### The idea

A proof sheet: paper with ink on it, and the marks in a margin, as a proofreader's are.

1. **No band.** The ink band goes from both views. Structure comes from spacing, rules
   and real boundaries, not from a dark slab.
2. **The margin rail.** The marks list has a 40 px margin column; each mark's pin sits
   in it, on a 2 px rail from the first pin to the last. The pin's colour is the
   status, its fill the match. Scanning the rail answers "what is left".
3. **Amber once.** In the panel amber marks the one action that starts drawing.

Keep from `style.css`: the class names and `data-*` hooks (tests select by them), the
reset, `.visually-hidden`, `[hidden]`, the focus ring, `.switch`, `.setup`, the pairing
card's layout, the reduced-motion block. Replace the token block. Delete `--band`,
every `--on-ink*`, the `header` band and the `.case-header …` overrides for controls on
ink (about 120 lines).

### Tokens

```css
:root {
  color-scheme: light dark;
  /* Surfaces: the panel; cards, fields, buttons; code, plain chips, hover */
  --paper: #f6f4ee; --sheet: #ffffff; --wash: #ebe8e0;
  /* Text; meta and placeholders */
  --ink: #1b2130; --ink-2: #535c6e;
  /* Lines: separators (decoration only); boundaries of buttons, fields, chips */
  --rule: #dedad0; --edge: #7b8291;
  /* Action */
  --accent: #ffb000; --accent-hover: #f0a400; --accent-ink: #1b2130; --accent-edge: #a06c00;
  --strong: #1b2130; --on-strong: #ffffff; --link: #1a55c2; --focus: #1a55c2;
  /* A mark's status: text and fill, and its tint */
  --st-open: #c20f4c; --st-open-bg: #fce4ec;
  --st-verify: #4347c9; --st-verify-bg: #e8e9fd;
  --st-verified: #166d2d; --st-verified-bg: #dff2e3;
  --st-closed: #535c6e; --st-closed-bg: #e9ebef;
  --on-pin: #ffffff;
  /* Messages */
  --danger: #b3261e; --danger-bg: #fbe6e3; --on-danger: #ffffff;
  --warn: #7d4500; --warn-bg: #fff0cc; --warn-edge: #a86400;
  /* Type */
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-num: ui-rounded, "SF Pro Rounded", system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
  /* Space and shape */
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px;
  --r-control: 6px; --r-card: 10px; --r-pill: 999px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #11141a; --sheet: #1a1e27; --wash: #242a37;
    --ink: #eceef3; --ink-2: #a6aebd; --rule: #2b313d; --edge: #737c8e;
    --accent-hover: #ffc233; --accent-edge: #ffb000;
    --strong: #eceef3; --on-strong: #11141a; --link: #8fb8ff; --focus: #8fb8ff;
    --st-open: #ff7aa5; --st-open-bg: #3a1524;
    --st-verify: #a9adff; --st-verify-bg: #22244d;
    --st-verified: #72d18c; --st-verified-bg: #13301d;
    --st-closed: #a6aebd; --st-closed-bg: #272c38;
    --on-pin: #11141a;
    --danger: #ff8f85; --danger-bg: #3a1714; --on-danger: #11141a;
    --warn: #ffc861; --warn-bg: #33270d; --warn-edge: #c98a1a;
  }
}
```

The page's overlay uses fixed colours, the same in both schemes (constants in
`overlay.ts` and `marks.ts`): bar `#1b2130`, its text `#ffffff`, muted `#c5cbd8`, hover
`#2f384c`, amber `#ffb000`; strokes open `#e5195f` (`MARK_COLOUR`, unchanged, so a mark
on the page looks like the one on its screenshot), to verify `#4f53e0`, verified
`#1a7f37`, closed `#667085`; hover outline `#1f6feb`; casing `#ffffff`.

### Contrast

WCAG 2.2 ratios, computed (sRGB relative luminance). Text needs 4.5:1, boundaries and
large text 3:1. Every pair passes.

| Pair | Light | Dark | Needs |
|---|---|---|---|
| `--ink` on `--paper` / `--sheet` / `--wash` | 14.61 / 16.07 / 13.12 | 15.89 / 14.37 / 12.38 | 4.5 |
| `--ink-2` on `--paper` / `--sheet` / `--wash` | 6.11 / 6.72 / 5.49 | 8.26 / 7.48 / 6.44 | 4.5 |
| `--edge` on `--paper` / `--sheet` | 3.51 / 3.86 | 4.39 / 3.97 | 3 |
| `--accent-ink` on `--accent` / `--accent-hover` | 8.77 / 7.66 | 8.77 / 9.96 | 4.5 |
| `--accent-edge` on `--paper` / `--sheet` | 4.12 / 4.53 | 10.06 / 9.10 | 3 |
| `--on-strong` on `--strong` | 16.07 | 15.89 | 4.5 |
| `--link`, `--focus` on `--paper` / `--sheet` | 6.12 / 6.73 | 9.19 / 8.32 | 4.5 |
| `--st-open` on `--paper` / `--sheet` / its tint | 5.51 / 6.06 / 5.03 | 7.53 / 6.81 / 6.54 | 4.5 |
| `--st-verify` on `--paper` / `--sheet` / its tint | 6.40 / 7.04 / 5.87 | 8.88 / 8.03 / 7.08 | 4.5 |
| `--st-verified` on `--paper` / `--sheet` / its tint | 5.86 / 6.44 / 5.51 | 9.85 / 8.91 / 7.64 | 4.5 |
| `--st-closed` on `--paper` / its tint | 6.11 / 5.63 | 8.26 / 6.26 | 4.5 |
| `--on-pin` on open / verify / verified / closed | 6.06 / 7.04 / 6.44 / 6.72 | 7.53 / 8.88 / 9.85 / 8.26 | 4.5 |
| `--danger` on `--paper` / `--sheet` / its tint | 5.94 / 6.54 / 5.46 | 8.36 / 7.56 / 7.25 | 4.5 |
| `--on-danger` on `--danger` | 6.54 | 8.36 | 4.5 |
| `--warn` on `--warn-bg` | 6.83 | 9.53 | 4.5 |
| `--ink` on `--warn-bg` / `--danger-bg` | 14.22 / 13.41 | 12.59 / 13.78 | 4.5 |
| `--warn-edge` on `--paper` | 4.25 | 6.26 | 3 |

| Pair on the page (fixed) | Ratio | Needs |
|---|---|---|
| Toolbar text / muted text on the bar | 16.07 / 9.88 | 4.5 |
| Toolbar text / muted text on hover | 11.73 / 7.21 | 4.5 |
| Ink on amber (pressed tool, Save case…) | 8.77 | 4.5 |
| Bar on a white page; its white ring on a black page | 16.07; 21.00 | 3 |
| Stroke on white: open / to verify / verified / closed | 4.53 / 5.76 / 5.08 / 4.97 | 3 |
| White casing against the same strokes (a dark page) | 4.53 / 5.76 / 5.08 / 4.97 | 3 |
| White numeral on a pin: open / to verify / verified / closed | 4.53 / 5.76 / 5.08 / 4.97 | 4.5 |
| Popover text / muted / field edge on white | 16.07 / 6.72 / 3.86 | 4.5 / 4.5 / 3 |

### Type, space, shape

System fonts only; the extension loads nothing.

| Role | Size / line / weight | Font |
|---|---|---|
| Case title | 18 / 24 / 700 | `--font` |
| Section heading (`h2`) | 15 / 20 / 700 | `--font` |
| Group heading (`h3`, `.group-title`) | 12 / 16 / 600, `--ink-2` | `--font` |
| Body, buttons, fields | 13 / 19 / 400 (buttons 600) | `--font` |
| Meta | 12 / 17 / 400, `--ink-2` | `--font` |
| Pill, chip | 12 / 16 / 600 | `--font` |
| Pin numeral, counts | 12 / 1 / 700, tabular | `--font-num` |
| Address, path, code | 12 / 17 / 400 | `--font-mono` |

Spacing: 4, 8, 12, 16, 24, 32. The panel's gutter is 16 px; sections are 24 px apart
with a `--rule` line between them; inside a section 8 or 12. Radii: 6 controls, 10
cards and notices, 999 pills and pins. No shadows in the panel.

### Components

| Component | Spec |
|---|---|
| Primary button | Fill `--accent`, text `--accent-ink` 600, 1 px `--accent-edge`, 36 px high, full width. Hover `--accent-hover`. Once per view. |
| Strong button | Fill `--strong`, text `--on-strong` 600, 30 px high (26 small). Verified, Resolve…, Reopen, Save, Allow access, Sync to Downloads, Turn on AI access. |
| Default button | Fill `--sheet`, text `--ink` 600, 1 px `--edge`, 30 px (26 small). Hover fill `--wash`. |
| Quiet button | No fill, no border, text `--link` 600, underline on hover. Hide marks, Show all, Edit comment. |
| Danger button | Quiet with text `--danger`. Armed: fill `--danger`, text `--on-danger`, "Really delete?". |
| Disabled | Fill `--wash`, text `--ink-2`, 1 px `--rule`, no pointer; never opacity alone. |
| Focus | 2 px `--focus` outline, 2 px offset, on every control. |
| Back button | In the top bar: default button, 32 px high, pill radius, 16 px chevron-left icon + "All cases" (13 / 600, `--ink`). At least 112 × 32 px. Accessible name "All cases: close this case". |
| Case header | On `--paper`. Title, meta line, status block, action row; no fill, no chips. |
| Chip (status filter) | 24 px high, pill radius, fill the status tint, text the status colour, a glyph before the label (● ◐ ✓ –), the count in `--font-num`. Pressed: 1.5 px border in the status colour. |
| Status pill (on a card) | As a chip, 20 px high, no count, not a button. |
| Progress bar | 8 px high (4 px in the case list), radius 4, segments in `--st-*` with 2 px gaps of `--paper`. `aria-hidden`; the chips say the same in words. |
| Pin | 24 px circle in the margin, numeral in `--on-pin`. Colour: the status. Found: filled. Unsure: filled, plus a 1.5 px dashed ring 2 px outside. Not found: hollow (2 px ring, numeral in the status colour). A 2 px `--paper` ring separates it from the rail. |
| Mark card | A row of the list, no box: the margin column (40 px) with the pin, the content right of it, a `--rule` line between cards. Expanded: content on `--sheet`, radius 10, 12 px padding. Verified and closed: comment in `--ink-2`. |
| Crop | 1 px `--edge`, radius 6, never filtered. |
| History | Lines 12 / 17; the verb ("Fixed", "Reopened", "Verified") 600 in its status colour, the rest `--ink-2`; a reopen's note in `--ink`. |
| Finding | Text `--ink` on `--sheet`, 2 px left rule `--st-verify`; meta line and a quiet danger "Delete". |
| Notice (in a view) | Fill `--warn-bg`, 1 px `--warn-edge`, radius 10, the warning icon in `--warn`, text `--ink`, one default button. |
| Banner (above the views) | Full width, fill `--warn-bg` (failed: `--danger-bg`), 1 px bottom line `--warn-edge` (`--danger`), icon, text `--ink` with the first sentence 600, the strong button right of the text or below it under 400 px. |
| Field | Fill `--sheet`, 1 px `--edge`, radius 6, 6 × 8 px padding, placeholder `--ink-2`. |
| AI pill | Default button, 28 px, pill radius, an 8 px dot (grey `--ink-2`, amber `--accent`, green `--st-verified`) and the text. |
| Switch, checkbox | As today; track off `--edge`, on `--strong`. |

### On the page

The toolbar sits on pages Overmark knows nothing about, so it depends on none of them:

- **One fixed look.** Ink bar, white text, in both schemes; never transparent.
  `:host { all: initial }` and the constructed sheet stay; `color-scheme: light` on
  `.popover`, so a dark page does not restyle its field.
- **A white ring.** `box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.75)` before the drop
  shadow, on the toolbar, the review bar and the popover: on a dark page the ring draws
  the edge (16:1 against the bar), on a light page the bar itself does.
- **Casing under every stroke.** Each shape is drawn twice: a white stroke 3 px wider,
  then the coloured one; the pin keeps its white ring. The green mark on the green
  button (1.68:1 today) then has a white edge at 5.08:1.
- **Colour is the status, dash is the match.** Solid when found, dashed when unsure.
  Verified and closed marks are faded (shape at 0.35, pin solid).
- **Buttons with a shape.** The review bar's "Hide" gets a 1 px
  `rgba(255, 255, 255, 0.5)` border; toolbar buttons are at least 28 px high; focus is
  a 2 px white outline; muted text is `#c5cbd8`.
- **Two rows on purpose.** Under 720 px of page width the status moves to a second,
  centred row; the tools never wrap in the middle.
- **Forced colours.** Borders `CanvasText`, fills `Canvas`, the pressed tool
  `Highlight`.

## Build order

Each PR: `bun run verify`, the tests listed, a `kb/log.md` entry, and the affected parts
of `kb/design/overview.md` and the README.

### a. Flow

- `messages.ts`, `content/index.ts`, `adding.ts`: `overlay:end` (finish, then clear
  `#target`; `discard`); "New case" and `#newCase` go; the new-case status texts.
- `main.ts`: `closeCase()` ends the toolbar and clears the case's marks on the tab in
  front; the two-step leave; `toggleAnnotate` never passes a target (`continued` goes);
  adopt (continuous for a targeted toolbar, once for `loadedCase`); opening a case hides
  a new-case toolbar; Delete ends with `discard`. `follow.ts` is unchanged.
- `state.ts`, `view.ts`, `index.html`: the Settings view (`settings: boolean`) with the
  AI card and Options, opened by the pill; Home's button states and hints; the Case's
  action row and This-tab block; the top bar with the large back button.

Tests:

- Unit (`view.test.ts`): Home's button and hint for each overlay state, never "Continue
  annotating". Unit: `overlay:end` on a `MarkAdder`: target cleared; a failed mark
  keeps the toolbar; `discard` drops it.
- e2e (`panel.test.ts`, `adding.test.ts`): Add marks, then "← All cases": no toolbar,
  no marks, "Annotate this page", and a mark drawn afterwards is a draft of a new case;
  "Save case…" opens the case in the panel; the AI pill in a case keeps case, marks and
  toolbar; panel closed and opened: the case is open again; Hide, reload: marks stay
  off; an AI app's `load_case` of the open case is cleared by "← All cases"; the back
  button is at least 32 px high.

Risks: `overlay:end` racing `follow()` (await the end, then `case:clear`); e2e tests
that click the AI card with real mouse clicks need Settings open (`element.click()`
does not); tests that use `new-case` or expect "Continue annotating".

### b. Verify

- `case.ts`: the fields and their validation (drop `verified` off a non-fixed kind, cap
  `reopens`), `markStatus`, `STATUS_LABEL`, `caseCounts`, `withVerified`, `withReopen`,
  `withResolution` with `verified` and `app`.
- `view.ts`, `main.ts`, `state.ts`: the status block with chips and filter, the card's
  second row, the history, Verified, the Reopen form (`MarkEdit.mode: "reopen"`), the
  four-way Resolve form, crops no longer greyed, counts in the import prompt and the
  case list.
- `overlay.ts`, `review.ts`: `ReviewItem.status` in place of `resolved`; a mark to
  verify drawn in full in `#4f53e0` (verified stays grey and faded until PR d); the
  review bar's text.
- `tools.ts` (`set_mark_status`, `get_case`, `list_cases`, `INSTRUCTIONS`,
  `confirmLines`) and `markdown.ts`, as specified above.

Tests:

- Unit: every transition of the table; `reopens` keeps `was` whole and caps at 20; a
  case without the fields validates unchanged; `verified` on `wontfix` is dropped;
  `caseCounts`; `case.md` for each status; `set_mark_status` for each status, the
  refusal, idempotence, `fixed` on a verified mark.
- e2e: the developer sets Fixed and exports; the import ("Replace it", with the counts
  line) shows "To verify"; Verified moves the bar and chips; Reopen needs text, and the
  note shows in the card's head and in `get_case`; an AI app's `verified` asks first
  and shows "by …".

Risks: a colleague on an older build loses reopen notes silently (README); an Always
allow for `set_mark_status` now also covers `verified`; `get_case`'s size budget (hence
the 2,000-character cap).

### c. Sync

- Manifest: the `offscreen` permission; `offscreen.html` and its script (export, blob
  URL, revoke), bundled by `scripts/build.ts`; `PRIVACY.md` names the permission.
- `lib/sync.ts`: the target interface, the Downloads target, the `target` key and its
  back-compat read, the paused reasons. Worker: runs either target; sets badge and
  title with each status.
- `sidepanel/sync.ts`, `view.ts`, `index.html`: the Sync section's states, "Change…",
  "Use Downloads instead", the banner drawn for every view.

Tests:

- Unit: `Sync` with a fake Downloads target (writes, skips unchanged, a rename leaves
  the old file, permission gone → paused with its reason, an interrupted download →
  failed, the previous entry erased); no `target` + `folder` → folder mode; the badge
  for each status.
- e2e (`sync.test.ts`; the test build has `downloads`): "Sync to Downloads" writes
  `Overmark/<name>.overmark.zip` into the profile's downloads folder; an AI app's
  change with the **panel closed** writes it again; a paused folder shows the banner in
  the case view and on Home and the badge "!"; Allow access (a stubbed
  `requestPermission`) clears both; "Use Downloads instead" switches.

Risks, to try first in a spike as DEC-021 did: the worker must be able to download the
offscreen document's blob URL (if not: the panel makes the URL while open, a data URL
serves cases under 1.5 MB, larger ones wait and the section says so); Chrome's "Ask
where to save each file" may open a dialog despite `saveAs: false` (the section then
says to turn it off or to choose a folder); the download bubble may flash on each write.

### d. Look

- `style.css`: the token block and the components; `index.html` classes.
- `overlay.ts`: ring, casing, status colours (open = `MARK_COLOUR`, verified green),
  dash for unsure, forced colours, the two-row rule. `paintMark` is not changed.
- `view.ts`: pins (fill by match), the margin rail, "Dashed: unsure." in place of
  "Green: found. Amber, dashed: …".

Tests:

- Unit: a contrast test that reads the token block from `style.css` and the constants
  from `overlay.ts` and asserts every pair of the two tables above.
- Unit (`view.test.ts`): the pin's classes per match and status; a review item's stroke
  colour per status and its dash per match.
- e2e: no horizontal scroll at 360 and 420 px in Home, Case and Settings; at most one
  `.primary` per view; each mark's shape on the page has its casing (two stroked
  elements); `--paper` and `--ink` as computed under an emulated dark scheme.

Risks: e2e and unit assertions on `FOUND_COLOUR` / `PROBABLE_COLOUR` and on the hint's
wording.

# Citations

- [Iteration 17: the owner's decisions and feedback](../iterations/iteration-17-ux-rework.md)
- [Decision log: DEC-014, DEC-019 to DEC-022](../decision-log.md)
- [Overmark design](overview.md)
- [WCAG 2.2, 1.4.3 Contrast (Minimum)](https://www.w3.org/TR/WCAG22/#contrast-minimum)
- [WCAG 2.2, 1.4.11 Non-text Contrast](https://www.w3.org/TR/WCAG22/#non-text-contrast)
- [Chrome extensions: chrome.downloads](https://developer.chrome.com/docs/extensions/reference/api/downloads)
- [Chrome extensions: chrome.offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Chrome extensions: chrome.action (badge text and colours)](https://developer.chrome.com/docs/extensions/reference/api/action)
