/**
 * Verifies collector-runtime.log shows authenticated-event then ready-event.
 *
 * Usage:
 *   node scripts/probe-whatsapp-auth-ready-lifecycle.js
 *   PATROL_API=http://localhost:3001 PATROL_TOKEN=<jwt> node scripts/probe-whatsapp-auth-ready-lifecycle.js
 *
 * With PATROL_TOKEN, calls POST /collectors/whatsapp/probe-auth-ready-lifecycle while tailing the log.
 * Without token, only tails the log (start collector and scan QR first).
 */
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');

const LOG_PATH =
  process.env.PATROL_HELPER_LOG_PATH?.trim() ||
  path.join(os.tmpdir(), 'patrol-evidence-platform', 'collector-runtime.log');
const API_BASE = process.env.PATROL_API?.trim() || 'http://localhost:3001';
const TOKEN = process.env.PATROL_TOKEN?.trim() || '';
const TIMEOUT_MS = Number(process.env.PATROL_PROBE_TIMEOUT_MS ?? 300_000);
const REQUIRED_SEQUENCE = ['authenticated-event', 'ready-event'];

function fail(message) {
  console.error(`PROBE FAILED: ${message}`);
  process.exit(1);
}

function postProbe() {
  if (!TOKEN) {
    return Promise.resolve();
  }

  const url = new URL('/collectors/whatsapp/probe-auth-ready-lifecycle', API_BASE);
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
        },
      },
      (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk.toString();
        });
        response.on('end', () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            console.log(`probe API ok: ${body.slice(0, 200)}`);
            resolve();
            return;
          }

          reject(new Error(`probe API status ${response.statusCode}: ${body}`));
        });
      },
    );

    request.on('error', reject);
    request.end();
  });
}

function tailLog() {
  const startedAt = Date.now();
  const seen = new Set();
  let offset = 0;

  if (fs.existsSync(LOG_PATH)) {
    const stats = fs.statSync(LOG_PATH);
    offset = Math.max(0, stats.size - 64_000);
  } else {
    console.log(`Waiting for log file: ${LOG_PATH}`);
  }

  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (!fs.existsSync(LOG_PATH)) {
        if (Date.now() - startedAt > TIMEOUT_MS) {
          clearInterval(interval);
          resolve(false);
        }
        return;
      }

      const stats = fs.statSync(LOG_PATH);
      if (stats.size < offset) {
        offset = 0;
      }

      if (stats.size > offset) {
        const chunk = fs.readFileSync(LOG_PATH, { encoding: 'utf8', start: offset, end: stats.size });
        offset = stats.size;
        for (const line of chunk.split('\n')) {
          for (const marker of REQUIRED_SEQUENCE) {
            if (line.includes(marker)) {
              seen.add(marker);
              console.log(`seen ${marker}`);
            }
          }
          if (line.includes('waiting-for-client-info') || line.includes('client-info-detected') || line.includes('ready-timeout')) {
            console.log(line.trim());
          }
        }
      }

      if (REQUIRED_SEQUENCE.every((marker) => seen.has(marker))) {
        clearInterval(interval);
        resolve(true);
        return;
      }

      if (Date.now() - startedAt > TIMEOUT_MS) {
        clearInterval(interval);
        resolve(false);
      }
    }, 1_000);
  });
}

async function main() {
  console.log(`Tailing ${LOG_PATH}`);
  console.log(`Required log markers: ${REQUIRED_SEQUENCE.join(' -> ')}`);
  console.log('Start patrol monitoring and scan QR if you have not already.');

  const tailPromise = tailLog();

  await sleep(2_000);
  try {
    await postProbe();
  } catch (error) {
    console.warn(`probe API skipped or failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const ok = await tailPromise;
  if (!ok) {
    fail(`Timed out after ${TIMEOUT_MS}ms without ${REQUIRED_SEQUENCE.join(' and ')} in ${LOG_PATH}`);
  }

  console.log('PROBE OK: authenticated-event and ready-event found in collector-runtime.log');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
