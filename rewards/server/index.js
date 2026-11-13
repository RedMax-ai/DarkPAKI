/**
 * DarkPaki Rewards Platform — Express.js Production API Server
 */
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const config = require('../config');
const { pool } = require('../db/pool');
const redis = require('../db/redis');
const { globalLimiter } = require('./middleware/rateLimiter');

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const referralRoutes = require('./routes/referral');
const withdrawalRoutes = require('./routes/withdrawal');
const adminRoutes = require('./routes/admin');

const app = express();

// Trust proxy for secure cookies and rate-limiting when behind reverse proxy
app.set('trust proxy', 1);

// ── 1. Security Headers (Helmet + Strict CSP) ─────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          'https://challenges.cloudflare.com',
          'https://accounts.google.com/gsi/client',
        ],
        frameSrc: [
          "'self'",
          'https://challenges.cloudflare.com',
          'https://accounts.google.com',
        ],
        connectSrc: [
          "'self'",
          'https://challenges.cloudflare.com',
          'https://accounts.google.com',
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:', 'https://*.googleusercontent.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.nodeEnv === 'production' ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  })
);

// ── 2. CORS (Strict Allowlist) ────────────────────────────────────────
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, or same-origin in development)
      if (!origin) return callback(null, true);
      if (config.corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Blocked by CORS policy'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Device-Fingerprint'],
    exposedHeaders: ['X-CSRF-Token'],
  })
);

// ── 3. Cookie & Body Parsing ─────────────────────────────────────────
app.use(cookieParser());
app.use(express.json({ limit: '100kb' }));

// ── 4. CSRF Protection (Double-Submit Cookie Pattern) ─────────────────
app.use((req, res, next) => {
  // Always ensure a CSRF cookie exists
  let csrfToken = req.cookies['_csrf'];
  if (!csrfToken) {
    csrfToken = crypto.randomBytes(32).toString('hex');
    res.cookie('_csrf', csrfToken, {
      httpOnly: false, // Accessible to client JS to read and echo in X-CSRF-Token header
      secure: config.nodeEnv === 'production',
      sameSite: 'strict',
      path: '/',
    });
  }

  // Exempt safe methods and login endpoint (initial unauthenticated handshake)
  const isSafeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const isExemptPath = req.path === '/api/auth/google';

  if (isSafeMethod || isExemptPath) {
    return next();
  }

  const clientCsrfToken = req.headers['x-csrf-token'];
  if (!clientCsrfToken || clientCsrfToken !== csrfToken) {
    return res.status(403).json({
      error: 'Invalid or missing CSRF token. Request blocked.',
      code: 'CSRF_INVALID',
    });
  }

  next();
});

// ── 5. Global Rate Limiter ───────────────────────────────────────────
app.use(globalLimiter);

// ── 6. Health & Diagnostics ──────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    const redisStatus = redis.status;
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      redis: redisStatus,
    });
  } catch (err) {
    res.status(503).json({
      status: 'unhealthy',
      error: 'Database connection failed',
    });
  }
});

// ── 7. Mount Core API Routes ─────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/referral', referralRoutes);
app.use('/api/withdrawal', withdrawalRoutes);
app.use('/api/admin', adminRoutes);

// ── 8. 404 Handler ───────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

// ── 9. Global Error Handler (Generic Output, No Leaks) ────────────────
app.use((err, req, res, next) => {
  // Internal logging for observability
  console.error('[API ERROR]', {
    method: req.method,
    path: req.path,
    message: err.message,
    stack: config.nodeEnv === 'development' ? err.stack : undefined,
  });

  // Never leak internal stack trace, SQL error, or secrets to the client
  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    error: err.userMessage || 'An unexpected error occurred. Please try again later.',
  });
});

// ── 10. Start Server & Graceful Shutdown ──────────────────────────────
let server;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(config.port, () => {
    console.log(`[Rewards API] Running on http://localhost:${config.port}`);
    console.log(`[Environment] ${config.nodeEnv}`);
  });

  const shutdown = async (signal) => {
    console.log(`[Rewards API] ${signal} received. Initiating graceful shutdown...`);
    if (server) {
      server.close(async () => {
        try {
          await pool.end();
          await redis.quit();
          console.log('[Rewards API] Cleanly closed DB and Redis connections.');
          process.exit(0);
        } catch (e) {
          console.error('[Rewards API] Error during shutdown:', e.message);
          process.exit(1);
        }
      });
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
