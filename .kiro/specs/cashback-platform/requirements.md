# Requirements Document

**Cashback Affiliate Platform**

- **Status:** Draft v0.9 (UID-first; common adapter base, drift policy, change-only API writes)
- **Last updated:** 2026-09-26
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
> requirement lives in `tasks.md`, not here. Operator and tester **happy-path**
> runbook (how to click through the live product) lives in `happy-path-scenarios.md`.

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
- **Report format (answers 8B, 9, 10C):** a real MEXC Referral Data XLSX sample is
  available. Parser adapters must support native exchange exports and a documented
  normalized CSV fallback; approved API data uses the same normalized ingest contract.
  Referral activity snapshots and commission evidence are separate datasets.

### Monorepo structure
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

> This requirement covers admin authentication only; end-user identity is a UID account
> proven by email OTP (Requirement 15).

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

> Cashback accrues to the UID itself; ownership is asserted at withdrawal time
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

### Requirement 6: Affiliate data ingest pipeline
**User Story:** As an admin, I want manual reports and approved API data normalized
through one controlled ingest pipeline, so that referral metrics and verified
commission data are published without corrupting the live dashboard or wallet.

#### Acceptance Criteria
1. WHEN an admin uploads a report via `POST /api/admin/ingest/batches` with source metadata
   (exchange, root account, dataset kind, source method, report type when applicable,
   period, timezone, source as-of time), THE SYSTEM SHALL validate
   admin permission, file type, and size, store the original file in private storage,
   create an `import_batch` and a parse job, and respond `202 Accepted` with a batch id.
2. THE SYSTEM SHALL NOT parse the entire file within the HTTP request; parsing SHALL run
   in the worker.
3. WHEN the worker transforms a raw load (Req 6.23), THE SYSTEM SHALL read UID as
   string, normalize timestamps to UTC (retaining source timezone), normalize
   decimals, and detect error rows, unmapped UIDs, duplicates, and totals into
   staging rows.
4. THE SYSTEM SHALL NOT execute formulas or macros contained in spreadsheet files.
5. WHILE a batch is not committed, THE SYSTEM SHALL keep its data in staging and SHALL
   NOT expose it to any public lookup or UID-session read.
6. WHEN an admin reviews a batch, THE SYSTEM SHALL show its dataset kind, source
   method, report period, source as-of time, new/duplicate/error/conflicting row
   counts, validation totals, and whether it can affect cashback.
7. WHEN an admin commits a batch via `POST /api/admin/ingest/batches/:id/commit`, THE SYSTEM
   SHALL create a publish job that upserts versioned, source-attributed records and
   commits the whole batch atomically.
8. IF a publish job fails midway, THEN THE SYSTEM SHALL NOT leave the dashboard reading
   partial data (all-or-nothing per batch).
9. WHEN the same batch commit is invoked repeatedly, THE SYSTEM SHALL NOT publish
   duplicate data (idempotent commit).
10. THE SYSTEM SHALL support per-exchange parser adapters and multiple file formats
    (CSV, XLSX, extensible — answers 8B, 9), and SHALL distinguish transaction-level
    reports from aggregate reports (answer 10C). Every file or API source SHALL be a
    subclass of one common adapter base that enforces the same read → validate →
    minimize → normalize steps; adding an exchange (e.g. Binance, BingX) SHALL
    require only a new subclass with its field contract, not changes to the ingest
    pipeline, schema, or publish path.
11. IF a report lacks stable identity keys for transaction-level dedup, THEN THE SYSTEM
    SHALL fall back to aggregate handling rather than guessing per-transaction records.
12. WHEN ingesting a MEXC Referral Data export, THE SYSTEM SHALL classify it as a
    period-scoped referral activity snapshot, retain the supplied report period and
    export/as-of time separately, and map `Referral` to an opaque UID string,
    `Trading volume`/`Trading token` to volume, and `Your Earnings`/`Commission token`
    to a reported earnings metric. The worker SHALL reject a file that lacks a required
    header, contains a formula, or has missing/duplicate UIDs, non-numeric or negative
    volume, unsupported units, a missing source timezone or source as-of time, or a sheet
    period that disagrees with admin-supplied metadata. Extra columns SHALL be accepted
    and listed as preview warnings.
13. WHEN a referral activity snapshot is published, THE SYSTEM SHALL make its UID metrics
    available through an admin-only paginated report by exchange and period without creating or changing CommissionRecord,
    CommissionVersion, cashback wallet balances, or withdrawal eligibility. Zero-valued
    rows SHALL remain distinguishable from missing data.
14. WHEN an admin imports the same MEXC period again, THE SYSTEM SHALL preserve the
    original and publish a new version of that period's snapshot without adding its
    volume or earnings to the previous version. The version with the latest source as-of
    time SHALL be current, and an older export SHALL be rejected. Currency applies to the
    whole period: a UID absent from the current version SHALL show as having no data for
    that period, not a value from an older version. A snapshot exported before its
    period ended SHALL be marked partial. Overlapping but different periods SHALL
    remain separate and SHALL NOT be summed as disjoint activity.
