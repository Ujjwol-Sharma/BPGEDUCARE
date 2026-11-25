/**
 * BPG EDUCARE — Server-Authoritative Mock Tests & Timed Attempts API (/api/mock-tests)
 * - Answer key (correctOption) is NEVER returned to students until an attempt is submitted.
 * - Active attempt finishAt & answers persist server-side so page refreshes never reset timer or progress.
 * - Enforces section locks (across all plans including Diamond) and Free / Gold / Diamond plan rules.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
    DATA_DIR,
    gradeToClassKey,
    normalizeGradeName,
    normalizePlan,
    isAdminPasskeyValid,
    readAcademyState,
    readRoster,
    resolveRequestUser,
    evaluateItemAccess,
    canonicalizeEmail,
    getEffectiveMockTestStatus,
    formatNepalTime,
    reconcileScheduledMockTests,
    DB_PATH,
    LEGACY_CMS_PATH,
    TMP_DB_PATH
} = require('./_access-control');
const { queueDurableWrite } = require('./_durable-storage');

const ATTEMPTS_PATH = path.join(DATA_DIR, 'mock-attempts.json');
const TMP_ATTEMPTS_PATH = path.join(os.tmpdir(), 'bpg-mock-attempts.json');

function readAttemptsStore() {
    if (global.__BPG_MOCK_ATTEMPTS__ && Array.isArray(global.__BPG_MOCK_ATTEMPTS__.attempts)) {
        return global.__BPG_MOCK_ATTEMPTS__;
    }
    let store = null;
    let bestRev = -1;
    for (const p of [TMP_ATTEMPTS_PATH, ATTEMPTS_PATH]) {
        try {
            if (fs.existsSync(p)) {
                const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
                if (parsed && Array.isArray(parsed.attempts)) {
                    const rev = Number(parsed.revision) || (p === TMP_ATTEMPTS_PATH ? 1 : 0);
                    if (!store || rev > bestRev) {
                        store = parsed;
                        bestRev = rev;
                    }
                }
            }
        } catch (e) {}
    }
    if (!store) {
        store = { revision: 1, lastUpdated: new Date().toISOString(), attempts: [] };
    }
    store.revision = Number(store.revision) || 1;
    global.__BPG_MOCK_ATTEMPTS__ = store;
    return store;
}

function writeAttemptsStore(store) {
    const nextRevision = (Number(store?.revision) || Number(global.__BPG_MOCK_ATTEMPTS__?.revision) || 1) + 1;
    const clean = {
        revision: nextRevision,
        lastUpdated: new Date().toISOString(),
        attempts: store.attempts || []
    };
    global.__BPG_MOCK_ATTEMPTS__ = clean;
    const serialized = JSON.stringify(clean, null, 2);
    try {
        fs.writeFileSync(TMP_ATTEMPTS_PATH, serialized, 'utf8');
    } catch (e) {}
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = ATTEMPTS_PATH + '.tmp.' + Date.now();
        fs.writeFileSync(tmp, serialized, 'utf8');
        fs.renameSync(tmp, ATTEMPTS_PATH);
    } catch (e) {}
    try { queueDurableWrite('mock-attempts.json', serialized); } catch (e) {}
    return clean;
}

function persistMockTestsToAcademyState(state) {
    state.revision = (Number(state.revision) || Number(global.__BPG_ACADEMY_STATE__?.revision) || 1) + 1;
    state.lastUpdated = new Date().toISOString();
    delete state.adminPasskey;
    global.__BPG_ACADEMY_STATE__ = state;
    const serialized = JSON.stringify(state, null, 2);
    try { fs.writeFileSync(TMP_DB_PATH, serialized, 'utf8'); } catch (e) {}
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = DB_PATH + '.tmp.' + Date.now();
        fs.writeFileSync(tmp, serialized, 'utf8');
        fs.renameSync(tmp, DB_PATH);
    } catch (e) {}
    try { fs.writeFileSync(LEGACY_CMS_PATH, serialized, 'utf8'); } catch (e) {}
    try { queueDurableWrite('academy-state.json', serialized); } catch (e) {}
}

function stripAnswerKeyFromQuestions(questions) {
    return (Array.isArray(questions) ? questions : []).map((q, idx) => ({
        id: q.id || `q_${idx + 1}`,
        text: q.text || '',
        options: {
            A: q.options?.A || '',
            B: q.options?.B || '',
            C: q.options?.C || '',
            D: q.options?.D || ''
        }
        // NOTE: correctOption intentionally omitted until submission!
    }));
}

function gradeAttempt(test, answersMap, autoSubmitted = false) {
    const questions = Array.isArray(test.questions) ? test.questions : [];
    const ans = answersMap && typeof answersMap === 'object' ? answersMap : {};

    let correctCount = 0;
    let wrongCount = 0;
    let skippedCount = 0;

    const review = questions.map((q, idx) => {
        const qid = q.id || `q_${idx + 1}`;
        const selected = ans[qid] ? String(ans[qid]).toUpperCase() : null;
        const correct = String(q.correctOption || 'A').toUpperCase();
        let status = 'skipped';
        if (!selected || !['A', 'B', 'C', 'D'].includes(selected)) {
            skippedCount++;
            status = 'skipped';
        } else if (selected === correct) {
            correctCount++;
            status = 'correct';
        } else {
            wrongCount++;
            status = 'wrong';
        }
        return {
            id: qid,
            text: q.text || '',
            options: {
                A: q.options?.A || '',
                B: q.options?.B || '',
                C: q.options?.C || '',
                D: q.options?.D || ''
            },
            selectedOption: selected,
            correctOption: correct,
            marksAwarded: status === 'correct' ? 1 : 0,
            maxMarks: 1,
            status
        };
    });

    const total = questions.length;
    const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0;

    return {
        score: correctCount,
        total,
        percentage,
        correctCount,
        wrongCount,
        skippedCount,
        autoSubmitted: Boolean(autoSubmitted),
        review
    };
}

function finalizeExpiredAttemptIfNeeded(attempt, test, store) {
    if (!attempt || attempt.submitted) return attempt;
    if (Date.now() >= Number(attempt.finishAt || 0)) {
        attempt.submitted = true;
        attempt.submittedAt = new Date().toISOString();
        attempt.autoSubmitted = true;
        attempt.result = gradeAttempt(test, attempt.answers, true);
        writeAttemptsStore(store);
    }
    return attempt;
}

module.exports = function mockTestsHandler(req, res) {
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
    if (!Array.isArray(state.mockTests)) state.mockTests = [];
    if (reconcileScheduledMockTests(state)) {
        persistMockTestsToAcademyState(state);
    }

    // Enforce Maintenance Mode for all non-admin mock test requests
    if (!isAdmin && state.maintenanceMode?.enabled) {
        res.statusCode = 503;
        res.end(JSON.stringify({
            ok: false,
            code: 'MAINTENANCE_MODE',
            error: state.maintenanceMode.message || 'Mock tests are locked during scheduled maintenance.'
        }));
        return;
    }

    /* ----------------------------------------------------------------------
       GET /api/mock-tests
       ---------------------------------------------------------------------- */
    if (req.method === 'GET') {
        const rawClass = parsedUrl.searchParams.get('classKey') || '';
        const subjectId = parsedUrl.searchParams.get('subjectId') || '';

        if (isAdmin) {
            const nowMs = Date.now();
            const wantResults = parsedUrl.searchParams.get('results') === '1';
            const targetTestId = String(parsedUrl.searchParams.get('testId') || '').trim();

            if (wantResults && targetTestId) {
                const test = state.mockTests.find(t => t.id === targetTestId);
                if (!test) {
                    res.statusCode = 404;
                    res.end(JSON.stringify({ ok: false, error: 'Mock test not found.' }));
                    return;
                }
                const store = readAttemptsStore();
                const roster = readRoster();
                const accById = new Map();
                const accByCanon = new Map();
                for (const a of (roster.accounts || [])) {
                    if (a.userId) accById.set(a.userId, a);
                    if (a.canonicalEmail) accByCanon.set(a.canonicalEmail, a);
                }

                // Finalize any expired attempts on this test before computing stats
                const rawTestAttempts = store.attempts.filter(a => a && a.testId === targetTestId);
                rawTestAttempts.forEach(a => finalizeExpiredAttemptIfNeeded(a, test, store));

                // Sort chronologically per student to assign accurate attemptNumber (1, 2, 3...)
                const byStudentChrono = new Map();
                const sortedChrono = [...rawTestAttempts].sort((a, b) => Number(a.startedAt || 0) - Number(b.startedAt || 0));
                const attemptNumMap = new Map();
                for (const a of sortedChrono) {
                    const key = a.userId || a.canonicalEmail || a.email || a.id;
                    const count = (byStudentChrono.get(key) || 0) + 1;
                    byStudentChrono.set(key, count);
                    attemptNumMap.set(a.id, Number(a.attemptNumber) || count);
                }

                // Build detailed per-attempt rows (preserving historical review snapshots & marks!)
                const attemptRows = rawTestAttempts.map(a => {
                    const acc = (a.userId && accById.get(a.userId)) || (a.canonicalEmail && accByCanon.get(a.canonicalEmail)) || null;
                    const studentKey = acc?.userId || a.userId || a.canonicalEmail || a.id;
                    const isSubmitted = Boolean(a.submitted);
                    const marksEarned = isSubmitted ? Number(a.result?.score ?? 0) : 0;
                    const totalMarks = isSubmitted
                        ? Number(a.result?.total ?? (a.result?.review?.length || (test.questions || []).length))
                        : (test.questions || []).length;
                    const percentage = isSubmitted
                        ? Number(a.result?.percentage ?? (totalMarks > 0 ? Math.round((marksEarned / totalMarks) * 100) : 0))
                        : 0;
                    const startedMs = Number(a.startedAt || 0);
                    const submittedMs = a.submittedAt ? Date.parse(a.submittedAt) : 0;
                    const durationCapSec = Math.max(1, Number(test.durationMinutes || 30)) * 60;
                    const computedSec = Number.isFinite(Number(a.timeTakenSeconds)) && Number(a.timeTakenSeconds) > 0
                        ? Number(a.timeTakenSeconds)
                        : (isSubmitted && startedMs && submittedMs
                            ? Math.max(1, Math.min(durationCapSec, Math.round((submittedMs - startedMs) / 1000)))
                            : (startedMs ? Math.max(0, Math.round((nowMs - startedMs) / 1000)) : 0));

                    const statusLabel = !isSubmitted
                        ? 'In Progress'
                        : (a.autoSubmitted ? 'Auto-submitted' : 'Completed');

                    // Preserve exact historical review items recorded when attempt was graded
                    const review = Array.isArray(a.result?.review)
                        ? a.result.review.map(item => ({
                            ...item,
                            marksAwarded: item.marksAwarded !== undefined ? item.marksAwarded : (item.status === 'correct' ? 1 : 0),
                            maxMarks: item.maxMarks !== undefined ? item.maxMarks : 1
                        }))
                        : [];

                    return {
                        attemptId: a.id,
                        studentKey,
                        userId: acc?.userId || a.userId || '',
                        studentName: acc?.name || a.userName || 'Student',
                        username: acc?.username || a.username || '',
                        className: acc?.grade || a.grade || normalizeGradeName(a.classKey || test.classKey),
                        marksEarned,
                        totalMarks,
                        percentage,
                        attemptNumber: attemptNumMap.get(a.id) || 1,
                        timeTakenSeconds: computedSec,
                        submittedAt: a.submittedAt || '',
                        submittedAtNpt: a.submittedAt ? formatNepalTime(a.submittedAt) : '',
                        status: statusLabel,
                        submitted: isSubmitted,
                        correctCount: a.result?.correctCount ?? 0,
                        wrongCount: a.result?.wrongCount ?? 0,
                        skippedCount: a.result?.skippedCount ?? 0,
                        review
                    };
                });

                // Compute rankings using each student's BEST completed attempt (counting each student ONCE!)
                const completedRows = attemptRows.filter(r => r.submitted);
                const bestByStudent = new Map();
                for (const row of completedRows) {
                    const prev = bestByStudent.get(row.studentKey);
                    if (!prev
                        || row.marksEarned > prev.marksEarned
                        || (row.marksEarned === prev.marksEarned && row.percentage > prev.percentage)
                        || (row.marksEarned === prev.marksEarned && row.percentage === prev.percentage && row.timeTakenSeconds < prev.timeTakenSeconds)) {
                        bestByStudent.set(row.studentKey, row);
                    }
                }

                // Rank distinct students by best completed marks (standard competition ranking: ties share same rank)
                const rankedStudents = Array.from(bestByStudent.values()).sort((a, b) =>
                    (b.marksEarned - a.marksEarned)
                    || (b.percentage - a.percentage)
                    || (a.timeTakenSeconds - b.timeTakenSeconds)
                );

                const rankByStudentKey = new Map();
                const bestAttemptIdSet = new Set();
                let currentRank = 0;
                let lastMarks = null;
                rankedStudents.forEach((entry, idx) => {
                    if (lastMarks === null || entry.marksEarned < lastMarks) {
                        currentRank = idx + 1;
                        lastMarks = entry.marksEarned;
                    }
                    rankByStudentKey.set(entry.studentKey, currentRank);
                    bestAttemptIdSet.add(entry.attemptId);
                });

                const highestMarks = rankedStudents.length > 0 ? rankedStudents[0].marksEarned : null;
                const highestTotal = rankedStudents.length > 0 ? rankedStudents[0].totalMarks : (test.questions || []).length;
                const topScorers = highestMarks !== null
                    ? rankedStudents
                        .filter(s => s.marksEarned === highestMarks)
                        .map(s => ({
                            userId: s.userId,
                            studentName: s.studentName,
                            username: s.username,
                            className: s.className,
                            marksEarned: s.marksEarned,
                            totalMarks: s.totalMarks,
                            percentage: s.percentage,
                            attemptId: s.attemptId,
                            attemptNumber: s.attemptNumber,
                            timeTakenSeconds: s.timeTakenSeconds,
                            submittedAtNpt: s.submittedAtNpt
                        }))
                    : [];

                // Class average across completed attempts (and across unique students' best scores)
                const avgMarks = completedRows.length > 0
                    ? Number((completedRows.reduce((acc, r) => acc + r.marksEarned, 0) / completedRows.length).toFixed(2))
                    : 0;
                const avgPercentage = completedRows.length > 0
                    ? Number((completedRows.reduce((acc, r) => acc + r.percentage, 0) / completedRows.length).toFixed(1))
                    : 0;

                const annotatedAttempts = attemptRows.map(r => ({
                    ...r,
                    rank: r.submitted ? (rankByStudentKey.get(r.studentKey) || null) : null,
                    isBestAttempt: bestAttemptIdSet.has(r.attemptId)
                }));

                res.statusCode = 200;
                res.end(JSON.stringify({
                    ok: true,
                    serverNow: nowMs,
                    test: {
                        id: test.id,
                        title: test.title,
                        classKey: test.classKey,
                        className: normalizeGradeName(test.classKey),
                        durationMinutes: Number(test.durationMinutes || 30),
                        questionCount: (test.questions || []).length,
                        effectiveStatus: getEffectiveMockTestStatus(test, nowMs),
                        scheduledReleaseNpt: test.scheduledReleaseAt ? formatNepalTime(test.scheduledReleaseAt) : ''
                    },
                    summary: {
                        totalAttempts: annotatedAttempts.length,
                        submittedAttempts: completedRows.length,
                        uniqueStudentsCompleted: rankedStudents.length,
                        highestMarks,
                        highestTotal,
                        topScorers,
                        averageMarks: avgMarks,
                        averagePercentage: avgPercentage
                    },
                    attempts: annotatedAttempts
                }));
                return;
            }

            let list = state.mockTests;
            if (rawClass) {
                const ck = gradeToClassKey(rawClass);
                list = list.filter(t => t.classKey === ck);
            }
            if (subjectId) {
                list = list.filter(t => t.subjectId === subjectId);
            }
            const store = readAttemptsStore();
            const enriched = list.map(t => {
                const subCount = store.attempts.filter(a => a.testId === t.id && a.submitted).length;
                return {
                    ...t,
                    effectiveStatus: getEffectiveMockTestStatus(t, nowMs),
                    scheduledReleaseNpt: t.scheduledReleaseAt ? formatNepalTime(t.scheduledReleaseAt) : '',
                    submittedAttemptCount: subCount
                };
            });
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, serverNow: nowMs, tests: enriched }));
            return;
        }

        const user = resolveRequestUser(req);
        const classKey = gradeToClassKey(rawClass || user?.classKey || 'class-12');
        if (user && user.email && user.classKey && classKey !== gradeToClassKey(user.classKey || user.grade)) {
            res.statusCode = 403;
            res.end(JSON.stringify({
                ok: false,
                code: 'CLASS_MISMATCH',
                error: `Your account is enrolled in ${user.grade || user.classKey}.`
            }));
            return;
        }
        const lock = state.sectionLocks?.[classKey] || { locked: false, reason: '' };

        if (lock.locked) {
            res.statusCode = 403;
            res.end(JSON.stringify({
                ok: false,
                code: 'SECTION_LOCKED',
                locked: true,
                error: lock.reason || 'Temporarily unavailable'
            }));
            return;
        }

        const store = readAttemptsStore();
        const userCanonical = user ? canonicalizeEmail(user.email) : '';
        const userId = user?.userId || '';
        const nowMs = Date.now();

        const visibleTests = state.mockTests
            .filter(t => {
                const eff = getEffectiveMockTestStatus(t, nowMs);
                return (eff === 'live' || eff === 'scheduled') && t.classKey === classKey && (!subjectId || t.subjectId === subjectId);
            })
            .map(t => {
                const eff = getEffectiveMockTestStatus(t, nowMs);
                const isScheduled = eff === 'scheduled';
                const accessCheck = evaluateItemAccess(user, classKey, t, state);
                let activeAttempt = null;
                let latestSubmitted = null;

                if (!isScheduled && (userId || userCanonical)) {
                    const userAttempts = store.attempts
                        .filter(a => a.testId === t.id && ((userId && a.userId === userId) || (userCanonical && a.canonicalEmail === userCanonical)))
                        .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0));

                    const openAtt = userAttempts.find(a => !a.submitted);
                    if (openAtt) {
                        finalizeExpiredAttemptIfNeeded(openAtt, t, store);
                        if (!openAtt.submitted) {
                            activeAttempt = {
                                id: openAtt.id,
                                startedAt: openAtt.startedAt,
                                finishAt: openAtt.finishAt,
                                answeredCount: Object.keys(openAtt.answers || {}).length
                            };
                        }
                    }
                    const subAtt = userAttempts.find(a => a.submitted);
                    if (subAtt) {
                        latestSubmitted = {
                            id: subAtt.id,
                            submittedAt: subAtt.submittedAt,
                            score: subAtt.result?.score ?? 0,
                            total: subAtt.result?.total ?? (t.questions || []).length,
                            percentage: subAtt.result?.percentage ?? 0
                        };
                    }
                }

                return {
                    id: t.id,
                    classKey: t.classKey,
                    subjectId: t.subjectId,
                    title: t.title,
                    durationMinutes: Number(t.durationMinutes || 30),
                    questionCount: (t.questions || []).length,
                    minPlan: normalizePlan(t.minPlan || 'free'),
                    effectiveStatus: eff,
                    comingSoon: isScheduled,
                    scheduledReleaseAt: t.scheduledReleaseAt || '',
                    scheduledReleaseNpt: t.scheduledReleaseAt ? formatNepalTime(t.scheduledReleaseAt) : '',
                    restricted: !accessCheck.allowed,
                    activeAttempt,
                    latestSubmitted
                };
            });

        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true, classKey, subjectId, serverNow: nowMs, tests: visibleTests }));
        return;
    }

    /* ----------------------------------------------------------------------
       POST /api/mock-tests
       ---------------------------------------------------------------------- */
    if (req.method === 'POST') {
        const action = String(body.action || '').toUpperCase();

        // ADMIN: SAVE_TEST
        if (action === 'SAVE_TEST') {
            if (!isAdmin) {
                res.statusCode = 401;
                res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Admin passkey required.' }));
                return;
            }
            const incoming = body.test || {};
            const classKey = gradeToClassKey(incoming.classKey || 'class-12');
            const subjectId = String(incoming.subjectId || 'mathematics').trim();
            const title = String(incoming.title || '').trim();
            const durationMinutes = Math.max(1, Math.min(300, Number(incoming.durationMinutes) || 30));
            const rawStatus = String(incoming.status || 'draft').toLowerCase();
            let status = rawStatus === 'published' ? 'published' : (rawStatus === 'scheduled' ? 'scheduled' : 'draft');
            const minPlan = normalizePlan(incoming.minPlan || 'free');
            const rawQs = Array.isArray(incoming.questions) ? incoming.questions : [];
            let scheduledReleaseAt = '';

            if (!title) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: 'Test title is required.' }));
                return;
            }

            if (status === 'scheduled') {
                const parsedMs = Date.parse(String(incoming.scheduledReleaseAt || ''));
                if (!Number.isFinite(parsedMs)) {
                    res.statusCode = 400;
                    res.end(JSON.stringify({ ok: false, error: 'Select a valid release date and time in Nepal Time (Asia/Kathmandu).' }));
                    return;
                }
                scheduledReleaseAt = new Date(parsedMs).toISOString();
                // If scheduled time is already in the past/now, immediately treat as published
                if (parsedMs <= Date.now()) {
                    status = 'published';
                }
            }

            const cleanQuestions = rawQs.map((q, idx) => {
                const corr = String(q.correctOption || 'A').toUpperCase();
                return {
                    id: q.id || `q_${Date.now()}_${idx}`,
                    text: String(q.text || '').trim(),
                    options: {
                        A: String(q.options?.A || '').trim(),
                        B: String(q.options?.B || '').trim(),
                        C: String(q.options?.C || '').trim(),
                        D: String(q.options?.D || '').trim()
                    },
                    correctOption: ['A', 'B', 'C', 'D'].includes(corr) ? corr : 'A'
                };
            });

            if ((status === 'published' || status === 'scheduled') && cleanQuestions.length === 0) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: 'Add at least one question before publishing or scheduling.' }));
                return;
            }

            const nowIso = new Date().toISOString();
            const testId = incoming.id || `mt_${Date.now()}`;
            const existingIdx = state.mockTests.findIndex(t => t.id === testId);
            const existingRecord = existingIdx >= 0 ? state.mockTests[existingIdx] : null;

            const record = {
                id: testId,
                classKey,
                subjectId,
                title,
                durationMinutes,
                minPlan,
                adminAssignedPlan: true,
                status,
                scheduledReleaseAt: status === 'scheduled' ? scheduledReleaseAt : '',
                releasedAt: status === 'published' ? (existingRecord?.releasedAt || nowIso) : '',
                releaseNotifiedAt: status === 'scheduled' ? '' : (existingRecord?.releaseNotifiedAt || ''),
                questions: cleanQuestions,
                createdAt: existingRecord ? (existingRecord.createdAt || nowIso) : nowIso,
                updatedAt: nowIso
            };

            if (existingIdx >= 0) {
                state.mockTests[existingIdx] = record;
            } else {
                state.mockTests.unshift(record);
            }

            reconcileScheduledMockTests(state);
            persistMockTestsToAcademyState(state);
            res.statusCode = 200;
            res.end(JSON.stringify({
                ok: true,
                test: {
                    ...record,
                    effectiveStatus: getEffectiveMockTestStatus(record),
                    scheduledReleaseNpt: record.scheduledReleaseAt ? formatNepalTime(record.scheduledReleaseAt) : ''
                },
                tests: state.mockTests.map(t => ({
                    ...t,
                    effectiveStatus: getEffectiveMockTestStatus(t),
                    scheduledReleaseNpt: t.scheduledReleaseAt ? formatNepalTime(t.scheduledReleaseAt) : ''
                }))
            }));
            return;
        }

        // ADMIN: CANCEL_SCHEDULE (moves scheduled test back to draft, preserving all questions & past attempts)
        if (action === 'CANCEL_SCHEDULE') {
            if (!isAdmin) {
                res.statusCode = 401;
                res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Admin passkey required.' }));
                return;
            }
            const testId = String(body.testId || '');
            const found = state.mockTests.find(t => t.id === testId);
            if (!found) {
                res.statusCode = 404;
                res.end(JSON.stringify({ ok: false, error: 'Mock test not found.' }));
                return;
            }
            found.status = 'draft';
            found.scheduledReleaseAt = '';
            found.updatedAt = new Date().toISOString();
            persistMockTestsToAcademyState(state);
            res.statusCode = 200;
            res.end(JSON.stringify({
                ok: true,
                test: { ...found, effectiveStatus: 'draft', scheduledReleaseNpt: '' },
                tests: state.mockTests.map(t => ({
                    ...t,
                    effectiveStatus: getEffectiveMockTestStatus(t),
                    scheduledReleaseNpt: t.scheduledReleaseAt ? formatNepalTime(t.scheduledReleaseAt) : ''
                }))
            }));
            return;
        }

        // ADMIN: DELETE_TEST
        if (action === 'DELETE_TEST') {
            if (!isAdmin) {
                res.statusCode = 401;
                res.end(JSON.stringify({ ok: false, error: 'Unauthorized: Admin passkey required.' }));
                return;
            }
            const testId = String(body.testId || '');
            state.mockTests = state.mockTests.filter(t => t.id !== testId);
            persistMockTestsToAcademyState(state);
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: true, tests: state.mockTests }));
            return;
        }

        // STUDENT ACTIONS REQUIRE AUTHENTICATED USER
        const user = resolveRequestUser(req);
        if (!user || !user.email) {
            res.statusCode = 401;
            res.end(JSON.stringify({ ok: false, code: 'AUTH_REQUIRED', error: 'Please sign in to take mock tests.' }));
            return;
        }

        const userCanonical = canonicalizeEmail(user.email);
        const userId = user.userId || '';
        const testId = String(body.testId || '');
        const test = state.mockTests.find(t => t.id === testId);
        const effStatus = getEffectiveMockTestStatus(test);

        if (!test || effStatus === 'draft') {
            res.statusCode = 404;
            res.end(JSON.stringify({ ok: false, code: 'NOT_FOUND', error: 'Mock test not found or not published.' }));
            return;
        }

        if (effStatus === 'scheduled') {
            res.statusCode = 403;
            res.end(JSON.stringify({
                ok: false,
                code: 'TEST_NOT_YET_LIVE',
                scheduledReleaseAt: test.scheduledReleaseAt || '',
                scheduledReleaseNpt: formatNepalTime(test.scheduledReleaseAt),
                error: `This mock test is scheduled to go live on ${formatNepalTime(test.scheduledReleaseAt)}. Questions cannot be accessed early.`
            }));
            return;
        }

        // Enforce section lock + plan access on every attempt action
        const check = evaluateItemAccess(user, test.classKey, test, state);
        if (!check.allowed) {
            res.statusCode = check.status || 403;
            res.end(JSON.stringify({
                ok: false,
                code: check.code,
                requiredPlan: check.requiredPlan,
                userPlan: check.userPlan,
                itemTitle: test.title,
                plansConfig: state.plansConfig,
                error: check.error
            }));
            return;
        }

        const store = readAttemptsStore();

        // STUDENT: START_ATTEMPT (or resume existing active attempt without resetting timer; idempotent on retries!)
        if (action === 'START_ATTEMPT') {
            const forceNew = Boolean(body.retake);
            const clientRequestId = String(body.clientRequestId || '').trim();
            const ownsAttempt = (a) => (userId && a.userId === userId) || a.canonicalEmail === userCanonical;
            let active = clientRequestId
                ? store.attempts.find(a => a.clientRequestId === clientRequestId && a.testId === test.id && ownsAttempt(a))
                : null;
            if (!active && !forceNew) {
                active = store.attempts.find(a => a.testId === test.id && ownsAttempt(a) && !a.submitted) || null;
            }

            if (active) {
                finalizeExpiredAttemptIfNeeded(active, test, store);
                if (active.submitted) {
                    res.statusCode = 200;
                    res.end(JSON.stringify({
                        ok: true,
                        status: 'submitted',
                        autoSubmitted: true,
                        serverNow: Date.now(),
                        attempt: {
                            id: active.id,
                            testId: test.id,
                            startedAt: active.startedAt,
                            finishAt: active.finishAt,
                            submittedAt: active.submittedAt
                        },
                        test: { id: test.id, title: test.title, durationMinutes: test.durationMinutes },
                        result: active.result
                    }));
                    return;
                }
            } else {
                const now = Date.now();
                const durationMs = Math.max(1, Number(test.durationMinutes || 30)) * 60 * 1000;
                const priorCount = store.attempts.filter(a => a.testId === test.id && ownsAttempt(a)).length;
                active = {
                    id: `att_${now}_${Math.floor(Math.random() * 10000)}`,
                    clientRequestId: clientRequestId || '',
                    attemptNumber: priorCount + 1,
                    testId: test.id,
                    userId,
                    userName: user.name || 'Student',
                    username: user.username || '',
                    grade: user.grade || normalizeGradeName(test.classKey),
                    canonicalEmail: userCanonical,
                    email: user.email,
                    classKey: test.classKey,
                    startedAt: now,
                    finishAt: now + durationMs,
                    answers: {},
                    submitted: false,
                    submittedAt: null,
                    timeTakenSeconds: 0,
                    autoSubmitted: false,
                    result: null
                };
                store.attempts.unshift(active);
                writeAttemptsStore(store);
            }

            res.statusCode = 200;
            res.end(JSON.stringify({
                ok: true,
                status: 'in_progress',
                serverNow: Date.now(),
                attempt: {
                    id: active.id,
                    testId: test.id,
                    startedAt: active.startedAt,
                    finishAt: active.finishAt,
                    answers: active.answers || {}
                },
                test: {
                    id: test.id,
                    title: test.title,
                    classKey: test.classKey,
                    subjectId: test.subjectId,
                    durationMinutes: test.durationMinutes,
                    questions: stripAnswerKeyFromQuestions(test.questions)
                }
            }));
            return;
        }

        // STUDENT: SAVE_ANSWER (persists answers mid-attempt; auto-submits if time already expired!)
        if (action === 'SAVE_ANSWER') {
            const attemptId = String(body.attemptId || '');
            const attempt = store.attempts.find(a => a.id === attemptId && a.canonicalEmail === userCanonical && a.testId === test.id);
            if (!attempt) {
                res.statusCode = 404;
                res.end(JSON.stringify({ ok: false, error: 'Active attempt not found.' }));
                return;
            }
            if (attempt.submitted) {
                res.statusCode = 200;
                res.end(JSON.stringify({ ok: true, status: 'submitted', autoSubmitted: attempt.autoSubmitted, result: attempt.result }));
                return;
            }

            if (body.answers && typeof body.answers === 'object') {
                Object.keys(body.answers).forEach(qid => {
                    const val = body.answers[qid];
                    if (val && ['A', 'B', 'C', 'D'].includes(String(val).toUpperCase())) {
                        attempt.answers[qid] = String(val).toUpperCase();
                    } else {
                        delete attempt.answers[qid];
                    }
                });
            } else if (body.questionId) {
                const val = body.selectedOption;
                if (val && ['A', 'B', 'C', 'D'].includes(String(val).toUpperCase())) {
                    attempt.answers[body.questionId] = String(val).toUpperCase();
                } else {
                    delete attempt.answers[body.questionId];
                }
            }

            finalizeExpiredAttemptIfNeeded(attempt, test, store);
            if (attempt.submitted) {
                res.statusCode = 200;
                res.end(JSON.stringify({
                    ok: true,
                    status: 'submitted',
                    autoSubmitted: true,
                    result: attempt.result
                }));
                return;
            }

            writeAttemptsStore(store);
            res.statusCode = 200;
            res.end(JSON.stringify({
                ok: true,
                status: 'in_progress',
                serverNow: Date.now(),
                finishAt: attempt.finishAt,
                answers: attempt.answers
            }));
            return;
        }

        // STUDENT: SUBMIT_ATTEMPT (early or automatic on timeout — reveals answer key & score!)
        if (action === 'SUBMIT_ATTEMPT') {
            const attemptId = String(body.attemptId || '');
            const attempt = store.attempts.find(a => a.id === attemptId && a.canonicalEmail === userCanonical && a.testId === test.id);
            if (!attempt) {
                res.statusCode = 404;
                res.end(JSON.stringify({ ok: false, error: 'Attempt not found.' }));
                return;
            }

            if (!attempt.submitted) {
                if (body.answers && typeof body.answers === 'object') {
                    Object.keys(body.answers).forEach(qid => {
                        const val = body.answers[qid];
                        if (val && ['A', 'B', 'C', 'D'].includes(String(val).toUpperCase())) {
                            attempt.answers[qid] = String(val).toUpperCase();
                        }
                    });
                }
                const timedOut = Boolean(body.autoSubmitted) || Date.now() >= Number(attempt.finishAt || 0);
                const nowMs = Date.now();
                const maxDurSec = Math.max(1, Number(test.durationMinutes || 30)) * 60;
                attempt.submitted = true;
                attempt.submittedAt = new Date(nowMs).toISOString();
                attempt.timeTakenSeconds = attempt.startedAt
                    ? Math.max(1, Math.min(maxDurSec, Math.round((nowMs - Number(attempt.startedAt)) / 1000)))
                    : 0;
                attempt.autoSubmitted = timedOut;
                attempt.result = gradeAttempt(test, attempt.answers, timedOut);
                writeAttemptsStore(store);
            }

            res.statusCode = 200;
            res.end(JSON.stringify({
                ok: true,
                status: 'submitted',
                autoSubmitted: attempt.autoSubmitted,
                attempt: {
                    id: attempt.id,
                    startedAt: attempt.startedAt,
                    finishAt: attempt.finishAt,
                    submittedAt: attempt.submittedAt
                },
                test: { id: test.id, title: test.title, durationMinutes: test.durationMinutes },
                result: attempt.result
            }));
            return;
        }

        res.statusCode = 400;
        res.end(JSON.stringify({ ok: false, error: 'Unsupported action.' }));
        return;
    }

    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
};
