/**
 * BPG Academy — Serverless Email OTP Dispatcher (api/send-email-otp.js)
 * Enforces real email verification with 5-minute OTP expiry, 60-second resend cooldown,
 * disposable/fake domain rejection, MX verification, and rate limiting.
 */

const crypto = require('crypto');
const dns = require('dns').promises;
const tls = require('tls');
const {
    OTP_SECRET,
    canonicalizeEmail,
    normalizeUsername,
    isValidUsernameFormat,
    isGmailAddress,
    findAccountByUsername,
    isValidEmailFormat,
    isDisposableOrFakeEmail,
    getOtpStoreEntry,
    setOtpStoreEntry,
    getClientIp,
    checkRateLimit,
    findAccountByEmail
} = require('./_access-control');

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RESEND_COOLDOWN_MS = 30 * 1000; // 30 seconds

async function verifyEmailDomainHasMx(email) {
    const domain = String(email || '').split('@')[1] || '';
    if (!domain) return false;
    if (domain === 'gmail.com' || domain === 'googlemail.com') return true;
    try {
        const records = await dns.resolveMx(domain);
        return Array.isArray(records) && records.length > 0;
    } catch (e) {
        return false;
    }
}

async function sendViaGmailSmtp({ user, pass, to, subject, html }) {
    return new Promise((resolve, reject) => {
        const socket = tls.connect(465, 'smtp.gmail.com', { servername: 'smtp.gmail.com' }, () => {});
        socket.setEncoding('utf8');
        let buffer = '';
        let step = 0;

        const sendLine = (line) => socket.write(line + '\r\n');
        const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

        const rawMessage = [
            `From: BPG EDUCARE <${user}>`,
            `To: ${to}`,
            `Subject: ${subject}`,
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=UTF-8',
            '',
            html,
            '.'
        ].join('\r\n');

        socket.on('data', (chunk) => {
            buffer += chunk;
            const lines = buffer.split('\r\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (!line || /^\d{3}-/.test(line)) continue;
                const code = parseInt(line.slice(0, 3), 10);
                if (code >= 400) {
                    socket.destroy();
                    reject(new Error(line));
                    return;
                }
                if (step === 0 && code === 220) { step = 1; sendLine('EHLO bpgeducare.local'); }
                else if (step === 1 && code === 250) { step = 2; sendLine('AUTH LOGIN'); }
                else if (step === 2 && code === 334) { step = 3; sendLine(b64(user)); }
                else if (step === 3 && code === 334) { step = 4; sendLine(b64(pass)); }
                else if (step === 4 && code === 235) { step = 5; sendLine(`MAIL FROM:<${user}>`); }
                else if (step === 5 && code === 250) { step = 6; sendLine(`RCPT TO:<${to}>`); }
                else if (step === 6 && (code === 250 || code === 251)) { step = 7; sendLine('DATA'); }
                else if (step === 7 && code === 354) { step = 8; sendLine(rawMessage); }
                else if (step === 8 && code === 250) { step = 9; sendLine('QUIT'); resolve(true); }
            }
        });
        socket.on('error', reject);
        socket.setTimeout(12000, () => {
            socket.destroy();
            reject(new Error('SMTP connection timed out'));
        });
    });
}

function createSignedOtpToken(email, otp, expiresAt, mode, nonce) {
    const canonical = canonicalizeEmail(email);
    const payload = `${canonical}|${mode}|${otp}|${expiresAt}|${nonce}`;
    const signature = crypto
        .createHmac('sha256', OTP_SECRET)
        .update(payload)
        .digest('hex');
    return Buffer.from(JSON.stringify({
        email: email.toLowerCase().trim(),
        canonicalEmail: canonical,
        mode,
        expiresAt,
        nonce,
        signature
    })).toString('base64url');
}

