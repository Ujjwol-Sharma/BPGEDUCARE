/**
 * BPG EDUCARE — Super Admin Portal API (/api/super-admin)
 * Strictly protected by Super Admin RBAC (role === 'super_admin').
 * Provides:
 * - Full live user inspector, presence & activity monitoring
 * - Admin user management (create, edit permissions, revoke regular Admin accounts)
 * - Full user control (Plan, Class, IOE Access, OTP Verified, Force Logout, Suspend/Unsuspend, Delete)
 * - Secure password controls (Force Password Reset, Send Reset OTP, Set Temporary One-Time Password — NEVER stores plaintext)
 * - Global system controls (Maintenance Mode, minAuthVersion Force Re-Login All, Promo Codes, Single-Device Toggle)
 * - Unified Scheduled Publishing Queue actions (Edit Schedule, Publish Now, Cancel)
 */

const crypto = require('crypto');
const {
    resolveAdminRole,
    readAcademyState,
    readRoster,
    writeRoster,
    hashPassword,
    canonicalizeEmail,
    gradeToClassKey,
    normalizeGradeName,
    normalizePlan,
    generateSessionId,
    appendAccountAuditEntry,
    appendRosterAuditEntry,
    formatNepalTime
} = require('./_access-control');
const { writeStateToDisk } = require('./academy-state');
const sendEmailOtpHandler = require('./_send-email-otp');

function stripSensitive(acc) {
    const { passkey, ...safe } = acc;
    const lastActiveMs = Date.parse(safe.lastActiveAt || safe.lastLoginAt || '') || 0;
    const isOnline = lastActiveMs > 0 && (Date.now() - lastActiveMs) <= 5 * 60 * 1000;
    return { ...safe, isOnline };
}

function collectScheduledQueue(state) {
    const items = [];
    // 1. Posts
    (Array.isArray(state.posts) ? state.posts : []).forEach(p => {
        if (p && p.publishStatus === 'scheduled') {
            items.push({
                kind: 'post',
                id: p.id,
                title: p.title || 'Post',
                category: p.category === 'achievements' ? 'Achievements' : 'News',
                scope: 'Public',
                publishAt: p.publishAt || '',
                publishAtNpt: p.publishAt ? formatNepalTime(p.publishAt) : 'Not set'
            });
        }
    });
    // 2. Notifications
    (Array.isArray(state.notifications) ? state.notifications : []).forEach(n => {
        if (n && n.publishStatus === 'scheduled') {
            items.push({
                kind: 'notification',
                id: n.id,
                title: n.title || 'Notification',
                category: n.category || 'Alert',
                scope: n.scope || 'sitewide',
                publishAt: n.publishAt || '',
                publishAtNpt: n.publishAt ? formatNepalTime(n.publishAt) : 'Not set'
            });
        }
    });
    // 3. Mock Tests
    (Array.isArray(state.mockTests) ? state.mockTests : []).forEach(t => {
        if (t && t.status === 'scheduled') {
            const at = t.scheduledReleaseAt || t.publishAt || '';
            items.push({
                kind: 'mocktest',
                id: t.id,
                title: t.title || 'Mock Test',
                category: 'Mock Test',
                scope: normalizeGradeName(t.classKey || 'class-12'),
                publishAt: at,
                publishAtNpt: at ? formatNepalTime(at) : 'Not set'
            });
        }
    });
    // 4. Zoom Classes
    (Array.isArray(state.zoomClasses) ? state.zoomClasses : []).forEach(z => {
        if (z && z.publishStatus === 'scheduled') {
            items.push({
                kind: 'zoom',
                id: z.id,
                title: z.title || 'Live Zoom Class',
                category: 'Zoom Class',
                scope: z.classKey === 'all' ? 'All Classes' : normalizeGradeName(z.classKey || 'class-12'),
                publishAt: z.publishAt || '',
                publishAtNpt: z.publishAt ? formatNepalTime(z.publishAt) : 'Not set'
            });
        }
    });
    // 5. Lesson PDFs & Videos
    Object.entries(state.portals || {}).forEach(([ck, portal]) => {
        if (ck === 'class-10' || !portal) return;
        (portal.subjects || []).forEach(subj => {
            (subj.lessons || []).forEach(lesson => {
                (lesson.pdfs || []).forEach(pdf => {
                    if (pdf && pdf.publishStatus === 'scheduled') {
                        items.push({
                            kind: 'pdf',
                            id: pdf.id,
                            classKey: ck,
                            subjectId: subj.id,
                            lessonId: lesson.id,
                            title: pdf.title || pdf.fileName || 'Lesson PDF',
                            category: 'Lesson PDF',
                            scope: `${normalizeGradeName(ck)} · ${lesson.title || ''}`,
                            publishAt: pdf.publishAt || '',
                            publishAtNpt: pdf.publishAt ? formatNepalTime(pdf.publishAt) : 'Not set'
                        });
                    }
                });
                (lesson.videos || []).forEach(vid => {
                    if (vid && vid.publishStatus === 'scheduled') {
                        items.push({
                            kind: 'video',
                            id: vid.id,
                            classKey: ck,
                            subjectId: subj.id,
                            lessonId: lesson.id,
                            title: vid.title || 'Lesson Video',
                            category: 'Lesson Video',
                            scope: `${normalizeGradeName(ck)} · ${lesson.title || ''}`,
                            publishAt: vid.publishAt || '',
                            publishAtNpt: vid.publishAt ? formatNepalTime(vid.publishAt) : 'Not set'
                        });
                    }
                });
            });
        });
    });

    items.sort((a, b) => (Date.parse(a.publishAt || '') || 0) - (Date.parse(b.publishAt || '') || 0));
    return items;
}

