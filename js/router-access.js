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

function isMaintenanceModeActive() {
    return Boolean(typeof ACADEMY_STATE !== 'undefined' && ACADEMY_STATE?.maintenanceMode?.enabled);
}

function showMaintenanceLockNotice() {
    const msg = (typeof ACADEMY_STATE !== 'undefined' && ACADEMY_STATE?.maintenanceMode?.message)
        ? ACADEMY_STATE.maintenanceMode.message
        : 'BPG EDUCARE is currently under scheduled maintenance. Student functions are temporarily locked.';
    if (typeof showToast === 'function') showToast(msg);
    const banner = document.getElementById('maintenanceNoticeBanner');
    if (banner) {
        banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

function getConfiguredWhatsappNumber() {
    const raw = (typeof ACADEMY_STATE !== 'undefined' && ACADEMY_STATE?.siteSettings?.whatsappNumber)
        ? ACADEMY_STATE.siteSettings.whatsappNumber
        : '9779866064252';
    return String(raw).replace(/[^\d]/g, '') || '9779866064252';
}

function openConfiguredWhatsappSupport() {
    const num = getConfiguredWhatsappNumber();
    const msg = 'Namaste BPG Sir, I have an inquiry regarding BPG EDUCARE.';
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
}

function handleHeroPrimaryCta() {
    if (isMaintenanceModeActive()) {
        showMaintenanceLockNotice();
        return;
    }
    if (isUserAuthenticated()) {
        handleContinueToClass();
    } else {
        openAuthModal('signup');
    }
}

function handleHeroSecondaryCta() {
    const link = (typeof ACADEMY_STATE !== 'undefined' && ACADEMY_STATE?.homepageContent?.heroSecondaryBtnLink)
        ? String(ACADEMY_STATE.homepageContent.heroSecondaryBtnLink).trim()
        : '#ai';
    if (link === '#ai' || !link) {
        if (typeof toggleWebsiteGuide === 'function') toggleWebsiteGuide();
        return;
    }
    if (link.startsWith('http')) {
        window.open(link, '_blank', 'noopener');
    } else if (link.startsWith('#')) {
        const target = link.slice(1);
        if (['c10', 'c11', 'c12', 'entrance', 'classes'].includes(target)) {
            if (target === 'classes') openClassSelectionView();
            else handleClassNavClick(target);
        } else {
            scrollToSection(target);
        }
    }
}

function handleContinueToClass() {
    if (isMaintenanceModeActive()) {
        showMaintenanceLockNotice();
        return;
    }
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
    if (isMaintenanceModeActive()) {
        showMaintenanceLockNotice();
        return;
    }
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
    if (isMaintenanceModeActive()) {
        showMaintenanceLockNotice();
        return;
    }
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
    return !!(session && session.verified === true && session.email && (session.sessionToken || session.isFriendPass));
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

let selectedComparisonPlan = 'gold';

function updatePlanSelectionUI(planId) {
    const plans = typeof getPlansConfig === 'function' ? getPlansConfig() : {};
    const normalized = (planId === 'diamond' || planId === 'gold') ? planId : 'gold';
    selectedComparisonPlan = normalized;

    const grid = document.getElementById('planComparisonGrid');
    if (grid) {
        grid.querySelectorAll('.plan-compare-col[data-plan]').forEach(col => {
            const pid = col.getAttribute('data-plan');
            const isSelected = pid === normalized;
            const planName = plans[pid]?.name || pid;
            col.classList.toggle('is-selected', isSelected);
            col.setAttribute('aria-pressed', isSelected ? 'true' : 'false');

            const btn = col.querySelector('.plan-select-btn');
            if (btn) {
                btn.classList.toggle('is-selected', isSelected);
                btn.innerHTML = `<i class="fa-solid fa-bag-shopping"></i> Buy ${escapeHtml ? escapeHtml(planName) : planName}`;
            }
        });
    }

    const buyBtn = document.getElementById('planBuySelectedBtn');
    if (buyBtn) {
        const planName = plans[normalized]?.name || normalized;
        const planPrice = plans[normalized]?.price ? ` (${plans[normalized].price})` : '';
        buyBtn.textContent = `Buy ${planName}${planPrice}`;
    }
}

function selectComparisonPlan(planId) {
    updatePlanSelectionUI(planId);
}

function openPlanComparisonModal(requiredPlan = 'gold', itemTitle = '') {
    if (isMaintenanceModeActive()) {
        showMaintenanceLockNotice();
        return;
    }
    const modal = document.getElementById('planComparisonModal');
    const grid = document.getElementById('planComparisonGrid');
    const sub = document.getElementById('planComparisonSubtitle');
    if (!modal || !grid) return;

    const plans = typeof getPlansConfig === 'function' ? getPlansConfig() : {};
    const currentPlan = getStudentPlan();
    const reqNorm = String(requiredPlan || '').toLowerCase();
    const targetPlan = (reqNorm === 'gold' || reqNorm === 'diamond')
        ? reqNorm
        : (currentPlan === 'gold' ? 'diamond' : 'gold');

    const goldName = plans.gold?.name || 'Padandas';
    const diamondName = plans.diamond?.name || 'Topper';

    if (sub) {
        sub.innerHTML = itemTitle
            ? `Unlock <strong>${escapeHtml ? escapeHtml(itemTitle) : itemTitle}</strong> by upgrading to <strong>${formatPlanLabel(targetPlan)}</strong> or higher.`
            : `Hover and choose between <strong>${escapeHtml ? escapeHtml(goldName) : goldName}</strong> and <strong>${escapeHtml ? escapeHtml(diamondName) : diamondName}</strong> across all open sections.`;
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

    const tiers = ['gold', 'diamond'];
    grid.innerHTML = tiers.map(pid => {
        const cfg = plans[pid] || { name: pid, price: 'Rs. 0', period: '', description: '' };
        const isHighlighted = Boolean(reqNorm) && pid === targetPlan;
        const isSelected = pid === targetPlan;
        const isCurrent = pid === currentPlan && isUserAuthenticated();
        const c = counts[pid];
        const safeName = escapeHtml ? escapeHtml(cfg.name) : cfg.name;
        return `
            <div class="plan-compare-col ${isHighlighted ? 'is-recommended' : ''} ${isSelected ? 'is-selected' : ''}"
                 data-plan="${pid}"
                 role="button"
                 tabindex="0"
                 aria-pressed="${isSelected ? 'true' : 'false'}"
                 onclick="selectComparisonPlan('${pid}')"
                 onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectComparisonPlan('${pid}');}">
                <div class="plan-compare-head">
                    <span class="plan-tier-name">${safeName}</span>
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
                    <li>${pid === 'diamond' ? 'Full access to all open section lessons, mock tests &amp; live classes' : 'Gold lessons, mock tests, study PDFs &amp; live classes'}</li>
                </ul>
                <button type="button" class="plan-select-btn ${isSelected ? 'is-selected' : ''}" onclick="event.stopPropagation(); openCheckoutModal('${pid}')">
                    <i class="fa-solid fa-bag-shopping"></i> Buy ${safeName}
                </button>
            </div>
        `;
    }).join('');

    updatePlanSelectionUI(targetPlan);
    modal.classList.add('open');
}

function closePlanComparisonModal() {
    document.getElementById('planComparisonModal')?.classList.remove('open');
}

/* --------------------------------------------------------------------------
   1B. SIGNED-IN ESEWA + WHATSAPP CHECKOUT FLOW
   -------------------------------------------------------------------------- */
let activeCheckoutPlanId = 'gold';

function buildPaymentRemarksText(session, planName) {
    const fullName = session?.name || 'Student';
    const className = session?.grade || getClassDisplayTitle(getStudentRegisteredClass());
    const email = session?.email || '';
    const username = session?.username || (email.includes('@') ? email.split('@')[0] : 'student');
    return `Name: ${fullName} | Class: ${className} | Username: ${username} | Gmail: ${email} | Plan: ${planName}`;
}

function openCheckoutModal(planId = 'gold') {
    if (isMaintenanceModeActive()) {
        showMaintenanceLockNotice();
        return;
    }
    const normalized = (planId === 'diamond' || planId === 'gold') ? planId : 'gold';
    if (!isUserAuthenticated()) {
        window.pendingCheckoutPlan = normalized;
        closePlanComparisonModal();
        openAuthModal('signin');
        showToast('Please sign in first to purchase a plan.');
        return;
    }

    activeCheckoutPlanId = normalized;
    closePlanComparisonModal();

    const plans = typeof getPlansConfig === 'function' ? getPlansConfig() : {};
    const cfg = plans[normalized] || { name: normalized, price: '' };
    const session = getStoredStudentSession();

    const titleEl = document.getElementById('checkoutPlanTitle');
    if (titleEl) titleEl.textContent = `Buy ${cfg.name} Plan`;
    const priceEl = document.getElementById('checkoutPlanPriceLine');
    if (priceEl) priceEl.textContent = `Amount: ${cfg.price || '—'}${cfg.period ? ` · ${cfg.period}` : ''}`;

    const qrImg = document.getElementById('checkoutEsewaQrImg');
    const rawQrUrl = (typeof ACADEMY_STATE !== 'undefined' && ACADEMY_STATE?.siteSettings?.esewaQrUrl)
        ? ACADEMY_STATE.siteSettings.esewaQrUrl
        : 'images/payment_qr.png';
    const qrUrl = rawQrUrl.includes('payment_qr.png') && !rawQrUrl.includes('?')
        ? `${rawQrUrl}?v=20261123`
        : rawQrUrl;
    if (qrImg) {
        qrImg.src = qrUrl;
        qrImg.style.display = 'block';
    }

    const remarksEl = document.getElementById('checkoutRemarksPreview');
    if (remarksEl) {
        remarksEl.textContent = buildPaymentRemarksText(session, cfg.name);
    }

    const txnInput = document.getElementById('checkoutTransactionId');
    if (txnInput) txnInput.value = '';

    const statusBanner = document.getElementById('checkoutStatusBanner');
    if (statusBanner) statusBanner.style.display = 'none';

    document.getElementById('checkoutModal')?.classList.add('open');
}

function closeCheckoutModal() {
    document.getElementById('checkoutModal')?.classList.remove('open');
}

async function copyPaymentRemarks() {
    const remarksEl = document.getElementById('checkoutRemarksPreview');
    const text = remarksEl ? remarksEl.textContent : '';
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
        showToast('Payment remarks copied to clipboard.');
    } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); showToast('Payment remarks copied.'); } catch (e2) {}
        ta.remove();
    }
}

