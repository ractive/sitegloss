---
type: operations
title: "Publishing on addons.mozilla.org"
description: >-
  The one-time setup by hand for the Firefox add-on (AMO developer account, the first
  version and the listing, the API key, the GitHub environment firefox-add-ons), what the
  release's job publish-firefox does, how to rerun it, and what to check on its first real run.
tags:
  - operations
  - release
  - firefox
timestamp: 2026-11-24T03:00:00+01:00
---

# Publishing on addons.mozilla.org

Firefox's counterpart to [the Chrome Web Store and Edge runbook](chrome-web-store.md)
(DEC-034, DEC-035). A release uploads itself there once the setup below is done by hand;
the add-on's id is `sitegloss@ractive.ch` (the manifest's `browser_specific_settings.gecko.id`),
desktop Firefox only (153 or later).

## One-time setup

1. **An AMO developer account** at <https://addons.mozilla.org/developers/> (a Mozilla
   account, two-step authentication on).
2. **The first version, by hand.** The workflow adds versions to an add-on that exists; it
   does not create one. At <https://addons.mozilla.org/developers/> choose "Submit your
   first add-on", "On this site" (listed), and upload:
   - the Firefox store zip of a release, `sitegloss-firefox-<version>-store.zip`;
   - when asked whether the code is minified or bundled: yes, and the release's
     `sitegloss-<version>-source.zip`, with the notes from `publish-firefox`'s `notes`
     in `.github/workflows/release.yml` (what the extension does, how to try it, how to
     build it);
   - desktop Firefox only (no Firefox for Android).
3. **The listing:** name Sitegloss; summary and description as for the other stores (the
   summary is the manifest's `description`; the store may take it from the package);
   categories (Developer Tools; the next best if AMO has none of that name); licence MIT
   (the repository's `LICENSE`); privacy policy
   <https://github.com/ractive/sitegloss/blob/main/PRIVACY.md> (the same page as for the
   other stores); notes to the reviewers as above. Say "environment", not "build", for
   another environment of a page.
4. **The API key** at <https://addons.mozilla.org/developers/addon/api/key/>: "Generate new
   credentials" gives a JWT issuer and a JWT secret. The secret is shown once; keep both in
   the password manager.
5. **The GitHub environment `firefox-add-ons`** (repository settings → Environments), as
   for `chrome-web-store` and `edge-add-ons`: a required reviewer (the owner), deployment
   tags `v*` only, and two environment secrets, `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`.
   Nothing in the repository's own secrets.

## What a release does

`release.yml` first runs the full end-to-end sets, the Firefox tests among them
(`e2e.yml`, DEC-053); a red run stops it. Then it builds the Firefox store zip
(`bun scripts/build.ts --firefox --store --zip`)
and `sitegloss-<version>-source.zip` (`git archive` of the built commit), attests every zip
and attaches them to the release. The job `publish-firefox` then waits for the owner's
approval and calls `firefox-extension-publish.yml` of ractive/release-workflows. It checks
the zips' attestations, then uploads the zip as a new listed version of the add-on and
attaches the source archive in the same request. AMO has no draft: the version goes to review
at once. The job ends successfully when AMO already has that version number (a rerun after
an upload that went through). A version number must be higher than the last one AMO has.

The source archive builds the zip again, byte for byte (the zip's entries have a fixed time):
the README's "Building the Firefox package from source" is what the reviewers follow, with
Bun 1.4.4, the version `release.yml` pins.

## By hand

Actions → "Publish to the stores" → Run workflow, the release's tag under "Use workflow
from", store `firefox` (or `all` for Chrome, Edge and Firefox). The "Submit" input does not
apply to Firefox.

## Before the first real run

The job has not run against AMO yet (`firefox-extension-publish.yml` of
ractive/release-workflows v0.8.1, pinned by its commit in both workflow files).
On the first real run, check in AMO's Developer Hub:

- the new version is there with the source archive;
- **the notes to the reviewers arrived with the version.** AMO documents only `source`,
  `upload` and `license` for that multipart request. If the notes are missing, the workflow
  needs a follow-up PATCH, and the notes go in by hand for that version meanwhile;
- the data collection permissions in the version's details (nothing required, website
  content and browsing activity optional) match what the manifest says;
- AMO's validation shows no errors that the local build does not.

## For the version with team sync (DEC-039)

To enter or check by hand before that version is published:

- **Redirect address.** Firefox's sign-in window ends on
  `https://06e95dca9ff68bfd10ed74d5a76de715f9cc9d14.extensions.allizom.org/`: the SHA-1
  of the add-on's id `sitegloss@ractive.ch`, the same for every install
  (`browser.identity.getRedirectURL()`; `test/e2e/firefox/cloud.test.ts` checks it). It
  has to be in the server's `EXTENSION_REDIRECT_URIS`, beside Chrome's.
- **New permission `identity`.** Firefox shows no prompt for it at install or update.
- **Data collection.** The manifest's declaration is unchanged (nothing required;
  website content and browsing activity optional): signing in asks for the same consent
  as turning AI access on, at the click, and taking it back signs the user out. To
  check with AMO's reviewers: whether the tokens of the user's own Sitegloss account,
  and the name and e-mail address the service returns, need `authenticationInfo` and
  `personallyIdentifyingInfo` declared as well. They are received from the developer's
  own service after the user signed in there, and nothing of them goes anywhere else;
  if AMO wants them declared, they join the optional list and the request at "Sign in".
