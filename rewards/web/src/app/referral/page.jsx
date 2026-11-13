'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../components/AuthProvider';
import { getReferralInfo } from '../../lib/api';

export default function ReferralPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  const [refData, setRefData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) {
      getReferralInfo()
        .then((data) => setRefData(data))
        .catch((err) => console.error('Failed to load referral stats:', err))
        .finally(() => setLoading(false));
    }
  }, [user]);

  const referralCode = refData?.referralCode || user?.referral_code || '---';
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const referralLink = `${origin}/login?ref=${referralCode}`;

  const handleCopyLink = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const shareWhatsApp = () => {
    const text = encodeURIComponent(
      `🔥 Earn real cash on RewardsPlatform! Join using my referral link and get 500 bonus coins: ${referralLink}`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const shareTelegram = () => {
    const text = encodeURIComponent(
      `🔥 Join RewardsPlatform and earn ₹30+ daily watching clips! Register here:`
    );
    window.open(
      `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${text}`,
      '_blank'
    );
  };

  if (authLoading || loading) {
    return (
      <div className="container page-loading">
        <span className="spinner spinner-lg"></span>
        <p className="mt-3 text-muted">Retrieving referral metrics from database...</p>
      </div>
    );
  }

  const stats = refData?.stats || { total: 0, pending: 0, credited: 0 };
  const earnedCoins = (stats.credited || 0) * 3000;
  const earnedInr = (earnedCoins / 100).toFixed(2);

  return (
    <div className="container referral-page">
      {/* Title & Program Overview */}
      <div className="section-header">
        <h1 className="section-title">Referral Bounty Program</h1>
        <p className="section-subtitle">
          Earn <strong className="text-accent">3,000 Coins (₹30.00)</strong> for every friend who joins
          with your link and completes their first activity.
        </p>
      </div>

      {/* Referral Link & Share Box */}
      <div className="referral-share-card">
        <div className="share-box-header">
          <div>
            <h3>Your Unique Referral Link</h3>
            <p className="text-muted text-sm">
              Friends clicking your link automatically have your code applied on the login screen.
            </p>
          </div>
          <div className="ref-code-chip">
            <span className="text-xs text-muted">MY CODE:</span>
            <span className="font-mono font-bold text-accent">{referralCode}</span>
          </div>
        </div>

        <div className="copy-link-bar">
          <input
            type="text"
            readOnly
            value={referralLink}
            className="form-input font-mono text-sm"
          />
          <button onClick={handleCopyLink} className="btn btn-primary whitespace-nowrap">
            {copied ? '✓ Copied!' : '📋 Copy Link'}
          </button>
        </div>

        {/* Social Share Buttons */}
        <div className="social-share-buttons">
          <button onClick={shareWhatsApp} className="btn btn-whatsapp">
            <span>💬 Share via WhatsApp</span>
          </button>
          <button onClick={shareTelegram} className="btn btn-telegram">
            <span>✈️ Share on Telegram</span>
          </button>
        </div>
      </div>

      {/* Referral Live Analytics (Real from DB) */}
      <div className="metrics-grid mt-6">
        <div className="metric-card">
          <span className="metric-label">Total Referrals Registered</span>
          <div className="metric-value-row">
            <span className="metric-value">{stats.total}</span>
            <span className="metric-unit">Users</span>
          </div>
          <span className="metric-subtext">All time registrations linked</span>
        </div>

        <div className="metric-card metric-card-gold">
          <span className="metric-label">Qualified & Credited</span>
          <div className="metric-value-row">
            <span className="metric-value">{stats.credited}</span>
            <span className="metric-unit">Active</span>
          </div>
          <span className="metric-subtext">Earned 3,000 coins each</span>
        </div>

        <div className="metric-card">
          <span className="metric-label">Pending Qualification</span>
          <div className="metric-value-row">
            <span className="metric-value">{stats.pending}</span>
            <span className="metric-unit">Waiting</span>
          </div>
          <span className="metric-subtext">Credits upon their 1st watch/action</span>
        </div>

        <div className="metric-card">
          <span className="metric-label">Total Bounty Earned</span>
          <div className="metric-value-row">
            <span className="metric-value">{earnedCoins.toLocaleString()}</span>
            <span className="metric-unit">Coins</span>
          </div>
          <span className="metric-subtext">≈ ₹{earnedInr} Cash Value</span>
        </div>
      </div>

      {/* Rules & Anti-Fraud Notice */}
      <div className="referral-rules-card mt-6">
        <h4>Fair Play & Anti-Fraud Terms</h4>
        <ul className="rules-list">
          <li>
            <strong>Delayed Bounty:</strong> To prevent bot accounts, referral credit is held in
            pending state until the referred friend completes at least one qualifying action
            (such as streaming a video or watching sponsor media).
          </li>
          <li>
            <strong>Single Device Lock:</strong> Referring accounts sharing the same physical device
            hardware fingerprint or IP address will be flagged for automated admin audit.
          </li>
          <li>
            <strong>Daily Velocity Limit:</strong> Accounts may credit a maximum of 10 qualified
            referrals per calendar day. Excess referrals are routed to manual moderation.
          </li>
          <li>
            <strong>Self-Referrals Prohibited:</strong> Using your own code on secondary accounts
            triggers automatic referral rejection.
          </li>
        </ul>
      </div>
    </div>
  );
}
