/**
 * RC1 load-test harness (Node, no external k6 dependency).
 *
 * Usage:
 *   node scripts/rc1-load-harness.js
 *   BASE_URL=https://api.example.com ADMIN_TOKEN=... CUSTOMER_TOKEN=... node scripts/rc1-load-harness.js
 *
 * Without tokens, runs a local synthetic concurrency benchmark (CPU/queue simulation).
 */
/* eslint-disable no-console */

const BASE_URL = (process.env.BASE_URL || process.env.LICENSE_API_URL || '').replace(/\/$/, '');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const CUSTOMER_TOKEN = process.env.CUSTOMER_TOKEN || '';
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY || 25);
const ITERATIONS = Number(process.env.LOAD_ITERATIONS || 5);

async function timed(label, fn) {
  const started = Date.now();
  let ok = 0;
  let fail = 0;
  const errors = [];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async (_, i) => {
      for (let n = 0; n < ITERATIONS; n += 1) {
        try {
          await fn(i, n);
          ok += 1;
        } catch (error) {
          fail += 1;
          if (errors.length < 5) {
            errors.push(String(error?.message || error));
          }
        }
      }
    }),
  );
  const elapsedMs = Date.now() - started;
  const total = ok + fail;
  return {
    label,
    ok,
    fail,
    total,
    elapsedMs,
    rps: total > 0 ? Number(((total / elapsedMs) * 1000).toFixed(2)) : 0,
    errors,
  };
}

async function httpGet(path, token) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error(`${path} → ${response.status}`);
  }
  return response.json().catch(() => null);
}

async function syntheticBurst(label, workMs = 2) {
  return timed(label, async () => {
    const end = Date.now() + workMs;
    let x = 0;
    while (Date.now() < end) {
      x += Math.sqrt(Math.random() * 1000);
    }
    if (x < 0) throw new Error('unreachable');
  });
}

async function main() {
  console.log('RC1 Load Harness');
  console.log(`concurrency=${CONCURRENCY} iterations=${ITERATIONS}`);
  const results = [];

  if (!BASE_URL || !ADMIN_TOKEN) {
    console.log('No BASE_URL/ADMIN_TOKEN — running synthetic local benchmarks.');
    results.push(await syntheticBurst('synthetic.cpu', 3));
    results.push(await syntheticBurst('synthetic.queue_like', 1));
  } else {
    results.push(
      await timed('admin.dashboard', async () => {
        await httpGet('/admin/dashboard/summary', ADMIN_TOKEN);
      }),
    );
    results.push(
      await timed('admin.system.status', async () => {
        await httpGet('/admin/system/status', ADMIN_TOKEN);
      }),
    );
    if (CUSTOMER_TOKEN) {
      results.push(
        await timed('customer.billing', async () => {
          await httpGet('/customer/billing', CUSTOMER_TOKEN);
        }),
      );
      results.push(
        await timed('customer.licences', async () => {
          await httpGet('/customer/licences', CUSTOMER_TOKEN);
        }),
      );
    }
    results.push(
      await timed('health', async () => {
        await httpGet('/health', '');
      }),
    );
  }

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));

  const hardFail = results.some((row) => row.fail > row.ok);
  if (hardFail) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
