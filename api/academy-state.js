/**
 * BPG Academy — Serverless & Node API Handler (/api/academy-state)
 * - GET (admin with passkey): full unredacted state
 * - GET (student / guest): sanitized state with locked sections stripped and restricted item bodies redacted
 * - POST (admin with passkey): deep-merges and commits sectionLocks, plansConfig, portals, notes, etc.
 */

const fs = require('fs');
const {
    DATA_DIR,
    DB_PATH,
    LEGACY_CMS_PATH,
    TMP_DB_PATH,
    MASTER_PASSKEY,
    isAdminPasskeyValid,
    ensureAccessModelDefaults,
    readAcademyState,
    resolveRequestUser,
    sanitizeStateForStudent
} = require('./_access-control');

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
}

module.exports = function academyStateHandler(req, res) {
    try {
        const parsedRouteUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const subRoute = parsedRouteUrl.searchParams.get('__route');
        if (subRoute === 'content-access' || parsedRouteUrl.pathname === '/api/content-access') {
            return require('./content-access')(req, res);
        }
        if (subRoute === 'mock-tests' || parsedRouteUrl.pathname === '/api/mock-tests') {
            return require('./mock-tests')(req, res);
        }
        if (subRoute === 'payments' || parsedRouteUrl.pathname === '/api/payments') {
            return require('./payments')(req, res);
        }
    } catch (e) {}

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
            const user = isAdmin ? null : resolveRequestUser(req);
            const responseData = isAdmin ? rawData : sanitizeStateForStudent(rawData, user);

            res.statusCode = 200;
            if (req.method === 'HEAD') {
                res.end();
                return;
            }
            res.end(JSON.stringify({
                success: true,
                source: 'database',
                timestamp: rawData.lastUpdated || new Date().toISOString(),
                data: responseData
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
};

module.exports.writeStateToDisk = writeStateToDisk;
module.exports.deepMergeState = deepMergeState;