function mutateScheduledItem(state, { kind, id, classKey, subjectId, lessonId, mode, publishAt }) {
    const nowIso = new Date().toISOString();
    const applyAction = (obj) => {
        if (!obj) return false;
        if (mode === 'publish_now') {
            obj.publishStatus = 'published';
            obj.published = true;
            obj.publishAt = '';
            obj.updatedAt = nowIso;
            if (kind === 'mocktest') {
                obj.status = 'published';
                obj.scheduledReleaseAt = '';
            }
            return true;
        }
        if (mode === 'cancel') {
            obj.publishStatus = 'draft';
            obj.published = false;
            obj.publishAt = '';
            obj.updatedAt = nowIso;
            if (kind === 'mocktest') {
                obj.status = 'draft';
                obj.scheduledReleaseAt = '';
            }
            return true;
        }
        if (mode === 'reschedule' && publishAt) {
            obj.publishStatus = 'scheduled';
            obj.publishAt = String(publishAt);
            obj.updatedAt = nowIso;
            if (kind === 'mocktest') {
                obj.status = 'scheduled';
                obj.scheduledReleaseAt = String(publishAt);
            }
            return true;
        }
        return false;
    };

    if (kind === 'post') {
        return applyAction((state.posts || []).find(p => p && p.id === id));
    }
    if (kind === 'notification') {
        return applyAction((state.notifications || []).find(n => n && n.id === id));
    }
    if (kind === 'mocktest') {
        return applyAction((state.mockTests || []).find(t => t && t.id === id));
    }
    if (kind === 'zoom') {
        return applyAction((state.zoomClasses || []).find(z => z && z.id === id));
    }
    if (kind === 'pdf' || kind === 'video') {
        const portal = state.portals?.[classKey];
        const subj = (portal?.subjects || []).find(s => s.id === subjectId);
        const lesson = (subj?.lessons || []).find(l => l.id === lessonId);
        const arr = kind === 'pdf' ? (lesson?.pdfs || []) : (lesson?.videos || []);
        return applyAction(arr.find(x => x && x.id === id));
    }
    return false;
}

