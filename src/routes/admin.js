'use strict';
// Admin dashboard. Every route except /login requires a signed-in admin, and
// every POST is CSRF-checked. Admin pages are never indexed by search engines.

const os = require('os');
const express = require('express');
const multer = require('multer');
const { get, all, run, tx, marks } = require('../db');
const auth = require('../auth');
const images = require('../images');
const m = require('../models');
const h = require('../helpers');
const { PAGES, getSettings, saveSettings, invalidateSettings } = require('../settings');

const router = express.Router();
// Uploads go to temporary files (not memory) so large phone photos don't exhaust a small server.
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: images.MAX_UPLOAD_BYTES, files: 40 } });

const MESSAGES = {
  saved: 'Changes saved.',
  created: 'Added successfully.',
  deleted: 'Deleted.',
  duplicated: 'Copy created — you are now editing the copy.',
  uploaded: 'Photos uploaded.',
  status: 'Status updated.',
  password: 'Password changed.',
};

router.use((req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'no-store');
  res.locals.adminPath = req.path;
  res.locals.msg = MESSAGES[req.query.msg] || '';
  res.locals.err = typeof req.query.err === 'string' ? req.query.err.slice(0, 300) : '';
  next();
});

// Redirect with a message. The query string goes before any "#anchor" so the server can read it.
function back(res, url, msg, err) {
  const [path, hash] = url.split('#');
  const q = err ? 'err=' + encodeURIComponent(err) : 'msg=' + msg;
  res.redirect(303, path + (path.includes('?') ? '&' : '?') + q + (hash ? '#' + hash : ''));
}
// Trim, store line breaks consistently (browsers send Windows-style "\r\n"), and cap the length.
const clip = (x, n = 5000) => String(x ?? '').replace(/\r\n?/g, '\n').trim().slice(0, n);
// Whole numbers that fit a database id; anything else becomes null.
const int = (x) => { const n = parseInt(x, 10); return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null; };
const filesFor = (req, field) => (req.files || []).filter((f) => f.fieldname === field);

// ---------------- login ----------------
router.get('/login', async (req, res) => {
  if (req.admin) return res.redirect('/admin');
  const noAdmins = !(await get('SELECT COUNT(*)::int AS n FROM admin_users')).n;
  res.render('admin/login', { error: '', username: '', next: clip(req.query.next, 300), noAdmins });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const result = await auth.attemptLogin(clip(username, 100), String(password || ''), req.ip);
  const nextUrl = /^\/admin(\/|$)/.test(req.body.next || '') ? req.body.next : '/admin';
  if (result.error) {
    return res.status(401).render('admin/login', { error: result.error, username: clip(username, 100), next: nextUrl, noAdmins: false });
  }
  await auth.startSession(res, result.user.id);
  res.redirect(303, nextUrl);
});

// ---------------- everything below requires login ----------------
router.use(auth.requireAdmin);
router.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  // After any change, clear cached settings / menus, and remove temporary upload files.
  res.on('finish', () => {
    invalidateSettings();
    req.app.locals.invalidateSiteCache();
    images.cleanupTempFiles(req);
  });
  return req.is('multipart/form-data') ? upload.any()(req, res, next) : next();
});
router.use((req, res, next) => (req.method === 'POST' ? auth.verifyCsrf(req, res, next) : next()));
router.use(async (req, res, next) => {
  try {
    res.locals.unread = (await get('SELECT COUNT(*)::int AS n FROM inquiries WHERE is_read = 0')).n;
    next();
  } catch (e) { next(e); }
});

router.post('/logout', async (req, res) => {
  await auth.endSession(req, res);
  res.redirect(303, '/admin/login');
});

const statusCounts = async () => Object.fromEntries((await all('SELECT status, COUNT(*)::int AS n FROM birds GROUP BY status')).map((r) => [r.status, r.n]));

