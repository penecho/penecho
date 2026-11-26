"use strict";
// PPT slides: 1280x720 HTML pages marked data-penecho-slide. A slide names its template with
// data-penecho-template and may ask for the chart library with <script src="penecho-slide-charts.js">.
// PenEcho completes the page when it is saved: the template's master CSS and the chart library are
// inlined, so every slide of a deck shares one master and renders the same in the Canvas, in a
// screenshot, in PowerPoint and when copied elsewhere.
const fs = require("node:fs");
const path = require("node:path");
const TEMPLATES = require("../shared/slide-templates.js");

const LIBRARY_FILE = path.join(__dirname, "../shared/slide-charts.js");
const LIBRARY_TAG = /<script\b[^>]*\bsrc\s*=\s*["']?(?:\.\/)?penecho-slide-charts\.js["']?[^>]*>\s*<\/script>/gi;
const SLIDE_MARK = /\bdata-penecho-slide\b/i;
const TEMPLATE_ATTR = /\bdata-penecho-template\s*=\s*["']([a-z-]{1,40})["']/i;
const MASTER_MARK = "data-penecho-master";
const LIBRARY_MARK = "/* PenEcho slide charts";
let library = null;

function slideChartsLibrary() {
  library ??= fs.readFileSync(LIBRARY_FILE, "utf8").trim();
  return library;
}
function isSlideHtml(html) { return typeof html === "string" && SLIDE_MARK.test(html); }
function slideTemplate(html) { return TEMPLATE_ATTR.exec(html || "")?.[1]?.toLowerCase() || ""; }
// Models sometimes wrap a page in a Markdown code fence or send only the slide's body.
function wholePage(html) {
  const text = html.trim().replace(/^```[a-z]*[ \t]*\r?\n/i, "").replace(/\r?\n```\s*$/, "");
  if (/<html[\s>]/i.test(text)) return text;
  const title = /<h1[^>]*>([\s\S]{1,200}?)<\/h1>/i.exec(text)?.[1]?.replace(/<[^>]+>/g, "").trim() || "Slide";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>\n${text}\n</body></html>`;
}
// The element carrying data-penecho-slide is the slide root: it must be a div with the class "slide",
// which is what the master CSS styles.
function slideRoot(page) {
  const open = /<([a-z][a-z0-9-]*)\b([^>]*\bdata-penecho-slide\b[^>]*)>/i.exec(page);
  if (!open) return page;
  let [tag, name, attrs] = open;
  if (!/\bclass\s*=\s*["'][^"']*\bslide\b/i.test(attrs)) attrs = /\bclass\s*=\s*["']/i.test(attrs) ? attrs.replace(/\bclass\s*=\s*(["'])/i, "class=$1slide ") : ` class="slide"${attrs}`;
  if (name.toLowerCase() === "slide") {
    const close = page.lastIndexOf("</slide>");
    if (close > open.index) page = `${page.slice(0, close)}</div>${page.slice(close + 8)}`;
    name = "div";
  }
  return `${page.slice(0, open.index)}<${name}${attrs}>${page.slice(open.index + tag.length)}`;
}
function intoHead(page, block) {
  if (/<head[^>]*>/i.test(page)) return page.replace(/<head[^>]*>/i, match => `${match}\n${block}`);
  return page.replace(/<html[^>]*>/i, match => `${match}<head>${block}</head>`);
}
// Completes a slide page; anything that is not a slide passes through unchanged (apart from an inlined chart library).
function expandSlide(html) {
  if (typeof html !== "string") return html;
  const slide = isSlideHtml(html);
  if (!slide && !/penecho-slide-charts\.js/i.test(html)) return html;
  let page = slide ? slideRoot(wholePage(html)) : html;
  const wantsCharts = /penecho-slide-charts\.js/i.test(page) || (slide && /\bSC\.(?:bar|line|donut)\s*\(/.test(page));
  page = page.replace(LIBRARY_TAG, "");
  if (wantsCharts && !page.includes(LIBRARY_MARK)) page = intoHead(page, `<script>\n${slideChartsLibrary()}\n</script>`);
  // The master goes first in <head>, so a slide's own <style> can still adjust it.
  if (slide && !page.includes(MASTER_MARK)) page = intoHead(page, `<style ${MASTER_MARK}="${slideTemplate(page) || "base"}">\n${TEMPLATES.css(slideTemplate(page))}\n</style>`);
  return page;
}
// The slide rules an agent in a project folder reads (the same document the Canvas agent loads as ppt-slides guidance).
const RULES_FILE = path.join(__dirname, "canvas-agent/ppt-slides-contract.md"), RULES_NAME = "ppt-slides.md";
// A copy is read and compared only when its file is not as PenEcho last left it, or the text changed: every project's 3-second look read
// each copy again (slides.js, prototype-rules.js and agent-help.js keep their copies the same way, each on its own for PenEcho Cloud's copy).
const versionOf = stat => (stat ? `${stat.dev}:${stat.ino}:${stat.ctimeMs}:${stat.mtimeMs}:${stat.size}` : "");
const copies = new Map();
function keepCopy(file, text) {
  const before = versionOf(fs.statSync(file, { throwIfNoEntry:false })), known = copies.get(file);
  if (before && known?.version === before && known.text === text) return false;
  let now = null;
  try { now = fs.readFileSync(file, "utf8"); } catch { /* Not there yet. */ }
  const write = now !== text;
  if (write) { fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, text); copies.delete(file); return true; }
  // Remembered only once it was read holding the text and did not change while read; a copy just written is read at the next look.
  const after = versionOf(fs.statSync(file, { throwIfNoEntry:false }));
  if (after && after === before) { if (copies.size > 2000) copies.clear(); copies.set(file, { version:after, text }); } else copies.delete(file);
  return false;
}
// The rules themselves are read again only when their file changes.
let rules = null;
function installSlideRules(dir) {
  const version = versionOf(fs.statSync(RULES_FILE));
  if (rules?.version !== version) rules = { version, text:fs.readFileSync(RULES_FILE, "utf8") };
  return keepCopy(path.join(dir, RULES_NAME), rules.text);
}

module.exports = { expandSlide, expandSlideCharts:expandSlide, isSlideHtml, slideTemplate, slideChartsLibrary, installSlideRules, SLIDE_MARK, RULES_NAME, TEMPLATE_NAMES:TEMPLATES.names };
