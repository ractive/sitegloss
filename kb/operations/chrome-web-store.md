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
timestamp: 2026-11-05T08:00:00+01:00
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

**Description:**

> Mark what is wrong on a web page, and take the marks to where it gets fixed.
>
> Pick an element, draw a box, an arrow or a freehand line, or drop a note, and write a
> comment. Every mark is saved to a case right away, with a screenshot and the details
> of the element you marked.
>
> Then hand the case over. A developer opens it on the same page in their own
> environment, such as localhost or a test system. Sitegloss finds each marked element
> again and outlines it: solid when it is sure, dashed when it is a likely match. The
> screenshots stay as the record, so every mark still makes sense when the page has
> changed.
>
> For the full experience, connect your AI app. With an app such as Claude connected
> both to your browser and to Sitegloss, it looks at the live page and at your marks
> together: it reads your comments, finds the marked elements on the page in front of
> you, inspects their HTML and CSS, and works out what should change. Sitegloss connects
> through a tab-mcp relay, and anything the app wants to change in a case is shown to
> you first, unless you chose to always allow it.
>
> Export a case, or all of them, as a zip with a Markdown summary and the images, or
> keep every case synced to your Downloads or a folder of your choice, in iCloud Drive
> or Dropbox for example.
>
> Your cases stay in your browser unless you export them, sync them or connect an AI
> app. Sitegloss works inside the page, so that page's own scripts can see what it shows
> there and the keys you press there.

