# WhatsApp Web / whatsapp-web.js compatibility matrix

Generated: 2026-07-29T22:00:17.387Z

## Runtime packages (installed)

| Component | Value |
| --- | --- |
| whatsapp-web.js | 1.34.7 |
| puppeteer | 24.38.0 |
| AuthStore Socket resolver patch | applied |
| patch-package file | patches/whatsapp-web.js+1.34.7.patch |
| Pinned HTML | C:\Users\Admin\patrol-evidence-platform\src\collectors\wa-web-cache\2.3000.1040111714-alpha.html |
| Pinned HTML SHA256 | 92497907895f6799dc53aa96a413f60499247fe4420e25c81f4844e2407963a4 |

## Upstream finding

Installed `whatsapp-web.js@1.34.7` AuthStore/Client still target `WAWebSocketModel`.
Current live WhatsApp Web builds can omit that module (`Requiring unknown module "WAWebSocketModel"`),
so authentication may succeed while `ready` / Store injection fails.

npm `latest` is still 1.34.7; `2.0.0-alpha.0` is an older Store-based tree, not a fix.
This repo patches AuthStore with `resolveWaSocket()` fallbacks and treats the failure as
`WWEBJS_MODULE_COMPATIBILITY_ERROR` (not logout). LocalAuth is preserved.

## Independent mode tests

| Test | Mode | Configuration check | authenticated | ready | getChats | session restart |
| --- | --- | --- | --- | --- | --- | --- |
| A | `library-default` | true | manual | manual | manual | manual |
| B | `live` | true | manual | manual | manual | manual |
| C | `pinned` | true | manual | manual | manual | manual |

### Descriptions

- **Test A**: whatsapp-web.js 1.34.7, no explicit webVersion override, local cache strict:false (library DefaultOptions)
- **Test B**: whatsapp-web.js 1.34.7 + live WA Web via webVersionCache type=none (no old pinned HTML)
- **Test C**: known-compatible pinned HTML 2.3000.1040111714-alpha strict:true sha256=92497907895f6799dc53aa96a413f60499247fe4420e25c81f4844e2407963a4

## How to complete the live columns

Run each mode independently (do not mix env vars mid-run):

```bash
# Test A
set PATROL_WHATSAPP_WEB_VERSION_MODE=library-default
npm run collector:smoke-chat-discovery

# Test B
set PATROL_WHATSAPP_WEB_VERSION_MODE=live
npm run collector:smoke-chat-discovery

# Test C
set PATROL_WHATSAPP_WEB_VERSION_MODE=pinned
npm run collector:smoke-chat-discovery
```

Confirm logs include:
- `WWEB_VERSION_REQUESTED`
- `WWEB_VERSION_LOADED`
- `WWEB_CACHE_MODE`
- `WWEB_HTML_SHA256`
- `POST_AUTH_COMPAT_PROBE`
- success: `ready-event` + `CHAT_DISCOVERY_SMOKE_PASS`
- failure: `WWEBJS_MODULE_COMPATIBILITY_ERROR` (session preserved)

Source config: `src\collectors\whatsapp-web-runtime.config.ts`
