'use strict';
// Adds or removes clearly-labelled DEMO birds so you can preview the design
// before real inventory is entered. Demo birds are fictional — always run
// `npm run demo:clear` before the website goes live.
//   npm run demo:seed
//   npm run demo:clear

require('../src/load-env');
const { init, close, all, run, tx, marks } = require('../src/db');
const { purgeImages } = require('../src/images');

const DEMO = [
  ['DEMO – Kiwi', 'green-cheek-conures', 'Pineapple', 'unknown', 'baby', 'available', 650, 'DNA test pending', 'Weaning', 1],
  ['DEMO – Sky', 'quaker-parrots', 'Blue', 'female', 'baby', 'available', 900, 'DNA sexed', 'Fully weaned', 0],
  ['DEMO – Mango', 'caiques', 'Black-headed', 'male', 'young', 'reserved', 2200, 'DNA sexed', 'Fully weaned', 0],
  ['DEMO – Opal', 'indian-ringnecks', 'Violet', 'unknown', 'baby', 'coming_soon', null, '', 'Not yet weaned', 0],
  ['DEMO – Pepper', 'senegal-parrots', 'Normal', 'unknown', 'baby', 'available', 1200, 'DNA test pending', 'Weaning', 0],
  ['DEMO – Sprout', 'kakarikis', 'Red-fronted', 'male', 'adult', 'sold', 400, 'Visually sexed', 'Fully weaned', 0],
];

(async () => {
  const cmd = process.argv[2];
  if (cmd !== 'seed' && cmd !== 'clear') { console.log('Usage: node scripts/demo.js seed|clear'); return; }
  await init();
  if (cmd === 'seed') {
    await tx(async (q) => {
      for (const [name, slug, mutation, sex, ageGroup, status, price, dna, wean, featured] of DEMO) {
        const sp = await q.get('SELECT id FROM species WHERE slug = ?', slug);
        await q.run(`INSERT INTO birds (name, species_id, mutation, sex, age_group, status, price, dna_status, weaning_status, featured, is_demo, description, personality)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        name, sp ? sp.id : null, mutation, sex, ageGroup, status, price, dna, wean, featured,
        'This is a demo listing used to preview the website design. It is not a real bird.',
        'Demo text — replace with the real personality of your bird.');
      }
    });
    console.log(`Added ${DEMO.length} demo birds. Remove them with: npm run demo:clear`);
  } else {
    const ids = (await all('SELECT id FROM birds WHERE is_demo = 1')).map((r) => r.id);
    const imgs = ids.length ? (await all(`SELECT image_id FROM bird_photos WHERE bird_id IN (${marks(ids.length)})`, ...ids)).map((r) => r.image_id) : [];
    await run('DELETE FROM birds WHERE is_demo = 1');
    await purgeImages(imgs);
    console.log(`Removed ${ids.length} demo birds.`);
  }
  await close();
})().catch((e) => { console.error(e.message); process.exit(1); });
