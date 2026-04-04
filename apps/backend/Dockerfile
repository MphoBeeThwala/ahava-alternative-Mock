# Build from apps/backend/ directory (Railway Root Directory = "apps/backend").
# Uses npm because pnpm-lock.yaml lives at the repo root (not in this context).
FROM node:20-alpine AS base
WORKDIR /app

# Install all dependencies (including devDependencies needed for build)
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm install

# Build: generate Prisma client, compile TypeScript
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate --schema=prisma/schema.prisma
RUN npm run build

# Production image: copy only compiled output + runtime deps
FROM node:20-alpine AS runner
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 apiuser
WORKDIR /app
COPY --from=builder --chown=apiuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=apiuser:nodejs /app/dist ./dist
COPY --from=builder --chown=apiuser:nodejs /app/package.json ./
COPY --from=builder --chown=apiuser:nodejs /app/prisma ./prisma
USER apiuser
EXPOSE 4000
ENV NODE_ENV=production
CMD node_modules/.bin/prisma migrate deploy && node dist/index.js
