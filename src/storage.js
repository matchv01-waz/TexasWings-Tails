'use strict';
// Where photo files live.
//   • All R2_* variables set → Cloudflare R2 (S3-compatible API), served from R2_PUBLIC_URL
//   • Otherwise              → DATA_DIR/uploads on local disk, served by the app at /uploads
// File keys look like "<image key>/<width>.webp".

const fs = require('fs');
const path = require('path');
const { UPLOAD_DIR } = require('./db');

const R2_VARS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL'];
const USING_R2 = R2_VARS.every((k) => process.env[k]);
const CACHE = 'public, max-age=31536000, immutable';

let r2 = null;
function client() {
  if (!r2) {
    const { S3Client } = require('@aws-sdk/client-s3');
    r2 = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      forcePathStyle: !!process.env.R2_ENDPOINT, // only for local S3-compatible test servers
      credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
    });
  }
  return r2;
}
const publicBase = () => String(process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');

async function put(key, body, contentType) {
  if (USING_R2) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await client().send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: body, ContentType: contentType, CacheControl: CACHE }));
    return;
  }
  const file = path.join(UPLOAD_DIR, key);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, body);
}

async function remove(keys) {
  if (!keys.length) return;
  if (USING_R2) {
    const { DeleteObjectsCommand } = require('@aws-sdk/client-s3');
    await client().send(new DeleteObjectsCommand({
      Bucket: process.env.R2_BUCKET,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }));
    return;
  }
  const dirs = new Set();
  for (const key of keys) {
    await fs.promises.rm(path.join(UPLOAD_DIR, key), { force: true });
    dirs.add(path.dirname(path.join(UPLOAD_DIR, key)));
  }
  for (const d of dirs) await fs.promises.rmdir(d).catch(() => {}); // remove the folder once empty
}

async function exists(key) {
  if (USING_R2) {
    const { HeadObjectCommand } = require('@aws-sdk/client-s3');
    try { await client().send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key })); return true; }
    catch (e) { if (e.$metadata && e.$metadata.httpStatusCode === 404) return false; throw e; }
  }
  return fs.existsSync(path.join(UPLOAD_DIR, key));
}

function url(key) {
  return USING_R2 ? `${publicBase()}/${key}` : `/uploads/${key}`;
}

/** Origin to allow in the Content-Security-Policy (null when photos are served locally). */
function publicOrigin() {
  if (!USING_R2) return null;
  try { return new URL(publicBase()).origin; } catch { return null; }
}

/** Confirms the bucket is reachable. Returns an error message, or null when everything is fine. */
async function check() {
  if (!USING_R2) {
    const missing = R2_VARS.filter((k) => !process.env[k]);
    return missing.length < R2_VARS.length ? `R2 is partly configured — missing ${missing.join(', ')}. Using local disk instead.` : null;
  }
  try {
    const { HeadBucketCommand } = require('@aws-sdk/client-s3');
    await client().send(new HeadBucketCommand({ Bucket: process.env.R2_BUCKET }));
    if (!publicOrigin()) return 'R2_PUBLIC_URL is not a valid URL (it should look like https://pub-xxxx.r2.dev).';
    return null;
  } catch (e) {
    const status = e.$metadata && e.$metadata.httpStatusCode;
    if (status === 403) return 'R2 refused access — check R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY and that the token can read & write this bucket.';
    if (status === 404) return `R2 bucket "${process.env.R2_BUCKET}" was not found — check R2_BUCKET and R2_ACCOUNT_ID.`;
    return `Could not reach R2 (${e.name || 'error'}). Check R2_ACCOUNT_ID and your internet connection.`;
  }
}

module.exports = { USING_R2, put, remove, exists, url, publicOrigin, check };
