# Release Management

## Version numbering

- **SaaS / API / portals**: SemVer `MAJOR.MINOR.PATCH` (e.g. `1.2.0`)
- **Desktop**: root `package.json` `version` + `buildId`
- Git tags: `vMAJOR.MINOR.PATCH`
- Runtime: `APP_VERSION`, `BUILD_NUMBER`, `GIT_COMMIT`, `BUILD_TIMESTAMP`

## Release checklist

- [ ] Changelog drafted
- [ ] Version bumped in relevant `package.json` files
- [ ] CI green on release branch
- [ ] Prisma migrations reviewed (expand/contract if needed)
- [ ] `.env.production.example` updated for new vars
- [ ] Security review for auth/billing/download changes
- [ ] Staging deploy + acceptance checklist passed
- [ ] Tag `vX.Y.Z` pushed (triggers Release workflow)
- [ ] Production backup taken
- [ ] Production deploy + `/system/version` verified
- [ ] Customer/admin comms sent if user-facing

## Rollback checklist

- [ ] Identify last known-good image/tag
- [ ] Confirm whether DB migration must be reversed or is forward-compatible
- [ ] Restore DB only if data corruption / bad migration (see DisasterRecovery)
- [ ] Redeploy previous API/worker/portal images
- [ ] Verify health + smoke login
- [ ] Post-incident notes

## Database migration checklist

- [ ] Migration is idempotent / safe on large tables
- [ ] Backfill strategy documented
- [ ] Downtime expected? communicated
- [ ] Rollback SQL or expand/contract plan attached to PR
- [ ] Ran on staging clone first

## Desktop release checklist

- [ ] `license:generate-keypair` / public key packaging verified
- [ ] `npm run desktop:package` (or Release workflow) succeeds
- [ ] Portable ZIP / installer smoke test on clean Windows VM
- [ ] SHA256 checksums published
- [ ] Release notes include min OS version

## Customer communication checklist

- [ ] Impact window stated (UTC)
- [ ] Features / breaking changes listed
- [ ] Support contact included
- [ ] Status page / email sent to Owner contacts for major outages
