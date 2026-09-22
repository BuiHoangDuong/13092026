# Happy-path scenarios — Cashback Affiliate Platform

- **Status:** Draft v1.1 (main success paths; numbers from the live Railway dump)
- **Last updated:** 2026-09-17
- **Based on:** `requirements.md` (Draft v0.6), `design.md` (Draft v0.7), and
  Railway Postgres (`public`) as of 2026-09-17. A Bybit test report for UID
  `001234567` was published the same day so lookup has a real balance.
- **Audience:** testers and the operator (admin). This is a runbook of **happy
  cases**, not an error catalog.

> Source of truth for behavior remains `requirements.md` / `design.md`. If a step
> here disagrees with those files, those files win — update this document.
>
> **Do not invent balances.** Only UIDs in a published report show money. The
> live dump has one: Bybit `001234567` with 30 USDT pending.
>
> Out of scope here: rate-limit 429s, wrong OTP, mismatched email, clawback /
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

### What lookup does **today**

On `/`, choose **Bybit** (not Binance/MEXC) and UID **`001234567`** (keep the
leading zeros). Live `POST /api/lookup` returns:

```json
{
  "balances": [{ "asset": "USDT", "pending": "30.0000000000", "available": "0.0000000000" }],
  "hasData": true,
  "lastImportAt": "2026-09-17T11:02:41.188Z",
  "sourceAsOf": null
}
```

`available` stays `0` until `HOLDING_PERIOD_HOURS` is set (empty = never
release). Pending **30 USDT** is the cashback to look for. Any other UID, or
the same UID on Binance/MEXC, still shows no-data.

---

## How to use this document

1. **S7 works now** for Bybit + `001234567` (pending 30 USDT). Do not expect
   the same UID on Binance/MEXC.
2. **S4–S5 already ran once** (batch `bd2672df-c716-43ad-8a87-d9e22b92b4a1`).
   Re-running S4 with the same aggregate period will be a correction, not a
   second 30 USDT credit.
3. **S6 will not move 30 → available** until `HOLDING_PERIOD_HOURS` is set on
   the worker (currently unset).
4. **S0–S3, S13, S16** still run on seed content. Product UI is English only;
   there is no customer registration.

| Surface | Path |
|---------|------|
| Public home + cashback lookup | `/` |
| Exchanges catalog / detail | `/exchanges`, `/exchanges/[slug]` |
| Guides | `/guides`, `/guides/[slug]` |
| Referral redirect | `/go/[linkId]` |
| Claimant withdraw (OTP → wallet) | `/withdraw` |
| Admin login | `/admin/login` (no sidebar) |
| Admin operations | Left nav shell: `/admin` overview, `/admin/imports`, `/admin/withdrawals`, `/admin/exchanges`, `/admin/offers`, `/admin/links`, `/admin/guides` |

---

## Actors

| Actor | Who | How they authenticate |
|-------|-----|------------------------|
| Visitor | Anyone on the public site | None |
| UID claimant | Person withdrawing one (exchange, UID) | 6-digit email OTP → 30-minute UID session |
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
| `WITHDRAWAL_ROUTES` | e.g. `{"USDT":["TRON","ETHEREUM"]}` | Empty disables withdrawal requests |
| `WITHDRAWAL_AUTO_APPROVE_THRESHOLDS` | e.g. `{"USDT":"100"}` | Needed for S14 (second withdrawal auto-approve). Missing asset → always review |
| Resend | `RESEND_API_KEY` + `EMAIL_FROM` on a **verified** operator domain | OTP email in S8. Shared `resend.dev` only delivers to the Resend account owner |
| `CLIENT_IP_HEADER` | `x-forwarded-for` on Railway | Lookup/OTP fail closed in production without a trusted IP header |
| Test UID | Bybit `001234567` — already attributed (pending 30 USDT). Keep leading zeros. | S7–S12 |
| Test payout address | Valid checksum address for the chosen network (EVM or TRON) | S9 |
| Normalized Bybit CSV v1 | See S4. Native Bybit export / XLSX is not a happy path yet | S4 |

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
Visitor looks up exchange + UID (sees pending / available only)
        ↓
Claimant requests OTP, verifies, withdraws available
        ↓
