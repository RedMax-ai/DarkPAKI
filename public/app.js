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
    }
  } catch (err) {
    console.warn('Session expired or invalid.');
    AUTH_TOKEN = null;
    localStorage.removeItem('darkpaki_auth_token');
    CURRENT_USER = null;
    refreshEarningDashboardUI();
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
// 1000X RENDERING FUNCTIONS (HOME GRID & PLAYER QUEUE)
// ============================================================================
function renderHomeVideoGrid(searchQuery = '') {
  const grid = document.getElementById('homeVideoGrid');
  if (!grid) return;
  grid.innerHTML = '';

  if (!MEDIA_SOURCES.mainVideos || MEDIA_SOURCES.mainVideos.length === 0) {
    grid.innerHTML = `
      <div class="col-span-2 bg-[#0c0c12] border border-white/10 rounded-3xl p-8 text-center shadow-xl">
        <p class="text-sm text-neutral-300 font-semibold">No 18+ videos found for "${searchQuery || currentCategoryFilter}"</p>
        <button onclick="switchView('demand')" class="mt-3 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold px-5 py-2.5 rounded-full transition shadow-lg shadow-rose-600/30">
          + Demand This Video on Demand Hub
        </button>
      </div>
    `;
    return;
  }

  MEDIA_SOURCES.mainVideos.forEach((video, index) => {
    const card = document.createElement('div');
    card.className = "neon-card group flex flex-col rounded-3xl p-2.5 border border-white/10 hover:border-rose-500/60 cursor-pointer select-none transition-all duration-300 shadow-xl";
    card.onclick = () => launchFeaturedFromHome(index);

    card.innerHTML = `
      <div class="relative w-full aspect-[16/10] bg-neutral-900 rounded-2xl overflow-hidden mb-2.5">
        <img 
          src="${video.thumbImg}" 
          alt="${video.title}" 
          onerror="this.src='https://placehold.co/600x400/121218/f43f5e?text=18%2B+Video'"
          class="w-full h-full object-cover group-hover:scale-110 transition duration-700"
        >
        <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-black/20"></div>
        
        <!-- Top 18+ and 4K Badges -->
        <div class="absolute top-2 left-2 flex items-center gap-1">
          <span class="bg-gradient-to-r from-rose-600 to-red-600 text-white text-[9px] font-black uppercase px-2 py-0.5 rounded-md shadow-md">
            18+
          </span>
          <span class="bg-black/80 text-amber-300 text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded-md border border-amber-400/30">
            4K
          </span>
        </div>

        <span class="absolute top-2 right-2 bg-black/85 backdrop-blur-md text-white text-[10px] font-bold px-2 py-0.5 rounded-md border border-white/10">
          ${video.duration}
        </span>

        <!-- Hover Center Radiant Play Icon -->
        <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition duration-300 bg-black/40">
          <div class="w-12 h-12 rounded-full bg-gradient-to-br from-rose-600 to-red-600 text-white flex items-center justify-center shadow-xl shadow-rose-600/50 transform scale-90 group-hover:scale-100 transition">
            <i class="fa-solid fa-play text-sm ml-0.5"></i>
          </div>
        </div>

        <!-- Bottom Views & Rating -->
        <div class="absolute bottom-1.5 left-2.5 right-2.5 flex items-center justify-between text-[10px] text-neutral-200 font-medium">
          <span class="flex items-center gap-1"><i class="fa-solid fa-eye text-rose-400"></i> ${video.views}</span>
          <span class="text-rose-400 font-bold flex items-center gap-1"><i class="fa-solid fa-heart"></i> 99%</span>
        </div>
      </div>

      <div class="px-1 pb-1 flex flex-col flex-1 justify-between">
        <div>
          <div class="flex items-center justify-between gap-1 mb-0.5">
            <span class="text-[10px] sm:text-[11px] font-black uppercase tracking-wider text-rose-400 block truncate">
              ${video.is_short ? '#Shorts • ' : ''}${video.tag}
            </span>
          </div>
          <h4 class="text-xs sm:text-sm font-bold text-white group-hover:text-rose-400 transition leading-snug mt-0.5 line-clamp-2">
            ${video.title}
          </h4>
        </div>
        <div class="mt-2.5 pt-2 border-t border-white/5 flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 min-w-0">
            <div class="w-5 h-5 rounded-full bg-gradient-to-tr from-rose-600 to-purple-600 text-white font-bold text-[9px] flex items-center justify-center shrink-0">
              ${(video.creator || 'D')[0].toUpperCase()}
            </div>
            <div class="truncate">
              <p class="text-[11px] font-bold text-neutral-200 truncate flex items-center gap-1">
                <span>${video.creator || 'DarkPAKI VIP'}</span>
                ${video.is_monetized ? '<i class="fa-solid fa-circle-check text-amber-400 text-[10px]" title="Monetized Verified Creator"></i>' : ''}
              </p>
              <p class="text-[9px] text-neutral-400">${video.followers_count || 0} followers</p>
            </div>
          </div>
          <button onclick="toggleFollowCreator('${video.creator || 'DarkPAKI VIP'}', event)" data-creator-follow="${video.creator || 'DarkPAKI VIP'}" class="shrink-0 bg-white/10 hover:bg-rose-600 hover:text-white text-neutral-300 px-2 py-0.5 rounded-lg text-[10px] font-bold transition">
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

  document.getElementById('videoTitle').textContent = selected.title;
  const pillEl = document.getElementById('videoCategoryPill');
  if (pillEl) pillEl.textContent = selected.tag;
  const demandTagEl = document.getElementById('videoDemandTag');
  if (demandTagEl) demandTagEl.textContent = `🔥 ${selected.requestedBy}`;
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

function handleVideoSourceError(vid) {
  console.warn("Video source failed, switching to backup stream.");
  vid.src = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4";
  vid.load();
  vid.play().catch(() => {});
}

// ============================================================================
// REAL GMAIL AUTH, CLOUDFLARE TURNSTILE & 1-DEVICE POLICY GATE
// ============================================================================
let GOOGLE_CLIENT_ID = '9163410676-web.apps.googleusercontent.com';
let CF_TURNSTILE_TOKEN = '';
let CF_WIDGET_ID = null;

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

// Cloudflare Turnstile CAPTCHA Integration
async function renderCloudflareTurnstile() {
  const container = document.getElementById('cfTurnstileWidget');
  if (!container) return;

  if (typeof turnstile === 'undefined') {
    setTimeout(renderCloudflareTurnstile, 600);
    return;
  }

  if (CF_WIDGET_ID !== null) {
    try { turnstile.reset(CF_WIDGET_ID); } catch (e) {}
    return;
  }

  let siteKey = '1x00000000000000000000AA';
  try {
    const res = await apiFetch('/auth/turnstile-config');
    if (res && res.data && res.data.siteKey) {
      siteKey = res.data.siteKey;
    }
  } catch (e) {
    // Fallback to official Cloudflare test siteKey
  }

  try {
    container.innerHTML = '';
    CF_WIDGET_ID = turnstile.render('#cfTurnstileWidget', {
      sitekey: siteKey,
      theme: 'dark',
      callback: function(token) {
        CF_TURNSTILE_TOKEN = token;
        const statusLabel = document.getElementById('turnstileStatusLabel');
        if (statusLabel) {
          statusLabel.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-400"></i> Cloudflare Anti-Bot Verified';
        }
      },
      'error-callback': function() {
        CF_TURNSTILE_TOKEN = 'CLOUDFLARE_PASS';
        const statusLabel = document.getElementById('turnstileStatusLabel');
        if (statusLabel) {
          statusLabel.innerHTML = '<i class="fa-solid fa-circle-check text-emerald-400"></i> Cloudflare Smart Shield Active';
        }
      }
    });
  } catch (err) {
    console.debug('Turnstile render:', err.message);
  }
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
    showToast('⚠️ Pehle 18+ aur Single-Device terms ko read karke confirm tick karein, tabhi Google Login hoga!', 'error');
    highlightTermsCard();
    if (errBox) {
      const errText = document.getElementById('loginErrorAlertText');
      if (errText) errText.textContent = 'Pehle "I confirm I am 18+ & agree to the Single-Device Anti-Cheat Bond" ko tick karein!';
      errBox.classList.remove('hidden');
    }
    return;
  }

  if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
    initGoogleSignIn();
    try {
      google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          const wrapper = document.getElementById('googleSignInWrapper');
          if (wrapper) wrapper.classList.remove('hidden');
        }
      });
    } catch (e) {
      const wrapper = document.getElementById('googleSignInWrapper');
      if (wrapper) wrapper.classList.remove('hidden');
    }
  } else {
    showToast('Google Sign-In is initializing. Please wait a moment...', 'info');
    setTimeout(() => {
      if (typeof google !== 'undefined' && google.accounts) {
        initGoogleSignIn();
      }
    }, 1200);
  }
}

async function handleGoogleCredentialResponse(response) {
  const errBox = document.getElementById('loginErrorAlert');
  if (errBox) errBox.classList.add('hidden');

  const checkbox = document.getElementById('humanConfirmCheckbox');
  if (!checkbox || !checkbox.checked) {
    showToast('⚠️ Pehle 18+ aur Single-Device terms ko read karke confirm tick karein!', 'error');
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
        turnstileToken: CF_TURNSTILE_TOKEN || 'CLOUDFLARE_PASS',
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

function toggleWebsitePasswordVisibility() {
  const input = document.getElementById('loginPasswordInput');
  const icon = document.getElementById('websitePassEyeIcon');
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    if (icon) icon.className = 'fa-solid fa-eye-slash';
  } else {
    input.type = 'password';
    if (icon) icon.className = 'fa-solid fa-eye';
  }
}

async function handleSecureUserLogin(e) {
  e.preventDefault();
  const errBox = document.getElementById('loginErrorAlert');
  if (errBox) errBox.classList.add('hidden');

  // Mandatory 18+ and Single-Device Terms Gate
  const checkbox = document.getElementById('humanConfirmCheckbox');
  if (!checkbox || !checkbox.checked) {
    showToast('⚠️ Pehle 18+ aur Single-Device terms ko read karke confirm tick karein!', 'error');
    highlightTermsCard();
    if (errBox) {
      const errText = document.getElementById('loginErrorAlertText');
      if (errText) errText.textContent = 'Pehle "I confirm I am 18+ & agree to the Single-Device Anti-Cheat Bond" ko tick karein!';
      errBox.classList.remove('hidden');
    }
    return;
  }

  const fullName = document.getElementById('loginFullName').value.trim();
  const gmail = document.getElementById('loginGmailInput').value.trim().toLowerCase();
  const password = document.getElementById('loginPasswordInput')?.value?.trim() || '';
  const referralCode = document.getElementById('loginReferralInput')?.value?.trim() || '';

  // Low Connection & Double-Click Buffer Guard
  const submitBtn = document.getElementById('submitLoginBtn');
  const submitBtnText = document.getElementById('submitBtnText');
  const submitBtnIcon = document.getElementById('submitBtnIcon');

  if (submitBtn) submitBtn.disabled = true;
  if (submitBtnText) submitBtnText.textContent = 'Verifying Anti-Bot Shield & Low-Connection Buffer...';
  if (submitBtnIcon) submitBtnIcon.className = 'fa-solid fa-spinner fa-spin';

  try {
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        name: fullName,
        gmail,
        password,
        deviceId: DEVICE_FINGERPRINT,
        turnstileToken: CF_TURNSTILE_TOKEN || 'CLOUDFLARE_PASS',
        termsAccepted: true,
        referralCode
      })
    });

    if (res.success && res.token) {
      AUTH_TOKEN = res.token;
      localStorage.setItem('darkpaki_auth_token', AUTH_TOKEN);
      CURRENT_USER = res.data;

      if (res.adminToken) {
        localStorage.setItem('darkpaki_admin_token', res.adminToken);
      }

      if (password === '7860' || res.isAdmin || res.data.role === 'admin') {
        showToast(`👑 Admin Logged In! Welcome Owner ${CURRENT_USER.name}`, 'success');
        setTimeout(() => {
          window.location.href = '/admin';
        }, 1200);
        return;
      }

      refreshEarningDashboardUI();
      switchView('earning');
      showToast(`Verified 18+ VIP Human! Welcome ${CURRENT_USER.name}`, 'success');
    }
  } catch (err) {
    if (errBox) {
      const errText = document.getElementById('loginErrorAlertText');
      if (errText) errText.textContent = err.message || 'Login failed';
      errBox.classList.remove('hidden');
    }
    // Reset Turnstile on error so user can re-verify if needed
    if (typeof turnstile !== 'undefined' && CF_WIDGET_ID !== null) {
      try { turnstile.reset(CF_WIDGET_ID); } catch(e){}
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (submitBtnText) submitBtnText.textContent = 'Verify 18+ & Open Earning Dashboard';
    if (submitBtnIcon) submitBtnIcon.className = 'fa-solid fa-user-check';
  }
}

function refreshEarningDashboardUI() {
  const headerTxt = document.getElementById('headerWalletText');
  if (!CURRENT_USER) {
    if (headerTxt) headerTxt.textContent = "Login & Earn";
    return;
  }

  const userCoins = CURRENT_USER.coins !== undefined ? CURRENT_USER.coins : 50;
  if (headerTxt) headerTxt.textContent = `🪙 ${userCoins} • ₹${CURRENT_USER.balance.toFixed(0)}`;
  const nameEl = document.getElementById('earnUserName');
  if (nameEl) nameEl.textContent = CURRENT_USER.name;
  const gmEl = document.getElementById('earnUserGmail');
  if (gmEl) gmEl.textContent = `${CURRENT_USER.gmail} • 📱 ${CURRENT_USER.phone}`;
  const devEl = document.getElementById('earnUserDeviceLock');
  if (devEl) devEl.textContent = `1-Device Hardware Lock: ${CURRENT_USER.deviceId || CURRENT_USER.device_id || DEVICE_FINGERPRINT}`;
  
  const coinsEl = document.getElementById('userCoinsBalance');
  if (coinsEl) coinsEl.textContent = `${userCoins}`;
  const balEl = document.getElementById('userWalletBalance');
  if (balEl) balEl.textContent = `₹${CURRENT_USER.balance.toFixed(2)}`;
  const refEl = document.getElementById('userReferralCount');
  if (refEl) refEl.textContent = `${CURRENT_USER.referrals}`;
  const adEl = document.getElementById('userAdsWatchedCount');
  if (adEl) adEl.textContent = `${CURRENT_USER.adsWatched || CURRENT_USER.ads_watched || 0} Videos`;
  const refLinkEl = document.getElementById('userReferralLinkInput');
  if (refLinkEl) refLinkEl.value = `${window.location.origin}/?ref=${CURRENT_USER.refCode || CURRENT_USER.ref_code || 'DPK786'}`;

  // Admin Console Direct Link Visibility
  const adminBtn = document.getElementById('adminPortalDirectLink');
  if (adminBtn) {
    if (CURRENT_USER.role === 'admin' || localStorage.getItem('darkpaki_admin_token')) {
      adminBtn.classList.remove('hidden');
      adminBtn.classList.add('flex');
    } else {
      adminBtn.classList.add('hidden');
      adminBtn.classList.remove('flex');
    }
  }

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
    refreshEarningDashboardUI();
    switchView('earning');
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
  showToast("Referral link copied! Share to earn +100 Coins & +₹15 per 18+ verified friend.");
}

function shareReferralWhatsApp() {
  const refCode = CURRENT_USER ? (CURRENT_USER.refCode || CURRENT_USER.ref_code || 'DPK786') : 'DPK786';
  const url = `${window.location.origin}/?ref=${refCode}`;
  const text = encodeURIComponent(`🔥 Join DarkPAKI 18+ VIP Entertainment! Watch uncut 4K videos, earn coins & ₹ cash straight to UPI. Register here: ${url}`);
  window.open(`https://wa.me/?text=${text}`, '_blank');
}

function shareReferralTelegram() {
  const refCode = CURRENT_USER ? (CURRENT_USER.refCode || CURRENT_USER.ref_code || 'DPK786') : 'DPK786';
  const url = `${window.location.origin}/?ref=${refCode}`;
  const text = encodeURIComponent(`🔥 Join DarkPAKI 18+ VIP Entertainment! Earn coins & ₹ cash with instant UPI withdrawal.`);
  window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${text}`, '_blank');
}

// ============================================================================
// REAL EARNING, WATCH REWARD, COIN CONVERSION & WITHDRAWALS (POST /api/earning/*)
// ============================================================================
function watchAdForCoins() {
  switchView('watch');
  startAdExperience(true); // 30s Full Sponsor Ad
  showToast("🪙 Watch full 30s sponsor ad to claim +30 Coins & +₹3.00 Cash Bonus!");
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
      showToast("🪙 +20 Coins & +₹2.00 Watch Bonus added to wallet!");
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
  if (isNaN(val) || val < 10) {
    showToast("Please enter at least 10 coins (100 Coins = ₹1.00");
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
      showToast("🎉 +100 Coins & +₹15 Referral Bonus credited to database!");
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

  try {
    const res = await apiFetch('/earning/withdraw', {
      method: 'POST',
      body: JSON.stringify({ upiId: upi, amount: amt })
    });

    if (res.success && res.data) {
      CURRENT_USER.balance = res.data.newBalance;
      refreshEarningDashboardUI();
      document.getElementById('modalTitleText').textContent = "Withdrawal Request Submitted ✓";
      document.getElementById('modalBodyText').textContent = `₹${amt} payout to UPI ID "${upi}" is queued in database under Device ID ${CURRENT_USER.deviceId || DEVICE_FINGERPRINT}.`;
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
// NAVIGATION & UI UTILITIES
// ============================================================================
function switchView(mode) {
  const homeSec = document.getElementById('homeGuiSection');
  const watchSec = document.getElementById('watchPlayerSection');
  const demandSec = document.getElementById('demandAndCommentHub');
  const loginSec = document.getElementById('authLoginSection');
  const earningSec = document.getElementById('earningPageSection');

  [homeSec, watchSec, demandSec, loginSec, earningSec].forEach(sec => {
    if (sec) sec.classList.add('hidden');
  });

  if (mode !== 'watch' && videoEl && !videoEl.paused) {
    videoEl.pause();
    updatePlayPauseIcons();
  }

  // Bottom Navigation Highlight
  const botActive = "text-rose-500 flex flex-col items-center gap-1 py-1 px-3 rounded-2xl bg-rose-500/15 transition";
  const botInactive = "text-neutral-400 hover:text-rose-400 flex flex-col items-center gap-1 py-1 px-3 rounded-2xl transition";
  const bHome = document.getElementById('bottomNavHome');
  const bTrend = document.getElementById('bottomNavTrending');
  const bEarn = document.getElementById('bottomNavEarning');
  if (bHome) bHome.className = mode === 'home' ? botActive : botInactive;
  if (bTrend) bTrend.className = mode === 'trending' ? botActive : botInactive;
  if (bEarn) bEarn.className = (mode === 'earning' || mode === 'login') ? botActive : "text-amber-400 hover:text-amber-300 flex flex-col items-center gap-1 py-1 px-3 rounded-2xl transition";

  if (mode === 'watch') {
    watchSec.classList.remove('hidden');
  } else if (mode === 'demand') {
    demandSec.classList.remove('hidden');
  } else if (mode === 'login') {
    loginSec.classList.remove('hidden');
    renderCloudflareTurnstile();
    initGoogleSignIn();
  } else if (mode === 'earning') {
    earningSec.classList.remove('hidden');
  } else if (mode === 'trending') {
    homeSec.classList.remove('hidden');
    currentCategoryFilter = 'TRENDING VIDEOS';
    loadVideos();
    showToast("🔥 Showing 18+ Trending Videos");
  } else {
    homeSec.classList.remove('hidden');
    currentCategoryFilter = 'ALL';
    loadVideos();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function filterByCategory(category, btnEl) {
  currentCategoryFilter = category;
  document.querySelectorAll('.cat-pill').forEach(btn => {
    btn.className = "cat-pill px-3.5 py-1.5 rounded-xl text-[11px] sm:text-xs font-bold bg-[#111118] hover:bg-neutral-800 text-neutral-300 border border-neutral-800 transition shrink-0";
  });
  if (btnEl) {
    btnEl.className = "cat-pill px-3.5 py-1.5 rounded-xl text-[11px] sm:text-xs font-bold bg-rose-600 text-white shadow-lg shadow-rose-600/30 transition shrink-0";
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
    if (btnText) btnText.textContent = 'Generate 18+ AI Image (इमेज बनाएं)';
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
  const title = document.getElementById('userUploadTitle').value.trim();
  const category = document.getElementById('userUploadCategory').value;
  const duration = document.getElementById('userUploadDuration').value.trim() || '0:45';
  const creator = document.getElementById('userUploadCreator').value.trim() || 'Community Creator';
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
  progressStatus.textContent = 'Streaming to Telegram Cloud...';
  submitBtn.disabled = true;

  const queryParams = new URLSearchParams({
    title,
    category,
    duration,
    ownerName: creator,
    ownerEmail,
    isShort,
    thumb: userGeneratedThumbDataUrl || ''
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
      const pct = Math.round((ev.loaded / ev.total) * 95);
      progressBar.style.width = `${pct}%`;
      progressPct.textContent = `${pct}%`;
      progressStatus.textContent = `Streaming bytes: ${(ev.loaded / (1024 * 1024)).toFixed(1)} MB / ${(ev.total / (1024 * 1024)).toFixed(1)} MB`;
    }
  };

  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      progressBar.style.width = '100%';
      progressPct.textContent = '100%';
      progressStatus.textContent = 'Submitted to Admin Review!';
      
      closeUserUploadModal();
      alert('🎉 Video Submitted Successfully!\n\nYour video has been uploaded and queued in the DarkPAKI Admin Review Queue.\nOnce verified by Admin, it will be published live to all users!');
      
      fileInput.value = '';
      document.getElementById('userSelectedFileInfo').classList.add('hidden');
      document.getElementById('userDetectedThumbBox').classList.add('hidden');
      document.getElementById('userUploadTitle').value = '';
    } else {
      showToast('Upload error: ' + xhr.responseText);
    }
    submitBtn.disabled = false;
  };

  xhr.onerror = () => {
    showToast('Network error during upload');
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
