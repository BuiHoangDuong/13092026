# Happy-path scenarios — Cashback Affiliate Platform

- **Status:** Draft v3.0 (target 30/10/2026; Task 44 chưa triển khai/kiểm chứng; P1–P14 có bằng chứng mô phỏng trước đây)
- **Last updated:** 2026-10-30
- **Based on:** `requirements.md` (Draft v0.6), `design.md` (Draft v0.7), and
  Railway Postgres (`public`) as of 2026-09-17. A Bybit test report for UID
  `001234567` was published the same day so lookup has a real balance.
- **Audience:** testers and the operator (admin). This is a runbook of **happy
  cases**, not an error catalog.

> Source of truth for behavior remains `requirements.md` / `design.md`. If a step
> here disagrees with those files, those files win — update this document.
> **Cập nhật 30/10/2026:** khách chỉ tra cứu công khai và nhận chi tự động về UID sàn; không email binding, phiên UID, ví riêng hoặc tự rút. S8–S12/S14–S15 đã gỡ, không tái dùng số. Queue admin legacy/payables giữ nguyên. Dump bên dưới chỉ là ảnh chụp lịch sử, không chứng minh target Task 44.

>
> **Không tự tạo số dư.** Số tiền thực từ cashback đã attribution; zero được xác nhận theo coverage Req 14. The
> live dump has one: Bybit `001234567` with 30 USDT pending.
>
> Out of scope here: rate-limit 429s, clawback /
> receivable, overlapping-report rejection, crash recovery, and Phase 4 API sync.

---

## Live dump snapshot (Railway, 2026-09-17)

Read-only query against the hosted DB. Re-dump before a later test run if
imports or withdrawals have landed since.

| Entity | Count in dump | Notes |
|--------|---------------|-------|
| `Exchange` | 3, all `PUBLISHED` | binance, mexc, bybit |
| `Offer` | 3, all `PUBLISHED` | one per exchange |
| `ReferralLink` | 3, all `active` | destinations are exchange homepages (seed placeholders, not live affiliate URLs) |
| `Guide` | 3, all `PUBLISHED` | `{slug}-cashback-guide` |
| `UidAccount` | **1** | Bybit + `001234567` (created by the 2026-09-17 test import) |
| `Wallet` | **1** | USDT `pending=30`, `available=0` (`HOLDING_PERIOD_HOURS` is unset, so holds do not release) |
| `CommissionRecord` | **1** | `100` USDT commission × Bybit rate `0.3` → credited cashback `30` |
| `ImportBatch` | **1** | `PUBLISHED`, root `bybit-happy-path`, period 2026-09-01 → 2026-09-16 UTC |
| `Withdrawal` | **0** | none yet |
| `ClickEvent` | 3 | all on the **Binance** seed link |
| `AdminAccount` | 1 | `admin@example.com` |

### Published exchanges (use these on `/` lookup)

| Slug | Name | Exchange id (lookup / CSV metadata) | Default cashback rate | Logo |
|------|------|--------------------------------------|-----------------------|------|
| `binance` | Binance | `cmu3lhxbu0000nb5c6f9nurwx` | **0.4** (40%) | `/exchange-logos/binance.png` |
| `mexc` | MEXC | `cmu3lhxd60007nb5cemasvui7` | **0.35** (35%) | `/exchange-logos/mexc.png` |
| `bybit` | Bybit | `cmu3lhxdu000enb5cb3zd72lp` | **0.3** (30%) | `/exchange-logos/bybit.png` |

Offer rates match the exchange defaults (binance `0.4`, mexc `0.35`, bybit `0.3`).

### Referral links (S3)

| Exchange | `linkId` | `/go/...` | Destination in dump |
|----------|----------|-----------|---------------------|
| Binance | `cmu3lhxcs0004nb5c9wg7hxy3` | `/go/cmu3lhxcs0004nb5c9wg7hxy3` | `https://www.binance.com/` (3 clicks already) |
| MEXC | `cmu3lhxdn000bnb5cak9emp6n` | `/go/cmu3lhxdn000bnb5cak9emp6n` | `https://www.mexc.com/` |
| Bybit | `cmu3lhxec000inb5ci34lc4zv` | `/go/cmu3lhxec000inb5ci34lc4zv` | `https://www.bybit.com/` |

### Guides (S2)

| Path | Title in dump |
|------|----------------|
| `/guides/binance-cashback-guide` | Binance cashback guide |
| `/guides/mexc-cashback-guide` | MEXC cashback guide |
| `/guides/bybit-cashback-guide` | Bybit cashback guide |

### Lookup theo target 30/10/2026 (Task 44.2 chưa làm)

Nhập đúng sàn + UID (giữ số 0 đầu). Ngày báo cáo D là ngày UTC mới nhất ≤ hôm qua có ImportBatch COMMISSION/PUBLISHED phủ trọn ngày, chi tiết ngày (batch ≤1 ngày hoặc TRANSACTION), không partial (sourceAsOf null hoặc ≥ periodEnd). Response `summaryPeriods { reportDay, rollingStart, end }` và metric theo Req 14; tổng đã trả = Wallet.withdrawn. Không dùng số pending trong dump làm expected lookup hiện tại.

- UID không tồn tại hoặc đã biết nhưng chưa có bất kỳ cashback attribution nào → hasData=false, cùng shape rỗng và thông điệp "no cashback data for this UID under our referral links", không hiển thị metric dù sàn có D.
- Chỉ khi hasData=true (đã có cashback attribution), có D nhưng UID không có commission trong kỳ → REPORTED 0; bảng rỗng được phép.
- Khi hasData=true và sàn chưa có D → NO_DATA, reportDay/rollingStart/end null.
- Khi hasData=true, bản ghi nhiều ngày cắt biên thiếu breakdown → INSUFFICIENT_DETAIL/null; không prorate. Batch sourceTz khác UTC có thể không phủ ngày UTC.

## How to use this document

Các scenario là target hành vi; chỉ coi đã đạt khi có evidence tương ứng Task 44. Dump 2026-09-17 và mô phỏng payables cũ không chứng minh thay đổi mới.

