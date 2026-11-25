/* BPG Academy — Gmail-Unique Auth, Password Reset & OTP Engine (js/auth-otp.js) */

var BPG_ACCOUNTS_KEY = window.BPG_ACCOUNTS_KEY || 'bpg_maths_academy_accounts_v2';
const BPG_REMEMBERED_EMAIL_KEY = 'bpg_remembered_email_v1';
let authRequestInFlight = false;

function togglePasswordVisibility(inputId, btnEl) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    if (btnEl) {
        btnEl.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
        btnEl.setAttribute('title', isHidden ? 'Hide password' : 'Show password');
        btnEl.innerHTML = isHidden
            ? '<i class="fa-regular fa-eye-slash" aria-hidden="true"></i>'
            : '<i class="fa-regular fa-eye" aria-hidden="true"></i>';
    }
}

function updatePasswordRequirementsUI(val, listId = 'signupPwdReqs') {
    const list = document.getElementById(listId);
    if (!list) return;
    const s = String(val || '');
    const checks = {
        len: s.length >= 6,
        mix: /[A-Za-z]/.test(s) && /\d/.test(s)
    };
    list.querySelectorAll('li[data-req]').forEach(li => {
        const key = li.getAttribute('data-req');
        const ok = Boolean(checks[key]);
        li.classList.toggle('is-met', ok);
        const icon = li.querySelector('i');
        if (icon) icon.className = ok ? 'fa-solid fa-circle-check' : 'fa-regular fa-circle';
    });
}

function loadRememberedEmailUI() {
    let remembered = '';
    try { remembered = String(localStorage.getItem(BPG_REMEMBERED_EMAIL_KEY) || '').trim(); } catch (e) {}
    const banner = document.getElementById('rememberedAccountBanner');
    const emailTxt = document.getElementById('rememberedAccountEmailText');
    const initialEl = document.getElementById('rememberedAccountInitial');
    const emailInput = document.getElementById('signinEmail');
    const remChk = document.getElementById('signinRememberEmail');

    if (remembered) {
        if (banner) banner.style.display = 'flex';
        if (emailTxt) emailTxt.textContent = remembered;
        if (initialEl) initialEl.textContent = remembered.charAt(0).toUpperCase();
        if (emailInput && !emailInput.value) emailInput.value = remembered;
        if (remChk) remChk.checked = true;
    } else {
        if (banner) banner.style.display = 'none';
        if (remChk) remChk.checked = false;
    }
}

function useAnotherAccount() {
    const emailInput = document.getElementById('signinEmail');
    const pwdInput = document.getElementById('signinPassword');
    const banner = document.getElementById('rememberedAccountBanner');
    if (banner) banner.style.display = 'none';
    if (emailInput) { emailInput.value = ''; emailInput.focus(); }
    if (pwdInput) pwdInput.value = '';
}

function clearRememberedEmail() {
    try { localStorage.removeItem(BPG_REMEMBERED_EMAIL_KEY); } catch (e) {}
    const remChk = document.getElementById('signinRememberEmail');
    if (remChk) remChk.checked = false;
    useAnotherAccount();
    showToast('Remembered email cleared from this device.');
}

function openForgotPasswordFromSignIn() {
    const email = (document.getElementById('signinEmail')?.value || '').trim();
    switchAuthTab('reset');
    const resetInput = document.getElementById('resetEmail');
    if (resetInput && email) {
        resetInput.value = email;
        document.getElementById('resetNewPassword')?.focus();
    } else {
        resetInput?.focus();
    }
}

let pendingOtpSession = {
    name: '',
    email: '',
    grade: 'Class 12',
    password: '',
    mode: 'signup',
    otpToken: '',
    demoOtp: ''
};

let lastDuplicateEmailAttempt = '';

function openAuthModal(initialTab = 'signin', targetClass = null) {
    if (typeof isMaintenanceModeActive === 'function' && isMaintenanceModeActive()) {
        if (typeof showMaintenanceLockNotice === 'function') showMaintenanceLockNotice();
        return;
    }
    const modal = document.getElementById('authModal');
    if (!modal) return;

    if (typeof syncSectionLockBadges === 'function') syncSectionLockBadges();
    syncGoogleOAuthButtonsVisibility();

    if (targetClass) {
        pendingTargetClass = normalizeClassKey(targetClass);
        const gradeSelect = document.getElementById('signupGrade');
        if (gradeSelect) {
            if (pendingTargetClass === 'c10' && !isSectionLocked('class-10')) gradeSelect.value = 'Class 10';
            else if (pendingTargetClass === 'c11' && !isSectionLocked('class-11')) gradeSelect.value = 'Class 11';
            else if (pendingTargetClass === 'entrance' && !isSectionLocked('after-12')) gradeSelect.value = 'After 12';
            else if (!isSectionLocked('class-12')) gradeSelect.value = 'Class 12';
            else gradeSelect.value = 'Class 11';
        }
    }

    clearAuthInlineAlerts();
    loadRememberedEmailUI();
    switchAuthTab(initialTab);
    modal.classList.add('open');
}

