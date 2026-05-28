# Stage 1: Build all packages in the monorepo
FROM node:18-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json tsup.config.ts ./
COPY packages/ ./packages/

# Install dependencies and build all packages
RUN npm ci
RUN npm run build

# Stage 2: Minimal runner stage
FROM node:18-alpine

WORKDIR /app

COPY --from=builder /app /app

ENV PATH="/app/packages/cli/bin:${PATH}"

# Default command runs the CLI
ENTRYPOINT ["axiomify"]
CMD ["--help"]