15. WHEN commission evidence for an exchange is mapped and verified, THE SYSTEM SHALL
    normalize it to the existing commission publish path; a manually prepared normalized
    CSV and any approved official API commission source SHALL obey the same identity,
    preview, correction, and audit rules as a native export. Referral snapshot `Your
    Earnings` alone SHALL NOT be treated as settled, payable commission.
16. WHEN transforming an exchange export, THE SYSTEM SHALL copy into staging rows and
    snapshots only the columns it maps. Personal columns (for example MEXC nickname,
    user tag, identification level, asset band) SHALL be dropped before the raw layer
    and remain only in the private original file; they SHALL NOT appear in raw
    tables, previews or APIs.
17. WHEN ingesting Bybit Affiliate `aff-user-list`, THE SYSTEM SHALL request an
    explicit `startDate` and `endDate` (without them Bybit returns no period metrics)
    and SHALL preserve each customer's master UID as text, the `source` referral
    code, `tradeVol`, `takerVol`, `makerVol`, and `tradfiTradeVol` in USDT, and
    `commissionsVol` by asset for the requested UTC period as reported activity.
    THE SYSTEM SHALL NOT label `commissionsVol` as the portal's pending or settled
    commission, nor SHALL it credit or reverse cashback from this dataset.
18. WHEN one source row reports several commission assets, THE SYSTEM SHALL retain
    each amount and its asset without duplicating the UID's trading volume. Zero,
    empty, and absent values SHALL remain distinguishable: for API data, a complete
    day plus a known UID without a stored metric means "reported no activity", and a
    day without a complete fetch means "no data". THE SYSTEM MAY therefore omit
    zero/empty API metrics from storage. A partial or failed API page sequence SHALL
    NOT change previously published data.
19. THE SYSTEM SHALL store the fetch completion time (`fetchedAt`) and the response
    `time` separately from source freshness. WHEN `aff-customer-info` returns
    `volUpdateTime` and its timezone has been confirmed, THE SYSTEM SHALL use it as
    the batch `sourceAsOf`, sampling a bounded number of UIDs per run independent
    of roster size; if the samples disagree or fail, `sourceAsOf` SHALL stay
    unknown. A successful request alone SHALL NOT set `sourceAsOf`.
    An admin-published activity correction for the same exact period SHALL take
    precedence over later automatic fetches until the admin releases that override.
20. WHEN reading Bybit Affiliate APIs, THE SYSTEM SHALL NOT store fields outside
    Req 6.17 unless a documented purpose is approved (NĐ 13/2023 data
    minimization). Excluded by default: `depositAmount30Day/365Day`,
    `totalWalletBalance`, `isKyc`/`KycLevel`, `vipLevel`, `remarks`,
    `paySendAmount30Day`, `payFtt`, `cardFtt`. Rolling `*30Day`/`*365Day` values are
    derivable from daily snapshots and SHALL NOT be stored as separate periods.
    `registerTime` is pending an attribution-use decision (Open decisions).
21. WHEN a file header or API response differs from the adapter's field contract,
    THE SYSTEM SHALL classify the difference and SHALL NOT alter published data on
    a breaking change: a new unknown field or asset SHALL be accepted with a warning
    (field names only, never values); a declared alias SHALL be accepted with a
    warning; a missing required field, a type change, or an unparseable required
    value SHALL fail the manual batch, or quarantine the API run and pause that
    exchange's connector with an alert, keeping the last published data visible as
    stale. The difference SHALL be judged when transforming the raw load, not when
    loading it. After a fix, an admin SHALL be able to re-run the transform from the
    stored raw rows; re-fetching API days or re-loading a stored manual original
    SHALL be needed only after those raw rows have expired.
22. WHEN an admin requests activity for a date range, THE SYSTEM SHALL keep each
    manual report at its exact declared period and SHALL aggregate disjoint UTC API
    day buckets overlapping the requested range by exchange, root account, UID,
    metric kind and asset. Since daily API values cannot be prorated, THE SYSTEM
    SHALL mark a report partial when either boundary cuts through a UTC day.
    THE SYSTEM SHALL report day coverage and partial
    status, distinguish a complete day with no activity from an unfetched day,
    and paginate without losing any source/root group for a UID.
23. WHEN any source (manual file or official API) delivers data, THE SYSTEM SHALL
    first store its records unchanged, one payload per record, in the raw table of
    that exchange (`raw_<exchange>`, e.g. `raw_bybit`, `raw_mexc`, `raw_bingx`), with
    load id, load time and source metadata, before any mapping into target tables.
    An exchange without its own raw table SHALL still load into a default raw table.
24. WHEN a new load arrives for the same exchange, dataset kind, source method, root
    account and exact period (for API: one UTC day), THE SYSTEM SHALL replace that
    slice's raw rows and recorded schema with the new load in one transaction, and
    SHALL NOT touch other periods or roots. Loading SHALL NOT fail because columns or
    fields were added, removed, renamed or re-typed; it MAY fail only on format and
    safety rules (unsupported or corrupt file, size/row limits, formulas or macros,
    archive bombs, API transport or authorization errors).