async function submitStaticEsewaPayment() {
    if (isMaintenanceModeActive()) {
        showMaintenanceLockNotice();
        return;
    }
    const session = getStoredStudentSession();
    if (!session || !session.email) {
        openAuthModal('signin');
        return;
    }

    const plans = typeof getPlansConfig === 'function' ? getPlansConfig() : {};
    const cfg = plans[activeCheckoutPlanId] || { name: activeCheckoutPlanId, price: '' };
    const transactionId = (document.getElementById('checkoutTransactionId')?.value || '').trim();
    const btn = document.getElementById('btnCheckoutWhatsappConfirm');
    const statusBanner = document.getElementById('checkoutStatusBanner');

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving pending purchase...';
    }

    try {
        const authHeaders = typeof getStudentAuthHeaders === 'function' ? getStudentAuthHeaders() : {};
        const res = await fetch('/api/payments', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders),
            body: JSON.stringify({
                action: 'CREATE_PAYMENT',
                planId: activeCheckoutPlanId,
                planName: cfg.name,
                amount: cfg.price,
                transactionId
            })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Could not record payment.');
        }

        if (statusBanner) {
            statusBanner.style.display = 'block';
            statusBanner.innerHTML = `<p style="margin:0;"><strong>Purchase saved as Pending.</strong> Opening WhatsApp with your prefilled confirmation message. Your plan will activate once an admin verifies your payment.</p>`;
        }

        if (data.whatsappUrl) {
            window.open(data.whatsappUrl, '_blank', 'noopener');
        }
        showToast('Purchase submitted as pending. Please send the WhatsApp message to confirm.');
    } catch (err) {
        showToast(err.message || 'Could not submit payment.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-brands fa-whatsapp"></i> I&rsquo;ve Paid &mdash; Continue to WhatsApp';
        }
    }
}

