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

The web service runs `pnpm --filter @cashback/db db:migrate` as its single Railway
pre-deploy command. Railway starts the new web deployment only after migrations succeed;
the worker does not run a second migration command. `/api/health` is the web health check
and includes database reachability, oldest pending-job age, worker heartbeat, and the
24-hour import failure rate without exposing secrets or report contents.

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

## Local/SIT setup (Docker, mirrors Railway)

Tests and development run on a Docker stack that mirrors the Railway services in
`.railway/railway.ts`: Postgres 18.6 (Debian, `TimeZone=Etc/UTC`, `max_connections=500`,
database `railway`), plus web and worker images built and started with the same commands
Railway uses. The Railway database is used only for debugging or reading data on request
(see `.kiro/steering/production-safety.md`).

1. Start Postgres:
   ```
   docker compose -f infra/docker-compose.yml up -d postgres
   ```
2. In `.env`, point `DATABASE_URL` and `TEST_DATABASE_URL` at it:
   `postgresql://postgres:postgres@localhost:5432/railway`
3. Apply migrations and seed data, then start the apps on the host:
   ```
   pnpm db:migrate
   pnpm db:seed
   pnpm dev
   ```
   Or run web and worker in containers exactly as on Railway (web migrates first, then
   starts; healthcheck `/api/health`):
   ```
   docker compose -f infra/docker-compose.yml --profile app up --build
   ```

The workspace scripts load the root `.env` automatically (`scripts/with-root-env.mjs`).
Existing process/shell variables take precedence, so Railway-provided secrets continue to
override local `.env` values.

The web app runs at `http://localhost:3000`. Bybit CSV reports are stored privately
in Postgres so the web and worker can run in separate containers. See
[Bybit cashback setup and CSV format](apps/web/docs/bybit-cashback.md) for the
import/approval workflow, holding-period configuration, and isolated integration test.
For the MEXC affiliate activity connector and worker environment variables, see
[MEXC referral activity](apps/web/docs/mexc-referral-activity.md).

## Verification

Run `pnpm typecheck`, `pnpm lint`, and `pnpm build` before deployment.

The seed admin defaults to `admin@example.com` / `ChangeMe123!`. Override both values with
`SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` outside local development.

⚠️ Rotate any database password that has ever been shared outside of Railway's dashboard
(e.g. pasted into chat) before relying on it further.

corepack pnpm --filter @cashback/web dev
netstat -ano | findstr :3000
taskkill /PID 58392 /F
