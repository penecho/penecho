import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Render the actual committed README fragment with the existing GitHub-style
// stylesheet. No gallery-specific CSS is added: alignment comes from the table
// and the normalized preview assets, as it does in README renderers.
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const locales = ['en', 'zh-CN', 'ja', 'ko', 'de', 'es', 'fr', 'pt-BR', 'ru'];
for (const locale of locales) {
  const source = path.join(root, locale === 'en' ? 'README.md' : `docs/readme/README.${locale}.md`);
  const markdown = fs.readFileSync(source, 'utf8');
  let fragment = markdown.split('<!-- professional-diagram-gallery -->')[1]
    .split('<!-- /professional-diagram-gallery -->')[0];
  fragment = fragment.replace(/(src|href)="([^"]+)"/g, (_, attribute, file) => {
    const relative = path.relative(directory, path.resolve(path.dirname(source), file));
    return `${attribute}="${relative}"`;
  });
  const document = `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>README · ${locale} · 专业图表</title>
  <link rel="stylesheet" href="../readme-20260915/github-markdown.css">
  <style>
    html, body { margin: 0; min-width: 0; }
    body { background: #fff; }
    .markdown-body { box-sizing: border-box; width: 100%; max-width: 1184px; margin: 0 auto; padding: 32px; }
    @media (max-width: 680px) { .markdown-body { padding: 16px; } }
  </style>
</head>
<body><main class="markdown-body">${fragment}</main></body>
</html>
`;
  fs.writeFileSync(path.join(directory, `readme.${locale}.html`), document);
  console.log(`readme.${locale}.html`);
}
