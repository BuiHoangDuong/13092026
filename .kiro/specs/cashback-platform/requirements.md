# Requirements Document

**Cashback Affiliate Platform**

- **Status:** Draft v0.6 (UID-first / no customer accounts; supersedes the
  customer-account model of v0.4–v0.5)
- **Last updated:** 2026-09-16
- **Access model:** **UID-first, no customer accounts.** A visitor enters exchange + UID and
  immediately sees that UID's cashback amounts. Ownership is asserted only at withdrawal:
  the first withdrawal binds an email to that (exchange, UID) via a 6-digit OTP, and a
  successful OTP opens a short-lived session scoped to that UID. Admin accounts still
  authenticate normally.
- **Accepted risk (decided 2026-09-16):** a UID is not secret and amounts are shown to
  anyone who enters it, so the effective ownership rule is **first claimant wins**. The
  operator accepts this to keep the flow frictionless. See "Accepted risk" below for the
  exact exposure and the controls that remain.
- **Product language:** English only — English is the single enabled locale; the
  architecture stays i18n-ready but no additional locale ships
- **Architecture context source of truth:** `architecture.html` at repo root

> This document uses EARS-style acceptance criteria so it can be consumed directly by
> AI coding agents (Kiro / Claude / Codex) and by humans. Implementation status per
> requirement lives in `tasks.md`, not here.

---

## Introduction

### Purpose
Build a cashback affiliate platform for crypto exchanges. The operator is a **root
affiliate** on Binance, MEXC, and Bybit. Users sign up to exchanges through the
operator's referral links; the operator receives affiliate commission from the
exchanges and shares a configurable portion back to the UID that generated it as cashback.

The platform lets visitors discover exchanges/offers, obtain referral links, look up the
cashback their exchange UID has earned **without creating an account**, and withdraw
available balance after proving control of an email address. Admins manage content, import
affiliate reports, review first withdrawals, and operate the cashback/withdrawal pipeline.

### Scope — MVP is the full loop (answer 1D)
The MVP includes the full cashback loop: public discovery, click tracking, UID cashback
lookup, affiliate report import, commission attribution, cashback wallet, and withdrawals
gated by email-OTP binding. Real exchange API integration is deferred; the MVP launches
with a **smoke/seed phase** (answer 7A) using mock/seed data and manual report import
before wiring real affiliate data.

### Access model — UID-first, no customer accounts
- There is **no customer registration, username, password, or password reset**. Cashback is
  owned by a (exchange, UID) pair, not by a platform account.
- **Lookup requires both exchange and UID.** A UID alone is never sufficient; the same UID
  string on a different exchange is a different subject (Requirement 14).
- Lookup shows **actual amounts** (`pending`, `available`) for that UID. This is deliberate
  and is the accepted risk recorded below.
- **Withdrawal binds an email.** The first withdrawal for a UID sends a 6-digit OTP to the
  email entered; a correct OTP binds that email to the (exchange, UID) and opens a
  **30-minute session scoped to that single UID**. Later withdrawals accept only the bound
  email (Requirement 15).
- The **first withdrawal per UID always goes to admin review**, regardless of amount.
- Admin authentication is unchanged and still required for all admin routes.

### Accepted risk — first claimant wins
Recorded explicitly so it is a decision, not an oversight.

- A UID is **not a secret**: it is visible in exchange dashboards, users paste it into
  support chats and community groups, and on several exchanges UIDs are near-sequential.
- Because amounts are shown to anyone who enters exchange + UID, an attacker can scan UID
  ranges to find funded UIDs, then bind their own email to one and request a withdrawal.
- Affiliate reports do not contain the referred user's email, so **the operator has no
  ground truth to verify ownership**. Admin review of the first withdrawal is therefore a
  sanity/velocity check, not proof of ownership.
- **Controls that remain:** per-IP rate limiting on lookup (Req 14.4), mandatory admin
  review of every first withdrawal (Req 15.9), OTP attempt/resend limits (Req 15.5–15.7),
  a permanent audit trail per withdrawal (Req 9.8), and the holding period keeping recent
  cashback non-withdrawable (Req 8.3).
