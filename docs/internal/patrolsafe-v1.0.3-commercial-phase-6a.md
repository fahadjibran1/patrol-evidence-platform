# PatrolSafe v1.0.3 commercial Phase 6A

Date: 23 September 2026

Source baseline: `c16fd7742d5a8de1b40a21c0206bcc274267e64e`

Branch: `v1.0.3-commercial-licensing`

## Outcome

The code-level Stripe sandbox boundary is prepared, but no external staging service has been provisioned. No webhook or Checkout Session has been created and no payment has been attempted. The connected Azure subscription contains production signing/download resources only, and the connected Vercel scope contains the production S4 projects but no isolated PatrolSafe commercial-staging project. Those production resources were not changed.

External staging needs an authorised hosting/resource selection, a DNS/TLS name, an isolated PostgreSQL instance, shared private artifact storage, secret injection, and staging credentials before deployment. The existing Docker staging composition remains suitable as a local integration topology, not as evidence of an externally reachable deployment.

## Required staging topology

- HTTPS reverse proxy or ingress with a dedicated staging hostname.
- Licence API container with raw-body Stripe/Resend webhook support and Swagger disabled.
- Separate commercial outbox worker using the same isolated PostgreSQL database.
- Fresh isolated PostgreSQL database with all Phase 1-5 commercial migrations.
- Operator portal and customer purchase/status portal on allowlisted staging origins.
- Private shared artifact storage readable by the issuer/delivery worker and never anonymously accessible.
- Secret manager/mounted secrets for the Stripe test key, webhook secret, test-only Ed25519 key, delivery secret, Resend staging credentials, JWT/encryption keys, and database credentials.
- Optional Redis for the legacy queue infrastructure; commercial correctness remains based on the PostgreSQL transactional outbox.
- Central staging logs/audit storage with secret-safe retention.

## Server-owned Stripe binding

The commercial provider now requires and validates the following configuration before it can create Checkout:

- product identity: `Patrol Evidence Platform`
- display product: `PatrolSafe Annual Licence`
- plan: `annual`
- amount: `29900` GBP minor units
- maximum devices: `1`
- Stripe sandbox Product: `prod_VJZKhQacoagUlL`
- Stripe sandbox Price: `price_1UIwCVH2l2t3kuR0CHN6zOaX`
- lookup key: `patrolsafe_annual_gbp_v1`
- Price type: `one_time`
- Price tax behaviour: `inclusive`

Before creating a Session, the API retrieves the configured Price with its Product and rejects a live-mode, inactive, recurring, differently priced, differently denominated, differently taxed, differently keyed, or differently parented object. Checkout uses the fixed Price ID. The desktop/browser cannot select the amount, currency, Price, Product, or tax result.

## VAT and Stripe Tax gate

`tax_behavior=inclusive` only defines how a Price behaves if tax applies. It does not establish tax registrations, select a product tax code, determine customer location, calculate tax, create tax evidence, or authorise VAT treatment.

Current Checkout deliberately has:

- billing address collection: required
- automatic Stripe Tax: disabled
- tax ID collection: disabled
- invoice creation: disabled
- tax policy: `NOT_YET_PRODUCTION_AUTHORIZED`

Before the first genuine sandbox Checkout intended to test the eventual tax journey, management/accounting must provide:

1. The correct Stripe Tax product tax code for this annual workstation software licence. It must be selected from Stripe's supported tax codes and must not be guessed.
2. The business head-office/origin address in Stripe Tax settings.
3. The exact jurisdictions in which Vesoft is already registered to collect tax; sandbox registrations should model only approved registrations.
4. Whether this is a consumer-only, business-only, or mixed sale, and whether Checkout must collect business tax IDs for B2B/reverse-charge handling.
5. Whether Stripe Tax automatic calculation is authorised for staging and later production.
6. Whether paid invoices are required, plus authorised invoice/receipt/VAT wording and evidence-retention policy.

After those decisions, enable `automatic_tax` only in the staging policy, retain required billing address collection, enable tax-ID collection if the approved B2B policy requires it, and verify Stripe's calculated tax breakdown/taxability reason in the completed test Session. The expected customer total cannot be asserted as exactly GBP 299.00 in every jurisdiction until this policy is settled; GBP 299.00 is the inclusive Price amount configured in the supplied sandbox object.

## Webhook contract

The licence API route is:

`POST <staging-api-base>/commercial/webhooks/stripe`

