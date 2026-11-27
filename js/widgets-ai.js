/* BPG Academy — Website Guide, Casio FX-991 Calculator & AI Concept Solver (js/widgets-ai.js) */

/* ==========================================================================
   4. FLOATING MESSENGER-STYLE WEBSITE GUIDE AI ENGINE
   ========================================================================== */
const GUIDE_KNOWLEDGE_BASE = {
    how_to_register: {
        question: "How to register & verify OTP?",
        reply: `
            <p>Registering on <strong>BPG Academy</strong> takes less than 30 seconds:</p>
            <ul>
                <li>Click <strong>Sign In / Register</strong> at the top-right navigation bar and choose <strong>Create Account</strong>.</li>
                <li>Enter your Full Name, select your primary class (Class 11, Class 12, or IOE), accept the Terms &amp; Conditions, and enter your Gmail address.</li>
                <li>Enter the <strong>6-digit OTP verification code</strong> sent to your email (or displayed in the instant local preview box) to unlock your primary class workspace free forever!</li>
            </ul>
        `
    },
    ioe_past_papers: {
        question: "Where to find IOE past papers?",
        reply: `
            <p>All <strong>15-Year IOE Pulchowk, CEE &amp; KU Past Paper Archives</strong> and Casio FX-991 speed-hack notes are located inside the <strong>Entrance</strong> workspace:</p>
            <ul>
                <li>Click <strong>Entrance</strong> in the top navigation bar (or click card <strong>04 — Engineering &amp; Medical Entrance</strong> on the homepage).</li>
                <li>Switch to <strong>Tab 2 (Units &amp; Theory)</strong> for 10-second L'Hôpital, King's integral, and Circle Tangent speed hacks.</li>
                <li>Switch to <strong>Tab 4 (Notes &amp; PDFs)</strong> to view or download the <em>15-Year Solved IOE Pulchowk Mathematics Archive</em> and <em>Casio FX-991 Speed Manual</em>.</li>
            </ul>
        `
    },
    single_class_rule: {
        question: "How does single-class registration work?",
        reply: `
            <p><strong>BPG EDUCARE</strong> offers Class 11, Class 12, and side-by-side IOE (Entrance Prep):</p>
            <ul>
                <li>When you create an account, you select your primary class (Class 11, Class 12, or IOE).</li>
                <li>Class 11 &amp; Class 12 students can also explore <strong>IOE</strong> side-by-side without losing their primary class!</li>
                <li><strong>Padandas (Rs. 1,999/yr):</strong> Full Class 11 or Class 12 access (IOE not included).</li>
                <li><strong>Topper (Rs. 2,999/yr):</strong> Full Class 11/12 access <strong>PLUS full IOE included</strong>.</li>
            </ul>
        `
    },
    who_is_bpg: {
        question: "Who is BPG Sir?",
        reply: `
            <p><strong>Bishnu Prasad Gautam (BPG Sir)</strong> is a distinguished mathematics educator from Pokhara, Nepal, and the founder of <strong>BPG Academy</strong>.</p>
            <ul>
                <li><strong>Academic Distinction:</strong> Master's Degree in Mathematics from Tribhuvan University, Kathmandu with <strong>CGPA 3.9 / 4.0</strong>, <strong>Semester Topper</strong>, and multiple 4.0 GPA semester records.</li>
                <li><strong>Experience:</strong> 12+ years of senior secondary academic leadership and competitive entrance mentorship.</li>
                <li><strong>Philosophy:</strong> <em>"Understand deeply. Think logically. Achieve confidently."</em> Mathematics is about understanding why formulas work, not mechanical drills.</li>
            </ul>
        `
    },
    classes_offered: {
        question: "What classes are offered?",
        reply: `
            <p>BPG EDUCARE offers three focused, structured mathematics programs:</p>
            <ul>
                <li><strong>01 — Grade XII Mathematics (NEB Mat. 102):</strong> Complete board preparation, integration techniques, 3D vectors &amp; skew lines, differential equations.</li>
                <li><strong>02 — Grade XI Mathematics (NEB Mat. 101):</strong> Algebraic foundations, complex numbers, coordinate conics, first-principle calculus.</li>
                <li><strong>03 — IOE (Entrance Prep):</strong> IOE Pulchowk speed hacks, 15-year past papers, and scientific shortcuts — accessible side-by-side and included in the Topper plan.</li>
            </ul>
        `
    },
    single_class_enrollment: {
        question: "What is included with my enrollment?",
        reply: `
            <p>Every student account receives complete, lifetime access to their registered class workspace:</p>
            <ul>
                <li><strong>Syllabus Blueprint:</strong> Official specification grid, teaching hours, and board marks weightage.</li>
                <li><strong>Units &amp; Theory:</strong> Master-detail KaTeX reader with step-proofs and Red-Pen Examiner Traps.</li>
                <li><strong>Live Zoom Calendar:</strong> Direct access to scheduled morning and evening live lectures with BPG Sir.</li>
                <li><strong>Notes &amp; PDFs:</strong> Downloadable cheat sheets, model solutions, and past paper archives.</li>
            </ul>
        `
    },
    free_notes: {
        question: "How do I access free notes & theory?",
        reply: `
            <p>Every registered student gets immediate access to their verified primary class:</p>
            <ul>
                <li>Tap into your class portal (e.g., <strong>Class 11</strong> or <strong>Class 12</strong>).</li>
                <li>Click the <strong>Units & Theory</strong> tab for interactive textbook chapters featuring rigorous proofs and <em>Red-Pen Common Traps</em>.</li>
                <li>Click the <strong>Notes & PDFs</strong> tab to preview and download curated formula sheets, board question banks, and lecture summaries.</li>
            </ul>
        `
    },
    live_zoom: {
        question: "How do live Zoom classes work?",
        reply: `
            <p>Live interactive classes are conducted directly via Zoom:</p>
            <ul>
                <li><strong>Free Open Masterclasses:</strong> Every Friday and Saturday morning (6:30 AM – 7:45 AM NPT for Class 11/12, 4:00 PM for SEE).</li>
                <li><strong>Paid Ranker Batches:</strong> Daily 6:30 AM distinction batches with in-depth problem-solving clinics.</li>
                <li>Access the <strong>Live Class Calendar</strong> tab in your workspace for direct meeting links, meeting IDs, and passcodes.</li>
            </ul>
        `
    },
    katex_notation: {
        question: "What is the KaTeX Math Formula notation?",
        reply: `
            <p>All mathematical expressions on this platform are rendered with sub-millisecond precision using <strong>KaTeX</strong> (LaTeX engine):</p>
            <ul>
                <li>Calculus limit: $$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$$</li>
                <li>Definite integral: $$\\int_{0}^{\\pi} \\sin^2(x)\\,dx = \\frac{\\pi}{2}$$</li>
                <li>Shortest distance between skew lines: $$d = \\frac{|(\\vec{a}_2 - \\vec{a}_1) \\cdot (\\vec{b}_1 \\times \\vec{b}_2)|}{|\\vec{b}_1 \\times \\vec{b}_2|}$$</li>
            </ul>
            <p>Formulas are sharp, scalable, and responsive on all devices.</p>
        `
    },
    class_switch_rule: {
        question: "Can I switch or change my registered class?",
        reply: `
            <p>Under BPG Academy's dedicated architecture, an account is tied exclusively to the selected class.</p>
            <p>If you wish to study a different class (e.g. you are in Class 11 and want to study Class 12 or Entrance), simply register a new student account using another email address.</p>
        `
    },
    contact_bpg: {
        question: "How do I contact BPG Sir directly?",
        reply: `
            <p>You can contact <strong>Bishnu Prasad Gautam (BPG Sir)</strong> directly for academic guidance or enrollment assistance:</p>
            <ul>
                <li><strong>WhatsApp Direct:</strong> <a href="https://wa.me/9779866064252?text=Namaste%20BPG%20Sir%2C%20I%20have%20an%20inquiry%20regarding%20BPG%20EDUCARE" target="_blank" rel="noopener" style="color:var(--accent-emerald); font-weight:700;">+977 9866064252</a></li>
                <li><strong>Physical Location:</strong> Pokhara, Nepal</li>
                <li><strong>Email:</strong> <code>info@bpgmaths.edu.np</code></li>
            </ul>
        `
    }
};

function toggleWebsiteGuide() {
    const win = document.getElementById('siteGuideWindow');
    if (!win) return;
    const isOpen = win.classList.contains('open');
    if (isOpen) {
        win.classList.remove('open');
        win.setAttribute('aria-hidden', 'true');
    } else {
        win.classList.add('open');
        win.setAttribute('aria-hidden', 'false');
        renderMathInGuide();
        const stream = document.getElementById('guideChatStream');
        if (stream) stream.scrollTop = stream.scrollHeight;
        setTimeout(() => document.getElementById('aiQueryInput')?.focus(), 80);
    }
}

function closeWebsiteGuide() {
    const win = document.getElementById('siteGuideWindow');
    if (win) {
        win.classList.remove('open');
        win.setAttribute('aria-hidden', 'true');
    }
}

function askGuideQuestion(qKey) {
    const data = GUIDE_KNOWLEDGE_BASE[qKey];
    if (!data) return;
    const stream = document.getElementById('guideChatStream');
    const typing = document.getElementById('guideTypingIndicator');
    if (!stream) return;

    // 1. Append User Message
    const userDiv = document.createElement('div');
    userDiv.className = 'guide-msg user-msg';
    userDiv.innerHTML = `
        <div class="guide-msg-avatar"><i class="fa-solid fa-user"></i></div>
        <div class="guide-msg-content"><p>${data.question}</p></div>
    `;
    stream.appendChild(userDiv);
    stream.scrollTop = stream.scrollHeight;

    // 2. Show Typing Indicator
    if (typing) {
        typing.style.display = 'flex';
        stream.appendChild(typing);
        stream.scrollTop = stream.scrollHeight;
    }

    // 3. Render Bot Response after brief delay
    setTimeout(() => {
        if (typing) typing.style.display = 'none';

        const botDiv = document.createElement('div');
        botDiv.className = 'guide-msg bot-msg';
        botDiv.innerHTML = `
            <div class="guide-msg-avatar"><i class="fa-solid fa-graduation-cap"></i></div>
            <div class="guide-msg-content">${data.reply}</div>
        `;
        stream.appendChild(botDiv);

        renderMathInGuide();
        stream.scrollTop = stream.scrollHeight;
    }, 380);
}

function renderMathInGuide() {
    const stream = document.getElementById('guideChatStream');
    if (stream && window.renderMathInElement) {
        try {
            renderMathInElement(stream, {
                delimiters: [
                    { left: "$$", right: "$$", display: true },
                    { left: "$", right: "$", display: false },
                    { left: "\\(", right: "\\)", display: false },
                    { left: "\\[", right: "\\]", display: true }
                ],
                throwOnError: false
            });
        } catch (e) {}
    }
}

// Aliases for backward compatibility
function toggleKaTexGuideModal() { toggleWebsiteGuide(); }
function handleKaTexGuideChip(chipKey) { askGuideQuestion(chipKey); }

