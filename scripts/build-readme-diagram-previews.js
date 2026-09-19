#!/usr/bin/env node
// README renderers strip custom CSS. Equal-size previews keep table rows aligned
// while the linked originals retain their full resolution and aspect ratio.
const path = require('node:path');
const fs = require('node:fs/promises');
const sharp = require('sharp');

const directory = path.resolve(__dirname, '../docs/assets/professional-diagrams');
const files = [
  'kubernetes.webp',
  'migration.webp',
  'notifications.webp',
  'mcp-request.png',
  'release.webp',
  'rollout.webp',
];

async function main() {
  const output = path.join(directory, 'previews');
  await fs.mkdir(output, { recursive: true });
  for (const file of files) {
    const { data, info } = await sharp(path.join(directory, file))
      .resize(1056, 576, { fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    const name = `${path.parse(file).name}.webp`;
    await sharp({ create: { width: 1120, height: 640, channels: 4, background: '#ffffff' } })
      .composite([{
        input: data,
        left: Math.floor((1120 - info.width) / 2),
        top: Math.floor((640 - info.height) / 2),
      }])
      .webp({ lossless: true })
      .toFile(path.join(output, name));
    console.log(`previews/${name}: 1120 × 640, image ${info.width} × ${info.height}`);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
