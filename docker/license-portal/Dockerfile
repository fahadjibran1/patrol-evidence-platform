# syntax=docker/dockerfile:1.7
# Admin portal (Vite static) served by nginx
FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG VITE_LICENSE_API_URL=/api
ENV VITE_LICENSE_API_URL=$VITE_LICENSE_API_URL
COPY package.json package-lock.json ./
COPY apps/license-portal/package.json apps/license-portal/
RUN npm ci --workspace @patrol/license-portal --include-workspace-root=false
COPY apps/license-portal apps/license-portal
RUN npm run build --workspace @patrol/license-portal

FROM nginx:1.27-alpine AS runtime
COPY docker/license-portal/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/license-portal/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1/ || exit 1
