# Release Notes

## Version 0.1 Trial

Patrol Evidence Platform `0.1` is the first trial-ready desktop release for customer evaluation.

### Included in this trial release

- desktop-first setup wizard
- local trial licence key activation
- local PostgreSQL helper and database setup flow
- WhatsApp QR linking
- site creation and WhatsApp group mapping
- patrol schedule setup
- Evidence, Dashboard, Guard Safe, Collector, and Setup pages
- timestamp-stamped evidence image storage
- customer-friendly PostgreSQL diagnostics with copyable report

### Trial behaviour

- trial licence status is shown in the app
- collector start is blocked if the trial is invalid or expired
- existing evidence remains viewable if the trial expires
- customer data is not deleted on expiry

### Packaging notes

- packaged desktop app output is created under `out/`
- Windows installer output is created under `out/make/`

### Known limitations in this trial

- local licence validation only
- no cloud billing or payment integration
- no online account management
- desktop and local-workstation setup is the primary supported flow

### Recommended internal handover documents

- [TRIAL_RELEASE_CHECKLIST.md](C:\Users\Admin\patrol-evidence-platform\TRIAL_RELEASE_CHECKLIST.md)
- [CUSTOMER_HANDOVER_GUIDE.md](C:\Users\Admin\patrol-evidence-platform\CUSTOMER_HANDOVER_GUIDE.md)