25. WHEN a load is stored, THE SYSTEM SHALL map raw records into the target tables
    in a separate asynchronous worker job. A transform of a load that has since been
    replaced SHALL write nothing. A failed transform SHALL leave published data and
    the raw rows unchanged and record the reason (drift report or safe error code).
26. THE SYSTEM SHALL keep raw rows of a successfully transformed load for 30 days
    (or until the slice is replaced), SHALL never return raw payload values through
    admin or public APIs (field names and counts only), and SHALL let an admin re-run
    the transform of a failed load, with the action audited.

> Commission dedup/reconciliation keys remain pending a real nonzero, UID-level
> commission report. The available MEXC Referral Data sample establishes the activity
> schema only; every volume and earnings value in it is zero.

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
   balances, the last import time, the source data "as-of" time, and the commission vs
   cashback rows in Requirement 14.2; THE SYSTEM SHALL distinguish "no data" from a zero
   value.
6. WHILE a UID session is active, THE SYSTEM SHALL expose that UID's wallet-movement
   history (credit, hold release, withdrawal reserve/release/settle, adjustment, reversal,
   clawback). Unauthenticated lookup MAY show commission vs cashback split rows
   (Requirement 14.2, 14.7) and SHALL NOT show those wallet-movement types
   (Requirement 14.3).
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
6. WHEN an admin edits a referral link, offer, or guide and the current exchange or
   offer is not in the loaded choice list, THE SYSTEM SHALL keep that current id
   selected. THE SYSTEM SHALL NOT submit "No offer", "General", or a different row
   unless the admin explicitly chooses it.

### Requirement 11: Admin analytics & operations dashboard
**User Story:** As an admin, I want dashboards for clicks, imports, attribution, and
withdrawals, so that I can operate the platform.

#### Acceptance Criteria
1. WHEN an admin opens the analytics dashboard, THE SYSTEM SHALL show click activity
   aggregated by link, exchange, and time, read from internal data (not by calling
   exchange APIs on page load).
2. WHILE an admin **operations page** is visible, THE SYSTEM SHALL poll **that
   page's** dashboard APIs every 30 seconds and SHALL pause polling when the tab
   is hidden. THE SYSTEM SHALL NOT poll analytics, imports, and withdrawals
   together unless those pages are each open (Requirement 18.4).
3. WHILE an import batch is processing, THE SYSTEM SHALL let the admin UI poll batch
   status roughly every 5 seconds until it settles.
4. THE SYSTEM SHALL provide a sync-status view showing each exchange's connector
   availability, enabled state, selected interval, last attempt/success, latest
   fetched period, source data "as-of" time when provided, and failure state,
   without returning secrets or full raw reports.
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

### Requirement 13: Scheduled affiliate API sync
**User Story:** As the operator, I want supported exchanges to refresh their affiliate
data automatically at a schedule I choose, while retaining manual imports for exchanges
without a usable API.

#### Acceptance Criteria
1. WHEN an admin configures a supported exchange, THE SYSTEM SHALL offer intervals of
   30 minutes (default), 1 hour, 12 hours, and 24 hours, plus enable/disable and
   "Sync now" controls. The interval SHALL be stored per exchange, not globally.
2. WHILE an exchange lacks an approved official connector or usable credentials,
   THE SYSTEM SHALL keep its API schedule disabled and explain that state to the
   admin. Manual imports SHALL remain available. Bybit Affiliate is the first
   supported connector; MEXC and Binance remain manual until separately verified.
3. WHEN a Bybit schedule is due, THE SYSTEM SHALL enqueue a worker `SYNC` job that
   reads the official Affiliate User List using the affiliate-only, read-only key,
   follows every cursor page, respects Bybit's response rate-limit headers, and
   does not call Bybit during a public or admin page render.
4. WHEN a complete Bybit period fetch succeeds, THE SYSTEM SHALL load it into
   `raw_bybit` as one slice per UTC day (Req 6.23–6.24) and then, asynchronously,
   normalize it through the same adapter and validation boundary as manual reports and write
   only what changed: identical data SHALL write no metric row; a changed value
   SHALL replace the current value for that exact UID/day/metric (never add to it)
   and record the old and new value with the run in an append-only change history;
   a UID missing from a complete fetch SHALL be marked absent for that day. API
   runs SHALL NOT create a full snapshot copy per run. The admin correction
   precedence in Req 6.19 applies.
5. THE SYSTEM SHALL store last attempt, last successful fetch, fetched period,
   response observation time, and source as-of time only when Bybit provides one.
   A successful request SHALL NOT be presented as proof that Bybit's underlying
   volume or commission settlement data is current.
6. THE SYSTEM SHALL serialize runs per exchange and affiliate root, prevent
   duplicate queued/running cycles, and recover from a worker crash without
   publishing a partial result.
