# Playwright worker — non-privileged, pinned browser, reproducible.
#
# Reproducibility: the base image tag pins Playwright AND its bundled
# Node (v1.64.1-noble ships Node 22.x) AND the Chromium build together.
# package.json "playwright" + PINNED_PLAYWRIGHT_VERSION in
# workers/playwright/src/browser-pin.ts must match the tag; the worker
# refuses to start on a version mismatch. Dependencies install from the
# committed lockfile (npm ci) — nothing floats. For maximum rigor, pin
# the base image by digest as well:
#   docker buildx imagetools inspect mcr.microsoft.com/playwright:v1.64.1-noble
# and replace the tags below with name@sha256:<digest>.
#
# Two stages: the build stage installs ALL dependencies (TypeScript is
# a devDependency) and compiles; the runtime stage installs production
# dependencies only and copies the compiled output — the shipped image
# contains no compiler and no dev tooling.
#
# Build from the REPOSITORY ROOT:
#   docker build -f workers/playwright/Dockerfile -t testpilot-worker:<git-sha> .

FROM mcr.microsoft.com/playwright:v1.64.1-noble AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY workers/playwright/package.json workers/playwright/package.json
COPY workers/playwright/tsconfig.json workers/playwright/tsconfig.json
COPY workers/playwright/src workers/playwright/src
COPY packages/schemas/src packages/schemas/src
RUN npm run worker:build

FROM mcr.microsoft.com/playwright:v1.64.1-noble AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/workers/playwright/dist ./workers/playwright/dist

# Non-privileged execution: never run the worker (or its browser) as root.
RUN useradd -m -u 10001 tpworker && chown -R tpworker:tpworker /app
USER tpworker

ENV NODE_ENV=production

# The worker serves /healthz + /metrics on WORKER_HEALTH_PORT (8080).
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_HEALTH_PORT||8080)+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

# Graceful shutdown: the worker handles SIGTERM itself (drains in-flight
# jobs within WORKER_SHUTDOWN_TIMEOUT_MS). Give the container a stop
# grace period longer than that (compose/run flags, see
# docs/WORKER_DEPLOYMENT.md).
STOPSIGNAL SIGTERM
CMD ["node", "workers/playwright/dist/workers/playwright/src/index.js"]
