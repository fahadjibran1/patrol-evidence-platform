# GA-UAT-10: real mapping failure and site lifecycle

Status: source remediation complete; a new signed candidate and manual installed-app UAT are still required. Do not treat this source change as a certified release.

## Preserved installed state (read-only inspection)

- The installed v1.0.2 candidate remained running; no restart, relink, database write, site deletion, or mapping change was performed.
- TEST1 exists with zero active mappings and zero schedules. The database contains six active mappings and seven paused historical conflicts.
- The sole discovered WhatsApp group labelled `test1` has the same account/group identity as an active historical mapping for a site in another company workspace. That historical site has 13 evidence images. No private WhatsApp identifier is recorded here.
- The picker previously used only mappings visible in the current company, so it labelled this foreign-owned source `Available`. The backend's global active account/group uniqueness guard rejected Save before persistence or helper reconciliation. The frontend replaced the useful backend error with a generic message.
- The original button-click HTTP response was not retained in a sanitized request log. The diagnosis is based on the exact discovered-to-persisted identity match, the unchanged TEST1 database state, and the deterministic production backend duplicate guard; it does not claim a captured response body.
- The GA-UAT-06 synthetic preview contained no cross-company same-account collision, so it could not exercise this case.

## Remediation and safety rule

- The discovered-source picker now asks the authenticated backend for availability across the configured WhatsApp account. It reports a foreign-owned active mapping as `In use in another business workspace`, without revealing that workspace's details, and disables selection. A failed availability check does not default to Available.
- Backend duplicate rejection remains authoritative; the customer sees an actionable error if state changes after the preflight.
- The group cannot be silently moved to TEST1. An authorised administrator must explicitly unmap it from the historical site or archive that site. Historical evidence remains attributed to the original site.
- Archiving a site deactivates its mappings and schedules, preserving historical records. Restoring it does not silently reclaim groups or reactivate schedules. Permanent deletion requires a typed site-code confirmation and is refused when operational or mapping-audit history exists.
- Mapping/site lifecycle changes notify the existing collector reconciliation path. They do not relink WhatsApp or create a second production listener set.

## Required manual UAT after a new signed candidate is authorised

1. Preserve TEST1. On the new candidate, confirm `test1` is shown as in use elsewhere, not Available, and cannot be selected while the historical mapping is active.
2. As an authorised administrator, explicitly unmap that historical group or archive its historical site after reviewing the 13 existing evidence images. Do not delete that site or its evidence.
3. Refresh discovery. Confirm the group becomes Available, map it to TEST1, and confirm TEST1 shows one active mapping. Configure TEST1's patrol schedule.
4. Confirm Monitoring remains Active, the existing three production listeners remain the only listeners, and helper runtime configuration includes the newly eligible mapping without a WhatsApp relink.
5. Unmap and remap an isolated synthetic/non-customer source to verify future ingestion stops while historical evidence attribution remains intact.
6. Exercise empty-site deletion and historical-site archive in a disposable synthetic dataset, not on irreplaceable customer state.

The currently installed signed candidate cannot demonstrate these source changes until a separately authorised build/sign cycle occurs.
