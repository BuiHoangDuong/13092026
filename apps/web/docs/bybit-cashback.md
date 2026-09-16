# Bybit cashback MVP

The first supported exchange is Bybit. Published reports credit one UID account per
exchange + UID without registration or ownership approval. Amounts stay separate
per currency. Home exposes pending/available balances only. Email OTP opens a
30-minute UID session for private wallet/history and withdrawal requests.

## Operator workflow

1. Configure an actual Bybit affiliate destination under Admin content. Seed links
   point at exchange homepages and are examples, not affiliate registrations.
2. Set the Bybit exchange's actual default cashback rate. Seed rates are examples.
   Cashback is **affiliate commission × cashback rate**, not trading volume or the
   customer's trading fees.
3. In `/admin`, upload a **normalized Bybit CSV v1** and its affiliate root account,
   UTC reporting period, and source-as-of time when known.
4. The worker parses it. Review totals and errors, then choose **Publish verified report**.
   Attribution upserts UID accounts and applies each signed commission delta once.
5. There is no ownership-review step. Email binding requires a successful OTP in
   Task 24; legacy customer emails are not automatically treated as verified.
6. Set `HOLDING_PERIOD_HOURS` to the intended policy. Blank leaves credits pending.
   Explicit `0` permits release on the next worker scheduler tick. An existing
   pending credit without a release date uses the configured duration from its
   creation time once a policy is set. The scheduler runs about once per minute.

New reports are stored privately in `ImportBatch.originalFile` (maximum 10 MiB),
in the same transaction as the batch/job. This works across separate web/worker
containers without a shared local disk. No public endpoint returns the original.
Legacy local CSV originals are readable only when the worker can access their
configured storage directory; otherwise re-upload. Object storage remains a
future option when report volume grows.

## CSV v1

This is an explicit normalized adapter, **not a claim that arbitrary Bybit exports
already match these headers**. A real native export sample is still needed before
adding automatic mapping for that format. XLSX and live API synchronization are
not part of this version and XLSX uploads are rejected with a clear error.

Bybit's [affiliate user list API](https://bybit-exchange.github.io/docs/v5/affiliate/affiliate-user-list)
documents `userId` and period-specific `commissionsVol` amounts keyed by currency.
Use these concepts when preparing period totals: preserve the UID as text, emit
one row per UID/currency, and use actual commission in that currency. Do not use
rolling 30/365-day totals as separate daily earnings. Keep the affiliate root
account identifier stable across reimports/corrections.

```csv
uid,asset,commission
001234567,USDT,100.0000000000
001234567,BTC,0.0001000000
```

For identifiable individual commissions, choose TRANSACTION and provide a stable
commission/transaction identifier and UTC timestamp:

```csv
uid,asset,commission,transaction_id,occurred_at
001234567,USDT,10.5000000000,commission-123,2026-09-01T12:34:56Z
```

Only these columns and optional `referral_link_id` are supported. The latter is a
Cashback Hub referral-link ID mapped by the operator from trusted report evidence;
do not populate it from a customer's unverified claim. An offer-specific rate is
used only if the reported link and its offer belong to the commission exchange;
otherwise the exchange default applies. The chosen rate is snapshotted.

- UTF-8 CSV, 1–5000 rows, UTC only. Monetary amounts: nonnegative decimal totals,
  at most 20 integer and 10 fractional digits. Formulas are never evaluated.
- Without `transaction_id`, rows are aggregate totals for the supplied period.
  Do not mix transactions and aggregates for the same UID/currency in a batch.
- Transaction identity: versioned hash of affiliate root + transaction ID + asset.
  Aggregate identity: root + UID + asset + exact UTC period.
- Reimporting the same identity replaces the total; only the cashback difference
  moves the wallet. Partial aggregate overlaps and aggregate/transaction overlaps
  are blocked. Correct using exactly the original period; use explicit zero rows
  to reverse a previous total. Omitted rows are not implicitly deleted.
- Older source-as-of reports cannot supersede newer ones. When source-as-of is
  absent, upload time defines order and the UI labels source-as-of as unknown.
