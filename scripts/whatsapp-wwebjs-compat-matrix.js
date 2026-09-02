/**
 * Static + config verification for WhatsApp Web / whatsapp-web.js compatibility matrix.
 *
 * Modes (independent — never silently switched):
 *   Test A: library-default (wwebjs DefaultOptions local cache, strict:false)
 *   Test B: live (webVersionCache type=none)
 *   Test C: pinned (local HTML, strict:true)
 *
 * Full authenticated/ready/getChats/session-restart rows require a live QR run:
 *   PATROL_WHATSAPP_WEB_VERSION_MODE=test-a|test-b|test-c npm run collector:smoke-chat-discovery
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const distRuntime = path.join(root, 'dist', 'collectors', 'whatsapp-web-runtime.config.js');
const srcRuntimeTs = path.join(root, 'src', 'collectors', 'whatsapp-web-runtime.config.ts');
const pinHtml = path.join(
  root,
  'src',
  'collectors',
  'wa-web-cache',
  '2.3000.1040111714-alpha.html',
);
const matrixOut = path.join(root, 'docs', 'WWEBJS_COMPATIBILITY_MATRIX.md');
const patchPath = path.join(root, 'patches', 'whatsapp-web.js+1.34.7.patch');

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function loadRuntime(mode) {
  const previous = { ...process.env };
  process.env.PATROL_WHATSAPP_WEB_VERSION_MODE = mode;
  delete require.cache[require.resolve(distRuntime)];
  // Prefer compiled JS; fall back to ts-node-free dynamic evaluation via child process if missing.
  if (!fs.existsSync(distRuntime)) {
    process.env = previous;
    return null;
  }
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const runtime = require(distRuntime);
  const snapshot = runtime.getWhatsAppWebVersionLogSnapshot();
  const options = runtime.buildWhatsAppWebClientOptions({
    headless: true,
    executablePath: 'C:\\fake\\chrome.exe',
  });
  const versions = runtime.readWhatsAppRuntimePackageVersions();
  process.env = previous;
  return { snapshot, options, versions };
}

function main() {
  const pinExists = fs.existsSync(pinHtml);
  const pinSha = pinExists ? sha256(pinHtml) : null;
  const patchExists = fs.existsSync(patchPath);
  const wwebjsPkg = JSON.parse(
    fs.readFileSync(path.join(root, 'node_modules', 'whatsapp-web.js', 'package.json'), 'utf8'),
  );
  const puppeteerPkg = JSON.parse(
    fs.readFileSync(path.join(root, 'node_modules', 'puppeteer', 'package.json'), 'utf8'),
  );
  const authStore = fs.readFileSync(
    path.join(
      root,
      'node_modules',
      'whatsapp-web.js',
      'src',
      'util',
      'Injected',
      'AuthStore',
      'AuthStore.js',
    ),
    'utf8',
  );

  const authPatched = authStore.includes('resolveWaSocket');
  const socketModelRefs = (authStore.match(/WAWebSocketModel/g) || []).length;

  let modeResults = {};
  if (fs.existsSync(distRuntime)) {
    for (const mode of ['library-default', 'live', 'pinned']) {
      modeResults[mode] = loadRuntime(mode);
    }
  }

  const rows = [
    {
      id: 'A',
      mode: 'library-default',
      description:
        'whatsapp-web.js 1.34.7, no explicit webVersion override, local cache strict:false (library DefaultOptions)',
      configOk: modeResults['library-default']
        ? !modeResults['library-default'].options.webVersion &&
          !modeResults['library-default'].options.webVersionCache
        : 'build-required',
      authenticated: 'manual',
      ready: 'manual',
      getChats: 'manual',
      sessionRestart: 'manual',
    },
    {
      id: 'B',
      mode: 'live',
      description: 'whatsapp-web.js 1.34.7 + live WA Web via webVersionCache type=none (no old pinned HTML)',
      configOk: modeResults.live
        ? modeResults.live.options.webVersionCache?.type === 'none'
        : 'build-required',
      authenticated: 'manual',
      ready: 'manual',
      getChats: 'manual',
      sessionRestart: 'manual',
    },
    {
      id: 'C',
      mode: 'pinned',
      description: `known-compatible pinned HTML 2.3000.1040111714-alpha strict:true sha256=${pinSha ?? 'missing'}`,
      configOk: modeResults.pinned
        ? modeResults.pinned.options.webVersionCache?.type === 'local' &&
          modeResults.pinned.options.webVersionCache?.strict === true &&
          pinExists
        : pinExists,
      authenticated: 'manual',
      ready: 'manual',
      getChats: 'manual',
      sessionRestart: 'manual',
    },
  ];

  const md = `# WhatsApp Web / whatsapp-web.js compatibility matrix

Generated: ${new Date().toISOString()}

## Runtime packages (installed)

| Component | Value |
| --- | --- |
| whatsapp-web.js | ${wwebjsPkg.version} |
| puppeteer | ${puppeteerPkg.version} |
| AuthStore Socket resolver patch | ${authPatched ? 'applied' : 'MISSING'} |
| patch-package file | ${patchExists ? 'patches/whatsapp-web.js+1.34.7.patch' : 'MISSING'} |
| Pinned HTML | ${pinExists ? pinHtml : 'MISSING'} |
| Pinned HTML SHA256 | ${pinSha ?? 'n/a'} |

## Upstream finding

Installed \`whatsapp-web.js@1.34.7\` AuthStore/Client still target \`WAWebSocketModel\`.
Current live WhatsApp Web builds can omit that module (\`Requiring unknown module "WAWebSocketModel"\`),
so authentication may succeed while \`ready\` / Store injection fails.

npm \`latest\` is still 1.34.7; \`2.0.0-alpha.0\` is an older Store-based tree, not a fix.
This repo patches AuthStore with \`resolveWaSocket()\` fallbacks and treats the failure as
\`WWEBJS_MODULE_COMPATIBILITY_ERROR\` (not logout). LocalAuth is preserved.

## Independent mode tests

| Test | Mode | Configuration check | authenticated | ready | getChats | session restart |
| --- | --- | --- | --- | --- | --- | --- |
${rows
  .map(
    (row) =>
      `| ${row.id} | \`${row.mode}\` | ${row.configOk} | ${row.authenticated} | ${row.ready} | ${row.getChats} | ${row.sessionRestart} |`,
  )
  .join('\n')}

### Descriptions

${rows.map((row) => `- **Test ${row.id}**: ${row.description}`).join('\n')}

## How to complete the live columns

Run each mode independently (do not mix env vars mid-run):

\`\`\`bash
# Test A
set PATROL_WHATSAPP_WEB_VERSION_MODE=library-default
npm run collector:smoke-chat-discovery

# Test B
set PATROL_WHATSAPP_WEB_VERSION_MODE=live
npm run collector:smoke-chat-discovery

# Test C
set PATROL_WHATSAPP_WEB_VERSION_MODE=pinned
npm run collector:smoke-chat-discovery
\`\`\`

Confirm logs include:
- \`WWEB_VERSION_REQUESTED\`
- \`WWEB_VERSION_LOADED\`
- \`WWEB_CACHE_MODE\`
- \`WWEB_HTML_SHA256\`
- \`POST_AUTH_COMPAT_PROBE\`
- success: \`ready-event\` + \`CHAT_DISCOVERY_SMOKE_PASS\`
- failure: \`WWEBJS_MODULE_COMPATIBILITY_ERROR\` (session preserved)

Source config: \`${path.relative(root, srcRuntimeTs)}\`
`;

  fs.mkdirSync(path.dirname(matrixOut), { recursive: true });
  fs.writeFileSync(matrixOut, md, 'utf8');
  console.log(md);
  console.log(`\nWrote ${matrixOut}`);
}

main();
