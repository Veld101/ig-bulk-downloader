          return t(this, void 0, void 0, function* () {
            console.log("[IGDL] bulk: click handler start", location.href);

            // 1) account name: semantic resolution first (IG hashed classes rotate), URL last
            let e = getProfileUsername().name || "";
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
            yield progress.updateProgress({ completed: 0, total: 0, isFirst: !0, isLast: !1, account, type: "download" });

            let newFiles = 0, existing = 0, processed = 0, videosSkipped = 0, failed = 0;
            const failedItems = [];
            const isVideoItem = (it) => /\.mp4(\?|$)/i.test(it.url || "");
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const withTimeout = (p, ms) =>
              Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
            // retry transient failures (network hiccups, VPN node switches)
            const MAX_TRIES = 6;
            const withRetry = async (label, fn, tries = MAX_TRIES) => {
              let last;
              for (let i = 0; i < tries; i++) {
                try { return await fn(); }
                catch (err) {
                  last = err;
                  console.warn("[IGDL] retry", i + 1, "/", tries, label, err && err.message);
                  if (i < tries - 1) await sleep(Math.min(1000 * Math.pow(2, i + 1), 30000));
                }
              }
              throw last;
            };

            // (E) A file only counts as "already downloaded" when it looks like a complete
            // image. A half-written file from a killed run also has size > 0, and Pe() happily
            // stores an HTML/JSON error page as a "jpg", so size alone is not trustworthy.
            const MIN_IMAGE_BYTES = 4096;
            const looksComplete = async (f) => {
              if (!f || f.size < MIN_IMAGE_BYTES) return false;
              try {
                const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
                // JPEG FFD8FF, PNG 89504E47, GIF 47494638, WEBP(Riff) 52494646
                if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return true;
                if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return true;
                if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) return true;
                if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46) return true;
                return false;
              } catch (_) {
                return false;
              }
            };

            // download a single resolved media item into <dir>/<username>/ (images only)
            const downloadItem = async (it) => {
              const name = Me(it);
              try {
                const fh = await dirUser.getFileHandle(name, { create: !0 });
                const f = await fh.getFile();
                if (await looksComplete(f)) { existing += 1; return !0; }
                const blob = await withRetry("fetch " + name, () => Pe(it.url));
                // guard: an error response (429/403/require_login) must not be saved as an image.
                // Pe() rebuilds the Response without headers, so blob.type is always "" here --
                // sniff the magic bytes instead of trusting the MIME type.
                if (!blob || !(await looksComplete(blob))) {
                  console.warn("[IGDL] suspicious payload, not an image", name, blob && blob.size);
                  return !1;
                }
                const w = await fh.createWritable();
                await w.write(blob);
                await w.close();
                newFiles += 1;
                return !0;
              } catch (err) {
                console.error("[IGDL] bulk save gave up", name, err);
                return !1;
              }
            };

            let hdrs = Xe.getHeaders();
            for (let w = 0; w < 30 && !(hdrs && hdrs.wwwClaim); w++) { yield sleep(500); hdrs = Xe.getHeaders(); }
            if (!hdrs || !hdrs.wwwClaim) hdrs = { appId: "936619743392459", wwwClaim: sessionStorage.getItem("www-claim-v2") || "" };
            console.log("[IGDL] wwwClaim len:", hdrs.wwwClaim ? hdrs.wwwClaim.length : 0);

            // (D) expected post count, used for reconciliation at the end
            let expectedPosts = 0;
            try {
              const acct = yield withTimeout(Ze.getAccount(e, hdrs.appId, hdrs.wwwClaim), 15000);
              if (acct && acct.totalPosts) {
                expectedPosts = acct.totalPosts;
                account.totalPosts = expectedPosts;
                if (!account.profilePicUrl && acct.profilePicUrl) account.profilePicUrl = acct.profilePicUrl;
              }
            } catch (err) {
              console.warn("[IGDL] could not read profile totalPosts", err);
            }
            console.log("[IGDL] expected posts:", expectedPosts);

            // Every post we actually touched, keyed by post id, so the fallback can diff
            // against what the feed already covered instead of re-resolving everything.
            const seenPostIds = new Set();
            const notePost = (id) => { id && seenPostIds.add(String(id)); };

            // 3) PRIMARY: background cursor pagination via the feed API (no scrolling).
            //    appendToItems(username, appId, wwwClaim, maxId, itemsOut) pushes this page's
            //    media items into `itemsOut` and returns [nextMaxId, pageCount] (nextMaxId undefined at the end).
            const items = [];
            let maxId, page = 0;
            let truncated = false, failStreak = 0;
            while (true) {
              const before = items.length;
              let res;
              try {
                res = yield withRetry("feed page " + page, () => withTimeout(Ze.appendToItems(e, hdrs.appId, hdrs.wwwClaim, maxId, items), 20000));
                failStreak = 0;
              } catch (err) {
                // (A) never stop silently: retry the same cursor first, and only give up on
                //     this route after several consecutive failures -- flagged as truncated
                //     so the fallback below still runs.
                console.warn("[IGDL] feed page failed", page, err);
                failStreak += 1;
                if (failStreak < 3) { yield sleep(3000); continue; }
                truncated = true;
                break;
              }
              const added = items.length - before;
              console.log("[IGDL] feed page", page, "added", added, "total", items.length, "next", res && res[0]);
              for (let k = before; k < items.length; k++) {
                const it = items[k];
                notePost(it.postId || it.id);
                if (isVideoItem(it)) { videosSkipped += 1; continue; }
                const ok = yield downloadItem(it);
                processed += 1;
                if (!ok) failedItems.push(it);
                progress.updateProgress({
                  completed: processed, total: Math.max(items.length, processed),
                  isFirst: !1, isLast: !1, account, type: "download",
                });
              }
              page += 1;
              maxId = res && res[0];
              if (maxId === undefined) break;
              if (page > 300) { truncated = true; break; }
              yield sleep(1000);
            }

            // (B) FALLBACK: also run when pagination was cut short, not only when the feed
            //     returned nothing -- otherwise a single failed page silently ends the crawl.
            //     Enumerate the grid by scrolling and diff against posts the feed already covered.
            if (0 === items.length || truncated) {
              console.warn("[IGDL] fallback grid scan, reason:", 0 === items.length ? "feed empty" : "pagination truncated");
              const ids = new Set();
              const resolved = new Set(seenPostIds);
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
              // (C) carousel posts must be expanded through the media API when the timeline
              //     payload only exposed the first frame.
              const expandMedia = (item) => {
                if (!item) return null;
                const list = Je.getAllDownloadableMediaItems(item) || [];
                const isCarousel = 8 === item.media_type || (item.carousel_media_count || 0) > 1;
                if (isCarousel && list.length <= 1) {
                  console.warn("[IGDL] carousel not expanded by timeline payload", item.id, "count", item.carousel_media_count);
                  return null; // caller falls through to the detail fetch
                }
                return list;
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
                      if (item) media = expandMedia(item);
                    }
                    if (!media) {
                      const post = yield withTimeout(Ve.loadPostFromId(id), 8000);
                      if (post) {
                        const list = Ve.getAllDownloadableMediaItems(post) || [];
                        const isCarousel = 8 === post.media_type || (post.edge_sidecar_to_children && post.edge_sidecar_to_children.edges.length > 1);
                        if (isCarousel && list.length <= 1) {
                          console.warn("[IGDL] carousel not expanded by post payload", id);
                        }
                        media = list;
                      }
                    }
                    if (media) {
                      for (const it of media) {
                        notePost(it.postId || it.id);
                        if (isVideoItem(it)) { videosSkipped += 1; continue; }
                        const ok = yield downloadItem(it);
                        processed += 1;
                        if (!ok) failedItems.push(it);
                      }
                    }
                  } catch (err) {
                    console.warn("[IGDL] bulk resolve failed", id, err);
                  }
                  progress.updateProgress({
                    completed: processed, total: Math.max(ids.size, processed),
                    isFirst: !1, isLast: !1, account, type: "download",
                  });
                }
                scrollGrid();
                yield sleep(1200);
                collect();
                if (ids.size === lastCount) stable += 1;
                else { stable = 0; lastCount = ids.size; }
              }
              try { window.scrollTo(0, 0); } catch (_) {}
              if (0 === items.length) items.length = 0;
            }

            // 5) drain: retry every file that failed, several rounds with a longer wait between rounds
            if (failedItems.length) {
              console.log("[IGDL] draining", failedItems.length, "failed downloads...");
              for (let round = 0; round < 4 && failedItems.length; round++) {
                const again = failedItems.splice(0, failedItems.length);
                for (const it of again) {
                  const ok = yield downloadItem(it);
                  if (!ok) failedItems.push(it);
                }
                if (failedItems.length) {
                  console.log("[IGDL] drain round", round + 1, "left", failedItems.length, "- waiting 15s");
                  yield sleep(15000);
                }
              }
            }
            failed = failedItems.length;

            // (D) reconciliation: tell the user how much of the account was actually covered
            const coveredPosts = seenPostIds.size;
            const shortfall = expectedPosts > 0 ? Math.max(0, expectedPosts - coveredPosts) : 0;
            const complete = 0 === failed && 0 === shortfall && !truncated;
            console.log("[IGDL] bulk done. expectedPosts=", expectedPosts, "coveredPosts=", coveredPosts,
              "shortfall=", shortfall, "new=", newFiles, "existing=", existing,
              "videosSkipped=", videosSkipped, "failed=", failed, "truncated=", truncated);
            progress.updateProgress({
              completed: processed, total: Math.max(items.length, processed),
              isFirst: !1, isLast: !0, account, type: "download",
            });

            const d = { imageURL: [], accountName: e || "unknown", type: m.bulk, source: h.Account };
            try { yield o.runtime.sendMessage(d); } catch (err) { console.warn("[IGDL] runtime send failed (context invalidated?)", err); }

            let summary =
              `Account downloaded into "${a.name}/${account.username}". ` +
              `${newFiles.toLocaleString()} new images were downloaded, ${existing.toLocaleString()} already existed, ` +
              `${videosSkipped.toLocaleString()} videos were skipped, ${failed.toLocaleString()} failed.`;
            if (expectedPosts > 0) summary += ` Coverage: ${coveredPosts}/${expectedPosts} posts.`;
            if (!complete) {
              summary +=
                `\n\nINCOMPLETE` +
                (truncated ? " (pagination was cut short by repeated API failures)" : "") +
                (shortfall > 0 ? ` (${shortfall} posts not covered)` : "") +
                (failed > 0 ? ` (${failed} files failed)` : "") +
                `. Run Download All again on this profile: files already saved are skipped automatically.`;
            }
            yield s.createAndAddForDownloadComplete(summary, account);
          });
