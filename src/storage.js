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

/** Size in bytes of a stored file, or null when it doesn't exist. */
async function size(key) {
  if (USING_R2) {
    const { HeadObjectCommand } = require('@aws-sdk/client-s3');
    try { return (await client().send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }))).ContentLength; }
    catch (e) { if (e.$metadata && e.$metadata.httpStatusCode === 404) return null; throw e; }
  }
  try { return (await fs.promises.stat(path.join(UPLOAD_DIR, key))).size; } catch { return null; }
}
const exists = async (key) => (await size(key)) !== null;

/**
 * Where the browser should PUT a large file (videos), bypassing the ~6 MB request limit of
 * the hosting. R2: a signed link straight to the bucket, valid 15 minutes and only for this
 * exact size and type. Local disk: an admin route of this app.
 */
async function uploadUrl(key, contentType, bytes) {
  if (!USING_R2) return `/admin/media/local/${key}`;
  const { PutObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const cmd = new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, ContentType: contentType, ContentLength: bytes });
  return getSignedUrl(client(), cmd, { expiresIn: 900, signableHeaders: new Set(['content-type', 'content-length']) });
}

/** Origin the browser uploads to directly (for the Content-Security-Policy), or null. */
function uploadOrigin() {
  if (!USING_R2) return null;
  if (process.env.R2_ENDPOINT) return new URL(process.env.R2_ENDPOINT).origin;
  // Signed links put the bucket name in the host name.
  return `https://${process.env.R2_BUCKET}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
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

module.exports = { USING_R2, put, remove, exists, size, uploadUrl, uploadOrigin, url, publicOrigin, check };
