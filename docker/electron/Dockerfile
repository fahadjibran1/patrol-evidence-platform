# Optional Electron / desktop packaging environment (Windows hosts typically package natively).
# Use for Linux CI smoke packaging of native deps only — not a production runtime image.
FROM node:22-bookworm
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ libx11-dev libxkbfile-dev libsecret-1-dev \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
CMD ["npm", "run", "desktop:package"]
