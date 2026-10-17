'use strict';
const express = require('express');
const { run } = require('../db');
const { getImage, src: imgSrc } = require('../images');
const { formToken, checkFormToken } = require('../auth');
const { notifyInquiry } = require('../mailer');
const throttle = require('../throttle');
const m = require('../models');
const h = require('../helpers');

const router = express.Router();

// ---------- shared bits ----------
async function orgLd(res) {
  const { settings: s, siteUrl } = res.locals;
  const hero = await getImage(s.og_image_id || s.hero_image_id);
  const sameAs = [s.instagram_url, s.facebook_url, s.tiktok_url, s.youtube_url].filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': siteUrl + '/#business',
    name: s.site_name,
    description: s.seo_description,
    url: siteUrl + '/',
    logo: siteUrl + '/static/img/brand/icon-512.png',
    image: hero ? h.absUrl(siteUrl, imgSrc(hero, 1600)) : siteUrl + '/static/img/brand/og-default.png',
    ...(s.contact_email ? { email: s.contact_email } : {}),
    ...(s.phone ? { telephone: s.phone } : {}),
    address: { '@type': 'PostalAddress', addressLocality: 'Dallas', addressRegion: 'TX', addressCountry: 'US' },
    areaServed: [{ '@type': 'City', name: 'Dallas' }, { '@type': 'State', name: 'Texas' }],
    founder: { '@type': 'Person', name: 'Wasim' },
    ...(sameAs.length ? { sameAs } : {}),
  };
}

function breadcrumbLd(res, items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(([name, path], i) => ({ '@type': 'ListItem', position: i + 1, name, item: res.locals.siteUrl + path })),
  };
}

async function contactForm(values = {}, errors = {}) {
  const [species, birds] = await Promise.all([m.listSpecies(), m.listBirds({ status: 'current' })]);
  return { values, errors, token: formToken(), species, birds: birds.filter((b) => b.status !== 'reserved') };
}

// ---------- pages ----------
router.get('/', async (req, res) => {
  const s = res.locals.settings;
  const [heroImage, aboutImage, birds, available, species, featuredGallery, featuredReviews, faqs, cf, org] = await Promise.all([
    getImage(s.hero_image_id),
    getImage(s.about_image_id),
    m.listBirds({ status: 'current', limit: 6 }),
    m.listBirds({ status: 'available' }),
    m.listSpecies(),
    m.listGallery({ featuredOnly: true, limit: 8 }),
    m.listTestimonials({ featuredOnly: true }),
    m.listFaqs(),
    contactForm(),
    orgLd(res),
  ]);
  const gallery = featuredGallery.length ? featuredGallery : await m.listGallery({ limit: 8 });
  const testimonials = featuredReviews.length ? featuredReviews : await m.listTestimonials();
  res.render('home', {
    heroImage,
    aboutImage,
    birds,
    openCount: available.length,
    species,
    gallery,
    testimonials: testimonials.slice(0, 3),
    faqs: faqs.slice(0, 5),
    cf,
    seo: {
      title: `${s.site_name} | Parrot Breeder in Dallas, Texas`,
      description: s.seo_description,
      path: '/',
      image: heroImage,
      preload: heroImage,
      jsonLd: [org, { '@context': 'https://schema.org', '@type': 'WebSite', name: s.site_name, url: res.locals.siteUrl + '/' }],
    },
    editLink: '/admin/content/home',
  });
});

const FILTER_KEYS = ['q', 'species', 'mutation', 'sex', 'age', 'status', 'min', 'max', 'sort'];
router.get('/birds', async (req, res) => {
  const s = res.locals.settings;
  const f = {};
  for (const k of FILTER_KEYS) {
    const v = typeof req.query[k] === 'string' ? req.query[k].trim().slice(0, 80) : '';
    if (v) f[k] = v;
  }
  if (f.status && !['current', 'all', ...Object.keys(h.STATUSES)].includes(f.status)) delete f.status;
  for (const k of ['min', 'max']) if (f[k] && !(Number(f[k]) >= 0 && Number(f[k]) < 1e9)) delete f[k];
  const [birds, species, mutations, bounds] = await Promise.all([m.listBirds(f), m.listSpecies(), m.mutationOptions(), m.priceBounds()]);
  const activeSpecies = species.find((x) => x.slug === f.species);
  const filtered = FILTER_KEYS.some((k) => k !== 'sort' && f[k] && !(k === 'status' && f[k] === 'current'));
  const title = activeSpecies ? `${activeSpecies.name} for Sale in Dallas, TX` : 'Available Parrots for Sale in Dallas, TX';
  res.render('birds', {
    birds,
    f,
    filtered,
    species,
    mutations,
    bounds,
    seo: {
      title: `${title} | ${s.site_name}`,
      description: activeSpecies
        ? `See ${activeSpecies.name.toLowerCase()} currently available from ${s.site_name}, a companion parrot aviary in Dallas, Texas.`
        : `Browse companion parrots currently available from ${s.site_name} in Dallas, Texas — Quakers, caiques, ringnecks, green cheek conures, kakarikis and Senegals.`,
      path: activeSpecies ? `/birds?species=${activeSpecies.slug}` : '/birds',
      noindex: filtered && !(Object.keys(f).length === 1 && f.species),
      jsonLd: [breadcrumbLd(res, [['Home', '/'], ['Available Birds', '/birds']])],
    },
    editLink: '/admin/birds',
  });
});

