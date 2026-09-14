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

## Draft legal and privacy documents

Every document below is a draft and requires approval by Vesoft Services Limited and qualified legal counsel before use:

- [Product privacy notice](privacy-notice-draft.md)
- [Software licence terms](software-licence-terms-draft.md)
- [Support data-processing terms](data-processing-terms-draft.md)
- [Customer privacy deployment checklist](customer-privacy-deployment-checklist-draft.md)
- [Third-party software notices register](third-party-notices-draft.md)

## Internal approval evidence

- [Global readiness and data-flow audit](phase11a-global-readiness-audit.md)
- [International operational-time inventory](phase11b-timezone-inventory.md)
- [Detailed product data-flow inventory](phase11b-data-flow-inventory.md)
- [Publication approval register](publication-approval-register.md)

## Release gate

`GA-GLOBAL-01` is technically closed by Phase 11B: PatrolSafe now stores a validated IANA workspace time zone and uses it for operational dates, schedules, filtering, storage classification and customer display. Public GA nevertheless remains **NO-GO** until:

1. legal identity, contact, governing-law, commercial, privacy, retention and support placeholders are approved;
2. Vesoft's role and any customer data-processing terms are confirmed by counsel;
3. supported countries/regions and applicable sanctions/export controls are approved;
4. third-party notices are generated from the exact final shipped dependency tree and reviewed;
5. the approved documents are versioned alongside the exact released signed installer.
