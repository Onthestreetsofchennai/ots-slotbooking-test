
// =======================================
// =======================================
// DEFAULT DATA (used only on very first load)
// =======================================
const DEFAULT_VENUES = [
  {id:'pondy',   name:'Pondy Bazaar',      day:'Saturday', date:'2026-04-05', timeStart:'18:00', timeEnd:'21:00', confirmStatus:'Available', visibility:'Public',  status:'open'},
  {id:'marina',  name:'Marina Beach',      day:'Sunday',   date:'2026-04-06', timeStart:'17:00', timeEnd:'20:00', confirmStatus:'Available', visibility:'Public',  status:'open'},
  {id:'besant',  name:'Besant Nagar Beach',day:'Friday',   date:'2026-04-11', timeStart:'18:30', timeEnd:'21:30', confirmStatus:'Available', visibility:'Public',  status:'open'},
  {id:'tnagar',  name:'T. Nagar',          day:'Saturday', date:'2026-04-12', timeStart:'19:00', timeEnd:'22:00', confirmStatus:'Available', visibility:'Public',  status:'open'},
];

const TYPE_COLORS = {'Solo':'#F0771E','2 Piece':'#F577A1','3 Piece':'#9E76CC','4 Piece':'#70BAF4'};

let venues      = [];
let allBookings = [];
let myBookings  = [];
let galleryPhotos = [];
let adminPhone  = '';   // loaded from settings table at startup
let helpdeskNumbers = []; // loaded from settings table; list of public helpdesk phones
let zoneNames = ['Zone A','Zone B','Zone C']; // editable from admin settings
let communityAds = []; // active home page news/event announcements
let memberZoneFilter = 'all';
let members     = []; // {id, name, phone, addedAt, active}
let selectedVenueId  = null;
let selectedDate     = null;
let currentFilter    = 'all';
let currentAdminTab  = 'approvals';
let bookingPage      = 1;
let bookingPageSize  = 50;
let memberPage       = 1;
let memberPageSize   = 50;
let editingVenueId   = null;
let csvParsedRows    = [];
let _venueSaving      = false;


// =======================================
// NEON DB CONFIG
// =======================================
const NEON_CONN = 'postgresql://neondb_owner:npg_eXKAz7xi1SUO@ep-noisy-haze-anhmi8al-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require';
// On Replit (dev/deployed) use local proxy; anywhere else (GitHub Pages etc) call Neon directly.
// Direct calls omit Content-Type so the browser preflight only checks Neon-Connection-String
// which Neon explicitly allows in its CORS policy.
const host = window.location.hostname || '';
const isReplit = host.includes('replit');

const NEON_SQL_URL = isReplit
  ? '/api/neon-proxy'
  : 'https://ep-noisy-haze-anhmi8al-pooler.c-6.us-east-1.aws.neon.tech/sql';

const NEON_HDR = isReplit
  ? { 'Content-Type': 'application/json', 'Neon-Connection-String': NEON_CONN }
  : { 'Neon-Connection-String': NEON_CONN };
const NEON_TIMEOUT_MS = 20000;
const OTS_APP_VERSION = '2026-05-03-error-reporting';
// Backend auth: OTPs are generated and verified by the Cloudflare Worker.
const AUTH_API_BASE = 'https://morning-firefly-ff5dots-auth.sharoncornerstone56.workers.dev';
const GOOGLE_CLIENT_ID = '';
// Push can use the Worker without forcing member login to use backend OTP.
const PUSH_API_BASE = 'https://morning-firefly-ff5dots-auth.sharoncornerstone56.workers.dev';
// Live data sync goes through the Worker first so web and APK use the same backend path.
const DATA_API_BASE = 'https://morning-firefly-ff5dots-auth.sharoncornerstone56.workers.dev';
let _nativePushToken = '';
let _pushTokenTableReady = false;

function otsAppMode() {
  var mode = String(window.OTS_APP_MODE || '').toLowerCase();
  if (mode === 'admin' || mode === 'member') return mode;
  return /admin\.html$/i.test(window.location.pathname || '') ? 'admin' : 'member';
}
function otsIsAdminApp() { return otsAppMode() === 'admin'; }
function otsIsMemberApp() { return otsAppMode() !== 'admin'; }
function otsAdminEntry() { return window.OTS_ADMIN_ENTRY || './admin.html'; }
function otsMemberEntry() { return window.OTS_MEMBER_ENTRY || './index.html'; }
function otsPublicPageFromHash() {
  var page = String((window.location.hash || '').replace(/^#/, '') || '').trim().toLowerCase();
  return ['home','venues','form','myrequests','leaderboard','profile','chat'].indexOf(page) > -1 ? page : '';
}
function openAdminEntry(hash) {
  var target = otsAdminEntry() + (hash || '#admin');
  if (otsIsAdminApp()) {
    if (hash) window.location.hash = hash;
    return;
  }
  window.location.href = target;
}
function openMemberEntry(hash) {
  var cleanHash = hash || '#home';
  var target = otsMemberEntry() + cleanHash;
  var page = String(cleanHash || '').replace(/^#/, '') || 'home';
  try { localStorage.setItem('ots_current_page', page); } catch(e) {}
  if (otsIsMemberApp()) {
    if (cleanHash) window.location.hash = cleanHash;
    if (typeof showPage === 'function') showPage(page);
    return;
  }
  window.location.href = target;
}
function openPublicPage(page) {
  page = page || 'home';
  if (otsIsAdminApp()) {
    openMemberEntry('#' + page);
    return;
  }
  showPage(page);
}

// -- Neon DB: No realtime WebSocket - using polling for cross-device sync --
// (Polling was already the backup mechanism; now it's the primary one)
function initRealtime() { /* No-op: Neon uses polling instead of WebSocket */ }
function startRealtimeSubscription() {}
function stopRealtimeSubscription() {}

// localStorage fallback key
const LS_KEY = 'ots_local_v4';
const MY_BOOKINGS_KEY = 'ots_my_bookings_v1'; // persists user's own requests across refresh
const DISMISSED_KEY   = 'ots_dismissed_v1';   // booking IDs the member has explicitly cleared
let _dismissedIds = new Set();
let _syncTimer = null;

function saveDismissed() {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([..._dismissedIds])); } catch(e){}
}
function loadDismissed() {
  try {
    var raw = localStorage.getItem(DISMISSED_KEY);
    _dismissedIds = new Set(raw ? JSON.parse(raw) : []);
  } catch(e) { _dismissedIds = new Set(); }
}

// Cross-device dismiss sync: stores cleared request IDs in Neon per member.
// This keeps cleared My Requests from coming back on another phone/laptop.
let _remoteDismissLoadedFor = '';
function getMemberKey(){
  var e = (memberEmail || '').trim().toLowerCase();
  if (e) return 'email:' + e;
  var p = _normPhone(memberPhone || '');
  return p ? 'phone:' + p : '';
}
async function loadDismissedRemote(force){
  var key = getMemberKey();
  if (!key) return;
  if (!force && _remoteDismissLoadedFor === key) return;
  try {
    var rows = await neonSQL('SELECT booking_id FROM dismissed_requests WHERE user_key = $1', [key]);
    (rows || []).forEach(function(r){ if (r.booking_id != null) _dismissedIds.add(String(r.booking_id)); });
    _remoteDismissLoadedFor = key;
    saveDismissed();
  } catch(e) { console.warn('[OTS] remote dismissed request load skipped:', e && (e.message||e)); }
}
async function saveDismissedRemote(ids){
  var key = getMemberKey();
  if (!key || !ids || !ids.length) return;
  ids = ids.map(String);
  try {
    var params = [key];
    var values = ids.map(function(id, i){ params.push(id); return '($1,$' + (i+2) + ')'; }).join(',');
    await neonSQL('INSERT INTO dismissed_requests (user_key, booking_id) VALUES ' + values + ' ON CONFLICT (user_key, booking_id) DO NOTHING', params);
  } catch(e) { console.warn('[OTS] remote dismissed request save skipped:', e && (e.message||e)); }
}
async function clearDismissedRemoteForCurrentMember() {
  var key = getMemberKey();
  if (!key) return false;
  await neonSQL('DELETE FROM dismissed_requests WHERE user_key=$1', [key]);
  _remoteDismissLoadedFor = '';
  return true;
}

// -- Save / restore myBookings locally so they survive page refresh --
function saveMyBookings() {
  try { localStorage.setItem(MY_BOOKINGS_KEY, JSON.stringify(myBookings)); } catch(e){}
}
function loadMyBookings() {
  try {
    const raw = localStorage.getItem(MY_BOOKINGS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}
// Pull any bookings belonging to the logged-in phone from the live server list.
// This makes bookings visible on any device the member logs into.
// Normalize a phone to last-10-digits for fuzzy matching across devices
function _normPhone(p) {
  var digits = (p || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function restoreMyBookingsFromServer() {
  if (!memberLoggedIn) return;
  if (!allBookings.length) return;
  var myPhone = _normPhone(memberPhone);
  var myEmail = (memberEmail || '').trim().toLowerCase();
  if (!myPhone && !myEmail) return;

  var changed = false;
  allBookings.forEach(function(ab) {
    if (ab.status === 'cancelled') return;
    if (_dismissedIds.has(String(ab.id))) return; // user explicitly cleared this - never bring it back
    var abPhone = _normPhone(ab.phone);
    var abEmail = (ab.email || '').trim().toLowerCase();
    var matches = (myPhone && abPhone && abPhone === myPhone) ||
                  (myEmail && abEmail && abEmail === myEmail);
    if (!matches) return;
    var existing = myBookings.find(function(mb){ return mb.id === ab.id; });
    if (!existing) {
      myBookings.push(ab);
      changed = true;
    } else if (existing.status !== ab.status) {
      existing.status = ab.status;
      changed = true;
    } else if (existing.type !== ab.type || JSON.stringify(parseBookingPerformers(existing.performers)) !== JSON.stringify(parseBookingPerformers(ab.performers))) {
      existing.type = ab.type;
      existing.performers = ab.performers;
      changed = true;
    }
  });
  if (changed) {
    myBookings.sort(function(a,b){ return (b.createdAt||'').localeCompare(a.createdAt||''); });
    saveMyBookings();
    renderUserBookings();
    updateHeroStats();
    updatePendingBadge();
    if (myBookings.some(function(b){ return b.status==='pending'; })) startStatusPolling();
  }
}

// Live fetch of this member's own bookings from server - called when opening My Requests
async function fetchMyBookingsLive() {
  if (!memberLoggedIn) return;
  await loadDismissedRemote();
  await loadDismissedNotifsRemote();
  var myPhone = _normPhone(memberPhone);
  var myEmail = (memberEmail || '').trim().toLowerCase();
  if (!myPhone && !myEmail) return;
  try {
    // Targeted SQL: only fetch THIS member's bookings (phone last-10 or email match)
    var rows = await neonSQL(
      'SELECT id, venue_id, venue, date, type, name, booked_by, phone, email, notes, visibility, status, created_at, ' + LIGHT_PROOF_SQL + ', proof_claimed, checkin_at, checkin_lat, checkin_lng, checkin_accuracy, checkin_map_url, performers ' +
      'FROM bookings ' +
      'WHERE RIGHT(REGEXP_REPLACE(phone,\'[^0-9]\',\'\',\'g\'),10) = $1 ' +
      '   OR LOWER(TRIM(email)) = $2 ' +
      '   OR performers LIKE $3 ' +
      'ORDER BY created_at DESC',
      [myPhone || '', myEmail || '', '%' + (myPhone || '__NO_PHONE__') + '%']
    );
    var changed = false;
    rows.forEach(function(b) {
    var sb = {
      id: b.id, venueId: b.venue_id||'', venue: b.venue||'',
      date: b.date||'', type: b.type||'', name: b.name||'',
      bookedBy: b.booked_by||'',
      phone: b.phone||'', email: b.email||'', notes: b.notes||'',
      performers: parseBookingPerformers(b.performers),
      visibility: normalizeTitleCase(b.visibility, 'Public'),
        status: b.status||'pending', createdAt: b.created_at||'',
        proofUrl: b.proof_url||'', proofClaimed: !!b.proof_claimed,
        checkinAt: b.checkin_at||null,
        checkinLat: b.checkin_lat||null,
        checkinLng: b.checkin_lng||null,
        checkinAccuracy: b.checkin_accuracy||null,
        checkinMapUrl: b.checkin_map_url||''
      };
      // If the member explicitly cleared this booking, never show it again
      if (_dismissedIds.has(String(sb.id))) return;
      if (sb.status === 'cancelled') {
        var ex = myBookings.find(function(m){ return m.id === sb.id; });
        if (ex && ex.status !== 'cancelled') { ex.status = 'cancelled'; changed = true; }
        return;
      }
      var existing = myBookings.find(function(m){ return m.id === sb.id; });
      if (!existing) {
        myBookings.push(sb);
        changed = true;
      } else {
        var updated = false;
        if (existing.status !== sb.status)           { existing.status       = sb.status;       updated = true; }
        if (sb.bookedBy && existing.bookedBy !== sb.bookedBy) { existing.bookedBy = sb.bookedBy; updated = true; }
        if (JSON.stringify(parseBookingPerformers(existing.performers)) !== JSON.stringify(parseBookingPerformers(sb.performers))) { existing.performers = sb.performers; updated = true; }
        if (existing.proofClaimed !== sb.proofClaimed){ existing.proofClaimed = sb.proofClaimed; updated = true; }
        if (sb.proofUrl && !existing.proofUrl)        { existing.proofUrl    = sb.proofUrl;      updated = true; }
        if (sb.checkinAt && !existing.checkinAt)      { existing.checkinAt   = sb.checkinAt;     updated = true; }
        if (updated) changed = true;
      }
    });
    if (changed) {
      myBookings.sort(function(a,b){ return (b.createdAt||'').localeCompare(a.createdAt||''); });
      saveMyBookings();
      updateHeroStats();
      updatePendingBadge();
    }
    renderUserBookings();
  } catch(e) { console.warn('[OTS] fetchMyBookingsLive failed:', e); }
}

// -- Sync status indicator --
function showSyncStatus(msg, color) {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  el.textContent = msg; el.style.color = color||'var(--muted)'; el.style.opacity='1';
  clearTimeout(el._t); el._t = setTimeout(()=>el.style.opacity='0',3000);
}

// -- Neon DB helpers --
// Core: execute a SQL query via Neon's HTTP endpoint
function dataBackendEnabled() {
  return !!(DATA_API_BASE && /^https:\/\//i.test(DATA_API_BASE));
}

function dataApiUrl(path) {
  return DATA_API_BASE.replace(/\/+$/,'') + path;
}

async function workerSQL(query, params) {
  var controller = null;
  var timeoutId = null;
  var fetchOpts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: query, params: params || [] })
  };
  if (typeof AbortController !== 'undefined') {
    controller = new AbortController();
    fetchOpts.signal = controller.signal;
    timeoutId = setTimeout(function(){ try { controller.abort(); } catch(e){} }, NEON_TIMEOUT_MS);
  }
  try {
    var r = await fetch(dataApiUrl('/data/query'), fetchOpts);
    var data = {};
    try { data = await r.json(); } catch(e) {}
    if (!r.ok || data.ok === false) throw new Error(data.error || ('Worker SQL HTTP ' + r.status));
    return Array.isArray(data.rows) ? data.rows : [];
  } catch(e) {
    if (e && e.name === 'AbortError') throw new Error('Worker SQL request timed out');
    throw e;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function neonSQL(query, params) {
  if (dataBackendEnabled()) {
    try {
      return await workerSQL(query, params);
    } catch(workerErr) {
      console.warn('[OTS] Worker SQL failed, falling back to direct Neon:', workerErr && (workerErr.message || workerErr));
    }
  }
  var controller = null;
  var timeoutId = null;
  var fetchOpts = {
    method: 'POST',
    headers: NEON_HDR,
    body: JSON.stringify({ query: query, params: params || [] })
  };
  if (typeof AbortController !== 'undefined') {
    controller = new AbortController();
    fetchOpts.signal = controller.signal;
    timeoutId = setTimeout(function(){ try { controller.abort(); } catch(e){} }, NEON_TIMEOUT_MS);
  }
  let r;
  try {
    r = await fetch(NEON_SQL_URL, fetchOpts);
  } catch(e) {
    if (e && e.name === 'AbortError') throw new Error('Neon request timed out');
    throw e;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
  if (!r.ok) {
    var errText = ''; try { errText = await r.text(); } catch(e){}
    if (errText && errText.toLowerCase().includes('transfer')) {
      showToast('', 'Database Limit', 'Monthly data transfer limit reached. Image uploads are paused until the quota resets.');
    }
    throw new Error(errText || ('Neon HTTP ' + r.status));
  }
  const data = await r.json();
  if (!data.fields || !data.rows) return [];
  return data.rows.map(function(row) {
    if (!Array.isArray(row)) return row; // Neon returns rows as key-value objects
    var obj = {};
    data.fields.forEach(function(f, i) { obj[f.name] = row[i]; });
    return obj;
  });
}

// =======================================
// PRIVACY-SAFE ERROR REPORTING
// =======================================
const CLIENT_ERROR_QUEUE_KEY = 'ots_client_error_queue_v1';
let _clientErrorTableReady = false;
let _clientErrorFlushRunning = false;
let _clientErrorInstalled = false;
let _clientErrorLastSent = {};

function sanitizeErrorText(value) {
  var text = String(value || '');
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/(\+?\d[\d\s().-]{7,}\d)/g, '[phone]')
    .replace(/postgresql:\/\/[^\s'"]+/gi, 'postgresql://[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/otp[=:]\s*\d{4,8}/gi, 'otp=[redacted]')
    .slice(0, 1800);
}

function getClientErrorRoute() {
  var hash = (window.location.hash || '').slice(0, 80);
  if (window.location.protocol === 'file:') return 'android-or-local' + hash;
  return (window.location.pathname || '/') + hash;
}

function buildClientErrorPayload(kind, err, extra) {
  var message = '';
  var stack = '';
  if (err && err.message) message = err.message;
  else message = String(err || 'Unknown error');
  if (err && err.stack) stack = err.stack;
  return {
    id: 'ERR-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    createdAt: new Date().toISOString(),
    appVersion: OTS_APP_VERSION,
    source: window.location.protocol === 'file:' ? 'android-apk' : 'web',
    severity: (extra && extra.severity) || 'error',
    kind: kind || 'runtime',
    route: getClientErrorRoute(),
    message: sanitizeErrorText(message),
    stack: sanitizeErrorText(stack),
    userAgent: sanitizeErrorText(navigator.userAgent || ''),
    platform: sanitizeErrorText(navigator.platform || ''),
    screen: (window.innerWidth || 0) + 'x' + (window.innerHeight || 0) + '@' + (window.devicePixelRatio || 1),
    online: navigator.onLine !== false
  };
}

function queueClientErrorReport(payload) {
  try {
    var q = JSON.parse(localStorage.getItem(CLIENT_ERROR_QUEUE_KEY) || '[]');
    q.push(payload);
    if (q.length > 25) q = q.slice(q.length - 25);
    localStorage.setItem(CLIENT_ERROR_QUEUE_KEY, JSON.stringify(q));
  } catch(e) {}
}

async function ensureClientErrorTable() {
  if (_clientErrorTableReady) return;
  await neonSQL(
    "CREATE TABLE IF NOT EXISTS client_error_reports (" +
    "id TEXT PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT NOW(), app_version TEXT, source TEXT, severity TEXT, kind TEXT, route TEXT, message TEXT, stack TEXT, user_agent TEXT, platform TEXT, screen TEXT, online BOOLEAN, handled BOOLEAN DEFAULT false)"
  );
  _clientErrorTableReady = true;
}

async function sendClientErrorReport(payload) {
  if (authBackendEnabled()) {
    try {
      var res = await fetch(authApiUrl('/client-error'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) return true;
    } catch(e) {}
  }
  await ensureClientErrorTable();
  await neonSQL(
    'INSERT INTO client_error_reports (id, created_at, app_version, source, severity, kind, route, message, stack, user_agent, platform, screen, online, handled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false) ON CONFLICT (id) DO NOTHING',
    [payload.id, payload.createdAt, payload.appVersion, payload.source, payload.severity, payload.kind, payload.route, payload.message, payload.stack, payload.userAgent, payload.platform, payload.screen, payload.online]
  );
  return true;
}

function reportClientError(kind, err, extra) {
  try {
    var payload = buildClientErrorPayload(kind, err, extra || {});
    var sig = payload.kind + '|' + payload.route + '|' + payload.message.slice(0, 160);
    var now = Date.now();
    if (_clientErrorLastSent[sig] && now - _clientErrorLastSent[sig] < 60000) return;
    _clientErrorLastSent[sig] = now;
    sendClientErrorReport(payload).catch(function(){ queueClientErrorReport(payload); });
  } catch(e) {}
}

async function flushClientErrorQueue() {
  if (_clientErrorFlushRunning) return;
  _clientErrorFlushRunning = true;
  try {
    var q = JSON.parse(localStorage.getItem(CLIENT_ERROR_QUEUE_KEY) || '[]');
    if (!q.length) return;
    var left = [];
    for (var i = 0; i < q.length; i++) {
      try { await sendClientErrorReport(q[i]); }
      catch(e) { left.push(q[i]); }
    }
    localStorage.setItem(CLIENT_ERROR_QUEUE_KEY, JSON.stringify(left.slice(-25)));
  } catch(e) {
  } finally {
    _clientErrorFlushRunning = false;
  }
}

function installClientErrorReporting() {
  if (_clientErrorInstalled) return;
  _clientErrorInstalled = true;
  window.addEventListener('error', function(e) {
    reportClientError('window.error', e && e.error ? e.error : (e && e.message), { severity:'error' });
  });
  window.addEventListener('unhandledrejection', function(e) {
    reportClientError('unhandledrejection', e && e.reason ? e.reason : 'Unhandled promise rejection', { severity:'error' });
  });
  var originalConsoleError = console.error;
  console.error = function() {
    try {
      var firstError = null;
      var parts = [];
      for (var i = 0; i < arguments.length; i++) {
        var a = arguments[i];
        if (!firstError && a && a.message) firstError = a;
        parts.push(a && a.message ? a.message : Object.prototype.toString.call(a));
      }
      reportClientError('console.error', firstError || parts.join(' '), { severity:'warning' });
    } catch(e) {}
    return originalConsoleError.apply(console, arguments);
  };
  window.addEventListener('online', flushClientErrorQueue);
  setTimeout(flushClientErrorQueue, 3500);
  setInterval(flushClientErrorQueue, 45000);
}

async function loadClientErrorReports() {
  var el = document.getElementById('clientErrorReportsList');
  if (el) el.innerHTML = '<div class="table-empty"><span class="emoji"></span>Loading error reports...</div>';
  try {
    await ensureClientErrorTable();
    var rows = await neonSQL(
      'SELECT * FROM client_error_reports ORDER BY handled ASC, created_at DESC LIMIT 80'
    );
    renderClientErrorReports(rows || []);
  } catch(e) {
    if (el) el.innerHTML = '<div class="table-empty"><span class="emoji"></span>Could not load error reports. Try again.</div>';
    console.error('Failed to load error reports:', e);
  }
}

function renderClientErrorReports(rows) {
  var el = document.getElementById('clientErrorReportsList');
  if (!el) return;
  var canEditErrors = hasAdminPerm('errors');
  if (!rows.length) {
    el.innerHTML = '<div class="table-empty"><span class="emoji"></span>No error reports found</div>';
    return;
  }
  el.innerHTML = rows.map(function(r) {
    return '<div class="error-report-card ' + (r.handled ? 'handled' : '') + '">' +
      '<div class="error-report-top"><div class="error-report-title">' + esc(r.message || 'Unknown error') + '</div><div class="error-report-time">' + formatDateTime(r.created_at || r.createdAt) + '</div></div>' +
      '<div class="error-report-meta">' +
        '<span class="error-report-pill">' + esc(r.source || '-') + '</span>' +
        '<span class="error-report-pill">' + esc(r.kind || '-') + '</span>' +
        '<span class="error-report-pill">' + esc(r.route || '-') + '</span>' +
        '<span class="error-report-pill">' + esc(r.screen || '-') + '</span>' +
        '<span class="error-report-pill">' + (r.online ? 'online' : 'offline') + '</span>' +
      '</div>' +
      (r.stack ? '<div class="error-report-stack">' + esc(r.stack) + '</div>' : '') +
      '<div class="error-report-actions">' +
        (r.handled ? '<span class="error-report-pill">reviewed</span>' : (canEditErrors ? '<button class="filter-btn perm-errors-edit" onclick="markClientErrorHandled(' + esc(JSON.stringify(String(r.id || ''))) + ')">Mark Reviewed</button>' : '<span class="error-report-pill">needs review</span>')) +
      '</div>' +
    '</div>';
  }).join('');
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(value) {
  if (!value) return '-';
  var d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}

async function markClientErrorHandled(id) {
  if (!requireAdminPerm('errors', 'error report review')) return;
  try {
    await neonSQL('UPDATE client_error_reports SET handled=true WHERE id=$1', [id]);
    loadClientErrorReports();
  } catch(e) {
    showToast('', 'Error Reports', 'Could not mark this report as reviewed.');
    console.error('Failed to mark error report reviewed:', e);
  }
}

function testClientErrorReporting() {
  if (!requireAdminPerm('errors', 'error report testing')) return;
  reportClientError('manual-test', new Error('Manual test report from admin panel'), { severity:'info' });
  showToast('', 'Error Reports', 'Test report sent. Refresh in a moment.');
  setTimeout(loadClientErrorReports, 1200);
}
installClientErrorReporting();

// SELECT helper (drop-in replacement for sbGet)
async function sbGet(table, select) {
  var cols = select || '*';
  let lastErr;
  for (var _attempt = 0; _attempt < 2; _attempt++) {
    try {
      return await neonSQL('SELECT ' + cols + ' FROM ' + table);
    } catch(e) {
      lastErr = e;
      if (_attempt === 0) await new Promise(function(res){ setTimeout(res, 250); });
    }
  }
  throw lastErr;
}

// UPSERT helper (drop-in replacement for sbUpsert)
async function sbUpsert(table, rows) {
  if (!rows || !rows.length) return;
  var keys = Object.keys(rows[0]);
  var allParams = [];
  var valueSets = [];
  var idx = 1;
  for (var r = 0; r < rows.length; r++) {
    var placeholders = [];
    for (var k = 0; k < keys.length; k++) {
      placeholders.push('$' + idx++);
      var val = rows[r][keys[k]];
      allParams.push(val === undefined ? null : val);
    }
    valueSets.push('(' + placeholders.join(',') + ')');
  }
  var quotedKeys = keys.map(function(k){ return '"' + k + '"'; });
  var updateCols = keys.filter(function(k){ return k !== 'id'; })
    .map(function(k){ return '"' + k + '" = EXCLUDED."' + k + '"'; });
  var sql = 'INSERT INTO ' + table + ' (' + quotedKeys.join(',') + ') VALUES '
    + valueSets.join(',')
    + ' ON CONFLICT (id) DO UPDATE SET ' + updateCols.join(',');
  await neonSQL(sql, allParams);
}

// DELETE helper (drop-in replacement for sbDelete)
async function sbDelete(table, id) {
  await neonSQL('DELETE FROM ' + table + ' WHERE id = $1', [id]);
}

// PATCH helper - update specific columns by id (replaces direct Supabase PATCH calls)
async function dbPatch(table, id, updates) {
  var keys = Object.keys(updates);
  var sets = keys.map(function(k, i) { return '"' + k + '" = $' + (i + 2); });
  var params = [id];
  keys.forEach(function(k) { params.push(updates[k]); });
  await neonSQL('UPDATE ' + table + ' SET ' + sets.join(', ') + ' WHERE id = $1', params);
}

// -- localStorage backup --
function saveLocal() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({venues,allBookings,galleryPhotos,savedAt:Date.now()})); } catch(e){}
  saveMyBookings();
}

async function saveRemoteNow(showToastOnFail) {
  showSyncStatus(' Syncing live...','var(--yellow)');
  // Map JS camelCase  DB snake_case for venues
  const venueRows = venues.map(v=>({
    id:v.id, name:v.name, day:v.day||'', date:v.date||'',
    time_start:v.timeStart||'', time_end:v.timeEnd||'',
    confirm_status:v.confirmStatus||'Available',
    visibility:v.visibility||'Public', status:v.status||'open',
    venue_type:v.venueType||'',
    landmark:v.landmark||'',
    map_url:v.mapUrl||'',
    image_url:v.imageUrl||''
  }));
  const bookingRows = allBookings.map(b=>({
    id:b.id, venue_id:b.venueId||'', venue:b.venue||'',
    date:b.date||'', type:b.type||'', name:b.name||'',
    booked_by:b.bookedBy||b.booked_by||'',
    phone:b.phone||'', email:b.email||'',
    notes:b.notes||'',
    performers:stringifyBookingPerformers(b.performers || []),
    visibility:'Public',
    status:b.status||'pending', created_at:b.createdAt||new Date().toISOString(),
    push_token:b.pushToken||''
  }));
  const galleryRows = galleryPhotos.map(p=>({id:p.id,url:p.url,caption:p.caption||''}));

  try {
    if(venueRows.length)   await sbUpsert('venues',  venueRows);
    if(bookingRows.length) await sbUpsert('bookings',bookingRows);
    if(galleryRows.length) await sbUpsert('gallery', galleryRows);
    showSyncStatus(' Saved to Neon','var(--green)');
    return true;
  } catch(e) {
    console.error('Neon save error:', e && (e.message || JSON.stringify(e)));
    showSyncStatus(' Saved on this device only','var(--orange)');
    if (showToastOnFail) showToast('', 'Live Sync Failed', 'Saved here, but Neon did not accept the update. Other devices will not see it yet.');
    return false;
  }
}

// -- Save all tables to Neon (debounced) --
function saveRemote() {
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(function(){ saveRemoteNow(false); }, 600);
}

function saveAll() { saveLocal(); saveRemote(); }


// -- LIVE-ONLY FAST LOAD HELPERS (no venue cache) --
function normalizeVenueDate(value) {
  if (!value) return '';
  var s = String(value).trim();
  // Neon can return DATE as YYYY-MM-DD or full ISO timestamp. Calendar needs only YYYY-MM-DD.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  var monthMap = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
  var dmY = s.match(/^(\d{1,2})[\/-]([A-Za-z]{3,})[\/-](\d{4})$/);
  if (dmY) {
    var mon = monthMap[dmY[2].toLowerCase().slice(0,3)];
    if (mon) return dmY[3] + '-' + mon + '-' + String(dmY[1]).padStart(2,'0');
  }
  // Handles accidental DD/MM/YYYY or DD-MM-YYYY imports.
  var m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (m) return m[3] + '-' + String(m[2]).padStart(2,'0') + '-' + String(m[1]).padStart(2,'0');
  return s.slice(0, 10);
}
function normalizeStatus(value, fallback) {
  return String(value || fallback || '').trim().toLowerCase();
}
function normalizeTitleCase(value, fallback) {
  var s = String(value || fallback || '').trim();
  if (!s) return fallback || '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
function normalizeVenueType(value, venueName) {
  var raw = String(value || '').trim();
  var hay = (raw + ' ' + String(venueName || '')).toLowerCase();
  if (/\bgcc\b/.test(hay) || hay.indexOf('greater chennai') > -1 || hay.indexOf('corporation') > -1) return 'GCC Venue';
  if (hay.indexOf('metro') > -1) return 'Metro';
  if (hay.indexOf('foundation') > -1) return 'Foundation';
  if (hay.indexOf('private') > -1) return 'Private';
  if (hay.indexOf('partner') > -1) return 'Partner Venue';
  if (/^(gcc|gcc venue)$/i.test(raw)) return 'GCC Venue';
  if (/^(metro|metro venue)$/i.test(raw)) return 'Metro';
  if (/^(foundation|foundation venue)$/i.test(raw)) return 'Foundation';
  if (/^(private|private venue)$/i.test(raw)) return 'Private';
  if (/^(partner|partner venue)$/i.test(raw)) return 'Partner Venue';
  return '';
}
function normalizeVenueNameForDuplicate(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function normalizeVenueClockForDuplicate(value) {
  var c = parseVenueClock(value, '');
  if (!c) return String(value || '').trim();
  return String(c.h).padStart(2, '0') + ':' + String(c.m).padStart(2, '0');
}
function venueDuplicateKey(v) {
  if (!v) return '';
  var name = normalizeVenueNameForDuplicate(v.name);
  var date = normalizeVenueDate(v.date || '');
  var start = normalizeVenueClockForDuplicate(v.timeStart || v.time_start || '');
  var end = normalizeVenueClockForDuplicate(v.timeEnd || v.time_end || '');
  if (!name || !date || !start || !end) return '';
  return [name, date, start, end].join('|');
}
function findDuplicateVenue(candidate, excludeId) {
  var key = venueDuplicateKey(candidate);
  if (!key) return null;
  return (venues || []).find(function(v) {
    return String(v.id || '') !== String(excludeId || '') && venueDuplicateKey(v) === key;
  }) || null;
}
function venueHasUsefulValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}
function mergeDuplicateVenueIntoKeeper(keeper, duplicate) {
  if (!keeper || !duplicate) return;
  ['venueType','landmark','mapUrl','imageUrl','confirmStatus','visibility','day'].forEach(function(field) {
    if (!venueHasUsefulValue(keeper[field]) && venueHasUsefulValue(duplicate[field])) keeper[field] = duplicate[field];
  });
  if (normalizeStatus(duplicate.status, '') === 'open') keeper.status = 'open';
}
function getDuplicateVenuePlan() {
  var byKey = {};
  var display = [];
  var removedIds = [];
  var replacementMap = {};
  var groups = [];
  (venues || []).forEach(function(v) {
    var key = venueDuplicateKey(v);
    if (!key) {
      display.push(v);
      return;
    }
    if (!byKey[key]) {
      byKey[key] = { keeper:v, duplicates:[] };
      display.push(v);
      return;
    }
    var group = byKey[key];
    mergeDuplicateVenueIntoKeeper(group.keeper, v);
    group.duplicates.push(v);
    removedIds.push(v.id);
    replacementMap[v.id] = group.keeper.id;
  });
  Object.keys(byKey).forEach(function(key) {
    if (byKey[key].duplicates.length) groups.push(byKey[key]);
  });
  return { display:display, removedIds:removedIds, replacementMap:replacementMap, groups:groups, count:removedIds.length };
}
function applyDuplicateVenuePlan(plan) {
  plan = plan || getDuplicateVenuePlan();
  if (!plan.count) return plan;
  var removed = {};
  plan.removedIds.forEach(function(id){ removed[String(id)] = true; });
  venues = (venues || []).filter(function(v){ return !removed[String(v.id)]; });
  function remapBookingVenue(b) {
    if (!b) return;
    var newId = plan.replacementMap[b.venueId];
    if (newId) {
      b.venueId = newId;
      var kept = venues.find(function(v){ return String(v.id) === String(newId); });
      if (kept && kept.name) b.venue = kept.name;
    }
  }
  allBookings.forEach(remapBookingVenue);
  myBookings.forEach(remapBookingVenue);
  return plan;
}
function venueTypeBadgeHtml(v) {
  var type = normalizeVenueType(v && v.venueType, v && v.name);
  if (!type) return '';
  var color = type === 'GCC Venue' ? 'var(--green)'
    : type === 'Metro' ? 'var(--blue)'
    : type === 'Foundation' ? 'var(--purple)'
    : type === 'Private' ? 'var(--orange)'
    : 'var(--muted)';
  return `<span class="vrc-badge" style="border-color:${color};color:${color};background:rgba(255,255,255,.04);">${otsEscapeHtml(type)}</span>`;
}
function isVenueOpen(v) {
  var st = normalizeStatus(v && v.status, 'open');
  return !st || st === 'open' || st === 'active' || st === 'available';
}
function parseVenueClock(value, fallback) {
  var s = String(value || fallback || '').trim();
  if (!s) return null;
  var m = s.match(/^(\d{1,2})(?::|\.)(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  var h = parseInt(m[1], 10);
  var min = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  var meridiem = (m[3] || '').toUpperCase();
  if (meridiem === 'AM') {
    if (h === 12) h = 0;
  } else if (meridiem === 'PM') {
    if (h < 12) h += 12;
  }
  h = Math.max(0, Math.min(23, h));
  return { h: h, m: min };
}
function adjustVenueClocks(startClock, endClock) {
  if (!startClock || !endClock) return { start: startClock, end: endClock };
  var start = { h: startClock.h, m: startClock.m };
  var end = { h: endClock.h, m: endClock.m };
  // Imported slots like "11:00 - 12:00 PM" were previously stored as
  // 23:00 - 12:00, which made the app think the show ends tomorrow.
  // Treat that impossible range as 11:00 AM - 12:00 PM.
  if (start.h >= 21 && end.h === 12) start.h -= 12;
  return { start: start, end: end };
}
function getVenueClocks(v) {
  return adjustVenueClocks(
    parseVenueClock(v && v.timeStart, '00:00'),
    parseVenueClock(v && v.timeEnd, '23:59')
  );
}
function formatVenueClock(clock) {
  if (!clock) return '-';
  var hr = Number(clock.h) || 0;
  var min = String(Number(clock.m) || 0).padStart(2, '0');
  var ampm = hr >= 12 ? 'PM' : 'AM';
  return (hr % 12 || 12) + ':' + min + ' ' + ampm;
}
function formatVenueTimeRange(v) {
  var clocks = getVenueClocks(v);
  if (!clocks.start || !clocks.end) return '-';
  return formatVenueClock(clocks.start) + ' - ' + formatVenueClock(clocks.end);
}
function venueDateTime(iso, clock) {
  iso = normalizeVenueDate(iso);
  var p = iso.split('-').map(Number);
  if (p.length !== 3 || !p[0] || !p[1] || !p[2] || !clock) return null;
  return new Date(p[0], p[1] - 1, p[2], clock.h, clock.m, 0, 0);
}
function getVenueWindow(v) {
  if (!v || !normalizeVenueDate(v.date)) return null;
  var clocks = getVenueClocks(v);
  var start = venueDateTime(v.date, clocks.start);
  var end = venueDateTime(v.date, clocks.end);
  if (!start || !end) return null;
  if (end <= start) end.setDate(end.getDate() + 1);
  return { start: start, end: end };
}
function isVenueOver(v, now) {
  var windowInfo = getVenueWindow(v);
  if (!windowInfo) return isBeforeTodayIso(v && v.date);
  return windowInfo.end.getTime() <= (now || new Date()).getTime();
}
function isVenueUpcomingForUsers(v) {
  return isVenueOpen(v) && normalizeVenueDate(v.date) && !isVenueOver(v);
}
function getBookingWindow(b) {
  if (!b) return null;
  var date = normalizeVenueDate(b.date);
  if (!date) return null;
  var v = findVenueForBooking(b);
  var clocks = getVenueClocks(v);
  var start = venueDateTime(date, clocks.start);
  var end = venueDateTime(date, clocks.end);
  if (!start || !end) return null;
  if (end <= start) end.setDate(end.getDate() + 1);
  return { start: start, end: end };
}
function isBookingShowOver(b, now) {
  if (!b) return true;
  var windowInfo = getBookingWindow(b);
  if (windowInfo) return windowInfo.end.getTime() <= (now || new Date()).getTime();
  var date = normalizeVenueDate(b.date);
  if (!date) return false;
  return date < todayIsoLocal();
}
function bookingStartTimeMs(b) {
  var w = getBookingWindow(b);
  if (w) return w.start.getTime();
  var date = normalizeVenueDate(b && b.date);
  var fallback = date ? new Date(date + 'T00:00:00').getTime() : 0;
  return Number.isFinite(fallback) ? fallback : 0;
}
function getBookingPersonName(b) {
  return String((b && (b.bookedBy || b.booked_by)) || '').trim();
}

function parseBookingPerformers(value) {
  if (Array.isArray(value)) return value.map(function(m){
    return { phone:_normPhone(m.phone || ''), name:String(m.name || '').trim() };
  }).filter(function(m){ return m.phone; });
  try {
    var parsed = JSON.parse(value || '[]');
    return parseBookingPerformers(parsed);
  } catch(e) {
    return [];
  }
}

function stringifyBookingPerformers(list) {
  var seen = {};
  var out = [];
  (list || []).forEach(function(m) {
    var phone = _normPhone(m && m.phone || '');
    if (!phone || seen[phone]) return;
    seen[phone] = true;
    out.push({ phone: phone, name: String((m && m.name) || '').trim() });
  });
  return JSON.stringify(out);
}

function bookingPerformersText(b) {
  var list = parseBookingPerformers(b && b.performers);
  if (!list.length) return '';
  return list.map(function(m){ return m.name || m.phone; }).join(', ');
}

function bookingShowEnded(b) {
  var st = _showTimes(b);
  if (st && st.end) return new Date() > st.end;
  return _daysUntil(b && b.date) < 0;
}

function canEditBookingPerformers(b) {
  return !!(b && (b.status === 'pending' || b.status === 'confirmed') && !bookingShowEnded(b) && !b.proofUrl && !b.proofClaimed);
}
const LIGHT_PROOF_SQL = "CASE WHEN LENGTH(COALESCE(proof_url,'')) > 0 THEN '__uploaded__' ELSE '' END AS proof_url";
function isProofPlaceholder(url) {
  return String(url || '') === '__uploaded__';
}
function isUsableProofImageUrl(url) {
  var s = String(url || '').trim();
  if (!s || isProofPlaceholder(s)) return false;
  return /^data:image\//i.test(s) || /^https?:\/\//i.test(s) || /^blob:/i.test(s);
}
function bookingHasProofRecord(b) {
  return !!(b && (b.proofUrl || b.proofClaimed));
}
async function fetchBookingProofUrl(bookingId) {
  var rows = await neonSQL('SELECT proof_url FROM bookings WHERE id=$1 LIMIT 1', [bookingId]);
  var proof = rows && rows[0] ? (rows[0].proof_url || '') : '';
  return isUsableProofImageUrl(proof) ? proof : '';
}
function mapVenueRows(vRows) {
  return (vRows || []).map(function(v){ return {
    id:v.id, name:v.name, day:v.day||'', date:normalizeVenueDate(v.date),
    timeStart:v.time_start||'', timeEnd:v.time_end||'',
    confirmStatus:normalizeTitleCase(v.confirm_status, 'Available'),
    visibility:normalizeTitleCase(v.visibility, 'Public'), status:normalizeStatus(v.status, 'open'),
    venueType:normalizeVenueType(v.venue_type, v.name),
    landmark:v.landmark||'',
    mapUrl:v.map_url||'',
    imageUrl:v.image_url||''
  }; });
}
function mapBookingRows(bRows) {
  return (bRows || []).map(function(b){ return {
    id:b.id, venueId:b.venue_id||'', venue:b.venue||'',
    date:b.date||'', type:b.type||'', name:b.name||'',
    bookedBy:b.booked_by||b.bookedBy||'',
    phone:b.phone||'', email:b.email||'', price:b.price||0, notes:b.notes||'',
    performers:parseBookingPerformers(b.performers),
    visibility:normalizeTitleCase(b.visibility, 'Public'),
    status:b.status||'pending', createdAt:b.created_at||'',
    proofUrl:b.proof_url||'', proofClaimed:!!b.proof_claimed,
    checkinAt:b.checkin_at||null,
    checkinLat:b.checkin_lat||null,
    checkinLng:b.checkin_lng||null,
    checkinAccuracy:b.checkin_accuracy||null,
    checkinMapUrl:b.checkin_map_url||'',
    pushToken:b.push_token||''
  }; });
}
function showVenueLiveLoading(msg) {
  var list = document.getElementById('venueList');
  var title = document.getElementById('venueListTitle');
  if (title) title.textContent = 'Loading Live Venues...';
  if (list) list.innerHTML = '<div class="no-venues-day"><span class="nv-icon"></span>' + (msg || 'Fetching latest venues from Neon...') + '</div>';
}
let _liveRefreshInFlight = null;
let _lastLiveRefreshAt = 0;
const LIVE_FAST_MS = 6000;
const LIVE_STATUS_MS = 5000;
const LIVE_GIG_MS = 30000;

function liveCoreBookingsQuery() {
  var cols = 'id,venue_id,venue,date,type,name,booked_by,phone,email,notes,visibility,status,created_at,' +
    LIGHT_PROOF_SQL + ',proof_claimed,checkin_at,checkin_lat,checkin_lng,checkin_accuracy,checkin_map_url,performers';
  if (otsIsAdminApp()) {
    return {
      sql: 'SELECT ' + cols + ' FROM bookings ORDER BY created_at DESC LIMIT 1000',
      params: []
    };
  }
  var myPhone = _normPhone(memberPhone || '');
  var myEmail = (memberEmail || '').trim().toLowerCase();
  var today = todayIsoLocal();
  if (memberLoggedIn && (myPhone || myEmail)) {
    return {
      sql: 'SELECT ' + cols + ' FROM bookings ' +
        'WHERE (LOWER(COALESCE(status,\'\')) IN ($1,$2) AND LEFT(date::TEXT,10) >= $3) ' +
        '   OR RIGHT(REGEXP_REPLACE(phone,\'[^0-9]\',\'\',\'g\'),10) = $4 ' +
        '   OR LOWER(TRIM(email)) = $5 ' +
        '   OR performers LIKE $6 ' +
        'ORDER BY date ASC, created_at DESC LIMIT 300',
      params: ['confirmed', 'pending', today, myPhone || '', myEmail || '', '%' + (myPhone || '__NO_PHONE__') + '%']
    };
  }
  return {
    sql: 'SELECT ' + cols + ' FROM bookings WHERE LOWER(COALESCE(status,\'\')) IN ($1,$2) AND LEFT(date::TEXT,10) >= $3 ORDER BY date ASC, created_at DESC LIMIT 300',
    params: ['confirmed', 'pending', today]
  };
}

async function refreshLiveCoreData(opts) {
  opts = opts || {};
  if (opts.maxAgeMs && venues && venues.length && (Date.now() - _lastLiveRefreshAt) < opts.maxAgeMs) {
    return { venues: venues, bookings: allBookings, skipped: true };
  }
  if (_liveRefreshInFlight) return _liveRefreshInFlight;
  _liveRefreshInFlight = refreshLiveCoreDataNow(opts);
  try {
    return await _liveRefreshInFlight;
  } finally {
    _liveRefreshInFlight = null;
  }
}

async function refreshLiveCoreDataNow(opts) {
  opts = opts || {};
  if (opts.showLoading && !(opts.silentIfCached && venues && venues.length)) showVenueLiveLoading('Fetching latest venues from Neon...');
  showSyncStatus(' Loading live data...','var(--blue)');

  // Load venues first and render them immediately. Optional tables must not block venue display.
  let vRows = [], bRows = null, sRows = [];

  try {
    vRows = await neonSQL('SELECT id,name,day,date,time_start,time_end,confirm_status,visibility,status,venue_type,landmark,map_url,image_url FROM venues ORDER BY date ASC, time_start ASC');
  } catch (e) {
    if (!opts._retry) {
      console.warn('[OTS] venues load slow, retrying once:', e && (e.message || e));
      await new Promise(function(res){ setTimeout(res, 900); });
      return refreshLiveCoreDataNow(Object.assign({}, opts, { _retry:true, showLoading:false }));
    }
    console.error('[OTS] CRITICAL: venues load failed after retry:', e && (e.message || e));
    throw e;
  }

  venues = mapVenueRows(vRows);
  console.log('[OTS] Live venues loaded:', venues.length, venues.slice(0, 5));
  syncCalendarToVenueDates(false);
  renderCalendar();
  renderVenueList();
  if (otsIsAdminApp()) renderVenueManager();
  updateHeroStats();
  if (otsIsAdminApp()) updateAdminStats();
  showSyncStatus(' Live venues updated','var(--green)');

  var bookingsQuery = liveCoreBookingsQuery();
  const optionalResults = await Promise.allSettled([
    neonSQL(bookingsQuery.sql, bookingsQuery.params),
    neonSQL('SELECT key,value FROM settings')
  ]);
  if (optionalResults[0].status === 'fulfilled') {
    bRows = optionalResults[0].value || [];
  } else {
    console.warn('[OTS] bookings optional load skipped:', optionalResults[0].reason && (optionalResults[0].reason.message || optionalResults[0].reason));
    bRows = null;
  }
  if (optionalResults[1].status === 'fulfilled') {
    sRows = optionalResults[1].value || [];
  } else {
    console.warn('[OTS] settings optional load skipped:', optionalResults[1].reason && (optionalResults[1].reason.message || optionalResults[1].reason));
    sRows = [];
  }

  if (bRows !== null) {
    allBookings = mapBookingRows(bRows);
  }

  if (memberLoggedIn) {
    Promise.allSettled([loadDismissedRemote(), loadDismissedNotifsRemote()]).then(function(){
      renderUserBookings();
      updateNotifBadge();
    });
  }

  applySettingsRows(sRows || []);
  let statusChanged = false;
  myBookings = loadMyBookings().map(function(mb) {
    const live = allBookings.find(function(ab){ return ab.id === mb.id; });
    if (live && live.status !== mb.status) {
      setTimeout(function(){ showApprovalNotif(live.status === 'confirmed' ? 'approved' : 'rejected', mb.venue, mb.id); }, 900);
      statusChanged = true;
      return Object.assign({}, mb, { status: live.status });
    }
    return mb;
  });
  if (statusChanged) { saveMyBookings(); updateNotifBadge(); }
  renderAfterLoad();
  showSyncStatus(' Live data updated','var(--green)');
  _lastLiveRefreshAt = Date.now();
  return { venues: venues, bookings: allBookings };
}
async function loadGalleryLiveInBackground() {
  try {
    const gRows = await neonSQL("SELECT id,url,caption FROM gallery WHERE id IS NULL OR id NOT LIKE 'perf_%' LIMIT 100");
    galleryPhotos = (gRows || []).filter(function(g){ return !g.id || !String(g.id).startsWith('perf_'); }).map(function(g){ return { id:g.id, url:g.url, caption:g.caption||'' }; });
    renderGigCalendar();
  } catch(e) {
    console.warn('[OTS] Gallery live load skipped:', e && (e.message || e));
  }
}

// -- Load from Neon live only (no venue cache) --
async function loadData() {
  // LIVE ONLY: do not restore venue data from localStorage.
  // This prevents deleted/old venues from appearing after refresh or login.
  showVenueLiveLoading('Fetching latest venues from Neon...');
  showSyncStatus(' Loading live data...','var(--blue)');
  myBookings = loadMyBookings();
  renderUserBookings();
  try {
    await refreshLiveCoreData({ showLoading:false });
    restoreMyBookingsFromServer();
    loadGalleryLiveInBackground(); // photos can be heavy, so do not block venues
  } catch(e) {
    const errMsg = e && (e.message || e.toString()) || 'unknown error';
    console.warn('[OTS] Neon live load failed:', errMsg);
    venues = []; allBookings = []; galleryPhotos = [];
    renderAfterLoad();
    showSyncStatus(' Live DB load failed','var(--red)');
    var list = document.getElementById('venueList');
    var title = document.getElementById('venueListTitle');
    if (title) title.textContent = 'Unable to Load Venues';
    if (list) list.innerHTML = '<div class="no-venues-day"><span class="nv-icon"></span>Could not reach the live venues database. Please refresh or try again in a moment.</div>';
  }
  startGigPoll();
}
// -- Delete helpers called by UI --
async function dbDeleteVenue(id) {
  try { await sbDelete('venues', id); } catch(e) { console.error(e); }
}
async function dbDeleteBooking(id) {
  try { await sbDelete('bookings', id); } catch(e) { console.error(e); }
}
async function dbDeleteGallery(id) {
  try { await sbDelete('gallery', id); } catch(e) { console.error(e); }
}

// =======================================
// GIG CALENDAR
// =======================================
function renderGigCalendar() {
  const list = document.getElementById('gigCalendarList');
  if (!list) return;
  const now = new Date();
  const confirmed = allBookings
    .filter(b => b.status === 'confirmed' && !isBookingShowOver(b, now))
    .sort((a,b) => bookingStartTimeMs(a) - bookingStartTimeMs(b));
  if (!confirmed.length) {
    list.innerHTML = '<div class="gc-empty">No confirmed shows yet - check back soon!</div>';
    return;
  }
  const byDate = {};
  confirmed.forEach(b => {
    const key = normalizeVenueDate(b.date);
    if (!key) return;
    if (!byDate[key]) byDate[key]=[];
    byDate[key].push(b);
  });
  const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  list.innerHTML = Object.keys(byDate).sort().map(iso => {
    const [yr,mo,dy] = iso.split('-').map(Number);
    const dt = new Date(yr,mo-1,dy);
    const dayName = DAYS[dt.getDay()];
    const monthName = MONTHS[mo-1];
    const cards = byDate[iso].sort((a,b) => bookingStartTimeMs(a) - bookingStartTimeMs(b)).map(b => {
      const v = venues.find(x => x.id === b.venueId);
      const timeStr = v ? ` ${formatVenueTimeRange(v)}` : '';
      const venueDisplayName = getLiveVenueName(b) || '-';
      return `<div class="gc-item">
        <button type="button" class="gc-venue-name gc-venue-map" onclick="openVenueInMapsForBooking('${otsJsString(b.id)}')" title="Open location in Google Maps">&#128205; ${otsEscapeHtml(venueDisplayName)}</button>
        <div class="gc-band-name">${b.name || '-'}</div>
        <div class="gc-meta-row">
          ${timeStr ? `<span class="gc-time-tag">&#128337;${timeStr}</span>` : ''}
          ${b.type ? `<span class="gc-type-tag">${b.type}</span>` : ''}
          <span class="gc-confirmed-badge">&#10003; Confirmed</span>
        </div>
      </div>`;
    }).join('');
    return `<div class="gc-date-group">
      <div class="gc-date-col">
        <span class="gc-day-num">${String(dy).padStart(2,'0')}</span>
        <span class="gc-day-name">${dayName}</span>
        <span class="gc-month-yr">${monthName} ${yr}</span>
      </div>
      <div class="gc-shows">${cards}</div>
    </div>`;
  }).join('');
}

function renderAfterLoad() {
  syncCalendarToVenueDates(false);
  renderCalendar();
  renderVenueList();
  updateHeroStats();
  renderUserBookings();
  renderGigCalendar();
  // Restore form venue badge if user was on the form page
  if (selectedVenueId) {
    const v = venues.find(x => x.id === selectedVenueId);
    if (v && isVenueBeforeToday(v)) {
      selectedVenueId = null;
      try { localStorage.removeItem('ots_selected_venue'); } catch(e){}
      updateSummary();
      validateForm();
    } else if (v) {
      const badge = document.getElementById('form-venue-badge');
      if (badge) badge.textContent = ` ${v.name} - ${v.day||''} ${formatDateShort(v.date)} - ${formatVenueTimeRange(v)}`;
      updateSummary();
      validateForm();
    }
  }
  initStatusSnapshot();
  if (myBookings.some(b => b.status === 'pending')) startStatusPolling();
  startVenueTimeRefresh();
}

let _venueTimeRefreshTimer = null;
function startVenueTimeRefresh() {
  if (_venueTimeRefreshTimer) return;
  _venueTimeRefreshTimer = setInterval(function() {
    try {
      renderCalendar();
      renderVenueList();
      renderGigCalendar();
      renderUserBookings();
      validateForm();
    } catch(e) {
      console.warn('[OTS] venue time refresh failed:', e);
    }
  }, 60000);
}

// =======================================
// PAGE NAVIGATION
// =======================================
function showPage(page) {
  if (page === 'admin' && otsIsMemberApp()) {
    openAdminEntry('#admin');
    return;
  }
  if (page !== 'admin' && otsIsAdminApp()) {
    page = 'admin';
  }
  if (window._otsHandlePageHistory !== false && window.history && window.history.pushState) {
    try {
      var currentStatePage = history.state && history.state.otsPage;
      if (currentStatePage !== page) {
        history.pushState({ otsPage: page }, '', '#'+page);
      }
    } catch(e) {}
  }
  // Persist current page so refresh restores it (never persist admin page)
  if (page !== 'admin') {
    try { localStorage.setItem('ots_current_page', page); } catch(e){}
  }
  // If navigating away from admin to a public page, keep adminLoggedIn in memory
  // and save session so it can be restored on reload
  if (adminLoggedIn && page !== 'admin') { _saveAdminSession(); }
  // hide all public pages + admin + leaderboard + profile
  ['home','venues','form','admin','myrequests','leaderboard','profile','chat'].forEach(p => {
    const el = document.getElementById('page-'+p);
    if (el) el.classList.remove('active');
  });
  var _pg = document.getElementById('page-'+page); if (_pg) _pg.classList.add('active');
  // nav tab highlight
  ['home','venues','form'].forEach(p => {
    const btn = document.getElementById('ntab-'+p);
    if (btn) { btn.classList.toggle('active', p===page); btn.style.display = p==='home' ? '' : 'none'; }
  });
  // venues tab removed from nav - no show logic needed
  if (page === 'form') {
    const ft = document.getElementById('ntab-form'); if (ft) { ft.style.display=''; ft.classList.add('active'); }
  }
  if (page === 'myrequests') {
    // Render from cache immediately, then fetch live; keep polling every 15s for cross-device sync
    renderUserBookings();
    fetchMyBookingsLive();
    startMyRequestsPoll();
    loadMemberStats().catch(function(){});
  } else {
    // Stop the live poll whenever we leave My Requests
    stopMyRequestsPoll();
  }
  if (page === 'venues') {
    // Mobile first: switch pages immediately, then refresh live data after the tap has painted.
    syncCalendarToVenueDates(false);
    renderCalendar();
    renderVenueList();
    var hadVenuesBeforeRefresh = !!(venues && venues.length);
    setTimeout(function(){
      refreshLiveCoreData({
        showLoading: !hadVenuesBeforeRefresh,
        silentIfCached: true,
        maxAgeMs: otsUseInstantMobileScroll() ? 20000 : 8000
      }).catch(function(e){
        console.warn('[OTS] Venue live refresh failed:', e && (e.message || e));
        var list = document.getElementById('venueList');
        var title = document.getElementById('venueListTitle');
        if (!hadVenuesBeforeRefresh) {
          if (title) title.textContent = 'Unable to Load Venues';
          if (list) list.innerHTML = '<div class="no-venues-day"><span class="nv-icon"></span>Could not load latest venues from Neon. Please refresh.</div>';
        }
      });
    }, otsUseInstantMobileScroll() ? 220 : 0);
  }
  if (page === 'home')   { document.getElementById('ntab-home').classList.add('active'); }
  if (page === 'leaderboard') { loadLeaderboard(); }
  if (page === 'profile') { showProfilePage(); }
  if (page === 'chat') { showChatPage(); } else { stopChatPolling(); }
  // -- Sync mobile bottom nav --
  ['home','venues','form','myrequests','chat','leaderboard'].forEach(function(p) {
    var btn = document.getElementById('mn-' + (p==='form'?'book':p==='myrequests'?'requests':p==='leaderboard'?'leaderboard':p));
    if (btn) btn.classList.toggle('active', p === page);
  });
  // Show Book tab once a venue is picked
  var mnBook = document.getElementById('mn-book');
  if (mnBook) mnBook.style.display = (selectedVenueId || page === 'form') ? '' : 'none';
  var mnChat = document.getElementById('mn-chat');
  if (mnChat) mnChat.style.display = memberLoggedIn ? '' : 'none';
  if (page === 'admin') {
    updateAdminNotifCount();
    clearInterval(_adminNotifTimer);
    _adminNotifTimer = setInterval(function(){ if (!document.hidden) updateAdminNotifCount(); }, 15000);
  } else {
    clearInterval(_adminNotifTimer);
    _adminNotifTimer = null;
  }
  try {
    window.scrollTo({ top:0, left:0, behavior:'auto' });
  } catch(e) {
    window.scrollTo(0,0);
  }
  setTimeout(function(){
    var activePage = document.getElementById('page-'+page);
    if (activePage) {
      activePage.scrollTop = 0;
      activePage.style.webkitOverflowScrolling = 'touch';
    }
  }, 0);
}

window.addEventListener('popstate', function(ev) {
  var page = ev.state && ev.state.otsPage;
  if (!page) page = 'home';
  if (!document.getElementById('page-' + page)) page = 'home';
  window._otsHandlePageHistory = false;
  showPage(page);
  window._otsHandlePageHistory = true;
});

// =======================================
// CALENDAR
// =======================================
let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-based
let selectedCalDate = null;
let _calendarUserChosenMonth = false;
let _lastVenueDateSignature = '';

function getVenueDates() {
  // User calendar shows only open slots whose show end time has not passed.
  // Admin can still see older slots in the venue manager.
  return new Set(venues.filter(v=>isVenueUpcomingForUsers(v)).map(v=>normalizeVenueDate(v.date)));
}
function getBookedVenueDates() {
  return new Set((allBookings || [])
    .filter(function(b){ return b && b.status === 'confirmed' && normalizeVenueDate(b.date); })
    .map(function(b){ return normalizeVenueDate(b.date); }));
}
function isSlotBlockingBooking(b) {
  return ['pending','confirmed','approved','completed'].indexOf(normalizeStatus(b && b.status, '')) > -1;
}
function isBookingForVenueSlot(b, v) {
  if (!b || !v) return false;
  if (b.venueId && v.id && String(b.venueId) === String(v.id)) return true;
  var bookingDate = normalizeVenueDate(b.date);
  var venueDate = normalizeVenueDate(v.date);
  if (!bookingDate || !venueDate || bookingDate !== venueDate) return false;
  return normalizeVenueNameForDuplicate(b.venue) === normalizeVenueNameForDuplicate(v.name);
}
function getVenueSlotBlockingBooking(v, statusName) {
  return (allBookings || []).find(function(b) {
    if (!isSlotBlockingBooking(b) || !isBookingForVenueSlot(b, v)) return false;
    return statusName ? normalizeStatus(b.status, '') === statusName : true;
  }) || null;
}
function showVenueSlotBlockedNotice(v, bookingLike) {
  var status = normalizeStatus(bookingLike && bookingLike.status, '');
  if (status === 'pending') {
    showToast('', 'Slot Pending', (v && v.name ? v.name + ' ' : '') + 'is already pending admin approval.');
  } else {
    showToast('', 'Slot Booked', (v && v.name ? v.name + ' ' : '') + 'is already booked.');
  }
}
async function fetchLiveVenueSlotBlockingBooking(v) {
  if (!v) return null;
  var venueDate = normalizeVenueDate(v.date);
  var rows = await neonSQL(
    "SELECT id,status FROM bookings WHERE LOWER(COALESCE(status,'')) IN ('pending','confirmed','approved','completed') AND (venue_id=$1 OR (LEFT(date::TEXT,10)=$2 AND LOWER(TRIM(venue))=LOWER(TRIM($3)))) ORDER BY created_at DESC LIMIT 1",
    [String(v.id || ''), venueDate, String(v.name || '')]
  );
  return rows && rows[0] ? rows[0] : null;
}
function getOpenVenueDatesSorted() {
  return Array.from(getVenueDates()).sort();
}
function todayIsoLocal() {
  var d = new Date();
  d.setHours(0,0,0,0);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function currentMonthStartIso() {
  var d = new Date();
  d.setDate(1);
  d.setHours(0,0,0,0);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-01';
}
function isBeforeCurrentMonthIso(iso) {
  iso = normalizeVenueDate(iso);
  return !!iso && iso < currentMonthStartIso();
}
function isBeforeTodayIso(iso) {
  iso = normalizeVenueDate(iso);
  return !!iso && iso < todayIsoLocal();
}
function isVenueBeforeCurrentMonth(v) {
  return isBeforeCurrentMonthIso(v && v.date);
}
function isVenueBeforeToday(v) {
  return isVenueOver(v);
}
function syncCalendarToVenueDates(force) {
  var dates = getOpenVenueDatesSorted();
  if (!dates.length) {
    var now = new Date();
    if (force || !_calendarUserChosenMonth) {
      calYear = now.getFullYear();
      calMonth = now.getMonth();
    }
    return false;
  }

  var signature = dates.join('|');
  var dataChanged = signature !== _lastVenueDateSignature;
  _lastVenueDateSignature = signature;
  if (_calendarUserChosenMonth && !force && !dataChanged) return false;

  var today = todayIsoLocal();
  var monthStart = currentMonthStartIso();
  var currentOrFutureDates = dates.filter(function(iso) { return iso >= monthStart; });
  var target = currentOrFutureDates.find(function(iso) { return iso >= today; })
    || currentOrFutureDates[0]
    || monthStart;
  var parts = target.split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1]) return false;
  var targetYear = parts[0];
  var targetMonth = parts[1] - 1;
  if (calYear === targetYear && calMonth === targetMonth) return false;
  calYear = targetYear;
  calMonth = targetMonth;
  selectedCalDate = null;
  return true;
}
function sortVenueDatesForCurrentCalendar(dates) {
  var monthStart = calYear + '-' + String(calMonth + 1).padStart(2, '0') + '-01';
  var anchor = monthStart === currentMonthStartIso() ? todayIsoLocal() : monthStart;
  var currentAndLater = dates.filter(function(iso) { return iso >= anchor; });
  var earlierInSelectedMonth = dates.filter(function(iso) { return iso >= monthStart && iso < anchor; });
  var earlier = dates.filter(function(iso) { return iso < monthStart; });
  return currentAndLater.concat(earlierInSelectedMonth).concat(earlier);
}
function otsUseInstantMobileScroll() {
  return !!(window.matchMedia && window.matchMedia('(max-width: 700px), (pointer: coarse)').matches);
}
function otsScrollBehavior() {
  return otsUseInstantMobileScroll() ? 'auto' : 'smooth';
}
function calPrev() {
  _calendarUserChosenMonth = true;
  calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; }
  selectedCalDate = null; // clear filter so venue list shows all upcoming
  renderCalendar();
  renderVenueList();
  scrollVenueListToMonth();
}
function calNext() {
  _calendarUserChosenMonth = true;
  calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; }
  selectedCalDate = null; // clear filter so venue list shows all upcoming
  renderCalendar();
  renderVenueList();
  scrollVenueListToMonth();
}
function renderCalendar() {
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('calMonthLabel').textContent = `${MONTHS[calMonth]} ${calYear}`;
  const grid = document.getElementById('calGrid');
  const today = new Date(); today.setHours(0,0,0,0);
  const venueDates = getVenueDates();
  // first day of month, pad with prev month days
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
  const daysInPrev  = new Date(calYear, calMonth, 0).getDate();
  let cells = '';
  // prev month padding
  for (let i = firstDay-1; i >= 0; i--) {
    cells += `<div class="cal-day other-month"><span class="cal-day-num">${daysInPrev-i}</span></div>`;
  }
  // current month
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dt  = new Date(calYear, calMonth, d); dt.setHours(0,0,0,0);
    const isToday    = dt.getTime() === today.getTime();
    const hasVenues  = venueDates.has(iso);
    const isSelected = selectedCalDate === iso;
    const isPastMonth = isBeforeCurrentMonthIso(iso) || isBeforeTodayIso(iso);
    const cls = [
      'cal-day',
      isToday ? 'today' : '',
      hasVenues ? 'has-venues' : '',
      isSelected ? 'selected' : '',
      isPastMonth ? 'past-month' : '',
    ].filter(Boolean).join(' ');
    cells += `<div class="${cls}" onclick="selectCalDate('${iso}')" style="cursor:pointer;">
      <span class="cal-day-num">${d}</span>
      ${hasVenues ? '<span class="cal-dot"></span>' : ''}
    </div>`;
  }
  // next month padding to fill grid
  const totalCells = firstDay + daysInMonth;
  const remainder  = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let i = 1; i <= remainder; i++) {
    cells += `<div class="cal-day other-month"><span class="cal-day-num">${i}</span></div>`;
  }
  grid.innerHTML = cells;
}
function selectCalDate(iso) {
  _calendarUserChosenMonth = true;
  selectedCalDate = iso;
  renderCalendar();
  renderVenueList();
  // Scroll the tapped date's group into view (works whether panel or page is scrolling)
  setTimeout(function() {
    var section = document.getElementById('vds-' + iso);
    if (!section) return;
    var panel = document.getElementById('venueListPanel');
    // Prefer scrolling within the panel if it has internal overflow
    if (panel && panel.scrollHeight > panel.clientHeight) {
      var panelRect   = panel.getBoundingClientRect();
      var sectionRect = section.getBoundingClientRect();
      panel.scrollTo({ top: panel.scrollTop + (sectionRect.top - panelRect.top) - 8, behavior: otsScrollBehavior() });
    } else {
      // Fallback: scroll the page so the section is visible
      section.scrollIntoView({ behavior: otsScrollBehavior(), block: 'start' });
    }
  }, 50);
}

function scrollVenueListToMonth() {
  setTimeout(function() {
    var monthPrefix = calYear + '-' + String(calMonth + 1).padStart(2, '0') + '-';
    var targetIso = Object.keys(venues.reduce(function(map, v) {
      var vd = isVenueUpcomingForUsers(v) ? normalizeVenueDate(v.date) : '';
      if (vd) map[vd] = true;
      return map;
    }, {})).sort().find(function(iso) { return iso.indexOf(monthPrefix) === 0; });

    var panel = document.getElementById('venueListPanel');
    var list = document.getElementById('venueList');
    var section = targetIso ? document.getElementById('vds-' + targetIso) : list;
    if (!section) return;

    if (panel && panel.scrollHeight > panel.clientHeight) {
      var panelRect = panel.getBoundingClientRect();
      var sectionRect = section.getBoundingClientRect();
      panel.scrollTo({ top: panel.scrollTop + (sectionRect.top - panelRect.top) - 8, behavior: otsScrollBehavior() });
    } else {
      section.scrollIntoView({ behavior: otsScrollBehavior(), block: 'start' });
    }
  }, 80);
}

// =======================================
// VENUE LIST (Page 2)
// =======================================
function renderVenueList() {
    const list  = document.getElementById('venueList');
    const title = document.getElementById('venueListTitle');

    // Group open, still-upcoming venues by date. Once a slot's show end time
    // passes, it leaves the user-facing venue page but stays in admin records.
    const dateMap = {};
    venues.filter(v => isVenueUpcomingForUsers(v)).forEach(v => {
      var vd = normalizeVenueDate(v.date);
      v.date = vd;
      if (!dateMap[vd]) dateMap[vd] = [];
      dateMap[vd].push(v);
    });

    const sortedDates = sortVenueDatesForCurrentCalendar(Object.keys(dateMap).sort());

    if (!sortedDates.length) {
      title.textContent = 'No Upcoming Venues';
      list.innerHTML = '<div class="no-venues-day"><span class="nv-icon"></span>No venues scheduled yet. Check back soon.</div>';
      return;
    }

    title.textContent = 'Upcoming Venues';

    const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    list.innerHTML = sortedDates.map(iso => {
      const dayVenues = dateMap[iso];
      const isSelected = iso === selectedCalDate;
      const isPastMonthGroup = isBeforeCurrentMonthIso(iso) || isBeforeTodayIso(iso);
      const [yr, mo, dy] = iso.split('-').map(Number);
      const dt = new Date(yr, mo - 1, dy);
      const dayName   = DAYS[dt.getDay()];
      const monthName = MONTHS[mo - 1];

      const venueCards = dayVenues.map(v => {
        const pendingBooking = getVenueSlotBlockingBooking(v, 'pending');
        const confirmedBooking = getVenueSlotBlockingBooking(v, 'confirmed') || getVenueSlotBlockingBooking(v, 'approved') || getVenueSlotBlockingBooking(v, 'completed');
        const hasPending   = !!pendingBooking;
        const hasConfirmed = !!confirmedBooking;
        const isPastMonthVenue = isPastMonthGroup || isVenueBeforeToday(v);
        const blocked    = isPastMonthVenue || hasPending || hasConfirmed;
        const cardClass  = [
          hasConfirmed ? 'booked' : hasPending ? 'blocked' : '',
          isPastMonthVenue ? 'past-month' : ''
        ].filter(Boolean).join(' ');
        const landmarkHtml = v.landmark ? `<div class="vrc-meta" style="color:var(--blue);"> ${otsEscapeHtml(v.landmark)}</div>` : '';
        const venueTypeBadge = venueTypeBadgeHtml(v);
        const pendingBadge = hasPending ? '<span class="vrc-badge vrc-pending">Pending</span>' : '';
        const bookedBadge = hasConfirmed ? '<span class="vrc-badge vrc-booked">Booked</span>' : '';
        const statusBadge = (bookedBadge || pendingBadge || venueTypeBadge) ? `<div class="vrc-badges">${bookedBadge}${pendingBadge}${venueTypeBadge}</div>` : '';
        const actionBtn = isPastMonthVenue
          ? `<span style="font-size:.72rem;color:var(--muted);font-style:italic;">Booking closed</span>`
          : hasConfirmed
          ? `<span style="font-size:.72rem;color:var(--muted);font-style:italic;">Slot booked</span>`
          : !hasPending
            ? `<button class="vrc-select-btn" onclick="event.stopPropagation();pickVenue('${v.id}')">${memberLoggedIn ? 'Select ' : ' Login'}</button>`
            : `<span style="font-size:.72rem;color:var(--orange);">Slot pending</span>`;
        return `
        <div class="venue-row-card ${cardClass}" ${!blocked ? `onclick="pickVenue('${v.id}')"` : ''}>
          ${v.imageUrl ? `<img src="${v.imageUrl}" class="vrc-img" alt="${v.name}" loading="lazy" decoding="async" onerror="this.style.display='none'">` : ''}
          <div class="vrc-name-wrap">
            <div class="vrc-name">${v.name}</div>
            <div class="vrc-meta"> ${v.day || ''}</div>
            ${landmarkHtml}
            ${statusBadge}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.6rem;">
            <div class="vrc-time"> ${formatVenueTimeRange(v)}</div>
            ${actionBtn}
          </div>
        </div>`;
      }).join('');

      return `<div class="vds-item ${isSelected ? 'vds-selected' : ''} ${isPastMonthGroup ? 'past-month' : ''}" id="vds-${iso}">
        <div class="vds-header" onclick="selectCalDate('${iso}')">
          <div class="vds-date-num">${String(dy).padStart(2,'0')}</div>
          <div class="vds-date-info">
            <div class="vds-date-day">${dayName}</div>
            <div class="vds-date-month">${monthName} ${yr}</div>
          </div>
          <div class="vds-count">${dayVenues.length} venue${dayVenues.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="vds-venues">${venueCards}</div>
      </div>`;
    }).join('');
  }
  
function fillBookingFormFromSession() {
  try {
    const emailInp = document.getElementById('inp-email');
    if (emailInp) emailInp.value = memberEmail || '';

    const phoneInp = document.getElementById('inp-phone');
    if (phoneInp && memberPhone && !phoneInp.value) {
      phoneInp.value = memberPhone;
      validatePhone();
    }

    const bandInp = document.getElementById('inp-band');
    if (bandInp && !bandInp.value && memberName) {
      bandInp.value = memberName.trim();
    }

    const bookerInp = document.getElementById('inp-booker');
    if (bookerInp && !bookerInp.value) {
      bookerInp.value = (memberName || memberEmail || memberPhone || '').trim();
    }

    validateForm();
    updateSummary();
  } catch(e) {}
}

function pickVenue(id) {
  const v = venues.find(x=>x.id===id);
  if (!v) {
    showToast('', 'Venue Not Found', 'Please refresh and try again.');
    return;
  }
  if (isVenueBeforeToday(v)) {
    showToast('', 'Booking Closed', 'This venue date is over and is shown only for reference.');
    selectedVenueId = null;
    try { localStorage.removeItem('ots_selected_venue'); } catch(e){}
    renderVenueList();
    updateSummary();
    validateForm();
    return;
  }
  var blockingBooking = getVenueSlotBlockingBooking(v);
  if (blockingBooking) {
    showVenueSlotBlockedNotice(v, blockingBooking);
    selectedVenueId = null;
    try { localStorage.removeItem('ots_selected_venue'); } catch(e){}
    renderVenueList();
    updateSummary();
    validateForm();
    return;
  }
  // Members-only gate
  if (!memberLoggedIn) {
    showMemberLogin(id);
    return;
  }
  selectedVenueId = id;
  try { localStorage.setItem('ots_selected_venue', id); } catch(e){}
  updateSummary();
  validateForm();
  fillBookingFormFromSession();
  // update form badge
  document.getElementById('form-venue-badge').textContent =
    ` ${v.name} - ${v.day||''} ${formatDateShort(v.date)} - ${formatVenueTimeRange(v)}`;
  showPage('form');
}

// =======================================
// INIT
// =======================================
// =======================================
// ADMIN SESSION PERSISTENCE
// =======================================
function _saveAdminSession() {
  currentAdminRole = normalizeAdminRole(currentAdminRole);
  var data = JSON.stringify({ exp: Date.now() + 365*24*60*60*1000, v: 3, u: currentAdminUsername, r: currentAdminRole, p: currentAdminPermissions || {} });
  try { localStorage.setItem('ots_admin_session', data); } catch(e){}
  try { sessionStorage.setItem('ots_admin_session', data); } catch(e){}
  try { document.documentElement.setAttribute('data-admin-active', '1'); } catch(e){}
  try {
    var exp = new Date(Date.now() + 365*24*60*60*1000).toUTCString();
    document.cookie = 'ots_admin_s=1; expires=' + exp + '; path=/; SameSite=Lax';
  } catch(e){}
  // window.name survives iframe storage blocks (Replit preview)
  try { var wn={}; try{wn=JSON.parse(window.name||'{}')}catch(_){} wn['ots.ots_admin_s']=data; window.name=JSON.stringify(wn); } catch(e){}
}

function _clearAdminSession() {
  try { localStorage.removeItem('ots_admin_session'); } catch(e){}
  try { sessionStorage.removeItem('ots_admin_session'); } catch(e){}
  try { document.cookie = 'ots_admin_s=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'; } catch(e){}
  try { var wn3={}; try{wn3=JSON.parse(window.name||'{}')}catch(_){} delete wn3['ots.ots_admin_s']; window.name=JSON.stringify(wn3); } catch(e){}
  document.documentElement.removeAttribute('data-admin-active');
}
function _hasAdminSession() {
  if (_getAdminSessionData()) return true;
  // Cookie alone cannot safely restore role/access. Keep it only as a page-ready hint.
  try {
    if (document.cookie.split(';').some(function(c){ return c.trim().startsWith('ots_admin_s=1'); })) return false;
  } catch(e){}
  return false;
}
function _getAdminSessionData() {
  try { var ls=JSON.parse(localStorage.getItem('ots_admin_session')||'null'); if(ls&&(ls.u||ls.r||ls.v)) return ls; } catch(e){}
  try { var ss=JSON.parse(sessionStorage.getItem('ots_admin_session')||'null'); if(ss&&(ss.u||ss.r||ss.v)) return ss; } catch(e){}
  try { var wn2={}; try{wn2=JSON.parse(window.name||'{}')}catch(_){} if(wn2['ots.ots_admin_s']){var d4=JSON.parse(wn2['ots.ots_admin_s']);if(d4&&(d4.u||d4.r||d4.v))return d4;} } catch(e){}
  return null;
}
function restoreAdminSession() {
  try {
    var sd = _getAdminSessionData();
    if (sd) {
      adminLoggedIn = true;
      currentAdminUsername = sd.u || currentAdminUsername || getAdminUser();
      currentAdminRole = normalizeAdminRole(sd.r || currentAdminRole || 'admin');
      currentAdminPermissions = parseAdminPermissions(sd.p);
      _saveAdminSession(); // renew all stores
      var logout = document.getElementById('logoutBtn'); if (logout) logout.classList.add('show');
      var _ab = document.getElementById('adminPanelBtn'); if (_ab) _ab.style.display = '';
      _applySuperAdminVisibility();
      // Silently pre-load claims so the badge count shows immediately
      setTimeout(function() { loadAdminClaims().catch(function(){}); }, 1500);
    } else {
      _clearAdminSession();
    }
  } catch(e) { console.warn('Admin session restore error:', e); }
}

// -- Admin real-time polling + browser notifications --
var _adminPollTimer  = null;
var _knownBookingIds = null;
var _pollTickCount   = 0; // null = first run, don't notify yet

var _swReg = null;

function registerOtsServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (window.location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js')
    .then(function(reg) {
      _swReg = reg;
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      return navigator.serviceWorker.ready;
    })
    .then(function(reg) {
      _swReg = reg;
      refreshInstallHelpState();
    })
    .catch(function(err) {
      console.warn('[OTS] service worker registration failed:', err);
    });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', registerOtsServiceWorker);
} else {
  registerOtsServiceWorker();
}

// Show/hide the notification setup banner based on current permission state
function _updateNotifBanner() {
  var bar    = document.getElementById('notif-setup-bar');
  var iosBar = document.getElementById('notif-ios-bar');
  if (bar) bar.style.display = 'none';
  if (iosBar) iosBar.style.display = 'none';
  return;
  if (!bar || !iosBar) return;
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  var isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (!('Notification' in window)) {
    // Notifications not supported - show iOS hint if on iPhone/iPad
    bar.style.display = 'none';
    iosBar.style.display = (isIOS && !isStandalone) ? '' : 'none';
    return;
  }
  var perm = Notification.permission;
  if (perm === 'granted') {
    bar.style.display = 'none';
    iosBar.style.display = 'none';
  } else if (perm === 'denied') {
    bar.style.display = '';
    bar.querySelector('#notif-enable-btn').textContent = 'Blocked - Enable in Browser Settings';
    bar.querySelector('#notif-enable-btn').style.background = 'rgba(255,255,255,.1)';
    iosBar.style.display = 'none';
  } else {
    // 'default' - not yet asked
    if (isIOS && !isStandalone) {
      bar.style.display = 'none';
      iosBar.style.display = '';
    } else {
      bar.style.display = '';
      iosBar.style.display = 'none';
    }
  }
}

// Called when admin taps "Enable Notifications" - must be from direct user tap
function _enableNotifications() {
  if (!('Notification' in window)) return;
  Notification.requestPermission().then(function(p) {
    if (p === 'granted') {
      showToast('', 'Notifications On', 'You will now get alerts for new bookings!');
      // Test notification so they know it works
      if (_swReg && _swReg.active) {
        _swReg.active.postMessage({ type: 'SHOW_NOTIF', payload: { title: ' Notifications Active', body: 'You will be alerted for every new booking request.', tag: 'ots-test' }});
      }
    } else {
      showToast('', 'Blocked', 'Notifications were blocked. Please allow them in browser settings.');
    }
    _updateNotifBanner();
  });
}

// Request notification permission when admin logs in, then set up SW
function requestAdminNotifPermission() {
  // Do NOT auto-request on mobile - mobile needs a real tap; just show the banner
  _updateNotifBanner();
  // Also check if we can prompt PWA install
  _showPwaInstallBanner();
}

// Show a soft banner prompting admin to install as app (for background notifications)
var _deferredInstall = null;
window.addEventListener('beforeinstallprompt', function(e) {
  e.preventDefault();
  _deferredInstall = e;
  refreshInstallHelpState();
  if (adminLoggedIn) _showPwaInstallBanner();
});

function _showPwaInstallBanner() {
  if (!_deferredInstall) return;
  if (document.getElementById('pwa-install-banner')) return;
  var bar = document.createElement('div');
  bar.id = 'pwa-install-banner';
  bar.style.cssText = 'position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);background:linear-gradient(90deg,#f0771e,#9e76cc);color:#fff;padding:.6rem 1.2rem;border-radius:8px;font-size:.78rem;z-index:9999;display:flex;align-items:center;gap:.8rem;box-shadow:0 4px 20px rgba(0,0,0,.4);white-space:nowrap;';
  bar.innerHTML = '<span> Install app for background notifications</span>' +
    '<button onclick="_doInstallPwa()" style="background:#fff;color:#f0771e;border:none;border-radius:4px;padding:.3rem .7rem;font-weight:700;cursor:pointer;font-size:.78rem;">Install</button>' +
    '<button onclick="this.parentNode.remove()" style="background:transparent;color:rgba(255,255,255,.7);border:none;font-size:1rem;cursor:pointer;padding:0 .2rem;">x</button>';
  document.body.appendChild(bar);
}

function _doInstallPwa() {
  if (!_deferredInstall) {
    openInstallHelp();
    return;
  }
  _deferredInstall.prompt();
  _deferredInstall.userChoice.then(function() {
    _deferredInstall = null;
    var b = document.getElementById('pwa-install-banner');
    if (b) b.remove();
    refreshInstallHelpState();
  });
}

function isPwaStandalone() {
  return window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}

function refreshInstallHelpState() {
  var nativeBtn = document.getElementById('installNativeBtn');
  var note = document.getElementById('installHelpNote');
  if (nativeBtn) nativeBtn.style.display = (_deferredInstall && !isPwaStandalone()) ? '' : 'none';
  if (note) {
    if (isPwaStandalone()) {
      note.textContent = 'OTS is already installed on this device. Open it from the icon for the clean app view.';
    } else if (_deferredInstall) {
      note.textContent = 'This device supports one-tap install. Tap the install button above.';
    } else if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream) {
      note.textContent = 'Important: on iPhone, use Safari Share > Add to Home Screen. Other browsers may not show this option.';
    } else {
      note.textContent = 'After installing, open OTS from the icon and login normally.';
    }
  }
}

function openInstallHelp() {
  var modal = document.getElementById('installHelpModal');
  if (!modal) return;
  refreshInstallHelpState();
  modal.classList.add('show');
}

function closeInstallHelp() {
  var modal = document.getElementById('installHelpModal');
  if (modal) modal.classList.remove('show');
}

function triggerPwaInstall() {
  if (!_deferredInstall) {
    refreshInstallHelpState();
    return;
  }
  _doInstallPwa();
}

// Fire a browser notification for a new booking
function fireBookingNotif(booking) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  var venue = booking.venue || booking.venueId || 'a venue';
  var name  = booking.name  || 'Someone';
  var bookedBy = getBookingPersonName(booking);
  var type  = booking.type  || '';
  var title = ' New Booking Request - ON THE STREETS';
  var body  = name + (bookedBy ? ' booked by ' + bookedBy : '') + (type ? ' (' + type + ')' : '') + ' wants to book ' + venue;
  var tag   = 'ots-booking-' + booking.id;
  // Prefer SW notification (works even when tab is in background on Android)
  if (_swReg && _swReg.active) {
    _swReg.active.postMessage({ type: 'SHOW_NOTIF', payload: { title: title, body: body, tag: tag, data: { url: otsAdminEntry() + '#admin' } } });
  } else {
    // Fallback to basic Notification
    var n = new Notification(title, { body: body, icon: '/favicon.svg', tag: tag, requireInteraction: true });
    n.onclick = function() { window.focus(); if (adminLoggedIn) { showPage('admin'); switchAdminTab('bookings'); } n.close(); };
  }
}

// Check for new pending bookings after each refresh
function checkNewBookingsAndNotify(freshBookings) {
  var pending = freshBookings.filter(function(b){ return b.status === 'pending'; });
  if (_knownBookingIds === null) {
    // First load - seed the known set, don't fire notifications
    _knownBookingIds = new Set(pending.map(function(b){ return b.id; }));
    return;
  }
  pending.forEach(function(b) {
    if (!_knownBookingIds.has(b.id)) {
      _knownBookingIds.add(b.id);
      fireBookingNotif(b);
    }
  });
}

function startAdminPolling() {
  stopAdminPolling();
  requestAdminNotifPermission();
  _knownBookingIds = null; // reset so first poll seeds the set
  // Immediate first refresh so admin sees live data right away (don't wait 6s)
  if (adminLoggedIn) refreshAdmin();
  _adminPollTimer = setInterval(function() {
    if (!adminLoggedIn) return;
    // Lightweight poll - only fetch bookings (not venues/gallery)
    neonSQL('SELECT id, venue, venue_id, date, name, booked_by, type, visibility, status, ' + LIGHT_PROOF_SQL + ', proof_claimed, checkin_at, checkin_lat, checkin_lng, checkin_accuracy, checkin_map_url, performers, created_at FROM bookings ORDER BY created_at DESC LIMIT 100')
      .then(function(rows){ return rows || []; })
      .then(function(rows) {
        var fresh = (rows||[]).map(function(b){ return {
          id: b.id, venueId: b.venue_id||'', venue: b.venue||'',
          date: b.date||'', name: b.name||'', type: b.type||'', status: b.status||'pending',
          bookedBy: b.booked_by||'',
          visibility: normalizeTitleCase(b.visibility, 'Public'),
          proofUrl: b.proof_url||'', proofClaimed: !!b.proof_claimed, checkinAt: b.checkin_at||null,
          checkinLat: b.checkin_lat||null, checkinLng: b.checkin_lng||null,
          checkinAccuracy: b.checkin_accuracy||null, checkinMapUrl: b.checkin_map_url||'',
          performers: parseBookingPerformers(b.performers),
          createdAt: b.created_at||''
        }; });
        // Detect changes before deciding whether to re-render
        var changed = false;
        // New bookings not yet in allBookings
        fresh.forEach(function(f) {
          var existing = allBookings.find(function(b){ return b.id === f.id; });
          if (!existing) {
            // New booking found - do a full refresh immediately to get phone/date/notes
            changed = true;
            _pollTickCount = 5; // force full refresh on next check
          } else if (existing.status !== f.status) {
            existing.status = f.status;
            changed = true;
          } else if (f.bookedBy && existing.bookedBy !== f.bookedBy) {
            existing.bookedBy = f.bookedBy;
            changed = true;
          } else if (JSON.stringify(parseBookingPerformers(existing.performers)) !== JSON.stringify(parseBookingPerformers(f.performers))) {
            existing.performers = f.performers;
            changed = true;
          } else if (existing.visibility !== f.visibility) {
            existing.visibility = f.visibility;
            changed = true;
          }
        });
        // Removed bookings (cancelled from member side).
        // `fresh` is the most-recent 100 bookings; only consider an existing
        // booking removed if its created_at is recent enough that it would
        // still be in that window - otherwise we'd wrongly drop older rows.
        var freshIds = fresh.map(function(f){ return f.id; });
        var oldestFreshTs = fresh.length
          ? Math.min.apply(null, fresh.map(function(f){
              var t = Date.parse(f.createdAt || '') || 0;
              return t || Date.now();
            }))
          : 0;
        if (oldestFreshTs) {
          var beforeLen = allBookings.length;
          allBookings = allBookings.filter(function(b) {
            if (freshIds.includes(b.id)) return true;
            var t = Date.parse(b.createdAt || '') || 0;
            // Older than what `fresh` covers  keep (could be outside the 100-row window)
            if (!t || t < oldestFreshTs) return true;
            // Recent enough that it should be in `fresh` but isn't  it was deleted
            return false;
          });
          if (allBookings.length !== beforeLen) changed = true;
        }
        checkNewBookingsAndNotify(fresh);
        if (changed && currentAdminTab) {
          // Only re-render the current tab UI - no need to re-fetch from Neon
          _refreshAdminUI();
          // Do a full page-aware Neon refresh occasionally; the lightweight
          // booking poll above keeps notifications fresh without pulling every table.
          _pollTickCount = (_pollTickCount || 0) + 1;
          if (_pollTickCount >= 12 && currentAdminTab !== 'photos' && currentAdminTab !== 'members') { _pollTickCount = 0; refreshAdmin(); }
        } else if (!changed) {
          // Nothing changed - still bump the full-refresh counter
          _pollTickCount = (_pollTickCount || 0) + 1;
          if (_pollTickCount >= 12 && currentAdminTab !== 'photos' && currentAdminTab !== 'members') { _pollTickCount = 0; if (currentAdminTab) refreshAdmin(); }
        }
      })
      .catch(function(){});
  }, LIVE_FAST_MS); // fast cross-device sync for Neon
}
function stopAdminPolling() {
  if (_adminPollTimer) { clearInterval(_adminPollTimer); _adminPollTimer = null; }
  _knownBookingIds = null;
}

let _liveKeepWarmTimer = null;
function startLiveKeepWarm() {
  if (_liveKeepWarmTimer) return;
  _liveKeepWarmTimer = setInterval(function(){
    if (document.hidden) return;
    neonSQL('SELECT 1 AS ok').catch(function(){});
  }, 20000);
}
startLiveKeepWarm();

let _lastFocusLiveRefreshAt = 0;
function currentPageName() {
  var active = document.querySelector('.page.active');
  return active && active.id ? active.id.replace(/^page-/, '') : '';
}
function refreshLiveOnFocus() {
  if (document.hidden) return;
  var now = Date.now();
  if (now - _lastFocusLiveRefreshAt < 1500) return;
  _lastFocusLiveRefreshAt = now;
  if (adminLoggedIn) {
    refreshAdmin();
    updateAdminNotifCount();
    return;
  }
  if (memberLoggedIn) {
    fetchMyBookingsLive();
    var page = currentPageName();
    if (page === 'venues' || page === 'home') {
      refreshLiveCoreData({ showLoading:false, silentIfCached:true, maxAgeMs:8000 }).catch(function(){});
    }
  } else {
    refreshLiveCoreData({ showLoading:false, silentIfCached:true, maxAgeMs:8000 }).catch(function(){});
  }
}
document.addEventListener('visibilitychange', function(){
  if (!document.hidden) setTimeout(refreshLiveOnFocus, 80);
});
window.addEventListener('focus', function(){
  setTimeout(refreshLiveOnFocus, 80);
});


// ========================================
// LEADERBOARD
// ========================================

var _lbAllRows = []; // cached for search filter
var _lbZoneRows = [];

function memberRoleLabel(roleType, instrument) {
  var role = String(roleType || '').trim();
  var inst = String(instrument || '').trim();
  var label = '';
  if (role === 'singer') label = 'Singer';
  else if (role === 'instrumentalist') label = 'Instrumentalist';
  else if (role === 'singer_instrumentalist') label = 'Singer / Instrumentalist';
  else if (role === 'volunteer') label = 'Volunteer';
  else label = '';
  if ((role === 'instrumentalist' || role === 'singer_instrumentalist') && inst) return label + ' - ' + inst;
  if (!label && inst) return inst;
  return label;
}

function roleNeedsInstrument(roleType) {
  return roleType === 'instrumentalist' || roleType === 'singer_instrumentalist';
}

function _memberProfileForRow(p) {
  var pNorm = _normPhone((p && p.phone) || '');
  var pName = ((p && p.name) || '').trim().toLowerCase();
  var hit = members.find(function(m){
    var mNorm = _normPhone(m.phone || '');
    var mName = (m.name || '').trim().toLowerCase();
    return (pNorm && mNorm && pNorm === mNorm) || (!!pName && !!mName && pName === mName);
  });
  return hit || {};
}

function _memberZoneForRow(p) {
  var hit = _memberProfileForRow(p);
  return hit ? (hit.zoneCurrent || '') : '';
}

function _buildZoneBattle(rows) {
  var names = parseZoneNames(zoneNames);
  var zones = { 'No Zone': { points:0, members:[], memberCount:0 } };
  names.forEach(function(z){ zones[z] = { points:0, members:[], memberCount:0 }; });
  rows.forEach(function(p){
    var zone = p.zone || p.zone_name || 'No Zone';
    if (!zones[zone]) zones[zone] = { points:0, members:[], memberCount:0 };
    var points = Number(p.total_points != null ? p.total_points : p.shows) || 0;
    zones[zone].points += points;
    if (p.member_count != null) {
      zones[zone].memberCount += Number(p.member_count) || 0;
    } else {
      zones[zone].members.push({ name:p.name || '-', points:points });
      zones[zone].memberCount += 1;
    }
  });
  Object.keys(zones).forEach(function(z){
    zones[z].members.sort(function(a,b){ return b.points - a.points; });
  });

  var order = names.slice();
  return '<div class="zone-battle-wrap">' + order.map(function(zone){
    var z = zones[zone] || { points:0, members:[] };
    var roster = z.members.slice(0,4).map(function(m){
      return '<span class="zone-battle-chip">' + m.name + ' - ' + m.points + ' pt' + (m.points!==1?'s':'') + '</span>';
    }).join('') || '<span style="color:var(--muted);">Monthly total</span>';
    return '<div class="zone-battle-card">' +
      '<div class="zone-battle-title">' + zone + '</div>' +
      '<div class="zone-battle-points">' + z.points + '</div>' +
      '<div class="zone-battle-meta">This month - ' + z.memberCount + ' member' + (z.memberCount!==1?'s':'') + '</div>' +
      '<div class="zone-battle-roster">' + roster + '</div>' +
    '</div>';
  }).join('') + '</div>';
}

async function loadLeaderboard() {
  const el = document.getElementById('leaderboardContent');
  if (!el) return;
  var monthRange = monthRangeFromKey(monthKeyFromDate());
  var cacheKey = 'ots_leaderboard_cache_' + monthRange.key;

  try {
    var cached = JSON.parse(localStorage.getItem(cacheKey) || '[]');
    if (Array.isArray(cached) && cached.length) {
      _lbAllRows = cached;
      renderLeaderboard(cached);
    } else {
      el.innerHTML = '<div class="lb-empty">Loading rankings...</div>';
    }
  } catch(_) {
    el.innerHTML = '<div class="lb-empty">Loading rankings...</div>';
  }

  try {
    if (!members.length) { try { await loadMembers(); } catch(_){} }
    const rows = await neonSQL(
      "SELECT COALESCE(NULLIF(MAX(c.member_name),''), MAX(c.member_phone), c.phone_key) AS name, " +
      "MAX(c.member_phone) AS phone, c.phone_key, SUM(COALESCE(c.points,1)) AS shows, " +
      "COUNT(*) FILTER (WHERE COALESCE(c.claim_type,'show') IN ('show','special_show')) AS show_count " +
      "FROM (SELECT RIGHT(REGEXP_REPLACE(member_phone,'[^0-9]','','g'),10) AS phone_key, member_name, member_phone, points, claim_type FROM claims WHERE status='approved' AND created_at >= $1 AND created_at < $2) c " +
      "WHERE c.phone_key <> '' GROUP BY c.phone_key " +
      "ORDER BY shows DESC, show_count DESC, LOWER(COALESCE(NULLIF(MAX(c.member_name),''), MAX(c.member_phone), c.phone_key)) ASC, c.phone_key ASC LIMIT 2000",
      [monthRange.start, monthRange.end]
    );
    var zoneRows = await neonSQL(
      "SELECT COALESCE(NULLIF(c.zone_name,''),NULLIF(m.zone_current,''),'No Zone') AS zone_name, SUM(COALESCE(c.points,1)) AS total_points, COUNT(DISTINCT c.member_phone) AS member_count " +
      "FROM claims c LEFT JOIN members m ON RIGHT(REGEXP_REPLACE(c.member_phone,'[^0-9]','','g'),10)=RIGHT(REGEXP_REPLACE(m.phone,'[^0-9]','','g'),10) " +
      "WHERE c.status='approved' AND c.created_at >= $1 AND c.created_at < $2 GROUP BY 1 ORDER BY total_points DESC, zone_name ASC",
      [monthRange.start, monthRange.end]
    );
    _lbZoneRows = zoneRows || [];
    _lbAllRows = rows.map(function(r){
      var prof = _memberProfileForRow(r);
      return Object.assign({}, r, { zone: prof.zoneCurrent || '', roleType: prof.roleType || '', instrument: prof.instrument || '' });
    });
    try { localStorage.setItem(cacheKey, JSON.stringify(_lbAllRows)); } catch(_){}
    renderLeaderboard(_lbAllRows);
    if (memberLoggedIn && memberPhone) checkShowMilestone();
  } catch(e) {
    _lbZoneRows = [];
    const map = {};
    var fallbackStartKey = monthRange.key + '-01';
    var fallbackEndKey = monthKeyFromDate(new Date(new Date(monthRange.start).getFullYear(), new Date(monthRange.start).getMonth() + 1, 1)) + '-01';
    allBookings.filter(function(b){
      var key = bookingDateKey(b);
      return b.proofClaimed && b.name && key >= fallbackStartKey && key < fallbackEndKey;
    }).forEach(function(b){
      const key = (_normPhone(b.phone)||b.name.toLowerCase());
      if (!map[key]) map[key] = { name: b.name, phone: b.phone||'', shows: 0, show_count:0 };
      map[key].shows++;
      map[key].show_count++;
    });
    _lbAllRows = Object.values(map).map(function(r){
      r.zone = _memberZoneForRow(r);
      return r;
    }).sort(function(a,b){ return (b.shows - a.shows) || (b.show_count - a.show_count) || String(a.name||'').localeCompare(String(b.name||'')); });
    renderLeaderboard(_lbAllRows);
  }
}

function renderLeaderboard(rows) {
  const el = document.getElementById('leaderboardContent');
  if (!el) return;
  if (!rows || !rows.length) {
    el.innerHTML = '<div class="lb-empty">No confirmed performances yet.<br><span style="font-size:.8rem;color:var(--muted)">As shows get confirmed, performers will appear here.</span></div>';
    return;
  }
  const MEDALS = ['','',''];
  const myNorm = memberLoggedIn ? _normPhone(memberPhone) : null;
  const items = rows.map(function(p, i) {
    const shows     = Number(p.shows) || 0;
    const showCount = Number(p.show_count || p.shows) || 0;
    const rank    = i + 1;
    const medal   = rank <= 3 ? MEDALS[rank - 1] : '';
    const pNorm   = _normPhone(p.phone || '');
    const isMe    = myNorm && pNorm && pNorm === myNorm;
    const topCls  = rank <= 3 ? ' lb-top' : '';
    const meCls   = isMe ? ' lb-my-row' : '';
    const meTag   = isMe ? ' <span style="font-size:.7rem;font-weight:400;color:var(--orange);">(you)</span>' : '';
    const initial = (p.name || '?').charAt(0).toUpperCase();
    const myAvatar  = (isMe && memberAvatarUrl) ? memberAvatarUrl : '';
    const avatarInner = myAvatar
      ? '<img src="' + myAvatar + '" alt="' + initial + '" loading="lazy">'
      : '<span style="font-size:.8rem;">' + initial + '</span>';
    const safeName  = (p.name||'').replace(/'/g,"\'").replace(/"/g,'&quot;');
    const safePhone = (p.phone||'').replace(/'/g,"\'");
    const roleLabel = memberRoleLabel(p.roleType || '', p.instrument || '');
    const safeRole = roleLabel.replace(/'/g,"\'").replace(/"/g,'&quot;');
    const avatarHtml = '<div class="lb-avatar" style="cursor:pointer;" onclick="openPhotoViewerForMember(\'' + safeName + '\',\'' + safePhone + '\',' + shows + ',\'' + safeRole + '\')" title="View profile">' + avatarInner + '</div>';
    const zoneBadge = '<span class="lb-zone-badge">' + (p.zone || 'No Zone') + '</span>';
    return '<div class="lb-row' + topCls + meCls + '" data-name="' + ((p.name||'').toLowerCase()) + '">' +
      '<div class="lb-medal">' + (medal || ('<span style="font-size:.72rem;color:var(--muted);">#'+rank+'</span>')) + '</div>' +
      avatarHtml +
      '<div class="lb-name"><div class="lb-title-name">' + (p.name||'-') + meTag + zoneBadge + '</div>' + (roleLabel ? '<div class="lb-role-line">' + otsEscapeHtml(roleLabel) + '</div>' : '') + '</div>' +
      '<div class="lb-right">' +
        '<div class="lb-pts-badge">' + shows + ' pt' + (shows!==1?'s':'') + '</div>' +
        '<div class="lb-shows">' + showCount + ' show' + (showCount!==1?'s':'') + '</div>' +
      '</div>' +
    '</div>';
  });
  el.innerHTML = _buildZoneBattle(_lbZoneRows && _lbZoneRows.length ? _lbZoneRows : rows) + '<div class="lb-list-all">' + items.join('') + '</div>';
}

function filterLeaderboard(q) {

  const term = (q || '').trim().toLowerCase();
  const rows = _lbAllRows.filter(function(p) {
    return !term || (p.name || '').toLowerCase().includes(term);
  });
  renderLeaderboard(rows);
}

// -- Congratulations milestone popup -----------------------------------------
async function checkShowMilestone() {
  if (!memberLoggedIn || !memberPhone) return;
  var key = 'ots_show_count_' + _normPhone(memberPhone);
  var stored = parseInt(localStorage.getItem(key) || '-1', 10);
  try {
    var res = await neonSQL(
      "SELECT COUNT(*) AS cnt FROM claims WHERE RIGHT(REGEXP_REPLACE(member_phone,'[^0-9]','','g'),10)=$1 AND status='approved' AND COALESCE(claim_type,'show') IN ('show','special_show')",
      [_normPhone(memberPhone)]
    );
    var current = parseInt((res[0] && res[0].cnt) || 0, 10);
    localStorage.setItem(key, String(current));
    if (stored >= 0 && current > stored && current > 0) {
      _showCongratsOverlay(current);
    } else if (stored < 0 && current > 0) {
      // First time tracking - no popup but store value
    }
  } catch(e) { /* silently ignore */ }
}

function _showCongratsOverlay(count) {
  var el = document.getElementById('congratsOverlay');
  var num = document.getElementById('congratsCount');
  var lbl = document.getElementById('congratsLabel');
  var sub = document.getElementById('congratsSub');
  if (!el) return;
  if (num) num.textContent = count;
  if (lbl) lbl.textContent = 'show' + (count !== 1 ? 's' : '') + ' performed on the streets of Chennai!';
  if (sub) sub.textContent = count === 1 ? 'You just earned your first point! Welcome to the Hall of Fame! ' : 'Keep rocking - every show earns you a point ';
  el.style.display = 'flex';
}
function closeCongratsOverlay() {
  var el = document.getElementById('congratsOverlay');
  if (el) el.style.display = 'none';
}

// -- Member personal stats section --------------------------------------------
function _applyAvatarDisplay(avatarUrl) {
  var img     = document.getElementById('memberAvatarImg');
  var initial = document.getElementById('memberAvatarInitial');
  if (!img || !initial) return;
  if (avatarUrl) {
    img.src = avatarUrl;
    img.style.display = '';
    initial.style.display = 'none';
  } else {
    img.src = '';
    img.style.display = 'none';
    initial.textContent = (memberName || '?').charAt(0).toUpperCase();
    initial.style.display = '';
  }
  var nameEl = document.getElementById('memberAvatarName');
  if (nameEl) nameEl.textContent = memberName || '';
}

function _showAvatarToast(msg, isErr) {
  var t = document.getElementById('avatarToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'avatarToast';
    t.style.cssText = 'position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:#1e1e2e;border:1px solid var(--border);color:#fff;font-size:.8rem;font-weight:600;padding:.6rem 1.2rem;border-radius:6px;z-index:9999;box-shadow:0 4px 18px rgba(0,0,0,.4);transition:opacity .3s;pointer-events:none;';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  t.style.borderColor = isErr ? '#e53e3e' : 'var(--orange)';
  clearTimeout(t._tid);
  t._tid = setTimeout(function(){ t.style.opacity='0'; }, 2800);
}

async function handleAvatarUpload(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  var statusEl = document.getElementById('avatarStatus');
  _showAvatarToast('Compressing...');
  if (statusEl) statusEl.textContent = 'Compressing...';
  try {
    var compressed = await new Promise(function(resolve) {
      var reader = new FileReader();
      reader.onload = function(e) {
        var imgEl = new Image();
        imgEl.onload = function() {
          var canvas = document.createElement('canvas');
          var size = Math.min(imgEl.width, imgEl.height);
          var sx = (imgEl.width  - size) / 2;
          var sy = (imgEl.height - size) / 2;
          canvas.width = 80; canvas.height = 80;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(imgEl, sx, sy, size, size, 0, 0, 80, 80);
          resolve(canvas.toDataURL('image/jpeg', 0.5));
        };
        imgEl.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
    if (statusEl) statusEl.textContent = 'Saving...';
    var normP = _normPhone(memberPhone || '');
    await neonSQL("UPDATE members SET avatar_url=$1 WHERE phone=$2", [compressed, normP]);
    // Update nav + My Requests profile header + legacy avatar display
    _updateNavAvatar(compressed);
    _applyAvatarDisplay(compressed);
    _applyMyProfileHeader(compressed);
    // Update leaderboard row avatar (the "you" row) live
    var lbMyRow = document.querySelector('.lb-my-row .lb-avatar');
    if (lbMyRow) {
      var initial = (memberName || '?').charAt(0).toUpperCase();
      lbMyRow.innerHTML = '<img src="' + compressed + '" alt="' + initial + '" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">' +
        '<div style="position:absolute;bottom:-2px;right:-2px;font-size:.55rem;background:var(--orange);border-radius:50%;width:14px;height:14px;display:flex;align-items:center;justify-content:center;"></div>';
    }
    _showAvatarToast(' Profile photo updated!');
    if (statusEl) { statusEl.textContent = ' Profile photo updated!'; setTimeout(function(){ if(statusEl) statusEl.textContent=''; }, 3000); }
  } catch(e) {
    var msg = (e && e.message && e.message.toLowerCase().includes('transfer')) 
      ? 'Database limit reached - try again later' 
      : 'Upload failed - try again';
    _showAvatarToast(msg, true);
    if (statusEl) statusEl.textContent = msg;
    console.warn('[OTS] avatar upload:', e);
  }
  input.value = '';
}

async function loadMemberStats() {
  var sec = document.getElementById('memberStatsSection');
  if (!sec || !memberLoggedIn || !memberPhone) { if (sec) sec.style.display = 'none'; return; }
  sec.style.display = '';
  var msShows  = document.getElementById('ms-shows');
  var msPoints = document.getElementById('ms-points');
  var msRank   = document.getElementById('ms-rank');
  var perfList = document.getElementById('myPerfList');
  // Set name immediately; fetch avatar from DB
  _applyAvatarDisplay('');
  try {
    var normP = _normPhone(memberPhone);
    // Fetch avatar + profile fields  update nav, My Requests header, legacy display
    neonSQL("SELECT avatar_url,bio,role_type,instrument,instagram,blood_group,date_of_birth,address,zone_current,zone_request,zone_request_reason,zone_request_status,id_proof_url FROM members WHERE RIGHT(REGEXP_REPLACE(phone,'[^0-9]','','g'),10)=$1 LIMIT 1", [normP]).then(function(aRows) {
      if (!aRows || !aRows[0]) return;
      var url = aRows[0].avatar_url || '';
      memberBio        = aRows[0].bio           || '';
      memberRoleType   = aRows[0].role_type     || '';
      memberInstrument = aRows[0].instrument    || '';
      memberInstagram  = aRows[0].instagram     || '';
      memberBloodGroup = aRows[0].blood_group   || '';
      memberDob        = aRows[0].date_of_birth || '';
      memberAddress    = aRows[0].address       || memberAddress || localStorage.getItem('member_address') || '';
      memberZoneCurrent = aRows[0].zone_current || '';
      memberZoneRequest = aRows[0].zone_request || '';
      memberZoneRequestReason = aRows[0].zone_request_reason || '';
      memberZoneRequestStatus = aRows[0].zone_request_status || '';
      memberIdProofUrl = aRows[0].id_proof_url  || '';
      _applyAvatarDisplay(url);
      _applyMyProfileHeader(url);
    }).catch(function(){});
    // Show name immediately in profile header (avatar loads async above)
    _applyMyProfileHeader(memberAvatarUrl);
    // Personal approved claims - shows and volunteer separately
    var claims = await neonSQL(
      "SELECT c.id, COALESCE(b.venue, c.reason, '-') AS venue, COALESCE(b.date,'') AS date, COALESCE(c.claim_type,'show') AS claim_type, c.reason, COALESCE(c.points,1) AS points " +
      "FROM claims c LEFT JOIN bookings b ON b.id=c.booking_id " +
      "WHERE RIGHT(REGEXP_REPLACE(c.member_phone,'[^0-9]','','g'),10)=$1 AND c.status='approved' ORDER BY c.created_at DESC",
      [normP]
    );
    var showClaims  = claims.filter(function(c){
      var type = c.claim_type || 'show';
      return type === 'show' || type === 'special_show';
    });
    var bonusClaims = claims.filter(function(c){ return c.claim_type==='volunteer'; });
    var count = showClaims.length;
    var total = claims.reduce(function(sum, c){ return sum + (Number(c.points) || 0); }, 0);
    total = Math.round(total * 100) / 100;
    if (msShows)  msShows.textContent  = count;
    if (msPoints) msPoints.textContent = total;
    // Monthly rank uses the exact same phone-deduped ordering as the public rankings list.
    var rankMonthRange = monthRangeFromKey(monthKeyFromDate());
    var rankRows = await neonSQL(
      "SELECT c.phone_key, COALESCE(NULLIF(MAX(c.member_name),''), MAX(c.member_phone), c.phone_key) AS name, " +
      "SUM(COALESCE(c.points,1)) AS shows, COUNT(*) FILTER (WHERE COALESCE(c.claim_type,'show') IN ('show','special_show')) AS show_count " +
      "FROM (SELECT RIGHT(REGEXP_REPLACE(member_phone,'[^0-9]','','g'),10) AS phone_key, member_name, member_phone, points, claim_type FROM claims WHERE status='approved' AND created_at >= $1 AND created_at < $2) c " +
      "WHERE c.phone_key <> '' GROUP BY c.phone_key " +
      "ORDER BY shows DESC, show_count DESC, LOWER(COALESCE(NULLIF(MAX(c.member_name),''), MAX(c.member_phone), c.phone_key)) ASC, c.phone_key ASC LIMIT 5000",
      [rankMonthRange.start, rankMonthRange.end]
    );
    var rankIndex = (rankRows || []).findIndex(function(r){ return String(r.phone_key || '') === normP; });
    if (msRank) msRank.textContent = rankIndex >= 0 ? ('#' + (rankIndex + 1)) : '#-';
    // Render performance history
    if (perfList) {
      if (total === 0) {
        perfList.style.display = 'none';
      } else {
        perfList.style.display = '';
        perfList.innerHTML = claims.map(function(c) {
          var isVol = c.claim_type === 'volunteer';
          var label = isVol
            ? (c.reason || 'Volunteer')
            : (c.venue || '-');
          var dateTxt = isVol ? '' : formatDate(c.date || '');
          var badge = isVol
            ? '<span style="font-size:.62rem;background:rgba(112,186,244,.15);border:1px solid rgba(112,186,244,.3);color:var(--blue);padding:.1rem .4rem;border-radius:3px;margin-left:.4rem;">BONUS</span>'
            : '';
          return '<div class="my-perf-row">' +
            '<div class="my-perf-venue">' + label + badge + '</div>' +
            '<div class="my-perf-date">' + dateTxt + '</div>' +
            '<div class="my-perf-pt">+' + (Math.round((Number(c.points)||1) * 100) / 100) + ' pt</div>' +
            '</div>';
        }).join('');
      }
    }
    // Also check milestone while we're at it
    var key = 'ots_show_count_' + normP;
    var stored = parseInt(localStorage.getItem(key) || '-1', 10);
    localStorage.setItem(key, String(count));
    if (stored >= 0 && count > stored && count > 0) _showCongratsOverlay(count);
  } catch(e) {
    if (msShows)  msShows.textContent  = '-';
    if (msPoints) msPoints.textContent = '-';
    if (msRank)   msRank.textContent   = '#-';
    console.warn('[OTS] loadMemberStats:', e);
  }
}

// ========================================
// PROOF UPLOAD
// ========================================
var _proofBookingId = null;
var _proofFileData  = null;
var _proofPreparing  = false;
var _proofSubmitting = false;
var _proofLastTapAt   = 0;
var _proofModalScrollY = 0;

function lockProofModalPage() {
  try {
    _proofModalScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    document.documentElement.classList.add('proof-modal-open');
    document.body.classList.add('proof-modal-open', 'modal-lock');
    document.body.style.top = '-' + _proofModalScrollY + 'px';
  } catch(e) {}
}

function unlockProofModalPage() {
  try {
    document.documentElement.classList.remove('proof-modal-open');
    document.body.classList.remove('proof-modal-open', 'modal-lock');
    document.body.style.top = '';
    window.scrollTo(0, _proofModalScrollY || 0);
  } catch(e) {}
}

var _sharedMembers = []; // [{phone, name}] added in proof modal

// -- Helper: get show start/end Date objects for a booking --
function _showTimes(booking) {
  return getBookingWindow(booking);
}

function findVenueForBooking(booking) {
  if (!booking) return null;
  return venues.find(function(v){ return v.id === booking.venueId; }) ||
         venues.find(function(v){ return (v.name || '').toLowerCase() === (booking.venue || '').toLowerCase(); }) ||
         null;
}

function googleMapsSearchUrl(query) {
  var q = String(query || '').trim();
  if (!q) q = 'Chennai';
  if (!/chennai/i.test(q)) q += ', Chennai';
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}

function buildCheckinMapUrl(lat, lng) {
  if (lat == null || lng == null || lat === '' || lng === '') return '';
  return 'https://www.google.com/maps?q=' + encodeURIComponent(String(lat) + ',' + String(lng));
}

function venueMapsUrl(venue, fallbackName) {
  if (venue && venue.mapUrl) return venue.mapUrl;
  if (venue && venue.landmark) return googleMapsSearchUrl(venue.landmark);
  if (venue && venue.location) return googleMapsSearchUrl(venue.location);
  return googleMapsSearchUrl((venue && venue.name) || fallbackName || '');
}

const CHECKIN_RADIUS_METERS = 1000;
const CHECKIN_OPEN_MINUTES = 60;
const CHECKIN_LATE_GRACE_MINUTES = 10;
const SHOW_POINTS_SOLO = 3;
const SHOW_POINTS_DUO = 4;
const SHOW_POINTS_GROUP = 5;
const SHOW_LATE_POINTS = 1;
const LATE_POINT_GRACE_START = '2026-05-01';
const LATE_POINT_GRACE_END_EXCLUSIVE = '2026-07-01';

function bookingDateKey(booking) {
  var raw = String((booking && booking.date) || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  var st = _showTimes(booking);
  if (st && st.start && !isNaN(st.start.getTime())) return st.start.toISOString().slice(0, 10);
  return '';
}

function isLatePointGraceBooking(booking) {
  var key = bookingDateKey(booking);
  return !!(key && key >= LATE_POINT_GRACE_START && key < LATE_POINT_GRACE_END_EXCLUSIVE);
}

function extractLatLngFromText(value) {
  var raw = String(value || '').trim();
  if (!raw) return null;
  var decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch(_) {}
  var patterns = [
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/i,
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/i,
    /^\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)\s*$/
  ];
  for (var i = 0; i < patterns.length; i++) {
    var m = decoded.match(patterns[i]);
    if (m) {
      var lat = parseFloat(m[1]);
      var lng = parseFloat(m[2]);
      if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { lat: lat, lng: lng };
      }
    }
  }
  return null;
}

function venueLatLng(venue) {
  if (!venue) return null;
  return extractLatLngFromText(venue.mapUrl) ||
         extractLatLngFromText(venue.landmark) ||
         extractLatLngFromText(venue.location);
}

function distanceMeters(a, b) {
  if (!a || !b) return null;
  var R = 6371000;
  var toRad = function(n){ return n * Math.PI / 180; };
  var dLat = toRad(b.lat - a.lat);
  var dLng = toRad(b.lng - a.lng);
  var lat1 = toRad(a.lat);
  var lat2 = toRad(b.lat);
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1) * Math.cos(lat2) *
          Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatDistanceMeters(meters) {
  if (!isFinite(meters)) return '';
  return meters >= 1000 ? (meters / 1000).toFixed(1) + ' km' : Math.round(meters) + ' m';
}

function checkInStateForBooking(booking, now) {
  now = now || new Date();
  var st = _showTimes(booking);
  if (!st || !st.start || !st.end) {
    return { can: false, reason: 'Show timing is missing. Please contact admin.' };
  }
  var openAt = new Date(st.start.getTime() - CHECKIN_OPEN_MINUTES * 60000);
  var lateAt = new Date(st.start.getTime() + CHECKIN_LATE_GRACE_MINUTES * 60000);
  if (now < openAt) {
    return {
      can: false,
      reason: 'Check-in opens 1 hour before the show.',
      openAt: openAt
    };
  }
  if (now > st.end) {
    return {
      can: false,
      reason: 'Show ended. Please contact admin if check-in was missed.',
      ended: true
    };
  }
  var late = now > lateAt;
  if (late && isLatePointGraceBooking(booking)) {
    return {
      can: true,
      late: false,
      grace: true,
      reason: 'Practice period: late check-in will not reduce points until July 1, 2026.'
    };
  }
  return {
    can: true,
    late: late,
    reason: late ? 'Late check-in: total show points will be reduced.' : ''
  };
}

function bookingPointPool(booking) {
  var st = _showTimes(booking);
  var fullPoints = showFullPointsForBooking(booking);
  if (!booking || !booking.checkinAt || !st || !st.start) return fullPoints;
  if (isLatePointGraceBooking(booking)) return fullPoints;
  var lateAt = new Date(st.start.getTime() + CHECKIN_LATE_GRACE_MINUTES * 60000);
  var checkedAt = new Date(booking.checkinAt);
  return checkedAt > lateAt ? SHOW_LATE_POINTS : fullPoints;
}

function showFullPointsForBooking(booking) {
  var type = String((booking && booking.type) || '').toLowerCase();
  if (/\bsolo\b|single|1\s*(?:piece|pc|member|person)?\b/.test(type)) return SHOW_POINTS_SOLO;
  if (/\bduo\b|2\s*(?:piece|pc|member|person)?\b|two\s*(?:piece|member|person)?/.test(type)) return SHOW_POINTS_DUO;
  return SHOW_POINTS_GROUP;
}

function splitShowPoints(totalPoints, performerCount) {
  var count = Math.max(1, Number(performerCount) || 1);
  return Math.round((Number(totalPoints || SHOW_POINTS_GROUP) / count) * 100) / 100;
}

async function rebalanceApprovedShowClaims(bookingId, booking, countPendingToo) {
  var rows = await neonSQL(
    "SELECT id,status FROM claims WHERE booking_id=$1 AND COALESCE(claim_type,'show')='show' AND status IN ('pending','approved')",
    [String(bookingId)]
  );
  var approvedRows = (rows || []).filter(function(r){ return r.status === 'approved'; });
  var performerCount = countPendingToo ? Math.max(1, (rows || []).length) : Math.max(1, approvedRows.length);
  var totalPool = bookingPointPool(booking);
  var pts = splitShowPoints(totalPool, performerCount);
  await neonSQL(
    "UPDATE claims SET points=$2 WHERE booking_id=$1 AND COALESCE(claim_type,'show')='show' AND status='approved'",
    [String(bookingId), pts]
  );
  return { points: pts, totalPool: totalPool, performerCount: performerCount };
}

async function recalcLateGraceApprovedClaims() {
  try {
    var rows = await neonSQL(
      "SELECT DISTINCT b.id, b.type, b.date, b.venue, b.venue_id, b.checkin_at " +
      "FROM bookings b INNER JOIN claims c ON c.booking_id=b.id " +
      "WHERE c.status='approved' AND COALESCE(c.claim_type,'show')='show' " +
      "AND b.date >= $1 AND b.date < $2",
      [LATE_POINT_GRACE_START, LATE_POINT_GRACE_END_EXCLUSIVE]
    );
    for (var i = 0; i < (rows || []).length; i++) {
      var b = {
        id: rows[i].id,
        type: rows[i].type || '',
        date: rows[i].date || '',
        venue: rows[i].venue || '',
        venueId: rows[i].venue_id || '',
        checkinAt: rows[i].checkin_at || null
      };
      await rebalanceApprovedShowClaims(b.id, b, false);
    }
  } catch(e) {
    console.warn('[OTS] late grace point recalculation skipped:', e && (e.message || e));
  }
}

function openVenueInMapsForBooking(bookingId) {
  var b = myBookings.find(function(x){ return x.id === bookingId; }) ||
          allBookings.find(function(x){ return x.id === bookingId; });
  var v = findVenueForBooking(b);
  openVenueInMaps(v, b && b.venue);
}

function openVenueInMaps(venue, fallbackName) {
  var url = venueMapsUrl(venue, fallbackName);
  try {
    var opened = window.open(url, '_blank', 'noopener');
    if (!opened) window.location.href = url;
  } catch(e) {
    window.location.href = url;
  }
}

function getCurrentPositionForCheckIn() {
  return new Promise(function(resolve) {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      function(pos) {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        });
      },
      function() { resolve(null); },
      { enableHighAccuracy:true, timeout:12000, maximumAge:30000 }
    );
  });
}

// -- Check-in: member marks their arrival at the venue --
async function checkInToShow(bookingId) {
  var b = myBookings.find(function(x){ return x.id === bookingId; });
  if (!b) return;
  if (b.checkinAt) return;
  var liveNow = new Date();
  var state = checkInStateForBooking(b, liveNow);
  if (!state.can) {
    showToast('', 'Check-in Not Open', state.reason || 'Check-in is not available right now.');
    return;
  }
  var venue = findVenueForBooking(b);
  var target = venueLatLng(venue);
  var now = liveNow.toISOString();
  try {
    showToast('', 'Recording Arrival', 'Please allow location access if your phone asks.');
    var pos = await getCurrentPositionForCheckIn();
    if (!pos) {
      showToast('', 'Location Required', 'Please allow location access to check in from the venue.');
      return;
    }
    var distance = target ? distanceMeters({ lat: pos.lat, lng: pos.lng }, target) : null;
    if (target && (distance == null || distance > CHECKIN_RADIUS_METERS)) {
      showToast('', 'Not Near Venue', 'You are ' + formatDistanceMeters(distance) + ' away. Please check in from the venue area.');
      return;
    }
    var updates = { checkin_at: now };
    updates.checkin_lat = pos.lat;
    updates.checkin_lng = pos.lng;
    updates.checkin_accuracy = pos.accuracy || null;
    updates.checkin_map_url = buildCheckinMapUrl(pos.lat, pos.lng);
    await dbPatch('bookings', bookingId, updates);
    Object.assign(b, {
      checkinAt: now,
      checkinLat: pos.lat,
      checkinLng: pos.lng,
      checkinAccuracy: pos.accuracy || null,
      checkinMapUrl: updates.checkin_map_url
    });
    // Update allBookings cache too
    var ab = allBookings.find(function(x){ return x.id === bookingId; });
    if (ab) Object.assign(ab, {
      checkinAt: b.checkinAt,
      checkinLat: b.checkinLat,
      checkinLng: b.checkinLng,
      checkinAccuracy: b.checkinAccuracy,
      checkinMapUrl: b.checkinMapUrl
    });
    notifyAdminCheckIn(ab || b);
    renderUserBookings();
    try { filterTable(); updateAdminStats(); } catch(_) {}
    showToast('','Checked In!', state.grace ? 'Practice period recorded. No late point reduction until July 1, 2026.' : (state.late ? 'Late arrival recorded. Total show points will be reduced.' : 'Your arrival, time and location have been recorded.'));
  } catch(e) {
    showToast('','Error','Could not record check-in. Please try again.');
  }
}

function openProofModal(bookingId, venueName) {
  _proofBookingId = bookingId;
  _proofFileData  = null;
  _proofPreparing = false;
  _proofSubmitting = false;
  var booking = myBookings.find(function(x){ return x.id === bookingId; }) || allBookings.find(function(x){ return x.id === bookingId; });
  var ownPhone = _normPhone(memberPhone || (booking && booking.phone) || '');
  _sharedMembers  = parseBookingPerformers(booking && booking.performers).filter(function(m){ return _normPhone(m.phone) && _normPhone(m.phone) !== ownPhone; });
  var preview   = document.getElementById('proofPreview');
  var fileInput = document.getElementById('proofFileInput');
  var submitBtn = document.getElementById('proofSubmitBtn');
  var chooseBtn = document.getElementById('proofChooseBtn');
  var err       = document.getElementById('proofErr');
  var vn        = document.getElementById('proofModalVenue');
  var shareInp  = document.getElementById('proofSharePhone');
  var manualBox = document.getElementById('proofManualTimeBox');
  var arrivalInp = document.getElementById('proofArrivalTime');
  var startInp = document.getElementById('proofShowStartTime');
  if (vn)        vn.textContent         = venueName || 'your show';
  if (preview)  { preview.src=''; preview.style.display='none'; }
  if (fileInput)  fileInput.value       = '';
  if (submitBtn)  { submitBtn.disabled = true; submitBtn.textContent = 'Submit for Approval'; }
  if (chooseBtn)  chooseBtn.textContent = ' Choose Photo';
  if (err)        { err.textContent = ''; err.style.display = 'none'; err.style.color = '#ff4b4b'; }
  if (shareInp)   shareInp.value        = '';
  if (arrivalInp) arrivalInp.value      = '';
  if (startInp) {
    var st = _showTimes(booking);
    startInp.value = st && st.start ? bookingLocalTimeValue(st.start) : '';
  }
  if (manualBox) manualBox.style.display = booking && !booking.checkinAt ? '' : 'none';
  _renderSharedList();
  lockProofModalPage();
  document.getElementById('proofModal').classList.add('show');
}

function closeProofModal() {
  document.getElementById('proofModal').classList.remove('show');
  unlockProofModalPage();
  _proofBookingId = null;
  _proofFileData  = null;
  _proofPreparing = false;
  _proofSubmitting = false;
  _sharedMembers  = [];
}

async function addSharedMember() {
  var inp = document.getElementById('proofSharePhone');
  var phone = (inp ? inp.value : '').trim();
  if (!phone) return;
  var normP = _normPhone(phone);
  if (!normP) { showToast('','Invalid','Enter a valid phone number.'); return; }
  if (_normPhone(memberPhone||'') === normP) { showToast('','Already added','That is your own number.'); inp.value=''; return; }
  if (_sharedMembers.some(function(m){ return _normPhone(m.phone) === normP; })) { showToast('','Duplicate','That member is already in the list.'); inp.value=''; return; }
  var mem = members.find(function(m){ return _normPhone(m.phone||'') === normP; });
  if (!mem && typeof findMemberForClaim === 'function') {
    try { mem = await findMemberForClaim(normP); } catch(e) { mem = null; }
  }
  _sharedMembers.push({ phone: normP, name: mem ? mem.name : '' });
  inp.value = '';
  _renderSharedList();
}

var _editPerformersBookingId = null;
var _editPerformersList = [];

function bookingLocalTimeValue(dateObj) {
  if (!dateObj || isNaN(dateObj.getTime())) return '';
  var hh = String(dateObj.getHours()).padStart(2, '0');
  var mm = String(dateObj.getMinutes()).padStart(2, '0');
  return hh + ':' + mm;
}

function bookingDateTimeIso(booking, timeValue) {
  var dateKey = bookingDateKey(booking);
  var time = String(timeValue || '').trim();
  if (!dateKey || !/^\d{2}:\d{2}$/.test(time)) return '';
  var d = new Date(dateKey + 'T' + time + ':00');
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

function openEditPerformersModal(bookingId) {
  var b = myBookings.find(function(x){ return x.id === bookingId; }) || allBookings.find(function(x){ return x.id === bookingId; });
  if (!b) return;
  if (!canEditBookingPerformers(b)) {
    showToast('', 'Editing Closed', 'Performer details can be edited only before the show ends and before photo upload.');
    return;
  }
  _editPerformersBookingId = bookingId;
  _editPerformersList = parseBookingPerformers(b.performers);
  var ownPhone = _normPhone(b.phone || memberPhone || '');
  if (ownPhone && !_editPerformersList.some(function(m){ return _normPhone(m.phone) === ownPhone; })) {
    _editPerformersList.unshift({ phone: ownPhone, name: b.name || memberName || getBookingPersonName(b) || '' });
  }
  var typeEl = document.getElementById('edit-perf-type');
  var phoneEl = document.getElementById('edit-perf-phone');
  var status = document.getElementById('edit-perf-status');
  if (typeEl) typeEl.value = b.type || '';
  if (phoneEl) phoneEl.value = '';
  if (status) { status.textContent = 'You can edit this until the show end time.'; status.style.color = 'var(--muted)'; }
  renderEditPerformersList();
  var modal = document.getElementById('editPerformersModal');
  try { document.body.classList.add('modal-lock'); } catch(e) {}
  if (modal) modal.classList.add('show');
}

function closeEditPerformersModal() {
  var modal = document.getElementById('editPerformersModal');
  if (modal) modal.classList.remove('show');
  try { document.body.classList.remove('modal-lock'); } catch(e) {}
  _editPerformersBookingId = null;
  _editPerformersList = [];
}

function renderEditPerformersList() {
  var el = document.getElementById('edit-perf-list');
  if (!el) return;
  if (!_editPerformersList.length) {
    el.innerHTML = '<div style="font-size:.75rem;color:var(--muted);">No performers added yet.</div>';
    return;
  }
  var booking = myBookings.find(function(x){ return x.id === _editPerformersBookingId; }) || {};
  var ownerPhone = _normPhone(booking.phone || memberPhone || '');
  el.innerHTML = _editPerformersList.map(function(m, i) {
    var isOwner = ownerPhone && _normPhone(m.phone) === ownerPhone;
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:.6rem;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:4px;padding:.55rem .7rem;">' +
      '<div><div style="font-size:.82rem;font-weight:700;">' + otsEscapeHtml(m.name || 'Member') + (isOwner ? ' <span style="font-size:.62rem;color:var(--orange);">BOOKER</span>' : '') + '</div>' +
      '<div style="font-size:.7rem;color:var(--muted);">' + otsEscapeHtml(m.phone || '') + '</div></div>' +
      (isOwner ? '<span style="font-size:.68rem;color:var(--muted);">Required</span>' : '<button type="button" onclick="removeEditPerformer(' + i + ')" style="background:transparent;border:1px solid rgba(220,38,38,.35);color:#ff7b7b;font-size:.7rem;font-weight:800;padding:.3rem .55rem;border-radius:3px;">Remove</button>') +
    '</div>';
  }).join('');
}

async function addEditPerformer() {
  var inp = document.getElementById('edit-perf-phone');
  var status = document.getElementById('edit-perf-status');
  var phone = _normPhone((inp && inp.value) || '');
  if (!phone) { if (status) { status.style.color = '#ff4b4b'; status.textContent = 'Enter a valid member mobile number.'; } return; }
  if (_editPerformersList.some(function(m){ return _normPhone(m.phone) === phone; })) {
    if (status) { status.style.color = '#ff4b4b'; status.textContent = 'That member is already added.'; }
    if (inp) inp.value = '';
    return;
  }
  if (status) { status.style.color = 'var(--muted)'; status.textContent = 'Checking member...'; }
  try {
    var member = await lookupClaimMemberByPhone(phone);
    _editPerformersList.push({ phone: phone, name: member ? member.name || '' : '' });
    if (inp) inp.value = '';
    if (status) { status.style.color = 'var(--muted)'; status.textContent = member && member.name ? member.name + ' added.' : 'Phone added. Admin can verify if needed.'; }
    renderEditPerformersList();
  } catch(e) {
    _editPerformersList.push({ phone: phone, name: '' });
    if (inp) inp.value = '';
    renderEditPerformersList();
  }
}

function removeEditPerformer(index) {
  _editPerformersList.splice(index, 1);
  renderEditPerformersList();
}

async function saveEditPerformers() {
  var b = myBookings.find(function(x){ return x.id === _editPerformersBookingId; }) || allBookings.find(function(x){ return x.id === _editPerformersBookingId; });
  var status = document.getElementById('edit-perf-status');
  var btn = document.getElementById('edit-perf-save');
  if (!b) return;
  if (!canEditBookingPerformers(b)) {
    if (status) { status.style.color = '#ff4b4b'; status.textContent = 'Editing closed because the show ended or proof was uploaded.'; }
    return;
  }
  var type = (document.getElementById('edit-perf-type') && document.getElementById('edit-perf-type').value) || '';
  if (!type) { if (status) { status.style.color = '#ff4b4b'; status.textContent = 'Select Solo, 2 Piece, 3 Piece or 4 Piece.'; } return; }
  if (!_editPerformersList.length) { if (status) { status.style.color = '#ff4b4b'; status.textContent = 'Add at least one performer.'; } return; }
  var performers = parseBookingPerformers(_editPerformersList);
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    await dbPatch('bookings', b.id, { type: type, performers: stringifyBookingPerformers(performers) });
    [myBookings, allBookings].forEach(function(arr) {
      var item = arr.find(function(x){ return x.id === b.id; });
      if (item) { item.type = type; item.performers = performers; }
    });
    saveMyBookings(); saveLocal();
    renderUserBookings();
    try { filterTable(); renderGigCalendar(); } catch(_) {}
    closeEditPerformersModal();
    showToast('', 'Updated', 'Performance type and members updated.');
  } catch(e) {
    console.error('[OTS] save performers:', e);
    if (status) { status.style.color = '#ff4b4b'; status.textContent = 'Could not save. Please try again.'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
  }
}

function _renderSharedList() {
  var el = document.getElementById('proofSharedList');
  if (!el) return;
  if (!_sharedMembers.length) { el.innerHTML = ''; return; }
  el.innerHTML = _sharedMembers.map(function(m, i) {
    return `<div style="display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:4px;padding:.45rem .75rem;font-size:.78rem;">
      <span>${m.name ? '<strong>'+m.name+'</strong> - ' : ''}${m.phone}</span>
      <button type="button" onclick="_removeSharedMember(${i})" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.85rem;padding:0 .2rem;">x</button>
    </div>`;
  }).join('');
}

function _removeSharedMember(i) {
  _sharedMembers.splice(i, 1);
  _renderSharedList();
}

async function lookupClaimMemberByPhone(phone) {
  var normP = _normPhone(phone || '');
  if (!normP) return null;
  var local = (members || []).find(function(m){ return _normPhone(m.phone || '') === normP; });
  if (local) return { phone: normP, name: local.name || '' };
  try {
    var rows = await neonSQL(
      "SELECT name,phone FROM members WHERE RIGHT(REGEXP_REPLACE(phone,'[^0-9]','','g'),10)=$1 LIMIT 1",
      [normP]
    );
    if (rows && rows[0]) return { phone: normP, name: rows[0].name || '' };
  } catch(e) {
    console.warn('[OTS] claim member lookup failed:', e && (e.message || e));
  }
  return { phone: normP, name: '' };
}

async function addMemberClaimFromRequest(bookingId) {
  if (!memberLoggedIn) {
    showToast('', 'Login Required', 'Please login before adding a member.');
    return;
  }
  var b = myBookings.find(function(x){ return x.id === bookingId; }) ||
          allBookings.find(function(x){ return x.id === bookingId; });
  if (!b || b.status !== 'confirmed') {
    showToast('', 'Not Available', 'Members can be added only for confirmed shows.');
    return;
  }
  if (b.proofClaimed) {
    showToast('', 'Already Approved', 'Please contact admin to restore this claim before adding members.');
    return;
  }
  var enteredPhone = prompt('Enter the missed member mobile number');
  if (enteredPhone === null) return;
  var normP = _normPhone(enteredPhone);
  if (!normP) {
    showToast('', 'Phone Required', 'Enter a valid registered mobile number.');
    return;
  }
  if (_normPhone(memberPhone || '') === normP) {
    showToast('', 'Already Included', 'Your own point is already included in this claim.');
    return;
  }
  try {
    var existing = await neonSQL(
      "SELECT id,status FROM claims WHERE booking_id=$1 AND RIGHT(REGEXP_REPLACE(member_phone,'[^0-9]','','g'),10)=$2 LIMIT 1",
      [bookingId, normP]
    );
    if (existing && existing.length) {
      showToast('', 'Already Added', 'This member is already added for this show.');
      return;
    }
    var member = await lookupClaimMemberByPhone(normP);
    await neonSQL(
      "INSERT INTO claims (booking_id, member_phone, member_name, status, claim_type, reason) VALUES ($1,$2,$3,'pending','show','Added by member after proof upload')",
      [bookingId, normP, (member && member.name) || '']
    );
    showToast('', 'Member Added', 'Admin will review this member point with your proof.');
  } catch(e) {
    console.error('[OTS] add member claim:', e);
    showToast('', 'Could Not Add', (e && e.message) || 'Please try again or contact admin.');
  }
}

function previewProof(input) {
  var file = input && input.files && input.files[0];
  if (!file) return;
  var preview   = document.getElementById('proofPreview');
  var chooseBtn = document.getElementById('proofChooseBtn');
  var submitBtn = document.getElementById('proofSubmitBtn');
  var err       = document.getElementById('proofErr');
  _proofFileData = null;
  _proofPreparing = true;
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Preparing photo...'; }
  if (chooseBtn) chooseBtn.textContent = ' Preparing...';
  if (err) { err.textContent = 'Preparing photo. Please wait a moment.'; err.style.color = 'var(--muted)'; err.style.display = ''; }
  // Keep proof photos small enough for reliable mobile uploads on slower networks.
  _compressImage(file, 420, 0.52, function(dataUrl) {
    _proofFileData = dataUrl;
    if (preview)   { preview.src = dataUrl; preview.style.display = 'block'; }
    if (chooseBtn)   chooseBtn.textContent = ' Change Photo';
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit for Approval'; }
    if (err) { err.textContent = 'Photo ready. Tap Submit for Approval once.'; err.style.color = 'var(--green)'; err.style.display = ''; }
    _proofPreparing = false;
  }, function(errorMsg) {
    _proofPreparing = false;
    _proofFileData = null;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submit for Approval'; }
    if (chooseBtn) chooseBtn.textContent = ' Choose Photo';
    if (err) { err.textContent = errorMsg || 'Could not prepare this photo. Please choose another image.'; err.style.color = '#ff4b4b'; err.style.display = ''; }
    showToast('', 'Photo Not Ready', errorMsg || 'Please choose another image.');
  });
}

function _compressImage(file, maxPx, quality, cb, errCb) {
  var reader = new FileReader();
  reader.onerror = function() {
    if (errCb) errCb('Could not read this photo. Please choose another image.');
  };
  reader.onload = function(e) {
    var img = new Image();
    img.onerror = function() {
      if (errCb) errCb('This photo format could not be opened. Please choose a JPG/PNG image.');
    };
    img.onload = function() {
      try {
        var w = img.width, h = img.height;
        if (!w || !h) throw new Error('Invalid image size');
        if (w > maxPx || h > maxPx) {
          if (w > h) { h = Math.round(h * maxPx / w); w = maxPx; }
          else       { w = Math.round(w * maxPx / h); h = maxPx; }
        }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(canvas.toDataURL('image/jpeg', quality));
      } catch(e) {
        if (errCb) errCb('Could not prepare this photo. Please choose another image.');
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function proofSubmitTap(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  var now = Date.now();
  if (now - _proofLastTapAt < 900) return false;
  _proofLastTapAt = now;
  submitProof();
  return false;
}

async function submitProof() {
  if (_proofSubmitting) return;
  var btn = document.getElementById('proofSubmitBtn');
  var err = document.getElementById('proofErr');
  if (_proofPreparing) {
    if (err) { err.textContent = 'Photo is still preparing. Please wait a moment.'; err.style.color = 'var(--muted)'; err.style.display = ''; }
    return;
  }
  if (!_proofBookingId || !_proofFileData) {
    if (err) { err.textContent = 'Please choose a photo first.'; err.style.color = '#ff4b4b'; err.style.display = ''; }
    showToast('', 'Choose Photo', 'Please choose a photo before submitting.');
    return;
  }
  var proofBooking = myBookings.find(function(x){ return x.id === _proofBookingId; }) ||
                     allBookings.find(function(x){ return x.id === _proofBookingId; });
  var manualArrivalIso = '';
  var manualReason = '';
  if (proofBooking && !proofBooking.checkinAt) {
    var arrivalValue = (document.getElementById('proofArrivalTime') && document.getElementById('proofArrivalTime').value) || '';
    var startValue = (document.getElementById('proofShowStartTime') && document.getElementById('proofShowStartTime').value) || '';
    manualArrivalIso = bookingDateTimeIso(proofBooking, arrivalValue);
    var manualStartIso = bookingDateTimeIso(proofBooking, startValue);
    if (!manualArrivalIso || !manualStartIso) {
      if (err) { err.textContent = 'Please enter arrival time and show started time before submitting.'; err.style.color = '#ff4b4b'; err.style.display = ''; }
      showToast('', 'Time Needed', 'Enter arrival time and show started time.');
      return;
    }
    if (new Date(manualArrivalIso) > new Date(manualStartIso)) {
      if (err) { err.textContent = 'Arrival time cannot be after the show started time.'; err.style.color = '#ff4b4b'; err.style.display = ''; }
      showToast('', 'Check Time', 'Arrival time cannot be after show started time.');
      return;
    }
    manualReason = 'Manual missed check-in. Arrival: ' + arrivalValue + '; Show started: ' + startValue;
  }
  _proofSubmitting = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Uploading...'; }
  if (err) { err.textContent = 'Uploading. Keep this screen open for a few seconds.'; err.style.color = 'var(--muted)'; err.style.display = ''; }
  try {
    // Save proof photo on the booking - proof_claimed stays FALSE until admin approves
    var bookingUpdates = { proof_url: _proofFileData, proof_claimed: false };
    if (manualArrivalIso) {
      bookingUpdates.checkin_at = manualArrivalIso;
      bookingUpdates.checkin_lat = null;
      bookingUpdates.checkin_lng = null;
      bookingUpdates.checkin_accuracy = null;
      bookingUpdates.checkin_map_url = '';
    }
    await dbPatch('bookings', _proofBookingId, bookingUpdates);

    // Insert a claim for the booker themselves
    await neonSQL(
      "INSERT INTO claims (booking_id, member_phone, member_name, status, claim_type, reason) " +
      "SELECT $1,$2,$3,'pending','show',$4 WHERE NOT EXISTS (SELECT 1 FROM claims WHERE booking_id=$1 AND RIGHT(REGEXP_REPLACE(member_phone,'[^0-9]','','g'),10)=RIGHT(REGEXP_REPLACE($2::text,'[^0-9]','','g'),10) AND COALESCE(claim_type,'show')='show')",
      [_proofBookingId, _normPhone(memberPhone||'')||memberPhone||'', memberName||'', manualReason]
    );
    // Insert claims for each additional shared member
    for (var i = 0; i < _sharedMembers.length; i++) {
      var sm = _sharedMembers[i];
      await neonSQL(
        "INSERT INTO claims (booking_id, member_phone, member_name, status, claim_type, reason) " +
        "SELECT $1,$2,$3,'pending','show',$4 WHERE NOT EXISTS (SELECT 1 FROM claims WHERE booking_id=$1 AND RIGHT(REGEXP_REPLACE(member_phone,'[^0-9]','','g'),10)=RIGHT(REGEXP_REPLACE($2::text,'[^0-9]','','g'),10) AND COALESCE(claim_type,'show')='show')",
        [_proofBookingId, sm.phone, sm.name, manualReason]
      );
    }

    // Update local caches - proofClaimed stays false (pending), set proofUrl
    [myBookings, allBookings].forEach(function(arr) {
      var b = arr.find(function(x){ return x.id === _proofBookingId; });
      if (b) {
        b.proofUrl = _proofFileData;
        b.proofClaimed = false;
        if (manualArrivalIso) {
          b.checkinAt = manualArrivalIso;
          b.checkinLat = null;
          b.checkinLng = null;
          b.checkinAccuracy = null;
          b.checkinMapUrl = '';
        }
      }
    });
    saveMyBookings(); saveLocal();
    if (btn) btn.textContent = 'Submitted';
    closeProofModal();
    renderUserBookings();
    var extra = _sharedMembers.length ? ' + ' + _sharedMembers.length + ' band member(s).' : '.';
    showToast('', 'Proof Submitted!', 'Admin will review and approve the claim for you' + extra);
  } catch(e) {
    _proofSubmitting = false;
    var msg = (e && e.message) || 'Unknown error';
    if (err) { err.textContent = 'Upload failed: ' + msg; err.style.color = '#ff4b4b'; err.style.display = ''; }
    if (btn) { btn.disabled = false; btn.textContent = ' Submit for Approval '; }
    showToast('', 'Upload Failed', msg);
    console.error('[OTS] submitProof error:', e);
  }
}

// ========================================
// NOTIFICATION CENTRE
// ========================================
const NOTIF_SEEN_KEY = 'ots_notif_seen_v1';
const IN_APP_STATUS_NOTIFICATIONS_ENABLED = false;
var _notifSeenMap  = {}; // { [bookingId]: 'confirmed'|'rejected' }
var _notifHistory  = []; // [{ id, venue, status, date }] newest first
var _notifDismissedIds = new Set(); // cross-device cleared notification ids
let _remoteNotifDismissLoadedFor = '';

async function loadDismissedNotifsRemote(force){
  var key = getMemberKey();
  if (!key) return;
  if (!force && _remoteNotifDismissLoadedFor === key) return;
  try {
    var rows = await neonSQL('SELECT booking_id FROM dismissed_notifications WHERE user_key = $1', [key]);
    (rows || []).forEach(function(r){ if (r.booking_id != null) _notifDismissedIds.add(String(r.booking_id)); });
    _remoteNotifDismissLoadedFor = key;
    // Remove any locally saved history for ids that were cleared on another device
    _notifHistory = _notifHistory.filter(function(h){ return !_notifDismissedIds.has(String(h.id)); });
    _saveNotifData();
  } catch(e) { console.warn('[OTS] remote notification dismiss load skipped:', e && (e.message||e)); }
}
async function saveDismissedNotifsRemote(ids){
  var key = getMemberKey();
  if (!key || !ids || !ids.length) return;
  ids = ids.map(String);
  try {
    var params = [key];
    var values = ids.map(function(id, i){ params.push(id); return '($1,$' + (i+2) + ')'; }).join(',');
    await neonSQL('INSERT INTO dismissed_notifications (user_key, booking_id) VALUES ' + values + ' ON CONFLICT (user_key, booking_id) DO NOTHING', params);
  } catch(e) { console.warn('[OTS] remote notification dismiss save skipped:', e && (e.message||e)); }
}

function _loadNotifData() {
  try {
    var raw = localStorage.getItem(NOTIF_SEEN_KEY);
    if (raw) { var d = JSON.parse(raw); _notifSeenMap = d.seen||{}; _notifHistory = (d.history||[]).filter(function(h){ return !_notifDismissedIds.has(String(h.id)); }); }
  } catch(e) {}
}
function _saveNotifData() {
  try { localStorage.setItem(NOTIF_SEEN_KEY, JSON.stringify({ seen: _notifSeenMap, history: _notifHistory })); } catch(e) {}
}

// Add a new notification to history (deduped by id+status)
function _recordNotif(booking) {
  if (booking && booking.id != null && _notifDismissedIds.has(String(booking.id))) return;
  var already = _notifHistory.find(function(h){ return h.id === booking.id && h.status === booking.status; });
  if (!already) {
    _notifHistory.unshift({ id: booking.id, venue: booking.venue || booking.venueId || '-', status: booking.status, date: booking.date || '' });
    if (_notifHistory.length > 50) _notifHistory.length = 50; // cap
    _saveNotifData();
  }
}

function getUnseenNotifs() {
  return myBookings.filter(function(b) {
    return (b.status === 'confirmed' || b.status === 'rejected') && !_notifDismissedIds.has(String(b.id)) && _notifSeenMap[b.id] !== b.status;
  });
}

function updateNotifBadge() {
  if (!IN_APP_STATUS_NOTIFICATIONS_ENABLED) {
    var hiddenWrap = document.getElementById('notifBellWrap');
    var hiddenBadge = document.getElementById('notifBadge');
    var hiddenMobile = document.getElementById('mn-notif');
    var hiddenDot = document.getElementById('mn-notif-dot');
    if (hiddenWrap) hiddenWrap.style.display = 'none';
    if (hiddenBadge) hiddenBadge.style.display = 'none';
    if (hiddenMobile) hiddenMobile.style.display = 'none';
    if (hiddenDot) hiddenDot.style.display = 'none';
    closeNotifPanel();
    return;
  }
  _loadNotifData();
  var unseen = getUnseenNotifs();
  var n = unseen.length;
  // Desktop bell
  var wrap  = document.getElementById('notifBellWrap');
  var badge = document.getElementById('notifBadge');
  if (wrap)  wrap.style.display  = memberLoggedIn ? 'inline-block' : 'none';
  if (badge) { badge.textContent = n > 9 ? '9+' : String(n||''); badge.style.display = n ? 'flex' : 'none'; }
  // Mobile bell tab
  var mnNotif = document.getElementById('mn-notif');
  var mnDot   = document.getElementById('mn-notif-dot');
  if (mnNotif) mnNotif.style.display = memberLoggedIn ? '' : 'none';
  if (mnDot)   mnDot.style.display   = n ? '' : 'none';
}

function toggleNotifPanel() {
  if (!IN_APP_STATUS_NOTIFICATIONS_ENABLED) return;
  var panel = document.getElementById('notifPanel');
  if (panel && panel.classList.contains('open')) { closeNotifPanel(); } else { openNotifPanel(); }
}

async function openNotifPanel() {
  if (!IN_APP_STATUS_NOTIFICATIONS_ENABLED) return;
  await loadDismissedNotifsRemote();
  _loadNotifData();
  // Sync history from current myBookings so nothing is missed
  myBookings.forEach(function(b) {
    if (b.status === 'confirmed' || b.status === 'rejected') _recordNotif(b);
  });
  // Render BEFORE marking seen (so unseen items get highlighted)
  var list = document.getElementById('notifPanelList');
  if (list) {
    if (!_notifHistory.length) {
      list.innerHTML = '<div class="np-empty">No notifications yet.<br><span style="font-size:.8rem">When your bookings are confirmed or rejected, they\'ll appear here.</span></div>';
    } else {
      list.innerHTML = _notifHistory.filter(function(h){ return !_notifDismissedIds.has(String(h.id)); }).map(function(h) {
        var isConf   = h.status === 'confirmed';
        var unseen   = _notifSeenMap[h.id] !== h.status;
        var icon     = isConf ? '' : '';
        var titleTxt = isConf ? 'Slot Confirmed!' : 'Slot Rejected';
        var cls      = (unseen ? 'unseen ' : '') + (isConf ? 'confirmed-item' : 'rejected-item');
        var tcls     = isConf ? 'confirmed-text' : 'rejected-text';
        return '<div class="np-item ' + cls + '" id="npi-' + h.id + '">' +
          '<div class="np-item-icon" onclick="closeNotifPanel();showPage(\'myrequests\')">' + icon + '</div>' +
          '<div class="np-item-body" onclick="closeNotifPanel();showPage(\'myrequests\')">' +
            '<div class="np-item-title ' + tcls + '">' + titleTxt + '</div>' +
            '<div class="np-item-sub">' + (h.venue||'your venue') + (h.date ? ' - ' + h.date : '') + '</div>' +
            '<div class="np-item-time">Booking #' + (h.id||'-') + '</div>' +
          '</div>' +
          '<button class="np-item-dismiss" onclick="event.stopPropagation();dismissNotif(' + h.id + ')" title="Dismiss">x</button>' +
        '</div>';
      }).join('');
    }
  }
  // Mark all as seen
  myBookings.forEach(function(b) { if (b.status === 'confirmed' || b.status === 'rejected') _notifSeenMap[b.id] = b.status; });
  _saveNotifData();
  document.getElementById('notifOverlay').style.display = '';
  document.getElementById('notifPanel').classList.add('open');
  updateNotifBadge();
}

function closeNotifPanel() {
  var panel = document.getElementById('notifPanel');
  if (panel) panel.classList.remove('open');
  setTimeout(function(){ var o=document.getElementById('notifOverlay'); if(o) o.style.display='none'; }, 420);
  if (IN_APP_STATUS_NOTIFICATIONS_ENABLED) updateNotifBadge();
}

function clearAllNotifs() {
  var ids = [];
  _notifHistory.forEach(function(h){ if (h.id != null) ids.push(String(h.id)); });
  myBookings.forEach(function(b){
    if (b.status === 'confirmed' || b.status === 'rejected') {
      _notifSeenMap[b.id] = b.status;
      ids.push(String(b.id));
    }
  });
  ids.forEach(function(id){ _notifDismissedIds.add(id); });
  _notifHistory = [];
  _saveNotifData();
  saveDismissedNotifsRemote(Array.from(new Set(ids)));
  var list = document.getElementById('notifPanelList');
  if (list) list.innerHTML = '<div class="np-empty">All cleared.<br><span style="font-size:.8rem">Future status changes will appear here.</span></div>';
  updateNotifBadge();
}

function dismissNotif(id) {
  _notifDismissedIds.add(String(id));
  _notifHistory = _notifHistory.filter(function(h){ return String(h.id) !== String(id); });
  _notifSeenMap[id] = 'dismissed';
  _saveNotifData();
  saveDismissedNotifsRemote([String(id)]);
  var el = document.getElementById('npi-' + id);
  if (el) { el.style.transition = 'opacity .2s, max-height .25s'; el.style.opacity = '0'; el.style.maxHeight = '0'; el.style.overflow = 'hidden'; el.style.padding = '0'; setTimeout(function(){ el.remove(); }, 260); }
  if (!_notifHistory.length) {
    var list = document.getElementById('notifPanelList');
    if (list) list.innerHTML = '<div class="np-empty">All cleared.<br><span style="font-size:.8rem">Future status changes will appear here.</span></div>';
  }
  updateNotifBadge();
}

// ========================================
// DB MIGRATIONS (run once on startup)
// ========================================
const MIGRATION_VERSION = '2026-05-27-late-point-grace-1';
async function runMigrations(force) {
  try { if (!force && localStorage.getItem('ots_migration_version') === MIGRATION_VERSION) return; } catch(e) {}
  const run = async (sql) => { try { await neonSQL(sql); } catch(e) { console.warn('Migration skipped:', e && (e.message||e)); } };
  await run("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT DEFAULT '')");
  await run("ALTER TABLE venues   ADD COLUMN IF NOT EXISTS image_url     TEXT    DEFAULT ''");
  await run("ALTER TABLE venues   ADD COLUMN IF NOT EXISTS landmark      TEXT    DEFAULT ''");
  await run("ALTER TABLE venues   ADD COLUMN IF NOT EXISTS map_url       TEXT    DEFAULT ''");
  await run("ALTER TABLE venues   ADD COLUMN IF NOT EXISTS venue_type    TEXT    DEFAULT ''");
  await run("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS email         TEXT    DEFAULT ''");
  await run("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booked_by     TEXT    DEFAULT ''");
  await run("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS push_token    TEXT    DEFAULT ''");
  await run("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS visibility    TEXT    DEFAULT 'Public'");
  await run("UPDATE bookings SET visibility='Public' WHERE LOWER(COALESCE(visibility,''))='private'");
  await run("UPDATE venues SET visibility='Public' WHERE LOWER(COALESCE(visibility,''))='private'");
  await run("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS proof_url     TEXT    DEFAULT ''");
  await run("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS proof_claimed BOOLEAN DEFAULT false");
  await run("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS performers TEXT DEFAULT '[]'");
  await run("CREATE TABLE IF NOT EXISTS claims (id SERIAL PRIMARY KEY, booking_id TEXT NOT NULL, member_phone TEXT NOT NULL, member_name TEXT DEFAULT '', status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())");
  await run("ALTER TABLE claims ALTER COLUMN booking_id TYPE TEXT USING booking_id::TEXT");
  await run("CREATE TABLE IF NOT EXISTS admins (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT DEFAULT 'admin', active BOOLEAN DEFAULT true, created_at TIMESTAMP DEFAULT NOW())");
  await run("ALTER TABLE admins ADD COLUMN IF NOT EXISTS permissions TEXT DEFAULT '{}'");
  await run("CREATE TABLE IF NOT EXISTS admin_logs (id SERIAL PRIMARY KEY, admin_username TEXT NOT NULL, action TEXT NOT NULL, details TEXT DEFAULT '', created_at TIMESTAMP DEFAULT NOW())");
  // Seed the original superadmin so existing installs keep working
  await run("INSERT INTO admins (username, password, role) VALUES ('admin','ots2024','superadmin') ON CONFLICT (username) DO NOTHING");
  await run("ALTER TABLE members ADD COLUMN IF NOT EXISTS email TEXT DEFAULT ''");
  await run("ALTER TABLE members ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT ''");
  await run("ALTER TABLE members ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT ''");
  await run("ALTER TABLE members ADD COLUMN IF NOT EXISTS genre TEXT DEFAULT ''");
  await run("ALTER TABLE members ADD COLUMN IF NOT EXISTS instrument TEXT DEFAULT ''");
  await run("ALTER TABLE members ADD COLUMN IF NOT EXISTS role_type TEXT DEFAULT ''");
  await run("ALTER TABLE members ADD COLUMN IF NOT EXISTS instagram TEXT DEFAULT ''");
  await run("ALTER TABLE members ADD COLUMN IF NOT EXISTS blood_group TEXT DEFAULT ''");
  await run("ALTER TABLE members ADD COLUMN IF NOT EXISTS date_of_birth TEXT DEFAULT ''");
  await run("ALTER TABLE members ADD COLUMN IF NOT EXISTS address TEXT DEFAULT ''");
  await run("ALTER TABLE members ADD COLUMN IF NOT EXISTS zone_current TEXT DEFAULT ''");
  await run("ALTER TABLE members ADD COLUMN IF NOT EXISTS zone_request TEXT DEFAULT ''");
  await run("ALTER TABLE members ADD COLUMN IF NOT EXISTS zone_request_reason TEXT DEFAULT ''");
  await run("ALTER TABLE members ADD COLUMN IF NOT EXISTS zone_request_status TEXT DEFAULT ''");
  await run("ALTER TABLE members ADD COLUMN IF NOT EXISTS id_proof_type TEXT DEFAULT ''");
  await run("ALTER TABLE members ADD COLUMN IF NOT EXISTS id_proof_number TEXT DEFAULT ''");
  await run("ALTER TABLE members ADD COLUMN IF NOT EXISTS id_proof_url TEXT DEFAULT ''");
  await run("ALTER TABLE claims ADD COLUMN IF NOT EXISTS claim_type TEXT DEFAULT 'show'");
  await run("ALTER TABLE claims ADD COLUMN IF NOT EXISTS reason TEXT DEFAULT ''");
  await run("ALTER TABLE claims ADD COLUMN IF NOT EXISTS zone_name TEXT DEFAULT ''");
  await run("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkin_at TIMESTAMPTZ");
  await run("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkin_lat DOUBLE PRECISION");
  await run("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkin_lng DOUBLE PRECISION");
  await run("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkin_accuracy DOUBLE PRECISION");
  await run("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS checkin_map_url TEXT DEFAULT ''");
  await run("ALTER TABLE claims ADD COLUMN IF NOT EXISTS points NUMERIC DEFAULT 1");
  await run("UPDATE claims c SET zone_name=COALESCE(NULLIF(m.zone_current,''),'No Zone') FROM members m WHERE RIGHT(REGEXP_REPLACE(c.member_phone,'[^0-9]','','g'),10)=RIGHT(REGEXP_REPLACE(m.phone,'[^0-9]','','g'),10) AND COALESCE(c.zone_name,'')=''");
  await run("CREATE TABLE IF NOT EXISTS zone_monthly_reports (month_key TEXT NOT NULL, zone_name TEXT NOT NULL, total_points NUMERIC DEFAULT 0, member_count INTEGER DEFAULT 0, rank INTEGER DEFAULT 0, saved_at TIMESTAMPTZ DEFAULT NOW(), saved_by TEXT DEFAULT '', PRIMARY KEY(month_key, zone_name))");
  await recalcLateGraceApprovedClaims();
  await run("CREATE TABLE IF NOT EXISTS dismissed_requests (user_key TEXT NOT NULL, booking_id TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (user_key, booking_id))");
  await run("CREATE TABLE IF NOT EXISTS dismissed_notifications (user_key TEXT NOT NULL, booking_id TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (user_key, booking_id))");
  await run("CREATE TABLE IF NOT EXISTS member_chats (id TEXT PRIMARY KEY, member_a_phone TEXT NOT NULL, member_b_phone TEXT NOT NULL, member_a_name TEXT DEFAULT '', member_b_name TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), last_message TEXT DEFAULT '')");
  await run("CREATE TABLE IF NOT EXISTS member_chat_messages (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, sender_phone TEXT NOT NULL, sender_name TEXT DEFAULT '', receiver_phone TEXT NOT NULL, body TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), read_at TIMESTAMPTZ)");
  await run("CREATE TABLE IF NOT EXISTS member_chat_blocks (blocker_phone TEXT NOT NULL, blocked_phone TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (blocker_phone, blocked_phone))");
  await run("CREATE INDEX IF NOT EXISTS idx_member_chats_a ON member_chats(member_a_phone)");
  await run("CREATE INDEX IF NOT EXISTS idx_member_chats_b ON member_chats(member_b_phone)");
  await run("CREATE INDEX IF NOT EXISTS idx_member_chat_messages_chat ON member_chat_messages(chat_id, created_at)");
  await run("CREATE INDEX IF NOT EXISTS idx_member_chat_messages_receiver ON member_chat_messages(receiver_phone, read_at)");
  try { localStorage.setItem('ots_migration_version', MIGRATION_VERSION); } catch(e) {}
}

async function init() {
  _loadNotifData();
  loadDismissed();
  updateHeroStats();
  if (otsIsAdminApp()) {
    try {
      await runMigrations();
    } catch(e) {
      console.warn('[OTS] Migration check skipped:', e && (e.message || e));
    }
  }
  // Start polling for cross-device updates (Neon uses polling instead of WebSocket)
  setTimeout(initRealtime, 500);
  // Restore admin session first
  if (otsIsAdminApp()) restoreAdminSession();
  // Restore member session, then fill in any missing phone/email from the members table
  if (otsIsMemberApp()) restoreMemberSession();
  if (memberLoggedIn) { loadDismissedRemote(true).then(function(){ renderUserBookings(); }); loadDismissedNotifsRemote(true).then(updateNotifBadge); }
  enrichMemberSession().then(() => {
    if (memberLoggedIn) { loadDismissedRemote(true).then(function(){ renderUserBookings(); }); loadDismissedNotifsRemote(true).then(updateNotifBadge); }
    // Re-fetch bookings after enrichment in case phone/email was just filled in
    if (memberLoggedIn) restoreMyBookingsFromServer();
  }).catch(()=>{});

  // Start admin live polling if already logged in
  if (adminLoggedIn) startAdminPolling();

  if (otsIsAdminApp()) {
    document.getElementById('memberLoginPage').classList.add('hidden');
    if (adminLoggedIn) {
      document.getElementById('loginPage').classList.remove('show');
      showPage('admin');
      refreshAdmin();
    } else {
      document.getElementById('loginPage').classList.add('show');
      setTimeout(()=>{ const u=document.getElementById('loginUser'); if(u) u.focus(); },200);
    }
    return;
  }

  if (adminLoggedIn) {
    // Admin is logged in - skip member login, go straight to admin panel
    openAdminEntry('#admin');
  } else if (!memberLoggedIn) {
    // Show member login page - it is the first screen
    document.getElementById('memberLoginPage').classList.remove('hidden');
    setTimeout(()=>{ const p=document.getElementById('mlPhone'); if(p) p.focus(); },200);
  } else {
    // Member already logged in - hide the login overlay explicitly
    document.getElementById('memberLoginPage').classList.add('hidden');
    // Restore where they were or go to venues
    try {
      const hashPage = otsPublicPageFromHash();
      const savedPage = localStorage.getItem('ots_current_page');
      const savedVenueId = localStorage.getItem('ots_selected_venue');
      if (savedVenueId) selectedVenueId = savedVenueId;
      if (hashPage) {
        showPage(hashPage);
      } else if (savedPage && ['home','venues','form','myrequests','leaderboard','profile','chat'].includes(savedPage)) {
        showPage(savedPage);
      } else {
        showPage('home');
      }
    } catch(e) { showPage('home'); }
  }
  if (memberLoggedIn) loadData();
}
// Also keep renderVenues stub for admin compatibility
function renderVenues() {}

// =======================================
// DATES
// =======================================
function renderDates() {
  // Always make sure selectedDate is initialised so booking flow works
  if (!selectedDate) selectedDate = new Date().toISOString().split('T')[0];
  // The date strip element was removed from the DOM in a refactor.
  // Look it up safely; if it isn't on the page, just bail out instead of crashing.
  const strip = document.getElementById('dateStrip');
  if (!strip) return;
  const today = new Date();
  const days  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let html='';
  for (let i=0;i<14;i++) {
    const d = new Date(today); d.setDate(today.getDate()+i);
    const key = d.toISOString().split('T')[0];
    html+=`<button class="date-btn ${selectedDate===key?'active':''}" onclick="selectDate('${key}')">
      <span class="db-day">${days[d.getDay()]}</span>
      <span class="db-num">${d.getDate()}</span>
      <span class="db-dot"></span>
    </button>`;
  }
  strip.innerHTML=html;
}
function selectDate(key) { selectedDate=key; renderDates(); updateSummary(); validateForm(); }

// =======================================
// SUMMARY
// =======================================
function updateSummary() {
  const venue = venues.find(v=>v.id===selectedVenueId);
  const team  = document.getElementById('inp-band')?.value.trim() || '';
  const booker = document.getElementById('inp-booker')?.value.trim() || '';
  const type  = document.getElementById('inp-type').value;
  const set   = (id,val,fb)=>{
    const el=document.getElementById(id);
    if(val){el.textContent=val;el.classList.remove('empty');}
    else{el.textContent=fb;el.classList.add('empty');}
  };
  set('sum-venue',venue?.name,'Not selected');
  set('sum-booker',booker||null,'Not selected');
  set('sum-team',team||null,'Not selected');
  set('sum-type',type||null,'Not selected');
  set('sum-price',venue ? `${venue.day||''} ${formatDateShort(venue.date)} - ${formatVenueTimeRange(venue)}` : null,'-');
}
function formatDate(iso) {
  if (!iso) return '-';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const parts = iso.split('-');
  if (parts.length === 3) return `${parts[2]} ${months[parseInt(parts[1],10)-1]} ${parts[0]}`;
  return iso;
}

// =======================================
// PHONE VALIDATION
// =======================================
function isValidPhone(val) {
  // strips spaces, dashes, dots, brackets, plus - must end up 7-15 digits
  const digits = val.replace(/[\s\-\.\(\)\+]/g,'');
  return /^\d{7,15}$/.test(digits);
}
function validatePhone() {
  const inp = document.getElementById('inp-phone');
  const err = document.getElementById('phone-err');
  const ico = document.getElementById('phone-icon');
  const val = inp.value.trim();
  if (!val) {
    inp.classList.remove('err','ok'); err.textContent=''; ico.textContent='';
  } else if (!isValidPhone(val)) {
    inp.classList.add('err'); inp.classList.remove('ok');
    err.textContent = ' Invalid number - use digits only, 7-15 characters (e.g. +91 98765 43210)';
    ico.textContent = '';
  } else {
    inp.classList.add('ok'); inp.classList.remove('err');
    err.textContent = ''; ico.textContent = '';
  }
  validateForm();
}
function validatePhoneBlur() {
  const val = document.getElementById('inp-phone').value.trim();
  if (val && !isValidPhone(val)) {
    document.getElementById('phone-err').textContent = ' Please enter a valid phone number before submitting.';
  }
}

// =======================================
// VALIDATION
// =======================================
function validateForm() {
  const band  = document.getElementById('inp-band').value.trim();
  const booker = document.getElementById('inp-booker')?.value.trim() || '';
  const phone = document.getElementById('inp-phone').value.trim();
  const type  = document.getElementById('inp-type').value;
  const venue = venues.find(v=>v.id===selectedVenueId);
  const blockedSlot = venue ? getVenueSlotBlockingBooking(venue) : null;
  const ok = selectedVenueId && venue && !isVenueBeforeToday(venue) && !blockedSlot && band && booker && isValidPhone(phone) && type;
  document.getElementById('bookBtn').disabled = !ok;
}
['inp-booker','inp-band','inp-type'].forEach(id=>
  document.getElementById(id)?.addEventListener('input',()=>{validateForm();updateSummary();})
);

// =======================================
// SUBMIT BOOKING
// =======================================
async function submitBooking() {
  const venue = venues.find(v=>v.id===selectedVenueId);
  if (!venue) {
    showToast('', 'Select Venue', 'Please select a venue before booking.');
    validateForm();
    return;
  }
  if (isVenueBeforeToday(venue)) {
    showToast('', 'Booking Closed', 'This venue date is over and cannot be booked now.');
    selectedVenueId = null;
    try { localStorage.removeItem('ots_selected_venue'); } catch(e){}
    updateSummary();
    validateForm();
    showPage('venues');
    return;
  }
  var cachedBlockingBooking = getVenueSlotBlockingBooking(venue);
  if (cachedBlockingBooking) {
    showVenueSlotBlockedNotice(venue, cachedBlockingBooking);
    selectedVenueId = null;
    try { localStorage.removeItem('ots_selected_venue'); } catch(e){}
    renderVenueList();
    updateSummary();
    validateForm();
    showPage('venues');
    return;
  }
  try {
    var liveBlockingBooking = await fetchLiveVenueSlotBlockingBooking(venue);
    if (liveBlockingBooking) {
      showVenueSlotBlockedNotice(venue, liveBlockingBooking);
      selectedVenueId = null;
      try { localStorage.removeItem('ots_selected_venue'); } catch(e){}
      await refreshLiveCoreData({ maxAgeMs: 0, showLoading: false, silentIfCached: true }).catch(function(){});
      renderVenueList();
      updateSummary();
      validateForm();
      showPage('venues');
      return;
    }
  } catch(e) {
    console.warn('[OTS] slot availability check failed:', e && (e.message || e));
    showToast('', 'Please Try Again', 'Could not confirm the latest slot status. Check once and submit again.');
    validateForm();
    return;
  }
  const formEmail = (document.getElementById('inp-email') ? document.getElementById('inp-email').value.trim() : '');
  const formPhone = (document.getElementById('inp-phone') ? document.getElementById('inp-phone').value.trim() : '');
  const bookedBy = (document.getElementById('inp-booker') ? document.getElementById('inp-booker').value.trim() : '') || memberName || memberEmail || memberPhone || '';
  const b = {
    id:        'OTS-'+Math.random().toString(36).substr(2,8).toUpperCase(),
    venueId:   venue.id, venue: venue.name,
    date:      venue.date,
    type:      document.getElementById('inp-type').value,
    name:      document.getElementById('inp-band').value.trim(),
    bookedBy:  bookedBy,
    email:     formEmail || memberEmail || '',
    phone:     formPhone || memberPhone || '',
    performers: [{ phone: _normPhone(formPhone || memberPhone || ''), name: document.getElementById('inp-band').value.trim() || memberName || bookedBy }],
    notes:     document.getElementById('inp-notes').value.trim(),
    price:     0,
    visibility: venue.visibility || 'Public',
    status:    'pending',
    createdAt: new Date().toISOString(),
    pushToken: _nativePushToken || '',
  };

  // Optimistically update UI immediately
  allBookings.unshift(b);
  myBookings.unshift(b);
  _lastKnownStatuses[b.id] = 'pending';
  saveLocal(); // save to localStorage right away
  showConfirmModalFn(b);
  renderUserBookings();
  renderVenues();
  updateHeroStats();
  updatePendingBadge();
  startStatusPolling();

  // Write directly to Neon NOW (no debounce) so admin sees it immediately
  try {
    await sbUpsert('bookings', [{
      id: b.id, venue_id: b.venueId, venue: b.venue,
      date: b.date, type: b.type, name: b.name,
      booked_by: b.bookedBy,
      phone: b.phone, email: b.email, notes: b.notes,
      performers: stringifyBookingPerformers(b.performers),
      visibility: b.visibility || 'Public',
      status: b.status, created_at: b.createdAt,
      push_token: b.pushToken || _nativePushToken || ''
    }]);
    showSyncStatus(' Request sent','var(--green)');
    notifyAdminNewBooking(b);
    // Immediately refresh admin queue so new booking appears without waiting for poll
    if (adminLoggedIn) { refreshAdmin(); }
  } catch(e) {
    console.error('Failed to sync booking:', e);
    showSyncStatus(' Saved locally - will retry','var(--orange)');
    saveRemote(); // fallback debounced sync
  }

  ['inp-booker','inp-band','inp-phone','inp-notes'].forEach(id=>document.getElementById(id).value='');
  fillBookingFormFromSession();
  document.getElementById('inp-phone').classList.remove('ok','err');
  document.getElementById('phone-err').textContent='';
  document.getElementById('phone-icon').textContent='';
  document.getElementById('inp-type').value='';
  selectedVenueId = null;
  try { localStorage.removeItem('ots_selected_venue'); localStorage.setItem('ots_current_page','venues'); } catch(e){}
  updateSummary(); validateForm();

  // Navigate to dedicated My Requests page after submission
  setTimeout(function() {
    showPage('myrequests');
    setTimeout(function() {
      var bs = document.getElementById('bookingsSection');
      if (bs) { bs.classList.add('highlight'); setTimeout(function(){ bs.classList.remove('highlight'); }, 2200); }
    }, 150);
  }, 300);
  showSyncStatus(' Submitted! Opening My Requests...', 'var(--green)');
}

// =======================================
// USER BOOKING LIST
// =======================================
// Returns days remaining until booking date (negative = past)
function _daysUntil(dateStr) {
  if (!dateStr) return 999;
  var parts = dateStr.split('-');
  if (parts.length !== 3) return 999;
  var bookingDate = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
  var today = new Date(); today.setHours(0,0,0,0);
  return Math.floor((bookingDate - today) / 86400000);
}
function _canWithdrawOnline(dateStr) {
  return _daysUntil(dateStr) > 2;
}
function _cleanPhoneForTel(phone) {
  return String(phone || '').replace(/[^\d+]/g, '');
}
function parseHelpdeskNumbers(raw) {
  return String(raw || '')
    .split(/[\n,;]+/)
    .map(function(x){ return x.trim(); })
    .filter(Boolean);
}
function formatHelpdeskNumbers(numbers) {
  return (numbers || []).filter(Boolean).join('\n');
}
function parseZoneNames(raw) {
  var list = Array.isArray(raw) ? raw : String(raw || '').split(/[\n,;]+/);
  var seen = {};
  var out = [];
  list.forEach(function(x) {
    var v = String(x || '').trim();
    if (!v) return;
    var key = v.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    out.push(v);
  });
  return out.length ? out : ['Zone A','Zone B','Zone C'];
}
function formatZoneNames(names) {
  return parseZoneNames(names || zoneNames).join('\n');
}
function parseCommunityAds(raw) {
  var list = Array.isArray(raw) ? raw : [];
  if (!Array.isArray(raw)) {
    try { list = raw ? JSON.parse(String(raw)) : []; } catch(e) { list = []; }
  }
  return list.map(function(item) {
    item = item || {};
    return {
      id: String(item.id || ('ad_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6))),
      title: String(item.title || '').trim(),
      message: String(item.message || '').trim(),
      link: String(item.link || '').trim(),
      cta: String(item.cta || '').trim(),
      imageUrl: String(item.imageUrl || item.image_url || '').trim(),
      active: item.active !== false,
      createdAt: item.createdAt || new Date().toISOString()
    };
  }).filter(function(item) { return item.title || item.message || item.imageUrl; }).slice(0, 30);
}
function serializeCommunityAds() {
  return JSON.stringify(parseCommunityAds(communityAds));
}
function isActiveZoneName(value) {
  var v = String(value || '').trim();
  return !!(v && parseZoneNames(zoneNames).indexOf(v) !== -1);
}
function applySettingsRows(rows) {
  (rows || []).forEach(function(row) {
    if (row.key === 'admin_phone') adminPhone = row.value || '';
    if (row.key === 'helpdesk_numbers') helpdeskNumbers = parseHelpdeskNumbers(row.value || '');
    if (row.key === 'zone_names') zoneNames = parseZoneNames(row.value || '');
    if (row.key === 'community_ads') communityAds = parseCommunityAds(row.value || '');
  });
  if (!helpdeskNumbers.length && adminPhone) helpdeskNumbers = [adminPhone];
  refreshZoneSelects();
  renderZoneFilter();
  renderHelpdeskContacts();
  renderCommunityAdsHome();
}
function zoneOptionsHtml(selected, includeBlank) {
  var selectedVal = String(selected || '');
  var opts = includeBlank ? '<option value="">- None -</option>' : '<option value="">- Select your zone -</option>';
  parseZoneNames(zoneNames).forEach(function(z) {
    opts += '<option value="' + otsEscapeHtml(z) + '"' + (z === selectedVal ? ' selected' : '') + '>' + otsEscapeHtml(z) + '</option>';
  });
  return opts;
}
function refreshZoneSelects() {
  var pf = document.getElementById('pf-zone');
  if (pf) {
    var val = pf.value || memberZoneCurrent || memberZoneRequest || '';
    pf.innerHTML = zoneOptionsHtml(val, false);
    pf.value = isActiveZoneName(val) ? val : '';
  }
  var ma = document.getElementById('ma-zone-current');
  if (ma) {
    var mv = ma.value || '';
    ma.innerHTML = zoneOptionsHtml(mv, true);
    ma.value = isActiveZoneName(mv) ? mv : '';
  }
}
function getHelpdeskNumbers() {
  var nums = (helpdeskNumbers || []).slice();
  if (adminPhone && nums.indexOf(adminPhone) === -1) nums.unshift(adminPhone);
  return nums.filter(Boolean);
}
function renderHelpdeskContacts() {
  var nums = getHelpdeskNumbers();
  var boxes = document.querySelectorAll('[data-helpdesk-list]');
  boxes.forEach(function(box) {
    if (!nums.length) {
      box.innerHTML = '<div class="ml-reg-hint" style="margin:.4rem 0 0;">Helpdesk number is not configured yet. Please contact admin directly.</div>';
      return;
    }
    box.innerHTML = nums.map(function(num, i) {
      var tel = _cleanPhoneForTel(num);
      var label = i === 0 ? 'Admin / Helpdesk' : ('Helpdesk ' + (i + 1));
      return '<a class="ml-helpdesk-item" href="tel:' + tel + '"><strong>' + label + '</strong><span>' + otsEscapeHtml(num) + '</span></a>';
    }).join('');
  });
}

var _editingCommunityAdId = '';
var _communityAdImageUrl = '';

function renderCommunityAdsHome() {
  var wrap = document.getElementById('communityNewsWrap');
  var strip = document.getElementById('communityNewsStrip');
  if (!wrap || !strip) return;
  var active = parseCommunityAds(communityAds).filter(function(ad){ return ad.active !== false; }).slice(0, 8);
  if (!active.length) {
    wrap.style.display = 'none';
    strip.innerHTML = '';
    return;
  }
  wrap.style.display = '';
  var loopAds = active.length < 4 ? active.concat(active, active) : active.concat(active);
  strip.innerHTML = loopAds.map(function(ad) {
    var cta = ad.cta || (ad.link ? 'View Details' : '');
    var body = '<div class="community-news-card">' +
      (ad.imageUrl ? '<img class="community-news-image" src="' + otsEscapeHtml(ad.imageUrl) + '" alt="' + otsEscapeHtml(ad.title || 'Community update') + '" loading="lazy" decoding="async">' : '') +
      '<div class="community-news-kicker">Update</div>' +
      '<div class="community-news-title">' + otsEscapeHtml(ad.title || 'Community Update') + '</div>' +
      (ad.message ? '<div class="community-news-text">' + otsEscapeHtml(ad.message) + '</div>' : '') +
      (cta ? '<div class="community-news-link">' + otsEscapeHtml(cta) + '</div>' : '') +
    '</div>';
    if (ad.link) {
      return '<a class="community-news-anchor" href="' + otsEscapeHtml(ad.link) + '" target="_blank" rel="noopener">' + body + '</a>';
    }
    return body;
  }).join('');
}

function clearCommunityAdForm() {
  _editingCommunityAdId = '';
  _communityAdImageUrl = '';
  ['communityAdTitle','communityAdMessage','communityAdLink','communityAdCta','communityAdImageInput'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderCommunityAdImagePreview();
  var btn = document.querySelector('.community-ad-actions .btn-primary');
  if (btn) btn.textContent = 'Publish Update';
}

function renderCommunityAdImagePreview() {
  var prev = document.getElementById('communityAdImagePreview');
  if (!prev) return;
  if (!_communityAdImageUrl) {
    prev.style.display = 'none';
    prev.innerHTML = '';
    return;
  }
  prev.style.display = '';
  prev.innerHTML = '<img src="' + otsEscapeHtml(_communityAdImageUrl) + '" alt="News image preview"><span>Image ready</span>';
}

async function handleCommunityAdImageUpload(e) {
  if (!requireAdminPerm('ads', 'community news')) { if (e && e.target) e.target.value = ''; return; }
  var file = e && e.target && e.target.files ? e.target.files[0] : null;
  if (!file) return;
  if (e.target) e.target.value = '';
  if (file.size > 5 * 1024 * 1024) {
    showToast('', 'Too Large', 'Choose an image below 5 MB.');
    return;
  }
  var status = document.getElementById('communityAdStatus');
  if (status) status.textContent = 'Preparing image...';
  try {
    var ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    _communityAdImageUrl = await sbStorageUpload(file, 'community_ad_' + Date.now() + '.' + ext);
    renderCommunityAdImagePreview();
    if (status) status.textContent = 'Image added. Publish to save it.';
  } catch(err) {
    console.error('community ad image upload:', err);
    if (status) status.textContent = 'Could not prepare image.';
    showToast('', 'Image Failed', 'Please try another image.');
  }
}

function removeCommunityAdImage() {
  if (!hasAdminPerm('ads')) return;
  _communityAdImageUrl = '';
  var inp = document.getElementById('communityAdImageInput');
  if (inp) inp.value = '';
  renderCommunityAdImagePreview();
}

async function persistCommunityAds(statusText) {
  var status = document.getElementById('communityAdStatus');
  if (status) status.textContent = 'Saving...';
  await neonSQL("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT DEFAULT '')");
  await neonSQL(
    "INSERT INTO settings (key,value) VALUES ('community_ads',$1) ON CONFLICT (key) DO UPDATE SET value=$1",
    [serializeCommunityAds()]
  );
  renderCommunityAdsHome();
  renderCommunityAdsAdmin();
  if (status) status.textContent = statusText || 'Saved.';
}

async function saveCommunityAd() {
  if (!requireAdminPerm('ads', 'community news')) return;
  var title = (document.getElementById('communityAdTitle') || {}).value || '';
  var message = (document.getElementById('communityAdMessage') || {}).value || '';
  var link = (document.getElementById('communityAdLink') || {}).value || '';
  var cta = (document.getElementById('communityAdCta') || {}).value || '';
  title = title.trim(); message = message.trim(); link = link.trim(); cta = cta.trim();
  if (!title && !message && !_communityAdImageUrl) { showToast('', 'Add Content', 'Enter a title, message or image.'); return; }
  if (link && !/^https?:\/\//i.test(link)) { showToast('', 'Invalid Link', 'Use a full link starting with https://'); return; }
  communityAds = parseCommunityAds(communityAds);
  var existing = communityAds.find(function(ad){ return ad.id === _editingCommunityAdId; });
  if (existing) {
    existing.title = title;
    existing.message = message;
    existing.link = link;
    existing.cta = cta;
    existing.imageUrl = _communityAdImageUrl;
  } else {
    communityAds.unshift({
      id: 'ad_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      title: title,
      message: message,
      link: link,
      cta: cta,
      imageUrl: _communityAdImageUrl,
      active: true,
      createdAt: new Date().toISOString()
    });
  }
  try {
    await persistCommunityAds(existing ? 'Update saved.' : 'Published on the home page.');
    logAdminAction(existing ? 'update_community_ad' : 'create_community_ad', title || message.slice(0, 40)).catch(function(){});
    clearCommunityAdForm();
    showToast('', 'Saved', 'Community update is live.');
  } catch(e) {
    console.error('saveCommunityAd:', e);
    var status = document.getElementById('communityAdStatus');
    if (status) status.textContent = 'Could not save. Please try again.';
    showToast('', 'Save Failed', 'Community update could not be saved.');
  }
}

function editCommunityAd(id) {
  if (!hasAdminPerm('ads')) return;
  var ad = parseCommunityAds(communityAds).find(function(x){ return x.id === id; });
  if (!ad) return;
  _editingCommunityAdId = id;
  var t = document.getElementById('communityAdTitle'); if (t) t.value = ad.title || '';
  var m = document.getElementById('communityAdMessage'); if (m) m.value = ad.message || '';
  var l = document.getElementById('communityAdLink'); if (l) l.value = ad.link || '';
  var c = document.getElementById('communityAdCta'); if (c) c.value = ad.cta || '';
  _communityAdImageUrl = ad.imageUrl || '';
  renderCommunityAdImagePreview();
  var btn = document.querySelector('.community-ad-actions .btn-primary');
  if (btn) btn.textContent = 'Save Changes';
  var editor = document.querySelector('.community-ad-editor');
  if (editor) editor.scrollIntoView({ behavior:'smooth', block:'start' });
}

async function toggleCommunityAd(id) {
  if (!requireAdminPerm('ads', 'community news')) return;
  communityAds = parseCommunityAds(communityAds).map(function(ad) {
    if (ad.id === id) ad.active = !ad.active;
    return ad;
  });
  try { await persistCommunityAds('Visibility updated.'); } catch(e) { showToast('', 'Save Failed', 'Could not update visibility.'); }
}

async function deleteCommunityAd(id) {
  if (!requireAdminPerm('ads', 'community news')) return;
  communityAds = parseCommunityAds(communityAds).filter(function(ad){ return ad.id !== id; });
  if (_editingCommunityAdId === id) clearCommunityAdForm();
  try {
    await persistCommunityAds('Update removed.');
    logAdminAction('delete_community_ad', id).catch(function(){});
  } catch(e) {
    showToast('', 'Delete Failed', 'Could not remove this update.');
  }
}

function renderCommunityAdsAdmin() {
  var el = document.getElementById('communityAdsAdminList');
  if (!el) return;
  var canEdit = hasAdminPerm('ads');
  var ads = parseCommunityAds(communityAds);
  if (!ads.length) {
    el.innerHTML = '<div class="table-empty">No community updates yet.</div>';
    return;
  }
  el.innerHTML = ads.map(function(ad) {
    return '<div class="community-ad-admin-row">' +
      (ad.imageUrl ? '<img class="community-ad-admin-thumb" src="' + otsEscapeHtml(ad.imageUrl) + '" alt="' + otsEscapeHtml(ad.title || 'Community update') + '" loading="lazy" decoding="async">' : '<div class="community-ad-admin-thumb empty">No image</div>') +
      '<div class="community-ad-admin-main">' +
        '<div class="community-ad-admin-title">' + otsEscapeHtml(ad.title || 'Community Update') + '</div>' +
        (ad.message ? '<div class="community-ad-admin-msg">' + otsEscapeHtml(ad.message) + '</div>' : '') +
        (ad.link ? '<a href="' + otsEscapeHtml(ad.link) + '" target="_blank" rel="noopener">' + otsEscapeHtml(ad.link) + '</a>' : '') +
      '</div>' +
      '<div class="community-ad-admin-actions" ' + (canEdit ? '' : 'style="display:none;"') + '>' +
        '<button type="button" onclick="editCommunityAd(\'' + otsJsString(ad.id) + '\')">Edit</button>' +
        '<button type="button" onclick="toggleCommunityAd(\'' + otsJsString(ad.id) + '\')">' + (ad.active ? 'Hide' : 'Show') + '</button>' +
        '<button type="button" class="danger" onclick="deleteCommunityAd(\'' + otsJsString(ad.id) + '\')">Delete</button>' +
      '</div>' +
      '<div class="community-ad-state ' + (ad.active ? 'active' : '') + '">' + (ad.active ? 'Live' : 'Hidden') + '</div>' +
    '</div>';
  }).join('');
}
function _adminContactHtml(label, title) {
  var safePhone = _cleanPhoneForTel(getHelpdeskNumbers()[0] || adminPhone || '');
  if (safePhone) {
    return `<a class="bi-contact-admin" href="tel:${safePhone}" title="${title || 'Contact admin'}">${label || 'Contact Admin'}</a>`;
  }
  return `<span class="bi-contact-admin" title="${title || 'Contact admin'}">${label || 'Contact Admin'}</span>`;
}

function renderUserBookings() {
  var list = document.getElementById('bookingsList');
  if (!list) return;
  var visibleBookings = myBookings.slice();
  if (!visibleBookings.length) {
    list.innerHTML = '<div class="empty-state">No requests yet. Submit your slot above.</div>';
    return;
  }
  // Delegate check-in button clicks (can't use inline onclick safely here)
  list.onclick = function(e) {
    var mapLink = e.target.closest('[data-open-map]');
    if (mapLink) {
      e.preventDefault();
      e.stopPropagation();
      openVenueInMapsForBooking(mapLink.dataset.openMap);
      return;
    }
    var btn = e.target.closest('[data-checkin]');
    if (btn) {
      if (btn.disabled) return;
      btn.disabled = true;
      checkInToShow(btn.dataset.checkin).finally(function(){ btn.disabled = false; });
    }
  };
  list.innerHTML = visibleBookings.map(function(b) {
    var days = _daysUntil(b.date);
    var canCancel = _canWithdrawOnline(b.date); // online withdrawal closes in the last 2 days
    var nearDate  = days >= 0 && days <= 2; // 0-2 days  contact admin
    var isPast    = days < 0;

    // Action area depending on status + date
    var actionHtml = '';
    if (b.status === 'pending') {
      actionHtml = `<button class="bi-edit-name-btn" onclick="editPendingBookingName('${b.id}')" title="Edit performer or band name">Edit Name</button>`;
      if (canEditBookingPerformers(b)) {
        actionHtml += ` <button class="bi-edit-name-btn" onclick="openEditPerformersModal('${b.id}')" title="Edit performance type and members">Edit Type / Members</button>`;
      }
      if (canCancel) {
        actionHtml += `<button class="bi-cancel-btn" onclick="cancelMyRequest('${b.id}','pending')" title="Withdraw request">x Withdraw</button>`;
      } else if (nearDate) {
        actionHtml += _adminContactHtml('Contact Admin', 'Online withdrawal closes 2 days before the show');
      }
    } else if (b.status === 'confirmed') {
      if (b.proofClaimed) {
        // Admin approved  badge + clear
        actionHtml = `<span class="proof-claimed-badge"> Points Claimed</span>
          <button class="bi-cancel-btn" onclick="dismissRequest('${b.id}')" title="Remove from list" style="opacity:.65;margin-top:.35rem;">x Clear</button>`;
      } else if (b.proofUrl) {
        // Photo uploaded but awaiting admin approval
        actionHtml = `<span class="proof-claimed-badge" style="background:rgba(255,200,60,.12);border-color:rgba(255,200,60,.35);color:#ffc83c;"> Awaiting Approval</span>
          <button class="proof-upload-btn" style="margin-top:.35rem;background:rgba(112,186,244,.08);border-color:rgba(112,186,244,.32);color:#70BAF4;" onclick="addMemberClaimFromRequest('${b.id}')"> Add Member</button>`;
      } else {
        // Determine live show timing
        var st = _showTimes(b);
        var _now = new Date();
        var showEnded  = st ? _now > st.end  : isPast;
        var checkedIn  = !!b.checkinAt;
        var checkState = checkInStateForBooking(b, _now);

        if (checkedIn && showEnded) {
          // Show over + checked in  allow photo upload
          actionHtml = `<div style="font-size:.7rem;color:#4ade80;margin-bottom:.35rem;"> Checked in - Show ended</div>
            <button class="proof-upload-btn" onclick="openProofModal('${b.id}','${(b.venue||'').replace(/'/g,"\\'")}')"> Upload Photo</button>
            <button class="proof-upload-btn" style="margin-top:.35rem;background:rgba(112,186,244,.08);border-color:rgba(112,186,244,.32);color:#70BAF4;" onclick="addMemberClaimFromRequest('${b.id}')"> Add Member</button>`;
        } else if (checkedIn && !showEnded) {
          // Checked in, show still ongoing - wait for it to end
          actionHtml = `<span class="proof-claimed-badge" style="background:rgba(74,222,128,.08);border-color:rgba(74,222,128,.35);color:#4ade80;font-size:.72rem;"> Checked In - Show Ongoing</span>`;
        } else if (showEnded && !checkedIn) {
          actionHtml = `<span style="font-size:.72rem;color:var(--muted);display:block;margin-bottom:.35rem;"> No check-in recorded</span>
            <button class="proof-upload-btn" onclick="openProofModal('${b.id}','${(b.venue||'').replace(/'/g,"\\'")}')"> Add Time & Upload Photo</button>
            <button class="proof-upload-btn" style="margin-top:.35rem;background:rgba(112,186,244,.08);border-color:rgba(112,186,244,.32);color:#70BAF4;" onclick="addMemberClaimFromRequest('${b.id}')"> Add Member</button>
            <button class="bi-cancel-btn" onclick="dismissRequest('${b.id}')" title="Remove from list" style="opacity:.65;">x Clear</button>`;
        } else if (!checkState.can) {
          actionHtml = `<span class="proof-claimed-badge" style="background:rgba(112,186,244,.08);border-color:rgba(112,186,244,.28);color:#70BAF4;font-size:.72rem;"> Upcoming Show</span>`;
          if (canEditBookingPerformers(b)) {
            actionHtml += ` <button class="bi-edit-name-btn" onclick="openEditPerformersModal('${b.id}')" title="Edit performance type and members" style="margin-top:.35rem;">Edit Type / Members</button>`;
          }
          if (checkState.reason) {
            actionHtml += `<div style="font-size:.68rem;color:var(--muted);margin-top:.3rem;">${otsEscapeHtml(checkState.reason)}</div>`;
          }
          if (canCancel) {
            actionHtml += ` <button class="bi-cancel-btn bi-cancel-confirm" onclick="cancelMyRequest('${b.id}','confirmed')" title="Cancel confirmed booking" style="margin-top:.35rem;">Cancel</button>`;
          } else if (nearDate) {
            actionHtml += ' ' + _adminContactHtml('Contact Admin', 'Online cancellation closes 2 days before the show');
          }
        } else {
          // Check-in window is open.
          actionHtml = `<button class="proof-upload-btn" style="background:rgba(74,222,128,.08);border-color:rgba(74,222,128,.35);color:#4ade80;" data-checkin="${b.id}"> I Have Reached</button>`;
          if (canEditBookingPerformers(b)) {
            actionHtml += ` <button class="bi-edit-name-btn" onclick="openEditPerformersModal('${b.id}')" title="Edit performance type and members" style="margin-top:.35rem;">Edit Type / Members</button>`;
          }
          if (checkState.late) {
            actionHtml += `<div style="font-size:.68rem;color:var(--orange);margin-top:.3rem;">Late check-in - total show points will be reduced</div>`;
          } else if (checkState.grace) {
            actionHtml += `<div style="font-size:.68rem;color:var(--blue);margin-top:.3rem;">Practice period - no late point reduction until July 1</div>`;
          }
          if (canCancel) {
            actionHtml += ` <button class="bi-cancel-btn bi-cancel-confirm" onclick="cancelMyRequest('${b.id}','confirmed')" title="Cancel confirmed booking" style="margin-top:.35rem;">Cancel</button>`;
          } else if (nearDate) {
            actionHtml += ' ' + _adminContactHtml('Contact Admin', 'Online cancellation closes 2 days before the show');
          }
        }
      }
    }
    var isCancelled = b.status === 'cancelled';
    // Rejected / cancelled  dismiss button to remove from list
    if (b.status === 'rejected' || isCancelled) {
      actionHtml = `<button class="bi-cancel-btn" onclick="dismissRequest('${b.id}')" title="Remove from list" style="opacity:.75;">x Clear</button>`;
    }

    var isRejected  = b.status === 'rejected';
    var isConfirmed = b.status === 'confirmed';
    var bookedBy = getBookingPersonName(b);

    return `<div class="booking-item${isRejected?' bi-rejected':''}${isConfirmed?' bi-confirmed':''}${isCancelled?' bi-rejected':''}" id="booking-${b.id}">
      <div class="bi-dot ${b.status}"></div>
      <div class="bi-info">
        <button type="button" class="bi-name bi-venue-map" data-open-map="${otsEscapeHtml(b.id)}" title="Open location in Google Maps">${otsEscapeHtml(b.venue || '-')}</button>
        <div class="bi-detail">Team: ${otsEscapeHtml(b.name || '-')}</div>
        ${bookedBy ? `<div class="bi-detail">Booked by: ${otsEscapeHtml(bookedBy)}</div>` : ''}
        <div class="bi-detail">${formatDate(b.date)} - ${b.type}</div>
        ${bookingPerformersText(b) ? `<div class="bi-detail">Performers: ${otsEscapeHtml(bookingPerformersText(b))}</div>` : ''}
        ${isRejected  ? '<div class="bi-status-note bi-note-red"> Not approved this time</div>' : ''}
        ${isCancelled ? '<div class="bi-status-note bi-note-red"> Cancelled</div>' : ''}
        ${isConfirmed ? '<div class="bi-status-note bi-note-green"> Slot confirmed!</div>' : ''}
      </div>
      <div class="bi-right">
        <span class="bi-sbadge ${b.status}">${b.status}</span>
        ${actionHtml}
      </div>
    </div>`;
  }).join('');

  // Show "Clear All" only when there is at least one dismissable entry
  var caBtn = document.getElementById('clearAllBtn');
  if (caBtn) {
    var hasDismissable = visibleBookings.some(function(b) {
      return b.status === 'rejected' || b.status === 'cancelled' ||
             (b.status === 'confirmed' && (b.proofClaimed || _daysUntil(b.date) < 0));
    });
    caBtn.style.display = hasDismissable ? '' : 'none';
  }
}
async function editPendingBookingName(id) {
  var b = myBookings.find(function(x){ return x.id === id; }) || allBookings.find(function(x){ return x.id === id; });
  if (!b) return;
  if (b.status !== 'pending') {
    showToast('', 'Cannot Edit', 'Name changes are allowed only while the slot is pending.');
    return;
  }
  var currentName = (b.name || '').trim();
  var nextName = prompt('Enter performer / band name', currentName);
  if (nextName === null) return;
  nextName = nextName.trim().replace(/\s+/g, ' ');
  if (!nextName) {
    showToast('', 'Name Required', 'Please enter a performer or band name.');
    return;
  }
  if (nextName === currentName) return;

  var local = myBookings.find(function(x){ return x.id === id; });
  var global = allBookings.find(function(x){ return x.id === id; });
  if (local) local.name = nextName;
  if (global) global.name = nextName;
  saveLocal();
  saveMyBookings();
  renderUserBookings();
  try { renderApprovalQueue(); filterTable(); updatePendingBadge(); } catch(e) {}
  showToast('', 'Name Updated', 'Your pending request name has been updated.');

  try {
    await dbPatch('bookings', id, { name: nextName });
    try { renderApprovalQueue(); filterTable(); } catch(e) {}
  } catch(e) {
    console.error('Failed to update booking name:', e);
    showToast('', 'Sync Issue', 'Name changed on this device. Please check internet and try again if admin cannot see it.');
  }
}
function cancelMyRequest(id, type) {
  var localBooking = myBookings.find(function(x){ return x.id === id; }) || allBookings.find(function(x){ return x.id === id; });
  if (localBooking && !_canWithdrawOnline(localBooking.date)) {
    showToast('', 'Contact Admin', 'Online withdrawal closes 2 days before the show. Please contact admin for changes.');
    return;
  }
  var msg = (type === 'confirmed')
    ? 'Cancel your CONFIRMED booking? This cannot be undone.'
    : 'Withdraw this pending request?';
  if (!confirm(msg)) return;

  // Update local state immediately so UI feels instant
  var b = allBookings.find(function(x){ return x.id===id; });
  if (b) b.status = 'cancelled';
  myBookings = myBookings.filter(function(x){ return x.id!==id; });
  saveLocal(); saveMyBookings(); renderUserBookings(); renderVenueList(); updateHeroStats(); updatePendingBadge();

  var label = (type === 'confirmed') ? 'Booking Cancelled' : 'Request Withdrawn';
  var desc  = (type === 'confirmed')
    ? 'Your confirmed slot has been cancelled. The venue is now available.'
    : 'Your slot request has been removed.';
  showToast('', label, desc);

  // Sync cancellation to Neon immediately
  dbPatch('bookings', id, { status: 'cancelled' })
    .catch(function(e){ console.error('Failed to sync cancellation to Neon:', e); });
}

// Remove a single rejected/cancelled entry from the local list (display-only, no DB write needed)
function dismissRequest(id) {
  _dismissedIds.add(String(id));
  saveDismissed();
  saveDismissedRemote([String(id)]);
  myBookings = myBookings.filter(function(x){ return x.id !== id; });
  saveMyBookings();
  renderUserBookings();
  updateNotifBadge();
}

// Clear all dismissable entries - rejected, cancelled, and done confirmed slots
// Pending slots and confirmed slots still needing proof upload are always kept
function clearAllDismissable() {
  if (!confirm('Clear all done, rejected and cancelled requests from your list?')) return;
  var idsToDismiss = [];
  myBookings.forEach(function(b) {
    var isDismissable = b.status === 'rejected' || b.status === 'cancelled' ||
                        (b.status === 'confirmed' && (b.proofClaimed || _daysUntil(b.date) < 0));
    if (isDismissable) { _dismissedIds.add(String(b.id)); idsToDismiss.push(String(b.id)); }
  });
  saveDismissed();
  saveDismissedRemote(idsToDismiss);
  try {
    // Also dismiss persistent bell/history notifications for the same booking ids.
    if (typeof _dismissedNotifs !== 'undefined') {
      _dismissedIds.forEach(function(id){ _dismissedNotifs.add(id); });
      if (typeof _saveDismissedNotifs === 'function') _saveDismissedNotifs();
    }
  } catch(e){}
  myBookings = myBookings.filter(function(b) {
    return b.status === 'pending' ||
           (b.status === 'confirmed' && !b.proofClaimed && _daysUntil(b.date) >= 0);
  });
  saveMyBookings();
  renderUserBookings();
  updateNotifBadge();
  showToast('', 'Cleared', 'Done requests have been removed from your list.');
}

async function restoreClearedRequests() {
  if (!memberLoggedIn) {
    showToast('', 'Member Login Needed', 'Please login to restore cleared requests.');
    return;
  }
  if (!confirm('Restore cleared slot requests back to your list?')) return;
  try {
    _dismissedIds.clear();
    saveDismissed();
    await clearDismissedRemoteForCurrentMember();
    await restoreMyBookingsFromServer();
    await fetchMyBookingsLive();
    renderUserBookings();
    updateNotifBadge();
    showToast('', 'Restored', 'Cleared requests are back in your list.');
  } catch(e) {
    console.error('[OTS] restore cleared requests:', e);
    showToast('', 'Restore Failed', 'Please check internet and try again.');
  }
}

function updateHeroStats() {}
function updatePendingBadge() {
  const n = allBookings.filter(b=>b.status==='pending').length;
  const badge = document.getElementById('pending-count-badge');
  if (badge) { badge.textContent = n; badge.style.display = (adminLoggedIn && n>0) ? 'inline-flex' : 'none'; }
  const qb = document.getElementById('queue-badge');
  if (qb) { qb.textContent=n; qb.style.display=(adminLoggedIn && n>0)?'inline-flex':'none'; }
  if (document.getElementById('approval-count-label'))
    document.getElementById('approval-count-label').textContent = n+' pending';
  // Mobile bottom nav dot: show when member has pending requests
  var dot = document.getElementById('mn-dot');
  if (dot) {
    var myPending = myBookings.filter(function(b){ return b.status==='pending'; }).length;
    dot.style.display = (memberLoggedIn && myPending > 0) ? '' : 'none';
  }
  var mnChat = document.getElementById('mn-chat');
  if (mnChat) mnChat.style.display = memberLoggedIn ? '' : 'none';
  if (memberLoggedIn) updateChatUnreadBadge(false);
}

// =======================================
// ADMIN - REFRESH
// =======================================
function setAdminLoadingState(isLoading, message) {
  _adminDataLoading = !!isLoading;
  var sub = document.querySelector('#page-admin .admin-sub');
  if (sub) sub.textContent = isLoading ? (message || 'Loading live admin data...') : 'Manage venues, approve requests - On The Streets';
  if (currentAdminTab === 'venues') renderVenueManager();
  if (currentAdminTab === 'bookings') filterTable();
}

function refreshAdmin(attempt) {
  attempt = attempt || 0;
  var seq = ++_adminRefreshSeq;
  clearTimeout(_adminRetryTimer);
  setAdminLoadingState(true, attempt ? 'Retrying live admin data...' : 'Loading live admin data...');
  var tab = currentAdminTab || 'venues';
  if (tab === 'approvals') tab = 'venues';
  var reportMonthKey = tab === 'reports' ? getMonthlyReportMonthKeyForLoad() : '';
  var loadVenues = ['venues','import','bookings','reports','superadmin'].indexOf(tab) > -1;
  var loadBookings = ['venues','bookings','claims','points','reports','superadmin'].indexOf(tab) > -1;
  if (tab === 'members') loadMembers().catch(function(){});
  if (tab === 'photos') loadPerfPhotos().catch(function(){});

  var tasks = [];
  if (loadVenues) tasks.push({ key:'venues', promise:neonSQL('SELECT id,name,day,date,time_start,time_end,confirm_status,visibility,status,venue_type,landmark,map_url,image_url FROM venues ORDER BY date ASC, time_start ASC') });
  if (loadBookings) {
    var bookingCols = 'id,venue_id,venue,date,type,name,booked_by,phone,email,notes,visibility,status,created_at,' + LIGHT_PROOF_SQL + ',proof_claimed,checkin_at,checkin_lat,checkin_lng,checkin_accuracy,checkin_map_url,performers';
    if (tab === 'reports' && reportMonthKey) {
      tasks.push({
        key:'reportBookings',
        monthKey:reportMonthKey,
        promise:neonSQL('SELECT ' + bookingCols + ' FROM bookings WHERE LEFT(date::TEXT, 7)=$1 ORDER BY date ASC, created_at DESC LIMIT 5000', [reportMonthKey])
      });
    } else {
      tasks.push({ key:'bookings', promise:neonSQL('SELECT ' + bookingCols + ' FROM bookings ORDER BY created_at DESC LIMIT 1000') });
    }
  }
  if (!tasks.length) {
    setAdminLoadingState(false);
    _refreshAdminUI();
    return Promise.resolve();
  }

  return Promise.allSettled(tasks.map(function(t){ return t.promise; })).then(function(results){
    if (seq !== _adminRefreshSeq) return;
    var gotAnyLiveData = false;
    var needsRetry = false;
    results.forEach(function(result, i) {
      var task = tasks[i];
      var key = task.key;
      if (result.status === 'fulfilled') {
        if (key === 'venues') {
          var mappedVenues = mapVenueRows(result.value || []);
          if (currentAdminTab === 'reports' && !mappedVenues.length && venues.length && attempt < 3) {
            needsRetry = true;
          } else {
            venues = mappedVenues;
          }
        }
        if (key === 'bookings') {
          var mappedBookings = mapBookingRows(result.value || []);
          if (currentAdminTab === 'reports' && !mappedBookings.length && allBookings.length && attempt < 3) {
            needsRetry = true;
          } else {
            allBookings = mappedBookings;
          }
        }
        if (key === 'reportBookings') {
          var mappedReportBookings = mapBookingRows(result.value || []);
          var cachedReportCount = countCachedBookingsForMonth(task.monthKey);
          if (!mappedReportBookings.length && cachedReportCount) {
            needsRetry = true;
            _monthlyReportLoadFailedMonthKey = task.monthKey || '';
          } else if (!mappedReportBookings.length && attempt < 2) {
            needsRetry = true;
          } else {
            var mergedReportRows = mergeMonthlyReportBookings(mappedReportBookings, task.monthKey);
            if (mergedReportRows !== false) _monthlyReportLoadedMonthKey = task.monthKey || '';
          }
        }
        gotAnyLiveData = true;
      } else {
        console.warn('[OTS] admin ' + key + ' load failed:', result.reason && (result.reason.message || result.reason));
        if ((key === 'venues' && !venues.length) || (key === 'bookings' && !allBookings.length)) needsRetry = true;
        if (key === 'reportBookings') needsRetry = true;
      }
    });
    if (gotAnyLiveData) {
      saveLocal();
      if (needsRetry && attempt < 3) {
        setAdminLoadingState(true, 'Still loading live admin data...');
        _refreshAdminUI();
        _adminRetryTimer = setTimeout(function(){ refreshAdmin(attempt + 1); }, 1200 + (attempt * 1200));
      } else {
        if (currentAdminTab === 'reports' && needsRetry && reportMonthKey) {
          _monthlyReportLoadFailedMonthKey = reportMonthKey;
        }
        setAdminLoadingState(false);
        _refreshAdminUI();
        showSyncStatus(' Admin data updated','var(--green)');
      }
    } else {
      throw new Error('Admin live data did not respond');
    }
  }).catch(function(e){
    if (seq !== _adminRefreshSeq) return;
    console.warn('[OTS] refreshAdmin failed:', e && (e.message || e));
    if (attempt < 3) {
      _adminRetryTimer = setTimeout(function(){ refreshAdmin(attempt + 1); }, 1200 + (attempt * 1200));
    } else {
      if (currentAdminTab === 'reports' && reportMonthKey) {
        _monthlyReportLoadFailedMonthKey = reportMonthKey;
      }
      setAdminLoadingState(false);
      _refreshAdminUI();
      showSyncStatus(' Could not refresh admin data','var(--orange)');
    }
  });
}
function _refreshAdminUI() {
  updateAdminStats();
  updatePendingBadge();
  if (currentAdminTab==='venues')    renderVenueManager();
  if (currentAdminTab==='bookings')  filterTable();
  if (currentAdminTab==='reports')   generateMonthlyReportPreview(false);
}

let _adminSelfHealTimer = null;
function scheduleAdminSelfHeal(reason) {
  if (!adminLoggedIn) return;
  clearTimeout(_adminSelfHealTimer);
  _adminSelfHealTimer = setTimeout(function(){
    console.log('[OTS] Admin self-heal refresh:', reason || 'refresh');
    refreshAdmin();
  }, 650);
}

window.addEventListener('online', function(){ scheduleAdminSelfHeal('network online'); });
document.addEventListener('visibilitychange', function(){
  if (!document.hidden) scheduleAdminSelfHeal('app visible');
});
window.addEventListener('unhandledrejection', function(e){
  var msg = String((e && e.reason && (e.reason.message || e.reason)) || '');
  if (/Neon|fetch|network|Failed to fetch|timed out/i.test(msg)) scheduleAdminSelfHeal('live data error');
});

function switchAdminTab(tab) {
  if (tab === 'approvals') tab = 'venues'; // redirect removed tab
  if ((tab === 'settings' || tab === 'superadmin') && !isCurrentSuperAdmin()) {
    showToast('', 'Super Admin Only', 'Only the Super Admin can open Settings.');
    tab = 'venues';
  }
  currentAdminTab = tab;
  closeAdminNotifPanel();
  updateAdminNotifCount();
  ['venues','import','bookings','claims','photos','ads','members','points','reports','errors','settings','superadmin'].forEach(t => {
    var tbtn = document.getElementById(t==='superadmin' ? 'atab-superadmin-btn' : 'atab-'+t);
    var pane = document.getElementById('atab-content-'+t);
    if (tbtn) tbtn.classList.toggle('active', t===tab);
    if (pane) pane.style.display = t===tab ? 'block' : 'none';
  });
  syncAdminUploadInputsForTab(tab);
  if (tab==='venues')      renderVenueManager();
  if (tab==='bookings')    filterTable();
  if (tab==='claims')      loadAdminClaims();
  if (tab==='photos')      { renderPhotoManager(); loadPerfPhotos(); }
  if (tab==='ads')         renderCommunityAdsAdmin();
  if (tab==='members')     loadMembers();
  if (tab==='points')      { initZoneMonthInputs(); loadZoneMonthlyReport(); loadZoneWinningHistory(); loadWithdrawList(); }
  if (tab==='reports')     { initMonthlyReportControls(); generateMonthlyReportPreview(true); }
  if (tab==='errors')      loadClientErrorReports();
  if (tab==='settings')    {
    var ph=document.getElementById('settings-admin-phone'); if(ph) ph.value=adminPhone||'';
    var hd=document.getElementById('settings-helpdesk-numbers'); if(hd) hd.value=formatHelpdeskNumbers(helpdeskNumbers);
    var zn=document.getElementById('settings-zone-names'); if(zn) zn.value=formatZoneNames(zoneNames);
  }
  if (tab==='superadmin')  loadSuperAdminData();
  _applySuperAdminVisibility();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function syncAdminUploadInputsForTab(tab) {
  var uploadInputs = {
    csvFileInput: tab === 'import',
    photoFileInput: tab === 'photos',
    communityAdImageInput: tab === 'ads',
    memberCsvInput: tab === 'members',
    'zone-csv-file': tab === 'points'
  };
  Object.keys(uploadInputs).forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.disabled = !uploadInputs[id];
    el.style.pointerEvents = uploadInputs[id] ? '' : 'none';
  });
}

var _safeFileInputId = '';
var _safeFileInputUntil = 0;
var _adminAccessDisabledFileInputs = [];

function isAdminAccessControlModalOpen() {
  var access = document.getElementById('adminAccessModal');
  var create = document.getElementById('createAdminModal');
  return !!((access && access.classList.contains('show')) || (create && create.classList.contains('show')));
}

function setAdminAccessControlModalOpen(enable) {
  try { document.body.classList.toggle('admin-access-control-open', !!enable); } catch(e) {}
  if (enable) {
    _safeFileInputId = '';
    _safeFileInputUntil = 0;
    if (!_adminAccessDisabledFileInputs.length) {
      try {
        document.querySelectorAll('input[type="file"]').forEach(function(input) {
          _adminAccessDisabledFileInputs.push({
            el: input,
            disabled: !!input.disabled,
            tabindex: input.getAttribute('tabindex'),
            ariaHidden: input.getAttribute('aria-hidden')
          });
          input.disabled = true;
          input.setAttribute('tabindex', '-1');
          input.setAttribute('aria-hidden', 'true');
        });
      } catch(e) {}
    }
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch(e) {}
    return;
  }
  _adminAccessDisabledFileInputs.forEach(function(item) {
    if (!item || !item.el) return;
    item.el.disabled = item.disabled;
    if (item.tabindex === null) item.el.removeAttribute('tabindex');
    else item.el.setAttribute('tabindex', item.tabindex);
    if (item.ariaHidden === null) item.el.removeAttribute('aria-hidden');
    else item.el.setAttribute('aria-hidden', item.ariaHidden);
  });
  _adminAccessDisabledFileInputs = [];
}

function isUploadTriggerElement(el) {
  if (!el || !el.closest) return false;
  return !!el.closest('input[type="file"], label[for], [onclick*="openFileInputSafely"], .csv-import-zone, .member-phone-import-zone, .photo-drop-zone, .id-proof-upload-area, .btn-upload-photo, .community-ad-image-btn, .proof-file-label');
}

function isInsideVisibleModal(el) {
  if (!el || !el.closest) return false;
  return !!el.closest('.modal-overlay.show, .monthly-report-edit-modal.show');
}

function blockEvent(event) {
  if (!event) return false;
  event.preventDefault();
  event.stopPropagation();
  if (event.stopImmediatePropagation) event.stopImmediatePropagation();
  return false;
}

function openFileInputSafely(id) {
  if (isAdminAccessControlModalOpen()) return false;
  var el = document.getElementById(id);
  if (!el || el.disabled) return false;
  _safeFileInputId = id;
  _safeFileInputUntil = Date.now() + 1200;
  try { el.click(); } catch(e) {}
  setTimeout(function() {
    if (_safeFileInputId === id && Date.now() >= _safeFileInputUntil) {
      _safeFileInputId = '';
      _safeFileInputUntil = 0;
    }
  }, 1300);
  return false;
}

function isVisibleFileInputForActiveArea(input) {
  if (!input || input.disabled) return false;
  var style = window.getComputedStyle ? window.getComputedStyle(input) : null;
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  var rect = input.getBoundingClientRect ? input.getBoundingClientRect() : null;
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  var id = input.id || '';
  if (id === 'csvFileInput') return currentAdminTab === 'import';
  if (id === 'memberCsvInput') return currentAdminTab === 'members';
  if (id === 'zone-csv-file') return currentAdminTab === 'points';
  return false;
}

document.addEventListener('click', function(event) {
  var target = event.target;
  if (document.body.classList.contains('modal-lock') && isUploadTriggerElement(target) && !isInsideVisibleModal(target)) {
    return blockEvent(event);
  }
  if (isAdminAccessControlModalOpen() && isUploadTriggerElement(target)) {
    return blockEvent(event);
  }
  if (!target || !target.matches || !target.matches('input[type="file"]')) return;
  if (isAdminAccessControlModalOpen()) {
    return blockEvent(event);
  }
  var id = target.id || '';
  var expected = id && _safeFileInputId === id && Date.now() <= _safeFileInputUntil;
  if (expected || isVisibleFileInputForActiveArea(target)) return;
  return blockEvent(event);
}, true);

document.addEventListener('pointerdown', function(event) {
  if (document.body.classList.contains('modal-lock') && isUploadTriggerElement(event.target) && !isInsideVisibleModal(event.target)) {
    return blockEvent(event);
  }
  if (!isAdminAccessControlModalOpen() || !isUploadTriggerElement(event.target)) return;
  return blockEvent(event);
}, true);

function setSuperAdminUploadLock(enable) {
  try { document.body.classList.toggle('super-admin-control-mode', !!enable); } catch(e) {}
}

// ========================================
// ADMIN CLAIMS
// ========================================
var _adminClaims = [];

async function loadAdminClaims() {
  var el = document.getElementById('adminClaimsList');
  if (el) el.innerHTML = '<div class="table-empty"><span class="emoji"></span>Loading claims...</div>';
  try {
    var rows = await neonSQL(
      'SELECT c.id, c.booking_id, c.member_phone, c.member_name, c.status, c.created_at, ' +
      "       COALESCE(c.claim_type,'show') AS claim_type, c.reason, " +
      "       b.venue, b.date, b.name AS booker_name, CASE WHEN LENGTH(COALESCE(b.proof_url,'')) > 0 THEN '__uploaded__' ELSE '' END AS proof_url " +
      'FROM claims c ' +
      'LEFT JOIN bookings b ON b.id = c.booking_id ' +
      "WHERE c.status IN ('pending','approved','rejected') AND COALESCE(c.claim_type,'show') IN ('show','special_show') " +
      'ORDER BY c.created_at DESC LIMIT 200'
    );
    _adminClaims = rows;
    _renderAdminClaims();
    _updateClaimsBadge();
  } catch(e) {
    // Likely the claims table doesn't exist yet - show empty, not an error
    if (el) el.innerHTML = '<div class="table-empty"><span class="emoji"></span>No claims yet.</div>';
    console.warn('[OTS] loadAdminClaims (table may not exist yet):', e && (e.message||e));
  }
}

function _updateClaimsBadge() {
  var badge = document.getElementById('claimsBadge');
  if (!badge) return;
  var n = _adminClaims.filter(function(c){ return c.status === 'pending'; }).length;
  if (n > 0) { badge.textContent = n; badge.style.display = ''; }
  else         badge.style.display = 'none';
}

function _renderAdminClaims() {
  var el = document.getElementById('adminClaimsList');
  if (!el) return;
  var canEditClaims = hasAdminPerm('claims');
  if (!_adminClaims.length) {
    el.innerHTML = '<div class="table-empty"><span class="emoji"></span>No claims yet.</div>';
    return;
  }
  // Group by booking
  var byBooking = {};
  _adminClaims.forEach(function(c) {
    if (!byBooking[c.booking_id]) byBooking[c.booking_id] = { info: c, claims: [] };
    byBooking[c.booking_id].claims.push(c);
  });
  el.innerHTML = Object.values(byBooking).map(function(grp) {
    var info = grp.info;
    var bookingIdAttr = String(info.booking_id||'').replace(/'/g, '');
    var proofHtml = info.proof_url
      ? (isProofPlaceholder(info.proof_url)
        ? `<button class="btn-secondary" onclick="adminViewClaimProof('${bookingIdAttr}')" style="font-size:.7rem;padding:.45rem .6rem;">View Photo</button>`
        : `<img src="${info.proof_url}" onclick="adminViewClaimProof('${bookingIdAttr}')" style="width:80px;height:60px;object-fit:cover;border-radius:6px;cursor:pointer;border:1px solid var(--border);" title="Click to view full photo">`)
      : '<span style="font-size:.72rem;color:var(--muted);">No photo yet</span>';
    var claimsHtml = grp.claims.map(function(c) {
      var statusBadge = c.status === 'approved'
        ? '<span style="color:var(--green);font-size:.72rem;font-weight:700;"> Approved</span>'
        : c.status === 'rejected'
          ? '<span style="color:#ff4b4b;font-size:.72rem;font-weight:700;">x Rejected</span>'
          : '<span style="color:#ffc83c;font-size:.72rem;font-weight:700;"> Pending</span>';
      var btns = c.status === 'pending' && canEditClaims
        ? `<button class="btn-approve" onclick="approveClaim(${c.id})"> Approve</button>
           <button class="btn-special" onclick="approveSpecialClaim(${c.id})">Give 1 Point</button>
           <button class="btn-reject"  onclick="rejectClaim(${c.id})">x Reject</button>`
        : '';
      return `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem;padding:.6rem 0;border-bottom:1px solid rgba(255,255,255,.04);">
        <div style="font-size:.8rem;">
          <strong>${c.member_name||'Unknown'}</strong>
          <span style="color:var(--muted);margin-left:.5rem;">${c.member_phone}</span>
          &nbsp;${statusBadge}
        </div>
        <div style="display:flex;gap:.4rem;">${btns}</div>
      </div>`;
    }).join('');
    return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:1rem 1.2rem;margin-bottom:1rem;">
      <div style="display:flex;align-items:flex-start;gap:1rem;flex-wrap:wrap;margin-bottom:.8rem;">
        ${proofHtml}
        <div style="flex:1;min-width:160px;">
          <div style="font-size:.9rem;font-weight:700;">${info.venue||'-'}</div>
          <div style="font-size:.78rem;color:var(--muted);">Date: ${formatDate(info.date||'')} &nbsp;-&nbsp; Booking #${info.booking_id}</div>
          <div style="font-size:.78rem;color:var(--muted);">Submitted by: ${info.booker_name||'-'}</div>
        </div>
      </div>
      <div>${claimsHtml}</div>
    </div>`;
  }).join('');
}

async function approveClaim(claimId) {
  if (!requireAdminPerm('claims', 'claim approval')) return;
  var claim = _adminClaims.find(function(x){ return x.id === claimId; });
  if (!claim) { showToast('','Error','Claim not found.'); return; }
  var bookingId  = claim.booking_id;
  var memberName = claim.member_name || claim.member_phone || 'Member';
  var bk = allBookings.find(function(x){ return String(x.id) === String(bookingId); });
  try {
    var groupClaims = await neonSQL(
      "SELECT id,status FROM claims WHERE booking_id=$1 AND COALESCE(claim_type,'show')='show' AND status IN ('pending','approved')",
      [bookingId]
    );
    var performerCount = Math.max(1, (groupClaims || []).length);
    var totalPool = bookingPointPool(bk);
    var pts = splitShowPoints(totalPool, performerCount);
    var zoneName = await getMemberZoneName(claim.member_phone || '');
    await neonSQL("UPDATE claims SET status='approved', points=$2, zone_name=$3 WHERE id=$1", [claimId, pts, zoneName]);
    await rebalanceApprovedShowClaims(bookingId, bk, true);
    // Mark the booking as proof_claimed=true so the member sees " Points Claimed"
    await dbPatch('bookings', bookingId, { proof_claimed: true });
    // Update local allBookings cache
    var b = allBookings.find(function(x){ return String(x.id) === String(bookingId); });
    if (b) b.proofClaimed = true;
    // Update local claim
    claim.status = 'approved';
    _renderAdminClaims();
    _updateClaimsBadge();
    var pointNote = ' (' + pts + ' point each from ' + totalPool + ' total points split by ' + performerCount + ')';
    notifyMemberUpdate({
      updateType: 'claim',
      status: 'approved',
      claimId: claimId,
      bookingId: bookingId,
      phone: claim.member_phone || '',
      name: memberName,
      venue: claim.venue || (bk && bk.venue) || '',
      date: claim.date || (bk && bk.date) || '',
      points: pts
    });
    logAdminAction('approve_claim', memberName + ' for booking #' + bookingId + pointNote).catch(function(){});
    showToast('','Claim Approved', memberName + ' gets ' + pts + ' point(s). Total slot pool: ' + totalPool + ' split across ' + performerCount + ' performer(s).');
  } catch(e) {
    showToast('','Error','Could not approve claim: '+(e&&e.message));
    console.error('[OTS] approveClaim:', e);
  }
}

async function approveSpecialClaim(claimId) {
  if (!requireAdminPerm('claims', 'claim approval')) return;
  var claim = _adminClaims.find(function(x){ return x.id === claimId; });
  if (!claim) { showToast('','Error','Claim not found.'); return; }
  if (!confirm('Give exactly 1 point to this performer?')) return;
  var bookingId  = claim.booking_id;
  var memberName = claim.member_name || claim.member_phone || 'Member';
  var bk = allBookings.find(function(x){ return String(x.id) === String(bookingId); });
  try {
    var zoneName = await getMemberZoneName(claim.member_phone || '');
    await neonSQL(
      "UPDATE claims SET status='approved', claim_type='special_show', reason=$2, points=1, zone_name=$3 WHERE id=$1",
      [claimId, 'Special show credit - 1 point', zoneName]
    );
    await dbPatch('bookings', bookingId, { proof_claimed: true });
    var b = allBookings.find(function(x){ return String(x.id) === String(bookingId); });
    if (b) b.proofClaimed = true;
    claim.status = 'approved';
    claim.claim_type = 'special_show';
    claim.reason = 'Special show credit - 1 point';
    claim.points = 1;
    _renderAdminClaims();
    _updateClaimsBadge();
    notifyMemberUpdate({
      updateType: 'claim',
      status: 'approved',
      claimId: claimId,
      bookingId: bookingId,
      phone: claim.member_phone || '',
      name: memberName,
      venue: claim.venue || (bk && bk.venue) || '',
      date: claim.date || (bk && bk.date) || '',
      points: 1
    });
    logAdminAction('approve_special_claim', memberName + ' for booking #' + bookingId + ' (special show credit: 1 point)').catch(function(){});
    showToast('','1 Point Added', memberName + ' gets 1 full point.');
  } catch(e) {
    showToast('','Error','Could not approve special credit: '+(e&&e.message));
    console.error('[OTS] approveSpecialClaim:', e);
  }
}

async function rejectClaim(claimId) {
  if (!requireAdminPerm('claims', 'claim approval')) return;
  if (!confirm('Reject this claim?')) return;
  try {
    await neonSQL("UPDATE claims SET status='rejected' WHERE id=$1", [claimId]);
    var c = _adminClaims.find(function(x){ return x.id === claimId; });
    if (c) c.status = 'rejected';
    _renderAdminClaims();
    _updateClaimsBadge();
    var rc = _adminClaims.find(function(x){ return x.id === claimId; });
    notifyMemberUpdate({
      updateType: 'claim',
      status: 'rejected',
      claimId: claimId,
      bookingId: rc ? rc.booking_id : '',
      phone: rc ? rc.member_phone || '' : '',
      name: rc ? rc.member_name || '' : '',
      venue: rc ? rc.venue || '' : '',
      date: rc ? rc.date || '' : ''
    });
    logAdminAction('reject_claim', (rc ? rc.member_name || rc.member_phone : 'claim #'+claimId) + ' booking #' + (rc?rc.booking_id:'')).catch(function(){});
    showToast('x','Claim Rejected','The claim has been rejected.');
  } catch(e) {
    showToast('','Error','Could not reject claim: '+(e&&e.message));
    console.error('[OTS] rejectClaim:', e);
  }
}

// -- Points Management ---------------------------------------------------------
var _withdrawAllRows = [];
var _zoneMonthlyRows = [];

function monthKeyFromDate(value) {
  var d = value ? new Date(value) : new Date();
  if (isNaN(d.getTime())) d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function monthRangeFromKey(monthKey) {
  var parts = String(monthKey || monthKeyFromDate()).split('-').map(Number);
  var y = parts[0] || new Date().getFullYear();
  var m = (parts[1] || (new Date().getMonth() + 1)) - 1;
  var start = new Date(y, m, 1);
  var end = new Date(y, m + 1, 1);
  return { start: start.toISOString(), end: end.toISOString(), key: y + '-' + String(m + 1).padStart(2, '0') };
}
function initZoneMonthInputs() {
  var key = monthKeyFromDate();
  var report = document.getElementById('zone-report-month');
  var csv = document.getElementById('zone-csv-month');
  if (report && !report.value) report.value = key;
  if (csv && !csv.value) csv.value = key;
}
async function getMemberZoneName(phone) {
  var norm = _normPhone(phone || '');
  if (!norm) return 'No Zone';
  try {
    var rows = await neonSQL(
      "SELECT COALESCE(NULLIF(zone_current,''),'No Zone') AS zone FROM members WHERE RIGHT(REGEXP_REPLACE(phone,'[^0-9]','','g'),10)=$1 LIMIT 1",
      [norm]
    );
    return (rows && rows[0] && rows[0].zone) || 'No Zone';
  } catch(e) {
    return 'No Zone';
  }
}
async function findMemberForPoints(phone, name) {
  var norm = _normPhone(phone || '');
  var rows = [];
  if (norm) {
    rows = await neonSQL(
      "SELECT name, phone, email, COALESCE(NULLIF(zone_current,''),'No Zone') AS zone FROM members WHERE RIGHT(REGEXP_REPLACE(phone,'[^0-9]','','g'),10)=$1 AND active IS NOT FALSE LIMIT 1",
      [norm]
    );
  }
  if ((!rows || !rows.length) && name) {
    rows = await neonSQL(
      "SELECT name, phone, email, COALESCE(NULLIF(zone_current,''),'No Zone') AS zone FROM members WHERE LOWER(name)=LOWER($1) AND active IS NOT FALSE LIMIT 1",
      [String(name || '').trim()]
    );
  }
  return rows && rows[0] ? rows[0] : null;
}

async function loadZoneMonthlyReport() {
  if (!hasAdminPerm('points')) return;
  initZoneMonthInputs();
  var el = document.getElementById('zoneMonthlyReport');
  var monthInput = document.getElementById('zone-report-month');
  var range = monthRangeFromKey(monthInput && monthInput.value);
  if (el) el.innerHTML = '<div style="color:var(--muted);font-size:.83rem;text-align:center;padding:2rem;">Loading zone report...</div>';
  try {
    var rows = await neonSQL(
      "SELECT COALESCE(NULLIF(c.zone_name,''),NULLIF(m.zone_current,''),'No Zone') AS zone_name, " +
      "SUM(COALESCE(c.points,1)) AS total_points, COUNT(DISTINCT c.member_phone) AS member_count " +
      "FROM claims c LEFT JOIN members m ON RIGHT(REGEXP_REPLACE(c.member_phone,'[^0-9]','','g'),10)=RIGHT(REGEXP_REPLACE(m.phone,'[^0-9]','','g'),10) " +
      "WHERE c.status='approved' AND c.created_at >= $1 AND c.created_at < $2 " +
      "GROUP BY 1 ORDER BY total_points DESC, zone_name ASC",
      [range.start, range.end]
    );
    var zoneMap = {};
    parseZoneNames(zoneNames).forEach(function(z) {
      zoneMap[z] = { zoneName:z, totalPoints:0, memberCount:0 };
    });
    (rows || []).forEach(function(r) {
      var name = r.zone_name || 'No Zone';
      zoneMap[name] = {
        zoneName:name,
        totalPoints:Number(r.total_points || 0),
        memberCount:Number(r.member_count || 0)
      };
    });
    _zoneMonthlyRows = Object.values(zoneMap).sort(function(a, b) {
      return (b.totalPoints - a.totalPoints) || String(a.zoneName || '').localeCompare(String(b.zoneName || ''));
    }).map(function(r, i) {
      r.rank = i + 1;
      return r;
    });
    renderZoneMonthlyReport(range.key);
  } catch(e) {
    console.error('[OTS] zone monthly report:', e);
    if (el) el.innerHTML = '<div style="color:#ff7b7b;font-size:.83rem;text-align:center;padding:2rem;">Could not load zone report.</div>';
  }
}
function renderZoneMonthlyReport(monthKey) {
  var el = document.getElementById('zoneMonthlyReport');
  if (!el) return;
  if (!_zoneMonthlyRows.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:.83rem;text-align:center;padding:2rem;">No approved points for ' + otsEscapeHtml(monthKey) + ' yet.</div>';
    return;
  }
  el.innerHTML = '<div class="zone-report-grid">' + _zoneMonthlyRows.map(function(r) {
    return '<div class="zone-report-card">' +
      '<div class="zone-report-rank">#' + r.rank + '</div>' +
      '<div class="zone-report-name">' + otsEscapeHtml(r.zoneName) + '</div>' +
      '<div class="zone-report-points">' + (Math.round(r.totalPoints * 100) / 100) + '</div>' +
      '<div class="zone-report-meta">' + r.memberCount + ' member' + (r.memberCount === 1 ? '' : 's') + ' contributed</div>' +
    '</div>';
  }).join('') + '</div>';
}
async function saveZoneMonthlySnapshot() {
  if (!requireAdminPerm('points', 'zone monthly reports')) return;
  var monthInput = document.getElementById('zone-report-month');
  var range = monthRangeFromKey(monthInput && monthInput.value);
  await loadZoneMonthlyReport();
  if (!_zoneMonthlyRows.length) { showToast('', 'No Data', 'No zone points to save for this month.'); return; }
  if (!confirm('Save monthly zone report for ' + range.key + '? Existing snapshot for this month will be replaced.')) return;
  try {
    await neonSQL('DELETE FROM zone_monthly_reports WHERE month_key=$1', [range.key]);
    for (var i = 0; i < _zoneMonthlyRows.length; i++) {
      var r = _zoneMonthlyRows[i];
      await neonSQL(
        'INSERT INTO zone_monthly_reports (month_key,zone_name,total_points,member_count,rank,saved_by) VALUES ($1,$2,$3,$4,$5,$6)',
        [range.key, r.zoneName, r.totalPoints, r.memberCount, r.rank, currentAdminUsername || 'admin']
      );
    }
    logAdminAction('save_zone_monthly_report', range.key + ' - ' + _zoneMonthlyRows[0].zoneName + ' won').catch(function(){});
    showToast('', 'Report Saved', 'Winning history updated for ' + range.key + '.');
    loadZoneWinningHistory();
  } catch(e) {
    console.error('[OTS] save zone snapshot:', e);
    showToast('', 'Save Failed', 'Could not save the monthly report.');
  }
}
async function loadZoneWinningHistory() {
  var el = document.getElementById('zoneWinningHistory');
  if (!el) return;
  try {
    var rows = await neonSQL("SELECT month_key, zone_name, total_points, member_count, rank FROM zone_monthly_reports ORDER BY month_key DESC, rank ASC LIMIT 120");
    if (!rows.length) {
      el.innerHTML = '<div style="color:var(--muted);font-size:.83rem;text-align:center;padding:1rem;">No saved monthly reports yet.</div>';
      return;
    }
    var winners = rows.filter(function(r){ return Number(r.rank) === 1; });
    el.innerHTML = winners.map(function(r){
      return '<div class="zone-history-row"><strong>' + otsEscapeHtml(r.month_key) + '</strong><span>' + otsEscapeHtml(r.zone_name) + '</span><em>' + (Math.round(Number(r.total_points || 0) * 100) / 100) + ' pts</em></div>';
    }).join('');
  } catch(e) {
    el.innerHTML = '<div style="color:var(--muted);font-size:.83rem;text-align:center;padding:1rem;">No saved monthly reports yet.</div>';
  }
}
function handleZonePointsCsvFile(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var text = String(e.target && e.target.result || '');
    var box = document.getElementById('zone-csv-text');
    if (box) box.value = text;
    var status = document.getElementById('zone-csv-status');
    if (status) status.textContent = 'CSV loaded. Check and click Import Points.';
  };
  reader.readAsText(file);
}
function parseZonePointsCsv(text) {
  var records = parseCSVRecords(text || '');
  if (!records.length) return [];
  var first = records[0].map(function(c){ return String(c || '').toLowerCase().trim(); });
  var hasHeader = first.some(function(c){ return ['name','phone','mobile','points','point','reason'].indexOf(c) > -1; });
  var headers = hasHeader ? first : ['name','phone','points','reason'];
  var rows = hasHeader ? records.slice(1) : records;
  function idx(names, fallback) {
    for (var i=0;i<headers.length;i++) if (names.indexOf(headers[i]) > -1) return i;
    return fallback;
  }
  var nameIdx = idx(['name','member name'], 0);
  var phoneIdx = idx(['phone','mobile','number','member mobile'], 1);
  var pointsIdx = idx(['points','point','pts'], 2);
  var reasonIdx = idx(['reason','notes','note'], 3);
  return rows.map(function(cols) {
    return {
      name: cleanCSVCell(cols[nameIdx] || ''),
      phone: cleanCSVCell(cols[phoneIdx] || ''),
      points: Number(cleanCSVCell(cols[pointsIdx] || '0')),
      reason: cleanCSVCell(cols[reasonIdx] || 'Zone lead points')
    };
  }).filter(function(r){ return r.name || r.phone || r.points; });
}
async function importZonePointsCsv() {
  if (!requireAdminPerm('points', 'zone point CSV import')) return;
  var status = document.getElementById('zone-csv-status');
  var text = (document.getElementById('zone-csv-text') && document.getElementById('zone-csv-text').value) || '';
  var monthInput = document.getElementById('zone-csv-month');
  var range = monthRangeFromKey(monthInput && monthInput.value);
  var rows = parseZonePointsCsv(text);
  if (!rows.length) { if (status) { status.style.color = '#ff7b7b'; status.textContent = 'No valid rows found.'; } return; }
  if (status) { status.style.color = 'var(--muted)'; status.textContent = 'Importing ' + rows.length + ' row(s)...'; }
  var ok = 0, skipped = [];
  try {
    for (var i=0; i<rows.length; i++) {
      var r = rows[i];
      var pts = Math.round((Number(r.points) || 0) * 100) / 100;
      if (pts <= 0) { skipped.push((r.name || r.phone || ('row ' + (i+1))) + ': invalid points'); continue; }
      var member = await findMemberForPoints(r.phone, r.name);
      if (!member) { skipped.push((r.name || r.phone || ('row ' + (i+1))) + ': member not found'); continue; }
      var phone = _normPhone(member.phone || r.phone);
      var zone = member.zone || 'No Zone';
      var reason = r.reason || ('Zone points import ' + range.key);
      var bookingId = 'ZONECSV-' + range.key + '-' + Date.now().toString(36).toUpperCase() + '-' + i;
      await neonSQL(
        "INSERT INTO claims (booking_id, member_phone, member_name, status, claim_type, reason, points, zone_name, created_at) VALUES ($1,$2,$3,'approved','zone_bonus',$4,$5,$6,$7)",
        [bookingId, phone, member.name || r.name || phone, reason, pts, zone, range.start]
      );
      notifyMemberUpdate({ updateType:'points', status:'approved', phone:phone, name:member.name || '', points:pts, reason:reason });
      ok++;
    }
    logAdminAction('import_zone_points_csv', ok + ' row(s) imported for ' + range.key + (skipped.length ? ', skipped ' + skipped.length : '')).catch(function(){});
    if (status) {
      status.style.color = skipped.length ? 'var(--yellow)' : 'var(--green)';
      status.textContent = ok + ' imported' + (skipped.length ? '. Skipped: ' + skipped.slice(0, 3).join('; ') + (skipped.length > 3 ? '...' : '') : '.');
    }
    showToast('', 'CSV Import Done', ok + ' member point row(s) imported.');
    loadZoneMonthlyReport();
    loadWithdrawList();
    loadLeaderboard();
  } catch(e) {
    console.error('[OTS] zone csv import:', e);
    if (status) { status.style.color = '#ff7b7b'; status.textContent = 'Import failed: ' + ((e && e.message) || e); }
  }
}

async function giveVolunteerPoints() {
  if (!requireAdminPerm('points', 'points management')) return;
  var phone  = (document.getElementById('vp-phone')  && document.getElementById('vp-phone').value  || '').trim();
  var reason = (document.getElementById('vp-reason') && document.getElementById('vp-reason').value || '').trim();
  var pts    = parseInt((document.getElementById('vp-pts') && document.getElementById('vp-pts').value) || '1', 10);
  var status = document.getElementById('vp-status');
  if (!phone) { if (status) { status.style.color='#e53e3e'; status.textContent='Phone number is required.'; } return; }
  if (!reason) { if (status) { status.style.color='#e53e3e'; status.textContent='Reason is required.'; } return; }
  if (isNaN(pts) || pts < 1) pts = 1;
  var normP = _normPhone(phone);
  if (status) { status.style.color='var(--muted)'; status.textContent='Looking up member...'; }
  try {
    var rows = await neonSQL(
      "SELECT name, phone, COALESCE(NULLIF(zone_current,''),'No Zone') AS zone FROM members WHERE RIGHT(REGEXP_REPLACE(phone,'[^0-9]','','g'),10)=$1 AND active IS NOT FALSE LIMIT 1",
      [normP]
    );
    if (!rows.length) { if (status) { status.style.color='#e53e3e'; status.textContent='Member not found. Check the phone number.'; } return; }
    var member = rows[0];
    if (status) { status.style.color='var(--muted)'; status.textContent='Inserting ' + pts + ' point(s) for ' + member.name + '...'; }
    await neonSQL(
      "INSERT INTO claims (booking_id, member_phone, member_name, status, claim_type, reason, points, zone_name) VALUES ('VOLUNTEER',$1,$2,'approved','volunteer',$3,$4,$5)",
      [normP, member.name || '', reason, pts, member.zone || 'No Zone']
    );
    notifyMemberUpdate({
      updateType: 'points',
      status: 'approved',
      phone: normP,
      name: member.name || '',
      points: pts,
      reason: reason
    });
    logAdminAction('give_volunteer_points', member.name + ' - ' + pts + ' pt(s) for: ' + reason).catch(function(){});
    if (status) { status.style.color='var(--green)'; status.textContent = ' ' + pts + ' volunteer point(s) given to ' + member.name + ' for: ' + reason; }
    document.getElementById('vp-phone').value  = '';
    document.getElementById('vp-reason').value = '';
    document.getElementById('vp-pts').value    = '1';
    showToast('','Points Given', member.name + ' received ' + pts + ' volunteer pt(s): ' + reason);
  } catch(e) {
    if (status) { status.style.color='#e53e3e'; status.textContent='Error: ' + (e && e.message ? e.message : e); }
    console.error('[OTS] giveVolunteerPoints:', e);
  }
}

async function loadWithdrawList() {
  var el = document.getElementById('withdrawList');
  if (el) el.innerHTML = '<div style="color:var(--muted);font-size:.83rem;text-align:center;padding:2rem;">Loading...</div>';
  try {
    var rows = await neonSQL(
      "SELECT c.id, c.member_name, c.member_phone, c.claim_type, c.reason, c.created_at, " +
      "       COALESCE(b.venue,'-') AS venue, COALESCE(b.date,'') AS date " +
      "FROM claims c LEFT JOIN bookings b ON b.id = c.booking_id " +
      "WHERE c.status='approved' ORDER BY c.created_at DESC LIMIT 500"
    );
    _withdrawAllRows = rows;
    _renderWithdrawList(rows);
  } catch(e) {
    if (el) el.innerHTML = '<div style="color:#e53e3e;font-size:.83rem;padding:1rem;">Failed to load: ' + (e && e.message||e) + '</div>';
    console.error('[OTS] loadWithdrawList:', e);
  }
}

function filterWithdrawList(q) {
  q = (q||'').toLowerCase();
  _renderWithdrawList(q ? _withdrawAllRows.filter(function(r){
    return (r.member_name||'').toLowerCase().includes(q) || (r.member_phone||'').includes(q);
  }) : _withdrawAllRows);
}

function _renderWithdrawList(rows) {
  var el = document.getElementById('withdrawList');
  if (!el) return;
  var canEditPoints = hasAdminPerm('points');
  if (!rows.length) { el.innerHTML = '<div style="color:var(--muted);font-size:.83rem;text-align:center;padding:2rem;">No approved points found.</div>'; return; }
  el.innerHTML = rows.map(function(r) {
    var isVol = r.claim_type === 'volunteer';
    var isZoneBonus = r.claim_type === 'zone_bonus';
    var badge = isVol
      ? '<span style="background:rgba(112,186,244,.15);border:1px solid rgba(112,186,244,.35);color:var(--blue);font-size:.65rem;font-weight:700;padding:.1rem .45rem;border-radius:3px;margin-left:.4rem;">VOLUNTEER</span>'
      : isZoneBonus
      ? '<span style="background:rgba(245,119,161,.13);border:1px solid rgba(245,119,161,.32);color:#f577a1;font-size:.65rem;font-weight:700;padding:.1rem .45rem;border-radius:3px;margin-left:.4rem;">ZONE</span>'
      : '<span style="background:rgba(var(--green-rgb),.1);border:1px solid rgba(var(--green-rgb),.3);color:var(--green);font-size:.65rem;font-weight:700;padding:.1rem .45rem;border-radius:3px;margin-left:.4rem;">SHOW</span>';
    var detail = isVol
      ? (r.reason || 'Volunteer contribution')
      : isZoneBonus
      ? (r.reason || 'Zone lead points')
      : ((r.venue||'-') + (r.date ? ' - ' + formatDate(r.date) : ''));
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:.6rem .2rem;border-bottom:1px solid rgba(255,255,255,.05);gap:.5rem;flex-wrap:wrap;">' +
      '<div style="flex:1;min-width:160px;">' +
        '<div style="font-size:.82rem;font-weight:700;">' + (r.member_name||'Unknown') + badge + '</div>' +
        '<div style="font-size:.72rem;color:var(--muted);">' + (r.member_phone||'') + ' &nbsp;-&nbsp; ' + detail + '</div>' +
      '</div>' +
      (canEditPoints ? '<button onclick="withdrawClaim(' + r.id + ')" style="background:transparent;border:1px solid rgba(220,38,38,.4);color:#dc2626;font-family:\'DM Sans\',sans-serif;font-size:.72rem;font-weight:700;padding:.3rem .75rem;border-radius:3px;cursor:pointer;white-space:nowrap;">Withdraw</button>' : '<span style="font-size:.72rem;color:var(--muted);">View only</span>') +
    '</div>';
  }).join('');
}

async function withdrawClaim(claimId) {
  if (!requireAdminPerm('points', 'points management')) return;
  if (!confirm('Withdraw this point? It will be removed from the leaderboard immediately.')) return;
  try {
    await neonSQL("UPDATE claims SET status='withdrawn' WHERE id=$1", [claimId]);
    var r = _withdrawAllRows.find(function(x){ return x.id === claimId; });
    var name = r ? (r.member_name || r.member_phone) : '#' + claimId;
    notifyMemberUpdate({
      updateType: 'withdraw',
      status: 'withdrawn',
      claimId: claimId,
      phone: r ? r.member_phone || '' : '',
      name: name,
      venue: r ? r.venue || '' : '',
      date: r ? r.date || '' : '',
      reason: r ? r.reason || 'Point withdrawn by admin' : 'Point withdrawn by admin'
    });
    logAdminAction('withdraw_claim', name + ' - claim #' + claimId).catch(function(){});
    _withdrawAllRows = _withdrawAllRows.filter(function(x){ return x.id !== claimId; });
    var q = document.getElementById('withdraw-search') ? document.getElementById('withdraw-search').value : '';
    filterWithdrawList(q);
    showToast('', 'Point Withdrawn', name + '\'s point has been removed from the leaderboard.');
  } catch(e) {
    showToast('','Error','Could not withdraw: '+(e&&e.message||e));
    console.error('[OTS] withdrawClaim:', e);
  }
}

async function adminViewClaimProof(bookingId) {
  var row = _adminClaims.find(function(c){ return String(c.booking_id) === String(bookingId); });
  if (!row || !row.proof_url) { showToast('','No Photo','No proof photo found for this claim.'); return; }
  var url = row.proof_url;
  if (isProofPlaceholder(url)) {
    showToast('', 'Loading Photo', 'Opening proof photo...');
    try {
      url = await fetchBookingProofUrl(bookingId);
      if (url) row.proof_url = url;
    } catch(e) {
      showToast('', 'Photo Load Failed', 'Please refresh and try again.');
      return;
    }
  }
  if (!url || isProofPlaceholder(url)) { showToast('','No Photo','No proof photo found for this claim.'); return; }
  _openProofOverlay(url);
}

function adminViewProofUrl(url) {
  _openProofOverlay(url);
}

function _openProofOverlay(url) {
  const ov = document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.88);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;cursor:pointer;';
  const img = document.createElement('img');
  img.src = url;
  img.style.cssText = 'max-width:90vw;max-height:80vh;border-radius:10px;box-shadow:0 8px 40px #000;';
  const hint = document.createElement('div');
  hint.style.cssText = 'color:#fff;font-size:.78rem;opacity:.7;';
  hint.textContent = 'Tap anywhere to close';
  ov.appendChild(img);
  ov.appendChild(hint);
  ov.onclick = () => document.body.removeChild(ov);
  document.body.appendChild(ov);
}

async function saveAdminPhone() {
  if (!isCurrentSuperAdmin()) { showToast('', 'Super Admin Only', 'Only Super Admin can change settings.'); return; }
  var inp = document.getElementById('settings-admin-phone');
  var status = document.getElementById('settings-phone-status');
  if (!inp) return;
  var phone = (inp.value || '').trim();
  status.textContent = ' Saving...';
  try {
    await neonSQL("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT DEFAULT '')");
    await neonSQL(
      "INSERT INTO settings (key,value) VALUES ('admin_phone',$1) ON CONFLICT (key) DO UPDATE SET value=$1",
      [phone]
    );
    adminPhone = phone;
    if (!helpdeskNumbers.length && adminPhone) helpdeskNumbers = [adminPhone];
    renderHelpdeskContacts();
    status.textContent = phone ? ' Saved - members will now see a call button.' : ' Cleared.';
    logAdminAction('update_setting', 'Admin phone  ' + (phone || '(cleared)')).catch(function(){});
    showToast('','Saved','Admin contact number updated.');
  } catch(e) {
    status.textContent = ' Could not save - try again.';
    console.error('saveAdminPhone:', e);
  }
}
async function saveHelpdeskNumbers() {
  if (!isCurrentSuperAdmin()) { showToast('', 'Super Admin Only', 'Only Super Admin can change settings.'); return; }
  var inp = document.getElementById('settings-helpdesk-numbers');
  var status = document.getElementById('settings-helpdesk-status');
  if (!inp) return;
  var nums = parseHelpdeskNumbers(inp.value || '');
  var value = formatHelpdeskNumbers(nums);
  if (status) status.textContent = ' Saving...';
  try {
    await neonSQL("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT DEFAULT '')");
    await neonSQL(
      "INSERT INTO settings (key,value) VALUES ('helpdesk_numbers',$1) ON CONFLICT (key) DO UPDATE SET value=$1",
      [value]
    );
    helpdeskNumbers = nums;
    if (!helpdeskNumbers.length && adminPhone) helpdeskNumbers = [adminPhone];
    renderHelpdeskContacts();
    if (status) status.textContent = nums.length ? ' Saved ' + nums.length + ' helpdesk number(s).' : ' Cleared. Admin phone will be used if available.';
    logAdminAction('update_setting', 'Helpdesk numbers  ' + (value || '(cleared)')).catch(function(){});
    showToast('','Saved','Helpdesk numbers updated.');
  } catch(e) {
    if (status) status.textContent = ' Could not save - try again.';
    console.error('saveHelpdeskNumbers:', e);
  }
}
async function saveZoneNames() {
  if (!isCurrentSuperAdmin()) { showToast('', 'Super Admin Only', 'Only Super Admin can change settings.'); return; }
  var inp = document.getElementById('settings-zone-names');
  var status = document.getElementById('settings-zone-status');
  if (!inp) return;
  var names = parseZoneNames(inp.value || '');
  var value = formatZoneNames(names);
  if (status) status.textContent = ' Saving...';
  try {
    await neonSQL("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT DEFAULT '')");
    await neonSQL(
      "INSERT INTO settings (key,value) VALUES ('zone_names',$1) ON CONFLICT (key) DO UPDATE SET value=$1",
      [value]
    );
    zoneNames = names;
    inp.value = value;
    refreshZoneSelects();
    renderZoneFilter();
    renderMembersTable();
    try { loadLeaderboard(); } catch(_){}
    if (status) status.textContent = ' Saved ' + names.length + ' zone(s).';
    logAdminAction('update_setting', 'Zone names  ' + value.replace(/\n/g, ', ')).catch(function(){});
    showToast('', 'Saved', 'Zone names updated.');
  } catch(e) {
    if (status) status.textContent = ' Could not save - try again.';
    console.error('saveZoneNames:', e);
  }
}
function dateOnlyFromValue(value) {
  var iso = normalizeVenueDate(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  var parts = iso.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}
function isDateInCurrentWeek(value) {
  var d = dateOnlyFromValue(value);
  if (!d) return false;
  var now = new Date();
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var day = start.getDay(); // Sunday=0
  var mondayOffset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + mondayOffset);
  var end = new Date(start);
  end.setDate(start.getDate() + 7);
  return d >= start && d < end;
}
function isDateInCurrentMonth(value) {
  var d = dateOnlyFromValue(value);
  if (!d) return false;
  var now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}
function updateAdminStats() {
  const confirmed = allBookings.filter(b=>b.status==='confirmed' && isDateInCurrentWeek(b.date)).length;
  const activeV   = venues.filter(v=>v.status==='open' && isDateInCurrentMonth(v.date)).length;
  const setEl = (id, val) => { var el=document.getElementById(id); if(el) el.textContent=val; };
  setEl('stat-confirmed',    confirmed);
  setEl('stat-venues-count', activeV);
}
function getVenueTime(venueId) {
  const v = venues.find(x=>x.id===venueId);
  return v ? `${v.day||''} ${formatDateShort(v.date)} - ${formatVenueTimeRange(v)}` : '-';
}
function venueNameKey(value) {
  return normalizeVenueNameForDuplicate(value);
}
function getLiveVenueName(booking) {
  var v = booking && booking.venueId ? venues.find(function(x){ return x.id === booking.venueId; }) : null;
  return (v && v.name) ? v.name : ((booking && booking.venue) || '');
}
async function propagateVenueRename(oldName, newName, editedVenueId) {
  var oldKey = venueNameKey(oldName);
  var newClean = String(newName || '').trim();
  if (!oldKey || !newClean || oldKey === venueNameKey(newClean)) return { venues:0, bookings:0 };

  var affectedIds = [];
  venues.forEach(function(v) {
    if (venueNameKey(v.name) === oldKey) {
      v.name = newClean;
      affectedIds.push(v.id);
    }
  });
  if (editedVenueId && affectedIds.indexOf(editedVenueId) === -1) affectedIds.push(editedVenueId);

  var bookingCount = 0;
  function updateBookingName(b) {
    if (!b) return;
    if (affectedIds.indexOf(b.venueId) > -1 || venueNameKey(b.venue) === oldKey) {
      if (b.venue !== newClean) bookingCount++;
      b.venue = newClean;
    }
  }
  allBookings.forEach(updateBookingName);
  myBookings.forEach(updateBookingName);

  try {
    await neonSQL(
      "UPDATE venues SET name=$1 WHERE LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(name,'&',' and ','g'),'[^a-zA-Z0-9]+',' ','g')))=$2",
      [newClean, oldKey]
    );
  } catch(e) {
    console.warn('[OTS] venue rename remote venue update skipped:', e && (e.message || e));
  }
  try {
    await neonSQL(
      "UPDATE bookings SET venue=$1 WHERE LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(venue,'&',' and ','g'),'[^a-zA-Z0-9]+',' ','g')))=$2 OR venue_id = ANY($3::text[])",
      [newClean, oldKey, affectedIds]
    );
  } catch(e) {
    console.warn('[OTS] venue rename remote booking update skipped:', e && (e.message || e));
  }
  return { venues:affectedIds.length, bookings:bookingCount };
}

async function propagateVenueTypeByName(name, venueType) {
  var key = venueNameKey(name);
  if (!key) return 0;
  var normalizedType = normalizeVenueType(venueType, name);
  var count = 0;
  venues.forEach(function(v) {
    if (venueNameKey(v.name) === key) {
      v.venueType = normalizedType;
      count++;
    }
  });
  try {
    await neonSQL(
      "UPDATE venues SET venue_type=$1 WHERE LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(name,'&',' and ','g'),'[^a-zA-Z0-9]+',' ','g')))=$2",
      [normalizedType, key]
    );
  } catch(e) {
    console.warn('[OTS] venue type remote bulk update skipped:', e && (e.message || e));
  }
  return count;
}

// =======================================
// APPROVAL QUEUE
// =======================================
function renderApprovalQueue() {
  const queue = allBookings.filter(b=>b.status==='pending');
  const el    = document.getElementById('approvalQueue');
  if (!el) return; // element removed from layout - skip silently
  const canApproveSlots = hasAdminPerm('slots');
  if (!queue.length) {
    el.innerHTML=`<div class="no-pending"><span class="np-icon"></span>All caught up! No pending requests right now.</div>`;
    return;
  }
  el.innerHTML = queue.map(b=>`
    <div class="approval-card" id="ac-${b.id}">
      <div class="ac-avatar">${b.name.charAt(0)}</div>
      <div class="ac-info">
        <div class="ac-name">${b.name}</div>
        <div class="ac-meta">
          <span class="ac-tag"> ${b.venue}</span>
          <span class="ac-tag"> ${formatDate(b.date)}</span>
          <span class="ac-tag" style="color:${TYPE_COLORS[b.type]||'var(--purple)'}"> ${b.type}</span>
          <span class="ac-tag"> ${getVenueTime(b.venueId)}</span>
          ${b.notes?`<span class="ac-tag"> ${b.notes}</span>`:''}
        </div>
        <div style="font-size:.68rem;color:var(--muted);margin-top:4px;">ID: ${b.id} -  ${b.phone}</div>
      </div>
      <div class="ac-actions">
        ${canApproveSlots ? `<button class="btn-approve" onclick="approveBooking('${b.id}')"> Approve</button>
        <button class="btn-reject"  onclick="rejectBooking('${b.id}')">x Reject</button>` : '<span style="font-size:.72rem;color:var(--muted);">View only</span>'}
      </div>
    </div>`).join('');
}
async function approveBooking(id) {
  if (!requireAdminPerm('slots', 'slot approval')) return;
  const b = allBookings.find(x=>x.id===id);
  if (!b) return;
  b.status='confirmed';
  const mb = myBookings.find(x=>x.id===id);
  if (mb) mb.status='confirmed';
  _lastKnownStatuses[id] = 'confirmed';
  try {
    await dbPatch('bookings', id, {status:'confirmed'});
    notifyBookingStatusChange(b, 'confirmed');
  } catch(e) {
    console.error(e);
    notifyBookingStatusChange(b, 'confirmed');
  }
  saveLocal(); updateAdminStats(); updatePendingBadge(); renderApprovalQueue(); filterTable(); renderGigCalendar();
  logAdminAction('approve_booking', b.name + ' @ ' + b.venue + ' on ' + b.date).catch(function(){});
  showToast('','Booking Approved',`${b.name}'s slot at ${b.venue} confirmed.`);
}
async function rejectBooking(id) {
  if (!requireAdminPerm('slots', 'slot approval')) return;
  const b = allBookings.find(x=>x.id===id);
  if (!b) return;
  b.status='rejected';
  const mb = myBookings.find(x=>x.id===id);
  if (mb) mb.status='rejected';
  _lastKnownStatuses[id] = 'rejected';
  try {
    await dbPatch('bookings', id, {status:'rejected'});
    notifyBookingStatusChange(b, 'rejected');
  } catch(e) {
    console.error(e);
    notifyBookingStatusChange(b, 'rejected');
  }
  saveLocal(); updateAdminStats(); updatePendingBadge(); renderApprovalQueue(); filterTable(); renderGigCalendar();
  logAdminAction('reject_booking', b.name + ' @ ' + b.venue + ' on ' + b.date).catch(function(){});
  showToast('','Booking Rejected',`${b.name}'s request has been declined.`);
}

// =======================================
// VENUE MANAGER (ADMIN)
// =======================================
function venueTypeOptionsHtml(current) {
  var cur = normalizeVenueType(current, '');
  var options = [
    { value:'', label:'Set type' },
    { value:'GCC', label:'GCC' },
    { value:'Metro', label:'Metro' },
    { value:'Foundation', label:'Foundation' },
    { value:'Private', label:'Private' }
  ];
  return options.map(function(opt) {
    var normalized = normalizeVenueType(opt.value, '');
    var selected = (cur === normalized || (!cur && !opt.value)) ? ' selected' : '';
    return '<option value="' + otsEscapeHtml(opt.value) + '"' + selected + '>' + otsEscapeHtml(opt.label) + '</option>';
  }).join('');
}

function venueTypeInputValue(value) {
  var type = normalizeVenueType(value, '');
  if (type === 'GCC Venue') return 'GCC';
  if (type === 'Metro') return 'Metro';
  if (type === 'Foundation') return 'Foundation';
  if (type === 'Private') return 'Private';
  return '';
}

async function changeVenueType(id, value) {
  if (!requireAdminPerm('venues', 'venue editing')) return;
  var v = venues.find(function(x){ return String(x.id) === String(id); });
  if (!v) return;
  var targetType = normalizeVenueType(value, v.name);
  var affectedCount = await propagateVenueTypeByName(v.name, targetType);
  renderVenueManager();
  renderVenueList();
  if (currentAdminTab === 'reports') generateMonthlyReportPreview(false);
  saveLocal();
  try {
    await saveRemoteNow(true);
    showToast('', 'Venue Type Updated', (v.name || 'Venue') + ' is now ' + (targetType || 'uncategorized') + ' for ' + Math.max(affectedCount, 1) + ' matching venue row(s).');
    logAdminAction('venue_type_update', (v.name || id) + ' -> ' + (targetType || 'uncategorized') + ' / ' + Math.max(affectedCount, 1) + ' rows').catch(function(){});
  } catch(e) {
    console.error('[OTS] venue type update failed:', e);
    showToast('', 'Save Failed', 'Could not update venue type. Please try again.');
  }
}

function renderVenueManager() {
  const grid = document.getElementById('venueMgmtGrid');
  const canEditVenues = hasAdminPerm('venues');
  if (_adminDataLoading && !venues.length) {
    grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--muted);">Loading live venues...</div>';
    return;
  }
  if (!venues.length) { grid.innerHTML='<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--muted);">No venues yet. Add one above.</div>'; return; }
  const duplicatePlan = getDuplicateVenuePlan();
  const displayVenues = duplicatePlan.display;
  const duplicateBanner = duplicatePlan.count
    ? `<div class="venue-duplicate-banner">
        <div><strong>${duplicatePlan.count} duplicate venue row(s) hidden.</strong><span>Same venue name, date and show time. Click Remove Duplicates to clean the live database.</span></div>
        ${canEditVenues ? '<button type="button" onclick="cleanupDuplicateVenues()">Remove Duplicates</button>' : ''}
      </div>`
    : '';
  grid.innerHTML = duplicateBanner + displayVenues.map(v=>{
    const vKey = venueDuplicateKey(v);
    const isBooked = allBookings.some(function(b) {
      if (b.status !== 'confirmed') return false;
      if (b.venueId === v.id) return true;
      var bv = findVenueForBooking(b);
      return vKey && bv && venueDuplicateKey(bv) === vKey;
    });
    const bookedBadge = isBooked
      ? '<span class="vrc-badge vrc-booked">Booked</span>'
      : '';
    const venueTypeBadge = venueTypeBadgeHtml(v);
    const badgeRow = (bookedBadge || venueTypeBadge)
      ? `<div style="display:flex;gap:.4rem;margin-top:.5rem;flex-wrap:wrap;">${bookedBadge}${venueTypeBadge}</div>`
      : '';
    return `
    <div class="vmg-card">
      <div class="vmg-status ${v.status}">${v.status==='open'?'Open':'Closed'}</div>
      ${v.imageUrl ? `<img src="${v.imageUrl}" class="vmg-img" alt="${v.name}" onerror="this.style.display='none'">` : ''}
      <div class="vmg-top">
        <div class="vmg-info">
          <div class="vmg-name">${v.name}</div>
          <div class="vmg-cap"> ${v.day||''} ${formatDateShort(v.date)}</div>
          <div class="vmg-cap" style="margin-top:2px;"> ${formatVenueTimeRange(v)}</div>
          ${v.landmark ? `<div class="vmg-cap" style="margin-top:2px;color:var(--blue);"> ${otsEscapeHtml(v.landmark)}</div>` : ''}
          ${badgeRow}
          ${canEditVenues ? `<select class="vmg-type-select" onchange="changeVenueType('${otsJsString(v.id)}', this.value)" aria-label="Venue type">${venueTypeOptionsHtml(v.venueType)}</select>` : ''}
        </div>
      </div>
      <div class="vmg-actions" ${canEditVenues ? '' : 'style="display:none;"'}>
        <button class="vmg-btn vmg-edit" onclick="openVenueModal('${v.id}')"> Edit</button>
        <button class="vmg-btn vmg-toggle ${v.status==='open'?'closing':''}"
                onclick="toggleVenueStatus('${v.id}')">
          ${v.status==='open'?' Close':' Open'}
        </button>
        <button class="vmg-btn vmg-del" onclick="deleteVenue('${v.id}')" title="Delete venue" aria-label="Delete venue">Delete</button>
      </div>
      ${canEditVenues ? '' : '<div style="margin-top:.8rem;font-size:.72rem;color:var(--muted);border-top:1px solid rgba(255,255,255,.05);padding-top:.7rem;">View only</div>'}
    </div>`;
  }).join('');
}

function toggleVenueStatus(id) {
  if (!requireAdminPerm('venues', 'venue editing')) return;
  const v = venues.find(x=>x.id===id);
  if (!v) return;
  v.status = v.status==='open'?'closed':'open';
  syncCalendarToVenueDates(true);
  renderCalendar(); renderVenueManager(); renderVenueList(); updateHeroStats(); updateAdminStats(); saveAll();
  showToast(v.status==='open'?'':'',`Venue ${v.status==='open'?'Opened':'Closed'}`,`${v.name} is now ${v.status}.`);
}
async function cleanupDuplicateVenues() {
  if (!requireAdminPerm('venues', 'venue cleanup')) return;
  var plan = getDuplicateVenuePlan();
  if (!plan.count) {
    showToast('', 'No Duplicates', 'No same date/time duplicate venues found.');
    return;
  }
  if (!confirm('Remove ' + plan.count + ' duplicate venue row(s)? Bookings connected to duplicate rows will be moved to the kept venue row.')) return;
  applyDuplicateVenuePlan(plan);
  syncCalendarToVenueDates(true);
  renderCalendar(); renderVenueManager(); renderVenueList(); updateHeroStats(); updateAdminStats();
  saveLocal();
  try {
    var oldIds = Object.keys(plan.replacementMap);
    for (var i = 0; i < oldIds.length; i++) {
      var oldId = oldIds[i];
      var newId = plan.replacementMap[oldId];
      await neonSQL('UPDATE bookings SET venue_id=$1 WHERE venue_id=$2', [newId, oldId]);
    }
    for (var j = 0; j < plan.removedIds.length; j++) {
      await dbDeleteVenue(plan.removedIds[j]);
    }
    await saveRemoteNow(true);
    logAdminAction('cleanup_duplicate_venues', plan.count + ' duplicate venue rows removed').catch(function(){});
    showToast('', 'Duplicates Removed', plan.count + ' duplicate venue row(s) were cleaned from live data.');
  } catch(e) {
    console.error('[OTS] duplicate venue cleanup failed:', e);
    showToast('', 'Cleanup Failed', 'Could not clean duplicates from Neon. Refresh and try again.');
    refreshAdmin();
  }
}
function deleteVenue(id) {
  if (!requireAdminPerm('venues', 'venue editing')) return;
  const v = venues.find(x=>x.id===id);
  if (!v) { venues = venues.filter(x=>x.id!==id); renderVenueManager(); return; }
  if (!confirm(`Delete "${v.name}"? This cannot be undone.`)) return;
  venues = venues.filter(x=>x.id!==id);
  if (selectedVenueId===id) selectedVenueId=null;
  dbDeleteVenue(id);
  syncCalendarToVenueDates(true);
  renderCalendar(); renderVenueManager(); renderVenueList(); updateHeroStats(); updateAdminStats(); saveLocal();
  logAdminAction('delete_venue', v.name + ' (' + v.date + ')').catch(function(){});
  showToast('','Venue Deleted',`${v.name} has been removed.`);
}

// =======================================
// VENUE MODAL
// =======================================
function openVenueModal(id) {
  if (!requireAdminPerm('venues', 'venue editing')) return;
  editingVenueId = id;
  const v = id ? venues.find(x=>x.id===id) : null;
  document.getElementById('vm-title').textContent = v?'Edit Venue':'Add Venue';
  document.getElementById('vm-sub').textContent   = v?`Editing "${v.name}". Changes apply instantly.`:'Fill in the details. Changes will reflect immediately on the booking page.';
  document.getElementById('vm-id').value          = v?.id||'';
  document.getElementById('vm-name').value        = v?.name||'';
  document.getElementById('vm-day').value         = v?.day||'';
  document.getElementById('vm-date').value        = v?.date||'';
  document.getElementById('vm-time-start').value  = v?.timeStart||'';
  document.getElementById('vm-time-end').value    = v?.timeEnd||'';
  document.getElementById('vm-venue-type').value  = venueTypeInputValue(v?.venueType);
  document.getElementById('vm-landmark').value    = v?.landmark||'';
  document.getElementById('vm-map-url').value     = v?.mapUrl||'';
  document.getElementById('vm-image-url').value   = v?.imageUrl||'';
  var err = document.getElementById('vm-err');
  if (err) { err.textContent = ''; err.style.display = 'none'; }
  try { document.documentElement.classList.add('venue-modal-open'); } catch(e) {}
  try { document.body.classList.add('modal-lock'); } catch(e) {}
  document.getElementById('venueModal').classList.add('show');
  var mbn = document.getElementById('mobile-nav');
  if (mbn) mbn.style.display = 'none';
}
function closeVenueModal() {
  if (_venueSaving) return;
  document.getElementById('venueModal').classList.remove('show');
  try { document.documentElement.classList.remove('venue-modal-open'); } catch(e) {}
  try { document.body.classList.remove('modal-lock'); } catch(e) {}
  var mbn = document.getElementById('mobile-nav');
  if (mbn) mbn.style.display = '';
}
async function saveVenue() {
  if (!requireAdminPerm('venues', 'venue editing')) return;
  if (_venueSaving) return;
  var saveBtn = document.getElementById('vm-save-btn');
  var errBox = document.getElementById('vm-err');
  if (errBox) { errBox.textContent = ''; errBox.style.display = 'none'; }
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
  _venueSaving = true;
  try {
    var getVal = function(id) {
      var el = document.getElementById(id);
      return el ? String(el.value || '').trim() : '';
    };
    const name       = getVal('vm-name');
    let day          = getVal('vm-day');
    const date       = getVal('vm-date');
    const timeStart  = getVal('vm-time-start');
    const timeEnd    = getVal('vm-time-end');
    const confirmStatus = 'Available';
    const visibility    = 'Public';
    const venueType     = normalizeVenueType(getVal('vm-venue-type'), name);
    const landmark      = getVal('vm-landmark');
    const mapUrl        = getVal('vm-map-url');
    const imageUrl      = getVal('vm-image-url');

    if (!name || !date || !timeStart || !timeEnd) {
      var missing = [];
      if (!name) missing.push('venue name');
      if (!date) missing.push('date');
      if (!timeStart) missing.push('show slot start');
      if (!timeEnd) missing.push('show slot end');
      if (errBox) {
        errBox.textContent = 'Please fill ' + missing.join(', ') + '.';
        errBox.style.display = 'block';
        errBox.scrollIntoView({ block:'nearest', behavior:'smooth' });
      }
      showToast('','Missing Fields','Name, date and slot times are required.');
      return;
    }
    if (!day) {
      day = new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday:'long' });
      var dayEl = document.getElementById('vm-day');
      if (dayEl) dayEl.value = day;
    }

    var duplicateVenue = findDuplicateVenue({ name:name, date:date, timeStart:timeStart, timeEnd:timeEnd }, editingVenueId);
    if (duplicateVenue) {
      var dupMsg = '"' + name + '" is already added for ' + formatDate(date) + ' at ' + formatVenueTimeRange({ timeStart:timeStart, timeEnd:timeEnd }) + '.';
      if (errBox) {
        errBox.textContent = dupMsg;
        errBox.style.display = 'block';
        errBox.scrollIntoView({ block:'nearest', behavior:'smooth' });
      }
      showToast('', 'Duplicate Venue', dupMsg);
      return;
    }

    if (editingVenueId) {
      const v = venues.find(x=>x.id===editingVenueId);
      var oldVenueName = v ? v.name : '';
      if (v) Object.assign(v,{name,day,date,timeStart,timeEnd,confirmStatus,visibility,venueType,landmark,mapUrl,imageUrl});
      var renameResult = await propagateVenueRename(oldVenueName, name, editingVenueId);
      var typeCount = await propagateVenueTypeByName(name, venueType);
      if (typeof logAdminAction === 'function') logAdminAction('edit_venue', name + ' (' + date + ')' + (renameResult.venues > 1 ? ' - renamed ' + renameResult.venues + ' venue rows' : '') + ' - type rows ' + typeCount).catch(function(){});
      showToast('','Venue Updated', `"${name}" updated. Venue type applied to ${Math.max(typeCount, 1)} matching row(s).`);
    } else {
      venues.push({id:'v-'+Date.now(),name,day,date,timeStart,timeEnd,confirmStatus,visibility,venueType,landmark,mapUrl,imageUrl,status:'open'});
      var addTypeCount = await propagateVenueTypeByName(name, venueType);
      if (typeof logAdminAction === 'function') logAdminAction('add_venue', name + ' (' + date + ')').catch(function(){});
      showToast('','Venue Added',`"${name}" is now live. Venue type applied to ${Math.max(addTypeCount, 1)} matching row(s).`);
    }
    _venueSaving = false;
    closeVenueModal();
    syncCalendarToVenueDates(true);
    renderCalendar(); renderVenueManager(); renderVenueList(); updateHeroStats(); updateAdminStats();
    saveLocal();
    await saveRemoteNow(true);
  } catch(e) {
    console.error('[OTS] saveVenue failed:', e);
    if (errBox) {
      errBox.textContent = (e && e.message) ? e.message : 'Could not save venue. Please try again.';
      errBox.style.display = 'block';
    }
    showToast('', 'Save Failed', (e && e.message) ? e.message : 'Could not save venue. Please try again.');
  } finally {
    _venueSaving = false;
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Venue'; }
  }
}

// =======================================
// CSV IMPORT
// =======================================
function handleCSVFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const text = e.target.result;
    parseAndPreviewCSV(text);
  };
  reader.readAsText(file);
}

function parseCSVRecords(text) {
  const records = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const src = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' && !inQuotes) {
      row.push(cell);
      if (row.some(v => String(v || '').trim())) records.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some(v => String(v || '').trim())) records.push(row);
  return records;
}

function cleanCSVCell(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseAndPreviewCSV(text) {
  const records = parseCSVRecords(text);
  if (!records.length) { showToast('','Empty File','The CSV file has no content.'); return; }

  // detect & skip header row
  const firstLow = records[0].join(',').toLowerCase();
  const hasHeader = firstLow.includes('day') || firstLow.includes('date') || firstLow.includes('venue') || firstLow.includes('slot');
  const dataRows = hasHeader ? records.slice(1) : records;

  csvParsedRows = [];
  const existingImportKeys = new Set((venues || []).map(venueDuplicateKey).filter(Boolean));
  const seenImportKeys = new Set();

  dataRows.forEach(colsRaw => {
    const cols = (colsRaw || []).map(cleanCSVCell);
    if (!cols.some(c => c)) return;

    // Col order: Day, Date, Show Slot, Event/Campaign, Venue
    const day      = cols[0] || '';
    const dateRaw  = cols[1] || '';
    const slotRaw  = cols[2] || '';
    const campaignRaw = cols[3] || '';
    const name     = (cols[4] || '').trim();
    const venueTypeRaw = (cols[5] || '').trim();
    const confirmRaw = (cols[6] || '').trim();

    // -- Convert date: accepts "1-Jan-2026", "01/01/2026", "2026-01-01" --
    const MONTHS = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
    let isoDate = '';
    const dmy = dateRaw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    const dMonY = dateRaw.match(/^(\d{1,2})[\/\-]([A-Za-z]+)[\/\-](\d{4})$/);
    const ymd = dateRaw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (dMonY) {
      const mon = MONTHS[dMonY[2].toLowerCase().slice(0,3)];
      if (mon) isoDate = `${dMonY[3]}-${String(mon).padStart(2,'0')}-${dMonY[1].padStart(2,'0')}`;
    } else if (dmy) {
      isoDate = `${dmy[3]}-${dmy[2].padStart(2,'0')}-${dmy[1].padStart(2,'0')}`;
    } else if (ymd) {
      isoDate = `${ymd[1]}-${ymd[2].padStart(2,'0')}-${ymd[3].padStart(2,'0')}`;
    }

    // -- Parse slot: "6:30 - 7:30 PM", "6:00 to 8:00 PM", "18:00-21:00" --
    function parseSlotTime(raw) {
      // split on " - ", " to ", "-", "-"
      const parts = String(raw || '').split(/\s*(?:--?|–|—|\bto\b)\s*/i).map(s=>s.trim()).filter(Boolean);
      function to24(t) {
        // t may be like "6:30 PM", "6:30", "18:00"
        const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
        if (!m) return '';
        let h = parseInt(m[1]), min = m[2], ap = (m[3]||'').toUpperCase();
        if (ap==='PM' && h!==12) h+=12;
        if (ap==='AM' && h===12) h=0;
        return `${String(h).padStart(2,'0')}:${min}`;
      }
      // strip trailing AM/PM from first part if second part carries it
      const hasAMPM = /[AP]M/i.test(raw);
      let start = parts[0], end = parts[1]||'';
      // if end has AM/PM and start doesn't, carry it over
      const endAP = end.match(/(AM|PM)$/i);
      if (endAP && !/[AP]M/i.test(start)) {
        const startHour = parseInt((start.match(/^(\d{1,2})/) || [])[1], 10);
        const endHour = parseInt((end.match(/^(\d{1,2})/) || [])[1], 10);
        const ap = endAP[1].toUpperCase();
        if (ap === 'PM' && endHour === 12 && startHour && startHour < 12) start += ' AM';
        else if (ap === 'AM' && endHour === 12 && startHour && startHour < 12) start += ' PM';
        else start += ' ' + ap;
      }
      return { timeStart: to24(start), timeEnd: to24(end) };
    }
    const { timeStart, timeEnd } = parseSlotTime(slotRaw);

    // -- Map confirmStatus: "Confirmed"  "Available" --
    let confirmStatus = 'Available';
    if (/pending/i.test(confirmRaw))   confirmStatus = 'Pending';
    else if (/cancel/i.test(confirmRaw)) confirmStatus = 'Cancelled';

    // -- Validation --
    let rowStatus = 'new', errMsg = '';
    const rowKey = venueDuplicateKey({ name, date: isoDate, timeStart, timeEnd });
    if (!name)          { rowStatus='err'; errMsg='Missing Venue name'; }
    else if (!isoDate)  { rowStatus='err'; errMsg=`Unrecognised date: "${dateRaw}"`; }
    else if (!timeStart){ rowStatus='err'; errMsg=`Unrecognised slot: "${slotRaw}"`; }
    else if (existingImportKeys.has(rowKey)) { rowStatus='dup'; errMsg='Already exists in saved venues'; }
    else if (seenImportKeys.has(rowKey)) { rowStatus='dup'; }
    else seenImportKeys.add(rowKey);

    const venueType = normalizeVenueType(venueTypeRaw || campaignRaw, name);
    csvParsedRows.push({ day:day.trim(), date:isoDate, rawDate:dateRaw, timeStart, timeEnd, slotRaw, name, venueType, confirmStatus, visibility:'Public', rowStatus, errMsg });
  });

  renderCSVPreview();
}

function renderCSVPreview() {
  const wrap = document.getElementById('csvPreviewWrap');
  const body = document.getElementById('csvPreviewBody');
  const summary = document.getElementById('csvSummary');
  const importBtn = document.getElementById('csvImportBtn');

  if (!csvParsedRows.length) { wrap.style.display='none'; return; }
  wrap.style.display = 'block';

  const newCount = csvParsedRows.filter(r=>r.rowStatus==='new').length;
  const dupCount = csvParsedRows.filter(r=>r.rowStatus==='dup').length;
  const errCount = csvParsedRows.filter(r=>r.rowStatus==='err').length;

  document.getElementById('csvPreviewTitle').textContent =
    `Preview - ${csvParsedRows.length} row${csvParsedRows.length!==1?'s':''} found`;

  summary.innerHTML =
    `<span style="color:var(--green)">${newCount} new</span> - ` +
    `<span style="color:var(--yellow)">${dupCount} duplicate${dupCount!==1?'s':''}</span> - ` +
    `<span style="color:var(--red)">${errCount} error${errCount!==1?'s':''}</span>`;

  importBtn.disabled = newCount === 0;

  body.innerHTML = csvParsedRows.map(r => `
      <div class="csv-preview-row" style="grid-template-columns:60px 100px 140px 1fr 80px;">
      <div style="font-size:.78rem;color:var(--muted);">${r.day||'-'}</div>
      <div style="font-size:.78rem;color:var(--muted);">${r.rawDate||formatDateShort(r.date)}</div>
      <div style="font-size:.78rem;">${r.timeStart?formatVenueTimeRange(r):'-'}</div>
      <div style="font-size:.82rem;font-weight:600;">${r.name||'<em style="color:var(--muted)">-</em>'}${r.venueType?`<div style="margin-top:.3rem;">${venueTypeBadgeHtml(r)}</div>`:''}${r.errMsg?`<div style="font-size:.68rem;color:var(--red);margin-top:2px;">${r.errMsg}</div>`:''}</div>
      <div><span class="csv-row-status ${r.rowStatus}">${r.rowStatus==='new'?'New':r.rowStatus==='dup'?'Duplicate':'Error'}</span></div>
    </div>`).join('');
}

function importCSVVenues() {
  if (!requireAdminPerm('venues', 'venue importing')) return;
  const toAdd = csvParsedRows.filter(r => r.rowStatus === 'new');
  if (!toAdd.length) return;
  toAdd.forEach(r => {
    venues.push({
      id: 'v-'+Date.now()+'-'+Math.random().toString(36).substr(2,4),
      name: r.name, day: r.day, date: r.date, timeStart: r.timeStart, timeEnd: r.timeEnd,
      confirmStatus: r.confirmStatus,
      visibility: r.visibility, venueType: r.venueType || normalizeVenueType('', r.name), landmark:'', mapUrl:'', status: 'open'
    });
  });
  syncCalendarToVenueDates(true);
  renderCalendar(); renderVenueList(); renderVenueManager(); updateHeroStats(); updateAdminStats(); saveAll();
  logAdminAction('import_venues', toAdd.length + ' venue(s) imported via CSV').catch(function(){});
  showToast('', `${toAdd.length} Venue${toAdd.length!==1?'s':''} Imported`, `Now visible on the booking page.`);
  clearCSV();
  switchAdminTab('venues');
}

function clearCSV() {
  csvParsedRows = [];
  document.getElementById('csvPreviewWrap').style.display = 'none';
  document.getElementById('csvFileInput').value = '';
}

// drag & drop on the zone
document.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('csvDropZone');
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag');
    const file = e.dataTransfer.files[0];
    if (file) handleCSVFile(file);
  });
  // Member CSV drag & drop
  const mzone = document.getElementById('memberCsvZone');
  if (mzone) {
    mzone.addEventListener('dragover', e => { e.preventDefault(); mzone.classList.add('drag'); });
    mzone.addEventListener('dragleave', () => mzone.classList.remove('drag'));
    mzone.addEventListener('drop', e => {
      e.preventDefault(); mzone.classList.remove('drag');
      const file = e.dataTransfer.files[0];
      if (file) handleMemberCSV(file);
    });
  }
});

// =======================================
// ALL BOOKINGS TABLE
// =======================================
function setFilter(f) {
  currentFilter=f;
  bookingPage = 1;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  var filterBtn = document.getElementById('filter-'+f);
  if (filterBtn) filterBtn.classList.add('active');
  filterTable();
}
function isBookingNeedsProofOrPoint(b) {
  return !!(b && b.status === 'confirmed' && isBookingShowOver(b, new Date()) && !b.proofClaimed);
}
function bookingFollowUpState(b) {
  if (!b || b.status !== 'confirmed') return { cls:'info', label:'-' };
  if (!isBookingShowOver(b, new Date())) return { cls:'info', label:'Upcoming' };
  if (b.proofClaimed) return { cls:'done', label:'Claimed' };
  if (!b.proofUrl) return { cls:'missing', label:'Photo Missing' };
  return { cls:'pending', label:'Claim Pending' };
}
function filterTable() {
  const q=(document.getElementById('adminSearch')?.value||'').toLowerCase();
  bookingPage = Math.max(1, bookingPage || 1);
  let rows=[...allBookings];
  if (currentFilter === 'needsProof') rows = rows.filter(isBookingNeedsProofOrPoint);
  else if (currentFilter!=='all') rows=rows.filter(b=>b.status===currentFilter);
  if (q) rows=rows.filter(b=>
    String(b.name||'').toLowerCase().includes(q) ||
    String(getBookingPersonName(b)||'').toLowerCase().includes(q) ||
    String(b.venue||'').toLowerCase().includes(q) ||
    String(b.phone||'').toLowerCase().includes(q) ||
    String(b.email||'').toLowerCase().includes(q) ||
    String(b.id||'').toLowerCase().includes(q)
  );
  rows.sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||'')); // newest first
  renderAdminTable(rows);
}
function changeBookingPage(delta) {
  bookingPage = Math.max(1, (bookingPage || 1) + delta);
  filterTable();
}
function setBookingPageSize(value) {
  bookingPageSize = Math.max(10, parseInt(value, 10) || 50);
  bookingPage = 1;
  filterTable();
}
function renderBookingPager(totalRows) {
  var pager = document.getElementById('bookingPager');
  if (!pager) return;
  var totalPages = Math.max(1, Math.ceil(totalRows / bookingPageSize));
  bookingPage = Math.min(Math.max(1, bookingPage || 1), totalPages);
  var start = totalRows ? ((bookingPage - 1) * bookingPageSize) + 1 : 0;
  var end = Math.min(totalRows, bookingPage * bookingPageSize);
  pager.innerHTML = `
    <div class="admin-pager-info">Showing ${start}-${end} of ${totalRows} booking${totalRows === 1 ? '' : 's'}</div>
    <div class="admin-pager-actions">
      <select class="admin-page-size" onchange="setBookingPageSize(this.value)">
        <option value="25" ${bookingPageSize===25?'selected':''}>25 / page</option>
        <option value="50" ${bookingPageSize===50?'selected':''}>50 / page</option>
        <option value="100" ${bookingPageSize===100?'selected':''}>100 / page</option>
      </select>
      <button class="admin-page-btn" onclick="changeBookingPage(-1)" ${bookingPage<=1?'disabled':''}>Prev</button>
      <span class="admin-pager-info">Page ${bookingPage} / ${totalPages}</span>
      <button class="admin-page-btn" onclick="changeBookingPage(1)" ${bookingPage>=totalPages?'disabled':''}>Next</button>
    </div>`;
}
function renderAdminProofCell(b, canRescueShows) {
  var id = otsJsString(b && b.id || '');
  var rescueButtons = canRescueShows && b.status === 'confirmed'
    ? `<button class="btn-secondary" style="font-size:.62rem;padding:.25rem .45rem;margin-top:.3rem;" onclick="adminAllowProofUpload('${id}')">Allow Upload</button>
       <button class="btn-secondary" style="font-size:.62rem;padding:.25rem .45rem;margin-top:.3rem;" onclick="adminGrantShowPoint('${id}','team')">Add Member</button>`
    : '';
  if (b.proofClaimed) {
    var proofPreview = b.proofUrl && isProofPlaceholder(b.proofUrl)
      ? `<button class="btn-secondary" style="font-size:.62rem;padding:.25rem .45rem;" onclick="adminViewProof('${id}')">View Photo</button>`
      : (b.proofUrl ? `<div style="display:flex;align-items:center;gap:.4rem;cursor:pointer;" onclick="adminViewProof('${id}')">
           <img src="${b.proofUrl}" style="width:36px;height:36px;object-fit:cover;border-radius:4px;border:1.5px solid var(--green);" alt="proof">
           <span style="font-size:.65rem;font-weight:700;color:var(--green);letter-spacing:.04em;"> CLAIMED</span>
         </div>` : `<span style="font-size:.68rem;color:var(--green);font-weight:800;letter-spacing:.04em;">CLAIMED</span>`);
    return proofPreview + rescueButtons;
  }
  if (b.proofUrl) {
    return `<span style="font-size:.68rem;color:var(--yellow);font-weight:600;"> Uploaded</span>
      ${canRescueShows && b.status === 'confirmed' ? `<button class="btn-secondary" style="font-size:.62rem;padding:.25rem .45rem;margin-top:.3rem;" onclick="adminGrantShowPoint('${id}','team')">Add Member</button>` : ''}`;
  }
  if (b.checkinAt) {
    return `<div style="display:flex;flex-direction:column;gap:.15rem;">
       <span style="font-size:.68rem;color:var(--green);font-weight:800;letter-spacing:.04em;">Reached</span>
       <span style="font-size:.62rem;color:var(--muted);">${formatCheckinTime(b.checkinAt)}</span>
       ${b.checkinMapUrl ? `<a href="${otsEscapeHtml(b.checkinMapUrl)}" target="_blank" rel="noopener" style="font-size:.62rem;color:var(--blue);font-weight:700;">Open location</a>` : ''}
       ${canRescueShows && b.status === 'confirmed' ? `<button class="btn-secondary" style="font-size:.62rem;padding:.25rem .45rem;margin-top:.25rem;" onclick="adminAllowProofUpload('${id}')">Allow Upload</button>
       <button class="btn-secondary" style="font-size:.62rem;padding:.25rem .45rem;margin-top:.25rem;" onclick="adminGrantShowPoint('${id}','team')">Add Member</button>` : ''}
     </div>`;
  }
  if (b.status === 'confirmed' && canRescueShows) {
    return `<div style="display:flex;flex-direction:column;gap:.3rem;align-items:flex-start;">
       <span style="font-size:.68rem;color:var(--muted);">No check-in</span>
       <button class="btn-secondary" style="font-size:.62rem;padding:.25rem .45rem;" onclick="adminAllowProofUpload('${id}')">Allow Upload</button>
       <button class="btn-secondary" style="font-size:.62rem;padding:.25rem .45rem;" onclick="adminGrantShowPoint('${id}','team')">Add Member</button>
     </div>`;
  }
  return `<span style="font-size:.68rem;color:var(--muted);">-</span>`;
}
function renderAdminTable(rows) {
  const tbody=document.getElementById('adminTable');
  const canApproveSlots = hasAdminPerm('slots');
  const canRescueShows = canApproveSlots || hasAdminPerm('claims');
  rows = rows || [];
  renderBookingPager(rows.length);
  if (_adminDataLoading && !allBookings.length) {
    tbody.innerHTML=`<div class="table-empty"><span class="emoji"></span>Loading live bookings...</div>`;
    return;
  }
  if (!rows.length){
    tbody.innerHTML=`<div class="table-empty"><span class="emoji"></span>${currentFilter === 'needsProof' ? 'No completed shows are waiting for proof or manual point.' : 'No bookings match.'}</div>`;
    return;
  }
  var pageRows = rows.slice((bookingPage - 1) * bookingPageSize, bookingPage * bookingPageSize);
  tbody.innerHTML=pageRows.map(b=>{
    var follow = bookingFollowUpState(b);
    return `
    <div class="tbl-row" id="admin-booking-${b.id}">
      <div class="td">
        <div style="font-weight:700;font-size:.85rem">${otsEscapeHtml(b.name || '-')}</div>
        <div style="font-size:.7rem;color:var(--blue);font-weight:700;margin-top:.15rem;">Booked by: ${otsEscapeHtml(getBookingPersonName(b) || '-')}</div>
        <div style="font-size:.72rem;color:var(--muted);margin-top:.15rem;">${otsEscapeHtml(b.venue || '-')}</div>
      </div>
      <div class="td muted">${formatDate(b.date)}</div>
      <div class="td"><span style="font-size:.8rem;font-weight:600;color:${TYPE_COLORS[b.type]||'var(--purple)'}">${b.type}</span></div>
      <div class="td" style="font-weight:600;">${getVenueTime(b.venueId)}</div>
      <div class="td"><span class="td-badge ${b.status}">${b.status}</span></div>
      <div class="td">${renderAdminProofCell(b, canRescueShows)}</div>
      <div class="td"><span class="td-followup ${follow.cls}">${follow.label}</span></div>
      <div class="td td-actions">
        ${canApproveSlots ? `<button class="btn-secondary" style="font-size:.62rem;padding:.24rem .45rem;margin-top:.3rem;" onclick="openAdminBookingEdit('${otsJsString(b.id)}', event)">Edit</button>` : ''}
        ${b.status==='pending' && canApproveSlots ? `
          <button class="action-btn approve" onclick="approveBooking('${b.id}')"></button>
          <button class="action-btn reject"  onclick="rejectBooking('${b.id}')">x</button>`
        : b.status==='confirmed' && canApproveSlots ? `<button class="action-btn del" onclick="adminCancel('${b.id}')">Cancel</button>`
        :`<span style="font-size:.72rem;color:var(--muted)">-</span>`}
        ${canRescueShows ? `<button class="btn-secondary" style="font-size:.62rem;padding:.24rem .45rem;margin-top:.3rem;" onclick="adminRestoreClearedRequest('${b.id}')">Restore</button>` : ''}
      </div>
    </div>`;
  }).join('');
}
function formatCheckinTime(value) {
  if (!value) return '';
  try {
    return new Date(value).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  } catch(e) {
    return '';
  }
}

var _adminBookingEditId = null;
var _adminBookingEditMode = 'edit';

function suspendAdminBookingEditFileInputs(enable) {
  if (!enable) {
    (_adminBookingEditSuspendedFiles || []).forEach(function(item) {
      if (!item || !item.el) return;
      item.el.disabled = item.disabled;
      item.el.style.pointerEvents = item.pointerEvents;
    });
    _adminBookingEditSuspendedFiles = [];
    return;
  }
  suspendAdminBookingEditFileInputs(false);
  _adminBookingEditSuspendedFiles = Array.from(document.querySelectorAll('input[type="file"]')).map(function(el) {
    var item = {
      el: el,
      disabled: !!el.disabled,
      pointerEvents: el.style.pointerEvents || ''
    };
    if (!el.closest('#adminBookingEditModal')) {
      el.disabled = true;
      el.style.pointerEvents = 'none';
    }
    return item;
  });
}

function _setAdminBookingEditError(message) {
  var el = document.getElementById('abe-err');
  if (!el) return;
  el.textContent = message || '';
  el.style.display = message ? '' : 'none';
}

function _bookingTypeOptionsValue(value) {
  var typeEl = document.getElementById('abe-type');
  if (!typeEl) return;
  var val = String(value || '');
  if (typeEl.tagName !== 'SELECT') {
    typeEl.value = val;
    var list = document.getElementById('abe-type-options');
    if (list && val && !Array.from(list.options || []).some(function(o){ return o.value === val; })) {
      var opt = document.createElement('option');
      opt.value = val;
      list.appendChild(opt);
    }
    return;
  }
  var found = false;
  Array.from(typeEl.options).forEach(function(o){ if (o.value === val || o.textContent === val) found = true; });
  if (!found && val) {
    var opt = document.createElement('option');
    opt.value = val;
    opt.textContent = val;
    typeEl.appendChild(opt);
  }
  typeEl.value = val;
}

function populateAdminBookingVenueSelect(selectedId, selectedName) {
  var select = document.getElementById('abe-venue');
  if (!select) return;
  var opts = ['<option value="">Custom / no venue record</option>'];
  (venues || []).slice().sort(function(a,b){
    return String(a.date || '').localeCompare(String(b.date || '')) ||
           String(a.timeStart || '').localeCompare(String(b.timeStart || '')) ||
           String(a.name || '').localeCompare(String(b.name || ''));
  }).forEach(function(v) {
    var label = (v.name || '-') + (v.date ? ' - ' + formatDate(v.date) : '') + (v.timeStart ? ' - ' + formatVenueTimeRange(v) : '');
    opts.push('<option value="' + otsEscapeHtml(v.id) + '">' + otsEscapeHtml(label) + '</option>');
  });
  select.innerHTML = opts.join('');
  if (selectedId && (venues || []).some(function(v){ return v.id === selectedId; })) {
    select.value = selectedId;
  } else {
    select.value = '';
  }
  var nameEl = document.getElementById('abe-venue-name');
  if (nameEl) nameEl.value = selectedName || '';
}

function adminBookingVenueChanged() {
  var select = document.getElementById('abe-venue');
  var v = select && select.value ? venues.find(function(x){ return x.id === select.value; }) : null;
  if (!v) return;
  var nameEl = document.getElementById('abe-venue-name');
  var dateEl = document.getElementById('abe-date');
  if (nameEl) nameEl.value = v.name || '';
  if (dateEl && v.date) dateEl.value = v.date;
}

function openAdminBookingEdit(id, event) {
  if (event) {
    try { event.preventDefault(); event.stopPropagation(); } catch(e) {}
  }
  if (!requireAdminPerm('slots', 'edit booking')) return;
  var b = allBookings.find(function(x){ return x.id === id; });
  if (!b) return;
  _adminBookingEditId = id;
  _adminBookingEditMode = 'edit';
  var modal = document.getElementById('adminBookingEditModal');
  if (!modal) return;
  document.getElementById('abe-title').textContent = 'Edit Booking';
  document.getElementById('abe-sub').textContent = 'Use this for last-minute team, venue or status changes.';
  document.getElementById('abe-save-btn').textContent = 'Save Changes';
  populateAdminBookingVenueSelect(b.venueId || '', b.venue || '');
  document.getElementById('abe-date').value = b.date || '';
  _bookingTypeOptionsValue(b.type || '');
  document.getElementById('abe-team').value = b.name || '';
  document.getElementById('abe-booked-by').value = getBookingPersonName(b) || '';
  document.getElementById('abe-phone').value = b.phone || '';
  document.getElementById('abe-email').value = b.email || '';
  document.getElementById('abe-status').value = b.status || 'pending';
  document.getElementById('abe-notes').value = b.notes || '';
  _setAdminBookingEditError('');
  suspendAdminBookingEditFileInputs(true);
  try { document.body.classList.add('modal-lock', 'admin-booking-edit-open'); } catch(e) {}
  modal.classList.add('show');
  setTimeout(function(){
    var first = document.getElementById('abe-team');
    if (first) {
      try { first.focus({ preventScroll:true }); } catch(e) { try { first.focus(); } catch(_e) {} }
    }
  }, 80);
}

function openAdminEmergencyCredit() {
  if (!requireAdminPerm('claims', 'emergency show credit')) return;
  _adminBookingEditId = null;
  _adminBookingEditMode = 'manual-credit';
  var modal = document.getElementById('adminBookingEditModal');
  if (!modal) return;
  document.getElementById('abe-title').textContent = 'Emergency Show Credit';
  document.getElementById('abe-sub').textContent = 'For verified shows that happened without a booking. This creates a confirmed admin booking and adds 1 show count + 1 point.';
  document.getElementById('abe-save-btn').textContent = 'Create & Add Point';
  populateAdminBookingVenueSelect('', '');
  document.getElementById('abe-date').value = new Date().toISOString().slice(0, 10);
  _bookingTypeOptionsValue('');
  document.getElementById('abe-team').value = '';
  document.getElementById('abe-booked-by').value = currentAdminUsername || 'Admin';
  document.getElementById('abe-phone').value = '';
  document.getElementById('abe-email').value = '';
  document.getElementById('abe-status').value = 'confirmed';
  document.getElementById('abe-notes').value = 'Emergency admin show credit';
  _setAdminBookingEditError('');
  suspendAdminBookingEditFileInputs(true);
  try { document.body.classList.add('modal-lock', 'admin-booking-edit-open'); } catch(e) {}
  modal.classList.add('show');
}

function openAdminEmergencyUpload() {
  if (!requireAdminPerm('claims', 'emergency upload access')) return;
  openAdminEmergencyCredit();
  _adminBookingEditMode = 'manual-upload';
  document.getElementById('abe-title').textContent = 'Emergency Upload Access';
  document.getElementById('abe-sub').textContent = 'For verified shows that happened without a booking. This creates a confirmed request so the member can upload proof after the show.';
  document.getElementById('abe-save-btn').textContent = 'Create Upload Access';
  document.getElementById('abe-notes').value = 'Emergency admin upload access';
}

function closeAdminBookingEdit() {
  var modal = document.getElementById('adminBookingEditModal');
  if (modal) modal.classList.remove('show');
  try { document.body.classList.remove('modal-lock', 'admin-booking-edit-open'); } catch(e) {}
  suspendAdminBookingEditFileInputs(false);
  _adminBookingEditId = null;
}

function readAdminBookingEditForm() {
  var venueId = document.getElementById('abe-venue').value || '';
  var selectedVenue = venueId ? venues.find(function(v){ return v.id === venueId; }) : null;
  var venueName = (document.getElementById('abe-venue-name').value || '').trim().replace(/\s+/g, ' ');
  if (selectedVenue && !venueName) venueName = selectedVenue.name || '';
  return {
    venueId: venueId,
    venue: venueName,
    date: (document.getElementById('abe-date').value || '').trim(),
    type: (document.getElementById('abe-type').value || '').trim(),
    name: (document.getElementById('abe-team').value || '').trim().replace(/\s+/g, ' '),
    bookedBy: (document.getElementById('abe-booked-by').value || '').trim().replace(/\s+/g, ' '),
    phone: (document.getElementById('abe-phone').value || '').trim(),
    email: (document.getElementById('abe-email').value || '').trim().toLowerCase(),
    status: (document.getElementById('abe-status').value || 'pending').trim(),
    visibility: 'Public',
    notes: (document.getElementById('abe-notes').value || '').trim()
  };
}

function validateAdminBookingEdit(data) {
  if (!data.venue) return 'Venue name is required.';
  if (!data.date) return 'Date is required.';
  if (!data.type) return 'Slot type is required.';
  if (!data.name) return 'Team / performer name is required.';
  if ((_adminBookingEditMode === 'manual-credit' || _adminBookingEditMode === 'manual-upload') && !data.phone) return 'Registered phone is required to map this show to the member.';
  if (!data.phone && !data.email) return 'Phone or email is required so the member can receive updates.';
  return '';
}

async function saveAdminBookingEdit() {
  var saveBtn = document.getElementById('abe-save-btn');
  var data = readAdminBookingEditForm();
  var error = validateAdminBookingEdit(data);
  if (error) { _setAdminBookingEditError(error); return; }
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = (_adminBookingEditMode === 'manual-credit' || _adminBookingEditMode === 'manual-upload') ? 'Creating...' : 'Saving...'; }
  try {
    if (_adminBookingEditMode === 'manual-credit') {
      await createEmergencyShowCredit(data);
    } else if (_adminBookingEditMode === 'manual-upload') {
      await createEmergencyUploadAccess(data);
    } else {
      await saveExistingBookingEdit(data);
    }
    closeAdminBookingEdit();
  } catch(e) {
    console.error('[OTS] save admin booking edit:', e);
    _setAdminBookingEditError((e && e.message) || 'Could not save. Please try again.');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = _adminBookingEditMode === 'manual-credit' ? 'Create & Add Point' : _adminBookingEditMode === 'manual-upload' ? 'Create Upload Access' : 'Save Changes';
    }
  }
}

async function saveExistingBookingEdit(data) {
  if (!requireAdminPerm('slots', 'edit booking')) return;
  var b = allBookings.find(function(x){ return x.id === _adminBookingEditId; });
  if (!b) throw new Error('Booking not found.');
  var oldStatus = b.status;
  var saved = await updateBookingDetailsAndReadBack(b.id, data, b.name);
  Object.assign(b, saved || {
    venueId: data.venueId,
    venue: data.venue,
    date: data.date,
    type: data.type,
    name: data.name,
    bookedBy: data.bookedBy,
    phone: data.phone,
    email: data.email,
    notes: data.notes,
    visibility: data.visibility,
    status: data.status
  });
  var mb = myBookings.find(function(x){ return x.id === b.id; });
  if (mb) Object.assign(mb, b);
  saveLocal();
  renderUserBookings();
  renderGigCalendar();
  renderVenueList();
  filterTable();
  updatePendingBadge();
  updateAdminStats();
  if (oldStatus !== data.status) notifyBookingStatusChange(b, data.status);
  else notifyMemberUpdate({
    updateType: 'booking_update',
    status: data.status,
    bookingId: b.id,
    venue: b.venue,
    date: b.date,
    phone: b.phone,
    email: b.email,
    memberName: b.name,
    reason: 'Booking details updated by admin'
  });
  logAdminAction('edit_booking', data.name + ' @ ' + data.venue + ' #' + b.id).catch(function(){});
  showToast('', 'Booking Updated', 'Changes are saved and synced.');
}

async function updateBookingDetailsAndReadBack(id, data, oldTeamName) {
  var updateSql =
    'UPDATE bookings SET venue_id=$2, venue=$3, date=$4, type=$5, name=$6, booked_by=$7, phone=$8, email=$9, notes=$10, visibility=$11, status=$12 WHERE id=$1';
  var params = [
    id,
    data.venueId,
    data.venue,
    data.date,
    data.type,
    data.name,
    data.bookedBy,
    data.phone,
    data.email,
    data.notes,
    data.visibility,
    data.status
  ];
  await neonSQL(updateSql, params);
  if (oldTeamName && oldTeamName !== data.name) {
    neonSQL(
      "UPDATE claims SET member_name=$2 WHERE booking_id=$1 AND COALESCE(member_name,'')=$3",
      [id, data.name, oldTeamName]
    ).catch(function(){});
  }
  var rows = await neonSQL(
    'SELECT id, venue_id, venue, date, type, name, booked_by, phone, email, notes, visibility, status, created_at,' +
    LIGHT_PROOF_SQL + ',proof_claimed,checkin_at,checkin_lat,checkin_lng,checkin_accuracy,checkin_map_url,performers FROM bookings WHERE id=$1 LIMIT 1',
    [id]
  );
  if (!rows || !rows.length) throw new Error('Booking save failed: row was not found after update.');
  var saved = mapBookingRows(rows)[0];
  var mismatches = [];
  if (String(saved.type || '') !== String(data.type || '')) mismatches.push('type');
  if (String(saved.name || '') !== String(data.name || '')) mismatches.push('team name');
  if (String(saved.bookedBy || '') !== String(data.bookedBy || '')) mismatches.push('booked by');
  if (mismatches.length) {
    throw new Error('Booking save did not update ' + mismatches.join(', ') + '. Please refresh and try again.');
  }
  return saved;
}

async function createEmergencyShowCredit(data) {
  if (!requireAdminPerm('claims', 'emergency show credit')) return;
  var member = data.phone ? await adminFindMemberByPhone(data.phone) : null;
  var memberName = data.name || (member && member.name) || data.phone || data.email || 'Member';
  var bookingId = 'OTS-MANUAL-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
  var booking = {
    id: bookingId,
    venueId: data.venueId,
    venue: data.venue,
    date: data.date,
    type: data.type,
    name: memberName,
    bookedBy: data.bookedBy || currentAdminUsername || 'Admin',
    phone: data.phone,
    email: data.email || (member && member.email) || '',
    notes: data.notes || 'Emergency admin show credit',
    price: 0,
    visibility: data.visibility || 'Public',
    status: 'confirmed',
    createdAt: new Date().toISOString(),
    proofUrl: '',
    proofClaimed: true,
    checkinAt: new Date().toISOString()
  };
  await sbUpsert('bookings', [{
    id: booking.id,
    venue_id: booking.venueId,
    venue: booking.venue,
    date: booking.date,
    type: booking.type,
    name: booking.name,
    booked_by: booking.bookedBy,
    phone: booking.phone,
    email: booking.email,
    notes: booking.notes,
    visibility: booking.visibility,
    status: booking.status,
    created_at: booking.createdAt,
    proof_url: '',
    proof_claimed: true,
    checkin_at: booking.checkinAt
  }]);
  var manualPoints = showFullPointsForBooking(booking);
  var manualZone = await getMemberZoneName(booking.phone || '');
  await neonSQL(
    "INSERT INTO claims (booking_id, member_phone, member_name, status, claim_type, reason, points, zone_name) VALUES ($1,$2,$3,'approved','show',$4,$5,$6)",
    [booking.id, _normPhone(booking.phone || '') || booking.phone || '', booking.name, booking.notes, manualPoints, manualZone]
  );
  allBookings.unshift(booking);
  saveLocal();
  filterTable();
  renderGigCalendar();
  renderVenueList();
  loadLeaderboard();
  loadAdminClaims();
  notifyMemberUpdate({
    updateType: 'points',
    status: 'approved',
    bookingId: booking.id,
    venue: booking.venue,
    date: booking.date,
    points: String(manualPoints),
    reason: 'show completed',
    phone: booking.phone,
    email: booking.email,
    memberName: booking.name
  });
  logAdminAction('emergency_show_credit', booking.name + ' @ ' + booking.venue + ' #' + booking.id).catch(function(){});
  showToast('', 'Show Credit Added', '1 show count and ' + manualPoints + ' point(s) added for ' + booking.name + '.');
}

async function createEmergencyUploadAccess(data) {
  if (!requireAdminPerm('claims', 'emergency upload access')) return;
  var member = data.phone ? await adminFindMemberByPhone(data.phone) : null;
  var memberName = data.name || (member && member.name) || data.phone || data.email || 'Member';
  var bookingId = 'OTS-UPLOAD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
  var st = data.venueId ? getVenueWindow(venues.find(function(v){ return v.id === data.venueId; })) : null;
  var manualAt = (st && st.start) ? st.start.toISOString() : new Date().toISOString();
  var booking = {
    id: bookingId,
    venueId: data.venueId,
    venue: data.venue,
    date: data.date,
    type: data.type,
    name: memberName,
    bookedBy: data.bookedBy || currentAdminUsername || 'Admin',
    phone: data.phone,
    email: data.email || (member && member.email) || '',
    notes: data.notes || 'Emergency admin upload access',
    price: 0,
    visibility: data.visibility || 'Public',
    status: 'confirmed',
    createdAt: new Date().toISOString(),
    proofUrl: '',
    proofClaimed: false,
    checkinAt: manualAt
  };
  await sbUpsert('bookings', [{
    id: booking.id,
    venue_id: booking.venueId,
    venue: booking.venue,
    date: booking.date,
    type: booking.type,
    name: booking.name,
    booked_by: booking.bookedBy,
    phone: booking.phone,
    email: booking.email,
    notes: booking.notes,
    visibility: booking.visibility,
    status: booking.status,
    created_at: booking.createdAt,
    proof_url: '',
    proof_claimed: false,
    checkin_at: booking.checkinAt,
    checkin_lat: null,
    checkin_lng: null,
    checkin_accuracy: null,
    checkin_map_url: ''
  }]);
  allBookings.unshift(booking);
  saveLocal();
  filterTable();
  renderGigCalendar();
  renderVenueList();
  renderUserBookings();
  notifyMemberUpdate({
    updateType: 'booking_update',
    status: 'confirmed',
    bookingId: booking.id,
    venue: booking.venue,
    date: booking.date,
    phone: booking.phone,
    email: booking.email,
    memberName: booking.name,
    reason: 'Admin added upload access for a completed show'
  });
  logAdminAction('emergency_upload_access', booking.name + ' @ ' + booking.venue + ' #' + booking.id).catch(function(){});
  showToast('', 'Upload Access Added', booking.name + ' can open My Requests and upload proof photo.');
}

async function adminViewProof(id) {
  const b = allBookings.find(x=>x.id===id);
  if (!b || !b.proofUrl) return;
  var url = b.proofUrl;
  if (isProofPlaceholder(url)) {
    showToast('', 'Loading Photo', 'Opening proof photo...');
    try {
      url = await fetchBookingProofUrl(id);
      if (url) b.proofUrl = url;
    } catch(e) {
      showToast('', 'Photo Load Failed', 'Please refresh and try again.');
      return;
    }
  }
  if (!url || isProofPlaceholder(url)) {
    showToast('', 'No Photo', 'No proof photo found.');
    return;
  }
  _openProofOverlay(url);
}
function getBookingDismissKeys(b) {
  var keys = [];
  var email = String((b && b.email) || '').trim().toLowerCase();
  var phone = _normPhone((b && b.phone) || '');
  if (email) keys.push('email:' + email);
  if (phone) keys.push('phone:' + phone);
  return keys;
}
async function adminRestoreClearedRequest(id, silent) {
  if (!(hasAdminPerm('slots') || hasAdminPerm('claims'))) {
    showToast('', 'No Access', 'You need slot or claim access to restore member requests.');
    return false;
  }
  var b = allBookings.find(function(x){ return x.id === id; });
  if (!b) return false;
  try {
    var keys = getBookingDismissKeys(b);
    if (keys.length) {
      for (var i = 0; i < keys.length; i++) {
        await neonSQL('DELETE FROM dismissed_requests WHERE booking_id=$1 AND user_key=$2', [String(id), keys[i]]);
      }
    } else {
      await neonSQL('DELETE FROM dismissed_requests WHERE booking_id=$1', [String(id)]);
    }
    logAdminAction('restore_member_request', (b.name || '-') + ' @ ' + (b.venue || '-') + ' #' + id).catch(function(){});
    if (!silent) showToast('', 'Request Restored', 'This booking will come back in the member request list after refresh.');
    return true;
  } catch(e) {
    console.error('[OTS] restore cleared request:', e);
    if (!silent) showToast('', 'Restore Failed', 'Could not restore cleared request.');
    return false;
  }
}
async function adminAllowProofUpload(id) {
  if (!(hasAdminPerm('slots') || hasAdminPerm('claims'))) {
    showToast('', 'No Access', 'You need slot or claim access to allow proof upload.');
    return;
  }
  var b = allBookings.find(function(x){ return x.id === id; });
  if (!b) return;
  if (!confirm('Allow this member to upload proof photo even though they missed check-in?')) return;
  try {
    var st = _showTimes(b);
    var manualAt = (st && st.start) ? st.start.toISOString() : new Date().toISOString();
    await dbPatch('bookings', id, {
      checkin_at: manualAt,
      checkin_lat: null,
      checkin_lng: null,
      checkin_accuracy: null,
      checkin_map_url: '',
      proof_claimed: false
    });
    b.checkinAt = manualAt;
    b.checkinLat = null;
    b.checkinLng = null;
    b.checkinAccuracy = null;
    b.checkinMapUrl = '';
    b.proofClaimed = false;
    var mb = myBookings.find(function(x){ return x.id === id; });
    if (mb) {
      mb.checkinAt = manualAt;
      mb.checkinLat = null;
      mb.checkinLng = null;
      mb.checkinAccuracy = null;
      mb.checkinMapUrl = '';
      mb.proofClaimed = false;
    }
    await adminRestoreClearedRequest(id, true);
    saveLocal();
    renderUserBookings();
    filterTable();
    logAdminAction('manual_checkin', (b.name || '-') + ' @ ' + (b.venue || '-') + ' #' + id).catch(function(){});
    showToast('', 'Upload Allowed', 'Member can now restore/open the request and upload proof photo.');
  } catch(e) {
    console.error('[OTS] admin allow proof:', e);
    showToast('', 'Failed', 'Could not allow proof upload.');
  }
}
async function adminFindMemberByPhone(phone) {
  var norm = _normPhone(phone || '');
  if (!norm) return null;
  try {
    var rows = await neonSQL(
      "SELECT name,email,phone FROM members WHERE RIGHT(REGEXP_REPLACE(phone,'[^0-9]','','g'),10)=$1 LIMIT 1",
      [norm]
    );
    return rows && rows[0] ? rows[0] : null;
  } catch(e) {
    console.warn('[OTS] member lookup failed:', e && (e.message || e));
    return null;
  }
}
async function adminGrantShowPoint(id, mode) {
  if (!requireAdminPerm('claims', 'manual show point')) return;
  var b = allBookings.find(function(x){ return x.id === id; });
  if (!b) return;
  var isTeamMember = mode === 'team';
  var targetPhone = _normPhone(b.phone || '');
  var targetName = b.name || b.bookedBy || 'Member';
  var targetEmail = b.email || '';
  if (isTeamMember) {
    var enteredPhone = prompt('Enter the missing team member mobile number');
    if (enteredPhone === null) return;
    targetPhone = _normPhone(enteredPhone);
    if (!targetPhone) {
      showToast('', 'Phone Required', 'Enter a valid member phone number.');
      return;
    }
    var member = await adminFindMemberByPhone(targetPhone);
    if (member) {
      targetName = member.name || targetPhone;
      targetEmail = member.email || '';
    } else {
      var enteredName = prompt('Member not found in member data. Enter name to add this point anyway.');
      if (enteredName === null) return;
      targetName = String(enteredName || '').trim() || targetPhone;
    }
  }
  var confirmText = isTeamMember
    ? ('Add show credit for ' + targetName + ' on this booking? Approved performers will share the slot point pool.')
    : 'Manually grant/re-approve show credit for this booking member? Approved performers will share the slot point pool.';
  if (!confirm(confirmText)) return;
  try {
    var existing = await neonSQL(
      "SELECT id,status FROM claims WHERE booking_id=$1 AND member_phone=$2 AND COALESCE(claim_type,'show')='show' ORDER BY created_at DESC LIMIT 1",
      [String(id), targetPhone || '']
    );
    if (existing && existing.length) {
      var existingZone = await getMemberZoneName(targetPhone || '');
      await neonSQL("UPDATE claims SET status='approved', reason='Admin manual show credit', zone_name=$2 WHERE id=$1", [existing[0].id, existingZone]);
    } else {
      var targetZone = await getMemberZoneName(targetPhone || '');
      await neonSQL(
        "INSERT INTO claims (booking_id, member_phone, member_name, status, claim_type, reason, points, zone_name) VALUES ($1,$2,$3,'approved','show','Admin manual show credit',0,$4)",
        [String(id), targetPhone || '', targetName, targetZone]
      );
    }
    var balance = await rebalanceApprovedShowClaims(id, b, false);
    await dbPatch('bookings', id, { proof_claimed: true });
    b.proofClaimed = true;
    await adminRestoreClearedRequest(id, true);
    saveLocal();
    renderUserBookings();
    filterTable();
    loadAdminClaims();
    loadLeaderboard();
    notifyMemberUpdate({
      updateType: 'points',
      status: 'approved',
      bookingId: id,
      venue: b.venue || '',
      date: b.date || '',
      points: String(balance.points),
      reason: 'show completed',
      phone: targetPhone || '',
      email: targetEmail || '',
      memberName: targetName
    });
    logAdminAction('manual_show_point', targetName + ' @ ' + (b.venue || '-') + ' #' + id).catch(function(){});
    showToast('', 'Point Granted', targetName + ' now gets ' + balance.points + ' point(s). Approved performers share ' + balance.totalPool + ' total slot points.');
  } catch(e) {
    console.error('[OTS] manual show point:', e);
    showToast('', 'Failed', 'Could not grant manual show point.');
  }
}
function adminCancel(id) {
  if (!requireAdminPerm('slots', 'slot approval')) return;
  if (!confirm('Cancel booking '+id+'?')) return;
  const b=allBookings.find(x=>x.id===id); if(b) b.status='cancelled';
  const mb=myBookings.find(x=>x.id===id); if(mb) mb.status='cancelled';
  dbPatch('bookings', id, {status:'cancelled'}).catch(e=>console.error(e));
  notifyBookingStatusChange(b, 'cancelled');
  saveLocal(); renderUserBookings(); updateHeroStats(); updateAdminStats(); filterTable();
  logAdminAction('cancel_booking', (b ? b.name + ' @ ' + b.venue + ' on ' + b.date : '#'+id)).catch(function(){});
  showToast('','Booking Cancelled',id+' has been cancelled.');
}

// =======================================
// ADMIN - MONTHLY REPORT BUILDER
// =======================================
const MONTHLY_REPORT_DRAFT_KEY = 'ots_monthly_report_draft_v1';
var _monthlyReportRows = [];
var _monthlyReportLastContextKey = '';
var _monthlyReportLoadedMonthKey = '';
var _monthlyReportLoadFailedMonthKey = '';
var _monthlyReportRefreshPromise = null;
var _monthlyReportLastGoodRows = [];
var _monthlyReportLastGoodContextKey = '';
var _monthlyReportRowsByContext = {};
var _monthlyReportPrepareSeq = 0;
var _adminBookingEditSuspendedFiles = [];

function monthlyReportContextKey(ctx) {
  ctx = ctx || getMonthlyReportContext();
  return String(ctx.monthKey || '') + '|' + String(ctx.type || 'all');
}

function cacheMonthlyReportRows(ctx, rows) {
  var key = monthlyReportContextKey(ctx);
  rows = (rows || []).slice();
  if (!key || !rows.length) return;
  _monthlyReportRowsByContext[key] = rows;
  _monthlyReportLastGoodRows = rows.slice();
  _monthlyReportLastGoodContextKey = key;
}

function getCachedMonthlyReportRows(ctx) {
  var key = monthlyReportContextKey(ctx);
  var rows = _monthlyReportRowsByContext[key];
  return rows && rows.length ? rows.slice() : [];
}

function getCurrentMonthlyReportRows(ctx) {
  var key = monthlyReportContextKey(ctx);
  if (_monthlyReportRows.length && _monthlyReportLastContextKey === key) {
    return _monthlyReportRows.slice();
  }
  return getCachedMonthlyReportRows(ctx);
}

function countCachedReportRowsForMonth(monthKey) {
  var total = 0;
  Object.keys(_monthlyReportRowsByContext || {}).forEach(function(key) {
    if (key.indexOf(String(monthKey || '') + '|') === 0) {
      total += (_monthlyReportRowsByContext[key] || []).length;
    }
  });
  return total;
}

function getMonthlyReportMonthKeyForLoad() {
  var el = document.getElementById('monthlyReportMonth');
  var val = el && el.value ? String(el.value) : localMonthKey();
  return /^\d{4}-\d{2}$/.test(val) ? val : localMonthKey();
}

function bookingBelongsToMonth(booking, monthKey) {
  var date = normalizeVenueDate(booking && booking.date);
  return !!(date && date.slice(0, 7) === monthKey);
}

function countCachedBookingsForMonth(monthKey) {
  if (!monthKey) return 0;
  return (allBookings || []).filter(function(b) { return bookingBelongsToMonth(b, monthKey); }).length;
}

function mergeMonthlyReportBookings(mappedBookings, monthKey, options) {
  if (!monthKey) return;
  mappedBookings = mappedBookings || [];
  options = options || {};
  var cachedCount = countCachedBookingsForMonth(monthKey);
  var cachedReportCount = countCachedReportRowsForMonth(monthKey);
  if (!mappedBookings.length && (cachedCount || cachedReportCount) && !options.allowEmptyReplace) {
    console.warn('[OTS] monthly report empty refresh ignored for ' + monthKey + '; keeping cached report data.');
    _monthlyReportLoadFailedMonthKey = monthKey;
    return false;
  }
  allBookings = (allBookings || []).filter(function(b) {
    return !bookingBelongsToMonth(b, monthKey);
  }).concat(mappedBookings);
  _monthlyReportLoadFailedMonthKey = '';
  return true;
}

function localMonthKey(date) {
  var d = date || new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function monthLabelFromKey(monthKey, shortName) {
  var parts = String(monthKey || '').split('-').map(Number);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return monthKey || '';
  var names = shortName
    ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    : ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return names[parts[1] - 1] + ' ' + parts[0];
}

function dayNameFromIso(iso) {
  var p = String(iso || '').split('-').map(Number);
  if (p.length !== 3 || !p[0] || !p[1] || !p[2]) return '';
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date(p[0], p[1] - 1, p[2]).getDay()];
}

function readMonthlyReportDraft() {
  try { return JSON.parse(localStorage.getItem(MONTHLY_REPORT_DRAFT_KEY) || '{}') || {}; }
  catch(e) { return {}; }
}

function writeMonthlyReportDraft(draft) {
  try { localStorage.setItem(MONTHLY_REPORT_DRAFT_KEY, JSON.stringify(draft || {})); } catch(e) {}
}

function monthlyReportDraftField(monthKey, type, bookingId, field) {
  return [monthKey || '', type || 'all', bookingId || '', field || ''].join('|');
}

function monthlyReportDefaultTitle(monthKey, type) {
  var prefix = 'OTS';
  if (type === 'gcc') prefix = 'GCC';
  if (type === 'metro') prefix = 'METRO';
  if (type === 'foundation') prefix = 'FOUNDATION';
  if (type === 'private') prefix = 'PRIVATE';
  return prefix + ' REPORT ' + String(monthLabelFromKey(monthKey, true)).toUpperCase();
}

function getMonthlyReportContext() {
  var monthEl = document.getElementById('monthlyReportMonth');
  var typeEl = document.getElementById('monthlyReportType');
  var titleEl = document.getElementById('monthlyReportTitle');
  var monthKey = (monthEl && monthEl.value) || localMonthKey();
  var type = (typeEl && typeEl.value) || 'all';
  var draft = readMonthlyReportDraft();
  var titleKey = monthlyReportDraftField(monthKey, type, '_report', 'title');
  var title = (titleEl && titleEl.value.trim()) || draft[titleKey] || monthlyReportDefaultTitle(monthKey, type);
  return {
    monthKey: monthKey,
    type: type,
    title: title,
    typeLabel: type === 'gcc' ? 'GCC' : type === 'metro' ? 'Metro' : type === 'foundation' ? 'Foundation' : type === 'private' ? 'Private' : 'All Shows'
  };
}

function initMonthlyReportControls() {
  var monthEl = document.getElementById('monthlyReportMonth');
  var typeEl = document.getElementById('monthlyReportType');
  var titleEl = document.getElementById('monthlyReportTitle');
  if (monthEl && !monthEl.value) monthEl.value = localMonthKey();
  if (typeEl && !typeEl.value) typeEl.value = 'all';
  if (titleEl) {
    var ctx = getMonthlyReportContext();
    var draft = readMonthlyReportDraft();
    var titleKey = monthlyReportDraftField(ctx.monthKey, ctx.type, '_report', 'title');
    titleEl.value = titleEl.value || draft[titleKey] || monthlyReportDefaultTitle(ctx.monthKey, ctx.type);
  }
}

function saveMonthlyReportTitleDraft() {
  if (!hasAdminPerm('reports')) return;
  var ctx = getMonthlyReportContext();
  var titleEl = document.getElementById('monthlyReportTitle');
  var draft = readMonthlyReportDraft();
  draft[monthlyReportDraftField(ctx.monthKey, ctx.type, '_report', 'title')] = titleEl ? titleEl.value.trim() : '';
  writeMonthlyReportDraft(draft);
}

function syncMonthlyReportTitle(ctx) {
  var titleEl = document.getElementById('monthlyReportTitle');
  if (!titleEl) return;
  var draft = readMonthlyReportDraft();
  var titleKey = monthlyReportDraftField(ctx.monthKey, ctx.type, '_report', 'title');
  if (draft[titleKey]) {
    titleEl.value = draft[titleKey];
    return;
  }
  var current = titleEl.value.trim();
  var looksAuto = /^(OTS|GCC|METRO|FOUNDATION|PRIVATE|PARTNER) REPORT [A-Z]{3} \d{4}$/i.test(current);
  if (!current || looksAuto) titleEl.value = monthlyReportDefaultTitle(ctx.monthKey, ctx.type);
}

function monthlyReportFootfallFor(row, ctx) {
  var draft = readMonthlyReportDraft();
  var key = monthlyReportDraftField(ctx.monthKey, ctx.type, row.id, 'footfall');
  var val = draft[key];
  var n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function monthlyReportDefaultDateLabel(row) {
  var date = monthlyReportDisplayDate(row && row.date);
  var day = row && row.dayName ? String(row.dayName) : '';
  return day ? date + ' ' + day : date;
}

function monthlyReportNormalizeRotation(value) {
  var n = Math.round(Number(value) || 0);
  n = ((n % 360) + 360) % 360;
  if ([90, 180, 270].indexOf(n) > -1) return n;
  return 0;
}

var _monthlyReportPhotoData = null;
var _monthlyReportPhotoPreparing = false;

function monthlyReportRemovedKey(ctx, bookingId) {
  return monthlyReportDraftField(ctx.monthKey, ctx.type, bookingId, 'removed');
}

function isMonthlyReportShowRemoved(ctx, bookingId) {
  var draft = readMonthlyReportDraft();
  return draft[monthlyReportRemovedKey(ctx, bookingId)] === '1';
}

function monthlyReportRemovedCount(ctx) {
  var draft = readMonthlyReportDraft();
  var prefix = [ctx.monthKey || '', ctx.type || 'all'].join('|') + '|';
  return Object.keys(draft).filter(function(key) {
    return key.indexOf(prefix) === 0 && key.slice(-8) === '|removed' && draft[key] === '1';
  }).length;
}

function removeMonthlyReportShow(bookingId) {
  if (!requireAdminPerm('reports', 'monthly report editing')) return;
  var ctx = getMonthlyReportContext();
  var draft = readMonthlyReportDraft();
  draft[monthlyReportRemovedKey(ctx, bookingId)] = '1';
  writeMonthlyReportDraft(draft);
  _monthlyReportRows = (_monthlyReportRows || []).filter(function(row) {
    return String(row.id) !== String(bookingId);
  });
  _monthlyReportRowsByContext[monthlyReportContextKey(ctx)] = _monthlyReportRows.slice();
  renderMonthlyReportRows(ctx, _monthlyReportRows);
  showToast('', 'Show Removed', 'Removed from this monthly report only.');
}

function restoreMonthlyReportShows() {
  if (!requireAdminPerm('reports', 'monthly report editing')) return;
  var ctx = getMonthlyReportContext();
  var draft = readMonthlyReportDraft();
  var prefix = [ctx.monthKey || '', ctx.type || 'all'].join('|') + '|';
  Object.keys(draft).forEach(function(key) {
    if (key.indexOf(prefix) === 0 && key.slice(-8) === '|removed') delete draft[key];
  });
  writeMonthlyReportDraft(draft);
  delete _monthlyReportRowsByContext[monthlyReportContextKey(ctx)];
  generateMonthlyReportPreview(false);
  showToast('', 'Shows Restored', 'Removed shows are back in this report.');
}

function applyMonthlyReportRowDraft(row, ctx) {
  if (!row) return row;
  ctx = ctx || getMonthlyReportContext();
  var draft = readMonthlyReportDraft();
  ['reportDateLabel', 'venueName', 'teamName', 'bookedBy', 'timeRange'].forEach(function(field) {
    var val = String(draft[monthlyReportDraftField(ctx.monthKey, ctx.type, row.id, field)] || '').trim();
    if (val) row[field] = val;
  });
  row.reportDateLabel = row.reportDateLabel || monthlyReportDefaultDateLabel(row);
  row.photoRotate = monthlyReportNormalizeRotation(draft[monthlyReportDraftField(ctx.monthKey, ctx.type, row.id, 'photoRotate')]);
  return row;
}

function ensureMonthlyReportEditModal() {
  var modal = document.getElementById('monthlyReportEditModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'monthlyReportEditModal';
  modal.className = 'monthly-report-edit-modal';
  modal.innerHTML =
    '<div class="monthly-report-edit-card" onclick="event.stopPropagation()">' +
      '<button type="button" class="monthly-report-edit-close" onclick="closeMonthlyReportEditModal()">X</button>' +
      '<div class="modal-eyebrow">Report Row</div>' +
      '<h3>Edit this show</h3>' +
      '<p>These changes affect only this monthly report and PDF. Original booking data stays unchanged.</p>' +
      '<label>Date text<input id="monthlyReportEditDate" type="text" placeholder="23.05.2026 Saturday"></label>' +
      '<label>Location<input id="monthlyReportEditVenue" type="text" placeholder="Location name"></label>' +
      '<label>Band name<input id="monthlyReportEditTeam" type="text" placeholder="Band / team name"></label>' +
      '<label>Booked by<input id="monthlyReportEditBookedBy" type="text" placeholder="Booking person"></label>' +
      '<label>Time<input id="monthlyReportEditTime" type="text" placeholder="6:00 PM - 7:30 PM"></label>' +
      '<label>Foot fall<input id="monthlyReportEditFootfall" type="number" min="0" step="1" placeholder="0"></label>' +
      '<label>Photo rotation<select id="monthlyReportEditPhotoRotate">' +
        '<option value="0">Straight / Auto</option>' +
        '<option value="90">Rotate right 90</option>' +
        '<option value="180">Rotate 180</option>' +
        '<option value="270">Rotate left 90</option>' +
      '</select></label>' +
      '<label>Report photo<input id="monthlyReportEditPhotoFile" type="file" accept="image/*" onchange="previewMonthlyReportPhoto(this)"></label>' +
      '<img id="monthlyReportEditPhotoPreview" class="monthly-report-edit-photo-preview" alt="Report photo preview" style="display:none;">' +
      '<div id="monthlyReportEditPhotoStatus" class="monthly-report-edit-photo-status"></div>' +
      '<div class="monthly-report-edit-actions">' +
        '<button type="button" class="btn secondary" onclick="closeMonthlyReportEditModal()">Cancel</button>' +
        '<button type="button" class="btn primary" id="monthlyReportEditSaveBtn" onclick="saveMonthlyReportShowEdit()">Save report edit</button>' +
      '</div>' +
    '</div>';
  modal.addEventListener('click', closeMonthlyReportEditModal);
  document.body.appendChild(modal);
  return modal;
}

function getMonthlyReportRowById(bookingId) {
  var id = String(bookingId || '');
  var row = (_monthlyReportRows || []).find(function(item) { return String(item.id) === id; });
  if (row) return row;
  return buildMonthlyReportRows(getMonthlyReportContext()).find(function(item) { return String(item.id) === id; });
}

function editMonthlyReportShow(bookingId) {
  if (!requireAdminPerm('reports', 'monthly report editing')) return;
  var row = getMonthlyReportRowById(bookingId);
  if (!row) {
    showToast('', 'Show Not Found', 'Refresh the monthly report and try again.');
    return;
  }
  var modal = ensureMonthlyReportEditModal();
  modal.dataset.bookingId = String(bookingId || '');
  _monthlyReportPhotoData = null;
  _monthlyReportPhotoPreparing = false;
  document.getElementById('monthlyReportEditDate').value = row.reportDateLabel || monthlyReportDefaultDateLabel(row);
  document.getElementById('monthlyReportEditVenue').value = row.venueName || '';
  document.getElementById('monthlyReportEditTeam').value = row.teamName || '';
  document.getElementById('monthlyReportEditBookedBy').value = row.bookedBy || '';
  document.getElementById('monthlyReportEditTime').value = row.timeRange || '';
  document.getElementById('monthlyReportEditFootfall').value = row.footfall || '';
  document.getElementById('monthlyReportEditPhotoRotate').value = String(monthlyReportNormalizeRotation(row.photoRotate));
  var fileEl = document.getElementById('monthlyReportEditPhotoFile');
  var preview = document.getElementById('monthlyReportEditPhotoPreview');
  var status = document.getElementById('monthlyReportEditPhotoStatus');
  if (fileEl) fileEl.value = '';
  if (preview) {
    if (row.photoUrl && !isProofPlaceholder(row.photoUrl)) {
      preview.src = row.photoUrl;
      preview.style.display = 'block';
    } else {
      preview.removeAttribute('src');
      preview.style.display = 'none';
    }
  }
  if (status) {
    status.textContent = row.photoUrl ? 'Photo already available. Choose a new one only if you want to replace it.' : 'No proof photo found. Choose a photo to add it to this report.';
    status.style.color = row.photoUrl ? 'var(--green)' : 'var(--muted)';
  }
  modal.classList.add('show');
}

function closeMonthlyReportEditModal() {
  var modal = document.getElementById('monthlyReportEditModal');
  if (modal) modal.classList.remove('show');
  _monthlyReportPhotoData = null;
  _monthlyReportPhotoPreparing = false;
}

function previewMonthlyReportPhoto(input) {
  if (!requireAdminPerm('reports', 'monthly report photo upload')) {
    if (input) input.value = '';
    return;
  }
  var file = input && input.files && input.files[0];
  var preview = document.getElementById('monthlyReportEditPhotoPreview');
  var status = document.getElementById('monthlyReportEditPhotoStatus');
  var saveBtn = document.getElementById('monthlyReportEditSaveBtn');
  _monthlyReportPhotoData = null;
  if (!file) return;
  _monthlyReportPhotoPreparing = true;
  if (saveBtn) saveBtn.disabled = true;
  if (status) { status.textContent = 'Preparing photo...'; status.style.color = 'var(--muted)'; }
  _compressImage(file, 900, 0.62, function(dataUrl) {
    _monthlyReportPhotoData = dataUrl;
    _monthlyReportPhotoPreparing = false;
    if (preview) { preview.src = dataUrl; preview.style.display = 'block'; }
    if (status) { status.textContent = 'Photo ready. Tap Save report edit to attach it.'; status.style.color = 'var(--green)'; }
    if (saveBtn) saveBtn.disabled = false;
  }, function(errorMsg) {
    _monthlyReportPhotoData = null;
    _monthlyReportPhotoPreparing = false;
    if (preview) { preview.removeAttribute('src'); preview.style.display = 'none'; }
    if (status) { status.textContent = errorMsg || 'Could not prepare this photo. Choose another image.'; status.style.color = '#ff4b4b'; }
    if (saveBtn) saveBtn.disabled = false;
  });
}

async function saveMonthlyReportShowEdit() {
  if (!requireAdminPerm('reports', 'monthly report editing')) return;
  var modal = document.getElementById('monthlyReportEditModal');
  if (!modal) return;
  var bookingId = modal.dataset.bookingId || '';
  if (!bookingId) return;
  var status = document.getElementById('monthlyReportEditPhotoStatus');
  var saveBtn = document.getElementById('monthlyReportEditSaveBtn');
  if (_monthlyReportPhotoPreparing) {
    if (status) { status.textContent = 'Photo is still preparing. Please wait a moment.'; status.style.color = 'var(--muted)'; }
    return;
  }
  var ctx = getMonthlyReportContext();
  var draft = readMonthlyReportDraft();
  [
    ['reportDateLabel', 'monthlyReportEditDate'],
    ['venueName', 'monthlyReportEditVenue'],
    ['teamName', 'monthlyReportEditTeam'],
    ['bookedBy', 'monthlyReportEditBookedBy'],
    ['timeRange', 'monthlyReportEditTime']
  ].forEach(function(pair) {
    var el = document.getElementById(pair[1]);
    var key = monthlyReportDraftField(ctx.monthKey, ctx.type, bookingId, pair[0]);
    var value = el ? el.value.trim() : '';
    if (value) draft[key] = value;
    else delete draft[key];
  });
  var footfallEl = document.getElementById('monthlyReportEditFootfall');
  var footfallKey = monthlyReportDraftField(ctx.monthKey, ctx.type, bookingId, 'footfall');
  var footfall = Math.max(0, Math.round(Number(footfallEl && footfallEl.value) || 0));
  if (footfall) draft[footfallKey] = String(footfall);
  else delete draft[footfallKey];
  var rotateEl = document.getElementById('monthlyReportEditPhotoRotate');
  var rotateKey = monthlyReportDraftField(ctx.monthKey, ctx.type, bookingId, 'photoRotate');
  var rotate = monthlyReportNormalizeRotation(rotateEl && rotateEl.value);
  if (rotate) draft[rotateKey] = String(rotate);
  else delete draft[rotateKey];
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
  try {
    var uploadedReportPhoto = !!_monthlyReportPhotoData;
    if (_monthlyReportPhotoData) {
      await dbPatch('bookings', bookingId, { proof_url: _monthlyReportPhotoData, proof_claimed: false });
      [allBookings, myBookings].forEach(function(list) {
        (list || []).forEach(function(b) {
          if (String(b.id) === String(bookingId)) {
            b.proofUrl = _monthlyReportPhotoData;
            b.proofClaimed = false;
          }
        });
      });
    }
    writeMonthlyReportDraft(draft);
    closeMonthlyReportEditModal();
    delete _monthlyReportRowsByContext[monthlyReportContextKey(ctx)];
    generateMonthlyReportPreview(false);
    saveLocal();
    showToast('', 'Report Row Updated', uploadedReportPhoto ? 'Photo attached and report updated.' : 'This edit will appear in the monthly report and PDF.');
  } catch(e) {
    console.error('[OTS] monthly report edit save:', e);
    if (status) { status.textContent = 'Could not save: ' + ((e && e.message) || 'Please try again.'); status.style.color = '#ff4b4b'; }
    showToast('', 'Save Failed', (e && e.message) || 'Please try again.');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save report edit'; }
  }
}

function monthlyReportVenueType(venue, booking) {
  var explicit = normalizeVenueType((venue && venue.venueType) || '', (venue && venue.name) || (booking && booking.venue) || '');
  if (explicit) return explicit;
  var visibility = String((venue && venue.visibility) || (booking && booking.visibility) || '').trim().toLowerCase();
  if (visibility === 'private') return 'Private';
  return '';
}

function monthlyReportScopeMatches(venue, booking, type) {
  if (type === 'all') return true;
  var vt = monthlyReportVenueType(venue, booking).toLowerCase();
  if (type === 'gcc') return vt === 'gcc venue';
  if (type === 'metro') return vt === 'metro';
  if (type === 'foundation') return vt === 'foundation';
  if (type === 'private') return vt === 'private';
  if (type === 'partner') return vt === 'partner venue';
  return true;
}

function monthlyReportWeekLabel(iso) {
  var day = Number(String(iso || '').split('-')[2] || 1);
  if (!day || day < 1) return 'Week 1';
  return 'Week ' + Math.max(1, Math.ceil(day / 7));
}

function monthlyReportDisplayDate(iso) {
  var p = String(iso || '').split('-');
  if (p.length !== 3) return iso || '-';
  return p[2] + '.' + p[1] + '.' + p[0];
}

function buildMonthlyReportRows(ctx) {
  ctx = ctx || getMonthlyReportContext();
  var rows = (allBookings || []).filter(function(b) {
    var date = normalizeVenueDate(b && b.date);
    if (!date || date.slice(0, 7) !== ctx.monthKey) return false;
    var status = normalizeStatus(b && b.status, '');
    if (['confirmed','approved','completed'].indexOf(status) === -1) return false;
    if (isMonthlyReportShowRemoved(ctx, b && b.id)) return false;
    var venue = findVenueForBooking(b);
    return monthlyReportScopeMatches(venue, b, ctx.type);
  }).map(function(b) {
    var venue = findVenueForBooking(b);
    var date = normalizeVenueDate(b.date);
    var timeRange = venue ? formatVenueTimeRange(venue) : '-';
    var hasProof = bookingHasProofRecord(b);
    var row = {
      id: String(b.id || ''),
      booking: b,
      venue: venue || null,
      venueName: (venue && venue.name) || b.venue || '-',
      venueType: monthlyReportVenueType(venue, b),
      date: date,
      dayName: dayNameFromIso(date),
      timeRange: timeRange,
      teamName: b.name || '-',
      bookedBy: getBookingPersonName(b) || '',
      performanceType: b.type || '',
      performers: bookingPerformersText(b) || b.name || '',
      photoUrl: isUsableProofImageUrl(b.proofUrl) ? (b.proofUrl || '') : '',
      hasProof: hasProof,
      sortMs: bookingStartTimeMs(b)
    };
    row.footfall = monthlyReportFootfallFor(row, ctx);
    applyMonthlyReportRowDraft(row, ctx);
    return row;
  });
  rows.sort(function(a, b) {
    return (a.sortMs || 0) - (b.sortMs || 0) || a.venueName.localeCompare(b.venueName);
  });
  return rows;
}

function computeMonthlyReportSummary(rows) {
  var venueSeen = {};
  var teamSeen = {};
  var daySeen = {};
  var totalFootfall = 0;
  var footfallFilled = 0;
  var missingPhotos = 0;
  (rows || []).forEach(function(row) {
    if (row.venueName) venueSeen[String(row.venueName).toLowerCase()] = true;
    if (row.teamName) teamSeen[String(row.teamName).toLowerCase()] = true;
    if (row.date) daySeen[row.date] = true;
    if (row.footfall > 0) {
      totalFootfall += row.footfall;
      footfallFilled++;
    }
    if (!row.photoUrl) missingPhotos++;
  });
  return {
    venues: Object.keys(venueSeen).length,
    shows: rows.length,
    bands: Object.keys(teamSeen).length,
    days: Object.keys(daySeen).length,
    totalFootfall: totalFootfall,
    averageFootfall: rows.length ? Math.round(totalFootfall / rows.length) : 0,
    missingFootfall: Math.max(0, rows.length - footfallFilled),
    missingPhotos: missingPhotos
  };
}

function countMonthlyReportHiddenUncategorized(ctx) {
  if (!ctx || ctx.type === 'all') return 0;
  return (allBookings || []).filter(function(b) {
    var date = normalizeVenueDate(b && b.date);
    if (!date || date.slice(0, 7) !== ctx.monthKey) return false;
    var status = normalizeStatus(b && b.status, '');
    if (['confirmed','approved','completed'].indexOf(status) === -1) return false;
    var venue = findVenueForBooking(b);
    return !monthlyReportVenueType(venue, b) && !monthlyReportScopeMatches(venue, b, ctx.type);
  }).length;
}

function renderMonthlyReportSummary(ctx, rows) {
  var el = document.getElementById('monthlyReportSummary');
  if (!el) return;
  var s = computeMonthlyReportSummary(rows || []);
  el.innerHTML =
    '<div class="monthly-report-stat"><span>Venues</span><strong>' + s.venues + '</strong></div>' +
    '<div class="monthly-report-stat"><span>Shows</span><strong>' + s.shows + '</strong></div>' +
    '<div class="monthly-report-stat"><span>Bands</span><strong>' + s.bands + '</strong></div>' +
    '<div class="monthly-report-stat"><span>Days</span><strong>' + s.days + '</strong></div>' +
    '<div class="monthly-report-stat"><span>Total Footfall</span><strong>' + s.totalFootfall + '</strong></div>' +
    '<div class="monthly-report-stat"><span>Average / Show</span><strong>' + s.averageFootfall + '</strong></div>';

  var warn = document.getElementById('monthlyReportWarnings');
  if (warn) {
    var notes = [];
    if (s.missingFootfall) notes.push(s.missingFootfall + ' show(s) need footfall before the report looks complete.');
    if (s.missingPhotos) notes.push(s.missingPhotos + ' show(s) do not have proof photos yet.');
    var removedShows = monthlyReportRemovedCount(ctx);
    if (removedShows) notes.push(removedShows + ' show(s) removed from this report.' + (hasAdminPerm('reports') ? ' <button type="button" class="monthly-report-restore-btn" onclick="restoreMonthlyReportShows()">Restore removed shows</button>' : ''));
    var hiddenUncategorized = countMonthlyReportHiddenUncategorized(ctx);
    if (hiddenUncategorized) notes.push(hiddenUncategorized + ' old show(s) are hidden because their venue type is not set. Public is only visibility; set GCC/Metro/Foundation/Private in Venue Manager.');
    if (!rows.length) notes.push('No confirmed shows found for ' + otsEscapeHtml(ctx.typeLabel) + ' in ' + otsEscapeHtml(monthLabelFromKey(ctx.monthKey, false)) + '.');
    warn.innerHTML = notes.length ? notes.map(function(n){ return '<div>' + (String(n).indexOf('<button') > -1 ? n : otsEscapeHtml(n)) + '</div>'; }).join('') : '<div class="ok">Report data looks complete.</div>';
  }
}

function setMonthlyReportFootfall(bookingId, value) {
  if (!requireAdminPerm('reports', 'monthly report editing')) return;
  var ctx = getMonthlyReportContext();
  var draft = readMonthlyReportDraft();
  var key = monthlyReportDraftField(ctx.monthKey, ctx.type, bookingId, 'footfall');
  var n = Math.max(0, Math.round(Number(value) || 0));
  if (n) draft[key] = String(n);
  else delete draft[key];
  writeMonthlyReportDraft(draft);
  _monthlyReportRows.forEach(function(row) {
    if (String(row.id) === String(bookingId)) row.footfall = n;
  });
  if (_monthlyReportRows.length) cacheMonthlyReportRows(ctx, _monthlyReportRows);
  renderMonthlyReportSummary(ctx, _monthlyReportRows);
}

function renderMonthlyReportLoading(message) {
  var summary = document.getElementById('monthlyReportSummary');
  var warnings = document.getElementById('monthlyReportWarnings');
  var preview = document.getElementById('monthlyReportPreview');
  if (summary) summary.innerHTML = '<div class="monthly-report-loading">' + otsEscapeHtml(message || 'Loading live report data...') + '</div>';
  if (warnings) warnings.innerHTML = '';
  if (preview) preview.innerHTML = '<div class="table-empty">' + otsEscapeHtml(message || 'Loading live report data...') + '</div>';
}

function showMonthlyReportRefreshingNotice(message) {
  var warnings = document.getElementById('monthlyReportWarnings');
  if (warnings) warnings.innerHTML = '<div class="ok">' + otsEscapeHtml(message || 'Refreshing live report data...') + '</div>';
}

function renderMonthlyReportRows(ctx, rows) {
  var preview = document.getElementById('monthlyReportPreview');
  if (!preview) return;
  var canEditReports = hasAdminPerm('reports');
  rows = rows || [];
  _monthlyReportRows = rows.slice();
  _monthlyReportLastContextKey = monthlyReportContextKey(ctx);
  renderMonthlyReportSummary(ctx, _monthlyReportRows);
  if (!_monthlyReportRows.length) {
    preview.innerHTML = '<div class="table-empty">No confirmed shows found for this report.</div>';
    return;
  }
  cacheMonthlyReportRows(ctx, _monthlyReportRows);
  preview.innerHTML =
    '<div class="monthly-report-table-head">' +
      '<div>Date</div><div>Venue</div><div>Team</div><div>Time</div><div>Footfall</div><div>Photo</div>' +
    '</div>' +
    _monthlyReportRows.map(function(row) {
      var photoLabel = row.photoUrl ? 'Available' : 'Missing';
      var rowActions = canEditReports
        ? '<div class="monthly-report-row-actions"><button type="button" class="monthly-report-edit-btn" onclick="editMonthlyReportShow(\'' + otsJsString(row.id) + '\')">Edit</button><button type="button" class="monthly-report-remove-btn" onclick="removeMonthlyReportShow(\'' + otsJsString(row.id) + '\')">Remove this show</button></div>'
        : '';
      return '<div class="monthly-report-row">' +
        '<div><strong>' + otsEscapeHtml(row.reportDateLabel || monthlyReportDefaultDateLabel(row)) + '</strong>' + rowActions + '</div>' +
        '<div><strong>' + otsEscapeHtml(row.venueName) + '</strong><span>' + otsEscapeHtml(row.venueType || 'Venue') + '</span></div>' +
        '<div><strong>' + otsEscapeHtml(row.teamName) + '</strong><span>Booked by ' + otsEscapeHtml(row.bookedBy || '-') + '</span></div>' +
        '<div>' + otsEscapeHtml(row.timeRange) + '</div>' +
        '<div><input type="number" min="0" step="1" value="' + otsEscapeHtml(row.footfall || '') + '" placeholder="0" oninput="setMonthlyReportFootfall(\'' + otsJsString(row.id) + '\', this.value)" ' + (canEditReports ? '' : 'disabled') + '></div>' +
        '<div><span class="' + (row.photoUrl ? 'report-photo-ok' : 'report-photo-missing') + '">' + photoLabel + '</span>' + (row.photoRotate ? '<span>Rotate ' + row.photoRotate + '</span>' : '') + '</div>' +
      '</div>';
    }).join('');
}

function generateMonthlyReportPreview(allowRefresh) {
  var preview = document.getElementById('monthlyReportPreview');
  if (!preview) return;
  initMonthlyReportControls();
  var initialCtx = getMonthlyReportContext();
  syncMonthlyReportTitle(initialCtx);
  initialCtx = getMonthlyReportContext();
  var contextKey = monthlyReportContextKey(initialCtx);
  var cachedRows = getCurrentMonthlyReportRows(initialCtx);
  if (_adminDataLoading && currentAdminTab === 'reports') {
    if (cachedRows.length) {
      prepareAndRenderMonthlyReportRows(initialCtx, cachedRows, 'Preparing report photos...');
    } else {
      renderMonthlyReportLoading('Loading live report data...');
    }
    return;
  }
  if (adminLoggedIn && currentAdminTab === 'reports' && _monthlyReportLoadedMonthKey !== initialCtx.monthKey && _monthlyReportLoadFailedMonthKey !== initialCtx.monthKey) {
    if (cachedRows.length) {
      prepareAndRenderMonthlyReportRows(initialCtx, cachedRows, 'Preparing report photos...');
    } else {
      renderMonthlyReportLoading('Loading full ' + monthLabelFromKey(initialCtx.monthKey, false) + ' report data...');
    }
    if (!_monthlyReportRefreshPromise) {
      _monthlyReportRefreshPromise = refreshAdmin()
        .then(function(){ generateMonthlyReportPreview(false); })
        .catch(function(){ generateMonthlyReportPreview(false); })
        .finally(function(){ _monthlyReportRefreshPromise = null; });
    }
    return;
  }
  if (allowRefresh && adminLoggedIn && currentAdminTab === 'reports' && !_adminDataLoading) {
    if (cachedRows.length) {
      prepareAndRenderMonthlyReportRows(initialCtx, cachedRows, 'Preparing report photos...');
    } else {
      renderMonthlyReportLoading('Loading report data...');
    }
    _monthlyReportRefreshPromise = refreshAdmin()
      .then(function(){ generateMonthlyReportPreview(false); })
      .catch(function(){ generateMonthlyReportPreview(false); })
      .finally(function(){ _monthlyReportRefreshPromise = null; });
    return;
  }
  var ctx = initialCtx;
  var nextRows = buildMonthlyReportRows(ctx);
  if (!nextRows.length && cachedRows.length) {
    prepareAndRenderMonthlyReportRows(ctx, cachedRows, 'Preparing report photos...');
    return;
  }
  prepareAndRenderMonthlyReportRows(ctx, nextRows, nextRows.length ? 'Preparing report photos...' : '');
}

function monthlyReportSetRowPhoto(row, proofUrl) {
  if (!row) return row;
  proofUrl = String(proofUrl || '').trim();
  if (isUsableProofImageUrl(proofUrl)) {
    row.photoUrl = proofUrl;
    row.hasProof = true;
    if (row.booking) row.booking.proofUrl = proofUrl;
  } else {
    row.photoUrl = '';
    row.hasProof = false;
  }
  return row;
}

function monthlyReportProofQueryWithTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(function(resolve) {
      setTimeout(function() { resolve([]); }, ms || 8000);
    })
  ]);
}

async function fetchMonthlyReportProofMap(ids) {
  ids = Array.from(new Set((ids || []).map(function(id) { return String(id || '').trim(); }).filter(Boolean)));
  var out = {};
  for (var start = 0; start < ids.length; start += 25) {
    var batch = ids.slice(start, start + 25);
    var placeholders = batch.map(function(_, i) { return '$' + (i + 1); }).join(',');
    try {
      var rows = await monthlyReportProofQueryWithTimeout(
        neonSQL('SELECT id, proof_url FROM bookings WHERE id::TEXT IN (' + placeholders + ')', batch),
        8000
      );
      (rows || []).forEach(function(r) {
        var id = String(r && r.id || '');
        var proof = r && r.proof_url ? String(r.proof_url) : '';
        if (id && isUsableProofImageUrl(proof)) out[id] = proof;
      });
    } catch(e) {
      console.warn('[OTS] monthly report proof batch failed:', e && (e.message || e));
    }
  }
  return out;
}

async function hydrateMonthlyReportPhotos(rows) {
  rows = rows || [];
  var needsLookup = [];
  rows.forEach(function(row) {
    if (!row || row.photoUrl) return;
    var b = row.booking || {};
    if (row.hasProof || isProofPlaceholder(b.proofUrl)) needsLookup.push(row.id || b.id);
  });
  if (!needsLookup.length) {
    rows.forEach(function(row) {
      if (row && !isUsableProofImageUrl(row.photoUrl)) monthlyReportSetRowPhoto(row, '');
    });
    return rows;
  }
  var proofMap = await fetchMonthlyReportProofMap(needsLookup);
  rows.forEach(function(row) {
    if (!row) return;
    if (isUsableProofImageUrl(row.photoUrl)) {
      monthlyReportSetRowPhoto(row, row.photoUrl);
      return;
    }
    monthlyReportSetRowPhoto(row, proofMap[String(row.id || '')] || '');
  });
  return rows;
}

async function prepareMonthlyReportRows(ctx, rows) {
  rows = rows || [];
  if (!rows.length) return rows;
  await hydrateMonthlyReportPhotos(rows);
  await verifyMonthlyReportPhotos(rows, { timeoutMs: 4500 });
  return rows;
}

async function prepareAndRenderMonthlyReportRows(ctx, rows, message) {
  rows = rows || [];
  if (!rows.length) {
    renderMonthlyReportRows(ctx, rows);
    return rows;
  }
  var seq = ++_monthlyReportPrepareSeq;
  var contextKey = monthlyReportContextKey(ctx);
  if (message) renderMonthlyReportLoading(message);
  try {
    await prepareMonthlyReportRows(ctx, rows);
  } catch(e) {
    console.warn('[OTS] monthly report prepare failed:', e && (e.message || e));
    rows.forEach(function(row) {
      if (row && !isUsableProofImageUrl(row.photoUrl)) monthlyReportSetRowPhoto(row, '');
    });
  }
  if (seq !== _monthlyReportPrepareSeq || currentAdminTab !== 'reports' || monthlyReportContextKey(getMonthlyReportContext()) !== contextKey) return rows;
  renderMonthlyReportRows(ctx, rows);
  return rows;
}

function refreshMonthlyReportPreviewPhotos(ctx, rows) {
  return prepareAndRenderMonthlyReportRows(ctx, rows || [], 'Preparing report photos...');
}

function monthlyReportDataUrlToBlob(dataUrl) {
  var parts = String(dataUrl || '').split(',');
  var meta = parts[0] || '';
  var b64 = parts[1] || '';
  var mime = (meta.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  var bin = atob(b64);
  var bytes = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function monthlyReportPhotoBlob(url) {
  url = String(url || '');
  if (!url) return null;
  if (/^data:image\//i.test(url)) return monthlyReportDataUrlToBlob(url);
  var response = await fetch(url, { mode:'cors' });
  if (!response.ok) throw new Error('Photo fetch failed');
  return response.blob();
}

async function verifyMonthlyReportPhotos(rows, options) {
  options = options || {};
  var timeoutMs = Math.max(1500, Number(options.timeoutMs) || 4500);
  function canLoadImage(url) {
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function(){ resolve(true); };
      img.onerror = function(){ resolve(false); };
      img.src = url;
      setTimeout(function(){ resolve(false); }, timeoutMs);
    });
  }
  await Promise.all((rows || []).map(async function(row) {
    if (!row || !row.photoUrl) return;
    try {
      if (!(await canLoadImage(row.photoUrl))) {
        row.photoUrl = '';
        row.hasProof = false;
      }
    } catch(e) {
      console.warn('[OTS] report proof image verify failed for booking', row && row.id, e && (e.message || e));
      row.photoUrl = '';
      row.hasProof = false;
    }
  }));
  return rows;
}

function monthlyReportJpegOrientationFromBuffer(buffer) {
  var view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xFFD8) return 1;
  var offset = 2;
  while (offset < view.byteLength) {
    var marker = view.getUint16(offset, false);
    offset += 2;
    if (marker === 0xFFE1) {
      var length = view.getUint16(offset, false);
      offset += 2;
      if (view.getUint32(offset, false) !== 0x45786966) return 1;
      var tiff = offset + 6;
      var little = view.getUint16(tiff, false) === 0x4949;
      var firstIfd = view.getUint32(tiff + 4, little);
      var entries = view.getUint16(tiff + firstIfd, little);
      for (var i = 0; i < entries; i++) {
        var entry = tiff + firstIfd + 2 + (i * 12);
        if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little) || 1;
      }
      return 1;
    }
    if ((marker & 0xFF00) !== 0xFF00) break;
    offset += view.getUint16(offset, false);
  }
  return 1;
}

async function normalizeMonthlyReportPhoto(url, manualRotation) {
  try {
    manualRotation = monthlyReportNormalizeRotation(manualRotation);
    if (!url || typeof createImageBitmap !== 'function') return url;
    var blob = await monthlyReportPhotoBlob(url);
    if (!blob) return url;
    var isJpeg = /^image\/jpe?g$/i.test(blob.type || '');
    var orientation = isJpeg ? monthlyReportJpegOrientationFromBuffer(await blob.arrayBuffer()) : 1;
    if ([3, 6, 8].indexOf(orientation) === -1 && !manualRotation) return url;
    var bitmap = isJpeg ? await createImageBitmap(blob, { imageOrientation:'none' }) : await createImageBitmap(blob);
    var exifRotation = orientation === 3 ? 180 : orientation === 6 ? 90 : orientation === 8 ? 270 : 0;
    var totalRotation = monthlyReportNormalizeRotation(exifRotation + manualRotation);
    var swap = totalRotation === 90 || totalRotation === 270;
    var canvas = document.createElement('canvas');
    canvas.width = swap ? bitmap.height : bitmap.width;
    canvas.height = swap ? bitmap.width : bitmap.height;
    var ctx = canvas.getContext('2d');
    if (totalRotation === 180) {
      ctx.translate(canvas.width, canvas.height);
      ctx.rotate(Math.PI);
    } else if (totalRotation === 90) {
      ctx.translate(canvas.width, 0);
      ctx.rotate(Math.PI / 2);
    } else if (totalRotation === 270) {
      ctx.translate(0, canvas.height);
      ctx.rotate(-Math.PI / 2);
    }
    ctx.drawImage(bitmap, 0, 0);
    try { bitmap.close(); } catch(e) {}
    return canvas.toDataURL('image/jpeg', 0.9);
  } catch(e) {
    console.warn('[OTS] report photo orientation normalize skipped:', e && (e.message || e));
    return url;
  }
}

async function normalizeMonthlyReportPhotos(rows) {
  for (var i = 0; i < rows.length; i++) {
    if (rows[i] && rows[i].photoUrl) rows[i].photoUrl = await normalizeMonthlyReportPhoto(rows[i].photoUrl, rows[i].photoRotate);
  }
}

function monthlyReportLogosHtml() {
  var otsLogo = new URL('ots-brand-mark.png', location.href).href;
  var gccLogo = new URL('gcc-logo.png', location.href).href;
  var smartCityLogo = new URL('chennai-smart-city.png', location.href).href;
  return '<div class="report-logo-strip">' +
    '<img class="report-logo-gcc" src="' + otsEscapeHtml(gccLogo) + '" alt="Greater Chennai Corporation">' +
    '<img class="report-logo-smart" src="' + otsEscapeHtml(smartCityLogo) + '" alt="Chennai Smart City Limited">' +
    '<img class="report-logo-ots" src="' + otsEscapeHtml(otsLogo) + '" alt="On The Streets of Chennai">' +
  '</div>';
}

function buildMonthlyReportPrintHtml(ctx, rows) {
  var summary = computeMonthlyReportSummary(rows);
  var generated = new Date().toLocaleString('en-IN', { dateStyle:'medium', timeStyle:'short' });
  var logoHtml = monthlyReportLogosHtml();
  var prevWeek = '';
  var showPages = rows.map(function(row, idx) {
    var week = monthlyReportWeekLabel(row.date);
    var weekHtml = week !== prevWeek ? '<div class="report-week-title">' + otsEscapeHtml(week) + '</div>' : '';
    prevWeek = week;
    var photo = row.photoUrl
      ? '<img class="report-proof-photo" src="' + otsEscapeHtml(row.photoUrl) + '" alt="' + otsEscapeHtml(row.teamName) + ' at ' + otsEscapeHtml(row.venueName) + '">'
      : '<div class="report-photo-empty">Photo not attached</div>';
    return '<section class="report-page report-show-page">' +
      logoHtml +
      weekHtml +
      '<div class="report-show-line">' +
        '<div><strong>' + (idx + 1) + '. Date :</strong> <span>' + otsEscapeHtml(row.reportDateLabel || monthlyReportDefaultDateLabel(row)) + '</span></div>' +
        '<div><strong>Location :</strong> <span>' + otsEscapeHtml(row.venueName) + '</span></div>' +
        '<div><strong>Band name :</strong> <span>' + otsEscapeHtml(row.teamName) + '</span></div>' +
        '<div><strong>Time :</strong> <span>' + otsEscapeHtml(row.timeRange) + '</span></div>' +
        '<div><strong>Foot fall :</strong> <span>' + otsEscapeHtml(row.footfall || 0) + '</span></div>' +
      '</div>' +
      '<div class="report-photo-box">' + photo + '</div>' +
    '</section>';
  }).join('');

  return '<!doctype html><html><head><meta charset="utf-8"><title>' + otsEscapeHtml(ctx.title) + '</title>' +
    '<style>' +
    '@page{size:landscape;margin:0;}*{box-sizing:border-box;}body{margin:0;background:#fff;color:#111;font-family:Arial,Helvetica,sans-serif;}' +
    '.report-page{width:100vw;min-height:100vh;page-break-after:always;padding:42px 58px;position:relative;display:flex;flex-direction:column;background:#fff;overflow:hidden;}' +
    '.report-logo-strip{position:absolute;top:22px;right:40px;display:flex;align-items:center;gap:18px;height:82px;}' +
    '.report-logo-strip img{display:block;object-fit:contain;}.report-logo-gcc{width:78px;height:78px;}.report-logo-smart{width:190px;height:66px;}.report-logo-ots{width:76px;height:76px;}' +
    '.cover{justify-content:center;align-items:center;text-align:center;}.cover h1{font-size:74px;line-height:1.05;margin:0;text-transform:uppercase;letter-spacing:.02em;}.cover p{font-size:22px;margin:22px 0 0;color:#555;}' +
    '.summary h2,.divider h2{font-size:52px;margin:110px 0 28px;text-transform:uppercase;}.summary-table{width:74%;margin:auto;border-collapse:collapse;font-size:26px;}.summary-table td{border:3px solid #111;padding:18px 22px;}.summary-table td:last-child{text-align:right;font-weight:800;}' +
    '.divider{justify-content:center;align-items:center;text-align:center;background:#f6f7fb;}.divider h2{margin:0;font-size:58px;max-width:900px;}' +
    '.report-week-title{font-size:42px;font-weight:900;margin:92px 0 18px;text-transform:uppercase;}.report-show-line{font-size:22px;line-height:1.45;display:grid;grid-template-columns:1fr 1fr;gap:8px 34px;margin:82px 0 24px;align-items:start;}.report-show-line div{min-width:0;}.report-show-line strong{font-weight:900;}.report-show-line span{font-weight:500;}' +
    '.report-photo-box{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;border:2px solid #e3e6ee;background:#fafafa;}.report-proof-photo{max-width:100%;max-height:100%;object-fit:contain;image-orientation:from-image;transform:rotate(0deg);}.report-photo-empty{font-size:28px;color:#999;}' +
    '@media print{.report-page{width:100vw;height:100vh;}}' +
    '</style></head><body>' +
    '<section class="report-page cover">' + logoHtml + '<h1>' + otsEscapeHtml(ctx.title) + '</h1><p>' + otsEscapeHtml(ctx.typeLabel) + ' / Generated ' + otsEscapeHtml(generated) + '</p></section>' +
    '<section class="report-page summary">' + logoHtml + '<h2>Summary</h2><table class="summary-table"><tbody>' +
      '<tr><td>Number of Venues</td><td>' + summary.venues + '</td></tr>' +
      '<tr><td>Number of Shows</td><td>' + summary.shows + '</td></tr>' +
      '<tr><td>Number of Bands</td><td>' + summary.bands + '</td></tr>' +
      '<tr><td>Number of Days Performed</td><td>' + summary.days + '</td></tr>' +
      '<tr><td>Total Footfall</td><td>' + summary.totalFootfall + '</td></tr>' +
      '<tr><td>Average Footfall per Show</td><td>' + summary.averageFootfall + '</td></tr>' +
    '</tbody></table></section>' +
    '<section class="report-page divider">' + logoHtml + '<h2>' + otsEscapeHtml(ctx.typeLabel) + '<br>Monthly Report - ' + otsEscapeHtml(monthLabelFromKey(ctx.monthKey, false)) + '</h2></section>' +
    showPages +
    '</body></html>';
}

async function openMonthlyReportWindow(autoPrint) {
  if (!requireAdminPerm('reports', autoPrint ? 'monthly report download' : 'monthly report view')) return;
  initMonthlyReportControls();
  var ctx = getMonthlyReportContext();
  var rows = getCurrentMonthlyReportRows(ctx);
  if (!rows.length) rows = buildMonthlyReportRows(ctx);
  if (rows.length) {
    renderMonthlyReportRows(ctx, rows);
  }
  if (!rows.length) {
    showToast('', 'No Report Data', 'No confirmed shows found for this month and type.');
    return;
  }
  var win = window.open('', '_blank');
  if (!win) {
    showToast('', 'Popup Blocked', 'Chrome blocked the report window. Allow popups for this site once, then tap ' + (autoPrint ? 'Download Report' : 'View Report') + ' again.');
    return;
  }
  win.document.open();
  win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Preparing Report</title><style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#12101f;color:#fff;font-family:Arial,sans-serif;text-align:center}.box{max-width:520px;padding:32px}.label{color:#ff8a35;letter-spacing:.16em;text-transform:uppercase;font-size:13px;font-weight:800}.title{font-size:28px;font-weight:800;margin:14px 0 8px}.sub{color:#b7b1c9;font-size:15px;line-height:1.5}</style></head><body><div class="box"><div class="label">OTS Report</div><div class="title">Preparing monthly report...</div><div class="sub">' + (autoPrint ? 'Loading proof photos. Chrome will open the PDF save window automatically.' : 'Loading proof photos. The report preview will open here.') + '</div></div></body></html>');
  win.document.close();
  showToast('', 'Preparing Report', autoPrint ? 'Chrome will open the PDF save window after photos load.' : 'Opening report preview after photos load.');
  try {
    await hydrateMonthlyReportPhotos(rows);
    await verifyMonthlyReportPhotos(rows);
    await normalizeMonthlyReportPhotos(rows);
    var html = buildMonthlyReportPrintHtml(ctx, rows);
    win.document.open();
    win.document.write(html);
    win.document.close();
  } catch(e) {
    try {
      win.document.open();
      win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Report Failed</title><style>body{font-family:Arial,sans-serif;padding:40px;color:#222}.err{color:#b42318;font-weight:700}</style></head><body><h1>Report could not be prepared</h1><p class="err">Please go back to the app and try again.</p></body></html>');
      win.document.close();
    } catch(_e) {}
    showToast('', 'Report Failed', 'Could not prepare the PDF report. Please try again.');
    console.error('[OTS] monthly report export:', e);
    return;
  }
  if (autoPrint) {
    setTimeout(function() {
      try { win.focus(); win.print(); } catch(e) {}
    }, 900);
  } else {
    try { win.focus(); } catch(e) {}
  }
  logAdminAction(autoPrint ? 'monthly_report_download' : 'monthly_report_view', ctx.title + ' / ' + rows.length + ' shows').catch(function(){});
}

async function viewMonthlyReport() {
  return openMonthlyReportWindow(false);
}

async function downloadMonthlyReportPDF() {
  return openMonthlyReportWindow(true);
}

async function exportMonthlyReportPDF() {
  return downloadMonthlyReportPDF();
}

// =======================================
// EXPORT CSV
// =======================================
function exportCSV() {
  if (!allBookings.length){showToast('','No Data','No bookings to export yet.');return;}
  const hdr=['Booking ID','Team / Performer Name','Booked By','Email','Phone','Venue','Date','Type','Amount','Status','Notes'];
  const rows=allBookings.map(b=>[b.id,b.name,getBookingPersonName(b),b.email,b.phone,b.venue,b.date,b.type,''+b.price,b.status,b.notes||'']);
  const csv=[hdr,...rows].map(r=>r.map(c=>`"${c}"`).join(',')).join('\n');
  const a=Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([csv],{type:'text/csv'})),download:'ots-bookings.csv'});
  a.click();
  showToast('','CSV Exported',allBookings.length+' record(s) downloaded.');
}

// =======================================
// CONFIRM MODAL
// =======================================
function showConfirmModalFn(b) {
  document.getElementById('modal-id').textContent=b.id;
  document.getElementById('modal-detail').innerHTML=`
    <div class="modal-detail-row"><span>Venue</span><span>${b.venue}</span></div>
    <div class="modal-detail-row"><span>Date</span><span>${formatDate(b.date)}</span></div>
    <div class="modal-detail-row"><span>Performance</span><span>${b.type}</span></div>
    <div class="modal-detail-row"><span>Team</span><span>${b.name}</span></div>
    <div class="modal-detail-row"><span>Booked By</span><span>${getBookingPersonName(b) || '-'}</span></div>
    <div class="modal-detail-row"><span>Slot Time</span><span>${getVenueTime(b.venueId)}</span></div>
    <div class="modal-detail-row"><span>Status</span><span style="color:var(--yellow)"> Pending Approval</span></div>`;
  document.getElementById('confirmModal').classList.add('show');
}
function closeConfirmModal(){document.getElementById('confirmModal').classList.remove('show');}
document.getElementById('confirmModal').addEventListener('click',e=>{if(e.target===e.currentTarget)closeConfirmModal();});
document.getElementById('venueModal').addEventListener('click',e=>{ if(e.target===e.currentTarget) e.preventDefault(); });
document.getElementById('createAdminModal').addEventListener('click',e=>{ if(e.target===e.currentTarget) e.preventDefault(); });
document.getElementById('adminAccessModal').addEventListener('click',e=>{ if(e.target===e.currentTarget) e.preventDefault(); });
// Member login page: never dismiss on outside click (it IS the page)
// document.getElementById('memberLoginPage') dismiss intentionally removed

// =======================================
// APPROVAL NOTIFICATION SYSTEM
// =======================================
let _notifTimer = null;
let _notifProgressTimer = null;
let _lastKnownStatuses = {}; // id  status snapshot at page load

function initStatusSnapshot() {
  // Record current statuses of myBookings so we only notify on *changes*
  myBookings.forEach(b => { _lastKnownStatuses[b.id] = b.status; });
}

function showApprovalNotif(type, venueName, bookingId) {
  if (!IN_APP_STATUS_NOTIFICATIONS_ENABLED) return;
  if (bookingId && _dismissedIds && _dismissedIds.has(String(bookingId))) return;
  // Record in persistent notification history
  _recordNotif({ id: bookingId, venue: venueName, status: type === 'approved' ? 'confirmed' : 'rejected', date: '' });
  updateNotifBadge();
  clearTimeout(_notifTimer);
  clearInterval(_notifProgressTimer);

  const notif = document.getElementById('approvalNotif');
  if (!notif) return; // element not yet in DOM
  const icon  = document.getElementById('an-icon');
  const title = document.getElementById('an-title');
  const body  = document.getElementById('an-body');
  const detail= document.getElementById('an-detail');
  const fill  = document.getElementById('an-progress-fill');

  notif.classList.remove('approved','rejected');

  if (type === 'approved') {
    notif.classList.add('approved');
    icon.textContent  = '';
    title.textContent = 'Slot Approved!';
    body.textContent  = `Your slot at ${venueName} has been confirmed by the admin.`;
    detail.textContent= `Booking ID: ${bookingId}`;
  } else {
    notif.classList.add('rejected');
    icon.textContent  = '';
    title.textContent = 'Slot Rejected';
    body.textContent  = `Your request for ${venueName} was not approved this time.`;
    detail.textContent= `Booking ID: ${bookingId}`;
  }

  fill.style.transition = 'none';
  fill.style.width = '100%';
  notif.classList.add('show');

  // Animated progress bar drain over 6 seconds
  setTimeout(() => {
    fill.style.transition = 'width 6s linear';
    fill.style.width = '0%';
  }, 50);

  _notifTimer = setTimeout(() => dismissApprovalNotif(), 6100);
}

function dismissApprovalNotif() {
  clearTimeout(_notifTimer);
  clearInterval(_notifProgressTimer);
  const notif = document.getElementById('approvalNotif');
  if (notif) notif.classList.remove('show');
}

// Poll Neon when visible and the user has pending bookings
let _pollTimer = null;
function startStatusPolling() {
  stopStatusPolling();
  pollMyBookingStatuses(); // fire immediately
  _pollTimer = setInterval(function(){ if (!document.hidden) pollMyBookingStatuses(); }, LIVE_STATUS_MS);
}
function stopStatusPolling() {
  clearInterval(_pollTimer);
  _pollTimer = null;
}

// -- My Requests live poll: re-fetch member bookings while page is open --
let _myReqPollTimer = null;
function startMyRequestsPoll() {
  stopMyRequestsPoll();
  fetchMyBookingsLive();
  _myReqPollTimer = setInterval(function(){ if (!document.hidden) fetchMyBookingsLive(); }, LIVE_STATUS_MS);
}
function stopMyRequestsPoll() {
  clearInterval(_myReqPollTimer);
  _myReqPollTimer = null;
}

// -- Gig calendar live poll: refresh ALL confirmed bookings every 30s --
let _gigPollTimer = null;
function startGigPoll() {
  if (_gigPollTimer) return; // already running
  _gigPollTimer = setInterval(async function() {
    if (document.hidden) return;
    try {
      const rows = await neonSQL(
        'SELECT id, venue_id, venue, date, type, name, booked_by, phone, visibility, status, created_at, ' + LIGHT_PROOF_SQL + ', proof_claimed, checkin_at, checkin_lat, checkin_lng, checkin_accuracy, checkin_map_url, performers FROM bookings WHERE status=$1 AND date >= $2 ORDER BY date ASC LIMIT 180',
        ['confirmed', todayIsoLocal()]
      );
      const confirmedIds = new Set(rows.map(function(r){ return r.id; }));
      // Remove stale confirmed entries and add new ones
      allBookings = allBookings.filter(function(b){ return b.status !== 'confirmed' || confirmedIds.has(b.id); });
      rows.forEach(function(r) {
        var existing = allBookings.find(function(b){ return b.id === r.id; });
        if (!existing) {
          allBookings.push({
            id:r.id, venueId:r.venue_id||'', venue:r.venue||'',
            date:r.date||'', type:r.type||'', name:r.name||'',
            phone:r.phone||'', status:'confirmed', createdAt:r.created_at||'',
            visibility:normalizeTitleCase(r.visibility, 'Public'),
            proofUrl:r.proof_url||'', proofClaimed:!!r.proof_claimed,
            checkinAt:r.checkin_at||null,
            checkinLat:r.checkin_lat||null,
            checkinLng:r.checkin_lng||null,
            checkinAccuracy:r.checkin_accuracy||null,
            checkinMapUrl:r.checkin_map_url||'',
            performers:parseBookingPerformers(r.performers)
          });
        } else {
          existing.proofUrl = r.proof_url||'';
          existing.proofClaimed = !!r.proof_claimed;
          existing.checkinAt = r.checkin_at||null;
          existing.checkinLat = r.checkin_lat||null;
          existing.checkinLng = r.checkin_lng||null;
          existing.checkinAccuracy = r.checkin_accuracy||null;
          existing.checkinMapUrl = r.checkin_map_url||'';
          existing.performers = parseBookingPerformers(r.performers);
        }
      });
      renderGigCalendar();
    } catch(e) { /* silent - keep showing last known data */ }
  }, LIVE_GIG_MS); // faster live sync for confirmed shows
}

async function pollMyBookingStatuses() {
  const pendingIds = myBookings.filter(b => b.status === 'pending').map(b => b.id);
  if (!pendingIds.length) { stopStatusPolling(); return; }

  try {
    const placeholders = pendingIds.map(function(_, i){ return '$' + (i+1); }).join(',');
    const rows = await neonSQL('SELECT id, status FROM bookings WHERE id IN (' + placeholders + ')', pendingIds);

    rows.forEach(row => {
      const prev = _lastKnownStatuses[row.id];
      if (prev === 'pending' && (row.status === 'confirmed' || row.status === 'rejected')) {
        // Update local state
        const b = myBookings.find(x => x.id === row.id);
        if (b) b.status = row.status;
        const ab = allBookings.find(x => x.id === row.id);
        if (ab) ab.status = row.status;
        _lastKnownStatuses[row.id] = row.status;

        // Show notification to user
        const booking = myBookings.find(x => x.id === row.id);
        showApprovalNotif(row.status === 'confirmed' ? 'approved' : 'rejected', booking?.venue || 'your venue', row.id);

        // Refresh UI
        renderUserBookings();
        renderGigCalendar();   // keep home page gig calendar in sync
        renderVenueList();
        saveLocal();
        saveMyBookings(); // persist the updated status so next refresh shows correct state
      }
    });
  } catch(e) { /* silent fail */ }
}


let _tt;
function showToast(icon,title,msg){
  clearTimeout(_tt);
  document.getElementById('toast-icon').textContent=icon;
  document.getElementById('toast-title').textContent=title;
  document.getElementById('toast-msg').textContent=msg;
  const t=document.getElementById('toast');
  t.classList.add('show');
  _tt=setTimeout(()=>t.classList.remove('show'),3800);
}

// =======================================
// HELPERS
// =======================================
function formatDateShort(iso) {
  if (!iso) return '-';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const parts = iso.split('-');
  if (parts.length === 3) return `${parts[2]} ${months[parseInt(parts[1],10)-1]} ${parts[0]}`;
  return iso;
}
function formatTime(t) {
  if (!t) return '-';
  const [h,m] = t.split(':');
  const hr = parseInt(h); const ampm = hr>=12?'PM':'AM';
  return `${hr%12||12}:${m} ${ampm}`;
}

// =======================================
// START
// =======================================
// =======================================
// PHOTO MANAGER
// =======================================
let perfPhotos = []; // [{id, dataUrl, label}]
const PERF_HOME_LIMIT = 18;
const PERF_ADMIN_PAGE_SIZE = 24;
let perfPhotoVisibleCount = PERF_ADMIN_PAGE_SIZE;
let _perfPhotoLabelSaveTimer = null;
let _perfPhotoUploadBusy = false;
let _perfPhotoLocalEditAt = 0;
// perf photos are stored in the gallery Neon table with id prefixed 'perf_'
// so they sync across all devices automatically

// -- Neon DB: Photos stored as base64 data URLs in gallery table (no external storage needed) --

function markPerfPhotosLocalEdit() {
  _perfPhotoLocalEditAt = Date.now();
}

function mergePerfPhotoLists(localList, remoteList) {
  var map = new Map();
  (remoteList || []).forEach(function(p) {
    if (p && p.id) map.set(String(p.id), p);
  });
  (localList || []).forEach(function(p) {
    if (p && p.id) map.set(String(p.id), p);
  });
  return Array.from(map.values());
}

function shouldRenderPhotoManager() {
  var photosTab = document.getElementById('atab-content-photos');
  return !!(photosTab && photosTab.style.display !== 'none');
}

function fastRenderPhotoManager() {
  if (shouldRenderPhotoManager()) renderPhotoManager();
}

function otsIdbStore() {
  return new Promise(function(resolve, reject) {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
    var req = indexedDB.open('ots_fast_cache_v1', 1);
    req.onupgradeneeded = function() {
      var db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error || new Error('IndexedDB open failed')); };
  });
}

async function otsIdbGet(key) {
  try {
    var db = await otsIdbStore();
    return await new Promise(function(resolve, reject) {
      var tx = db.transaction('kv', 'readonly');
      var req = tx.objectStore('kv').get(key);
      req.onsuccess = function() { resolve(req.result); };
      req.onerror = function() { reject(req.error); };
      tx.oncomplete = function(){ try { db.close(); } catch(e) {} };
    });
  } catch(e) {
    return null;
  }
}

async function otsIdbSet(key, value) {
  try {
    var db = await otsIdbStore();
    await new Promise(function(resolve, reject) {
      var tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = function(){ resolve(); try { db.close(); } catch(e) {} };
      tx.onerror = function(){ reject(tx.error); };
    });
    return true;
  } catch(e) {
    return false;
  }
}

function cachePerfPhotoPreview() {
  try {
    localStorage.setItem('ots_perf_photos', JSON.stringify((perfPhotos || []).slice(0, PERF_HOME_LIMIT)));
  } catch(e) {}
}

function cachePerfPhotosFull() {
  otsIdbSet('perf_photos_full', perfPhotos || []).catch(function(){});
}

function loadCachedPerfPhotoPreview() {
  try {
    const cached = JSON.parse(localStorage.getItem('ots_perf_photos') || '[]');
    if (cached.length) {
      perfPhotos = cached;
      renderPerfStrip();
    } else {
      renderPerfStrip();
    }
  } catch(e) {
    renderPerfStrip();
  }
}

// Convert a File to base64 data URL (replaces Supabase Storage upload)
async function sbStorageUpload(file, path) {
  return new Promise(function(resolve, reject) {
    try {
      // Keep front-page images small enough for Neon HTTP sync. Saving original
      // phone photos as base64 can silently fail or vanish on the next refresh.
      _compressImage(file, 900, 0.62, function(dataUrl) { resolve(dataUrl); });
    } catch(e) {
      reject(e || new Error('Image compression failed'));
    }
  });
}

// No-op delete (base64 lives in the gallery row; deleting the row removes the photo)
async function sbStorageDelete(path) {
  // Nothing to do - photo is deleted when the gallery row is deleted
}

async function loadPerfPhotos() {
  // -- Step 1: Show cached photos INSTANTLY (no waiting) --
  try {
    const cachedFull = await otsIdbGet('perf_photos_full');
    if (cachedFull && cachedFull.length) {
      perfPhotos = _filterDeletedPerfPhotos(cachedFull);
      renderPerfStrip();   // visible immediately
      fastRenderPhotoManager();
    } else {
      const cached = JSON.parse(localStorage.getItem('ots_perf_photos') || '[]');
      if (cached.length) {
        perfPhotos = cached;
        renderPerfStrip();
        fastRenderPhotoManager();
      }
    }
  } catch(e) {}

  // -- Step 2: Refresh from Neon in background, update if different --
  try {
    const rows = await sbGet('gallery','id,url,caption');
    const perf = rows.filter(r => r.id && r.id.startsWith('perf_'));
    if (perf.length) {
      var remotePhotos = perf.map(r => ({ id: r.id, dataUrl: r.url, label: r.caption || '' }));
      perfPhotos = mergePerfPhotoLists(perfPhotos, remotePhotos);
      cachePerfPhotoPreview();
      cachePerfPhotosFull();
      renderPerfStrip();    // update with latest from cloud
      fastRenderPhotoManager();
    } else if (!perfPhotos.length) {
      // DB is empty and no cache - show placeholders
      renderPerfStrip();
      fastRenderPhotoManager();
    }
  } catch(e) {
    // Neon unreachable - cached version already shown, no action needed
  }
}

async function savePerfPhotos() {
  try { perfPhotos = _filterDeletedPerfPhotos(perfPhotos); } catch(e) {}
  markPerfPhotosLocalEdit();
  // Save lightweight copy to localStorage (store url not base64 where possible)
  try {
    cachePerfPhotoPreview();
    cachePerfPhotosFull();
  } catch(e) {}
  // Sync gallery rows to Neon (url/base64 + caption)
  try {
    // Do not delete remote rows here. A browser may have a stale/partial photo
    // cache, so missing local rows must not wipe photos added from another device.
    // Only deletePhoto() is allowed to remove a backend gallery row.
    if (perfPhotos.length) {
      const rows = perfPhotos.map(p => ({ id: p.id, url: p.dataUrl, caption: p.label || '' }));
      await sbUpsert('gallery', rows);
    }
    showSyncStatus(' Photos synced', 'var(--green)');
  } catch(e) {
    console.warn('Perf photos Neon sync failed, saved locally only:', e);
    showSyncStatus(' Photos saved locally only', 'var(--orange)');
  }
}

async function saveSinglePerfPhoto(photo) {
  if (!photo || !photo.id || !photo.dataUrl) throw new Error('Photo data missing');
  await sbUpsert('gallery', [{
    id: photo.id,
    url: photo.dataUrl,
    caption: photo.label || ''
  }]);
  markPerfPhotosLocalEdit();
  cachePerfPhotoPreview();
  cachePerfPhotosFull();
}

async function handlePhotoUpload(e) {
  if (!requireAdminPerm('photos', 'photo management')) { if (e && e.target) e.target.value = ''; return; }
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  e.target.value = '';

  const tooBig = files.filter(f => f.size > 5 * 1024 * 1024);
  tooBig.forEach(f => showToast('', 'Too Large', f.name + ' exceeds 5 MB, skipped.'));
  const valid = files.filter(f => f.size <= 5 * 1024 * 1024);
  if (!valid.length) return;

  showToast('', 'Uploading...', 'Adding ' + valid.length + ' photo(s) to the app...');

  let successCount = 0;
  _perfPhotoUploadBusy = true;
  markPerfPhotosLocalEdit();
  try {
    for (const file of valid) {
      try {
        const ext  = file.name.split('.').pop().toLowerCase() || 'jpg';
        const id   = 'perf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const path = id + '.' + ext;
      const publicUrl = await sbStorageUpload(file, path);
      const label = file.name.replace(/\.[^.]+$/, '');
        var newPhoto = { id, dataUrl: publicUrl, label };
        await saveSinglePerfPhoto(newPhoto);
        perfPhotos.unshift(newPhoto);
        markPerfPhotosLocalEdit();
        cachePerfPhotoPreview();
        cachePerfPhotosFull();
        successCount++;
        fastRenderPhotoManager();
        renderPerfStrip();
      } catch(err) {
        console.error('Upload error:', err);
        showToast('', 'Upload Failed', file.name + ' could not be uploaded.');
      }
    }

    if (successCount > 0) {
      fastRenderPhotoManager();
      renderPerfStrip();
      // Home/front page updates through live sync while Home is open
      // stay in admin panel after photo upload
      logAdminAction('upload_photo', successCount + ' photo(s) uploaded').catch(function(){});
      showToast('', 'Photos Added!', successCount + ' photo(s) now visible in the app.');
    }
  } finally {
    _perfPhotoUploadBusy = false;
  }
}

function deletePhoto(id) {
  if (!requireAdminPerm('photos', 'photo management')) return;
  id = String(id || '').trim();
  if (!id || id.indexOf('perf_') !== 0) return;
  const ph = perfPhotos.find(p => p.id === id);
  perfPhotos = perfPhotos.filter(p => p.id !== id);
  try { if (typeof _markPerfPhotoDeleted === 'function') _markPerfPhotoDeleted(id); } catch(e) {}
  markPerfPhotosLocalEdit();
  fastRenderPhotoManager(); renderPerfStrip();
  dbDeleteGallery(id)
    .then(function(){ return savePerfPhotos(); })
    .then(function() {
    logAdminAction('delete_photo', ph ? ph.label || id : id).catch(function(){});
    showToast('','Photo Removed','Removed from all devices.');
  }).catch(function(e) {
    console.error('Photo delete failed:', e);
    showToast('', 'Delete Failed', 'Could not remove the photo from live data. Please refresh and try again.');
  });
}

function movePhoto(id, dir) {
  if (!requireAdminPerm('photos', 'photo management')) return;
  const i = perfPhotos.findIndex(p => p.id === id);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= perfPhotos.length) return;
  [perfPhotos[i], perfPhotos[j]] = [perfPhotos[j], perfPhotos[i]];
  markPerfPhotosLocalEdit();
  fastRenderPhotoManager(); renderPerfStrip();
  savePerfPhotos();
}

function updatePhotoLabel(id, val) {
  if (!hasAdminPerm('photos')) return;
  const p = perfPhotos.find(x => x.id === id);
  if (!p) return;
  p.label = val;
  markPerfPhotosLocalEdit();
  cachePerfPhotoPreview();
  clearTimeout(_perfPhotoLabelSaveTimer);
  _perfPhotoLabelSaveTimer = setTimeout(function(){
    renderPerfStrip();
    savePerfPhotos();
  }, 700);
}

function showMorePerfPhotos() {
  perfPhotoVisibleCount += PERF_ADMIN_PAGE_SIZE;
  renderPhotoManager();
}

function renderPhotoManager() {
  const grid = document.getElementById('photoMgmtGrid');
  const empty = document.getElementById('photoEmptyState');
  const canEditPhotos = hasAdminPerm('photos');
  if (!grid) return;
  if (!perfPhotos.length) { grid.innerHTML=''; empty.style.display='block'; return; }
  empty.style.display='none';
  const visible = perfPhotos.slice(0, perfPhotoVisibleCount);
  grid.innerHTML = visible.map((p,i) => `
    <div class="photo-mgmt-card" data-photo-id="${otsEscapeHtml(p.id)}">
      <div class="pmc-order">#${i+1}</div>
      <img class="pmc-thumb" src="${otsEscapeHtml(p.dataUrl)}" alt="${otsEscapeHtml(p.label)}" loading="lazy" decoding="async">
      <div class="pmc-body">
        <input class="pmc-label-input" value="${otsEscapeHtml(p.label)}" placeholder="Caption..." oninput="updatePhotoLabel('${otsJsString(p.id)}', this.value)" ${canEditPhotos ? '' : 'disabled'}>
        <div class="pmc-actions" ${canEditPhotos ? '' : 'style="display:none;"'}>
          <button class="pmc-move" onclick="movePhoto('${otsJsString(p.id)}',-1)" title="Move left" ${i===0?'disabled style="opacity:.3"':''}></button>
          <button class="pmc-move" onclick="movePhoto('${otsJsString(p.id)}',1)"  title="Move right" ${i===perfPhotos.length-1?'disabled style="opacity:.3"':''}></button>
          <button class="pmc-del" data-photo-id="${otsEscapeHtml(p.id)}" onclick="deletePhoto('${otsJsString(p.id)}')">x Remove</button>
        </div>
      </div>
    </div>`).join('') + (perfPhotoVisibleCount < perfPhotos.length
      ? `<button type="button" class="photo-load-more" onclick="showMorePerfPhotos()">Load more photos (${perfPhotos.length - perfPhotoVisibleCount} left)</button>`
      : '');
}

function renderPerfStrip() {
  const strip = document.getElementById('perfStrip');
  if (!strip) return;
  if (!perfPhotos.length) {
    // show placeholder cards
    strip.innerHTML = ['','','','','','',''].map((ic,i) => `
      <div class="perf-img-card placeholder">
        <span class="ph-icon">${ic}</span><span class="ph-txt">Photos</span>
      </div>`).join('') + ['','','','','','',''].map((ic,i) => `
      <div class="perf-img-card placeholder">
        <span class="ph-icon">${ic}</span><span class="ph-txt">Photos</span>
      </div>`).join('');
    return;
  }
  // Keep the animated strip light. More than this is managed in admin, but the
  // home page only needs a smooth rotating preview.
  const stripPhotos = perfPhotos.slice(0, PERF_HOME_LIMIT);
  const loopPhotos = stripPhotos.length < 6 ? [...stripPhotos, ...stripPhotos, ...stripPhotos] : [...stripPhotos, ...stripPhotos];
  const cards = loopPhotos.map(p => `
    <div class="perf-img-card">
      <img src="${otsEscapeHtml(p.dataUrl)}" alt="${otsEscapeHtml(p.label)}" loading="lazy" decoding="async">
      <div class="perf-overlay"></div>
      <div class="perf-label">${otsEscapeHtml(p.label)}</div>
    </div>`).join('');
  strip.innerHTML = cards;
}

// Drag-and-drop on drop zone + initial load
function initPhotoManager() {
  // Home should start from a tiny preview cache. The full photo list loads only
  // when admin opens the Photos tab.
  loadCachedPerfPhotoPreview();
  const dz = document.getElementById('photoDropZone');
  if (dz) {
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault(); dz.classList.remove('drag-over');
      const dt = e.dataTransfer;
      if (dt && dt.files.length) {
        const fakeEv = { target: { files: dt.files, value:'' }, preventDefault:()=>{} };
        handlePhotoUpload(fakeEv);
      }
    });
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPhotoManager);
} else {
  initPhotoManager();
}

// =======================================
// PERF STRIP - DRAG TO SCROLL
// =======================================
(function() {
  function initStripDrag() {
    const wrap  = document.querySelector('.perf-strip-wrap');
    const strip = document.getElementById('perfStrip');
    if (!wrap || !strip) return;
    if (window.matchMedia && window.matchMedia('(max-width: 700px), (pointer: coarse)').matches) {
      strip.classList.add('paused');
      return;
    }

    let isDown = false, startX = 0, scrollLeft = 0, resumeTimer = null;

    function pauseAnim() {
      strip.classList.add('paused');
      clearTimeout(resumeTimer);
    }
    function resumeAnim() {
      resumeTimer = setTimeout(() => strip.classList.remove('paused'), 1200);
    }

    // Mouse
    wrap.addEventListener('mousedown', e => {
      isDown = true;
      wrap.classList.add('dragging');
      startX = e.pageX - wrap.offsetLeft;
      scrollLeft = wrap.scrollLeft;
      pauseAnim();
    });
    window.addEventListener('mouseup', () => {
      if (!isDown) return;
      isDown = false;
      wrap.classList.remove('dragging');
      resumeAnim();
    });
    wrap.addEventListener('mousemove', e => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - wrap.offsetLeft;
      wrap.scrollLeft = scrollLeft - (x - startX);
    });

    // Touch
    wrap.addEventListener('touchstart', e => {
      startX = e.touches[0].pageX - wrap.offsetLeft;
      scrollLeft = wrap.scrollLeft;
      pauseAnim();
    }, { passive: true });
    wrap.addEventListener('touchend', resumeAnim, { passive: true });
    wrap.addEventListener('touchmove', e => {
      const x = e.touches[0].pageX - wrap.offsetLeft;
      wrap.scrollLeft = scrollLeft - (x - startX);
    }, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initStripDrag);
  } else {
    initStripDrag();
  }
})();

// =======================================
// ADMIN AUTH
// =======================================
// Credentials stored in localStorage so they survive page refresh
// Defaults: admin / ots2024
function getAdminUser(){ return localStorage.getItem('ots_admin_user') || 'admin'; }
function getAdminPass(){ return localStorage.getItem('ots_admin_pass') || 'ots2024'; }

let adminLoggedIn = false;
let currentAdminUsername = '';
let currentAdminRole = 'admin';
let currentAdminPermissions = {};
let _logoClicks = 0, _logoTimer = null;
var _adminDataLoading = false;
var _adminRefreshSeq = 0;
var _adminRetryTimer = null;
var _createAdminSaving = false;
var _adminAccessSaving = false;

var ADMIN_PERMISSION_DEFS = [
  { key:'slots',   label:'Slot approvals', desc:'Approve/reject/cancel bookings and edit booking details.' },
  { key:'venues',  label:'Venues',         desc:'Add, edit, import, classify, open/close and delete venues.' },
  { key:'claims',  label:'Claims & show rescue', desc:'Approve claims, give special-show 1 point, emergency upload/show credit and restore follow-ups.' },
  { key:'photos',  label:'Front photos',   desc:'Upload, reorder, rename and remove home page photos.' },
  { key:'ads',     label:'Community news', desc:'Create and manage event ads, announcements and news images.' },
  { key:'members', label:'Members & zones', desc:'Add/import/edit members, approve zones and activate accounts.' },
  { key:'points',  label:'Points & zone reports', desc:'Manage monthly zone reports, CSV point imports, volunteer points and withdrawals.' },
  { key:'reports', label:'Monthly reports', desc:'Edit report rows/photos/footfall, remove shows and view/download PDFs.' },
  { key:'errors',  label:'Error reports',  desc:'Review technical bug reports and send test diagnostics.' }
];
function normalizeAdminRole(role) {
  var r = String(role || '').trim().toLowerCase().replace(/[\s-]+/g, '');
  if (r === 'superadmin' || r === 'superadministrator' || r === 'super') return 'superadmin';
  return 'admin';
}
function parseAdminPermissions(value) {
  if (!value) return {};
  if (typeof value === 'object') return value || {};
  try { return JSON.parse(value || '{}') || {}; } catch(e) { return {}; }
}
function hasAdminPerm(key) {
  if (isCurrentSuperAdmin()) return true;
  return !!(currentAdminPermissions && currentAdminPermissions[key]);
}
function isCurrentSuperAdmin() {
  currentAdminRole = normalizeAdminRole(currentAdminRole);
  return currentAdminRole === 'superadmin';
}
function requireAdminPerm(key, label) {
  if (hasAdminPerm(key)) return true;
  showToast('', 'View Only Access', 'You can view this area, but only Super Admin can give you ' + (label || 'edit') + ' access.');
  return false;
}
function getCheckedAdminPermissions(prefix) {
  var perms = {};
  ADMIN_PERMISSION_DEFS.forEach(function(def) {
    var el = document.getElementById(prefix + def.key);
    perms[def.key] = isAdminPermissionChecked(el);
  });
  return perms;
}
function setCheckedAdminPermissions(prefix, perms) {
  perms = parseAdminPermissions(perms);
  ADMIN_PERMISSION_DEFS.forEach(function(def) {
    var el = document.getElementById(prefix + def.key);
    setAdminPermissionChecked(el, !!perms[def.key]);
  });
}
function adminPermissionSummary(perms, role) {
  if (normalizeAdminRole(role) === 'superadmin') return 'Full access';
  perms = parseAdminPermissions(perms);
  var names = ADMIN_PERMISSION_DEFS.filter(function(def){ return !!perms[def.key]; }).map(function(def){ return def.label; });
  return names.length ? names.join(', ') : 'View only';
}
function renderPermissionChecks(prefix, selected) {
  selected = parseAdminPermissions(selected);
  return '<div class="admin-permission-grid">' + ADMIN_PERMISSION_DEFS.map(function(def) {
    var checked = !!selected[def.key];
    return '<div class="admin-permission-card ' + (checked ? 'is-checked' : '') + '" ' +
      'id="' + prefix + def.key + '" role="checkbox" aria-checked="' + (checked ? 'true' : 'false') + '" ' +
      'data-checked="' + (checked ? 'true' : 'false') + '" data-permission-key="' + otsEscapeHtml(def.key) + '" ' +
      'tabindex="0" ' +
      'onpointerdown="return guardAdminPermissionPointer(event)" onmousedown="return guardAdminPermissionPointer(event)" ' +
      'onkeydown="return handleAdminPermissionKey(event,this)" onclick="return toggleAdminPermissionCard(event,this)">' +
      '<span class="admin-permission-box" aria-hidden="true"></span>' +
      '<span class="admin-permission-copy"><strong>' + otsEscapeHtml(def.label) + '</strong>' +
      '<span>' + otsEscapeHtml(def.desc) + '</span></span>' +
    '</div>';
  }).join('') + '</div>';
}

function isAdminPermissionChecked(el) {
  if (!el) return false;
  if (el.type === 'checkbox') return !!el.checked;
  return el.getAttribute('aria-checked') === 'true' || el.getAttribute('data-checked') === 'true';
}

function setAdminPermissionChecked(el, checked) {
  if (!el) return;
  checked = !!checked;
  if (el.type === 'checkbox') {
    el.checked = checked;
    return;
  }
  el.setAttribute('aria-checked', checked ? 'true' : 'false');
  el.setAttribute('data-checked', checked ? 'true' : 'false');
  el.classList.toggle('is-checked', checked);
}

function toggleAdminPermissionCard(event, el) {
  if (event) {
    try {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    } catch(e) {}
  }
  setAdminPermissionChecked(el, !isAdminPermissionChecked(el));
  try {
    if (document.activeElement && document.activeElement !== el && document.activeElement.blur) {
      document.activeElement.blur();
    }
    if (el && el.focus) el.focus({ preventScroll:true });
  } catch(e) {}
  return false;
}

function guardAdminPermissionPointer(event) {
  if (event) {
    try {
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    } catch(e) {}
  }
  return true;
}

function handleAdminPermissionKey(event, el) {
  var key = event && (event.key || event.code);
  if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') return true;
  return toggleAdminPermissionCard(event, el);
}

function handleLogoClick() {
  _logoClicks++;
  clearTimeout(_logoTimer);
  if (_logoClicks >= 3) {
    _logoClicks = 0;
    if (otsIsMemberApp()) {
      showPage('home');
      return;
    }
    // Re-verify session from localStorage in case in-memory var was reset
    if (!adminLoggedIn && _hasAdminSession()) {
      restoreAdminSession();
    }
    if (adminLoggedIn) {
      // Hide member login overlay if showing, go straight to admin
      document.getElementById('memberLoginPage').classList.add('hidden');
      document.getElementById('loginPage').classList.remove('show');
      showPage('admin');
      refreshAdmin();
      if (!_adminPollTimer) startAdminPolling();
    } else {
      document.getElementById('loginPage').classList.add('show');
      document.getElementById('loginUser').focus();
    }
  } else {
    _logoTimer = setTimeout(() => {
      if (_logoClicks > 0) {
        _logoClicks = 0;
        // Single/double click: go to home page
        var activePage = document.querySelector('.page.active');
        var curPage = activePage ? activePage.id.replace('page-', '') : 'home';
        if (curPage !== 'home') showPage('home');
      }
    }, 800);
  }
}

// -- CHANGE CREDENTIALS ------------------
function openChangeCreds() {
  document.getElementById('credsOverlay').classList.add('show');
  document.getElementById('credsSuccess').classList.remove('show');
  document.getElementById('credsErr').classList.remove('show');
  // pre-fill current username
  document.getElementById('newUser').value = getAdminUser();
  document.getElementById('newPass').value = '';
  document.getElementById('confirmPass').value = '';
  document.getElementById('currentPassCheck').value = '';
  document.getElementById('newUser').focus();
}
function closeChangeCreds() {
  document.getElementById('credsOverlay').classList.remove('show');
}
function saveNewCreds() {
  const currentOk = document.getElementById('currentPassCheck').value;
  const newUser   = document.getElementById('newUser').value.trim();
  const newPass   = document.getElementById('newPass').value;
  const confirm   = document.getElementById('confirmPass').value;
  const err       = document.getElementById('credsErr');
  const ok        = document.getElementById('credsSuccess');
  err.classList.remove('show'); ok.classList.remove('show');

  if (currentOk !== getAdminPass()) {
    err.textContent = ' Current password is incorrect.';
    err.classList.add('show'); return;
  }
  if (!newUser) {
    err.textContent = ' Username cannot be empty.';
    err.classList.add('show'); return;
  }
  if (newPass.length < 4) {
    err.textContent = ' New password must be at least 4 characters.';
    err.classList.add('show'); return;
  }
  if (newPass !== confirm) {
    err.textContent = ' Passwords do not match.';
    err.classList.add('show'); return;
  }
  localStorage.setItem('ots_admin_user', newUser);
  localStorage.setItem('ots_admin_pass', newPass);
  ok.classList.add('show');
  setTimeout(() => closeChangeCreds(), 1400);
  showToast('', 'Credentials Updated', 'New username & password saved.');
}

async function fetchAdminLoginRow(username) {
  var sqlWithPerms = "SELECT id,username,password,role,active,permissions FROM admins WHERE username=$1 AND active=true LIMIT 1";
  try {
    var rows = await neonSQL(sqlWithPerms, [username]);
    return rows && rows.length ? rows[0] : null;
  } catch(e) {
    var msg = String(e && (e.message || e) || '');
    if (/permissions|column/i.test(msg)) {
      try { await neonSQL("ALTER TABLE admins ADD COLUMN IF NOT EXISTS permissions TEXT DEFAULT '{}'"); } catch(_) {}
      try {
        var rows2 = await neonSQL(sqlWithPerms, [username]);
        return rows2 && rows2.length ? rows2[0] : null;
      } catch(_) {}
      var rows3 = await neonSQL("SELECT id,username,password,role,active FROM admins WHERE username=$1 AND active=true LIMIT 1", [username]);
      return rows3 && rows3.length ? rows3[0] : null;
    }
    throw e;
  }
}

async function doLogin() {
  const u = document.getElementById('loginUser').value.trim();
  const p = (document.getElementById('loginPass').value || '').trim();
  const err = document.getElementById('loginErr');
  const loginBtn = document.getElementById('adminLoginBtn');
  let authenticated = false;
  let role = 'admin';
  let permissions = {};
  let loginProblem = '';
  if (err) err.classList.remove('show');
  if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = 'Signing in...'; }
  try {
    // Legacy super-admin credentials should not wait for Neon when the database is waking up.
    if (u === getAdminUser() && p === getAdminPass()) {
      authenticated = true;
      role = 'superadmin';
      permissions = {};
    } else {
      try {
        var row = await Promise.race([
          fetchAdminLoginRow(u),
          new Promise(function(_, reject){ setTimeout(function(){ reject(new Error('Admin login check timed out')); }, 7000); })
        ]);
        if (row && String(row.password || '').trim() === p) {
          authenticated = true;
          role = normalizeAdminRole(row.role || 'admin');
          permissions = parseAdminPermissions(row.permissions);
        }
      } catch(e) {
        loginProblem = e && (e.message || e) ? String(e.message || e) : '';
        console.warn('[OTS] Admin DB login check failed:', e && (e.message || e));
      }
    }
  } finally {
    if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = 'Access Admin Panel'; }
  }
  if (authenticated) {
    adminLoggedIn = true;
    currentAdminUsername = u;
    currentAdminRole = normalizeAdminRole(role);
    currentAdminPermissions = permissions;
    _saveAdminSession();
    err.classList.remove('show');
    document.getElementById('loginPage').classList.remove('show');
    document.getElementById('memberLoginPage').classList.add('hidden');
    document.getElementById('loginUser').value = '';
    document.getElementById('loginPass').value = '';
    document.getElementById('logoutBtn').classList.add('show');
    var _ab2 = document.getElementById('adminPanelBtn'); if (_ab2) _ab2.style.display = '';
    _applySuperAdminVisibility();
    updatePendingBadge();
    loadAdminClaims().catch(function(){});
    showPage('admin');
    refreshAdmin();
    startAdminPolling();
    requestNativePushToken();
    saveAdminPushToken().catch(function(e){ console.warn('[OTS] admin push token save skipped:', e && (e.message || e)); });
    consumePendingNativeNotificationTap();
    logAdminAction('login', 'Logged in').catch(function(){});
    showToast('', 'Welcome back!', 'You are now logged in as ' + u + '.');
  } else {
    if (err) err.textContent = loginProblem && /timed out|fetch|network|Failed/i.test(loginProblem)
      ? 'Admin server is taking time. Check internet and try again.'
      : 'Incorrect username or password. Please try again.';
    if (err) err.classList.add('show');
    document.getElementById('loginPass').value = '';
    document.getElementById('loginPass').focus();
    const box = document.querySelector('.login-box');
    box.style.animation = 'shake .4s ease';
    setTimeout(() => box.style.animation = '', 400);
  }
}

// =======================================
// SUPER ADMIN PANEL
// =======================================
var _saAdmins = [];

// -- Admin Approval Queue Notification ----------------------------------------
var _adminNotifOpen = false;
var _adminNotifTimer = null;

function toggleAdminNotifPanel() {
  _adminNotifOpen ? closeAdminNotifPanel() : openAdminNotifPanel();
}

function openAdminNotifPanel() {
  _adminNotifOpen = true;
  var p = document.getElementById('adminNotifPanel');
  if (p) {
    p.style.display = '';
    if (window.innerWidth <= 700) {
      p.style.position = 'fixed';
      p.style.top = '86px';
      p.style.left = '12px';
      p.style.right = '12px';
      p.style.width = 'auto';
      p.style.maxHeight = '60vh';
    } else {
      p.style.position = 'absolute';
      p.style.top = 'calc(100% + 6px)';
      p.style.left = '';
      p.style.right = '0';
      p.style.width = '320px';
      p.style.maxHeight = '400px';
    }
  }
  loadAdminNotifPanel();
}

function closeAdminNotifPanel() {
  _adminNotifOpen = false;
  var p = document.getElementById('adminNotifPanel');
  if (p) p.style.display = 'none';
}

async function loadAdminNotifPanel() {
  var listEl = document.getElementById('adminNotifList');
  if (listEl) listEl.innerHTML = '<div style="color:var(--muted);font-size:.8rem;text-align:center;padding:2rem;">Loading...</div>';
  try {
    var pending = await neonSQL(
      "SELECT 'booking' AS type, id::TEXT AS ref_id, name, venue, date, created_at FROM bookings WHERE status='pending' " +
      "UNION ALL " +
      "SELECT 'claim' AS type, id::TEXT AS ref_id, member_name AS name, COALESCE(booking_id,'') AS venue, '' AS date, created_at FROM claims WHERE status='pending' " +
      "ORDER BY created_at DESC LIMIT 60"
    );
    var countEl = document.getElementById('adminNotifCount');
    if (countEl) {
      if (pending.length) { countEl.style.display=''; countEl.textContent = pending.length > 99 ? '99+' : pending.length; }
      else { countEl.style.display = 'none'; }
    }
    if (!listEl) return;
    if (!pending.length) {
      listEl.innerHTML = '<div style="color:var(--muted);font-size:.8rem;text-align:center;padding:2.5rem 1rem;line-height:1.6;">All caught up!<br><span style="font-size:.72rem;">No pending bookings or claims.</span></div>';
      return;
    }
    listEl.innerHTML = pending.map(function(r) {
      var isBooking = r.type === 'booking';
      var icon  = isBooking ? '' : '';
      var label = isBooking ? 'Booking' : 'Claim';
      var tab   = isBooking ? 'bookings' : 'claims';
      var sub   = isBooking
        ? ((r.venue||'Unknown venue') + (r.date ? ' - ' + formatDate(r.date) : ''))
        : ('Claim from ' + (r.name||'-'));
      var title = isBooking ? (r.name||'Unknown') : (r.name||'Unknown member');
      return '<div class="aq-item" data-tab="' + tab + '" style="display:flex;align-items:flex-start;gap:.75rem;padding:.75rem 1rem;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer;transition:background .15s;">' +
        '<div style="font-size:1.2rem;flex-shrink:0;margin-top:.1rem;pointer-events:none;">' + icon + '</div>' +
        '<div style="flex:1;min-width:0;pointer-events:none;">' +
          '<div style="font-size:.8rem;font-weight:700;">' + title + ' <span style="font-size:.62rem;background:rgba(245,200,66,.15);border:1px solid rgba(245,200,66,.3);color:var(--yellow);padding:.1rem .4rem;border-radius:3px;margin-left:.3rem;">' + label.toUpperCase() + '</span></div>' +
          '<div style="font-size:.72rem;color:var(--muted);margin-top:.15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + sub + '</div>' +
        '</div>' +
        '<div style="font-size:.65rem;color:rgba(244,240,255,.25);flex-shrink:0;align-self:center;pointer-events:none;"></div>' +
      '</div>';
    }).join('');
    // Attach click handlers via JS (avoid innerHTML onclick escaping issues)
    listEl.querySelectorAll('.aq-item').forEach(function(el) {
      el.addEventListener('mouseover', function() { el.style.background = 'rgba(255,255,255,.04)'; });
      el.addEventListener('mouseout',  function() { el.style.background = ''; });
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        var target = el.getAttribute('data-tab');
        closeAdminNotifPanel();
        switchAdminTab(target);
      });
    });
  } catch(e) {
    var listEl2 = document.getElementById('adminNotifList');
    if (listEl2) listEl2.innerHTML = '<div style="color:#e53e3e;font-size:.8rem;padding:1rem;">Error loading queue.</div>';
    console.error('[OTS] loadAdminNotifPanel:', e);
  }
}

async function updateAdminNotifCount() {
  try {
    var res = await neonSQL(
      "SELECT COUNT(*) AS n FROM (SELECT id FROM bookings WHERE status='pending' UNION ALL SELECT id FROM claims WHERE status='pending') sub"
    );
    var n = parseInt((res[0] && res[0].n) || 0, 10);
    var countEl = document.getElementById('adminNotifCount');
    if (countEl) {
      if (n > 0) { countEl.style.display=''; countEl.textContent = n > 99 ? '99+' : n; }
      else { countEl.style.display = 'none'; }
    }
    var btn = document.getElementById('adminNotifBellBtn');
    if (btn) btn.style.borderColor = n > 0 ? 'rgba(255,75,75,.5)' : 'var(--border)';
  } catch(e) {}
}

async function loadSuperAdminData() {
  currentAdminRole = normalizeAdminRole(currentAdminRole);
  if (!isCurrentSuperAdmin()) {
    _applySuperAdminVisibility();
    showToast('', 'Super Admin Only', 'Please log in with a Super Admin account.');
    return;
  }
  var adminsEl = document.getElementById('sa-admins-list');
  var logsEl = document.getElementById('sa-logs-list');
  if (adminsEl) adminsEl.innerHTML = '<div style="color:var(--muted);font-size:.85rem;">Loading admin accounts...</div>';
  if (logsEl) logsEl.innerHTML = '<div style="color:var(--muted);font-size:.85rem;">Loading activity...</div>';
  try {
    try {
      await neonSQL("ALTER TABLE admins ADD COLUMN IF NOT EXISTS permissions TEXT DEFAULT '{}'");
      await neonSQL("ALTER TABLE admins ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT true");
      await neonSQL("ALTER TABLE admins ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()");
      _saAdmins = await neonSQL("SELECT id,username,role,active,created_at,permissions FROM admins ORDER BY created_at");
    } catch(colErr) {
      console.warn('[OTS] super admin account load retry:', colErr && (colErr.message || colErr));
      _saAdmins = await neonSQL("SELECT id,username,role,active,created_at,permissions FROM admins ORDER BY created_at");
    }
    _renderSAAdmins();
  } catch(e) {
    console.error('[OTS] super admin account load failed:', e);
    if (adminsEl) adminsEl.innerHTML = '<div style="color:#ff8a35;line-height:1.6;">Could not load admin accounts. Check internet and tap Refresh. <br><span style="color:var(--muted);font-size:.78rem;">' + otsEscapeHtml((e && e.message) || 'Admin data request failed') + '</span></div>';
  }
  try {
    var logs = await neonSQL("SELECT admin_username,action,details,created_at FROM admin_logs ORDER BY created_at DESC LIMIT 150");
    _renderSALogs(logs);
  } catch(e) {
    console.warn('[OTS] super admin activity log load failed:', e && (e.message || e));
    if (logsEl) logsEl.innerHTML = '<div style="color:var(--muted);">Could not load logs. Admin accounts can still be managed above.</div>';
  }
}

function _renderSAAdmins() {
  var el = document.getElementById('sa-admins-list');
  if (!el) return;
  if (!_saAdmins.length) { el.innerHTML = '<div style="color:var(--muted);">No admins yet.</div>'; return; }
  el.innerHTML = '<div class="sa-admin-head">' +
    '<div>Username</div><div>Role</div><div>Access</div><div>Status</div><div></div></div>' +
    _saAdmins.map(function(a) {
      var isSelf = (a.username === currentAdminUsername);
      var role = normalizeAdminRole(a.role);
      var isActive = !(a.active === false || String(a.active).toLowerCase() === 'false' || String(a.active) === '0');
      var roleLabel = role === 'superadmin'
        ? '<span style="color:#7c3aed;font-weight:700;"> Super Admin</span>'
        : '<span style="color:var(--muted);">Admin</span>';
      var statusLabel = isActive
        ? '<span style="color:#22c55e;font-weight:600;">Active</span>'
        : '<span style="color:#ef4444;font-weight:600;">Disabled</span>';
      var safeUsername = otsEscapeHtml(a.username || '');
      var toggleBtn = isSelf ? '<span style="font-size:.7rem;color:var(--muted);">(you)</span>'
        : isActive
          ? '<button type="button" class="btn-reject sa-toggle-admin-btn" data-admin-id="' + otsEscapeHtml(a.id) + '" data-admin-username="' + safeUsername + '" data-admin-active="false" style="font-size:.72rem;padding:.2rem .5rem;">Disable</button>'
          : '<button type="button" class="btn-approve sa-toggle-admin-btn" data-admin-id="' + otsEscapeHtml(a.id) + '" data-admin-username="' + safeUsername + '" data-admin-active="true" style="font-size:.72rem;padding:.2rem .5rem;">Enable</button>';
      var accessBtn = role === 'superadmin' ? '' : '<button type="button" class="btn-secondary sa-access-btn" data-admin-id="' + otsEscapeHtml(a.id) + '" data-admin-username="' + safeUsername + '" style="font-size:.7rem;padding:.22rem .55rem;margin-right:.35rem;">Access</button>';
      return '<div class="sa-admin-row">' +
        '<div class="sa-admin-name">'+safeUsername+'</div>' +
        '<div class="sa-admin-role">'+roleLabel+'</div>' +
        '<div class="sa-admin-access">'+otsEscapeHtml(adminPermissionSummary(a.permissions, role))+'</div>' +
        '<div class="sa-admin-status">'+statusLabel+'</div>' +
        '<div class="sa-admin-actions">'+accessBtn+toggleBtn+'</div>' +
        '</div>';
    }).join('');
  bindSuperAdminAccountButtons();
}

function bindSuperAdminAccountButtons() {
  var root = document.getElementById('sa-admins-list');
  if (!root) return;
  root.querySelectorAll('.sa-access-btn').forEach(function(btn) {
    btn.addEventListener('click', function(event) {
      handleAdminAccessClick(event, btn.getAttribute('data-admin-id'), btn.getAttribute('data-admin-username') || '');
    }, { passive:false });
  });
  root.querySelectorAll('.sa-toggle-admin-btn').forEach(function(btn) {
    btn.addEventListener('click', function(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      toggleAdminActive(btn.getAttribute('data-admin-id'), btn.getAttribute('data-admin-active') === 'true', btn.getAttribute('data-admin-username') || '');
    }, { passive:false });
  });
}

function handleCreateAdminClick(event) {
  if (event) {
    try {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    } catch(e) {}
  }
  setSuperAdminUploadLock(true);
  openCreateAdminModal();
  return false;
}

function handleAdminAccessClick(event, id, username) {
  if (event) {
    try {
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    } catch(e) {}
  }
  setSuperAdminUploadLock(true);
  openAdminAccessModal(id, username);
  return false;
}

function _renderSALogs(logs) {
  var el = document.getElementById('sa-logs-list');
  if (!el) return;
  // Strip login-only entries
  var filtered = logs.filter(function(l){ return l.action !== 'login'; });
  if (!filtered.length) { el.innerHTML = '<div style="color:var(--muted);font-size:.85rem;">No activity yet.</div>'; return; }
  var actionLabels = {
    approve_booking: ' Approved booking',
    reject_booking:  ' Rejected booking',
    cancel_booking:  ' Cancelled booking',
    approve_claim:   ' Approved claim',
    reject_claim:    'x Rejected claim',
    add_venue:       ' Added venue',
    edit_venue:      ' Edited venue',
    delete_venue:    ' Deleted venue',
    import_venues:   ' Imported venues (CSV)',
    add_member:      ' Added member',
    remove_member:   ' Removed member',
    upload_photo:    ' Uploaded photo(s)',
    delete_photo:    ' Deleted photo',
    update_setting:  ' Changed setting',
    create_admin:    ' Created admin',
    update_admin_access: ' Updated admin access',
    enable_admin:    ' Enabled admin',
    disable_admin:   ' Disabled admin'
  };
  // Group entries by admin username (preserve order of first appearance)
  var order = [];
  var groups = {};
  filtered.forEach(function(l) {
    if (!groups[l.admin_username]) { groups[l.admin_username] = []; order.push(l.admin_username); }
    groups[l.admin_username].push(l);
  });
  el.innerHTML = order.map(function(username) {
    var rows = groups[username];
    var rowsHtml = rows.map(function(l) {
      return '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:1rem;padding:.3rem 0;border-top:1px solid var(--border);font-size:.82rem;">' +
        '<span>'+(actionLabels[l.action]||l.action)+(l.details ? ' - <span style="color:var(--muted);">'+l.details+'</span>' : '')+'</span>' +
        '<span style="font-size:.72rem;color:var(--muted);white-space:nowrap;">'+_fmtLogDate(l.created_at)+'</span>' +
        '</div>';
    }).join('');
    return '<div style="margin-bottom:1.25rem;">' +
      '<div style="font-weight:700;font-size:.9rem;margin-bottom:.4rem;color:var(--text);">'+username+'</div>' +
      rowsHtml +
      '</div>';
  }).join('');
}

function _fmtLogDate(ts) {
  if (!ts) return '-';
  var d = new Date(ts);
  return d.toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'2-digit'}) + ' ' +
         d.toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit',hour12:true});
}

// -- Platform Reset ------------------------------------------------------------
function openResetModal() {
  if (!isCurrentSuperAdmin()) return;
  var inp = document.getElementById('resetConfirmInput');
  var btn = document.getElementById('resetSubmitBtn');
  var err = document.getElementById('reset-err');
  if (inp) { inp.value = ''; }
  if (btn) { btn.disabled = true; btn.style.opacity = '.5'; btn.textContent = ' Delete & Reset Now'; }
  if (err) err.style.display = 'none';
  document.getElementById('resetPlatformModal').classList.add('show');
  setTimeout(function(){ if (inp) inp.focus(); }, 100);
}
function closeResetModal() {
  document.getElementById('resetPlatformModal').classList.remove('show');
}
async function submitPlatformReset() {
  if (!isCurrentSuperAdmin()) return;
  var inp = document.getElementById('resetConfirmInput');
  var btn = document.getElementById('resetSubmitBtn');
  var err = document.getElementById('reset-err');
  if (!inp || inp.value !== 'RESET') return;
  btn.disabled = true; btn.style.opacity = '.6'; btn.textContent = 'Deleting...';
  if (err) err.style.display = 'none';
  try {
    await neonSQL('DELETE FROM claims');
    await neonSQL('DELETE FROM bookings');
    await neonSQL('DELETE FROM gallery');
    await neonSQL('DELETE FROM admin_logs');
    // Clear all local caches
    try {
      localStorage.removeItem('ots_local_v4');
      localStorage.removeItem('ots_my_bookings_v1');
      localStorage.removeItem('ots_notif_seen_v1');
      localStorage.removeItem('ots_dismissed_v1');
    } catch(e) {}
    // Reset in-memory state
    allBookings = []; myBookings = []; _dismissedIds = new Set();
    await logAdminAction('platform_reset', 'All bookings, claims, gallery and logs deleted - new season started');
    closeResetModal();
    showToast('', 'Platform Reset', 'All data cleared. Starting fresh!');
    // Refresh all admin views
    renderApprovalQueue(); filterTable(); renderGigCalendar(); updateAdminStats(); updatePendingBadge();
    loadSuperAdminData();
  } catch(e) {
    if (err) { err.textContent = 'Reset failed: ' + (e && e.message ? e.message : e); err.style.display = ''; }
    btn.disabled = false; btn.style.opacity = '1'; btn.textContent = ' Delete & Reset Now';
    console.error('[OTS] platform reset failed:', e);
  }
}

// -- Venue Data Reset ---------------------------------------------------------
function openClearVenuesModal() {
  if (!isCurrentSuperAdmin()) return;
  var inp = document.getElementById('clearVenuesConfirmInput');
  var btn = document.getElementById('clearVenuesSubmitBtn');
  var err = document.getElementById('clear-venues-err');
  if (inp) inp.value = '';
  if (btn) { btn.disabled = true; btn.style.opacity = '.5'; btn.textContent = ' Delete Venues Now'; }
  if (err) err.style.display = 'none';
  document.getElementById('clearVenuesModal').classList.add('show');
  setTimeout(function(){ if (inp) inp.focus(); }, 100);
}
function closeClearVenuesModal() {
  document.getElementById('clearVenuesModal').classList.remove('show');
}
async function submitClearAllVenues() {
  if (!isCurrentSuperAdmin()) return;
  var inp = document.getElementById('clearVenuesConfirmInput');
  var btn = document.getElementById('clearVenuesSubmitBtn');
  var err = document.getElementById('clear-venues-err');
  if (!inp || inp.value !== 'DELETE VENUES') return;
  var deletedCount = venues.length;
  btn.disabled = true; btn.style.opacity = '.6'; btn.textContent = 'Deleting...';
  if (err) err.style.display = 'none';
  try {
    await neonSQL('DELETE FROM venues');
    venues = [];
    selectedVenueId = null;
    selectedDate = null;
    try {
      localStorage.removeItem('ots_selected_venue');
      var cached = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      cached.venues = [];
      cached.savedAt = Date.now();
      localStorage.setItem(LS_KEY, JSON.stringify(cached));
    } catch(e) {}
    renderCalendar();
    renderVenueList();
    renderVenueManager();
    renderGigCalendar();
    updateHeroStats();
    updateAdminStats();
    closeClearVenuesModal();
    logAdminAction('clear_all_venues', 'Deleted all venues (' + deletedCount + ')').catch(function(){});
    showSyncStatus(' All venues deleted','var(--green)');
    showToast('', 'Venues Deleted', 'All venue test data has been cleared.');
    if (currentAdminTab === 'superadmin') loadSuperAdminData();
  } catch(e) {
    if (err) { err.textContent = 'Delete failed: ' + (e && e.message ? e.message : e); err.style.display = ''; }
    btn.disabled = false; btn.style.opacity = '1'; btn.textContent = ' Delete Venues Now';
    console.error('[OTS] clear venues failed:', e);
  }
}

function openCreateAdminModal() {
  if (!isCurrentSuperAdmin()) return;
  setSuperAdminUploadLock(true);
  setAdminAccessControlModalOpen(true);
  _createAdminSaving = false;
  document.getElementById('ca-username').value = '';
  document.getElementById('ca-password').value = '';
  document.getElementById('ca-role').value = 'admin';
  var list = document.getElementById('ca-permissions-list');
  if (list) list.innerHTML = renderPermissionChecks('ca-perm-', { slots:true });
  syncCreateAdminPermissionUi();
  document.getElementById('ca-err').style.display = 'none';
  var btn = document.getElementById('ca-submit-btn');
  if (btn) { btn.disabled = false; btn.textContent = 'Create Admin'; }
  try { document.body.classList.add('modal-lock'); } catch(e) {}
  document.getElementById('createAdminModal').classList.add('show');
}
function closeCreateAdminModal() {
  if (_createAdminSaving) return;
  var modal = document.getElementById('createAdminModal');
  if (modal) modal.classList.remove('show');
  setAdminAccessControlModalOpen(false);
  try { document.body.classList.remove('modal-lock'); } catch(e) {}
  if (currentAdminTab !== 'superadmin') setSuperAdminUploadLock(false);
}
function syncCreateAdminPermissionUi() {
  var role = document.getElementById('ca-role') ? document.getElementById('ca-role').value : 'admin';
  var wrap = document.getElementById('ca-permissions-wrap');
  if (wrap) wrap.style.display = role === 'superadmin' ? 'none' : '';
}
async function submitCreateAdmin() {
  if (!isCurrentSuperAdmin()) return;
  if (_createAdminSaving) return;
  var u = document.getElementById('ca-username').value.trim();
  var p = document.getElementById('ca-password').value;
  var r = document.getElementById('ca-role').value;
  var perms = r === 'superadmin' ? {} : getCheckedAdminPermissions('ca-perm-');
  var err = document.getElementById('ca-err');
  var btn = document.getElementById('ca-submit-btn');
  err.style.display = 'none';
  if (!u) { err.textContent = 'Username is required.'; err.style.display = ''; return; }
  if (p.length < 4) { err.textContent = 'Password must be at least 4 characters.'; err.style.display = ''; return; }
  _createAdminSaving = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }
  try {
    await neonSQL("ALTER TABLE admins ADD COLUMN IF NOT EXISTS permissions TEXT DEFAULT '{}'");
    await neonSQL(
      "INSERT INTO admins (username, password, role, permissions) VALUES ($1,$2,$3,$4)",
      [u, p, r, JSON.stringify(perms)]
    );
    logAdminAction('create_admin', u + ' ('+r+')').catch(function(){});
    _createAdminSaving = false;
    closeCreateAdminModal();
    showToast('', 'Admin Created', u + ' can now log in.');
    loadSuperAdminData();
  } catch(e) {
    err.textContent = (e&&e.message&&e.message.includes('unique')) ? 'Username already exists.' : 'Error: ' + (e&&e.message);
    err.style.display = '';
  } finally {
    _createAdminSaving = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Create Admin'; }
  }
}
function openAdminAccessModal(id, username) {
  if (!isCurrentSuperAdmin()) return;
  var admin = _saAdmins.find(function(a){ return Number(a.id) === Number(id); });
  if (!admin || admin.role === 'superadmin') return;
  setSuperAdminUploadLock(true);
  setAdminAccessControlModalOpen(true);
  _adminAccessSaving = false;
  document.getElementById('aa-id').value = id;
  document.getElementById('aa-username').value = username || admin.username || '';
  var sub = document.getElementById('aa-sub');
  if (sub) sub.textContent = 'Choose what ' + (username || admin.username || 'this admin') + ' can edit. Everything else remains view only.';
  var list = document.getElementById('aa-permissions-list');
  if (list) list.innerHTML = renderPermissionChecks('aa-perm-', parseAdminPermissions(admin.permissions));
  var err = document.getElementById('aa-err');
  if (err) err.style.display = 'none';
  var btn = document.getElementById('aa-save-btn');
  if (btn) { btn.disabled = false; btn.textContent = 'Save Access'; }
  try { document.body.classList.add('modal-lock'); } catch(e) {}
  document.getElementById('adminAccessModal').classList.add('show');
  try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch(e) {}
}
function closeAdminAccessModal() {
  if (_adminAccessSaving) return;
  var modal = document.getElementById('adminAccessModal');
  if (modal) modal.classList.remove('show');
  setAdminAccessControlModalOpen(false);
  try { document.body.classList.remove('modal-lock'); } catch(e) {}
  if (currentAdminTab !== 'superadmin') setSuperAdminUploadLock(false);
}
async function saveAdminAccess() {
  if (!isCurrentSuperAdmin()) return;
  if (_adminAccessSaving) return;
  var id = document.getElementById('aa-id').value;
  var username = document.getElementById('aa-username').value || 'admin';
  var err = document.getElementById('aa-err');
  var btn = document.getElementById('aa-save-btn');
  var perms = getCheckedAdminPermissions('aa-perm-');
  if (err) err.style.display = 'none';
  if (!id) {
    if (err) { err.textContent = 'Admin account was not selected. Close and open Access again.'; err.style.display = ''; }
    return;
  }
  _adminAccessSaving = true;
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    await neonSQL("ALTER TABLE admins ADD COLUMN IF NOT EXISTS permissions TEXT DEFAULT '{}'");
    await neonSQL("UPDATE admins SET permissions=$1 WHERE id=$2 AND role <> 'superadmin'", [JSON.stringify(perms), id]);
    _saAdmins = (_saAdmins || []).map(function(a) {
      if (Number(a.id) === Number(id)) return Object.assign({}, a, { permissions: JSON.stringify(perms) });
      return a;
    });
    logAdminAction('update_admin_access', username + ' - ' + adminPermissionSummary(perms, 'admin')).catch(function(){});
    _adminAccessSaving = false;
    closeAdminAccessModal();
    showToast('', 'Access Updated', username + ' permissions saved.');
    loadSuperAdminData();
  } catch(e) {
    if (err) { err.textContent = 'Could not save access: ' + (e && e.message ? e.message : e); err.style.display = ''; }
  } finally {
    _adminAccessSaving = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Save Access'; }
  }
}
async function toggleAdminActive(id, active, username) {
  try {
    await neonSQL("UPDATE admins SET active=$1 WHERE id=$2", [active, id]);
    logAdminAction(active ? 'enable_admin' : 'disable_admin', username).catch(function(){});
    showToast(active ? '' : '', active ? 'Admin Enabled' : 'Admin Disabled', username + (active ? ' can now log in.' : ' has been blocked.'));
    loadSuperAdminData();
  } catch(e) {
    showToast('', 'Error', 'Could not update admin: ' + (e&&e.message));
  }
}

// -- Activity Logging -------------------------------------------------------
async function logAdminAction(action, details) {
  try {
    await neonSQL(
      "INSERT INTO admin_logs (admin_username, action, details) VALUES ($1,$2,$3)",
      [currentAdminUsername || 'unknown', action, details || '']
    );
  } catch(e) { /* silently fail - never block main operations */ }
}

// -- Show/hide super-admin-only UI -----------------------------------------
function _applySuperAdminVisibility() {
  var isSA = isCurrentSuperAdmin();
  var btn = document.getElementById('atab-superadmin-btn');
  if (btn) btn.style.display = isSA ? '' : 'none';
  var settingsBtn = document.getElementById('atab-settings');
  if (settingsBtn) settingsBtn.style.display = isSA ? '' : 'none';
  var clearVenueBtn = document.getElementById('clearAllVenuesBtn');
  if (clearVenueBtn) clearVenueBtn.style.display = isSA ? '' : 'none';
  _applyAdminPermissionUi();
  if (!isSA && (currentAdminTab === 'settings' || currentAdminTab === 'superadmin')) switchAdminTab('venues');
}

function _applyAdminPermissionUi() {
  if (!adminLoggedIn) return;
  [
    {cls:'perm-claims-edit', key:'claims'},
    {cls:'perm-venues-edit', key:'venues'},
    {cls:'perm-photos-edit', key:'photos'},
    {cls:'perm-ads-edit', key:'ads'},
    {cls:'perm-members-edit', key:'members'},
    {cls:'perm-points-edit', key:'points'},
    {cls:'perm-reports-edit', key:'reports'},
    {cls:'perm-errors-edit', key:'errors'}
  ].forEach(function(item) {
    var allowed = hasAdminPerm(item.key);
    document.querySelectorAll('.' + item.cls).forEach(function(el) {
      el.style.display = allowed ? '' : 'none';
    });
  });
  var reportTitle = document.getElementById('monthlyReportTitle');
  if (reportTitle) reportTitle.disabled = !hasAdminPerm('reports');
}

function adminLogout() {
  adminLoggedIn = false;
  currentAdminUsername = '';
  currentAdminRole = 'admin';
  currentAdminPermissions = {};
  // Clear all session stores
  try { localStorage.removeItem('ots_admin_session'); } catch(e){}
  try { sessionStorage.removeItem('ots_admin_session'); } catch(e){}
  try { document.cookie = 'ots_admin_s=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'; } catch(e){}
  try { var wn={}; try{wn=JSON.parse(window.name||'{}')}catch(_){} delete wn['ots.ots_admin_s']; window.name=JSON.stringify(wn); } catch(e){}
  // Remove pre-render attribute so login page shows on next load
  document.documentElement.removeAttribute('data-admin-active');
  stopAdminPolling();
  document.getElementById('logoutBtn').classList.remove('show');
  var _ab3 = document.getElementById('adminPanelBtn'); if (_ab3) _ab3.style.display = 'none';
  // Show the correct login page so admin must re-authenticate to re-enter
  ['home','venues','form','admin','myrequests'].forEach(function(p){
    var el=document.getElementById('page-'+p); if(el) el.classList.remove('active');
  });
  if (otsIsAdminApp()) {
    var lp = document.getElementById('loginPage');
    if (lp) lp.classList.add('show');
  } else {
    document.getElementById('memberLoginPage').classList.remove('hidden');
  }
  showToast('', 'Logged Out', 'Admin session ended.');
}


// ==============================
// MEMBER LOGIN
// ==============================
var memberLoggedIn   = false;
var memberPhone      = '';
var memberEmail      = '';
var memberName       = '';
var memberAvatarUrl  = '';
var memberBio         = '';
var memberRoleType    = '';
var memberInstrument  = '';
var memberInstagram   = '';
var memberBloodGroup = '';
var memberDob        = '';
var memberAddress    = '';
var memberZoneCurrent = '';
var memberZoneRequest = '';
var memberZoneRequestReason = '';
var memberZoneRequestStatus = '';
var memberIdProofUrl = '';
var _mlOtp         = '';
var _mlOtpExpiry   = 0;
var _mlOtpTimer    = null;
var _mlOtpMember   = null;
var _mlOtpEmail    = '';
var _mlOtpBackendMode = false;
var _mlOtpSessionId = '';
var _mlVerifyInFlight = false;
var _mlVerifyTapLock = false;
var _mlOtpAutoVerifyTimer = null;
var _pendingVenueAfterLogin = null;
var ML_KEY = 'ots_member_v2';

// ==============================
// MEMBER TO MEMBER CHAT
// ==============================
var chatMembers = [];
var chatThreads = [];
var chatUnreadCounts = {};
var activeChatMember = null;
var activeChatId = '';
var _chatPollTimer = null;
var _chatBadgeTimer = null;
var _chatLoading = false;

function chatMyPhone() {
  return _normPhone(memberPhone || '');
}

function chatMemberPhone(member) {
  return _normPhone(member && member.phone || '');
}

function chatMemberLabel(member) {
  return String((member && (member.name || member.email || member.phone)) || 'Member').trim() || 'Member';
}

function chatInitial(name) {
  return (String(name || 'M').trim().charAt(0) || 'M').toUpperCase();
}

function chatIdForPhones(a, b) {
  var one = _normPhone(a || '');
  var two = _normPhone(b || '');
  return [one, two].sort().join('_');
}

function chatThreadForPhone(phone) {
  phone = _normPhone(phone || '');
  return (chatThreads || []).find(function(t) {
    return _normPhone(t.member_a_phone || t.memberAPhone) === phone || _normPhone(t.member_b_phone || t.memberBPhone) === phone;
  }) || null;
}

function chatTimeLabel(value) {
  if (!value) return '';
  var d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'numeric', minute:'2-digit' });
}

function chatCanUse() {
  return !!(memberLoggedIn && chatMyPhone());
}

function activeChatPage() {
  var page = document.getElementById('page-chat');
  return !!(page && page.classList.contains('active'));
}

async function showChatPage() {
  if (!chatCanUse()) {
    showToast('', 'Member Login Needed', 'Please login as a member to use chat.');
    showPage('home');
    return;
  }
  await refreshChatPage(false);
  startChatPolling();
}

async function refreshChatPage(showDone) {
  if (!chatCanUse()) return;
  if (_chatLoading) return;
  _chatLoading = true;
  try {
    await loadChatMembersAndThreads();
    renderChatMembers();
    if (activeChatMember) {
      await loadChatMessages(true);
    } else {
      renderChatThreadEmpty();
    }
    updateChatUnreadBadge(false);
    if (showDone) showToast('', 'Chat Refreshed', 'Latest messages loaded.');
  } catch(e) {
    console.warn('[OTS] chat refresh failed:', e && (e.message || e));
    var list = document.getElementById('chatMembersList');
    if (list) list.innerHTML = '<div class="chat-empty">Could not load members. Please refresh.</div>';
  } finally {
    _chatLoading = false;
  }
}

async function loadChatMembersAndThreads() {
  var myPhone = chatMyPhone();
  var memberRows = await neonSQL(
    "SELECT id,name,email,phone,avatar_url,zone_current,role_type,instrument,active FROM members WHERE active IS NOT FALSE ORDER BY name ASC LIMIT 1200"
  );
  chatMembers = (memberRows || []).map(function(m) {
    return {
      id: m.id,
      name: m.name || '',
      email: m.email || '',
      phone: m.phone || '',
      phone10: _normPhone(m.phone || ''),
      avatarUrl: m.avatar_url || '',
      zone: m.zone_current || '',
      roleType: m.role_type || '',
      instrument: m.instrument || '',
      active: m.active !== false
    };
  }).filter(function(m) {
    return m.phone10 && m.phone10 !== myPhone;
  });

  chatThreads = await neonSQL(
    "SELECT id,member_a_phone,member_b_phone,member_a_name,member_b_name,last_message,created_at,updated_at FROM member_chats WHERE member_a_phone=$1 OR member_b_phone=$1 ORDER BY updated_at DESC LIMIT 300",
    [myPhone]
  );
  var unreadRows = await neonSQL(
    "SELECT sender_phone, COUNT(*)::int AS count FROM member_chat_messages WHERE receiver_phone=$1 AND read_at IS NULL GROUP BY sender_phone",
    [myPhone]
  );
  chatUnreadCounts = {};
  (unreadRows || []).forEach(function(r) {
    chatUnreadCounts[_normPhone(r.sender_phone || '')] = Number(r.count || r.n || 0);
  });
}

function renderChatMembers() {
  var list = document.getElementById('chatMembersList');
  if (!list) return;
  var qEl = document.getElementById('chatMemberSearch');
  var q = (qEl && qEl.value || '').trim().toLowerCase();
  var sorted = (chatMembers || []).slice().sort(function(a, b) {
    var ua = chatUnreadCounts[a.phone10] || 0;
    var ub = chatUnreadCounts[b.phone10] || 0;
    if (ua !== ub) return ub - ua;
    var ta = chatThreadForPhone(a.phone10);
    var tb = chatThreadForPhone(b.phone10);
    var ad = ta ? new Date(ta.updated_at || ta.updatedAt || 0).getTime() : 0;
    var bd = tb ? new Date(tb.updated_at || tb.updatedAt || 0).getTime() : 0;
    if (ad !== bd) return bd - ad;
    return chatMemberLabel(a).localeCompare(chatMemberLabel(b));
  }).filter(function(m) {
    if (!q) return true;
    return [m.name, m.email, m.phone, m.zone, m.instrument, memberRoleLabel(m.roleType || '', m.instrument || '')].join(' ').toLowerCase().indexOf(q) > -1;
  });

  if (!sorted.length) {
    list.innerHTML = '<div class="chat-empty">No members found.</div>';
    return;
  }
  list.innerHTML = sorted.map(function(m) {
    var unread = chatUnreadCounts[m.phone10] || 0;
    var thread = chatThreadForPhone(m.phone10);
    var roleLabel = memberRoleLabel(m.roleType || '', m.instrument || '');
    var last = thread && thread.last_message ? thread.last_message : (roleLabel || m.zone || 'Tap to chat');
    var active = activeChatMember && chatMemberPhone(activeChatMember) === m.phone10;
    var avatar = m.avatarUrl ? '<img src="' + otsEscapeHtml(m.avatarUrl) + '" alt="">' : otsEscapeHtml(chatInitial(m.name || m.email));
    return '<button type="button" class="chat-member-row' + (active ? ' active' : '') + '" onclick="openMemberChat(\'' + otsJsString(m.phone10) + '\')">' +
      '<div class="chat-member-avatar">' + avatar + '</div>' +
      '<div style="min-width:0;"><div class="chat-member-name">' + otsEscapeHtml(chatMemberLabel(m)) + '</div><div class="chat-member-sub">' + otsEscapeHtml(last) + '</div></div>' +
      (unread ? '<span class="chat-unread">' + unread + '</span>' : '<span></span>') +
      '</button>';
  }).join('');
}

function renderChatThreadEmpty() {
  var title = document.getElementById('chatThreadTitle');
  var sub = document.getElementById('chatThreadSub');
  var avatar = document.getElementById('chatPeerAvatar');
  var box = document.getElementById('chatMessages');
  var input = document.getElementById('chatInput');
  var send = document.getElementById('chatSendBtn');
  var block = document.getElementById('chatBlockBtn');
  var report = document.getElementById('chatReportBtn');
  if (title) title.textContent = 'Select a member';
  if (sub) sub.textContent = 'Choose someone from the member list to start chatting.';
  if (avatar) avatar.textContent = '?';
  if (box) box.innerHTML = '<div class="chat-empty">No chat selected.</div>';
  if (input) { input.value = ''; input.disabled = true; input.style.height = ''; }
  if (send) send.disabled = true;
  if (block) block.style.display = 'none';
  if (report) report.style.display = 'none';
}

async function openMemberChat(phone10) {
  if (!chatCanUse()) return;
  phone10 = _normPhone(phone10 || '');
  var member = (chatMembers || []).find(function(m) { return m.phone10 === phone10; });
  if (!member) return;
  activeChatMember = member;
  activeChatId = chatIdForPhones(chatMyPhone(), phone10);
  renderChatMembers();
  await ensureMemberChat(member);
  await loadChatMessages(true);
  await markChatRead();
  updateChatUnreadBadge(false);
}

async function ensureMemberChat(peer) {
  var myPhone = chatMyPhone();
  var peerPhone = chatMemberPhone(peer);
  var id = chatIdForPhones(myPhone, peerPhone);
  var sorted = [myPhone, peerPhone].sort();
  var aName = sorted[0] === myPhone ? (memberName || memberEmail || myPhone) : chatMemberLabel(peer);
  var bName = sorted[1] === myPhone ? (memberName || memberEmail || myPhone) : chatMemberLabel(peer);
  await neonSQL(
    "INSERT INTO member_chats (id,member_a_phone,member_b_phone,member_a_name,member_b_name,last_message,updated_at) VALUES ($1,$2,$3,$4,$5,'',NOW()) ON CONFLICT (id) DO UPDATE SET member_a_name=EXCLUDED.member_a_name, member_b_name=EXCLUDED.member_b_name",
    [id, sorted[0], sorted[1], aName, bName]
  );
  activeChatId = id;
}

async function loadChatMessages(scrollBottom) {
  var box = document.getElementById('chatMessages');
  if (!activeChatMember || !box) return;
  var peer = activeChatMember;
  var title = document.getElementById('chatThreadTitle');
  var sub = document.getElementById('chatThreadSub');
  var avatar = document.getElementById('chatPeerAvatar');
  var input = document.getElementById('chatInput');
  var send = document.getElementById('chatSendBtn');
  var block = document.getElementById('chatBlockBtn');
  var report = document.getElementById('chatReportBtn');
  if (title) title.textContent = chatMemberLabel(peer);
  if (sub) {
    var peerRole = memberRoleLabel(peer.roleType || '', peer.instrument || '');
    sub.textContent = [peerRole, peer.zone ? ('Zone: ' + peer.zone) : '', peer.phone10].filter(Boolean).join(' - ');
  }
  if (avatar) avatar.innerHTML = peer.avatarUrl ? '<img src="' + otsEscapeHtml(peer.avatarUrl) + '" alt="" style="width:100%;height:100%;object-fit:cover;">' : otsEscapeHtml(chatInitial(peer.name || peer.email));
  if (input) { input.disabled = false; input.placeholder = 'Message ' + chatMemberLabel(peer); }
  if (send) send.disabled = !(input && input.value.trim());
  if (block) block.style.display = '';
  if (report) report.style.display = '';

  var rows = await neonSQL(
    "SELECT id,chat_id,sender_phone,sender_name,receiver_phone,body,created_at,read_at FROM member_chat_messages WHERE chat_id=$1 ORDER BY created_at ASC LIMIT 250",
    [activeChatId]
  );
  if (!rows || !rows.length) {
    box.innerHTML = '<div class="chat-empty">Start the conversation.</div>';
  } else {
    var myPhone = chatMyPhone();
    box.innerHTML = rows.map(function(msg) {
      var mine = _normPhone(msg.sender_phone || '') === myPhone;
      return '<div class="chat-bubble' + (mine ? ' me' : '') + '">' +
        '<div class="chat-bubble-text">' + otsEscapeHtml(msg.body || '') + '</div>' +
        '<div class="chat-bubble-time">' + otsEscapeHtml(chatTimeLabel(msg.created_at)) + '</div>' +
        '</div>';
    }).join('');
  }
  if (scrollBottom) setTimeout(function(){ box.scrollTop = box.scrollHeight; }, 0);
}

async function markChatRead() {
  if (!activeChatId || !chatCanUse()) return;
  await neonSQL(
    "UPDATE member_chat_messages SET read_at=NOW() WHERE chat_id=$1 AND receiver_phone=$2 AND read_at IS NULL",
    [activeChatId, chatMyPhone()]
  );
  if (activeChatMember) chatUnreadCounts[chatMemberPhone(activeChatMember)] = 0;
  renderChatMembers();
}

async function chatBlocked(peerPhone) {
  var rows = await neonSQL(
    "SELECT blocker_phone FROM member_chat_blocks WHERE (blocker_phone=$1 AND blocked_phone=$2) OR (blocker_phone=$2 AND blocked_phone=$1) LIMIT 1",
    [chatMyPhone(), peerPhone]
  );
  return !!(rows && rows.length);
}

async function sendChatMessage() {
  if (!activeChatMember || !chatCanUse()) return;
  var input = document.getElementById('chatInput');
  var send = document.getElementById('chatSendBtn');
  var body = (input && input.value || '').trim();
  if (!body) return;
  var peerPhone = chatMemberPhone(activeChatMember);
  if (await chatBlocked(peerPhone)) {
    showToast('', 'Chat Blocked', 'This chat is blocked. Contact admin if this is a mistake.');
    return;
  }
  if (send) send.disabled = true;
  try {
    await ensureMemberChat(activeChatMember);
    var id = 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    await neonSQL(
      "INSERT INTO member_chat_messages (id,chat_id,sender_phone,sender_name,receiver_phone,body,created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())",
      [id, activeChatId, chatMyPhone(), memberName || memberEmail || memberPhone || 'Member', peerPhone, body]
    );
    await neonSQL("UPDATE member_chats SET last_message=$1, updated_at=NOW() WHERE id=$2", [body.slice(0, 160), activeChatId]);
    if (input) { input.value = ''; input.style.height = ''; }
    notifyMemberChatMessage(activeChatMember, body);
    await refreshChatPage(false);
  } catch(e) {
    console.warn('[OTS] chat send failed:', e && (e.message || e));
    showToast('', 'Message Not Sent', 'Please check internet and try again.');
  } finally {
    if (send) send.disabled = !(input && input.value.trim());
  }
}

function autoGrowChatInput(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  var send = document.getElementById('chatSendBtn');
  if (send) send.disabled = !el.value.trim() || !activeChatMember;
}

function handleChatInputKey(ev) {
  if (!ev) return;
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    sendChatMessage();
  }
}

async function blockActiveChatMember() {
  if (!activeChatMember || !chatCanUse()) return;
  var peerName = chatMemberLabel(activeChatMember);
  if (!confirm('Block chat with ' + peerName + '?')) return;
  try {
    await neonSQL(
      "INSERT INTO member_chat_blocks (blocker_phone,blocked_phone,created_at) VALUES ($1,$2,NOW()) ON CONFLICT (blocker_phone,blocked_phone) DO NOTHING",
      [chatMyPhone(), chatMemberPhone(activeChatMember)]
    );
    showToast('', 'Blocked', peerName + ' cannot message you now.');
  } catch(e) {
    showToast('', 'Could Not Block', 'Please try again.');
  }
}

async function reportActiveChatMember() {
  if (!activeChatMember || !chatCanUse()) return;
  try {
    var payload = createClientErrorPayload('chat_report', 'Member chat report: ' + chatMemberLabel(activeChatMember), '', { severity:'info' });
    payload.message = sanitizeErrorText('Reported chat with ' + chatMemberLabel(activeChatMember) + ' (' + chatMemberPhone(activeChatMember) + ') by ' + (memberName || memberPhone || memberEmail));
    await sendClientErrorReport(payload);
    showToast('', 'Report Sent', 'Admin can review this chat report.');
  } catch(e) {
    showToast('', 'Could Not Report', 'Please contact admin/helpdesk.');
  }
}

function startChatPolling() {
  stopChatPolling();
  _chatPollTimer = setInterval(function() {
    if (!document.hidden && activeChatPage()) refreshChatPage(false);
  }, 6000);
}

function stopChatPolling() {
  if (_chatPollTimer) clearInterval(_chatPollTimer);
  _chatPollTimer = null;
}

async function updateChatUnreadBadge(force) {
  var dot = document.getElementById('mn-chat-dot');
  if (!dot) return;
  if (!chatCanUse()) {
    dot.style.display = 'none';
    return;
  }
  try {
    if (force) {
      var rows = await neonSQL(
        "SELECT COUNT(*)::int AS count FROM member_chat_messages WHERE receiver_phone=$1 AND read_at IS NULL",
        [chatMyPhone()]
      );
      var n = rows && rows[0] ? Number(rows[0].count || rows[0].n || 0) : 0;
      dot.style.display = n > 0 ? '' : 'none';
      return;
    }
    var total = Object.keys(chatUnreadCounts).reduce(function(sum, key) { return sum + Number(chatUnreadCounts[key] || 0); }, 0);
    dot.style.display = total > 0 ? '' : 'none';
  } catch(e) {
    dot.style.display = 'none';
  }
}

function startChatBadgePolling() {
  if (_chatBadgeTimer) return;
  _chatBadgeTimer = setInterval(function() {
    if (!document.hidden) updateChatUnreadBadge(true);
  }, 25000);
}

function notifyMemberChatMessage(peer, message) {
  if (!peer || !pushBackendEnabled()) return;
  notifyMemberUpdate({
    updateType: 'chat_message',
    status: 'new',
    phone: peer.phone || peer.phone10 || '',
    email: peer.email || '',
    senderPhone: memberPhone || chatMyPhone(),
    chatPeerPhone: memberPhone || chatMyPhone(),
    memberName: memberName || memberEmail || memberPhone || 'Member',
    reason: String(message || '').slice(0, 120)
  });
}

function restoreMemberSession() {
  try {
    var s = JSON.parse(localStorage.getItem(ML_KEY) || 'null');
    if (s && (s.phone || s.email)) {
      memberLoggedIn = true;
      memberPhone = s.phone || '';
      memberEmail = (typeof s.email !== 'undefined') ? s.email : '';
      memberName  = s.name || '';
      memberAddress = s.address || '';
      memberZoneCurrent = s.zone_current || '';
      // Restore the rest of the profile so completion bar / avatar / bio etc.
      // don't show as blank on every page refresh.
      memberAvatarUrl = s.avatar_url || '';
      memberBio = s.bio || '';
      memberRoleType = s.role_type || '';
      memberInstrument = s.instrument || '';
      memberInstagram = s.instagram || '';
      memberBloodGroup = s.blood_group || '';
      memberDob = s.dob || '';
      memberIdProofUrl = s.id_proof_url || '';
      memberZoneRequest = s.zone_request || '';
      memberZoneRequestReason = s.zone_request_reason || '';
      memberZoneRequestStatus = s.zone_request_status || '';
      // Auto-renew: reset expiry to 1 year from now on every visit
      s.exp = Date.now() + 365*24*60*60*1000;
      localStorage.setItem(ML_KEY, JSON.stringify(s));
      updateMemberNavUI();
      _fetchAndApplyMemberAvatar();
      _loadNotifData();
      updateNotifBadge();
      startChatBadgePolling();
      requestNativePushToken();
      saveMemberPushToken().catch(function(e){ console.warn('[OTS] push token save skipped:', e && (e.message || e)); });
      consumePendingNativeNotificationTap();
    }
  } catch(e) {}
}

// Fill in whichever of phone/email is missing from the session by querying the members table.
// This fixes sessions saved before the dual-field fix (e.g. email-login had memberPhone='').
async function enrichMemberSession() {
  if (!memberLoggedIn) return;
  var needsPhone = !memberPhone && memberEmail;
  var needsEmail = !memberEmail && memberPhone;
  if (!needsPhone && !needsEmail) {
    saveMemberPushToken().catch(function(e){ console.warn('[OTS] push token refresh skipped:', e && (e.message || e)); });
    return;
  }
  try {
    var row = null;
    if (needsPhone) {
      var rows = await neonSQL(
        'SELECT phone FROM members WHERE LOWER(email) = $1 AND active = true LIMIT 1',
        [memberEmail.trim().toLowerCase()]
      );
      if (rows.length) row = rows[0];
      if (row && row.phone) { memberPhone = row.phone; saveMemberSession(); }
    } else {
      var rows = await neonSQL(
        'SELECT email FROM members WHERE RIGHT(REGEXP_REPLACE(phone,\'[^0-9]\',\'\',\'g\'),10) = $1 AND active = true LIMIT 1',
        [_normPhone(memberPhone)]
      );
      if (rows.length) row = rows[0];
      if (row && row.email) { memberEmail = row.email; saveMemberSession(); }
    }
    saveMemberPushToken().catch(function(e){ console.warn('[OTS] push token refresh skipped:', e && (e.message || e)); });
  } catch(e) { console.warn('[OTS] enrichMemberSession failed:', e); }
}

function saveMemberSession() {
  // Persist EVERY profile field so the profile page, completion bar, avatar,
  // bio, etc. don't reset to blank/0% on every page refresh.
  localStorage.setItem(ML_KEY, JSON.stringify({
    phone: memberPhone,
    email: memberEmail,
    name: memberName,
    address: memberAddress,
    zone_current: memberZoneCurrent,
    avatar_url: memberAvatarUrl,
    bio: memberBio,
    role_type: memberRoleType,
    instrument: memberInstrument,
    instagram: memberInstagram,
    blood_group: memberBloodGroup,
    dob: memberDob,
    id_proof_url: memberIdProofUrl,
    zone_request: memberZoneRequest,
    zone_request_reason: memberZoneRequestReason,
    zone_request_status: memberZoneRequestStatus,
    exp: Date.now() + 365*24*60*60*1000
  }));
}

// -- Photo viewer (WhatsApp-style) --------------------------------------------
async function openPhotoViewerForMember(name, phone, shows, roleLabel) {
  // Open immediately with initials, then fetch avatar lazily
  openPhotoViewer(name, '', shows, roleLabel || '');
  if (!phone) return;
  try {
    var rows = await neonSQL("SELECT avatar_url,role_type,instrument FROM members WHERE RIGHT(REGEXP_REPLACE(phone,'[^0-9]','','g'),10)=$1 LIMIT 1", [_normPhone(phone)]);
    var url = rows && rows[0] && rows[0].avatar_url ? rows[0].avatar_url : '';
    var liveRole = rows && rows[0] ? memberRoleLabel(rows[0].role_type || '', rows[0].instrument || '') : '';
    if (url) {
      var img = document.getElementById('pvImg');
      var ini = document.getElementById('pvInitial');
      if (img) { img.src = url; img.style.display = ''; }
      if (ini) ini.style.display = 'none';
    }
    var roleEl = document.getElementById('pvRole');
    if (roleEl && liveRole) roleEl.textContent = liveRole;
  } catch(e) {} // silent - viewer already shows initials as fallback
}

function openPhotoViewer(name, avatarUrl, shows, roleLabel) {
  var ov = document.getElementById('photoViewerOverlay');
  var img = document.getElementById('pvImg');
  var ini = document.getElementById('pvInitial');
  var nm  = document.getElementById('pvName');
  var role = document.getElementById('pvRole');
  var sh  = document.getElementById('pvShows');
  if (!ov) return;
  if (avatarUrl) {
    img.src = avatarUrl; img.style.display = ''; ini.style.display = 'none';
  } else {
    img.src = ''; img.style.display = 'none';
    ini.textContent = (name || '?').charAt(0).toUpperCase();
    ini.style.display = '';
  }
  nm.textContent  = name || '';
  if (role) role.textContent = roleLabel || '';
  sh.textContent  = shows != null ? shows + ' show' + (shows !== 1 ? 's' : '') + ' performed' : '';
  ov.style.display = 'flex';
  requestAnimationFrame(function(){ ov.classList.add('pv-open'); });
}

function closePhotoViewer() {
  var ov = document.getElementById('photoViewerOverlay');
  if (!ov) return;
  ov.classList.remove('pv-open');
  setTimeout(function(){ ov.style.display = 'none'; }, 260);
}

// -- My Requests profile header ------------------------------------------------
function _applyMyProfileHeader(avatarUrl) {
  var img = document.getElementById('myProfileAvatarImg');
  var ini = document.getElementById('myProfileAvatarInitial');
  var nm  = document.getElementById('myProfileName');
  if (nm)  nm.textContent = memberName || memberEmail || memberPhone || '';
  if (!img || !ini) return;
  if (avatarUrl) {
    img.src = avatarUrl; img.style.display = ''; ini.style.display = 'none';
  } else {
    img.src = ''; img.style.display = 'none';
    ini.textContent = (memberName || '?').charAt(0).toUpperCase();
    ini.style.display = '';
  }
  // Mini completion bar
  var pct = calcProfileCompletion();
  _renderMiniCompletionBar(pct);
  // Also refresh the profile page large avatar if visible
  _applyProfAvatarLg(avatarUrl);
}

// == Profile Settings ==
function _profileCompletionFields() {
  var fields = [
    (memberName || '').trim(),
    (memberEmail || '').trim(),
    (memberAddress || '').trim(),
    (memberZoneCurrent || '').trim(),
    (memberBio || '').trim(),
    (memberRoleType || '').trim(),
    (memberBloodGroup || '').trim(),
    (memberDob || '').trim(),
    (memberAvatarUrl || '').trim(),
    (memberIdProofUrl || '').trim()
  ];
  if (roleNeedsInstrument(memberRoleType)) fields.push((memberInstrument || '').trim());
  return fields;
}

function calcProfileCompletion() {
  var fields = _profileCompletionFields();
  var filled = fields.filter(function(f) { return f && f.trim(); }).length;
  return Math.round((filled / fields.length) * 100);
}

function _renderCompletionBar(pct) {
  var fill  = document.getElementById('profCompFill');
  var pctEl = document.getElementById('profCompPct');
  var hint  = document.getElementById('profCompHint');
  if (fill)  fill.style.width  = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';
  if (pctEl) pctEl.style.color = pct === 100 ? 'var(--green)' : pct >= 70 ? 'var(--blue)' : 'var(--orange)';
  if (hint) {
    if (pct === 100) {
      hint.textContent = ' Profile complete!';
      hint.style.color = 'var(--green)';
    } else {
      var total = _profileCompletionFields().length;
      var filled = Math.round(pct / (100 / total));
      var rem = Math.max(0, total - filled);
      hint.textContent = rem + ' field' + (rem === 1 ? '' : 's') + ' remaining';
      hint.style.color = 'var(--muted)';
    }
  }
}

function _normalizeBirthDayMonth(value) {
  var v = String(value || '').trim();
  if (!v) return '';
  var m;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return v.slice(8, 10) + '-' + v.slice(5, 7);
  }
  m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
  if (!m) return null;
  var d = parseInt(m[1], 10);
  var mo = parseInt(m[2], 10);
  if (!d || !mo || d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return String(d).padStart(2, '0') + '-' + String(mo).padStart(2, '0');
}

function _updateZoneReasonVisibility() {
  var wrap = document.getElementById('pf-zone-reason-wrap');
  var zoneEl = document.getElementById('pf-zone');
  var reasonEl = document.getElementById('pf-zone-reason');
  var note = document.getElementById('pf-zone-note');
  var selected = zoneEl ? (zoneEl.value || '').trim() : '';
  var needsReason = !!(memberZoneCurrent && selected && selected !== memberZoneCurrent);
  if (wrap) wrap.style.display = needsReason ? '' : 'none';
  if (!needsReason && reasonEl && (!memberZoneRequestStatus || memberZoneRequestStatus !== 'pending')) reasonEl.value = '';
  if (note) {
    if (memberZoneCurrent) {
      note.textContent = 'Current zone: ' + memberZoneCurrent
        + (!isActiveZoneName(memberZoneCurrent) ? ' (old zone name - choose from the current list)' : '')
        + (memberZoneRequestStatus === 'pending' && memberZoneRequest ? ' - Pending request: ' + memberZoneRequest : '');
    } else {
      note.textContent = 'Choose your zone. Future zone changes need admin approval.';
    }
  }
}

function _renderMiniCompletionBar(pct) {
  var el = document.getElementById('profCompMiniWrap');
  if (!el) return;
  var color = pct === 100 ? 'var(--green)' : pct >= 70 ? 'var(--blue)' : 'var(--orange)';
  el.innerHTML =
    '<div class="prof-comp-mini">' +
      '<div class="prof-comp-mini-track"><div class="prof-comp-mini-fill" style="width:' + pct + '%;"></div></div>' +
      '<span class="prof-comp-mini-pct" style="color:' + color + ';">' + pct + '%</span>' +
      '<button class="prof-edit-link" onclick="showPage(\'profile\')" title="Edit Profile">Edit ></button>' +
    '</div>';
}

function _updateBioCount() {
  var bioEl = document.getElementById('pf-bio');
  var cntEl = document.getElementById('pf-bio-count');
  if (bioEl && cntEl) cntEl.textContent = bioEl.value.length;
}

function updateProfileRoleFields() {
  var roleEl = document.getElementById('pf-role');
  var wrap = document.getElementById('pf-instrument-wrap');
  var instEl = document.getElementById('pf-instrument');
  var role = roleEl ? roleEl.value : '';
  var showInstrument = roleNeedsInstrument(role) || (!role && instEl && instEl.value);
  if (wrap) wrap.style.display = showInstrument ? '' : 'none';
  if (instEl) {
    instEl.placeholder = role === 'singer_instrumentalist'
      ? 'Which instrument do you play?'
      : 'e.g. Acoustic Guitar, Keyboard, Cajon...';
    if (!showInstrument && (role === 'singer' || role === 'volunteer')) instEl.value = '';
  }
}

async function showProfilePage() {
  if (!memberLoggedIn || !memberPhone) return;
  var normP = _normPhone(memberPhone);
  // Populate form with current globals immediately
  var nameEl  = document.getElementById('pf-name');
  var emailEl = document.getElementById('pf-email');
  var phoneEl = document.getElementById('pf-phone');
  var bioEl   = document.getElementById('pf-bio');
  var roleEl  = document.getElementById('pf-role');
  var instrEl = document.getElementById('pf-instrument');
  var igEl    = document.getElementById('pf-instagram');
  var bgEl    = document.getElementById('pf-blood-group');
  var dobEl   = document.getElementById('pf-dob');
  var addrEl  = document.getElementById('pf-address');
  var zoneEl  = document.getElementById('pf-zone');
  var zoneReasonEl = document.getElementById('pf-zone-reason');
  var zoneNoteEl = document.getElementById('pf-zone-note');
  refreshZoneSelects();
  if (nameEl)  nameEl.value  = memberName       || '';
  if (emailEl) emailEl.value = memberEmail      || '';
  if (phoneEl) phoneEl.value = memberPhone      || '';
  if (bioEl)   { bioEl.value = memberBio        || ''; _updateBioCount(); }
  if (roleEl)  roleEl.value  = memberRoleType   || '';
  if (instrEl) instrEl.value = memberInstrument || '';
  updateProfileRoleFields();
  if (igEl)    igEl.value    = memberInstagram  || '';
  if (bgEl)    bgEl.value    = memberBloodGroup || '';
  if (dobEl)   dobEl.value   = _normalizeBirthDayMonth(memberDob) || '';
  if (addrEl)  addrEl.value  = memberAddress    || '';
  if (zoneEl)  zoneEl.value  = isActiveZoneName(memberZoneCurrent || memberZoneRequest || '') ? (memberZoneCurrent || memberZoneRequest || '') : '';
  if (zoneReasonEl) zoneReasonEl.value = memberZoneRequestReason || '';
  if (zoneNoteEl) zoneNoteEl.textContent = memberZoneCurrent
    ? ('Current zone: ' + memberZoneCurrent + (!isActiveZoneName(memberZoneCurrent) ? ' (old zone name - choose from the current list)' : '') + (memberZoneRequestStatus==='pending' && memberZoneRequest ? ' - Pending request: ' + memberZoneRequest : ''))
    : 'Choose your zone. Future zone changes need admin approval.';
  _updateZoneReasonVisibility();
  _applyIdProofPreview(memberIdProofUrl);
  // Avatar
  _applyProfAvatarLg(memberAvatarUrl);
  // Completion bar
  _renderCompletionBar(calcProfileCompletion());
  // Fetch fresh row from DB
  try {
    var rows = await neonSQL(
      'SELECT name,email,bio,role_type,instrument,instagram,avatar_url,blood_group,date_of_birth,address,zone_current,zone_request,zone_request_reason,zone_request_status,id_proof_url FROM members WHERE RIGHT(REGEXP_REPLACE(phone,\'[^0-9]\',\'\',\'g\'),10)=$1 LIMIT 1',
      [normP]
    );
    if (rows && rows[0]) {
      var r = rows[0];
      if (r.name)       memberName       = r.name;
      if (r.email)      memberEmail      = r.email;
      memberBio        = r.bio          || '';
      memberRoleType   = r.role_type    || '';
      memberInstrument = r.instrument   || '';
      memberInstagram  = r.instagram    || '';
      memberBloodGroup = r.blood_group  || '';
      memberDob        = r.date_of_birth || '';
      memberAddress    = r.address       || localStorage.getItem('member_address') || '';
      memberZoneCurrent = r.zone_current || '';
      memberZoneRequest = r.zone_request || '';
      memberZoneRequestReason = r.zone_request_reason || '';
      memberZoneRequestStatus = r.zone_request_status || '';
      memberIdProofUrl = r.id_proof_url  || '';
      if (r.avatar_url) { memberAvatarUrl = r.avatar_url; _updateNavAvatar(memberAvatarUrl); }
      // Refill form with fresh data
      if (nameEl)  nameEl.value  = memberName       || '';
      if (emailEl) emailEl.value = memberEmail      || '';
      if (bioEl)   { bioEl.value = memberBio        || ''; _updateBioCount(); }
      if (roleEl)  roleEl.value  = memberRoleType   || '';
      if (instrEl) instrEl.value = memberInstrument || '';
      updateProfileRoleFields();
      if (igEl)    igEl.value    = memberInstagram  || '';
      if (bgEl)    bgEl.value    = memberBloodGroup || '';
      if (dobEl)   dobEl.value   = _normalizeBirthDayMonth(memberDob) || '';
      if (addrEl)  addrEl.value  = memberAddress    || '';
      refreshZoneSelects();
      if (zoneEl)  zoneEl.value  = isActiveZoneName(memberZoneCurrent || memberZoneRequest || '') ? (memberZoneCurrent || memberZoneRequest || '') : '';
      if (zoneReasonEl) zoneReasonEl.value = memberZoneRequestReason || '';
      _updateZoneReasonVisibility();
      _applyIdProofPreview(memberIdProofUrl);
      _applyProfAvatarLg(memberAvatarUrl);
      var pct = calcProfileCompletion();
      _renderCompletionBar(pct);
      _renderMiniCompletionBar(pct);
    }
  } catch(e) { console.warn('[OTS] showProfilePage fetch:', e); }
}

function _applyProfAvatarLg(url) {
  var img = document.getElementById('profAvatarLgImg');
  var ini = document.getElementById('profAvatarLgInitial');
  if (!img || !ini) return;
  if (url) {
    img.src = url; img.style.display = ''; ini.style.display = 'none';
  } else {
    img.src = ''; img.style.display = 'none';
    ini.textContent = (memberName || '?').charAt(0).toUpperCase();
    ini.style.display = '';
  }
}

function _applyIdProofPreview(url) {
  var empty   = document.getElementById('idProofEmpty');
  var preview = document.getElementById('idProofPreview');
  var thumb   = document.getElementById('idProofThumb');
  if (!empty || !preview) return;
  if (url) {
    if (thumb) thumb.src = url;
    empty.style.display   = 'none';
    preview.style.display = '';
  } else {
    empty.style.display   = '';
    preview.style.display = 'none';
  }
}

async function handleIdProofUpload(input) {
  var file = input.files && input.files[0];
  if (!file || !memberLoggedIn || !memberPhone) return;
  var statusEl = document.getElementById('idProofStatus');
  if (statusEl) { statusEl.textContent = 'Compressing...'; statusEl.style.color = 'var(--muted)'; }
  try {
    var compressed = await new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function(e) {
        var imgEl = new Image();
        imgEl.onerror = reject;
        imgEl.onload = function() {
          var canvas = document.createElement('canvas');
          var maxW = 800, maxH = 600;
          var w = imgEl.width, h = imgEl.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; }
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(imgEl, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.72));
        };
        imgEl.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
    if (statusEl) { statusEl.textContent = 'Saving...'; }
    var normP = _normPhone(memberPhone);
    await neonSQL("UPDATE members SET id_proof_url=$1 WHERE RIGHT(REGEXP_REPLACE(phone,'[^0-9]','','g'),10)=$2", [compressed, normP]);
    memberIdProofUrl = compressed;
    _applyIdProofPreview(compressed);
    var pct = calcProfileCompletion();
    _renderCompletionBar(pct);
    _renderMiniCompletionBar(pct);
    if (statusEl) { statusEl.textContent = ' ID proof uploaded!'; statusEl.style.color = 'var(--green)'; }
    setTimeout(function(){ if (statusEl) statusEl.textContent = ''; }, 3000);
  } catch(e) {
    var msg = (e && e.message && e.message.toLowerCase().includes('transfer'))
      ? 'Database limit reached - try again later'
      : 'Upload failed - try again';
    if (statusEl) { statusEl.textContent = ' ' + msg; statusEl.style.color = 'var(--orange)'; }
    console.warn('[OTS] idProof upload:', e);
  }
  input.value = '';
}

async function saveProfile() {
  if (!memberLoggedIn || !memberPhone) return;
  var btn      = document.getElementById('profSaveBtn');
  var statusEl = document.getElementById('profSaveStatus');
  var nameVal  = ((document.getElementById('pf-name')       || {}).value || '').trim();
  var emailVal = ((document.getElementById('pf-email')      || {}).value || '').trim();
  var bioVal   = ((document.getElementById('pf-bio')        || {}).value || '').trim();
  var roleVal  = ((document.getElementById('pf-role')       || {}).value || '').trim();
  var instrVal = ((document.getElementById('pf-instrument') || {}).value || '').trim();
  var igVal    = ((document.getElementById('pf-instagram')  || {}).value || '').trim();
  var bgVal    = ((document.getElementById('pf-blood-group')|| {}).value || '').trim();
  var dobRaw   = ((document.getElementById('pf-dob')        || {}).value || '').trim();
  var dobVal   = _normalizeBirthDayMonth(dobRaw);
  var addrVal  = ((document.getElementById('pf-address')    || {}).value || '').trim();
  var zoneVal  = ((document.getElementById('pf-zone')       || {}).value || '').trim();
  var zoneReasonVal = ((document.getElementById('pf-zone-reason') || {}).value || '').trim();

  if (!nameVal) {
    if (statusEl) { statusEl.textContent = ' Name is required.'; statusEl.style.color = 'var(--orange)'; }
    return;
  }
  if (dobRaw && dobVal === null) {
    if (statusEl) { statusEl.textContent = ' Enter birth date as DD-MM.'; statusEl.style.color = 'var(--orange)'; }
    return;
  }
  if (roleNeedsInstrument(roleVal) && !instrVal) {
    if (statusEl) { statusEl.textContent = ' Please enter your instrument.'; statusEl.style.color = 'var(--orange)'; }
    return;
  }
  if (roleVal === 'singer' || roleVal === 'volunteer') instrVal = '';
  if (memberZoneCurrent && zoneVal && zoneVal !== memberZoneCurrent && !zoneReasonVal) {
    if (statusEl) { statusEl.textContent = ' Please add a reason for changing zone.'; statusEl.style.color = 'var(--orange)'; }
    return;
  }
  if (zoneVal && !isActiveZoneName(zoneVal)) {
    if (statusEl) { statusEl.textContent = ' Please choose a zone from the current list.'; statusEl.style.color = 'var(--orange)'; }
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  if (statusEl) statusEl.textContent = '';
  try {
    var normP = _normPhone(memberPhone);
    var nextZoneCurrent = memberZoneCurrent || '';
    var nextZoneRequest = memberZoneRequest || '';
    var nextZoneStatus = memberZoneRequestStatus || '';
    var nextZoneReason = memberZoneRequestReason || '';
    var zoneMsg = '';
    var shouldNotifyZoneApproval = false;

    if (zoneVal) {
      if (!memberZoneCurrent) {
        nextZoneCurrent = zoneVal;
        nextZoneRequest = '';
        nextZoneReason = '';
        nextZoneStatus = '';
        zoneMsg = ' Zone saved.';
      } else if (zoneVal !== memberZoneCurrent) {
        var alreadyPendingSameZone = memberZoneRequestStatus === 'pending' && memberZoneRequest === zoneVal && memberZoneRequestReason === zoneReasonVal;
        nextZoneRequest = zoneVal;
        nextZoneReason = zoneReasonVal || '';
        nextZoneStatus = 'pending';
        zoneMsg = ' Zone change request sent to admin.';
        shouldNotifyZoneApproval = !alreadyPendingSameZone;
      }
    }

    await neonSQL(
      'UPDATE members SET name=$1, email=$2, bio=$3, role_type=$4, instrument=$5, instagram=$6, blood_group=$7, date_of_birth=$8, address=$9, zone_current=$10, zone_request=$11, zone_request_reason=$12, zone_request_status=$13 WHERE RIGHT(REGEXP_REPLACE(phone,\'[^0-9]\',\'\',\'g\'),10)=$14',
      [nameVal, emailVal || null, bioVal || null, roleVal || null, instrVal || null, igVal || null, bgVal || null, dobVal || null, addrVal || null, nextZoneCurrent || null, nextZoneRequest || null, nextZoneReason || null, nextZoneStatus || null, normP]
    );

    memberName       = nameVal;
    if (emailVal) memberEmail = emailVal;
    memberBio        = bioVal;
    memberRoleType   = roleVal;
    memberInstrument = instrVal;
    memberInstagram  = igVal;
    memberBloodGroup = bgVal;
    memberDob        = dobVal;
    memberAddress    = addrVal;
    memberZoneCurrent = nextZoneCurrent || '';
    memberZoneRequest = nextZoneRequest || '';
    memberZoneRequestReason = nextZoneReason || '';
    memberZoneRequestStatus = nextZoneStatus || '';
    saveMemberSession();

    var pct = calcProfileCompletion();
    _renderCompletionBar(pct);
    _renderMiniCompletionBar(pct);
    _applyMyProfileHeader(memberAvatarUrl);
    var navNm = document.getElementById('navMemberName');
    if (navNm) navNm.textContent = memberName.split(' ')[0];
    var note = document.getElementById('pf-zone-note');
    if (note) note.textContent = memberZoneCurrent
      ? ('Current zone: ' + memberZoneCurrent + (!isActiveZoneName(memberZoneCurrent) ? ' (old zone name - choose from the current list)' : '') + (memberZoneRequestStatus==='pending' && memberZoneRequest ? ' - Pending request: ' + memberZoneRequest : ''))
      : (memberZoneRequest ? ('Pending request: ' + memberZoneRequest) : 'Choose your zone. Future zone changes need admin approval.');
    _updateZoneReasonVisibility();
    if (shouldNotifyZoneApproval) {
      notifyAdminZoneApproval({
        name: nameVal,
        phone: memberPhone,
        email: emailVal || memberEmail,
        currentZone: memberZoneCurrent,
        zoneRequest: memberZoneRequest,
        zone: memberZoneRequest,
        reason: memberZoneRequestReason
      });
    }
    if (statusEl) { statusEl.textContent = ' Saved!' + zoneMsg; statusEl.style.color = 'var(--green)'; }
    setTimeout(function() { if (statusEl) statusEl.textContent = ''; }, 3500);
  } catch(e) {
    console.error('[OTS] saveProfile:', e);
    if (statusEl) { statusEl.textContent = ' Could not save. Try again.'; statusEl.style.color = 'var(--orange)'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Profile'; }
  }
}

function _fetchAndApplyMemberAvatar() {
  if (!memberLoggedIn || !memberPhone) return;
  var normP = _normPhone(memberPhone);
  neonSQL("SELECT avatar_url,bio,role_type,instrument,instagram,blood_group,date_of_birth,address,zone_current,zone_request,zone_request_reason,zone_request_status,id_proof_url FROM members WHERE RIGHT(REGEXP_REPLACE(phone,'[^0-9]','','g'),10)=$1 LIMIT 1", [normP]).then(function(rows) {
    if (!rows || !rows[0]) return;
    var r = rows[0];
    var url = r.avatar_url || '';
    memberBio        = r.bio           || '';
    memberRoleType   = r.role_type     || '';
    memberInstrument = r.instrument    || '';
    memberInstagram  = r.instagram     || '';
    memberBloodGroup = r.blood_group   || '';
    memberDob        = r.date_of_birth || '';
    memberAddress    = r.address       || localStorage.getItem('member_address') || '';
    memberZoneCurrent = r.zone_current || '';
    memberZoneRequest = r.zone_request || '';
    memberZoneRequestReason = r.zone_request_reason || '';
    memberZoneRequestStatus = r.zone_request_status || '';
    memberIdProofUrl = r.id_proof_url  || '';
    _updateNavAvatar(url);
    _applyAvatarDisplay(url);
    _applyMyProfileHeader(url);
  }).catch(function(){});
}

function _updateNavAvatar(url) {
  memberAvatarUrl = url || '';
  var img     = document.getElementById('navAvatarImg');
  var initial = document.getElementById('navAvatarInitial');
  if (!img || !initial) return;
  var letter = (memberName || memberEmail || memberPhone || '?').charAt(0).toUpperCase();
  if (url) {
    img.src = url;
    img.style.display = '';
    initial.style.display = 'none';
  } else {
    img.src = '';
    img.style.display = 'none';
    initial.textContent = letter;
    initial.style.display = '';
  }
  var nameEl = document.getElementById('navMemberName');
  if (nameEl) nameEl.textContent = memberName || memberEmail || memberPhone || '';
}

function updateMemberNavUI() {
  var gr = document.getElementById('memberGreeting');
  var nb = document.getElementById('memberLoginNavBtn');
  var mb = document.getElementById('myBookingsBtn');
  if (nb) nb.style.display = 'none';
  if (memberLoggedIn) {
    if (gr) {
      gr.style.display = '';
      _updateNavAvatar(memberAvatarUrl);
    }
    if (mb) mb.style.display = ''; // always show My Requests when member is in
  } else {
    if (gr) gr.style.display = 'none';
    if (mb) mb.style.display = 'none';
  }
  // Also update admin button visibility
  var ab = document.getElementById('adminPanelBtn');
  if (ab) ab.style.display = adminLoggedIn ? '' : 'none';
  // Mobile bottom nav: show Requests tab when member is logged in
  var mnReq = document.getElementById('mn-requests');
  if (mnReq) mnReq.style.display = memberLoggedIn ? '' : 'none';
  var mnChat = document.getElementById('mn-chat');
  if (mnChat) mnChat.style.display = memberLoggedIn ? '' : 'none';
  updateChatUnreadBadge(false);
}

function updateAdminNavUI() {
  var ab = document.getElementById('adminPanelBtn');
  var lb = document.getElementById('logoutBtn');
  if (ab) ab.style.display = adminLoggedIn ? '' : 'none';
  if (lb) { if (adminLoggedIn) lb.classList.add('show'); else lb.classList.remove('show'); }
}

function memberLogout() {
  memberLoggedIn = false; memberPhone = ''; memberEmail = (typeof memberEmail !== 'undefined') ? '' : undefined; memberName = '';
  localStorage.removeItem(ML_KEY);
  document.documentElement.removeAttribute('data-member-active');
  updateMemberNavUI();
  updateNotifBadge();
  var _mbb = document.getElementById('myBookingsBtn'); if (_mbb) _mbb.style.display = 'none';
  stopChatPolling();
  if (_chatBadgeTimer) { clearInterval(_chatBadgeTimer); _chatBadgeTimer = null; }
  activeChatMember = null;
  activeChatId = '';
  chatUnreadCounts = {};
  ['home','venues','form','admin','myrequests','chat'].forEach(function(p) {
    var el = document.getElementById('page-'+p);
    if (el) el.classList.remove('active');
  });
  document.getElementById('memberLoginPage').classList.remove('hidden');
  document.getElementById('mlStep1').style.display = 'block';
  document.getElementById('mlStep2').style.display = 'none';
  var _msr=document.getElementById('mlStepRegister'); if(_msr) _msr.style.display='none';
  document.getElementById('mlPhone').value = '';
  var _mt2=document.getElementById('mlTimerTextStep2'); if(_mt2) _mt2.textContent='';
  mlResetRegisterEmail();
  clearInterval(_mlOtpTimer);
  document.getElementById('mlErr').textContent = '';
  showToast('','Signed Out','Please sign in again.');
}

function showMemberLogin(venueId) {
  if (otsIsAdminApp()) {
    var mlpAdmin = document.getElementById('memberLoginPage');
    if (mlpAdmin) mlpAdmin.classList.add('hidden');
    var lpAdmin = document.getElementById('loginPage');
    if (lpAdmin && !adminLoggedIn) lpAdmin.classList.add('show');
    return;
  }
  _pendingVenueAfterLogin = venueId || null;
  try { document.documentElement.classList.add('force-member-login'); } catch(e) {}
  try { document.documentElement.removeAttribute('data-admin-active'); } catch(e) {}
  var mlp = document.getElementById('memberLoginPage');
  if (mlp) mlp.classList.remove('hidden');
  var s1 = document.getElementById('mlStep1'); if (s1) s1.style.display = 'block';
  var s2 = document.getElementById('mlStep2'); if (s2) s2.style.display = 'none';
  var sr = document.getElementById('mlStepRegister'); if (sr) sr.style.display = 'none';
  var err = document.getElementById('mlErr'); if (err) err.textContent = '';
  var ph = document.getElementById('mlPhone'); if (ph) setTimeout(function(){ ph.focus(); }, 60);
  var t2 = document.getElementById('mlTimerTextStep2'); if (t2) t2.textContent = '';
  mlResetRegisterEmail();
  initGoogleSignIn();
  renderHelpdeskContacts();
  clearInterval(_mlOtpTimer);
}

function closeMemberLogin() {
  try { document.documentElement.classList.remove('force-member-login'); } catch(e) {}
  var mlp = document.getElementById('memberLoginPage');
  if (mlp) mlp.classList.add('hidden');
}

function authBackendEnabled() {
  return !!(AUTH_API_BASE && /^https:\/\//i.test(AUTH_API_BASE));
}

function googleSignInEnabled() {
  return authBackendEnabled() && !!GOOGLE_CLIENT_ID;
}

function authApiUrl(path) {
  return AUTH_API_BASE.replace(/\/+$/,'') + path;
}

function pushBackendBase() {
  return (PUSH_API_BASE || AUTH_API_BASE || '').replace(/\/+$/,'');
}

function pushBackendEnabled() {
  return !!(pushBackendBase() && /^https:\/\//i.test(pushBackendBase()));
}

function pushApiUrl(path) {
  return pushBackendBase() + path;
}

async function pushApi(path, payload) {
  var res = await fetch(pushApiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
  var data = {};
  try { data = await res.json(); } catch(e) {}
  if (!res.ok || data.ok === false) throw new Error(data.error || ('Push HTTP ' + res.status));
  return data;
}

async function authApi(path, payload) {
  var headers = { 'Content-Type': 'application/json' };
  try {
    var token = localStorage.getItem('ots_member_backend_token') || '';
    if (token) headers.Authorization = 'Bearer ' + token;
  } catch(e) {}
  var res = await fetch(authApiUrl(path), {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(payload || {})
  });
  var data = {};
  try { data = await res.json(); } catch(e) {}
  if (!res.ok || data.ok === false) throw new Error(data.error || ('Auth HTTP ' + res.status));
  return data;
}

function requestNativePushToken() {
  try {
    if (window.OTSNative && typeof window.OTSNative.requestPushToken === 'function') {
      window.OTSNative.requestPushToken();
      return true;
    }
  } catch(e) {
    console.warn('[OTS] native push token request failed:', e);
  }
  return false;
}

function _nativeTapStore(payload) {
  try { localStorage.setItem('ots_pending_notification_tap', JSON.stringify(payload || {})); } catch(e) {}
}
function _nativeTapClear() {
  try { localStorage.removeItem('ots_pending_notification_tap'); } catch(e) {}
}
function _nativeTapHighlight(id, prefixes) {
  if (!id) return false;
  var el = null;
  (prefixes || []).some(function(prefix) {
    el = document.getElementById(prefix + id);
    return !!el;
  });
  if (!el) return false;
  try { el.scrollIntoView({ behavior:'smooth', block:'center' }); } catch(e) { el.scrollIntoView(); }
  el.classList.remove('native-tap-highlight');
  void el.offsetWidth;
  el.classList.add('native-tap-highlight');
  setTimeout(function(){ try { el.classList.remove('native-tap-highlight'); } catch(e) {} }, 2600);
  return true;
}
function _nativeTapRoute(payload, attempt) {
  payload = payload || {};
  var type = String(payload.type || '');
  var bookingId = String(payload.bookingId || payload.booking_id || payload.id || '');
  var updateType = String(payload.updateType || payload.update_type || '');
  if (!bookingId && type !== 'admin_queue' && type !== 'member_update') return false;

  if (type === 'admin_queue') {
    if (!adminLoggedIn) {
      _nativeTapStore(payload);
      if (typeof showPage === 'function') showPage('admin');
      if (typeof showToast === 'function') showToast('', 'Admin Login Needed', 'Login to view this booking request.');
      return false;
    }
    showPage('admin');
    currentFilter = 'all';
    var search = document.getElementById('adminSearch'); if (search) search.value = '';
    switchAdminTab('bookings');
    filterTable();
    if (_nativeTapHighlight(bookingId, ['admin-booking-', 'ac-'])) return true;
    if ((attempt || 0) < 6) setTimeout(function(){ _nativeTapRoute(payload, (attempt || 0) + 1); }, 450);
    return false;
  }

  if (!memberLoggedIn) {
    _nativeTapStore(payload);
    if (typeof showMemberLogin === 'function') showMemberLogin();
    if (typeof showToast === 'function') showToast('', 'Member Login Needed', 'Login to view this update.');
    return false;
  }
  if (type === 'member_update' && !bookingId) {
    if (updateType === 'chat_message') {
      var peerPhone = String(payload.senderPhone || payload.chatPeerPhone || payload.peerPhone || '').trim();
      showPage('chat');
      setTimeout(function() {
        if (peerPhone) openMemberChat(peerPhone);
      }, 800);
    } else if (updateType === 'points' || updateType === 'reward' || updateType === 'withdraw') {
      showPage('profile');
      try { loadMemberStats(); } catch(e) {}
    } else {
      showPage('myrequests');
      try { fetchMyBookingsLive(); } catch(e) {}
    }
    _nativeTapClear();
    return true;
  }
  showPage('myrequests');
  try { renderUserBookings(); } catch(e) {}
  if (_nativeTapHighlight(bookingId, ['booking-'])) return true;
  if ((attempt || 0) < 6) {
    try { fetchMyBookingsLive(); } catch(e) {}
    setTimeout(function(){ _nativeTapRoute(payload, (attempt || 0) + 1); }, 450);
  }
  return false;
}
function otsHandleNativeNotificationTap(raw) {
  var payload = raw || {};
  if (typeof raw === 'string') {
    try { payload = JSON.parse(raw); } catch(e) { payload = { type: raw }; }
  }
  _nativeTapStore(payload);
  setTimeout(function() {
    var done = _nativeTapRoute(payload, 0);
    if (done) _nativeTapClear();
  }, 350);
}
function consumePendingNativeNotificationTap() {
  var payload = null;
  try { payload = JSON.parse(localStorage.getItem('ots_pending_notification_tap') || 'null'); } catch(e) {}
  if (!payload) return;
  setTimeout(function() {
    var done = _nativeTapRoute(payload, 0);
    if (done) _nativeTapClear();
  }, 500);
}
window.otsHandleNativeNotificationTap = otsHandleNativeNotificationTap;

function otsReceiveNativePushToken(token) {
  _nativePushToken = String(token || '').trim();
  try { localStorage.setItem('ots_native_push_token', _nativePushToken); } catch(e) {}
  saveMemberPushToken().catch(function(e){ console.warn('[OTS] push token save failed:', e && (e.message || e)); });
  saveAdminPushToken().catch(function(e){ console.warn('[OTS] admin push token save failed:', e && (e.message || e)); });
}
window.otsReceiveNativePushToken = otsReceiveNativePushToken;

async function ensurePushTokenTable() {
  if (_pushTokenTableReady) return;
  await neonSQL(
    "CREATE TABLE IF NOT EXISTS member_push_tokens (" +
    "token TEXT PRIMARY KEY, email TEXT, phone TEXT, member_name TEXT, platform TEXT, device_label TEXT, app_version TEXT, active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), last_sent_at TIMESTAMPTZ)"
  );
  _pushTokenTableReady = true;
}

async function saveMemberPushToken() {
  var token = _nativePushToken || '';
  try { if (!token) token = localStorage.getItem('ots_native_push_token') || ''; } catch(e) {}
  token = String(token || '').trim();
  if (!token || !memberLoggedIn || (!memberEmail && !memberPhone)) return false;

  var payload = {
    token: token,
    email: memberEmail || '',
    phone: memberPhone || '',
    name: memberName || '',
    platform: 'android',
    deviceLabel: (navigator && navigator.userAgent) ? navigator.userAgent.slice(0, 120) : 'Android app',
    appVersion: OTS_APP_VERSION
  };

  if (pushBackendEnabled()) {
    await pushApi('/push/register', payload);
  } else {
    await ensurePushTokenTable();
    await neonSQL(
      "INSERT INTO member_push_tokens (token, email, phone, member_name, platform, device_label, app_version, active, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,true,NOW()) ON CONFLICT (token) DO UPDATE SET email=EXCLUDED.email, phone=EXCLUDED.phone, member_name=EXCLUDED.member_name, platform=EXCLUDED.platform, device_label=EXCLUDED.device_label, app_version=EXCLUDED.app_version, active=true, updated_at=NOW()",
      [payload.token, payload.email, payload.phone, payload.name, payload.platform, payload.deviceLabel, payload.appVersion]
    );
  }
  return true;
}

async function saveAdminPushToken() {
  var token = _nativePushToken || '';
  try { if (!token) token = localStorage.getItem('ots_native_push_token') || ''; } catch(e) {}
  token = String(token || '').trim();
  if (!token || !pushBackendEnabled()) return false;
  try {
    if (typeof adminLoggedIn === 'undefined' || !adminLoggedIn) return false;
  } catch(e) {
    return false;
  }

  await pushApi('/push/register-admin', {
    token: token,
    username: currentAdminUsername || 'admin',
    role: currentAdminRole || 'admin',
    platform: 'android',
    deviceLabel: (navigator && navigator.userAgent) ? navigator.userAgent.slice(0, 120) : 'Android app',
    appVersion: OTS_APP_VERSION
  });
  return true;
}

function notifyBookingStatusChange(booking, status) {
  if (!booking || !pushBackendEnabled()) return;
  pushApi('/push/booking-status', {
    bookingId: booking.id,
    status: status || booking.status || '',
    venue: booking.venue || '',
    date: booking.date || '',
    name: booking.name || '',
    bookedBy: getBookingPersonName(booking),
    phone: booking.phone || '',
    email: booking.email || ''
  }).catch(function(e){
    console.warn('[OTS] push notification trigger failed:', e && (e.message || e));
  });
}

function notifyMemberUpdate(payload) {
  if (!payload || !pushBackendEnabled()) return;
  pushApi('/push/member-update', payload).catch(function(e){
    console.warn('[OTS] member update push failed:', e && (e.message || e));
  });
}

function notifyAdminNewBooking(booking) {
  if (!booking || !pushBackendEnabled()) return;
  pushApi('/push/admin-queue', {
    bookingId: booking.id,
    venue: booking.venue || '',
    date: booking.date || '',
    name: booking.name || '',
    phone: booking.phone || '',
    email: booking.email || '',
    type: booking.type || '',
    checkinAt: booking.checkinAt || '',
    checkinLat: booking.checkinLat || '',
    checkinLng: booking.checkinLng || '',
    checkinAccuracy: booking.checkinAccuracy || '',
    checkinMapUrl: booking.checkinMapUrl || buildCheckinMapUrl(booking.checkinLat, booking.checkinLng)
  }).catch(function(e){
    console.warn('[OTS] admin queue push failed:', e && (e.message || e));
  });
}

function notifyAdminCheckIn(booking) {
  if (!booking || !pushBackendEnabled()) return;
  pushApi('/push/admin-queue', {
    eventType: 'checkin',
    bookingId: booking.id,
    venue: booking.venue || '',
    date: booking.date || '',
    name: booking.name || '',
    bookedBy: getBookingPersonName(booking),
    phone: booking.phone || '',
    email: booking.email || '',
    type: booking.type || '',
    checkinAt: booking.checkinAt || '',
    checkinLat: booking.checkinLat || '',
    checkinLng: booking.checkinLng || '',
    checkinAccuracy: booking.checkinAccuracy || '',
    checkinMapUrl: booking.checkinMapUrl || buildCheckinMapUrl(booking.checkinLat, booking.checkinLng)
  }).catch(function(e){
    console.warn('[OTS] admin check-in push failed:', e && (e.message || e));
  });
}

function notifyAdminZoneApproval(member) {
  if (!member || !pushBackendEnabled()) return;
  pushApi('/push/admin-queue', {
    eventType: 'zone_approval',
    memberId: member.id || '',
    name: member.name || '',
    phone: member.phone || '',
    email: member.email || '',
    zone: member.zone || member.zoneRequest || '',
    currentZone: member.currentZone || '',
    reason: member.reason || '',
    type: 'zone_approval'
  }).catch(function(e){
    console.warn('[OTS] admin zone approval push failed:', e && (e.message || e));
  });
}

function initGoogleSignIn() {
  var wrap = document.getElementById('googleSignInWrap');
  var note = document.getElementById('googleSignInNote');
  var div  = document.getElementById('googleSignInButton');
  var sep  = document.getElementById('mlAuthDivider');
  if (!wrap || !div) return;
  if (!googleSignInEnabled()) {
    wrap.style.display = 'none';
    if (note) note.style.display = 'none';
    if (sep) sep.style.display = 'none';
    return;
  }
  wrap.style.display = 'flex';
  if (note) note.style.display = 'block';
  if (sep) sep.style.display = 'flex';
  if (!window.google || !google.accounts || !google.accounts.id) {
    setTimeout(initGoogleSignIn, 250);
    return;
  }
  if (div.dataset.rendered === '1') return;
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential
  });
  google.accounts.id.renderButton(div, {
    theme: 'filled_black',
    size: 'large',
    shape: 'rectangular',
    text: 'signin_with',
    width: 310
  });
  div.dataset.rendered = '1';
}

async function handleGoogleCredential(response) {
  var err = document.getElementById('mlErr');
  if (err) err.textContent = 'Checking Google sign-in...';
  try {
    var data = await authApi('/auth/google', { credential: response && response.credential });
    completeBackendMemberLogin(data.member, data.token, 'Google Sign-In');
  } catch(e) {
    if (err) err.textContent = (e && e.message) || 'Google sign-in failed.';
    if (typeof showToast === 'function') showToast('', 'Google Sign-In Failed', (e && e.message) || 'Try email OTP.');
  }
}

function completeBackendMemberLogin(member, token, method) {
  var allowed = member || {};
  memberLoggedIn = true;
  memberEmail = allowed.email || '';
  memberPhone = allowed.phone || '';
  memberName  = allowed.name || '';
  try { memberAddress = allowed.address || memberAddress || ''; } catch(e) {}
  memberAvatarUrl       = allowed.avatar_url           || '';
  memberBio             = allowed.bio                  || '';
  memberRoleType        = allowed.role_type            || '';
  memberInstrument      = allowed.instrument           || '';
  memberInstagram       = allowed.instagram            || '';
  memberBloodGroup      = allowed.blood_group          || '';
  memberDob             = allowed.date_of_birth        || '';
  memberIdProofUrl      = allowed.id_proof_url         || '';
  memberZoneCurrent     = allowed.zone_current         || '';
  memberZoneRequest     = allowed.zone_request         || '';
  memberZoneRequestReason = allowed.zone_request_reason || '';
  memberZoneRequestStatus = allowed.zone_request_status || '';
  try { if (token) localStorage.setItem('ots_member_backend_token', token); } catch(e) {}
  saveMemberSession();
  updateMemberNavUI();
  _fetchAndApplyMemberAvatar();
  updateNotifBadge();
  startChatBadgePolling();
  restoreMyBookingsFromServer();
  fetchMyBookingsLive();
  setTimeout(function() {
    try {
      refreshLiveCoreData({ showLoading:true, silentIfCached:true, maxAgeMs: LIVE_FAST_MS })
        .then(function(){ restoreMyBookingsFromServer(); loadGalleryLiveInBackground(); startGigPoll(); })
        .catch(function(e){ console.warn('[OTS] post-login live load skipped:', e && (e.message || e)); });
    } catch(e) {}
  }, 80);
  requestNativePushToken();
  saveMemberPushToken().catch(function(e){ console.warn('[OTS] push token save skipped:', e && (e.message || e)); });
  consumePendingNativeNotificationTap();
  document.documentElement.setAttribute('data-member-active','1');
  try { document.documentElement.classList.remove('force-member-login'); } catch(e) {}
  document.getElementById('memberLoginPage').classList.add('hidden');
  fillBookingFormFromSession();
  var verifyBtn2 = document.getElementById('mlVerifyBtn'); if (verifyBtn2) { verifyBtn2.disabled = false; verifyBtn2.textContent = 'Continue'; }
  var err = document.getElementById('mlErr'); if (err) err.textContent = '';
  showToast('', 'Welcome!', 'Signed in with ' + (method || 'secure login'));
  if (_pendingVenueAfterLogin) {
    var v = _pendingVenueAfterLogin;
    _pendingVenueAfterLogin = null;
    setTimeout(function() { pickVenue(v); }, 200);
  } else {
    showPage('home');
  }
}

function mlEmailLooksValid(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function mlSetRegisterStatus(message, type) {
  var status = document.getElementById('mlRegStatus');
  if (!status) return;
  status.textContent = message || '';
  status.className = 'ml-reg-status' + (type ? (' ' + type) : '');
}

function mlResetRegisterEmail() {
  ['mlRegPhone','mlRegEmail'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  mlSetRegisterStatus('', '');
  var btn = document.getElementById('mlRegBtn');
  if (btn) { btn.disabled = false; btn.textContent = 'Save Email'; }
}

function mlOpenRegisterEmail() {
  var mlp = document.getElementById('memberLoginPage');
  if (mlp) mlp.classList.remove('hidden');
  try { document.documentElement.classList.add('force-member-login'); } catch(e) {}
  var s1 = document.getElementById('mlStep1'); if (s1) s1.style.display = 'none';
  var s2 = document.getElementById('mlStep2'); if (s2) s2.style.display = 'none';
  var sr = document.getElementById('mlStepRegister'); if (sr) sr.style.display = 'block';
  var err = document.getElementById('mlErr'); if (err) err.textContent = '';
  mlSetRegisterStatus('', '');
  renderHelpdeskContacts();
  var phone = document.getElementById('mlRegPhone');
  if (phone) setTimeout(function(){ phone.focus(); }, 80);
}

function mlBackToEmailLogin() {
  var sr = document.getElementById('mlStepRegister'); if (sr) sr.style.display = 'none';
  var s2 = document.getElementById('mlStep2'); if (s2) s2.style.display = 'none';
  var s1 = document.getElementById('mlStep1'); if (s1) s1.style.display = 'block';
  var err = document.getElementById('mlErr'); if (err) err.textContent = '';
  mlSetRegisterStatus('', '');
  renderHelpdeskContacts();
  var email = document.getElementById('mlPhone');
  if (email) setTimeout(function(){ email.focus(); }, 60);
}

function openRegisterEmailPage() {
  mlOpenRegisterEmail();
}

async function mlRegisterEmail() {
  var phoneEl = document.getElementById('mlRegPhone');
  var emailEl = document.getElementById('mlRegEmail');
  var btn = document.getElementById('mlRegBtn');
  var loginEmailEl = document.getElementById('mlPhone');
  var rawPhone = phoneEl && phoneEl.value ? phoneEl.value.trim() : '';
  var phoneTen = _normPhone(rawPhone);
  var email = emailEl && emailEl.value ? emailEl.value.trim().toLowerCase() : '';

  mlSetRegisterStatus('', '');
  if (!phoneTen || phoneTen.length < 10) {
    mlSetRegisterStatus('Enter the member mobile number admin added.', 'err');
    if (phoneEl) phoneEl.focus();
    return;
  }
  if (!mlEmailLooksValid(email)) {
    mlSetRegisterStatus('Enter a valid email address.', 'err');
    if (emailEl) emailEl.focus();
    return;
  }
  if (typeof neonSQL !== 'function') {
    mlSetRegisterStatus('Live database is still loading. Please wait a moment and try again.', 'err');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    var data = await authApi('/auth/register-email', { phone: phoneTen, email: email });
    var savedMember = data.member || { email: email, phone: rawPhone };
    if (typeof members !== 'undefined') {
      var local = members.find(function(m){ return _normPhone(m.phone) === phoneTen; });
      if (local) {
        local.email = email;
        local.active = savedMember.active !== false;
      } else {
        members.push({
          id: savedMember.id,
          name: savedMember.name || '',
          email: email,
          phone: savedMember.phone || rawPhone,
          active: savedMember.active !== false
        });
      }
      try { localStorage.setItem('ots_members_cache', JSON.stringify(members)); } catch(_) {}
    }

    if (loginEmailEl) loginEmailEl.value = email;
    mlSetRegisterStatus('Email saved. Opening login so you can send OTP.', 'ok');
    if (typeof showToast === 'function') showToast('', 'Email Saved', 'You can now receive OTP on this email.');
    setTimeout(function(){ mlBackToEmailLogin(); }, 750);
  } catch(e) {
    console.error('Member email registration failed:', e);
    mlSetRegisterStatus((e && e.message) || 'Could not save email right now. Please try again or contact helpdesk.', 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Email'; }
  }
}

async function mlSendBackendOtp(email, isResend, btn, resendBtn, err) {
  try {
    var data = await authApi('/auth/send-otp', { email: email });
    _mlOtpBackendMode = true;
    _mlOtpSessionId = data.sessionId || '';
    _mlOtpEmail = email;
    _mlOtpMember = data.member || { email: email };
    _mlOtpExpiry = Date.now() + ((data.expiresIn || 300) * 1000);
    _mlOtpAttempts = 0;
    document.getElementById('mlStep1').style.display = 'none';
    document.getElementById('mlStep2').style.display = 'block';
    var regStep = document.getElementById('mlStepRegister'); if (regStep) regStep.style.display = 'none';
    var sent = document.getElementById('mlSentTo');
    if (sent) sent.textContent = email;
    var otpInput = document.getElementById('mlOtpInput');
    if (otpInput) { otpInput.value = ''; setTimeout(function(){ otpInput.focus(); }, 80); }
    var verifyBtn = document.getElementById('mlVerifyBtn');
    if (verifyBtn) { verifyBtn.disabled = false; verifyBtn.textContent = 'Continue'; }
    _mlVerifyInFlight = false;
    clearTimeout(_mlOtpAutoVerifyTimer);
    if (err) err.textContent = '';
    if (btn) { btn.textContent = 'Send OTP '; btn.disabled = false; }
    if (typeof showToast === 'function') showToast('', 'OTP Sent', 'Check your email inbox.');
    startEmailOtpTimers();
  } catch(e) {
    if (err) err.textContent = (e && e.message) || 'Could not send OTP.';
    if (btn) { btn.textContent = 'Send OTP '; btn.disabled = false; }
    if (resendBtn) resendBtn.disabled = false;
  }
}

async function mlVerifyBackendOtp(entered, verifyBtn, err) {
  if (!_mlOtpSessionId || !_mlOtpEmail) {
    if (err) err.textContent = 'OTP session expired. Please resend OTP.';
    _mlVerifyInFlight = false;
    if (verifyBtn) { verifyBtn.disabled = false; verifyBtn.textContent = 'Continue'; }
    return;
  }
  try {
    var data = await authApi('/auth/verify-otp', {
      email: _mlOtpEmail,
      sessionId: _mlOtpSessionId,
      otp: entered
    });
    _mlOtpBackendMode = false;
    _mlOtpSessionId = '';
    clearInterval(_mlOtpTimer);
    clearTimeout(_mlOtpAutoVerifyTimer);
    _mlVerifyInFlight = false;
    completeBackendMemberLogin(data.member, data.token, 'email OTP');
  } catch(e) {
    _mlOtpAttempts++;
    var left = Math.max(0, 5 - _mlOtpAttempts);
    if (err) err.textContent = (e && e.message ? e.message : 'Wrong OTP') + (left ? (' - ' + left + ' attempt(s) left.') : '');
    var otpInput = document.getElementById('mlOtpInput');
    if (otpInput) {
      otpInput.value = '';
      otpInput.classList.add('shake');
      setTimeout(function(){ otpInput.classList.remove('shake'); otpInput.focus(); }, 280);
    }
    _mlVerifyInFlight = false;
    if (verifyBtn) { verifyBtn.disabled = false; verifyBtn.textContent = 'Continue'; }
  }
}

async function mlSend(isResend) {
  var inputEl = document.getElementById('mlPhone');
  var email = (inputEl && inputEl.value ? inputEl.value.trim().toLowerCase() : '');
  var err = document.getElementById('mlErr');
  var btn = document.getElementById('mlSendBtn');
  var resendBtn = document.getElementById('mlResendBtn');

  if (err) err.textContent = '';
  if (!email || email.indexOf('@') === -1) {
    if (err) err.textContent = 'Please enter a valid registered email address.';
    if (inputEl) inputEl.focus();
    return;
  }

  if (!authBackendEnabled()) {
    if (err) err.textContent = 'Secure OTP server is not connected. Please contact admin/helpdesk.';
    return;
  }

  if (btn) { btn.textContent = isResend ? 'Resending...' : 'Sending...'; btn.disabled = true; }
  if (resendBtn) resendBtn.disabled = true;
  return mlSendBackendOtp(email, isResend, btn, resendBtn, err);
}

function startEmailOtpTimers() {
  clearInterval(_mlOtpTimer);
  var resendBtn = document.getElementById('mlResendBtn');
  var t1 = document.getElementById('mlTimerText');
  var t2 = document.getElementById('mlTimerTextStep2');
  var cooldown = 30;
  if (resendBtn) resendBtn.disabled = true;

  _mlOtpTimer = setInterval(function(){
    var now = Date.now();
    var expiryLeft = Math.max(0, Math.ceil((_mlOtpExpiry - now) / 1000));
    var min = Math.floor(expiryLeft / 60);
    var sec = String(expiryLeft % 60).padStart(2, '0');

    if (cooldown > 0) {
      if (t2) t2.textContent = 'Resend OTP in ' + cooldown + ' sec - OTP expires in ' + min + ':' + sec;
      cooldown--;
    } else {
      if (resendBtn) resendBtn.disabled = false;
      if (t2) t2.textContent = 'You can resend OTP now - OTP expires in ' + min + ':' + sec;
    }
    if (t1) t1.textContent = '';

    if (expiryLeft <= 0) {
      clearInterval(_mlOtpTimer);
      if (t2) t2.textContent = 'OTP expired. Please resend OTP.';
      if (resendBtn) resendBtn.disabled = false;
    }
  }, 1000);
}

function mlVerify() {
  clearTimeout(_mlOtpAutoVerifyTimer);
  var otpInput = document.getElementById('mlOtpInput');
  var entered = (otpInput && otpInput.value || '').replace(/\D/g, '').slice(0, 6);
  if (otpInput && otpInput.value !== entered) otpInput.value = entered;
  var err = document.getElementById('mlErr');
  if (err) err.textContent = '';
  var verifyBtn = document.getElementById('mlVerifyBtn');

  if (_mlVerifyInFlight) return;

  if (!entered) {
    if (err) err.textContent = 'Please enter the OTP.';
    if (otpInput) otpInput.focus();
    return;
  }
  if (entered.length < 6) {
    if (err) err.textContent = 'Please enter the full 6-digit OTP.';
    if (otpInput) otpInput.focus();
    return;
  }

  _mlVerifyInFlight = true;
  if (otpInput) otpInput.blur();
  if (verifyBtn) { verifyBtn.disabled = true; verifyBtn.textContent = 'Checking OTP...'; }
  return mlVerifyBackendOtp(entered, verifyBtn, err);
}

function mlVerifyTap(ev) {
  if (ev) {
    try { ev.preventDefault(); ev.stopPropagation(); } catch(e) {}
  }
  if (_mlVerifyTapLock) return false;
  _mlVerifyTapLock = true;
  setTimeout(function(){ _mlVerifyTapLock = false; }, 500);
  mlVerify();
  return false;
}

function mlOtpChanged() {
  var input = document.getElementById('mlOtpInput');
  var btn = document.getElementById('mlVerifyBtn');
  if (!input) return;
  clearTimeout(_mlOtpAutoVerifyTimer);
  var clean = String(input.value || '').replace(/\D/g, '').slice(0, 6);
  if (input.value !== clean) input.value = clean;
  if (btn && !_mlVerifyInFlight) {
    btn.disabled = false;
    btn.textContent = clean.length === 6 ? 'Checking OTP...' : 'Continue';
  }
  var err = document.getElementById('mlErr');
  if (err && clean.length) err.textContent = '';
  if (clean.length === 6 && !_mlVerifyInFlight) {
    _mlOtpAutoVerifyTimer = setTimeout(function(){ mlVerify(); }, 180);
  }
}

function mlBack() {
  clearInterval(_mlOtpTimer);
  document.getElementById('mlStep2').style.display = 'none';
  var regStep = document.getElementById('mlStepRegister'); if (regStep) regStep.style.display = 'none';
  document.getElementById('mlStep1').style.display = 'block';
  document.getElementById('mlErr').textContent = '';
  var t2 = document.getElementById('mlTimerTextStep2'); if (t2) t2.textContent = '';
  var resendBtn = document.getElementById('mlResendBtn'); if (resendBtn) resendBtn.disabled = true;
  _mlOtpAttempts = 0;
  _mlOtpBackendMode = false;
  _mlOtpSessionId = '';
  clearTimeout(_mlOtpAutoVerifyTimer);
  var vb = document.getElementById('mlVerifyBtn'); if (vb) { vb.disabled = false; vb.textContent = 'Continue'; }
  _mlVerifyInFlight = false;
  var ph = document.getElementById('mlPhone'); if (ph) ph.focus();
}

// Check member by email in Neon
async function mlCheckMemberByEmail(email) {
  try {
    var lc = email.toLowerCase();
    // Pull every profile column so the OTP login can hydrate bio, avatar, zone, etc.
    var rows = await neonSQL(
      'SELECT * FROM members WHERE LOWER(email) = $1 AND active IS NOT FALSE LIMIT 1',
      [lc]
    );
    if (rows.length) return rows[0];
    var check = await neonSQL('SELECT id FROM members LIMIT 1');
    if (!check || !check.length) return null;
    return null;
  } catch(e) {
    console.warn('Email member check failed:', e);
    if (e && e.message && e.message.includes('does not exist')) {
      return { id:'open', name:'', email:email };
    }
    return null;
  }
}


// Check if phone is a registered active member in Neon
async function mlCheckMember(phone) {
  // Normalise to just digits (strip spaces, dashes, brackets, +)
  function norm(p) { return (p||'').replace(/[^\d]/g,''); }
  var digits = norm(phone);
  // Strip leading country code 91 to get 10-digit number
  var ten = digits.length > 10 ? digits.slice(-10) : digits;

  // -- 1. Check local members array first (fast, no network needed) --
  if (typeof members !== 'undefined' && members.length) {
    var local = members.find(function(m) {
      if (m.active === false) return false;
      var md = norm(m.phone||'');
      var mt = md.length > 10 ? md.slice(-10) : md;
      return mt && mt === ten;
    });
    if (local) return local;
  }

  // -- 2. Fall back to Neon DB lookup --
  try {
    var variants = [phone, digits, ten, '91'+ten, '+91'+ten]
      .filter(function(v, i, a){ return v && a.indexOf(v) === i; });
    var placeholders = variants.map(function(_, i){ return '$' + (i+1); }).join(',');
    var rows = await neonSQL(
      'SELECT id, name, email, phone FROM members WHERE phone IN (' + placeholders + ') AND active IS NOT FALSE LIMIT 1',
      variants
    );
    return rows.length ? rows[0] : null;
  } catch(e) {
    console.error('Member check error:', e);
    return null;
  }
}

// Enter key support
document.addEventListener('DOMContentLoaded', function() {
  var ph = document.getElementById('mlPhone');
  if (ph) ph.addEventListener('keydown', function(e) { if (e.key === 'Enter') mlSend(); });
  var rp = document.getElementById('mlRegPhone');
  if (rp) rp.addEventListener('keydown', function(e) { if (e.key === 'Enter') mlRegisterEmail(); });
  var re = document.getElementById('mlRegEmail');
  if (re) re.addEventListener('keydown', function(e) { if (e.key === 'Enter') mlRegisterEmail(); });
  var oi = document.getElementById('mlOtpInput');
  if (oi) oi.addEventListener('keydown', function(e) { if (e.key === 'Enter') mlVerify(); });
  initGoogleSignIn();
  fillBookingFormFromSession();
  // Close admin queue panel on outside click
  document.addEventListener('click', function(e) {
    if (!_adminNotifOpen) return;
    var wrap = document.getElementById('adminNotifBellBtn') && document.getElementById('adminNotifBellBtn').closest('div');
    var panel = document.getElementById('adminNotifPanel');
    var bell  = document.getElementById('adminNotifBellBtn');
    if (panel && bell && !panel.contains(e.target) && !bell.contains(e.target)) { closeAdminNotifPanel(); }
  });
});

// =======================================
// MEMBER MANAGEMENT
// =======================================

function _memberRowKey(m) {
  var phone = _normPhone((m && m.phone) || '');
  var email = ((m && m.email) || '').trim().toLowerCase();
  return phone ? ('p:' + phone) : (email ? ('e:' + email) : ('id:' + ((m && m.id) || '')));
}

function _dedupeMemberRows(rows) {
  var map = {};
  (rows || []).forEach(function(m) {
    var key = _memberRowKey(m);
    if (!key) return;
    if (!map[key]) {
      map[key] = Object.assign({}, m);
      return;
    }
    var existing = map[key];
    Object.keys(m).forEach(function(k) {
      if ((existing[k] == null || existing[k] === '') && m[k] != null && m[k] !== '') existing[k] = m[k];
    });
    if (m.zone_current && !existing.zone_current) existing.zone_current = m.zone_current;
    if (m.zone_request_status === 'pending' && m.zone_request) {
      existing.zone_request = m.zone_request;
      existing.zone_request_reason = m.zone_request_reason || existing.zone_request_reason || '';
      existing.zone_request_status = 'pending';
    }
    if (m.active !== false) existing.active = true;
  });
  return Object.values(map);
}

function _dedupeRenderedMembers(list) {
  var map = {};
  (list || []).forEach(function(m) {
    var key = _memberRowKey(m);
    if (!key) return;
    if (!map[key]) {
      map[key] = Object.assign({}, m);
      return;
    }
    var existing = map[key];
    Object.keys(m).forEach(function(k) {
      if ((existing[k] == null || existing[k] === '') && m[k] != null && m[k] !== '') existing[k] = m[k];
    });
    if (m.zoneCurrent && !existing.zoneCurrent) existing.zoneCurrent = m.zoneCurrent;
    if (m.zoneRequestStatus === 'pending' && m.zoneRequest) {
      existing.zoneRequest = m.zoneRequest;
      existing.zoneRequestReason = m.zoneRequestReason || existing.zoneRequestReason || '';
      existing.zoneRequestStatus = 'pending';
    }
    if (m.active !== false) existing.active = true;
  });
  return Object.values(map);
}

async function loadMembers() {
  try {
    try {
      var cachedMembers = JSON.parse(localStorage.getItem('ots_members_cache') || '[]');
      if (Array.isArray(cachedMembers) && cachedMembers.length && !members.length) {
        members = _dedupeRenderedMembers(cachedMembers);
        renderMembersTable();
      }
    } catch(_){}
    const rows = _dedupeMemberRows(await neonSQL('SELECT * FROM members ORDER BY created_at DESC'));
    members = rows.map(m => ({
      id:      m.id,
      name:    m.name  || '',
      email:   m.email || '',
      phone:   m.phone || '',
      address: m.address || '',
      bio: m.bio || '',
      roleType: m.role_type || '',
      instrument: m.instrument || '',
      instagram: m.instagram || '',
      bloodGroup: m.blood_group || '',
      dob: m.date_of_birth || '',
      zoneCurrent: m.zone_current || '',
      zoneRequest: m.zone_request || '',
      zoneRequestReason: m.zone_request_reason || '',
      zoneRequestStatus: m.zone_request_status || '',
      idProofUrl: m.id_proof_url || '',
      addedAt: m.created_at || '',
      active:  m.active !== false
    }));
    try { localStorage.setItem('ots_members_cache', JSON.stringify(members)); } catch(_){}
    renderMembersTable();
  } catch(e) { console.warn('loadMembers failed:', e); }
}

function otsEscapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) {
    return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch];
  });
}

function otsJsString(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function getMemberZoneValue(m) {
  return (m && m.zoneCurrent) ? m.zoneCurrent : 'No Zone';
}

function renderZoneFilter() {
  var box = document.getElementById('memberZoneFilter');
  var summary = document.getElementById('memberZoneSummary');
  if (!box) return;
  var active = members.filter(function(m){ return m.active !== false; });
  var names = parseZoneNames(zoneNames);
  var counts = {};
  names.forEach(function(z){ counts[z] = 0; });
  counts['No Zone'] = 0;
  active.forEach(function(m){
    var z = getMemberZoneValue(m);
    if (counts[z] == null) counts[z] = 0;
    counts[z]++;
  });
  if (memberZoneFilter !== 'all' && counts[memberZoneFilter] == null) memberZoneFilter = 'all';
  var chips = [{label:'All', value:'all', count:active.length}]
    .concat(Object.keys(counts).filter(function(z){ return z !== 'No Zone'; }).map(function(z){ return {label:z, value:z, count:counts[z] || 0}; }))
    .concat([{label:'No Zone', value:'No Zone', count:counts['No Zone'] || 0}]);
  box.innerHTML = chips.map(function(c){
    return '<button type="button" class="member-zone-chip ' + (memberZoneFilter === c.value ? 'active' : '') + '" onclick="setMemberZoneFilter(\'' + otsJsString(c.value) + '\')">' +
      otsEscapeHtml(c.label) + ' (' + c.count + ')</button>';
  }).join('');
  if (summary) {
    summary.textContent = memberZoneFilter === 'all'
      ? 'Showing all active and inactive members. Click a zone to see only that group.'
      : 'Showing members in ' + memberZoneFilter + '.';
  }
}

function setMemberZoneFilter(zone) {
  memberZoneFilter = zone || 'all';
  memberPage = 1;
  renderMembersTable();
}
function changeMemberPage(delta) {
  memberPage = Math.max(1, (memberPage || 1) + delta);
  renderMembersTable();
}
function setMemberPageSize(value) {
  memberPageSize = Math.max(10, parseInt(value, 10) || 50);
  memberPage = 1;
  renderMembersTable();
}
function renderMemberPager(totalRows) {
  var pager = document.getElementById('memberPager');
  if (!pager) return;
  var totalPages = Math.max(1, Math.ceil(totalRows / memberPageSize));
  memberPage = Math.min(Math.max(1, memberPage || 1), totalPages);
  var start = totalRows ? ((memberPage - 1) * memberPageSize) + 1 : 0;
  var end = Math.min(totalRows, memberPage * memberPageSize);
  pager.innerHTML = `
    <div class="admin-pager-info">Showing ${start}-${end} of ${totalRows} member${totalRows === 1 ? '' : 's'}</div>
    <div class="admin-pager-actions">
      <select class="admin-page-size" onchange="setMemberPageSize(this.value)">
        <option value="25" ${memberPageSize===25?'selected':''}>25 / page</option>
        <option value="50" ${memberPageSize===50?'selected':''}>50 / page</option>
        <option value="100" ${memberPageSize===100?'selected':''}>100 / page</option>
      </select>
      <button class="admin-page-btn" onclick="changeMemberPage(-1)" ${memberPage<=1?'disabled':''}>Prev</button>
      <span class="admin-pager-info">Page ${memberPage} / ${totalPages}</span>
      <button class="admin-page-btn" onclick="changeMemberPage(1)" ${memberPage>=totalPages?'disabled':''}>Next</button>
    </div>`;
}

function renderMembersTable() {
  const body  = document.getElementById('membersTableBody');
  const count = document.getElementById('memberCount');
  const pager = document.getElementById('memberPager');
  const canEditMembers = hasAdminPerm('members');
  if (!body) return;
  const active = members.filter(m => m.active !== false);
  if (count) count.textContent = active.length;
  renderZoneFilter();
  if (!members.length) {
    body.innerHTML = '<div class="table-empty"><span class="emoji"></span>No members yet. Add some above.</div>';
    if (pager) pager.innerHTML = '';
    return;
  }
  var visibleMembers = memberZoneFilter === 'all'
    ? members
    : members.filter(function(m){ return getMemberZoneValue(m) === memberZoneFilter; });
  var q = (document.getElementById('memberSearch')?.value || '').trim().toLowerCase();
  if (q) {
    visibleMembers = visibleMembers.filter(function(m) {
      return String(m.name || '').toLowerCase().includes(q) ||
             String(m.email || '').toLowerCase().includes(q) ||
             String(m.phone || '').toLowerCase().includes(q) ||
             memberRoleLabel(m.roleType || '', m.instrument || '').toLowerCase().includes(q) ||
             String(m.zoneCurrent || '').toLowerCase().includes(q);
    });
  }
  if (!visibleMembers.length) {
    body.innerHTML = '<div class="table-empty"><span class="emoji"></span>No members found.</div>';
    renderMemberPager(0);
    return;
  }
  renderMemberPager(visibleMembers.length);
  var pageMembers = visibleMembers.slice((memberPage - 1) * memberPageSize, memberPage * memberPageSize);
  var baseIndex = (memberPage - 1) * memberPageSize;
  body.innerHTML = pageMembers.map((m, i) => {
    var zoneText = m.zoneCurrent || '-';
    var pending = m.zoneRequestStatus === 'pending' && m.zoneRequest;
    var memberId = otsJsString(m.id);
    var memberNameHtml = m.name ? otsEscapeHtml(m.name) : '<span style="color:var(--muted);font-style:italic;">-</span>';
    var pendingHtml = pending ? ' <span style="color:var(--yellow);">- Pending ' + otsEscapeHtml(m.zoneRequest) + '</span>' : '';
    var roleText = memberRoleLabel(m.roleType || '', m.instrument || '');
    return `
    <div class="members-tbl-row">
      <div style="color:var(--muted);font-size:.8rem;">${baseIndex + i + 1}</div>
      <div style="font-size:.88rem;font-weight:500;">
        ${memberNameHtml}
        ${roleText ? `<div style="font-size:.68rem;color:var(--blue);font-weight:700;margin-top:.2rem;">${otsEscapeHtml(roleText)}</div>` : ''}
        <div style="font-size:.68rem;color:var(--muted);margin-top:.2rem;">Zone: ${otsEscapeHtml(zoneText)}${pendingHtml}</div>
      </div>
      <div style="font-size:.78rem;color:#70BAF4;word-break:break-all;">${m.email ? otsEscapeHtml(m.email) : '<span style="color:rgba(244,240,255,.3);font-style:italic;">-</span>'}</div>
      <div style="font-size:.82rem;font-family:monospace;">${m.phone ? otsEscapeHtml(m.phone) : '<span style="color:rgba(244,240,255,.3);font-style:italic;">-</span>'}</div>
      <div style="font-size:.75rem;color:var(--muted);">${m.addedAt ? otsEscapeHtml(m.addedAt.slice(0,10)) : '-'}</div>
      <div style="display:flex;flex-wrap:wrap;gap:.35rem;align-items:center;">
        <button data-member-id="${otsEscapeHtml(m.id)}" data-member-mode="view" onclick="openMemberProfileAdmin('${memberId}', false)" style="background:rgba(112,186,244,.08);border:1px solid rgba(112,186,244,.3);color:#70BAF4;font-size:.68rem;padding:.18rem .5rem;border-radius:2px;cursor:pointer;">View</button>
        ${canEditMembers ? `<button data-member-id="${otsEscapeHtml(m.id)}" data-member-mode="edit" onclick="openMemberProfileAdmin('${memberId}', true)" style="background:rgba(158,118,204,.1);border:1px solid rgba(158,118,204,.35);color:var(--purple);font-size:.68rem;padding:.18rem .5rem;border-radius:2px;cursor:pointer;">Edit</button>` : ''}
        
        ${canEditMembers ? `<span class="member-status-badge ${m.active !== false ? 'active' : 'inactive'}"
              style="cursor:pointer;" title="Toggle active/inactive"
              onclick="toggleMemberActive('${memberId}', ${m.active !== false})">
          ${m.active !== false ? ' Active' : ' Inactive'}
        </span>
        <button onclick="deleteMember('${memberId}')"
          style="background:transparent;border:1px solid rgba(255,107,107,.3);color:var(--red);font-size:.68rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:.18rem .5rem;cursor:pointer;border-radius:2px;">x</button>` : '<span style="font-size:.68rem;color:var(--muted);">View only</span>'}
      </div>
    </div>`;
  }).join('');
}

async function addMemberManual() {
  if (!requireAdminPerm('members', 'member management')) return;
  const nameEl  = document.getElementById('newMemberName');
  const emailEl = document.getElementById('newMemberEmail');
  const phoneEl = document.getElementById('newMemberPhone');
  const name    = nameEl ? nameEl.value.trim() : '';
  const email   = emailEl ? emailEl.value.trim().toLowerCase() : '';
  const phoneRaw = phoneEl ? phoneEl.value.trim() : '';
  // Normalise to digits only, last 10 = mobile number
  const phoneDigits = phoneRaw.replace(/[^\d]/g,'');
  const phone = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : phoneDigits;
  if (!name)  { showToast('', 'Name required',  'Please enter the member\'s full name.'); return; }
  if (!phone || phone.length < 10) { showToast('', 'Phone required', 'Please enter a valid 10-digit mobile number.'); return; }
  const id = 'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const row = { id, name, email, phone, active: true, created_at: new Date().toISOString() };
  try {
    // Insert into Neon DB
    await sbUpsert('members', [row]);
    members.unshift({ id, name, email, phone, addedAt: row.created_at, active: true });
    renderMembersTable();
    if (nameEl)  nameEl.value  = '';
    if (emailEl) emailEl.value = '';
    if (phoneEl) phoneEl.value = '';
    logAdminAction('add_member', name + (phone ? ' (' + phone + ')' : '')).catch(function(){});
    showToast('', 'Member Added', (name || email) + ' can now log in.');
  } catch(e) {
    showToast('', 'Network Error', e.message || 'Could not reach Neon DB.');
    alert('Error: ' + e.message);
    console.error(e);
  }
}
function handleMemberCSV(file) {
  if (!requireAdminPerm('members', 'member management')) { var inp0 = document.getElementById('memberCsvInput'); if (inp0) inp0.value = ''; return; }
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    const text  = e.target.result;
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) { showToast('', 'Empty file', 'The CSV file has no data.'); return; }

    // Auto-detect header and column positions
    const firstLow = lines[0].toLowerCase();
    const isHeader = firstLow.includes('name') || firstLow.includes('phone') || firstLow.includes('mobile') || firstLow.includes('email');
    const dataLines = isHeader ? lines.slice(1) : lines;
    if (!dataLines.length) { showToast('', 'No data rows', 'CSV only contained a header row.'); return; }

    // Detect column order from header (if present)
    let colName = 0, colEmail = 1, colPhone = 2;
    if (isHeader) {
      const cols = firstLow.split(/[,;]/).map(c => c.replace(/[^a-z]/g,''));
      cols.forEach((c, i) => {
        if (c.includes('name'))                         colName  = i;
        if (c.includes('email') || c.includes('mail')) colEmail = i;
        if (c.includes('phone') || c.includes('mobile') || c.includes('number')) colPhone = i;
      });
    }

    const newRows = [];
    let skipped = 0;
    for (const line of dataLines) {
      const parts = line.split(/[,;]/).map(p => p.replace(/^["'\s]+|["'\s]+$/g, ''));

      let name = '', email = '', phone = '';

      if (isHeader) {
        // Use detected column positions
        name  = parts[colName]  || '';
        email = (parts[colEmail] || '').toLowerCase().trim();
        phone = parts[colPhone] || '';
      } else {
        // Smart auto-detect: scan each column for what it looks like
        for (const part of parts) {
          const clean = part.trim();
          if (!email && clean.includes('@') && clean.includes('.')) {
            email = clean.toLowerCase();
          } else if (!phone && /\d{7,}/.test(clean.replace(/[\s\-\.\(\)]/g,''))) {
            phone = clean;
          } else if (!name) {
            name = clean;
          }
        }
      }

      // Normalise phone to last 10 digits
      const phoneD = phone.replace(/[^\d]/g,'');
      phone = phoneD.length >= 10 ? phoneD.slice(-10) : phoneD;
      email = email.replace(/[\s]/g, '');

      // Name + Phone required; email is optional
      const hasName  = !!name;
      const hasPhone = !!(phone && phone.length >= 10);
      if (!hasName || !hasPhone) { skipped++; continue; }

      // Skip duplicates by phone (primary key for members without email)
      const isDup = members.some(m =>
        (m.phone && m.phone.replace(/[\s\-]/g,'') === phone) ||
        (email && m.email && m.email.toLowerCase() === email)
      );
      if (isDup) { skipped++; continue; }

      const id = 'mem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5) + newRows.length;
      newRows.push({ id, name, email: email || '', phone, active: true, created_at: new Date().toISOString() });
    }

    if (!newRows.length) { showToast('', 'Nothing new', `No new rows (Name+Phone required). ${skipped} skipped.`); return; }

    // Batch-insert in chunks of 50 to avoid DB timeouts on large CSVs
    const CHUNK = 50;
    let saved = 0;
    showToast('', 'Importing...', `Saving ${newRows.length} member(s) in batches...`);
    try {
      for (let i = 0; i < newRows.length; i += CHUNK) {
        const chunk = newRows.slice(i, i + CHUNK);
        await sbUpsert('members', chunk);
        chunk.forEach(r => members.unshift({ id: r.id, name: r.name, email: r.email || '', phone: r.phone || '', addedAt: r.created_at, active: true }));
        saved += chunk.length;
        // Update toast progress
        showToast('', 'Importing...', `Saved ${saved} / ${newRows.length}...`);
      }
      renderMembersTable();
      const inp = document.getElementById('memberCsvInput');
      if (inp) inp.value = '';
      showToast('', 'Import Complete', `${saved} added${skipped ? ', ' + skipped + ' skipped (no phone)' : ''}.`);
    } catch(err) {
      showToast('', 'Import Failed', `Saved ${saved} before error: ${err.message || err}`);
      console.error(err);
    }
  };
  reader.readAsText(file);
}

async function toggleMemberActive(id, currentlyActive) {
  if (!requireAdminPerm('members', 'member management')) return;
  const m = members.find(x => x.id === id);
  if (!m) return;
  m.active = !currentlyActive;
  try {
    await dbPatch('members', id, { active: m.active });
    renderMembersTable();
    showToast(m.active ? '\u2705' : '\u{1F512}', m.active ? 'Activated' : 'Deactivated',
              (m.name || m.phone) + (m.active ? ' can now log in.' : ' blocked from logging in.'));
  } catch(e) {
    m.active = currentlyActive;
    showToast('\u274c', 'Update Failed', 'Could not update member status.');
  }
}

async function deleteMember(id) {
  if (!requireAdminPerm('members', 'member management')) return;
  const m = members.find(x => x.id === id);
  if (!confirm(`Remove ${m?.name || m?.phone || 'this member'}?`)) return;
  try {
    await sbDelete('members', id);
    members = members.filter(x => x.id !== id);
    renderMembersTable();
    logAdminAction('remove_member', (m?.name || '') + (m?.phone ? ' (' + m.phone + ')' : '')).catch(function(){});
    showToast('\u{1F5D1}\ufe0f', 'Member Removed', (m?.name || m?.phone) + ' has been removed.');
  } catch(e) {
    showToast('\u274c', 'Delete Failed', 'Could not remove member.');
  }
}

function exportMembersCSV() {
  if (!members.length) { showToast('\u26a0\ufe0f', 'No members', 'Nothing to export yet.'); return; }
  const hdr  = ['Name', 'Email', 'Phone', 'Role', 'Instrument', 'Address', 'Zone', 'Pending Zone', 'Active', 'Added'];
  const rows = members.map(m => [m.name || '', m.email || '', m.phone || '', memberRoleLabel(m.roleType || '', m.instrument || ''), m.instrument || '', m.address || '', m.zoneCurrent || '', m.zoneRequest || '', m.active ? 'Yes' : 'No', m.addedAt ? m.addedAt.slice(0,10) : '']);
  const csv  = [hdr, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const a    = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
    download: 'ots-members.csv'
  });
  a.click();
  showToast('\u2b07\ufe0f', 'Members Exported', members.length + ' record(s) downloaded.');
}

function togglePw() {
  const inp = document.getElementById('loginPass');
  const btn = document.getElementById('pwToggleBtn');
  if (inp.type === 'password') { inp.type = 'text'; btn.textContent = ''; }
  else { inp.type = 'password'; btn.textContent = ''; }
}
