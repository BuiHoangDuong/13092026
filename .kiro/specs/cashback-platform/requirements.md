# Requirements Document

**Cashback Affiliate Platform**

- **Status:** Draft v0.4 (derived from `architecture.html` v0.4 + stakeholder answers; incorporates review round 2 and the English-only language decision)
- **Last updated:** 2026-09-15
- **Product language:** English only — English is the single enabled locale; the
  architecture stays i18n-ready but no additional locale ships
- **Architecture context source of truth:** `architecture.html` at repo root

> This document uses EARS-style acceptance criteria so it can be consumed directly by
> AI coding agents (Kiro / Claude / Codex) and by humans. Requirements describe the
> intended behavior of a system that is **not yet implemented**. The repo currently
> contains only `architecture.html` and Git metadata.

---

## Introduction

### Purpose
Build a cashback affiliate platform for crypto exchanges. The operator is a **root
affiliate** on Binance, MEXC, and Bybit. Customers sign up to exchanges through the
operator's referral links; the operator receives affiliate commission from the
exchanges and shares a configurable portion back to customers as cashback.

The platform lets customers discover exchanges/offers, obtain referral links, link
their exchange UID, track attributed cashback, and withdraw available balance as
quickly as safely possible. Admins manage content, import affiliate reports, and
operate the cashback/withdrawal pipeline.

### Scope — MVP is the full loop (answer 1D)
The MVP includes the full cashback loop: public discovery, click tracking, customer
accounts, UID linking/verification, affiliate report import, commission attribution,
cashback wallet, and withdrawals. Real exchange API integration is deferred; the MVP
launches with a **smoke/seed phase** (answer 7A) using mock/seed data and manual
report import before wiring real affiliate data.

### Business model summary (answers 2B, 3B, 5 — proposed)
- Operator earns commission from exchanges as root affiliate.
- Operator shares a configurable percentage of that commission with the customer whose
  UID generated it.
- Cashback accrues to a per-customer wallet with `pending → available → withdrawn`
  states; withdrawals target crypto addresses (e.g., USDT).
- "Fastest withdraw" applies only to **available** balance. Newly attributed
  commission stays **pending** through a configurable holding period, because exchange
  affiliate data is typically delayed (e.g., T+1) and subject to revision.

---

## Glossary

| Term | Meaning |
|------|---------|
| Operator | The business running the platform; root affiliate on the exchanges. |
| Exchange | A crypto exchange partner (Binance, MEXC, Bybit at launch; extensible). |
| Offer | A published cashback/referral offer tied to an exchange. |
| Referral link | Operator affiliate link a customer uses to sign up on an exchange. |
| UID | The unique account identifier the exchange assigns to a referred user. |
| Affiliate report | File exported from the operator's root affiliate account containing UID-level commission/volume data. |
| Import batch | One uploaded report file plus its parsing/validation/publish lifecycle. |
| Staging rows | Parsed-but-not-yet-published rows held for admin preview. |
| Attribution | Mapping imported commission to a linked customer via UID. |
| Cashback | The customer's share of commission credited to their wallet. |
| Holding period | Configurable delay before pending cashback becomes available. |
| Worker | Long-running Node.js process that parses reports and runs jobs. |

---

## Actors & roles

| Actor | Description | Auth |
|-------|-------------|------|
| Visitor | Anonymous public user browsing exchanges, offers, guides. | None |
| Customer | Registered end user who links a UID and earns cashback. | Customer account |
| Admin | Operator staff managing content, imports, cashback, withdrawals. | Admin account (single role — answer 14A) |
| System / Worker | Background process that parses reports, attributes commission, and runs scheduled jobs. | Internal |
| Exchange (external) | Binance / MEXC / Bybit. Destination of referral links; source of affiliate reports. Out of app boundary. | N/A |

---

## Technical constraints (answers 15, 16)

These are fixed decisions that requirements must respect.

- **Language:** TypeScript across all packages.
- **Web app:** Next.js 15 (App Router).
- **Worker:** Node.js long-running process (not serverless).
- **Repo layout:** monorepo using pnpm workspaces + Turborepo.
- **Database:** PostgreSQL (Prisma proposed for schema/migrations).
- **Environments (dual-track, always in parallel):**
  - **SIT / local:** runs locally (Docker Compose acceptable) for testing.
  - **Production:** deployed to Railway.
  - Workflow: verify locally → push to Git → deploy to Railway. Both tracks are kept
    working simultaneously.
