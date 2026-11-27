/**
 * BPG EDUCARE — Reliable Server-Verified eSewa & WhatsApp Payment Engine (/api/payments)
 *
 * Security & Reliability Guarantees:
 * 1. Authoritative Server Orders (CREATE_ORDER / CREATE_PAYMENT):
 *    - Looks up plan price & currency ('NPR') from server plansConfig. Never trusts client-supplied amounts.
 *    - Assigns a unique orderId, links to stable userId, and generates an HMAC-SHA256 orderSignature
 *      plus eSewa EpAy v2 signed checkout parameters.
 * 2. Strict Server-Side Payment Verification (VERIFY_GATEWAY_PAYMENT / PROVIDER_WEBHOOK / ADMIN_CHECK_PROVIDER_STATUS):
 *    - A browser redirect alone (?payment_verified=1) NEVER unlocks paid access.
 *    - Matches provider transaction reference, amount, currency ('NPR'), and status against the original server order.
 *    - Verifies eSewa v2 cryptographic HMAC-SHA256 signature or queries eSewa's Transaction Status API
 *      (with built-in sandbox test verification for test orders signed by the server).
 * 3. Idempotency & Atomic Consistency:
 *    - Duplicate notifications or retries with the same orderId or transactionId are handled idempotently:
 *      recorded once and subscription activated once.
 *    - Payment record and member roster plan/paymentStatus/auditLog are updated atomically.
 * 4. Full Payment Status Lifecycle:
 *    - Supports 'pending', 'awaiting_confirmation', 'paid' (and legacy 'verified'), 'failed' (and legacy 'rejected'), and 'refunded'.
 */

const crypto = require('crypto');
const {
    OTP_SECRET,
    PLAN_RANK,
    canonicalizeEmail,
    normalizePlan,
    normalizeGradeName,
    gradeToClassKey,
    isAdminPasskeyValid,
    readAcademyState,
    readRoster,
    writeRoster,
    deriveStableUserId,
    appendAccountAuditEntry,
    appendRosterAuditEntry,
    normalizePaymentStatusValue,
    resolveRequestUser,
    issueStudentSessionToken
} = require('./_access-control');

const { writeStateToDisk } = require('./academy-state');

const ESEWA_SANDBOX_SECRET = '8gBm/:&EnhH.1/q';
const ESEWA_SANDBOX_PRODUCT_CODE = 'EPAYTEST';

function getEsewaConfig(state) {
    const merchantCode = String(
        process.env.ESEWA_MERCHANT_CODE ||
        process.env.ESEWA_PRODUCT_CODE ||
        state?.siteSettings?.esewaMerchantCode ||
        ESEWA_SANDBOX_PRODUCT_CODE
    ).trim();
    const secretKey = String(
        process.env.ESEWA_SECRET_KEY ||
        state?.siteSettings?.esewaSecretKey ||
        (merchantCode === ESEWA_SANDBOX_PRODUCT_CODE ? ESEWA_SANDBOX_SECRET : '')
    ).trim();
    const envMode = String(
        process.env.ESEWA_ENV ||
        state?.siteSettings?.esewaEnv ||
        (merchantCode === ESEWA_SANDBOX_PRODUCT_CODE ? 'sandbox' : 'production')
    ).trim().toLowerCase();
    const statusCheckBaseUrl = envMode === 'production'
        ? 'https://epay.esewa.com.np/api/epay/transaction/status/'
        : 'https://rc.esewa.com.np/api/epay/transaction/status/';
    return {
        merchantCode,
        secretKey,
        envMode,
        isSandbox: envMode !== 'production' || merchantCode === ESEWA_SANDBOX_PRODUCT_CODE,
        hasLiveCredentials: Boolean(process.env.ESEWA_SECRET_KEY && process.env.ESEWA_MERCHANT_CODE),
        statusCheckBaseUrl
    };
}

function parsePlanNumericPrice(priceStr, planId = 'gold') {
    const raw = String(priceStr || '').replace(/,/g, '');
    const m = raw.match(/\d+(\.\d+)?/);
    if (m) {
        const val = parseFloat(m[0]);
        if (Number.isFinite(val) && val > 0) return val;
    }
    return planId === 'diamond' ? 2999 : 1999;
}

function getPlanFriendlyLabel(state, planId) {
    const pid = normalizePlan(planId);
    const cfgName = String(state?.plansConfig?.[pid]?.name || '').trim();
    if (cfgName && cfgName.toLowerCase() !== 'gold' && cfgName.toLowerCase() !== 'diamond') return cfgName;
    if (pid === 'diamond') return 'Topper';
    if (pid === 'gold') return 'Padandas';
    return 'Free';
}

function generateReadableOrderId(existingPayments = []) {
    const year = new Date().getFullYear();
    const prefix = `BPG-${year}-`;
    let maxSeq = 100;
    for (const p of (existingPayments || [])) {
        const oid = String(p?.orderId || '');
        if (oid.startsWith(prefix)) {
            const num = parseInt(oid.slice(prefix.length), 10);
            if (Number.isFinite(num) && num > maxSeq) maxSeq = num;
        }
    }
    let nextSeq = maxSeq + 1;
    let candidate = `${prefix}${String(nextSeq).padStart(5, '0')}`;
    const existingSet = new Set((existingPayments || []).map(p => String(p?.orderId || '')));
    while (existingSet.has(candidate)) {
        nextSeq += 1;
        candidate = `${prefix}${String(nextSeq).padStart(5, '0')}`;
    }
    return candidate;
}

function validatePromoCodeServer(state, rawCode, planId, baseAmount) {
    const code = String(rawCode || '').trim().toUpperCase();
    if (!code) {
        return { applied: false, code: '', discountAmount: 0, finalAmount: baseAmount, message: '' };
    }
    const list = Array.isArray(state?.siteSettings?.promoCodes) ? state.siteSettings.promoCodes : [];
    const promo = list.find(p => p && String(p.code || '').trim().toUpperCase() === code);
    if (!promo || promo.active === false) {
        return { applied: false, invalid: true, code, discountAmount: 0, finalAmount: baseAmount, message: `Promo code "${code}" is invalid or inactive.` };
    }
    if (promo.expiresAt && Date.now() > Date.parse(promo.expiresAt)) {
        return { applied: false, invalid: true, code, discountAmount: 0, finalAmount: baseAmount, message: `Promo code "${code}" has expired.` };
    }
    const targetPlan = String(promo.planKey || 'all').toLowerCase();
    if (targetPlan !== 'all' && targetPlan !== normalizePlan(planId)) {
        return { applied: false, invalid: true, code, discountAmount: 0, finalAmount: baseAmount, message: `Promo code "${code}" does not apply to this plan.` };
    }
    const val = Math.max(0, Number(promo.value) || 0);
    const type = String(promo.type || 'flat').toLowerCase();
    let discountAmount = type === 'percent'
        ? Math.round((baseAmount * Math.min(100, val)) / 100)
        : Math.round(val);
    discountAmount = Math.max(0, Math.min(baseAmount, discountAmount));
    const finalAmount = Math.max(0, baseAmount - discountAmount);
    return {
        applied: true,
        invalid: false,
        code,
        discountAmount,
        finalAmount,
        message: `Promo "${code}" applied: -Rs. ${discountAmount.toLocaleString()}`
    };
}

