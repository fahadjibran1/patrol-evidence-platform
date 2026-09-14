# PatrolSafe v1.0.0 runtime contact audit

Status: **BUSINESS DECISION REQUIRED — NO RUNTIME CONTACT CHANGE MADE**

Canonical placeholders: `SUPPORT_EMAIL`, `PRIVACY_EMAIL`, `SECURITY_EMAIL`, and `LEGAL_EMAIL`.

| File / route | Current value or source | Customer effect | Required action after approval |
|---|---|---|---|
| `package.json` product metadata | `support@techguardsecurity.com` | Feeds packaged product metadata | Replace with approved `SUPPORT_EMAIL` |
| `desktop/main.js` About-product metadata | Package support email; fallback `support@techguardsecurity.com` | About dialog can display the legacy address | Replace fallback and metadata only after approval |
| `web/src/lib/product-info.ts` | `support@techguardsecurity.com` | About dialog support link | Replace with approved `SUPPORT_EMAIL` |
| `web/src/pages/license-page.tsx` | `support@techguards.co.uk` | Licence assistance mail link | Replace with approved `SUPPORT_EMAIL` |
| `apps/license-api/src/billing/customer-billing/customer-self-service.service.ts` | `SUPPORT_EMAIL` environment value with `support@techguardsecurity.com` fallback | Billing/support correspondence can use the legacy fallback | Configure approved value and reconcile fallback |
| `apps/license-api/src/licences/licences.service.ts` | SMTP from-address fallback `support@techguards.co.uk` | Licensing email sender can use the other legacy address | Approve whether this is also `SUPPORT_EMAIL` or a separate operational sender |
| Licence email templates | Accept an injected support email | Display depends on service configuration | Supply only the approved value |

No approved runtime privacy, vulnerability or legal-notices address was found. Documentation intentionally retains placeholders.

A runtime contact change **is required** before a public GA build because two inconsistent legacy support domains are customer-visible. The correct change cannot be made until the operator approves `SUPPORT_EMAIL` and decides whether the licensing sender uses the same address. No runtime files were changed in Phase 11D.

After approval, make a contact-only source change and add a contract test asserting the approved customer support address is consistent across product metadata, About, Licence and relevant service configuration. Do not conflate privacy, security or legal routes unless the operator approves the same monitored mailbox for those purposes.