- Corrections consume pending credits, then available funds, then record a
  receivable. Future credits offset receivables first. Released/reversed pending
  credits cannot be released twice. Entries include immutable per-bucket deltas.

## Verification and deployment

```powershell
corepack pnpm --filter @cashback/web... build
corepack pnpm --filter @cashback/worker... build
corepack pnpm --filter @cashback/core test
node scripts/test-bybit-integration.mjs
```

The integration script uses `TEST_DATABASE_URL` (or the configured `DATABASE_URL`)
and creates/migrates a uniquely named `cashback_test_*` schema. It only removes
that schema in cleanup; it does not seed or edit the application's schema.

Before running the new web and worker, apply all migrations through
`202609160003_uid_first`. The migration keeps wallet IDs, entries and amounts.
It stops atomically if an old wallet maps to several UIDs, has no reliable UID,
or would duplicate another wallet. Reconcile these cases explicitly before retrying.
Admin sessions are kept; old customer sessions are revoked. Admin login is now
`/admin/login` with APIs under `/api/admin/auth/*`. Take a database backup and stop
old workers before applying the re-key; deploy web and worker together afterwards.

Native export mapping and real affiliate credentials still require operator setup.
Task 25 implements withdrawal requests with mandatory review of each UID
account’s first request. No live payout integration is included in this re-key.

## UID access setup

Configure `CLIENT_IP_HEADER` to a header overwritten by the trusted ingress;
set `APP_URL` to the site's public origin so write requests are checked against
the public URL rather than Next's internal URL behind a reverse proxy.
production lookup and OTP reject requests without a valid client IP. Restrict direct
access to the origin so visitors cannot supply their own trusted header. Proposed
lookup defaults are 5/minute and 30/hour. Counters persist in Postgres across web instances.

Set private `RESEND_API_KEY` and `EMAIL_FROM` on web only. The sender must use a
[verified Resend domain](https://resend.com/docs/send-with-nodejs); `resend.dev` is rejected.
The provider enforces verification when sending. No real email is sent by the tests:
core receives an in-memory email port while the production routes use only Resend.
OTP defaults: 5-minute TTL, 5 failed guesses, 60-second cooldown, 5 send attempts
per UID/day, independent IP limits. A send failure leaves the challenge unsent and
cannot authenticate a session. Cooldown rejections do not consume the UID daily cap.

`node scripts/test-uid-rekey.mjs` checks populated legacy migration and ambiguous
allocation rollback. `node scripts/test-uid-access.mjs` checks real Next lookup/OTP
verification/session handlers on an isolated schema. OTPs exist only in test memory,
are never printed, and captured stdout is checked for plaintext.

## Withdrawal policy and operations

Set `WITHDRAWAL_ROUTES` explicitly, for example `{"USDT":["TRON","ETHEREUM"]}`.
An empty mapping disables new requests. Supported validators cover TRON Base58Check
and EVM hexadecimal addresses on ETHEREUM/BSC/ARBITRUM/OPTIMISM/BASE. Enable only
the asset/network combinations actually paid by the operator.

`WITHDRAWAL_AUTO_APPROVE_THRESHOLDS` takes decimal strings per currency, for example
`{"USDT":"100"}`. A missing currency always requires review; the previous single
`WITHDRAWAL_AUTO_APPROVE_THRESHOLD` is no longer used across dissimilar currencies.
Every UID’s first request is UNDER_REVIEW regardless of amount. From its second
request, configured thresholds apply. The API reserves available funds atomically
and blocks requests if any wallet for the UID has an outstanding receivable.

The admin queue approves/rejects/marks paid. Pay manually on the selected network
and enter a payout reference before marking paid. Settlement retries with the same
reference and repeated cancels do not create another movement. Paid withdrawals
cannot be cancelled. Every state transition includes a WithdrawalEvent with the
claimant email and actor, and every reserve/release/settle has an immutable ledger delta.

Home’s lookup result links to `/withdraw` with the selected exchange/UID. No
customer registration, password, Clerk, or reference-project verification stub is used.
