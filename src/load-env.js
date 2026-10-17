'use strict';
// Load variables from a .env file in the project root, if one exists.
const path = require('path');
try { process.loadEnvFile(path.join(__dirname, '..', '.env')); } catch { /* no .env file */ }
