'use strict';
// Formatting and link helpers shared by public and admin templates.

const STATUSES = {
  available: 'Available',
  coming_soon: 'Coming Soon',
  reserved: 'Reserved',
  sold: 'Sold',
};
const SEXES = { unknown: 'Unknown', male: 'Male', female: 'Female', pending: 'Pending DNA' };
const AGE_GROUPS = { baby: 'Baby', young: 'Young (under 1 year)', adult: 'Adult (1 year +)' };
const DNA_SUGGESTIONS = ['DNA sexed', 'DNA test pending', 'Not DNA tested', 'Visually sexed'];
const WEANING_SUGGESTIONS = ['Fully weaned', 'Weaning', 'Not yet weaned'];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'bird';
}

/** Plain text → safe HTML. Blank lines split paragraphs; lines starting with "- " become bullet lists. */
function textToHtml(text) {
  const blocks = String(text || '').replace(/\r/g, '').trim().split(/\n\s*\n/);
  return blocks.filter(Boolean).map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-•*]\s+/.test(l))) {
      return '<ul>' + lines.map((l) => `<li>${esc(l.replace(/^\s*[-•*]\s+/, ''))}</li>`).join('') + '</ul>';
    }
    return '<p>' + lines.map(esc).join('<br>') + '</p>';
  }).join('\n');
}

function excerpt(text, n = 130) {
  // Bullet lines ("- Loves millet") become "· Loves millet" so short previews read naturally.
  const s = String(text || '').replace(/^\s*[-•*]\s+/, '').replace(/\n\s*[-•*]\s+/g, ' · ').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  return s.slice(0, s.lastIndexOf(' ', n) > n * 0.6 ? s.lastIndexOf(' ', n) : n).replace(/[,.;:\s]+$/, '') + '…';
}

/** Headline with a line break after each sentence ("Beautiful Birds.<br>Raised With Care."). */
function headlineHtml(text) {
  return esc(text).replace(/([.!?])\s+(?=\S)/g, '$1<br>');
}

function monthsSince(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return null;
  const now = new Date();
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()) - (now.getDate() < d.getDate() ? 1 : 0);
}

/** Age shown to visitors: the typed age wins, otherwise it's calculated from the hatch date. */
function ageText(bird) {
  if (bird.age) return bird.age;
  if (!bird.hatch_date) return '';
  const d = new Date(bird.hatch_date + 'T00:00:00');
  if (isNaN(d)) return '';
  const days = Math.floor((Date.now() - d) / 86400000);
  if (days < 0) return '';
  if (days < 7 * 16) { const w = Math.max(1, Math.floor(days / 7)); return `${w} week${w === 1 ? '' : 's'} old`; }
  const m = monthsSince(bird.hatch_date);
  if (m < 24) return `${m} months old`;
  const y = Math.floor(m / 12);
  return `${y} years old`;
}

/** Age group used by the filter: calculated from hatch date when known. */
function ageGroup(bird) {
  if (bird.hatch_date) {
    const m = monthsSince(bird.hatch_date);
    if (m !== null && m >= 0) return m < 6 ? 'baby' : m < 12 ? 'young' : 'adult';
  }
  return bird.age_group || 'baby';
}

function formatPrice(n) {
  if (n === null || n === undefined || n === '') return '';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

/**
 * Format a date for display. Timestamps (Date objects from the database) are shown in
 * Dallas time; plain "YYYY-MM-DD" dates (hatch dates, review dates) are shown as written.
 */
function formatDate(s, opts = { month: 'long', day: 'numeric', year: 'numeric' }) {
  if (!s) return '';
  if (s instanceof Date) return isNaN(s) ? '' : s.toLocaleDateString('en-US', { ...opts, timeZone: 'America/Chicago' });
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
  const d = new Date(s);
  return isNaN(d) ? String(s) : d.toLocaleDateString('en-US', { ...opts, timeZone: 'America/Chicago' });
}

/** Absolute URL for links shared outside the site (Open Graph, schema). */
const absUrl = (siteUrl, u) => (/^https?:\/\//.test(u) ? u : siteUrl + u);

const icon = (name, cls = '') => `<svg class="icon${cls ? ' ' + cls : ''}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;

/** Digits for a wa.me link. A 10-digit number is assumed to be a US number and gets the +1 country code. */
function waDigits(raw) {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  return digits.length === 10 ? '1' + digits : digits;
}
function waNumber(settings) {
  return waDigits(settings.whatsapp_number);
}
function waLink(settings, message) {
  const n = waNumber(settings);
  if (!n) return '';
  return `https://wa.me/${n}?text=${encodeURIComponent(message || settings.whatsapp_message || '')}`;
}
function mailLink(settings, subject, body) {
  if (!settings.contact_email) return '';
  const q = [];
  if (subject) q.push('subject=' + encodeURIComponent(subject));
  if (body) q.push('body=' + encodeURIComponent(body));
  return `mailto:${settings.contact_email}${q.length ? '?' + q.join('&') : ''}`;
}

module.exports = {
  STATUSES, SEXES, AGE_GROUPS, DNA_SUGGESTIONS, WEANING_SUGGESTIONS,
  esc, slugify, textToHtml, excerpt, headlineHtml, ageText, ageGroup, formatPrice, formatDate, absUrl, icon, waLink, mailLink, waNumber, waDigits,
};