- **Language / i18n (answer 4):** English is the **only enabled locale**; no other
  language (including Vietnamese) is served. The architecture must still keep the
  i18n seams — a single locale registry, extracted message catalogs, per-locale content
  fields — so a locale can be enabled later without restructuring routes or content.
- **Extensibility (answer 6B):** ship with Binance, MEXC, Bybit but model exchanges as
  data so new exchanges are added without code changes to core flows.
- **Report format (answers 8B, 9, 10C):** no sample file yet; format known to be
  tabular. Parser layer must be pluggable so multiple formats (CSV, XLSX, later others)
  and both transaction-level and aggregate reports are supported per-exchange adapter.

### Proposed monorepo structure (guideline, not yet created)
```
apps/
  web/            # Next.js 15 App Router (public + admin + customer UI)
  worker/         # long-running Node.js process (parse/publish/attribute jobs)
packages/
  contracts/      # shared request/response + report schemas (no secrets)
  core/           # services, normalization, cashback logic (shared by web + worker)
  db/             # Prisma schema + migrations
infra/            # Docker Compose (local), Railway config, reverse proxy
architecture.html # handoff document
.kiro/specs/      # this spec
```

---

## Requirements

Each requirement has a user story and EARS acceptance criteria. Keywords:
- **WHEN** … event-driven
- **WHILE** … state-driven
- **IF … THEN** … conditional / error handling
- **THE SYSTEM SHALL** … mandatory behavior

### Requirement 1: Public exchange & offer discovery
**User Story:** As a visitor, I want to browse and compare exchanges and their cashback
offers, so that I can choose one and get a referral link.

#### Acceptance Criteria
1. WHEN a visitor opens the home page, THE SYSTEM SHALL render published exchange and
   offer content server-side for immediate, indexable content.
2. WHEN a visitor opens the exchanges list, THE SYSTEM SHALL display all exchanges with
   `status = published` and allow comparison of published offer attributes.
3. WHEN a visitor opens an exchange detail page, THE SYSTEM SHALL show its published
   offers, conditions, related guides, and a call-to-action to obtain the referral link.
4. IF an exchange or offer is not published, THEN THE SYSTEM SHALL NOT expose it on any
   public page.
5. THE SYSTEM SHALL read all public content through the server data layer; the browser
   SHALL NOT connect directly to the database.

### Requirement 2: Referral link redirect & click tracking
**User Story:** As a visitor/customer, I want to open a referral link, so that I am sent
to the exchange while the platform records the click.

#### Acceptance Criteria
1. WHEN a request hits `GET /go/:linkId`, THE SYSTEM SHALL look up the configured active
   link, record a click event, and return an HTTP redirect to the destination URL.
2. THE SYSTEM SHALL record the click event and the redirect independently, so recording
   failure does not block the redirect. Recording SHALL use a reliable best-effort
   mechanism (e.g., a post-response task / `waitUntil`, or a short-timeout awaited
   insert) rather than an unawaited promise that can be lost on process exit.
3. IF `linkId` is unknown or the link is inactive, THEN THE SYSTEM SHALL return a safe
   fallback response (configurable: 404 page or default exchange page) and SHALL NOT
   redirect to an unconfigured URL.
4. THE SYSTEM SHALL NOT wait on any exchange API or data sync when performing a redirect.
5. THE SYSTEM SHALL store at minimum: link reference and timestamp. (Bot filtering and
   unique-click definition are out of scope for MVP — answer 18.)

### Requirement 3: Customer accounts & authentication
**User Story:** As a customer, I want to register and sign in, so that I can link a UID
and track/withdraw my cashback.

#### Acceptance Criteria
1. WHEN a visitor submits valid registration details, THE SYSTEM SHALL create a customer
   account and start an authenticated session.
2. WHILE a customer session is unauthenticated, THE SYSTEM SHALL deny access to wallet,
   UID linking, and withdrawal features and SHALL redirect to sign-in.