module.exports = async function superAdminHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-super-admin-key, x-admin-passkey');

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
    }

    const body = req.method === 'POST' ? (req.body || {}) : {};
    const roleInfo = resolveAdminRole(req, body);

    if (!roleInfo.isSuperAdmin) {
        res.statusCode = 403;
        res.end(JSON.stringify({
            ok: false,
            code: 'SUPER_ADMIN_REQUIRED',
            error: 'Forbidden: Super Admin privileges are required.'
        }));
        return;
    }

    const state = readAcademyState();
    const roster = readRoster();

    if (req.method === 'GET') {
        const accounts = (roster.accounts || []).map(stripSensitive);
        const admins = (Array.isArray(state.adminUsers) ? state.adminUsers : []).map(({ passkeyHash, ...rest }) => rest);
        const payments = Array.isArray(state.payments) ? state.payments : [];
        const scheduledQueue = collectScheduledQueue(state);
        const stats = {
            totalUsers: accounts.length,
            onlineNow: accounts.filter(a => a.isOnline).length,
            otpVerifiedCount: accounts.filter(a => a.otpVerified === true).length,
            termsAcceptedCount: accounts.filter(a => a.termsAccepted === true).length,
            padandasCount: accounts.filter(a => a.plan === 'gold').length,
            topperCount: accounts.filter(a => a.plan === 'diamond').length,
            suspendedCount: accounts.filter(a => a.accountStatus === 'suspended').length,
            adminCount: admins.filter(a => a.active !== false).length,
            scheduledCount: scheduledQueue.length
        };
        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            role: roleInfo.role,
            stats,
            accounts,
            adminUsers: admins,
            payments,
            scheduledQueue,
            systemControls: {
                maintenanceMode: state.maintenanceMode || { enabled: false, title: '', message: '' },
                minAuthVersion: Number(state.siteSettings?.minAuthVersion) || 2,
                singleDeviceSession: state.siteSettings?.singleDeviceSession !== false,
                promoCodes: Array.isArray(state.siteSettings?.promoCodes) ? state.siteSettings.promoCodes : []
            },
            auditLog: Array.isArray(roster.auditLog) ? roster.auditLog.slice(0, 60) : []
        }));
        return;
    }

    if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
        return;
    }

    const action = String(body.action || '').trim().toUpperCase();
    const nowIso = new Date().toISOString();

    try {
        // 1. MANAGE REGULAR ADMIN ACCOUNTS
        if (action === 'CREATE_ADMIN') {
            const name = String(body.name || '').trim();
            const email = String(body.email || '').trim().toLowerCase();
            const passkey = String(body.passkey || '').trim();
            const permissions = Array.isArray(body.permissions) ? body.permissions.map(String) : ['users', 'payments', 'content', 'posts'];
            if (!name || passkey.length < 6) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: 'Admin name and a passkey (min 6 characters) are required.' }));
                return;
            }
            if (!Array.isArray(state.adminUsers)) state.adminUsers = [];
            const newAdmin = {
                id: 'adm_' + crypto.randomBytes(6).toString('hex'),
                name,
                email,
                role: 'admin',
                permissions,
                passkeyHash: hashPassword(passkey),
                active: true,
                createdAt: nowIso,
                createdBy: roleInfo.name || 'Super Admin'
            };
            state.adminUsers.unshift(newAdmin);
            state.lastUpdated = nowIso;
            writeStateToDisk(state);
            const { passkeyHash, ...safeAdmin } = newAdmin;
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, admin: safeAdmin, message: `Admin "${name}" created.` }));
            return;
        }

        if (action === 'UPDATE_ADMIN' || action === 'REVOKE_ADMIN') {
            const adminId = String(body.adminId || '').trim();
            const list = Array.isArray(state.adminUsers) ? state.adminUsers : [];
            const target = list.find(a => a && a.id === adminId);
            if (!target) {
                res.statusCode = 404;
                res.end(JSON.stringify({ ok: false, error: 'Admin account not found.' }));
                return;
            }
            if (action === 'REVOKE_ADMIN') {
                target.active = false;
                target.revokedAt = nowIso;
            } else {
                if (body.name) target.name = String(body.name).trim();
                if (body.email !== undefined) target.email = String(body.email).trim().toLowerCase();
                if (Array.isArray(body.permissions)) target.permissions = body.permissions.map(String);
                if (body.active !== undefined) target.active = Boolean(body.active);
                if (body.newPasskey && String(body.newPasskey).trim().length >= 6) {
                    target.passkeyHash = hashPassword(String(body.newPasskey).trim());
                }
            }
            target.updatedAt = nowIso;
            state.lastUpdated = nowIso;
            writeStateToDisk(state);
            const { passkeyHash, ...safeAdmin } = target;
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, admin: safeAdmin, message: action === 'REVOKE_ADMIN' ? 'Admin revoked.' : 'Admin updated.' }));
            return;
        }

        // 2. FULL USER CONTROLS
        const findTargetUser = () => {
            const uid = String(body.userId || '').trim();
            const em = canonicalizeEmail(body.email || '');
            return (roster.accounts || []).find(a => (uid && a.userId === uid) || (em && a.canonicalEmail === em)) || null;
        };

        if (action === 'UPDATE_USER_FULL') {
            const acc = findTargetUser();
            if (!acc) {
                res.statusCode = 404;
                res.end(JSON.stringify({ ok: false, error: 'Student account not found.' }));
                return;
            }
            const changes = [];
            if (body.plan) {
                const nextPlan = normalizePlan(body.plan);
                if (nextPlan !== acc.plan) {
                    changes.push(`Plan: ${acc.plan} -> ${nextPlan}`);
                    acc.plan = nextPlan;
                    acc.planExplicitlySet = true;
                }
            }
            if (body.classKey || body.grade) {
                const nextCk = gradeToClassKey(body.classKey || body.grade);
                if (nextCk !== acc.classKey) {
                    changes.push(`Class: ${acc.grade} -> ${normalizeGradeName(nextCk)}`);
                    acc.classKey = nextCk;
                    acc.grade = normalizeGradeName(nextCk);
                }
            }
            if (body.ioeAccess !== undefined) {
                acc.ioeAccess = Boolean(body.ioeAccess);
                changes.push(`IOE Access: ${acc.ioeAccess ? 'Enabled' : 'Disabled'}`);
            }
            if (body.otpVerified !== undefined) {
                acc.otpVerified = Boolean(body.otpVerified);
                if (acc.otpVerified) acc.emailVerified = true;
                changes.push(`OTP Verified: ${acc.otpVerified ? 'Yes' : 'No'}`);
            }
            if (body.accountStatus === 'suspended' || body.accountStatus === 'active') {
                acc.accountStatus = body.accountStatus;
                if (body.accountStatus === 'suspended') {
                    acc.activeSessionId = 'revoked_' + generateSessionId();
                }
                changes.push(`Status: ${body.accountStatus}`);
            }
            acc.updatedAt = nowIso;
            acc.lastModifiedBy = 'Super Admin';
            appendAccountAuditEntry(acc, { actor: 'Super Admin', action: 'SUPER_ADMIN_UPDATE', details: changes.join(', ') || 'Updated account' });
            appendRosterAuditEntry(roster, { userId: acc.userId, email: acc.email, actor: 'Super Admin', action: 'SUPER_ADMIN_UPDATE', details: changes.join(', ') || 'Updated account' });
            writeRoster(roster);
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, account: stripSensitive(acc), message: 'User updated.' }));
            return;
        }

        if (action === 'FORCE_LOGOUT_USER') {
            const acc = findTargetUser();
            if (!acc) {
                res.statusCode = 404;
                res.end(JSON.stringify({ ok: false, error: 'Student account not found.' }));
                return;
            }
            acc.activeSessionId = 'revoked_' + generateSessionId();
            appendAccountAuditEntry(acc, { actor: 'Super Admin', action: 'FORCE_LOGOUT', details: 'Active session revoked by Super Admin' });
            writeRoster(roster);
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, message: `Forced logout for @${acc.username}.` }));
            return;
        }

        if (action === 'DELETE_USER') {
            const acc = findTargetUser();
            if (!acc) {
                res.statusCode = 404;
                res.end(JSON.stringify({ ok: false, error: 'Student account not found.' }));
                return;
            }
            roster.accounts = roster.accounts.filter(a => a.userId !== acc.userId);
            appendRosterAuditEntry(roster, { userId: acc.userId, email: acc.email, actor: 'Super Admin', action: 'DELETE_USER', details: `Deleted user @${acc.username}` });
            writeRoster(roster);
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, message: `Account @${acc.username} permanently deleted.` }));
            return;
        }

        // 3. SECURE PASSWORD CONTROLS (Strictly one-way scrypt$ hashed, NEVER stores plaintext)
        if (action === 'FORCE_PASSWORD_RESET') {
            const acc = findTargetUser();
            if (!acc) {
                res.statusCode = 404;
                res.end(JSON.stringify({ ok: false, error: 'Student account not found.' }));
                return;
            }
            acc.mustChangePassword = true;
            acc.activeSessionId = 'revoked_' + generateSessionId();
            appendAccountAuditEntry(acc, { actor: 'Super Admin', action: 'FORCE_PASSWORD_RESET', details: 'Forced password reset & logged out user' });
            writeRoster(roster);
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, message: `Force password reset enabled for @${acc.username}.` }));
            return;
        }

        if (action === 'SET_TEMP_PASSWORD') {
            const acc = findTargetUser();
            if (!acc) {
                res.statusCode = 404;
                res.end(JSON.stringify({ ok: false, error: 'Student account not found.' }));
                return;
            }
            const customTemp = String(body.tempPassword || '').trim();
            const tempPassword = customTemp.length >= 6
                ? customTemp
                : ('BPG-' + crypto.randomBytes(3).toString('hex').toUpperCase() + Math.floor(10 + Math.random() * 89));
            acc.passkey = hashPassword(tempPassword);
            acc.hasPassword = true;
            acc.mustChangePassword = true;
            acc.activeSessionId = 'revoked_' + generateSessionId();
            appendAccountAuditEntry(acc, { actor: 'Super Admin', action: 'SET_TEMP_PASSWORD', details: 'Set temporary one-time password (hashed; must change on next login)' });
            appendRosterAuditEntry(roster, { userId: acc.userId, email: acc.email, actor: 'Super Admin', action: 'SET_TEMP_PASSWORD', details: `Issued temporary password for @${acc.username}` });
            writeRoster(roster);
            res.statusCode = 200;
            res.end(JSON.stringify({
                ok: true,
                tempPassword,
                message: `Temporary one-time password generated for @${acc.username}. They will be forced to set a new password on next sign-in.`
            }));
            return;
        }

        if (action === 'SEND_RESET_OTP') {
            const acc = findTargetUser();
            if (!acc) {
                res.statusCode = 404;
                res.end(JSON.stringify({ ok: false, error: 'Student account not found.' }));
                return;
            }
            const mockReq = {
                method: 'POST',
                headers: req.headers,
                body: { email: acc.email, mode: 'reset', name: acc.name }
            };
            let otpPayload = null;
            const mockRes = {
                statusCode: 200,
                setHeader() {},
                status(c) { this.statusCode = c; return this; },
                json(obj) { otpPayload = obj; return this; },
                end(txt) { try { otpPayload = JSON.parse(txt); } catch {} return this; }
            };
            await sendEmailOtpHandler(mockReq, mockRes);
            appendAccountAuditEntry(acc, { actor: 'Super Admin', action: 'SEND_RESET_OTP', details: 'Super Admin dispatched 6-digit reset OTP' });
            writeRoster(roster);
            res.statusCode = mockRes.statusCode || 200;
            res.end(JSON.stringify({
                ok: Boolean(otpPayload && otpPayload.ok),
                message: otpPayload?.message || `Reset OTP sent to ${acc.email}.`,
                error: otpPayload?.error
            }));
            return;
        }

        // 4. GLOBAL SYSTEM CONTROLS
        if (action === 'FORCE_RELOGIN_ALL') {
            state.siteSettings = state.siteSettings || {};
            const prev = Math.max(2, Number(state.siteSettings.minAuthVersion) || 2);
            state.siteSettings.minAuthVersion = prev + 1;
            state.lastUpdated = nowIso;
            writeStateToDisk(state);
            appendRosterAuditEntry(roster, { actor: 'Super Admin', action: 'FORCE_RELOGIN_ALL', details: `Bumped minAuthVersion ${prev} -> ${prev + 1}` });
            writeRoster(roster);
            res.statusCode = 200;
            res.end(JSON.stringify({
                ok: true,
                minAuthVersion: state.siteSettings.minAuthVersion,
                message: `All users will be prompted to re-login with their existing username (Auth v${state.siteSettings.minAuthVersion}).`
            }));
            return;
        }

        if (action === 'UPDATE_SYSTEM_CONTROLS') {
            if (body.maintenanceMode && typeof body.maintenanceMode === 'object') {
                state.maintenanceMode = Object.assign({}, state.maintenanceMode || {}, body.maintenanceMode, { updatedAt: nowIso });
            }
            if (body.singleDeviceSession !== undefined) {
                state.siteSettings.singleDeviceSession = Boolean(body.singleDeviceSession);
            }
            if (Array.isArray(body.promoCodes)) {
                state.siteSettings.promoCodes = body.promoCodes;
            }
            if (Number.isFinite(Number(body.minAuthVersion)) && Number(body.minAuthVersion) >= 1) {
                state.siteSettings.minAuthVersion = Math.floor(Number(body.minAuthVersion));
            }
            state.lastUpdated = nowIso;
            writeStateToDisk(state);
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, message: 'Global system controls updated.' }));
            return;
        }

        // 5. UNIFIED SCHEDULED QUEUE MUTATIONS
        if (action === 'PUBLISH_SCHEDULED_NOW' || action === 'UPDATE_SCHEDULE' || action === 'CANCEL_SCHEDULE') {
            const mode = action === 'PUBLISH_SCHEDULED_NOW'
                ? 'publish_now'
                : (action === 'CANCEL_SCHEDULE' ? 'cancel' : 'reschedule');
            const ok = mutateScheduledItem(state, {
                kind: body.kind,
                id: body.id,
                classKey: body.classKey,
                subjectId: body.subjectId,
                lessonId: body.lessonId,
                mode,
                publishAt: body.publishAt
            });
            if (!ok) {
                res.statusCode = 404;
                res.end(JSON.stringify({ ok: false, error: 'Scheduled item not found.' }));
                return;
            }
            state.lastUpdated = nowIso;
            writeStateToDisk(state);
            res.statusCode = 200;
            res.end(JSON.stringify({
                ok: true,
                scheduledQueue: collectScheduledQueue(state),
                message: mode === 'publish_now' ? 'Published immediately!' : (mode === 'cancel' ? 'Schedule cancelled (moved to draft).' : 'Schedule updated.')
            }));
            return;
        }

        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: `Unsupported Super Admin action "${action}".` }));
    } catch (err) {
        console.error('[API /api/super-admin] Error:', err);
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: err.message || 'Super Admin request failed.' }));
    }
};
