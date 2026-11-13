/** @type {import('next').NextConfig} */
const nextConfig = {
  /* ── Proxy all /api/* calls to the backend ── */
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:4000/api/:path*',
      },
    ];
  },

  /* ── Security & performance headers ── */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://accounts.google.com https://challenges.cloudflare.com",
              "style-src 'self' 'unsafe-inline' https://accounts.google.com",
              "frame-src https://accounts.google.com https://challenges.cloudflare.com",
              "img-src 'self' data: https://lh3.googleusercontent.com",
              "connect-src 'self' http://localhost:4000 https://accounts.google.com",
              "font-src 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },

  reactStrictMode: true,
};

export default nextConfig;