| Area | Route |
|---|---|
| Public discovery/lookup/calculator | `/`, `/#lookup` |
| Link cũ | `/withdraw` redirect `/#lookup` |
| Admin legacy history | `/admin/withdrawals` (xác thực admin) |
| Sổ phải trả | `/admin/payables` (xác thực admin) |

## Actors

| Actor | Who | How they authenticate |
|-------|-----|------------------------|
| Visitor | Anyone on the public site | None |
| Admin | Operator staff | Email + password at `/admin/login` |
| Worker | Background process | Internal (no UI). Must be running for parse / publish / attribute / hold-release |

---

## Prerequisites (before S0)

These are configuration and seed conditions, not scenarios.

| Item | Happy-path value | Why |
|------|------------------|-----|
| Web + worker + Postgres | All healthy (`GET /api/health` → `status: "OK"`, worker `HEALTHY`) | Import and hold-release need the worker |
| Admin in dump | Email `admin@example.com` (password = `SEED_ADMIN_PASSWORD` from the environment that last ran seed) | S1 |
| Published content | Already in dump (3 exchanges / offers / links / guides) | S2, S3, S4 |
| `HOLDING_PERIOD_HOURS` | `0` for a same-session test of available balance; a positive number if you will wait that many hours | Empty keeps credits **pending** forever (not withdrawable) |
| `CLIENT_IP_HEADER` | `x-forwarded-for` on Railway | Lookup fail closed in production without a trusted IP header |
| Test UID | Bybit `001234567` — already attributed (pending 30 USDT). Keep leading zeros. | S7 |
| Normalized Bybit CSV v1 | See S4. Native Bybit export is not a cashback path yet. MEXC Referral Data XLSX is an admin activity snapshot and does not credit wallets | S4 |

---

## End-to-end loop (map of the main path)

```
Admin publishes content
        ↓
Visitor browses offers and clicks /go/:linkId  →  signs up on the exchange (off-platform)
        ↓
Admin uploads affiliate CSV  →  worker parses  →  admin publishes
        ↓
Worker attributes cashback to UidAccount (created on demand)  →  pending
        ↓
Worker RELEASE_HOLDS  →  available
        ↓
Visitor looks up exchange + UID (ngày báo cáo/30 ngày, totalPaid)
        ↓
Worker lập payable sau release, tự xét chi lúc 23:00 UTC tới UID sàn
  ↓
Admin duyệt theo ngưỡng khi cần; worker gửi/đối soát, settle vào Wallet.withdrawn
  ↓
Khách xem ngày báo cáo/30 ngày và tổng đã trả qua lookup công khai
```

---

## Scenario index

| ID | Name | Actor | Requirements |
|----|------|-------|--------------|
| S0 | Health is green | Operator | 12, deployment NFR |
| S1 | Admin signs in | Admin | 3, 10.1 |
| S2 | Visitor browses published content | Visitor | 1, 4 |
| S3 | Visitor follows a referral link | Visitor | 2 |
| S4 | Admin uploads a Bybit report | Admin + Worker | 6.1–6.6 |
| S5 | Admin publishes the report | Admin + Worker | 6.7–6.9, 7 |
| S6 | Cashback becomes available | Worker | 8.2, 8.3 |
| S7 | Visitor looks up exchange + UID | Visitor | 14, 8.5 |
| S13 | Admin creates and publishes content | Admin | 10 |
| S16 | Admin reads the operations dashboard | Admin | 11 |
| S17 | Admin uploads a MEXC Referral Data XLSX | Admin + Worker | 6.12, 6.16 |
| S18 | Admin publishes and reads the MEXC snapshot | Admin + Worker | 6.13, 6.15 |
| S19 | Admin re-imports the same MEXC period with a newer export | Admin + Worker | 6.14 |
| P1 | Cutover gate sang PAYABLE_ONLY | Admin | 22.24, 22.35 |
| P2 | Release cashback sinh khoản phải trả | Worker + Admin | 22.2, 22.16–17 |
| P3 | Tự trả 3+5+7 gộp một lệnh 15 USDT | Worker | 22.26, 22.6 |
| P4 | Ngưỡng 0.5 / 20 / 20.01 và tích lũy | Worker | 22.6, 22.34, 22.36 |
| P5 | Duyệt > 20 USDT, gửi ở đợt kế tiếp | Admin | 22.5, 22.27 |
| P6 | Cashback mới trước đợt: gộp + duyệt lại | Worker + Admin | 22.29–30 |
| P7 | Bỏ lỡ đợt 23:00 | Worker | 22.28 |
| P8 | Sàn xác nhận chưa chuyển, thử lại hôm sau | Worker | 22.7, 22.31 |
| P9 | Timeout, UNKNOWN, đối soát | Worker + Admin | 22.8–9 |
| P10 | Thiếu tiền nguồn, release cũ nhất trước | Worker | 22.33, 22.37–38 |
| P11 | Recipient/phí chưa sẵn sàng | Worker + Admin | 22.25, 22.33 |
| P12 | Correction trước/sau khi gửi | Worker | 22.20, 22.22, 8.7 |
| P13 | Trả thủ công có bằng chứng khớp | Admin | 22.9, 22.14 |
| P14 | Khách không còn rút tiền | Khách | 22.35 |

---

## S0 — Health is green

**Actor:** Operator  
**Preconditions:** Web, worker, and Postgres are deployed.

### Steps
1. Open `GET /api/health` (or the Railway healthcheck on `@cashback/web`).

### Expected
- HTTP 200, `status: "OK"`, `database.ok: true`.
- `worker.status: "HEALTHY"` with a recent `lastHeartbeatAt`.
- Queue counts are numbers (pending/claimed/failed may be zero).
- No secrets, job payloads, or raw reports in the body.

---

## S1 — Admin signs in

**Actor:** Admin  
**Preconditions:** Dump has `AdminAccount.email = admin@example.com`.

### Steps
1. Open `/admin` while logged out → redirected to `/admin/login`.
2. Email `admin@example.com` + the seed password from env (`SEED_ADMIN_PASSWORD`).
3. Land on `/admin`.

