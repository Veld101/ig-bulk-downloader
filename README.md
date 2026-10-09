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

The bulk path is rewritten to **not depend on any private token**:

1. Auto-**scroll** the profile page until the whole grid is loaded, collecting
   unique post shortcodes from `a[href^="/p/"], a[href^="/reel/"]`.
2. For each shortcode, call the extension's existing single-post resolver
   `Ve.loadPostFromShortcode()` (Instagram's own Relay, the same mechanism used
   by single-post download).
3. Reuse the original save logic `Oe()` (writes into the chosen folder, progress
   bar, `username_timestamp_mediaId.ext` naming).

Only one method — `downloadContent()` — is changed.

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
  auto-scrolls, resolves and downloads into `selected-folder/<username>/`.

## Re-apply the patch from scratch

```powershell
cd ig-bulk-downloader
node patch/apply.mjs          # backs up to extension/js/extension.js.orig first
node --check extension/js/extension.js
```

## Known limitations

- Bulk resolution relies on Instagram's Relay (`loadPostFromShortcode`), the same
  mechanism as single-post download — it must be adjusted again whenever
  Instagram changes their frontend.
- Resolve + download is sequential; large profiles are slow. Throttling is in
  place (~350 ms between posts, ~1.2 s per scroll step). Avoid heavy runs on huge
  accounts to prevent temporary rate limiting.
- A logged-in session is required.

## Privacy note

The upstream 4.12.16 bundle ships **Sentry telemetry** (reports to
`ingest.sentry.io`, with 1% session-replay sampling). If you want a truly
offline, no-outbound build, that telemetry can be removed/disabled with an extra
patch — ask if you want it.

## License & credits

- Based on / derived from the open-source **InstagramDownloader** by HuiiBuh,
  licensed **LGPL-3.0**: <https://github.com/igdownloader/InstagramDownloader>
- The fixed target is the closed-source **Turbo Downloader for Instagram
  4.12.16** (obtained by beautifying the shipped bundle; no public source).
- Therefore this project is released under **LGPL-3.0**, see `LICENSE`. If you
  redistribute it, keep the same license and provide the corresponding source.
