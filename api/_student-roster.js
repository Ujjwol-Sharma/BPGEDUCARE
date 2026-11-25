/**
 * BPG Academy — Student Roster, Gmail Uniqueness & Plan Management API (/api/student-roster)
 */

const crypto = require('crypto');
const {
    canonicalizeEmail,
    isValidEmailFormat,
    hashPassword,
    verifyPassword,
    normalizePlan,
    gradeToClassKey,
    normalizeGradeName,
    isAdminPasskeyValid,
    issueStudentSessionToken,
    readRoster,
    writeRoster,
    deriveStableUserId,
    appendAccountAuditEntry,
    appendRosterAuditEntry,
    normalizeAccountStatus,
    normalizePaymentStatusValue,
    readAcademyState,
    resolveRequestUser
} = require('./_access-control');

async function verifyGoogleIdToken(idToken, expectedClientId) {
    if (!idToken) return null;
    try {
        const resp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
        if (!resp.ok) return null;
        const info = await resp.json();
        if (!info || !info.email || info.email_verified === 'false' || info.email_verified === false) return null;
        if (expectedClientId && info.aud && info.aud !== expectedClientId) return null;
        return {
            email: String(info.email).trim().toLowerCase(),
            name: String(info.name || info.given_name || 'Student').trim(),
            googleSub: String(info.sub || ''),
            avatarUrl: String(info.picture || '')
        };
    } catch (e) {
        return null;
    }
}

async function verifyGoogleAccessToken(accessToken, expectedClientId) {
    if (!accessToken) return null;
    try {
        const [tokenResp, userResp] = await Promise.all([
            fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`),
            fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` }
            })
        ]);
        if (!tokenResp.ok || !userResp.ok) return null;
        const tokenInfo = await tokenResp.json();
        const userInfo = await userResp.json();
        if (!userInfo || !userInfo.email || userInfo.email_verified === false) return null;
        if (expectedClientId && tokenInfo.aud && tokenInfo.aud !== expectedClientId && tokenInfo.azp !== expectedClientId) {
            return null;
        }
        return {
            email: String(userInfo.email).trim().toLowerCase(),
            name: String(userInfo.name || userInfo.given_name || 'Student').trim(),
            googleSub: String(userInfo.sub || tokenInfo.sub || ''),
            avatarUrl: String(userInfo.picture || '')
        };
    } catch (e) {
        return null;
    }
}

function stripSensitiveAccountFields(acc) {
    const { passkey, ...safe } = acc;
    return safe;
}