3. THE SYSTEM SHALL verify authorization on the server for every customer-scoped action;
   THE SYSTEM SHALL NOT trust identifiers (UID, account id) supplied by the browser.
4. THE SYSTEM SHALL keep customer authentication separate from admin authentication.
5. THE SYSTEM SHALL store credentials/secrets according to the chosen auth solution
   (**pending decision — answer 13**) and SHALL never expose secret values to clients.

### Requirement 4: Language policy & i18n readiness
**User Story:** As the operator, I want the product served in English only, while the
codebase stays ready to enable another locale later, so that visitors never meet
half-translated pages and a future market can be added without a rewrite.

#### Acceptance Criteria
1. THE SYSTEM SHALL serve English as the default locale and SHALL treat English as the
   only **enabled** locale; THE SYSTEM SHALL NOT serve a Vietnamese locale.
2. THE SYSTEM SHALL structure UI strings in extractable message catalogs, not hardcoded
   inline text.
3. THE SYSTEM SHALL derive enabled locales from a single locale registry, and locale-aware
   routing/content selection SHALL read from that registry, so enabling a locale requires
   no restructuring of existing routes or duplication of page code.
4. WHEN translatable content (exchanges, offers, guides) is missing a value for the
   requested locale, THE SYSTEM SHALL fall back to the default locale rather than showing
   empty content.
5. IF a request targets a locale-prefixed path whose segment is not an enabled locale,
   THEN THE SYSTEM SHALL respond 404 and SHALL NOT render content in that language.

### Requirement 5: UID linking & verification (fraud control)
**User Story:** As a customer, I want to link my exchange UID to my account, so that
commission generated by my UID becomes my cashback.

#### Acceptance Criteria
1. WHEN a customer submits an exchange + UID to link, THE SYSTEM SHALL record a link
   request in a `pending_verification` state.
2. THE SYSTEM SHALL only mark a UID link `verified` if that UID appears in an imported,
   published affiliate report under the operator's root affiliate for that exchange.
3. THE SYSTEM SHALL allow a given (exchange, UID) to be verified for **at most one**
   customer account; IF a UID is already linked to another account, THEN THE SYSTEM
   SHALL reject the new link request and flag it for admin review.
4. WHILE a UID link is `pending_verification` or `rejected`, THE SYSTEM SHALL NOT
   attribute cashback to that customer for that UID.
5. THE SYSTEM SHALL treat UID as an opaque string (no numeric coercion) to preserve
   leading zeros and exchange-specific formats.
6. WHEN a previously unknown UID later appears in an imported report, THE SYSTEM SHALL
   re-evaluate any matching pending link requests and verify them.

> Note: whether customers may view UID-level detail beyond their own aggregated cashback
> is **pending decision (answer 12)**. Baseline: a customer sees only their own linked
> UIDs and cashback; admin sees all.

### Requirement 6: Affiliate report import pipeline (manual, MVP)
**User Story:** As an admin, I want to upload an affiliate report, have it validated and
previewed, then confirm it, so that verified commission data is published without
corrupting the live dashboard.

#### Acceptance Criteria
1. WHEN an admin uploads a report via `POST /api/admin/imports` with source metadata
   (exchange, root account, report type, period, timezone), THE SYSTEM SHALL validate
   admin permission, file type, and size, store the original file in private storage,
   create an `import_batch` and a parse job, and respond `202 Accepted` with a batch id.
2. THE SYSTEM SHALL NOT parse the entire file within the HTTP request; parsing SHALL run
   in the worker.
3. WHEN the worker processes a parse job, THE SYSTEM SHALL read UID as string, normalize
   timestamps to UTC (retaining source timezone), normalize decimals, and detect error
   rows, unmapped UIDs, duplicates, and totals into staging rows.
4. THE SYSTEM SHALL NOT execute formulas or macros contained in spreadsheet files.
5. WHILE a batch is not committed, THE SYSTEM SHALL keep its data in staging and SHALL
   NOT expose it to the customer-facing dashboard.
6. WHEN an admin reviews a batch, THE SYSTEM SHALL show new/duplicate/error/conflicting
   row counts and validation totals.
7. WHEN an admin commits a batch via `POST /api/admin/imports/:id/commit`, THE SYSTEM
   SHALL create a publish job that upserts versioned, source-attributed records and
   commits the whole batch atomically.