// Windows 11-Style Standard & Scientific Calculator (PEMDAS/BODMAS, DEG/RAD/GRAD, 2nd, Memory MC/MR/M+/M-/MS, History, Keyboard Input)
const BPG_CALC_ANGLE_STORAGE_KEY = 'bpg_calc_angle_mode_v1';
const BPG_CALC_MODE_STORAGE_KEY = 'bpg_calc_mode_v1';
let miniCalcExpr = '';
let miniCalcAngleMode = (() => {
    try {
        const saved = localStorage.getItem(BPG_CALC_ANGLE_STORAGE_KEY);
        return ['DEG', 'RAD', 'GRAD'].includes(saved) ? saved : 'DEG';
    } catch (e) {
        return 'DEG';
    }
})();
let miniCalcMode = (() => {
    try {
        const saved = localStorage.getItem(BPG_CALC_MODE_STORAGE_KEY);
        return saved === 'scientific' ? 'scientific' : 'basic';
    } catch (e) {
        return 'basic';
    }
})();
let miniCalcLastAns = 0;
let miniCalcMemory = 0;
let miniCalcHasMemory = false;
let miniCalcSecondFn = false;
let miniCalcHistory = [];
let miniCalcJustEvaluated = false;
let miniCalcHasError = false;

const CALC_MULTI_CHAR_TOKENS = [
    'sin⁻¹(', 'cos⁻¹(', 'tan⁻¹(',
    'asin(', 'acos(', 'atan(',
    'log₁₀(', 'log10(', 'log2(', 'log₂(', 'cbrt(', '³√(', 'sqrt(',
    'sin(', 'cos(', 'tan(', 'log(', 'ln(', 'abs(', '√(', ' mod '
];

function formatBpgCalcNumber(val) {
    if (typeof val !== 'number' || Number.isNaN(val)) return 'Error';
    if (!Number.isFinite(val)) return 'Undefined';
    if (Math.abs(val) < 1e-12) return '0';
    // Clean floating-point noise like 0.30000000000000004 or 0.49999999999999994
    const clean = Number(val.toPrecision(12));
    if (Math.abs(clean - Math.round(clean)) < 1e-11 && Math.abs(clean) < 1e15) {
        return String(Math.round(clean));
    }
    return String(clean);
}

/**
 * Pure recursive-descent mathematical expression evaluator.
 * Supports exact operator precedence (+,- < *,/ < unary - < right-associative ^ < postfix %,°,!),
 * implicit multiplication (2(3+4), (2+3)(4+1), 2π, 2sin(30), 2√81),
 * √81 and √(81), 2³ and 2^3, log₁₀(100), ln(e), trig & inverse trig in DEG/RAD, and explicit °.
 */
