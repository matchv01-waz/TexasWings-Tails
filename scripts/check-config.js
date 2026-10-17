'use strict';
// Checks that the Neon database and Cloudflare R2 settings in .env work, before you deploy.
//   npm run check
// Uploads a tiny test file to R2, confirms it's publicly visible, then deletes it.

require('../src/load-env');
const db = require('../src/db');
const storage = require('../src/storage');

const ok = (msg) => console.log('  ✔ ' + msg);
const bad = (msg) => { console.log('  ✘ ' + msg); process.exitCode = 1; };

(async () => {
  console.log('\nDatabase');
  if (!db.USING_PG) bad('DATABASE_URL is not set — using the local development database. Add your Neon connection string to .env to check it.');
  try {
    const kind = await db.init();
    const species = (await db.get('SELECT COUNT(*)::int AS n FROM species')).n;
    const admins = (await db.get('SELECT COUNT(*)::int AS n FROM admin_users')).n;
    ok(`Connected (${kind === 'postgres' ? 'Neon/Postgres' : 'local'}). Tables are ready; ${species} species found.`);
    if (admins) ok(`${admins} admin account${admins === 1 ? '' : 's'} found.`);
    else bad('No admin account yet — run: npm run create-admin');
  } catch (e) {
    bad('Could not connect: ' + e.message);
  }

  console.log('\nPhoto storage');
  if (!storage.USING_R2) {
    bad('R2 is not configured — photos would be saved on the server disk, which Render erases on restart. Add the R2_* values to .env.');
  } else {
    const problem = await storage.check();
    if (problem) bad(problem);
    else {
      ok(`Bucket "${process.env.R2_BUCKET}" is reachable.`);
      const key = `_check/${Date.now()}.txt`;
      try {
        await storage.put(key, Buffer.from('ok'), 'text/plain');
        ok('Test file uploaded.');
        const res = await fetch(storage.url(key));
        if (res.ok) ok(`Test file is publicly visible at ${process.env.R2_PUBLIC_URL}.`);
        else bad(`Test file is NOT publicly visible (HTTP ${res.status}). Turn on public access for the bucket and check R2_PUBLIC_URL.`);
      } catch (e) {
        bad('Upload test failed: ' + e.message);
      } finally {
        await storage.remove([key]).catch(() => {});
      }
    }
  }

  console.log('\nOther settings');
  if (process.env.SESSION_SECRET) ok('SESSION_SECRET is set.');
  else console.log('  • SESSION_SECRET is not set here (fine locally; Render generates one from render.yaml).');
  console.log(process.exitCode ? '\nSome checks failed — see above.\n' : '\nEverything looks good.\n');
  await db.close();
})();
