# PatrolSafe v1.0.0 third-party counsel review record

Status: **TECHNICALLY INVENTORIED — MANAGEMENT RISK ACCEPTED FOR CONTROLLED PILOT — EXTERNAL LEGAL REVIEW NOT PERFORMED**

Audited unsigned package source HEAD: `2a1cf8621ad4496b3db05cb35719b68adcb2cc3b`<br>
Packaged dependency inventory SHA-256: `DC45DBF4BC2C5D463597FCC536DACAC6C49A41B74378B2D5436FCB7DB8D2E963`

Package files were compared with the installed npm source tree. Every shipped file for the six review records was byte-identical to its source package counterpart. `rc` and `sha.js` had test/development files omitted by packaging, but no shipped file differed. No PatrolSafe-authored modification to these package files was identified. This does not decide whether bundling, linking or distribution obligations are satisfied.

## LGPL records

| Package | Version | Shipped/how bundled | Declared expression and text | Technical facts | Question for counsel |
|---|---:|---|---|---|---|
| `@img/sharp-win32-x64` | 0.35.4 | Yes; optional runtime of `sharp`, unpacked under `resources/app/node_modules`; includes `sharp-win32-x64-0.35.4.node`, `libvips-42.dll` and `libvips-cpp-8.18.6.dll` as separate files | `Apache-2.0 AND LGPL-3.0-or-later`; bundled `LICENSE` SHA-256 `DC1F5D2D43C5531DFE0ACAF4E950EA5DBE3E61E1850CF0E983BDA7EFC10D6693` | Eight of eight package files are byte-identical to the npm installation; native addon loads separately distributed DLL components at runtime | What notices, source/code offer, relinking/replacement mechanism and delivery location are required for the LGPL-covered libvips distribution? |
| `node-webpmux` | 3.2.1 | Yes; runtime dependency of `whatsapp-web.js`, unpacked under `resources/app/node_modules`; JavaScript plus `libwebp.wasm` and accompanying binding/source file | `LGPL-3.0-or-later`; bundled `COPYING.LESSER` SHA-256 `E3A994D82E644B03A792A930F574002658412F62407F5FEE083F2555C5F23118` | Twelve of twelve package files are byte-identical to the npm installation; distributed as package JS/WASM rather than merged into PatrolSafe source | What LGPL notices, corresponding-source/relinking obligations and distribution method must accompany this JS/WASM package? |

## Special and compound expressions

| Package | Version | Shipped/how bundled | Expression and collected text | Technical modification status | Question for counsel |
|---|---:|---|---|---|---|
| `argparse` | 2.0.1 | Yes; transitive through `js-yaml` | `Python-2.0`; `LICENSE` SHA-256 `DE4D1F2D2AD5AD0CFD1657A106476B31CB5DB5EF9D1FF842B237C0C81F0C8A23` | 7/7 shipped files identical | Is the collected notice sufficient and where must it be displayed/distributed? |
| `expand-template` | 2.0.3 | Yes; transitive through `better-sqlite3` → `prebuild-install` | `MIT OR WTFPL`; `LICENSE` SHA-256 `0967624813244BF47DA346449804AF853437433CBDEB8C977F1E0D4BD14E0A3B` | 6/6 shipped files identical | Which alternative should Vesoft rely on and how should that choice be recorded? |
| `rc` | 1.2.8 | Yes; transitive through `better-sqlite3` → `prebuild-install` | `BSD-2-Clause OR MIT OR Apache-2.0`; supplied hashes: Apache `E8734448285A2DD773D40136ED5D5E8163A70701DD540CDC796CFCA232F67D55`, BSD `65E7E4D223688C601F42959DEFDE380F8C4AA677FA4706DA3B4A53F129BD78A3`, MIT `D72DEA1A8CDF3F4DFA2F594253D0C5B37BAEFC76E806F5ECB0E426393EDCD505` | 17 shipped files identical; 3 non-shipped files omitted | Which alternative should Vesoft rely on and which notice text should be distributed? |
| `sha.js` | 2.4.12 | Yes; transitive through `typeorm` | `MIT AND BSD-3-Clause`; combined `LICENSE` SHA-256 `58DCF38BE1438F739412B87EB70D64BF00E9976D529BB119F700D8B3167924F0` | 14 shipped files identical; 3 non-shipped files omitted | Does the collected combined text satisfy both obligations and where must it be made available? |

## Counsel output requested

For each record, return the approved interpretation, required notice/source/relinking action, exact customer-facing text, required distribution location and any continuing compliance process. Release engineering will then reconcile that approved treatment against the exact signed GA package. No legal conclusion is made by this record.