- **Consequence accepted by the operator:** cashback may be paid to someone who is not the
  true UID owner, and the true owner then has no recourse. Revisit if losses appear or if an
  exchange-side ownership proof becomes available.

### Business model summary (answers 2B, 3B, 5 — proposed)
- Operator earns commission from exchanges as root affiliate.
- Operator shares a configurable percentage of that commission with the UID that generated
  it.
- Cashback accrues to a per-UID wallet with `pending → available → withdrawn`
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
| Referral link | Operator affiliate link a visitor uses to sign up on an exchange. |
| UID | The unique account identifier the exchange assigns to a referred user. Opaque string, not secret. |
| UID account | Platform-side record for one (exchange, UID) pair. Owns the wallet and withdrawals. Has no password. |
| Bound email | Email attached to a UID account after its first successful OTP. Every later withdrawal must use it. |
| OTP | 6-digit single-use code emailed to prove control of an address; short TTL, limited attempts. |
| UID session | Short-lived token issued after a correct OTP, scoped to exactly one UID account. |
| Affiliate report | File exported from the operator's root affiliate account containing UID-level commission/volume data. |
| Import batch | One uploaded report file plus its parsing/validation/publish lifecycle. |
| Staging rows | Parsed-but-not-yet-published rows held for admin preview. |
| Attribution | Mapping imported commission to a UID account. |
| Cashback | The UID's share of commission credited to its wallet. |
| Holding period | Configurable delay before pending cashback becomes available. |
| Worker | Long-running Node.js process that parses reports and runs jobs. |

---

## Actors & roles

| Actor | Description | Auth |
|-------|-------------|------|
| Visitor | Anonymous public user browsing content and looking up a UID's cashback. | None |
| UID claimant | Visitor withdrawing a UID's cashback. Proves email control by OTP; holds a 30-min UID-scoped session. No account. | Email OTP → UID session |
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
  web/            # Next.js 15 App Router (public + lookup/withdraw + admin UI)
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

> Cashback lookup by (exchange, UID) is specified separately in Requirement 14.

### Requirement 2: Referral link redirect & click tracking
**User Story:** As a visitor, I want to open a referral link, so that I am sent
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

### Requirement 3: Admin authentication & principal separation
**User Story:** As the operator, I want admin staff to authenticate while end users need no
account at all, so that operational access is controlled without adding friction for people
claiming cashback.

> **Changed in v0.6.** Customer registration, username, password, and password reset are
> removed; end-user identity is now a UID account proven by email OTP (Requirement 15).
> This requirement covers admin authentication only.

#### Acceptance Criteria
1. THE SYSTEM SHALL authenticate admins with email + credential and SHALL maintain admin
   sessions as server-side records with a hashed token and an expiry.
2. THE SYSTEM SHALL NOT provide any end-user registration, username, or password flow;
   end-user access to money SHALL depend only on a UID session (Requirement 15).
3. THE SYSTEM SHALL verify authorization on the server for every non-public action; THE
   SYSTEM SHALL NOT trust an exchange id, UID, or UID-account id supplied by the browser as
   proof of entitlement.
4. THE SYSTEM SHALL keep admin principals and UID sessions strictly separate: an admin
   session SHALL NOT grant withdrawal rights over a UID, and a UID session SHALL NOT grant
   any admin capability.
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

### Requirement 5: UID accounts (identity of a cashback owner)
**User Story:** As the operator, I want each (exchange, UID) pair to be a first-class record
that owns its wallet and withdrawals, so that cashback can accrue and be claimed without any
platform account.

> **Changed in v0.6.** The previous customer-linking / admin-ownership-approval model is
> removed. Cashback now accrues to the UID itself; ownership is asserted at withdrawal time
> (Requirement 15). See "Accepted risk — first claimant wins".

#### Acceptance Criteria
1. THE SYSTEM SHALL treat a (exchange, UID) pair as the unit of cashback ownership and
   SHALL enforce that at most one UID account exists per pair.