async function handleGatewayPaymentReturn() {
    try {
        const params = new URLSearchParams(window.location.search);
        const gatewayVerified = params.get('payment_verified') === '1';
        const planId = params.get('plan');
        const transactionId = params.get('txn_id') || params.get('refId') || '';
        if (!gatewayVerified || !planId || !transactionId || !isUserAuthenticated()) return;

        const authHeaders = typeof getStudentAuthHeaders === 'function' ? getStudentAuthHeaders() : {};
        const res = await fetch('/api/payments', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders),
            body: JSON.stringify({
                action: 'VERIFY_GATEWAY_PAYMENT',
                gatewayVerified: true,
                planId,
                transactionId
            })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
            if (data.user && data.sessionToken) {
                const session = getStoredStudentSession() || {};
                session.plan = data.user.plan;
                session.sessionToken = data.sessionToken;
                localStorage.setItem(BPG_STUDENT_SESSION_KEY, JSON.stringify(session));
                localStorage.setItem('bpg_student_session', JSON.stringify(session));
                updateAuthUserPill();
            }
            if (data.whatsappUrl) {
                window.open(data.whatsappUrl, '_blank', 'noopener');
            }
            showToast('Payment verified! Opening WhatsApp confirmation.');
        }
    } catch (e) {}
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
    if (isMaintenanceModeActive()) {
        showMaintenanceLockNotice();
        return;
    }
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
    if (isMaintenanceModeActive()) {
        showMaintenanceLockNotice();
        return;
    }
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

let pendingSwitchRequestedClass = '';