function computeServerOrderPricing(state, user, planId, promoCode = '') {
    const targetPlan = normalizePlan(planId || 'gold');
    const goldCfg = state.plansConfig?.gold || { name: 'Padandas', price: 'Rs. 1,999', period: 'Until NEB Final Exam' };
    const diamondCfg = state.plansConfig?.diamond || { name: 'Topper', price: 'Rs. 2,999', period: 'Until NEB Final Exam' };
    const goldPrice = parsePlanNumericPrice(goldCfg.price, 'gold');
    const diamondPrice = parsePlanNumericPrice(diamondCfg.price, 'diamond');
    const currentPlan = normalizePlan(user?.plan || 'free');
    const isUpgrade = currentPlan === 'gold' && targetPlan === 'diamond';
    const fullPrice = targetPlan === 'diamond' ? diamondPrice : goldPrice;
    const baseAmount = isUpgrade ? Math.max(0, diamondPrice - goldPrice) : fullPrice;
    const promo = validatePromoCodeServer(state, promoCode, targetPlan, baseAmount);
    const planLabel = getPlanFriendlyLabel(state, targetPlan);
    const planPeriod = String((targetPlan === 'diamond' ? diamondCfg.period : goldCfg.period) || 'Until NEB Final Exam');
    return {
        planKey: targetPlan,
        planLabel,
        planPeriod,
        currentPlan,
        isUpgrade,
        fullPrice,
        baseAmount,
        discountAmount: promo.applied ? promo.discountAmount : 0,
        promoCode: promo.applied ? promo.code : '',
        promoResult: promo,
        finalAmount: promo.applied ? promo.finalAmount : baseAmount
    };
}

function signServerOrder({ orderId, userId, planId, expectedAmount, currency = 'NPR' }) {
    const payload = `${orderId}|${userId}|${planId}|${Number(expectedAmount)}|${currency}`;
    return crypto.createHmac('sha256', OTP_SECRET).update(payload).digest('hex');
}

