# Build context: the repository root  ->  docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/net-guard/package.json packages/net-guard/
# Only the api's workspace graph is installed. The prisma CLI (a devDependency) is kept because migrations run at start.
RUN npm ci --workspace @wi/api --include-workspace-root
COPY prisma prisma
COPY packages packages
COPY apps/api apps/api
# Generate the Prisma client on the SAME OS/openssl as the runtime so the right query engine is bundled.
RUN npx prisma generate --schema prisma/schema.prisma && npm run build -w @wi/api
ENV NODE_ENV=production
USER node
EXPOSE 4000
# migrate deploy is idempotent and safe on every start: it applies only pending migrations.
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node apps/api/dist/server.js"]