function showRestrictedAccessModal(targetClassKey) {
    const myClass = getStudentRegisteredClass();
    const targetNorm = normalizeClassKey(targetClassKey);
    pendingSwitchRequestedClass = shortKeyToPortalKey(targetNorm);
    const myTitle = getClassDisplayTitle(myClass);
    const reqTitle = getClassDisplayTitle(targetNorm);

    const modal = document.getElementById('restrictedAccessModal');
    const msgEl = document.getElementById('restrictedAccessMessage');
    if (msgEl) {
        msgEl.innerHTML = `Your account can only have <strong>one active class at a time</strong>. Switching to <strong>${reqTitle}</strong> will end your access to <strong>${myTitle}</strong> once approved by an admin.`;
    }
    const curEl = document.getElementById('switchCurrentClassLabel');
    if (curEl) curEl.textContent = myTitle;
    const reqEl = document.getElementById('switchRequestedClassLabel');
    if (reqEl) reqEl.textContent = reqTitle;

    const reasonInput = document.getElementById('switchRequestReason');
    if (reasonInput) reasonInput.value = '';

    const statusBox = document.getElementById('switchRequestStatusBox');
    const submitBtn = document.getElementById('btnSubmitClassSwitch');
    const myReqs = Array.isArray(window.MY_CLASS_SWITCH_REQUESTS) ? window.MY_CLASS_SWITCH_REQUESTS : [];
    const existingPending = myReqs.find(r => r.status === 'pending' && r.requestedClassKey === pendingSwitchRequestedClass);
    const latestReq = myReqs[0];

    if (statusBox) {
        if (existingPending) {
            statusBox.style.display = 'block';
            statusBox.innerHTML = `<p style="margin:0;"><strong>Pending Request:</strong> You already requested a switch to ${reqTitle} on ${new Date(existingPending.submittedAt).toLocaleDateString()}.</p>`;
            if (submitBtn) submitBtn.disabled = true;
        } else if (latestReq && latestReq.status === 'rejected' && latestReq.requestedClassKey === pendingSwitchRequestedClass) {
            statusBox.style.display = 'block';
            statusBox.innerHTML = `<p style="margin:0;"><strong>Previous Request Rejected:</strong> ${escapeHtml ? escapeHtml(latestReq.adminNote || 'No note provided') : (latestReq.adminNote || 'No note provided')}</p>`;
            if (submitBtn) submitBtn.disabled = false;
        } else {
            statusBox.style.display = 'none';
            if (submitBtn) submitBtn.disabled = false;
        }
    }

    if (modal) modal.classList.add('open');
}

function closeRestrictedAccessModal() {
    document.getElementById('restrictedAccessModal')?.classList.remove('open');
}

async function submitClassSwitchRequest() {
    if (isMaintenanceModeActive()) {
        showMaintenanceLockNotice();
        return;
    }
    if (!isUserAuthenticated()) {
        openAuthModal('signin');
        return;
    }
    const btn = document.getElementById('btnSubmitClassSwitch');
    const reason = (document.getElementById('switchRequestReason')?.value || '').trim();
    const statusBox = document.getElementById('switchRequestStatusBox');

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Submitting...';
    }

    try {
        const authHeaders = typeof getStudentAuthHeaders === 'function' ? getStudentAuthHeaders() : {};
        const res = await fetch('/api/student-roster', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders),
            body: JSON.stringify({
                action: 'REQUEST_CLASS_SWITCH',
                requestedClass: pendingSwitchRequestedClass,
                reason
            })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.error || 'Could not submit class switch request.');
        }

        if (data.request) {
            window.MY_CLASS_SWITCH_REQUESTS = [data.request, ...(window.MY_CLASS_SWITCH_REQUESTS || [])];
        }
        if (statusBox) {
            statusBox.style.display = 'block';
            statusBox.innerHTML = `<p style="margin:0;"><strong>Request Submitted:</strong> Pending admin approval. You will keep access to your current class until approved.</p>`;
        }
        showToast(data.message || 'Class switch request submitted.');
    } catch (err) {
        if (btn) btn.disabled = false;
        showToast(err.message || 'Could not submit request.');
    } finally {
        if (btn) {
            btn.textContent = 'Confirm & Submit Switch Request';
        }
    }
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

    // MAINTENANCE MODE GUARD: Only public homepage is visible; all other views/direct links are locked
    if (isMaintenanceModeActive() && targetId !== 'view-home') {
        showMaintenanceLockNotice();
        targetId = 'view-home';
    }

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
    const loginBtn = document.getElementById('headerLoginBtn');
    const userWrap = document.getElementById('userDropdownWrap');
    const userPill = document.getElementById('headerUserPill');

    if (isUserAuthenticated() && session && (session.name || session.email)) {
        document.body.classList.add('user-authenticated');
        if (signBtn) signBtn.style.display = 'none';
        if (loginBtn) loginBtn.style.display = 'none';
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
        if (loginBtn) loginBtn.style.display = 'inline-flex';
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
