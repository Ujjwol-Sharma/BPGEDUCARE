/**
 * BPG EDUCARE — Durable Cloud Persistence & File Storage Engine (api/_durable-storage.js)
 *
 * Ensures all live data (PDF files & metadata, mock tests & timers, member accounts & Google links,
 * class selections, plans, and payments) survives Vercel Serverless container cold starts and
 * future code deployments.
 *
 * Architecture:
 * - Persists live JSON documents and uploaded PDF binary files to a dedicated data branch (`bpg-live-db`)
 *   via the GitHub Git Data & Raw Contents API (with Vercel builds disabled on `bpg-live-db`).
 * - Isolates Preview deployments (`live-data-preview/`) from Production (`live-data/`).
 * - Confirms uploads/edits ONLY after the atomic durable commit succeeds.
 * - On cold start or redeploy, hydrates from `bpg-live-db` and runs non-destructive additive schema
 *   migrations so new code changes never overwrite live records.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const TMP_PDF_DIR = path.join(os.tmpdir(), 'bpg-pdfs');
const LOCAL_PDF_DIR = path.join(path.resolve(__dirname, '..'), 'data', 'pdfs');

function getDurableConfig() {
    const token = String(process.env.GITHUB_PERSIST_TOKEN || process.env.GH_PERSIST_TOKEN || '').trim();
    const repo = String(process.env.GITHUB_PERSIST_REPO || 'Ujjwol-Sharma/BPGEDUCARE').trim();
    const branch = String(process.env.GITHUB_PERSIST_BRANCH || 'bpg-live-db').trim();
    const vercelEnv = String(process.env.VERCEL_ENV || 'production').trim().toLowerCase();
    const prefix = vercelEnv === 'preview' ? 'live-data-preview' : 'live-data';
    return {
        enabled: Boolean(token && repo),
        token,
        repo,
        branch,
        vercelEnv,
        prefix
    };
}

function getGithubHeaders(token, raw = false) {
    return {
        Authorization: `Bearer ${token}`,
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'BPG-Educare-Durable-Store/1.0',
        'Content-Type': 'application/json'
    };
}

// Pending durable file writes queued during the current request
const pendingDurableFiles = new Map(); // relativePath (under prefix) -> { contentBuffer, encoding }
let lastHydratedCommitSha = '';
let lastRefCheckAt = 0;
let lastHydrationAuthoritative = false;
const REF_CHECK_TTL_MS = 1200;

function isDurableHydrationAuthoritative() {
    const cfg = getDurableConfig();
    return !cfg.enabled || Boolean(lastHydrationAuthoritative && lastHydratedCommitSha);
}

function queueDurableWrite(relPath, contentBufferOrStr) {
    const buf = Buffer.isBuffer(contentBufferOrStr)
        ? contentBufferOrStr
        : Buffer.from(String(contentBufferOrStr), 'utf8');
    pendingDurableFiles.set(relPath, buf);
}

function hasPendingDurableWrites() {
    return pendingDurableFiles.size > 0;
}

/**
 * Extracts any base64 PDF data URLs inside state.portals into durable file storage (`pdfs/<pdfId>.pdf`)
 * while keeping metadata and fast local/memory access intact.
 */
function extractAndQueueDurablePdfFiles(state) {
    if (!state || !state.portals || typeof state.portals !== 'object') return;
    try {
        if (!fs.existsSync(TMP_PDF_DIR)) fs.mkdirSync(TMP_PDF_DIR, { recursive: true });
    } catch (e) {}
    try {
        if (!fs.existsSync(LOCAL_PDF_DIR)) fs.mkdirSync(LOCAL_PDF_DIR, { recursive: true });
    } catch (e) {}

    const persistedIds = global.__BPG_PERSISTED_PDF_IDS__ || (global.__BPG_PERSISTED_PDF_IDS__ = new Set());

    const processPdfObj = (pdf) => {
        if (!pdf || typeof pdf !== 'object' || !pdf.id) return;
        const safeId = String(pdf.id).replace(/[^a-zA-Z0-9._-]/g, '_');
        const relPdfPath = `pdfs/${safeId}.pdf`;
        pdf.storageKey = relPdfPath;

        const url = String(pdf.fileUrl || '');
        if (url.startsWith('data:application/pdf;base64,')) {
            const b64 = url.slice('data:application/pdf;base64,'.length);
            const buf = Buffer.from(b64, 'base64');
            pdf.fileSizeBytes = buf.length;
            pdf.hasFile = true;
            try {
                fs.writeFileSync(path.join(TMP_PDF_DIR, `${safeId}.pdf`), buf);
            } catch (e) {}
            try {
                fs.writeFileSync(path.join(LOCAL_PDF_DIR, `${safeId}.pdf`), buf);
            } catch (e) {}
            if (!persistedIds.has(safeId)) {
                queueDurableWrite(relPdfPath, buf);
                persistedIds.add(safeId);
            }
            // Strip multi-MB inline Base64 from academy-state.json so state stays <200KB (well below Vercel's 4.5MB limit)
            pdf.fileUrl = '';
        } else if (pdf.storageKey || pdf.hasFile) {
            pdf.hasFile = true;
        }
    };

    for (const classKey of Object.keys(state.portals)) {
        const portal = state.portals[classKey];
        if (!portal) continue;
        for (const subj of (portal.subjects || [])) {
            for (const lesson of (subj.lessons || [])) {
                for (const pdf of (lesson.pdfs || [])) {
                    processPdfObj(pdf);
                }
            }
        }
        for (const note of (portal.notesPdfs || portal.notes || [])) {
            processPdfObj(note);
        }
    }
}

