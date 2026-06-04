
  // -- BOOT --
  init();

  function renderBuildEnvironmentBadge() {
    try {
      var href = String(location.href || '').toLowerCase();
      var host = String(location.hostname || '').toLowerCase();
      var isTestLike = /(^|[.\-_])(dev|test|staging)([.\-_]|$)/i.test(host) ||
        href.indexOf('ots_dev_upload_test_site') > -1 ||
        href.indexOf('localhost') > -1 ||
        href.indexOf('127.0.0.1') > -1;
      if (!isTestLike || document.getElementById('otsEnvBadge')) return;
      document.documentElement.setAttribute('data-ots-env', 'test');
      var badge = document.createElement('div');
      badge.id = 'otsEnvBadge';
      badge.textContent = 'TEST BUILD';
      badge.style.cssText = [
        'position:fixed',
        'left:12px',
        'top:12px',
        'z-index:2147483647',
        'background:#ffb84d',
        'color:#1a1208',
        'border:1px solid rgba(0,0,0,.18)',
        'border-radius:999px',
        'padding:.38rem .68rem',
        'font-family:Arial,sans-serif',
        'font-size:11px',
        'font-weight:900',
        'letter-spacing:.08em',
        'box-shadow:0 10px 24px rgba(0,0,0,.22)',
        'pointer-events:none'
      ].join(';');
      document.body.appendChild(badge);
    } catch(e) {}
  }

  renderBuildEnvironmentBadge();

  // Hide nav whenever the member login overlay is visible
  (function() {
    var nav = document.querySelector('.nav');
    var mlp = document.getElementById('memberLoginPage');
    if (!nav || !mlp) return;
    function syncNav() {
      var isHidden = mlp.classList.contains('hidden');
      nav.style.display = isHidden ? '' : 'none';
      var mbn = document.getElementById('mobile-nav');
      if (mbn) mbn.style.display = isHidden ? '' : 'none';
    }
    syncNav();
    new MutationObserver(syncNav).observe(mlp, { attributes: true, attributeFilter: ['class'] });
  })();
  
function restoreVisiblePage() {
  try {
    const mlp = document.getElementById('memberLoginPage');
    if (typeof otsIsAdminApp === 'function' && otsIsAdminApp()) {
      if (mlp) mlp.classList.add('hidden');
      if ((typeof adminLoggedIn !== 'undefined' && adminLoggedIn) ||
          (typeof _hasAdminSession === 'function' && _hasAdminSession()) ||
          document.documentElement.hasAttribute('data-admin-active')) {
        var lp = document.getElementById('loginPage');
        if (lp) lp.classList.remove('show');
        showPage('admin');
      } else {
        var lp = document.getElementById('loginPage');
        if (lp) lp.classList.add('show');
      }
      return;
    }

    if (typeof adminLoggedIn !== 'undefined' && adminLoggedIn) {
      if (mlp) mlp.classList.add('hidden');
      showPage('admin');
      return;
    }

    if (typeof memberLoggedIn !== 'undefined' && !memberLoggedIn) {
      if (mlp) mlp.classList.remove('hidden');
      return;
    }

    if (mlp) mlp.classList.add('hidden');

    const savedPage = localStorage.getItem('ots_current_page');
    const safePage = ['home', 'venues', 'form', 'myrequests', 'leaderboard', 'profile'].includes(savedPage)
      ? savedPage
      : 'home';

    if (typeof showPage === 'function') {
      showPage(safePage);
    }
  } catch (e) {
    if (typeof showPage === 'function') {
      showPage('home');
    }
  }
}

document.addEventListener('visibilitychange', function () {
  if (!document.hidden) {
    setTimeout(restoreVisiblePage, 150);
  }
});

window.addEventListener('focus', function () {
  setTimeout(restoreVisiblePage, 150);
});


