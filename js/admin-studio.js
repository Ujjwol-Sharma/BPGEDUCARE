/* ==========================================================================
   BPG EDUCARE — SIMPLIFIED ADMIN PANEL (js/admin-studio.js)
   - 4 Class Sections (Class 12, Class 11, Class 10, Entrance Prep)
   - Subject picker + Syllabus-ordered Lessons
   - Per-lesson inline "Upload PDF" (auto first-page cover) & "Add Video" (thumbnail upload + preview + replace)
   - Inline management of existing uploads directly under each lesson row
   ========================================================================== */

const ADMIN_PASSKEY = 'bpg2026';
const ADMIN_AUTH_KEY = 'bpg_admin_authenticated_v2';

const SECTION_META = [
    { key: 'class-12', label: 'Class 12', sub: 'Grade XII' },
    { key: 'class-11', label: 'Class 11', sub: 'Grade XI' },
    { key: 'class-10', label: 'Class 10', sub: 'SEE Foundation' },
    { key: 'after-12', label: 'Entrance Prep', sub: 'IOE / CEE / KU' }
];

let ADMIN_STATE = null;
let ADMIN_ROSTER = { accounts: [], duplicateGroups: [] };
let ADMIN_MOCK_TESTS = [];
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
        'x-admin-passkey': ADMIN_PASSKEY
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
    try {
        if ('BroadcastChannel' in window) {
            const ch1 = new BroadcastChannel('bpg_academy_sync');
            ch1.postMessage({ type, timestamp: Date.now() });
            ch1.close();
            const ch2 = new BroadcastChannel('bpg_maths_academy_live_sync');
            ch2.postMessage({ type, timestamp: Date.now() });
            ch2.close();
        }
    } catch (e) {}
}

function handleAdminLogin(e) {
    if (e) e.preventDefault();
    const pass = (document.getElementById('admPass')?.value || '').trim();
    if (pass !== ADMIN_PASSKEY && pass !== 'admin') {
        showAdminToast('Incorrect admin passkey.', 'error');
        return;
    }
    sessionStorage.setItem(ADMIN_AUTH_KEY, '1');
    openAdminShell();
}

function logoutAdmin() {
    sessionStorage.removeItem(ADMIN_AUTH_KEY);
    document.getElementById('adminShell').style.display = 'none';
    document.getElementById('adminLoginSplash').classList.remove('hidden');
}

async function openAdminShell() {
    document.getElementById('adminLoginSplash')?.classList.add('hidden');
    const shell = document.getElementById('adminShell');
    if (shell) shell.style.display = 'flex';
    await loadAdminData();
}

