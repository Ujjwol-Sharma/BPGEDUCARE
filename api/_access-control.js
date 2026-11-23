/**
 * BPG Academy — Shared Backend Access Control, Gmail Uniqueness & Plans Engine (api/access-control.js)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const DB_PATH = path.join(DATA_DIR, 'academy-state.json');
const LEGACY_CMS_PATH = path.join(ROOT_DIR, 'bpg-cms-data.json');
const TMP_DB_PATH = path.join(os.tmpdir(), 'bpg-academy-state.json');
const ROSTER_PATH = path.join(DATA_DIR, 'student-roster.json');
const TMP_ROSTER_PATH = path.join(os.tmpdir(), 'bpg-student-roster.json');

const MASTER_PASSKEY = process.env.ADMIN_PASSKEY || 'k9x4m7p2q8z';
const OTP_SECRET = process.env.OTP_SECRET || 'bpg-maths-academy-hmac-secret-2026';

const PLAN_RANK = {
    free: 0,
    gold: 1,
    diamond: 2
};

const DEFAULT_SECTION_LOCKS = {
    'class-10': { locked: true, reason: 'Temporarily unavailable' },
    'class-11': { locked: false, reason: '' },
    'class-12': { locked: false, reason: '' },
    'after-12': { locked: true, reason: 'Temporarily unavailable' }
};

const DEFAULT_PLANS_CONFIG = {
    free: {
        id: 'free',
        name: 'Free',
        price: 'Rs. 0',
        period: 'Forever free',
        description: 'Access admin-selected sample questions and PDFs in open sections.'
    },
    gold: {
        id: 'gold',
        name: 'Gold',
        price: 'Rs. 1,499',
        period: 'Per academic year',
        description: 'Includes all Free content plus Gold questions, full answers, and study PDFs.'
    },
    diamond: {
        id: 'diamond',
        name: 'Diamond',
        price: 'Rs. 2,999',
        period: 'Per academic year',
        description: 'Unlocks every question, solution, and PDF across all open sections.'
    }
};

const DEFAULT_ZOOM_CLASSES = [
    {
        id: 'zc-c12-calc-1',
        title: 'Sunday Concept Diagnostic & Live Q&A',
        classKey: 'class-12',
        subject: 'Mathematics',
        teacher: 'Bishnu Prasad Gautam (BPG Sir)',
        date: '2026-11-29',
        startTime: '06:30',
        durationMinutes: 75,
        zoomUrl: 'https://zoom.us/j/98410238899?pwd=BPG2026',
        instructions: 'Bring your Class 12 notebook and Casio FX-991 calculator. Focus on Calculus first principles and live Q&A.',
        status: 'scheduled',
        minPlan: 'free',
        adminAssignedPlan: true
    },
    {
        id: 'zc-c12-vec-2',
        title: 'Grade XII Calculus & 3D Vectors Distinction Clinic',
        classKey: 'class-12',
        subject: 'Mathematics',
        teacher: 'Bishnu Prasad Gautam (BPG Sir)',
        date: '2026-12-05',
        startTime: '19:00',
        durationMinutes: 90,
        zoomUrl: 'https://zoom.us/j/98410238899?pwd=BPG2026',
        instructions: 'We will walk through NEB 5-mark board problems on definite integrals and 3D planes.',
        status: 'scheduled',
        minPlan: 'gold',
        adminAssignedPlan: true
    },
    {
        id: 'zc-c11-found-1',
        title: 'Grade XI Limits & First-Principle Derivatives Workshop',
        classKey: 'class-11',
        subject: 'Mathematics',
        teacher: 'Bishnu Prasad Gautam (BPG Sir)',
        date: '2026-11-29',
        startTime: '08:00',
        durationMinutes: 75,
        zoomUrl: 'https://zoom.us/j/98410238899?pwd=BPG2026',
        instructions: 'Review trigonometric limits before joining.',
        status: 'scheduled',
        minPlan: 'free',
        adminAssignedPlan: true
    }
];

const DEFAULT_TEAM_MEMBERS = [
    {
        id: 'team-founder',
        slot: 'founder',
        initial: 'B',
        name: 'Bishnu Prasad Gautam',
        role: 'Founder',
        photoUrl: './images/bpg_sir.jpg',
        bio: ''
    },
    {
        id: 'team-ceo',
        slot: 'ceo',
        initial: 'P',
        name: 'Paribesh Thapa',
        role: '',
        photoUrl: '',
        bio: ''
    },
    {
        id: 'team-cco',
        slot: 'cco',
        initial: 'U',
        name: 'Ujjwol Sharma',
        role: '',
        photoUrl: '',
        bio: ''
    },
    {
        id: 'team-cto',
        slot: 'cto',
        initial: 'U',
        name: 'Utsav Sharma',
        role: '',
        photoUrl: '',
        bio: ''
    }
];

const DEFAULT_HOMEPAGE_CONTENT = {
    heroPillText: 'Pokhara, Nepal · NEB & Entrance Mathematics',
    heroTitleMain: 'Understand Mathematics.',
    heroTitleMuted: 'Master every concept.',
    heroDescription: 'Structured, concept-first mathematics portals for Class 10, Class 11, Class 12, and IOE / CEE / KU entrance — mentored by Bishnu Prasad Gautam (BPG Sir).',
    heroPrimaryBtnLabel: 'Get Started',
    heroSecondaryBtnLabel: 'Ask BPG AI',
    heroSecondaryBtnLink: '#ai',
    heroPortraitUrl: 'images/bpg_sir.jpg',
    heroFacultyName: 'Bishnu Prasad Gautam',
    heroFacultyRole: 'Founder & Lead Faculty · BPG Sir',
    heroFacultyTag: 'TU M.Sc.',
    bannerEnabled: false,
    bannerText: 'Admissions open for Class 11 & Class 12 NEB Mathematics batches.',
    bannerLinkLabel: 'View Plans',
    bannerLinkUrl: '#plans',
    featuresEyebrow: 'Explore BPG EDUCARE',
    featuresHeading: 'Everything you need in one place',
    featureCards: [
        { id: 'lessons', label: 'Lessons', sub: 'Open subjects, chapters, and lesson PDFs', link: '#lessons' },
        { id: 'mocktests', label: 'Mock Tests', sub: 'Timed MCQ practice tests and instant scoring', link: '#mocktests' },
        { id: 'syllabus', label: 'Syllabus Grid', sub: 'Units, teaching hours, and marks weightage', link: '#syllabus' },
        { id: 'calendar', label: 'Live Class Calendar', sub: 'Scheduled Zoom classes and timings', link: '#calendar' },
        { id: 'plans', label: 'Plans', sub: 'Compare Gold and Diamond access', link: '#plans' }
    ],
    notificationsEyebrow: 'Updates & Alerts',
    notificationsHeading: 'Notifications',
    teamEyebrow: 'Leadership',
    teamHeading: 'Our Team',
    footerText: '© 2026 BPG EDUCARE · Pokhara, Nepal'
};

const DEFAULT_MAINTENANCE_MODE = {
    enabled: false,
    title: 'Scheduled Maintenance',
    message: 'BPG EDUCARE is currently undergoing scheduled maintenance. Student portals, lessons, mock tests, the calculator, and checkout are temporarily locked while we update the platform.',
    updatedAt: ''
};

const DEFAULT_SITE_SETTINGS = {
    whatsappNumber: '9779866064252',
    esewaQrUrl: 'images/payment_qr.png',
    esewaMerchantName: 'BPG EDUCARE',
    googleClientId: process.env.GOOGLE_CLIENT_ID || ''
};

const DEFAULT_NOTIFICATIONS = [];

const DEFAULT_CHATBOT_FAQS = [
    {
        id: 'faq-google-signin',
        question: 'How does Google sign-in and account linking work?',
        keywords: ['google', 'sign in', 'login', 'gmail', 'link', 'account', 'oauth', 'continue with google'],
        answer: 'Click **Sign In** or **Get Started**, then choose **Continue with Google**. Each Gmail address maps to one BPG EDUCARE account. If you already registered with that Gmail, signing in with Google securely links to your existing profile, class access, and plan without creating a duplicate account.',
        links: [{ label: 'Open Sign In', action: "openAuthModal('signin')" }],
        published: true
    },
    {
        id: 'faq-enrollment',
        question: 'How does class enrollment and the one-class rule work?',
        keywords: ['enroll', 'enrollment', 'one class', 'active class', 'register', 'join class', 'single class'],
        answer: 'Each student account has **one active class at a time** (Class 10, Class 11, Class 12, or Entrance Prep). When you sign up, you choose your primary class. Once signed in, the homepage button changes to **Continue to Class** so you can jump straight back into your active workspace.',
        links: [{ label: 'Continue to Class', action: 'handleContinueToClass()' }],
        published: true
    },
    {
        id: 'faq-class-switch',
        question: 'How do I switch or change my active class?',
        keywords: ['switch class', 'change class', 'transfer', 'move class', 'different class', 'leave class'],
        answer: 'Because each account holds one active class at a time, switching classes requires submitting a **Class Switch Request**. Select the new class you want to join, review the confirmation notice explaining that leaving ends access to your current class, and submit the request. An admin will review and approve it.',
        links: [{ label: 'View Classes', action: 'openClassSelectionView()' }],
        published: true
    },
    {
        id: 'faq-request-status',
        question: 'How can I check my class switch request status?',
        keywords: ['request status', 'switch status', 'pending', 'approved', 'rejected', 'approval'],
        answer: 'Open your account menu in the top-right header or click a different class to view your **Class Switch Request** status (`Pending`, `Approved`, or `Rejected`) along with any admin note. Access to the new class is granted automatically once an admin approves your request.',
        links: [{ label: 'Check Class Status', action: 'openClassSelectionView()' }],
        published: true
    },
    {
        id: 'faq-lessons',
        question: 'Where do I find lessons and chapter videos?',
        keywords: ['lesson', 'lessons', 'chapter', 'chapters', 'video', 'videos', 'subjects', 'study'],
        answer: 'Sign in and open **Lessons** from the homepage or your class workspace. Lessons are organized by subject in syllabus order and include chapter PDFs and lesson videos.',
        links: [{ label: 'Open Lessons', action: 'openMyLessonsView()' }],
        published: true
    },
    {
        id: 'faq-notes-pdfs',
        question: 'How do I view and download notes and PDFs?',
        keywords: ['note', 'notes', 'pdf', 'pdfs', 'download', 'formula sheet', 'cheat sheet'],
        answer: 'Inside your class **Lessons / Notes** tab, click any chapter to view its attached PDFs with cover previews. Free items open immediately; Gold and Diamond items show their required plan tier. You can preview PDFs inline or download them.',
        links: [{ label: 'Open Notes & PDFs', action: 'openMyLessonsView()' }],
        published: true
    },
    {
        id: 'faq-mock-tests',
        question: 'How do Mock Tests work?',
        keywords: ['mock test', 'mock tests', 'mcq', 'exam', 'quiz', 'timer', 'score', 'test'],
        answer: 'Open **Mock Tests** from the homepage or your class workspace to take timed MCQ tests. Your remaining time and answers are saved on the server so refreshing the page will not lose progress, and you get instant scoring and answer review upon submission.',
        links: [{ label: 'Open Mock Tests', action: 'openMyMockTestsView()' }],
        published: true
    },
    {
        id: 'faq-syllabus-grid',
        question: 'Where is the NEB Syllabus Grid and marks weightage?',
        keywords: ['syllabus', 'grid', 'weightage', 'marks', 'hours', 'specification', 'blueprint'],
        answer: 'Click **Syllabus Grid** on the homepage or inside your class workspace to see the official NEB/CDC/IOE unit breakdown, teaching hours, marks weightage, and question pattern.',
        links: [{ label: 'Open Syllabus Grid', action: 'openMySyllabusView()' }],
        published: true
    },
    {
        id: 'faq-live-classes',
        question: 'How do I join Live Zoom Classes?',
        keywords: ['live class', 'zoom', 'schedule', 'timing', 'npt', 'calendar', 'meeting'],
        answer: 'Open **Live Class Calendar** to view upcoming Zoom sessions in Nepal Time (NPT). Signed-in students in the matching class and plan tier see the direct **Join Zoom** button when a session is scheduled.',
        links: [{ label: 'Open Live Class Calendar', action: 'openLiveClassCalendarEntry()' }],
        published: true
    },
    {
        id: 'faq-notifications',
        question: 'Where can I see announcements and class notifications?',
        keywords: ['notification', 'notifications', 'announcement', 'news', 'alert', 'updates'],
        answer: 'Check the **Notifications** section on the homepage for the newest published sitewide news and announcements. When signed in, you will also see alerts published specifically for your active class.',
        links: [{ label: 'View Notifications', action: "scrollToSection('homeNotificationsSection')" }],
        published: true
    },
    {
        id: 'faq-plans',
        question: 'What is the difference between Free, Gold, and Diamond plans?',
        keywords: ['plan', 'plans', 'free', 'gold', 'diamond', 'pricing', 'price', 'upgrade', 'membership'],
        answer: 'New accounts start on **Free** (sample lessons, PDFs, and open live sessions). **Gold** unlocks Gold-tier lessons, notes, mock tests, and live classes. **Diamond** unlocks all content across every open section. Click **Plans** to compare prices and features.',
        links: [{ label: 'Compare Plans', action: "openPlanComparisonModal('', '')" }],
        published: true
    },
    {
        id: 'faq-esewa',
        question: 'How do I pay with eSewa?',
        keywords: ['esewa', 'qr', 'pay', 'payment', 'checkout', 'buy', 'remarks'],
        answer: 'Sign in, open **Plans**, and tap **Buy** on Gold or Diamond to open Checkout. Scan the eSewa QR using your eSewa app and include your **Name, Class, Username, and Gmail** in the payment remarks (use the **Copy Payment Remarks** button for convenience).',
        links: [{ label: 'View Plans & Buy', action: "openPlanComparisonModal('gold', '')" }],
        published: true
    },
    {
        id: 'faq-whatsapp-confirm',
        question: 'How does WhatsApp confirmation work after paying?',
        keywords: ['whatsapp', 'confirm', 'confirmation', 'pending', 'verify', 'activation', 'transaction'],
        answer: 'After scanning the static eSewa QR, click **I’ve Paid — Continue to WhatsApp** in Checkout. This records your purchase as **pending** for admin review and opens WhatsApp with your prefilled confirmation details so you can tap Send. Your plan activates once the admin verifies your payment.',
        links: [{ label: 'Open Plans', action: "openPlanComparisonModal('gold', '')" }],
        published: true
    },
    {
        id: 'faq-calculator',
        question: 'How do I use the Scientific Calculator?',
        keywords: ['calculator', 'calc', 'scientific', 'deg', 'rad', 'history', 'trig', 'log'],
        answer: 'Click the **Calculator** icon in the bottom-right dock. It supports **Basic** and **Scientific** modes (percentages, parentheses, powers, roots, `log`, `ln`, `sin`, `cos`, `tan`, `π`), a **DEG/RAD** toggle, calculation history with result reuse, and full desktop keyboard input.',
        links: [{ label: 'Open Calculator', action: 'toggleMiniCalculator()' }],
        published: true
    },
    {
        id: 'faq-maintenance',
        question: 'What happens during Maintenance Mode?',
        keywords: ['maintenance', 'locked', 'unavailable', 'down', 'notice'],
        answer: 'During scheduled maintenance, the public homepage stays visible with a maintenance notice, while student dashboards, lessons, mock tests, the calculator, and checkout are temporarily locked until maintenance is turned off by an admin.',
        links: [],
        published: true
    },
    {
        id: 'faq-support',
        question: 'How do I contact support or BPG Sir?',
        keywords: ['support', 'contact', 'help', 'bpg sir', 'bishnu', 'pokhara', 'phone'],
        answer: 'You can reach **Bishnu Prasad Gautam (BPG Sir)** directly via the WhatsApp button on the website, or visit BPG EDUCARE in Pokhara, Nepal.',
        links: [{ label: 'Contact on WhatsApp', action: 'openConfiguredWhatsappSupport()' }],
        published: true
    }
];

/* --------------------------------------------------------------------------
   1. GMAIL CANONICALIZATION & UNIQUENESS HELPERS
   -------------------------------------------------------------------------- */
