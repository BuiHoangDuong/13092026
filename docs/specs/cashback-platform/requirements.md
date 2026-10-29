# Requirements Document

**Cashback Affiliate Platform**

- **Status:** Draft v0.9 (UID-first; common adapter base, drift policy, change-only API writes)
- **Last updated:** 2026-10-30
- **Access model:** Khách chỉ tra cứu công khai theo sàn + UID và nhận chi trả tự động về UID sàn; không tài khoản, email binding, phiên UID, ví riêng hoặc tự rút tiền. Admin dùng xác thực admin.
- **Accepted risk:** Người biết sàn + UID xem được số cashback công khai; không có claim UID.
- **Product language:** English only — English is the single enabled locale; the
  architecture stays i18n-ready but no additional locale ships
- **Architecture context source of truth:** `architecture.html` at repo root

> This document uses EARS-style acceptance criteria so it can be consumed directly by
> AI coding agents (Claude / Codex / agy) and by humans. Implementation status per
> requirement lives in `tasks.md`, not here. Operator and tester **happy-path**
> runbook (how to click through the live product) lives in `happy-path-scenarios.md`.

---

**Cách rà soát specs (2026-10-14):** Người dùng tự đọc và báo nội dung cần sửa; không hỏi xác nhận ở từng bước. Dark Aurora và calculator theo plan (#23–25, Req 19–20) đã triển khai Docker local; đổi tên (#22) và Req 21 còn đang rà soát. Hoàn thiện requirements → design → tasks trước code; trạng thái kiểm tra ở Task 40.

## Introduction

### Purpose
Build a cashback affiliate platform for crypto exchanges. The operator is a **root
affiliate** on Binance, MEXC, and Bybit. Users sign up to exchanges through the
operator's referral links; the operator receives affiliate commission from the
exchanges and shares a configurable portion back to the UID that generated it as cashback.

The platform lets visitors discover exchanges/offers, obtain referral links, look up the
cashback their exchange UID has earned **without creating an account**, and receive
scheduled payments to the same exchange UID without requesting a withdrawal. Admins manage content, import
affiliate reports, review payments requiring approval, and operate the cashback/withdrawal pipeline.

### Scope — MVP is the full loop (answer 1D)
The MVP includes the full cashback loop: public discovery, click tracking, UID cashback
lookup, affiliate report import, commission attribution, cashback wallet and scheduled payments;
Khách chỉ tra cứu công khai và nhận chi trả tự động về UID sàn. Real exchange API integration is deferred; the MVP launches
with a **smoke/seed phase** (answer 7A) using mock/seed data and manual report import
before wiring real affiliate data.

### Access model — UID-first, no customer accounts
- There is **no customer registration, username, password, or password reset**. Cashback is
  owned by a (exchange, UID) pair, not by a platform account.
- **Lookup requires both exchange and UID.** A UID alone is never sufficient; the same UID
  string on a different exchange is a different subject (Requirement 14).
- Lookup shows **actual customer cashback and aggregate paid amounts** for that UID. This is deliberate
  and is the accepted risk recorded below.
- Khách không có truy cập riêng tư; Wallet là sổ nội bộ phục vụ attribution, đối soát và chi tự động.

- From the first payment onward, totals <=20 USD may auto-pay when all controls pass; >20 USD requires admin approval (Req 9.5/22.32). Internal UID payouts follow the daily schedule.
- Admin authentication is unchanged and still required for all admin routes.

### Accepted risk — công khai cashback theo UID
- UID không bí mật; ai nhập đúng sàn + UID đều xem số liệu cho phép theo Req 14.
- Không claim/bind UID hoặc xác minh chủ UID qua email; tiền chỉ về UID nguồn theo Req 22.25/35.
- Giữ rate-limit lookup, holding/release, receivable, source/recipient readiness, audit và duyệt theo số tiền. Bảo toàn lịch sử thanh toán và queue admin legacy.

### Business model summary (answers 2B, 3B, 5 — proposed)
- Operator earns commission from exchanges as root affiliate.
- Operator shares a configurable percentage of that commission with the UID that generated
  it.
- Cashback accrues to a per-UID wallet with `pending → available → withdrawn`
  states trong sổ nội bộ; USDT tự trả về UID cùng sàn (Req 22).
- Cashback mới attribution giữ pending qua holding period trước khi đủ điều kiện chi tự động.

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
  web/            # Next.js 15 App Router (public + lookup công khai + admin UI)
  worker/         # long-running Node.js process (parse/publish/attribute jobs)
packages/
  contracts/      # shared request/response + report schemas (no secrets)
  core/           # services, normalization, cashback logic (shared by web + worker)
  db/             # Prisma schema + migrations
infra/            # Docker Compose (local), Railway config, reverse proxy
architecture.html # handoff document
docs/specs/      # this spec
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

> Requirement này chỉ xác thực admin; sàn + UID là khóa tra cứu, không phải principal khách đăng nhập.

#### Acceptance Criteria
1. THE SYSTEM SHALL authenticate admins with email + credential and SHALL maintain admin
   sessions as server-side records with a hashed token and an expiry.
2. THE SYSTEM SHALL không cung cấp tài khoản, email binding, phiên UID hay ví riêng cho khách; chi theo lịch không phụ thuộc khách đăng nhập.
3. THE SYSTEM SHALL verify authorization on the server for every non-public action; THE
   SYSTEM SHALL NOT trust an exchange id, UID, or UID-account id supplied by the browser as
   proof of entitlement.
4. THE SYSTEM SHALL giới hạn admin session cho thao tác admin được cấp quyền; khách không có quyền sửa dữ liệu hoặc ra lệnh chi.
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
**User Story:** Là operator, tôi muốn mỗi cặp sàn + UID có sổ cashback riêng trong hệ thống để tích lũy và chi tự động mà không có tài khoản khách.

> Cashback thuộc cặp sàn + UID; không có bước claim hoặc xác thực khách trước chi tự động.

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
5. WHEN commission hợp lệ được attribution, THE SYSTEM SHALL ghi cashback cho UID mà không yêu cầu thao tác xác nhận từ khách.
6. THE SYSTEM SHALL chỉ công khai các trường Req 14; định danh, đích chi và lịch sử từng lệnh SHALL chỉ dành cho admin được cấp quyền.

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
   NOT expose it to any public lookup.
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
**User Story:** Là operator, tôi muốn sổ ví nội bộ bảo toàn cashback theo UID/tài sản để attribution, release và đối soát chi tự động; khách xem tổng công khai theo Req 14.

#### Acceptance Criteria
1. THE SYSTEM SHALL maintain, per UID account and asset, a wallet with balances split into
   `pending`, `available`, `reserved`, `withdrawn`, and a `receivable` (clawback) bucket.
2. WHEN cashback is attributed from a published batch, THE SYSTEM SHALL credit it to
   `pending`.
3. WHEN a pending cashback amount clears its configurable holding period, THE SYSTEM
   SHALL move it from `pending` to `available`.
4. IF a source report is later corrected downward, THEN THE SYSTEM SHALL apply the
   reversal against `pending` first, then `available`; neither balance SHALL go negative.
5. WHEN tra cứu cashback, THE SYSTEM SHALL hiển thị các tổng và bảng tối giản theo Requirement 14, kèm thời điểm publish/as-of và phân biệt thiếu dữ liệu với báo cáo 0; không gọi số chưa trả là tiền đã nhận.
6. THE SYSTEM SHALL chỉ cung cấp lịch sử biến động ví nội bộ cho admin có quyền; lookup chỉ gồm số liệu Req 14, không có movement types.
7. IF a downward correction exceeds the UID account's `pending + available` (because cashback
   was already withdrawn/settled), THEN THE SYSTEM SHALL record the uncovered remainder as
   a `receivable` (clawback). WHILE `receivable > 0`, THE SYSTEM SHALL block new
   withdrawals, and subsequent cashback credits SHALL first offset the `receivable` before
   increasing `pending`.

### Requirement 9: Scheduled payment execution and guardrails
**User Story:** Là người vận hành, tôi muốn tự trả cashback theo lịch và xử lý approval trên sổ chung, để khách không cần yêu cầu rút tiền.

> Câu 13: không có customer withdrawal/cancel/partial. Withdrawal nếu tiếp tục dùng chỉ là execution/legacy history. Runtime cũ phải cutover theo Req 22.24/35.

#### Acceptance Criteria
1. THE SYSTEM SHALL dùng system authority cho worker payouts và xác thực admin cho admin commands; khách chỉ tra cứu công khai, không có private wallet/history API.
2. WHEN lên lệnh theo lịch, THE SYSTEM SHALL lấy toàn bộ phần tiền đủ điều kiện của nhóm sàn + UID + tài sản tại cutoff từ CustomerPayable; SHALL NOT nhận amount hoặc yêu cầu rút một phần từ khách, không chi quá nguồn khả dụng/chưa phân bổ.
3. THE SYSTEM SHALL verify the destination snapshot; internal USDT SHALL go to the same exchange + UID owning the cashback. Customer requests SHALL NOT change payout UID/address/asset. Proposed on-chain channels remain separately gated.
4. WHEN an authorised execution claims payables, THE SYSTEM SHALL reserve eligible funds once atomically under Req 22.21; payable sync alone SHALL NOT reserve money.
5. IF a valid policy valuation of the complete payment execution (fixed 1:1 for internal USDT under Req 22.34, market quotes where required) is less than or equal to 20 USD and all other controls pass, THEN THE SYSTEM MAY auto-approve and proceed to payment from the first payment onward; ELSE THE SYSTEM SHALL require manual approval. THE SYSTEM SHALL NOT require admin review solely because this is the UID account's first payment. Exactly 20 USD is eligible for auto-approval; an amount greater than 20 USD or missing/stale valuation where a market quote is required SHALL NOT auto-approve. No other per-asset threshold SHALL replace this rule; internal USDT uses its fixed 20 USDT equivalent under Req 22.34. First-payment status and cancelled/rejected prior requests SHALL NOT impose a separate initial-review gate. Internal UID payments SHALL still follow schedule and recipient-readiness rules in Req 22.25–36.
6. WHEN transfer success is verified under Req 22.9, THE SYSTEM SHALL settle reserved to withdrawn once; approval/acceptance alone SHALL NOT settle. Admin/manual and automatic executions use the same rule.
7. IF admin rejects/cancels an execution proven not dispatched, THE SYSTEM SHALL release its allocations once after applying corrections; unpaid entitlement SHALL remain on the same payable.
8. THE SYSTEM SHALL NOT pay pending cashback before release.
9. THE SYSTEM SHALL audit every execution state change with from/to status, admin/system actor, time, UID/source account and reference; customer email/session SHALL NOT be required for scheduled payout audit.
10. THE SYSTEM SHALL reject customer create/cancel-withdrawal actions kể cả request từ client cũ. Admin cancellation SHALL be pre-DISPATCHING with proof of no submission; DISPATCHING/SUBMITTED/UNKNOWN/PAID cannot be cancelled under Req 22.22.
11. WHILE receivable > 0, THE SYSTEM SHALL block new payment execution; already-submitted transfers SHALL still be reconciled.

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

> **Lịch đã chốt cho USDT nội bộ (Req 22.26/28):** một đợt mỗi ngày lúc 23:00 UTC (UTC+0); bỏ lỡ đợt thì chờ 23:00 UTC kế tiếp, không tự gửi bù ngay. Lịch cho đề xuất on-chain Req 21 chưa được quyết định bởi lựa chọn này.

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
   Retrying a job SHALL NOT authorize another money transfer: internal USDT payout retries
   SHALL follow the next-slot rule in Req 22.31; uncertain outcomes SHALL be reconciled first.
6. THE SYSTEM SHALL use a PostgreSQL-backed job queue for launch scale; Redis/BullMQ is
   only to be evaluated if throughput/backlog grows.