router.get('/birds/:idslug', async (req, res, next) => {
  const bird = await m.getBird(parseInt(req.params.idslug, 10));
  if (!bird) return next();
  if (req.path !== bird.url) return res.redirect(301, bird.url);
  const s = res.locals.settings;
  const siteUrl = res.locals.siteUrl;
  const related = bird.species_id ? await m.listBirds({ speciesId: bird.species_id, excludeId: bird.id, limit: 3 }) : [];
  const fullName = [bird.name, bird.mutation, bird.species_singular].filter(Boolean).join(' – ');
  const availability = { available: 'InStock', coming_soon: 'PreOrder', reserved: 'LimitedAvailability', sold: 'SoldOut' }[bird.status];
  const productLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: [bird.name, bird.species_singular].filter(Boolean).join(', '),
    description: h.excerpt(bird.description || `${bird.name} is a ${bird.mutation} ${bird.species_singular} raised in Dallas, Texas.`, 300),
    category: bird.species_name || 'Companion bird',
    ...(bird.photos.length ? { image: bird.photos.slice(0, 4).map((p) => h.absUrl(siteUrl, imgSrc(p, 1600))) } : {}),
    brand: { '@type': 'Brand', name: s.site_name },
    ...(bird.price !== null && s.show_prices === '1' ? {
      offers: {
        '@type': 'Offer',
        price: bird.price,
        priceCurrency: 'USD',
        availability: 'https://schema.org/' + availability,
        url: siteUrl + bird.url,
        seller: { '@id': siteUrl + '/#business' },
      },
    } : {}),
  };
  const waMsg = `Hi Wasim, I'm interested in ${bird.name}${bird.species_singular ? ` (${bird.species_singular})` : ''} from your website: ${siteUrl}${bird.url}`;
  res.render('bird', {
    bird,
    related,
    birdWa: h.waLink(s, waMsg),
    birdMail: h.mailLink(s, `Question about ${bird.name}`, `Hi Wasim,\n\nI'm interested in ${bird.name}${bird.species_singular ? ` (${bird.species_singular})` : ''}.\n${siteUrl}${bird.url}\n\n`),
    seo: {
      title: `${fullName} | ${s.site_name}, Dallas`,
      description: h.excerpt(`${h.STATUSES[bird.status]}: ${bird.name}, ${[bird.mutation, bird.species_singular].filter(Boolean).join(' ')} from ${s.site_name} in Dallas, Texas. ${bird.description}`, 158),
      path: bird.url,
      image: bird.photos[0],
      preload: bird.photos[0],
      preloadSizes: '(min-width: 1000px) 620px, 100vw',
      type: 'product',
      jsonLd: [productLd, breadcrumbLd(res, [['Home', '/'], ['Available Birds', '/birds'], [bird.name, bird.url]])],
    },
    editLink: `/admin/birds/${bird.id}`,
  });
});

router.get('/species', async (req, res) => {
  const s = res.locals.settings;
  res.render('species-index', {
    species: await m.listSpecies(),
    seo: {
      title: `Our Birds: Quakers, Caiques, Ringnecks & More | ${s.site_name}`,
      description: `The companion parrot species raised by ${s.site_name} in Dallas, Texas: Quaker parrots, caiques, Indian ringnecks, green cheek conures, kakarikis and Senegal parrots.`,
      path: '/species',
      jsonLd: [breadcrumbLd(res, [['Home', '/'], ['Our Birds', '/species']])],
    },
    editLink: '/admin/species',
  });
});

