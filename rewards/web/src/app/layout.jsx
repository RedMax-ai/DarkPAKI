import './globals.css';
import { AuthProvider } from '../components/AuthProvider';
import Navbar from '../components/Navbar';

export const metadata = {
  title: 'RewardsPlatform — Real Coins, Real Cash Withdrawals',
  description:
    'Earn coins by watching videos and referring friends. Withdraw directly to UPI, Bank, JazzCash, Easypaisa, or PayPal. 100% database-backed, append-only security.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://accounts.google.com" />
        <link rel="preconnect" href="https://challenges.cloudflare.com" />
      </head>
      <body>
        <AuthProvider>
          <div className="app-shell">
            <Navbar />
            <main className="main-content">{children}</main>
            <footer className="footer">
              <div className="container footer-container">
                <div className="footer-brand">
                  <span className="logo-icon">⚡</span>
                  <span className="logo-text">RewardsPlatform</span>
                  <p className="footer-tagline">
                    Append-Only Ledger Economy • 100 Coins = ₹1.00
                  </p>
                </div>
                <div className="footer-meta">
                  <span className="footer-sec-badge">🔒 AES-256 Encrypted</span>
                  <span className="footer-sec-badge">🛡️ Cloudflare Protected</span>
                  <span className="footer-sec-badge">⚡ Anti-Cheat Guard</span>
                </div>
              </div>
            </footer>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