2. THE SYSTEM SHALL treat UID as an opaque string (no numeric coercion) to preserve leading
   zeros and exchange-specific formats, and SHALL scope every UID to its exchange — the same
   UID string on two exchanges SHALL be two distinct UID accounts.
3. WHEN attribution encounters a published commission for a UID that has no UID account yet,
   THE SYSTEM SHALL create the UID account so cashback can accrue to it.
4. THE SYSTEM SHALL NOT create or mutate a UID account as a side effect of a cashback
   lookup; lookups are read-only (Requirement 14.5).
5. THE SYSTEM SHALL attribute cashback to a UID account regardless of whether an email is
   bound; binding is required only to withdraw (Requirement 15).
6. THE SYSTEM SHALL NOT expose a UID account's bound email, payout address, or withdrawal
   history to an unauthenticated caller (Requirement 14.3).

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
   NOT expose it to any public lookup or UID-session read.
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
UID account and converted to cashback at a configurable rate, so that UIDs are
credited correctly.

#### Acceptance Criteria
1. WHEN a batch is published, THE SYSTEM SHALL attribute each commission record to the UID
   account matching (exchange, UID), creating that UID account if it does not yet exist.
2. THE SYSTEM SHALL attribute cashback based only on (exchange, UID) as it appears in the
   published report; THE SYSTEM SHALL NOT require an email binding, a session, or any
   claimant action for cashback to accrue.
3. THE SYSTEM SHALL compute cashback as `commission × cashback_rate`. The rate SHALL be
   resolved with this precedence: (1) the rate of the offer bound to the referral link
   **only when that link is corroborated by system-verified report data (e.g., referral
   code / sub-ID present in the report)**, else (2) the exchange default rate. THE SYSTEM
   SHALL NOT trust any client-supplied link/offer for rate selection, and SHALL require
   `ReferralLink.exchange = Offer.exchange = the commission's exchange`. THE SYSTEM SHALL
   snapshot the resolved rate and offer onto the commission at attribution time, so later
   rate changes do not retroactively alter already-credited cashback.
4. THE SYSTEM SHALL represent all monetary values as decimal/numeric with an explicit
   asset/currency, and APIs SHALL return decimal strings (no float rounding).
5. THE SYSTEM SHALL NOT double-count overlapping report periods; overlapping periods
   SHALL be reconciled before totals are computed.
6. WHEN the same report is re-imported or an overlapping period is imported, THE SYSTEM
   SHALL NOT increase a UID account's attributed cashback beyond the reconciled amount.
7. THE SYSTEM SHALL keep a traceable link from each cashback amount back to its source
   batch/record for auditing.
8. WHEN a corrected report changes a previously published commission amount, THE SYSTEM
   SHALL record a new version that supersedes the prior one, recompute the reconciled
   amount, and apply only the delta to the UID account's cashback (additional credit or a
   reversal), preserving prior versions for audit.

### Requirement 8: Cashback wallet & balance states
**User Story:** As a visitor holding a UID, I want to see that UID's cashback balance and its
status, so that I know what is earned, what is available, and what has been withdrawn.

#### Acceptance Criteria
1. THE SYSTEM SHALL maintain, per UID account and asset, a wallet with balances split into
   `pending`, `available`, `reserved`, `withdrawn`, and a `receivable` (clawback) bucket.
2. WHEN cashback is attributed from a published batch, THE SYSTEM SHALL credit it to
   `pending`.
3. WHEN a pending cashback amount clears its configurable holding period, THE SYSTEM
   SHALL move it from `pending` to `available`.
4. IF a source report is later corrected downward, THEN THE SYSTEM SHALL apply the
   reversal against `pending` first, then `available`; neither balance SHALL go negative.
5. WHEN a lookup returns a UID's cashback, THE SYSTEM SHALL show `pending` and `available`
   balances, the last import time, and the source data "as-of" time; THE SYSTEM SHALL
   distinguish "no data" from a zero value.
6. WHILE a UID session is active, THE SYSTEM SHALL expose that UID's transaction history of
   wallet movements (credit, hold release, withdrawal reserve/release/settle, adjustment,
   reversal, clawback); THE SYSTEM SHALL NOT expose movement history to an unauthenticated
   lookup (Requirement 14.3).
