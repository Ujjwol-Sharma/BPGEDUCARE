/**
 * BPG Academy — Serverless & Node API Handler (/api/academy-state)
 * - GET (admin with passkey): full unredacted state
 * - GET (student / guest): sanitized state with locked sections stripped and restricted item bodies redacted
 * - POST (admin with passkey): deep-merges and commits sectionLocks, plansConfig, portals, notes, etc.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
    DATA_DIR,
    DB_PATH,
    LEGACY_CMS_PATH,
    TMP_DB_PATH,
    ROSTER_PATH,
    TMP_ROSTER_PATH,
    MASTER_PASSKEY,
    isAdminPasskeyValid,
    ensureAccessModelDefaults,
    readAcademyState,
    readRoster,
    resolveRequestUser,
    sanitizeStateForStudent
} = require('./_access-control');
const {
    queueDurableWrite,
    hasPendingDurableWrites,
    extractAndQueueDurablePdfFiles,
    flushPendingDurableCommits,
    ensureDurableStoreHydrated
} = require('./_durable-storage');
const TMP_ATTEMPTS_PATH = path.join(os.tmpdir(), 'bpg-mock-attempts.json');

function deepMergeState(currentData, payload) {
    const updated = Object.assign({}, currentData, payload);

    if (payload.sectionLocks && typeof payload.sectionLocks === 'object') {
        updated.sectionLocks = Object.assign({}, currentData.sectionLocks || {}, payload.sectionLocks);
    }

    if (payload.plansConfig && typeof payload.plansConfig === 'object') {
        updated.plansConfig = Object.assign({}, currentData.plansConfig || {});
        ['free', 'gold', 'diamond'].forEach(pid => {
            if (payload.plansConfig[pid]) {
                updated.plansConfig[pid] = Object.assign(
                    {},
                    updated.plansConfig[pid] || {},
                    payload.plansConfig[pid],
                    { id: pid }
                );
            }
        });
    }

    if (Array.isArray(payload.zoomClasses)) {
        updated.zoomClasses = payload.zoomClasses;
    }

    if (Array.isArray(payload.teamMembers)) {
        updated.teamMembers = payload.teamMembers;
    }

    if (payload.homepageContent && typeof payload.homepageContent === 'object') {
        updated.homepageContent = Object.assign({}, currentData.homepageContent || {}, payload.homepageContent);
    }

    if (payload.maintenanceMode && typeof payload.maintenanceMode === 'object') {
        updated.maintenanceMode = Object.assign({}, currentData.maintenanceMode || {}, payload.maintenanceMode);
    }

    if (payload.siteSettings && typeof payload.siteSettings === 'object') {
        updated.siteSettings = Object.assign({}, currentData.siteSettings || {}, payload.siteSettings);
    }

    if (Array.isArray(payload.notifications)) {
        updated.notifications = payload.notifications;
    }

    if (Array.isArray(payload.chatbotFaqs)) {
        updated.chatbotFaqs = payload.chatbotFaqs;
    }

    if (Array.isArray(payload.payments)) {
        updated.payments = payload.payments;
    }

    if (currentData.portals && payload.portals) {
        updated.portals = Object.assign({}, currentData.portals);
        for (const classKey of Object.keys(payload.portals)) {
            const existingPortal = currentData.portals[classKey] || {};
            const incomingPortal = payload.portals[classKey] || {};
            const mergedPortal = Object.assign({}, existingPortal, incomingPortal);

            if (!Array.isArray(incomingPortal.syllabusRows) && Array.isArray(existingPortal.syllabusRows)) {
                mergedPortal.syllabusRows = existingPortal.syllabusRows;
            }
            if (!Array.isArray(incomingPortal.plans) && Array.isArray(existingPortal.plans)) {
                mergedPortal.plans = existingPortal.plans;
            }
            if (!incomingPortal.live && existingPortal.live) {
                mergedPortal.live = existingPortal.live;
            }
            if (!Array.isArray(incomingPortal.subjects) && Array.isArray(existingPortal.subjects)) {
                mergedPortal.subjects = existingPortal.subjects;
            } else if (Array.isArray(incomingPortal.subjects) && Array.isArray(existingPortal.subjects)) {
                // Preserve existing PDFs & videos unless explicitly deleted via explicitDeleteUploadId / explicitSafeDelete
                const explicitDelId = String(payload.explicitDeleteUploadId || '').trim();
                const isExplicitSafeDelete = Boolean(payload.explicitSafeDelete);
                const existingPdfMap = new Map();
                const existingLessonMap = new Map();
                for (const es of existingPortal.subjects) {
                    for (const el of (es.lessons || [])) {
                        if (el && el.id) existingLessonMap.set(`${es.id || 'mathematics'}|${el.id}`, el);
                        for (const ep of (el.pdfs || [])) {
                            if (ep && ep.id) existingPdfMap.set(ep.id, ep);
                        }
                    }
                }
                mergedPortal.subjects = incomingPortal.subjects.map(is => ({
                    ...is,
                    lessons: (is.lessons || []).map(il => {
                        const prevLesson = existingLessonMap.get(`${is.id || 'mathematics'}|${il.id}`);
                        let mergedPdfs = (il.pdfs || []).map(ip => {
                            const prev = ip && ip.id ? existingPdfMap.get(ip.id) : null;
                            if (prev) {
                                return {
                                    ...ip,
                                    fileUrl: ip.fileUrl || prev.fileUrl || '',
                                    storageKey: ip.storageKey || prev.storageKey || '',
                                    hasFile: Boolean(ip.fileUrl || ip.storageKey || ip.hasFile || prev.fileUrl || prev.storageKey || prev.hasFile),
                                    fileSizeBytes: ip.fileSizeBytes || prev.fileSizeBytes || 0
                                };
                            }
                            return ip;
                        });
                        let mergedVideos = Array.isArray(il.videos) ? [...il.videos] : [];

                        // Union any server-side PDFs/videos missing from a stale client tab unless explicitly deleted
                        if (prevLesson && !isExplicitSafeDelete) {
                            const incomingPdfIds = new Set(mergedPdfs.map(p => p && p.id));
                            for (const ep of (prevLesson.pdfs || [])) {
                                if (ep && ep.id && ep.id !== explicitDelId && !incomingPdfIds.has(ep.id)) {
                                    mergedPdfs.push(ep);
                                }
                            }
                            const incomingVidIds = new Set(mergedVideos.map(v => v && v.id));
                            for (const ev of (prevLesson.videos || [])) {
                                if (ev && ev.id && ev.id !== explicitDelId && !incomingVidIds.has(ev.id)) {
                                    mergedVideos.push(ev);
                                }
                            }
                        }

                        return {
                            ...il,
                            pdfs: mergedPdfs,
                            videos: mergedVideos
                        };
                    })
                }));
            }
            if (Array.isArray(incomingPortal.notesPdfs)) {
                mergedPortal.notesPdfs = incomingPortal.notesPdfs;
                mergedPortal.notes = incomingPortal.notesPdfs;
            } else if (Array.isArray(incomingPortal.notes)) {
                mergedPortal.notes = incomingPortal.notes;
                mergedPortal.notesPdfs = incomingPortal.notes;
            }
            updated.portals[classKey] = mergedPortal;
        }
    }

    return ensureAccessModelDefaults(updated);
}

function writeStateToDisk(updated) {
    updated.revision = (Number(updated.revision) || Number(global.__BPG_ACADEMY_STATE__?.revision) || 1) + 1;
    try {
        extractAndQueueDurablePdfFiles(updated);
    } catch (e) {}
    global.__BPG_ACADEMY_STATE__ = updated;
    const serialized = JSON.stringify(updated, null, 2);

    try { fs.writeFileSync(TMP_DB_PATH, serialized, 'utf8'); } catch (e) {}

    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const tempPath = DB_PATH + '.tmp.' + Date.now();
        fs.writeFileSync(tempPath, serialized, 'utf8');
        fs.renameSync(tempPath, DB_PATH);
    } catch (err) {
        console.warn('[API /api/academy-state] Primary DB write fallback to tmp:', err.message);
    }

    try { fs.writeFileSync(LEGACY_CMS_PATH, serialized, 'utf8'); } catch (e) {}
    try { queueDurableWrite('academy-state.json', serialized); } catch (e) {}
}

module.exports.writeStateToDisk = writeStateToDisk;
module.exports.deepMergeState = deepMergeState;

const studentRosterHandler = require('./_student-roster');
const sendEmailOtpHandler = require('./_send-email-otp');
const verifyOtpHandler = require('./_verify-otp');
const contentAccessHandler = require('./_content-access');
const mockTestsHandler = require('./_mock-tests');
const paymentsHandler = require('./_payments');
const aiTutorHandler = require('./_ai-tutor');

const SUB_ROUTE_HANDLERS = {
    'student-roster': studentRosterHandler,
    'send-email-otp': sendEmailOtpHandler,
    'verify-otp': verifyOtpHandler,
    'content-access': contentAccessHandler,
    'mock-tests': mockTestsHandler,
    'payments': paymentsHandler,
    'ai-tutor': aiTutorHandler
};

function ensureResHelpers(res) {
    if (!res.__bpgDurableWrapped) {
        res.__bpgDurableWrapped = true;
        const origEnd = res.end.bind(res);
        res.end = function (chunk, encoding, cb) {
            if (!hasPendingDurableWrites()) {
                return origEnd(chunk, encoding, cb);
            }
            const status = res.statusCode || 200;
            if (status < 200 || status >= 300) {
                return origEnd(chunk, encoding, cb);
            }
            flushPendingDurableCommits()
                .then(() => {
                    origEnd(chunk, encoding, cb);
                })
                .catch(err => {
                    console.error('[DurableStore] Failed to persist mutation:', err);
                    res.statusCode = 500;
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                    origEnd(JSON.stringify({
                        ok: false,
                        success: false,
                        code: 'DURABLE_SAVE_FAILED',
                        error: 'Could not save changes to durable cloud storage. Please try again. (' + err.message + ')'
                    }));
                });
            return res;
        };
    }
    if (typeof res.status !== 'function') {
        res.status = function (code) {
            res.statusCode = code;
            return res;
        };
    }
    if (typeof res.json !== 'function') {
        res.json = function (obj) {
            if (!res.getHeader('Content-Type')) {
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
            }
            res.end(JSON.stringify(obj));
            return res;
        };
    }
    return res;
}

async function academyStateHandler(req, res) {
    ensureResHelpers(res);

    if (req.method !== 'OPTIONS') {
        await ensureDurableStoreHydrated({
            TMP_DB_PATH,
            TMP_ROSTER_PATH,
            TMP_ATTEMPTS_PATH,
            DB_PATH,
            ROSTER_PATH,
            force: req.method === 'POST'
        });
    }

    const parsedRouteUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const subRoute = (req.query && req.query.__route) || parsedRouteUrl.searchParams.get('__route') || '';
    if (subRoute && SUB_ROUTE_HANDLERS[subRoute]) {
        return await SUB_ROUTE_HANDLERS[subRoute](req, res);
    }
    const cleanPath = parsedRouteUrl.pathname.replace(/^\/api\//, '').replace(/\.js$/, '');
    if (cleanPath && cleanPath !== 'academy-state' && SUB_ROUTE_HANDLERS[cleanPath]) {
        return await SUB_ROUTE_HANDLERS[cleanPath](req, res);
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
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
            const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
            const isAdmin = isAdminPasskeyValid(req.headers['x-admin-passkey']);

            if (parsedUrl.searchParams.get('verifyAdmin') === '1') {
                if (!isAdmin) {
                    res.statusCode = 401;
                    res.end(JSON.stringify({
                        success: false,
                        isAdmin: false,
                        error: 'Unauthorized: Invalid master admin passkey.'
                    }));
                    return;
                }
                res.statusCode = 200;
                res.end(JSON.stringify({
                    success: true,
                    isAdmin: true
                }));
                return;
            }

            const rawData = readAcademyState();
            delete rawData.adminPasskey;
            let roster = readRoster();
            let user = null;
            let sessionRevoked = false;
            if (!isAdmin) {
                const { resolveRequestUserStatus } = require('./_access-control');
                const { isDurableHydrationAuthoritative } = require('./_durable-storage');
                let userStatus = resolveRequestUserStatus(req);
                if (userStatus.needsFreshCheck) {
                    // Token signature is valid, but account wasn't in this container's cache — force-hydrate from bpg-live-db before deciding!
                    await ensureDurableStoreHydrated({
                        TMP_DB_PATH,
                        TMP_ROSTER_PATH,
                        TMP_ATTEMPTS_PATH,
                        DB_PATH,
                        ROSTER_PATH,
                        force: true
                    });
                    roster = readRoster();
                    userStatus = resolveRequestUserStatus(req);
                }
                user = userStatus.user;
                // Only confirm revocation when explicitly suspended/invalid token OR confirmed absent after authoritative durable hydration
                sessionRevoked = Boolean(
                    userStatus.revoked ||
                    (userStatus.needsFreshCheck && isDurableHydrationAuthoritative())
                );
            }
            const isLightPoll = parsedUrl.searchParams.get('light') === '1';
            const syncVersion = `${Number(rawData.revision) || 0}:${Number(roster.revision) || 0}:${rawData.lastUpdated || ''}:${roster.lastUpdated || ''}`;

            if (req.method === 'HEAD') {
                res.statusCode = 200;
                res.end();
                return;
            }

            if (isLightPoll) {
                if (isAdmin) {
                    res.statusCode = 200;
                    res.end(JSON.stringify({
                        success: true,
                        light: true,
                        syncVersion,
                        stateRevision: Number(rawData.revision) || 0,
                        rosterRevision: Number(roster.revision) || 0,
                        timestamp: rawData.lastUpdated || new Date().toISOString(),
                        roster: {
                            revision: Number(roster.revision) || 0,
                            lastUpdated: roster.lastUpdated,
                            duplicateGroups: roster.duplicateGroups || [],
                            classSwitchRequests: roster.classSwitchRequests || [],
                            auditLog: roster.auditLog || [],
                            accounts: (roster.accounts || []).map(({ passkey, ...safe }) => safe)
                        },
                        payments: Array.isArray(rawData.payments) ? rawData.payments : [],
                        sectionLocks: rawData.sectionLocks || {},
                        plansConfig: rawData.plansConfig || {},
                        maintenanceMode: rawData.maintenanceMode || { enabled: false }
                    }));
                    return;
                }

                const safeUser = user ? (({ passkey, ...rest }) => rest)(user) : null;
                const myPayments = user
                    ? (Array.isArray(rawData.payments) ? rawData.payments : []).filter(
                        p => (p.userId && p.userId === user.userId) || p.canonicalEmail === user.canonicalEmail
                    )
                    : [];
                const mySwitchRequests = user
                    ? (roster.classSwitchRequests || []).filter(
                        r => (r.userId && r.userId === user.userId) || r.canonicalEmail === user.canonicalEmail
                    )
                    : [];

                res.statusCode = 200;
                res.end(JSON.stringify({
                    success: true,
                    light: true,
                    syncVersion,
                    stateRevision: Number(rawData.revision) || 0,
                    rosterRevision: Number(roster.revision) || 0,
                    timestamp: rawData.lastUpdated || new Date().toISOString(),
                    currentUser: safeUser,
                    sessionRevoked,
                    myPayments,
                    mySwitchRequests,
                    sectionLocks: rawData.sectionLocks || {},
                    plansConfig: rawData.plansConfig || {},
                    maintenanceMode: rawData.maintenanceMode || { enabled: false }
                }));
                return;
            }

            let responseData = isAdmin ? JSON.parse(JSON.stringify(rawData)) : sanitizeStateForStudent(rawData, user);
            if (isAdmin && responseData && responseData.portals) {
                // Keep Admin GET fast & under Vercel's 4.5MB limit by stripping inline Base64 PDFs already stored in durable pdfs/<id>.pdf
                for (const ck of Object.keys(responseData.portals)) {
                    const p = responseData.portals[ck];
                    if (!p) continue;
                    for (const s of (p.subjects || [])) {
                        for (const l of (s.lessons || [])) {
                            for (const pdf of (l.pdfs || [])) {
                                if (pdf && String(pdf.fileUrl || '').startsWith('data:application/pdf;base64,')) {
                                    pdf.hasFile = true;
                                    pdf.storageKey = pdf.storageKey || `pdfs/${String(pdf.id).replace(/[^a-zA-Z0-9._-]/g, '_')}.pdf`;
                                    pdf.fileUrl = '';
                                }
                            }
                        }
                    }
                }
            }

            let extraBundle = {};
            if (isAdmin) {
                extraBundle = {
                    syncVersion,
                    roster: {
                        revision: Number(roster.revision) || 0,
                        lastUpdated: roster.lastUpdated,
                        duplicateGroups: roster.duplicateGroups || [],
                        classSwitchRequests: roster.classSwitchRequests || [],
                        auditLog: roster.auditLog || [],
                        accounts: (roster.accounts || []).map(({ passkey, ...safe }) => safe)
                    },
                    mockTests: Array.isArray(rawData.mockTests) ? rawData.mockTests : [],
                    payments: Array.isArray(rawData.payments) ? rawData.payments : []
                };
            } else {
                const safeUser = user ? (({ passkey, ...rest }) => rest)(user) : null;
                const myPayments = user
                    ? (Array.isArray(rawData.payments) ? rawData.payments : []).filter(
                        p => (p.userId && p.userId === user.userId) || p.canonicalEmail === user.canonicalEmail
                    )
                    : [];
                const mySwitchRequests = user
                    ? (roster.classSwitchRequests || []).filter(
                        r => (r.userId && r.userId === user.userId) || r.canonicalEmail === user.canonicalEmail
                    )
                    : [];
                extraBundle = {
                    syncVersion,
                    stateRevision: Number(rawData.revision) || 0,
                    rosterRevision: Number(roster.revision) || 0,
                    currentUser: safeUser,
                    sessionRevoked,
                    myPayments,
                    mySwitchRequests
                };
            }

            res.statusCode = 200;
            res.end(JSON.stringify({
                success: true,
                source: 'database',
                timestamp: rawData.lastUpdated || new Date().toISOString(),
                data: responseData,
                ...extraBundle
            }));
        } catch (err) {
            console.error('[API /api/academy-state] Error reading database:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({
                success: false,
                error: 'Failed to read centralized database: ' + err.message
            }));
        }
        return;
    }

    if (req.method === 'POST') {
        const payload = req.body || {};
        const passkey = req.headers['x-admin-passkey'] || payload.adminPasskey;

        if (!isAdminPasskeyValid(passkey)) {
            res.statusCode = 401;
            res.end(JSON.stringify({
                success: false,
                error: 'Unauthorized: Invalid master admin passkey.'
            }));
            return;
        }

        if (!payload || typeof payload !== 'object') {
            res.statusCode = 400;
            res.end(JSON.stringify({
                success: false,
                error: 'Bad Request: JSON payload body must be an object.'
            }));
            return;
        }

        try {
            const currentData = readAcademyState();
            const updated = deepMergeState(currentData, payload);
            updated.lastUpdated = new Date().toISOString();
            delete updated.adminPasskey;

            writeStateToDisk(updated);

            res.statusCode = 200;
            res.end(JSON.stringify({
                success: true,
                message: 'Changes saved.',
                timestamp: updated.lastUpdated,
                data: updated
            }));
        } catch (err) {
            console.error('[API /api/academy-state] Mutation failure:', err);
            res.statusCode = 500;
            res.end(JSON.stringify({
                success: false,
                error: 'Database commit error: ' + err.message
            }));
        }
        return;
    }

    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
}

academyStateHandler.writeStateToDisk = writeStateToDisk;
academyStateHandler.deepMergeState = deepMergeState;
module.exports = academyStateHandler;
