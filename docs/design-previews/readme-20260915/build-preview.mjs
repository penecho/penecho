import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { marked } from '/Users/heack/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/marked/lib/marked.esm.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const originalPath = path.join(directory, 'README.original.md');
if (!fs.existsSync(originalPath)) fs.copyFileSync(path.join(root, 'README.md'), originalPath);
const original = fs.readFileSync(originalPath, 'utf8');
const logo = original.slice(0, original.indexOf('<p align="center">'))
  .replace('<h1', '<p').replace('</h1>', '</p>').replace('width="280"', 'width="160"');
const languages = original.match(/<p align="center">\n  <strong>English<\/strong>[\s\S]*?<\/p>/)[0]
  .replace('  <strong>', '  <sub><strong>').replace('\n</p>', '</sub>\n</p>');
const title = original.match(/<h1 align="center">A spatial[\s\S]*?<\/h1>/)[0];
const description = original.match(/<p align="center">Draw, explore,[\s\S]*?<\/p>/)[0];
const badges = original.match(/<p align="center">\n  <img src="https:\/\/img.shields[\s\S]*?<\/p>/)[0]
  .replace('version-1.3.2-087f83', 'version-1.3.2-e84b60?style=flat&labelColor=30363d')
  .replace('license-AGPL--3.0-blue', 'license-AGPL--3.0-6e7781?style=flat&labelColor=30363d');
const navigation = original.match(/<p align="center">\n  <a href="https:\/\/penecho.ai">Website[\s\S]*?<\/p>/)[0]
  .replace('>Download</a>', '><strong>Download</strong></a>')
  .replace('>Quick start</a>', '><strong>Quick start</strong></a>');
const demos = original.match(/<p align="center">\n  <img src="https:\/\/github.com\/penecho\/penecho\/releases\/download\/v0.1.0\/penecho_full_demo[\s\S]*?play_patris.webp[\s\S]*?<\/p>/)[0];
const sponsor = original.match(/<p align="center">\n  <a href="https:\/\/www.kimi.com\/code\?aff=penecho">[\s\S]*?<\/p>/)[0];
let body = original.slice(original.indexOf('## A spatial extension'));
body = body.replace(
  /\| Keep the conversation \| See the work take shape \| Bring feedback back \|\n\| --- \| --- \| --- \|\n\| Work with[\s\S]*?next revision\. \|/,
  '1. **Keep the conversation**  \n   Work with the AI agent you already use.\n\n2. **See the work take shape**  \n   PenEcho\'s MCP server brings diagrams, documents, and interactive previews onto the Canvas.\n\n3. **Bring feedback back**  \n   Try the result, annotate it, and let your agent read your feedback for the next revision.'
);
body = body.replace(/^(\- \*\*.*)\n(?=\- \*\*)/gm, '$1\n\n');
body = body.replace('width="1483"', 'width="100%"');
const proposed = [logo.trim(), title, description, badges, navigation, languages, '<br>', demos, body.trim(), '<br>', sponsor, ''].join('\n\n');
fs.writeFileSync(path.join(directory, 'README.proposed.md'), proposed);

// These immutable Canvas assets contain the original local image bytes.
const canvasAssets = {
  'public/penecho-readme-header.webp': 'penecho-asset:aa1ff420fad8113fa332dcb2f62d138c6b79e44eeb3185dc6283604fc492c76a',
  'docs/assets/mcp-spatial-example.webp': 'penecho-asset:e1034c7c211d94076c44d2fe357c06954b737876e199d6985f7d141143673423',
  'public/penecho-architecture.webp': 'penecho-asset:84df5d8e4040927ebd8d173909f94e9ac69402e5154fbbcaae0920e1a94fa1f9'
};
const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
function render(source, local = false) {
  let html = marked.parse(source, { gfm: true });
  html = html.replace(/(src|srcset)="([^"]+)"/g, (_, attribute, value) => {
    if (/^https?:/.test(value)) return `${attribute}="${escape(value.replaceAll('&amp;', '&'))}"`;
    if (local) return `${attribute}="${new URL('../../../' + value, 'file://' + directory + '/').href}"`;
    return `${attribute}="${canvasAssets[value] || 'https://raw.githubusercontent.com/penecho/penecho/main/' + value}"`;
  });
  html = html.replace(/href="([^"]+)"/g, (_, value) => {
    if (value.startsWith('#')) return `href="${value}"`;
    return `target="_blank" rel="noopener noreferrer" href="${escape(/^https?:/.test(value) ? value : 'https://github.com/penecho/penecho/blob/main/' + value)}"`;
  });
  html = html.replace(/<h([1-6])>(.*?)<\/h\1>/g, (_, level, content) => {
    const id = content.replace(/<[^>]+>/g, '').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replaceAll(' ', '-');
    return `<h${level} id="${id}">${content}</h${level}>`;
  });
  return html;
}

