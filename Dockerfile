# Project Horizon — single-process daemon + read API.
# Multi-stage: compile with dev deps in the builder, ship only dist/ + prod deps.

# --- Stage 1: build (tsc needs devDependencies) ---
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# --- Stage 2: runtime (prod deps + compiled dist/ only) ---
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Compiled app + migrations + default config.
COPY --from=builder /app/dist ./dist
COPY drizzle ./drizzle
COPY config ./config

ENV PORT=3000
EXPOSE 3000

# DB_URL defaults to a local file; set it to a Turso libsql:// URL (+ DB_AUTH_TOKEN)
# for a hosted database when the platform disk is ephemeral.
CMD ["node", "dist/main.js"]
