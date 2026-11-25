"use strict";
// Moving a Canvas of its own (not a line's) from one project to another: its file, its picture and the pictures it was drawn
// from, all named after it. The copy is written first and the original goes to the project's Deleted, where Restore brings it
// back, so nothing is lost if the second half fails. Used by the app's server and by PenEcho Cloud, where the two projects
// are two checked-out folders (src/routes/hosted-lines.mjs).
const fs = require("node:fs");
const path = require("node:path");

const TARGET_DIR = "files/canvases";
const MOST_BYTES = 64 * 1024 * 1024;

// { title, base, files:[{ suffix, data }] }: what the other project needs to make the same Canvas. `suffix` is the part of each
// file's name after the Canvas's own name (".penecho.json", ".png", a source picture's ending).
function exportCanvas(service, project, { path:relative } = {}) {
  const source = service.checkSource(relative);
  if (!service.store.exists(project, source)) throw Object.assign(new Error("That Canvas is not in the folder any more."), { code:"NOT_FOUND", status:404 });
  if (service.canvasBusy?.(project, source)) throw Object.assign(new Error("This Canvas is being saved. Try again in a moment."), { code:"BUSY", status:409 });
  const base = source.replace(/\.penecho\.json$/, ""), picture = `${base}.png`;
  const names = [source, picture, ...service.sourceFiles(project, source)].filter((rel, i, all) => all.indexOf(rel) === i && service.store.exists(project, rel));
  let total = 0;
  const files = names.map(rel => {
    const bytes = fs.readFileSync(service.store.resolve(project, rel));
    total += bytes.length;
    if (total > MOST_BYTES) throw Object.assign(new Error("This Canvas is too big to move."), { code:"TOO_LARGE", status:413 });
    return { suffix:rel.slice(base.length), data:bytes.toString("base64") };
  });
  // A Canvas of its own folder (files/<name>/canvas.penecho.json) is named by its folder.
  const own = /^files\/([^/]+)\/canvas$/.exec(base), name = own ? own[1] : path.posix.basename(base);
  return { title:service.canvasTitle?.(project, source) || name, base:name, files };
}

// Writes an exported Canvas into this project's files/canvases/, under a name nothing else has. Answers { path }.
function importCanvas(service, project, bundle = {}) {
  const files = Array.isArray(bundle.files) ? bundle.files : [];
  const valid = suffix => typeof suffix === "string" && suffix.length <= 80 && !/[\\/]|\.\./.test(suffix) && /^[.\w-]+$/.test(suffix);
  if (!files.some(file => file?.suffix === ".penecho.json") || !files.every(file => valid(file?.suffix) && typeof file.data === "string")) throw Object.assign(new Error("That is not a Canvas."), { code:"BAD_CANVAS", status:400 });
  const stem = String(bundle.base || "canvas").replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80) || "canvas";
  let base = `${TARGET_DIR}/${stem}`;
  for (let n = 2; files.some(file => service.store.exists(project, `${base}${file.suffix}`)); n++) base = `${TARGET_DIR}/${stem}-${n}`;
  // The route is the other project's, so this one names what it wrote, even when a later file fails: its next look lists them at once.
  const wrote = [];
  try {
    for (const file of files) {
      const full = service.store.resolve(project, `${base}${file.suffix}`, { forWrite:true });
      fs.mkdirSync(path.dirname(full), { recursive:true });
      wrote.push(service.store.place(project, `${base}${file.suffix}`));
      fs.writeFileSync(full, Buffer.from(file.data, "base64"));
    }
  } finally { if (wrote.length) service.changed?.(project, wrote); }
  service.sync?.(project);
  return { path:`${base}.penecho.json`, title:bundle.title || "" };
}

module.exports = { exportCanvas, importCanvas };
