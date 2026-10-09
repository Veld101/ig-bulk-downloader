# IG Bulk Downloader

A **local / offline** Chrome extension (Manifest V3) that fixes the broken
"Download All" button of
[Turbo Downloader for Instagram](https://chrome.google.com/webstore/detail/cpgaheeihidjmolbakklolchdplenjai) (v4.12.16).

> This is a **fork / fix**, not the official project.

## The bug

Clicking **Download All** on a profile always shows:

```
Could not find account. Are you signed in?
```

even while logged in. **Single-post downloads keep working.**

### Root cause

The original bulk download depends *hard* on Instagram's private `x-ig-www-claim`
token and has **no fallback**:

- `getAccount()` → `GET /api/v1/users/web_profile_info/`
- `appendToItems()` → `GET /api/v1/feed/user/<id>/username/`

After an Instagram frontend change, the injected script (`js/inject.js`) can no
longer read the token:

```js
sessionStorage.setItem("__ig_www_claim",
    window.require("PolarisWWWClaim").getWWWClaim()); // now throws / empty
```

So `getHeaders()` returns empty and `downloadContent()` bails out immediately.
Single-post downloads still work because they have a DOM/Relay fallback
(`Ve.loadPostFromId`).

### The fix

The bulk path is rewritten:

1. **Background cursor pagination** via the feed API
   (`/api/v1/feed/user/<username>/username/?count=12&max_id=<cursor>`), so the
   page does **not** scroll. Each page is downloaded as soon as it arrives.
2. **Fallback**: if the feed API returns nothing, enumerate the grid by scrolling
   (supporting modern username-prefixed hrefs `/<user>/p/<shortcode>/`) and
   resolve each post via the per-media API (`/api/v1/media/<id>/info/`).
3. Save into the chosen folder (`<dir>/<username>/`). **Images only — videos are
   skipped.**

Only one method — `downloadContent()` — is changed. The patcher additionally
disables telemetry (see below) and stops the injected script from reading
Instagram's internal `PolarisWWWClaim` / `PolarisConfig` modules (they fail to
resolve and spam the console); it mirrors the session token Instagram already
stores (`www-claim-v2`) instead.

## Layout

```
ig-bulk-downloader/
├─ extension/                     Load this as an "unpacked extension"
│  ├─ manifest.json               MV3; `key` / `update_url` removed → own extension ID
│  ├─ js/extension.js             patched (bulk download rewritten)
│  ├─ js/extension.js.orig        pre-patch backup (rollback)
│  ├─ js/inject.js                injected script (unchanged)
│  └─ ...
├─ patch/
│  ├─ new-bulk-method.js          the new downloadContent() body
│  └─ apply.mjs                   marker-based patcher (backup + replace)
├─ LICENSE                        LGPL-3.0
└─ README.md
```

## Install (offline / local use)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked** → select the `extension` folder
4. Open Instagram and refresh the page

> Because `key` was removed, this build gets its **own extension ID** and can
> coexist with the store version without overwriting it. You may want to disable
> the store version in `chrome://extensions` to avoid duplicate buttons.

## Usage

- **Single post / carousel / Story**: unchanged.
- **Whole profile**: open a user's profile → click **Download All** in the header
  → on first run pick a save folder (File System Access API) → the extension
  pages the profile, resolves each post and downloads **images** into
  `selected-folder/<username>/`. **Videos are skipped.**

## Re-apply the patch from scratch

```powershell
cd ig-bulk-downloader
node patch/apply.mjs          # backs up to extension/js/extension.js.orig first
node --check extension/js/extension.js
```

## Known limitations

- Bulk uses the feed API for cursor pagination (with a grid-scrolling fallback),
  so it may need adjustment when Instagram changes their endpoints.
- Downloads are sequential; large profiles are slow. Throttling is in place
  (~1 s per feed page). Avoid heavy runs on huge accounts to prevent temporary
  rate limiting.
- Only images are downloaded; videos are skipped by design.
- A logged-in session is required.

## Privacy note

This build **disables the upstream Sentry telemetry**: the SDK's DSN is emptied
(`dsn:""`), so no events are ever sent to `ingest.sentry.io`. The extension then
only talks to Instagram. `node patch/apply.mjs` re-enforces this on every run.

## License & credits

- Based on / derived from the open-source **InstagramDownloader** by HuiiBuh,
  licensed **LGPL-3.0**: <https://github.com/igdownloader/InstagramDownloader>
- The fixed target is the closed-source **Turbo Downloader for Instagram
  4.12.16** (obtained by beautifying the shipped bundle; no public source).
- Therefore this project is released under **LGPL-3.0**, see `LICENSE`. If you
  redistribute it, keep the same license and provide the corresponding source.
