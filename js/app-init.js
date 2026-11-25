/* ==========================================================================
   BPG ACADEMY — APPLICATION INITIALIZER & REAL-TIME SYNC (js/app-init.js)
   Strict Single-Class Dedicated Architecture
   ========================================================================== */

async function syncRosterPermissionsFromServer() {
    try {
        const authHeaders = typeof getStudentAuthHeaders === 'function' ? getStudentAuthHeaders() : {};
        const session = typeof getStoredStudentSession === 'function' ? getStoredStudentSession() : null;

        if (!session || !session.sessionToken) {
            return;
        }

        const meRes = await fetch('/api/student-roster?me=1&_t=' + Date.now(), {
            cache: 'no-store',
            headers: authHeaders
        });
        if (meRes.status === 401) {
            if (typeof handleSignOutSilent === 'function') handleSignOutSilent();
            return;
        }
        if (meRes.ok) {
            const meJson = await meRes.json();
            if (meJson.sessionRevoked === true) {
                if (typeof handleSignOutSilent === 'function') handleSignOutSilent();
                return;
            }
            if (Array.isArray(meJson.mySwitchRequests)) {
                window.MY_CLASS_SWITCH_REQUESTS = meJson.mySwitchRequests;
            }
            if (Array.isArray(meJson.myPayments)) {
                window.MY_PAYMENTS = meJson.myPayments;
            }
            if (meJson.account) {
                const match = meJson.account;
                const gradeChanged = match.grade && match.grade !== session.grade;
                const planChanged = match.plan && match.plan !== session.plan;
                const legacyChanged = Boolean(match.legacyAccess) !== Boolean(session.legacyAccess);

                if (gradeChanged || planChanged || legacyChanged) {
                    session.grade = match.grade || session.grade;
                    session.classKey = normalizeClassKey(session.grade);
                    session.plan = match.plan || 'free';
                    session.legacyAccess = Boolean(match.legacyAccess);
                    session.planExplicitlySet = Boolean(match.planExplicitlySet);
                    localStorage.setItem(BPG_STUDENT_SESSION_KEY, JSON.stringify(session));
                    localStorage.setItem('bpg_student_session', JSON.stringify(session));
                    localStorage.setItem('bpg_student_class', session.classKey);
                    updateAuthUserPill();
                    syncWithServerDatabase();
                    if (gradeChanged) openMyClassWorkspace();
                }
            }
        }
    } catch (e) {}
}