function verifyServerOrderSignature({ orderId, userId, planId, expectedAmount, currency = 'NPR', signature }) {
    if (!signature || !orderId || !userId || !planId) return false;
    const expected = signServerOrder({ orderId, userId, planId, expectedAmount, currency });
    const a = Buffer.from(String(signature), 'hex');
    const b = Buffer.from(String(expected), 'hex');
    if (a.length === 0 || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function signEsewaV2Payload(totalAmount, transactionUuid, productCode, secretKey) {
    const msg = `total_amount=${totalAmount},transaction_uuid=${transactionUuid},product_code=${productCode}`;
    return crypto.createHmac('sha256', secretKey || ESEWA_SANDBOX_SECRET).update(msg).digest('base64');
}

function verifyEsewaV2EncodedData(encodedData, secretKey) {
    try {
        const jsonStr = Buffer.from(String(encodedData), 'base64').toString('utf8');
        const payload = JSON.parse(jsonStr);
        if (!payload || !payload.signed_field_names || !payload.signature) {
            return { valid: false, reason: 'Malformed eSewa callback payload.' };
        }
        const fields = String(payload.signed_field_names).split(',').map(f => f.trim()).filter(Boolean);
        const message = fields.map(f => `${f}=${payload[f] ?? ''}`).join(',');
        const expectedSig = crypto
            .createHmac('sha256', secretKey || ESEWA_SANDBOX_SECRET)
            .update(message)
            .digest('base64');
        const a = Buffer.from(String(payload.signature));
        const b = Buffer.from(String(expectedSig));
        if (a.length === 0 || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            return { valid: false, reason: 'Invalid eSewa cryptographic signature.' };
        }
        return { valid: true, payload };
    } catch (e) {
        return { valid: false, reason: 'Could not decode eSewa payload.' };
    }
}

function buildWhatsappConfirmMessage({ fullName, className, username, email, planName, amount, orderId, transactionId, wallet, senderInfo }) {
    const cleanAmt = String(amount || '').replace(/^Rs\.?\s*/i, '').trim() || '0';
    const lines = [
        'Namaste BPG Sir,',
        'I have completed my membership payment on BPG EDUCARE.',
        '',
        `Order ID: ${orderId || ''}`,
        `Student Name: ${fullName || 'Student'}`,
        `Username: ${username || 'student'}`,
        `Email: ${email || ''}`,
        `Class: ${className || 'Class 12'}`,
        `Plan: ${planName || 'Padandas'}`,
        `Amount Paid: Rs. ${cleanAmt}`,
        `Payment Method: ${wallet || 'eSewa'}`,
        `Transaction Code: ${transactionId || 'Not provided'}`
    ];
    if (senderInfo && String(senderInfo).trim()) {
        lines.push(`Paid From: ${String(senderInfo).trim()}`);
    }
    lines.push('', 'Please verify and activate my account. Thank you!');
    return lines.join('\n');
}

function buildWhatsappUrl(whatsappNumber, messageText) {
    const cleanNum = String(whatsappNumber || '9779866064252').replace(/[^\d]/g, '') || '9779866064252';
    return `https://wa.me/${cleanNum}?text=${encodeURIComponent(messageText)}`;
}

/**
 * Atomically updates a payment record and synchronizes the member's plan, paymentStatus, and auditLog.
 */
function applyPaymentLifecycleTransition({ state, roster, payment, nextStatus, actor, note, transactionId }) {
    const nowIso = new Date().toISOString();
    const prevStatus = normalizePaymentStatusValue(payment.status);
    const normalizedNext = normalizePaymentStatusValue(nextStatus);

    if (transactionId && String(transactionId).trim()) {
        payment.transactionId = String(transactionId).trim();
    }

    const canonical = canonicalizeEmail(payment.email);
    const acc = roster.accounts.find(
        a => (payment.userId && a.userId === payment.userId) || a.canonicalEmail === canonical
    );

    // Idempotency guard: if already paid and transition is 'paid', never double-extend expiry or duplicate audit logs!
    // If the account somehow lost its Premium plan (reconciliation), restore plan & original expiry without extending twice.
    if (prevStatus === 'paid' && normalizedNext === 'paid' && payment.activatedAt) {
        const targetPlan = normalizePlan(payment.planId || 'gold');
        if (acc && (PLAN_RANK[acc.plan] || 0) < (PLAN_RANK[targetPlan] || 0)) {
            acc.plan = targetPlan;
            acc.planExplicitlySet = true;
            acc.paymentStatus = 'paid';
            if (payment.expiresAt && !acc.planExpiresAt) acc.planExpiresAt = payment.expiresAt;
            appendAccountAuditEntry(acc, {
                actor,
                action: 'ENTITLEMENT_RECONCILED',
                details: `Reconciled missing ${targetPlan.toUpperCase()} access from verified order ${payment.orderId || payment.id} (original expiry preserved)`
            });
            writeRoster(roster);
        }
        return {
            idempotentReplay: true,
            payment,
            account: acc || null
        };
    }

    payment.status = normalizedNext;
    payment.updatedAt = nowIso;
    if (note) payment.adminNote = String(note).trim();

    const durationDays = Math.max(1, Number(payment.durationDays || 365));
    if (normalizedNext === 'paid') {
        payment.reviewedAt = nowIso;
        payment.activatedAt = payment.activatedAt || nowIso;
        payment.durationDays = durationDays;
        if (!payment.expiresAt) {
            const baseMs = Date.parse(payment.activatedAt) || Date.now();
            payment.expiresAt = new Date(baseMs + durationDays * 24 * 60 * 60 * 1000).toISOString();
        }
        payment.verifiedBy = actor;
        payment.activationCount = (Number(payment.activationCount) || 0) + 1;
    } else if (normalizedNext === 'failed' || normalizedNext === 'refunded') {
        payment.reviewedAt = nowIso;
        payment.verifiedBy = actor;
        if (normalizedNext === 'refunded') {
            payment.refundedAt = nowIso;
        }
    }

    if (acc) {
        payment.userId = acc.userId;
        if (normalizedNext === 'paid') {
            const targetPlan = normalizePlan(payment.planId || 'gold');
            const prevPlan = normalizePlan(acc.plan || 'free');
            // Never downgrade an already-active higher tier (e.g. Diamond) when confirming an older lower-tier (e.g. Gold) order
            const effectivePlan = (PLAN_RANK[prevPlan] || 0) > (PLAN_RANK[targetPlan] || 0) ? prevPlan : targetPlan;
            acc.plan = effectivePlan;
            acc.planExplicitlySet = true;
            acc.legacyAccess = false;
            acc.paymentStatus = 'paid';
            const candidateExp = payment.expiresAt || new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000).toISOString();
            const curExpMs = Date.parse(acc.planExpiresAt || '') || 0;
            const nextExpMs = Date.parse(candidateExp) || 0;
            acc.planExpiresAt = nextExpMs >= curExpMs ? candidateExp : acc.planExpiresAt;
            appendAccountAuditEntry(acc, {
                actor,
                action: 'PAYMENT_CONFIRMED_PLAN_ACTIVATED',
                details: `Order ${payment.orderId || payment.id} (Txn ${payment.transactionId || 'N/A'}, NPR ${payment.expectedAmount}) confirmed PAID. Plan ${String(prevPlan).toUpperCase()} -> ${effectivePlan.toUpperCase()} (expires ${acc.planExpiresAt.split('T')[0]})`
            });
            appendRosterAuditEntry(roster, {
                userId: acc.userId,
                email: acc.email,
                actor,
                action: 'PAYMENT_CONFIRMED_PLAN_ACTIVATED',
                details: `${acc.name}: ${effectivePlan.toUpperCase()} active via verified payment (${payment.transactionId || payment.orderId})`
            });
        } else if (normalizedNext === 'refunded') {
            // Check if member has any other active paid payment
            const otherPaid = (state.payments || []).find(
                p => p.id !== payment.id &&
                    ((p.userId && p.userId === acc.userId) || canonicalizeEmail(p.email) === canonical) &&
                    normalizePaymentStatusValue(p.status) === 'paid'
            );
            const fallbackPlan = otherPaid ? normalizePlan(otherPaid.planId) : 'free';
            const prevPlan = acc.plan;
            acc.plan = fallbackPlan;
            acc.planExplicitlySet = fallbackPlan !== 'free';
            acc.paymentStatus = otherPaid ? 'paid' : 'refunded';
            appendAccountAuditEntry(acc, {
                actor,
                action: 'PAYMENT_REFUNDED',
                details: `Order ${payment.orderId || payment.id} (Txn ${payment.transactionId || 'N/A'}) refunded. Plan ${String(prevPlan).toUpperCase()} -> ${fallbackPlan.toUpperCase()}`
            });
            appendRosterAuditEntry(roster, {
                userId: acc.userId,
                email: acc.email,
                actor,
                action: 'PAYMENT_REFUNDED',
                details: `${acc.name}: payment refunded; plan set to ${fallbackPlan.toUpperCase()}`
            });
        } else if (normalizedNext === 'failed') {
            const hasPaid = (state.payments || []).some(
                p => p.id !== payment.id &&
                    ((p.userId && p.userId === acc.userId) || canonicalizeEmail(p.email) === canonical) &&
                    normalizePaymentStatusValue(p.status) === 'paid'
            );
            if (!hasPaid && acc.plan === 'free') {
                acc.paymentStatus = 'failed';
            }
            appendAccountAuditEntry(acc, {
                actor,
                action: 'PAYMENT_FAILED',
                details: `Order ${payment.orderId || payment.id} marked FAILED (${payment.adminNote || 'Verification failed'})`
            });
            appendRosterAuditEntry(roster, {
                userId: acc.userId,
                email: acc.email,
                actor,
                action: 'PAYMENT_FAILED',
                details: `${acc.name}: payment ${payment.orderId || payment.id} marked FAILED`
            });
        } else if (normalizedNext === 'awaiting_confirmation' || normalizedNext === 'pending') {
            if (acc.plan === 'free') {
                acc.paymentStatus = normalizedNext;
            }
            appendAccountAuditEntry(acc, {
                actor,
                action: normalizedNext === 'awaiting_confirmation' ? 'PAYMENT_AWAITING_CONFIRMATION' : 'PAYMENT_PENDING',
                details: `Order ${payment.orderId || payment.id} (${payment.planName}, NPR ${payment.expectedAmount}) is ${normalizedNext.replace('_', ' ')}`
            });
        }
    }

    const savedRoster = writeRoster(roster);
    state.lastUpdated = nowIso;
    writeStateToDisk(state);
    const updatedAcc = acc
        ? (savedRoster.accounts.find(a => a.userId === acc.userId || a.canonicalEmail === canonical) || acc)
        : null;

    return {
        idempotentReplay: false,
        payment,
        account: updatedAcc
    };
}

async function queryEsewaProviderStatus({ esewaCfg, payment, simulatedStatus = '' }) {
    const expectedAmount = Number(payment.expectedAmount) || parsePlanNumericPrice(payment.amount, payment.planId);
    const orderId = payment.orderId || payment.id;

    // 1. If a sandbox simulated status is explicitly supplied (for automated provider lifecycle testing)
    if (simulatedStatus && esewaCfg.isSandbox) {
        const up = String(simulatedStatus).trim().toUpperCase();
        if (up === 'COMPLETE' || up === 'PAID') {
            return {
                providerReachable: true,
                providerStatus: 'COMPLETE',
                mappedStatus: 'paid',
                refId: payment.transactionId || ('ESW-TEST-' + orderId.slice(-8)),
                totalAmount: expectedAmount,
                currency: 'NPR',
                raw: { status: 'COMPLETE', total_amount: expectedAmount, transaction_uuid: orderId, mode: 'sandbox_test' }
            };
        }
        if (up === 'PENDING' || up === 'AMBIGUOUS' || up === 'DELAYED') {
            return {
                providerReachable: true,
                providerStatus: 'PENDING',
                mappedStatus: 'awaiting_confirmation',
                refId: payment.transactionId || '',
                totalAmount: expectedAmount,
                currency: 'NPR',
                raw: { status: 'PENDING', total_amount: expectedAmount, transaction_uuid: orderId, mode: 'sandbox_test' }
            };
        }
        if (up === 'REFUNDED' || up === 'FULL_REFUND') {
            return {
                providerReachable: true,
                providerStatus: 'FULL_REFUND',
                mappedStatus: 'refunded',
                refId: payment.transactionId || '',
                totalAmount: expectedAmount,
                currency: 'NPR',
                raw: { status: 'FULL_REFUND', total_amount: expectedAmount, transaction_uuid: orderId, mode: 'sandbox_test' }
            };
        }
        return {
            providerReachable: true,
            providerStatus: up,
            mappedStatus: 'failed',
            refId: payment.transactionId || '',
            totalAmount: expectedAmount,
            currency: 'NPR',
            raw: { status: up, total_amount: expectedAmount, transaction_uuid: orderId, mode: 'sandbox_test' }
        };
    }

    // 2. Live query against eSewa EpAy v2 Transaction Status API
    const url = `${esewaCfg.statusCheckBaseUrl}?product_code=${encodeURIComponent(esewaCfg.merchantCode)}&total_amount=${encodeURIComponent(expectedAmount)}&transaction_uuid=${encodeURIComponent(orderId)}`;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        const resp = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal
        });
        clearTimeout(timer);
        const data = await resp.json().catch(() => null);
        if (resp.ok && data && data.status) {
            const st = String(data.status).toUpperCase();
            const reportedAmount = Number(String(data.total_amount ?? expectedAmount).replace(/,/g, ''));
            if (st === 'COMPLETE' && reportedAmount === expectedAmount) {
                return {
                    providerReachable: true,
                    providerStatus: 'COMPLETE',
                    mappedStatus: 'paid',
                    refId: String(data.ref_id || payment.transactionId || '').trim(),
                    totalAmount: reportedAmount,
                    currency: 'NPR',
                    raw: data
                };
            }
            if (st === 'PENDING' || st === 'AMBIGUOUS') {
                return {
                    providerReachable: true,
                    providerStatus: st,
                    mappedStatus: 'awaiting_confirmation',
                    refId: String(data.ref_id || payment.transactionId || '').trim(),
                    totalAmount: reportedAmount,
                    currency: 'NPR',
                    raw: data
                };
            }
            if (st === 'FULL_REFUND' || st === 'PARTIAL_REFUND') {
                return {
                    providerReachable: true,
                    providerStatus: st,
                    mappedStatus: 'refunded',
                    refId: String(data.ref_id || payment.transactionId || '').trim(),
                    totalAmount: reportedAmount,
                    currency: 'NPR',
                    raw: data
                };
            }
            if (st === 'CANCELED' || st === 'NOT_FOUND' || st === 'FAILED') {
                return {
                    providerReachable: true,
                    providerStatus: st,
                    mappedStatus: payment.method === 'esewa_qr' ? 'awaiting_confirmation' : 'failed',
                    refId: String(data.ref_id || payment.transactionId || '').trim(),
                    totalAmount: reportedAmount,
                    currency: 'NPR',
                    raw: data
                };
            }
        }
    } catch (e) {
        // Network/timeout fallback: keep awaiting_confirmation
    }

    return {
        providerReachable: false,
        providerStatus: 'AWAITING_MANUAL_OR_GATEWAY_CONFIRMATION',
        mappedStatus: 'awaiting_confirmation',
        refId: payment.transactionId || '',
        totalAmount: expectedAmount,
        currency: 'NPR',
        raw: null
    };
}

