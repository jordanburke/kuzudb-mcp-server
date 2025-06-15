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
    pnpm run build && \
    pnpm prune --prod && \
    rm -rf src tsconfig.json tsup.config.ts && \
    rm -rf node_modules/kuzu/prebuilt node_modules/kuzu/kuzu-source

# Set environment variables
ENV NODE_ENV=production
ENV KUZU_DB_PATH=/database

# Run app
ENTRYPOINT ["node", "dist/index.js"]