function forceImmediateBootPage() {
  try {
    var hasActive = !!document.querySelector('.page.active');
    var mlp = document.getElementById('memberLoginPage');

    function refreshTopNavSoon() {
      setTimeout(function () {
        try { if (typeof updateMemberNavUI === 'function') updateMemberNavUI(); } catch (e) {}
        try { if (typeof updateNotifBadge === 'function') updateNotifBadge(); } catch (e) {}
      }, 50);
      setTimeout(function () {
        try { if (typeof updateMemberNavUI === 'function') updateMemberNavUI(); } catch (e) {}
        try { if (typeof updateNotifBadge === 'function') updateNotifBadge(); } catch (e) {}
      }, 300);
    }

    if (typeof otsIsAdminApp === 'function' && otsIsAdminApp()) {
      if (mlp) mlp.classList.add('hidden');
      var hasAdminSession = (typeof _hasAdminSession === 'function' && _hasAdminSession()) ||
                            (typeof adminLoggedIn !== 'undefined' && adminLoggedIn) ||
                            document.documentElement.hasAttribute('data-admin-active');
      var adminOnlyPage = document.getElementById('page-admin');
      var adminLogin = document.getElementById('loginPage');
      if (hasAdminSession) {
        if (adminOnlyPage && !hasActive) adminOnlyPage.classList.add('active');
        if (adminLogin) adminLogin.classList.remove('show');
      } else if (!hasActive) {
        if (adminLogin) adminLogin.classList.add('show');
      }
      refreshTopNavSoon();
      return;
    }

    // If admin session is already known from pre-render flag, show admin instantly
    if (document.documentElement.hasAttribute('data-admin-active')) {
      if (mlp) mlp.classList.add('hidden');
      var adminPage = document.getElementById('page-admin');
      if (adminPage && !hasActive) adminPage.classList.add('active');
      refreshTopNavSoon();
      return;
    }

    // If member session is already known from pre-render flag, show home instantly
    if (document.documentElement.hasAttribute('data-member-active')) {
      if (mlp) mlp.classList.add('hidden');
      var savedPage = '';
      try { savedPage = localStorage.getItem('ots_current_page') || ''; } catch(e) {}
      var safePage = ['home','venues','form','myrequests','leaderboard','profile'].indexOf(savedPage) > -1
        ? savedPage
        : 'home';
      var targetPage = document.getElementById('page-' + safePage);
      if (targetPage && !hasActive) targetPage.classList.add('active');
      refreshTopNavSoon();
      return;
    }

    // Otherwise keep login visible
    if (mlp) mlp.classList.remove('hidden');
  } catch (e) {}
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', forceImmediateBootPage);
} else {
  forceImmediateBootPage();
}


document.addEventListener('click', function(ev){
  var btn = ev.target && ev.target.closest && ev.target.closest('.vrc-select-btn');
  if (!btn) return;
  if ((btn.textContent || '').indexOf('Login') > -1 && !memberLoggedIn) {
    try { document.documentElement.classList.add('force-member-login'); } catch(e) {}
    var mlp = document.getElementById('memberLoginPage');
    if (mlp) mlp.classList.remove('hidden');
  }
});


var _memberAdminCurrentId = '';
var _memberAdminEditMode = false;

function _setMemberAdminFieldsDisabled(disabled) {
  ['ma-name','ma-email','ma-address','ma-instrument','ma-instagram','ma-blood-group','ma-dob','ma-bio','ma-zone-current']
    .forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.disabled = !!disabled;
    });
}