7. WHEN triển khai sổ khoản phải trả Req 22, THE SYSTEM SHALL nối các thay đổi ingest/commission/cashback đã commit sang tác vụ đồng bộ `CustomerPayable` bền vững trong PostgreSQL; đồng bộ và command chi trả auto/manual SHALL chạy async theo Req 22.16–22.20, không dùng tác vụ chỉ lưu trong bộ nhớ hoặc fire-and-forget.

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
   admin. Manual imports SHALL remain available. Bybit and MEXC Affiliate have
   separate official API connectors. Binance SHALL support a GET-only connector:
   read-only key checks and Spot/Futures API fetches, including empty responses,
   without requiring verified affiliate customers to enable a run. Binance SHALL
   retain minimized raw records and counts for reconciliation, and SHALL NOT
   publish UID metrics or credit wallets until customerId-to-UID mapping and
   period semantics are verified. Manual commission imports remain available.
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
   WHEN configuring ingestion, THE SYSTEM SHALL let the admin select a registered
   exchange and save its own Manual (`enabled=false`) or Scheduled mode and
   interval. Exchanges without an implemented API connector SHALL allow disabled
   interval preferences only and clearly explain that API sync is unavailable.
   An interval change SHALL reset the next scheduled run for that exchange only.
   Manual mode SHALL prevent queued scheduled, backfill and reconciliation jobs
   from starting further automatic requests; an already running request may finish.
   WHEN an admin selects an integrated exchange, THE SYSTEM SHALL provide `Pause sync`
   and `Resume sync` for that exchange only. An admin pause SHALL persist separately
   from error pauses, retain saved mode/interval, and block new scheduled/manual/resync
   runs plus queued jobs; an already fetching day slice may finish, then the running
   job SHALL stop before its next day. Readiness updates, key rotation and saving
   settings SHALL NOT clear an admin pause. Resuming an admin pause SHALL NOT need
   fresh readiness or clear an unresolved error pause; actual runs still require
   readiness. Pause/resume SHALL record the actor atomically with the state change.
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
12. BEFORE enabling the Bybit connector and on every Bybit run, THE SYSTEM SHALL check the key via
    `/v5/user/query-api`: `readOnly = 1`, Affiliate as the only permission, and not
    expired. It SHALL refuse a key with any other permission, and SHALL alert at
    least 14 days before `expiredAt`. IF the key has no IP allowlist, THEN THE
    SYSTEM SHALL warn the admin and show its expiry, but SHALL NOT block sync
    solely because the allowlist is absent.
13. THE SYSTEM SHALL purge successful sync runs without changes after 90 days, keep
    failed or quarantined runs for 1 year, keep the change history as audit, and
    apply the raw-row retention of Req 6.26.
14. WHILE API credentials exist only on the worker, THE SYSTEM SHALL have the
    worker check and persist a recent, secret-free connector readiness result for
    the admin page and controls. The web service SHALL NOT require the worker's
    API key, secret, or affiliate root UID. IF the worker has not checked recently
    or reports a failed check, THEN THE SYSTEM SHALL prevent enabling or starting
    a sync and show a specific safe reason (including missing credentials, key
    permission/expiry, or an actual Bybit IP rejection) instead of a generic
    readiness error.
    WHEN the worker's check becomes ready, THE SYSTEM SHALL allow the admin to
    enable the schedule without copying credentials to the web service.
15. WHEN MEXC affiliate credentials are configured on the worker, THE SYSTEM SHALL
    check access with a signed, read-only affiliate referral request before enabling
    its schedule. A MEXC sync SHALL request explicit UTC day boundaries, follow all
    pages, retain only UID, referral code, USDT trading volume and reported USDT
    commission, and publish fully fetched day slices through the existing raw activity and
    change-history path. It SHALL NOT create payable commission or wallet entries.
    An incomplete or malformed page SHALL quarantine the run; auth failures SHALL
    pause the connector. MEXC keys SHALL be separate from Bybit keys and absent
    from the web environment. A returned UID with zero amounts SHALL remain visible
    as reported zero; missing rows SHALL remain distinguishable from zero.
    The schedule SHALL remain disabled until nonzero daily values are reconciled
    against the affiliate portal/export; activity SHALL never become payable commission.

### Requirement 14: Tra cứu cashback công khai theo sàn + UID
**User Story:** Là khách truy cập, tôi muốn xem cashback theo ngày báo cáo gần nhất của sàn và tổng đã trả cho UID, không tạo tài khoản hoặc yêu cầu rút tiền.

#### Acceptance Criteria
1. WHEN khách tra cứu, THE SYSTEM SHALL yêu cầu cả sàn và UID; IF thiếu một trong hai, THE SYSTEM SHALL từ chối và không trả số liệu. UID SHALL giữ nguyên chuỗi, kể cả số 0 đầu.
2. WHEN xác định ngày báo cáo D của sàn, THE SYSTEM SHALL chọn ngày UTC gần nhất không muộn hơn hôm qua UTC có `ImportBatch` với `datasetKind=COMMISSION`, `status=PUBLISHED`, phủ trọn `[D,D+1)` và có chi tiết ngày (`periodEnd − periodStart ≤ 1 ngày` hoặc `reportType=TRANSACTION`); batch SHALL không partial (`sourceAsOf IS NULL` hoặc `sourceAsOf >= periodEnd`). D SHALL dựa trên coverage của sàn, không phụ thuộc UID có commission hay không.
3. WHEN trả kết quả, THE SYSTEM SHALL trả `summaryPeriods { reportDay, rollingStart, end }`, trong đó `reportDay=D`, `rollingStart=D−29`, `end=D+1` theo UTC; IF chưa có D, THE SYSTEM SHALL trả cả ba trường null. WHEN `hasData=true` theo AC6, THE SYSTEM SHALL trả và hiển thị cho mỗi tài sản `previousDay` (giữ tên metric, kỳ `[D,D+1)`) và `rolling30Days` (kỳ `[D−29,D+1)`), tính từ `creditedCashback` đã attribution theo kỳ nguồn; kèm freshness/publish/as-of và `totalPaid=Wallet.withdrawn`. Settle payables SHALL cộng vào Wallet.withdrawn, không cộng execution/payable lần hai.
4. WHILE phục vụ lookup, THE SYSTEM SHALL áp rate-limit theo IP bằng counter độc lập cho từng độ dài cửa sổ; IF vượt hạn mức, THE SYSTEM SHALL trả 429 kèm Retry-After, không tính lookup.
5. WHEN tra cứu, THE SYSTEM SHALL chỉ đọc dữ liệu nghiệp vụ, không tạo/sửa UID account, Wallet hoặc sổ tiền; counter rate-limit là ghi kỹ thuật được phép.
6. IF cặp (sàn, UID) chưa có bất kỳ cashback đã attribution nào, dù UID không tồn tại hay đã biết nhưng chưa có cashback, THE SYSTEM SHALL trả `hasData=false` và thông điệp "no cashback data for this UID under our referral links", cùng response shape và dữ liệu rỗng cho cả hai trường hợp; SHALL không tiết lộ UID nào thuộc nền tảng. WHEN cặp (sàn, UID) đã có cashback được attribution, THE SYSTEM SHALL trả `hasData=true`, không phụ thuộc số dư hiện tại dương hay bằng 0. WHEN `hasData=true`, THE SYSTEM SHALL mới trả/hiển thị metric: IF D đã xác nhận coverage mà UID không có dòng commission trong kỳ tương ứng, THE SYSTEM SHALL trả `REPORTED` với amount 0; IF sàn chưa có D hợp lệ, THE SYSTEM SHALL trả `NO_DATA` với amount null. Coverage của sàn SHALL không tự biến UID chưa có cashback attribution thành `hasData=true`.
7. WHEN `hasData=true`, THE SYSTEM SHALL trả bảng mới nhất trước, tối đa 100 dòng và `hasMore`, chỉ gồm id kỹ thuật, ngày/kỳ nguồn, tài sản, UID và `creditedCashback`; bảng UI chỉ có ngày/kỳ, tài sản, UID, tiền khách nhận. THE SYSTEM SHALL không công khai commission, rate, volume, email, địa chỉ nhận, lịch sử lệnh chi, movement types hoặc bucket `pending/available/reserved/withdrawn/receivable`; `totalPaid` là tổng được phép công khai.
8. WHEN `hasData=true` và tính tổng ngày/30 ngày, THE SYSTEM SHALL dùng mọi bản ghi liên quan theo biên UTC `[start,end)`, không giới hạn theo 100 dòng của bảng; kỳ nằm trọn cửa sổ SHALL cộng nguyên khoản. IF có bản ghi nhiều ngày cắt biên mà không có chi tiết ngày, THE SYSTEM SHALL trả `INSUFFICIENT_DETAIL` với amount null cho metric bị ảnh hưởng, ưu tiên hơn zero khi đã xác định cửa sổ theo D; chưa có D vẫn NO_DATA và không dựng cửa sổ. Không chia đều theo ngày. Batch `sourceTz` khác UTC có thể không phủ trọn ngày UTC và SHALL không được coi là coverage chỉ vì mang nhãn ngày nguồn. Publish chưa ATTRIBUTE SHALL không thay khoản cashback đã ghi có.

### Requirement 15: (removed — Email OTP binding & private UID read access)

### Requirement 16: (removed — Outbound email delivery chỉ phục vụ xác thực khách)

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
   SHALL NOT include email, payout address, withdrawal records, movement
   history, or `reserved` / `withdrawn` / `receivable`.
5. IF the visitor's client requests reduced motion, THEN THE SYSTEM SHALL show
   the same rows without continuous animation.
6. THE SYSTEM SHALL NOT treat the ledger as a cashback lookup: a visitor still
   uses Requirement 14 (exchange + UID) to see their own published cashback and total paid.
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
9. WHILE the admin left navigation is visible, THE SYSTEM SHALL display each
   destination on its own row without wrapping labels into neighboring links.
   **Data ingest** and **Reports** SHALL be expandable dropdown groups with a
   keyboard-operable control and their child links stacked below the group label.
   WHEN an admin opens a route in a group, THE SYSTEM SHALL expand that group and
   indicate the current destination. The groups SHALL remain usable on narrow
   screens.
10. WHEN an admin opens the Referral activity report, THE SYSTEM SHALL prefill
    both period dates with the current UTC calendar date. THE SYSTEM SHALL use UTC
    to interpret the selected report dates and SHALL NOT ask for a source timezone
    in this report filter. This SHALL NOT change the source timezone metadata
    required for manual uploads.
11. WHILE the Referral activity report is visible, THE SYSTEM SHALL make each date
    picker control visually discernible on the dark theme and explain the reported,
    incomplete, and no-activity data states in plain language. The explanation
    SHALL distinguish missing or unsealed (open/settling) coverage from a complete day with no metric
    and SHALL NOT imply reported commission is paid cashback.
12. WHEN an admin follows a report page cursor, THE SYSTEM SHALL offer controls
    to return to the previous page and the first page. A new report search SHALL
    reset pagination to page one; a failed page request SHALL leave the current
    page and navigation history intact.

### Requirement 19: Bảng tính tiền hoàn phí bị bỏ lỡ

**User Story:** Là khách truy cập, tôi muốn chỉ nhập volume giao dịch mỗi tháng để ước tính tiền hoàn theo offer.

#### Acceptance Criteria
1. WHEN mở calculator, THE SYSTEM SHALL chỉ cung cấp một đầu vào số cho khách là volume giao dịch/tháng bằng USDT, có giá trị mặc định `1,000,000 USDT` (giá trị số 1000000, có thể chỉnh mặc định sau trong code) và dấu phân tách hàng nghìn; THE SYSTEM SHALL không cung cấp ô phần trăm phí giao dịch hoặc phần trăm hoa hồng affiliate.
2. WHEN admin cấu hình offer, THE SYSTEM SHALL cho nhập `estimatedVolumeRate` nullable, là phần của volume trong khoảng 0–1, tối đa 10 chữ số thập phân; IF ngoài khoảng hoặc quá precision, THE SYSTEM SHALL từ chối lưu và nêu lỗi ở trường tương ứng.
3. WHEN khách chọn offer hợp lệ, THE SYSTEM SHALL tính `tháng = volume × estimatedVolumeRate`, `năm = tháng × 12` chính xác, chỉ round half-up đến 2 chữ số thập phân ở hiển thị cuối; không làm tròn tháng rồi nhân năm.
4. IF volume trống, không hợp lệ, âm, vượt 16 chữ số nguyên hoặc 8 chữ số thập phân, THE SYSTEM SHALL báo lỗi và không hiển thị kết quả tiền hợp lệ.
5. WHEN tính ước lượng, THE SYSTEM SHALL chỉ dùng published offer có `estimatedVolumeRate` khác null; offer chưa có hệ số SHALL không xuất hiện trong calculator. Hệ số 0 SHALL hợp lệ. IF không có offer đủ điều kiện, THE SYSTEM SHALL hiển thị trạng thái không có ước tính.
6. WHEN có nhiều offer đủ điều kiện, THE SYSTEM SHALL cho chọn offer và gắn kết quả/CTA với cùng offer; UI SHALL trình bày ước tính tháng/năm, đơn vị, giả định volume/hệ số không đổi và điều kiện referral; không hiển thị cơ cấu hoa hồng nền tảng.
7. WHEN khách thay volume, THE SYSTEM SHALL tính trên trình duyệt, không gửi/lưu đầu vào lên server, không tạo tiền ghi có và không làm chậm nội dung offer SSR.
8. WHEN hiển thị ước tính, THE SYSTEM SHALL phân biệt với cashback thực tế và không cam kết được thanh toán.

### Requirement 20: Giao diện Dark Aurora và tên website tiếng Anh (hướng giao diện đã chốt)

