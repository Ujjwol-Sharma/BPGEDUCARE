/* ==========================================================================
   BPG EDUCARE — SIMPLIFIED SUBJECT & NOTES LESSON RENDERER (js/portal-renderer.js)
   - Simplified heading: Class + Subject name only
   - Tabs: Notes (all lessons in syllabus order with PDF first-page covers & video thumbnails),
     Syllabus Grid, Live Class Calendar
   - Zero AI notes/summaries on lesson pages
   ========================================================================== */

const CLASS_DISPLAY_PREFIX = {
    'class-10': 'Class 10',
    'class-11': 'Grade XI',
    'class-12': 'Grade XII',
    'after-12': 'Entrance Prep'
};

let selectedSubjectByClass = {};
let selectedLessonByClass = {};

function getPortalSubjects(classKey) {
    const portal = ACADEMY_STATE.portals?.[classKey];
    if (!portal) return [];
    if (Array.isArray(portal.subjects) && portal.subjects.length > 0) {
        return portal.subjects;
    }
    const rows = Array.isArray(portal.syllabusRows) ? portal.syllabusRows : [];
    return [
        {
            id: 'mathematics',
            name: 'Mathematics',
            lessons: rows.map((r, idx) => ({
                id: `${classKey}-math-l${idx + 1}`,
                code: r.code || `Unit 0${idx + 1}`,
                title: r.name || r.domain || `Lesson ${idx + 1}`,
                hours: r.hours || '',
                marks: r.marks || '',
                pdfs: [],
                videos: []
            }))
        }
    ];
}

function getActiveSubjectForClass(classKey) {
    const subjects = getPortalSubjects(classKey);
    const chosenId = selectedSubjectByClass[classKey];
    const match = subjects.find(s => s.id === chosenId) || subjects[0];
    if (match) selectedSubjectByClass[classKey] = match.id;
    return match || { id: 'mathematics', name: 'Mathematics', lessons: [] };
}

function selectSubjectForClass(classKey, subjectId) {
    selectedSubjectByClass[classKey] = subjectId;
    selectedLessonByClass[classKey] = '';
    renderEntireStudentPortal();
    if (typeof loadAndRenderStudentMockTests === 'function') {
        const shortKey = typeof normalizeClassKey === 'function' ? normalizeClassKey(classKey) : '';
        const mockPane = document.getElementById(`pane-${shortKey}-mocktests`);
        if (mockPane && mockPane.classList.contains('active')) {
            loadAndRenderStudentMockTests(classKey);
        }
    }
}

