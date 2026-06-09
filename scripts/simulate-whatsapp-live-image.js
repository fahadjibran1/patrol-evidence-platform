/**
 * Simulates a live WhatsApp image ingest for a mapped group (no WhatsApp browser required).
 *
 * Usage:
 *   PATROL_API=http://localhost:3001 PATROL_TOKEN=<jwt> \
 *   node scripts/simulate-whatsapp-live-image.js SWI01 120363375746387624@g.us
 */
const http = require('http');
const https = require('https');

const API_BASE = process.env.PATROL_API?.trim() || 'http://localhost:3001';
const TOKEN = process.env.PATROL_TOKEN?.trim() || '';
const siteCode = process.argv[2]?.trim();
const externalGroupId = process.argv[3]?.trim();

if (!TOKEN) {
  console.error('PATROL_TOKEN is required (admin JWT).');
  process.exit(1);
}

if (!siteCode || !externalGroupId) {
  console.error('Usage: node scripts/simulate-whatsapp-live-image.js <siteCode> <externalGroupId>');
  process.exit(1);
}

const url = new URL('/collectors/whatsapp/simulate-live-image', API_BASE);
const transport = url.protocol === 'https:' ? https : http;
const body = JSON.stringify({
  siteCode,
  externalGroupId,
});

const request = transport.request(
  url,
  {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    },
  },
  (response) => {
    let payload = '';
    response.on('data', (chunk) => {
      payload += chunk.toString();
    });
    response.on('end', () => {
      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
        console.log(`OK ${payload}`);
        process.exit(0);
      }

      console.error(`FAILED status=${response.statusCode} body=${payload}`);
      process.exit(1);
    });
  },
);

request.on('error', (error) => {
  console.error(`FAILED ${error.message}`);
  process.exit(1);
});

request.write(body);
request.end();
