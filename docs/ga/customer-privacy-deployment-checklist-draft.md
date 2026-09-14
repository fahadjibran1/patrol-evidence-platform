# DRAFT — REQUIRES LEGAL REVIEW

# Customer privacy and responsible deployment checklist

This checklist helps a customer assess a PatrolSafe deployment. It is not legal advice and does not replace a privacy notice, DPIA, employment consultation, works-council process, collective agreement, security assessment or local legal advice.

## Before collecting real evidence

- [ ] Identify the organisation that decides the purposes and means of processing.
- [ ] Record each purpose: patrol assurance, contract evidence, safety, incident handling, audit, or another specific purpose.
- [ ] Identify affected people: guards, employees, contractors, group participants, clients, visitors and people/images captured incidentally.
- [ ] Choose and document lawful bases and any additional condition for sensitive/special-category or criminal-offence data.
- [ ] Assess employment, surveillance, communications, biometric/facial, evidence and labour-law requirements in each relevant country.
- [ ] Complete a DPIA or equivalent risk assessment where required or prudent, especially for systematic employee/location/performance monitoring or sensitive imagery.
- [ ] Provide clear privacy information before or at collection; explain WhatsApp/Meta involvement and local storage.
- [ ] Confirm the organisation is authorised to use the linked WhatsApp account and selected groups for this purpose.
- [ ] Separate patrol operations from personal/social chats. Do not map mixed-purpose groups.
- [ ] Obtain client/site authority and define who may view/download evidence.

## Data minimisation and configuration

- [ ] Use only necessary group/source identifiers and site information.
- [ ] Do not use raw JIDs in normal operation.
- [ ] Map only approved groups and verify the destination site.
- [ ] Keep history/backfill disabled unless separately authorised, necessary and lawful.
- [ ] Do not enable test/certification endpoints in production.
- [ ] Use synthetic images for setup testing.
- [ ] Review and select the workspace time zone during setup. All sites in one v1 workspace use that saved zone for schedules, evidence dates and daily reporting; use separate workspaces where sites require different civil time zones.

## Security

- [ ] Use a dedicated supported Windows workstation with Defender, SmartScreen and firewall enabled.
- [ ] Enable approved full-disk/device encryption and secure boot where available.
- [ ] Apply Windows and Microsoft Edge security updates.
- [ ] Restrict local administrator and PatrolSafe administrator access.
- [ ] Use unique passwords and approved password management; lock the screen when unattended.
- [ ] Protect the evidence folder, AppData and backup destinations with least privilege.
- [ ] Restrict remote access and never expose the local PatrolSafe API to a public network.
- [ ] Treat WhatsApp LocalAuth, licence files, diagnostics and backups as sensitive.
- [ ] Establish incident response, breach assessment and regulator/customer notification procedures.
- [ ] Record Vesoft's product-security route (`security@sfour.co.uk`) and privacy route (`privacy@sfour.co.uk`); confirm the privacy mailbox is operational before relying on it.
- [ ] Use Vesoft's support-data minimisation order and an approved secure transfer method; do not email full backups, databases, WhatsApp profiles or evidence collections by default.
- [ ] Record who may export support diagnostics and review them for identifiers, filenames and local paths before disclosure.

## Retention and rights

- [ ] Define retention by data category and purpose; include legal holds and contract requirements.
- [ ] Remember that PatrolSafe v1 has no automatic evidence-retention engine or whole-workspace erasure workflow.
- [ ] Document how to locate, export where supported, correct, restrict and securely erase data across SQLite, evidence folders, logs and backups.
- [ ] Remember site archive and uninstall preserve historical data.
- [ ] Define how identity and rights requests are verified and handled without disclosing other people.
- [ ] Record how access, correction, restriction, objection, deletion and evidence-preservation requests will be applied across the database, files, logs and every backup, subject to applicable rights and legal holds.
- [ ] Review retention regularly and securely erase expired copies and retired workstation data.

## Suppliers and international transfers

- [ ] Review current WhatsApp/Meta and Microsoft terms, privacy information, availability and data-transfer position.
- [ ] Define Vesoft's role for licensing/support and sign data-processing terms where applicable.
- [ ] Approve support channels and prohibit uncontrolled email/public upload of backups or sessions.
- [ ] Identify each storage/support/licensing provider, country, transfer mechanism and security measure.
- [ ] Check sanctions, export controls, local WhatsApp/service availability and payment/licensing availability for the deployment region.

## Operational review

- [ ] Daily: verify WhatsApp Connected, Monitoring Active, mappings correct and expected evidence arriving.
- [ ] Periodically: review users, active sites/mappings, storage capacity, logs and backup restore tests.
- [ ] On staff/site/account change: update access and mappings without rewriting historical evidence.
- [ ] On workstation replacement: recover licence, relink WhatsApp and verify restored data before Monitoring resumes.
- [ ] On termination/disposal: follow retention/legal-hold decisions, unlink, back up if required, then securely erase retained data.

Approval owner: **[CUSTOMER TO COMPLETE]**
DPIA reference: **[CUSTOMER TO COMPLETE]**
Review date: **[CUSTOMER TO COMPLETE]**
