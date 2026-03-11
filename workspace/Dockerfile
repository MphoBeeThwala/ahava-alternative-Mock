# Multi-stage build for Next.js frontend in monorepo
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

# Install dependencies for entire monorepo
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

# Build Next.js with standalone output (required for Docker)
WORKDIR /app/workspace
RUN pnpm build

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

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start application
CMD ["node", "server.js"]