router.get('/species/:slug', async (req, res, next) => {
  const sp = await m.getSpecies('slug', req.params.slug);
  if (!sp || (!sp.published && !req.admin)) return next();
  const s = res.locals.settings;
  const hero = sp.hero || sp.photos[0] || null;
  const [birds, all] = await Promise.all([m.listBirds({ speciesId: sp.id }), m.listSpecies()]);
  res.render('species', {
    sp,
    hero,
    birds,
    others: all.filter((x) => x.id !== sp.id),
    seo: {
      title: `${sp.name} in Dallas, Texas | ${s.site_name}`,
      description: h.excerpt(`${sp.name} raised by ${s.site_name}, a Dallas, Texas aviary. ${sp.overview}`, 158),
      path: sp.url,
      image: hero,
      preload: hero,
      jsonLd: [breadcrumbLd(res, [['Home', '/'], ['Our Birds', '/species'], [sp.name, sp.url]])],
    },
    editLink: `/admin/species/${sp.id}`,
  });
});

router.get('/gallery', async (req, res) => {
  const s = res.locals.settings;
  const category = s.galleryCategories.includes(req.query.category) ? req.query.category : '';
  const items = await m.listGallery({ category });
  res.render('gallery', {
    items,
    category,
    seo: {
      title: `${category ? category + ' — ' : ''}Photo Gallery | ${s.site_name}, Dallas Aviary`,
      description: `Photos of the companion parrots raised at ${s.site_name} in Dallas, Texas — babies, adult birds, the aviary and happy families.`,
      path: category ? `/gallery?category=${encodeURIComponent(category)}` : '/gallery',
      image: items[0] && items[0].image,
      jsonLd: [breadcrumbLd(res, [['Home', '/'], ['Gallery', '/gallery']])],
    },
    editLink: '/admin/gallery',
  });
});

router.get('/about', async (req, res) => {
  const s = res.locals.settings;
  const [aboutImage, species, testimonials, org] = await Promise.all([
    getImage(s.about_image_id), m.listSpecies(), m.listTestimonials(), orgLd(res),
  ]);
  res.render('about', {
    aboutImage,
    species,
    testimonials: testimonials.slice(0, 3),
    seo: {
      title: `Meet Wasim | ${s.site_name}, Dallas Parrot Breeder`,
      description: `Meet Wasim, the owner of ${s.site_name} in Dallas, Texas, who has been raising and caring for companion parrots for more than 10 years.`,
      path: '/about',
      image: aboutImage,
      jsonLd: [org, breadcrumbLd(res, [['Home', '/'], ['About', '/about']])],
    },
    editLink: '/admin/content/about',
  });
});

router.get('/faq', async (req, res) => {
  const s = res.locals.settings;
  const faqs = await m.listFaqs();
  const ld = [breadcrumbLd(res, [['Home', '/'], ['FAQ', '/faq']])];
  if (faqs.length) {
    ld.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map((q) => ({ '@type': 'Question', name: q.question, acceptedAnswer: { '@type': 'Answer', text: q.answer } })),
    });
  }
  res.render('faq', {
    faqs,
    seo: {
      title: `Frequently Asked Questions | ${s.site_name}`,
      description: `Answers to common questions about buying a companion parrot from ${s.site_name} in Dallas, Texas.`,
      path: '/faq',
      jsonLd: ld,
    },
    editLink: '/admin/faqs',
  });
});

async function renderContact(req, res, cf, status = 200) {
  const s = res.locals.settings;
  res.status(status).render('contact', {
    cf,
    sent: req.query.sent === '1',
    seo: {
      title: `Contact Wasim | ${s.site_name}, Dallas, Texas`,
      description: `Contact ${s.site_name} in Dallas, Texas about available birds, pricing or finding the right companion parrot.`,
      path: '/contact',
      jsonLd: [await orgLd(res), breadcrumbLd(res, [['Home', '/'], ['Contact', '/contact']])],
    },
    editLink: '/admin/content/contact',
  });
}

router.get('/contact', async (req, res) => {
  const values = {};
  const birdId = parseInt(req.query.bird, 10);
  if (birdId) {
    const b = await m.getBird(birdId);
    if (b) {
      values.interest = `bird:${b.id}`;
      values.message = `Hi Wasim, I'm interested in ${b.name}${b.species_singular ? ` (${b.species_singular})` : ''}. `;
    }
  } else if (typeof req.query.species === 'string' && req.query.species) {
    const sp = await m.getSpecies('slug', req.query.species);
    if (sp) values.interest = `species:${sp.slug}`;
  }
  await renderContact(req, res, await contactForm(values));
});

