# PatrolSafe v1.0.0 publication approval register

Status: **GA PREPARATION — NOT APPROVED FOR SIGNING OR PUBLICATION**

Permitted status values: `APPROVED`, `TECHNICALLY CERTIFIED`, `BUSINESS DECISION REQUIRED`, `LEGAL REVIEW REQUIRED`, and `BLOCKED`.

| Approval item | Owner | Status | Evidence / remaining action |
|---|---|---|---|
| Final technical Windows UAT | Release engineering | TECHNICALLY CERTIFIED | `out/phase10j3-final-uat-report.md` |
| Global operational timezone | Product/engineering | TECHNICALLY CERTIFIED | Phase 11B evidence; GA-GLOBAL-01 closed |
| Product/entity/address/tagline | Operator | APPROVED | Canonical identity in `operator-decisions-required.md` |
| General, support, security and legal addresses | Operator | APPROVED | Runtime/docs reconciled; operator states mailboxes created |
| Privacy address | Operator | APPROVED | `privacy@sfour.co.uk`; **mailbox delivery confirmation remains BLOCKED** |
| v1 English-only scope | Operator | APPROVED | Do not claim translations |
| Initial Windows platform | Operator/release engineering | APPROVED / TECHNICALLY CERTIFIED | Windows 11 x64 only |
| International availability principle | Operator | APPROVED | Exact country/region scope and sanctions/export treatment remain legal review |
| Support hours and response target | Operator | APPROVED | Monday–Friday 09:00–17:00 UK local time excluding UK public holidays; aim for 1–2 business days; not an SLA |
| Support/escalation owners and secure transfer | Operations/security | BUSINESS DECISION REQUIRED | Name staff and approved sensitive-file route |
| Trial/licence/device/renewal baseline | Operator | APPROVED | 30 days; annual subscription; one workstation; support-assisted recovery; manual annual renewal |
| Public catalogue / legacy compatibility | Operator/engineering | APPROVED / TECHNICALLY CERTIFIED | Customer request flow is Annual-only; existing Three-year/Lifetime licence validation remains compatible |
| Price/currency/tax baseline | Operator | APPROVED | £299 + VAT where applicable/workstation/year; GBP; manual other-currency quotes; applicable taxes wording |
| Cancellation/refund policy | Legal/commercial | LEGAL REVIEW REQUIRED | Proposed non-refundable-after-activation principle is not contractual wording |
| Customer evidence-retention product policy | Operator | APPROVED | No automatic deletion; customer-controlled retention/deletion/backups; uninstall preserves data |
| Vesoft-side retention schedule | Legal/privacy + operations | BLOCKED | Purpose-specific licence, support, security and submitted-data periods not approved |
| Privacy Notice | Legal/privacy | LEGAL REVIEW REQUIRED | Factual identity/contact populated; legal bases, rights, roles and transfers unresolved |
| Controller/processor matrix | Legal/privacy | LEGAL REVIEW REQUIRED | Confirm each processing activity |
| DPA applicability and terms | Legal/privacy | LEGAL REVIEW REQUIRED | Local operation alone does not establish processor status |
| EULA | Legal counsel | LEGAL REVIEW REQUIRED | Commercial facts populated; liability, warranty, governing law, termination and regional terms unresolved |
| Customer privacy deployment checklist | Legal/privacy | LEGAL REVIEW REQUIRED | Operational draft remains unapproved |
| Supported launch countries/regions | Commercial/legal | BLOCKED | Country list and sanctions/export/local-law screening not supplied |
| Third-party inventory engineering | Release engineering | TECHNICALLY CERTIFIED | 488 repository records → 403 shipped instances / 361 unique versions / 241 texts; zero shipped metadata gaps |
| Third-party legal obligations/notices | Legal counsel | LEGAL REVIEW REQUIRED | Two LGPL and four special/compound expressions plus placement/asset review |
| Staged rollout | Operator | APPROVED | Four stages approved; owners and exact cohort controls remain required |
| Runtime contact reconciliation | Engineering | TECHNICALLY CERTIFIED | Approved role addresses applied; deterministic legacy-domain test added |
| Customer-document consistency | Product/release engineering | TECHNICALLY CERTIFIED | Phase 11E consistency audit; legal drafts retain review banners |
| Final signed package inventory association | Release engineering | BLOCKED | Must rerun against future exact signed GA artifact |
| Final installer/hash/signature association | Release engineering | BLOCKED | No final signed GA installer exists; complete `final-release-association-template.md` later |
| GA publication authorisation | Authorised Vesoft officer | BLOCKED | No signing, push, tag, release or publication authorised |

## Approved contacts

- General: `hello@sfour.co.uk`
- Support: `support@sfour.co.uk`
- Security: `security@sfour.co.uk`
- Legal: `legal@sfour.co.uk`
- Privacy: `privacy@sfour.co.uk` — delivery must be operationally confirmed before publication

## Mandatory legal handoff

Counsel must review the Privacy Notice, EULA, DPA/roles, UK GDPR and international positioning, transfers, sanctions/export wording, cancellation/refunds, governing law/jurisdiction, liability/warranties, termination, retention/deletion, regional business/consumer rules and third-party obligations. See [legal-review-pack.md](legal-review-pack.md) and the frozen [legal-review snapshot](legal-review/README.md).

Approval must identify the exact source commit, documentation commit, signed installer SHA-256, manifest, third-party inventory hash, supported regions and legal approval revision. Technical completion or silence is not publication approval.