**User Story:** Là khách truy cập, tôi muốn giao diện rõ ràng và tên website nhất quán để dễ tìm ưu đãi, tính và tra cứu hoàn phí tự động về UID sàn.

#### Acceptance Criteria
1. THE SYSTEM SHALL tổ chức trang chủ để khách dễ tìm phần giới thiệu, tra cứu exchange + UID, bảng tính và các ưu đãi đã công bố.
2. THE SYSTEM SHALL cung cấp bố cục dùng được từ chiều rộng 360px đến 1440px không cuộn ngang, có điều hướng mobile, thẻ ưu đãi dễ đọc và khoảng cách hiển thị nhất quán.
3. THE SYSTEM SHALL gắn nhãn trường nhập, hiển thị focus bàn phím, đạt độ tương phản chữ WCAG 2.1 AA và tôn trọng `prefers-reduced-motion`.
4. THE SYSTEM SHALL bỏ Wallet, xác thực email và thao tác yêu cầu/hủy rút khỏi luồng khách; `/withdraw` SHALL redirect `/#lookup` cho link cũ. POST tạo/hủy yêu cầu rút cũ SHALL trả 410 `CUSTOMER_WITHDRAWALS_RETIRED` mà không reserve/enqueue job, không phụ thuộc DB gate. THE SYSTEM SHALL gỡ API đọc ví/lịch sử riêng tư của khách; giữ queue admin legacy, sổ payables và dữ liệu lịch sử, không tự bật sender/gate.
5. THE SYSTEM SHALL dùng tên tiếng Anh đã được duyệt nhất quán ở header, footer và metadata.
6. THE SYSTEM SHALL giữ giao diện sản phẩm bằng tiếng Anh theo Requirement 4; specs tiếng Việt không thay đổi locale website.
7. THE SYSTEM SHALL dùng hướng Dark Aurora cho giao diện public, giữ hero và hình ví minh họa của mockup đã chọn, đặt khung `THE CASHBACK OPPORTUNITY CHECK` nổi bật ngay bên dưới hình ví, rồi tới dải logo sàn, tra cứu exchange + UID và ưu đãi đã công bố; hình ví và kết quả ước tính SHALL có nhãn phân biệt với số dư tài khoản thật.
8. THE SYSTEM SHALL mô tả hoàn tiền theo lịch về UID sàn, không yêu cầu khách xác minh email/bấm rút; hướng dẫn/FAQ SHALL không hứa nhận ngay hoặc bỏ qua holding, approval, nguồn chi và readiness của Req 22. Scope khách chỉ gồm lookup công khai và chi tự động về UID sàn; không dashboard email hoặc ví nhận riêng.

### Requirement 21: Thanh toán ETH/BNB/SOL và kiểm thử theo ngày (đề xuất)

> Kênh on-chain là đề xuất riêng chưa bật; không tạo customer withdrawal UI hoặc cho khách chọn ví nhận trong phạm vi auto-only Req 22.35.

**User Story:** Là người vận hành, tôi muốn khoản rút đủ điều kiện không quá 20 USD được thanh toán tự động, có kiểm thử theo ngày, để giảm xử lý thủ công khoản nhỏ.

#### Acceptance Criteria
1. THE SYSTEM SHALL hỗ trợ coin gốc theo đúng cặp `ETH/Ethereum mainnet`, `BNB/BSC mainnet`, `SOL/Solana mainnet`; không tự thay bằng USDT hoặc token được bọc.
2. WHEN người nhận cung cấp địa chỉ, THE SYSTEM SHALL kiểm tra định dạng theo mạng được chọn, phân biệt địa chỉ EVM với địa chỉ Solana và từ chối địa chỉ EVM có chữ hoa/thường lẫn lộn nhưng sai checksum EIP-55.
3. WHEN xét thanh toán tự động, THE SYSTEM SHALL định giá USD tổng principal của một execution (tổng tất cả allocations) bằng quote hợp lệ; **nhỏ hơn hoặc bằng 20 USD** được tự duyệt và trả khi mọi điều kiện khác đạt, lớn hơn 20 USD phải giữ UNPAID + AWAITING_APPROVAL. Ranh giới principal là thống nhất cho Req 9/21/22; internal USDT áp fixed 1:1 theo Req 22.34, coin khác/on-chain dùng quote hợp lệ; scheduler SHALL NOT chia execution tự động chỉ để né approval. Phí/hạn mức cộng dồn theo #27–31 và thiếu policy bắt buộc SHALL chặn auto-send.
4. IF thiếu tỷ giá hợp lệ hoặc tỷ giá quá hạn theo chính sách, THE SYSTEM SHALL không tự động gửi tiền.
5. THE SYSTEM SHALL giữ kiểm soát hiện hành: chỉ rút `available`, giữ tiền trong `reserved`, xác thực tác nhân admin/system chặn lệnh chi mới khi còn `receivable`, và ngưỡng duyệt theo Req 9.5/22.32 ngay từ lần đầu, không bắt duyệt chỉ vì lần đầu.
6. WHEN thực hiện thanh toán tự động, THE SYSTEM SHALL chỉ chọn khoản `CustomerPayable` UNPAID còn hiệu lực, đã đồng bộ và đủ điều kiện theo Req 22; lệnh rút/sender SHALL tham chiếu khoản này, không gửi khoản đã hủy, bị từ chối hoặc đã trả tiền và không tự tính khoản chi từ raw/activity/Wallet.
7. THE SYSTEM SHALL không gửi trùng cùng khoản rút khi retry, chạy đồng thời hoặc khôi phục sự cố; kết quả gửi chưa rõ phải đối soát trước khi thử giao dịch mới.
8. WHEN giao dịch đang thực hiện hoặc chưa rõ kết quả, THE SYSTEM SHALL ngăn việc vừa giải phóng khoản tiền giữ chỗ vừa thanh toán khoản đó.
9. WHEN giao dịch đạt điều kiện xác nhận của mạng theo chính sách đã duyệt, THE SYSTEM SHALL ghi `PAID`, chuyển `reserved → withdrawn` đúng một lần và lưu tham chiếu giao dịch. Broadcast chưa đủ để ghi nhận đã trả.
10. THE SYSTEM SHALL lưu lịch sử quyết định thanh toán, tỷ giá/thời điểm định giá, số lượng coin, mạng, địa chỉ và kết quả giao dịch; không lộ thông tin ký bí mật qua UI, API hoặc log.
11. THE SYSTEM SHALL giữ số dư theo tài sản. Nếu hoàn phí ghi nhận bằng USDT, việc trả ETH/BNB/SOL phải có chính sách chuyển đổi và hạch toán được duyệt; không tự chuyển số dư.
12. WHILE thiếu cấu hình bắt buộc theo design đã duyệt, THE SYSTEM SHALL tắt gửi tự động và báo phần thiết lập còn thiếu cho người vận hành.
13. THE SYSTEM SHALL có kiểm thử nhiều ngày cho ba mạng: dưới/bằng/trên 20 USD, lần đầu áp cùng ngưỡng, tỷ giá hết hạn, chạy trùng, trạng thái chưa xác nhận và sự cố giữa các bước. Kiểm thử local chạy Docker theo steering, không gửi mainnet; trước mainnet phải chạy đạt trên testnet (Ethereum Sepolia, BSC testnet, Solana devnet) bằng ví và secret riêng của testnet.
14. THE SYSTEM SHALL áp hạn mức chi tự động theo mạng cho mỗi ngày thanh toán; IF khoản rút làm vượt hạn mức hoặc ví chi trả không đủ coin + phí mạng, THEN THE SYSTEM SHALL không gửi tự động, giữ `reserved` và chuyển xử lý thủ công. Giá trị hạn mức theo Open decision #31.
15. THE SYSTEM SHALL cho admin tạm dừng/bật lại gửi tự động theo từng mạng; WHILE tạm dừng, THE SYSTEM SHALL không broadcast giao dịch mới nhưng vẫn đối soát giao dịch đã gửi.
16. IF số coin cần gửi nhỏ hơn mức tối thiểu của mạng theo design đã duyệt (gồm mức rent-exempt khi gửi SOL tới tài khoản Solana chưa tồn tại), THEN THE SYSTEM SHALL không gửi tự động và báo lý do cho admin.

---

### Requirement 22: Sổ khoản phải trả và lịch sử thanh toán khách hàng

**User Story:** Là người vận hành, tôi muốn một bảng nghiệp vụ tập trung cho biết cần trả cho khách nào, trên sàn nào, bao nhiêu và đã trả hay chưa, để theo dõi công nợ, duyệt khoản lớn và xử lý các khoản lỗi mà không thất lạc hoặc trả trùng.

