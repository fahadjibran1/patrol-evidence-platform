# syntax=docker/dockerfile:1.7
FROM node:22.22.0-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/license-core/package.json packages/license-core/
COPY apps/license-api/package.json apps/license-api/
COPY apps/license-api/prisma apps/license-api/prisma
COPY apps/license-portal/package.json apps/license-portal/
COPY apps/customer-portal/package.json apps/customer-portal/
RUN npm ci --workspace @patrol/license-core --workspace @patrol/license-api \
  --workspace @patrol/license-portal --workspace @patrol/customer-portal \
  --include-workspace-root=false --ignore-scripts \
  && npm rebuild bcrypt \
  && npm run db:generate --workspace @patrol/license-api

FROM deps AS build
COPY packages/license-core packages/license-core
COPY apps/license-api apps/license-api
COPY apps/license-portal apps/license-portal
COPY apps/customer-portal apps/customer-portal
COPY tsconfig.base.json* ./
RUN npm run build --workspace @patrol/license-core \
  && npm run build --workspace @patrol/license-api \
  && VITE_LICENSE_API_URL= VITE_COMMERCIAL_STAGING_ENABLED=true npm run build --workspace @patrol/customer-portal \
  && VITE_LICENSE_API_URL= VITE_BASE_PATH=/operator/ npm run build --workspace @patrol/license-portal \
  && npm prune --omit=dev --workspace @patrol/license-api --include-workspace-root=false

FROM node:22.22.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=staging
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 --create-home --groups node patrol
COPY --from=build --chown=patrol:patrol /app/node_modules ./node_modules
COPY --from=build --chown=patrol:patrol /app/packages/license-core ./packages/license-core
COPY --from=build --chown=patrol:patrol /app/apps/license-api ./apps/license-api
COPY --from=build --chown=patrol:patrol /app/apps/customer-portal/dist ./apps/license-api/public/customer
COPY --from=build --chown=patrol:patrol /app/apps/license-portal/dist ./apps/license-api/public/operator
COPY --from=build --chown=patrol:patrol /app/package.json ./package.json
USER patrol
WORKDIR /app/apps/license-api
EXPOSE 10000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||10000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npm run db:migrate && exec node dist/main.js"]