function canonicalizeEmail(rawEmail) {
    const cleaned = String(rawEmail || '').trim().toLowerCase();
    const atIdx = cleaned.indexOf('@');
    if (atIdx <= 0) return cleaned;

    let local = cleaned.slice(0, atIdx);
    let domain = cleaned.slice(atIdx + 1);

    if (domain === 'googlemail.com' || domain === 'gmail.com') {
        domain = 'gmail.com';
        const plusIdx = local.indexOf('+');
        if (plusIdx !== -1) {
            local = local.slice(0, plusIdx);
        }
        local = local.replace(/\./g, '');
    }

    return `${local}@${domain}`;
}

function isValidEmailFormat(email) {
    const cleaned = String(email || '').trim().toLowerCase();
    if (!cleaned || cleaned.length > 254) return false;
    return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(cleaned);
}

const DISPOSABLE_EMAIL_DOMAINS = new Set([
    'mailinator.com', 'tempmail.com', 'temp-mail.org', 'temp-mail.io',
    'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'sharklasers.com',
    '10minutemail.com', '10minutemail.net', 'yopmail.com', 'yopmail.fr',
    'throwaway.email', 'throwawaymail.com', 'fakeinbox.com', 'trashmail.com',
    'getnada.com', 'nada.email', 'dispostable.com', 'maildrop.cc',
    'mintemail.com', 'mytemp.email', 'mohmal.com', 'mailnesia.com',
    'emailondeck.com', 'burnermail.io', 'inboxbear.com', 'spambog.com',
    'example.com', 'example.org', 'example.net', 'test.com', 'invalid.com', 'localhost'
]);

