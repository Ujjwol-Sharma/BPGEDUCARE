/* BPG Academy — Strict Single-Class Dedicated Router & Access Controller (js/router-access.js) */

var BPG_STUDENT_SESSION_KEY = window.BPG_STUDENT_SESSION_KEY || 'bpg_academy_student_session_v1';
var BPG_LAST_CLASS_ACTIVITY_KEY = 'bpg_last_class_activity_v1';
let pendingTargetClass = null;

function recordLastClassActivity(classShortKey, tabKey = 'notes') {
    const session = getStoredStudentSession();
    if (!session || !session.email) return;
    const norm = normalizeClassKey(classShortKey);
    if (!['c10', 'c11', 'c12', 'entrance'].includes(norm)) return;
    try {
        const all = JSON.parse(localStorage.getItem(BPG_LAST_CLASS_ACTIVITY_KEY) || '{}');
        all[String(session.email).toLowerCase()] = {
            classShortKey: norm,
            tabKey: tabKey || 'notes',
            updatedAt: Date.now()
        };
        localStorage.setItem(BPG_LAST_CLASS_ACTIVITY_KEY, JSON.stringify(all));
    } catch (e) {}
}

function getLastClassActivity() {
    const session = getStoredStudentSession();
    if (!session || !session.email) return null;
    try {
        const all = JSON.parse(localStorage.getItem(BPG_LAST_CLASS_ACTIVITY_KEY) || '{}');
        return all[String(session.email).toLowerCase()] || null;
    } catch (e) {
        return null;
    }
}

function updateHeroPrimaryCta() {
    const labelEl = document.getElementById('heroPrimaryCtaLabel');
    const btnEl = document.getElementById('heroPrimaryCtaBtn');
    const signedIn = isUserAuthenticated();
    if (labelEl) {
        labelEl.textContent = signedIn ? 'Continue to Class' : 'Get Started';
    }
    if (btnEl) {
        btnEl.setAttribute('data-auth-state', signedIn ? 'signed-in' : 'signed-out');
    }
}

function handleHeroPrimaryCta() {
    if (isUserAuthenticated()) {
        handleContinueToClass();
    } else {
        openAuthModal('signup');
    }
}

function handleContinueToClass() {
    if (!isUserAuthenticated()) {
        openAuthModal('signin');
        return;
    }
    const last = getLastClassActivity();
    if (last && last.classShortKey && hasAccessToClass(last.classShortKey)) {
        switchPortal(`view-${last.classShortKey}`);
        const tab = last.tabKey || 'notes';
        switchClassTab(last.classShortKey, tab, document.getElementById(`tab-${last.classShortKey}-${tab}`));
        return;
    }
    openClassSelectionView();
}

