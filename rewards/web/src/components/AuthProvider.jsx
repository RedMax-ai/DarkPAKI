'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { getMe, logout as apiLogout } from '../lib/api';

const AuthContext = createContext({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  isAdmin: false,
  login: () => {},
  logout: () => {},
  refreshUser: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

// Generate a resilient client-side device fingerprint
function getOrCreateDeviceFingerprint() {
  if (typeof window === 'undefined') return 'server_render';
  let fp = localStorage.getItem('rewards_device_fp');
  if (!fp) {
    const raw = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.hardwareConcurrency || 4,
    ].join('|');
    // Simple fast DJB2 hash
    let hash = 5381;
    for (let i = 0; i < raw.length; i++) {
      hash = (hash * 33) ^ raw.charCodeAt(i);
    }
    fp = 'fp_' + Math.abs(hash).toString(36) + '_' + Date.now().toString(36);
    localStorage.setItem('rewards_device_fp', fp);
  }
  return fp;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const data = await getMe();
      if (data && data.user) {
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (err) {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    getOrCreateDeviceFingerprint();
    refreshUser();
  }, [refreshUser]);

  const login = (userData) => {
    setUser(userData);
  };

  const logout = async () => {
    try {
      await apiLogout();
    } catch (e) {
      // Ignore network error on logout
    } finally {
      setUser(null);
      if (typeof window !== 'undefined') {
        window.location.href = '/';
      }
    }
  };

  const isAuthenticated = Boolean(user);
  const isAdmin = user?.role === 'admin';

  const googleClientId =
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || 'dummy-client-id.apps.googleusercontent.com';

  return (
    <GoogleOAuthProvider clientId={googleClientId}>
      <AuthContext.Provider
        value={{
          user,
          isLoading,
          isAuthenticated,
          isAdmin,
          login,
          logout,
          refreshUser,
        }}
      >
        {children}
      </AuthContext.Provider>
    </GoogleOAuthProvider>
  );
}
