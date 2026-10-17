'use strict';
// Admin authentication: bcrypt password hashes, random session ids stored in
// the database, HttpOnly SameSite=Strict cookies, per-session CSRF tokens, and a
// login lockout after repeated failures. There is no public sign-up — admins
// are created from the command line (npm run create-admin).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { get, run, DATA_DIR } = require('./db');
const throttle = require('./throttle');

const COOKIE = 'twt_admin';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours, sliding
const IS_PROD = process.env.NODE_ENV === 'production';

// Secret used to sign contact-form timing tokens. In production set SESSION_SECRET
// (Render generates one automatically from render.yaml). Without it, a secret is derived
// from DATABASE_URL so every serverless copy agrees; locally it's kept in DATA_DIR.
const SECRET = process.env.SESSION_SECRET || (process.env.DATABASE_URL
  ? crypto.createHash('sha256').update('twt-form-secret:' + process.env.DATABASE_URL).digest('hex')
  : null) || (() => {
  const file = path.join(DATA_DIR, 'secret.key');
  try { return fs.readFileSync(file, 'utf8').trim(); }
  catch {
    const s = crypto.randomBytes(32).toString('hex');
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(file, s, { mode: 0o600 }); } catch { /* read-only disk */ }
    return s;
  }
})();

const hashPassword = (pw) => bcrypt.hash(pw, 12);
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed */ }
    }
  }
  return out;
}

function setCookie(res, value, maxAgeMs) {
  const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (IS_PROD) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

// ---- login throttling (stored in the database, so it holds across serverless copies) ----
// 5 failures for one username from one IP, or 20 failures from one IP, within 15 minutes locks login.
const LOCK_MS = 15 * 60 * 1000;

async function attemptLogin(username, password, ip) {
  const userKey = `login-u:${ip}|${String(username).toLowerCase()}`.slice(0, 300);
  const ipKey = `login-ip:${ip}`;
  if ((await throttle.count(userKey, LOCK_MS)) >= 5 || (await throttle.count(ipKey, LOCK_MS)) >= 20) {
    return { error: 'Too many attempts. Please wait 15 minutes and try again.' };
  }
  const user = await get('SELECT * FROM admin_users WHERE lower(username) = lower(?)', String(username || ''));
  const ok = await bcrypt.compare(String(password || ''), user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) {
    await throttle.hit(userKey);
    await throttle.hit(ipKey);
    return { error: 'That username and password combination is not correct.' };
  }
  await throttle.clear(userKey);
  return { user };
}

async function startSession(res, userId) {
  const id = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(24).toString('hex');
  await run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  await run('INSERT INTO sessions (id, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)', id, userId, csrf, Date.now() + SESSION_TTL_MS);
  await run('UPDATE admin_users SET last_login_at = now() WHERE id = ?', userId);
  setCookie(res, id, SESSION_TTL_MS);
}

async function endSession(req, res) {
  if (req.sessionId) await run('DELETE FROM sessions WHERE id = ?', req.sessionId);
  setCookie(res, '', 0);
}

// Attach req.admin if a valid session cookie is present (only checked under /admin).
async function loadSession(req, res, next) {
  try {
    const sid = parseCookies(req.headers.cookie)[COOKIE];
    if (sid && /^[a-f0-9]{64}$/.test(sid)) {
      const s = await get(`SELECT s.id, s.csrf, s.expires_at, u.id AS user_id, u.username
                           FROM sessions s JOIN admin_users u ON u.id = s.user_id WHERE s.id = ?`, sid);
      if (s && s.expires_at > Date.now()) {
        req.sessionId = s.id;
        req.admin = { id: s.user_id, username: s.username };
        req.csrfToken = s.csrf;
        // Slide the expiry forward at most once a minute.
        if (s.expires_at - Date.now() < SESSION_TTL_MS - 60000) {
          await run('UPDATE sessions SET expires_at = ? WHERE id = ?', Date.now() + SESSION_TTL_MS, s.id);
          setCookie(res, s.id, SESSION_TTL_MS);
        }
      }
    }
    next();
  } catch (e) { next(e); }
}

function requireAdmin(req, res, next) {
  if (req.admin) return next();
  if (req.method === 'GET') return res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
  return res.status(401).send('Please log in again.');
}

function verifyCsrf(req, res, next) {
  const token = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
  const a = Buffer.from(String(token));
  const b = Buffer.from(req.csrfToken || '');
  if (a.length && a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  return res.status(403).send('This form has expired. Please go back, refresh the page and try again.');
}

// ---- contact form anti-spam token: signed timestamp ----
function formToken() {
  const t = Date.now().toString(36);
  return `${t}.${crypto.createHmac('sha256', SECRET).update('form:' + t).digest('hex').slice(0, 20)}`;
}
function checkFormToken(token) {
  const [t, sig] = String(token || '').split('.');
  if (!t || !sig) return false;
  const expect = crypto.createHmac('sha256', SECRET).update('form:' + t).digest('hex').slice(0, 20);
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;
  const age = Date.now() - parseInt(t, 36);
  return age > 3000 && age < 1000 * 60 * 60 * 24; // humans take > 3 seconds; token valid for a day
}

module.exports = {
  hashPassword, attemptLogin, startSession, endSession, loadSession, requireAdmin, verifyCsrf,
  formToken, checkFormToken,
};