### Expected
- Unauthenticated admin routes are denied (redirect or 401 on APIs).
- After login, `/admin` is the **overview** (analytics) inside a **left nav**.
  Nav groups: Overview; Data ingest (Uploads, API connectors); Reports
  (Referral activity); Withdrawals, Exchanges, Offers, Referral links, Guides.
  Login has no sidebar.
- Admin session chỉ dùng cho quyền admin; không có phiên khách hoặc private UID API.

---

## S2 — Visitor browses published content

**Actor:** Visitor  
**Preconditions:** Current dump (3 published exchanges, 3 offers, 3 guides).

### Steps
1. Open `/`. Home grid shows **Binance**, **MEXC**, **Bybit** tiles with logos.
2. Open `/exchanges`, then `/exchanges/bybit` (also `/exchanges/binance`, `/exchanges/mexc`).
3. Open `/guides/bybit-cashback-guide` (also the binance and mexc guide slugs).
4. Confirm the UI is English only (no Vietnamese locale, no `/vi` route).

### Expected
- All three seed exchanges/offers/guides render server-side.
- Rates on the tiles match the dump: Binance 40%, MEXC 35%, Bybit 30%.
- Unpublished items are absent (dump has none unpublished).
- Browser never talks to the database; public reads go through `/api/exchanges`
  and SSR.
- `/exchanges/bybit` shows the Bybit offer, the Bybit guide, and a CTA to
  `/go/cmu3lhxec000inb5ci34lc4zv`.

---

## S3 — Visitor follows a referral link

**Actor:** Visitor  
**Preconditions:** Dump links above are `active`. Destinations are **seed
homepages**, not live affiliate URLs (replace in S13 when you have the real
ones).

### Steps
1. Open `/go/cmu3lhxec000inb5ci34lc4zv` (Bybit) or click the Bybit CTA.
2. Optionally also hit the Binance link `/go/cmu3lhxcs0004nb5c9wg7hxy3` (dump
   already has 3 clicks on it).

### Expected
- Bybit: HTTP 302 to `https://www.bybit.com/`.
- Binance: HTTP 302 to `https://www.binance.com/`; click count becomes 4+.
- Redirect does not wait on any exchange API or import job.
- Unknown `linkId` does **not** open-redirect; visitor lands on `/exchanges`.
- S16 later shows clicks on those link ids.

---

## S4 — Admin uploads a Bybit report

**Actor:** Admin + Worker  
**Preconditions:** S1. Dump already has Bybit `PUBLISHED`
(`cmu3lhxdu000enb5cb3zd72lp`). Worker is healthy. The 2026-09-17 dump
already contains a published report for the sample UID and period below;
uploading the same values again is a correction, not a second cashback credit.

### CSV to upload (normalized v1, UTF-8)

Use the same UID on Bybit for S5–S7. It is already present in the 2026-09-17
dump; use a new UID and period if testing the first import into a fresh DB.

Aggregate happy path (Bybit default rate in dump is **0.3** → `100` commission
credits **30** USDT cashback):

```csv
uid,asset,commission
001234567,USDT,100.0000000000
```

Optional transaction-level happy path:

```csv
uid,asset,commission,transaction_id,occurred_at
001234567,USDT,10.5000000000,commission-123,2026-09-01T12:34:56Z
```

UID stays a string (keep leading zeros). `commission` is **affiliate commission
in that asset**, not trading volume. Bybit operations metadata `exchangeId` is
the dump id `cmu3lhxdu000enb5cb3zd72lp` (the form fills this when Bybit is
published).

### Steps
1. Copy the **aggregate** CSV block above into a local text file named
   `bybit-happy-path.csv`. Save it as UTF-8 with the `.csv` extension (not
   `.csv.txt`); keep `001234567` exactly, including both leading zeros.
2. Open `/admin/ingest/uploads` (left nav **Data ingest → Uploads**).
3. Choose exchange **Bybit** and dataset **Commission**. Fill **Root affiliate account** = `bybit-happy-path`, **Period start** =
   `2026-09-01`, **Period end** = `2026-09-16`, and **Report type** =
   `Period totals` (`AGGREGATE`). Commission uploads use UTC.
4. In **CSV file**, click the file picker and select `bybit-happy-path.csv` from
   your computer. Check that the selected filename appears in the form.
5. Click **Upload for preview**. Wait while the UI polls (~5s while the batch
   is `UPLOADED` / `PARSING`): the worker performs LOAD, then TRANSFORM.
6. Open the new row in the upload list and verify status `PREVIEW` and
   **0 flagged** before continuing to S5.

### Expected
- API returns `202` with a `batchId`. The HTTP request does **not** parse the
  whole file.
- Worker stores raw rows in `raw_bybit`, then asynchronously transforms them
  into staging rows and sets the batch to `PREVIEW`.
- Preview shows totals, flagged-row count `0`, and no blocking errors.
- Staging data is **not** visible on public lookup yet.
- Original file is stored privately (not a public URL).

---

## S5 — Admin publishes the report

**Actor:** Admin + Worker  
**Preconditions:** S4 batch is `PREVIEW` with zero flagged rows.

### Steps
1. On the batch preview page, click **Publish**.
2. Wait until status is `PUBLISHED` (UI polls ~5s while `COMMITTING`).

### Expected
- Worker upserts `CommissionRecord` / `CommissionVersion` (idempotent: publishing
  the same batch again does not double-count).
- Worker attributes each row to `(exchange, UID)`:
  - creates the `UidAccount` if it does not exist (no email, no session needed);
  - cashback = `commission × rate` (offer rate only if a system-corroborated
    `referral_link_id` is present; otherwise the exchange default);
  - rate and offer are snapshotted on the commission.
- Wallet for **Bybit + `001234567`**: `pending` = `30` USDT when the CSV
  commission is `100` and the dump Bybit default rate `0.3` is used (no
  `referral_link_id` in the sample CSV → exchange default, not the offer).
- Re-clicking **Publish** on the same batch does not credit twice.
- Before this repeat upload is published, `/` lookup of Bybit + `001234567`
  hiển thị credited cashback đã ghi nhận; tổng kỳ theo coverage D của Req 14, không theo ngày hiện tại.
