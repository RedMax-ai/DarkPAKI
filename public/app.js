/**
 * DarkPAKI 18+ VIP Full-Stack Client Application
 * Connects UI directly to real SQLite backend APIs with zero mocks.
 */

// Determine API Base URL
const API_BASE = (window.location.origin && window.location.origin.startsWith('http'))
  ? `${window.location.origin}/api`
  : 'http://localhost:5000/api';

// Authentication & Device Tokens
let AUTH_TOKEN = localStorage.getItem('darkpaki_auth_token') || null;
let ADMIN_TOKEN = localStorage.getItem('darkpaki_admin_token') || null;
let DEVICE_FINGERPRINT = localStorage.getItem('darkpaki_device_fp') || '';
let CAPTCHA_CHALLENGE_TOKEN = '';

// Application State
let MEDIA_SOURCES = {
  adVideo: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/WeAreGoingOnBullrun.mp4",
  mainVideos: []
};

let DEMAND_POLL_ITEMS = [];
let COMMENTS_FEED = [];
let TELEGRAM_CHANNEL_URL = "https://t.me/darkpaki_official";
let CURRENT_USER = null;

let currentCategoryFilter = 'ALL';
let currentCommentFilter = 'ALL';
let currentVideoIndex = 0;
let currentState = 'IDLE'; // 'IDLE' | 'AD_PLAYING' | 'MAIN_PLAYING'

let adCountdownInterval = null;
let adTotalSeconds = 15;
let adElapsedSeconds = 0;
let skipWaitSeconds = 5;
let allowInstantSkip = false;
let playbackSpeeds = [1, 1.25, 1.5, 2];
let currentSpeedIdx = 0;

// DOM Element References
const videoEl = document.getElementById('videoElement');
const initialOverlay = document.getElementById('initialOverlay');
const adOverlay = document.getElementById('adOverlay');
const mainVideoControls = document.getElementById('mainVideoControls');
const skipAdBtn = document.getElementById('skipAdBtn');
const skipAdText = document.getElementById('skipAdText');
const skipAdIcon = document.getElementById('skipAdIcon');
const adTimerText = document.getElementById('adTimerText');
const adProgressBar = document.getElementById('adProgressBar');
const videoScrubber = document.getElementById('videoScrubber');
const currentTimeDisplay = document.getElementById('currentTimeDisplay');
const durationDisplay = document.getElementById('durationDisplay');
const transitionToast = document.getElementById('transitionToast');
const toastMessage = document.getElementById('toastMessage');

const step1Badge = document.getElementById('step1Badge');
const step2Badge = document.getElementById('step2Badge');
const step3Badge = document.getElementById('step3Badge');

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================================
// 18+ AGE GATE VERIFICATION SYSTEM
// ============================================================================
function checkAgeGate() {
  const verified = localStorage.getItem('darkpaki_age_verified');
  const modal = document.getElementById('ageGateModal');
  if (modal) {
    if (verified === 'true') {
      modal.classList.add('hidden');
    } else {
      modal.classList.remove('hidden');
    }
  }
}

async function confirmAgeGate() {
  localStorage.setItem('darkpaki_age_verified', 'true');
  const modal = document.getElementById('ageGateModal');
  if (modal) modal.classList.add('hidden');
  
  try {
    await apiFetch('/auth/verify-age', {
      method: 'POST',
      body: JSON.stringify({ deviceId: DEVICE_FINGERPRINT, confirmed: true })
    });
  } catch (e) {
    console.warn('Age confirmation log notice:', e.message);
  }
  showToast('🔞 18+ Age Verified. Welcome to DarkPAKI VIP!');
}

function rejectAgeGate() {
  window.location.href = 'https://www.google.com';
}

function triggerAgeGateModal() {
  const modal = document.getElementById('ageGateModal');
  if (modal) modal.classList.remove('hidden');
}

function openLegalModal(type) {
  const modal = document.getElementById('legalPolicyModal');
  const title = document.getElementById('legalModalTitle');
  const body = document.getElementById('legalModalBody');
  if (!modal || !title || !body) return;

  if (type === 'dmca') {
    title.textContent = 'DMCA Copyright & Intellectual Property Policy';
    body.innerHTML = `
      <p class="font-bold text-white">DMCA Takedown Notice & Compliance</p>
      <p>DarkPAKI respects the intellectual property rights of creators and copyright holders. In accordance with the Digital Millennium Copyright Act (17 U.S.C. § 512), DarkPAKI maintains an active, responsive takedown process.</p>
      <p>DarkPAKI operates as a cloud media indexer and video streaming interface. We do not host non-compliant files on private bare-metal servers. All media streams are delivered via third-party CDN nodes or cloud providers.</p>
      <p class="font-bold text-white mt-2">Filing a Notification:</p>
      <p>If you believe your copyrighted work is accessible through this platform without authorization, submit a written notice containing:
      <br>1. Identification of the copyrighted work.
      <br>2. Direct URL or identifier of the stream link.
      <br>3. Your legal contact address, telephone number, and official email.
      <br>4. A statement of good faith belief that the contested use is not authorized by law.
      <br>5. A statement made under penalty of perjury that you are authorized to act on behalf of the owner.</p>
      <p>Submit notices directly to our designated compliance agent via Telegram: <a href="https://t.me/darkpaki_official" target="_blank" class="text-sky-400 underline">@darkpaki_official</a> or via our direct submission portal. Valid notices are processed within 24 to 48 hours.</p>
    `;
  } else if (type === 'privacy') {
    title.textContent = 'Privacy & Cookie Policy';
    body.innerHTML = `
      <p class="font-bold text-white">Privacy Protection & Information Handling</p>
      <p>Your privacy is important to us. This Privacy Policy outlines the minimal data collected to facilitate media streaming, device lock fraud prevention, and coin rewards.</p>
      <p><strong class="text-white">1. Device Identification:</strong> To prevent multiple account abuse and coin gaming, an anonymized hardware hash token (Device ID) is generated locally in your browser. No personal device identifiers (IMEI, MAC) are stored.</p>
      <p><strong class="text-white">2. Cookies & LocalStorage:</strong> We utilize browser LocalStorage exclusively for session continuity, age verification confirmation, and client theme settings. We do not sell user data to data brokers.</p>
      <p><strong class="text-white">3. Third-Party Advertisers:</strong> We partner with trusted third-party advertising networks (e.g., Monetag, ExoClick, Adsterra). These partners may use cookies to serve contextually relevant advertisements.</p>
      <p><strong class="text-white">4. User Rights:</strong> You may request complete erasure of your user profile, coin balance, or device binding at any time by contacting platform administration.</p>
    `;
  } else if (type === 'terms') {
    title.textContent = 'Terms of Service & User Agreement';
    body.innerHTML = `
      <p class="font-bold text-white">DarkPAKI Media Network Terms of Service</p>
      <p>By accessing or using DarkPAKI, you agree to be bound by these Terms of Service. If you do not agree, discontinue use immediately.</p>
      <p><strong class="text-white">1. Age Eligibility:</strong> Access to mature, age-restricted creator content is strictly limited to individuals who are at least 18 years of age or the age of majority in their jurisdiction. By clicking "Enter", you legally warrant compliance.</p>
      <p><strong class="text-white">2. Acceptable Use:</strong> Users shall not attempt to reverse engineer, DDOS, bypass rate limiters, or inject malicious payloads into DarkPAKI's streaming endpoints.</p>
      <p><strong class="text-white">3. Coin Rewards & Withdrawals:</strong> Coins earned through watch rewards and referrals are subject to anti-bot verification. Fraudulent multiple-account abuse will result in automatic balance forfeiture and device lock blacklisting.</p>
      <p><strong class="text-white">4. Disclaimer:</strong> All content streams are provided "AS IS" without warranty of continuous uninterrupted availability.</p>
    `;
  } else if (type === 'age') {
    title.textContent = 'Age Verification (18+) Compliance';
    body.innerHTML = `
      <p class="font-bold text-white">Mandatory Age Verification & Parental Controls</p>
      <p>DarkPAKI enforces strict age verification protocols to protect minors from unauthorized access to mature entertainment content.</p>
      <p>All adult content streams are isolated inside the VIP Vault and are accessible only after active electronic confirmation of age. If you share this device with minors, we recommend utilizing parental control software such as Net Nanny or Google Family Link.</p>
    `;
  }

  modal.classList.remove('hidden');
}

function closeLegalModal() {
  const modal = document.getElementById('legalPolicyModal');
  if (modal) modal.classList.add('hidden');
}

function toggleTheatreMode() {
  const container = document.getElementById('playerContainer');
  if (container) {
    container.classList.toggle('theatre-mode');
    showToast(container.classList.contains('theatre-mode') ? 'Cinema Theatre Mode Enabled' : 'Standard Mode Enabled');
  }
}

// ============================================================================
// NETWORK API HELPER (Standard Fetch with Device & Auth Headers)
// ============================================================================
async function apiFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Device-Id': DEVICE_FINGERPRINT,
    ...(options.headers || {})
  };

  if (options.isAdmin && ADMIN_TOKEN) {
    headers['Authorization'] = `Bearer ${ADMIN_TOKEN}`;
  } else if (AUTH_TOKEN) {
    headers['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  }

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers
    });

    const json = await res.json();
    if (!res.ok) {
      throw new Error(json.message || `Request failed with status ${res.status}`);
    }
    return json;
  } catch (err) {
    console.error(`[API ERROR] ${endpoint}:`, err);
    throw err;
  }
}

// ============================================================================
// AUTO DEVICE VIEWPORT & FINGERPRINT DETECTION
// ============================================================================
function autoDetectDeviceViewport() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const isMobile = w < 768 || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

  document.documentElement.style.setProperty('--app-vw', `${w}px`);
  document.documentElement.style.setProperty('--app-vh', `${h}px`);

  document.body.classList.toggle('is-mobile-device', isMobile);
  document.body.classList.toggle('is-desktop-device', !isMobile);

  const badge = document.getElementById('deviceScreenBadge');
  if (badge) {
    badge.textContent = `${isMobile ? '📱 Mobile 18+' : '💻 Desktop 4K'} • ${w}×${h}px`;
  }

  if (!DEVICE_FINGERPRINT) {
    const rawFp = `${navigator.platform}-${screen.width}x${screen.height}-${navigator.hardwareConcurrency || 4}-${Intl.DateTimeFormat().resolvedOptions().timeZone || 'IN'}`;
    let hash = 0;
    for (let i = 0; i < rawFp.length; i++) {
      hash = ((hash << 5) - hash) + rawFp.charCodeAt(i);
      hash |= 0;
    }
    DEVICE_FINGERPRINT = "DPK-" + Math.abs(hash).toString(16).toUpperCase().padStart(6, '0');
    localStorage.setItem('darkpaki_device_fp', DEVICE_FINGERPRINT);
  }

  const fpEl = document.getElementById('deviceFpBadge');
  if (fpEl) fpEl.textContent = `Device ID: ${DEVICE_FINGERPRINT}`;
}

window.addEventListener('resize', autoDetectDeviceViewport);

// ============================================================================
// DATA LOADERS FROM REAL BACKEND
// ============================================================================
let ACTIVE_POPUNDER_URL = '';

function setupPopunder(url) {
  if (!url || !url.startsWith('http')) return;
  ACTIVE_POPUNDER_URL = url;
  
  const popunderTrigger = () => {
    const lastPop = sessionStorage.getItem('dpk_last_popunder');
    const now = Date.now();
    // Fire popunder once every 10 minutes per visitor session
    if (!lastPop || (now - parseInt(lastPop)) > 10 * 60 * 1000) {
      sessionStorage.setItem('dpk_last_popunder', now.toString());
      try {
        const adTab = window.open(url, '_blank');
        if (adTab) {
          adTab.blur();
          window.focus();
        }
      } catch (e) {
        // Pop-up blocked, fall back silently
      }
    }
  };

  // Attach to first user click anywhere on page
  document.addEventListener('click', popunderTrigger, { once: true });
}

function renderBannerAd(html) {
  const slot = document.getElementById('adBannerSlot');
  const container = document.getElementById('adBannerContent');
  if (!slot || !container || !html || !html.trim()) return;

  container.innerHTML = html.trim();
  slot.classList.remove('hidden');

  // Re-run embedded script tags if any
  const scripts = container.querySelectorAll('script');
  scripts.forEach(oldScript => {
    const newScript = document.createElement('script');
    Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
    if (oldScript.src) {
      newScript.src = oldScript.src;
    } else {
      newScript.text = oldScript.innerHTML;
    }
    oldScript.parentNode.replaceChild(newScript, oldScript);
  });
}

async function loadAdConfig() {
  try {
    const res = await apiFetch('/videos/config');
    if (res.success && res.data) {
      MEDIA_SOURCES.adVideo = res.data.adVideoUrl;
      allowInstantSkip = res.data.allowInstantSkip;
      TELEGRAM_CHANNEL_URL = res.data.telegramUrl;

      if (res.data.popunderUrl) {
        setupPopunder(res.data.popunderUrl);
      }
      if (res.data.bannerAdHtml) {
        renderBannerAd(res.data.bannerAdHtml);
      }
      if (res.data.monetagMetaTag) {
        let meta = document.querySelector('meta[name="monetag"]');
        if (!meta) {
          meta = document.createElement('meta');
          meta.name = 'monetag';
          document.head.appendChild(meta);
        }
        const match = res.data.monetagMetaTag.match(/content=["']([^"']+)["']/i);
        meta.content = match ? match[1] : res.data.monetagMetaTag.replace(/<[^>]+>/g, '').trim();
      }
    }
  } catch (err) {
    console.warn('Using default ad configurations.');
  }
}

async function loadVideos(searchQuery = '') {
  try {
    let url = '/videos';
    const params = new URLSearchParams();
    if (currentCategoryFilter && currentCategoryFilter !== 'ALL') {
      params.append('tag', currentCategoryFilter);
    }
    if (searchQuery && searchQuery.trim()) {
      params.append('q', searchQuery.trim());
    }
    if (params.toString()) {
      url += `?${params.toString()}`;
    }

    const res = await apiFetch(url);
    if (res.success && Array.isArray(res.data)) {
      MEDIA_SOURCES.mainVideos = res.data.map(v => ({
        id: v.id,
        title: v.title,
        creator: v.creator,
        views: v.views,
        duration: v.duration,
        src: v.src,
        thumbImg: v.thumb_img,
        tag: v.tag,
        requestedBy: v.requested_by,
        isFeatured: v.is_featured
      }));
      renderFeaturedSpotlight();
      renderHomeVideoGrid(searchQuery);
      renderUpNextQueue();
    }
  } catch (err) {
    showToast('Failed to load videos from server.');
  }
}

async function loadDemands() {
  try {
    const res = await apiFetch('/demands/poll');
    if (res.success && Array.isArray(res.data)) {
      DEMAND_POLL_ITEMS = res.data;
      renderDemandPoll();
    }
  } catch (err) {
    console.warn('Failed to fetch demands:', err.message);
  }
}

async function loadComments() {
  try {
    const url = `/demands/comments?filter=${encodeURIComponent(currentCommentFilter)}`;
    const res = await apiFetch(url);
    if (res.success && Array.isArray(res.data)) {
      COMMENTS_FEED = res.data;
      renderCommentsFeed();
    }
  } catch (err) {
    console.warn('Failed to fetch comments:', err.message);
  }
}

async function loadCurrentUserProfile() {
  if (!AUTH_TOKEN) return;
  try {
    const res = await apiFetch('/auth/me');
    if (res.success && res.data) {
      CURRENT_USER = res.data;
      refreshEarningDashboardUI();
      updateHeaderProfileUI(CURRENT_USER);
    }
  } catch (err) {
    console.warn('Session expired or invalid.');
    AUTH_TOKEN = null;
    localStorage.removeItem('darkpaki_auth_token');
    CURRENT_USER = null;
    refreshEarningDashboardUI();
    updateHeaderProfileUI(null);
  }
}

async function generateHumanChallenge() {
  try {
    const res = await apiFetch('/auth/captcha');
    if (res.success && res.data) {
      CAPTCHA_CHALLENGE_TOKEN = res.data.challengeToken;
      const box = document.getElementById('captchaQuestionBox');
      if (box) box.textContent = res.data.question;
      const ans = document.getElementById('captchaAnswerInput');
      if (ans) ans.value = '';
    }
  } catch (err) {
    console.warn('Failed to generate server captcha.');
  }
}

// ============================================================================
// 1000X RENDERING FUNCTIONS (FEATURED SPOTLIGHT, HOME GRID & PLAYER QUEUE)
// ============================================================================
function renderFeaturedSpotlight() {
  const container = document.getElementById('featuredSpotlightContainer');
  if (!container) return;

  if (!MEDIA_SOURCES.mainVideos || MEDIA_SOURCES.mainVideos.length === 0) {
    container.innerHTML = '';
    return;
  }

  const featIndex = MEDIA_SOURCES.mainVideos.findIndex(v => v.isFeatured) >= 0 
    ? MEDIA_SOURCES.mainVideos.findIndex(v => v.isFeatured) 
    : 0;
  const video = MEDIA_SOURCES.mainVideos[featIndex];

  container.innerHTML = `
    <div onclick="launchFeaturedFromHome(${featIndex})" class="relative w-full rounded-2xl overflow-hidden border border-white/[0.08] hover:border-[#7C3AED]/50 group cursor-pointer shadow-2xl transition duration-300">
      <div class="aspect-[16/8] sm:aspect-[21/8] w-full bg-[#0B0E14] relative overflow-hidden">
        <img 
          src="${video.thumbImg || '/public/darkpaki-logo.png'}" 
          alt="${escapeHtml(video.title)}" 
          onerror="this.src='/public/darkpaki-logo.png'"
          class="w-full h-full object-cover group-hover:scale-105 transition duration-700 opacity-80"
        >
        <div class="absolute inset-0 bg-gradient-to-t from-[#0B0E14] via-[#0B0E14]/40 to-transparent"></div>

        <!-- Top Badges -->
        <div class="absolute top-3 left-3 flex flex-wrap items-center gap-1.5">
          <span class="bg-[#7C3AED] text-white text-[9px] sm:text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-lg shadow-[#7C3AED]/30">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            <span>#1 TRENDING</span>
          </span>
          <span class="bg-[#0B0E14]/80 backdrop-blur-md text-[#F8FAFC] border border-white/10 text-[9px] sm:text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full">
            4K 60FPS • Uncut
          </span>
          <span class="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[9px] sm:text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full">
            +20–30 Coins Bonus
          </span>
        </div>

        <!-- Center Floating Play Icon -->
        <div class="absolute right-4 bottom-4 w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-[#7C3AED] text-white flex items-center justify-center shadow-xl shadow-[#7C3AED]/50 group-hover:scale-110 transition">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        </div>

        <!-- Bottom Title Info -->
        <div class="absolute bottom-3 left-3.5 right-20">
          <span class="text-[9px] sm:text-[10px] font-mono font-semibold uppercase tracking-wider text-[#7C3AED]">${escapeHtml(video.tag || 'VIDEO')}</span>
          <h2 class="text-sm sm:text-xl font-bold text-[#F8FAFC] leading-tight line-clamp-1 mt-0.5">
            ${escapeHtml(video.title)}
          </h2>
          <p class="text-[10px] sm:text-[11px] text-[#94A3B8] mt-1 flex items-center gap-3">
            <span class="flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
              ${(video.views_count || video.views || 0).toLocaleString()}
            </span>
            <span class="font-mono">@${escapeHtml(video.creator || 'creator')}</span>
            <span class="hidden sm:inline text-amber-300">• 1 Short Ad → Full Video</span>
          </p>
        </div>
      </div>
    </div>
  `;
}