// ---------------- dashboard ----------------
router.get('/', async (req, res) => {
  const s = await getSettings();
  const [counts, unanswered, hasBird, hasSpeciesPhoto, hasGallery, inquiries, recent] = await Promise.all([
    statusCounts(),
    get("SELECT COUNT(*)::int AS n FROM faqs WHERE answer = '' OR published = 0"),
    get('SELECT 1 AS x FROM birds LIMIT 1'),
    get('SELECT 1 AS x FROM species WHERE hero_image_id IS NOT NULL LIMIT 1'),
    get('SELECT 1 AS x FROM gallery LIMIT 1'),
    all('SELECT * FROM inquiries ORDER BY id DESC LIMIT 5'),
    m.listBirds({ status: 'all', sort: 'updated', limit: 5 }),
  ]);
  const checklist = [
    { done: !!s.whatsapp_number, label: 'Add your WhatsApp number', href: '/admin/content/contact' },
    { done: !!s.contact_email, label: 'Add your email address', href: '/admin/content/contact' },
    { done: !!s.hero_image_id, label: 'Upload a main banner photo for the homepage', href: '/admin/content/home' },
    { done: !!s.about_image_id, label: 'Upload your photo for the "Meet Wasim" section', href: '/admin/content/about' },
    { done: !!hasBird, label: 'Add your first bird', href: '/admin/birds/new' },
    { done: !!hasSpeciesPhoto, label: 'Add photos to your species pages', href: '/admin/species' },
    { done: !!hasGallery, label: 'Upload photos to the gallery', href: '/admin/gallery' },
    { done: unanswered.n === 0, label: `Answer your FAQs (${unanswered.n} still hidden)`, href: '/admin/faqs' },
    { done: !!s.site_url, label: 'Enter your website address (for Google)', href: '/admin/content/settings' },
  ];
  res.render('admin/dashboard', { title: 'Dashboard', counts, checklist, inquiries, recent });
});

// ================= BIRDS =================
function birdFromBody(b) {
  const errors = [];
  const name = clip(b.name, 80);
  if (!name) errors.push('Please give the bird a name.');
  let price = null;
  const rawPrice = String(b.price ?? '').replace(/[$,\s]/g, '');
  if (rawPrice) {
    price = Number(rawPrice);
    // Keep what was typed so it's still visible next to the error message (nothing is saved on error).
    if (!Number.isFinite(price) || price < 0 || price > 1e8) { errors.push('Price should be a number, like 850.'); price = clip(b.price, 30); }
  }
  const hatch = clip(b.hatch_date, 10);
  return {
    errors,
    data: {
      name,
      species_id: int(b.species_id),
      mutation: clip(b.mutation, 120),
      sex: h.SEXES[b.sex] ? b.sex : 'unknown',
      age: clip(b.age, 60),
      age_group: h.AGE_GROUPS[b.age_group] ? b.age_group : 'baby',
      hatch_date: /^\d{4}-\d{2}-\d{2}$/.test(hatch) ? hatch : '',
      dna_status: clip(b.dna_status, 80),
      weaning_status: clip(b.weaning_status, 80),
      price,
      price_note: clip(b.price_note, 80),
      status: h.STATUSES[b.status] ? b.status : 'available',
      description: clip(b.description),
      personality: clip(b.personality),
      included_items: clip(b.included_items),
      pickup_info: clip(b.pickup_info),
      shipping_info: clip(b.shipping_info),
      featured: b.featured ? 1 : 0,
    },
  };
}
const BIRD_FIELDS = ['name', 'species_id', 'mutation', 'sex', 'age', 'age_group', 'hatch_date', 'dna_status', 'weaning_status',
  'price', 'price_note', 'status', 'description', 'personality', 'included_items', 'pickup_info', 'shipping_info', 'featured'];

async function birdFormLocals(extra) {
  const [species, mutations] = await Promise.all([m.listSpecies({ publishedOnly: false }), m.allMutations()]);
  return { species, mutations, ...extra };
}

router.get('/birds', async (req, res) => {
  const status = h.STATUSES[req.query.status] ? req.query.status : 'all';
  const q = clip(req.query.q, 80);
  const [birds, counts, total] = await Promise.all([
    m.listBirds({ status, q, sort: 'updated' }),
    statusCounts(),
    get('SELECT COUNT(*)::int AS n FROM birds'),
  ]);
  res.render('admin/birds', { title: 'Birds', birds, status, q, counts, total: total.n });
});

