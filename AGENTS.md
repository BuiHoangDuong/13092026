# AGENTS.md

Instructions for implementation agents (Codex CLI, Antigravity `agy`) working in this repository. `CLAUDE.md` holds the same project knowledge in more detail; read it only if something here is unclear.

## Your role

- You **implement** tasks handed to you by Claude (planner/reviewer): write code, write tests, and run build/lint/typecheck/tests/migrations on the Docker stack. Claude owns specs and docs and reviews your diff.
- Stay strictly within the task prompt's scope. Do **not** edit `docs/specs/**`, `docs/**`, `CLAUDE.md` or `AGENTS.md`; if the spec looks wrong or conflicts with the prompt, the spec wins — report the conflict instead of changing it.
- Never `git add`/`commit`/`push`, never touch Railway (`railway ...`, Railway DB URLs). Earlier accepted work is staged on purpose so your changes show up as an isolated `git diff`.
- Finish with a report: files created/modified/deleted with purpose, every check you ran **with its result** (pass/fail + key output lines), anything you could not run and why, and open doubts. Also write the same report to the handoff file if the prompt names one.

## Source of truth

`docs/specs/cashback-platform/requirements.md` (WHAT, `### Requirement N`, EARS) and `design.md` (HOW) decide behaviour; `tasks.md` tracks tasks (current: Task 44). Read only the sections the prompt points to. Binding project rules live in `.claude/rules/` (`production-safety.md`, `spec-governance.md`, `context7.md`); the essentials are summarised below.

## Commands

pnpm via Corepack (`corepack pnpm ...`). Workspace scripts load root `.env` via `scripts/with-root-env.mjs`.

```
corepack pnpm build | typecheck | lint | test        # turbo, deps built first
corepack pnpm --filter @cashback/db db:generate      # Prisma client only
corepack pnpm db:migrate | db:seed                   # Docker DB only
cd packages/core && node --test test/<file>.test.mjs # needs built dist/
cd apps/web && node --test test/<file>.test.ts       # imports src directly
node scripts/test-<name>.mjs                          # DB integration; needs TEST_DATABASE_URL, builds dist first
```

## Database rules (mandatory)

- Only the Docker Postgres: `docker compose -f infra/docker-compose.yml up -d postgres` → `postgresql://postgres:postgres@localhost:5432/railway`. Migrate/seed/reset there freely.
- Before any DB command check `DATABASE_URL`/`TEST_DATABASE_URL`: if the host matches `*.rlwy.net`, `*.railway.internal`, `*.up.railway.app`, stop and report.
- No other Postgres, no SQLite. If Docker is unavailable, skip DB steps and report it.
- New migrations: hand-written folder `packages/db/prisma/migrations/YYYYMMDD000N_snake_case/migration.sql`, matching existing style.

## Architecture essentials

- `packages/contracts` (zod, browser-safe, imports nothing internal) → `packages/db` (Prisma, `db` singleton, may not import core/contracts) → `packages/core` (all business logic, flat re-export in `src/index.ts`) → `apps/web` (Next.js 15 App Router, `/api` handlers call core) and `apps/worker` (Postgres job loop in `src/index.ts`).
- Packages export from `dist/`: build before running package tests or apps.
- Lint-enforced: a `"use client"` module may import only `@cashback/contracts`.
- Money is `Prisma.Decimal` / fixed-point BigInt, serialized as strings; never JS floats.
- Customer flow is public lookup by exchange + UID and automatic payout to the exchange UID; there is no customer login/OTP/wallet/withdrawal (Req 15/16 removed). Admin uses `withAdmin()` (`apps/web/src/lib/admin-api.ts`).
- User-facing strings live in `apps/web/src/i18n/messages/en.ts` (English only).
- Match the surrounding code style: dense lines, few comments, existing helpers reused.
