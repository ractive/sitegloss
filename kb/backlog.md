---
type: backlog
title: "Backlog: what waits until after the release"
description: Features that were discussed and put aside on purpose, with what was worked out about each, so nothing has to be thought through twice. The owner's order is release first, then polish, then new features.
tags:
  - backlog
  - planning
timestamp: 2026-11-22T19:00:00+01:00
---

# Backlog: what waits until after the release

The owner on 22 November 2026: "At some point we need to release what we have, then build
upon it: first make it nice and cool, and then add new features." So the order is:

1. release what exists (the extension from `main`, see `kb/open-questions.md` and the
   service's draft pull request for the store-day texts);
2. make what exists good to use and good to look at;
3. only then the features below.

An entry here is not a decision to build it. When one is taken up, its design moves to
`kb/design/` and its decisions to the decision log.

## Polish of what exists (before new features)

- **The floating bar and the modes.** Built as a draft for the owner to judge on the branch
  `panel-round-3` (DEC-061): the bar can be dragged and keeps its place, two states only
  (Hide marks leaves a pill that shows them again; adding shows them; hiding ends adding),
  "Add marks" on the bar, the bar steps aside while marks are added. Round 4 on
  `panel-round-4` (DEC-063) makes "Add marks" the bar's main action and adds the panel's
  sticky tool bar. Waits for the owner.
- **The sync state on the case itself.** The sync knows its state (syncing with the number
  of cases left, offline, a problem per case, synced with a count still waiting), but shows
  it only as one line in the Team section. After "Sync it" nothing shows on the case. Wanted:
  the state on the case in the list and on the open case ("Sending… 3 of 12 images",
  "Synced", "Not sent:" with the reason). Needs progress per case from the sync engine.
  Known gap beside it: an error of the browser's own storage has no place in the panel.
- **What comes next, on the open case.** The panel never says how to go on. One block that
  follows the case's state: no marks yet (add marks), marks but not synced (sync or
  export), marks and synced (hand over), marks fixed (verify them), all settled (close).
- **Hand-over, the small part.** "Copy link" (the case's address in the web app is enough
  for a team member; for someone outside the team, open the web app's share dialog) and
  "Copy instructions for your AI agent" (the same text as the web app's, from one shared
  template that names the case's title and address, says how to add the MCP server, and
  what to do with a mark that cannot be fixed).
- **The open case's head in the panel is a pile.** Built as a draft after the web's case
  page, on the branch `panel-round-3` (DEC-061): the title with a "…" menu (Rename, the
  link, Export, Delete case), the counts, one action (Add marks), one quiet facts block
  (Pages folded to three, Team, Link, Made at), no web-app line, the found sentence for a
  screen reader only, "Match size" only past 24 px of width or 100 px of height, and what
  the tab shows under the head. Round 4 on `panel-round-4` (DEC-063): Add marks moves to
  the sticky tool bar, the pages list is one disclosure, one row per page across hosts.
  Waits for the owner.
- **The page's mark dialog could take pasted and dropped images safely** only if the page
  never saw the event: a content script registered at `document_start` with a window
  capture listener that stops the event when it is aimed at Sitegloss's dialog would run
  before any listener of the page. Sitegloss injects its script on demand today, so it
  cannot be first. Until then the dialog sends images to the panel (DEC-063).
- **Mark 48's box offset on "Delete finding"** (owner's case, 22 November 2026) was not
  reproduced; see DEC-063 for what was ruled out. Needs the mark's recorded details.
- **An AI app cannot tell that AI access is off.** When AI access is off (after a reload or
  update of Sitegloss without "Keep AI access on", an idle session, a browser start), an AI
  app that calls a tool gets the relay's "The page is not open, or not in front. Ask the
  user to open Sitegloss and keep it in front…". That sends the person looking for a page,
  not for the AI access switch (owner, 22 November 2026: "Why did it turn off?"). Wanted: an
  answer that says AI access is off in Sitegloss's side panel and that "Keep AI access on"
  keeps it across reloads; the text is the relay's and the client library's (tab-mcp), so
  it starts as a request there. Also unknown: whether switching to another macOS user cuts
  the connection of the first user's browser.
- **A deleted mark that stayed drawn** (owner, 22 November 2026: deleted in the panel, the
  mark was completely covered by another). Not reproduced in the content script. Two
  causes found by reading, both in the panel's wiring and both unconfirmed: a case change
  is sent only to a tab where the panel knows the case is drawn, so a delete does not reach
  a tab where "Add marks" draws its own marks after "Hide marks"; and a delete that lands
  while the panel's first draw is still running leaves the old copy drawn.

## Features (after the polish)

### Images a person adds to a mark