router.get('/birds/new', async (req, res) => {
  res.render('admin/bird-form', await birdFormLocals({
    title: 'Add a bird',
    bird: { status: 'available', sex: 'unknown', age_group: 'baby', species_id: int(req.query.species), photos: [] },
    errors: [],
  }));
});

router.post('/birds', async (req, res) => {
  const { errors, data } = birdFromBody(req.body);
  if (errors.length) {
    return res.status(422).render('admin/bird-form', await birdFormLocals({ title: 'Add a bird', bird: { ...data, photos: [] }, errors }));
  }
  const row = await get(`INSERT INTO birds (${BIRD_FIELDS.join(', ')}) VALUES (${marks(BIRD_FIELDS.length)}) RETURNING id`, ...BIRD_FIELDS.map((k) => data[k]));
  const { ids, errors: upErr } = await images.saveUploads(filesFor(req, 'photos'), data.name);
  await addPhotos('bird', row.id, ids);
  back(res, `/admin/birds/${row.id}`, 'created', upErr.join(' '));
});

router.get('/birds/:id', async (req, res, next) => {
  const bird = await m.getBird(int(req.params.id));
  if (!bird) return next();
  res.render('admin/bird-form', await birdFormLocals({ title: `Edit ${bird.name}`, bird, errors: [] }));
});

router.post('/birds/:id', async (req, res, next) => {
  const bird = await m.getBird(int(req.params.id));
  if (!bird) return next();
  const { errors, data } = birdFromBody(req.body);
  if (errors.length) {
    return res.status(422).render('admin/bird-form', await birdFormLocals({ title: `Edit ${bird.name}`, bird: { ...bird, ...data }, errors }));
  }
  await run(`UPDATE birds SET ${BIRD_FIELDS.map((k) => `${k} = ?`).join(', ')}, updated_at = now() WHERE id = ?`,
    ...BIRD_FIELDS.map((k) => data[k]), bird.id);
  back(res, req.body.return === 'list' ? '/admin/birds' : `/admin/birds/${bird.id}`, 'saved');
});

router.post('/birds/:id/status', async (req, res) => {
  const status = h.STATUSES[req.body.status] ? req.body.status : null;
  const id = int(req.params.id);
  if (status && id) await run('UPDATE birds SET status = ?, updated_at = now() WHERE id = ?', status, id);
  const ret = typeof req.body.return === 'string' && req.body.return.startsWith('/admin') ? req.body.return : '/admin/birds';
  back(res, ret, 'status');
});

router.post('/birds/:id/duplicate', async (req, res, next) => {
  const id = int(req.params.id);
  const src = id && await get('SELECT * FROM birds WHERE id = ?', id);
  if (!src) return next();
  const newId = await tx(async (q) => {
    const fields = BIRD_FIELDS.filter((k) => k !== 'name');
    const row = await q.get(`INSERT INTO birds (name, ${fields.join(', ')}) VALUES (?, ${marks(fields.length)}) RETURNING id`,
      `${src.name} (copy)`, ...fields.map((k) => (k === 'status' && src.status === 'sold' ? 'available' : src[k])));
    await q.run('INSERT INTO bird_photos (bird_id, image_id, sort_order) SELECT ?::int, image_id, sort_order FROM bird_photos WHERE bird_id = ?', row.id, src.id);
    return row.id;
  });
  back(res, `/admin/birds/${newId}`, 'duplicated');
});

router.post('/birds/:id/delete', async (req, res) => {
  const id = int(req.params.id);
  if (id) {
    const imgIds = (await all('SELECT image_id FROM bird_photos WHERE bird_id = ?', id)).map((r) => r.image_id);
    await run('DELETE FROM birds WHERE id = ?', id);
    await images.purgeImages(imgIds);
  }
  back(res, '/admin/birds', 'deleted');
});

// ================= PHOTO MANAGER (birds + species) =================
const PHOTO_TABLES = {
  bird: { table: 'bird_photos', key: 'bird_id', owner: 'birds', url: (id) => `/admin/birds/${id}` },
  species: { table: 'species_photos', key: 'species_id', owner: 'species', url: (id) => `/admin/species/${id}` },
};