function closeAuthModal() {
    document.getElementById('authModal')?.classList.remove('open');
}

let otpExpiryInterval = null;
let otpResendInterval = null;
let otpResendRemaining = 0;

function clearOtpTimers() {
    if (otpExpiryInterval) {
        clearInterval(otpExpiryInterval);
        otpExpiryInterval = null;
    }
    if (otpResendInterval) {
        clearInterval(otpResendInterval);
        otpResendInterval = null;
    }
}

function startOtpExpiryTimer(expiresAt) {
    if (otpExpiryInterval) clearInterval(otpExpiryInterval);
    const timerEl = document.getElementById('otpExpiryTimer');
    const verifyBtn = document.getElementById('btnVerifyOtpSubmit');
    const errBanner = document.getElementById('otpVerifyErrorBanner');

    const update = () => {
        const remainingMs = Math.max(0, Number(expiresAt) - Date.now());
        const totalSec = Math.ceil(remainingMs / 1000);
        const mins = String(Math.floor(totalSec / 60)).padStart(2, '0');
        const secs = String(totalSec % 60).padStart(2, '0');
        if (timerEl) {
            timerEl.textContent = totalSec > 0 ? `Expires in ${mins}:${secs}` : 'Code expired';
            timerEl.style.color = totalSec <= 60 ? '#dc2626' : 'var(--accent-primary, #4f46e5)';
        }
        if (totalSec <= 0) {
            clearInterval(otpExpiryInterval);
            otpExpiryInterval = null;
            if (verifyBtn) verifyBtn.disabled = true;
            if (errBanner) {
                errBanner.innerHTML = '<p style="margin:0;">Verification code expired after 5 minutes. Please click <strong>Resend Verification Code</strong>.</p>';
                errBanner.style.display = 'block';
            }
        } else if (verifyBtn) {
            verifyBtn.disabled = false;
        }
    };
    update();
    otpExpiryInterval = setInterval(update, 1000);
}

function startResendCooldown(seconds = 30) {
    if (otpResendInterval) clearInterval(otpResendInterval);
    otpResendRemaining = Math.max(0, Math.ceil(Number(seconds) || 30));
    const resendBtn = document.getElementById('btnResendOtp');

    const update = () => {
        if (!resendBtn) return;
        if (otpResendRemaining > 0) {
            resendBtn.disabled = true;
            resendBtn.textContent = `Resend Verification Code (${otpResendRemaining}s)`;
            otpResendRemaining -= 1;
        } else {
            resendBtn.disabled = false;
            resendBtn.textContent = 'Resend Verification Code';
            clearInterval(otpResendInterval);
            otpResendInterval = null;
        }
    };
    update();
    if (otpResendRemaining > 0) {
        otpResendInterval = setInterval(update, 1000);
    }
}

function clearAuthInlineAlerts() {
    const dup = document.getElementById('signupDuplicateBanner');
    if (dup) dup.style.display = 'none';
    const siErr = document.getElementById('signinErrorBanner');
    if (siErr) siErr.style.display = 'none';
    const rsErr = document.getElementById('resetErrorBanner');
    if (rsErr) rsErr.style.display = 'none';
    const otpErr = document.getElementById('otpVerifyErrorBanner');
    if (otpErr) otpErr.style.display = 'none';
    const gErr = document.getElementById('googleChooserErrorBanner');
    if (gErr) gErr.style.display = 'none';
}

function switchAuthTab(tab) {
    const signInPane = document.getElementById('authSignInContainer');
    const step1Pane = document.getElementById('otpStep1Container');
    const googlePane = document.getElementById('googleLocalChooserContainer');
    const resetPane = document.getElementById('authResetContainer');
    const step2Pane = document.getElementById('otpStep2Container');
    const tabSignIn = document.getElementById('authTabSignIn');
    const tabSignUp = document.getElementById('authTabSignUp');

    clearAuthInlineAlerts();

    if (signInPane) signInPane.style.display = tab === 'signin' ? 'block' : 'none';
    if (step1Pane) step1Pane.style.display = tab === 'signup' ? 'block' : 'none';
    if (googlePane) googlePane.style.display = tab === 'google' ? 'block' : 'none';
    if (resetPane) resetPane.style.display = tab === 'reset' ? 'block' : 'none';
    if (step2Pane) step2Pane.style.display = 'none';

    if (tabSignIn) {
        tabSignIn.classList.toggle('active', tab === 'signin' || tab === 'reset' || tab === 'google');
        tabSignIn.setAttribute('aria-selected', String(tab === 'signin'));
    }
    if (tabSignUp) {
        tabSignUp.classList.toggle('active', tab === 'signup');
        tabSignUp.setAttribute('aria-selected', String(tab === 'signup'));
    }
}

let googleAuthOriginMode = 'signin';

