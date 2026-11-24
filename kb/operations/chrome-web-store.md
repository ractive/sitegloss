---
type: operations
title: "Publishing in the Chrome Web Store"
description: >-
  The store listing for Sitegloss: texts, category, single purpose, permission
  justifications, data disclosures, and the steps to submit it unlisted and to take
  over the store's key afterwards.
tags:
  - operations
  - release
timestamp: 2026-11-24T03:00:00+01:00
---

# Publishing in the Chrome Web Store

## Steps

1. A Chrome Web Store developer account (one-time US$5, two-step verification, the
   trader declaration). Which account is an open question
   ([open questions](../open-questions.md)).
2. Publish [PRIVACY.md](https://github.com/ractive/sitegloss/blob/main/PRIVACY.md) at a
   stable URL: it is the page `https://ractive.ch/sitegloss/privacy/`, kept in
   `ractive/ractive.ch` (`src/pages/sitegloss/privacy/`); a change of `PRIVACY.md` goes
   there too.
3. Build the store package: `bun scripts/build.ts --store --zip --outdir dist-store`
   writes `sitegloss-<version>-store.zip` (no `key` in the manifest; the store would
   reject it). Without `--outdir` it would replace `dist/`, the unpacked development
   build, with a keyless one: Chrome would give that a new ID, and its cases and relay
   origin would seem gone. A release attaches the same zip (`release.yml`).
4. New item → upload the zip → fill in the listing below → visibility **Unlisted** →
   submit for review.
5. After the first upload: Package → "View public key". Put that key into
   `manifest-key.txt`, so unpacked builds get the store's ID. Update the README, the
   design note and the tests with the new ID, and every relay's `TAB_MCP_SITES` entry,
   including the hosted relay's `TAB_MCP_ALLOWED_ORIGINS` in ractive/ractive.ch
   (`infra/tab-mcp/variables.tf`). Done on 2026-11-16 for the store item `ldmcfigcnobhnbaigehcaodheklibeon`
   (DEC-031). Edge Add-ons gives the
   extension a different ID again.

## Where the packages come from

- **Every CI run** (each push to a PR or to main) attaches two artifacts to its run
  page: `sitegloss-unpacked` (the zip for "Load unpacked", with the fixed key) and
  `sitegloss-store` (the store package, without it).
- **A release:** bump `version` in `package.json` in a PR, merge it, run
  `bun run test:server` against the server's `bun scripts/serve-local.ts 3200 --demo`
  (the tests against a real server, which no workflow runs), then
  `git tag vX.Y.Z <merge commit> && git push origin vX.Y.Z`. The release workflow
  first runs the full end-to-end sets, Chromium's and Firefox's (`e2e.yml`, DEC-053):
  if one fails, nothing is built, released or published. Then it checks the tag, runs
  `verify`, and creates the GitHub release with both zips. It stops if the tag has
  moved off the commit it built.
- **Attestations:** the release workflow attests both zips before it creates the
  release (build provenance, signed through Sigstore): that this workflow built a file
  with that digest from that commit. Check a downloaded zip with
  `gh attestation verify sitegloss-X.Y.Z.zip --repo ractive/sitegloss`. The publish job
  verifies it, so the step always runs; GitHub has attestations for private
  repositories only on Enterprise Cloud, so a private repository could not release.

Every build, and so every zip, holds `LICENSES.txt`: Sitegloss's licence and those of the
packages in its bundles. A bundled package whose licence the build does not know stops
the build (`LICENCES` in `scripts/build.ts`).

## Updates through the publish workflow

The API only updates an item that exists, so the first version went in by hand (steps
above). Since then a release publishes itself (DEC-032): after the release workflow has
created the release, its job `publish` runs
[chrome-extension-publish.yml](https://github.com/ractive/release-workflows/blob/v0.6.0/.github/workflows/chrome-extension-publish.yml)
of ractive/release-workflows (pinned to a commit) in the environment `chrome-web-store`,
which waits for the owner's approval. That job:

1. checks that it runs on the release's tag and downloads the release's store zip;
2. checks that its manifest has the tag's version, no key, no host access and the zip no
   source maps;
3. verifies the zip's build provenance (attested by `release.yml` for that tag; an
   unattested zip stops the run, so the attestation is the record of what the store got);
4. packs it as a CRX3 signed with `CWS_CRX_PRIVATE_KEY` (Verified CRX uploads, below), whose
   CRX id must be `fhagiknobniheomfcadmfdpanogmpmka`; the CRX wraps exactly the verified
   zip's bytes;
5. uploads the CRX with the Chrome Web Store API v2 and submits it for review; it is
   published when approved. The store rejects a version that is not higher than the last.

No third-party code runs in that job: the CRX is packed by Python of the standard library
and `openssl` (byte for byte what `chrome --pack-extension` writes, which release-workflows'
selftest checks against Chrome), the API is called with `curl`. The client secret and the
refresh token can publish every item of the developer account; the signing key can sign
uploads of this item only. Both callers pass `secrets: inherit`: a reusable workflow sees
an environment's secrets only when the caller passes them on, even though its own job runs
in that environment, and a caller outside the environment cannot name them one by one. The
repository has no secrets of its own, so only the environment's reach the job (tab-mcp's
first publish failed for the lack of it, before the upload; a dry run reads no secrets).

