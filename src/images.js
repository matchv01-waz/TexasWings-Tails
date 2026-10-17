'use strict';
// Image pipeline: every upload is re-encoded with sharp into a few responsive
// WebP widths and stored via ./storage (Cloudflare R2 or local disk).
// Re-encoding also strips EXIF metadata (including GPS location from phone
// photos) and neutralizes anything that isn't a real image.

const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const { get, all, run, marks } = require('./db');
const storage = require('./storage');
const { IMAGE_KEYS } = require('./settings');

const WIDTHS = [480, 960, 1600];
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ACCEPTED = /^image\/(jpeg|png|webp|gif|avif|heic|heif|tiff)$/;

sharp.cache(false);
sharp.concurrency(1); // keep memory low on small servers

const fileKeys = (img) => img.widths.split(',').map((w) => `${img.key}/${w}.webp`);

/** input: a Buffer or a path to a temporary upload file */
async function saveImage(input, alt = '') {
  const meta = await sharp(input, { failOn: 'error' }).metadata();
  if (!meta.width || !meta.height) throw new Error('That file does not look like a photo.');
  let { width, height } = meta;
  if (meta.orientation >= 5) [width, height] = [height, width];

  const outWidths = WIDTHS.filter((w) => w < width);
  outWidths.push(Math.min(width, WIDTHS[WIDTHS.length - 1]));
  const widths = [...new Set(outWidths)];

  const key = crypto.randomBytes(9).toString('hex');
  const written = [];
  try {
    for (const w of widths) {
      const buf = await sharp(input).rotate().resize({ width: w, withoutEnlargement: true })
        .webp({ quality: w <= 480 ? 72 : 78, effort: 4 }).toBuffer();
      const fileKey = `${key}/${w}.webp`;
      await storage.put(fileKey, buf, 'image/webp');
      written.push(fileKey);
    }
    const { dominant } = await sharp(input).stats();
    const color = '#' + [dominant.r, dominant.g, dominant.b].map((c) => c.toString(16).padStart(2, '0')).join('');
    const maxW = widths[widths.length - 1];
    const outH = Math.round(height * (maxW / width));
    const row = await get('INSERT INTO images (key, widths, width, height, color, alt) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
      key, widths.join(','), maxW, outH, color, String(alt).slice(0, 300));
    return row.id;
  } catch (e) {
    await storage.remove(written).catch(() => {});
    throw e;
  }
}

/** Save several multer files (disk storage); returns ids of the ones that worked plus error messages. */
async function saveUploads(files, alt = '') {
  const ids = [];
  const errors = [];
  for (const f of files || []) {
    if (!f.size) continue;
    if (!ACCEPTED.test(f.mimetype)) { errors.push(`${f.originalname}: not a supported photo type.`); continue; }
    try { ids.push(await saveImage(f.path || f.buffer, alt)); }
    catch (e) {
      console.error('Photo upload failed:', e.message);
      errors.push(`${f.originalname}: ${e.message.includes('photo') ? e.message : 'could not be processed.'}`);
    }
  }
  return { ids, errors };
}

/** Delete multer's temporary files once a request is finished. */
function cleanupTempFiles(req) {
  for (const f of req.files || []) if (f.path) fs.rm(f.path, { force: true }, () => {});
}

async function getImages(ids) {
  const list = [...new Set(ids.filter(Boolean).map(Number))];
  if (!list.length) return new Map();
  const rows = await all(`SELECT * FROM images WHERE id IN (${marks(list.length)})`, ...list);
  return new Map(rows.map((r) => [r.id, r]));
}
const getImage = async (id) => (id ? (await get('SELECT * FROM images WHERE id = ?', Number(id))) || null : null);

async function isReferenced(id) {
  const keys = IMAGE_KEYS.map((k) => `'${k}'`).join(',');
  return !!(await get(`SELECT 1 AS x WHERE
      EXISTS (SELECT 1 FROM bird_photos WHERE image_id = $1)
   OR EXISTS (SELECT 1 FROM species_photos WHERE image_id = $1)
   OR EXISTS (SELECT 1 FROM species WHERE hero_image_id = $1)
   OR EXISTS (SELECT 1 FROM gallery WHERE image_id = $1)
   OR EXISTS (SELECT 1 FROM testimonials WHERE image_id = $1)
   OR EXISTS (SELECT 1 FROM settings WHERE key IN (${keys}) AND value = $2)`, id, String(id)));
}

/** Delete image rows + stored files that nothing uses any more. */
async function purgeImages(ids) {
  for (const id of new Set(ids.filter(Boolean).map(Number))) {
    if (await isReferenced(id)) continue;
    const img = await getImage(id);
    if (!img) continue;
    await run('DELETE FROM images WHERE id = ?', id);
    await storage.remove(fileKeys(img)).catch((e) => console.error('Could not delete stored photo files:', e.message));
  }
}

// ---- HTML helpers (synchronous: they only use the image row) ----
const escAttr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function srcset(img) {
  return img.widths.split(',').map((w) => `${storage.url(`${img.key}/${w}.webp`)} ${w}w`).join(', ');
}
function src(img, prefer = 960) {
  const widths = img.widths.split(',').map(Number);
  const w = widths.find((x) => x >= prefer) || widths[widths.length - 1];
  return storage.url(`${img.key}/${w}.webp`);
}

/**
 * <img> tag with srcset, intrinsic size (no layout shift), dominant-color
 * background while loading, and lazy loading unless `priority` is set.
 */
function imgTag(img, { alt, sizes = '100vw', cls = '', priority = false } = {}) {
  if (!img) return '';
  const altText = alt ?? img.alt ?? '';
  return `<img src="${src(img)}" srcset="${srcset(img)}" sizes="${escAttr(sizes)}" width="${img.width}" height="${img.height}"`
    + ` alt="${escAttr(altText)}"${cls ? ` class="${escAttr(cls)}"` : ''}`
    + (priority ? ' fetchpriority="high" decoding="async"' : ' loading="lazy" decoding="async"')
    + (img.color ? ` style="background-color:${img.color}"` : '') + '>';
}

module.exports = {
  saveImage, saveUploads, cleanupTempFiles, getImage, getImages, purgeImages, fileKeys,
  imgTag, src, srcset, MAX_UPLOAD_BYTES,
};