function openClassSelectionView() {
    if (typeof renderClassSelectionView === 'function') renderClassSelectionView();
    document.querySelectorAll('.portal-view, .view-container').forEach(view => {
        view.style.display = 'none';
        view.classList.remove('active');
    });
    const sel = document.getElementById('view-class-select');
    if (sel) {
        sel.style.display = 'block';
        sel.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    document.body.classList.remove('in-notes-tab');
    setActiveNavLink('classes');
    try { history.replaceState(null, '', '#classes'); } catch (e) {}
    closeClassesDropdown();
    closeMobileNav();
    closeUserDropdown();
}

function openLiveClassCalendarEntry() {
    if (isUserAuthenticated()) {
        const myClass = getStudentRegisteredClass();
        if (!(typeof isSectionLocked === 'function' && isSectionLocked(shortKeyToPortalKey(myClass)))) {
            openMyCalendarView();
            return;
        }
    }
    if (typeof renderPublicZoomScheduleModal === 'function') {
        renderPublicZoomScheduleModal();
    }
    document.getElementById('calendarSessionModal')?.classList.add('open');
}

function closeCalendarSessionModal() {
    document.getElementById('calendarSessionModal')?.classList.remove('open');
}

/* --------------------------------------------------------------------------
   1. SESSION & SINGLE-CLASS ACCESS HELPERS
   -------------------------------------------------------------------------- */
function getStoredStudentSession() {
    try {
        const raw = localStorage.getItem(BPG_STUDENT_SESSION_KEY) || localStorage.getItem('bpg_maths_academy_session_v1') || localStorage.getItem('bpg_student_session_v2') || localStorage.getItem('bpg_student_session');
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function isUserAuthenticated() {
    const session = getStoredStudentSession();
    return !!(session && (session.verified || session.name || session.email));
}

function normalizeClassKey(key) {
    if (!key) return 'c12';
    const k = String(key).toLowerCase().trim().replace('view-', '');
    if (k === 'c10' || k === 'class-10' || k === 'class10' || k === '10') return 'c10';
    if (k === 'c11' || k === 'class-11' || k === 'class11' || k === '11') return 'c11';
    if (k === 'c12' || k === 'class-12' || k === 'class12' || k === '12') return 'c12';
    if (k === 'entrance' || k === 'after-12' || k === 'after12' || k === 'ioe' || k === 'cee' || k === 'ku') return 'entrance';
    if (k === 'home' || k === 'about' || k === '') return 'home';
    return k;
}

function getStudentRegisteredClass() {
    const session = getStoredStudentSession();
    if (session && session.grade) {
        const g = String(session.grade).toLowerCase();
        if (g.includes('10')) return 'c10';
        if (g.includes('11')) return 'c11';
        if (g.includes('12')) return 'c12';
        if (g.includes('after') || g.includes('entrance') || g.includes('ioe') || g.includes('cee')) return 'entrance';
    }
    const directClass = localStorage.getItem('bpg_student_class');
    if (directClass) return normalizeClassKey(directClass);
    return 'c12'; // default fallback
}

function getClassDisplayTitle(classKey) {
    const norm = normalizeClassKey(classKey);
    if (norm === 'c10') return 'Class 10 Mathematics';
    if (norm === 'c11') return 'Grade XI Mathematics';
    if (norm === 'c12') return 'Grade XII Mathematics';
    if (norm === 'entrance') return 'Entrance Prep Mathematics';
    return 'Mathematics';
}

function shortKeyToPortalKey(key) {
    const norm = normalizeClassKey(key);
    if (norm === 'c10') return 'class-10';
    if (norm === 'c11') return 'class-11';
    if (norm === 'c12') return 'class-12';
    if (norm === 'entrance') return 'after-12';
    return 'class-12';
}

function getStudentPlan() {
    const session = getStoredStudentSession();
    const p = String(session?.plan || 'free').toLowerCase();
    return (p === 'diamond' || p === 'gold' || p === 'free') ? p : 'free';
}

function formatPlanLabel(plan) {
    const cfg = typeof getPlansConfig === 'function' ? getPlansConfig() : {};
    const p = String(plan || 'free').toLowerCase();
    return cfg[p]?.name || (p.charAt(0).toUpperCase() + p.slice(1));
}

function syncSectionLockBadges() {
    const sections = [
        { key: 'class-12', defaultSub: 'NEB Mat. 102 · Senior Secondary', optId: null, optLabel: 'Class 12 (NEB Mat. 102)' },
        { key: 'class-11', defaultSub: 'NEB Mat. 101 · Foundations', optId: null, optLabel: 'Class 11 (NEB Mat. 101)' },
        { key: 'class-10', defaultSub: 'SEE Compulsory & Optional Math', optId: 'signupOpt-class-10', optLabel: 'Class 10 (SEE Foundation)' },
        { key: 'after-12', defaultSub: 'IOE Pulchowk / CEE / KU', optId: 'signupOpt-after-12', optLabel: 'Entrance Prep (IOE / CEE / KU)' }
    ];

    sections.forEach(s => {
        const info = typeof getSectionLockInfo === 'function'
            ? getSectionLockInfo(s.key)
            : { locked: s.key === 'class-10' || s.key === 'after-12', reason: 'Temporarily unavailable' };

        const badge = document.getElementById(`navBadge-${s.key}`);
        const sub = document.getElementById(`navSub-${s.key}`);
        const btn = document.querySelector(`.classes-dropdown-item[data-section-key="${s.key}"]`);

        if (badge) {
            badge.textContent = info.locked ? 'Locked' : '';
            badge.classList.toggle('locked', info.locked);
        }
        if (sub) {
            sub.textContent = info.locked ? (info.reason || 'Temporarily unavailable') : s.defaultSub;
        }
        if (btn) {
            btn.classList.toggle('is-locked-section', info.locked);
        }

        if (s.optId) {
            const opt = document.getElementById(s.optId);
            if (opt) {
                opt.textContent = info.locked
                    ? `${s.optLabel} (Locked — ${info.reason || 'Temporarily unavailable'})`
                    : s.optLabel;
                opt.disabled = info.locked;
            }
        }
    });
}

function showSectionLockedModal(targetClassKey) {
    const portalKey = shortKeyToPortalKey(targetClassKey);
    const info = typeof getSectionLockInfo === 'function'
        ? getSectionLockInfo(portalKey)
        : { locked: true, reason: 'Temporarily unavailable' };
    const titleEl = document.getElementById('sectionLockedTitle');
    const msgEl = document.getElementById('sectionLockedMessage');
    if (titleEl) titleEl.textContent = getClassDisplayTitle(targetClassKey);
    if (msgEl) {
        msgEl.textContent = `${info.reason || 'Temporarily unavailable'}. This section is temporarily locked across all plans (including Diamond) until reopened by the academy.`;
    }
    document.getElementById('sectionLockedModal')?.classList.add('open');
}

function closeSectionLockedModal() {
    document.getElementById('sectionLockedModal')?.classList.remove('open');
}

function openPlanComparisonModal(requiredPlan = 'gold', itemTitle = '') {
    const modal = document.getElementById('planComparisonModal');
    const grid = document.getElementById('planComparisonGrid');
    const sub = document.getElementById('planComparisonSubtitle');
    const waLink = document.getElementById('planUpgradeWhatsappLink');
    if (!modal || !grid) return;

    const plans = typeof getPlansConfig === 'function' ? getPlansConfig() : {};
    const currentPlan = getStudentPlan();
    const targetPlan = String(requiredPlan || 'gold').toLowerCase();

    if (sub) {
        sub.innerHTML = itemTitle
            ? `Unlock <strong>${escapeHtml ? escapeHtml(itemTitle) : itemTitle}</strong> by upgrading to <strong>${formatPlanLabel(targetPlan)}</strong> or higher.`
            : 'Compare Free, Gold, and Diamond plans across all open sections.';
    }

    // Count items unlocked by each plan across open sections (PDFs, Videos, Zoom Classes)
    const counts = {
        free: { p: 0, v: 0, z: 0 },
        gold: { p: 0, v: 0, z: 0 },
        diamond: { p: 0, v: 0, z: 0 }
    };
    const rank = { free: 0, gold: 1, diamond: 2 };
    Object.keys(ACADEMY_STATE.portals || {}).forEach(ck => {
        if (typeof isSectionLocked === 'function' && isSectionLocked(ck)) return;
        const portal = ACADEMY_STATE.portals[ck];
        (portal.subjects || []).forEach(subj => {
            (subj.lessons || []).forEach(l => {
                (l.pdfs || []).forEach(pdf => {
                    const mp = (pdf.minPlan || 'free').toLowerCase();
                    ['free', 'gold', 'diamond'].forEach(pl => {
                        if (rank[pl] >= rank[mp]) counts[pl].p++;
                    });
                });
                (l.videos || []).forEach(vid => {
                    const mp = (vid.minPlan || 'free').toLowerCase();
                    ['free', 'gold', 'diamond'].forEach(pl => {
                        if (rank[pl] >= rank[mp]) counts[pl].v++;
                    });
                });
            });
        });
    });
    (ACADEMY_STATE.zoomClasses || []).forEach(zc => {
        if (zc.status === 'cancelled') return;
        if (zc.classKey && zc.classKey !== 'all' && typeof isSectionLocked === 'function' && isSectionLocked(zc.classKey)) return;
        const mp = (zc.minPlan || 'free').toLowerCase();
        ['free', 'gold', 'diamond'].forEach(pl => {
            if (rank[pl] >= rank[mp]) counts[pl].z++;
        });
    });

    const tiers = ['free', 'gold', 'diamond'];
    grid.innerHTML = tiers.map(pid => {
        const cfg = plans[pid] || { name: pid, price: 'Rs. 0', period: '', description: '' };
        const isHighlighted = Boolean(requiredPlan) && pid === targetPlan;
        const isCurrent = pid === currentPlan && isUserAuthenticated();
        const c = counts[pid];
        return `
            <div class="plan-compare-col ${isHighlighted ? 'is-recommended' : ''}">
                <div class="plan-compare-head">
                    <span class="plan-tier-name">${cfg.name}</span>
                    ${isHighlighted ? '<span class="plan-highlight-tag">Unlocks this item</span>' : (isCurrent ? '<span class="plan-current-tag">Your plan</span>' : '')}
                </div>
                <div class="plan-price-row">
                    <strong>${cfg.price}</strong>
                    <span>${cfg.period || ''}</span>
                </div>
                <p class="plan-desc">${cfg.description || ''}</p>
                <ul class="plan-counts-list">
                    <li>${c.p} Lesson PDFs &amp; ${c.v} Videos (open sections)</li>
                    <li>${c.z} Live Zoom Classes (open sections)</li>
                    <li>${pid === 'diamond' ? 'Full access to all open section lessons, mock tests &amp; live classes' : (pid === 'gold' ? 'All Free content + Gold lessons, mock tests &amp; live classes' : 'Selected Free lessons, mock tests &amp; live classes')}</li>
                </ul>
            </div>
        `;
    }).join('');

    if (waLink) {
        const session = getStoredStudentSession();
        const planName = plans[targetPlan]?.name || targetPlan;
        const msg = `Namaste BPG Sir, I would like to upgrade my BPG EDUCARE membership (${session?.email || 'my email'}) to the ${planName} plan.`;
        waLink.href = `https://wa.me/9779866064252?text=${encodeURIComponent(msg)}`;
    }

    modal.classList.add('open');
}

function closePlanComparisonModal() {
    document.getElementById('planComparisonModal')?.classList.remove('open');
}

function hasAccessToClass(classKey) {
    if (!isUserAuthenticated()) return false;
    const norm = normalizeClassKey(classKey);
    if (typeof isSectionLocked === 'function' && isSectionLocked(shortKeyToPortalKey(norm))) return false;
    const myClass = getStudentRegisteredClass();
    return norm === myClass;
}

/* --------------------------------------------------------------------------
   2. CLEAN STUDENT HOMEPAGE & LESSONS ROUTING
   -------------------------------------------------------------------------- */
function populateStudentHomepage() {
    const session = getStoredStudentSession();
    if (!session) return;
    const myClass = getStudentRegisteredClass();
    const plan = getStudentPlan();
    const planLabel = formatPlanLabel(plan);

    const greetEl = document.getElementById('studentHomeGreeting');
    if (greetEl) greetEl.textContent = `Welcome, ${session.name || 'Student'}`;

    const titleEl = document.getElementById('studentHomeClassTitle');
    if (titleEl) titleEl.textContent = getClassDisplayTitle(myClass);

    const planTextEl = document.getElementById('studentHomePlanText');
    if (planTextEl) planTextEl.textContent = `${planLabel} Membership`;

    const planIconEl = document.getElementById('studentHomePlanIcon');
    if (planIconEl) {
        planIconEl.className = plan === 'diamond'
            ? 'fa-solid fa-gem'
            : (plan === 'gold' ? 'fa-solid fa-crown' : 'fa-solid fa-id-badge');
    }
}

function openStudentHomepage() {
    if (!isUserAuthenticated()) {
        switchPortal('view-home');
        return;
    }
    populateStudentHomepage();
    document.querySelectorAll('.portal-view, .view-container').forEach(view => {
        view.style.display = 'none';
        view.classList.remove('active');
    });
    const studentHome = document.getElementById('view-student-home');
    if (studentHome) {
        studentHome.style.display = 'block';
        studentHome.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    setActiveNavLink('home');
    closeClassesDropdown();
    closeMobileNav();
    closeUserDropdown();
}

function openMyWorkspaceTab(tabKey) {
    if (!isUserAuthenticated()) {
        openAuthModal('signin');
        return;
    }
    const myClass = getStudentRegisteredClass();
    if (typeof isSectionLocked === 'function' && isSectionLocked(shortKeyToPortalKey(myClass))) {
        showSectionLockedModal(myClass);
        return;
    }
    switchPortal(`view-${myClass}`);
    switchClassTab(myClass, tabKey, document.getElementById(`tab-${myClass}-${tabKey}`));
}

function openMyLessonsView() {
    openMyWorkspaceTab('notes');
}

function openMyMockTestsView() {
    openMyWorkspaceTab('mocktests');
}

function openMySyllabusView() {
    openMyWorkspaceTab('syllabus');
}

function openMyCalendarView() {
    openMyWorkspaceTab('live');
}

function handleHomeClick() {
    // Every "Home" link (including logo) takes users back to the original public homepage
    // while keeping any active signed-in session intact!
    switchPortal('view-home');
    updateHeroPrimaryCta();
    try { history.replaceState(null, '', '#home'); } catch (e) {}
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openMyClassWorkspace() {
    openMyLessonsView();
}

function handleClassNavClick(targetClassKey) {
    const targetNorm = normalizeClassKey(targetClassKey);
    const portalKey = shortKeyToPortalKey(targetNorm);
    pendingTargetClass = targetNorm;

    // 1. Always enforce section locks FIRST on every plan (including Diamond)
    if (typeof isSectionLocked === 'function' && isSectionLocked(portalKey)) {
        showSectionLockedModal(targetNorm);
        return;
    }

    if (!isUserAuthenticated()) {
        openAuthModal('signup', targetNorm);
        return;
    }

    const myClass = getStudentRegisteredClass();
    if (targetNorm === myClass) {
        switchPortal(`view-${myClass}`);
    } else {
        showRestrictedAccessModal(targetNorm);
    }
}

function handleProgramCardClick(targetClassKey) {
    handleClassNavClick(targetClassKey);
}

function showRestrictedAccessModal(targetClassKey) {
    const myClass = getStudentRegisteredClass();
    const myTitle = getClassDisplayTitle(myClass);

    const modal = document.getElementById('restrictedAccessModal');
    const msgEl = document.getElementById('restrictedAccessMessage');
    if (msgEl) {
        msgEl.innerHTML = `Your ID is registered exclusively for <strong>${myTitle}</strong>. To enroll in a different program, please register a new account.`;
    }
    if (modal) modal.classList.add('open');
}

function closeRestrictedAccessModal() {
    document.getElementById('restrictedAccessModal')?.classList.remove('open');
}

function handleSwitchAccountRegister() {
    closeRestrictedAccessModal();
    const target = pendingTargetClass || 'c12';
    // Sign out current session
    handleSignOutSilent();
    // Open sign-up modal pre-selected for target class
    setTimeout(() => {
        openAuthModal('signup', target);
    }, 150);
}

function handleSignOutSilent() {
    isAuthenticated = false;
    localStorage.removeItem(BPG_STUDENT_SESSION_KEY);
    localStorage.removeItem('bpg_student_session');
    localStorage.removeItem('bpg_student_class');
    document.body.classList.remove('user-authenticated');
    const userWrap = document.getElementById('userDropdownWrap');
    if (userWrap) userWrap.style.display = 'none';
    const signBtn = document.getElementById('headerGoogleBtn');
    if (signBtn) signBtn.style.display = 'inline-flex';
    switchPortal('view-home');
}

/* --------------------------------------------------------------------------
   3. PORTAL SWITCHER & WORKSPACE MOUNTING
   -------------------------------------------------------------------------- */
function switchPortal(portalId) {
    if (!portalId) portalId = 'view-home';
    let targetId = portalId.startsWith('view-') ? portalId : `view-${portalId}`;

    const isAuth = isUserAuthenticated();
    const norm = normalizeClassKey(targetId.replace('view-', ''));

    // SECTION LOCK GUARD: Applies to every plan (including Diamond) and direct links!
    if (['c10', 'c11', 'c12', 'entrance'].includes(norm)) {
        const portalKey = shortKeyToPortalKey(norm);
        if (typeof isSectionLocked === 'function' && isSectionLocked(portalKey)) {
            showSectionLockedModal(norm);
            targetId = 'view-home';
        }
    }

    // GUEST ROUTING GUARD: Guests cannot enter class workspaces directly
    if (!isAuth && ['c10', 'c11', 'c12', 'entrance'].includes(norm) && targetId !== 'view-home') {
        openAuthModal('signup', norm);
        return;
    }

    // AUTHENTICATED EXCLUSIVE ROUTING: If visiting home or a different class
    if (isAuth && targetId !== 'view-home') {
        const myClass = getStudentRegisteredClass();
        if (['c10', 'c11', 'c12', 'entrance'].includes(norm) && norm !== myClass) {
            showRestrictedAccessModal(norm);
            return;
        }
    }

    // Hide all portal views
    document.querySelectorAll('.portal-view, .view-container').forEach(view => {
        view.style.display = 'none';
        view.classList.remove('active');
    });

    // Display target view
    const targetView = document.getElementById(targetId);
    if (targetView) {
        targetView.style.display = 'block';
        targetView.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Ensure first active tab in that view is visible if entering a class workspace
    const targetNorm = normalizeClassKey(targetId.replace('view-', ''));
    if (['c10', 'c11', 'c12', 'entrance'].includes(targetNorm)) {
        const activePane = targetView?.querySelector('.portal-tab-pane.active');
        let activeTabKey = 'notes';
        if (!activePane) {
            const defaultPane = document.getElementById(`pane-${targetNorm}-notes`);
            const defaultBtn = document.getElementById(`tab-${targetNorm}-notes`);
            if (defaultPane) defaultPane.classList.add('active');
            if (defaultBtn) defaultBtn.classList.add('active');
        } else {
            const parts = activePane.id.split('-');
            activeTabKey = parts[parts.length - 1] || 'notes';
        }
        recordLastClassActivity(targetNorm, activeTabKey);
        try { history.replaceState(null, '', `#${targetNorm}`); } catch (e) {}
        const notesActive = document.getElementById(`pane-${targetNorm}-notes`)?.classList.contains('active');
        document.body.classList.toggle('in-notes-tab', Boolean(notesActive));
    } else {
        document.body.classList.remove('in-notes-tab');
    }

    if (typeof closeClassesDropdown === 'function') closeClassesDropdown();
    if (typeof closeMobileNav === 'function') closeMobileNav();
    if (typeof closeUserDropdown === 'function') closeUserDropdown();

    // Update Nav Link highlighting
    setActiveNavLink(targetId === 'view-home' ? 'home' : 'classes');

    if (typeof initScrollRevealAnimations === 'function') {
        setTimeout(initScrollRevealAnimations, 60);
    }
}

function switchClassTab(classId, tabKey, btnEl) {
    const norm = normalizeClassKey(classId);
    const parentView = document.getElementById(`view-${norm}`);
    if (!parentView) return;

    parentView.querySelectorAll('.strip-tab-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) {
        btnEl.classList.add('active');
    } else {
        const found = document.getElementById(`tab-${norm}-${tabKey}`);
        if (found) found.classList.add('active');
    }

    parentView.querySelectorAll('.portal-tab-pane').forEach(p => p.classList.remove('active'));
    const targetPane = document.getElementById(`pane-${norm}-${tabKey}`);
    if (targetPane) targetPane.classList.add('active');
    document.body.classList.toggle('in-notes-tab', tabKey === 'notes');
    recordLastClassActivity(norm, tabKey);

    if (tabKey === 'mocktests' && typeof loadAndRenderStudentMockTests === 'function') {
        loadAndRenderStudentMockTests(shortKeyToPortalKey(norm));
    }
}

function setActiveNavLink(key) {
    document.querySelectorAll('.bpg-nav-link[data-nav]').forEach(link => {
        const isActive = link.getAttribute('data-nav') === key;
        link.classList.toggle('is-active', isActive);
        if (link.tagName === 'A') {
            if (isActive) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        }
    });
}

function scrollToSection(sectionId) {
    const el = document.getElementById(sectionId);
    if (!el) return;

    // If currently inside a class workspace, return to home view first
    const homeView = document.getElementById('view-home');
    if (homeView && homeView.style.display === 'none') {
        document.querySelectorAll('.portal-view, .view-container').forEach(v => {
            v.style.display = 'none';
            v.classList.remove('active');
        });
        homeView.style.display = 'block';
        homeView.classList.add('active');
    }

    closeClassesDropdown();
    closeUserDropdown();
    closeMobileNav();
    setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
}

/* --------------------------------------------------------------------------
   4. USER AVATAR PILL & AUTH STATE UPDATER
   -------------------------------------------------------------------------- */
function updateAuthUserPill() {
    const session = getStoredStudentSession();
    const signBtn = document.getElementById('headerGoogleBtn');
    const userWrap = document.getElementById('userDropdownWrap');
    const userPill = document.getElementById('headerUserPill');

    if (session && (session.name || session.email)) {
        document.body.classList.add('user-authenticated');
        if (signBtn) signBtn.style.display = 'none';
        if (userWrap) userWrap.style.display = 'inline-block';
        if (userPill) userPill.classList.add('visible');

        const name = session.name || 'Student';
        const role = session.grade || 'Class 12';
        const planLabel = formatPlanLabel(session.plan || 'free');

        const nameEl = document.getElementById('headerUserName');
        if (nameEl) nameEl.textContent = name;
        const roleEl = document.getElementById('headerUserRole');
        if (roleEl) roleEl.textContent = `${role} • ${planLabel}`;
        const avatarEl = document.getElementById('headerUserAvatar');
        if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();

        const dropFull = document.getElementById('dropdownFullName');
        if (dropFull) dropFull.textContent = `${name} (${role} · ${planLabel})`;
        const dropEmail = document.getElementById('dropdownEmail');
        if (dropEmail) dropEmail.textContent = session.email || 'student@bpgeducare.edu.np';

        const memIcon = document.getElementById('headerMembershipIcon');
        const memBtn = document.getElementById('headerMembershipBtn');
        const p = getStudentPlan();
        if (memIcon) {
            memIcon.className = p === 'diamond' ? 'fa-solid fa-gem' : (p === 'gold' ? 'fa-solid fa-crown' : 'fa-solid fa-crown');
        }
        if (memBtn) {
            memBtn.setAttribute('title', `Membership: ${planLabel}`);
            memBtn.classList.remove('tier-free', 'tier-gold', 'tier-diamond');
            memBtn.classList.add(`tier-${p}`);
        }
        populateStudentHomepage();
        updateHeroPrimaryCta();
    } else {
        document.body.classList.remove('user-authenticated');
        if (signBtn) signBtn.style.display = 'inline-flex';
        if (userWrap) userWrap.style.display = 'none';
        if (userPill) userPill.classList.remove('visible');
        const memBtn = document.getElementById('headerMembershipBtn');
        if (memBtn) {
            memBtn.setAttribute('title', 'Membership Plans');
            memBtn.classList.remove('tier-free', 'tier-gold', 'tier-diamond');
        }
        updateHeroPrimaryCta();
    }
}

function toggleUserDropdown(e) {
    if (e) e.stopPropagation();
    document.getElementById('userDropdownMenu')?.classList.toggle('open');
}

function closeUserDropdown() {
    document.getElementById('userDropdownMenu')?.classList.remove('open');
}

function handleSignOut() {
    handleSignOutSilent();
    showToast('Signed out of BPG EDUCARE');
}

/* --------------------------------------------------------------------------
   5. NAVIGATION DROPDOWNS & THEME TOGGLES
   -------------------------------------------------------------------------- */
function toggleClassesDropdown(e) {
    if (e) e.stopPropagation();
    const wrap = document.getElementById('navClassesWrap');
    const menu = document.getElementById('navClassesMenu');
    const btn = document.getElementById('navClassesBtn');
    if (!wrap && !menu) return;

    const isOpen = wrap ? wrap.classList.contains('open') : menu.classList.contains('show');
    if (isOpen) {
        closeClassesDropdown();
    } else {
        closeUserDropdown();
        if (wrap) wrap.classList.add('open');
        if (menu) menu.classList.add('show');
        if (btn) btn.setAttribute('aria-expanded', 'true');
    }
}

function closeClassesDropdown() {
    const wrap = document.getElementById('navClassesWrap');
    const menu = document.getElementById('navClassesMenu');
    const btn = document.getElementById('navClassesBtn');
    if (wrap) wrap.classList.remove('open');
    if (menu) menu.classList.remove('show');
    if (btn) btn.setAttribute('aria-expanded', 'false');
}

function initTheme() {
    const saved = localStorage.getItem('bpg_theme') === 'dark' ? 'dark' : 'light';
    applyTheme(saved);
}

function applyTheme(theme) {
    const resolved = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', resolved);
    document.body.setAttribute('data-theme', resolved);
    try { localStorage.setItem('bpg_theme', resolved); } catch (e) {}

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', resolved === 'dark' ? '#141416' : '#ffffff');

    const btn = document.getElementById('themeToggleBtn');
    if (btn) {
        btn.innerHTML = resolved === 'dark'
            ? '<i class="fa-solid fa-sun" aria-hidden="true"></i>'
            : '<i class="fa-solid fa-moon" aria-hidden="true"></i>';
        btn.setAttribute('title', resolved === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode');
        btn.setAttribute('aria-label', resolved === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode');
    }
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
}

function toggleMobileNav(e) {
    if (e) e.stopPropagation();
    const header = document.getElementById('siteHeader');
    const btn = document.getElementById('mobileMenuToggle');
    if (!header) return;
    const open = !header.classList.contains('nav-open');
    header.classList.toggle('nav-open', open);
    document.body.classList.toggle('bpg-nav-locked', open);
    if (btn) {
        btn.setAttribute('aria-expanded', String(open));
        btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }
}

function closeMobileNav() {
    const header = document.getElementById('siteHeader');
    if (!header || !header.classList.contains('nav-open')) return;
    header.classList.remove('nav-open');
    document.body.classList.remove('bpg-nav-locked');
    const btn = document.getElementById('mobileMenuToggle');
    if (btn) {
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', 'Open menu');
    }
}

function openWhatsAppInquiry(customText) {
    const num = '9779866064252';
    const msg = customText || 'Namaste BPG Sir, I have an academic inquiry regarding BPG EDUCARE.';
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
}

function downloadSampleIcs(sessionTitle, timeSummary) {
    const icsContent = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//BPG EDUCARE//Live Class Calendar//EN",
        "BEGIN:VEVENT",
        `SUMMARY:BPG Sir Live: ${sessionTitle}`,
        `DESCRIPTION:BPG EDUCARE live Zoom lecture with Bishnu Prasad Gautam (BPG Sir). ${timeSummary}`,
        "LOCATION:BPG EDUCARE Zoom Room",
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "END:VCALENDAR"
    ].join("\r\n");

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `BPG_Academy_${sessionTitle.replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Calendar Event (.ics) downloaded for "${sessionTitle}"!`);
}

document.addEventListener('click', e => {
    if (!e.target.closest('#primaryNav') && !e.target.closest('#mobileMenuToggle')) closeMobileNav();
    if (!e.target.closest('#userDropdownWrap')) closeUserDropdown();
    if (!e.target.closest('#navClassesWrap')) closeClassesDropdown();
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        closeMobileNav();
        closeClassesDropdown();
        closeUserDropdown();
        closeRestrictedAccessModal();
    }
});

window.addEventListener('resize', () => {
    if (window.innerWidth > 960) closeMobileNav();
});