function openMemberProfileAdmin(id, editMode) {
  try {
    if (editMode && !requireAdminPerm('members', 'member management')) editMode = false;
    var m = members.find(function(x){ return x.id === id; });
    if (!m) {
      showToast('', 'Member not found', 'Could not open that member profile.');
      return;
    }

    _memberAdminCurrentId = id;
    _memberAdminEditMode = !!editMode;
    refreshZoneSelects();

    var setVal = function(id, val){
      var el = document.getElementById(id);
      if (el) el.value = val || '';
    };

    setVal('ma-name', m.name);
    setVal('ma-phone', m.phone);
    setVal('ma-email', m.email);
    setVal('ma-address', m.address);
    setVal('ma-instrument', m.instrument);
    setVal('ma-instagram', m.instagram);
    setVal('ma-blood-group', m.bloodGroup);
    setVal('ma-dob', _normalizeBirthDayMonth(m.dob) || '');
    setVal('ma-bio', m.bio);
    var maZone = document.getElementById('ma-zone-current');
    if (maZone) maZone.innerHTML = zoneOptionsHtml(m.zoneCurrent, true);
    setVal('ma-zone-current', m.zoneCurrent);
    setVal('ma-zone-request', m.zoneRequest);
    setVal('ma-zone-reason', m.zoneRequestReason);

    var status = document.getElementById('memberAdminStatus');
    if (status) status.textContent = editMode ? 'Edit member details below.' : 'View member details and approve pending zone requests here.';

    var zoneBadge = document.getElementById('ma-zone-status');
    if (zoneBadge) {
      if (m.zoneRequestStatus === 'pending' && m.zoneRequest) {
        zoneBadge.textContent = 'Pending zone approval ready';
        zoneBadge.style.color = 'var(--yellow)';
        zoneBadge.style.border = '1px solid rgba(245,200,66,.35)';
        zoneBadge.style.background = 'rgba(245,200,66,.08)';
      } else {
        zoneBadge.textContent = m.zoneCurrent ? ('Current zone: ' + m.zoneCurrent) : 'No pending request';
        zoneBadge.style.color = 'var(--muted)';
        zoneBadge.style.border = '1px solid var(--border)';
        zoneBadge.style.background = 'rgba(255,255,255,.04)';
      }
    }

    var zoneReqView = document.getElementById('ma-zone-request-view');
    if (zoneReqView) zoneReqView.textContent = m.zoneRequest || '-';
    var zoneReasonView = document.getElementById('ma-zone-reason-view');
    if (zoneReasonView) zoneReasonView.textContent = m.zoneRequestReason || '-';

    _setMemberAdminFieldsDisabled(!editMode);

    var saveBtn = document.getElementById('ma-save-btn');
    if (saveBtn) saveBtn.style.display = editMode ? '' : 'none';

    var approveBtn = document.getElementById('ma-approve-btn');
    if (approveBtn) approveBtn.style.display = (hasAdminPerm('members') && m.zoneRequestStatus === 'pending' && m.zoneRequest) ? '' : 'none';

    var modal = document.getElementById('memberProfileAdminModal');
    if (modal) {
      try { document.body.classList.add('modal-lock'); } catch(_) {}
      modal.style.display = 'flex';
      modal.classList.add('show');
    }
  } catch (e) {
    console.error(e);
    showToast('', 'Open failed', 'Could not open member profile.');
  }
}


function closeMemberProfileAdmin() {
  var modal = document.getElementById('memberProfileAdminModal');
  if (modal) {
    modal.classList.remove('show');
    modal.style.display = 'none';
  }
  try { document.body.classList.remove('modal-lock'); } catch(_) {}
  _memberAdminCurrentId = '';
  _memberAdminEditMode = false;
}

async function saveMemberProfileAdmin() {
  if (!requireAdminPerm('members', 'member management')) return;
  try {
    if (!_memberAdminCurrentId) return;
    var m = members.find(function(x){ return x.id === _memberAdminCurrentId; });
    if (!m) return;

    var getVal = function(id){
      var el = document.getElementById(id);
      return el ? (el.value || '').trim() : '';
    };
    var adminDobRaw = getVal('ma-dob');
    var adminDobVal = _normalizeBirthDayMonth(adminDobRaw);
    if (adminDobRaw && adminDobVal === null) {
      showToast('', 'Invalid birth date', 'Use DD-MM format.');
      return;
    }

    var payload = {
      name: getVal('ma-name') || null,
      email: getVal('ma-email') || null,
      address: getVal('ma-address') || null,
      instrument: getVal('ma-instrument') || null,
      instagram: getVal('ma-instagram') || null,
      blood_group: getVal('ma-blood-group') || null,
      date_of_birth: adminDobVal || null,
      bio: getVal('ma-bio') || null,
      zone_current: getVal('ma-zone-current') || null
    };

    await dbPatch('members', _memberAdminCurrentId, payload);

    m.name = payload.name || '';
    m.email = payload.email || '';
    m.address = payload.address || '';
    m.instrument = payload.instrument || '';
    m.instagram = payload.instagram || '';
    m.bloodGroup = payload.blood_group || '';
    m.dob = payload.date_of_birth || '';
    m.bio = payload.bio || '';
    m.zoneCurrent = payload.zone_current || '';

    try { localStorage.setItem('ots_members_cache', JSON.stringify(members)); } catch(_){}
    renderMembersTable();
    try { loadLeaderboard(); } catch(_){}
    showToast('', 'Profile updated', 'Member profile changes saved.');
    closeMemberProfileAdmin();
  } catch (e) {
    console.error(e);
    showToast('', 'Save failed', e.message || 'Could not save member profile.');
  }
}

