/**
 * Rewards Platform — Unified API Client
 * Automatic CSRF injection, cookie credentials, device fingerprinting, and JWT refresh retry.
 */

function getCookie(name) {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^|;\\s*)(' + name + ')=([^;]*)'));
  return match ? decodeURIComponent(match[3]) : null;
}

let isRefreshing = false;
let refreshSubscribers = [];

function onRefreshed() {
  refreshSubscribers.forEach((cb) => cb());
  refreshSubscribers = [];
}

export async function apiFetch(path, options = {}) {
  const url = path.startsWith('/api') ? path : `/api${path}`;
  const method = (options.method || 'GET').toUpperCase();

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Attach CSRF token on mutating requests
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const csrfToken = getCookie('_csrf');
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
  }

  // Attach hardware fingerprint if present in storage
  if (typeof window !== 'undefined') {
    const deviceFp = localStorage.getItem('rewards_device_fp');
    if (deviceFp) {
      headers['X-Device-Fingerprint'] = deviceFp;
    }
  }

  const fetchOptions = {
    ...options,
    method,
    headers,
    credentials: 'include', // Ensure httpOnly cookies are transmitted
  };

  let res = await fetch(url, fetchOptions);

  // Handle Token Expiry & Automatic Refresh
  if (res.status === 401 && !path.includes('/auth/refresh') && !path.includes('/auth/google')) {
    const clone = res.clone();
    try {
      const errData = await clone.json();
      if (errData.code === 'TOKEN_EXPIRED') {
        if (!isRefreshing) {
          isRefreshing = true;
          try {
            const refreshRes = await fetch('/api/auth/refresh', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
            });
            if (refreshRes.ok) {
              isRefreshing = false;
              onRefreshed();
              // Retry original request
              return apiFetch(path, options);
            }
          } catch (e) {
            // Refresh failed
          } finally {
            isRefreshing = false;
          }
        } else {
          // Wait for in-flight refresh to finish then retry
          return new Promise((resolve) => {
            refreshSubscribers.push(() => {
              resolve(apiFetch(path, options));
            });
          });
        }
      }
    } catch (e) {
      // not JSON
    }
  }

  const contentType = res.headers.get('content-type');
  let data;
  if (contentType && contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  if (!res.ok) {
    const errorMsg = (data && data.error) || (data && data.message) || `HTTP ${res.status}`;
    const err = new Error(errorMsg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

// ── Auth Endpoints ──────────────────────────────────────────────
export const getMe = () => apiFetch('/auth/me');
export const loginWithGoogle = (payload) =>
  apiFetch('/auth/google', { method: 'POST', body: JSON.stringify(payload) });
export const refreshAuth = () => apiFetch('/auth/refresh', { method: 'POST' });
export const logout = () => apiFetch('/auth/logout', { method: 'POST' });

// ── User & Wallet Endpoints ─────────────────────────────────────
export const getProfile = () => apiFetch('/user/profile');
export const getDashboard = () => apiFetch('/user/dashboard');
export const getCoinHistory = (page = 1, limit = 20) =>
  apiFetch(`/user/coins?page=${page}&limit=${limit}`);

// ── Referral Endpoints ──────────────────────────────────────────
export const getReferralInfo = () => apiFetch('/referral/info');
export const qualifyReferral = (actionType = 'watch_video') =>
  apiFetch('/referral/qualify', {
    method: 'POST',
    body: JSON.stringify({ actionType }),
  });

// ── Withdrawal Endpoints ────────────────────────────────────────
export const getWithdrawalInfo = () => apiFetch('/withdrawal/info');
export const createWithdrawal = (payload) =>
  apiFetch('/withdrawal/create', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
export const getWithdrawalHistory = (page = 1, limit = 20) =>
  apiFetch(`/withdrawal/history?page=${page}&limit=${limit}`);

// ── Admin Endpoints ─────────────────────────────────────────────
export const getAdminStats = () => apiFetch('/admin/stats');
export const getAdminWithdrawals = (page = 1, limit = 20) =>
  apiFetch(`/admin/withdrawals?page=${page}&limit=${limit}`);
export const reviewWithdrawal = (id, payload) =>
  apiFetch(`/admin/withdrawals/${id}/review`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
export const markWithdrawalPaid = (id) =>
  apiFetch(`/admin/withdrawals/${id}/paid`, { method: 'PUT' });
export const getFlaggedReferrals = (page = 1, limit = 20) =>
  apiFetch(`/admin/referrals/flagged?page=${page}&limit=${limit}`);
export const reviewReferral = (id, payload) =>
  apiFetch(`/admin/referrals/${id}/review`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
export const getAuditLog = (page = 1, limit = 25) =>
  apiFetch(`/admin/audit-log?page=${page}&limit=${limit}`);
export const getUsers = (page = 1, limit = 25) =>
  apiFetch(`/admin/users?page=${page}&limit=${limit}`);
export const banUser = (id, isBanned = true) =>
  apiFetch(`/admin/users/${id}/ban`, {
    method: 'PUT',
    body: JSON.stringify({ isBanned }),
  });
