'use strict';
// Data access for birds, species, gallery, testimonials and FAQs.

const { get, all } = require('./db');
const { getImages, getImage } = require('./images');
const { slugify, ageGroup } = require('./helpers');

const STATUS_ORDER = `CASE b.status WHEN 'available' THEN 0 WHEN 'coming_soon' THEN 1 WHEN 'reserved' THEN 2 ELSE 3 END`;

const BIRD_SELECT = `
  SELECT b.*, s.name AS species_name, s.singular AS species_singular, s.slug AS species_slug, s.accent AS species_accent,
    (SELECT image_id FROM bird_photos p WHERE p.bird_id = b.id ORDER BY p.sort_order, p.image_id LIMIT 1) AS cover_id,
    (SELECT COUNT(*)::int FROM bird_photos p WHERE p.bird_id = b.id) AS photo_count
  FROM birds b LEFT JOIN species s ON s.id = b.species_id`;

function birdUrl(b) {
  return `/birds/${b.id}-${slugify([b.name, b.species_singular].filter(Boolean).join(' '))}`;
}

async function decorate(birds) {
  const imgs = await getImages(birds.map((b) => b.cover_id));
  for (const b of birds) {
    b.cover = imgs.get(b.cover_id) || null;
    b.url = birdUrl(b);
  }
  return birds;
}

/**
 * Public/admin bird listing with filters.
 * status: 'current' (default: everything except sold) | 'all' | a single status.
 */
async function listBirds(f = {}) {
  const where = [];
  const params = [];
  const status = f.status || 'current';
  if (status === 'current') where.push(`b.status != 'sold'`);
  else if (status !== 'all') { where.push('b.status = ?'); params.push(status); }
  if (f.species) { where.push('s.slug = ?'); params.push(f.species); }
  if (f.speciesId) { where.push('b.species_id = ?'); params.push(Number(f.speciesId)); }
  if (f.mutation) { where.push('lower(b.mutation) = lower(?)'); params.push(f.mutation); }
  if (f.sex) { where.push('b.sex = ?'); params.push(f.sex); }
  if (f.min !== undefined && f.min !== '' && !isNaN(f.min)) { where.push('b.price >= ?'); params.push(Number(f.min)); }
  if (f.max !== undefined && f.max !== '' && !isNaN(f.max)) { where.push('b.price <= ?'); params.push(Number(f.max)); }
  if (f.q) {
    where.push('(b.name ILIKE ? OR b.mutation ILIKE ? OR s.name ILIKE ? OR b.description ILIKE ?)');
    const like = `%${String(f.q).replace(/[%_\\]/g, '')}%`;
    params.push(like, like, like, like);
  }
  if (f.excludeId) { where.push('b.id != ?'); params.push(Number(f.excludeId)); }
  if (f.featuredOnly) where.push('b.featured = 1');

  let order = `${STATUS_ORDER}, b.featured DESC, b.created_at DESC, b.id DESC`;
  if (f.sort === 'price_asc') order = `b.price IS NULL, b.price ASC, ${STATUS_ORDER}`;
  if (f.sort === 'price_desc') order = `b.price IS NULL, b.price DESC, ${STATUS_ORDER}`;
  if (f.sort === 'newest') order = 'b.created_at DESC, b.id DESC';
  if (f.sort === 'updated') order = 'b.updated_at DESC, b.id DESC';

  let rows = await all(`${BIRD_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order}`, ...params);
  if (f.age) rows = rows.filter((b) => ageGroup(b) === f.age);
  if (f.limit) rows = rows.slice(0, f.limit);
  return decorate(rows);
}

async function getBird(id) {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0 || n > 2147483647) return null;
  const b = await get(`${BIRD_SELECT} WHERE b.id = ?`, n);
  if (!b) return null;
  await decorate([b]);
  b.photos = await birdPhotos(b.id);
  return b;
}

