/**
 * BPG EDUCARE — eSewa & WhatsApp Plan Purchase & Verification API (/api/payments)
 * - Static eSewa QR flow creates a 'pending' payment record and returns prefilled WhatsApp URL.
 * - Gateway-verified flow (when integrated payment service returns verified result) activates plan & returns WhatsApp URL.
 * - Admin verifies pending payments and activates the student's plan in student-roster.json.
 */

const {
    canonicalizeEmail,
    normalizePlan,
    normalizeGradeName,
    gradeToClassKey,
    isAdminPasskeyValid,
    readAcademyState,
    readRoster,
    writeRoster,
    resolveRequestUser,
    issueStudentSessionToken
} = require('./_access-control');

const { writeStateToDisk } = require('./academy-state');

function buildWhatsappConfirmMessage({ fullName, className, username, email, planName, amount, transactionId }) {
    return [
        "Hello, I've paid via eSewa and would like to confirm my plan purchase.",
        '',
        `Name: ${fullName || 'Student'}`,
        `Class: ${className || 'Class 12'}`,
        `Username: ${username || 'student'}`,
        `Gmail: ${email || ''}`,
        `Selected plan: ${planName || 'Gold'}`,
        `Amount paid: ${amount || ''}`,
        `eSewa transaction ID: ${transactionId || 'Not provided'}`
    ].join('\n');
}

function buildWhatsappUrl(whatsappNumber, messageText) {
    const cleanNum = String(whatsappNumber || '9779866064252').replace(/[^\d]/g, '') || '9779866064252';
    return `https://wa.me/${cleanNum}?text=${encodeURIComponent(messageText)}`;
}

