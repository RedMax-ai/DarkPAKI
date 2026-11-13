# CreatorLoop (DarkPAKI VIP) — Known Limitations & Provider Dependencies

This document provides a transparent, comprehensive record of all mock modes, disabled features, and external provider dependencies in accordance with Step 7 of the specification.

---

## 1. Intentionally Disabled Financial Features

### Real-Money Cash Withdrawals & Crypto Payouts
* **Status:** STRICTLY DISABLED (`ENABLE_CASH_WITHDRAWALS=false`, `ENABLE_CRYPTO_PAYOUTS=false`).
* **Reason:** Compliance with financial regulations, tax reporting requirements, anti-money laundering (AML), and payment processor agreements.
* **UI Behavior:** The withdrawal interface displays clear status badges: *"Financial Safety Mode: Real-money withdrawals are locked during platform review"*.
* **Unlock Requirement:** Approval from authorized banking/payout rails (e.g., Stripe Connect, Razorpay, or JazzCash merchant APIs) and executive compliance sign-off.

### Video-View Cash Rewards
* **Status:** DISABLED (`ENABLE_VIEW_REWARDS=false`).
* **Reason:** Unverified view-based rewards incentivize bot traffic, click-farms, and violate major digital advertising network policies.
* **Policy:** Content views are counted as engagement metrics; creator monetization is allocated only from verified eligible net revenue pools.

---

## 2. Mock Modes & Fallback Adapters

### AI Moderation Adapter
* **Status:** Operational in Deterministic Mock Mode (`AI_MODERATION_MODE=mock`).
* **Functionality:** 
  * Analyzes submitted video metadata, tags, title, and keywords.
  * Deterministically computes safety risk scores across NSFW/Adult, Graphic Violence, Hate/Harassment, and Copyright/Duplicate Similarity.
  * Outputs are clearly labeled with `provider: "CreatorLoop-AI-Mock-v1"`, `isMock: true`.
  * High-risk content triggers mandatory human reviewer escalation.
* **Production Path:** Pluggable adapter interface ready for OpenAI Vision / Google Cloud Video Intelligence / Perspective API once cloud credentials are provided in `.env`.

### Cloudflare Turnstile Bot Shield
* **Status:** Active with smart simulation fallback.
* **Functionality:** In development or when test keys are used (`1x000...`), challenges auto-validate. In production with real keys, challenges are cryptographically verified against `challenges.cloudflare.com/turnstile/v0/siteverify`.

### Rewarded Advertising
* **Status:** Interface ready; provider callbacks require signed cryptographic verification (`adRewardClaims`).
* **Functionality:** No ad coins are awarded without a verified server callback from the ad network. Client-side button clicks cannot grant rewards.

---

## 3. Provider Dependencies Summary

| Service | Provider Option | Current Integration Status |
| :--- | :--- | :--- |
| **Authentication** | Google Identity Services | Real Web Client ID configured; fallback to Email+Password+OTP |
| **Object Storage** | Cloudflare R2 / Local FS | Local filesystem quarantine with S3-compatible adapter interface |
| **Bot Protection** | Cloudflare Turnstile | Server-verified with Cloudflare API |
| **AI Content Safety** | Cloud Video Intelligence | Deterministic Mock Adapter with live rule-based classification |
| **Ad Verification** | Monetag / Google AdMob | Server-side callback signature verification schema |
