#!/usr/bin/env node
// Makes the pictures already in a docs folder smaller, the way PenEcho now keeps new ones (src/server/project-lines/picture-size.js).
// Only pictures PenEcho itself keeps are looked at: those sent with an Ask, those in files/_incoming, and each Canvas's picture beside
// its .penecho.json. Files added on the Files page and whatever an agent made are left alone. Names and kinds of file stay the same.
//
//   node scripts/shrink-pictures.cjs <docs folder>          says what it would save, changes nothing
//   node scripts/shrink-pictures.cjs <docs folder> --apply  writes the smaller pictures (the bigger ones are gone after this)
"use strict";
const fs = require("node:fs"), path = require("node:path");
const { fitPicture } = require("../src/server/project-lines/picture-size.js");

const docs = path.resolve(process.argv[2] || ""), apply = process.argv.includes("--apply");
if (!process.argv[2] || !fs.existsSync(path.join(docs, "lines"))) {
  console.error("Usage: node scripts/shrink-pictures.cjs <docs folder> [--apply]   (the folder that holds lines/ and files/)");
  process.exit(2);
}
const RASTER = /\.(png|jpe?g)$/i;

function walk(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes:true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out); else if (e.isFile()) out.push(full);
  }
  return out;
}

// What a line's Asks link to: the pictures sent with them.
function askPictures(lineFile) {
  const md = fs.readFileSync(lineFile, "utf8"), found = [];
  for (const part of md.split(/^(?=## )/m)) {
    if (!/^## Ask\b/.test(part)) continue;
    for (const [, href] of part.matchAll(/\]\(<?([^)>\s]+)>?\)/g)) {
      if (/^[a-z]+:/i.test(href)) continue;
      let rel;
      try { rel = decodeURIComponent(href.split("#")[0]); } catch { continue; }
      if (RASTER.test(rel)) found.push(path.resolve(path.dirname(lineFile), rel));
    }
  }
  return found;
}

const roots = [docs, path.join(docs, "archive")];
const picked = new Map();
for (const root of roots) {
  for (const file of walk(path.join(root, "lines"))) if (file.endsWith(".md")) for (const pic of askPictures(file)) picked.set(pic, "sent with an Ask");
  for (const file of walk(path.join(root, "files"))) {
    const rel = path.relative(path.join(root, "files"), file).split(path.sep).join("/");
    if (!RASTER.test(file) || rel.startsWith("added/")) continue;
    if (rel.startsWith("_incoming/")) picked.set(file, "sent with an Ask");
    else if (/\.png$/i.test(file) && fs.existsSync(file.replace(/\.png$/i, ".penecho.json"))) picked.set(file, "Canvas picture");
  }
}

(async () => {
  const sum = {};
  let failed = 0;
  for (const [file, kind] of picked) {
    if (!file.startsWith(docs + path.sep) || !fs.existsSync(file)) continue;
    const row = sum[kind] ||= { count:0, before:0, after:0, changed:0 };
    try {
      const bytes = fs.readFileSync(file), out = await fitPicture(bytes);
      row.count++; row.before += bytes.length; row.after += out.length;
      if (out === bytes) continue;
      row.changed++;
      if (apply) {
        const temp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temp, out);
        fs.renameSync(temp, file);
      }
    } catch (error) { failed++; console.error(`Skipped ${path.relative(docs, file)}: ${error.message}`); }
  }
  const mb = n => `${(n / 1048576).toFixed(1)} MB`;
  let before = 0, after = 0;
  for (const [kind, r] of Object.entries(sum)) {
    before += r.before; after += r.after;
    console.log(`${kind}: ${r.count} pictures, ${r.changed} made smaller, ${mb(r.before)} -> ${mb(r.after)}`);
  }
  console.log(`${apply ? "Saved" : "Would save"} ${mb(before - after)} of ${mb(before)}${before ? ` (${Math.round((1 - after / before) * 100)}%)` : ""}.${apply ? "" : " Run again with --apply to write them."}${failed ? ` ${failed} skipped.` : ""}`);
})();