function isDisposableOrFakeEmail(email) {
    const cleaned = String(email || '').trim().toLowerCase();
    const atIdx = cleaned.indexOf('@');
    if (atIdx <= 0) return true;
    const domain = cleaned.slice(atIdx + 1);
    if (!domain || !domain.includes('.')) return true;
    if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return true;
    for (const d of DISPOSABLE_EMAIL_DOMAINS) {
        if (domain.endsWith('.' + d)) return true;
    }
    return false;
}

function hashPassword(password) {
    const raw = String(password || '');
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(raw, salt, 64).toString('hex');
    return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, storedPasskey) {
    const raw = String(password || '');
    const stored = String(storedPasskey || '');
    if (!raw || !stored) return false;
    if (stored.startsWith('scrypt$')) {
        const parts = stored.split('$');
        if (parts.length !== 3) return false;
        const [, salt, expectedHex] = parts;
        try {
            const derived = crypto.scryptSync(raw, salt, 64);
            const expected = Buffer.from(expectedHex, 'hex');
            return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
        } catch (e) {
            return false;
        }
    }
    // Legacy plaintext passkey compatibility for existing accounts
    const a = Buffer.from(raw, 'utf8');
    const b = Buffer.from(stored, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const OTP_STORE_FILE = path.join(os.tmpdir(), 'bpg-otp-store-v2.json');

function loadOtpStoreMap() {
    if (!global.__BPG_OTP_STORE__) {
        global.__BPG_OTP_STORE__ = new Map();
        try {
            if (fs.existsSync(OTP_STORE_FILE)) {
                const parsed = JSON.parse(fs.readFileSync(OTP_STORE_FILE, 'utf8'));
                if (parsed && typeof parsed === 'object') {
                    const now = Date.now();
                    for (const [k, v] of Object.entries(parsed)) {
                        if (v && (!v.expiresAt || v.expiresAt > now - 60 * 60 * 1000)) {
                            global.__BPG_OTP_STORE__.set(k, v);
                        }
                    }
                }
            }
        } catch (e) {}
    }
    return global.__BPG_OTP_STORE__;
}

function persistOtpStoreMap() {
    try {
        const map = loadOtpStoreMap();
        const obj = {};
        const now = Date.now();
        for (const [k, v] of map.entries()) {
            if (v && (!v.expiresAt || v.expiresAt > now - 60 * 60 * 1000)) {
                obj[k] = v;
            }
        }
        fs.writeFileSync(OTP_STORE_FILE, JSON.stringify(obj), 'utf8');
    } catch (e) {}
}

function getOtpStoreEntry(key) {
    return loadOtpStoreMap().get(key) || null;
}

function setOtpStoreEntry(key, value) {
    loadOtpStoreMap().set(key, value);
    persistOtpStoreMap();
}

function deleteOtpStoreEntry(key) {
    loadOtpStoreMap().delete(key);
    persistOtpStoreMap();
}

function getClientIp(req) {
    const fwd = req?.headers?.['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
    return String(req?.socket?.remoteAddress || 'unknown');
}

function checkRateLimit(bucketKey, maxHits, windowMs) {
    const map = loadOtpStoreMap();
    const key = `rl:${bucketKey}`;
    const now = Date.now();
    let entry = map.get(key);
    if (!entry || now > entry.resetAt) {
        entry = { count: 0, resetAt: now + windowMs, expiresAt: now + windowMs };
    }
    entry.count += 1;
    map.set(key, entry);
    persistOtpStoreMap();
    if (entry.count > maxHits) {
        return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
        };
    }
    return { allowed: true, remaining: Math.max(0, maxHits - entry.count) };
}

function normalizePlan(plan) {
    const p = String(plan || 'free').trim().toLowerCase();
    if (p === 'diamond' || p === 'gold' || p === 'free') return p;
    return 'free';
}

function gradeToClassKey(grade) {
    if (!grade) return 'class-12';
    const g = String(grade).toLowerCase().trim();
    if (g === 'class-10' || g === 'c10' || g.includes('10') || g.includes('see')) return 'class-10';
    if (g === 'class-11' || g === 'c11' || g.includes('11')) return 'class-11';
    if (g === 'after-12' || g === 'entrance' || g.includes('entrance') || g.includes('after') || g.includes('ioe') || g.includes('cee')) return 'after-12';
    if (g === 'class-12' || g === 'c12' || g.includes('12')) return 'class-12';
    return 'class-12';
}

function normalizeGradeName(grade) {
    const key = gradeToClassKey(grade);
    if (key === 'class-10') return 'Class 10';
    if (key === 'class-11') return 'Class 11';
    if (key === 'after-12') return 'After 12 Entrance';
    return 'Class 12';
}

function isAdminPasskeyValid(passkey) {
    return Boolean(passkey && String(passkey) === MASTER_PASSKEY);
}

/* --------------------------------------------------------------------------
   2. SESSION TOKEN SIGNING & VERIFICATION
   -------------------------------------------------------------------------- */
function issueStudentSessionToken(user) {
    const issuedAt = Date.now();
    const expiresAt = issuedAt + 30 * 24 * 60 * 60 * 1000;
    const email = String(user.email || '').trim().toLowerCase();
    const payload = {
        email,
        canonicalEmail: canonicalizeEmail(email),
        name: user.name || 'Student',
        grade: normalizeGradeName(user.grade || user.classKey),
        plan: normalizePlan(user.plan),
        verified: true,
        issuedAt,
        expiresAt
    };
    const sig = crypto
        .createHmac('sha256', OTP_SECRET)
        .update(JSON.stringify(payload))
        .digest('hex');
    return Buffer.from(JSON.stringify({ ...payload, sig })).toString('base64url');
}

function verifyStudentSessionToken(token) {
    if (!token) return null;
    try {
        const decoded = JSON.parse(Buffer.from(String(token), 'base64url').toString('utf8'));
        if (!decoded || !decoded.email || !decoded.sig) return null;
        if (decoded.expiresAt && Date.now() > Number(decoded.expiresAt)) return null;
        const { sig, ...payload } = decoded;
        const expected = crypto
            .createHmac('sha256', OTP_SECRET)
            .update(JSON.stringify(payload))
            .digest('hex');
        const a = Buffer.from(String(sig), 'hex');
        const b = Buffer.from(expected, 'hex');
        if (a.length === 0 || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            return null;
        }
        return payload;
    } catch (e) {
        return null;
    }
}

/* --------------------------------------------------------------------------
   3. ROSTER STORAGE + DUPLICATE GMAIL FLAGGING
   -------------------------------------------------------------------------- */
function readRoster() {
    if (global.__BPG_STUDENT_ROSTER__ && Array.isArray(global.__BPG_STUDENT_ROSTER__.accounts)) {
        return global.__BPG_STUDENT_ROSTER__;
    }

    if (!fs.existsSync(DATA_DIR)) {
        try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { }
    }

    let roster = null;
    let bestRev = -1;
    // Always check TMP_ROSTER_PATH first; it only exists when runtime mutations occurred
    const candidates = [TMP_ROSTER_PATH, ROSTER_PATH];
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) {
                const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
                if (parsed && Array.isArray(parsed.accounts)) {
                    const rev = Number(parsed.revision) || (p === TMP_ROSTER_PATH ? 1 : 0);
                    if (!roster || rev > bestRev) {
                        roster = parsed;
                        bestRev = rev;
                    }
                }
            }
        } catch (e) { }
    }

    if (!roster || !Array.isArray(roster.accounts)) {
        roster = {
            revision: 20,
            lastUpdated: new Date().toISOString(),
            classSwitchRequests: [],
            accounts: []
        };
        writeRoster(roster);
    }

    if (!Array.isArray(roster.classSwitchRequests)) {
        roster.classSwitchRequests = [];
    }

    // Normalize every account while preserving existing accounts
    const canonicalCounts = {};
    roster.accounts = roster.accounts.map(acc => {
        const email = String(acc.email || '').trim().toLowerCase();
        const canonicalEmail = canonicalizeEmail(email);
        canonicalCounts[canonicalEmail] = (canonicalCounts[canonicalEmail] || 0) + 1;
        const isExistingLegacy = acc.legacyAccess !== undefined ? Boolean(acc.legacyAccess) : (acc.plan === undefined);
        const defaultUsername = email.includes('@') ? email.split('@')[0] : (acc.name || 'student').toLowerCase().replace(/[^a-z0-9]/g, '');
        return {
            ...acc,
            email,
            canonicalEmail,
            username: String(acc.username || defaultUsername).trim(),
            grade: normalizeGradeName(acc.grade || acc.classKey),
            classKey: gradeToClassKey(acc.classKey || acc.grade),
            plan: normalizePlan(acc.plan || 'free'),
            legacyAccess: isExistingLegacy,
            googleLinked: Boolean(acc.googleLinked),
            googleSub: String(acc.googleSub || ''),
            avatarUrl: String(acc.avatarUrl || ''),
            passkey: acc.passkey || 'bpgstudent',
            joinedAt: acc.joinedAt || new Date().toISOString().split('T')[0]
        };
    });

    // Flag any pre-existing duplicate Gmail inboxes for admin review
    const duplicateGroups = [];
    const grouped = {};
    roster.accounts.forEach(acc => {
        const isDup = canonicalCounts[acc.canonicalEmail] > 1;
        acc.duplicateFlag = isDup;
        if (isDup) {
            if (!grouped[acc.canonicalEmail]) grouped[acc.canonicalEmail] = [];
            grouped[acc.canonicalEmail].push(acc.email);
        }
    });
    Object.keys(grouped).forEach(ce => {
        duplicateGroups.push({ canonicalEmail: ce, emails: grouped[ce], count: grouped[ce].length });
    });
    roster.duplicateGroups = duplicateGroups;
    roster.revision = Number(roster.revision) || 1;
    global.__BPG_STUDENT_ROSTER__ = roster;

    return roster;
}