8. IF a publish job fails midway, THEN THE SYSTEM SHALL NOT leave the dashboard reading
   partial data (all-or-nothing per batch).
9. WHEN the same batch commit is invoked repeatedly, THE SYSTEM SHALL NOT publish
   duplicate data (idempotent commit).
10. THE SYSTEM SHALL support per-exchange parser adapters and multiple file formats
    (CSV, XLSX, extensible — answers 8B, 9), and SHALL distinguish transaction-level
    reports from aggregate reports (answer 10C).
11. IF a report lacks stable identity keys for transaction-level dedup, THEN THE SYSTEM
    SHALL fall back to aggregate handling rather than guessing per-transaction records.

> The concrete dedup/reconciliation key is **pending decision (answer 11)** and will be
> finalized against a real sample file.

### Requirement 7: Commission attribution & cashback calculation
**User Story:** As the operator, I want imported commission attributed to the right
customer and converted to cashback at a configurable rate, so that customers are
credited correctly.

#### Acceptance Criteria
1. WHEN a batch is published, THE SYSTEM SHALL attribute each commission record to the
   customer whose verified UID link matches (exchange, UID).
2. IF a commission record's UID has no verified customer link, THEN THE SYSTEM SHALL
   retain the record as unattributed and SHALL NOT credit any customer.
3. THE SYSTEM SHALL compute customer cashback as `commission × cashback_rate`. The rate
   SHALL be resolved with this precedence: (1) the rate of the offer bound to the UID's
   referral link **only when that link is corroborated by system-verified report data
   (e.g., referral code / sub-ID present in the report)**, else (2) the exchange default
   rate. THE SYSTEM SHALL NOT trust a customer-supplied link/offer for rate selection,
   and SHALL require `UidLink.exchange = ReferralLink.exchange = Offer.exchange`. THE
   SYSTEM SHALL snapshot the resolved rate and offer onto the commission at attribution
   time, so later rate changes do not retroactively alter already-credited cashback.
4. THE SYSTEM SHALL represent all monetary values as decimal/numeric with an explicit
   asset/currency, and APIs SHALL return decimal strings (no float rounding).
5. THE SYSTEM SHALL NOT double-count overlapping report periods; overlapping periods
   SHALL be reconciled before totals are computed.
6. WHEN the same report is re-imported or an overlapping period is imported, THE SYSTEM
   SHALL NOT increase a customer's attributed cashback beyond the reconciled amount.
7. THE SYSTEM SHALL keep a traceable link from each cashback amount back to its source
   batch/record for auditing.
8. WHEN a corrected report changes a previously published commission amount, THE SYSTEM
   SHALL record a new version that supersedes the prior one, recompute the reconciled
   amount, and apply only the delta to the customer's cashback (additional credit or a
   reversal), preserving prior versions for audit.

### Requirement 8: Cashback wallet & balance states
**User Story:** As a customer, I want to see my cashback balance and its status, so that
I know what is earned, what is available, and what has been withdrawn.

#### Acceptance Criteria
1. THE SYSTEM SHALL maintain, per customer and asset, a wallet with balances split into
   `pending`, `available`, `reserved`, `withdrawn`, and a `receivable` (clawback) bucket.
2. WHEN cashback is attributed from a published batch, THE SYSTEM SHALL credit it to
   `pending`.
3. WHEN a pending cashback amount clears its configurable holding period, THE SYSTEM
   SHALL move it from `pending` to `available`.
4. IF a source report is later corrected downward, THEN THE SYSTEM SHALL apply the
   reversal against `pending` first, then `available`; neither balance SHALL go negative.
5. WHILE a customer views their wallet, THE SYSTEM SHALL show current balances, the last
   sync/import time, and the source data "as-of" time; THE SYSTEM SHALL distinguish
   "no data" from a zero value.
6. THE SYSTEM SHALL expose a transaction history of wallet movements (credit, hold
   release, withdrawal reserve/release/settle, adjustment, reversal, clawback) for the
   customer.
