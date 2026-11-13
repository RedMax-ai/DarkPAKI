'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';

export default function Navbar() {
  const pathname = usePathname();
  const { user, isAuthenticated, isAdmin, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinks = [
    { href: '/', label: 'Home' },
    { href: '/dashboard', label: 'Dashboard', auth: true },
    { href: '/referral', label: 'Referral', auth: true },
    { href: '/withdraw', label: 'Withdraw', auth: true },
  ];

  if (isAdmin) {
    navLinks.push({ href: '/admin', label: 'Admin Panel', auth: true, admin: true });
  }

  return (
    <nav className="navbar">
      <div className="container nav-container">
        {/* Brand / Logo */}
        <Link href="/" className="nav-logo">
          <span className="logo-icon">⚡</span>
          <span className="logo-text">
            Rewards<span className="accent-text">Hub</span>
          </span>
        </Link>

        {/* Desktop Navigation Links */}
        <div className="nav-links">
          {navLinks.map((link) => {
            if (link.auth && !isAuthenticated) return null;
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`nav-link ${isActive ? 'active' : ''} ${link.admin ? 'admin-badge-link' : ''}`}
              >
                {link.admin && <span className="nav-admin-dot"></span>}
                {link.label}
              </Link>
            );
          })}
        </div>

        {/* User Status / Auth Actions */}
        <div className="nav-actions">
          {isAuthenticated ? (
            <div className="user-profile-menu">
              {user.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.name}
                  className="user-nav-avatar"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="user-nav-avatar-fallback">
                  {user.name?.charAt(0) || 'U'}
                </div>
              )}
              <div className="user-nav-meta">
                <span className="user-nav-name">{user.name}</span>
                {isAdmin && <span className="user-nav-badge">ADMIN</span>}
              </div>
              <button onClick={logout} className="btn btn-sm btn-outline">
                Sign Out
              </button>
            </div>
          ) : (
            <Link href="/login" className="btn btn-sm btn-primary">
              Sign In
            </Link>
          )}

          {/* Mobile Menu Hamburger */}
          <button
            className="mobile-hamburger"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle Navigation"
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="mobile-menu-drawer">
          {navLinks.map((link) => {
            if (link.auth && !isAuthenticated) return null;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`mobile-nav-link ${pathname === link.href ? 'active' : ''}`}
              >
                {link.label}
              </Link>
            );
          })}
          {!isAuthenticated && (
            <Link
              href="/login"
              onClick={() => setMobileMenuOpen(false)}
              className="btn btn-primary w-full mt-3"
            >
              Sign In with Google
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}