async function addPhotos(kind, ownerId, ids) {
  if (!ids.length) return;
  const t = PHOTO_TABLES[kind];
  let next = (await get(`SELECT COALESCE(MAX(sort_order), 0)::int AS n FROM ${t.table} WHERE ${t.key} = ?`, ownerId)).n;
  for (const id of ids) {
    await run(`INSERT INTO ${t.table} (${t.key}, image_id, sort_order) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`, ownerId, id, ++next);
  }
  if (kind === 'bird') await run('UPDATE birds SET updated_at = now() WHERE id = ?', ownerId);
}

// Move one item up/down (works without JavaScript) or save a full order (drag & drop).
async function reorder(req, { table, idCol, scopeCol, scopeVal }) {
  const current = (await all(`SELECT ${idCol} AS id FROM ${table} ${scopeCol ? `WHERE ${scopeCol} = ?` : ''} ORDER BY sort_order, ${idCol}`,
    ...(scopeCol ? [scopeVal] : []))).map((r) => r.id);
  let ids = current;
  if (Array.isArray(req.body.ids)) {
    const wanted = req.body.ids.map(Number).filter((id) => current.includes(id));
    ids = [...wanted, ...current.filter((id) => !wanted.includes(id))];
  } else {
    const id = int(req.body.id);
    const i = current.indexOf(id);
    const dir = req.body.dir;
    if (i >= 0) {
      ids = current.slice();
      ids.splice(i, 1);
      const to = dir === 'first' ? 0 : dir === 'up' ? Math.max(0, i - 1) : dir === 'down' ? Math.min(ids.length, i + 1) : i;
      ids.splice(to, 0, id);
    }
  }
  await tx(async (q) => {
    for (const [i, id] of ids.entries()) {
      if (scopeCol) await q.run(`UPDATE ${table} SET sort_order = ? WHERE ${idCol} = ? AND ${scopeCol} = ?`, i + 1, id, scopeVal);
      else await q.run(`UPDATE ${table} SET sort_order = ? WHERE ${idCol} = ?`, i + 1, id);
    }
  });
}

for (const [kind, t] of Object.entries(PHOTO_TABLES)) {
  const base = kind === 'bird' ? '/birds' : '/species';
  router.post(`${base}/:id/photos`, async (req, res) => {
    const id = int(req.params.id);
    const owner = id && await get(`SELECT * FROM ${t.owner} WHERE id = ?`, id);
    if (!owner) return res.sendStatus(404);
    const { ids, errors } = await images.saveUploads(filesFor(req, 'photos'), owner.name);
    await addPhotos(kind, id, ids);
    back(res, t.url(id) + '#photos', 'uploaded', errors.join(' '));
  });
  router.post(`${base}/:id/photos/order`, async (req, res) => {
    const id = int(req.params.id);
    if (id) await reorder(req, { table: t.table, idCol: 'image_id', scopeCol: t.key, scopeVal: id });
    if (req.is('application/json')) return res.json({ ok: true });
    back(res, t.url(id) + '#photos', 'saved');
  });
  router.post(`${base}/:id/photos/:imageId/delete`, async (req, res) => {
    const id = int(req.params.id);
    const imageId = int(req.params.imageId);
    if (id && imageId) {
      await run(`DELETE FROM ${t.table} WHERE ${t.key} = ? AND image_id = ?`, id, imageId);
      await images.purgeImages([imageId]);
    }
    back(res, t.url(id) + '#photos', 'deleted');
  });
}

// ================= SPECIES =================
const SPECIES_TEXT = ['name', 'singular', 'scientific_name', 'tagline', 'overview', 'personality', 'characteristics',
  'care', 'size', 'lifespan', 'noise_level', 'diet', 'socialization', 'accent'];
const SPECIES_COLS = [...SPECIES_TEXT, 'published', 'hero_image_id'];

