"use strict";

const fs = require("node:fs/promises");
const sharp = require("sharp");

// The owner supplies a finished transparent PNG. Preserve the source bytes,
// including its native alpha and anti-aliased edges, without white-matte removal.
async function prepareBrandLogo(input, output) {
  const metadata = await sharp(input).metadata();
  if (metadata.format !== "png" || !metadata.hasAlpha) {
    throw new Error("Brand source must be a transparent PNG supplied by the owner.");
  }
  await fs.copyFile(input, output);
}

module.exports = { prepareBrandLogo };