function writeRoster(roster) {
    const nextRevision = (Number(roster?.revision) || Number(global.__BPG_STUDENT_ROSTER__?.revision) || 1) + 1;
    const clean = {
        revision: nextRevision,
        lastUpdated: new Date().toISOString(),
        classSwitchRequests: Array.isArray(roster.classSwitchRequests) ? roster.classSwitchRequests : [],
        accounts: (roster.accounts || []).map(acc => {
            const email = String(acc.email || '').trim().toLowerCase();
            const defaultUsername = email.includes('@') ? email.split('@')[0] : (acc.name || 'student').toLowerCase().replace(/[^a-z0-9]/g, '');
            return {
                name: acc.name || 'Student',
                username: String(acc.username || defaultUsername).trim(),
                email,
                canonicalEmail: canonicalizeEmail(email),
                grade: normalizeGradeName(acc.grade || acc.classKey),
                classKey: gradeToClassKey(acc.classKey || acc.grade),
                plan: normalizePlan(acc.plan || 'free'),
                planExplicitlySet: Boolean(acc.planExplicitlySet),
                legacyAccess: Boolean(acc.legacyAccess),
                emailVerified: acc.emailVerified !== undefined ? Boolean(acc.emailVerified) : true,
                verifiedAt: acc.verifiedAt || '',
                verificationMethod: acc.verificationMethod || '',
                googleLinked: Boolean(acc.googleLinked),
                googleSub: String(acc.googleSub || ''),
                avatarUrl: String(acc.avatarUrl || ''),
                passkey: acc.passkey || 'bpgstudent',
                joinedAt: acc.joinedAt || new Date().toISOString().split('T')[0]
            };
        })
    };

    const serialized = JSON.stringify(clean, null, 2);
    try {
        fs.writeFileSync(TMP_ROSTER_PATH, serialized, 'utf8');
    } catch (e) { }
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        const tmp = ROSTER_PATH + '.tmp.' + Date.now();
        fs.writeFileSync(tmp, serialized, 'utf8');
        fs.renameSync(tmp, ROSTER_PATH);
    } catch (e) { }
    global.__BPG_STUDENT_ROSTER__ = null;
    return readRoster();
}

