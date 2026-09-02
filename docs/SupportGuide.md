# Support Guide

## Scope

Support covers the Licence Admin Portal, Customer Portal, TG1 desktop activation, and Stripe Checkout reconciliation (internal billing remains authoritative).

## Roles

| Actor | Access |
|-------|--------|
| SUPER_ADMIN | Full admin + admin user management |
| ADMIN | Licences, billing, Stripe operations, customers, system status |
| SUPPORT | Read-mostly; no payment recording / licence issue |
| Customer Owner/Admin/Finance | Org + billing + Checkout / payment method |
| Customer Technical | Downloads |
| Customer Viewer | Read-only |

## Common tickets

1. **Cannot login** — check email verified, account active, org membership.
2. **Licence download forbidden** — role lacks `DOWNLOAD_LICENCE` (Finance/Viewer).
3. **Email not received** — System Status SMTP + NotificationLog status.
4. **Subscription wrong plan** — admin change-plan; licence sync via domain events.
5. **Manual payment** — ADMIN records bank transfer / cash against open invoice.

## Never do

- Share JWT, SMTP passwords, TG1 full keys, or encryption keys in tickets.
- Run `CONFIRM_RESTORE=YES` without change control.
- Issue licences without customer identity verification.

## Diagnostics

- Admin System Status
- **Support ops** (`/support`) — resend failed notifications, unlock accounts, rebuild licence from subscription, Stripe resync, webhook reprocess, reset billing flags (SUPER_ADMIN)
- Audit log (`customer.*` vs admin actions / `support.*`)
- `/system/version` for release confirmation
- Stripe operations page for DLQ / price mappings

## RC1 references

- [RC1-GoLiveReport](RC1-GoLiveReport.md)
- [RC1-OperationsChecklist](RC1-OperationsChecklist.md)
- [Runbook](Runbook.md)