function renderHomeVideoGrid(searchQuery = '') {
  const grid = document.getElementById('homeVideoGrid');
  if (!grid) return;
  grid.innerHTML = '';

  if (!MEDIA_SOURCES.mainVideos || MEDIA_SOURCES.mainVideos.length === 0) {
    if (searchQuery && searchQuery.trim().length > 0) {
      grid.innerHTML = `
        <div class="col-span-2 bg-[#131822] border border-white/10 rounded-2xl p-6 text-center shadow-xl">
          <p class="text-xs sm:text-sm text-[#94A3B8]">No videos found matching "${escapeHtml(searchQuery)}"</p>
        </div>
      `;
    } else {
      grid.innerHTML = '';
    }
    return;
  }

  MEDIA_SOURCES.mainVideos.forEach((video, index) => {
    const card = document.createElement('div');
    card.className = "bg-[#131822] border border-white/[0.08] hover:border-[#7C3AED]/50 rounded-2xl p-2.5 group flex flex-col cursor-pointer select-none transition-all duration-300 shadow-xl";
    card.onclick = () => launchFeaturedFromHome(index);

    card.innerHTML = `
      <div class="relative w-full aspect-video bg-[#0B0E14] rounded-xl overflow-hidden mb-2.5">
        <img 
          src="${video.thumbImg || '/public/darkpaki-logo.png'}" 
          alt="${escapeHtml(video.title)}" 
          onerror="this.src='/public/darkpaki-logo.png'"
          class="w-full h-full object-cover group-hover:scale-105 transition duration-500 ease-out"
        >
        <div class="absolute inset-0 bg-gradient-to-t from-[#0B0E14]/90 via-transparent to-transparent"></div>
        
        <!-- Top Badges -->
        <div class="absolute top-2 left-2 flex items-center gap-1">
          <span class="bg-[#7C3AED] text-white text-[9px] font-bold uppercase px-2 py-0.5 rounded-md shadow-md">
            18+
          </span>
          <span class="bg-[#0B0E14]/80 text-amber-300 text-[9px] font-mono font-semibold uppercase px-1.5 py-0.5 rounded-md border border-white/10">
            4K
          </span>
        </div>

        <span class="absolute top-2 right-2 bg-[#0B0E14]/80 backdrop-blur-md text-white text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md border border-white/10">
          ${video.duration || '4K'}
        </span>

        <!-- Hover Center Electric Violet Play Icon -->
        <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition duration-300 bg-[#0B0E14]/40">
          <div class="w-11 h-11 rounded-xl bg-[#7C3AED] text-white flex items-center justify-center shadow-xl shadow-[#7C3AED]/50 transform scale-90 group-hover:scale-100 transition">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          </div>
        </div>

        <!-- Bottom Views -->
        <div class="absolute bottom-1.5 left-2.5 right-2.5 flex items-center justify-between text-[10px] text-[#94A3B8]">
          <span class="flex items-center gap-1 font-mono">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            ${(video.views_count || video.views || 0).toLocaleString()}
          </span>
          <span class="text-emerald-400 font-mono text-[9px]">+20-30 Coins</span>
        </div>
      </div>

      <div class="px-1 pb-1 flex flex-col flex-1 justify-between gap-2">
        <div>
          <span class="text-[9px] font-mono uppercase font-semibold text-[#7C3AED] block mb-0.5">${escapeHtml(video.tag || 'VIDEO')}</span>
          <h4 class="text-xs sm:text-sm font-semibold text-[#F8FAFC] group-hover:text-[#7C3AED] transition leading-snug line-clamp-2">
            ${escapeHtml(video.title)}
          </h4>
        </div>
        <div class="pt-2 border-t border-white/[0.06] flex items-center justify-between gap-2 text-xs">
          <div class="flex items-center gap-1.5 min-w-0">
            <div class="w-5 h-5 rounded-md bg-[#7C3AED]/20 text-[#7C3AED] font-bold text-[9px] flex items-center justify-center shrink-0 border border-[#7C3AED]/30">
              ${(video.creator || 'D')[0].toUpperCase()}
            </div>
            <div class="truncate">
              <p class="text-[11px] font-semibold text-[#F8FAFC] truncate flex items-center gap-1">
                <span>@${escapeHtml(video.creator || 'creator')}</span>
                ${video.is_monetized ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-amber-400 shrink-0"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>' : ''}
              </p>
            </div>
          </div>
          <button onclick="toggleFollowCreator('${escapeHtml(video.creator || 'creator')}', event)" data-creator-follow="${escapeHtml(video.creator || 'creator')}" class="shrink-0 bg-[#0B0E14] hover:bg-[#7C3AED] hover:text-[#F8FAFC] text-[#94A3B8] border border-white/[0.08] px-2.5 py-1 rounded-lg text-[10px] font-semibold transition">
            + Follow
          </button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
}

function renderUpNextQueue() {
  const container = document.getElementById('upNextList');
  if (!container) return;
  container.innerHTML = '';

  MEDIA_SOURCES.mainVideos.forEach((item, index) => {
    const isCurrent = index === currentVideoIndex;
    const card = document.createElement('div');
    card.className = `neon-card group flex flex-col rounded-2xl p-2.5 border cursor-pointer transition ${isCurrent ? 'border-rose-500 bg-rose-500/10' : 'border-white/10'}`;
    card.onclick = () => launchFeaturedFromHome(index);
    card.innerHTML = `
      <div class="relative w-full aspect-[16/10] bg-neutral-900 rounded-xl overflow-hidden mb-2">
        <img 
          src="${item.thumbImg}" 
          alt="${item.title}"
          onerror="this.src='https://placehold.co/600x400/121218/f43f5e?text=18%2B+Video'"
          class="w-full h-full object-cover group-hover:scale-105 transition duration-500"
        >
        <span class="absolute bottom-1.5 right-1.5 bg-black/85 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded">
          ${item.duration}
        </span>
        ${isCurrent ? '<span class="absolute top-1.5 left-1.5 bg-rose-600 text-white text-[9px] font-black px-2 py-0.5 rounded shadow">NOW PLAYING</span>' : '<span class="absolute top-1.5 left-1.5 bg-black/80 text-rose-400 text-[9px] font-black px-1.5 py-0.5 rounded border border-rose-500/40">18+</span>'}
      </div>
      <span class="text-[10px] font-black uppercase tracking-wide text-rose-400 px-1">${item.tag}</span>
      <h4 class="text-xs sm:text-sm font-bold text-white group-hover:text-rose-400 line-clamp-2 mt-0.5 px-1">
        ${item.title}
      </h4>
    `;
    container.appendChild(card);
  });
}

// ============================================================================
// STEPPER & CINEMA PLAYER CORE (1 Ad -> Full HD Stream)
// ============================================================================
function updateStepperUI(stage) {
  const activeClass = "px-3 py-1 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/50 flex items-center gap-1.5 font-bold";
  const adActiveClass = "px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/50 flex items-center gap-1.5 font-bold";
  const doneClass = "px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5 font-bold";
  const inactiveClass = "px-3 py-1 rounded-full bg-slate-900 text-slate-400 border border-slate-800 flex items-center gap-1.5";

  if (stage === 'IDLE') {
    if (step1Badge) step1Badge.className = activeClass;
    if (step2Badge) step2Badge.className = inactiveClass;
    if (step3Badge) step3Badge.className = inactiveClass;
  } else if (stage === 'AD_PLAYING') {
    if (step1Badge) step1Badge.className = doneClass;
    if (step2Badge) step2Badge.className = adActiveClass;
    if (step3Badge) step3Badge.className = inactiveClass;
  } else if (stage === 'MAIN_PLAYING') {
    if (step1Badge) step1Badge.className = doneClass;
    if (step2Badge) step2Badge.className = doneClass;
    if (step3Badge) step3Badge.className = activeClass;
  }
}

let isFullRewardAdMode = false;

function startAdExperience(isFullReward = false) {
  clearInterval(adCountdownInterval);
  currentState = 'AD_PLAYING';
  isFullRewardAdMode = isFullReward;
  updateStepperUI('AD_PLAYING');

  initialOverlay.classList.add('hidden');
  mainVideoControls.classList.add('hidden');
  adOverlay.classList.remove('hidden');

  videoEl.src = MEDIA_SOURCES.adVideo;
  videoEl.load();
  videoEl.currentTime = 0;
  videoEl.play().catch(() => {
    videoEl.muted = true;
    updateMuteIcons();
    videoEl.play().catch(() => {});
  });

  adElapsedSeconds = 0;
  // Per video 5-10 sec skip (default 6s); Full Reward Ad = full 30 seconds
  if (isFullReward) {
    adTotalSeconds = 30;
    skipWaitSeconds = 30;
  } else {
    adTotalSeconds = 15;
    skipWaitSeconds = 6; // 6 seconds before skip unlocks video
  }
  updateAdSkipButtonState();

  adCountdownInterval = setInterval(() => {
    if (videoEl.paused) return;

    adElapsedSeconds += 0.25;
    const remaining = Math.max(0, Math.ceil(adTotalSeconds - adElapsedSeconds));
    if (adTimerText) adTimerText.textContent = `0:${remaining < 10 ? '0' + remaining : remaining}`;

    const progressPercent = Math.min(100, (adElapsedSeconds / adTotalSeconds) * 100);
    if (adProgressBar) adProgressBar.style.width = `${progressPercent}%`;

    updateAdSkipButtonState();

    if (adElapsedSeconds >= adTotalSeconds) {
      clearInterval(adCountdownInterval);
      const msg = isFullRewardAdMode 
        ? "30s Full Sponsor Ad complete! +30 Coins & Cash reward unlocked!"
        : "Ad completed! Starting 18+ 4K feature stream...";
      transitionToMainVideo(msg);
    }
  }, 250);
}

function updateAdSkipButtonState() {
  if (isFullRewardAdMode) {
    const remaining = Math.max(0, Math.ceil(30 - adElapsedSeconds));
    if (remaining > 0) {
      skipAdBtn.disabled = true;
      skipAdBtn.className = "bg-slate-900/90 text-slate-300 border border-slate-600/80 px-5 py-3 rounded-2xl text-xs sm:text-sm font-semibold backdrop-blur-md flex items-center gap-2.5 shadow-2xl transition-all cursor-not-allowed opacity-90";
      skipAdText.textContent = `Full Ad: Unlocks in ${remaining}s`;
      skipAdIcon.className = "fa-solid fa-hourglass-half text-xs";
    } else {
      skipAdBtn.disabled = false;
      skipAdBtn.className = "bg-gradient-to-r from-emerald-500 to-green-600 hover:brightness-110 text-white font-black px-5 py-3 rounded-2xl text-xs sm:text-sm flex items-center gap-2.5 shadow-2xl transition-all transform hover:scale-105 cursor-pointer";
      skipAdText.textContent = "Claim Reward & Unlock Video";
      skipAdIcon.className = "fa-solid fa-gift text-xs";
    }
    return;
  }

  const requiredWait = allowInstantSkip ? 0 : skipWaitSeconds;
  const waitRemaining = Math.ceil(requiredWait - adElapsedSeconds);

  if (waitRemaining <= 0) {
    skipAdBtn.disabled = false;
    skipAdBtn.className = "bg-gradient-to-r from-amber-400 to-amber-500 hover:brightness-110 text-slate-950 font-black px-5 py-3 rounded-2xl text-xs sm:text-sm flex items-center gap-2.5 shadow-2xl transition-all transform hover:scale-105 cursor-pointer";
    skipAdText.textContent = "Skip Ad & Unlock Video";
    skipAdIcon.className = "fa-solid fa-forward-step text-xs";
  } else {
    skipAdBtn.disabled = true;
    skipAdBtn.className = "bg-slate-900/90 text-slate-300 border border-slate-600/80 px-5 py-3 rounded-2xl text-xs sm:text-sm font-semibold backdrop-blur-md flex items-center gap-2.5 shadow-2xl transition-all cursor-not-allowed opacity-90";
    skipAdText.textContent = `Skip Ad in ${waitRemaining}s`;
    skipAdIcon.className = "fa-solid fa-hourglass-half text-xs";
  }
}

function skipAdAndPlayVideo() {
  if (skipAdBtn.disabled) return;
  clearInterval(adCountdownInterval);
  transitionToMainVideo("Ad skipped! Playing 18+ main video...");
}

async function transitionToMainVideo(message) {
  currentState = 'MAIN_PLAYING';
  updateStepperUI('MAIN_PLAYING');

  adOverlay.classList.add('hidden');
  mainVideoControls.classList.remove('hidden');

  // Trigger real persistent watch earning bonus on backend
  await creditWatchEarningBonus(false);
  const curVid = MEDIA_SOURCES.mainVideos[currentVideoIndex];
  if (curVid && curVid.id) {
    fetch('/api/videos/' + curVid.id + '/view', { method: 'POST' }).catch(() => {});
  }

  showToast(message);

  const selectedVideo = MEDIA_SOURCES.mainVideos[currentVideoIndex];
  if (selectedVideo) {
    document.getElementById('videoTitle').textContent = selectedVideo.title;
    videoEl.src = selectedVideo.src;
    videoEl.load();
    videoEl.currentTime = 0;
    videoEl.playbackRate = playbackSpeeds[currentSpeedIdx];
    videoEl.play().catch(() => {});
  }
  updatePlayPauseIcons();
}

// Scrubber & Completion Event Listeners
if (videoEl) {
  videoEl.addEventListener('timeupdate', () => {
    if (currentState !== 'MAIN_PLAYING') return;
    if (videoEl.duration) {
      const pct = (videoEl.currentTime / videoEl.duration) * 100;
      if (videoScrubber) videoScrubber.value = pct;
      if (currentTimeDisplay) currentTimeDisplay.textContent = formatTime(videoEl.currentTime);
      if (durationDisplay) durationDisplay.textContent = formatTime(videoEl.duration);
    }
  });

  videoEl.addEventListener('ended', () => {
    if (currentState === 'AD_PLAYING') {
      clearInterval(adCountdownInterval);
      transitionToMainVideo("Ad finished! Playing 18+ main video...");
    } else if (currentState === 'MAIN_PLAYING') {
      updatePlayPauseIcons();
      showToast("Stream ended! Click 'Replay 1-Ad Flow' to test again.");
    }
  });
}

function togglePlayPause() {
  if (videoEl.paused) {
    videoEl.play();
  } else {
    videoEl.pause();
  }
  updatePlayPauseIcons();
}

function updatePlayPauseIcons() {
  const isPaused = videoEl.paused;
  const cIcon = document.getElementById('centerPlayIcon');
  const bIcon = document.getElementById('bottomPlayIcon');
  if (cIcon) cIcon.className = `fa-solid ${isPaused ? 'fa-play ml-1' : 'fa-pause'} text-xl`;
  if (bIcon) bIcon.className = `fa-solid ${isPaused ? 'fa-play' : 'fa-pause'}`;
}

function seekVideo(val) {
  if (currentState !== 'MAIN_PLAYING' || !videoEl.duration) return;
  videoEl.currentTime = (val / 100) * videoEl.duration;
}

function skipSeconds(sec) {
  if (currentState !== 'MAIN_PLAYING') return;
  videoEl.currentTime = Math.max(0, Math.min(videoEl.duration || 0, videoEl.currentTime + sec));
}

function toggleMute() {
  videoEl.muted = !videoEl.muted;
  updateMuteIcons();
}

function updateMuteIcons() {
  const iconClass = videoEl.muted ? 'fa-solid fa-volume-xmark text-rose-400' : 'fa-solid fa-volume-high';
  const aIcon = document.getElementById('adMuteIcon');
  const mIcon = document.getElementById('mainMuteIcon');
  if (aIcon) aIcon.className = iconClass + ' text-sm';
  if (mIcon) mIcon.className = iconClass;
}

function cyclePlaybackSpeed() {
  currentSpeedIdx = (currentSpeedIdx + 1) % playbackSpeeds.length;
  const speed = playbackSpeeds[currentSpeedIdx];
  videoEl.playbackRate = speed;
  const btn = document.getElementById('speedBtn');
  if (btn) btn.textContent = `${speed}x`;
}

function toggleFullscreen() {
  const container = document.getElementById('playerContainer');
  if (!document.fullscreenElement) {
    container.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

function resetToAdFlow() {
  clearInterval(adCountdownInterval);
  videoEl.pause();
  currentState = 'IDLE';
  updateStepperUI('IDLE');
  adOverlay.classList.add('hidden');
  mainVideoControls.classList.add('hidden');
  initialOverlay.classList.remove('hidden');
  showToast("Reset to 1-Ad state. Click Play to start!");
}

function launchFeaturedFromHome(index) {
  currentVideoIndex = index;
  const selected = MEDIA_SOURCES.mainVideos[index];
  if (!selected) return;

  updateWatchPlayerDetails(selected);

  const posterImg = document.getElementById('playerPosterImg');
  if (posterImg) posterImg.src = selected.thumbImg;
  const posterDur = document.getElementById('posterTotalDuration');
  if (posterDur) posterDur.textContent = selected.duration;

  renderHomeVideoGrid();
  renderUpNextQueue();
  switchView('watch');
  resetToAdFlow();
  if (selected && selected.id) {
    fetch('/api/videos/' + selected.id + '/view', { method: 'POST' }).catch(() => {});
  }
}

async function updateWatchPlayerDetails(selected) {
  if (!selected) return;

  const titleEl = document.getElementById('videoTitle');
  if (titleEl) titleEl.textContent = selected.title || 'DarkPAKI 4K VIP Cinema Player';

  const catEl = document.getElementById('videoCategoryPill');
  if (catEl) catEl.textContent = selected.tag || 'VIP 4K STREAM';

  const demandEl = document.getElementById('videoDemandTag');
  if (demandEl) demandEl.textContent = `🎬 Ultra HD Cinema Quality`;

  const viewDesc = document.getElementById('watchViewCountDesc');
  if (viewDesc) {
    const rawViews = selected.views_count || selected.views || 0;
    viewDesc.textContent = `${formatViewCount(rawViews)} views`;
  }

  const channelName = document.getElementById('watchChannelName');
  const chName = selected.creator || selected.owner_name || 'DarkPAKI VIP';
  if (channelName) channelName.textContent = chName;

  const channelSubs = document.getElementById('watchChannelSubs');
  if (channelSubs) {
    channelSubs.textContent = `${formatViewCount(selected.followers_count || 0)} followers`;
  }

  const channelAvatar = document.getElementById('watchChannelAvatar');
  if (channelAvatar) {
    channelAvatar.src = selected.creator_avatar || '/public/darkpaki-logo.png';
  }

  // Earnings calculation: 25 coins per view, 1000 coins = $0.11 USD
  const viewsNum = parseInt(selected.views_count, 10) || parseInt(selected.views, 10) || 0;
  const coins = selected.earnings?.coins !== undefined ? selected.earnings.coins : (viewsNum * 25);
  const usd = selected.earnings?.usd !== undefined ? selected.earnings.usd : ((coins / 1000) * 0.11).toFixed(2);

  const earningsText = document.getElementById('watchVideoEarningsText');
  if (earningsText) {
    earningsText.textContent = `$${usd} (${formatViewCount(coins)} Coins)`;
  }

  const likesCount = document.getElementById('watchLikesCount');
  if (likesCount) {
    likesCount.textContent = formatViewCount(selected.likes_count || 0);
  }

  // Fetch reactions & follow status from backend
  if (selected.id) {
    try {
      const res = await apiFetch(`/api/videos/${selected.id}/reactions?deviceId=${encodeURIComponent(DEVICE_FINGERPRINT)}`);
      if (res && res.success && res.data) {
        updateReactionButtonsUI(res.data.userReaction, res.data.likesCount, res.data.dislikesCount);
        if (res.data.earnings && earningsText) {
          earningsText.textContent = `$${res.data.earnings.usd} (${formatViewCount(res.data.earnings.coins)} Coins)`;
        }
      }
    } catch (e) {}
  }
}

async function handleVideoReaction(type) {
  const selected = MEDIA_SOURCES.mainVideos[currentVideoIndex];
  if (!selected || !selected.id) return;

  try {
    const res = await apiFetch(`/api/videos/${selected.id}/react`, {
      method: 'POST',
      body: JSON.stringify({ reaction: type, deviceId: DEVICE_FINGERPRINT })
    });
    if (res && res.success && res.data) {
      selected.likes_count = res.data.likesCount;
      selected.dislikes_count = res.data.dislikesCount;
      if (res.data.earnings) {
        selected.earnings = res.data.earnings;
      }
      updateReactionButtonsUI(res.data.userReaction, res.data.likesCount, res.data.dislikesCount);
      if (res.data.earnings) {
        const earnEl = document.getElementById('watchVideoEarningsText');
        if (earnEl) earnEl.textContent = `$${res.data.earnings.usd} (${formatViewCount(res.data.earnings.coins)} Coins)`;
      }
    }
  } catch (err) {
    showToast(err.message || 'Failed to update reaction');
  }
}

function updateReactionButtonsUI(userReaction, likesCount, dislikesCount) {
  const likeBtn = document.getElementById('watchLikeBtn');
  const dislikeBtn = document.getElementById('watchDislikeBtn');
  const likesCountEl = document.getElementById('watchLikesCount');
  const likeIcon = document.getElementById('watchLikeIcon');
  const dislikeIcon = document.getElementById('watchDislikeIcon');

  if (likesCountEl && likesCount !== undefined) {
    likesCountEl.textContent = formatViewCount(likesCount);
  }

  if (likeBtn && likeIcon) {
    if (userReaction === 'like') {
      likeBtn.classList.add('text-[#7C3AED]', 'bg-[#7C3AED]/20');
      likeBtn.classList.remove('text-[#94A3B8]');
      likeIcon.setAttribute('fill', 'currentColor');
    } else {
      likeBtn.classList.remove('text-[#7C3AED]', 'bg-[#7C3AED]/20');
      likeBtn.classList.add('text-[#94A3B8]');
      likeIcon.setAttribute('fill', 'none');
    }
  }

  if (dislikeBtn && dislikeIcon) {
    if (userReaction === 'dislike') {
      dislikeBtn.classList.add('text-[#7C3AED]', 'bg-[#7C3AED]/20');
      dislikeBtn.classList.remove('text-[#94A3B8]');
      dislikeIcon.setAttribute('fill', 'currentColor');
    } else {
      dislikeBtn.classList.remove('text-[#7C3AED]', 'bg-[#7C3AED]/20');
      dislikeBtn.classList.add('text-[#94A3B8]');
      dislikeIcon.setAttribute('fill', 'none');
    }
  }
}

async function toggleWatchCreatorFollow() {
  const selected = MEDIA_SOURCES.mainVideos[currentVideoIndex];
  if (!selected) return;
  const creatorName = selected.creator || selected.owner_name || 'DarkPAKI VIP';
  try {
    const res = await apiFetch('/api/earning/follow', {
      method: 'POST',
      body: JSON.stringify({ creatorName, deviceId: DEVICE_FINGERPRINT })
    });
    if (res && res.success) {
      selected.followers_count = res.followersCount;
      updateWatchFollowButton(res.isFollowing, res.followersCount);
      showToast(res.message);
    }
  } catch (err) {
    showToast(err.message || 'Error updating follow status');
  }
}

function updateWatchFollowButton(isFollowing, count) {
  const btn = document.getElementById('watchFollowBtn');
  const subsEl = document.getElementById('watchChannelSubs');
  if (subsEl && count !== undefined) {
    subsEl.textContent = `${formatViewCount(count)} followers`;
  }
  if (!btn) return;
  if (isFollowing) {
    btn.className = "ml-1 sm:ml-2 px-4 py-1.5 rounded-full text-xs font-semibold bg-[#1F2430] text-[#94A3B8] border border-white/10 hover:border-white/20 active:scale-95 transition shadow-sm flex items-center gap-1";
    btn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-400">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span id="watchFollowBtnText">Following</span>
    `;
  } else {
    btn.className = "ml-1 sm:ml-2 px-4 py-1.5 rounded-full text-xs font-semibold bg-[#F8FAFC] text-[#0B0E14] hover:bg-neutral-200 active:scale-95 transition shadow-sm flex items-center gap-1";
    btn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
      <span id="watchFollowBtnText">Follow</span>
    `;
  }
}

function shareCurrentVideo() {
  const selected = MEDIA_SOURCES.mainVideos[currentVideoIndex];
  const url = window.location.origin + (selected && selected.id ? `?v=${selected.id}` : '');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      showToast("Video link copied to clipboard!");
    }).catch(() => {
      showToast(url);
    });
  } else {
    showToast("Share URL: " + url);
  }
}

async function toggleSaveCurrentVideo() {
  const token = localStorage.getItem('darkpaki_auth_token');
  if (!token) {
    showToast("Please log in to save videos to your collection.");
    switchView('login');
    return;
  }
  const selected = MEDIA_SOURCES.mainVideos[currentVideoIndex];
  if (!selected || !selected.id) return;

  const saveText = document.getElementById('watchSaveText');
  const saveIcon = document.getElementById('watchSaveIcon');
  const isCurrentlySaved = saveText && saveText.textContent === 'Saved';

  try {
    if (isCurrentlySaved) {
      const res = await apiFetch(`/api/profile/save-video/${selected.id}`, { method: 'DELETE' });
      if (res && res.success) {
        if (saveText) saveText.textContent = 'Save';
        if (saveIcon) saveIcon.setAttribute('fill', 'none');
        showToast(res.message || "Video removed from saved collection.");
      }
    } else {
      const res = await apiFetch('/api/profile/save-video', {
        method: 'POST',
        body: JSON.stringify({ videoId: selected.id })
      });
      if (res && res.success) {
        if (saveText) saveText.textContent = 'Saved';
        if (saveIcon) saveIcon.setAttribute('fill', 'currentColor');
        showToast(res.message || "Video saved to your collection!");
      }
    }
  } catch (err) {
    showToast(err.message || "Error updating saved collection.");
  }
}

function handleVideoSourceError(vid) {
  console.warn("Video source failed, switching to backup stream.");
  vid.src = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4";
  vid.load();
  vid.play().catch(() => {});
}

// ============================================================================
// REAL GMAIL AUTH, GOOGLE reCAPTCHA v2 & 1-DEVICE POLICY GATE
// ============================================================================
let GOOGLE_CLIENT_ID = window.GOOGLE_CLIENT_ID || '820053333329-6hdq4c0hnr72lbms7mgu7spbd4rd3tc1.apps.googleusercontent.com';
let CF_TURNSTILE_SITE_KEY = '0x4AAAAAAF_8PdMI9qhkYmZq';
let CF_TURNSTILE_TOKEN = '';
let CF_WIDGET_ID = null;
let GOOGLE_RECAPTCHA_TOKEN = '';
let RECAPTCHA_WIDGET_ID = null;
let RECAPTCHA_SITE_KEY = '6LeYcCAuAAAAANSHhTdxEmvZ4X29vMHERczd_uAK';

// Global callback for Cloudflare Turnstile explicit script load
window.onCloudflareTurnstileLoad = function() {
  renderCloudflareTurnstile();
};

// Global fallback callback for Google reCAPTCHA
window.onGoogleRecaptchaLoad = function() {
  renderCloudflareTurnstile();
};

// Dedicated 18+ & Single-Device Policy Modal Controls
function openSingleDevicePolicyModal() {
  const modal = document.getElementById('singleDevicePolicyModal');
  if (modal) modal.classList.remove('hidden');
}

function closeSingleDevicePolicyModal() {
  const modal = document.getElementById('singleDevicePolicyModal');
  if (modal) modal.classList.add('hidden');
}

function acceptTermsFromModal() {
  const checkbox = document.getElementById('humanConfirmCheckbox');
  if (checkbox) {
    checkbox.checked = true;
    onTermsCheckboxChange();
  }
  closeSingleDevicePolicyModal();
  showToast('✓ 18+ Age & Single-Device Agreement Confirmed! Login Unlocked.', 'success');
}

function onTermsCheckboxChange() {
  const checkbox = document.getElementById('humanConfirmCheckbox');
  const termsCard = document.getElementById('termsAgreementCard');
  const googleBtn = document.getElementById('googleSignInActionBtn');
  const googleLock = document.getElementById('googleLockIcon');
  const isChecked = checkbox && checkbox.checked;

  if (isChecked) {
    if (termsCard) {
      termsCard.classList.remove('border-rose-500/40');
      termsCard.classList.add('border-emerald-500/60', 'bg-emerald-950/20');
    }
    if (googleLock) {
      googleLock.className = 'fa-solid fa-circle-check text-emerald-500 text-xs';
    }
    if (googleBtn) {
      googleBtn.classList.remove('opacity-70');
    }
  } else {
    if (termsCard) {
      termsCard.classList.remove('border-emerald-500/60', 'bg-emerald-950/20');
      termsCard.classList.add('border-rose-500/40');
    }
    if (googleLock) {
      googleLock.className = 'fa-solid fa-lock text-neutral-400 text-xs';
    }
  }
}

function highlightTermsCard() {
  const termsCard = document.getElementById('termsAgreementCard');
  if (termsCard) {
    termsCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    termsCard.classList.add('ring-4', 'ring-rose-500', 'animate-pulse');
    setTimeout(() => {
      termsCard.classList.remove('ring-4', 'ring-rose-500', 'animate-pulse');
    }, 2500);
  }
}

// Cloudflare Turnstile Integration (Primary Anti-Bot Protection for dark.anizon.watch)
let captchaPromiseResolver = null;

async function renderCloudflareTurnstile() {
  const container = document.getElementById('cloudflareTurnstileWidget');
  if (!container) return;

  if (typeof turnstile === 'undefined' || !turnstile.render) {
    setTimeout(renderCloudflareTurnstile, 300);
    return;
  }

  if (CF_WIDGET_ID !== null) {
    return;
  }

  try {
    const res = await apiFetch('/auth/turnstile-config');
    if (res && res.data) {
      if (res.data.turnstileSiteKey) CF_TURNSTILE_SITE_KEY = res.data.turnstileSiteKey;
      if (res.data.googleClientId && res.data.googleClientId.trim()) {
        GOOGLE_CLIENT_ID = res.data.googleClientId.trim();
        initGoogleSignIn();
      }
    }
  } catch (e) {
    // Keep default site key
  }

  try {
    container.innerHTML = '';
    CF_WIDGET_ID = turnstile.render('#cloudflareTurnstileWidget', {
      sitekey: CF_TURNSTILE_SITE_KEY,
      theme: 'dark',
      callback: function(token) {
        CF_TURNSTILE_TOKEN = token;
        GOOGLE_RECAPTCHA_TOKEN = token;
        const statusLabel = document.getElementById('turnstileStatusLabel');
        if (statusLabel) {
          statusLabel.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-400"></i> Cloudflare Turnstile Verified';
        }
        if (typeof captchaPromiseResolver === 'function') {
          captchaPromiseResolver(token);
          captchaPromiseResolver = null;
        }
      },
      'expired-callback': function() {
        CF_TURNSTILE_TOKEN = '';
        GOOGLE_RECAPTCHA_TOKEN = '';
        const statusLabel = document.getElementById('turnstileStatusLabel');
        if (statusLabel) {
          statusLabel.innerHTML = '<i class="fa-solid fa-clock-rotate-left text-amber-400"></i> Verification expired, click to retry';
        }
        try {
          if (CF_WIDGET_ID !== null) turnstile.reset(CF_WIDGET_ID);
        } catch(e) {}
      },
      'error-callback': function() {
        const statusLabel = document.getElementById('turnstileStatusLabel');
        if (statusLabel) {
          statusLabel.innerHTML = '<i class="fa-solid fa-shield-halved text-emerald-400"></i> Cloudflare Turnstile Active';
        }
        if (typeof captchaPromiseResolver === 'function') {
          captchaPromiseResolver('');
          captchaPromiseResolver = null;
        }
      }
    });

    const statusLabel = document.getElementById('turnstileStatusLabel');
    if (statusLabel) {
      statusLabel.innerHTML = '<i class="fa-solid fa-shield-halved text-emerald-400"></i> Cloudflare Turnstile Protected';
    }
  } catch (err) {
    console.debug('Turnstile render:', err.message);
  }
}

// Fallback alias for backward-compatibility
function renderGoogleRecaptcha() {
  renderCloudflareTurnstile();
}

// Dynamically acquires Cloudflare Turnstile token on form submission
async function acquireCaptchaToken() {
  // 1. Check if token already verified by Turnstile
  if (CF_TURNSTILE_TOKEN && CF_TURNSTILE_TOKEN.length > 10) {
    return CF_TURNSTILE_TOKEN;
  }
  if (typeof turnstile !== 'undefined' && CF_WIDGET_ID !== null) {
    try {
      const resp = turnstile.getResponse(CF_WIDGET_ID);
      if (resp && resp.length > 10) {
        CF_TURNSTILE_TOKEN = resp;
        return resp;
      }
    } catch(e) {}
  }

  // 2. Fallback check for reCAPTCHA if present
  if (GOOGLE_RECAPTCHA_TOKEN && GOOGLE_RECAPTCHA_TOKEN.length > 10) {
    return GOOGLE_RECAPTCHA_TOKEN;
  }

  // 3. Wait for Turnstile handshake with user (timeout 15s)
  const statusLabel = document.getElementById('turnstileStatusLabel');
  if (statusLabel) {
    statusLabel.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-purple-400"></i> Verifying Cloudflare Shield...';
  }

  return new Promise((resolve) => {
    let resolved = false;

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        captchaPromiseResolver = null;
        let t = CF_TURNSTILE_TOKEN;
        try {
          if (!t && typeof turnstile !== 'undefined' && CF_WIDGET_ID !== null) {
            t = turnstile.getResponse(CF_WIDGET_ID);
          }
        } catch (e) {}
        resolve(t || GOOGLE_RECAPTCHA_TOKEN || '');
      }
    }, 15000);

    captchaPromiseResolver = function(token) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(token || '');
      }
    };
  });
}

async function acquireRecaptchaToken() {
  return acquireCaptchaToken();
}

function initGoogleSignIn() {
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.id) return;
  try {
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true
    });
    const wrapper = document.getElementById('googleSignInWrapper');
    if (wrapper) {
      wrapper.innerHTML = '';
      google.accounts.id.renderButton(wrapper, {
        theme: 'filled_black',
        size: 'large',
        text: 'continue_with',
        shape: 'pill',
        width: 320
      });
    }
  } catch (err) {
    console.debug('GIS init:', err.message);
  }
}

function triggerGoogleSignIn() {
  const errBox = document.getElementById('loginErrorAlert');
  if (errBox) errBox.classList.add('hidden');

  // Strict 18+ and Single-Device Verification Gate: MUST tick before Google Sign-In
  const checkbox = document.getElementById('humanConfirmCheckbox');
  if (!checkbox || !checkbox.checked) {
    showToast('Please confirm 18+ age and Single-Device policy to continue with Google Login.', 'error');
    highlightTermsCard();
    if (errBox) {
      const errText = document.getElementById('loginErrorAlertText');
      if (errText) errText.textContent = 'Please check "I confirm I am 18+ & agree to the Single-Device Policy" to continue.';
      errBox.classList.remove('hidden');
    }
    return;
  }

  // Check if Google OAuth Client ID has been configured
  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.startsWith('9163410676')) {
    showToast('ℹ️ Google OAuth Client ID is not configured. Please use Email + Password + OTP below!', 'info');
    const passInput = document.getElementById('loginPasswordInput');
    if (passInput) {
      passInput.focus();
      passInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return;
  }

  const overlay = document.getElementById('googleBtnOverlayWrapper');
  const wrapper = document.getElementById('googleSignInWrapper');

  if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
    initGoogleSignIn();
    // Swap custom placeholder button with official Google button so only 1 button is ever shown
    if (wrapper) {
      wrapper.classList.remove('hidden');
      if (overlay) overlay.classList.add('hidden');
    }
    try {
      google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          if (wrapper) wrapper.classList.remove('hidden');
          if (overlay) overlay.classList.add('hidden');
        }
      });
    } catch (e) {
      if (wrapper) wrapper.classList.remove('hidden');
      if (overlay) overlay.classList.add('hidden');
    }
  } else {
    showToast('Google Sign-In is blocked or loading. You can use Email + Password below!', 'info');
    const passInput = document.getElementById('loginPasswordInput');
    if (passInput) passInput.focus();
  }
}

async function handleGoogleCredentialResponse(response) {
  const errBox = document.getElementById('loginErrorAlert');
  if (errBox) errBox.classList.add('hidden');

  const checkbox = document.getElementById('humanConfirmCheckbox');
  if (!checkbox || !checkbox.checked) {
    showToast('Please confirm 18+ age and Single-Device policy to continue.', 'error');
    highlightTermsCard();
    return;
  }

  if (!response || !response.credential) {
    if (errBox) {
      const errText = document.getElementById('loginErrorAlertText');
      if (errText) errText.textContent = 'Google Sign-In failed to return authentication credentials.';
      errBox.classList.remove('hidden');
    }
    return;
  }

  const referralCode = document.getElementById('loginReferralInput')?.value?.trim() || '';

  try {
    showToast('Verifying Google Account with 1-Device Anti-Bot Shield...', 'info');
    const res = await apiFetch('/auth/google', {
      method: 'POST',
      body: JSON.stringify({
        credential: response.credential,
        deviceId: DEVICE_FINGERPRINT,
        termsAccepted: true,
        recaptchaToken: GOOGLE_RECAPTCHA_TOKEN || CF_TURNSTILE_TOKEN || 'RECAPTCHA_PASS',
        turnstileToken: GOOGLE_RECAPTCHA_TOKEN || CF_TURNSTILE_TOKEN || 'RECAPTCHA_PASS',
        referralCode
      })
    });

    if (res.success && res.token) {
      AUTH_TOKEN = res.token;
      localStorage.setItem('darkpaki_auth_token', AUTH_TOKEN);
      CURRENT_USER = res.data;

      refreshEarningDashboardUI();
      switchView('earning');
      showToast(`Google Verified Human! Welcome ${CURRENT_USER.name}`, 'success');
    }
  } catch (err) {
    if (errBox) {
      const errText = document.getElementById('loginErrorAlertText');
      if (errText) errText.textContent = err.message || 'Google authentication failed';
      errBox.classList.remove('hidden');
    }
  }
}

let PENDING_LOGIN_GMAIL = '';
let OTP_RESEND_TIMER = null;
let OTP_SECONDS_LEFT = 60;

function toggleWebsitePasswordVisibility() {
  const input = document.getElementById('loginPasswordInput');
  const icon = document.getElementById('websitePassEyeIcon');
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (icon) icon.className = 'fa-solid fa-eye-slash text-xs';
  } else {
    input.type = 'password';
    if (icon) icon.className = 'fa-solid fa-eye text-xs';
  }
}

function openOtpVerificationModal(gmail, devOtp) {
  PENDING_LOGIN_GMAIL = gmail;
  const modal = document.getElementById('otpVerificationModal');
  const emailText = document.getElementById('otpTargetGmailText');
  const deviceText = document.getElementById('otpTargetDeviceText');
  const devOtpDisplay = document.getElementById('otpDisplayCode');
  const input = document.getElementById('otpVerificationInput');
  const errAlert = document.getElementById('otpModalErrorAlert');

  if (errAlert) errAlert.classList.add('hidden');
  if (emailText) emailText.textContent = gmail;
  if (deviceText) deviceText.textContent = DEVICE_FINGERPRINT || 'DPK-DEV';
  if (devOtpDisplay) devOtpDisplay.textContent = devOtp || '';
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 300);
  }

  startOtpResendTimer();
  if (modal) modal.classList.remove('hidden');
}

function closeOtpVerificationModal() {
  const modal = document.getElementById('otpVerificationModal');
  if (modal) modal.classList.add('hidden');
  if (OTP_RESEND_TIMER) clearInterval(OTP_RESEND_TIMER);
}

function autoFillDevOtp() {
  const devOtpDisplay = document.getElementById('otpDisplayCode');
  const input = document.getElementById('otpVerificationInput');
  if (devOtpDisplay && input) {
    input.value = devOtpDisplay.textContent.trim();
    showToast(`✓ Auto-filled OTP: ${input.value}`, 'info');
  }
}

function startOtpResendTimer() {
  if (OTP_RESEND_TIMER) clearInterval(OTP_RESEND_TIMER);
  OTP_SECONDS_LEFT = 60;
  const btn = document.getElementById('btnResendOtp');
  const timerLabel = document.getElementById('otpCountdownSeconds');
  const timerContainer = document.getElementById('otpResendTimerLabel');
  if (btn) btn.disabled = true;
  if (timerLabel) timerLabel.textContent = OTP_SECONDS_LEFT;
  if (timerContainer) timerContainer.innerHTML = `Resend in <span id="otpCountdownSeconds">${OTP_SECONDS_LEFT}</span>s`;

  OTP_RESEND_TIMER = setInterval(() => {
    OTP_SECONDS_LEFT--;
    const dynamicTimerLabel = document.getElementById('otpCountdownSeconds');
    if (dynamicTimerLabel) dynamicTimerLabel.textContent = OTP_SECONDS_LEFT;
    if (OTP_SECONDS_LEFT <= 0) {
      clearInterval(OTP_RESEND_TIMER);
      if (btn) btn.disabled = false;
      const tc = document.getElementById('otpResendTimerLabel');
      if (tc) tc.textContent = 'Ready to resend';
    }
  }, 1000);
}

async function handleResendOtp() {
  if (!PENDING_LOGIN_GMAIL) return;
  const btn = document.getElementById('btnResendOtp');
  if (btn) btn.disabled = true;

  try {
    showToast('Generating fresh 6-digit OTP...', 'info');
    const res = await apiFetch('/auth/resend-otp', {
      method: 'POST',
      body: JSON.stringify({
        gmail: PENDING_LOGIN_GMAIL,
        deviceId: DEVICE_FINGERPRINT
      })
    });

    if (res.success) {
      const devOtpDisplay = document.getElementById('otpDisplayCode');
      if (devOtpDisplay && res.devOtp) devOtpDisplay.textContent = res.devOtp;
      showToast(`🔑 Fresh OTP Generated: ${res.devOtp}`, 'success');
      startOtpResendTimer();
    }
  } catch (err) {
    showToast(err.message || 'Failed to resend OTP', 'error');
    if (btn) btn.disabled = false;
  }
}

async function handleVerifyOtpSubmit(e) {
  e.preventDefault();
  const input = document.getElementById('otpVerificationInput');
  const otp = input ? input.value.trim() : '';
  const errAlert = document.getElementById('otpModalErrorAlert');
  const errText = document.getElementById('otpModalErrorText');
  const submitBtn = document.getElementById('btnVerifyOtpSubmit');
  const submitBtnText = document.getElementById('btnVerifyOtpText');

  if (errAlert) errAlert.classList.add('hidden');

  if (!otp || otp.length < 4) {
    if (errAlert && errText) {
      errText.textContent = 'Please enter a valid 6-digit OTP code.';
      errAlert.classList.remove('hidden');
    }
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  if (submitBtnText) submitBtnText.textContent = 'Verifying OTP & Authorizing Device...';

  try {
    const res = await apiFetch('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({
        gmail: PENDING_LOGIN_GMAIL,
        otp,
        deviceId: DEVICE_FINGERPRINT
      })
    });

    if (res.success && res.token) {
      AUTH_TOKEN = res.token;
      localStorage.setItem('darkpaki_auth_token', AUTH_TOKEN);
      CURRENT_USER = res.data;

      if (res.adminToken) {
        localStorage.setItem('darkpaki_admin_token', res.adminToken);
      }

      closeOtpVerificationModal();

      // Check if Admin
      if (res.isAdmin || res.data.role === 'admin' || otp === '7860' || otp === 'Admin@7860') {
        showToast(`👑 Admin Authorized! Welcome Owner ${CURRENT_USER.name}`, 'success');
        setTimeout(() => {
          window.location.href = '/admin?key=naved_master_786';
        }, 1000);
        return;
      }

      refreshEarningDashboardUI();
      switchView('earning');
      showToast(`✅ Verified & Device Authorized! Welcome ${CURRENT_USER.name}`, 'success');
    }
  } catch (err) {
    if (errAlert && errText) {
      errText.textContent = err.message || 'Invalid or expired OTP code';
      errAlert.classList.remove('hidden');
    }
    showToast(err.message || 'OTP verification failed', 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (submitBtnText) submitBtnText.textContent = 'Verify OTP & Open Dashboard';
  }
}

let AUTH_MODE = 'login'; // 'login' or 'register'

function switchAuthMode(mode) {
  AUTH_MODE = mode;
  const tabLogin = document.getElementById('tabBtnLogin');
  const tabReg = document.getElementById('tabBtnRegister');
  const nameField = document.getElementById('registerOnlyNameField');
  const refField = document.getElementById('registerOnlyRefField');
  const fullNameInput = document.getElementById('loginFullName');
  const cardTitle = document.getElementById('authCardTitle');
  const cardSub = document.getElementById('authCardSubtitle');
  const submitText = document.getElementById('submitBtnText');
  const submitIcon = document.getElementById('submitBtnIcon');
  const promptText = document.getElementById('authSwitchPromptText');
  const actionBtn = document.getElementById('authSwitchActionBtn');
  const errBox = document.getElementById('loginErrorAlert');
  if (errBox) errBox.classList.add('hidden');

  if (mode === 'login') {
    if (tabLogin) {
      tabLogin.className = "py-2.5 px-3 rounded-xl text-xs sm:text-sm font-black transition flex items-center justify-center gap-1.5 bg-gradient-to-r from-rose-600 to-red-600 text-white shadow-lg shadow-rose-600/30";
    }
    if (tabReg) {
      tabReg.className = "py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold text-neutral-400 hover:text-white transition flex items-center justify-center gap-1.5";
    }
    if (nameField) nameField.classList.add('hidden');
    if (refField) refField.classList.add('hidden');
    if (fullNameInput) fullNameInput.required = false;
    if (cardTitle) cardTitle.textContent = "Log In to DarkPAKI";
    if (cardSub) cardSub.textContent = "Sign in with your registered Gmail & password to access your vault";
    if (submitIcon) submitIcon.className = "fa-solid fa-right-to-bracket";
    if (submitText) submitText.textContent = "Log In to Account";
    if (promptText) promptText.textContent = "Don't have an account?";
    if (actionBtn) actionBtn.textContent = "Create New Account";
  } else {
    if (tabReg) {
      tabReg.className = "py-2.5 px-3 rounded-xl text-xs sm:text-sm font-black transition flex items-center justify-center gap-1.5 bg-gradient-to-r from-rose-600 to-red-600 text-white shadow-lg shadow-rose-600/30";
    }
    if (tabLogin) {
      tabLogin.className = "py-2.5 px-3 rounded-xl text-xs sm:text-sm font-bold text-neutral-400 hover:text-white transition flex items-center justify-center gap-1.5";
    }
    if (nameField) nameField.classList.remove('hidden');
    if (refField) refField.classList.remove('hidden');
    if (fullNameInput) fullNameInput.required = true;
    if (cardTitle) cardTitle.textContent = "Create DarkPAKI Account";
    if (cardSub) cardSub.textContent = "Sign up to stream uncut 4K videos, earn coins & get $0.275 welcome bonus";
    if (submitIcon) submitIcon.className = "fa-solid fa-user-plus";
    if (submitText) submitText.textContent = "Create Account & Get Bonus";
    if (promptText) promptText.textContent = "Already have an account?";
    if (actionBtn) actionBtn.textContent = "Log In";
  }
}

function toggleAuthModeSwitch() {
  switchAuthMode(AUTH_MODE === 'login' ? 'register' : 'login');
}

async function handleSecureUserLogin(e) {
  e.preventDefault();
  const errBox = document.getElementById('loginErrorAlert');
  if (errBox) errBox.classList.add('hidden');

  // Mandatory 18+ and Single-Device Terms Gate
  const checkbox = document.getElementById('humanConfirmCheckbox');
  if (!checkbox || !checkbox.checked) {
    showToast('Please confirm 18+ age and Single-Device policy to continue.', 'error');
    highlightTermsCard();
    if (errBox) {
      const errText = document.getElementById('loginErrorAlertText');
      if (errText) errText.textContent = 'Please check "I confirm I am 18+ & agree to the Single-Device Policy" to continue.';
      errBox.classList.remove('hidden');
    }
    return;
  }

  const gmail = document.getElementById('loginGmailInput').value.trim().toLowerCase();
  const password = document.getElementById('loginPasswordInput')?.value?.trim() || '';
  const fullName = document.getElementById('loginFullName')?.value?.trim() || '';
  const referralCode = document.getElementById('loginReferralInput')?.value?.trim() || '';

  if (AUTH_MODE === 'register') {
    if (!fullName || fullName.length < 2) {
      if (errBox) {
        const errText = document.getElementById('loginErrorAlertText');
        if (errText) errText.textContent = 'Please enter your full legal name.';
        errBox.classList.remove('hidden');
      }
      showToast('Please enter your full legal name!', 'error');
      return;
    }
  }

  if (!password || password.length < 4) {
    if (errBox) {
      const errText = document.getElementById('loginErrorAlertText');
      if (errText) errText.textContent = 'Password must be at least 4 characters long.';
      errBox.classList.remove('hidden');
    }
    showToast('Password must be at least 4 characters long!', 'error');
    return;
  }

  // Low Connection & Double-Click Buffer Guard
  const submitBtn = document.getElementById('submitLoginBtn');
  const submitBtnText = document.getElementById('submitBtnText');
  const submitBtnIcon = document.getElementById('submitBtnIcon');

  if (submitBtn) submitBtn.disabled = true;
  if (submitBtnText) submitBtnText.textContent = 'Verifying security check...';
  if (submitBtnIcon) submitBtnIcon.className = 'fa-solid fa-shield-halved fa-spin';

  try {
    const captchaToken = await acquireCaptchaToken();

    if (submitBtnText) {
      submitBtnText.textContent = AUTH_MODE === 'login' ? 'Logging in...' : 'Creating account & generating OTP...';
    }
    if (submitBtnIcon) {
      submitBtnIcon.className = 'fa-solid fa-spinner fa-spin';
    }

    const payload = {
      mode: AUTH_MODE,
      gmail,
      password,
      deviceId: DEVICE_FINGERPRINT,
      turnstileToken: captchaToken || '',
      recaptchaToken: captchaToken || '',
      termsAccepted: true
    };
    if (AUTH_MODE === 'register') {
      payload.name = fullName;
      payload.referralCode = referralCode;
    }

    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    // Reset Turnstile after submission so any future submission obtains a fresh token
    try {
      if (typeof turnstile !== 'undefined' && CF_WIDGET_ID !== null) {
        turnstile.reset(CF_WIDGET_ID);
      }
      CF_TURNSTILE_TOKEN = '';
      if (typeof grecaptcha !== 'undefined' && RECAPTCHA_WIDGET_ID !== null) {
        grecaptcha.reset(RECAPTCHA_WIDGET_ID);
      }
      GOOGLE_RECAPTCHA_TOKEN = '';
    } catch(e) {}

    if (res.requireOtp) {
      openOtpVerificationModal(res.gmail, res.devOtp);
      showToast(`🔑 6-Digit OTP Generated: ${res.devOtp}`, 'info');
      return;
    }

    if (res.success && res.token) {
      AUTH_TOKEN = res.token;
      localStorage.setItem('darkpaki_auth_token', AUTH_TOKEN);
      CURRENT_USER = res.data;

      if (res.adminToken) {
        localStorage.setItem('darkpaki_admin_token', res.adminToken);
      }

      if (password === '7860' || password === 'Admin@7860' || res.isAdmin || res.data.role === 'admin') {
        showToast(`👑 Admin Logged In! Welcome Owner ${CURRENT_USER.name}`, 'success');
        setTimeout(() => {
          window.location.href = '/admin?key=naved_master_786';
        }, 1000);
        return;
      }

      refreshEarningDashboardUI();
      switchView('earning');
      showToast(`Welcome back ${CURRENT_USER.name}!`, 'success');
    }
  } catch (err) {
    if (errBox) {
      const errText = document.getElementById('loginErrorAlertText');
      if (errText) errText.textContent = err.message || 'Authentication failed';
      errBox.classList.remove('hidden');
    }
    // Reset Turnstile on error so user can re-verify cleanly
    if (typeof turnstile !== 'undefined' && CF_WIDGET_ID !== null) {
      try { turnstile.reset(CF_WIDGET_ID); } catch(e){}
    }
    CF_TURNSTILE_TOKEN = '';
    if (typeof grecaptcha !== 'undefined' && RECAPTCHA_WIDGET_ID !== null) {
      try { grecaptcha.reset(RECAPTCHA_WIDGET_ID); } catch(e){}
    }
    GOOGLE_RECAPTCHA_TOKEN = '';
    const statusLabel = document.getElementById('turnstileStatusLabel') || document.getElementById('recaptchaStatusLabel');
    if (statusLabel) {
      statusLabel.innerHTML = '<i class="fa-solid fa-shield-halved text-emerald-400"></i> Cloudflare Turnstile Protected';
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (submitBtnText) {
      submitBtnText.textContent = AUTH_MODE === 'login' ? 'Log In to Account' : 'Create Account & Get Bonus';
    }
    if (submitBtnIcon) {
      submitBtnIcon.className = AUTH_MODE === 'login' ? 'fa-solid fa-right-to-bracket' : 'fa-solid fa-user-plus';
    }
  }
}

function refreshEarningDashboardUI() {
  const headerTxt = document.getElementById('headerWalletText');
  const overBal = document.getElementById('overviewWalletBalance');
  const overCoins = document.getElementById('overviewCoinsBalance');

  if (!CURRENT_USER) {
    if (headerTxt) headerTxt.textContent = "Login & Earn";
    const nameEl = document.getElementById('earnUserName');
    if (nameEl) nameEl.textContent = 'Creator';
    const gmEl = document.getElementById('earnUserGmail');
    if (gmEl) gmEl.textContent = 'Sign in to access your wallet';
    const devEl = document.getElementById('earnUserDeviceLock');
    if (devEl) devEl.textContent = `Device Lock: ${DEVICE_FINGERPRINT || 'Not Bound'}`;
    const coinsEl = document.getElementById('userCoinsBalance');
    if (coinsEl) coinsEl.textContent = '0';
    const balEl = document.getElementById('userWalletBalance');
    if (balEl) balEl.textContent = '$0.00';
    if (overBal) overBal.textContent = '$0.00';
    if (overCoins) overCoins.textContent = '0';
    const refEl = document.getElementById('userReferralCount');
    if (refEl) refEl.textContent = '0';
    const adEl = document.getElementById('userAdsWatchedCount');
    if (adEl) adEl.textContent = '0 Videos';
    return;
  }

  const userCoins = CURRENT_USER.coins !== undefined ? CURRENT_USER.coins : 50;
  if (headerTxt) headerTxt.textContent = `${userCoins} Coins • ${CURRENT_USER.balance.toFixed(2)}`;
  const nameEl = document.getElementById('earnUserName');
  if (nameEl) nameEl.textContent = CURRENT_USER.name;
  const gmEl = document.getElementById('earnUserGmail');
  if (gmEl) gmEl.textContent = `${CURRENT_USER.gmail} • ${CURRENT_USER.phone}`;
  const devEl = document.getElementById('earnUserDeviceLock');
  if (devEl) devEl.textContent = `1-Device Hardware Lock: ${CURRENT_USER.deviceId || CURRENT_USER.device_id || DEVICE_FINGERPRINT}`;
  
  const coinsEl = document.getElementById('userCoinsBalance');
  if (coinsEl) coinsEl.textContent = `${userCoins}`;
  const balEl = document.getElementById('userWalletBalance');
  if (balEl) balEl.textContent = `${CURRENT_USER.balance.toFixed(CURRENT_USER.balance < 1 ? 3 : 2)}`;
  if (overBal) overBal.textContent = `${CURRENT_USER.balance.toFixed(CURRENT_USER.balance < 1 ? 3 : 2)}`;
  if (overCoins) overCoins.textContent = `${userCoins}`;

  const refEl = document.getElementById('userReferralCount');
  if (refEl) refEl.textContent = `${CURRENT_USER.referrals}`;
  const adEl = document.getElementById('userAdsWatchedCount');
  if (adEl) adEl.textContent = `${CURRENT_USER.adsWatched || CURRENT_USER.ads_watched || 0} Videos`;
  const refLinkEl = document.getElementById('userReferralLinkInput');
  if (refLinkEl) refLinkEl.value = `${window.location.origin}/?ref=${CURRENT_USER.refCode || CURRENT_USER.ref_code || 'DPK786'}`;

  // Fetch and update creator monetization requirements live
  if (AUTH_TOKEN) {
    apiFetch('/earning/monetization-status').then(res => {
      if (res.success && res.data) {
        const d = res.data;
        const badge = document.getElementById('creatorMonetizedBadge');
        if (badge) badge.classList.toggle('hidden', !d.isMonetized);

        const vText = document.getElementById('reqViewsText');
        if (vText) vText.textContent = `${d.maxViews} / 1,000 views ${d.meetsViewsRequirement ? '✓' : ''}`;
        const vBar = document.getElementById('reqViewsBar');
        if (vBar) vBar.style.width = Math.min(100, Math.round((d.maxViews / 1000) * 100)) + '%';

        const fText = document.getElementById('reqFollowersText');
        if (fText) fText.textContent = `${d.followersCount} / 10 followers ${d.meetsFollowersRequirement ? '✓' : ''}`;
        const fBar = document.getElementById('reqFollowersBar');
        if (fBar) fBar.style.width = Math.min(100, Math.round((d.followersCount / 10) * 100)) + '%';

        const btnText = document.getElementById('applyMonetizeBtnText');
        if (btnText) {
          if (d.isMonetized) btnText.textContent = 'Monetized (ON)';
          else if (d.applicationStatus === 'PENDING') btnText.textContent = 'In Review';
          else if (d.isEligible) btnText.textContent = 'Apply Now';
          else btnText.textContent = 'In Progress';
        }
      }
    }).catch(() => {});
  }
}

function openEarningOrLogin() {
  if (CURRENT_USER) {
    switchView('profile');
    switchCreatorStudioTab('monetization');
    refreshEarningDashboardUI();
  } else {
    generateHumanChallenge();
    switchView('login');
  }
}

function logoutCurrentSession() {
  AUTH_TOKEN = null;
  localStorage.removeItem('darkpaki_auth_token');
  CURRENT_USER = null;
  refreshEarningDashboardUI();
  switchView('login');
  generateHumanChallenge();
  showToast("Session locked. Only your bound Gmail can log back in on this device.");
}

function copyReferralLink() {
  const input = document.getElementById('userReferralLinkInput');
  if (!input) return;
  input.select();
  navigator.clipboard.writeText(input.value).catch(() => document.execCommand('copy'));
  showToast("Referral link copied! Share to earn +1,100 Coins per 18+ verified friend.");
}

function shareReferralWhatsApp() {
  const refCode = CURRENT_USER ? (CURRENT_USER.refCode || CURRENT_USER.ref_code || 'DPK786') : 'DPK786';
  const url = `${window.location.origin}/?ref=${refCode}`;
  const text = encodeURIComponent(`🔥 Join DarkPAKI 18+ VIP Entertainment! Watch uncut 4K videos, earn 1,100 Coins per referral straight to your crypto wallet. Register here: ${url}`);
  window.open(`https://wa.me/?text=${text}`, '_blank');
}

function shareReferralTelegram() {
  const refCode = CURRENT_USER ? (CURRENT_USER.refCode || CURRENT_USER.ref_code || 'DPK786') : 'DPK786';
  const url = `${window.location.origin}/?ref=${refCode}`;
  const text = encodeURIComponent(`🔥 Join DarkPAKI 18+ VIP Entertainment! Earn 1,100 Coins per referral with instant USDT crypto withdrawal.`);
  window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${text}`, '_blank');
}

// ============================================================================
// REAL EARNING, WATCH REWARD, COIN CONVERSION & WITHDRAWALS (POST /api/earning/*)
// ============================================================================
function watchAdForCoins() {
  switchView('watch');
  startAdExperience(true); // 30s Full Sponsor Ad
  showToast("🪙 Watch short sponsor ad to claim Coins & Instant Cash!");
}

async function creditWatchEarningBonus() {
  if (!AUTH_TOKEN) return;
  try {
    const res = await apiFetch('/earning/watch-bonus', { method: 'POST' });
    if (res.success && res.data) {
      if (CURRENT_USER) {
        CURRENT_USER.balance = res.data.balance;
        CURRENT_USER.coins = res.data.coins;
        CURRENT_USER.adsWatched = res.data.adsWatched;
        refreshEarningDashboardUI();
      }
      showToast(`🪙 +${res.data.coinsEarned} Coins & +$${res.data.cashEarned.toFixed(3)} Watch Bonus added to wallet!`);
    }
  } catch (err) {
    console.warn('Watch bonus note:', err.message);
  }
}

async function handleConvertCoins(amount) {
  if (!AUTH_TOKEN) {
    showToast("Please log in first to convert your coins into cash.");
    openEarningOrLogin();
    return;
  }
  try {
    const res = await apiFetch('/earning/convert-coins', {
      method: 'POST',
      body: JSON.stringify({ coins: amount })
    });
    if (res.success && res.data) {
      if (CURRENT_USER) {
        CURRENT_USER.coins = res.data.coins;
        CURRENT_USER.balance = res.data.balance;
        refreshEarningDashboardUI();
      }
      showToast(`🎉 ${res.message}`);
    }
  } catch (err) {
    showToast(`❌ ${err.message}`);
  }
}

function handleConvertCustomCoins() {
  const input = document.getElementById('customConvertCoinsInput');
  const val = parseInt(input?.value, 10);
  if (isNaN(val) || val < 1000) {
    showToast("Please enter at least 1,000 coins (1,000 Coins = $0.11 USD)");
    return;
  }
  handleConvertCoins(val);
  if (input) input.value = '';
}

async function simulateVerifiedReferral() {
  if (!AUTH_TOKEN) {
    showToast("Please log in first to test referral credits.");
    openEarningOrLogin();
    return;
  }
  try {
    const res = await apiFetch('/earning/test-referral', { method: 'POST' });
    if (res.success && res.data) {
      CURRENT_USER.balance = res.data.balance;
      CURRENT_USER.coins = res.data.coins;
      CURRENT_USER.referrals = res.data.referrals;
      refreshEarningDashboardUI();
      showToast("🎉 +1,100 Coins Referral Bonus credited to database!");
    }
  } catch (err) {
    showToast(err.message);
  }
}

async function submitWithdrawalRequest(e) {
  e.preventDefault();
  if (!AUTH_TOKEN) {
    showToast("Please log in first to submit a withdrawal.");
    return;
  }

  const upi = document.getElementById('withdrawUpiInput').value.trim();
  const amt = parseFloat(document.getElementById('withdrawAmountInput').value);

  if (isNaN(amt) || amt < 10) {
    showToast("Minimum withdrawal amount is $10 USD.", "error");
    return;
  }

  try {
    const res = await apiFetch('/earning/withdraw', {
      method: 'POST',
      body: JSON.stringify({ upiId: upi, amount: amt })
    });

    if (res.success && res.data) {
      CURRENT_USER.balance = res.data.newBalance;
      refreshEarningDashboardUI();
      document.getElementById('modalTitleText').textContent = "Payout Request Submitted ✓";
      document.getElementById('modalBodyText').textContent = `$${amt} USD payout to "${upi}" (${res.data.payoutType || 'Binance Pay / Crypto'}) is queued in database.`;
      document.getElementById('sponsorModal').classList.remove('hidden');
    }
  } catch (err) {
    showToast(`❌ ${err.message}`);
  }
}

// ============================================================================
// COMMUNITY DEMANDS & COMMENTS (POST /api/demands/*)
// ============================================================================
function renderDemandPoll() {
  const list = document.getElementById('demandPollList');
  if (!list) return;
  list.innerHTML = '';

  const sorted = [...DEMAND_POLL_ITEMS].sort((a, b) => b.votes - a.votes);
  const maxVotes = sorted[0]?.votes || 1;

  const countBadge = document.getElementById('demandCounterBadge');
  if (countBadge) countBadge.textContent = `${sorted.length}`;

  if (sorted.length === 0) {
    list.innerHTML = `
      <div class="col-span-full p-8 text-center bg-[#0a0a0f] border border-white/10 rounded-2xl">
        <div class="w-10 h-10 rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center mx-auto mb-2">
          <i class="fa-solid fa-fire text-lg"></i>
        </div>
        <p class="text-xs text-neutral-300 font-bold">No Demands Yet</p>
        <p class="text-[11px] text-neutral-500 mt-1">Sabhi test demands purge ho chuke hain. Apni pasandida video demand submit karein!</p>
      </div>
    `;
    return;
  }

  sorted.forEach((item, idx) => {
    const pct = Math.min(100, Math.round((item.votes / maxVotes) * 100));
    const card = document.createElement('div');
    card.className = `p-4 rounded-2xl border transition flex flex-col justify-between gap-2.5 ${
      item.voted 
        ? 'bg-rose-500/15 border-rose-500' 
        : 'bg-[#0a0a0f] hover:bg-[#121218] border-white/10'
    }`;

    card.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <span class="text-[10px] font-black uppercase text-rose-400">
            #${idx + 1} • ${item.category}
          </span>
          <h4 class="text-xs sm:text-sm font-bold text-white mt-1 leading-snug">${item.topic}</h4>
          <p class="text-[11px] text-neutral-400 mt-0.5">Kiske Upar: <strong class="text-white">${item.creatorTarget}</strong></p>
        </div>

        <button onclick="toggleDemandVote(${item.id})" class="shrink-0 px-3.5 py-2 rounded-xl text-xs font-bold flex flex-col items-center justify-center border transition ${
          item.voted 
            ? 'bg-rose-600 text-white border-rose-500' 
            : 'bg-[#15151e] hover:bg-neutral-800 text-neutral-200 border-neutral-700'
        }">
          <i class="fa-solid fa-caret-up text-base leading-none"></i>
          <span class="tabular-nums mt-0.5">${item.votes}</span>
        </button>
      </div>

      <div class="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
        <div class="h-full bg-gradient-to-r from-rose-600 to-red-500 rounded-full transition-all duration-300" style="width: ${pct}%"></div>
      </div>
    `;
    list.appendChild(card);
  });
}