async function birdPhotos(birdId) {
  const rows = await all('SELECT image_id FROM bird_photos WHERE bird_id = ? ORDER BY sort_order, image_id', Number(birdId));
  const imgs = await getImages(rows.map((r) => r.image_id));
  return rows.map((r) => imgs.get(r.image_id)).filter(Boolean);
}

async function mutationOptions() {
  return (await all(`SELECT mutation FROM birds WHERE mutation != '' AND status != 'sold' GROUP BY mutation ORDER BY lower(mutation)`)).map((r) => r.mutation);
}
async function allMutations() {
  return (await all(`SELECT mutation FROM birds WHERE mutation != '' GROUP BY mutation ORDER BY lower(mutation)`)).map((r) => r.mutation);
}
async function priceBounds() {
  return get(`SELECT MIN(price) AS min, MAX(price) AS max FROM birds WHERE status != 'sold' AND price IS NOT NULL`);
}

// ---- species ----
async function listSpecies({ publishedOnly = true } = {}) {
  const rows = await all(`SELECT s.*,
      (SELECT COUNT(*)::int FROM birds b WHERE b.species_id = s.id AND b.status IN ('available','coming_soon')) AS open_count,
      (SELECT COUNT(*)::int FROM birds b WHERE b.species_id = s.id) AS bird_count,
      COALESCE(s.hero_image_id, (SELECT image_id FROM species_photos p WHERE p.species_id = s.id ORDER BY p.sort_order LIMIT 1)) AS cover_id
    FROM species s ${publishedOnly ? 'WHERE s.published = 1' : ''} ORDER BY s.sort_order, s.name`);
  const imgs = await getImages(rows.map((r) => r.cover_id));
  for (const s of rows) { s.cover = imgs.get(s.cover_id) || null; s.url = `/species/${s.slug}`; }
  return rows;
}

async function getSpecies(where, value) {
  if (where === 'id' && !(Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= 2147483647)) return null;
  const s = await get(`SELECT * FROM species WHERE ${where === 'id' ? 'id' : 'slug'} = ?`, where === 'id' ? Number(value) : String(value));
  if (!s) return null;
  s.hero = await getImage(s.hero_image_id);
  const rows = await all('SELECT image_id FROM species_photos WHERE species_id = ? ORDER BY sort_order, image_id', s.id);
  const imgs = await getImages(rows.map((r) => r.image_id));
  s.photos = rows.map((r) => imgs.get(r.image_id)).filter(Boolean);
  s.url = `/species/${s.slug}`;
  return s;
}

// ---- gallery ----
async function listGallery({ category, featuredOnly, limit } = {}) {
  const where = [];
  const params = [];
  if (category) { where.push('g.category = ?'); params.push(category); }
  if (featuredOnly) where.push('g.featured = 1');
  const rows = await all(`SELECT g.* FROM gallery g ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                  ORDER BY g.sort_order, g.id DESC ${limit ? 'LIMIT ' + Number(limit) : ''}`, ...params);
  const imgs = await getImages(rows.map((r) => r.image_id));
  rows.forEach((r) => { r.image = imgs.get(r.image_id); });
  return rows.filter((r) => r.image);
}

// ---- testimonials / faqs ----
async function listTestimonials({ publishedOnly = true, featuredOnly = false } = {}) {
  const where = [];
  if (publishedOnly) where.push('published = 1');
  if (featuredOnly) where.push('featured = 1');
  const rows = await all(`SELECT * FROM testimonials ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                    ORDER BY featured DESC, sort_order, review_date DESC, id DESC`);
  const imgs = await getImages(rows.map((r) => r.image_id));
  rows.forEach((r) => { r.image = imgs.get(r.image_id) || null; });
  return rows;
}

async function listFaqs({ publishedOnly = true } = {}) {
  return all(`SELECT * FROM faqs ${publishedOnly ? "WHERE published = 1 AND answer != ''" : ''} ORDER BY sort_order, id`);
}

module.exports = {
  listBirds, getBird, birdPhotos, birdUrl, mutationOptions, allMutations, priceBounds,
  listSpecies, getSpecies, listGallery, listTestimonials, listFaqs,
};