function getConfiguredGoogleClientId() {
    if (typeof ACADEMY_STATE !== 'undefined' && ACADEMY_STATE?.siteSettings?.googleClientId) {
        return String(ACADEMY_STATE.siteSettings.googleClientId).trim();
    }
    return '';
}

function syncGoogleOAuthButtonsVisibility() {
    const signInWrap = document.getElementById('googleOAuthSignInWrap');
    const signUpWrap = document.getElementById('googleOAuthSignUpWrap');
    if (signInWrap) signInWrap.style.display = 'block';
    if (signUpWrap) signUpWrap.style.display = 'block';
}

function getSelectedSignupGradeForGoogle() {
    if (googleAuthOriginMode === 'signup') {
        return document.getElementById('signupGrade')?.value || 'Class 12';
    }
    if (pendingTargetClass) {
        if (pendingTargetClass === 'c10') return 'Class 10';
        if (pendingTargetClass === 'c11') return 'Class 11';
        if (pendingTargetClass === 'entrance') return 'After 12';
    }
    return 'Class 12';
}

function openInteractiveGoogleChooser(mode = 'signin') {
    googleAuthOriginMode = mode;
    const err = document.getElementById('googleChooserErrorBanner');
    if (err) err.style.display = 'none';
    const quickForm = document.getElementById('googleAccountQuickForm');
    if (quickForm) quickForm.style.display = 'block';
    const otpForm = document.getElementById('googleGmailOtpForm');
    if (otpForm) otpForm.style.display = 'none';

    const titleEl = document.getElementById('googlePaneTitle');
    if (titleEl) titleEl.textContent = mode === 'signup' ? 'Sign Up with Google' : 'Continue with Google';
    const subEl = document.getElementById('googlePaneSubtitle');
    if (subEl) {
        subEl.textContent = 'Enter your Google name and Gmail address. If you already have an account, signing in with Google links to your existing member record without creating a duplicate.';
    }

    const gradeSel = document.getElementById('googleChooserGrade');
    if (gradeSel) {
        gradeSel.value = getSelectedSignupGradeForGoogle();
    }

    const prefillEmail = (document.getElementById('signinEmail')?.value || document.getElementById('signupEmail')?.value || '').trim();
    const prefillName = (document.getElementById('signupName')?.value || '').trim();
    const emailIn = document.getElementById('googleChooserEmail');
    const nameIn = document.getElementById('googleChooserName');
    if (emailIn && prefillEmail && !emailIn.value) emailIn.value = prefillEmail;
    if (nameIn && prefillName && !nameIn.value) nameIn.value = prefillName;

    switchAuthTab('google');
    setTimeout(() => (nameIn && !nameIn.value ? nameIn : emailIn)?.focus(), 60);
}

async function handleLocalGoogleSubmit(e) {
    if (e) e.preventDefault();
    if (authRequestInFlight) return;
    const name = (document.getElementById('googleChooserName')?.value || '').trim() || 'Student';
    const email = (document.getElementById('googleChooserEmail')?.value || '').trim().toLowerCase();
    const grade = document.getElementById('googleChooserGrade')?.value || getSelectedSignupGradeForGoogle();
    const keepSignedIn = document.getElementById('googleKeepSignedIn')?.checked !== false;
    const err = document.getElementById('googleChooserErrorBanner');
    if (err) err.style.display = 'none';

    if (!email) {
        showToast('Please enter your Gmail address.');
        return;
    }

    authRequestInFlight = true;
    const btn = document.getElementById('btnGoogleChooserSubmit');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true" style="margin-right:6px;"></i>Signing in with Google...';
    }

    try {
        const res = await fetch('/api/student-roster', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'GOOGLE_SIGN_IN',
                googleChooserEmail: email,
                name,
                grade,
                keepSignedIn
            })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            if (err) {
                err.innerHTML = `<p style="margin:0;">${data.error || 'Google Sign-In failed.'}</p>`;
                err.style.display = 'block';
            }
            showToast(data.error || 'Google Sign-In failed.');
            return;
        }
        if (Array.isArray(data.mySwitchRequests)) {
            window.MY_CLASS_SWITCH_REQUESTS = data.mySwitchRequests;
        }
        if (Array.isArray(data.myPayments)) {
            window.MY_PAYMENTS = data.myPayments;
        }
        const user = Object.assign({}, data.user, {
            sessionToken: data.sessionToken,
            keepSignedIn,
            verified: true
        });
        await finalizeVerifiedStudentAccount(user, false, true);
        if (data.linkedExisting) {
            showToast(`Signed in with Google — linked to your existing ${user.grade} account.`);
        }
    } catch (err2) {
        if (err) {
            err.innerHTML = '<p style="margin:0;">Unable to reach server. Please check your internet connection and try again.</p>';
            err.style.display = 'block';
        }
        showToast('Could not reach server for Google Sign-In.');
    } finally {
        authRequestInFlight = false;
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Continue with Google Account';
        }
    }
}