7. IF a downward correction exceeds the UID account's `pending + available` (because cashback
   was already withdrawn/settled), THEN THE SYSTEM SHALL record the uncovered remainder as
   a `receivable` (clawback). WHILE `receivable > 0`, THE SYSTEM SHALL block new
   withdrawals, and subsequent cashback credits SHALL first offset the `receivable` before
   increasing `pending`.

### Requirement 9: Withdrawal flow (fast, with fraud guardrails)
**User Story:** As a UID claimant, I want to withdraw the UID's available cashback to a
crypto address, so that I receive the earnings with minimal delay.

#### Acceptance Criteria
1. WHILE no valid UID session exists for the target UID account, THE SYSTEM SHALL reject
   every withdrawal request, cancel, and history read for it (Requirement 15).
2. WHEN a claimant requests a withdrawal, THE SYSTEM SHALL only allow an amount less than
   or equal to that UID account's `available` balance for the selected asset.
3. THE SYSTEM SHALL require a payout destination (e.g., network + address) and SHALL
   validate its format for the selected asset/network before accepting the request.
4. WHILE a withdrawal request is open, THE SYSTEM SHALL move the requested amount from
   `available` into `reserved` so it cannot be requested twice (no double-spend of the
   same balance).
5. IF this is the **first** withdrawal for the UID account, THEN THE SYSTEM SHALL route it to
   admin manual review regardless of amount and SHALL NOT auto-approve it. ELSE IF the
   requested amount is at or below a configurable auto-approval threshold, THEN THE SYSTEM
   SHALL auto-approve; ELSE THE SYSTEM SHALL route it to admin manual review.
6. WHEN a withdrawal is approved and marked paid, THE SYSTEM SHALL move the amount from
   `reserved` to `withdrawn`; payout execution is **manual by admin in MVP** (mark as
   paid with a reference), automatable later.
7. IF a withdrawal is rejected or cancelled, THEN THE SYSTEM SHALL release the reserved
   amount from `reserved` back to `available`.
8. THE SYSTEM SHALL NOT allow withdrawal of `pending` balance.
9. THE SYSTEM SHALL persist an auditable event for every withdrawal state change, capturing
   from-status, to-status, actor (claimant/admin/system), timestamp, the UID account, the
   email used, and any note/payout reference.
10. WHEN a claimant cancels a withdrawal that has not yet reached `PAID`, THE SYSTEM SHALL
    move it to `CANCELLED` and release the reserved amount back to `available`; IF it is
    already `PAID`, THEN THE SYSTEM SHALL reject the cancel.
11. WHILE a UID account has an outstanding `receivable > 0`, THE SYSTEM SHALL reject new
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

### Requirement 14: Cashback lookup by exchange + UID
**User Story:** As a visitor, I want to enter my exchange and UID and immediately see the
cashback that UID has earned, so that I can decide to withdraw without creating an account.

#### Acceptance Criteria
1. THE SYSTEM SHALL require **both** an exchange selection and a UID to perform a lookup;
   IF either is missing, THEN THE SYSTEM SHALL reject the request and SHALL NOT return any
   balance. A UID without an exchange SHALL NEVER be resolved.
2. WHEN a visitor submits a valid exchange + UID that has attributed cashback, THE SYSTEM
   SHALL return that UID account's `pending` and `available` amounts per asset, the last
   import time, and the source "as-of" time.
3. THE SYSTEM SHALL NOT include in a lookup response: the bound email (in any form), payout
   addresses, withdrawal records or history, wallet movement history, `reserved`/`withdrawn`/
   `receivable` buckets, or any other UID's data.
4. WHILE serving lookups, THE SYSTEM SHALL rate-limit per client IP; IF the limit is
   exceeded, THEN THE SYSTEM SHALL reject further lookups with a retry-after response
   rather than answering.
5. THE SYSTEM SHALL treat lookup as read-only: it SHALL NOT create or mutate a UID account,
   wallet, email binding, OTP, or session.
