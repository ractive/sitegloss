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
timestamp: 2026-11-17T12:00:00+01:00
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

## For version 0.4.0 (DEC-049 to DEC-070)

- **No new permission, and the data collection declaration is unchanged** (nothing
  required; website content and browsing activity optional). The text a user selects with
  the Highlight tool is website content; it goes to the team with the mark, after the
  same consent at "Sign in", like a mark's recorded look in 0.3.1. `strict_min_version`
  stays 153.0.
- **New in the manifest:** `web_accessible_resources` with `field/*` for `<all_urls>`
  (DEC-064): the comment field of the page's dialogs, an extension page in a frame, so
  that the page cannot read what is typed. Firefox gives each install an address of its
  own, so there is no `use_dynamic_url` here. Say so in the notes for the reviewers.
- **Notes to the reviewers,** add: the bundled library `tldts` 7.5.5 (MIT) with the
  public suffix list as data, no network (it is in `LICENSES.txt`; the source archive
  builds it from `bun.lock`); the client library 0.23.0 with its WebMCP mirror off
  (`webmcp: false`); new extension pages `viewer/` and `field/`; the buttons that copy a
  link, instructions or an id write to the clipboard in the click, with no permission.
  The Highlight tool was not driven by hand in Firefox, and only a Chromium test covers it (DEC-066): try it in a Firefox
  build before submitting.
- **Listing and privacy policy:** as in the Chrome Web Store runbook (the new
  `PRIVACY.md`, changed 23 November 2026).

# Citations

- [Extension Workshop: Source code submission](https://extensionworkshop.com/documentation/publish/source-code-submission/)
- [AMO's API v5, versions and uploads](https://mozilla.github.io/addons-server/topics/api/addons.html)
