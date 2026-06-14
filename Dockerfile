# Project Horizon — single-process daemon + read API.
FROM node:22-slim

WORKDIR /app

# Install deps (tsx runs the TS directly — no build step).
COPY package.json package-lock.json ./
RUN npm ci

# App source + migrations + default config.
COPY tsconfig.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY config ./config
COPY src ./src

ENV PORT=3000
EXPOSE 3000

# DB_URL defaults to a local file; set it to a Turso libsql:// URL (+ DB_AUTH_TOKEN)
# for a hosted database when the platform disk is ephemeral.
CMD ["npm", "start"]