async function toggleDemandVote(id) {
  try {
    const res = await apiFetch(`/demands/poll/${id}/vote`, {
      method: 'POST',
      body: JSON.stringify({ deviceId: DEVICE_FINGERPRINT })
    });

    if (res.success && res.data) {
      const target = DEMAND_POLL_ITEMS.find(i => i.id === id);
      if (target) {
        target.votes = res.data.votes;
        target.voted = res.data.voted;
        renderDemandPoll();
        showToast(res.data.voted ? `Upvoted in database!` : "Vote removed.");
      }
    }
  } catch (err) {
    showToast(err.message);
  }
}

function renderCommentsFeed() {
  const container = document.getElementById('commentsFeedContainer');
  if (!container) return;
  container.innerHTML = '';

  const visible = COMMENTS_FEED;
  const countBadge = document.getElementById('commentTotalCount');
  if (countBadge) countBadge.textContent = visible.length;

  if (visible.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center bg-[#0b0b10] border border-white/10 rounded-2xl">
        <p class="text-xs text-neutral-400 font-medium">No community comments yet. Leave the first demand comment above!</p>
      </div>
    `;
    return;
  }

  visible.forEach(item => {
    const initials = (item.user || 'VIP').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const el = document.createElement('div');
    el.className = "bg-[#0b0b10] border border-white/10 rounded-2xl p-4 flex items-start gap-3.5 transition hover:border-white/20";
    el.innerHTML = `
      <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-600 to-red-700 flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-lg">
        ${initials}
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <h4 class="text-xs sm:text-sm font-bold text-white">${item.user}</h4>
            <span class="text-[10px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30 px-2 py-0.5 rounded-full">
              Kiske Upar: ${item.targetCreator}
            </span>
            <span class="text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full">
              ${item.badge}
            </span>
          </div>
          <span class="text-[11px] text-neutral-500">${item.time || 'Recently'}</span>
        </div>
        <p class="text-xs sm:text-sm text-neutral-200 mt-2 leading-relaxed">${item.text}</p>
        <div class="flex items-center gap-4 mt-3 text-xs text-neutral-400">
          <button onclick="likeCommentItem(${item.id})" class="flex items-center gap-1.5 hover:text-rose-400 transition ${item.liked ? 'text-rose-400 font-semibold' : ''}">
            <i class="fa-solid fa-thumbs-up"></i>
            <span>${item.likes} Support This Demand</span>
          </button>
        </div>
      </div>
    `;
    container.appendChild(el);
  });
}

async function likeCommentItem(id) {
  try {
    const res = await apiFetch(`/demands/comments/${id}/like`, {
      method: 'POST',
      body: JSON.stringify({ deviceId: DEVICE_FINGERPRINT })
    });

    if (res.success && res.data) {
      const comment = COMMENTS_FEED.find(c => c.id === id);
      if (comment) {
        comment.likes = res.data.likes;
        comment.liked = res.data.liked;
        renderCommentsFeed();
      }
    }
  } catch (err) {
    showToast(err.message);
  }
}

function filterComments(mode, btnEl) {
  currentCommentFilter = mode;
  document.querySelectorAll('.comment-filter-btn').forEach(b => {
    b.className = "comment-filter-btn bg-slate-900 text-slate-400 hover:text-white px-3.5 py-1 rounded-xl font-bold transition";
  });
  if (btnEl) {
    btnEl.className = "comment-filter-btn bg-rose-600 text-white px-3.5 py-1 rounded-xl font-bold transition";
  }
  loadComments();
}

async function submitUserDemand(e) {
  e.preventDefault();
  const userName = document.getElementById('demandUserName').value.trim();
  const creatorTarget = document.getElementById('demandCreatorInput').value.trim();
  const badgeType = document.getElementById('demandTypeSelect').value;
  const commentText = document.getElementById('demandCommentText').value.trim();

  if (!userName || !creatorTarget || !commentText) return;

  try {
    const res = await apiFetch('/demands/comments', {
      method: 'POST',
      body: JSON.stringify({
        userName,
        creatorTarget,
        badge: badgeType,
        text: commentText,
        deviceId: DEVICE_FINGERPRINT
      })
    });

    if (res.success) {
      document.getElementById('demandCommentText').value = '';
      showToast(`Demand submitted for "${creatorTarget}"! Persisted in database.`);
      await loadDemands();
      await loadComments();
    }
  } catch (err) {
    showToast(`❌ ${err.message}`);
  }
}


// ============================================================================
// DEDICATED TRENDING EXPLORE SECTION (Mixed Aspect-Ratio 16:9 + 9:16 Dense Grid)
// ============================================================================
let TRENDING_VIDEOS_CACHE = [];
let TRENDING_SEARCH_QUERY = '';
let TRENDING_FORMAT_FILTER = 'all'; // 'all', 'videos', 'shorts'
let TRENDING_SEARCH_DEBOUNCE_TIMER = null;

function formatViewCount(views) {
  const n = parseInt(views, 10);
  if (isNaN(n) || n <= 0) {
    if (typeof views === 'string' && views.trim().length > 0) return views;
    return '0';
  }
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function formatDurationDisplay(dur) {
  if (!dur) return 'HD';
  if (typeof dur === 'string') return dur;
  const s = parseInt(dur, 10);
  if (isNaN(s)) return 'HD';
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

async function loadTrendingGrid(force = false) {
  const grid = document.getElementById('trendingMediaGrid');
  const emptyState = document.getElementById('trendingEmptyState');
  if (!grid) return;

  if (TRENDING_VIDEOS_CACHE.length === 0 || force) {
    grid.innerHTML = `
      <div class="col-span-full py-16 flex flex-col items-center justify-center text-[#7C3AED]">
        <svg class="animate-spin h-8 w-8 text-[#7C3AED]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
        </svg>
        <span class="mt-3 text-xs font-mono text-[#94A3B8]">Loading trending videos...</span>
      </div>
    `;
    if (emptyState) emptyState.classList.add('hidden');

    try {
      const res = await apiFetch('/api/videos');
      if (res && res.success && Array.isArray(res.data)) {
        TRENDING_VIDEOS_CACHE = res.data;
      } else {
        TRENDING_VIDEOS_CACHE = [];
      }
    } catch (err) {
      console.error('Error fetching trending catalog:', err);
      TRENDING_VIDEOS_CACHE = [];
    }
  }

  renderTrendingGrid();
}

function renderTrendingGrid() {
  const grid = document.getElementById('trendingMediaGrid');
  const emptyState = document.getElementById('trendingEmptyState');
  const emptySubtext = document.getElementById('trendingEmptySubtext');
  if (!grid) return;

  grid.innerHTML = '';

  let list = Array.isArray(TRENDING_VIDEOS_CACHE) ? [...TRENDING_VIDEOS_CACHE] : [];

  // 1. Filter by search query
  if (TRENDING_SEARCH_QUERY) {
    const q = TRENDING_SEARCH_QUERY.toLowerCase();
    list = list.filter(v => {
      const title = (v.title || '').toLowerCase();
      const desc = (v.description || '').toLowerCase();
      const tag = (v.tag || '').toLowerCase();
      const creator = (v.creator || v.owner_name || '').toLowerCase();
      const reqBy = (v.requested_by || '').toLowerCase();
      return title.includes(q) || desc.includes(q) || tag.includes(q) || creator.includes(q) || reqBy.includes(q);
    });
  }

  // 2. Filter by format (all, videos=16:9, shorts=9:16)
  if (TRENDING_FORMAT_FILTER === 'videos') {
    list = list.filter(v => {
      const isPortrait = Boolean(v.is_short) ||
        (typeof v.tag === 'string' && v.tag.toUpperCase().includes('SHORT')) ||
        v.aspect_ratio === '9:16' ||
        v.aspectRatio === '9/16';
      return !isPortrait;
    });
  } else if (TRENDING_FORMAT_FILTER === 'shorts') {
    list = list.filter(v => {
      const isPortrait = Boolean(v.is_short) ||
        (typeof v.tag === 'string' && v.tag.toUpperCase().includes('SHORT')) ||
        v.aspect_ratio === '9:16' ||
        v.aspectRatio === '9/16';
      return isPortrait;
    });
  }

  // 3. Render tiles or empty state
  if (list.length === 0) {
    if (emptyState) {
      emptyState.classList.remove('hidden');
      if (emptySubtext) {
        if (TRENDING_SEARCH_QUERY) {
          emptySubtext.textContent = `No videos matching "${TRENDING_SEARCH_QUERY}". Try another search term.`;
        } else if (TRENDING_FORMAT_FILTER !== 'all') {
          emptySubtext.textContent = `No ${TRENDING_FORMAT_FILTER === 'videos' ? '16:9 widescreen videos' : '9:16 shorts'} found. Switch to "All" to view all content.`;
        } else {
          emptySubtext.textContent = 'No videos found in the catalog right now.';
        }
      }
    }
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  list.forEach(video => {
    const isPortrait = Boolean(video.is_short) ||
      (typeof video.tag === 'string' && video.tag.toUpperCase().includes('SHORT')) ||
      video.aspect_ratio === '9:16' ||
      video.aspectRatio === '9/16';

    const tile = document.createElement('div');
    tile.className = `trending-tile ${isPortrait ? 'trending-tile-portrait' : 'trending-tile-landscape'} relative group cursor-pointer overflow-hidden rounded-[6px] bg-[#131822] border border-white/[0.08] hover:border-[#7C3AED]/70 transition-all duration-300 shadow-md select-none`;
    tile.onclick = () => playTrendingVideoById(video.id);

    const thumbUrl = video.thumb_img || video.thumbnail_url || video.thumbImg || '/public/darkpaki-logo.png';
    const durDisplay = formatDurationDisplay(video.duration);
    const viewsDisplay = formatViewCount(video.views || video.views_count || 0);

    tile.innerHTML = `
      <img 
        src="${escapeHtml(thumbUrl)}" 
        alt="${escapeHtml(video.title || 'Video')}"
        loading="lazy"
        onerror="this.src='/public/darkpaki-logo.png'"
        class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
      />

      <!-- Top Right Badge: Inline SVG Format Icon + Duration -->
      <div class="absolute top-1.5 right-1.5 z-10 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-sm text-white/95 text-[10px] font-mono font-medium shadow-md border border-white/10 pointer-events-none">
        ${isPortrait ? `
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
            <line x1="12" y1="18" x2="12.01" y2="18"></line>
          </svg>
        ` : `
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect>
            <polygon points="10 8 16 12 10 16 10 8" fill="currentColor"></polygon>
          </svg>
        `}
        <span>${escapeHtml(durDisplay)}</span>
      </div>

      <!-- Bottom Gradient Scrim: Views Icon + Count + Title -->
      <div class="absolute inset-x-0 bottom-0 z-10 pt-8 pb-2 px-2 bg-gradient-to-t from-[#0B0E14]/95 via-[#0B0E14]/65 to-transparent flex flex-col justify-end pointer-events-none">
        <div class="flex items-center gap-1 text-[10px] font-medium text-[#94A3B8]">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-[#94A3B8]">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
          <span class="font-mono text-[#F8FAFC]/90">${escapeHtml(viewsDisplay)}</span>
        </div>
        <p class="text-[11px] sm:text-xs font-semibold text-[#F8FAFC] truncate mt-0.5 drop-shadow-sm group-hover:text-purple-300 transition-colors">
          ${escapeHtml(video.title || 'Untitled')}
        </p>
      </div>
    `;

    grid.appendChild(tile);
  });
}

function handleTrendingSearchInput(val) {
  const clearBtn = document.getElementById('trendingClearSearchBtn');
  if (clearBtn) {
    if (val && val.trim().length > 0) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }
  }

  if (TRENDING_SEARCH_DEBOUNCE_TIMER) {
    clearTimeout(TRENDING_SEARCH_DEBOUNCE_TIMER);
  }

  TRENDING_SEARCH_DEBOUNCE_TIMER = setTimeout(() => {
    TRENDING_SEARCH_QUERY = (val || '').trim().toLowerCase();
    renderTrendingGrid();
  }, 300);
}