async function loadAdminData() {
    setSaveStatus('Loading...');
    try {
        const [stateRes, rosterRes, mockRes] = await Promise.all([
            fetch('/api/academy-state?_t=' + Date.now(), {
                cache: 'no-store',
                headers: { 'x-admin-passkey': ADMIN_PASSKEY }
            }),
            fetch('/api/student-roster?_t=' + Date.now(), {
                cache: 'no-store',
                headers: { 'x-admin-passkey': ADMIN_PASSKEY }
            }),
            fetch('/api/mock-tests?_t=' + Date.now(), {
                cache: 'no-store',
                headers: { 'x-admin-passkey': ADMIN_PASSKEY }
            })
        ]);

        const stateJson = await stateRes.json();
        const rosterJson = await rosterRes.json();
        const mockJson = await mockRes.json().catch(() => ({ tests: [] }));

        if (stateJson?.data) ADMIN_STATE = stateJson.data;
        if (rosterJson?.data) ADMIN_ROSTER = rosterJson.data;
        if (Array.isArray(mockJson?.tests)) ADMIN_MOCK_TESTS = mockJson.tests;

        setSaveStatus('All changes saved');
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
    ['users', 'content', 'mocktests', 'zoom', 'team', 'sections', 'plans'].forEach(t => {
        document.getElementById(`tabBtn-${t}`)?.classList.toggle('active', t === tabName);
        document.getElementById(`pane-${t}`)?.classList.toggle('active', t === tabName);
    });
    if (tabName === 'users') renderUsersTab();
    if (tabName === 'content') renderContentTab();
    if (tabName === 'mocktests') renderMockTestsTab();
    if (tabName === 'zoom') renderZoomClassesTab();
    if (tabName === 'team') renderTeamTab();
    if (tabName === 'sections') renderSectionAccessTab();
    if (tabName === 'plans') renderPlansTab();
}

function renderAllAdminTabs() {
    renderUsersTab();
    renderContentTab();
    renderMockTestsTab();
    renderZoomClassesTab();
    renderTeamTab();
    renderSectionAccessTab();
    renderPlansTab();
}

/* --------------------------------------------------------------------------
   3. TAB 1: USERS
   -------------------------------------------------------------------------- */
function renderUsersTab() {
    const tbody = document.getElementById('usersTableBody');
    const dupBanner = document.getElementById('duplicateGmailReviewBanner');
    if (!tbody) return;

    const accounts = ADMIN_ROSTER.accounts || [];
    const dupGroups = ADMIN_ROSTER.duplicateGroups || [];

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
    const filtered = accounts.filter(acc => {
        if (!q) return true;
        return (acc.name || '').toLowerCase().includes(q)
            || (acc.email || '').toLowerCase().includes(q)
            || (acc.canonicalEmail || '').toLowerCase().includes(q);
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:28px; color:var(--adm-text-muted);">No matching students found.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(acc => {
        const emailEsc = escapeHtml(acc.email);
        const plan = (acc.plan || 'free').toLowerCase();
        return `
            <tr>
                <td><strong>${escapeHtml(acc.name || 'Student')}</strong></td>
                <td>
                    <div>${emailEsc}</div>
                    ${acc.duplicateFlag ? '<span class="adm-flag-badge">Duplicate Gmail</span>' : ''}
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
                        <option value="gold" ${plan === 'gold' ? 'selected' : ''}>Gold</option>
                        <option value="diamond" ${plan === 'diamond' ? 'selected' : ''}>Diamond</option>
                    </select>
                </td>
                <td style="color:var(--adm-text-muted); font-size:0.84rem;">${escapeHtml(acc.joinedAt || '')}</td>
                <td>
                    <button type="button" class="btn-topbar danger" style="padding:5px 10px; font-size:0.78rem;" onclick="handleAdminDeleteUser('${emailEsc}')">Delete</button>
                </td>
            </tr>
        `;
    }).join('');
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
            body: JSON.stringify({ action: 'UPDATE_CLASS', email, grade: newGrade })
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
            <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
                <div>
                    <strong style="font-size:0.95rem;">Units &amp; Chapters (${escapeHtml(secLabel)} Syllabus Grid)</strong>
                    <div style="font-size:0.78rem; color:var(--adm-text-muted);">Rename or delete units and chapters. Linked lessons, PDFs, and videos stay attached on rename and can be moved before deletion.</div>
                </div>
                <button type="button" class="btn-topbar" style="padding:6px 12px; font-size:0.8rem;" onclick="promptAddSyllabusUnit('${activeContentClass}')">+ Add Unit / Chapter</button>
            </div>
            ${syllabusRows.length === 0 ? `<div class="adm-empty-note" style="margin-top:8px;">No units yet for ${escapeHtml(secLabel)}.</div>` : syllabusRows.map((row, uIdx) => {
                const uKey = `${activeContentClass}|${uIdx}`;
                const isRenaming = renamingUnitKey === uKey;
                return `
                    <div class="adm-unit-row">
                        ${isRenaming ? `
                            <form style="display:flex; gap:8px; flex-wrap:wrap; flex:1; align-items:center;" onsubmit="saveRenamedSyllabusUnit(event, '${activeContentClass}', ${uIdx})">
                                <input type="text" id="renameUnitCode_${uIdx}" class="adm-input" style="width:110px;" value="${escapeHtml(row.code || '')}" placeholder="Unit 01" required>
                                <input type="text" id="renameUnitName_${uIdx}" class="adm-input" style="flex:1; min-width:200px;" value="${escapeHtml(row.name || row.domain || '')}" placeholder="Unit / Chapter title" required>
                                <input type="text" id="renameUnitHours_${uIdx}" class="adm-input" style="width:90px;" value="${escapeHtml(row.hours || '')}" placeholder="20 hrs">
                                <input type="text" id="renameUnitMarks_${uIdx}" class="adm-input" style="width:100px;" value="${escapeHtml(row.marks || '')}" placeholder="15 Marks">
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
                                <button type="button" class="btn-topbar" style="padding:5px 10px; font-size:0.76rem;" onclick="startRenameSyllabusUnit('${activeContentClass}', ${uIdx})">Rename</button>
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
                                    <span class="adm-lesson-counts">${pdfs.length} ${pdfs.length === 1 ? 'PDF' : 'PDFs'} &middot; ${videos.length} ${videos.length === 1 ? 'Video' : 'Videos'}</span>
                                </div>
                                <div class="adm-lesson-actions">
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

                        ${openForm === 'pdf' ? renderInlinePdfForm(activeContentClass, activeSubject.id, lesson) : ''}
                        ${openForm === 'video' ? renderInlineVideoForm(activeContentClass, activeSubject.id, lesson) : ''}

                        ${(pdfs.length > 0 || videos.length > 0) ? renderExistingLessonUploads(activeContentClass, activeSubject.id, lesson, pdfs, videos) : ''}
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

function renderInlinePdfForm(classKey, subjectId, lesson) {
    const safeSubjId = escapeHtml(subjectId);
    const safeLessonId = escapeHtml(lesson.id);
    const prefix = `${classKey}_${subjectId}_${lesson.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');

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
                        <label class="adm-label" for="vidPlan_${prefix}">Minimum Plan</label>
                        <select id="vidPlan_${prefix}" class="adm-select">
                            <option value="free" selected>Free</option>
                            <option value="gold">Gold</option>
                            <option value="diamond">Diamond</option>
                        </select>
                    </div>
                </div>
                <div style="display:grid; grid-template-columns:1fr 180px; gap:12px; align-items:start; margin-top:12px;">
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

    return `
        <div class="adm-existing-uploads">
            ${pdfs.map(pdf => {
                const pid = escapeHtml(pdf.id);
                const mp = (pdf.minPlan || 'free').toLowerCase();
                return `
                    <div class="adm-upload-item">
                        <div class="adm-upload-left">
                            <div class="adm-mini-cover pdf-mini">
                                ${pdf.coverImage ? `<img src="${pdf.coverImage}" alt="PDF cover">` : `<span>PDF</span>`}
                            </div>
                            <div>
                                <div class="adm-upload-title">${escapeHtml(pdf.title || pdf.fileName || 'PDF')}</div>
                                <div class="adm-upload-sub">PDF</div>
                            </div>
                        </div>
                        <div class="adm-upload-controls">
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
                const inputId = `replaceThumb_${vidId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
                return `
                    <div class="adm-upload-item">
                        <div class="adm-upload-left">
                            <div class="adm-mini-cover video-mini">
                                ${vid.thumbnailUrl ? `<img src="${vid.thumbnailUrl}" alt="Video thumbnail">` : `<span>Video</span>`}
                            </div>
                            <div>
                                <div class="adm-upload-title">${escapeHtml(vid.title || 'Video')}</div>
                                <div class="adm-upload-sub">Video</div>
                            </div>
                        </div>
                        <div class="adm-upload-controls">
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

    lesson.videos.push({
        id: `lvid_${Date.now()}`,
        title,
        videoUrl,
        thumbnailUrl,
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
    if (!pdf?.fileUrl) return;
    let openUrl = pdf.fileUrl;
    if (openUrl.startsWith('data:application/pdf;base64,')) {
        const bin = atob(openUrl.slice('data:application/pdf;base64,'.length));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        openUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    }
    window.open(openUrl, '_blank', 'noopener');
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

async function promptAddSyllabusUnit(classKey) {
    const title = prompt('Enter Unit / Chapter title:');
    if (!title || !title.trim()) return;
    const syllabusRows = JSON.parse(JSON.stringify(ADMIN_STATE.portals[classKey]?.syllabusRows || []));
    const code = `Unit ${String(syllabusRows.length + 1).padStart(2, '0')}`;
    syllabusRows.push({
        code,
        name: title.trim(),
        hours: '12 hrs',
        marks: '8 Marks',
        focus: 'Structured syllabus unit'
    });
    const subjects = JSON.parse(JSON.stringify(getAdminSubjects(classKey)));
    const activeSubj = subjects.find(s => s.id === activeSubjectByClass[classKey]) || subjects[0];
    if (activeSubj) {
        activeSubj.lessons = activeSubj.lessons || [];
        activeSubj.lessons.push({
            id: `${classKey}-${activeSubj.id}-l${Date.now()}`,
            code,
            title: title.trim(),
            pdfs: [],
            videos: []
        });
    }
    await persistAcademyState({ portals: { [classKey]: { syllabusRows, subjects } } }, `Added "${title.trim()}".`);
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
    if (!newName) return;

    row.code = newCode || oldCode;
    row.name = newName;
    row.hours = newHours;
    row.marks = newMarks;

    // Update linked lesson's code/title while keeping all its PDFs & videos attached
    const subjects = JSON.parse(JSON.stringify(getAdminSubjects(classKey)));
    subjects.forEach(subj => {
        (subj.lessons || []).forEach(l => {
            if ((oldCode && l.code === oldCode) || (oldName && l.title === oldName)) {
                l.code = row.code;
                if (l.title === oldName) l.title = newName;
            }
        });
    });

    renamingUnitKey = '';
    await persistAcademyState(
        { portals: { [classKey]: { syllabusRows, subjects } } },
        `Renamed unit to "${newName}" (all linked resources preserved).`
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
        closeSafeDeleteModal();
        await persistAcademyState(
            { portals: { [classKey]: { subjects } } },
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
                            <textarea id="mcqText_${idx}" class="adm-textarea" rows="2" placeholder="Enter MCQ question...">${escapeHtml(q.text || '')}</textarea>
                            <div class="adm-mcq-options-grid">
                                ${['A', 'B', 'C', 'D'].map(opt => `
                                    <div class="adm-mcq-opt-row">
                                        <span class="adm-mcq-opt-label">${opt}</span>
                                        <input type="text" id="mcqOpt_${idx}_${opt}" class="adm-input" placeholder="Option ${opt}" value="${escapeHtml(q.options?.[opt] || '')}">
                                    </div>
                                `).join('')}
                            </div>
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
                        <strong>Q${i + 1}: ${escapeHtml(q.text || '')}</strong>
                        <span class="adm-status-pill ${st === 'correct' ? 'open' : 'locked'}">${st.toUpperCase()}</span>
                    </div>
                    <div style="font-size:0.84rem; color:var(--adm-text-muted);">
                        Your answer: <strong>${picked || 'Skipped'}</strong> &middot; Correct answer: <strong>${corr} (${escapeHtml(q.options?.[corr] || '')})</strong>
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
        return;
    }

    const q = qs[index] || qs[0];
    const picked = answers[q.id] || '';
    body.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:10px;">
            <span style="font-size:0.86rem; color:var(--adm-text-muted);">Question ${index + 1} of ${qs.length}</span>
            <span class="adm-duration-badge"><i class="fa-regular fa-clock" style="margin-right:6px;"></i><span id="admPreviewTimer">${formatAdminPreviewClock(remainingSec)}</span></span>
        </div>
        <p style="font-size:1rem; font-weight:600; margin-bottom:14px; white-space:pre-wrap;">${escapeHtml(q.text || '(No question text yet)')}</p>
        <div>
            ${['A', 'B', 'C', 'D'].map(opt => `
                <button type="button" class="adm-preview-opt-btn ${picked === opt ? 'selected' : ''}" onclick="selectAdminMockPreviewAnswer('${escapeHtml(q.id)}', '${opt}')">
                    <span class="adm-mcq-opt-label">${opt}</span>
                    <span>${escapeHtml(q.options?.[opt] || '(Empty option)')}</span>
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
    const role = (document.getElementById('tmRole')?.value || '').trim();
    const slot = document.getElementById('tmSlot')?.value || 'member';
    const photoUrlInput = (document.getElementById('tmPhotoUrl')?.value || '').trim();
    const bio = (document.getElementById('tmBio')?.value || '').trim();
    if (!name || !role) {
        showAdminToast('Name and role are required.', 'error');
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
        bio
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
        ceo: 'Row 2 · 1st (CEO)',
        cco: 'Row 2 · 2nd (CCO)',
        cto: 'Row 2 · 3rd (CTO)',
        member: 'Additional Member'
    };

    const editorHtml = editingTeamMember ? `
        <form class="adm-mock-editor" style="margin-bottom:18px;" onsubmit="handleSaveTeamMember(event)">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
                <strong>${editingTeamMember.id ? 'Edit Team Profile' : 'Add Team Profile'}</strong>
                <button type="button" class="btn-topbar" style="padding:5px 10px; font-size:0.78rem;" onclick="cancelTeamMemberEdit()">Cancel</button>
            </div>
            <div class="adm-form-grid-3" style="margin-bottom:12px;">
                <div>
                    <label class="adm-label" for="tmName">Full Name</label>
                    <input type="text" id="tmName" class="adm-input" value="${escapeHtml(editingTeamMember.name)}" placeholder="e.g. Bishnu Prasad Gautam" required>
                </div>
                <div>
                    <label class="adm-label" for="tmRole">Role Title</label>
                    <input type="text" id="tmRole" class="adm-input" value="${escapeHtml(editingTeamMember.role)}" placeholder="Founder / CEO / CCO / CTO" required>
                </div>
                <div>
                    <label class="adm-label" for="tmSlot">Homepage Row Position</label>
                    <select id="tmSlot" class="adm-select">
                        <option value="founder" ${editingTeamMember.slot === 'founder' ? 'selected' : ''}>Founder (Row 1 Centered)</option>
                        <option value="ceo" ${editingTeamMember.slot === 'ceo' ? 'selected' : ''}>CEO (Row 2 — 1st)</option>
                        <option value="cco" ${editingTeamMember.slot === 'cco' ? 'selected' : ''}>CCO (Row 2 — 2nd)</option>
                        <option value="cto" ${editingTeamMember.slot === 'cto' ? 'selected' : ''}>CTO (Row 2 — 3rd)</option>
                        <option value="member" ${editingTeamMember.slot === 'member' ? 'selected' : ''}>Additional Member</option>
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
            <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px;">
                <div class="adm-team-thumb" id="teamPhotoPreviewImg">
                    ${(pendingTeamPhotoDataUrl || editingTeamMember.photoUrl) ? `<img src="${escapeHtml(pendingTeamPhotoDataUrl || editingTeamMember.photoUrl)}" alt="Preview">` : escapeHtml((editingTeamMember.name || 'T').charAt(0).toUpperCase())}
                </div>
                <span style="font-size:0.8rem; color:var(--adm-text-muted);">Photo preview (upload an image or enter a URL)</span>
            </div>
            <div style="margin-bottom:14px;">
                <label class="adm-label" for="tmBio">Short Bio</label>
                <textarea id="tmBio" class="adm-textarea" rows="2" placeholder="Brief leadership bio shown on the homepage...">${escapeHtml(editingTeamMember.bio || '')}</textarea>
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
                                <span style="font-size:0.8rem; font-weight:600; color:var(--adm-text-muted);">${escapeHtml(m.role)}</span>
                                <div style="font-size:0.74rem; color:var(--adm-text-muted);">${escapeHtml(slotLabels[m.slot] || 'Team Member')}</div>
                            </div>
                        </div>
                        <p style="margin:0; font-size:0.84rem; color:var(--adm-text-secondary); line-height:1.5;">${escapeHtml(m.bio || '')}</p>
                        <div style="display:flex; gap:6px; margin-top:auto;">
                            <button type="button" class="btn-topbar" style="padding:5px 11px; font-size:0.78rem;" onclick="startEditTeamMember('${safeId}')">Edit</button>
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
   7. BOOT
   -------------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('bpg_theme') === 'dark' ? 'dark' : 'light';
    applyAdminTheme(savedTheme);

    const params = new URLSearchParams(window.location.search);
    if (params.get('pass') === ADMIN_PASSKEY || sessionStorage.getItem(ADMIN_AUTH_KEY) === '1') {
        sessionStorage.setItem(ADMIN_AUTH_KEY, '1');
        openAdminShell();
    }
});