// Verify content independently of Markdown structure and ordering.
function contentInventory(source) {
  const html = marked.parse(source);
  const text = html.replace(/<[^>]*>/g, ' ').replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&').replaceAll('&#39;', "'").replaceAll('&quot;', '"');
  const words = text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
  const counts = {};
  for (const word of words) counts[word] = (counts[word] || 0) + 1;
  return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
}
const sources = source => [...source.matchAll(/(?:src|srcset)="([^"]+)"/g)].map(match => match[1]).filter(value => !value.startsWith('https://img.shields.io/')).sort();
const hrefs = source => [...marked.parse(source).matchAll(/href="([^"]+)"/g)].map(match => match[1]).sort();
const code = source => [...source.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(match => match[1]);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const checks = {
  textUnchanged: equal(contentInventory(original), contentInventory(proposed)),
  imagesUnchanged: equal(sources(original), sources(proposed)),
  linksUnchanged: equal(hrefs(original), hrefs(proposed)),
  codeBlocksUnchanged: equal(code(original), code(proposed)),
  noCustomStylesInMarkdown: !/<style|<script|\sstyle=|\sclass=/i.test(proposed),
  originalSha256: createHash('sha256').update(original).digest('hex')
};
if (Object.values(checks).includes(false)) throw new Error(JSON.stringify(checks));
fs.writeFileSync(path.join(directory, 'content-check.json'), JSON.stringify(checks, null, 2) + '\n');

let markdownCss = fs.readFileSync(path.join(directory, 'github-markdown.css'), 'utf8');
// Make the library's GitHub light/dark palettes independently switchable.
markdownCss = markdownCss.replace(/@media \(prefers-color-scheme: dark\)/g, '@media all').replace(/@media \(prefers-color-scheme: light\)/g, '@media all');
let mediaIndex = 0;
markdownCss = markdownCss.replace(/(@media all\s*\{\s*)\.markdown-body/g, (_, prefix) => `${prefix}[data-theme="${mediaIndex++ === 0 ? 'dark' : 'light'}"] .markdown-body`);

const previewCss = `
* { box-sizing: border-box; }
html, body { margin: 0; width: 100%; min-width: 0; height: 100%; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.preview { height: 100%; display: flex; flex-direction: column; background: #ffffff; color: #1f2328; }
.preview[data-theme="dark"] { background: #0d1117; color: #f0f6fc; color-scheme: dark; }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; padding: 12px 20px; border-bottom: 1px solid #d1d9e0; font-size: 13px; }
.toolbar strong { font-weight: 500; margin-right: auto; }
.control { display: inline-flex; align-items: center; gap: 4px; }
.control button { font: inherit; cursor: pointer; border: 1px solid transparent; border-radius: 6px; background: transparent; color: inherit; padding: 2px 10px; min-height: 30px; line-height: 24px; }
.control button[aria-pressed="true"] { border-color: #d1d9e0; background: #f6f8fa; }
.control button:hover { border-color: #8c959f; }
.control button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid #0969da; outline-offset: 2px; }
[data-theme="dark"] .toolbar { border-color: #3d444d; }
[data-theme="dark"] .control button[aria-pressed="true"] { border-color: #3d444d; background: #151b23; }
.reader { min-height: 0; flex: 1; overflow: auto; padding: 24px; }
.file { width: 100%; max-width: 1012px; margin: 0 auto; border: 1px solid #d1d9e0; border-radius: 6px; }
.file-name { padding: 13px 24px; border-bottom: 1px solid #d1d9e0; font-size: 14px; line-height: 20px; font-weight: 600; }
[data-theme="dark"] .file, [data-theme="dark"] .file-name { border-color: #3d444d; }
.markdown-body { padding: 32px; min-width: 0; }
.markdown-body img { height: auto; }
.markdown-body [align="center"] { text-align: center; }
.markdown-body a { overflow-wrap: anywhere; }
.markdown-body table { display: block; width: max-content; max-width: 100%; overflow: auto; }
.markdown-body pre { overflow: auto; }
.markdown-body [hidden] { display: none; }
.preview-note { margin: 12px auto 0; max-width: 1012px; font-size: 12px; line-height: 1.8; color: #59636e; }
[data-theme="dark"] .preview-note { color: #9198a1; }
@media (max-width: 600px) {
  .toolbar { padding: 10px 12px; gap: 8px; }
  .toolbar strong { flex-basis: 100%; }
  .reader { padding: 12px; }
  .markdown-body { padding: 20px 16px; }
  .file-name { padding: 12px 16px; }
}
`;
function page(local) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PenEcho README · GitHub 排版预览</title>
<style>
/* github-markdown-css 5.8.1 · MIT · Sindre Sorhus */
${markdownCss}
${previewCss}
</style>
</head>
<body>
<div class="preview" data-theme="light">
  <header class="toolbar" aria-label="预览控制（不属于 README）">
    <strong>README · GitHub 排版预览</strong>
    <div class="control" aria-label="版本">
      <button type="button" data-version="proposed" aria-pressed="true">调整后</button>
      <button type="button" data-version="original" aria-pressed="false">原版</button>
    </div>
    <div class="control" aria-label="GitHub 主题">
      <button type="button" data-color="light" aria-pressed="true">浅色</button>
      <button type="button" data-color="dark" aria-pressed="false">深色</button>
    </div>
  </header>
  <main class="reader">
    <section class="file" aria-label="README 文档">
      <div class="file-name">README.md</div>
      <article class="markdown-body" lang="en" id="readme">${render(proposed, local)}</article>
    </section>
    <p class="preview-note">控制栏仅用于预览。正文使用 GitHub Markdown 样式；保留原文、链接与原图，仅调整排版和徽章颜色。</p>
  </main>
</div>
<template id="proposed">${render(proposed, local)}</template>
<template id="original">${render(original, local)}</template>
<script>
const preview = document.querySelector('.preview');
const reader = document.querySelector('.reader');
const article = document.querySelector('#readme');
function notify() {
  window.parent.postMessage({ type: 'penecho-widget-updated' }, '*');
}
function updateThemeImages() {
  article.querySelectorAll('picture').forEach(picture => {
    const image = picture.querySelector('img');
    if (!image.dataset.light) image.dataset.light = image.src;
    const dark = picture.querySelector('source');
    if (dark) {
      if (!dark.dataset.dark) dark.dataset.dark = dark.srcset;
      dark.removeAttribute('srcset');
      image.src = preview.dataset.theme === 'dark' ? dark.dataset.dark : image.dataset.light;
    }
  });
}
document.querySelectorAll('[data-version]').forEach(button => {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-version]').forEach(peer => peer.setAttribute('aria-pressed', String(peer === button)));
    article.replaceChildren(document.querySelector('#' + button.dataset.version).content.cloneNode(true));
    reader.scrollTop = 0;
    updateThemeImages();
    notify();
  });
});
document.querySelectorAll('[data-color]').forEach(button => {
  button.addEventListener('click', () => {
    preview.dataset.theme = button.dataset.color;
    document.querySelectorAll('[data-color]').forEach(peer => peer.setAttribute('aria-pressed', String(peer === button)));
    updateThemeImages();
    notify();
  });
});
article.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  if (!link) return;
  const target = article.querySelector(link.getAttribute('href'));
  if (target) { event.preventDefault(); target.scrollIntoView({ block: 'start' }); }
});
updateThemeImages();
notify();
</script>
</body>
</html>\n`;
}
fs.writeFileSync(path.join(directory, 'preview.canvas.html'), page(false));
fs.writeFileSync(path.join(directory, 'preview.local.html'), page(true));
console.log(JSON.stringify({ directory, checks, htmlBytes: Buffer.byteLength(page(false)) }, null, 2));
