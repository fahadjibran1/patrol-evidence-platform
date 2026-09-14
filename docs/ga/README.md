# PatrolSafe v1.0.0 GA documentation pack

Status: **GA PREPARATION — NOT APPROVED FOR PUBLICATION**

Product: **PatrolSafe by S4**
Publisher: **Vesoft Services Limited**
Tagline: **Patrol evidence. Automatically organised.**

This directory is the controlled documentation set for the PatrolSafe v1.0.0 general-availability review. Technical UAT passed against the private signed release candidate identified in [release-notes-v1.0.0.md](release-notes-v1.0.0.md). No document in this directory authorises publication, sale in a particular country, or a v1.0.0 tag.

## Customer documents

- [Quick Start](quick-start.md)
- [User Guide](user-guide.md)
- [WhatsApp connection troubleshooting](whatsapp-troubleshooting.md)
- [Backup and restore](backup-and-restore.md)
- [Support and international availability](support-and-availability.md)
- [Known issues](known-issues-v1.0.0.md)
- [Release notes](release-notes-v1.0.0.md)
- [Website/download page copy](website-download-page-copy.md)

## Draft legal and privacy documents

Every document below is a draft and requires approval by Vesoft Services Limited and qualified legal counsel before use:

- [Product privacy notice](privacy-notice-draft.md)
- [Software licence terms](software-licence-terms-draft.md)
- [Support data-processing terms](data-processing-terms-draft.md)
- [Customer privacy deployment checklist](customer-privacy-deployment-checklist-draft.md)
- [Third-party software notices register](third-party-notices-draft.md)
- [Generated third-party notices draft](THIRD_PARTY_NOTICES_DRAFT.txt)
- [Controller/processor review matrix](controller-processor-matrix.md)
- [Legal counsel review pack](legal-review-pack.md)
- [Legal-review decision sheet](legal-review-decision-sheet.md)

## Internal approval evidence

- [Global readiness and data-flow audit](phase11a-global-readiness-audit.md)
- [International operational-time inventory](phase11b-timezone-inventory.md)
- [Detailed product data-flow inventory](phase11b-data-flow-inventory.md)
- [Publication approval register](publication-approval-register.md)
- [Company identity and publication wording](company-identity-and-publication-wording.md)
- [Third-party package technical audit](third-party-technical-audit.md)
- [Third-party counsel review record](third-party-legal-review-record.md)
- [Runtime contact audit](runtime-contact-audit.md)
- [Operator decisions required](operator-decisions-required.md)
- [Final release association template](final-release-association-template.md)
- [GA manifest schema](ga-manifest.schema.json)
- [Controlled first-customer rollout plan](first-customer-rollout-plan.md)
- [GA rollback and withdrawal plan](ga-rollback-plan.md)
- [Manual licence recovery procedure](licence-recovery-procedure.md)
- [Secure support-data transfer policy](secure-support-data-transfer.md)
- [Frozen legal-review snapshot](legal-review/README.md)
- [Generated packaged dependency inventory](generated/third-party-production-dependencies.csv)
- [Generated repository production inventory](generated/repository-production-dependencies.csv)
- [Generated repository/package reconciliation](generated/third-party-reconciliation.csv)
- [Generated collected licence/notice texts](generated/third-party-license-texts.md)

## Release gate

`GA-GLOBAL-01` is technically closed by Phase 11B: PatrolSafe now stores a validated IANA workspace time zone and uses it for operational dates, schedules, filtering, storage classification and customer display. Public GA nevertheless remains **NO-GO** until:

1. `privacy@sfour.co.uk` is operationally confirmed and a secure support-transfer provider/process is approved;
2. Vesoft's role, Privacy Notice, EULA, data-processing terms, retention schedule and other mandatory legal questions are approved by counsel;
3. supported countries/regions and applicable sanctions/export controls are approved;
4. third-party LGPL and special/compound findings are legally resolved, notices are approved, and the technically reconciled inventory is regenerated from the exact final signed dependency tree;
5. the approved documents are versioned alongside the exact released signed installer and authorised for publication.

The Phase 11F frozen handoff is ready for external counsel once its hash manifest is generated. That readiness is not GA signing or publication approval.
