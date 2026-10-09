# GitHub builds releases; --build in upgrade.sh remains an explicit source fallback.
FROM node:24-bookworm-slim AS build
# Run real SMTP/TLS certificate tests and the Postal deployment health probe.
RUN apt-get update && apt-get install -y --no-install-recommends openssl curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
ARG APP_VERSION
ARG DEPLOYMENT_CONTRACT
RUN test "$APP_VERSION" = "$(node -p 'require("./package.json").version')" \
 && test "$DEPLOYMENT_CONTRACT" = "$(sh scripts/deployment-contract.sh)"
RUN npm run postinstall && npm test && npm run typecheck && npm run build

FROM build AS runtime-dependencies
RUN npm prune --omit=dev --ignore-scripts

FROM node:24-bookworm-slim AS runtime
ARG APP_VERSION
ARG DEPLOYMENT_CONTRACT
ARG VCS_REF
LABEL org.opencontainers.image.title="CardShelf" \
      org.opencontainers.image.source="https://github.com/frankymcgee/cardshelf" \
      org.opencontainers.image.version="$APP_VERSION" \
      org.opencontainers.image.revision="$VCS_REF" \
      io.cardshelf.deployment-contract="$DEPLOYMENT_CONTRACT"
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
