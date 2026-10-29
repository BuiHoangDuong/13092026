# Implementation Plan — Cashback Affiliate Platform

- **Status:** Draft v2.3 (UID-first: no customer accounts; cashback lookup by exchange + UID;
  lookup công khai, tự trả về UID sàn; Task 44 chưa triển khai)
- **Last updated:** 2026-10-30
- **Derives from:** `requirements.md` (Draft v0.9), `design.md` (Draft v1.0)

## Mandatory: follow `.claude/rules/` before every task

Every task in this plan, whether done by a person or an agent (Claude, Codex, agy),
MUST comply with all files in `.claude/rules/`. If a task description conflicts with
steering, **steering wins**; stop and ask the user instead of choosing the less strict
reading. Read the steering files before starting a task. The summary below does not
replace them.

| Steering file | Rules that block a task |
|---------------|-------------------------|
| `production-safety.md` | **Test on the Docker stack that mirrors Railway** (`infra/docker-compose.yml`: Postgres 18.6 Debian, `TimeZone=Etc/UTC`, `max_connections=500`, DB `railway`; web/worker with the Railway build, `preDeploy` migrate, start and `/api/health`). Build, migrate, seed and integration tests run there without asking. No other DB (no host-installed Postgres, SQLite, or a different Postgres version). **Railway only for debugging or reading data when the user asks**; never run tests, migrations, seeds, scripts or `railway config apply` on Railway on your own. Always ask first before deleting a whole database or instance, changing credentials, access control or roles, or any action with no rollback. |
| `spec-governance.md` | Update spec first, then code: `requirements.md` (WHAT) and `design.md` (HOW) are the source of truth. Check cross-impact, remove obsolete (legacy) content instead of stacking new text beside it, and add one changelog row for each spec change. Keep `Requirement N` numbers stable and never reuse a removed number. Keep EARS format. Undecided items go to "Open decisions", never SHALL. §7: test DB is Docker; check that `TEST_DATABASE_URL` is not a Railway host before running tests; Railway (§7.1b) only on request; production is read-only for the agent. §8: end each response that changed files with a "File đã thay đổi" summary. |
| `context7.md` | Before implementing or reviewing framework, library, SDK or API behavior (Next.js, React, Prisma transactions, Zod…), check the docs through Context7 for the version in the lockfile and state what was checked. Never send secrets, customer data or reports into Context7 queries. |

**Running tests.** Start the stack with
`docker compose -f infra/docker-compose.yml up -d postgres` (add `--profile app up
--build` for web + worker) and point `TEST_DATABASE_URL` at it
(`postgresql://postgres:postgres@localhost:5432/railway`). If Docker is not available,
stop and report; do not switch to another database or to Railway. A test counts as
verified only when it passes on this stack.

## Overview

This plan sequences the build into phases. Tasks are incremental coding steps; each
references the requirement acceptance criteria it fulfills and the design sections it
implements. `[PENDING]` markers block only their own task, not the whole plan. Task
numbers are stable identifiers cited in code and docs, not an execution order.

**Reference convention:** `Requirements: N.M` cites EARS criteria in `requirements.md`.
`Open decision #N` cites a numbered row in `requirements.md` → "Open decisions"
(a stakeholder answer), not Requirement N.

- **Phase 0** — Foundation & smoke: monorepo, DB, contracts, local + Railway skeleton,
  public site, redirect, interim auth, admin content. Runs on seed data.
- **Phase 1** — Import pipeline (versioned), UID accounts, attribution + cashback.
- **Phase 2** — Lookup, wallet (reserved) & withdrawals.
- **Phase 3** — Hardening: security, targeted tests, production observability/backups.
- **Phase 4** — Bybit activity API sync is implemented; MEXC connector code is
  ready for Docker integration and live data reconciliation. Optional SSE and
  dimensional partitioning remain deferred.
