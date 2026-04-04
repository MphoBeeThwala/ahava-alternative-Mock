# Build from repo root: docker build -f workspace/Dockerfile .
# next.config.ts sets distDir:'next', so standalone is at workspace/next/standalone/
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# Install dependencies (monorepo — needs root lockfile)
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY workspace/package.json ./workspace/
RUN pnpm install --frozen-lockfile

# Build Next.js standalone
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/workspace/node_modules ./workspace/node_modules
COPY . .
RUN mkdir -p /app/workspace/public && pnpm --filter workspace build

# Production image — standalone server
# outputFileTracingRoot=repo-root causes Next.js to nest server.js at
# standalone/workspace/server.js (path relative to tracing root).
# WORKDIR /app so that COPY standalone ./ lands server.js at /app/workspace/server.js.
FROM node:20-alpine AS runner
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
WORKDIR /app
COPY --from=builder --chown=nextjs:nodejs /app/workspace/next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/workspace/next/static ./workspace/next/static
COPY --from=builder --chown=nextjs:nodejs /app/workspace/public ./workspace/public
# Remove monorepo root files traced into standalone — prevents Railway pnpm auto-detection
RUN rm -f pnpm-workspace.yaml pnpm-lock.yaml package.json
USER nextjs
EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "workspace/server.js"]