- After status is `PUBLISHED` but before the ATTRIBUTE job finishes, lookup
  still shows the previous credited commission, not the new `reconciledAmount`.
  The row matches `creditedCashback`. After ATTRIBUTE, lookup shows the new
  credited cashback (không công khai commission).

---

## S6 — Cashback becomes available

**Actor:** Worker  
**Preconditions:** S5 credited `pending`. `HOLDING_PERIOD_HOURS` is `0` (release
on the next scheduler tick, about once a minute) **or** the configured hours
have elapsed.

### Steps
1. Wait for one worker `RELEASE_HOLDS` tick (about 1 minute when the period is
   `0`).
2. Admin theo dõi sổ nội bộ và payable; không có bước khách yêu cầu rút.

### Expected
- The credited amount moves `pending → available`.
- `pending` / `available` never go negative.
- Admin kiểm tra release vào available trong sổ nội bộ; lookup S7 không hiển thị bucket ví.
- `reserved` / `withdrawn` / `receivable` stay `0` on this path.

---

## S7 — Khách tra cứu công khai theo sàn + UID

**Actor:** Visitor · **Req:** 14, 8.5 · **Trạng thái:** target mới, chưa kiểm chứng.

1. Admin publish batch commission đủ coverage ngày UTC D ≤ hôm qua, chi tiết ngày và không partial; ATTRIBUTE xử lý theo pipeline.
2. Trên trang public chọn sàn + UID, giữ nguyên số 0 đầu.
3. Kiểm tra nhãn Ngày báo cáo D, summaryPeriods và bảng chỉ ngày/kỳ, asset, UID, cashback.

**Kỳ vọng:** previousDay theo `[D,D+1)`, rolling30Days theo `[D−29,D+1)`; tổng trên mọi dòng không giới hạn 100 dòng bảng. totalPaid từ Wallet.withdrawn, không cộng lại payables. UID không tồn tại và UID đã biết/chưa có cashback attribution đều hasData=false, cùng shape rỗng/message "no cashback data for this UID under our referral links", không hiển thị metric. Chỉ khi hasData=true: có D và UID không dòng trong kỳ → REPORTED 0; chưa D → NO_DATA/reportDay null; kỳ nhiều ngày cắt biên → INSUFFICIENT_DETAIL/null. Không commission/rate/volume/bucket ví/email/lịch sử lệnh trong response. Lookup không tạo UID/Wallet. `/withdraw` redirect `/#lookup`; không có control đăng nhập hoặc rút.

S8–S12 đã removed theo quyết định 30/10/2026; không tái dùng số. Admin duyệt/mark-paid theo P5/P13 và queue lịch sử, không tạo yêu cầu rút của khách.

---

## S13 — Admin creates and publishes content

**Actor:** Admin  
**Preconditions:** S1. Dump already has seed Binance/MEXC/Bybit content; this
scenario is for adding or replacing a row (e.g. real affiliate destination).

### Steps
1. Open `/admin/exchanges`. Create an **exchange** (slug, English name +
   description, default cashback rate, status `PUBLISHED`).
2. Open `/admin/offers`. Create an **offer** on that exchange (rate 0–1, English copy, `PUBLISHED`).
3. Open `/admin/links`. Create a **referral link** on the same exchange, bound to that offer,
   destination = real affiliate URL, `active`.
4. Open `/admin/guides`. Create a **guide** (slug, optional exchange, English title/content,
   `PUBLISHED`).
5. Reload `/` and `/exchanges/[slug]` / `/guides/[slug]` without a hard cache
   wait beyond the next public read.

### Expected
- Same-exchange invariant: a link cannot bind an offer from another exchange.
- Next public read shows the new published content; draft/unpublished stays
  hidden.
- Admin forms author **English only**.
- Editing a published field is visible on the next public read (S2).

**Unpublish (still a success path for ops):** set status to `DRAFT` / inactive
→ item disappears from public pages immediately on the next read. Re-publish
to restore S2.

---

S14–S15 đã removed theo quyết định 30/10/2026; không tái dùng số.

---

## S16 — Admin reads the operations dashboard

**Actor:** Admin  
**Preconditions:** S1. Dump already has 3 Binance clicks; after S3/S5 the
dashboard also shows new clicks and the first import.

### Steps
1. Stay on `/admin` (overview) with the tab visible.
2. Read analytics (clicks by link / exchange / time), attribution split,
   import/source freshness, job/sync status.
3. Optionally open `/admin/withdrawals` in a **second tab** to work the queue
   at the same time.
4. Hide the overview tab, then show it again.

### Expected
- Numbers come from internal data, not live exchange APIs.
- Visible-tab poll ~30s **on that page only**; `/admin/ingest/uploads` polls ~5s while
  a batch is processing. Closed sections do not poll.
- Polling pauses when the tab is hidden.
- Responses are `Cache-Control: private, no-store`.
- No secrets, API keys, or full raw report files in the UI.

---

## S17 — Admin uploads a MEXC Referral Data XLSX

> S17–S19 are a **separate admin loop**. A referral activity snapshot is an
> export metric, not commission: it never credits a wallet, never appears in `/`
> lookup, and never changes withdrawal eligibility (Req 6.13, 6.15).

**Actor:** Admin + Worker

**Preconditions:** S1. MEXC is `PUBLISHED` in the dump
(`cmu3lhxd60007nb5cemasvui7`). Worker is healthy. Migration
`202609250001_ingest_envelope` has been applied on the target DB.

### File to upload

Use the committed synthetic fixture
`packages/core/test/fixtures/mexc-referral-activity.xlsx` (fake UIDs). Do not
upload or commit a real export from `data/mexc/` on a shared test environment.

| Property | Fixture value |
|----------|---------------|
| Worksheet | exactly one, named `_2026-09-18~2026-09-25` |
| Mapped columns | `Referral`, `Referral Code`, `Trading volume`, `Trading token`, `Your Earnings`, `Commission token` |
| Extra columns | `Nickname`, `Prediction Markets Fee-Sharing Rate` → preview warnings only |
| Rows | 2: UID `00123456` and `10000002`, all volume/earnings `0` USDT |

