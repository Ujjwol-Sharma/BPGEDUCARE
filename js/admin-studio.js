/* ==========================================================================
   BPG EDUCARE — SIMPLIFIED ADMIN PANEL (js/admin-studio.js)
   - 4 Class Sections (Class 12, Class 11, Class 10, Entrance Prep)
   - Subject picker + Syllabus-ordered Lessons
   - Per-lesson inline "Upload PDF" (auto first-page cover) & "Add Video" (thumbnail upload + preview + replace)
   - Inline management of existing uploads directly under each lesson row
   ========================================================================== */

const ADMIN_PASSKEY_STORAGE_KEY = 'bpg_admin_passkey_session';
let ADMIN_STUDIO_TOKEN = '';
try {
    ADMIN_STUDIO_TOKEN = sessionStorage.getItem(ADMIN_PASSKEY_STORAGE_KEY) || '';
} catch (e) {}

const SECTION_META = [
    { key: 'class-12', label: 'Class 12', sub: 'Grade XII' },
    { key: 'class-11', label: 'Class 11', sub: 'Grade XI' },
    { key: 'class-10', label: 'Class 10', sub: 'SEE Foundation' },
    { key: 'after-12', label: 'Entrance Prep', sub: 'IOE / CEE / KU' }
];

let ADMIN_STATE = null;
let ADMIN_ROSTER = { accounts: [], duplicateGroups: [], classSwitchRequests: [] };
let ADMIN_MOCK_TESTS = [];
let ADMIN_PAYMENTS = [];
let activeContentClass = 'class-12';
let activeSubjectByClass = {};
let activeMockClass = 'class-12';
let activeMockSubjectByClass = {};
let editingMockTest = null; // { id, classKey, subjectId, title, durationMinutes, minPlan, status, questions: [] }
let showTimeLimitEditor = false;
let adminMockPreviewState = null; // { test, index, answers, remainingSec, timerId, submitted }
let editingZoomClass = null;
let editingTeamMember = null;
let pendingTeamPhotoDataUrl = '';
let renamingLessonKey = ''; // `${classKey}|${subjectId}|${lessonId}`
let renamingUnitKey = '';   // `${classKey}|${unitIdx}`
let pendingSafeDelete = null;
let openLessonForms = {}; // key: `${classKey}|${subjectId}|${lessonId}` -> 'pdf' | 'video'
let pendingVideoThumbDataUrl = {}; // formPrefix -> base64 image data URL
let activePreviewTier = 'free';
let selectedPlanItemKeys = new Set();
let saveIndicatorTimer = null;

/* --------------------------------------------------------------------------
   1. SHARED LIGHT / DARK THEME TOGGLE
   -------------------------------------------------------------------------- */
function applyAdminTheme(theme) {
    const resolved = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', resolved);
    document.body.setAttribute('data-theme', resolved);
    try { localStorage.setItem('bpg_theme', resolved); } catch (e) {}

    const iconHtml = resolved === 'dark'
        ? '<i class="fa-solid fa-sun" aria-hidden="true"></i>'
        : '<i class="fa-solid fa-moon" aria-hidden="true"></i>';
    const title = resolved === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';

    ['adminThemeToggleBtn', 'loginThemeToggleBtn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.innerHTML = iconHtml;
            btn.setAttribute('title', title);
            btn.setAttribute('aria-label', title);
        }
    });
}

function toggleAdminTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyAdminTheme(current === 'dark' ? 'light' : 'dark');
}

/* --------------------------------------------------------------------------
   2. AUTH, HELPERS & SERVER PERSISTENCE
   -------------------------------------------------------------------------- */
function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getAdminHeaders() {
    return {
        'Content-Type': 'application/json',
        'x-admin-passkey': ADMIN_STUDIO_TOKEN
    };
}

function setSaveStatus(text, isSaved = false) {
    const el = document.getElementById('adminSaveIndicator');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-saved', isSaved);
    clearTimeout(saveIndicatorTimer);
    if (isSaved) {
        saveIndicatorTimer = setTimeout(() => {
            el.classList.remove('is-saved');
            el.textContent = 'All changes saved';
        }, 2800);
    }
}

function showAdminToast(message, type = 'info') {
    const mount = document.getElementById('adminToastContainer');
    if (!mount) return;
    const div = document.createElement('div');
    div.className = `adm-toast ${type}`;
    div.textContent = message;
    mount.appendChild(div);
    setTimeout(() => div.remove(), 3200);
}

function broadcastUpdate(type = 'DATA_UPDATED') {
    const payload = { type, timestamp: Date.now() };
    try {
        if ('BroadcastChannel' in window) {
            const ch1 = new BroadcastChannel('bpg_academy_sync');
            ch1.postMessage(payload);
            ch1.close();
            const ch2 = new BroadcastChannel('bpg_maths_academy_live_sync');
            ch2.postMessage(payload);
            ch2.close();
        }
    } catch (e) {}
    try {
        localStorage.setItem('bpg_live_mutation_ping', JSON.stringify(payload));
    } catch (e) {}
}

let adminLastSyncVersion = '';
let adminRealtimePollTimer = null;
let adminRealtimeSyncInFlight = false;

function updateAdminLiveSyncBadge(label = 'Live Sync · Active') {
    const el = document.getElementById('adminLiveSyncBadge');
    if (el) el.textContent = label;
}

function isAdminTypingInUsersOrPayments() {
    const active = document.activeElement;
    if (!active) return false;
    const tag = (active.tagName || '').toUpperCase();
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return false;
    if (active.id === 'userSearchInput') return false; // Search input value is preserved across renderUsersTab
    return Boolean(active.closest('#pane-users, #pane-payments, #pane-switches'));
}

async function pollAdminLiveUpdates(forceRender = false) {
    if (!ADMIN_STUDIO_TOKEN || adminRealtimeSyncInFlight) return;
    adminRealtimeSyncInFlight = true;
    try {
        const res = await fetch('/api/academy-state?light=1&_t=' + Date.now(), {
            cache: 'no-store',
            headers: { 'x-admin-passkey': ADMIN_STUDIO_TOKEN }
        });
        if (!res.ok) return;
        const json = await res.json();
        if (!json || !json.success) return;

        const nextVer = String(json.syncVersion || '');
        const changed = forceRender || (nextVer && nextVer !== adminLastSyncVersion);
        if (!changed) return;

        adminLastSyncVersion = nextVer;
        if (json.roster) ADMIN_ROSTER = json.roster;
        if (Array.isArray(json.payments)) ADMIN_PAYMENTS = json.payments;
        if (ADMIN_STATE) {
            if (json.sectionLocks) ADMIN_STATE.sectionLocks = json.sectionLocks;
            if (json.plansConfig) ADMIN_STATE.plansConfig = json.plansConfig;
            if (json.maintenanceMode) ADMIN_STATE.maintenanceMode = json.maintenanceMode;
        }

        const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        updateAdminLiveSyncBadge(`Live Sync · ${timeLabel}`);

        if (!isAdminTypingInUsersOrPayments()) {
            const searchEl = document.getElementById('userSearchInput');
            const hadSearchFocus = document.activeElement === searchEl;
            const selStart = hadSearchFocus ? searchEl.selectionStart : null;
            const selEnd = hadSearchFocus ? searchEl.selectionEnd : null;

            renderUsersTab();
            renderSwitchRequestsTab();
            renderPaymentsTab();

            if (hadSearchFocus && searchEl) {
                searchEl.focus();
                try { searchEl.setSelectionRange(selStart, selEnd); } catch (e) {}
            }
        }
    } catch (e) {
    } finally {
        adminRealtimeSyncInFlight = false;
    }
}

function startAdminRealtimeSync() {
    if (adminRealtimePollTimer) clearInterval(adminRealtimePollTimer);
    adminRealtimePollTimer = setInterval(() => {
        if (document.visibilityState === 'hidden') return;
        pollAdminLiveUpdates(false);
    }, 1500);

    try {
        if ('BroadcastChannel' in window && !window.__BPG_ADMIN_BC_ATTACHED__) {
            window.__BPG_ADMIN_BC_ATTACHED__ = true;
            const onMsg = (ev) => {
                if (!ev.data) return;
                pollAdminLiveUpdates(true);
            };
            const ch1 = new BroadcastChannel('bpg_academy_sync');
            ch1.onmessage = onMsg;
            const ch2 = new BroadcastChannel('bpg_maths_academy_live_sync');
            ch2.onmessage = onMsg;
        }
    } catch (e) {}

    if (!window.__BPG_ADMIN_STORAGE_ATTACHED__) {
        window.__BPG_ADMIN_STORAGE_ATTACHED__ = true;
        window.addEventListener('storage', (ev) => {
            if (ev.key === 'bpg_live_mutation_ping' && ev.newValue) {
                pollAdminLiveUpdates(true);
            }
        });
        window.addEventListener('focus', () => {
            pollAdminLiveUpdates(false);
        });
    }
}

async function verifyAdminPasskeyWithServer(candidatePasskey) {
    if (!candidatePasskey) return false;
    try {
        const res = await fetch('/api/academy-state?verifyAdmin=1&_t=' + Date.now(), {
            cache: 'no-store',
            headers: { 'x-admin-passkey': candidatePasskey }
        });
        if (!res.ok) return false;
        const json = await res.json();
        return Boolean(json && json.success && json.isAdmin === true);
    } catch (e) {
        return false;
    }
}

async function handleAdminLogin(event) {
    if (event) event.preventDefault();
    const input = document.getElementById('adminPasskeyInput');
    const errEl = document.getElementById('adminLoginError');
    const btn = document.getElementById('adminLoginSubmitBtn');
    const candidate = (input?.value || '').trim();

    if (errEl) {
        errEl.style.display = 'none';
        errEl.textContent = '';
    }
    if (!candidate) return;

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>Verifying...</span>';
    }

    const ok = await verifyAdminPasskeyWithServer(candidate);

    if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-unlock-keyhole" aria-hidden="true"></i><span>Unlock Admin Console</span>';
    }

    if (!ok) {
        if (errEl) {
            errEl.textContent = 'Invalid master admin passkey. Access denied.';
            errEl.style.display = 'block';
        }
        if (input) {
            input.value = '';
            input.focus();
        }
        return;
    }

    ADMIN_STUDIO_TOKEN = candidate;
    try {
        sessionStorage.setItem(ADMIN_PASSKEY_STORAGE_KEY, candidate);
    } catch (e) {}
    if (input) input.value = '';
    await openAdminShell();
}

function lockAdminSession() {
    ADMIN_STUDIO_TOKEN = '';
    ADMIN_STATE = null;
    try {
        sessionStorage.removeItem(ADMIN_PASSKEY_STORAGE_KEY);
    } catch (e) {}
    const shell = document.getElementById('adminShell');
    if (shell) shell.style.display = 'none';
    const splash = document.getElementById('adminLoginSplash');
    if (splash) {
        splash.classList.remove('hidden');
        splash.style.display = 'flex';
    }
    const input = document.getElementById('adminPasskeyInput');
    if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 50);
    }
}

async function initAdminAuthGate() {
    if (ADMIN_STUDIO_TOKEN) {
        const valid = await verifyAdminPasskeyWithServer(ADMIN_STUDIO_TOKEN);
        if (valid) {
            await openAdminShell();
            return;
        }
    }
    lockAdminSession();
}

async function openAdminShell() {
    const splash = document.getElementById('adminLoginSplash');
    if (splash) {
        splash.classList.add('hidden');
        splash.style.display = 'none';
    }
    const shell = document.getElementById('adminShell');
    if (shell) shell.style.display = 'flex';
    await loadAdminData();
    startAdminRealtimeSync();
}

async function loadAdminData() {
    setSaveStatus('Loading...');
    try {
        // Single unified request prevents concurrent multi-container Lambda spawns on Vercel
        const stateRes = await fetch('/api/academy-state?_t=' + Date.now(), {
            cache: 'no-store',
            headers: { 'x-admin-passkey': ADMIN_STUDIO_TOKEN }
        });

        const stateJson = await stateRes.json();

        if (stateJson?.syncVersion) adminLastSyncVersion = String(stateJson.syncVersion);
        if (stateJson?.data) ADMIN_STATE = stateJson.data;
        if (stateJson?.roster) {
            ADMIN_ROSTER = stateJson.roster;
        } else {
            const rosterRes = await fetch('/api/student-roster?_t=' + Date.now(), {
                cache: 'no-store',
                headers: { 'x-admin-passkey': ADMIN_STUDIO_TOKEN }
            });
            const rosterJson = await rosterRes.json().catch(() => ({}));
            if (rosterJson?.data) ADMIN_ROSTER = rosterJson.data;
        }
        if (Array.isArray(stateJson?.mockTests)) ADMIN_MOCK_TESTS = stateJson.mockTests;
        else if (Array.isArray(ADMIN_STATE?.mockTests)) ADMIN_MOCK_TESTS = ADMIN_STATE.mockTests;

        if (Array.isArray(stateJson?.payments)) ADMIN_PAYMENTS = stateJson.payments;
        else if (Array.isArray(ADMIN_STATE?.payments)) ADMIN_PAYMENTS = ADMIN_STATE.payments;

        setSaveStatus('All changes saved');
        const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        updateAdminLiveSyncBadge(`Live Sync · ${timeLabel}`);
        renderAllAdminTabs();
    } catch (err) {
        setSaveStatus('Offline');
        showAdminToast('Could not load data from server.', 'error');
    }
}

