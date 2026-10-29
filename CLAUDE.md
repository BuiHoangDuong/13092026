# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Cashback affiliate platform for crypto exchanges (Bybit, MEXC, Binance, BingX): ingest affiliate commission/activity data, attribute it to exchange UIDs, compute cashback, and pay it out (internal USDT transfers on a 23:00 UTC schedule). TypeScript monorepo (pnpm workspaces + Turborepo), Next.js 15 web + long-running Node worker, PostgreSQL via Prisma.

## Project knowledge (managed by Claude; migrated from Kiro `.kiro/` on 2026-10-30)

| Path | Content |
|---|---|
| `docs/specs/cashback-platform/` | Specs: `requirements.md`, `design.md`, `tasks.md`, `payables-rtm.md`, `happy-path-scenarios.md` |
| `.claude/rules/` | Always-on rules (imported below) |
| `.claude/skills/check-railway-deploy/` | Skill `/check-railway-deploy` (gitignored, contains Railway project IDs) |

The rules below are imported in full and are binding; when they overlap with this file, take the stricter reading:

@.claude/rules/production-safety.md
@.claude/rules/spec-governance.md
@.claude/rules/context7.md

## Commands

pnpm via Corepack (`corepack enable`, or prefix commands with `corepack`). Node >= 20 (web tests import `.ts` directly, which relies on Node's built-in type stripping — use a current Node).

```
pnpm install
pnpm --filter @cashback/db db:generate   # Prisma client only, no DB needed
pnpm build | pnpm typecheck | pnpm lint | pnpm test   # all via turbo, deps built first (^build)
pnpm dev                                  # web on http://localhost:3000 + worker (tsx watch)
pnpm db:migrate | pnpm db:seed            # prisma migrate deploy / seed (admin@example.com / ChangeMe123!)
```

Run `pnpm typecheck`, `pnpm lint`, `pnpm build` before considering work deployable.

**Tests** use `node --test` (no Jest/Vitest). `packages/*` tests are `.mjs` files importing from `../dist/index.js`, so the package (and its deps) must be built first. Single test:

```
pnpm --filter @cashback/core... build
cd packages/core && node --test test/bybit.test.mjs
node --test --test-name-pattern="Holding duration" test/bybit.test.mjs
```

`apps/web/test/*.test.ts` import from `../src/...` directly (pure logic only) and need no build.

**DB integration tests** are standalone scripts in `scripts/test-*.mjs` (e.g. `node scripts/test-payables.mjs`). They require `TEST_DATABASE_URL`, create an isolated `cashback_test_<uuid>` schema, run `prisma migrate deploy` into it, and use built `dist/` outputs — build first. They refuse to run against Railway hosts.

All workspace scripts load the root `.env` via `scripts/with-root-env.mjs`; existing process env wins over `.env`.

## Workflow: Claude plans & reviews, Codex implements (mandatory)

- **Claude owns specs and docs**: analyse, plan, edit `docs/specs/**`, `docs/**`, `CLAUDE.md`, write task prompts, and review continuously, intervening whenever something looks wrong or inconsistent with the spec.
- **Claude does not write code or tests and does not run the test cycle.** Writing code, writing tests, and running build/lint/typecheck/tests/migrate (Docker) are delegated to Codex, with `agy` as fallback. Claude reviews their diffs and reported results, and sends fixes back.
- **Implementation is delegated to Codex CLI**, non-interactive, one plan step per run:
  `codex exec -s workspace-write -C D:\github-duong\13092026 -o _local/agent-prompts/<step>-result.md - < _local/agent-prompts/<step>.md`
  Review findings go back to the same session with `codex exec ... resume --last -`. A step is accepted only after Claude reviews `git diff` and the checks run by Codex/agy (with their output) pass.
- **If Codex is out of tokens/quota (or fails to start), fall back to Antigravity CLI `agy`**, same prompt file:
  `agy --model claude-opus-5-5-high --dangerously-skip-permissions --print-timeout 0 -p "Đọc file _local/agent-prompts/<step>.md và thực hiện đúng nhiệm vụ; tuân thủ AGENTS.md."` (run from the repo root; `-p` must be the last flag, its value is the prompt; use `agy -c --model claude-opus-5-5-high --dangerously-skip-permissions -p "..."` to continue for review fixes). This account has no `--mode auto` and headless agy auto-denies shell commands, so skip-permissions is required (user-approved 2026-10-30); always pass `--model claude-opus-5-5-high` (strongest available, user choice 2026-10-30; `agy models` lists options); there is no sandbox, so the prompt's safety rules are the only guard — review its diff and log closely. Prompt files live in `_local/agent-prompts/` (gitignored).
- Every task prompt must state: follow `CLAUDE.md` + `.claude/rules/*`, stay within the step's scope, no git stage/commit/push, no Railway, Docker DB only.
- Keep earlier work staged (or otherwise separated) before delegating, so the delegated agent's changes are reviewable as an isolated `git diff`.
- The user can watch Codex sessions with `codex resume` in this folder.
- `AGENTS.md` is the implementer brief that Codex/agy auto-load; keep it in sync when commands, rules or architecture here change. To save re-reading: continue related steps with `resume`, and paste the relevant spec excerpts/signatures into the prompt instead of only pointing at line numbers.

## Database & environment rules (mandatory — from `.claude/rules/`)

- **Never rewrite or delete a migration that exists in any pushed commit** (Railway runs `migrate deploy` on every push). Fix forward with a new, idempotent migration. Before telling the user work is ready, check `git log origin/main -- packages/db/prisma/migrations` and say explicitly whether it is safe to push. (Lesson from 2026-10-30: a rewritten draft migration broke the Railway deploy with 42P07.)
- The root `.env` may point `DATABASE_URL`/`TEST_DATABASE_URL` at Railway. Every delegated DB command must set both to the Docker URL inline in the same command; `with-root-env.mjs` never overrides already-set env.

- Dev/test DB is **only** the Docker stack: `docker compose -f infra/docker-compose.yml up -d postgres` (Postgres 18.6, `TimeZone=Etc/UTC`, DB `railway`, `postgresql://postgres:postgres@localhost:5432/railway`). `--profile app up --build` runs web+worker in containers exactly as on Railway. Migrate/seed/reset/integration tests on this stack need no confirmation.
- Never substitute another Postgres (local install, other version) or SQLite. If Docker is unavailable, stop and tell the user.
- Before running any test, check `TEST_DATABASE_URL`/`DATABASE_URL` host: if it matches `*.rlwy.net`, `*.railway.internal`, `*.up.railway.app`, stop.
- Railway is touched only when the user explicitly asks, and only for reads (logs, status, `railway config pull/plan`, `SELECT`/`EXPLAIN`). No migrate, seed, scripts, `railway config apply`, or any write without describing the command and getting explicit approval.
- Always ask before dropping a database, changing credentials/roles, or anything irreversible.

## Spec governance

`docs/specs/cashback-platform/requirements.md` (WHAT/WHY, EARS criteria, `### Requirement N`) and `design.md` (HOW) are the source of truth; `tasks.md` tracks implementation, `payables-rtm.md` traces Req 22. `architecture.html` is background only.

- Spec first, code second: update the relevant spec before changing system behavior, propagate cross-impacts (requirements ↔ design ↔ data model ↔ API), and delete obsolete content rather than leaving legacy alongside.
- Never reuse a removed requirement number. Unresolved items go under "Open decisions", never as SHALL.
- Every spec change adds a row to the `## Changelog` table at the end of the edited file (`| Ngày | File | Thay đổi | Lý do | Loại |`).
- If code and spec diverge, point it out and propose which side to fix — don't silently shrink scope. Ask before broad rewrites of a requirement.
- Spec docs are largely in Vietnamese; keep that language when editing them.
- When behavior depends on Next.js routing/auth/cache, React effects, Prisma transactions or Zod, verify against version-matched docs (Context7 if available) rather than memory; never send secrets or user data in those queries.
- Final response of any task that edited files must end with a **File đã thay đổi** section: counts of modified/created/deleted files and a one-line purpose per file (only files you changed).

## Architecture

```
packages/contracts  zod schemas + types, browser-safe; may not import other @cashback/*
packages/db         Prisma schema/migrations/seed; client generated into dist/generated; exports `db` singleton
packages/core       all business logic (services/, ingest/, payout/), re-exported flat from src/index.ts
apps/web            Next.js App Router: pages + /api route handlers that call core services
apps/worker         single polling loop (src/index.ts) dispatching jobs to core
```

- Packages export from `dist/`, so a fresh checkout must build deps before apps (`pnpm --filter <app>... build` — the trailing `...` matters; Railway uses it).
- **Import boundaries are lint-enforced** (`eslint.config.mjs`): any web module with `"use client"` may import only `@cashback/contracts`, not `core`/`db`; `db` cannot import `core`/`contracts`; `contracts` imports nothing internal.
- **Job queue is Postgres** (`Job` table, `FOR UPDATE SKIP LOCKED` claim, lease + heartbeat + reaper; `services/jobs.ts`). The worker tick also runs periodic schedulers (hold release, due syncs, payout slot, reconcile, readiness, raw purge, health alerts). Adding a job type means: enum in `schema.prisma` + migration, handler in core, dispatch branch in `apps/worker/src/index.ts`. Handlers take a `lease` and must re-verify it before committing.
- **Ingest pipeline** is source-neutral after parsing: CSV upload or official API → `RawLoad` (raw landing) → `TRANSFORM` → staging → `PUBLISH` (versioned, idempotent) → `ATTRIBUTE` → commission/cashback records → `RELEASE_HOLDS` after `HOLDING_PERIOD_HOURS`. Per-exchange adapters live in `packages/core/src/ingest/` (`source-adapter.ts` / `contract.ts` define the interface). Scheduled API syncs are `SYNC` jobs gated by `ExchangeSyncConfig` readiness.
- **Money**: always Prisma `Decimal`, serialized as strings in APIs; never JS floats. Wallet/WalletEntry are the balance ledger; Req 22 adds the `CustomerPayable` ledger (`services/payables.ts`) with `PayoutExecution`/`PayableAllocation`/`PayableCommand`, a `MoneyFlowGate` kill-switch (`services/money-gate.ts`), and daily `PAYOUT_SLOT` jobs at 23:00 UTC with `PAYOUT_RECONCILE` for in-flight/UNKNOWN transfers. Exchange transfers go through the `InternalTransfer` port (`payout/internal-transfer.ts`); tests use `SimulatedInternalTransfer`. Customers no longer initiate withdrawals (auto-only, Req 22.35). Payout rules are dense and decision-driven — read the Req 22 sections of `design.md` before changing them.
- **Auth**: two separate principals — admin (email+password session, `withAdmin()` in `apps/web/src/lib/admin-api.ts`, `middleware.ts` guards `/admin`) and UID owner (email OTP → `UidSession` scoped to one UID account, `lib/uid-api.ts`). Rate limits are DB-backed (`RateLimitCounter`).
- **i18n**: single locale registry in `apps/web/src/i18n/index.ts` (English only); user-facing strings go in `i18n/messages/en.ts`, never hard-coded locale codes. Non-default locales route under `app/[locale]/`.
- **UI**: Tailwind v4 + shadcn/ui in `components/ui`. Public site uses the "Dark Aurora" theme (`aurora.css`, `components/public/`); admin uses a separate left-nav shell under `app/admin/(shell)/`.
- Payout secrets (`PAYOUT_*`) are worker-only; the web container blanks them.

## Deployment

Railway services and their build/start/preDeploy commands are defined in `.railway/railway.ts` (Railway IaC) — edit that file, never the dashboard. Web runs `db:migrate` as pre-deploy; health check is `/api/health`. See `.claude/skills/check-railway-deploy/SKILL.md` for deploy debugging, and `docs/operations.md` for operations.