function handleGoogleAuthClick(mode = 'signin') {
    if (typeof isMaintenanceModeActive === 'function' && isMaintenanceModeActive()) {
        if (typeof showMaintenanceLockNotice === 'function') showMaintenanceLockNotice();
        return;
    }
    googleAuthOriginMode = mode;
    const clientId = getConfiguredGoogleClientId();

    if (!clientId) {
        openInteractiveGoogleChooser(mode);
        return;
    }

    // 1. Primary: Official Google OAuth 2.0 Account Chooser Popup Window
    if (window.google?.accounts?.oauth2?.initTokenClient) {
        try {
            const tokenClient = window.google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: 'openid email profile',
                prompt: 'select_account',
                callback: async (tokenResponse) => {
                    if (!tokenResponse || tokenResponse.error || !tokenResponse.access_token) {
                        if (tokenResponse?.error && tokenResponse.error !== 'popup_closed_by_user') {
                            showToast('Google Sign-In was cancelled or could not complete.');
                        }
                        return;
                    }
                    await completeGoogleTokenSignIn({ accessToken: tokenResponse.access_token });
                }
            });
            tokenClient.requestAccessToken({ prompt: 'select_account' });
            return;
        } catch (e) {}
    }

    // 2. Fallback: Interactive Google Account Chooser
    openInteractiveGoogleChooser(mode);
}

function openOfficialGoogleButtonPane(clientId) {
    handleGoogleAuthClick(googleAuthOriginMode);
}

function openGmailOtpPane() {
    const err = document.getElementById('googleChooserErrorBanner');
    if (err) err.style.display = 'none';
    const container = document.getElementById('googleOfficialBtnContainer');
    if (container) container.style.display = 'none';
    const quickForm = document.getElementById('googleAccountQuickForm');
    if (quickForm) quickForm.style.display = 'none';
    const form = document.getElementById('googleGmailOtpForm');
    if (form) form.style.display = 'block';
    const titleEl = document.getElementById('googlePaneTitle');
    if (titleEl) titleEl.textContent = 'Sign In with Email Code';
    const sub = document.getElementById('googlePaneSubtitle');
    if (sub) sub.textContent = "Enter your registered email address and we'll send a 6-digit login code to your inbox.";
    const signInEmail = (document.getElementById('signinEmail')?.value || '').trim();
    const localEmailInput = document.getElementById('googleLocalEmail');
    if (localEmailInput && signInEmail && !localEmailInput.value) {
        localEmailInput.value = signInEmail;
    }
    switchAuthTab('google');
    setTimeout(() => document.getElementById('googleLocalEmail')?.focus(), 60);
}

async function handleGmailOtpSubmit(e) {
    if (e) e.preventDefault();
    const email = (document.getElementById('googleLocalEmail')?.value || '').trim().toLowerCase();
    const name = email.split('@')[0] || 'Student';
    const grade = 'Class 12';
    const err = document.getElementById('googleChooserErrorBanner');
    if (err) err.style.display = 'none';

    if (!email) {
        showToast('Please enter your registered email address.');
        return;
    }

    const btn = document.getElementById('btnGoogleLocalSubmit');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Sending 6-digit code...';
    }

    try {
        const res = await fetch('/api/send-email-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, grade, mode: 'gmail_otp' })
        });
        const data = await res.json();

        if (!res.ok || !data.ok) {
            if (res.status === 429 && data.code === 'RESEND_COOLDOWN' && data.retryAfterSeconds) {
                startResendCooldown(data.retryAfterSeconds);
            }
            if (err) {
                err.innerHTML = `<p style="margin:0;">${data.error || 'Could not send login code to this email address.'}</p>`;
                err.style.display = 'block';
            }
            showToast(data.error || 'Could not send login code.');
            return;
        }

        pendingOtpSession = {
            name,
            email,
            grade,
            password: '',
            mode: 'gmail_otp',
            otpToken: data.otpToken || '',
            expiresAt: data.expiresAt || (Date.now() + 5 * 60 * 1000)
        };

        document.getElementById('googleLocalChooserContainer').style.display = 'none';
        document.getElementById('otpStep2Container').style.display = 'block';
        const head = document.getElementById('otpStep2Heading');
        if (head) head.textContent = 'Enter 6-Digit Login Code';
        document.getElementById('otpTargetEmailBadge').textContent = email;
        const otpErr = document.getElementById('otpVerifyErrorBanner');
        if (otpErr) otpErr.style.display = 'none';

        startOtpExpiryTimer(pendingOtpSession.expiresAt);
        startResendCooldown(data.cooldownSeconds || 30);

        clearOtpDigitBoxes();
        setTimeout(() => document.getElementById('otpDigit0')?.focus(), 80);
        showToast(data.message || `6-digit login code sent to ${email}`);
    } catch (e2) {
        showToast('Unable to reach server to send login code.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Send 6-Digit Login Code';
        }
    }
}