First withdrawal: admin reviews → approves → sends USDT off-platform → marks paid
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
| S8 | Claimant binds email via OTP | Claimant | 15, 16 |
| S9 | First withdrawal (always review) | Claimant | 9.1–9.5, 15.9 |
| S10 | Admin approves the first withdrawal | Admin | 9.5, 9.9 |
| S11 | Admin pays out and marks paid | Admin | 9.6, 9.9 |
| S12 | Later OTP uses the bound email | Claimant | 15.2, 15.3 |
| S13 | Admin creates and publishes content | Admin | 10 |
| S14 | Second withdrawal auto-approves | Claimant + Admin | 9.5, 9.6 |
| S15 | Claimant cancels before paid | Claimant | 9.7, 9.10 |
| S16 | Admin reads the operations dashboard | Admin | 11 |

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
  Nav links: Overview, Bybit imports, Withdrawals, Exchanges, Offers, Referral
  links, Guides. Login has no sidebar.
- Admin session cannot be used on `/api/uid/*`. A UID session cannot be used on
  `/api/admin/*`.

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
(`cmu3lhxdu000enb5cb3zd72lp`). Worker is healthy. **Dump has no import
batches yet** — this scenario creates the first one.

### CSV to upload (normalized v1, UTF-8)

The UID is **created by this file**. It is not in the dump. After S5, lookup
**this same UID on Bybit** — not a UID you have not published.

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
1. Open `/admin/imports` (left nav **Bybit imports**).
2. Fill: root affiliate account, period start/end (UTC dates), optional source
   as-of, report type (`AGGREGATE` or `TRANSACTION`), and the CSV.
3. Submit **Upload for preview**.
4. Wait while the UI polls (~5s while the batch is `UPLOADED` / `PARSING`).
5. Open the new row under **Recent reports**.

### Expected
- API returns `202` with a `batchId`. The HTTP request does **not** parse the
  whole file.
- Worker writes staging rows and the batch becomes `PREVIEW`.
- Preview shows totals, flagged-row count `0`, and no blocking errors.
- Staging data is **not** visible on public lookup yet.
- Original file is stored privately (not a public URL).

---

## S5 — Admin publishes the report

**Actor:** Admin + Worker  
**Preconditions:** S4 batch is `PREVIEW` with zero flagged rows.

### Steps
1. On the same preview panel, click **Publish verified report**.
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
- Until this step, `/` lookup of Bybit + `001234567` is no-data — that is the
  dump, not a product bug.
- After status is `PUBLISHED` but before the ATTRIBUTE job finishes, lookup
  still shows the previous credited commission, not the new `reconciledAmount`.
  The row matches `creditedCashback`. After ATTRIBUTE, lookup shows the new
  commission.

---

## S6 — Cashback becomes available

**Actor:** Worker  
**Preconditions:** S5 credited `pending`. `HOLDING_PERIOD_HOURS` is `0` (release
on the next scheduler tick, about once a minute) **or** the configured hours
have elapsed.

### Steps
1. Wait for one worker `RELEASE_HOLDS` tick (about 1 minute when the period is
   `0`).
2. Do not request a withdrawal yet.

### Expected
- The credited amount moves `pending → available`.
- `pending` / `available` never go negative.
- Lookup (S7) now shows a non-zero `available` if the hold has cleared.
- `reserved` / `withdrawn` / `receivable` stay `0` on this path.

---

## S7 — Visitor looks up exchange + UID

**Actor:** Visitor (anonymous)  
**Preconditions:** S5 has been published for the UID you will type. Both
**exchange and UID** are required.

### Steps
1. On `/`, choose **Bybit** (id `cmu3lhxdu000enb5cb3zd72lp`).
2. Enter UID **`001234567`** exactly (leading zeros). Submit.

### Expected after S5
- Totals: USDT `pending=30.0000000000`, `available=0.0000000000`.
- Transaction table: period 2026-09-01–2026-09-16, exchange paid `100` USDT,
  rate 30%, your share `30` USDT.
- **Not** in the response: bound email, payout address, withdrawal records,
  `reserved` / `withdrawn` / `receivable`.
- Lookup does not create or mutate `UidAccount`, wallet, OTP, or session.
- Same UID on **Binance** is a different subject and stays no-data unless a
  Binance report was published.