async function approveMemberZone(id) {
  if (!requireAdminPerm('members', 'member management')) return;
  try {
    var memberId = id || _memberAdminCurrentId;
    var m = members.find(function(x){ return x.id === memberId; });
    if (!m) {
      showToast('', 'Member not found', 'Could not approve zone.');
      return;
    }
    if (!(m.zoneRequestStatus === 'pending' && m.zoneRequest)) {
      showToast('', 'No pending request', 'This member has no pending zone request.');
      return;
    }

    var approvedZone = m.zoneRequest;
    await dbPatch('members', memberId, {
      zone_current: approvedZone,
      zone_request: '',
      zone_request_reason: '',
      zone_request_status: 'approved'
    });
    try {
      var mPhone = _normPhone(m.phone || '');
      if (mPhone) {
        await neonSQL(
          "UPDATE members SET zone_current=$1, zone_request='', zone_request_reason='', zone_request_status='approved' WHERE RIGHT(REGEXP_REPLACE(phone,'[^0-9]','','g'),10)=$2",
          [approvedZone, mPhone]
        );
      }
    } catch(_) {}

    m.zoneCurrent = approvedZone;
    m.zoneRequest = '';
    m.zoneRequestReason = '';
    m.zoneRequestStatus = 'approved';

    try { localStorage.setItem('ots_members_cache', JSON.stringify(members)); } catch(_){}
    renderMembersTable();
    try { loadLeaderboard(); } catch(_){}
    showToast('', 'Zone approved', (m.name || 'Member') + ' moved to ' + approvedZone + '.');
    notifyMemberUpdate({
      type: 'zone_approved',
      title: 'Zone approved',
      body: 'Your zone has been updated to ' + approvedZone + '.',
      memberId: m.id || '',
      name: m.name || '',
      phone: m.phone || '',
      email: m.email || '',
      zone: approvedZone
    });

    if (_memberAdminCurrentId === memberId) {
      openMemberProfileAdmin(memberId, false);
    }
  } catch (e) {
    console.error(e);
    showToast('', 'Approval failed', e.message || 'Could not approve zone.');
  }
}


function _openMemberProfileAdminNow(id, editMode) {
  try {
    if (typeof openMemberProfileAdmin === 'function') {
      openMemberProfileAdmin(id, editMode);
      var modal = document.getElementById('memberProfileAdminModal');
      if (modal) {
        try { document.body.classList.add('modal-lock'); } catch(_) {}
        modal.style.display = 'flex';
        modal.classList.add('show');
      }
      return true;
    }
  } catch (e) {
    console.error('openMemberProfileAdmin failed:', e);
  }
  return false;
}

document.addEventListener('click', function(ev){
  try {
    var btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
    if (!btn) return;
    var row = btn.closest('.members-tbl-row');
    if (!row) return;

    var text = (btn.textContent || '').trim().toLowerCase();
    if (text !== 'view' && text !== 'edit') return;

    var memberId = btn.getAttribute('data-member-id') || '';
    if (!memberId) {
      var body = document.getElementById('membersTableBody');
      if (!body) return;
      var idx = Array.from(body.querySelectorAll('.members-tbl-row')).indexOf(row);
      if (idx < 0 || !Array.isArray(members) || !members[idx]) return;
      memberId = members[idx].id;
    }
    if (!members.find(function(m){ return String(m.id) === String(memberId); })) return;

    ev.preventDefault();
    ev.stopPropagation();
    _openMemberProfileAdminNow(memberId, text === 'edit');
  } catch (e) {
    console.error('member button delegation failed:', e);
  }
}, true);