function refreshStudentPortalUI() {
    updateAuthUserPill();
    if (typeof syncGoogleOAuthButtonsVisibility === 'function') {
        syncGoogleOAuthButtonsVisibility();
    }
    if (typeof renderEntireStudentPortal === 'function') {
        renderEntireStudentPortal();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (!document.getElementById('view-about') && !document.getElementById('view-home')) return;

    initTheme();

    // 1-Person Friend / Guest Preview Link Handler (?pass=friend)
    try {
        const urlParams = new URLSearchParams(window.location.search);
        const friendToken = urlParams.get('pass') || urlParams.get('access') || urlParams.get('friend') || urlParams.get('token');
        if (friendToken) {
            const guestName = urlParams.get('name') || 'Guest Scholar';
            const guestGrade = urlParams.get('class') || 'Class 12';
            const normKey = normalizeClassKey(guestGrade);
            const friendAccount = {
                name: guestName,
                email: 'scholar@bpgacademy.edu.np',
                grade: guestGrade,
                classKey: normKey,
                isFriendPass: true,
                verified: true
            };
            localStorage.setItem(BPG_STUDENT_SESSION_KEY, JSON.stringify(friendAccount));
            localStorage.setItem('bpg_student_session', JSON.stringify(friendAccount));
            localStorage.setItem('bpg_student_class', normKey);
        }
    } catch (e) {}

    // Initial Render of AI Assistant on Homepage
    setTimeout(() => {
        if (document.getElementById('aiChatViewport') && typeof triggerAiConceptPrompt === 'function') {
            triggerAiConceptPrompt('lhopital', null);
        }
    }, 150);

    // 6-digit OTP box paste support
    document.getElementById('otpBoxesWrap')?.addEventListener('paste', e => {
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
        if (pasted.length > 0) {
            e.preventDefault();
            for (let i = 0; i < 6; i++) {
                const box = document.getElementById(`otpDigit${i}`);
                if (box) box.value = pasted[i] || '';
            }
            document.getElementById(`otpDigit${Math.min(5, pasted.length - 1)}`)?.focus();
        }
    });

    // Render all 4 class workspaces and homepage cards from master state
    if (typeof syncSectionLockBadges === 'function') syncSectionLockBadges();
    renderEntireStudentPortal();
    updateAuthUserPill();
    if (typeof renderHeaderNotificationsBell === 'function') renderHeaderNotificationsBell();
    if (typeof initDraggableCalculator === 'function') initDraggableCalculator();
    if (typeof initScrollRevealAnimations === 'function') initScrollRevealAnimations();
    if (typeof initRoamingWidgets === 'function') initRoamingWidgets();

    // Boot & Refresh routing: keep signed-in session active across Home, navigation, and page refreshes
    const hash = (window.location.hash || '').replace('#', '').toLowerCase();
    if (isUserAuthenticated()) {
        if (typeof checkAndResumeActiveMockTestOnBoot === 'function' && localStorage.getItem('bpg_active_mock_attempt_v1')) {
            checkAndResumeActiveMockTestOnBoot();
        } else if (['entrance', 'c10', 'c11', 'c12'].includes(hash)) {
            handleClassNavClick(hash);
        } else if (hash === 'classes') {
            openClassSelectionView();
        } else {
            handleHomeClick();
        }
    } else {
        setActiveNavLink('home');
        if (['entrance', 'c10', 'c11', 'c12'].includes(hash)) handleClassNavClick(hash);
        else switchPortal('view-home');
    }

    // Real-Time BroadcastChannel & Central Database Sync Listener
    try {
        if ('BroadcastChannel' in window) {
            const handleIncomingSyncMessage = (ev) => {
                if (!ev.data) return;
                if (ev.data.type === 'DATA_UPDATED' || ev.data.type === 'BPG_CMS_SYNC' || ev.data.type === 'CMS_UPDATE') {
                    if (ev.data.state && typeof applyIncomingAdminState === 'function') {
                        applyIncomingAdminState(ev.data.state);
                    } else {
                        syncWithServerDatabase(false);
                    }
                    updateAuthUserPill();
                    showToastNotification('Website updated with latest academic data.');
                } else if (ev.data.type === 'PERMISSIONS_UPDATE' || ev.data.type === 'PAYMENT_UPDATED' || ev.data.type === 'STUDENT_ROSTER_UPDATED') {
                    syncWithServerDatabase(true);
                    updateAuthUserPill();
                }
            };

            const primarySyncCh = new BroadcastChannel('bpg_academy_sync');
            primarySyncCh.onmessage = handleIncomingSyncMessage;

            const legacySyncCh = new BroadcastChannel(BPG_SYNC_CHANNEL_NAME);
            legacySyncCh.addEventListener('message', handleIncomingSyncMessage);
        }
    } catch (e) {}

    window.addEventListener('storage', ev => {
        if ((ev.key === 'bpg_master_db' || ev.key === 'bpg_master_database_v1' || ev.key === BPG_STORAGE_KEY) && ev.newValue) {
            try {
                const parsed = JSON.parse(ev.newValue);
                applyIncomingAdminState(parsed);
                showToastNotification('Website updated with latest academic data.');
            } catch (err) {}
        } else if ((ev.key === BPG_ACCOUNTS_KEY || ev.key === 'bpg_live_mutation_ping') && ev.newValue) {
            syncWithServerDatabase(true);
            updateAuthUserPill();
        }
    });

    // Initial Unified Database, Member Profile & Payment Hydration on Load
    syncWithServerDatabase(false).then(() => {
        if (typeof renderHeaderNotificationsBell === 'function') renderHeaderNotificationsBell();
        if (typeof handleGatewayPaymentReturn === 'function') {
            handleGatewayPaymentReturn();
        }
    });

    // Cache Invalidation: Re-fetch immediately on tab focus
    window.addEventListener('focus', () => {
        syncWithServerDatabase(true);
    });

    // Real-Time 1.5-Second Lightweight Background Poll for 1-2s Two-Way Sync
    setInterval(() => {
        if (document.visibilityState === 'hidden') return;
        syncWithServerDatabase(true);
    }, 1500);
});

