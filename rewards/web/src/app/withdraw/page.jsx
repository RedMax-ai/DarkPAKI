'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../components/AuthProvider';
import TurnstileWidget from '../../components/TurnstileWidget';
import {
  getWithdrawalInfo,
  createWithdrawal,
  getWithdrawalHistory,
} from '../../lib/api';

function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'idx_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function WithdrawPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  const [info, setInfo] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form states
  const [amountCoins, setAmountCoins] = useState('');
  const [selectedMethod, setSelectedMethod] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');

  // Payment details dynamic inputs
  const [upiId, setUpiId] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [accountHolder, setAccountHolder] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [paypalEmail, setPaypalEmail] = useState('');

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  const loadData = useCallback(async () => {
    try {
      const [infoData, historyData] = await Promise.all([
        getWithdrawalInfo(),
        getWithdrawalHistory(1, 10),
      ]);
      setInfo(infoData);
      setHistory(historyData.withdrawals || []);

      // Pre-select default method
      const methods = infoData?.countryRules?.methods || [];
      if (methods.length > 0 && !selectedMethod) {
        setSelectedMethod(methods[0]);
      }
    } catch (err) {
      console.error('Error fetching withdrawal data:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedMethod]);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user, loadData]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const coinsToWithdraw = parseInt(amountCoins, 10);
    const minCoins = info?.countryRules?.minCoins || 50000;
    const balance = info?.balance || 0;

    if (!coinsToWithdraw || isNaN(coinsToWithdraw) || coinsToWithdraw <= 0) {
      setError('Please specify a valid positive coin amount.');
      return;
    }

    if (coinsToWithdraw < minCoins) {
      setError(
        `Withdrawal amount is below the minimum required for your country (${minCoins.toLocaleString()} coins).`
      );
      return;
    }

    if (coinsToWithdraw > balance) {
      setError('Insufficient available balance in your wallet.');
      return;
    }

    if (!turnstileToken) {
      setError('Please complete the Cloudflare security verification check.');
      return;
    }

    // Build payment details based on selected method
    let paymentDetails = {};
    if (selectedMethod === 'upi') {
      if (!upiId.trim() || !upiId.includes('@')) {
        setError('Please provide a valid UPI ID (e.g. name@bank).');
        return;
      }
      paymentDetails = { upiId: upiId.trim() };
    } else if (selectedMethod === 'bank') {
      if (!accountNumber.trim() || !ifsc.trim() || !accountHolder.trim()) {
        setError('All bank fields (Account Number, IFSC, and Account Holder) are required.');
        return;
      }
      paymentDetails = {
        accountNumber: accountNumber.trim(),
        ifsc: ifsc.trim().toUpperCase(),
        accountHolder: accountHolder.trim(),
      };
    } else if (['jazzcash', 'easypaisa'].includes(selectedMethod)) {
      if (!mobileNumber.trim() || mobileNumber.trim().length < 10) {
        setError('Please enter a valid mobile account number.');
        return;
      }
      paymentDetails = { mobileNumber: mobileNumber.trim() };
    } else if (selectedMethod === 'paypal') {
      if (!paypalEmail.trim() || !paypalEmail.includes('@')) {
        setError('Please provide a valid PayPal email address.');
        return;
      }
      paymentDetails = { paypalEmail: paypalEmail.trim() };
    }

    setSubmitting(true);

    try {
      const payload = {
        amountCoins: coinsToWithdraw,
        method: selectedMethod,
        paymentDetails,
        turnstileToken,
        idempotencyKey: generateUUID(),
      };

      const res = await createWithdrawal(payload);
      setSuccess(
        `🎉 Withdrawal of ${coinsToWithdraw.toLocaleString()} coins submitted! Coins have been safely locked pending review.`
      );
      setAmountCoins('');
      setTurnstileToken('');
      await loadData();
    } catch (err) {
      setError(err.message || 'Withdrawal failed. Please verify your details.');
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="container page-loading">
        <span className="spinner spinner-lg"></span>
        <p className="mt-3 text-muted">Loading country withdrawal gateway...</p>
      </div>
    );
  }

  const balance = info?.balance || 0;
  const inrBalance = (balance / 100).toFixed(2);
  const countryRules = info?.countryRules || {
    country: 'India',
    currency: 'INR',
    minAmount: 500,
    minCoins: 50000,
    methods: ['upi', 'bank'],
  };

  const hasPending = Boolean(info?.pendingRequest);
  const minCoins = countryRules.minCoins;
  const shortfall = Math.max(0, minCoins - balance);

  return (
    <div className="container withdraw-page">
      <div className="section-header">
        <h1 className="section-title">Withdraw Cash</h1>
        <p className="section-subtitle">
          Direct payouts with AES-256 encrypted storage and row-level ledger locking.
        </p>
      </div>

      {/* Country Minimums & Wallet Summary Bar */}
      <div className="withdraw-summary-grid">
        <div className="summary-pill">
          <span className="summary-pill-label">Available Balance</span>
          <span className="summary-pill-val font-mono text-accent">
            {balance.toLocaleString()} Coins
          </span>
          <span className="summary-pill-sub">≈ ₹{inrBalance} INR</span>
        </div>

        <div className="summary-pill">
          <span className="summary-pill-label">Detected Country & Min Floor</span>
          <span className="summary-pill-val font-mono">
            {countryRules.currency} {countryRules.minAmount}
          </span>
          <span className="summary-pill-sub">
            Minimum {minCoins.toLocaleString()} Coins ({countryRules.country})
          </span>
        </div>

        <div className="summary-pill">
          <span className="summary-pill-label">Active Payout Status</span>
          <span className="summary-pill-val">
            {hasPending ? (
              <span className="badge badge-warning">1 Pending in Queue</span>
            ) : shortfall > 0 ? (
              <span className="badge badge-danger">{shortfall.toLocaleString()} Coins Needed</span>
            ) : (
              <span className="badge badge-success">✓ Eligible for Payout</span>
            )}
          </span>
          <span className="summary-pill-sub">1 Pending request allowed at a time</span>
        </div>
      </div>

      {/* Active Pending Request Card (if exists) */}
      {hasPending && (
        <div className="pending-withdrawal-banner">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⏳</span>
            <div>
              <h4 className="font-bold text-white">Pending Withdrawal Active</h4>
              <p className="text-sm text-muted">
                You have an in-progress request for{' '}
                <strong>
                  {info.pendingRequest.amount_coins.toLocaleString()} Coins ({info.pendingRequest.currency}{' '}
                  {info.pendingRequest.amount_currency})
                </strong>{' '}
                submitted on {new Date(info.pendingRequest.created_at).toLocaleDateString()}. New
                withdrawals are paused until processed.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Withdrawal Form Card */}
      <div className="withdraw-card mt-6">
        <h3 className="withdraw-card-title">Create Withdrawal Request</h3>

        {error && (
          <div className="alert alert-error">
            <span>⚠️ {error}</span>
          </div>
        )}

        {success && (
          <div className="alert alert-success">
            <span>{success}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="withdraw-form">
          {/* Amount in Coins */}
          <div className="form-group">
            <div className="flex justify-between items-center mb-1">
              <label className="form-label">Amount in Coins *</label>
              <button
                type="button"
                onClick={() => setAmountCoins(balance.toString())}
                className="text-xs text-accent underline cursor-pointer"
              >
                Max ({balance.toLocaleString()})
              </button>
            </div>
            <input
              type="number"
              className="form-input"
              placeholder={`Min ${minCoins.toLocaleString()} coins`}
              value={amountCoins}
              onChange={(e) => setAmountCoins(e.target.value)}
              disabled={hasPending || shortfall > 0}
              min={minCoins}
              max={balance}
              required
            />
            {amountCoins && !isNaN(parseInt(amountCoins, 10)) && (
              <span className="form-hint text-success">
                Estimated Payout: ₹{(parseInt(amountCoins, 10) / 100).toFixed(2)} {countryRules.currency}
              </span>
            )}
          </div>

          {/* Payment Method Selector */}
          <div className="form-group">
            <label className="form-label">Payment Method *</label>
            <div className="method-pill-group">
              {countryRules.methods.map((method) => (
                <button
                  type="button"
                  key={method}
                  onClick={() => setSelectedMethod(method)}
                  className={`method-pill ${selectedMethod === method ? 'selected' : ''}`}
                >
                  <span className="uppercase font-bold">{method}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Dynamic Payment Fields */}
          {selectedMethod === 'upi' && (
            <div className="form-group">
              <label className="form-label">UPI ID (VPA) *</label>
              <input
                type="text"
                className="form-input"
                placeholder="yourname@okaxis, yourname@paytm"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                required
              />
            </div>
          )}

          {selectedMethod === 'bank' && (
            <div className="space-y-3">
              <div className="form-group">
                <label className="form-label">Account Holder Legal Name *</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="As per bank passbook"
                  value={accountHolder}
                  onChange={(e) => setAccountHolder(e.target.value)}
                  required
                />
              </div>
              <div className="grid-2-col">
                <div className="form-group">
                  <label className="form-label">Bank Account Number *</label>
                  <input
                    type="text"
                    className="form-input font-mono"
                    placeholder="e.g. 01234567890"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">IFSC Code *</label>
                  <input
                    type="text"
                    className="form-input font-mono uppercase"
                    placeholder="e.g. HDFC0001234"
                    value={ifsc}
                    onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                    required
                  />
                </div>
              </div>
            </div>
          )}

          {['jazzcash', 'easypaisa'].includes(selectedMethod) && (
            <div className="form-group">
              <label className="form-label">Mobile Account Number *</label>
              <input
                type="tel"
                className="form-input font-mono"
                placeholder="03XXXXXXXXX"
                value={mobileNumber}
                onChange={(e) => setMobileNumber(e.target.value)}
                required
              />
            </div>
          )}

          {selectedMethod === 'paypal' && (
            <div className="form-group">
              <label className="form-label">PayPal Email Address *</label>
              <input
                type="email"
                className="form-input"
                placeholder="yourpaypal@email.com"
                value={paypalEmail}
                onChange={(e) => setPaypalEmail(e.target.value)}
                required
              />
            </div>
          )}

          {/* Turnstile Bot Defense */}
          <div className="form-group">
            <TurnstileWidget
              onVerify={(token) => setTurnstileToken(token)}
              onError={() => setTurnstileToken('')}
            />
          </div>

          <button
            type="submit"
            disabled={hasPending || shortfall > 0 || submitting}
            className="btn btn-primary btn-lg w-full"
          >
            {submitting ? (
              <>
                <span className="spinner"></span> Locking Coins & Submitting...
              </>
            ) : hasPending ? (
              'Pending Withdrawal Active'
            ) : shortfall > 0 ? (
              `Minimum ${minCoins.toLocaleString()} Coins Required`
            ) : (
              'Submit Withdrawal Request ➔'
            )}
          </button>
        </form>
      </div>

      {/* User's Withdrawal History */}
      <div className="withdrawal-history-section mt-8">
        <h3>Your Withdrawal Records</h3>
        <div className="table-wrapper mt-3">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Coins</th>
                <th>Payout Amount</th>
                <th>Channel</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-muted py-6">
                    No withdrawal requests submitted yet.
                  </td>
                </tr>
              ) : (
                history.map((w) => (
                  <tr key={w.id}>
                    <td className="font-mono text-sm">
                      {new Date(w.created_at).toLocaleDateString()}
                    </td>
                    <td className="font-mono font-bold text-accent">
                      {w.amount_coins.toLocaleString()}
                    </td>
                    <td className="font-mono">
                      {w.currency} {w.amount_currency}
                    </td>
                    <td>
                      <span className="badge uppercase">{w.method}</span>
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
