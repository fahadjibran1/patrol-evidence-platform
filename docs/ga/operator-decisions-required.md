# PatrolSafe v1.0.0 operator decisions required

Status: **ACTION REQUIRED — COMPLETE AND APPROVE BEFORE GA SIGNING OR PUBLICATION**

Recommendations are not approvals. Record the final value, approver and date in the approval column. Legal-review items require qualified counsel and cannot be approved through this operator register alone.

## Canonical company identity block

Use this block only after every bracketed value is explicitly approved:

> **PatrolSafe by S4**<br>
> Published by **Vesoft Services Limited**, a company established in the United Kingdom.<br>
> Company number: **[COMPANY_NUMBER — candidate 08707130; not approved]**<br>
> Registered office: **[REGISTERED_OFFICE — not approved]**<br>
> Trading/support address: **[TRADING_SUPPORT_ADDRESS or “not published” — not approved]**<br>
> Support: **[SUPPORT_EMAIL]**<br>
> Privacy: **[PRIVACY_EMAIL]**<br>
> Security reports: **[SECURITY_EMAIL]**<br>
> Legal notices: **[LEGAL_EMAIL]**

No address or mailbox is approved by this template.

## Actionable decision table

| QUESTION | CURRENT STATE | RECOMMENDED DEFAULT | OPERATOR APPROVAL REQUIRED |
|---|---|---|---|
| Confirm company number | Candidate `08707130`; not approved | Verify against the current official company record immediately before approval | Final number, approver, date: **[blank]** |
| Confirm registered office | A previously researched address exists in drafts but is not approved | Company secretary/legal supplies the exact publishable address | Final address, approver, date: **[blank]** |
| Publish a trading/support address? | None approved | Publish none unless Vesoft has a monitored service address | Final value, approver, date: **[blank]** |
| Approve customer support email | Runtime currently contains two inconsistent legacy addresses | One monitored Vesoft-controlled mailbox: `SUPPORT_EMAIL` | Address, owner, approver, date: **[blank]** |
| Approve privacy contact | No approved value | Dedicated monitored route: `PRIVACY_EMAIL` | Address, owner, approver, date: **[blank]** |
| Approve vulnerability contact | No approved value | Monitored route plus a secure method for sensitive files: `SECURITY_EMAIL` | Address/secure route, owner, approver, date: **[blank]** |
| Approve legal-notices contact | No approved value | Counsel-approved formal-notice route: `LEGAL_EMAIL` | Address/method, approver, date: **[blank]** |
| Approve support days and hours | No published policy | Monday–Friday, 09:00–17:00 Europe/London (UK local time), excluding UK public holidays | Final schedule, approver, date: **[blank]** |
| Approve support response target | No SLA or target approved | “We aim to respond within 1–2 business days.” Treat as a target, not an SLA | Wording, owner, approver, date: **[blank]** |
| Approve support escalation and vulnerability route | No named operational owners | Name primary/deputy support, release and security owners; define emergency escalation | Owners/routes, approver, date: **[blank]** |
| Approve international launch wording | Draft is technically accurate; country scope and legal review remain open | “PatrolSafe is available internationally in supported countries and regions, subject to applicable law, sanctions/export restrictions, WhatsApp availability, Microsoft Windows availability, and Vesoft commercial availability.” | Wording/scope, approver, date: **[blank]** |
| Approve v1 language scope | Product and docs are English-only | “PatrolSafe v1.0 is currently provided in English.” | Approver, date: **[blank]** |
| Approve initial certified platform | Windows 11 Pro 25H2 x64 passed UAT; other platforms are not certified | Windows 11 x64 initial certified platform; Microsoft Edge and reliable internet required | Approver, date: **[blank]** |
| Approve trial offer | Runtime provides an eligible 30-day trial | 30-day evaluation trial, subject to approved terms | Eligibility/terms, approver, date: **[blank]** |
| Approve licence model | Runtime supports signed workstation-bound entitlements; catalogue not approved | Annual subscription | Final model, approver, date: **[blank]** |
| Approve device allowance | Entitlement binds to an installation identity; commercial allowance undefined | One Windows workstation per licence | Allowance, approver, date: **[blank]** |
| Approve replacement-device recovery | Support-assisted technical recovery is required | Support-assisted verification and licence recovery for a replacement workstation | Process/limits/owner, approver, date: **[blank]** |
| Approve renewal and automatic renewal | No complete billing/renewal policy or live desktop payment flow | Annual renewal; **no automatic renewal unless the actual billing system supports and discloses it** | Final policy, approver, date: **[blank]** |
| Set annual price | No price approved or displayed by the desktop | **[No recommendation; finance/commercial decision]** | Annual price: **[blank]** |
| Approve base and other currencies | Desktop has no currency or payment flow | GBP for initial launch; other currencies quoted manually or introduced through future regional pricing | Base/accepted currencies, approver, date: **[blank]** |
| Approve tax wording | Desktop does not calculate tax | “Applicable taxes may be added where required.” Do not present UK VAT as a worldwide rule | Seller of record/tax process, approver, date: **[blank]** |
| Approve cancellation notice | No policy approved | Counsel drafts a clear B2B notice period preserving mandatory local rights | Notice period: **[blank]** — **LEGAL REVIEW REQUIRED** |
| Approve refund policy | No policy approved | Business software licence fees generally non-refundable after activation, except where required by applicable law | Final policy: **[blank]** — **LEGAL REVIEW REQUIRED** |
| Confirm customer evidence-retention policy | Product has no automatic retention deletion | Confirm that customers control evidence deletion, retention and backup retention and must apply their own workplace/privacy policy | Confirm/exception, approver, date: **[blank]** |
| Approve Vesoft-side retention | Licensing, sales, support and submitted-diagnostic periods are undefined | Purpose-based periods; minimise operational data and delete case-specific copies promptly | Schedule/owner, approver, date: **[blank]** — **LEGAL REVIEW REQUIRED** |
| Approve staged rollout | Rollout plan drafted; no owner/cohort authorised | Stage 1 Vesoft-controlled deployment; Stage 2 one to three friendly pilots; Stage 3 controlled public availability; Stage 4 broader international rollout | Cohort/caps/owner/deputy, approver, date: **[blank]** |
| Approve rollback authority | Plan exists; no named authority | Name primary/deputy able to stop downloads, notify customers and commission a replacement signed build | Owners, approver, date: **[blank]** |
| Approve third-party notice placement | Exact unsigned-package inventory and draft bundle are technically complete | Counsel approves obligations and location; release engineering reruns against exact signed GA package | Legal decision/placement, approver, date: **[blank]** |
| Approve final immutable release association | No final signed GA installer exists | One approval record binding source commit, docs commit, build ID, installer hash, signature and inventory hash | Final release officer/date: **[blank]** |

## Legal decisions that remain outside operator-only approval

Privacy Notice, EULA, DPA applicability, controller/processor roles, international transfers, sanctions/export controls, refund/cancellation legal terms, third-party licence interpretation, governing law, liability and mandatory regional rights remain **LEGAL REVIEW REQUIRED**.