7. IF a sync fails twice consecutively or exceeds its allowed time, THEN THE
   SYSTEM SHALL alert, show the last published data as stale, and retry transient
   failures with bounded backoff. Permission, signature, expired-key, and IP
   whitelist failures SHALL pause the connector until configuration is fixed.
8. WHEN an admin changes an interval, disables a schedule, or starts a manual
   run, THE SYSTEM SHALL record the actor and change, apply it without restarting
   Railway, and prevent the control from exposing API credentials.
9. THE SYSTEM SHALL keep API keys on the worker as server-side secrets, minimize
   stored client fields, and never expose credentials, full source responses, or
   other customers' private data through public APIs or logs.
10. (Optional future) THE SYSTEM MAY add SSE (`PostgreSQL NOTIFY → backend → client
    refetch`) for near-real-time UI updates; polling remains sufficient for this plan.
11. WHEN enabling Bybit sync, THE SYSTEM SHALL backfill a bounded initial period
    (default 365 completed UTC days, the history verified on 2026-09-26, in daily
    jobs), expose its coverage to the admin, revisit recent completed periods for
    late corrections, and mark an in-progress calendar day as partial. A short
    interval SHALL NOT imply that Bybit's T+1 volume data has refreshed; commission
    for a day can appear before that day's volume.
12. BEFORE enabling a connector and on every run, THE SYSTEM SHALL check the key via
    `/v5/user/query-api`: `readOnly = 1`, Affiliate as the only permission, and not
    expired. It SHALL refuse a key with any other permission, and SHALL alert at
    least 14 days before `expiredAt`. A key without an IP allowlist expires after 90
    days; production SHALL bind the key to the worker's stable outbound IP.
13. THE SYSTEM SHALL purge successful sync runs without changes after 90 days, keep
    failed or quarantined runs for 1 year, keep the change history as audit, and
    apply the raw-row retention of Req 6.26.

### Requirement 14: Cashback lookup by exchange + UID
**User Story:** As a visitor, I want to enter my exchange and UID and immediately see the
cashback that UID has earned, so that I can decide to withdraw without creating an account.

#### Acceptance Criteria
1. THE SYSTEM SHALL require **both** an exchange selection and a UID to perform a lookup;
   IF either is missing, THEN THE SYSTEM SHALL reject the request and SHALL NOT return any
   balance. A UID without an exchange SHALL NEVER be resolved.
2. WHEN a visitor submits a valid exchange + UID that has attributed cashback, THE SYSTEM
   SHALL return that UID account's `pending` and `available` amounts per asset (what they
   receive), the last import time, the source "as-of" time, and a **transaction table** of
   attributed commissions for that UID: period, asset, **exchange-paid commission**,
   cashback rate, and **cashback shared with the UID**.
3. THE SYSTEM SHALL NOT include in a lookup response: the bound email (in any form), payout
   addresses, withdrawal records, wallet movement types (hold release, reserve, settle,
   clawback), `reserved`/`withdrawn`/`receivable` buckets, or any other UID's data.
4. WHILE serving lookups, THE SYSTEM SHALL rate-limit per client IP; IF the limit is
   exceeded, THEN THE SYSTEM SHALL reject further lookups with a retry-after response
   rather than answering.
5. THE SYSTEM SHALL treat lookup as read-only: it SHALL NOT create or mutate a UID account,
   wallet, email binding, OTP, or session.
6. IF the (exchange, UID) has no attributed cashback, THEN THE SYSTEM SHALL return an
   explicit "no cashback data for this UID under our referral links" result, using the same
   response shape whether the UID is unknown or known-with-zero, and SHALL distinguish this
   from a real zero balance per Requirement 8.5.
7. WHEN the lookup returns attributed cashback, THE SYSTEM SHALL list each attributed
   `CommissionRecord` for that (exchange, UID) so the visitor can see, per period, how
   much the exchange paid versus how much was shared with them
   (`creditedCashback` = that commission × the snapshotted rate). Newest period first,
   cap 100 rows. Empty `transactions` when `hasData` is false.
   WHILE a newer published version exists but ATTRIBUTE has not yet written a wallet
   entry whose `sourceRef` is that version id, THE SYSTEM SHALL show the commission
   amount of the latest applied version, not the in-flight `reconciledAmount`. IF no
   applied entry exists, THE SYSTEM SHALL show commission 0. WHEN more than 100
   attributed rows exist, THE SYSTEM SHALL set `hasMore` and return only the newest 100.

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

### Requirement 17: Public Online Rebate Ledger (social proof)
**User Story:** As a visitor, I want to see a moving stream of large cashback credits
on the home page, so that the product looks active and I am more likely to look up
my own UID.

#### Acceptance Criteria
1. WHEN a visitor opens the home page, THE SYSTEM SHALL render an **Online Rebate
   Ledger** with **100** cashback rows.
2. THE SYSTEM SHALL animate those rows in continuous motion as a marketing ticker
   (not a live exchange feed and not SSE).
