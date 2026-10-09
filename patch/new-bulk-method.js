          return t(this, void 0, void 0, function* () {
            console.log("[IGDL] bulk: click handler start", location.href);
            yield s.createAndAdd("[IGDL] Bulk download started. Scanning the profile...", "default", !0, 4e3);
            // ===== PATCHED: streaming bulk download (page & download together, no x-ig-www-claim) =====
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
            const progress = new Ne();
            const dirUser = yield a.getDirectoryHandle(account.username, { create: !0 });
            console.log("[IGDL] dir ready");
            let newFiles = 0, existing = 0, processed = 0, videosSkipped = 0;
            const isVideoItem = (it) => /\.mp4(\?|$)/i.test(it.url || "");

            // download a single resolved media item into <dir>/<username>/
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
                if ((it.url || "").includes(".mp4?")) await new Promise((r) => setTimeout(r, 400));
              } catch (err) {
                console.error("[IGDL] bulk save failed", name, err);
              }
            };

            // 3) discover posts on the profile grid.
            //    Primary source: post/reel anchors. NOTE modern IG uses a username-prefixed
            //    href like "/<username>/p/<shortcode>/" (and "/<username>/reel/<shortcode>/"),
            //    so match anywhere in the href, relative or absolute, case-insensitive.
            //    Fallback source: [__igdl_id] attributes injected by inject.js from the React fiber.
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
              if (cells.length) {
                try { cells[cells.length - 1].scrollIntoView({ block: "end" }); } catch (_) {}
              }
              try { window.scrollTo(0, (document.scrollingElement || document.body).scrollHeight); } catch (_) {}
            };
            const diagnose = () => {
              const hrefs = [...document.querySelectorAll("[href]")].map((x) => x.getAttribute("href"));
              const pr = hrefs.filter((h) => /\/(?:p|reel|reels|tv)\//i.test(h || ""));
              return [
                "url=" + location.href,
                "href=" + hrefs.length,
                "p/reel=" + pr.length,
                "igdlId=" + document.querySelectorAll("[__igdl_id]").length,
                "img=" + document.querySelectorAll("img").length,
                "main=" + document.querySelectorAll("main").length,
                "sample=" + JSON.stringify(pr.slice(0, 6)),
              ].join(" | ");
            };

            const withTimeout = (p, ms) =>
              Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("resolve timeout")), ms))]);
            const hdrs = Xe.getHeaders() || { appId: "936619743392459", wwwClaim: sessionStorage.getItem("www-claim-v2") || "" };
            console.log("[IGDL] wwwClaim len:", hdrs.wwwClaim ? hdrs.wwwClaim.length : 0);

            // 4) stream: page the grid, and for every newly found post resolve + download it right away.
            //    Only scroll when the current batch has been downloaded (page-on-demand).
            let lastCount = -1, stable = 0;
            for (let i = 0; i < 300 && stable < 5; i++) {
              collect();
              console.log("[IGDL] pass", i, "ids:", ids.size);
              for (const id of [...ids]) {
                if (resolved.has(id)) continue;
                resolved.add(id);
                try {
                  console.log("[IGDL] resolve", id);
                  let media = null;
                  // primary: Instagram per-media API (verified 200) — no Relay needed
                  if (hdrs && hdrs.wwwClaim) {
                    const item = yield withTimeout(Je.fetchMediaItem(id, hdrs.appId, hdrs.wwwClaim), 8000);
                    if (item) media = Je.getAllDownloadableMediaItems(item);
                  }
                  // fallback: the extension Relay resolver
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
              yield new Promise((r) => setTimeout(r, 1200));
              collect();
              if (ids.size === lastCount) stable += 1;
              else { stable = 0; lastCount = ids.size; }
            }
            try { window.scrollTo(0, 0); } catch (_) {}

            console.log("[IGDL] bulk done. ids=", ids.size, "resolved=", resolved.size, "new=", newFiles, "existing=", existing, "videosSkipped=", videosSkipped);
            if (0 === ids.size) {
              const diag = diagnose();
              console.warn("[IGDL] bulk: no posts found.", diag);
              yield s.createAndAdd("No posts found. " + diag, "warn", !0, null);
              return;
            }
            progress.updateProgress({
              completed: processed, total: Math.max(ids.size, processed),
              isFirst: !1, isLast: !0, account, type: "download",
            });

            // 5) reflect the batch in the extension UI, then report completion
            const d = { imageURL: [], accountName: e || "unknown", type: m.bulk, source: h.Account };
            yield o.runtime.sendMessage(d);
            yield s.createAndAddForDownloadComplete(
              `Account downloaded into "${a.name}/${account.username}". ${newFiles.toLocaleString()} new images were downloaded, ${existing.toLocaleString()} already existed, ${videosSkipped.toLocaleString()} videos were skipped.`,
              account,
            );
          });