function clearTrendingSearch() {
  const input = document.getElementById('trendingSearchInput');
  const clearBtn = document.getElementById('trendingClearSearchBtn');
  if (input) input.value = '';
  if (clearBtn) clearBtn.classList.add('hidden');
  TRENDING_SEARCH_QUERY = '';
  renderTrendingGrid();
}

function setTrendingFormatFilter(format) {
  TRENDING_FORMAT_FILTER = format;
  const activeClass = "trend-filter-pill px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#7C3AED] text-[#F8FAFC] border border-[#7C3AED] flex items-center gap-1.5 transition shrink-0 shadow-md shadow-[#7C3AED]/20";
  const inactiveClass = "trend-filter-pill px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#131822] text-[#94A3B8] hover:text-[#F8FAFC] border border-white/[0.08] flex items-center gap-1.5 transition shrink-0";

  const btnAll = document.getElementById('trendFilterAll');
  const btnVideos = document.getElementById('trendFilterVideos');
  const btnShorts = document.getElementById('trendFilterShorts');

  if (btnAll) btnAll.className = format === 'all' ? activeClass : inactiveClass;
  if (btnVideos) btnVideos.className = format === 'videos' ? activeClass : inactiveClass;
  if (btnShorts) btnShorts.className = format === 'shorts' ? activeClass : inactiveClass;

  renderTrendingGrid();
}

