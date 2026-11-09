const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const db = require('./db/database');
const seedDatabase = require('./db/seed');
const { apiLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');

// Initialize Express App
const app = express();

// Auto-seed database with default content if needed
seedDatabase();

// 1. Security Headers (Helmet) with custom CSP for media streaming, AI images & inline handlers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'", "*", "'unsafe-inline'", "'unsafe-eval'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https:", "http:"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https:", "http:"],
      fontSrc: ["'self'", "https:", "http:", "data:"],
      imgSrc: ["'self'", "data:", "https:", "http:", "blob:"],
      mediaSrc: ["'self'", "https:", "http:", "blob:"],
      connectSrc: ["'self'", "*", "https:", "http:"],
      frameSrc: ["'self'", "*", "https:", "http:"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: null
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// 2. Strict CORS Configuration
app.use(cors({
  origin: config.corsOrigin === '*' ? true : config.corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id', 'X-API-Key']
}));

// 3. Body Parser with Extended Payload Limit
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// 4. Rate Limiter on API Routes
app.use('/api', apiLimiter);

// 5. API Routes
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: 'SQLite WAL Active',
    environment: config.nodeEnv
  });
});

app.use('/api/videos', require('./routes/videoRoutes'));
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/earning', require('./routes/earningRoutes'));
app.use('/api/demands', require('./routes/demandRoutes'));
app.use('/api/contact', require('./routes/contactRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/ai', require('./routes/aiRoutes'));

// Monetag Service Worker for In-Page Push & Notification Ads
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.send(`/* Monetag Service Worker */ try { importScripts('https://monetag.com/sw.js'); } catch(e){}`);
});

// Search Engine Indexing (robots.txt & sitemap.xml)
app.get('/robots.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/admin/\nSitemap: https://dark.anizon.watch/sitemap.xml\n`);
});

app.get('/sitemap.xml', (req, res) => {
  res.setHeader('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://dark.anizon.watch/</loc>
    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`);
});

// ExoClick Site Verification
app.get('/0c17e0da78a5c5ca5650c8c1b10977c5.html', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send('0c17e0da78a5c5ca5650c8c1b10977c5');
});

// Serve index.html with Dynamic Monetag Verification Injection for Root Route
app.get('/', (req, res) => {
  try {
    const indexPath = path.resolve(__dirname, '../index.html');
    let html = fs.readFileSync(indexPath, 'utf-8');
    const monetagSetting = db.prepare("SELECT value FROM settings WHERE key = 'monetag_meta_tag'").get();
    if (monetagSetting && monetagSetting.value && monetagSetting.value.trim()) {
      let code = monetagSetting.value.trim();
      const match = code.match(/content=(?:&quot;|["'])(.*?)(?:&quot;|["'])/i);
      const cleanContent = match ? match[1] : code.replace(/<[^>]+>|&quot;|&lt;|&gt;/g, '').trim();
      if (cleanContent) {
        html = html.replace('</head>', `    <meta name="monetag" content="${cleanContent}">\n</head>`);
      }
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    res.sendFile(path.resolve(__dirname, '../index.html'));
  }
});

// Dedicated Admin Panel Route
app.get('/admin', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../public/admin.html'));
});

// 6. Serve Frontend Static Assets (excluding default index.html override)
app.use(express.static(path.resolve(__dirname, '../'), { index: false }));

// 7. Centralized Error Handler
app.use(errorHandler);

// Start HTTP Server
const server = app.listen(config.port, () => {
  console.log(`[DarkPAKI] Server running on port ${config.port} in ${config.nodeEnv} mode`);
  console.log(`[DarkPAKI] Full-Stack Database: ${config.dbPath}`);
  console.log(`[DarkPAKI] Local UI: http://localhost:${config.port}`);
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('[DarkPAKI] SIGTERM received. Gracefully shutting down...');
  server.close(() => {
    console.log('[DarkPAKI] Process terminated.');
    process.exit(0);
  });
});

module.exports = app;

