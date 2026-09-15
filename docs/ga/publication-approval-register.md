# PatrolSafe v1.0.0 publication approval register

Status: **MANAGEMENT APPROVED FOR CONTROLLED B2B PILOT — NOT UNRESTRICTED PUBLIC GA**

Permitted status values include `APPROVED`, `TECHNICALLY CERTIFIED`, `MANAGEMENT APPROVED FOR CONTROLLED PILOT`, `MANAGEMENT RISK ACCEPTED FOR CONTROLLED PILOT`, `NOT PERFORMED`, and `BLOCKED`.

Canonical publisher: **Vesoft Services Limited**, Company No. **08707130**, 241 Manningham Lane, Bradford, BD8 7ER, United Kingdom.

| Approval item | Owner | Status | Evidence / remaining action |
|---|---|---|---|
| Final technical Windows UAT | Release engineering | TECHNICALLY CERTIFIED | `out/phase10j3-final-uat-report.md` |
| Global operational timezone | Product/engineering | TECHNICALLY CERTIFIED | Phase 11B evidence; GA-GLOBAL-01 closed |
| Product/entity/address/tagline | Operator | APPROVED | Canonical identity in `operator-decisions-required.md` |
| General, support, security and legal addresses | Operator | APPROVED | Runtime/docs reconciled; operator states mailboxes created |
| Privacy address and owner | Operator/operations | APPROVED / CONFIRMED | `privacy@sfour.co.uk`; mailbox creation operator-confirmed; owner Vesoft Services Limited |
| v1 English-only scope | Operator | APPROVED | Do not claim translations |
| Initial Windows platform | Operator/release engineering | APPROVED / TECHNICALLY CERTIFIED | Windows 11 x64 only |
| International availability principle | Operator | APPROVED | Exact country/region scope and sanctions/export treatment remain legal review |
| Support hours and response target | Operator | APPROVED | Monday–Friday 09:00–17:00 UK local time excluding UK public holidays; aim for 1–2 business days; not an SLA |
| Corporate operational owners | Operator | APPROVED | Release: Vesoft/company director; support: Vesoft/PatrolSafe support; security, privacy and licence recovery: Vesoft |
| Support-data minimisation | Operations/security | APPROVED | `secure-support-data-transfer.md` defines the escalation order and prohibited routine requests |
| Secure support-transfer method | Operations/privacy/security | APPROVED | Vesoft-controlled restricted Microsoft OneDrive/SharePoint workflow; verified recipients; no unrestricted public links |
| Trial/licence/device/renewal baseline | Operator | APPROVED | 30 days; annual subscription; one workstation; support-assisted recovery; manual annual renewal |
| Public catalogue / legacy compatibility | Operator/engineering | APPROVED / TECHNICALLY CERTIFIED | Customer request flow is Annual-only; existing Three-year/Lifetime licence validation remains compatible |
| Price/currency/tax baseline | Operator | APPROVED | £299 + VAT where applicable/workstation/year; GBP; manual other-currency quotes; applicable taxes wording |
| Cancellation/refund policy | Management/legal risk | MANAGEMENT RISK ACCEPTED FOR CONTROLLED PILOT | Proposed principle remains externally unreviewed; do not claim legal resolution |
| Customer evidence-retention product policy | Operator | APPROVED | No automatic deletion; customer-controlled retention/deletion/backups; uninstall preserves data |
| Vesoft-side retention schedule | Management/legal risk | MANAGEMENT RISK ACCEPTED FOR CONTROLLED PILOT | Exact periods remain unresolved; case receipt/access/deletion must be recorded |
| Privacy Notice | Vesoft management | MANAGEMENT APPROVED FOR CONTROLLED PILOT | External legal review not performed; interpretation risks remain recorded |
| Controller/processor matrix | Vesoft management | MANAGEMENT RISK ACCEPTED FOR CONTROLLED PILOT | Roles remain hypotheses, not externally reviewed legal conclusions |
| DPA applicability and terms | Vesoft management | MANAGEMENT RISK ACCEPTED FOR CONTROLLED PILOT | Use where management determines applicable; external legal review not performed |
| EULA | Vesoft management | MANAGEMENT APPROVED FOR CONTROLLED PILOT | Enforceability, liability, warranty, law and jurisdiction remain externally unreviewed risks |
| Customer privacy deployment checklist | Vesoft management | MANAGEMENT APPROVED FOR CONTROLLED PILOT | Operational checklist; not legal advice or a compliance guarantee |
| Pilot countries/regions | Vesoft management | MANAGEMENT APPROVED FOR CONTROLLED PILOT | Record and approve each business pilot/customer jurisdiction before supply; no runtime allowlist |
| Broad public/international scope | Vesoft management | BLOCKED | Controlled pilot approval does not authorise unrestricted worldwide public GA |
| Third-party inventory engineering | Release engineering | TECHNICALLY CERTIFIED | 488 repository records → 403 shipped instances / 361 unique versions / 241 texts; zero shipped metadata gaps |
| Third-party obligations/notices | Vesoft management | MANAGEMENT RISK ACCEPTED FOR CONTROLLED PILOT | Technically inventoried; notices preserved; two LGPL and four special/compound interpretations externally unreviewed |
| Staged rollout | Operator | APPROVED | Four stages and corporate release authority approved; each pilot/customer jurisdiction recorded before sale |
| Manual licence recovery | Operations | APPROVED | `licence-recovery-procedure.md`; support-assisted, verified and recorded; no automated entitlement transfer |
| Licence-recovery target | Operations | APPROVED | Normally 1–2 business days during support hours; not an SLA or guarantee |
| External legal review | External counsel | NOT PERFORMED | Vesoft management explicitly elected to proceed with controlled B2B pilot risk acceptance |
| Legal risk acceptance | Vesoft management | MANAGEMENT APPROVED FOR CONTROLLED PILOT | `legal-risk-acceptance.md` binds scope, unresolved risks and frozen hash set |
| Runtime contact reconciliation | Engineering | TECHNICALLY CERTIFIED | Approved role addresses applied; deterministic legacy-domain test added |
| Customer-document consistency | Product/release engineering | TECHNICALLY CERTIFIED | Phase 11G controlled-pilot status/contact/commercial consistency audit |
| Final signed package inventory association | Release engineering | TECHNICALLY CERTIFIED | v1.0.1 signed tree reconciled: 403 instances / 361 unique versions / 241 texts; inventory SHA-256 `DC45DBF4BC2C5D463597FCC536DACAC6C49A41B74378B2D5436FCB7DB8D2E963` |
| Final installer/hash/signature association | Release engineering | TECHNICALLY CERTIFIED | v1.0.1 candidate association in `final-release-association-v1.0.1.md`; public download not authorized |
| Controlled pilot distribution authorisation | Vesoft company director | APPROVED | Exact immutable v1.0.0 candidate authorized for Stage 1 and up to 13 individually approved Stage 2 B2B businesses |
| Public 30-day trial download | Vesoft company director | BLOCKED | Signed v1.0.1 candidate is technically certified; explicit public-download authorization is still required |
| Unrestricted worldwide public GA | Vesoft management | BLOCKED | Not approved by this controlled-pilot risk acceptance |

## Approved contacts

- General: `hello@sfour.co.uk`
- Support: `support@sfour.co.uk`
- Security: `security@sfour.co.uk`
- Legal: `legal@sfour.co.uk`
- Privacy: `privacy@sfour.co.uk` — mailbox creation operator-confirmed

## Management risk acceptance

External legal review was not performed. Vesoft management approved the current frozen legal-document set and accepted the recorded unresolved risks for Stage 1 and Stage 2 controlled B2B pilot use only. See [legal-risk-acceptance.md](legal-risk-acceptance.md) and the frozen [legal-review snapshot](legal-review/README.md).

The pilot release record must identify the exact source commit, documentation commit, signed installer SHA-256, manifest, third-party inventory hash and approved customer/jurisdiction. Management acceptance is not counsel approval and does not authorise unrestricted public GA. Final signed-artifact association remains the release-engineering gate.
