# Playwright worker — non-privileged, pinned browser.
#
# The base image tag MUST match the pinned Playwright version
# (package.json "playwright" + PINNED_PLAYWRIGHT_VERSION in
# workers/playwright/src/browser-pin.ts). The worker refuses to start
# on a version mismatch.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY workers/playwright/package.json workers/playwright/package.json
COPY workers/playwright/tsconfig.json workers/playwright/tsconfig.json
COPY workers/playwright/src workers/playwright/src
COPY packages/schemas/src packages/schemas/src
RUN npm run worker:build

# Non-privileged execution: never run the worker (or its browser) as root.
RUN useradd -m -u 10001 tpworker && chown -R tpworker:tpworker /app
USER tpworker

ENV NODE_ENV=production
CMD ["node", "workers/playwright/dist/workers/playwright/src/index.js"]
