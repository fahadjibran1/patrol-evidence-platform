# Release Notes

## Version 0.1 Trial

PatrolSafe by S4 `0.1` is the first trial-ready desktop release for customer evaluation.

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
- commercial TG1 licences require `resources/license-public.pem` in the repository and in every packaged build
- Electron Forge copies that public key into the packaged app via `extraResource` at `resources/license-public.pem`
- the private key must never be committed, packaged, or copied into customer builds

### Commercial licence release workflow

1. Generate a key pair once on a secure developer machine:

```bash
npm run license:generate-keypair
```

2. Copy the public key into the tracked build resource:

```bash
copy .license-keys\license-public.pem resources\license-public.pem
```

3. Keep `.license-keys/license-private.pem` outside git and back it up securely. Do not replace the private key unless you are intentionally rotating all customer licences.

4. Build the customer package:

```bash
npm run release:windows
```

Release validation logs to expect:

- `LICENSE_PUBLIC_KEY_BUILD_VALID`
- `LICENSE_PUBLIC_KEY_PACKAGED`
- `LICENSE_PUBLIC_KEY_RUNTIME_PATH` (first packaged launch)
- `LICENSE_PUBLIC_KEY_RUNTIME_PROBE_OK` (post-package backend probe)

5. Before shipping, generate and activate a test TG1 licence in the packaged EXE:

```bash
npm run license:generate -- --company "Test Customer Ltd" --plan annual --start 2026-07-13 --days 30 --max-devices 1
```

Open the packaged app, go to **Licence**, paste the TG1 key, and confirm status becomes **Active**.

### Known limitations in this trial

- local licence validation only
- no cloud billing or payment integration
- no online account management
- desktop and local-workstation setup is the primary supported flow

### Recommended internal handover documents

- [TRIAL_RELEASE_CHECKLIST.md](C:\Users\Admin\patrol-evidence-platform\TRIAL_RELEASE_CHECKLIST.md)
- [CUSTOMER_HANDOVER_GUIDE.md](C:\Users\Admin\patrol-evidence-platform\CUSTOMER_HANDOVER_GUIDE.md)