6. IF the (exchange, UID) has no attributed cashback, THEN THE SYSTEM SHALL return an
   explicit "no cashback data for this UID under our referral links" result, using the same
   response shape whether the UID is unknown or known-with-zero, and SHALL distinguish this
   from a real zero balance per Requirement 8.5.

### Requirement 15: Email OTP binding & UID session
**User Story:** As a UID claimant, I want to prove I control an email address before money
moves, so that later withdrawals for that UID are restricted to me.

#### Acceptance Criteria
1. WHEN a claimant starts a withdrawal for a UID account with **no** bound email, THE SYSTEM
   SHALL accept an email address, generate a 6-digit numeric OTP, store it hashed with an
   expiry, and send it to that address.
2. WHEN a claimant starts a withdrawal for a UID account that **already has** a bound email,
   THE SYSTEM SHALL send the OTP only to the bound email. IF the submitted email does not
   match the bound email, THEN THE SYSTEM SHALL reject the request with a message stating the
   email does not match the one registered for this UID, and SHALL NOT send an OTP to the
   submitted address, and SHALL NOT reveal the bound address.
3. WHEN a submitted OTP is correct and unexpired, THE SYSTEM SHALL mark it consumed, bind the
   email to the UID account if not already bound, and issue a session scoped to **exactly
   that one UID account** with a 30-minute expiry.
4. THE SYSTEM SHALL treat an OTP as single-use and SHALL expire it after a configurable TTL
   (proposed 5 minutes); an expired or already-consumed OTP SHALL be rejected.
5. THE SYSTEM SHALL limit incorrect OTP attempts per OTP (proposed 5); WHEN the limit is
   reached, THE SYSTEM SHALL invalidate that OTP and require a new one.
6. THE SYSTEM SHALL enforce a cooldown between OTP sends for the same UID account and a
   per-UID daily send cap, so OTP sending cannot be used to exhaust the email quota or to
   spam an address.
7. THE SYSTEM SHALL rate-limit OTP sends per client IP independently of the per-UID limits.
8. THE SYSTEM SHALL store only a hash of the OTP; THE SYSTEM SHALL NOT log or return the OTP
   value, and SHALL NOT include it in any API response.
9. THE SYSTEM SHALL route the first withdrawal of a UID account to admin review regardless of
   amount (Requirement 9.5); binding an email SHALL NOT by itself authorise a payout.
10. WHILE a UID session is valid, THE SYSTEM SHALL scope every action to its UID account only;
    THE SYSTEM SHALL derive the UID account from the session, never from a client-supplied
    identifier.
11. WHEN a UID session expires or is used against a different UID account, THE SYSTEM SHALL
    reject the request and require a fresh OTP.

### Requirement 16: Outbound email delivery
**User Story:** As the operator, I want OTP emails delivered reliably through Resend, so that
claimants can complete withdrawals and delivery problems are visible.

#### Acceptance Criteria
1. THE SYSTEM SHALL send transactional email through **Resend**, configured entirely from
   environment variables (API key, from-address), with no secret in the client bundle.
2. THE SYSTEM SHALL send from an operator-owned verified domain. Resend's shared testing
   domain only delivers to the Resend account owner's own address, so it SHALL NOT be used
   for real claimant email.
3. IF the email provider returns an error or times out, THEN THE SYSTEM SHALL NOT create a
   withdrawal in a state that implies an OTP was delivered, and SHALL surface a retryable
   error to the claimant.
4. THE SYSTEM SHALL treat the provider's per-day and per-month send quota as a finite
   resource: THE SYSTEM SHALL apply the limits in Requirement 15.6–15.7 before sending, and
   SHALL surface remaining-quota problems to admins rather than failing silently.
5. THE SYSTEM SHALL NOT include the OTP, wallet balances, payout addresses, or any other
   UID's data in email content beyond what the recipient already controls.
6. THE SYSTEM SHALL record, per OTP send, whether the provider accepted the request and any
   provider message id, for support and audit purposes.

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
- The lookup endpoint SHALL be treated as a known enumeration surface: per-IP rate
  limiting, read-only, and a response restricted to `pending`/`available` amounts and
  freshness timestamps (Req 14).
