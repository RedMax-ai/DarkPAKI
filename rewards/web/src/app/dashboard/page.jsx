'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../components/AuthProvider';
import { getDashboard, getCoinHistory, qualifyReferral } from '../../lib/api';

export default function DashboardPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingData, setLoadingData] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  // Protect route
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  const loadDashboard = useCallback(async () => {
    try {
      const data = await getDashboard();
      setStats(data);
    } catch (err) {
      console.error('Failed to load dashboard metrics:', err);
    }
  }, []);

  const loadHistory = useCallback(async (p = 1) => {
    try {
      const data = await getCoinHistory(p, 10);
      setHistory(data.entries || []);
      setPage(data.page || 1);
      setTotalPages(data.pages || 1);
    } catch (err) {
      console.error('Failed to load ledger history:', err);
    }
  }, []);

  useEffect(() => {
    if (user) {
      Promise.all([loadDashboard(), loadHistory(1)]).finally(() => {
        setLoadingData(false);
      });
    }
  }, [user, loadDashboard, loadHistory]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 4000);
  };

  const handleWatchAndEarn = async () => {
    setActionLoading(true);
    try {
      const res = await qualifyReferral('watch_video');
      showToast(res.message || '🎉 Watch activity recorded! Balance refreshed.');
      await Promise.all([loadDashboard(), loadHistory(1)]);
    } catch (err) {
      showToast('⚠️ ' + (err.message || 'Activity could not be processed'));
    } finally {
      setActionLoading(false);
    }
  };

  if (authLoading || (!user && loadingData)) {
    return (
      <div className="container page-loading">
        <span className="spinner spinner-lg"></span>
        <p className="mt-3 text-muted">Loading live database ledger...</p>
      </div>
    );
  }

  const coins = stats?.balance ?? 0;
  const inrValue = (coins / 100).toFixed(2);
  const totalEarnedCoins = stats?.totalEarned ?? coins;
  const totalEarnedInr = (totalEarnedCoins / 100).toFixed(2);

  return (
    <div className="container dashboard-page">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="toast-banner">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="dashboard-header-card">
        <div className="user-welcome-info">
          <h2>Welcome, {user?.name}</h2>
          <p className="text-muted">{user?.email}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="badge badge-success">✓ Google Verified</span>
            <span className="badge badge-purple font-mono">
              Code: {user?.referral_code || '---'}
            </span>
          </div>
        </div>

        <div className="dashboard-quick-actions">
          <button
            onClick={handleWatchAndEarn}
            disabled={actionLoading}
            className="btn btn-primary"
          >
            {actionLoading ? (
              <>
                <span className="spinner"></span> Processing...
              </>
            ) : (
              <>▶ Watch & Earn (+Coins)</>
            )}
          </button>
          <Link href="/withdraw" className="btn btn-secondary">
            💳 Withdraw Cash
          </Link>
        </div>
      </div>

      {/* 4 Core Financial Metrics (Real from PostgreSQL SUM) */}
      <div className="metrics-grid">
        <div className="metric-card metric-card-gold">
          <span className="metric-label">Live Available Balance</span>
          <div className="metric-value-row">
            <span className="metric-value">{coins.toLocaleString()}</span>
            <span className="metric-unit">Coins</span>
          </div>
          <span className="metric-subtext">≈ ₹{inrValue} INR Cash Value</span>
        </div>

        <div className="metric-card">
          <span className="metric-label">Lifetime Coins Earned</span>
          <div className="metric-value-row">
            <span className="metric-value">{totalEarnedCoins.toLocaleString()}</span>
            <span className="metric-unit">Coins</span>
          </div>
          <span className="metric-subtext">≈ ₹{totalEarnedInr} Total Accrued</span>
        </div>

        <div className="metric-card">
          <span className="metric-label">Successful Referrals</span>
          <div className="metric-value-row">
            <span className="metric-value">{stats?.totalReferrals ?? 0}</span>
            <span className="metric-unit">Friends</span>
          </div>
          <span className="metric-subtext">
            {stats?.pendingReferrals ?? 0} Pending Qualification
          </span>
        </div>

        <div className="metric-card">
          <span className="metric-label">Sponsor Watches</span>
          <div className="metric-value-row">
            <span className="metric-value">{stats?.adsWatched ?? 0}</span>
            <span className="metric-unit">Completed</span>
          </div>
          <span className="metric-subtext">10 Coins rewarded per stream</span>
        </div>
      </div>

      {/* Append-Only Ledger History Section */}
      <div className="ledger-section">
        <div className="section-header-row">
          <div>
            <h3>Append-Only Transaction Ledger</h3>
            <p className="text-muted text-sm">
              All balance shifts originate strictly from immutable server ledger entries.
            </p>
          </div>
          <button onClick={() => loadHistory(page)} className="btn btn-sm btn-outline">
            🔄 Refresh
          </button>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Type</th>
                <th>Description</th>
                <th>Idempotency Key (Ref)</th>
                <th className="text-right">Amount (Coins)</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-muted py-6">
                    No ledger transactions recorded yet.
                  </td>
                </tr>
              ) : (
                history.map((tx) => {
                  const isPositive = tx.amount > 0;
                  return (
                    <tr key={tx.id}>
                      <td className="font-mono text-sm">
                        {new Date(tx.created_at).toLocaleString()}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            isPositive ? 'badge-success' : 'badge-danger'
                          }`}
                        >
                          {tx.type}
                        </span>
                      </td>
                      <td>{tx.description || 'System transaction'}</td>
                      <td className="font-mono text-muted text-xs">
                        {tx.ref_id ? tx.ref_id.slice(0, 16) + '...' : '---'}
                      </td>
                      <td
                        className={`text-right font-mono font-bold ${
                          isPositive ? 'text-success' : 'text-danger'
                        }`}
                      >
                        {isPositive ? `+${tx.amount}` : tx.amount}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="pagination-bar">
            <button
              onClick={() => loadHistory(page - 1)}
              disabled={page <= 1}
              className="btn btn-sm btn-secondary"
            >
              Previous
            </button>
            <span className="pagination-info">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => loadHistory(page + 1)}
              disabled={page >= totalPages}
              className="btn btn-sm btn-secondary"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