function _forceCloseMemberProfileAdmin() {
  try {
    var modal = document.getElementById('memberProfileAdminModal');
    if (modal) {
      modal.classList.remove('show');
      modal.style.display = 'none';
    }
    try { document.body.classList.remove('modal-lock'); } catch(_) {}
    _memberAdminCurrentId = '';
    _memberAdminEditMode = false;
  } catch(e) {
    console.error('close modal failed:', e);
  }
}

document.addEventListener('click', function(ev){
  try {
    var btn = ev.target && ev.target.closest ? ev.target.closest('button') : null;
    if (!btn) return;
    var txt = (btn.textContent || '').trim().toLowerCase();

    if (txt === 'close') {
      ev.preventDefault();
      ev.stopPropagation();
      _forceCloseMemberProfileAdmin();
      return;
    }

    if (txt.indexOf('approve zone') > -1) {
      ev.preventDefault();
      ev.stopPropagation();
      if (_memberAdminCurrentId) approveMemberZone(_memberAdminCurrentId);
      return;
    }
  } catch(e) {
    console.error('modal action delegation failed:', e);
  }
}, true);

document.addEventListener('click', function(ev){
  try {
    var overlay = document.getElementById('memberProfileAdminModal');
    if (!overlay || !overlay.classList.contains('show')) return;
    if (ev.target === overlay) {
      _forceCloseMemberProfileAdmin();
    }
  } catch(e){}
}, true);


// -- PROFILE COMPLETION WITH ADDRESS --
function calculateProfileCompletionWithAddress() {
  const fields = _profileCompletionFields();
  const filled = fields.filter(Boolean).length;
  return Math.round((filled / fields.length) * 100);
}
function updateProfileCompletionWithAddress() {
  try {
    const pct = calculateProfileCompletionWithAddress();
    ['profileCompletionPct','profileCompletionText','pf-completion-pct','pfCompletionPct'].forEach(function(id){
      const el = document.getElementById(id);
      if (el) el.textContent = pct + '%';
    });
    ['profileCompletionBar','pf-completion-bar','pfCompletionBar'].forEach(function(id){
      const el = document.getElementById(id);
      if (el) el.style.width = pct + '%';
    });
    document.querySelectorAll('[id*="completion"], .profile-completion, .completion-text').forEach(function(el){
      if ((el.textContent || '').includes('%')) el.textContent = pct + '%';
    });
    return pct;
  } catch(e) { return 0; }
}
try {
  window.getProfileCompletion = calculateProfileCompletionWithAddress;
  window.calculateProfileCompletion = calculateProfileCompletionWithAddress;
  const _oldUpdateProfileCompletion = window.updateProfileCompletion;
  window.updateProfileCompletion = function(){
    try { if (typeof _oldUpdateProfileCompletion === 'function') _oldUpdateProfileCompletion(); } catch(e){}
    return updateProfileCompletionWithAddress();
  };
} catch(e) {}
document.addEventListener('input', function(e){
  if (e.target && e.target.id === 'pf-address') {
    memberAddress = e.target.value || '';
    updateProfileCompletionWithAddress();
  }
}, true);
document.addEventListener('DOMContentLoaded', function(){
  setTimeout(updateProfileCompletionWithAddress, 400);
});


// -- Notification dismiss persistence --
var _dismissedNotifs = new Set(JSON.parse(localStorage.getItem('ots_dismissed_notifs')||'[]'));
function _saveDismissedNotifs(){
  try{ localStorage.setItem('ots_dismissed_notifs', JSON.stringify(Array.from(_dismissedNotifs))); }catch(e){}
}


// -- LIGHT FRONT-PAGE PHOTO SYNC FIX --
var _otsPhotoSyncTimer = null;
var _otsPhotoSyncBusy = false;

