'use strict';
// Key/value site settings. DEFAULTS supplies starter copy; anything saved in the
// admin panel overrides it. PAGES describes the admin forms for each settings
// section so the admin UI is generated rather than hand-built per field.

const { all, tx } = require('./db');

const DEFAULTS = {
  // Homepage
  hero_eyebrow: 'Dallas, Texas Aviary',
  hero_headline: 'Beautiful Birds. Raised With Care.',
  hero_subheadline: 'Welcome to Texas Wings & Tails — a Dallas, Texas aviary where birds are raised with care, attention and a commitment to helping families find the right feathered companion.',
  hero_primary_label: 'View Available Birds',
  hero_secondary_label: 'Contact Wasim',
  hero_image_id: '',
  trust1_title: '10+ Years of Experience',
  trust1_text: 'Raising and caring for companion parrots for more than a decade.',
  trust2_title: 'Hand-Raised & Socialized',
  trust2_text: 'Raised with patience and attention to be friendly family companions.',
  trust3_title: 'Multiple Parrot Species',
  trust3_text: 'Quakers, Caiques, Ringnecks, Green Cheeks, Kakarikis and Senegals.',
  trust4_title: 'Personal Support',
  trust4_text: 'Talk directly with Wasim before and after you bring your bird home.',
  birds_heading: 'Available Birds',
  birds_intro: 'Meet the birds currently looking for their families. Each one has its own personality — ask Wasim which companion would be the best fit for your home.',
  species_heading: 'Our Birds',
  species_intro: 'The companion parrot species raised at Texas Wings & Tails.',
  gallery_heading: 'From the Aviary',
  gallery_intro: 'Babies, adults, everyday moments and happy new families.',
  testimonials_heading: 'Kind Words From Our Families',
  empty_birds_text: 'No birds are currently listed as available, but new babies may be coming soon. Contact Wasim to ask about upcoming availability.',

  // About
  about_heading: 'Meet Wasim',
  about_body: 'My name is Wasim, and I have been raising and caring for birds for more than 10 years. Over the years, I have had the privilege of working with several different species of companion parrots.\n\nTexas Wings & Tails was created from my passion for these intelligent, beautiful and unique birds and my desire to help families find the right feathered companion.',
  about_signature: 'Wasim',
  about_image_id: '',
  about_extra_heading: '',
  about_extra_body: '',
  years_experience: '10+',

  // Contact
  contact_heading: 'Interested in one of our birds?',
  contact_intro: 'Have questions about availability, pricing or finding the right companion? Contact Wasim directly.',
  contact_email: '',
  whatsapp_number: '',
  whatsapp_message: 'Hi Wasim, I found Texas Wings & Tails online and I have a question about your birds.',
  phone: '',
  location: 'Dallas, Texas',
  response_note: '',
  notify_email: '',

  // Website settings
  site_name: 'Texas Wings & Tails',
  tagline: 'Beautiful Birds. Raised With Care.',
  site_url: '',
  seo_description: 'Texas Wings & Tails is a Dallas, Texas parrot breeder raising Quaker parrots, caiques, Indian ringnecks, green cheek conures, kakarikis and Senegal parrots as companion birds.',
  og_image_id: '',
  instagram_url: '',
  facebook_url: '',
  tiktok_url: '',
  youtube_url: '',
  show_prices: '1',
  default_pickup_info: '',
  default_shipping_info: '',
  gallery_categories: 'Babies\nAdult Birds\nQuakers\nCaiques\nRingnecks\nGreen Cheek Conures\nKakarikis\nSenegals\nAviary\nHappy Families\nPast Birds',
};

const IMAGE_KEYS = ['hero_image_id', 'about_image_id', 'og_image_id'];

