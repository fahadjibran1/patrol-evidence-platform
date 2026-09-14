# PatrolSafe v1.0.0 company identity and publication wording

Status: **PUBLICATION DECISION DRAFT — NOT APPROVED FOR PUBLICATION**

This document separates repository facts, technically certified statements, recommended wording and decisions that an authorised Vesoft owner or legal counsel must approve. A recommendation is not an approval.

## Company identity decision table

| Field | Repository/document proposal | Evidence status | Approval needed |
|---|---|---|---|
| Product | PatrolSafe by S4 | TECHNICALLY CERTIFIED | Product owner to approve public use |
| Tagline | Patrol evidence. Automatically organised. | TECHNICALLY CERTIFIED | Product owner to approve public use |
| Legal publisher/software company | Vesoft Services Limited | TECHNICALLY CERTIFIED in signed UAT metadata | Company secretary/legal to approve legal-document use |
| Country of establishment | United Kingdom | Supplied business fact | Company secretary/legal confirmation |
| Company number | 08707130 | Proposed in Phase 11A after Companies House research | **TO BE CONFIRMED BEFORE PUBLICATION** |
| Registered office | 241 Manningham Lane, Office 1a, Bradford, England, BD8 7ER | Proposed in Phase 11A after Companies House research | **TO BE CONFIRMED BEFORE PUBLICATION** |
| Trading/support address | None approved | UNKNOWN | Business decision; do not substitute the registered office automatically |
| Support email | Runtime currently differs: `support@techguardsecurity.com` and `support@techguards.co.uk` | INCONSISTENT | One monitored customer route must be approved; runtime reconciliation then required |
| Privacy email | None approved | PLACEHOLDER | Legal/business decision |
| Legal-notices email/address | None approved | PLACEHOLDER | Legal/business decision |
| Security vulnerability contact | None approved | PLACEHOLDER | Security/business decision and secure-channel definition |

Canonical placeholders for all unpublished materials are `SUPPORT_EMAIL`, `PRIVACY_EMAIL`, `SECURITY_EMAIL`, and `LEGAL_EMAIL`. The reusable identity block and approval fields are in `operator-decisions-required.md`; no candidate company number, address or mailbox is approved by repetition in this document.

No unapproved address or mailbox may be copied into customer material merely to remove a placeholder.

## Approved-shape international wording

The following copy is complete as drafting text but remains subject to product-owner and legal approval.

### Website

> PatrolSafe is available internationally in supported countries and regions, subject to applicable law, sanctions and export restrictions, WhatsApp availability, Microsoft Windows availability, and Vesoft commercial availability.

### Software licence terms

> PatrolSafe may be licensed for use in supported countries and regions. Availability and permitted use are subject to the applicable order, law, sanctions and export restrictions, third-party service availability, and Vesoft commercial availability. Vesoft does not represent that PatrolSafe is available or lawful for every country, customer or use.

### Privacy notice

> PatrolSafe may be offered internationally in supported countries and regions. Local operation does not by itself upload the PatrolSafe operational database or evidence to Vesoft. International transfers may nevertheless arise through WhatsApp/Meta, Microsoft services, customer-selected storage, licensing, support, or Vesoft suppliers. Applicable transfer safeguards must be identified for each approved launch and processing arrangement.

### Support page

> Support is available only through the approved channels and for supported countries, regions, product versions and service hours. Third-party availability, local network restrictions, sanctions/export restrictions and local law may affect whether PatrolSafe can be supplied or supported.

### Release notes

> PatrolSafe v1.0 is designed for international operation in supported countries and regions. Each workspace uses a customer-selected IANA time zone for patrol schedules, evidence dates and daily reporting. The v1.0 interface and support documentation are provided in English.

These statements intentionally do not say “available everywhere”, “works in every country” or “globally compliant”. A country/region release scope and export/sanctions review remain mandatory.

## Language statement

Customer-facing wording:

> PatrolSafe v1.0 is currently provided in English.

English-only is a v1 product scope. It does not make operational timezone support UK-only and does not imply translations exist.

## Certified system-requirements wording

