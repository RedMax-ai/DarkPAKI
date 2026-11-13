'use client';

import Link from 'next/link';
import { useAuth } from '../components/AuthProvider';

export default function LandingPage() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="landing-page">
      {/* ── Hero Section ────────────────────────────────────────── */}
      <section className="hero-section">
        <div className="container hero-container">
          <div className="hero-badge">
            <span className="badge-pulse"></span>
            <span>100% Verified Database Ledger • Zero Simulated Data</span>
          </div>

          <h1 className="hero-title">
            Earn Real Rewards. <br />
            <span className="gradient-text">Cash Out Straight to UPI & Bank.</span>
          </h1>

          <p className="hero-description">
            Join thousands earning real balance daily. Watch sponsor media, invite your friends
            with an industry-leading <strong>₹30 per referral (3,000 coins)</strong>, and withdraw directly
            to UPI, Bank, JazzCash, Easypaisa, or PayPal with cryptographic assurance.
          </p>

          <div className="hero-cta-group">
            {isAuthenticated ? (
              <Link href="/dashboard" className="btn btn-lg btn-primary">
                Open My Dashboard ➔
              </Link>
            ) : (
              <Link href="/login" className="btn btn-lg btn-primary">
                Start Earning with Google ➔
              </Link>
            )}
            <Link href="#how-it-works" className="btn btn-lg btn-secondary">
              How It Works
            </Link>
          </div>

          {/* Quick Metrics Bar */}
          <div className="hero-stats-bar">
            <div className="stat-pill">
              <span className="stat-pill-num">100 Coins = ₹1.00</span>
              <span className="stat-pill-label">Official Exchange Rate</span>
            </div>
            <div className="stat-pill">
              <span className="stat-pill-num">3,000 Coins (₹30)</span>
              <span className="stat-pill-label">Per Qualified Referral</span>
            </div>
            <div className="stat-pill">
              <span className="stat-pill-num">₹500 / $5 Min</span>
              <span className="stat-pill-label">Fast Direct Payout</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Feature Cards ───────────────────────────────────────── */}
      <section className="features-section">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">Built for Real Earnings, Guaranteed Integrity</h2>
            <p className="section-subtitle">
              Every balance calculation runs on our server database with row-level transaction locks.
            </p>
          </div>

          <div className="features-grid">
            <div className="feature-card">
              <div className="feature-icon feature-icon-rose">🪙</div>
              <h3 className="feature-card-title">Watch & Earn Daily</h3>
              <p className="feature-card-desc">
                Stream approved cinema and sponsor clips to instantly accumulate coins. Every watch
                event is recorded on an immutable append-only ledger.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon feature-icon-purple">👥</div>
              <h3 className="feature-card-title">₹30 Referral Bounty</h3>
              <p className="feature-card-desc">
                Share your personal link. Earn 3,000 coins immediately when your invited friend
                completes their first qualifying activity.
              </p>
            </div>

            <div className="feature-card">
              <div className="feature-icon feature-icon-green">💳</div>
              <h3 className="feature-card-title">Global Payout Channels</h3>
              <p className="feature-card-desc">
                Withdraw to UPI or IMPS bank transfer in India, JazzCash or Easypaisa in Pakistan,
                and PayPal across 150+ other supported countries.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── How It Works Steps ──────────────────────────────────── */}
      <section id="how-it-works" className="how-it-works-section">
        <div className="container">
          <div className="section-header">
            <h2 className="section-title">How To Start Earning in 4 Simple Steps</h2>
          </div>

          <div className="steps-grid">
            <div className="step-card">
              <div className="step-number">01</div>
              <h4>1-Click Google Sign-In</h4>
              <p>Authorize seamlessly with Google. We verify the ID token server-side and lock duplicate accounts.</p>
            </div>

            <div className="step-card">
              <div className="step-number">02</div>
              <h4>Collect Signup Bonus</h4>
              <p>Receive 500 bonus coins (₹5.00) instantly deposited into your append-only ledger.</p>
            </div>

            <div className="step-card">
              <div className="step-number">03</div>
              <h4>Share & Watch</h4>
              <p>Invite friends with your unique code and stream sponsor clips to grow your balance.</p>
            </div>

            <div className="step-card">
              <div className="step-number">04</div>
              <h4>Request Fast Cash Out</h4>
              <p>Hit the country minimum (₹500 / $5) and submit your payout details encrypted with AES-256.</p>
            </div>
          </div>

          <div className="text-center mt-8">
            <Link href="/login" className="btn btn-lg btn-primary">
              Join RewardsPlatform Now ➔
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