/**
 * Fetches a raw file from `bpg-live-db` via GitHub Contents API with raw media type (supports up to 100 MB).
 */
async function fetchDurableRawFile(relPath, refShaOrBranch = '') {
    const cfg = getDurableConfig();
    if (!cfg.enabled) return null;
    const fullPath = `${cfg.prefix}/${relPath}`;
    const ref = refShaOrBranch || cfg.branch;
    const url = `https://api.github.com/repos/${cfg.repo}/contents/${encodeURIComponent(fullPath).replace(/%2F/g, '/')}?ref=${encodeURIComponent(ref)}`;
    const resp = await fetch(url, {
        method: 'GET',
        headers: getGithubHeaders(cfg.token, true)
    });
    if (resp.status === 404) return null;
    if (!resp.ok) {
        throw new Error(`GitHub raw fetch failed (${resp.status}) for ${fullPath}`);
    }
    const arrBuf = await resp.arrayBuffer();
    return Buffer.from(arrBuf);
}

/**
 * Loads a PDF binary buffer from `/tmp/bpg-pdfs`, `data/pdfs`, or durable cloud storage `bpg-live-db`.
 */
async function readDurablePdfBuffer(pdfId) {
    const safeId = String(pdfId || '').replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeId) return null;

    for (const candidate of [path.join(TMP_PDF_DIR, `${safeId}.pdf`), path.join(LOCAL_PDF_DIR, `${safeId}.pdf`)]) {
        try {
            if (fs.existsSync(candidate)) {
                return fs.readFileSync(candidate);
            }
        } catch (e) {}
    }

    try {
        const buf = await fetchDurableRawFile(`pdfs/${safeId}.pdf`);
        if (buf && buf.length > 0) {
            try {
                if (!fs.existsSync(TMP_PDF_DIR)) fs.mkdirSync(TMP_PDF_DIR, { recursive: true });
                fs.writeFileSync(path.join(TMP_PDF_DIR, `${safeId}.pdf`), buf);
            } catch (e) {}
            return buf;
        }
    } catch (e) {}
    return null;
}

/**
 * Gets the current head commit SHA and tree SHA of `bpg-live-db`.
 */
async function getDurableBranchRef(cfg) {
    const refUrl = `https://api.github.com/repos/${cfg.repo}/git/ref/heads/${encodeURIComponent(cfg.branch)}`;
    const resp = await fetch(refUrl, {
        method: 'GET',
        headers: getGithubHeaders(cfg.token, false)
    });
    if (resp.status === 404) return null;
    if (!resp.ok) {
        throw new Error(`Failed to check durable branch ref (${resp.status})`);
    }
    const data = await resp.json();
    return data?.object?.sha || null;
}

/**
 * Flushes all queued durable writes in a single atomic Git commit on `bpg-live-db`.
 * Retries once on fast-forward conflict so concurrent writes never get lost.
 */
