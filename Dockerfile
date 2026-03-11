# Multi-stage build for pnpm monorepo with Next.js frontend
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# ============================================================================
# DEPENDENCIES STAGE - Copy source first so pnpm understands workspace
# ============================================================================
FROM base AS deps
# Copy workspace configuration first
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy all package.json files to establish workspace structure
COPY apps/backend/package.json ./apps/backend/
COPY workspace/package.json ./workspace/

# Install dependencies - pnpm will understand workspace layout
RUN pnpm install --frozen-lockfile

# ============================================================================
# BUILDER STAGE - Build Next.js frontend
# ============================================================================
FROM base AS builder
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NODE_ENV=production

# Copy pnpm config and all dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/.pnpm-store ./.pnpm-store 2>/dev/null || true

# Copy workspace configuration (needed for pnpm --filter to work)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY workspace/package.json ./workspace/

# Copy source code
COPY workspace ./workspace

# Build the frontend using pnpm filter (uses root node_modules)
RUN pnpm --filter workspace build

# ============================================================================
# RUNTIME STAGE - Minimal production image
# ============================================================================
FROM node:20-alpine AS runner
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
WORKDIR /app/workspace

# Copy built application (Next.js standalone output)
COPY --from=builder /app/workspace/public ./public
COPY --from=builder /app/workspace/.next/standalone ./
COPY --from=builder /app/workspace/.next/static ./.next/static

USER nextjs
EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "server.js"]
