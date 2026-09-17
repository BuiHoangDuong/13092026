# Security audit — 2026-09-17

## Server authorization

- Every `/api/admin/*` data route uses `withAdmin`; admin mutations use
  `withAdminMutation`, which requires an admin session and validates the request origin.
- Every `/api/uid/*` route calls `uidPrincipal(request)`. The principal comes only from
  the hashed `cashback_uid_session` cookie; caller-selected `uidAccountId`, `exchangeId`,
  and `uid` query parameters are rejected.
- Public routes are limited to published exchange reads, redirects/click recording,
  rate-limited lookup, OTP request/verify, admin login, and operational health.

## Secret and network boundaries

- Client modules are lint-blocked from importing `@cashback/core` or `@cashback/db`.
- No secret uses a `NEXT_PUBLIC_` prefix. `RESEND_API_KEY` is read server-side only.
- Import originals live in private PostgreSQL storage. No bucket credential is currently
  deployed. If object storage replaces it, web gets write access and worker gets read
  access through separate credentials.
- Railway IaC injects the private Postgres `DATABASE_URL` only into web and worker and
  declares a private database endpoint. Browsers never receive database credentials.

## Verification

- `scripts/test-uid-access.mjs` covers UID-session isolation and rejects cross-UID access.
- `scripts/test-bybit-integration.mjs` covers atomic publish rollback, lease fencing,
  attribution races, and withdrawal races.
- Workspace lint enforces browser/server package boundaries.
