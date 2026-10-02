# The image builds the application only. Solidity prototypes are never copied.
FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public
ENV VITE_APP_MODE=connected
RUN npm run build

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS service-dependencies
WORKDIR /build/server
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY server/package.json server/package-lock.json ./
# better-sqlite3 installs its pinned native binding or builds it in this stage.
RUN npm ci --omit=dev

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS application
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DB_PATH=/var/lib/riftwell/riftwell.sqlite DIST_PATH=/app/dist
WORKDIR /app
RUN mkdir -p /var/lib/riftwell && chown node:node /var/lib/riftwell
COPY --from=frontend --chown=node:node /build/dist ./dist
COPY --from=service-dependencies --chown=node:node /build/server/node_modules ./server/node_modules
COPY --chown=node:node server/*.mjs server/package.json ./server/
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health/live',{signal:AbortSignal.timeout(3000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
