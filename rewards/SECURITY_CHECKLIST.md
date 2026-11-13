# 🛡️ Rewards Platform — Comprehensive Production Security Checklist

This document details every security defense implemented directly in code, followed by the mandatory production configurations required before going public.

---

## ✅ 1. Implemented in Code (Zero Mocks, 100% Active)

### 🔐 Authentication & Session Hardening
- [x] **Server-Side Google ID Token Verification**: Uses official `google-auth-library` (`OAuth2Client.verifyIdToken`). Never trusts client-sent emails or identifiers.
- [x] **Email Normalization & Deduplication**: Normalizes Gmail addresses (`john.doe+promo@gmail.com` ➔ `johndoe@gmail.com`) to prevent duplicate accounts via Gmail aliases.
- [x] **Disposable Email Blacklist**: Rejects 30+ known temporary email services (`mailinator`, `tempmail`, `guerrillamail`, etc.) during registration.
- [x] **Hardened Cookie Policy**: `httpOnly: true`, `secure: true` (in production), and `sameSite: 'strict'` to prevent XSS session theft and CSRF.
- [x] **Rotating Refresh Tokens with Server Revocation**: Cryptographically random refresh tokens stored as bcrypt hashes in PostgreSQL; rotation revokes previous tokens and detects reuse.
- [x] **Logout Invalidation**: Complete revocation of user sessions in PostgreSQL and immediate cookie clearing.

### 💰 Coin Economy & Concurrency (Anti Double-Spend)
- [x] **Strict Append-Only Ledger**: No mutable balance column on `users`. Balance is mathematically computed as `SELECT SUM(amount) FROM coin_ledger WHERE user_id = $1`.
- [x] **Row-Level Locking (`SELECT FOR UPDATE`)**: All coin transactions run inside isolated PostgreSQL transactions with row-level locks, eliminating race conditions.
- [x] **Idempotency Keys**: Unique database constraint on `ref_id` prevents duplicate credits/debits from rapid retries or network replays.
- [x] **Server-Enforced Calculations**: Client never sends coin amounts. All coin rewards (signup bonus, referral bonus, ad watch rewards) are calculated strictly on the server from config.

### 👥 Referral Fraud & Anti-Cheat
- [x] **Self-Referral Prevention**: Blocked at service and database levels.
- [x] **Hardware Device Fingerprinting**: Stores and correlates device fingerprints across accounts to detect Sybil attacks and multi-accounting.
- [x] **IP Address Correlation**: Flags accounts originating from identical IP addresses for manual admin review.
- [x] **Delayed Bonus Crediting**: Referrer bonus is held in `pending` status until the referred user completes an authenticated qualifying action (e.g. ad watch / video stream).
- [x] **Daily Referral Velocity Cap**: Hard cap of 10 successful referrals per calendar day to stop automated farming scripts.
- [x] **Admin Review Queue**: Suspected multi-account referrals are routed to an admin moderation queue before coins are unlocked.

### 💸 Withdrawal Protections
- [x] **Country-Specific Withdrawal Minimums**: Enforces ₹500 (50,000 coins) for India, PKR 500 (50,000 coins) for Pakistan, and $5 equivalent for international users.
- [x] **Coin Pre-Locking**: Coins are debited (`withdrawal_lock`) immediately upon request creation, preventing double withdrawals.
- [x] **Single Pending Request Policy**: Only one active withdrawal permitted per user at any time.
- [x] **Withdrawal Cooldown**: Mandatory 24-hour waiting period between consecutive withdrawal requests.
- [x] **At-Rest Payment Detail Encryption**: User bank accounts, UPI IDs, JazzCash numbers, and PayPal emails are encrypted using AES-256-CBC with randomized IVs before writing to the database.

