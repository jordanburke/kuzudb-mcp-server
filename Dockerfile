FROM node:22

# Install pnpm
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Copy app files
RUN mkdir -p /home/node/app
WORKDIR /home/node/app

# Copy package files first for better caching
COPY ./package.json ./pnpm-lock.yaml ./
COPY ./tsconfig.json ./tsup.config.ts ./

# Copy source files
COPY ./src ./src

# Set ownership
RUN chown -R node:node /home/node/app

# Make database directory and set permissions
RUN mkdir -p /database
RUN chown -R node:node /database

# Switch to node user
USER node

# Install dependencies and build
RUN pnpm install --frozen-lockfile --prod=false && \
    cd node_modules/.pnpm/kuzu@0.11.1/node_modules/kuzu && node install.js && cd /home/node/app && \
    pnpm run build && \
    rm -rf src tsconfig.json tsup.config.ts

# Set environment variables
ENV NODE_ENV=production
ENV KUZU_MCP_DATABASE_PATH=/database

# Expose HTTP ports (MCP server and Web UI)
EXPOSE 3000 3001

# Run app in HTTP mode by default
ENTRYPOINT ["sh", "-c", "node dist/index.js --transport http --port ${PORT:-3000}"]