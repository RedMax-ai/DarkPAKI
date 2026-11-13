-- ============================================================================
-- Rewards Platform · PostgreSQL Schema
-- Run: psql $DATABASE_URL < db/migrations/001_initial.sql
-- ============================================================================

BEGIN;

-- ── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  google_id       VARCHAR(255)  UNIQUE NOT NULL,
  email           VARCHAR(255)  UNIQUE NOT NULL,
  normalized_email VARCHAR(255) UNIQUE NOT NULL,
  name            VARCHAR(255)  NOT NULL,
  avatar_url      TEXT,
  role            VARCHAR(20)   NOT NULL DEFAULT 'user'
                    CHECK (role IN ('user', 'admin')),
  country_code    VARCHAR(10),
  device_fingerprint VARCHAR(255),
  registration_ip INET,
  referral_code   VARCHAR(20)   UNIQUE NOT NULL,
  referred_by     INTEGER       REFERENCES users(id),
  referral_status VARCHAR(20)   NOT NULL DEFAULT 'none'
                    CHECK (referral_status IN ('none','pending','credited','rejected')),
  first_qualifying_action_at TIMESTAMPTZ,
  is_banned       BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Coin Ledger (append-only, balance = SUM) ────────────────────────────────
CREATE TABLE IF NOT EXISTS coin_ledger (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER       NOT NULL REFERENCES users(id),
  amount      INTEGER       NOT NULL,
  type        VARCHAR(50)   NOT NULL
                CHECK (type IN (
                  'signup_bonus','referral_bonus','referral_referred_bonus',
                  'watch_reward','withdrawal_lock','withdrawal_release',
                  'withdrawal_debit','admin_adjustment'
                )),
  ref_id      VARCHAR(255),          -- idempotency key
  description TEXT,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_coin_ledger_user
  ON coin_ledger(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_coin_ledger_idempotency
  ON coin_ledger(ref_id) WHERE ref_id IS NOT NULL;

-- ── Referrals ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals (
  id                SERIAL PRIMARY KEY,
  referrer_id       INTEGER       NOT NULL REFERENCES users(id),
  referred_id       INTEGER       UNIQUE NOT NULL REFERENCES users(id),
  status            VARCHAR(20)   NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','credited','rejected')),
  coins_credited    INTEGER       NOT NULL DEFAULT 0,
  device_fingerprint VARCHAR(255),
  ip_address        INET,
  flagged           BOOLEAN       NOT NULL DEFAULT FALSE,
  flag_reason       TEXT,
  reviewed_by       INTEGER       REFERENCES users(id),
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer
  ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_status
  ON referrals(status);

-- ── Withdrawals ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS withdrawals (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER       NOT NULL REFERENCES users(id),
  amount_coins      INTEGER       NOT NULL,
  amount_currency   DECIMAL(10,2) NOT NULL,
  currency          VARCHAR(10)   NOT NULL DEFAULT 'INR',
  method            VARCHAR(50)   NOT NULL
                      CHECK (method IN ('upi','bank','jazzcash','easypaisa','paypal')),
  payment_details   TEXT          NOT NULL,   -- AES-256-CBC encrypted JSON
  status            VARCHAR(20)   NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected','paid')),
  admin_note        TEXT,
  reviewed_by       INTEGER       REFERENCES users(id),
  reviewed_at       TIMESTAMPTZ,
  idempotency_key   VARCHAR(255)  UNIQUE NOT NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user   ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

-- ── Sessions (server-side, for refresh-token rotation) ──────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER       NOT NULL REFERENCES users(id),
  refresh_token_hash  VARCHAR(255)  NOT NULL,
  device_fingerprint  VARCHAR(255),
  ip_address          INET,
  user_agent          TEXT,
  expires_at          TIMESTAMPTZ   NOT NULL,
  revoked             BOOLEAN       NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user  ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(refresh_token_hash);

-- ── Audit Log ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER       REFERENCES users(id),
  action      VARCHAR(100)  NOT NULL,
  target_type VARCHAR(50),
  target_id   INTEGER,
  details     JSONB,
  ip_address  INET,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_user   ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

-- ── Device Fingerprints (multi-account detection) ───────────────────────────
CREATE TABLE IF NOT EXISTS device_fingerprints (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER       NOT NULL REFERENCES users(id),
  fingerprint   VARCHAR(255)  NOT NULL,
  ip_address    INET,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_device_fp_fingerprint ON device_fingerprints(fingerprint);
CREATE INDEX IF NOT EXISTS idx_device_fp_user        ON device_fingerprints(user_id);

-- ── Helper: update updated_at on row change ─────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER set_withdrawals_updated_at
  BEFORE UPDATE ON withdrawals
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

COMMIT;
