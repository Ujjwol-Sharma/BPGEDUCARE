/* ==========================================================================
   BPG EDUCARE — STUDENT TIMED MOCK TESTS (js/mock-tests-student.js)
   - Lists published tests for the student's selected class & subject
   - Displays question count & time limit before "Start Test"
   - Live server-synced countdown timer, question navigation, answer editing
   - Persists answers & original finishAt across page refreshes (no timer reset!)
   - Supports early submit + automatic submit when timer hits 00:00
   - Answer key stays strictly server-side until submission
   ========================================================================== */

const ACTIVE_MOCK_ATTEMPT_KEY = 'bpg_active_mock_attempt_v1';

let studentMockTestsCache = {}; // key: `${classKey}|${subjectId}` -> tests[]
let activeMockSession = null;   // { classKey, subjectId, test, attempt, currentIndex, serverOffsetMs, submitting }
let mockCountdownInterval = null;
let mockResultViewState = null; // { classKey, subjectId, test, result }

function getActiveMockPointer() {
    try {
        const raw = localStorage.getItem(ACTIVE_MOCK_ATTEMPT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function setActiveMockPointer(ptr) {
    try {
        if (ptr) localStorage.setItem(ACTIVE_MOCK_ATTEMPT_KEY, JSON.stringify(ptr));
        else localStorage.removeItem(ACTIVE_MOCK_ATTEMPT_KEY);
    } catch (e) {}
}

function stopMockCountdown() {
    if (mockCountdownInterval) {
        clearInterval(mockCountdownInterval);
        mockCountdownInterval = null;
    }
}

function formatCountdownMs(ms) {
    const clamped = Math.max(0, Math.ceil(ms / 1000));
    const hrs = Math.floor(clamped / 3600);
    const mins = Math.floor((clamped % 3600) / 60);
    const secs = clamped % 60;
    const mm = String(mins).padStart(2, '0');
    const ss = String(secs).padStart(2, '0');
    return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}

function getMockAuthHeaders() {
    const base = typeof getStudentAuthHeaders === 'function' ? getStudentAuthHeaders() : {};
    return Object.assign({ 'Content-Type': 'application/json' }, base);
}

async function loadAndRenderStudentMockTests(classKey) {
    const container = document.getElementById(`mockTestsContainer-${classKey}`);
    if (!container) return;

    const subject = typeof getActiveSubjectForClass === 'function'
        ? getActiveSubjectForClass(classKey)
        : { id: 'mathematics', name: 'Mathematics' };
    const subjectId = subject.id || 'mathematics';

    // Keep live test runner or result view if active for this class & subject
    if (activeMockSession && activeMockSession.classKey === classKey && activeMockSession.subjectId === subjectId) {
        renderActiveMockTestRunner(container);
        return;
    }
    if (mockResultViewState && mockResultViewState.classKey === classKey && mockResultViewState.subjectId === subjectId) {
        renderMockTestResultView(container, mockResultViewState);
        return;
    }

    container.innerHTML = `<div class="mock-empty-card"><p>Loading mock tests...</p></div>`;

    try {
        const url = `/api/mock-tests?classKey=${encodeURIComponent(classKey)}&subjectId=${encodeURIComponent(subjectId)}&_t=${Date.now()}`;
        const res = await fetch(url, { cache: 'no-store', headers: getMockAuthHeaders() });
        const payload = await res.json();

        if (res.status === 403 && payload.code === 'SECTION_LOCKED') {
            container.innerHTML = `
                <div class="section-locked-inline-card">
                    <span class="section-status-badge locked">Locked</span>
                    <h3>Section Locked</h3>
                    <p>${escapeHtml(payload.error || 'Temporarily unavailable')}. This section is closed across all plans until reopened.</p>
                </div>
            `;
            return;
        }

        if (!res.ok || !payload.ok) {
            container.innerHTML = `<div class="mock-empty-card"><p>${escapeHtml(payload.error || 'Unable to load mock tests right now.')}</p></div>`;
            return;
        }

        const tests = Array.isArray(payload.tests) ? payload.tests : [];
        studentMockTestsCache[`${classKey}|${subjectId}`] = tests;

        // If user refreshed mid-test, automatically resume active attempt without resetting timer!
        const ptr = getActiveMockPointer();
        if (ptr && ptr.classKey === classKey && ptr.subjectId === subjectId) {
            const match = tests.find(t => t.id === ptr.testId);
            if (match && match.activeAttempt) {
                await startOrResumeStudentMockTest(classKey, subjectId, match.id, false);
                return;
            } else if (match) {
                // Attempt may have expired during refresh; call START_ATTEMPT once to collect auto-submitted result if any
                setActiveMockPointer(null);
            }
        }

        renderMockTestsList(container, classKey, subjectId, tests, payload.serverNow || Date.now());
    } catch (err) {
        container.innerHTML = `<div class="mock-empty-card"><p>Could not load mock tests right now.</p></div>`;
    }
}

function renderMockTestsList(container, classKey, subjectId, tests, serverNow) {
    if (!tests || tests.length === 0) {
        container.innerHTML = `
            <div class="mock-empty-card">
                <i class="fa-solid fa-clipboard-list" aria-hidden="true"></i>
                <h3>No mock tests published yet</h3>
                <p>Published timed MCQ tests for this subject will appear here.</p>
            </div>
        `;
        return;
    }

    const offsetMs = (serverNow || Date.now()) - Date.now();

    container.innerHTML = `
        <div class="mock-tests-grid">
            ${tests.map(test => {
                const safeId = escapeHtml(test.id);
                const safeTitle = escapeHtml(test.title || 'Mock Test');
                const jsTitle = safeTitle.replace(/'/g, "\\'");
                const qCount = Number(test.questionCount || 0);
                const mins = Number(test.durationMinutes || 30);
                const plan = (test.minPlan || 'free').toLowerCase();
                const planLabel = typeof formatPlanLabel === 'function' ? formatPlanLabel(plan) : plan;
                const isRestricted = Boolean(test.restricted);
                const hasActive = Boolean(test.activeAttempt && !isRestricted);
                const remainingMs = hasActive ? (Number(test.activeAttempt.finishAt) - (Date.now() + offsetMs)) : 0;

                return `
                    <div class="mock-test-card ${isRestricted ? 'is-restricted-item' : ''}">
                        <div class="mock-card-top">
                            <div class="mock-card-badges">
                                <span class="mock-plan-pill ${plan}">${escapeHtml(planLabel)}</span>
                                ${hasActive ? `<span class="mock-live-pill"><i class="fa-regular fa-clock"></i> In Progress (${formatCountdownMs(remainingMs)})</span>` : ''}
                            </div>
                            ${test.latestSubmitted ? `
                                <span class="mock-score-pill">Last Score: ${test.latestSubmitted.score}/${test.latestSubmitted.total} (${test.latestSubmitted.percentage}%)</span>
                            ` : ''}
                        </div>

                        <h3 class="mock-card-title">${safeTitle}</h3>

                        <div class="mock-card-meta">
                            <span><i class="fa-regular fa-circle-question" aria-hidden="true"></i> ${qCount} ${qCount === 1 ? 'Question' : 'Questions'}</span>
                            <span><i class="fa-regular fa-clock" aria-hidden="true"></i> ${mins} min</span>
                        </div>

                        <div class="mock-card-actions">
                            ${isRestricted ? `
                                <button type="button" class="btn btn-secondary mock-start-btn" onclick="openPlanComparisonModal('${escapeHtml(plan)}', '${jsTitle}')">
                                    <i class="fa-solid fa-lock" aria-hidden="true"></i> Level up to unlock
                                </button>
                            ` : `
                                <button type="button" class="btn btn-primary mock-start-btn" onclick="startOrResumeStudentMockTest('${escapeHtml(classKey)}', '${escapeHtml(subjectId)}', '${safeId}', false)">
                                    <i class="fa-solid ${hasActive ? 'fa-play' : 'fa-clipboard-check'}" aria-hidden="true"></i>
                                    ${hasActive ? 'Resume Test' : 'Start Test'}
                                </button>
                            `}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

async function startOrResumeStudentMockTest(classKey, subjectId, testId, isRetake = false) {
    const container = document.getElementById(`mockTestsContainer-${classKey}`);
    if (!container) return;

    if (!isUserAuthenticated()) {
        if (typeof openAuthModal === 'function') openAuthModal('signin');
        return;
    }

    container.innerHTML = `<div class="mock-empty-card"><p>${isRetake ? 'Starting new attempt...' : 'Opening mock test...'}</p></div>`;

    try {
        const res = await fetch('/api/mock-tests', {
            method: 'POST',
            headers: getMockAuthHeaders(),
            body: JSON.stringify({
                action: 'START_ATTEMPT',
                testId,
                retake: Boolean(isRetake)
            })
        });
        const payload = await res.json();

        if (res.status === 403 && payload.code === 'SECTION_LOCKED') {
            if (typeof showSectionLockedModal === 'function') showSectionLockedModal(classKey);
            loadAndRenderStudentMockTests(classKey);
            return;
        }

        if (res.status === 403 && payload.code === 'PLAN_REQUIRED') {
            if (typeof openPlanComparisonModal === 'function') {
                openPlanComparisonModal(payload.requiredPlan || 'gold', payload.itemTitle || 'Mock Test');
            }
            loadAndRenderStudentMockTests(classKey);
            return;
        }

        if (!res.ok || !payload.ok) {
            showToast(payload.error || 'Could not start mock test.');
            loadAndRenderStudentMockTests(classKey);
            return;
        }

        // If attempt had already expired while away, show auto-submitted graded result immediately
        if (payload.status === 'submitted' && payload.result) {
            stopMockCountdown();
            activeMockSession = null;
            setActiveMockPointer(null);
            mockResultViewState = {
                classKey,
                subjectId,
                test: payload.test || { id: testId, title: 'Mock Test' },
                result: payload.result
            };
            renderMockTestResultView(container, mockResultViewState);
            return;
        }

        mockResultViewState = null;
        const serverOffsetMs = (payload.serverNow || Date.now()) - Date.now();
        activeMockSession = {
            classKey,
            subjectId,
            test: payload.test,
            attempt: payload.attempt,
            currentIndex: 0,
            serverOffsetMs,
            submitting: false
        };

        setActiveMockPointer({
            classKey,
            subjectId,
            testId: payload.test.id,
            attemptId: payload.attempt.id,
            finishAt: payload.attempt.finishAt
        });

        renderActiveMockTestRunner(container);
        startMockCountdownLoop();
    } catch (err) {
        showToast('Could not connect to start mock test.');
        loadAndRenderStudentMockTests(classKey);
    }
}

function startMockCountdownLoop() {
    stopMockCountdown();
    const tick = () => {
        if (!activeMockSession || activeMockSession.submitting) return;
        const nowServer = Date.now() + (activeMockSession.serverOffsetMs || 0);
        const remainingMs = Number(activeMockSession.attempt.finishAt || 0) - nowServer;

        const timerEl = document.getElementById('mockLiveTimerText');
        const pillEl = document.getElementById('mockLiveTimerPill');
        if (timerEl) timerEl.textContent = formatCountdownMs(remainingMs);
        if (pillEl) pillEl.classList.toggle('is-urgent', remainingMs <= 60000);

        if (remainingMs <= 0) {
            stopMockCountdown();
            submitActiveMockTest(true);
        }
    };
    tick();
    mockCountdownInterval = setInterval(tick, 500);
}

function renderActiveMockTestRunner(container) {
    if (!activeMockSession) return;
    const { test, attempt, currentIndex } = activeMockSession;
    const questions = Array.isArray(test.questions) ? test.questions : [];
    const total = questions.length;

    if (total === 0) {
        container.innerHTML = `<div class="mock-empty-card"><p>This mock test has no questions.</p></div>`;
        return;
    }

    const idx = Math.max(0, Math.min(total - 1, currentIndex));
    activeMockSession.currentIndex = idx;
    const q = questions[idx];
    const answers = attempt.answers || {};
    const selectedOpt = answers[q.id] || '';
    const answeredCount = Object.keys(answers).length;
    const remainingMs = Number(attempt.finishAt || 0) - (Date.now() + (activeMockSession.serverOffsetMs || 0));

    container.innerHTML = `
        <div class="mock-runner-shell">
            <div class="mock-runner-header">
                <div class="mock-runner-title-wrap">
                    <span class="mock-runner-kicker">Question ${idx + 1} of ${total} &middot; ${answeredCount} answered</span>
                    <h2 class="mock-runner-title">${escapeHtml(test.title || 'Mock Test')}</h2>
                </div>
                <div class="mock-runner-controls">
                    <div class="mock-timer-pill ${remainingMs <= 60000 ? 'is-urgent' : ''}" id="mockLiveTimerPill" aria-live="polite">
                        <i class="fa-regular fa-clock" aria-hidden="true"></i>
                        <span id="mockLiveTimerText">${formatCountdownMs(remainingMs)}</span>
                    </div>
                    <button type="button" class="btn btn-primary mock-submit-top-btn" onclick="confirmSubmitActiveMockTest()">
                        Submit Test
                    </button>
                </div>
            </div>

            <div class="mock-q-nav" aria-label="Question Navigation">
                ${questions.map((item, i) => {
                    const isCurrent = i === idx;
                    const isAnswered = Boolean(answers[item.id]);
                    return `
                        <button type="button" class="mock-q-dot ${isCurrent ? 'is-current' : ''} ${isAnswered ? 'is-answered' : ''}"
                                onclick="jumpToMockQuestion(${i})" aria-label="Question ${i + 1}">
                            ${i + 1}
                        </button>
                    `;
                }).join('')}
            </div>

            <div class="mock-question-card">
                <div class="mock-question-text">
                    <span class="mock-q-badge">Q${idx + 1}</span>
                    <p>${escapeHtml(q.text || '')}</p>
                </div>

                <div class="mock-options-list" role="radiogroup" aria-label="Answer options">
                    ${['A', 'B', 'C', 'D'].map(letter => {
                        const isPicked = selectedOpt === letter;
                        return `
                            <button type="button" class="mock-option-btn ${isPicked ? 'is-selected' : ''}"
                                    role="radio" aria-checked="${isPicked ? 'true' : 'false'}"
                                    onclick="selectMockAnswer('${escapeHtml(q.id)}', '${letter}')">
                                <span class="mock-opt-letter">${letter}</span>
                                <span class="mock-opt-text">${escapeHtml(q.options?.[letter] || '')}</span>
                            </button>
                        `;
                    }).join('')}
                </div>

                ${selectedOpt ? `
                    <div style="margin-top:12px;">
                        <button type="button" class="btn-link-action" onclick="selectMockAnswer('${escapeHtml(q.id)}', '')">Clear answer</button>
                    </div>
                ` : ''}
            </div>

            <div class="mock-runner-footer">
                <button type="button" class="btn btn-secondary" ${idx === 0 ? 'disabled' : ''} onclick="jumpToMockQuestion(${idx - 1})">
                    &larr; Previous
                </button>
                <div style="display:flex; gap:10px; align-items:center;">
                    ${idx < total - 1 ? `
                        <button type="button" class="btn btn-primary" onclick="jumpToMockQuestion(${idx + 1})">
                            Next &rarr;
                        </button>
                    ` : `
                        <button type="button" class="btn btn-primary" onclick="confirmSubmitActiveMockTest()">
                            Finish &amp; Submit
                        </button>
                    `}
                </div>
            </div>
        </div>
    `;
}

function jumpToMockQuestion(newIndex) {
    if (!activeMockSession) return;
    const total = (activeMockSession.test?.questions || []).length;
    if (newIndex < 0 || newIndex >= total) return;
    activeMockSession.currentIndex = newIndex;
    const container = document.getElementById(`mockTestsContainer-${activeMockSession.classKey}`);
    if (container) renderActiveMockTestRunner(container);
}

async function selectMockAnswer(questionId, optionLetter) {
    if (!activeMockSession || activeMockSession.submitting) return;
    const { classKey, subjectId, test, attempt } = activeMockSession;

    if (!attempt.answers) attempt.answers = {};
    if (optionLetter && ['A', 'B', 'C', 'D'].includes(optionLetter)) {
        attempt.answers[questionId] = optionLetter;
    } else {
        delete attempt.answers[questionId];
    }

    const container = document.getElementById(`mockTestsContainer-${classKey}`);
    if (container) renderActiveMockTestRunner(container);

    try {
        const res = await fetch('/api/mock-tests', {
            method: 'POST',
            headers: getMockAuthHeaders(),
            body: JSON.stringify({
                action: 'SAVE_ANSWER',
                testId: test.id,
                attemptId: attempt.id,
                questionId,
                selectedOption: optionLetter || null
            })
        });
        const payload = await res.json();
        if (payload.ok && payload.status === 'submitted' && payload.result) {
            stopMockCountdown();
            activeMockSession = null;
            setActiveMockPointer(null);
            mockResultViewState = { classKey, subjectId, test, result: payload.result };
            if (container) renderMockTestResultView(container, mockResultViewState);
        }
    } catch (e) {}
}

function confirmSubmitActiveMockTest() {
    if (!activeMockSession || activeMockSession.submitting) return;
    const total = (activeMockSession.test?.questions || []).length;
    const answered = Object.keys(activeMockSession.attempt?.answers || {}).length;
    const skipped = Math.max(0, total - answered);
    const msg = skipped > 0
        ? `You have ${skipped} unanswered ${skipped === 1 ? 'question' : 'questions'}. Submit your test now?`
        : 'Submit your mock test now? You will see your score and correct answers immediately.';
    if (!confirm(msg)) return;
    submitActiveMockTest(false);
}

async function submitActiveMockTest(autoSubmitted = false) {
    if (!activeMockSession || activeMockSession.submitting) return;
    activeMockSession.submitting = true;
    stopMockCountdown();

    const { classKey, subjectId, test, attempt } = activeMockSession;
    const container = document.getElementById(`mockTestsContainer-${classKey}`);

    try {
        const res = await fetch('/api/mock-tests', {
            method: 'POST',
            headers: getMockAuthHeaders(),
            body: JSON.stringify({
                action: 'SUBMIT_ATTEMPT',
                testId: test.id,
                attemptId: attempt.id,
                answers: attempt.answers || {},
                autoSubmitted: Boolean(autoSubmitted)
            })
        });
        const payload = await res.json();
        if (!res.ok || !payload.ok || !payload.result) {
            activeMockSession.submitting = false;
            showToast(payload.error || 'Could not submit mock test.');
            return;
        }

        activeMockSession = null;
        setActiveMockPointer(null);
        mockResultViewState = {
            classKey,
            subjectId,
            test: payload.test || test,
            result: payload.result
        };

        if (autoSubmitted) {
            showToast('Time is up! Your mock test was automatically submitted.');
        } else {
            showToast('Mock test submitted!');
        }

        if (container) renderMockTestResultView(container, mockResultViewState);
    } catch (err) {
        activeMockSession.submitting = false;
        showToast('Network error while submitting test. Please try again.');
    }
}

function renderMockTestResultView(container, state) {
    const { classKey, subjectId, test, result } = state;
    const review = Array.isArray(result.review) ? result.review : [];

    container.innerHTML = `
        <div class="mock-results-shell">
            <div class="mock-results-banner">
                <div>
                    ${result.autoSubmitted ? '<span class="mock-auto-tag">Time expired &middot; Auto-submitted</span>' : '<span class="mock-done-tag">Completed</span>'}
                    <h2>${escapeHtml(test.title || 'Mock Test')}</h2>
                </div>
                <div class="mock-score-circle">
                    <strong>${result.score} / ${result.total}</strong>
                    <span>${result.percentage}%</span>
                </div>
            </div>

            <div class="mock-stats-row">
                <div class="mock-stat-box stat-correct">
                    <strong>${result.correctCount}</strong>
                    <span>Correct</span>
                </div>
                <div class="mock-stat-box stat-wrong">
                    <strong>${result.wrongCount}</strong>
                    <span>Wrong</span>
                </div>
                <div class="mock-stat-box stat-skipped">
                    <strong>${result.skippedCount}</strong>
                    <span>Skipped</span>
                </div>
            </div>

            <div class="mock-results-actions">
                <button type="button" class="btn btn-secondary" onclick="exitMockTestResults('${escapeHtml(classKey)}')">
                    &larr; Back to Mock Tests
                </button>
                <button type="button" class="btn btn-primary" onclick="startOrResumeStudentMockTest('${escapeHtml(classKey)}', '${escapeHtml(subjectId)}', '${escapeHtml(test.id)}', true)">
                    <i class="fa-solid fa-rotate-right" aria-hidden="true"></i> Retake Test
                </button>
            </div>

            <div class="mock-review-list">
                <h3>Answer Review</h3>
                ${review.map((item, idx) => {
                    const statusLabel = item.status === 'correct' ? 'Correct' : (item.status === 'wrong' ? 'Wrong' : 'Skipped');
                    return `
                        <div class="mock-review-card status-${item.status}">
                            <div class="mock-review-head">
                                <span class="mock-q-badge">Q${idx + 1}</span>
                                <span class="mock-review-status ${item.status}">${statusLabel}</span>
                            </div>
                            <p class="mock-review-qtext">${escapeHtml(item.text || '')}</p>
                            <div class="mock-review-options">
                                ${['A', 'B', 'C', 'D'].map(letter => {
                                    const isCorrect = item.correctOption === letter;
                                    const isChosen = item.selectedOption === letter;
                                    let cls = '';
                                    if (isCorrect) cls = 'opt-correct';
                                    else if (isChosen && !isCorrect) cls = 'opt-wrong';
                                    return `
                                        <div class="mock-review-opt ${cls}">
                                            <span class="mock-opt-letter">${letter}</span>
                                            <span>${escapeHtml(item.options?.[letter] || '')}</span>
                                            ${isCorrect ? '<span class="mock-opt-tag correct-tag">Correct Answer</span>' : ''}
                                            ${isChosen && !isCorrect ? '<span class="mock-opt-tag wrong-tag">Your Answer</span>' : ''}
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
}

function exitMockTestResults(classKey) {
    mockResultViewState = null;
    loadAndRenderStudentMockTests(classKey);
}

async function checkAndResumeActiveMockTestOnBoot() {
    if (!isUserAuthenticated()) return false;
    const ptr = getActiveMockPointer();
    if (!ptr || !ptr.classKey || !ptr.testId) return false;
    const myPortalKey = typeof shortKeyToPortalKey === 'function'
        ? shortKeyToPortalKey(getStudentRegisteredClass())
        : 'class-12';
    if (ptr.classKey !== myPortalKey) {
        setActiveMockPointer(null);
        return false;
    }
    if (typeof selectSubjectForClass === 'function' && ptr.subjectId) {
        selectedSubjectByClass[ptr.classKey] = ptr.subjectId;
    }
    const shortKey = normalizeClassKey(ptr.classKey);
    switchPortal(`view-${shortKey}`);
    switchClassTab(shortKey, 'mocktests', document.getElementById(`tab-${shortKey}-mocktests`));
    return true;
}

window.loadAndRenderStudentMockTests = loadAndRenderStudentMockTests;
window.startOrResumeStudentMockTest = startOrResumeStudentMockTest;
window.jumpToMockQuestion = jumpToMockQuestion;
window.selectMockAnswer = selectMockAnswer;
window.confirmSubmitActiveMockTest = confirmSubmitActiveMockTest;
window.submitActiveMockTest = submitActiveMockTest;
window.exitMockTestResults = exitMockTestResults;
window.checkAndResumeActiveMockTestOnBoot = checkAndResumeActiveMockTestOnBoot;
