# PatrolSafe v1.0.0 publication approval register

Status: **GA PREPARATION — NOT APPROVED FOR PUBLICATION**

Permitted status values are: `APPROVED`, `TECHNICALLY CERTIFIED`, `BUSINESS DECISION REQUIRED`, `LEGAL REVIEW REQUIRED`, and `BLOCKED`.

| Approval item | Owner | Status | Evidence / decision required |
|---|---|---|---|
| Final technical Windows UAT | Release engineering | TECHNICALLY CERTIFIED | `out/phase10j3-final-uat-report.md` |
| Global operational timezone | Product/engineering | TECHNICALLY CERTIFIED | Phase 11B tests and `phase11b-timezone-inventory.md`; GA-GLOBAL-01 closed |
| v1 English-only language scope | Product owner | TECHNICALLY CERTIFIED | UI/docs audited; translations are not claimed |
| Product claims and GA release wording | Product owner | BUSINESS DECISION REQUIRED | Approve exact claims against certified functions |
| Supported countries/regions | Commercial + legal | BLOCKED | No approved country/region launch scope, sanctions/export or service-availability matrix |
| Privacy notice | Legal/privacy owner | LEGAL REVIEW REQUIRED | `privacy-notice-draft.md` remains a draft |
| Customer privacy deployment checklist | Legal/privacy owner | LEGAL REVIEW REQUIRED | `customer-privacy-deployment-checklist-draft.md` remains a draft |
| Controller/processor position | Legal/privacy owner | LEGAL REVIEW REQUIRED | Confirm roles by sales, licensing, support and operational-data scenario |
| Customer data-processing terms | Legal/privacy owner | LEGAL REVIEW REQUIRED | Confirm applicability and execute approved terms where required |
| Software licence/EULA | Legal counsel | LEGAL REVIEW REQUIRED | Governing law, warranties, liability, updates, termination and order precedence unresolved |
| Vesoft company number/address | Company secretary/legal | BUSINESS DECISION REQUIRED | Companies House research is `TO BE CONFIRMED BEFORE PUBLICATION`; do not publish until explicitly approved |
| Customer support contact | Support/business owner | BLOCKED | Code/docs contain `support@techguardsecurity.com`, `support@techguards.co.uk`, and placeholders; approve one monitored route and relationship to Vesoft |
| Privacy/legal/security contacts | Legal/business owner | BLOCKED | No approved privacy contact, legal notice contact, incident route or representative details |
| Support hours/SLA/escalation | Support/business owner | BUSINESS DECISION REQUIRED | No service level is promised by drafts |
| Pricing, tax and payment availability | Commercial/finance | BUSINESS DECISION REQUIRED | Desktop has no payment flow; international price/currency/tax policy not approved |
| Export controls and sanctions screening | Legal/compliance | BLOCKED | Required before approving supported countries/regions |
| Operational and support-data retention | Legal/privacy + customer policy owner | BLOCKED | No approved Vesoft support retention or product default evidence retention schedule |
| Third-party notices | Legal/release engineering | BLOCKED | 488 unique production dependency/version records audited from current install; metadata gaps/compound licences and exact final-package attribution remain unresolved |
| Final documentation proofreading | Product/support | BUSINESS DECISION REQUIRED | Customer and legal drafts need owner review after decisions above |
| Final installer/hash association | Release engineering | BLOCKED | Phase 11B is unsigned by instruction; a later approved signed GA candidate must be tied to exact docs/source/hash |
| GA publication authorisation | Authorised Vesoft officer | BLOCKED | No push, tag, release or publication authorised |

## Contact inconsistencies requiring a business decision

| Location | Current value | Status |
|---|---|---|
| Root package metadata / About panel | `support@techguardsecurity.com` | BUSINESS DECISION REQUIRED |
| Licence customer action | `support@techguards.co.uk` | BUSINESS DECISION REQUIRED |
| Privacy notice | `[TO BE CONFIRMED]` | BLOCKED |
| Support guide | `[TO BE CONFIRMED]` | BLOCKED |
| Security incident route | `[TO BE CONFIRMED]` | BLOCKED |

No address has been selected arbitrarily. Approval must identify the monitored mailbox, secure route for sensitive diagnostics, service owner and relationship to Vesoft Services Limited.

Approval must refer to the exact source commit, signed installer SHA-256, document revision and countries/regions in scope. Silence or technical certification is not publication approval.