module.exports = async function studentRosterHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-passkey, x-session-token, x-student-email, Authorization');

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
        try {
            const roster = readRoster();
            const isAdmin = isAdminPasskeyValid(req.headers['x-admin-passkey']);
            const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
            const checkMe = parsedUrl.searchParams.get('me') === '1';

            if (req.method === 'HEAD') {
                res.statusCode = 200;
                res.end();
                return;
            }

            const { resolveRequestUserStatus } = require('./_access-control');
            const { ensureDurableStoreHydrated, isDurableHydrationAuthoritative } = require('./_durable-storage');
            const { TMP_DB_PATH, TMP_ROSTER_PATH, DB_PATH, ROSTER_PATH } = require('./_access-control');

            let me = null;
            let sessionRevoked = false;
            let liveRoster = roster;
            if (!isAdmin) {
                let status = resolveRequestUserStatus(req);
                if (status.needsFreshCheck) {
                    await ensureDurableStoreHydrated({ TMP_DB_PATH, TMP_ROSTER_PATH, DB_PATH, ROSTER_PATH, force: true });
                    liveRoster = readRoster();
                    status = resolveRequestUserStatus(req);
                }
                me = status.user;
                sessionRevoked = Boolean(status.revoked || (status.needsFreshCheck && isDurableHydrationAuthoritative()));
            }

            if (checkMe && !isAdmin) {
                const mySwitchRequests = me
                    ? (liveRoster.classSwitchRequests || []).filter(
                        r => (r.userId && r.userId === me.userId) || canonicalizeEmail(r.email) === canonicalizeEmail(me.email)
                    )
                    : [];
                const myPayments = me
                    ? (Array.isArray(readAcademyState().payments) ? readAcademyState().payments : []).filter(
                        p => (p.userId && p.userId === me.userId) || canonicalizeEmail(p.email) === canonicalizeEmail(me.email)
                    )
                    : [];
                res.statusCode = 200;
                res.end(JSON.stringify({
                    success: true,
                    rosterRevision: Number(liveRoster.revision) || 0,
                    account: me ? stripSensitiveAccountFields(me) : null,
                    sessionRevoked,
                    mySwitchRequests,
                    myPayments
                }));
                return;
            }

            res.statusCode = 200;
            res.end(JSON.stringify({
                success: true,
                data: {
                    revision: Number(roster.revision) || 0,
                    lastUpdated: roster.lastUpdated,
                    duplicateGroups: isAdmin ? (roster.duplicateGroups || []) : [],
                    classSwitchRequests: isAdmin ? (roster.classSwitchRequests || []) : [],
                    auditLog: isAdmin ? (roster.auditLog || []) : [],
                    accounts: isAdmin
                        ? (roster.accounts || []).map(stripSensitiveAccountFields)
                        : (me ? [stripSensitiveAccountFields(me)] : [])
                }
            }));
        } catch (err) {
            console.error('[API /api/student-roster] Read error:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
    }

    if (req.method === 'POST') {
        const payload = req.body || {};
        const passkey = req.headers['x-admin-passkey'] || payload.adminPasskey;
        const isAdmin = isAdminPasskeyValid(passkey);
        const state = readAcademyState();

        // Enforce Maintenance Mode for non-admin mutations
        if (!isAdmin && state.maintenanceMode?.enabled) {
            res.statusCode = 503;
            res.end(JSON.stringify({
                success: false,
                code: 'MAINTENANCE_MODE',
                error: state.maintenanceMode.message || 'Site is currently under maintenance.'
            }));
            return;
        }

        try {
            const roster = readRoster();

            // 0. GOOGLE SIGN-IN / ACCOUNT LINKING (Links by stable userId / googleSub / canonicalEmail; never creates duplicates)
            if (payload.action === 'GOOGLE_SIGN_IN') {
                const configuredClientId = String(state.siteSettings?.googleClientId || process.env.GOOGLE_CLIENT_ID || '').trim();
                let googleProfile = null;

                if (payload.accessToken || payload.idToken) {
                    googleProfile = payload.accessToken
                        ? await verifyGoogleAccessToken(payload.accessToken, configuredClientId)
                        : await verifyGoogleIdToken(payload.idToken, configuredClientId);
                    if (!googleProfile) {
                        res.statusCode = 401;
                        res.end(JSON.stringify({ success: false, error: 'Invalid, unverified, or expired Google Sign-In token.' }));
                        return;
                    }
                } else if (payload.googleChooserEmail && isValidEmailFormat(String(payload.googleChooserEmail).trim().toLowerCase())) {
                    // Built-in Google Account Chooser flow when external Google OAuth Client ID is not yet configured
                    const rawG = String(payload.googleChooserEmail).trim().toLowerCase();
                    const canonicalG = canonicalizeEmail(rawG);
                    googleProfile = {
                        email: rawG,
                        name: String(payload.name || rawG.split('@')[0] || 'Student').trim(),
                        googleSub: String(payload.googleSub || ('gsub_' + crypto.createHash('sha256').update(canonicalG).digest('hex').slice(0, 16))),
                        avatarUrl: String(payload.avatarUrl || '')
                    };
                } else {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ success: false, error: 'Google account token or email is required.' }));
                    return;
                }

                const canonical = canonicalizeEmail(googleProfile.email);
                const stableUserId = deriveStableUserId(canonical);
                let account = roster.accounts.find(
                    a => (googleProfile.googleSub && a.googleSub === googleProfile.googleSub)
                        || a.userId === stableUserId
                        || a.canonicalEmail === canonical
                );
                let linkedExisting = false;

                if (account) {
                    if (account.accountStatus === 'suspended') {
                        res.statusCode = 403;
                        res.end(JSON.stringify({
                            success: false,
                            code: 'ACCOUNT_SUSPENDED',
                            error: 'Your account has been suspended by an administrator. Please contact BPG EDUCARE support.'
                        }));
                        return;
                    }
                    // Preserve existing profile, class access, subscription plan, and payment history under same stable userId!
                    linkedExisting = true;
                    account.userId = deriveStableUserId(canonical, account.userId);
                    account.googleLinked = true;
                    account.emailVerified = true;
                    if (account.accountStatus === 'pending_verification') account.accountStatus = 'active';
                    if (!account.verifiedAt) account.verifiedAt = new Date().toISOString();
                    if (googleProfile.googleSub) account.googleSub = googleProfile.googleSub;
                    if (googleProfile.avatarUrl) account.avatarUrl = googleProfile.avatarUrl;
                    if ((!account.name || account.name === 'Student') && googleProfile.name) account.name = googleProfile.name;
                    appendAccountAuditEntry(account, {
                        actor: `${account.name} (Google Sign-In)`,
                        action: 'GOOGLE_SIGN_IN',
                        details: 'Signed in with Google and linked to existing member record'
                    });
                    appendRosterAuditEntry(roster, {
                        userId: account.userId,
                        email: account.email,
                        actor: `${account.name} (Google Sign-In)`,
                        action: 'GOOGLE_SIGN_IN',
                        details: `Signed in with Google (${account.grade} · ${account.plan.toUpperCase()})`
                    });
                    const updated = writeRoster(roster);
                    account = updated.accounts.find(a => a.userId === account.userId || a.canonicalEmail === canonical) || account;
                } else {
                    const grade = normalizeGradeName(payload.grade || payload.classKey || 'Class 12');
                    const classKey = gradeToClassKey(grade);
                    const nowIso = new Date().toISOString();
                    const created = {
                        userId: stableUserId,
                        name: googleProfile.name || 'Student',
                        username: String(payload.username || googleProfile.email.split('@')[0]).trim(),
                        email: googleProfile.email,
                        canonicalEmail: canonical,
                        grade,
                        classKey,
                        plan: 'free',
                        planExplicitlySet: false,
                        legacyAccess: false,
                        accountStatus: 'active',
                        paymentStatus: 'none',
                        emailVerified: true,
                        verifiedAt: nowIso,
                        verificationMethod: 'google_oauth',
                        googleLinked: true,
                        googleSub: googleProfile.googleSub || ('gsub_' + crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16)),
                        avatarUrl: googleProfile.avatarUrl || '',
                        passkey: hashPassword('google-oauth-' + Date.now() + '-' + Math.random()),
                        joinedAt: nowIso.split('T')[0],
                        updatedAt: nowIso,
                        lastModifiedBy: `${googleProfile.name || 'Student'} (Google Sign-Up)`,
                        auditLog: []
                    };
                    appendAccountAuditEntry(created, {
                        actor: `${created.name} (Google Sign-Up)`,
                        action: 'ACCOUNT_CREATED',
                        details: `Created account via Google Sign-Up in ${grade}`
                    });
                    appendRosterAuditEntry(roster, {
                        userId: created.userId,
                        email: created.email,
                        actor: `${created.name} (Google Sign-Up)`,
                        action: 'ACCOUNT_CREATED',
                        details: `Registered via Google Sign-Up (${grade})`
                    });
                    roster.accounts.unshift(created);
                    const updated = writeRoster(roster);
                    account = updated.accounts.find(a => a.userId === stableUserId || a.canonicalEmail === canonical) || created;
                }

                const sessionToken = issueStudentSessionToken(account);
                const mySwitchRequests = (roster.classSwitchRequests || []).filter(
                    r => (r.userId && r.userId === account.userId) || canonicalizeEmail(r.email) === canonical
                );
                const myPayments = (Array.isArray(state.payments) ? state.payments : []).filter(
                    p => (p.userId && p.userId === account.userId) || canonicalizeEmail(p.email) === canonical
                );
                res.statusCode = 200;
                res.end(JSON.stringify({
                    success: true,
                    linkedExisting,
                    sessionToken,
                    user: stripSensitiveAccountFields(account),
                    mySwitchRequests,
                    myPayments
                }));
                return;
            }

            // 0a. STUDENT PROFILE UPDATE (Name / Username / Instant Class Update when no switch approval is needed or self-edit)
            if (payload.action === 'UPDATE_PROFILE') {
                const user = resolveRequestUser(req);
                if (!user || !user.email) {
                    res.statusCode = 401;
                    res.end(JSON.stringify({ success: false, error: 'Please sign in to update your profile.' }));
                    return;
                }
                const canonical = canonicalizeEmail(user.email);
                const account = roster.accounts.find(a => a.userId === user.userId || a.canonicalEmail === canonical);
                if (!account) {
                    res.statusCode = 404;
                    res.end(JSON.stringify({ success: false, error: 'Student account not found.' }));
                    return;
                }

                const changes = [];
                if (payload.name && String(payload.name).trim()) {
                    const nextName = String(payload.name).trim();
                    if (nextName !== account.name) {
                        changes.push(`Name: "${account.name}" -> "${nextName}"`);
                        account.name = nextName;
                    }
                }
                if (payload.username && String(payload.username).trim()) {
                    const nextUser = String(payload.username).trim().replace(/[^a-zA-Z0-9._-]/g, '');
                    if (nextUser && nextUser !== account.username) {
                        changes.push(`Username: @${account.username} -> @${nextUser}`);
                        account.username = nextUser;
                    }
                }
                if (payload.grade || payload.classKey) {
                    const requestedClassKey = gradeToClassKey(payload.grade || payload.classKey);
                    const lock = state.sectionLocks?.[requestedClassKey];
                    if (lock && lock.locked) {
                        res.statusCode = 403;
                        res.end(JSON.stringify({ success: false, error: lock.reason || 'Selected class is currently locked.' }));
                        return;
                    }
                    if (requestedClassKey !== account.classKey) {
                        const prevGrade = account.grade;
                        account.classKey = requestedClassKey;
                        account.grade = normalizeGradeName(requestedClassKey);
                        changes.push(`Class: ${prevGrade} -> ${account.grade}`);
                    }
                }

                appendAccountAuditEntry(account, {
                    actor: `${account.name} (Student)`,
                    action: 'PROFILE_UPDATED',
                    details: changes.length ? changes.join(', ') : 'Profile saved'
                });
                appendRosterAuditEntry(roster, {
                    userId: account.userId,
                    email: account.email,
                    actor: `${account.name} (Student)`,
                    action: 'PROFILE_UPDATED',
                    details: changes.length ? changes.join(', ') : 'Profile saved'
                });

                // Also keep studentName synced in payments & switch requests linked to this userId
                if (Array.isArray(state.payments)) {
                    let payTouched = false;
                    state.payments.forEach(p => {
                        if ((p.userId && p.userId === account.userId) || p.canonicalEmail === canonical) {
                            p.userId = account.userId;
                            p.fullName = account.name;
                            p.username = account.username;
                            payTouched = true;
                        }
                    });
                    if (payTouched) {
                        const { writeStateToDisk } = require('./academy-state');
                        writeStateToDisk(state);
                    }
                }

                const savedRoster = writeRoster(roster);
                const updatedAcc = savedRoster.accounts.find(a => a.userId === account.userId || a.canonicalEmail === canonical) || account;
                const sessionToken = issueStudentSessionToken(updatedAcc);

                res.statusCode = 200;
                res.end(JSON.stringify({
                    success: true,
                    message: 'Profile updated and synced.',
                    sessionToken,
                    user: stripSensitiveAccountFields(updatedAcc)
                }));
                return;
            }

            // 0b. STUDENT CLASS SWITCH REQUEST (enforces 1 active class until admin approves)
            if (payload.action === 'REQUEST_CLASS_SWITCH') {
                const user = resolveRequestUser(req);
                if (!user || !user.email) {
                    res.statusCode = 401;
                    res.end(JSON.stringify({ success: false, error: 'Please sign in to request a class switch.' }));
                    return;
                }
                const canonical = canonicalizeEmail(user.email);
                const account = roster.accounts.find(a => a.canonicalEmail === canonical);
                if (!account) {
                    res.statusCode = 404;
                    res.end(JSON.stringify({ success: false, error: 'Student account not found.' }));
                    return;
                }

                const currentClassKey = gradeToClassKey(account.classKey || account.grade);
                const requestedClassKey = gradeToClassKey(payload.requestedClass || payload.classKey);
                if (currentClassKey === requestedClassKey) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ success: false, error: 'You are already enrolled in this class.' }));
                    return;
                }

                const lock = state.sectionLocks?.[requestedClassKey];
                if (lock && lock.locked) {
                    res.statusCode = 403;
                    res.end(JSON.stringify({ success: false, error: lock.reason || 'Requested class is currently locked.' }));
                    return;
                }

                // Mark any prior pending request from this student as superseded or prevent duplicate
                const existingPending = (roster.classSwitchRequests || []).find(
                    r => canonicalizeEmail(r.email) === canonical && r.status === 'pending' && r.requestedClassKey === requestedClassKey
                );
                if (existingPending) {
                    res.statusCode = 200;
                    res.end(JSON.stringify({
                        success: true,
                        alreadyPending: true,
                        request: existingPending,
                        message: 'You already have a pending switch request for this class.'
                    }));
                    return;
                }

                const newReq = {
                    id: 'csr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                    userId: account.userId || deriveStableUserId(canonical),
                    studentName: account.name || user.name || 'Student',
                    email: account.email,
                    canonicalEmail: canonical,
                    currentClassKey,
                    currentGrade: normalizeGradeName(currentClassKey),
                    requestedClassKey,
                    requestedGrade: normalizeGradeName(requestedClassKey),
                    reason: String(payload.reason || '').trim(),
                    status: 'pending',
                    adminNote: '',
                    submittedAt: new Date().toISOString(),
                    reviewedAt: ''
                };

                appendAccountAuditEntry(account, {
                    actor: `${account.name} (Student)`,
                    action: 'CLASS_SWITCH_REQUESTED',
                    details: `Requested switch from ${newReq.currentGrade} to ${newReq.requestedGrade}`
                });
                appendRosterAuditEntry(roster, {
                    userId: account.userId,
                    email: account.email,
                    actor: `${account.name} (Student)`,
                    action: 'CLASS_SWITCH_REQUESTED',
                    details: `Requested switch from ${newReq.currentGrade} to ${newReq.requestedGrade}`
                });

                roster.classSwitchRequests = [newReq, ...(roster.classSwitchRequests || [])];
                writeRoster(roster);

                res.statusCode = 200;
                res.end(JSON.stringify({
                    success: true,
                    message: 'Class switch request submitted for admin approval.',
                    request: newReq
                }));
                return;
            }

            // 1. SIGN IN (matches canonical verified email, never creates duplicate accounts)
            if (payload.action === 'SIGN_IN') {
                const rawEmail = String(payload.email || '').trim().toLowerCase();
                const enteredPass = String(payload.password || payload.passkey || '');
                if (!rawEmail || !isValidEmailFormat(rawEmail)) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ success: false, error: 'Please enter a valid email address.' }));
                    return;
                }
                if (!enteredPass) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ success: false, error: 'Please enter your password.' }));
                    return;
                }
                const canonical = canonicalizeEmail(rawEmail);
                const account = roster.accounts.find(a => a.canonicalEmail === canonical);
                if (!account) {
                    res.statusCode = 404;
                    res.end(JSON.stringify({
                        success: false,
                        code: 'ACCOUNT_NOT_FOUND',
                        error: 'No account found for this email. Please create an account.'
                    }));
                    return;
                }
                if (account.emailVerified === false) {
                    res.statusCode = 403;
                    res.end(JSON.stringify({
                        success: false,
                        code: 'EMAIL_NOT_VERIFIED',
                        error: 'Your email address is not verified yet. Please complete email verification first.'
                    }));
                    return;
                }
                if (account.accountStatus === 'suspended') {
                    res.statusCode = 403;
                    res.end(JSON.stringify({
                        success: false,
                        code: 'ACCOUNT_SUSPENDED',
                        error: 'Your account has been suspended by an administrator. Please contact BPG EDUCARE support.'
                    }));
                    return;
                }
                const expectedPass = account.passkey || '';
                if (!verifyPassword(enteredPass, expectedPass)) {
                    res.statusCode = 401;
                    res.end(JSON.stringify({
                        success: false,
                        code: 'INVALID_PASSWORD',
                        error: 'Incorrect password. Please try again or reset your password.'
                    }));
                    return;
                }
                const sessionToken = issueStudentSessionToken(account);
                const mySwitchRequests = (roster.classSwitchRequests || []).filter(
                    r => (r.userId && r.userId === account.userId) || canonicalizeEmail(r.email) === canonical
                );
                const myPayments = (Array.isArray(state.payments) ? state.payments : []).filter(
                    p => (p.userId && p.userId === account.userId) || canonicalizeEmail(p.email) === canonical
                );
                res.statusCode = 200;
                res.end(JSON.stringify({
                    success: true,
                    sessionToken,
                    user: stripSensitiveAccountFields(account),
                    mySwitchRequests,
                    myPayments
                }));
                return;
            }

            // 2. REGISTER_STUDENT / newAccount (Admin-only! Students MUST verify via /api/verify-otp or Google OAuth)
            if (payload.action === 'REGISTER_STUDENT' || payload.newAccount) {
                if (!isAdmin) {
                    res.statusCode = 403;
                    res.end(JSON.stringify({
                        success: false,
                        code: 'VERIFICATION_REQUIRED',
                        error: 'Direct registration is disabled. Please verify your email with a 6-digit OTP or sign in with Google.'
                    }));
                    return;
                }
                const student = payload.student || payload.newAccount || {};
                const rawEmail = String(student.email || '').trim().toLowerCase();
                const name = String(student.name || 'Student').trim();
                const grade = normalizeGradeName(student.grade || student.classKey);
                const classKey = gradeToClassKey(grade);
                const requestedPlan = isAdmin ? normalizePlan(student.plan || 'free') : 'free';

                if (!rawEmail || !isValidEmailFormat(rawEmail)) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ success: false, error: 'Please provide a valid email address.' }));
                    return;
                }

                const canonical = canonicalizeEmail(rawEmail);
                const existing = roster.accounts.find(a => a.canonicalEmail === canonical);

                if (existing) {
                    res.statusCode = 409;
                    res.end(JSON.stringify({
                        success: false,
                        code: 'EMAIL_EXISTS',
                        existingEmail: existing.email,
                        canonicalEmail: canonical,
                        error: 'An account already exists for this Gmail address. Please sign in or reset your password.'
                    }));
                    return;
                }

                const nowIso = new Date().toISOString();
                const created = {
                    userId: deriveStableUserId(canonical),
                    name,
                    email: rawEmail,
                    canonicalEmail: canonical,
                    grade,
                    classKey,
                    plan: requestedPlan,
                    planExplicitlySet: isAdmin && requestedPlan !== 'free',
                    legacyAccess: false,
                    accountStatus: 'active',
                    paymentStatus: requestedPlan !== 'free' ? 'paid' : 'none',
                    passkey: String(student.password || student.passkey || 'bpgstudent'),
                    joinedAt: nowIso.split('T')[0],
                    updatedAt: nowIso,
                    lastModifiedBy: 'Admin Console',
                    auditLog: []
                };
                appendAccountAuditEntry(created, {
                    actor: 'Admin Console',
                    action: 'ADMIN_CREATED_STUDENT',
                    details: `Created student in ${grade} with ${requestedPlan.toUpperCase()} plan`
                });
                appendRosterAuditEntry(roster, {
                    userId: created.userId,
                    email: created.email,
                    actor: 'Admin Console',
                    action: 'ADMIN_CREATED_STUDENT',
                    details: `Added ${created.name} (${grade} · ${requestedPlan.toUpperCase()})`
                });

                roster.accounts.unshift(created);
                const updatedRoster = writeRoster(roster);
                const sessionToken = issueStudentSessionToken(created);

                res.statusCode = 200;
                res.end(JSON.stringify({
                    success: true,
                    message: 'Account created.',
                    sessionToken,
                    user: stripSensitiveAccountFields(created),
                    data: {
                        revision: Number(updatedRoster.revision) || 0,
                        lastUpdated: updatedRoster.lastUpdated,
                        duplicateGroups: updatedRoster.duplicateGroups || [],
                        classSwitchRequests: updatedRoster.classSwitchRequests || [],
                        auditLog: updatedRoster.auditLog || [],
                        accounts: updatedRoster.accounts.map(stripSensitiveAccountFields)
                    }
                }));
                return;
            }

            // 3. ADMIN-ONLY MUTATIONS (Server-enforced admin permission + audit log of who changed plan/access & when)
            if (!isAdmin) {
                res.statusCode = 401;
                res.end(JSON.stringify({ success: false, error: 'Unauthorized: Admin passkey required.' }));
                return;
            }

            const adminActor = String(payload.adminActor || req.headers['x-admin-actor'] || 'Admin Console').trim();

            if (payload.action === 'UPDATE_CLASS' || payload.action === 'UPDATE_STUDENT_CLASS') {
                const targetEmail = String(payload.email || payload.accountEmail || '').trim().toLowerCase();
                const targetCanonical = canonicalizeEmail(targetEmail);
                const newGrade = normalizeGradeName(payload.grade || payload.newGrade);
                const classKey = gradeToClassKey(newGrade);
                const acc = roster.accounts.find(a => a.userId === payload.userId || a.email === targetEmail || a.canonicalEmail === targetCanonical);
                if (acc) {
                    const prevGrade = acc.grade;
                    acc.grade = newGrade;
                    acc.classKey = classKey;
                    appendAccountAuditEntry(acc, {
                        actor: adminActor,
                        action: 'ADMIN_CLASS_CHANGE',
                        details: `Changed class from ${prevGrade} to ${newGrade}`
                    });
                    appendRosterAuditEntry(roster, {
                        userId: acc.userId,
                        email: acc.email,
                        actor: adminActor,
                        action: 'ADMIN_CLASS_CHANGE',
                        details: `${acc.name}: class changed from ${prevGrade} to ${newGrade}`
                    });
                }
            } else if (payload.action === 'UPDATE_PLAN' || payload.action === 'UPDATE_STUDENT_PLAN') {
                const targetEmail = String(payload.email || payload.accountEmail || '').trim().toLowerCase();
                const targetCanonical = canonicalizeEmail(targetEmail);
                const newPlan = normalizePlan(payload.plan || payload.newPlan || 'free');
                const acc = roster.accounts.find(a => a.userId === payload.userId || a.email === targetEmail || a.canonicalEmail === targetCanonical);
                if (acc) {
                    const prevPlan = acc.plan;
                    acc.plan = newPlan;
                    acc.planExplicitlySet = true;
                    acc.legacyAccess = false;
                    acc.paymentStatus = newPlan !== 'free' ? 'paid' : (acc.paymentStatus === 'paid' ? 'none' : acc.paymentStatus);
                    appendAccountAuditEntry(acc, {
                        actor: adminActor,
                        action: 'ADMIN_PLAN_CHANGE',
                        details: `Changed plan from ${String(prevPlan).toUpperCase()} to ${newPlan.toUpperCase()}`
                    });
                    appendRosterAuditEntry(roster, {
                        userId: acc.userId,
                        email: acc.email,
                        actor: adminActor,
                        action: 'ADMIN_PLAN_CHANGE',
                        details: `${acc.name}: plan changed from ${String(prevPlan).toUpperCase()} to ${newPlan.toUpperCase()}`
                    });
                }
            } else if (payload.action === 'UPDATE_ACCOUNT_STATUS') {
                const targetEmail = String(payload.email || payload.accountEmail || '').trim().toLowerCase();
                const targetCanonical = canonicalizeEmail(targetEmail);
                const nextStatus = normalizeAccountStatus({ accountStatus: payload.accountStatus });
                const acc = roster.accounts.find(a => a.userId === payload.userId || a.email === targetEmail || a.canonicalEmail === targetCanonical);
                if (acc) {
                    const prevStatus = acc.accountStatus || 'active';
                    acc.accountStatus = nextStatus;
                    appendAccountAuditEntry(acc, {
                        actor: adminActor,
                        action: 'ADMIN_STATUS_CHANGE',
                        details: `Account status changed from ${prevStatus} to ${nextStatus}`
                    });
                    appendRosterAuditEntry(roster, {
                        userId: acc.userId,
                        email: acc.email,
                        actor: adminActor,
                        action: 'ADMIN_STATUS_CHANGE',
                        details: `${acc.name}: status changed from ${prevStatus} to ${nextStatus}`
                    });
                }
            } else if (payload.action === 'DELETE_STUDENT') {
                const targetEmail = String(payload.email || payload.accountEmail || '').trim().toLowerCase();
                const targetCanonical = canonicalizeEmail(targetEmail);
                const removed = roster.accounts.find(a => a.email === targetEmail || a.canonicalEmail === targetCanonical);
                roster.accounts = roster.accounts.filter(a => {
                    const aEmail = String(a.email || '').trim().toLowerCase();
                    return aEmail !== targetEmail && a.canonicalEmail !== targetCanonical;
                });
                if (removed) {
                    appendRosterAuditEntry(roster, {
                        userId: removed.userId,
                        email: removed.email,
                        actor: adminActor,
                        action: 'ADMIN_DELETED_STUDENT',
                        details: `Deleted student account ${removed.name} (${removed.email})`
                    });
                }
            } else if (payload.action === 'DELETE_ALL_STUDENTS') {
                const count = roster.accounts.length;
                roster.accounts = [];
                roster.duplicateGroups = [];
                appendRosterAuditEntry(roster, {
                    actor: adminActor,
                    action: 'ADMIN_DELETED_ALL_STUDENTS',
                    details: `Cleared all ${count} student accounts`
                });
            } else if (payload.action === 'APPROVE_CLASS_SWITCH' || payload.action === 'REJECT_CLASS_SWITCH') {
                const reqId = String(payload.requestId || '').trim();
                const adminNote = String(payload.adminNote || '').trim();
                const reqItem = (roster.classSwitchRequests || []).find(r => r.id === reqId);
                if (!reqItem) {
                    res.statusCode = 404;
                    res.end(JSON.stringify({ success: false, error: 'Class switch request not found.' }));
                    return;
                }
                const isApprove = payload.action === 'APPROVE_CLASS_SWITCH';
                reqItem.status = isApprove ? 'approved' : 'rejected';
                reqItem.adminNote = adminNote;
                reqItem.reviewedAt = new Date().toISOString();
                reqItem.reviewedBy = adminActor;

                const canonical = canonicalizeEmail(reqItem.email);
                const acc = roster.accounts.find(a => (reqItem.userId && a.userId === reqItem.userId) || a.canonicalEmail === canonical);

                if (isApprove) {
                    if (acc) {
                        const prevGrade = acc.grade;
                        acc.classKey = gradeToClassKey(reqItem.requestedClassKey);
                        acc.grade = normalizeGradeName(reqItem.requestedClassKey);
                        appendAccountAuditEntry(acc, {
                            actor: adminActor,
                            action: 'CLASS_SWITCH_APPROVED',
                            details: `Approved class switch from ${prevGrade} to ${acc.grade}${adminNote ? ` (${adminNote})` : ''}`
                        });
                        appendRosterAuditEntry(roster, {
                            userId: acc.userId,
                            email: acc.email,
                            actor: adminActor,
                            action: 'CLASS_SWITCH_APPROVED',
                            details: `${acc.name}: switch approved ${prevGrade} -> ${acc.grade}`
                        });
                    }
                    // Supersede any other older pending requests from this same student
                    (roster.classSwitchRequests || []).forEach(other => {
                        if (other.id !== reqItem.id && canonicalizeEmail(other.email) === canonical && other.status === 'pending') {
                            other.status = 'rejected';
                            other.adminNote = 'Superseded by another approved class switch.';
                            other.reviewedAt = new Date().toISOString();
                        }
                    });
                } else if (acc) {
                    appendAccountAuditEntry(acc, {
                        actor: adminActor,
                        action: 'CLASS_SWITCH_REJECTED',
                        details: `Rejected class switch to ${reqItem.requestedGrade}${adminNote ? ` (${adminNote})` : ''}`
                    });
                    appendRosterAuditEntry(roster, {
                        userId: acc.userId,
                        email: acc.email,
                        actor: adminActor,
                        action: 'CLASS_SWITCH_REJECTED',
                        details: `${acc.name}: switch to ${reqItem.requestedGrade} rejected`
                    });
                }
            }

            const saved = writeRoster(roster);
            res.statusCode = 200;
            res.end(JSON.stringify({
                success: true,
                message: 'Changes saved.',
                data: {
                    revision: Number(saved.revision) || 0,
                    lastUpdated: saved.lastUpdated,
                    duplicateGroups: saved.duplicateGroups || [],
                    classSwitchRequests: saved.classSwitchRequests || [],
                    auditLog: saved.auditLog || [],
                    accounts: saved.accounts.map(stripSensitiveAccountFields)
                }
            }));
        } catch (err) {
            console.error('[API /api/student-roster] Write error:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({ success: false, error: err.message }));
        }
        return;
    }

    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
};
