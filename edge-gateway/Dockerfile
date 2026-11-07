# ==============================================================================
# WeaveSync SCADA - Industrial Edge Gateway Dockerfile
# Client: Ali Haider Industries (SITE Industrial Area, Karachi)
# Base: Node.js 22 LTS (Bookworm Slim) Multi-Stage Build
# Target Architecture: x86_64 / arm64 Industrial Gateway PC (Ubuntu 24.04 LTS)
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Builder (Compile TypeScript Services: Collector, Outbox, Forwarder)
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install npm dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy TypeScript configuration and source files
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript to production JavaScript in /app/dist
RUN npm run build

# Prune devDependencies to keep runtime bundle minimal
RUN npm prune --production

# ------------------------------------------------------------------------------
# Stage 2: Production Runtime Appliance
# ------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runner

LABEL maintainer="WeaveSync Engineering <engineering@weavesync.com>"
LABEL client="Ali Haider Industries"
LABEL version="1.0.0"
LABEL description="WeaveSync SCADA Industrial Edge Gateway Appliance"

WORKDIR /app

ENV NODE_ENV=production \
    EDGE_GATEWAY_HTTP_PORT=4841 \
    SQLITE_DB_PATH=/app/data/sqlite/outbox.db \
    GATEWAY_MODE=HYBRID \
    PILOT_LOOM_ID=PIC-427708

# Create SQLite WAL storage directory with proper permissions for the node user
RUN mkdir -p /app/data/sqlite && \
    chown -R node:node /app/data

# Copy production artifacts from builder stage
COPY --chown=node:node --from=builder /app/package.json ./
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist

# Persist SQLite WAL database across container updates & reboots
VOLUME ["/app/data/sqlite"]

# Expose HTTP Ingestion Port for direct WT32-ETH01 LAN packets
EXPOSE 4841

# Switch to standard unprivileged user for security hardening
USER node

# Healthcheck validating local gateway responsiveness
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:4841/health', (r) => { if (r.statusCode !== 200) process.exit(1); });"

# Launch Edge Gateway
CMD ["node", "dist/index.js"]
