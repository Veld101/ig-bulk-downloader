          return t(this, void 0, void 0, function* () {
            console.log("[IGDL] bulk: click handler start", location.href);
            yield s.createAndAdd("[IGDL] Bulk download started. Scanning the profile...", "default", !0, 4e3);

            // 1) account name from the profile page DOM
            const nameEl = document.querySelector(y.accountName);
            let e = (nameEl && nameEl.innerText) || "";
            if (!e || e.includes("<") || e.includes('"')) {
              const m = location.href.match(/\.\w+?\/(.+?)\//);
              e = (m && m[1]) || location.pathname.split("/").filter(Boolean)[0] || "unknown";
            }
            e = String(e || "unknown").trim() || "unknown";
            console.log("[IGDL] account:", e);

            // 2) output directory (File System Access API)
            let a;
            try {
              a = yield new We().getDownloadDirectoryHandle();
              if (a instanceof FileSystemDirectoryHandle && a) {
                if ("granted" !== (yield a.requestPermission({ mode: "readwrite" })))
                  throw new Error("Permission not granted");
              } else {
                yield s.createAndAdd(
                  "Please select the folder for all of your IG Downloader account downloads. You can change this later in the extension's options.",
                  "default", !0, 1e4,
                );
                a = yield window.showDirectoryPicker({ id: "__igdl", mode: "readwrite", startIn: "downloads" });
                yield new We().setDownloadDirectoryHandle(a);
              }
            } catch (err) {
              return void (yield s.createAndAdd("Could not get access to the download folder.", "warn", !0, null));
            }
            console.log("[IGDL] directory:", a && a.name);

            const account = { username: e, profilePicUrl: "", totalPosts: 0 };
            try {
              const cands = document.querySelectorAll(y.accountImage + ", header img");
              for (const el of cands) {
                const img = el.tagName === "IMG" ? el : (el.querySelector && el.querySelector("img"));
                const src = img && (img.currentSrc || img.src);
                if (src && 0 !== src.indexOf("data:")) { account.profilePicUrl = src; break; }
              }
            } catch (_) {}
            console.log("[IGDL] avatar:", account.profilePicUrl ? "ok" : "none");
            const progress = new Ne();
            const dirUser = yield a.getDirectoryHandle(account.username, { create: !0 });
            console.log("[IGDL] dir ready");

            let newFiles = 0, existing = 0, processed = 0, videosSkipped = 0;
            const isVideoItem = (it) => /\.mp4(\?|$)/i.test(it.url || "");
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const withTimeout = (p, ms) =>
              Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

            // download a single resolved media item into <dir>/<username>/ (images only)
            const downloadItem = async (it) => {
              const name = Me(it);
              try {
                const fh = await dirUser.getFileHandle(name, { create: !0 });
                const f = await fh.getFile();
                if (f.size > 0) { existing += 1; return; }
                const blob = await Pe(it.url);
                const w = await fh.createWritable();
                await w.write(blob);
                await w.close();
                newFiles += 1;
              } catch (err) {
                console.error("[IGDL] bulk save failed", name, err);
              }
            };

            const hdrs = Xe.getHeaders() || { appId: "936619743392459", wwwClaim: sessionStorage.getItem("www-claim-v2") || "" };
            console.log("[IGDL] wwwClaim len:", hdrs.wwwClaim ? hdrs.wwwClaim.length : 0);

            // 3) PRIMARY: background cursor pagination via the feed API (no scrolling).
            //    appendToItems(username, appId, wwwClaim, maxId, itemsOut) pushes this page's
            //    media items into `itemsOut` and returns [nextMaxId, pageCount] (nextMaxId undefined at the end).
            const items = [];
            let maxId, page = 0;
            while (true) {
              const before = items.length;
              let res;
              try {
                res = yield withTimeout(Ze.appendToItems(e, hdrs.appId, hdrs.wwwClaim, maxId, items), 20000);
              } catch (err) {
                console.warn("[IGDL] feed page failed", page, err);
                break;
              }
              const added = items.length - before;
              console.log("[IGDL] feed page", page, "added", added, "total", items.length, "next", res && res[0]);
              for (let k = before; k < items.length; k++) {
                const it = items[k];
                if (isVideoItem(it)) { videosSkipped += 1; continue; }
                yield downloadItem(it);
                processed += 1;
                progress.updateProgress({
                  completed: processed, total: Math.max(items.length, processed),
                  isFirst: processed === 1, isLast: !1, account, type: "download",
                });
              }
              page += 1;
              maxId = res && res[0];
              if (maxId === undefined) break;
              if (page > 300) break;
              yield sleep(1000);
            }

            // 4) FALLBACK: if the feed API returned nothing, enumerate the grid by scrolling
            //    (modern IG uses username-prefixed hrefs: /<user>/p/<shortcode>/) and resolve
            //    each post through the per-media API.
            if (0 === items.length) {
              console.warn("[IGDL] feed API empty, falling back to grid scrolling");
              const ids = new Set();
              const resolved = new Set();
              const addShortcode = (sc) => {
                if (!sc) return;
                try { const id = Xe.getIdFromShortcode(sc); id && ids.add(String(id)); } catch (_) {}
              };
              const collectLinks = () => {
                document.querySelectorAll("[href]").forEach((el) => {
                  const m = (el.getAttribute("href") || "").match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
                  m && addShortcode(m[1]);
                });
              };
              const collectFiber = () => {
                document.querySelectorAll("[__igdl_id]").forEach((el) => {
                  const id = el.getAttribute("__igdl_id");
                  id && /^\d+$/.test(id) && ids.add(id);
                });
              };
              const collect = () => { collectLinks(); if (0 === ids.size) collectFiber(); };
              const scrollGrid = () => {
                const cells = document.querySelectorAll("main a[href], main img, main [__igdl_id]");
                if (cells.length) { try { cells[cells.length - 1].scrollIntoView({ block: "end" }); } catch (_) {} }
                try { window.scrollTo(0, (document.scrollingElement || document.body).scrollHeight); } catch (_) {}
              };
              let lastCount = -1, stable = 0;
              for (let i = 0; i < 400 && stable < 6; i++) {
                collect();
                for (const id of [...ids]) {
                  if (resolved.has(id)) continue;
                  resolved.add(id);
                  let media = null;
                  try {
                    if (hdrs && hdrs.wwwClaim) {
                      const item = yield withTimeout(Je.fetchMediaItem(id, hdrs.appId, hdrs.wwwClaim), 8000);
                      if (item) media = Je.getAllDownloadableMediaItems(item);
                    }
                    if (!media) {
                      const post = yield withTimeout(Ve.loadPostFromId(id), 8000);
                      if (post) media = Ve.getAllDownloadableMediaItems(post);
                    }
                    if (media) {
                      for (const it of media) {
                        if (isVideoItem(it)) { videosSkipped += 1; continue; }
                        yield downloadItem(it);
                        processed += 1;
                      }
                    }
                  } catch (err) {
                    console.warn("[IGDL] bulk resolve failed", id, err);
                  }
                  progress.updateProgress({
                    completed: processed, total: Math.max(ids.size, processed),
                    isFirst: processed === 1, isLast: !1, account, type: "download",
                  });
                }
                scrollGrid();
                yield sleep(1200);
                collect();
                if (ids.size === lastCount) stable += 1;
                else { stable = 0; lastCount = ids.size; }
              }
              try { window.scrollTo(0, 0); } catch (_) {}
              items.length = 0;
            }

            console.log("[IGDL] bulk done. total=", items.length, "new=", newFiles, "existing=", existing, "videosSkipped=", videosSkipped);
            progress.updateProgress({
              completed: processed, total: Math.max(items.length, processed),
              isFirst: !1, isLast: !0, account, type: "download",
            });

            const d = { imageURL: [], accountName: e || "unknown", type: m.bulk, source: h.Account };
            yield o.runtime.sendMessage(d);
            yield s.createAndAddForDownloadComplete(
              `Account downloaded into "${a.name}/${account.username}". ${newFiles.toLocaleString()} new images were downloaded, ${existing.toLocaleString()} already existed, ${videosSkipped.toLocaleString()} videos were skipped.`,
              account,
            );
          });