### 🛡️ API & Transport Security
- [x] **Helmet & Strict Content Security Policy (CSP)**: Hardened headers blocking clickjacking (`X-Frame-Options`), MIME sniffing, and restricting script execution to approved hosts.
- [x] **CSRF Defense (Double-Submit Cookie Pattern)**: All mutating requests (`POST`, `PUT`, `DELETE`) require a cryptographically verified `X-CSRF-Token` header matching the `_csrf` cookie.
- [x] **Tiered Redis Rate Limiting**:
  - Global: 100 requests / 15 minutes per IP
  - Auth: 10 login attempts / 15 minutes per IP
  - Referrals: 5 actions / hour per IP
  - Withdrawals: 3 requests / hour per IP
- [x] **Cloudflare Turnstile Bot Defense**: Mandatory token verification on login and withdrawal creation endpoints.
- [x] **Zod Schema Validation**: Every API payload is validated and sanitized against strict schemas before processing.
- [x] **100% Parameterized SQL Queries**: All PostgreSQL interactions use `$1, $2` parameters via `pg.pool.query`. Zero string concatenation.
- [x] **Object-Level Ownership (Anti-IDOR)**: User identifiers are extracted strictly from verified JWT tokens on `req.user`. Client cannot access or mutate other users' resources.
- [x] **Role-Based Access Control (RBAC)**: Dedicated `requireAdmin` middleware protects all `/api/admin/*` routes.
- [x] **Generic Error Handling**: Database errors, stack traces, and system internals are logged privately on the server and replaced with safe generic messages to the client.
- [x] **Immutable Audit Trail**: Key events (logins, bans, withdrawals, reviews, manual coin adjustments) are written to an append-only `audit_log` table with client IP and timestamps.

---

## 🔧 2. Manual Production Configuration Checklist

Complete these tasks prior to launching in a live production environment:

### 1. Google Cloud Console (OAuth 2.0)
- [ ] Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
- [ ] Create an OAuth 2.0 Client ID for a **Web application**.
- [ ] Add your production domain to **Authorized JavaScript origins**: `https://yourdomain.com`.
- [ ] Add authorized redirect URIs if utilizing popup/redirect: `https://yourdomain.com`.
- [ ] Copy the Client ID into `GOOGLE_CLIENT_ID` in `.env` (and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in the frontend `.env`).

### 2. Cloudflare Turnstile
- [ ] Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) ➔ **Turnstile**.
- [ ] Add a new site with your production domain `yourdomain.com`.
- [ ] Copy the **Site Key** into `TURNSTILE_SITE_KEY` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
- [ ] Copy the **Secret Key** into `TURNSTILE_SECRET_KEY`.

### 3. Cryptographic Secrets Generation
Generate high-entropy random keys on your server:
```bash
# Generate JWT_ACCESS_SECRET (64 hex characters)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate JWT_REFRESH_SECRET (64 hex characters)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate CSRF_SECRET (32 hex characters)
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"

# Generate ENCRYPTION_KEY (64 hex characters / 32 bytes for AES-256)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
- [ ] Update these values in production `.env`. Never commit `.env` to Git.

### 4. Database & Backups
- [ ] Set `DATABASE_URL` with SSL mode enabled: `postgresql://user:pass@host:5432/rewards_db?sslmode=require`.
- [ ] Configure automated daily backups using `pg_dump` or managed DB snapshots (AWS RDS / Supabase / Neon).
- [ ] Test a backup restoration procedure to ensure data integrity.

### 5. HTTPS & Reverse Proxy
- [ ] Configure TLS termination via Nginx, Caddy, or Cloudflare SSL.
- [ ] Ensure `NODE_ENV=production` is set so cookies are issued with the `Secure` attribute.
- [ ] Set `trust proxy` in Express to match your proxy hop depth.

### 6. Admin User Bootstrap
- [ ] Identify the Google account ID of the primary administrator.
- [ ] Set `INITIAL_ADMIN_GOOGLE_ID` in `.env` or run:
```sql
UPDATE users SET role = 'admin' WHERE email = 'your-admin@gmail.com';
```
