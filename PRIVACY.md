# Sitegloss privacy policy

Sitegloss is a browser extension for annotating web pages, for Chrome, Edge and
Firefox. It works without an account and has no analytics. What it keeps stays in your
browser, unless you export it, sync it, connect an AI app or sign in to sitegloss.dev
to share your cases with a team. Its author receives nothing from it, except what
passes through the hosted relay when you connect an AI app through it, and what you
send to sitegloss.dev when you sign in there.

## What Sitegloss keeps, and where

Sitegloss stores in your browser, on your computer:

- the case's title, your comments, the summary for the developer, a link you attach,
  a connected AI app's findings, the case's thread of comments and whether the case is
  closed;
- the address, title and language of each page you mark, the window size, and the
  browser's user agent. An address is kept without its fragment (only a fragment that is
  a route of the page stays). Its query string is kept with each screenshot, so that the
  page can be opened again as it was marked, after dropping every parameter that looks
  like a secret or an e-mail address (by its name, such as a token, key, code, session
  or e-mail, or by its value, such as an e-mail address or a long run of letters and
  digits); a query longer than 1024 characters after that is not kept at all;
- for each marked element (for an arrow or a line, also the elements at its two ends):
  its tag, role, name, a short piece of its text, a few attributes, its position, and a
  CSS selector. A link's address is kept as its path; a fragment stays only where it
  names a place on the same page (`#book`) or is a route;
- for the marked element itself, once when you mark it: how it looked, from a fixed list
  of computed CSS properties (colours, font, size, spacing, border, alignment, overflow;
  none that can hold an address, no custom properties), the colour behind it, and the
  position and size of up to six neighbouring elements (their tag only);
- screenshots of the visible part of the tab, with the marks on them;
- images you add to a mark yourself (pasted, chosen or dropped). Each is re-encoded
  before it is kept, which removes its metadata (camera, place, time) and its file name.
  Sitegloss reads the clipboard only when you paste into its side panel, and asks for no
  clipboard permission; the page being marked never sees these images;
- its settings, and where it syncs to;
- if you sign in to sitegloss.dev: your name and e-mail address there, your teams, the
  tokens that keep you signed in, and what the service last had of each case.

The exact fields are defined in the source code ([`src/lib/`](src/lib/)).

## When data leaves your computer

Only in four cases, all started by you:

1. **Export.** Export writes a case, or every case, to a zip file. Where it goes from
   there is up to you.
2. **Sync.** If you turn on the sync, Sitegloss writes each case as the same zip file to
   the browser's downloads folder, or in Chrome and Edge to a folder you choose (in
   Firefox, a subfolder of Downloads). If a cloud service syncs that
   folder, it uploads the files under its own privacy policy.
