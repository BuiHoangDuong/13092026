/**
 * Marketing-copy numbers for the homepage "why choose us" strip.
 *
 * ⚠️ PLACEHOLDER — these are NOT measured. Replace with real numbers (or remove the
 * corresponding stat) before this site is shown to real users. Do not let this file
 * silently ship to production; grep for "PLACEHOLDER" as part of the launch checklist.
 *
 * `exchangeCount` is intentionally NOT here — it is computed for real from the database
 * in `getPublicStats()` (packages/core/src/services/content.ts) and must stay that way.
 */
export const marketingStatsPlaceholder = {
  userCount: "6,000+", // PLACEHOLDER — replace with a real, measured user count
  countryCount: "5+" // PLACEHOLDER — replace with a real, measured country count
} as const;