function renderEntireStudentPortal() {
    const heroImg = document.getElementById('heroPortraitImg');
    if (heroImg && ACADEMY_STATE.faculty?.portraitUrl) {
        heroImg.src = ACADEMY_STATE.faculty.portraitUrl;
    }

    document.querySelectorAll('[data-field]').forEach(el => {
        const path = el.getAttribute('data-field');
        const val = getByPath(ACADEMY_STATE, path);
        if (val !== undefined && val !== '') el.innerHTML = val;
    });

    renderMaintenanceNotice();
    renderHomepageContent();
    renderHomepageNotifications();
    renderAnnouncementsDrawer();
    renderHomepageTeamSection();
    renderClassSelectionView();

    ['class-10', 'class-11', 'class-12', 'after-12'].forEach(classKey => {
        const pData = ACADEMY_STATE.portals?.[classKey];
        if (!pData) return;

        const subjects = getPortalSubjects(classKey);
        const activeSubject = getActiveSubjectForClass(classKey);
        const classPrefix = CLASS_DISPLAY_PREFIX[classKey] || classKey;

        // Heading: ONLY class and subject name (e.g. "Grade XII Mathematics")
        const heroTitle = document.getElementById(`heroTitle-${classKey}`);
        if (heroTitle) {
            heroTitle.textContent = `${classPrefix} ${activeSubject.name}`;
        }

        // Subject switcher (shown if more than 1 subject exists for this class)
        const subjBar = document.getElementById(`subjectSelector-${classKey}`);
        if (subjBar) {
            if (subjects.length > 1) {
                subjBar.innerHTML = subjects.map(s => `
                    <button type="button" class="subject-pill-btn ${s.id === activeSubject.id ? 'active' : ''}" onclick="selectSubjectForClass('${classKey}', '${escapeHtml(s.id)}')">
                        ${escapeHtml(s.name)}
                    </button>
                `).join('');
            } else {
                subjBar.innerHTML = '';
            }
        }

        // Section Lock Check (applies to all plans including Diamond)
        const lockInfo = typeof getSectionLockInfo === 'function'
            ? getSectionLockInfo(classKey)
            : { locked: false, reason: '' };

        if (lockInfo.locked) {
            const lockedBannerHtml = `
                <div class="section-locked-inline-card">
                    <span class="section-status-badge locked">Locked</span>
                    <h3>${escapeHtml(classPrefix)} ${escapeHtml(activeSubject.name)}</h3>
                    <p>${escapeHtml(lockInfo.reason || 'Temporarily unavailable')}. This section is closed across all plans until reopened.</p>
                </div>
            `;
            const sylBoxL = document.getElementById(`syllabusContainer-${classKey}`);
            if (sylBoxL) sylBoxL.innerHTML = lockedBannerHtml;
            const calL = document.getElementById(`calendarContainer-${classKey}`);
            if (calL) calL.innerHTML = lockedBannerHtml;
            const notesL = document.getElementById(`notesContainer-${classKey}`);
            if (notesL) notesL.innerHTML = lockedBannerHtml;
            return;
        }

        // TAB 1: NOTES (All lessons in syllabus order -> click lesson -> PDF cover cards & video thumbnails)
        renderNotesLessonsView(classKey, activeSubject);

        // TAB 2: SYLLABUS GRID
        const totals = computeSyllabusTotals(pData.syllabusRows);
        const sylBox = document.getElementById(`syllabusContainer-${classKey}`);
        if (sylBox) {
            sylBox.innerHTML = `
                <div class="syllabus-card-wrap">
                    <div style="overflow-x:auto;">
                        <table class="syllabus-table">
                            <thead>
                                <tr>
                                    <th>Unit</th>
                                    <th>Lesson / Domain</th>
                                    <th>Hours</th>
                                    <th>Marks</th>
                                    <th>Weightage Pattern</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(pData.syllabusRows || []).map(r => `
                                    <tr>
                                        <td><strong>${escapeHtml(r.code || '')}</strong></td>
                                        <td><strong>${escapeHtml(r.name || r.domain || '')}</strong></td>
                                        <td><span>${escapeHtml(r.hours || '')}</span></td>
                                        <td><span class="calm-unit-pill">${escapeHtml(r.marks || '')}</span></td>
                                        <td><span>${escapeHtml(r.focus || r.weightage || '')}</span></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                            <tfoot>
                                <tr class="syllabus-tfoot-row">
                                    <td colspan="2">Total (${(pData.syllabusRows || []).length} Lessons)</td>
                                    <td>${totals.totalHours} hrs</td>
                                    <td><span class="calm-unit-pill">${totals.totalMarks} Marks</span></td>
                                    <td>${classKey === 'after-12' ? 'IOE Pulchowk CBT' : 'Official Syllabus Grid'}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            `;
        }

        // TAB 3: LIVE CLASS CALENDAR
        renderPortalCalendar(classKey);
    });
}

/* --------------------------------------------------------------------------
   NOTES SECTION: SYLLABUS-ORDERED LESSONS + PDF COVER & VIDEO THUMBNAIL CARDS
   -------------------------------------------------------------------------- */
function renderNotesLessonsView(classKey, subject) {
    const notesBox = document.getElementById(`notesContainer-${classKey}`);
    if (!notesBox) return;

    const lessons = Array.isArray(subject.lessons) ? subject.lessons : [];
    const activeLessonId = selectedLessonByClass[classKey] || '';

    if (activeLessonId) {
        const lesson = lessons.find(l => l.id === activeLessonId);
        if (lesson) {
            renderSelectedLessonContent(notesBox, classKey, subject, lesson);
            return;
        }
    }

    if (lessons.length === 0) {
        notesBox.innerHTML = `
            <div class="lesson-empty-pdfs">
                <p>No lessons added for this subject yet.</p>
            </div>
        `;
        return;
    }

    notesBox.innerHTML = `
        <div class="notes-lessons-list">
            ${lessons.map((lesson, idx) => {
                const pdfCount = (lesson.pdfs || []).length;
                const vidCount = (lesson.videos || []).length;
                const subTopics = Array.isArray(lesson.subTopics) ? lesson.subTopics : [];
                const counts = [];
                if (subTopics.length > 0) counts.push(`${subTopics.length} ${subTopics.length === 1 ? 'Sub-Topic' : 'Sub-Topics'}`);
                if (pdfCount > 0) counts.push(`${pdfCount} ${pdfCount === 1 ? 'PDF' : 'PDFs'}`);
                if (vidCount > 0) counts.push(`${vidCount} ${vidCount === 1 ? 'Video' : 'Videos'}`);
                const countLabel = counts.length ? counts.join(' · ') : 'No uploads yet';
                const subTopicsPreview = subTopics.length > 0
                    ? `<div style="display:flex; flex-wrap:wrap; gap:5px; margin-top:6px;">${subTopics.map(st => `<span style="font-size:0.73rem; padding:2px 8px; border-radius:999px; background:var(--bg-subtle, #f4f4f6); border:1px solid var(--border-subtle, #e4e4e7); color:var(--text-secondary);">${escapeHtml(st.title)}</span>`).join('')}</div>`
                    : '';

                return `
                    <button type="button" class="notes-lesson-row" onclick="openNotesLesson('${escapeHtml(classKey)}', '${escapeHtml(subject.id)}', '${escapeHtml(lesson.id)}')">
                        <div class="notes-lesson-left">
                            <span class="notes-lesson-num">${String(idx + 1).padStart(2, '0')}</span>
                            <div class="notes-lesson-text">
                                <span class="notes-lesson-code">${escapeHtml(lesson.code || `Lesson ${idx + 1}`)}</span>
                                <h3>${escapeHtml(lesson.title || `Lesson ${idx + 1}`)}</h3>
                                ${subTopicsPreview}
                            </div>
                        </div>
                        <div class="notes-lesson-right">
                            <span class="notes-lesson-count">${escapeHtml(countLabel)}</span>
                            <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
                        </div>
                    </button>
                `;
            }).join('')}
        </div>
    `;
}

async function openNotesLesson(classKey, subjectId, lessonId) {
    selectedSubjectByClass[classKey] = subjectId;
    selectedLessonByClass[classKey] = lessonId;

    const notesBox = document.getElementById(`notesContainer-${classKey}`);
    const subject = getActiveSubjectForClass(classKey);
    const localLesson = (subject.lessons || []).find(l => l.id === lessonId);
    if (!notesBox) return;

    let verifiedLesson = localLesson;
    try {
        const authHeaders = typeof getStudentAuthHeaders === 'function' ? getStudentAuthHeaders() : {};
        const url = `/api/content-access?classKey=${encodeURIComponent(classKey)}&itemType=lesson&subjectId=${encodeURIComponent(subjectId)}&lessonId=${encodeURIComponent(lessonId)}&_t=${Date.now()}`;
        const res = await fetch(url, { cache: 'no-store', headers: authHeaders });
        const payload = await res.json();

        if (res.status === 403 && payload.code === 'SECTION_LOCKED') {
            if (typeof showSectionLockedModal === 'function') showSectionLockedModal(classKey);
            return;
        }
        if (res.ok && payload.ok && payload.lesson) {
            const remotePdfs = Array.isArray(payload.lesson.pdfs) ? payload.lesson.pdfs : [];
            const localPdfs = Array.isArray(localLesson?.pdfs) ? localLesson.pdfs : [];
            const remoteVids = Array.isArray(payload.lesson.videos) ? payload.lesson.videos : [];
            const localVids = Array.isArray(localLesson?.videos) ? localLesson.videos : [];
            const remoteSubTopics = Array.isArray(payload.lesson.subTopics) ? payload.lesson.subTopics : [];
            const localSubTopics = Array.isArray(localLesson?.subTopics) ? localLesson.subTopics : [];
            verifiedLesson = {
                ...localLesson,
                ...payload.lesson,
                subTopics: remoteSubTopics.length >= localSubTopics.length ? remoteSubTopics : localSubTopics,
                pdfs: remotePdfs.length >= localPdfs.length ? remotePdfs : localPdfs,
                videos: remoteVids.length >= localVids.length ? remoteVids : localVids
            };
        }
    } catch (e) {}

    if (verifiedLesson) {
        renderSelectedLessonContent(notesBox, classKey, subject, verifiedLesson);
    }
}

function backToNotesLessonList(classKey) {
    selectedLessonByClass[classKey] = '';
    const subject = getActiveSubjectForClass(classKey);
    renderNotesLessonsView(classKey, subject);
}

let selectedSubTopicByLesson = {};

function selectLessonSubTopicFilter(classKey, lessonId, subTopicId) {
    selectedSubTopicByLesson[`${classKey}|${lessonId}`] = subTopicId || 'all';
    const notesBox = document.getElementById(`notesContainer-${classKey}`);
    const subject = getActiveSubjectForClass(classKey);
    const lesson = (subject.lessons || []).find(l => l.id === lessonId);
    if (notesBox && lesson) {
        renderSelectedLessonContent(notesBox, classKey, subject, lesson);
    }
}

function renderSelectedLessonContent(notesBox, classKey, subject, lesson) {
    const allPdfs = Array.isArray(lesson.pdfs) ? lesson.pdfs : [];
    const allVideos = Array.isArray(lesson.videos) ? lesson.videos : [];
    const subTopics = Array.isArray(lesson.subTopics) ? lesson.subTopics : [];
    const filterKey = `${classKey}|${lesson.id}`;
    const activeStFilter = selectedSubTopicByLesson[filterKey] || 'all';

    const pdfs = activeStFilter === 'all'
        ? allPdfs
        : allPdfs.filter(p => (p.subTopicId || '') === activeStFilter);
    const videos = activeStFilter === 'all'
        ? allVideos
        : allVideos.filter(v => (v.subTopicId || '') === activeStFilter);
    const hasContent = pdfs.length > 0 || videos.length > 0;

    const subTopicFilterBarHtml = subTopics.length > 0 ? `
        <div style="margin-bottom:20px; padding:12px 14px; border-radius:12px; background:var(--bg-subtle, #f4f4f6); border:1px solid var(--border-subtle, #e4e4e7);">
            <div style="font-size:0.74rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:var(--text-secondary); margin-bottom:8px;">
                Sub-Topics in ${escapeHtml(lesson.title || 'Unit')}
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:8px;">
                <button type="button" class="subject-pill-btn ${activeStFilter === 'all' ? 'active' : ''}" style="padding:6px 12px; font-size:0.82rem;" onclick="selectLessonSubTopicFilter('${escapeHtml(classKey)}', '${escapeHtml(lesson.id)}', 'all')">
                    All (${allPdfs.length + allVideos.length})
                </button>
                ${subTopics.map(st => {
                    const count = allPdfs.filter(p => p.subTopicId === st.id).length + allVideos.filter(v => v.subTopicId === st.id).length;
                    return `
                        <button type="button" class="subject-pill-btn ${activeStFilter === st.id ? 'active' : ''}" style="padding:6px 12px; font-size:0.82rem;" onclick="selectLessonSubTopicFilter('${escapeHtml(classKey)}', '${escapeHtml(lesson.id)}', '${escapeHtml(st.id)}')">
                            ${escapeHtml(st.title)} (${count})
                        </button>
                    `;
                }).join('')}
            </div>
        </div>
    ` : '';

    let bodyHtml = '';
    if (!hasContent) {
        bodyHtml = `
            <div class="lesson-empty-pdfs">
                <p>No PDFs or videos have been added yet.</p>
            </div>
        `;
    } else {
        const pdfSection = pdfs.length > 0 ? `
            <div class="lesson-media-group">
                <h4 class="lesson-media-heading">PDFs</h4>
                <div class="media-preview-grid pdf-grid">
                    ${pdfs.map(pdf => {
                        const safeTitle = escapeHtml(pdf.title || pdf.fileName || 'PDF');
                        const safeId = escapeHtml(pdf.id);
                        const jsTitle = safeTitle.replace(/'/g, "\\'");
                        const isRestricted = Boolean(pdf.restricted);
                        const mp = (pdf.minPlan || 'free').toLowerCase();
                        const mpLabel = typeof formatPlanLabel === 'function' ? formatPlanLabel(mp) : mp;
                        const canvasId = `pdfCoverCanvas_${safeId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

                        const coverHtml = pdf.coverImage
                            ? `<img src="${pdf.coverImage}" alt="${safeTitle} cover" class="pdf-cover-img">`
                            : `<canvas id="${canvasId}" class="pdf-cover-canvas" data-class-key="${escapeHtml(classKey)}" data-subject-id="${escapeHtml(subject.id)}" data-lesson-id="${escapeHtml(lesson.id)}" data-pdf-id="${safeId}" data-restricted="${isRestricted ? '1' : '0'}"></canvas>`;

                        return `
                            <div class="pdf-cover-card ${isRestricted ? 'is-restricted-item' : ''}" role="button" tabindex="0"
                                 onclick="openLessonPdf('${escapeHtml(classKey)}', '${escapeHtml(lesson.id)}', '${safeId}', '${jsTitle}', '${escapeHtml(subject.id)}')"
                                 onkeydown="if(event.key==='Enter') openLessonPdf('${escapeHtml(classKey)}', '${escapeHtml(lesson.id)}', '${safeId}', '${jsTitle}', '${escapeHtml(subject.id)}')">
                                <div class="pdf-cover-thumb">
                                    ${coverHtml}
                                    ${isRestricted ? `<span class="media-lock-overlay"><i class="fa-solid fa-lock"></i> ${escapeHtml(mpLabel)}</span>` : ''}
                                </div>
                                <div class="media-card-caption">
                                    <span class="media-card-title">${safeTitle}</span>
                                    ${pdf.subTopicTitle ? `<span style="display:block; font-size:0.74rem; color:var(--text-secondary); margin-top:2px;">${escapeHtml(pdf.subTopicTitle)}</span>` : ''}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        ` : '';

        const videoSection = videos.length > 0 ? `
            <div class="lesson-media-group">
                <h4 class="lesson-media-heading">Videos</h4>
                <div class="media-preview-grid video-grid">
                    ${videos.map(vid => {
                        const safeTitle = escapeHtml(vid.title || 'Video');
                        const safeId = escapeHtml(vid.id);
                        const jsTitle = safeTitle.replace(/'/g, "\\'");
                        const isRestricted = Boolean(vid.restricted);
                        const mp = (vid.minPlan || 'free').toLowerCase();
                        const mpLabel = typeof formatPlanLabel === 'function' ? formatPlanLabel(mp) : mp;

                        return `
                            <div class="video-thumb-card ${isRestricted ? 'is-restricted-item' : ''}" role="button" tabindex="0"
                                 onclick="openLessonVideo('${escapeHtml(classKey)}', '${escapeHtml(lesson.id)}', '${safeId}', '${jsTitle}', '${escapeHtml(subject.id)}')"
                                 onkeydown="if(event.key==='Enter') openLessonVideo('${escapeHtml(classKey)}', '${escapeHtml(lesson.id)}', '${safeId}', '${jsTitle}', '${escapeHtml(subject.id)}')">
                                <div class="video-thumb-box">
                                    ${vid.thumbnailUrl
                                        ? `<img src="${vid.thumbnailUrl}" alt="${safeTitle} thumbnail" class="video-thumb-img">`
                                        : `<div class="video-thumb-fallback"><span>${safeTitle}</span></div>`}
                                    <span class="video-play-badge" aria-hidden="true">
                                        <i class="fa-solid ${isRestricted ? 'fa-lock' : 'fa-play'}"></i>
                                    </span>
                                    ${isRestricted ? `<span class="media-lock-overlay"><i class="fa-solid fa-lock"></i> ${escapeHtml(mpLabel)}</span>` : ''}
                                </div>
                                <div class="media-card-caption">
                                    <span class="media-card-title">${safeTitle}</span>
                                    ${pdf.subTopicTitle ? `<span style="display:block; font-size:0.74rem; color:var(--text-secondary); margin-top:2px;">${escapeHtml(pdf.subTopicTitle)}</span>` : ''}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        ` : '';

        bodyHtml = `${pdfSection}${videoSection}`;
    }

    notesBox.innerHTML = `
        <div class="notes-lesson-detail">
            <div class="notes-lesson-detail-head">
                <button type="button" class="btn-back" onclick="backToNotesLessonList('${escapeHtml(classKey)}')">
                    &larr; All Lessons
                </button>
                <div>
                    <span class="notes-lesson-code">${escapeHtml(lesson.code || '')}</span>
                    <h2>${escapeHtml(lesson.title || '')}</h2>
                </div>
            </div>
            ${subTopicFilterBarHtml}
            ${bodyHtml}
        </div>
    `;

    hydrateFallbackPdfCovers(notesBox);
}

async function hydrateFallbackPdfCovers(container) {
    if (!window.pdfjsLib) return;
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const canvases = container.querySelectorAll('canvas.pdf-cover-canvas');
    for (const canvas of canvases) {
        if (canvas.dataset.restricted === '1') {
            drawMinimalCoverPlaceholder(canvas, 'Locked PDF');
            continue;
        }
        try {
            const authHeaders = typeof getStudentAuthHeaders === 'function' ? getStudentAuthHeaders() : {};
            const url = `/api/content-access?classKey=${encodeURIComponent(canvas.dataset.classKey)}&itemType=lesson-pdf&subjectId=${encodeURIComponent(canvas.dataset.subjectId)}&lessonId=${encodeURIComponent(canvas.dataset.lessonId)}&pdfId=${encodeURIComponent(canvas.dataset.pdfId)}`;
            const res = await fetch(url, { cache: 'no-store', headers: authHeaders });
            const payload = await res.json();
            const fileUrl = payload?.item?.fileUrl || '';
            if (!fileUrl) {
                drawMinimalCoverPlaceholder(canvas, 'PDF');
                continue;
            }
            let src = fileUrl;
            if (fileUrl.startsWith('data:application/pdf;base64,')) {
                const bin = atob(fileUrl.slice('data:application/pdf;base64,'.length));
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                src = { data: bytes };
            }
            const doc = await window.pdfjsLib.getDocument(src).promise;
            const page = await doc.getPage(1);
            const viewport = page.getViewport({ scale: 0.75 });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        } catch (e) {
            drawMinimalCoverPlaceholder(canvas, 'Page 1');
        }
    }
}

function drawMinimalCoverPlaceholder(canvas, label) {
    canvas.width = 300;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f4f4f6';
    ctx.fillRect(0, 0, 300, 400);
    ctx.fillStyle = '#71717a';
    ctx.font = '600 15px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, 150, 200);
}

/* --------------------------------------------------------------------------
   SERVER-VERIFIED OPEN PDF & OPEN VIDEO HANDLERS
   -------------------------------------------------------------------------- */
function renderLevelUpCard(containerEl, requiredPlan, itemTitle) {
    const safeTitle = escapeHtml(itemTitle || 'this content');
    const planLabel = typeof formatPlanLabel === 'function' ? formatPlanLabel(requiredPlan) : requiredPlan;
    containerEl.innerHTML = `
        <div class="level-up-gate-card">
            <div class="level-up-icon"><i class="fa-solid fa-lock"></i></div>
            <h3>Level up to unlock this content</h3>
            <p><strong>${safeTitle}</strong> requires the <strong>${escapeHtml(planLabel)}</strong> plan or higher.</p>
            <button type="button" class="btn btn-primary" onclick="closePdfViewerModal(); closeVideoPlayerModal(); openPlanComparisonModal('${escapeHtml(requiredPlan)}', '${safeTitle.replace(/'/g, "\\'")}')">
                View plans
            </button>
        </div>
    `;
}

function findLocalLessonPdf(classKey, subjectId, lessonId, pdfId) {
    try {
        const portal = ACADEMY_STATE?.portals?.[classKey];
        if (!portal) return null;
        const subjects = Array.isArray(portal.subjects) ? portal.subjects : [];
        for (const s of subjects) {
            if (subjectId && s.id !== subjectId) continue;
            const lesson = (s.lessons || []).find(l => String(l.id) === String(lessonId));
            if (lesson) {
                const pdf = (lesson.pdfs || []).find(p => String(p.id) === String(pdfId));
                if (pdf) return pdf;
            }
        }
        for (const s of subjects) {
            const lesson = (s.lessons || []).find(l => String(l.id) === String(lessonId));
            if (lesson) {
                const pdf = (lesson.pdfs || []).find(p => String(p.id) === String(pdfId));
                if (pdf) return pdf;
            }
        }
    } catch (e) {}
    return null;
}

async function renderPdfPagesIntoContainer(pdfBytesOrUrl, containerEl) {
    if (!window.pdfjsLib || !containerEl) return false;
    try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        const src = pdfBytesOrUrl instanceof Uint8Array ? { data: pdfBytesOrUrl } : pdfBytesOrUrl;
        const doc = await window.pdfjsLib.getDocument(src).promise;
        containerEl.innerHTML = '';
        for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
            const page = await doc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 1.4 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.style.width = '100%';
            canvas.style.height = 'auto';
            canvas.style.display = 'block';
            canvas.style.marginBottom = '12px';
            canvas.style.borderRadius = '6px';
            canvas.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
            containerEl.appendChild(canvas);
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        }
        return true;
    } catch (e) {
        return false;
    }
}

function displayPdfInViewerModal(pdf, fileUrl) {
    let openUrl = fileUrl;
    let pdfBytes = null;
    if (fileUrl.startsWith('data:application/pdf;base64,')) {
        const b64 = fileUrl.slice('data:application/pdf;base64,'.length);
        const binary = atob(b64);
        pdfBytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) pdfBytes[i] = binary.charCodeAt(i);
        openUrl = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));
    }

    const badgeEl = document.getElementById('pdfModalBadge');
    const titleEl = document.getElementById('pdfModalTitle');
    const bodyEl = document.getElementById('pdfModalBody');
    const dlBtn = document.getElementById('pdfModalDownloadBtn');
    const newTabBtn = document.getElementById('pdfModalNewTabBtn');

    if (badgeEl) badgeEl.textContent = 'PDF';
    if (titleEl) titleEl.textContent = pdf.title || pdf.fileName || 'Lesson PDF';
    if (dlBtn) {
        dlBtn.style.display = 'inline-flex';
        dlBtn.href = openUrl;
        dlBtn.setAttribute('download', pdf.fileName || ((pdf.title || 'lesson') + '.pdf'));
    }
    if (newTabBtn) {
        newTabBtn.style.display = 'inline-flex';
        newTabBtn.href = openUrl;
    }

    const isMobileViewport = window.innerWidth <= 820 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    if (bodyEl) {
        if (isMobileViewport && window.pdfjsLib && (pdfBytes || openUrl)) {
            bodyEl.innerHTML = `<div id="pdfJsPagesMount" style="padding:4px; text-align:center; color:var(--text-secondary);">Loading PDF pages...</div>`;
            const mount = document.getElementById('pdfJsPagesMount');
            renderPdfPagesIntoContainer(pdfBytes || openUrl, mount).then(ok => {
                if (!ok && mount) {
                    mount.innerHTML = `<iframe src="${openUrl}" style="width:100%; height:64vh; border:none; border-radius:8px;"></iframe>`;
                }
            });
        } else {
            bodyEl.innerHTML = `<iframe src="${openUrl}" style="width:100%; height:68vh; min-height:480px; border:none; border-radius:8px; background:#f4f4f6;"></iframe>`;
        }
    }

    document.getElementById('pdfViewerModal')?.classList.add('open');
}

async function openLessonPdf(classKey, lessonId, pdfId, pdfTitle, subjectId = 'mathematics') {
    // 1. Check if authorized PDF fileUrl is already available in local state
    const localPdf = findLocalLessonPdf(classKey, subjectId, lessonId, pdfId);
    if (localPdf && !localPdf.restricted && localPdf.fileUrl) {
        displayPdfInViewerModal(localPdf, String(localPdf.fileUrl));
        return;
    }

    const authHeaders = typeof getStudentAuthHeaders === 'function' ? getStudentAuthHeaders() : {};
    const url = `/api/content-access?classKey=${encodeURIComponent(classKey)}&itemType=lesson-pdf&subjectId=${encodeURIComponent(subjectId)}&lessonId=${encodeURIComponent(lessonId)}&pdfId=${encodeURIComponent(pdfId)}&_t=${Date.now()}`;

    try {
        const res = await fetch(url, { cache: 'no-store', headers: authHeaders });
        const payload = await res.json();

        if (res.status === 401) {
            showToast(payload.error || 'Please sign in to access this PDF.');
            if (typeof openAuthModal === 'function') openAuthModal('signin', classKey);
            return;
        }

        if (res.status === 403 && payload.code === 'SECTION_LOCKED') {
            if (typeof showSectionLockedModal === 'function') showSectionLockedModal(classKey);
            return;
        }

        if (res.status === 403 && payload.code === 'PLAN_REQUIRED') {
            const reqPlan = payload.requiredPlan || 'gold';
            const title = payload.itemTitle || pdfTitle || 'Lesson PDF';
            document.getElementById('pdfModalBadge').textContent = `${typeof formatPlanLabel === 'function' ? formatPlanLabel(reqPlan) : reqPlan} Plan Required`;
            document.getElementById('pdfModalTitle').textContent = title;
            renderLevelUpCard(document.getElementById('pdfModalBody'), reqPlan, title);
            const dlBtn = document.getElementById('pdfModalDownloadBtn');
            if (dlBtn) dlBtn.style.display = 'none';
            const newTabBtn = document.getElementById('pdfModalNewTabBtn');
            if (newTabBtn) newTabBtn.style.display = 'none';
            document.getElementById('pdfViewerModal')?.classList.add('open');
            return;
        }

        if (!res.ok || !payload.ok || !payload.item) {
            showToast(payload.error || 'Could not open PDF.');
            return;
        }

        const pdf = payload.item;
        const fileUrl = String(pdf.fileUrl || '');
        if (!fileUrl) {
            showToast('Original PDF file is missing.');
            return;
        }

        displayPdfInViewerModal(pdf, fileUrl);
    } catch (err) {
        showToast('Unable to open PDF right now.');
    }
}

function toEmbedVideoHtml(rawUrl, title) {
    const url = String(rawUrl || '').trim();
    const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (ytMatch) {
        return `<iframe src="https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1" title="${escapeHtml(title)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="width:100%; aspect-ratio:16/9; border-radius:10px;"></iframe>`;
    }
    const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
    if (vimeoMatch) {
        return `<iframe src="https://player.vimeo.com/video/${vimeoMatch[1]}?autoplay=1" title="${escapeHtml(title)}" frameborder="0" allow="autoplay; fullscreen" allowfullscreen style="width:100%; aspect-ratio:16/9; border-radius:10px;"></iframe>`;
    }
    if (url.startsWith('data:video/') || /\.(mp4|webm|ogg)(\?.*)?$/i.test(url)) {
        return `<video src="${url}" controls autoplay style="width:100%; max-height:70vh; border-radius:10px; background:#000;"></video>`;
    }
    return `
        <div style="text-align:center; padding:28px;">
            <p style="margin-bottom:16px; color:var(--text-secondary);">Open this lesson video in a new tab:</p>
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="btn btn-primary">Open Video &rarr;</a>
        </div>
    `;
}

async function openLessonVideo(classKey, lessonId, videoId, videoTitle, subjectId = 'mathematics') {
    const authHeaders = typeof getStudentAuthHeaders === 'function' ? getStudentAuthHeaders() : {};
    const url = `/api/content-access?classKey=${encodeURIComponent(classKey)}&itemType=lesson-video&subjectId=${encodeURIComponent(subjectId)}&lessonId=${encodeURIComponent(lessonId)}&videoId=${encodeURIComponent(videoId)}&_t=${Date.now()}`;

    try {
        const res = await fetch(url, { cache: 'no-store', headers: authHeaders });
        const payload = await res.json();

        if (res.status === 403 && payload.code === 'SECTION_LOCKED') {
            if (typeof showSectionLockedModal === 'function') showSectionLockedModal(classKey);
            return;
        }

        const modal = document.getElementById('videoPlayerModal');
        const titleEl = document.getElementById('videoModalTitle');
        const bodyEl = document.getElementById('videoModalBody');
        if (!modal || !bodyEl) return;

        if (res.status === 403 && payload.code === 'PLAN_REQUIRED') {
            const reqPlan = payload.requiredPlan || 'gold';
            const title = payload.itemTitle || videoTitle || 'Lesson Video';
            if (titleEl) titleEl.textContent = title;
            renderLevelUpCard(bodyEl, reqPlan, title);
            modal.classList.add('open');
            return;
        }

        if (!res.ok || !payload.ok || !payload.item) {
            showToast(payload.error || 'Could not open video.');
            return;
        }

        const vid = payload.item;
        if (titleEl) titleEl.textContent = vid.title || videoTitle || 'Lesson Video';
        bodyEl.innerHTML = toEmbedVideoHtml(vid.videoUrl, vid.title || videoTitle || 'Lesson Video');
        modal.classList.add('open');
    } catch (err) {
        showToast('Unable to open video right now.');
    }
}

function closeVideoPlayerModal() {
    const modal = document.getElementById('videoPlayerModal');
    const bodyEl = document.getElementById('videoModalBody');
    if (bodyEl) bodyEl.innerHTML = '';
    modal?.classList.remove('open');
}

function closePdfViewerModal() {
    document.getElementById('pdfViewerModal')?.classList.remove('open');
}

/* --------------------------------------------------------------------------
   HOMEPAGE OUR TEAM SECTION & CLASS SELECTION VIEW
   -------------------------------------------------------------------------- */
function renderMaintenanceNotice() {
    const banner = document.getElementById('maintenanceNoticeBanner');
    const titleEl = document.getElementById('maintenanceNoticeTitle');
    const msgEl = document.getElementById('maintenanceNoticeMessage');
    const m = ACADEMY_STATE.maintenanceMode || {};
    const enabled = Boolean(m.enabled);
    document.body.classList.toggle('maintenance-mode-active', enabled);
    if (!banner) return;
    banner.style.display = enabled ? 'block' : 'none';
    if (titleEl) titleEl.textContent = m.title || 'Scheduled Maintenance';
    if (msgEl) msgEl.textContent = m.message || 'Student dashboards, lessons, mock tests, the calculator, and checkout are temporarily locked.';
}

function renderHomepageContent() {
    const hc = ACADEMY_STATE.homepageContent || {};
    const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el && val !== undefined && val !== '') el.textContent = val;
    };

    setText('heroPillText', hc.heroPillText);
    setText('heroTitleMain', hc.heroTitleMain);
    setText('heroTitleMuted', hc.heroTitleMuted);
    if (hc.heroDescription) {
        const leadEl = document.getElementById('heroLeadText');
        if (leadEl) leadEl.innerHTML = escapeHtml(hc.heroDescription).replace(/Bishnu Prasad Gautam \(BPG Sir\)/g, '<strong>Bishnu Prasad Gautam (BPG Sir)</strong>');
    }
    if (typeof isUserAuthenticated === 'function' && !isUserAuthenticated() && hc.heroPrimaryBtnLabel) {
        setText('heroPrimaryCtaLabel', hc.heroPrimaryBtnLabel);
    }
    setText('heroSecondaryCtaLabel', hc.heroSecondaryBtnLabel);
    setText('heroFacultyName', hc.heroFacultyName);
    setText('heroFacultyRole', hc.heroFacultyRole);
    setText('heroFacultyTag', hc.heroFacultyTag);
    const portrait = document.getElementById('heroPortraitImg');
    if (portrait && hc.heroPortraitUrl) portrait.src = hc.heroPortraitUrl;

    const topBanner = document.getElementById('homeEditableBanner');
    const topText = document.getElementById('homeBannerText');
    const topLink = document.getElementById('homeBannerLink');
    if (topBanner) {
        if (hc.bannerEnabled && hc.bannerText) {
            topBanner.style.display = 'block';
            if (topText) topText.textContent = hc.bannerText;
            if (topLink) {
                if (hc.bannerLinkLabel && hc.bannerLinkUrl) {
                    topLink.style.display = 'inline-block';
                    topLink.textContent = hc.bannerLinkLabel;
                    topLink.href = hc.bannerLinkUrl;
                } else {
                    topLink.style.display = 'none';
                }
            }
        } else {
            topBanner.style.display = 'none';
        }
    }

    setText('homeFeaturesEyebrow', hc.featuresEyebrow);
    setText('homeFeaturesHeading', hc.featuresHeading);
    setText('homeNotificationsEyebrow', hc.notificationsEyebrow);
    setText('homeNotificationsHeading', hc.notificationsHeading);
    setText('homeTeamEyebrow', hc.teamEyebrow);
    setText('homeTeamHeading', hc.teamHeading);
    setText('footerCopyrightText', hc.footerText);

    // Update Feature Cards labels/subs if customized
    if (Array.isArray(hc.featureCards)) {
        const cardBtnIds = {
            lessons: 'btnHomeLessons',
            mocktests: 'btnHomeMockTests',
            syllabus: 'btnHomeSyllabusGrid',
            calendar: 'btnHomeLiveCalendar',
            plans: 'btnHomePlans'
        };
        hc.featureCards.forEach(fc => {
            const btn = document.getElementById(cardBtnIds[fc.id]);
            if (!btn) return;
            const lbl = btn.querySelector('.lessons-card-label');
            const sub = btn.querySelector('.lessons-card-sub');
            if (lbl && fc.label) lbl.textContent = fc.label;
            if (sub && fc.sub) sub.textContent = fc.sub;
        });
    }

    // Update WhatsApp links from siteSettings
    const waNum = typeof getConfiguredWhatsappNumber === 'function' ? getConfiguredWhatsappNumber() : '9779866064252';
    const localDisplay = waNum.startsWith('977') ? waNum.slice(3) : waNum;
    const footerWa = document.getElementById('footerWhatsappLink');
    if (footerWa) {
        footerWa.href = `https://wa.me/${waNum}?text=${encodeURIComponent('Namaste BPG Sir, I have an academic inquiry regarding BPG EDUCARE')}`;
        footerWa.innerHTML = `<i class="fa-brands fa-whatsapp" aria-hidden="true"></i> WhatsApp: ${escapeHtml(localDisplay)}`;
    }
    const floatWa = document.getElementById('floatingWhatsappBtn');
    if (floatWa) {
        floatWa.href = `https://wa.me/${waNum}?text=${encodeURIComponent('Namaste BPG Sir, I have an academic inquiry regarding BPG EDUCARE')}`;
        floatWa.setAttribute('title', `Contact on WhatsApp (+${waNum})`);
    }
}

function renderHomepageNotifications() {
    const section = document.getElementById('homeNotificationsSection');
    const mount = document.getElementById('homeNotificationsMount');
    if (!mount) return;

    const list = Array.isArray(ACADEMY_STATE.notifications) ? ACADEMY_STATE.notifications : [];
    const sorted = [...list]
        .filter(n => n.published !== false)
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

    if (sorted.length === 0) {
        if (section) section.style.display = 'none';
        mount.innerHTML = '';
        return;
    }
    if (section) section.style.display = 'block';

    const scopeLabels = {
        sitewide: 'Sitewide',
        'class-12': 'Class 12',
        'class-11': 'Class 11',
        'class-10': 'Class 10',
        'after-12': 'Entrance Prep'
    };

    mount.innerHTML = sorted.slice(0, 6).map(n => {
        const dateLabel = n.createdAt ? new Date(n.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        const scopeLabel = scopeLabels[n.scope] || 'Sitewide';
        const isClassSpecific = n.scope && n.scope !== 'sitewide';
        return `
            <article class="home-notif-card ${isClassSpecific ? 'is-class-notif' : ''}">
                <div class="home-notif-meta">
                    <span class="home-notif-cat">${escapeHtml(n.category || 'Announcement')}</span>
                    <span class="home-notif-scope ${isClassSpecific ? 'class-only' : ''}">${escapeHtml(scopeLabel)}</span>
                    ${dateLabel ? `<span class="home-notif-date">${escapeHtml(dateLabel)}</span>` : ''}
                </div>
                <h3 class="home-notif-title">${escapeHtml(n.title)}</h3>
                <p class="home-notif-body">${escapeHtml(n.body)}</p>
            </article>
        `;
    }).join('');
}

function formatTeamBioHtml(rawBio) {
    const safe = escapeHtml(rawBio || '');
    return safe
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
}

function renderTeamCardHtml(member) {
    const safeName = escapeHtml(member.name || 'Team Member');
    const isFounder = String(member.slot || '').toLowerCase() === 'founder' || String(member.role || '').toLowerCase().includes('founder');
    const safeRole = escapeHtml(member.role || 'Founder');
    const initial = escapeHtml((member.initial || (member.name || 'B').trim().charAt(0) || 'T').toUpperCase());
    const photoHtml = member.photoUrl
        ? `<img src="${escapeHtml(member.photoUrl)}" alt="${safeName}" class="team-avatar-img" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><span class="team-avatar-fallback" style="display:none;">${initial}</span>`
        : `<span class="team-avatar-fallback">${initial}</span>`;

    return `
        <article class="team-profile-card ${isFounder ? 'is-founder-card' : ''}">
            <div class="team-avatar-wrap">${photoHtml}</div>
            ${isFounder ? `<span class="team-role-badge">${safeRole}</span>` : ''}
            <h3 class="team-member-name">${safeName}</h3>
        </article>
    `;
}

function renderHomepageTeamSection() {
    const mount = document.getElementById('homeTeamMount');
    if (!mount) return;

    const members = Array.isArray(ACADEMY_STATE.teamMembers) && ACADEMY_STATE.teamMembers.length > 0
        ? ACADEMY_STATE.teamMembers
        : [
            { id: 'team-founder', slot: 'founder', initial: 'B', name: 'Bishnu Prasad Gautam', role: 'Founder', photoUrl: './images/bpg_sir.jpg', bio: 'M.Sc. Mathematics (TU, CGPA 3.9/4.0) with 12+ years mentoring NEB and IOE / CEE mathematics students in Pokhara, Nepal.' },
            { id: 'team-ceo', slot: 'ceo', initial: 'P', name: 'Paribesh Thapa', role: 'CEO', photoUrl: '', bio: '**Education | Youth | Social Impact**\nBridging education and grassroots social work to turn youth potential into lasting community impact.' },
            { id: 'team-cco', slot: 'cco', initial: 'U', name: 'Ujjwol Sharma', role: 'CCO', photoUrl: '', bio: 'Merges creative content and smart EdTech to deliver accessible, high-impact NEB & entrance-aligned curricula.' },
            { id: 'team-cto', slot: 'cto', initial: 'U', name: 'Utsav Sharma', role: 'CTO', photoUrl: '', bio: 'Architects fast, scalable learning platforms that make digital education seamless, accessible, and built for the future.' }
        ];

    const classifySlot = (m) => {
        const s = String(m.slot || '').toLowerCase();
        const r = String(m.role || '').toLowerCase();
        if (s === 'founder' || r.includes('founder')) return 'founder';
        if (s === 'ceo' || r === 'ceo' || r.includes('chief executive')) return 'ceo';
        if (s === 'cco' || r === 'cco' || r.includes('chief content') || r.includes('chief curriculum')) return 'cco';
        if (s === 'cto' || r === 'cto' || r.includes('chief technology')) return 'cto';
        return 'member';
    };

    const founders = members.filter(m => classifySlot(m) === 'founder');
    const ceoList = members.filter(m => classifySlot(m) === 'ceo');
    const ccoList = members.filter(m => classifySlot(m) === 'cco');
    const ctoList = members.filter(m => classifySlot(m) === 'cto');
    const secondRow = [...ceoList, ...ccoList, ...ctoList];
    const extras = members.filter(m => classifySlot(m) === 'member');

    mount.innerHTML = `
        ${founders.length ? `<div class="team-row-founder">${founders.map(renderTeamCardHtml).join('')}</div>` : ''}
        ${secondRow.length ? `<div class="team-row-execs">${secondRow.map(renderTeamCardHtml).join('')}</div>` : ''}
        ${extras.length ? `<div class="team-row-execs team-row-extra">${extras.map(renderTeamCardHtml).join('')}</div>` : ''}
    `;
}

function renderClassSelectionView() {
    const grid = document.getElementById('classSelectionGrid');
    if (!grid) return;

    const myClass = typeof getStudentRegisteredClass === 'function' ? getStudentRegisteredClass() : '';
    const isAuth = typeof isUserAuthenticated === 'function' && isUserAuthenticated();

    const cards = [
        { short: 'c12', key: 'class-12', title: 'Class 12 Mathematics', sub: 'Grade XII · NEB Mat. 102', desc: 'Calculus, 3D Vectors, Conic Sections, Differential Equations & Board Model Sets.' },
        { short: 'c11', key: 'class-11', title: 'Class 11 Mathematics', sub: 'Grade XI · NEB Mat. 101', desc: 'Logic, Algebra, Complex Numbers, Coordinate Geometry & First-Principle Calculus.' },
        { short: 'c10', key: 'class-10', title: 'Class 10 (SEE)', sub: 'SEE Foundation', desc: 'Compulsory & Optional Mathematics, Circle Theorems, Sets & Trigonometry.' },
        { short: 'entrance', key: 'after-12', title: 'Entrance Prep', sub: 'IOE / CEE / KU', desc: 'Pulchowk CBT Speed Calculus, 15-Year Past Papers & Casio FX-991 Techniques.' }
    ];

    grid.innerHTML = cards.map(c => {
        const lockInfo = typeof getSectionLockInfo === 'function' ? getSectionLockInfo(c.key) : { locked: false, reason: '' };
        const isMine = isAuth && myClass === c.short;
        return `
            <div class="premium-program-card ${lockInfo.locked ? 'is-locked-section' : ''}" role="button" tabindex="0"
                 onclick="handleClassNavClick('${c.short}')" onkeydown="if(event.key==='Enter') handleClassNavClick('${c.short}')">
                <div class="program-card-top">
                    <span class="program-level-badge">${escapeHtml(c.sub)}</span>
                    ${lockInfo.locked
                        ? '<span class="section-status-badge locked">Locked</span>'
                        : (isMine ? '<span class="plan-current-tag">Your Class</span>' : '')}
                </div>
                <h3>${escapeHtml(c.title)}</h3>
                <p>${lockInfo.locked ? escapeHtml(lockInfo.reason || 'Temporarily unavailable') : escapeHtml(c.desc)}</p>
                <div class="program-card-footer">
                    <span class="program-card-tags">${lockInfo.locked ? 'Temporarily unavailable' : 'Lessons · Mock Tests · Zoom'}</span>
                    <span class="program-card-cta">${lockInfo.locked ? 'Locked' : 'Open Class'} <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></span>
                </div>
            </div>
        `;
    }).join('');
}

/* --------------------------------------------------------------------------
   LIVE CLASS CALENDAR (NEPAL TIME ZOOM SCHEDULE) & NOTIFICATIONS
   -------------------------------------------------------------------------- */
function formatNepalTime12h(hhmm) {
    const parts = String(hhmm || '06:30').split(':');
    let h = parseInt(parts[0], 10);
    const m = parseInt(parts[1] || '0', 10);
    if (!Number.isFinite(h)) h = 6;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(Number.isFinite(m) ? m : 0).padStart(2, '0')} ${ampm}`;
}

function computeNepalEndTime(hhmm, durationMin) {
    const parts = String(hhmm || '06:30').split(':');
    const h = parseInt(parts[0], 10) || 0;
    const m = parseInt(parts[1] || '0', 10) || 0;
    const total = (h * 60 + m + (Number(durationMin) || 60)) % (24 * 60);
    const eh = Math.floor(total / 60);
    const em = total % 60;
    return formatNepalTime12h(`${String(eh).padStart(2, '0')}:${String(em).padStart(2, '0')}`);
}

function formatNepalDateReadable(dateStr) {
    if (!dateStr) return 'Upcoming';
    const d = new Date(`${dateStr}T00:00:00+05:45`);
    if (isNaN(d.getTime())) return dateStr;
    try {
        return d.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            timeZone: 'Asia/Kathmandu'
        });
    } catch (e) {
        return dateStr;
    }
}

function buildZoomClassCardHtml(zc, isModal = false) {
    const isCancelled = zc.status === 'cancelled';
    const start12 = formatNepalTime12h(zc.startTime);
    const end12 = computeNepalEndTime(zc.startTime, zc.durationMinutes);
    const dateLabel = formatNepalDateReadable(zc.date);
    const classLabelMap = { 'class-12': 'Class 12', 'class-11': 'Class 11', 'class-10': 'Class 10', 'after-12': 'Entrance Prep', all: 'All Programs' };
    const classLabel = classLabelMap[zc.classKey] || zc.classKey || '';
    const planLabel = typeof formatPlanLabel === 'function' ? formatPlanLabel(zc.minPlan || 'free') : (zc.minPlan || 'Free');
    const safeTitle = escapeHtml(zc.title || 'Live Zoom Class');
    const jsTitle = safeTitle.replace(/'/g, "\\'");

    let actionHtml = '';
    if (isCancelled) {
        actionHtml = `<span class="zoom-cancelled-note">This session has been cancelled.</span>`;
    } else if (zc.canJoin && zc.zoomUrl) {
        actionHtml = `
            <a href="${escapeHtml(zc.zoomUrl)}" target="_blank" rel="noopener" class="btn btn-primary" style="flex:1; justify-content:center; text-decoration:none; padding:10px 14px; font-size:0.86rem;">
                <i class="fa-solid fa-video" aria-hidden="true"></i> Join on Zoom
            </a>
            <button type="button" class="btn btn-secondary" onclick="downloadSampleIcs('${jsTitle}', '${escapeHtml(dateLabel)} · ${escapeHtml(start12)} – ${escapeHtml(end12)} NPT')" title="Add to Calendar (.ics)" style="padding:10px 12px; font-size:0.86rem;">
                <i class="fa-solid fa-calendar-plus" aria-hidden="true"></i>
            </button>
        `;
    } else if (zc.accessReason === 'plan_required') {
        const reqPlan = zc.requiredPlan || zc.minPlan || 'gold';
        actionHtml = `
            <button type="button" class="btn btn-secondary" style="flex:1; justify-content:center; padding:10px 14px; font-size:0.86rem;"
                    onclick="${isModal ? 'closeCalendarSessionModal(); ' : ''}openPlanComparisonModal('${escapeHtml(reqPlan)}', '${jsTitle}')">
                <i class="fa-solid fa-lock" aria-hidden="true"></i> Level up to unlock (${escapeHtml(planLabel)})
            </button>
        `;
    } else if (zc.accessReason === 'wrong_class') {
        actionHtml = `<span class="zoom-access-note"><i class="fa-solid fa-lock" aria-hidden="true"></i> Available to ${escapeHtml(classLabel)} students</span>`;
    } else {
        actionHtml = `
            <button type="button" class="btn btn-primary" style="flex:1; justify-content:center; padding:10px 14px; font-size:0.86rem;"
                    onclick="${isModal ? 'closeCalendarSessionModal(); ' : ''}openAuthModal('signin')">
                <i class="fa-solid fa-right-to-bracket" aria-hidden="true"></i> Sign in to Join on Zoom
            </button>
        `;
    }

    return `
        <div class="zoom-session-card ${isCancelled ? 'is-cancelled' : ''}">
            <div>
                <div class="zoom-session-top">
                    <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                        <span class="zoom-status-badge ${isCancelled ? 'cancelled' : 'scheduled'}">
                            ${isCancelled ? 'Cancelled' : 'Live Zoom'}
                        </span>
                        <span class="mock-plan-pill ${escapeHtml(zc.minPlan || 'free')}">${escapeHtml(planLabel)}</span>
                    </div>
                    <span class="zoom-class-tag">${escapeHtml(classLabel)}</span>
                </div>
                <h4 class="zoom-session-title">${safeTitle}</h4>
                <div class="zoom-session-meta">
                    <span><i class="fa-solid fa-book" aria-hidden="true"></i> <strong>Subject:</strong> ${escapeHtml(zc.subject || 'Mathematics')}</span>
                    <span><i class="fa-solid fa-chalkboard-user" aria-hidden="true"></i> <strong>Teacher:</strong> ${escapeHtml(zc.teacher || 'BPG Sir')}</span>
                    <span><i class="fa-regular fa-calendar" aria-hidden="true"></i> <strong>Date:</strong> ${escapeHtml(dateLabel)}</span>
                    <span><i class="fa-regular fa-clock" aria-hidden="true"></i> <strong>Nepal Time:</strong> ${escapeHtml(start12)} &ndash; ${escapeHtml(end12)} NPT (${Number(zc.durationMinutes || 60)} min)</span>
                </div>
                ${zc.instructions ? `<p class="zoom-session-instructions">${escapeHtml(zc.instructions)}</p>` : ''}
            </div>
            <div class="zoom-session-actions">
                ${actionHtml}
            </div>
        </div>
    `;
}

function renderPortalCalendar(classKey) {
    const calMount = document.getElementById(`calendarContainer-${classKey}`);
    if (!calMount) return;

    const allZoom = Array.isArray(ACADEMY_STATE.zoomClasses) ? ACADEMY_STATE.zoomClasses : [];
    const sessions = allZoom
        .filter(zc => zc.classKey === classKey || zc.classKey === 'all')
        .slice()
        .sort((a, b) => `${a.date || '9999-99-99'} ${a.startTime || '00:00'}`.localeCompare(`${b.date || '9999-99-99'} ${b.startTime || '00:00'}`));

    if (sessions.length === 0) {
        calMount.innerHTML = `
            <div class="mock-empty-card">
                <i class="fa-solid fa-video" aria-hidden="true"></i>
                <h3>No Zoom classes scheduled yet</h3>
                <p>Upcoming live Zoom sessions in Nepal Time (NPT) will appear here.</p>
            </div>
        `;
        return;
    }

    calMount.innerHTML = `
        <div class="calendar-card-wrap">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:18px;">
                <div>
                    <h3 style="font-size:1.2rem; font-weight:700; color:var(--text-primary); margin:0;">Upcoming Zoom Classes</h3>
                    <p style="font-size:0.84rem; color:var(--text-secondary); margin:4px 0 0;">All timings are shown in Nepal Time (NPT · UTC+5:45).</p>
                </div>
            </div>
            <div class="zoom-sessions-grid">
                ${sessions.map(zc => buildZoomClassCardHtml(zc, false)).join('')}
            </div>
        </div>
    `;
}

function renderPublicZoomScheduleModal() {
    const body = document.getElementById('calendarSessionModalBody');
    if (!body) return;

    const allZoom = Array.isArray(ACADEMY_STATE.zoomClasses) ? ACADEMY_STATE.zoomClasses : [];
    const sessions = allZoom
        .slice()
        .sort((a, b) => `${a.date || '9999-99-99'} ${a.startTime || '00:00'}`.localeCompare(`${b.date || '9999-99-99'} ${b.startTime || '00:00'}`));

    if (sessions.length === 0) {
        body.innerHTML = `<div class="mock-empty-card"><p>No upcoming live Zoom classes scheduled right now.</p></div>`;
        return;
    }

    body.innerHTML = `
        <p style="font-size:0.86rem; color:var(--text-secondary); margin:0 0 16px;">
            All schedules are shown in <strong>Nepal Time (NPT)</strong>. Sign in to reveal your <strong>Join on Zoom</strong> button for classes in your program.
        </p>
        <div class="zoom-sessions-grid single-col-modal">
            ${sessions.map(zc => buildZoomClassCardHtml(zc, true)).join('')}
        </div>
    `;
}

function renderAnnouncementsDrawer() {
    const listMount = document.getElementById('notifList');
    if (!listMount) return;
    const announcements = ACADEMY_STATE.announcements || DEFAULT_PUBLIC_DATA.announcements || [];
    listMount.innerHTML = announcements.map(a => `
        <div class="notif-item ${a.unread ? 'unread' : ''}">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <span class="notif-tag">${escapeHtml(a.tag)}</span>
                <span style="font-size:0.75rem; color:var(--text-tertiary);">${escapeHtml(a.time)}</span>
            </div>
            <strong>${escapeHtml(a.title)}</strong>
            <p>${escapeHtml(a.body)}</p>
        </div>
    `).join('');
}

function toggleNotifDrawer(e) {
    if (e) e.stopPropagation();
    document.getElementById('notifDrawer')?.classList.toggle('open');
}

function markAllNotificationsRead() {
    document.querySelectorAll('.notif-item').forEach(item => item.classList.remove('unread'));
    const dot = document.getElementById('notifUnreadDot');
    if (dot) dot.style.display = 'none';
    const badge = document.getElementById('notifUnreadBadge');
    if (badge) badge.style.display = 'none';
    showToast('All notifications marked as read.');
}

function showToast(message) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