A real MEXC export works the same way (its sheet name gives the period, its
file name `Referral Data Export-YYYY-MM-DD HH_MM_SS.xlsx` gives the as-of time).

### Steps
1. Open `/admin/ingest/uploads` (left nav **Data ingest → Uploads**). Choose exchange **MEXC** and dataset **Referral activity**.
2. Fill **Root affiliate account** = `mexc-happy-path`, **Source timezone** =
   `UTC`, **Period start** = `2026-09-18`, **Period end** = `2026-09-25`,
   **Source as of** = `2026-09-25 14:22:39` (in the source timezone).
3. In **File (.xlsx)**, select the fixture file. (With a real export
   the as-of field is prefilled from the file name; confirm it before upload.)
4. Click **Upload for preview**. The list polls ~5s while the batch is
   `UPLOADED` / `PARSING`: the worker performs LOAD, then TRANSFORM.
5. Click the `mexc-happy-path` row in the upload list.

### Expected
- API returns `202` with a `batchId`; parsing happens in the worker.
- Raw load status becomes `TRANSFORMED`, then batch preview status `PREVIEW`,
  **2 rows · 0 flagged**.
- Preview shows **Partial export** (as-of 2026-09-25 14:22:39 is before the
  period ends at 2026-09-25 23:59:59.999 UTC) and **Does not affect cashback**.
- `Nickname` is removed before the raw table. The warning lists
  `Extra column: Prediction Markets Fee-Sharing Rate`.
- The preview JSON never contains the nickname value (`Do Not Store`) or any
  unmapped column (Req 6.16).
- Filtering the upload list to Commission does not show this activity batch. The row is labeled so it does not affect cashback.

---

## S18 — Admin publishes and reads the MEXC snapshot

**Actor:** Admin + Worker

**Preconditions:** S17 batch in `PREVIEW` with 0 flagged rows.

### Steps
1. Open the S17 batch at `/admin/ingest/uploads/[id]` and click **Publish**.
2. Wait for the status to become `PUBLISHED`.
3. Open `/admin/reports/activity`. Choose **MEXC**, timezone `UTC`,
   **Period start** = `2026-09-18`, **Period end** = `2026-09-25`, then click
   **Show activity**.
4. Open `/`, choose **MEXC**, and look up UID `00123456`.

### Expected
- Batch goes `PREVIEW` → `COMMITTING` → `PUBLISHED`. Clicking Publish again
  does not create a second snapshot.
- Table shows 2 rows: `00123456` and `10000002` (leading zeros kept), volume
  `0.0000000000 USDT`, earnings `0.0000000000 USDT`, **Partial = Yes**,
  **Source as of** `2026-09-25 14:22:39`, root `mexc-happy-path`.
- The note above the table says reported earnings are not wallet credit. A row
  of zeroes means the export reported zero, not missing data.
- `/` lookup of MEXC + `00123456` is still **no-data**: no `UidAccount`,
  `CommissionRecord`, or wallet was created.
- Bybit `001234567` balance from S5 is unchanged.

---

## S19 — Admin re-imports the same MEXC period with a newer export

**Actor:** Admin + Worker

**Preconditions:** S18 published.

### Steps
1. On `/admin/ingest/uploads`, upload the same fixture again with the same root
   account, timezone and period, but **Source as of** = `2026-09-26 00:10:00`
   (after the period end, and not in the future).
2. Open the new batch: expect `PREVIEW`, 0 flagged, **Covers the full period**.
3. Click **Publish**, wait for `PUBLISHED`.
4. Open `/admin/reports/activity` again for MEXC, `UTC`, `2026-09-18` / `2026-09-25`.

### Expected
- Still exactly 2 rows (the new version **replaces** the old one; volumes and
  earnings are not added together).
- **Partial = No**, **Source as of** `2026-09-26 00:10:00`.
- The S17 batch stays in the list as history; only the newest snapshot is current.
- Only the new load's raw rows remain for that exact root and period; other
  periods and roots are unchanged.
- Uploading a file with an **older** as-of than the current one ends with every
  row flagged `OLDER_REPORT` and Publish disabled — expected guardrail, not part
  of this happy path.

---

## Luồng tự trả cashback (Req 22) — happy cases P1–P14

> **Không có luồng khách tự rút, bất kể gate.** Gate là kiểm soát cutover nội bộ; không mở lại UI/API khách. Hệ thống tự trả USDT nội bộ tới đúng UID cùng sàn mỗi ngày lúc **23:00 UTC**, gộp mọi cashback đủ điều kiện của cùng sàn + UID thành một lệnh. Tổng ≤ 20 USDT: tự trả. Tổng > 20 USDT: chờ admin duyệt. Tổng ≤ 0.5 USDT: tích lũy. Quy đổi cố định 1 USDT = 1 USD, phí do bạn chịu, khách nhận đủ.
>
> **Trạng thái kiểm chứng:** các kịch bản dưới đây đã được **mô phỏng** bằng `scripts/test-payables.mjs` (exchange giả, Docker Postgres, đồng hồ giả lập, không gửi tiền thật) — cột "Mô phỏng" chỉ nhóm assertion tương ứng. **Chưa chạy được end-to-end thật** vì chưa có adapter MEXC/Bybit và chưa xác minh tài khoản nguồn: nếu không có adapter, worker giữ nhóm ở `CONFIG_MISSING` và không gửi. Số liệu dưới đây là ví dụ minh họa, không phải dữ liệu DB Railway.
>
> Chạy mô phỏng: `docker compose -f infra/docker-compose.yml up -d postgres` rồi `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/railway node scripts/test-payables.mjs` (cần `pnpm --filter @cashback/db build` và `pnpm --filter @cashback/core build` trước).

### Điều kiện chung (trước P1)

