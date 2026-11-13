# CreatorLoop (DarkPAKI VIP) — Social Video & Creator Monetization Platform

CreatorLoop is a high-performance, mobile-first social video platform featuring creator publishing, Instagram-inspired community engagement, AI-assisted video moderation, server-controlled wallet accounting, and fraud-resistant referral engines.

---

## 1. Quick Start

### Prerequisites
* **Node.js**: v20+ (v22+ recommended)
* **npm**: v10+

### Installation & Local Setup
```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your Google OAuth and Turnstile keys if available

# 3. Seed database
npm run seed

# 4. Start the platform
npm start
```
* **Local Web Application:** `http://localhost:5000`
* **Admin Moderation Console:** `http://localhost:5000/admin` *(Master PIN: `7860`)*

### Running E2E Verification Tests
```bash
node test-e2e.js
```

---

## 2. Architecture & Design Principles

### Core Stack
* **Runtime:** Node.js 22+ with Express 5.x
* **Database:** SQLite with Write-Ahead Logging (WAL) for high concurrency and zero corruption
* **Security Middleware:** Helmet CSP headers, CORS allowlist, and express-rate-limit
* **Authentication:** Google Identity Services (GIS) OAuth 2.0, Email + bcrypt password, 6-digit OTP verification, and 1-Device hardware fingerprint binding
* **Bot Shield:** Cloudflare Turnstile smart captcha
* **Styling & UI:** Custom dark neon design system (Tailwind CSS utilities + responsive CSS tokens)

### Design Tokens
* **Background Surface:** `#050508` (Deep void black)
* **Card & Panel Surface:** `#0c0c12` / `#121218` with subtle border glows
* **Neon Accents:**
  * Crimson / Rose: `#f43f5e` (18+ VIP & Primary Actions)
  * Purple / Violet: `#a855f7` (Creator Studio & Monetization)
  * Emerald / Green: `#10b981` (Verification & Earning Badges)
  * Amber / Gold: `#f59e0b` (Coins & VIP Rewards)

---

## 3. Security & Financial Integrity

1. **Mandatory Video Moderation:** All video uploads enter quarantine as `pending_review`. Only videos explicitly approved by an authorized moderator appear in public feeds.
2. **Immutable Wallet Ledger:** Virtual coins and balances operate on an append-only ledger (`wallet_ledger`) with minor integer units. Reversals are recorded as offsetting entries.
3. **Cash & Crypto Payouts Disabled:** Real-money withdrawals and crypto payouts remain strictly locked (`ENABLE_CASH_WITHDRAWALS=false`) until regulatory and provider compliance gates are cleared.
4. **Anti-Cheat 1-Device Shield:** Each hardware device identifier is bound to exactly one registered account. Secondary account creation and self-referrals are blocked with `403 Forbidden`.

---

## 4. Documentation Map
* `IMPLEMENTATION_PLAN.md` — Active development milestones, roadmap, and risk analysis.
* `SECURITY_CHECKLIST.md` — Security audit controls and configuration gates.
* `KNOWN_LIMITATIONS.md` — Documented mock modes and provider dependencies.
* `DEPLOYMENT.md` — Production staging and release checklist.
