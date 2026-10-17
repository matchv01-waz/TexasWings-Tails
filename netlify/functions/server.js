'use strict';
// Netlify Function that runs the whole Express app (public pages + admin).
// netlify.toml sends every request that isn't a static file here.

process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.SERVERLESS = '1';
if (!process.env.TRUST_PROXY) process.env.TRUST_PROXY = '1';

const serverless = require('serverless-http');
const { app, prepare } = require('../../server');

const FUNCTION_PREFIX = /^\/\.netlify\/functions\/server(?=\/|$)/;
let ready = null;

const handle = serverless(app, {
  binary: ['image/*', 'font/*', 'application/octet-stream', 'application/pdf'],
});

/** Shape Netlify's event the way serverless-http expects, with the visitor's real IP and path. */
function normalize(event) {
  const headers = {};
  for (const [k, v] of Object.entries(event.headers || {})) headers[k.toLowerCase()] = v;
  const ip = headers['x-nf-client-connection-ip'] || String(headers['x-forwarded-for'] || '').split(',')[0].trim() || '0.0.0.0';
  // Express reads the client IP from X-Forwarded-For (trust proxy = 1 hop).
  headers['x-forwarded-for'] = ip;
  if (!headers['x-forwarded-proto']) headers['x-forwarded-proto'] = 'https';

  let path = event.path || '/';
  if (FUNCTION_PREFIX.test(path) && event.rawUrl) {
    try { path = new URL(event.rawUrl).pathname; } catch { /* keep event.path */ }
  }
  path = path.replace(FUNCTION_PREFIX, '') || '/';

  return {
    ...event,
    path,
    headers,
    multiValueHeaders: undefined,
    body: event.body == null ? '' : event.body,
    requestContext: { ...(event.requestContext || {}), identity: { ...((event.requestContext || {}).identity || {}), sourceIp: ip } },
  };
}

exports.handler = async (event, context) => {
  // Keep the database pool open between requests without making each request wait for it.
  context.callbackWaitsForEmptyEventLoop = false;
  try {
    if (!ready) ready = prepare().catch((e) => { ready = null; throw e; });
    await ready;
  } catch (e) {
    console.error('Could not start:', e.message);
    return {
      statusCode: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      body: 'The website is starting up or is not configured yet. Please try again in a moment.',
    };
  }
  return handle(normalize(event), context);
};
