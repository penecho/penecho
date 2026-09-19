# Professional diagram images

The README gallery links to the original diagrams in this directory. Its images
use the six equally sized files in `previews/` so that every table cell has the
same proportions in Markdown renderers without custom CSS.

Regenerate the previews from the repository root:

```sh
node scripts/build-readme-diagram-previews.js
```

The generator contains each complete diagram in a 1120 × 640 white preview,
preserves its aspect ratio, and writes lossless WebP. It does not crop, stretch,
or overwrite the originals. The current sequence pair is `notifications` and
`mcp-request`.