7. IF a downward correction exceeds the customer's `pending + available` (because cashback
   was already withdrawn/settled), THEN THE SYSTEM SHALL record the uncovered remainder as
   a `receivable` (clawback). WHILE `receivable > 0`, THE SYSTEM SHALL block new
   withdrawals, and subsequent cashback credits SHALL first offset the `receivable` before
   increasing `pending`.

### Requirement 9: Withdrawal flow (fast, with fraud guardrails)
**User Story:** As a customer, I want to withdraw my available cashback quickly to a
crypto address, so that I receive my earnings with minimal delay.

#### Acceptance Criteria
1. WHEN a customer requests a withdrawal, THE SYSTEM SHALL only allow an amount less than
   or equal to their `available` balance for the selected asset.
2. THE SYSTEM SHALL require a payout destination (e.g., network + address) and SHALL
   validate its format for the selected asset/network before accepting the request.
3. WHILE a withdrawal request is open, THE SYSTEM SHALL move the requested amount from
   `available` into `reserved` so it cannot be requested twice (no double-spend of the
   same balance).
4. IF the requested amount is at or below a configurable auto-approval threshold AND the
   balance is `available`, THEN THE SYSTEM SHALL auto-approve the request; ELSE THE
   SYSTEM SHALL route it to admin manual review.
5. WHEN a withdrawal is approved and marked paid, THE SYSTEM SHALL move the amount from
   `reserved` to `withdrawn`; payout execution is **manual by admin in MVP** (mark as
   paid with a reference), automatable later.
6. IF a withdrawal is rejected or cancelled, THEN THE SYSTEM SHALL release the reserved
   amount from `reserved` back to `available`.
7. THE SYSTEM SHALL NOT allow withdrawal of `pending` balance.
8. THE SYSTEM SHALL persist an auditable event for every withdrawal state change,
   capturing from-status, to-status, actor (customer/admin/system), timestamp, and any
   note/payout reference.
9. WHEN a customer cancels a withdrawal that has not yet reached `PAID`, THE SYSTEM SHALL
   move it to `CANCELLED` and release the reserved amount back to `available`; IF it is
   already `PAID`, THEN THE SYSTEM SHALL reject the cancel.
10. WHILE a customer has an outstanding `receivable > 0`, THE SYSTEM SHALL reject new
    withdrawal requests until the receivable is cleared.

### Requirement 10: Admin content management
**User Story:** As an admin, I want to manage exchanges, offers, referral links, and
guides, so that the public site shows accurate, up-to-date content.

#### Acceptance Criteria
1. WHILE not authenticated as admin, THE SYSTEM SHALL deny access to all admin routes.
2. WHEN an admin creates/edits/publishes/unpublishes an exchange, offer, link, or guide,
   THE SYSTEM SHALL validate input and permission server-side and persist via the data
   layer.
3. WHEN admin content is saved, THE SYSTEM SHALL make the new version available on the
   next public read; IF caching is added, THEN cache invalidation SHALL occur on update.
4. THE SYSTEM SHALL model exchanges/offers/links as data so new exchanges are added
   without code changes (answer 6B).
5. THE SYSTEM SHALL store translatable content fields keyed per locale to support
   Requirement 4, and admin authoring SHALL expose fields only for enabled locales —
   English alone while English is the only enabled locale.

### Requirement 11: Admin analytics & operations dashboard
**User Story:** As an admin, I want dashboards for clicks, imports, attribution, and
withdrawals, so that I can operate the platform.

#### Acceptance Criteria
1. WHEN an admin opens the analytics dashboard, THE SYSTEM SHALL show click activity
   aggregated by link, exchange, and time, read from internal data (not by calling
   exchange APIs on page load).
2. WHILE an admin tab is visible, THE SYSTEM SHALL poll dashboard APIs every 30 seconds
   and SHALL pause polling when the tab is hidden.
3. WHILE an import batch is processing, THE SYSTEM SHALL let the admin UI poll batch
   status roughly every 5 seconds until it settles.
4. THE SYSTEM SHALL provide a sync-status view showing import/API state, last success
   time, and source data "as-of" time, without returning secrets or full raw reports.
5. THE SYSTEM SHALL provide admin views for attributed vs unattributed commission and
   for the withdrawal queue.
6. THE SYSTEM SHALL return private admin/dashboard responses with
   `Cache-Control: private, no-store` and SHALL NOT cache dynamic financial data in MVP.

