# Performance Review (Phase 4D)

## Measured surfaces (qualitative + structural)

| Area | Notes | Opportunity |
|------|-------|-------------|
| Admin dashboard | 30s in-memory cache; multi-query Promise.all | Keep; consider Redis cache for multi-instance |
| Billing metrics | Aggregations on subscriptions/payments | Add covering indexes if tables grow (period dates already indexed) |
| Customer portal | Thin BFF endpoints; JWT permission checks | CDN cache static assets (nginx already expires hashed assets) |
| Notifications | BullMQ + retries when Redis set | Prefer worker replicas over API for heavy SMTP |
| CSV exports | Hard cap 20k rows | Stream for very large tenants (future) |
| Licence issue | Transactional + signing CPU | Keep synchronous; monitor p95 latency |
| Queue | Inline mode blocks request thread on email | Production must use Redis + worker |

## Indexes already present (billing/org)

- `Subscription(organisationId,status,nextBillingDate,currentPeriodEnd)`
- `Invoice(subscriptionId,status,dueAt)`
- `BillingPayment(invoiceId,status,receivedAt)`
- `CustomerUser(customerId,email,role)`
- `OrganisationInvitation(customerId,email,status,expiresAt)`

## N+1 / query notes

- Subscription list includes `plan` + `organisation` in a single query — OK
- Invoice serialize includes nested relations — OK for page sizes ≤100
- Dashboard activity limited to 15 rows — OK

## Cache opportunities

1. Dashboard summary (done, 30s)
2. Public plan catalogue (short TTL) for customer billing comparison
3. `/system/version` (build-time constants; migration lookup can be cached 60s)

## Slow-query watchlist

- Unfiltered audit export
- Billing payments with deep organisation filter on large histories
- Concurrent TG1 sign under burst issue (CPU)

## Recommendations (priority)

1. **P0** — Run Redis + dedicated workers in production
2. **P1** — Cache public plans for 60s
3. **P1** — Add metrics histograms for billing endpoints
4. **P2** — Stream CSV for >20k (raise cap carefully)
5. **P2** — Connection pool sizing guide for Postgres under worker+API

## RC1

See [RC1-PerformanceAddendum](RC1-PerformanceAddendum.md) and `scripts/rc1-load-harness.js`.