router.get('/species', async (req, res) => {
  res.render('admin/species', { title: 'Species', species: await m.listSpecies({ publishedOnly: false }) });
});
router.post('/species/order', async (req, res) => {
  await reorder(req, { table: 'species', idCol: 'id' });
  if (req.is('application/json')) return res.json({ ok: true });
  back(res, '/admin/species', 'saved');
});
router.get('/species/new', (req, res) => {
  res.render('admin/species-form', { title: 'Add a species', sp: { published: 1, accent: '#6f8f5e', photos: [] }, errors: [] });
});

async function speciesFromReq(req, existing) {
  const b = req.body;
  const data = {};
  for (const k of SPECIES_TEXT) data[k] = clip(b[k], k === 'name' ? 80 : 6000);
  if (!/^#[0-9a-f]{6}$/i.test(data.accent)) data.accent = '#6f8f5e';
  data.published = b.published ? 1 : 0;
  const errors = data.name ? [] : ['Please enter the species name.'];
  let heroId = existing ? existing.hero_image_id : null;
  const heroFile = filesFor(req, 'hero');
  if (heroFile.length && data.name) {
    const r = await images.saveUploads(heroFile, data.singular || data.name);
    if (r.ids[0]) heroId = r.ids[0];
    errors.push(...r.errors);
  } else if (b.remove_hero) heroId = null;
  data.hero_image_id = heroId;
  return { data, errors };
}

router.post('/species', async (req, res) => {
  const { data, errors } = await speciesFromReq(req, null);
  if (!data.name) return res.status(422).render('admin/species-form', { title: 'Add a species', sp: { ...data, photos: [] }, errors });
  let slug = h.slugify(data.name);
  for (let i = 2; await get('SELECT 1 AS x FROM species WHERE slug = ?', slug); i++) slug = `${h.slugify(data.name)}-${i}`;
  const row = await get(`INSERT INTO species (slug, ${SPECIES_COLS.join(', ')}, sort_order)
    VALUES (?, ${marks(SPECIES_COLS.length)}, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM species)) RETURNING id`,
  slug, ...SPECIES_COLS.map((k) => data[k]));
  back(res, `/admin/species/${row.id}`, 'created', errors.join(' '));
});

router.get('/species/:id', async (req, res, next) => {
  const sp = await m.getSpecies('id', int(req.params.id));
  if (!sp) return next();
  res.render('admin/species-form', { title: `Edit ${sp.name}`, sp, errors: [] });
});

router.post('/species/:id', async (req, res, next) => {
  const id = int(req.params.id);
  const existing = id && await get('SELECT * FROM species WHERE id = ?', id);
  if (!existing) return next();
  const { data, errors } = await speciesFromReq(req, existing);
  if (!data.name) return res.status(422).render('admin/species-form', { title: `Edit ${existing.name}`, sp: { ...existing, ...data, photos: [] }, errors });
  await run(`UPDATE species SET ${SPECIES_COLS.map((k) => `${k} = ?`).join(', ')}, updated_at = now() WHERE id = ?`, ...SPECIES_COLS.map((k) => data[k]), existing.id);
  if (existing.hero_image_id !== data.hero_image_id) await images.purgeImages([existing.hero_image_id]);
  back(res, `/admin/species/${existing.id}`, 'saved', errors.join(' '));
});

router.post('/species/:id/delete', async (req, res) => {
  const id = int(req.params.id);
  if (!id) return back(res, '/admin/species', 'deleted');
  const n = (await get('SELECT COUNT(*)::int AS n FROM birds WHERE species_id = ?', id)).n;
  if (n) return back(res, `/admin/species/${id}`, '', `This species still has ${n} bird${n === 1 ? '' : 's'}. Move or delete them first, or simply hide the species.`);
  const sp = await get('SELECT hero_image_id FROM species WHERE id = ?', id);
  const imgIds = (await all('SELECT image_id FROM species_photos WHERE species_id = ?', id)).map((r) => r.image_id);
  await run('DELETE FROM species WHERE id = ?', id);
  await images.purgeImages([...imgIds, sp && sp.hero_image_id]);
  back(res, '/admin/species', 'deleted');
});

// ================= GALLERY =================
const galleryReturn = (req) => '/admin/gallery' + (req.body.return_category ? '?category=' + encodeURIComponent(req.body.return_category) : '');

router.get('/gallery', async (req, res) => {
  const s = await getSettings();
  const category = s.galleryCategories.includes(req.query.category) ? req.query.category : '';
  const [items, total] = await Promise.all([m.listGallery({ category }), get('SELECT COUNT(*)::int AS n FROM gallery')]);
  res.render('admin/gallery', { title: 'Gallery', items, category, categories: s.galleryCategories, total: total.n });
});

router.post('/gallery/upload', async (req, res) => {
  const category = clip(req.body.category, 80);
  const caption = clip(req.body.caption, 200);
  const { ids, errors } = await images.saveUploads(filesFor(req, 'photos'), caption);
  if (ids.length) {
    await tx(async (q) => {
      await q.run('UPDATE gallery SET sort_order = sort_order + ?', ids.length);
      for (const [i, id] of ids.entries()) {
        await q.run('INSERT INTO gallery (image_id, caption, category, featured, sort_order) VALUES (?, ?, ?, ?, ?)',
          id, caption, category, req.body.featured ? 1 : 0, i + 1);
      }
    });
  }
  back(res, galleryReturn(req), 'uploaded', errors.join(' '));
});

router.post('/gallery/save', async (req, res) => {
  const items = req.body.items && typeof req.body.items === 'object' ? req.body.items : {};
  await tx(async (q) => {
    // Field names are items[g<id>][...] — the 'g' prefix stops the form parser from
    // treating small ids as array positions (which would shift edits onto the wrong photo).
    for (const [key, v] of Object.entries(items)) {
      const id = /^g\d+$/.test(key) ? int(key.slice(1)) : null;
      if (!id || !v || typeof v !== 'object') continue;
      const caption = clip(v.caption, 200);
      await q.run('UPDATE gallery SET caption = ?, category = ?, featured = ? WHERE id = ?', caption, clip(v.category, 80), v.featured ? 1 : 0, id);
      await q.run('UPDATE images SET alt = ? WHERE id = (SELECT image_id FROM gallery WHERE id = ?)', caption, id);
    }
  });
  back(res, galleryReturn(req), 'saved');
});

router.post('/gallery/order', async (req, res) => {
  await reorder(req, { table: 'gallery', idCol: 'id' });
  if (req.is('application/json')) return res.json({ ok: true });
  back(res, '/admin/gallery', 'saved');
});

router.post('/gallery/:id/delete', async (req, res) => {
  const id = int(req.params.id);
  const row = id && await get('SELECT image_id FROM gallery WHERE id = ?', id);
  if (row) {
    await run('DELETE FROM gallery WHERE id = ?', id);
    await images.purgeImages([row.image_id]);
  }
  if (req.is('application/json')) return res.json({ ok: true });
  back(res, galleryReturn(req), 'deleted');
});

// ================= TESTIMONIALS =================
router.get('/testimonials', async (req, res) => {
  res.render('admin/testimonials', { title: 'Testimonials', items: await m.listTestimonials({ publishedOnly: false }) });
});
router.get('/testimonials/new', (req, res) => {
  res.render('admin/testimonial-form', { title: 'Add a testimonial', t: { published: 1 }, errors: [] });
});
router.get('/testimonials/:id', async (req, res, next) => {
  const id = int(req.params.id);
  const t = id && await get('SELECT * FROM testimonials WHERE id = ?', id);
  if (!t) return next();
  t.image = await images.getImage(t.image_id);
  res.render('admin/testimonial-form', { title: 'Edit testimonial', t, errors: [] });
});

async function saveTestimonial(req, res, existing) {
  const b = req.body;
  const data = {
    name: clip(b.name, 100),
    review: clip(b.review, 3000),
    review_date: /^\d{4}-\d{2}-\d{2}$/.test(b.review_date || '') ? b.review_date : '',
    location: clip(b.location, 100),
    featured: b.featured ? 1 : 0,
    published: b.published ? 1 : 0,
    image_id: existing ? existing.image_id : null,
  };
  const errors = [];
  if (!data.name) errors.push("Please enter the customer's name.");
  if (!data.review) errors.push('Please enter the review text.');
  if (errors.length) return res.status(422).render('admin/testimonial-form', { title: 'Testimonial', t: { ...existing, ...data }, errors });
  const photo = filesFor(req, 'photo');
  if (photo.length) {
    const r = await images.saveUploads(photo, `${data.name} with their bird`);
    if (r.ids[0]) data.image_id = r.ids[0];
  } else if (b.remove_photo) data.image_id = null;
  const cols = Object.keys(data);
  if (existing) {
    await run(`UPDATE testimonials SET ${cols.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...cols.map((k) => data[k]), existing.id);
    if (existing.image_id !== data.image_id) await images.purgeImages([existing.image_id]);
  } else {
    await run(`INSERT INTO testimonials (${cols.join(', ')}) VALUES (${marks(cols.length)})`, ...cols.map((k) => data[k]));
  }
  back(res, '/admin/testimonials', existing ? 'saved' : 'created');
}
router.post('/testimonials', (req, res) => saveTestimonial(req, res, null));
router.post('/testimonials/:id', async (req, res, next) => {
  const id = int(req.params.id);
  const t = id && await get('SELECT * FROM testimonials WHERE id = ?', id);
  return t ? saveTestimonial(req, res, t) : next();
});
router.post('/testimonials/:id/delete', async (req, res) => {
  const id = int(req.params.id);
  const t = id && await get('SELECT image_id FROM testimonials WHERE id = ?', id);
  if (t) {
    await run('DELETE FROM testimonials WHERE id = ?', id);
    await images.purgeImages([t.image_id]);
  }
  back(res, '/admin/testimonials', 'deleted');
});

// ================= FAQS =================
router.get('/faqs', async (req, res) => {
  res.render('admin/faqs', { title: 'FAQs', faqs: await m.listFaqs({ publishedOnly: false }) });
});
router.post('/faqs/order', async (req, res) => {
  await reorder(req, { table: 'faqs', idCol: 'id' });
  if (req.is('application/json')) return res.json({ ok: true });
  back(res, '/admin/faqs', 'saved');
});
router.get('/faqs/new', (req, res) => res.render('admin/faq-form', { title: 'Add a question', faq: { published: 1 }, errors: [] }));
router.get('/faqs/:id', async (req, res, next) => {
  const id = int(req.params.id);
  const faq = id && await get('SELECT * FROM faqs WHERE id = ?', id);
  if (!faq) return next();
  res.render('admin/faq-form', { title: 'Edit question', faq, errors: [] });
});
async function saveFaq(req, res, existing) {
  const data = { question: clip(req.body.question, 300), answer: clip(req.body.answer, 5000), published: req.body.published ? 1 : 0 };
  if (!data.question) return res.status(422).render('admin/faq-form', { title: 'Question', faq: { ...existing, ...data }, errors: ['Please enter the question.'] });
  if (existing) await run('UPDATE faqs SET question = ?, answer = ?, published = ? WHERE id = ?', data.question, data.answer, data.published, existing.id);
  else await run('INSERT INTO faqs (question, answer, published, sort_order) VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM faqs))', data.question, data.answer, data.published);
  back(res, '/admin/faqs', existing ? 'saved' : 'created');
}
router.post('/faqs', (req, res) => saveFaq(req, res, null));
router.post('/faqs/:id', async (req, res, next) => {
  const id = int(req.params.id);
  const faq = id && await get('SELECT * FROM faqs WHERE id = ?', id);
  return faq ? saveFaq(req, res, faq) : next();
});
router.post('/faqs/:id/delete', async (req, res) => {
  const id = int(req.params.id);
  if (id) await run('DELETE FROM faqs WHERE id = ?', id);
  back(res, '/admin/faqs', 'deleted');
});

// ================= CONTENT / SETTINGS PAGES =================
router.get('/content/:page', async (req, res, next) => {
  const page = Object.hasOwn(PAGES, req.params.page) ? PAGES[req.params.page] : null;
  if (!page) return next();
  const s = await getSettings();
  const imgs = {};
  for (const g of page.groups) for (const f of g.fields) if (f.type === 'image') imgs[f.key] = await images.getImage(s[f.key]);
  res.render('admin/settings-form', { title: page.title, page, pageKey: req.params.page, values: s, imgs });
});

router.post('/content/:page', async (req, res, next) => {
  const page = Object.hasOwn(PAGES, req.params.page) ? PAGES[req.params.page] : null;
  if (!page) return next();
  const s = await getSettings();
  const values = {};
  const oldImages = [];
  const errors = [];
  for (const g of page.groups) {
    for (const f of g.fields) {
      if (f.type === 'checkbox') values[f.key] = req.body[f.key] ? '1' : '0';
      else if (f.type === 'image') {
        const file = filesFor(req, f.key);
        if (file.length) {
          const r = await images.saveUploads(file, '');
          if (r.ids[0]) { values[f.key] = String(r.ids[0]); oldImages.push(s[f.key]); }
          errors.push(...r.errors);
        } else if (req.body['remove_' + f.key]) { values[f.key] = ''; oldImages.push(s[f.key]); }
        if (req.body['alt_' + f.key] !== undefined) {
          const id = int(values[f.key] ?? s[f.key]);
          if (id) await run('UPDATE images SET alt = ? WHERE id = ?', clip(req.body['alt_' + f.key], 300), id);
        }
      } else {
        if (!(f.key in req.body)) continue; // only change fields that were actually submitted
        let v = clip(req.body[f.key], 6000);
        if (f.type === 'url' && v && !/^https?:\/\//i.test(v)) v = 'https://' + v;
        values[f.key] = v;
      }
    }
  }
  await saveSettings(values);
  await images.purgeImages(oldImages);
  back(res, `/admin/content/${req.params.page}`, 'saved', errors.join(' '));
});

// ================= INQUIRIES =================
router.get('/inquiries', async (req, res) => {
  res.render('admin/inquiries', { title: 'Messages', items: await all('SELECT * FROM inquiries ORDER BY id DESC LIMIT 500') });
});
router.get('/inquiries/:id', async (req, res, next) => {
  const id = int(req.params.id);
  const q = id && await get('SELECT * FROM inquiries WHERE id = ?', id);
  if (!q) return next();
  if (!q.is_read) {
    await run('UPDATE inquiries SET is_read = 1 WHERE id = ?', q.id);
    res.locals.unread = Math.max(0, res.locals.unread - 1);
  }
  const s = await getSettings();
  const replyWa = q.whatsapp ? `https://wa.me/${h.waDigits(q.whatsapp)}` : '';
  const replyMail = `mailto:${q.email}?subject=${encodeURIComponent('Re: your message to ' + s.site_name)}`;
  res.render('admin/inquiry', { title: `Message from ${q.name}`, q, replyWa, replyMail });
});
router.post('/inquiries/:id/unread', async (req, res) => {
  const id = int(req.params.id);
  if (id) await run('UPDATE inquiries SET is_read = 0 WHERE id = ?', id);
  back(res, '/admin/inquiries', 'saved');
});
router.post('/inquiries/:id/delete', async (req, res) => {
  const id = int(req.params.id);
  if (id) await run('DELETE FROM inquiries WHERE id = ?', id);
  back(res, '/admin/inquiries', 'deleted');
});

// ================= ACCOUNT =================
router.get('/account', (req, res) => res.render('admin/account', { title: 'Your account', errors: [] }));
router.post('/account/password', async (req, res) => {
  const { current, password, confirm } = req.body;
  const user = await get('SELECT * FROM admin_users WHERE id = ?', req.admin.id);
  const errors = [];
  if (!(await require('bcryptjs').compare(String(current || ''), user.password_hash))) errors.push('Your current password is not correct.');
  if (String(password || '').length < 10) errors.push('The new password must be at least 10 characters long.');
  if (password !== confirm) errors.push('The two new passwords do not match.');
  if (errors.length) return res.status(422).render('admin/account', { title: 'Your account', errors });
  await run('UPDATE admin_users SET password_hash = ? WHERE id = ?', await auth.hashPassword(password), user.id);
  // Sign out every other session.
  await run('DELETE FROM sessions WHERE user_id = ? AND id != ?', user.id, req.sessionId);
  back(res, '/admin/account', 'password');
});

router.use((req, res) => res.status(404).render('admin/not-found', { title: 'Not found' }));

module.exports = router;