3. **An AI app.** If you connect an AI app (for example Claude), it can read your cases
   and their screenshots and added images, and the address (cut as above), title, element details and
   screenshots of the tab in front. For a mark, it can also read the HTML and CSS of
   the marked element, or of another element it names on that page, without form field
   values.

   This travels through a tab-mcp relay to the AI app. Unless you enter another relay,
   that is `tab-mcp.ractive.ch`, run by Sitegloss's developer, which forwards the data
   without storing it ([its privacy statement](https://ractive.ch/tab-mcp/privacy/)).
   The AI app's provider handles it under its own privacy policy.

   Changes the AI app wants to make are asked first, unless you chose "Always allow"
   for that change or "Allow all changes" for that AI app; either lasts until that AI
   app is disconnected. Which ones you chose is kept in the browser, beside the
   connection's secret, and goes nowhere.

   If you turn on "Fill in the code for me" (under the pairing code; off by default, also
   when Sitegloss may run on all sites; it asks for Sitegloss's access to
   `tab-mcp.ractive.ch` when needed), Sitegloss reads that site's pairing page when an AI
   app opens it in your browser: which app asks to connect, as the page names it, and
   the relay's id of that request. Only after you say yes in Sitegloss does it type its
   pairing code into that page's field and click Connect. It reads nothing else there,
   and the code goes only into that field. "Stop filling in the code" turns it off and
   gives the site back. If version 0.3.0 had that site from its "Allow on that site",
   the first start of version 0.3.1 or later gives it back once (unless Sitegloss may
   run on all sites); turning the feature on asks for it again.

   In Firefox, the browser first asks, at the click that turns AI access on, for its own
   data collection consent for website content and browsing activity. Without it AI
   access does not start, and it ends when you take the consent back in Firefox's add-on
   settings. Nothing is required at install.

4. **A team at sitegloss.dev.** If you sign in ("Sign in" in the side panel's Account
   section), Sitegloss sends your cases to the service at `app.sitegloss.dev`, run by
   Sitegloss's developer, and fetches your team's: titles, links, summaries, the
   addresses, titles and languages of the pages, the window size and the browser's user
   agent, the marks with their comments, statuses, notes, element details (an arrow's
   two ends too; for the marked element also how it looked: its computed styles, the
   colour behind it and its neighbours' boxes) and AI findings, the case's thread of
   comments and whether it is closed, and the screenshots, crops and images added to
   marks. The members of the
   team you choose can see and change them, in the extension and on the website; the
   service keeps them until they are deleted, with who made or changed what, and under
   [its own privacy policy](https://sitegloss.dev/privacy/).

   When a connected AI app changes a case through Sitegloss (a comment, a mark, a
   status, a finding, the summary, closing), Sitegloss also sends the app's name, the
   address it gave for itself and its host (for example "Claude", `claude.ai`), so that
   your team sees "Dana via Claude". What you do by hand is sent without one.

   The address of every page you marked in a case is part of that: the site, the path
   and a hash route (`#/cart`), and with each screenshot its query (`?…`) as kept above.
   Your team sees these addresses, and so does an AI app connected to the service; a
   public share link of a case does not show the query. A case can cross to other
   sites, so this includes the path of a payment provider's page or of a link someone
   was sent (a password reset, an invitation), and some sites put a token or a
   session's name in the path.
   Look at a case's list of pages before you share it; a mark you delete takes its
   page off the list when it was the page's last.

   Cases that were in your browser before you signed in are sent only when you say so
   ("Sync them"); "Keep them on this device" leaves them where they are. Cases you make
   while signed in go to the team once they have a mark. Deleting a case that the team
   has deletes it for the team. "Sign out" stops this: the cases stay in your browser,
   the team keeps its copies, and the tokens are deleted.

   You sign in on the service's own page, in a window of the browser: Sitegloss never
   sees your password. Under "Server" you can choose another server than the service
   (its development server, or an address you type) before you sign in; all of this
   then goes to that server instead, the Account section says which, and what synced
   with one server is not sent to another unless you share that case there.

   While you are signed in and the side panel is open, the panel keeps a connection to
   the server open, over which the server says when your team changed something. The
   server can therefore tell when your panel is open. With the panel closed, Sitegloss
   asks the server every few minutes instead. A case you kept on this device is not
   sent because the server, or a teammate, has a case with the same id; Sitegloss tells
   you, and "Share with team" is what joins the two: marks only you have are then sent,
   and where both have the same mark with other words the team's are kept, which
   Sitegloss says before you click, with the number of marks. A case is deleted for
   the team only when you delete it while it syncs; what you delete while signed out,
   the team keeps, and it comes back to you at the next sign-in.

   In Firefox, the browser asks at "Sign in" for the same data collection consent as for
   an AI app (website content and browsing activity); taking it back signs you out.

Sitegloss itself sends nothing else. It does not sell data, use it for advertising or
for anything but marking pages and reviewing the marks, or use it to determine
creditworthiness.

## Limits

- A screenshot shows what was on the screen, form fields included. Password fields are
  always blurred, all form fields only with "Blur form fields in screenshots", and
  fields inside embedded frames (a payment form, for example) never.
- An image you add to a mark shows whatever you captured, other windows or apps too.
  Check its preview before you add it.
- Sitegloss does not record what is typed into form fields and editable regions. An
  editor that draws its text as ordinary page content counts as page text, unless
  Sitegloss recognises it.
- The page's own scripts can see what Sitegloss shows in the page and the keys you
  press there, such as a comment while you type it.

## Permissions

- **activeTab:** to run on the tab where you click the Sitegloss icon, until that tab
  navigates elsewhere.
- **scripting:** to add its toolbar and outlines to that tab.
- **sidePanel:** for its side panel (Chrome and Edge; Firefox has a sidebar instead).
- **storage:** session storage, forgotten when the browser closes: what Undo can take
  back, and whether AI access is on.
- **alarms:** so the AI app's connection comes back after the computer slept, and, if
  you are signed in to sitegloss.dev, to look for your team's changes every few minutes.
- **identity:** for the browser's own sign-in window when you sign in to sitegloss.dev.
  Sitegloss does not read your browser's or your Google account's identity with it.
- **notifications:** to ask whether the AI app may make a change when the side panel
  is not in front.
- **unlimitedStorage:** so the browser does not delete your cases to free disk space.
- **offscreen:** to make the files for the sync to Downloads (Chrome and Edge; Firefox's
  background page makes them itself).
- **Downloads (optional):** to save exports and synced files. It does not read, change
  or open your other downloads.
- **Single sites (optional):** asked when you open a case's page, so Sitegloss may run
  on that site.
- **All sites (optional):** so Sitegloss works on a tab without clicking its icon
  first.

## Deleting

Delete a case in the side panel; its screenshots and added images go with it, and a
mark's added images go with the mark. Remove image deletes one image. Removing the extension
deletes everything it stored in the browser. Files it wrote (exports, synced files)
stay until you delete them. A case your team has at sitegloss.dev is deleted there too
when you delete it while signed in; what is at the service otherwise stays until it is
deleted there. So that a deleted case can be told from one the browser lost, the id of
a deleted case and the time stay in the browser until the delete has reached the team,
at most 30 days.

## Contact

Jean-Pierre Bergamin, <https://ractive.ch>, james@ractive.ch.
Source code: <https://github.com/ractive/sitegloss>.

Last changed: 22 November 2026.
