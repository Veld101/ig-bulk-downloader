          return t(this, void 0, void 0, function* () {
            // ===== PATCHED: bulk download without x-ig-www-claim =====
            // 1) account name from the profile page DOM
            const nameEl = document.querySelector(y.accountName);
            let e = (nameEl && nameEl.innerHTML) || "";
            if (e.includes("<") || e.includes('"')) {
              const m = location.href.match(/\.\w+?\/(.+?)\//);
              m && (e = m[1]);
            }
            e = String(e || location.pathname.split("/").filter(Boolean)[0] || "unknown").trim() || "unknown";

            // 2) choose / verify the output directory (File System Access API)
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

            const account = { username: e, profilePicUrl: "", totalPosts: 0 };
            const items = [];
            const progress = new Ne();

            // 3) scroll the profile to load the whole grid and collect unique post shortcodes
            const shortcodes = new Set();
            const collect = () => {
              document.querySelectorAll('a[href^="/p/"], a[href^="/reel/"]').forEach((el) => {
                const m = (el.getAttribute("href") || "").match(/\/(?:p|reel)\/([^/?#]+)/);
                m && shortcodes.add(m[1]);
              });
            };
            collect();
            let lastCount = -1, stable = 0;
            for (let i = 0; i < 300 && stable < 4; i++) {
              collect();
              try {
                window.scrollTo(0, (document.scrollingElement || document.body).scrollHeight);
              } catch (_) {}
              yield new Promise((r) => setTimeout(r, 1200));
              collect();
              if (shortcodes.size === lastCount) stable += 1;
              else { stable = 0; lastCount = shortcodes.size; }
              progress.updateProgress({
                completed: shortcodes.size, total: shortcodes.size,
                isFirst: i === 0, isLast: !1, account, type: "fetch",
              });
            }
            try { window.scrollTo(0, 0); } catch (_) {}

            const list = [...shortcodes];
            if (0 === list.length) {
              yield s.createAndAdd("No posts were found on this profile. Make sure you are logged in and the profile is loaded.", "warn");
              return;
            }

            // 4) resolve each post WITHOUT the private API, reusing the injected Relay loader
            let done = 0;
            for (const sc of list) {
              try {
                const post = yield Ve.loadPostFromShortcode(sc);
                if (post) Ve.getAllDownloadableMediaItems(post).forEach((it) => items.push(it));
              } catch (err) {
                console.error("IGDL bulk resolve failed for", sc, err);
              }
              done += 1;
              progress.updateProgress({
                completed: done, total: list.length,
                isFirst: done === 1, isLast: done === list.length, account, type: "fetch",
              });
              yield new Promise((r) => setTimeout(r, 350));
            }
            progress.updateProgress({
              completed: done, total: list.length,
              isFirst: !1, isLast: !0, account, type: "fetch",
            });

            if (0 === items.length) {
              yield s.createAndAdd("Could not resolve any media for this profile.", "warn");
              return;
            }

            // 5) show in the UI and download into the selected folder
            const d = {
              imageURL: items.map((it) => it.url),
              accountName: e || "unknown",
              type: m.bulk,
              source: h.Account,
            };
            yield o.runtime.sendMessage(d);
            yield Oe(items, account, void 0, a);
          });