- **Notes to the reviewers,** add: how to try the sync (an account at sitegloss.dev,
  or a test server chosen under "Server" in the Account section), and that
  `src/lib/cloud/api.gen.ts` is generated by `bun scripts/api-types.ts` from
  `src/lib/cloud/openapi-v1.json`, both in the source archive.
- **Listing:** the texts as in the Chrome Web Store runbook, with "sidebar".
- **Privacy policy:** the new `PRIVACY.md`.

## For version 0.3.1 (DEC-045 to DEC-048)

- **No new permission, and the manifest's data collection declaration is unchanged**
  (nothing required; website content and browsing activity optional). What is new falls
  under those: a mark's recorded look (computed styles, the colour behind the element,
  the boxes of up to six neighbours) is website content; comments on a case and the names
  of AI apps (sent to the team beside what they changed) go with the cases the user
  chose to sync, after the same consent at "Sign in".
- **Notes to the reviewers,** add: a case has a thread of comments and can be closed;
  both sync with the team; a change made through a connected AI app is sent with the
  app's name and host, so that the team sees "person via app".
- **Listing and privacy policy:** as in the Chrome Web Store runbook (the new
  `PRIVACY.md`, changed 21 November 2026).

## For version 0.4.0, the first version on AMO

Written at `main` 363d126 (24 November 2026), on the same footing as the Chrome Web Store
runbook's section for 0.4.0. Pull requests 75, 79, 80 and 81 are included. The open
[sitegloss#83](https://github.com/ractive/sitegloss/pull/83) (panel icons) and the
`hand-back` pull request are not. It replaces the earlier notes for 0.4.0 (written at 7040dc6), which are in this
file's history.

- **There is no listing yet.** AMO's public API answers 404 for `sitegloss@ractive.ch`
  (24 November), and 0.3.1's `publish-firefox` failed at once: "AMO_JWT_ISSUER is not set"
  (run 44876841738). The one-time setup above (steps 1 to 5) has not been done, or not to
  the end; whether a draft exists in the Developer Hub cannot be seen from here. So 0.4.0
  is the first version and goes in by hand (step 2, with the release's
  `sitegloss-firefox-0.4.0-store.zip` and `sitegloss-0.4.0-source.zip`). With the
  environment's secrets set before the tag, the release's job uploads it instead; with
  the first version in by hand, the job finds 0.4.0 at AMO and ends successfully.
- **Permissions and manifest.** Against 0.3.1 (nothing on AMO to compare with):
  `web_accessible_resources` with `field/*` for `<all_urls>` (DEC-064), the comment field
  of the page's dialogs, an extension page in a frame, so that the page cannot read what
  is typed; Firefox gives each install an address of its own, so there is no
  `use_dynamic_url` here. Otherwise as in 0.3.1: `activeTab`, `alarms`, `identity`,
  `notifications`, `scripting`, `storage`, `unlimitedStorage`; optional `downloads` and
  `<all_urls>`; `content_security_policy.extension_pages` `script-src 'self'; object-src
  'self'`; `strict_min_version` 153.0; the data collection declaration: nothing required,
  `websiteContent` and `browsingActivity` optional, asked at the click that turns on AI
  access or signs in.
- **Data collection, to check with AMO's reviewers** (as for the team sync, above): the
  tokens of the user's own Sitegloss account, the user's name and e-mail address and,
  new in 0.4.0, the names of the team's members (for Assign) are received from the
  developer's own service after the user signed in there and go nowhere else. If AMO
  wants `authenticationInfo` and `personallyIdentifyingInfo` declared, they join the
  optional list and the request at "Sign in".
- **Listing:** name Sitegloss; summary the manifest's `description`; description the
  Chrome Web Store runbook's, with "sidebar" for "side panel" and "Sitegloss under the
  puzzle piece" for "its icon"; category Developer Tools; licence MIT; support
  `https://github.com/ractive/sitegloss/issues`; homepage as for the other stores. The
  owner's notes outside the repository (`assets/store/firefox/`, untracked) were made for
  0.3.0: their listing and privacy texts are behind.
- **Notes to the reviewers:** `release.yml`'s `publish-firefox` sends them with an upload
  (at most 3000 characters); for a version submitted by hand, paste that text. It says how
  to try it and how to build the zip from the source archive, and now also: the Highlight
  tool; all sites offered in the sidebar and asked in the click; the bundled `tldts` 7.5.5
  (MIT) with the public suffix list as data, no network; the client library 0.24.0 with
  its WebMCP mirror off (`webmcp: false`); the extension pages `viewer/` and `field/`; the
  two font files in `fonts/` (SIL OFL 1.1, loaded only by the sidebar and the viewer);
  copy buttons that write to the clipboard in the click; `src/lib/cloud/api.gen.ts`
  generated by `bun scripts/api-types.ts` from `src/lib/cloud/openapi-v1.json`, both in
  the source archive. The longer list for a reviewer who asks is in the Chrome Web Store
  runbook, step 4 of its 0.4.0 section.
- **What Firefox does differently in 0.4.0** (DEC-076), for a reviewer who tries it: the
  sidebar's first view offers all sites; opening a case's page does not ask for that one
  site (Firefox's prompt could not be answered there); without all sites Firefox drops
  `activeTab` when the tab goes to the next page, and the sidebar says so on that tab.
- **Not tried by hand in Firefox before this release:** the Highlight tool (the same code
  as Chromium's, which a Chromium test covers, DEC-066). Try it in the store build before
  submitting.
- **Screenshots:** `~/Downloads/sitegloss-store-screenshots/firefox/1-mark.png` to
  `4-ai-finding.png` (2560 × 1600, the new look), with the captions in `captions.md`
  there. Caption 1 lists the tools without Highlight; add it if Highlight shows.
- **Privacy policy:** `PRIVACY.md` of the tagged commit; the Chrome Web Store runbook's
  0.4.0 section says what the ractive.ch page lacks today.

# Citations

- [Extension Workshop: Source code submission](https://extensionworkshop.com/documentation/publish/source-code-submission/)
- [AMO's API v5, versions and uploads](https://mozilla.github.io/addons-server/topics/api/addons.html)
