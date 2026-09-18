# PatrolSafe v1.0.2 desktop startup security remediation

Status: **INTERNAL RELEASE-ENGINEERING RECORD — NOT CUSTOMER PUBLICATION COPY**

The v1.0.1 packaged desktop used a fixed local port and could direct token-bearing bootstrap requests to an unrelated process during a port collision. v1.0.2 removes fixed-port production discovery and local-service adoption.

For packaged operation, the child backend binds to an operating-system-assigned IPv4 loopback port. Electron accepts the endpoint only from the stdout pipe of the exact spawned child, then verifies a challenge response bound by HMAC to the desktop token, child PID, per-spawn session, application version and build identity. The renderer is not loaded and the desktop token is not exposed until verification succeeds. Generic health responses and unauthenticated imitations are not accepted.

The production failure page contains only a product-level support reference, release identity and sanitized startup stage. Detailed paths and backend output remain in local diagnostic logs; credentials, licence secrets, WhatsApp data and the identity proof are not logged.

The SQLite migration result now distinguishes mappings newly paused in the current migration from historical unresolved conflicts. The modal is current-launch-only; unresolved mappings remain visible through an administrator action banner. No customer data is deleted or reset.
