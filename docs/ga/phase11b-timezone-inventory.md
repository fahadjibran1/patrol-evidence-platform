# Phase 11B operational-time inventory

Status: **TECHNICAL AUDIT — PHASE 11B**
Scope: PatrolSafe desktop/runtime source at the Phase 11B source freeze
Locale policy: English-only v1; unambiguous English month-name display
Timezone policy: one IANA workspace timezone shared by all sites

## Authoritative model

| Time class | Invariant |
|---|---|
| Absolute event | Store/transport an ISO/UTC or database datetime instant. Timezone selection never mutates the instant. |
| Operational civil time | Interpret patrol day, schedule hours, date filters, dashboard Today and date-derived evidence folders in `appTimeZone`. |
| Customer display | Render absolute instants in `appTimeZone`, using unambiguous English month names. |
| Logging/diagnostic | Keep ISO UTC where already used; customer support summaries use workspace-local display. |
| Licensing | Keep existing absolute/date-only entitlement rules. Display entitlement instants in the workspace timezone. |

## Runtime occurrence audit

The inventory below covers the search families `Europe/London`, `GMT`, `BST`, `en-GB`, `Date`, `new Date`, `Date.parse`, `getHours`, `getDate`, `setHours`, `setDate`, `Intl.DateTimeFormat`, `timeZone`, `UTC`, offsets, day boundaries, patrol windows, schedules and date-derived folders. Repeated calls in the same path are grouped where they have the same semantic classification.

| Path / occurrence family | Class | Finding and Phase 11B disposition |
|---|---|---|
| `src/common/utils/patrol-time.util.ts` | A/B | UTC-to-civil conversion, IANA validation, DST-compatible civil-to-UTC resolution and workspace day bounds. `Europe/London` remains only the named legacy compatibility default. |
| `src/config/app.config.ts` | B | Backend resolves validated workspace `appTimeZone`; invalid persisted values fail closed. Environment override remains an explicit deployment mechanism, not customer auto-detection. |
| `desktop/main.js`, `desktop/security-policy.js` | B | Validates persisted IANA values, restarts backend on change, and atomically migrates initialized legacy configs without a field to `Europe/London`. New configs are not migrated. |
| `src/desktop/desktop.service.ts` and setup DTO | B | Validates timezone before company/admin mutation, persists it during first-run, exposes it in bootstrap status, and blocks setup completion without a valid value. |
| `src/storage/storage.service.ts` | B/C/D | Operational folder date/hour and image overlay are derived from workspace time. Existing folders are never renamed by a timezone change. |
| `src/patrol-images/*` | A/B | `sentAt` and `receivedAt` remain instants; `patrolDate`, `patrolHour` and date-query UTC bounds use workspace time. SHA-256, external identity and files are unchanged. |
| `src/dashboard/dashboard.service.ts`, `dashboard.controller.ts` | B/C | Default date, Today counts and evidence queries use workspace-local calendar day. Existing rolling-duration calculations remain absolute. |
| `src/compliance/compliance.service.ts` | B | Generates schedule instants from workspace civil time, rolls overnight hours to the next civil date, handles DST gaps/overlaps deterministically, and uses workspace Today. |
| `src/patrol-slots/patrol-slots.controller.ts` | B | Converts selected workspace date to UTC query bounds, including non-integer offsets. |
| `src/common/utils/patrol-schedule.util.ts` | B | Weekday comes from the civil date itself; no host-timezone or date-line shift. Same-day, overnight, month/year and DST cases are covered. |
| `src/ops/ops.controller.ts` | B/C | Legacy authenticated operations view receives workspace Today and formats instants in the workspace zone. |
| `web/src/lib/patrol-time.ts` | B/C | Renderer holds the explicit workspace zone loaded before operational routes render; first-run detection is only a preselection. Customer formatting uses month names to avoid numeric-date ambiguity. |
| `web/src/lib/patrol-schedule.ts`, `operator-ui.ts` | B/C | Schedule labels, current-hour decisions, evidence and dashboard timestamps use the current workspace zone. |
| Dashboard, Evidence and Guard Safe pages | B/C | Default selected day and evidence grouping use workspace Today; backend filtering uses matching workspace bounds. |
| Patrol Ops page | B/C | Today, slot display and manual datetime input use workspace time; input converts to a canonical instant and rejects nonexistent DST wall times. |
| Alerts, Incidents, Sites, Monitoring/Support diagnostics and Licence pages | C/F | Customer timestamps use workspace display. Licence computation is unchanged. |
| `desktop/data-durability.js` | G | Backup copies workspace config; restore preserves `appTimeZone` on same and replacement machines. No host-timezone redetection occurs. |
| `src/main.ts`, health, collector and service log `toISOString()` calls | E | Correctly remain UTC/unambiguous forensic timestamps. |
| Licence/trial `toISOString()` and date-only calculations | F | Entitlement behavior is intentionally unchanged; date-only legacy compatibility remains isolated from patrol operational time. |
| Backup manifest `createdAt` and backup folder stamps | G | Remain absolute/UTC identifiers. Workspace timezone is inside backed-up config. |
| `apps/license-portal` and `apps/customer-portal` commercial dates/currency | C/F/I | Separate commercial administration surfaces. London licence-default and `en-GB` currency/date assumptions are not PatrolSafe operational classification and were not changed in Phase 11B; regional commerce remains a business roadmap item. |
| `scripts/*` UTC timestamps and explicit London smoke fixtures | H | Test/release tooling. Explicit London fixtures are intentional controls; WhatsApp runtime behavior is unchanged. |
| `*.spec.ts` timezone names and dates | H | International and compatibility fixtures, not production defaults. |
| `docs/ga/*` timezone/country statements | I | Updated to the certified workspace-zone model; legal availability statements remain draft/review controlled. |

## Workspace versus site decision

The current data model has one company/workspace, one locally configured operational backend and schedules that do not carry a site timezone. v1 is therefore certified with **one workspace timezone for all sites**. Per-site timezone support would require schedule, filtering, reporting and storage policy changes and is not claimed for v1. A company operating sites in different civil timezones must use separate workspaces or wait for a separately designed multi-timezone release.

## DST policy

- A nonexistent spring-forward schedule wall time resolves to the first valid local instant after the gap.
- An ambiguous autumn wall time resolves to its earlier occurrence.
- A repeated civil hour is not used to create duplicate schedule identities.
- Evidence identity is message/instant based; timezone changes do not create duplicate evidence.

These rules use platform IANA/ICU data; PatrolSafe does not maintain offset tables.

## Timezone changes

Changing the workspace timezone is an authenticated Company Settings action with a warning. It changes future schedule interpretation and current display/grouping of canonical instants. It does not rewrite evidence files, SHA-256 values, message identities, stored instants or historical folder paths.
