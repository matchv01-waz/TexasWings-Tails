'use strict';
// Generates the website's logo files from the original artwork in assets/brand/.
// Run again whenever the logo changes:  npm run brand
//
//   assets/brand/logo-mark.png  → parrot mark (transparent PNG)
//   assets/brand/logo-full.png  → full logo with wordmark (transparent PNG)

const path = require('path');
const sharp = require('sharp');

const SRC = path.join(__dirname, '..', 'assets', 'brand');
const OUT = path.join(__dirname, '..', 'public', 'img', 'brand');
const IVORY = { r: 250, g: 246, b: 238, alpha: 1 };

async function trimmed(file) {
  return sharp(path.join(SRC, file)).trim({ threshold: 1 }).png().toBuffer();
}

// Square canvas with the mark centered, optionally on a solid background.
async function squareIcon(mark, size, padding, background) {
  const inner = Math.round(size * (1 - padding * 2));
  const resized = await sharp(mark).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: background || { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: resized, gravity: 'center' }]).png({ compressionLevel: 9, palette: true });
}

// One-color ivory version of the mark for photo placeholders: body solid,
// beak/stripe/branch lighter, eye cut out.
async function silhouette(mark, height) {
  const { data, info } = await sharp(mark).resize({ height }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (!a) continue;
    let k;
    if (r > 215 && g > 210 && b > 200) k = 0;            // eye
    else if (g > r && g >= b) k = 0.92;                   // green body
    else if (r > 150 && g < 110) k = 0.62;                // red beak + stripe
    else k = 0.5;                                         // branch + bud
    data[i] = 255; data[i + 1] = 253; data[i + 2] = 248; data[i + 3] = Math.round(a * k);
  }
  return sharp(data, { raw: info }).png({ compressionLevel: 9 });
}

(async () => {
  const mark = await trimmed('logo-mark.png');
  const full = await trimmed('logo-full.png');

  await sharp(mark).resize({ height: 192 }).png({ compressionLevel: 9, palette: true }).toFile(path.join(OUT, 'mark.png'));
  await (await squareIcon(mark, 32, 0.04)).toFile(path.join(OUT, 'favicon-32.png'));
  await (await squareIcon(mark, 192, 0.08)).toFile(path.join(OUT, 'icon-192.png'));
  await (await squareIcon(mark, 512, 0.08)).toFile(path.join(OUT, 'icon-512.png'));
  await (await squareIcon(mark, 180, 0.14, IVORY)).toFile(path.join(OUT, 'apple-touch-icon.png'));
  await (await silhouette(mark, 640)).toFile(path.join(OUT, 'parrot-silhouette.png'));

  // Default link preview (WhatsApp, Facebook, iMessage) when no photo is set.
  const logo = await sharp(full).resize({ width: 980 }).toBuffer();
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: IVORY } })
    .composite([{ input: logo, gravity: 'center' }]).png({ compressionLevel: 9 }).toFile(path.join(OUT, 'og-default.png'));

  console.log('Brand assets written to public/img/brand/');
})().catch((e) => { console.error(e); process.exit(1); });