If the publish fails or is rejected, fix the cause and run "Publish to the stores"
(`publish.yml`) by hand: Actions → Publish to the stores → Run workflow, pick the
release's tag under "Use workflow from" (the default, `main`, fails) and store `chrome`.
"Submit" off leaves the upload as a draft in the dashboard.

### Verified CRX uploads

The item accepts only uploads signed with our key (dashboard → Package → "Verified CRX
uploads"), so whoever gets into the Google account cannot push an update without it. The
key is an RSA key of its own (not the item's key, which Google holds):
`~/.config/chrome-web-store/sitegloss-crx-key.pem` on the owner's machine, a copy in the
owner's password manager, and the environment secret `CWS_CRX_PRIVATE_KEY`. It is never
stored in the Google account. Losing it means a week with Chrome Web Store support. Its
public key and CRX id:

```sh
openssl rsa -in sitegloss-crx-key.pem -pubout                     # pasted into the dashboard
openssl pkey -in sitegloss-crx-key.pem -pubout -outform DER | shasum -a 256 | head -c 32 | tr 0-9a-f a-p
```

### One-time setup

1. In a Google Cloud project, enable the **Chrome Web Store API**. Configure the OAuth
   consent screen (External) and set its publishing status to **In production**: while
   it is "Testing", Google expires refresh tokens after seven days. An unverified app is
   fine for this personal use.
2. Create an OAuth client ID (type "Web application", with
   `https://developers.google.com/oauthplayground` as redirect URI).
3. In the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground), under
   the settings, use your own client ID and secret; authorize the scope
   `https://www.googleapis.com/auth/chromewebstore` with the store's developer account
   and exchange the code for a refresh token. One client and token serve every item of
   the account (tab-mcp for Chrome uses the same).
4. In the repository: Settings → Environments → new environment `chrome-web-store`.
   Secrets `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`,
   `CWS_CRX_PRIVATE_KEY` (the PEM of the signing key); variable `CWS_PUBLISHER_ID`
   (Publisher → Settings in the developer dashboard). Add yourself as required reviewer,
   and limit deployments to tags `v*` (the reason a run starts from the tag, not from
   `main`).
5. Opt in to Verified CRX uploads (Package tab) with the key's public key, after the
   secret is set: from then on the store refuses a zip.

## Microsoft Edge Add-ons

The same release goes to its Edge Add-ons item (DEC-033): `release.yml`'s job
`publish-edge` runs beside `publish`, after the release, and calls
[edge-extension-publish.yml](https://github.com/ractive/release-workflows/blob/v0.7.0/.github/workflows/edge-extension-publish.yml)
of ractive/release-workflows (pinned to a commit) in the environment `edge-add-ons`
(required reviewer, tags `v*` only). It runs the same checks of the tag, the manifest and
the zip's build provenance, then uploads the zip itself (Edge takes no CRX and has no
signed uploads) through the Edge Add-ons API v1.1 and submits it for certification with
the notes in the workflow. On failure the log shows Microsoft's error code and message.

- **Item:** Product ID `5c87cd72-07f3-427a-a433-edcd7c08eff4` (the workflows'
  `product-id`), CRX id `odheabckckkaclenpbbdkpkjjfmbnalo`. Edge's store signs with its own
  key, so the id differs from the Chrome Web Store's, and the hosted relay allows
  `chrome-extension://odheabckckkaclenpbbdkpkjjfmbnalo` separately. 0.2.0 went in by hand
  (the API updates items, it cannot create one).
- **Credentials:** Partner Center → Microsoft Edge → Publish API: the Client ID and an API
  key, as the environment secrets `EDGE_CLIENT_ID` and `EDGE_API_KEY` of `edge-add-ons`; both
  workflows pass `secrets: inherit`. The key works for every item of the account (tab-mcp's
  workflows use the same). **API keys expire** (the date is on that page): before then
  "Create API credentials" makes a new key, and the secret takes it. An expired key fails
  the upload at once with HTTP 401.
- **One submission at a time:** while a version is in certification, a new submission is
  refused with `InProgressSubmission`; the upload to the draft has gone through. Run it
  again by hand once certification is over.
- **By hand:** Actions → "Publish to the stores" → Run workflow, the release's tag under
  "Use workflow from", store `edge` (or `all`). "Submit" off leaves the package in the
  item's draft in Partner Center.

## Listing

- **Name:** Sitegloss
- **Store icon:** `assets/store/icon-128.png`, 128 × 128 with 16 px of transparent
  padding (DEC-029). `bun scripts/icons.ts` draws it.
- **Summary:** the store takes it from the manifest's `description`, which
  `createManifest` in `scripts/build.ts` sets: "Mark what is wrong on a web page, open
  the marks in another environment to fix it, and talk them through with your AI app."
  (at most 132 characters). Change it there; the store reads it from the uploaded
  package, so a new summary needs a new version. The repository's About text on GitHub
  is a fourth copy (`gh repo edit ractive/sitegloss --description "…"`).
- **Category:** Developer Tools
- **Language:** English
- **Official URL:** `ractive.ch`. The dashboard offers only sites verified in Search
  Console by the Google account of the store's developer account; `ractive.ch` is
  verified in the owner's.
- **Homepage URL:** `https://ractive.ch/sitegloss/`, beside tab-mcp's page.
- **Support URL:** `https://github.com/ractive/sitegloss/issues`.
- **Privacy policy:** `https://ractive.ch/sitegloss/privacy/` (step 2).

**Description** (as of 0.4.0; the store's field, pasted whole):

> Mark what is wrong on a web page, and take the marks to where it gets fixed.
>
> Pick an element, draw a box, an arrow or a freehand line, highlight a piece of text,
> or drop a note, and write a comment. Every mark is saved to a case right away, with a
> screenshot and the details of the element you marked. Paste or drop your own pictures
> onto a mark if the screenshot is not enough.
>
> Then hand the case over. A developer opens it on the same page in their own
> environment, such as localhost or a test system. Sitegloss finds each marked element
> again and outlines it: solid when it is sure, dashed when it is a likely match. The
> screenshots stay as the record, so every mark still makes sense when the page has
> changed. The developer sets each mark fixed; you verify it, or reopen it with a note.
>
> Working in a team? Sign in to sitegloss.dev and your cases sync with your team, both
> ways and live, in the extension and on the web. Assign a case to whoever fixes it: "My
> cases" shows the cases where it is your turn, and each case says what comes next. A
> case has a thread of comments and is closed once everything is settled. Without an
> account everything stays in your browser.
>
> Connect your AI app. With an app such as Claude connected both to your browser and to
> Sitegloss, it reads your marks and comments, finds the marked elements on the page in
> front of you, inspects their HTML and CSS, and works out what should change. Sitegloss
> connects through a tab-mcp relay, and anything the app wants to change in a case is
> shown to you first, unless you chose to always allow it.
>
> Export a case, or all of them, as a zip with a Markdown summary and the images, or keep
> every case synced to your Downloads or a folder of your choice.
>
> Sitegloss runs on a tab when you click its icon there, or on every tab once you allow
> it on all sites (recommended). Your cases stay in your browser unless you export them,
> sync them, connect an AI app or sign in to sitegloss.dev. Sitegloss works inside the
> page, so that page's own scripts can see what it draws there, but not what you type
> into a mark's comment.

**Single purpose:** Marking web pages and reviewing the marks on the same pages in other
environments, alone, with the user's team, or with an AI app the user connects.

**Permission justifications** (as of 0.4.0; the rows for `identity`, `alarms`, `storage`
and `<all_urls>` differ from what 0.2.0 was submitted with):

| Permission | Justification |
|---|---|
| `activeTab` | Add the toolbar for marks to the tab where the user clicked the icon, read the marked elements' details, and take screenshots of that tab. |
| `alarms` | While the user has the AI app connected, wake the background service worker once a minute, so the connection comes back after the computer slept; and, while the user is signed in to sitegloss.dev, look for the team's changes every five minutes when the side panel is closed. |
| `identity` | When the user clicks Sign in, open the browser's own sign-in window (`identity.launchWebAuthFlow`) on the user's Sitegloss account at app.sitegloss.dev (OAuth 2.1 with PKCE). It is not used to read the browser's or the Google account's identity. |
| `notifications` | When the connected AI app wants to change something (add a mark, record the summary for the developer, change a mark's status, assign a case, add, change or delete one of its findings on a mark, add, change or delete a comment, close or reopen a case, delete a case) and the side panel is not open in front, ask the user in a notification with Allow and Always allow; closing it is Don't allow. Where the call's arguments do not fit in a notification, it offers only Don't allow and says to answer in the side panel, which shows them all (its question has Don't allow, Allow and Always allow). A tool runs without a question only after the user chose Always allow for that tool, or turned on "Allow all changes", for that AI app, until the app's pairing ends (the user disconnects it, or the relay lets it expire; a tool always allowed one by one also asks again once an update changes what it says it does); otherwise nothing changes without the user's answer. |
| `offscreen` | The sync to Downloads, which the user turns on with "Sync to Downloads": the background service worker cannot make a URL for a case's file (no `URL.createObjectURL`), so while it writes the cases it opens an offscreen document (reason `BLOBS`) that builds one case's export file and makes its blob URL, which the worker downloads; the document closes when the cases are written. |
| `scripting` | Inject the toolbar and outlines into that tab; and, only with "Fill in the code for me" on, the script that reads the relay's pairing page and types the pairing code after the user said yes. |
| `sidePanel` | The side panel lists cases, loads them onto the tab, and shows the AI app's connection and its questions. |
| `storage` | Session storage, cleared when the browser closes: which marks the toolbar on which tab just added, so its Undo can take back those marks and no others; whether AI access is on; which mark's pictures the page's dialog asked the side panel to show; and which window shows the picture viewer. Local storage: where the user dragged the toolbar on the page (two numbers) and the height of the picture viewer's window frame. No page content in either. (The AI connection's settings and the secret by which the relay knows this installation are in the extension's own IndexedDB, used by its service worker only.) |
| `unlimitedStorage` | Cases and their screenshots exist only in the browser's IndexedDB. This keeps the browser from evicting them when disk space runs low, and lets a user keep more than the default quota. |
| `downloads` (optional) | Asked for when the user clicks Export (or Export all cases) or "Sync to Downloads" in the side panel. Sitegloss saves its own export file through `chrome.downloads.download` and reads that one download's path (`downloads.search` by its id), to show the user where the file went with Copy and "Show in folder" (`downloads.show`). With the sync to Downloads it writes each case as its own file to `Sitegloss/` in the downloads folder, overwriting that case's file when the case changes, and erases its own previous entry from the download list (`downloads.erase`, the file stays). It reads no other download. Without it the export is saved as a plain download, without the path, and the sync can only go to a folder the user chooses. |
| `<all_urls>` (optional) | Nothing at install. All sites only when the user asks for it in the side panel: "Allow on all sites" in the offer at the top of Home ("Let Sitegloss work on every tab (recommended)", with "Not now", shown until the user answers), the same button in the notice on a tab Sitegloss has no access to ("Sitegloss has no access to this tab yet, so …", "Allow on all sites (recommended)"), or the option "Allow on all sites (highly recommended)" under Options on Home. With it, Sitegloss works on a tab without the icon's click first, so an open case's marks are drawn wherever the user goes. One site at a time: asked when the user opens a case's page in a new tab (the case's address in its header, or "Open the case's page"), so the case's marks are drawn there without clicking the icon. One site by itself: `https://tab-mcp.ractive.ch/*`, the hosted relay, asked when the user turns on "Fill in the code for me" under the pairing code (off by default, also with all sites; "Stop filling in the code" gives the site back). With it on, when an AI app opens the relay's pairing page for Sitegloss in this browser, Sitegloss reads that page's form (which AI app asks, and the relay's id of the request), asks the user in the side panel, and only on a yes types its pairing code into the form's field and clicks Connect. |

**Remote code:** No. All code is in the package; the connection to the relay carries
data only, and no tool runs code an AI app sends. The same holds for sitegloss.dev: the
extension exchanges data with its API and runs nothing it sends.

**Data usage (Privacy practices tab)**, as of 0.4.0:

- Collected:
  - **Personally identifiable information:** only for a user who signs in to
    sitegloss.dev: their name and e-mail address, and the names of their team's members
    (to assign a case), received from the service and shown in the side panel.
  - **Authentication information:** only for a user who signs in: the OAuth tokens of the
    user's own Sitegloss account, kept in the extension's IndexedDB.
  - **Web history:** the address, title and time of each page a case is started on or a
    mark is made on, and the address and title of the tab in front when an AI app asks
    for them.
  - **Website content:** screenshots, page text excerpts and element details (the exact
    fields are defined in `src/lib/`); for the marked element, how it looked (a fixed list
    of computed CSS properties, the colour behind it, the boxes of up to six neighbours);
    for a mark made with the Highlight tool, the selected text (at most 500 characters),
    up to 32 characters before and after it and the boxes of its lines; when the AI app
    asks about a mark, also the marked element's (or an element around or inside it)
    trimmed HTML, computed styles and matching CSS rules from the page in front, sent to
    the AI app and not stored, without form field values, text typed into editable
    regions, hidden elements or the page's head, and with addresses cut to their path.
  - **User activity:** limited to the marks the user draws, their comments, statuses,
    the case's thread and to whom a case is assigned.
- Stored locally in the browser. Transmitted only (1) to the relay (by default the hosted
  relay tab-mcp.ractive.ch, run by the developer; the user can enter another) and the AI
  app the user pairs, and only while connected; (2) for a user who signs in, to
  app.sitegloss.dev, the developer's service, where the cases are stored for the user's
  team (or to another server the user enters). Every screenshot blurs password fields, and
  all form fields when the user turns that on, except fields inside embedded frames. Text
  typed into form fields and editable regions is not recorded; of the editors that draw
  their text as ordinary page content, only Monaco, CodeMirror 5 and Ace are recognised.
- Not sold, not used for anything but the extension's purpose, not used to determine
  creditworthiness.

**Screenshots for the listing (1280×800):** the toolbar with marks on a page; the side
panel with a case; a case loaded in another environment with its marks outlined, solid
and dashed. For 0.4.0 they are retaken in the new look (DEC-077) as
`~/Downloads/sitegloss-store-screenshots/chrome/1-mark.png` to `4-ai-finding.png`
(1280 × 800; four, one more than before: the AI app's question and its finding; the
same pictures as Firefox's at half the size).

## For version 0.4.0, to enter by hand before it is published

Written at `main` 363d126 (24 November 2026). Pull requests 75 (marks clipped by
scrolling panes, DEC-075), 79, 80 and 81 are on `main` and included. **Not** assumed, still
open when this was written:
- [sitegloss#83](https://github.com/ractive/sitegloss/pull/83), icons on the panel's
  buttons. It waits for the owner's eye. If it merges before the tag, add to the reviewer
  notes: the side panel's icons are paths copied from heroicons 2.2.0 (MIT), with that
  licence in `LICENSES.txt` (its only change to `scripts/build.ts`).
- The pull request `hand-back`, being built: Verify only for marks of the page in front;
  "This page" telling a returning tester what waits; a new order of the copied AI text. Not
  included. If it merges before the tag, check whether the description's verify sentence
  and the clipboard note still hold.

Neither touches the manifest, `PRIVACY.md` or what leaves the browser as far as known; if
one does when it merges, this section is behind. It replaces the earlier notes for the team sync, for 0.3.1 and for 0.4.0 (written
at 7040dc6), which are in the history of this file.

**What the dashboards hold now.** The Chrome Web Store and Edge Add-ons have 0.2.0
(checked on 24 November: the store page says 0.2.0, "Updated November 16, 2026", 5 users;
Edge's product details say 0.2.0, 0 installs). 0.3.0 reached the Chrome dashboard only as
a draft (publish run 44732714157 with Submit off) and 0.3.1's publish jobs failed, so the
listing texts in both dashboards are most likely still 0.2.0's. Check that in the
dashboard first: everything below is the full text to paste, not a change to 0.3.1's.

1. **Visibility.** The Chrome item was submitted **Unlisted** (step 4 above,
   iteration 5). For a public launch it has to be **Public** (Distribution tab). Not
   checked from here whether it still is unlisted: an unlisted item's page loads for
   anyone with the link, as this one does.
2. **Permissions and manifest: nothing that holds the update for users to approve.**
   The update goes from 0.2.0 to 0.4.0, so it carries 0.3.0's and 0.4.0's changes
   together. `git diff v0.2.0..main -- scripts/build.ts` and the built manifests
   (`bun scripts/build.ts --store`, `--firefox --store`):
   - **New since 0.2.0: `identity`** (0.3.0, team sync). No install warning
     (`test/e2e/shipped.test.ts` asks Chrome itself), so the update is not held back.
     Justification in the table above.
   - **`web_accessible_resources`** (new in 0.4.0, DEC-064): `field/*` for `<all_urls>`,
     with `use_dynamic_url: true` in Chrome and Edge. It is the comment field of the
     dialogs Sitegloss draws on the marked page, an extension page in a frame, so the
     page's own scripts cannot read what the user types. The address changes with every
     browser session, so a site cannot probe the fixed address of Sitegloss's store id to
     find out it is installed. The page does nothing without the port the content script
     hands it. No permission warning.
   - **`minimum_chrome_version` 116 → 130** (Chrome and Edge): 130 is the first with
     `use_dynamic_url`. Users of an older Chrome or Edge are not offered the update and
     stay on 0.2.0; nobody is prompted.
   - **Unchanged since 0.2.0:** `activeTab`, `alarms`, `notifications`, `offscreen`,
     `scripting`, `sidePanel`, `storage`, `unlimitedStorage`; optional `downloads` and
     `<all_urls>`; the command Alt+Shift+O; no `content_scripts`, no `host_permissions`,
     no `content_security_policy` (Chrome), no key in the store package.
   - **New files in the package, not manifest entries:** `pairing.js` (the relay's
     pairing page, injected through `scripting` only with "Fill in the code for me" on,
     DEC-044, DEC-049), the pages `field/` and `viewer/`, and `fonts/`. The store zip is
     481,592 bytes (built at b57f01a; 0.3.1's was 227,144).
3. **Description, single purpose, permission justifications, data usage:** paste the
   four blocks above whole. What is new in them since 0.2.0, for the reviewer's eye:
   the team (sign-in, sync, assign, My cases, thread, closing), the Highlight tool,
   pictures on a mark, all-sites access offered in the panel, verify and reopen; in the
   data usage, personally identifiable and authentication information and the second
   destination, app.sitegloss.dev.
4. **Notes for the reviewer** (Chrome: the Test instructions tab, if the dashboard offers
   one, otherwise only when asked; Edge: Notes for certification, sent by `release.yml`'s
   `publish-edge` job, whose text this pull request brings up to date):
   - **How to try it:** open any web page, click the Sitegloss icon (under the puzzle
     piece until pinned) or press Alt+Shift+O: the side panel opens. "New case for this
     page" shows the toolbar on the page (Element, Box, Arrow, Pen, Highlight, Note).
     Everything but the team works without an account. The team features need a free
     account at app.sitegloss.dev/sign-up with a confirmed e-mail address (free during the
     beta), then "Sign in" in the Team section on the panel's Home. If the dashboard asks
     for test credentials, give a test account made for the reviewer; do not invent one
     in the notes.
   - **All sites is optional and asked in the click.** The panel's first view offers it
     ("Let Sitegloss work on every tab (recommended)", Allow on all sites, Not now);
     Options on Home has "Allow on all sites (highly recommended)". Under the option the
     panel says what it means: "With it, Sitegloss can read the page in front whenever you
     use it and, while AI access is on, whenever a connected AI app asks (a screenshot, an
     element's details), on any site. It sends nothing anywhere by itself." Without it the
     extension works on a tab after the icon's click (`activeTab`).
   - **What an AI app can read with all sites allowed:** while AI access is on, its read
     tools (the address and title of the tab in front, a screenshot, an element's details,
     the HTML and CSS of a mark's element) act on whatever tab is in front without a
     question, on any site, as they do without all sites on a tab where the icon was
     clicked. Every change to a case is asked first, unless the user chose Always allow
     (for that tool) or Allow all changes (for that AI app). `PRIVACY.md`, "All sites".
   - **Bundled libraries:** `@ractive-ch/tab-mcp-client` 0.24.0 (MIT, the relay's client;
     data only; its WebMCP mirror is switched off with `webmcp: false`, DEC-068/074, so
     nothing is registered with the browser's WebMCP and no code is loaded with
     `import()`); `tldts` 7.5.5 with `tldts-core` (MIT): the public suffix list as data
     inside the package, to group a case's pages by site, in the side panel and the worker
     only, never fetched or updated from the network. Every bundled package's licence is in
     `LICENSES.txt`; the build stops on one it does not know.
   - **Fonts:** `fonts/inter-latin-wght-normal.woff2` (48,256 bytes) and
     `fonts/manrope-latin-wght-normal.woff2` (24,836 bytes), the web app's typefaces, the
     variable Latin files of @fontsource-variable 5.3.0, SIL OFL 1.1 (both licences in
     `LICENSES.txt`). Data, not code; loaded only by the side panel and the picture viewer,
     never from the network and never into a web page.
   - **Extension pages:** `sidepanel/`, `viewer/` (a mark's pictures at their size in a
     small window of the extension's own), `field/` (the comment field in a frame on the
     marked page; see `web_accessible_resources`), `offscreen/` (the sync to Downloads).
     All load only files from the package.
   - **Clipboard:** "Copy link", "Copy for your AI app", the case id's copy button and a
     folder's Copy write with `navigator.clipboard.writeText` in the click; no
     `clipboardWrite` permission. The clipboard is read only when the user pastes a
     picture into the side panel. The AI app text is built in the package
     (`src/lib/agent-instructions.ts`) and names the case's id, address and contents.
   - **The team's members:** after sign-in Sitegloss asks the service for the team's
     members (id and name, at most every ten minutes) and keeps the list in its IndexedDB,
     so "Assign" works offline; signing out forgets it.
   - **Network destinations:** app.sitegloss.dev (only after Sign in; the user can choose
     another server address before signing in; release builds do not offer the developer's
     development server, DEC-041), the relay (only with AI access on; tab-mcp.ractive.ch by
     default). Nothing else; no analytics.
   - **Remote code:** none (above).
5. **Privacy policy:** the page at `ractive.ch/sitegloss/privacy/` has to equal
   `PRIVACY.md` of the tagged commit before submission. On 24 November it was the text of
   22 November (`ractive/ractive.ch`, `src/pages/sitegloss/privacy/index.vto`, "Last
   changed: 22 November 2026"): it lacks pictures on a mark, the Highlight text, the
   clipboard, the comment field's frame, the AI app under all sites, the team's members
   and assignments, and the other changes of this pull request.
6. **Screenshots:** replace the three in the dashboard with the four retaken ones (above).
7. **Edge Add-ons: sign-in is refused today.** The Edge store's build has the id
   `odheabckckkaclenpbbdkpkjjfmbnalo`, so its sign-in window ends on
   `https://odheabckckkaclenpbbdkpkjjfmbnalo.chromiumapp.org/`. Production does not accept
   that address: on 24 November `GET /api/auth/oauth2/authorize` with it answered
   `invalid_redirect` (the Chrome and Firefox addresses pass). **A precondition of the
   tag**, checked before it is pushed: `publish-edge` submits right after the owner's
   approval, and the certification notes invite the certifier to sign in. Add it to
   `EXTENSION_REDIRECT_URIS` of production (and dev) and restart the app
   (sitegloss.dev's `kb/runbooks/go-live.md`, step 5.2: `put EXTENSION_REDIRECT_URIS
   '<the two>,https://odheabckckkaclenpbbdkpkjjfmbnalo.chromiumapp.org/'`). Check: the same
   request answers with a redirect to `/sign-in?…`. Without it an Edge user of the store
   build, or Microsoft's certifier, sees an error at Sign in; everything without an
   account works.
8. **The service:** production runs sitegloss.dev 7e06b47, which has the highlight
   (sitegloss.dev DEC-040) and the hand-over (its DEC-042, the members endpoint) that
   0.4.0 relies on. Nothing to promote first.

# Citations

- [Chrome Web Store program policies](https://developer.chrome.com/docs/webstore/program-policies)
- [Storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies):
  `unlimitedStorage` "exempts extensions from both quota restrictions and eviction".
- [Permissions list](https://developer.chrome.com/docs/extensions/reference/permissions-list):
  `unlimitedStorage` and `alarms` show no warning, `notifications` shows "Display
  notifications". `test/e2e/shipped.test.ts` asks Chrome itself.