async function refreshFrontPagePhotosFromNeonLight() {
  if (_otsPhotoSyncBusy) return;
  if (typeof otsIsAdminApp === 'function' && otsIsAdminApp()) return;
  if (typeof memberLoggedIn !== 'undefined' && !memberLoggedIn) return;
  if (typeof _perfPhotoUploadBusy !== 'undefined' && _perfPhotoUploadBusy) return;
  if (typeof _perfPhotoLocalEditAt !== 'undefined' && Date.now() - _perfPhotoLocalEditAt < 5000) return;
  _otsPhotoSyncBusy = true;
  try {
    if (typeof neonSQL !== 'function') return;
    const perf = await neonSQL(
      "SELECT id,url,caption FROM gallery WHERE id LIKE 'perf_%' ORDER BY id DESC LIMIT " + Number(PERF_HOME_LIMIT || 18)
    );
    var remotePhotos = _filterDeletedPerfPhotos(perf.map(function(r){
      return { id: r.id, dataUrl: r.url || '', label: r.caption || '' };
    }));
    if (typeof mergePerfPhotoLists === 'function') {
      perfPhotos = mergePerfPhotoLists(perfPhotos, remotePhotos);
    } else {
      perfPhotos = remotePhotos;
    }
    cachePerfPhotoPreview();
    try { renderPerfStrip(); } catch(e) {}
    try { fastRenderPhotoManager(); } catch(e) {}
  } catch(e) {
    console.warn('Light photo sync failed:', e);
  } finally {
    _otsPhotoSyncBusy = false;
  }
}

function startLightPhotoSync() {
  try {
    if (_otsPhotoSyncTimer) clearInterval(_otsPhotoSyncTimer);
    _otsPhotoSyncTimer = setInterval(function(){
      try {
        var home = document.getElementById('page-home');
        var homeActive = home && home.classList.contains('active');
        if (homeActive) refreshFrontPagePhotosFromNeonLight();
      } catch(e) {}
    }, 15000);
  } catch(e) {}
}

document.addEventListener('visibilitychange', function(){
  if (!document.hidden) {
    setTimeout(function(){ try { refreshFrontPagePhotosFromNeonLight(); } catch(e){} }, 700);
  }
});

document.addEventListener('DOMContentLoaded', function(){
  setTimeout(function(){ try { refreshFrontPagePhotosFromNeonLight(); } catch(e){} }, 1200);
  startLightPhotoSync();
});


// home photo sync on enter
(function(){
  try {
    const _oldShowPagePhotoSync = window.showPage;
    if (typeof _oldShowPagePhotoSync === 'function') {
      window.showPage = function(page) {
        const res = _oldShowPagePhotoSync.apply(this, arguments);
        if (page === 'home') {
          setTimeout(function(){ try { refreshFrontPagePhotosFromNeonLight(); } catch(e){} }, 300);
        }
        return res;
      };
    }
  } catch(e) {}
})();


// -- FRONT-PAGE PHOTO DELETE PERSISTENCE FIX --
var _otsDeletedPhotoIds = new Set(JSON.parse(localStorage.getItem('ots_deleted_perf_photo_ids') || '[]'));
function _saveDeletedPerfPhotoIds() {
  try { localStorage.setItem('ots_deleted_perf_photo_ids', JSON.stringify(Array.from(_otsDeletedPhotoIds))); } catch(e) {}
}
function _markPerfPhotoDeleted(id) {
  if (!id) return;
  _otsDeletedPhotoIds.add(String(id));
  _saveDeletedPerfPhotoIds();
}
function _filterDeletedPerfPhotos(list) {
  return (list || []).filter(function(p){
    return p && p.id && !_otsDeletedPhotoIds.has(String(p.id));
  });
}

// No global photo-delete click handler here. The only allowed backend delete is
// the explicit Remove button calling deletePhoto(id) from the photo manager.