function findAccountByEmail(email) {
    const canonical = canonicalizeEmail(email);
    const roster = readRoster();
    return roster.accounts.find(a => a.canonicalEmail === canonical) || null;
}

/* --------------------------------------------------------------------------
   4. ACADEMY STATE + SECTION LOCKS + PLANS DEFAULTS & SANITIZATION
   -------------------------------------------------------------------------- */
function ensureAccessModelDefaults(state) {
    if (!state || typeof state !== 'object') return state;

    // 1. Section Locks (Class 10 & Entrance Prep locked by default)
    if (!state.sectionLocks || typeof state.sectionLocks !== 'object') {
        state.sectionLocks = JSON.parse(JSON.stringify(DEFAULT_SECTION_LOCKS));
    } else {
        Object.keys(DEFAULT_SECTION_LOCKS).forEach(key => {
            if (!state.sectionLocks[key] || typeof state.sectionLocks[key] !== 'object') {
                state.sectionLocks[key] = { ...DEFAULT_SECTION_LOCKS[key] };
            } else {
                state.sectionLocks[key].locked = Boolean(state.sectionLocks[key].locked);
                state.sectionLocks[key].reason = state.sectionLocks[key].reason || (state.sectionLocks[key].locked ? 'Temporarily unavailable' : '');
            }
        });
    }

    // 2. Configurable Free / Gold / Diamond Plans
    if (!state.plansConfig || typeof state.plansConfig !== 'object') {
        state.plansConfig = JSON.parse(JSON.stringify(DEFAULT_PLANS_CONFIG));
    } else {
        ['free', 'gold', 'diamond'].forEach(pid => {
            state.plansConfig[pid] = Object.assign(
                {},
                DEFAULT_PLANS_CONFIG[pid],
                state.plansConfig[pid] || {},
                { id: pid }
            );
        });
    }

    // 3. Ensure every topic/question and PDF note has a normalized minPlan
    if (state.portals && typeof state.portals === 'object') {
        Object.keys(state.portals).forEach(classKey => {
            const portal = state.portals[classKey];
            if (!portal) return;

            let topicIdx = 0;
            (portal.units || []).forEach(u => {
                (u.topics || []).forEach(t => {
                    if (!t.minPlan) {
                        t.minPlan = topicIdx === 0 ? 'free' : (topicIdx === 1 ? 'gold' : 'diamond');
                        t.adminAssignedPlan = false;
                    } else {
                        t.minPlan = normalizePlan(t.minPlan);
                    }
                    if (!Array.isArray(t.pdfs)) {
                        t.pdfs = [];
                    } else {
                        t.pdfs = t.pdfs.map((p, pIdx) => ({
                            ...p,
                            id: p.id || `${t.id}-pdf-${pIdx + 1}`,
                            minPlan: normalizePlan(p.minPlan || t.minPlan || 'free')
                        }));
                    }
                    if (!Array.isArray(t.manualNotes)) {
                        t.manualNotes = [];
                    }
                    topicIdx++;
                });
            });

            const notesList = Array.isArray(portal.notes) && portal.notes.length
                ? portal.notes
                : (Array.isArray(portal.notesPdfs) ? portal.notesPdfs : []);

            notesList.forEach((n, idx) => {
                if (!n.id) n.id = `${classKey}-note-${idx + 1}`;
                if (!n.minPlan) {
                    n.minPlan = idx === 0 ? 'free' : (idx === 1 ? 'gold' : 'diamond');
                    n.adminAssignedPlan = false;
                } else {
                    n.minPlan = normalizePlan(n.minPlan);
                }
            });

            // Ensure subjects -> syllabus-ordered lessons -> pdfs & videos exist
            if (!Array.isArray(portal.subjects) || portal.subjects.length === 0) {
                const rows = Array.isArray(portal.syllabusRows) ? portal.syllabusRows : [];
                const lessonsFromSyllabus = rows.map((row, idx) => ({
                    id: `${classKey}-math-l${idx + 1}`,
                    code: row.code || `Unit 0${idx + 1}`,
                    title: row.name || row.domain || `Lesson ${idx + 1}`,
                    hours: row.hours || '',
                    marks: row.marks || '',
                    pdfs: [],
                    videos: []
                }));

                // Carry over any PDFs previously attached to legacy portal.units[0].topics
                if (lessonsFromSyllabus.length > 0 && Array.isArray(portal.units)) {
                    portal.units.forEach((u, uIdx) => {
                        (u.topics || []).forEach(t => {
                            if (Array.isArray(t.pdfs) && t.pdfs.length > 0) {
                                const target = lessonsFromSyllabus[Math.min(uIdx, lessonsFromSyllabus.length - 1)];
                                target.pdfs.push(...t.pdfs);
                            }
                        });
                    });
                }

                portal.subjects = [
                    {
                        id: 'mathematics',
                        name: 'Mathematics',
                        lessons: lessonsFromSyllabus
                    }
                ];
            } else {
                portal.subjects = portal.subjects.map((subj, sIdx) => ({
                    id: subj.id || `subject-${sIdx + 1}`,
                    name: subj.name || 'Mathematics',
                    lessons: (Array.isArray(subj.lessons) ? subj.lessons : []).map((l, lIdx) => ({
                        id: l.id || `${classKey}-${subj.id || 'subj'}-l${lIdx + 1}`,
                        code: l.code || `Lesson ${lIdx + 1}`,
                        title: l.title || `Lesson ${lIdx + 1}`,
                        hours: l.hours || '',
                        marks: l.marks || '',
                        subTopics: (Array.isArray(l.subTopics) ? l.subTopics : []).map((st, stIdx) => ({
                            id: st.id || `sub_${lIdx + 1}_${stIdx + 1}`,
                            title: String(st.title || '').trim()
                        })).filter(st => st.title),
                        pdfs: (Array.isArray(l.pdfs) ? l.pdfs : []).map((p, pIdx) => ({
                            ...p,
                            id: p.id || `${l.id || 'l'}-pdf-${pIdx + 1}`,
                            subTopicId: p.subTopicId || '',
                            subTopicTitle: p.subTopicTitle || '',
                            minPlan: normalizePlan(p.minPlan || 'free')
                        })),
                        videos: (Array.isArray(l.videos) ? l.videos : []).map((v, vIdx) => ({
                            ...v,
                            id: v.id || `${l.id || 'l'}-vid-${vIdx + 1}`,
                            subTopicId: v.subTopicId || '',
                            subTopicTitle: v.subTopicTitle || '',
                            minPlan: normalizePlan(v.minPlan || 'free')
                        }))
                    }))
                }));
            }

            portal.notes = notesList;
            portal.notesPdfs = notesList;
        });
    }

    // 4. Zoom Classes (Nepal Time schedule)
    if (!Array.isArray(state.zoomClasses)) {
        state.zoomClasses = JSON.parse(JSON.stringify(DEFAULT_ZOOM_CLASSES));
    } else {
        state.zoomClasses = state.zoomClasses.map((zc, idx) => ({
            id: zc.id || `zc_${idx + 1}`,
            title: String(zc.title || 'Live Zoom Class').trim(),
            classKey: zc.classKey === 'all' ? 'all' : gradeToClassKey(zc.classKey || 'class-12'),
            subject: String(zc.subject || 'Mathematics').trim(),
            teacher: String(zc.teacher || 'Bishnu Prasad Gautam (BPG Sir)').trim(),
            date: String(zc.date || '').trim(),
            startTime: String(zc.startTime || '06:30').trim(),
            durationMinutes: Math.max(10, Math.min(480, Number(zc.durationMinutes) || 60)),
            zoomUrl: String(zc.zoomUrl || '').trim(),
            instructions: String(zc.instructions || '').trim(),
            status: zc.status === 'cancelled' ? 'cancelled' : 'scheduled',
            minPlan: normalizePlan(zc.minPlan || 'free'),
            adminAssignedPlan: zc.adminAssignedPlan !== undefined ? Boolean(zc.adminAssignedPlan) : true,
            updatedAt: zc.updatedAt || new Date().toISOString()
        }));
    }

    // 5. Team Profiles (Row 1: Founder centered; Row 2: CEO, CCO, CTO)
    if (!Array.isArray(state.teamMembers)) {
        state.teamMembers = JSON.parse(JSON.stringify(DEFAULT_TEAM_MEMBERS));
    } else {
        state.teamMembers = state.teamMembers.map((m, idx) => {
            const rawRole = String(m.role || '').trim();
            const roleLower = rawRole.toLowerCase();
            let slot = String(m.slot || '').toLowerCase().trim();
            if (!['founder', 'ceo', 'cco', 'cto', 'member'].includes(slot)) {
                if (roleLower.includes('founder')) slot = 'founder';
                else if (roleLower === 'ceo' || roleLower.includes('chief executive')) slot = 'ceo';
                else if (roleLower === 'cco' || roleLower.includes('chief content') || roleLower.includes('chief curriculum') || roleLower.includes('chief operating')) slot = 'cco';
                else if (roleLower === 'cto' || roleLower.includes('chief technology')) slot = 'cto';
                else slot = 'member';
            }
            return {
                id: m.id || `team_${idx + 1}`,
                slot,
                initial: String(m.initial || (m.name ? m.name.trim().charAt(0).toUpperCase() : 'T')).trim().charAt(0).toUpperCase(),
                name: String(m.name || '').trim(),
                role: slot === 'founder' ? (rawRole || 'Founder') : '',
                photoUrl: String(m.photoUrl || '').trim(),
                bio: ''
            };
        });
    }

    // 6. Homepage Content (all text, buttons, banner, photos editable)
    if (!state.homepageContent || typeof state.homepageContent !== 'object') {
        state.homepageContent = JSON.parse(JSON.stringify(DEFAULT_HOMEPAGE_CONTENT));
    } else {
        state.homepageContent = Object.assign(
            {},
            JSON.parse(JSON.stringify(DEFAULT_HOMEPAGE_CONTENT)),
            state.homepageContent
        );
        if (!Array.isArray(state.homepageContent.featureCards) || state.homepageContent.featureCards.length === 0) {
            state.homepageContent.featureCards = JSON.parse(JSON.stringify(DEFAULT_HOMEPAGE_CONTENT.featureCards));
        }
    }

    // 7. Maintenance Mode
    if (!state.maintenanceMode || typeof state.maintenanceMode !== 'object') {
        state.maintenanceMode = JSON.parse(JSON.stringify(DEFAULT_MAINTENANCE_MODE));
    } else {
        state.maintenanceMode = {
            enabled: Boolean(state.maintenanceMode.enabled),
            title: String(state.maintenanceMode.title || DEFAULT_MAINTENANCE_MODE.title),
            message: String(state.maintenanceMode.message || DEFAULT_MAINTENANCE_MODE.message),
            updatedAt: state.maintenanceMode.updatedAt || ''
        };
    }

    // 8. Site Settings (WhatsApp number, eSewa QR, Google Client ID)
    if (!state.siteSettings || typeof state.siteSettings !== 'object') {
        state.siteSettings = JSON.parse(JSON.stringify(DEFAULT_SITE_SETTINGS));
    } else {
        state.siteSettings = {
            whatsappNumber: String(state.siteSettings.whatsappNumber || DEFAULT_SITE_SETTINGS.whatsappNumber).replace(/[^\d]/g, '') || DEFAULT_SITE_SETTINGS.whatsappNumber,
            esewaQrUrl: String(state.siteSettings.esewaQrUrl || DEFAULT_SITE_SETTINGS.esewaQrUrl).trim(),
            esewaMerchantName: String(state.siteSettings.esewaMerchantName || DEFAULT_SITE_SETTINGS.esewaMerchantName).trim(),
            googleClientId: String(state.siteSettings.googleClientId || process.env.GOOGLE_CLIENT_ID || DEFAULT_SITE_SETTINGS.googleClientId || '').trim()
        };
    }

    // 9. Notifications (Sitewide & Class-specific)
    if (!Array.isArray(state.notifications)) {
        state.notifications = JSON.parse(JSON.stringify(DEFAULT_NOTIFICATIONS));
    } else {
        state.notifications = state.notifications.map((n, idx) => ({
            id: n.id || `notif_${idx + 1}`,
            title: String(n.title || 'Update').trim(),
            body: String(n.body || '').trim(),
            category: String(n.category || 'Announcement').trim(),
            scope: n.scope === 'all' || !n.scope ? 'sitewide' : (n.scope === 'sitewide' ? 'sitewide' : gradeToClassKey(n.scope)),
            published: n.published !== undefined ? Boolean(n.published) : true,
            createdAt: n.createdAt || new Date().toISOString(),
            updatedAt: n.updatedAt || n.createdAt || new Date().toISOString()
        }));
    }

    // 10. Chatbot FAQs (Admin-editable, public knowledge base)
    if (!Array.isArray(state.chatbotFaqs) || state.chatbotFaqs.length === 0) {
        state.chatbotFaqs = JSON.parse(JSON.stringify(DEFAULT_CHATBOT_FAQS));
    } else {
        state.chatbotFaqs = state.chatbotFaqs.map((f, idx) => ({
            id: f.id || `faq_${idx + 1}`,
            question: String(f.question || '').trim(),
            keywords: Array.isArray(f.keywords) ? f.keywords : String(f.keywords || '').split(',').map(s => s.trim()).filter(Boolean),
            answer: String(f.answer || '').trim(),
            links: Array.isArray(f.links) ? f.links : [],
            published: f.published !== undefined ? Boolean(f.published) : true,
            updatedAt: f.updatedAt || new Date().toISOString()
        }));
    }

    // 11. Payments Ledger (Pending / Verified / Rejected)
    if (!Array.isArray(state.payments)) {
        state.payments = [];
    }

    return state;
}

