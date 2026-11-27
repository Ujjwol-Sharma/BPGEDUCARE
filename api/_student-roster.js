/**
 * BPG Academy — Student Roster, Gmail Uniqueness & Plan Management API (/api/student-roster)
 */

const crypto = require('crypto');
const {
    canonicalizeEmail,
    normalizeUsername,
    isValidUsernameFormat,
    isValidEmailFormat,
    hashPassword,
    verifyPassword,
    normalizePlan,
    gradeToClassKey,
    normalizeGradeName,
    isAdminPasskeyValid,
    issueStudentSessionToken,
    buildSessionCookieHeader,
    buildClearSessionCookieHeader,
    parseUserAgentDeviceInfo,
    generateSessionId,
    getClientIp,
    checkRateLimit,
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
            const wantStudentDetail = isAdmin && parsedUrl.searchParams.get('studentDetail') === '1';

            if (wantStudentDetail) {
                const targetUserId = String(parsedUrl.searchParams.get('userId') || '').trim();
                const targetEmail = String(parsedUrl.searchParams.get('email') || '').trim().toLowerCase();
                const targetCanon = targetEmail ? canonicalizeEmail(targetEmail) : '';
                const acc = (roster.accounts || []).find(
                    a => (targetUserId && a.userId === targetUserId) || (targetCanon && a.canonicalEmail === targetCanon)
                );
                if (!acc) {
                    res.statusCode = 404;
                    res.end(JSON.stringify({ success: false, error: 'Student account not found.' }));
                    return;
                }
                const state = readAcademyState();
                const { formatNepalTime } = require('./_access-control');
                const fs = require('fs');
                const path = require('path');
                const os = require('os');
                let attempts = [];
                if (global.__BPG_MOCK_ATTEMPTS__ && Array.isArray(global.__BPG_MOCK_ATTEMPTS__.attempts)) {
                    attempts = global.__BPG_MOCK_ATTEMPTS__.attempts;
                } else {
                    for (const p of [path.join(os.tmpdir(), 'bpg-mock-attempts.json'), path.join(__dirname, '..', 'data', 'mock-attempts.json')]) {
                        try {
                            if (fs.existsSync(p)) {
                                const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
                                if (Array.isArray(parsed.attempts)) { attempts = parsed.attempts; break; }
                            }
                        } catch (e) {}
                    }
                }
                const testById = new Map((state.mockTests || []).map(t => [t.id, t]));
                const studentAttempts = attempts
                    .filter(a => a && ((acc.userId && a.userId === acc.userId) || canonicalizeEmail(a.email || a.canonicalEmail) === acc.canonicalEmail))
                    .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))
                    .map(a => {
                        const t = testById.get(a.testId);
                        const isSubmitted = Boolean(a.submitted);
                        const marksEarned = a.result?.score ?? 0;
                        const totalMarks = a.result?.total ?? (t?.questions?.length || 0);
                        return {
                            attemptId: a.id,
                            testId: a.testId,
                            testTitle: t?.title || 'Mock Test',
                            classKey: t?.classKey || a.classKey || '',
                            submitted: isSubmitted,
                            status: isSubmitted ? 'submitted' : 'in_progress',
                            score: marksEarned,
                            total: totalMarks,
                            marksEarned,
                            totalMarks,
                            correctCount: a.result?.correctCount ?? marksEarned,
                            wrongCount: a.result?.wrongCount ?? 0,
                            skippedCount: a.result?.skippedCount ?? Math.max(0, totalMarks - marksEarned),
                            percentage: a.result?.percentage ?? 0,
                            submittedAt: a.submittedAt || '',
                            submittedAtNpt: a.submittedAt ? formatNepalTime(a.submittedAt) : 'In Progress'
                        };
                    });
                const studentPayments = (state.payments || []).filter(
                    p => (acc.userId && p.userId === acc.userId) || canonicalizeEmail(p.email) === acc.canonicalEmail
                );
                const safeAccount = stripSensitiveAccountFields(acc);
                res.statusCode = 200;
                res.end(JSON.stringify({
                    success: true,
                    account: safeAccount,
                    student: safeAccount,
                    attempts: studentAttempts,
                    mockAttempts: studentAttempts,
                    payments: studentPayments
                }));
                return;
            }

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
            let sessionReplaced = false;
            let sessionRevokedError = '';
            let slidingSessionToken = '';
            let liveRoster = roster;
            if (!isAdmin) {
                let status = resolveRequestUserStatus(req);
                if (status.needsFreshCheck) {
                    await ensureDurableStoreHydrated({ TMP_DB_PATH, TMP_ROSTER_PATH, DB_PATH, ROSTER_PATH, force: true });
                    liveRoster = readRoster();
                    status = resolveRequestUserStatus(req);
                }
                me = status.user;
                sessionReplaced = status.reason === 'session_replaced';
                sessionRevokedError = status.error || '';
                sessionRevoked = Boolean(status.revoked || (status.needsFreshCheck && isDurableHydrationAuthoritative()));

                if (me && status.verified && status.verified.keepSignedIn !== false) {
                    const tokenAgeMs = Date.now() - Number(status.verified.issuedAt || 0);
                    // Sliding 30-day session extension when active (> 24 hours since last token issuance)
                    if (tokenAgeMs > 24 * 60 * 60 * 1000) {
                        slidingSessionToken = issueStudentSessionToken(me, {
                            keepSignedIn: true,
                            sessionId: me.activeSessionId || status.verified.sid || ''
                        });
                        res.setHeader('Set-Cookie', buildSessionCookieHeader(slidingSessionToken, true, req));
                    }
                }
                if (sessionRevoked) {
                    res.setHeader('Set-Cookie', buildClearSessionCookieHeader(req));
                }
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
                    authenticated: Boolean(me),
                    rosterRevision: Number(liveRoster.revision) || 0,
                    account: me ? stripSensitiveAccountFields(me) : null,
                    sessionToken: slidingSessionToken || undefined,
                    sessionRevoked,
                    sessionReplaced,
                    code: sessionReplaced ? 'SESSION_REPLACED' : undefined,
                    error: sessionReplaced ? (sessionRevokedError || 'You were signed out because your account logged in on another device.') : undefined,
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

            // 0-OUT. SIGN OUT (revokes server activeSessionId & clears HttpOnly session cookie)
            if (payload.action === 'SIGN_OUT') {
                const user = resolveRequestUser(req);
                if (user && user.email) {
                    const canonical = canonicalizeEmail(user.email);
                    const acc = roster.accounts.find(a => a.userId === user.userId || a.canonicalEmail === canonical);
                    if (acc) {
                        acc.activeSessionId = 'revoked_' + generateSessionId();
                        writeRoster(roster);
                    }
                }
                res.setHeader('Set-Cookie', buildClearSessionCookieHeader(req));
                res.statusCode = 200;
                res.end(JSON.stringify({ success: true, message: 'Signed out cleanly.' }));
                return;
            }

            // 0. GOOGLE SIGN-IN / ACCOUNT LINKING (Requires verified Google OAuth token when Google Client ID is configured)
            if (payload.action === 'GOOGLE_SIGN_IN') {
                const configuredClientId = String(state.siteSettings?.googleClientId || process.env.GOOGLE_CLIENT_ID || '').trim();
                let googleProfile = null;

                if (!configuredClientId) {
                    res.statusCode = 403;
                    res.end(JSON.stringify({
                        success: false,
                        code: 'GOOGLE_OAUTH_NOT_CONFIGURED',
                        error: 'Google Sign-In is not currently configured. Please sign in with your Email/Username and Password or 6-digit Gmail code.'
                    }));
                    return;
                }

                if (payload.accessToken || payload.idToken) {
                    googleProfile = payload.accessToken
                        ? await verifyGoogleAccessToken(payload.accessToken, configuredClientId)
                        : await verifyGoogleIdToken(payload.idToken, configuredClientId);
                    if (!googleProfile) {
                        res.statusCode = 401;
                        res.end(JSON.stringify({ success: false, error: 'Invalid, unverified, or expired Google Sign-In token.' }));
                        return;
                    }
                } else {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ success: false, error: 'Verified Google OAuth token is required.' }));
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
                        hasPassword: false,
                        googleLinked: true,
                        googleSub: googleProfile.googleSub || ('gsub_' + crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16)),
                        avatarUrl: googleProfile.avatarUrl || '',
                        passkey: hashPassword('google-oauth-' + Date.now() + '-' + Math.random()),
                        readNotificationIds: [],
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

                const keepSignedIn = payload.keepSignedIn !== false;
                const newSessionId = generateSessionId();
                const nowLoginIso = new Date().toISOString();
                const deviceInfo = parseUserAgentDeviceInfo(req);
                const liveIdx = roster.accounts.findIndex(a => a.userId === account.userId || a.canonicalEmail === canonical);
                if (liveIdx >= 0) {
                    roster.accounts[liveIdx].activeSessionId = newSessionId;
                    roster.accounts[liveIdx].lastLoginAt = nowLoginIso;
                    roster.accounts[liveIdx].lastActiveAt = nowLoginIso;
                    roster.accounts[liveIdx].deviceInfo = deviceInfo;
                    const savedAfterSession = writeRoster(roster);
                    account = savedAfterSession.accounts.find(a => a.userId === account.userId || a.canonicalEmail === canonical) || account;
                }
                const sessionToken = issueStudentSessionToken(account, { keepSignedIn, sessionId: newSessionId });
                res.setHeader('Set-Cookie', buildSessionCookieHeader(sessionToken, keepSignedIn, req));
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
                    keepSignedIn,
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

            // 0c. MARK NOTIFICATIONS READ (Persists per-account read status across devices and sessions)
            if (payload.action === 'MARK_NOTIFICATIONS_READ') {
                const user = resolveRequestUser(req);
                if (!user || !user.email) {
                    res.statusCode = 401;
                    res.end(JSON.stringify({ success: false, error: 'Please sign in to save notification status.' }));
                    return;
                }
                const canonical = canonicalizeEmail(user.email);
                const account = roster.accounts.find(a => a.userId === user.userId || a.canonicalEmail === canonical);
                if (!account) {
                    res.statusCode = 404;
                    res.end(JSON.stringify({ success: false, error: 'Student account not found.' }));
                    return;
                }
                const incomingIds = Array.isArray(payload.notificationIds)
                    ? payload.notificationIds.map(x => String(x || '').trim()).filter(Boolean)
                    : [];
                const existingSet = new Set(Array.isArray(account.readNotificationIds) ? account.readNotificationIds : []);
                incomingIds.forEach(id => existingSet.add(id));
                if (payload.markAll) {
                    const userClass = gradeToClassKey(account.classKey || account.grade);
                    (Array.isArray(state.notifications) ? state.notifications : []).forEach(n => {
                        if (n && n.id && n.published !== false && (!n.scope || n.scope === 'sitewide' || n.scope === userClass)) {
                            existingSet.add(String(n.id));
                        }
                    });
                }
                account.readNotificationIds = Array.from(existingSet).slice(-250);
                writeRoster(roster);
                res.statusCode = 200;
                res.end(JSON.stringify({
                    success: true,
                    readNotificationIds: account.readNotificationIds
                }));
                return;
            }

            // 1. SIGN IN (Supports single "Email or Username" input OR legacy username+email; rate-limited; sets persistent HttpOnly cookie & single-device session)
            if (payload.action === 'SIGN_IN') {
                const rawIdentifier = String(payload.identifier || payload.email || payload.username || '').trim();
                const rawEmail = String(payload.email || (rawIdentifier.includes('@') ? rawIdentifier : '')).trim().toLowerCase();
                const rawUsername = String(payload.username || (!rawIdentifier.includes('@') ? rawIdentifier : '')).trim();
                const normUsername = normalizeUsername(rawUsername);
                const enteredPass = String(payload.password || payload.passkey || '');
                const keepSignedIn = payload.keepSignedIn !== false;

                if (!rawIdentifier) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ success: false, code: 'MISSING_IDENTIFIER', error: 'Please enter your email address or username.' }));
                    return;
                }
                if (!enteredPass) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ success: false, code: 'MISSING_PASSWORD', error: 'Please enter your password.' }));
                    return;
                }

                // Brute-force protection: 5 wrong attempts -> 10-minute cooldown
                const clientIp = getClientIp(req);
                const idKey = rawEmail ? canonicalizeEmail(rawEmail) : normUsername;
                const failBucketKey = `signin_fail:${clientIp}:${idKey}`;
                const existingFailEntry = require('./_access-control').getOtpStoreEntry(`rl:${failBucketKey}`);
                if (existingFailEntry && existingFailEntry.count >= 5 && Date.now() < existingFailEntry.resetAt) {
                    const retrySec = Math.max(1, Math.ceil((existingFailEntry.resetAt - Date.now()) / 1000));
                    const mins = Math.ceil(retrySec / 60);
                    res.statusCode = 429;
                    res.end(JSON.stringify({
                        success: false,
                        code: 'RATE_LIMITED',
                        retryAfterSeconds: retrySec,
                        error: `Too many failed sign-in attempts. Please wait ${mins} minute${mins === 1 ? '' : 's'} or use Reset Password.`
                    }));
                    return;
                }

                const canonical = rawEmail ? canonicalizeEmail(rawEmail) : '';
                let account = null;
                if (canonical) {
                    account = roster.accounts.find(a => a.canonicalEmail === canonical) || null;
                }
                if (!account && normUsername) {
                    const noDots = normUsername.replace(/\./g, '');
                    account = roster.accounts.find(a => {
                        const accU = normalizeUsername(a.username || (a.email ? a.email.split('@')[0] : ''));
                        const accNoDots = accU.replace(/\./g, '');
                        return accU === normUsername || (noDots && accNoDots === noDots);
                    }) || null;
                }

                if (!account) {
                    checkRateLimit(failBucketKey, 5, 10 * 60 * 1000);
                    console.info('[BPG Auth SIGN_IN] rejected', { reason: 'account_not_found' });
                    res.statusCode = 401;
                    res.end(JSON.stringify({
                        success: false,
                        code: 'ACCOUNT_NOT_FOUND',
                        error: 'No account found with this email/username. Want to Create Account?'
                    }));
                    return;
                }
                if (account.accountStatus === 'suspended') {
                    console.info('[BPG Auth SIGN_IN] rejected', { reason: 'account_suspended', userId: account.userId });
                    res.statusCode = 403;
                    res.end(JSON.stringify({
                        success: false,
                        code: 'ACCOUNT_SUSPENDED',
                        error: 'Your account has been suspended by an administrator. Please contact BPG EDUCARE support.'
                    }));
                    return;
                }
                if (account.emailVerified === false) {
                    console.info('[BPG Auth SIGN_IN] rejected', { reason: 'email_not_verified', userId: account.userId });
                    res.statusCode = 403;
                    res.end(JSON.stringify({
                        success: false,
                        code: 'EMAIL_NOT_VERIFIED',
                        error: 'Your Gmail address is not verified yet. Use "Sign in with Gmail code" to verify your Gmail and open your account.'
                    }));
                    return;
                }

                // Verify password (supports scrypt + legacy plaintext with transparent upgrade on success; never logs password)
                const expectedPass = account.passkey || '';
                if (!verifyPassword(enteredPass, expectedPass)) {
                    const rl = checkRateLimit(failBucketKey, 5, 10 * 60 * 1000);
                    const isGoogleOnly = account.hasPassword === false && Boolean(account.googleLinked);
                    console.info('[BPG Auth SIGN_IN] rejected', {
                        reason: isGoogleOnly ? 'google_only_no_password_set' : 'password_mismatch',
                        userId: account.userId
                    });
                    if (!rl.allowed) {
                        const mins = Math.ceil((rl.retryAfterSeconds || 600) / 60);
                        res.statusCode = 429;
                        res.end(JSON.stringify({
                            success: false,
                            code: 'RATE_LIMITED',
                            retryAfterSeconds: rl.retryAfterSeconds,
                            error: `Too many failed sign-in attempts. Please wait ${mins} minute${mins === 1 ? '' : 's'} or use Reset Password.`
                        }));
                        return;
                    }
                    res.statusCode = 401;
                    res.end(JSON.stringify({
                        success: false,
                        code: isGoogleOnly ? 'GOOGLE_ACCOUNT_NO_PASSWORD' : 'WRONG_PASSWORD',
                        error: isGoogleOnly
                            ? "This account was created with Google Sign-In and doesn't have a password set yet. Click Forgot password? or Sign in with Gmail code."
                            : 'Incorrect password. Forgot it? Use Reset Password or Email Code.'
                    }));
                    return;
                }

                // Backward compatibility: if both email AND a distinct username were explicitly provided by older clients, verify they match
                const accountCanon = account.canonicalEmail || canonicalizeEmail(account.email);
                if (payload.email && payload.username && rawUsername && rawEmail) {
                    const emailLocal = account.email ? account.email.split('@')[0] : '';
                    const canonicalLocal = accountCanon.split('@')[0] || '';
                    const accountUsername = normalizeUsername(account.username || emailLocal);
                    const accountUsernameNoDots = accountUsername.replace(/\./g, '');
                    const enteredNoDots = normUsername.replace(/\./g, '');
                    const enteredIsOwnEmail = rawUsername.includes('@') && canonicalizeEmail(rawUsername) === accountCanon;
                    const isAutoGeneratedUsername = accountUsername === normalizeUsername(emailLocal);
                    const accountDisplayNorm = normalizeUsername(account.name || '');
                    const matchesSavedUsername = Boolean(
                        (normUsername && normUsername === accountUsername) ||
                        (enteredNoDots && (enteredNoDots === accountUsernameNoDots || enteredNoDots === canonicalLocal)) ||
                        enteredIsOwnEmail ||
                        (isAutoGeneratedUsername && normUsername && accountDisplayNorm && normUsername === accountDisplayNorm)
                    );
                    if (!matchesSavedUsername) {
                        checkRateLimit(failBucketKey, 5, 10 * 60 * 1000);
                        console.info('[BPG Auth SIGN_IN] rejected', { reason: 'username_mismatch', userId: account.userId });
                        res.statusCode = 401;
                        res.end(JSON.stringify({
                            success: false,
                            code: 'INVALID_CREDENTIALS',
                            error: 'Username does not match this Gmail account. Try signing in with your Email or Username only.'
                        }));
                        return;
                    }
                }

                // Clear failed login counter on success
                require('./_access-control').deleteOtpStoreEntry(`rl:${failBucketKey}`);

                // Transparently upgrade any legacy plaintext password to scrypt$ + update device/session tracking
                const newSessionId = generateSessionId();
                const nowLoginIso = new Date().toISOString();
                if (!String(account.passkey || '').startsWith('scrypt$')) {
                    account.passkey = hashPassword(enteredPass);
                    account.hasPassword = true;
                }
                account.activeSessionId = newSessionId;
                account.lastLoginAt = nowLoginIso;
                account.lastActiveAt = nowLoginIso;
                account.deviceInfo = parseUserAgentDeviceInfo(req);
                const savedRoster = writeRoster(roster);
                const freshAccount = savedRoster.accounts.find(a => a.userId === account.userId || a.canonicalEmail === accountCanon) || account;

                const sessionToken = issueStudentSessionToken(freshAccount, { keepSignedIn, sessionId: newSessionId });
                res.setHeader('Set-Cookie', buildSessionCookieHeader(sessionToken, keepSignedIn, req));
                const mySwitchRequests = (savedRoster.classSwitchRequests || []).filter(
                    r => (r.userId && r.userId === freshAccount.userId) || canonicalizeEmail(r.email) === accountCanon
                );
                const myPayments = (Array.isArray(state.payments) ? state.payments : []).filter(
                    p => (p.userId && p.userId === freshAccount.userId) || canonicalizeEmail(p.email) === accountCanon
                );
                console.info('[BPG Auth SIGN_IN] success', { userId: freshAccount.userId, plan: freshAccount.plan, device: freshAccount.deviceInfo });
                res.statusCode = 200;
                res.end(JSON.stringify({
                    success: true,
                    sessionToken,
                    keepSignedIn,
                    user: stripSensitiveAccountFields(freshAccount),
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
                const requestedUsername = normalizeUsername(student.username || '');
                const created = {
                    userId: deriveStableUserId(canonical),
                    name,
                    username: isValidUsernameFormat(requestedUsername) ? requestedUsername : normalizeUsername(rawEmail.split('@')[0]),
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
