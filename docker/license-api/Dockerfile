# syntax=docker/dockerfile:1.7
# Multi-stage Licence API image (NestJS)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/license-core/package.json packages/license-core/
COPY apps/license-api/package.json apps/license-api/
RUN npm ci --workspace @patrol/license-core --workspace @patrol/license-api --include-workspace-root=false

FROM deps AS build
COPY packages/license-core packages/license-core
COPY apps/license-api apps/license-api
COPY tsconfig.base.json* ./
RUN npm run build --workspace @patrol/license-core \
  && npm run build --workspace @patrol/license-api \
  && npm prune --omit=dev --workspace @patrol/license-api --include-workspace-root=false

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 --create-home patrol
COPY --from=build --chown=patrol:patrol /app/node_modules ./node_modules
COPY --from=build --chown=patrol:patrol /app/packages/license-core ./packages/license-core
COPY --from=build --chown=patrol:patrol /app/apps/license-api ./apps/license-api
COPY --from=build --chown=patrol:patrol /app/package.json ./package.json
USER patrol
WORKDIR /app/apps/license-api
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3010)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