function readAcademyState() {
    if (global.__BPG_ACADEMY_STATE__) {
        return ensureAccessModelDefaults(global.__BPG_ACADEMY_STATE__);
    }
    // Check TMP_DB_PATH first; it only exists when runtime mutations occurred
    const candidates = [TMP_DB_PATH, DB_PATH, LEGACY_CMS_PATH];
    let newestState = null;
    let bestRev = -1;

    for (const filePath of candidates) {
        try {
            if (fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, 'utf8');
                const parsed = JSON.parse(raw);
                if (parsed && parsed.portals) {
                    const rev = Number(parsed.revision) || (filePath === TMP_DB_PATH ? 1 : 0);
                    if (!newestState || rev > bestRev) {
                        newestState = parsed;
                        bestRev = rev;
                    }
                }
            }
        } catch (e) { }
    }

    if (!newestState) {
        newestState = {
            lastUpdated: new Date().toISOString(),
            portals: {
                'class-12': { gradeTitle: 'Grade XII Mathematics', units: [], notes: [] },
                'class-11': { gradeTitle: 'Grade XI Mathematics', units: [], notes: [] },
                'class-10': { gradeTitle: 'Class 10 (SEE Mathematics Foundation)', units: [], notes: [] },
                'after-12': { gradeTitle: 'After 12 Entrance (IOE / CEE / KU)', units: [], notes: [] }
            },
            calendarEvents: []
        };
    }

    delete newestState.adminPasskey;
    ensureAccessModelDefaults(newestState);
    global.__BPG_ACADEMY_STATE__ = newestState;
    return newestState;
}

