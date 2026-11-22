<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/lockup-light.svg">
    <img src="assets/brand/lockup.svg" alt="Sitegloss" width="300">
  </picture>
</h1>

Mark what is wrong on a web page, open the marks in another environment to fix it, and
talk them through with your AI app.

A PO marks an issue on the live site: picks an element, draws a box, an arrow or a
freehand mark, writes a comment, and saves it all as a named case with annotated
screenshots. A dev loads the case onto `localhost:3000` and sees what was meant in their
own environment. After the rollout the PO loads it onto the dev and prod sites and checks the
fix. An AI app such as Claude reads and extends cases through a
[tab-mcp](https://github.com/ractive/tab-mcp) relay, or a case travels as a zip file.

Status: in development. The plan is in [kb/](kb/index.md).

## Install for development

Requires [Bun](https://bun.sh) 1.4.

```sh
bun install
bun run build      # builds dist/ (extension ID ldmcfigcnobhnbaigehcaodheklibeon)
```

In Chrome, open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and
choose `dist/`. Click the Sitegloss icon on a tab (or press Alt+Shift+O) to open the side
panel there.

`bun run zip` packs `sitegloss-<version>.zip` for sharing; unzip it and load the folder
the same way.

For Firefox (see [In Firefox](#in-firefox)), `bun scripts/build.ts --firefox` builds
`dist-firefox/`; in Firefox open `about:debugging`, This Firefox, "Load Temporary Add-on…"
and choose its `manifest.json` (gone when Firefox quits). `bun scripts/firefox-dev.ts`
builds it and starts Firefox with it through [ff-rdp](https://github.com/ractive/ff-rdp),
in a profile that is kept. The package for addons.mozilla.org is built as described in
[Building the Firefox package from source](#building-the-firefox-package-from-source).

Without building: every CI run has the zip as the artifact `sitegloss-unpacked` on its
page (Actions → the run → Artifacts), and every release has it under Releases. Each also
has `sitegloss-store`, the package for the Chrome Web Store; publishing it is described
in [kb/operations/chrome-web-store.md](kb/operations/chrome-web-store.md).

## In Firefox

Sitegloss also runs in desktop Firefox (153 or later; not Firefox for Android). The Firefox
version is on its way to addons.mozilla.org; there is no listing yet. Until there is, a
release has `sitegloss-firefox-<version>-store.zip` under Releases: in Firefox open
`about:debugging`, This Firefox, "Load Temporary Add-on…" and choose that zip. It stays
until Firefox quits, since release Firefox installs only signed add-ons for good.

It is one codebase; the difference is decided when the package is built, never by the
user agent. What differs from Chrome and Edge:

- Firefox has no extension service workers, so the background is an event page, and no
  side panel API: Sitegloss is a sidebar there, which the toolbar icon opens. Firefox
  stops an idle event page after 30 seconds, and its connection to the AI app with it; while
  AI access is on, or a question waits, the background calls an extension API every 20
  seconds to keep it running.
- The AI app connection allows Firefox's origin, `moz-extension://<a UUID per
  installation>`, so no list can name one extension. The hosted relay admits Firefox
  extensions since 2026-11-16; a relay of your own must allow `moz-extension://*` (relay
  0.11.0 or later).
- Firefox asks once, at the click that turns AI access on, whether Sitegloss may collect
  website content and browsing activity (its built-in data collection consent). Nothing is
  required at install. Without that consent AI access does not start, and it ends when you
  take the consent back in Firefox's add-on settings. Without AI access nothing leaves
  your computer, as in Chrome.
- The sync writes to a subfolder of Downloads only: Firefox has no folder picker, so
  "Choose a folder" is not offered. Overwriting a file replaces it without a dialog.
- A notification has no buttons in Firefox and closes by itself. A question from the AI
  app says to answer in the sidebar, which the Sitegloss icon opens (it shows "?" while a
  question waits; Firefox does not let a notification's click open a sidebar, so that
  click only brings the question's window to the front), and its closing is no answer
  (in Chrome a close is Don't allow). The question in the sidebar asks you to
  click into it first, as Firefox leaves the focus in the page.
- For files on your computer (`file:` pages) there is no button: turn on "Access local
  files on your computer" in Firefox's Add-ons and themes, under Sitegloss, Permissions and
  data. The "cannot run here" text says so, and names `about:` pages and
  addons.mozilla.org, which are off limits to extensions.
- Firefox has no event for a window's size changing, so the tab's size shown in the
  sidebar is read again every 3 seconds while the sidebar shows.

## Use

1. Click the Sitegloss icon on a tab. The side panel opens there.
2. "New case for this page" creates a case at once, named after the page's title, opens it
   in the side panel and shows the toolbar on the page: Element (click one), Box, Arrow,
   Pen and Note, each followed by a comment. Sitegloss takes screenshots with the marks
   on them and records each marked element's details (tag, role, name, text, readable
   classes, test id, the heading it is under, a selector, its position) and, once, how
   it looked: its computed styles, the colour behind it and its neighbours' boxes, for
   contrast and alignment questions. "Rename" beside the case's title
   changes it (Enter saves, Escape cancels). "Add a link" under it attaches a link to
   the case, a ticket or a design, which then opens with a click ("Edit" changes it,
   an empty field removes it). There is no save step: everything is
   stored as you do it. A case you leave without a single mark, as it was made, is
   deleted again.
3. The toolbar adds to a case only while that case is open in the side panel: after
   "New case for this page", and whenever the toolbar was started with "Add marks" in a
   case, the toolbar says "Adding to “<case>”" ("Done adding" in the side panel stops
   it), and each mark goes into that case as soon as its
   comment is done (Done, or the comment closed with Escape or a click elsewhere); the
   case in the side panel shows it at once. Marks in the case stay on the page,
   fainter. Undo takes the last
   mark added since the toolbar was shown out of the case again, while nobody has
   resolved or edited it. A mark whose screenshot the page moved away from is taken
   again by itself once the page stands still. A mark that could not be added stays on
   the page with the reason and an "Add mark N" button to try again; it never moves to another case unless
   you click that button. Done tries such marks once more and closes the toolbar when all
   are in; while one is not, the toolbar stays up and says so, and Done again discards
   it. "← All cases" at the top of the side panel closes the case: the toolbar finishes
   as with Done and adds to no case any more, and the case's marks leave the tab, also
   those an AI app drew; with a mark not in the case yet the panel stays and says so,
   and a second click leaves without it. A new case starts there, with "New case for
   this page". Closing the side panel leaves marks and toolbar on the page; opening it again
   opens the case the page shows. A case can span several pages: go on to the next page
   of what you are testing, click "Add marks" again, and the marks you draw there go into
   the same case, which lists its pages with their marks and opens each with a click.
   A page is its path (and its hash route, `#/cart`), in whatever environment; in a
   case's list of pages a site's home page is that site's only. Pages that differ only
   in their query (`?route=cart`, `?id=2`) are one page to Sitegloss: such a case has
   one page. Each screenshot keeps its query beside the page's address, without the
   parameters that look like secrets or e-mail addresses, so that a mark's link opens
   the page as it was marked (a search, a filtered list).
4. Home lists a case under "This page" on the very page, of the same site, that one of
   its screenshots was taken on; nothing opens by itself. On the same page in another
   environment (say `localhost:3000`), click the case in the side panel's list:
   the marks of the page in front are drawn there: a mark is that page's when it was
   made on the same path and hash route, whatever the host, and the home page of any
   host is the home page in front. A mark of another page is not looked for, drawn or
   counted there; the side panel says "On another page" for it. Each mark says where it was made
   with a link that opens that address, query and all, in the tab in front and shows
   the mark once the page has loaded; with the case open on another host, a second link
   opens the same path and query there. While the case is open
   they follow the tab in front: another tab, a reload or a navigation draws them there
   and takes them off the tab before; "← All cases" takes them off the page.
   "Hide marks" takes them off, and they stay off on that tab, also through a reload,
   until "Show marks" or the case is opened again. When the case has no mark of the page
   in front, the case says where its marks are and offers to open the case's page; when
   none of the page's own marks is found, it says so. Home lists a case of several
   pages under "This page" on each of its pages on the site they were marked on. On a tab Sitegloss may not run on yet (after reloading the extension, say),
   Chrome hides the address, and the side panel says so with a warning: click the
   Sitegloss icon there (or press Alt+Shift+O) and the marks are drawn, or press "Allow
   on all sites" in that notice; until then what needs the page is off. The case's
   address opens its page in a new tab (Chrome asks whether Sitegloss may run on that
   site from then on) and draws the marks there (marks a script draws late are looked
   for again for a few seconds), and when the
   tab's size is not the one the marks were made at, Match size resizes the window to it
   (as far as the screen allows; page zoom is counted). Sitegloss looks for each mark's element and draws the mark on it again,
   moved and scaled with the element: solid when found, dashed when probable or unsure.
   Its colour is its status: the pink of the screenshot while it is open, indigo when it
   is fixed and to verify, green once verified, grey when dismissed (won't fix, can't
   reproduce; verified and dismissed ones faded); a white edge under every stroke keeps it visible on any page.
   A mark drawn on a large container can land a little off when that
   container changed its size. A mark without an element goes where it was, dashed.
   Show scrolls to a mark; Next candidate tries the next best element. The screenshots
   stay the record, so a mark makes sense even when its element is not found.
5. Each mark in the side panel has a status: open, fixed and to verify, verified, won't
   fix or can't reproduce. Resolve… sets it (Fixed, to verify; Fixed and verified; Won't
   fix; Can't reproduce; with an optional note). The tester, where the fix is deployed, then
   clicks Verified on a fix that holds, or Reopen… with a note on what is still wrong;
   the claimed fix and its note stay in the mark's history. The status chips under the
   case's bar (Open, To verify, Verified, Dismissed) count the marks and filter the list:
   the developer works through Open, the tester through To verify. On a loaded page a
   mark to verify is drawn in full in indigo; a verified one is drawn green and a dismissed
   one grey, both faded, and no longer counted. A mark can also have its comment
   edited, or be deleted. A deleted mark's number is not given again, and its pin
   stays on screenshots that other marks share.
   Under the comment a mark shows its AI findings: what a connected AI app found out
   about it, each with the app's name and when it was written. An AI app never changes
   your comment, and changes only its own findings; you can delete any finding (click
   Delete twice).
6. The case's "Summary for the developer" says what should change overall, as agreed;
   whoever loads the case sees it first. You or the AI app write it.
   Under the marks, Comments is the case's thread: what was done (a fix, a pull request),
   a question, a decision, about the case or about one mark (chosen beside Add comment).
   Each comment says who wrote it and when, "via Claude" when an AI app wrote it for
   that person, and which mark it is about; a mark with comments says how many in its
   row. You change and delete your own (Delete asks twice); another's stays. A comment
   on a mark that is deleted stays, "on a deleted mark".
   Close case, at the bottom of the case, files a case away: it moves from the list to
   Closed (folded, under the cases) and stays readable and changeable; Reopen case
   brings it back. A new open mark, or a mark reopened, opens a closed case by itself.
7. Export writes `<title>.sitegloss.zip` (`case.json`, `case.md` and the images) to pass
   on; "Import a case…" reads one back, opens it and draws its marks on the tab in
   front. An AI app can read `case.md` and the images without the extension.
   "Export all cases", next to "Import a case…", writes every case into one
   `sitegloss-cases-<date>.sitegloss.zip`, a folder per case laid out as a single export;
   "Import a case…" reads that too, case by case, asking about each case that is here
   already (Replace it, Keep both or Skip). At the first Export, Chrome asks whether
   Sitegloss may manage your downloads (an optional permission): with a yes the side
   panel shows where the file went, with Copy (its full path) and Show in folder; with
   a no the file is saved as before and Chrome asks again only at the next Export.
8. Copy to a folder, under Files on Home, keeps a copy of every case as a file: each case as its own
   file, the same `<title>.sitegloss.zip` as Export writes, and again whenever the case
   changes, also when an AI app changed it. The files are a mirror: Sitegloss never reads
   them, and a deleted case keeps its file, so "Import a case…" can bring it back. Two
   cases of the same title get `-2`, `-3`. Where to:
   - **Copy to Downloads** (the default) writes to a folder `Sitegloss` in Chrome's
     downloads folder. Chrome asks once whether Sitegloss may manage your downloads; then
     it writes with the side panel closed too, also after a browser restart. Each write
     shows in Chrome's download list; Sitegloss keeps only its newest entry there, for
     "Show in folder". A case keeps the file name it was first written under, also after
     a rename (nothing can be removed there, so a new name would leave the old file). Files deleted there are written again at their case's next change, or
     all at once with Change… and Copy to Downloads. The folder is one for every Chrome
     profile and browser on the computer: two of them copying to Downloads write into the
     same `Sitegloss` folder, and a case of the same title in each overwrites the other's
     file; give each its own folder with Choose a folder…. With Chrome's "Ask where to save each file before downloading" on, Chrome
     would ask at every write: the copy then says so and fails until it is off.
   - **Choose a folder…** writes to any folder (one in iCloud Drive or Dropbox, say). A
     renamed case's old file goes there, and a file Sitegloss did not write is never
     overwritten. Chrome lets Sitegloss write to it only while its side panel is open, and
     asks for the folder again after the side panel was closed or the browser restarted.
   The side panel shows where it copies to with when it last wrote, "Change…" and "Stop
   copying" (the files stay). When the copy is paused (the folder needs your OK again, or
   the downloads permission was taken back) or has failed, a banner above every view of
   the side panel says so with the button that helps (Allow access, Allow downloads, Try
   again; for a folder also "Use Downloads instead"), and the toolbar icon shows "!"
   (amber paused, red failed), also before the side panel is opened. Permissions for
   this: the optional `downloads`, and `offscreen` (no install warning), as a service
   worker cannot make the file's URL for a download itself.

## With an AI app

Sitegloss offers the cases to an AI app (Claude Code, Claude, ChatGPT, Codex) through a
[tab-mcp](https://github.com/ractive/tab-mcp) relay. The connection is held by the
extension's background service worker, so it stays while the side panel is closed; the
side panel shows it and sets it up. Sitegloss uses the hosted relay
`https://tab-mcp.ractive.ch` unless you enter another one in the side panel. It allows
only Sitegloss's ID, `chrome-extension://ldmcfigcnobhnbaigehcaodheklibeon`: the store
version's, which unpacked builds share through the store's key in `manifest-key.txt`.
The tools:

| Tool | What it does |
|---|---|
| `list_cases` | The saved cases, with their pages and their marks by status |
| `get_case` | A case's pages, its summary for the developer, its marks with their page (and the address with its query where it had one), comments, statuses, reopens, AI findings, element details (with how the element looked when marked: computed styles, the colour behind it and the contrast, its neighbours' boxes) and crops, the newest 20 comments of its thread, and whether it is closed |
| `get_image` | One screenshot or crop |
| `load_case` | Finds the marks' elements on the tab in front and draws the marks there |
| `open_case` | Opens a case in the side panel, as a click on it there would, and draws its marks on the tab in front (the case made on production, the tab on `localhost:3000`), leaving the case shown as a click would and never while something is being typed there; navigates nowhere; asks first |
| `highlight` | Scrolls to one mark's element (or another candidate) |
| `get_mark_element` | A mark's element on the tab in front, read from the live page: trimmed HTML, box and window size, computed styles, matching CSS rules, ancestors and children, beside the styles recorded when the mark was made; a CSS selector reads one of its ancestors or an element inside it instead (for a mark without an element, an element of the mark's page) |
| `capture` | A screenshot of the tab in front |
| `add_mark` | Adds a mark on an element (by CSS selector); asks first |
| `set_summary` | Records the summary for the developer: what should change overall, as agreed; asks first |
| `set_mark_status` | Sets a mark fixed, verified (a fixed one, when you say so), won't fix or can't reproduce, or reopens it with a note; asks first |
| `add_finding` | Adds a finding of the AI app to a mark, apart from your comment; asks first |
| `edit_finding` | Changes one of the app's own findings; asks first |
| `delete_finding` | Deletes one of the app's own findings; asks first |
| `list_comments` | A case's thread, oldest first, 50 at a time, each comment with who wrote it and whether it is the app's own |
| `add_comment` | Adds a comment to the case's thread, about the case or one mark; asks first |
| `edit_comment` | Changes one of the app's own comments; asks first |
| `delete_comment` | Deletes one of the app's own comments; asks first |
| `set_case_status` | Closes a case or opens it again; asks first |
| `delete_case` | Deletes a case; asks first |

What an AI app changes through these tools carries its name: in a team the change says
"Dana via Claude" (the person signed in, and the app), here and on the website. What you
do in the side panel carries only your name.

No tool runs code an AI app sends. Page text in the results comes from web pages, and
the tools say so to the model. `get_mark_element` sends no form field values, no
text typed into editable regions, no hidden elements and nothing of the page's head,
and URLs without their query string, fragment or user name and password.

### A relay on your computer, for Claude Code

The relay must allow Sitegloss's origin, `chrome-extension://ldmcfigcnobhnbaigehcaodheklibeon`,
and be relay 0.12.0 or later (Sitegloss's `@ractive-ch/tab-mcp-client` has not worked
with older relays since its 0.17):

```sh
docker run --rm -p 127.0.0.1:8080:8080 \
  -e NODE_ENV=development \
  -e TAB_MCP_PUBLIC_URL=http://localhost:8080 \
  -e TAB_MCP_STORE=memory \
  -e TAB_MCP_SITES='[{"origin":"chrome-extension://ldmcfigcnobhnbaigehcaodheklibeon","name":"Sitegloss"}]' \
  ractive/tab-mcp:0.12.0
```

Then, in the side panel's "AI app" card, set the relay to `http://localhost:8080`
and click "Turn on AI access" (or flip the AI access switch). With no AI app paired yet,
the card shows the address and a code at once; with apps paired, "+ Add another AI app"
shows them. The address is `<relay>/s/sitegloss/mcp`, the same for everyone who has
Sitegloss (the Firefox build's too); the code, 8 letters shown as `XXXX-XXXX`, pairs the
AI app with this browser's Sitegloss. Under the address, "How do I add it?" opens the steps for Claude, ChatGPT,
Claude Code and Codex (the tab-mcp client library's, with the address in them), each
command with its own Copy, and a link to the step-by-step guide. Add the address to
Claude Code, then run `/mcp` there and choose Authenticate:

```sh
claude mcp add --transport http sitegloss <address>
```

Your browser opens the relay's page; type the code from the side panel.

If that page opens in the browser Sitegloss runs in, Sitegloss can fill in the code for
you. It is off until you turn it on, also if you allowed Sitegloss on all sites: under
the code, "Fill in the code for me" turns it on and, when Sitegloss does not have it yet,
asks the browser for Sitegloss's access to `tab-mcp.ractive.ch` (optional, only that
site; Chrome says "Read and change your data on tab-mcp.ractive.ch"). From then on, when
an AI app opens the hosted relay's pairing page for Sitegloss in this browser while AI
access is on, the side panel asks "An AI app at <host> (it calls itself “<name>”) wants
to connect to Sitegloss on the relay's page in this browser. Fill in the code there?",
the host as the relay verified it, the name as the app gave it. "Fill in the code" (it
waits a moment, as Allow does) types Sitegloss's code into that page's field and clicks
Connect; "No" leaves the page as it is. With the side panel closed, a notification says
to open it. Sitegloss asks about one page at a time: a second one while a question waits
is not asked about, and the panel says to answer first and reload it, or type the code
there. Sitegloss never fills in a page of another site, one that is not for Sitegloss,
or another request than the one it asked about, and never connects without that yes; a
wrong code brings the relay's page back, and Sitegloss asks again. "Stop filling in the
code" turns it off and gives the site back (unless Sitegloss may run on all sites).
Typing the code always works too, also in another browser. With another relay set, there
is no offer. Upgrading from 0.3.0, where "Allow on that site" turned it on: it is off,
and the site that button allowed is given back once at the first start (unless
Sitegloss may run on all sites); "Fill in the code for me" asks for it again.

The connection
stays when you close the side panel (the icon shows "on"), until you turn the switch off
or click "Stop AI access" (either keeps the pairing), the relay's end of an idle session, or the browser closes; an update
or reload of the extension (or turning it off) ends it too. "Keep AI access on" connects
again by itself after all of these but "Stop AI access".

"Disconnect all apps", under the code, disconnects every AI app paired with Sitegloss;
each one pairs again with a new code, at the same address. With apps paired it asks for a
second click first. If another tab or program takes Sitegloss's connection over, the card
says so and offers it too, or "Connect again" to take the connection back.

Pairings from before Sitegloss used client 0.17 or later (the address `<relay>/a/<id>/mcp`) do
not work any more: remove that connector from the AI app, add the new address and pair
again.

Once an AI app is paired, the card says so with what to ask it next ("Look at the
Sitegloss case open in my browser and fix its marks") and a button back to the cases or
the open case.

A tool that changes something (marked "asks first" above) asks first: in the side
panel when it is open and on screen in the window in front (another extension's panel,
such as Claude in Chrome's, can cover it), otherwise in a system notification with
Allow and Always allow, where closing it is Don't allow (the icon shows "?" while a
question waits). In the side panel the question is a dialog over the panel, wherever it
is scrolled to, with Don't allow, Allow and Always allow, and it counts down its 60
seconds; "Stop AI access" under it refuses everything that waits. With no answer in that time the call does not run, and the AI
app is told you did not answer. "Always allow" lets that
tool run without asking for that AI app from then on; "Allow all changes", a switch
for each connected app under the side panel's top bar (and under the app in the AI app
card, in Settings, which the AI pill at the top opens), does so for every tool that
changes something, deleting a case too, also tools a later version adds. The card
lists the tools always allowed for each app, each with "Ask again" ("Ask again" while
"Allow all changes" is on turns that off too). Both last until the app's pairing ends
(you disconnect it, or all apps, or the relay lets it expire), also across browser
restarts; a tool always allowed asks again once an update of Sitegloss changes what it
says it does. The tab-mcp client library keeps them, beside the connection's secret. An AI app can be steered by text on a page it reads, so allow
always only what you would not need to check.

Sitegloss needs Chrome 116 or later. The connection's settings and its address secret
are in a database of the extension's own (IndexedDB in the extension's origin), which
only its background service worker uses and the scripts Sitegloss runs in web pages
cannot reach; the side panel changes them through the worker. Whether AI access is on
until the browser closes is in Chrome's session storage, also out of those scripts'
reach.

Permissions for this: `alarms` wakes the service worker once a minute while AI access is
on, so the connection comes back after a sleep; `notifications` asks the questions when
the side panel is not in front (Chrome mentions it when installing: "Display
notifications").

claude.ai, Claude Desktop and ChatGPT connect from their own servers, so they need a
relay with a public HTTPS address that allows Sitegloss's ID, such as the hosted one.

## With a team

Sitegloss works without an account, and nothing in it asks for one. If your team uses
[sitegloss.dev](https://sitegloss.dev), "Sign in" in the side panel's Team section
(on Home, under the cases) syncs your cases with the team, both ways:

- You sign in on the service's own page, in a window of the browser. With several
  teams you choose one; with one, that is it.
- Cases that were in the browser before are not sent without a word: a banner says how
  many there are and that the team's members will see them, with "Sync them" and "Keep
  them on this device". A case kept here has "Share with team" in its view, and the list
  tags it "This device only". A case you make while signed in is the team's once it has
  a mark.
- Everything is still stored in the browser first. What you change goes to the team a
  moment later; what a teammate changes, in the extension or on the website, shows in
  the open side panel within a second or two, and otherwise within a few minutes. With
  the server away, your changes wait and are sent when it is back.
- Two people who change different things of one mark both keep their change; for the
  same thing the later one wins. Two who add a mark at once: the later one gets the next
  number (its pin in the screenshot keeps the number it was drawn with).
- A resolution, a verification, a reopen, a finding, a comment, a close and the summary
  say who made them ("by Dana"), and a mark who added it and who last changed its
  comment; "by Dana via Claude" when an AI app connected to Sitegloss did it for Dana.
- The thread and closing sync like the rest: a comment written offline waits and is
  sent. A Sitegloss before 0.3.1 on the same team keeps syncing its marks and does not
  see the comments or that a case is closed; a mark it adds opens a closed case again.
- Deleting a case the team has deletes it for the team; the button says so. A case
  deleted for the team goes here too. What you delete while signed out is not deleted
  for the team: at the next sign-in the team's marks are back, and Sitegloss says so.
  A case that is merely gone from this device (the browser lost its database) is not
  deleted for anyone: it is read from the team again.
- A case the team already has (the same file on two devices) is joined with the
  team's, not sent a second time: marks only here are sent, the team's other marks
  come here, and where both differ the team's text is kept. Sitegloss says so before
  you share, with the number of marks; when it finds out only while sending, it stops
  and asks then, and replaces nothing before you answer.
- The Team section shows who is signed in, the team, and what the sync is at, as a
  state: "Up to date. Changes sync as you work." while the side panel hears the team's
  changes live and nothing waits to be sent; "Syncing…"; how many cases wait to be
  sent; "Offline" with what waits; when it last synced, if the team's changes are not
  coming in live; or what the server did not take and why. "Sync now" is there only
  when it can do something (something waits, a refusal to try again, no live changes),
  and "Sign out" always. Signing out stops the sync and keeps the cases, on this device
  only.
- "Server" there chooses where to sign in, while nobody is signed in: Sitegloss
  itself (app.sitegloss.dev, unless you choose otherwise), its development server, or
  another address (https, or plain http on this computer). When it is not Sitegloss
  itself, the Team section says so. Each server has its own account, team and
  sync: a case synced with one is on this device only as far as another goes, until
  you share it there, and switching back finds everything as it was.

The copy to a folder above is another thing and stays as it is: one way, to files.
With the tab in front showing the team's web app (the server you are signed in to),
the side panel says so in one line, as its case pages show the same cases.
Permission for signing in: `identity` (no install warning).

## Development

```sh
bun run verify        # Biome, type check, unit tests, the end-to-end smoke set
bun run fix           # format and apply safe lint fixes
bun run test:e2e      # every Chromium end-to-end test
bun run test:firefox  # the Firefox end-to-end tests
bun run test:server   # the tests against a real sitegloss.dev server
```

`verify` runs before every commit and in CI on every pull request and on main; its
end-to-end part is a smoke set of about a dozen tests, each crossing a boundary only a
browser has. The full Chromium and Firefox sets run every night (when main has moved),
on a release tag before anything is built, and by hand (Actions, "End-to-end tests").
So a break that only a browser shows is found the next night or at the release, not
before the commit. `SITEGLOSS_E2E=full` is the switch (`test/e2e/mode.ts`).

`bun scripts/api-types.ts` writes the types of the sitegloss.dev API
(`src/lib/cloud/api.gen.ts`) from the copy of its OpenAPI document in
`src/lib/cloud/openapi-v1.json`; with a path, it takes a new copy first. Both files are
committed, and a test fails when they disagree.

Three tests run only against a real sitegloss.dev server, named in `SITEGLOSS_SERVER`
(the server's `bun scripts/serve-local.ts 3200 --demo` and
`SITEGLOSS_SERVER=http://localhost:3200`, with its demo users' password in
`SITEGLOSS_PASSWORD`): `test/cloud-server.test.ts` (the sync engine),
`test/e2e/cloud.test.ts` (the extension in Chromium) and
`test/e2e/firefox/cloud.test.ts` (in Firefox; the server has to allow Firefox's
redirect address, in its `EXTENSION_REDIRECT_URIS`). In both browsers "Sign in" opens
the browser's real sign-in window, and the test signs the demo user in there. Without
the variable they are skipped. `bun run test:server` runs the three, before every
release.

The end-to-end tests load the extension into Chrome for Testing or Chromium
(`CHROME_PATH`, or Playwright's download in its usual cache). Branded Chrome ignores
`--load-extension`, so without one of them the tests are skipped locally; CI runs them.
The Firefox ones need Firefox and `ff-rdp` (`FIREFOX_PATH`, `FF_RDP_PATH`).

### Building the Firefox package from source

For addons.mozilla.org's reviewers, and anyone who wants to check the package: the
source archive `sitegloss-<version>-source.zip` of a release (or the repository at its
tag) builds the package that was uploaded, `sitegloss-firefox-<version>-store.zip`. The
code is bundled with Bun and not minified in this package, and has no source maps.

- Operating system: macOS or Linux (the release is built on Ubuntu).
- Tool: [Bun](https://bun.sh) 1.4.4, the version `.github/workflows/release.yml` pins.
  Nothing else: no Node.js, no global packages.
- Version: the `version` in `package.json`; the build does not need git.

```sh
unzip sitegloss-<version>-source.zip && cd sitegloss-<version>
bun install --frozen-lockfile
bun scripts/build.ts --firefox --store --zip
```

This makes `dist-firefox-store/` (the unpacked package) and
`sitegloss-firefox-<version>-store.zip` beside it. The zip is reproducible: the same source
and Bun give the same file, with the same SHA-256, wherever and whenever it is built.
Sitegloss's own code is in `src/`, the build is `scripts/build.ts`, and the bundled
packages are listed with their licences in the package's `LICENSES.txt`.

## Licence

MIT, see [LICENSE](LICENSE) and [AI_NOTICE](AI_NOTICE).