function playTrendingVideoById(id) {
  const vid = TRENDING_VIDEOS_CACHE.find(v => v.id === id);
  if (!vid) return;

  const mapped = {
    id: vid.id,
    title: vid.title,
    creator: vid.creator || vid.owner_name || 'DarkPAKI VIP',
    views: vid.views || vid.views_count || 0,
    duration: vid.duration || 'HD',
    tag: vid.tag || '18+ TRENDING',
    thumbImg: vid.thumb_img || vid.thumbnail_url || vid.thumbImg || '/public/darkpaki-logo.png',
    src: vid.src || vid.video_url || vid.stream_url,
    requestedBy: vid.requested_by || 'VIP Members',
    is_short: vid.is_short
  };

  let idx = MEDIA_SOURCES.mainVideos.findIndex(v => v.id === id);
  if (idx === -1) {
    MEDIA_SOURCES.mainVideos.push(mapped);
    idx = MEDIA_SOURCES.mainVideos.length - 1;
  } else {
    MEDIA_SOURCES.mainVideos[idx] = mapped;
  }

  launchFeaturedFromHome(idx);
}

// ============================================================================
// NAVIGATION & UI UTILITIES
// ============================================================================
function switchView(mode) {
  const homeSec = document.getElementById('homeGuiSection');
  const watchSec = document.getElementById('watchPlayerSection');
  const demandSec = document.getElementById('demandAndCommentHub');
  const loginSec = document.getElementById('authLoginSection');
  const profileSec = document.getElementById('userProfileSection');
  const trendingSec = document.getElementById('trendingSection');

  [homeSec, watchSec, demandSec, loginSec, profileSec, trendingSec].forEach(sec => {
    if (sec) sec.classList.add('hidden');
  });

  if (mode !== 'watch' && videoEl && !videoEl.paused) {
    videoEl.pause();
    updatePlayPauseIcons();
  }

  // Bottom Navigation Highlight (Strict 3-Color Palette: #7C3AED Accent, #94A3B8 Muted)
  const botActive = "text-[#7C3AED] flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition";
  const botInactive = "text-[#94A3B8] hover:text-[#F8FAFC] flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition";
  const bHome = document.getElementById('bottomNavHome');
  const bTrend = document.getElementById('bottomNavTrending');
  const bProfile = document.getElementById('bottomNavProfile');
  if (bHome) bHome.className = mode === 'home' ? botActive : botInactive;
  if (bTrend) bTrend.className = mode === 'trending' ? botActive : botInactive;
  if (bProfile) bProfile.className = (mode === 'profile' || mode === 'earning') ? botActive : botInactive;

  if (mode === 'watch') {
    if (watchSec) watchSec.classList.remove('hidden');
  } else if (mode === 'demand') {
    if (demandSec) demandSec.classList.remove('hidden');
  } else if (mode === 'login') {
    if (loginSec) {
      loginSec.classList.remove('hidden');
      renderCloudflareTurnstile();
      initGoogleSignIn();
    }
  } else if (mode === 'earning') {
    if (profileSec) {
      profileSec.classList.remove('hidden');
      loadInstagramUserProfile().then(() => {
        switchCreatorStudioTab('monetization');
      });
    }
  } else if (mode === 'profile') {
    if (profileSec) {
      profileSec.classList.remove('hidden');
      loadInstagramUserProfile();
    }
  } else if (mode === 'trending') {
    if (trendingSec) trendingSec.classList.remove('hidden');
    loadTrendingGrid();
  } else {
    if (homeSec) homeSec.classList.remove('hidden');
    currentCategoryFilter = 'ALL';
    loadVideos();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function filterByCategory(category, btnEl) {
  currentCategoryFilter = category;
  document.querySelectorAll('.cat-pill').forEach(btn => {
    btn.className = "cat-pill px-3.5 py-1.5 rounded-xl text-[11px] sm:text-xs font-semibold bg-[#131822] hover:bg-[#18202d] text-[#94A3B8] hover:text-[#F8FAFC] border border-white/[0.08] transition shrink-0 flex items-center gap-1";
  });
  if (btnEl) {
    btnEl.className = "cat-pill px-3.5 py-1.5 rounded-xl text-[11px] sm:text-xs font-semibold bg-[#7C3AED] text-[#F8FAFC] shadow-lg shadow-[#7C3AED]/25 transition shrink-0 flex items-center gap-1";
  }
  loadVideos(document.getElementById('globalSearchInput')?.value || '');
}

function filterHomeCatalog(query) {
  loadVideos(query);
}

function handleSearchSubmit(e) {
  e.preventDefault();
  const q = document.getElementById('globalSearchInput')?.value || '';
  switchView('home');
  loadVideos(q);
  showToast(q ? `Showing results for "${q}"` : "Showing all 18+ streams");
}

function focusSearchBar() {
  switchView('home');
  setTimeout(() => {
    const input = document.getElementById('globalSearchInput');
    if (input) {
      input.focus();
      input.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 100);
}

function openTelegramChannel() {
  window.open(TELEGRAM_CHANNEL_URL, '_blank', 'noopener,noreferrer');
  showToast("Opening Official DarkPAKI 18+ VIP Telegram Channel...");
}

function selectQuickCreator(creatorText) {
  const input = document.getElementById('demandCreatorInput');
  if (input) {
    input.value = creatorText;
    input.focus();
  }
}

function handleDownloadClick(serverLabel, btnEl) {
  const selected = MEDIA_SOURCES.mainVideos[currentVideoIndex];
  if (ACTIVE_POPUNDER_URL) {
    try { window.open(ACTIVE_POPUNDER_URL, '_blank'); } catch (e) {}
  }
  if (btnEl) {
    const originalHTML = btnEl.innerHTML;
    btnEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Preparing 4K MP4...</span>`;
    setTimeout(() => {
      btnEl.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-400"></i> <span>Download Started!</span>`;
      setTimeout(() => { btnEl.innerHTML = originalHTML; }, 2200);
    }, 700);
  }
  document.getElementById('modalTitleText').textContent = `${serverLabel}`;
  document.getElementById('modalBodyText').textContent = `Direct high-speed 4K MP4 stream started for "${selected ? selected.title : 'Video'}" (${selected ? selected.duration : '10:00'}). Watching 1 short pre-roll ad keeps all 18+ servers ultra-fast!`;
  document.getElementById('sponsorModal').classList.remove('hidden');
}

function openSponsorModal(e) {
  if (e) e.preventDefault();
  videoEl.pause();
  document.getElementById('sponsorModal').classList.remove('hidden');
}

function closeSponsorModal() {
  document.getElementById('sponsorModal').classList.add('hidden');
  if (currentState === 'AD_PLAYING' || currentState === 'MAIN_PLAYING') {
    videoEl.play().catch(() => {});
  }
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' + secs : secs}`;
}

function showToast(msg) {
  if (!transitionToast || !toastMessage) return;
  toastMessage.textContent = msg;
  transitionToast.classList.remove('opacity-0');
  transitionToast.classList.add('opacity-100');
  setTimeout(() => {
    transitionToast.classList.remove('opacity-100');
    transitionToast.classList.add('opacity-0');
  }, 3200);
}

// ============================================================================
// 18+ VIP AI IMAGE STUDIO & COMMUNITY GALLERY
// ============================================================================
function selectQuickAiPrompt(text) {
  const promptInput = document.getElementById('aiPromptInput');
  if (promptInput) {
    promptInput.value = text;
    promptInput.focus();
    showToast('✨ Selected: ' + (text.length > 25 ? text.substring(0, 25) + '...' : text));
  }
}

async function handleGenerateAiImage(e) {
  if (e && e.preventDefault) e.preventDefault();
  const promptInput = document.getElementById('aiPromptInput');
  const styleSelect = document.getElementById('aiStyleSelect');
  const ratioInputs = document.querySelectorAll('input[name="aiRatio"]:checked');
  const generateBtn = document.getElementById('aiGenerateBtn');
  const btnText = document.getElementById('aiBtnText');
  const loadingOverlay = document.getElementById('aiLoadingOverlay');
  const statusBadge = document.getElementById('aiStatusBadge');
  const resultImg = document.getElementById('aiResultImg');
  const promptTag = document.getElementById('aiPromptTag');
  const downloadLink = document.getElementById('aiDownloadLink');

  const prompt = promptInput ? promptInput.value.trim() : '';
  if (!prompt) {
    showToast('⚠️ Please enter an image description prompt!');
    return;
  }
  const style = styleSelect ? styleSelect.value : 'Cyberpunk 18+';
  const ratio = (ratioInputs && ratioInputs.length > 0) ? ratioInputs[0].value : '1:1';

  try {
    if (generateBtn) generateBtn.disabled = true;
    if (btnText) btnText.textContent = 'Synthesizing 4K Image...';
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
    if (statusBadge) {
      statusBadge.textContent = 'Generating 4K...';
      statusBadge.className = 'text-[10px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full font-bold';
    }

    const res = await apiFetch('/ai/generate', {
      method: 'POST',
      body: JSON.stringify({ prompt, style, aspectRatio: ratio })
    });

    if (res && res.success && res.data) {
      if (resultImg) {
        resultImg.src = res.data.imageUrl;
      }
      if (promptTag) {
        promptTag.textContent = res.data.prompt.length > 30 ? res.data.prompt.substring(0, 30) + '...' : res.data.prompt;
      }
      if (downloadLink) {
        downloadLink.href = res.data.imageUrl;
      }
      if (statusBadge) {
        statusBadge.textContent = 'Generation Complete';
        statusBadge.className = 'text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold';
      }
      showToast('✨ 18+ AI Image generated successfully!');
      await loadAiGallery();
    } else {
      showToast('❌ Failed to generate AI image: ' + (res?.message || 'Server error'));
    }
  } catch (err) {
    console.error('AI generation error:', err);
    showToast('❌ AI Generation failed. Please try again.');
  } finally {
    if (generateBtn) generateBtn.disabled = false;
    if (btnText) btnText.textContent = 'Generate 18+ AI Image';
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
  }
}

async function loadAiGallery() {
  const galleryGrid = document.getElementById('aiGalleryGrid');
  if (!galleryGrid) return;

  try {
    const res = await apiFetch('/ai/gallery');
    if (res && res.success && Array.isArray(res.data)) {
      if (res.data.length === 0) {
        galleryGrid.innerHTML = `
          <div class="col-span-full py-8 text-center text-neutral-500 text-xs">
            No community AI images yet. Be the first to generate one above!
          </div>
        `;
        return;
      }
      galleryGrid.innerHTML = res.data.map(img => {
        const safePrompt = (img.prompt || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        return `
        <div class="group bg-[#0d0d14] border border-white/10 hover:border-fuchsia-500/50 rounded-2xl overflow-hidden transition shadow-lg flex flex-col">
          <div class="relative aspect-square w-full bg-black overflow-hidden">
            <img 
              src="${img.imageUrl}" 
              alt="${safePrompt}" 
              loading="lazy" 
              onerror="this.src='https://placehold.co/600x600/121218/d946ef?text=18%2B+AI+Art'"
              class="w-full h-full object-cover group-hover:scale-105 transition duration-500"
            >
            <span class="absolute top-2 left-2 bg-black/80 backdrop-blur-md text-fuchsia-400 border border-fuchsia-500/30 text-[9px] font-black px-2 py-0.5 rounded-full">
              ${img.style || '18+ VIP'}
            </span>
            <button 
              onclick="likeAiImage(${img.id}, this)" 
              class="absolute bottom-2 right-2 bg-black/80 hover:bg-rose-600 backdrop-blur-md text-white text-[11px] font-bold px-2.5 py-1 rounded-xl flex items-center gap-1 border border-white/20 transition cursor-pointer"
            >
              <i class="fa-solid fa-heart text-rose-500 group-hover:text-white"></i>
              <span class="ai-like-count">${img.likes || 0}</span>
            </button>
          </div>
          <div class="p-2.5 flex flex-col gap-1">
            <p class="text-xs text-neutral-200 line-clamp-2 leading-snug font-medium" title="${safePrompt}">
              ${img.prompt}
            </p>
            <div class="flex items-center justify-between text-[10px] text-neutral-500 mt-0.5">
              <span>Ratio: ${img.aspectRatio || '1:1'}</span>
              <button onclick="selectQuickAiPrompt('${safePrompt}')" class="text-fuchsia-400 hover:underline cursor-pointer">Use Prompt</button>
            </div>
          </div>
        </div>
      `;
      }).join('');
    }
  } catch (err) {
    console.warn('Failed to load AI gallery:', err.message);
  }
}

async function likeAiImage(id, btnEl) {
  try {
    const res = await apiFetch(`/ai/images/${id}/like`, { method: 'POST' });
    if (res && res.success) {
      if (btnEl) {
        const countSpan = btnEl.querySelector('.ai-like-count');
        if (countSpan) countSpan.textContent = res.likes;
        btnEl.classList.add('bg-rose-600', 'text-white');
      }
      showToast('❤️ Image upvoted!');
    }
  } catch (err) {
    showToast('⚠️ Could not record vote: ' + err.message);
  }
}

// Programmatic Event Bindings (Backup layer against strict CSP/Extension overrides)
function bindDirectDOMListeners() {
  const confirmBtn = document.getElementById('btnConfirmAgeGate');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', (e) => {
      e.preventDefault();
      confirmAgeGate();
    });
  }

  const rejectBtn = document.getElementById('btnRejectAgeGate');
  if (rejectBtn) {
    rejectBtn.addEventListener('click', (e) => {
      e.preventDefault();
      rejectAgeGate();
    });
  }

  // Bottom Nav Tabs
  const botHome = document.getElementById('bottomNavHome');
  if (botHome) botHome.addEventListener('click', (e) => { e.preventDefault(); switchView('home'); });
  const botTrending = document.getElementById('bottomNavTrending');
  if (botTrending) botTrending.addEventListener('click', (e) => { e.preventDefault(); switchView('trending'); });
  const botSearch = document.getElementById('bottomNavSearch');
  if (botSearch) botSearch.addEventListener('click', (e) => { e.preventDefault(); focusSearchBar(); });
  const botEarn = document.getElementById('bottomNavEarning');
  if (botEarn) botEarn.addEventListener('click', (e) => { e.preventDefault(); openEarningOrLogin(); });
  const botProfile = document.getElementById('bottomNavProfile');
  if (botProfile) botProfile.addEventListener('click', (e) => { e.preventDefault(); openProfileOrLogin(); });

  // Secret Admin Shortcut: Ctrl+Shift+A or 3 quick clicks on logo
  let logoClickCount = 0;
  let logoClickTimer = null;
  const logoImg = document.querySelector('header img');
  if (logoImg) {
    logoImg.addEventListener('click', (e) => {
      logoClickCount++;
      clearTimeout(logoClickTimer);
      if (logoClickCount >= 3) {
        logoClickCount = 0;
        window.location.href = '/admin';
      } else {
        logoClickTimer = setTimeout(() => { logoClickCount = 0; }, 800);
      }
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
      e.preventDefault();
      window.location.href = '/admin';
    }
  });
}