function resolveRequestUser(req) {
    let token = req.headers['x-session-token'] || '';
    if (!token && req.url) {
        try {
            const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            token = parsed.searchParams.get('token') || '';
        } catch (e) { }
    }
    const verified = verifyStudentSessionToken(token);
    if (verified && verified.email) {
        const account = findAccountByEmail(verified.email);
        if (account) {
            if (account.emailVerified === false) return null;
            return account;
        }
        return {
            email: String(verified.email).trim().toLowerCase(),
            canonicalEmail: verified.canonicalEmail || canonicalizeEmail(verified.email),
            name: verified.name || 'Student',
            grade: normalizeGradeName(verified.grade),
            classKey: gradeToClassKey(verified.grade),
            plan: normalizePlan(verified.plan),
            emailVerified: true,
            verified: true
        };
    }

    const headerEmail = String(req.headers['x-student-email'] || '').trim().toLowerCase();
    if (headerEmail) {
        const fallbackAccount = findAccountByEmail(headerEmail);
        if (fallbackAccount && fallbackAccount.emailVerified !== false) {
            return fallbackAccount;
        }
    }

    return null;
}

function evaluateItemAccess(user, classKey, item, state) {
    // 0. Maintenance Mode blocks all non-admin content access
    if (state?.maintenanceMode?.enabled) {
        return {
            allowed: false,
            status: 503,
            code: 'MAINTENANCE_MODE',
            error: state.maintenanceMode.message || 'Site is currently under maintenance.'
        };
    }

    const normClass = gradeToClassKey(classKey);

    // 1. One-active-class-per-account rule on server
    if (user && user.email && user.classKey) {
        const userClass = gradeToClassKey(user.classKey || user.grade);
        if (normClass !== userClass) {
            return {
                allowed: false,
                status: 403,
                code: 'CLASS_MISMATCH',
                currentClass: userClass,
                requestedClass: normClass,
                error: `Your account is currently enrolled in ${normalizeGradeName(userClass)}. Request a class switch to access ${normalizeGradeName(normClass)}.`
            };
        }
    }

    const lock = state?.sectionLocks?.[normClass] || DEFAULT_SECTION_LOCKS[normClass] || { locked: false };

    // 2. Section locks ALWAYS apply to every plan, including Diamond & legacy
    if (lock.locked) {
        return {
            allowed: false,
            status: 403,
            code: 'SECTION_LOCKED',
            locked: true,
            reason: lock.reason || 'Temporarily unavailable',
            error: lock.reason || 'Temporarily unavailable'
        };
    }

    if (!item) {
        return {
            allowed: false,
            status: 404,
            code: 'NOT_FOUND',
            error: 'Requested content item was not found.'
        };
    }

    const requiredPlan = normalizePlan(item.minPlan || 'free');
    const userPlan = user ? normalizePlan(user.plan || 'free') : 'free';

    // 2. Preserve existing students' legacy access until an admin assigns the item or user plan
    if (user && user.legacyAccess && !user.planExplicitlySet && !item.adminAssignedPlan) {
        return {
            allowed: true,
            status: 200,
            requiredPlan,
            userPlan,
            viaLegacy: true
        };
    }

    // 3. Hierarchical Plan Access: Free < Gold < Diamond
    if (PLAN_RANK[userPlan] >= PLAN_RANK[requiredPlan]) {
        return {
            allowed: true,
            status: 200,
            requiredPlan,
            userPlan
        };
    }

    return {
        allowed: false,
        status: 403,
        code: 'PLAN_REQUIRED',
        requiredPlan,
        userPlan,
        error: 'Level up to unlock this content'
    };
}