async function completeGoogleTokenSignIn(tokenPayload) {
    try {
        const payload = typeof tokenPayload === 'string'
            ? { idToken: tokenPayload }
            : (tokenPayload || {});
        const res = await fetch('/api/student-roster', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'GOOGLE_SIGN_IN',
                idToken: payload.idToken || '',
                accessToken: payload.accessToken || '',
                grade: getSelectedSignupGradeForGoogle()
            })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            showToast(data.error || 'Google Sign-In failed.');
            return;
        }
        const user = Object.assign({}, data.user, {
            sessionToken: data.sessionToken,
            verified: true
        });
        await finalizeVerifiedStudentAccount(user, false, true);
        if (data.linkedExisting) {
            showToast(`Signed in with Google — linked to your existing ${user.grade} account.`);
        }
    } catch (err) {
        showToast('Could not complete Google Sign-In.');
    }
}

function switchToSignInWithEmail() {
    const email = lastDuplicateEmailAttempt || (document.getElementById('signupEmail')?.value || '').trim();
    switchAuthTab('signin');
    const input = document.getElementById('signinEmail');
    if (input && email) {
        input.value = email;
        document.getElementById('signinPassword')?.focus();
    }
}

function switchToResetWithEmail() {
    const email = lastDuplicateEmailAttempt || (document.getElementById('signupEmail')?.value || '').trim();
    switchAuthTab('reset');
    const input = document.getElementById('resetEmail');
    if (input && email) {
        input.value = email;
        document.getElementById('resetNewPassword')?.focus();
    }
}

function getStoredAccounts() {
    try {
        const raw = localStorage.getItem(BPG_ACCOUNTS_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
}

function saveStoredAccounts(list) {
    try {
        localStorage.setItem(BPG_ACCOUNTS_KEY, JSON.stringify(list));
    } catch (e) {}
}

async function handleSignInSubmit(e) {
    if (e) e.preventDefault();
    if (authRequestInFlight) return;

    const email = (document.getElementById('signinEmail')?.value || '').trim().toLowerCase();
    const password = String(document.getElementById('signinPassword')?.value || '');
    const rememberEmail = Boolean(document.getElementById('signinRememberEmail')?.checked);
    const keepSignedIn = document.getElementById('signinKeepSignedIn')?.checked !== false;
    const errBanner = document.getElementById('signinErrorBanner');

    if (errBanner) errBanner.style.display = 'none';

    if (!email) {
        showToast('Please enter your email address.');
        return;
    }
    if (!password) {
        showToast('Please enter your password.');
        return;
    }

    authRequestInFlight = true;
    const btn = document.getElementById('btnSignInSubmit');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true" style="margin-right:6px;"></i>Signing in...';
    }

    try {
        const res = await fetch('/api/student-roster', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'SIGN_IN', email, password, keepSignedIn })
        });

        let data = {};
        try { data = await res.json(); } catch (parseErr) {}

        if (res.status >= 500) {
            const msg = 'Temporary server issue while signing in. Your password may be fine — please try again in a moment.';
            if (errBanner) {
                errBanner.innerHTML = `<p style="margin:0;">${msg}</p>`;
                errBanner.style.display = 'block';
            }
            showToast(msg);
            return;
        }

        if (!res.ok || !data.success) {
            const msg = data.error || "We couldn't sign you in with that email and password.";
            if (errBanner) {
                const showRecoveryActions = data.code === 'INVALID_CREDENTIALS' || res.status === 401;
                errBanner.innerHTML = `
                    <p style="margin:0 0 ${showRecoveryActions ? '10px' : '0'} 0;">${msg}</p>
                    ${showRecoveryActions ? `
                        <div style="display:flex; gap:8px; flex-wrap:wrap;">
                            <button type="button" class="btn btn-secondary" style="padding:6px 12px; font-size:0.78rem;" onclick="handleGoogleAuthClick('signin')">Continue with Google</button>
                            <button type="button" class="btn btn-secondary" style="padding:6px 12px; font-size:0.78rem;" onclick="openForgotPasswordFromSignIn()">Forgot password?</button>
                            <button type="button" class="btn btn-secondary" style="padding:6px 12px; font-size:0.78rem;" onclick="openGmailOtpPane()">Email 6-digit code</button>
                        </div>
                    ` : ''}
                `;
                errBanner.style.display = 'block';
            }
            showToast(msg);
            return;
        }

        // Remember ONLY email (never raw password!)
        try {
            if (rememberEmail) localStorage.setItem(BPG_REMEMBERED_EMAIL_KEY, email);
            else localStorage.removeItem(BPG_REMEMBERED_EMAIL_KEY);
        } catch (e2) {}

        if (Array.isArray(data.mySwitchRequests)) {
            window.MY_CLASS_SWITCH_REQUESTS = data.mySwitchRequests;
        }
        if (Array.isArray(data.myPayments)) {
            window.MY_PAYMENTS = data.myPayments;
        }
        const user = Object.assign({}, data.user, {
            sessionToken: data.sessionToken,
            keepSignedIn,
            verified: true
        });
        await finalizeVerifiedStudentAccount(user, false, true);
    } catch (err) {
        const netMsg = 'Could not reach the server. Check your internet connection and try again — your password was not rejected.';
        if (errBanner) {
            errBanner.innerHTML = `<p style="margin:0;">${netMsg}</p>`;
            errBanner.style.display = 'block';
        }
        showToast(netMsg);
    } finally {
        authRequestInFlight = false;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-right-to-bracket" aria-hidden="true" style="margin-right:6px;"></i>Sign In';
        }
    }
}

