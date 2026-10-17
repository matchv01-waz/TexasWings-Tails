'use strict';
// Create an admin account, or reset the password of an existing one.
//   npm run create-admin
//   npm run create-admin -- wasim
// Non-interactive: ADMIN_USERNAME=wasim ADMIN_PASSWORD='...' npm run create-admin
//
// Uses the database in DATABASE_URL (e.g. Neon) when set, otherwise the local
// development database. To create the admin for the live site, run this on your
// own computer with the live DATABASE_URL (see README → Deploying to Render).

require('../src/load-env');
const readline = require('readline');
const { init, close, get, run } = require('../src/db');
const { hashPassword } = require('../src/auth');

function ask(question, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); else rl.output.write('*'); };
    }
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

(async () => {
  let username = process.env.ADMIN_USERNAME || process.argv[2] || '';
  let password = process.env.ADMIN_PASSWORD || '';
  if (!username) username = await ask('Admin username: ');
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
    console.error('Username must be 3–40 characters: letters, numbers, dot, dash or underscore.');
    process.exit(1);
  }
  if (!password) {
    password = await ask('Password (at least 10 characters): ', true);
    const again = await ask('Type the password again: ', true);
    if (password !== again) { console.error('Passwords do not match.'); process.exit(1); }
  }
  if (password.length < 10) { console.error('Password must be at least 10 characters.'); process.exit(1); }

  const kind = await init();
  console.log(kind === 'postgres' ? 'Using the database from DATABASE_URL.' : 'Using the local development database (DATABASE_URL is not set).');
  const hash = await hashPassword(password);
  const existing = await get('SELECT id FROM admin_users WHERE lower(username) = lower(?)', username);
  if (existing) {
    await run('UPDATE admin_users SET password_hash = ? WHERE id = ?', hash, existing.id);
    await run('DELETE FROM sessions WHERE user_id = ?', existing.id);
    console.log(`Password updated for "${username}".`);
  } else {
    await run('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)', username, hash);
    console.log(`Admin "${username}" created. Log in at /admin`);
  }
  await close();
})().catch((e) => { console.error('Could not create the admin:', e.message); process.exit(1); });
