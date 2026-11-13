'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../components/AuthProvider';
import {
  getAdminStats,
  getAdminWithdrawals,
  reviewWithdrawal,
  markWithdrawalPaid,
  getFlaggedReferrals,
  reviewReferral,
  getAuditLog,
  getUsers,
  banUser,
} from '../../lib/api';

export default function AdminPage() {
  const router = useRouter();
  const { user, isAdmin, isLoading: authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState('withdrawals'); // 'withdrawals' | 'referrals' | 'users' | 'audit'
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toastMessage, setToastMessage] = useState('');

  // Data lists
  const [withdrawals, setWithdrawals] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);

  // Check admin authorization
  useEffect(() => {
    if (!authLoading) {
      if (!user) {
        router.push('/login');
      } else if (!isAdmin) {
        router.push('/dashboard');
      }
    }
  }, [user, isAdmin, authLoading, router]);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 4000);
  };

  const loadStats = useCallback(async () => {
    try {
      const data = await getAdminStats();
      setStats(data.data || data);
    } catch (err) {
      console.error('Error fetching admin stats:', err);
    }
  }, []);

  const loadTabContent = useCallback(async () => {
    setLoading(true);
    try {
      if (activeTab === 'withdrawals') {
        const res = await getAdminWithdrawals(1, 30);
        setWithdrawals(res.withdrawals || []);
      } else if (activeTab === 'referrals') {
        const res = await getFlaggedReferrals(1, 30);
        setReferrals(res.referrals || []);
      } else if (activeTab === 'users') {
        const res = await getUsers(1, 30);
        setUsersList(res.users || []);
      } else if (activeTab === 'audit') {
        const res = await getAuditLog(1, 30);
        setAuditLogs(res.entries || []);
      }
    } catch (err) {
      showToast('⚠️ Failed to load ' + activeTab + ': ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (isAdmin) {
      loadStats();
      loadTabContent();
    }
  }, [isAdmin, loadStats, loadTabContent]);

  // Actions
  const handleReviewWithdrawal = async (id, status) => {
    try {
      await reviewWithdrawal(id, { status, adminNote: `Admin ${status} via panel` });
      showToast(`Withdrawal #${id} marked as ${status}!`);
      await Promise.all([loadStats(), loadTabContent()]);
    } catch (err) {
      showToast('⚠️ ' + err.message);
    }
  };

  const handleMarkPaid = async (id) => {
    try {
      await markWithdrawalPaid(id);
      showToast(`Withdrawal #${id} marked as PAID!`);
      await Promise.all([loadStats(), loadTabContent()]);
    } catch (err) {
      showToast('⚠️ ' + err.message);
    }
  };

  const handleReviewReferral = async (id, status) => {
    try {
      await reviewReferral(id, { status });
      showToast(`Referral #${id} ${status}!`);
      await Promise.all([loadStats(), loadTabContent()]);
    } catch (err) {
      showToast('⚠️ ' + err.message);
    }
  };

  const handleToggleBan = async (id, currentBanned) => {
    const newStatus = !currentBanned;
    if (!confirm(`Are you sure you want to ${newStatus ? 'BAN' : 'UNBAN'} user #${id}?`)) return;
    try {
      await banUser(id, newStatus);
      showToast(`User #${id} ${newStatus ? 'banned' : 'unbanned'} successfully.`);
      await loadTabContent();
    } catch (err) {
      showToast('⚠️ ' + err.message);
    }
  };

  if (authLoading || !isAdmin) {
    return (
      <div className="container page-loading">
        <span className="spinner spinner-lg"></span>
        <p className="mt-3 text-muted">Authenticating Admin Access...</p>
      </div>
    );
  }

  return (
    <div className="container admin-page">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="toast-banner">
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <div className="admin-header-row">
        <div>
          <span className="badge badge-purple mb-1">👑 Master Administration Panel</span>
          <h1 className="admin-title">Platform Operations & Moderation</h1>
        </div>
        <button onClick={() => { loadStats(); loadTabContent(); }} className="btn btn-sm btn-outline">
          🔄 Refresh All
        </button>
      </div>

      {/* 4 Stats Cards (Real from DB) */}
      <div className="metrics-grid mt-4">
        <div className="metric-card">
          <span className="metric-label">Total Registered Users</span>
          <div className="metric-value-row">
            <span className="metric-value">{stats?.totalUsers ?? 0}</span>
            <span className="metric-unit">Accounts</span>
          </div>
          <span className="metric-subtext">Verified Google single-identity</span>
        </div>

        <div className="metric-card metric-card-gold">
          <span className="metric-label">Coins In Circulation</span>
          <div className="metric-value-row">
            <span className="metric-value">{(stats?.totalCoinsInCirculation ?? 0).toLocaleString()}</span>
            <span className="metric-unit">Coins</span>
          </div>
          <span className="metric-subtext">
            ≈ ₹{((stats?.totalCoinsInCirculation ?? 0) / 100).toFixed(2)} Platform Liability
          </span>
        </div>

        <div className="metric-card">
          <span className="metric-label">Pending Withdrawals</span>
          <div className="metric-value-row">
            <span className="metric-value">{stats?.pendingWithdrawalsCount ?? 0}</span>
            <span className="metric-unit">Requests</span>
          </div>
          <span className="metric-subtext">Waiting for verification & payout</span>
        </div>

        <div className="metric-card">
          <span className="metric-label">Flagged Referrals</span>
          <div className="metric-value-row">
            <span className="metric-value">{stats?.flaggedReferralsCount ?? 0}</span>
            <span className="metric-unit">Suspicious</span>
          </div>
          <span className="metric-subtext">Anti-cheat hardware / IP triggers</span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="admin-tabs-bar mt-6">
        <button
          onClick={() => setActiveTab('withdrawals')}
          className={`admin-tab ${activeTab === 'withdrawals' ? 'active' : ''}`}
        >
          💳 Withdrawals Queue ({stats?.pendingWithdrawalsCount ?? 0})
        </button>
        <button
          onClick={() => setActiveTab('referrals')}
          className={`admin-tab ${activeTab === 'referrals' ? 'active' : ''}`}
        >
          🛡️ Flagged Referrals ({stats?.flaggedReferralsCount ?? 0})
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={`admin-tab ${activeTab === 'users' ? 'active' : ''}`}
        >
          👥 User Directory ({stats?.totalUsers ?? 0})
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`admin-tab ${activeTab === 'audit' ? 'active' : ''}`}
        >
          📜 Audit Trail
        </button>
      </div>

      {/* Tab 1: Withdrawals Queue */}
      {activeTab === 'withdrawals' && (
        <div className="admin-content-box mt-4">
          <h3>Withdrawals Moderation Queue</h3>
          <p className="text-muted text-sm mb-3">
            Approving locks verification. Rejecting automatically releases locked coins back to the user’s ledger.
          </p>

          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>User & Email</th>
                  <th>Amount</th>
                  <th>Channel & Details</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-muted py-6">
                      No withdrawal records found.
                    </td>
                  </tr>
                ) : (
                  withdrawals.map((w) => (
                    <tr key={w.id}>
                      <td className="font-mono">#{w.id}</td>
                      <td>
                        <span className="font-bold">{w.user_name || 'User ' + w.user_id}</span>
                        <br />
                        <span className="text-muted text-xs">{w.user_email}</span>
                      </td>
                      <td className="font-mono font-bold">
                        {w.currency} {w.amount_currency}
                        <br />
                        <span className="text-xs text-muted">
                          ({w.amount_coins?.toLocaleString()} coins)
                        </span>
                      </td>
                      <td>
                        <span className="badge uppercase font-bold">{w.method}</span>
                        <div className="font-mono text-xs text-muted mt-1 max-w-xs break-all">
                          {typeof w.payment_details === 'object'
                            ? JSON.stringify(w.payment_details)
                            : w.payment_details}
                        </div>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            w.status === 'paid'
                              ? 'badge-success'
                              : w.status === 'approved'
                              ? 'badge-purple'
                              : w.status === 'rejected'
                              ? 'badge-danger'
                              : 'badge-warning'
                          }`}
                        >
                          {w.status}
                        </span>
                      </td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1.5">
                          {w.status === 'pending' && (
                            <>
                              <button
                                onClick={() => handleReviewWithdrawal(w.id, 'approved')}
                                className="btn btn-xs btn-success"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => handleReviewWithdrawal(w.id, 'rejected')}
                                className="btn btn-xs btn-danger"
                              >
                                Reject
                              </button>
                            </>
                          )}
                          {w.status === 'approved' && (
                            <button
                              onClick={() => handleMarkPaid(w.id)}
                              className="btn btn-xs btn-primary"
                            >
                              Mark Paid ✓
                            </button>
                          )}
                          {['paid', 'rejected'].includes(w.status) && (
                            <span className="text-xs text-muted">Completed</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Flagged Referrals */}
      {activeTab === 'referrals' && (
        <div className="admin-content-box mt-4">
          <h3>Suspicious / Anti-Cheat Flagged Referrals</h3>
          <p className="text-muted text-sm mb-3">
            Referrals triggered by multi-account hardware detection, duplicate IPs, or velocity caps.
          </p>

          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Referrer</th>
                  <th>Referred User</th>
                  <th>Flag Reason</th>
                  <th>Status</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {referrals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-muted py-6">
                      No flagged referrals in queue.
                    </td>
                  </tr>
                ) : (
                  referrals.map((r) => (
                    <tr key={r.id}>
                      <td className="font-mono">#{r.id}</td>
                      <td>
                        <strong>{r.referrer_name}</strong>
                        <div className="text-xs text-muted">{r.referrer_email}</div>
                      </td>
                      <td>
                        <strong>{r.referred_name}</strong>
                        <div className="text-xs text-muted">{r.referred_email}</div>
                      </td>
                      <td>
                        <span className="text-danger text-xs font-bold">
                          {r.flag_reason || 'Anti-Cheat Heuristic'}
                        </span>
                      </td>
                      <td>
                        <span className="badge badge-warning">{r.status}</span>
                      </td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <button
                            onClick={() => handleReviewReferral(r.id, 'credited')}
                            className="btn btn-xs btn-success"
                          >
                            Credit (+3000)
                          </button>
                          <button
                            onClick={() => handleReviewReferral(r.id, 'rejected')}
                            className="btn btn-xs btn-danger"
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Users Directory */}
      {activeTab === 'users' && (
        <div className="admin-content-box mt-4">
          <h3>User Directory & Ledger Balances</h3>
          <div className="table-wrapper mt-3">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name & Email</th>
                  <th>Role</th>
                  <th>Country</th>
                  <th>Coin Balance</th>
                  <th>Status</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {usersList.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center text-muted py-6">
                      No users found.
                    </td>
                  </tr>
                ) : (
                  usersList.map((u) => (
                    <tr key={u.id}>
                      <td className="font-mono">#{u.id}</td>
                      <td>
                        <strong>{u.name}</strong>
                        <div className="text-xs text-muted">{u.email}</div>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            u.role === 'admin' ? 'badge-purple' : 'badge-secondary'
                          }`}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="font-mono">{u.country_code || '---'}</td>
                      <td className="font-mono font-bold text-accent">
                        {(u.balance || 0).toLocaleString()} coins
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            u.is_banned ? 'badge-danger' : 'badge-success'
                          }`}
                        >
                          {u.is_banned ? 'BANNED' : 'ACTIVE'}
                        </span>
                      </td>
                      <td className="text-right">
                        {u.role !== 'admin' && (
                          <button
                            onClick={() => handleToggleBan(u.id, u.is_banned)}
                            className={`btn btn-xs ${
                              u.is_banned ? 'btn-success' : 'btn-danger'
                            }`}
                          >
                            {u.is_banned ? 'Unban' : 'Ban User'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Audit Trail */}
      {activeTab === 'audit' && (
        <div className="admin-content-box mt-4">
          <h3>Security & Operational Audit Trail</h3>
          <p className="text-muted text-sm mb-3">
            Immutable log recording administrative reviews, login attempts, user bans, and payout mutations.
          </p>

          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Action</th>
                  <th>Operator (User ID)</th>
                  <th>Target</th>
                  <th>IP Address</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-muted py-6">
                      No audit events logged yet.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="font-mono text-xs">
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td>
                        <span className="badge badge-purple">{log.action}</span>
                      </td>
                      <td className="font-mono">User #{log.user_id || 'Sys'}</td>
                      <td className="font-mono text-xs">
                        {log.target_type ? `${log.target_type} #${log.target_id}` : '---'}
                      </td>
                      <td className="font-mono text-xs">{log.ip_address || '---'}</td>
                      <td className="font-mono text-xs text-muted max-w-xs break-all">
                        {typeof log.details === 'object'
                          ? JSON.stringify(log.details)
                          : log.details || '---'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
