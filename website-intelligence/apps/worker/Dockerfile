# Build context: the website-intelligence/ folder  ->  docker build -f apps/worker/Dockerfile .
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
COPY packages/net-guard/package.json packages/net-guard/
RUN npm ci --workspace @wi/worker --include-workspace-root
# Chromium and its OS libraries are installed at build time, not on every start.
RUN npx playwright-core install --with-deps chromium && rm -rf /var/lib/apt/lists/* && chmod -R a+rX /ms-playwright
COPY prisma prisma
COPY packages packages
COPY apps/worker apps/worker
RUN npx prisma generate --schema prisma/schema.prisma && npm run build -w @wi/worker
ENV NODE_ENV=production
USER node
CMD ["node", "apps/worker/dist/worker.js"]