3. WHILE live attributed credits are too few to fill a convincing ticker, THE
   SYSTEM SHALL use an **in-repo, deterministic fake set** of 100 rows with
   **large cashback amounts** (hundreds to thousands of USDT) to attract visitors.
   THE SYSTEM SHALL NOT read `WalletEntry` / `CommissionRecord` for this ticker
   in that interim. THE SYSTEM SHALL keep a visible badge that the rows are
   illustrative, not live data.
4. THE SYSTEM SHALL mask every UID in the ledger (partial characters only) and
   SHALL NOT include bound email, payout address, withdrawal records, movement
   history, or `reserved` / `withdrawn` / `receivable`.
5. IF the visitor's client requests reduced motion, THEN THE SYSTEM SHALL show
   the same rows without continuous animation.
6. THE SYSTEM SHALL NOT treat the ledger as a cashback lookup: a visitor still
   uses Requirement 14 (exchange + UID) to see their own `pending` / `available`.
7. WHEN the operator later switches the ticker to live credits, THE SYSTEM SHALL
   drop the fake generator and the illustrative badge in the same change (future
   task — not this interim).

### Requirement 18: Admin operations shell (left navigation)
**User Story:** As an admin, I want a left table of contents for each operations
area, so that the screen is not one long page and I can switch (or open another
tab) to do several jobs without losing my place.

#### Acceptance Criteria
1. WHILE an admin is authenticated, THE SYSTEM SHALL render a **left navigation
   shell** on all admin operations pages except `/admin/login`.
2. THE SYSTEM SHALL split today's stacked `/admin` blocks into **separate
   routes**, one primary job per page. The nav SHALL group pages by operator job,
   not by exchange or file format, and SHALL include at least: Overview
   (analytics); **Data ingest** → Uploads (`/admin/ingest/uploads`) and API
   connectors (`/admin/ingest/connectors`); **Reports** → Referral activity
   (`/admin/reports/activity`); Withdrawal queue; Exchanges; Offers; Referral
   links; Guides.
3. WHEN the admin selects a nav item, THE SYSTEM SHALL show only that section
   in the main pane. This requirement SHALL NOT add money-engine, schema, or
   worker changes.
4. WHILE a section is not mounted, THE SYSTEM SHALL NOT poll that section's
   APIs. Visible-tab polling rules in Requirement 11 apply **per open page**,
   not to every section at once.
5. THE SYSTEM SHALL still deny every `/admin/*` route (except login) and every
   `/api/admin/*` write without an admin session (Requirement 3, 10.1). Route denial
   SHALL happen before page content is produced. A session check only in the shared
   layout is not sufficient, because the page can still be rendered into an RSC
   response. A request with no admin session cookie SHALL be redirected to
   `/admin/login` before render. Each admin page SHALL check the session again before
   reading data or returning its content.
6. English labels only. Parallel work is **multiple browser tabs** of different
   admin routes (same session cookie), not a split-pane or background keep-alive
   of every form on one URL.
7. WHEN an admin uploads a file, THE SYSTEM SHALL offer one upload page for every
   exchange, dataset kind, and file format. The form SHALL show the metadata
   fields and accepted file types of the source adapter registered for the chosen
   exchange and dataset kind; the file format SHALL be taken from the file, not
   chosen from a separate page. Registering a new source adapter (for example a
   JSON file or another exchange) SHALL NOT require a new admin page or route.
   Every batch in the upload list SHALL state its dataset kind and whether it can
   affect cashback.
8. WHEN a request uses a retired admin route (`/admin/imports`,
   `/admin/crawl-data`, `/admin/referrals`, `/admin/sync`), THE SYSTEM SHALL
   redirect it to its replacement after the admin session check. Retired admin API
   paths (`/api/admin/imports*`, `/api/admin/referral-snapshots`,
   `/api/admin/sync-config/*`) SHALL remain aliases with identical behavior and
   authorization until an explicit removal is recorded in the changelog.

---

## Non-functional requirements

### Performance & scale (answer 17B — 1k–50k events/day; target 5,000 transacting UIDs/day)
- Public pages SHALL render server-side and read cached/persisted data, not live
  exchange APIs.
- The redirect endpoint SHALL respond quickly and independently of any sync work.
- The system SHALL comfortably handle the medium-traffic band (1k–50k clicks/day) on a
  single Railway service tier, with room to scale the worker separately.
