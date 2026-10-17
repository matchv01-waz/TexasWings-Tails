'use strict';
// Netlify build step: copy the static files into ./dist so Netlify's CDN serves them
// directly (same URLs the Express app uses). Everything else goes to the function.
//   public/**                     → dist/static/**
//   @fontsource-variable fonts    → dist/fonts/<font>/**

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), path.join(dist, 'static'), { recursive: true });
for (const font of ['fraunces', 'dm-sans']) {
  fs.cpSync(path.join(root, 'node_modules', '@fontsource-variable', font, 'files'), path.join(dist, 'fonts', font), { recursive: true });
}
console.log('Static files copied to dist/');