- OTPs SHALL be stored hashed, single-use, short-TTL, attempt-limited, and never logged
  (Req 15.4–15.8).
- UID sessions SHALL be short-lived, stored server-side as hashed tokens, and scoped to a
  single UID account (Req 15.3, 15.10).

> **Network-exposed services note:** the public site, redirect, cashback lookup, OTP
> endpoints, and admin APIs are internet-exposed. Admin APIs and every withdrawal/history
> action **must** require authentication (admin session or UID session respectively). The
> redirect, public content reads, and the amount-only cashback lookup are intentionally
> anonymous. Do not ship any unauthenticated endpoint that exposes a bound email, payout
> address, withdrawal record, movement history, or import data.

> **Known exposure (accepted):** because lookup returns real amounts for any (exchange,
> UID), the platform leaks per-UID cashback value to anyone who can guess a UID, and
> ownership is effectively first-claimant-wins. This is a recorded business decision — see
> "Accepted risk — first claimant wins". The compensating controls are per-IP rate limiting
> (Req 14.4), mandatory admin review of first withdrawals (Req 9.5), OTP limits
> (Req 15.5–15.7), and the holding period (Req 8.3). Do not weaken these further without
> revisiting that decision.

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
| `POST /api/lookup` | Quick lookup: does this (exchange, UID) have cashback? Boolean only, IP rate-limited. | Public |
| `POST /api/lookup` | Cashback lookup by exchange + UID. Amounts + freshness only; IP rate-limited. | Public |
| `POST /api/otp/request` | Send OTP for a UID withdrawal. Bound email enforced if one exists. | Public (rate-limited) |
| `POST /api/otp/verify` | Verify OTP → bind email + issue 30-min UID session. | Public (rate-limited) |
| `POST /api/admin/auth/*` | Admin login/logout/session. | Public → admin session |
| `GET /api/uid/wallet` | Balances + movement history for the session's UID. | UID session |
| `POST /api/uid/withdrawals` | Request withdrawal of available balance. | UID session |
| `POST /api/uid/withdrawals/:id/cancel` | Cancel a not-yet-paid withdrawal. | UID session |
| `GET /api/uid/withdrawals` | Withdrawal history/status for the session's UID. | UID session |
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
- **UidAccount** — id, exchange ref, UID (opaque string), bound email (nullable until first
  OTP), email-bound-at, created-at. Unique per (exchange, UID). Owns wallets and withdrawals.
  No password, no username.
- **EmailOtp** — UID account ref, email the code was sent to, OTP hash, expiry, consumed-at,
  failed-attempt count, provider message id + accepted flag (Requirement 16.6).
- **UidSession** — UID account ref, hashed token, expiry (30 min). Scoped to exactly one UID
  account; grants no admin capability.
- **RateLimitCounter** — per-IP (and per-UID) counter windows backing lookup and OTP limits
  (Req 14.4, 15.6–15.7). Stores a hashed IP and a window, not a lookup history.
- **Session** — admin server session (subject id, hashed token, expiry); replaced if a managed auth provider is chosen.
- **ImportBatch** — source metadata, file ref, status, totals.
- **StagingRow** — batch ref, parsed row, validation flags.
- **CommissionRecord** — stable identity (exchange, UID, dedup key, period, asset), current
  reconciled amount, attributed UID account (nullable), snapshot offer + cashback rate,
  cashback already credited.
- **CommissionVersion** — per-batch occurrence of a commission (amount, batch ref,
  imported-at, superseded flag); unique per (commission, batch) for idempotent commit;
  preserves import history for reconciliation/audit.
- **Wallet / WalletEntry** — UID account, asset, pending/available/reserved/withdrawn plus a
  `receivable` bucket, and a typed movement log (credit, hold release, withdrawal
  reserve/release/settle, adjustment, reversal, clawback) with a unique operation key per
  entry for idempotent, concurrent-safe application.
