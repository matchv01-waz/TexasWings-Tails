'use strict';
// Attempt counting for login lockouts and the contact-form rate limit.
// Stored in the database (not memory) so it works when the site runs as several
// copies at once, e.g. serverless functions on Netlify.

const { get, run } = require('./db');

const DAY = 24 * 3600 * 1000;
let lastSweep = 0;

/** Record one attempt for `key`. */
async function hit(key) {
  const now = Date.now();
  await run('INSERT INTO throttle (key, at) VALUES (?, ?)', key, now);
  if (now - lastSweep > 3600 * 1000) {
    lastSweep = now;
    await run('DELETE FROM throttle WHERE at < ?', now - DAY);
  }
}

/** Number of attempts for `key` in the last `windowMs` milliseconds. */
async function count(key, windowMs) {
  const row = await get('SELECT COUNT(*)::int AS n FROM throttle WHERE key = ? AND at > ?', key, Date.now() - windowMs);
  return row.n;
}

async function clear(key) {
  await run('DELETE FROM throttle WHERE key = ?', key);
}

module.exports = { hit, count, clear };
