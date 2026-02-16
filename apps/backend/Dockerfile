# Build from repo root: docker build -f apps/backend/Dockerfile .
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# Install dependencies (monorepo)
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY workspace/package.json ./workspace/
RUN pnpm install --frozen-lockfile

# Build backend only
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY . .
RUN pnpm --filter @ahava-healthcare/api prisma:generate
RUN pnpm --filter @ahava-healthcare/api build

# Production image: pnpm uses symlinks in apps/backend/node_modules -> ../../node_modules/.pnpm
# so we must copy root node_modules (the store) for require() to resolve.
FROM node:20-alpine AS runner
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 apiuser
WORKDIR /app/apps/backend
COPY --from=builder --chown=apiuser:nodejs /app/node_modules /app/node_modules
COPY --from=builder --chown=apiuser:nodejs /app/apps/backend/dist ./dist
COPY --from=builder --chown=apiuser:nodejs /app/apps/backend/node_modules ./node_modules
COPY --from=builder --chown=apiuser:nodejs /app/apps/backend/package.json ./
COPY --from=builder --chown=apiuser:nodejs /app/apps/backend/prisma ./prisma
USER apiuser
EXPOSE 4000
ENV NODE_ENV=production
# Migrations: run separately (e.g. CI or release job), not in container startup
CMD ["node", "dist/index.js"]