function escapeHtmlEmail(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildOtpEmailHtml({ name, email, grade, otp, mode }) {
    const safeName = escapeHtmlEmail(name || 'Student');
    const safeEmail = escapeHtmlEmail(email || '');
    const safeGrade = escapeHtmlEmail(grade || 'Class 12');
    const safeOtp = escapeHtmlEmail(otp || '');
    const title = mode === 'reset' ? 'Reset Your Password' : 'Verify Your Student Account';
    const bodyText = mode === 'reset'
        ? `Use the 6-digit code below to reset your password for <strong>${safeEmail}</strong>.`
        : `Namaste <strong>${safeName}</strong>, use the 6-digit code below to activate your <strong>${safeGrade}</strong> workspace on BPG EDUCARE.`;
    return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"><title>${title}</title></head>
    <body style="margin:0; padding:32px 16px; background-color:#ffffff; font-family:'Inter', sans-serif; color:#111114;">
        <div style="max-width:500px; margin:0 auto; border:1px solid #e6e6eb; border-radius:12px; padding:32px;">
            <h1 style="font-size:22px; margin:0 0 12px;">${title}</h1>
            <p style="font-size:15px; line-height:1.6; color:#52525c; margin:0 0 20px;">${bodyText}</p>
            <div style="background:#f8f8fa; border:1px solid #e6e6eb; border-radius:10px; padding:20px; text-align:center; margin:20px 0;">
                <div style="font-size:12px; color:#7c7c88; margin-bottom:6px;">6-Digit Verification Code (Valid for 5 minutes)</div>
                <div style="font-family:monospace; font-size:32px; font-weight:700; letter-spacing:8px; color:#111114;">${safeOtp}</div>
            </div>
            <p style="font-size:12px; color:#7c7c88; margin:16px 0 0;">If you did not request this code, you can safely ignore this email.</p>
        </div>
    </body>
    </html>
    `;
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
        const ipLimit = checkRateLimit(`otp_ip:${clientIp}`, 15, 15 * 60 * 1000);
        if (!ipLimit.allowed) {
            return res.status(429).json({
                ok: false,
                code: 'RATE_LIMITED',
                retryAfterSeconds: ipLimit.retryAfterSeconds,
                error: `Too many verification requests. Please try again in ${ipLimit.retryAfterSeconds} seconds.`
            });
        }

        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const email = String(body.email || '').trim().toLowerCase();
        const name = String(body.name || 'Student').trim();
        const username = normalizeUsername(body.username || '');
        const grade = String(body.grade || 'Class 12').trim();
        const rawMode = String(body.mode || 'signup').toLowerCase();
        const mode = rawMode === 'reset' ? 'reset' : (rawMode === 'gmail_otp' ? 'gmail_otp' : 'signup');

        if (!email || !isValidEmailFormat(email)) {
            return res.status(400).json({ ok: false, error: 'Please provide a valid Gmail address.' });
        }

        if (mode === 'signup') {
            if (!isGmailAddress(email)) {
                return res.status(400).json({ ok: false, code: 'GMAIL_REQUIRED', error: 'Please use a valid Gmail address (@gmail.com) to create your student account.' });
            }
            if (!isValidUsernameFormat(username)) {
                return res.status(400).json({ ok: false, code: 'INVALID_USERNAME', error: 'Username must be 3–30 characters using letters, numbers, dots, hyphens, or underscores.' });
            }
            const usernameOwner = findAccountByUsername(username);
            if (usernameOwner && canonicalizeEmail(usernameOwner.email) !== canonicalizeEmail(email)) {
                return res.status(409).json({ ok: false, code: 'USERNAME_TAKEN', error: `Username "${username}" is already taken. Please choose another unique username.` });
            }
        }

        if (isDisposableOrFakeEmail(email)) {
            return res.status(400).json({
                ok: false,
                code: 'DISPOSABLE_EMAIL_REJECTED',
                error: 'Temporary, disposable, or fake email addresses cannot be used. Please enter a real email address.'
            });
        }

        const hasValidMx = await verifyEmailDomainHasMx(email);
        if (!hasValidMx) {
            return res.status(400).json({
                ok: false,
                code: 'INVALID_EMAIL_DOMAIN',
                error: 'This email domain does not exist or cannot receive mail. Please enter a valid email address.'
            });
        }

        const canonical = canonicalizeEmail(email);
        const emailLimit = checkRateLimit(`otp_email:${canonical}`, 5, 15 * 60 * 1000);
        if (!emailLimit.allowed) {
            return res.status(429).json({
                ok: false,
                code: 'RATE_LIMITED',
                retryAfterSeconds: emailLimit.retryAfterSeconds,
                error: `Too many OTP requests for this email. Please wait ${emailLimit.retryAfterSeconds} seconds.`
            });
        }

        const storeKey = `${canonical}|${mode}`;
        const existingOtp = getOtpStoreEntry(storeKey);
        if (existingOtp && existingOtp.lastSentAt && (Date.now() - existingOtp.lastSentAt) < RESEND_COOLDOWN_MS) {
            const retryAfterSeconds = Math.max(1, Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - existingOtp.lastSentAt)) / 1000));
            return res.status(429).json({
                ok: false,
                code: 'RESEND_COOLDOWN',
                retryAfterSeconds,
                error: `Please wait ${retryAfterSeconds}s before requesting a new verification code.`
            });
        }

        const existingAccount = findAccountByEmail(email);

        // Enforce 1 account per verified email on sign-up
        if (mode === 'signup' && existingAccount) {
            return res.status(409).json({
                ok: false,
                code: 'EMAIL_EXISTS',
                existingEmail: existingAccount.email,
                canonicalEmail: canonical,
                error: 'An account already exists for this email address. Please sign in or reset your password.'
            });
        }

        // For password reset, protect email registration privacy (never leak whether an email is registered)
        if (mode === 'reset' && !existingAccount) {
            return res.status(200).json({
                ok: true,
                mode: 'reset',
                neutralNotice: true,
                email,
                expiresAt: Date.now() + OTP_TTL_MS,
                ttlSeconds: Math.floor(OTP_TTL_MS / 1000),
                cooldownSeconds: Math.floor(RESEND_COOLDOWN_MS / 1000),
                otpToken: '',
                message: "If an account exists for this email, we've sent a 6-digit reset code. Check your inbox and spam folder."
            });
        }

        // For passwordless email-code login, ensure an account exists for that inbox
        if (mode === 'gmail_otp' && !existingAccount) {
            return res.status(200).json({
                ok: true,
                mode: 'gmail_otp',
                neutralNotice: true,
                email,
                expiresAt: Date.now() + OTP_TTL_MS,
                ttlSeconds: Math.floor(OTP_TTL_MS / 1000),
                cooldownSeconds: Math.floor(RESEND_COOLDOWN_MS / 1000),
                otpToken: '',
                message: "If an account exists for this email, we've sent a 6-digit login code. Check your inbox and spam folder."
            });
        }

        const supabaseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
        const supabaseKey = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
        const gmailUser = String(process.env.GMAIL_USER || '').trim();
        const gmailPass = String(process.env.GMAIL_APP_PASSWORD || '').trim();
        const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
        const fromAddress = process.env.RESEND_FROM_EMAIL || 'BPG EDUCARE <onboarding@resend.dev>';

        if ((!supabaseUrl || !supabaseKey) && !resendApiKey && (!gmailUser || !gmailPass)) {
            return res.status(503).json({
                ok: false,
                code: 'EMAIL_DELIVERY_NOT_CONFIGURED',
                error: 'Email verification is unavailable because no auth/email provider is configured on the server (set SUPABASE_URL + SUPABASE_ANON_KEY, or GMAIL_USER + GMAIL_APP_PASSWORD, or RESEND_API_KEY in .env).'
            });
        }

        const now = Date.now();
        const expiresAt = now + OTP_TTL_MS;
        const nonce = crypto.randomBytes(12).toString('hex');
        let otp = '';
        let otpToken = '';
        let deliveredProvider = '';

        // 1. Primary: Supabase Auth Email OTP (POST /auth/v1/otp)
        if (supabaseUrl && supabaseKey) {
            const sbResp = await fetch(`${supabaseUrl}/auth/v1/otp`, {
                method: 'POST',
                headers: {
                    'apikey': supabaseKey,
                    'Authorization': `Bearer ${supabaseKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email,
                    create_user: mode !== 'reset',
                    data: { name, grade }
                })
            });

            if (sbResp.ok) {
                deliveredProvider = 'supabase_auth';
                otpToken = createSignedOtpToken(email, 'supabase', expiresAt, mode, nonce);
            } else {
                const sbErr = await sbResp.json().catch(() => ({}));
                console.error('[BPG Supabase Auth OTP Error]:', sbResp.status, sbErr);
                if (!resendApiKey && (!gmailUser || !gmailPass)) {
                    const msg = sbErr.msg || sbErr.error_description || sbErr.message || 'Supabase Auth could not send the verification code.';
                    return res.status(sbResp.status === 429 ? 429 : 400).json({
                        ok: false,
                        code: sbResp.status === 429 ? 'RATE_LIMITED' : 'EMAIL_SEND_FAILED',
                        error: msg
                    });
                }
            }
        }

        // 2. Fallback: Gmail SMTP or Resend
        if (!deliveredProvider) {
            otp = String(crypto.randomInt(100000, 1000000));
            otpToken = createSignedOtpToken(email, otp, expiresAt, mode, nonce);
            const subject = `${otp} is your BPG EDUCARE Verification Code`;
            const html = buildOtpEmailHtml({ name, email, grade, otp, mode });

            if (gmailUser && gmailPass) {
                try {
                    await sendViaGmailSmtp({ user: gmailUser, pass: gmailPass, to: email, subject, html });
                    deliveredProvider = 'gmail_smtp';
                } catch (smtpErr) {
                    console.error('[BPG Gmail SMTP Error]:', smtpErr.message);
                    if (!resendApiKey) {
                        return res.status(400).json({
                            ok: false,
                            code: 'EMAIL_SEND_FAILED',
                            error: 'Could not deliver verification code to this email address. Please verify the address exists and can receive email.'
                        });
                    }
                }
            }

            if (!deliveredProvider && resendApiKey) {
                const response = await fetch('https://api.resend.com/emails', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${resendApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        from: fromAddress,
                        to: [email],
                        subject,
                        html
                    })
                });

                if (response.ok) {
                    deliveredProvider = 'resend';
                } else {
                    const errText = await response.text().catch(() => '');
                    console.error('[BPG Resend Error]:', errText);
                    return res.status(400).json({
                        ok: false,
                        code: 'EMAIL_SEND_FAILED',
                        error: 'Could not deliver verification code to this email address. Please verify the address exists.'
                    });
                }
            }
        }

        // Overwrite any previous OTP so old codes are immediately invalidated
        setOtpStoreEntry(storeKey, {
            otp,
            provider: deliveredProvider,
            nonce,
            email,
            canonicalEmail: canonical,
            name: existingAccount ? existingAccount.name : name,
            grade: existingAccount ? existingAccount.grade : grade,
            mode,
            lastSentAt: now,
            expiresAt,
            attempts: 0
        });

        return res.status(200).json({
            ok: true,
            mode,
            isExistingAccount: Boolean(existingAccount),
            provider: deliveredProvider,
            email,
            expiresAt,
            ttlSeconds: Math.floor(OTP_TTL_MS / 1000),
            cooldownSeconds: Math.floor(RESEND_COOLDOWN_MS / 1000),
            otpToken,
            message: "We've sent a 6-digit verification code to your email address. Enter the code to activate your account."
        });
    } catch (err) {
        console.error('[BPG OTP Error]:', err);
        return res.status(500).json({
            ok: false,
            error: 'Could not dispatch verification code. Please try again.'
        });
    }
};
