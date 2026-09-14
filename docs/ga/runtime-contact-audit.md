# PatrolSafe v1.0.0 runtime contact audit

Status: **TECHNICALLY RECONCILED — ALL FIVE MAILBOXES OPERATOR CONFIRMED**

| File / surface | Approved value | Result |
|---|---|---|
| `package.json` contact metadata | All five role addresses | Reconciled |
| `desktop/main.js` About metadata/fallback | `support@sfour.co.uk` | Reconciled |
| `web/src/lib/product-info.ts` | General/support/security/legal/privacy addresses | Reconciled |
| `web/src/pages/license-page.tsx` | `support@sfour.co.uk` | Reconciled |
| Billing self-service fallback | `support@sfour.co.uk` | Reconciled |
| Licence-email fallback/templates | `support@sfour.co.uk` | Reconciled |

Approved role addresses:

- General: `hello@sfour.co.uk`
- Support: `support@sfour.co.uk`
- Security: `security@sfour.co.uk`
- Legal: `legal@sfour.co.uk`
- Privacy: `privacy@sfour.co.uk`

The operator confirms creation of the general, support, security, legal and privacy mailboxes. No substitute privacy address is used.

A deterministic branding/contact contract checks the approved package metadata, asserts the customer runtime contains the canonical support contact, and rejects both legacy support domains. Remaining occurrences of legacy addresses are confined to historical audit evidence, not customer-facing runtime surfaces.
