# PatrolSafe v1.0.1 active trial expiry certification record

Status: **SIGNED TECHNICAL CANDIDATE CERTIFIED — PUBLIC DOWNLOAD NOT AUTHORIZED**

Assessment date: 15 September 2026

## Release identity and immutable predecessor

PatrolSafe v1.0.1 is a separately versioned remediation candidate. It does not modify, replace, or reuse the identity of the certified v1.0.0 controlled-pilot installer (`F9E6EA6765000BECAD8495A96D3C00C63010B28A01D1D1F639CB4D66CE84924B`). The single signed candidate is associated as follows:

- binary source commit: `0186389dca09b22a7049ab7094f49988c9746dd0`;
- customer-document commit: `c0ae483c4be0898dd8ab20f07ccb59ec6cc440a8`;
- build ID: `2026.09.15.13.59.32`;
- installer SHA-256: `A4841D8966C479EFFFCE69BB5935BDD109C01152D100FE81049210303B177C3A`; and
- release association: `final-release-association-v1.0.1.md`.

## Entitlement authority

`LicenceEvaluationService` remains the single entitlement authority. It evaluates either the DPAPI-protected local trial or the stored signed commercial licence against the stable installation identity. The normal two-second cache remains for request traffic; exact lifecycle and ingestion-boundary checks use a fresh evaluation from the same service. Trial and licence expiry remain absolute UTC entitlement semantics, independent of the workspace operational time zone.

The local trial record stores a full ISO expiry instant. Commercial licence expiry remains an inclusive ISO UTC date under the existing signed-licence verification semantics. No licence payload, product identity, public key, signature algorithm, workstation binding, anti-reissue marker, or clock-rollback policy changed.

## Active expiry lifecycle

While monitoring is enabled, PatrolSafe schedules a one-shot check at the known entitlement boundary, backed by one modest five-minute safety reconciliation. Only one timer is active. A confirmed transition to an expired or invalid entitlement:

1. closes the helper ingestion admission gate;
2. cancels any pending network-recovery generation;
3. sends one `set-production-monitoring: false` command;
4. detaches all three production listeners;
5. leaves the WhatsApp helper/browser and valid linked session intact where already connected;
6. preserves LocalAuth, mappings, sites, evidence, backups and the customer's saved monitoring preference; and
7. records one customer-safe entitlement transition without logout, unlink, archive, profile deletion, backfill or history replay.

The customer state is `WhatsApp: Connected` and `Monitoring: Trial expired` when the saved session remains ready. The message is:

> Your 30-day PatrolSafe trial has ended. Monitoring has stopped. Your existing evidence remains available.

The actions are **Activate PatrolSafe** and **Contact support**. Trial expiry is not represented as a WhatsApp or network failure.

## Atomic ingestion rule

The entitlement check is synchronous immediately before helper payload admission. An image accepted before the expiry transition may complete normal validation and durable finalization. A later payload is rejected before ingestion. This avoids partial evidence while preventing new evidence acceptance after confirmed expiry.

## Restart, network and activation

- Restart after expiry cannot auto-start monitoring or produce a QR merely because entitlement expired.
- If the network is offline at expiry, the local transition still runs; restored connectivity cannot bypass the expired state.
- Existing Evidence, Backup, Licence, Support and Diagnostics remain reachable. Other operational routes retain the existing licence gate.
- Importing a valid paid Annual licence restores eligibility without reinstalling, relinking, changing mappings, or rewriting evidence.
- Monitoring remains paused until the customer explicitly starts/resumes it after activation.
- A paid active licence is evaluated against its own expiry; the old trial boundary cannot stop it.

## Clock and tamper scope

The repair does not weaken the existing per-Windows-user encrypted trial, HKCU consumption marker, installation identity, or rollback detection. Moving the clock forward causes a fresh evaluation to expire the entitlement. A rollback more than the existing 24-hour tolerance fails closed. A purely local, privileged attacker or a different Windows account/OS reimage remains outside a strong online-entitlement guarantee; no invasive anti-tamper redesign was introduced.

## Public-trial customer behavior

An eligible clean installation receives a 30-day free trial. At expiry, monitoring stops during the running session, existing evidence remains available, Backup remains available, and the customer can activate the public Annual licence. Customer data is not deleted and WhatsApp is not unlinked due to expiry.

## Legal and authorization impact

The frozen controlled-pilot legal snapshot is not altered or recharacterized. External legal review has not been performed. Public-trial website copy and the v1.0.1 factual release note are draft publication materials. The immutable signed v1.0.1 association is complete. Wider public acquisition still requires separate management authorization, a supported-market decision, stable legal/privacy URLs and immutable production hosting.
