FROM node:22-alpine

# Install pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./
COPY tsconfig.json tsup.config.ts ./

# Copy source files
COPY src ./src

# Install dependencies and build
RUN pnpm install --frozen-lockfile --prod=false && \
    pnpm run build && \
    pnpm prune --prod && \
    rm -rf src tsconfig.json tsup.config.ts

# Create database directory
RUN mkdir -p /app/database

# Environment variables for auto-init
ENV NODE_ENV=production
ENV KUZU_MCP_DATABASE_PATH=/app/database
ENV KUZU_AUTO_INIT=true
ENV KUZU_INIT_TEMPLATE=movies
ENV PORT=3000

# Expose HTTP port for Smithery
EXPOSE $PORT

# Smithery requires HTTP transport with Streamable protocol
# The auto-initialization is handled in the main code now
CMD ["node", "dist/index.js", "--transport", "http", "--port", "3000"]