| Mục | Giá trị |
|-----|---------|
| Worker | Chạy; heartbeat `HEALTHY` (S0) |
| `HOLDING_PERIOD_HOURS` | `0` để thử cùng ngày; số dương nếu chờ thật |
| Tài khoản chi trả | Mỗi sàn một tài khoản nguồn + API key có quyền chuyển nội bộ, khác key affiliate; **chưa có adapter nên bước này chỉ mô phỏng** |
| UID Bybit nhận | Đã thêm/xác minh vào address book một lần (Req 22.25) |
| Gate | `PAYABLE_ONLY` (P1) |

### P1 — Cutover: đổi gate sang PAYABLE_ONLY
**Actor:** Admin · **Req:** 22.24, 22.35 · **Mô phỏng:** C1
1. `POST /api/admin/money-flow {"mode":"FROZEN"}` (dừng writer cũ).
2. Còn Withdrawal đang mở hoặc có scope chưa đồng bộ/sai bất biến: `POST … {"mode":"PAYABLE_ONLY"}` bị từ chối (`LEGACY_IN_FLIGHT` / `RECONCILIATION_REQUIRED`). Xử lý xong thì gọi lại.
3. Sau PAYABLE_ONLY, quay về `LEGACY` bị từ chối.

**Kỳ vọng target 30/10:** gate thiếu dòng thì writer tiền từ chối (503); customer POST rút/hủy luôn trả 410 CUSTOMER_WITHDRAWALS_RETIRED trước gate/DB và không mutation. Lookup công khai vẫn đọc được; không ví riêng tư. Bằng chứng C1 cũ cần kiểm lại theo 44.4.

### P2 — Cashback được release thì sổ tự có khoản phải trả
**Actor:** Worker + Admin · **Req:** 22.2, 22.16, 22.17 · **Mô phỏng:** C2
1. Import commission → ATTRIBUTE → hết holding → RELEASE_HOLDS tạo bút toán `HOLD_RELEASE`.
2. Cùng transaction đó sinh job `SYNC_PAYABLES`; worker tạo một `CustomerPayable` cho mỗi lần release.
3. Mở `/admin/payables`.

**Kỳ vọng:** mỗi release là một dòng (ví dụ 3, 5 và 7 USDT của UID `u-sync` là ba dòng), trạng thái `UNPAID`, lý do `Waiting for the 23:00 UTC payout`. Chạy sync lại không tạo thêm dòng. Sync **không** giữ chỗ tiền. Số `pending` chưa release và activity không tạo khoản.

### P3 — Tự trả: 3 + 5 + 7 gộp thành một lệnh 15 USDT lúc 23:00 UTC
**Actor:** Worker · **Req:** 22.26, 22.6 · **Mô phỏng:** C3
1. 23:00 UTC worker chốt manifest, gộp ba khoản của UID `u-sync` (15 USDT ≤ 20) thành một execution, giữ chỗ 15.
2. Execution chuyển `DISPATCHING`, gọi chuyển nội bộ một lần, nhận bằng chứng thành công.

**Kỳ vọng:** đúng một giao dịch 15 USDT; ví: `available 0`, `reserved 0`, `withdrawn 15`; cả ba payable `PAID` có `paidAt`; rời khỏi tab "To pay", còn ở tab "Paid". Chạy lại đợt cùng ngày không gửi lần hai.

### P4 — Ngưỡng biên và tích lũy
**Actor:** Worker · **Req:** 22.6, 22.34, 22.36 · **Mô phỏng:** C4

| Tổng gộp của UID | Kết quả tại đợt 23:00 |
|------------------|-----------------------|
| 0.5 USDT | Chưa trả: tích lũy (`Below the minimum, accumulating`), không giữ chỗ |
| 0.51 USDT (hoặc 0.5 + 0.1) | Tự trả ở đợt đó |
| 20 USDT | Tự trả |
| 20.01 USDT | `AWAITING_APPROVAL`, đã giữ chỗ, **không** gửi |

**Kỳ vọng:** UID nhận lần đầu cũng theo cùng ngưỡng (không còn duyệt lần đầu). Quy tắc không phụ thuộc tỷ giá thị trường.

### P5 — Duyệt khoản > 20 USDT: không gửi ngay, chờ đợt kế tiếp
**Actor:** Admin · **Req:** 22.5, 22.27, 22.19 · **Mô phỏng:** C5
1. Khoản 20.01 USDT hiện `Waiting for approval` ở `/admin/payables`.
2. Nhấn **Approve**; UI gửi lệnh với `commandKey` và `expectedVersion`, nhận `202 + commandId`.
3. Worker xử lý lệnh: execution thành `READY` + lý do `Waiting for the 23:00 UTC payout`, `earliestSendAt` = 23:00 UTC kế tiếp.
4. Đến đợt đó khoản được gửi.

**Kỳ vọng:** duyệt lúc 23:06 ngày D thì không gửi trước 23:00 ngày D+1; `expectedVersion` sai bị `REJECTED STALE_VERSION`; gửi lại cùng `commandKey` cùng nội dung trả lệnh cũ, khác nội dung bị 409; `202` không phải bằng chứng đã duyệt.

### P6 — Có cashback mới trước đợt chi: gộp và duyệt lại
**Actor:** Worker + Admin · **Req:** 22.29, 22.30 · **Mô phỏng:** C6
1. UID có 25 USDT đã duyệt, chưa gửi.
2. Trước cutoff đợt sau, release thêm 5 USDT.
3. Đợt sau gộp thành **30**, approval 25 mất hiệu lực, trạng thái về `AWAITING_APPROVAL`.
4. Admin duyệt lại; đợt kế tiếp gửi 30.

**Kỳ vọng:** không bao giờ trả riêng 25; chỉ một execution mở cho UID. Cashback release **sau** 23:00 chỉ vào đợt hôm sau.

### P7 — Hệ thống lỗi, bỏ lỡ đợt 23:00
**Actor:** Worker · **Req:** 22.28 · **Mô phỏng:** C7
1. Worker ngừng suốt 23:00; khôi phục lúc 01:00 UTC hôm sau.
2. Job của đợt cũ bị đánh `MISSED`, không gửi bù.
3. 23:00 UTC kế tiếp gộp và trả các khoản còn đủ điều kiện.

