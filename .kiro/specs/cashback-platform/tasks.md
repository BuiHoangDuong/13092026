# Implementation Plan — Cashback Affiliate Platform

- **Status:** Draft v2.0 (UID-first re-key: no customer accounts; cashback lookup by
  exchange + UID; email OTP via Resend + UID session; supersedes the Hybrid plan of v1.4)
- **Last updated:** 2026-09-16
- **Derives from:** `requirements.md` (Draft v0.6), `design.md` (Draft v0.7)

## Overview

This plan sequences the build into phases. Tasks are incremental coding steps; each
references the requirement acceptance criteria it fulfills and the design sections it
implements. `[PENDING]` markers block only their own task, not the whole plan.

**Reference convention:** `Requirements: N.M` cites EARS criteria in `requirements.md`.
`Open decision #N` cites a numbered row in `requirements.md` → "Open decisions"
(a stakeholder answer), not Requirement N.

- **Phase 0** — Foundation & smoke: monorepo, DB, contracts, local + Railway skeleton,
  public site, redirect, interim auth, admin content. Runs on seed data.
- **Phase 1** — Import pipeline (versioned), UID linking, attribution + cashback.
- **Phase 2** — Wallet (reserved) & withdrawals.
- **Phase 3** — Hardening: security, targeted tests, production observability/backups.
- **Phase 4** — Deferred: scheduled API sync and optional SSE (do not start until
  confirmed).

### Current status (2026-09-16)

Phase 0 foundation is implemented and was **verified end to end against a real, hosted
Postgres** (Railway test DB, no local Docker) — see Tasks 4.3–4.5. `pnpm build`, `pnpm typecheck`,
`pnpm lint`, Prisma schema validation, migrate, seed, and a live smoke pass (public pages,
`/api/exchanges`, `/go/:linkId` redirect + real `ClickEvent`) all passed at that time.

**v2.0 note:** that historical smoke run also exercised `/api/auth/register` against a real
`Customer`/`Session` row. Both are removed in v0.6/v0.7 (Req 3, 5) — `Customer` no longer
exists in the schema. Re-verification of the smoke path is required once Task 22 (re-key)
lands, and it will exercise `UidAccount`/`EmailOtp`/`UidSession` instead.

Done: monorepo scaffold + import-boundary lint, Prisma schema + migrations (incl. the partial unique index),
idempotent seed with guides, shared contracts, local/Railway infra skeleton, root `.env` loading, SIT wired to a Railway test Postgres and
verified live, public SSR pages + `GET /api/exchanges`, referral redirect with `after()`-based
click recording, interim auth behind `AuthPort`, admin content services/API/forms, and the job-queue foundation
(claim/lease/reaper/retry).

Task 5.5 (English-only enforcement) is done — see Phase 0 additions above.

**Access model (superseded 2026-09-16, now UID-first):** the earlier Hybrid plan (anonymous
boolean lookup + customer account + admin ownership approval, Tasks 14.3a/14.3b below) is
replaced. There is no customer account. A visitor enters exchange + UID and sees real
`pending`/`available` amounts (Req 14). Withdrawal requires binding an email via a 6-digit
OTP sent through **Resend**, which opens a 30-minute session scoped to one UID account
(Req 15, 16). A UID's first withdrawal always goes to admin review (Req 9.5). See
design.md "Superseded" and requirements.md "Accepted risk — first claimant wins" for why,
and what protection remains.

Open next: **Task 22 (re-key to `UidAccount`)** must land before anything else in Phase 2 —
it removes `Customer`/`UidLink`, so Tasks 14.3a/14.3b as originally written no longer apply
(struck through below, replaced by Tasks 23–26). Then: Task 23 (lookup by exchange + UID),
Task 24 (OTP + UID session via Resend), Task 25 (withdrawal — genuinely 0% today, since
`Withdrawal`/`WithdrawalEvent` are Prisma declarations with no service or route behind
them), Task 26 (cherry-pick UI components from the reference `cashback/` folder).

Still open elsewhere: native Bybit export column mapping and Open decision #11 (`dedupKey`)
need a real exchange report sample.

