"use strict";
const fs = require("node:fs");
const path = require("node:path");

const READ_BYTES = 16 * 1024, EXCERPT_CHARS = 800;
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
const TEXT = /\.(md|markdown|txt|csv|json|html?|xml|ya?ml|log)$/i;
const originalPath = value => typeof value === "string" && value.startsWith("files/") && !/[\\\0]/.test(value) && value.split("/").every(part => part && part !== "." && part !== "..");

function readStart(file) {
  const fd = fs.openSync(file, "r");
  try { const buffer = Buffer.alloc(READ_BYTES); return buffer.subarray(0, fs.readSync(fd, buffer, 0, buffer.length, 0)); }
  finally { fs.closeSync(fd); }
}
function textExcerpt(bytes, original) {
  if (bytes.includes(0)) return "";
  let text = bytes.toString("utf8");
  if ((text.match(/[\x01-\x08\x0b\x0c\x0e-\x1f]/g) || []).length > text.length / 100) return "";
  if (/\.html?$/i.test(original)) text = text.replace(/<(script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, " ").replace(/<!--[\s\S]*?(?:-->|$)/g, " ").replace(/<[^>]*>/g, " ")
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/gi, (_, name) => ({ nbsp:" ", amp:"&", lt:"<", gt:">", quot:'"', apos:"'" }[name.toLowerCase()]));
  if (/\.(md|markdown)$/i.test(original)) text = text.replace(/!?(\[[^\]]*\])\([^)]*\)/g, "$1").replace(/^[#>*\s]+/gm, "").replace(/[`*_]/g, "");
  return text.replace(/\s+/g, " ").trim().slice(0, EXCERPT_CHARS);
}

// Derive previews from existing records, never from the active original file.
// An edited manifest must not point a preview outside this particular trash item.
function deletedPreview(store, project, kind, id, record) {
  if (!["files", "canvases"].includes(kind) || !/^[a-f0-9]{12}$/.test(id)) return {};
  const original = kind === "canvases" ? record.source : record.path;
  const info = { fileType:kind === "canvases" ? "Canvas" : path.posix.extname(String(original || "")).slice(1).toUpperCase() };
  try {
    const directory = `.trash/${kind}/${id}`, root = store.resolve(project, directory);
    const realRoot = fs.realpathSync(root);
    if (realRoot !== path.join(fs.realpathSync(project.docsPath), ".trash", kind, id)) return info;
    const files = Array.isArray(record.files) ? record.files : [];
    const find = from => {
      if (!originalPath(from)) return null;
      for (const file of files) {
        if (!originalPath(file?.from) || typeof file.name !== "string" || !file.name || /[/\\\0]/.test(file.name) || [".", ".."].includes(file.name)) continue;
        // Page folders preserve their known entry document inside the moved folder.
        if (from !== file.from && !from.startsWith(`${file.from}/`)) continue;
        const suffix = from.slice(file.from.length), relative = `${directory}/${file.name}${suffix}`;
        try {
          const absolute = store.resolve(project, relative), real = fs.realpathSync(absolute), stat = fs.statSync(absolute);
          if (real.startsWith(realRoot + path.sep) && stat.isFile()) return { path:relative, absolute, size:stat.size };
        } catch { /* A missing or edited entry does not hide Restore. */ }
      }
      return null;
    };
    const primary = find(original);
    if (primary) Object.assign(info, { size:primary.size, downloadPath:primary.path });
    const imagePath = kind === "canvases" ? record.picture : original;
    const image = IMAGE.test(String(imagePath || "")) ? find(imagePath) : null;
    if (image) info.preview = { kind:"image", path:image.path };
    else if (primary && kind !== "canvases" && TEXT.test(original)) {
      const text = textExcerpt(readStart(primary.absolute), original);
      if (text) info.preview = { kind:"text", text };
    }
  } catch { /* Preview failure must not change deletion or recovery. */ }
  return info;
}

module.exports = { deletedPreview };
