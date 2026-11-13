# CreatorLoop (DarkPAKI VIP) — Deployment & Release Checklist

This guide outlines staging, production deployment, environment provisioning, and the mandatory pre-launch security gates.

---

## 1. Hosting Architecture & Environments

### Staging Environment
* **Platform:** Node.js 22 LTS on Cloud Container (Render, Railway, or AWS Lightsail)
* **Database:** SQLite with persistent volume mount (`/data/darkpaki.db`)
* **Purpose:** End-to-end integration testing, moderation simulations, bot assault drills.

### Production Environment
* **Domain:** `https://dark.anizon.watch` (or custom brand domain)
* **Reverse Proxy:** NGINX or Cloudflare with SSL/TLS termination, HTTP/2, and strict CSP headers
* **Storage:** Cloudflare R2 bucket with private ACL and pre-signed upload URLs
* **Database Backup:** Automated daily SQLite `.backup` snapshots pushed to private encrypted cold storage

---

## 2. Environment Variables Checklist

Ensure the following variables are set in your production secrets manager:

```ini
PORT=5000
NODE_ENV=production
JWT_SECRET=[cryptographically_generated_64_char_key]
ADMIN_PIN=[secure_owner_pin]
DB_PATH=/data/darkpaki.db
CORS_ORIGIN=https://dark.anizon.watch

# Google Cloud OAuth
GOOGLE_CLIENT_ID=820053333329-6hdq4c0hnr72lbms7mgu7spbd4rd3tc1.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=[production_client_secret]

# Cloudflare Turnstile
TURNSTILE_SITE_KEY=[live_cloudflare_turnstile_site_key]
TURNSTILE_SECRET_KEY=[live_cloudflare_turnstile_secret_key]

# Compliance Gates
ENABLE_CASH_WITHDRAWALS=false
ENABLE_CRYPTO_PAYOUTS=false
```

---

## 3. Pre-Launch Release Gates

Before opening public registration:

- [x] **Database Integrity:** SQLite WAL mode verified; schema migrations run idempotently on startup.
- [x] **Authentication Security:** Google token verification on server; bcrypt password hashing (cost factor 10); 6-digit OTP rate-limited; 1-device binding active.
- [x] **Quarantine Enforcement:** Uploaded videos default to `pending_review`. Zero unapproved videos exposed in `/api/videos` or feed.
- [x] **Moderation Audit:** All approve/reject actions require a reason code and record reviewer ID, timestamp, and audit logs.
- [x] **Financial Lockdown:** Cash withdrawals locked with clear UI disclosure. Client cannot manipulate wallet balance or coins.
- [x] **Automated Tests:** All 25+ integration tests pass with 0 failures (`node test-e2e.js`).
- [ ] **Domain DNS & SSL:** HTTPS enforced with HSTS header (`Strict-Transport-Security`).
- [ ] **Google Cloud App Status:** OAuth consent screen transitioned from "Testing" to "In Production".