**Note on local hosting:** the verified smoke run used `web` on the local host via `pnpm dev`
and a dedicated Railway **test** Postgres reached over its public/proxy host; no local Docker
database and no mocked/in-memory data layer were used. The local dev server was stopped after
verification. Seed data is fictitious, while reads/writes use the production-identical Prisma
schema, migrations, and `core`/`db` services. `infra/docker-compose.yml` remains an optional
contributor convenience rather than the active SIT database workflow.

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
  T11 --> T22[22 Re-key to UidAccount]
  T13 --> T22
  T22 --> T13[13 Attribution + cashback]
  T13 --> T14[14 Wallet + hold release]
  T22 --> T23[23 Cashback lookup by exchange+UID]
  T14 --> T23
  T22 --> T24[24 Email OTP + UID session via Resend]
  T23 --> T24
  T14 --> T25[25 Withdrawal flow - reserved]
  T24 --> T25
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
  T11 --> T20[20 Scheduled API sync - deferred]
  T13 --> T20
  T16 --> T21[21 Optional SSE - deferred]
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
    { "wave": 7, "tasks": ["22"] },
    { "wave": 8, "tasks": ["13"] },
    { "wave": 9, "tasks": ["14"] },
    { "wave": 10, "tasks": ["23"] },
    { "wave": 11, "tasks": ["24"] },
    { "wave": 12, "tasks": ["25"] },
    { "wave": 13, "tasks": ["26", "16", "17", "18"] },
    { "wave": 14, "tasks": ["19"] },
    { "wave": 15, "tasks": ["20", "21"], "deferred": true }
  ]
}
```

> Tasks 12 and 14.3a/14.3b from the earlier Hybrid plan are struck through below (not
> deleted, per spec governance) and replaced by Tasks 22–26. Task 13's body is amended
> in place because rewriting `attributionService` against `UidAccount` is a small, local
> change to already-shipped code, not a new task.

## Tasks

### Phase 0 — Foundation & smoke (seed data, no real affiliate data)

- [x] 1. Scaffold the monorepo
  - [x] 1.1 Initialize pnpm workspace + Turborepo with `apps/web`, `apps/worker`, `packages/contracts`, `packages/core`, `packages/db`; configure `build`, `lint`, `typecheck`, `test`, `dev`, `db:migrate` pipelines and shared tsconfig/eslint.
    - _Requirements: technical constraints §4; Design: Architecture/Repository layout_
  - [x] 1.2 Add import-boundary enforcement (e.g. `eslint-plugin-import-x`/`boundaries` rules): browser/client code may import only `contracts`; `web`/`worker` may import `core`/`db`/`contracts`; `contracts` stays dependency-free.
    - ESLint now detects `"use client"` modules anywhere under `apps/web/src` and rejects `core`/`db` imports; package rules keep `contracts` independent and prevent `db` from depending on upper layers. A negative probe confirmed the client rule fails lint.
    - _Requirements: technical constraints §4; Design: Architecture/Repository layout_

- [x] 2. Set up the database package
  - [x] 2.1 Add Prisma to `packages/db` with the schema from the design, including versioned commission, interim auth, and payout audit: Exchange (with `defaultCashbackRate`), Offer, ReferralLink (with `offerId`), Guide (with `exchange` relation), ClickEvent, AdminAccount (with `passwordHash`), Customer (with `passwordHash`), Session, UidLink (with `referralLinkId`, `flaggedForReview`), ImportBatch, StagingRow, CommissionRecord (identity: `reconciledAmount`, `activeVersion` FK, snapshot `offerId`/`cashbackRate`, `creditedCashback`), CommissionVersion, Wallet (pending/available/reserved/withdrawn/receivable), WalletEntry (with `opKey`), Withdrawal, WithdrawalEvent, Job, and all enums (incl. `PrincipalType`, `CLAWBACK` entry type, `CANCELLED` status).
    - Money as `Decimal`, UID as `String`, timestamps UTC. Unique: `CommissionRecord(exchangeId,dedupKey)`, `CommissionVersion(commissionId,batchId)`, `Wallet(customerId,asset)`, `WalletEntry.opKey`, `Session.tokenHash`. Do NOT put a full unique on `UidLink(exchangeId,uid)`. Interim auth fields (passwordHash/Session) are replaceable if a managed provider is chosen.
    - _Requirements: 3.5, 5.3, 6.7, 6.9, 7.4, 7.6, 7.8, 8.1, 8.7, 9.8; Design: Data Models, Auth_
  - [x] 2.2 Generate the initial migration, and add a raw-SQL PARTIAL unique index for UID ownership: `CREATE UNIQUE INDEX uidlink_verified_owner ON "UidLink"("exchangeId","uid") WHERE status = 'VERIFIED';`. Add repository/query helpers.
    - _Requirements: 5.3, 6.5; Design: Data Models, Key flows/UID_
  - [x] 2.3 Add a seed script (sample exchanges with default rates, offers, links bound to offers, guides, one admin) for the smoke phase.
    - Offers/links use optional unique seed keys so admin-created rows remain unconstrained; the seed adopts the original legacy rows, upserts three published guides, and is idempotent.
    - _Requirements: 1.1; Design: Testing Strategy_

- [x] 3. Define shared contracts
  - Add zod schemas + types in `packages/contracts` for public content, click, auth, wallet (incl. reserved), uid-link, withdrawal, and admin import/analytics/sync payloads.
  - Define the error envelope `{ error: { code, message, details? } }` and a decimal-string money type with `asset`.
  - _Requirements: 3.3, 7.4, 8.1; Design: Components/API contracts_

- [x] 4. Local/SIT infra + Railway skeleton (dual-track from day one)
  - [x] 4.1 Add `infra/docker-compose.yml` for Postgres and private object storage (e.g. MinIO or local dir) and `.env.example` with `DATABASE_URL`, `APP_URL`, `IMPORT_STORAGE_*`, `WORKER_POLL_SECONDS`, `HOLDING_PERIOD_HOURS`, `WITHDRAWAL_AUTO_APPROVE_THRESHOLD`, `JOB_LEASE_SECONDS`, `SYNC_INTERVAL_MINUTES` (disabled).
    - _Requirements: 6.5; Design: Environments & deployment_
  - [x] 4.2 Stand up the Railway skeleton in parallel: web + worker services + managed Postgres, build pipeline, run migrations, and a health check on each service. Keep both local and Railway green.
    - Config + `/api/health` are in place. The verified application smoke was a local web process using Railway test Postgres; deploying the web/worker processes on Railway remains part of production hardening rather than this smoke result.
    - _Requirements: 6.5; Design: Environments & deployment_
  - [x] 4.3 Stand up SIT against a hosted Railway test Postgres (no local Docker) and verify it end to end.
    - **Decision:** SIT does not use local Docker for the database. App processes (`web`, `worker`) run on the host via `pnpm dev`; the database is a dedicated Railway **test** Postgres (separate from prod), reached over its public/proxy host — `*.internal` only resolves inside Railway's network. Object storage stays deferred (local-dir adapter) until Task 10 needs a real bucket. `infra/docker-compose.yml` remains only as an optional convenience for contributors who prefer containers.
    - Verified live against the Railway test DB: `prisma migrate deploy` applied the 1 existing migration (19 tables incl. `_prisma_migrations`, plus the partial unique index `uidlink_verified_owner` — confirmed present via `pg_indexes`); `pnpm db:seed` created 3 exchanges/3 offers/3 referral links/1 admin (`guide` count is legitimately 0 — no guide seed rows exist yet, tracked below); `pnpm --filter @cashback/web dev` served `/api/health` (200), `/api/exchanges` (200, slugs binance/bybit/mexc), `/`, `/exchanges`, `/exchanges/binance`, `/guides` (all 200); `/go/:linkId` returned 302 to the real destination and incremented `ClickEvent` count 0→1 (via `after()`); an unknown `/go/:id` fell back to `/exchanges` (no open redirect); `POST /api/auth/register` created a real `Customer` + `Session` row. All reads/writes went through Prisma against Postgres — no mocks or in-memory fakes.
    - Gaps found during this historical run: (a) root env loading and (b) seed correctness were subsequently resolved and verified in Tasks 4.4/4.5. (c) Prisma CLI (`migrate deploy`/`migrate status`) output was truncated by the earlier Windows shell setup; the current wrapper emits complete migration output, and DB state was also verified through direct Postgres queries.
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
    - Closes the earlier follow-up where `middleware.ts` hard-coded the `"vi"` prefix instead of reading the registry.
    - Verified: `pnpm --filter @cashback/web build` (tsc/eslint via Next's build step) compiles, typechecks, and lints clean; production build emits 13/13 static routes with no `/vi*` route in the output.
    - _Requirements: 4.1, 4.3, 4.5, 10.5; Design: Components/Language & i18n_
  - [-] 5.6 Exchange logo images on offer tiles (local repo assets, no external URLs)
    - Added the nullable Prisma field and migration `202609160001_exchange_logo_url/migration.sql`; the prior in-flight changes described below were absent from the checkout.
    - [x] 5.6.1 Finish the in-flight `core` change. `PublicExchange` and `PublicOfferCard` in `packages/core/src/services/content.ts` already declare `logoUrl: string | null`, but the three mapping sites were left unchanged, so the package currently fails typecheck. Add `logoUrl: row.logoUrl ?? null` to the object returned from `listPublishedExchanges`, the same to `getPublishedExchange`, and `logoUrl: exchange.logoUrl` to the `exchange` object built inside `toOfferCard`.
      - _Requirements: 1.1, 1.2, 1.5; Design: Data Models, core services_
    - [x] 5.6.2 Remove `logoUrl` from `adminExchangeCreateSchema` in `packages/contracts/src/index.ts` (it was added during an earlier URL-based attempt). The admin form does not author logos, so the field would be dead API surface. Keep `logoUrl` on `exchangeSchema`, which describes the `GET /api/exchanges` response and now legitimately includes it.
      - _Requirements: 10.2; Design: Open design decisions (admin-managed logos = [PENDING])_
      - Verified the admin create/update schemas already exclude `logoUrl`; the public response schema now accepts only local `/exchange-logos/<slug>.png` paths or null.
    - [x] 5.6.3 Create `apps/web/public/exchange-logos/` and add the three real exchange logos as `binance.png`, `mexc.png`, `bybit.png`, preferring each exchange's official brand/press asset. Note that `web_fetch` cannot retrieve binary images — download via `curl -L -o` or `Invoke-WebRequest`, then verify each file is a non-empty, valid PNG. If a source is unreachable, generate a simple local placeholder image rather than falling back to a remote URL. Nothing in `.gitignore` excludes this folder, so the files commit normally.
      - _Requirements: 1.1; Design: Components/apps/web (Exchange logo assets)_
      - Review follow-up: all three assets now use transparent horizontal wordmarks in a shared centered box on the dark `bg-card` surface; asset provenance moved to `apps/web/docs/exchange-logos.md` outside `public/`.
    - [x] 5.6.4 Render the logo in `OfferCard` in `apps/web/src/components/public-pages.tsx`: when `card.exchange.logoUrl` is set, show the image with `next/image` (`fill` + `object-contain` + `sizes`, padded inside the existing `aspect-square` tile) in place of the centered name text; when it is `null`, keep the current `tileHue` gradient + name placeholder unchanged. Use `alt=""` (decorative) because the wrapping `<Link>` already exposes the exchange name via the `<p>` beneath the tile, so a filled `alt` would be announced twice.
      - _Requirements: 1.1, 1.2; Design: Components/apps/web (Exchange logo assets)_
    - [x] 5.6.5 Set `logoUrl` for the three seeded exchanges in `packages/db/prisma/seed.ts` (`/exchange-logos/<slug>.png`), adding it to BOTH the `create` and `update` halves of the `exchange.upsert` so a re-seed backfills the existing rows.
      - _Requirements: 1.1; Design: Testing Strategy_
    - [ ] 5.6.6 Verify locally, then deploy in the right order. Run `corepack pnpm --filter @cashback/web... build`, which also re-runs `prisma generate` so the Prisma client picks up the new column. Deploy order matters: push first so the built image contains both migration `202609160001_exchange_logo_url` and the logo files, then apply the migration and re-seed inside the deployed container (`railway ssh -s "@cashback/web" -- sh -c "cd packages/db && npx prisma migrate deploy"`, then the seed command), and confirm the tiles show real logos. The home route is dynamic (`ƒ /` in the build output), so no extra redeploy is needed after re-seeding. The `check-railway-deploy` skill has the SSH key setup, migration, and seed details.
      - Local verification (2026-09-16): `corepack pnpm --filter @cashback/web... build` and `lint` passed. All three PNGs decoded successfully. Production-server smoke with a fixture DB passed for home/catalog logo rendering, null-logo fallback, service/API mapping, and local/optimized image HTTP responses. No database writes were performed.
      - Deployment remains pending: push the build/assets/migration, then migrate and re-seed in Railway and verify the live tiles. Task 5.6.6 remains unchecked until this is done.
      - _Requirements: 1.1, 6.5; Design: Environments & deployment_

- [x] 6. Referral redirect + reliable click tracking
  - Implement `clickService.recordClick` and `GET /go/[linkId]`: resolve active link, return 302, and record the click via a reliable best-effort mechanism (Next.js `after()`/`waitUntil` post-response task, or a short-timeout awaited insert) — not an unawaited/dropped promise. Recording failure still redirects; never wait on sync; unknown/inactive → safe fallback, no open redirect.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5; Design: Key flows, Components/apps/web_

- [x] 7. Auth port + interim auth
  - [x] 7.1 Define `AuthPort` in `core` (`getSession`, `requireCustomer`, `requireAdmin`) with distinct customer/admin principals.
    - **Amended by Task 22 (v0.6):** `requireCustomer` and the customer principal are
      removed — end-user identity is a `UidSession` (Task 24), resolved by
      `uidSessionService`, not `AuthPort`. `getSession`/`requireAdmin` are unchanged.
    - _Requirements: 3.2, 3.3, 3.4; Design: Components/Auth_
  - [x] 7.2 Implement the interim auth provider behind the port (email+password with hashed `passwordHash` and a `Session` table of hashed tokens + expiry) and customer register/login/logout routes; server-side authz on all guarded routes. These interim tables are replaceable if a managed provider (open decision #13) is chosen without touching route handlers.
    - **Amended by Task 22:** customer register/login/logout routes are deleted; `Session`
      becomes admin-only (`adminId` FK). Admin login/logout is unaffected.
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
  - [x] 8.5 Fix admin content defects found in review of 8.2–8.4 (ordered by impact):
    - **(a) Foreign-key errors surface as 500.** `write()` in `content.ts` maps only Prisma `P2025`→404 and `P2002`→409. A non-existent `exchangeId` on offer/guide create or update raises `P2003` (foreign key constraint), which falls through to `INTERNAL_ERROR` 500 and logs a stack trace — a client mistake reported as a server fault. Map `P2003` to a domain error returning 400 (or 404) alongside the existing cases.
    - **(b) Same-exchange invariant is check-then-write.** `assertOfferExchange` (link create/update) and the incompatible-link probe in `updateOffer` run as separate round-trips outside a transaction, so two concurrent admin writes can each pass their own check and still commit a state where `ReferralLink.exchangeId ≠ Offer.exchangeId`. This invariant feeds cashback rate resolution, so prefer a structural guarantee: add `@@unique([id, exchangeId])` on `Offer` and make `ReferralLink`'s offer relation composite on `(offerId, exchangeId) → Offer(id, exchangeId)`, which makes the violation unrepresentable. Otherwise wrap check + write in `db.$transaction` with row locking. Guards Correctness Property 13 / Req 7.3.
    - **(c) Minor:** every admin `GET` calls `listAdminContent()`, which queries all four entities and discards three, so one admin page load costs ~16 queries instead of 4 (noticeable against a remote Postgres) — split into per-entity reads or expose one aggregate endpoint; admin lists are unpaginated; an *authenticated* non-admin principal receives 401 where 403 is more accurate; and `ExchangeSelect` emits two `value=""` options when `optional` is set.
    - Note: stale `vi` keys remain in `Exchange.i18n`/`Guide.i18n` rows from pre-5.5 seeds. They are inert (the registry only resolves `en`) and the next seed run overwrites `i18n`, so no migration is needed.
    - Completed: Prisma error codes are mapped without cross-package `instanceof`; migration `202609150003_offer_link_exchange_invariant` adds a composite FK `(offerId, exchangeId) → Offer(id, exchangeId)`; admin reads use per-entity cursor-paginated queries with UI load-more; auth distinguishes 401/403; and optional exchange selects have one empty option. Verified on Railway test Postgres: direct mismatched write blocked with P2003 and unchanged data, invalid FK API returned 400, customer session returned 403, and cursor pages were distinct.
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

- [-] 10. Report import: upload → parse → preview
  - [x] 10.1 Implement `POST /api/admin/imports`: authz, file type/size check, store original in private storage, create `ImportBatch` + PARSE job, return 202 + batchId (no in-request parsing).
    - Bybit MVP accepts normalized CSV v1 (bounded by `IMPORT_MAX_BYTES` and 10 MiB), stores the original privately as database bytes, and creates the batch/job atomically. This replaces container-local storage for new uploads so separate Railway web/worker services share durable input. Unsupported exchange/XLSX uploads return a clear validation error.
    - _Requirements: 6.1, 6.2; Design: Key flows/import_
  - [-] 10.2 Implement `parserRegistry` + a first CSV/XLSX adapter interface distinguishing TRANSACTION vs AGGREGATE reports; no formula/macro execution; fall back to aggregate when transaction identity keys are missing.
    - Done: `parserRegistry.bybit`, strict normalized CSV v1, transaction/aggregate identity, opaque UID and decimal parsing, no formula execution. Pending: native Bybit export mapping (needs a real sample), XLSX adapter. See `apps/web/docs/bybit-cashback.md`.
    - _Requirements: 6.4, 6.10, 6.11; Design: Components/core services_
  - [x] 10.3 Implement PARSE job: normalize (UID string, UTC timestamps + source tz, decimals), flag error/duplicate/unmapped/conflict rows into `StagingRow`, compute totals, set batch to PREVIEW.
    - Implemented for Bybit CSV v1 / UTC: invalid/duplicate/conflicting rows block publish; per-currency totals and unmapped-UID counts appear in preview. Unknown headers or malformed files produce FAILED with an actionable error.
    - _Requirements: 6.3; Design: Key flows/import_
  - [x] 10.4 Implement `GET /api/admin/imports/:id` returning status, preview counts, error rows, reconciliation info.
    - Admin-only endpoint returns batch lifecycle/source fields, totals, total/flagged row counts, and up to 100 flagged preview rows under private/no-store caching. Live probe returned 200 for the newly uploaded `UPLOADED` batch with zero rows before parsing.
    - _Requirements: 6.6; Design: Components/API contracts_

- [x] 11. Report commit: versioned publish (idempotent + atomic)
  - Implement `POST /api/admin/imports/:id/commit` (creates PUBLISH job) and the PUBLISH job in `commissionService`: per row, upsert the `CommissionRecord` identity by `(exchangeId, dedupKey)`, upsert a `CommissionVersion` keyed by the unique `(commissionId, batchId)`, mark prior version superseded, set `activeVersion`, and recompute `reconciledAmount` (default rule: latest version supersedes). Commit the whole batch atomically, then enqueue ATTRIBUTE.
  - Re-committing the same batch, or two publish workers racing the same batch, upserts the same version and changes no reconciled amount; a mid-failure leaves no partial published data.
  - _Requirements: 6.7, 6.8, 6.9, 7.5, 7.8; Design: Key flows/import, Data Models, Correctness Properties 1, 7, 9_
  - Bybit normalized v1 dedup keys are defined in `bybit-parser.ts` (root + transaction ID + asset, or root + UID + asset + exact UTC period). Partial overlaps and older reports are rejected; corrections use the original identity. Native export identity mapping still needs a real sample.

- [x] 12. UID linking + verification (Bybit MVP)~~ **SUPERSEDED by Task 22 (v0.6/v0.7)**
  - ~~12.1 `POST/GET /api/me/uids`, `UidLink(PENDING_VERIFICATION)`.~~ Removed: there is no
    customer to link a UID to. A `UidAccount` is created directly by attribution (Task 22).
  - ~~12.2 Admin-approved ownership verification via `ownershipApprovedAt` + partial unique
    index.~~ Removed: the operator accepted first-claimant-wins instead (Open decision #21).
    The code this task shipped (`createUidLink`, `approveUidOwnership`,
    `verifyApprovedUids`, the UID-review UI in `bybit-operations.tsx`) is deleted by Task 22,
    not migrated — there is nothing in the new model for it to do.
  - Kept here, struck through, per spec governance (§4): the requirement numbers this task
    cited (5.1–5.6) no longer exist in this form; see Requirement 5 in requirements.md v0.6.

- [x] 13. Attribution + cashback engine (rate resolution + delta, concurrency-safe)
  - Implement `attributionService` + `cashbackEngine`: serialize publish/attribution/ledger writes with a transaction-scoped Postgres advisory lock for the low-volume MVP; resolve the rate by precedence (offer of the reported referral link **only when corroborated by system-verified report data**, else exchange default), assert `ReferralLink.exchangeId = Offer.exchangeId = commission.exchangeId` (else fall back to default), and snapshot `offerId`/`cashbackRate` onto the record; compute `target = reconciledAmount × rate` and apply only `delta = target − creditedCashback` — positive delta offsets any `receivable` then CREDITs `pending` (with `availableAt`), negative delta reduces `pending` then `available` then records the remainder as `receivable` via CLAWBACK. Write every wallet movement with a unique `opKey` (e.g. `attr:{commissionVersionId}`) so retries/racing workers cannot double-apply; update `creditedCashback`.
  - **Amended by Task 22 (v0.6/v0.7):** attribution no longer looks up a `UidLink`. It
    upserts a `UidAccount` by `(exchangeId, uid)` unconditionally — cashback accrues with
    no claimant action, no email, no session (Req 5.3, 5.5; Property 4). This is a small
    change to the existing transaction (replace the `UidLink` lookup with a `UidAccount`
    upsert); the rate resolution, delta math, and `opKey` idempotency are unchanged.
  - _Requirements: 5.3, 7.1, 7.2, 7.3, 7.4, 7.7, 7.8, 8.2, 8.4, 8.7; Design: Key flows/UID accounts, Key flows/attribution, Cashback engine, Correctness Properties 2, 3, 4, 11, 12, 13_

- [x] 22. Re-key identity from `Customer`/`UidLink` to `UidAccount` (UID-first migration)
  - **This must land before Tasks 23–26.** It is the structural change the rest of Phase 2
    depends on; Task 13's attribution amendment above is part of this task's scope.
  - **Verified:** migration on an empty isolated schema and populated legacy fixture;
    balances, pending lots, audit and admin session preserved; ambiguous allocation
    rejects atomically. Rewritten Bybit integration passes credit/release idempotency,
    rate snapshots, corrections/receivable offset, overlap rejection, atomic publish
    rollback and lease fencing. Build, lint and parser tests pass.
  - **Schema:** drop `Customer` and `UidLink` (and the partial unique index
    `uidlink_verified_owner`); add `UidAccount` (`@@unique([exchangeId, uid])`),
    `EmailOtp`, `UidSession`, `RateLimitCounter`; change `Session` to admin-only
    (`adminId` FK, drop `principalType`/`subjectId`); re-point `Wallet.customerId` →
    `Wallet.uidAccountId`, `Withdrawal.customerId` → `Withdrawal.uidAccountId` (+ new
    `email`, `isFirst` columns), `CommissionRecord.attributedCustomerId` →
    `attributedUidAccountId`; drop `PrincipalType`, `UidLinkStatus` enums; change
    `ActorType.CUSTOMER` → `ActorType.CLAIMANT`.
  - **Core:** rewrite `packages/core/src/services/cashback.ts` — delete `createUidLink`,
    `approveUidOwnership`, `listPendingUidLinks`, `verifyApprovedUids`; replace with a
    `upsertUidAccount(exchangeId, uid)` used by attribution (Task 13's amendment).
    `getWallet`/`listUidLinks`-equivalent reads move to Task 23/25's services.
  - **Web:** delete `apps/web/src/app/login/*`, `/api/auth/{register,login,logout}` (keep
    only the admin variants under `/api/admin/auth/*`), `apps/web/src/lib/customer-api.ts`,
    `apps/web/src/app/api/me/*`, `apps/web/src/components/cashback-panel.tsx` +
    `cashback-dashboard.tsx`, and the UID-ownership-review block in
    `apps/web/src/app/admin/bybit-operations.tsx`.
  - **Tests:** `scripts/test-bybit-integration.mjs` currently creates `Customer` rows,
    calls `core.createUidLink`/`core.approveUidOwnership`, and asserts against
    `/api/me/wallet`/`/api/me/uids` with a session cookie from `core.createSession`. All of
    that must be rewritten against `UidAccount` (attribution creates it directly) before
    this task can be marked done — it is the project's only end-to-end proof that money
    logic works, so it cannot be left broken partway through the migration.
  - Verify: `pnpm typecheck`/`build` clean with `Customer`/`UidLink` gone from the
    codebase (a lingering reference is a build error, not a lint warning); the rewritten
    integration test's existing assertions (idempotent credit, corrections/receivable
    offset, overlap rejection, lease fencing) still pass against `UidAccount`.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6; Design: Key flows/UID accounts, Data Models (`UidAccount`), Correctness Properties 3, 4_

### Phase 2 — Lookup, wallet, withdrawals

- [-] 14. Wallet balances + hold release
  - [x] 14.1 Implement `walletService` and a wallet read returning balances, typed movement history, last sync/import time, source as-of; distinguish "no data" from zero.
    - **Amended by Task 22:** the read moves from `GET /api/me/wallet` (session-scoped
      customer) to `GET /api/uid/wallet` (session-scoped `UidAccount`, Task 24). The
      balance/history logic itself (`walletService` internals) is unchanged.
    - _Requirements: 8.1, 8.5, 8.6; Design: Cashback engine, Data Models_
  - [x] 14.2 Implement `RELEASE_HOLDS` job (scheduler tick) moving cleared CREDITs `pending→available`; implement the reversal policy (reduce `pending` then `available`, remainder to `receivable` via CLAWBACK) so no balance goes negative, and expose `receivable` in the wallet.
    - _Requirements: 8.3, 8.4, 8.7; Design: Key flows/attribution, Cashback engine, Correctness Properties 5, 12_
  - [x] 14.3 Customer experience: sign-in/register form, private "Your cashback" panel...~~
    **SUPERSEDED by Task 22.** What landed here (`login-form.tsx`, `cashback-panel.tsx`,
    `cashback-dashboard.tsx`, the UID-link form, admin ownership-review UI in
    `bybit-operations.tsx`) is deleted, not migrated — v0.6/v0.7 has no customer session to
    build a panel around. Kept struck through per spec governance (§4).
  - [x] 14.3a Anonymous quick-lookup widget (boolean, Requirement 1.6–1.8)
    **SUPERSEDED by Task 23.** The Hybrid design (boolean-only response, register CTA) is
    replaced by a lookup that returns real `pending`/`available` amounts with no account
    step. `LookupAttempt` is renamed/generalized to `RateLimitCounter` (Task 22).
  - [x] 14.3b Account UX gaps (username, `/me/uids` route, no-reset-password notice)
    **SUPERSEDED.** There is no username, no `/me/uids`, no sign-in screen — see Task 22
    for the removal and Task 25 for the withdrawal UI that replaces this scope.
  - Verification: parser/money unit tests and isolated PostgreSQL integration cover migration, idempotent import/credit/release, frozen rates, corrections/receivable offset, overlap rejection, and expired-owner rollback. Deployment/live Bybit data validation remain outside these completed code tasks. Account-isolation checks specifically (Customer A cannot read Customer B) are superseded by Task 25's UID-session isolation checks.

- [x] 23. Cashback lookup by exchange + UID (Requirement 14)
  - **Verified:** isolated HTTP test checks strict amount-only response, private cache,
    missing-input rejection before database access, IP budget/429/Retry-After,
    no account/wallet/OTP/session writes, real-zero distinction and home placement.
    Production requires a valid IP header overwritten by trusted ingress.
  - Add `lookupService` in `core`: consume the per-IP budget first (`RateLimitCounter`,
    scope `lookup:ip`), then read the `UidAccount`'s wallets for `(exchangeId, uid)` and
    return `pending`/`available` per asset plus `lastImportAt`/`sourceAsOf`. Read-only — it
    MUST NOT create a `UidAccount`, `Wallet`, or any session (Req 14.4, 14.5).
  - Reject a request missing either `exchangeId` or `uid` before querying anything —
    a UID without an exchange is never resolved (Req 14.1).
  - Add `POST /api/lookup` returning the balances above and nothing else: no bound email
    (in any form), payout address, withdrawal record, movement history, or
    `reserved`/`withdrawn`/`receivable` (Req 14.3). Over budget → 429 + `Retry-After`
    without querying the wallet. Unknown UID and known-zero-balance UID use the same
    response shape with an explicit `hasData` flag (Req 14.6, mirrors Req 8.5's "no data"
    vs zero distinction). Response `Cache-Control: private, no-store`.
    - Add the lookup form on the home page above the offer grid: exchange select + UID
    input, rendering balances inline on success. Extract all new copy into
    `apps/web/src/i18n/messages/en.ts` (Req 4.2).
  - Verify: funded UID → response contains exactly `pending`/`available`/freshness, and a
    test asserts the response body contains none of `email`, `address`, `reserved`,
    `withdrawn`, `receivable`, or a history array; missing `uid` or `exchangeId` → 400
    without a query; N+1 requests from one IP within the window → 429; row counts for
    `UidAccount`/`Wallet` unchanged after a lookup.
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6; Design: Key flows/Cashback lookup by exchange + UID, core services (`lookupService`), Data Models (`RateLimitCounter`), Correctness Properties 14, 15_

- [x] 24. Email OTP binding & UID session via Resend (Requirement 15, 16)
  - **Verified:** isolated Next HTTP + core tests cover hashed/single-use OTP,
    binding, mismatched-email rejection, cooldown/day cap, five failed guesses,
    expiry, failed provider acceptance and 30-minute UID-session isolation from
    other UID scopes/admin sessions. Captured output contains no plaintext OTP.
    Real Resend credentials and verified sender domain remain deployment setup.
  - Add the `resend` package and `emailPort` interface (`sendOtp`); implement
    `resendEmailAdapter` calling it. `EMAIL_FROM` must be on a Resend-**verified** domain —
    the shared `resend.dev` testing domain only delivers to the account owner, so it cannot
    reach a real claimant (Req 16.2).
  - Add `otpService`: generate a 6-digit code with `crypto.randomInt(100000, 1_000_000)`,
    hash it with the `bcryptjs` already used for admin credentials, store `EmailOtp`
    (`expiresAt` = now + `OTP_TTL_MINUTES`, proposed 5). Send order: check per-UID cooldown
    + daily cap (`RateLimitCounter` scope `otp:uid`) and per-IP limit (scope `otp:ip`) →
    if `UidAccount.boundEmail` is set, target only it (mismatched submission is rejected
    *without* sending anywhere and *without* revealing the bound address, Req 15.2) → call
    `emailPort.sendOtp` → record `providerAccepted`/`providerMessageId`. If Resend errors or
    times out, do not mark the OTP sent and return a retryable error (Req 16.3).
  - Add `POST /api/otp/verify`: compare the hash, check `expiresAt`/`consumedAt`/
    `failedAttempts` (invalidate at `OTP_MAX_ATTEMPTS`, proposed 5, Req 15.5), consume the
    OTP, bind the email if unbound, issue a `UidSession` (hashed token, 30-minute expiry)
    scoped to exactly that `UidAccount` (Req 15.3).
  - Add `uidSessionService`: every `/api/uid/*` handler resolves its principal through this
    service from the session cookie, never from a request parameter (Req 15.10); an
    expired session or one presented against a different UID is rejected (Req 15.11).
  - Verify: OTP plaintext never appears in a log line or API response body (grep the test
    output, don't just assert the field is absent); 5 wrong guesses invalidate the code
    even before the TTL elapses; a UID session for account A returns 401/403 against
    account B's wallet; resending before the cooldown elapses is rejected; a simulated
    Resend failure leaves the `EmailOtp` row unmarked-as-sent.
  - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.10, 15.11, 16.1, 16.2, 16.3, 16.4, 16.5, 16.6; Design: Key flows/Email OTP binding & UID session, core services (`otpService`, `uidSessionService`, `emailPort`), Data Models (`EmailOtp`, `UidSession`), Correctness Properties 16, 17_

- [x] 25. Withdrawal flow (reserved balance + mandatory first-review + cancel + event audit)
  - **Implemented and verified.** Service, API routes, core UI, env documentation, and
    isolated PostgreSQL integration coverage are complete. Task 26 supplies the UI upgrade.
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
  - [x] 25.4 `WithdrawalFlow` client component (`apps/web/src/app/withdraw/`): OTP auth → wallet display
    → withdrawal request form → history with per-withdrawal cancel; visible-tab polling; cursor
    pagination on both wallet history and withdrawal history.
  - [x] 25.5 `WithdrawalQueue` admin component + `POST /api/admin/withdrawals/[id]/decision`:
    decision form with note/payoutRef inputs, per-withdrawal action buttons filtered by current status,
    `window.confirm()` guard, cursor pagination.
  - [x] 25.6 i18n strings for all new copy in `apps/web/src/i18n/messages/en.ts`; no inline strings in the components.
  - [x] 25.7 `WithdrawalQueue` wired into admin page; `WithdrawalFlow` accessible at `/withdraw`.
  - [x] 25.8 Document withdrawal env vars in `.env.example`:
    `WITHDRAWAL_ROUTES` (JSON, e.g. `{"USDT":["TRON","ETHEREUM"]}`),
    `WITHDRAWAL_AUTO_APPROVE_THRESHOLDS` (JSON, e.g. `{"USDT":"100.00"}`).
    Already present in `.env.example` with clear comments — confirmed.
  - [x] 25.9 Integration test coverage for the core acceptance criteria:
    first withdrawal → `UNDER_REVIEW` regardless of amount; second (same amount) → `AUTO_APPROVED`;
    two concurrent requests against the same available balance cannot both reserve it; cancel after
    `PAID` is rejected; every transition has a matching `WithdrawalEvent`.
    Added after the lease-fencing checks in `scripts/test-bybit-integration.mjs`. Verified on
    2026-09-17 against a dedicated test database in an isolated `cashback_test_*` schema:
    first-review, second-withdrawal auto-approval, paid-cancel rejection, audit events,
    receivable blocking, and concurrent reservation safety all pass.
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11; Design: Key flows/withdrawal, Data Models, Correctness Properties 6, 10, 12_

- [x] 26. Cherry-pick UI components from the reference project (`cashback/`)
  - The `cashback/` folder (a local, gitignored copy of `satnaing/shadcn-admin`, MIT
    licensed) is a **Vite SPA with no backend** — its OTP form's "verify" handler is a
    `setTimeout` + toast, not a real check. Copy component *files* only; every verify/send
    call in this task is Task 24's real implementation, never the reference project's stub.
  - Copy `src/components/ui/input-otp.tsx` (and the `input-otp` npm dependency) into
    `apps/web/src/components/ui/`; wire it into the OTP-verify step of Task 24's withdrawal
    UI in place of a plain text input.
  - Copy `src/components/data-table/*` (6 files: `bulk-actions`, `column-header`,
    `faceted-filter`, `index`, `pagination`, `toolbar`, `view-options`) into
    `apps/web/src/components/data-table/`; use it for the admin withdrawal queue (Task 25)
    and the admin import-batch list, both currently plain `<ul>`/`<table>` markup.
  - Copy `src/components/confirm-dialog.tsx` for admin approve/reject/mark-paid actions
    (hard-to-reverse operations that currently have no confirmation step).
  - Add the missing `ui/*` primitives actually consumed by the above: `table`, `tabs`,
    `sheet`, `skeleton`, `sonner`, `alert-dialog`, `select`, `checkbox`, `switch`,
    `textarea`, `tooltip`, `popover`, `dropdown-menu`, `alert` — only the ones a copied
    component imports, not the full set speculatively.
  - **Do not copy:** TanStack Router (`routes/`, `routeTree.gen.ts` — conflicts with Next's
    App Router), Clerk (conflicts with `AuthPort` and doesn't model a `UidSession`),
    `vite.config.ts`/`netlify.toml`/`index.html`, or any submit handler from
    `src/features/*` (they're fake — see above). The public site must stay SSR
    (Req 1.1, 1.5); this task's components are for the admin/withdrawal areas only.
  - Verify: `pnpm lint`/`typecheck`/`build` clean after each copied file; the admin
    withdrawal queue paginates via `data-table` instead of loading all rows; approving a
    withdrawal requires confirming a dialog first.
  - **Verified 2026-09-17:** `input-otp` is wired to real Task 24 verification; TanStack
    data-table components drive the withdrawal queue and import-batch list; approve/reject/
    mark-paid use `ConfirmDialog`; only consumed primitives/dependencies were added. Web
    lint, typecheck, and production build pass.
  - _Requirements: none directly (tooling/UX only); Design: Components/apps/web_

- [x] 16. Admin analytics & operations dashboard
  - Implement `GET /api/admin/analytics` (click metrics by link/exchange/time from internal data), `GET /api/admin/accounts/:id/activity` (paginated, per UID/account), and `GET /api/admin/sync-status`; 30s polling when tab visible, 5s while a batch processes; admin/private responses set `Cache-Control: private, no-store`; no secrets/raw reports leaked; views for attributed vs unattributed commission and the withdrawal queue.
  - **Verified 2026-09-17:** all three admin endpoints use the admin guard/private response
    helper; dashboard shows click time/link/exchange aggregates, attribution split, jobs,
    import/source freshness and the withdrawal queue; visible-tab polling is 30 seconds and
    active import polling is 5 seconds. Isolated integration assertions cover analytics,
    sync-status raw-report exclusion, and paginated UID activity. Lint/typecheck/build pass.
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6; Design: Components/apps/web, API contracts_

### Phase 3 — Hardening

- [ ] 17. Security hardening
  - Server-side authz on every non-public route; the acting `UidAccount` derived from the
    `UidSession` only, never a request parameter; private bucket credentials limited to
    web(write)/worker(read); secrets only in env/secret store (no public-prefixed,
    including `RESEND_API_KEY`); Postgres reachable only from web/worker; ensure admin and
    `/api/uid/*` write routes require the matching session type before shipping.
  - _Requirements: 3.3, 6.2, 15.10; Design: Security_

- [-] 18. Lightweight test overview + critical invariant checks
  - Keep testing light: a thin smoke check that the app boots and key paths respond (public browse → get link → redirect records a click; admin login; seed import runs).
  - Add a few sanity checks on money logic (cashback amount, idempotent publish, only `available` is withdrawable) plus targeted integration/concurrency checks: two publish runs racing to attribute the same (exchange, UID) → exactly one `UidAccount` (Property 3); ATTRIBUTE re-run applies no extra credit; publish failing mid-transaction leaves nothing; worker that lost its lease cannot commit; two concurrent withdrawals cannot both reserve the same balance; a UID account's first withdrawal is always `UNDER_REVIEW`. No exhaustive suite.
  - _Requirements: 5.1, 6.8, 6.9, 7.8, 9.1, 9.5; Design: Testing Strategy, Correctness Properties 1-17_

- [ ] 19. Production hardening & observability (Railway)
  - Building on the Phase 0 Railway skeleton (Task 4.2): add observability (web health, oldest job age, worker heartbeat, import error rate), alerts, ensure migrations run once per deploy with reproducible builds, and verify DB backup/restore.
  - _Requirements: 6.5; Design: Environments & deployment_

### Phase 4 — Deferred (do not start until confirmed)

- [ ] 20. Scheduled API sync (disabled by default)
  - Implement `SYNC` job type feeding the same normalization/versioned-publish path as manual imports, per-source lock, checkpoint (`last_success_at`, `source_as_of`), 15/30-min schedule, and alert after two consecutive failures/timeouts while showing last successful data as stale. Keep disabled until a suitable exchange API/permission is confirmed.
  - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5; Design: Job queue design, Error Handling_

- [ ] 21. (Optional) SSE near-real-time UI
  - Add `PostgreSQL NOTIFY → backend SSE → client refetch` with auth, heartbeat, reconnect snapshot, and streaming-capable proxy. Not required for MVP.
  - _Requirements: 13.6; Design: Overview_

## Notes

- **[PENDING] dedup key** (Open decision #11): finalize `CommissionRecord.dedupKey`
  composition per adapter in Task 11 once a real report sample exists.
- **[PENDING] admin auth provider** (Open decision #13, narrowed to admin-only in v0.6):
  Task 7 ships interim email+password behind `AuthPort`; swap provider without changing
  dependents.
- **Resolved (Open decision #12):** anyone entering exchange + UID sees that UID's
  `pending`/`available` (Task 23); everything else needs a `UidSession` (Task 24).
- **[PENDING] default values**: cashback rate (Task 13), holding period (Task 14),
  withdrawal auto-approve threshold + supported assets/networks (Task 25), lookup
  rate-limit window (Task 23), OTP TTL/attempts/cooldown/daily-cap (Task 24). The
  *resolution rules* are decided; only default *values* remain.
- **Resolved (Open decision #20): Resend** (Task 24). Remaining prerequisites are
  operational — verify a domain, confirm quota fits volume — not design.
- **Accepted (Open decision #21): first-claimant-wins.** Lookup shows real amounts with no
  way to verify the true UID owner; the operator accepted this trade-off. Task 25's
  mandatory first-withdrawal review is the compensating control, not a fix. See
  requirements.md "Accepted risk — first claimant wins".
- **Decided (revisitable):** reversal-after-release policy = reduce pending → available →
  `receivable` (clawback), block new withdrawals while `receivable > 0`, offset future
  credits (Req 8.7; Tasks 13/14/25).
- **[PENDING] compliance/KYC** (Open decision #19): keep payout identity isolated
  (Tasks 15/17) so KYC/retention can be added later.
- Verify build/typecheck/tests on local/SIT before pushing and deploying to Railway.

## Changelog

| Ngày | File | Thay đổi | Lý do | Loại |
|------|------|----------|-------|------|
| 2026-09-15 | tasks.md | Tạo kế hoạch triển khai theo phase (0-4) map tới requirements & design | Hoàn tất bộ spec requirements→design→tasks | added |
| 2026-09-15 | tasks.md | Thêm Overview, Task Dependency Graph, Tasks, Notes theo chuẩn định dạng spec | Đạt chuẩn validate tasks.md | updated |
| 2026-09-15 | tasks.md | Rút gọn Task 18 xuống smoke + sanity check | Không viết unit test dài dòng | updated |
| 2026-09-15 | tasks.md | Task 2 (versioned commission, partial-unique UID, reserved wallet, WithdrawalEvent); tách Railway skeleton sang Phase 0 (Task 4.2) + Task 19 prod hardening; Task 6 best-effort click; Task 11 versioned publish; Task 13 rate resolution + delta; Task 15 reserved + events; Task 18 concurrency checks; đổi tham chiếu Open decision #N | Khắc phục review #1–#8 và đồng bộ với requirements/design | updated |
| 2026-09-15 | tasks.md | Task 2 (Session/passwordHash, receivable, opKey, CommissionVersion unique + activeVersion FK, Guide.exchange, CLAWBACK/PrincipalType); Task 7 interim auth rõ ràng; Task 9 sửa thứ tự SQL; Task 11 version unique; Task 13 FOR UPDATE + opKey + rate trust; Task 14 reversal policy; Task 15 cancel + block receivable | Khắc phục review round 2 và đồng bộ | updated |
| 2026-09-15 | tasks.md | Đánh dấu tiến độ Phase 0 thực tế: done 1.1, 2, 3, 4, 5.1–5.3, 6, 7, 9.1–9.2; tách phần chưa xong thành 1.2 (boundary lint), 5.4 (UI i18n + locale routing), 8.2–8.4 (admin write path), 9.3 (lease check at commit); thêm mục "Current status" | Phản ánh đúng trạng thái triển khai, không đánh done phần còn thiếu | updated |
| 2026-09-15 | tasks.md | Thêm Task 4.3: dev DB scripts (migrate:dev/reset/studio), fallback không dùng Docker, và lần chạy migrate + seed + smoke thật đầu tiên | Task 4.1 chỉ tạo file config, chưa có task nào thực sự dựng DB local nên schema chưa từng tồn tại | added |
| 2026-09-15 | tasks.md | Chốt SIT không dùng Docker cho DB, dùng Railway test Postgres; đánh done Task 4.3 sau khi verify thật (migrate 19 bảng + partial index, seed 3 exchanges/3 offers/3 links/1 admin, smoke toàn bộ public page + `/go/:linkId` ghi ClickEvent thật + register ghi Customer/Session thật); tách 4.4 (env loading cho monorepo) và 4.5 (hardening seed: upsert, guides, error handling) là follow-up chưa xong | Phản ánh đúng những gì đã chạy thật trên DB test, không gộp phần còn thiếu vào done | updated |
| 2026-09-15 | tasks.md | Nâng status lên v0.7; làm rõ local web chỉ chạy trong smoke rồi đã dừng, DB là Railway test Postgres; tách node 4.1–4.5 trong DAG và phân bổ 4.4/4.5 vào execution waves theo đúng dependency; dọn artifact verify/build | Đồng bộ kế hoạch với trạng thái runtime và follow-up thực tế | updated |
| 2026-09-15 | tasks.md | Hoàn thành 1.2, 4.4, 4.5: enforcement cho client/package imports, root `.env` wrapper, migration seed keys, seed guide và xác minh seed hai lần trên Railway test Postgres | Khép các follow-up hạ tầng phát hiện trong Task 4.3 bằng code và kiểm tra thực tế | updated |
| 2026-09-15 | tasks.md | Hoàn thành 5.4: message catalogs `en`/`vi`, locale provider, SSR dùng locale và route `/vi/...`; smoke trực tiếp xác nhận HTML/copy/link tiếng Việt | Hoàn thiện public-site i18n ở cả content và UI/routing | updated |
| 2026-09-15 | tasks.md | Hoàn thành 8.2–8.4: core content writes, schema/rate validation, bốn admin API và form quản trị; nghiệm thu auth/cache/error, same-exchange invariant và publish/unpublish trên Railway test DB | Hoàn tất Phase 0 và unblock luồng import của Task 10 | updated |
| 2026-09-15 | tasks.md | Viết lại Task 5.4 theo hướng locale-agnostic (bỏ mô tả catalog/route `vi`); thêm Task 5.5 English-only enforcement (registry chỉ `en`, xoá catalog vi, middleware suy prefix từ `locales`, bỏ seed + field admin tiếng Việt) và đóng follow-up hard-code `"vi"`; nâng status v1.1, cập nhật "Current status" | Đồng bộ kế hoạch với quyết định English-only (requirements v0.4, design v0.5) | updated |
| 2026-09-15 | tasks.md | Hoàn thành Task 5.5 (English-only enforcement): registry chỉ `en`, xoá catalog/route/seed/admin field tiếng Việt, middleware suy locale từ registry; verify build/typecheck/lint qua Next build (13/13 route, không còn `/vi*`) | Khép English-only theo requirements v0.4 và design v0.5 | updated |
| 2026-09-15 | tasks.md | Review độc lập 8.2–8.4: xác nhận đạt tiêu chí (401/400/409, no-store, same-exchange, publish/unpublish, seedKey không lộ ra admin input); thêm Task 8.5 cho 3 defect còn lại (P2003 → 500, same-exchange check-then-write không transaction, nhóm minor query/pagination/403/select); đổi Task 8 về `[-]` | Ghi nhận đúng phần đã xong và phần còn nợ thay vì đánh done toàn bộ | updated |
| 2026-09-16 | tasks.md | Hoàn thành 8.5 bằng composite FK + migration, Prisma error-code mapping, per-entity cursor pagination, 403 và UI fixes; hoàn thành 10.1/10.4 với private upload, atomic batch/job và preview API; verify live rồi dọn probe | Khép defect Phase 0 và triển khai phần import không phụ thuộc report adapter/dedupKey | updated |
| 2026-09-16 | tasks.md | (v1.4, superseded bởi v2.0) Tách Task 14.3 thành 14.3a (widget quick lookup boolean) và 14.3b (username, `/me/uids`) theo mô hình Hybrid | Ghi lại để không đề xuất lại như ý mới | removed |
| 2026-09-16 | tasks.md | Ghi rõ Task 15 mới ở mức 0%: `Withdrawal`/`WithdrawalEvent` chỉ là khai báo Prisma, chưa có `withdrawalService` hay route `/api/me/withdrawals*`, `/api/admin/withdrawals*` | Sửa nhận định sai rằng API rút tiền đã xong; đây là phần chạm tiền thật nên không được tính là đã có | updated |
| 2026-09-16 | tasks.md | **Chuyển sang UID-first (v2.0).** Đánh Task 12 và 14.3a/14.3b là superseded (strikethrough, không xoá); sửa Task 13 để attribution upsert `UidAccount` thay vì tra `UidLink`; sửa Task 14.1/14.3 theo model mới; thêm Task 22 (re-key Customer/UidLink → UidAccount, xoá route/service/UI cũ, viết lại `scripts/test-bybit-integration.mjs`), Task 23 (lookup trả amount thật theo exchange+UID), Task 24 (OTP qua Resend + UidSession 30 phút), Task 25 (withdrawal flow — thay Task 15 cũ, thêm rule lệnh rút đầu luôn UNDER_REVIEW), Task 26 (cherry-pick UI từ `cashback/` — input-otp, data-table, confirm-dialog; liệt kê rõ không lấy TanStack Router/Clerk/vite config vì đó chỉ là stub UI không có backend thật); cập nhật Task Dependency Graph, Task 17/18, Notes | Đồng bộ toàn bộ tasks.md với requirements v0.6 và design v0.7 (UID-first, Resend OTP, first-claimant-wins) | added |
| 2026-09-16 | tasks.md | Thêm Task 5.6 (5.6.1–5.6.6): hiển thị logo sàn trên offer tile bằng asset PNG lưu trong repo tại `apps/web/public/exchange-logos/`, hoàn tất mapping `logoUrl` còn dở trong `core`, bỏ `logoUrl` khỏi `adminExchangeCreateSchema`, set `logoUrl` trong seed, và thứ tự deploy (push → migrate → reseed) | Triển khai `Exchange.logoUrl` vừa chốt ở design v0.5 theo hướng ảnh local, không hot-link URL online | added |
| 2026-09-17 | tasks.md | Hoàn thành Task 25.9/25, Task 26 và Task 16: integration withdrawal, OTP/data-table/confirm-dialog, ba API dashboard admin, analytics/sync/activity UI và polling theo visibility/trạng thái batch | Đồng bộ tiến độ với code đã lint, typecheck, build và integration-test trên schema test cô lập | updated |