async function flushPendingDurableCommits() {
    if (pendingDurableFiles.size === 0) return { committed: false };
    const cfg = getDurableConfig();
    const filesToCommit = Array.from(pendingDurableFiles.entries());
    pendingDurableFiles.clear();

    if (!cfg.enabled) {
        return { committed: false, localOnly: true };
    }

    for (let attempt = 0; attempt < 3; attempt++) {
        const headCommitSha = await getDurableBranchRef(cfg);
        let baseTreeSha = null;

        if (headCommitSha) {
            const commitResp = await fetch(`https://api.github.com/repos/${cfg.repo}/git/commits/${headCommitSha}`, {
                method: 'GET',
                headers: getGithubHeaders(cfg.token, false)
            });
            if (commitResp.ok) {
                const commitJson = await commitResp.json();
                baseTreeSha = commitJson?.tree?.sha || null;
            }
        }

        // 1. Create Git Blobs in parallel for all modified files
        const treeEntries = await Promise.all(filesToCommit.map(async ([relPath, buf]) => {
            const blobResp = await fetch(`https://api.github.com/repos/${cfg.repo}/git/blobs`, {
                method: 'POST',
                headers: getGithubHeaders(cfg.token, false),
                body: JSON.stringify({
                    content: buf.toString('base64'),
                    encoding: 'base64'
                })
            });
            if (!blobResp.ok) {
                const errTxt = await blobResp.text().catch(() => '');
                throw new Error(`Blob creation failed (${blobResp.status}) for ${relPath}: ${errTxt}`);
            }
            const blobJson = await blobResp.json();
            return {
                path: `${cfg.prefix}/${relPath}`,
                mode: '100644',
                type: 'blob',
                sha: blobJson.sha
            };
        }));

        // 2. Create Git Tree
        const treeBody = { tree: treeEntries };
        if (baseTreeSha) treeBody.base_tree = baseTreeSha;
        const treeResp = await fetch(`https://api.github.com/repos/${cfg.repo}/git/trees`, {
            method: 'POST',
            headers: getGithubHeaders(cfg.token, false),
            body: JSON.stringify(treeBody)
        });
        if (!treeResp.ok) {
            const errTxt = await treeResp.text().catch(() => '');
            throw new Error(`Tree creation failed (${treeResp.status}): ${errTxt}`);
        }
        const treeJson = await treeResp.json();

        // 3. Create Git Commit ([skip ci] prevents Vercel from queueing preview builds on the data branch)
        const commitBody = {
            message: `chore(live-db): persist ${filesToCommit.map(([k]) => k).join(', ')} [${cfg.vercelEnv}] [skip ci]`,
            tree: treeJson.sha,
            parents: headCommitSha ? [headCommitSha] : []
        };
        const newCommitResp = await fetch(`https://api.github.com/repos/${cfg.repo}/git/commits`, {
            method: 'POST',
            headers: getGithubHeaders(cfg.token, false),
            body: JSON.stringify(commitBody)
        });
        if (!newCommitResp.ok) {
            const errTxt = await newCommitResp.text().catch(() => '');
            throw new Error(`Commit creation failed (${newCommitResp.status}): ${errTxt}`);
        }
        const newCommitJson = await newCommitResp.json();

        // 4. Update or Create Branch Ref
        if (headCommitSha) {
            const refResp = await fetch(`https://api.github.com/repos/${cfg.repo}/git/refs/heads/${encodeURIComponent(cfg.branch)}`, {
                method: 'PATCH',
                headers: getGithubHeaders(cfg.token, false),
                body: JSON.stringify({
                    sha: newCommitJson.sha,
                    force: false
                })
            });
            if (refResp.ok) {
                lastHydratedCommitSha = newCommitJson.sha;
                lastRefCheckAt = Date.now();
                return { committed: true, sha: newCommitJson.sha };
            }
            if (refResp.status === 422 && attempt < 2) {
                // Concurrent update on branch ref; retry against new head
                continue;
            }
            const errTxt = await refResp.text().catch(() => '');
            throw new Error(`Ref update failed (${refResp.status}): ${errTxt}`);
        } else {
            const createRefResp = await fetch(`https://api.github.com/repos/${cfg.repo}/git/refs`, {
                method: 'POST',
                headers: getGithubHeaders(cfg.token, false),
                body: JSON.stringify({
                    ref: `refs/heads/${cfg.branch}`,
                    sha: newCommitJson.sha
                })
            });
            if (createRefResp.ok) {
                lastHydratedCommitSha = newCommitJson.sha;
                lastRefCheckAt = Date.now();
                return { committed: true, sha: newCommitJson.sha };
            }
            const errTxt = await createRefResp.text().catch(() => '');
            throw new Error(`Ref creation failed (${createRefResp.status}): ${errTxt}`);
        }
    }

    throw new Error('Could not commit to durable storage after retries.');
}

/**
 * Non-destructive additive migration: merges live cloud state with any new bundle schema defaults
 * while preserving all live PDFs, mock tests, payments, notifications, and settings.
 */
