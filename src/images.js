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
// Videos are stored as uploaded (no re-encoding). iPhone .mov files are served as MP4,
// which lets Chrome and Firefox play the usual H.264 ones.
const VIDEO_TYPES = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm' };
const VIDEO_CONTENT_TYPES = { mp4: 'video/mp4', mov: 'video/mp4', webm: 'video/webm' };

sharp.cache(false);
sharp.concurrency(1); // keep memory low on small servers

const videoKey = (img) => `${img.key}/video.${img.video}`;
const fileKeys = (img) => (img.video ? [videoKey(img)] : img.widths.split(',').map((w) => `${img.key}/${w}.webp`));
const newKey = () => crypto.randomBytes(9).toString('hex');

/** input: a Buffer or a path to a temporary upload file */
async function saveImage(input, alt = '') {
  const meta = await sharp(input, { failOn: 'error' }).metadata();
  if (!meta.width || !meta.height) throw new Error('That file does not look like a photo.');
  let { width, height } = meta;
  if (meta.orientation >= 5) [width, height] = [height, width];

  const outWidths = WIDTHS.filter((w) => w < width);
  outWidths.push(Math.min(width, WIDTHS[WIDTHS.length - 1]));
  const widths = [...new Set(outWidths)];

  const key = newKey();
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

/**
 * Step 1 of a direct video upload: pick a storage key and a URL the browser can PUT the file to.
 * Returns { error } when the file isn't an accepted video.
 */
async function startVideoUpload(type, bytes) {
  const ext = VIDEO_TYPES[type];
  if (!ext) return { error: 'Please choose an MP4, MOV or WebM video.' };
  if (!(bytes > 0) || bytes > MAX_UPLOAD_BYTES) return { error: 'Videos must be 20 MB or smaller.' };
  const key = newKey();
  const contentType = VIDEO_CONTENT_TYPES[ext];
  const fileKey = videoKey({ key, video: ext });
  return { key, ext, contentType, url: await storage.uploadUrl(fileKey, contentType, bytes) };
}

/** Save a video whose file is already in storage (uploaded directly by the browser). */
async function claimVideo(v, alt = '') {
  if (!/^[0-9a-f]{18}$/.test(String(v.key)) || !VIDEO_CONTENT_TYPES[v.ext]) throw new Error('could not be processed.');
  const bytes = await storage.size(videoKey({ key: v.key, video: v.ext }));
  if (!bytes) throw new Error('did not finish uploading. Please try again.');
  if (bytes > MAX_UPLOAD_BYTES) {
    await storage.remove([videoKey({ key: v.key, video: v.ext })]);
    throw new Error('is larger than 20 MB.');
  }
  // Size from the browser, used for layout before the video loads; 16:9 when unknown.
  const dim = (x, d) => { const n = Math.round(Number(x)); return n > 0 && n <= 10000 ? n : d; };
  const row = await get('INSERT INTO images (key, widths, width, height, color, alt, video) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
    v.key, '', dim(v.width, 1280), dim(v.height, 720), '#1c1c1a', String(alt).slice(0, 300), v.ext);
  return row.id;
}

/** A video that came through a normal form post (no JavaScript, or local development). */
async function saveVideoFile(f, alt) {
  const ext = VIDEO_TYPES[f.mimetype];
  const key = newKey();
  await storage.put(videoKey({ key, video: ext }), f.path ? await fs.promises.readFile(f.path) : f.buffer, VIDEO_CONTENT_TYPES[ext]);
  return claimVideo({ key, ext }, alt);
}

/**
 * Save several uploads; returns ids of the ones that worked plus error messages.
 * Entries are multer files (disk storage) or { video, originalname } for videos the browser
 * already uploaded to storage.
 */
async function saveUploads(files, alt = '') {
  const ids = [];
  const errors = [];
  for (const f of files || []) {
    if (f.video) {
      try { ids.push(await claimVideo(f.video, alt)); }
      catch (e) { console.error('Video upload failed:', e.message); errors.push(`${f.originalname}: ${e.message}`); }
      continue;
    }
    if (!f.size) continue;
    if (VIDEO_TYPES[f.mimetype]) {
      try { ids.push(await saveVideoFile(f, alt)); }
      catch (e) { console.error('Video upload failed:', e.message); errors.push(`${f.originalname}: could not be saved.`); }
      continue;
    }
    if (!ACCEPTED.test(f.mimetype)) { errors.push(`${f.originalname}: not a supported photo or video type.`); continue; }
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
  if (img.video) return '';
  return img.widths.split(',').map((w) => `${storage.url(`${img.key}/${w}.webp`)} ${w}w`).join(', ');
}
/** URL of a photo at about the given width, or of the video file. */
function src(img, prefer = 960) {
  if (img.video) return storage.url(videoKey(img));
  const widths = img.widths.split(',').map(Number);
  const w = widths.find((x) => x >= prefer) || widths[widths.length - 1];
  return storage.url(`${img.key}/${w}.webp`);
}

/**
 * <img> tag with srcset, intrinsic size (no layout shift), dominant-color
 * background while loading, and lazy loading unless `priority` is set.
 */
function imgTag(img, { alt, sizes = '100vw', cls = '', priority = false, controls = false } = {}) {
  if (!img) return '';
  const altText = alt ?? img.alt ?? '';
  if (img.video) return videoTag(img, altText, cls, priority, controls);
  return `<img src="${src(img)}" srcset="${srcset(img)}" sizes="${escAttr(sizes)}" width="${img.width}" height="${img.height}"`
    + ` alt="${escAttr(altText)}"${cls ? ` class="${escAttr(cls)}"` : ''}`
    + (priority ? ' fetchpriority="high" decoding="async"' : ' loading="lazy" decoding="async"')
    + (img.color ? ` style="background-color:${img.color}"` : '') + '>';
}

/**
 * <video> in place of a photo. Main (priority) videos play silently on a loop like a moving photo;
 * `controls` shows the player; otherwise it's a still of the first frame (e.g. inside a link that
 * opens the lightbox, which plays it).
 */
function videoTag(img, altText, cls, priority, controls) {
  const url = storage.url(videoKey(img));
  const mode = priority ? ' autoplay muted loop playsinline preload="auto"'
    : controls ? ' controls playsinline preload="metadata"'
      : ' muted playsinline preload="metadata" tabindex="-1"';
  return `<video src="${priority ? url : url + '#t=0.1'}" width="${img.width}" height="${img.height}"${mode}`
    + ` class="media-video${cls ? ' ' + escAttr(cls) : ''}"${altText ? ` aria-label="${escAttr(altText)}"` : ''}`
    + ` style="background-color:${img.color || '#1c1c1a'}"></video>`;
}

const isVideo = (img) => !!(img && img.video);

module.exports = {
  saveImage, saveUploads, startVideoUpload, cleanupTempFiles, getImage, getImages, purgeImages, fileKeys,
  imgTag, src, srcset, isVideo, MAX_UPLOAD_BYTES,
};
