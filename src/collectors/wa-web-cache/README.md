# WhatsApp Web HTML pin cache

Local `whatsapp-web.js` `webVersionCache` files for the packaged collector.

- Available pin: `2.3000.1040111714-alpha.html` (Test C / `PATROL_WHATSAPP_WEB_VERSION_MODE=pinned`, `strict: true`)
- Copied into `dist/collectors/wa-web-cache` by Nest assets
- Also packaged as Electron `extraResource` (`resources/wa-web-cache`)

Production defaults to **live** (`webVersionCache.type = none`) after authenticated-session
durability and same-profile restart controls showed the old strict pin was no longer compatible.
Pinned and library-default modes remain explicit diagnostic/admin overrides:

| Mode | Env | Cache |
| --- | --- | --- |
| Test A | `library-default` | library DefaultOptions local, `strict: false` |
| Test B | `live` | `webVersionCache.type = none` |
| Test C | `pinned` | this folder, `strict: true` |

Do not delete the HTML pin while the explicit pinned compatibility mode remains supported.
See `docs/WWEBJS_COMPATIBILITY_MATRIX.md`.
