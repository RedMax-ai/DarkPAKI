'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '../../components/AuthProvider';
import TurnstileWidget from '../../components/TurnstileWidget';
import { loginWithGoogle } from '../../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const { user, login } = useAuth();

  const [referralCode, setReferralCode] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // If already authenticated, redirect to dashboard
  useEffect(() => {
    if (user) {
      router.push('/dashboard');
    }
  }, [user, router]);

  // Read ?ref=... query parameter on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get('ref');
      if (ref) {
        setReferralCode(ref.toUpperCase());
      }
    }
  }, []);

  const handleGoogleSuccess = async (credentialResponse) => {
    setError('');

    if (!turnstileToken) {
      setError('Please complete the Cloudflare security verification check first.');
      return;
    }

    if (!credentialResponse?.credential) {
      setError('Google Sign-In failed to return credentials. Please retry.');
      return;
    }

    setIsLoading(true);

    try {
      const deviceFp =
        typeof window !== 'undefined'
          ? localStorage.getItem('rewards_device_fp') || 'fp_default'
          : 'fp_default';

      const payload = {
        credential: credentialResponse.credential,
        turnstileToken,
        deviceFingerprint: deviceFp,
        referralCode: referralCode.trim() || undefined,
      };

      const res = await loginWithGoogle(payload);

      if (res && res.user) {
        login(res.user);
        router.push('/dashboard');
      } else {
        setError('Authentication succeeded but profile could not be loaded.');
      }
    } catch (err) {
      setError(err.message || 'Login failed. Please check your credentials and retry.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleError = () => {
    setError('Google authentication was cancelled or failed.');
  };

  return (
    <div className="login-page-container">
      <div className="login-card">
        {/* Header */}
        <div className="login-header">
          <div className="login-logo-circle">⚡</div>
          <h2 className="login-title">Sign In with Google</h2>
          <p className="login-subtitle">
            Strict single-account binding per device & verified Gmail.
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="alert alert-error">
            <span className="alert-icon">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* Optional Referral Code Input */}
        <div className="form-group">
          <label className="form-label">
            Referral Code <span className="text-muted">(Optional)</span>
          </label>
          <input
            type="text"
            className="form-input"
            placeholder="e.g. DPK786ABC"
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
            maxLength={20}
          />
          <span className="form-hint">
            Entering a valid code awards your inviter ₹30 upon first activity.
          </span>
        </div>

        {/* Cloudflare Turnstile Bot Defense */}
        <div className="form-group">
          <label className="form-label text-center block mb-1">
            Bot & Anti-Cheat Verification
          </label>
          <TurnstileWidget
            onVerify={(token) => {
              setTurnstileToken(token);
              setError('');
            }}
            onError={() => {
              setTurnstileToken('');
              setError('Cloudflare Turnstile verification encountered an issue. Refresh if needed.');
            }}
          />
        </div>

        {/* Google One-Tap / Standard Button */}
        <div className="google-btn-wrapper">
          {isLoading ? (
            <div className="btn-loading-box">
              <span className="spinner"></span>
              <span>Authenticating with Server...</span>
            </div>
          ) : (
            <div className="flex justify-center">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={handleGoogleError}
                theme="filled_black"
                shape="pill"
                size="large"
                text="continue_with"
                width="300"
              />
            </div>
          )}
        </div>

        {/* Security Disclaimers */}
        <div className="login-footer-notes">
          <p>
            🔒 We never store or ask for your Google password. Server authentication uses Google
            official ID token verification with normalized email deduplication.
          </p>
        </div>
      </div>
    </div>
  );
}