module.exports = async function paymentsHandler(req, res) {
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

    const body = req.method === 'POST' ? (req.body || {}) : {};
    const isAdmin = isAdminPasskeyValid(req.headers['x-admin-passkey'] || body.adminPasskey);
    const state = readAcademyState();
    if (!Array.isArray(state.payments)) state.payments = [];
    const esewaCfg = getEsewaConfig(state);

    if (req.method === 'GET') {
        if (isAdmin) {
            res.statusCode = 200;
            res.end(JSON.stringify({
                ok: true,
                providerConfig: {
                    provider: 'eSewa',
                    merchantCode: esewaCfg.merchantCode,
                    envMode: esewaCfg.envMode,
                    isSandbox: esewaCfg.isSandbox,
                    hasLiveCredentials: esewaCfg.hasLiveCredentials
                },
                payments: state.payments
            }));
            return;
        }
        const user = resolveRequestUser(req);
        if (!user || !user.email) {
            res.statusCode = 401;
            res.end(JSON.stringify({ ok: false, error: 'Sign in required.' }));
            return;
        }
        const canonical = canonicalizeEmail(user.email);
        const mine = state.payments.filter(
            p => (p.userId && p.userId === user.userId) || canonicalizeEmail(p.email) === canonical
        );
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

    const parsedReqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const cleanPayPath = parsedReqUrl.pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
    let inferredAction = String(body.action || parsedReqUrl.searchParams.get('__action') || '').trim().toUpperCase();
    let routeOrderId = String(parsedReqUrl.searchParams.get('orderId') || '').trim();
    if (!inferredAction) {
        if (cleanPayPath === 'payments/create-order') inferredAction = 'CREATE_ORDER';
        else if (cleanPayPath === 'payments/validate-promo') inferredAction = 'VALIDATE_PROMO';
        else if (cleanPayPath === 'payments/submit-proof') inferredAction = 'SUBMIT_PROOF';
        else {
            const mApprove = cleanPayPath.match(/^admin\/payments\/([^/]+)\/approve$/i);
            const mReject = cleanPayPath.match(/^admin\/payments\/([^/]+)\/reject$/i);
            if (mApprove) { inferredAction = 'ADMIN_APPROVE_ORDER'; routeOrderId = decodeURIComponent(mApprove[1]); }
            else if (mReject) { inferredAction = 'ADMIN_REJECT_ORDER'; routeOrderId = decodeURIComponent(mReject[1]); }
        }
    }
    const action = inferredAction;
    const whatsappNumber = state.siteSettings?.whatsappNumber || '9779866064252';
    const esewaQrUrl = state.siteSettings?.esewaQrUrl || 'images/payment_qr_esewa.jpg';
    const bankQrUrl = state.siteSettings?.bankQrUrl || 'images/payment_qr_bank.jpg';
    const bankName = state.siteSettings?.bankName || 'Prime Commercial Bank Ltd. (Fonepay)';

    // -------------------------------------------------------------------------
    // 0. VALIDATE_PROMO (Server-side promo calculation for Step 1)
    // -------------------------------------------------------------------------
    if (action === 'VALIDATE_PROMO') {
        const user = resolveRequestUser(req);
        if (!user || !user.email) {
            res.statusCode = 401;
            res.end(JSON.stringify({ ok: false, error: 'Please sign in first.' }));
            return;
        }
        const planId = normalizePlan(body.planId || body.planKey || 'gold');
        if (planId === 'free') {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: 'Please select Padandas or Topper plan.' }));
            return;
        }
        const pricing = computeServerOrderPricing(state, user, planId, body.promoCode || '');
        if (body.promoCode && pricing.promoResult.invalid) {
            res.statusCode = 400;
            res.end(JSON.stringify({
                ok: false,
                valid: false,
                error: pricing.promoResult.message,
                pricing
            }));
            return;
        }
        // If orderId was passed, also update the open created order's promo/finalAmount server-side
        const openOrderId = String(body.orderId || '').trim();
        if (openOrderId) {
            const ord = state.payments.find(p => (p.orderId === openOrderId || p.id === openOrderId) && (p.userId === user.userId || p.canonicalEmail === canonicalizeEmail(user.email)));
            if (ord && (ord.status === 'created' || ord.status === 'pending')) {
                ord.baseAmount = pricing.baseAmount;
                ord.discountAmount = pricing.discountAmount;
                ord.promoCode = pricing.promoCode;
                ord.finalAmount = pricing.finalAmount;
                ord.expectedAmount = pricing.finalAmount;
                ord.amount = `Rs. ${pricing.finalAmount.toLocaleString()}`;
                ord.updatedAt = new Date().toISOString();
                writeStateToDisk(state);
            }
        }
        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            valid: Boolean(pricing.promoResult.applied || !body.promoCode),
            message: pricing.promoResult.message || 'Price updated.',
            pricing
        }));
        return;
    }

    // -------------------------------------------------------------------------
    // 1. CREATE_ORDER / CREATE_PAYMENT (Server-authoritative pricing, upgrade diff & BPG-YYYY-XXXXX)
    // -------------------------------------------------------------------------
    if (action === 'CREATE_ORDER' || action === 'CREATE_PAYMENT') {
        const user = resolveRequestUser(req);
        if (!user || !user.email) {
            res.statusCode = 401;
            res.end(JSON.stringify({ ok: false, error: 'Please sign in before purchasing a plan.' }));
            return;
        }

        const planId = normalizePlan(body.planId || body.planKey || 'gold');
        if (planId === 'free') {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: 'Please select Padandas or Topper plan to purchase.' }));
            return;
        }

        const pricing = computeServerOrderPricing(state, user, planId, body.promoCode || '');
        const planName = pricing.planLabel;
        const expectedAmount = pricing.finalAmount;
        const currency = 'NPR';
        const formattedAmount = `Rs. ${expectedAmount.toLocaleString()}`;

        const email = String(user.email).trim().toLowerCase();
        const canonical = canonicalizeEmail(email);
        const userId = deriveStableUserId(canonical, user.userId);
        const fullName = String(user.name || body.fullName || 'Student').trim();
        const classKey = gradeToClassKey(user.classKey || user.grade);
        const className = normalizeGradeName(classKey);
        const username = String(user.username || email.split('@')[0] || 'student').trim();
        const transactionId = String(body.transactionId || body.txCode || '').trim().toUpperCase();
        const wallet = String(body.wallet || body.method || 'eSewa').trim();
        const senderInfo = String(body.senderInfo || '').trim();
        const clientOrderId = String(body.orderId || '').trim();

        // Idempotency check: reuse existing order if matching orderId or non-empty transactionId exists
        let existingPayment = null;
        if (clientOrderId) {
            existingPayment = state.payments.find(p => p.orderId === clientOrderId || p.id === clientOrderId);
        }
        if (!existingPayment && transactionId) {
            existingPayment = state.payments.find(
                p => {
                    const pTx = String(p.txCode || p.transactionId || '').trim().toUpperCase();
                    const pSt = normalizePaymentStatusValue(p.status);
                    return pTx && pTx === transactionId && (pSt === 'pending' || pSt === 'awaiting_confirmation' || pSt === 'paid');
                }
            );
            if (existingPayment && existingPayment.canonicalEmail !== canonical) {
                res.statusCode = 409;
                res.end(JSON.stringify({
                    ok: false,
                    code: 'DUPLICATE_TRANSACTION_ID',
                    error: 'This Transaction Code has already been submitted in another pending or verified order.'
                }));
                return;
            }
        }

        const roster = readRoster();
        if (existingPayment) {
            if (transactionId && !existingPayment.txCode) {
                existingPayment.txCode = transactionId;
                existingPayment.transactionId = transactionId;
            }
            if (wallet) existingPayment.wallet = wallet;
            if (senderInfo) existingPayment.senderInfo = senderInfo;
            if (action === 'CREATE_PAYMENT' && (existingPayment.status === 'created' || existingPayment.status === 'pending') && transactionId) {
                applyPaymentLifecycleTransition({
                    state,
                    roster,
                    payment: existingPayment,
                    nextStatus: 'pending',
                    actor: `${fullName} (Student)`,
                    note: `Transaction code ${transactionId} (${wallet}) submitted for admin verification.`,
                    transactionId
                });
            } else {
                state.lastUpdated = new Date().toISOString();
                writeStateToDisk(state);
            }

            const waMessage = buildWhatsappConfirmMessage({
                fullName,
                className,
                username,
                email,
                planName: existingPayment.planLabel || existingPayment.planName,
                amount: existingPayment.amount,
                orderId: existingPayment.orderId,
                transactionId: existingPayment.txCode || existingPayment.transactionId,
                wallet: existingPayment.wallet || wallet,
                senderInfo: existingPayment.senderInfo || senderInfo
            });

            res.statusCode = 200;
            res.end(JSON.stringify({
                ok: true,
                idempotentReplay: true,
                payment: existingPayment,
                order: {
                    orderId: existingPayment.orderId,
                    paymentId: existingPayment.id,
                    userId: existingPayment.userId,
                    planId: existingPayment.planId,
                    planKey: existingPayment.planKey || existingPayment.planId,
                    planName: existingPayment.planLabel || existingPayment.planName,
                    planLabel: existingPayment.planLabel || existingPayment.planName,
                    planPeriod: pricing.planPeriod,
                    isUpgrade: Boolean(existingPayment.isUpgrade),
                    baseAmount: Number(existingPayment.baseAmount ?? existingPayment.expectedAmount),
                    discountAmount: Number(existingPayment.discountAmount || 0),
                    promoCode: existingPayment.promoCode || '',
                    finalAmount: Number(existingPayment.finalAmount ?? existingPayment.expectedAmount),
                    expectedAmount: Number(existingPayment.finalAmount ?? existingPayment.expectedAmount),
                    currency: existingPayment.currency || 'NPR',
                    durationDays: Number(existingPayment.durationDays || 365),
                    orderSignature: existingPayment.orderSignature
                },
                whatsappNumber,
                whatsappUrl: buildWhatsappUrl(whatsappNumber, waMessage),
                whatsappMessage: waMessage,
                esewaQrUrl,
                bankQrUrl,
                bankName
            }));
            return;
        }

        const orderId = generateReadableOrderId(state.payments);
        const orderSignature = signServerOrder({ orderId, userId, planId, expectedAmount, currency });
        const initialStatus = (action === 'CREATE_PAYMENT' && transactionId) ? 'pending' : 'created';
        const nowIso = new Date().toISOString();

        const payment = {
            id: 'pay_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            orderId,
            userId,
            studentName: fullName,
            fullName,
            username,
            email,
            canonicalEmail: canonical,
            classKey,
            className,
            planKey: planId,
            planId,
            planLabel: planName,
            planName,
            isUpgrade: pricing.isUpgrade,
            baseAmount: pricing.baseAmount,
            discountAmount: pricing.discountAmount,
            promoCode: pricing.promoCode,
            finalAmount: expectedAmount,
            expectedAmount,
            amount: formattedAmount,
            currency,
            wallet: wallet || 'eSewa',
            method: wallet || 'eSewa',
            txCode: transactionId,
            transactionId,
            senderInfo,
            orderSignature,
            status: initialStatus,
            rejectionReason: '',
            verifiedBy: '',
            verifiedAt: '',
            adminNote: initialStatus === 'pending'
                ? `Transaction code ${transactionId} submitted; pending admin verification.`
                : 'Order created on server; awaiting QR payment and transaction code.',
            createdAt: nowIso,
            updatedAt: nowIso,
            reviewedAt: ''
        };

        state.payments.unshift(payment);
        if (initialStatus === 'pending') {
            applyPaymentLifecycleTransition({
                state,
                roster,
                payment,
                nextStatus: 'pending',
                actor: `${fullName} (Student)`,
                note: payment.adminNote,
                transactionId
            });
        } else {
            state.lastUpdated = nowIso;
            writeStateToDisk(state);
        }

        const waMessage = buildWhatsappConfirmMessage({
            fullName,
            className,
            username,
            email,
            planName,
            amount: formattedAmount,
            orderId,
            transactionId,
            wallet: payment.wallet,
            senderInfo
        });

        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            idempotentReplay: false,
            payment,
            order: {
                orderId,
                paymentId: payment.id,
                userId,
                planId,
                planKey: planId,
                planName,
                planLabel: planName,
                planPeriod: pricing.planPeriod,
                isUpgrade: pricing.isUpgrade,
                baseAmount: pricing.baseAmount,
                discountAmount: pricing.discountAmount,
                promoCode: pricing.promoCode,
                finalAmount: expectedAmount,
                expectedAmount,
                currency,
                durationDays: Number(payment.durationDays || 365),
                orderSignature
            },
            whatsappNumber,
            whatsappUrl: buildWhatsappUrl(whatsappNumber, waMessage),
            whatsappMessage: waMessage,
            esewaQrUrl,
            bankQrUrl,
            bankName
        }));
        return;
    }

    // -------------------------------------------------------------------------
    // 1B. SUBMIT_PROOF (Step 2 -> Step 3: Validate TxCode, block duplicates, save pending, prepare WhatsApp)
    // -------------------------------------------------------------------------
    if (action === 'SUBMIT_PROOF') {
        const user = resolveRequestUser(req);
        if (!user || !user.email) {
            res.statusCode = 401;
            res.end(JSON.stringify({ ok: false, error: 'Please sign in before submitting payment proof.' }));
            return;
        }
        const canonical = canonicalizeEmail(user.email);
        const orderId = String(body.orderId || body.paymentId || '').trim();
        const rawTx = String(body.txCode || body.transactionId || '').trim().toUpperCase().replace(/\s+/g, '');
        const wallet = String(body.wallet || body.paymentMethod || 'eSewa').trim().slice(0, 60);
        const senderInfo = String(body.senderInfo || '').trim().slice(0, 100);
        const promoCode = String(body.promoCode || '').trim().toUpperCase();

        if (!rawTx || rawTx.length < 4 || rawTx.length > 50 || !/^[A-Z0-9._\-/]+$/.test(rawTx)) {
            res.statusCode = 400;
            res.end(JSON.stringify({
                ok: false,
                code: 'INVALID_TX_CODE',
                error: 'Please enter a valid Transaction Code (4–50 characters, letters and numbers only).'
            }));
            return;
        }

        const allowedWallets = ['eSewa', 'Fonepay / Mobile Banking', 'Khalti', 'ConnectIPS'];
        const cleanWallet = allowedWallets.includes(wallet) ? wallet : (wallet || 'eSewa');

        let payment = orderId
            ? state.payments.find(p => (p.orderId === orderId || p.id === orderId) && ((p.userId && p.userId === user.userId) || p.canonicalEmail === canonical))
            : null;

        // Duplicate TxCode protection across ALL other pending/verified orders!
        const dupOrder = state.payments.find(p => {
            if (!p) return false;
            if (payment && (p.id === payment.id || p.orderId === payment.orderId)) return false;
            const pTx = String(p.txCode || p.transactionId || '').trim().toUpperCase();
            if (!pTx || pTx !== rawTx) return false;
            const st = String(p.status || '').toLowerCase();
            return st === 'pending' || st === 'awaiting_confirmation' || st === 'verified' || st === 'paid';
        });
        if (dupOrder) {
            res.statusCode = 409;
            res.end(JSON.stringify({
                ok: false,
                code: 'DUPLICATE_TX_CODE',
                error: `Transaction Code "${rawTx}" has already been submitted in another pending or verified order. Please check your receipt or contact BPG Sir on WhatsApp.`
            }));
            return;
        }

        const roster = readRoster();
        const nowIso = new Date().toISOString();
        const planId = normalizePlan(payment?.planKey || payment?.planId || body.planId || 'gold');
        const pricing = computeServerOrderPricing(state, user, planId, promoCode || payment?.promoCode || '');
        const fullName = String(user.name || 'Student').trim();
        const classKey = gradeToClassKey(user.classKey || user.grade);
        const className = normalizeGradeName(classKey);
        const username = String(user.username || user.email.split('@')[0] || 'student').trim();
        const formattedAmount = `Rs. ${pricing.finalAmount.toLocaleString()}`;

        if (!payment) {
            const newOrderId = generateReadableOrderId(state.payments);
            payment = {
                id: 'pay_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                orderId: newOrderId,
                userId: deriveStableUserId(canonical, user.userId),
                studentName: fullName,
                fullName,
                username,
                email: String(user.email).trim().toLowerCase(),
                canonicalEmail: canonical,
                classKey,
                className,
                planKey: planId,
                planId,
                planLabel: pricing.planLabel,
                planName: pricing.planLabel,
                isUpgrade: pricing.isUpgrade,
                baseAmount: pricing.baseAmount,
                discountAmount: pricing.discountAmount,
                promoCode: pricing.promoCode,
                finalAmount: pricing.finalAmount,
                expectedAmount: pricing.finalAmount,
                amount: formattedAmount,
                currency: 'NPR',
                wallet: cleanWallet,
                method: cleanWallet,
                txCode: rawTx,
                transactionId: rawTx,
                senderInfo,
                orderSignature: signServerOrder({ orderId: newOrderId, userId: deriveStableUserId(canonical, user.userId), planId, expectedAmount: pricing.finalAmount, currency: 'NPR' }),
                status: 'pending',
                rejectionReason: '',
                verifiedBy: '',
                verifiedAt: '',
                adminNote: `Submitted ${cleanWallet} TxCode ${rawTx}; pending admin verification.`,
                createdAt: nowIso,
                updatedAt: nowIso,
                reviewedAt: ''
            };
            state.payments.unshift(payment);
        } else {
            if (normalizePaymentStatusValue(payment.status) === 'paid') {
                res.statusCode = 409;
                res.end(JSON.stringify({ ok: false, error: 'This order is already verified.' }));
                return;
            }
            payment.txCode = rawTx;
            payment.transactionId = rawTx;
            payment.wallet = cleanWallet;
            payment.method = cleanWallet;
            payment.senderInfo = senderInfo;
            payment.studentName = fullName;
            payment.fullName = fullName;
            payment.username = username;
            payment.classKey = classKey;
            payment.className = className;
            payment.planKey = planId;
            payment.planId = planId;
            payment.planLabel = pricing.planLabel;
            payment.planName = pricing.planLabel;
            payment.isUpgrade = pricing.isUpgrade;
            payment.baseAmount = pricing.baseAmount;
            payment.discountAmount = pricing.discountAmount;
            payment.promoCode = pricing.promoCode;
            payment.finalAmount = pricing.finalAmount;
            payment.expectedAmount = pricing.finalAmount;
            payment.amount = formattedAmount;
            payment.status = 'pending';
            payment.rejectionReason = '';
            payment.updatedAt = nowIso;
            payment.adminNote = `Submitted ${cleanWallet} TxCode ${rawTx}; pending admin verification.`;
        }

        const acc = roster.accounts.find(a => (payment.userId && a.userId === payment.userId) || a.canonicalEmail === canonical);
        if (acc) {
            payment.userId = acc.userId;
            if (normalizePlan(acc.plan) === 'free') {
                acc.paymentStatus = 'pending';
            }
            appendAccountAuditEntry(acc, {
                actor: `${fullName} (Student)`,
                action: 'PAYMENT_PROOF_SUBMITTED',
                details: `Order ${payment.orderId} (${payment.planLabel}, ${payment.amount}, ${cleanWallet}, TxCode ${rawTx}) submitted for verification`
            });
            writeRoster(roster);
        }
        state.lastUpdated = nowIso;
        writeStateToDisk(state);

        const waMessage = buildWhatsappConfirmMessage({
            fullName: payment.studentName || fullName,
            className: payment.className || className,
            username: payment.username || username,
            email: payment.email,
            planName: payment.planLabel || payment.planName,
            amount: payment.amount,
            orderId: payment.orderId,
            transactionId: payment.txCode,
            wallet: payment.wallet,
            senderInfo: payment.senderInfo
        });

        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            payment,
            whatsappNumber,
            whatsappMessage: waMessage,
            whatsappUrl: buildWhatsappUrl(whatsappNumber, waMessage),
            message: 'Order saved! Send the ready-made WhatsApp message for fast verification.'
        }));
        return;
    }

    // -------------------------------------------------------------------------
    // 2. SERVER-VERIFIED GATEWAY CALLBACK / WEBHOOK (VERIFY_GATEWAY_PAYMENT)
    //    A browser redirect alone NEVER unlocks paid access!
    // -------------------------------------------------------------------------
    if (action === 'VERIFY_GATEWAY_PAYMENT' || action === 'PROVIDER_WEBHOOK') {
        const user = resolveRequestUser(req);
        const orderId = String(body.orderId || body.transaction_uuid || '').trim();
        const transactionId = String(body.transactionId || body.refId || body.transaction_code || '').trim();
        const encodedData = String(body.encodedData || body.esewaData || '').trim();

        // Find original server-created order
        let payment = null;
        if (orderId) {
            payment = state.payments.find(p => p.orderId === orderId || p.id === orderId);
        }
        if (!payment && transactionId) {
            payment = state.payments.find(p => p.transactionId && p.transactionId === transactionId);
        }

        if (!payment) {
            res.statusCode = 403;
            res.end(JSON.stringify({
                ok: false,
                code: 'UNVERIFIED_REDIRECT_NO_ORDER',
                error: 'A browser redirect alone cannot unlock paid access. No matching server-created payment order was found.'
            }));
            return;
        }

        // Ensure caller owns this order (unless called by admin or signed provider payload)
        if (!isAdmin && user && payment.userId && user.userId !== payment.userId && payment.canonicalEmail !== user.canonicalEmail) {
            res.statusCode = 403;
            res.end(JSON.stringify({ ok: false, error: 'Order does not belong to the signed-in account.' }));
            return;
        }

        // Idempotency: if already paid, return existing verified state without re-activating
        if (normalizePaymentStatusValue(payment.status) === 'paid' && !body.providerSimulatedStatus) {
            const roster = readRoster();
            const acc = roster.accounts.find(a => a.userId === payment.userId || a.canonicalEmail === payment.canonicalEmail);
            res.statusCode = 200;
            res.end(JSON.stringify({
                ok: true,
                idempotentReplay: true,
                alreadyProcessed: true,
                payment,
                user: acc || user || null,
                sessionToken: acc ? issueStudentSessionToken(acc) : ''
            }));
            return;
        }

        let verifiedByProvider = false;
        let targetLifecycleStatus = 'awaiting_confirmation';
        let providerRefId = transactionId || payment.transactionId || '';
        let verificationDetails = '';

        // Path A: Signed eSewa v2 base64 response payload
        if (encodedData) {
            const check = verifyEsewaV2EncodedData(encodedData, esewaCfg.secretKey);
            if (!check.valid) {
                res.statusCode = 400;
                res.end(JSON.stringify({
                    ok: false,
                    code: 'INVALID_PROVIDER_SIGNATURE',
                    error: check.reason
                }));
                return;
            }
            const pData = check.payload;
            const reportedOrder = String(pData.transaction_uuid || '').trim();
            const reportedAmount = Number(String(pData.total_amount || '0').replace(/,/g, ''));
            const reportedStatus = String(pData.status || '').toUpperCase();
            providerRefId = String(pData.transaction_code || providerRefId).trim();

            if (reportedOrder !== payment.orderId) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, code: 'ORDER_MISMATCH', error: 'Provider transaction_uuid does not match original order.' }));
                return;
            }
            if (reportedAmount !== Number(payment.expectedAmount)) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, code: 'AMOUNT_MISMATCH', error: `Provider amount (${reportedAmount}) does not match order amount (${payment.expectedAmount}).` }));
                return;
            }
            verifiedByProvider = true;
            if (reportedStatus === 'COMPLETE') {
                targetLifecycleStatus = 'paid';
                verificationDetails = `Verified via signed eSewa v2 callback (Ref ${providerRefId}, NPR ${reportedAmount}).`;
            } else if (reportedStatus === 'PENDING' || reportedStatus === 'AMBIGUOUS') {
                targetLifecycleStatus = 'awaiting_confirmation';
                verificationDetails = `eSewa callback reported ${reportedStatus}; awaiting confirmation.`;
            } else if (reportedStatus === 'FULL_REFUND' || reportedStatus === 'REFUNDED') {
                targetLifecycleStatus = 'refunded';
                verificationDetails = `eSewa callback reported ${reportedStatus}.`;
            } else {
                targetLifecycleStatus = 'failed';
                verificationDetails = `eSewa callback reported ${reportedStatus || 'FAILED'}.`;
            }
        }
        // Path B: Sandbox / Provider Test Environment verification with server-issued orderSignature
        else if (esewaCfg.isSandbox && body.orderSignature) {
            const sigValid = verifyServerOrderSignature({
                orderId: payment.orderId,
                userId: payment.userId,
                planId: payment.planId,
                expectedAmount: payment.expectedAmount,
                currency: payment.currency || 'NPR',
                signature: body.orderSignature
            });
            if (!sigValid) {
                res.statusCode = 403;
                res.end(JSON.stringify({
                    ok: false,
                    code: 'INVALID_ORDER_SIGNATURE',
                    error: 'Invalid server order signature. Paid access denied.'
                }));
                return;
            }
            const providedAmount = body.amount !== undefined ? Number(String(body.amount).replace(/[^0-9.]/g, '')) : Number(payment.expectedAmount);
            const providedCurrency = String(body.currency || 'NPR').toUpperCase();
            if (providedAmount !== Number(payment.expectedAmount) || providedCurrency !== 'NPR') {
                res.statusCode = 400;
                res.end(JSON.stringify({
                    ok: false,
                    code: 'ORDER_AMOUNT_OR_CURRENCY_MISMATCH',
                    error: `Amount/currency mismatch: expected NPR ${payment.expectedAmount}, received ${providedCurrency} ${providedAmount}.`
                }));
                return;
            }

            const providerCheck = await queryEsewaProviderStatus({
                esewaCfg,
                payment,
                simulatedStatus: body.providerSimulatedStatus || ''
            });

            if (body.providerSimulatedStatus || providerCheck.providerReachable) {
                verifiedByProvider = true;
                targetLifecycleStatus = providerCheck.mappedStatus;
                providerRefId = providerRefId || providerCheck.refId;
                verificationDetails = `Provider status verified (${providerCheck.providerStatus}, Ref ${providerRefId || 'N/A'}, NPR ${payment.expectedAmount}).`;
            }
        }

        if (!verifiedByProvider) {
            res.statusCode = 403;
            res.end(JSON.stringify({
                ok: false,
                code: 'UNVERIFIED_REDIRECT',
                error: 'A browser redirect alone cannot unlock paid access. Server-side provider verification is required.'
            }));
            return;
        }

        // Prevent duplicate transactionId across different orders
        if (providerRefId) {
            const duplicateTxnOrder = state.payments.find(
                p => p.id !== payment.id && p.transactionId && p.transactionId === providerRefId && normalizePaymentStatusValue(p.status) === 'paid'
            );
            if (duplicateTxnOrder) {
                res.statusCode = 409;
                res.end(JSON.stringify({
                    ok: false,
                    code: 'TRANSACTION_ALREADY_USED',
                    error: 'This provider transaction reference is already linked to another confirmed order.'
                }));
                return;
            }
        }

        const roster = readRoster();
        const transition = applyPaymentLifecycleTransition({
            state,
            roster,
            payment,
            nextStatus: targetLifecycleStatus,
            actor: 'eSewa Provider Verification',
            note: verificationDetails,
            transactionId: providerRefId
        });

        const updatedUser = transition.account || user;
        const sessionToken = updatedUser ? issueStudentSessionToken(updatedUser) : '';

        const waMessage = buildWhatsappConfirmMessage({
            fullName: payment.fullName,
            className: payment.className,
            username: payment.username,
            email: payment.email,
            planName: payment.planName,
            amount: payment.amount,
            orderId: payment.orderId,
            transactionId: payment.transactionId
        });

        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            idempotentReplay: transition.idempotentReplay,
            payment: transition.payment,
            user: updatedUser,
            sessionToken,
            whatsappNumber,
            whatsappUrl: buildWhatsappUrl(whatsappNumber, waMessage),
            whatsappMessage: waMessage
        }));
        return;
    }

    // -------------------------------------------------------------------------
    // 2B. STUDENT: CHECK PENDING PAYMENT STATUS WITHOUT PAYING AGAIN
    // -------------------------------------------------------------------------
    if (action === 'CHECK_MY_PAYMENT_STATUS') {
        const user = resolveRequestUser(req);
        if (!user || !user.email) {
            res.statusCode = 401;
            res.end(JSON.stringify({ ok: false, error: 'Please sign in to check your payment status.' }));
            return;
        }
        const canonical = canonicalizeEmail(user.email);
        const orderId = String(body.orderId || body.paymentId || '').trim();
        const myPayments = (state.payments || []).filter(
            p => (p.userId && p.userId === user.userId) || p.canonicalEmail === canonical
        );
        const payment = orderId
            ? myPayments.find(p => p.id === orderId || p.orderId === orderId)
            : myPayments[0];
        if (!payment) {
            res.statusCode = 404;
            res.end(JSON.stringify({ ok: false, error: 'Payment order not found for your account.' }));
            return;
        }
        const currentSt = normalizePaymentStatusValue(payment.status);
        if (currentSt === 'paid' || currentSt === 'refunded') {
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, payment, myPayments, status: currentSt, message: currentSt === 'paid' ? 'Payment is confirmed and your plan is active.' : 'Payment was refunded.' }));
            return;
        }
        const check = await queryEsewaProviderStatus({
            esewaCfg,
            payment,
            simulatedStatus: body.simulatedStatus || ''
        });
        payment.lastProviderCheckAt = new Date().toISOString();
        payment.lastProviderStatus = check.providerStatus;
        const roster = readRoster();
        const transition = applyPaymentLifecycleTransition({
            state,
            roster,
            payment,
            nextStatus: check.mappedStatus,
            actor: `${user.name || 'Student'} (Status Check)`,
            note: check.providerReachable
                ? `Provider returned ${check.providerStatus} (NPR ${check.totalAmount}).`
                : 'Still pending confirmation — no need to pay again.',
            transactionId: check.refId || payment.transactionId
        });
        const updatedUser = transition.account ? (({ passkey, ...safe }) => safe)(transition.account) : null;
        const sessionToken = transition.account ? issueStudentSessionToken(transition.account) : '';
        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            payment: transition.payment,
            status: transition.payment.status,
            user: updatedUser,
            sessionToken,
            message: transition.payment.status === 'paid'
                ? 'Payment confirmed! Your Premium plan is now active.'
                : (transition.payment.status === 'failed'
                    ? 'Payment was unsuccessful. You can safely retry checkout.'
                    : 'Payment is still pending confirmation. You do not need to pay again.')
        }));
        return;
    }

    // -------------------------------------------------------------------------
    // 3. ADMIN ACTIONS: VERIFY, REJECT/FAIL, REFUND, CHECK PROVIDER, RECONCILE, DELETE
    // -------------------------------------------------------------------------
    if (!isAdmin) {
        res.statusCode = 401;
        res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Admin passkey required.' }));
        return;
    }

    const paymentId = String(routeOrderId || body.paymentId || body.orderId || '').trim();
    const adminActor = String(body.adminActor || req.headers['x-admin-actor'] || 'Admin Console').trim();

    if (action === 'ADMIN_RECONCILE_ENTITLEMENTS') {
        const roster = readRoster();
        let reconciledCount = 0;
        const reconciledEmails = [];
        for (const p of (state.payments || [])) {
            if (!p || normalizePaymentStatusValue(p.status) !== 'paid') continue;
            const targetPlan = normalizePlan(p.planId || 'gold');
            const canonical = canonicalizeEmail(p.email);
            const acc = roster.accounts.find(a => (p.userId && a.userId === p.userId) || a.canonicalEmail === canonical);
            if (!acc) continue;
            const needsPlan = (PLAN_RANK[acc.plan] || 0) < (PLAN_RANK[targetPlan] || 0);
            const needsExpiry = Boolean(p.expiresAt && !acc.planExpiresAt);
            if (needsPlan || needsExpiry) {
                if (needsPlan) {
                    acc.plan = targetPlan;
                    acc.planExplicitlySet = true;
                    acc.paymentStatus = 'paid';
                }
                if (!p.expiresAt) {
                    const baseMs = Date.parse(p.activatedAt || p.reviewedAt || p.createdAt) || Date.now();
                    p.expiresAt = new Date(baseMs + (Number(p.durationDays || 365) * 24 * 60 * 60 * 1000)).toISOString();
                }
                acc.planExpiresAt = acc.planExpiresAt || p.expiresAt;
                appendAccountAuditEntry(acc, {
                    actor: adminActor,
                    action: 'ENTITLEMENT_RECONCILED',
                    details: `Reconciled ${targetPlan.toUpperCase()} access from verified payment ${p.orderId || p.id}`
                });
                reconciledCount++;
                reconciledEmails.push(acc.userId);
            }
        }
        if (reconciledCount > 0) {
            writeRoster(roster);
            writeStateToDisk(state);
        }
        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            reconciledCount,
            reconciledUserIds: reconciledEmails,
            payments: state.payments,
            message: reconciledCount > 0
                ? `Reconciled ${reconciledCount} confirmed payment entitlement(s).`
                : 'All confirmed payments already have active Premium entitlements.'
        }));
        return;
    }

    if (action === 'ADMIN_DELETE_PAYMENT') {
        state.payments = state.payments.filter(p => p.id !== paymentId && p.orderId !== paymentId);
        state.lastUpdated = new Date().toISOString();
        writeStateToDisk(state);
        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            message: 'Payment record deleted.',
            payments: state.payments
        }));
        return;
    }

    const payment = state.payments.find(p => p.id === paymentId || p.orderId === paymentId);
    if (!payment) {
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, error: 'Payment record not found.' }));
        return;
    }

    if (action === 'ADMIN_CHECK_PROVIDER_STATUS') {
        const check = await queryEsewaProviderStatus({
            esewaCfg,
            payment,
            simulatedStatus: body.simulatedStatus || ''
        });
        payment.lastProviderCheckAt = new Date().toISOString();
        payment.lastProviderStatus = check.providerStatus;

        const roster = readRoster();
        const transition = applyPaymentLifecycleTransition({
            state,
            roster,
            payment,
            nextStatus: check.mappedStatus,
            actor: `${adminActor} (Provider Status Check)`,
            note: check.providerReachable
                ? `Provider returned ${check.providerStatus} (NPR ${check.totalAmount}).`
                : 'Provider check queued; awaiting eSewa confirmation.',
            transactionId: check.refId || payment.transactionId
        });

        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            providerCheck: check,
            message: check.providerReachable
                ? `Provider status: ${check.providerStatus} -> Payment marked as ${transition.payment.status.toUpperCase()}.`
                : 'Transaction is awaiting confirmation from eSewa provider.',
            payment: transition.payment,
            payments: state.payments
        }));
        return;
    }

    if (action === 'ADMIN_VERIFY_PAYMENT' || action === 'ADMIN_APPROVE_ORDER') {
        const alreadyPaid = normalizePaymentStatusValue(payment.status) === 'paid';
        const targetPlan = normalizePlan(body.planId || payment.planKey || payment.planId || 'gold');
        payment.planId = targetPlan;
        payment.planKey = targetPlan;
        const roster = readRoster();
        const transition = applyPaymentLifecycleTransition({
            state,
            roster,
            payment,
            nextStatus: 'paid',
            actor: adminActor,
            note: String(body.adminNote || 'Payment verified and plan unlocked by Admin.').trim(),
            transactionId: body.transactionId || payment.txCode || payment.transactionId
        });
        transition.payment.verifiedAt = transition.payment.verifiedAt || transition.payment.reviewedAt || new Date().toISOString();
        transition.payment.verifiedBy = transition.payment.verifiedBy || adminActor;
        transition.payment.rejectionReason = '';
        writeStateToDisk(state);

        const friendlyPlan = getPlanFriendlyLabel(state, targetPlan);
        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            idempotentReplay: Boolean(alreadyPaid || transition.idempotentReplay),
            message: alreadyPaid
                ? `Order ${payment.orderId || payment.id} was already verified (no duplicate activation).`
                : `Order ${payment.orderId || payment.id} verified and ${friendlyPlan} unlocked for ${payment.email}.`,
            payment: transition.payment,
            payments: state.payments
        }));
        return;
    }

    if (action === 'ADMIN_REJECT_PAYMENT' || action === 'ADMIN_REJECT_ORDER' || action === 'ADMIN_FAIL_PAYMENT') {
        const reason = String(body.rejectionReason || body.reason || body.adminNote || 'Payment verification failed or transaction code not found.').trim();
        payment.rejectionReason = reason;
        const roster = readRoster();
        const transition = applyPaymentLifecycleTransition({
            state,
            roster,
            payment,
            nextStatus: 'failed',
            actor: adminActor,
            note: reason,
            transactionId: body.transactionId || payment.txCode || payment.transactionId
        });
        transition.payment.rejectionReason = reason;
        writeStateToDisk(state);

        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            message: `Order ${payment.orderId || payment.id} rejected: ${reason}`,
            payment: transition.payment,
            payments: state.payments
        }));
        return;
    }

    if (action === 'ADMIN_REFUND_PAYMENT') {
        const roster = readRoster();
        const transition = applyPaymentLifecycleTransition({
            state,
            roster,
            payment,
            nextStatus: 'refunded',
            actor: adminActor,
            note: String(body.adminNote || 'Payment refunded and subscription access reverted.').trim(),
            transactionId: body.transactionId || payment.transactionId
        });

        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            message: `Payment marked as Refunded and ${payment.email} plan access updated.`,
            payment: transition.payment,
            payments: state.payments
        }));
        return;
    }

    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: 'Unsupported payment action.' }));
};
