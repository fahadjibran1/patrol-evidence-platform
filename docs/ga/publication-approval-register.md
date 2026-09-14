# PatrolSafe v1.0.0 publication approval register

Status: **GA PREPARATION — NOT APPROVED FOR PUBLICATION**

Permitted status values are: `APPROVED`, `TECHNICALLY CERTIFIED`, `BUSINESS DECISION REQUIRED`, `LEGAL REVIEW REQUIRED`, and `BLOCKED`.

Phase 11C source baseline: `b785ac88f69acb285b616623b78eb152172be634`. No status below is promoted merely because drafting or technical inventory work is complete.

## Open-item classification

### A. Operator can decide now

- approve final customer claims and international/English-only wording;
- select support hours/time zone, response targets and escalation ownership;
- select licence plans, device allowance, billing model, base/accepted currencies, renewal/cancellation/refund and licence-recovery policy;
- approve staged rollout, cohort size, release/rollback authority and documentation proofreading;
- approve final public artefact only after all other gates close.

### B. Requires factual company information

- confirm company number and registered office;
- decide whether a separate trading/support address is published;
- provide monitored support, privacy, legal-notices and security-vulnerability contacts;
- identify actual sales, licensing, payment, support, hosting/website and secure-transfer providers;
- approve Vesoft retention periods and operational deletion procedures.

### C. Requires legal review

- supported-country/region scope, sanctions/export controls and local-law supplements;
- Privacy Notice, controller/processor roles, DPA applicability and customer privacy checklist;
- EULA, trial/commercial terms, governing law, liability, termination and mandatory local rights;
- international transfers, subprocessors, retention, rights, incident/breach and representative requirements;
- third-party LGPL, compound/special and missing-metadata findings, notices and asset/trademark rights.

### D. Requires release-engineering reconciliation

- replace the two inconsistent runtime support mailboxes only after the operator supplies the approved value;
- resolve external/generated/internal third-party metadata findings through an approved source change where required;
- rerun the third-party inventory against the exact signed GA package and place approved notices as counsel directs;
- create one approved signed GA candidate from the frozen runtime plus approved documentation/metadata changes;
- bind the exact source commit, document revision, installer hash, signature manifest and supported-region approval.

| Approval item | Owner | Status | Evidence / decision required |
|---|---|---|---|
| Final technical Windows UAT | Release engineering | TECHNICALLY CERTIFIED | `out/phase10j3-final-uat-report.md` |
| Global operational timezone | Product/engineering | TECHNICALLY CERTIFIED | Phase 11B tests and `phase11b-timezone-inventory.md`; GA-GLOBAL-01 closed |
| v1 English-only language scope | Product owner | TECHNICALLY CERTIFIED | UI/docs audited; translations are not claimed |
| Windows system requirements | Product/release engineering | TECHNICALLY CERTIFIED | Windows 11 Pro 25H2 x64 UAT; conservative customer wording in `company-identity-and-publication-wording.md` |
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
| Third-party notices | Legal/release engineering | BLOCKED | Repository resolution (488) reconciled to current unsigned package (405 instances / 363 unique versions / 238 collected texts); LGPL, special/compound, missing metadata and exact final signed-package attribution remain unresolved; see `third-party-technical-audit.md` |
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

## Phase 11C decision artefacts

- [Company identity, international, platform, support, commercial and retention wording](company-identity-and-publication-wording.md)
- [Operator decisions required](operator-decisions-required.md)
- [Legal review pack](legal-review-pack.md)
- [Controller/processor matrix](controller-processor-matrix.md)
- [Third-party technical audit](third-party-technical-audit.md)
- [Website/download page copy](website-download-page-copy.md)
- [Controlled rollout plan](first-customer-rollout-plan.md)
- [GA rollback plan](ga-rollback-plan.md)

Approval must refer to the exact source commit, signed installer SHA-256, document revision and countries/regions in scope. Silence or technical certification is not publication approval.
