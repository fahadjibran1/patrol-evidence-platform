# Production dependency risk register

Assessment date: 2026-09-11  
Scope: PatrolSafe by S4 Windows desktop release at baseline `1d508ea2b2d2a2e89f07deaeb293ae106a10e7ba`.

This register records runtime reachability, not only lockfile presence. The Electron packager prunes
`apps/`, `node_modules/@patrol/license-api`, development tools, and browser download caches. The
packaged desktop was inspected to confirm that `bcrypt`, `@mapbox/node-pre-gyp`, `tar`, and
`nodemailer` are absent. Cloud/licensing services require their own deployment gate.

## Remediated desktop findings

| Advisory/family | Package | Shipped | Runtime reachability | Disposition |
| --- | --- | --- | --- | --- |
| GHSA-f88m-g3jw-g9cj; GHSA-rgj7-g3m4-5g8c | sharp 0.34.5 | Yes | Externally supplied JPEG/PNG bytes reach `sharp(...).rotate().metadata().composite().toBuffer()` | **FIXED** in sharp 0.35.4; native JPEG encode/decode and corrupt/oversize fail-closed tests pass |
| GHSA-xf7r-hgr6-v32p; GHSA-v52c-386h-88mc; GHSA-5528-5vmv-3xc2; GHSA-72gw-mp4g-v24j; GHSA-3p4h-7m6x-2hcm; GHSA-wc9g-mqfw-jrwm; GHSA-qvfw-j98x-7q72; GHSA-535w-7cp7-47q4 | multer 2.0.2 | Yes | Authenticated `patrol-images/manual-ingest` multipart route | **FIXED** by the scoped `@nestjs/platform-express` override to multer 2.3.0 |
| GHSA-37ch-88jc-xwx2 | path-to-regexp 0.1.12 | Yes | Express route matching occurs before controller authorization | **FIXED** by the scoped Express-child override to 0.1.13; Nest's unrelated 3.3.0 matcher is unchanged |

## Remaining Critical/High findings

