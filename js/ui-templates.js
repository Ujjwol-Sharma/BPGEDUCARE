/* ==========================================================================
   BPG ACADEMY — MODULAR UI TEMPLATES MOUNTER (js/ui-templates.js)
   Strict Single-Class Dedicated Architecture:
   - Exactly 4 Dedicated Tabs per workspace (Syllabus, Units, Calendar, Notes)
   - Mandatory Single-Class Registration Wall
   - Restricted Access Modal for cross-program gating
   - PDF Viewer & Live Zoom Session modals
   ========================================================================== */

(function mountBpgModularTemplates() {
    const workspacesMount = document.getElementById('bpgWorkspacesMount');
    if (workspacesMount) {
        const classes = [
            { short: 'c10', key: 'class-10', label: 'Class 10', defaultHeading: 'Class 10 Mathematics' },
            { short: 'c11', key: 'class-11', label: 'Grade XI', defaultHeading: 'Grade XI Mathematics' },
            { short: 'c12', key: 'class-12', label: 'Grade XII', defaultHeading: 'Grade XII Mathematics' },
            { short: 'entrance', key: 'after-12', label: 'Entrance Prep', defaultHeading: 'Entrance Prep Mathematics' }
        ];

        workspacesMount.outerHTML = classes.map(c => `
    <main class="view-container portal-view" id="view-${c.short}" style="display:none;">
        <div class="container">
            <div class="workspace-top-bar" style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-bottom:20px;">
                <button type="button" class="btn-back" onclick="handleHomeClick()">&larr; Home</button>
                <div class="subject-selector-bar" id="subjectSelector-${c.key}"></div>
            </div>

            <!-- Simplified Subject Heading (Only Class + Subject Name) -->
            <div class="course-workspace-hero simplified-subject-hero">
                <div class="course-hero-content">
                    <h1 id="heroTitle-${c.key}">${c.defaultHeading}</h1>
                </div>
            </div>

            <!-- Simplified Subject Tabs (Notes, Mock Tests, Syllabus Grid, Live Class Calendar) -->
            <div class="understated-tab-strip" role="tablist" aria-label="${c.label} Navigation">
                <button class="strip-tab-btn active" id="tab-${c.short}-notes" onclick="switchClassTab('${c.short}', 'notes', this)">
                    Notes
                </button>
                <button class="strip-tab-btn" id="tab-${c.short}-mocktests" onclick="switchClassTab('${c.short}', 'mocktests', this)">
                    Mock Tests
                </button>
                <button class="strip-tab-btn" id="tab-${c.short}-syllabus" onclick="switchClassTab('${c.short}', 'syllabus', this)">
                    Syllabus Grid
                </button>
                <button class="strip-tab-btn" id="tab-${c.short}-live" onclick="switchClassTab('${c.short}', 'live', this)">
                    Live Class Calendar
                </button>
            </div>

            <div id="classContentPanes-${c.short}">
                <div class="portal-tab-pane active" id="pane-${c.short}-notes">
                    <div id="notesContainer-${c.key}"></div>
                </div>
                <div class="portal-tab-pane" id="pane-${c.short}-mocktests">
                    <div id="mockTestsContainer-${c.key}"></div>
                </div>
                <div class="portal-tab-pane" id="pane-${c.short}-syllabus">
                    <div id="syllabusContainer-${c.key}"></div>
                </div>
                <div class="portal-tab-pane" id="pane-${c.short}-live">
                    <div id="calendarContainer-${c.key}"></div>
                </div>
            </div>
        </div>
    </main>
        `).join('\n');
    }

    const modalsMount = document.getElementById('bpgModalsMount');
    if (modalsMount) {
        modalsMount.outerHTML = `
    <!-- ==========================================================================
         DOCKED UTILITIES: BPG AI ASSISTANT & MINI SCIENTIFIC CALCULATOR
         ========================================================================== -->
    <div class="floating-dock-container" id="floatingDock">
        <a href="https://wa.me/9779866064252?text=Namaste%20BPG%20Sir%2C%20I%20have%20an%20academic%20inquiry%20regarding%20BPG%20EDUCARE" target="_blank" rel="noopener" id="floatingWhatsappBtn" class="floating-dock-btn whatsapp-btn" title="Contact on WhatsApp (+977 9866064252)" aria-label="Contact on WhatsApp">
            <i class="fa-brands fa-whatsapp" aria-hidden="true"></i>
        </a>
        <button type="button" id="miniCalcBtn" class="floating-dock-btn calc-btn" onclick="toggleMiniCalculator()" title="Open Casio FX-991 Scientific Calculator" aria-label="Open Calculator">
            <i class="fa-solid fa-calculator" aria-hidden="true"></i>
        </button>
        <button type="button" id="btnSiteGuide" class="floating-dock-btn ai-trigger-btn" onclick="toggleWebsiteGuide()" title="Ask BPG EDUCARE AI">
            <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
            <span>Ask BPG AI</span>
        </button>
    </div>

    <!-- Interactive BPG EDUCARE AI Assistant Window -->
    <div class="site-guide-window" id="siteGuideWindow" role="dialog" aria-labelledby="guideTitle" aria-hidden="true">
        <div class="guide-window-header">
            <div class="guide-header-brand">
                <div class="guide-ai-avatar" aria-hidden="true">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                </div>
                <div class="guide-header-text">
                    <h3 id="guideTitle">BPG EDUCARE AI</h3>
                    <span class="guide-status-badge"><span class="guide-status-dot"></span> Online &middot; Ask about classes, syllabus &amp; schedules</span>
                </div>
            </div>
            <div class="guide-header-actions">
                <button type="button" class="guide-ctrl-btn" onclick="clearAiChat()" title="New Chat" aria-label="Reset conversation"><i class="fa-solid fa-rotate-right"></i></button>
                <button type="button" class="guide-ctrl-btn" onclick="closeWebsiteGuide()" title="Close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>

        <!-- Chat Stream Conversation Feed -->
        <div class="guide-chat-stream" id="guideChatStream">
            <div class="guide-msg bot-msg">
                <div class="guide-msg-avatar">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                </div>
                <div class="guide-msg-content">
                    <p><strong>Namaste!</strong> I&rsquo;m the <strong>BPG EDUCARE AI</strong>.</p>
                    <p>Ask me anything about <strong>Class 10, Class 11, Class 12, or IOE / CEE Entrance</strong> &mdash; syllabus units, marks weightage, live Zoom timings, notes, or how to enroll.</p>
                </div>
            </div>
        </div>

        <!-- Typing Indicator -->
        <div class="guide-typing-indicator" id="guideTypingIndicator" style="display:none;">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
        </div>

        <!-- Quick Suggested Prompts -->
        <div class="guide-quick-replies-wrap" id="quickReplyWrap">
            <div class="quick-reply-pills-row" id="quickReplyPills">
                <button type="button" class="guide-pill-btn" onclick="submitAiPromptText('Solve x^2 - 5x + 6 = 0')">Solve Quadratic</button>
                <button type="button" class="guide-pill-btn" onclick="submitAiPromptText('Explain another way')">Explain Another Way</button>
                <button type="button" class="guide-pill-btn" onclick="submitAiPromptText('Find the derivative of 3x^2 + 4x - 1')">Derivative Example</button>
                <button type="button" class="guide-pill-btn" onclick="submitAiPromptText('Explain L\'Hopital\'s rule')">L&rsquo;H&ocirc;pital&rsquo;s Rule</button>
                <button type="button" class="guide-pill-btn" onclick="submitAiPromptText('When are the upcoming live Zoom classes?')">Zoom Schedule</button>
            </div>
        </div>

        <!-- Live Interactive Question Input -->
        <form class="guide-input-bar" id="aiQueryForm" onsubmit="handleAiQuerySubmit(event)">
            <input type="text" id="aiQueryInput" class="guide-input-field" placeholder="Ask about any class, syllabus, Zoom time, or topic..." autocomplete="off" aria-label="Ask BPG Academy AI">
            <button type="submit" id="aiSendBtn" class="guide-send-btn" aria-label="Send message"><i class="fa-solid fa-arrow-up"></i></button>
        </form>
    </div>

    <!-- Redesigned Scientific & Basic Calculator -->
    <div class="calc-flyout-window calc-redesigned" id="calcFlyoutWindow" role="dialog" aria-label="BPG Calculator">
        <div class="calc-window-header" id="calcDragHandle">
            <div class="calc-header-left">
                <i class="fa-solid fa-calculator" aria-hidden="true"></i>
                <span>Calculator</span>
            </div>
            <div class="calc-header-controls">
                <button type="button" class="calc-mode-pill active" id="calcModeBasicBtn" onclick="setCalculatorMode('basic')">Basic</button>
                <button type="button" class="calc-mode-pill" id="calcModeSciBtn" onclick="setCalculatorMode('scientific')">Scientific</button>
                <button type="button" class="calc-angle-pill" id="calcAngleToggleBtn" onclick="toggleMiniCalcAngle()" title="Toggle Degrees / Radians">DEG</button>
                <button type="button" class="calc-hist-pill" id="calcHistoryToggleBtn" onclick="toggleMiniCalcHistory()" title="Calculation History" aria-label="Toggle History"><i class="fa-solid fa-clock-rotate-left"></i></button>
                <button type="button" class="calc-close-btn" onclick="toggleMiniCalculator()" aria-label="Close Calculator"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>
        <div class="calc-screen-area">
            <div class="calc-history-line" id="calcHistoryLine">DEG · Basic</div>
            <div class="calc-lcd-screen" id="calcScreen">0</div>
            <div class="calc-error-line" id="calcErrorLine" role="alert" style="display:none;"></div>
        </div>
        <div class="calc-history-drawer" id="calcHistoryDrawer" style="display:none;">
            <div class="calc-history-head">
                <span>History</span>
                <button type="button" class="calc-hist-clear-btn" onclick="clearMiniCalcHistory()">Clear</button>
            </div>
            <div class="calc-history-list" id="calcHistoryList">
                <div class="calc-history-empty">No calculations yet.</div>
            </div>
        </div>
        <div class="calc-sci-row" id="calcSciKeypad" style="display:none;">
            <button type="button" class="calc-key sci" onclick="calcAppend('sin(')">sin</button>
            <button type="button" class="calc-key sci" onclick="calcAppend('cos(')">cos</button>
            <button type="button" class="calc-key sci" onclick="calcAppend('tan(')">tan</button>
            <button type="button" class="calc-key sci" onclick="calcAppend('log(')">log</button>
            <button type="button" class="calc-key sci" onclick="calcAppend('ln(')">ln</button>
            <button type="button" class="calc-key sci" onclick="calcAppend('sqrt(')">&radic;</button>
            <button type="button" class="calc-key sci" onclick="calcAppend('^')">x<sup>y</sup></button>
            <button type="button" class="calc-key sci" onclick="calcAppend('^2')">x&sup2;</button>
            <button type="button" class="calc-key sci" onclick="calcAppend('pi')">&pi;</button>
            <button type="button" class="calc-key sci" onclick="calcAppend('e')">e</button>
        </div>
        <div class="calc-keypad-grid calc-basic-grid">
            <button type="button" class="calc-key func-clear" onclick="calcClear()">AC</button>
            <button type="button" class="calc-key func-del" onclick="calcBackspace()">DEL</button>
            <button type="button" class="calc-key op" onclick="calcAppend('%')">%</button>
            <button type="button" class="calc-key op" onclick="calcAppend('/')">÷</button>

            <button type="button" class="calc-key num" onclick="calcAppend('7')">7</button>
            <button type="button" class="calc-key num" onclick="calcAppend('8')">8</button>
            <button type="button" class="calc-key num" onclick="calcAppend('9')">9</button>
            <button type="button" class="calc-key op" onclick="calcAppend('*')">×</button>

            <button type="button" class="calc-key num" onclick="calcAppend('4')">4</button>
            <button type="button" class="calc-key num" onclick="calcAppend('5')">5</button>
            <button type="button" class="calc-key num" onclick="calcAppend('6')">6</button>
            <button type="button" class="calc-key op" onclick="calcAppend('-')">−</button>

            <button type="button" class="calc-key num" onclick="calcAppend('1')">1</button>
            <button type="button" class="calc-key num" onclick="calcAppend('2')">2</button>
            <button type="button" class="calc-key num" onclick="calcAppend('3')">3</button>
            <button type="button" class="calc-key op" onclick="calcAppend('+')">+</button>

            <button type="button" class="calc-key num" onclick="calcAppend('(')">(</button>
            <button type="button" class="calc-key num" onclick="calcAppend('0')">0</button>
            <button type="button" class="calc-key num" onclick="calcAppend(')')">)</button>
            <button type="button" class="calc-key num" onclick="calcAppend('.')">.</button>

            <button type="button" class="calc-key sci-ans" onclick="calcUseLastAns()">Ans</button>
            <button type="button" class="calc-key equals calc-equals-wide" onclick="calcEvaluate()">=</button>
        </div>
    </div>

    <!-- ==========================================================================
         AUTHENTICATION & STRICT SINGLE-CLASS REGISTRATION MODAL
         ========================================================================== -->
    <div class="modal-backdrop" id="authModal" role="dialog" aria-modal="true">
        <div class="modal-card auth-modal-card">
            <button class="btn-modal-dismiss" onclick="closeAuthModal()"><i class="fa-solid fa-xmark"></i></button>

            <!-- Tab Switcher -->
            <div class="auth-tabs-nav" role="tablist">
                <button type="button" class="auth-tab-btn active" id="authTabSignIn" onclick="switchAuthTab('signin')" role="tab" aria-selected="true">Sign In</button>
                <button type="button" class="auth-tab-btn" id="authTabSignUp" onclick="switchAuthTab('signup')" role="tab" aria-selected="false">Create Account</button>
            </div>

            <!-- PANE 1: SIGN IN -->
            <div id="authSignInContainer" class="auth-pane active">
                <h3 class="modal-title">Sign In</h3>
                <p class="modal-sub">
                    Sign in with your registered email and password.
                </p>

                <div id="googleOAuthSignInWrap" style="display:none;">
                    <button type="button" class="btn-google-oauth" id="btnGoogleSignIn" onclick="handleGoogleAuthClick('signin')">
                        <svg class="google-g-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"/><path fill="#FBBC05" d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"/></svg>
                        <span>Continue with Google</span>
                    </button>
                    <div class="auth-or-divider"><span>or with email</span></div>
                </div>

                <div id="signinErrorBanner" class="auth-inline-alert" style="display:none;"></div>

                <form onsubmit="handleSignInSubmit(event)">
                    <div class="modal-field">
                        <label for="signinEmail">Email</label>
                        <input type="email" id="signinEmail" class="modal-input" placeholder="student@gmail.com" required>
                    </div>

                    <div class="modal-field">
                        <label for="signinPassword">Password</label>
                        <input type="password" id="signinPassword" class="modal-input" placeholder="Enter your password" required>
                    </div>

                    <button type="submit" class="btn-submit-action" id="btnSignInSubmit">
                        <i class="fa-solid fa-right-to-bracket" aria-hidden="true" style="margin-right:6px;"></i>Sign In
                    </button>

                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px; font-size:0.84rem; gap:8px; flex-wrap:wrap;">
                        <button type="button" class="btn-link-action" onclick="openGmailOtpPane()">Sign in with Email Code</button>
                        <button type="button" class="btn-link-action" onclick="switchAuthTab('reset')">Reset password</button>
                        <button type="button" class="btn-link-action" onclick="switchAuthTab('signup')">Create account &rarr;</button>
                    </div>
                </form>
            </div>

            <!-- PANE 2: CREATE ACCOUNT (ONE ACCOUNT PER GMAIL, STARTS ON FREE) -->
            <div id="otpStep1Container" class="auth-pane" style="display:none;">
                <h3 class="modal-title">Create Account</h3>
                <p class="modal-sub">
                    New accounts start on the Free plan. One account is allowed per Gmail inbox.
                </p>

                <div id="googleOAuthSignUpWrap" style="display:none;">
                    <button type="button" class="btn-google-oauth" id="btnGoogleSignUp" onclick="handleGoogleAuthClick('signup')">
                        <svg class="google-g-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"/><path fill="#FBBC05" d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"/></svg>
                        <span>Continue with Google</span>
                    </button>
                    <div class="auth-or-divider"><span>or sign up with email OTP</span></div>
                </div>

                <div id="signupDuplicateBanner" class="auth-inline-alert" style="display:none;">
                    <p id="signupDuplicateMsg" style="margin:0 0 10px 0;">An account already exists for this Gmail address.</p>
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                        <button type="button" class="btn btn-primary" style="padding:7px 14px; font-size:0.82rem;" onclick="switchToSignInWithEmail()">Sign In</button>
                        <button type="button" class="btn btn-secondary" style="padding:7px 14px; font-size:0.82rem;" onclick="switchToResetWithEmail()">Reset Password</button>
                    </div>
                </div>

                <form onsubmit="handleRequestEmailOtp(event)">
                    <div class="modal-field">
                        <label for="signupName">Full Name</label>
                        <input type="text" id="signupName" class="modal-input" placeholder="Your name" required>
                    </div>

                    <div class="modal-field">
                        <label for="signupGrade">Class</label>
                        <select id="signupGrade" class="modal-input" required>
                            <option value="Class 12" selected>Class 12 (NEB Mat. 102)</option>
                            <option value="Class 11">Class 11 (NEB Mat. 101)</option>
                            <option value="Class 10" id="signupOpt-class-10">Class 10 (Locked — Temporarily unavailable)</option>
                            <option value="After 12" id="signupOpt-after-12">Entrance Prep (Locked — Temporarily unavailable)</option>
                        </select>
                    </div>

                    <div class="modal-field">
                        <label for="signupEmail">Gmail / Email</label>
                        <input type="email" id="signupEmail" class="modal-input" placeholder="student@gmail.com" required>
                    </div>

                    <div class="modal-field">
                        <label for="signupPassword">Password</label>
                        <input type="password" id="signupPassword" class="modal-input" placeholder="Create a password" minlength="4" required>
                    </div>

                    <button type="submit" class="btn-submit-action" id="btnSendOtpSubmit">
                        Send Verification Code
                    </button>

                    <div style="text-align:center; margin-top:14px; font-size:0.84rem;">
                        <button type="button" class="btn-link-action" onclick="switchAuthTab('signin')">Already registered? Sign In</button>
                    </div>
                </form>
            </div>

            <!-- PANE 2B: PASSWORDLESS SIGN IN WITH 6-DIGIT EMAIL CODE -->
            <div id="googleLocalChooserContainer" class="auth-pane" style="display:none;">
                <h3 class="modal-title">Sign In with Email Code</h3>
                <p class="modal-sub" id="googlePaneSubtitle">
                    Enter your registered email address and we'll send a 6-digit login code to your inbox.
                </p>
                <div id="googleChooserErrorBanner" class="auth-inline-alert" style="display:none;"></div>
                <div id="googleOfficialBtnContainer" style="display:none; justify-content:center; margin:18px 0;"></div>
                <form id="googleGmailOtpForm" onsubmit="handleGmailOtpSubmit(event)">
                    <div class="modal-field">
                        <label for="googleLocalEmail">Registered Email</label>
                        <input type="email" id="googleLocalEmail" class="modal-input" placeholder="student@gmail.com" required>
                    </div>
                    <button type="submit" class="btn-submit-action" id="btnGoogleLocalSubmit">
                        Send 6-Digit Login Code
                    </button>
                </form>
                <div style="text-align:center; margin-top:14px; font-size:0.84rem;">
                    <button type="button" class="btn-link-action" onclick="switchAuthTab('signin')">&larr; Back to Sign In</button>
                </div>
            </div>

            <!-- PANE 3: RESET PASSWORD (REQUEST 6-DIGIT OTP) -->
            <div id="authResetContainer" class="auth-pane" style="display:none;">
                <h3 class="modal-title">Reset Password</h3>
                <p class="modal-sub">
                    Enter your registered Gmail address and a new password. We will verify it with a 6-digit code.
                </p>

                <div id="resetErrorBanner" class="auth-inline-alert" style="display:none;"></div>

                <form onsubmit="handleRequestPasswordResetOtp(event)">
                    <div class="modal-field">
                        <label for="resetEmail">Registered Email</label>
                        <input type="email" id="resetEmail" class="modal-input" placeholder="student@gmail.com" required>
                    </div>

                    <div class="modal-field">
                        <label for="resetNewPassword">New Password</label>
                        <input type="password" id="resetNewPassword" class="modal-input" placeholder="Enter a new password" minlength="4" required>
                    </div>

                    <button type="submit" class="btn-submit-action" id="btnResetOtpSubmit">
                        Send Reset Code
                    </button>

                    <div style="text-align:center; margin-top:14px; font-size:0.84rem;">
                        <button type="button" class="btn-link-action" onclick="switchAuthTab('signin')">&larr; Back to Sign In</button>
                    </div>
                </form>
            </div>

            <!-- STEP 2: ENTER & VERIFY 6-DIGIT OTP -->
            <div id="otpStep2Container" class="auth-pane" style="display:none;">
                <h3 class="modal-title" id="otpStep2Heading">Verify Your Email</h3>
                <p class="modal-sub" id="otpStep2Subtitle">
                    We've sent a 6-digit verification code to your email address. Enter the code to activate your account.
                </p>
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:14px; padding:10px 12px; background:var(--surface-soft, #f8f8fa); border:1px solid var(--border-subtle, #e6e6eb); border-radius:10px; font-size:0.82rem;">
                    <strong id="otpTargetEmailBadge" style="color:var(--text-primary); word-break:break-all;">your email</strong>
                    <span id="otpExpiryTimer" style="font-weight:600; color:var(--accent-primary, #4f46e5); white-space:nowrap;">Expires in 05:00</span>
                </div>

                <div id="otpVerifyErrorBanner" class="auth-inline-alert" style="display:none;"></div>

                <form onsubmit="handleVerifyEmailOtp(event)">
                    <div class="otp-boxes-grid" id="otpBoxesWrap">
                        <input type="text" maxlength="1" class="otp-digit-box" id="otpDigit0" inputmode="numeric" autocomplete="one-time-code" oninput="handleOtpBoxInput(0, this)" onkeydown="handleOtpBoxKeydown(0, event)" autofocus required>
                        <input type="text" maxlength="1" class="otp-digit-box" id="otpDigit1" inputmode="numeric" oninput="handleOtpBoxInput(1, this)" onkeydown="handleOtpBoxKeydown(1, event)" required>
                        <input type="text" maxlength="1" class="otp-digit-box" id="otpDigit2" inputmode="numeric" oninput="handleOtpBoxInput(2, this)" onkeydown="handleOtpBoxKeydown(2, event)" required>
                        <input type="text" maxlength="1" class="otp-digit-box" id="otpDigit3" inputmode="numeric" oninput="handleOtpBoxInput(3, this)" onkeydown="handleOtpBoxKeydown(3, event)" required>
                        <input type="text" maxlength="1" class="otp-digit-box" id="otpDigit4" inputmode="numeric" oninput="handleOtpBoxInput(4, this)" onkeydown="handleOtpBoxKeydown(4, event)" required>
                        <input type="text" maxlength="1" class="otp-digit-box" id="otpDigit5" inputmode="numeric" oninput="handleOtpBoxInput(5, this)" onkeydown="handleOtpBoxKeydown(5, event)" required>
                    </div>

                    <button type="submit" class="btn-submit-action" id="btnVerifyOtpSubmit">
                        Verify &amp; Activate Account
                    </button>

                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px; font-size:0.84rem; gap:8px;">
                        <button type="button" class="btn-resend-link" id="btnResendOtp" onclick="resendEmailOtpCode()">Resend Verification Code</button>
                        <button type="button" class="btn-link-action" onclick="switchAuthTab('signup')">&larr; Change Email</button>
                    </div>
                </form>
            </div>
        </div>
    </div>

    <!-- ==========================================================================
         SECTION LOCKED MODAL (CLASS 10 & ENTRANCE PREP TEMPORARY LOCK)
         ========================================================================== -->
    <div class="modal-backdrop" id="sectionLockedModal" role="dialog" aria-modal="true">
        <div class="modal-card" style="max-width:440px; padding:28px 24px; text-align:left;">
            <button class="btn-modal-dismiss" onclick="closeSectionLockedModal()"><i class="fa-solid fa-xmark"></i></button>
            <div style="margin-bottom:12px;">
                <span class="section-status-badge locked">Locked</span>
            </div>
            <h3 id="sectionLockedTitle" style="font-size:1.2rem; font-weight:600; color:var(--text-primary); margin-bottom:8px;">Section Locked</h3>
            <p id="sectionLockedMessage" style="font-size:0.92rem; line-height:1.6; color:var(--text-secondary); margin-bottom:20px;">
                Temporarily unavailable. This section is currently closed for all plans and will reopen soon.
            </p>
            <div style="display:flex; gap:10px; justify-content:flex-end;">
                <button type="button" class="btn btn-primary" onclick="closeSectionLockedModal()" style="padding:9px 18px; font-size:0.88rem;">
                    OK
                </button>
            </div>
        </div>
    </div>

    <!-- ==========================================================================
         PLAN COMPARISON MODAL (NO PUBLIC QR — TAP BUY TO OPEN SIGNED-IN CHECKOUT)
         ========================================================================== -->
    <div class="modal-backdrop" id="planComparisonModal" role="dialog" aria-modal="true">
        <div class="modal-card plan-comparison-card" style="max-width:860px; padding:28px;">
            <button class="btn-modal-dismiss" onclick="closePlanComparisonModal()"><i class="fa-solid fa-xmark"></i></button>
            <div style="margin-bottom:20px;">
                <h3 style="font-size:1.32rem; font-weight:700; margin:0 0 6px 0;">Choose a Plan</h3>
                <p id="planComparisonSubtitle" style="font-size:0.92rem; color:var(--text-secondary); margin:0;">
                    Compare Gold and Diamond access across open sections.
                </p>
            </div>
            <div class="plan-compare-grid" id="planComparisonGrid"></div>
            <div class="plan-payment-box" id="planPaymentBox">
                <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px;">
                    <div style="max-width:540px;">
                        <strong style="display:block; font-size:0.94rem; margin-bottom:4px;">Ready to upgrade?</strong>
                        <p style="font-size:0.84rem; color:var(--text-secondary); margin:0;">
                            Tap <strong>Buy</strong> on your preferred plan to open secure eSewa checkout and WhatsApp confirmation.
                        </p>
                    </div>
                    <button type="button" id="planBuySelectedBtn" class="btn btn-primary" onclick="openCheckoutModal(selectedComparisonPlan)" style="padding:10px 18px; font-size:0.88rem;">
                        Buy Selected Plan
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- ==========================================================================
         SIGNED-IN ESEWA + WHATSAPP CHECKOUT MODAL (QR SHOWN ONLY HERE)
         ========================================================================== -->
    <div class="modal-backdrop" id="checkoutModal" role="dialog" aria-modal="true">
        <div class="modal-card checkout-modal-card" style="max-width:560px; padding:28px;">
            <button class="btn-modal-dismiss" onclick="closeCheckoutModal()"><i class="fa-solid fa-xmark"></i></button>
            <span class="modal-head-tag" style="margin-bottom:10px; display:inline-block;">Checkout &middot; eSewa &amp; WhatsApp</span>
            <h3 id="checkoutPlanTitle" style="font-size:1.25rem; font-weight:700; margin:0 0 6px 0;">Upgrade Plan</h3>
            <p id="checkoutPlanPriceLine" style="font-size:0.95rem; font-weight:600; color:var(--text-primary); margin:0 0 16px 0;"></p>

            <div class="checkout-qr-box" id="checkoutQrBox">
                <img id="checkoutEsewaQrImg" src="" alt="eSewa Payment QR" class="checkout-qr-img" onerror="this.style.display='none'">
                <div class="checkout-qr-instructions">
                    <p style="margin:0 0 8px 0; font-size:0.86rem; line-height:1.5;">
                        Scan this QR with your <strong>eSewa app</strong> and include your <strong>Name, Class, Username, and Gmail</strong> in the payment remarks.
                    </p>
                    <div class="checkout-remarks-preview" id="checkoutRemarksPreview"></div>
                    <button type="button" class="btn btn-secondary" onclick="copyPaymentRemarks()" style="padding:7px 12px; font-size:0.8rem; margin-top:8px;">
                        <i class="fa-regular fa-copy"></i> Copy Payment Remarks
                    </button>
                </div>
            </div>

            <div class="modal-field" style="margin-top:16px;">
                <label for="checkoutTransactionId">eSewa Transaction ID (optional)</label>
                <input type="text" id="checkoutTransactionId" class="modal-input" placeholder="e.g. 0A9B8C7D">
            </div>

            <div id="checkoutStatusBanner" class="auth-inline-alert" style="display:none; margin-bottom:12px;"></div>

            <div style="display:flex; flex-direction:column; gap:10px; margin-top:14px;">
                <button type="button" id="btnCheckoutWhatsappConfirm" class="btn btn-primary" onclick="submitStaticEsewaPayment()" style="justify-content:center; padding:11px 16px; font-size:0.9rem;">
                    <i class="fa-brands fa-whatsapp"></i> I&rsquo;ve Paid &mdash; Continue to WhatsApp
                </button>
                <button type="button" class="btn btn-secondary" onclick="closeCheckoutModal()" style="justify-content:center; padding:9px 16px; font-size:0.85rem;">
                    Cancel
                </button>
            </div>
        </div>
    </div>

    <!-- ==========================================================================
         CLASS SWITCH REQUEST MODAL (ONE ACTIVE CLASS PER ACCOUNT)
         ========================================================================== -->
    <div class="modal-backdrop" id="restrictedAccessModal" role="dialog" aria-modal="true">
        <div class="modal-card" style="max-width:480px; padding:28px 24px; text-align:left;">
            <button class="btn-modal-dismiss" onclick="closeRestrictedAccessModal()"><i class="fa-solid fa-xmark"></i></button>
            <span class="modal-head-tag" style="margin-bottom:10px; display:inline-block;">One Active Class Rule</span>
            <h3 style="font-size:1.18rem; font-weight:700; color:var(--text-primary); margin-bottom:8px;">Switch Active Class</h3>
            <p id="restrictedAccessMessage" style="font-size:0.9rem; line-height:1.6; color:var(--text-secondary); margin-bottom:14px;"></p>

            <div class="switch-class-summary" id="switchClassSummaryBox" style="margin-bottom:14px;">
                <div><small>Current Class</small><strong id="switchCurrentClassLabel">Class 12</strong></div>
                <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
                <div><small>Requested Class</small><strong id="switchRequestedClassLabel">Class 11</strong></div>
            </div>

            <div id="switchRequestStatusBox" class="auth-inline-alert" style="display:none; margin-bottom:12px;"></div>

            <div class="modal-field" id="switchReasonWrap">
                <label for="switchRequestReason">Reason (optional)</label>
                <input type="text" id="switchRequestReason" class="modal-input" placeholder="e.g. Moving to Class 12 board batch">
            </div>

            <div style="display:flex; flex-direction:column; gap:10px; margin-top:10px;">
                <button type="button" id="btnSubmitClassSwitch" class="btn btn-primary" onclick="submitClassSwitchRequest()" style="padding:10px 16px; font-size:0.88rem; justify-content:center;">
                    Confirm &amp; Submit Switch Request
                </button>
                <button type="button" class="btn btn-secondary" onclick="openMyClassWorkspace(); closeRestrictedAccessModal();" style="padding:9px 16px; font-size:0.85rem; justify-content:center;">
                    Stay in Current Class
                </button>
            </div>
        </div>
    </div>

    <!-- Live Zoom Session Detail / Public Schedule Modal -->
    <div class="modal-backdrop" id="calendarSessionModal" role="dialog" aria-modal="true">
        <div class="modal-card" style="max-width: 720px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
                <span class="modal-head-tag" style="margin: 0;">Live Zoom Class Schedule (Nepal Time)</span>
                <button class="btn-modal-dismiss static" onclick="closeCalendarSessionModal()"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div id="calendarSessionModalBody" style="max-height: 70vh; overflow-y: auto;"></div>
        </div>
    </div>

    <!-- PDF / Formula Sheet Viewer Modal -->
    <div class="modal-backdrop pdf-reader-modal" id="pdfViewerModal" role="dialog" aria-modal="true">
        <div class="modal-card pdf-reader-card" style="max-width: 920px; width: 96%;">
            <div class="pdf-reader-bar" style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 12px; border-bottom: 1px solid var(--border-soft); margin-bottom: 12px; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span class="badge-free" id="pdfModalBadge" style="font-size: 0.72rem; padding: 2px 8px; border-radius: 999px;">Verified Resource</span>
                    <h3 id="pdfModalTitle" style="font-size: 1.05rem; margin: 0; color: var(--text-primary);">Mathematical Notes</h3>
                </div>
                <button class="btn-modal-dismiss static" onclick="closePdfViewerModal()"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <p id="pdfModalMeta" style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 10px; display:none;"></p>
            <div id="pdfModalBody" class="pdf-embed-wrapper" style="max-height: 74vh; overflow-y: auto; margin-bottom: 14px;"></div>
            <div style="display: flex; justify-content: flex-end; gap: 10px; flex-wrap: wrap; padding-top: 12px; border-top: 1px solid var(--border-soft);">
                <a href="#" id="pdfModalNewTabBtn" target="_blank" class="btn btn-secondary" style="font-size: 0.82rem; padding: 8px 14px; text-decoration: none; display:none;"><i class="fa-solid fa-up-right-from-square"></i> Open in New Tab</a>
                <a href="#" id="pdfModalDownloadBtn" class="btn btn-secondary" style="font-size: 0.82rem; padding: 8px 14px; text-decoration: none;"><i class="fa-solid fa-download"></i> Download PDF</a>
                <button class="btn btn-primary" onclick="closePdfViewerModal()" style="font-size: 0.82rem; padding: 8px 14px;">Close</button>
            </div>
        </div>
    </div>

    <!-- Video Player Modal -->
    <div class="modal-backdrop" id="videoPlayerModal" role="dialog" aria-modal="true">
        <div class="modal-card" style="max-width: 820px; padding: 24px;">
            <div style="display:flex; align-items:center; justify-content:space-between; padding-bottom:12px; border-bottom:1px solid var(--border-soft); margin-bottom:16px;">
                <h3 id="videoModalTitle" style="font-size:1.15rem; margin:0; color:var(--text-primary);">Lesson Video</h3>
                <button class="btn-modal-dismiss static" onclick="closeVideoPlayerModal()"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div id="videoModalBody" class="video-player-stage"></div>
        </div>
    </div>

    <!-- Toast Notification Container -->
    <div id="toastContainer" class="toast-container"></div>
`;
    }
})();
