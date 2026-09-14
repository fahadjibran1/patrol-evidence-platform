# PatrolSafe v1.0.0 GA rollback and release-withdrawal plan

Status: **GA PREPARATION — REQUIRES OWNER APPROVAL AND OPERATIONAL EXERCISE**

PatrolSafe v1.0 has no certified remote kill-switch and no assumed automatic-update rollout. Withdrawal controls the distributed installer and customer guidance; it does not remotely remove, disable or replace installed copies.

## Authority and trigger

The named release owner **[TO BE CONFIRMED]** may pause distribution immediately for a suspected Blocker, signature/supply-chain issue, serious privacy/security incident, unlawful-region distribution or material third-party licence issue. Legal, security and customer-communication owners must be identified in the operator decision record.

## Immediate containment

1. Disable the website/download link and any sales/support delivery workflow for the affected installer.
2. Preserve the exact installer, manifest, hashes, signatures, source commit, dependency/notices inventory, build logs and report outside the public download path.
3. Record the first report time, affected version/hash, regions/channels, known customers, severity, data risk and decision owner.
4. Do not overwrite the file at an existing URL with different bytes and do not reuse a filename/hash association.
5. Tell support and sales to stop sending the affected installer and use approved holding wording.
6. Preserve customer data and evidence. Do not recommend uninstall, LocalAuth deletion, database changes or restore until the safe path is verified.

## Last known-good control

Maintain a private, access-controlled copy of each approved installer, manifest, documentation revision and source commit. “Last known good” means approved for the customer's environment and unaffected by the incident; it does not mean an older installer can be published automatically.

Rollback to an older version requires explicit compatibility review for database schema, data, licensing, Squirrel install behavior, WhatsApp/Edge compatibility and security. If downgrade safety is unproven, pause distribution and provide continuity guidance instead.

## Customer assessment and notification

Identify affected customers from lawful distribution/licensing/support records. Decide with legal/security whether and when to notify customers, regulators, providers or others. A notice should state, in plain language:

- affected product version, build and installer hash;
- what happened and the practical risk, without speculation;
- whether installed operation should continue, pause Monitoring or disconnect from a service;
- how to preserve evidence and create a verified backup;
- what customers must not delete or send;
- approved support/security contact and next update time;
- replacement or recovery steps once certified.

Notification templates, jurisdictions and deadlines are **REQUIRES LEGAL REVIEW**.

## Licence and support continuity

- Preserve valid customer entitlement records and do not require a new purchase because a Vesoft release was withdrawn.
- Define how trial expiry and licence recovery will be handled during an extended pause **[BUSINESS DECISION REQUIRED]**.
- Maintain a staffed support route for affected customers.
- Accept diagnostics/evidence only through the approved minimum-data and secure-transfer process.
- Record replacement licence files/installation identities without exposing them publicly.

## Data and backup protection

Before repair or replacement, instruct customers to create and verify a backup when safe. Confirm whether the issue affects backup validity. Never distribute an automated data rewrite, database rollback or cleanup command without migration, atomicity and recovery certification.

Uninstall preserves customer AppData/evidence and is not secure erasure. A replacement installer must be tested for upgrade, reinstall, uninstall/reinstall, schema compatibility, evidence integrity, LocalAuth behavior and licence recovery as applicable.

## Replacement build

1. Reproduce and classify the defect using preserved evidence.
2. Repair on an approved branch without modifying the withdrawn signed artefact.
3. Run the full security, licensing, WhatsApp, monitoring, evidence, durability, backup/restore, international-time, UX and packaging regression.
4. Review any documentation/legal/notices change and update the publication register.
5. Commit the focused change; record the new source freeze.
6. Build exactly through the certified Azure Artifact Signing pipeline after approval.
7. Verify all required executable signatures, publisher and timestamp; generate a new manifest and SHA-256.
8. Perform proportionate clean-machine/customer UAT and explicit release approval.
9. Publish under a new immutable artefact/hash association. Never replace the withdrawn binary in place.

## Closure

Closure requires evidence that downloads are controlled, affected customers were handled, legal/security duties were assessed, the replacement or continuity path is verified, and all public pages point only to an approved artefact. Record lessons and update this plan without erasing the incident trail.