// -- STRICT PROFILE COMPLETION: ADDRESS + APPROVED ZONE REQUIRED --
function _otsProfileFieldValue(id) {
  var el = document.getElementById(id);
  return el ? (el.value || '').trim() : '';
}
function _otsApprovedZoneValue() {
  var z =
    (typeof memberZoneCurrent !== 'undefined' && memberZoneCurrent) ||
    (typeof memberZone !== 'undefined' && memberZone) ||
    _otsProfileFieldValue('pf-zone-current') ||
    _otsProfileFieldValue('pf-zone') ||
    _otsProfileFieldValue('pf-zone-approved') ||
    '';
  z = String(z || '').trim();
  if (!z || /pending|request|select|choose/i.test(z)) return '';
  return z;
}
function calculateProfileCompletionStrict() {
  var address =
    (typeof memberAddress !== 'undefined' && memberAddress) ||
    _otsProfileFieldValue('pf-address') ||
    localStorage.getItem('member_address') ||
    '';

  var zone = _otsApprovedZoneValue();

  var fields = [
    (typeof memberName !== 'undefined' ? memberName : '') || _otsProfileFieldValue('pf-name'),
    (typeof memberEmail !== 'undefined' ? memberEmail : '') || _otsProfileFieldValue('pf-email'),
    (typeof memberBio !== 'undefined' ? memberBio : '') || _otsProfileFieldValue('pf-bio'),
    (typeof memberInstrument !== 'undefined' ? memberInstrument : '') || _otsProfileFieldValue('pf-instrument'),
    (typeof memberBloodGroup !== 'undefined' ? memberBloodGroup : '') || _otsProfileFieldValue('pf-blood-group'),
    (typeof memberDob !== 'undefined' ? memberDob : '') || _otsProfileFieldValue('pf-dob'),
    address,
    zone,
    (typeof memberAvatarUrl !== 'undefined' ? memberAvatarUrl : ''),
    (typeof memberIdProofUrl !== 'undefined' ? memberIdProofUrl : '')
  ];

  var filled = fields.filter(function(v){ return String(v || '').trim().length > 0; }).length;
  return Math.round((filled / fields.length) * 100);
}
function updateProfileCompletionStrict() {
  try {
    var pct = calculateProfileCompletionStrict();

    ['profileCompletionPct','profileCompletionText','pf-completion-pct','pfCompletionPct'].forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.textContent = pct + '%';
    });
    ['profileCompletionBar','pf-completion-bar','pfCompletionBar'].forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.style.width = pct + '%';
    });
    document.querySelectorAll('[id*="Completion"],[id*="completion"],.profile-completion,.completion-text').forEach(function(el){
      var txt = el.textContent || '';
      if (txt.indexOf('%') > -1 && txt.length < 80) el.textContent = pct + '%';
    });

    return pct;
  } catch(e) {
    console.warn('Strict profile completion failed:', e);
    return 0;
  }
}
try {
  window.getProfileCompletion = calculateProfileCompletionStrict;
  window.calculateProfileCompletion = calculateProfileCompletionStrict;
  window.calculateProfileCompletionWithAddress = calculateProfileCompletionStrict;
  window.updateProfileCompletionWithAddress = updateProfileCompletionStrict;
  window.updateProfileCompletion = updateProfileCompletionStrict;
} catch(e) {}

document.addEventListener('input', function(e){
  if (e.target && (e.target.id === 'pf-address' || e.target.id === 'pf-zone' || e.target.id === 'pf-zone-current')) {
    try {
      if (e.target.id === 'pf-address') {
        memberAddress = e.target.value || '';
        localStorage.setItem('member_address', memberAddress);
      }
      if (e.target.id === 'pf-zone') _updateZoneReasonVisibility();
    } catch(_) {}
    setTimeout(updateProfileCompletionStrict, 50);
  }
}, true);
document.addEventListener('change', function(e){
  if (e.target && e.target.id === 'pf-zone') {
    try { _updateZoneReasonVisibility(); } catch(_) {}
    setTimeout(updateProfileCompletionStrict, 50);
  }
}, true);

document.addEventListener('DOMContentLoaded', function(){
  setTimeout(updateProfileCompletionStrict, 500);
  setTimeout(updateProfileCompletionStrict, 1800);
});
document.addEventListener('visibilitychange', function(){
  if (!document.hidden) setTimeout(updateProfileCompletionStrict, 300);
});