- **Withdrawal** — UID account, asset, amount, destination, current status, payout ref, email used.
- **WithdrawalEvent** — per-transition audit (withdrawal ref, from/to status, actor, time,
  note/reference).
- **Job** — type (parse/publish/attribute/release-holds/sync), state, lease, heartbeat, attempts.

---

## Open decisions (to confirm before/while implementing)

| # | Topic | Answer given | What's still needed |
|---|-------|--------------|---------------------|
| 11 | Dedup / reconciliation key | Decide later | Real sample report to fix per-exchange keys. |
| 12 | Customer visibility of UID-level detail | **Resolved (2026-09-16)** | Anyone entering exchange + UID sees that UID's `pending`/`available`; everything else needs a UID session (Req 14.2–14.3). |
| 13 | Auth solution | **Narrowed (2026-09-16)** | End users have no accounts, so this now only covers **admin** auth. Interim email+password + `Session` stays until a provider is chosen. |
| 20 | Outbound email transport | **Resolved (2026-09-16): Resend** | Remaining prerequisites are operational, not design: verify an operator-owned domain with SPF/DKIM (the shared testing domain only delivers to the Resend account owner), set API key + from-address env vars, and confirm the send quota fits expected withdrawal volume (Req 16). |
| 21 | Ownership dispute handling | **Accepted as-is (2026-09-16)** | First claimant wins; there is no ownership proof and no recourse for a displaced true owner. Revisit if losses occur or an exchange-side proof becomes available. |
| 19 | Compliance (KYC/AML, retention, GDPR) | Unclear | Confirm payout KYC and data-retention obligations. |
| — | Cashback rate & holding period values | Rule decided (offer-rate → exchange-default, snapshot at attribution); values pending | Confirm default % and holding-period length. |
| — | Withdrawal auto-approval threshold & assets/networks | Proposed | Confirm threshold, supported assets (USDT?) and networks. |
| — | Lookup rate limit values | Rule decided (per-IP) | Confirm requests-per-window; proposed 5/min, 30/hour per IP. |
| — | OTP tuning values | Rule decided (hashed, single-use, attempt- and send-limited) | Confirm TTL (proposed 5 min), max wrong attempts (proposed 5), resend cooldown, per-UID daily send cap. |
| — | Sample report: format, columns, granularity, timezone | No file yet (8B) | Needed to finalize parser adapters (Req 6). |
| — | Enabling a second locale | English-only decided; Vietnamese excluded | If a market is ever requested, confirm the locale plus who supplies translated UI copy and content. |

---

## Phased roadmap

- **Phase 0 — Smoke/seed (answer 7A):** monorepo scaffold, Next.js 15 + worker + Postgres
  on local and Railway; public site with seeded exchanges/offers; redirect + click
  tracking; admin login (interim auth). No real affiliate data.
- **Phase 1 — Import & attribution:** manual report import pipeline, staging/preview/
  commit, UID accounts, commission attribution.
- **Phase 2 — Lookup, cashback & withdrawals:** cashback lookup by exchange + UID, wallet
  balances + holding period, email OTP + UID session, withdrawal request + admin approval +
  manual payout.
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
- Customer accounts: registration, username, password, password reset, and account-based
  login (removed in v0.6 — end users are identified by UID + email OTP).
- Outbound email beyond the withdrawal OTP: payout notifications, marketing, and
  balance alerts.