module.exports = function paymentsHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-passkey, x-session-token, x-student-email');

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const body = req.method === 'POST' ? (req.body || {}) : {};
    const isAdmin = isAdminPasskeyValid(req.headers['x-admin-passkey'] || body.adminPasskey);
    const state = readAcademyState();
    if (!Array.isArray(state.payments)) state.payments = [];

    if (req.method === 'GET') {
        if (isAdmin) {
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, payments: state.payments }));
            return;
        }
        const user = resolveRequestUser(req);
        if (!user || !user.email) {
            res.statusCode = 401;
            res.end(JSON.stringify({ ok: false, error: 'Sign in required.' }));
            return;
        }
        const canonical = canonicalizeEmail(user.email);
        const mine = state.payments.filter(p => canonicalizeEmail(p.email) === canonical);
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, payments: mine }));
        return;
    }

    if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
        return;
    }

    // Enforce Maintenance Mode for non-admin checkout/payment requests
    if (!isAdmin && state.maintenanceMode?.enabled) {
        res.statusCode = 503;
        res.end(JSON.stringify({
            ok: false,
            code: 'MAINTENANCE_MODE',
            error: state.maintenanceMode.message || 'Checkout is locked during scheduled maintenance.'
        }));
        return;
    }

    const action = String(body.action || '').toUpperCase();
    const whatsappNumber = state.siteSettings?.whatsappNumber || '9779866064252';
    const esewaQrUrl = state.siteSettings?.esewaQrUrl || 'images/payment_qr.png';

    // 1. STUDENT: CREATE_PAYMENT (Static eSewa QR -> keeps status 'pending' for admin review)
    if (action === 'CREATE_PAYMENT') {
        const user = resolveRequestUser(req);
        if (!user || !user.email) {
            res.statusCode = 401;
            res.end(JSON.stringify({ ok: false, error: 'Please sign in before purchasing a plan.' }));
            return;
        }

        const planId = normalizePlan(body.planId || 'gold');
        if (planId === 'free') {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: 'Please select Gold or Diamond plan to purchase.' }));
            return;
        }
        const planCfg = state.plansConfig?.[planId] || { name: planId, price: '' };
        const planName = String(body.planName || planCfg.name || planId);
        const amount = String(body.amount || planCfg.price || '');
        const transactionId = String(body.transactionId || '').trim();
        const fullName = String(user.name || body.fullName || 'Student').trim();
        const classKey = gradeToClassKey(user.classKey || user.grade);
        const className = normalizeGradeName(classKey);
        const username = String(user.username || user.email.split('@')[0] || 'student').trim();
        const email = String(user.email).trim().toLowerCase();

        const payment = {
            id: 'pay_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            fullName,
            username,
            email,
            canonicalEmail: canonicalizeEmail(email),
            classKey,
            className,
            planId,
            planName,
            amount,
            transactionId,
            method: 'esewa_qr',
            status: 'pending',
            adminNote: '',
            createdAt: new Date().toISOString(),
            reviewedAt: ''
        };

        state.payments.unshift(payment);
        state.lastUpdated = new Date().toISOString();
        writeStateToDisk(state);

        const waMessage = buildWhatsappConfirmMessage({
            fullName,
            className,
            username,
            email,
            planName,
            amount,
            transactionId
        });

        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            payment,
            whatsappNumber,
            whatsappUrl: buildWhatsappUrl(whatsappNumber, waMessage),
            whatsappMessage: waMessage,
            esewaQrUrl
        }));
        return;
    }

    // 2. INTEGRATED GATEWAY VERIFIED PAYMENT CALLBACK
    if (action === 'VERIFY_GATEWAY_PAYMENT') {
        const user = resolveRequestUser(req);
        if (!user || !user.email) {
            res.statusCode = 401;
            res.end(JSON.stringify({ ok: false, error: 'Please sign in to verify payment.' }));
            return;
        }
        const gatewayVerified = Boolean(body.gatewayVerified) && Boolean(String(body.transactionId || '').trim());
        if (!gatewayVerified) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: 'Verified payment gateway reference is required.' }));
            return;
        }

        const planId = normalizePlan(body.planId || 'gold');
        const planCfg = state.plansConfig?.[planId] || { name: planId, price: '' };
        const planName = String(body.planName || planCfg.name || planId);
        const amount = String(body.amount || planCfg.price || '');
        const transactionId = String(body.transactionId || '').trim();
        const fullName = String(user.name || 'Student').trim();
        const classKey = gradeToClassKey(user.classKey || user.grade);
        const className = normalizeGradeName(classKey);
        const username = String(user.username || user.email.split('@')[0] || 'student').trim();
        const email = String(user.email).trim().toLowerCase();
        const canonical = canonicalizeEmail(email);

        const payment = {
            id: 'pay_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            fullName,
            username,
            email,
            canonicalEmail: canonical,
            classKey,
            className,
            planId,
            planName,
            amount,
            transactionId,
            method: 'esewa_gateway',
            status: 'verified',
            adminNote: 'Auto-verified via integrated payment gateway.',
            createdAt: new Date().toISOString(),
            reviewedAt: new Date().toISOString()
        };

        state.payments.unshift(payment);
        state.lastUpdated = new Date().toISOString();
        writeStateToDisk(state);

        // Activate plan in roster
        const roster = readRoster();
        const acc = roster.accounts.find(a => a.canonicalEmail === canonical);
        let updatedUser = user;
        let sessionToken = '';
        if (acc) {
            acc.plan = planId;
            acc.planExplicitlySet = true;
            acc.legacyAccess = false;
            writeRoster(roster);
            updatedUser = acc;
            sessionToken = issueStudentSessionToken(acc);
        }

        const waMessage = buildWhatsappConfirmMessage({
            fullName,
            className,
            username,
            email,
            planName,
            amount,
            transactionId
        });

        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            payment,
            user: updatedUser,
            sessionToken,
            whatsappNumber,
            whatsappUrl: buildWhatsappUrl(whatsappNumber, waMessage),
            whatsappMessage: waMessage
        }));
        return;
    }

    // 3. ADMIN ACTIONS: ADMIN_VERIFY_PAYMENT / ADMIN_REJECT_PAYMENT
    if (!isAdmin) {
        res.statusCode = 401;
        res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Admin passkey required.' }));
        return;
    }

    const paymentId = String(body.paymentId || '').trim();
    const payment = state.payments.find(p => p.id === paymentId);
    if (!payment) {
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: 'Payment record not found.' }));
        return;
    }

    if (action === 'ADMIN_VERIFY_PAYMENT') {
        payment.status = 'verified';
        payment.adminNote = String(body.adminNote || 'Payment verified and plan activated.').trim();
        payment.reviewedAt = new Date().toISOString();
        if (body.transactionId) payment.transactionId = String(body.transactionId).trim();

        const targetPlan = normalizePlan(body.planId || payment.planId || 'gold');
        payment.planId = targetPlan;

        const roster = readRoster();
        const canonical = canonicalizeEmail(payment.email);
        const acc = roster.accounts.find(a => a.canonicalEmail === canonical);
        if (acc) {
            acc.plan = targetPlan;
            acc.planExplicitlySet = true;
            acc.legacyAccess = false;
            writeRoster(roster);
        }

        state.lastUpdated = new Date().toISOString();
        writeStateToDisk(state);

        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            message: `Payment verified and ${targetPlan} plan activated for ${payment.email}.`,
            payment,
            payments: state.payments
        }));
        return;
    }

    if (action === 'ADMIN_REJECT_PAYMENT') {
        payment.status = 'rejected';
        payment.adminNote = String(body.adminNote || 'Payment could not be verified.').trim();
        payment.reviewedAt = new Date().toISOString();
        state.lastUpdated = new Date().toISOString();
        writeStateToDisk(state);

        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            message: 'Payment marked as rejected.',
            payment,
            payments: state.payments
        }));
        return;
    }

    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: 'Unsupported payment action.' }));
};