**Kỳ vọng:** khoản vẫn `UNPAID`, lý do `WAITING_SCHEDULE`; không mất nợ, không trả ngoài giờ.

### P8 — Sàn xác nhận chắc chắn chưa chuyển
**Actor:** Worker · **Req:** 22.7, 22.31 · **Mô phỏng:** C8
1. Sàn từ chối giao dịch (chứng minh chưa gửi).
2. Execution `FAILED_NOT_SENT`, phân bổ giải phóng, ví: `available` hoàn lại, `reserved 0`.
3. Đợt hôm sau tạo execution mới liên kết `previousExecutionId` và trả.

**Kỳ vọng:** không thử lại trong cùng đợt; khoản vẫn còn nợ trong lúc chờ; không có nợ mới.

### P9 — Timeout: chưa rõ đã chuyển hay chưa
**Actor:** Worker + Admin · **Req:** 22.8, 22.9 · **Mô phỏng:** C9, C10
1. Gọi chuyển bị timeout → `UNKNOWN`, giữ nguyên tiền đã giữ chỗ.
2. Đợt sau **không** gửi lại; Cancel bị từ chối; `/admin/payables` báo `Result unknown: reconcile before anything else` và banner đỏ.
3. Job đối soát tra sàn: có bằng chứng đã chuyển → `CONFIRMED` và settle đúng một lần; chứng minh chưa chuyển → `FAILED_NOT_SENT` rồi xử lý như P8; không có bằng chứng → vẫn `UNKNOWN`.
4. Cashback mới trong lúc `UNKNOWN` không gộp vào execution đang bay, được trả thành lệnh riêng sau khi lệnh cũ xong.

**Kỳ vọng:** biên nhận thiếu tiền hoặc sai UID → `UNKNOWN` + `RECEIPT_MISMATCH`, không đánh `PAID`.

### P10 — Thiếu tiền ở tài khoản chi trả: ưu tiên release cũ nhất
**Actor:** Worker + Admin · **Req:** 22.37, 22.38, 22.33 · **Mô phỏng:** C11
1. Nguồn còn 10 USDT, phí 0.5. Nhóm cũ nhất cần 15 không đủ; nhóm mới hơn cần 8 đủ.
2. Nhóm 15 được giữ `Not enough funds in the payout account`, hẹn đợt hôm sau; nhóm 8 vẫn được trả.
3. Nạp thêm tiền rồi đợt hôm sau trả nhóm 15.

**Kỳ vọng:** không gửi một phần; thiếu vì phí (principal đủ nhưng principal + phí không đủ) cũng bị giữ; không gửi bù ngay khi vừa nạp; khách luôn nhận đủ principal.

### P11 — Người nhận hoặc phí chưa sẵn sàng
**Actor:** Worker + Admin · **Req:** 22.25, 22.33 · **Mô phỏng:** C12
- UID Bybit chưa thêm vào address book → không tạo lệnh, không giữ chỗ; lý do `Recipient not set up at the exchange`. Sau khi admin thiết lập xong, đợt kế tiếp trả.
- Phí chưa xác định → lệnh giữ `READY`, không gửi.
- Binance chưa có kênh Payout đã xác minh → `Payout channel not configured`.

### P12 — Correction (điều chỉnh giảm cashback)
**Actor:** Worker · **Req:** 22.20, 22.22, Req 8.7 · **Mô phỏng:** C13
- **Trước khi gửi:** execution đang chờ duyệt bị `INVALIDATED`, tiền trả về `available`, entitlement giảm, đợt sau lập lệnh mới theo số đã chỉnh.
- **Sau khi đã gửi/UNKNOWN:** scope `pendingCorrection` chặn gửi mới; lệnh đã thực sự chuyển vẫn được ghi nhận; phần chi thừa thành `receivable` và chặn trả tiếp cho UID tới khi được cấn trừ bởi cashback sau.
- Hủy một lệnh chưa gửi không xóa nợ: khoản vẫn `UNPAID` và quay lại hàng đợi.

### P13 — Trả thủ công có bằng chứng khớp
**Actor:** Admin · **Req:** 22.9, 22.14 · **Mô phỏng:** C15
1. Khoản > 20 đã được duyệt (execution `READY`), admin tự chuyển ngoài hệ thống.
2. Gửi lệnh `MARK_PAID` với `reference`, `amount`, `toUid` khớp execution → `CONFIRMED`.
3. Sai số tiền/UID → lệnh `REJECTED`, execution `UNKNOWN`; trùng `reference` → `REFERENCE_REUSED`; xác nhận lần hai không settle thêm.

### P14 — Khách chỉ tra cứu, không truy cập riêng tư hoặc tự rút
**Actor:** Khách · **Req:** 14, 20.4, 22.35 · **Trạng thái:** cần kiểm lại tại Task 44.4; mô phỏng C1 trước đây không chứng minh gỡ xác thực khách.
- Lookup công khai trả số theo S7; không Wallet/email binding/phiên UID hoặc API ví/lịch sử riêng tư.
- `/withdraw` redirect `/#lookup`; POST tạo/hủy cũ trả 410 CUSTOMER_WITHDRAWALS_RETIRED, không reserve/job, kể cả request cũ có cookie và DB gate LEGACY.
- Admin queue legacy và payables vẫn được xác thực admin; lịch sử và email lịch sử không bị xóa.

### Tính nhất quán số dư (mọi kịch bản)
Với mỗi UID và tài sản: `Σ(T−S−R) = available`, `ΣR = reserved`, `ΣS = withdrawn`. Mô phỏng C2, C3, C8, C9, C13 và C19 kiểm tra các đẳng thức này; vi phạm khiến scope `FAILED` và chặn trả (C16).

---

## Dữ liệu kiểm chứng target Task 44 (chưa chạy)