function quickOtpSignIn() {
    switchAuthTab('reset');
}

function clearOtpDigitBoxes() {
    for (let i = 0; i < 6; i++) {
        const box = document.getElementById(`otpDigit${i}`);
        if (box) box.value = '';
    }
}

function handleOtpBoxInput(idx, inputEl) {
    const val = inputEl.value.replace(/\D/g, '');
    inputEl.value = val.slice(-1);
    if (inputEl.value && idx < 5) {
        document.getElementById(`otpDigit${idx + 1}`)?.focus();
    }
}

function handleOtpBoxKeydown(idx, e) {
    if (e.key === 'Backspace' && !e.target.value && idx > 0) {
        document.getElementById(`otpDigit${idx - 1}`)?.focus();
    }
}

async function handleRequestEmailOtp(e) {
    if (e) e.preventDefault();
    if (authRequestInFlight) return;
    const name = document.getElementById('signupName')?.value.trim() || 'Student';
    const email = (document.getElementById('signupEmail')?.value || '').trim().toLowerCase();
    const grade = document.getElementById('signupGrade')?.value || 'Class 12';
    const password = String(document.getElementById('signupPassword')?.value || '');

    clearAuthInlineAlerts();

    if (!email) {
        showToast('Please enter a valid email address.');
        return;
    }
    if (password.length < 6) {
        showToast('Password must be at least 6 characters long.');
        document.getElementById('signupPassword')?.focus();
        return;
    }

    // Block registering directly into a locked section
    const classKeyMap = { 'Class 10': 'class-10', 'Class 11': 'class-11', 'Class 12': 'class-12', 'After 12': 'after-12' };
    const mappedClass = classKeyMap[grade] || 'class-12';
    if (typeof isSectionLocked === 'function' && isSectionLocked(mappedClass)) {
        showSectionLockedModal(mappedClass);
        return;
    }

    authRequestInFlight = true;
    const btn = document.getElementById('btnSendOtpSubmit');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true" style="margin-right:6px;"></i>Sending verification email...';
    }

    try {
        const res = await fetch('/api/send-email-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, grade, mode: 'signup' })
        });
        const data = await res.json();

        // Duplicate Gmail inbox detected on backend!
        if (res.status === 409 || data.code === 'EMAIL_EXISTS') {
            lastDuplicateEmailAttempt = data.existingEmail || email;
            const dupBanner = document.getElementById('signupDuplicateBanner');
            const dupMsg = document.getElementById('signupDuplicateMsg');
            if (dupMsg) {
                dupMsg.textContent = data.error || 'An account already exists for this Gmail address. Please sign in or reset your password.';
            }
            if (dupBanner) dupBanner.style.display = 'block';
            showToast('An account already exists for this Gmail address.');
            return;
        }

        if (!res.ok || !data.ok) {
            if (res.status === 429 && data.code === 'RESEND_COOLDOWN' && data.retryAfterSeconds) {
                startResendCooldown(data.retryAfterSeconds);
            }
            const dupBanner = document.getElementById('signupDuplicateBanner');
            const dupMsg = document.getElementById('signupDuplicateMsg');
            const otpErr = document.getElementById('otpVerifyErrorBanner');
            if (document.getElementById('otpStep2Container')?.style.display === 'block' && otpErr) {
                otpErr.innerHTML = `<p style="margin:0;">${data.error || 'Could not send verification code.'}</p>`;
                otpErr.style.display = 'block';
            } else {
                if (dupMsg) dupMsg.textContent = data.error || 'Could not send verification code to this email.';
                if (dupBanner) dupBanner.style.display = 'block';
            }
            showToast(data.error || 'Could not send verification code.');
            return;
        }

        pendingOtpSession = {
            name,
            email,
            grade,
            password,
            mode: 'signup',
            otpToken: data.otpToken || '',
            expiresAt: data.expiresAt || (Date.now() + 5 * 60 * 1000)
        };

        document.getElementById('otpStep1Container').style.display = 'none';
        document.getElementById('otpStep2Container').style.display = 'block';
        const head = document.getElementById('otpStep2Heading');
        if (head) head.textContent = 'Verify Your Email';
        document.getElementById('otpTargetEmailBadge').textContent = `${email} (${grade})`;
        const otpErr = document.getElementById('otpVerifyErrorBanner');
        if (otpErr) otpErr.style.display = 'none';

        startOtpExpiryTimer(pendingOtpSession.expiresAt);
        startResendCooldown(data.cooldownSeconds || 30);

        clearOtpDigitBoxes();
        setTimeout(() => document.getElementById('otpDigit0')?.focus(), 80);
        showToast(data.message || `Verification code sent to ${email}`);
    } catch (err) {
        showToast('Could not connect to server to send verification code. Please try again.');
    } finally {
        authRequestInFlight = false;
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Continue & Verify Email';
        }
    }
}

