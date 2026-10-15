# syntax=docker/dockerfile:1.7
FROM node:24.21.0-alpine

ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org/
RUN npm install --global pnpm@11.0.9 --registry="$NPM_CONFIG_REGISTRY"

RUN mkdir -p /app && chown node:node /app
USER node
WORKDIR /app

# Dependency downloads depend on manifests and the lockfile, not app or docs edits.
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --chown=node:node apps/api/package.json ./apps/api/package.json
COPY --chown=node:node apps/web/package.json ./apps/web/package.json
COPY --chown=node:node apps/demo-target/package.json ./apps/demo-target/package.json
COPY --chown=node:node apps/worker/package.json ./apps/worker/package.json
COPY --chown=node:node packages/scanners/package.json ./packages/scanners/package.json
RUN --mount=type=cache,id=aegislab-pnpm,target=/home/node/.local/share/pnpm/store,uid=1000,gid=1000 \
    npm_config_registry="$NPM_CONFIG_REGISTRY" pnpm_config_registry="$NPM_CONFIG_REGISTRY" pnpm fetch --frozen-lockfile

COPY --chown=node:node . .
RUN --mount=type=cache,id=aegislab-pnpm,target=/home/node/.local/share/pnpm/store,uid=1000,gid=1000 \
    pnpm install --offline --frozen-lockfile && pnpm build
