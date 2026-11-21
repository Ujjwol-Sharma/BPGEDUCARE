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

    <!-- Draggable Mini Scientific Calculator Viewport -->
    <div class="calc-flyout-window" id="calcFlyoutWindow">
        <div class="calc-window-header" id="calcDragHandle">
            <span><i class="fa-solid fa-calculator"></i> Casio FX-991 Mini Solver</span>
            <button class="calc-close-btn" onclick="toggleMiniCalculator()"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="calc-screen-area">
            <div class="calc-history-line" id="calcHistoryLine">DEG</div>
            <div class="calc-lcd-screen" id="calcScreen">0</div>
        </div>
        <div class="calc-keypad-grid">
            <button class="calc-key op" onclick="calcAppend('sin(')">sin</button>
            <button class="calc-key op" onclick="calcAppend('cos(')">cos</button>
            <button class="calc-key op" onclick="calcAppend('tan(')">tan</button>
            <button class="calc-key op" onclick="calcAppend('sqrt(')">√</button>
            <button class="calc-key op" onclick="calcAppend('^')">xʸ</button>

            <button class="calc-key func" onclick="calcClear()">AC</button>
            <button class="calc-key func" onclick="calcBackspace()">DEL</button>
            <button class="calc-key op" onclick="calcAppend('(')">(</button>
            <button class="calc-key op" onclick="calcAppend(')')">)</button>
            <button class="calc-key op" onclick="calcAppend('/')">÷</button>

            <button class="calc-key" onclick="calcAppend('7')">7</button>
            <button class="calc-key" onclick="calcAppend('8')">8</button>
            <button class="calc-key" onclick="calcAppend('9')">9</button>
            <button class="calc-key op" onclick="calcAppend('*')">×</button>
            <button class="calc-key op" onclick="calcAppend('pi')">π</button>

            <button class="calc-key" onclick="calcAppend('4')">4</button>
            <button class="calc-key" onclick="calcAppend('5')">5</button>
            <button class="calc-key" onclick="calcAppend('6')">6</button>
            <button class="calc-key op" onclick="calcAppend('-')">-</button>
            <button class="calc-key op" onclick="calcAppend('e')">e</button>

            <button class="calc-key" onclick="calcAppend('1')">1</button>
            <button class="calc-key" onclick="calcAppend('2')">2</button>
            <button class="calc-key" onclick="calcAppend('3')">3</button>
            <button class="calc-key op" onclick="calcAppend('+')">+</button>
            <button class="calc-key equals" onclick="calcEvaluate()">=</button>

            <button class="calc-key span-two" onclick="calcAppend('0')">0</button>
            <button class="calc-key" onclick="calcAppend('.')">.</button>
            <button class="calc-key op" onclick="calcAppend('ln(')">ln</button>
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
                    Enter your registered email and password to open your class workspace.
                </p>

                <div id="signinErrorBanner" class="auth-inline-alert" style="display:none;"></div>

                <form onsubmit="handleSignInSubmit(event)">
                    <div class="modal-field">
                        <label for="signinEmail">Email</label>
                        <input type="email" id="signinEmail" class="modal-input" placeholder="student@gmail.com" required>
                    </div>

                    <div class="modal-field">
                        <label for="signinPassword">Password</label>
                        <input type="password" id="signinPassword" class="modal-input" placeholder="Enter your password" value="bpgstudent" required>
                    </div>

                    <button type="submit" class="btn-submit-action" id="btnSignInSubmit">
                        Sign In
                    </button>

                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px; font-size:0.84rem;">
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
                <h3 class="modal-title" id="otpStep2Heading">Verify Code</h3>
                <p class="modal-sub">
                    Enter the 6-digit code sent to <strong id="otpTargetEmailBadge" style="color:var(--text-primary);">your email</strong>.
                </p>

                <!-- Local Fallback OTP Alert Box -->
                <div class="local-otp-banner" id="otpLocalPreviewBanner" style="display:none;">
                    <div style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:3px;">Verification Code</div>
                    <div class="local-otp-code-highlight" id="otpPreviewCodeValue">894215</div>
                </div>

                <form onsubmit="handleVerifyEmailOtp(event)">
                    <div class="otp-boxes-grid" id="otpBoxesWrap">
                        <input type="text" maxlength="1" class="otp-digit-box" id="otpDigit0" inputmode="numeric" oninput="handleOtpBoxInput(0, this)" onkeydown="handleOtpBoxKeydown(0, event)" autofocus required>
                        <input type="text" maxlength="1" class="otp-digit-box" id="otpDigit1" inputmode="numeric" oninput="handleOtpBoxInput(1, this)" onkeydown="handleOtpBoxKeydown(1, event)" required>
                        <input type="text" maxlength="1" class="otp-digit-box" id="otpDigit2" inputmode="numeric" oninput="handleOtpBoxInput(2, this)" onkeydown="handleOtpBoxKeydown(2, event)" required>
                        <input type="text" maxlength="1" class="otp-digit-box" id="otpDigit3" inputmode="numeric" oninput="handleOtpBoxInput(3, this)" onkeydown="handleOtpBoxKeydown(3, event)" required>
                        <input type="text" maxlength="1" class="otp-digit-box" id="otpDigit4" inputmode="numeric" oninput="handleOtpBoxInput(4, this)" onkeydown="handleOtpBoxKeydown(4, event)" required>
                        <input type="text" maxlength="1" class="otp-digit-box" id="otpDigit5" inputmode="numeric" oninput="handleOtpBoxInput(5, this)" onkeydown="handleOtpBoxKeydown(5, event)" required>
                    </div>

                    <button type="submit" class="btn-submit-action" id="btnVerifyOtpSubmit">
                        Verify &amp; Continue
                    </button>

                    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px; font-size:0.84rem;">
                        <button type="button" class="btn-resend-link" onclick="resendEmailOtpCode()">Resend code</button>
                        <button type="button" class="btn-link-action" onclick="switchAuthTab('signup')">&larr; Back</button>
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
         PLAN COMPARISON MODAL (ONLY OPENED FROM RESTRICTED CONTENT "VIEW PLANS")
         ========================================================================== -->
    <div class="modal-backdrop" id="planComparisonModal" role="dialog" aria-modal="true">
        <div class="modal-card plan-comparison-card" style="max-width:860px; padding:28px;">
            <button class="btn-modal-dismiss" onclick="closePlanComparisonModal()"><i class="fa-solid fa-xmark"></i></button>
            <div style="margin-bottom:20px;">
                <h3 style="font-size:1.32rem; font-weight:700; margin:0 0 6px 0;">Choose a Plan</h3>
                <p id="planComparisonSubtitle" style="font-size:0.92rem; color:var(--text-secondary); margin:0;">
                    Compare Free, Gold, and Diamond access across open sections.
                </p>
            </div>
            <div class="plan-compare-grid" id="planComparisonGrid"></div>
            <div class="plan-payment-box" id="planPaymentBox">
                <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:16px;">
                    <div style="max-width:520px;">
                        <strong style="display:block; font-size:0.94rem; margin-bottom:4px;">Upgrade via eSewa / Khalti or WhatsApp</strong>
                        <p style="font-size:0.84rem; color:var(--text-secondary); margin:0;">
                            Send your payment screenshot and registered Gmail address on WhatsApp to activate your upgraded plan.
                        </p>
                    </div>
                    <div style="display:flex; align-items:center; gap:12px;">
                        <img src="images/payment_qr.png" alt="Payment QR" style="width:68px; height:68px; border-radius:8px; border:1px solid var(--border-subtle); object-fit:contain; background:#fff;" onerror="this.style.display='none'">
                        <a id="planUpgradeWhatsappLink" href="https://wa.me/9779866064252?text=Namaste%20BPG%20Sir%2C%20I%20would%20like%20to%20upgrade%20my%20BPG%20EDUCARE%20membership." target="_blank" rel="noopener" class="btn btn-primary" style="padding:10px 16px; font-size:0.86rem; text-decoration:none;">
                            <i class="fa-brands fa-whatsapp"></i> Confirm on WhatsApp (9866064252)
                        </a>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- ==========================================================================
         RESTRICTED ACCESS ALERT MODAL (SINGLE-CLASS DEDICATED ARCHITECTURE)
         ========================================================================== -->
    <div class="modal-backdrop" id="restrictedAccessModal" role="dialog" aria-modal="true">
        <div class="modal-card" style="max-width:440px; padding:28px 24px; text-align:left;">
            <button class="btn-modal-dismiss" onclick="closeRestrictedAccessModal()"><i class="fa-solid fa-xmark"></i></button>
            <h3 style="font-size:1.15rem; font-weight:600; color:var(--text-primary); margin-bottom:8px;">Different Class Program</h3>
            <p id="restrictedAccessMessage" style="font-size:0.88rem; line-height:1.6; color:var(--text-secondary); margin-bottom:20px;">
                Your ID is registered exclusively for <strong>Grade XII Mathematics</strong>. To enroll in a different program, please register a new account.
            </p>
            <div style="display:flex; flex-direction:column; gap:10px;">
                <button type="button" class="btn btn-primary" onclick="handleSwitchAccountRegister()" style="padding:10px 16px; font-size:0.86rem; justify-content:center;">
                    Register Account for This Class
                </button>
                <button type="button" class="btn btn-secondary" onclick="openMyClassWorkspace(); closeRestrictedAccessModal();" style="padding:9px 16px; font-size:0.85rem; justify-content:center;">
                    Return to My Workspace
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
        <div class="modal-card pdf-reader-card" style="max-width: 780px;">
            <div class="pdf-reader-bar" style="display: flex; align-items: center; justify-content: space-between; padding-bottom: 12px; border-bottom: 1px solid var(--border-soft); margin-bottom: 14px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="badge-free" id="pdfModalBadge" style="font-size: 0.72rem; padding: 2px 8px; border-radius: 999px;">Verified Resource</span>
                    <h3 id="pdfModalTitle" style="font-size: 1.1rem; margin: 0; color: var(--text-primary);">Mathematical Notes</h3>
                </div>
                <button class="btn-modal-dismiss static" onclick="closePdfViewerModal()"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <p id="pdfModalMeta" style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 14px;"></p>
            <div id="pdfModalBody" class="pdf-embed-wrapper" style="max-height: 55vh; overflow-y: auto; margin-bottom: 16px;"></div>
            <div style="display: flex; justify-content: flex-end; gap: 10px; padding-top: 12px; border-top: 1px solid var(--border-soft);">
                <a href="#" id="pdfModalDownloadBtn" class="btn btn-secondary" style="font-size: 0.82rem; padding: 8px 14px; text-decoration: none;"><i class="fa-solid fa-download"></i> Download Note / Formula Sheet</a>
                <button class="btn btn-primary" onclick="closePdfViewerModal()" style="font-size: 0.82rem; padding: 8px 14px;">Close Preview</button>
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
