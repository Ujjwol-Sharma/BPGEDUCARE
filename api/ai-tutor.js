/**
 * BPG EDUCARE — Context-Aware Multi-Turn AI Tutor Endpoint (/api/ai-tutor)
 * - Uses conversation history, selected grade, subject, and chapter/lesson
 * - Grounds explanations in live course material from academy-state.json
 * - Gives direct answers to simple questions and worked steps for problems
 * - Detects "I still don't understand", "explain another way", or repeated questions
 *   and responds with a genuinely different valid method, simpler explanation, or fresh example
 * - Asks a concise clarifying question when key problem details are missing
 * - Clearly states when a topic is outside the loaded course material
 */

const { readAcademyState, gradeToClassKey } = require('./_access-control');

const GRADE_LABELS = {
    'class-12': 'Grade XII (Class 12)',
    'class-11': 'Grade XI (Class 11)',
    'class-10': 'Class 10 (SEE)',
    'after-12': 'Entrance Prep (IOE / CEE / KU)'
};

function esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function isReexplainRequest(q) {
    const s = String(q || '').toLowerCase().trim();
    return /\b(still\s*(don'?t|do\s*not)\s*understand|don'?t\s*get\s*it|didn'?t\s*get\s*it|explain\s*(it\s*)?(another|a\s*different|other)\s*way|explain\s*again|another\s*(method|way|example|approach)|different\s*(method|way|example|approach)|simpler|simplify|easier\s*way|confused|not\s*clear|break\s*it\s*down|step\s*by\s*step\s*again|try\s*again)\b/i.test(s);
}

function normalizePromptSignature(q) {
    return String(q || '').toLowerCase().replace(/[^a-z0-9+\-*/^=().]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isSameAsPreviousQuestion(currentQ, history) {
    const curr = normalizePromptSignature(currentQ);
    if (!curr || curr.length < 4) return false;
    const prevUsers = (history || []).filter(m => m && m.role === 'user');
    if (prevUsers.length === 0) return false;
    const last = normalizePromptSignature(prevUsers[prevUsers.length - 1].text || '');
    return curr === last;
}

function findLastSubstantiveUserQuestion(history) {
    const prevUsers = (history || []).filter(m => m && m.role === 'user');
    for (let i = prevUsers.length - 1; i >= 0; i--) {
        const text = String(prevUsers[i].text || '').trim();
        if (text && !isReexplainRequest(text)) {
            return text;
        }
    }
    return '';
}

function countPreviousExplanationsForSignature(sig, history) {
    if (!sig) return 0;
    let count = 0;
    (history || []).forEach(m => {
        if (m && m.role === 'assistant' && m.topicSig === sig) count++;
    });
    return count;
}

/* --------------------------------------------------------------------------
   SAFE ARITHMETIC & ALGEBRAIC SOLVERS (100% CONSISTENT CALCULATIONS)
   -------------------------------------------------------------------------- */
function tryDirectArithmetic(q) {
    const cleaned = q
        .replace(/^(what\s+is|calculate|compute|evaluate|find|solve)\s+/i, '')
        .replace(/\?+$/g, '')
        .replace(/×/g, '*')
        .replace(/÷/g, '/')
        .trim();

    if (!/^[\d\s+\-*/().^]+$/.test(cleaned)) return null;
    if (!/[+\-*/^]/.test(cleaned)) return null;
    try {
        const expr = cleaned.replace(/\^/g, '**');
        const val = Function(`"use strict"; return (${expr});`)();
        if (typeof val !== 'number' || !Number.isFinite(val)) return null;
        const rounded = Math.abs(val - Math.round(val)) < 1e-10 ? Math.round(val) : Number(val.toFixed(6));
        return { expr: cleaned, value: rounded };
    } catch (e) {
        return null;
    }
}

function parseQuadraticEquation(q) {
    // Matches forms like: x^2 - 5x + 6 = 0, 2x^2 + 3x - 2 = 0, x^2 - 9 = 0, x^2 + 4x = 0
    const m = q.replace(/\s+/g, '').match(/([+-]?\d*)x\^2([+-]\d*x)?([+-]\d+)?=([+-]?\d+)/i);
    if (!m) return null;
    const parseCoeff = (raw, def = 1) => {
        if (raw === '' || raw === '+') return def;
        if (raw === '-') return -def;
        return parseFloat(raw);
    };
    const a = parseCoeff(m[1], 1);
    let b = 0;
    let c = 0;
    if (m[2]) {
        const bRaw = m[2].replace(/x$/i, '');
        b = parseCoeff(bRaw, 1);
    }
    if (m[3]) c = parseFloat(m[3]);
    const rhs = parseFloat(m[4] || '0');
    c = c - rhs;
    if (!a || !Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return null;
    return { a, b, c, eqText: m[0] };
}

function formatNum(n) {
    if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
    return Number(n.toFixed(4)).toString();
}

function solveQuadraticResponse(quad, styleIdx, ctxNote) {
    const { a, b, c, eqText } = quad;
    const D = b * b - 4 * a * c;
    const fmtEq = `${a === 1 ? '' : (a === -1 ? '-' : a)}x^2 ${b >= 0 ? '+' : '-'} ${Math.abs(b)}x ${c >= 0 ? '+' : '-'} ${Math.abs(c)} = 0`;

    let rootsSummary = '';
    let r1 = null;
    let r2 = null;
    if (D > 0) {
        const sqrtD = Math.sqrt(D);
        r1 = (-b + sqrtD) / (2 * a);
        r2 = (-b - sqrtD) / (2 * a);
        rootsSummary = `$x = ${formatNum(r1)}$ and $x = ${formatNum(r2)}$`;
    } else if (D === 0) {
        r1 = -b / (2 * a);
        r2 = r1;
        rootsSummary = `$x = ${formatNum(r1)}$ (repeated root)`;
    } else {
        const realPart = formatNum(-b / (2 * a));
        const imagPart = formatNum(Math.sqrt(-D) / (2 * a));
        rootsSummary = `$x = ${realPart} \\pm ${imagPart}i$ (complex conjugate roots)`;
    }

    const mode = styleIdx % 3;
    if (mode === 0) {
        // Method 1: Quadratic Formula (works universally)
        return {
            html: `
                ${ctxNote}
                <p><strong>Solving $${fmtEq}$ (Method 1 — Quadratic Formula)</strong></p>
                <ol>
                    <li>Identify coefficients: $a = ${a},\\; b = ${b},\\; c = ${c}$.</li>
                    <li>Compute the discriminant: $D = b^2 - 4ac = (${b})^2 - 4(${a})(${c}) = ${b * b} - ${4 * a * c} = ${D}$.</li>
                    <li>Apply $x = \\dfrac{-b \\pm \\sqrt{D}}{2a} = \\dfrac{${-b} \\pm \\sqrt{${D}}}{${2 * a}}$.</li>
                </ol>
                <p><strong>Answer:</strong> ${rootsSummary}.</p>
                <p style="font-size:0.84rem; color:var(--text-secondary);">Need this explained by completing the square or factoring instead? Just say <em>&ldquo;explain another way&rdquo;</em>.</p>
            `,
            methodLabel: 'Quadratic Formula'
        };
    }

    if (mode === 1) {
        // Method 2: Completing the Square (genuinely different valid method, same exact roots!)
        const halfBOverA = b / (2 * a);
        const rhsVal = (halfBOverA * halfBOverA) - (c / a);
        return {
            html: `
                ${ctxNote}
                <p><strong>Let&rsquo;s solve $${fmtEq}$ a different way (Method 2 — Completing the Square):</strong></p>
                <p>Instead of memorizing the quadratic formula, we turn the left side into a single perfect square:</p>
                <ol>
                    <li>Divide by $a = ${a}$ and move the constant term to the right: $x^2 ${b / a >= 0 ? '+' : '-'} ${formatNum(Math.abs(b / a))}x = ${formatNum(-c / a)}$.</li>
                    <li>Take half the coefficient of $x$ (which is $${formatNum(halfBOverA)}$), square it ($${formatNum(halfBOverA * halfBOverA)}$), and add it to both sides:
                        $$\\left(x ${halfBOverA >= 0 ? '+' : '-'} ${formatNum(Math.abs(halfBOverA))}\\right)^2 = ${formatNum(rhsVal)}$$
                    </li>
                    <li>Take the square root of both sides and isolate $x$:
                        $$x = ${formatNum(-halfBOverA)} \\pm ${rhsVal >= 0 ? formatNum(Math.sqrt(rhsVal)) : formatNum(Math.sqrt(-rhsVal)) + 'i'}$$
                    </li>
                </ol>
                <p><strong>Same verified answer:</strong> ${rootsSummary}.</p>
            `,
            methodLabel: 'Completing the Square'
        };
    }

    // Method 3: Factoring / Sum-and-Product Intuition + Fresh Mini Example
    const sumRoots = formatNum(-b / a);
    const prodRoots = formatNum(c / a);
    return {
        html: `
            ${ctxNote}
            <p><strong>Simpler way to think about $${fmtEq}$ (Method 3 — Sum &amp; Product / Graph Intuition):</strong></p>
            <p>Think of the equation as asking: <em>&ldquo;Where does the parabola $y = ${fmtEq.replace('= 0', '')}$ cross the x-axis ($y = 0$)?&rdquo;</em></p>
            <ul>
                <li>By Vieta&rsquo;s relations, the two answers $r_1, r_2$ must satisfy:
                    <br><strong>Sum:</strong> $r_1 + r_2 = -\\frac{b}{a} = ${sumRoots}$
                    <br><strong>Product:</strong> $r_1 \\cdot r_2 = \\frac{c}{a} = ${prodRoots}$
                </li>
                ${D >= 0 && r1 !== null ? `<li>Check directly: $${formatNum(r1)} + ${formatNum(r2)} = ${formatNum(r1 + r2)}$ and $${formatNum(r1)} \\times ${formatNum(r2)} = ${formatNum(r1 * r2)}$.</li>` : `<li>Because $D = ${D} < 0$, the parabola never touches the real x-axis — that is why the roots are complex: ${rootsSummary}.</li>`}
                <li><strong>Quick analogy example:</strong> For $x^2 - 7x + 12 = 0$, we simply look for two numbers that add to $7$ and multiply to $12$ — immediately $3$ and $4$!</li>
            </ul>
            <p><strong>Verified answer for your problem:</strong> ${rootsSummary}.</p>
        `,
        methodLabel: 'Sum & Product / Graph Intuition'
    };
}

function parseLinearEquation(q) {
    // Matches ax + b = c or ax + b = dx + e (no x^2)
    if (/x\^2/i.test(q)) return null;
    const eqMatch = q.match(/([0-9a-zA-Z.+\-*\s]+=[0-9a-zA-Z.+\-*\s]+)/);
    if (!eqMatch || !/x/i.test(eqMatch[1])) return null;
    const parts = eqMatch[1].replace(/\s+/g, '').split('=');
    if (parts.length !== 2) return null;

    const parseSide = (side) => {
        const terms = side.replace(/-/g, '+-').split('+').filter(Boolean);
        let coefX = 0;
        let constant = 0;
        for (const t of terms) {
            if (/^[+-]?\d*\.?\d*x$/i.test(t)) {
                const raw = t.replace(/x$/i, '');
                coefX += (raw === '' || raw === '+') ? 1 : (raw === '-' ? -1 : parseFloat(raw));
            } else if (/^[+-]?\d+(\.\d+)?$/.test(t)) {
                constant += parseFloat(t);
            } else {
                return null;
            }
        }
        return { coefX, constant };
    };

    const L = parseSide(parts[0]);
    const R = parseSide(parts[1]);
    if (!L || !R) return null;
    const netX = L.coefX - R.coefX;
    const netC = R.constant - L.constant;
    if (netX === 0) return null;
    return { raw: eqMatch[1].trim(), L, R, netX, netC, solution: netC / netX };
}

function solveLinearResponse(lin, styleIdx, ctxNote) {
    const ans = formatNum(lin.solution);
    const mode = styleIdx % 2;
    if (mode === 0) {
        return {
            html: `
                ${ctxNote}
                <p><strong>Solving $${esc(lin.raw)}$ step by step:</strong></p>
                <ol>
                    <li>Collect all $x$-terms on the left and constants on the right: $${formatNum(lin.netX)}x = ${formatNum(lin.netC)}$.</li>
                    <li>Divide both sides by $${formatNum(lin.netX)}$: $x = \\dfrac{${formatNum(lin.netC)}}{${formatNum(lin.netX)}} = ${ans}$.</li>
                </ol>
                <p><strong>Answer:</strong> $x = ${ans}$.</p>
            `,
            methodLabel: 'Algebraic Isolation'
        };
    }
    return {
        html: `
            ${ctxNote}
            <p><strong>Simpler balance-scale way to understand $${esc(lin.raw)}$:</strong></p>
            <p>Picture an equals sign as a perfectly balanced weighing scale — whatever you add, subtract, multiply, or divide on one side, do the exact same thing on the other so it stays level:</p>
            <ul>
                <li>After moving constants away from $x$, you have $${formatNum(lin.netX)}$ copies of $x$ balancing $${formatNum(lin.netC)}$.</li>
                <li>Splitting equally into $${formatNum(lin.netX)}$ parts gives each single $x = ${ans}$.</li>
                <li><strong>Quick verification:</strong> Plug $x = ${ans}$ back into the original equation: Left side = $${formatNum(lin.L.coefX * lin.solution + lin.L.constant)}$, Right side = $${formatNum(lin.R.coefX * lin.solution + lin.R.constant)}$ — both sides match!</li>
            </ul>
        `,
        methodLabel: 'Balance-Scale Intuition'
    };
}

function parsePolynomialDerivative(q) {
    if (!/(derivative|differentiate|d\/dx|diff\b)/i.test(q)) return null;
    const cleaned = q
        .replace(/^.*?(?:derivative\s+of|differentiate|d\/dx\s*(?:of)?)\s*/i, '')
        .replace(/\?+$/g, '')
        .replace(/\s+/g, '')
        .trim();
    if (!cleaned || !/x/i.test(cleaned)) return null;
    // Handle simple polynomial terms like 3x^2+4x-5 or x^3
    const terms = cleaned.replace(/-/g, '+-').split('+').filter(Boolean);
    const parsed = [];
    for (const t of terms) {
        const mPow = t.match(/^([+-]?\d*\.?\d*)x\^([+-]?\d+)$/i);
        const mLin = t.match(/^([+-]?\d*\.?\d*)x$/i);
        const mCon = t.match(/^([+-]?\d+(\.\d+)?)$/);
        if (mPow) {
            const c = (mPow[1] === '' || mPow[1] === '+') ? 1 : (mPow[1] === '-' ? -1 : parseFloat(mPow[1]));
            const p = parseInt(mPow[2], 10);
            parsed.push({ c, p });
        } else if (mLin) {
            const c = (mLin[1] === '' || mLin[1] === '+') ? 1 : (mLin[1] === '-' ? -1 : parseFloat(mLin[1]));
            parsed.push({ c, p: 1 });
        } else if (mCon) {
            parsed.push({ c: parseFloat(mCon[1]), p: 0 });
        } else {
            return null;
        }
    }
    if (!parsed.length) return null;
    const derivTerms = parsed
        .filter(t => t.p !== 0)
        .map(t => ({ c: t.c * t.p, p: t.p - 1 }));
    const fmtPoly = (arr) => {
        if (!arr.length) return '0';
        return arr.map((t, i) => {
            const sign = t.c < 0 ? (i === 0 ? '-' : ' - ') : (i === 0 ? '' : ' + ');
            const absC = Math.abs(t.c);
            const coefStr = (absC === 1 && t.p > 0) ? '' : formatNum(absC);
            const varStr = t.p === 0 ? '' : (t.p === 1 ? 'x' : `x^${t.p}`);
            return `${sign}${coefStr}${varStr}`;
        }).join('');
    };
    return {
        origLatex: fmtPoly(parsed),
        derivLatex: fmtPoly(derivTerms),
        parsed,
        derivTerms
    };
}

function solvePolyDerivativeResponse(poly, styleIdx, ctxNote) {
    const mode = styleIdx % 2;
    if (mode === 0) {
        const steps = poly.parsed.map(t => {
            if (t.p === 0) return `Constant term $${formatNum(t.c)}$ differentiates to $0$.`;
            return `$\\frac{d}{dx}(${t.c === 1 ? '' : formatNum(t.c)}x^{${t.p}}) = ${formatNum(t.c)}\\cdot ${t.p}x^{${t.p - 1}} = ${formatNum(t.c * t.p)}${t.p - 1 === 0 ? '' : (t.p - 1 === 1 ? 'x' : `x^{${t.p - 1}}`)}$.`;
        });
        return {
            html: `
                ${ctxNote}
                <p><strong>Differentiating $f(x) = ${poly.origLatex}$ using the Power Rule ($\\frac{d}{dx}(x^n) = nx^{n-1}$):</strong></p>
                <ol>${steps.map(s => `<li>${s}</li>`).join('')}</ol>
                <p><strong>Answer:</strong> $f'(x) = ${poly.derivLatex}$.</p>
            `,
            methodLabel: 'Power Rule'
        };
    }

    // Method 2: Rate of change / tangent slope intuition with concrete x = 2 test
    const evalPoly = (arr, x) => arr.reduce((sum, t) => sum + t.c * Math.pow(x, t.p), 0);
    const slopeAt2 = formatNum(evalPoly(poly.derivTerms, 2));
    const f2 = evalPoly(poly.parsed, 2);
    const f2001 = evalPoly(poly.parsed, 2.001);
    const approxSlope = formatNum((f2001 - f2) / 0.001);
    return {
        html: `
            ${ctxNote}
            <p><strong>Another way to picture $f'(x)$ for $f(x) = ${poly.origLatex}$ (Slope / Speed Intuition):</strong></p>
            <p>Instead of just applying rules mechanically, think of $f(x)$ as distance and $f'(x)$ as your exact speedometer reading at any point $x$:</p>
            <ul>
                <li>Each power $x^n$ changes at rate $n x^{n-1}$ (for example, the area of a square $x^2$ grows by $2x$ when you nudge the side length $x$ slightly!).</li>
                <li>Putting all terms together gives the slope formula: <strong>$f'(x) = ${poly.derivLatex}$</strong>.</li>
                <li><strong>Sanity check at $x = 2$:</strong> Our formula predicts slope $= ${slopeAt2}$. If we nudge $x$ from $2$ to $2.001$, $\\frac{f(2.001) - f(2)}{0.001} \\approx ${approxSlope}$ — confirming the exact same result!</li>
            </ul>
        `,
        methodLabel: 'Slope & Numerical Intuition'
    };
}

/* --------------------------------------------------------------------------
   CURRICULUM-GROUNDED MULTI-METHOD CONCEPT LIBRARY (3 DISTINCT STYLES EACH)
   -------------------------------------------------------------------------- */
const MULTI_STYLE_CONCEPTS = [
    {
        id: 'lhopital',
        re: /(l'?h[oô]pital|0\/0|indeterminate|sin\s*x\s*\/\s*x|\blimit\b|\blimits\b)/i,
        title: "Limits & L'Hôpital's Rule",
        styles: [
            () => `
                <p><strong>L&rsquo;H&ocirc;pital&rsquo;s Rule &amp; Limits (Standard Worked Method):</strong></p>
                <p>When direct substitution gives an indeterminate form ($\\frac{0}{0}$ or $\\frac{\\infty}{\\infty}$), differentiate numerator and denominator separately:</p>
                $$\\lim_{x \\to a} \\frac{f(x)}{g(x)} = \\lim_{x \\to a} \\frac{f'(x)}{g'(x)}$$
                <p><strong>Worked Example:</strong> Evaluate $\\lim_{x \\to 0} \\frac{\\sin x}{x}$:</p>
                <ol>
                    <li>Check form at $x = 0$: $\\frac{\\sin 0}{0} = \\frac{0}{0}$ (indeterminate, so L&rsquo;H&ocirc;pital applies).</li>
                    <li>Differentiate top and bottom: $\\lim_{x \\to 0} \\frac{\\cos x}{1} = \\cos 0 = 1$.</li>
                </ol>
            `,
            () => `
                <p><strong>Let&rsquo;s explain Limits a simpler way (Algebraic / Series Method — No L&rsquo;H&ocirc;pital Needed):</strong></p>
                <p>A limit simply asks: <em>&ldquo;What value does the output get closer and closer to as $x$ approaches $a$, even if $x = a$ itself causes $0/0$?&rdquo;</em></p>
                <p><strong>Different Example (Factoring Cancellation):</strong> Evaluate $\\lim_{x \\to 2} \\frac{x^2 - 4}{x - 2}$:</p>
                <ol>
                    <li>Direct plug-in gives $\\frac{0}{0}$ because $(x - 2)$ is a hidden zero factor on top and bottom.</li>
                    <li>Factor the numerator: $\\frac{(x - 2)(x + 2)}{x - 2} = x + 2$ for $x \\neq 2$.</li>
                    <li>Now substitute $x = 2$: $2 + 2 = 4$.</li>
                </ol>
                <p>And for $\\frac{\\sin x}{x}$, using the small-angle approximation $\\sin x \\approx x - \\frac{x^3}{6}$, dividing by $x$ gives $1 - \\frac{x^2}{6} \\to 1$ as $x \\to 0$ — same exact answer $1$!</p>
            `,
            () => `
                <p><strong>Everyday Visual Intuition for Limits (Zoom-In / Table Check):</strong></p>
                <p>Imagine walking along a curve toward a tiny pinhole at $x = 0$:</p>
                <ul>
                    <li>Test tiny radian values for $\\frac{\\sin x}{x}$: at $x = 0.1$, $\\frac{\\sin(0.1)}{0.1} \\approx 0.9983$; at $x = 0.01$, it is $0.999983$.</li>
                    <li>The closer you step to $0$, the closer the ratio locks onto <strong>$1$</strong>.</li>
                    <li><strong>Exam Rule:</strong> Never apply L&rsquo;H&ocirc;pital if the denominator is NOT $0$ or $\\infty$ — always check the form first!</li>
                </ul>
            `
        ]
    },
    {
        id: 'integration',
        re: /(integrat|antiderivative|\\int|partial\s*fraction|definite\s*integral|area\s*under)/i,
        title: 'Integration & Antiderivatives',
        styles: [
            () => `
                <p><strong>Integration (Standard Formula &amp; Worked Steps):</strong></p>
                <p>Integration reverses differentiation: $\\int f(x)\\,dx = F(x) + C$ where $F'(x) = f(x)$, and $\\int_a^b f(x)\\,dx = F(b) - F(a)$.</p>
                <p><strong>NEB 5-Mark Example:</strong> Evaluate $\\int \\frac{dx}{x^2 - a^2}$:</p>
                <ol>
                    <li>Split via partial fractions: $\\frac{1}{x^2 - a^2} = \\frac{1}{2a}\\left(\\frac{1}{x - a} - \\frac{1}{x + a}\\right)$.</li>
                    <li>Integrate each term using $\\int \\frac{dx}{x - k} = \\ln|x - k|$:
                        $$\\int \\frac{dx}{x^2 - a^2} = \\frac{1}{2a}\\ln\\left|\\frac{x - a}{x + a}\\right| + C$$
                    </li>
                </ol>
            `,
            () => `
                <p><strong>Simpler Explanation of Integration (Area &amp; Reverse-Check Method):</strong></p>
                <p>Think of integration as <strong>adding up infinitely thin rectangles</strong> under a curve to find total area (or finding total distance from a speed graph).</p>
                <p><strong>Fresh Concrete Example:</strong> Find $\\int_0^3 2x\\,dx$:</p>
                <ul>
                    <li><strong>Method A (Antiderivative):</strong> Which function differentiates to $2x$? It&rsquo;s $x^2$. Evaluate from $0$ to $3$: $3^2 - 0^2 = 9$.</li>
                    <li><strong>Method B (Pure Geometry — No Calculus):</strong> The line $y = 2x$ from $x = 0$ to $x = 3$ forms a right triangle of base $3$ and height $6$. Triangle area $= \\frac{1}{2} \\times 3 \\times 6 = 9$!</li>
                </ul>
                <p>Both methods give the exact same result, <strong>$9$</strong>.</p>
            `,
            () => `
                <p><strong>Step-by-Step Habit to Never Get Stuck on Integrals:</strong></p>
                <ol>
                    <li><strong>Check direct table first</strong> ($x^n$, $\\sin x$, $e^x$, $\\frac{1}{x}$).</li>
                    <li><strong>Look for substitution ($u$-sub):</strong> Does the derivative of an inner piece sit right next to $dx$?</li>
                    <li><strong>Rational denominator like $x^2 - a^2$:</strong> Use partial fractions.</li>
                    <li><strong>Always verify by differentiating your answer back</strong> — and never forget $+ C$ on indefinite integrals!</li>
                </ol>
            `
        ]
    },
    {
        id: 'first_principle',
        re: /(first\s*principle|ab\s*initio|derivative\s*of\s*sin|differenti)/i,
        title: 'Derivatives & First Principles',
        styles: [
            () => `
                <p><strong>First-Principle Differentiation (Standard Proof):</strong></p>
                $$f'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}$$
                <p><strong>Worked Example — $\\frac{d}{dx}(\\sin x)$:</strong></p>
                <ol>
                    <li>Substitute $f(x) = \\sin x$: $\\lim_{h \\to 0} \\frac{\\sin(x+h) - \\sin x}{h}$.</li>
                    <li>Apply $\\sin C - \\sin D = 2\\cos\\left(\\frac{C+D}{2}\\right)\\sin\\left(\\frac{C-D}{2}\\right)$ to get $\\lim_{h \\to 0} \\cos\\left(x + \\frac{h}{2}\\right)\\cdot\\frac{\\sin(h/2)}{h/2}$.</li>
                    <li>Since $\\lim_{h \\to 0} \\frac{\\sin(h/2)}{h/2} = 1$, we obtain <strong>$\\cos x$</strong>.</li>
                </ol>
            `,
            () => `
                <p><strong>Simpler Explanation with a Different Example ($f(x) = x^2$):</strong></p>
                <p>First principles just measures the slope between two points on a curve — $(x, f(x))$ and a tiny step away $(x+h, f(x+h))$ — then shrinks the gap $h$ to $0$:</p>
                <ol>
                    <li>Rise over run: $\\frac{(x+h)^2 - x^2}{h} = \\frac{x^2 + 2xh + h^2 - x^2}{h}$.</li>
                    <li>Cancel $x^2$ and divide by $h$: $\\frac{2xh + h^2}{h} = 2x + h$.</li>
                    <li>Let $h \\to 0$: the $+h$ vanishes, leaving <strong>$2x$</strong>!</li>
                </ol>
                <p>Notice how this matches the power rule $\\frac{d}{dx}(x^2) = 2x$ identically.</p>
            `,
            () => `
                <p><strong>Intuitive Picture of a Derivative:</strong></p>
                <p>A secant line cuts a curve at two points (average speed over a trip). As you slide the second point right on top of the first ($h \\to 0$), the secant line turns into the <strong>tangent line</strong> touching at one point (your exact speedometer reading at that instant).</p>
            `
        ]
    },
    {
        id: 'conics',
        re: /(circle|tangent|parabola|ellipse|hyperbola|conic|eccentricity)/i,
        title: 'Conic Sections & Circle Tangency',
        styles: [
            () => `
                <p><strong>Conic Sections &amp; Circle Tangency (Standard Analytical Method):</strong></p>
                <ul>
                    <li><strong>Circle tangent condition:</strong> Line $y = mx + c$ touches $x^2 + y^2 = a^2$ iff perpendicular distance from center equals radius: $c^2 = a^2(1 + m^2) \\implies y = mx \\pm a\\sqrt{1 + m^2}$.</li>
                    <li><strong>Ellipse ($e < 1$):</strong> $\\frac{x^2}{a^2} + \\frac{y^2}{b^2} = 1$ with $b^2 = a^2(1 - e^2)$.</li>
                    <li><strong>Hyperbola ($e > 1$):</strong> $\\frac{x^2}{a^2} - \\frac{y^2}{b^2} = 1$ with $b^2 = a^2(e^2 - 1)$.</li>
                </ul>
            `,
            () => `
                <p><strong>Different Valid Method for Circle Tangency (Discriminant Method — No Distance Formula Needed):</strong></p>
                <p>A tangent line touches a circle at <strong>exactly one point</strong>, so substituting the line into the circle equation must produce a quadratic with <strong>discriminant $D = 0$</strong>!</p>
                <ol>
                    <li>Substitute $y = mx + c$ into $x^2 + y^2 = a^2$: $(1 + m^2)x^2 + 2mcx + (c^2 - a^2) = 0$.</li>
                    <li>Set $D = B^2 - 4AC = 0$: $4m^2c^2 - 4(1 + m^2)(c^2 - a^2) = 0$.</li>
                    <li>Simplify: $c^2 = a^2(1 + m^2)$ — the exact same tangency condition!</li>
                </ol>
            `,
            () => `
                <p><strong>Visual Intuition for Conic Eccentricity ($e$):</strong></p>
                <p>Think of eccentricity $e$ as how &ldquo;stretched&rdquo; the curve is:</p>
                <ul>
                    <li>$e = 0$: perfectly round <strong>Circle</strong></li>
                    <li>$0 < e < 1$: closed oval <strong>Ellipse</strong> (like planetary orbits)</li>
                    <li>$e = 1$: open U-shaped <strong>Parabola</strong> (like a thrown ball&rsquo;s path)</li>
                    <li>$e > 1$: two-branch <strong>Hyperbola</strong></li>
                </ul>
            `
        ]
    },
    {
        id: 'vectors',
        re: /(vector|skew\s*line|cross\s*product|dot\s*product|3d\s*plane|shortest\s*distance)/i,
        title: 'Vectors & 3D Geometry',
        styles: [
            () => `
                <p><strong>Vectors &amp; Shortest Distance Between Skew Lines (Formula Method):</strong></p>
                $$d = \\left|\\frac{(\\vec{a}_2 - \\vec{a}_1) \\cdot (\\vec{b}_1 \\times \\vec{b}_2)}{|\\vec{b}_1 \\times \\vec{b}_2|}\\right|$$
                <ol>
                    <li>Take $\\vec{b}_1 \\times \\vec{b}_2$ to get a vector perpendicular to both lines.</li>
                    <li>Project the connector $\\vec{a}_2 - \\vec{a}_1$ onto that unit normal vector.</li>
                    <li>If $d = 0$, the lines are coplanar (they intersect).</li>
                </ol>
            `,
            () => `
                <p><strong>Simpler Real-World Analogy for Skew Lines:</strong></p>
                <p>Imagine a highway overpass (line 1 heading East) and an underpass road below it (line 2 heading North). They are not parallel and they never collide!</p>
                <ul>
                    <li>The shortest gap between them is strictly <strong>straight up-and-down</strong> (perpendicular to both roads) — that vertical direction is what $\\vec{b}_1 \\times \\vec{b}_2$ computes.</li>
                    <li>Any slanted tape measure stretched from a point on the lower road to a point on the overpass ($\\vec{a}_2 - \\vec{a}_1$) has a vertical shadow equal to the exact clearance height $d$.</li>
                </ul>
            `,
            () => `
                <p><strong>Dot vs. Cross Product Quick Cheat:</strong></p>
                <ul>
                    <li><strong>Dot product ($\\vec{u} \\cdot \\vec{v} = |u||v|\\cos\\theta$):</strong> gives a <em>number</em>. Equals $0$ when vectors are perpendicular ($90^\\circ$).</li>
                    <li><strong>Cross product ($|\\vec{u} \\times \\vec{v}| = |u||v|\\sin\\theta$):</strong> gives a <em>new perpendicular vector</em> whose length equals the parallelogram area. Equals $\\vec{0}$ when parallel.</li>
                </ul>
            `
        ]
    },
    {
        id: 'complex',
        re: /(complex\s*number|de\s*moivre|cube\s*root|omega|\b\u03c9\b|imaginary)/i,
        title: "Complex Numbers & De Moivre's Theorem",
        styles: [
            () => `
                <p><strong>De Moivre&rsquo;s Theorem &amp; Cube Roots of Unity ($\\omega$):</strong></p>
                $$(\\cos\\theta + i\\sin\\theta)^n = \\cos(n\\theta) + i\\sin(n\\theta), \\quad 1 + \\omega + \\omega^2 = 0, \\quad \\omega^3 = 1$$
                <p>For powers of $\\omega$, divide the exponent by $3$ and keep only the remainder: $\\omega^{3k} = 1$, $\\omega^{3k+1} = \\omega$, $\\omega^{3k+2} = \\omega^2$.</p>
            `,
            () => `
                <p><strong>Simpler Geometric Way to Picture Complex Multiplication:</strong></p>
                <p>Instead of messy $(a+bi)(c+di)$ algebra, picture a complex number as an arrow of length $r$ at angle $\\theta$:</p>
                <ul>
                    <li>Multiplying by $(\\cos\\theta + i\\sin\\theta)$ simply <strong>rotates</strong> the arrow by angle $\\theta$.</li>
                    <li>So raising it to the $n$-th power rotates it $n$ times — landing at angle $n\\theta$! That is literally De Moivre&rsquo;s theorem.</li>
                    <li>For $\\omega$, the rotation is $120^\\circ$. Three rotations ($3 \\times 120^\\circ = 360^\\circ$) bring you right back to $1$ ($\\omega^3 = 1$), and the three symmetric arrows balance out to $0$ ($1 + \\omega + \\omega^2 = 0$).</li>
                </ul>
            `,
            () => `
                <p><strong>Worked Shortcut Example:</strong> Simplify $(1 + \\omega - \\omega^2)^3$:</p>
                <ol>
                    <li>Since $1 + \\omega + \\omega^2 = 0$, replace $1 + \\omega$ with $-\\omega^2$.</li>
                    <li>Inside becomes $-\\omega^2 - \\omega^2 = -2\\omega^2$.</li>
                    <li>Cube it: $(-2)^3(\\omega^2)^3 = -8(\\omega^3)^2 = -8(1)^2 = -8$.</li>
                </ol>
            `
        ]
    },
    {
        id: 'logic',
        re: /(logic|contrapositive|converse|inverse|implication|truth\s*table)/i,
        title: 'Mathematical Logic (Converse vs. Contrapositive)',
        styles: [
            () => `
                <p><strong>Conditional Statements in NEB Logic:</strong></p>
                <ul>
                    <li><strong>Original ($p \\to q$):</strong> If $p$, then $q$.</li>
                    <li><strong>Converse ($q \\to p$):</strong> NOT logically equivalent to $p \\to q$.</li>
                    <li><strong>Contrapositive ($\\sim q \\to \\sim p$):</strong> ALWAYS logically equivalent to $p \\to q$.</li>
                </ul>
            `,
            () => `
                <p><strong>Simpler Everyday Example (Rain &amp; Wet Ground):</strong></p>
                <p>Suppose it&rsquo;s true that: <em>&ldquo;If it rains ($p$), the road gets wet ($q$).&rdquo;</em></p>
                <ul>
                    <li><strong>Converse (False!):</strong> &ldquo;If the road is wet, it rained.&rdquo; — Wrong, someone could have washed a car!</li>
                    <li><strong>Contrapositive (Always True!):</strong> &ldquo;If the road is NOT wet, it did NOT rain.&rdquo; — Guaranteed true!</li>
                </ul>
            `,
            () => `
                <p><strong>Number Example to Lock It In:</strong></p>
                <p>Statement: <em>&ldquo;If $x = 3$, then $x^2 = 9$.&rdquo;</em> (True)</p>
                <ul>
                    <li>Converse: &ldquo;If $x^2 = 9$, then $x = 3$.&rdquo; — False because $x$ could be $-3$!</li>
                    <li>Contrapositive: &ldquo;If $x^2 \\neq 9$, then $x \\neq 3$.&rdquo; — 100% True!</li>
                </ul>
            `
        ]
    },
    {
        id: 'venn',
        re: /(venn|set\s*theory|cardinality|inclusion|n\(a)/i,
        title: 'Sets & 3-Set Venn Diagrams',
        styles: [
            () => `
                <p><strong>3-Set Cardinality Formula (SEE Standard):</strong></p>
                $$n(A \\cup B \\cup C) = n(A) + n(B) + n(C) - n(A \\cap B) - n(B \\cap C) - n(C \\cap A) + n(A \\cap B \\cap C)$$
                <p>Fill the center triple overlap $x = n(A \\cap B \\cap C)$ first, then subtract $x$ from each 2-set overlap.</p>
            `,
            () => `
                <p><strong>Simpler Way to Avoid Double Counting (Concrete Survey Example):</strong></p>
                <p>Suppose 10 students like Math, 8 like Science, and 3 like BOTH:</p>
                <ul>
                    <li>If you just add $10 + 8 = 18$, you counted those 3 students twice!</li>
                    <li>Subtract the overlap once: $10 + 8 - 3 = 15$ students total.</li>
                    <li>With 3 circles, subtracting the 3 pairwise overlaps removes the center $x$ one time too many — so you add $+x$ back at the end!</li>
                </ul>
            `,
            () => `
                <p><strong>Exam Trap Check:</strong></p>
                <p>Watch for the word <strong>&ldquo;only&rdquo;</strong>: &ldquo;12 like Math and Science <em>only</em>&rdquo; means $n_0(M \\cap S) = 12$ (do NOT subtract $x$). Without &ldquo;only&rdquo;, write $12 - x$ inside the two-set region.</p>
            `
        ]
    }
];

function buildContextHeader(context, portal) {
    const parts = [];
    if (context?.gradeLabel) parts.push(context.gradeLabel);
    if (context?.subjectName) parts.push(context.subjectName);
    if (context?.chapterTitle) parts.push(`Chapter: ${context.chapterTitle}`);
    if (!parts.length) return '';
    return `<div class="ai-ctx-pill">Using context: ${esc(parts.join(' · '))}</div>`;
}

function searchCourseMaterial(state, classKey, query) {
    const words = String(query || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3 && !['what', 'where', 'when', 'which', 'about', 'how', 'does', 'this', 'that', 'with', 'from', 'explain', 'please', 'help', 'understand', 'still', 'another', 'class', 'grade', 'math', 'maths', 'tell', 'show'].includes(w));

    if (!words.length || !state?.portals) return [];

    const keysToSearch = classKey && state.portals[classKey]
        ? [classKey, ...Object.keys(state.portals).filter(k => k !== classKey)]
        : Object.keys(state.portals);

    const matches = [];
    for (const ck of keysToSearch) {
        const p = state.portals[ck];
        if (!p) continue;
        const gLabel = GRADE_LABELS[ck] || ck;

        (p.subjects || []).forEach(subj => {
            (subj.lessons || []).forEach(l => {
                const hay = `${l.code || ''} ${l.title || ''} ${subj.name || ''}`.toLowerCase();
                const score = words.reduce((acc, w) => acc + (hay.includes(w) ? 2 : 0), 0);
                if (score > 0) {
                    matches.push({
                        score: score + (ck === classKey ? 2 : 0),
                        grade: gLabel,
                        subject: subj.name,
                        title: `${l.code ? l.code + ': ' : ''}${l.title}`,
                        pdfCount: (l.pdfs || []).length,
                        videoCount: (l.videos || []).length,
                        kind: 'lesson'
                    });
                }
            });
        });

        (p.syllabusRows || []).forEach(r => {
            const hay = `${r.code || ''} ${r.name || ''} ${r.focus || ''}`.toLowerCase();
            const score = words.reduce((acc, w) => acc + (hay.includes(w) ? 1.5 : 0), 0);
            if (score > 0) {
                matches.push({
                    score: score + (ck === classKey ? 1 : 0),
                    grade: gLabel,
                    title: `${r.code ? r.code + ': ' : ''}${r.name || r.domain}`,
                    meta: `${r.hours || ''}${r.hours && r.marks ? ' · ' : ''}${r.marks || ''}`,
                    kind: 'syllabus'
                });
            }
        });
    }

    matches.sort((a, b) => b.score - a.score);
    const seen = new Set();
    return matches.filter(m => {
        const k = `${m.grade}|${m.title}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    }).slice(0, 4);
}

function generateTutorReply(message, history, context, state) {
    const rawQ = String(message || '').trim();
    const classKey = context?.classKey ? gradeToClassKey(context.classKey) : '';
    const portal = classKey ? state.portals?.[classKey] : null;
    const ctxWithLabel = {
        classKey,
        gradeLabel: context?.gradeLabel || (classKey ? GRADE_LABELS[classKey] : ''),
        subjectName: context?.subjectName || '',
        chapterTitle: context?.chapterTitle || ''
    };
    const ctxNote = buildContextHeader(ctxWithLabel, portal);

    // 1. Determine whether student is asking for a different explanation of the previous topic/problem
    const wantsReexplain = isReexplainRequest(rawQ) || isSameAsPreviousQuestion(rawQ, history);
    let effectiveQuestion = rawQ;
    let styleIdx = 0;

    if (wantsReexplain) {
        const prevQ = isReexplainRequest(rawQ) ? findLastSubstantiveUserQuestion(history) : rawQ;
        if (prevQ) {
            effectiveQuestion = prevQ;
            const prevSig = normalizePromptSignature(prevQ);
            styleIdx = Math.max(1, countPreviousExplanationsForSignature(prevSig, history));
        } else if (ctxWithLabel.chapterTitle) {
            effectiveQuestion = ctxWithLabel.chapterTitle;
            styleIdx = 1;
        } else {
            return {
                html: `${ctxNote}<p>I&rsquo;d be happy to explain it another way! Which specific problem, formula, or chapter step would you like me to re-explain?</p>`,
                topicSig: 'clarify_reexplain',
                styleIndex: 0
            };
        }
    }

    const q = effectiveQuestion;
    const ql = q.toLowerCase();
    const topicSig = normalizePromptSignature(q);

    // 2. Underspecified / missing details -> ask a short clarifying question
    if (/^(solve|find|calculate|compute|simplify|factor|evaluate|help\s*me\s*solve)(\s+(this|it|that|the|my|a|an|for))?(\s+(equation|problem|question|expression|value|answer|area|volume|derivative|integral|limit|x|y))?[\s!?.]*$/i.test(ql)
        || /^help(\s*me)?(\s*with\s*(math|maths|homework|this|it))?[\s!?.]*$/i.test(ql)) {
        return {
            html: `${ctxNote}<p>Sure — could you share the full expression, equation, or given values? Once you paste the exact problem, I&rsquo;ll walk through the steps clearly.</p>`,
            topicSig: 'clarify_missing_details',
            styleIndex: 0
        };
    }

    // 3. Direct Arithmetic (simple questions get direct answers!)
    const arith = tryDirectArithmetic(q);
    if (arith) {
        if (styleIdx > 0) {
            return {
                html: `${ctxNote}<p><strong>Checking $${esc(arith.expr)}$ another way:</strong></p><p>Follow order of operations (Brackets &rarr; Powers &rarr; Multiplication/Division &rarr; Addition/Subtraction). Evaluating each operation step-by-step confirms the exact value is <strong>$${arith.value}$</strong>.</p>`,
                topicSig,
                styleIndex: styleIdx
            };
        }
        return {
            html: `${ctxNote}<p><strong>$${esc(arith.expr)} = ${arith.value}$</strong></p>`,
            topicSig,
            styleIndex: 0
        };
    }

    // 4. Quadratic Equation Solver (3 distinct valid methods!)
    const quad = parseQuadraticEquation(q);
    if (quad) {
        const res = solveQuadraticResponse(quad, styleIdx, ctxNote);
        return { html: res.html, topicSig, styleIndex: styleIdx, method: res.methodLabel };
    }

    // 5. Linear Equation Solver (2 distinct methods!)
    const lin = parseLinearEquation(q);
    if (lin) {
        const res = solveLinearResponse(lin, styleIdx, ctxNote);
        return { html: res.html, topicSig, styleIndex: styleIdx, method: res.methodLabel };
    }

    // 6. Polynomial Derivative Solver (2 distinct methods!)
    const polyD = parsePolynomialDerivative(q);
    if (polyD) {
        const res = solvePolyDerivativeResponse(polyD, styleIdx, ctxNote);
        return { html: res.html, topicSig, styleIndex: styleIdx, method: res.methodLabel };
    }

    // 7. Live Zoom Classes query (reads live state.zoomClasses!)
    if (/(zoom|live\s*class|schedule|timing|upcoming\s*class)/i.test(ql)) {
        const list = (state.zoomClasses || []).filter(z => {
            if (z.status === 'cancelled') return false;
            if (!classKey) return true;
            return z.classKey === classKey || z.classKey === 'all';
        });
        if (list.length > 0) {
            return {
                html: `
                    ${ctxNote}
                    <p><strong>Upcoming Live Zoom Classes (Nepal Time):</strong></p>
                    <ul>
                        ${list.slice(0, 5).map(z => `<li><strong>${esc(z.title)}</strong> (${esc(z.subject)}) — ${esc(z.date)} at ${esc(z.startTime)} NPT (${z.durationMinutes} min) with ${esc(z.teacher)}</li>`).join('')}
                    </ul>
                    <p>Open <strong>Live Class Calendar</strong> while signed in to access your <strong>Join on Zoom</strong> button.</p>
                `,
                topicSig: 'zoom_schedule',
                styleIndex: 0
            };
        }
        return {
            html: `${ctxNote}<p>There are no upcoming live Zoom classes scheduled right now for this grade. Check the <strong>Live Class Calendar</strong> for updates.</p>`,
            topicSig: 'zoom_schedule',
            styleIndex: 0
        };
    }

    // 8. Plans / Membership query
    if (/(plan|pricing|gold|diamond|free\s*plan|membership|upgrade)/i.test(ql)) {
        const plans = state.plansConfig || {};
        return {
            html: `
                ${ctxNote}
                <p><strong>BPG EDUCARE Plans:</strong></p>
                <ul>
                    ${['free', 'gold', 'diamond'].map(id => {
                        const p = plans[id] || { name: id, price: '', description: '' };
                        return `<li><strong>${esc(p.name)} (${esc(p.price)}):</strong> ${esc(p.description)}</li>`;
                    }).join('')}
                </ul>
                <p>Click the <strong>Plans</strong> card on the homepage to compare full access.</p>
            `,
            topicSig: 'plans_info',
            styleIndex: 0
        };
    }

    // 9. Team / BPG Sir query
    if (/(team|founder|ceo|cco|cto|who\s+is\s+bpg|bishnu)/i.test(ql)) {
        const members = state.teamMembers || [];
        return {
            html: `
                ${ctxNote}
                <p><strong>BPG EDUCARE Leadership Team:</strong></p>
                <ul>
                    ${members.map(m => `<li><strong>${esc(m.name)}</strong> (${esc(m.role)}): ${esc(m.bio)}</li>`).join('')}
                </ul>
            `,
            topicSig: 'team_info',
            styleIndex: 0
        };
    }

    // 10. Multi-Style Curriculum Concepts (supports re-explaining with different method/example!)
    for (const concept of MULTI_STYLE_CONCEPTS) {
        if (concept.re.test(ql)) {
            const idx = styleIdx % concept.styles.length;
            const courseHits = searchCourseMaterial(state, classKey, q);
            const groundingHtml = courseHits.length > 0
                ? `<p style="font-size:0.84rem; color:var(--text-secondary); margin-top:8px;"><strong>Course Material Match:</strong> ${courseHits.slice(0, 2).map(h => `${esc(h.grade)} — ${esc(h.title)}`).join(' · ')}</p>`
                : '';
            return {
                html: `${ctxNote}${concept.styles[idx]()}${groundingHtml}`,
                topicSig,
                styleIndex: idx,
                conceptId: concept.id
            };
        }
    }

    // 11. Course Material Grounded Search (Syllabus, Renamed Lessons, Chapters)
    const courseHits = searchCourseMaterial(state, classKey, q);
    if (courseHits.length > 0) {
        const heading = styleIdx > 0
            ? `<p><strong>Here is a simpler breakdown from your BPG EDUCARE course material:</strong></p>`
            : `<p><strong>From BPG EDUCARE course material:</strong></p>`;
        return {
            html: `
                ${ctxNote}
                ${heading}
                <ul>
                    ${courseHits.map(m => `<li><strong>${esc(m.grade)}:</strong> ${esc(m.title)}${m.meta ? ` (${esc(m.meta)})` : ''}${m.kind === 'lesson' ? ` — ${m.pdfCount} PDF(s), ${m.videoCount} Video(s)` : ''}</li>`).join('')}
                </ul>
                <p>Ask me a specific problem or concept from any of these chapters and I&rsquo;ll walk through it step by step.</p>
            `,
            topicSig,
            styleIndex: styleIdx
        };
    }

    // 12. Out-of-scope / Not covered in course material — be honest and clear!
    const isNonMathOutOfScope = /(chemistry|organic|biology|anatomy|history|geography|nepali\s*grammar|english\s*essay|quantum\s*field|economics|accounting|stock\s*market|recipe|football|cricket)/i.test(ql);
    if (isNonMathOutOfScope) {
        return {
            html: `
                ${ctxNote}
                <p><strong>Note on Course Coverage:</strong> That topic isn&rsquo;t covered in the current BPG EDUCARE mathematics course material${ctxWithLabel.gradeLabel ? ` for ${esc(ctxWithLabel.gradeLabel)}` : ''}.</p>
                <p>If you&rsquo;d like help with your syllabus topics — such as Calculus, Algebra, Vectors, Conics, Trigonometry, Logic, or Mock Test problems — paste the question here and I&rsquo;ll solve or explain it step by step!</p>
            `,
            topicSig: 'out_of_scope',
            styleIndex: 0
        };
    }

    // 13. Greeting
    if (/^(hi|hello|hey|namaste|namaskar|good\s*(morning|afternoon|evening))[\s!?.]*$/i.test(ql)) {
        return {
            html: `
                ${ctxNote}
                <p><strong>Namaste!</strong> I&rsquo;m your BPG EDUCARE AI Tutor${ctxWithLabel.gradeLabel ? ` for <strong>${esc(ctxWithLabel.gradeLabel)}</strong>` : ''}.</p>
                <p>Ask me a math problem (like <em>&ldquo;solve x^2 - 5x + 6 = 0&rdquo;</em> or <em>&ldquo;derivative of 3x^2 + 4x&rdquo;</em>), a concept from your chapter, or say <em>&ldquo;explain another way&rdquo;</em> anytime you want a simpler approach.</p>
            `,
            topicSig: 'greeting',
            styleIndex: 0
        };
    }

    // 14. Clear fallback when question is outside loaded course material or needs specifics
    return {
        html: `
            ${ctxNote}
            <p>I didn&rsquo;t find an exact match for that in the loaded BPG EDUCARE course material${ctxWithLabel.gradeLabel ? ` (${esc(ctxWithLabel.gradeLabel)})` : ''}.</p>
            <p>Could you share the exact math problem, formula, or chapter name you&rsquo;re working on? For example:</p>
            <ul>
                <li><em>&ldquo;Solve x^2 - 5x + 6 = 0&rdquo;</em></li>
                <li><em>&ldquo;Find the derivative of 3x^2 + 4x - 1&rdquo;</em></li>
                <li><em>&ldquo;Explain L&rsquo;H&ocirc;pital&rsquo;s rule&rdquo;</em> (and then <em>&ldquo;explain another way&rdquo;</em>)</li>
            </ul>
        `,
        topicSig,
        styleIndex: 0
    };
}

module.exports = function aiTutorHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token, x-student-email');

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
    }

    if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
        return;
    }

    try {
        const body = req.body || {};
        const message = String(body.message || '').trim();
        const history = Array.isArray(body.history) ? body.history : [];
        const context = body.context && typeof body.context === 'object' ? body.context : {};

        if (!message) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: 'Message is required.' }));
            return;
        }

        const state = readAcademyState();
        const reply = generateTutorReply(message, history, context, state);

        res.statusCode = 200;
        res.end(JSON.stringify({
            ok: true,
            replyHtml: reply.html,
            topicSig: reply.topicSig || '',
            styleIndex: Number(reply.styleIndex || 0),
            method: reply.method || ''
        }));
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: 'Tutor engine error: ' + err.message }));
    }
};