No concrete URL exists yet and no Stripe endpoint was created. Once the real HTTPS base exists, the minimal events for the implemented reconciliation flow are:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `payment_intent.canceled`
- `charge.refunded`

The endpoint verifies the `Stripe-Signature` header against `COMMERCIAL_STRIPE_WEBHOOK_SECRET`, rejects live-mode events, deduplicates the Stripe event ID, stores a payload hash, and queues durable PostgreSQL outbox work. Success redirects never establish payment.

## Configuration inventory

Non-secret sandbox identity values are recorded in `.env.phase6-staging.example`. Secrets remain placeholders.

| Purpose | Variable | Phase 6A status |
| --- | --- | --- |
| Stripe sandbox secret key | `COMMERCIAL_STRIPE_SECRET_KEY` | absent; external secret required |
| Stripe webhook signing secret | `COMMERCIAL_STRIPE_WEBHOOK_SECRET` | absent; create only after HTTPS endpoint exists |
| Product ID | `COMMERCIAL_STRIPE_PRODUCT_ID` | configured in example |
| Price ID | `COMMERCIAL_STRIPE_PRICE_ID` | configured in example |
| Lookup key | `COMMERCIAL_STRIPE_PRICE_LOOKUP_KEY` | configured in example |
| Price tax behaviour | `COMMERCIAL_STRIPE_PRICE_TAX_BEHAVIOR` | configured as `inclusive` |
| PostgreSQL | `LICENSE_DATABASE_URL` | local staging value exists; external isolated database absent |
| Desktop licence API origin | `PATROLSAFE_COMMERCIAL_SERVICE_ORIGIN` | proposed only; not deployed |
| Operator portal origin | `LICENSE_PORTAL_ORIGIN` | local staging value exists; external origin absent |
| Customer portal origin | `CUSTOMER_PORTAL_ORIGIN` | local staging value exists; external origin absent |
| Test signer switch | `COMMERCIAL_TEST_ISSUER_ENABLED` | example only |
| Test key ID/file | `COMMERCIAL_TEST_SIGNING_KEY_ID`, `COMMERCIAL_TEST_SIGNING_PRIVATE_KEY_FILE` | file path example only; private key absent |
| Private artifact storage | `COMMERCIAL_TEST_ARTIFACT_ROOT` | local path example only; shared external private store absent |
| Resend staging | `COMMERCIAL_RESEND_ENABLED`, `COMMERCIAL_RESEND_API_KEY`, `COMMERCIAL_RESEND_FROM`, `COMMERCIAL_RESEND_WEBHOOK_SECRET` | secrets/domain absent |

## Isolation and security

- Commercial configuration rejects `sk_live_` and requires an `sk_test_` secret.
- Webhook ingestion rejects `livemode=true`.
- Configured Stripe Price retrieval independently requires `livemode=false`.
- The test issuer refuses production mode; Phase 6 desktop test-key trust additionally requires explicit commercial staging configuration.
- Staging customer pages require their explicit staging build flag and are not part of the v1.0.2 production S4 site.
- Swagger is now disabled in `staging` unless explicitly enabled; development remains enabled.
- The live v1.0.2 source, binary, S4 acquisition, Azure download storage, code-signing resources, data, and licence keys were untouched.

The current licence-API production audit is 0 critical, 1 high, 11 moderate, and 1 low. The high is transitive `lodash@4.17.21` through Nest Config/Swagger. No licence-API code invokes the advisory operations (`template` with attacker-controlled imports, `unset`, or `omit`), and Swagger document generation is disabled for external staging. It is not currently reachable through the commercial request/webhook flow. This is a temporary staging disposition, not a claim that the advisory is absent; a compatible framework/dependency remediation decision remains required before production internet deployment.

## Exact next action

The product owner must authorise a dedicated external staging hosting target and spend boundary (recommended: a new staging resource group/project, not an existing production resource), provide the desired Azure region and DNS names, and provision or authorise:

- container hosting for API and worker;
- isolated PostgreSQL;
- shared private artifact storage;
- secret storage and identities;
- two portal deployments;
- DNS/TLS;
- test-only signing-key generation/storage;
- Stripe sandbox secret key injection;
- Resend staging key/domain/recipient if real email is required.

The tax decisions above must also be supplied. After deployment and health/migration checks, create the Stripe TEST webhook at the exact deployed API route, inject its signing secret, download/verify endpoint configuration, and only then perform the separately authorised first test Checkout.