- WHEN daily transacting UIDs approach **5,000**, THE SYSTEM SHALL keep money
  mutations on a compact OLTP schema and SHALL store append-only transaction
  history as **fact tables partitioned by time**, so lookups and admin analytics
  prune old months instead of scanning one ever-growing heap. Dimension tables
  (exchange, UID account, offer, asset, date) SHALL stay unpartitioned. Current
  wallet **balances** SHALL NOT be partitioned (one row per UID+asset).

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
| `POST /api/lookup` | Cashback lookup by exchange + UID. `pending`/`available`, freshness, and per-period commission vs cashback rows; IP rate-limited. | Public |
| `POST /api/otp/request` | Send OTP for a UID withdrawal. Bound email enforced if one exists. | Public (rate-limited) |
| `POST /api/otp/verify` | Verify OTP → bind email + issue 30-min UID session. | Public (rate-limited) |
| `POST /api/admin/auth/*` | Admin login/logout/session. | Public → admin session |
| `GET /api/uid/wallet` | Balances + movement history for the session's UID. | UID session |
| `POST /api/uid/withdrawals` | Request withdrawal of available balance. | UID session |
| `POST /api/uid/withdrawals/:id/cancel` | Cancel a not-yet-paid withdrawal. | UID session |
| `GET /api/uid/withdrawals` | Withdrawal history/status for the session's UID. | UID session |
| `GET /api/admin/ingest/adapters` | Registered source adapters: exchange, dataset kind, source method, accepted file types, required metadata fields, cashback impact. No credentials. | Admin |
| `POST /api/admin/ingest/batches` | Upload any supported file, create batch + parse job. | Admin (202) |
| `GET /api/admin/ingest/batches` | List batches, filter by exchange, dataset kind, source method, status. | Admin |
| `GET /api/admin/ingest/batches/:id` | Batch status, preview, error rows, drift warnings. | Admin |
| `POST /api/admin/ingest/batches/:id/commit` | Publish a validated batch (idempotent). | Admin |
| `GET /api/admin/reports/activity` | Paginated referral activity by exchange and exact period, manual and API sources combined. | Admin |
| `GET /api/admin/accounts/:id/activity` | Published activity per account/UID. | Admin |
| `GET /api/admin/analytics` | Click metrics for dashboard. | Admin |
| `GET /api/admin/sync-status` | Per-exchange schedule/readiness, last attempt/success, fetched period, source as-of if known, safe error. | Admin |
| `GET/PATCH /api/admin/ingest/connectors/:exchangeId` | Read/update enabled state and one of four allowed intervals. | Admin |
| `POST /api/admin/ingest/connectors/:exchangeId/run` | Queue one immediate run or re-sync range when the connector is available. | Admin |
| `POST /api/admin/ingest/connectors/:exchangeId/resume` | Clear a pause after the cause is fixed. | Admin |
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
- **ImportBatch** — exchange/root, dataset kind, source method, report period,
  timezone, source as-of time, private payload ref, status, totals.
- **StagingRow** — batch ref, parsed row, validation flags.
- **RawLoad / raw_<exchange>** — one load of one slice (exchange, dataset kind, source method, root, period); unchanged source records as payloads, replaced by the next load of the same slice.
- **ReferralSnapshot** — versioned UID-level volume and reported earnings for an exact
  source period; separate from commission and wallet records.
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
| 11 | Commission dedup / reconciliation key | Decide later | Real nonzero UID-level commission report; the MEXC Referral Data sample is an activity snapshot, not payout evidence. |
| 12 | Visitor visibility of UID-level detail | **Decided (2026-09-17)** | Anyone entering exchange + UID sees `pending`/`available` **and** per-period exchange-paid commission vs cashback share (Req 14.2, 14.7). Email, payout address, withdrawals, and wallet-movement types still need a UID session (Req 14.3). |
| 13 | Admin auth solution | Pending | Covers **admin** auth only (end users have no accounts). Interim email+password + `Session` stays until a provider is chosen. |
| 20 | Outbound email transport | **Resolved (2026-09-16): Resend** | Remaining prerequisites are operational, not design: verify an operator-owned domain with SPF/DKIM (the shared testing domain only delivers to the Resend account owner), set API key + from-address env vars, and confirm the send quota fits expected withdrawal volume (Req 16). |
| 21 | Ownership dispute handling | **Accepted as-is (2026-09-16)** | First claimant wins; there is no ownership proof and no recourse for a displaced true owner. Revisit if losses occur or an exchange-side proof becomes available. |
| 19 | Compliance (KYC/AML, retention, GDPR) | Unclear | Confirm payout KYC and data-retention obligations. |
| — | Cashback rate & holding period values | Rule decided (offer-rate → exchange-default, snapshot at attribution); values pending | Confirm default % and holding-period length. |
| — | Withdrawal auto-approval threshold & assets/networks | Proposed | Confirm threshold, supported assets (USDT?) and networks. |
| — | Lookup rate limit values | Rule decided (per-IP) | Confirm requests-per-window; proposed 5/min, 30/hour per IP. |
| — | OTP tuning values | Rule decided (hashed, single-use, attempt- and send-limited) | Confirm TTL (proposed 5 min), max wrong attempts (proposed 5), resend cooldown, per-UID daily send cap. |
| — | MEXC Referral Data semantics | XLSX sample received 2026-09-25: 46 unique UIDs, sheet period 2026-09-18 through 2026-09-25, all volume/earnings zero | Confirm source timezone and whether `Trading volume`/`Your Earnings` are period values with a nonzero export before treating them as financial evidence. |
| — | Bybit API commission settlement | `commissionsVol` is available per UID/asset/period; the API does not expose the Affiliate Portal's pending/settled state | Reconcile a nonzero portal export and decide separately whether API amounts can ever drive automatic cashback. The scheduled connector in Req 13 publishes admin activity only. |
| — | Bybit `volUpdateTime` timezone | Probe 2026-09-26 03:03 UTC: every UID in the roster (54 at the time) returned the same `volUpdateTime = 2026-09-26 00:00:00` with no zone, so it is a dataset-wide mark; the connector samples up to 3 UIDs per run regardless of roster size | Confirm UTC vs UTC+8 before using it as `sourceAsOf` (Req 6.19). |
| — | Bybit `registerTime` / `isKyc` | Available per UID in `aff-user-list`; excluded by Req 6.20 | Store `registerTime` only if attribution needs sign-up date vs click; `isKyc` needs a stated purpose. |
| — | Bybit key IP binding | Current key: read-only, Affiliate only, IP `*`, expires 2026-12-26 | Provide stable Railway egress IP and rebind before production sync (Req 13.12). |
| — | Enabling a second locale | English-only decided; Vietnamese excluded | If a market is ever requested, confirm the locale plus who supplies translated UI copy and content. |

