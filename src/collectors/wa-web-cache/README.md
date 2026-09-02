# WhatsApp Web HTML pin cache

Local `whatsapp-web.js` `webVersionCache` files for the packaged collector.

- Default pin: `2.3000.1040111714-alpha.html` (Test C / `PATROL_WHATSAPP_WEB_VERSION_MODE=pinned`, `strict: true`)
- Copied into `dist/collectors/wa-web-cache` by Nest assets
- Also packaged as Electron `extraResource` (`resources/wa-web-cache`)

Production default is **pinned**. Modes must not be switched silently:

| Mode | Env | Cache |
| --- | --- | --- |
| Test A | `library-default` | library DefaultOptions local, `strict: false` |
| Test B | `live` | `webVersionCache.type = none` |
| Test C | `pinned` | this folder, `strict: true` |

Do not delete the HTML pin without replacing it with another verified version and re-running `collector:smoke-chat-discovery`.
See `docs/WWEBJS_COMPATIBILITY_MATRIX.md`.