- **Withdraw** goes to
  `/withdraw?exchangeId=cmu3lhxdu000enb5cb3zd72lp&uid=001234567`.

---

## S8 — Claimant binds email via OTP

**Actor:** Claimant  
**Preconditions:** S7. Resend is configured. Inbox is one the operator can read.
UID has **no** bound email yet.

### Steps
1. Open `/withdraw` (from the lookup CTA or directly).
2. Confirm exchange + UID. Enter the email. Send code.
3. Read the 6-digit OTP from the mailbox (it is **not** in the API response or
   server logs).
4. Enter the code and verify.

### Expected
- OTP is hashed, single-use, short TTL (default 5 minutes).
- Correct code binds that email to the UID account and sets a **30-minute
  session cookie scoped to that one UID**.
- Screen shows wallet buckets including `pending` / `available` / `reserved` /
  `withdrawn` / `receivable`, plus movement history (session-only).
- Binding an email does **not** pay anything by itself.

---

## S9 — First withdrawal (always review)

**Actor:** Claimant  
**Preconditions:** S6 + S8. `available` ≥ the amount to withdraw. `receivable`
is `0`. `WITHDRAWAL_ROUTES` includes the asset/network.

### Steps
1. On `/withdraw`, enter amount (≤ available), network, and a valid address.
2. Submit **Request**.

### Expected
- Amount moves `available → reserved` (cannot be requested twice).
- Because this is the **first** withdrawal for this UID, status is
  `UNDER_REVIEW` **regardless of amount** (auto-approve threshold does not
  apply yet).
- Two `WithdrawalEvent` rows exist for the request/reserve path (audit).
- `pending` is untouched and cannot be withdrawn.
- Claimant sees the row in withdrawal history with a **Cancel** button (used
  in S15, not required here).

---

## S10 — Admin approves the first withdrawal

**Actor:** Admin  
**Preconditions:** S1 + S9. Row is `UNDER_REVIEW` in the withdrawal queue.

### Steps
1. Open `/admin/withdrawals`. Find the UID’s request (`first` marker).
2. Optionally fill a note.
3. Click **Approve** and confirm the dialog.

### Expected
- Status becomes `APPROVED`.
- Funds stay in `reserved` (not yet `withdrawn`).
- A `WithdrawalEvent` records admin as actor, with the note if provided.
- Confirm dialog is required (hard-to-reverse action).

---

## S11 — Admin pays out and marks paid

**Actor:** Admin  
**Preconditions:** S10. Admin has sent the crypto **outside the app** (MVP
payout is manual).

### Steps
1. Send USDT (or the asset) on the stated network to the stated address.
2. In the queue, paste the blockchain / transfer reference into **Payout ref**.
3. Click **Mark paid** and confirm the dialog.

### Expected
- Status becomes `PAID`.
- Wallet: `reserved` decreases, `withdrawn` increases by the same amount.
- Claimant can no longer cancel this row.
- Audit event includes the payout reference.

This closes the **first-time full loop** (S0–S11).

---

## S12 — Later OTP uses the bound email

**Actor:** Claimant  
**Preconditions:** S8 already bound an email. UID session expired or signed out.

### Steps
1. Open `/withdraw` again with the same exchange + UID.
2. Enter the **same** bound email. Send code. Verify.

### Expected
- OTP is sent only to the bound address.
- A new 30-minute UID session is issued.
- Wallet still shows the post-S11 balances (`withdrawn` includes the paid
  amount).

*(Wrong-email rejection is an unhappy path — not run here.)*

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

## S14 — Second withdrawal auto-approves

**Actor:** Claimant + Admin  
**Preconditions:** This UID already has a **PAID** (or otherwise completed first)
withdrawal. `available` is enough. Amount is **≤**
`WITHDRAWAL_AUTO_APPROVE_THRESHOLDS` for that asset (e.g. USDT `100`).

### Steps
1. Claimant (valid UID session) requests a second withdrawal of an amount at or
   below the threshold.
2. Admin still sends crypto off-platform, then **Mark paid** with a payout ref
   (auto-approve does not send on-chain funds).

