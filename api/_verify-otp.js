/**
 * BPG Academy — Serverless OTP Verifier & Account Provisioner (api/verify-otp.js)
 * Validates 6-digit OTP (5-min expiry, max 5 attempts, rate-limited), enforces canonical
 * email uniqueness, hashes passwords, and activates accounts only after verification.
 */

const crypto = require('crypto');
const {
    OTP_SECRET,
    canonicalizeEmail,
    normalizeUsername,
    isValidUsernameFormat,
    hashPassword,
    getOtpStoreEntry,
    setOtpStoreEntry,
    deleteOtpStoreEntry,
    getClientIp,
    checkRateLimit,
    gradeToClassKey,
    normalizeGradeName,
    issueStudentSessionToken,
    buildSessionCookieHeader,
    parseUserAgentDeviceInfo,
    generateSessionId,
    readRoster,
    writeRoster,
    readAcademyState,
    deriveStableUserId,
    appendAccountAuditEntry,
    appendRosterAuditEntry
} = require('./_access-control');

const MAX_OTP_ATTEMPTS = 5;

function constantTimeEqualsStr(a, b) {
    const bufA = Buffer.from(String(a || ''), 'utf8');
    const bufB = Buffer.from(String(b || ''), 'utf8');
    if (bufA.length === 0 || bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

function verifySignedOtpToken(email, otp, otpToken, mode) {
    if (!otpToken) return { valid: false, reason: 'Missing verification session. Please request a new code.' };
    try {
        const decoded = JSON.parse(Buffer.from(otpToken, 'base64url').toString('utf8'));
        const canonical = canonicalizeEmail(email);
        const tokenCanonical = decoded.canonicalEmail || canonicalizeEmail(decoded.email);
        const tokenMode = decoded.mode || 'signup';

        if (!decoded || tokenCanonical !== canonical || tokenMode !== mode) {
            return { valid: false, reason: 'Email mismatch for verification session.' };
        }
        if (Date.now() > Number(decoded.expiresAt)) {
            return { valid: false, code: 'OTP_EXPIRED', reason: 'Verification code has expired. Please request a new code.' };
        }

        const noncePart = decoded.nonce ? `|${decoded.nonce}` : '';
        const expectedPayload = `${canonical}|${tokenMode}|${String(otp).trim()}|${decoded.expiresAt}${noncePart}`;
        const expectedSig = crypto
            .createHmac('sha256', OTP_SECRET)
            .update(expectedPayload)
            .digest('hex');

        const expectedBuf = Buffer.from(expectedSig, 'hex');
        const actualBuf = Buffer.from(String(decoded.signature || ''), 'hex');
        if (expectedBuf.length === 0 || expectedBuf.length !== actualBuf.length) {
            return { valid: false, reason: 'Invalid 6-digit verification code.' };
        }
        const isMatch = crypto.timingSafeEqual(expectedBuf, actualBuf);
        return isMatch
            ? { valid: true, decoded }
            : { valid: false, reason: 'Invalid 6-digit verification code.' };
    } catch (e) {
        return { valid: false, reason: 'Invalid verification code or token format.' };
    }
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, error: 'Method Not Allowed. Use POST.' });
    }

    try {
        const clientIp = getClientIp(req);
        const ipLimit = checkRateLimit(`verify_ip:${clientIp}`, 20, 15 * 60 * 1000);
        if (!ipLimit.allowed) {
            return res.status(429).json({
                ok: false,
                code: 'RATE_LIMITED',
                retryAfterSeconds: ipLimit.retryAfterSeconds,
                error: `Too many verification attempts. Please wait ${ipLimit.retryAfterSeconds} seconds.`
            });
        }

        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const email = String(body.email || '').trim().toLowerCase();
        const canonical = canonicalizeEmail(email);
        const otp = String(body.otp || '').trim();
        const otpToken = String(body.otpToken || '').trim();
        const name = String(body.name || 'Student').trim();
        const requestedUsername = normalizeUsername(body.username || '');
        const grade = normalizeGradeName(body.grade || 'Class 12');
        const rawMode = String(body.mode || 'signup').toLowerCase();
        const mode = rawMode === 'reset' ? 'reset' : (rawMode === 'gmail_otp' ? 'gmail_otp' : 'signup');
        const newPassword = String(body.newPassword || body.password || '');
        const keepSignedIn = body.keepSignedIn !== false;

        if ((mode === 'signup' || mode === 'reset') && newPassword.length < 6) {
            return res.status(400).json({
                ok: false,
                code: 'WEAK_PASSWORD',
                error: 'Password must be at least 6 characters long.'
            });
        }

        if (!email || !/^\d{6}$/.test(otp)) {
            return res.status(400).json({
                ok: false,
                error: 'Please enter a valid 6-digit numeric verification code.'
            });
        }

        const storeKey = `${canonical}|${mode}`;
        const memRecord = getOtpStoreEntry(storeKey);
        let verified = false;

        if (memRecord) {
            if (Date.now() > memRecord.expiresAt) {
                deleteOtpStoreEntry(storeKey);
                return res.status(400).json({
                    ok: false,
                    code: 'OTP_EXPIRED',
                    error: 'Verification code has expired. Please request a new code.'
                });
            }
            if ((memRecord.attempts || 0) >= MAX_OTP_ATTEMPTS) {
                deleteOtpStoreEntry(storeKey);
                return res.status(429).json({
                    ok: false,
                    code: 'TOO_MANY_ATTEMPTS',
                    error: 'Too many incorrect verification attempts. Please request a new code.'
                });
            }

            // Ensure caller isn't submitting an old superseded otpToken
            if (otpToken && memRecord.nonce) {
                try {
                    const decoded = JSON.parse(Buffer.from(otpToken, 'base64url').toString('utf8'));
                    if (decoded.nonce && decoded.nonce !== memRecord.nonce) {
                        return res.status(401).json({
                            ok: false,
                            code: 'SUPERSEDED_OTP',
                            error: 'This verification code has been replaced by a newer code. Please use the latest code.'
                        });
                    }
                } catch (e) {}
            }

            if (memRecord.provider === 'supabase_auth') {
                const supabaseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
                const supabaseKey = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
                const sbResp = await fetch(`${supabaseUrl}/auth/v1/verify`, {
                    method: 'POST',
                    headers: {
                        'apikey': supabaseKey,
                        'Authorization': `Bearer ${supabaseKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ email, token: otp, type: 'email' })
                });
                const sbData = await sbResp.json().catch(() => ({}));
                if (sbResp.ok && sbData && (sbData.access_token || sbData.user?.email)) {
                    verified = true;
                    deleteOtpStoreEntry(storeKey);
                } else {
                    memRecord.attempts = (memRecord.attempts || 0) + 1;
                    const remaining = MAX_OTP_ATTEMPTS - memRecord.attempts;
                    if (remaining <= 0) {
                        deleteOtpStoreEntry(storeKey);
                        return res.status(429).json({
                            ok: false,
                            code: 'TOO_MANY_ATTEMPTS',
                            error: 'Too many incorrect verification attempts. Please request a new code.'
                        });
                    }
                    setOtpStoreEntry(storeKey, memRecord);
                    return res.status(401).json({
                        ok: false,
                        code: 'INVALID_OTP',
                        attemptsRemaining: remaining,
                        error: sbData.msg || sbData.error_description || `Incorrect 6-digit verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
                    });
                }
            } else if (constantTimeEqualsStr(memRecord.otp, otp)) {
                verified = true;
                deleteOtpStoreEntry(storeKey);
            } else {
                memRecord.attempts = (memRecord.attempts || 0) + 1;
                const remaining = MAX_OTP_ATTEMPTS - memRecord.attempts;
                if (remaining <= 0) {
                    deleteOtpStoreEntry(storeKey);
                    return res.status(429).json({
                        ok: false,
                        code: 'TOO_MANY_ATTEMPTS',
                        error: 'Too many incorrect verification attempts. Please request a new code.'
                    });
                }
                setOtpStoreEntry(storeKey, memRecord);
                return res.status(401).json({
                    ok: false,
                    code: 'INVALID_OTP',
                    attemptsRemaining: remaining,
                    error: `Incorrect 6-digit verification code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
                });
            }
        } else {
            // Stateless serverless fallback: still enforce attempt limit per token signature
            if (!otpToken) {
                return res.status(401).json({
                    ok: false,
                    code: 'OTP_SESSION_EXPIRED',
                    error: 'Verification session expired or not found. Please request a new code.'
                });
            }
            const tokHash = crypto.createHash('sha256').update(otpToken).digest('hex').slice(0, 16);
            const tokLimit = checkRateLimit(`tok_att:${tokHash}`, MAX_OTP_ATTEMPTS, 5 * 60 * 1000);
            if (!tokLimit.allowed) {
                return res.status(429).json({
                    ok: false,
                    code: 'TOO_MANY_ATTEMPTS',
                    error: 'Too many incorrect verification attempts. Please request a new code.'
                });
            }
            const supabaseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
            const supabaseKey = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
            const isSupabaseToken = supabaseUrl && supabaseKey && verifySignedOtpToken(email, 'supabase', otpToken, mode).valid;

            if (isSupabaseToken) {
                const sbResp = await fetch(`${supabaseUrl}/auth/v1/verify`, {
                    method: 'POST',
                    headers: {
                        'apikey': supabaseKey,
                        'Authorization': `Bearer ${supabaseKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ email, token: otp, type: 'email' })
                });
                const sbData = await sbResp.json().catch(() => ({}));
                if (!sbResp.ok || !sbData || (!sbData.access_token && !sbData.user?.email)) {
                    return res.status(401).json({
                        ok: false,
                        code: 'INVALID_OTP',
                        error: sbData.msg || sbData.error_description || 'Invalid or expired 6-digit verification code.'
                    });
                }
                verified = true;
            } else {
                const check = verifySignedOtpToken(email, otp, otpToken, mode);
                if (!check.valid) {
                    return res.status(check.code === 'OTP_EXPIRED' ? 400 : 401).json({
                        ok: false,
                        code: check.code || 'INVALID_OTP',
                        error: check.reason
                    });
                }
                verified = true;
            }
        }

        if (!verified) {
            return res.status(401).json({
                ok: false,
                error: 'Incorrect 6-digit OTP code. Please check and try again.'
            });
        }

        const roster = readRoster();
        const existingIdx = roster.accounts.findIndex(a => a.canonicalEmail === canonical);

        if (mode === 'reset') {
            if (existingIdx === -1) {
                return res.status(404).json({ ok: false, code: 'ACCOUNT_NOT_FOUND', error: 'Account not found.' });
            }
            if (newPassword) {
                roster.accounts[existingIdx].passkey = hashPassword(newPassword);
                roster.accounts[existingIdx].hasPassword = true;
            }
            // Allow older accounts missing a custom username to claim one during verified recovery
            if (requestedUsername && isValidUsernameFormat(requestedUsername)) {
                const takenByOther = roster.accounts.some((a, i) => i !== existingIdx && normalizeUsername(a.username) === requestedUsername);
                if (!takenByOther && (!roster.accounts[existingIdx].username || roster.accounts[existingIdx].username === roster.accounts[existingIdx].email.split('@')[0])) {
                    roster.accounts[existingIdx].username = requestedUsername;
                }
            }
            roster.accounts[existingIdx].emailVerified = true;
            if (!roster.accounts[existingIdx].verifiedAt) {
                roster.accounts[existingIdx].verifiedAt = new Date().toISOString();
            }
            appendAccountAuditEntry(roster.accounts[existingIdx], {
                actor: `${roster.accounts[existingIdx].name} (Password Reset)`,
                action: 'PASSWORD_RESET',
                details: 'Reset password via verified 6-digit email code'
            });
            const newSessionId = generateSessionId();
            const nowResetIso = new Date().toISOString();
            roster.accounts[existingIdx].activeSessionId = newSessionId;
            roster.accounts[existingIdx].lastLoginAt = nowResetIso;
            roster.accounts[existingIdx].lastActiveAt = nowResetIso;
            roster.accounts[existingIdx].deviceInfo = parseUserAgentDeviceInfo(req);
            writeRoster(roster);
            const acc = roster.accounts[existingIdx];
            const state = readAcademyState();
            const mySwitchRequests = (roster.classSwitchRequests || []).filter(
                r => (r.userId && r.userId === acc.userId) || canonicalizeEmail(r.email) === canonical
            );
            const myPayments = (Array.isArray(state.payments) ? state.payments : []).filter(
                p => (p.userId && p.userId === acc.userId) || canonicalizeEmail(p.email) === canonical
            );
            const sessionToken = issueStudentSessionToken(acc, { keepSignedIn, sessionId: newSessionId });
            res.setHeader('Set-Cookie', buildSessionCookieHeader(sessionToken, keepSignedIn, req));
            const { passkey, ...safeUser } = acc;
            return res.status(200).json({
                ok: true,
                verified: true,
                mode: 'reset',
                keepSignedIn,
                sessionToken,
                user: { ...safeUser, verified: true, emailVerified: true },
                mySwitchRequests,
                myPayments,
                message: 'Password updated! Signed in to your workspace.'
            });
        }

        // GMAIL_OTP: Always sign into the existing original account (never create duplicate accounts on login)
        if (mode === 'gmail_otp') {
            if (existingIdx === -1) {
                return res.status(404).json({
                    ok: false,
                    code: 'ACCOUNT_NOT_FOUND',
                    error: 'No existing account was found for this Gmail address. Please use Create Account.'
                });
            }
            const acc = roster.accounts[existingIdx];
            if (acc.accountStatus === 'suspended') {
                return res.status(403).json({
                    ok: false,
                    code: 'ACCOUNT_SUSPENDED',
                    error: 'Your account has been suspended by an administrator. Please contact BPG EDUCARE support.'
                });
            }
            const newSessionId = generateSessionId();
            const nowOtpIso = new Date().toISOString();
            acc.emailVerified = true;
            if (acc.accountStatus === 'pending_verification') acc.accountStatus = 'active';
            if (!acc.verifiedAt) acc.verifiedAt = nowOtpIso;
            acc.activeSessionId = newSessionId;
            acc.lastLoginAt = nowOtpIso;
            acc.lastActiveAt = nowOtpIso;
            acc.deviceInfo = parseUserAgentDeviceInfo(req);
            writeRoster(roster);
            const state = readAcademyState();
            const mySwitchRequests = (roster.classSwitchRequests || []).filter(
                r => (r.userId && r.userId === acc.userId) || canonicalizeEmail(r.email) === canonical
            );
            const myPayments = (Array.isArray(state.payments) ? state.payments : []).filter(
                p => (p.userId && p.userId === acc.userId) || canonicalizeEmail(p.email) === canonical
            );
            const sessionToken = issueStudentSessionToken(acc, { keepSignedIn, sessionId: newSessionId });
            res.setHeader('Set-Cookie', buildSessionCookieHeader(sessionToken, keepSignedIn, req));
            const { passkey, ...safeUser } = acc;
            return res.status(200).json({
                ok: true,
                verified: true,
                linkedExisting: true,
                mode: 'gmail_otp',
                keepSignedIn,
                sessionToken,
                user: { ...safeUser, verified: true, emailVerified: true },
                mySwitchRequests,
                myPayments,
                message: `Email verified! Signed in to your existing ${acc.grade} account.`
            });
        }

        // SIGNUP: Re-enforce canonical Gmail & unique username right before DB commit
        if (existingIdx !== -1) {
            return res.status(409).json({
                ok: false,
                code: 'EMAIL_EXISTS',
                existingEmail: roster.accounts[existingIdx].email,
                error: 'An account already exists for this Gmail address. Please sign in or reset your password.'
            });
        }

        const finalUsername = isValidUsernameFormat(requestedUsername) ? requestedUsername : normalizeUsername(email.split('@')[0]);
        const usernameConflict = roster.accounts.find(a => normalizeUsername(a.username) === finalUsername);
        if (usernameConflict) {
            return res.status(409).json({
                ok: false,
                code: 'USERNAME_TAKEN',
                error: `Username "${finalUsername}" is already taken. Please choose a different username.`
            });
        }

        const nowIso = new Date().toISOString();
        const stableUserId = deriveStableUserId(canonical);
        const newSessionId = generateSessionId();
        const newAccount = {
            userId: stableUserId,
            name,
            username: finalUsername,
            email,
            canonicalEmail: canonical,
            grade,
            classKey: gradeToClassKey(grade),
            plan: 'free',
            planExplicitlySet: false,
            legacyAccess: false,
            accountStatus: 'active',
            paymentStatus: 'none',
            emailVerified: true,
            verifiedAt: nowIso,
            verificationMethod: 'email_otp',
            hasPassword: true,
            passkey: hashPassword(newPassword || crypto.randomBytes(16).toString('hex')),
            activeSessionId: newSessionId,
            lastLoginAt: nowIso,
            lastActiveAt: nowIso,
            deviceInfo: parseUserAgentDeviceInfo(req),
            readNotificationIds: [],
            joinedAt: nowIso.split('T')[0],
            updatedAt: nowIso,
            lastModifiedBy: `${name} (Email OTP Sign-Up)`,
            auditLog: []
        };
        appendAccountAuditEntry(newAccount, {
            actor: `${name} (Email OTP Sign-Up)`,
            action: 'ACCOUNT_CREATED',
            details: `Verified email via 6-digit OTP and enrolled in ${grade}`
        });
        appendRosterAuditEntry(roster, {
            userId: stableUserId,
            email,
            actor: `${name} (Email OTP Sign-Up)`,
            action: 'ACCOUNT_CREATED',
            details: `Registered via Email OTP (${grade})`
        });
        roster.accounts.unshift(newAccount);
        const savedRoster = writeRoster(roster);
        const savedAccount = savedRoster.accounts.find(a => a.userId === stableUserId || a.canonicalEmail === canonical) || newAccount;

        const sessionToken = issueStudentSessionToken(savedAccount, { keepSignedIn, sessionId: newSessionId });
        res.setHeader('Set-Cookie', buildSessionCookieHeader(sessionToken, keepSignedIn, req));
        const { passkey, ...safeUser } = savedAccount;

        return res.status(200).json({
            ok: true,
            verified: true,
            mode: 'signup',
            keepSignedIn,
            sessionToken,
            user: { ...safeUser, verified: true, emailVerified: true },
            myPayments: [],
            mySwitchRequests: [],
            message: 'Email verified! Your account is now active.'
        });
    } catch (err) {
        console.error('[BPG Verify OTP Error]:', err);
        return res.status(500).json({
            ok: false,
            error: 'Verification failed. Please try again.'
        });
    }
};