- Changing a UID's bound email, and any recourse for a UID claimed by the wrong person
  (Open decision #21).

---

## Assumptions
- Operator holds valid root-affiliate relationships with Binance, MEXC, Bybit
  (answer 7A), with mock/seed data used until real reports arrive.
- Affiliate data is delayed and revisable; "available" balance reflects only cleared
  cashback.
- Each (exchange, UID) is one UID account with one wallet per asset. The same email may be
  bound to several UID accounts (a person may hold UIDs on several exchanges), but a UID
  account has exactly one bound email once set.
- A UID is not secret and the operator has no way to verify its true owner; see "Accepted
  risk — first claimant wins".
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
| 2026-09-16 | requirements.md | Chốt mô hình Hybrid: thêm Req 1.6–1.8 (quick lookup trả boolean, rate limit theo IP, read-only), mục "Access model — hybrid", `POST /api/lookup` vào API surface, `LookupAttempt` vào data model, và "Anti-fraud invariant" nêu rõ quick lookup + admin ownership approval không được nới lỏng đồng thời | Cho khách vãng lai biết mình có cashback để tăng chuyển đổi, nhưng không lộ số tiền nên không tạo đường dò UID có tiền | added |
| 2026-09-16 | requirements.md | Bác phương án UID-first/no-account (bỏ Customer/Session, bind email bằng OTP): giữ nguyên Req 3 (customer account) và Req 5.2 (admin xác nhận ownership) | Mô hình đó xoá lớp chống gian lận đã build/test và buộc re-key Wallet/Withdrawal, đổi lấy bảo mật yếu hơn | updated |
| 2026-09-16 | requirements.md | Thêm Req 3.1 (email+username+password), Req 3.6 (username unique, chỉ để hiển thị, không dùng để auth/authz), Req 3.7 (email là recovery anchor duy nhất; reset password ngoài phạm vi MVP) | Plan Hybrid thu thập username; nêu rõ hệ quả là mất mật khẩu phải nhờ support vì chưa có hạ tầng email | added |
| 2026-09-16 | requirements.md | Thêm Open decision #20 (outbound email transport) và giá trị rate limit quick lookup | Chưa có provider email trong codebase — chặn reset password và mọi mail thông báo; không viết thành SHALL khi chưa chốt | added |
| 2026-09-16 | requirements.md | (v0.5, đã bị v0.6 thay thế) Mô hình Hybrid: quick lookup trả boolean + giữ customer account với username | Ghi lại để không bị đề xuất lại như ý mới | removed |
| 2026-09-16 | requirements.md | **Chuyển sang UID-first (v0.6).** Req 3 viết lại thành "Admin authentication & principal separation" (bỏ đăng ký/username/password/reset cho end user); Req 5 viết lại thành "UID accounts" (bỏ luồng link UID + admin duyệt ownership); Req 1.6–1.8 bỏ vì đã tách sang Req 14 | Chốt mô hình không cần tài khoản: nhập UID + chọn sàn là xem tiền, chỉ xác thực khi rút | updated |
| 2026-09-16 | requirements.md | Thêm Req 14 (lookup theo exchange + UID, trả số tiền thật, bắt buộc có cả sàn, rate limit per-IP, read-only), Req 15 (OTP 6 số hashed/single-use/giới hạn attempt + cooldown + session 30 phút chỉ cho 1 UID), Req 16 (gửi email qua Resend, bắt buộc domain đã verify) | Hiện thực luồng nghiệp vụ đã chốt: search UID → withdraw → nhập email lấy mã → lần sau chỉ nhận mã qua email đã bind | added |
| 2026-09-16 | requirements.md | Cập nhật Req 7 (attribute về UidAccount, tự tạo khi chưa có), Req 8 (wallet theo UidAccount; history chỉ khi có UID session), Req 9 (bắt buộc UID session; lệnh rút ĐẦU TIÊN luôn phải admin duyệt bất kể số tiền) | Tác động chéo của việc bỏ Customer; giữ một lớp kiểm soát cuối trước khi tiền ra | updated |
| 2026-09-16 | requirements.md | Thêm mục "Accepted risk — first claimant wins" và "Known exposure (accepted)" trong Security; API surface đổi sang `/api/lookup`, `/api/otp/*`, `/api/uid/*`; data model đổi sang UidAccount/EmailOtp/UidSession/RateLimitCounter | Chủ dự án chấp nhận rủi ro không xác minh được chủ UID — ghi thành quyết định có ý thức kèm phạm vi thiệt hại, không che | added |
| 2026-09-16 | requirements.md | Open decision #12 resolved, #13 thu hẹp còn admin auth, #20 chốt Resend (còn việc verify domain + quota), thêm #21 (không có đường cứu tranh chấp UID) | Đồng bộ trạng thái quyết định sau khi chốt mô hình | updated |