### Requirement 12: Background worker & job processing
**User Story:** As the operator, I want long-running work handled by a worker, so that
web requests stay fast and imports/attribution run reliably.

#### Acceptance Criteria
1. THE SYSTEM SHALL run the worker as a long-running Node.js process that polls for
   pending jobs in PostgreSQL (proposed ~10s interval).
2. THE SYSTEM SHALL claim jobs using a transaction with `FOR UPDATE SKIP LOCKED`, a
   lease, and heartbeats, so multiple workers do not process the same job.
3. IF a worker dies mid-job, THEN THE SYSTEM SHALL allow the job to be reclaimed, and
   THE SYSTEM SHALL verify lease ownership before commit so a stale worker cannot
   overwrite newer data.
4. THE SYSTEM SHALL share schema/services between web and worker via `packages/core` and
   `packages/db`; the web/client SHALL NOT import `core` or `db` directly from the
   browser bundle.
5. WHEN a job fails on a transient error, THE SYSTEM SHALL retry with backoff and jitter;
   IF the error is a configuration/permission error, THEN THE SYSTEM SHALL surface it and
   SHALL NOT retry indefinitely.
6. THE SYSTEM SHALL use a PostgreSQL-backed job queue for launch scale; Redis/BullMQ is
   only to be evaluated if throughput/backlog grows.

### Requirement 13: Data freshness (deferred API sync)
**User Story:** As the operator, I want to later add automatic API sync, so that data
refreshes without manual uploads once suitable exchange APIs/permissions exist.

#### Acceptance Criteria
1. THE SYSTEM SHALL support future scheduled sync jobs (every 15 or 30 minutes) that feed
   the **same** normalization, dedup, and publish path as manual imports.
2. WHILE no suitable exchange API/permission is confirmed, THE SYSTEM SHALL keep the
   scheduled API sync **disabled**.
3. THE SYSTEM SHALL store `last_success_at` and `source_as_of` (when the source provides
   it); a successful API call SHALL NOT be treated as proof of newer source data.
4. THE SYSTEM SHALL take a per-source lock so scheduled runs do not overlap.
5. IF two consecutive sync cycles fail or a job exceeds its allowed time, THEN THE SYSTEM
   SHALL alert and continue showing the last successful data labeled as stale.
6. (Optional future) THE SYSTEM MAY add SSE (`PostgreSQL NOTIFY → backend → client
   refetch`) for near-real-time UI updates; not required for MVP.

---

## Non-functional requirements

### Performance & scale (answer 17B — 1k–50k events/day)
- Public pages SHALL render server-side and read cached/persisted data, not live
  exchange APIs.
- The redirect endpoint SHALL respond quickly and independently of any sync work.
- The system SHALL comfortably handle the medium-traffic band (1k–50k clicks/day) on a
  single Railway service tier, with room to scale the worker separately.

### Security
- All authorization SHALL be enforced server-side; the browser SHALL NOT be trusted with
  UID ownership or account scope.
- Private report files SHALL be stored in private object storage accessible only to
  API/worker.
- Secrets SHALL live in environment variables / a secret store, never in client bundles
  or public-prefixed env vars.
- PostgreSQL SHALL accept connections only from backend/worker services.
- Financial actions (attribution, wallet changes, withdrawals) SHALL be auditable.

> **Network-exposed services note:** the public site, redirect, and any customer/admin
> APIs are internet-exposed. Admin and customer APIs **must** require authentication;
> the redirect and public read APIs are intentionally anonymous. Do not ship any
> unauthenticated endpoint that exposes wallet, UID, import, or withdrawal data.

### Data integrity
- Money as decimal/numeric; API returns decimal strings with asset.
- UID as string; timestamps normalized to UTC with source timezone retained.
- No double-counting of overlapping periods; batch commits are atomic and idempotent.

### Compliance (answer 19 — unclear, pending)
- Compliance obligations (KYC/AML for payouts, data-retention, GDPR-equivalent) are
  **pending decision**. The design SHALL keep payout identity and personal data
  isolated so KYC/retention controls can be added without reworking core flows.