// Per-IP rate limit for the contact form: more than 6 attempts in 15 minutes is refused.
// Counted in the database so it holds across serverless copies.
async function rateLimited(ip) {
  const key = 'contact:' + ip;
  await throttle.hit(key);
  return (await throttle.count(key, 15 * 60 * 1000)) > 6;
}

router.post('/contact', async (req, res) => {
  const b = req.body || {};
  const clip = (x, n) => String(x ?? '').trim().slice(0, n);
  const v = {
    name: clip(b.name, 100),
    email: clip(b.email, 200),
    phone: clip(b.phone, 40),
    whatsapp: clip(b.whatsapp, 40),
    interest: clip(b.interest, 120),
    message: clip(b.message, 4000),
  };
  // Honeypot filled, or link-stuffed message → quietly pretend it worked.
  if (b.website || (v.message.match(/https?:\/\//g) || []).length > 3) return res.redirect(303, '/contact?sent=1#contact');

  const errors = {};
  if (!v.name) errors.name = 'Please enter your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) errors.email = 'Please enter a valid email address.';
  if (v.phone && !/^[\d\s()+.-]{7,}$/.test(v.phone)) errors.phone = 'Please enter a valid phone number.';
  if (v.whatsapp && !/^[\d\s()+.-]{7,}$/.test(v.whatsapp)) errors.whatsapp = 'Please enter a valid WhatsApp number.';
  if (v.message.length < 10) errors.message = 'Please write a short message (at least 10 characters).';
  if (!checkFormToken(b.t)) errors.form = 'Please wait a few seconds and send your message again.';
  if (await rateLimited(req.ip)) errors.form = 'Too many messages were sent from your connection. Please try again later or contact Wasim directly.';
  if (Object.keys(errors).length) {
    if (!errors.form) errors.form = 'Please check the highlighted fields.';
    return renderContact(req, res, await contactForm(v, errors), 422);
  }

  // Turn the interest dropdown value into readable text.
  let interest = v.interest;
  if (interest.startsWith('bird:')) {
    const bird = await m.getBird(parseInt(interest.slice(5), 10));
    interest = bird ? `${bird.name}${bird.species_singular ? ` (${bird.species_singular})` : ''} — ${res.locals.siteUrl}${bird.url}` : '';
  } else if (interest.startsWith('species:')) {
    const sp = await m.getSpecies('slug', interest.slice(8));
    interest = sp ? sp.name : '';
  } else if (interest === 'unsure') interest = 'Not sure yet';
  else interest = '';

  const inquiry = { ...v, interest };
  await run('INSERT INTO inquiries (name, email, phone, whatsapp, interest, message) VALUES (?, ?, ?, ?, ?, ?)',
    inquiry.name, inquiry.email, inquiry.phone, inquiry.whatsapp, inquiry.interest, inquiry.message);
  const s = res.locals.settings;
  notifyInquiry(s.notify_email || s.contact_email, inquiry, s.site_name).catch((e) => console.error('Email alert failed:', e.message));
  res.redirect(303, '/contact?sent=1#contact');
});

// ---------- SEO files ----------
router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\n\nSitemap: ${res.locals.siteUrl}/sitemap.xml\n`);
});

router.get('/sitemap.xml', async (req, res) => {
  const base = res.locals.siteUrl;
  const [species, birds] = await Promise.all([m.listSpecies(), m.listBirds({ status: 'current' })]);
  const urls = [
    ['/', 'weekly', '1.0'], ['/birds', 'daily', '0.9'], ['/species', 'monthly', '0.8'],
    ['/gallery', 'weekly', '0.6'], ['/about', 'monthly', '0.6'], ['/faq', 'monthly', '0.5'], ['/contact', 'yearly', '0.5'],
    ...species.map((sp) => [sp.url, 'weekly', '0.8']),
    ...birds.map((b) => [b.url, 'daily', '0.7', b.updated_at]),
  ];
  const day = (d) => new Date(d).toISOString().slice(0, 10);
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map(([p, freq, pri, mod]) => `  <url><loc>${h.esc(base + p)}</loc>${mod ? `<lastmod>${day(mod)}</lastmod>` : ''}<changefreq>${freq}</changefreq><priority>${pri}</priority></url>`).join('\n')
    + '\n</urlset>\n';
  res.type('application/xml').send(xml);
});

module.exports = router;
