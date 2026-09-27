# MEXC referral activity

The native Referral Data `.xlsx` is a period snapshot. It is not payable commission.

- Upload it from Admin → Crawl data (`/admin/crawl-data`) with the source timezone and the export's as-of time. The sheet name (`_2026-09-18~2026-09-25`) is an inclusive calendar period in that timezone.
- An export taken before the period ends is marked partial. Re-importing the same period replaces the current snapshot; it does not add the numbers together. An older export is rejected.
- A UID missing from the latest export has no row for that period. A row of zeroes was reported as zero.
- `Your Earnings` does not credit a wallet, create a commission record, or change withdrawal eligibility. Commission import stays blocked until a nonzero UID-level commission export is mapped (task 11.1).
- Nickname, user tag, identification and asset band stay in the private original file only.

The committed fixture `packages/core/test/fixtures/mexc-referral-activity.xlsx` uses fake UIDs. Do not commit files from `data/mexc/`.
