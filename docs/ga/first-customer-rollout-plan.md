# PatrolSafe v1.0.0 controlled first-customer rollout plan

Status: **MANAGEMENT APPROVED FOR STAGE 1 AND STAGE 2 CONTROLLED B2B PILOT**

This plan assumes one immutable, verified installer per approved release and no unimplemented auto-update or remote kill-switch capability.

## Ownership approval

| Role | Named owner | Approval state |
|---|---|---|
| Rollout/release authority | Vesoft Services Limited / company director | APPROVED |
| Release/withdrawal authority | Vesoft Services Limited / company director | APPROVED; internal authorised person must be recorded per release |
| Customer support owner | Vesoft Services Limited / PatrolSafe support | APPROVED |
| Security incident owner | Vesoft Services Limited | APPROVED |
| Commercial approval authority | Vesoft Services Limited / company director | APPROVED |
| Legal/privacy risk authority | Vesoft Services Limited / company director | MANAGEMENT RISK ACCEPTED FOR CONTROLLED PILOT; external legal review not performed |

Stage progression, download withdrawal and customer notification require the approved corporate release authority. The acting authorised person must be recorded in each release/stage record; no individual is invented from repository authorship.

## Entry conditions for every stage

- exact source commit, version/build, signed installer SHA-256 and manifest recorded;
- Authenticode valid for the installer, application, updater and required executable files;
- publication register has no mandatory `BLOCKED` item for that stage;
- approved Privacy Notice, EULA, third-party notices, customer documentation and supported-country scope are distributed together;
- approved support, privacy and security routes are staffed and tested;
- pilot/customer has a documented backup, privacy deployment and rollback plan;
- issue register, installer distribution list and named release owner are active.

## Stage 1 — Vesoft-owned deployment

Deploy only to an internal or Vesoft-controlled synthetic environment. Re-run install, setup, time-zone selection, trial/licence, WhatsApp link, source mapping, evidence receipt, backup/restore, outage recovery, reboot and uninstall/reinstall checks. Confirm documentation steps match the actual build.

Exit criteria:

- no Blocker or Major finding;
- support intake and secure diagnostic transfer exercised;
- installer/hash tracking and withdrawal procedure exercised;
- operational owner signs the stage record.

## Stage 2 — up to 13 friendly business pilot customers

Use written pilot terms and select no more than 13 friendly business customers in individually reviewed countries/regions with suitable Windows/WhatsApp environments. Record and approve each customer and jurisdiction before supply. Provide direct onboarding, but require operators to complete the normal customer UI rather than engineering shortcuts. Supporting additional countries must be a commercial/legal release decision, not a desktop runtime change; no hard-coded country allowlist or geoblocking is planned.

Track per customer:

- legal entity, approved region and authorised contacts;
- installer SHA-256, installation date, workspace time zone and Windows/Edge environment;
- licence/trial identity and recovery route;
- WhatsApp/source/mapping readiness without storing unnecessary identifiers centrally;
- first evidence and backup/restore confirmation;
- support contacts, issues, severity, consent to follow-up and release withdrawal status.

Exit criteria: agreed observation period completed, no open Blocker/Major, recurring issues understood, documentation updated through a new controlled revision, and support capacity reviewed.

## Stage 3 — small controlled public release

Offer the same immutable candidate to a capped cohort through an approved download route. Make the exact hash, publisher, system requirements, legal terms, support route and known issues visible before download. Keep an auditable list of installer versions and affected customers where law and contract permit.

Monitor:

- failed installs/signature warnings;
- setup/time-zone/licence/link/source/monitoring failures;
- missed or duplicate evidence reports;
- backup/restore and data-integrity reports;
- third-party service/version changes;
- privacy/security incidents and support volume;
- country/service/payment eligibility errors.

Exit criteria: product, support, security, legal and commercial owners approve broader availability using recorded pilot evidence.

## Stage 4 — broader GA

Broaden only within approved countries/regions, commercial capacity and support coverage. Preserve cohort/version tracking and staged review for every replacement build. Do not infer auto-update deployment; customers receive a new signed installer through the documented release process.

## Severity and response control

| Severity | Rollout action |
|---|---|
| BLOCKER | Pause new downloads/deployments immediately; preserve evidence; assess withdrawal and notification |
| MAJOR | Pause expansion and affected workflow; product owner decides whether current downloads stop |
| MINOR | Record, provide safe workaround only if customer-appropriate, schedule review |
| COSMETIC | Record and group for a future approved release |

Final severity definitions, response targets and notification obligations require approval; this table is a release-control rule, not an SLA.

## Emergency pause criteria

Pause rollout for any confirmed or credible indication of:

- evidence loss, corruption, material duplication or wrong-site routing;
- authentication/authorisation bypass or cross-customer data exposure;
- invalid signature, installer mismatch or compromised distribution channel;
- unrecoverable WhatsApp monitoring failure affecting normal supported conditions;
- licence enforcement blocking eligible customers unexpectedly at scale;
- backup/restore causing data loss;
- material privacy/security incident or unlawful-region distribution;
- third-party licence/provenance issue requiring distribution to stop;
- support demand exceeding the approved ability to respond safely.

## Rollback and communication

Follow [GA rollback plan](ga-rollback-plan.md). Stop the download before investigating through the public artefact, preserve the last known-good installer privately, identify affected versions/customers, advise customers how to preserve data and monitoring continuity, and issue a new signed build only through the full approved pipeline. Never advise deletion of customer data or sessions without a verified, authorised recovery plan.

## Feedback and records

Use a controlled issue record with reproduction steps, expected/actual result, customer impact, severity, affected hash/version, privacy classification, owner, disposition and release decision. Minimise personal data and never use customer evidence for development/testing without explicit authority and suitable terms.
