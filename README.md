# Cashback Affiliate Platform

TypeScript monorepo for the cashback platform described in `.kiro/specs/cashback-platform`.

## Prerequisites

- Node.js >= 20
- pnpm via Corepack: `corepack enable` (or prefix every command below with `corepack`, e.g.
  `corepack pnpm install`, if `pnpm` is not on your `PATH`)

## Install & build (no database required)

```
pnpm install
pnpm --filter @cashback/db db:generate
pnpm build
pnpm typecheck
pnpm lint
```

`db:generate` only generates the Prisma client from `packages/db/prisma/schema.prisma`; it
does not touch a database, so this sequence is enough to compile and verify the workspace
locally without any Postgres connection.

## Railway deployment

Both services share workspace packages, so keep their **Root Directory** at the repository
root (`/`). Build and start commands are defined in code (Railway's Infrastructure as Code),
not in the dashboard:

- `.railway/railway.ts` — declares both services, their `buildCommand`/`start`, and which
  Railway project/environment they belong to.

| Service | Build Command | Start Command |
| --- | --- | --- |
| Web | `pnpm --filter @cashback/web... build` | `pnpm --filter @cashback/web start` |
| Worker | `pnpm --filter @cashback/worker... build` | `pnpm --filter @cashback/worker start` |

The trailing `...` in each build filter includes all workspace dependencies
and builds them before the app. This also runs `prisma generate` as part of the database
package build. A filter without `...` only builds the app and fails on a fresh deployment
because `@cashback/contracts`, `@cashback/db`, and `@cashback/core` export files from `dist`.
Start commands intentionally select only the service itself.

After deploying, check that the build log shows `contracts`, `db`, and `core` building before
the selected app.

**Changing the config**: edit `.railway/railway.ts`, run `railway config plan` to preview the
diff against the live project, then `railway config apply` to push it. Do not edit build/start
commands directly in the Railway dashboard — `railway.ts` is the source of truth, and a later
`railway config apply` (or drift check) would overwrite an out-of-band dashboard change.
Railway's older `railway.json`/`railway.toml` Config as Code format is deprecated; this repo
does not use it.

## Local/SIT setup (with a database)

SIT does not run Postgres in local Docker. `web`/`worker` run on the host via `pnpm dev`
against a **dedicated Railway test Postgres** (separate from prod), reached over its
public/proxy host — `*.internal` hostnames only resolve inside Railway's network.
`infra/docker-compose.yml` is kept only as an optional convenience if you prefer a
container instead of a hosted test database; it is not part of the SIT workflow.

1. Copy `.env.example` to `.env` and set `DATABASE_URL` to the Railway test Postgres
   **public** connection string (`...proxy.rlwy.net:<port>/railway`), not the `*.internal`
   one.
2. Apply migrations and seed data:
   ```
   pnpm db:migrate
   pnpm db:seed
   ```
3. Start the web app and worker:
   ```
   pnpm dev
   ```

The workspace scripts load the root `.env` automatically (`scripts/with-root-env.mjs`).
Existing process/shell variables take precedence, so Railway-provided secrets continue to
override local `.env` values.

The web app runs at `http://localhost:3000`. Bybit CSV reports are stored privately
in Postgres so the web and worker can run in separate containers. See
[Bybit cashback setup and CSV format](apps/web/docs/bybit-cashback.md) for the
import/approval workflow, holding-period configuration, and isolated integration test.

## Verification

Run `pnpm typecheck`, `pnpm lint`, and `pnpm build` before deployment.

The seed admin defaults to `admin@example.com` / `ChangeMe123!`. Override both values with
`SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` outside local development.

⚠️ Rotate any database password that has ever been shared outside of Railway's dashboard
(e.g. pasted into chat) before relying on it further.

corepack pnpm --filter @cashback/web dev
netstat -ano | findstr :3000
taskkill /PID 58392 /F