---

## Phased roadmap

- **Phase 0 — Smoke/seed (answer 7A):** monorepo scaffold, Next.js 15 + worker + Postgres
  on local and Railway; public site with seeded exchanges/offers; redirect + click
  tracking; admin login (interim auth). No real affiliate data.
- **Phase 1 — Import & attribution:** manual native/normalized report import,
  dataset-specific staging/preview/
  commit, UID accounts, commission attribution.
- **Phase 2 — Lookup, cashback & withdrawals:** cashback lookup by exchange + UID, wallet
  balances + holding period, email OTP + UID session, withdrawal request + admin approval +
  manual payout.
- **Phase 3 — Hardening:** analytics depth, KYC/compliance controls,
  observability/backups. No locale rollout is planned (Requirement 4).
- **Phase 4 — Automation:** scheduled Bybit Affiliate API activity sync with
  per-exchange admin intervals; add other official connectors only after their
  permissions and data semantics are verified. SSE remains optional.

---

## Out of scope for MVP
- Any non-English locale, including Vietnamese (Requirement 4). Only the i18n seams ship.
- Real-time exchange event streaming and market-data WebSockets.
- Bot filtering / unique-click analytics (answer 18).
- Automated on-chain payout execution (manual in MVP).
- Multi-tier admin roles (single role — answer 14A).
- End-user accounts (registration, username, password, password reset); end users are
  identified by UID + email OTP.
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
| 2026-09-15 | requirements.md | Tạo bộ requirement EARS đầu tiên: reserved balance + withdrawal event audit (Req 8/9), rule cashback rate + snapshot (Req 7.3, 7.8), best-effort click (Req 2.2), versioned commission, receivable/clawback + chặn rút (Req 8.7, 9.11), cancel withdrawal (Req 9.10); English-only + locale registry (Req 4, 10.5) | Khởi tạo spec, khắc phục review round 1–2; sản phẩm không phục vụ tiếng Việt nhưng giữ seam i18n | added |
| 2026-09-16 | requirements.md | Chốt mô hình UID-first, không tài khoản end user: Req 3 chỉ còn admin auth, Req 5 thành UID accounts, thêm Req 14 (lookup exchange + UID trả số tiền thật, rate limit per-IP, read-only), Req 15 (OTP 6 số + UID session 30 phút), Req 16 (email qua Resend); cập nhật Req 7/8/9 theo UidAccount, lệnh rút đầu tiên luôn admin duyệt; thêm "Accepted risk — first claimant wins"; đồng bộ API surface, data model, Open decision #12/#13/#20/#21 | Nhập UID + chọn sàn là xem tiền, chỉ xác thực khi rút; chủ dự án chấp nhận rủi ro không xác minh được chủ UID. Mô hình customer account/Hybrid trước đó đã bỏ | updated |
| 2026-09-17 | requirements.md | Trỏ sang `happy-path-scenarios.md`; thêm Req 17 (Online Rebate Ledger, interim 100 hàng fake có badge illustrative); Req 14.2/14.7 + 8.5/8.6 lookup trả bảng commission vs cashback; NFR scale 5,000 UID/ngày (fact partition theo thời gian) | Social proof, visitor cần thấy sàn trả bao nhiêu và mình nhận bao nhiêu, tránh heap phình | updated |
| 2026-09-19 | requirements.md | Thêm Requirement 18: admin left-nav + tách route; poll theo trang; API/schema/worker không đổi. Sửa 11.2 poll theo section | `/admin` một trang quá dài; không đụng kiến trúc tiền | added |
| 2026-09-22 | requirements.md | Req 18.5 chặn `/admin` trước khi render (kể cả RSC không cookie), mỗi page kiểm tra session; Req 10.6 giữ offer/exchange đang chọn ngoài trang đã tải; Req 14.7 lookup hiện commission của version đã có bút toán `attr:{versionId}`, không có thì 0, thêm `hasMore` | Ba lỗ hổng P2 và review: lộ RSC admin, gỡ nhầm offer, lộ số chưa attribute | updated |
| 2026-09-25 | requirements.md | Req 6 tách referral activity snapshot khỏi commission evidence; native MEXC XLSX (thiếu header mới reject, cột thừa chỉ cảnh báo, bắt buộc tz + as-of, reject formula), current theo as-of và theo cả period, cờ partial, normalized CSV fallback và API tương lai qua cùng ingest contract; thêm 6.16 tối thiểu hóa dữ liệu cá nhân; cập nhật Open decision #11. Compact tài liệu, bỏ lịch sử mô hình cũ | File MEXC thật có 46 UID nhưng toàn bộ volume/earnings bằng 0, chưa chứng minh hoa hồng được trả | updated |
| 2026-09-26 | requirements.md | Req 13 chốt Bybit Affiliate API sync theo lịch riêng từng sàn (30m mặc định, 1h/12h/24h), admin điều khiển và xem freshness; Req 6.17–6.18 giữ UID/volume/commission nhiều tài sản như activity, không ghi ví; MEXC/Binance vẫn manual | Key Affiliate read-only đã gọi được; API không cung cấp pending/settled commission | updated |
| 2026-09-26 | requirements.md | Probe Bybit API thật (read-only): Req 6.17 thêm takerVol/makerVol/tradfiTradeVol và bắt buộc startDate+endDate; 6.19 dùng `volUpdateTime` của aff-customer-info làm sourceAsOf khi xác nhận timezone; thêm 6.20 danh sách field loại trừ (deposit, wallet balance, KYC, VIP, remarks); 13.11 backfill mặc định 365 ngày; thêm 13.12 kiểm tra key qua query-api, cảnh báo hết hạn, bind IP; thêm 3 open decision | Key hiện tại IP `*` hết hạn 2026-12-26; lịch sử ≥ 1 năm; tổng theo ngày khớp truy vấn khoảng; freshness có sẵn trong API | updated |
| 2026-09-26 | requirements.md | Req 6.10 mọi nguồn file/API kế thừa một adapter base chung, thêm sàn chỉ cần subclass; 6.18 cho phép không lưu metric 0/rỗng của API, nghĩa "không hoạt động" suy từ ngày đầy đủ + roster; thêm 6.21 chính sách schema drift (thêm field/asset cảnh báo, alias cảnh báo, breaking thì fail/quarantine + pause, re-parse/re-fetch sau khi sửa); 13.4 API chỉ ghi phần thay đổi + change history, không chép snapshot mỗi run; thêm 13.13 retention | Sync 30 phút không sinh rác; sàn đổi format không hỏng dữ liệu đã publish | updated |
| 2026-09-26 | requirements.md | Req 18.2 đổi nhãn điều hướng sang Commission imports và Sync schedules; tên sàn nằm trong nội dung connector/importer đang hỗ trợ | Menu admin mô tả chức năng chung, không cố định theo Bybit | updated |
| 2026-09-26 | requirements.md | Req 18.2 đổi Referral activity thành Crawl data tại `/admin/crawl-data` | Tên menu dễ hiểu hơn cho dữ liệu affiliate từ các sàn | updated |
| 2026-09-26 | requirements.md | Req 18.2 nhóm menu theo việc vận hành: Data ingest (Uploads, API connectors) và Reports (Referral activity), bỏ Commission imports/Crawl data/Sync schedules; 18.3 bỏ ràng buộc giữ nguyên `/api/admin/*`; thêm 18.7 một trang upload cho mọi sàn/loại dữ liệu/định dạng, form dựng theo adapter đã đăng ký, thêm adapter không cần trang mới; thêm 18.8 redirect route cũ và giữ API cũ làm alias; Req 6.1/6.7 và bảng API dùng `/api/admin/ingest/*`, `/api/admin/reports/activity` | Tách theo định dạng (crawl-data/xlsx, /api, /json) nhân bản UI và vô hiệu hóa adapter framework; "crawl" sai nghĩa vì hệ thống không scrape | updated |
| 2026-09-26 | requirements.md | Req 6.22 chốt báo cáo khoảng: manual theo kỳ chính xác, API cộng ngày UTC rời nhau kèm coverage/partial và phân trang không mất root/source | Sửa lỗi báo cáo không thấy API nhiều ngày và bỏ dòng khi UID có nhiều nhóm | updated |
| 2026-09-26 | requirements.md | Thêm Req 6.23–6.26: mọi nguồn ghi bản ghi nguyên trạng vào bảng raw theo sàn trước khi vào bảng đích; load mới ghi đè dữ liệu và schema của đúng slice, không fail vì đổi cột (chỉ fail vì định dạng/an toàn); transform sang bảng đích chạy async, load bị thay thế không ghi gì; raw giữ 30 ngày, không lộ payload, admin chạy lại transform; sửa 6.3, 6.16, 6.21, 13.4, 13.13 và danh sách entity cho khớp | Cấu trúc dữ liệu các sàn có thể đổi; bước import không được fail và lỗi mapping sửa được mà không cần tải lại | added |
