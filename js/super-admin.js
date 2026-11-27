/* ==========================================================================
   BPG EDUCARE — SUPER ADMIN PORTAL CONTROLLER (js/super-admin.js)
   Strictly authenticated via x-super-admin-key -> /api/super-admin
   ========================================================================== */

const SA_STORAGE_KEY = 'bpg_super_admin_key_session';
let SA_KEY = '';
try { SA_KEY = sessionStorage.getItem(SA_STORAGE_KEY) || ''; } catch (e) {}
let SA_DATA = null;
let saPollTimer = null;

function saEsc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function saToast(msg, type = 'info') {
    const mount = document.getElementById('adminToastContainer');
    if (!mount) return;
    const div = document.createElement('div');
    div.className = `adm-toast ${type}`;
    div.textContent = msg;
    mount.appendChild(div);
    setTimeout(() => div.remove(), 3800);
}

function toggleSuperAdminTheme() {
    const next = (document.documentElement.getAttribute('data-theme') || 'light') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('bpg_theme', next); } catch (e) {}
}

function saHeaders() {
    return { 'Content-Type': 'application/json', 'x-super-admin-key': SA_KEY };
}

async function handleSuperAdminLogin(e) {
    if (e) e.preventDefault();
    const key = (document.getElementById('superAdminPasskeyInput')?.value || '').trim();
    const errEl = document.getElementById('superAdminLoginError');
    if (errEl) errEl.style.display = 'none';
    if (!key) return;
    const btn = document.getElementById('superAdminLoginBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Verifying...'; }
    try {
        const res = await fetch('/api/super-admin?_t=' + Date.now(), {
            cache: 'no-store',
            headers: { 'x-super-admin-key': key }
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
            throw new Error(data.error || 'Invalid Super Admin passkey.');
        }
        SA_KEY = key;
        try { sessionStorage.setItem(SA_STORAGE_KEY, key); } catch (e2) {}
        SA_DATA = data;
        document.getElementById('superAdminLoginSplash').style.display = 'none';
        document.getElementById('superAdminShell').style.display = 'block';
        renderAllSaViews();
        startSaPolling();
    } catch (err) {
        if (errEl) { errEl.textContent = err.message; errEl.style.display = 'block'; }
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-shield-halved" aria-hidden="true"></i> Unlock Super Admin Portal'; }
    }
}

function lockSuperAdminSession() {
    SA_KEY = '';
    try { sessionStorage.removeItem(SA_STORAGE_KEY); } catch (e) {}
    if (saPollTimer) clearInterval(saPollTimer);
    document.getElementById('superAdminShell').style.display = 'none';
    document.getElementById('superAdminLoginSplash').style.display = 'flex';
}

async function loadSuperAdminData(silent = false) {
    if (!SA_KEY) return;
    try {
        const res = await fetch('/api/super-admin?_t=' + Date.now(), {
            cache: 'no-store',
            headers: { 'x-super-admin-key': SA_KEY }
        });
        if (res.status === 403 || res.status === 401) {
            lockSuperAdminSession();
            return;
        }
        const data = await res.json();
        if (res.ok && data.ok) {
            SA_DATA = data;
            renderAllSaViews();
            const statusEl = document.getElementById('saSyncStatus');
            if (statusEl) statusEl.textContent = 'Synced · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }
    } catch (e) {
        if (!silent) saToast('Could not refresh Super Admin data.', 'error');
    }
}

function startSaPolling() {
    if (saPollTimer) clearInterval(saPollTimer);
    saPollTimer = setInterval(() => {
        if (document.visibilityState === 'visible') loadSuperAdminData(true);
    }, 5000);
}

function switchSaTab(tab) {
    ['users', 'admins', 'scheduled', 'audit', 'system'].forEach(t => {
        document.getElementById(`saTabBtn-${t}`)?.classList.toggle('active', t === tab);
        document.getElementById(`saPane-${t}`)?.classList.toggle('active', t === tab);
    });
}

function renderAllSaViews() {
    if (!SA_DATA) return;
    renderSaKpis();
    renderSaUsersTable();
    renderSaAdmins();
    renderSaScheduled();
    renderSaAudit();
    renderSaSystemControls();
}

function renderSaKpis() {
    const mount = document.getElementById('saKpiMount');
    if (!mount || !SA_DATA?.stats) return;
    const s = SA_DATA.stats;
    mount.innerHTML = `
        <div class="sa-kpi-card"><div class="sa-kpi-label">Total Users</div><div class="sa-kpi-val">${s.totalUsers}</div></div>
        <div class="sa-kpi-card"><div class="sa-kpi-label">Online Now</div><div class="sa-kpi-val" style="color:#16a34a;">${s.onlineNow}</div></div>
        <div class="sa-kpi-card"><div class="sa-kpi-label">OTP Verified</div><div class="sa-kpi-val">${s.otpVerifiedCount} / ${s.totalUsers}</div></div>
        <div class="sa-kpi-card"><div class="sa-kpi-label">Terms Accepted</div><div class="sa-kpi-val">${s.termsAcceptedCount} / ${s.totalUsers}</div></div>
        <div class="sa-kpi-card"><div class="sa-kpi-label">Padandas / Topper</div><div class="sa-kpi-val">${s.padandasCount} / ${s.topperCount}</div></div>
        <div class="sa-kpi-card"><div class="sa-kpi-label">Scheduled Queue</div><div class="sa-kpi-val">${s.scheduledCount}</div></div>
    `;
}

function renderSaUsersTable() {
    const tbody = document.getElementById('saUsersTbody');
    if (!tbody || !SA_DATA) return;
    const q = (document.getElementById('saUserSearch')?.value || '').trim().toLowerCase();
    const fClass = document.getElementById('saFilterClass')?.value || 'all';
    const fPlan = document.getElementById('saFilterPlan')?.value || 'all';
    const fOtp = document.getElementById('saFilterOtp')?.value || 'all';
    const fTerms = document.getElementById('saFilterTerms')?.value || 'all';
    const fOnline = document.getElementById('saFilterOnline')?.value || 'all';

    const list = (SA_DATA.accounts || []).filter(a => {
        if (fClass !== 'all' && a.classKey !== fClass) return false;
        if (fPlan !== 'all' && a.plan !== fPlan) return false;
        if (fOtp === 'yes' && a.otpVerified !== true) return false;
        if (fOtp === 'no' && a.otpVerified === true) return false;
        if (fTerms === 'yes' && a.termsAccepted !== true) return false;
        if (fTerms === 'no' && a.termsAccepted === true) return false;
        if (fOnline === 'online' && !a.isOnline) return false;
        if (q) {
            const hay = `${a.name} ${a.username} ${a.email} ${a.userId} ${a.ipAddress} ${a.currentSection} ${a.deviceInfo}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:22px; color:var(--adm-text-muted);">No matching students found.</td></tr>';
        return;
    }

    tbody.innerHTML = list.map(a => {
        const uid = saEsc(a.userId);
        const planLbl = a.plan === 'diamond' ? 'Topper' : (a.plan === 'gold' ? 'Padandas' : 'Free');
        const lastActive = a.lastActiveAt ? new Date(a.lastActiveAt).toLocaleString() : 'Never';
        const isSusp = a.accountStatus === 'suspended';
        const logs = Array.isArray(a.activityLog) ? a.activityLog.slice(0, 3) : [];
        return `
            <tr>
                <td>
                    <div><span class="${a.isOnline ? 'sa-online-dot' : 'sa-offline-dot'}"></span><strong>${saEsc(a.name)}</strong> <small>@${saEsc(a.username)}</small></div>
                    <small style="color:var(--adm-text-muted);">${saEsc(a.email)}</small><br>
                    <code style="font-size:0.7rem;">${uid}</code>
                </td>
                <td>
                    <div style="display:flex; flex-direction:column; gap:5px; max-width:140px;">
                        <select class="adm-select" style="padding:4px 6px; font-size:0.76rem;" onchange="saUpdateUser('${uid}', { classKey: this.value })">
                            <option value="class-12" ${a.classKey === 'class-12' ? 'selected' : ''}>Class 12</option>
                            <option value="class-11" ${a.classKey === 'class-11' ? 'selected' : ''}>Class 11</option>
                            <option value="after-12" ${a.classKey === 'after-12' ? 'selected' : ''}>IOE</option>
                        </select>
                        <select class="adm-select" style="padding:4px 6px; font-size:0.76rem;" onchange="saUpdateUser('${uid}', { plan: this.value })">
                            <option value="free" ${a.plan === 'free' ? 'selected' : ''}>Free</option>
                            <option value="gold" ${a.plan === 'gold' ? 'selected' : ''}>Padandas</option>
                            <option value="diamond" ${a.plan === 'diamond' ? 'selected' : ''}>Topper</option>
                        </select>
                        <label style="font-size:0.74rem; display:inline-flex; align-items:center; gap:5px; cursor:pointer;">
                            <input type="checkbox" ${a.ioeAccess || a.plan === 'diamond' ? 'checked' : ''} onchange="saUpdateUser('${uid}', { ioeAccess: this.checked })"> IOE Access
                        </label>
                    </div>
                </td>
                <td style="font-size:0.78rem;">
                    <div>OTP: <strong style="color:${a.otpVerified ? '#16a34a' : '#d97706'};">${a.otpVerified ? 'Verified' : 'Unverified'}</strong>
                        <button type="button" class="sa-btn-mini" style="margin-left:4px;" onclick="saUpdateUser('${uid}', { otpVerified: ${!a.otpVerified} })">${a.otpVerified ? 'Revoke' : 'Verify'}</button>
                    </div>
                    <div style="margin-top:4px;">Terms: <strong style="color:${a.termsAccepted ? '#16a34a' : '#dc2626'};">${a.termsAccepted ? 'Accepted' : 'Pending'}</strong></div>
                    <div style="margin-top:4px;">Status: <strong style="color:${isSusp ? '#dc2626' : '#16a34a'};">${isSusp ? 'Suspended' : 'Active'}</strong></div>
                    ${a.mustChangePassword ? '<div style="color:#d97706; font-weight:700; margin-top:2px;">Must Change Pwd</div>' : ''}
                </td>
                <td style="font-size:0.76rem; max-width:240px;">
                    <div><strong>${saEsc(a.currentSection || 'Idle')}</strong></div>
                    <div style="color:var(--adm-text-muted);">${saEsc(a.deviceInfo || 'Unknown')} &middot; IP: <code>${saEsc(a.ipAddress || '—')}</code></div>
                    <div style="color:var(--adm-text-muted);">Last active: ${saEsc(lastActive)}</div>
                    ${logs.length ? `<details style="margin-top:4px;"><summary style="cursor:pointer;">Activity Log (${a.activityLog.length})</summary>${logs.map(l => `<div style="font-size:0.7rem;">${saEsc(l.section)} · ${new Date(l.at).toLocaleTimeString()}</div>`).join('')}</details>` : ''}
                </td>
                <td>
                    <div class="sa-action-bar">
                        <button type="button" class="sa-btn-mini" onclick="saPostAction('FORCE_LOGOUT_USER', { userId: '${uid}' })">Force Logout</button>
                        <button type="button" class="sa-btn-mini primary" onclick="saSetTempPassword('${uid}', '${saEsc(a.username)}')">Temp Password</button>
                        <button type="button" class="sa-btn-mini" onclick="saPostAction('FORCE_PASSWORD_RESET', { userId: '${uid}' })">Force Reset</button>
                        <button type="button" class="sa-btn-mini" onclick="saPostAction('SEND_RESET_OTP', { userId: '${uid}' })">Send Reset OTP</button>
                        <button type="button" class="sa-btn-mini ${isSusp ? '' : 'danger'}" onclick="saUpdateUser('${uid}', { accountStatus: '${isSusp ? 'active' : 'suspended'}' })">${isSusp ? 'Unsuspend' : 'Suspend'}</button>
                        <button type="button" class="sa-btn-mini danger" onclick="saDeleteUser('${uid}', '${saEsc(a.username)}')">Delete</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

async function saPostAction(action, payload = {}) {
    try {
        const res = await fetch('/api/super-admin', {
            method: 'POST',
            headers: saHeaders(),
            body: JSON.stringify({ action, ...payload })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || 'Action failed.');
        saToast(data.message || 'Done.');
        await loadSuperAdminData(true);
        return data;
    } catch (err) {
        saToast(err.message, 'error');
        return null;
    }
}

async function saUpdateUser(userId, fields) {
    return saPostAction('UPDATE_USER_FULL', { userId, ...fields });
}

async function saSetTempPassword(userId, username) {
    const custom = prompt(`Set a temporary one-time password for @${username} (leave blank to auto-generate a secure code):`, '');
    if (custom === null) return;
    const data = await saPostAction('SET_TEMP_PASSWORD', { userId, tempPassword: custom.trim() });
    if (data && data.tempPassword) {
        prompt(`Temporary one-time password for @${username} (copy and share securely; stored strictly hashed; user MUST set a new password on next login):`, data.tempPassword);
    }
}

async function saDeleteUser(userId, username) {
    if (!confirm(`Permanently DELETE @${username}? This cannot be undone.`)) return;
    return saPostAction('DELETE_USER', { userId });
}

function renderSaAdmins() {
    const mount = document.getElementById('saAdminsMount');
    if (!mount || !SA_DATA) return;
    const admins = Array.isArray(SA_DATA.adminUsers) ? SA_DATA.adminUsers : [];
    if (admins.length === 0) {
        mount.innerHTML = '<div style="padding:16px; color:var(--adm-text-muted);">No delegated regular Admin accounts yet (Master Admin passkey remains active). Create one above.</div>';
        return;
    }
    mount.innerHTML = `<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Admin</th><th>Permissions</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        ${admins.map(a => `
            <tr>
                <td><strong>${saEsc(a.name)}</strong><br><small>${saEsc(a.email || '—')}</small></td>
                <td><code>${saEsc((a.permissions || []).join(', '))}</code></td>
                <td><span class="adm-status-pill ${a.active !== false ? 'open' : 'locked'}">${a.active !== false ? 'Active' : 'Revoked'}</span></td>
                <td>
                    ${a.active !== false
                        ? `<button type="button" class="sa-btn-mini danger" onclick="saPostAction('REVOKE_ADMIN', { adminId: '${saEsc(a.id)}' })">Revoke</button>`
                        : `<button type="button" class="sa-btn-mini primary" onclick="saPostAction('UPDATE_ADMIN', { adminId: '${saEsc(a.id)}', active: true })">Re-Activate</button>`}
                </td>
            </tr>
        `).join('')}
    </tbody></table></div>`;
}

async function handleSaCreateAdmin(e) {
    if (e) e.preventDefault();
    const name = document.getElementById('saNewAdminName')?.value.trim();
    const email = document.getElementById('saNewAdminEmail')?.value.trim();
    const passkey = document.getElementById('saNewAdminPasskey')?.value.trim();
    const permissions = (document.getElementById('saNewAdminPerms')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    const data = await saPostAction('CREATE_ADMIN', { name, email, passkey, permissions });
    if (data && data.ok) {
        e.target.reset();
    }
}

function renderSaScheduled() {
    const mount = document.getElementById('saScheduledMount');
    if (!mount || !SA_DATA) return;
    const list = Array.isArray(SA_DATA.scheduledQueue) ? SA_DATA.scheduledQueue : [];
    if (list.length === 0) {
        mount.innerHTML = '<div style="padding:18px; color:var(--adm-text-muted);">No upcoming scheduled items.</div>';
        return;
    }
    mount.innerHTML = `<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Title</th><th>Type</th><th>Scope</th><th>Scheduled (NPT)</th><th>Actions</th></tr></thead><tbody>
        ${list.map(it => `
            <tr>
                <td><strong>${saEsc(it.title)}</strong></td>
                <td>${saEsc(it.category)}</td>
                <td>${saEsc(it.scope)}</td>
                <td><code>${saEsc(it.publishAtNpt)}</code></td>
                <td>
                    <div class="sa-action-bar">
                        <button type="button" class="sa-btn-mini primary" onclick="saPostAction('PUBLISH_SCHEDULED_NOW', ${saEsc(JSON.stringify(it))})">Publish Now</button>
                        <button type="button" class="sa-btn-mini danger" onclick="saPostAction('CANCEL_SCHEDULE', ${saEsc(JSON.stringify(it))})">Cancel</button>
                    </div>
                </td>
            </tr>
        `).join('')}
    </tbody></table></div>`;
}

function renderSaAudit() {
    const mount = document.getElementById('saAuditMount');
    if (!mount || !SA_DATA) return;
    const pays = (SA_DATA.payments || []).slice(0, 30);
    const logs = (SA_DATA.auditLog || []).slice(0, 30);
    mount.innerHTML = `
        <h3 style="margin:0 0 8px; font-size:0.95rem;">Recent Payments (${pays.length})</h3>
        <div class="adm-table-wrap" style="margin-bottom:18px;"><table class="adm-table"><thead><tr><th>Order</th><th>Student</th><th>Plan &amp; Amount</th><th>Tx Code</th><th>Status</th></tr></thead><tbody>
            ${pays.map(p => `<tr><td><code>${saEsc(p.orderId || p.id)}</code></td><td>${saEsc(p.fullName || p.email)}</td><td>${saEsc(p.planLabel || p.planName)} · <strong>${saEsc(p.amount)}</strong></td><td><code>${saEsc(p.txCode || p.transactionId || '—')}</code></td><td>${saEsc(p.status)}</td></tr>`).join('') || '<tr><td colspan="5">No payments yet.</td></tr>'}
        </tbody></table></div>
        <h3 style="margin:0 0 8px; font-size:0.95rem;">Security Audit Log (${logs.length})</h3>
        <div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead><tbody>
            ${logs.map(l => `<tr><td><small>${new Date(l.timestamp).toLocaleString()}</small></td><td>${saEsc(l.actor)}</td><td><code>${saEsc(l.action)}</code></td><td>${saEsc(l.details)}</td></tr>`).join('') || '<tr><td colspan="4">No audit entries yet.</td></tr>'}
        </tbody></table></div>
    `;
}

function renderSaSystemControls() {
    const mount = document.getElementById('saSystemControlsMount');
    if (!mount || !SA_DATA?.systemControls) return;
    const sc = SA_DATA.systemControls;
    const promoLines = (sc.promoCodes || []).map(p => `${p.code}:${p.type === 'percent' ? p.value + '%' : p.value}:${p.planKey || 'all'}`).join('\n');
    mount.innerHTML = `
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:16px;">
            <div class="adm-card" style="margin:0; background:var(--adm-bg-subtle);">
                <h3 style="margin:0 0 8px; font-size:0.96rem;">Global Auth Version (Force Re-Login)</h3>
                <p style="font-size:0.82rem; color:var(--adm-text-muted); margin:0 0 10px;">Current <code>minAuthVersion</code>: <strong>v${sc.minAuthVersion}</strong>. Bumping this immediately signs out every logged-in student and requires them to re-login with their existing username + OTP + Terms.</p>
                <button type="button" class="btn-adm-dark" style="background:#dc2626;" onclick="if(confirm('Force ALL currently signed-in students to re-login?')) saPostAction('FORCE_RELOGIN_ALL')">
                    <i class="fa-solid fa-right-from-bracket"></i> Force Re-Login All Users (v${sc.minAuthVersion + 1})
                </button>
            </div>
            <div class="adm-card" style="margin:0; background:var(--adm-bg-subtle);">
                <h3 style="margin:0 0 8px; font-size:0.96rem;">Maintenance &amp; Single-Device Enforcement</h3>
                <label style="display:flex; align-items:center; gap:8px; margin-bottom:10px; font-size:0.86rem; cursor:pointer;">
                    <input type="checkbox" id="saMaintToggle" ${sc.maintenanceMode?.enabled ? 'checked' : ''}> Enable Site Maintenance Mode
                </label>
                <label style="display:flex; align-items:center; gap:8px; margin-bottom:12px; font-size:0.86rem; cursor:pointer;">
                    <input type="checkbox" id="saSingleDeviceToggle" ${sc.singleDeviceSession !== false ? 'checked' : ''}> Enforce Single-Device Active Session
                </label>
                <label class="adm-label">Promo Codes (CODE:AMOUNT or CODE:10%:all)</label>
                <textarea id="saPromoCodesArea" class="adm-input" rows="3" style="font-family:monospace; font-size:0.8rem;">${saEsc(promoLines)}</textarea>
                <button type="button" class="btn-adm-dark" style="margin-top:10px;" onclick="saveSaSystemControls()">Save Global Controls</button>
            </div>
        </div>
    `;
}

async function saveSaSystemControls() {
    const maintEnabled = Boolean(document.getElementById('saMaintToggle')?.checked);
    const singleDeviceSession = Boolean(document.getElementById('saSingleDeviceToggle')?.checked);
    const lines = (document.getElementById('saPromoCodesArea')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
    const promoCodes = lines.map(line => {
        const [rawCode, rawVal, rawPlan] = line.split(':').map(x => (x || '').trim());
        const isPct = rawVal.endsWith('%');
        const num = parseFloat(rawVal.replace('%', '')) || 0;
        return { code: rawCode.toUpperCase(), type: isPct ? 'percent' : 'flat', value: num, planKey: (rawPlan || 'all').toLowerCase(), active: true };
    }).filter(p => p.code && p.value > 0);
    await saPostAction('UPDATE_SYSTEM_CONTROLS', {
        maintenanceMode: { ...(SA_DATA?.systemControls?.maintenanceMode || {}), enabled: maintEnabled },
        singleDeviceSession,
        promoCodes
    });
}

document.addEventListener('DOMContentLoaded', () => {
    if (SA_KEY) {
        document.getElementById('superAdminPasskeyInput').value = SA_KEY;
        handleSuperAdminLogin(null);
    }
});