// profile completion refresh on profile open
(function(){
  try {
    var _oldShowPageProfileStrict = window.showPage;
    if (typeof _oldShowPageProfileStrict === 'function') {
      window.showPage = function(page) {
        var res = _oldShowPageProfileStrict.apply(this, arguments);
        if (page === 'profile') {
          setTimeout(function(){ try { updateProfileCompletionStrict(); } catch(e){} }, 250);
          setTimeout(function(){ try { updateProfileCompletionStrict(); } catch(e){} }, 1200);
        }
        return res;
      };
    }
  } catch(e){}
})();


// -- FAST HOME + NAV PATCH FOR WEB/GITHUB --
(function(){
  function _fastShowTopNavNow() {
    try {
      var mlp = document.getElementById('memberLoginPage');
      if (memberLoggedIn || document.documentElement.hasAttribute('data-member-active')) {
        if (mlp) mlp.classList.add('hidden');

        // Common member logout/profile/bell IDs used across versions
        ['memberLogoutBtn','notifBell','profileBtn','memberProfileBtn','memberProfileChip','memberNavProfile','memberBellBtn'].forEach(function(id){
          var el = document.getElementById(id);
          if (el) {
            el.style.display = '';
            el.classList.add('show');
          }
        });

        try { if (typeof updateMemberNavUI === 'function') updateMemberNavUI(); } catch(e){}
        try { if (typeof updateNotifBadge === 'function') updateNotifBadge(); } catch(e){}
      }

      if (adminLoggedIn || document.documentElement.hasAttribute('data-admin-active')) {
        if (mlp) mlp.classList.add('hidden');
        ['logoutBtn','adminPanelBtn','adminNotifBtn'].forEach(function(id){
          var el = document.getElementById(id);
          if (el) {
            el.style.display = '';
            el.classList.add('show');
          }
        });
        try { if (typeof updatePendingBadge === 'function') updatePendingBadge(); } catch(e){}
      }
    } catch(e){}
  }

  function _fastRenderHomeNow() {
    try {
      var home = document.getElementById('page-home');
      var active = document.querySelector('.page.active');
      if (!active && home) home.classList.add('active');

      // Render already-available cached data immediately
      try { if (typeof renderGigCalendar === 'function') renderGigCalendar(); } catch(e){}
      try { if (typeof renderPerfStrip === 'function') renderPerfStrip(); } catch(e){}
      try { if (typeof renderUserBookings === 'function') renderUserBookings(); } catch(e){}
      _fastShowTopNavNow();

      // Defer remote/live loads so the visible page and logout are not blocked
      setTimeout(function(){
        try { if (typeof loadData === 'function') loadData(); } catch(e){}
      }, 350);
      setTimeout(function(){
        try { if (typeof loadPerfPhotos === 'function') loadPerfPhotos(); } catch(e){}
        try { if (typeof refreshFrontPagePhotosFromNeonLight === 'function') refreshFrontPagePhotosFromNeonLight(); } catch(e){}
      }, 900);
    } catch(e){}
  }

  // Wrap showPage so Home/top nav renders first, DB after
  try {
    var _oldShowPageFastHome = window.showPage;
    if (typeof _oldShowPageFastHome === 'function') {
      window.showPage = function(page) {
        var res = _oldShowPageFastHome.apply(this, arguments);
        _fastShowTopNavNow();
        if (page === 'home') {
          setTimeout(_fastRenderHomeNow, 20);
        }
        return res;
      };
    }
  } catch(e){}

  // Run multiple quick passes; goal is visible UI within ~3 sec even if Neon is slow
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){
      _fastShowTopNavNow();
      setTimeout(_fastRenderHomeNow, 80);
      setTimeout(_fastShowTopNavNow, 500);
      setTimeout(_fastShowTopNavNow, 1500);
      setTimeout(_fastShowTopNavNow, 2800);
    });
  } else {
    _fastShowTopNavNow();
    setTimeout(_fastRenderHomeNow, 80);
    setTimeout(_fastShowTopNavNow, 500);
    setTimeout(_fastShowTopNavNow, 1500);
    setTimeout(_fastShowTopNavNow, 2800);
  }

  document.addEventListener('visibilitychange', function(){
    if (!document.hidden) {
      setTimeout(_fastShowTopNavNow, 80);
      setTimeout(_fastRenderHomeNow, 250);
    }
  });
})();


// Clerk login removed: backend OTP login is active.
