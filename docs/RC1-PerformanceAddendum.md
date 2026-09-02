# RC1 Performance Addendum

Extends [PerformanceReview](PerformanceReview.md) for go-live certification.

## Tuning actions reviewed

| Area | Finding | RC1 action |
|------|---------|------------|
| Indexes | Billing/licence indexes present | Documented in Database Review — no blocking gap |
| Prisma N+1 | Subscription/invoice lists use `include` | Keep pageSize ≤100 |
| Redis | Required for durable queues | Enforce in production compose |
| Caching | Dashboard 30s in-memory | Accept for single-instance; Redis cache post-v1 multi-instance |
| Queue workers | Dedicated worker binary | Validate process supervision |
| Portal rendering | Thin BFF + static hashed assets | nginx cache headers already set |
| Webhooks | BullMQ stripe-webhooks queue | Monitor DLQ depth |

## Load harness

```bash
# Synthetic (no server)
node scripts/rc1-load-harness.js

# Against staging
BASE_URL=https://api.staging.example \
ADMIN_TOKEN=... \
CUSTOMER_TOKEN=... \
LOAD_CONCURRENCY=25 \
LOAD_ITERATIONS=5 \
node scripts/rc1-load-harness.js
```

Measures: concurrent dashboard, system status, customer billing/licences, health.

## Targets (staging soak)

| Metric | Target |
|--------|--------|
| Dashboard p95 | < 500 ms |
| Customer billing p95 | < 800 ms |
| Health | < 100 ms |
| Webhook process success | ≥ 99.5% |
| Error rate (5xx) | < 0.5% |

## Explicit non-goals for RC1

- Full k6 CI gate
- Multi-region active-active
- Query-level auto-explain in CI