**Single purpose:** Marking web pages and reviewing the marks on the same pages
in other environments, alone or with an AI app the user connects.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `activeTab` | Add the toolbar for marks to the tab where the user clicked the icon, read the marked elements' details, and take screenshots of that tab. |
| `alarms` | While the user has the AI app connected, wake the background service worker once a minute, so the connection comes back after the computer slept. |
| `notifications` | When the connected AI app wants to change something (add a mark, record the summary for the developer, change a mark's status, add, change or delete one of its findings on a mark, add, change or delete a comment, close or reopen a case, delete a case) and the side panel is not open in front, ask the user in a notification with Allow and Always allow; closing it is Don't allow. Where the call's arguments do not fit in a notification, it offers only Don't allow and says to answer in the side panel, which shows them all (its question has Don't allow, Allow and Always allow). A tool runs without a question only after the user chose Always allow for that tool, or turned on "Allow all changes", for that AI app, until the app's pairing ends (the user disconnects it, or the relay lets it expire; a tool always allowed one by one also asks again once an update changes what it says it does); otherwise nothing changes without the user's answer. |
| `offscreen` | The sync to Downloads, which the user turns on with "Sync to Downloads": the background service worker cannot make a URL for a case's file (no `URL.createObjectURL`), so while it writes the cases it opens an offscreen document (reason `BLOBS`) that builds one case's export file and makes its blob URL, which the worker downloads; the document closes when the cases are written. |
| `scripting` | Inject the toolbar and outlines into that tab. |
| `sidePanel` | The side panel lists cases, loads them onto the tab, and shows the AI app's connection and its questions. |
| `storage` | Session storage, cleared when the browser closes: which marks the toolbar on which tab just added, so its Undo can take back those marks and no others, and whether AI access is on. (The AI connection's settings and the secret by which the relay knows this installation are in the extension's own IndexedDB, used by its service worker only.) |
| `unlimitedStorage` | Cases and their screenshots exist only in the browser's IndexedDB. This keeps the browser from evicting them when disk space runs low, and lets a user keep more than the default quota. |
| `downloads` (optional) | Asked for when the user clicks Export (or Export all cases) or "Sync to Downloads" in the side panel. Sitegloss saves its own export file through `chrome.downloads.download` and reads that one download's path (`downloads.search` by its id), to show the user where the file went with Copy and "Show in folder" (`downloads.show`). With the sync to Downloads it writes each case as its own file to `Sitegloss/` in the downloads folder, overwriting that case's file when the case changes, and erases its own previous entry from the download list (`downloads.erase`, the file stays). It reads no other download. Without it the export is saved as a plain download, without the path, and the sync can only go to a folder the user chooses. |
| `<all_urls>` (optional) | Asked for one site at a time when the user opens a case's page in a new tab (the case's address in its header, or "Open the case's page" when none of its marks were found on the tab in front), so the case's marks are drawn there without clicking the icon. All sites only when the user clicks "Allow on all sites" (in the side panel's notice on a tab Sitegloss may not run on yet) or turns on the option "Allow on all sites, without clicking the icon on each tab". One site by itself: `https://tab-mcp.ractive.ch/*`, the hosted relay, asked when the user turns on "Fill in the code for me" under the pairing code (off by default, also with all sites; "Stop filling in the code" gives the site back). With it on, when an AI app opens the relay's pairing page for Sitegloss in this browser, Sitegloss reads that page's form (which AI app asks, and the relay's id of the request), asks the user in the side panel, and only on a yes types its pairing code into the form's field and clicks Connect. |

**For the version with team sync (DEC-039), to enter by hand before it is published:**

- **New permission `identity`:** it has no install warning, so the update is not held
  back for users to approve. Justification: "When the user clicks Sign in, open the
  browser's own sign-in window (`identity.launchWebAuthFlow`) on the user's Sitegloss
  account at app.sitegloss.dev (OAuth 2.1 with PKCE). It is not used to read the
  browser's or the Google account's identity."
- **`alarms`,** add: "and, while the user is signed in to sitegloss.dev, look for the
  team's changes every five minutes when the side panel is closed."
- **Description,** a paragraph after the one on export and the folder sync: "Working in
  a team? Sign in to sitegloss.dev and your cases sync with your team, both ways and
  live: everyone sees the same marks, statuses and findings, in the extension and on the
  web. Without an account everything stays in your browser." And the last paragraph's
  first sentence becomes: "Your cases stay in your browser unless you export them, sync
  them, connect an AI app or sign in to sitegloss.dev."
- **Single purpose:** add "and sharing them with the user's team".
- **Data usage:** under *Collected*, add **Personally identifiable information** (the
  signed-in user's name and e-mail address, received from the service and shown in the
  side panel) and **Authentication information** (the OAuth tokens of the user's own
  Sitegloss account, kept in the extension's IndexedDB). Under *Transmitted*, add: "and,
  only for a user who signs in, to app.sitegloss.dev, the developer's service, where the
  cases are stored for the user's team". Web history, website content and user activity
  now also go there for such a user.
- **Privacy policy:** the page at `ractive.ch/sitegloss/privacy/` has to be the new
  `PRIVACY.md` before the version is submitted.
- **Edge Add-ons:** the same texts.
- **The service's side:** the store version's redirect address is that of the store's
  key, `https://ldmcfigcnobhnbaigehcaodheklibeon.chromiumapp.org/` (the same as unpacked
  builds, DEC-031), and Firefox's is in `firefox-add-ons.md`; both have to be in the
  server's `EXTENSION_REDIRECT_URIS`. An Edge Add-ons build gets another id from that
  store, and so another address (`https://<its id>.chromiumapp.org/`), to add there once
  it is known.

**For version 0.3.1 (DEC-045 to DEC-048), to enter by hand before it is published:**

- **No new permission.** `git diff v0.3.0..origin/main -- scripts/build.ts` is empty:
  the manifests ask for what 0.3.0's did. Nothing to justify anew, and the update is not
  held back for users to approve.
- **Description,** add to the paragraph on working in a team: "Cases have a thread of
  comments, on the case or on one mark, and a case can be closed once everything is
  settled; the team sees who did what, and through which AI app."
- **Notes for the reviewer (Edge: Notes for certification):** a case has a thread of
  comments and can be closed; they sync with the team, like the marks. When a connected
  AI app changes a case (a comment, a status, closing), Sitegloss sends the app's name
  and host with it, so that the team sees "person via app"; a change made by hand is
  sent without one. Filling in the pairing code on the relay's page is a setting of its
  own, off by default ("Fill in the code for me" under the code; "Stop filling in the
  code" turns it off and gives the relay's site back). With it on, the panel asks for
  each request, naming the host the relay verified; a yes fills in that one request, in
  that tab, and nothing else. A browser updated from 0.3.0 starts with it off.
- **Data usage:** the categories stay as they are. Under *Collected*, *Website content*,
  add that for the marked element itself Sitegloss records, once when the mark is made,
  how it looked (a fixed list of computed CSS properties, the colour behind it, and the
  size and position of up to six neighbours, their tag only; no address, no custom
  property), that this is stored in the browser, and that for a user who signed in it goes
  to their team with the mark. *User activity* now also holds the comments. For a signed-in
  user, the names of the AI apps that changed something go to the team too.
- **Privacy policy:** the page at `ractive.ch/sitegloss/privacy/` has to be the current
  `PRIVACY.md` (changed 21 November 2026) before the version is submitted.

**For version 0.4.0 (DEC-049 to DEC-070), to enter by hand before it is published:**

- **Before anything: the hosted service must run the highlight first.** The service in
  production has to be a version that knows a mark's `highlight` (service DEC-040,
  [sitegloss.dev#48](https://github.com/ractive/sitegloss.dev/pull/48)) BEFORE 0.4.0
  reaches users. The extension sends a highlight with the `mark.create` only
  (`src/lib/cloud/wire.ts:379`). A server that does not know the field stores a plain box:
  the team's copy has no text, and a teammate (browser or web app) sees a box. The
  maker's own copy is not damaged: when the server's answer has no `highlight`, a mark
  that has one here keeps it, since it is taken from the server only for a mark without
  one (`wire.ts:1802-1807`, on `ended.highlight === undefined`; a mark new here from the
  server: `wire.ts:1841`, `highlightIn`, which gives none for an absent field). It is
  never sent again (`mark.patch` has no `highlight`; test `cloud-wire.test.ts:790`), so
  the server stays without it for good: a highlight made before the service is updated
  is a box for the team for ever, unless the mark is deleted and made again. Whether a
  server of the older build refuses the unknown field instead of dropping it was not
  checked from here (the API's schema is not strict, so it most likely drops it).
- **No new permission.** `git diff v0.3.1..origin/main -- scripts/build.ts`: the
  `permissions` (`activeTab`, `alarms`, `identity`, `notifications`, `offscreen`,
  `scripting`, `sidePanel`, `storage`, `unlimitedStorage`), `optional_permissions`
  (`downloads`), `optional_host_permissions` (`<all_urls>`), `commands`, the absence of
  `content_scripts` and `host_permissions`, the absence of a `content_security_policy`
  and the key are all as in 0.3.1, for Chrome and Edge and for Firefox. Nothing to
  justify anew, and no new permission warning: the update is not held back for users to
  approve. The new pairing script (`pairing.js`, DEC-044) is a file in the package that
  the existing `scripting` permission injects, not a manifest entry.
- **Two changes of the manifest that are not permissions:**
  1. **`web_accessible_resources`** (new, DEC-064): `field/*` for `<all_urls>`. It is the
     comment field of the dialogs Sitegloss draws on the marked page, an extension page
     in a frame, so that the page's own scripts cannot read what the user types. In
     Chrome and Edge with `use_dynamic_url: true`: the page's address changes with every
     browser session, so a site cannot try the fixed address of Sitegloss's store id to
     find out that it is installed. The page does nothing without the port the content
     script hands it. If the dashboard asks (Edge: Notes for certification), say this.
  2. **`minimum_chrome_version` 116 to 130** (Chrome and Edge): 130 is the first that has
     `use_dynamic_url`. Users of an older Chrome or Edge are not offered the update and
     stay on 0.3.1; it is not a prompt to anyone.
  - Firefox: the same `web_accessible_resources` without `use_dynamic_url` (Firefox gives
    each install an address of its own). `strict_min_version` stays 153.0, and the data
    collection declaration stays as it was.
- **Description,** add (short, one paragraph before the one on exporting):
  "Select text on the page with the Highlight tool and write a note on it; Sitegloss
  finds the text again on the fixed page. A case that spans pages is grouped by site.
  The open case says what comes next: send it to whoever fixes it (copy its link, or the
  instructions for your AI app), verify the fixes, close it. Verify opens the next mark
  that waits to be checked, the case's id can be copied from the top bar, and Escape
  takes back a mark whose note is still empty. A glow on the AI button shows when your AI
  app is talking. Pictures of a mark open at their size in a window of their own."
  (The panel's other changes, DEC-058 to DEC-065, are changes of look and of what a
  mark's images do; the images (DEC-058) were not in the 0.3.1 listing either: add "Add
  pictures to a mark: paste, choose or drop; they are re-encoded, so their metadata is
  gone" if the listing does not have it.)
- **Notes for the reviewer (Edge: Notes for certification):**
  - New bundled library `tldts` 7.5.5 (MIT, with `tldts-core`; in `LICENSES.txt`) with the
    public suffix list as data inside the package: it groups a case's pages by site
    (`app.dev.sitegloss.dev` is `sitegloss.dev`). No network: the list is not fetched and
    is not updated; a new list needs a new version. It is in the side panel and the
    background worker only, not in the script that runs in web pages (a build test
    checks it).
  - The client library for the relay, `@ractive-ch/tab-mcp-client`, 0.18.1 to 0.23.0. It
    is data only, as before: its new WebMCP mirror (on by default there) is switched off
    here (`webmcp: false`, DEC-068), so nothing is registered with the browser's WebMCP,
    and no code is loaded with `import()`.
  - Remote code: still none. The hosted service and the relay send data only.
  - New pages of the extension: `viewer/` (a mark's pictures at their size, in a tab of
    its own) and `field/` (the comment field, in a frame on the marked page; see the
    `web_accessible_resources` above). Both are in the package and load nothing from
    outside.
  - The Highlight tool selects text through the layer Sitegloss draws on the page; the
    page's own scripts can see the selection change, as with any selection. Text in form
    fields and editors is never taken.
  - The hand-over buttons ("Copy link", "Copy for your AI app", copy the case's id) write
    to the clipboard in the click, with no `clipboardWrite` permission and nothing read.
    The instructions text is built into the package.
  - Two font files in `fonts/` (DEC-077): `inter-latin-wght-normal.woff2` (48,256 bytes)
    and `manrope-latin-wght-normal.woff2` (24,836 bytes), the web app's typefaces. Data,
    not code: copied unchanged from `src/fonts/`, which holds the variable Latin files of
    `@fontsource-variable/inter` and `@fontsource-variable/manrope` 5.3.0; SIL Open Font
    License 1.1, both licence texts in `LICENSES.txt`. Only the side panel and the picture
    viewer load them; nothing is fetched from the network and no font goes into a web
    page. The package grows by about 85 KB unpacked (the store zip from about 400 KB to
    about 476 KB).
- **The listing's screenshots show the old look** (DEC-077: cream, the forest green, the
  web app's type). The three uploaded to the dashboard (the toolbar with marks on a page;
  the side panel with a case; a case loaded in another environment) need retaking before
  0.4.0 is published; so do Firefox's (see the Firefox runbook).
- **Data usage:** the categories stay as they are. Under *Collected*, *Website content*,
  add the text the user selects with the Highlight tool (at most 500 characters, up to 32
  characters of the page's text before and after it, and the boxes of its lines); it is
  stored in the browser and, for a user who signed in, goes to their team with the mark
  (and to the AI app that reads the case). Text typed into fields and editors is never
  taken. Nothing else leaves the browser for the first time: the site grouping is
  computed in the browser and stored nowhere; what is copied to the clipboard (a link,
  the AI app instructions, a case's id) goes nowhere by itself.
- **Privacy policy:** `PRIVACY.md` is changed in this version's pull request (the
  Highlight text goes to the team; what Copy writes to the clipboard; changed 23 November
  2026). The page at `ractive.ch/sitegloss/privacy/` has to be that `PRIVACY.md` before
  the version is submitted.

**Remote code:** No. All code is in the package; the connection to the relay carries
data only, and no tool runs code an AI app sends. The same holds for sitegloss.dev: the
extension exchanges data with its API and runs nothing it sends.

**Data usage (Privacy practices tab):**

- Collected:
  - **Web history:** the address, title and time of each page a case is started on, and the
    address and title of the tab in front when an AI app asks for them.
  - **Website content:** screenshots, page text excerpts and element details (the
    exact fields are defined in `src/lib/`); when the AI app asks about a mark, also the marked
    element's (or an element around or inside it) trimmed HTML, computed styles and
    matching CSS rules from the page in front, sent to the AI app and not stored,
    without form field values, text typed into editable regions, hidden elements or
    the page's head, and with addresses cut to their path.
  - **User activity:** limited to the marks the user draws and their comments.
- Stored locally in the browser. Transmitted only to the relay (by default the hosted
  relay tab-mcp.ractive.ch, run by the developer; the user can enter another) and the
  AI app the user pairs, and only while connected. Every screenshot blurs password
  fields, and all form fields when the user turns that on, except fields inside
  embedded frames. Text typed into form fields and editable regions is not recorded; of
  the editors that draw their text as ordinary page content, only Monaco, CodeMirror 5
  and Ace are recognised.
- Not sold, not used for anything but the extension's purpose, not used to determine
  creditworthiness.

**Screenshots for the listing (1280×800):** the toolbar with marks on a page; the side
panel with a case; a case loaded in another environment with its marks outlined, solid
and dashed.

# Citations

- [Chrome Web Store program policies](https://developer.chrome.com/docs/webstore/program-policies)
- [Storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies):
  `unlimitedStorage` "exempts extensions from both quota restrictions and eviction".
- [Permissions list](https://developer.chrome.com/docs/extensions/reference/permissions-list):
  `unlimitedStorage` and `alarms` show no warning, `notifications` shows "Display
  notifications". `test/e2e/shipped.test.ts` asks Chrome itself.