async function persistAcademyState(partialPayload, successMsg = 'Saved') {
    setSaveStatus('Saving...');
    try {
        const res = await fetch('/api/academy-state', {
            method: 'POST',
            headers: getAdminHeaders(),
            body: JSON.stringify(partialPayload)
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
            throw new Error(json.error || 'Save failed');
        }
        ADMIN_STATE = json.data;
        setSaveStatus('Saved', true);
        showAdminToast(successMsg);
        broadcastUpdate('DATA_UPDATED');
        renderAllAdminTabs();
        return true;
    } catch (err) {
        setSaveStatus('Save error');
        showAdminToast(err.message || 'Could not save changes.', 'error');
        return false;
    }
}

function switchAdminTab(tabName) {
    ['users', 'switches', 'payments', 'content', 'mocktests', 'zoom', 'notifications', 'homepage', 'team', 'faqs', 'sections', 'plans'].forEach(t => {
        document.getElementById(`tabBtn-${t}`)?.classList.toggle('active', t === tabName);
        document.getElementById(`pane-${t}`)?.classList.toggle('active', t === tabName);
    });
    if (tabName === 'users') renderUsersTab();
    if (tabName === 'switches') renderSwitchRequestsTab();
    if (tabName === 'payments') renderPaymentsTab();
    if (tabName === 'content') renderContentTab();
    if (tabName === 'mocktests') renderMockTestsTab();
    if (tabName === 'zoom') renderZoomClassesTab();
    if (tabName === 'notifications') renderNotificationsTab();
    if (tabName === 'homepage') renderHomepageEditorTab();
    if (tabName === 'team') renderTeamTab();
    if (tabName === 'faqs') renderFaqsTab();
    if (tabName === 'sections') renderSectionAccessTab();
    if (tabName === 'plans') renderPlansTab();
}

function renderAllAdminTabs() {
    renderUsersTab();
    renderSwitchRequestsTab();
    renderPaymentsTab();
    renderContentTab();
    renderMockTestsTab();
    renderZoomClassesTab();
    renderNotificationsTab();
    renderHomepageEditorTab();
    renderTeamTab();
    renderFaqsTab();
    renderSectionAccessTab();
    renderPlansTab();
}

/* --------------------------------------------------------------------------
   3. TAB 1: USERS (UNIFIED STUDENT DETAILS, PAID ANALYTICS & PAYMENTS)
   -------------------------------------------------------------------------- */
function parseNumericAmount(rawAmount) {
    if (!rawAmount) return 0;
    const match = String(rawAmount).replace(/,/g, '').match(/\d+(\.\d+)?/);
    if (!match) return 0;
    const val = parseFloat(match[0]);
    return Number.isFinite(val) ? val : 0;
}

function getPaymentsForEmail(email, userId = '') {
    const target = String(email || '').trim().toLowerCase();
    const list = Array.isArray(ADMIN_PAYMENTS) ? ADMIN_PAYMENTS : [];
    return list.filter(p => {
        if (userId && p.userId && p.userId === userId) return true;
        return target && String(p.email || '').trim().toLowerCase() === target;
    });
}

function normalizeAdminPayStatus(status) {
    const s = String(status || '').trim().toLowerCase();
    if (s === 'paid' || s === 'verified' || s === 'complete') return 'paid';
    if (s === 'awaiting_confirmation' || s === 'awaiting') return 'awaiting_confirmation';
    if (s === 'failed' || s === 'rejected') return 'failed';
    if (s === 'refunded') return 'refunded';
    return 'pending';
}

function formatAdminPayStatusPill(status, extraText = '') {
    const norm = normalizeAdminPayStatus(status);
    const suffix = extraText ? ` &middot; ${escapeHtml(extraText)}` : '';
    if (norm === 'paid') {
        return `<span class="adm-status-pill open" style="font-size:0.72rem;">PAID${suffix}</span>`;
    }
    if (norm === 'awaiting_confirmation') {
        return `<span class="adm-status-pill" style="background:rgba(217,119,6,0.14); color:#d97706; font-size:0.72rem;">AWAITING CONFIRMATION${suffix}</span>`;
    }
    if (norm === 'failed') {
        return `<span class="adm-status-pill locked" style="font-size:0.72rem;">FAILED${suffix}</span>`;
    }
    if (norm === 'refunded') {
        return `<span class="adm-status-pill" style="background:rgba(99,102,241,0.14); color:#4f46e5; font-size:0.72rem;">REFUNDED${suffix}</span>`;
    }
    return `<span class="adm-status-pill" style="background:rgba(245,158,11,0.14); color:#b45309; font-size:0.72rem;">PENDING${suffix}</span>`;
}

function formatRelativeOrLocalTime(isoStr) {
    if (!isoStr) return '—';
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return escapeHtml(isoStr);
    const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diffSec >= 0 && diffSec < 60) return `${diffSec}s ago`;
    if (diffSec >= 60 && diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function setUsersQuickFilter(planFilter, classFilter = 'all') {
    const planEl = document.getElementById('userPlanFilterSelect');
    const classEl = document.getElementById('userClassFilterSelect');
    if (planEl && planFilter) planEl.value = planFilter;
    if (classEl && classFilter) classEl.value = classFilter;
    renderUsersTab();
}

function renderUsersTab() {
    const tbody = document.getElementById('usersTableBody');
    const dupBanner = document.getElementById('duplicateGmailReviewBanner');
    const statsMount = document.getElementById('studentsOverviewStatsMount');
    const countBar = document.getElementById('usersFilterCountBar');
    if (!tbody) return;

    const accounts = ADMIN_ROSTER.accounts || [];
    const dupGroups = ADMIN_ROSTER.duplicateGroups || [];
    const payments = Array.isArray(ADMIN_PAYMENTS) ? ADMIN_PAYMENTS : [];

    // Compute unified student & payment statistics
    const totalStudents = accounts.length;
    const goldStudents = accounts.filter(a => (a.plan || 'free').toLowerCase() === 'gold').length;
    const diamondStudents = accounts.filter(a => (a.plan || 'free').toLowerCase() === 'diamond').length;
    const totalPaidStudents = goldStudents + diamondStudents;
    const freeStudents = totalStudents - totalPaidStudents;

    const verifiedPayments = payments.filter(p => normalizeAdminPayStatus(p.status) === 'paid');
    const pendingPayments = payments.filter(p => {
        const st = normalizeAdminPayStatus(p.status);
        return st === 'pending' || st === 'awaiting_confirmation';
    });
    const totalVerifiedRevenue = verifiedPayments.reduce((sum, p) => sum + parseNumericAmount(p.amount), 0);

    const c12Count = accounts.filter(a => a.classKey === 'class-12').length;
    const c11Count = accounts.filter(a => a.classKey === 'class-11').length;
    const c10Count = accounts.filter(a => a.classKey === 'class-10').length;
    const entCount = accounts.filter(a => a.classKey === 'after-12').length;

    if (statsMount) {
        statsMount.innerHTML = `
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(215px, 1fr)); gap:12px;">
                <div class="adm-card" style="margin:0; padding:16px 18px; cursor:pointer;" onclick="setUsersQuickFilter('all', 'all')" title="Click to view all students">
                    <div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--adm-text-muted);">Total Registered Students</div>
                    <div style="font-size:1.75rem; font-weight:700; margin:4px 0; color:var(--adm-text);">${totalStudents}</div>
                    <div style="font-size:0.8rem; color:var(--adm-text-muted);">
                        ${totalPaidStudents} Paid &middot; ${freeStudents} Free
                    </div>
                </div>

                <div class="adm-card" style="margin:0; padding:16px 18px; cursor:pointer; border-color:rgba(22,163,74,0.35);" onclick="setUsersQuickFilter('paid', 'all')" title="Click to filter Paid Students only">
                    <div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#16a34a;">Total Paid Students</div>
                    <div style="font-size:1.75rem; font-weight:700; margin:4px 0; color:#16a34a;">${totalPaidStudents}</div>
                    <div style="font-size:0.8rem; color:var(--adm-text-muted);">
                        <strong>${goldStudents}</strong> Gold &middot; <strong>${diamondStudents}</strong> Diamond
                    </div>
                </div>

                <div class="adm-card" style="margin:0; padding:16px 18px; cursor:pointer;" onclick="setUsersQuickFilter('${pendingPayments.length > 0 ? 'pending_payment' : 'paid'}', 'all')" title="Click to filter by payment status">
                    <div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--adm-text-muted);">Verified Payments &amp; Revenue</div>
                    <div style="font-size:1.55rem; font-weight:700; margin:4px 0; color:var(--adm-text);">Rs. ${totalVerifiedRevenue.toLocaleString()}</div>
                    <div style="font-size:0.8rem; color:var(--adm-text-muted);">
                        ${verifiedPayments.length} Verified &middot; <span style="color:${pendingPayments.length > 0 ? '#d97706' : 'inherit'}; font-weight:${pendingPayments.length > 0 ? '700' : '400'};">${pendingPayments.length} Pending</span>
                    </div>
                </div>

                <div class="adm-card" style="margin:0; padding:16px 18px;">
                    <div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--adm-text-muted);">Students By Class</div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:4px 10px; margin-top:8px; font-size:0.82rem;">
                        <a href="#c12" onclick="setUsersQuickFilter('all','class-12'); return false;" style="color:var(--adm-text); text-decoration:none;">Class 12: <strong>${c12Count}</strong></a>
                        <a href="#c11" onclick="setUsersQuickFilter('all','class-11'); return false;" style="color:var(--adm-text); text-decoration:none;">Class 11: <strong>${c11Count}</strong></a>
                        <a href="#c10" onclick="setUsersQuickFilter('all','class-10'); return false;" style="color:var(--adm-text); text-decoration:none;">Class 10: <strong>${c10Count}</strong></a>
                        <a href="#ent" onclick="setUsersQuickFilter('all','after-12'); return false;" style="color:var(--adm-text); text-decoration:none;">Entrance: <strong>${entCount}</strong></a>
                    </div>
                </div>
            </div>
        `;
    }

    if (dupBanner) {
        if (dupGroups.length > 0) {
            dupBanner.style.display = 'block';
            dupBanner.innerHTML = `
                <strong>Duplicate Gmail Accounts Flagged for Review (${dupGroups.length})</strong>
                <p style="margin:4px 0 0;">Existing accounts were preserved: ${dupGroups.map(g => `<code>${escapeHtml(g.canonicalEmail)}</code> (${g.emails.map(escapeHtml).join(', ')})`).join(' &middot; ')}</p>
            `;
        } else {
            dupBanner.style.display = 'none';
        }
    }

    const q = (document.getElementById('userSearchInput')?.value || '').trim().toLowerCase();
    const planFilter = (document.getElementById('userPlanFilterSelect')?.value || 'all').toLowerCase();
    const classFilter = (document.getElementById('userClassFilterSelect')?.value || 'all').toLowerCase();

    const filtered = accounts.filter(acc => {
        const plan = (acc.plan || 'free').toLowerCase();
        const userPayments = getPaymentsForEmail(acc.email, acc.userId);
        const hasPendingPay = userPayments.some(p => {
            const st = normalizeAdminPayStatus(p.status);
            return st === 'pending' || st === 'awaiting_confirmation';
        });

        if (planFilter === 'paid' && plan !== 'gold' && plan !== 'diamond') return false;
        if (planFilter === 'gold' && plan !== 'gold') return false;
        if (planFilter === 'diamond' && plan !== 'diamond') return false;
        if (planFilter === 'free' && plan !== 'free') return false;
        if (planFilter === 'pending_payment' && !hasPendingPay) return false;

        if (classFilter !== 'all' && acc.classKey !== classFilter) return false;

        if (!q) return true;
        const txnMatch = userPayments.some(p =>
            String(p.transactionId || '').toLowerCase().includes(q) ||
            String(p.orderId || '').toLowerCase().includes(q)
        );
        return (acc.name || '').toLowerCase().includes(q)
            || (acc.email || '').toLowerCase().includes(q)
            || (acc.username || '').toLowerCase().includes(q)
            || (acc.userId || '').toLowerCase().includes(q)
            || (acc.canonicalEmail || '').toLowerCase().includes(q)
            || txnMatch;
    });

    if (countBar) {
        countBar.innerHTML = `Showing <strong>${filtered.length}</strong> of <strong>${totalStudents}</strong> students (${totalPaidStudents} paid: ${goldStudents} Gold, ${diamondStudents} Diamond &middot; ${freeStudents} Free)`;
    }

    renderRecentAuditLogCard();

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:28px; color:var(--adm-text-muted);">No matching students found for the selected filter.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(acc => {
        const emailEsc = escapeHtml(acc.email);
        const plan = (acc.plan || 'free').toLowerCase();
        const isPaidPlan = plan === 'gold' || plan === 'diamond';
        const accountStatus = (acc.accountStatus || 'active').toLowerCase();
        const userPayments = getPaymentsForEmail(acc.email, acc.userId);
        const latestVerifiedPay = userPayments.find(p => normalizeAdminPayStatus(p.status) === 'paid');
        const latestPendingPay = userPayments.find(p => {
            const st = normalizeAdminPayStatus(p.status);
            return st === 'pending' || st === 'awaiting_confirmation';
        });
        const latestPay = latestPendingPay || latestVerifiedPay || userPayments[0] || null;

        let paymentCellHtml = '';
        if (latestPendingPay) {
            const normSt = normalizeAdminPayStatus(latestPendingPay.status);
            paymentCellHtml = `
                <div style="display:flex; flex-direction:column; gap:4px;">
                    ${formatAdminPayStatusPill(normSt, `${latestPendingPay.planName || ''} (${latestPendingPay.amount || ''})`)}
                    <small style="color:var(--adm-text-muted);">Order: <code>${escapeHtml(latestPendingPay.orderId || latestPendingPay.id)}</code> &middot; Txn: <code>${escapeHtml(latestPendingPay.transactionId || 'N/A')}</code></small>
                    <div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:2px;">
                        <button type="button" class="btn-adm-dark" style="padding:3px 8px; font-size:0.72rem;" onclick="handleAdminPaymentDecision('${escapeHtml(latestPendingPay.id)}', true)">Verify &amp; Activate</button>
                        <button type="button" class="btn-topbar" style="padding:3px 8px; font-size:0.72rem;" onclick="handleAdminCheckProviderStatus('${escapeHtml(latestPendingPay.id)}')" title="Check transaction status against eSewa provider">Check Provider</button>
                        <button type="button" class="btn-topbar" style="padding:3px 8px; font-size:0.72rem; color:#dc2626;" onclick="handleAdminPaymentDecision('${escapeHtml(latestPendingPay.id)}', false)">Mark Failed</button>
                    </div>
                </div>
            `;
        } else if (latestVerifiedPay) {
            paymentCellHtml = `
                <div>
                    ${formatAdminPayStatusPill('paid', latestVerifiedPay.amount || latestVerifiedPay.planName || plan.toUpperCase())}
                    <div style="font-size:0.75rem; color:var(--adm-text-muted); margin-top:3px;">
                        Order: <code>${escapeHtml(latestVerifiedPay.orderId || latestVerifiedPay.id)}</code> &middot; Txn: <code>${escapeHtml(latestVerifiedPay.transactionId || 'Verified')}</code>
                    </div>
                    <div style="margin-top:3px;">
                        <button type="button" class="btn-topbar" style="padding:2px 7px; font-size:0.7rem;" onclick="handleAdminRefundPayment('${escapeHtml(latestVerifiedPay.id)}')">Refund</button>
                    </div>
                </div>
            `;
        } else if (isPaidPlan) {
            paymentCellHtml = `
                <div>
                    ${formatAdminPayStatusPill('paid', plan.toUpperCase())}
                    <div style="font-size:0.75rem; color:var(--adm-text-muted); margin-top:2px;">Admin assigned</div>
                </div>
            `;
        } else if (latestPay) {
            const normSt = normalizeAdminPayStatus(latestPay.status);
            paymentCellHtml = `
                <div>
                    ${formatAdminPayStatusPill(normSt)}
                    <div style="font-size:0.75rem; color:var(--adm-text-muted); margin-top:2px;">Txn: <code>${escapeHtml(latestPay.transactionId || '—')}</code></div>
                </div>
            `;
        } else {
            paymentCellHtml = `<span style="color:var(--adm-text-muted); font-size:0.8rem;">Free (No payment)</span>`;
        }

        const authBadge = acc.googleLinked
            ? '<span style="font-size:0.72rem; padding:2px 6px; border-radius:4px; background:rgba(59,130,246,0.12); color:#2563eb; font-weight:600;">Google</span>'
            : (acc.emailVerified ? '<span style="font-size:0.72rem; padding:2px 6px; border-radius:4px; background:rgba(22,163,74,0.1); color:#16a34a;">OTP Verified</span>' : '');

        const latestAudit = Array.isArray(acc.auditLog) && acc.auditLog.length > 0 ? acc.auditLog[0] : null;
        const modifiedByText = acc.lastModifiedBy || (latestAudit ? latestAudit.actor : 'System');

        return `
            <tr>
                <td>
                    <strong>${escapeHtml(acc.name || 'Student')}</strong>
                    <div style="font-size:0.76rem; color:var(--adm-text-muted);">@${escapeHtml(acc.username || (acc.email || '').split('@')[0])}</div>
                    <div style="margin-top:2px;"><code style="font-size:0.7rem; color:var(--adm-text-muted);">${escapeHtml(acc.userId || '—')}</code></div>
                </td>
                <td>
                    <div>${emailEsc}</div>
                    <div style="display:flex; gap:4px; align-items:center; flex-wrap:wrap; margin-top:3px;">
                        ${authBadge}
                    </div>
                </td>
                <td>
                    <select class="adm-select compact" onchange="handleAdminUpdateUserClass('${emailEsc}', this.value)">
                        <option value="Class 12" ${acc.classKey === 'class-12' ? 'selected' : ''}>Class 12</option>
                        <option value="Class 11" ${acc.classKey === 'class-11' ? 'selected' : ''}>Class 11</option>
                        <option value="Class 10" ${acc.classKey === 'class-10' ? 'selected' : ''}>Class 10</option>
                        <option value="After 12 Entrance" ${acc.classKey === 'after-12' ? 'selected' : ''}>Entrance Prep</option>
                    </select>
                </td>
                <td>
                    <select class="adm-select compact" onchange="handleAdminUpdateUserPlan('${emailEsc}', this.value)">
                        <option value="free" ${plan === 'free' ? 'selected' : ''}>Free</option>
                        <option value="gold" ${plan === 'gold' ? 'selected' : ''}>Gold (Paid)</option>
                        <option value="diamond" ${plan === 'diamond' ? 'selected' : ''}>Diamond (Paid)</option>
                    </select>
                </td>
                <td>
                    <select class="adm-select compact" onchange="handleAdminUpdateAccountStatus('${emailEsc}', this.value)">
                        <option value="active" ${accountStatus === 'active' ? 'selected' : ''}>Active</option>
                        <option value="pending_verification" ${accountStatus === 'pending_verification' ? 'selected' : ''}>Pending Verification</option>
                        <option value="suspended" ${accountStatus === 'suspended' ? 'selected' : ''}>Suspended</option>
                    </select>
                </td>
                <td>${paymentCellHtml}</td>
                <td style="font-size:0.78rem;">
                    <div style="font-weight:600; color:var(--adm-text);" title="${escapeHtml(acc.updatedAt || '')}">${formatRelativeOrLocalTime(acc.updatedAt || acc.joinedAt)}</div>
                    <div style="font-size:0.72rem; color:var(--adm-text-muted);">by ${escapeHtml(modifiedByText)}</div>
                </td>
                <td>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        <button type="button" class="btn-topbar" style="padding:5px 10px; font-size:0.78rem;" onclick="openStudentDetailModal('${emailEsc}')">Details &amp; Audit</button>
                        <button type="button" class="btn-topbar danger" style="padding:5px 10px; font-size:0.78rem;" onclick="handleAdminDeleteUser('${emailEsc}')">Delete</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderRecentAuditLogCard() {
    const mount = document.getElementById('adminRecentAuditLogMount');
    if (!mount) return;
    const logs = Array.isArray(ADMIN_ROSTER?.auditLog) ? ADMIN_ROSTER.auditLog : [];
    if (logs.length === 0) {
        mount.innerHTML = '';
        return;
    }
    mount.innerHTML = `
        <div style="padding:14px 16px; border:1px solid var(--adm-border); border-radius:10px; background:var(--adm-bg-subtle);">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <strong style="font-size:0.84rem; text-transform:uppercase; letter-spacing:0.04em; color:var(--adm-text-muted);">Recent Member, Plan &amp; Access Audit Log (${logs.length})</strong>
                <small style="color:var(--adm-text-muted);">Tracks who changed plan or access and when</small>
            </div>
            <div style="max-height:150px; overflow-y:auto; font-size:0.79rem; display:flex; flex-direction:column; gap:6px;">
                ${logs.slice(0, 12).map(entry => `
                    <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; padding-bottom:4px; border-bottom:1px dashed var(--adm-border);">
                        <div>
                            <strong>${escapeHtml(entry.actor || 'Admin')}</strong> &middot;
                            <code style="font-size:0.72rem;">${escapeHtml(entry.action || 'UPDATE')}</code> &middot;
                            <span>${escapeHtml(entry.details || '')}</span>
                        </div>
                        <small style="color:var(--adm-text-muted); white-space:nowrap;">${formatRelativeOrLocalTime(entry.timestamp)}</small>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function openStudentDetailModal(email) {
    const mount = document.getElementById('studentDetailModalMount');
    if (!mount) return;
    const accounts = ADMIN_ROSTER.accounts || [];
    const target = String(email || '').trim().toLowerCase();
    const acc = accounts.find(a => String(a.email || '').trim().toLowerCase() === target);
    if (!acc) return;

    const userPayments = getPaymentsForEmail(acc.email, acc.userId);
    const switchRequests = (ADMIN_ROSTER.classSwitchRequests || []).filter(
        r => (acc.userId && r.userId === acc.userId) || String(r.email || '').trim().toLowerCase() === target
    );
    const auditLogs = Array.isArray(acc.auditLog) ? acc.auditLog : [];
    const plan = (acc.plan || 'free').toLowerCase();

    mount.innerHTML = `
        <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:9990; display:flex; align-items:center; justify-content:center; padding:16px;" onclick="if(event.target===this) closeStudentDetailModal()">
            <div class="adm-card" style="width:100%; max-width:740px; max-height:88vh; overflow-y:auto; margin:0; padding:24px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:16px;">
                    <div>
                        <h3 style="margin:0; font-size:1.2rem;">${escapeHtml(acc.name || 'Student')}</h3>
                        <div style="font-size:0.86rem; color:var(--adm-text-muted); margin-top:2px;">
                            ${escapeHtml(acc.email)} &middot; @${escapeHtml(acc.username || '')} &middot; <code>${escapeHtml(acc.userId || '')}</code>
                        </div>
                    </div>
                    <button type="button" class="btn-topbar" onclick="closeStudentDetailModal()">Close</button>
                </div>

                <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(135px, 1fr)); gap:10px; margin-bottom:18px; padding:14px; border-radius:10px; background:var(--adm-bg-subtle); border:1px solid var(--adm-border);">
                    <div>
                        <div style="font-size:0.72rem; color:var(--adm-text-muted); text-transform:uppercase;">Active Class</div>
                        <div style="font-weight:700; margin-top:2px;">${escapeHtml(acc.grade || acc.classKey)}</div>
                    </div>
                    <div>
                        <div style="font-size:0.72rem; color:var(--adm-text-muted); text-transform:uppercase;">Current Plan</div>
                        <div style="font-weight:700; margin-top:2px; text-transform:uppercase; color:${plan === 'free' ? 'inherit' : '#16a34a'};">${escapeHtml(plan)} ${plan !== 'free' ? '(PAID)' : ''}</div>
                    </div>
                    <div>
                        <div style="font-size:0.72rem; color:var(--adm-text-muted); text-transform:uppercase;">Account Status</div>
                        <div style="font-weight:600; margin-top:2px; text-transform:capitalize;">${escapeHtml((acc.accountStatus || 'active').replace('_', ' '))}</div>
                    </div>
                    <div>
                        <div style="font-size:0.72rem; color:var(--adm-text-muted); text-transform:uppercase;">Last Updated</div>
                        <div style="font-weight:600; margin-top:2px;">${formatRelativeOrLocalTime(acc.updatedAt || acc.joinedAt)}</div>
                        <div style="font-size:0.72rem; color:var(--adm-text-muted);">by ${escapeHtml(acc.lastModifiedBy || 'System')}</div>
                    </div>
                </div>

                <h4 style="margin:0 0 8px 0; font-size:0.95rem;">Payment &amp; Subscription History (${userPayments.length})</h4>
                ${userPayments.length === 0 ? `
                    <div style="padding:14px; border:1px dashed var(--adm-border); border-radius:8px; color:var(--adm-text-muted); font-size:0.85rem; margin-bottom:16px;">
                        No eSewa / WhatsApp payment orders recorded for this student.
                    </div>
                ` : `
                    <div class="adm-table-wrap" style="margin-bottom:16px;">
                        <table class="adm-table">
                            <thead>
                                <tr>
                                    <th>Order &amp; Plan</th>
                                    <th>eSewa Txn ID</th>
                                    <th>Submitted</th>
                                    <th>Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${userPayments.map(p => {
                                    const normSt = normalizeAdminPayStatus(p.status);
                                    return `
                                        <tr>
                                            <td>
                                                <strong>${escapeHtml(p.planName)}</strong> (${escapeHtml(p.amount)})<br>
                                                <code style="font-size:0.72rem;">${escapeHtml(p.orderId || p.id)}</code>
                                            </td>
                                            <td><code>${escapeHtml(p.transactionId || '—')}</code></td>
                                            <td><small>${p.createdAt ? escapeHtml(new Date(p.createdAt).toLocaleString()) : '—'}</small></td>
                                            <td>${formatAdminPayStatusPill(normSt)}</td>
                                            <td>
                                                <div style="display:flex; gap:4px; flex-wrap:wrap;">
                                                    ${normSt !== 'paid' ? `<button type="button" class="btn-adm-dark" style="padding:3px 7px; font-size:0.72rem;" onclick="handleAdminPaymentDecision('${escapeHtml(p.id)}', true)">Verify</button>` : ''}
                                                    ${(normSt === 'pending' || normSt === 'awaiting_confirmation') ? `<button type="button" class="btn-topbar" style="padding:3px 7px; font-size:0.72rem;" onclick="handleAdminCheckProviderStatus('${escapeHtml(p.id)}')">Check Provider</button>` : ''}
                                                    ${normSt === 'paid' ? `<button type="button" class="btn-topbar" style="padding:3px 7px; font-size:0.72rem;" onclick="handleAdminRefundPayment('${escapeHtml(p.id)}')">Refund</button>` : ''}
                                                </div>
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                `}

                <h4 style="margin:0 0 8px 0; font-size:0.95rem;">Audit Log: Who Changed Plan or Access &amp; When (${auditLogs.length})</h4>
                ${auditLogs.length === 0 ? `
                    <div style="padding:12px; border:1px dashed var(--adm-border); border-radius:8px; color:var(--adm-text-muted); font-size:0.84rem; margin-bottom:16px;">
                        No audit events recorded yet.
                    </div>
                ` : `
                    <div class="adm-table-wrap" style="margin-bottom:16px; max-height:180px; overflow-y:auto;">
                        <table class="adm-table">
                            <thead>
                                <tr>
                                    <th>When</th>
                                    <th>Changed By</th>
                                    <th>Action</th>
                                    <th>Details</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${auditLogs.map(a => `
                                    <tr>
                                        <td><small>${a.timestamp ? escapeHtml(new Date(a.timestamp).toLocaleString()) : '—'}</small></td>
                                        <td><strong>${escapeHtml(a.actor || 'System')}</strong></td>
                                        <td><code style="font-size:0.72rem;">${escapeHtml(a.action || '')}</code></td>
                                        <td><small>${escapeHtml(a.details || '')}</small></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `}

                <h4 style="margin:0 0 8px 0; font-size:0.95rem;">Class Switch History (${switchRequests.length})</h4>
                ${switchRequests.length === 0 ? `
                    <div style="padding:14px; border:1px dashed var(--adm-border); border-radius:8px; color:var(--adm-text-muted); font-size:0.85rem;">
                        No class switch requests submitted by this student.
                    </div>
                ` : `
                    <div class="adm-table-wrap">
                        <table class="adm-table">
                            <thead>
                                <tr>
                                    <th>From</th>
                                    <th>Requested</th>
                                    <th>Submitted</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${switchRequests.map(r => `
                                    <tr>
                                        <td>${escapeHtml(r.currentGrade || r.currentClassKey)}</td>
                                        <td><strong>${escapeHtml(r.requestedGrade || r.requestedClassKey)}</strong></td>
                                        <td><small>${r.submittedAt ? escapeHtml(new Date(r.submittedAt).toLocaleString()) : '—'}</small></td>
                                        <td><span class="adm-status-pill ${r.status === 'approved' ? 'open' : (r.status === 'rejected' ? 'locked' : '')}">${escapeHtml(String(r.status || 'pending').toUpperCase())}</span></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `}
            </div>
        </div>
    `;
}

function closeStudentDetailModal() {
    const mount = document.getElementById('studentDetailModalMount');
    if (mount) mount.innerHTML = '';
}

function exportStudentsCsv() {
    const accounts = ADMIN_ROSTER.accounts || [];
    if (accounts.length === 0) {
        showAdminToast('No students to export.', 'error');
        return;
    }
    const headers = ['Name', 'Username', 'Email', 'Class', 'Plan', 'PaidStatus', 'LatestPaymentAmount', 'LatestTransactionId', 'PaymentStatus', 'VerificationMethod', 'JoinedAt'];
    const rows = accounts.map(acc => {
        const plan = (acc.plan || 'free').toLowerCase();
        const isPaid = plan === 'gold' || plan === 'diamond';
        const userPayments = getPaymentsForEmail(acc.email);
        const latestPay = userPayments.find(p => p.status === 'verified') || userPayments[0] || null;
        return [
            acc.name || '',
            acc.username || '',
            acc.email || '',
            acc.grade || acc.classKey || '',
            plan.toUpperCase(),
            isPaid ? 'PAID' : 'FREE',
            latestPay ? (latestPay.amount || '') : '',
            latestPay ? (latestPay.transactionId || '') : '',
            latestPay ? (latestPay.status || '').toUpperCase() : (isPaid ? 'ADMIN_ASSIGNED' : 'NONE'),
            acc.googleLinked ? 'google_oauth' : (acc.emailVerified ? 'email_otp' : 'standard'),
            acc.joinedAt || ''
        ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(',');
    });
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bpg-educare-students-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showAdminToast('Exported student & payment roster to CSV.');
}

async function handleAdminAddUser(e) {
    e.preventDefault();
    const name = (document.getElementById('newUserName')?.value || '').trim();
    const email = (document.getElementById('newUserEmail')?.value || '').trim().toLowerCase();
    const grade = document.getElementById('newUserGrade')?.value || 'Class 12';
    const plan = document.getElementById('newUserPlan')?.value || 'free';
    if (!name || !email) return;

    setSaveStatus('Saving...');
    try {
        const res = await fetch('/api/student-roster', {
            method: 'POST',
            headers: getAdminHeaders(),
            body: JSON.stringify({
                action: 'REGISTER_STUDENT',
                student: { name, email, grade, plan }
            })
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
            setSaveStatus('Not saved');
            showAdminToast(json.error || 'Could not add student.', 'error');
            return;
        }
        ADMIN_ROSTER = json.data;
        document.getElementById('newUserName').value = '';
        document.getElementById('newUserEmail').value = '';
        setSaveStatus('Saved', true);
        showAdminToast('Student added and saved.');
        broadcastUpdate('PERMISSIONS_UPDATE');
        renderUsersTab();
    } catch (err) {
        showAdminToast('Error adding student.', 'error');
    }
}

async function handleAdminUpdateUserPlan(email, newPlan) {
    setSaveStatus('Saving...');
    try {
        const res = await fetch('/api/student-roster', {
            method: 'POST',
            headers: getAdminHeaders(),
            body: JSON.stringify({ action: 'UPDATE_PLAN', email, plan: newPlan })
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Update failed');
        ADMIN_ROSTER = json.data;
        setSaveStatus('Saved', true);
        showAdminToast(`Updated plan to ${newPlan.toUpperCase()}.`);
        broadcastUpdate('PERMISSIONS_UPDATE');
        renderUsersTab();
    } catch (err) {
        showAdminToast(err.message, 'error');
    }
}

async function handleAdminUpdateUserClass(email, newGrade) {
    setSaveStatus('Saving...');
    try {
        const res = await fetch('/api/student-roster', {
            method: 'POST',
            headers: getAdminHeaders(),
            body: JSON.stringify({ action: 'UPDATE_CLASS', email, grade: newGrade, adminActor: 'Admin Console' })
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Update failed');
        ADMIN_ROSTER = json.data;
        setSaveStatus('Saved', true);
        showAdminToast(`Moved student to ${newGrade}.`);
        broadcastUpdate('PERMISSIONS_UPDATE');
        renderUsersTab();
    } catch (err) {
        showAdminToast(err.message, 'error');
    }
}

async function handleAdminUpdateAccountStatus(email, accountStatus) {
    setSaveStatus('Saving...');
    try {
        const res = await fetch('/api/student-roster', {
            method: 'POST',
            headers: getAdminHeaders(),
            body: JSON.stringify({ action: 'UPDATE_ACCOUNT_STATUS', email, accountStatus, adminActor: 'Admin Console' })
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Status update failed');
        ADMIN_ROSTER = json.data;
        setSaveStatus('Saved', true);
        showAdminToast(`Account status updated to ${accountStatus.replace('_', ' ')}.`);
        broadcastUpdate('PERMISSIONS_UPDATE');
        renderUsersTab();
    } catch (err) {
        showAdminToast(err.message, 'error');
    }
}

async function handleAdminDeleteUser(email) {
    if (!confirm(`Delete student account "${email}"? This cannot be undone.`)) return;
    setSaveStatus('Deleting...');
    try {
        const res = await fetch('/api/student-roster', {
            method: 'POST',
            headers: getAdminHeaders(),
            body: JSON.stringify({ action: 'DELETE_STUDENT', email })
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Delete failed');
        ADMIN_ROSTER = json.data;
        setSaveStatus('Saved', true);
        showAdminToast('Student removed.');
        broadcastUpdate('PERMISSIONS_UPDATE');
        renderUsersTab();
    } catch (err) {
        showAdminToast(err.message, 'error');
    }
}

async function handleAdminDeleteAllUsers() {
    const count = (ADMIN_ROSTER?.accounts || []).length;
    if (count === 0) {
        showAdminToast('Student list is already empty.');
        return;
    }
    if (!confirm(`Delete ALL ${count} student accounts permanently? This cannot be undone.`)) return;
    setSaveStatus('Deleting all...');
    try {
        const res = await fetch('/api/student-roster', {
            method: 'POST',
            headers: getAdminHeaders(),
            body: JSON.stringify({ action: 'DELETE_ALL_STUDENTS' })
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Delete all failed');
        ADMIN_ROSTER = json.data;
        setSaveStatus('Saved', true);
        showAdminToast('All student accounts deleted.');
        broadcastUpdate('PERMISSIONS_UPDATE');
        renderUsersTab();
    } catch (err) {
        showAdminToast(err.message, 'error');
    }
}

/* --------------------------------------------------------------------------
   4. TAB 2: CONTENT (4 CLASS SECTIONS -> SUBJECT -> SYLLABUS LESSONS -> PDF & VIDEO)
   -------------------------------------------------------------------------- */
function selectAdminContentClass(classKey) {
    activeContentClass = classKey;
    SECTION_META.forEach(s => {
        document.getElementById(`classSecBtn-${s.key}`)?.classList.toggle('active', s.key === classKey);
    });
    renderContentTab();
}

function selectAdminSubject(classKey, subjectId) {
    activeSubjectByClass[classKey] = subjectId;
    renderContentTab();
}

function getAdminSubjects(classKey) {
    const portal = ADMIN_STATE?.portals?.[classKey];
    if (!portal) return [];
    if (Array.isArray(portal.subjects) && portal.subjects.length > 0) return portal.subjects;
    return [{ id: 'mathematics', name: 'Mathematics', lessons: [] }];
}

function getActiveAdminSubject(classKey) {
    const subjects = getAdminSubjects(classKey);
    const chosenId = activeSubjectByClass[classKey];
    const match = subjects.find(s => s.id === chosenId) || subjects[0];
    if (match) activeSubjectByClass[classKey] = match.id;
    return match;
}

function lessonFormKey(classKey, subjectId, lessonId) {
    return `${classKey}|${subjectId}|${lessonId}`;
}

function toggleLessonForm(classKey, subjectId, lessonId, formType) {
    const key = lessonFormKey(classKey, subjectId, lessonId);
    if (openLessonForms[key] === formType) {
        delete openLessonForms[key];
    } else {
        openLessonForms[key] = formType;
    }
    renderContentTab();
}

function renderContentTab() {
    const mount = document.getElementById('contentHierarchyMount');
    if (!mount || !ADMIN_STATE?.portals) return;

    SECTION_META.forEach(s => {
        document.getElementById(`classSecBtn-${s.key}`)?.classList.toggle('active', s.key === activeContentClass);
    });

    const subjects = getAdminSubjects(activeContentClass);
    const activeSubject = getActiveAdminSubject(activeContentClass);
    const lessons = Array.isArray(activeSubject?.lessons) ? activeSubject.lessons : [];
    const syllabusRows = Array.isArray(ADMIN_STATE.portals[activeContentClass]?.syllabusRows)
        ? ADMIN_STATE.portals[activeContentClass].syllabusRows
        : [];
    const secLabel = SECTION_META.find(s => s.key === activeContentClass)?.label || activeContentClass;

    mount.innerHTML = `
        <!-- Editable Units & Chapters (Syllabus Grid) -->
        <div class="adm-units-panel">
            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-bottom:10px;">
                <div>
                    <strong style="font-size:0.95rem;">Units &amp; Chapters (${escapeHtml(secLabel)} Syllabus Grid)</strong>
                    <div style="font-size:0.78rem; color:var(--adm-text-muted);">Edit unit code, title, teaching hours, marks, and weightage pattern. All changes update the student Syllabus Grid immediately.</div>
                </div>
                <button type="button" class="btn-adm-dark" style="padding:6px 12px; font-size:0.8rem;" onclick="toggleAddSyllabusUnitDrawer('${activeContentClass}')">+ Add Unit / Row</button>
            </div>

            ${showAddSyllabusUnitByClass[activeContentClass] ? `
                <form class="adm-inline-drawer" style="margin-bottom:12px;" onsubmit="handleCreateSyllabusUnitRow(event, '${activeContentClass}')">
                    <div class="adm-drawer-head">
                        <strong>Add New Unit / Row to ${escapeHtml(secLabel)} Syllabus Grid</strong>
                        <button type="button" class="adm-close-mini" onclick="toggleAddSyllabusUnitDrawer('${activeContentClass}')">&times;</button>
                    </div>
                    <div style="display:grid; grid-template-columns:110px 1.5fr 100px 110px 1.4fr auto; gap:8px; align-items:end;">
                        <div>
                            <label class="adm-label">Unit Code</label>
                            <input type="text" id="newSylCode_${activeContentClass}" class="adm-input" value="Unit ${String(syllabusRows.length + 1).padStart(2, '0')}" placeholder="Unit 01" required>
                        </div>
                        <div>
                            <label class="adm-label">Unit / Lesson Title</label>
                            <input type="text" id="newSylName_${activeContentClass}" class="adm-input" placeholder="e.g. Algebra &amp; Matrices" required>
                        </div>
                        <div>
                            <label class="adm-label">Hours</label>
                            <input type="text" id="newSylHours_${activeContentClass}" class="adm-input" value="16 hrs" placeholder="16 hrs">
                        </div>
                        <div>
                            <label class="adm-label">Marks</label>
                            <input type="text" id="newSylMarks_${activeContentClass}" class="adm-input" value="10 Marks" placeholder="10 Marks">
                        </div>
                        <div>
                            <label class="adm-label">Weightage Pattern</label>
                            <input type="text" id="newSylFocus_${activeContentClass}" class="adm-input" placeholder="1 Long (5M) + 1 Short (4M) + 1 MCQ (1M)">
                        </div>
                        <button type="submit" class="btn-adm-dark" style="padding:9px 14px;">Save Row</button>
                    </div>
                </form>
            ` : ''}
            ${syllabusRows.length === 0 ? `<div class="adm-empty-note" style="margin-top:8px;">No units yet for ${escapeHtml(secLabel)}.</div>` : syllabusRows.map((row, uIdx) => {
                const uKey = `${activeContentClass}|${uIdx}`;
                const isRenaming = renamingUnitKey === uKey;
                return `
                    <div class="adm-unit-row">
                        ${isRenaming ? `
                            <form style="display:flex; gap:8px; flex-wrap:wrap; flex:1; align-items:center;" onsubmit="saveRenamedSyllabusUnit(event, '${activeContentClass}', ${uIdx})">
                                <input type="text" id="renameUnitCode_${uIdx}" class="adm-input" style="width:100px;" value="${escapeHtml(row.code || '')}" placeholder="Unit 01" required>
                                <input type="text" id="renameUnitName_${uIdx}" class="adm-input" style="flex:1; min-width:180px;" value="${escapeHtml(row.name || row.domain || '')}" placeholder="Unit / Chapter title" required>
                                <input type="text" id="renameUnitHours_${uIdx}" class="adm-input" style="width:85px;" value="${escapeHtml(row.hours || '')}" placeholder="20 hrs">
                                <input type="text" id="renameUnitMarks_${uIdx}" class="adm-input" style="width:95px;" value="${escapeHtml(row.marks || '')}" placeholder="15 Marks">
                                <input type="text" id="renameUnitFocus_${uIdx}" class="adm-input" style="flex:1; min-width:180px;" value="${escapeHtml(row.focus || row.weightage || '')}" placeholder="Weightage pattern (e.g. 1 Long + 2 Short)">
                                <button type="submit" class="btn-adm-dark" style="padding:6px 12px; font-size:0.78rem;">Save</button>
                                <button type="button" class="btn-topbar" style="padding:6px 10px; font-size:0.78rem;" onclick="cancelRenameUnit()">Cancel</button>
                            </form>
                        ` : `
                            <div style="min-width:0; flex:1;">
                                <span class="adm-lesson-num-tag">${escapeHtml(row.code || `Unit ${uIdx + 1}`)}</span>
                                <strong style="margin-left:6px; font-size:0.9rem;">${escapeHtml(row.name || row.domain || '')}</strong>
                                <span style="margin-left:8px; font-size:0.78rem; color:var(--adm-text-muted);">${escapeHtml(row.hours || '')}${row.hours && row.marks ? ' · ' : ''}${escapeHtml(row.marks || '')}</span>
                            </div>
                            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                                <button type="button" class="btn-topbar" style="padding:4px 8px; font-size:0.74rem;" ${uIdx === 0 ? 'disabled' : ''} onclick="moveSyllabusUnitRow('${activeContentClass}', ${uIdx}, -1)" title="Move up">&uarr;</button>
                                <button type="button" class="btn-topbar" style="padding:4px 8px; font-size:0.74rem;" ${uIdx === syllabusRows.length - 1 ? 'disabled' : ''} onclick="moveSyllabusUnitRow('${activeContentClass}', ${uIdx}, 1)" title="Move down">&darr;</button>
                                <button type="button" class="btn-topbar" style="padding:5px 10px; font-size:0.76rem;" onclick="startRenameSyllabusUnit('${activeContentClass}', ${uIdx})">Edit Row</button>
                                <button type="button" class="btn-topbar danger" style="padding:5px 10px; font-size:0.76rem;" onclick="openSafeDeleteUnitModal('${activeContentClass}', ${uIdx})">Delete</button>
                            </div>
                        `}
                    </div>
                `;
            }).join('')}
        </div>

        <div class="adm-subject-toolbar">
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                <label class="adm-label" style="margin:0;" for="adminSubjectPicker">Subject:</label>
                <select id="adminSubjectPicker" class="adm-select compact" onchange="selectAdminSubject('${activeContentClass}', this.value)">
                    ${subjects.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === activeSubject.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
                </select>
                <button type="button" class="btn-topbar" style="padding:6px 12px; font-size:0.8rem;" onclick="promptAddSubject('${activeContentClass}')">+ Add Subject</button>
            </div>
            <button type="button" class="btn-adm-dark" style="padding:7px 14px; font-size:0.82rem;" onclick="promptAddLesson('${activeContentClass}', '${escapeHtml(activeSubject.id)}')">+ Add Lesson</button>
        </div>

        <div class="adm-lessons-list">
            ${lessons.length === 0 ? `<div class="adm-empty-note">No lessons in ${escapeHtml(secLabel)} ${escapeHtml(activeSubject.name)} yet.</div>` : lessons.map((lesson, idx) => {
                const key = lessonFormKey(activeContentClass, activeSubject.id, lesson.id);
                const openForm = openLessonForms[key] || '';
                const isRenaming = renamingLessonKey === key;
                const pdfs = Array.isArray(lesson.pdfs) ? lesson.pdfs : [];
                const videos = Array.isArray(lesson.videos) ? lesson.videos : [];
                const subTopics = Array.isArray(lesson.subTopics) ? lesson.subTopics : [];
                const safeSubjId = escapeHtml(activeSubject.id);
                const safeLessonId = escapeHtml(lesson.id);

                return `
                    <div class="adm-lesson-card">
                        <div class="adm-lesson-row">
                            ${isRenaming ? `
                                <form style="display:flex; gap:8px; flex-wrap:wrap; flex:1; align-items:center;" onsubmit="saveRenamedLesson(event, '${activeContentClass}', '${safeSubjId}', '${safeLessonId}')">
                                    <input type="text" id="renameLessonCode_${idx}" class="adm-input" style="width:120px;" value="${escapeHtml(lesson.code || '')}" placeholder="Unit / Chapter">
                                    <input type="text" id="renameLessonTitle_${idx}" class="adm-input" style="flex:1; min-width:220px;" value="${escapeHtml(lesson.title || '')}" placeholder="Lesson title" required>
                                    <button type="submit" class="btn-adm-dark" style="padding:6px 12px; font-size:0.78rem;">Save Name</button>
                                    <button type="button" class="btn-topbar" style="padding:6px 10px; font-size:0.78rem;" onclick="cancelRenameLesson()">Cancel</button>
                                </form>
                            ` : `
                                <div class="adm-lesson-meta">
                                    <span class="adm-lesson-num-tag">${escapeHtml(lesson.code || `Lesson ${idx + 1}`)}</span>
                                    <span class="adm-lesson-title">${escapeHtml(lesson.title || `Lesson ${idx + 1}`)}</span>
                                    <span class="adm-lesson-counts">${subTopics.length} ${subTopics.length === 1 ? 'Sub-Topic' : 'Sub-Topics'} &middot; ${pdfs.length} ${pdfs.length === 1 ? 'PDF' : 'PDFs'} &middot; ${videos.length} ${videos.length === 1 ? 'Video' : 'Videos'}</span>
                                </div>
                                <div class="adm-lesson-actions">
                                    <button type="button" class="btn-lesson-action ${openForm === 'subtopic' ? 'active' : ''}" onclick="toggleLessonForm('${activeContentClass}', '${safeSubjId}', '${safeLessonId}', 'subtopic')">
                                        <i class="fa-solid fa-sitemap" aria-hidden="true"></i> + Sub-Topic
                                    </button>
                                    <button type="button" class="btn-lesson-action ${openForm === 'pdf' ? 'active' : ''}" onclick="toggleLessonForm('${activeContentClass}', '${safeSubjId}', '${safeLessonId}', 'pdf')">
                                        <i class="fa-solid fa-file-arrow-up" aria-hidden="true"></i> Upload PDF
                                    </button>
                                    <button type="button" class="btn-lesson-action ${openForm === 'video' ? 'active' : ''}" onclick="toggleLessonForm('${activeContentClass}', '${safeSubjId}', '${safeLessonId}', 'video')">
                                        <i class="fa-solid fa-video" aria-hidden="true"></i> Add Video
                                    </button>
                                    <button type="button" class="btn-topbar" style="padding:6px 10px; font-size:0.78rem;" onclick="startRenameLesson('${activeContentClass}', '${safeSubjId}', '${safeLessonId}')">
                                        Rename
                                    </button>
                                    <button type="button" class="btn-topbar danger" style="padding:6px 10px; font-size:0.78rem;" onclick="openSafeDeleteLessonModal('${activeContentClass}', '${safeSubjId}', '${safeLessonId}')">
                                        Delete
                                    </button>
                                </div>
                            `}
                        </div>

                        ${subTopics.length > 0 ? renderUnitSubTopicsBar(activeContentClass, activeSubject.id, lesson) : ''}
                        ${openForm === 'subtopic' ? renderInlineSubTopicForm(activeContentClass, activeSubject.id, lesson) : ''}
                        ${openForm === 'pdf' ? renderInlinePdfForm(activeContentClass, activeSubject.id, lesson) : ''}
                        ${openForm === 'video' ? renderInlineVideoForm(activeContentClass, activeSubject.id, lesson) : ''}

                        ${(pdfs.length > 0 || videos.length > 0) ? renderExistingLessonUploads(activeContentClass, activeSubject.id, lesson, pdfs, videos) : ''}
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

let preselectedSubTopicByLesson = {};

function renderUnitSubTopicsBar(classKey, subjectId, lesson) {
    const safeSubjId = escapeHtml(subjectId);
    const safeLessonId = escapeHtml(lesson.id);
    const subTopics = Array.isArray(lesson.subTopics) ? lesson.subTopics : [];
    const pdfs = Array.isArray(lesson.pdfs) ? lesson.pdfs : [];
    const videos = Array.isArray(lesson.videos) ? lesson.videos : [];

    return `
        <div style="padding:10px 14px; border-top:1px solid var(--adm-border); background:var(--adm-bg-subtle); display:flex; flex-direction:column; gap:8px;">
            <div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--adm-text-muted);">
                Sub-Topics in ${escapeHtml(lesson.title)} (${subTopics.length})
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:8px;">
                ${subTopics.map(st => {
                    const stId = escapeHtml(st.id);
                    const stPdfs = pdfs.filter(p => p.subTopicId === st.id).length;
                    const stVids = videos.filter(v => v.subTopicId === st.id).length;
                    return `
                        <div style="display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border-radius:8px; background:var(--adm-surface); border:1px solid var(--adm-border); font-size:0.82rem;">
                            <strong>${escapeHtml(st.title)}</strong>
                            <span style="font-size:0.74rem; color:var(--adm-text-muted);">(${stPdfs} PDF, ${stVids} Vid)</span>
                            <button type="button" class="btn-topbar" style="padding:2px 6px; font-size:0.7rem;" title="Upload PDF to this Sub-Topic" onclick="openLessonUploadForSubTopic('${classKey}', '${safeSubjId}', '${safeLessonId}', '${stId}', 'pdf')">+ PDF</button>
                            <button type="button" class="btn-topbar" style="padding:2px 6px; font-size:0.7rem;" title="Add Video to this Sub-Topic" onclick="openLessonUploadForSubTopic('${classKey}', '${safeSubjId}', '${safeLessonId}', '${stId}', 'video')">+ Video</button>
                            <button type="button" class="btn-topbar" style="padding:2px 6px; font-size:0.7rem;" title="Rename Sub-Topic" onclick="promptRenameSubTopic('${classKey}', '${safeSubjId}', '${safeLessonId}', '${stId}')">Edit</button>
                            <button type="button" class="btn-topbar danger" style="padding:2px 6px; font-size:0.7rem;" title="Delete Sub-Topic" onclick="deleteUnitSubTopic('${classKey}', '${safeSubjId}', '${safeLessonId}', '${stId}')">&times;</button>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function renderInlineSubTopicForm(classKey, subjectId, lesson) {
    const safeSubjId = escapeHtml(subjectId);
    const safeLessonId = escapeHtml(lesson.id);
    const prefix = `st_${classKey}_${subjectId}_${lesson.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');

    return `
        <div class="adm-inline-drawer">
            <div class="adm-drawer-head">
                <strong>Add Sub-Topic under: ${escapeHtml(lesson.code ? lesson.code + ' — ' : '')}${escapeHtml(lesson.title)}</strong>
                <button type="button" class="adm-close-mini" onclick="toggleLessonForm('${classKey}', '${safeSubjId}', '${safeLessonId}', 'subtopic')">&times;</button>
            </div>
            <form class="adm-drawer-form" onsubmit="handleAddUnitSubTopic(event, '${classKey}', '${safeSubjId}', '${safeLessonId}', '${prefix}')">
                <div style="display:flex; gap:10px; align-items:flex-end; flex-wrap:wrap;">
                    <div style="flex:1; min-width:240px;">
                        <label class="adm-label" for="subTopicTitle_${prefix}">Sub-Topic Title (e.g. 1.1 Permutation &amp; Combination, 1.2 Binomial Theorem)</label>
                        <input type="text" id="subTopicTitle_${prefix}" class="adm-input" placeholder="Enter sub-topic name..." required>
                    </div>
                    <button type="submit" class="btn-adm-dark" style="padding:9px 16px;">
                        <i class="fa-solid fa-plus" aria-hidden="true"></i> Add Sub-Topic
                    </button>
                </div>
            </form>
        </div>
    `;
}

function openLessonUploadForSubTopic(classKey, subjectId, lessonId, subTopicId, formType) {
    const key = lessonFormKey(classKey, subjectId, lessonId);
    preselectedSubTopicByLesson[key] = subTopicId;
    openLessonForms[key] = formType;
    renderContentTab();
}

async function handleAddUnitSubTopic(e, classKey, subjectId, lessonId, prefix) {
    e.preventDefault();
    const input = document.getElementById(`subTopicTitle_${prefix}`);
    const title = (input?.value || '').trim();
    if (!title) return;

    const subjects = JSON.parse(JSON.stringify(getAdminSubjects(classKey)));
    const subj = subjects.find(s => s.id === subjectId);
    const lesson = (subj?.lessons || []).find(l => l.id === lessonId);
    if (!lesson) return;
    if (!Array.isArray(lesson.subTopics)) lesson.subTopics = [];

    const newSt = {
        id: `sub_${Date.now()}_${lesson.subTopics.length + 1}`,
        title
    };
    lesson.subTopics.push(newSt);
    preselectedSubTopicByLesson[lessonFormKey(classKey, subjectId, lessonId)] = newSt.id;
    delete openLessonForms[lessonFormKey(classKey, subjectId, lessonId)];
    await persistAcademyState({ portals: { [classKey]: { subjects } } }, `Sub-topic "${title}" added to ${lesson.title}.`);
}

async function promptRenameSubTopic(classKey, subjectId, lessonId, subTopicId) {
    const subjects = JSON.parse(JSON.stringify(getAdminSubjects(classKey)));
    const subj = subjects.find(s => s.id === subjectId);
    const lesson = (subj?.lessons || []).find(l => l.id === lessonId);
    if (!lesson || !Array.isArray(lesson.subTopics)) return;
    const st = lesson.subTopics.find(x => x.id === subTopicId);
    if (!st) return;
    const nextTitle = prompt('Rename Sub-Topic:', st.title || '');
    if (!nextTitle || !nextTitle.trim()) return;
    st.title = nextTitle.trim();
    (lesson.pdfs || []).forEach(p => { if (p.subTopicId === subTopicId) p.subTopicTitle = st.title; });
    (lesson.videos || []).forEach(v => { if (v.subTopicId === subTopicId) v.subTopicTitle = st.title; });
    await persistAcademyState({ portals: { [classKey]: { subjects } } }, 'Sub-topic renamed.');
}

async function deleteUnitSubTopic(classKey, subjectId, lessonId, subTopicId) {
    const subjects = JSON.parse(JSON.stringify(getAdminSubjects(classKey)));
    const subj = subjects.find(s => s.id === subjectId);
    const lesson = (subj?.lessons || []).find(l => l.id === lessonId);
    if (!lesson || !Array.isArray(lesson.subTopics)) return;
    const st = lesson.subTopics.find(x => x.id === subTopicId);
    if (!st) return;
    if (!confirm(`Delete sub-topic "${st.title}"? Any PDFs or videos inside it will be kept under the main unit.`)) return;
    lesson.subTopics = lesson.subTopics.filter(x => x.id !== subTopicId);
    (lesson.pdfs || []).forEach(p => {
        if (p.subTopicId === subTopicId) { p.subTopicId = ''; p.subTopicTitle = ''; }
    });
    (lesson.videos || []).forEach(v => {
        if (v.subTopicId === subTopicId) { v.subTopicId = ''; v.subTopicTitle = ''; }
    });
    await persistAcademyState({ portals: { [classKey]: { subjects } } }, 'Sub-topic removed.');
}

async function updateLessonItemSubTopic(classKey, subjectId, lessonId, itemType, itemId, newSubTopicId) {
    const subjects = JSON.parse(JSON.stringify(getAdminSubjects(classKey)));
    const subj = subjects.find(s => s.id === subjectId);
    const lesson = (subj?.lessons || []).find(l => l.id === lessonId);
    if (!lesson) return;
    const list = itemType === 'video' ? (lesson.videos || []) : (lesson.pdfs || []);
    const item = list.find(x => x.id === itemId);
    if (!item) return;
    const st = (lesson.subTopics || []).find(x => x.id === newSubTopicId);
    item.subTopicId = st ? st.id : '';
    item.subTopicTitle = st ? st.title : '';
    await persistAcademyState({ portals: { [classKey]: { subjects } } }, 'Updated sub-topic assignment.');
}

function renderInlinePdfForm(classKey, subjectId, lesson) {
    const safeSubjId = escapeHtml(subjectId);
    const safeLessonId = escapeHtml(lesson.id);
    const prefix = `${classKey}_${subjectId}_${lesson.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const subTopics = Array.isArray(lesson.subTopics) ? lesson.subTopics : [];
    const preselectedSt = preselectedSubTopicByLesson[lessonFormKey(classKey, subjectId, lesson.id)] || '';

    return `
        <div class="adm-inline-drawer">
            <div class="adm-drawer-head">
                <strong>Upload PDF to: ${escapeHtml(lesson.title)}</strong>
                <button type="button" class="adm-close-mini" onclick="toggleLessonForm('${classKey}', '${safeSubjId}', '${safeLessonId}', 'pdf')">&times;</button>
            </div>
            <form class="adm-drawer-form" onsubmit="handleUploadLessonPdfs(event, '${classKey}', '${safeSubjId}', '${safeLessonId}', '${prefix}')">
                <div class="adm-drawer-grid">
                    <div>
                        <label class="adm-label" for="pdfFiles_${prefix}">PDF File(s)</label>
                        <input type="file" id="pdfFiles_${prefix}" class="adm-input" accept="application/pdf,.pdf" multiple required>
                    </div>
                    <div>
                        <label class="adm-label" for="pdfTitle_${prefix}">Title (optional)</label>
                        <input type="text" id="pdfTitle_${prefix}" class="adm-input" placeholder="Uses file name if blank">
                    </div>
                    <div>
                        <label class="adm-label" for="pdfSubTopic_${prefix}">Sub-Topic (optional)</label>
                        <select id="pdfSubTopic_${prefix}" class="adm-select">
                            <option value="">General (${escapeHtml(lesson.title)})</option>
                            ${subTopics.map(st => `<option value="${escapeHtml(st.id)}" ${st.id === preselectedSt ? 'selected' : ''}>${escapeHtml(st.title)}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="adm-label" for="pdfPlan_${prefix}">Minimum Plan</label>
                        <select id="pdfPlan_${prefix}" class="adm-select">
                            <option value="free" selected>Free</option>
                            <option value="gold">Gold</option>
                            <option value="diamond">Diamond</option>
                        </select>
                    </div>
                </div>
                <div style="margin-top:10px; display:flex; justify-content:flex-end;">
                    <button type="submit" class="btn-adm-dark">
                        <i class="fa-solid fa-upload" aria-hidden="true"></i> Save PDF
                    </button>
                </div>
            </form>
        </div>
    `;
}

function renderInlineVideoForm(classKey, subjectId, lesson) {
    const safeSubjId = escapeHtml(subjectId);
    const safeLessonId = escapeHtml(lesson.id);
    const prefix = `${classKey}_${subjectId}_${lesson.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const previewUrl = pendingVideoThumbDataUrl[prefix] || '';
    const subTopics = Array.isArray(lesson.subTopics) ? lesson.subTopics : [];
    const preselectedSt = preselectedSubTopicByLesson[lessonFormKey(classKey, subjectId, lesson.id)] || '';

    return `
        <div class="adm-inline-drawer">
            <div class="adm-drawer-head">
                <strong>Add Video to: ${escapeHtml(lesson.title)}</strong>
                <button type="button" class="adm-close-mini" onclick="toggleLessonForm('${classKey}', '${safeSubjId}', '${safeLessonId}', 'video')">&times;</button>
            </div>
            <form class="adm-drawer-form" onsubmit="handleAddLessonVideo(event, '${classKey}', '${safeSubjId}', '${safeLessonId}', '${prefix}')">
                <div class="adm-drawer-grid">
                    <div>
                        <label class="adm-label" for="vidTitle_${prefix}">Video Title</label>
                        <input type="text" id="vidTitle_${prefix}" class="adm-input" placeholder="e.g. Integration Part 1" required>
                    </div>
                    <div>
                        <label class="adm-label" for="vidUrl_${prefix}">Video Link (YouTube, Vimeo, or MP4)</label>
                        <input type="url" id="vidUrl_${prefix}" class="adm-input" placeholder="https://youtube.com/watch?v=..." required>
                    </div>
                    <div>
                        <label class="adm-label" for="vidSubTopic_${prefix}">Sub-Topic (optional)</label>
                        <select id="vidSubTopic_${prefix}" class="adm-select">
                            <option value="">General (${escapeHtml(lesson.title)})</option>
                            ${subTopics.map(st => `<option value="${escapeHtml(st.id)}" ${st.id === preselectedSt ? 'selected' : ''}>${escapeHtml(st.title)}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="adm-label" for="vidPlan_${prefix}">Minimum Plan</label>
                        <select id="vidPlan_${prefix}" class="adm-select">
                            <option value="free" selected>Free</option>
                            <option value="gold">Gold</option>
                            <option value="diamond">Diamond</option>
                        </select>
                    </div>
                </div>
                <div class="adm-video-thumb-grid" style="display:grid; grid-template-columns:1fr 180px; gap:12px; align-items:start; margin-top:12px;">
                    <div>
                        <label class="adm-label" for="vidThumb_${prefix}">Thumbnail Image</label>
                        <input type="file" id="vidThumb_${prefix}" class="adm-input" accept="image/*" onchange="handleVideoThumbPreview(this, '${prefix}')">
                    </div>
                    <div class="adm-thumb-preview-box" id="vidThumbPreview_${prefix}">
                        ${previewUrl ? `<img src="${previewUrl}" alt="Thumbnail preview">` : `<span>Thumbnail preview</span>`}
                    </div>
                </div>
                <div style="margin-top:12px; display:flex; justify-content:flex-end;">
                    <button type="submit" class="btn-adm-dark">
                        <i class="fa-solid fa-plus" aria-hidden="true"></i> Save Video
                    </button>
                </div>
            </form>
        </div>
    `;
}

function renderExistingLessonUploads(classKey, subjectId, lesson, pdfs, videos) {
    const safeSubjId = escapeHtml(subjectId);
    const safeLessonId = escapeHtml(lesson.id);
    const subTopics = Array.isArray(lesson.subTopics) ? lesson.subTopics : [];

    return `
        <div class="adm-existing-uploads">
            ${pdfs.map(pdf => {
                const pid = escapeHtml(pdf.id);
                const mp = (pdf.minPlan || 'free').toLowerCase();
                const curStId = pdf.subTopicId || '';
                const curStObj = subTopics.find(x => x.id === curStId);
                const stBadge = curStObj ? curStObj.title : (pdf.subTopicTitle || '');
                return `
                    <div class="adm-upload-item">
                        <div class="adm-upload-left">
                            <div class="adm-mini-cover pdf-mini">
                                ${pdf.coverImage ? `<img src="${pdf.coverImage}" alt="PDF cover">` : `<span>PDF</span>`}
                            </div>
                            <div>
                                <div class="adm-upload-title">${escapeHtml(pdf.title || pdf.fileName || 'PDF')}</div>
                                <div class="adm-upload-sub">PDF${stBadge ? ` &middot; <strong>${escapeHtml(stBadge)}</strong>` : ''}</div>
                            </div>
                        </div>
                        <div class="adm-upload-controls">
                            ${subTopics.length > 0 ? `
                                <select class="adm-select compact" title="Assign Sub-Topic" onchange="updateLessonItemSubTopic('${classKey}', '${safeSubjId}', '${safeLessonId}', 'pdf', '${pid}', this.value)">
                                    <option value="">General Unit</option>
                                    ${subTopics.map(st => `<option value="${escapeHtml(st.id)}" ${st.id === curStId ? 'selected' : ''}>${escapeHtml(st.title)}</option>`).join('')}
                                </select>
                            ` : ''}
                            <select class="adm-select compact" onchange="updateLessonItemPlan('${classKey}', '${safeSubjId}', '${safeLessonId}', 'pdf', '${pid}', this.value)">
                                <option value="free" ${mp === 'free' ? 'selected' : ''}>Free</option>
                                <option value="gold" ${mp === 'gold' ? 'selected' : ''}>Gold</option>
                                <option value="diamond" ${mp === 'diamond' ? 'selected' : ''}>Diamond</option>
                            </select>
                            <button type="button" class="btn-topbar" style="padding:5px 10px; font-size:0.76rem;" onclick="previewAdminLessonPdf('${classKey}', '${safeSubjId}', '${safeLessonId}', '${pid}')">Open</button>
                            <button type="button" class="btn-topbar danger" style="padding:5px 10px; font-size:0.76rem;" onclick="deleteLessonUpload('${classKey}', '${safeSubjId}', '${safeLessonId}', 'pdf', '${pid}')">Delete</button>
                        </div>
                    </div>
                `;
            }).join('')}

            ${videos.map(vid => {
                const vidId = escapeHtml(vid.id);
                const mp = (vid.minPlan || 'free').toLowerCase();
                const curStId = vid.subTopicId || '';
                const curStObj = subTopics.find(x => x.id === curStId);
                const stBadge = curStObj ? curStObj.title : (vid.subTopicTitle || '');
                const inputId = `replaceThumb_${vidId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
                return `
                    <div class="adm-upload-item">
                        <div class="adm-upload-left">
                            <div class="adm-mini-cover video-mini">
                                ${vid.thumbnailUrl ? `<img src="${vid.thumbnailUrl}" alt="Video thumbnail">` : `<span>Video</span>`}
                            </div>
                            <div>
                                <div class="adm-upload-title">${escapeHtml(vid.title || 'Video')}</div>
                                <div class="adm-upload-sub">Video${stBadge ? ` &middot; <strong>${escapeHtml(stBadge)}</strong>` : ''}</div>
                            </div>
                        </div>
                        <div class="adm-upload-controls">
                            ${subTopics.length > 0 ? `
                                <select class="adm-select compact" title="Assign Sub-Topic" onchange="updateLessonItemSubTopic('${classKey}', '${safeSubjId}', '${safeLessonId}', 'video', '${vidId}', this.value)">
                                    <option value="">General Unit</option>
                                    ${subTopics.map(st => `<option value="${escapeHtml(st.id)}" ${st.id === curStId ? 'selected' : ''}>${escapeHtml(st.title)}</option>`).join('')}
                                </select>
                            ` : ''}
                            <input type="file" id="${inputId}" accept="image/*" style="display:none;" onchange="handleReplaceVideoThumbnail(this, '${classKey}', '${safeSubjId}', '${safeLessonId}', '${vidId}')">
                            <button type="button" class="btn-topbar" style="padding:5px 10px; font-size:0.76rem;" onclick="document.getElementById('${inputId}').click()">Replace Thumbnail</button>
                            <select class="adm-select compact" onchange="updateLessonItemPlan('${classKey}', '${safeSubjId}', '${safeLessonId}', 'video', '${vidId}', this.value)">
                                <option value="free" ${mp === 'free' ? 'selected' : ''}>Free</option>
                                <option value="gold" ${mp === 'gold' ? 'selected' : ''}>Gold</option>
                                <option value="diamond" ${mp === 'diamond' ? 'selected' : ''}>Diamond</option>
                            </select>
                            <a href="${escapeHtml(vid.videoUrl || '#')}" target="_blank" rel="noopener" class="btn-topbar" style="padding:5px 10px; font-size:0.76rem;">Open</a>
                            <button type="button" class="btn-topbar danger" style="padding:5px 10px; font-size:0.76rem;" onclick="deleteLessonUpload('${classKey}', '${safeSubjId}', '${safeLessonId}', 'video', '${vidId}')">Delete</button>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function generatePdfFirstPageCover(pdfDataUrl) {
    if (!window.pdfjsLib || !pdfDataUrl.startsWith('data:application/pdf;base64,')) return '';
    try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        const bin = atob(pdfDataUrl.slice('data:application/pdf;base64,'.length));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const doc = await window.pdfjsLib.getDocument({ data: bytes }).promise;
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 0.7 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        return canvas.toDataURL('image/jpeg', 0.82);
    } catch (e) {
        return '';
    }
}

async function handleVideoThumbPreview(inputEl, prefix) {
    const file = inputEl?.files?.[0];
    if (!file) return;
    try {
        const dataUrl = await readFileAsDataUrl(file);
        pendingVideoThumbDataUrl[prefix] = dataUrl;
        const box = document.getElementById(`vidThumbPreview_${prefix}`);
        if (box) box.innerHTML = `<img src="${dataUrl}" alt="Thumbnail preview">`;
    } catch (e) {}
}

async function promptAddSubject(classKey) {
    const name = prompt('Enter subject name (e.g. Physics, Chemistry, Optional Math):');
    if (!name || !name.trim()) return;
    const subjects = JSON.parse(JSON.stringify(getAdminSubjects(classKey)));
    const newId = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
    subjects.push({ id: newId, name: name.trim(), lessons: [] });
    activeSubjectByClass[classKey] = newId;
    await persistAcademyState({ portals: { [classKey]: { subjects } } }, `Added subject "${name.trim()}".`);
}

async function promptAddLesson(classKey, subjectId) {
    const title = prompt('Enter lesson name:');
    if (!title || !title.trim()) return;
    const subjects = JSON.parse(JSON.stringify(getAdminSubjects(classKey)));
    const subj = subjects.find(s => s.id === subjectId);
    if (!subj) return;
    subj.lessons = subj.lessons || [];
    subj.lessons.push({
        id: `${classKey}-${subjectId}-l${Date.now()}`,
        code: `Unit ${String(subj.lessons.length + 1).padStart(2, '0')}`,
        title: title.trim(),
        pdfs: [],
        videos: []
    });
    await persistAcademyState({ portals: { [classKey]: { subjects } } }, 'Lesson added.');
}

async function handleUploadLessonPdfs(e, classKey, subjectId, lessonId, prefix) {
    e.preventDefault();
    const fileInput = document.getElementById(`pdfFiles_${prefix}`);
    const titleInput = document.getElementById(`pdfTitle_${prefix}`);
    const planSelect = document.getElementById(`pdfPlan_${prefix}`);
    const files = Array.from(fileInput?.files || []);
    if (files.length === 0) return;

    const subjects = JSON.parse(JSON.stringify(getAdminSubjects(classKey)));
    const subj = subjects.find(s => s.id === subjectId);
    const lesson = (subj?.lessons || []).find(l => l.id === lessonId);
    if (!lesson) return;
    lesson.pdfs = Array.isArray(lesson.pdfs) ? lesson.pdfs : [];

    const customTitle = (titleInput?.value || '').trim();
    const minPlan = planSelect?.value || 'free';
    const subTopicId = document.getElementById(`pdfSubTopic_${prefix}`)?.value || '';
    const subTopicObj = (lesson.subTopics || []).find(st => st.id === subTopicId);
    const subTopicTitle = subTopicObj ? subTopicObj.title : '';

    setSaveStatus('Uploading PDF...');
    try {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const dataUrl = await readFileAsDataUrl(file);
            const coverImage = await generatePdfFirstPageCover(dataUrl);
            const baseName = file.name.replace(/\.pdf$/i, '');
            const title = (files.length === 1 && customTitle) ? customTitle : (customTitle ? `${customTitle} (${i + 1})` : baseName);

            lesson.pdfs.push({
                id: `lpdf_${Date.now()}_${i}`,
                title,
                fileName: file.name,
                fileUrl: dataUrl,
                coverImage,
                subTopicId,
                subTopicTitle,
                minPlan,
                adminAssignedPlan: true,
                uploadedAt: new Date().toISOString().split('T')[0]
            });
        }

        delete openLessonForms[lessonFormKey(classKey, subjectId, lessonId)];
        await persistAcademyState({ portals: { [classKey]: { subjects } } }, `Uploaded ${files.length} PDF${files.length === 1 ? '' : 's'}.`);
    } catch (err) {
        setSaveStatus('Upload error');
        showAdminToast('Failed to upload PDF.', 'error');
    }
}

async function handleAddLessonVideo(e, classKey, subjectId, lessonId, prefix) {
    e.preventDefault();
    const title = (document.getElementById(`vidTitle_${prefix}`)?.value || '').trim();
    const videoUrl = (document.getElementById(`vidUrl_${prefix}`)?.value || '').trim();
    const minPlan = document.getElementById(`vidPlan_${prefix}`)?.value || 'free';
    const thumbInput = document.getElementById(`vidThumb_${prefix}`);
    if (!title || !videoUrl) return;

    let thumbnailUrl = pendingVideoThumbDataUrl[prefix] || '';
    if (!thumbnailUrl && thumbInput?.files?.[0]) {
        thumbnailUrl = await readFileAsDataUrl(thumbInput.files[0]);
    }

    const subjects = JSON.parse(JSON.stringify(getAdminSubjects(classKey)));
    const subj = subjects.find(s => s.id === subjectId);
    const lesson = (subj?.lessons || []).find(l => l.id === lessonId);
    if (!lesson) return;
    lesson.videos = Array.isArray(lesson.videos) ? lesson.videos : [];
    const subTopicId = document.getElementById(`vidSubTopic_${prefix}`)?.value || '';
    const subTopicObj = (lesson.subTopics || []).find(st => st.id === subTopicId);
    const subTopicTitle = subTopicObj ? subTopicObj.title : '';

    lesson.videos.push({
        id: `lvid_${Date.now()}`,
        title,
        videoUrl,
        thumbnailUrl,
        subTopicId,
        subTopicTitle,
        minPlan,
        adminAssignedPlan: true,
        uploadedAt: new Date().toISOString().split('T')[0]
    });

    delete pendingVideoThumbDataUrl[prefix];
    delete openLessonForms[lessonFormKey(classKey, subjectId, lessonId)];
    await persistAcademyState({ portals: { [classKey]: { subjects } } }, 'Video saved.');
}

async function handleReplaceVideoThumbnail(inputEl, classKey, subjectId, lessonId, videoId) {
    const file = inputEl?.files?.[0];
    if (!file) return;
    const thumbnailUrl = await readFileAsDataUrl(file);
    const subjects = JSON.parse(JSON.stringify(getAdminSubjects(classKey)));
    const subj = subjects.find(s => s.id === subjectId);
    const lesson = (subj?.lessons || []).find(l => l.id === lessonId);
    const vid = (lesson?.videos || []).find(v => v.id === videoId);
    if (!vid) return;
    vid.thumbnailUrl = thumbnailUrl;
    await persistAcademyState({ portals: { [classKey]: { subjects } } }, 'Video thumbnail updated.');
}

async function updateLessonItemPlan(classKey, subjectId, lessonId, itemType, itemId, newPlan) {
    const subjects = JSON.parse(JSON.stringify(getAdminSubjects(classKey)));
    const subj = subjects.find(s => s.id === subjectId);
    const lesson = (subj?.lessons || []).find(l => l.id === lessonId);
    if (!lesson) return;
    const list = itemType === 'video' ? (lesson.videos || []) : (lesson.pdfs || []);
    const item = list.find(x => x.id === itemId);
    if (!item) return;
    item.minPlan = newPlan;
    item.adminAssignedPlan = true;
    await persistAcademyState({ portals: { [classKey]: { subjects } } }, 'Plan updated.');
}

function previewAdminLessonPdf(classKey, subjectId, lessonId, pdfId) {
    const subj = getAdminSubjects(classKey).find(s => s.id === subjectId);
    const lesson = (subj?.lessons || []).find(l => l.id === lessonId);
    const pdf = (lesson?.pdfs || []).find(p => p.id === pdfId);
    if (!pdf?.fileUrl) {
        showAdminToast('PDF file data is missing.', 'error');
        return;
    }
    let openUrl = pdf.fileUrl;
    if (openUrl.startsWith('data:application/pdf;base64,')) {
        const bin = atob(openUrl.slice('data:application/pdf;base64,'.length));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        openUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    }
    const win = window.open(openUrl, '_blank');
    if (!win) {
        const a = document.createElement('a');
        a.href = openUrl;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        a.remove();
    }
}

async function deleteLessonUpload(classKey, subjectId, lessonId, itemType, itemId) {
    if (!confirm(`Delete this ${itemType === 'video' ? 'video' : 'PDF'}? This cannot be undone.`)) return;
    const subjects = JSON.parse(JSON.stringify(getAdminSubjects(classKey)));
    const subj = subjects.find(s => s.id === subjectId);
    const lesson = (subj?.lessons || []).find(l => l.id === lessonId);
    if (!lesson) return;
    if (itemType === 'video') {
        lesson.videos = (lesson.videos || []).filter(v => v.id !== itemId);
    } else {
        lesson.pdfs = (lesson.pdfs || []).filter(p => p.id !== itemId);
    }
    await persistAcademyState({ portals: { [classKey]: { subjects } } }, 'Deleted.');
}

/* --------------------------------------------------------------------------
   4.2. RENAME & SAFE DELETE WITH CONTENT MOVE (LESSONS, UNITS, CHAPTERS)
   -------------------------------------------------------------------------- */
function startRenameLesson(classKey, subjectId, lessonId) {
    renamingLessonKey = lessonFormKey(classKey, subjectId, lessonId);
    renderContentTab();
}

function cancelRenameLesson() {
    renamingLessonKey = '';
    renderContentTab();
}

async function saveRenamedLesson(e, classKey, subjectId, lessonId) {
    e.preventDefault();
    const subjects = JSON.parse(JSON.stringify(getAdminSubjects(classKey)));
    const subj = subjects.find(s => s.id === subjectId);
    const idx = (subj?.lessons || []).findIndex(l => l.id === lessonId);
    if (idx < 0) return;

    const lesson = subj.lessons[idx];
    const oldCode = lesson.code || '';
    const oldTitle = lesson.title || '';
    const newCode = (document.getElementById(`renameLessonCode_${idx}`)?.value || '').trim();
    const newTitle = (document.getElementById(`renameLessonTitle_${idx}`)?.value || '').trim();
    if (!newTitle) return;

    lesson.code = newCode || lesson.code;
    lesson.title = newTitle;

    // Keep syllabusRows in sync if this lesson matched a syllabus row (preserving all attached PDFs & videos on lesson!)
    const syllabusRows = JSON.parse(JSON.stringify(ADMIN_STATE.portals[classKey]?.syllabusRows || []));
    const rowMatch = syllabusRows.find(r => (oldCode && r.code === oldCode) || (oldTitle && (r.name === oldTitle || r.domain === oldTitle)));
    if (rowMatch) {
        rowMatch.code = lesson.code;
        rowMatch.name = lesson.title;
    }

    renamingLessonKey = '';
    await persistAcademyState(
        { portals: { [classKey]: { subjects, syllabusRows } } },
        `Renamed to "${lesson.title}" (all PDFs & videos kept attached).`
    );
}

let showAddSyllabusUnitByClass = {};

function toggleAddSyllabusUnitDrawer(classKey) {
    showAddSyllabusUnitByClass[classKey] = !showAddSyllabusUnitByClass[classKey];
    renderContentTab();
}

async function handleCreateSyllabusUnitRow(e, classKey) {
    e.preventDefault();
    const syllabusRows = JSON.parse(JSON.stringify(ADMIN_STATE.portals[classKey]?.syllabusRows || []));
    const code = (document.getElementById(`newSylCode_${classKey}`)?.value || '').trim() || `Unit ${String(syllabusRows.length + 1).padStart(2, '0')}`;
    const name = (document.getElementById(`newSylName_${classKey}`)?.value || '').trim();
    const hours = (document.getElementById(`newSylHours_${classKey}`)?.value || '').trim() || '12 hrs';
    const marks = (document.getElementById(`newSylMarks_${classKey}`)?.value || '').trim() || '8 Marks';
    const focus = (document.getElementById(`newSylFocus_${classKey}`)?.value || '').trim() || 'Structured syllabus unit';
    if (!name) return;

    syllabusRows.push({
        code,
        name,
        domain: name,
        hours,
        marks,
        focus,
        weightage: focus
    });

    const subjects = JSON.parse(JSON.stringify(getAdminSubjects(classKey)));
    const activeSubj = subjects.find(s => s.id === activeSubjectByClass[classKey]) || subjects[0];
    if (activeSubj) {
        activeSubj.lessons = activeSubj.lessons || [];
        activeSubj.lessons.push({
            id: `${classKey}-${activeSubj.id}-l${Date.now()}`,
            code,
            title: name,
            hours,
            marks,
            subTopics: [],
            pdfs: [],
            videos: []
        });
    }

    showAddSyllabusUnitByClass[classKey] = false;
    await persistAcademyState({ portals: { [classKey]: { syllabusRows, subjects } } }, `Added "${code} — ${name}" to Syllabus Grid.`);
}

async function moveSyllabusUnitRow(classKey, unitIdx, direction) {
    const syllabusRows = JSON.parse(JSON.stringify(ADMIN_STATE.portals[classKey]?.syllabusRows || []));
    const targetIdx = unitIdx + direction;
    if (targetIdx < 0 || targetIdx >= syllabusRows.length) return;
    const tmp = syllabusRows[unitIdx];
    syllabusRows[unitIdx] = syllabusRows[targetIdx];
    syllabusRows[targetIdx] = tmp;
    await persistAcademyState({ portals: { [classKey]: { syllabusRows } } }, 'Syllabus Grid reordered.');
}

async function promptAddSyllabusUnit(classKey) {
    toggleAddSyllabusUnitDrawer(classKey);
}

function startRenameSyllabusUnit(classKey, unitIdx) {
    renamingUnitKey = `${classKey}|${unitIdx}`;
    renderContentTab();
}

function cancelRenameUnit() {
    renamingUnitKey = '';
    renderContentTab();
}

async function saveRenamedSyllabusUnit(e, classKey, unitIdx) {
    e.preventDefault();
    const syllabusRows = JSON.parse(JSON.stringify(ADMIN_STATE.portals[classKey]?.syllabusRows || []));
    const row = syllabusRows[unitIdx];
    if (!row) return;

    const oldCode = row.code || '';
    const oldName = row.name || row.domain || '';
    const newCode = (document.getElementById(`renameUnitCode_${unitIdx}`)?.value || '').trim();
    const newName = (document.getElementById(`renameUnitName_${unitIdx}`)?.value || '').trim();
    const newHours = (document.getElementById(`renameUnitHours_${unitIdx}`)?.value || '').trim();
    const newMarks = (document.getElementById(`renameUnitMarks_${unitIdx}`)?.value || '').trim();
    const newFocus = (document.getElementById(`renameUnitFocus_${unitIdx}`)?.value || '').trim();
    if (!newName) return;

    row.code = newCode || oldCode;
    row.name = newName;
    row.domain = newName;
    row.hours = newHours;
    row.marks = newMarks;
    row.focus = newFocus;
    row.weightage = newFocus;

    // Update linked lesson's code/title while keeping all its PDFs, videos & sub-topics attached
    const subjects = JSON.parse(JSON.stringify(getAdminSubjects(classKey)));
    subjects.forEach(subj => {
        (subj.lessons || []).forEach(l => {
            if ((oldCode && l.code === oldCode) || (oldName && l.title === oldName)) {
                l.code = row.code;
                if (l.title === oldName) l.title = newName;
                l.hours = newHours;
                l.marks = newMarks;
            }
        });
    });

    renamingUnitKey = '';
    await persistAcademyState(
        { portals: { [classKey]: { syllabusRows, subjects } } },
        `Updated Syllabus Grid row "${newName}".`
    );
}

function closeSafeDeleteModal() {
    pendingSafeDelete = null;
    const modal = document.getElementById('adminSafeDeleteModal');
    if (modal) modal.style.display = 'none';
}

function openSafeDeleteLessonModal(classKey, subjectId, lessonId) {
    const subjects = getAdminSubjects(classKey);
    const subj = subjects.find(s => s.id === subjectId);
    const lesson = (subj?.lessons || []).find(l => l.id === lessonId);
    if (!lesson) return;

    const pdfs = Array.isArray(lesson.pdfs) ? lesson.pdfs : [];
    const videos = Array.isArray(lesson.videos) ? lesson.videos : [];
    const otherLessons = (subj.lessons || []).filter(l => l.id !== lessonId);
    const hasResources = pdfs.length > 0 || videos.length > 0;

    pendingSafeDelete = { kind: 'lesson', classKey, subjectId, lessonId };

    const titleEl = document.getElementById('safeDeleteModalTitle');
    const bodyEl = document.getElementById('safeDeleteModalBody');
    if (titleEl) titleEl.textContent = `Delete Lesson: ${lesson.title}`;
    if (bodyEl) {
        bodyEl.innerHTML = `
            <p style="margin:0 0 10px; font-size:0.9rem;">
                Are you sure you want to delete <strong>${escapeHtml(lesson.code ? lesson.code + ' — ' : '')}${escapeHtml(lesson.title)}</strong>?
            </p>
            ${hasResources ? `
                <div class="adm-impact-box">
                    <strong>Affected resources inside this lesson (${pdfs.length} PDFs, ${videos.length} Videos):</strong>
                    <ul style="margin:6px 0 0 18px;">
                        ${pdfs.map(p => `<li>PDF: ${escapeHtml(p.title || p.fileName)}</li>`).join('')}
                        ${videos.map(v => `<li>Video: ${escapeHtml(v.title)}</li>`).join('')}
                    </ul>
                </div>
                ${otherLessons.length > 0 ? `
                    <div style="margin:14px 0;">
                        <label class="adm-label" for="safeDeleteMoveTarget">Move all PDFs &amp; videos to another lesson before deleting:</label>
                        <select id="safeDeleteMoveTarget" class="adm-select">
                            ${otherLessons.map(ol => `<option value="${escapeHtml(ol.id)}">${escapeHtml(ol.code ? ol.code + ' — ' : '')}${escapeHtml(ol.title)}</option>`).join('')}
                        </select>
                    </div>
                ` : `<p style="font-size:0.84rem; color:var(--adm-text-muted);">No other lesson exists in this subject to move resources into.</p>`}
            ` : `<p style="font-size:0.85rem; color:var(--adm-text-muted);">No PDFs or videos are attached to this lesson.</p>`}

            <div style="display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap; margin-top:16px;">
                <button type="button" class="btn-topbar" onclick="closeSafeDeleteModal()">Cancel</button>
                ${hasResources && otherLessons.length > 0 ? `
                    <button type="button" class="btn-adm-dark" onclick="executeSafeDelete(true)">Move Content &amp; Delete</button>
                ` : ''}
                <button type="button" class="btn-topbar danger" onclick="executeSafeDelete(false)">${hasResources ? 'Delete Lesson &amp; Content' : 'Delete Lesson'}</button>
            </div>
        `;
    }
    document.getElementById('adminSafeDeleteModal').style.display = 'flex';
}

function openSafeDeleteUnitModal(classKey, unitIdx) {
    const syllabusRows = ADMIN_STATE.portals[classKey]?.syllabusRows || [];
    const row = syllabusRows[unitIdx];
    if (!row) return;

    const subjects = getAdminSubjects(classKey);
    const affectedLessons = [];
    let totalPdfs = 0;
    let totalVideos = 0;

    subjects.forEach(subj => {
        (subj.lessons || []).forEach(l => {
            if ((row.code && l.code === row.code) || (row.name && l.title === row.name)) {
                const pc = (l.pdfs || []).length;
                const vc = (l.videos || []).length;
                totalPdfs += pc;
                totalVideos += vc;
                affectedLessons.push({ subjectId: subj.id, subjectName: subj.name, lesson: l, pc, vc });
            }
        });
    });

    const otherUnits = syllabusRows
        .map((r, idx) => ({ idx, code: r.code, name: r.name || r.domain }))
        .filter(u => u.idx !== unitIdx);
    const hasImpact = affectedLessons.length > 0;

    pendingSafeDelete = { kind: 'unit', classKey, unitIdx, affectedLessons };

    const titleEl = document.getElementById('safeDeleteModalTitle');
    const bodyEl = document.getElementById('safeDeleteModalBody');
    if (titleEl) titleEl.textContent = `Delete Unit / Chapter: ${row.name || row.code}`;
    if (bodyEl) {
        bodyEl.innerHTML = `
            <p style="margin:0 0 10px; font-size:0.9rem;">
                Are you sure you want to delete <strong>${escapeHtml(row.code)} — ${escapeHtml(row.name || row.domain)}</strong> from the Syllabus Grid?
            </p>
            ${hasImpact ? `
                <div class="adm-impact-box">
                    <strong>Affected linked lessons &amp; resources (${affectedLessons.length} lesson(s), ${totalPdfs} PDF(s), ${totalVideos} video(s)):</strong>
                    <ul style="margin:6px 0 0 18px;">
                        ${affectedLessons.map(a => `<li>${escapeHtml(a.subjectName)} &rarr; ${escapeHtml(a.lesson.title)} (${a.pc} PDF, ${a.vc} Video)</li>`).join('')}
                    </ul>
                </div>
                ${otherUnits.length > 0 ? `
                    <div style="margin:14px 0;">
                        <label class="adm-label" for="safeDeleteMoveTarget">Move affected lessons &amp; resources to another unit before deleting:</label>
                        <select id="safeDeleteMoveTarget" class="adm-select">
                            ${otherUnits.map(ou => `<option value="${ou.idx}">${escapeHtml(ou.code)} — ${escapeHtml(ou.name)}</option>`).join('')}
                        </select>
                    </div>
                ` : ''}
            ` : `<p style="font-size:0.85rem; color:var(--adm-text-muted);">No linked lessons or uploaded files will be affected.</p>`}

            <div style="display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap; margin-top:16px;">
                <button type="button" class="btn-topbar" onclick="closeSafeDeleteModal()">Cancel</button>
                ${hasImpact && otherUnits.length > 0 ? `
                    <button type="button" class="btn-adm-dark" onclick="executeSafeDelete(true)">Move Content &amp; Delete Unit</button>
                ` : ''}
                <button type="button" class="btn-topbar danger" onclick="executeSafeDelete(false)">${hasImpact ? 'Delete Unit &amp; Linked Lessons' : 'Delete Unit'}</button>
            </div>
        `;
    }
    document.getElementById('adminSafeDeleteModal').style.display = 'flex';
}

async function executeSafeDelete(moveFirst) {
    if (!pendingSafeDelete) return;
    const { kind, classKey } = pendingSafeDelete;
    const targetVal = document.getElementById('safeDeleteMoveTarget')?.value;

    const subjects = JSON.parse(JSON.stringify(getAdminSubjects(classKey)));
    const syllabusRows = JSON.parse(JSON.stringify(ADMIN_STATE.portals[classKey]?.syllabusRows || []));

    if (kind === 'lesson') {
        const { subjectId, lessonId } = pendingSafeDelete;
        const subj = subjects.find(s => s.id === subjectId);
        if (!subj) return;
        const lesson = (subj.lessons || []).find(l => l.id === lessonId);
        if (!lesson) return;

        if (moveFirst && targetVal) {
            const dest = (subj.lessons || []).find(l => l.id === targetVal);
            if (dest) {
                dest.pdfs = [...(dest.pdfs || []), ...(lesson.pdfs || [])];
                dest.videos = [...(dest.videos || []), ...(lesson.videos || [])];
            }
        }
        subj.lessons = (subj.lessons || []).filter(l => l.id !== lessonId);
        const filteredSyllabus = syllabusRows.filter(r => !((lesson.code && r.code === lesson.code) && ((r.name || r.domain) === lesson.title)));
        closeSafeDeleteModal();
        await persistAcademyState(
            { portals: { [classKey]: { subjects, syllabusRows: filteredSyllabus } } },
            moveFirst ? 'Moved resources and deleted lesson.' : 'Lesson deleted.'
        );
        return;
    }

    if (kind === 'unit') {
        const { unitIdx } = pendingSafeDelete;
        const row = syllabusRows[unitIdx];
        if (!row) return;

        if (moveFirst && targetVal !== undefined && targetVal !== '') {
            const destRow = syllabusRows[parseInt(targetVal, 10)];
            if (destRow) {
                subjects.forEach(subj => {
                    const destLesson = (subj.lessons || []).find(l => l.code === destRow.code || l.title === destRow.name);
                    (subj.lessons || []).forEach(l => {
                        const isAffected = (row.code && l.code === row.code) || (row.name && l.title === row.name);
                        if (!isAffected) return;
                        if (destLesson && destLesson.id !== l.id) {
                            destLesson.pdfs = [...(destLesson.pdfs || []), ...(l.pdfs || [])];
                            destLesson.videos = [...(destLesson.videos || []), ...(l.videos || [])];
                            l._removeAfterMove = true;
                        } else {
                            l.code = destRow.code;
                        }
                    });
                    subj.lessons = (subj.lessons || []).filter(l => !l._removeAfterMove);
                });
            }
        } else {
            subjects.forEach(subj => {
                subj.lessons = (subj.lessons || []).filter(l => !((row.code && l.code === row.code) || (row.name && l.title === row.name)));
            });
        }

        syllabusRows.splice(unitIdx, 1);
        closeSafeDeleteModal();
        await persistAcademyState(
            { portals: { [classKey]: { syllabusRows, subjects } } },
            moveFirst ? 'Moved content and deleted unit.' : 'Unit deleted.'
        );
    }
}

/* --------------------------------------------------------------------------
   4.5. TAB 2.5: MOCK TESTS CREATOR DASHBOARD
   -------------------------------------------------------------------------- */
function selectAdminMockClass(classKey) {
    activeMockClass = classKey;
    editingMockTest = null;
    showTimeLimitEditor = false;
    SECTION_META.forEach(s => {
        document.getElementById(`mockClassBtn-${s.key}`)?.classList.toggle('active', s.key === classKey);
    });
    renderMockTestsTab();
}

function selectAdminMockSubject(classKey, subjectId) {
    activeMockSubjectByClass[classKey] = subjectId;
    editingMockTest = null;
    showTimeLimitEditor = false;
    renderMockTestsTab();
}

function getActiveMockSubject(classKey) {
    const subjects = getAdminSubjects(classKey);
    const chosenId = activeMockSubjectByClass[classKey];
    const match = subjects.find(s => s.id === chosenId) || subjects[0];
    if (match) activeMockSubjectByClass[classKey] = match.id;
    return match || { id: 'mathematics', name: 'Mathematics' };
}

function startCreateMockTest() {
    const subj = getActiveMockSubject(activeMockClass);
    editingMockTest = {
        id: '',
        classKey: activeMockClass,
        subjectId: subj.id,
        title: '',
        durationMinutes: 30,
        minPlan: 'free',
        status: 'draft',
        questions: [
            {
                id: `q_${Date.now()}_0`,
                text: '',
                options: { A: '', B: '', C: '', D: '' },
                correctOption: 'A'
            }
        ]
    };
    showTimeLimitEditor = false;
    renderMockTestsTab();
}

function editExistingMockTest(testId) {
    const found = ADMIN_MOCK_TESTS.find(t => t.id === testId);
    if (!found) return;
    editingMockTest = JSON.parse(JSON.stringify(found));
    if (!Array.isArray(editingMockTest.questions)) editingMockTest.questions = [];
    showTimeLimitEditor = false;
    renderMockTestsTab();
}

function cancelEditMockTest() {
    editingMockTest = null;
    showTimeLimitEditor = false;
    renderMockTestsTab();
}

function syncMockEditorInputsToState() {
    if (!editingMockTest) return;
    const titleEl = document.getElementById('mockEditorTitle');
    const planEl = document.getElementById('mockEditorMinPlan');
    if (titleEl) editingMockTest.title = titleEl.value;
    if (planEl) editingMockTest.minPlan = planEl.value;

    (editingMockTest.questions || []).forEach((q, idx) => {
        const qText = document.getElementById(`mcqText_${idx}`);
        if (qText) q.text = qText.value;
        ['A', 'B', 'C', 'D'].forEach(opt => {
            const optEl = document.getElementById(`mcqOpt_${idx}_${opt}`);
            if (optEl) q.options[opt] = optEl.value;
        });
    });
}

function toggleMockTimeLimitEditor() {
    syncMockEditorInputsToState();
    showTimeLimitEditor = !showTimeLimitEditor;
    renderMockTestsTab();
    if (showTimeLimitEditor) {
        setTimeout(() => document.getElementById('mockTimeLimitInput')?.focus(), 30);
    }
}

function applyMockTimeLimit() {
    syncMockEditorInputsToState();
    const val = parseInt(document.getElementById('mockTimeLimitInput')?.value || '30', 10);
    const clamped = Math.max(1, Math.min(300, Number.isFinite(val) ? val : 30));
    if (editingMockTest) {
        editingMockTest.durationMinutes = clamped;
    }
    showTimeLimitEditor = false;
    renderMockTestsTab();
}

function addMockQuestion() {
    syncMockEditorInputsToState();
    if (!editingMockTest) return;
    editingMockTest.questions.push({
        id: `q_${Date.now()}_${editingMockTest.questions.length}`,
        text: '',
        options: { A: '', B: '', C: '', D: '' },
        correctOption: 'A'
    });
    renderMockTestsTab();
}

function setMockQuestionCorrect(qIndex, letter) {
    syncMockEditorInputsToState();
    if (!editingMockTest || !editingMockTest.questions[qIndex]) return;
    editingMockTest.questions[qIndex].correctOption = letter;
    renderMockTestsTab();
}

function moveMockQuestion(qIndex, direction) {
    syncMockEditorInputsToState();
    if (!editingMockTest) return;
    const target = qIndex + direction;
    const list = editingMockTest.questions;
    if (target < 0 || target >= list.length) return;
    const temp = list[qIndex];
    list[qIndex] = list[target];
    list[target] = temp;
    renderMockTestsTab();
}

function removeMockQuestion(qIndex) {
    syncMockEditorInputsToState();
    if (!editingMockTest) return;
    if (!confirm(`Remove Question ${qIndex + 1}?`)) return;
    editingMockTest.questions.splice(qIndex, 1);
    renderMockTestsTab();
}

async function saveAdminMockTest(targetStatus) {
    syncMockEditorInputsToState();
    if (!editingMockTest) return;

    const title = String(editingMockTest.title || '').trim();
    if (!title) {
        showAdminToast('Please enter a test title.', 'error');
        document.getElementById('mockEditorTitle')?.focus();
        return;
    }

    if (targetStatus === 'published') {
        const qs = editingMockTest.questions || [];
        if (qs.length === 0) {
            showAdminToast('Add at least one MCQ question before publishing.', 'error');
            return;
        }
        const incompleteIdx = qs.findIndex(q => !String(q.text || '').trim() || ['A', 'B', 'C', 'D'].some(l => !String(q.options?.[l] || '').trim()));
        if (incompleteIdx >= 0) {
            showAdminToast(`Complete Question ${incompleteIdx + 1} and all four options (A, B, C, D) before publishing.`, 'error');
            return;
        }
    }

    const payloadTest = Object.assign({}, editingMockTest, { status: targetStatus });
    setSaveStatus(targetStatus === 'published' ? 'Publishing...' : 'Saving draft...');
    try {
        const res = await fetch('/api/mock-tests', {
            method: 'POST',
            headers: getAdminHeaders(),
            body: JSON.stringify({ action: 'SAVE_TEST', test: payloadTest })
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
            throw new Error(json.error || 'Could not save mock test.');
        }
        ADMIN_MOCK_TESTS = Array.isArray(json.tests) ? json.tests : ADMIN_MOCK_TESTS;
        editingMockTest = JSON.parse(JSON.stringify(json.test));
        setSaveStatus('Saved', true);
        showAdminToast(targetStatus === 'published' ? 'Mock test published!' : 'Draft saved.');
        broadcastUpdate('DATA_UPDATED');
        renderMockTestsTab();
    } catch (err) {
        setSaveStatus('Save error');
        showAdminToast(err.message || 'Save failed.', 'error');
    }
}

async function quickTogglePublishMockTest(testId, nextStatus) {
    const found = ADMIN_MOCK_TESTS.find(t => t.id === testId);
    if (!found) return;
    const copy = JSON.parse(JSON.stringify(found));
    copy.status = nextStatus;
    setSaveStatus('Updating...');
    try {
        const res = await fetch('/api/mock-tests', {
            method: 'POST',
            headers: getAdminHeaders(),
            body: JSON.stringify({ action: 'SAVE_TEST', test: copy })
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Update failed');
        ADMIN_MOCK_TESTS = json.tests || ADMIN_MOCK_TESTS;
        setSaveStatus('Saved', true);
        showAdminToast(nextStatus === 'published' ? 'Mock test published.' : 'Moved back to draft.');
        broadcastUpdate('DATA_UPDATED');
        renderMockTestsTab();
    } catch (err) {
        showAdminToast(err.message, 'error');
    }
}

async function deleteAdminMockTest(testId) {
    if (!confirm('Delete this mock test permanently?')) return;
    setSaveStatus('Deleting...');
    try {
        const res = await fetch('/api/mock-tests', {
            method: 'POST',
            headers: getAdminHeaders(),
            body: JSON.stringify({ action: 'DELETE_TEST', testId })
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Delete failed');
        ADMIN_MOCK_TESTS = json.tests || [];
        if (editingMockTest && editingMockTest.id === testId) editingMockTest = null;
        setSaveStatus('Saved', true);
        showAdminToast('Mock test deleted.');
        broadcastUpdate('DATA_UPDATED');
        renderMockTestsTab();
    } catch (err) {
        showAdminToast(err.message, 'error');
    }
}

let activeMathCategory = 'algebra';
let lastFocusedMathInputId = '';

const MATH_EQUATION_PALETTE = {
    algebra: {
        label: 'Algebra & Roots',
        items: [
            { label: 'a/b', title: 'Fraction', insert: '$\\frac{a}{b}$' },
            { label: 'xⁿ', title: 'Power / Exponent', insert: '$x^{n}$' },
            { label: 'xₙ', title: 'Subscript', insert: '$x_{n}$' },
            { label: '√x', title: 'Square Root', insert: '$\\sqrt{x}$' },
            { label: 'ⁿ√x', title: 'n-th Root', insert: '$\\sqrt[n]{x}$' },
            { label: 'Quadratic', title: 'Quadratic Formula', insert: '$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$' },
            { label: 'nCr', title: 'Binomial Combination', insert: '$\\binom{n}{r}$' },
            { label: '|x|', title: 'Absolute Value / Modulus', insert: '$|x|$' },
            { label: 'logₐ(x)', title: 'Logarithm base a', insert: '$\\log_{a}(x)$' },
            { label: 'ln(x)', title: 'Natural Logarithm', insert: '$\\ln(x)$' },
            { label: 'eˣ', title: 'Exponential', insert: '$e^{x}$' },
            { label: 'n!', title: 'Factorial', insert: '$n!$' },
            { label: 'a+bi', title: 'Complex Number', insert: '$z = a + bi$' },
            { label: 'System { }', title: 'System of Equations / Piecewise', insert: '$\\begin{cases} ax + by = c \\\\ dx + ey = f \\end{cases}$' }
        ]
    },
    calculus: {
        label: 'Calculus & Series',
        items: [
            { label: 'lim', title: 'Limit as x approaches a', insert: '$\\lim_{x \\to a} f(x)$' },
            { label: 'lim→∞', title: 'Limit to Infinity', insert: '$\\lim_{x \\to \\infty} f(x)$' },
            { label: 'dy/dx', title: 'First Derivative', insert: '$\\frac{dy}{dx}$' },
            { label: 'd²y/dx²', title: 'Second Derivative', insert: '$\\frac{d^2y}{dx^2}$' },
            { label: '∂f/∂x', title: 'Partial Derivative', insert: '$\\frac{\\partial f}{\\partial x}$' },
            { label: '∫ f(x)dx', title: 'Indefinite Integral', insert: '$\\int f(x)\\,dx$' },
            { label: '∫ₐᵇ f(x)dx', title: 'Definite Integral', insert: '$\\int_{a}^{b} f(x)\\,dx$' },
            { label: '∑', title: 'Summation', insert: '$\\sum_{n=1}^{\\infty} a_{n}$' },
            { label: '∏', title: 'Product', insert: '$\\prod_{i=1}^{n} x_{i}$' },
            { label: 'f\'(x)', title: 'Prime Derivative', insert: '$f\'(x)$' },
            { label: '∞', title: 'Infinity', insert: '$\\infty$' }
        ]
    },
    trig: {
        label: 'Trig & Greek',
        items: [
            { label: 'sin θ', title: 'Sine', insert: '$\\sin\\theta$' },
            { label: 'cos θ', title: 'Cosine', insert: '$\\cos\\theta$' },
            { label: 'tan θ', title: 'Tangent', insert: '$\\tan\\theta$' },
            { label: 'cot θ', title: 'Cotangent', insert: '$\\cot\\theta$' },
            { label: 'sec θ', title: 'Secant', insert: '$\\sec\\theta$' },
            { label: 'csc θ', title: 'Cosecant', insert: '$\\csc\\theta$' },
            { label: 'sin⁻¹x', title: 'Inverse Sine', insert: '$\\sin^{-1}(x)$' },
            { label: 'cos⁻¹x', title: 'Inverse Cosine', insert: '$\\cos^{-1}(x)$' },
            { label: 'tan⁻¹x', title: 'Inverse Tangent', insert: '$\\tan^{-1}(x)$' },
            { label: 'θ', title: 'Theta', insert: '$\\theta$' },
            { label: 'π', title: 'Pi', insert: '$\\pi$' },
            { label: 'α', title: 'Alpha', insert: '$\\alpha$' },
            { label: 'β', title: 'Beta', insert: '$\\beta$' },
            { label: 'γ', title: 'Gamma', insert: '$\\gamma$' },
            { label: 'φ', title: 'Phi', insert: '$\\phi$' },
            { label: 'λ', title: 'Lambda', insert: '$\\lambda$' },
            { label: 'Δ', title: 'Delta', insert: '$\\Delta$' },
            { label: '°', title: 'Degrees', insert: '$^{\\circ}$' }
        ]
    },
    matrices: {
        label: 'Matrices, Vectors & Conics',
        items: [
            { label: '[2×2 Matrix]', title: '2x2 Matrix', insert: '$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$' },
            { label: '|2×2 Det|', title: '2x2 Determinant', insert: '$\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}$' },
            { label: '[3×3 Matrix]', title: '3x3 Matrix', insert: '$\\begin{pmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{pmatrix}$' },
            { label: 'a⃗', title: 'Vector a', insert: '$\\vec{a}$' },
            { label: 'AB⃗', title: 'Vector AB', insert: '$\\overrightarrow{AB}$' },
            { label: 'î+ĵ+k̂', title: 'Unit Vectors', insert: '$a\\hat{i} + b\\hat{j} + c\\hat{k}$' },
            { label: 'a⃗·b⃗', title: 'Dot Product', insert: '$\\vec{a} \\cdot \\vec{b}$' },
            { label: 'a⃗×b⃗', title: 'Cross Product', insert: '$\\vec{a} \\times \\vec{b}$' },
            { label: 'Ellipse', title: 'Ellipse Equation', insert: '$\\frac{x^2}{a^2} + \\frac{y^2}{b^2} = 1$' },
            { label: 'Hyperbola', title: 'Hyperbola Equation', insert: '$\\frac{x^2}{a^2} - \\frac{y^2}{b^2} = 1$' },
            { label: 'Parabola', title: 'Parabola Equation', insert: '$y^2 = 4ax$' },
            { label: 'Circle', title: 'Circle Equation', insert: '$(x - h)^2 + (y - k)^2 = r^2$' }
        ]
    },
    sets: {
        label: 'Sets, Logic & Relations',
        items: [
            { label: '±', title: 'Plus or Minus', insert: '$\\pm$' },
            { label: '≤', title: 'Less than or equal', insert: '$\\le$' },
            { label: '≥', title: 'Greater than or equal', insert: '$\\ge$' },
            { label: '≠', title: 'Not equal', insert: '$\\neq$' },
            { label: '≈', title: 'Approximately equal', insert: '$\\approx$' },
            { label: '≡', title: 'Identical / Congruent', insert: '$\\equiv$' },
            { label: '∈', title: 'Element of', insert: '$\\in$' },
            { label: '∉', title: 'Not an element of', insert: '$\\notin$' },
            { label: '⊂', title: 'Proper Subset', insert: '$\\subset$' },
            { label: '⊆', title: 'Subset or equal', insert: '$\\subseteq$' },
            { label: '∪', title: 'Union', insert: '$\\cup$' },
            { label: '∩', title: 'Intersection', insert: '$\\cap$' },
            { label: '∅', title: 'Empty Set', insert: '$\\emptyset$' },
            { label: '∀', title: 'For all', insert: '$\\forall$' },
            { label: '∃', title: 'There exists', insert: '$\\exists$' },
            { label: '⇒', title: 'Implies', insert: '$\\Rightarrow$' },
            { label: '⇔', title: 'If and only if', insert: '$\\Leftrightarrow$' },
            { label: 'ℝ', title: 'Real Numbers', insert: '$\\mathbb{R}$' },
            { label: 'ℕ', title: 'Natural Numbers', insert: '$\\mathbb{N}$' },
            { label: 'ℤ', title: 'Integers', insert: '$\\mathbb{Z}$' },
            { label: 'ℂ', title: 'Complex Numbers', insert: '$\\mathbb{C}$' }
        ]
    }
};

function trackMathInputFocus(inputId) {
    lastFocusedMathInputId = inputId;
    const badge = document.getElementById('activeMathFieldBadge');
    if (badge) {
        const label = inputId.startsWith('mcqText_')
            ? `Question ${Number(inputId.replace('mcqText_', '')) + 1} Text`
            : `Question ${Number(inputId.split('_')[1]) + 1} Option ${inputId.split('_')[2]}`;
        badge.textContent = `Inserting into: ${label}`;
    }
}

function switchMathPaletteCategory(catKey) {
    syncMockEditorInputsToState();
    activeMathCategory = catKey;
    renderMockTestsTab();
    if (lastFocusedMathInputId) {
        setTimeout(() => document.getElementById(lastFocusedMathInputId)?.focus(), 20);
    }
}

function insertMathSnippetAtCursor(snippet) {
    let targetEl = lastFocusedMathInputId ? document.getElementById(lastFocusedMathInputId) : null;
    if (!targetEl) {
        targetEl = document.getElementById('mcqText_0');
        if (targetEl) lastFocusedMathInputId = 'mcqText_0';
    }
    if (!targetEl) {
        showAdminToast('Click inside a Question or Option field first.', 'error');
        return;
    }
    const start = typeof targetEl.selectionStart === 'number' ? targetEl.selectionStart : targetEl.value.length;
    const end = typeof targetEl.selectionEnd === 'number' ? targetEl.selectionEnd : targetEl.value.length;
    const val = targetEl.value || '';
    targetEl.value = val.slice(0, start) + snippet + val.slice(end);
    targetEl.focus();
    const nextPos = start + snippet.length;
    try { targetEl.setSelectionRange(nextPos, nextPos); } catch (e) {}
    syncMockEditorInputsToState();
    updateAllAdminMathPreviews();
}

/* --------------------------------------------------------------------------
   UNIVERSAL WORD (OMML / UNICODEMATH) & LINEAR MATH -> LATEX CONVERTER
   -------------------------------------------------------------------------- */
const UNICODE_SUPER_MAP = {
    '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4',
    '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
    '⁺': '+', '⁻': '-', '⁼': '=', '⁽': '(', '⁾': ')',
    'ⁿ': 'n', 'ⁱ': 'i'
};

const UNICODE_SUB_MAP = {
    '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
    '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
    '₊': '+', '₋': '-', '₌': '=', '₍': '(', '₎': ')',
    'ₐ': 'a', 'ₑ': 'e', 'ₒ': 'o', 'ₓ': 'x', 'ₕ': 'h',
    'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm', 'ₙ': 'n', 'ₚ': 'p',
    'ₛ': 's', 'ₜ': 't'
};

const GREEK_UNICODE_TO_LATEX = {
    'α': '\\alpha ', 'β': '\\beta ', 'γ': '\\gamma ', 'δ': '\\delta ',
    'ε': '\\varepsilon ', 'ζ': '\\zeta ', 'η': '\\eta ', 'θ': '\\theta ',
    'ϑ': '\\vartheta ', 'ι': '\\iota ', 'κ': '\\kappa ', 'λ': '\\lambda ',
    'μ': '\\mu ', 'ν': '\\nu ', 'ξ': '\\xi ', 'π': '\\pi ',
    'ρ': '\\rho ', 'σ': '\\sigma ', 'τ': '\\tau ', 'υ': '\\upsilon ',
    'φ': '\\phi ', 'ϕ': '\\varphi ', 'χ': '\\chi ', 'ψ': '\\psi ',
    'ω': '\\omega ', 'Γ': '\\Gamma ', 'Δ': '\\Delta ', 'Θ': '\\Theta ',
    'Λ': '\\Lambda ', 'Ξ': '\\Xi ', 'Π': '\\Pi ', 'Σ': '\\Sigma ',
    'Φ': '\\Phi ', 'Ψ': '\\Psi ', 'Ω': '\\Omega '
};

function hasRawUnicodeOrWordMath(str) {
    if (!str) return false;
    return /[∫∬∭∮∑∏√∛∜▒〖〗∞±∓×÷≤≥≠≈≡∈∉⊂⊆∪∩∅∀∃∂∇→⇒⇔⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿ₀₁₂₃₄₅₆₇₈₉ₐₑₒₓₕₖₗₘₙₚₛₜα-ωΑ-Ω]/.test(str)
        || /\b(lim|sin|cos|tan|cot|sec|csc|log|ln)\s*[_^((]/.test(str)
        || /\b(d\^?2?[A-Za-z])\/(d[A-Za-z](\^2)?)\b/.test(str)
        || /[A-Za-z0-9)\]}]\s*\/\s*(√|\\sqrt|\([A-Za-z0-9+\-*/^_ ]+\))/.test(str);
}

function findMatchingCloseIndex(str, openIdx) {
    const openChar = str[openIdx];
    const closeChar = openChar === '(' ? ')' : (openChar === '〖' ? '〗' : (openChar === '{' ? '}' : (openChar === '[' ? ']' : '')));
    if (!closeChar) return -1;
    let depth = 0;
    for (let i = openIdx; i < str.length; i++) {
        const ch = str[i];
        if (ch === openChar) depth++;
        else if (ch === closeChar) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function findMatchingOpenIndex(str, closeIdx) {
    const closeChar = str[closeIdx];
    const openChar = closeChar === ')' ? '(' : (closeChar === '〗' ? '〖' : (closeChar === '}' ? '{' : (closeChar === ']' ? '[' : '')));
    if (!openChar) return -1;
    let depth = 0;
    for (let i = closeIdx; i >= 0; i--) {
        const ch = str[i];
        if (ch === closeChar) depth++;
        else if (ch === openChar) {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function replaceUnicodeRootsWithLatex(input) {
    let s = String(input || '');
    const rootTokens = [
        { sym: '∜', cmd: '\\sqrt[4]' },
        { sym: '∛', cmd: '\\sqrt[3]' },
        { sym: '√', cmd: '\\sqrt' }
    ];
    for (const { sym, cmd } of rootTokens) {
        let safety = 0;
        while (s.includes(sym) && safety++ < 40) {
            const idx = s.indexOf(sym);
            let afterIdx = idx + sym.length;
            while (afterIdx < s.length && s[afterIdx] === ' ') afterIdx++;
            const nextCh = s[afterIdx];
            if (nextCh === '(' || nextCh === '〖' || nextCh === '{') {
                const closeIdx = findMatchingCloseIndex(s, afterIdx);
                if (closeIdx !== -1) {
                    const innerRaw = s.slice(afterIdx + 1, closeIdx);
                    const innerConverted = replaceUnicodeRootsWithLatex(innerRaw);
                    s = s.slice(0, idx) + `${cmd}{${innerConverted}}` + s.slice(closeIdx + 1);
                    continue;
                }
            }
            // Unparenthesized simple token after root, e.g. √x or √2
            const m = s.slice(afterIdx).match(/^([A-Za-z0-9\\]+(\^[A-Za-z0-9]+)?)/);
            if (m) {
                s = s.slice(0, idx) + `${cmd}{${m[1]}}` + s.slice(afterIdx + m[1].length);
            } else {
                s = s.slice(0, idx) + cmd + s.slice(idx + sym.length);
            }
        }
    }
    return s;
}

function replaceBalancedSubSupGroups(input) {
    let s = String(input || '');
    for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < s.length - 1; i++) {
            if ((s[i] === '^' || s[i] === '_') && (s[i + 1] === '(' || s[i + 1] === '〖')) {
                const closeIdx = findMatchingCloseIndex(s, i + 1);
                if (closeIdx !== -1) {
                    const inner = s.slice(i + 2, closeIdx);
                    s = s.slice(0, i + 1) + `{${inner}}` + s.slice(closeIdx + 1);
                }
            }
        }
    }
    return s;
}

function convertInlineFractionsToFrac(input) {
    let s = String(input || '');
    let safety = 0;
    let searchFrom = 0;

    while (safety++ < 40) {
        const slashIdx = s.indexOf('/', searchFrom);
        if (slashIdx === -1) break;

        // 1. Identify Numerator to the left of slashIdx
        let numStart = slashIdx - 1;
        while (numStart >= 0 && s[numStart] === ' ') numStart--;
        if (numStart < 0) {
            searchFrom = slashIdx + 1;
            continue;
        }
        const numEnd = numStart + 1;
        let numText = '';
        let actualNumStart = numStart;

        if (s[numStart] === ')' || s[numStart] === '〗' || s[numStart] === '}') {
            const openIdx = findMatchingOpenIndex(s, numStart);
            if (openIdx === -1) {
                searchFrom = slashIdx + 1;
                continue;
            }
            actualNumStart = openIdx;
            // Check if preceded by a macro or base like \sqrt{...} or x^{...}
            let prefixStart = openIdx - 1;
            if (s[numStart] === '}' && prefixStart >= 0 && (s[prefixStart] === '^' || s[prefixStart] === '_')) {
                prefixStart--;
                while (prefixStart >= 0 && /[A-Za-z0-9\\]/.test(s[prefixStart])) prefixStart--;
                actualNumStart = prefixStart + 1;
                numText = s.slice(actualNumStart, numEnd);
            } else if (s[numStart] === '}') {
                while (prefixStart >= 0 && /[A-Za-z\[\]\\]/.test(s[prefixStart])) prefixStart--;
                if (prefixStart + 1 < openIdx && s[prefixStart + 1] === '\\') {
                    actualNumStart = prefixStart + 1;
                    numText = s.slice(actualNumStart, numEnd);
                } else {
                    numText = s.slice(openIdx + 1, numStart);
                }
            } else {
                // Unwrap outer grouping ( ... ) or 〖 ... 〗
                numText = s.slice(openIdx + 1, numStart);
            }
        } else {
            let k = numStart;
            while (k >= 0 && /[A-Za-z0-9\\^_{}.]/.test(s[k])) k--;
            actualNumStart = k + 1;
            numText = s.slice(actualNumStart, numEnd);
        }

        if (!numText.trim()) {
            searchFrom = slashIdx + 1;
            continue;
        }

        // 2. Identify Denominator to the right of slashIdx
        let denStart = slashIdx + 1;
        while (denStart < s.length && s[denStart] === ' ') denStart++;
        if (denStart >= s.length) break;

        let actualDenEnd = denStart;
        let denText = '';

        if (s.slice(denStart).startsWith('\\sqrt')) {
            let cur = denStart + 5;
            if (s[cur] === '[') {
                const closeBr = findMatchingCloseIndex(s, cur);
                if (closeBr !== -1) cur = closeBr + 1;
            }
            if (s[cur] === '{') {
                const closeBrace = findMatchingCloseIndex(s, cur);
                if (closeBrace !== -1) {
                    actualDenEnd = closeBrace + 1;
                    denText = s.slice(denStart, actualDenEnd);
                }
            }
        } else if (s[denStart] === '(' || s[denStart] === '〖' || s[denStart] === '{') {
            const closeIdx = findMatchingCloseIndex(s, denStart);
            if (closeIdx === -1) {
                searchFrom = slashIdx + 1;
                continue;
            }
            actualDenEnd = closeIdx + 1;
            // Check if followed by an exponent like (x-1)^2
            if (s[actualDenEnd] === '^') {
                if (s[actualDenEnd + 1] === '{') {
                    const expClose = findMatchingCloseIndex(s, actualDenEnd + 1);
                    if (expClose !== -1) {
                        actualDenEnd = expClose + 1;
                        denText = s.slice(denStart, actualDenEnd);
                    }
                } else {
                    const expM = s.slice(actualDenEnd + 1).match(/^[A-Za-z0-9]+/);
                    if (expM) {
                        actualDenEnd += 1 + expM[0].length;
                        denText = s.slice(denStart, actualDenEnd);
                    }
                }
            }
            if (!denText) {
                denText = s.slice(denStart + 1, closeIdx);
            }
        } else {
            let k = denStart;
            while (k < s.length && /[A-Za-z0-9\\^_.]/.test(s[k])) {
                if (s[k] === '{') {
                    const c = findMatchingCloseIndex(s, k);
                    if (c !== -1) { k = c + 1; continue; }
                }
                k++;
            }
            if (k < s.length && s[k] === '{') {
                const c = findMatchingCloseIndex(s, k);
                if (c !== -1) k = c + 1;
            }
            actualDenEnd = k;
            denText = s.slice(denStart, actualDenEnd);
        }

        if (!denText.trim()) {
            searchFrom = slashIdx + 1;
            continue;
        }

        const replacement = `\\frac{${numText.trim()}}{${denText.trim()}}`;
        s = s.slice(0, actualNumStart) + replacement + s.slice(actualDenEnd);
        searchFrom = actualNumStart + replacement.length;
    }

    return s;
}

function convertRawMathExprToLatex(rawExpr) {
    if (!rawExpr) return '';
    let s = String(rawExpr)
        .replace(/\u00a0/g, ' ')
        .replace(/[−–]/g, '-');

    // 1. Convert Unicode superscripts & subscripts
    s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱ]+/g, match => {
        const mapped = Array.from(match).map(ch => UNICODE_SUPER_MAP[ch] ?? ch).join('');
        return `^{${mapped}}`;
    });
    s = s.replace(/[₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₒₓₕₖₗₘₙₚₛₜ]+/g, match => {
        const mapped = Array.from(match).map(ch => UNICODE_SUB_MAP[ch] ?? ch).join('');
        return `_{${mapped}}`;
    });

    // 2. Convert _( ... ) and ^( ... ) and _〖 ... 〗 and ^〖 ... 〗 into _{...} and ^{...}
    s = replaceBalancedSubSupGroups(s);

    // 3. Convert roots √(...), ∛(...), ∜(...) before fractions so dx/√((x-a)(x-b)) sees \sqrt{(x-a)(x-b)}
    s = replaceUnicodeRootsWithLatex(s);

    // 4. Remove Word n-ary placeholder ▒ (\u2592) and unwrap outer 〖 ... 〗 while keeping double-space side conditions
    s = s.replace(/▒/g, ' ');
    // Preserve double spaces before parenthesized conditions like "  (a>b)" as \quad
    s = s.replace(/\s{2,}(\([A-Za-z0-9<>≤≥≠=+\-,\s]+\))/g, ' \\quad $1');
    s = s.replace(/〖/g, '(').replace(/〗/g, ')');

    // If wrapping 〖...〗 turned the whole integrand into a single outer (...), e.g. ∫ (dx/\sqrt{...} \quad (a>b)), unwrap that redundant outer paren
    s = s.replace(/(∫|∬|∭|∮|∑|∏|\blim_\{[^}]+\}|\blim)\s*\(([\s\S]+)\)$/g, (full, op, inner) => {
        // Check if inner's parentheses are balanced
        let d = 0;
        for (let i = 0; i < inner.length; i++) {
            if (inner[i] === '(') d++;
            else if (inner[i] === ')') {
                d--;
                if (d < 0) return full;
            }
        }
        return d === 0 ? `${op} ${inner}` : full;
    });

    // 5. Convert inline fractions like dx/\sqrt{(x-a)(x-b)} or (a+b)/(c+d) to \frac{...}{...}
    s = convertInlineFractionsToFrac(s);

    // 6. Convert n-ary operators, symbols & Greek characters to LaTeX commands
    s = s
        .replace(/∭/g, '\\iiint ')
        .replace(/∬/g, '\\iint ')
        .replace(/∮/g, '\\oint ')
        .replace(/∫/g, '\\int ')
        .replace(/∑/g, '\\sum ')
        .replace(/∏/g, '\\prod ')
        .replace(/∂/g, '\\partial ')
        .replace(/∇/g, '\\nabla ')
        .replace(/∞/g, '\\infty ')
        .replace(/⇔/g, ' \\Leftrightarrow ')
        .replace(/⇒/g, ' \\Rightarrow ')
        .replace(/→|->/g, ' \\to ')
        .replace(/±/g, ' \\pm ')
        .replace(/∓/g, ' \\mp ')
        .replace(/×/g, ' \\times ')
        .replace(/÷/g, ' \\div ')
        .replace(/·/g, ' \\cdot ')
        .replace(/≤|<=/g, ' \\le ')
        .replace(/≥|>=/g, ' \\ge ')
        .replace(/≠|!=/g, ' \\neq ')
        .replace(/≈/g, ' \\approx ')
        .replace(/≡/g, ' \\equiv ')
        .replace(/∉/g, ' \\notin ')
        .replace(/∈/g, ' \\in ')
        .replace(/⊆/g, ' \\subseteq ')
        .replace(/⊂/g, ' \\subset ')
        .replace(/∪/g, ' \\cup ')
        .replace(/∩/g, ' \\cap ')
        .replace(/∅/g, ' \\emptyset ')
        .replace(/∀/g, ' \\forall ')
        .replace(/∃/g, ' \\exists ')
        .replace(/°/g, '^{\\circ}');

    Object.keys(GREEK_UNICODE_TO_LATEX).forEach(g => {
        if (s.includes(g)) {
            s = s.split(g).join(GREEK_UNICODE_TO_LATEX[g]);
        }
    });

    // 7. Prefix standard math functions (sin, cos, tan, log, ln, lim, etc.) with backslash if not already
    s = s.replace(/(^|[^\\A-Za-z])(arcsin|arccos|arctan|sinh|cosh|tanh|sin|cos|tan|cot|sec|csc|log|ln|lim|det|max|min)(?=\b|[_^({0-9])/g, '$1\\$2');

    return s.replace(/\s+/g, ' ').trim();
}

function normalizeMathStringForPasteOrRender(rawInput) {
    if (!rawInput) return '';
    const trimmed = String(rawInput).trim();

    // If the user already wrapped segments in $...$, convert any Word/UnicodeMath inside those $...$ segments
    if (/(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/.test(trimmed)) {
        return trimmed.replace(/\$([^$]+)\$/g, (_, inner) => {
            return hasRawUnicodeOrWordMath(inner) ? `$${convertRawMathExprToLatex(inner)}$` : `$${inner}$`;
        });
    }

    if (!hasRawUnicodeOrWordMath(trimmed)) {
        return trimmed;
    }

    // Check if there is a leading English instruction like "Evaluate ", "Find the value of ", "Integrate ", "Solve "
    const leadMatch = trimmed.match(/^((?:Evaluate|Integrate|Differentiate|Solve|Simplify|Find(?:\s+the\s+value\s+of)?|Calculate|Prove\s+that|If)\s*:?\s+)([\s\S]+)$/i);
    if (leadMatch && hasRawUnicodeOrWordMath(leadMatch[2])) {
        return `${leadMatch[1]}$${convertRawMathExprToLatex(leadMatch[2])}$`;
    }

    return `$${convertRawMathExprToLatex(trimmed)}$`;
}

function extractMathFromRichHtmlClipboard(html, plainText) {
    if (plainText && hasRawUnicodeOrWordMath(plainText)) {
        return normalizeMathStringForPasteOrRender(plainText);
    }
    if (!html) return normalizeMathStringForPasteOrRender(plainText);
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // 1. Replace KaTeX / MathJax / Wikipedia <annotation encoding="application/x-tex"> or data-tex / alttext with $...$
        doc.querySelectorAll('math, .katex, .MathJax, [data-tex], [data-latex]').forEach(node => {
            const annot = node.querySelector('annotation[encoding*="tex" i]');
            const tex = annot?.textContent || node.getAttribute('data-tex') || node.getAttribute('data-latex') || node.getAttribute('alttext');
            if (tex && tex.trim()) {
                const cleanTex = tex.trim().replace(/^\$+|\$+$/g, '');
                node.replaceWith(doc.createTextNode(`$${cleanTex}$`));
            }
        });

        // 2. Convert HTML <sup> and <sub> from Word / Google Docs / websites into superscript/subscript notation
        doc.querySelectorAll('sup').forEach(sup => {
            const t = (sup.textContent || '').trim();
            if (t) sup.replaceWith(doc.createTextNode(t.length === 1 ? `^${t}` : `^{${t}}`));
        });
        doc.querySelectorAll('sub').forEach(sub => {
            const t = (sub.textContent || '').trim();
            if (t) sub.replaceWith(doc.createTextNode(t.length === 1 ? `_${t}` : `_{${t}}`));
        });

        const extracted = (doc.body.textContent || '').replace(/\u00a0/g, ' ').trim();
        return normalizeMathStringForPasteOrRender(extracted || plainText);
    } catch (e) {
        return normalizeMathStringForPasteOrRender(plainText);
    }
}

function handleMathInputPaste(event) {
    if (!event || !event.clipboardData) return;
    const html = event.clipboardData.getData('text/html') || '';
    const plain = event.clipboardData.getData('text/plain') || '';
    if (!html && !plain) return;

    const shouldIntercept = hasRawUnicodeOrWordMath(plain)
        || /<(sup|sub|math|annotation)\b|data-tex|data-latex|katex|MathJax|Cambria Math|oMath/i.test(html);

    if (shouldIntercept) {
        event.preventDefault();
        const normalized = extractMathFromRichHtmlClipboard(html, plain);
        const targetEl = event.target;
        const start = typeof targetEl.selectionStart === 'number' ? targetEl.selectionStart : targetEl.value.length;
        const end = typeof targetEl.selectionEnd === 'number' ? targetEl.selectionEnd : targetEl.value.length;
        const val = targetEl.value || '';
        targetEl.value = val.slice(0, start) + normalized + val.slice(end);
        const nextPos = start + normalized.length;
        try { targetEl.setSelectionRange(nextPos, nextPos); } catch (e) {}
        syncMockEditorInputsToState();
        updateAllAdminMathPreviews();
    } else {
        setTimeout(() => {
            syncMockEditorInputsToState();
            updateAllAdminMathPreviews();
        }, 20);
    }
}

function prepareMathDisplayHtml(rawText) {
    if (!rawText) return '';
    let str = normalizeMathStringForPasteOrRender(String(rawText).trim());

    // Auto-wrap bare LaTeX expressions if the user pasted raw LaTeX without $...$ delimiters
    const hasMathDelimiters = /(\$\$[\s\S]+?\$\$|\$[^$]+?\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\])/.test(str);
    const hasLatexCommand = /\\(frac|dfrac|sqrt|int|iint|iiint|oint|sum|prod|lim|sin|cos|tan|cot|sec|csc|log|ln|alpha|beta|gamma|theta|pi|infty|pm|mp|le|leq|ge|geq|neq|approx|equiv|in|notin|subset|subseteq|cup|cap|emptyset|forall|exists|Rightarrow|Leftrightarrow|vec|hat|overline|overrightarrow|binom|begin\{|mathbb|quad)/i.test(str);

    if (!hasMathDelimiters && hasLatexCommand && window.katex) {
        try {
            return window.katex.renderToString(str, { throwOnError: false, displayMode: false });
        } catch (e) {}
    }
    return escapeHtml(str).replace(/\n/g, '<br>');
}

function triggerAdminKatexRender(containerEl) {
    if (!containerEl || !window.renderMathInElement) return;
    try {
        window.renderMathInElement(containerEl, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '$', right: '$', display: false },
                { left: '\\(', right: '\\)', display: false },
                { left: '\\[', right: '\\]', display: true }
            ],
            throwOnError: false
        });
    } catch (e) {}
}

function updateAllAdminMathPreviews() {
    if (!editingMockTest) return;
    (editingMockTest.questions || []).forEach((q, idx) => {
        const previewBox = document.getElementById(`mcqMathPreview_${idx}`);
        if (!previewBox) return;
        const qVal = (document.getElementById(`mcqText_${idx}`)?.value ?? q.text ?? '').trim();
        const optsHtml = ['A', 'B', 'C', 'D'].map(opt => {
            const oVal = (document.getElementById(`mcqOpt_${idx}_${opt}`)?.value ?? q.options?.[opt] ?? '').trim();
            return `<span style="display:inline-flex; align-items:center; gap:4px; margin-right:12px;"><strong>${opt}:</strong> <span>${oVal ? prepareMathDisplayHtml(oVal) : '—'}</span></span>`;
        }).join('');
        previewBox.innerHTML = `
            <div style="font-size:0.74rem; font-weight:700; text-transform:uppercase; color:var(--adm-text-muted); margin-bottom:4px;">Live Equation &amp; Formatting Preview</div>
            <div style="font-size:0.92rem; font-weight:600; margin-bottom:6px;">${qVal ? prepareMathDisplayHtml(qVal) : '<span style="color:var(--adm-text-muted); font-weight:400;">Type or paste a question above to preview equations...</span>'}</div>
            <div style="font-size:0.84rem; display:flex; flex-wrap:wrap; gap:6px;">${optsHtml}</div>
        `;
        triggerAdminKatexRender(previewBox);
    });
}

function renderMockTestsTab() {
    const mount = document.getElementById('mockTestsAdminMount');
    if (!mount || !ADMIN_STATE?.portals) return;

    SECTION_META.forEach(s => {
        document.getElementById(`mockClassBtn-${s.key}`)?.classList.toggle('active', s.key === activeMockClass);
    });

    const subjects = getAdminSubjects(activeMockClass);
    const activeSubject = getActiveMockSubject(activeMockClass);
    const secLabel = SECTION_META.find(s => s.key === activeMockClass)?.label || activeMockClass;

    if (editingMockTest) {
        const t = editingMockTest;
        const qs = Array.isArray(t.questions) ? t.questions : [];
        const activeCat = MATH_EQUATION_PALETTE[activeMathCategory] || MATH_EQUATION_PALETTE.algebra;

        mount.innerHTML = `
            <div class="adm-mock-editor">
                <div class="adm-mock-editor-head">
                    <div style="flex:1; min-width:260px;">
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
                            <button type="button" class="btn-topbar" style="padding:5px 10px; font-size:0.78rem;" onclick="cancelEditMockTest()">&larr; All Tests</button>
                            <span class="adm-status-pill ${t.status === 'published' ? 'open' : 'locked'}">${t.status === 'published' ? 'Published' : 'Draft'}</span>
                            <span style="font-size:0.8rem; color:var(--adm-text-muted);">${escapeHtml(secLabel)} &middot; ${escapeHtml(activeSubject.name)}</span>
                        </div>
                        <div class="adm-mock-title-row">
                            <input type="text" id="mockEditorTitle" class="adm-input" style="flex:1; min-width:220px; font-weight:600;" placeholder="Mock test title (e.g. Calculus Chapter 1 Mock Test)" value="${escapeHtml(t.title || '')}">
                            <div class="adm-time-limit-wrap">
                                <button type="button" class="btn-time-limit" id="btnSetTimeLimit" onclick="toggleMockTimeLimitEditor()">
                                    <i class="fa-regular fa-clock" aria-hidden="true"></i> Set Time Limit
                                </button>
                                <span class="adm-duration-badge" id="savedTimeLimitBadge">${Number(t.durationMinutes || 30)} min</span>
                            </div>
                        </div>
                        ${showTimeLimitEditor ? `
                            <div class="adm-time-limit-popover">
                                <label class="adm-label" style="margin:0;" for="mockTimeLimitInput">Duration (minutes):</label>
                                <input type="number" id="mockTimeLimitInput" class="adm-input" style="width:100px;" min="1" max="300" value="${Number(t.durationMinutes || 30)}">
                                <button type="button" class="btn-adm-dark" style="padding:7px 14px; font-size:0.82rem;" onclick="applyMockTimeLimit()">Apply</button>
                                <button type="button" class="btn-topbar" style="padding:7px 12px; font-size:0.82rem;" onclick="toggleMockTimeLimitEditor()">Cancel</button>
                            </div>
                        ` : ''}
                    </div>
                    <div style="min-width:150px;">
                        <label class="adm-label" for="mockEditorMinPlan">Minimum Plan</label>
                        <select id="mockEditorMinPlan" class="adm-select">
                            <option value="free" ${(t.minPlan || 'free') === 'free' ? 'selected' : ''}>Free</option>
                            <option value="gold" ${t.minPlan === 'gold' ? 'selected' : ''}>Gold</option>
                            <option value="diamond" ${t.minPlan === 'diamond' ? 'selected' : ''}>Diamond</option>
                        </select>
                    </div>
                </div>

                <!-- MATHEMATICS EQUATION BUILDER & COPY-PASTE PALETTE -->
                <div class="adm-card" style="margin:0 0 16px 0; padding:14px 16px; background:var(--adm-bg-subtle);">
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:10px;">
                        <div>
                            <strong style="font-size:0.88rem;"><i class="fa-solid fa-square-root-variable" aria-hidden="true"></i> Mathematics Equation Toolbar</strong>
                            <span style="font-size:0.78rem; color:var(--adm-text-muted); margin-left:8px;">Click any Question or Option box, then click an equation to insert — or copy &amp; paste equations directly from Word, PDF, ChatGPT, Wikipedia, or LaTeX.</span>
                        </div>
                        <span id="activeMathFieldBadge" class="adm-status-pill" style="font-size:0.72rem;">Inserting into: Question 1 Text</span>
                    </div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px;">
                        ${Object.entries(MATH_EQUATION_PALETTE).map(([k, cat]) => `
                            <button type="button" class="btn-topbar ${k === activeMathCategory ? 'btn-adm-dark' : ''}" style="padding:5px 11px; font-size:0.76rem; ${k === activeMathCategory ? 'background:#111114; color:#fff;' : ''}" onclick="switchMathPaletteCategory('${k}')">
                                ${escapeHtml(cat.label)}
                            </button>
                        `).join('')}
                    </div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap;">
                        ${activeCat.items.map((item, iIdx) => `
                            <button type="button" class="btn-topbar" style="padding:5px 10px; font-size:0.8rem; font-family:'Fira Code', monospace;" title="${escapeHtml(item.title)} (${escapeHtml(item.insert)})" onclick="insertMathSnippetAtCursor(MATH_EQUATION_PALETTE['${activeMathCategory}'].items[${iIdx}].insert)">
                                ${escapeHtml(item.label)}
                            </button>
                        `).join('')}
                    </div>
                </div>

                <div class="adm-mcq-list">
                    ${qs.length === 0 ? `<div class="adm-empty-note">No questions yet. Click "+ Add Question" below.</div>` : qs.map((q, idx) => `
                        <div class="adm-mcq-card">
                            <div class="adm-mcq-head">
                                <strong>Question ${idx + 1}</strong>
                                <div style="display:flex; gap:6px; align-items:center;">
                                    <button type="button" class="btn-topbar" style="padding:4px 9px; font-size:0.76rem;" ${idx === 0 ? 'disabled' : ''} onclick="moveMockQuestion(${idx}, -1)" title="Move up">&uarr;</button>
                                    <button type="button" class="btn-topbar" style="padding:4px 9px; font-size:0.76rem;" ${idx === qs.length - 1 ? 'disabled' : ''} onclick="moveMockQuestion(${idx}, 1)" title="Move down">&darr;</button>
                                    <button type="button" class="btn-topbar danger" style="padding:4px 9px; font-size:0.76rem;" onclick="removeMockQuestion(${idx})">Remove</button>
                                </div>
                            </div>
                            <textarea id="mcqText_${idx}" class="adm-textarea" rows="2" placeholder="Enter question or paste any math equation (e.g. Solve $x^2 - 5x + 6 = 0$ or \\frac{dy}{dx} = ...)" onfocus="trackMathInputFocus('mcqText_${idx}')" oninput="updateAllAdminMathPreviews()" onpaste="handleMathInputPaste(event)">${escapeHtml(q.text || '')}</textarea>
                            <div class="adm-mcq-options-grid">
                                ${['A', 'B', 'C', 'D'].map(opt => `
                                    <div class="adm-mcq-opt-row">
                                        <span class="adm-mcq-opt-label">${opt}</span>
                                        <input type="text" id="mcqOpt_${idx}_${opt}" class="adm-input" placeholder="Option ${opt} (supports equations)" value="${escapeHtml(q.options?.[opt] || '')}" onfocus="trackMathInputFocus('mcqOpt_${idx}_${opt}')" oninput="updateAllAdminMathPreviews()" onpaste="handleMathInputPaste(event)">
                                    </div>
                                `).join('')}
                            </div>
                            <div id="mcqMathPreview_${idx}" style="margin-top:10px; padding:10px 12px; border-radius:8px; background:var(--adm-bg-subtle); border:1px dashed var(--adm-border);"></div>
                            <div class="adm-correct-picker">
                                <span>Correct answer:</span>
                                ${['A', 'B', 'C', 'D'].map(opt => `
                                    <button type="button" class="adm-correct-chip ${(q.correctOption || 'A') === opt ? 'is-correct' : ''}" onclick="setMockQuestionCorrect(${idx}, '${opt}')">
                                        ${opt}
                                    </button>
                                `).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>

                <div style="margin-bottom:18px;">
                    <button type="button" class="btn-topbar" onclick="addMockQuestion()">
                        <i class="fa-solid fa-plus" aria-hidden="true"></i> + Add Question
                    </button>
                </div>

                <div class="adm-mock-editor-actions">
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                        <button type="button" class="btn-topbar" onclick="openAdminMockPreviewFromEditor()">
                            <i class="fa-regular fa-eye" aria-hidden="true"></i> Preview as Student
                        </button>
                        ${t.id ? `<button type="button" class="btn-topbar danger" onclick="deleteAdminMockTest('${escapeHtml(t.id)}')">Delete Test</button>` : ''}
                    </div>
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                        <button type="button" class="btn-topbar" onclick="saveAdminMockTest('draft')">Save Draft</button>
                        <button type="button" class="btn-adm-dark" onclick="saveAdminMockTest('published')">
                            ${t.status === 'published' ? 'Update Published Test' : 'Publish'}
                        </button>
                    </div>
                </div>
            </div>
        `;
        updateAllAdminMathPreviews();
        return;
    }

    const filteredTests = ADMIN_MOCK_TESTS.filter(
        t => t.classKey === activeMockClass && t.subjectId === activeSubject.id
    );

    mount.innerHTML = `
        <div class="adm-subject-toolbar">
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                <label class="adm-label" style="margin:0;" for="adminMockSubjectPicker">Subject:</label>
                <select id="adminMockSubjectPicker" class="adm-select compact" onchange="selectAdminMockSubject('${activeMockClass}', this.value)">
                    ${subjects.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === activeSubject.id ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}
                </select>
            </div>
            <button type="button" class="btn-adm-dark" style="padding:8px 15px; font-size:0.84rem;" onclick="startCreateMockTest()">
                <i class="fa-solid fa-clipboard-check" aria-hidden="true"></i> Create Mock Test
            </button>
        </div>

        <div class="adm-mock-list">
            ${filteredTests.length === 0 ? `
                <div class="adm-empty-note" style="padding:20px 6px;">
                    No mock tests created for ${escapeHtml(secLabel)} &middot; ${escapeHtml(activeSubject.name)} yet. Click <strong>Create Mock Test</strong> to start.
                </div>
            ` : filteredTests.map(t => {
                const qCount = (t.questions || []).length;
                const isPub = t.status === 'published';
                const safeId = escapeHtml(t.id);
                return `
                    <div class="adm-mock-row">
                        <div>
                            <div class="adm-mock-row-title">
                                <span>${escapeHtml(t.title)}</span>
                                <span class="adm-status-pill ${isPub ? 'open' : 'locked'}">${isPub ? 'Published' : 'Draft'}</span>
                                <span class="adm-type-pill">${escapeHtml((t.minPlan || 'free').toUpperCase())}</span>
                            </div>
                            <div class="adm-mock-row-meta">
                                <span>${qCount} ${qCount === 1 ? 'Question' : 'Questions'}</span>
                                <span><i class="fa-regular fa-clock" aria-hidden="true"></i> ${Number(t.durationMinutes || 30)} min</span>
                            </div>
                        </div>
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                            <button type="button" class="btn-topbar" style="padding:6px 11px; font-size:0.8rem;" onclick="editExistingMockTest('${safeId}')">Edit</button>
                            <button type="button" class="btn-topbar" style="padding:6px 11px; font-size:0.8rem;" onclick="openAdminMockPreviewById('${safeId}')">Preview</button>
                            <button type="button" class="btn-topbar" style="padding:6px 11px; font-size:0.8rem;" onclick="quickTogglePublishMockTest('${safeId}', '${isPub ? 'draft' : 'published'}')">${isPub ? 'Unpublish' : 'Publish'}</button>
                            <button type="button" class="btn-topbar danger" style="padding:6px 11px; font-size:0.8rem;" onclick="deleteAdminMockTest('${safeId}')">Delete</button>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

/* Interactive Student Preview Modal inside Admin */
function openAdminMockPreviewFromEditor() {
    syncMockEditorInputsToState();
    if (!editingMockTest) return;
    if ((editingMockTest.questions || []).length === 0) {
        showAdminToast('Add at least one question to preview.', 'error');
        return;
    }
    openAdminMockPreview(editingMockTest);
}

function openAdminMockPreviewById(testId) {
    const found = ADMIN_MOCK_TESTS.find(t => t.id === testId);
    if (found) openAdminMockPreview(found);
}

function openAdminMockPreview(testObj) {
    closeAdminMockPreview();
    const copy = JSON.parse(JSON.stringify(testObj));
    const secs = Math.max(1, Number(copy.durationMinutes || 30)) * 60;
    adminMockPreviewState = {
        test: copy,
        index: 0,
        answers: {},
        remainingSec: secs,
        submitted: false,
        timerId: null
    };
    const modal = document.getElementById('adminMockPreviewModal');
    const titleEl = document.getElementById('adminMockPreviewTitle');
    if (titleEl) titleEl.textContent = copy.title || 'Untitled Mock Test';
    if (modal) modal.style.display = 'flex';
    renderAdminMockPreviewBody();
    adminMockPreviewState.timerId = setInterval(() => {
        if (!adminMockPreviewState || adminMockPreviewState.submitted) return;
        adminMockPreviewState.remainingSec = Math.max(0, adminMockPreviewState.remainingSec - 1);
        const tEl = document.getElementById('admPreviewTimer');
        if (tEl) tEl.textContent = formatAdminPreviewClock(adminMockPreviewState.remainingSec);
        if (adminMockPreviewState.remainingSec <= 0) {
            submitAdminMockPreview();
        }
    }, 1000);
}

function formatAdminPreviewClock(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function closeAdminMockPreview() {
    if (adminMockPreviewState?.timerId) clearInterval(adminMockPreviewState.timerId);
    adminMockPreviewState = null;
    const modal = document.getElementById('adminMockPreviewModal');
    if (modal) modal.style.display = 'none';
}

function selectAdminMockPreviewAnswer(qId, opt) {
    if (!adminMockPreviewState || adminMockPreviewState.submitted) return;
    adminMockPreviewState.answers[qId] = opt;
    renderAdminMockPreviewBody();
}

function jumpAdminMockPreview(idx) {
    if (!adminMockPreviewState) return;
    adminMockPreviewState.index = idx;
    renderAdminMockPreviewBody();
}

function submitAdminMockPreview() {
    if (!adminMockPreviewState) return;
    if (adminMockPreviewState.timerId) clearInterval(adminMockPreviewState.timerId);
    adminMockPreviewState.submitted = true;
    renderAdminMockPreviewBody();
}

function renderAdminMockPreviewBody() {
    const body = document.getElementById('adminMockPreviewBody');
    if (!body || !adminMockPreviewState) return;
    const { test, index, answers, remainingSec, submitted } = adminMockPreviewState;
    const qs = test.questions || [];

    if (submitted) {
        let correct = 0, wrong = 0, skipped = 0;
        const rows = qs.map((q, i) => {
            const picked = answers[q.id] || null;
            const corr = (q.correctOption || 'A').toUpperCase();
            const st = !picked ? 'skipped' : (picked === corr ? 'correct' : 'wrong');
            if (st === 'correct') correct++;
            else if (st === 'wrong') wrong++;
            else skipped++;
            return `
                <div class="adm-mcq-card" style="margin-bottom:10px;">
                    <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                        <strong>Q${i + 1}: ${prepareMathDisplayHtml(q.text || '')}</strong>
                        <span class="adm-status-pill ${st === 'correct' ? 'open' : 'locked'}">${st.toUpperCase()}</span>
                    </div>
                    <div style="font-size:0.84rem; color:var(--adm-text-muted);">
                        Your answer: <strong>${picked || 'Skipped'}</strong> &middot; Correct answer: <strong>${corr} (${prepareMathDisplayHtml(q.options?.[corr] || '')})</strong>
                    </div>
                </div>
            `;
        }).join('');

        body.innerHTML = `
            <div style="margin-bottom:14px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <div><strong>Preview Score: ${correct} / ${qs.length}</strong> (Correct: ${correct} &middot; Wrong: ${wrong} &middot; Skipped: ${skipped})</div>
                <button type="button" class="btn-topbar" onclick="openAdminMockPreview(adminMockPreviewState.test)">Restart Preview</button>
            </div>
            ${rows}
        `;
        triggerAdminKatexRender(body);
        return;
    }

    const q = qs[index] || qs[0];
    const picked = answers[q.id] || '';
    body.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
            <span style="font-size:0.86rem; color:var(--adm-text-muted);">Question ${index + 1} of ${qs.length}</span>
            <span class="adm-duration-badge"><i class="fa-regular fa-clock" style="margin-right:6px;"></i><span id="admPreviewTimer">${formatAdminPreviewClock(remainingSec)}</span></span>
        </div>
        <div style="font-size:1rem; font-weight:600; margin-bottom:14px; white-space:pre-wrap;">${prepareMathDisplayHtml(q.text || '(No question text yet)')}</div>
        <div>
            ${['A', 'B', 'C', 'D'].map(opt => `
                <button type="button" class="adm-preview-opt-btn ${picked === opt ? 'selected' : ''}" onclick="selectAdminMockPreviewAnswer('${escapeHtml(q.id)}', '${opt}')">
                    <span class="adm-mcq-opt-label">${opt}</span>
                    <span>${prepareMathDisplayHtml(q.options?.[opt] || '(Empty option)')}</span>
                </button>
            `).join('')}
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:16px;">
            <button type="button" class="btn-topbar" ${index === 0 ? 'disabled' : ''} onclick="jumpAdminMockPreview(${index - 1})">&larr; Previous</button>
            <div style="display:flex; gap:8px;">
                ${index < qs.length - 1 ? `<button type="button" class="btn-adm-dark" style="padding:7px 14px;" onclick="jumpAdminMockPreview(${index + 1})">Next &rarr;</button>` : ''}
                <button type="button" class="btn-adm-dark" style="padding:7px 14px;" onclick="submitAdminMockPreview()">Submit Preview</button>
            </div>
        </div>
    `;
    triggerAdminKatexRender(body);
}

/* --------------------------------------------------------------------------
   4.6. TAB 2.6: ZOOM CLASSES (NEPAL TIME SCHEDULE MANAGER)
   -------------------------------------------------------------------------- */
function getAdminZoomClasses() {
    return Array.isArray(ADMIN_STATE?.zoomClasses) ? ADMIN_STATE.zoomClasses : [];
}

function startCreateZoomClass() {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    editingZoomClass = {
        id: '',
        title: '',
        classKey: 'class-12',
        subject: 'Mathematics',
        teacher: 'Bishnu Prasad Gautam (BPG Sir)',
        date: tomorrow,
        startTime: '06:30',
        durationMinutes: 60,
        zoomUrl: '',
        instructions: '',
        status: 'scheduled',
        minPlan: 'free'
    };
    renderZoomClassesTab();
}

function startEditZoomClass(zoomId) {
    const found = getAdminZoomClasses().find(z => z.id === zoomId);
    if (!found) return;
    editingZoomClass = JSON.parse(JSON.stringify(found));
    renderZoomClassesTab();
}

function cancelZoomClassEdit() {
    editingZoomClass = null;
    renderZoomClassesTab();
}

async function handleSaveZoomClass(e) {
    e.preventDefault();
    const title = (document.getElementById('zcTitle')?.value || '').trim();
    const classKey = document.getElementById('zcClassKey')?.value || 'class-12';
    const subject = (document.getElementById('zcSubject')?.value || '').trim() || 'Mathematics';
    const teacher = (document.getElementById('zcTeacher')?.value || '').trim() || 'Bishnu Prasad Gautam (BPG Sir)';
    const date = (document.getElementById('zcDate')?.value || '').trim();
    const startTime = (document.getElementById('zcStartTime')?.value || '06:30').trim();
    const durationMinutes = Math.max(10, Math.min(480, parseInt(document.getElementById('zcDuration')?.value || '60', 10) || 60));
    const zoomUrl = (document.getElementById('zcZoomUrl')?.value || '').trim();
    const instructions = (document.getElementById('zcInstructions')?.value || '').trim();
    const minPlan = document.getElementById('zcMinPlan')?.value || 'free';

    if (!title || !date) {
        showAdminToast('Class title and date are required.', 'error');
        return;
    }

    const list = JSON.parse(JSON.stringify(getAdminZoomClasses()));
    const record = {
        id: editingZoomClass?.id || `zc_${Date.now()}`,
        title,
        classKey,
        subject,
        teacher,
        date,
        startTime,
        durationMinutes,
        zoomUrl,
        instructions,
        status: editingZoomClass?.status === 'cancelled' ? 'cancelled' : 'scheduled',
        minPlan,
        adminAssignedPlan: true,
        updatedAt: new Date().toISOString()
    };

    const idx = list.findIndex(z => z.id === record.id);
    if (idx >= 0) list[idx] = record;
    else list.push(record);

    editingZoomClass = null;
    await persistAcademyState({ zoomClasses: list }, idx >= 0 ? 'Zoom class updated.' : 'Zoom class scheduled.');
}

async function toggleCancelZoomClass(zoomId) {
    const list = JSON.parse(JSON.stringify(getAdminZoomClasses()));
    const item = list.find(z => z.id === zoomId);
    if (!item) return;
    item.status = item.status === 'cancelled' ? 'scheduled' : 'cancelled';
    item.updatedAt = new Date().toISOString();
    await persistAcademyState(
        { zoomClasses: list },
        item.status === 'cancelled' ? 'Zoom class cancelled.' : 'Zoom class restored.'
    );
}

async function deleteZoomClass(zoomId) {
    if (!confirm('Delete this Zoom class permanently?')) return;
    const list = getAdminZoomClasses().filter(z => z.id !== zoomId);
    if (editingZoomClass && editingZoomClass.id === zoomId) editingZoomClass = null;
    await persistAcademyState({ zoomClasses: list }, 'Zoom class deleted.');
}

function renderZoomClassesTab() {
    const mount = document.getElementById('zoomClassesAdminMount');
    if (!mount || !ADMIN_STATE) return;

    const list = getAdminZoomClasses()
        .slice()
        .sort((a, b) => `${a.date || ''} ${a.startTime || ''}`.localeCompare(`${b.date || ''} ${b.startTime || ''}`));

    const classLabel = { 'class-12': 'Class 12', 'class-11': 'Class 11', 'class-10': 'Class 10', 'after-12': 'Entrance Prep', all: 'All Programs' };

    const editorHtml = editingZoomClass ? `
        <form class="adm-mock-editor" style="margin-bottom:18px;" onsubmit="handleSaveZoomClass(event)">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                <strong>${editingZoomClass.id ? 'Edit / Reschedule Zoom Class' : 'Schedule New Zoom Class'}</strong>
                <button type="button" class="btn-topbar" style="padding:5px 10px; font-size:0.78rem;" onclick="cancelZoomClassEdit()">Cancel</button>
            </div>
            <div class="adm-form-grid-2" style="margin-bottom:12px;">
                <div>
                    <label class="adm-label" for="zcTitle">Class Title</label>
                    <input type="text" id="zcTitle" class="adm-input" value="${escapeHtml(editingZoomClass.title)}" placeholder="e.g. Grade XII Calculus Live Doubt Session" required>
                </div>
                <div>
                    <label class="adm-label" for="zcClassKey">Grade / Program</label>
                    <select id="zcClassKey" class="adm-select">
                        <option value="class-12" ${editingZoomClass.classKey === 'class-12' ? 'selected' : ''}>Class 12</option>
                        <option value="class-11" ${editingZoomClass.classKey === 'class-11' ? 'selected' : ''}>Class 11</option>
                        <option value="class-10" ${editingZoomClass.classKey === 'class-10' ? 'selected' : ''}>Class 10</option>
                        <option value="after-12" ${editingZoomClass.classKey === 'after-12' ? 'selected' : ''}>Entrance Prep</option>
                        <option value="all" ${editingZoomClass.classKey === 'all' ? 'selected' : ''}>All Programs</option>
                    </select>
                </div>
            </div>
            <div class="adm-form-grid-3" style="margin-bottom:12px;">
                <div>
                    <label class="adm-label" for="zcSubject">Subject</label>
                    <input type="text" id="zcSubject" class="adm-input" value="${escapeHtml(editingZoomClass.subject)}" placeholder="Mathematics" required>
                </div>
                <div>
                    <label class="adm-label" for="zcTeacher">Teacher</label>
                    <input type="text" id="zcTeacher" class="adm-input" value="${escapeHtml(editingZoomClass.teacher)}" placeholder="Bishnu Prasad Gautam (BPG Sir)" required>
                </div>
                <div>
                    <label class="adm-label" for="zcMinPlan">Minimum Plan</label>
                    <select id="zcMinPlan" class="adm-select">
                        <option value="free" ${(editingZoomClass.minPlan || 'free') === 'free' ? 'selected' : ''}>Free</option>
                        <option value="gold" ${editingZoomClass.minPlan === 'gold' ? 'selected' : ''}>Gold</option>
                        <option value="diamond" ${editingZoomClass.minPlan === 'diamond' ? 'selected' : ''}>Diamond</option>
                    </select>
                </div>
            </div>
            <div class="adm-form-grid-3" style="margin-bottom:12px;">
                <div>
                    <label class="adm-label" for="zcDate">Date (Nepal Time)</label>
                    <input type="date" id="zcDate" class="adm-input" value="${escapeHtml(editingZoomClass.date)}" required>
                </div>
                <div>
                    <label class="adm-label" for="zcStartTime">Start Time (NPT · UTC+5:45)</label>
                    <input type="time" id="zcStartTime" class="adm-input" value="${escapeHtml(editingZoomClass.startTime || '06:30')}" required>
                </div>
                <div>
                    <label class="adm-label" for="zcDuration">Duration (minutes)</label>
                    <input type="number" id="zcDuration" class="adm-input" min="10" max="480" value="${Number(editingZoomClass.durationMinutes || 60)}" required>
                </div>
            </div>
            <div style="margin-bottom:12px;">
                <label class="adm-label" for="zcZoomUrl">Zoom Participant Link</label>
                <input type="url" id="zcZoomUrl" class="adm-input" value="${escapeHtml(editingZoomClass.zoomUrl)}" placeholder="https://zoom.us/j/..." required>
            </div>
            <div style="margin-bottom:14px;">
                <label class="adm-label" for="zcInstructions">Optional Class Instructions</label>
                <textarea id="zcInstructions" class="adm-textarea" rows="2" placeholder="e.g. Bring your notebook and scientific calculator...">${escapeHtml(editingZoomClass.instructions || '')}</textarea>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:8px;">
                <button type="button" class="btn-topbar" onclick="cancelZoomClassEdit()">Cancel</button>
                <button type="submit" class="btn-adm-dark">Save Zoom Class</button>
            </div>
        </form>
    ` : '';

    mount.innerHTML = `
        ${editorHtml}
        <div class="adm-mock-list">
            ${list.length === 0 ? `<div class="adm-empty-note">No Zoom classes scheduled yet. Click "+ Schedule Zoom Class" to create one.</div>` : list.map(zc => {
                const isCancelled = zc.status === 'cancelled';
                const safeId = escapeHtml(zc.id);
                return `
                    <div class="adm-mock-row">
                        <div>
                            <div class="adm-mock-row-title">
                                <span>${escapeHtml(zc.title)}</span>
                                <span class="adm-status-pill ${isCancelled ? 'locked' : 'open'}">${isCancelled ? 'Cancelled' : 'Scheduled'}</span>
                                <span class="adm-type-pill">${escapeHtml(classLabel[zc.classKey] || zc.classKey)}</span>
                                <span class="adm-type-pill">${escapeHtml((zc.minPlan || 'free').toUpperCase())}</span>
                            </div>
                            <div class="adm-mock-row-meta">
                                <span>${escapeHtml(zc.subject)} &middot; ${escapeHtml(zc.teacher)}</span>
                                <span><strong>${escapeHtml(zc.date)}</strong> at <strong>${escapeHtml(zc.startTime)} NPT</strong> (${Number(zc.durationMinutes || 60)} min)</span>
                            </div>
                        </div>
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                            <button type="button" class="btn-topbar" style="padding:6px 11px; font-size:0.8rem;" onclick="startEditZoomClass('${safeId}')">Edit</button>
                            <button type="button" class="btn-topbar" style="padding:6px 11px; font-size:0.8rem;" onclick="toggleCancelZoomClass('${safeId}')">${isCancelled ? 'Restore' : 'Cancel Class'}</button>
                            <button type="button" class="btn-topbar danger" style="padding:6px 11px; font-size:0.8rem;" onclick="deleteZoomClass('${safeId}')">Delete</button>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

/* --------------------------------------------------------------------------
   4.7. TAB 2.7: TEAM PROFILES MANAGER (HOMEPAGE OUR TEAM)
   -------------------------------------------------------------------------- */
function getAdminTeamMembers() {
    return Array.isArray(ADMIN_STATE?.teamMembers) ? ADMIN_STATE.teamMembers : [];
}

function startAddTeamMember() {
    editingTeamMember = {
        id: '',
        slot: 'member',
        name: '',
        role: '',
        photoUrl: '',
        bio: ''
    };
    pendingTeamPhotoDataUrl = '';
    renderTeamTab();
}

function startEditTeamMember(memberId) {
    const found = getAdminTeamMembers().find(m => m.id === memberId);
    if (!found) return;
    editingTeamMember = JSON.parse(JSON.stringify(found));
    pendingTeamPhotoDataUrl = found.photoUrl || '';
    renderTeamTab();
}

function cancelTeamMemberEdit() {
    editingTeamMember = null;
    pendingTeamPhotoDataUrl = '';
    renderTeamTab();
}

async function handleTeamPhotoFileChange(inputEl) {
    const file = inputEl?.files?.[0];
    if (!file) return;
    try {
        const dataUrl = await readFileAsDataUrl(file);
        pendingTeamPhotoDataUrl = dataUrl;
        const preview = document.getElementById('teamPhotoPreviewImg');
        if (preview) {
            preview.innerHTML = `<img src="${dataUrl}" alt="Photo preview" style="width:100%; height:100%; object-fit:cover;">`;
        }
    } catch (e) {}
}

async function handleSaveTeamMember(e) {
    e.preventDefault();
    const name = (document.getElementById('tmName')?.value || '').trim();
    const slot = document.getElementById('tmSlot')?.value || 'member';
    const role = slot === 'founder' ? 'Founder' : '';
    const photoUrlInput = (document.getElementById('tmPhotoUrl')?.value || '').trim();
    if (!name) {
        showAdminToast('Full name is required.', 'error');
        return;
    }

    const photoUrl = pendingTeamPhotoDataUrl && pendingTeamPhotoDataUrl.startsWith('data:image/')
        ? pendingTeamPhotoDataUrl
        : photoUrlInput;

    const list = JSON.parse(JSON.stringify(getAdminTeamMembers()));
    const record = {
        id: editingTeamMember?.id || `team_${Date.now()}`,
        slot,
        name,
        role,
        photoUrl,
        bio: ''
    };

    const idx = list.findIndex(m => m.id === record.id);
    if (idx >= 0) list[idx] = record;
    else list.push(record);

    editingTeamMember = null;
    pendingTeamPhotoDataUrl = '';
    await persistAcademyState({ teamMembers: list }, idx >= 0 ? 'Team profile updated.' : 'Team profile added.');
}

async function deleteTeamMember(memberId) {
    if (!confirm('Remove this team profile from the homepage?')) return;
    const list = getAdminTeamMembers().filter(m => m.id !== memberId);
    if (editingTeamMember && editingTeamMember.id === memberId) editingTeamMember = null;
    await persistAcademyState({ teamMembers: list }, 'Team profile removed.');
}

function renderTeamTab() {
    const mount = document.getElementById('teamAdminMount');
    if (!mount || !ADMIN_STATE) return;

    const members = getAdminTeamMembers();
    const slotLabels = {
        founder: 'Row 1 · Founder (Centered)',
        ceo: 'Row 2 · Team Member (1st)',
        cco: 'Row 2 · Team Member (2nd)',
        cto: 'Row 2 · Team Member (3rd)',
        member: 'Row 2 · Team Member'
    };

    const editorHtml = editingTeamMember ? `
        <form class="adm-mock-editor" style="margin-bottom:18px;" onsubmit="handleSaveTeamMember(event)">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                <strong>${editingTeamMember.id ? 'Edit Team Member (Name &amp; Photo)' : 'Add Team Member (Name &amp; Photo)'}</strong>
                <button type="button" class="btn-topbar" style="padding:5px 10px; font-size:0.78rem;" onclick="cancelTeamMemberEdit()">Cancel</button>
            </div>
            <div class="adm-form-grid-2" style="margin-bottom:12px;">
                <div>
                    <label class="adm-label" for="tmName">Full Name</label>
                    <input type="text" id="tmName" class="adm-input" value="${escapeHtml(editingTeamMember.name)}" placeholder="e.g. Paribesh Thapa" required>
                </div>
                <div>
                    <label class="adm-label" for="tmSlot">Homepage Row Position</label>
                    <select id="tmSlot" class="adm-select">
                        <option value="founder" ${editingTeamMember.slot === 'founder' ? 'selected' : ''}>Row 1 · Founder (Centered)</option>
                        <option value="ceo" ${editingTeamMember.slot === 'ceo' ? 'selected' : ''}>Row 2 · Team Member (1st)</option>
                        <option value="cco" ${editingTeamMember.slot === 'cco' ? 'selected' : ''}>Row 2 · Team Member (2nd)</option>
                        <option value="cto" ${editingTeamMember.slot === 'cto' ? 'selected' : ''}>Row 2 · Team Member (3rd)</option>
                        <option value="member" ${editingTeamMember.slot === 'member' ? 'selected' : ''}>Row 2 · Additional Team Member</option>
                    </select>
                </div>
            </div>
            <div class="adm-form-grid-2" style="margin-bottom:12px; align-items:end;">
                <div>
                    <label class="adm-label" for="tmPhotoFile">Upload Photo</label>
                    <input type="file" id="tmPhotoFile" class="adm-input" accept="image/*" onchange="handleTeamPhotoFileChange(this)">
                </div>
                <div>
                    <label class="adm-label" for="tmPhotoUrl">Or Photo URL</label>
                    <input type="text" id="tmPhotoUrl" class="adm-input" value="${escapeHtml(editingTeamMember.photoUrl && !editingTeamMember.photoUrl.startsWith('data:') ? editingTeamMember.photoUrl : '')}" placeholder="./images/bpg_sir.jpg or https://...">
                </div>
            </div>
            <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px;">
                <div class="adm-team-thumb" id="teamPhotoPreviewImg">
                    ${(pendingTeamPhotoDataUrl || editingTeamMember.photoUrl) ? `<img src="${escapeHtml(pendingTeamPhotoDataUrl || editingTeamMember.photoUrl)}" alt="Preview">` : escapeHtml((editingTeamMember.name || 'T').charAt(0).toUpperCase())}
                </div>
                <span style="font-size:0.8rem; color:var(--adm-text-muted);">Photo preview (only Name and Photo are displayed on the homepage)</span>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:8px;">
                <button type="button" class="btn-topbar" onclick="cancelTeamMemberEdit()">Cancel</button>
                <button type="submit" class="btn-adm-dark">Save Profile</button>
            </div>
        </form>
    ` : '';

    mount.innerHTML = `
        ${editorHtml}
        <div class="adm-team-grid">
            ${members.length === 0 ? `<div class="adm-empty-note">No team profiles yet. Click "+ Add Team Member" to add one.</div>` : members.map(m => {
                const safeId = escapeHtml(m.id);
                const init = (m.name || 'T').trim().charAt(0).toUpperCase();
                return `
                    <div class="adm-team-card">
                        <div class="adm-team-card-head">
                            <div class="adm-team-thumb">
                                ${m.photoUrl ? `<img src="${escapeHtml(m.photoUrl)}" alt="${escapeHtml(m.name)}">` : init}
                            </div>
                            <div style="min-width:0;">
                                <strong style="display:block; font-size:0.96rem;">${escapeHtml(m.name)}</strong>
                                <div style="font-size:0.75rem; color:var(--adm-text-muted); margin-top:2px;">${escapeHtml(slotLabels[m.slot] || 'Row 2 · Team Member')}</div>
                            </div>
                        </div>
                        <div style="display:flex; gap:6px; margin-top:auto;">
                            <button type="button" class="btn-topbar" style="padding:5px 11px; font-size:0.78rem;" onclick="startEditTeamMember('${safeId}')">Edit Photo / Name</button>
                            <button type="button" class="btn-topbar danger" style="padding:5px 11px; font-size:0.78rem;" onclick="deleteTeamMember('${safeId}')">Remove</button>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

/* --------------------------------------------------------------------------
   5. TAB 3: SECTION ACCESS (OPEN / LOCKED)
   -------------------------------------------------------------------------- */
function renderSectionAccessTab() {
    if (typeof renderMaintenanceSettings === 'function') renderMaintenanceSettings();
    if (typeof renderSiteSettings === 'function') renderSiteSettings();
    const mount = document.getElementById('sectionAccessList');
    if (!mount || !ADMIN_STATE) return;

    const locks = ADMIN_STATE.sectionLocks || {};
    mount.innerHTML = SECTION_META.map(sec => {
        const lock = locks[sec.key] || { locked: false, reason: '' };
        const isLocked = Boolean(lock.locked);
        return `
            <div class="adm-section-card ${isLocked ? 'is-locked' : 'is-open'}">
                <div class="adm-section-top">
                    <div>
                        <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                            <strong>${sec.label}</strong>
                            <span class="adm-status-pill ${isLocked ? 'locked' : 'open'}">${isLocked ? 'Locked' : 'Open'}</span>
                        </div>
                        <small style="color:var(--adm-text-muted);">${sec.sub}</small>
                    </div>
                    <button type="button" class="btn-toggle-lock ${isLocked ? 'locked' : 'open'}" onclick="toggleSectionLock('${sec.key}')">
                        ${isLocked ? 'Reopen Section' : 'Lock Section'}
                    </button>
                </div>
                <div style="margin-top:12px;">
                    <label class="adm-label" style="margin-bottom:4px;">Message shown when locked</label>
                    <div style="display:flex; gap:8px;">
                        <input type="text" class="adm-input" id="lockReason-${sec.key}" value="${escapeHtml(lock.reason || 'Temporarily unavailable')}" placeholder="Temporarily unavailable">
                        <button type="button" class="btn-topbar" onclick="saveSectionReason('${sec.key}')">Save</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

async function toggleSectionLock(sectionKey) {
    const current = ADMIN_STATE?.sectionLocks?.[sectionKey] || { locked: false, reason: 'Temporarily unavailable' };
    const nextLocked = !current.locked;
    const reasonInput = document.getElementById(`lockReason-${sectionKey}`)?.value.trim() || 'Temporarily unavailable';

    await persistAcademyState({
        sectionLocks: {
            [sectionKey]: {
                locked: nextLocked,
                reason: nextLocked ? reasonInput : ''
            }
        }
    }, nextLocked ? 'Section locked.' : 'Section reopened.');
}

async function saveSectionReason(sectionKey) {
    const current = ADMIN_STATE?.sectionLocks?.[sectionKey] || { locked: false, reason: '' };
    const reason = document.getElementById(`lockReason-${sectionKey}`)?.value.trim() || 'Temporarily unavailable';

    await persistAcademyState({
        sectionLocks: {
            [sectionKey]: {
                locked: Boolean(current.locked),
                reason
            }
        }
    }, 'Lock message saved.');
}

/* --------------------------------------------------------------------------
   6. TAB 4: PLANS & ACCESS
   -------------------------------------------------------------------------- */
function renderPlansTab() {
    renderPlanSettingsEditor();
    renderPlanAccessTable();
    renderPlanStudentPreview();
}

function renderPlanSettingsEditor() {
    const mount = document.getElementById('planSettingsGrid');
    if (!mount || !ADMIN_STATE) return;

    const plans = ADMIN_STATE.plansConfig || {};
    const tiers = ['free', 'gold', 'diamond'];

    mount.innerHTML = tiers.map(pid => {
        const p = plans[pid] || { name: pid, price: '', period: '', description: '' };
        return `
            <div class="adm-plan-editor-card">
                <div class="adm-box-label" style="text-transform:uppercase;">${pid} tier</div>
                <div style="margin-bottom:10px;">
                    <label class="adm-label">Plan Name</label>
                    <input type="text" class="adm-input" id="planName-${pid}" value="${escapeHtml(p.name || pid)}">
                </div>
                <div class="adm-form-row-2" style="margin-bottom:10px;">
                    <div>
                        <label class="adm-label">Price</label>
                        <input type="text" class="adm-input" id="planPrice-${pid}" value="${escapeHtml(p.price || '')}">
                    </div>
                    <div>
                        <label class="adm-label">Period</label>
                        <input type="text" class="adm-input" id="planPeriod-${pid}" value="${escapeHtml(p.period || '')}">
                    </div>
                </div>
                <div>
                    <label class="adm-label">Description</label>
                    <textarea class="adm-textarea" rows="2" id="planDesc-${pid}">${escapeHtml(p.description || '')}</textarea>
                </div>
            </div>
        `;
    }).join('');
}

async function savePlanSettings() {
    const plansConfig = {};
    ['free', 'gold', 'diamond'].forEach(pid => {
        plansConfig[pid] = {
            id: pid,
            name: (document.getElementById(`planName-${pid}`)?.value || pid).trim(),
            price: (document.getElementById(`planPrice-${pid}`)?.value || '').trim(),
            period: (document.getElementById(`planPeriod-${pid}`)?.value || '').trim(),
            description: (document.getElementById(`planDesc-${pid}`)?.value || '').trim()
        };
    });

    await persistAcademyState({ plansConfig }, 'Plan details saved.');
}

function collectAllContentItems() {
    const items = [];
    SECTION_META.forEach(sec => {
        const subjects = getAdminSubjects(sec.key);
        subjects.forEach(subj => {
            (subj.lessons || []).forEach(l => {
                (l.pdfs || []).forEach(pdf => {
                    items.push({
                        compositeKey: `${sec.key}|lesson-pdf|${subj.id}|${l.id}|${pdf.id}`,
                        classKey: sec.key,
                        sectionLabel: `${sec.label} · ${subj.name}`,
                        type: 'lesson-pdf',
                        typeLabel: 'PDF',
                        title: `${l.title}: ${pdf.title || pdf.fileName}`,
                        minPlan: (pdf.minPlan || 'free').toLowerCase()
                    });
                });
                (l.videos || []).forEach(vid => {
                    items.push({
                        compositeKey: `${sec.key}|lesson-video|${subj.id}|${l.id}|${vid.id}`,
                        classKey: sec.key,
                        sectionLabel: `${sec.label} · ${subj.name}`,
                        type: 'lesson-video',
                        typeLabel: 'Video',
                        title: `${l.title}: ${vid.title}`,
                        minPlan: (vid.minPlan || 'free').toLowerCase()
                    });
                });
            });
        });
    });

    (ADMIN_MOCK_TESTS || []).forEach(mt => {
        const secLabel = SECTION_META.find(s => s.key === mt.classKey)?.label || mt.classKey;
        items.push({
            compositeKey: `${mt.classKey}|mock-test|${mt.subjectId || 'mathematics'}|mock|${mt.id}`,
            classKey: mt.classKey,
            sectionLabel: `${secLabel} · Mock Test`,
            type: 'mock-test',
            typeLabel: 'Mock Test',
            title: mt.title,
            minPlan: (mt.minPlan || 'free').toLowerCase()
        });
    });

    getAdminZoomClasses().forEach(zc => {
        const secLabel = SECTION_META.find(s => s.key === zc.classKey)?.label || (zc.classKey === 'all' ? 'All Programs' : zc.classKey);
        items.push({
            compositeKey: `${zc.classKey}|zoom-class|zoom|zoom|${zc.id}`,
            classKey: zc.classKey,
            sectionLabel: `${secLabel} · Zoom`,
            type: 'zoom-class',
            typeLabel: 'Zoom Class',
            title: `${zc.title} (${zc.date})`,
            minPlan: (zc.minPlan || 'free').toLowerCase()
        });
    });

    return items;
}

function renderPlanAccessTable() {
    const tbody = document.getElementById('planAccessTableBody');
    if (!tbody || !ADMIN_STATE) return;

    const filterClass = document.getElementById('planFilterClass')?.value || 'all';
    const filterType = document.getElementById('planFilterType')?.value || 'all';

    const items = collectAllContentItems().filter(it => {
        if (filterClass !== 'all' && it.classKey !== filterClass) return false;
        if (filterType !== 'all' && it.type !== filterType) return false;
        return true;
    });

    const countEl = document.getElementById('bulkSelectedCount');
    if (countEl) countEl.textContent = `${selectedPlanItemKeys.size} selected`;

    if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:24px; color:var(--adm-text-muted);">No uploaded PDFs or videos yet. Upload content in the Content tab.</td></tr>`;
        return;
    }

    tbody.innerHTML = items.map(it => {
        const checked = selectedPlanItemKeys.has(it.compositeKey) ? 'checked' : '';
        const escKey = escapeHtml(it.compositeKey);
        return `
            <tr>
                <td><input type="checkbox" ${checked} onchange="togglePlanItemSelection('${escKey}', this.checked)"></td>
                <td>${escapeHtml(it.sectionLabel)}</td>
                <td><span class="adm-type-pill">${it.typeLabel}</span></td>
                <td><strong>${escapeHtml(it.title)}</strong></td>
                <td>
                    <select class="adm-select compact" onchange="assignSingleContentPlan('${escKey}', this.value)">
                        <option value="free" ${it.minPlan === 'free' ? 'selected' : ''}>Free</option>
                        <option value="gold" ${it.minPlan === 'gold' ? 'selected' : ''}>Gold</option>
                        <option value="diamond" ${it.minPlan === 'diamond' ? 'selected' : ''}>Diamond</option>
                    </select>
                </td>
            </tr>
        `;
    }).join('');
}

function togglePlanItemSelection(compositeKey, isChecked) {
    if (isChecked) selectedPlanItemKeys.add(compositeKey);
    else selectedPlanItemKeys.delete(compositeKey);
    const countEl = document.getElementById('bulkSelectedCount');
    if (countEl) countEl.textContent = `${selectedPlanItemKeys.size} selected`;
}

function toggleSelectAllPlanItems(isChecked) {
    const filterClass = document.getElementById('planFilterClass')?.value || 'all';
    const filterType = document.getElementById('planFilterType')?.value || 'all';
    const visible = collectAllContentItems().filter(it => {
        if (filterClass !== 'all' && it.classKey !== filterClass) return false;
        if (filterType !== 'all' && it.type !== filterType) return false;
        return true;
    });
    visible.forEach(it => {
        if (isChecked) selectedPlanItemKeys.add(it.compositeKey);
        else selectedPlanItemKeys.delete(it.compositeKey);
    });
    renderPlanAccessTable();
}

async function assignSingleContentPlan(compositeKey, newPlan) {
    await applyPlanKeysUpdate([compositeKey], newPlan);
}

async function applyBulkPlanAssignment() {
    if (selectedPlanItemKeys.size === 0) {
        showAdminToast('Select at least one item first.', 'error');
        return;
    }
    const targetPlan = document.getElementById('bulkPlanSelect')?.value || 'free';
    const ok = await applyPlanKeysUpdate(Array.from(selectedPlanItemKeys), targetPlan);
    if (ok) {
        selectedPlanItemKeys.clear();
        const selectAll = document.getElementById('bulkSelectAll');
        if (selectAll) selectAll.checked = false;
        renderPlanAccessTable();
    }
}

async function applyPlanKeysUpdate(compositeKeys, newPlan) {
    const portalsPatch = {};
    const touchedClasses = new Set();
    let touchedZoom = false;
    const zoomCopy = JSON.parse(JSON.stringify(getAdminZoomClasses()));
    const mockTestsToSave = [];

    compositeKeys.forEach(k => {
        const [classKey, type] = k.split('|');
        if (type === 'lesson-pdf' || type === 'lesson-video') touchedClasses.add(classKey);
    });

    touchedClasses.forEach(ck => {
        portalsPatch[ck] = { subjects: JSON.parse(JSON.stringify(getAdminSubjects(ck))) };
    });

    compositeKeys.forEach(k => {
        const [classKey, type, subjId, lessonId, itemId] = k.split('|');
        if (type === 'zoom-class') {
            const z = zoomCopy.find(x => x.id === itemId);
            if (z) {
                z.minPlan = newPlan;
                z.adminAssignedPlan = true;
                touchedZoom = true;
            }
            return;
        }
        if (type === 'mock-test') {
            const mt = (ADMIN_MOCK_TESTS || []).find(x => x.id === itemId);
            if (mt) {
                const copy = JSON.parse(JSON.stringify(mt));
                copy.minPlan = newPlan;
                mockTestsToSave.push(copy);
            }
            return;
        }
        const subjects = portalsPatch[classKey]?.subjects || [];
        const subj = subjects.find(s => s.id === subjId);
        const lesson = (subj?.lessons || []).find(l => l.id === lessonId);
        if (!lesson) return;
        const list = type === 'lesson-video' ? (lesson.videos || []) : (lesson.pdfs || []);
        const item = list.find(x => x.id === itemId);
        if (item) {
            item.minPlan = newPlan;
            item.adminAssignedPlan = true;
        }
    });

    for (const mt of mockTestsToSave) {
        try {
            const res = await fetch('/api/mock-tests', {
                method: 'POST',
                headers: getAdminHeaders(),
                body: JSON.stringify({ action: 'SAVE_TEST', test: mt })
            });
            const json = await res.json();
            if (json.ok && Array.isArray(json.tests)) ADMIN_MOCK_TESTS = json.tests;
        } catch (e) {}
    }

    const patch = {};
    if (touchedClasses.size > 0) patch.portals = portalsPatch;
    if (touchedZoom) patch.zoomClasses = zoomCopy;

    if (Object.keys(patch).length > 0) {
        return await persistAcademyState(patch, `Assigned ${compositeKeys.length} item(s) to ${newPlan.toUpperCase()}.`);
    }
    showAdminToast(`Assigned ${compositeKeys.length} item(s) to ${newPlan.toUpperCase()}.`);
    renderPlansTab();
    return true;
}

function setPlanPreviewTier(tier) {
    activePreviewTier = tier;
    ['free', 'gold', 'diamond'].forEach(t => {
        document.getElementById(`previewBtn-${t}`)?.classList.toggle('active-preview', t === tier);
    });
    renderPlanStudentPreview();
}

function renderPlanStudentPreview() {
    const mount = document.getElementById('planStudentPreviewMount');
    if (!mount || !ADMIN_STATE) return;

    const rank = { free: 0, gold: 1, diamond: 2 };
    const tierRank = rank[activePreviewTier] || 0;
    const planName = ADMIN_STATE.plansConfig?.[activePreviewTier]?.name || activePreviewTier;

    mount.innerHTML = `
        <div class="adm-preview-grid">
            ${SECTION_META.map(sec => {
                const locked = Boolean(ADMIN_STATE.sectionLocks?.[sec.key]?.locked);
                if (locked) {
                    return `
                        <div class="adm-preview-card is-locked">
                            <div class="adm-preview-head">
                                <strong>${sec.label}</strong>
                                <span class="adm-status-pill locked">Section Locked</span>
                            </div>
                            <p style="font-size:0.84rem; color:var(--adm-text-muted); margin:8px 0 0;">
                                Temporarily unavailable on all plans (including ${escapeHtml(planName)}).
                            </p>
                        </div>
                    `;
                }

                const items = [];
                getAdminSubjects(sec.key).forEach(subj => {
                    (subj.lessons || []).forEach(l => {
                        (l.pdfs || []).forEach(p => items.push({ kind: 'PDF', title: `${l.title}: ${p.title}`, minPlan: p.minPlan || 'free' }));
                        (l.videos || []).forEach(v => items.push({ kind: 'Video', title: `${l.title}: ${v.title}`, minPlan: v.minPlan || 'free' }));
                    });
                });
                const unlocked = items.filter(it => tierRank >= (rank[it.minPlan] || 0));

                return `
                    <div class="adm-preview-card">
                        <div class="adm-preview-head">
                            <strong>${sec.label}</strong>
                            <span class="adm-status-pill open">${unlocked.length}/${items.length} unlocked</span>
                        </div>
                        <ul class="adm-preview-list">
                            ${unlocked.map(it => `<li>${it.kind}: ${escapeHtml(it.title)}</li>`).join('')}
                            ${unlocked.length === 0 ? '<li style="color:var(--adm-text-muted);">No PDFs or videos unlocked on this plan yet.</li>' : ''}
                        </ul>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

/* --------------------------------------------------------------------------
   6B. CLASS SWITCH REQUESTS
   -------------------------------------------------------------------------- */
function renderSwitchRequestsTab() {
    const mount = document.getElementById('switchRequestsAdminMount');
    const badge = document.getElementById('switchPendingBadge');
    const requests = Array.isArray(ADMIN_ROSTER?.classSwitchRequests) ? ADMIN_ROSTER.classSwitchRequests : [];
    const pendingCount = requests.filter(r => r.status === 'pending').length;

    if (badge) {
        badge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
        badge.textContent = String(pendingCount);
    }
    if (!mount) return;

    if (requests.length === 0) {
        mount.innerHTML = `<div style="padding:24px; text-align:center; color:var(--adm-text-muted);">No class switch requests yet.</div>`;
        return;
    }

    mount.innerHTML = `
        <div class="adm-table-wrap">
            <table class="adm-table">
                <thead>
                    <tr>
                        <th>Student</th>
                        <th>Current / Previous Class</th>
                        <th>Requested Class</th>
                        <th>Submitted</th>
                        <th>Status</th>
                        <th>Admin Note</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${requests.map(r => {
                        const statusClass = r.status === 'approved' ? 'open' : (r.status === 'rejected' ? 'locked' : '');
                        const dateStr = r.submittedAt ? new Date(r.submittedAt).toLocaleString() : '—';
                        return `
                            <tr>
                                <td>
                                    <strong>${escapeHtml(r.studentName)}</strong><br>
                                    <small style="color:var(--adm-text-muted);">${escapeHtml(r.email)}</small>
                                    ${r.reason ? `<div style="font-size:0.78rem; color:var(--adm-text-muted); margin-top:4px;">Reason: ${escapeHtml(r.reason)}</div>` : ''}
                                </td>
                                <td>${escapeHtml(r.currentGrade || r.currentClassKey)}</td>
                                <td><strong>${escapeHtml(r.requestedGrade || r.requestedClassKey)}</strong></td>
                                <td><small>${escapeHtml(dateStr)}</small></td>
                                <td><span class="adm-status-pill ${statusClass}">${escapeHtml(String(r.status || 'pending').toUpperCase())}</span></td>
                                <td>
                                    ${r.status === 'pending'
                                        ? `<input type="text" class="adm-input" id="switchNote-${escapeHtml(r.id)}" placeholder="Optional note..." style="min-width:160px;">`
                                        : `<small>${escapeHtml(r.adminNote || '—')}</small>`}
                                </td>
                                <td>
                                    ${r.status === 'pending' ? `
                                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                                            <button type="button" class="btn-adm-dark" style="padding:6px 10px; font-size:0.78rem;" onclick="handleSwitchRequestDecision('${escapeHtml(r.id)}', true)">Approve</button>
                                            <button type="button" class="btn-topbar" style="padding:6px 10px; font-size:0.78rem; color:#dc2626;" onclick="handleSwitchRequestDecision('${escapeHtml(r.id)}', false)">Reject</button>
                                        </div>
                                    ` : `<small style="color:var(--adm-text-muted);">Reviewed</small>`}
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function handleSwitchRequestDecision(requestId, approve) {
    const noteEl = document.getElementById(`switchNote-${requestId}`);
    const adminNote = noteEl ? noteEl.value.trim() : '';
    try {
        const res = await fetch('/api/student-roster', {
            method: 'POST',
            headers: getAdminHeaders(),
            body: JSON.stringify({
                action: approve ? 'APPROVE_CLASS_SWITCH' : 'REJECT_CLASS_SWITCH',
                requestId,
                adminNote
            })
        });
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Action failed');
        if (json.data) ADMIN_ROSTER = json.data;
        showAdminToast(approve ? 'Class switch approved and student class updated.' : 'Class switch request rejected.');
        broadcastUpdate('PERMISSIONS_UPDATE');
        renderSwitchRequestsTab();
        renderUsersTab();
    } catch (err) {
        showAdminToast(err.message || 'Could not update switch request.', 'error');
    }
}

/* --------------------------------------------------------------------------
   6C. PAYMENTS & PLAN ACTIVATION
   -------------------------------------------------------------------------- */
async function loadAdminPayments() {
    try {
        const res = await fetch('/api/payments?_t=' + Date.now(), {
            cache: 'no-store',
            headers: { 'x-admin-passkey': ADMIN_STUDIO_TOKEN }
        });
        const json = await res.json();
        if (json.ok && Array.isArray(json.payments)) {
            ADMIN_PAYMENTS = json.payments;
            renderPaymentsTab();
        }
    } catch (e) {}
}

function renderPaymentsTab() {
    const mount = document.getElementById('paymentsAdminMount');
    const badge = document.getElementById('paymentsPendingBadge');
    const list = Array.isArray(ADMIN_PAYMENTS) ? ADMIN_PAYMENTS : [];
    const pendingCount = list.filter(p => {
        const st = normalizeAdminPayStatus(p.status);
        return st === 'pending' || st === 'awaiting_confirmation';
    }).length;

    if (badge) {
        badge.style.display = pendingCount > 0 ? 'inline-block' : 'none';
        badge.textContent = String(pendingCount);
    }
    if (!mount) return;

    if (list.length === 0) {
        mount.innerHTML = `<div style="padding:24px; text-align:center; color:var(--adm-text-muted);">No plan purchases submitted yet.</div>`;
        return;
    }

    mount.innerHTML = `
        <div class="adm-table-wrap">
            <table class="adm-table">
                <thead>
                    <tr>
                        <th>Student &amp; Member ID</th>
                        <th>Class</th>
                        <th>Order, Plan &amp; Amount</th>
                        <th>eSewa Txn ID</th>
                        <th>Submitted / Updated</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${list.map(p => {
                        const normSt = normalizeAdminPayStatus(p.status);
                        const isPendingOrAwaiting = normSt === 'pending' || normSt === 'awaiting_confirmation';
                        return `
                            <tr>
                                <td>
                                    <strong>${escapeHtml(p.fullName)}</strong><br>
                                    <small style="color:var(--adm-text-muted);">${escapeHtml(p.email)} (@${escapeHtml(p.username)})</small><br>
                                    <code style="font-size:0.7rem; color:var(--adm-text-muted);">${escapeHtml(p.userId || '')}</code>
                                </td>
                                <td>${escapeHtml(p.className || p.classKey)}</td>
                                <td>
                                    <strong>${escapeHtml(p.planName)}</strong> (${escapeHtml(p.amount)})<br>
                                    <code style="font-size:0.72rem;">${escapeHtml(p.orderId || p.id)}</code>
                                </td>
                                <td><code>${escapeHtml(p.transactionId || 'Not provided')}</code></td>
                                <td>
                                    <small>${p.createdAt ? escapeHtml(new Date(p.createdAt).toLocaleString()) : '—'}</small>
                                    ${p.lastProviderCheckAt ? `<br><small style="color:var(--adm-text-muted);">Provider check: ${formatRelativeOrLocalTime(p.lastProviderCheckAt)}</small>` : ''}
                                </td>
                                <td>${formatAdminPayStatusPill(normSt)}</td>
                                <td>
                                    <div style="display:flex; flex-direction:column; gap:6px;">
                                        ${isPendingOrAwaiting ? `
                                            <input type="text" class="adm-input" id="payNote-${escapeHtml(p.id)}" placeholder="Verification note..." style="min-width:150px; padding:5px 8px; font-size:0.78rem;">
                                        ` : (p.adminNote ? `<small style="color:var(--adm-text-muted);">${escapeHtml(p.adminNote)}</small>` : '')}
                                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                                            ${normSt !== 'paid' ? `
                                                <button type="button" class="btn-adm-dark" style="padding:5px 9px; font-size:0.76rem;" onclick="handleAdminPaymentDecision('${escapeHtml(p.id)}', true)">Verify &amp; Activate</button>
                                            ` : ''}
                                            ${isPendingOrAwaiting ? `
                                                <button type="button" class="btn-topbar" style="padding:5px 9px; font-size:0.76rem;" onclick="handleAdminCheckProviderStatus('${escapeHtml(p.id)}')" title="Check transaction status against eSewa provider">Check Provider</button>
                                                <button type="button" class="btn-topbar" style="padding:5px 9px; font-size:0.76rem; color:#dc2626;" onclick="handleAdminPaymentDecision('${escapeHtml(p.id)}', false)">Mark Failed</button>
                                            ` : ''}
                                            ${normSt === 'paid' ? `
                                                <button type="button" class="btn-topbar" style="padding:5px 9px; font-size:0.76rem;" onclick="handleAdminRefundPayment('${escapeHtml(p.id)}')">Refund</button>
                                            ` : ''}
                                            <button type="button" class="btn-topbar danger" style="padding:5px 9px; font-size:0.76rem;" onclick="handleAdminDeletePayment('${escapeHtml(p.id)}')">Delete</button>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function handleAdminCheckProviderStatus(paymentId) {
    setSaveStatus('Checking eSewa...');
    try {
        const res = await fetch('/api/payments', {
            method: 'POST',
            headers: getAdminHeaders(),
            body: JSON.stringify({
                action: 'ADMIN_CHECK_PROVIDER_STATUS',
                paymentId
            })
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Provider check failed');
        if (Array.isArray(json.payments)) ADMIN_PAYMENTS = json.payments;
        setSaveStatus('Saved', true);
        showAdminToast(json.message || 'Checked payment status with provider.');
        broadcastUpdate('PAYMENT_UPDATED');
        await pollAdminLiveUpdates(true);
    } catch (err) {
        setSaveStatus('Error');
        showAdminToast(err.message || 'Could not query provider.', 'error');
    }
}

async function handleAdminRefundPayment(paymentId) {
    if (!confirm('Mark this payment as Refunded and revert the student subscription access?')) return;
    setSaveStatus('Refunding...');
    try {
        const res = await fetch('/api/payments', {
            method: 'POST',
            headers: getAdminHeaders(),
            body: JSON.stringify({
                action: 'ADMIN_REFUND_PAYMENT',
                paymentId,
                adminNote: 'Payment refunded by Admin.'
            })
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Refund failed');
        if (Array.isArray(json.payments)) ADMIN_PAYMENTS = json.payments;
        setSaveStatus('Saved', true);
        showAdminToast(json.message || 'Payment marked as Refunded.');
        broadcastUpdate('PERMISSIONS_UPDATE');
        await pollAdminLiveUpdates(true);
    } catch (err) {
        setSaveStatus('Error');
        showAdminToast(err.message || 'Could not refund payment.', 'error');
    }
}

async function handleAdminDeletePayment(paymentId) {
    if (!confirm('Delete this payment record?')) return;
    try {
        const res = await fetch('/api/payments', {
            method: 'POST',
            headers: getAdminHeaders(),
            body: JSON.stringify({
                action: 'ADMIN_DELETE_PAYMENT',
                paymentId
            })
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Delete failed');
        if (Array.isArray(json.payments)) ADMIN_PAYMENTS = json.payments;
        showAdminToast('Payment record deleted.');
        await loadAdminData();
    } catch (err) {
        showAdminToast(err.message || 'Could not delete payment.', 'error');
    }
}

async function handleAdminPaymentDecision(paymentId, verify) {
    const noteEl = document.getElementById(`payNote-${paymentId}`);
    const adminNote = noteEl ? noteEl.value.trim() : '';
    try {
        const res = await fetch('/api/payments', {
            method: 'POST',
            headers: getAdminHeaders(),
            body: JSON.stringify({
                action: verify ? 'ADMIN_VERIFY_PAYMENT' : 'ADMIN_REJECT_PAYMENT',
                paymentId,
                adminNote
            })
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Payment update failed');
        if (Array.isArray(json.payments)) ADMIN_PAYMENTS = json.payments;
        showAdminToast(json.message || 'Payment updated.');
        broadcastUpdate('PERMISSIONS_UPDATE');
        await pollAdminLiveUpdates(true);
    } catch (err) {
        showAdminToast(err.message || 'Could not update payment.', 'error');
    }
}

/* --------------------------------------------------------------------------
   6D. NOTIFICATIONS MANAGER
   -------------------------------------------------------------------------- */
let editingNotification = null;

function renderNotificationsTab() {
    const mount = document.getElementById('notificationsAdminMount');
    if (!mount || !ADMIN_STATE) return;
    const list = Array.isArray(ADMIN_STATE.notifications) ? ADMIN_STATE.notifications : [];

    const editorHtml = editingNotification ? `
        <div class="adm-card" style="background:var(--adm-bg-subtle); margin-bottom:18px; padding:16px;">
            <h3 style="margin:0 0 12px 0; font-size:1rem;">${editingNotification.id ? 'Edit Notification' : 'New Notification'}</h3>
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:10px; margin-bottom:10px;">
                <div>
                    <label class="adm-label">Title</label>
                    <input type="text" id="notifFormTitle" class="adm-input" value="${escapeHtml(editingNotification.title || '')}" placeholder="Announcement title">
                </div>
                <div>
                    <label class="adm-label">Category</label>
                    <select id="notifFormCategory" class="adm-select">
                        ${['Announcement', 'News', 'Class Alert', 'Exam Update'].map(c => `<option value="${c}" ${editingNotification.category === c ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="adm-label">Audience Scope</label>
                    <select id="notifFormScope" class="adm-select">
                        <option value="sitewide" ${editingNotification.scope === 'sitewide' ? 'selected' : ''}>Sitewide (Everyone)</option>
                        <option value="class-12" ${editingNotification.scope === 'class-12' ? 'selected' : ''}>Class 12 Only</option>
                        <option value="class-11" ${editingNotification.scope === 'class-11' ? 'selected' : ''}>Class 11 Only</option>
                        <option value="class-10" ${editingNotification.scope === 'class-10' ? 'selected' : ''}>Class 10 Only</option>
                        <option value="after-12" ${editingNotification.scope === 'after-12' ? 'selected' : ''}>Entrance Prep Only</option>
                    </select>
                </div>
            </div>
            <div style="margin-bottom:10px;">
                <label class="adm-label">Message</label>
                <textarea id="notifFormBody" class="adm-input" rows="3" placeholder="Notification details...">${escapeHtml(editingNotification.body || '')}</textarea>
            </div>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                <label style="display:inline-flex; align-items:center; gap:6px; font-size:0.86rem; cursor:pointer;">
                    <input type="checkbox" id="notifFormPublished" ${editingNotification.published !== false ? 'checked' : ''}> Publish immediately
                </label>
                <button type="button" class="btn-topbar" onclick="previewNotificationDraft()">Preview</button>
                <button type="button" class="btn-adm-dark" onclick="saveNotificationForm()">Save Notification</button>
                <button type="button" class="btn-topbar" onclick="editingNotification=null; renderNotificationsTab();">Cancel</button>
            </div>
            <div id="notifPreviewBox" style="margin-top:10px; display:none;"></div>
        </div>
    ` : '';

    mount.innerHTML = editorHtml + (list.length === 0
        ? `<div style="padding:20px; text-align:center; color:var(--adm-text-muted);">No notifications created yet.</div>`
        : `<div class="adm-table-wrap">
            <table class="adm-table">
                <thead>
                    <tr>
                        <th>Title &amp; Message</th>
                        <th>Category</th>
                        <th>Scope</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${list.map(n => `
                        <tr>
                            <td><strong>${escapeHtml(n.title)}</strong><br><small style="color:var(--adm-text-muted);">${escapeHtml(n.body)}</small></td>
                            <td>${escapeHtml(n.category || 'Announcement')}</td>
                            <td>${escapeHtml(n.scope === 'sitewide' ? 'Sitewide' : n.scope)}</td>
                            <td><span class="adm-status-pill ${n.published ? 'open' : 'locked'}">${n.published ? 'Published' : 'Draft'}</span></td>
                            <td>
                                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                                    <button type="button" class="btn-topbar" style="padding:5px 9px; font-size:0.78rem;" onclick="editNotificationItem('${escapeHtml(n.id)}')">Edit</button>
                                    <button type="button" class="btn-topbar" style="padding:5px 9px; font-size:0.78rem;" onclick="toggleNotificationPublish('${escapeHtml(n.id)}')">${n.published ? 'Unpublish' : 'Publish'}</button>
                                    <button type="button" class="btn-topbar" style="padding:5px 9px; font-size:0.78rem; color:#dc2626;" onclick="deleteNotificationItem('${escapeHtml(n.id)}')">Delete</button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>`);
}

function startCreateNotification() {
    editingNotification = { id: '', title: '', body: '', category: 'Announcement', scope: 'sitewide', published: true };
    renderNotificationsTab();
}

function editNotificationItem(id) {
    const found = (ADMIN_STATE?.notifications || []).find(n => n.id === id);
    if (!found) return;
    editingNotification = JSON.parse(JSON.stringify(found));
    renderNotificationsTab();
}

function previewNotificationDraft() {
    const box = document.getElementById('notifPreviewBox');
    if (!box) return;
    const title = document.getElementById('notifFormTitle')?.value.trim() || 'Untitled';
    const body = document.getElementById('notifFormBody')?.value.trim() || '';
    const cat = document.getElementById('notifFormCategory')?.value || 'Announcement';
    const scope = document.getElementById('notifFormScope')?.value || 'sitewide';
    box.style.display = 'block';
    box.innerHTML = `
        <div style="padding:12px 14px; border:1px solid var(--adm-border); border-radius:10px; background:var(--adm-surface);">
            <div style="font-size:0.75rem; color:var(--adm-text-muted); margin-bottom:4px;">Preview · ${escapeHtml(cat)} · ${escapeHtml(scope)}</div>
            <strong>${escapeHtml(title)}</strong>
            <p style="margin:4px 0 0; font-size:0.86rem;">${escapeHtml(body)}</p>
        </div>
    `;
}

async function saveNotificationForm() {
    const title = document.getElementById('notifFormTitle')?.value.trim();
    const body = document.getElementById('notifFormBody')?.value.trim();
    const category = document.getElementById('notifFormCategory')?.value || 'Announcement';
    const scope = document.getElementById('notifFormScope')?.value || 'sitewide';
    const published = Boolean(document.getElementById('notifFormPublished')?.checked);
    if (!title || !body) {
        showAdminToast('Title and message are required.', 'error');
        return;
    }
    const list = JSON.parse(JSON.stringify(ADMIN_STATE?.notifications || []));
    const now = new Date().toISOString();
    if (editingNotification && editingNotification.id) {
        const idx = list.findIndex(n => n.id === editingNotification.id);
        if (idx >= 0) {
            list[idx] = { ...list[idx], title, body, category, scope, published, updatedAt: now };
        }
    } else {
        list.unshift({ id: 'notif_' + Date.now(), title, body, category, scope, published, createdAt: now, updatedAt: now });
    }
    editingNotification = null;
    await persistAcademyState({ notifications: list }, 'Notification saved.');
}

async function toggleNotificationPublish(id) {
    const list = JSON.parse(JSON.stringify(ADMIN_STATE?.notifications || []));
    const item = list.find(n => n.id === id);
    if (!item) return;
    item.published = !item.published;
    item.updatedAt = new Date().toISOString();
    await persistAcademyState({ notifications: list }, item.published ? 'Notification published.' : 'Notification unpublished.');
}

async function deleteNotificationItem(id) {
    const list = (ADMIN_STATE?.notifications || []).filter(n => n.id !== id);
    await persistAcademyState({ notifications: list }, 'Notification deleted.');
}

/* --------------------------------------------------------------------------
   6E. HOMEPAGE EDITOR
   -------------------------------------------------------------------------- */
function renderHomepageEditorTab() {
    const mount = document.getElementById('homepageEditorMount');
    if (!mount || !ADMIN_STATE) return;
    const hc = ADMIN_STATE.homepageContent || {};
    const cards = Array.isArray(hc.featureCards) ? hc.featureCards : [];

    mount.innerHTML = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:14px;">
            <div>
                <label class="adm-label">Hero Pill Text</label>
                <input type="text" id="hcHeroPill" class="adm-input" value="${escapeHtml(hc.heroPillText || '')}">
            </div>
            <div>
                <label class="adm-label">Hero Main Heading</label>
                <input type="text" id="hcHeroTitleMain" class="adm-input" value="${escapeHtml(hc.heroTitleMain || '')}">
            </div>
            <div>
                <label class="adm-label">Hero Muted Sub-Heading</label>
                <input type="text" id="hcHeroTitleMuted" class="adm-input" value="${escapeHtml(hc.heroTitleMuted || '')}">
            </div>
            <div>
                <label class="adm-label">Hero Portrait Image URL</label>
                <input type="text" id="hcHeroPortrait" class="adm-input" value="${escapeHtml(hc.heroPortraitUrl || '')}">
            </div>
            <div>
                <label class="adm-label">Hero Faculty Name</label>
                <input type="text" id="hcFacultyName" class="adm-input" value="${escapeHtml(hc.heroFacultyName || '')}">
            </div>
            <div>
                <label class="adm-label">Hero Faculty Role</label>
                <input type="text" id="hcFacultyRole" class="adm-input" value="${escapeHtml(hc.heroFacultyRole || '')}">
            </div>
            <div>
                <label class="adm-label">Hero Faculty Tag</label>
                <input type="text" id="hcFacultyTag" class="adm-input" value="${escapeHtml(hc.heroFacultyTag || '')}">
            </div>
            <div>
                <label class="adm-label">Guest Primary Button Label</label>
                <input type="text" id="hcPrimaryBtn" class="adm-input" value="${escapeHtml(hc.heroPrimaryBtnLabel || 'Get Started')}">
            </div>
            <div>
                <label class="adm-label">Secondary Button Label</label>
                <input type="text" id="hcSecondaryBtn" class="adm-input" value="${escapeHtml(hc.heroSecondaryBtnLabel || 'Ask BPG AI')}">
            </div>
            <div>
                <label class="adm-label">Secondary Button Link</label>
                <input type="text" id="hcSecondaryLink" class="adm-input" value="${escapeHtml(hc.heroSecondaryBtnLink || '#ai')}">
            </div>
        </div>
        <div style="margin-top:12px;">
            <label class="adm-label">Hero Description</label>
            <textarea id="hcHeroDesc" class="adm-input" rows="2">${escapeHtml(hc.heroDescription || '')}</textarea>
        </div>

        <hr style="margin:18px 0; border:none; border-top:1px solid var(--adm-border);">
        <h3 style="margin:0 0 10px 0; font-size:0.96rem;">Top Announcement Banner</h3>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px; align-items:end;">
            <label style="display:inline-flex; align-items:center; gap:8px; font-size:0.88rem; cursor:pointer;">
                <input type="checkbox" id="hcBannerEnabled" ${hc.bannerEnabled ? 'checked' : ''}> Show Top Banner on Homepage
            </label>
            <div>
                <label class="adm-label">Banner Text</label>
                <input type="text" id="hcBannerText" class="adm-input" value="${escapeHtml(hc.bannerText || '')}">
            </div>
            <div>
                <label class="adm-label">Banner Link Label</label>
                <input type="text" id="hcBannerLinkLabel" class="adm-input" value="${escapeHtml(hc.bannerLinkLabel || '')}">
            </div>
            <div>
                <label class="adm-label">Banner Link URL</label>
                <input type="text" id="hcBannerLinkUrl" class="adm-input" value="${escapeHtml(hc.bannerLinkUrl || '')}">
            </div>
        </div>

        <hr style="margin:18px 0; border:none; border-top:1px solid var(--adm-border);">
        <h3 style="margin:0 0 10px 0; font-size:0.96rem;">Section Headings &amp; Footer</h3>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px;">
            <div><label class="adm-label">Features Eyebrow</label><input type="text" id="hcFeatEyebrow" class="adm-input" value="${escapeHtml(hc.featuresEyebrow || '')}"></div>
            <div><label class="adm-label">Features Heading</label><input type="text" id="hcFeatHeading" class="adm-input" value="${escapeHtml(hc.featuresHeading || '')}"></div>
            <div><label class="adm-label">Notifications Eyebrow</label><input type="text" id="hcNotifEyebrow" class="adm-input" value="${escapeHtml(hc.notificationsEyebrow || '')}"></div>
            <div><label class="adm-label">Notifications Heading</label><input type="text" id="hcNotifHeading" class="adm-input" value="${escapeHtml(hc.notificationsHeading || '')}"></div>
            <div><label class="adm-label">Team Eyebrow</label><input type="text" id="hcTeamEyebrow" class="adm-input" value="${escapeHtml(hc.teamEyebrow || '')}"></div>
            <div><label class="adm-label">Team Heading</label><input type="text" id="hcTeamHeading" class="adm-input" value="${escapeHtml(hc.teamHeading || '')}"></div>
            <div><label class="adm-label">Footer Text</label><input type="text" id="hcFooterText" class="adm-input" value="${escapeHtml(hc.footerText || '')}"></div>
        </div>

        <hr style="margin:18px 0; border:none; border-top:1px solid var(--adm-border);">
        <h3 style="margin:0 0 10px 0; font-size:0.96rem;">Feature Cards</h3>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:10px;">
            ${cards.map((fc, idx) => `
                <div style="padding:10px; border:1px solid var(--adm-border); border-radius:10px;">
                    <label class="adm-label">${escapeHtml(fc.id)} Label</label>
                    <input type="text" class="adm-input" id="hcCardLabel-${idx}" value="${escapeHtml(fc.label || '')}" style="margin-bottom:6px;">
                    <label class="adm-label">Subtitle</label>
                    <input type="text" class="adm-input" id="hcCardSub-${idx}" value="${escapeHtml(fc.sub || '')}">
                </div>
            `).join('')}
        </div>
        <div id="homepagePreviewBox" style="margin-top:16px; display:none;"></div>
    `;
}

function collectHomepageDraft() {
    const existing = ADMIN_STATE?.homepageContent || {};
    const cards = (existing.featureCards || []).map((fc, idx) => ({
        ...fc,
        label: document.getElementById(`hcCardLabel-${idx}`)?.value.trim() || fc.label,
        sub: document.getElementById(`hcCardSub-${idx}`)?.value.trim() || fc.sub
    }));
    return {
        heroPillText: document.getElementById('hcHeroPill')?.value.trim() || '',
        heroTitleMain: document.getElementById('hcHeroTitleMain')?.value.trim() || '',
        heroTitleMuted: document.getElementById('hcHeroTitleMuted')?.value.trim() || '',
        heroDescription: document.getElementById('hcHeroDesc')?.value.trim() || '',
        heroPrimaryBtnLabel: document.getElementById('hcPrimaryBtn')?.value.trim() || 'Get Started',
        heroSecondaryBtnLabel: document.getElementById('hcSecondaryBtn')?.value.trim() || 'Ask BPG AI',
        heroSecondaryBtnLink: document.getElementById('hcSecondaryLink')?.value.trim() || '#ai',
        heroPortraitUrl: document.getElementById('hcHeroPortrait')?.value.trim() || 'images/bpg_sir.jpg',
        heroFacultyName: document.getElementById('hcFacultyName')?.value.trim() || '',
        heroFacultyRole: document.getElementById('hcFacultyRole')?.value.trim() || '',
        heroFacultyTag: document.getElementById('hcFacultyTag')?.value.trim() || '',
        bannerEnabled: Boolean(document.getElementById('hcBannerEnabled')?.checked),
        bannerText: document.getElementById('hcBannerText')?.value.trim() || '',
        bannerLinkLabel: document.getElementById('hcBannerLinkLabel')?.value.trim() || '',
        bannerLinkUrl: document.getElementById('hcBannerLinkUrl')?.value.trim() || '',
        featuresEyebrow: document.getElementById('hcFeatEyebrow')?.value.trim() || '',
        featuresHeading: document.getElementById('hcFeatHeading')?.value.trim() || '',
        notificationsEyebrow: document.getElementById('hcNotifEyebrow')?.value.trim() || '',
        notificationsHeading: document.getElementById('hcNotifHeading')?.value.trim() || '',
        teamEyebrow: document.getElementById('hcTeamEyebrow')?.value.trim() || '',
        teamHeading: document.getElementById('hcTeamHeading')?.value.trim() || '',
        footerText: document.getElementById('hcFooterText')?.value.trim() || '',
        featureCards: cards
    };
}

function previewHomepageDraft() {
    const draft = collectHomepageDraft();
    const box = document.getElementById('homepagePreviewBox');
    if (!box) return;
    box.style.display = 'block';
    box.innerHTML = `
        <div style="padding:18px; border:1px solid var(--adm-border); border-radius:12px; background:var(--adm-bg-subtle);">
            <div style="font-size:0.75rem; font-weight:700; text-transform:uppercase; color:var(--adm-text-muted); margin-bottom:8px;">Homepage Preview</div>
            ${draft.bannerEnabled ? `<div style="padding:8px 12px; background:var(--adm-surface); border:1px solid var(--adm-border); border-radius:8px; margin-bottom:10px; font-size:0.84rem;">${escapeHtml(draft.bannerText)} <strong>${escapeHtml(draft.bannerLinkLabel)}</strong></div>` : ''}
            <div style="font-size:0.8rem; color:var(--adm-text-muted);">${escapeHtml(draft.heroPillText)}</div>
            <h2 style="margin:6px 0;">${escapeHtml(draft.heroTitleMain)} <span style="opacity:0.6;">${escapeHtml(draft.heroTitleMuted)}</span></h2>
            <p style="font-size:0.9rem; margin:6px 0 12px;">${escapeHtml(draft.heroDescription)}</p>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <span class="adm-status-pill open">${escapeHtml(draft.heroPrimaryBtnLabel)}</span>
                <span class="adm-status-pill">${escapeHtml(draft.heroSecondaryBtnLabel)}</span>
            </div>
        </div>
    `;
}

async function saveHomepageEditor() {
    const draft = collectHomepageDraft();
    await persistAcademyState({ homepageContent: draft }, 'Homepage content published.');
}

/* --------------------------------------------------------------------------
   6F. CHATBOT FAQS MANAGER
   -------------------------------------------------------------------------- */
let editingFaq = null;

function renderFaqsTab() {
    const mount = document.getElementById('faqsAdminMount');
    if (!mount || !ADMIN_STATE) return;
    const faqs = Array.isArray(ADMIN_STATE.chatbotFaqs) ? ADMIN_STATE.chatbotFaqs : [];

    const editorHtml = editingFaq ? `
        <div class="adm-card" style="background:var(--adm-bg-subtle); margin-bottom:16px; padding:16px;">
            <h3 style="margin:0 0 10px 0; font-size:1rem;">${editingFaq.id ? 'Edit FAQ' : 'New FAQ'}</h3>
            <div style="margin-bottom:10px;">
                <label class="adm-label">Question</label>
                <input type="text" id="faqFormQuestion" class="adm-input" value="${escapeHtml(editingFaq.question || '')}">
            </div>
            <div style="margin-bottom:10px;">
                <label class="adm-label">Keywords (comma-separated)</label>
                <input type="text" id="faqFormKeywords" class="adm-input" value="${escapeHtml((editingFaq.keywords || []).join(', '))}">
            </div>
            <div style="margin-bottom:10px;">
                <label class="adm-label">Answer</label>
                <textarea id="faqFormAnswer" class="adm-input" rows="3">${escapeHtml(editingFaq.answer || '')}</textarea>
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
                <label style="display:inline-flex; align-items:center; gap:6px; font-size:0.86rem;">
                    <input type="checkbox" id="faqFormPublished" ${editingFaq.published !== false ? 'checked' : ''}> Published
                </label>
                <button type="button" class="btn-adm-dark" onclick="saveFaqForm()">Save FAQ</button>
                <button type="button" class="btn-topbar" onclick="editingFaq=null; renderFaqsTab();">Cancel</button>
            </div>
        </div>
    ` : '';

    mount.innerHTML = editorHtml + `
        <div class="adm-table-wrap">
            <table class="adm-table">
                <thead>
                    <tr>
                        <th>Question &amp; Answer</th>
                        <th>Keywords</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${faqs.map(f => `
                        <tr>
                            <td><strong>${escapeHtml(f.question)}</strong><br><small style="color:var(--adm-text-muted);">${escapeHtml(f.answer)}</small></td>
                            <td><small>${escapeHtml((f.keywords || []).join(', '))}</small></td>
                            <td><span class="adm-status-pill ${f.published !== false ? 'open' : 'locked'}">${f.published !== false ? 'Published' : 'Hidden'}</span></td>
                            <td>
                                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                                    <button type="button" class="btn-topbar" style="padding:5px 9px; font-size:0.78rem;" onclick="editFaqItem('${escapeHtml(f.id)}')">Edit</button>
                                    <button type="button" class="btn-topbar" style="padding:5px 9px; font-size:0.78rem;" onclick="toggleFaqPublish('${escapeHtml(f.id)}')">${f.published !== false ? 'Hide' : 'Publish'}</button>
                                    <button type="button" class="btn-topbar" style="padding:5px 9px; font-size:0.78rem; color:#dc2626;" onclick="deleteFaqItem('${escapeHtml(f.id)}')">Delete</button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function startCreateFaq() {
    editingFaq = { id: '', question: '', keywords: [], answer: '', links: [], published: true };
    renderFaqsTab();
}

function editFaqItem(id) {
    const found = (ADMIN_STATE?.chatbotFaqs || []).find(f => f.id === id);
    if (!found) return;
    editingFaq = JSON.parse(JSON.stringify(found));
    renderFaqsTab();
}

async function saveFaqForm() {
    const question = document.getElementById('faqFormQuestion')?.value.trim();
    const answer = document.getElementById('faqFormAnswer')?.value.trim();
    const keywords = (document.getElementById('faqFormKeywords')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    const published = Boolean(document.getElementById('faqFormPublished')?.checked);
    if (!question || !answer) {
        showAdminToast('Question and answer are required.', 'error');
        return;
    }
    const list = JSON.parse(JSON.stringify(ADMIN_STATE?.chatbotFaqs || []));
    const now = new Date().toISOString();
    if (editingFaq && editingFaq.id) {
        const idx = list.findIndex(f => f.id === editingFaq.id);
        if (idx >= 0) list[idx] = { ...list[idx], question, keywords, answer, published, updatedAt: now };
    } else {
        list.unshift({ id: 'faq_' + Date.now(), question, keywords, answer, links: [], published, updatedAt: now });
    }
    editingFaq = null;
    await persistAcademyState({ chatbotFaqs: list }, 'Chatbot FAQ saved.');
}

async function toggleFaqPublish(id) {
    const list = JSON.parse(JSON.stringify(ADMIN_STATE?.chatbotFaqs || []));
    const item = list.find(f => f.id === id);
    if (!item) return;
    item.published = item.published === false;
    await persistAcademyState({ chatbotFaqs: list }, item.published ? 'FAQ published.' : 'FAQ hidden.');
}

async function deleteFaqItem(id) {
    const list = (ADMIN_STATE?.chatbotFaqs || []).filter(f => f.id !== id);
    await persistAcademyState({ chatbotFaqs: list }, 'FAQ deleted.');
}

/* --------------------------------------------------------------------------
   6G. MAINTENANCE MODE & SITE SETTINGS
   -------------------------------------------------------------------------- */
function renderMaintenanceSettings() {
    const mount = document.getElementById('maintenanceSettingsMount');
    const btn = document.getElementById('btnToggleMaintenance');
    if (!mount || !ADMIN_STATE) return;
    const m = ADMIN_STATE.maintenanceMode || { enabled: false, title: 'Scheduled Maintenance', message: '' };
    const enabled = Boolean(m.enabled);
    if (btn) {
        btn.textContent = enabled ? 'Disable Maintenance Mode' : 'Enable Maintenance Mode';
        btn.style.background = enabled ? '#dc2626' : '';
    }
    mount.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
            <span class="adm-status-pill ${enabled ? 'locked' : 'open'}">${enabled ? 'MAINTENANCE ACTIVE' : 'SITE LIVE'}</span>
            <small style="color:var(--adm-text-muted);">${enabled ? 'Public homepage stays visible; all student portals, calculator & checkout are locked.' : 'All open student features are operating normally.'}</small>
        </div>
        <div class="adm-maint-form-grid" style="display:grid; grid-template-columns:1fr 2fr auto; gap:10px; align-items:end;">
            <div>
                <label class="adm-label">Notice Title</label>
                <input type="text" id="maintTitleInput" class="adm-input" value="${escapeHtml(m.title || 'Scheduled Maintenance')}">
            </div>
            <div>
                <label class="adm-label">Notice Message</label>
                <input type="text" id="maintMsgInput" class="adm-input" value="${escapeHtml(m.message || '')}">
            </div>
            <button type="button" class="btn-topbar" onclick="saveMaintenanceMessage()">Save Message</button>
        </div>
    `;
}

async function toggleMaintenanceMode() {
    const current = ADMIN_STATE?.maintenanceMode || { enabled: false };
    const nextEnabled = !current.enabled;
    const title = document.getElementById('maintTitleInput')?.value.trim() || current.title || 'Scheduled Maintenance';
    const message = document.getElementById('maintMsgInput')?.value.trim() || current.message || '';
    await persistAcademyState({
        maintenanceMode: { enabled: nextEnabled, title, message, updatedAt: new Date().toISOString() }
    }, nextEnabled ? 'Maintenance Mode enabled.' : 'Maintenance Mode disabled — site is live.');
}

async function saveMaintenanceMessage() {
    const current = ADMIN_STATE?.maintenanceMode || { enabled: false };
    const title = document.getElementById('maintTitleInput')?.value.trim() || 'Scheduled Maintenance';
    const message = document.getElementById('maintMsgInput')?.value.trim() || '';
    await persistAcademyState({
        maintenanceMode: { ...current, title, message, updatedAt: new Date().toISOString() }
    }, 'Maintenance notice saved.');
}

function renderSiteSettings() {
    const mount = document.getElementById('siteSettingsMount');
    if (!mount || !ADMIN_STATE) return;
    const s = ADMIN_STATE.siteSettings || {};
    mount.innerHTML = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:12px;">
            <div>
                <label class="adm-label">WhatsApp Number (with country code)</label>
                <input type="text" id="setWhatsappNumber" class="adm-input" value="${escapeHtml(s.whatsappNumber || '9779866064252')}" placeholder="9779866064252">
            </div>
            <div>
                <label class="adm-label">eSewa QR Image URL / Path</label>
                <input type="text" id="setEsewaQrUrl" class="adm-input" value="${escapeHtml(s.esewaQrUrl || 'images/payment_qr.png')}" placeholder="images/payment_qr.png">
            </div>
            <div>
                <label class="adm-label">eSewa Merchant Name</label>
                <input type="text" id="setEsewaMerchant" class="adm-input" value="${escapeHtml(s.esewaMerchantName || 'BPG EDUCARE')}">
            </div>
            <div>
                <label class="adm-label">Google OAuth Client ID (optional)</label>
                <input type="text" id="setGoogleClientId" class="adm-input" value="${escapeHtml(s.googleClientId || '')}" placeholder="12345-abc.apps.googleusercontent.com">
            </div>
        </div>
    `;
}

async function saveSiteSettings() {
    const whatsappNumber = (document.getElementById('setWhatsappNumber')?.value || '').replace(/[^\d]/g, '') || '9779866064252';
    const esewaQrUrl = document.getElementById('setEsewaQrUrl')?.value.trim() || 'images/payment_qr.png';
    const esewaMerchantName = document.getElementById('setEsewaMerchant')?.value.trim() || 'BPG EDUCARE';
    const googleClientId = document.getElementById('setGoogleClientId')?.value.trim() || '';
    await persistAcademyState({
        siteSettings: { whatsappNumber, esewaQrUrl, esewaMerchantName, googleClientId }
    }, 'Site settings saved.');
}

/* --------------------------------------------------------------------------
   7. BOOT
   -------------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('bpg_theme') === 'dark' ? 'dark' : 'light';
    applyAdminTheme(savedTheme);
    initAdminAuthGate();
});