const PAGES = {
  home: {
    title: 'Homepage content',
    intro: 'The words and main photo visitors see first.',
    groups: [
      { title: 'Main banner (hero)', fields: [
        { key: 'hero_image_id', label: 'Main banner photo', type: 'image', help: 'Use your best, sharpest bird photo. Landscape (wide) photos work best.' },
        { key: 'hero_eyebrow', label: 'Small line above the headline' },
        { key: 'hero_headline', label: 'Headline' },
        { key: 'hero_subheadline', label: 'Text under the headline', type: 'textarea' },
        { key: 'hero_primary_label', label: 'Main button text' },
        { key: 'hero_secondary_label', label: 'Second button text' },
      ] },
      { title: 'Trust highlights (the four boxes under the banner)', fields: [
        { key: 'trust1_title', label: 'Box 1 title' }, { key: 'trust1_text', label: 'Box 1 text' },
        { key: 'trust2_title', label: 'Box 2 title' }, { key: 'trust2_text', label: 'Box 2 text' },
        { key: 'trust3_title', label: 'Box 3 title' }, { key: 'trust3_text', label: 'Box 3 text' },
        { key: 'trust4_title', label: 'Box 4 title' }, { key: 'trust4_text', label: 'Box 4 text' },
      ] },
      { title: 'Section headings', fields: [
        { key: 'birds_heading', label: 'Available birds heading' },
        { key: 'birds_intro', label: 'Available birds intro', type: 'textarea' },
        { key: 'empty_birds_text', label: 'Message when no birds are available', type: 'textarea' },
        { key: 'species_heading', label: 'Species heading' },
        { key: 'species_intro', label: 'Species intro', type: 'textarea' },
        { key: 'gallery_heading', label: 'Gallery heading' },
        { key: 'gallery_intro', label: 'Gallery intro', type: 'textarea' },
        { key: 'testimonials_heading', label: 'Testimonials heading' },
      ] },
    ],
  },
  about: {
    title: 'About section',
    intro: 'Your personal story. Write it the way you would say it to a visitor.',
    groups: [
      { title: 'Meet Wasim', fields: [
        { key: 'about_image_id', label: 'Your photo', type: 'image', help: 'A friendly photo of you, ideally with one of your birds. Portrait (tall) photos work best.' },
        { key: 'about_heading', label: 'Heading' },
        { key: 'about_body', label: 'Your story', type: 'textarea', rows: 8, help: 'Leave an empty line between paragraphs.' },
        { key: 'about_signature', label: 'Signature name' },
        { key: 'years_experience', label: 'Years of experience (shown as a badge)', help: 'For example: 10+' },
      ] },
      { title: 'Optional extra section on the About page', fields: [
        { key: 'about_extra_heading', label: 'Heading', help: 'For example: "How I raise my birds". Leave empty to hide.' },
        { key: 'about_extra_body', label: 'Text', type: 'textarea', rows: 6 },
      ] },
    ],
  },
  contact: {
    title: 'Contact information',
    intro: 'How visitors reach you. Buttons only appear once the matching detail is filled in.',
    groups: [
      { title: 'Contact details', fields: [
        { key: 'contact_email', label: 'Email address', type: 'email', help: 'Shown on the "Email Wasim" buttons.' },
        { key: 'whatsapp_number', label: 'WhatsApp number', type: 'tel', help: 'Include the country code, e.g. +1 214 555 0123. WhatsApp buttons appear once this is filled in.' },
        { key: 'whatsapp_message', label: 'Default WhatsApp greeting', type: 'textarea', help: 'Pre-filled text when someone taps a general WhatsApp button.' },
        { key: 'phone', label: 'Phone number (optional)', type: 'tel', help: 'Leave empty to keep it off the website.' },
        { key: 'location', label: 'Location shown on the website', help: 'Keep this general (city/state). Do not add your street address.' },
        { key: 'response_note', label: 'Response note (optional)', help: 'For example: "I usually reply within a day."' },
      ] },
      { title: 'Contact section text', fields: [
        { key: 'contact_heading', label: 'Heading' },
        { key: 'contact_intro', label: 'Text', type: 'textarea' },
      ] },
      { title: 'Notifications', fields: [
        { key: 'notify_email', label: 'Send contact-form messages to', type: 'email', help: 'Messages are always saved under Inquiries. Email alerts also require the SMTP settings described in the README.' },
      ] },
    ],
  },
  settings: {
    title: 'Website settings',
    intro: 'Search engine details, social media and site-wide defaults.',
    groups: [
      { title: 'General', fields: [
        { key: 'site_name', label: 'Business name' },
        { key: 'tagline', label: 'Tagline' },
        { key: 'site_url', label: 'Website address', type: 'url', help: 'Your full domain, e.g. https://texaswingsandtails.com — used for search engines and link previews.' },
        { key: 'show_prices', label: 'Show prices on the website', type: 'checkbox' },
      ] },
      { title: 'Search engines & link previews', fields: [
        { key: 'seo_description', label: 'Site description', type: 'textarea', help: 'One or two natural sentences. Shown in Google results for the homepage.' },
        { key: 'og_image_id', label: 'Link preview image', type: 'image', help: 'Shown when your site is shared on WhatsApp, Facebook, etc. Uses the main banner photo if empty.' },
      ] },
      { title: 'Social media', intro: 'Icons appear in the footer once a link is added.', fields: [
        { key: 'instagram_url', label: 'Instagram link', type: 'url' },
        { key: 'facebook_url', label: 'Facebook link', type: 'url' },
        { key: 'tiktok_url', label: 'TikTok link', type: 'url' },
        { key: 'youtube_url', label: 'YouTube link', type: 'url' },
      ] },
      { title: 'Default bird page information', intro: 'Shown on every bird page unless that bird has its own text. Leave empty to hide.', fields: [
        { key: 'default_pickup_info', label: 'Pickup information', type: 'textarea' },
        { key: 'default_shipping_info', label: 'Shipping information', type: 'textarea', help: 'Only fill this in if you offer shipping.' },
      ] },
      { title: 'Gallery', fields: [
        { key: 'gallery_categories', label: 'Gallery categories', type: 'textarea', rows: 8, help: 'One category per line.' },
      ] },
    ],
  },
};

// Cached until the admin saves something. When the site runs as several serverless copies
// (Netlify), a save only clears the copy that handled it, so the cache also expires quickly there.
const CACHE_MS = process.env.SERVERLESS ? 10000 : Infinity;
let cached = null;
let cachedAt = 0;
async function getSettings() {
  if (!cached || Date.now() - cachedAt > CACHE_MS) {
    const s = { ...DEFAULTS };
    for (const row of await all('SELECT key, value FROM settings')) s[row.key] = row.value;
    s.galleryCategories = s.gallery_categories.split('\n').map((x) => x.trim()).filter(Boolean);
    cached = s;
    cachedAt = Date.now();
  }
  return cached;
}

async function saveSettings(values) {
  await tx(async (q) => {
    for (const [k, v] of Object.entries(values)) {
      if (!(k in DEFAULTS)) continue;
      await q.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', k, String(v ?? ''));
    }
  });
  cached = null;
}

const invalidateSettings = () => { cached = null; };

module.exports = { CACHE_MS, DEFAULTS, PAGES, IMAGE_KEYS, getSettings, saveSettings, invalidateSettings };
