/**
 * BPG Academy — Student Roster, Gmail Uniqueness & Plan Management API (/api/student-roster)
 */

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

            const me = isAdmin ? null : resolveRequestUser(req);

            if (checkMe && !isAdmin) {
                const mySwitchRequests = me
                    ? (roster.classSwitchRequests || []).filter(r => canonicalizeEmail(r.email) === canonicalizeEmail(me.email))
                    : [];
                res.statusCode = 200;
                res.end(JSON.stringify({
                    success: true,
                    account: me ? stripSensitiveAccountFields(me) : null,
                    mySwitchRequests
                }));
                return;
            }

            res.statusCode = 200;
            res.end(JSON.stringify({
                success: true,
                data: {
                    lastUpdated: roster.lastUpdated,
                    duplicateGroups: isAdmin ? (roster.duplicateGroups || []) : [],
                    classSwitchRequests: isAdmin ? (roster.classSwitchRequests || []) : [],
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

            // 0. GOOGLE SIGN-IN / ACCOUNT LINKING (requires official Google OAuth ID token)
            if (payload.action === 'GOOGLE_SIGN_IN') {
                const configuredClientId = String(state.siteSettings?.googleClientId || process.env.GOOGLE_CLIENT_ID || '').trim();
                if (!configuredClientId) {
                    res.statusCode = 503;
                    res.end(JSON.stringify({
                        success: false,
                        code: 'GOOGLE_OAUTH_NOT_CONFIGURED',
                        error: 'Google Sign-In is not configured on this server yet. Please set GOOGLE_CLIENT_ID in .env or Admin Settings, or register with Email OTP.'
                    }));
                    return;
                }

                if (!payload.idToken && !payload.accessToken) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ success: false, error: 'Official Google OAuth token is required.' }));
                    return;
                }

                const googleProfile = payload.accessToken
                    ? await verifyGoogleAccessToken(payload.accessToken, configuredClientId)
                    : await verifyGoogleIdToken(payload.idToken, configuredClientId);
                if (!googleProfile) {
                    res.statusCode = 401;
                    res.end(JSON.stringify({ success: false, error: 'Invalid, unverified, or expired Google Sign-In token.' }));
                    return;
                }

                const canonical = canonicalizeEmail(googleProfile.email);
                let account = roster.accounts.find(a => a.canonicalEmail === canonical);
                let linkedExisting = false;

                if (account) {
                    // Preserve existing profile, class access, and subscription plan!
                    linkedExisting = true;
                    account.googleLinked = true;
                    account.emailVerified = true;
                    if (!account.verifiedAt) account.verifiedAt = new Date().toISOString();
                    if (googleProfile.googleSub) account.googleSub = googleProfile.googleSub;
                    if (googleProfile.avatarUrl) account.avatarUrl = googleProfile.avatarUrl;
                    if (!account.name && googleProfile.name) account.name = googleProfile.name;
                    writeRoster(roster);
                    account = readRoster().accounts.find(a => a.canonicalEmail === canonical) || account;
                } else {
                    const grade = normalizeGradeName(payload.grade || payload.classKey || 'Class 12');
                    const classKey = gradeToClassKey(grade);
                    const nowIso = new Date().toISOString();
                    const created = {
                        name: googleProfile.name || 'Student',
                        username: googleProfile.email.split('@')[0],
                        email: googleProfile.email,
                        canonicalEmail: canonical,
                        grade,
                        classKey,
                        plan: 'free',
                        planExplicitlySet: false,
                        legacyAccess: false,
                        emailVerified: true,
                        verifiedAt: nowIso,
                        verificationMethod: 'google_oauth',
                        googleLinked: true,
                        googleSub: googleProfile.googleSub || '',
                        avatarUrl: googleProfile.avatarUrl || '',
                        passkey: hashPassword('google-oauth-' + Date.now() + '-' + Math.random()),
                        joinedAt: nowIso.split('T')[0]
                    };
                    roster.accounts.unshift(created);
                    const updated = writeRoster(roster);
                    account = updated.accounts.find(a => a.canonicalEmail === canonical) || created;
                }

                const sessionToken = issueStudentSessionToken(account);
                const mySwitchRequests = (roster.classSwitchRequests || []).filter(r => canonicalizeEmail(r.email) === canonical);
                res.statusCode = 200;
                res.end(JSON.stringify({
                    success: true,
                    linkedExisting,
                    sessionToken,
                    user: stripSensitiveAccountFields(account),
                    mySwitchRequests
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
                res.statusCode = 200;
                res.end(JSON.stringify({
                    success: true,
                    sessionToken,
                    user: stripSensitiveAccountFields(account)
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

                const created = {
                    name,
                    email: rawEmail,
                    canonicalEmail: canonical,
                    grade,
                    classKey,
                    plan: requestedPlan,
                    planExplicitlySet: isAdmin && requestedPlan !== 'free',
                    legacyAccess: false,
                    passkey: String(student.password || student.passkey || 'bpgstudent'),
                    joinedAt: new Date().toISOString().split('T')[0]
                };

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
                        lastUpdated: updatedRoster.lastUpdated,
                        duplicateGroups: updatedRoster.duplicateGroups || [],
                        accounts: updatedRoster.accounts.map(stripSensitiveAccountFields)
                    }
                }));
                return;
            }

            // 3. ADMIN-ONLY MUTATIONS
            if (!isAdmin) {
                res.statusCode = 401;
                res.end(JSON.stringify({ success: false, error: 'Unauthorized: Admin passkey required.' }));
                return;
            }

            if (payload.action === 'UPDATE_CLASS' || payload.action === 'UPDATE_STUDENT_CLASS') {
                const targetEmail = String(payload.email || payload.accountEmail || '').trim().toLowerCase();
                const newGrade = normalizeGradeName(payload.grade || payload.newGrade);
                const classKey = gradeToClassKey(newGrade);
                const acc = roster.accounts.find(a => a.email === targetEmail);
                if (acc) {
                    acc.grade = newGrade;
                    acc.classKey = classKey;
                }
            } else if (payload.action === 'UPDATE_PLAN' || payload.action === 'UPDATE_STUDENT_PLAN') {
                const targetEmail = String(payload.email || payload.accountEmail || '').trim().toLowerCase();
                const newPlan = normalizePlan(payload.plan || payload.newPlan || 'free');
                const acc = roster.accounts.find(a => a.email === targetEmail);
                if (acc) {
                    acc.plan = newPlan;
                    acc.planExplicitlySet = true;
                    acc.legacyAccess = false;
                }
            } else if (payload.action === 'DELETE_STUDENT') {
                const targetEmail = String(payload.email || payload.accountEmail || '').trim().toLowerCase();
                roster.accounts = roster.accounts.filter(a => a.email !== targetEmail);
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

                if (isApprove) {
                    const canonical = canonicalizeEmail(reqItem.email);
                    const acc = roster.accounts.find(a => a.canonicalEmail === canonical);
                    if (acc) {
                        acc.classKey = gradeToClassKey(reqItem.requestedClassKey);
                        acc.grade = normalizeGradeName(reqItem.requestedClassKey);
                    }
                    // Supersede any other older pending requests from this same student
                    (roster.classSwitchRequests || []).forEach(other => {
                        if (other.id !== reqItem.id && canonicalizeEmail(other.email) === canonical && other.status === 'pending') {
                            other.status = 'rejected';
                            other.adminNote = 'Superseded by another approved class switch.';
                            other.reviewedAt = new Date().toISOString();
                        }
                    });
                }
            }

            const saved = writeRoster(roster);
            res.statusCode = 200;
            res.end(JSON.stringify({
                success: true,
                message: 'Changes saved.',
                data: {
                    lastUpdated: saved.lastUpdated,
                    duplicateGroups: saved.duplicateGroups || [],
                    classSwitchRequests: saved.classSwitchRequests || [],
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