function sanitizeStateForStudent(rawState, user) {
    const clone = JSON.parse(JSON.stringify(rawState));
    delete clone.adminPasskey;
    delete clone.mockTests; // Keep mock test answer keys strictly server-side via /api/mock-tests
    delete clone.payments;  // Keep payment ledger strictly admin-side (or /api/payments?me=1)

    // Never expose eSewa QR URL to unauthenticated guests
    if (clone.siteSettings && (!user || !user.email)) {
        delete clone.siteSettings.esewaQrUrl;
    }

    // Filter Notifications: only published, sitewide OR matching user's active class, newest first
    const userClassKey = (user && user.email) ? gradeToClassKey(user.classKey || user.grade) : '';
    if (Array.isArray(clone.notifications)) {
        clone.notifications = clone.notifications
            .filter(n => {
                if (!n.published) return false;
                if (n.scope === 'sitewide') return true;
                return Boolean(userClassKey && n.scope === userClassKey);
            })
            .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    }

    // Filter Chatbot FAQs: only published FAQs
    if (Array.isArray(clone.chatbotFaqs)) {
        clone.chatbotFaqs = clone.chatbotFaqs.filter(f => f.published !== false);
    }

    // If Maintenance Mode is enabled, lock all student portal content, calendar, and Zoom classes
    if (clone.maintenanceMode?.enabled) {
        if (clone.portals) {
            Object.keys(clone.portals).forEach(classKey => {
                const portal = clone.portals[classKey];
                if (!portal) return;
                portal.sectionLocked = true;
                portal.lockReason = clone.maintenanceMode.message || 'Scheduled maintenance';
                portal.units = [];
                portal.notes = [];
                portal.notesPdfs = [];
                portal.syllabusRows = [];
                portal.subjects = [];
            });
        }
        clone.calendarEvents = [];
        clone.zoomClasses = [];
        return clone;
    }

    if (!clone.portals) return clone;

    Object.keys(clone.portals).forEach(classKey => {
        const portal = clone.portals[classKey];
        const lock = clone.sectionLocks?.[classKey] || { locked: false, reason: '' };

        portal.sectionLocked = Boolean(lock.locked);
        portal.lockReason = lock.locked ? (lock.reason || 'Temporarily unavailable') : '';

        // If section is locked, strip full content for every plan including Diamond
        if (lock.locked) {
            portal.units = [];
            portal.notes = [];
            portal.notesPdfs = [];
            portal.syllabusRows = [];
            portal.subjects = [];
            return;
        }

        // Sanitize subjects -> lessons -> pdfs & videos
        portal.subjects = (Array.isArray(portal.subjects) ? portal.subjects : []).map(subj => ({
            id: subj.id,
            name: subj.name,
            lessons: (Array.isArray(subj.lessons) ? subj.lessons : []).map(l => ({
                id: l.id,
                code: l.code || '',
                title: l.title || '',
                hours: l.hours || '',
                marks: l.marks || '',
                subTopics: (Array.isArray(l.subTopics) ? l.subTopics : []).map(st => ({
                    id: st.id,
                    title: st.title || ''
                })),
                pdfs: (Array.isArray(l.pdfs) ? l.pdfs : []).map(pdf => {
                    const check = evaluateItemAccess(user, classKey, pdf, clone);
                    return {
                        id: pdf.id,
                        title: pdf.title || pdf.fileName || 'PDF Document',
                        fileName: pdf.fileName || '',
                        coverImage: pdf.coverImage || '',
                        subTopicId: pdf.subTopicId || '',
                        subTopicTitle: pdf.subTopicTitle || '',
                        minPlan: normalizePlan(pdf.minPlan || 'free'),
                        uploadedAt: pdf.uploadedAt || '',
                        restricted: !check.allowed,
                        hasFile: Boolean(pdf.fileUrl),
                        fileUrl: check.allowed ? (pdf.fileUrl || '') : ''
                    };
                }),
                videos: (Array.isArray(l.videos) ? l.videos : []).map(vid => {
                    const check = evaluateItemAccess(user, classKey, vid, clone);
                    return {
                        id: vid.id,
                        title: vid.title || 'Lesson Video',
                        thumbnailUrl: vid.thumbnailUrl || '',
                        subTopicId: vid.subTopicId || '',
                        subTopicTitle: vid.subTopicTitle || '',
                        minPlan: normalizePlan(vid.minPlan || 'free'),
                        uploadedAt: vid.uploadedAt || '',
                        restricted: !check.allowed,
                        hasVideo: Boolean(vid.videoUrl),
                        videoUrl: check.allowed ? (vid.videoUrl || '') : ''
                    };
                })
            }))
        }));

        // Open section: redact restricted items, strip manualNotes (admin-only), sanitize lesson PDFs
        (portal.units || []).forEach(u => {
            (u.topics || []).forEach(t => {
                const check = evaluateItemAccess(user, classKey, t, clone);
                t.minPlan = normalizePlan(t.minPlan || 'free');
                t.restricted = !check.allowed;
                delete t.manualNotes; // Stored separately for admin; student lesson page is PDF-only
                t.pdfs = (Array.isArray(t.pdfs) ? t.pdfs : []).map(pdf => {
                    const pdfCheck = evaluateItemAccess(user, classKey, pdf, clone);
                    return {
                        id: pdf.id,
                        title: pdf.title || pdf.fileName || 'Lesson PDF',
                        fileName: pdf.fileName || '',
                        fileSize: pdf.fileSize || 'PDF',
                        minPlan: normalizePlan(pdf.minPlan || 'free'),
                        uploadedAt: pdf.uploadedAt || '',
                        restricted: !pdfCheck.allowed,
                        hasFile: Boolean(pdf.fileUrl)
                    };
                });
                if (!check.allowed) {
                    delete t.overview;
                    delete t.definitions;
                    delete t.derivation;
                    delete t.example;
                    delete t.pitfalls;
                    delete t.content;
                    delete t.diagramUrl;
                }
            });
        });

        const cleanNotes = (portal.notes || []).map(n => {
            const check = evaluateItemAccess(user, classKey, n, clone);
            const noteCopy = { ...n, minPlan: normalizePlan(n.minPlan || 'free'), restricted: !check.allowed };
            if (!check.allowed) {
                delete noteCopy.fileUrl;
                delete noteCopy.url;
            }
            return noteCopy;
        });

        portal.notes = cleanNotes;
        portal.notesPdfs = cleanNotes;
    });

    // Also hide calendar events for locked sections from students
    if (Array.isArray(clone.calendarEvents)) {
        clone.calendarEvents = clone.calendarEvents.filter(ev => {
            if (!ev.portal || ev.portal === 'all') return true;
            const lock = clone.sectionLocks?.[ev.portal];
            return !(lock && lock.locked);
        });
    }

    // Sanitize Zoom Classes: sort by date+time, hide locked sections, and ONLY expose zoomUrl to signed-in students with access
    if (Array.isArray(clone.zoomClasses)) {
        clone.zoomClasses = clone.zoomClasses
            .filter(zc => {
                if (!zc.classKey || zc.classKey === 'all') return true;
                const lock = clone.sectionLocks?.[zc.classKey];
                return !(lock && lock.locked);
            })
            .sort((a, b) => {
                const ka = `${a.date || '9999-99-99'} ${a.startTime || '00:00'}`;
                const kb = `${b.date || '9999-99-99'} ${b.startTime || '00:00'}`;
                return ka.localeCompare(kb);
            })
            .map(zc => {
                const copy = { ...zc, minPlan: normalizePlan(zc.minPlan || 'free') };
                const isCancelled = copy.status === 'cancelled';

                if (isCancelled) {
                    copy.zoomUrl = '';
                    copy.canJoin = false;
                    copy.accessReason = 'cancelled';
                    return copy;
                }

                if (!user || !user.email) {
                    copy.zoomUrl = '';
                    copy.canJoin = false;
                    copy.accessReason = 'sign_in';
                    return copy;
                }

                const userClassKey = gradeToClassKey(user.classKey || user.grade);
                if (copy.classKey !== 'all' && userClassKey !== copy.classKey) {
                    copy.zoomUrl = '';
                    copy.canJoin = false;
                    copy.accessReason = 'wrong_class';
                    return copy;
                }

                const check = evaluateItemAccess(
                    user,
                    copy.classKey === 'all' ? userClassKey : copy.classKey,
                    copy,
                    clone
                );

                if (!check.allowed) {
                    copy.zoomUrl = '';
                    copy.canJoin = false;
                    copy.accessReason = check.code === 'SECTION_LOCKED' ? 'section_locked' : 'plan_required';
                    copy.requiredPlan = check.requiredPlan || copy.minPlan;
                    return copy;
                }

                copy.canJoin = Boolean(copy.zoomUrl);
                copy.accessReason = 'allowed';
                return copy;
            });
    }

    return clone;
}

module.exports = {
    ROOT_DIR,
    DATA_DIR,
    DB_PATH,
    LEGACY_CMS_PATH,
    TMP_DB_PATH,
    ROSTER_PATH,
    MASTER_PASSKEY,
    OTP_SECRET,
    PLAN_RANK,
    DEFAULT_SECTION_LOCKS,
    DEFAULT_PLANS_CONFIG,
    DEFAULT_TEAM_MEMBERS,
    DEFAULT_HOMEPAGE_CONTENT,
    DEFAULT_MAINTENANCE_MODE,
    DEFAULT_SITE_SETTINGS,
    DEFAULT_NOTIFICATIONS,
    DEFAULT_CHATBOT_FAQS,
    canonicalizeEmail,
    isValidEmailFormat,
    isDisposableOrFakeEmail,
    hashPassword,
    verifyPassword,
    getOtpStoreEntry,
    setOtpStoreEntry,
    deleteOtpStoreEntry,
    getClientIp,
    checkRateLimit,
    normalizePlan,
    gradeToClassKey,
    normalizeGradeName,
    isAdminPasskeyValid,
    issueStudentSessionToken,
    verifyStudentSessionToken,
    readRoster,
    writeRoster,
    findAccountByEmail,
    ensureAccessModelDefaults,
    readAcademyState,
    resolveRequestUser,
    evaluateItemAccess,
    sanitizeStateForStudent
};
