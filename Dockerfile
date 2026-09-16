# Build on the server, or in CI, with Docker BuildKit. No globally installed npm tools are needed.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
# Reconcile an older server-retained lockfile with this release manifest inside
# the build image only, then install from that lock. The host source is untouched.
RUN npm install --package-lock-only --ignore-scripts --no-audit --no-fund && npm ci --ignore-scripts
COPY . .
RUN npm run postinstall && npm test && npm run typecheck && npm run build

FROM build AS runtime-dependencies
RUN npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 NITRO_HOST=0.0.0.0 NITRO_PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/.output ./.output
COPY --from=runtime-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node shared ./shared
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node worker ./worker
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