function evaluateBpgMathExpression(rawInput, angleMode = 'DEG') {
    const up = String(angleMode || 'DEG').toUpperCase();
    const mode = up === 'RAD' ? 'RAD' : (up === 'GRAD' ? 'GRAD' : 'DEG');
    const src = String(rawInput || '').trim();
    if (!src) {
        const err = new Error('Enter an expression to calculate.');
        err.code = 'EMPTY';
        throw err;
    }

    // 1. Normalize Unicode math operators & superscripts into canonical tokens
    const normalized = src
        .replace(/\u2212|\u2013|\u2014/g, '-')
        .replace(/[×·✕]/g, '*')
        .replace(/÷/g, '/')
        .replace(/³√/g, 'cbrt')
        .replace(/log₁₀/gi, 'log10')
        .replace(/log₂/gi, 'log2')
        .replace(/sin⁻¹/gi, 'asin')
        .replace(/cos⁻¹/gi, 'acos')
        .replace(/tan⁻¹/gi, 'atan')
        .replace(/²/g, '^2')
        .replace(/³/g, '^3');

    // 2. Tokenize
    const rawTokens = [];
    let i = 0;
    const len = normalized.length;

    while (i < len) {
        const ch = normalized[i];
        if (/\s/.test(ch)) {
            i++;
            continue;
        }

        // Number literal (supports decimals and scientific notation like 1.5e-4)
        if (/[0-9.]/.test(ch)) {
            const start = i;
            let dotCount = 0;
            while (i < len && /[0-9.]/.test(normalized[i])) {
                if (normalized[i] === '.') dotCount++;
                i++;
            }
            const numCore = normalized.slice(start, i);
            if (dotCount > 1 || numCore === '.') {
                const err = new Error('Invalid decimal number.');
                err.code = 'SYNTAX';
                throw err;
            }
            // Optional scientific exponent (e.g. 1e-5, 2.5E+3) — only when followed by digit or +/- digit
            if (i < len && (normalized[i] === 'e' || normalized[i] === 'E')) {
                const expMatch = normalized.slice(i).match(/^[eE][+-]?\d+/);
                if (expMatch) {
                    i += expMatch[0].length;
                }
            }
            const value = Number(normalized.slice(start, i));
            if (Number.isNaN(value)) {
                const err = new Error('Invalid number format.');
                err.code = 'SYNTAX';
                throw err;
            }
            rawTokens.push({ type: 'NUMBER', value });
            continue;
        }

        // Unicode π and √
        if (ch === 'π') {
            rawTokens.push({ type: 'CONST', name: 'pi', value: Math.PI });
            i++;
            continue;
        }
        if (ch === '√') {
            rawTokens.push({ type: 'FUNC', name: 'sqrt' });
            i++;
            continue;
        }

        // Single-char operators & parens
        if ('+-*/^'.includes(ch)) {
            rawTokens.push({ type: 'OP', value: ch });
            i++;
            continue;
        }
        if (ch === '(') {
            rawTokens.push({ type: 'LPAREN', value: '(' });
            i++;
            continue;
        }
        if (ch === ')') {
            rawTokens.push({ type: 'RPAREN', value: ')' });
            i++;
            continue;
        }
        if (ch === '%' || ch === '°' || ch === '!') {
            rawTokens.push({ type: 'POSTFIX', value: ch });
            i++;
            continue;
        }

        // Identifiers (sin, cos, tan, asin, acos, atan, log, log10, ln, sqrt, abs, pi, e)
        if (/[a-zA-Z]/.test(ch)) {
            const start = i;
            while (i < len && /[a-zA-Z0-9]/.test(normalized[i])) i++;
            const ident = normalized.slice(start, i).toLowerCase();
            if (ident === 'pi') {
                rawTokens.push({ type: 'CONST', name: 'pi', value: Math.PI });
            } else if (ident === 'e') {
                rawTokens.push({ type: 'CONST', name: 'e', value: Math.E });
            } else if (ident === 'mod') {
                rawTokens.push({ type: 'OP', value: 'mod' });
            } else if (['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'log', 'log10', 'log2', 'ln', 'sqrt', 'cbrt', 'abs'].includes(ident)) {
                rawTokens.push({ type: 'FUNC', name: ident === 'log10' ? 'log' : ident });
            } else {
                const err = new Error('Invalid input');
                err.code = 'SYNTAX';
                throw err;
            }
            continue;
        }

        const err = new Error(`Unexpected character "${ch}".`);
        err.code = 'SYNTAX';
        throw err;
    }

    // 3. Insert implicit multiplication tokens (e.g. 2(3+4), (2+3)(4+1), 2π, 2sin(30), 2√81)
    const tokens = [];
    for (let t = 0; t < rawTokens.length; t++) {
        const cur = rawTokens[t];
        if (t > 0) {
            const prev = rawTokens[t - 1];
            const prevEndsValue = prev.type === 'NUMBER' || prev.type === 'CONST' || prev.type === 'RPAREN' || prev.type === 'POSTFIX';
            const curStartsValue = cur.type === 'LPAREN' || cur.type === 'CONST' || cur.type === 'FUNC' || cur.type === 'NUMBER';
            if (prevEndsValue && curStartsValue) {
                tokens.push({ type: 'OP', value: '*' });
            }
        }
        tokens.push(cur);
    }

    // 4. Recursive-descent parser
    let pos = 0;
    const peek = () => tokens[pos] || null;
    const consume = () => tokens[pos++] || null;

    function parseAddSub() {
        let left = parseMulDiv();
        while (peek() && peek().type === 'OP' && (peek().value === '+' || peek().value === '-')) {
            const op = consume().value;
            const right = parseMulDiv();
            left = op === '+' ? left + right : left - right;
        }
        return left;
    }

    function parseMulDiv() {
        let left = parseUnary();
        while (peek() && peek().type === 'OP' && (peek().value === '*' || peek().value === '/' || peek().value === 'mod')) {
            const op = consume().value;
            const right = parseUnary();
            if (op === '/' || op === 'mod') {
                if (right === 0) {
                    const err = new Error('Cannot divide by zero');
                    err.code = 'DIV_ZERO';
                    throw err;
                }
                left = op === 'mod' ? (left % right) : (left / right);
            } else {
                left = left * right;
            }
        }
        return left;
    }

    function parseUnary() {
        const tok = peek();
        if (tok && tok.type === 'OP' && (tok.value === '+' || tok.value === '-')) {
            consume();
            const val = parseUnary();
            return tok.value === '-' ? -val : val;
        }
        return parsePower();
    }

    function parsePower() {
        let base = parsePostfix();
        if (peek() && peek().type === 'OP' && peek().value === '^') {
            consume();
            const exp = parseUnary(); // Right-associative & allows 2^-3
            const res = Math.pow(base, exp);
            if (Number.isNaN(res)) {
                const err = new Error('Domain error — invalid power operation.');
                err.code = 'DOMAIN';
                throw err;
            }
            if (!Number.isFinite(res)) {
                const err = new Error('Result overflow or division by zero.');
                err.code = 'DIV_ZERO';
                throw err;
            }
            return res;
        }
        return base;
    }

    function parsePostfix() {
        let val = parsePrimary();
        while (peek() && peek().type === 'POSTFIX') {
            const sym = consume().value;
            if (sym === '%') {
                val = val / 100;
            } else if (sym === '°') {
                // In DEG mode, trig already expects degrees; in RAD mode, convert explicit degrees to radians
                if (mode === 'RAD') {
                    val = val * (Math.PI / 180);
                }
            } else if (sym === '!') {
                if (val < 0 || !Number.isInteger(val) || val > 170) {
                    const err = new Error('Factorial requires a whole number from 0 to 170.');
                    err.code = 'DOMAIN';
                    throw err;
                }
                let f = 1;
                for (let k = 2; k <= val; k++) f *= k;
                val = f;
            }
        }
        return val;
    }

    function applyFunction(name, arg) {
        const toRad = (v) => mode === 'DEG' ? (v * Math.PI / 180) : (mode === 'GRAD' ? (v * Math.PI / 200) : v);
        const fromRad = (v) => mode === 'DEG' ? (v * 180 / Math.PI) : (mode === 'GRAD' ? (v * 200 / Math.PI) : v);

        switch (name) {
            case 'sin':
                return Math.sin(toRad(arg));
            case 'cos':
                return Math.cos(toRad(arg));
            case 'tan': {
                const rad = toRad(arg);
                if (Math.abs(Math.cos(rad)) < 1e-12) {
                    const err = new Error('Invalid input');
                    err.code = 'ASYMPTOTE';
                    throw err;
                }
                return Math.tan(rad);
            }
            case 'asin': {
                if (arg < -1 || arg > 1) {
                    const err = new Error('Invalid input');
                    err.code = 'DOMAIN';
                    throw err;
                }
                return fromRad(Math.asin(arg));
            }
            case 'acos': {
                if (arg < -1 || arg > 1) {
                    const err = new Error('Invalid input');
                    err.code = 'DOMAIN';
                    throw err;
                }
                return fromRad(Math.acos(arg));
            }
            case 'atan':
                return fromRad(Math.atan(arg));
            case 'log': {
                if (arg <= 0) {
                    const err = new Error('Invalid input');
                    err.code = 'DOMAIN';
                    throw err;
                }
                return Math.log10(arg);
            }
            case 'log2': {
                if (arg <= 0) {
                    const err = new Error('Invalid input');
                    err.code = 'DOMAIN';
                    throw err;
                }
                return Math.log2(arg);
            }
            case 'ln': {
                if (arg <= 0) {
                    const err = new Error('Invalid input');
                    err.code = 'DOMAIN';
                    throw err;
                }
                return Math.log(arg);
            }
            case 'sqrt': {
                if (arg < 0) {
                    const err = new Error('Invalid input');
                    err.code = 'DOMAIN';
                    throw err;
                }
                return Math.sqrt(arg);
            }
            case 'cbrt':
                return Math.cbrt(arg);
            case 'abs':
                return Math.abs(arg);
            default: {
                const err = new Error('Invalid input');
                err.code = 'SYNTAX';
                throw err;
            }
        }
    }

    function parsePrimary() {
        const tok = peek();
        if (!tok) {
            const err = new Error('Incomplete expression — finish entering your calculation.');
            err.code = 'INCOMPLETE';
            throw err;
        }

        if (tok.type === 'NUMBER' || tok.type === 'CONST') {
            consume();
            return tok.value;
        }

        if (tok.type === 'LPAREN') {
            consume();
            if (peek() && peek().type === 'RPAREN') {
                const err = new Error('Empty parentheses () — enter a number inside.');
                err.code = 'INCOMPLETE';
                throw err;
            }
            const inner = parseAddSub();
            if (!peek() || peek().type !== 'RPAREN') {
                const err = new Error('Incomplete expression — missing closing parenthesis ")".');
                err.code = 'INCOMPLETE';
                throw err;
            }
            consume();
            return inner;
        }

        if (tok.type === 'FUNC') {
            const fnName = consume().name;
            if (peek() && peek().type === 'LPAREN') {
                consume();
                if (peek() && peek().type === 'RPAREN') {
                    const err = new Error(`Incomplete expression — enter a value inside ${fnName}().`);
                    err.code = 'INCOMPLETE';
                    throw err;
                }
                const arg = parseAddSub();
                if (!peek() || peek().type !== 'RPAREN') {
                    const err = new Error(`Incomplete expression — close parenthesis for ${fnName}().`);
                    err.code = 'INCOMPLETE';
                    throw err;
                }
                consume();
                return applyFunction(fnName, arg);
            }
            // Allow prefix shorthand like √81, √-4, sin30°
            if (!peek()) {
                const err = new Error(`Incomplete expression — enter a number after ${fnName === 'sqrt' ? '√' : fnName}.`);
                err.code = 'INCOMPLETE';
                throw err;
            }
            const arg = parseUnary();
            return applyFunction(fnName, arg);
        }

        if (tok.type === 'RPAREN') {
            const err = new Error('Unexpected ")" — check parentheses.');
            err.code = 'SYNTAX';
            throw err;
        }

        const err = new Error('Invalid expression — check operators or syntax.');
        err.code = 'SYNTAX';
        throw err;
    }

    const result = parseAddSub();
    if (pos < tokens.length) {
        const extra = tokens[pos];
        const err = new Error(extra.type === 'RPAREN'
            ? 'Unmatched closing parenthesis ")".'
            : 'Invalid expression — unexpected input at end.');
        err.code = 'SYNTAX';
        throw err;
    }

    if (typeof result !== 'number' || Number.isNaN(result)) {
        const err = new Error('Invalid mathematical result.');
        err.code = 'SYNTAX';
        throw err;
    }
    if (!Number.isFinite(result)) {
        const err = new Error('Cannot divide by zero.');
        err.code = 'DIV_ZERO';
        throw err;
    }

    const formatted = formatBpgCalcNumber(result);
    return { value: Number(formatted), formatted };
}

window.evaluateBpgMathExpression = evaluateBpgMathExpression;

function toggleMiniCalculator() {
    if (typeof isMaintenanceModeActive === 'function' && isMaintenanceModeActive()) {
        if (typeof showMaintenanceLockNotice === 'function') showMaintenanceLockNotice();
        return;
    }
    const flyout = document.getElementById('calcFlyoutWindow');
    if (!flyout) return;
    flyout.classList.toggle('open');
    if (flyout.classList.contains('open')) {
        setCalculatorMode(miniCalcMode);
        syncMiniCalcAngleUI();
        updateMiniCalcDisplay();
        renderMiniCalcHistory();
    }
}

function setCalculatorMode(mode) {
    miniCalcMode = mode === 'scientific' ? 'scientific' : 'basic';
    try { localStorage.setItem(BPG_CALC_MODE_STORAGE_KEY, miniCalcMode); } catch (e) {}
    const sciRow = document.getElementById('calcSciKeypad');
    const basicBtn = document.getElementById('calcModeBasicBtn');
    const sciBtn = document.getElementById('calcModeSciBtn');
    const titleEl = document.getElementById('calcModeTitleLabel');
    const flyout = document.getElementById('calcFlyoutWindow');
    if (sciRow) sciRow.style.display = miniCalcMode === 'scientific' ? 'grid' : 'none';
    if (basicBtn) basicBtn.classList.toggle('active', miniCalcMode === 'basic');
    if (sciBtn) sciBtn.classList.toggle('active', miniCalcMode === 'scientific');
    if (titleEl) titleEl.textContent = miniCalcMode === 'scientific' ? 'Scientific' : 'Standard';
    if (flyout) flyout.classList.toggle('is-scientific', miniCalcMode === 'scientific');
    syncMiniCalcAngleUI();
    syncCalcMemoryUI();
    if (!miniCalcJustEvaluated && !miniCalcHasError) {
        updateMiniCalcStatusLine();
    }
}

function syncMiniCalcAngleUI() {
    const btn = document.getElementById('calcAngleToggleBtn');
    const badge = document.getElementById('calcActiveAngleBadge');
    const titles = { DEG: 'Degrees (click for RAD)', RAD: 'Radians (click for GRAD)', GRAD: 'Gradians (click for DEG)' };
    [btn, badge].forEach(el => {
        if (!el) return;
        el.textContent = miniCalcAngleMode;
        el.classList.toggle('mode-deg', miniCalcAngleMode === 'DEG');
        el.classList.toggle('mode-rad', miniCalcAngleMode === 'RAD');
        el.classList.toggle('mode-grad', miniCalcAngleMode === 'GRAD');
        el.setAttribute('title', titles[miniCalcAngleMode] || 'Angle mode');
    });
}

function toggleMiniCalcAngle() {
    const order = ['DEG', 'RAD', 'GRAD'];
    const idx = order.indexOf(miniCalcAngleMode);
    miniCalcAngleMode = order[(idx + 1) % order.length];
    try { localStorage.setItem(BPG_CALC_ANGLE_STORAGE_KEY, miniCalcAngleMode); } catch (e) {}
    syncMiniCalcAngleUI();
    if (!miniCalcJustEvaluated && !miniCalcHasError) {
        updateMiniCalcStatusLine();
    }
}

function setMiniCalcAngleMode(mode) {
    const up = String(mode || 'DEG').toUpperCase();
    miniCalcAngleMode = ['DEG', 'RAD', 'GRAD'].includes(up) ? up : 'DEG';
    try { localStorage.setItem(BPG_CALC_ANGLE_STORAGE_KEY, miniCalcAngleMode); } catch (e) {}
    syncMiniCalcAngleUI();
    if (!miniCalcJustEvaluated && !miniCalcHasError) {
        updateMiniCalcStatusLine();
    }
}

function syncCalcMemoryUI() {
    const mc = document.getElementById('calcBtnMC');
    const mr = document.getElementById('calcBtnMR');
    const ind = document.getElementById('calcMemoryIndicator');
    if (mc) mc.disabled = !miniCalcHasMemory;
    if (mr) mr.disabled = !miniCalcHasMemory;
    if (ind) {
        ind.style.display = miniCalcHasMemory ? 'inline-flex' : 'none';
        ind.title = `Memory: ${formatBpgCalcNumber(miniCalcMemory)}`;
    }
}

function getCalcCurrentNumericValue() {
    if (!miniCalcExpr || !miniCalcExpr.trim()) return 0;
    try {
        return evaluateBpgMathExpression(miniCalcExpr, miniCalcAngleMode).value;
    } catch (e) {
        return miniCalcLastAns || 0;
    }
}

function calcMemoryClear() {
    miniCalcMemory = 0;
    miniCalcHasMemory = false;
    syncCalcMemoryUI();
}
function calcMemoryRecall() {
    if (!miniCalcHasMemory) return;
    showMiniCalcError('');
    miniCalcHasError = false;
    const valStr = formatBpgCalcNumber(miniCalcMemory);
    if (miniCalcJustEvaluated || !miniCalcExpr) {
        miniCalcExpr = valStr;
        miniCalcJustEvaluated = false;
    } else {
        miniCalcExpr += valStr;
    }
    updateMiniCalcDisplay();
}
function calcMemoryStore() {
    miniCalcMemory = getCalcCurrentNumericValue();
    miniCalcHasMemory = true;
    miniCalcJustEvaluated = true;
    syncCalcMemoryUI();
}
function calcMemoryAdd() {
    miniCalcMemory += getCalcCurrentNumericValue();
    miniCalcHasMemory = true;
    miniCalcJustEvaluated = true;
    syncCalcMemoryUI();
}
function calcMemorySub() {
    miniCalcMemory -= getCalcCurrentNumericValue();
    miniCalcHasMemory = true;
    miniCalcJustEvaluated = true;
    syncCalcMemoryUI();
}

function toggleCalcSecondFn() {
    miniCalcSecondFn = !miniCalcSecondFn;
    const btn = document.getElementById('calcBtn2nd');
    if (btn) btn.classList.toggle('is-active-2nd', miniCalcSecondFn);
    const setLbl = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    setLbl('calcSciSin', miniCalcSecondFn ? 'sin<sup>&minus;1</sup>' : 'sin');
    setLbl('calcSciCos', miniCalcSecondFn ? 'cos<sup>&minus;1</sup>' : 'cos');
    setLbl('calcSciTan', miniCalcSecondFn ? 'tan<sup>&minus;1</sup>' : 'tan');
    setLbl('calcSciLog', miniCalcSecondFn ? 'log<sub>2</sub>' : 'log');
    setLbl('calcSci10x', miniCalcSecondFn ? '2<sup>x</sup>' : '10<sup>x</sup>');
}

function calcTriggerSci(kind) {
    if (kind === 'sin') calcAppend(miniCalcSecondFn ? 'sin⁻¹(' : 'sin(');
    else if (kind === 'cos') calcAppend(miniCalcSecondFn ? 'cos⁻¹(' : 'cos(');
    else if (kind === 'tan') calcAppend(miniCalcSecondFn ? 'tan⁻¹(' : 'tan(');
    else if (kind === 'log') calcAppend(miniCalcSecondFn ? 'log₂(' : 'log₁₀(');
    else if (kind === 'ln') calcAppend('ln(');
    else if (kind === 'pow') calcAppend('^');
    else if (kind === 'tenx') calcAppend(miniCalcSecondFn ? '2^(' : '10^(');
    else if (kind === 'ex') calcAppend('e^(');
    else if (kind === 'cube') calcAppend('³');
    else if (kind === 'cbrt') calcAppend('³√(');
}

function calcClearEntry() {
    showMiniCalcError('');
    miniCalcHasError = false;
    if (miniCalcJustEvaluated || !miniCalcExpr) {
        calcClear();
        return;
    }
    // Remove only the last number/token segment
    const stripped = miniCalcExpr.replace(/([0-9.]+|[a-zA-Zπ√³¹⁰⁻]+\(?|\s+mod\s+)$/, '');
    miniCalcExpr = stripped;
    updateMiniCalcDisplay(miniCalcExpr || '0');
}

function calcReciprocal() {
    if (!miniCalcExpr) {
        calcAppend('1÷(');
        return;
    }
    if (miniCalcJustEvaluated || /^[−-]?\d+(\.\d+)?$/.test(miniCalcExpr.trim())) {
        miniCalcExpr = `1÷(${miniCalcExpr})`;
        calcEvaluate();
    } else {
        calcAppend('1÷(');
    }
}

function calcSquareRoot() {
    if (miniCalcJustEvaluated && miniCalcExpr) {
        miniCalcExpr = `√(${miniCalcExpr})`;
        calcEvaluate();
    } else {
        calcAppend('√(');
    }
}

function updateMiniCalcStatusLine(overrideExpr) {
    const hist = document.getElementById('calcHistoryLine');
    if (!hist) return;
    if (overrideExpr !== undefined) {
        hist.textContent = overrideExpr;
        return;
    }
    hist.textContent = '';
}

function showMiniCalcError(msg) {
    const errEl = document.getElementById('calcErrorLine');
    if (!errEl) return;
    if (!msg) {
        errEl.style.display = 'none';
        errEl.textContent = '';
    } else {
        errEl.textContent = msg;
        errEl.style.display = 'block';
    }
}

function toggleMiniCalcHistory() {
    const drawer = document.getElementById('calcHistoryDrawer');
    const btn = document.getElementById('calcHistoryToggleBtn');
    if (!drawer) return;
    const nextOpen = drawer.style.display === 'none';
    drawer.style.display = nextOpen ? 'block' : 'none';
    if (btn) btn.classList.toggle('active', nextOpen);
    if (nextOpen) renderMiniCalcHistory();
}

function renderMiniCalcHistory() {
    const list = document.getElementById('calcHistoryList');
    if (!list) return;
    if (miniCalcHistory.length === 0) {
        list.innerHTML = `<div class="calc-history-empty">No calculations yet.</div>`;
        return;
    }
    list.innerHTML = miniCalcHistory.map((item, idx) => `
        <button type="button" class="calc-history-item" onclick="reuseMiniCalcHistory(${idx})" title="Click to reuse result">
            <span class="calc-hist-expr">${String(item.expr).replace(/</g, '&lt;')} =</span>
            <strong class="calc-hist-res">${String(item.result).replace(/</g, '&lt;')}</strong>
        </button>
    `).join('');
}

function reuseMiniCalcHistory(idx) {
    const item = miniCalcHistory[idx];
    if (!item) return;
    miniCalcHasError = false;
    miniCalcJustEvaluated = false;
    showMiniCalcError('');
    miniCalcExpr = String(item.result);
    updateMiniCalcDisplay(miniCalcExpr);
}

function clearMiniCalcHistory() {
    miniCalcHistory = [];
    renderMiniCalcHistory();
}

function calcUseLastAns() {
    showMiniCalcError('');
    miniCalcHasError = false;
    if (miniCalcJustEvaluated) {
        miniCalcExpr = '';
        miniCalcJustEvaluated = false;
    }
    miniCalcExpr += String(miniCalcLastAns);
    updateMiniCalcDisplay();
}

function calcAppend(val) {
    if (val === undefined || val === null) return;
    let token = String(val);

    // Map ASCII shorthand into clean math symbols for display
    if (token === '*') token = '×';
    else if (token === '/') token = '÷';
    else if (token === '-') token = '−';
    else if (token === 'pi') token = 'π';
    else if (token === 'sqrt(') token = '√(';
    else if (token === 'log(') token = 'log₁₀(';
    else if (token === '^2') token = '²';
    else if (token === '^3') token = '³';

    const isBinaryOrPostfix = ['+', '−', '×', '÷', '^', '²', '³', '%', '°', '!'].includes(token);

    if (miniCalcHasError) {
        showMiniCalcError('');
        miniCalcHasError = false;
        // Let the user continue fixing the expression in-place (or start fresh on Clear)
    }

    if (miniCalcJustEvaluated) {
        if (!isBinaryOrPostfix) {
            miniCalcExpr = '';
            updateMiniCalcStatusLine();
        } else {
            updateMiniCalcStatusLine();
        }
        miniCalcJustEvaluated = false;
    }

    // Prevent two decimals in the same number segment (e.g. 3.1.2)
    if (token === '.') {
        const lastNumMatch = miniCalcExpr.match(/[0-9.]+$/);
        if (lastNumMatch && lastNumMatch[0].includes('.')) {
            return;
        }
        if (!lastNumMatch) {
            token = '0.';
        }
    }

    // If starting with binary operator on empty screen (except minus), prepend 0
    if (!miniCalcExpr && ['+', '×', '÷', '^', '²', '³', '%'].includes(token)) {
        miniCalcExpr = '0';
    }

    miniCalcExpr += token;
    updateMiniCalcDisplay();
}

function calcToggleSign() {
    showMiniCalcError('');
    miniCalcHasError = false;
    miniCalcJustEvaluated = false;

    if (!miniCalcExpr) {
        miniCalcExpr = '−';
        updateMiniCalcDisplay();
        return;
    }
    // If the entire expression is a single signed/unsigned number, toggle its leading minus
    if (/^[−-]?\d+(\.\d+)?$/.test(miniCalcExpr)) {
        miniCalcExpr = (miniCalcExpr.startsWith('−') || miniCalcExpr.startsWith('-'))
            ? miniCalcExpr.slice(1)
            : `−${miniCalcExpr}`;
        updateMiniCalcDisplay();
        return;
    }
    // If ending with "(−number)", unwrap back to "number"
    const wrappedNeg = miniCalcExpr.match(/\(−(\d+(?:\.\d+)?)\)$/);
    if (wrappedNeg) {
        miniCalcExpr = miniCalcExpr.slice(0, -wrappedNeg[0].length) + wrappedNeg[1];
        updateMiniCalcDisplay();
        return;
    }
    // If ending with a trailing number, negate it cleanly as "(−number)"
    const trailingNum = miniCalcExpr.match(/(\d+(?:\.\d+)?)$/);
    if (trailingNum) {
        miniCalcExpr = miniCalcExpr.slice(0, -trailingNum[1].length) + `(−${trailingNum[1]})`;
        updateMiniCalcDisplay();
        return;
    }
    miniCalcExpr += '−';
    updateMiniCalcDisplay();
}

function calcClear() {
    miniCalcExpr = '';
    miniCalcJustEvaluated = false;
    miniCalcHasError = false;
    showMiniCalcError('');
    updateMiniCalcStatusLine();
    updateMiniCalcDisplay('0');
}

function calcBackspace() {
    showMiniCalcError('');
    if (miniCalcHasError) {
        // Recover from error state cleanly: delete last token/char so user can fix the expression
        miniCalcHasError = false;
    }
    miniCalcJustEvaluated = false;

    if (!miniCalcExpr) {
        updateMiniCalcStatusLine();
        updateMiniCalcDisplay('0');
        return;
    }

    // Delete multi-character function tokens like "sin(", "log₁₀(", "sin⁻¹(" in a single press
    let removed = false;
    for (const fnTok of CALC_MULTI_CHAR_TOKENS) {
        if (miniCalcExpr.endsWith(fnTok)) {
            miniCalcExpr = miniCalcExpr.slice(0, -fnTok.length);
            removed = true;
            break;
        }
    }
    if (!removed) {
        miniCalcExpr = miniCalcExpr.slice(0, -1);
    }

    if (!miniCalcExpr) {
        updateMiniCalcStatusLine();
    }
    updateMiniCalcDisplay(miniCalcExpr || '0');
}

function updateMiniCalcDisplay(override) {
    const scr = document.getElementById('calcScreen');
    if (scr) {
        const text = String(override !== undefined ? override : (miniCalcExpr || '0'));
        scr.textContent = text;
        // Windows 11 auto-scaling display font size for long expressions/results
        const len = text.length;
        scr.style.fontSize = len > 18 ? '1.15rem' : (len > 13 ? '1.45rem' : (len > 9 ? '1.78rem' : '2.1rem'));
        scr.scrollLeft = scr.scrollWidth;
    }
}

function calcEvaluate() {
    if (!miniCalcExpr || !miniCalcExpr.trim()) return;
    showMiniCalcError('');
    const rawExpr = miniCalcExpr.trim();

    try {
        const { value, formatted } = evaluateBpgMathExpression(rawExpr, miniCalcAngleMode);
        miniCalcLastAns = value;
        miniCalcJustEvaluated = true;
        miniCalcHasError = false;

        miniCalcHistory.unshift({ expr: rawExpr, result: formatted, mode: miniCalcAngleMode });
        if (miniCalcHistory.length > 25) miniCalcHistory.pop();
        renderMiniCalcHistory();

        updateMiniCalcStatusLine(`${rawExpr} =`);
        miniCalcExpr = formatted;
        updateMiniCalcDisplay(formatted);
    } catch (e) {
        miniCalcHasError = true;
        miniCalcJustEvaluated = false;
        const msg = (e && e.message) ? e.message : 'Invalid expression — check syntax or parentheses.';
        showMiniCalcError(msg);
        updateMiniCalcStatusLine(rawExpr);
        const screenLabel = (e && (e.code === 'DIV_ZERO' || e.code === 'ASYMPTOTE')) ? 'Undefined' : 'Error';
        updateMiniCalcDisplay(screenLabel);
    }
}

// Legacy compatibility aliases routed to the unified calculator
function toggleCalcAngle() { toggleMiniCalcAngle(); }
function toggleCalcHistoryDrawer() { toggleMiniCalcHistory(); }
function clearCalcHistory() { clearMiniCalcHistory(); }
function appendCalc(ch) { calcAppend(ch); }
function toggleCalcSign() { calcToggleSign(); }
function clearCalc() { calcClear(); }
function backspaceCalc() { calcBackspace(); }
function evaluateCalc() { calcEvaluate(); }
function appendScientific(fn) {
    const map = { sin: 'sin(', cos: 'cos(', tan: 'tan(', log: 'log₁₀(', ln: 'ln(', sqrt: '√(', sq: '²', cube: '³', pow: '^', pi: 'π', e: 'e', deg: '°' };
    if (fn === 'ans') calcUseLastAns();
    else if (map[fn]) calcAppend(map[fn]);
}

window.addEventListener('keydown', e => {
    const widget = document.getElementById('calcFlyoutWindow') || document.getElementById('draggableCalcWidget');
    if (!widget || !widget.classList.contains('open')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    if (/^[0-9.()+%^\-]$/.test(e.key)) {
        e.preventDefault();
        calcAppend(e.key);
    } else if (e.key === '*') {
        e.preventDefault();
        calcAppend('×');
    } else if (e.key === '/') {
        e.preventDefault();
        calcAppend('÷');
    } else if (e.key === 'Enter' || e.key === '=') {
        e.preventDefault();
        calcEvaluate();
    } else if (e.key === 'Backspace') {
        e.preventDefault();
        calcBackspace();
    } else if (e.key === 'Escape' || e.key === 'Delete') {
        e.preventDefault();
        calcClear();
    } else if (miniCalcMode === 'scientific') {
        const lower = e.key.toLowerCase();
        if (lower === 's') { e.preventDefault(); calcAppend('sin('); }
        else if (lower === 'c') { e.preventDefault(); calcAppend('cos('); }
        else if (lower === 't') { e.preventDefault(); calcAppend('tan('); }
        else if (lower === 'l') { e.preventDefault(); calcAppend('log₁₀('); }
        else if (lower === 'n') { e.preventDefault(); calcAppend('ln('); }
        else if (lower === 'r') { e.preventDefault(); calcAppend('√('); }
        else if (lower === 'p') { e.preventDefault(); calcAppend('π'); }
        else if (lower === 'e') { e.preventDefault(); calcAppend('e'); }
        else if (lower === 'd') { e.preventDefault(); calcAppend('°'); }
    }
});

function initDraggableCalculator() {
    const widget = document.getElementById('calcFlyoutWindow') || document.getElementById('draggableCalcWidget');
    if (!widget) return;
    const handle = document.getElementById('calcDragHandle');

    let isDragging = false, startX = 0, startY = 0, initialLeft = 0, initialTop = 0;
    const startDrag = (cx, cy) => {
        isDragging = true;
        const rect = widget.getBoundingClientRect();
        widget.style.left = `${rect.left}px`;
        widget.style.top = `${rect.top}px`;
        widget.style.right = 'auto';
        widget.style.bottom = 'auto';
        startX = cx; startY = cy;
        initialLeft = rect.left; initialTop = rect.top;
    };
    const moveDrag = (cx, cy) => {
        if (!isDragging) return;
        const maxLeft = window.innerWidth - widget.offsetWidth - 8;
        const maxTop = window.innerHeight - widget.offsetHeight - 8;
        widget.style.left = `${Math.min(Math.max(8, initialLeft + (cx - startX)), maxLeft)}px`;
        widget.style.top = `${Math.min(Math.max(8, initialTop + (cy - startY)), maxTop)}px`;
    };
    handle?.addEventListener('mousedown', e => { if (!e.target.closest('button')) startDrag(e.clientX, e.clientY); });
    window.addEventListener('mousemove', e => moveDrag(e.clientX, e.clientY));
    window.addEventListener('mouseup', () => { isDragging = false; });
}


/* --------------------------------------------------------------------------
   6. BPG CONCEPT SOLVER — AUTOMATED AI MATHEMATICS CHATBOT ENGINE
   -------------------------------------------------------------------------- */
const BPG_AI_KNOWLEDGE_BASE = {
    'lhopital': {
        prompt: "How to apply L'Hôpital's Rule without 0/0 pitfalls?",
        title: "L'Hôpital's Rule: Master Criteria & Elimination Pitfalls",
        formula: `$$\\lim_{x \\to a} \\frac{f(x)}{g(x)} = \\lim_{x \\to a} \\frac{f'(x)}{g'(x)} \\quad \\text{strictly when } \\frac{f(a)}{g(a)} \\in \\left\\{ \\frac{0}{0}, \\; \\frac{\\pm\\infty}{\\pm\\infty} \\right\\}$$`,
        explanation: `In NEB and IOE entrance calculus, differentiating blind is the #1 time trap. Follow BPG Sir's 3 rules:\n1. **Pre-Check Form**: Verify the expression is strictly indeterminate. Applying L'Hôpital when $g(a) \\neq 0$ produces erroneous results.\n2. **Isolate Non-Zero Factors First**: Before taking derivatives, replace any multiplicative factor whose limit is non-zero with its actual numeric value: $\\lim_{x \\to 0} \\frac{\\sin x \\cdot \\cos x}{x} = (\\cos 0) \\cdot \\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$.\n3. **Use Maclaurin Expansions for Products**: When trigonometric or logarithmic differences appear (e.g. $\\tan x - \\sin x$), Maclaurin 3-term polynomials solve the problem in 4 seconds without high-order derivatives!`,
        tip: "BPG Sir Concept Tip: If you see $1^\\infty$ form like $\\lim_{x\\to 0}(1+x)^{1/x}$, convert it immediately to $e^{\\lim g(x)[f(x)-1]}$ rather than taking $\\ln$ on both sides!"
    },
    'skew_lines': {
        prompt: "Shortest distance between two skew lines formula derivation",
        title: "Shortest Distance Between Two Skew Lines in 3D Space",
        formula: `$$d = \\left| \\frac{(\\vec{a}_2 - \\vec{a}_1) \\cdot (\\vec{b}_1 \\times \\vec{b}_2)}{|\\vec{b}_1 \\times \\vec{b}_2|} \\right|$$`,
        explanation: `Skew lines in 3D are non-parallel lines that never intersect because they lie in different parallel planes.\n- Let line $L_1$ pass through point $A(\\vec{a}_1)$ parallel to vector $\\vec{b}_1$.\n- Let line $L_2$ pass through point $B(\\vec{a}_2)$ parallel to vector $\\vec{b}_2$.\n- The common perpendicular vector to both lines is $\\vec{n} = \\vec{b}_1 \\times \\vec{b}_2$.\n- The shortest distance is the scalar projection of the joining vector $\\vec{AB} = \\vec{a}_2 - \\vec{a}_1$ onto the unit normal $\\hat{n}$.`,
        tip: "BPG Sir Concept Tip: Skew lines intersect if and only if $d = 0$, which occurs when the scalar triple product $[\\vec{a}_2 - \\vec{a}_1, \\; \\vec{b}_1, \\; \\vec{b}_2] = 0$ (coplanarity condition)!"
    },
    'casio_hacks': {
        prompt: "IOE Pulchowk Casio FX-991 calculator speed hacks",
        title: "Casio FX-991ES / FX-991CW Speed Techniques for IOE & CEE",
        formula: `$$\\text{Derivative at Point: } \\left. \\frac{d}{dx} \\left[ \\text{Options} \\right] \\right|_{x = 1.3} \\equiv f(1.3) \\;\\; (\\text{Definite / Indefinite Integral Check})$$`,
        explanation: `In the 2-hour IOE CBT examination, Casio shortcuts can recover 15–20 minutes:\n1. **Indefinite Integral Check**: To find $\\int f(x)\\,dx$, substitute a clean non-singular number (like $x = 1.3$). Compute $f(1.3)$ on the calculator. Then use \`SHIFT\` + \`∫dx\` to evaluate the derivative $\\frac{d}{dx}$ of each option at $x = 1.3$. The matching value is the exact answer!\n2. **Trigonometric Evaluation**: ALWAYS switch the calculator to **Radian (R) mode** when calculus or circular functions are involved.\n3. **Complex Mode (Mode 2)**: Enter cube roots of unity $\\omega = -0.5 + \\frac{\\sqrt{3}}{2}i$ into variable memory \`A\` to simplify polynomials like $(1 - \\omega + \\omega^2)^5$ instantaneously!`,
        tip: "BPG Sir Concept Tip: Never test with $x = 0$ or $x = 1$ because multiple options often give the same value. Use $x = 1.25$ or $x = 1.3$."
    },
    'circle_tangent': {
        prompt: "Condition for line y = mx + c to be tangent to circle x² + y² = a²",
        title: "Analytical Circle Tangency & Director Circle Locus",
        formula: `$$c^2 = a^2(1 + m^2) \\implies y = mx \\pm a\\sqrt{1 + m^2}$$`,
        explanation: `A straight line touches a circle if and only if the perpendicular distance $p$ from the center $O(0,0)$ to the line $mx - y + c = 0$ is equal to the radius $a$:\n$$p = \\frac{|0 - 0 + c|}{\\sqrt{m^2 + (-1)^2}} = \\frac{|c|}{\\sqrt{1 + m^2}} = a \\implies c = \\pm a\\sqrt{1 + m^2}$$\nIf the circle center is at $(h, k)$, substitute the shifted coordinates into the point-slope form: $y - k = m(x - h) \\pm a\\sqrt{1 + m^2}$.`,
        tip: "BPG Sir Concept Tip: The locus of the point of intersection of two mutually perpendicular tangents to a circle is its **Director Circle**: $x^2 + y^2 = 2a^2$!"
    },
    'demoivre': {
        prompt: "De Moivre's Theorem proof & cube roots of unity",
        title: "De Moivre's Theorem & Properties of Cube Roots of Unity (ω)",
        formula: `$$(\\cos\\theta + i\\sin\\theta)^n = \\cos(n\\theta) + i\\sin(n\\theta), \\qquad 1 + \\omega + \\omega^2 = 0, \\quad \\omega^3 = 1$$`,
        explanation: `De Moivre's theorem connects trigonometric arguments with complex exponentiation:\n- **Cube roots of unity**: Roots of $x^3 - 1 = (x - 1)(x^2 + x + 1) = 0$.\n- The roots are $1, \\; \\omega = \\frac{-1 + i\\sqrt{3}}{2}, \\; \\omega^2 = \\frac{-1 - i\\sqrt{3}}{2}$.\n- Key algebraic identities:\n  1. $1 + \\omega + \\omega^2 = 0 \\implies 1 + \\omega = -\\omega^2, \\; 1 + \\omega^2 = -\\omega$\n  2. $\\omega^3 = 1 \\implies \\omega^{3k+1} = \\omega, \\; \\omega^{3k+2} = \\omega^2$.`,
        tip: "BPG Sir Concept Tip: Any symmetric cyclic sum in $(a + b\\omega + c\\omega^2) / (c + a\\omega + b\\omega^2)$ simplifies to $\\omega$ or $\\omega^2$ by factoring out $\\omega$ from the numerator!"
    },
    'red_pen_logic': {
        prompt: "Explain BPG Sir's Red-Pen Trap: Converse vs Contrapositive",
        title: "Mathematical Logic Red-Pen Trap: Converse vs Contrapositive",
        formula: `$$\\text{Conditional: } p \\to q \\quad \\equiv \\quad \\text{Contrapositive: } \\sim q \\to \\;\\sim p \\quad (\\text{Logically Equivalent})$$
$$\\text{Converse: } q \\to p \\quad \\not\\equiv \\quad p \\to q \\quad (\\text{Common Fallacy!})$$`,
        explanation: `Students routinely lose 2–3 marks in NEB Mat. 101 Unit 1 by assuming a statement and its converse share the same truth value:\n- **Implication**: *If it rains ($p$), the ground is wet ($q$).* (True)\n- **Converse ($q \\to p$)**: *If the ground is wet, it rained.* (False — sprinklers or taps could wet the ground!)\n- **Inverse ($\\sim p \\to \\;\\sim q$)**: *If it doesn't rain, the ground isn't wet.* (False)\n- **Contrapositive ($\\sim q \\to \\;\\sim p$)**: *If the ground isn't wet, it didn't rain.* (Always logically identical to $p \\to q$).`,
        tip: "BPG Sir Concept Tip: In proof writing, if proving $p \\to q$ directly is cumbersome (e.g., in number theory or irrationality), prove its contrapositive $\\sim q \\to \\;\\sim p$ instead!"
    },
    'first_principle': {
        prompt: "First-Principle Derivative of sin x & √x",
        title: "Ab-Initio Differentiation of Trigonometric Functions",
        formula: `$$\\frac{d}{dx}(\\sin x) = \\lim_{h \\to 0} \\frac{\\sin(x+h) - \\sin x}{h} = \\lim_{h \\to 0} \\frac{2\\cos\\left(x + \\frac{h}{2}\\right)\\sin\\left(\\frac{h}{2}\\right)}{h} = \\cos x$$`,
        explanation: `First-principle differentiation requires rigorous $h \\to 0$ limits without applying the chain rule:\n1. State definition: $f'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}$.\n2. Use transformation: $\\sin C - \\sin D = 2\\cos\\left(\\frac{C+D}{2}\\right)\\sin\\left(\\frac{C-D}{2}\\right)$.\n3. Group standard limit: $\\lim_{h \\to 0} \\frac{\\sin(h/2)}{h/2} = 1$.\n4. Evaluate remaining continuous factor: $\\lim_{h \\to 0} \\cos(x + h/2) = \\cos x$.`,
        tip: "BPG Sir Concept Tip: When differentiating $\\sqrt{x}$ or $\\sqrt{\\sin x}$, always multiply and divide by the algebraic conjugate first before evaluating the limit!"
    },
    'see_venn': {
        prompt: "SEE 3-Set Venn Diagram Cardinality Formula",
        title: "SEE Principle of Inclusion-Exclusion (3 Overlapping Sets)",
        formula: `$$n(A \\cup B \\cup C) = n(A) + n(B) + n(C) - n(A \\cap B) - n(B \\cap C) - n(C \\cap A) + n(A \\cap B \\cap C)$$`,
        explanation: `In Class 10 Compulsory Mathematics, 3-set survey problems require careful region partitioning:\n- $n_0(A)$ (elements in ONLY set A) $= n(A) - n(A \\cap B) - n(A \\cap C) + n(A \\cap B \\cap C)$.\n- Let the triple intersection $n(A \\cap B \\cap C) = x$.\n- Always fill $x$ first in the center of the Venn diagram and work outward to 2-set intersections $(a - x, b - x, c - x)$ to avoid double counting.`,
        tip: "BPG Sir Concept Tip: If the question states '15 students like Math and Science only', that is ALREADY $n_0(M \\cap S)$—do NOT subtract $x$ from it again!"
    }
};

function triggerAiConceptPrompt(key, chipEl) {
    document.querySelectorAll('.ai-prompt-chip').forEach(c => c.classList.remove('active'));
    if (chipEl) chipEl.classList.add('active');

    const data = BPG_AI_KNOWLEDGE_BASE[key] || BPG_AI_KNOWLEDGE_BASE['lhopital'];
    displayAiConceptResponse(data.prompt, data.title, data.formula, data.explanation, data.tip);
}

function handleCustomAiQuestion(e) {
    if (e) e.preventDefault();
    const input = document.getElementById('aiCustomQuestionInput');
    const q = (input?.value || '').trim();
    if (!q) return;

    input.value = '';
    const qLower = q.toLowerCase();

    // Match keywords or find closest knowledge base entry
    let matchedKey = 'lhopital';
    if (qLower.includes('skew') || qLower.includes('vector') || qLower.includes('distance')) matchedKey = 'skew_lines';
    else if (qLower.includes('casio') || qLower.includes('calc') || qLower.includes('hack') || qLower.includes('trick')) matchedKey = 'casio_hacks';
    else if (qLower.includes('circle') || qLower.includes('tangent') || qLower.includes('conic')) matchedKey = 'circle_tangent';
    else if (qLower.includes('moivre') || qLower.includes('cube') || qLower.includes('omega') || qLower.includes('complex')) matchedKey = 'demoivre';
    else if (qLower.includes('logic') || qLower.includes('contrapositive') || qLower.includes('converse') || qLower.includes('trap')) matchedKey = 'red_pen_logic';
    else if (qLower.includes('first principle') || qLower.includes('derivative') || qLower.includes('sin x') || qLower.includes('ab initio')) matchedKey = 'first_principle';
    else if (qLower.includes('venn') || qLower.includes('see') || qLower.includes('set') || qLower.includes('cardinality')) matchedKey = 'see_venn';

    const kb = BPG_AI_KNOWLEDGE_BASE[matchedKey];
    displayAiConceptResponse(q, kb.title, kb.formula, kb.explanation, kb.tip);
}

function displayAiConceptResponse(userQuestion, title, formula, explanation, tip) {
    const viewport = document.getElementById('aiChatViewport');
    if (!viewport) return;

    // Show User Message + Typing indicator
    viewport.innerHTML = `
        <div class="ai-msg-bubble ai-msg-user">
            <div class="ai-msg-user-inner">
                <i class="fa-regular fa-comment-dots" style="margin-right:6px;"></i> ${userQuestion}
            </div>
        </div>
        <div class="ai-msg-bubble" id="aiTypingBubble">
            <div class="ai-typing-indicator">
                <div class="ai-typing-dots"><span></span><span></span><span></span></div>
                <span>BPG Concept Solver generating KaTeX proof...</span>
            </div>
        </div>
    `;
    viewport.scrollTop = viewport.scrollHeight;

    setTimeout(() => {
        const typing = document.getElementById('aiTypingBubble');
        if (typing) typing.remove();

        const botMsg = document.createElement('div');
        botMsg.className = 'ai-msg-bubble';
        botMsg.innerHTML = `
            <div class="ai-msg-bot-card">
                <div class="ai-msg-bot-head">
                    <strong><i class="fa-solid fa-graduation-cap"></i> ${title}</strong>
                    <span style="font-size:0.75rem; color:var(--text-tertiary);"><i class="fa-solid fa-bolt" style="color:var(--accent-amber);"></i> Verified Concept</span>
                </div>
                <div style="font-size:0.92rem; line-height:1.75; color:var(--text-primary);">
                    ${formatRichMarkdown(explanation)}
                </div>
                <div class="preview-theorem-box" style="margin:14px 0; background:var(--bg-cream);">
                    ${formula}
                </div>
                <div class="ai-concept-tip-box">
                    <strong><i class="fa-solid fa-lightbulb" style="color:var(--accent-amber); margin-right:6px;"></i> ${tip}</strong>
                </div>
            </div>
        `;
        viewport.appendChild(botMsg);
        viewport.scrollTop = viewport.scrollHeight;
        renderMathSafely(botMsg);
    }, 420);
}

/* ==========================================================================
   6. INTERACTIVE BPG ACADEMY AI ASSISTANT (LIVE CLASS & WEBSITE QUERY ENGINE)
   ========================================================================== */
function openAiWithPrompt(promptText) {
    const win = document.getElementById('siteGuideWindow');
    if (win && !win.classList.contains('open')) {
        win.classList.add('open');
        win.setAttribute('aria-hidden', 'false');
    }
    if (promptText) {
        submitAiPromptText(promptText);
    } else {
        setTimeout(() => document.getElementById('aiQueryInput')?.focus(), 100);
    }
}

let aiTutorHistory = [];

function getCurrentTutorContext() {
    let classKey = '';
    let gradeLabel = '';
    let subjectName = '';
    let chapterTitle = '';
    let lessonId = '';

    try {
        const activeView = document.querySelector('.portal-view.active');
        if (activeView && activeView.id) {
            const m = activeView.id.match(/^view-(c10|c11|c12|entrance)$/);
            if (m && typeof shortKeyToPortalKey === 'function') {
                classKey = shortKeyToPortalKey(m[1]);
                gradeLabel = typeof getClassDisplayTitle === 'function' ? getClassDisplayTitle(m[1]) : m[1];
            }
        }
        if (!classKey && typeof isUserAuthenticated === 'function' && isUserAuthenticated() && typeof getStudentRegisteredClass === 'function') {
            const reg = getStudentRegisteredClass();
            classKey = typeof shortKeyToPortalKey === 'function' ? shortKeyToPortalKey(reg) : 'class-12';
            gradeLabel = typeof getClassDisplayTitle === 'function' ? getClassDisplayTitle(reg) : reg;
        }
        if (classKey && typeof getActiveSubjectForClass === 'function') {
            const subj = getActiveSubjectForClass(classKey);
            if (subj) {
                subjectName = subj.name || 'Mathematics';
                const activeLessonId = typeof selectedLessonByClass !== 'undefined' ? (selectedLessonByClass[classKey] || '') : '';
                if (activeLessonId) {
                    const found = (subj.lessons || []).find(l => l.id === activeLessonId);
                    if (found) {
                        lessonId = found.id;
                        chapterTitle = found.title || found.code || '';
                    }
                }
            }
        }
    } catch (e) {}

    return { classKey, gradeLabel, subjectName, chapterTitle, lessonId };
}

function clearAiChat() {
    aiTutorHistory = [];
    const stream = document.getElementById('guideChatStream');
    if (!stream) return;
    stream.innerHTML = `
        <div class="guide-msg bot-msg">
            <div class="guide-msg-avatar"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
            <div class="guide-msg-content">
                <p><strong>Namaste!</strong> I&rsquo;m your <strong>BPG EDUCARE AI Tutor</strong>.</p>
                <p>Ask me any math problem, formula, or chapter question &mdash; and if something still feels unclear, just say <em>&ldquo;explain another way&rdquo;</em> for a different method or simpler example.</p>
            </div>
        </div>
    `;
}

function handleAiQuerySubmit(e) {
    if (e) e.preventDefault();
    const input = document.getElementById('aiQueryInput');
    const text = (input?.value || '').trim();
    if (!text) return;
    input.value = '';
    submitAiPromptText(text);
}

async function submitAiPromptText(userText) {
    const stream = document.getElementById('guideChatStream');
    const typing = document.getElementById('guideTypingIndicator');
    if (!stream) return;

    const safeText = typeof escapeHtml === 'function'
        ? escapeHtml(userText)
        : String(userText).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const userDiv = document.createElement('div');
    userDiv.className = 'guide-msg user-msg';
    userDiv.innerHTML = `
        <div class="guide-msg-content"><p>${safeText}</p></div>
    `;
    stream.appendChild(userDiv);
    stream.scrollTop = stream.scrollHeight;

    if (typing) {
        typing.style.display = 'flex';
        stream.appendChild(typing);
        stream.scrollTop = stream.scrollHeight;
    }

    const context = getCurrentTutorContext();
    const historySnapshot = aiTutorHistory.slice(-12);
    aiTutorHistory.push({ role: 'user', text: userText });

    let replyHtml = '';
    let topicSig = '';
    let styleIndex = 0;

    try {
        const authHeaders = typeof getStudentAuthHeaders === 'function' ? getStudentAuthHeaders() : {};
        const res = await fetch('/api/ai-tutor', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders),
            body: JSON.stringify({
                message: userText,
                history: historySnapshot,
                context
            })
        });
        const data = await res.json();
        if (res.ok && data.ok && data.replyHtml) {
            replyHtml = data.replyHtml;
            topicSig = data.topicSig || '';
            styleIndex = Number(data.styleIndex || 0);
        } else {
            replyHtml = generateAcademyAiReply(userText);
        }
    } catch (err) {
        replyHtml = generateAcademyAiReply(userText);
    }

    aiTutorHistory.push({ role: 'assistant', text: replyHtml, topicSig, styleIndex });
    if (aiTutorHistory.length > 24) aiTutorHistory = aiTutorHistory.slice(-24);

    if (typing) typing.style.display = 'none';

    const botDiv = document.createElement('div');
    botDiv.className = 'guide-msg bot-msg';
    botDiv.innerHTML = `
        <div class="guide-msg-avatar"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
        <div class="guide-msg-content">${replyHtml}</div>
    `;
    stream.appendChild(botDiv);
    renderMathInGuide();
    stream.scrollTop = stream.scrollHeight;
}

function detectClassKeyFromQuery(q) {
    if (/\b(class\s*12|grade\s*12|grade\s*xii|xii|12th|mat\.?\s*102)\b/i.test(q)) return 'class-12';
    if (/\b(class\s*11|grade\s*11|grade\s*xi|xi|11th|mat\.?\s*101)\b/i.test(q)) return 'class-11';
    if (/\b(class\s*10|grade\s*10|see|10th|secondary)\b/i.test(q)) return 'class-10';
    if (/\b(after\s*12|entrance|ioe|pulchowk|cee|ku|engineering|medical|cbt)\b/i.test(q)) return 'after-12';
    return null;
}

function buildClassSummaryHtml(classKey) {
    const state = (typeof ACADEMY_STATE !== 'undefined' && ACADEMY_STATE) ? ACADEMY_STATE : null;
    const portal = state?.portals?.[classKey];
    const shortMap = { 'class-10': 'c10', 'class-11': 'c11', 'class-12': 'c12', 'after-12': 'entrance' };
    const shortKey = shortMap[classKey] || 'c12';

    const title = portal?.gradeTitle || classKey;
    const desc = portal?.description || '';
    const rows = portal?.syllabusRows || [];
    const totals = (typeof computeSyllabusTotals === 'function' && rows.length)
        ? computeSyllabusTotals(rows)
        : { totalHours: '', totalMarks: '' };
    const events = (state?.calendarEvents || []).filter(ev => ev.portal === classKey || ev.portal === 'all');
    const notes = (typeof getNormalizedPortalNotes === 'function') ? getNormalizedPortalNotes(classKey) : (portal?.notes || []);

    const unitsPreview = rows.slice(0, 5).map(r =>
        `<li><strong>${r.name || r.domain || r.code}</strong>${r.marks ? ` (${r.marks} marks)` : ''}</li>`
    ).join('');

    const zoomPreview = events.length
        ? `<p><strong>Live Zoom:</strong> ${events.map(e => `${e.recurrenceLabel || 'Weekly'}, ${e.timings}`).join(' &middot; ')}</p>`
        : '';

    return `
        <p><strong>${title}</strong></p>
        ${desc ? `<p>${desc}</p>` : ''}
        ${totals.totalMarks ? `<p><strong>Blueprint:</strong> ${rows.length} units &middot; ${totals.totalMarks} Marks${totals.totalHours ? ` &middot; ${totals.totalHours} hrs` : ''}</p>` : ''}
        ${unitsPreview ? `<ul>${unitsPreview}${rows.length > 5 ? `<li>+ ${rows.length - 5} more units inside workspace</li>` : ''}</ul>` : ''}
        ${zoomPreview}
        <p><strong>Resources:</strong> ${notes.length} downloadable notes &amp; formula sheets unlocked inside the workspace.</p>
        <div class="ai-inline-actions">
            <button type="button" class="ai-action-chip" onclick="closeWebsiteGuide(); handleProgramCardClick('${shortKey}');">Open ${title.split('(')[0].trim()} &rarr;</button>
        </div>
    `;
}

function generateAcademyAiReply(rawQuery) {
    const q = String(rawQuery || '').trim();
    const ql = q.toLowerCase();
    const state = (typeof ACADEMY_STATE !== 'undefined' && ACADEMY_STATE) ? ACADEMY_STATE : null;
    const classKey = detectClassKeyFromQuery(ql);

    // 1. Greeting
    if (/^(hi|hello|hey|namaste|namaskar|good\s*(morning|afternoon|evening))[\s!?.]*$/i.test(ql)) {
        return `
            <p><strong>Namaste!</strong> How can I help you today?</p>
            <p>You can ask me about:</p>
            <ul>
                <li><strong>Classes:</strong> Class 10 (SEE), Class 11, Class 12, or IOE / CEE Entrance</li>
                <li><strong>Schedules:</strong> Live Zoom class days, timings &amp; passcodes</li>
                <li><strong>Syllabus &amp; Notes:</strong> Unit marks, topics, and downloadable PDFs</li>
                <li><strong>Math Concepts:</strong> Limits, integration, vectors, circle tangents &amp; more</li>
            </ul>
        `;
    }

    // 2. Live Zoom / Schedule / Timings
    if (/(zoom|live|schedule|timing|time|when|sunday|saturday|morning|evening|batch|meeting)/i.test(ql)) {
        const allEvents = state?.calendarEvents || [];
        const filtered = classKey ? allEvents.filter(e => e.portal === classKey || e.portal === 'all') : allEvents;
        if (filtered.length > 0) {
            const listHtml = filtered.map(ev =>
                `<li><strong>${ev.title}</strong><br>${ev.recurrenceLabel || 'Weekly'} &middot; ${ev.timings}</li>`
            ).join('');
            return `
                <p><strong>Live Zoom Class Schedule:</strong></p>
                <ul>${listHtml}</ul>
                <p>Sign into your class workspace and open the <strong>Live Class Calendar</strong> tab for one-click Zoom links and <code>.ics</code> reminders.</p>
            `;
        }
    }

    // 3. Notes / PDFs / Past Papers
    if (/(note|pdf|past\s*paper|question\s*bank|formula\s*sheet|handout|download|archive)/i.test(ql)) {
        if (classKey) {
            const notes = (typeof getNormalizedPortalNotes === 'function') ? getNormalizedPortalNotes(classKey) : [];
            const title = state?.portals?.[classKey]?.gradeTitle || classKey;
            const noteItems = notes.slice(0, 5).map(n => `<li><strong>${n.title}</strong> (${n.pages || 'PDF'})</li>`).join('');
            return `
                <p><strong>Notes &amp; PDFs for ${title}:</strong></p>
                ${noteItems ? `<ul>${noteItems}</ul>` : '<p>All curated notes and formula sheets are unlocked inside the workspace.</p>'}
                <p>Open the <strong>Notes &amp; PDFs</strong> tab inside your class workspace to view in-app or download.</p>
            `;
        }
        return `
            <p>Every class workspace includes a dedicated <strong>Notes &amp; PDFs</strong> tab with curated formula sheets, worked solutions, and past paper archives (including the <strong>15-Year IOE Pulchowk Archive</strong> for Entrance).</p>
            <p>Ask me about a specific class (e.g. <em>&ldquo;Class 12 notes&rdquo;</em> or <em>&ldquo;IOE past papers&rdquo;</em>) to see the exact list.</p>
        `;
    }

    // 4. Specific Class Info (Class 10, 11, 12, Entrance)
    if (classKey && !/(register|sign\s*up|login|otp|who\s+is|bpg\s*sir|contact|whatsapp)/i.test(ql)) {
        return buildClassSummaryHtml(classKey);
    }

    // 5. All Classes Overview
    if (/(all\s*class|what\s*class|which\s*class|programs|courses|offered|list\s*class)/i.test(ql)) {
        return `
            <p><strong>BPG EDUCARE offers 4 dedicated mathematics programs:</strong></p>
            <ul>
                <li><strong>Class 12 (NEB Mat. 102):</strong> Advanced Calculus, 3D Vectors, Differential Equations &amp; Board Strategy (75 Marks).</li>
                <li><strong>Class 11 (NEB Mat. 101):</strong> Logic, Complex Numbers, Conics &amp; First-Principle Calculus (75 Marks).</li>
                <li><strong>Class 10 (SEE Foundation):</strong> Compulsory &amp; Optional Math, Circle Theorems &amp; Trigonometry.</li>
                <li><strong>After 12 Entrance (IOE / CEE / KU):</strong> 50-Mark CBT Blueprint, 15-Year Past Papers &amp; Casio FX-991 Speed Hacks.</li>
            </ul>
            <p>Ask me about any specific class for its full syllabus and Zoom timings!</p>
        `;
    }

    // 6. Registration / Login / Single Class / Pricing / Free
    if (/(register|sign\s*up|sign\s*in|login|enroll|join|account|otp|free|fee|price|cost|single\s*class|switch)/i.test(ql)) {
        return `
            <p><strong>How Enrollment Works at BPG EDUCARE:</strong></p>
            <ul>
                <li>Click <strong>Sign In</strong> or <strong>Create Account</strong> in the top bar.</li>
                <li>Enter your name, email, and pick your class (Class 10, 11, 12, or Entrance).</li>
                <li>Verify using the <strong>6-digit OTP code</strong> to unlock your dedicated workspace immediately.</li>
                <li><strong>Single-Class Architecture:</strong> Each student account is dedicated to one class with full access to Syllabus, Theory, Live Zoom Calendar, and Notes. To study another class, register a separate account.</li>
            </ul>
            <div class="ai-inline-actions">
                <button type="button" class="ai-action-chip" onclick="closeWebsiteGuide(); openAuthModal('signup');">Create Account &rarr;</button>
            </div>
        `;
    }

    // 7. About BPG Sir / Faculty / Contact / Location
    if (/(who|bpg|sir|bishnu|teacher|founder|faculty|qualif|tu|pokhara|contact|whatsapp|phone|email|about)/i.test(ql)) {
        return `
            <p><strong>Bishnu Prasad Gautam (BPG Sir)</strong> is the founder and lead mathematics educator of BPG EDUCARE in <strong>Pokhara, Nepal</strong>.</p>
            <ul>
                <li><strong>Qualification:</strong> M.Sc. in Mathematics, Tribhuvan University (<strong>CGPA 3.9 / 4.0</strong>, Semester Topper with multiple 4.0 GPA records).</li>
                <li><strong>Experience:</strong> 12+ years of senior secondary NEB &amp; IOE / CEE entrance mentorship.</li>
                <li><strong>Philosophy:</strong> <em>&ldquo;Focus on the concepts rather than the problems.&rdquo;</em></li>
                <li><strong>WhatsApp Direct:</strong> <a href="https://wa.me/9779866064252?text=Namaste%20BPG%20Sir%2C%20I%20have%20an%20academic%20inquiry%20regarding%20BPG%20EDUCARE" target="_blank" rel="noopener" style="text-decoration:underline; font-weight:600;">+977 9866064252</a></li>
            </ul>
        `;
    }

    // 8. Calculator
    if (/(calc|fx-?991|casio)/i.test(ql)) {
        return `
            <p>BPG EDUCARE includes a built-in <strong>Casio FX-991 Mini Scientific Calculator</strong> for trig, logs, powers, and quick verification.</p>
            <div class="ai-inline-actions">
                <button type="button" class="ai-action-chip" onclick="toggleMiniCalculator();">Open FX-991 Calculator</button>
            </div>
        `;
    }

    // 9. Math Concept Knowledge Base (with KaTeX)
    const mathKeywords = [
        { key: 'lhopital', re: /(l'?hopital|limit|sin\s*x\s*\/\s*x|euler|e\^\{?i)/i },
        { key: 'skew_lines', re: /(skew|3d\s*vector|shortest\s*distance|vector)/i },
        { key: 'circle_tangent', re: /(circle|tangent|conic|parabola|ellipse)/i },
        { key: 'demoivre', re: /(moivre|complex|omega|cube\s*root)/i },
        { key: 'red_pen_logic', re: /(logic|contrapositive|converse|truth\s*table)/i },
        { key: 'first_principle', re: /(first\s*principle|derivative|differenti|d\/dx|ab\s*initio)/i },
        { key: 'see_venn', re: /(venn|set\s*theory|cardinality|inclusion)/i }
    ];
    for (const mk of mathKeywords) {
        if (mk.re.test(ql) && BPG_AI_KNOWLEDGE_BASE[mk.key]) {
            const kb = BPG_AI_KNOWLEDGE_BASE[mk.key];
            return `
                <p><strong>${kb.title}</strong></p>
                <p>${kb.formula}</p>
                <p>${kb.tip}</p>
            `;
        }
    }

    // 10. Live Search across Syllabus Units & Topics in ACADEMY_STATE
    if (state?.portals && ql.length >= 3) {
        const words = ql.split(/\s+/).filter(w => w.length >= 3 && !['what', 'where', 'when', 'about', 'class', 'math', 'maths', 'tell', 'show', 'does', 'have', 'this', 'with'].includes(w));
        if (words.length > 0) {
            const matches = [];
            const portalNames = { 'class-10': 'Class 10', 'class-11': 'Class 11', 'class-12': 'Class 12', 'after-12': 'Entrance' };
            Object.keys(state.portals).forEach(pk => {
                const p = state.portals[pk];
                (p.syllabusRows || []).forEach(r => {
                    const hay = `${r.name || ''} ${r.domain || ''} ${r.focus || ''}`.toLowerCase();
                    if (words.some(w => hay.includes(w))) {
                        matches.push({ portal: portalNames[pk] || pk, title: r.name || r.domain, meta: `${r.marks || ''} marks` });
                    }
                });
                (p.units || []).forEach(u => {
                    (u.topics || []).forEach(t => {
                        const hay = `${t.title || ''} ${u.title || ''}`.toLowerCase();
                        if (words.some(w => hay.includes(w))) {
                            matches.push({ portal: portalNames[pk] || pk, title: t.title, meta: u.title });
                        }
                    });
                });
            });

            if (matches.length > 0) {
                const unique = matches.slice(0, 5);
                return `
                    <p>I found these matching topics across BPG EDUCARE:</p>
                    <ul>${unique.map(m => `<li><strong>${m.portal}:</strong> ${m.title}${m.meta ? ` (${m.meta})` : ''}</li>`).join('')}</ul>
                    <p>Ask me about any of those classes to see its full blueprint and schedule!</p>
                `;
            }
        }
    }

    // 11. Helpful Fallback
    return `
        <p>I can help with anything on <strong>BPG EDUCARE</strong>! Try asking:</p>
        <ul>
            <li><em>&ldquo;Tell me about Class 12&rdquo;</em> or <em>&ldquo;Class 11 syllabus&rdquo;</em></li>
            <li><em>&ldquo;When are live Zoom classes?&rdquo;</em></li>
            <li><em>&ldquo;What is included in IOE Entrance?&rdquo;</em></li>
            <li><em>&ldquo;How do I register?&rdquo;</em> or <em>&ldquo;Who is BPG Sir?&rdquo;</em></li>
        </ul>
    `;
}

/* ==========================================================================
   7. ROAMING AMBIENT MATH WIDGETS (DRIFTING + DRAGGABLE + CLICK-TO-ASK)
   ========================================================================== */
function initRoamingWidgets() {
    const layer = document.getElementById('roamingWidgetsLayer');
    if (!layer || layer.dataset.initialized === 'true') return;
    if (window.innerWidth < 768) return; // keep small mobile screens uncluttered
    layer.dataset.initialized = 'true';

    const items = [
        { label: '∫ sin²x dx = π/2', tag: 'Calculus', prompt: 'Tell me about Class 12 integration and calculus' },
        { label: 'lim(x→0) sin x / x = 1', tag: 'Limits', prompt: 'Explain L\'Hopital rule and limits' },
        { label: 'e^(iπ) + 1 = 0', tag: 'Complex', prompt: 'Tell me about complex numbers and De Moivre theorem' },
        { label: 'd/dx (sin x) = cos x', tag: 'First Principle', prompt: 'Explain first principle derivative of sin x' },
        { label: 'IOE · 50 Marks CBT', tag: 'Entrance', prompt: 'Tell me about IOE Entrance' },
        { label: 'n(A∪B∪C)', tag: 'SEE Sets', prompt: 'Tell me about Class 10 SEE and Venn diagrams' }
    ];

    const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const widgets = [];

    items.forEach((item, idx) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'roaming-widget-pill';
        el.setAttribute('aria-label', `Ask AI about ${item.tag}`);
        el.innerHTML = `<span class="rw-math">${item.label}</span><span class="rw-tag">${item.tag}</span>`;
        layer.appendChild(el);

        // Spread initial positions around the outer margins so center text stays clean
        const onLeft = idx % 2 === 0;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const startX = onLeft
            ? 20 + Math.random() * Math.max(40, vw * 0.14)
            : vw - 220 - Math.random() * Math.max(40, vw * 0.12);
        const startY = 95 + ((idx * 135) % Math.max(240, vh - 220));

        const speed = 0.28 + Math.random() * 0.26;
        const angle = Math.random() * Math.PI * 2;

        const w = {
            el,
            item,
            x: Math.max(16, Math.min(vw - 200, startX)),
            y: Math.max(84, Math.min(vh - 90, startY)),
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            paused: false,
            dragging: false,
            movedDuringDrag: false,
            offsetX: 0,
            offsetY: 0
        };

        el.style.transform = `translate3d(${w.x}px, ${w.y}px, 0)`;

        el.addEventListener('mouseenter', () => { w.paused = true; });
        el.addEventListener('mouseleave', () => { if (!w.dragging) w.paused = false; });

        el.addEventListener('pointerdown', (e) => {
            w.dragging = true;
            w.paused = true;
            w.movedDuringDrag = false;
            w.offsetX = e.clientX - w.x;
            w.offsetY = e.clientY - w.y;
            el.classList.add('is-dragging');
            el.setPointerCapture?.(e.pointerId);
        });

        el.addEventListener('pointermove', (e) => {
            if (!w.dragging) return;
            const nx = e.clientX - w.offsetX;
            const ny = e.clientY - w.offsetY;
            if (Math.hypot(nx - w.x, ny - w.y) > 4) w.movedDuringDrag = true;
            w.vx = (nx - w.x) * 0.12;
            w.vy = (ny - w.y) * 0.12;
            w.x = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, nx));
            w.y = Math.max(76, Math.min(window.innerHeight - el.offsetHeight - 16, ny));
            el.style.transform = `translate3d(${w.x}px, ${w.y}px, 0)`;
        });

        const endDrag = () => {
            if (!w.dragging) return;
            w.dragging = false;
            w.paused = false;
            el.classList.remove('is-dragging');
            // Clamp gentle roaming velocity after a toss
            const maxV = 0.65;
            w.vx = Math.max(-maxV, Math.min(maxV, w.vx || 0.3));
            w.vy = Math.max(-maxV, Math.min(maxV, w.vy || 0.25));
        };

        el.addEventListener('pointerup', endDrag);
        el.addEventListener('pointercancel', endDrag);

        el.addEventListener('click', () => {
            if (w.movedDuringDrag) return;
            openAiWithPrompt(item.prompt);
        });

        widgets.push(w);
    });

    if (reducedMotion) return;

    function tick() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // Only animate when on homepage (keeps class workspaces distraction-free)
        const homeVisible = document.getElementById('view-home')?.classList.contains('active');
        layer.style.display = homeVisible ? 'block' : 'none';

        if (homeVisible) {
            for (const w of widgets) {
                if (w.paused || w.dragging) continue;
                w.x += w.vx;
                w.y += w.vy;

                const maxW = Math.max(120, vw - (w.el.offsetWidth || 160) - 16);
                const maxH = Math.max(160, vh - (w.el.offsetHeight || 42) - 24);

                if (w.x <= 16) { w.x = 16; w.vx = Math.abs(w.vx); }
                else if (w.x >= maxW) { w.x = maxW; w.vx = -Math.abs(w.vx); }

                if (w.y <= 82) { w.y = 82; w.vy = Math.abs(w.vy); }
                else if (w.y >= maxH) { w.y = maxH; w.vy = -Math.abs(w.vy); }

                w.el.style.transform = `translate3d(${w.x.toFixed(1)}px, ${w.y.toFixed(1)}px, 0)`;
            }
        }
        requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
}


