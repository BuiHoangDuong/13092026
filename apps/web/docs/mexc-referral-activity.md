# MEXC referral activity

The native Referral Data `.xlsx` is a period snapshot. It is not payable commission.

- Upload it from Admin → Crawl data (`/admin/crawl-data`) with the source timezone and the export's as-of time. The sheet name (`_2026-09-18~2026-09-25`) is an inclusive calendar period in that timezone.
- An export taken before the period ends is marked partial. Re-importing the same period replaces the current snapshot; it does not add the numbers together. An older export is rejected.
- A UID missing from the latest export has no row for that period. A row of zeroes was reported as zero.
- `Your Earnings` does not credit a wallet, create a commission record, or change withdrawal eligibility. Commission import stays blocked until a nonzero UID-level commission export is mapped (task 11.1).
- Nickname, user tag, identification and asset band stay in the private original file only.

The committed fixture `packages/core/test/fixtures/mexc-referral-activity.xlsx` uses fake UIDs. Do not commit files from `data/mexc/`.

## Affiliate API connector

The worker also supports MEXC's official [affiliate referral endpoint](https://www.mexc.com/api-docs/spot-v3/rebate-endpoints/get-affiliate-referral-dataaffiliate-only). In the root `.env` for local development, or in the worker service's private environment, set `MEXC_AFFILIATE_API_KEY`, `MEXC_AFFILIATE_API_SECRET`, and `MEXC_AFFILIATE_MASTER_UID`. Create the key on the affiliate root account with **Spot Account Read** permission. The older `MEXC_API_KEY` and `MEXC_API_SECRET` values are not used by this connector. Never put these credentials on the web service.

The worker checks access with a signed read-only request. Once readiness is green, Admin → Data ingest → API connectors can enable MEXC, choose an interval, or run a sync immediately. Its default initial backfill is 30 completed UTC days. The connector requests each UTC day explicitly, pages through the result, and stores only UID, referral code, USDT trading amount, and USDT reported commission in the raw activity path. Personal fields are dropped before storage. The schedule starts disabled.

The MEXC documentation names the date filters but does not specify whether the returned amounts are strictly activity within that day. Reconcile a nonzero day with the portal or XLSX export before relying on day totals. API activity never creates a payable commission record or credits a wallet; the separate commission evidence gate remains in Task 11.1.