> PatrolSafe v1.0 is a Windows 11 x64 desktop application. It requires Microsoft Edge, reliable outbound internet access to WhatsApp Web, an eligible and authorised WhatsApp account, and a Windows account permitted to install desktop software and write to the selected evidence and backup locations. The clean release UAT used Windows 11 Pro 25H2 x64, Microsoft Edge, 2 vCPU, 8 GB RAM, and 1366×768 and 1920×1080 displays. Other Windows editions, Windows 10, Windows Server, Arm64, macOS and Linux are not certified by this release record. Evidence and backups grow with image volume; the customer must provide, protect and monitor sufficient storage for its retention policy. Organisational Windows policy may require administrator approval for installation or removal.

No fixed customer disk minimum is asserted. Microsoft Edge must remain supported and updated, and Defender, SmartScreen and firewall protections should not be disabled to install PatrolSafe.

## Support-policy decisions

| Decision | Current status | Recommendation (not approved policy) |
|---|---|---|
| Support email/channel | No consistent approved value | Use one Vesoft-controlled, monitored mailbox; publish it consistently in product/docs/site |
| Privacy contact | Not approved | Use a dedicated monitored privacy route with an accountable owner |
| Legal notices | Not approved | Use an address and/or mailbox approved for formal service; counsel to define permitted methods |
| Security vulnerability contact | Not approved | Provide a monitored security route and a secure alternative to ordinary email for sensitive files |
| Support hours | Not approved | Monday–Friday, 09:00–17:00 UK local time, excluding UK public holidays, if operations can resource it |
| Support time zone | Not approved | Publish `Europe/London` and “UK local time” so daylight-saving handling is unambiguous |
| Response target | No SLA | “We aim to respond within 1–2 business days,” only if operations can measure it; this is not an SLA |
| Severity/escalation | Not approved | Define emergency security, service-blocking, major and routine request paths before pilots |

## Commercial-policy decision register

| Topic | Encoded/audited product behavior | Publication decision still required |
|---|---|---|
| Trial | An eligible local installation can receive a 30-day trial; a prior trial is not automatically reissued | Evaluation eligibility, permitted use, support and any regional exclusions |
| Licence mechanism | Signed, workstation-bound, offline request/import; plans/types exist in code | Which plan(s) will actually be sold and customer-facing names |
| Subscription/perpetual | Runtime types include monthly, annual, full/lifetime/three-year representations across current and legacy paths | Authoritative v1 catalogue and treatment of legacy/full terms |
| Billing frequency | No live desktop billing | Order/invoice cadence and renewal notice |
| Base currency | Desktop shows no price/currency | Base and settlement currency by sales channel |
| Regional currency | Not implemented in desktop | Whether quoted locally, converted by provider, or limited by sales region |
| VAT/tax | Not calculated by desktop | Seller-of-record, VAT/GST/sales-tax collection and invoice rules by region |
| Cancellation/renewal/refunds | Not encoded as a complete customer policy | Terms, deadlines, renewal method, refunds and mandatory local rights |
| Licence recovery | Replacement machine requires supplier-assisted recovery/new entitlement | Verification, turnaround, permitted frequency and lost-device process |
| Devices/installations | Entitlement binds to an installation identity | Number of authorised installations per order and transfer/reassignment rules |

No price, SLA, refund right, renewal promise or device allowance is approved by this table.

## Retention wording

Factual customer wording:

> PatrolSafe v1.0 does not automatically delete evidence or the local workspace. The customer controls how long operational data and backups are retained and is responsible for applying its documented retention, legal-hold and secure-deletion requirements. Uninstall removes the application but preserves customer AppData and separately selected evidence. Backups may contain personal data, security imagery, password hashes and machine-bound session material and must be protected and deleted across all copies when no longer required.

Recommended policy statement for legal review:

> Before operational use, the customer should approve retention periods by data category and purpose, identify any legal or contractual minimums and holds, assign an owner, review retained data periodically, and use a verified secure-erasure process for expired evidence, logs, workstations and backups. No universal period is supplied because requirements differ by purpose and jurisdiction.

Vesoft's own licensing, customer-account, support, security and submitted-data retention periods remain **BUSINESS DECISION REQUIRED** and **REQUIRES LEGAL REVIEW**.