### Deployment (answers 15, 16)
- Local/SIT and Railway production SHALL be maintainable in parallel from one codebase.
- Migrations SHALL run once per deploy; images/builds SHALL be reproducible.
- Health/observability SHALL cover web health, oldest job age, worker heartbeat, and
  import error rate; backup/restore of the database SHALL be verified.

---

## Proposed API surface (indicative, not final)

| Endpoint | Responsibility | Access |
|----------|----------------|--------|
| `GET /api/exchanges` | Published exchanges + offers. | Public |
| `GET /go/:linkId` | Resolve link, record click, redirect. | Public |
| `POST /api/auth/*` | Customer register/login/session. | Public → session |
| `GET /api/me/wallet` | Customer balances + history. | Customer |
| `POST /api/me/uids` | Submit UID link request. | Customer |
| `GET /api/me/uids` | List customer's UID links + status. | Customer |
| `POST /api/me/withdrawals` | Request withdrawal of available balance. | Customer |
| `POST /api/me/withdrawals/:id/cancel` | Cancel a not-yet-paid withdrawal. | Customer |
| `GET /api/me/withdrawals` | Customer withdrawal history/status. | Customer |
| `POST /api/admin/imports` | Upload report, create batch + parse job. | Admin (202) |
| `GET /api/admin/imports/:id` | Batch status, preview, error rows. | Admin |
| `POST /api/admin/imports/:id/commit` | Publish a validated batch (idempotent). | Admin |
| `GET /api/admin/accounts/:id/activity` | Published activity per account/UID. | Admin |
| `GET /api/admin/analytics` | Click metrics for dashboard. | Admin |
| `GET /api/admin/sync-status` | Import/API status, last success, as-of. | Admin |
| `POST /api/admin/withdrawals/:id/decision` | Approve/reject/mark-paid. | Admin |

---

## Data model (conceptual groups, not final schema)

- **Exchange** — name, slug, description, status, default cashback rate, i18n fields.
- **Offer** — content, conditions, cashback_rate, status, verified-at, exchange ref.
- **ReferralLink** — id, exchange ref, optional offer ref, destination URL, active status.
- **Guide** — title, slug, content, status, optional exchange ref, i18n fields.
- **ClickEvent** — link ref, timestamp.
- **AdminAccount** — id, email, interim credential (password hash) per chosen auth (single role).
- **Customer** — id, email, interim credential (password hash), locale.
- **Session** — interim server session (principal type customer/admin, subject id, token, expiry); replaced if a managed auth provider is chosen.
- **UidLink** — customer ref, exchange, UID (string), optional referral-link ref, status
  (`pending_verification` / `verified` / `rejected`), review flag. At most one `verified`
  owner per (exchange, UID), enforced by a partial unique index on `status = verified`
  (a second claim is stored as `rejected` and flagged for review).
- **ImportBatch** — source metadata, file ref, status, totals.
- **StagingRow** — batch ref, parsed row, validation flags.
- **CommissionRecord** — stable identity (exchange, UID, dedup key, period, asset), current
  reconciled amount, attributed customer (nullable), snapshot offer + cashback rate,
  cashback already credited.
- **CommissionVersion** — per-batch occurrence of a commission (amount, batch ref,
  imported-at, superseded flag); unique per (commission, batch) for idempotent commit;
  preserves import history for reconciliation/audit.
- **Wallet / WalletEntry** — customer, asset, pending/available/reserved/withdrawn plus a
  `receivable` bucket, and a typed movement log (credit, hold release, withdrawal
  reserve/release/settle, adjustment, reversal, clawback) with a unique operation key per
  entry for idempotent, concurrent-safe application.
- **Withdrawal** — customer, asset, amount, destination, current status, payout ref.
- **WithdrawalEvent** — per-transition audit (withdrawal ref, from/to status, actor, time,
  note/reference).
- **Job** — type (parse/publish/attribute/release-holds/sync), state, lease, heartbeat, attempts.

---

## Open decisions (to confirm before/while implementing)