- Offer hệ số null/0/1/10 chữ số thập phân: null không hiện calculator, 0 hiện hợp lệ; volume mặc định 1,000,000 USDT, kiểm tra nhóm nghìn và chỉnh sửa được.
- Batch COMMISSION/PUBLISHED đủ ngày UTC cũ hơn hôm qua để xác nhận D không cố định hôm qua; batch partial/activity/future không làm D mới hơn.
- UID không tồn tại/UID đã biết chưa có cashback đều hasData=false cùng shape/message; UID đã attribution nhưng không dòng trong kỳ vẫn hasData=true (có D → REPORTED 0, chưa D → NO_DATA); kỳ 30 ngày, kỳ nhiều ngày cắt biên, sourceTz khác UTC; totalPaid trước/sau settle payables không đếm đôi.
- Nhập volume có nhóm nghìn, tháng/năm round riêng; không ô phí/affiliate hoặc cơ cấu hoa hồng nền tảng.
- Giữ các fixture và invariant P1–P14 cho chi tự động; không tạo fixture khách tự rút.

## Explicitly not covered (do not treat as happy path)

- Lookup thiếu sàn hoặc UID.
- Downward CSV correction, clawback, `receivable > 0` blocking withdrawals.
- Native Bybit export (still pending a real commission sample). MEXC Referral Data XLSX is an admin-only activity snapshot: it must not be checked as cashback credit.
- Scheduled exchange API sync and SSE (Phase 4).
- Automated on-chain payout (manual mark-paid in MVP).

---

## Changelog

| Ngày | File | Thay đổi | Lý do | Loại |
|------|------|----------|-------|------|
| 2026-10-30 | happy-path-scenarios.md | Sửa S7/lookup và fixture chống dò UID: cùng hasData=false cho UID không tồn tại/chưa có cashback; chỉ hasData=true mới REPORTED zero hoặc NO_DATA | Review Claude Bước 1 và quyết định người dùng 30/10/2026 | updated |
| 2026-10-30 | happy-path-scenarios.md | Chốt fixture calculator mặc định 1,000,000 USDT, nhóm nghìn và chỉnh sửa | Review Claude Bước 1 và quyết định người dùng 30/10/2026 | updated |
| 2026-10-30 | happy-path-scenarios.md | Gỡ kịch bản xác thực khách/tự rút S8–S12/S14–S15 và prerequisites email; giữ admin legacy/payables | Quyết định người dùng 30/10/2026 | removed |
| 2026-10-30 | happy-path-scenarios.md | S7/P14 và fixture calculator/coverage D/zero/no-data theo Task 44, ghi rõ chưa chạy target mới | Spec trước code | updated |
| 2026-10-17 | happy-path-scenarios.md | Thêm P1–P14 (luồng tự trả Req 22: cutover gate, release → payable, gộp 15 USDT, ngưỡng 0.5/20/20.01, duyệt chờ đợt, merge + duyệt lại, bỏ lỡ đợt, lỗi chưa gửi, UNKNOWN/đối soát, thiếu nguồn, recipient/phí, correction, mark-paid, khách không còn rút); đánh dấu S9–S15 là LEGACY; ghi rõ mới mô phỏng | Người dùng yêu cầu viết lại happy-case và giả lập test | updated |
| 2026-09-17 | happy-path-scenarios.md | Thêm kịch bản happy path S0–S16 (public browse, import Bybit, lookup, OTP, rút lần đầu/admin duyệt/mark-paid, lần hai auto-approve, cancel, dashboard) | Testers và admin cần runbook nghiệp vụ chính, không lẫn error path | added |
| 2026-09-17 | happy-path-scenarios.md | Gắn snapshot dump Railway: 3 exchange seed, 0 UidAccount/wallet/import; lookup Bybit `001234567` là no-data cho đến S4–S5; rate Bybit 0.3 → cashback 30 USDT | Kịch bản trước đó bịa số dư không có trong DB | updated |
| 2026-09-17 | happy-path-scenarios.md | Publish CSV test Bybit UID `001234567` (commission 100 → cashback 30 pending). Lookup live `hasData=true`. `available` vẫn 0 vì chưa set HOLDING_PERIOD_HOURS | Tester thấy no-data vì dump trống; import qua pipeline thật | updated |
| 2026-09-19 | happy-path-scenarios.md | S1/S4/S10/S13/S16 dùng left-nav routes (`/admin/imports`, `/withdrawals`, `/exchanges`, …) | Req 18 — chờ duyệt rồi code | updated |
| 2026-09-22 | happy-path-scenarios.md | S5: giữa PUBLISHED và ATTRIBUTE, lookup vẫn hiện commission đã cộng, chưa hiện số mới | Req 14.7 — tránh tester tưởng lệch số là lỗi sổ | updated |
| 2026-09-25 | happy-path-scenarios.md | Ghi rõ XLSX Referral Data của MEXC là snapshot admin, không phải đường cashback | Tránh tester cộng Your Earnings vào ví | updated |
| 2026-09-25 | happy-path-scenarios.md | S4 hướng dẫn tạo file CSV UTF-8, chọn file trong form và điền metadata cụ thể; sửa mô tả UID đã có trong dump | Tester có thể thực hiện upload và không kỳ vọng cộng tiền lần hai | updated |
| 2026-09-26 | happy-path-scenarios.md | Thêm S17–S19: admin upload XLSX Referral Data MEXC (fixture synthetic), preview partial/cảnh báo cột thừa, publish snapshot, xem bảng current, re-import as-of mới thay thế không cộng dồn; thêm route `/admin/referrals` | Có runbook test tay cho chức năng MEXC referral activity trước khi deploy | added |
| 2026-09-26 | happy-path-scenarios.md | Cập nhật đường dẫn S17–S19 thành `/admin/crawl-data` và nhãn menu Crawl data | Runbook dùng đúng URL hiện tại | updated |
| 2026-09-26 | happy-path-scenarios.md | S4–S5, S17–S19 dùng trang Uploads/Reports hiện tại và trạng thái LOAD → TRANSFORM → PREVIEW; bỏ cảnh báo cột cá nhân khỏi raw/preview | Đồng bộ Task 32–33 và luồng kiểm chứng mới | updated |
| 2026-09-26 | happy-path-scenarios.md | S1/S4/S16–S19 dùng Uploads, API connectors và Referral activity; route cũ redirect | Req 18.2, 18.7, 18.8 | updated |