async function handleRequestPasswordResetOtp(e) {
    if (e) e.preventDefault();
    if (authRequestInFlight) return;
    const email = (document.getElementById('resetEmail')?.value || '').trim().toLowerCase();
    const newPassword = String(document.getElementById('resetNewPassword')?.value || '');
    const errBanner = document.getElementById('resetErrorBanner');
    if (errBanner) errBanner.style.display = 'none';

    if (!email) {
        showToast('Please enter your email address.');
        return;
    }
    if (newPassword.length < 6) {
        showToast('New password must be at least 6 characters long.');
        document.getElementById('resetNewPassword')?.focus();
        return;
    }

    authRequestInFlight = true;
    const btn = document.getElementById('btnResetOtpSubmit');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true" style="margin-right:6px;"></i>Sending reset code...';
    }

    try {
        const res = await fetch('/api/send-email-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, mode: 'reset' })
        });
        const data = await res.json();

        if (!res.ok || !data.ok) {
            if (res.status === 429 && data.code === 'RESEND_COOLDOWN' && data.retryAfterSeconds) {
                startResendCooldown(data.retryAfterSeconds);
            }
            if (errBanner) {
                errBanner.innerHTML = `<p style="margin:0;">${data.error || 'Could not send reset code right now.'}</p>`;
                errBanner.style.display = 'block';
            }
            showToast(data.error || 'Could not send reset code.');
            return;
        }

        pendingOtpSession = {
            name: '',
            email,
            grade: '',
            password: newPassword,
            mode: 'reset',
            otpToken: data.otpToken || '',
            expiresAt: data.expiresAt || (Date.now() + 5 * 60 * 1000)
        };

        document.getElementById('authResetContainer').style.display = 'none';
        document.getElementById('otpStep2Container').style.display = 'block';
        const head = document.getElementById('otpStep2Heading');
        if (head) head.textContent = 'Check Your Email for Reset Code';
        const sub = document.getElementById('otpStep2Subtitle');
        if (sub) sub.textContent = "If an account exists for this email, we've sent a 6-digit code. Enter it below to finish updating your password.";
        document.getElementById('otpTargetEmailBadge').textContent = email;
        const otpErr = document.getElementById('otpVerifyErrorBanner');
        if (otpErr) otpErr.style.display = 'none';

        startOtpExpiryTimer(pendingOtpSession.expiresAt);
        startResendCooldown(data.cooldownSeconds || 30);

        clearOtpDigitBoxes();
        setTimeout(() => document.getElementById('otpDigit0')?.focus(), 80);
        showToast("If an account exists for this email, we've sent a 6-digit reset code.");
    } catch (err) {
        showToast('Unable to send reset code. Please check your connection and try again.');
    } finally {
        authRequestInFlight = false;
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Send Reset Code';
        }
    }
}

function resendEmailOtpCode() {
    if (otpResendRemaining > 0) {
        showToast(`Please wait ${otpResendRemaining}s before requesting another code.`);
        return;
    }
    if (pendingOtpSession.mode === 'reset') {
        handleRequestPasswordResetOtp(null);
    } else if (pendingOtpSession.mode === 'gmail_otp') {
        handleGmailOtpSubmit(null);
    } else {
        handleRequestEmailOtp(null);
    }
}

async function handleVerifyEmailOtp(e) {
    e.preventDefault();
    const errBanner = document.getElementById('otpVerifyErrorBanner');
    if (errBanner) errBanner.style.display = 'none';

    let enteredOtp = '';
    for (let i = 0; i < 6; i++) {
        enteredOtp += (document.getElementById(`otpDigit${i}`)?.value || '').trim();
    }

    if (!/^\d{6}$/.test(enteredOtp)) {
        const msg = 'Please enter all 6 digits of your verification code.';
        if (errBanner) {
            errBanner.innerHTML = `<p style="margin:0;">${msg}</p>`;
            errBanner.style.display = 'block';
        }
        showToast(msg);
        return;
    }

    const btn = document.getElementById('btnVerifyOtpSubmit');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Verifying...';
    }

    try {
        const res = await fetch('/api/verify-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: pendingOtpSession.name,
                email: pendingOtpSession.email,
                grade: pendingOtpSession.grade,
                newPassword: pendingOtpSession.password,
                mode: pendingOtpSession.mode || 'signup',
                otp: enteredOtp,
                otpToken: pendingOtpSession.otpToken
            })
        });
        const data = await res.json();

        if (res.status === 409 || data.code === 'EMAIL_EXISTS') {
            lastDuplicateEmailAttempt = data.existingEmail || pendingOtpSession.email;
            switchAuthTab('signup');
            const dupBanner = document.getElementById('signupDuplicateBanner');
            const dupMsg = document.getElementById('signupDuplicateMsg');
            if (dupMsg) dupMsg.textContent = data.error;
            if (dupBanner) dupBanner.style.display = 'block';
            return;
        }

        if (!res.ok || !data.ok) {
            const errMsg = data.error || 'Incorrect 6-digit verification code.';
            if (errBanner) {
                errBanner.innerHTML = `<p style="margin:0;">${errMsg}</p>`;
                errBanner.style.display = 'block';
            }
            showToast(errMsg);
            return;
        }

        clearOtpTimers();
        const user = Object.assign({}, data.user, {
            sessionToken: data.sessionToken,
            verified: true
        });
        await finalizeVerifiedStudentAccount(user, false, true);
    } catch (err) {
        const msg = 'Verification error. Please check your 6-digit code.';
        if (errBanner) {
            errBanner.innerHTML = `<p style="margin:0;">${msg}</p>`;
            errBanner.style.display = 'block';
        }
        showToast(msg);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Verify & Activate Account';
        }
    }
}

