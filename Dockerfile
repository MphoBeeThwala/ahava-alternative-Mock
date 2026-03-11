# Multi-stage build for pnpm monorepo with Next.js frontend
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# ============================================================================
# DEPENDENCIES STAGE
# ============================================================================
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY workspace/package.json ./workspace/

# Install dependencies - pnpm understands workspace layout
RUN pnpm install --frozen-lockfile

# ============================================================================
# BUILDER STAGE - Build Next.js frontend
# ============================================================================
FROM base AS builder
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NODE_ENV=production

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy all source files
COPY . .

# Set PATH to find 'next' in root node_modules/.bin
# Build Next.js directly from workspace directory without pnpm
WORKDIR /app/workspace
ENV PATH="/app/node_modules/.bin:${PATH}" \
    NODE_PATH=/app/node_modules
# Use direct node path to next since it's in root node_modules
RUN node /app/node_modules/.bin/next build

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