| # | Topic | Answer given | What's still needed |
|---|-------|--------------|---------------------|
| 11 | Dedup / reconciliation key | Decide later | Real sample report to fix per-exchange keys. |
| 12 | Customer visibility of UID-level detail | Unclear | Baseline: own data only. Confirm if customers see per-UID breakdown. |
| 13 | Auth solution (customer + admin) | Decide later | Choose self-built vs Auth0/Clerk/Supabase; affects Req 3, 10, 6.2. |
| 19 | Compliance (KYC/AML, retention, GDPR) | Unclear | Confirm payout KYC and data-retention obligations. |
| — | Cashback rate & holding period values | Rule decided (offer-rate → exchange-default, snapshot at attribution); values pending | Confirm default % and holding-period length. |
| — | Withdrawal auto-approval threshold & assets/networks | Proposed | Confirm threshold, supported assets (USDT?) and networks. |
| — | Sample report: format, columns, granularity, timezone | No file yet (8B) | Needed to finalize parser adapters (Req 6). |
| — | Enabling a second locale | English-only decided; Vietnamese excluded | If a market is ever requested, confirm the locale plus who supplies translated UI copy and content. |

---

## Phased roadmap

- **Phase 0 — Smoke/seed (answer 7A):** monorepo scaffold, Next.js 15 + worker + Postgres
  on local and Railway; public site with seeded exchanges/offers; redirect + click
  tracking; admin login (interim auth). No real affiliate data.
- **Phase 1 — Import & attribution:** manual report import pipeline, staging/preview/
  commit, UID linking + verification, commission attribution.
- **Phase 2 — Cashback & withdrawals:** wallet balances + holding period, withdrawal
  request + admin approval + manual payout.
- **Phase 3 — Hardening:** analytics depth, KYC/compliance controls,
  observability/backups. No locale rollout is planned (Requirement 4).
- **Phase 4 — Automation (deferred):** scheduled API sync + optional SSE, once exchange
  APIs/permissions are confirmed.

---

## Out of scope for MVP
- Any non-English locale, including Vietnamese (Requirement 4). Only the i18n seams ship.
- Real-time exchange API integration and market-data WebSockets (Phase 4).
- Bot filtering / unique-click analytics (answer 18).
- Automated on-chain payout execution (manual in MVP).
- Multi-tier admin roles (single role — answer 14A).

---

## Assumptions
- Operator holds valid root-affiliate relationships with Binance, MEXC, Bybit
  (answer 7A), with mock/seed data used until real reports arrive.
- Affiliate data is delayed and revisable; "available" balance reflects only cleared
  cashback.
- One customer account may link multiple UIDs across exchanges; each verified
  (exchange, UID) maps to exactly one customer.
- Requirements marked "pending decision" will be resolved before their dependent code is
  built; agents should not silently invent values for them.

---

## Changelog

| Ngày | File | Thay đổi | Lý do | Loại |
|------|------|----------|-------|------|
| 2026-09-15 | requirements.md | Tạo bộ requirement EARS đầu tiên cho cashback-platform | Khởi tạo spec | added |
| 2026-09-15 | requirements.md | Reserved balance + withdrawal event audit (Req 8/9); rule cashback rate + snapshot (Req 7.3, thêm 7.8); best-effort click (Req 2.2); versioned commission + partial-unique UID trong data model; thêm Changelog | Khắc phục review #1,#2,#3,#4,#8 và bổ sung truy vết | updated |
| 2026-09-15 | requirements.md | Chính sách reversal sau khi tiền đã available/withdrawn (receivable/clawback, chặn rút, offset credit sau) + Req 8.7/9.10; customer cancel withdrawal (Req 9.9) + endpoint; rate chỉ tin nguồn hệ thống + ràng buộc cùng exchange (Req 7.3); interim credential + Session, version unique, opKey trong data model | Khắc phục review round 2 (#1,#2,#3,#4,#5,#6) | updated |
| 2026-09-15 | requirements.md | Chốt English-only: Req 4 đổi thành "Language policy & i18n readiness" (4.1 chỉ enable `en`, thêm 4.3 locale registry, 4.5 locale lạ → 404); Req 10.5 admin chỉ author locale đang enable; sửa header ngôn ngữ, ràng buộc i18n (answer 4), Phase 3 bỏ locale rollout, thêm out-of-scope + open decision cho locale thứ hai | Sản phẩm không phục vụ tiếng Việt; giữ seam i18n nhưng không ship locale nào ngoài English | updated |