| Advisory/family | Package/path | Severity | Shipped in desktop | Reachable in desktop | Evidence and mitigation | Residual risk | Release disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GHSA-23hp-3jrh-7fpw; GHSA-34x7-hfp2-rc4v; GHSA-8qq5-rm4j-mr97; GHSA-83g3-92jg-28cx; GHSA-qffp-2rhf-9h96; GHSA-9ppj-qmqm-q256; GHSA-r6q2-hw4h-h46w; GHSA-vmf3-w455-68vh; GHSA-w8wr-v893-vjvp; GHSA-8x88-c5mf-7j5w; GHSA-gvwx-54wh-qm9j; GHSA-r292-9mhp-454m | `apps/license-api > bcrypt > @mapbox/node-pre-gyp > tar` | Critical/High | No | No | Packager explicitly removes both the workspace and its installed link; packaged artifact inspection confirms all four packages absent. Every listed advisory requires invoking tar parsing, extraction, replacement, or member-selection APIs on a crafted archive. `tar` is only an install-time binary acquisition dependency here; PatrolSafe does not accept or process TAR input. | Cloud build dependency remains and should move to bcrypt 6 under the separate portal gate. | **NOT EXPLOITABLE - ACCEPT (desktop)** |
| GHSA-mm7p-fcc7-pg87; GHSA-c7w3-x93f-qmm8; GHSA-vvjj-xcjg-gr5g; GHSA-268h-hp4c-crq3; GHSA-wqvq-jvpq-h66f; GHSA-r7g4-qg5f-qqm2; GHSA-rcmh-qjqh-p98v; GHSA-p6gq-j5cr-w38f; GHSA-8m3c-c648-2xjj; GHSA-wmmp-3585-3rmp; GHSA-2x7j-588g-ccc2; GHSA-cc9r-2j5m-2m83 | `apps/license-api > nodemailer` | High | No | No | Packager removes the licensing workspace and nodemailer is absent from the desktop. The cloud provider supplies fixed transport configuration, validated recipients, text/HTML, and Buffer attachments; it does not expose envelope size, transport name, list-comment, `raw`, JSON transport, file-path, URL-content, OAuth endpoint, or legacy `resolveContent` controls to desktop input. | This is not accepted for deploying the cloud mail service: upgrade to nodemailer 10 and run mail-domain/TLS/header UAT under its separate deployment gate. | **NOT EXPLOITABLE - ACCEPT (desktop)** |
| GHSA-jmr9-qjv8-65gv; GHSA-7pqw-9j4j-h8q3 | `whatsapp-web.js > puppeteer > @puppeteer/browsers > extract-zip` | High | Yes | No | PatrolSafe supplies an already-installed, validated Edge `executablePath`; no runtime API downloads or extracts browser archives and no archive input is accepted. Browser download caches are pruned from the artifact. | A future browser-download feature would invalidate this acceptance. | **NOT EXPLOITABLE - ACCEPT** |
| GHSA-96hv-2xvq-fx4p | `whatsapp-web.js > puppeteer-core > ws` | High | Yes | No | `ws` is Puppeteer's client transport to the locally launched Edge DevTools endpoint. WhatsApp/public web content is not the WebSocket peer and cannot emit DevTools protocol fragments. | Local malware able to impersonate the ephemeral DevTools endpoint is outside the public-web attacker model and already has local-code capability. | **NOT EXPLOITABLE - ACCEPT** |
| GHSA-f886-m6hf-6m8v; GHSA-3jxr-9vmj-r5cp; GHSA-mh99-v99m-4gvg; GHSA-rgw5-rvv9-x895 | `brace-expansion` via TypeORM glob and whatsapp-web.js archiver utilities | High | Yes (nested) | No | No PatrolSafe request, message, image, route, or configuration field is passed to brace expansion. TypeORM migration/glob paths are developer-controlled; LocalAuth is used, not RemoteAuth archive creation. | Future user-supplied glob/archive features require reassessment. | **NOT EXPLOITABLE - ACCEPT** |
| GHSA-5j98-mcp5-4vw2 | `glob` 10.4.5 via whatsapp-web.js archiver utilities | High | Yes | No | Advisory is specific to the glob CLI `-c/--cmd` shell execution path. The packaged application never invokes the glob CLI or accepts glob command arguments. | None under current runtime contract. | **NOT EXPLOITABLE - ACCEPT** |
| GHSA-v2v4-37r5-5v8g; GHSA-mwp4-54f8-5fhr | `puppeteer > proxy-agent > socks > ip-address` | High | Yes | No | The affected HTML-emitting methods are never rendered, and the address-normalisation issue requires attacker-controlled proxy/IP policy. PatrolSafe launches local Edge directly and does not derive proxy configuration or allowlists from WhatsApp or renderer input. | Reassess if customer-configurable proxy support or address rendering is added. | **NOT EXPLOITABLE - ACCEPT** |
| GHSA-mh29-5h37-fv8m; GHSA-h67p-54hq-rp68; GHSA-52cp-r559-cp3m; GHSA-5p4m-2wfm-xmqj; GHSA-2883-xcg3-v3hh | `js-yaml` via Puppeteer cosmiconfig; separate copy via cloud-only Swagger | High | Yes (Puppeteer copy) | No | The desktop accepts no YAML. Puppeteer configuration is fixed in application code and packaged developer configuration files are absent; Swagger copy belongs to the pruned cloud workspace. Thus no attacker-controlled merge keys, aliases, or object maps reach the parser. | A future YAML import/configuration feature requires reassessment. | **NOT EXPLOITABLE - ACCEPT** |
| GHSA-r5fr-rjxr-66jc; GHSA-f23m-r3pf-42rh; GHSA-xxjr-mmjv-4gpg | `lodash` via Nest config and whatsapp-web.js archiver utilities | High | Yes | No | PatrolSafe does not invoke `_.template` with attacker-controlled `imports` keys or invoke `_.unset`/`_.omit` on attacker-controlled paths. Environment/config keys are local installation inputs; current LocalAuth path does not use archive templates. | Keep pinned acceptance until an upstream compatible transitive release is certified. | **NOT EXPLOITABLE - ACCEPT** |
| Aggregate nodes: `@puppeteer/browsers`, `puppeteer`, `puppeteer-core`, `whatsapp-web.js` | Inherited only from extract-zip and ws rows above | High | Yes | No additional vulnerable API | These audit nodes add no advisory beyond the two explicitly analysed families above. whatsapp-web.js 1.34.7 and Puppeteer 24.38.0 remain unchanged to preserve the certified WhatsApp runtime. | Accepted only for the exact controlled Edge/LocalAuth contract. | **MITIGATED - ACCEPT** |
| Aggregate nodes: `bcrypt`, `@mapbox/node-pre-gyp` | Inherited only from tar row above | High | No | No | Present only in the cloud workspace dependency tree and removed from Electron packaging. | Cloud dependency upgrade remains P1. | **NOT EXPLOITABLE - ACCEPT (desktop)** |

## Moderate/Low disposition

Moderate and Low findings remain follow-up work unless their runtime path changes: Nest response-file
handling, `file-type`, `fflate`, `qs`, React Router, TypeORM, and `uuid`. TypeORM's SQL-ordering issue
targets MySQL/MariaDB while the desktop uses SQLite; its migration-template issue is developer CLI
only. React Router SSR hydration is not used by the Vite SPA. These findings do not override the
Critical/High release gate above.

## Acceptance conditions

The accepted rows are valid only while all of the following remain true:

- the licensing/customer portal workspace stays outside the Windows desktop artifact;
- PatrolSafe launches the validated installed Edge executable and does not download browser archives;
- WhatsApp uses LocalAuth rather than user-controlled RemoteAuth archives;
- no customer-supplied YAML, glob pattern, proxy target, or Lodash template-import key is introduced;
- Phase 10B localhost, IPC, CSP, secure-store, and media authorization controls remain green.

Any violation reopens P0-06.
