# Build from repo root: docker build -f workspace/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com/api .
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY workspace/package.json ./workspace/
RUN pnpm install --frozen-lockfile

# Build Next.js (standalone)
FROM base AS builder
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter workspace build

# Production image (standalone outputs server.js in .next/standalone)
FROM node:20-alpine AS runner
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
WORKDIR /app/workspace
COPY --from=builder /app/workspace/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/workspace/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/workspace/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
CMD ["node", "server.js"]