/**
 * BPG Academy — Server-Verified Content Access Endpoint (/api/content-access)
 * Verifies section locks (applying to ALL plans including Diamond) and plan tiers
 * (Free / Gold / Diamond) on the server before returning full questions, answers,
 * or PDF downloads.
 */

const {
    gradeToClassKey,
    readAcademyState,
    resolveRequestUser,
    evaluateItemAccess,
    isAdminPasskeyValid,
    normalizePlan
} = require('./_access-control');

module.exports = function contentAccessHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token, x-student-email, x-admin-passkey');

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const body = req.method === 'POST' ? (req.body || {}) : {};
    const rawClass = body.classKey || parsedUrl.searchParams.get('classKey') || '';
    const itemType = (body.itemType || parsedUrl.searchParams.get('itemType') || 'section').toLowerCase();
    const itemId = String(body.itemId || parsedUrl.searchParams.get('itemId') || '');

    const classKey = gradeToClassKey(rawClass);
    const state = readAcademyState();
    const isAdmin = isAdminPasskeyValid(req.headers['x-admin-passkey'] || body.adminPasskey);
    const user = resolveRequestUser(req);
    const portal = state.portals?.[classKey];

    // 0. Enforce Maintenance Mode for non-admin requests
    if (!isAdmin && state.maintenanceMode?.enabled) {
        res.statusCode = 503;
        res.end(JSON.stringify({
            ok: false,
            code: 'MAINTENANCE_MODE',
            error: state.maintenanceMode.message || 'Site is currently under maintenance.'
        }));
        return;
    }

    // 0b. Enforce one-active-class-per-account rule on server when signed in
    if (!isAdmin && user && user.email && user.classKey && classKey !== gradeToClassKey(user.classKey || user.grade)) {
        res.statusCode = 403;
        res.end(JSON.stringify({
            ok: false,
            code: 'CLASS_MISMATCH',
            currentClass: gradeToClassKey(user.classKey || user.grade),
            requestedClass: classKey,
            error: `Your account is enrolled in ${user.grade || user.classKey}. Submit a class switch request to access another class.`
        }));
        return;
    }

    // 1. Always enforce section lock FIRST for students (even Diamond!)
    const lock = state.sectionLocks?.[classKey] || { locked: false, reason: '' };
    if (!isAdmin && lock.locked) {
        res.statusCode = 403;
        res.end(JSON.stringify({
            ok: false,
            code: 'SECTION_LOCKED',
            locked: true,
            classKey,
            error: lock.reason || 'Temporarily unavailable'
        }));
        return;
    }

    if (!portal) {
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, code: 'NOT_FOUND', error: 'Section not found.' }));
        return;
    }

    // Section-level check only
    if (itemType === 'section') {
        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            classKey,
            locked: Boolean(lock.locked),
            userPlan: user ? normalizePlan(user.plan) : 'free'
        }));
        return;
    }

    // Helper to locate a lesson across portal.subjects (or legacy portal.units)
    function findLessonInPortal(subjectId, lessonId) {
        const subjects = Array.isArray(portal.subjects) ? portal.subjects : [];
        for (const s of subjects) {
            if (subjectId && s.id !== subjectId) continue;
            const found = (s.lessons || []).find(l => String(l.id) === lessonId);
            if (found) return { subject: s, lesson: found };
        }
        for (const s of subjects) {
            const found = (s.lessons || []).find(l => String(l.id) === lessonId);
            if (found) return { subject: s, lesson: found };
        }
        for (const u of (portal.units || [])) {
            const found = (u.topics || []).find(t => String(t.id) === lessonId);
            if (found) return { subject: { id: 'mathematics', name: 'Mathematics' }, lesson: found };
        }
        return null;
    }

    // 2A. Lesson details (PDFs & Videos list, no AI notes)
    if (itemType === 'lesson') {
        const subjectId = String(body.subjectId || parsedUrl.searchParams.get('subjectId') || '');
        const lessonId = String(body.lessonId || itemId || parsedUrl.searchParams.get('lessonId') || '');
        const match = findLessonInPortal(subjectId, lessonId);
        if (!match) {
            res.statusCode = 404;
            res.end(JSON.stringify({ ok: false, code: 'NOT_FOUND', error: 'Lesson not found.' }));
            return;
        }
        const { subject, lesson } = match;
        const pdfs = (Array.isArray(lesson.pdfs) ? lesson.pdfs : []).map(pdf => {
            const check = isAdmin ? { allowed: true } : evaluateItemAccess(user, classKey, pdf, state);
            return {
                id: pdf.id,
                title: pdf.title || pdf.fileName || 'PDF Document',
                fileName: pdf.fileName || '',
                coverImage: pdf.coverImage || '',
                minPlan: normalizePlan(pdf.minPlan || 'free'),
                restricted: !check.allowed,
                hasFile: Boolean(pdf.fileUrl)
            };
        });
        const videos = (Array.isArray(lesson.videos) ? lesson.videos : []).map(vid => {
            const check = isAdmin ? { allowed: true } : evaluateItemAccess(user, classKey, vid, state);
            return {
                id: vid.id,
                title: vid.title || 'Lesson Video',
                thumbnailUrl: vid.thumbnailUrl || '',
                minPlan: normalizePlan(vid.minPlan || 'free'),
                restricted: !check.allowed,
                hasVideo: Boolean(vid.videoUrl)
            };
        });
        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            itemType: 'lesson',
            classKey,
            subject: { id: subject.id, name: subject.name },
            lesson: {
                id: lesson.id,
                code: lesson.code || '',
                title: lesson.title || '',
                pdfs,
                videos
            }
        }));
        return;
    }

    // 2B. Lesson-attached Original PDF lookup & server-side verification
    if (itemType === 'lesson-pdf') {
        const subjectId = String(body.subjectId || parsedUrl.searchParams.get('subjectId') || '');
        const lessonId = String(body.lessonId || parsedUrl.searchParams.get('lessonId') || '');
        const pdfId = String(body.pdfId || itemId || parsedUrl.searchParams.get('pdfId') || '');
        const rawMode = parsedUrl.searchParams.get('raw') === '1';

        const match = findLessonInPortal(subjectId, lessonId);
        if (!match) {
            res.statusCode = 404;
            res.end(JSON.stringify({ ok: false, code: 'NOT_FOUND', error: 'Lesson not found.' }));
            return;
        }
        const foundTopic = match.lesson;

        const pdfList = Array.isArray(foundTopic.pdfs) ? foundTopic.pdfs : [];
        const foundPdf = pdfList.find(p => String(p.id) === pdfId);
        if (!foundPdf) {
            res.statusCode = 404;
            res.end(JSON.stringify({ ok: false, code: 'NOT_FOUND', error: 'PDF not found for this lesson.' }));
            return;
        }

        if (!isAdmin) {
            const check = evaluateItemAccess(user, classKey, foundPdf, state);
            if (!check.allowed) {
                res.statusCode = check.status || 403;
                res.end(JSON.stringify({
                    ok: false,
                    code: check.code,
                    requiredPlan: check.requiredPlan,
                    userPlan: check.userPlan,
                    itemTitle: foundPdf.title || foundPdf.fileName || 'Lesson PDF',
                    plansConfig: state.plansConfig,
                    error: check.error
                }));
                return;
            }
        }

        const fileUrl = String(foundPdf.fileUrl || '');
        if (rawMode && fileUrl.startsWith('data:application/pdf;base64,')) {
            const b64 = fileUrl.slice('data:application/pdf;base64,'.length);
            const buf = Buffer.from(b64, 'base64');
            const safeFilename = String(foundPdf.fileName || (foundPdf.title || 'lesson') + '.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
            res.end(buf);
            return;
        }

        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            itemType: 'lesson-pdf',
            classKey,
            lessonId,
            item: foundPdf
        }));
        return;
    }

    // 2C. Lesson-attached Video lookup & server-side verification
    if (itemType === 'lesson-video') {
        const subjectId = String(body.subjectId || parsedUrl.searchParams.get('subjectId') || '');
        const lessonId = String(body.lessonId || parsedUrl.searchParams.get('lessonId') || '');
        const videoId = String(body.videoId || itemId || parsedUrl.searchParams.get('videoId') || '');

        const match = findLessonInPortal(subjectId, lessonId);
        if (!match) {
            res.statusCode = 404;
            res.end(JSON.stringify({ ok: false, code: 'NOT_FOUND', error: 'Lesson not found.' }));
            return;
        }
        const videos = Array.isArray(match.lesson.videos) ? match.lesson.videos : [];
        const foundVid = videos.find(v => String(v.id) === videoId);
        if (!foundVid) {
            res.statusCode = 404;
            res.end(JSON.stringify({ ok: false, code: 'NOT_FOUND', error: 'Video not found for this lesson.' }));
            return;
        }

        if (!isAdmin) {
            const check = evaluateItemAccess(user, classKey, foundVid, state);
            if (!check.allowed) {
                res.statusCode = check.status || 403;
                res.end(JSON.stringify({
                    ok: false,
                    code: check.code,
                    requiredPlan: check.requiredPlan,
                    userPlan: check.userPlan,
                    itemTitle: foundVid.title || 'Lesson Video',
                    plansConfig: state.plansConfig,
                    error: check.error
                }));
                return;
            }
        }

        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            itemType: 'lesson-video',
            classKey,
            lessonId,
            item: foundVid
        }));
        return;
    }

    // 2. Topic / Question lookup & server-side verification
    if (itemType === 'topic' || itemType === 'question') {
        let foundUnit = null;
        let foundTopic = null;
        for (const u of (portal.units || [])) {
            const t = (u.topics || []).find(item => String(item.id) === itemId);
            if (t) {
                foundUnit = u;
                foundTopic = t;
                break;
            }
        }

        if (!foundTopic) {
            res.statusCode = 404;
            res.end(JSON.stringify({ ok: false, code: 'NOT_FOUND', error: 'Lesson not found.' }));
            return;
        }

        const sanitizedPdfs = (Array.isArray(foundTopic.pdfs) ? foundTopic.pdfs : []).map(pdf => {
            const check = isAdmin ? { allowed: true } : evaluateItemAccess(user, classKey, pdf, state);
            return {
                id: pdf.id,
                title: pdf.title || pdf.fileName || 'Lesson PDF',
                fileName: pdf.fileName || '',
                fileSize: pdf.fileSize || 'PDF',
                minPlan: normalizePlan(pdf.minPlan || 'free'),
                uploadedAt: pdf.uploadedAt || '',
                restricted: !check.allowed,
                hasFile: Boolean(pdf.fileUrl)
            };
        });

        // Return lesson metadata + PDFs list (never manualNotes)
        const { manualNotes, ...topicSafe } = foundTopic;
        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            itemType: 'topic',
            classKey,
            unit: { code: foundUnit.code, title: foundUnit.title, marks: foundUnit.marks },
            item: { ...topicSafe, pdfs: sanitizedPdfs }
        }));
        return;
    }

    // 3. PDF / Note lookup & server-side verification
    if (itemType === 'note' || itemType === 'pdf') {
        const notes = Array.isArray(portal.notes) && portal.notes.length ? portal.notes : (portal.notesPdfs || []);
        let foundNote = notes.find(n => String(n.id) === itemId);
        if (!foundNote && /^\d+$/.test(itemId)) {
            foundNote = notes[Number(itemId)];
        }

        if (!foundNote) {
            res.statusCode = 404;
            res.end(JSON.stringify({ ok: false, code: 'NOT_FOUND', error: 'PDF resource not found.' }));
            return;
        }

        if (!isAdmin) {
            const check = evaluateItemAccess(user, classKey, foundNote, state);
            if (!check.allowed) {
                res.statusCode = check.status || 403;
                res.end(JSON.stringify({
                    ok: false,
                    code: check.code,
                    requiredPlan: check.requiredPlan,
                    userPlan: check.userPlan,
                    itemTitle: foundNote.title,
                    plansConfig: state.plansConfig,
                    error: check.error
                }));
                return;
            }
        }

        // Build downloadable summary text if no external/uploaded PDF URL is attached
        const unitsSummary = (portal.units || []).map(u => {
            const allowedTopics = (u.topics || []).filter(t => isAdmin || evaluateItemAccess(user, classKey, t, state).allowed);
            if (!allowedTopics.length) return '';
            return `[${u.code}: ${u.title}] (${u.marks || ''})\n` + allowedTopics.map(t => `  * ${t.title}`).join('\n');
        }).filter(Boolean).join('\n\n');

        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            itemType: 'note',
            classKey,
            item: foundNote,
            downloadSummary: `BPG EDUCARE — ${foundNote.title}\nProgram: ${portal.gradeTitle}\nScope: ${foundNote.unit || 'All Units'} | ${foundNote.pages || 'PDF'}\n\n${unitsSummary}\n\n© 2026 BPG EDUCARE.`
        }));
        return;
    }

    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: 'Unsupported itemType. Use section, topic, or note.' }));
};
