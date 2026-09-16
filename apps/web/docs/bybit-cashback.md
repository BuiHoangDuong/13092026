# Bybit cashback MVP

The first supported exchange is Bybit. Home shows a private **Your cashback** panel
above the marketplace hero and exchange grid. Guests sign in; customers link their
Bybit UID and see their own balances, report freshness, and wallet history. Amounts
are kept as decimal strings and never combined across currencies.

## Operator workflow

1. Configure an actual Bybit affiliate destination under Admin content. Seed links
   point at exchange homepages and are examples, not affiliate registrations.
2. Set the Bybit exchange's actual default cashback rate. Seed rates are examples.
   Cashback is **affiliate commission × cashback rate**, not trading volume or the
   customer's trading fees.
3. In `/admin`, upload a **normalized Bybit CSV v1** and its affiliate root account,
   UTC reporting period, and source-as-of time when known.
4. The running worker parses it. Review totals, currencies, unmapped UID count,
   and errors, then choose **Publish verified report**. Unmapped amounts remain
   unattributed until ownership and report membership have been verified.
5. Confirm each UID claimant's ownership using an independent support process;
   record the evidence/ticket reference in **UID ownership review**. An appearance
   in an affiliate report proves membership, not who controls the account.
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
used only if that reported link matches the verified UID link and exchange;
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

Before running the new web and worker in a target environment, apply migration
`202609160002_bybit_cashback`. Deploy both services and verify a small real Bybit
report, ownership review and the customer's home/wallet. Live credentials, actual
affiliate links, native export validation and production deployment remain
operator setup. Withdrawal execution is still Task 15; this change displays
balances/history and does not implement payout requests.