// Global API & Window Interop Bindings
window.handleSendOtpRequest = handleRequestEmailOtp;
window.handleVerifyOtpCode = handleVerifyEmailOtp;
window.handleResendOtp = resendEmailOtpCode;
window.toggleCalculatorWidget = toggleMiniCalculator;
window.switchPortal = switchPortal;
window.handleHomeClick = handleHomeClick;
window.handleHeroPrimaryCta = handleHeroPrimaryCta;
window.handleContinueToClass = handleContinueToClass;
window.openClassSelectionView = openClassSelectionView;
window.openLiveClassCalendarEntry = openLiveClassCalendarEntry;
window.closeCalendarSessionModal = closeCalendarSessionModal;
window.openStudentHomepage = openStudentHomepage;
window.openMyLessonsView = openMyLessonsView;
window.openMyMockTestsView = openMyMockTestsView;
window.openMySyllabusView = openMySyllabusView;
window.openMyCalendarView = openMyCalendarView;
window.openLessonPdf = openLessonPdf;
window.openLessonVideo = openLessonVideo;
window.closeVideoPlayerModal = closeVideoPlayerModal;
window.openNotesLesson = openNotesLesson;
window.backToNotesLessonList = backToNotesLessonList;
window.selectSubjectForClass = selectSubjectForClass;
window.handleClassNavClick = handleClassNavClick;
window.handleProgramCardClick = handleProgramCardClick;
window.showRestrictedAccessModal = showRestrictedAccessModal;
window.closeRestrictedAccessModal = closeRestrictedAccessModal;
window.showSectionLockedModal = showSectionLockedModal;
window.closeSectionLockedModal = closeSectionLockedModal;
window.openPlanComparisonModal = openPlanComparisonModal;
window.selectComparisonPlan = selectComparisonPlan;
window.closePlanComparisonModal = closePlanComparisonModal;
window.syncSectionLockBadges = syncSectionLockBadges;
window.handleRequestPasswordResetOtp = handleRequestPasswordResetOtp;
window.switchToSignInWithEmail = switchToSignInWithEmail;
window.switchToResetWithEmail = switchToResetWithEmail;
window.handleSwitchAccountRegister = handleSwitchAccountRegister;
window.initTheme = initTheme;
window.applyTheme = applyTheme;
window.toggleTheme = toggleTheme;
window.scrollToSection = scrollToSection;
window.handleSignOut = handleSignOut;
window.toggleMobileNav = toggleMobileNav;
window.closeMobileNav = closeMobileNav;
window.updateAuthUserPill = updateAuthUserPill;
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.switchAuthTab = switchAuthTab;
window.handleSignInSubmit = handleSignInSubmit;
window.quickOtpSignIn = quickOtpSignIn;
window.toggleWebsiteGuide = toggleWebsiteGuide;
window.closeWebsiteGuide = closeWebsiteGuide;
window.askGuideQuestion = askGuideQuestion;
window.openAiWithPrompt = openAiWithPrompt;
window.handleAiQuerySubmit = handleAiQuerySubmit;
window.submitAiPromptText = submitAiPromptText;
window.clearAiChat = clearAiChat;
window.initRoamingWidgets = initRoamingWidgets;
window.refreshStudentPortalUI = refreshStudentPortalUI;
window.syncRosterPermissionsFromServer = syncRosterPermissionsFromServer;
window.handleGoogleAuthClick = handleGoogleAuthClick;
window.handleLocalGoogleSubmit = handleLocalGoogleSubmit;
window.openCheckoutModal = openCheckoutModal;
window.closeCheckoutModal = closeCheckoutModal;
window.copyPaymentRemarks = copyPaymentRemarks;
window.submitStaticEsewaPayment = submitStaticEsewaPayment;
window.submitClassSwitchRequest = submitClassSwitchRequest;
window.handleHeroSecondaryCta = handleHeroSecondaryCta;
window.openConfiguredWhatsappSupport = openConfiguredWhatsappSupport;
window.setCalculatorMode = setCalculatorMode;
window.toggleMiniCalcAngle = toggleMiniCalcAngle;
window.toggleMiniCalcHistory = toggleMiniCalcHistory;
window.reuseMiniCalcHistory = reuseMiniCalcHistory;
window.clearMiniCalcHistory = clearMiniCalcHistory;
window.calcUseLastAns = calcUseLastAns;
window.openStudentProfileModal = openStudentProfileModal;
window.closeStudentProfileModal = closeStudentProfileModal;
window.handleStudentProfileSave = handleStudentProfileSave;
window.renderStudentDashboardPaymentBanner = renderStudentDashboardPaymentBanner;