Asked for on 22 November 2026: a menu that closes as soon as a Sitegloss tool is picked
cannot be marked, so the person wants to paste, choose or drop their own picture onto a
mark. Built on 22 November 2026 in the extension and the service (the design
[Images a person adds to a mark](design/mark-images.md), DEC-058, and the service's DEC-032).
Still to come: the web app's case page and the shared page do not show added images yet
(the mark's screenshot first, then the images, in one row and in the large view, as the
design's section 4 says for both); adding from the web app; GIF and AVIF, which are not
accepted because their size cannot be read safely before decoding.

### A key that freezes the page into a picture, to mark what closes

The second answer to the same problem. A second keyboard command captures the tab before
anything touches the page, and the person marks on the still picture. Such marks have no
element details. Feasible; about one pull request the size of the capture work of DEC-047.
Details in section 8 of the images design. Worth it only if closing menus stay a pain once
images exist.

### A proposal on a mark: show the fix, not only the complaint

The owner's idea (22 November 2026): with an AI app connected, "make this button green
instead of blue" could be tried on the live page, and what was tried is kept with the mark
as a hint for whoever implements it.

What was worked out:

- Half exists: an AI app already reads a mark's element with its HTML, computed styles,
  matching CSS rules, ancestors and children (`get_mark_element`). Missing: a tool that
  changes the page, and a place on the mark for a proposal.
- The flow: the AI app reads the element and calls a new tool with a change; the extension
  applies it, takes a new crop, stores the proposal (the change, the before and after
  pictures) and takes the change off again. The person flips between "as it is" and
  "proposal" and keeps or discards it. The implementing agent reads the proposal with the
  case.
- Three levels, each asked first and reverted after the picture:
  1. CSS declarations on the marked element and what is inside it (no `url(…)`, no
     `@import`: they make the browser send requests);
  2. text and harmless attributes of existing elements;
  3. sanitised static HTML inside the marked element (a list of allowed tags and
     attributes; no scripts, no event handlers, no forms, no outside addresses).
- How far CSS gets: about a third of real marks. Of the owner's 25 marks on the web app
  that day, about 8 were fully a matter of CSS, about 4 partly, about 13 not at all (new
  wording, new controls, new behaviour).
- HTML is not only a question of permission. A framework redraws its own tree and wipes or
  trips over foreign changes (which matters little when the change lives for one
  screenshot); markup from an AI app in a page where the person is signed in can mislead or
  redirect (hence the list of allowed tags, the scope and the question first); and a patch
  on the rendered page does not map onto source components (with the picture it is still a
  good hint).
- Scripts are never injected: the store's rule against code an extension did not ship, and
  the risk.
- The overlay's own elements (pins, borders, toolbar) are different: the extension's own
  shipped code, in one sealed container beside the page's content, not inside the page's
  own elements.
- For changes too large for this, the better proposal comes from the developer's side: the
  agent with the source builds the change on localhost and attaches a screenshot to the
  mark. That needs only images on a mark.
- Size: about that of the images feature, and it builds on it (the "after" picture is an
  image on a mark). Order: after images; level 1 first, levels 2 and 3 once it has been
  used.

### What went wrong on the page: errors and failed loads with the case

The owner's idea (22 November 2026): some marks exist because something failed (a style
sheet that did not load, a JavaScript error). If the extension noted that with the case,
the developer or the AI app would find the cause faster.

What the extension can and cannot see (from what is known of the browser's APIs; check each
against the current documentation before building):

- **The console's history: no.** There is no API that reads what the console already
  holds. A script in the page can listen from the moment it runs: uncaught errors and
  unhandled promise rejections (`error`, `unhandledrejection`), failed loads of images,
  scripts and style sheets (the `error` event in the capture phase), and, by wrapping them,
  `console.error` and `console.warn`. Sitegloss runs on a tab only after a click, so it
  misses what happened before that, unless the person has granted it all sites and it
  listens from the page's start; then "reload and record" is possible.
- **Loads that already happened: partly yes, with no new permission.** The page's own
  record of its loads (Resource Timing) reaches back to the page's start: the address, the
  time, and in current Chrome the status where the page is allowed to see it. A style
  sheet element without a sheet and an image without a size show a failed load after the
  fact.
- **The network tab as DevTools has it: only at a price.** The debugger permission gives
  console and network, but with Chrome's "is being debugged" banner, a permission warning
  at install and a stricter store review. Observing requests in the background needs
  access to the site and also starts only when asked.
- **Cookies: possible, and not to be done.** The cookies permission reads every cookie of
  a site, session cookies included. They are secrets and have no place in a case.

A small first slice that fits what exists: with each screenshot, a short list "problems on
this page": uncaught errors and rejections since Sitegloss was opened on the tab, and
failed or missing loads the page knows of. Addresses go through the same filter as page
addresses (no parameters that look like secrets), messages are cut and shown to the person
before the case leaves the browser, the privacy texts say so, and AI apps get the list with
the case. It touches the case file and the service's API, so it is not a one-evening job.

### Assign a case to a team member

The larger part of the hand-over: an assignee on the case, an e-mail to that member with
the case's link and the instructions for an AI agent, and "my cases" in the web app, the
panel and the MCP tools ("work on my open cases"). The service's API and database have no
assignee today. After the small hand-over part above.