async function finalizeVerifiedStudentAccount(userObj, shouldPostToRoster = false, redirectToDashboard = false) {
    const email = (userObj.email || '').toLowerCase();
    const grade = userObj.grade || 'Class 12';
    const normKey = normalizeClassKey(grade);
    const plan = (userObj.plan || 'free').toLowerCase();

    const record = {
        userId: userObj.userId || '',
        name: userObj.name || 'Student',
        username: userObj.username || (email.includes('@') ? email.split('@')[0] : 'student'),
        email: email,
        grade: grade,
        classKey: normKey,
        plan: plan,
        accountStatus: userObj.accountStatus || 'active',
        paymentStatus: userObj.paymentStatus || (plan !== 'free' ? 'paid' : 'none'),
        legacyAccess: Boolean(userObj.legacyAccess),
        planExplicitlySet: Boolean(userObj.planExplicitlySet),
        googleLinked: Boolean(userObj.googleLinked),
        avatarUrl: userObj.avatarUrl || '',
        readNotificationIds: Array.isArray(userObj.readNotificationIds) ? userObj.readNotificationIds : [],
        keepSignedIn: userObj.keepSignedIn !== false,
        sessionToken: userObj.sessionToken || '',
        verified: true,
        joinedAt: userObj.joinedAt || userObj.verifiedAt || new Date().toISOString().split('T')[0],
        updatedAt: userObj.updatedAt || new Date().toISOString(),
        lastModifiedBy: userObj.lastModifiedBy || 'Student'
    };

    if (typeof saveStoredStudentSession === 'function') {
        saveStoredStudentSession(record, record.keepSignedIn);
    } else {
        localStorage.setItem(BPG_STUDENT_SESSION_KEY, JSON.stringify(record));
        localStorage.setItem('bpg_student_session', JSON.stringify(record));
        localStorage.setItem('bpg_student_class', normKey);
    }
    if (typeof renderHeaderNotificationsBell === 'function') {
        renderHeaderNotificationsBell();
    }

    if (typeof broadcastStudentMutation === 'function') {
        broadcastStudentMutation('STUDENT_ROSTER_UPDATED', { email: record.email, userId: record.userId });
    }

    if (shouldPostToRoster) {
        await fetch('/api/student-roster', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newAccount: record })
        }).catch(() => {});
    }

    updateAuthUserPill();
    closeAuthModal();
    await syncWithServerDatabase();
    if (typeof syncRosterPermissionsFromServer === 'function') {
        await syncRosterPermissionsFromServer();
    }
    showToast(`Welcome ${record.name}! Signed in (${plan.charAt(0).toUpperCase() + plan.slice(1)} plan).`);

    if (window.pendingCheckoutPlan && typeof openCheckoutModal === 'function') {
        const planToBuy = window.pendingCheckoutPlan;
        window.pendingCheckoutPlan = null;
        openCheckoutModal(planToBuy);
        return;
    }

    // Redirect to user's class dashboard after verification or when a target class was selected
    if (pendingTargetClass && ['c10', 'c11', 'c12', 'entrance'].includes(pendingTargetClass)) {
        const target = pendingTargetClass;
        pendingTargetClass = null;
        handleClassNavClick(target);
    } else if (redirectToDashboard && typeof openMyClassWorkspace === 'function') {
        openMyClassWorkspace();
    } else if (redirectToDashboard) {
        handleClassNavClick(normKey);
    } else if (typeof handleHomeClick === 'function') {
        handleHomeClick();
    }
}

/* Staggered Scroll Animations */
function initScrollRevealAnimations() {
    const elements = document.querySelectorAll('.reveal-on-scroll');
    if (!('IntersectionObserver' in window)) {
        elements.forEach(el => el.classList.add('is-visible'));
        return;
    }
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.08 });

    elements.forEach(el => observer.observe(el));
}

document.addEventListener('click', e => {
    if (!e.target.closest('#notifWrapper')) {
        document.getElementById('notifDrawer')?.classList.remove('open');
    }
});