- **Phase 5 — Public UI:** Dark Aurora đã chốt; Task 40 triển khai độc lập với
  payout Task 39. #23–24 đã chốt theo plan; 40.1–40.4 đã có code và checks Docker đạt.
  40.5 còn chờ visual QA; đổi tên (#22) không chặn UI.

### Current status (2026-10-30)

Task 43 có code/bằng chứng lịch sử nhưng công thức calculator, ngày lookup và việc giữ truy cập khách riêng tư đã bị thay thế bởi quyết định 30/10. Task 44 chưa triển khai/kiểm chứng. Khách chỉ lookup công khai theo sàn + UID và nhận chi tự động; admin queue legacy/payables giữ nguyên. Task đã hoàn thành trước đây không chứng minh đáp ứng spec mới.

Open:
- **Import (Tasks 10.2, 10.8, 10.9, 11.1):** The shared envelope and MEXC Referral Data
  XLSX activity adapter are in place (Tasks 10.5–10.7). The real MEXC sample has 46 UIDs,
  all with zero volume/earnings, so Task 10.8 cannot confirm those columns are period
  totals and the UI keeps calling them reported metrics. Native Bybit mapping, the deferred
  CSV activity fallback, and Open decision #11 (`dedupKey`) still need nonzero UID-level
  commission evidence. Referral `Your Earnings` is not payable commission.
- **Hardening (Tasks 18, 19):** invariants pass; applying the reviewed `railway config`
  plan awaits user confirmation.
- **Deployment:** Task 5.6 live check; không triển khai trong bước tài liệu này.
- **API sync (Task 20 implemented; live rollout not run):** Bybit activity sync is in
  code. MEXC's referral API connector and Docker integration are verified on
  2026-10-07; root UID configuration and a nonzero period comparison remain
  pending (Task 20.6). Its schedule stays disabled until that evidence is supplied.
  Both keep reported activity separate from wallets. The
  2026-09-26 sink integration could not reach the Railway proxy, and the read-only
  probe was not executed in this session.
  Probe 2026-09-26 (read-only; roster had 54 UIDs at the time): one year of daily history, daily sums equal
  range totals, `volUpdateTime` available, key has no IP allowlist and expires
  2026-12-26 (design "Verified API behavior").
- **Raw landing (Task 33 implemented):** manual LOAD and API day loads write
  partitioned raw rows before asynchronous TRANSFORM. Railway schema-isolated
  integration verifies replacement by slice, stale-transform fencing,
  re-transform after an alias, the default partition, retention and no wallet
  effects. Web and worker were deployed to Railway on 2026-09-26; authenticated
  multipart upload/publish of synthetic MEXC and zero-value Bybit data passed.

## Task Dependency Graph

The Mermaid diagram shows task-to-task dependencies; the JSON block groups tasks into
execution waves (all tasks in a wave can run in parallel once previous waves are done).

```mermaid
flowchart TD
  T1[1 Monorepo scaffold] --> T2[2 DB package]
  T1 --> T3[3 Contracts]
  T1 --> T41[4.1 Local infra]
  T2 --> T41
  T41 --> T42[4.2 Railway skeleton]
  T42 --> T43[4.3 Hosted Postgres SIT smoke]
  T43 --> T44[4.4 Monorepo env loading]
  T43 --> T45[4.5 Seed hardening]
  T2 --> T5[5 Public site]
  T3 --> T5
  T5 --> T6[6 Redirect + click]
  T2 --> T7[7 Auth port + interim auth]
  T7 --> T8[8 Admin content]
  T2 --> T8
  T2 --> T9[9 Worker + job queue]
  T9 --> T10[10 Import upload/parse/preview]
  T8 --> T10
  T10 --> T11[11 Commit publish - versioned]
  T11 --> T111[11.1 MEXC commission gate]
  T11 --> T22[22 Re-key to UidAccount]
  T22 --> T13[13 Attribution + cashback]
  T13 --> T14[14 Wallet + hold release]
  T22 --> T23[23 Cashback lookup by exchange+UID]
  T14 --> T23
  T14 --> T25[25 Admin legacy payment queue]
  T25 --> T26[26 Cherry-pick UI from reference project]
  T6 --> T16[16 Admin analytics/dashboard]
  T11 --> T16
  T25 --> T16
  T8 --> T17[17 Security hardening]
  T25 --> T17
  T13 --> T18[18 Test overview]
  T25 --> T18
  T43 --> T19[19 Prod hardening/observability]
  T17 --> T19
  T18 --> T19
  T11 --> T20[20 Adapter framework + Bybit scheduled activity sync - planned]
  T20 --> T32[32 Admin ingest/reports IA]
  T32 --> T33[33 Raw landing layer]
  T16 --> T20
  T16 --> T21[21 Optional SSE - deferred]
  T5 --> T40[40 Dark Aurora public UI - planned]
  T23 --> T40
  T25 --> T40
  T20 --> TAdminPause[41 Per-exchange admin pause]
  T32 --> TAdminPause
```

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "3"] },
    { "wave": 3, "tasks": ["4.1", "5", "7", "9"] },
    { "wave": 4, "tasks": ["4.2", "6", "8"] },
    { "wave": 5, "tasks": ["4.3", "10"] },
    { "wave": 6, "tasks": ["4.4", "4.5", "11"] },
    { "wave": 7, "tasks": ["22", "11.1"] },
    { "wave": 8, "tasks": ["13"] },
    { "wave": 9, "tasks": ["14"] },
    { "wave": 10, "tasks": ["23"] },
    { "wave": 11, "tasks": ["24"] },
    { "wave": 12, "tasks": ["25"] },
    { "wave": 13, "tasks": ["26", "16", "17", "18"] },
    { "wave": 14, "tasks": ["19"] },
    { "wave": 15, "tasks": ["20"], "planned": true },
    { "wave": 16, "tasks": ["32"] },
    { "wave": 17, "tasks": ["33"] },
    { "wave": 18, "tasks": ["21"], "deferred": true }
  ],
  "workstreams": [
    {
      "name": "Dark Aurora public UI",
      "tasks": ["40"],
      "dependsOn": ["5", "23", "25"],
      "pendingDecisions": {}
    },
    {
      "name": "Per-exchange admin pause",
      "tasks": ["41"],
      "dependsOn": ["20", "32"],
      "pendingDecisions": {}
    }
  ]
}
```

## Tasks

### Phase 0 — Foundation & smoke (seed data, no real affiliate data)

- [x] 1. Scaffold the monorepo
  - [x] 1.1 Initialize pnpm workspace + Turborepo with `apps/web`, `apps/worker`, `packages/contracts`, `packages/core`, `packages/db`; configure `build`, `lint`, `typecheck`, `test`, `dev`, `db:migrate` pipelines and shared tsconfig/eslint.
    - _Requirements: technical constraints §4; Design: Architecture/Repository layout_
  - [x] 1.2 Add import-boundary enforcement (e.g. `eslint-plugin-import-x`/`boundaries` rules): browser/client code may import only `contracts`; `web`/`worker` may import `core`/`db`/`contracts`; `contracts` stays dependency-free.
    - ESLint now detects `"use client"` modules anywhere under `apps/web/src` and rejects `core`/`db` imports; package rules keep `contracts` independent and prevent `db` from depending on upper layers. A negative probe confirmed the client rule fails lint.
    - _Requirements: technical constraints §4; Design: Architecture/Repository layout_

- [x] 2. Set up the database package
  - [x] 2.1 Add Prisma to `packages/db` with the schema from the design (content, click, admin auth, import/staging, versioned commission, wallet/ledger, withdrawal + events, job, UID account và model lịch sử (phần xác thực khách superseded bởi Task 44.3)).
    - Money as `Decimal`, UID as `String`, timestamps UTC. Unique: `CommissionRecord(exchangeId,dedupKey)`, `CommissionVersion(commissionId,batchId)`, `WalletEntry.opKey`, `Session.tokenHash`, `UidAccount(exchangeId,uid)`.
    - _Requirements: 5.3, 6.7, 6.9, 7.4, 7.6, 7.8, 8.1, 8.7, 9.8; Design: Data Models, Auth_
  - [x] 2.2 Generate the initial migration (raw SQL for partial indexes) and repository/query helpers.
    - _Requirements: 6.5; Design: Data Models_
  - [x] 2.3 Add a seed script (sample exchanges with default rates, offers, links bound to offers, guides, one admin) for the smoke phase.
    - Offers/links use optional unique seed keys so admin-created rows remain unconstrained; the seed adopts the original legacy rows, upserts three published guides, and is idempotent.
    - _Requirements: 1.1; Design: Testing Strategy_

- [x] 3. Define shared contracts
  - Add zod schemas + types in `packages/contracts` for public content, click, auth, wallet (incl. reserved), lookup và admin payout/legacy withdrawal, and admin import/analytics/sync payloads.
  - Define the error envelope `{ error: { code, message, details? } }` and a decimal-string money type with `asset`.
  - _Requirements: 3.3, 7.4, 8.1; Design: Components/API contracts_

- [x] 4. Local/SIT infra + Railway skeleton (dual-track from day one)
  - [x] 4.1 Add `infra/docker-compose.yml` for Postgres and private object storage (e.g. MinIO or local dir) and `.env.example` with `DATABASE_URL`, `APP_URL`, `IMPORT_STORAGE_*`, `WORKER_POLL_SECONDS`, `HOLDING_PERIOD_HOURS`, `WITHDRAWAL_AUTO_APPROVE_THRESHOLD`, `JOB_LEASE_SECONDS`, `SYNC_INTERVAL_MINUTES` (legacy disabled placeholder; Task 20 replaces it with DB schedules).
    - _Requirements: 6.5; Design: Environments & deployment_
  - [x] 4.2 Stand up the Railway skeleton in parallel: web + worker services + managed Postgres, build pipeline, run migrations, and a health check on each service. Keep both local and Railway green.
    - Config + `/api/health` are in place. The verified application smoke was a local web process using Railway test Postgres; deploying the web/worker processes on Railway remains part of production hardening rather than this smoke result.
    - _Requirements: 6.5; Design: Environments & deployment_
  - [x] 4.3 Stand up SIT against a hosted Railway test Postgres and verify it end to end. (Superseded 2026-09-27: SIT and all tests run on the Docker stack that mirrors Railway, `infra/docker-compose.yml`.)
    - SIT uses a dedicated Railway **test** Postgres over its public proxy (no local Docker); `web`/`worker` run on the host via `pnpm dev`. `infra/docker-compose.yml` is legacy: its Postgres service must not be used (`.claude/rules/production-safety.md`).
    - Verified live: `migrate deploy`, seed, `/api/health`, `/api/exchanges`, public pages 200, `/go/:linkId` 302 + real `ClickEvent`, unknown link falls back to `/exchanges` (no open redirect). No mocks.
    - _Requirements: 1.1, 2.1, 3.1, 6.5; Design: Environments & deployment, Testing Strategy_
  - [x] 4.4 Add a monorepo-wide env-loading story: dev scripts for `web`/`worker`/`db` should read a single root `.env` (e.g. via `dotenv-cli` / `node --env-file=../../.env`) instead of requiring vars to be exported manually per shell session.
    - `scripts/with-root-env.mjs` loads the optional root `.env` without overriding Railway/process variables and wraps web dev/build/start, worker dev/start, and Prisma migrate/generate/seed commands. Verified on Windows through generate, migrate, seed, and production build.
    - _Requirements: 6.5; Design: Environments & deployment_
  - [x] 4.5 Harden the seed script: `upsert` for `offer`/`referralLink` (idempotent re-run), add seed `guide` rows, and replace `main().finally()` with explicit error logging + exit code so failures aren't silent.
    - Migration `202609150002_seed_keys` was applied to Railway test Postgres. Two consecutive seed runs both produced 3 exchanges, 3 seed offers, 3 seed links, and 3 guides.
    - _Requirements: 1.1; Design: Testing Strategy_

- [x] 5. Public site (SSR) with seed content
  - [x] 5.1 Implement `contentService` read methods in `core` and `GET /api/exchanges`.
    - _Requirements: 1.1, 1.2, 1.5; Design: Components/apps/web, core services_
  - [x] 5.2 Build public pages: home, `/exchanges`, `/exchanges/[slug]`, `/guides`, `/guides/[slug]`; render published content server-side; hide unpublished.
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 5.3 Content-level i18n: localized fields resolved per locale with default-locale (`en`) fallback in `contentService`, and a `locale` parameter on public reads.
    - _Requirements: 4.4; Design: Components/i18n_
  - [x] 5.4 UI-level i18n scaffolding: extract hardcoded public UI strings into typed message catalogs under `apps/web/src/i18n`, wire a locale provider, and add locale-aware routing (default locale unprefixed, non-default enabled locales under `app/[locale]/...`) so enabling a locale needs no route restructuring.
    - Added the typed catalog type (`Messages`, checked against the default catalog), locale-aware shared SSR page components, request locale propagation to `<html lang>`/provider/navigation, and the `app/[locale]/...` route group reusing the same page components. Live smoke confirmed `lang`, localized DB fields, and locale-prefixed links resolve from the registry.
    - _Requirements: 4.1, 4.2, 4.3; Design: Components/Language & i18n_
  - [x] 5.5 English-only enforcement: made `apps/web/src/i18n/index.ts` the single locale registry (`defaultLocale`, `locales`, `prefixedLocales`, `isLocale`, `isPrefixedLocale`, `localeFromPathname`) holding `en` alone; deleted the Vietnamese catalog; `middleware.ts` derives the request locale via `localeFromPathname` (no hard-coded locale code); the `app/[locale]/...` group now 404s via `isPrefixedLocale` for any segment that isn't a non-default enabled locale (currently none, so the group is inert but ready); dropped Vietnamese seed content from `packages/db/prisma/seed.ts`; reduced admin content forms to English-only fields.
    - Verified: web build (compile/typecheck/lint) passes; 13/13 routes, none under `/vi*`.
    - _Requirements: 4.1, 4.3, 4.5, 10.5; Design: Components/Language & i18n_
  - [x] 5.6 Exchange logo images on offer tiles (local repo assets, no external URLs)
    - Nullable `Exchange.logoUrl` (migration `202609160001_exchange_logo_url`) mapped in `contentService`; public schema accepts only `/exchange-logos/<slug>.png` or null; admin schemas exclude it. PNG wordmarks in `apps/web/public/exchange-logos/` (provenance in `apps/web/docs/exchange-logos.md`); `OfferCard` renders `next/image` with `alt=""`, falling back to the gradient + name; seed sets `logoUrl` in both upsert halves.
    - Verified locally 2026-09-16: build/lint pass, PNGs decode, fixture smoke for logo and null fallback. Railway migrate + re-seed + live check still pending.
    - _Requirements: 1.1, 1.2, 1.5, 10.2; Design: Data Models, Components/apps/web (Exchange logo assets)_

- [x] 6. Referral redirect + reliable click tracking
  - Implement `clickService.recordClick` and `GET /go/[linkId]`: resolve active link, return 302, and record the click via a reliable best-effort mechanism (Next.js `after()`/`waitUntil` post-response task, or a short-timeout awaited insert) — not an unawaited/dropped promise. Recording failure still redirects; never wait on sync; unknown/inactive → safe fallback, no open redirect.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5; Design: Key flows, Components/apps/web_

- [x] 7. Auth port + interim auth
  - [x] 7.1 Define `AuthPort` in `core` (`getSession`, `requireAdmin`). Khách không có principal đăng nhập theo quyết định 30/10; gỡ phần xác thực khách tại Task 44.3.
    - _Requirements: 3.2, 3.3, 3.4; Design: Components/Auth_
  - [x] 7.2 Implement the interim admin auth provider behind the port (email+password with hashed `passwordHash`, admin-only `Session` table of hashed tokens + expiry); server-side authz on all guarded routes. Replaceable if a managed provider (Open decision #13) is chosen.
    - _Requirements: 3.1, 3.5; Design: Components/Auth_

- [x] 8. Admin content management
  - [x] 8.1 Guard the admin area: admin-only session check on `/admin` routes, denying non-admin principals.
    - _Requirements: 10.1; Design: Components/apps/web, Security_
  - [x] 8.2 Add `contentService` write/publish methods in `core`: create/update/publish/unpublish for exchanges (incl. `defaultCashbackRate`), offers (`cashbackRate`), referral links (bind `offerId`, assert same `exchangeId`), and guides; write localized fields into the `i18n` payload.
    - Core write methods keep `seedKey` outside admin inputs, translate missing/unique conflicts into domain errors, validate link↔offer ownership on link writes, and prevent moving an offer while links from another exchange remain attached.
    - _Requirements: 10.2, 10.4, 10.5; Design: core services, Cashback engine (rate source)_
  - [x] 8.3 Add admin write API routes (`/api/admin/exchanges`, `/api/admin/offers`, `/api/admin/links`, `/api/admin/guides`) validating with `contracts` zod schemas, enforcing `requireAdmin`, and returning `Cache-Control: private, no-store`.
    - Added typed localized payload schemas and `rateSchema` (0–1, max 4 decimal places), shared admin error mapping, and authenticated GET/POST/PATCH handlers. Live checks confirmed unauthenticated 401, invalid rate 400, cross-exchange offer binding 409, and private/no-store headers.
    - _Requirements: 10.1, 10.2; Design: Components/API contracts_
  - [x] 8.4 Build the admin UI forms for exchanges/offers/links/guides replacing the placeholder dashboard, and confirm an edit is visible on the next public read.
    - The guarded admin page now renders client-side create/edit/status forms that call only `/api/admin/*`. A live exchange edit appeared on the next public read; switching it to DRAFT hid it immediately; the original seed data was restored afterward.
    - _Requirements: 10.2, 10.3; Design: Components/apps/web_
  - [x] 8.5 Fix review defects of 8.2–8.4: map Prisma `P2003` to 400; make the link↔offer same-exchange invariant structural (migration `202609150003_offer_link_exchange_invariant`, composite FK `(offerId, exchangeId) → Offer(id, exchangeId)`); per-entity cursor-paginated admin reads; 401 vs 403; one empty option in optional exchange selects.
    - Verified on Railway test Postgres: mismatched direct write blocked (P2003), invalid FK API 400, non-admin session 403, distinct cursor pages.
    - _Requirements: 7.3, 10.2; Design: core services, Components/API contracts, Correctness Properties 13_

### Phase 1 — Import pipeline, UID linking, attribution

- [x] 9. Worker runtime + Postgres job queue (foundation landed early in Phase 0)
  - [x] 9.1 Build the worker boot + poll loop claiming jobs with the correct PostgreSQL clause order (`... ORDER BY "runAfter" LIMIT 1 FOR UPDATE SKIP LOCKED`), lease, and heartbeat.
    - _Requirements: 12.1, 12.2; Design: Job queue design_
  - [x] 9.2 Add lease reaper (requeue expired) and retry policy (transient→backoff capped; exhausted attempts→FAILED, no infinite retry).
    - _Requirements: 12.3, 12.5; Design: Job queue design, Error Handling_
  - [x] 9.3 Enforce lease ownership at commit time: before writing a job's results, re-verify this worker still holds the lease (and fail the commit if it was reclaimed), plus add jitter to the retry backoff.
    - Implemented per-claim `lockedBy` tokens, guarded heartbeat/failure writes, and atomic business-result + DONE commits fenced with `clock_timestamp()`. Expired/reclaimed owners roll back; retries include jitter; exhausted leases fail. Worker ticks no longer overlap. Verified against isolated PostgreSQL.
    - _Requirements: 12.3, 12.5; Design: Job queue design, Correctness Properties 8_

- [ ] 10. Report import: upload → parse → preview
  - [x] 10.1 Implement `POST /api/admin/imports`: authz, file type/size check, store original in private storage, create `ImportBatch` + PARSE job, return 202 + batchId (no in-request parsing).
    - Bybit MVP accepts normalized CSV v1 (bounded by `IMPORT_MAX_BYTES` and 10 MiB), stores the original privately as database bytes, and creates the batch/job atomically. This replaces container-local storage for new uploads so separate Railway web/worker services share durable input. Unsupported exchange/XLSX uploads return a clear validation error.
    - _Requirements: 6.1, 6.2; Design: Key flows/import_
  - [ ] 10.2 Implement `parserRegistry` + a first CSV/XLSX adapter interface distinguishing TRANSACTION vs AGGREGATE reports; no formula/macro execution; fall back to aggregate when transaction identity keys are missing.
    - Done: Bybit normalized CSV v1 (transaction/aggregate identity, opaque UID, decimal parsing, no formula execution) and the MEXC Referral Data XLSX activity adapter (Task 10.6). Pending: native Bybit export mapping, which still needs a real commission sample. See `apps/web/docs/bybit-cashback.md`.
    - _Requirements: 6.4, 6.10, 6.11; Design: Components/core services_
  - [x] 10.3 Implement PARSE job: normalize (UID string, UTC timestamps + source tz, decimals), flag error/duplicate/unmapped/conflict rows into `StagingRow`, compute totals, set batch to PREVIEW.
    - Implemented for Bybit CSV v1 / UTC: invalid/duplicate/conflicting rows block publish; per-currency totals and unmapped-UID counts appear in preview. Unknown headers or malformed files produce FAILED with an actionable error.
    - _Requirements: 6.3; Design: Key flows/import_
  - [x] 10.4 Implement `GET /api/admin/imports/:id` returning status, preview counts, error rows, reconciliation info.
    - Admin-only endpoint returns batch lifecycle/source fields, totals, total/flagged row counts, and up to 100 flagged preview rows under private/no-store caching. Live probe returned 200 for the newly uploaded `UPLOADED` batch with zero rows before parsing.
    - _Requirements: 6.6; Design: Components/API contracts_
  - [x] 10.5 Generalize the import envelope: add dataset kind (`REFERRAL_ACTIVITY`/`COMMISSION`), source method (`NATIVE_FILE`/`NORMALIZED_FILE`/future `OFFICIAL_API`) and a versioned `ReferralSnapshot` store (`sourceAsOf` already exists on `ImportBatch`). Migration backfills existing batches as `COMMISSION`/`NORMALIZED_FILE` before making the columns required, makes `reportType` nullable, and adds the `current = true` partial unique index in raw SQL. `importMetadataSchema` becomes a union on dataset kind (`reportType` required for commission, `sourceAsOf` for activity). Move the Bybit/CSV/UTC guards from `createImportBatch` into the resolved adapter. Parse/publish dispatch by dataset kind; activity publish uses an advisory lock keyed on (exchange, root, period) instead of `lockCashback` and never enqueues ATTRIBUTE. Bybit CSV wallet results stay unchanged (regression check against the happy-path batch).
    - Migration `202609250001_ingest_envelope` backfills existing batches as `COMMISSION` / `NORMALIZED_FILE`, makes `reportType` nullable, and adds the current-snapshot partial unique index. Activity publish does not take the cashback lock and does not enqueue ATTRIBUTE. **Verified 2026-09-25:** the Bybit integration on an isolated schema still credits, corrects, releases holds and withdraws as before.
    - _Requirements: 6.1, 6.7, 6.12–6.16; Design: Key flows/import, Data Models_
  - [x] 10.6 Add the native MEXC Referral Data XLSX adapter. Validate locally against the ignored file `data/mexc/Referral Data Export-2026-09-25 14_22_39.xlsx`; commit only a synthetic fixture with fake UIDs and referral code. Pick a maintained XLSX reader that does not evaluate formulas (not the npm `xlsx` package); bound decompressed size and row/column counts; accept `.xlsx` with one worksheet only. Match required headers by name, report extra columns as warnings, parse inline-string numbers strictly into Decimal, preserve UID text, reject formulas/duplicate UIDs/invalid units, require `sourceTz` and `sourceAsOf`, convert the inclusive sheet period in `sourceTz` to UTC and cross-check it with metadata, and flag `partial` when `sourceAsOf < periodEnd`. Copy only mapped columns into staging (no nickname/user tag/identification/asset band). The local sample should preview 46 valid zero rows, flagged partial.
    - Synthetic-fixture tests (not blocked on new data): leading-zero UID, extra column, missing required header, duplicate UID, formula cell, period mismatch, same-period re-import supersedes, older export rejected (`OLDER_REPORT`), UID absent from the new version shows no data, overlapping periods not summed, zero vs absent, and wallet/CommissionRecord tables unchanged after activity publish.
    - **Verified 2026-09-25:** parser tests including the gitignored 46-row zero sample (partial, no personal columns in staging). Isolated-schema integration passed supersede, `OLDER_REPORT`, absent UID, overlap, zero-vs-absent, and unchanged commission/wallet tables.
    - _Requirements: 6.3–6.6, 6.12–6.14, 6.16; Design: MEXC native referral adapter, Referral activity publish_
  - [x] 10.7 Add an admin-only paginated `GET /api/admin/referral-snapshots` and a compact report view filtered by exchange and exact period (current version only). Include zero-valued UIDs, units, source as-of and the partial flag; do not expose raw rows or personal columns or treat reported earnings as wallet credit.
    - The native workbook is uploaded on `/admin/ingest/uploads` and the current snapshot is read on `/admin/reports/activity` (moved by Task 32; first shipped as `/admin/crawl-data`). Columns are labeled reported volume and reported earnings. The response note states they are not cashback wallet credit.
    - _Requirements: 6.13; Design: Components/API contracts, Referral activity publish_
  - [ ] 10.8 Data gate: with a second MEXC export containing nonzero activity and a confirmed timezone, check that volume/earnings are period values (compare against the MEXC portal for a few UIDs) before labeling them period totals in the UI.
    - _Requirements: 6.12–6.14; Design: MEXC native referral adapter_
  - [ ] 10.9 (Deferred) Normalized CSV activity fallback with the same validations as 10.6, recording the native evidence privately. Start only when an exchange has no usable native export; MEXC does not need it.
    - _Requirements: 6.1, 6.12–6.15; Design: Ingest choices_

- [x] 11. Report commit: versioned publish (idempotent + atomic)
  - Implement `POST /api/admin/imports/:id/commit` (creates PUBLISH job) and the PUBLISH job in `commissionService`: per row, upsert the `CommissionRecord` identity by `(exchangeId, dedupKey)`, upsert a `CommissionVersion` keyed by the unique `(commissionId, batchId)`, mark prior version superseded, set `activeVersion`, and recompute `reconciledAmount` (default rule: latest version supersedes). Commit the whole batch atomically, then enqueue ATTRIBUTE.
  - Re-committing the same batch, or two publish workers racing the same batch, upserts the same version and changes no reconciled amount; a mid-failure leaves no partial published data.
  - _Requirements: 6.7, 6.8, 6.9, 7.5, 7.8; Design: Key flows/import, Data Models, Correctness Properties 1, 7, 9_
  - Bybit normalized v1 dedup keys are defined in `bybit-parser.ts` (root + transaction ID + asset, or root + UID + asset + exact UTC period). Partial overlaps and older reports are rejected; corrections use the original identity. Native export identity mapping still needs a real sample.

- [ ] 11.1 MEXC commission source gate: inspect a nonzero UID-level commission export for period, settlement status, units and stable identity; then map either its native format or an admin-prepared normalized CSV to the existing CommissionRecord/CommissionVersion path. Reconcile preview totals with the MEXC commission view before allowing wallet attribution. Do not convert Referral Data `Your Earnings` snapshots into payable commission or add activity and commission totals together.
  - _Requirements: 6.11, 6.15, 7.5, 7.8; Design: Ingest choices, Versioned commission publish_

- [x] 13. Attribution + cashback engine (rate resolution + delta, concurrency-safe)
  - Implement `attributionService` + `cashbackEngine`: serialize publish/attribution/ledger writes with a transaction-scoped Postgres advisory lock for the low-volume MVP; resolve the rate by precedence (offer of the reported referral link **only when corroborated by system-verified report data**, else exchange default), assert `ReferralLink.exchangeId = Offer.exchangeId = commission.exchangeId` (else fall back to default), and snapshot `offerId`/`cashbackRate` onto the record; compute `target = reconciledAmount × rate` and apply only `delta = target − creditedCashback` — positive delta offsets any `receivable` then CREDITs `pending` (with `availableAt`), negative delta reduces `pending` then `available` then records the remainder as `receivable` via CLAWBACK. Write every wallet movement with a unique `opKey` (e.g. `attr:{commissionVersionId}`) so retries/racing workers cannot double-apply; update `creditedCashback`.
  - Attribution upserts the `UidAccount` by `(exchangeId, uid)` unconditionally, so cashback accrues with no claimant action, email or session (Req 5.3, 5.5; Property 4).
  - _Requirements: 5.3, 7.1, 7.2, 7.3, 7.4, 7.7, 7.8, 8.2, 8.4, 8.7; Design: Key flows/UID accounts, Key flows/attribution, Cashback engine, Correctness Properties 2, 3, 4, 11, 12, 13_

- [x] 22. Re-key identity to `UidAccount` (UID-first migration)
  - Thêm UidAccount unique theo sàn + UID và RateLimitCounter; Wallet/commission/lịch sử chi thuộc UID. Các model xác thực khách từng thêm ở đây bị gỡ tại Task 44.3.

  - **Verified:** migration on an empty schema and a populated fixture preserved balances,
    pending lots, audit and admin session; integration passes credit/release idempotency,
    rate snapshots, corrections/receivable offset, overlap rejection, atomic rollback and
    lease fencing. Build, lint and parser tests pass.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6; Design: Key flows/UID accounts, Data Models (`UidAccount`), Correctness Properties 3, 4_

### Phase 2 — Lookup, sổ ví nội bộ và chi tự động

- [x] 14. Wallet balances + hold release
  - [x] 14.1 Implement `walletService` and `GET /api/uid/wallet` (session-scoped `UidAccount`, Task 24) returning balances, typed movement history, last sync/import time, source as-of; distinguish "no data" from zero.
    - _Requirements: 8.1, 8.5, 8.6; Design: Cashback engine, Data Models_
  - [x] 14.2 Implement `RELEASE_HOLDS` job (scheduler tick) moving cleared CREDITs `pending→available`; implement the reversal policy (reduce `pending` then `available`, remainder to `receivable` via CLAWBACK) so no balance goes negative, and expose `receivable` in the wallet.
    - _Requirements: 8.3, 8.4, 8.7; Design: Key flows/attribution, Cashback engine, Correctness Properties 5, 12_
  - Verification: parser/money unit tests and isolated PostgreSQL integration cover idempotent import/credit/release, frozen rates, corrections/receivable offset, overlap rejection and expired-owner rollback.

- [x] 23. Cashback lookup by exchange + UID (Requirement 14)
  - `lookupService` consumes the per-IP budget (`RateLimitCounter`, `lookup:ip`) first, then
    reads the `UidAccount` wallets for `(exchangeId, uid)`; read-only, never creates an
    account, wallet or session. Missing `exchangeId` or `uid` → 400 before any query.
  - `POST /api/lookup` returns `pending`/`available` per asset, `hasData` and freshness
    only — no email, address, withdrawals, history, `reserved`/`withdrawn`/`receivable`;
    over budget → 429 + `Retry-After`; `Cache-Control: private, no-store`. Home-page form
    above the offer grid, copy in `en.ts`.
  - **Verified:** isolated HTTP test for the strict response, private cache, early 400,
    429, no writes, zero vs no data, home placement. Production needs a trusted-ingress IP header.
  - **Superseded phần hiển thị/ngày/zero bởi Task 43/44.2:** bằng chứng dưới đây là kiểm tra bản cũ, không phải target 30/10.
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6; Design: Key flows/Cashback lookup by exchange + UID, core services (`lookupService`), Data Models (`RateLimitCounter`), Correctness Properties 14, 15_

- [ ] 24. (removed/superseded 2026-10-30 — Req 15/16 đã removed)
  - Không còn triển khai/bảo trì luồng xác thực khách. Phần từng làm không đáp ứng target mới; gỡ phụ thuộc tại Task 44.3.

- [x] 25. Withdrawal flow (legacy runtime: reserved balance + mandatory first-review + cancel + event audit; target replacement at Task 42/Req 22.32)
  - **Verified:** service, routes, UI and isolated PostgreSQL integration (25.9).
  - [x] 25.1 `withdrawalService` in `packages/core/src/services/withdrawals.ts`: `requestWithdrawal`
    (amounts/receivable/address validation, `isFirst` detection, auto-approve vs UNDER_REVIEW,
    `WITHDRAWAL_RESERVE` wallet entry, two `WithdrawalEvent` rows), `cancelWithdrawal`,
    `decideWithdrawal` (APPROVE/REJECT/MARK_PAID with `payoutRef` guard), `listWithdrawals`
    (cursor-paginated, both claimant and admin views), `validPayoutAddress` (EVM + TRON checksum),
    `payoutRoutes` + `threshold` from env vars.
  - [x] 25.2 `withdrawalCreateSchema`, `withdrawalDecisionSchema`, `payoutRoutesSchema`,
    `withdrawalSchema`, `withdrawalsResponseSchema`, `PayoutRoutes` in `packages/contracts`.
  - [x] 25.3 API routes — `GET`+`POST /api/uid/withdrawals`, `POST /api/uid/withdrawals/[id]/cancel`,
    `GET /api/admin/withdrawals`, `POST /api/admin/withdrawals/[id]/decision` — all wired with correct
    session guards (`uidPrincipal` / `withAdmin`) and same-origin checks.
  - [ ] 25.4 (removed/superseded 2026-10-30) — gỡ customer withdrawal UI tại Task 44.3; `/withdraw` chỉ redirect `/#lookup`.
  - [x] 25.5 `WithdrawalQueue` admin component + `POST /api/admin/withdrawals/[id]/decision`:
    decision form with note/payoutRef inputs, per-withdrawal action buttons filtered by current status,
    `window.confirm()` guard, cursor pagination.
  - [x] 25.6 i18n strings for all new copy in `apps/web/src/i18n/messages/en.ts`; no inline strings in the components.
  - [ ] 25.7 (superseded một phần 2026-10-30) — giữ WithdrawalQueue admin cho lịch sử legacy; gỡ WithdrawalFlow khách tại Task 44.3.
  - [x] 25.8 Document `WITHDRAWAL_ROUTES` and `WITHDRAWAL_AUTO_APPROVE_THRESHOLDS` (JSON) in `.env.example`.
  - [x] 25.9 Integration coverage in `scripts/test-bybit-integration.mjs` (verified 2026-09-17,
    isolated `cashback_test_*` schema): first withdrawal `UNDER_REVIEW`, second auto-approves,
    concurrent requests cannot both reserve, cancel after `PAID` rejected, receivable blocks,
    every transition has a `WithdrawalEvent`.
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11; Design: Key flows/withdrawal, Data Models, Correctness Properties 6, 10, 12_

- [x] 26. Cherry-pick UI components from the reference project (`cashback/`)
  - Copied component files only from the gitignored `satnaing/shadcn-admin` copy (MIT):
    `data-table/*` (withdrawal queue and
    import-batch list), `confirm-dialog` (approve/reject/mark-paid), and only the `ui/*`
    primitives those import. Not copied: TanStack Router, Clerk, Vite config, or any
    `src/features/*` handler (stubs with no backend).
  - **Verified 2026-09-17:** web lint, typecheck and production build pass.
  - _Requirements: none directly (tooling/UX only); Design: Components/apps/web_

- [x] 27. Home Online Rebate Ledger ticker (interim fake 100 large credits)
  - Keep `apps/web/src/content/ledger-demo.ts` as the only source for the home
    ticker. Generate **exactly 100** deterministic rows (not live `WalletEntry`).
    Amounts must look large: most ~480–2,600 USDT, ~every 11th row a headline
    ~3,200–8,500 USDT. Rotate Binance/MEXC/Bybit, mask UIDs, spread dates over
    ~30 days. Keep the illustrative badge.
  - Animate the 100 rows as a CSS vertical marquee (duplicate the table for a
    seamless loop, pause on hover/focus, `prefers-reduced-motion` = static
    scrollable table). No SSE, no new public API, no DB read for this block.
  - Copy stays English (`home.ledger*`). Lead must not claim the ticker is the
    visitor's own wallet.
  - **Verified 2026-09-17:** 100 masked rows, 40s loop, pause on hover/focus, static under
    reduced motion; web `tsc` pass.
  - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6; Design: Components/apps/web
    (Online Rebate Ledger)_

- [x] 28. Bảng cashback public theo kỳ (Requirement 14.2, 14.7)
  - Schema/UI ban đầu đã có kiểm chứng 2026-09-17; phạm vi hiển thị thay bằng Task 43: chỉ kỳ/tài sản/UID/cashback, không commission/rate/volume/bucket ví. Giữ cap 100/hasMore và cashback đã attribution. Tổng ngày/30 ngày và tổng đã trả nằm riêng, theo Req 14 cập nhật.
  - _Requirements: 14.2, 14.3, 14.7, 8.5, 8.6; Design: Key flows/Cashback lookup_

- [x] 16. Admin analytics & operations dashboard
  - Implement `GET /api/admin/analytics` (click metrics by link/exchange/time from internal data), `GET /api/admin/accounts/:id/activity` (paginated, per UID/account), and `GET /api/admin/sync-status`; 30s polling when tab visible, 5s while a batch processes; admin/private responses set `Cache-Control: private, no-store`; no secrets/raw reports leaked; views for attributed vs unattributed commission and the withdrawal queue.
  - **Verified 2026-09-17:** endpoints use the admin guard + private responses; polling
    30s visible / 5s during import; integration covers analytics, sync-status raw-report
    exclusion and paginated UID activity.
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6; Design: Components/apps/web, API contracts_

### Phase 3 — Hardening

- [x] 17. Security hardening (bằng chứng bản cũ; phần customer access superseded bởi 44.3)
  - Target 30/10: authorization admin phía server cho mọi API non-public; secrets chỉ env/secret store, không public-prefixed; bucket private giới hạn web/worker; Postgres chỉ backend/worker. Khách chỉ lookup; không API ví/lịch sử riêng tư. POST rút retired không mutation.
  - Bằng chứng 17/09 về admin guard, private bucket và secret isolation là lịch sử, không chứng minh API khách đã gỡ. Kiểm lại tại 44.4; docs/security-audit.md ngoài phạm vi sửa Bước 1.
  - _Requirements: 3.3, 6.2, 14, 20.4, 22.35; Design: Security_

- [ ] 18. Lightweight test overview + critical invariant checks
  - Keep testing light: a thin smoke check that the app boots and key paths respond (public browse → get link → redirect records a click; admin login; seed import runs).
  - Add a few sanity checks on money logic (cashback amount, idempotent publish, only `available` is withdrawable) plus targeted integration/concurrency checks: two publish runs racing to attribute the same (exchange, UID) → exactly one `UidAccount` (Property 3); ATTRIBUTE re-run applies no extra credit; publish failing mid-transaction leaves nothing; worker that lost its lease cannot commit; hai execution đồng thời không được giữ chỗ cùng phần tiền; first and later payments apply the same <=20 USD threshold and all readiness/schedule gates (Req 22.32). No exhaustive suite.
  - Rollback-on-mid-publish-failure is covered and previously passed. Added a
    concurrent-attribution-race check (two `ATTRIBUTE` workers racing the same published
    UID) asserting exactly one `UidAccount` and exactly one wallet credit in
    `scripts/test-bybit-integration.mjs`.
  - **Re-run 2026-09-17** against the Railway pre-golive DB (`TEST_DATABASE_URL` = the
    `DATABASE_URL` proxy `trolley.proxy.rlwy.net`), in a throwaway `cashback_test_*` schema
    that the script migrates and drops. **All required invariants passed:** migrations
    applied; UID-first credit without claimant; **concurrent attribution → exactly one
    `UidAccount` + exactly one wallet credit** (Property 3); corrections + rate-snapshot +
    hold-release idempotency + receivable offset; atomic publish rollback + failed-batch
    status; and the full withdrawal suite (first withdrawal always `UNDER_REVIEW`,
    approve+mark-paid audit trail, second auto-approves below threshold, cancel releases
    reserved with event, cancel-after-PAID rejected, receivable blocks withdrawal, two
    concurrent requests cannot both reserve → no double-spend), plus the lost-lease
    rollback / reap+reclaim fencing checks that precede them.
  - **Known environment limit (not a logic failure):** the script's trailing Task-16
    admin-dashboard read `getAdminAnalytics` fires a 5-way `Promise.all`, and from a local
    machine over the Railway **public** TCP proxy the 5th concurrent connection is refused
    (`P1001` "can't reach database server"); every serial query and the concurrency checks
    (≤4 simultaneous connections) succeed, and connectivity is otherwise healthy. On
    Railway the `db` client uses internal networking with no such cap, so this affects only
    local-through-proxy runs. Because that `P1001` aborts before the script's `finally`
    DROP completes, one `cashback_test_*` schema was left behind; it was dropped afterwards
    and a follow-up scan confirmed 0 `cashback_test_*` schemas remain on the Railway server.
  - _Requirements: 5.1, 6.8, 6.9, 7.8, 9.1, 9.5; Design: Testing Strategy, Correctness Properties 1–15 (16–17 removed)_

- [ ] 19. Production hardening & observability (Railway)
  - Building on the Phase 0 Railway skeleton (Task 4.2): add observability (web health, oldest job age, worker heartbeat, import error rate), alerts, ensure migrations run once per deploy with reproducible builds, and verify DB backup/restore.
  - Implemented and locally verified 2026-09-17: `WorkerHeartbeat` migration
    (`202609170001_worker_heartbeat`) applied by the worker on idle and mid-job ticks;
    `GET /api/health` reports database status, oldest pending-job age, queue counts,
    worker heartbeat freshness, and the 24h import error rate without leaking job
    payloads; structured alerts with optional `OPERATIONS_ALERT_WEBHOOK_URL`; Railway
    `web` runs `pnpm --filter @cashback/db db:migrate` as `preDeploy` and healthchecks
    `/api/health`; watch patterns cover `packages/core`, `packages/db`,
    `packages/contracts`, and the lockfile; runbook in `docs/operations.md`;
    backup/restore drill script at `scripts/verify-postgres-backup.ps1`.
    `pnpm db:generate`/`typecheck`/`lint`/`build` all pass.
  - **Verified 2026-09-17 (pre-golive, against the Railway hosted DB):**
    - `railway config plan --out scripts/_railway-plan.json` (read-only) ran clean against
      project `cashback` / env `production`: **Plan: 0 to add, 3 to change, 1 to destroy** —
      add core/db/contracts/lockfile/workspace `watchPatterns` to `@cashback/worker` and
      `@cashback/web`; set `@cashback/web` `deploy.healthcheckPath=/api/health`,
      `healthcheckTimeout=120`, `preDeployCommand=["pnpm --filter @cashback/db db:migrate"]`;
      and the one destructive change **delete variable `@cashback/web.CLIENT_IP_HEADER`**.
      `railway config apply` was intentionally NOT run — a live deployment-config change
      (and a destructive variable delete) needs explicit user confirmation before applying.
    - Backup/restore drill (`scripts/verify-postgres-backup.ps1` flow, PostgreSQL 18 client
      tools) run against a throwaway `cashback_bkdrill_*` database created on the SAME
      Railway Postgres server (never local, never the real prod DB): `pg_dump` of `railway`
      (44,993-byte custom-format dump) → `pg_restore` into the temp DB → verified **3 applied
      `_prisma_migrations`** and **19 public base tables** (matching the source's 19) →
      `DROP DATABASE` of only the temp target; dump file removed. **DRILL_RESULT=PASS.**
    - Both runs used the Railway `DATABASE_URL` (`trolley.proxy.rlwy.net` public proxy).
      Remaining gate: applying the reviewed `railway config` plan (deploy-config change)
      awaits explicit user confirmation.
  - _Requirements: 6.5; Design: Environments & deployment_

### Phase 4 — Bybit Affiliate API activity sync

- [x] 20. Scheduled API sync by exchange (Bybit first; activity only)
  - Binance supports GET-only raw intake; UID activity publishing stays gated on
    verified customerId mapping and period semantics.
    A schedule row may exist for every exchange but starts disabled. No browser
    cookies, portal scraping, or wallet writes from this API dataset.
  - _Requirements: 6.17–6.19, 13; Design: Scheduled Bybit Affiliate activity sync_

  - [x] 20.0 Refactor ingest into the source adapter framework (prerequisite).
    - Create `packages/core/src/ingest/{base,file,api,exchanges,sinks}`. Abstract
      `SourceAdapter` with a final `ingest()` template (read → fingerprint → drift
      → alias → map → validate → minimize → `NormalizedEnvelope`), then
      `FileSourceAdapter`, `XlsxSourceAdapter`, `CsvSourceAdapter`,
      `ApiSourceAdapter` (sign, page, cursor, `classifyError`, readiness, limiter).
    - Move `mexc-parser.ts` → `MexcReferralXlsxAdapter` and `bybit-parser.ts` →
      `BybitNormalizedCsvAdapter` with declarative `FieldContract` (required,
      aliases, type, unit, `ignored`) and no behavior change; existing MEXC/Bybit
      tests and fixtures must pass unchanged. Then unify Bybit CSV to the MEXC rule
      (unknown column = `ADDITIVE` warning).
    - `ingestRegistry` keyed by (exchange, dataset, method, format, contract
      version) replaces `resolveIngestAdapter`; registration rejects a contract
      whose targets are unknown.
    - Add `schemaFingerprint`, `contractVersion`, `driftReport` to `ImportBatch`
      and the drift classifier (`SAME/ADDITIVE/ALIASED/BREAKING`) with preview
      warnings; re-parse a stored `originalFile` with a newer contract version.
    - Stack decision: TypeScript abstract classes (same pattern as Python ABC); no
      separate Python service.
    - Bybit CSV unknown columns are `ADDITIVE` warnings and are dropped before staging. Required-header failures still reject the file. MEXC and Bybit parser tests still pass.
    - _Requirements: 6.10, 6.16, 6.21; Design: Source adapter framework, Schema drift policy_

  - [x] 20.1 Extend the activity schema for the API write model.
    - Add `ReferralMetric` per snapshot/kind/asset for manual snapshots (enum
      `ActivityMetricKind`, `MetricValueState`), and parent commission-field
      state. Backfill MEXC scalar values; switch all admin readers/exports to
      metrics; remove legacy columns only after the backfill and parity checks.
    - Add `ActivityRoster`, `ActivityPeriodStatus`, `ActivityMetricCurrent`,
      `ActivityMetricChange` (API sink; no per-run `ImportBatch`), plus
      `ExchangeSyncConfig`, `SyncRun`, `ActivityPeriodOverride`,
      `SyncConfigAudit` with enums, SQL interval check and one-active-run index.
    - Create view `referral_activity_v` (manual current snapshots ∪ API current
      metrics, `source` column, override applied, "reported no activity" from
      complete day + roster). Confirm no migration alters commission or wallet.
    - Migration `202609260001_bybit_activity_sync` backfills `ReferralMetric` from existing snapshot columns and adds `referral_activity_v`. Legacy snapshot columns stay until a parity check on the real database.
    - _Requirements: 6.13–6.19, 13.4–13.6, 13.13; Design: Data Models, API write model_

  - [x] 20.2 Implement the Bybit Affiliate connector and complete-period publish.
    - Use worker-only `BYBIT_AFFILIATE_API_KEY/SECRET` with master UID and only
      Affiliate read permission. Readiness via `/v5/user/query-api` on every run:
      `readOnly=1`, Affiliate only, not expired; alert 14 days before `expiredAt`.
      Warn when the key has no IP allowlist (`ips=["*"]`, current key has a 90-day
      expiry), but do not block a valid read-only Affiliate key for that reason.
    - Call `/v5/affiliate/aff-user-list` with explicit `startDate` and `endDate`
      per UTC day (never omitted), `size=100`, and every cursor page; stop on an
      empty list or empty cursor. Apply a shared limiter from `x-bapi-limit*`
      headers (10 req/s observed), bounded retry for transient/10006 failures,
      no retry for `610015`, and pause on auth/permission/IP errors.
      Reject malformed, duplicate UID, repeated cursor, incomplete, or suspiciously
      empty period fetches. Store only UID, `source`, `tradeVol`, `takerVol`,
      `makerVol`, `tradfiTradeVol`, and `commissionsVol` assets (Req 6.20 exclusions).
    - Read `volUpdateTime` from `aff-customer-info` for up to 3 UIDs sampled from
      the fetched roster (constant cost as UIDs grow); null if samples disagree or
      the call fails. Map it to `sourceAsOf` only after its timezone is confirmed.
    - Add a manual readiness probe script: read-only calls, schema and counts
      only on stdout, raw output under gitignored `data/`.
    - Implement `BybitAffiliateApiAdapter extends ApiSourceAdapter` and
      `apiActivitySink`: day digest gate; changed day → rows into an
      `ON COMMIT DROP` temp table, `INSERT … ON CONFLICT … DO UPDATE … WHERE
      (value_state, amount) IS DISTINCT FROM …`, then mark missing rows `ABSENT`;
      append every returned row to `ActivityMetricChange`; store only nonzero new
      metrics; update roster (`GONE` after 3 complete misses). All under the
      (exchange, root, day) advisory lock and lease fence, via `$executeRaw`.
    - `REFERRAL_ACTIVITY` only, never `COMMISSION`/ATTRIBUTE. Drift `BREAKING`
      quarantines the run and pauses the connector; `ADDITIVE`/`ALIASED` warn.
      Prevent volume multiplication by number of assets.
    - Readiness, signing, pagination, drift, and sparse metrics are covered by `packages/core/test/bybit-sync.test.mjs`. `scripts/probe-bybit-affiliate.mjs` is the read-only probe and was not run here.
    - _Requirements: 6.17–6.21, 13.3–13.5, 13.9, 13.12; Design: Adapter boundary, Verified API behavior, API write model, Schema drift policy_

  - [x] 20.3 Implement scheduling, backfill, reconciliation, and failure policy.
    - Worker tick atomically claims due `ExchangeSyncConfig` and enqueues `SYNC`;
      `intervalMinutes` is per exchange, one of 30 (default), 60, 720, 1440.
      Skip missed slots after downtime rather than bursting; use active-run guard,
      per-(exchange, root) lock, lease heartbeat/fencing, and crash recovery.
    - Each run refreshes today and two previous UTC days. Initial enable
      backfills 365 completed days (configurable) as daily jobs; allow older-range
      backfill and show historical coverage. Revisit 30 completed days once daily
      for source corrections; current day is partial, Bybit volume can update at
      T+1 and can arrive after the same day's commission.
    - Record attempt/success/fetched period/observation time distinctly from
      `sourceAsOf`; alert after two consecutive failures or timeout, retain last
      published data, and pause permanent credential/permission/IP errors.
    - The worker claims due `ExchangeSyncConfig` rows, skips missed slots, and enqueues `SYNC`. Backfill jobs are delayed so they do not jump the current queue. Two consecutive failures or a credential/IP error pause the connector.
    - _Requirements: 11.4, 13.1–13.8, 13.11; Design: Schedule and operation, Failure and UI_

  - [x] 20.4 Add admin controls and report presentation.
    - Add the connector page to the shell (now `/admin/ingest/connectors`, Task 32),
      `GET/PATCH /api/admin/ingest/connectors/:exchangeId` and `POST …/run`
      (implemented first as `/admin/sync` and `/api/admin/sync-config/*`, kept as aliases).
      Show connector readiness, interval, enable state, next run, history,
      freshness, safe errors, and a Sync now action. Audit actor/config changes;
      apply edits without worker restart. Manual run is allowed with a disabled
      schedule only when the connector is ready and no run is active.
    - Extend `/api/admin/sync-status` and the activity report (`/admin/reports/activity`, Task 32) for source code,
      volume USDT, reported commission by asset, partial/coverage/fetch times.
      Label `commissionsVol` as reported activity; never label it pending or
      settled. Keep secrets and source payloads out of admin/public responses.
    - The connector page enables or disables a Bybit schedule, chooses 30/60/720/1440 minutes, and can sync now or resume. Responses do not include the key or secret.
    - _Requirements: 6.13, 11.4, 13.1–13.9, 18.2; Design: API contracts, Failure and UI_

  - [ ] 20.5 Verify and stage rollout.
    - Run fixture tests for pagination, multi-asset metrics, empty/zero/absent,
      identical/changed digests, failed last page, manual override, two scheduler
      replicas, lease loss, 429 and auth/IP pause. Assert no `CommissionRecord`,
      `WalletEntry`, or withdrawal change from API activity.
    - One fixture per use case UC0–UC17 and UF1–UF7 (design "Use cases"): assert
      drift class, rows written (none on UC1/UC8–UC11), change-log entries, roster
      state, and that published data is unchanged on every failure path.
    - On the Docker stack, apply migration/backfill and compare all MEXC
      snapshot counts/amounts before and after. With a Bybit key in worker-only
      variables and allowed egress IP, perform one bounded manual sync, compare a
      chosen UID/referral code/day against the Affiliate portal, then enable a
      30-minute schedule. Review request count, rate-limit headers, alert route,
      and stale display before production rollout.
    - _Requirements: 6.8, 6.17–6.21, 13; Design: Testing Strategy, Use cases, Security_

  - [ ] 20.6 Add the MEXC Affiliate referral activity connector, worker-only
    credentials and readiness, signed daily pagination, raw landing/transform,
    per-exchange admin control and isolated rate slot. Code and unit verification
    are complete; Docker integration passed on 2026-10-07. Root UID configuration
    and live period reconciliation remain pending; do not mark this task complete
    or enable the live schedule before that gate passes.
    - Verified on Docker Postgres 18.6: worker build, updated core build, core lint,
      worker/web typecheck, 28 core unit tests passed (one private fixture skipped),
      `scripts/test-bybit-sync.mjs` and `scripts/test-mexc-activity.mjs` passed.
      Coverage includes zero UID visibility, referral codes, contract-version replay,
      missing-day reporting, correction to zero, digest idempotency, XLSX override,
      root mismatch, and no commission/wallet writes. Compose config confirms
      MEXC affiliate and legacy credentials are cleared on web.
    Keep activity separate from payable commission.
    - _Requirements: 13.15; Design: Scheduled MEXC Affiliate referral activity_

  - [x] 20.7 Exchange selector and independent Manual/Scheduled API settings.
    - List registered exchanges, remount the controls on selection, preserve draft
      settings during polling, and save mode/interval by exchange ID. Unsupported
      connectors can save disabled preferences but cannot enable API runs.
    - Changing interval resets only that exchange's next slot. Manual mode skips
      queued scheduled/backfill/reconciliation requests; Sync now remains a ready
      connector's explicit one-time action. No schema migration or credential UI.
    - Verified 2026-10-07 on Docker: core build/lint, web typecheck/lint, and
      Bybit/MEXC integration. Synthetic OKX preferences at 720 minutes remain
      independent of MEXC at 30 minutes; unsupported enable is rejected and
      manual mode makes no automatic exchange requests.
    - _Requirements: 13.8; Design: API connector exchange selection_

- [ ] 21. (Optional) SSE near-real-time UI
  - Add `PostgreSQL NOTIFY → backend SSE → client refetch` with auth, heartbeat, reconnect snapshot, and streaming-capable proxy. Not required for MVP.
  - _Requirements: 13.10; Design: Overview_

- [ ] 29. Dimensional facts + monthly partitions (5,000 transacting UIDs/day)
  - **Do not start** until approaching 5,000 UIDs/day, `WalletEntry`/`ClickEvent`
    sequential scans appear, or lookup history p95 > ~200 ms. OLTP Prisma tables
    stay the money source of truth.
  - Add SQL-migrated fact parents `PARTITION BY RANGE (date_key)`: `FactCashback`,
    `FactWalletMovement`, `FactClick`, `FactWithdrawalEvent`. Monthly children +
    `DEFAULT` partition; create next 3 months ahead. Dims (`DimDate`, exchange,
    UID, asset, offer) and `Wallet` balances stay **unpartitioned**.
  - Project from ATTRIBUTE/PUBLISH/click; lookups of transactions filter
    `date_key >= :from` so PostgreSQL prunes months. Prisma does not manage
    partition children — raw SQL only.
  - _Requirements: NFR scale 5k UID/day; Design: Dimensional store & fact partitioning_

- [x] 30. Admin left-nav shell (Requirement 18)
  - **Do not change** Prisma, worker, cashback engine, or `/api/admin/*` contracts.
  - Introduce `app/admin/(shell)/layout.tsx` (session guard + sticky left nav) and
    split the stacked `/admin` page into: `/admin` overview, `/admin/imports`,
    `/admin/withdrawals`, `/admin/exchanges`, `/admin/offers`, `/admin/links`,
    `/admin/guides`. `/admin/login` stays outside the shell.
  - Move existing `AnalyticsDashboard`, `BybitOperations`, `WithdrawalQueue`, and
    split `AdminContentManager` into four section components. Poll only while the
    page is mounted and the tab is visible.
  - Verify: unauthenticated `/admin/*` (except login) redirects; nav highlights
    the active route; imports and withdrawals no longer share one scroll page;
    two tabs can open two sections; lint/typecheck/build pass.
  - **Verified 2026-09-19:** shell layout + 7 routes; `tsc` and `eslint src` pass.
  - _Requirements: 18.1–18.6, 10.1, 11.2; Design: Components/apps/web (Admin shell)_

- [x] 31. Admin RSC guard, link offer select, lookup version (Req 18.5, 10.6, 14.7)
  - Middleware redirects `/admin/*` except `/admin/login` when the admin session
    cookie is absent, before the page renders. Each shell page calls
    `requireAdminPage()` before reading data or returning content. The layout
    guard stays. `/api/admin/*` guards are unchanged.
  - Referral-link, offer, and guide forms keep the current exchange or offer
    selected when that id is outside the first loaded page, so save does not
    clear `offerId` or retarget the exchange unless the admin picks another option.
  - Lookup `transactions[].commission` is the amount of the latest applied
    `CommissionVersion` (`WalletEntry.sourceRef` = version id, not parsed from
    `opKey`). Until ATTRIBUTE writes that entry, a newly published
    `reconciledAmount` is not shown; commission is 0 if no applied entry exists.
    `cashback` stays `creditedCashback`.
  - **Verified 2026-09-22:** core/web typecheck and eslint pass; no-cookie or bogus-cookie
    `/admin/imports` redirects (307) to `/admin/login` before the page body; `/api/health` 200.
  - _Requirements: 18.5, 10.6, 14.7; Design: Admin shell, Cashback lookup, Property 14_

- [x] 32. Admin ingest and reports information architecture (Req 18.2, 18.7, 18.8)
  - Follow `.claude/rules/` (top of this file). Spec is updated first (Req 18,
    design "Admin shell"); verify on the Docker stack that mirrors Railway.
    Check Next.js App Router redirects and route groups via Context7 for the
    version in the lockfile before coding.
  - [x] 32.1 Adapter descriptor and registry endpoint.
    - Add `accept`, `uploadFields`, `affectsCashback` and `describe()` to file
      adapters; `GET /api/admin/ingest/adapters` returns the file adapter
      descriptors from `ingestRegistry` (API adapters excluded; no credentials).
    - Unit test: every registered file adapter produces a descriptor; a new
      adapter class appears without UI changes.
    - _Requirements: 18.7, 6.10; Design: Source adapter framework (Descriptor), Admin shell_
  - [x] 32.2 Ingest and report API routes with aliases.
    - Add `/api/admin/ingest/batches` (POST, GET with filters), `/:id` (GET),
      `/:id/commit` (POST), `/api/admin/ingest/connectors/:exchangeId` (GET/PATCH),
      `/run`, `/resume`, and `/api/admin/reports/activity` reading
      `referral_activity_v`. The server re-resolves the adapter from exchange +
      dataset kind + file extension and rejects a mismatch.
    - Turn `/api/admin/imports*`, `/api/admin/referral-snapshots` and
      `/api/admin/sync-config/*` into re-exports of the new handlers (same auth,
      CSRF, `Cache-Control: private, no-store`).
    - _Requirements: 6.1, 6.7, 13.1, 18.8; Design: API contracts_
  - [x] 32.3 Pages and nav.
    - Nav: Overview; Data ingest → Uploads, API connectors; Reports → Referral
      activity; Withdrawals; Exchanges; Offers; Referral links; Guides.
    - `/admin/ingest/uploads`: one registry-driven form (exchange → dataset kind →
      adapter fields, file picker limited to `accept`) and a batch list filtered by
      exchange, dataset kind, source method, status, with an **Affects cashback**
      badge on `COMMISSION`. `/admin/ingest/uploads/[id]`: preview, drift
      warnings, publish. Replaces `BybitOperations` upload and the MEXC upload in
      `ReferralActivity`.
    - `/admin/ingest/connectors`: current sync controls (move from `/admin/sync`).
      `/admin/reports/activity`: current activity table, now from
      `/api/admin/reports/activity` (manual + API sources).
    - Retired pages `/admin/imports`, `/admin/crawl-data`, `/admin/referrals`,
      `/admin/sync` redirect after `requireAdminPage()`.
    - _Requirements: 18.1–18.8, 11.2; Design: Admin shell_
  - [x] 32.5 Repair the Task 32 review findings.
      - Preserve the legacy `referral-snapshots` response; aggregate overlapping UTC
        API day buckets for range reports with roster/day coverage and page by UID while
        keeping source/root groups intact. Add a shared response contract.
    - Make file adapters own upload validation and parsing; route file types and
      form choices come from active descriptors. Store adapter ID/version at upload,
      retain old versions for replay, and remove the duplicate registry.
    - Poll only active batches at 5 seconds, preview through publish, add report
      columns and paging, preserve useful upload UX, then remove dead components.
      Verify JSON adapter and version upgrade, alias shape, range aggregation and
      multi-root pagination before running Railway-only integration scenarios.
    - _Requirements: 6.10, 6.18, 6.22, 11.3, 18.7–18.8; Design: Source adapter framework, Admin shell, API contracts_

- [x] 33. Raw landing layer before target tables (Req 6.23–6.26, 6.3, 6.16, 6.21, 13.4)
  - Follow `.claude/rules/` (top of this file): spec is already updated; verify on
    the Docker stack that mirrors Railway; check Prisma raw SQL (`$queryRaw`/`$executeRaw`, `jsonb`,
    transactions) and PostgreSQL declarative partitioning via Context7 for the
    versions in the lockfile before coding.
  - [x] 33.1 Schema.
    - Migration: `raw_record` partitioned `BY LIST (_source_system)` with
      `raw_bybit`, `raw_mexc`, `raw_binance`, `raw_bingx`, `raw_default`; columns
      `id`, `_source_system`, `_load_id`, `_loaded_at`, `row_no`, `payload jsonb`;
      index `(_load_id, row_no)`. Prisma model + enum `RawLoad`/`RawLoadState` with the
      partial unique index "one non-superseded load per slice". `JobType` gains
      `LOAD`, `TRANSFORM` (keep `PARSE` for queued jobs). No change to commission or
      wallet tables.
    - _Requirements: 6.23, 6.24; Design: Raw landing layer, Data Models_
  - [x] 33.2 LOAD step (format/safety only).
    - Split the adapter template: `load()` (readers key records by header text,
      `__2` for duplicate headers, `__col_<n>` for empty ones; drop
      `contract.personal`; format/safety checks only) and `transform()` (current
      contract/drift/validate/minimize). Add `personal` to `FieldContract` and fill
      it for MEXC and Bybit.
    - Manual: `LOAD` job replaces `PARSE`; in one transaction under the slice lock:
      new `RawLoad`, delete previous loads' raw rows, mark them `SUPERSEDED`, insert
      rows, enqueue `TRANSFORM`. Missing/renamed columns, bad values and sheet period
      mismatch must NOT fail LOAD (move those checks from `parseMexcReferralXlsx` /
      `parseBybitCsv` into transform). Handle queued `PARSE` jobs as `LOAD`.
    - API: `SYNC` fetches all pages of a day, then performs the load in-process
      (a failed page sequence creates no load) and enqueues `TRANSFORM`.
    - _Requirements: 6.4, 6.16, 6.23, 6.24, 13.4; Design: Raw landing layer, Source adapter framework_
  - [x] 33.3 Asynchronous TRANSFORM.
    - `TRANSFORM { loadId }`: no-op if the load is not current; resolve the adapter
      (pinned for manual batches); read raw rows by `row_no`; manual → `StagingRow` +
      `PREVIEW`; API → existing `publishApiDay` (digest gate, diff upsert, change log,
      roster). Set `TRANSFORMED` or `FAILED` + drift report / safe error; raw rows stay.
    - Admin "Re-run transform" for failed/quarantined loads (upload preview page and
      connector run history), audited; raw payload values never returned (field
      names and counts only).
    - _Requirements: 6.21, 6.25, 6.26; Design: Raw landing layer (Asynchronous TRANSFORM, Re-transform), Use cases UC18/UC19_
  - [x] 33.4 Retention.
    - Daily job deletes raw rows of `TRANSFORMED` loads older than 30 days; keep
      `RawLoad` metadata. Extend the Req 13.13 purge.
    - _Requirements: 6.26, 13.13; Design: Raw landing layer_
  - [x] 33.5 Verify.
    - Unit: a file with a renamed/missing required column LOADS successfully and its
      TRANSFORM fails with `BREAKING`; after adding an alias, re-transform succeeds
      without re-upload; duplicate/empty headers are stored; personal keys never
      reach `raw_record`; a stale TRANSFORM (superseded load) writes nothing.
    - Integration on the Docker stack (`scripts/test-mexc-activity.mjs`,
      `test-bybit-sync.mjs`): two loads of the same slice leave only the latest raw
      rows, other periods untouched; an exchange without a partition lands in
      `raw_default`; formulas/ZIP bomb still fail at LOAD; no `CommissionRecord`,
      `WalletEntry` or withdrawal change from activity data.
    - Update `happy-path-scenarios.md` S17–S19 (status now goes LOAD → TRANSFORM → PREVIEW).
    - _Requirements: 6.21–6.26; Design: Testing Strategy_

- [x] 34. Admin navigation dropdowns (Req 18.9)
  - Update requirements and design first. Render Data ingest and Reports as
    keyboard-operable disclosure groups; stack every destination on its own row,
    open the current route's group, and preserve mobile navigation.
  - Verify web typecheck, lint, and production build.
  - _Requirements: 18.9; Design: Admin shell — Navigation presentation_

- [x] 35. Worker-owned Bybit connector readiness (Req 13.14)
  - Persist the worker's secret-free readiness result and root UID guard; web
    controls read only a fresh result and show the safe reason for failure.
  - Keep Bybit credentials in the worker container, add the new database
    migration, and verify enabling without web credentials on Docker Postgres.
  - _Requirements: 13.9, 13.12, 13.14; Design: Schedule and operation_

- [x] 36. Allow Bybit sync without an IP allowlist (Req 13.12)
  - Remove the application-side `IP_ALLOWLIST_REQUIRED` readiness gate while
    retaining the warning and expiry display. Keep actual Bybit 401/403 failures
    and key permission/expiry checks blocking.
  - Verify wildcard-IP readiness and admin enable on the Docker stack.
  - _Requirements: 13.7, 13.12, 13.14; Design: Schedule and operation_

- [x] 37. Default Referral activity filter to today UTC (Req 18.10)
  - Prefill both report dates from the server's current UTC date, remove the
    report source timezone field, and convert the selected dates as UTC.
  - Verify the web production build on the Docker stack.
  - _Requirements: 18.10; Design: Admin shell — Referral activity filter_

- [x] 38. Clarify report states, date controls, and pagination (Req 18.11–18.12)
  - Add clear labels/help for report data states, emphasize the native date picker,
    and retain page cursors so Previous and First work after Next.
  - Verify web build on Docker and page navigation behavior.
  - _Requirements: 18.11–18.12; Design: Admin shell — Report readability and navigation_

- [x] 39. Auto payout skeleton: payout wallet config + readiness only (Req 21, draft)
  - Add worker-only env vars `PAYOUT_*` to `.env`/`.env.example`; blank the payout keys
    in the web container (`infra/docker-compose.yml`).
  - `packages/core/src/payout/config.ts`: network registry ETHEREUM/BSC/SOLANA, key/RPC/
    daily-limit validation, secret-free `payoutReadiness()`; mainnet blocked outside
    production; `enabled` is always false until a sender exists.
  - `packages/core/src/payout/sender.ts`: `PayoutSender` port (prepare/broadcast/lookup), no implementation.
  - Worker logs `payout_readiness` at start. Unit tests use synthetic keys only.
  - Not included: DB model/migration, SDK, signing, sending, withdrawal route changes, test transactions.
  - _Requirements: 21.10, 21.12 (draft); Design: Job queue — Lịch thanh toán và cơ chế ký_

### Phase 5 — Dark Aurora public UI (Req 19–20)

- [ ] 40. Triển khai giao diện public Dark Aurora đã chốt
  - Tham chiếu: `design.md` → Components/apps/web — Giao diện và tên website;
    `docs/dark-aurora-ui-plan.md`; mockup local `mockups/dark-aurora.html`.
  - Dependency: Tasks 5, 23, 25 hiện có. Không phụ thuộc Task 39/payout hoặc
    Optional SSE Task 21. #23–24 đã chốt khi triển khai plan; QA calculator trong 40.5 chạy sau 40.3.
  - Giữ tên Cashback Hub và English-only; đổi tên ở #22 không chặn UI.
  - [x] 40.0 Đồng bộ spec và kế hoạch với hướng giao diện đã chọn.
    - Ghi nhận #25 đã chốt, Req 20.7, sửa Styling và thứ tự section trong design;
      ban đầu giữ #22–24 mở; khi triển khai plan chốt #23–24 / Req 19.8, giữ #22 mở.
      Hoàn thành tài liệu 2026-10-14,
      không có nghĩa UI ứng dụng đã triển khai.
    - _Requirements: 20.1, 20.7; Design: Styling; Giao diện và tên website_
  - [x] 40.1 Public shell, theme, navigation và hero.
    - Dependency: 40.0. Scope theme Dark Aurora cho public routes, giữ admin tokens/shell;
      dùng Tailwind/component primitives hiện có. Header/footer/metadata giữ Cashback Hub.
    - Menu mobile có control dùng được bằng bàn phím; Wallet dẫn `/withdraw` thay
      link `/me/wallet` chưa có route; giữ URL public hiện có và LocaleProvider.
    - Giữ hero/hình ví cũ và hai thẻ nổi, nhãn minh họa; calculator sẽ nằm bên dưới
      toàn bộ hình ví, không thay hero bằng calculator.
    - _Requirements: 4.1, 20.1–20.7; Design: Giao diện và tên website_
  - [x] 40.2 Logo, published offers và các section nội dung.
    - Dependency: 40.1. Dải logo local, deduplicate theo exchange ID; dữ liệu seed
      hiện có Bybit/Binance/MEXC. Cards rộng ba cột desktop, một cột mobile.
    - Giữ SSR và `listPublishedOfferCards()`, `logoUrl`, conditions, offerId/linkId;
      tỷ lệ từ published data, không hard-code 30/40/35 hoặc ép luôn chỉ ba offers.
    - Đồng bộ exchanges/detail/guides; How it works, FAQ/footer dẫn route/anchor
      tồn tại. Giữ `/go/{linkId}` và quy tắc ghép referral ở core.
    - Giữ ledger generator/badge Req 17 sau How it works; bỏ stats người dùng/quốc gia
      chưa có nguồn. Thiếu data thì empty/unavailable, không lấy mockup làm fallback.
    - _Requirements: 1.1–1.2, 7.3, 17.1–17.7, 20.1–20.3, 20.6; Design: Exchange logo assets; Online Rebate Ledger; Giao diện và tên website_
  - [x] 40.3 Opportunity Check — bản đầu theo plan, thay mô hình volume tại Task 43.
    - Dependency: 40.0, 40.2 và mô hình đầu vào/nguồn tỷ lệ/kỳ đã được chốt trong
      requirements/design: phí/tháng USDT, commission assumption, published offer share,
      kết quả tháng/12 tháng, fixed-point decimal và rounding theo Req 19.8.
    - Tách hàm tính/validation khỏi client component; dùng thập phân, chỉ làm tròn
      lúc hiển thị. Share đọc published offer, chọn đúng offer khi một sàn có nhiều offers.
    - Calculator nhận props server, không gọi/lưu input lên server, không nhập core/DB
      vào client, không ghi ví hoặc làm offer SSR chờ JS.
    - Kết quả lớn, viền/glow cam, copy tiếng Anh nhấn mạnh giá trị tiềm năng;
      giữ giả định, công thức, điều kiện và không nhận lại phí quá khứ. Input lỗi
      phải xóa kết quả cũ; ước tính không trở thành available balance.
    - _Requirements: 19.1–19.7, 20.1–20.3, 20.6–20.7; Design: Bảng tính tiền hoàn phí bị bỏ lỡ; Giao diện và tên website_
  - [x] 40.4 Restyle lookup — bản đầu, thay contract/luồng public tại Task 43.
    - Dependency: 40.1; làm độc lập với 40.3. Giữ `POST /api/lookup`, response schema,
      pending/available theo asset, transactions đã attribution và timestamps.
    - Kiểm tra loading/no data/error/429, UID giữ số 0 đầu; thay sàn/UID xóa kết quả
      cũ và chỉ hiển thị kết quả của lựa chọn đã submit.
    - Luồng hiện tại theo Task 43: không CTA rút; `/withdraw` redirect tra cứu. Không đổi holding/approval/gate/sender; toàn bộ API/phiên riêng tư của khách được gỡ theo Task 44.3 (chưa làm).
    - _Requirements: 14.1–14.8, 20.1–20.4, 20.6; Design: lookupService; Giao diện và tên website_
  - [ ] 40.5 QA và bàn giao UI ứng dụng — automated checks đạt, visual QA còn mở.
    - Bằng chứng cập nhật 2026-10-14: Docker rebuild source mới, web unit/DOM/HTTP
      integration 26/26, core lookup-version 4/4. Web/Postgres healthy, local port 3000
      giữ chạy theo yêu cầu. Synthetic UID/wallet/commission fixtures đã dọn.
    - DOM tests mới (`apps/web/test/aurora-components.test.mjs`) kiểm chứng đổi sàn/
      nhiều offer/props refresh, invalid/zero inputs, ID references, lookup loading/
      no-data/network/JSON/schema/429, late response/unmount, Wallet context và
      menu Escape/focus. Đã sửa selection stale, ID reference thiếu và lỗi kỹ thuật
      hiện ra UI. HTTP rate-limit probe dùng IP IPv6 documentation ngẫu nhiên riêng
      mỗi run để không trùng budget của người dùng hoặc run trước.
    - CUA không có browser khả dụng. Chưa kiểm chứng ảnh 360–1440px, thao tác browser/
      keyboard hoặc contrast bằng browser audit; không đánh dấu mục này hoàn thành
      trước visual QA/người dùng kiểm tra local.
    - Dependency: 40.1, 40.2, 40.4; QA calculator/chốt toàn bộ Task 40 cần 40.3.
    - Kiểm tra tại 360/390/768/1024/1440px, không cuộn ngang; hero giữ hình cũ,
      calculator ở bên dưới, logo/amount không bị cắt; chụp ảnh đối chiếu mockup.
    - Kiểm tra menu/keyboard/focus, labels, contrast WCAG 2.1 AA, reduced motion,
      ledger badge và admin giữ theme; English copy/brand nhất quán.
    - Test calculator theo mô hình được chốt: công thức, đơn vị, 0, decimals,
      input rỗng/âm/không hữu hạn, tỷ lệ ngoài 0–100, đổi offer, xóa stale result.
    - Test lookup/no data/nhiều asset/lỗi/429, UID `001234`, không link Wallet/rút, `/withdraw` redirect;
      offers render trước hydrate, không fallback sang demo khi DB lỗi, referral URL đúng.
    - Chạy typecheck/lint/build theo workflow repo; check có DB/web integration dùng
      stack Docker theo steering. Ghi kết quả và ảnh; không đánh dấu hoàn thành
      dựa trên việc chỉ sửa mockup/tài liệu, không tự deploy.
    - _Requirements: 1.1, 14, 17, 19.1–19.7, 20.1–20.7; Design: Testing Strategy — Kiểm chứng Req 19–21_

- [x] 41. Pause/Resume API ingestion theo từng sàn (Req 13.8).
  - [x] 41.0 Đồng bộ requirements/design: admin pause độc lập lỗi, giữ settings,
    stop queued/new runs và dừng trước ngày tiếp theo; không hủy slice đang fetch.
  - [x] 41.1 Migration adminPaused, core pause/resume atomic audit, scheduler/worker guards.
  - [x] 41.2 Endpoint/legacy alias với admin + same-origin; nút Pause/Resume và status,
    busy/poll revision, giữ draft mode/interval trên exchange đang chọn.
  - [x] 41.3 DOM + Docker integration auth/CSRF/audit, isolation/readiness/save,
    queued/manual/resync guards và pause giữa ngày; build/typecheck/lint; giữ localhost.
    - Evidence (2026-10-14): Docker web + worker build đạt; web/worker typecheck,
      web/core lint đạt; web 29/29 tests (gồm 3 DOM cases Pause/Resume mới) đạt;
      `scripts/test-connector-pause.mjs` đạt 6 nhóm integration và dọn schema riêng;
      `scripts/test-bybit-sync.mjs` regression Bybit/MEXC đạt. Migration đã áp dụng
      trên Docker, web healthy tại `http://localhost:3000`; giữ local để user kiểm tra.
      DOM/HTTP tests không thay thế kiểm tra hình ảnh trên browser của Task 40.5.
  - _Requirements: 13.8–13.9, 18.8; Design: Admin pause; Schedule and operation_

- [ ] 42. Sổ khoản phải trả và lịch sử PAID/UNPAID (Req 22; business trước implementation)
  - [x] 42.0 Đặc tả business: bảng chính CustomerPayable, định danh sàn/UID/tài sản/số tiền/nguồn;
    PAID/UNPAID tách approval, lý do, tiến trình và hiệu lực; giữ audit, chống đếm/trả trùng.
    #33 đã chốt: tự đồng bộ async sau pipeline ingest/cashback, không chờ yêu cầu rút.
  - [x] 42.0a Spec nguồn chi chung auto/manual: mọi thao tác tham chiếu payableId/version,
    command async, enqueue cùng transaction nguồn, checkpoint/freshness và xử lý correction;
    không fallback chi từ raw/activity/Wallet, không ghi đè PAID hoặc snapshot đang gửi.
  - [x] 42.0b Đối chiếu review theo full spec: phân biệt quyết định mở/đã có policy với thiếu
    chi tiết; thống nhất ngưỡng/hủy, dẫn recovery 8.7, thêm cutover/blocker detail và RTM.
    Phương án release/FIFO allocations chỉ để review #34–35, không tự duyệt grain/mapping; customer partial đã loại theo câu 13.
  - [x] 42.1 Chốt #34–35 và các policy USD/approval/phí/hạn mức liên quan; duyệt bảng chuyển
    trạng thái, correction, phân bổ nguồn/execution và legacy reserved/in-flight; không có khách rút một phần.
    Gate đã mở ngày 2026-10-17: người dùng duyệt phương án release + allocations (#34), execution riêng (#35) và thứ tự ưu tiên release cũ nhất trước.
    Câu 1 đã chọn MEXC + Bybit trả USDT qua UID, source riêng; Binance thêm khi data + quyền đủ.
    Câu 2 chấp nhận operator thêm/xác minh mỗi UID Bybit một lần, sau đó auto khi đủ điều kiện;
    phần lựa chọn này đã chốt, quy trình thực tế và recipient readiness vẫn cần kiểm chứng.
    Câu 3 chốt USDT nội bộ: một đợt/ngày 23:00 UTC, gộp theo sàn + UID; xét ngưỡng trên tổng.
    #26 đã chốt lịch/cutoff/retry USDT nội bộ; #34 grain/khóa nguồn/mapping còn review; khách không yêu cầu rút theo câu 13.
    Câu 4 chốt tổng sau gộp <=20 USD tự trả khi đủ gate, >20 USD giữ UNPAID chờ approval;
    đúng 20 USD thuộc nhánh tự trả. Quyền rút chủ động đã loại ở câu 13/22.35.
    Câu 5 chốt khoản >20 USD approve sau đợt phải đợi 23:00 UTC kế tiếp; approve không dispatch.
    Câu 6 chốt bỏ lỡ đợt thì chờ 23:00 UTC kế tiếp, gộp phần còn đủ điều kiện, không gửi bù ngay.
    Câu 7 chốt nguồn mới trước đợt gộp vào tổng chưa gửi, approval cũ mất hiệu lực; 25+5=30 duyệt lại.
    Câu 8 chốt danh sách 23:00 UTC; nguồn mới sau cutoff để đợt sau, correction vẫn theo guard.
    Câu 9 chốt lỗi chắc chắn chưa chuyển chờ đợt 23:00 UTC ngày sau, xét lại mọi gate; UNKNOWN đối soát riêng.
    Câu 10 bỏ first-review guard/blocker/UI: <=20 USD có thể tự trả từ lần đầu, >20 USD chờ duyệt.
    Sửa assertions legacy Task 25/QA khi triển khai; evidence đã chạy của runtime cũ vẫn giữ lịch sử.
    Câu 11 operator chịu phí USDT nội bộ, khách nhận đủ cashback; kiểm provider fee semantics,
    nguồn đủ principal+phí theo từng asset, fee readiness và provider limits trước bật; internal USDT không daily cap riêng theo câu 15. Không trừ phí khỏi payable.
    Câu 12 ngưỡng internal USDT cố định 20 USDT (1:1), không market quote; lưu valuation mode/policy.
    Câu 13 auto-only: bỏ customer create/cancel/partial và money controls UI; private customer reads cũng bị gỡ theo Task 44.3 ngày 30/10.
    Scheduler không cần OTP/email/session khách, admin vẫn dùng command chung/gates. Cutover
    inventory và vô hiệu customer routes/jobs cũ, đối soát legacy reserved/UNKNOWN trước mở gate.
    Câu 14 minimum strict >0.5 USDT sau gộp; <=0.5 UNPAID tích lũy, vẫn kiểm provider minimum/precision.
    Câu 15 không daily cap riêng USDT nội bộ, chi theo nguồn thực đủ principal+phí; thiếu nguồn
    UNPAID chờ đợt 23:00 UTC ngày sau. 100 là ví dụ nạp, không hard-code. Review source funding
    reservation/concurrency với UID allocation; thứ tự ban đầu còn cần chốt, skip nhóm theo câu 16.
    Câu 16 thiếu funds một UID thì defer ngày sau và tiếp tục nhóm sau đủ nguồn/phí, không dừng
    toàn đợt hoặc retry nhóm bị defer cùng đợt; lưu cursor/group outcome để replay không chi trùng.
    Khảo sát API tại docs/exchange-uid-payout-research.md đã xong bước tài liệu; chưa verify tài khoản,
    chưa test transfer. Cần kiểm source key rights, Bybit recipient book/verification, MEXC thực tế,
    và Binance merchant Payout eligibility; không thay key affiliate hoặc tự bypass OTP/2FA.
  - [x] 42.1p Module chính sách thuần USDT nội bộ không phụ thuộc #34: `packages/core/src/payout/internal-usdt-policy.ts`
    (ngưỡng ≤20 / >0.5 strict, 1:1 FIXED_USDT_USD, slot 23:00 UTC cho duyệt/lỡ đợt/retry, thứ tự blocker 22.23,
    command guard, hiệu lực approval). Không DB, không sender, không tiền thật; chưa nối vào luồng nào.
    Verified: `packages/core/test/internal-usdt-policy.test.mjs` 7/7, core typecheck/lint/build đạt.
  - [x] 42.2 (hoàn thành 2026-10-17, mô phỏng) Thiết kế schema/unique keys/transactions/contracts và migration/backfill trên Docker;
    thêm sync checkpoint, commandKey/payload digest, durable jobs/lease/retry/catch-up; nối
    ingest/publish/attribution/release/correction sang đồng bộ. Một nguồn tiền không có hai
    nghĩa vụ/lệnh độc lập; loại fixtures khỏi công nợ thật.
  - **Trạng thái triển khai 2026-10-17:** migration `202610170001_customer_payables` (8 bảng + 7 enum + CHECK/partial UNIQUE + gate LEGACY); `packages/core/src/services/{payables,money-gate}.ts`, `payout/internal-transfer.ts` (port + `SimulatedInternalTransfer` chỉ để test); hooks trong `cashback.ts` (release → `markPayableSourceChanged`, correction → invalidate/reduce); worker xử lý `SYNC_PAYABLES`, `PAYOUT_SLOT`, `PAYOUT_RECONCILE`, `PAYABLE_COMMAND`; gate chặn writer cũ; API `/api/admin/{payables,payout-executions/:id,payout-executions/:id/commands,payable-commands/:id,money-flow}` và trang `/admin/payables`. **Chưa làm:** adapter MEXC/Bybit thật (không có sender thật, worker không tự gửi), backfill legacy + 42.3a inventory/42.3c mapping, gỡ UI rút của khách, tỷ lệ cashback/holding, xác minh tài khoản/quyền API. Chạy: `TEST_DATABASE_URL=<Docker> node scripts/test-payables.mjs` → 19 nhóm PASS; evidence và case chưa chạy ở `payables-rtm.md`.
  - [ ] 42.3 (một phần: core, API, UI cơ bản, gate và scheduler đã có; thiếu inventory/backfill/gỡ UI khách) Core + admin API/UI bảng lịch sử, lọc/tổng từng asset, approval và audit;
    API trả 202/commandId, poll trạng thái; auto/manual/legacy dùng cùng command và khóa/version.
    Scheduler USDT nội bộ chạy 23:00 UTC mỗi ngày; claim đợt/ngày và nhóm sàn/UID/asset bền vững,
    gộp một execution logic, kiểm tổng ngưỡng, chống trùng replica/job; đợt bị lỡ chờ đợt kế,
    chặn stale-job dispatch ngoài lịch, giữ UNPAID/nguồn và không gộp lại UNKNOWN. Sync/reconcile
    vẫn recovery độc lập; lưu manifest nguồn/tổng/versions tại cutoff 23:00 UTC, nguồn mới sau đó để ngày sau.
    Retry lỗi chắc chắn chưa chuyển chỉ từ đợt 23:00 UTC ngày sau theo 22.31; UNKNOWN đối soát.
    APPROVE sau đợt lưu next eligible slot và WAITING_SCHEDULE; SEND kiểm lịch cùng snapshot/gates,
    không enqueue chi tức thì hoặc nhân nghĩa vụ ở đợt sau; RTM PAY-038.
    SYNC_PENDING/FAILED chặn chi mới; PAID chỉ sau bằng chứng thành công, UNKNOWN giữ chỗ.
    - [ ] 42.3a Inventory mọi money writer/route/job; deploy bản đọc DB moneyFlowMode ở tất cả
      instance, chưa bật producer/sender mới, loại instance cũ không có gate.
    - [ ] 42.3b FROZEN dưới exclusive barrier; dừng dispatch/money mutations cũ, drain/reconcile
      in-flight theo evidence; UNKNOWN giữ scope blocked. Ingest tiếp tục với checkpoint rõ.
    - [ ] 42.3c Backfill/mapping theo #34–35 đã duyệt, unique legacy IDs; đối soát nguồn và
      available/reserved/withdrawn/receivable, không reserve/settle lại, fixtures vào exceptions.
    - [ ] 42.3d Customer money routes/jobs cũ bị chặn; admin route cũ thành alias command; thiếu mapping trả 409/503, gate missing fail
      closed; drain/version jobs cũ, chứng minh concurrent old/new/auto không có bypass/fallback.
    - [ ] 42.3e Chỉ mở PAYABLE_ONLY sau coverage/checkpoint/reconcile đạt; quyền sender vẫn
      kiểm riêng. Sau execution mới rollback chỉ FROZEN/reconcile-only, không LEGACY.
  - [ ] 42.4 (một phần: `scripts/test-payables.mjs` C1–C19 PASS, xem RTM; còn các case NOT RUN/PARTIAL) Docker integration các scenarios Req 22: trùng lịch/import/retry/concurrency,
    approval dưới/bằng/trên ngưỡng, timeout/crash, xác nhận lặp, correction và phân quyền;
    atomic enqueue, out-of-order/lease/catch-up, release không có ingest mới, freshness và
    command idempotency; correction giữa gửi/xác nhận không chặn ghi nhận tiền đã chuyển.
    RTM/Given–When–Then: `payables-rtm.md` (38/38 AC, planned). Evidence từng case phải có
    commit/migration/command/expected/actual; các case allocation cụ thể chờ duyệt #34–35.
  - Sender nội bộ/on-chain và gửi tiền thật là bước riêng; Task 42.0 không tạo bảng DB,
    không migrate/deploy hoặc bật thanh toán. Task 39 vẫn chỉ là khung config/readiness.
  - _Requirements: 22.1–22.38, 8, 9, 12.5/12.7, 21; Design: Sổ khoản phải trả; Pipeline async; Cutover; Property 18; RTM: payables-rtm.md_

## Notes

- Phương án các nhóm còn mở sau UI: `docs/remaining-work-plan.md` (2026-10-14).
  Đề xuất Task 18 Docker end-to-end trước mở rộng connector/payout; chưa đánh dấu
  các task đó hoàn thành hoặc biến các quyết định mở thành hành vi đã duyệt.

- **[PENDING] commission dedup key** (Open decision #11): finalize
  `CommissionRecord.dedupKey` per adapter in Task 11.1 once a nonzero UID-level
  commission report exists. The MEXC Referral Data XLSX resolves activity mapping only.
- **[PENDING] Bybit pending/settled reconciliation:** Task 20 reads
  `commissionsVol` as reported activity. A portal pending amount may differ; obtain
  settlement evidence and a separate approved commission mapping before any
  automation may attribute cashback or change a wallet.
- **[PENDING] admin auth provider** (Open decision #13): Task 7 ships interim
  email+password behind `AuthPort`; swap provider without changing dependents.
- **Resolved (Open decision #12, 30/10):** công khai cashback kỳ D/30 ngày và totalPaid theo Req 14; không private customer reads.
- **[PENDING] default values**: cashback rate (Task 13), holding period (Task 14),
  supported assets/networks + valuation/limits policy (Task 25/42; internal USDT fixed <=20 USDT, coin khác cần quote theo policy), lookup
  rate-limit window (Task 23). Volume mặc định calculator đã chốt 1,000,000 USDT (Task 44.1), không còn pending. The
  *resolution rules* are decided; only default *values* remain.
- **Rủi ro đã chấp nhận:** công khai cashback khi biết sàn + UID; không còn claim UID. Giữ threshold approval, rate-limit, holding và recipient readiness.

- **Decided (revisitable):** reversal-after-release policy = reduce pending → available →
  `receivable` (clawback), block new withdrawals while `receivable > 0`, offset future
  credits (Req 8.7; Tasks 13/14/25).
- **[PENDING] compliance/KYC** (Open decision #19): keep payout identity isolated
  (Tasks 17/25) so KYC/retention can be added later.
- Verify build/typecheck/tests on local/SIT before pushing and deploying to Railway.

### Binance GET-only integration — 11/10/2026

- [x] Register Binance in the source registry and admin connector selector.
- [x] Worker-only read-only key check, secret-free readiness, Sync now/Scheduled.
- [x] GET Spot rebate and USD-M Futures summary; finalize minimized raw slices
  and fetched counts, accept empty arrays, keep activity/ledger writes disabled.
- [x] Key rotation scopes, bounded ranges, throttle/IP-ban handling and Docker
  unit/integration checks with fixture data and a live key returning zero rows.
- [x] Deploy web and worker to Railway production and verify readiness there
  (11/10/2026): both SUCCESS; Binance supported/configured/ready, unpaused;
  read-only GET from the deployed worker returned 0 Spot and 0 USD-M Futures
  records; public health OK. Automatic sync remains disabled until admin enables it.

- [ ] 43. [Lịch sử; phần bị thay thế chuyển Task 44] Đồng bộ website với cuộc họp 20/10 và 5 lựa chọn chốt ngày 21/10/2026 (Req 8/14/19/20)
  - Kế hoạch tiếp nối và bằng chứng: `docs/meeting-2026-10-20-implementation-plan.md` (cập nhật 2026-10-30).
  - [x] 43.0 Cập nhật requirements → design → tasks trước code; giữ lịch 23:00 UTC, minimum/ngưỡng/approval và gate/readiness đã chốt.
  - [x] 43.1 [Superseded bởi 44.1 ngày 30/10; bằng chứng cũ] Calculator volume/tháng, phân tách hàng nghìn; hai giả định phí/commission ban đầu rỗng, khách tự nhập; công thức bốn thành phần, tháng/12 tháng, fixed-point và validation. Code đã build; kiểm tra calculator và DOM đã đạt trong bộ 32 web tests.
  - [x] 43.2 [Ngày lookup/zero superseded bởi 44.2; bằng chứng cũ] API lookup không commission/rate/volume/bucket ví; bảng kỳ/tài sản/UID/cashback; tổng ngày UTC trước/30 ngày không theo giới hạn bảng, totalPaid từ settled ledger; thiếu chi tiết kỳ không prorate/giả 0. HTTP Docker đã kiểm tra privacy, tổng 131 dòng ngày trước, kỳ cắt biên, dữ liệu 0 và nhiều asset.
  - [x] 43.3 Bỏ Wallet/nút rút/OTP khỏi public navigation và nội dung; /withdraw redirect tra cứu; POST tạo/hủy rút luôn từ chối không mutation. Việc giữ private history/API ở bản này đã bị thay thế bởi 44.3; không bật sender thật. HTTP Docker đã kiểm tra redirect/410 và trạng thái tiền/job không đổi.
  - [ ] 43.4 Kiểm chứng calculator/DOM/contracts/core và HTTP trên Docker: privacy, tổng vượt 100 dòng, biên UTC/kỳ nhiều ngày/no-data/0, tổng đã trả không đếm đôi, route rút retired, stale request; typecheck/lint/build và kiểm tra browser local.
    - [x] 43.4a Build web + contracts/db/core trong Docker đạt; bộ web unit/DOM/HTTP 32/32 PASS, không skip.
    - [ ] 43.4b [Kế hoạch cũ, thay bằng 44.4] Chạy và ghi kết quả core lookup tests, lint các package đã sửa và `scripts/test-uid-access.mjs` đã cập nhật. Lệnh gần nhất bị ngắt, chưa có kết quả xác nhận; không tính là đã chạy đạt.
    - [ ] 43.4c [Chuyển kiểm chứng spec mới sang 44.4] Kiểm tra browser desktop/mobile, focus/menu/định dạng volume và bố cục kết quả. Chưa có bằng chứng visual QA.
    - [ ] 43.4d [Chuyển rà spec mới sang 44.4] Rà diff, dọn mô tả cũ còn mâu thuẫn ở tài liệu liên quan, ghi kết quả cuối và bàn giao. Không tự stage/commit/deploy.
    - Kiểm tra trạng thái 2026-10-22: Docker API không kết nối được; chưa xác nhận web local đang chạy. Kết quả PASS ở 43.4a là bằng chứng lần chạy trước, không phải lần kiểm tra hiện tại.
  - Phạm vi để sau: domain/brand mới, tỷ lệ thật/holding và tài khoản affiliate/API, adapter chi trả thật/cutover, BingX, dashboard nhiều UID, campaign marketing. Không tự chọn hay bật các phần đó.

- [ ] 44. Triển khai quyết định 30/10/2026 (Req 14/19/20; Req 15/16 removed) — **chưa làm**
  - Tài liệu đã cập nhật trong Bước 1; không tính là đã triển khai Task 44. Không migrate/DB, stage/commit hoặc deploy trong bước này.
  - [ ] 44.1 Calculator volume-only: thêm Offer.estimatedVolumeRate Decimal(12,10) nullable và migration `202610300001_offer_volume_estimate` (CHECK [0,1]); admin form/validation tối đa 10 chữ số; public offer card/contract decimal string hoặc null; lọc calculator chỉ offer có hệ số; volume mặc định 1,000,000 USDT/nhóm nghìn, tháng/năm tính chính xác và chỉ round hiển thị. Mặc định đã chốt, có thể chỉnh sau trong code; không cần xác nhận lại.
  - [ ] 44.2 Lookup latest reported day: helper latestReportedDay từ ImportBatch COMMISSION/PUBLISHED, full UTC day ≤ hôm qua, day detail và sourceAsOf không partial; index `(exchangeId, datasetKind, status, periodEnd)` và migration index; summaryPeriods { reportDay, rollingStart, end }, kỳ D và [D−29,D+1), hasData=false/cùng shape rỗng và message cho UID không tồn tại hoặc chưa có cashback attribution; chỉ hasData=true mới có REPORTED 0 khi có D nhưng UID không dòng trong kỳ, NO_DATA khi chưa D; giữ INSUFFICIENT_DETAIL, totalPaid=Wallet.withdrawn và privacy.
  - [ ] 44.3 Gỡ OTP/UID session/customer withdrawal UI: route/service/contract/env/SDK/cookie/guard và GET private wallet/history, bỏ luồng khách riêng tư; giữ `/withdraw` redirect và POST tạo/hủy retired 410 không mutation. Migration dự kiến `202610300002_drop_customer_otp` drop EmailOtp/UidSession/UidAccount.boundEmail/emailBoundAt và phụ thuộc; giữ Withdrawal.email/WithdrawalEvent.email, admin Session, UID/Wallet, queue admin legacy/payables/receipts/audit và lookup rate-limit; không thay gate hoặc bật sender.
  - [ ] 44.4 Kiểm chứng spec mới: rà diff/traceability/privacy; calculator 0/null/1/10 chữ số, lỗi precision/range, nhiều offer, mặc định 1,000,000 USDT/grouping/chỉnh sửa và rounding năm độc lập; lookup coverage UTC, stale D, TRANSACTION nhiều ngày, sourceAsOf null/partial, sourceTz khác UTC, D tương lai, UID lạ và UID đã biết chưa có cashback cùng hasData=false/no-data shape/message; UID đã có cashback ngoài kỳ có hasData=true, có D/không dòng trong kỳ REPORTED zero, chưa D NO_DATA, kỳ cắt biên INSUFFICIENT_DETAIL, tổng >100 dòng và totalPaid không đếm đôi. Xác nhận API/phiên khách đã gỡ không lộ dữ liệu, route rút không mutation; admin queue/payables giữ nguyên. Ở bước triển khai sau: migration/integration trên schema Docker riêng, typecheck/lint/build và browser desktop/mobile/focus. Không dùng PASS Task 43 thay kiểm chứng Task 44.

## Changelog


| Ngày | File | Thay đổi | Lý do | Loại |
|------|------|----------|-------|------|
| 2026-10-30 | tasks.md | Sửa Task 44.2/44.4 kiểm chứng hasData chống dò UID và chỉ tính metric cho UID đã có cashback attribution | Review Claude Bước 1 và quyết định người dùng 30/10/2026 | updated |
| 2026-10-30 | tasks.md | Chốt Task 44.1/44.4 volume mặc định 1,000,000 USDT; bỏ bước hỏi xác nhận số mặc định, giữ task chưa làm | Review Claude Bước 1 và quyết định người dùng 30/10/2026 | updated |
| 2026-10-30 | tasks.md | Task 24 và 25.4 removed/superseded, 25.7 chỉ giữ admin legacy; bỏ tuyên bố tiếp tục giữ private customer APIs | Quyết định người dùng 30/10/2026; chỉ sửa tài liệu | removed |
| 2026-10-30 | tasks.md | Task 43 giữ bằng chứng lịch sử có nhãn superseded; trạng thái hiện hành theo quyết định 30/10 | Quyết định người dùng 30/10/2026; chỉ sửa tài liệu | updated |
| 2026-10-30 | tasks.md | Thêm Task 44.1–44.4 chưa làm: calculator, latestReportedDay, gỡ xác thực khách/migration và kiểm chứng | Quyết định người dùng 30/10/2026; chỉ sửa tài liệu | added |
| 2026-10-22 | tasks.md | Đánh dấu 43.1–43.3 đã có code và 43.4a build/web tests 32/32 đạt; tách các kiểm tra bổ sung, visual QA và bàn giao còn mở; liên kết kế hoạch tiếp nối | Người dùng yêu cầu báo cáo trạng thái và lập lại plan; Docker hiện chưa kết nối, không nhận kết quả test bị ngắt là PASS | updated |
| 2026-10-17 | tasks.md | Duyệt #34–35: 42.1 và 42.2 hoàn thành (mô phỏng Docker); 42.3/42.4 làm một phần, ghi rõ phần chưa làm; sửa `scripts/test-bybit-integration.mjs` cho job LOAD/TRANSFORM và SYNC_PAYABLES | Người dùng yêu cầu code theo plan, viết lại happy-case và giả lập test | updated |
| 2026-10-17 | tasks.md | Câu 13 auto-only, customer money routes/UI disabled at cutover; RTM 35 AC | Không có khách rút toàn bộ/một phần/hủy, không cần OTP/session cho scheduler; bảo toàn legacy balances | updated |
| 2026-10-17 | tasks.md | Câu 14 strict >0.5 USDT/accumulation gate, RTM 36 AC | Kiểm bằng ngưỡng không gửi, tích lũy qua ngày và provider minimum cao hơn | updated |
| 2026-10-17 | tasks.md | Câu 15 no daily cap/balance-only và source guard, RTM 37 AC | Kiểm thiếu nguồn đợi ngày sau, top-up không gửi bù và source không double-spend | updated |
| 2026-10-17 | tasks.md | Câu 16 per-group defer/continue, RTM 38 AC | Kiểm balance3/nhóm5/nhóm2, phí và replica replay không chi trùng | updated |
| 2026-10-17 | tasks.md | Câu 10 bỏ mandatory first review trong policy đích, RTM 32 AC; assertions legacy cần sửa qua Task 42 | Giữ evidence runtime cũ, không dùng làm policy mới | updated |
| 2026-10-17 | tasks.md | Câu 11 fee payer/recipient net constraints, RTM 33 AC | Kiểm khách nhận đủ, nguồn/phí riêng và thiếu phí không giảm khoản trả | updated |
| 2026-10-17 | tasks.md | Câu 12 fixed 1:1/20 USDT, RTM 34 AC; quote chỉ cho nhánh cần market valuation | Kiểm quote feed lỗi không chặn USDT nội bộ, coin khác vẫn fail closed | updated |
| 2026-10-17 | tasks.md | Ghi phạm vi câu 1 và khảo sát API UID/verification; thêm account/channel/recipient readiness vào 42.1, RTM 25 AC | Hỗ trợ cả MEXC và Bybit USDT nguồn riêng, Binance có điều kiện; chưa cấu hình/sử dụng key chi tiền | updated |
| 2026-10-17 | tasks.md | Cập nhật 42.1 với câu 2 đã chốt: operator thiết lập UID Bybit một lần, kiểm readiness vẫn mở | Tiếp tục chốt business từng câu trước triển khai | updated |
| 2026-10-17 | tasks.md | Ghi câu 3 và scheduler 23:00 UTC/gộp execution vào 42.1/42.3, RTM 26 AC | Chốt lịch và gom lệnh trước code, chưa chốt catch-up/partial | updated |
| 2026-10-17 | tasks.md | Ghi câu 4 <=20 USD tự trả, >20 USD chờ duyệt; boundary tests gồm đúng 20 USD | Thay ranh giới trước theo quyết định mới, giữ mở partial | updated |
| 2026-10-17 | tasks.md | Ghi câu 5/slot guard trong 42.1/42.3, RTM 27 AC | Approval sau đợt chỉ cho phép chi từ đợt 23:00 UTC kế tiếp | updated |
| 2026-10-17 | tasks.md | Ghi câu 6/skip missed dispatch trong 42.1/42.3, RTM 28 AC | Đợi đợt 23:00 UTC kế tiếp sau downtime, không trì hoãn đối soát đã gửi | updated |
| 2026-10-17 | tasks.md | Ghi câu 7/approval invalidation theo tổng mới, RTM 29 AC | Gộp cashback trước đợt, kiểm race sync/approve/send theo version | updated |
| 2026-10-17 | tasks.md | Câu 8 chốt cutoff 23:00 UTC/manifest bền vững, RTM 30 AC | Kiểm nguồn mới trước/sau cutoff, worker trễ/replay và correction trước gửi | updated |
| 2026-10-17 | tasks.md | Câu 9 deferred retry/slot guard, RTM 31 AC | Kiểm job backoff/RETRY không gửi lại trước đợt ngày sau, UNKNOWN không tự retry | updated |
| 2026-10-17 | tasks.md | Bổ sung 42.0b đánh giá full-spec, gate #34–35 trước 42.2, cutover 42.3a–e và RTM 24 AC/GWT chưa chạy | Nhận phản biện review: quyết định mở không phải lỗi bỏ sót, cần recovery/cutover/truy vết rõ hơn | updated |
| 2026-10-17 | tasks.md | Thêm 42.1p: module chính sách thuần USDT nội bộ + 7 test; 42.2 vẫn chặn bởi #34–35 | Làm phần đã chốt, không phụ thuộc grain/khóa nguồn | added |
| 2026-10-17 | tasks.md | Hoàn thành đặc tả 42.0a nguồn chi chung và async; #33 đã chốt, thêm durable jobs/checkpoint/commands/freshness/recovery vào các bước implementation chưa làm | Đồng bộ Task 42 với yêu cầu tự đồng bộ CustomerPayable sau ingest và dùng cho cả auto/manual | updated |
| 2026-10-17 | tasks.md | Thêm Task 42; hoàn thành bước đặc tả business 42.0, các bước quyết định/schema/API/UI/kiểm chứng vẫn chưa làm | Người dùng yêu cầu spec trước code cho bảng lịch sử khoản phải trả | added |
| 2026-10-14 | tasks.md | Hoàn thành Task 41 theo từng bước: spec, migration/core gates, API/UI; Docker build, 29 web tests, pause integration và sync regression đạt; giữ localhost | Người dùng yêu cầu Pause sync từng sàn | added |
| 2026-10-14 | tasks.md | QA tiếp Task 40: 11 DOM state tests, sửa calculator/lookup/ARIA, rebuild local; web 26 và core lookup 4 tests đạt; lập phương án các nhóm còn mở | Người dùng yêu cầu hoàn tất kiểm tra UI rồi rà phương án triển khai phần khác | updated |
| 2026-10-14 | tasks.md | Review Task 40: hiển thị % share chính xác (`sharePercent`, bỏ lỗi float như 0.57 → 56.99999999999999%), brand lấy từ `site.name`, logo trang chi tiết không đọc trùng tên, xóa stats placeholder và message `home.*` không còn dùng; web typecheck/lint/build và 5 unit test đạt | Clean code sau khi triển khai UI | updated |
| 2026-10-14 | tasks.md | Triển khai 40.1–40.4, chốt calculator #23–24; Docker build/typecheck/lint và 18 tests đạt, giữ localhost để kiểm tra; 40.5 visual QA còn mở | Người dùng yêu cầu triển khai plan và kiểm tra Docker local trước khi tắt | updated |
| 2026-10-14 | tasks.md | Thêm Task 40 Dark Aurora với shell/hero, logo/offer, calculator, lookup và QA; 40.0 tài liệu hoàn thành, code còn unchecked; dependency tách payout, chỉ 40.3 chờ #23–24 | Triển khai theo giao diện đã chốt và không nhầm mockup với UI tích hợp | added |
| 2026-10-13 | tasks.md | Task 39: khung cấu hình ví chi trả và readiness (không gửi giao dịch) | Người dùng yêu cầu dựng khung trước, test giao dịch để sau | added |
| 2026-10-11 | tasks.md | Implement Binance GET-only connector, worker readiness and admin fetched counts; verify on Docker | Operator requested the admin/worker GET flow | added |
| 2026-09-30 | tasks.md | Thêm Task 20.6 connector MEXC Affiliate referral activity | Mở rộng API sync theo kiến trúc hiện có | added |
| 2026-09-15 | tasks.md | Tạo kế hoạch Phase 0–4 (Overview, DAG, Notes); hoàn thành Phase 0: scaffold + boundary lint, Prisma versioned commission/wallet, contracts, test Postgres, seed, public SSR, redirect + click, interim auth, admin content, job queue có lease fencing | Hoàn tất spec và nền tảng | added |
| 2026-09-16 | tasks.md | Chốt UID-first (v2.0): Task 22–26, attribution upsert `UidAccount`, Task 5.6 logo local; hoàn thành 10.1/10.4 và import Bybit CSV v1 | Đồng bộ requirements v0.6 / design v0.7 | added |
| 2026-09-17 | tasks.md | Hoàn thành Task 16, 17, 22–28; re-run integration và backup drill (18/19); thêm Task 27, 28, 29 (deferred) | Đồng bộ tiến độ với code đã test | updated |
| 2026-09-19 | tasks.md | Thêm và hoàn thành Task 30: admin left-nav, tách route | Req 18 | added |
| 2026-09-22 | tasks.md | Thêm và hoàn thành Task 31: chặn RSC admin, giữ lựa chọn offer/exchange, lookup chỉ hiện commission đã attribute | Req 18.5, 10.6, 14.7 | added |
| 2026-09-25 | tasks.md | Thêm Task 10.5–10.9 và 11.1 (ingest chung, MEXC XLSX activity snapshot, data gate); hoàn thành 10.5–10.7. Compact v2.1: bỏ task superseded, gộp changelog theo ngày | Export MEXC thật toàn số 0; doc chỉ giữ trạng thái hiện hành | updated |
| 2026-09-26 | tasks.md | Task 20 Bybit Affiliate API sync: lập và code 20.0–20.4 (adapter framework, drift, metric nhiều asset, connector theo probe thật, lịch 30m/1h/12h/24h, admin controls); 20.5 rollout còn mở | Activity sync không ghi ví; API không có pending/settled | added |
| 2026-09-26 | tasks.md | Task 32 admin IA (Data ingest / Reports): hoàn thành 32.1–32.3 và 32.5 (descriptor adapter, API `/api/admin/ingest/*`, `/api/admin/reports/activity`, alias và redirect route cũ, form upload theo registry, sửa review) | Req 18.2, 18.7, 18.8 | added |
| 2026-09-26 | tasks.md | Task 33 raw landing layer: hoàn thành 33.1–33.5 (`raw_record` partition theo sàn, LOAD → TRANSFORM async, re-transform có audit, retention 30 ngày); deploy web + worker, upload/publish qua route mới | Req 6.23–6.26 | added |
| 2026-09-27 | tasks.md | Mục bắt buộc tuân thủ `.claude/rules/` ở đầu file: test trên stack Docker mô phỏng Railway (`infra/docker-compose.yml`), Railway chỉ để debug/đọc dữ liệu khi được yêu cầu; các bước verify của Task 20.5, 32, 33 chuyển sang Docker | Người dùng đổi chính sách môi trường test | updated |
| 2026-09-27 | tasks.md | Thêm và hoàn thành Task 34: admin nav dropdown cho Data ingest/Reports, link xếp dọc và tự mở nhóm hiện tại; typecheck/lint/build web qua | Req 18.9 và phản hồi về sidebar khó đọc | added |
| 2026-09-27 | tasks.md | Thêm và hoàn thành Task 35: worker ghi readiness, web đọc trạng thái còn hạn, tránh yêu cầu Bybit secret trên web; Docker build/migration/integration qua; probe thật local báo IP_ALLOWLIST_REQUIRED | Req 13.14, sửa lỗi Connector is not ready giả và hiện đúng blocker | added |
| 2026-09-27 | tasks.md | Thêm và hoàn thành Task 36: bỏ cổng chặn key không IP allowlist, giữ cảnh báo/expiry và lỗi Bybit 401/403; Docker build/unit/integration qua, probe key local báo READY với IP `*` | Req 13.12 theo yêu cầu người vận hành | added |
| 2026-09-27 | tasks.md | Thêm và hoàn thành Task 37: mặc định period start/end của Referral activity là hôm nay theo UTC và bỏ ô source timezone của báo cáo; Docker web build qua | Req 18.10 và yêu cầu giảm thao tác lọc báo cáo | added |
| 2026-09-27 | tasks.md | Thêm và hoàn thành Task 38: giải thích trạng thái dữ liệu, làm nổi bật nút lịch và thêm Previous/First cho báo cáo nhiều trang; Docker web build qua | Req 18.11–18.12 và phản hồi về khả năng sử dụng | added |
| 2026-10-21 | tasks.md | Thêm Task 43 triển khai và kiểm chứng các quyết định cuộc họp; đánh dấu Task 40.3–40.4 là bản đầu được thay thế | Truy vết spec/code/test, không tự mở phạm vi sender/cutover hoặc quyết định còn lại | added/updated |
| 2026-10-30 | tasks.md | Chuyển spec từ `.kiro/specs/` sang `docs/specs/`, steering sang `.claude/rules/`; cập nhật đường dẫn và tên agent (Claude/Codex/agy), không đổi nghiệp vụ | Chuyển từ Kiro sang Claude quản lý knowledge | updated |