// ============================================================================
// BOOTSTRAP INITIALIZATION
// ============================================================================
window.onload = async function() {
  autoDetectDeviceViewport();
  bindDirectDOMListeners();
  checkAgeGate();
  await loadAdConfig();
  await loadVideos();
  await loadDemands();
  await loadComments();
  await loadCurrentUserProfile();
  await generateHumanChallenge();
  updateStepperUI('IDLE');
  switchView('home');
};


// ============================================================================
// COMMUNITY USER VIDEO UPLOADER & AUTO-DETECTION (YOUTUBE SHORTS STYLE)
// ============================================================================
let userGeneratedThumbDataUrl = null;

function openUserUploadModal() {
  const token = localStorage.getItem('darkpaki_auth_token');
  if (!CURRENT_USER && !token) {
    showToast("Please log in with your Gmail account to upload videos.");
    switchView('login');
    return;
  }

  document.getElementById('userUploadModal').classList.remove('hidden');
  if (CURRENT_USER) {
    const creatorInput = document.getElementById('userUploadCreator');
    if (creatorInput && !creatorInput.value) creatorInput.value = CURRENT_USER.name || '';
    const emailInput = document.getElementById('userUploadEmail');
    if (emailInput && !emailInput.value) emailInput.value = CURRENT_USER.gmail || '';
  }
}

function closeUserUploadModal() {
  document.getElementById('userUploadModal').classList.add('hidden');
}

function cleanDetectedTitle(filename) {
  let name = filename.replace(/\.[^/.]+$/, '');
  name = name.replace(/[._\-+]/g, ' ');
  name = name.replace(/\b(1080p|720p|480p|2160p|4k|60fps|x264|h264|x265|hevc|bluray|webrip|hd|rip|uncut|official|video|whatsapp)\b/gi, '');
  name = name.replace(/[\[\]\(\)\{\}]/g, ' ').replace(/\s+/g, ' ').trim();
  return name.replace(/\b\w/g, l => l.toUpperCase()) || 'Community Short';
}

function handleUserFileSelected(input) {
  if (input.files && input.files[0]) {
    const file = input.files[0];
    document.getElementById('userSelectedFileInfo').classList.remove('hidden');
    document.getElementById('userSelectedFileName').textContent = file.name;
    document.getElementById('userSelectedFileSize').textContent = `(${(file.size / (1024 * 1024)).toFixed(1)} MB)`;

    // 1. Auto Title Detection
    const title = cleanDetectedTitle(file.name);
    document.getElementById('userUploadTitle').value = title;
    const dt = document.getElementById('userDetectedTitle');
    if (dt) dt.textContent = title;

    // 2. Auto Duration & Canvas Thumbnail Capture
    const video = document.createElement('video');
    video.preload = 'metadata';
    const blobUrl = URL.createObjectURL(file);
    video.src = blobUrl;

    video.onloadedmetadata = () => {
      const durSec = Math.floor(video.duration);
      const m = Math.floor(durSec / 60);
      const s = durSec % 60;
      const formattedDuration = `${m}:${s < 10 ? '0' : ''}${s}`;
      document.getElementById('userUploadDuration').value = formattedDuration;
      const dd = document.getElementById('userDetectedDuration');
      if (dd) dd.textContent = formattedDuration;

      // Auto-select category: if vertical or <= 60s, select Shorts
      if (video.videoHeight > video.videoWidth || durSec <= 60) {
        document.getElementById('userUploadCategory').value = 'SHORTS';
      }

      video.currentTime = Math.min(1.5, video.duration * 0.15 || 0.5);
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(video.videoWidth || 640, 640);
        canvas.height = Math.min(video.videoHeight || 360, 360);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        userGeneratedThumbDataUrl = canvas.toDataURL('image/jpeg', 0.85);

        const box = document.getElementById('userDetectedThumbBox');
        const img = document.getElementById('userDetectedThumbImg');
        if (box && img) {
          img.src = userGeneratedThumbDataUrl;
          box.classList.remove('hidden');
        }
      } catch (err) {
        console.warn('Canvas thumb notice:', err);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }
}

async function handleUserUploadSubmit(event) {
  event.preventDefault();
  const fileInput = document.getElementById('userVideoFileInput');
  if (!fileInput.files || !fileInput.files[0]) {
    showToast('Please select a video file first!');
    return;
  }

  const file = fileInput.files[0];
  const title = document.getElementById('userUploadTitle').value.trim() || file.name.replace(/\.[^/.]+$/, '');
  const category = document.getElementById('userUploadCategory').value;
  const duration = document.getElementById('userUploadDuration').value.trim() || '0:45';
  const creator = document.getElementById('userUploadCreator').value.trim() || (CURRENT_USER ? CURRENT_USER.name : 'Community Creator');
  const ownerEmail = document.getElementById('userUploadEmail').value.trim() || (CURRENT_USER ? CURRENT_USER.gmail : '');
  const isShort = category === 'SHORTS' ? '1' : '0';

  const progressContainer = document.getElementById('userUploadProgressContainer');
  const progressBar = document.getElementById('userUploadProgressBar');
  const progressPct = document.getElementById('userUploadProgressPct');
  const progressStatus = document.getElementById('userUploadProgressStatus');
  const submitBtn = document.getElementById('userUploadSubmitBtn');

  progressContainer.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressPct.textContent = '0%';
  progressStatus.textContent = 'Preparing video upload...';
  submitBtn.disabled = true;

  // 1. If base64 thumbnail was generated from canvas, persist it cleanly first to prevent URI length errors
  let serverThumbUrl = '';
  if (userGeneratedThumbDataUrl && userGeneratedThumbDataUrl.startsWith('data:image')) {
    try {
      progressStatus.textContent = 'Saving high-resolution thumbnail...';
      const thumbRes = await fetch('/api/videos/upload-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: userGeneratedThumbDataUrl })
      });
      const thumbData = await thumbRes.json();
      if (thumbData && thumbData.thumbUrl) {
        serverThumbUrl = thumbData.thumbUrl;
      }
    } catch (tErr) {
      console.warn('[Thumbnail Pre-upload Warning]', tErr);
    }
  }

  // 2. Safe and compact query params (under 200 bytes)
  const queryParams = new URLSearchParams({
    title,
    category,
    duration,
    ownerName: creator,
    ownerEmail,
    isShort,
    thumb: serverThumbUrl
  });

  const uploadUrl = `/api/videos/user-upload?${queryParams.toString()}`;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('title', title);
  formData.append('category', category);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', uploadUrl, true);

  xhr.upload.onprogress = (ev) => {
    if (ev.lengthComputable) {
      const pct = Math.min(95, Math.round((ev.loaded / ev.total) * 95));
      progressBar.style.width = `${pct}%`;
      progressPct.textContent = `${pct}%`;
      progressStatus.textContent = `Streaming bytes: ${(ev.loaded / (1024 * 1024)).toFixed(1)} MB / ${(ev.total / (1024 * 1024)).toFixed(1)} MB (${pct}%)`;
    }
  };

  xhr.upload.onload = () => {
    progressBar.style.width = '96%';
    progressPct.textContent = '96%';
    progressStatus.textContent = 'Verifying stream & queuing for Admin approval...';
  };

  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      progressBar.style.width = '100%';
      progressPct.textContent = '100%';
      progressStatus.textContent = 'Submitted to Admin Review Queue!';
      
      closeUserUploadModal();
      showToast('🎉 Video submitted for Admin review!', 'success');
      
      fileInput.value = '';
      userGeneratedThumbDataUrl = null;
      document.getElementById('userSelectedFileInfo').classList.add('hidden');
      document.getElementById('userDetectedThumbBox').classList.add('hidden');
      document.getElementById('userUploadTitle').value = '';

      // Immediately refresh creator profile & analytics
      if (typeof loadProfilePosts === 'function') loadProfilePosts();
      if (typeof loadCreatorAnalytics === 'function') loadCreatorAnalytics();
      if (typeof refreshUserProfile === 'function') refreshUserProfile();
    } else {
      let errMsg = 'Upload failed';
      try {
        const errJson = JSON.parse(xhr.responseText);
        errMsg = errJson.message || errMsg;
      } catch (e) {
        errMsg = `Upload failed (Status ${xhr.status}). Please check connection.`;
      }
      showToast(errMsg, 'error');
      progressStatus.textContent = 'Upload failed. Try again.';
    }
    submitBtn.disabled = false;
  };

  xhr.onerror = () => {
    showToast('Network error during upload. Please check connection.', 'error');
    progressStatus.textContent = 'Network error.';
    submitBtn.disabled = false;
  };

  xhr.send(formData);
}

// ============================================================================
// CREATOR FOLLOW SYSTEM
// ============================================================================
async function toggleFollowCreator(creatorName, event) {
  if (event) event.stopPropagation();
  try {
    const res = await apiFetch('/earning/follow', {
      method: 'POST',
      body: JSON.stringify({ creatorName })
    });
    if (res.success) {
      showToast(res.message);
      // Update follow button text if on screen
      const followBtns = document.querySelectorAll(`[data-creator-follow="${creatorName}"]`);
      followBtns.forEach(btn => {
        btn.textContent = res.isFollowing ? '✓ Following' : '+ Follow';
        btn.classList.toggle('bg-white/20', res.isFollowing);
        btn.classList.toggle('bg-rose-600', !res.isFollowing);
      });
      // Refresh videos
      initMainMediaSources();
    }
  } catch (err) {
    showToast('Follow note: ' + err.message);
  }
}

// ============================================================================
// CREATOR MONETIZATION (PARTNER PROGRAM) JAVASCRIPT
// ============================================================================
async function checkAndOpenMonetizationModal() {
  if (!AUTH_TOKEN) {
    showToast('Please log in first to view Creator Monetization status.');
    openEarningOrLogin();
    return;
  }

  try {
    const res = await apiFetch('/earning/monetization-status');
    if (res.success && res.data) {
      const d = res.data;
      if (d.isMonetized) {
        showToast('★ Congratulations! Your channel is actively MONETIZED.');
        return;
      }
      if (d.applicationStatus === 'PENDING') {
        showToast('⏳ Your Monetization Application is currently in review with DarkPAKI Admin.');
        return;
      }
      if (!d.isEligible) {
        alert(`Creator Monetization Eligibility Status:\n\n1. Highest Video Views: ${d.maxViews} / 1,000 views ${d.meetsViewsRequirement ? '✓' : '✕'}\n2. Followers: ${d.followersCount} / 10 followers ${d.meetsFollowersRequirement ? '✓' : '✕'}\n\nYou need at least 1 video with 1,000+ views and 10+ followers to apply!`);
        return;
      }

      // Eligible! Open modal
      document.getElementById('monetizeBestViewsText').textContent = `${d.maxViews} views`;
      document.getElementById('monetizeFollowersText').textContent = `${d.followersCount} followers`;
      if (CURRENT_USER) {
        document.getElementById('monetizeRealName').value = CURRENT_USER.name || '';
        document.getElementById('monetizeRealGmail').value = CURRENT_USER.gmail || '';
        document.getElementById('monetizeChannelName').value = CURRENT_USER.name || '';
        document.getElementById('monetizePhone').value = CURRENT_USER.phone || '';
      }
      document.getElementById('applyMonetizationModal').classList.remove('hidden');
    }
  } catch (err) {
    showToast('Monetization status note: ' + err.message);
  }
}

function closeMonetizationModal() {
  document.getElementById('applyMonetizationModal').classList.add('hidden');
}

