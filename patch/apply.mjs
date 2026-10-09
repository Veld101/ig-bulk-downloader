// Apply the local patches to the unpacked extension:
//   1) rewrite the bulk download method (page & download, images only, no x-ig-www-claim)
//   2) disable Sentry telemetry (empty DSN -> the SDK sends nothing)
// Usage: node patch/apply.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const jsDir = path.join(root, "extension", "js");
const target = path.join(jsDir, "extension.js");
const bodyFile = path.join(here, "new-bulk-method.js");

// ---------------------------------------------------------------- 1) bulk method
const raw = fs.readFileSync(target, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";

if (raw.includes("[IGDL] bulk: click handler start")) {
  console.log("Bulk method: already patched.");
} else {
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex(
    (l, i) =>
      l.trim() === "static downloadContent() {" &&
      (lines[i + 1] || "").includes("function* () {") &&
      lines.slice(i, i + 12).some((x) => x.includes("document.querySelector(y.accountName).innerHTML")),
  );
  if (start < 0) throw new Error("Could not locate the bulk downloadContent() method.");

  const bodyStart = start + 1;
  if (!lines[bodyStart].includes("function* () {")) throw new Error("Unexpected method opening.");

  let bodyEnd = -1;
  for (let i = bodyStart + 1; i < lines.length; i++) {
    if (lines[i].trim() === "});" && (lines[i + 1] || "").trim() === "}") {
      bodyEnd = i;
      break;
    }
  }
  if (bodyEnd < 0) throw new Error("Could not locate the end of the bulk method.");
  if (!(lines[bodyEnd + 2] || "").includes("static getAccount")) {
    throw new Error("Sanity check failed: expected getAccount() right after the bulk method.");
  }

  const newBody = fs.readFileSync(bodyFile, "utf8").replace(/\r?\n$/, "").split(/\r?\n/);
  const out = [...lines.slice(0, bodyStart), ...newBody, ...lines.slice(bodyEnd + 1)];

  const backup = target + ".orig";
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, raw);
  fs.writeFileSync(target, out.join(eol));
  console.log(`Bulk method: patched (replaced lines ${bodyStart + 1}..${bodyEnd + 1}, backup ${path.basename(backup)}).`);
}

// ---------------------------------------------------------------- 2) telemetry off
// Sentry DSN: dsn:"https://<key>@o...ingest.sentry.io/<project>" -> dsn:"" (no DSN => SDK drops every event)
const dsnRe = /https:\/\/[0-9a-f]+@[^"'\s]+ingest\.sentry\.io[^"'\s]*/g;
let disabled = 0;
for (const name of fs.readdirSync(jsDir)) {
  if (!name.endsWith(".js")) continue;
  const file = path.join(jsDir, name);
  const text = fs.readFileSync(file, "utf8");
  if (!dsnRe.test(text)) continue;
  dsnRe.lastIndex = 0;
  const next = text.replace(dsnRe, "");
  fs.writeFileSync(file, next);
  disabled += 1;
  console.log(`Telemetry: disabled Sentry DSN in ${name}.`);
}
if (!disabled) console.log("Telemetry: no Sentry DSN found (already disabled).");

// ---------------------------------------------------------------- 3) injected script
// Stop reading Instagram's internal modules (PolarisWWWClaim / PolarisConfig): they fail to
// resolve and spam the console via IG's ErrorUtils. Read the session token Instagram already
// stores (www-claim-v2) and use the default app id instead.
const injectFile = path.join(jsDir, "inject.js");
let inj = fs.readFileSync(injectFile, "utf8");
const injBefore = inj;
inj = inj.replace('window.require("PolarisWWWClaim").getWWWClaim()', '(sessionStorage.getItem("www-claim-v2") || "")');
inj = inj.replace('window.require("PolarisConfig").getIGAppID()', '"936619743392459"');
if (inj !== injBefore) {
  fs.writeFileSync(injectFile, inj);
  console.log("Injected script: neutralized PolarisWWWClaim/PolarisConfig requires.");
} else {
  console.log("Injected script: nothing to change.");
}
