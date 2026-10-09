// Apply the "bulk download without x-ig-www-claim" patch to extension/js/extension.js
// Usage: node patch/apply.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const target = path.join(root, "extension", "js", "extension.js");
const bodyFile = path.join(here, "new-bulk-method.js");

const raw = fs.readFileSync(target, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
const lines = raw.split(/\r?\n/);

// ---- already patched? ----
if (raw.includes("PATCHED: bulk download without x-ig-www-claim")) {
  console.log("Already patched. Nothing to do.");
  process.exit(0);
}

// ---- locate the bulk downloadContent() method ----
const start = lines.findIndex((l, i) =>
  l.trim() === "static downloadContent() {" &&
  (lines[i + 1] || "").includes("function* () {") &&
  lines.slice(i, i + 12).some((x) => x.includes("document.querySelector(y.accountName).innerHTML"))
);
if (start < 0) throw new Error("Could not locate the bulk downloadContent() method.");

// body to replace: from line after the signature to the wrapper's closing `});`
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

// ---- splice in the new body ----
const newBody = fs.readFileSync(bodyFile, "utf8").replace(/\r?\n$/, "").split(/\r?\n/);
const out = [...lines.slice(0, bodyStart), ...newBody, ...lines.slice(bodyEnd + 1)];

// ---- backup + write ----
const backup = target + ".orig";
if (!fs.existsSync(backup)) fs.writeFileSync(backup, raw);
fs.writeFileSync(target, out.join(eol));

console.log(`Patched: ${target}`);
console.log(`  replaced lines ${bodyStart + 1}..${bodyEnd + 1} (1-based)`);
console.log(`  backup:   ${backup}`);
