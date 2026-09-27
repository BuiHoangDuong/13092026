# Mirrors the Railway Railpack build for one service (see .railway/railway.ts).
# NODE_VERSION must match the Node version Railway uses; pin it in package.json
# "engines.node" so both sides resolve the same major.
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-trixie-slim

# Prisma query engine needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV TZ=Etc/UTC
RUN corepack enable

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

ARG SERVICE
RUN test -n "$SERVICE" && pnpm --filter "@cashback/${SERVICE}..." build
