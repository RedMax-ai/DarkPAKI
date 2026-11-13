# CreatorLoop (DarkPAKI VIP) — Security Checklist & Audit Controls

## 1. Authentication & Session Security
- [x] **Google Sign-In Server Verification:** Google ID token is verified server-side using Google tokeninfo/decoder API. Never trusts client-sent email.
- [x] **Password Protection:** Passwords hashed with `bcryptjs` (salt cost 10).
- [x] **Multi-Factor OTP:** 6-digit cryptographic OTP required on email login, with 10-minute expiry and single-use invalidation.
- [x] **1-Device Anti-Cheat Guard:** Hardware device fingerprint permanently mapped to 1 verified account. Blocks multi-accounting and farm bots with `403 Forbidden`.
- [x] **Cloudflare Turnstile:** Verified server-side against Cloudflare siteverify endpoint.
- [x] **Session Tokens:** Signed JWT with expiration (`30d` for user sessions, `72h` for admin tokens).

## 2. Authorization & Role-Based Access Control (RBAC)
- [x] **Role Separation:** Roles include `visitor`, `user`, `creator`, `monetized_creator`, `moderator`, `finance`, `admin`.
- [x] **Protected Admin Routes:** Enforced via `requireAdmin` middleware. Client cannot forge role headers.
- [x] **Anti-IDOR:** Operations on user profiles, comments, and withdrawals enforce ownership (`WHERE user_id = req.user.id`).
- [x] **Audit Trail:** Privileged administrative actions, approvals, and security events recorded in append-only `security_logs`.

## 3. Media & Content Moderation Security
- [x] **Quarantine by Default:** New video submissions start as `pending_review` (or `uploading`/`processing`).
- [x] **Public Feed Filter:** Only `approved` / `published` videos queryable by unprivileged endpoints.
- [x] **Validation:** Server verifies file size, mime type, duration, and title sanitization.
- [x] **AI Moderation Signals:** Automated safety scoring runs before human review; flagged content escalated with reason codes.

## 4. Financial & Wallet Integrity
- [x] **Server-Only Ledger:** Balance is computed or maintained by server transactions; client cannot send balance numbers.
- [x] **Integer Minor Units:** All coin calculations use strict integers (no floating-point rounding errors).
- [x] **Reversals:** Fraudulent or disputed earnings corrected via append-only reversal records.
- [x] **Withdrawals Disabled:** Real-money cashouts disabled by policy until banking rails and compliance checks are certified.