### Expected
- Status is `AUTO_APPROVED`, not `UNDER_REVIEW`.
- Amount is reserved immediately.
- After mark-paid: `reserved → withdrawn`, audit event recorded.
- If the amount is **above** the threshold, the happy path is the same as S10
  (manual review) — that is still success, just not auto-approve.

---

## S15 — Claimant cancels before paid

**Actor:** Claimant  
**Preconditions:** An open withdrawal in `REQUESTED`, `UNDER_REVIEW`,
`APPROVED`, or `AUTO_APPROVED` (not `PAID`). Valid UID session.

### Steps
1. On `/withdraw` history, click **Cancel** on that row.

### Expected
- Status `CANCELLED`.
- Reserved amount returns to `available`.
- A `WithdrawalEvent` records the claimant as actor.
- A `PAID` row has no working cancel (not exercised on this path).

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
- Visible-tab poll ~30s **on that page only**; `/admin/imports` polls ~5s while
  a batch is processing. Closed sections do not poll.
- Polling pauses when the tab is hidden.
- Responses are `Cache-Control: private, no-store`.
- No secrets, API keys, or full raw report files in the UI.

---

## Suggested full-loop test data

Grounded in the 2026-09-17 dump. The UID is **not** pre-funded; S4 creates it.

| Field | Value in / from dump |
|-------|----------------------|
| Site | `https://cashbackweb-production.up.railway.app` |
| Admin | `admin@example.com` |
| Exchange | Bybit, id `cmu3lhxdu000enb5cb3zd72lp`, default rate **0.3** |
| Referral click | `/go/cmu3lhxec000inb5ci34lc4zv` → `https://www.bybit.com/` |
| UID | `001234567` on **Bybit only** (already in dump after test import) |
| CSV commission | `100` USDT |
| Expected cashback | `100 × 0.3 = 30` USDT (Bybit dump rate; no referral_link_id) |
| Holding period | `0` hours so S6 can move 30 → `available` |
| First withdrawal | e.g. `10` USDT on TRON → `UNDER_REVIEW` |
| Second withdrawal | e.g. `5` USDT (≤ threshold `100`) → `AUTO_APPROVED` |
| Payout ref | Real tx hash after the off-platform transfer |

---

## Explicitly not covered (do not treat as happy path)

- Lookup or OTP without both exchange and UID.
- First-claimant-wins dispute (no recourse by design — see requirements
  “Accepted risk”).
- Downward CSV correction, clawback, `receivable > 0` blocking withdrawals.
- Native Bybit export / XLSX (still pending a real sample).
- Scheduled exchange API sync and SSE (Phase 4).
- Automated on-chain payout (manual mark-paid in MVP).
- Changing a UID’s bound email.

---

## Changelog

| Ngày | File | Thay đổi | Lý do | Loại |
|------|------|----------|-------|------|
| 2026-09-17 | happy-path-scenarios.md | Thêm kịch bản happy path S0–S16 (public browse, import Bybit, lookup, OTP, rút lần đầu/admin duyệt/mark-paid, lần hai auto-approve, cancel, dashboard) | Testers và admin cần runbook nghiệp vụ chính, không lẫn error path | added |
| 2026-09-17 | happy-path-scenarios.md | Gắn snapshot dump Railway: 3 exchange seed, 0 UidAccount/wallet/import; lookup Bybit `001234567` là no-data cho đến S4–S5; rate Bybit 0.3 → cashback 30 USDT | Kịch bản trước đó bịa số dư không có trong DB | updated |
| 2026-09-17 | happy-path-scenarios.md | Publish CSV test Bybit UID `001234567` (commission 100 → cashback 30 pending). Lookup live `hasData=true`. `available` vẫn 0 vì chưa set HOLDING_PERIOD_HOURS | Tester thấy no-data vì dump trống; import qua pipeline thật | updated |
| 2026-09-19 | happy-path-scenarios.md | S1/S4/S10/S13/S16 dùng left-nav routes (`/admin/imports`, `/withdrawals`, `/exchanges`, …) | Req 18 — chờ duyệt rồi code | updated |
| 2026-09-22 | happy-path-scenarios.md | S5: giữa PUBLISHED và ATTRIBUTE, lookup vẫn hiện commission đã cộng, chưa hiện số mới | Req 14.7 — tránh tester tưởng lệch số là lỗi sổ | updated |