> Phạm vi: CustomerPayable là sổ khoản chi auto/manual, tự đồng bộ async (#33). Customer withdrawal/partial đã loại theo câu 13. **#34 (một payable cho mỗi release + allocations) và #35 (execution tách khỏi Withdrawal) được duyệt ngày 2026-10-17 và triển khai ở migration `202610170001_customer_payables`**; mô phỏng kiểm chứng ở `scripts/test-payables.mjs` (RTM: `payables-rtm.md`). Chưa có adapter MEXC/Bybit thật, chưa bật gửi tiền thật, chưa có backfill/cutover production. Lập sổ chưa tự cho phép gửi tiền hoặc biến activity thành cashback.

#### Acceptance Criteria
1. THE SYSTEM SHALL lưu mỗi khoản với định danh ổn định, sàn, UID, tài sản, số tiền/nguồn/kỳ và thời điểm; UID SHALL theo quy tắc opaque string đã có ở Req 5.2, giữ số 0 đầu và scope theo sàn. Không định nghĩa lại một policy chuẩn hóa UID khác tại Req 22. Đơn vị một khoản và khóa nguồn cụ thể chờ #34.
2. THE SYSTEM SHALL tách bảng khoản phải trả khỏi `raw_<exchange>`, referral activity và hoa hồng báo cáo; chỉ cashback đã được ghi nhận qua luồng commission/wallet đủ điều kiện theo chính sách mới có thể làm nguồn lập khoản. Volume, `REPORTED_COMMISSION`, dữ liệu mẫu và `pending` chưa được giải phóng SHALL NOT tự trở thành số tiền sẵn sàng chi.
3. THE SYSTEM SHALL dùng đúng hai trạng thái kết quả thanh toán `UNPAID` và `PAID`; khoản mới SHALL là `UNPAID`. Approval, số lần thử hoặc việc API nhận yêu cầu SHALL NOT tự chuyển khoản thành `PAID`.
4. WHILE một khoản chưa trả, THE SYSTEM SHALL lưu lý do đang chặn và tiến trình xử lý riêng với trạng thái thanh toán, phân biệt tối thiểu: sẵn sàng xử lý, chờ approval khoản lớn, thiếu thiết lập/xác minh người nhận của sàn, thiếu thông tin/quyền nhận, lỗi kỹ thuật, thiếu số dư nguồn, đang xử lý và chưa rõ kết quả cần đối soát. Một khoản có thể có nhiều điều kiện chặn cùng lúc.
5. IF khoản cần approval do số tiền hoặc thiếu định giá hợp lệ theo Req 9.5/21.3, THEN THE SYSTEM SHALL giữ `UNPAID` và chặn gửi cho tới khi được admin duyệt; quyết định SHALL lưu người duyệt, thời điểm, ghi chú và nội dung khoản đã duyệt. Thay đổi số tiền, tài sản hoặc nơi nhận SHALL làm mất hiệu lực approval cũ.
6. WHEN xét auto-approval, THE SYSTEM SHALL dùng cùng định nghĩa tổng execution principal ở Req 9.5/21.3: `<= 20 USD` được tự duyệt và chi khi mọi điều kiện khác đạt; `> 20 USD` SHALL giữ UNPAID + AWAITING_APPROVAL tới khi admin duyệt đúng snapshot, không tự gửi hoặc chia nhỏ. Thiếu/stale quote SHALL không được tự duyệt ở nhánh cần market valuation; internal USDT áp fixed policy Req 22.34, không cần quote USDT/USD. Một execution gồm nhiều payable/allocations SHALL xét tổng, không từng dòng. Mọi khoản còn UNPAID cho tới khi trả hết; phí/hạn mức vẫn theo #27–31; internal USDT dùng quy ước 1:1 đã chốt ở Req 22.34, quote coin khác theo policy riêng. Chưa đủ policy bắt buộc thì chặn auto-send. Đây là ngưỡng đã chốt ở câu 4, thay quy tắc trước đó loại đúng 20 USD; câu 13 bỏ yêu cầu rút từ khách; câu 10/22.32 bỏ yêu cầu duyệt chỉ vì lần đầu.
7. IF gặp lỗi kỹ thuật chắc chắn chưa chuyển tiền, THEN THE SYSTEM SHALL giữ cùng khoản `UNPAID`, lưu mã lỗi an toàn, thời điểm và lịch sử lần thử; xử lý lại SHALL NOT tạo thêm một khoản nợ cho cùng nguồn tiền.
8. IF kết quả gửi chưa rõ, THEN THE SYSTEM SHALL giữ `UNPAID` với lý do cần đối soát, giữ phần tiền đã dành cho lệnh và chặn thử gửi mới/hủy/giải phóng phần tiền đó cho tới khi xác định được kết quả. Timeout SHALL NOT được coi là bằng chứng thất bại.
9. WHEN có bằng chứng chuyển thành công, THE SYSTEM SHALL settle phần tiền thực trả đúng một lần, lưu tham chiếu/số tiền/tài sản/đích/thời điểm/tác nhân và chỉ đánh dấu PAID khi khoản đã được trả đầy đủ. Manual mark-paid SHALL yêu cầu bằng chứng khớp lệnh; cùng tham chiếu không settle hai lệnh khác nhau. Mapping nguồn/lệnh và receipt thiếu phải chốt ở #34–35 trước implementation; khách không yêu cầu rút một phần theo Req 22.35, không suy bảng nhị phân là được bỏ mất phần chưa trả.
10. THE SYSTEM SHALL ngăn cùng một nguồn số dư được phân bổ hoặc giữ chỗ đồng thời cho nhiều khoản/lệnh chi; sổ phải trả và `Withdrawal` SHALL tham chiếu cùng phần tiền thay vì tạo hai nghĩa vụ độc lập. Số tiền lịch sử SHALL NOT được cộng thêm một lần nữa vào số dư `Wallet`.
11. WHEN khoản đã PAID, THE SYSTEM SHALL giữ nguyên lịch sử, không gửi lại/sửa/đổi UNPAID; correction sau trả SHALL có bút toán liên kết. Cancel/reject lệnh chi SHALL không tự xóa quyền hưởng của khách. WHEN đóng khoản UNPAID, THE SYSTEM SHALL chứng minh quyền hưởng còn lại bằng 0 do correction xác thực hoặc đã được chuyển đầy đủ sang khoản kế thừa có liên kết trong cùng transaction, không có tiền đang gửi/chưa rõ kết quả; cách phân bổ/kế thừa chờ #34. Khoản bị lỗi hoặc chờ duyệt không được đóng để biến mất khỏi công nợ.
12. THE SYSTEM SHALL cung cấp lịch sử và mặc định hiện mọi khoản UNPAID còn remainingAmount > 0, kể cả SYNC_PENDING/FAILED, lỗi, chờ duyệt và đang xử lý; trạng thái sync không phải bộ lọc loại khoản. THE SYSTEM SHALL hiện bộ đếm backlog/nguồn chưa có payable, failed/blocked/unknown, mốc đồng bộ và tổng chưa đồng bộ chưa xác định, cảnh báo khi có job FAILED, UNKNOWN hoặc vi phạm đối soát; cảnh báo tồn tại tới khi xử lý, không phụ thuộc lọc bảng. Tổng tiền SHALL tách theo asset; không báo tổng công nợ đầy đủ khi còn nguồn chưa sync. Khoản đóng dư 0/PAID vẫn có trong lịch sử.
13. THE SYSTEM SHALL ghi audit cho việc lập khoản, thay đổi approval, từng lần xử lý/đối soát, đóng khoản và xác nhận PAID; log và bảng SHALL không chứa API secret/private key. Lịch sử chi trả SHALL chỉ dành cho admin có quyền, không đưa vào lookup công khai.
14. THE SYSTEM SHALL có unique constraint DB cho: nguồn khoản (một payable cho mỗi WalletEntry HOLD_RELEASE), một allocation ACTIVE cho mỗi payable, một execution mở cho mỗi (UID account, asset), `commandKey`, `legacyWithdrawalId` và tham chiếu chuyển theo sàn/tài khoản nguồn/providerRef; retry/re-import SHALL không tạo ID nguồn mới để né dedup. Triển khai SHALL có kiểm chứng đối soát nguồn → khoản phải trả → phân bổ → settlement, gồm xử lý correction trước/sau thanh toán.
15. THE SYSTEM SHALL dùng CustomerPayable làm nguồn khoản chi duy nhất cho mọi auto/manual-admin/approval/retry/reconcile/mark-paid; command SHALL tham chiếu payableId/version hoặc lệnh chi ánh xạ về khoản. Số tiền thực thi lấy từ phần quyền hưởng hợp lệ, không tự sửa nghĩa vụ từ payload client; mapping chờ #34–35; không có command rút từ khách theo Req 22.35. Đích nhận/tài sản/account lấy từ snapshot đã kiểm; Wallet chỉ là sổ số dư/giữ chỗ, không tạo đường chi khác.
16. WHEN ingest đã publish dữ liệu hợp lệ hoặc có thay đổi commission/cashback/giải phóng holding/correction liên quan, THE SYSTEM SHALL tự lên lịch đồng bộ sổ phải trả async, không chờ khách yêu cầu rút. Bước ingest chỉ lưu nguồn và chuyển tiếp pipeline, SHALL NOT gọi sender hoặc tính/trả tiền trực tiếp trong request ingest; activity chưa qua cổng đối soát không tạo khoản tiền sẵn sàng chi. Cashback còn pending SHALL chờ sự kiện giải phóng trước khi trở thành khoản khả dụng để chi.
17. WHEN commit thay đổi nguồn có ảnh hưởng công nợ, THE SYSTEM SHALL ghi yêu cầu xử lý tiếp bền vững trong cùng transaction; worker SHALL có retry/backoff, lease fencing, khóa chống trùng theo nguồn/phiên bản và cơ chế phục hồi backlog. Lỗi sau commit nguồn SHALL NOT làm mất yêu cầu đồng bộ hoặc nhân đôi khoản khi chạy lại.
18. THE SYSTEM SHALL lưu mốc phiên bản nguồn đã đồng bộ và trạng thái đồng bộ theo phạm vi sàn/tài khoản/tài sản; WHILE có thay đổi tài chính mới chưa được áp vào sổ, THE SYSTEM SHALL chặn lệnh chi mới trên phần tiền bị ảnh hưởng và hiển thị đang đồng bộ/lỗi, không trình bày số cũ là danh sách phải trả đã đầy đủ. Worker SHALL bỏ qua kết quả phiên bản cũ và không ghi đè snapshot khoản đang gửi hoặc lịch sử PAID; vẫn được ghi nhận kết quả của lần chuyển đã thực hiện rồi xử lý chênh lệch bằng đối soát/điều chỉnh liên kết.
19. WHEN admin/khách gửi command thuộc luồng khoản phải trả, THE SYSTEM SHALL kiểm tra quyền, lưu command/job bền vững với định danh chống gửi lặp và trả trạng thái tiếp nhận async; chỉ kết quả worker đã commit mới được hiển thị là duyệt xong hoặc PAID. Worker SHALL kiểm tra lại phiên bản, approval, blockers và số dư/giữ chỗ trước khi tạo lần chi mới. Manual và auto SHALL dùng cùng quy tắc, khóa khoản và audit, không được xử lý song song hai lần chi cho một khoản.
20. WHEN đồng bộ lại sổ, THE SYSTEM SHALL cập nhật khoản còn sửa được theo nguồn hợp lệ, làm mất approval cũ nếu nội dung thay đổi, bảo toàn khoản PAID và snapshot của lần chi đang thực hiện; thiếu UID trong một response activity hoặc job đồng bộ lỗi SHALL NOT tự xóa công nợ. Mọi điều chỉnh số tiền/quyền hưởng SHALL có nguồn correction xác thực và lịch sử; retry command/lần chi không được lập khoản thay thế để né khóa hoặc approval.
21. THE SYSTEM SHALL dùng mô hình đã duyệt ở #34–35: một payable cho mỗi release (`sourceReleaseEntryId`) với entitlement T, settled S, active R và T >= S + R >= 0; `PayableAllocation` nối payable với `PayoutExecution`; mọi writer lấy cùng một khóa ledger toàn cục (một thứ tự khóa); reserve/release/settle nguyên tử cùng Wallet bằng opKey `allocation:<id>:reserve|release|settle`; sync tạo khoản SHALL không tự reserve. Withdrawal legacy chỉ là lịch sử (ánh xạ qua `legacyWithdrawalId` khi backfill); writer chi của khách SHALL bị chặn theo Req 22.35 và DB gate `moneyFlowGate` (Req 22.24). Khi nguồn không đủ cho mọi nhóm, SHALL phục vụ khoản release cũ nhất trước.
22. WHEN chuẩn bị gửi, THE SYSTEM SHALL chuyển PREPARED → DISPATCHING trong transaction dùng cùng lock scope với correction/cancel, kiểm lại source/payableVersion, approval và tất cả blockers. Correction commit trước ranh giới SHALL vô hiệu snapshot/approval, hủy bản chuẩn bị chắc chắn chưa gửi rồi sync lại; worker cũ không được gọi sender. Sau DISPATCHING, kể cả chưa rõ HTTP đã đi chưa, THE SYSTEM SHALL giữ snapshot/allocation, đối soát trước retry/cancel. Correction sau ranh giới SHALL ghi pendingCorrection và chặn chi mới; nếu xác nhận đã chi thừa SHALL ghi receivable/clawback liên kết theo Req 8.7, nếu xác nhận chưa gửi SHALL áp correction trước release. Ranh giới DB không bảo đảm nguồn ngoài không đổi; spec SHALL giữ đường thu hồi và không hứa tuyệt đối không chi thừa.
23. WHILE có nhiều blockers, THE SYSTEM SHALL lưu toàn bộ và chỉ cho SEND khi tất cả đã được gỡ; primaryReason SHALL theo thứ tự: UNKNOWN/DISPATCHING, correction hoặc sync/invariant, ownership/destination/config/receivable, approval, WAITING_SCHEDULE, source funds/limits/minimum/fees, retryable error, READY. Thứ tự hiển thị SHALL không cho phép approval vượt blocker khác. RECONCILE được phép khi in-flight/UNKNOWN; APPROVE chỉ khi nội dung current và đúng quyền; RETRY/SEND lại phải kiểm toàn bộ; CANCEL chỉ trước DISPATCHING.
24. WHEN chuyển từ luồng cũ sang sổ mới, THE SYSTEM SHALL khóa tất cả money mutations auto/manual/legacy bằng DB gate, drain hoặc đối soát các execution còn mở, backfill và chứng minh đầy đủ phân bổ/số dư mà không reserve/settle lại. Chỉ sau khi mọi writer/worker đã hỗ trợ gate + sổ mới, kiểm đối soát đạt và legacy route đã resolve sang command chung, THE SYSTEM SHALL mở gate ở mode PAYABLE_ONLY. Gate chưa xác định hoặc mapping thiếu SHALL fail closed; không chạy old/new writer cùng lúc, không fallback legacy khi lỗi và không rollback về writer cũ sau phát sinh execution mới.
25. THE SYSTEM SHALL hỗ trợ phạm vi đã chọn: trả USDT nội bộ tới UID cùng sàn cho cả MEXC và Bybit, mỗi sàn có tài khoản nguồn/key chi trả riêng có thể khác tài khoản affiliate ingest; execution/receipt/recovery SHALL ràng buộc sourceAccountId và đúng UID đích. Binance SHALL theo cùng sổ/command khi có dữ liệu UID/commission hợp lệ và kênh Payout đã được cấp quyền/kiểm chứng, không tự bật chỉ vì fetch được dữ liệu. THE SYSTEM SHALL phân biệt xác minh thiết lập/người nhận lần đầu với xác minh từng lần chuyển; chỉ auto-send khi source/channel/recipient sẵn sàng và không cần thao tác người dùng cho lệnh đó. Câu 2 đã chốt: operator chấp nhận thêm/xác minh mỗi UID Bybit một lần; WHEN việc thiết lập được xác nhận hoàn tất, THE SYSTEM SHALL cho phép các lần chi sau tự động nếu mọi điều kiện khác đã đạt, không yêu cầu operator lặp lại thiết lập cho mỗi lần trả. Điều này không bảo đảm sàn sẽ không yêu cầu xác minh lại. IF cần OTP/2FA/risk review hoặc chưa có recipient trong danh sách bắt buộc, THEN THE SYSTEM SHALL giữ UNPAID với blocker rõ; nếu có thể đã gửi thì giữ UNKNOWN/đối soát. THE SYSTEM SHALL NOT tự lấy OTP/TOTP, dùng API web nội bộ hoặc tắt bảo vệ để lách xác minh. Tài khoản mới/khóa mới phải kiểm quyền thực tế trước bật; key affiliate đọc dữ liệu không được coi là quyền chi tiền.

26. WHEN đến 23:00 UTC (UTC+0) mỗi ngày, THE SYSTEM SHALL lên một đợt thanh toán USDT nội bộ theo Req 22.25, gộp các khoản cashback đã đủ điều kiện của cùng sàn + UID + USDT thành một lệnh chuyển logic cho UID đó trong đợt; không gộp khác sàn/UID/tài sản, không tự chia nhỏ để né ngưỡng. Tổng principal sau gộp SHALL là đầu vào xét ngưỡng Req 9.5/21.3: nhỏ hơn hoặc bằng 20 USD có thể tự duyệt và trả, trên 20 USD giữ UNPAID chờ approval thủ công; mọi gate khác vẫn áp dụng. Scheduler/job chạy lặp hoặc nhiều replica SHALL nhận lại cùng đợt/lệnh và không gửi thêm cho cùng nhóm; phần tiền đã trả/đang phân bổ/UNKNOWN SHALL không được tính lại để chi. Đồng bộ payable SHALL tiếp tục async độc lập với lịch chi; đợt chi không tạo nghĩa vụ tiền thứ hai. Quyết định này SHALL không tự duyệt grain vật lý hoặc FIFO ở #34; câu 13/22.35 đã loại customer withdrawal/partial; đợt bỏ lỡ SHALL chờ đợt kế tiếp theo Req 22.28; cutoff danh sách là 23:00 UTC theo Req 22.30, retry lỗi chắc chắn chưa chuyển theo Req 22.31. 23:00 là giờ khởi chạy đợt, không cam kết mọi transfer hoàn tất cùng thời điểm.

27. WHEN khoản USDT nội bộ lớn hơn 20 USD đang chờ duyệt được admin approve sau đợt 23:00 UTC, THE SYSTEM SHALL ghi approval trên đúng snapshot và thời điểm được phép chi sớm nhất là đợt 23:00 UTC kế tiếp. Approval SHALL NOT tự gọi sender hoặc tạo lệnh gửi ngay. WHILE chưa tới đợt được phép, THE SYSTEM SHALL giữ UNPAID, approval đã duyệt và lý do WAITING_SCHEDULE, cùng mọi blocker khác; duyệt không đồng nghĩa PAID. WHEN đến đợt kế tiếp, THE SYSTEM SHALL kiểm lại phiên bản, snapshot, approval và mọi gate trước claim/dispatch qua command chung, không tạo nghĩa vụ thứ hai hoặc chi lại lệnh đang gửi/UNKNOWN/PAID. Nguồn/snapshot thay đổi SHALL xử lý theo Req 22.5/20/22, không dùng approval cũ để trả tổng mới. Ví dụ approve lúc 23:05 UTC ngày D thì sớm nhất được xét chi lúc 23:00 UTC ngày D+1; còn blocker thì tiếp tục UNPAID. Quy tắc này không tự cho phép catch-up đợt bỏ lỡ hay retry ngoài giờ.

28. WHEN hệ thống bỏ lỡ đợt thanh toán USDT nội bộ 23:00 UTC và khôi phục ngoài giờ chạy, THE SYSTEM SHALL chờ đợt 23:00 UTC kế tiếp thay vì tự dispatch bù ngay. Các khoản chưa gửi SHALL tiếp tục UNPAID, giữ nguồn/quyền hưởng và approval còn hợp lệ, hiển thị WAITING_SCHEDULE cùng mọi blocker khác; không xóa nợ hoặc nhân nghĩa vụ để chuyển ngày. WHEN đợt kế tiếp đến, THE SYSTEM SHALL gộp các phần tiền còn đủ điều kiện theo cùng sàn + UID + USDT và xét lại tổng/ngưỡng/snapshot/approval/freshness theo Req 22.5/6/26/27; tổng mới >20 USD cần approval hợp lệ cho tổng mới, không mặc định dùng approval cũ. Job của đợt bỏ lỡ hoặc replica phục hồi SHALL NOT dùng lịch quá hạn để gửi ngoài giờ hoặc tạo lệnh trùng đợt mới. WHILE giao dịch đã gửi/đang gửi hoặc UNKNOWN, THE SYSTEM SHALL tiếp tục đối soát độc lập với lịch, không coi số tiền đó là khoản chưa gửi được phép gộp lại; đồng bộ sổ/correction vẫn được phục hồi async. Ví dụ khôi phục 01:00 UTC ngày D+1 sau khi lỡ 23:00 UTC ngày D thì chờ tới 23:00 UTC ngày D+1. Cutoff dữ liệu theo Req 22.30; retry lỗi chắc chắn chưa chuyển theo Req 22.31, không suy ra quyền gửi ngoài giờ từ việc phục hồi job.

29. WHEN cashback mới đủ điều kiện phát sinh cho cùng sàn + UID + USDT trước đợt chi kế tiếp và nhóm chi chưa qua DISPATCHING, THE SYSTEM SHALL gộp phần mới vào tổng chưa gửi, tăng phiên bản snapshot và làm mất hiệu lực approval của tổng cũ. IF tổng mới lớn hơn 20 USD, THEN THE SYSTEM SHALL giữ UNPAID + AWAITING_APPROVAL và yêu cầu admin duyệt đúng tổng/snapshot mới; SHALL NOT trả riêng tổng cũ để giữ approval hoặc tự chia phần tăng thêm sang đợt sau nhằm né duyệt lại. Ví dụ đã duyệt 25 USDT rồi có thêm 5 USDT đủ điều kiện trước đợt 23:00 kế tiếp thì tổng là 30 USDT, approval 25 USDT chỉ còn trong audit. WHEN admin duyệt lại, THE SYSTEM SHALL áp lịch Req 22.26/27 và kiểm mọi gate; không tự gửi ngay. Job sync/approve lặp hoặc race SHALL NOT nhân nguồn tiền, giữ approval stale hoặc gọi sender từ phiên bản cũ. WHILE execution đã DISPATCHING/SUBMITTED/UNKNOWN hoặc PAID, THE SYSTEM SHALL giữ snapshot/lịch sử và xử lý nguồn mới/correction theo Req 22.18/20/22, không gộp sửa execution đã có thể gửi. Cutoff theo Req 22.30; grain/khóa nguồn/mapping vật lý vẫn cần chốt riêng.

30. WHEN đợt USDT nội bộ bắt đầu lúc 23:00 UTC, THE SYSTEM SHALL chốt danh sách nguồn cashback đã đủ điều kiện và snapshot tổng theo từng sàn + UID + USDT tại cutoff 23:00 UTC. Cashback mới đủ điều kiện sau cutoff SHALL để đợt kế tiếp, không thêm vào execution của đợt đang chạy, không tự làm mất approval của snapshot hiện tại chỉ vì phát sinh nguồn mới độc lập ngoài danh sách. Khoản trước cutoff SHALL theo quy tắc gộp/duyệt lại Req 22.29. Snapshot cutoff SHALL có định danh/phiên bản nguồn bền vững để job chạy lặp hoặc xử lý UID chậm vẫn dùng cùng danh sách; không dùng thời điểm từng worker gửi làm cutoff. Chốt danh sách SHALL NOT bỏ qua freshness, correction, ownership/receivable, source readiness hoặc gate khác ảnh hưởng phần tiền trong snapshot: correction tới trước DISPATCHING phải vô hiệu snapshot/approval theo Req 22.22, sau DISPATCHING phải giữ snapshot và đối soát; không tự chi số cũ khi đã biết nguồn sai. Đồng bộ khoản mới vẫn async và hiện UNPAID/chờ đợt kế tiếp; mỗi nguồn tiền chỉ được phân bổ/settle một lần qua các đợt. Ví dụ 5 USDT đủ điều kiện lúc 23:01 UTC không gộp vào lệnh 25 USDT đã chốt lúc 23:00 UTC; nếu 5 USDT đủ điều kiện trước cutoff thì gộp 30 và yêu cầu duyệt lại theo Req 22.29.

31. WHEN sàn xác nhận chắc chắn một lần chi USDT nội bộ thất bại và tiền chưa được chuyển, THE SYSTEM SHALL giữ cùng nghĩa vụ UNPAID, lưu bằng chứng thất bại và lỗi an toàn, đặt lần xét chi tiếp theo vào đợt 23:00 UTC ngày sau; không tự gửi lại trong đợt lỗi hoặc ngay khi job/worker khôi phục. Đợt tiếp theo SHALL chốt lại theo cutoff, gộp các phần còn đủ điều kiện, kiểm nguồn/snapshot/approval/ngưỡng/readiness và mọi gate như một lần xét chi mới; approval cũ chỉ dùng khi còn hợp lệ, tổng thay đổi theo Req 22.29. Retry SHALL không tạo nợ mới, không tái dùng allocation terminal hoặc gửi trùng phần tiền; successor execution nếu cần phải liên kết execution lỗi và dùng chung nguồn theo thiết kế được duyệt ở #34–35. Command RETRY, job redelivery hoặc backoff SHALL NOT vượt thời điểm được phép gửi. IF chưa có bằng chứng chắc chắn chưa chuyển, THEN THE SYSTEM SHALL giữ UNKNOWN/reservation và đối soát theo Req 22.8/22, không đưa phần tiền vào đợt retry chỉ vì sang ngày mới hoặc gặp lỗi HTTP. Đồng bộ/ghi nhận kết quả/đối soát vẫn được chạy ngoài lịch; quy tắc trì hoãn chỉ áp dụng gửi tiền lại.

32. WHEN xét khoản thanh toán đầu tiên của một UID, THE SYSTEM SHALL áp cùng ngưỡng tổng sau gộp như các lần sau: <=20 USD được tự duyệt/chi khi mọi gate khác đạt, >20 USD giữ UNPAID + AWAITING_APPROVAL. THE SYSTEM SHALL NOT tạo FIRST_REVIEW_REQUIRED hoặc yêu cầu admin duyệt chỉ vì UID chưa từng được trả/duyệt; lịch sử tạo/hủy/reject request không tạo điều kiện duyệt lần đầu. Với USDT nội bộ, tự trả lần đầu SHALL vẫn theo đợt 23:00 UTC, cutoff và policy retry, không gửi tức thì khi UID xuất hiện. THE SYSTEM SHALL giữ xác minh/người nhận bắt buộc của sàn theo Req 22.25, đặc biệt bước thêm/xác minh UID Bybit; bỏ duyệt khoản đầu không đồng nghĩa recipient đã sẵn sàng. Ownership/destination, cashback hợp lệ, holding/release, receivable, định giá theo policy Req 22.34/hạn mức, gate cutover và chống trùng vẫn phải đạt. Quyết định câu 10 thay chính sách duyệt thủ công lần đầu trước đây; code và tests legacy phải cập nhật tại Task 42 trước bật luồng mới, không coi thay spec là đã thay runtime.

33. WHEN thanh toán USDT nội bộ phát sinh phí từ sàn, THE SYSTEM SHALL để operator/tài khoản nguồn chịu phí, khách nhận đủ số cashback principal đã chốt; SHALL NOT trừ phí khỏi CustomerPayable, số tiền nhận của khách hoặc ghi nợ/receivable khách vì phí chi trả. Ngưỡng <=20 USD SHALL xét principal sau gộp theo Req 22.6, không cộng phí operator vào principal để đổi nhánh approval. THE SYSTEM SHALL kiểm đủ số dư nguồn cho principal và phí theo từng asset, cùng giới hạn provider và fee readiness; không yêu cầu daily cap riêng cho internal USDT theo Req 22.37; thiếu tiền hoặc không xác định được phí/điều kiện bảo đảm khách nhận đủ SHALL giữ UNPAID với blocker rõ, không tự giảm khoản trả. Execution/receipt/audit SHALL tách principal phải trả, số khách thực nhận và phí operator thực chịu; adapter SHALL chỉ được bật khi đã kiểm chứng chế độ tính phí/API bảo đảm net nhận đúng principal. IF provider thực trả thiếu so với principal, THEN THE SYSTEM SHALL không đánh dấu toàn khoản PAID hoặc tự gửi bù; giữ phần thiếu và đối soát theo Req 22.9/22. Không giả định mọi sàn/asset có phí bằng 0. Quyết định này áp dụng kênh USDT nội bộ đã chọn; gas/chuyển đổi on-chain Req 21 vẫn là phạm vi riêng chưa chốt.

34. WHEN xét ngưỡng approval cho USDT nội bộ theo Req 22.25, THE SYSTEM SHALL áp quy ước nghiệp vụ cố định 1 USDT = 1 USD: tổng principal <=20 USDT có thể tự trả khi mọi gate khác đạt, >20 USDT chờ approval. THE SYSTEM SHALL NOT gọi hoặc phụ thuộc market quote USDT/USD để quyết định ngưỡng này, không tạo blocker thiếu/stale quote USDT/USD, và không đổi ngưỡng theo giá thị trường. Snapshot/audit SHALL lưu valuation mode FIXED_USDT_USD, tỷ lệ 1:1 và phiên bản policy; đây là quy ước xét ngưỡng, không khẳng định giá thị trường hoặc thực hiện chuyển đổi tài sản. Phí operator theo Req 22.33 SHALL nằm ngoài principal xét ngưỡng. Quy tắc này SHALL không bỏ các gate về nguồn, approval snapshot, readiness, hạn mức, lịch/cutoff/retry và đối soát. Định giá coin khác, gas/conversion và on-chain Req 21 SHALL giữ chính sách quote riêng; không áp 1:1 cho tài sản khác chỉ vì hệ thống có USDT.

35. THE SYSTEM SHALL tự trả USDT nội bộ theo lịch đã chốt, không cung cấp customer withdrawal/cancel/toàn bộ/một phần hoặc chọn amount/đích/asset. UI SHALL bỏ controls; server SHALL từ chối customer money mutations kể cả request từ client cũ, không reserve/enqueue request cũ. Khách SHALL chỉ tra cứu công khai theo Req 14; scheduler SHALL không phụ thuộc xác thực khách. Tiền SHALL trả về đúng UID có nguồn cashback, recipient readiness vẫn theo Req 22.25. Admin SHALL xử lý approval/retry/reconcile/mark-paid qua CustomerPayable/command chung, mọi guard/lịch vẫn áp dụng. Cutover SHALL inventory và vô hiệu customer money routes/jobs cũ, đối soát legacy reserved/in-flight/UNKNOWN trước mở PAYABLE_ONLY; không xóa lịch sử hoặc giải phóng tiền đang gửi. Khách rút một phần được loại khỏi phạm vi hiện tại; receipt thiếu, correction và lịch sử chi một phần vẫn phải bảo toàn/đối soát. Grain/khóa nguồn/mapping vật lý còn review trước 42.2.

36. WHEN xét chi USDT nội bộ tại cutoff hằng ngày, THE SYSTEM SHALL chỉ cho phép gửi nếu tổng principal cashback sau gộp của cùng sàn + UID lớn hơn 0.5 USDT, theo quy ước 1:1 ở Req 22.34. WHILE còn quyền hưởng dương và tổng đúng 0.5 USDT hoặc thấp hơn, THE SYSTEM SHALL giữ UNPAID để tích lũy, hiện MINIMUM_NOT_MET/lý do chờ tích lũy; không gửi, không đóng/xóa nợ hoặc tạo khoản thay thế mỗi ngày. Tổng >0.5 và <=20 USDT SHALL có thể tự trả khi mọi gate đạt; >20 USDT cần approval. THE SYSTEM SHALL đồng thời đáp ứng minimum/precision thực tế của provider; mức sàn cao hơn SHALL tiếp tục chặn chi tới khi đủ, không hạ minimum của sàn hoặc làm tròn số để vượt ngưỡng >0.5. Phí operator SHALL không cộng vào principal để đạt mức tối thiểu và không trừ khỏi cashback khách. Đợt kế tiếp SHALL gộp các nguồn còn đủ điều kiện theo cutoff, không nhân số dư/nghĩa vụ và không gộp lại phần PAID/reserved/UNKNOWN; mọi approval/snapshot/schedule/retry guard vẫn áp dụng.

37. THE SYSTEM SHALL không đặt trần tổng tự chi riêng theo sàn/ngày cho USDT nội bộ; giới hạn chi thực tế là số dư có thể sử dụng của đúng tài khoản nguồn sau khi tính principal, phí operator và các cam kết/in-flight chưa tất toán. Số 100 USDT là ví dụ nạp nguồn, SHALL NOT trở thành hạn mức cấu hình hoặc số tiền bị giữ cố định mỗi ngày; lựa chọn không có daily cap SHALL là policy hợp lệ, không bị coi là thiếu cấu hình. WHEN nguồn không đủ để trả đầy đủ một nhóm UID và phí, THE SYSTEM SHALL không gửi một phần/giảm cashback, giữ UNPAID + INSUFFICIENT_SOURCE_FUNDS và mốc xét chi lại vào đợt 23:00 UTC ngày sau; không tự gửi bù ngay khi nạp thêm hoặc job retry. Đợt ngày sau SHALL xét lại cutoff, tổng gộp, minimum, approval, nguồn/phí và mọi gate; không tạo lại nợ hoặc bỏ qua approval vì đã chờ một ngày. THE SYSTEM SHALL ngăn nhiều worker/command cùng dùng một phần số dư nguồn, không coi tiền đang gửi/UNKNOWN là số dư tự do; UNKNOWN vẫn đối soát riêng. Giới hạn/quyền của provider vẫn áp dụng; quy tắc này không tự bỏ chính sách fee readiness hoặc áp cho ngân sách/gas on-chain chưa chốt. Câu 16/Req 22.38 chốt tiếp tục nhóm sau nếu đủ nguồn; thứ tự ưu tiên ban đầu giữa các UID còn cần quyết định riêng.

38. WHEN một nhóm UID trong đợt chi không đủ nguồn để trả toàn bộ principal và phí, THE SYSTEM SHALL giữ nhóm đó UNPAID + INSUFFICIENT_SOURCE_FUNDS, chờ đợt 23:00 UTC ngày sau theo Req 22.37, rồi tiếp tục xét các nhóm tiếp theo; SHALL NOT dừng toàn đợt chỉ vì nhóm đó không đủ nguồn. Mỗi nhóm tiếp theo SHALL kiểm số dư thực còn khả dụng và mọi gate trước claim/dispatch; chỉ gửi nếu đủ cả principal và phí, không cắt nhỏ khoản lớn hoặc giảm số khách nhận để dùng hết nguồn. Ví dụ nguồn còn3 USDT, nhóm trước cần5 thì giữ lại; nhóm sau cần2 có thể trả nếu nguồn đủ2 + phí và mọi điều kiện khác đạt. Nhóm bị bỏ qua SHALL không bị thử gửi lại trong cùng đợt hoặc tự được gửi khi có top-up, không mất nợ/approval audit hoặc được tạo payable thay thế. Nhiều worker SHALL phối hợp claim/nguồn nguyên tử theo Req 22.10/37; tiền đang gửi/UNKNOWN không được coi là số dư tự do để tài trợ nhóm sau. Quy tắc tiếp tục xét SHALL không tự quyết định thứ tự ưu tiên ban đầu giữa các UID; thứ tự đó còn phải chốt riêng, không mặc định sắp toàn đợt theo số tiền nhỏ nhất.

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
  limiting, read-only, and a response restricted to customer cashback periods, aggregate totalPaid and
  freshness timestamps (Req 14).
> **Bề mặt public:** nội dung, redirect và lookup được truy cập ẩn danh; API admin bắt buộc xác thực admin. Không cung cấp private wallet/history API cho khách.
> **Rủi ro đã chấp nhận:** lookup công khai cashback theo sàn + UID; giữ rate-limit Req 14.4, holding Req 8.3, recipient readiness và duyệt theo số tiền Req 9/22. Không có claim UID hoặc khách đổi đích trả tiền.

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
| `GET /api/exchanges` | Published exchanges + offers, estimatedVolumeRate dạng decimal string hoặc null. | Public |
| `GET /go/:linkId` | Resolve link, record click, redirect. | Public |
| `POST /api/lookup` | Theo sàn + UID: cashback ngày báo cáo D/30 ngày, summaryPeriods với reportDay nullable, tổng đã trả, freshness và bảng kỳ/tài sản/UID/cashback; không commission/rate/volume; IP rate-limited. | Public |
| `POST /api/admin/auth/*` | Admin login/logout/session. | Public → admin session |
| `POST /api/uid/withdrawals` (retired) | Luôn trả 410 CUSTOMER_WITHDRAWALS_RETIRED; không reserve/job và không phụ thuộc gate. | Not available to customers |
| `POST /api/uid/withdrawals/:id/cancel` (retired) | Luôn trả 410 CUSTOMER_WITHDRAWALS_RETIRED; admin commands remain separate. | Not available to customers |
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
| `POST /api/admin/ingest/connectors/:exchangeId/resume` | Clear admin pause without readiness; otherwise clear an error pause after readiness passes. | Admin |
| `POST /api/admin/ingest/connectors/:exchangeId/pause` | Pause this exchange's API ingestion, retaining mode/interval; no readiness prerequisite. | Admin |
| `POST /api/admin/withdrawals/:id/decision` | Sau cutover là alias command chung trên execution/allocations đã map; FROZEN chặn ghi, mapping thiếu trả 409/503, không reserve/settle lần hai hoặc fallback legacy. | Admin |
| `GET /api/admin/payables` (Req 22) | Lịch sử khoản phải trả: mặc định UNPAID còn remaining > 0 (kể cả chờ sync/duyệt/lỗi), lọc sàn/UID/asset/PAID; banner độc lập bộ lọc; tổng theo asset, `null` khi còn scope chưa sync. | Admin |
| `GET /api/admin/payout-executions/:id` (Req 22) | Một lệnh chi: phân bổ, trạng thái, audit timeline. | Admin |
| `GET/POST /api/admin/money-flow` (Req 22.24) | Đọc/đổi DB gate LEGACY → FROZEN → PAYABLE_ONLY; chặn khi còn legacy in-flight hoặc scope chưa đối soát. | Admin |
| `POST /api/admin/payout-executions/:id/commands` (Req 22) | Tiếp nhận APPROVE / CANCEL / RECONCILE / MARK_PAID với commandKey (+ expectedVersion khi approve); trả 202 + commandId, không báo thành công trước worker. | Admin |
| `GET /api/admin/payable-commands/:id` (Req 22) | Trạng thái command và kết quả đã commit. | Admin |

---

## Data model (conceptual groups, not final schema)

- **Exchange** — name, slug, description, status, default cashback rate, i18n fields.
- **Offer** — content, conditions, cashback_rate, estimatedVolumeRate nullable (0–1, tối đa 10 chữ số thập phân), status, verified-at, exchange ref.
- **ReferralLink** — id, exchange ref, optional offer ref, destination URL, active status.
- **Guide** — title, slug, content, status, optional exchange ref, i18n fields.
- **ClickEvent** — link ref, timestamp.
- **AdminAccount** — id, email, interim credential (password hash) per chosen auth (single role).
- **UidAccount** — id, exchange ref, UID opaque, created-at; unique theo (exchange, UID). Giữ sổ Wallet và lịch sử chi, không có thông tin đăng nhập khách.
- **RateLimitCounter** — counter lookup theo IP đã hash và cửa sổ độc lập (Req 14.4), không phải lịch sử tra cứu.
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
- **CustomerPayable** (Req 22) — một khoản cho mỗi cashback đã release (`sourceReleaseEntryId` UNIQUE): sàn, UID account, asset, entitlement T, settled S, active R (CHECK T >= S + R), PAID/UNPAID, version, releasedAt, closedAt/paidAt. Không sao chép raw activity và không cộng lại số dư Wallet.
- **PayoutExecution / PayableAllocation** (Req 22) — lệnh chi USDT nội bộ tới một UID (một execution mở cho mỗi UID account + asset) và phân bổ nối execution với nhiều payable (một allocation ACTIVE cho mỗi payable); trạng thái AWAITING_APPROVAL, READY, DISPATCHING, SUBMITTED, UNKNOWN, CONFIRMED, FAILED_NOT_SENT, INVALIDATED, CANCELLED; `legacyWithdrawalId` UNIQUE để ánh xạ Withdrawal cũ.
- **PayableSyncScope / PayoutSlot / PayableCommand / PayableEvent / MoneyFlowGate** (Req 22) — checkpoint đồng bộ theo (UID account, asset), đợt 23:00 UTC với manifest cutoff, command idempotent theo commandKey, audit append-only, DB gate cutover.
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
| 12 | Tra cứu công khai | **Chốt 2026-10-30** | Req 14: D gần nhất có coverage COMMISSION PUBLISHED; 30 ngày tới D, totalPaid riêng; không có truy cập khách riêng tư. |
| 13 | Admin auth solution | Pending | Covers **admin** auth only (end users have no accounts). Interim email+password + `Session` stays until a provider is chosen. |
| 19 | Compliance (KYC/AML, retention, GDPR) | Unclear | Confirm payout KYC and data-retention obligations. **Chặn Req 21 trên mainnet:** gửi coin tự động không qua người duyệt làm tăng rủi ro AML; cần chốt nghĩa vụ KYC/sàng lọc địa chỉ trước khi bật. |
| — | Cashback rate & holding period values | Rule decided (offer-rate → exchange-default, snapshot at attribution); values pending | Confirm default % and holding-period length. |
| — | Ngưỡng tự động và tài sản/mạng | Luồng hiện hành giữ nguyên; đề xuất mới ở Req 21 | Người dùng chọn ETH/Ethereum, BNB/BSC, SOL/Solana mainnet và ngưỡng không quá 20 USD theo câu 4 mới nhất; cách định giá, áp ngưỡng và chuyển đổi xem Open decisions #26–30. |
| — | Lookup rate limit values | Rule decided (per-IP) | Confirm requests-per-window; proposed 5/min, 30/hour per IP. |
| — | MEXC Referral Data semantics | XLSX sample received 2026-09-25: 46 unique UIDs, sheet period 2026-09-18 through 2026-09-25, all volume/earnings zero | Confirm source timezone and whether `Trading volume`/`Your Earnings` are period values with a nonzero export before treating them as financial evidence. |
| — | Bybit API commission settlement | `commissionsVol` is available per UID/asset/period; the API does not expose the Affiliate Portal's pending/settled state | Reconcile a nonzero portal export and decide separately whether API amounts can ever drive automatic cashback. The scheduled connector in Req 13 publishes admin activity only. |
| — | Bybit `volUpdateTime` timezone | Probe 2026-09-26 03:03 UTC: every UID in the roster (54 at the time) returned the same `volUpdateTime = 2026-09-26 00:00:00` with no zone, so it is a dataset-wide mark; the connector samples up to 3 UIDs per run regardless of roster size | Confirm UTC vs UTC+8 before using it as `sourceAsOf` (Req 6.19). |
| — | Bybit `registerTime` / `isKyc` | Available per UID in `aff-user-list`; excluded by Req 6.20 | Store `registerTime` only if attribution needs sign-up date vs click; `isKyc` needs a stated purpose. |
| — | Bybit key IP binding | Current key: read-only, Affiliate only, IP `*`, expires 2026-12-26 | Provide stable Railway egress IP and rebind before production sync (Req 13.12). |
| — | Enabling a second locale | English-only decided; Vietnamese excluded | If a market is ever requested, confirm the locale plus who supplies translated UI copy and content. |
| 22 | Tên tiếng Anh (Req 20) | Đang mở | Đề xuất `RebateFlow`; chưa được người dùng duyệt. Trước khi chốt: kiểm tra tên miền và trùng thương hiệu/nhãn hiệu |
| 23 | Đầu vào calculator (Req 19) | **Chốt 2026-10-30** | Chỉ volume/tháng có mặc định, nhóm nghìn; estimatedVolumeRate do admin nhập theo offer. Volume mặc định **1,000,000 USDT** theo ví dụ cuộc họp 20/10; có thể chỉnh mặc định sau trong code. |
| 24 | Kỳ ước tính (Req 19) | **Chốt 2026-10-30** | Tháng = volume × estimatedVolumeRate; năm = tháng × 12; chỉ làm tròn hiển thị cuối. |
| 25 | Hướng giao diện (Req 20) | Đã chốt: Dark Aurora | Giữ hero/hình ví cũ; Opportunity Check nổi bật ngay bên dưới; logo Bybit, Binance, MEXC; UI tiếng Anh. Đã triển khai Docker local; mô hình tính theo #23–24 đã chốt, tên mới vẫn thuộc #22. |
| 26 | Lịch chi (Req 22; Req 21 on-chain riêng) | **Lịch/cutoff/retry USDT nội bộ đã chốt; lịch on-chain riêng** | Câu 3 gộp theo sàn + UID + USDT; câu 5 approve sau đợt không gửi ngay; câu 6 bỏ lỡ đợt thì chờ 23:00 UTC kế tiếp, gộp các khoản còn đủ điều kiện, không chạy bù lúc khôi phục. UNPAID + WAITING_SCHEDULE, approval chỉ dùng khi snapshot còn hợp lệ; UNKNOWN vẫn đối soát. Câu 8 chốt cutoff 23:00 UTC, nguồn mới sau đó để đợt sau. Câu 9 lỗi chắc chắn chưa chuyển chờ đợt 23:00 UTC ngày sau; UNKNOWN chỉ đối soát. Lịch on-chain Req 21 riêng. |
| 27 | Ngưỡng và hạn mức USD (Req 9/21/22) | **USDT nội bộ: >0.5 đến <=20 auto, >20 duyệt; không daily cap riêng, theo nguồn thực** | Xét tổng principal execution sau gộp; đúng 20 USD đủ điều kiện tự trả khi các gate khác đạt. Khoản >20 giữ UNPAID + AWAITING_APPROVAL, không dùng ngưỡng asset hay xét từng allocation/chia nhỏ để né duyệt. Câu 11 chốt operator chịu phí USDT nội bộ, khách nhận đủ principal; câu 12 chốt fixed 1:1/20 USDT không market quote; câu 14 chốt minimum strict >0.5 USDT sau gộp; câu 15 chốt không daily cap riêng, chi theo nguồn đủ principal+phí, thiếu funds chờ đợt ngày sau. Câu 16 chốt skip nhóm thiếu funds, tiếp tục nhóm sau; còn thứ tự ưu tiên ban đầu và kiểm chứng quyền/giới hạn/phí provider; quote tài sản khác riêng. Chưa đủ gate bắt buộc thì giữ blocked. Câu 13 đã loại customer withdrawal/partial; grain và mapping vật lý còn review ở #34. |
| 28 | Định giá ngưỡng (Req 21/22) | **USDT nội bộ đã chốt cố định 1:1; quote tài sản khác còn mở** | Câu 12/22.34: ngưỡng là 20 USDT, không cần market quote USDT/USD; lưu fixed policy trong snapshot/audit. Nhà cung cấp, tuổi báo giá và thời điểm khóa cho coin khác/on-chain còn mở; không áp 1:1 cho ETH/BNB/SOL. |
| 29 | Tài sản sổ ví (Req 21) | Đang mở | Coin gốc hay chuyển từ USDT; nếu chuyển cần chốt phí, tỷ giá, hạch toán |
| 30 | Vai trò MetaMask (Req 21) | Đang mở | Ví nguồn chi trả hay ví nhận test; cách cấp quyền ký cho worker. Khuyến nghị: không dùng MetaMask/seed cá nhân làm ví chi trả; tạo ví chi trả riêng cho từng môi trường (testnet ≠ mainnet), chỉ giữ số dư nhỏ đủ hạn mức ngày, nạp thêm thủ công từ ví lạnh |
| 31 | Phí và xác nhận (Req 21) | Đang mở | Ai chịu phí, ngân sách gas, điều kiện xác nhận, hạn mức chi/ngày, mức tối thiểu mỗi mạng (Req 21.14–16). Đề xuất để duyệt: Ethereum/BSC dùng block tag `finalized`, Solana dùng commitment `finalized`. Phí gas Ethereum mainnet có thể chiếm tỷ lệ đáng kể của khoản < 20 USD |
| 32 | Test mainnet (Req 21) | Đang mở | Địa chỉ công khai, số tiền test và kế hoạch chạy sau khi local và testnet (Req 21.13) đạt |
| 33 | Thời điểm lập khoản và nguồn chi chung (Req 22) | **Đã chốt (2026-10-17)** | Tự đồng bộ async sau ingest/publish qua commission/cashback hợp lệ và khi release hold/correction; không chờ yêu cầu rút. Tất cả auto/manual phải dùng CustomerPayable, không đi vòng raw/Wallet. Lập sổ chưa đồng nghĩa được phép gửi tiền; command async chung kiểm tra policy trước chi. |
| 34 | Đơn vị khoản, rút một phần và correction (Req 22) | **Đã chốt (2026-10-17)** | Mỗi lần cashback release tạo một payable (`UNIQUE(sourceReleaseEntryId)`); lệnh chi gộp nhiều payable qua `PayableAllocation` (tối đa một ACTIVE cho mỗi payable); T/S/R; khách không rút/partial (câu 13). Correction trước DISPATCHING hủy execution rồi giảm entitlement; sau DISPATCHING ghi pendingCorrection và receivable (Req 8.7). Khi thiếu nguồn: release cũ nhất trước. Chưa làm: backfill legacy; không có thao tác đóng khoản nợ dương. |
| 35 | Quan hệ khoản/lệnh và kích hoạt kênh trả (Req 22) | **Mapping đã chốt (2026-10-17); kênh thật còn chờ xác minh tài khoản** | `PayoutExecution` (bảng riêng, `legacyWithdrawalId` UNIQUE) là lệnh chi; Withdrawal cũ chỉ là lịch sử. Phạm vi MEXC + Bybit USDT nội bộ tới UID, source riêng, UID Bybit thiết lập một lần (câu 1–2). Còn mở: adapter thật, quyền API/IP, quy trình address book Bybit, MEXC thực tế, Binance Payout (docs/exchange-uid-payout-research.md). Không bật gửi tiền thật khi chưa có adapter và xác minh tài khoản. |

---

## Phased roadmap

- **Phase 0 — Smoke/seed (answer 7A):** monorepo scaffold, Next.js 15 + worker + Postgres
  on local and Railway; public site with seeded exchanges/offers; redirect + click
  tracking; admin login (interim auth). No real affiliate data.
- **Phase 1 — Import & attribution:** manual native/normalized report import,
  dataset-specific staging/preview/
  commit, UID accounts, commission attribution.
- **Phase 2 — Tra cứu và chi tự động:** lookup công khai; Wallet nội bộ, holding/release, queue admin legacy và payables. Task 44 cập nhật calculator/ngày báo cáo và gỡ truy cập riêng tư khách.
- **Phase 3 — Hardening:** analytics depth, KYC/compliance controls,
  observability/backups. No locale rollout is planned (Requirement 4).
- **Phase 4 — Automation:** scheduled Bybit and MEXC Affiliate API activity sync
  with per-exchange admin intervals; MEXC day totals await live reconciliation.
  Add other official connectors after permissions and data semantics are verified.
  SSE remains optional.
- **Phase 5 — Dark Aurora/Calculator triển khai local, payout còn rà soát:** Req 19–20 / Task 40 đã có code và kiểm tra tự động Docker, chờ visual QA; giữ Cashback Hub hiện tại, đổi tên chờ #22. Thanh toán tự động ETH/BNB/SOL (Req 21) chỉ bắt đầu sau khi chốt Open decisions #19 và #26–32, chạy đạt local → testnet rồi mới mainnet.
- **Sổ khoản phải trả (Req 22 / Task 42):** #33–35 đã chốt; schema, đồng bộ async, đợt 23:00 UTC, approval, đối soát, gate cutover và API/UI admin đã triển khai và chạy mô phỏng trên Docker (xem `payables-rtm.md`). Còn lại: adapter MEXC/Bybit thật cùng xác minh tài khoản/quyền API, backfill legacy và cutover production, gỡ UI rút của khách, tỷ lệ cashback và holding.

---

## Out of scope for MVP
- Any non-English locale, including Vietnamese (Requirement 4). Only the i18n seams ship.
- Real-time exchange event streaming and market-data WebSockets.
- Bot filtering / unique-click analytics (answer 18).
- Automated on-chain payout execution (manual in MVP). Req 21 là đề xuất sau MVP (Phase 5), không thay đổi phạm vi MVP.
- Multi-tier admin roles (single role — answer 14A).
- Tài khoản khách, email binding, ví riêng, khách tự rút và email phục vụ khách. Khách chỉ tra cứu công khai và nhận chi tự động về UID sàn.

---

## Assumptions
- Operator holds valid root-affiliate relationships with Binance, MEXC, Bybit
  (answer 7A), with mock/seed data used until real reports arrive.
- Affiliate data is delayed and revisable; "available" balance reflects only cleared
  cashback.
- Mỗi cặp sàn + UID có một UidAccount và một Wallet mỗi asset phục vụ sổ nội bộ. UID không bí mật; rủi ro công khai số cashback được chấp nhận theo mục Accepted risk.
- Requirements marked "pending decision" will be resolved before their dependent code is
  built; agents should not silently invent values for them.

---

## Changelog




| Ngày | File | Thay đổi | Lý do | Loại |
|------|------|----------|-------|------|
| 2026-10-30 | requirements.md | Sửa Req 14.3/6/7/8: hasData theo cashback đã attribution, cùng no-data shape/thông điệp cho UID lạ và UID chưa có cashback; chỉ hasData=true mới có metric D/zero/NO_DATA | Review Claude Bước 1 và quyết định người dùng 30/10/2026 | updated |
| 2026-10-30 | requirements.md | Chốt Req 19.1 và Open decision #23: volume mặc định 1,000,000 USDT, có thể chỉnh sau trong code | Review Claude Bước 1 và quyết định người dùng 30/10/2026 | updated |
| 2026-10-30 | requirements.md | Req 19: volume-only, estimatedVolumeRate do admin nhập, tháng/năm và loại offer thiếu hệ số | Quyết định người dùng 30/10/2026; spec trước code | updated |
| 2026-10-30 | requirements.md | Req 14/8/API: D theo coverage commission, reportDay nullable, REPORTED zero và giới hạn sourceTz | Quyết định người dùng 30/10/2026; spec trước code | updated |
| 2026-10-30 | requirements.md | Req 15: giữ heading removed; xóa access model/glossary/actor/API/data model/security và phụ thuộc | Quyết định người dùng 30/10/2026; spec trước code | removed |
| 2026-10-30 | requirements.md | Req 16: giữ heading removed; xóa gửi email và OTP tuning | Quyết định người dùng 30/10/2026; spec trước code | removed |
| 2026-10-30 | requirements.md | Đồng bộ Req 3/5/9/20/22, roadmap và out-of-scope; giữ admin legacy và payables | Quyết định người dùng 30/10/2026; spec trước code | updated |
| 2026-10-21 | requirements.md | Đồng bộ Req 8/14/19/20 với cuộc họp: calculator volume và hai giả định do khách nhập; lookup ngày UTC trước/30 ngày, tổng đã trả và bảng tối giản; bỏ Wallet/OTP-rút public và khóa POST rút cũ; cập nhật #12/#23/#24 | Người dùng yêu cầu thực hiện phần đã chốt và trả lời 5 câu multiple choice; không thay policy chi trả đã chốt | updated |
| 2026-10-17 | requirements.md | Câu 16/22.38 bỏ qua nhóm thiếu funds, tiếp tục xét nhóm sau đủ principal+phí | Người dùng chọn giữ khoản5 chờ ngày sau, vẫn xét khoản2 khi nguồn còn3; thứ tự ban đầu chưa chốt | updated |
| 2026-10-17 | requirements.md | Câu 15/22.37 không daily cap riêng cho USDT nội bộ; chi theo nguồn đủ principal+phí, thiếu nguồn đợi 23:00 UTC ngày sau | 100 USDT chỉ là ví dụ nạp, không phải trần; giữ UNPAID và ngăn dùng trùng nguồn | updated |
| 2026-10-17 | requirements.md | Câu 14/22.36 minimum principal strict >0.5 USDT, đúng 0.5 giữ UNPAID tích lũy; vẫn theo provider minimum/precision | Người dùng chọn >0.5 USD theo fixed 1:1, không chọn >=0.5 hoặc trừ phí | updated |
| 2026-10-17 | requirements.md | Câu 13/22.35 auto-only, bỏ customer withdrawal/cancel/partial, sửa Req 9/15/16/20/API và tách session khỏi scheduler | Người dùng không cần khách chủ động rút; giữ private reads/admin commands trên sổ chung | updated |
| 2026-10-17 | requirements.md | Câu 12/22.34 chốt FIXED_USDT_USD 1:1, ngưỡng 20 USDT; bỏ market-quote prerequisite cho kênh USDT nội bộ | Người dùng chọn quy ước nghiệp vụ, không phải giá thị trường; coin khác/on-chain giữ policy riêng | updated |
| 2026-10-17 | requirements.md | Câu 11/22.33 operator chịu phí USDT nội bộ, khách nhận đủ principal; tách phí khỏi ngưỡng và công nợ khách | Người dùng chọn chịu phí, không trừ cashback; ngân sách phí và điều kiện account còn phải chốt/kiểm chứng | updated |
| 2026-10-17 | requirements.md | Câu 10/22.32 bỏ mandatory first review, đồng bộ Req 9.5/15.9/21 và accepted-risk controls | Người dùng chọn <=20 USD tự trả từ lần đầu khi đủ điều kiện; onboarding UID và lịch chi giữ nguyên | updated |
| 2026-10-17 | requirements.md | Chốt câu 9/22.31: lỗi chắc chắn chưa chuyển chờ 23:00 UTC ngày sau, xét lại mọi điều kiện; Req 12.5 không cho job retry vượt lịch tiền | Người dùng chọn chờ đợt ngày sau, tách khỏi đối soát UNKNOWN | updated |
| 2026-10-17 | requirements.md | Chốt câu 8/22.30: cutoff danh sách 23:00 UTC; cashback mới sau cutoff để đợt kế tiếp, correction vẫn theo dispatch guard | Người dùng chọn chốt danh sách khi đợt bắt đầu, không tiếp tục gộp tới thời điểm gửi từng UID | updated |
| 2026-10-17 | requirements.md | Chốt câu 7/22.29: cashback mới trước đợt chi gộp vào tổng chưa gửi, vô hiệu approval cũ và duyệt lại tổng >20 USD | Người dùng chọn gộp 25+5 thành 30 và duyệt lại; giữ ranh giới DISPATCHING/reconcile | updated |
| 2026-10-17 | requirements.md | Chốt câu 6/22.28: bỏ lỡ đợt chờ 23:00 UTC kế tiếp, gộp lại phần đủ điều kiện; phân biệt phục hồi sync/reconcile với dispatch bù | Người dùng chọn đợi đợt kế tiếp thay vì chạy bù ngay khi khôi phục | updated |
| 2026-10-17 | requirements.md | Chốt câu 5/22.27: approve khoản >20 USD sau đợt phải chờ 23:00 UTC kế tiếp, UNPAID + WAITING_SCHEDULE và kiểm lại snapshot | Người dùng chọn chờ đợt tiếp thay vì chuyển ngay sau approve | updated |
| 2026-10-17 | requirements.md | Câu 4 đổi ranh giới: <=20 USD có thể tự trả, >20 USD giữ UNPAID chờ approval; thống nhất Req 9/21/22 và #27 | Người dùng yêu cầu hold khi tổng >20 USD, còn lại trả trực tiếp; không suy quyết định rút một phần | updated |
| 2026-10-17 | requirements.md | Duyệt #34 (payable theo release + allocations, release cũ nhất trước) và #35 (PayoutExecution riêng, legacyWithdrawalId); viết lại 22.14, 22.21 và header Req 22 theo mô hình đã triển khai; ghi `moneyFlowGate` | Người dùng duyệt phương án đề xuất và yêu cầu code theo plan | updated |
| 2026-10-17 | requirements.md | Chốt câu 3/22.26: gộp một lệnh USDT nội bộ theo sàn/UID, một đợt mỗi ngày 23:00 UTC; #26/#34 phản ánh phần đã chốt và phần còn mở | Người dùng chọn gộp cashback và chỉ định giờ UTC+0; chưa chốt grain/partial hoặc cách phục hồi đợt bỏ lỡ | updated |
| 2026-10-17 | requirements.md | Chốt câu 1 tại #35/22.25: MEXC và Bybit trả USDT nội bộ từ source accounts riêng; Binance có điều kiện data/quyền; phân biệt verification thiết lập và từng lần chi, không bypass | Người dùng chọn phạm vi và yêu cầu khảo sát API có thể chạy không cần xác minh mỗi transfer | updated |
| 2026-10-17 | requirements.md | Chốt câu 2 tại #35/22.25: chấp nhận operator thiết lập/xác minh mỗi UID Bybit một lần, các lần chi sau tự động khi đủ điều kiện | Người dùng chọn phương án thiết lập người nhận một lần; account readiness thực tế vẫn chưa kiểm chứng | updated |
| 2026-10-17 | requirements.md | Làm rõ ngưỡng/hủy, recovery theo 8.7, visibility/blocker/cutover và RTM; #34–35 vẫn là gate mở, allocation theo release là phương án review; giữ nguyên UID policy 5.2 | Đánh giá findings theo toàn bộ spec, không coi quyết định mở/đã ghi nhận là lỗi implementation hoặc tự chốt business | updated |
| 2026-10-17 | requirements.md | Chốt #33: CustomerPayable là nguồn chi auto/manual; tự đồng bộ async sau pipeline ingest/cashback, command async chung, enqueue bền vững, phiên bản/freshness và chống ghi đè PAID; liên kết Req 9/12/21 | Người dùng yêu cầu mọi hoạt động dựa trên bảng và tự đồng bộ bất đồng bộ sau ingest | updated |
| 2026-10-17 | requirements.md | Thêm Req 22 sổ khoản phải trả PAID/UNPAID, approval/lý do/đối soát, chống trả trùng và lịch sử; API/model khái niệm, Open decisions #33–35 và roadmap | Người dùng yêu cầu đi từ business spec trước khi tạo bảng lịch sử khoản phải trả | added |
| 2026-10-14 | requirements.md | Req 13.8: chủ động Pause/Resume từng sàn, giữ mode/interval, admin pause độc lập với lỗi, chặn queued/new runs và dừng giữa các ngày; endpoint pause + audit | Người dùng yêu cầu nút pause riêng trong API ingest | updated |
| 2026-10-14 | requirements.md | Chốt #23–24 và Req 19.8 theo plan: phí/tháng USDT, commission assumption, published offer share, tháng/12 tháng, giới hạn/rounding | Người dùng yêu cầu triển khai plan và kiểm tra Docker local | updated |
| 2026-10-14 | requirements.md | Ghi nhận #25 Dark Aurora đã chốt, thêm Req 20.7 về hero/hình ví và Opportunity Check bên dưới; giữ #22–24 mở và tách UI khỏi payout | Đồng bộ hướng giao diện người dùng đã chọn | updated |
| 2026-10-13 | requirements.md | Review Req 19–21: thêm 19.7; làm đo được 20.2–20.3; thêm EIP-55 (21.2), testnet (21.13), hạn mức/tạm dừng/mức tối thiểu (21.14–16); Phase 5 và out-of-scope; gắn Open decisions #22–32 đúng Req; #19 chặn mainnet; nêu mâu thuẫn 9.5/9.10 | Bổ sung kiểm soát an toàn chi trả và tiêu chí kiểm chứng được | added/updated |
| 2026-10-13 | requirements.md | Đưa Req 19–21 vào sau Req 18; gộp quyết định mở vào bảng hiện có; liên kết tác động Req 9/12 và làm rõ cách tự rà soát | Giữ cấu trúc specs theo thứ tự, không dùng phụ lục đề xuất riêng | added/updated |
| 2026-10-11 | requirements.md | Req 13.2 allows Binance GET-only sync with empty responses and raw reconciliation data | Operator narrowed scope to API GET flow before switching affiliate account | updated |
| 2026-10-07 | requirements.md | Req 13.8: exchange selector, per-exchange manual/scheduled settings and disabled preferences for unsupported connectors | Configure different frequencies without implying an OKX API integration exists | updated |
| 2026-10-07 | requirements.md | Req 13.15: preserve MEXC reported zero, isolate web credentials and gate scheduled rollout on period reconciliation | Complete activity connector without losing zero UIDs or assuming daily semantics | updated |
| 2026-09-30 | requirements.md | Req 13.2, 13.15: thêm connector MEXC Affiliate read-only theo ngày, phân trang và chỉ ghi activity | Tích hợp API MEXC mà không tự động ghi ví | updated |
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
| 2026-09-27 | requirements.md | Req 18.9: admin nav xếp từng link một hàng; Data ingest/Reports xổ xuống, tự mở nhóm của route hiện tại và dùng được bằng bàn phím trên màn hình hẹp | Sidebar hiện tại dồn link ngang và ngắt nhãn khó đọc | added |
| 2026-09-27 | requirements.md | Req 13.14: worker ghi readiness an toàn và còn hạn cho web; chặn Enable/Sync khi chưa sẵn sàng và hiện mã lý do cụ thể, không đưa secret sang web | Web hiện tự kiểm tra biến môi trường chỉ có trên worker nên luôn báo Connector is not ready | added |
| 2026-09-27 | requirements.md | Req 13.12/13.14: bỏ điều kiện bắt buộc IP allowlist; key `ips=["*"]` vẫn được sync nếu read-only Affiliate và chưa hết hạn, chỉ cảnh báo IP/expiry; giữ chặn khi Bybit thực sự từ chối IP | Người vận hành chọn dùng key không giới hạn IP để bật ingest tự động | updated |
| 2026-09-27 | requirements.md | Req 18.10: hai ngày lọc báo cáo Referral activity mặc định là ngày hiện tại theo UTC; bỏ ô source timezone trong báo cáo và luôn diễn giải kỳ lọc theo UTC, giữ metadata timezone cho upload | Giảm thao tác nhập trên trang báo cáo và thống nhất ranh giới ngày với dữ liệu API | added |
| 2026-09-27 | requirements.md | Req 18.11–18.12: làm rõ nhãn trạng thái báo cáo, tăng độ nổi bật của date picker và cho phép quay về trang trước/trang đầu khi phân trang | Người vận hành khó hiểu trạng thái, khó thấy lịch và bị kẹt ở trang cuối | added |
| 2026-10-27 | requirements.md | Làm rõ Req 14.4: cửa sổ phút/giờ phải độc lập dù trùng thời điểm bắt đầu | Test thời gian cố định tái hiện lookup bị 429 sớm khi hai cửa sổ dùng chung counter; không đổi hạn mức | updated |
| 2026-10-30 | requirements.md | Chuyển spec từ `.kiro/specs/` sang `docs/specs/`, steering sang `.claude/rules/`; cập nhật đường dẫn và tên agent (Claude/Codex/agy), không đổi nghiệp vụ | Chuyển từ Kiro sang Claude quản lý knowledge | updated |