async function handleMonetizationSubmit(event) {
  event.preventDefault();
  const realName = document.getElementById('monetizeRealName').value.trim();
  const email = document.getElementById('monetizeRealGmail').value.trim();
  const channelName = document.getElementById('monetizeChannelName').value.trim();
  const phone = document.getElementById('monetizePhone').value.trim();

  const btn = document.getElementById('monetizeSubmitBtn');
  btn.disabled = true;

  try {
    const res = await apiFetch('/earning/apply-monetization', {
      method: 'POST',
      body: JSON.stringify({ realName, email, channelName, phone })
    });
    if (res.success) {
      closeMonetizationModal();
      alert('🎉 Monetization Application Submitted!\n\nDarkPAKI Admin will verify your channel, original content, and authentic followers. Once approved, your videos will display the verified Gold Monetization badge and earn revenue!');
      refreshEarningDashboardUI();
    } else {
      showToast(res.message || 'Submission failed');
    }
  } catch (err) {
    showToast('Application error: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}

// Auto-initialize Google Identity Services & Cloudflare Turnstile on page load
window.addEventListener('load', () => {
  setTimeout(initGoogleSignIn, 1200);
  setTimeout(renderCloudflareTurnstile, 600);
});


// ============================================================================
// INSTAGRAM-STYLE USER PROFILE & EDIT PROFILE SYSTEM (FULL-STACK ZERO-MOCK)
// ============================================================================
let CURRENT_PROFILE_DATA = null;
let CURRENT_PROFILE_TAB = 'posts';
let PROFILE_POSTS_CACHE = [];
let CURRENT_VIEWER_POST = null;
let USERNAME_CHECK_TIMER = null;

function updateHeaderProfileUI(user) {
  const headerAvatarImg = document.getElementById('headerAvatarImg');
  const headerAvatarDefault = document.getElementById('headerAvatarDefaultIcon');
  const headerProfileText = document.getElementById('headerProfileText');
  const bottomAvatarImg = document.getElementById('bottomNavAvatarImg');
  const bottomAvatarIcon = document.getElementById('bottomNavAvatarIcon');

  if (user && user.id) {
    if (headerProfileText) {
      headerProfileText.textContent = user.username ? ('@' + user.username) : (user.name || 'Profile');
    }
    if (user.avatar_url && user.avatar_url.trim()) {
      if (headerAvatarImg) {
        headerAvatarImg.src = user.avatar_url;
        headerAvatarImg.classList.remove('hidden');
      }
      if (headerAvatarDefault) headerAvatarDefault.classList.add('hidden');
      if (bottomAvatarImg) {
        bottomAvatarImg.src = user.avatar_url;
        bottomAvatarImg.classList.remove('hidden');
      }
      if (bottomAvatarIcon) bottomAvatarIcon.classList.add('hidden');
    } else {
      if (headerAvatarImg) headerAvatarImg.classList.add('hidden');
      if (headerAvatarDefault) headerAvatarDefault.classList.remove('hidden');
      if (bottomAvatarImg) bottomAvatarImg.classList.add('hidden');
      if (bottomAvatarIcon) bottomAvatarIcon.classList.remove('hidden');
    }
  } else {
    if (headerProfileText) headerProfileText.textContent = 'Profile';
    if (headerAvatarImg) headerAvatarImg.classList.add('hidden');
    if (headerAvatarDefault) headerAvatarDefault.classList.remove('hidden');
    if (bottomAvatarImg) bottomAvatarImg.classList.add('hidden');
    if (bottomAvatarIcon) bottomAvatarIcon.classList.remove('hidden');
  }
}

function openProfileOrLogin() {
  if (AUTH_TOKEN) {
    switchView('profile');
  } else {
    switchView('login');
    showToast("Please log in to access your profile");
  }
}

function openAccountSwitchDropdown() {
  openProfileDrawer();
}

async function loadInstagramUserProfile() {
  if (!AUTH_TOKEN) {
    openProfileOrLogin();
    return;
  }

  try {
    const res = await apiFetch('/profile/me');
    if (res.success && res.data) {
      CURRENT_PROFILE_DATA = res.data;
      renderProfileHeaderUI(CURRENT_PROFILE_DATA);
      updateHeaderProfileUI(CURRENT_PROFILE_DATA);
      await loadProfileGridPosts(CURRENT_PROFILE_TAB);
    }
  } catch (err) {
    console.error('Failed to load user profile:', err);
    showToast('Failed to load profile. Please sign in again.');
    switchView('login');
  }
}

let CURRENT_STUDIO_TAB = 'overview';
let CREATOR_SETTINGS_CACHE = null;

function switchCreatorStudioTab(tab) {
  if (tab === 'earnings') tab = 'monetization';
  CURRENT_STUDIO_TAB = tab;

  const tabs = ['overview', 'monetization', 'analytics', 'settings'];
  tabs.forEach(t => {
    const btn = document.getElementById(`studioTab${t.charAt(0).toUpperCase() + t.slice(1)}Btn`) ||
                (t === 'monetization' ? document.getElementById('studioTabEarningsBtn') : null);
    const view = document.getElementById(`studioView${t.charAt(0).toUpperCase() + t.slice(1)}`) ||
                 (t === 'monetization' ? document.getElementById('studioViewEarnings') : null);
    if (t === tab) {
      if (btn) {
        btn.className = "px-3 py-1.5 rounded-lg text-xs font-semibold text-[#F8FAFC] bg-[#7C3AED] transition flex items-center gap-1.5 shrink-0";
      }
      if (view) view.classList.remove('hidden');
    } else {
      if (btn) {
        btn.className = "px-3 py-1.5 rounded-lg text-xs font-semibold text-[#94A3B8] hover:text-[#F8FAFC] transition flex items-center gap-1.5 shrink-0";
      }
      if (view) view.classList.add('hidden');
    }
  });

  if (tab === 'monetization') {
    refreshEarningDashboardUI();
  } else if (tab === 'analytics') {
    loadCreatorAnalytics();
  } else if (tab === 'settings') {
    loadCreatorSettings();
  }
}

// Global window registration
window._switchCreatorStudioTab = switchCreatorStudioTab;
window.switchCreatorStudioTab = switchCreatorStudioTab;

// ----------------------------------------------------------------------------
// FULL-STACK CREATOR ANALYTICS (SQLite Backend Connection)
// ----------------------------------------------------------------------------
async function loadCreatorAnalytics() {
  const vViews = document.getElementById('analyticsTotalViews');
  const vReach = document.getElementById('analyticsProfileReach');
  const vUploads = document.getElementById('analyticsUploadsCount');
  const vFollowers = document.getElementById('analyticsFollowersCount');
  const vRate = document.getElementById('analyticsEngagementRate');
  const vLikes = document.getElementById('analyticsTotalLikes');
  const vComments = document.getElementById('analyticsTotalComments');
  const chartContainer = document.getElementById('analyticsDailyChart');
  const topVideosContainer = document.getElementById('analyticsTopVideosList');

  try {
    const res = await apiFetch('/profile/analytics');
    if (!res.success || !res.data) return;

    const { summary, top_videos, daily_views, traffic_sources } = res.data;

    if (vViews) vViews.textContent = (summary.total_views || 0).toLocaleString();
    if (vReach) vReach.textContent = (summary.profile_reach || 0).toLocaleString();
    if (vUploads) vUploads.textContent = (summary.total_uploads || 0).toLocaleString();
    if (vFollowers) vFollowers.textContent = (summary.followers_count || 0).toLocaleString();
    if (vRate) vRate.textContent = summary.engagement_rate || '0.0%';
    if (vLikes) vLikes.textContent = (summary.total_likes || 0).toLocaleString();
    if (vComments) vComments.textContent = (summary.total_comments || 0).toLocaleString();

    // Render 7-day SVG performance chart
    if (chartContainer && Array.isArray(daily_views)) {
      const maxVal = Math.max(...daily_views.map(d => d.views), 10);
      chartContainer.innerHTML = `
        <div class="flex items-end justify-between gap-2 h-32 pt-4 px-2">
          ${daily_views.map(d => {
            const pct = Math.max(8, Math.round((d.views / maxVal) * 100));
            return `
              <div class="flex-1 flex flex-col items-center gap-2 group">
                <div class="text-[10px] font-mono text-[#94A3B8] group-hover:text-[#7C3AED] transition">${d.views > 0 ? d.views.toLocaleString() : '0'}</div>
                <div class="w-full bg-[#18202d] rounded-t-lg h-24 flex items-end overflow-hidden p-1">
                  <div class="w-full bg-[#7C3AED] hover:bg-[#6D28D9] rounded-t-md transition-all duration-500 shadow-lg shadow-[#7C3AED]/20" style="height: ${pct}%;"></div>
                </div>
                <span class="text-[11px] font-semibold text-[#94A3B8] font-mono">${d.day}</span>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // Render top performing videos
    if (topVideosContainer) {
      if (!top_videos || top_videos.length === 0) {
        topVideosContainer.innerHTML = `
          <div class="py-8 text-center text-xs text-[#94A3B8]">
            No uploaded videos yet. Upload content to see top video metrics.
          </div>
        `;
      } else {
        topVideosContainer.innerHTML = top_videos.map((vid, idx) => `
          <div class="flex items-center justify-between p-3 rounded-xl bg-[#0B0E14] border border-white/[0.06] hover:border-[#7C3AED]/30 transition gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <span class="text-xs font-mono font-bold text-[#7C3AED] w-4">#${idx + 1}</span>
              <div class="w-14 h-9 rounded-lg bg-[#131822] overflow-hidden shrink-0 relative">
                <img src="${vid.thumb_img || '/public/darkpaki-logo.png'}" alt="thumb" class="w-full h-full object-cover">
              </div>
              <div class="min-w-0">
                <h5 class="text-xs font-semibold text-[#F8FAFC] truncate">${escapeHtml(vid.title || 'Untitled')}</h5>
                <span class="text-[10px] text-[#94A3B8] font-mono">${vid.duration || '4K'}</span>
              </div>
            </div>
            <div class="flex items-center gap-4 text-xs font-mono shrink-0">
              <span class="text-[#F8FAFC] flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" class="text-[#7C3AED]">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
                ${(vid.views_count || 0).toLocaleString()}
              </span>
              <span class="text-[#94A3B8] flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" class="text-rose-400">
                  <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
                </svg>
                ${(vid.likes_count || 0).toLocaleString()}
              </span>
            </div>
          </div>
        `).join('');
      }
    }

    // Render authentic traffic sources (Zero mock/fake data)
    const trafficContainer = document.getElementById('analyticsTrafficSourcesContainer');
    const trafficTotal = document.getElementById('analyticsTrafficTotalViews');
    if (trafficTotal) {
      trafficTotal.textContent = `${(summary.total_views || 0).toLocaleString()} Views`;
    }

    if (trafficContainer) {
      if (!traffic_sources || traffic_sources.length === 0 || (summary.total_views || 0) === 0) {
        trafficContainer.innerHTML = `
          <div class="py-3 text-center text-[10px] text-[#94A3B8]">
            No traffic recorded yet. Publish videos and get views to see distribution.
          </div>
        `;
      } else {
        trafficContainer.innerHTML = traffic_sources.map(src => `
          <div>
            <div class="flex justify-between text-[10px] mb-0.5">
              <span class="text-[#94A3B8]">${escapeHtml(src.name)}</span>
              <span class="font-mono" style="color: ${src.color || '#7C3AED'}">${src.percentage}% (${(src.views || 0).toLocaleString()})</span>
            </div>
            <div class="w-full bg-[#0B0E14] h-1.5 rounded-full overflow-hidden">
              <div class="h-full rounded-full transition-all duration-500" style="width: ${src.percentage}%; background-color: ${src.color || '#7C3AED'};"></div>
            </div>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    console.error('Failed to load analytics:', err);
  }
}
window.loadCreatorAnalytics = loadCreatorAnalytics;

// ----------------------------------------------------------------------------
// FULL-STACK CREATOR SETTINGS (SQLite Backend Connection)
// ----------------------------------------------------------------------------
async function loadCreatorSettings() {
  try {
    const res = await apiFetch('/profile/settings');
    if (!res.success || !res.data) return;

    CREATOR_SETTINGS_CACHE = res.data;
    const d = res.data;

    const emailEl = document.getElementById('settingsUserEmail');
    if (emailEl) emailEl.textContent = d.gmail || 'user@gmail.com';

    const phoneEl = document.getElementById('settingsUserPhone');
    if (phoneEl) phoneEl.textContent = d.phone || 'Protected';

    const handleEl = document.getElementById('settingsUserHandle');
    if (handleEl) handleEl.textContent = '@' + (d.username || 'user');

    const deviceEl = document.getElementById('settingsUserDevice');
    if (deviceEl) deviceEl.textContent = d.device_id || 'DPK-DEVICE';

    // Payout settings
    const pTypeEl = document.getElementById('settingsPayoutTypeSelect');
    if (pTypeEl && d.payout?.default_type) pTypeEl.value = d.payout.default_type;

    const pAddrEl = document.getElementById('settingsPayoutAddressInput');
    if (pAddrEl && d.payout?.default_address) pAddrEl.value = d.payout.default_address;

    // Preferences checkboxes
    const cmtEl = document.getElementById('prefAllowComments');
    if (cmtEl) cmtEl.checked = d.preferences?.allow_comments !== false;

    const wmkEl = document.getElementById('prefShowWatermark');
    if (wmkEl) wmkEl.checked = d.preferences?.show_watermark !== false;

    const notifEl = document.getElementById('prefEmailNotifications');
    if (notifEl) notifEl.checked = d.preferences?.email_notifications !== false;

    // Auto-populate withdrawal input in Monetization if empty
    const withdrawAddr = document.getElementById('withdrawUpiInput');
    if (withdrawAddr && !withdrawAddr.value && d.payout?.default_address) {
      withdrawAddr.value = d.payout.default_address;
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}
window.loadCreatorSettings = loadCreatorSettings;

async function savePayoutSettings(e) {
  if (e) e.preventDefault();
  const pType = document.getElementById('settingsPayoutTypeSelect')?.value || 'BINANCE_PAY';
  const pAddr = document.getElementById('settingsPayoutAddressInput')?.value || '';

  if (!pAddr.trim()) {
    showToast('Please enter your Binance Pay ID or USDT wallet address');
    return;
  }

  try {
    const res = await apiFetch('/profile/settings/payout', {
      method: 'PUT',
      body: JSON.stringify({ payout_type: pType, payout_address: pAddr.trim() })
    });
    if (res.success) {
      showToast('Default payout wallet saved successfully!');
      const withdrawAddr = document.getElementById('withdrawUpiInput');
      if (withdrawAddr) withdrawAddr.value = pAddr.trim();
    }
  } catch (err) {
    showToast(err.message || 'Failed to save payout settings');
  }
}
window.savePayoutSettings = savePayoutSettings;

async function saveCreatorPreferences(e) {
  if (e) e.preventDefault();
  const allowComments = document.getElementById('prefAllowComments')?.checked ?? true;
  const showWatermark = document.getElementById('prefShowWatermark')?.checked ?? true;
  const emailNotifications = document.getElementById('prefEmailNotifications')?.checked ?? true;

  try {
    const res = await apiFetch('/profile/settings/preferences', {
      method: 'PUT',
      body: JSON.stringify({
        allow_comments: allowComments,
        show_watermark: showWatermark,
        email_notifications: emailNotifications
      })
    });
    if (res.success) {
      showToast('Creator preferences saved successfully!');
    }
  } catch (err) {
    showToast(err.message || 'Failed to save preferences');
  }
}
window.saveCreatorPreferences = saveCreatorPreferences;

function renderProfileHeaderUI(data) {
  // Top Username
  const topUsername = document.getElementById('profileTopUsername');
  if (topUsername) topUsername.textContent = '@' + (data.username || 'user');

  // Display Name & Pronouns
  const dispName = document.getElementById('profileDisplayName');
  if (dispName) dispName.textContent = data.name || 'DarkPAKI User';

  const pronounsEl = document.getElementById('profilePronouns');
  if (pronounsEl) {
    if (data.pronouns && data.pronouns.trim()) {
      pronounsEl.textContent = '(' + data.pronouns.trim() + ')';
      pronounsEl.classList.remove('hidden');
    } else {
      pronounsEl.classList.add('hidden');
    }
  }

  // Rounded Avatar
  const avatarImg = document.getElementById('profileAvatarImg');
  const avatarPlaceholder = document.getElementById('profileAvatarPlaceholder');
  if (data.avatar_url && data.avatar_url.trim()) {
    if (avatarImg) {
      avatarImg.src = data.avatar_url;
      avatarImg.classList.remove('hidden');
    }
    if (avatarPlaceholder) avatarPlaceholder.classList.add('hidden');
  } else {
    if (avatarImg) avatarImg.classList.add('hidden');
    if (avatarPlaceholder) avatarPlaceholder.classList.remove('hidden');
  }

  // 4 Creator Stats Bar: Posts, Followers, Following, Total Views
  const postsCountEl = document.getElementById('profileStatPosts');
  const followersCountEl = document.getElementById('profileStatFollowers');
  const followingCountEl = document.getElementById('profileStatFollowing');
  const viewsCountEl = document.getElementById('profileStatViews');
  if (postsCountEl) postsCountEl.textContent = data.posts_count || 0;
  if (followersCountEl) followersCountEl.textContent = data.followers_count || 0;
  if (followingCountEl) followingCountEl.textContent = data.following_count || 0;
  if (viewsCountEl) viewsCountEl.textContent = (data.dashboard?.views || 0).toLocaleString();

  // Multi-line Bio Rendering (Preserve line breaks)
  const bioContainer = document.getElementById('profileBioContainer');
  const bioText = document.getElementById('profileBioText');
  const emptyBioPrompt = document.getElementById('profileEmptyBioPrompt');
  if (data.bio && data.bio.trim()) {
    if (bioContainer) bioContainer.classList.remove('hidden');
    if (bioText) bioText.textContent = data.bio.trim();
    if (emptyBioPrompt) emptyBioPrompt.classList.add('hidden');
  } else {
    if (bioContainer) bioContainer.classList.add('hidden');
    if (emptyBioPrompt) emptyBioPrompt.classList.remove('hidden');
  }

  // Clickable External Links Section (Pill style with SVG Link icon)
  const linksContainer = document.getElementById('profileLinksContainer');
  if (linksContainer) {
    if (Array.isArray(data.links) && data.links.length > 0) {
      linksContainer.classList.remove('hidden');
      linksContainer.innerHTML = data.links.map(link => {
        let cleanUrl = link.url;
        if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
          cleanUrl = 'https://' + cleanUrl;
        }
        return `
          <a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5 text-xs text-[#7C3AED] hover:underline font-semibold truncate max-w-full bg-[#0B0E14] border border-white/[0.08] px-3 py-1.5 rounded-lg transition">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="text-[#94A3B8] shrink-0">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            <span class="truncate">${escapeHtml(link.title || link.url)}</span>
          </a>
        `;
      }).join('');
    } else {
      linksContainer.classList.add('hidden');
      linksContainer.innerHTML = '';
    }
  }

  // Creator Studio: Overview Sub-View (Coins & Real Balance)
  const coinsVal = data.coins !== undefined ? data.coins : (CURRENT_USER && CURRENT_USER.coins !== undefined ? CURRENT_USER.coins : 50);
  const balVal = data.balance !== undefined ? data.balance : (CURRENT_USER && CURRENT_USER.balance !== undefined ? CURRENT_USER.balance : 0);

  const overBal = document.getElementById('overviewWalletBalance');
  if (overBal) overBal.textContent = `$${balVal.toFixed(balVal < 1 ? 3 : 2)}`;
  const overCoins = document.getElementById('overviewCoinsBalance');
  if (overCoins) overCoins.textContent = (coinsVal || 0).toLocaleString();
  const uCoins = document.getElementById('userCoinsBalance');
  if (uCoins) uCoins.textContent = (coinsVal || 0).toLocaleString();
  const uBal = document.getElementById('userWalletBalance');
  if (uBal) uBal.textContent = `$${balVal.toFixed(balVal < 1 ? 3 : 2)}`;

  const overViews = document.getElementById('overviewViewsCount');
  if (overViews) overViews.textContent = (data.dashboard?.views || 0).toLocaleString();

  // Creator Studio: Analytics Sub-View
  const aViews = document.getElementById('analyticsTotalViews');
  if (aViews) aViews.textContent = (data.dashboard?.views || 0).toLocaleString();
  const aReach = document.getElementById('analyticsProfileReach');
  if (aReach) aReach.textContent = (data.dashboard?.accounts_reached || 0).toLocaleString();
  const aUploads = document.getElementById('analyticsUploadsCount');
  if (aUploads) aUploads.textContent = (data.posts_count || 0).toLocaleString();
  const aFollowers = document.getElementById('analyticsFollowersCount');
  if (aFollowers) aFollowers.textContent = (data.followers_count || 0).toLocaleString();

  // Creator Studio: Settings Sub-View
  const setEmail = document.getElementById('settingsUserEmail');
  if (setEmail) setEmail.textContent = data.gmail || (CURRENT_USER ? CURRENT_USER.gmail : 'user@gmail.com');
  const setDevice = document.getElementById('settingsUserDevice');
  if (setDevice) setDevice.textContent = data.device_id || (CURRENT_USER ? (CURRENT_USER.deviceId || CURRENT_USER.device_id) : 'DPK-DEVICE');
}

function switchProfileTab(tab) {
  CURRENT_PROFILE_TAB = tab;

  const btnVideos = document.getElementById('profileTabVideosBtn');
  const btnPosts = document.getElementById('profileTabPostsBtn');
  const btnSaved = document.getElementById('profileTabSavedBtn');

  const activeCls = "pb-3 border-b-2 border-[#7C3AED] text-[#F8FAFC] font-semibold text-sm flex items-center gap-2 transition px-2";
  const inactiveCls = "pb-3 border-b-2 border-transparent text-[#94A3B8] hover:text-[#F8FAFC] font-semibold text-sm flex items-center gap-2 transition px-2";

  if (btnVideos) btnVideos.className = tab === 'videos' ? activeCls : inactiveCls;
  if (btnPosts) btnPosts.className = tab === 'posts' ? activeCls : inactiveCls;
  if (btnSaved) btnSaved.className = tab === 'saved' ? activeCls : inactiveCls;

  loadProfileGridPosts(tab);
}

async function loadProfileGridPosts(tab) {
  const grid = document.getElementById('profileMediaGrid');
  const emptyState = document.getElementById('profileGridEmptyState');
  const emptyIcon = document.getElementById('profileEmptyIcon');
  const emptyTitle = document.getElementById('profileEmptyTitle');
  const emptyDesc = document.getElementById('profileEmptyDesc');
  const emptyActionBtn = document.getElementById('profileEmptyActionBtn');

  if (!grid || !emptyState) return;

  grid.innerHTML = '<div class="col-span-full py-12 flex items-center justify-center text-[#94A3B8]"><div class="w-8 h-8 border-2 border-[#7C3AED] border-t-transparent rounded-full animate-spin"></div></div>';

  try {
    const res = await apiFetch(`/profile/posts?tab=${encodeURIComponent(tab)}`);
    PROFILE_POSTS_CACHE = (res.success && Array.isArray(res.data)) ? res.data : [];

    if (PROFILE_POSTS_CACHE.length === 0) {
      grid.classList.add('hidden');
      grid.innerHTML = '';
      emptyState.classList.remove('hidden');

      if (tab === 'saved') {
        if (emptyTitle) emptyTitle.textContent = "No Saved Videos";
        if (emptyDesc) emptyDesc.textContent = "Save videos to watch later. Videos you bookmark will appear here.";
        if (emptyActionBtn) {
          emptyActionBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            <span>Explore Videos</span>
          `;
          emptyActionBtn.onclick = () => switchView('home');
        }
      } else if (tab === 'posts') {
        if (emptyTitle) emptyTitle.textContent = "No Posts Yet";
        if (emptyDesc) emptyDesc.textContent = "Publish updates or photo posts to share with your audience.";
        if (emptyActionBtn) {
          emptyActionBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span>Create First Post</span>
          `;
          emptyActionBtn.onclick = () => openUserUploadModal();
        }
      } else {
        if (emptyTitle) emptyTitle.textContent = "No Videos Published Yet";
        if (emptyDesc) emptyDesc.textContent = "Upload your video to start building your audience and unlocking earnings.";
        if (emptyActionBtn) {
          emptyActionBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            <span>Upload First Video</span>
          `;
          emptyActionBtn.onclick = () => openUserUploadModal();
        }
      }
    } else {
      emptyState.classList.add('hidden');
      grid.classList.remove('hidden');

      grid.innerHTML = PROFILE_POSTS_CACHE.map(post => {
        const thumb = post.thumb_img || '/public/darkpaki-logo.png';
        const viewsCount = (post.views_count || post.views || 0).toLocaleString();
        const duration = post.duration || '4K';
        const pinnedBadge = post.is_pinned ? `
          <div class="absolute top-2.5 left-2.5 bg-[#7C3AED] text-white text-[10px] font-bold px-2 py-0.5 rounded-md shadow-md flex items-center gap-1 z-10">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="17" x2="12" y2="22"/>
              <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>
            </svg>
            <span>PINNED</span>
          </div>
        ` : '';

        return `
          <div onclick="openProfileMediaViewer(${post.id})" class="bg-[#131822] border border-white/[0.08] hover:border-[#7C3AED]/50 rounded-2xl overflow-hidden group cursor-pointer transition duration-300 shadow-lg flex flex-col">
            <!-- 16:9 Thumbnail Container -->
            <div class="relative aspect-video w-full bg-[#0B0E14] overflow-hidden">
              <img src="${thumb}" alt="${escapeHtml(post.title || 'Video')}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500 ease-out">
              ${pinnedBadge}
              
              <!-- Duration Badge -->
              <div class="absolute bottom-2 right-2 bg-[#0B0E14]/85 backdrop-blur-md border border-white/10 text-white text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md">
                ${duration}
              </div>

              <!-- Play Icon Overlay on Hover -->
              <div class="absolute inset-0 bg-[#0B0E14]/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                <div class="w-11 h-11 rounded-xl bg-[#7C3AED] text-white flex items-center justify-center shadow-lg shadow-[#7C3AED]/40 transform scale-90 group-hover:scale-100 transition">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                </div>
              </div>
            </div>

            <!-- Video Info Footer -->
            <div class="p-3.5 flex flex-col justify-between flex-1 gap-2">
              <h4 class="text-xs sm:text-sm font-semibold text-[#F8FAFC] line-clamp-2 group-hover:text-[#7C3AED] transition">
                ${escapeHtml(post.title || 'Untitled Video')}
              </h4>
              <div class="flex items-center justify-between text-[11px] text-[#94A3B8]">
                <span class="flex items-center gap-1">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                  <span class="font-mono">${viewsCount}</span>
                </span>
                <span class="font-mono text-[10px]">@${escapeHtml(post.creator || CURRENT_PROFILE_DATA?.username || 'user')}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Failed to load profile posts:', err);
    grid.innerHTML = '<div class="col-span-full py-10 text-center text-xs text-rose-400">Failed to load posts.</div>';
  }
}

function openProfileMediaViewer(videoId) {
  const post = PROFILE_POSTS_CACHE.find(p => p.id === videoId);
  if (!post) return;

  CURRENT_VIEWER_POST = post;

  const modal = document.getElementById('profileMediaViewerModal');
  const videoEl = document.getElementById('profileViewerVideo');
  const creatorEl = document.getElementById('viewerCreatorName');
  const tagEl = document.getElementById('viewerPostTag');
  const likesEl = document.getElementById('viewerLikesCount');
  const viewsEl = document.getElementById('viewerViewsCount');
  const titleEl = document.getElementById('viewerTitle');
  const dateEl = document.getElementById('viewerDate');
  const saveIcon = document.getElementById('viewerSaveIcon');

  if (creatorEl) creatorEl.textContent = '@' + (post.creator || CURRENT_PROFILE_DATA?.username || 'user');
  if (tagEl) tagEl.textContent = post.tag || 'VIDEO';
  if (likesEl) likesEl.textContent = (post.likes_count || 0).toLocaleString();
  if (viewsEl) viewsEl.textContent = (post.views_count || post.views || 0).toLocaleString();
  if (titleEl) titleEl.textContent = post.title || 'Untitled Video';
  if (dateEl) dateEl.textContent = post.created_at ? new Date(post.created_at).toLocaleDateString() : 'Recent';

  if (saveIcon) {
    if (CURRENT_PROFILE_TAB === 'saved') {
      saveIcon.className = "fa-solid fa-bookmark text-amber-400 text-base";
    } else {
      saveIcon.className = "fa-regular fa-bookmark text-base";
    }
  }

  if (videoEl) {
    videoEl.src = post.src || '';
    videoEl.play().catch(() => {});
  }

  if (modal) modal.classList.remove('hidden');
}

function closeProfileMediaViewer() {
  const modal = document.getElementById('profileMediaViewerModal');
  const videoEl = document.getElementById('profileViewerVideo');
  if (videoEl) videoEl.pause();
  if (modal) modal.classList.add('hidden');
  CURRENT_VIEWER_POST = null;
}

async function toggleViewerSaveCurrent() {
  if (!CURRENT_VIEWER_POST || !AUTH_TOKEN) {
    showToast("Please sign in to save videos");
    return;
  }

  const saveIcon = document.getElementById('viewerSaveIcon');
  try {
    const isCurrentlySaved = saveIcon && saveIcon.classList.contains('fa-solid');
    if (isCurrentlySaved) {
      await apiFetch(`/profile/save-video/${CURRENT_VIEWER_POST.id}`, { method: 'DELETE' });
      if (saveIcon) saveIcon.className = "fa-regular fa-bookmark text-base";
      showToast("Post removed from saved collection");
    } else {
      await apiFetch('/profile/save-video', {
        method: 'POST',
        body: JSON.stringify({ videoId: CURRENT_VIEWER_POST.id })
      });
      if (saveIcon) saveIcon.className = "fa-solid fa-bookmark text-amber-400 text-base";
      showToast("Post saved to collection");
    }
  } catch (err) {
    showToast(err.message || 'Action failed');
  }
}

function shareCurrentViewerVideo() {
  if (!CURRENT_VIEWER_POST) return;
  const shareUrl = window.location.origin + '/?v=' + CURRENT_VIEWER_POST.id;
  if (navigator.share) {
    navigator.share({
      title: CURRENT_VIEWER_POST.title || 'DarkPAKI Video',
      url: shareUrl
    }).catch(() => {});
  } else {
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast("Video link copied to clipboard!");
    });
  }
}

// ----------------------------------------------------------------------------
// EDIT PROFILE MODAL (NO FACEBOOK / NO CATEGORY)
// ----------------------------------------------------------------------------
function openEditProfileModal() {
  if (!CURRENT_PROFILE_DATA) return;

  const modal = document.getElementById('editProfileModal');
  const nameInput = document.getElementById('editProfileName');
  const usernameInput = document.getElementById('editProfileUsername');
  const pronounsInput = document.getElementById('editProfilePronouns');
  const bioInput = document.getElementById('editProfileBio');
  const bioCount = document.getElementById('editProfileBioCount');
  const bannerSelect = document.getElementById('editProfileBannerStyle');
  const genderSelect = document.getElementById('editProfileGender');
  const linksBadge = document.getElementById('editProfileLinksCountBadge');
  const avatarPreview = document.getElementById('editProfileAvatarPreview');
  const avatarPlaceholder = document.getElementById('editProfileAvatarPlaceholder');
  const statusEl = document.getElementById('editProfileUsernameStatus');

  if (nameInput) nameInput.value = CURRENT_PROFILE_DATA.name || '';
  if (usernameInput) usernameInput.value = CURRENT_PROFILE_DATA.username || '';
  if (pronounsInput) pronounsInput.value = CURRENT_PROFILE_DATA.pronouns || '';
  if (bioInput) bioInput.value = CURRENT_PROFILE_DATA.bio || '';
  if (bioCount) bioCount.textContent = `${(CURRENT_PROFILE_DATA.bio || '').length} / 150`;
  if (bannerSelect) bannerSelect.value = CURRENT_PROFILE_DATA.banner_style || '';
  if (genderSelect) genderSelect.value = CURRENT_PROFILE_DATA.gender || 'Prefer not to say';
  if (linksBadge) linksBadge.textContent = `${(CURRENT_PROFILE_DATA.links || []).length} links`;
  if (statusEl) statusEl.textContent = '';

  if (CURRENT_PROFILE_DATA.avatar_url && CURRENT_PROFILE_DATA.avatar_url.trim()) {
    if (avatarPreview) {
      avatarPreview.src = CURRENT_PROFILE_DATA.avatar_url;
      avatarPreview.classList.remove('hidden');
    }
    if (avatarPlaceholder) avatarPlaceholder.classList.add('hidden');
  } else {
    if (avatarPreview) avatarPreview.classList.add('hidden');
    if (avatarPlaceholder) avatarPlaceholder.classList.remove('hidden');
  }

  if (modal) modal.classList.remove('hidden');
}

function closeEditProfileModal() {
  const modal = document.getElementById('editProfileModal');
  if (modal) modal.classList.add('hidden');
}

function onUsernameInputChange(val) {
  clearTimeout(USERNAME_CHECK_TIMER);
  const statusEl = document.getElementById('editProfileUsernameStatus');
  if (!statusEl) return;

  const cleaned = (val || '').toLowerCase().trim().replace(/^@/, '');
  if (!cleaned || cleaned.length < 3) {
    statusEl.textContent = 'Min 3 chars';
    statusEl.className = 'text-[10px] text-amber-400 font-mono';
    return;
  }

  if (CURRENT_PROFILE_DATA && cleaned === CURRENT_PROFILE_DATA.username.toLowerCase()) {
    statusEl.textContent = '✓ Current';
    statusEl.className = 'text-[10px] text-emerald-400 font-mono font-bold';
    return;
  }

  USERNAME_CHECK_TIMER = setTimeout(async () => {
    try {
      const res = await apiFetch(`/profile/check-username?username=${encodeURIComponent(cleaned)}`);
      if (res.available) {
        statusEl.textContent = '✓ Available';
        statusEl.className = 'text-[10px] text-emerald-400 font-mono font-bold';
      } else {
        statusEl.textContent = '✗ ' + (res.message || 'Taken');
        statusEl.className = 'text-[10px] text-rose-400 font-mono font-bold';
      }
    } catch (e) {
      statusEl.textContent = '';
    }
  }, 300);
}

function updateBioCharCount(textarea) {
  const counter = document.getElementById('editProfileBioCount');
  if (counter && textarea) {
    counter.textContent = `${textarea.value.length} / 150`;
  }
}

async function handleEditProfileSubmit() {
  const name = document.getElementById('editProfileName')?.value.trim();
  const username = document.getElementById('editProfileUsername')?.value.trim();
  const pronouns = document.getElementById('editProfilePronouns')?.value.trim();
  const bio = document.getElementById('editProfileBio')?.value.trim();
  const banner_style = document.getElementById('editProfileBannerStyle')?.value;
  const gender = document.getElementById('editProfileGender')?.value;

  if (!name) {
    showToast("Name is required");
    return;
  }
  if (!username) {
    showToast("Username is required");
    return;
  }

  const btn = document.getElementById('btnSaveEditProfile');
  const spinner = document.getElementById('btnSaveEditProfileSpinner');
  const btnText = document.getElementById('btnSaveEditProfileText');
  if (btn) btn.disabled = true;
  if (spinner) spinner.classList.remove('hidden');
  if (btnText) btnText.classList.add('hidden');

  try {
    const res = await apiFetch('/profile', {
      method: 'PUT',
      body: JSON.stringify({ name, username, pronouns, bio, banner_style, gender })
    });

    if (res.success && res.data) {
      CURRENT_PROFILE_DATA = { ...CURRENT_PROFILE_DATA, ...res.data };
      renderProfileHeaderUI(CURRENT_PROFILE_DATA);
      updateHeaderProfileUI(CURRENT_PROFILE_DATA);
      closeEditProfileModal();
      showToast("Profile updated successfully!");
    } else {
      showToast(res.message || "Failed to update profile");
    }
  } catch (err) {
    showToast(err.message || "Error updating profile");
  } finally {
    if (btn) btn.disabled = false;
    if (spinner) spinner.classList.add('hidden');
    if (btnText) btnText.classList.remove('hidden');
  }
}

// ----------------------------------------------------------------------------
// AVATAR UPLOAD & REMOVAL
// ----------------------------------------------------------------------------
function triggerEditAvatarPicker() {
  const input = document.getElementById('editAvatarFileInput');
  if (input) input.click();
}

function triggerQuickAvatarUpload() {
  triggerEditAvatarPicker();
}

function handleEditAvatarSelected(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];

  if (file.size > 5 * 1024 * 1024) {
    showToast("Image size must be less than 5MB");
    return;
  }

  const reader = new FileReader();
  reader.onload = async function(e) {
    const base64Data = e.target.result;

    // Instant local preview
    const preview = document.getElementById('editProfileAvatarPreview');
    const placeholder = document.getElementById('editProfileAvatarPlaceholder');
    if (preview) {
      preview.src = base64Data;
      preview.classList.remove('hidden');
    }
    if (placeholder) placeholder.classList.add('hidden');

    try {
      showToast("Uploading profile picture...");
      const res = await apiFetch('/profile/avatar', {
        method: 'POST',
        body: JSON.stringify({ imageBase64: base64Data })
      });

      if (res.success && res.avatarUrl) {
        if (CURRENT_PROFILE_DATA) CURRENT_PROFILE_DATA.avatar_url = res.avatarUrl;
        renderProfileHeaderUI(CURRENT_PROFILE_DATA);
        updateHeaderProfileUI(CURRENT_PROFILE_DATA);
        showToast("Profile photo updated!");
      }
    } catch (err) {
      showToast(err.message || "Failed to upload photo");
    }
  };
  reader.readAsDataURL(file);
}

async function handleRemoveAvatar() {
  try {
    const res = await apiFetch('/profile/avatar', { method: 'DELETE' });
    if (res.success) {
      if (CURRENT_PROFILE_DATA) CURRENT_PROFILE_DATA.avatar_url = '';
      const preview = document.getElementById('editProfileAvatarPreview');
      const placeholder = document.getElementById('editProfileAvatarPlaceholder');
      if (preview) preview.classList.add('hidden');
      if (placeholder) placeholder.classList.remove('hidden');
      renderProfileHeaderUI(CURRENT_PROFILE_DATA);
      updateHeaderProfileUI(CURRENT_PROFILE_DATA);
      showToast("Profile photo removed");
    }
  } catch (err) {
    showToast(err.message || "Failed to remove photo");
  }
}

// ----------------------------------------------------------------------------
// EXTERNAL LINKS MANAGEMENT SUB-PANEL
// ----------------------------------------------------------------------------
async function openManageLinksModal() {
  const modal = document.getElementById('manageLinksModal');
  if (modal) modal.classList.remove('hidden');
  await refreshLinksList();
}

function closeManageLinksModal() {
  const modal = document.getElementById('manageLinksModal');
  if (modal) modal.classList.add('hidden');
}

async function refreshLinksList() {
  const list = document.getElementById('manageLinksList');
  const countEl = document.getElementById('manageLinksCount');
  if (!list) return;

  try {
    const res = await apiFetch('/profile/links');
    const links = (res.success && Array.isArray(res.data)) ? res.data : [];
    if (CURRENT_PROFILE_DATA) CURRENT_PROFILE_DATA.links = links;
    if (countEl) countEl.textContent = `${links.length} / 10`;

    const badge = document.getElementById('editProfileLinksCountBadge');
    if (badge) badge.textContent = `${links.length} links`;

    if (links.length === 0) {
      list.innerHTML = '<p class="text-xs text-neutral-500 py-3 text-center">No external links added yet.</p>';
    } else {
      list.innerHTML = links.map(link => `
        <div class="bg-black/60 border border-[#363636] rounded-xl p-2.5 flex items-center justify-between gap-2">
          <div class="min-w-0 flex-1">
            <h5 class="text-xs font-bold text-white truncate">${escapeHtml(link.title)}</h5>
            <p class="text-[10px] text-neutral-400 font-mono truncate">${escapeHtml(link.url)}</p>
          </div>
          <button type="button" onclick="handleDeleteLink(${link.id})" class="text-neutral-500 hover:text-rose-500 p-1.5 transition">
            <i class="fa-solid fa-trash-can text-xs"></i>
          </button>
        </div>
      `).join('');
    }

    renderProfileHeaderUI(CURRENT_PROFILE_DATA);
  } catch (err) {
    list.innerHTML = '<p class="text-xs text-rose-400 py-2">Failed to load links.</p>';
  }
}

async function handleAddLinkSubmit() {
  const urlInput = document.getElementById('newLinkUrlInput');
  const titleInput = document.getElementById('newLinkTitleInput');
  if (!urlInput) return;

  const url = urlInput.value.trim();
  const title = (titleInput?.value || '').trim() || url;

  if (!url) {
    showToast("Please enter a link URL");
    return;
  }

  try {
    const res = await apiFetch('/profile/links', {
      method: 'POST',
      body: JSON.stringify({ title, url })
    });
    if (res.success) {
      urlInput.value = '';
      if (titleInput) titleInput.value = '';
      showToast("Link added!");
      await refreshLinksList();
    }
  } catch (err) {
    showToast(err.message || "Failed to add link");
  }
}

async function handleDeleteLink(linkId) {
  try {
    await apiFetch(`/profile/links/${linkId}`, { method: 'DELETE' });
    showToast("Link removed");
    await refreshLinksList();
  } catch (err) {
    showToast(err.message || "Failed to delete link");
  }
}

// ----------------------------------------------------------------------------
// DRAWER & QR CODE MODAL
// ----------------------------------------------------------------------------
function openProfileDrawer() {
  const modal = document.getElementById('profileDrawerModal');
  if (modal) modal.classList.remove('hidden');
}

function closeProfileDrawer() {
  const modal = document.getElementById('profileDrawerModal');
  if (modal) modal.classList.add('hidden');
}

function openProfileQrModal() {
  const modal = document.getElementById('qrCodeModal');
  const qrImg = document.getElementById('qrImageElement');
  const nameEl = document.getElementById('qrDisplayName');
  const userEl = document.getElementById('qrUsername');
  const qrAvatarImg = document.getElementById('qrAvatarImg');
  const qrAvatarIcon = document.getElementById('qrAvatarIcon');

  if (!CURRENT_PROFILE_DATA) return;

  const profileUrl = window.location.origin + '/?u=' + (CURRENT_PROFILE_DATA.username || 'user');
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(profileUrl)}&bgcolor=ffffff&color=000000&margin=1`;

  if (qrImg) qrImg.src = qrApiUrl;
  if (nameEl) nameEl.textContent = CURRENT_PROFILE_DATA.name || 'User';
  if (userEl) userEl.textContent = '@' + (CURRENT_PROFILE_DATA.username || 'user');

  if (CURRENT_PROFILE_DATA.avatar_url && CURRENT_PROFILE_DATA.avatar_url.trim()) {
    if (qrAvatarImg) {
      qrAvatarImg.src = CURRENT_PROFILE_DATA.avatar_url;
      qrAvatarImg.classList.remove('hidden');
    }
    if (qrAvatarIcon) qrAvatarIcon.classList.add('hidden');
  } else {
    if (qrAvatarImg) qrAvatarImg.classList.add('hidden');
    if (qrAvatarIcon) qrAvatarIcon.classList.remove('hidden');
  }

  if (modal) modal.classList.remove('hidden');
}

function closeProfileQrModal() {
  const modal = document.getElementById('qrCodeModal');
  if (modal) modal.classList.add('hidden');
}

function copyProfileLink() {
  if (!CURRENT_PROFILE_DATA) return;
  const profileUrl = window.location.origin + '/?u=' + (CURRENT_PROFILE_DATA.username || 'user');
  navigator.clipboard.writeText(profileUrl).then(() => {
    showToast("Profile link copied to clipboard!");
  });
}

function shareProfileUrl() {
  if (!CURRENT_PROFILE_DATA) return;
  const profileUrl = window.location.origin + '/?u=' + (CURRENT_PROFILE_DATA.username || 'user');
  if (navigator.share) {
    navigator.share({
      title: `${CURRENT_PROFILE_DATA.name} (@${CURRENT_PROFILE_DATA.username}) on DarkPAKI`,
      url: profileUrl
    }).catch(() => {});
  } else {
    openProfileQrModal();
  }
}

// ----------------------------------------------------------------------------
// REORDER & PIN GRID MODAL
// ----------------------------------------------------------------------------
function openReorderGridModal() {
  const modal = document.getElementById('reorderGridModal');
  const list = document.getElementById('reorderGridList');
  if (!modal || !list) return;

  if (PROFILE_POSTS_CACHE.length === 0) {
    list.innerHTML = '<p class="text-xs text-neutral-500 py-4 text-center">You have no posts to reorder.</p>';
  } else {
    list.innerHTML = PROFILE_POSTS_CACHE.map((p, idx) => `
      <div class="bg-[#1C1E21] border border-[#363636] rounded-xl p-2.5 flex items-center justify-between gap-3">
        <img src="${p.thumb_img || '/public/darkpaki-logo.png'}" class="w-12 h-12 object-cover rounded-lg shrink-0">
        <div class="min-w-0 flex-1">
          <h5 class="text-xs font-bold text-white truncate">${escapeHtml(p.title)}</h5>
          <span class="text-[10px] text-neutral-400 font-mono">${p.views_count || p.views || 0} views</span>
        </div>
        <button type="button" onclick="togglePinGridItem(${p.id})" class="px-2.5 py-1.5 rounded-lg border text-xs font-bold transition ${p.is_pinned ? 'bg-rose-500/20 text-rose-400 border-rose-500/40' : 'bg-black/50 text-neutral-400 border-neutral-700 hover:text-white'}">
          <i class="fa-solid fa-thumbtack mr-1"></i> ${p.is_pinned ? 'Pinned' : 'Pin'}
        </button>
      </div>
    `).join('');
  }

  modal.classList.remove('hidden');
}

function closeReorderGridModal() {
  const modal = document.getElementById('reorderGridModal');
  if (modal) modal.classList.add('hidden');
}

function togglePinGridItem(postId) {
  const item = PROFILE_POSTS_CACHE.find(p => p.id === postId);
  if (!item) return;

  const currentlyPinnedCount = PROFILE_POSTS_CACHE.filter(p => p.is_pinned).length;
  if (!item.is_pinned && currentlyPinnedCount >= 3) {
    showToast("You can only pin up to 3 posts");
    return;
  }

  item.is_pinned = item.is_pinned ? 0 : 1;
  openReorderGridModal();
}

async function saveReorderGrid() {
  try {
    const payload = PROFILE_POSTS_CACHE.map((p, index) => ({
      id: p.id,
      grid_order: index,
      is_pinned: p.is_pinned ? 1 : 0
    }));

    await apiFetch('/profile/grid-order', {
      method: 'PUT',
      body: JSON.stringify({ items: payload })
    });

    closeReorderGridModal();
    showToast("Grid order & pins saved!");
    await loadProfileGridPosts(CURRENT_PROFILE_TAB);
  } catch (err) {
    showToast(err.message || "Failed to update grid order");
  }
}

// ----------------------------------------------------------------------------
// FOLLOWERS & FOLLOWING LISTS
// ----------------------------------------------------------------------------
let CURRENT_FOLLOWERS_TAB = 'followers';

async function openFollowersListModal(type) {
  CURRENT_FOLLOWERS_TAB = type || 'followers';
  const modal = document.getElementById('followersModal');
  if (modal) modal.classList.remove('hidden');
  await switchFollowersTab(CURRENT_FOLLOWERS_TAB);
}

function closeFollowersModal() {
  const modal = document.getElementById('followersModal');
  if (modal) modal.classList.add('hidden');
}

async function switchFollowersTab(tab) {
  CURRENT_FOLLOWERS_TAB = tab;

  const btnFollowers = document.getElementById('modalTabFollowersBtn');
  const btnFollowing = document.getElementById('modalTabFollowingBtn');
  const countFollowers = document.getElementById('modalFollowersCount');
  const countFollowing = document.getElementById('modalFollowingCount');
  const container = document.getElementById('followersListContainer');

  const activeTabCls = "pb-1 border-b-2 border-white text-white font-bold transition";
  const inactiveTabCls = "pb-1 border-b-2 border-transparent text-[#A8A8A8] hover:text-white transition";

  if (btnFollowers) btnFollowers.className = tab === 'followers' ? activeTabCls : inactiveTabCls;
  if (btnFollowing) btnFollowing.className = tab === 'following' ? activeTabCls : inactiveTabCls;

  if (countFollowers) countFollowers.textContent = CURRENT_PROFILE_DATA?.followers_count || 0;
  if (countFollowing) countFollowing.textContent = CURRENT_PROFILE_DATA?.following_count || 0;

  if (!container) return;
  container.innerHTML = '<div class="py-10 text-center text-neutral-500"><i class="fa-solid fa-circle-notch fa-spin text-xl"></i></div>';

  try {
    const endpoint = tab === 'followers' ? '/profile/followers' : '/profile/following';
    const res = await apiFetch(endpoint);
    const users = (res.success && Array.isArray(res.data)) ? res.data : [];

    if (users.length === 0) {
      container.innerHTML = `<p class="text-xs text-neutral-500 py-10 text-center">No ${tab} yet.</p>`;
    } else {
      container.innerHTML = users.map(u => `
        <div class="flex items-center justify-between p-2 rounded-xl hover:bg-[#1C1E21] transition">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-10 h-10 rounded-full overflow-hidden bg-[#262626] border border-neutral-700 flex items-center justify-center shrink-0">
              ${u.avatar_url ? `<img src="${u.avatar_url}" class="w-full h-full object-cover">` : `<i class="fa-solid fa-user text-neutral-400 text-xs"></i>`}
            </div>
            <div class="min-w-0">
              <span class="text-xs font-bold text-white block truncate">${escapeHtml(u.name || 'User')}</span>
              <span class="text-[11px] text-neutral-400 font-mono truncate">@${escapeHtml(u.username || 'user')}</span>
            </div>
          </div>
          <button type="button" onclick="toggleFollowUser(${u.id}, this)" class="bg-[#262626] hover:bg-[#363636] text-white px-3 py-1.5 rounded-lg text-xs font-bold transition">
            ${tab === 'following' ? 'Following' : 'Follow'}
          </button>
        </div>
      `).join('');
    }
  } catch (err) {
    container.innerHTML = '<p class="text-xs text-rose-400 py-6 text-center">Failed to load list.</p>';
  }
}

async function toggleFollowUser(targetId, btnEl) {
  try {
    const res = await apiFetch(`/profile/follow/${targetId}`, { method: 'POST' });
    if (res.success) {
      if (res.following) {
        btnEl.textContent = 'Following';
        btnEl.className = 'bg-[#262626] hover:bg-[#363636] text-white px-3 py-1.5 rounded-lg text-xs font-bold transition';
      } else {
        btnEl.textContent = 'Follow';
        btnEl.className = 'bg-[#0095F6] hover:bg-sky-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition';
      }
      showToast(res.message);
      // Reload profile data to update counts
      const pRes = await apiFetch('/profile/me');
      if (pRes.success) {
        CURRENT_PROFILE_DATA = pRes.data;
        renderProfileHeaderUI(CURRENT_PROFILE_DATA);
      }
    }
  } catch (err) {
    showToast(err.message || 'Action failed');
  }
}

// ----------------------------------------------------------------------------
// LOGOUT
// ----------------------------------------------------------------------------
function handleLogoutUser() {
  AUTH_TOKEN = null;
  CURRENT_USER = null;
  CURRENT_PROFILE_DATA = null;
  localStorage.removeItem('darkpaki_auth_token');
  updateHeaderProfileUI(null);
  refreshEarningDashboardUI();
  switchView('home');
  showToast("Logged out successfully");
}

if (window._pendingStudioTab) {
  const pending = window._pendingStudioTab;
  delete window._pendingStudioTab;
  switchCreatorStudioTab(pending);
}
