'use strict';
require('./src/load-env');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');

const db = require('./src/db');
const storage = require('./src/storage');
const { getSettings } = require('./src/settings');
const { loadSession } = require('./src/auth');
const { imgTag, src: imgSrc, srcset: imgSrcset, getImage } = require('./src/images');
const h = require('./src/helpers');

const IS_PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;
const ASSET_VERSION = Date.now().toString(36);

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

// Render (and uptime monitors) use this to check the app is running. No database access.
app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

const photoOrigin = storage.publicOrigin();
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      // The hash allows only the one-line inline script that sets <html class="js">.
      scriptSrc: ["'self'", "'sha256-PtdI6/36DhPdMEgjNWV5ExIEqFovVcjUHPeOyApfBhs='"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', ...(photoOrigin ? [photoOrigin] : [])],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      ...(IS_PROD ? { upgradeInsecureRequests: [] } : {}),
    },
  },
  strictTransportSecurity: IS_PROD,
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());

// Static files. Uploaded images get unique paths, so they can be cached "forever".
const YEAR = 365 * 24 * 3600 * 1000;
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: IS_PROD ? '7d' : 0 }));
if (!storage.USING_R2) app.use('/uploads', express.static(db.UPLOAD_DIR, { maxAge: YEAR, immutable: true, index: false }));
for (const font of ['fraunces', 'dm-sans']) {
  app.use(`/fonts/${font}`, express.static(path.join(__dirname, 'node_modules', '@fontsource-variable', font, 'files'), { maxAge: YEAR, immutable: true }));
}

app.use(express.urlencoded({ extended: true, limit: '2mb', parameterLimit: 5000 }));
app.use(express.json({ limit: '200kb' }));
app.use(loadSession);

// Data shown on every page (species menu, default share image) — cached until the admin saves anything.
let siteCache = null;
async function siteData() {
  if (!siteCache) {
    const settings = await getSettings();
    siteCache = {
      navSpecies: await db.all('SELECT name, slug FROM species WHERE published = 1 ORDER BY sort_order, name'),
      defaultOgImage: await getImage(settings.og_image_id || settings.hero_image_id),
    };
  }
  return siteCache;
}
app.locals.invalidateSiteCache = () => { siteCache = null; };

// Values available to every template.
app.use(async (req, res, next) => {
  try {
    const settings = await getSettings();
    const site = await siteData();
    const siteUrl = (settings.site_url || process.env.SITE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    Object.assign(res.locals, h, site, {
      settings,
      siteUrl,
      currentPath: req.path,
      admin: req.admin || null,
      csrfToken: req.csrfToken || '',
      assetVersion: ASSET_VERSION,
      imgTag,
      imgSrc,
      imgSrcset,
      wa: h.waLink(settings),
      mail: h.mailLink(settings, 'Question about your birds'),
      year: new Date().getFullYear(),
      jsonLd: (obj) => JSON.stringify(obj).replace(/</g, '\\u003c'),
    });
    next();
  } catch (e) { next(e); }
});

app.use('/admin', require('./src/routes/admin'));
app.use('/', require('./src/routes/public'));

app.use((req, res) => {
  res.status(404).render('error', { status: 404, seo: { title: 'Page not found | ' + res.locals.settings.site_name, noindex: true } });
});
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).send('That photo is too large. Please use photos under 20 MB.');
  console.error(err);
  const status = err.status || err.statusCode || 500;
  if (!res.locals.settings) return res.status(status).type('text/plain').send('Something went wrong. Please try again in a moment.');
  res.status(status).render('error', { status, seo: { title: 'Something went wrong', noindex: true } });
});

async function start() {
  const kind = await db.init();
  console.log(`Database: ${kind === 'postgres' ? 'Postgres (DATABASE_URL)' : 'local PGlite in ' + db.DATA_DIR}`);
  console.log(`Photos:   ${storage.USING_R2 ? 'Cloudflare R2 bucket "' + process.env.R2_BUCKET + '"' : 'local folder ' + db.UPLOAD_DIR}`);
  const problem = await storage.check();
  if (problem) console.warn('WARNING: ' + problem);
  if (IS_PROD && !db.USING_PG) console.warn('WARNING: DATABASE_URL is not set. On Render, all content will be lost on every restart.');
  if (IS_PROD && !storage.USING_R2) console.warn('WARNING: R2 is not configured. On Render, uploaded photos will be lost on every restart.');
  app.listen(PORT, () => console.log(`Texas Wings & Tails running at http://localhost:${PORT}`));
}

if (require.main === module) {
  start().catch((e) => {
    console.error('Could not start:', e.message);
    if (/password authentication|ENOTFOUND|ECONNREFUSED|getaddrinfo/i.test(e.message)) {
      console.error('Check DATABASE_URL — copy the connection string from your Neon dashboard.');
    }
    process.exit(1);
  });
}
module.exports = { app, start };