function mergeLiveStateNonDestructively(cloudState, localState) {
    if (!cloudState || typeof cloudState !== 'object') return localState;
    if (!localState || typeof localState !== 'object') return cloudState;

    // Cloud state (bpg-live-db) is the authoritative live database; only fill missing top-level schema keys from bundle
    const merged = Object.assign({}, localState, cloudState);
    merged.revision = Math.max(Number(cloudState.revision) || 0, Number(localState.revision) || 0);
    merged.mockTests = Array.isArray(cloudState.mockTests) ? cloudState.mockTests : (localState.mockTests || []);
    merged.payments = Array.isArray(cloudState.payments) ? cloudState.payments : (localState.payments || []);

    if (localState.portals && cloudState.portals) {
        merged.portals = Object.assign({}, localState.portals);
        for (const ck of Object.keys(cloudState.portals)) {
            const lp = localState.portals[ck] || {};
            const cp = cloudState.portals[ck] || {};
            merged.portals[ck] = Object.assign({}, lp, cp);
        }
    }

    return merged;
}

/**
 * Checks if `bpg-live-db` has newer state than the current container and hydrates `/tmp` and `global`.
 */
async function ensureDurableStoreHydrated({ TMP_DB_PATH, TMP_ROSTER_PATH, TMP_ATTEMPTS_PATH, DB_PATH, ROSTER_PATH, force = false }) {
    const cfg = getDurableConfig();
    if (!cfg.enabled) {
        lastHydrationAuthoritative = true;
        return false;
    }

    const now = Date.now();
    if (!force && lastHydratedCommitSha && (now - lastRefCheckAt) < REF_CHECK_TTL_MS && global.__BPG_ACADEMY_STATE__ && global.__BPG_STUDENT_ROSTER__) {
        return false;
    }

    try {
        const remoteSha = await getDurableBranchRef(cfg);
        lastRefCheckAt = now;
        if (!remoteSha) {
            lastHydrationAuthoritative = false;
            return false;
        }
        if (remoteSha === lastHydratedCommitSha && global.__BPG_ACADEMY_STATE__ && global.__BPG_STUDENT_ROSTER__) {
            lastHydrationAuthoritative = true;
            return false;
        }

        const [stateBuf, rosterBuf, attemptsBuf] = await Promise.all([
            fetchDurableRawFile('academy-state.json', remoteSha).catch(() => null),
            fetchDurableRawFile('student-roster.json', remoteSha).catch(() => null),
            fetchDurableRawFile('mock-attempts.json', remoteSha).catch(() => null)
        ]);

        if (stateBuf) {
            const cloudState = JSON.parse(stateBuf.toString('utf8'));
            let bundleState = null;
            try {
                if (DB_PATH && fs.existsSync(DB_PATH)) {
                    bundleState = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
                }
            } catch (e) {}
            const mergedState = mergeLiveStateNonDestructively(cloudState, bundleState);
            try { fs.writeFileSync(TMP_DB_PATH, JSON.stringify(mergedState, null, 2), 'utf8'); } catch (e) {}
            global.__BPG_ACADEMY_STATE__ = null; // Force readAcademyState() to re-normalize from TMP_DB_PATH
        }

        if (rosterBuf) {
            const cloudRoster = JSON.parse(rosterBuf.toString('utf8'));
            try { fs.writeFileSync(TMP_ROSTER_PATH, JSON.stringify(cloudRoster, null, 2), 'utf8'); } catch (e) {}
            global.__BPG_STUDENT_ROSTER__ = null; // Force readRoster() to re-normalize from TMP_ROSTER_PATH
        }

        if (attemptsBuf && TMP_ATTEMPTS_PATH) {
            const cloudAttempts = JSON.parse(attemptsBuf.toString('utf8'));
            try { fs.writeFileSync(TMP_ATTEMPTS_PATH, JSON.stringify(cloudAttempts, null, 2), 'utf8'); } catch (e) {}
            global.__BPG_MOCK_ATTEMPTS__ = null;
        }

        lastHydratedCommitSha = remoteSha;
        lastHydrationAuthoritative = Boolean(rosterBuf || stateBuf);
        return true;
    } catch (err) {
        console.warn('[DurableStore] Hydration check warning:', err.message);
        lastHydrationAuthoritative = false;
        return false;
    }
}

module.exports = {
    TMP_PDF_DIR,
    LOCAL_PDF_DIR,
    getDurableConfig,
    isDurableHydrationAuthoritative,
    queueDurableWrite,
    hasPendingDurableWrites,
    extractAndQueueDurablePdfFiles,
    readDurablePdfBuffer,
    flushPendingDurableCommits,
    ensureDurableStoreHydrated
};
