const state = {
  accessToken: sessionStorage.getItem("talme_access") || "",
  csrfToken: sessionStorage.getItem("talme_csrf") || "",
  user: null,
  authMode: "login",
  selectedRole: "hr_manager",
  forgotEmail: "",
  theme: localStorage.getItem("talme_theme") || "light",
  candidateImportId: "",
  hrEmployees: [],
  hrEmployeeVisibleCount: 50,
  hrEmployeeSearchQuery: "",
  hrEmployeePagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
  hrShowDuplicates: false,
  hrTalentPage: 1,
  hrTalentSection: "new",
  hrTalentStage: "all",
  hrTalentView: "list",
  hrTalentFilters: { locations: [], skills: [], experiences: [], company: "", designation: "", cv: "", sort: "relevance" },
  hrTalentSelected: new Set(),
  hrAdvancedSearch: null,
  hrCandidateSearchDraft: null,
  hrAdvancedApplied: false,
  expandedEmployeeSkills: new Set(),
  hrImportConfirmation: "",
  profileCount: Number(localStorage.getItem("talme_profile_count")) || 1501,
  skipUnloadLogout: false,
  unloadLogoutSent: false
};

localStorage.removeItem("talme_access");
localStorage.removeItem("talme_csrf");
localStorage.removeItem("talme_accounts");

const roleTabs = [
  ["hr_manager", "Talme HR"],
  ["super_admin", "Admin"]
];

const registerTypes = [
  ["candidate", "Candidate Registration"],
  ["employer", "Employer Registration"],
  ["recruiter", "Recruiter Registration"],
  ["employee", "Employee Registration (Invite Only)"],
  ["company", "Company Registration"]
];

const dashboardTitles = {
  "/candidate/dashboard": "Candidate Dashboard",
  "/employer/dashboard": "Employer Dashboard",
  "/recruiter/dashboard": "Recruiter Workspace",
  "/employee/dashboard": "Employee Self-Service",
  "/hr/dashboard": "HR Manager Console",
  "/company/dashboard": "Company Admin Console",
  "/platform/dashboard": "Platform Admin Console",
  "/admin/dashboard": "Super Admin Console"
};

const candidateContact = {
  name: "Vayalpadu Nirupa",
  email: "nirupa@gmail.com",
  phone: "9876543210",
  countryCode: "91"
};

let securityMonitorTimer = null;
let importCommitProgressTimer = null;
let hrEmployeesLiveTimer = null;
let hrEmployeesLiveLoading = false;
let hrEmployeeSearchTimer = null;
let hrEmployeeRequestId = 0;

document.body.classList.toggle("dark", state.theme === "dark");

function h(strings, ...values) {
  return strings.reduce((out, string, index) => out + string + (values[index] ?? ""), "");
}

function icon(name) {
  const aliases = { arrow: "ArrowRight", logout: "LogOut", checkCircle: "CircleCheck", eyeOff: "EyeOff", search: "Search", users: "Users", shield: "ShieldCheck", key: "KeyRound", x: "X", moon: "Moon", sun: "Sun", lock: "LockKeyhole" };
  const lucideIcon = window.lucide?.icons?.[aliases[name] || name];
  if (lucideIcon) return window.lucide.createElement(lucideIcon, { width: 18, height: 18, "aria-hidden": "true", "stroke-width": 1.8 }).outerHTML;
  const paths = {
    moon: "<path d='M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z'/>",
    sun: "<circle cx='12' cy='12' r='4'/><path d='M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'/>",
    shield: "<path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'/><path d='m9 12 2 2 4-5'/>",
    lock: "<rect x='3' y='11' width='18' height='11' rx='2'/><path d='M7 11V7a5 5 0 0 1 10 0v4'/>",
    users: "<path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M22 21v-2a4 4 0 0 0-3-3.87'/><path d='M16 3.13a4 4 0 0 1 0 7.75'/>",
    key: "<circle cx='7.5' cy='15.5' r='5.5'/><path d='m21 2-9.6 9.6'/><path d='m15.5 7.5 3 3L22 7l-3-3'/>",
    search: "<circle cx='11' cy='11' r='8'/><path d='m21 21-4.3-4.3'/>",
    x: "<path d='M18 6 6 18M6 6l12 12'/>",
    arrow: "<path d='M5 12h14'/><path d='m12 5 7 7-7 7'/>",
    logout: "<path d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'/><path d='m16 17 5-5-5-5'/><path d='M21 12H9'/>",
    plus: "<path d='M12 5v14'/><path d='M5 12h14'/>",
    checkCircle: "<path d='M22 11.1V12a10 10 0 1 1-5.9-9.1'/><path d='M22 4 12 14.01l-3-3'/>",
    eye: "<path d='M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z'/><circle cx='12' cy='12' r='3'/>",
    eyeOff: "<path d='m3 3 18 18'/><path d='M10.6 10.6A2 2 0 0 0 13.4 13.4'/><path d='M9.9 4.2A10.8 10.8 0 0 1 12 4c6.5 0 10 8 10 8a18.2 18.2 0 0 1-3.1 4.3'/><path d='M6.1 6.1A18.4 18.4 0 0 0 2 12s3.5 8 10 8a10.8 10.8 0 0 0 4.8-1.1'/>"
  };
  return `<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.shield}</svg>`;
}

function setTokens(payload) {
  state.accessToken = payload.accessToken || "";
  state.csrfToken = payload.csrfToken || "";
  state.user = payload.user || null;
  sessionStorage.setItem("talme_access", state.accessToken);
  sessionStorage.setItem("talme_csrf", state.csrfToken);
  sessionStorage.setItem("talme_user", JSON.stringify(state.user));
}

function clearStoredAuth() {
  sessionStorage.removeItem("talme_access");
  sessionStorage.removeItem("talme_csrf");
  sessionStorage.removeItem("talme_user");
  state.accessToken = "";
  state.csrfToken = "";
  state.user = null;
}

function logoutWhenLoginPageOpens() {
  const accessToken = state.accessToken;
  if (!accessToken && !state.user) return;
  clearStoredAuth();
  state.unloadLogoutSent = true;
  fetch("/api/auth/tab-close", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accessToken }),
    keepalive: true
  }).catch(() => {});
}

function sendTabCloseLogout() {
  if (!state.accessToken || state.unloadLogoutSent || state.skipUnloadLogout) return;
  state.unloadLogoutSent = true;
  const payload = JSON.stringify({ accessToken: state.accessToken });
  sessionStorage.removeItem("talme_access");
  sessionStorage.removeItem("talme_csrf");
  sessionStorage.removeItem("talme_user");
  if (navigator.sendBeacon) {
    const body = new Blob([payload], { type: "application/json" });
    navigator.sendBeacon("/api/auth/tab-close", body);
    return;
  }
  fetch("/api/auth/tab-close", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true
  }).catch(() => {});
}

function bindTabCloseLogout() {
  document.addEventListener("click", event => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!link) return;
    const href = link.getAttribute("href") || "";
    if (href.startsWith("#")) return;
    try {
      const url = new URL(link.href);
      if (url.origin === window.location.origin) {
        state.skipUnloadLogout = true;
        setTimeout(() => {
          state.skipUnloadLogout = false;
        }, 1500);
      }
    } catch {
    }
  }, true);

  // Keep browser refreshes, tab restores, and long-running uploads from revoking
  // the session unexpectedly. Explicit Logout still closes the session.
}

async function api(path, options = {}) {
  const body = options.body ? JSON.stringify(options.body) : undefined;
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;
  if (state.csrfToken) headers["X-CSRF-Token"] = state.csrfToken;
  let response = await fetch(path, {
    ...options,
    cache: "no-store",
    credentials: "same-origin",
    headers,
    body
  });
  if (response.status === 401 && await refreshSession()) {
    const retryHeaders = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };
    if (state.accessToken) retryHeaders.Authorization = `Bearer ${state.accessToken}`;
    if (state.csrfToken) retryHeaders["X-CSRF-Token"] = state.csrfToken;
    response = await fetch(path, {
      ...options,
      cache: "no-store",
      credentials: "same-origin",
      headers: retryHeaders,
      body
    });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message || payload.error || "Request failed"), { status: response.status, payload, retryAfter: Number(payload.retryAfter || response.headers.get("Retry-After") || 0) });
  return payload;
}

async function apiUpload(path, formData, options = {}) {
  const headers = {};
  if (state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;
  if (state.csrfToken) headers["X-CSRF-Token"] = state.csrfToken;
  let response = await fetch(path, {
    method: options.method || "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers,
    body: formData
  });
  if (response.status === 401 && await refreshSession()) {
    const retryHeaders = {};
    if (state.accessToken) retryHeaders.Authorization = `Bearer ${state.accessToken}`;
    if (state.csrfToken) retryHeaders["X-CSRF-Token"] = state.csrfToken;
    response = await fetch(path, {
      method: options.method || "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: retryHeaders,
      body: formData
    });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message || payload.error || "Upload failed"), { status: response.status, payload });
  return payload;
}

async function refreshSession() {
  try {
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin"
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.accessToken) return false;
    setTokens(payload);
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function candidatePhoneHref() {
  return `+${candidateContact.countryCode}${candidateContact.phone}`;
}

function candidateWhatsAppHref() {
  return `https://wa.me/${candidateContact.countryCode}${candidateContact.phone}`;
}

function revealCandidatePhone(button) {
  const phone = candidateContact.phone;
  document.querySelectorAll("[data-candidate-phone]").forEach(node => {
    node.hidden = false;
    node.textContent = phone;
    node.classList.add("visible");
  });
  button?.setAttribute("aria-pressed", "true");
}

function bindCandidateContactActions() {
  document.querySelectorAll("[data-call-candidate]").forEach(button => {
    button.addEventListener("click", () => {
      revealCandidatePhone(button);
      window.location.href = `tel:${candidatePhoneHref()}`;
    });
  });

  document.querySelectorAll("[data-whatsapp-candidate]").forEach(button => {
    button.addEventListener("click", () => {
      revealCandidatePhone(button);
      window.open(candidateWhatsAppHref(), "_blank", "noopener");
    });
  });

  document.querySelectorAll("[data-email-candidate]").forEach(button => {
    button.addEventListener("click", () => {
      window.location.href = `mailto:${candidateContact.email}?subject=${encodeURIComponent(`Regarding your profile, ${candidateContact.name}`)}`;
    });
  });
}

async function hydrate() {
  if (state.accessToken) {
    try {
      const payload = await api("/api/me");
      state.user = payload.user;
    } catch {
      clearStoredAuth();
    }
  } else if (!await refreshSession()) {
    clearStoredAuth();
  }
  render();
}

function render() {
  releaseEmployeeProfileResources();
  destroyAdminCharts();
  if (!window.location.pathname.startsWith("/admin/") && !window.location.pathname.startsWith("/platform/")) {
    if (securityMonitorTimer) clearInterval(securityMonitorTimer);
    securityMonitorTimer = null;
  }
  document.body.classList.toggle("dark", state.theme === "dark");
  const pathname = window.location.pathname;
  if (pathname === "/hr/search") return renderAdvancedCandidateSearch(document.querySelector("#app"));
  if (!pathname.startsWith("/hr")) stopHrEmployeesLive();
  if (pathname.startsWith("/hr/employees/")) return renderHrEmployeeRoute(pathname);
  if (pathname.includes("/dashboard")) return renderDashboard(pathname);
  if (pathname === "/") logoutWhenLoginPageOpens();
  document.querySelector("#app").innerHTML = landing();
  bindLanding();
}

function landing() {
  return h`
    <main class="site">
      ${nav()}
      <section class="hero" id="home">
        <div class="hero-copy">
          <div class="eyebrow">${icon("shield")} Enterprise identity suite</div>
          <h1>Premium authentication for hiring and HR teams.</h1>
          <p>Talme gives candidates, employers, recruiters, employees, HR managers, and admins one secure login experience with role-based access from day one.</p>
          <div class="actions">
            <button class="btn primary" data-open-login>${icon("lock")}Login</button>
            <button class="btn success" data-open-register>${icon("users")}Register</button>
          </div>
        </div>
        <div class="hero-visual" aria-label="Hiring portal preview">
          <div class="product-shot">
            <div class="shot-glow"></div>
            <div class="shot-top">
              <div class="shot-brand">
                <img src="/talme-logo.png" alt="Talme Technologies Pvt Ltd">
                <div><strong>Talme Hiring Portal</strong><span>Talent search and HR workspace</span></div>
              </div>
              <div class="shot-status" data-profile-count>${icon("users")} ${profileCountLabel()} employees</div>
            </div>
            <div class="shot-body">
              <aside class="shot-sidebar">
                <span class="active">Talent</span>
                <span>Shortlist</span>
                <span>Interviews</span>
                <span>Employees</span>
                <span>Reports</span>
              </aside>
              <section class="shot-main">
                <div class="shot-hero-card">
                  <div>
                    <small>Search Java Spring Bangalore</small>
                    <strong>248 matching profiles</strong>
                  </div>
                  <span>${icon("search")}</span>
                </div>
                <div class="metric-row">
                  <div><strong>36</strong><span>Shortlisted</span></div>
                  <div><strong>12</strong><span>Interviews</span></div>
                  <div><strong>4</strong><span>Offers</span></div>
                </div>
                <div class="workflow-card">
                  <div class="workflow-head"><strong>Hiring Pipeline</strong><span>Live</span></div>
                  <div class="route-line"><span>Praveen Singh Rajput</span><b>Java, Spring Boot</b></div>
                  <div class="route-line"><span>Ashwini H</span><b>Interview today</b></div>
                  <div class="route-line"><span>Mangesh Koparkar</span><b>CV updated</b></div>
                </div>
              </section>
            </div>
            <div class="floating-card one">${icon("search")} Saved search</div>
            <div class="floating-card two">${icon("shield")} Verified contacts</div>
            <div class="floating-card three">${icon("users")} HR follow-up</div>
          </div>
        </div>
      </section>
    </main>
  `;
}

function nav() {
  const authActions = state.user ? `
    <div class="profile-menu">
      <button class="profile-pill active" data-dashboard title="Open dashboard">
        <span class="avatar">${profileInitials(state.user.name)}</span>
        <span><strong>${state.user.name}</strong><small>${formatRole(state.user.primaryRole)}</small></span>
      </button>
      <button class="btn primary" data-dashboard>Dashboard</button>
      <button class="btn icon" title="Toggle theme" data-theme>${icon(state.theme === "dark" ? "sun" : "moon")}</button>
    </div>
  ` : `
    <div class="actions">
      <button class="btn icon" title="Toggle theme" data-theme>${icon(state.theme === "dark" ? "sun" : "moon")}</button>
    </div>
  `;
  return h`
    <nav class="nav">
      <div class="brand brand-full-logo">
        <img class="nav-company-logo" src="/talme-logo.png" alt="Talme Technologies Pvt Ltd">
      </div>
      ${authActions}
    </nav>
  `;
}

function bindLanding() {
  document.querySelectorAll("[data-open-login]").forEach(button => button.addEventListener("click", () => openAuth("login")));
  document.querySelectorAll("[data-open-register]").forEach(button => button.addEventListener("click", () => openAuth("register")));
  document.querySelectorAll("[data-dashboard]").forEach(button => button.addEventListener("click", () => navigate(state.user?.redirectTo || "/")));
  document.querySelectorAll("[data-logout]").forEach(button => button.addEventListener("click", logout));
  document.querySelector("[data-theme]")?.addEventListener("click", toggleTheme);
  loadPublicProfileCount();
}

function profileCountLabel() {
  return formatNumber(state.profileCount || 0);
}

async function loadPublicProfileCount() {
  const target = document.querySelector("[data-profile-count]");
  if (!target) return;
  try {
    const response = await fetch("/api/public/profile-count", {
      cache: "no-store",
      credentials: "same-origin"
    });
    const payload = await response.json().catch(() => ({}));
    const totalEmployees = payload.totalEmployees ?? payload.totalProfiles;
    if (!response.ok || typeof totalEmployees !== "number") return;
    state.profileCount = totalEmployees;
    localStorage.setItem("talme_profile_count", String(state.profileCount));
    target.innerHTML = `${icon("users")} ${profileCountLabel()} employees`;
    document.querySelectorAll("[data-hr-total-employees]").forEach(element => {
      element.textContent = `${profileCountLabel()} employees`;
    });
    updateTalentSummary();
  } catch {
  }
}

function profileInitials(name = "") {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "U";
}

function formatRole(role = "") {
  return role.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase()) || "User";
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem("talme_theme", state.theme);
  render();
}

function openAuth(mode = "login", role = state.selectedRole, message = "") {
  state.authMode = mode;
  state.selectedRole = role;
  const existing = document.querySelector(".modal-backdrop");
  if (existing) existing.remove();
  document.body.insertAdjacentHTML("beforeend", authModal(message));
  bindAuth();
}

function authModal(message = "") {
  return h`
    <div class="modal-backdrop">
      <section class="auth-shell" role="dialog" aria-modal="true" aria-label="Authentication">
        <aside class="auth-left">
          <div class="brand brand-on-dark"><img class="brand-logo full" src="/talme-logo.png" alt="Talme Technologies Pvt Ltd"></div>
          <div class="auth-left-copy">
            <h2>Your workspace.<br>One secure login.</h2>
            <p>Access your TALME account to manage hiring and HR.</p>
          </div>
          <div class="auth-left-badge">${icon("shield")} Secure account access</div>
        </aside>
        <section class="auth-right">
          <div class="modal-top">
            <div>
              <h2>${authTitle()}</h2>
              ${state.authMode === "login" ? '<p>Sign in to your TALME account.</p>' : ""}
            </div>
            <button class="btn icon" title="Close" data-close>${icon("x")}</button>
          </div>
          ${["login", "register"].includes(state.authMode) ? `
            <div class="tabs">
              ${roleTabs.map(([role, label]) => `<button class="tab ${state.selectedRole === role ? "active" : ""}" data-tab="${role}">${label}</button>`).join("")}
            </div>
          ` : ""}
          ${authContent(message)}
        </section>
      </section>
    </div>
  `;
}

function authTitle() {
  const titles = {
    login: "Welcome back",
    register: "Create account",
    forgot: "Forgot password",
    "forgot-otp": "Verify OTP",
    "forgot-reset": "Reset password"
  };
  return titles[state.authMode] || "Welcome back";
}

function authContent(message = "") {
  if (state.authMode === "register") return registerForm(message);
  if (state.authMode === "forgot") return forgotRequestForm(message);
  if (state.authMode === "forgot-otp") return forgotOtpForm(message);
  if (state.authMode === "forgot-reset") return forgotResetForm(message);
  return loginForm(message);
}

function loginForm(message) {
  return h`
    <form class="form" data-login-form>
      <input type="hidden" name="role" value="${state.selectedRole}">
      <div class="field">
        <label>Email</label>
        <input name="email" type="email" placeholder="Enter your email" autocomplete="email" required>
      </div>
      <div class="field">
        <label>Password</label>
        <div class="password-wrap">
          <input name="password" type="password" placeholder="Enter your password" autocomplete="current-password" required>
          <button type="button" class="password-toggle" data-toggle-password="password" title="Show password">${icon("eye")}</button>
        </div>
      </div>
      <div class="form-row">
        <label class="check"><input name="rememberMe" type="checkbox"> Remember me</label>
        <button type="button" class="link-button" data-forgot>Forgot password?</button>
      </div>
      <button class="btn primary" type="submit">Sign in ${icon("arrow")}</button>
      <p class="notice ${message ? "ok" : ""}" data-notice>${message}</p>
      <div class="auth-register-row">
        <span>New to TALME?</span>
        <button class="link-button" type="button" data-switch-register>Register</button>
      </div>
      <div class="auth-info">${icon("Info")} New accounts require admin approval before login.</div>
    </form>
  `;
}

function registrationTypeForRole(role) {
  return role === "hr_manager" ? "talme_hr" : "admin";
}

function registerForm(message) {
  return h`
    <form class="form" data-register-form>
      <input type="hidden" name="type" value="${registrationTypeForRole(state.selectedRole)}">
      <div class="field">
        <label>Full Name</label>
        <input name="name" autocomplete="name" required>
      </div>
      <div class="field">
        <label>Email</label>
        <input name="email" type="email" autocomplete="email" required>
      </div>
      <div class="field">
        <label>Mobile</label>
        <input name="phone" inputmode="tel" autocomplete="tel" required>
      </div>
      <div class="field">
        <label>Password</label>
        <div class="password-wrap">
          <input name="password" type="password" autocomplete="new-password" placeholder="Min 8 chars, uppercase, number, special character" required>
          <button type="button" class="password-toggle" data-toggle-password="password" title="Show password">${icon("eye")}</button>
        </div>
      </div>
      <div class="field">
        <label>Confirm Password</label>
        <div class="password-wrap">
          <input name="confirmPassword" type="password" autocomplete="new-password" required>
          <button type="button" class="password-toggle" data-toggle-password="confirmPassword" title="Show password">${icon("eye")}</button>
        </div>
      </div>
      <button class="btn primary" type="submit">${icon("users")}Register</button>
      <p class="notice ${message ? "ok" : ""}" data-notice>${message}</p>
      <button class="link-button" type="button" data-switch-login>Already registered?</button>
    </form>
  `;
}

function forgotRequestForm(message) {
  return h`
    <form class="form" data-forgot-request-form>
      <div class="field">
        <label>Registered Email</label>
        <input name="email" type="email" autocomplete="email" value="${escapeHtml(state.forgotEmail)}" placeholder="Enter your registered email" required>
        <small class="field-hint">We will send a 6-digit OTP to this email.</small>
      </div>
      <button class="btn primary" type="submit">${icon("key")}Send OTP</button>
      <p class="notice ${message ? "ok" : ""}" data-notice>${message}</p>
      <button class="link-button" type="button" data-switch-login>Back to login</button>
    </form>
  `;
}

function forgotOtpForm(message) {
  return h`
    <form class="form" data-forgot-otp-form>
      <div class="field">
        <label>OTP</label>
        <input name="otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="Enter 6-digit OTP" required>
        <small class="field-hint">OTP sent to ${escapeHtml(state.forgotEmail)}. It expires in 10 minutes.</small>
      </div>
      <button class="btn primary" type="submit">${icon("shield")}Verify OTP</button>
      <div class="form-row">
        <button class="link-button" type="button" data-resend-otp>Resend OTP</button>
        <button class="link-button" type="button" data-switch-login>Back to login</button>
      </div>
      <p class="notice ${message ? "ok" : ""}" data-notice>${message}</p>
    </form>
  `;
}

function forgotResetForm(message) {
  return h`
    <form class="form" data-forgot-reset-form>
      <div class="field">
        <label>New Password</label>
        <div class="password-wrap">
          <input name="password" type="password" autocomplete="new-password" placeholder="Min 8 chars, uppercase, number, special character" required>
          <button type="button" class="password-toggle" data-toggle-password="password" title="Show password">${icon("eye")}</button>
        </div>
      </div>
      <div class="field">
        <label>Confirm New Password</label>
        <div class="password-wrap">
          <input name="confirmPassword" type="password" autocomplete="new-password" required>
          <button type="button" class="password-toggle" data-toggle-password="confirmPassword" title="Show password">${icon("eye")}</button>
        </div>
      </div>
      <button class="btn primary" type="submit">${icon("lock")}Update password</button>
      <p class="notice ${message ? "ok" : ""}" data-notice>${message}</p>
      <button class="link-button" type="button" data-switch-login>Back to login</button>
    </form>
  `;
}

function bindAuth() {
  document.querySelector("[data-close]")?.addEventListener("click", () => document.querySelector(".modal-backdrop")?.remove());
  document.querySelectorAll("[data-tab]").forEach(button => button.addEventListener("click", () => {
    state.selectedRole = button.dataset.tab;
    openAuth(state.authMode);
  }));
  document.querySelector("[data-switch-register]")?.addEventListener("click", () => openAuth("register"));
  document.querySelector("[data-switch-login]")?.addEventListener("click", () => openAuth("login"));
  document.querySelector("[data-login-form]")?.addEventListener("submit", submitLogin);
  document.querySelector("[data-register-form]")?.addEventListener("submit", submitRegister);
  document.querySelector("[data-forgot-request-form]")?.addEventListener("submit", submitForgotRequest);
  document.querySelector("[data-forgot-otp-form]")?.addEventListener("submit", submitForgotOtp);
  document.querySelector("[data-forgot-reset-form]")?.addEventListener("submit", submitForgotReset);
  document.querySelector("[data-resend-otp]")?.addEventListener("click", resendForgotOtp);
  document.querySelector("[data-forgot]")?.addEventListener("click", openForgotPassword);
  document.querySelectorAll("[data-toggle-password]").forEach(button => button.addEventListener("click", togglePasswordVisibility));
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function normalizePasswordInput(value) {
  return String(value || "").trim();
}

function setNotice(text, ok = false) {
  const notice = document.querySelector("[data-notice]");
  if (!notice) return;
  notice.textContent = text;
  notice.className = `notice ${ok ? "ok" : "error"}`;
}

function authNoticeMessage(error, fallback) {
  const message = String(error?.message || error || "");
  if (error?.status === 429 && error.retryAfter > 0) {
    const minutes = Math.ceil(error.retryAfter / 60);
    return `${message} Retry in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
  }
  if (/already registered/i.test(message)) return "This email is already registered. Please login.";
  if (/email address is not registered|account not found/i.test(message)) return "Email address is not registered.";
  if (/invalid password|incorrect password/i.test(message)) return "Invalid password.";
  if (/invalid otp/i.test(message)) return "Invalid OTP.";
  if (/otp has expired/i.test(message)) return "OTP has expired. Please request a new OTP.";
  if (/email service is not configured/i.test(message)) return message;
  if (/database access is temporarily unavailable|data transfer quota exceeded|authentication database is not configured/i.test(message)) return message;
  if (error?.status >= 500) return "Something went wrong. Please try again later.";
  return message || fallback || "Something went wrong. Please try again later.";
}

function setSubmitLoading(form, isLoading, label) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) return;
  if (!button.dataset.idleHtml) button.dataset.idleHtml = button.innerHTML;
  button.disabled = isLoading;
  button.innerHTML = isLoading ? label : button.dataset.idleHtml;
}

async function submitLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = formData(form);
  body.password = normalizePasswordInput(body.password);
  body.role = state.selectedRole;
  body.rememberMe = form.rememberMe.checked;
  if (!body.email || !body.password) {
    return setNotice("Email and password are required.");
  }
  setSubmitLoading(form, true, "Logging in...");
  try {
    const payload = await api("/api/auth/login", { method: "POST", body });
    if (payload.requires2fa) return setNotice(payload.message);
    setNotice("Login successful.", true);
    setTokens(payload);
    document.querySelector(".modal-backdrop")?.remove();
    navigate(payload.user.redirectTo);
  } catch (error) {
    setNotice(authNoticeMessage(error, "Something went wrong. Please try again later."));
  } finally {
    setSubmitLoading(form, false);
  }
}

async function submitRegister(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = formData(form);
  body.password = normalizePasswordInput(body.password);
  body.confirmPassword = normalizePasswordInput(body.confirmPassword);
  if (!body.name || !body.email || !body.phone || !body.password || !body.confirmPassword) {
    return setNotice("Name, email, phone, password, and confirm password are required.");
  }
  if (body.password !== body.confirmPassword) {
    return setNotice("Password and Confirm Password must match");
  }
  if (!isStrongPassword(body.password)) {
    return setNotice("Password must be at least 8 characters and include uppercase, lowercase, number, and special character");
  }
  setSubmitLoading(form, true, "Creating account...");
  try {
    const result = await api("/api/auth/register", { method: "POST", body });
    openAuth("login", state.selectedRole, result.message);
  } catch (error) {
    setNotice(authNoticeMessage(error, "Something went wrong. Please try again later."));
  } finally {
    setSubmitLoading(form, false);
  }
}

function openForgotPassword() {
  state.forgotEmail = document.querySelector("[data-login-form] [name=email]")?.value.trim() || "";
  openAuth("forgot", state.selectedRole);
}

async function submitForgotRequest(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = formData(form);
  const email = String(body.email || "").trim().toLowerCase();
  if (!email) return setNotice("Email is required.");
  setSubmitLoading(form, true, "Sending OTP...");
  try {
    const payload = await api("/api/auth/forgot-password", { method: "POST", body: { email, role: state.selectedRole } });
    state.forgotEmail = email;
    openAuth("forgot-otp", state.selectedRole, payload.message);
  } catch (error) {
    setNotice(authNoticeMessage(error, "Something went wrong. Please try again later."));
  } finally {
    setSubmitLoading(form, false);
  }
}

async function resendForgotOtp(event) {
  const button = event.currentTarget;
  if (!state.forgotEmail) return openAuth("forgot", state.selectedRole);
  button.disabled = true;
  try {
    const payload = await api("/api/auth/forgot-password", { method: "POST", body: { email: state.forgotEmail, role: state.selectedRole } });
    setNotice(payload.message, true);
  } catch (error) {
    setNotice(authNoticeMessage(error, "Something went wrong. Please try again later."));
  } finally {
    button.disabled = false;
  }
}

async function submitForgotOtp(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = formData(form);
  const otp = String(body.otp || "").trim();
  if (!/^\d{6}$/.test(otp)) return setNotice("Invalid OTP.");
  setSubmitLoading(form, true, "Verifying...");
  try {
    const payload = await api("/api/auth/forgot-password/verify", {
      method: "POST",
      body: { email: state.forgotEmail, role: state.selectedRole, otp }
    });
    openAuth("forgot-reset", state.selectedRole, payload.message || "OTP verified.");
  } catch (error) {
    setNotice(authNoticeMessage(error, "Invalid OTP."));
  } finally {
    setSubmitLoading(form, false);
  }
}

async function submitForgotReset(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = formData(form);
  body.password = normalizePasswordInput(body.password);
  body.confirmPassword = normalizePasswordInput(body.confirmPassword);
  if (body.password !== body.confirmPassword) return setNotice("Password and Confirm Password must match");
  if (!isStrongPassword(body.password)) {
    return setNotice("Password must be at least 8 characters and include uppercase, lowercase, number, and special character");
  }
  setSubmitLoading(form, true, "Updating password...");
  try {
    const payload = await api("/api/auth/reset-password", {
      method: "POST",
      body: {
        email: state.forgotEmail,
        role: state.selectedRole,
        password: body.password,
        confirmPassword: body.confirmPassword
      }
    });
    openAuth("login", state.selectedRole, payload.message);
  } catch (error) {
    setNotice(authNoticeMessage(error, "Something went wrong. Please try again later."));
  } finally {
    setSubmitLoading(form, false);
  }
}

function isStrongPassword(password) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(String(password || ""));
}

function togglePasswordVisibility(event) {
  const button = event.currentTarget;
  const fieldName = button.dataset.togglePassword;
  const input = button.closest("form")?.querySelector(`[name="${fieldName}"]`);
  if (!input) return;
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  button.title = showing ? "Show password" : "Hide password";
  button.innerHTML = icon(showing ? "eye" : "eyeOff");
}

function navigate(path) {
  history.pushState({}, "", path);
  render();
}

async function renderDashboard(pathname) {
  const root = document.querySelector("#app");
  if (!state.accessToken || !state.user) {
    return renderLandingPage();
  }

  const title = dashboardTitles[pathname] || "Dashboard";
  const permission = {
    "/candidate/dashboard": "applications.track",
    "/employer/dashboard": "company.dashboard",
    "/recruiter/dashboard": "pipeline.manage",
    "/employee/dashboard": "employee.dashboard",
    "/hr/dashboard": "employees.manage",
    "/company/dashboard": "company.full_access",
    "/platform/dashboard": "platform.companies.manage",
    "/admin/dashboard": "admin.users.manage"
  }[pathname];
  if (permission && !state.user?.permissions?.includes(permission) && !state.user?.permissions?.includes("*")) {
    return renderForbidden("403 Forbidden");
  }

  if (pathname === "/candidate/dashboard") {
    return renderCandidateDashboard(root);
  }
  if (pathname === "/admin/dashboard") {
    return renderAdminDashboard(root, "Admin Control Center", "Super Admin");
  }
  if (pathname === "/platform/dashboard") {
    return renderAdminDashboard(root, "Platform Security Center", "Platform Admin");
  }
  if (pathname === "/hr/dashboard") {
    return renderHrDashboard(root);
  }

  root.innerHTML = h`
    <main class="site">
      ${nav()}
      <section class="dashboard">
        <div class="dashboard-head">
          <div>
            <h1>${title}</h1>
            <p class="notice ok">Signed in as ${state.user.name} with ${state.user.roles.map(role => role.name).join(", ")} access.</p>
          </div>
          <div class="actions">
            <button class="btn" data-activity>Login Activity</button>
            <button class="btn" data-devices>Device History</button>
            <button class="btn" data-logout-all>Logout All</button>
            <button class="btn primary" data-logout>${icon("logout")}Logout</button>
          </div>
        </div>
        <div class="module-grid">
          ${state.user.permissions.filter(item => item !== "*").slice(0, 24).map(permissionKey => `
            <article class="module">
              <strong>${formatPermission(permissionKey)}</strong>
              <span>${permissionKey}</span>
            </article>
          `).join("")}
        </div>
      </section>
    </main>
  `;
  bindLanding();
  document.querySelector("[data-logout]")?.addEventListener("click", logout);
  document.querySelector("[data-logout-all]")?.addEventListener("click", logoutAll);
  document.querySelector("[data-activity]")?.addEventListener("click", () => loadPanel("/api/auth/login-activity", "Login Activity"));
  document.querySelector("[data-devices]")?.addEventListener("click", () => loadPanel("/api/auth/devices", "Device History"));
}

function loadRoleWorkspace(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") || fallback;
  } catch {
    return fallback;
  }
}

function saveRoleWorkspace(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

function renderAdminDashboard(root, title = "Admin Control Center", role = "Super Admin") {
  renderAdminControlCenter(root, title, role);
}

function talentWorkspaceHeader(section = state.hrTalentSection) {
  const userName = state.user?.name || "HR Admin";
  return `<header class="talent-topbar">
    <a class="talent-brand" href="/hr/dashboard"><img src="/talme-logo.png" alt="Talme Technologies"><div><strong>Talme Hiring Portal</strong><span>Talent search and HR workspace</span></div></a>
    <nav class="talent-topnav" aria-label="Main navigation">
      ${[["dashboard", "House", "Home"], ["new", "UsersRound", "New Talent"], ["experienced", "BriefcaseBusiness", "Experienced Talent"], ["employees", "ContactRound", "Employees"], ["reports", "ChartNoAxesCombined", "Reports"]].map(([key, symbol, label]) => `<button type="button" class="${section === key ? "active" : ""}" data-talent-section="${key}">${icon(symbol)}${label}</button>`).join("")}
    </nav>
    <button class="talent-global-search" type="button" data-open-candidate-search title="Advanced candidate search">${icon("search")}<span>${escapeHtml(state.hrEmployeeSearchQuery || "Search candidates, skills, location...")}</span></button>
    <div class="talent-top-actions">
      <button class="talent-button primary" type="button" data-open-add-employee title="Add candidate" aria-label="Add candidate">${icon("plus")}<span>Add Candidate</span></button>
      <button class="talent-button" type="button" data-open-import title="Import Excel" aria-label="Import Excel">${icon("Upload")}<span>Import Excel</span></button>
      <details class="talent-user-menu">
        <summary><span class="talent-user-avatar">${escapeHtml(profileInitials(userName))}</span><span class="talent-user-name">${escapeHtml(userName)}<small>HR Admin</small></span>${icon("ChevronDown")}</summary>
        <div class="talent-menu-content"><button type="button" data-theme>${icon(state.theme === "dark" ? "sun" : "moon")}Toggle theme</button><button type="button" data-logout>${icon("logout")}Logout</button></div>
      </details>
    </div>
  </header>`;
}

function renderHrDashboard(root, options = {}) {
  state.hrEmployeeVisibleCount = 20;
  const section = state.hrTalentSection;
  const title = { new: "New Talent", experienced: "Experienced Talent", employees: "Employees", dashboard: "Dashboard", shortlist: "Shortlist", interviews: "Interviews", offers: "Offers", reports: "Reports", settings: "Settings" }[section] || "New Talent";
  const navigation = [["dashboard", "House", "Dashboard"], ["new", "UsersRound", "New Talent"], ["experienced", "BriefcaseBusiness", "Experienced Talent"], ["shortlist", "Star", "Shortlist"], ["interviews", "MessagesSquare", "Interviews"], ["offers", "ClipboardCheck", "Offers"], ["employees", "ContactRound", "Employees"], ["reports", "ChartNoAxesCombined", "Reports"], ["settings", "Settings", "Settings"]];
  const filters = state.hrTalentFilters;
  const filterOptions = (key, options) => options.map(([value, label]) => `<option value="${escapeHtml(value)}" ${filters[key] === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
  const filterGroup = (title, key, options, searchable = false) => `
    <details class="talent-filter-group" open>
      <summary>${title}${icon("ChevronDown")}</summary>
      ${searchable ? `<label class="talent-filter-search">${icon("search")}<input type="search" placeholder="Search ${title.toLowerCase()}..." aria-label="Search ${title.toLowerCase()} filters" data-filter-options="${key}"></label>` : ""}
      <div class="talent-filter-options" data-filter-option-list="${key}">
        ${options.map(([value, label]) => `<label><input type="checkbox" data-talent-checkbox="${key}" value="${escapeHtml(value)}" ${filters[key].includes(value) ? "checked" : ""}><span>${escapeHtml(label)}</span></label>`).join("")}
      </div>
    </details>`;
  const saved = loadRoleWorkspace(talentStorageKey("searches"), []);
  root.innerHTML = h`
    <main class="site hr-app talent-app">
      ${talentWorkspaceHeader(section)}
      <div class="talent-layout">
        <aside class="talent-navigation"><nav aria-label="Hiring workspace">${navigation.map(([key, symbol, label]) => `<button type="button" class="${section === key ? "active" : ""}" data-talent-section="${key}">${icon(symbol)}<span>${label}</span></button>`).join("")}</nav>
          <div class="talent-total"><span class="employee-live-dot"></span><div><strong data-hr-total-employees>${profileCountLabel()} employees</strong><small>Total employees</small></div></div>
          <span data-profile-count hidden></span>
        </aside>
        <aside class="talent-filters" aria-label="Candidate filters">
          <div class="talent-filters-head"><strong>${icon("SlidersHorizontal")}Filters</strong><button type="button" data-clear-talent-filters>Clear All</button></div>
          ${filterGroup("Work Experience", "experiences", [["0-0", "Fresher"], ["0-2", "0 - 2 years"], ["2-5", "2 - 5 years"], ["5-10", "5 - 10 years"], ["10-*", "10+ years"]])}
          ${filterGroup("Location", "locations", [["Bangalore", "Bangalore"], ["Hyderabad", "Hyderabad"], ["Pune", "Pune"], ["Chennai", "Chennai"], ["Mumbai", "Mumbai"], ["Delhi", "Delhi"], ["Noida", "Noida"]], true)}
          ${filterGroup("Skills", "skills", [["Java", "Java"], ["Python", "Python"], ["React", "React"], ["Node.js", "Node.js"], ["SQL", "SQL"], ["Spring", "Spring Boot"], ["JavaScript", "JavaScript"]], true)}
          <details class="talent-filter-group" open><summary>Current Company${icon("ChevronDown")}</summary><label class="talent-filter-search">${icon("search")}<input type="search" data-talent-filter="company" placeholder="Search company..." aria-label="Filter by company" value="${escapeHtml(filters.company)}"></label></details>
        </aside>
        <section class="talent-content">
          <div class="talent-page-heading"><div><h1>${title}</h1><p>Search and manage candidates. Find the right talent for your team.</p></div>
            <div class="talent-heading-actions"><details class="talent-saved-searches"><summary class="talent-button">Saved Searches${icon("ChevronDown")}</summary><div class="talent-menu-content"><button type="button" data-save-talent-search>${icon("BookmarkPlus")}Save current search</button>${saved.map((search, index) => `<button type="button" data-saved-talent-search="${index}">${icon("search")}${escapeHtml(search.name)}</button>`).join("")}</div></details><button class="talent-button talent-mobile-filters" type="button" data-toggle-talent-filters>${icon("SlidersHorizontal")}Filters</button></div>
          </div>
          ${section === "settings" ? `<section class="talent-settings"><h2>Workspace preferences</h2><label>Appearance<select data-talent-theme><option value="light" ${state.theme === "light" ? "selected" : ""}>Light</option><option value="dark" ${state.theme === "dark" ? "selected" : ""}>Dark</option></select></label><button class="talent-button" type="button" data-logout>${icon("logout")}Logout</button></section>` : `
          ${["dashboard", "reports"].includes(section) ? `<div class="talent-report" data-talent-report></div>` : ""}
          <nav class="talent-tabs" aria-label="Candidate status">${[["all", "All Candidates"], ["active", "Active"], ["shortlisted", "Shortlisted"], ["process", "In Process"], ["interview", "Interview"], ["hired", "Hired"]].map(([key, label]) => `<button type="button" data-talent-stage="${key}" class="${state.hrTalentStage === key ? "active" : ""}">${label} <span data-talent-stage-count="${key}"></span></button>`).join("")}</nav>
          <form class="talent-search-form"><label>${icon("search")}<input type="search" data-hr-search readonly placeholder="Search by name, skills, designation, company, location, email, phone..." aria-label="Open advanced candidate search" value="${escapeHtml(state.hrEmployeeSearchQuery)}"></label><button class="talent-button primary" type="submit">${icon("search")}Search</button></form>
          ${state.hrAdvancedApplied ? `<div class="talent-applied-search"><span>${icon("SlidersHorizontal")}Advanced search applied</span><button type="button" data-open-candidate-search>Edit search</button><button type="button" data-clear-talent-filters>Clear</button></div>` : ""}
          <div class="talent-quick-filters">
            <label>Skills<select data-talent-quick-filter="skills"><option value="">All skills</option>${["Java", "Python", "React", "SQL", "Spring", "JavaScript"].map(value => `<option ${filters.skills.includes(value) ? "selected" : ""}>${value}</option>`).join("")}</select></label>
            <label>Location<select data-talent-quick-filter="locations"><option value="">All locations</option>${["Bangalore", "Hyderabad", "Pune", "Chennai", "Mumbai", "Delhi"].map(value => `<option ${filters.locations.includes(value) ? "selected" : ""}>${value}</option>`).join("")}</select></label>
            <label>Experience<select data-talent-quick-filter="experiences"><option value="">Any experience</option>${[["0-0", "Fresher"], ["0-2", "0 - 2 years"], ["2-5", "2 - 5 years"], ["5-10", "5 - 10 years"], ["10-*", "10+ years"]].map(([value, label]) => `<option value="${value}" ${filters.experiences.includes(value) ? "selected" : ""}>${label}</option>`).join("")}</select></label>
            <label>Designation<input type="search" data-talent-filter="designation" placeholder="Any designation" value="${escapeHtml(filters.designation)}"></label>
            <label>Resume<select data-talent-filter="cv">${filterOptions("cv", [["", "Any resume"], ["attached", "With resume"], ["missing", "Without resume"]])}</select></label>
            <button class="talent-button" type="button" data-more-talent-filters>${icon("ListFilter")}More Filters</button>
          </div>
          <div class="talent-more-filters" hidden><label><input type="checkbox" data-show-duplicates ${state.hrShowDuplicates ? "checked" : ""}>Duplicate records on this page</label><button class="talent-button" type="button" data-clear-talent-filters>Clear filters</button></div>
          <div class="talent-results-toolbar">
            <strong data-talent-found aria-live="polite">Loading candidates...</strong>
            <div class="talent-results-controls"><label>Sort by:<select data-talent-filter="sort">${filterOptions("sort", [["relevance", "Relevance"], ["name", "Name"], ["experience", "Experience"], ["recent", "Recently updated"]])}</select></label>
              <div class="talent-view-toggle" aria-label="Results view"><button type="button" title="List view" aria-label="List view" data-talent-view="list" class="${state.hrTalentView === "list" ? "active" : ""}">${icon("List")}</button><button type="button" title="Grid view" aria-label="Grid view" data-talent-view="grid" class="${state.hrTalentView === "grid" ? "active" : ""}">${icon("LayoutGrid")}</button></div>
              <span data-talent-range></span><button type="button" class="talent-icon-button" title="Previous page" aria-label="Previous page" data-talent-page="-1" disabled>${icon("ChevronLeft")}</button><button type="button" class="talent-icon-button" title="Next page" aria-label="Next page" data-talent-page="1" disabled>${icon("ChevronRight")}</button>
            </div>
          </div>
          <div class="talent-selection-bar" data-talent-selection hidden><span></span><button class="talent-button" type="button" data-export-talent>${icon("Download")}Export selected</button><button class="talent-button" type="button" data-bulk-shortlist>${icon("Star")}Shortlist</button><button class="talent-icon-button" type="button" title="Clear selection" aria-label="Clear selection" data-clear-talent-selection>${icon("x")}</button></div>
          <div data-hr-import-confirmation>${state.hrImportConfirmation ? renderHrImportConfirmation(state.hrImportConfirmation) : ""}</div>
          <div class="talent-record-list ${state.hrTalentView === "grid" ? "grid-view" : ""}" data-hr-employees aria-live="polite"><div class="security-empty">Loading candidates...</div></div>
          `}
        </section>
      </div>
    </main>
  `;
  bindRoleDashboard("hr", { skipEmployeeLoad: options.preloaded });
  bindTalentWorkspace();
  if (options.preloaded) renderHrEmployees();
}

function renderHrCandidateProfile(root) {
  const skills = [
    "ATE",
    "Advantest",
    "ETS 88",
    "ETS 364",
    "T2K",
    "Characterization",
    "Logic Analyzer",
    "Verilog",
    "Yield Improvement",
    "Test Analysis",
    "Test Plan Development",
    "Test Procedures",
    "Debugging Skills",
    "Test Time Reduction",
    "Test Planning",
    "C++",
    "C",
    "Python",
    "PMIC IC Testing"
  ];

  root.innerHTML = h`
    <main class="site role-app hr-app candidate-profile-page">
      ${roleTopbar("Talme HR Workspace", "HR Manager", "/hr/dashboard")}
      <section class="candidate-profile-wrap">
        <button class="btn candidate-back" data-back-hr>${icon("arrow")} Back to results</button>

        <article class="candidate-profile-card">
          <div class="candidate-profile-avatar">VN</div>
          <div class="candidate-profile-main">
            <div class="candidate-profile-title">
              <h1>Vayalpadu Nirupa</h1>
              <a href="#save">Save</a>
            </div>
            <div class="candidate-profile-meta">
              <span>${icon("key")} 3y 6m</span>
              <span>${icon("shield")} Rs 20 Lacs (expects Rs 35 Lacs)</span>
              <span>${icon("search")} Bengaluru</span>
            </div>
            <div class="candidate-profile-facts">
              <span>Current</span>
              <strong>Product Engineer at ON Semiconductor since May '25</strong>
              <small>2 Months</small>
              <span>Highest degree</span>
              <strong>B.Tech / B.E. RAJIV GANDHI UNIVERSITY OF KNOWLEDGE AND TECHNOLOGIES</strong>
              <small>2023</small>
              <span>Pref. locations</span>
              <strong>Bengaluru, Chennai</strong>
              <small></small>
            </div>
            <div class="profile-actions">
              <button class="btn" type="button" data-call-candidate>${icon("shield")} Call candidate</button>
              <button class="btn success" type="button" data-whatsapp-candidate>WhatsApp</button>
            </div>
            <div class="profile-contact">
              <span>${candidateContact.email}</span>
              <span class="candidate-phone-value" data-candidate-phone hidden></span>
              <b>Verified phone and email</b>
            </div>
          </div>
          <div class="profile-timeline">
            <span>Jan '23</span>
            <span>2023</span>
            <span>May '25</span>
            <span>till date</span>
          </div>
        </article>

        <div class="candidate-profile-stats">
          <span>${icon("eye")} 28</span>
          <span>${icon("arrow")} 6</span>
          <span>CV</span>
          <span>Modified in last 15 days</span>
          <span>Active 2 days ago</span>
        </div>

        <section class="profile-detail-card">
          <div class="profile-tabs">
            <button class="active">Profile detail</button>
            <button>Attached CV</button>
          </div>
          <div class="profile-summary-note">
            Post silicon validation engineer with expertise on PMIC IC testing <mark>ATE</mark>
          </div>

          <section class="profile-section">
            <h2>Key skills</h2>
            <div class="profile-chip-list">
              ${skills.map(skill => `<span>${["ATE", "Advantest", "ETS 88", "ETS 364"].includes(skill) ? `<mark>${skill}</mark>` : skill}</span>`).join("")}
            </div>
            <a class="plain-link" href="#it-skills">View IT skills</a>
          </section>

          <section class="profile-section">
            <h3>May also know</h3>
            <div class="profile-chip-list compact">
              <span>Functional Testing</span>
              <span>Debugging</span>
              <span>Test Engineering</span>
              <a href="#more">+7 more</a>
            </div>
          </section>

          <section class="profile-section">
            <h2>Work summary</h2>
            <p>Skilled Post-Silicon Validation Engineer with expertise in developing and debugging test solutions using the <mark>ETS-364</mark> <mark>ATE</mark> platform. Proficient in test plan creation, hardware debugging, and test program development with strong knowledge in C/C++, IG-XL, and VBT.</p>
            <p>Experienced in test program debugging, spike checks, yield improvement, characterization, and voltage/temperature analysis. Comfortable collaborating with product engineers, design teams, and DV teams to resolve device issues and support production release.</p>
            <div class="profile-detail-grid">
              <span>Industry</span><strong>Electronic Components / Semiconductors</strong>
              <span>Department</span><strong>Engineering - Software & QA</strong>
              <span>Role</span><strong>Post Silicon Test Engineer</strong>
            </div>
          </section>

          <section class="profile-section">
            <h2>Work experience</h2>
            <div class="experience-line"><span></span><span></span><span></span></div>
            <div class="experience-row">
              <div class="company-logo">onse</div>
              <div>
                <h3>Product Engineer at ON Semiconductor</h3>
                <small>May '25 till date (1y 2m)</small>
                <p>Designed 48X probe card on T2K tester and Generic mother board which will work for almost 10 projects running in the team on <mark>ETS 364</mark> tester platform. Additionally designed pizza board for the current project.</p>
              </div>
            </div>
            <div class="experience-row">
              <div class="company-logo">Tessolve</div>
              <div>
                <h3>Post Silicon Validation Engineer at Tessolve</h3>
                <small>Jan '23 till May '25 (2y 4m)</small>
                <p>Specialized in developing and debugging test solutions for semiconductor devices on the <mark>ETS-364</mark> <mark>ATE</mark> platform. Worked on feasibility studies, test plans, hardware schematic design, test program development, debug, and optimization.</p>
                <div class="project-callout">
                  <strong>Hardware design and test development for Modulator device</strong>
                  <span>Nov '24 till date</span>
                  <p>Created test plans and test procedures, generated test patterns, and supported schematic design development.</p>
                </div>
              </div>
            </div>
            <div class="experience-row">
              <div class="company-logo">Tessolve</div>
              <div>
                <h3>Hardware and Networks - Other at Tessolve semiconductors <em>Internship</em></h3>
                <small>Jan '23 till Jun '23 (5m)</small>
              </div>
            </div>
          </section>

          <section class="profile-section">
            <h2>Other projects</h2>
            <div class="project-card">
              <strong>Test solution for Dual Buck Controller (PMIC IC)</strong>
              <span>Feb '24 till date</span>
              <p>Test Engineer at Renesas. Feasibility study, test hardware schematic design, trim tests, debug, functional tests, and multi-site tests bring-up.</p>
            </div>
            <div class="project-card">
              <strong>Test solution for PMIC IC (PWM Controller)</strong>
              <span>Jun '23 to Apr '24</span>
              <p>Role description: Expert in ETS-364 ATE test solutions, C/C++, debug, functional testing, yield improvement, and hardware bring-up.</p>
            </div>
          </section>

          <section class="profile-section">
            <h2>Education</h2>
            <div class="education-card">
              <span>${icon("shield")}</span>
              <div>
                <h3>B.Tech / B.E., Electronics and Telecommunication Engineering, 2023</h3>
                <p>RAJIV GANDHI UNIVERSITY OF KNOWLEDGE AND TECHNOLOGIES</p>
              </div>
            </div>
          </section>

          <section class="profile-section" id="it-skills">
            <h2>IT skills</h2>
            <div class="skills-table">
              <div>Skills</div><div>Version</div><div>Last Used</div><div>Experience</div>
              <strong>C</strong><span>--</span><span>--</span><span>1y 11m</span>
              <strong>C++</strong><span>--</span><span>--</span><span>1y</span>
              <strong>Python</strong><span>--</span><span>--</span><span>1y 6m</span>
            </div>
          </section>

          <section class="profile-section">
            <h2>Other details</h2>
            <h3>Languages known</h3>
            <p>English - Proficient (Read, Write, Speak)</p>
            <p>Telugu - Expert (Read, Write, Speak)</p>
            <h3>Personal details</h3>
            <div class="profile-detail-grid four">
              <span>Date of Birth</span><span>Gender</span><span>Marital status</span><span>Category</span>
              <strong>2 Apr 2002</strong><strong>Female</strong><strong>Single/unmarried</strong><strong>General</strong>
            </div>
            <h3>Desired job detail</h3>
            <div class="profile-detail-grid">
              <span>Job Type</span><strong>Permanent</strong>
              <span>Employment status</span><strong>Full time</strong>
            </div>
          </section>
        </section>
      </section>
    </main>
  `;
  bindRoleDashboard("hr");
  document.querySelector("[data-back-hr]")?.addEventListener("click", () => renderHrDashboard(root));
}

function roleTopbar(title, role, dashboardPath) {
  const isHrWorkspace = dashboardPath === "/hr/dashboard";
  const addEmployeeAction = isHrWorkspace
    ? `<button class="btn employee-add-trigger" type="button" data-open-add-employee>${icon("plus")}Add employee</button>`
    : "";
  return `
    <header class="candidate-topbar role-topbar">
      <button class="candidate-brand brand-home-button" type="button" data-role-home="${escapeHtml(dashboardPath)}">
        <img src="/talme-logo.png" alt="Talme Technologies Pvt Ltd">
        <div><strong>${title}</strong><span>${role}</span></div>
      </button>
      <nav class="admin-nav-links" aria-label="${role} navigation">
        <a href="${dashboardPath}">Home</a>
        <a href="#new-talent">New Talent</a>
        <a href="#experienced-talent">Experienced Talent</a>
        <label class="nav-search" aria-label="Search">
          ${icon("search")}
          <input type="search" placeholder="Search jobs, talent, companies" ${isHrWorkspace ? `data-hr-search value="${escapeHtml(state.hrEmployeeSearchQuery)}"` : ""}>
        </label>
      </nav>
      <div class="candidate-actions">
        ${addEmployeeAction}
        <button class="btn primary" data-open-import>${icon("arrow")}Upload</button>
        <button class="btn theme-toggle" title="Toggle theme" data-theme>${icon(state.theme === "dark" ? "sun" : "moon")}<span>${state.theme === "dark" ? "Light" : "Dark"}</span></button>
        <button class="btn" data-logout>${icon("logout")}Logout</button>
      </div>
    </header>
  `;
}

function roleMetric(label, value, text) {
  return `
    <article class="role-metric">
      <span>${label}</span>
      <strong>${value}</strong>
      <p>${text}</p>
    </article>
  `;
}

function securityMetric(label, key, action = "") {
  const tag = action ? "button" : "article";
  const attributes = action ? `type="button" data-security-action="${escapeHtml(action)}"` : "";
  return `
    <${tag} class="role-metric security-metric ${action ? "clickable" : ""}" ${attributes}>
      <span>${label}</span>
      <strong data-security-stat="${key}">--</strong>
      <p>Live platform value</p>
    </${tag}>
  `;
}

function openCandidateImport() {
  state.candidateImportId = "";
  document.querySelector(".import-backdrop")?.remove();
  document.body.insertAdjacentHTML("beforeend", candidateImportModal());
  bindCandidateImport();
}

function openCandidateAdd() {
  document.querySelector(".import-backdrop")?.remove();
  document.body.insertAdjacentHTML("beforeend", candidateAddModal());
  bindCandidateAdd();
}

function openEmployeeAdd() {
  document.querySelector(".import-backdrop")?.remove();
  document.body.insertAdjacentHTML("beforeend", employeeAddModal());
  bindEmployeeAdd();
}

function employeeAddModal() {
  return `
    <div class="import-backdrop employee-add-backdrop">
      <section class="import-modal candidate-add-modal" role="dialog" aria-modal="true" aria-label="Add employee">
        <div class="modal-top">
          <div>
            <h2>Add employee</h2>
            <p>Enter the profile details and upload the CV.</p>
          </div>
          <button class="icon-btn" type="button" data-add-employee-close>${icon("x")}</button>
        </div>
        <form class="candidate-add-form" data-add-employee-form>
          <div class="candidate-add-grid">
            <label class="field">
              <span>fullName</span>
              <input name="fullName" autocomplete="name" required>
            </label>
            <label class="field">
              <span>email</span>
              <input name="email" type="email" autocomplete="email" required>
            </label>
            <label class="field">
              <span>phone</span>
              <input name="phone" inputmode="tel" autocomplete="tel" required>
            </label>
            <label class="field">
              <span>employeeCode</span>
              <input name="employeeCode" autocomplete="off">
            </label>
            <label class="field">
              <span>location</span>
              <input name="location" required>
            </label>
            <label class="field candidate-add-wide">
              <span>keywords</span>
              <textarea name="keywords" rows="3" placeholder="ATE, Python, PMIC, Debugging" required></textarea>
            </label>
            <label class="field">
              <span>experience</span>
              <input name="experience" type="number" min="0" step="0.1">
            </label>
            <label class="field">
              <span>currentCompany</span>
              <input name="currentCompany">
            </label>
            <label class="field">
              <span>currentDesignation</span>
              <input name="currentDesignation">
            </label>
            <label class="field">
              <span>Upload CV</span>
              <input name="cv" type="file" accept=".pdf,.doc,.docx">
            </label>
          </div>
          <p class="notice" data-add-employee-status></p>
          <div class="import-footer">
            <button class="btn" type="button" data-add-employee-close>Cancel</button>
            <button class="btn primary" type="submit">Submit</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function candidateAddModal() {
  return `
    <div class="import-backdrop candidate-add-backdrop">
      <section class="import-modal candidate-add-modal" role="dialog" aria-modal="true" aria-label="Add candidate">
        <div class="modal-top">
          <div>
            <h2>Add candidate</h2>
            <p>Enter the candidate details and upload the CV.</p>
          </div>
          <button class="icon-btn" type="button" data-add-candidate-close>${icon("x")}</button>
        </div>
        <form class="candidate-add-form" data-add-candidate-form>
          <div class="candidate-add-grid">
            <label class="field">
              <span>fullName</span>
              <input name="fullName" autocomplete="name" required>
            </label>
            <label class="field">
              <span>email</span>
              <input name="email" type="email" autocomplete="email" required>
            </label>
            <label class="field">
              <span>phone</span>
              <input name="phone" inputmode="tel" autocomplete="tel" required>
            </label>
            <label class="field">
              <span>location</span>
              <input name="location" required>
            </label>
            <label class="field candidate-add-wide">
              <span>keywords</span>
              <textarea name="keywords" rows="3" placeholder="ATE, Python, PMIC, Debugging" required></textarea>
            </label>
            <label class="field">
              <span>experience</span>
              <input name="experience" type="number" min="0" step="0.1">
            </label>
            <label class="field">
              <span>currentCompany</span>
              <input name="currentCompany">
            </label>
            <label class="field">
              <span>currentDesignation</span>
              <input name="currentDesignation">
            </label>
            <label class="field">
              <span>Upload CV</span>
              <input name="cv" type="file" accept=".pdf,.doc,.docx">
            </label>
          </div>
          <p class="notice" data-add-candidate-status></p>
          <div class="import-footer">
            <button class="btn" type="button" data-add-candidate-close>Cancel</button>
            <button class="btn primary" type="submit">${icon("plus")}Add candidate</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function candidateImportModal() {
  return `
    <div class="import-backdrop">
      <section class="import-modal" role="dialog" aria-modal="true" aria-label="Employee import">
        <div class="modal-top">
          <div>
            <h2>Upload employees</h2>
            <p>Upload Excel or CSV, preview the rows, then submit to save them as employee records.</p>
          </div>
          <button class="icon-btn" data-import-close>${icon("x")}</button>
        </div>
        <div class="import-upload-box">
          <label class="field">
            <span>Excel or CSV file</span>
            <input type="file" accept=".xlsx,.xls,.csv" data-import-file>
          </label>
          <button class="btn primary" data-preview-import>${icon("arrow")}Preview file</button>
        </div>
        <p class="notice" data-import-status></p>
        <div class="import-summary" data-import-summary></div>
        <div class="import-preview" data-import-preview></div>
        <div class="import-progress" data-import-progress hidden>
          <div class="import-progress-head">
            <strong>Submitting to database</strong>
            <span data-import-progress-label>0% completed</span>
          </div>
          <div class="import-progress-track" aria-hidden="true">
            <span data-import-progress-bar style="width: 0%"></span>
          </div>
        </div>
        <div class="import-footer">
          <button class="btn" data-import-close>Cancel</button>
          <button class="btn primary" data-commit-import disabled>Submit to database</button>
        </div>
      </section>
    </div>
  `;
}

function renderImportPreview(payload) {
  const summary = payload.summary || {};
  document.querySelector("[data-import-summary]").innerHTML = `
    <article><strong>${summary.totalRows || 0}</strong><span>Total rows</span></article>
    <article><strong>${summary.createCount || 0}</strong><span>Create</span></article>
    <article><strong>${summary.updateCount || 0}</strong><span>Update</span></article>
    <article><strong>${summary.duplicates || summary.duplicateCount || 0}</strong><span>Duplicates skipped</span></article>
    <article><strong>${summary.invalid || summary.invalidCount || 0}</strong><span>Errors skipped</span></article>
  `;

  const rows = payload.preview || [];
  const skippedRows = payload.skippedRows || payload.failedRows || [];
  const employeeCards = rows.map(row => {
    const skills = employeeSkills(row.keywords);
    return `
      <section class="import-employee-card">
        <div class="import-employee-main">
          <div class="import-employee-title">
            <span class="candidate-avatar-placeholder">${escapeHtml(profileInitials(row.fullName))}</span>
            <div>
              <h4>${escapeHtml(row.fullName || "Name not added")}</h4>
              <p>Row ${escapeHtml(row.rowNumber)} - <span class="import-action ${row.action === "Update" ? "update" : ""}">${escapeHtml(row.action)}</span></p>
            </div>
          </div>
          <div class="candidate-meta">
            <span>${icon("key")} ${escapeHtml(formatExperience(row.experience))}</span>
            <span>${icon("shield")} ${escapeHtml(row.phone || "Phone not added")}</span>
            <span>${icon("search")} ${escapeHtml(row.location || "Location not added")}</span>
          </div>
          <div class="candidate-info-grid import-info-grid">
            <span>Current</span>
            <strong>${escapeHtml(row.currentDesignation || "Employee")}</strong>
            <span>Email</span>
            <strong>${escapeHtml(row.email || "Email not added")}</strong>
            <span>Experience</span>
            <strong>${escapeHtml(formatExperience(row.experience))}</strong>
            <span>Key skills</span>
            <div class="import-skill-line">
              ${skills.length ? skills.slice(0, 24).map(skill => `<span>${escapeHtml(skill)}</span>`).join("") : "<strong>--</strong>"}
              ${skills.length > 24 ? `<em>+${skills.length - 24} more</em>` : ""}
            </div>
          </div>
        </div>
      </section>
    `;
  }).join("");
  document.querySelector("[data-import-preview]").innerHTML = `
    <h3>Upload preview</h3>
    <div class="import-preview-note">
      Showing ${escapeHtml(rows.length)} sample employees. Submit saves ${escapeHtml(summary.validRows || 0)} valid rows and skips ${escapeHtml(summary.skipped || 0)} duplicate/error rows.
    </div>
    <div class="import-card-list">${employeeCards || `<div class="security-empty">No valid employee rows found.</div>`}</div>
    ${skippedRows.length ? `
      <h3>Rows skipped</h3>
      <div class="failed-list">
        ${skippedRows.slice(0, 20).map(row => `<p><b>Row ${escapeHtml(row.rowNumber)}</b> ${escapeHtml((row.reasons || []).join(", "))}</p>`).join("")}
      </div>
    ` : ""}
  `;
}

function renderImportCommitResult(payload) {
  const summary = payload.summary || {};
  const failedRows = payload.failedRows || [];
  const duplicateRows = payload.duplicateRows || [];
  document.querySelector("[data-import-summary]").innerHTML = `
    <article><strong>${summary.created || 0}</strong><span>Inserted</span></article>
    <article><strong>${summary.updated || 0}</strong><span>Updated</span></article>
    <article><strong>${summary.duplicates || summary.duplicateCount || duplicateRows.length || 0}</strong><span>Duplicates skipped</span></article>
    <article><strong>${summary.invalid || summary.invalidCount || 0}</strong><span>Errors skipped</span></article>
  `;
  document.querySelector("[data-import-preview]").innerHTML = `
    <h3>Database update complete</h3>
    <div class="import-preview-note">
      ${escapeHtml(payload.message || "Employees uploaded successfully and saved in database.")}
      ${payload.importId ? ` Import #${escapeHtml(payload.importId)} saved.` : ""}
      All valid employee records have been saved to the database.
    </div>
    ${failedRows.length ? `
      <h3>Rows not saved</h3>
      <div class="failed-list">
        ${failedRows.slice(0, 12).map(row => `<p><b>Row ${escapeHtml(row.rowNumber)}</b> ${escapeHtml((row.reasons || []).join(", "))}</p>`).join("")}
      </div>
    ` : ""}
  `;
}

function setImportProgress(percent, label = null) {
  const progress = document.querySelector("[data-import-progress]");
  const bar = document.querySelector("[data-import-progress-bar]");
  const text = document.querySelector("[data-import-progress-label]");
  if (!progress || !bar || !text) return;
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  progress.hidden = false;
  bar.style.width = `${value}%`;
  text.textContent = label || `${value}% completed`;
}

function stopImportProgress() {
  if (importCommitProgressTimer) {
    clearInterval(importCommitProgressTimer);
    importCommitProgressTimer = null;
  }
}

function resetImportProgress() {
  stopImportProgress();
  const progress = document.querySelector("[data-import-progress]");
  const bar = document.querySelector("[data-import-progress-bar]");
  const text = document.querySelector("[data-import-progress-label]");
  if (bar) bar.style.width = "0%";
  if (text) text.textContent = "0% completed";
  if (progress) progress.hidden = true;
}

function startImportProgress(submit) {
  stopImportProgress();
  let percent = 1;
  setImportProgress(percent);
  if (submit) submit.textContent = "Submitting 1%";
  importCommitProgressTimer = setInterval(() => {
    percent = Math.min(95, percent + Math.max(1, Math.ceil((96 - percent) * 0.08)));
    setImportProgress(percent);
    if (submit) submit.textContent = `Submitting ${percent}%`;
    if (percent >= 95) stopImportProgress();
  }, 350);
}

async function finishImportProgress(submit) {
  stopImportProgress();
  setImportProgress(100, "100% completed");
  if (submit) submit.textContent = "100% completed";
  await new Promise(resolve => setTimeout(resolve, 550));
}

function bindCandidateImport() {
  document.querySelectorAll("[data-import-close]").forEach(button => {
    button.addEventListener("click", () => document.querySelector(".import-backdrop")?.remove());
  });

  document.querySelector("[data-preview-import]")?.addEventListener("click", async () => {
    const status = document.querySelector("[data-import-status]");
    const file = document.querySelector("[data-import-file]")?.files?.[0];
    if (!file) {
      status.textContent = "Please choose an Excel or CSV file first.";
      status.className = "notice error";
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    status.textContent = "Reading file and preparing preview...";
    status.className = "notice";
    resetImportProgress();
    document.querySelector("[data-commit-import]").disabled = true;

    try {
      const payload = await apiUpload("/api/import/employees/preview", formData);
      state.candidateImportId = payload.importId;
      renderImportPreview(payload);
      document.querySelector("[data-commit-import]").disabled = !(payload.summary?.validRows > 0);
      status.textContent = "Preview ready. Review the employees, then submit to database.";
      status.className = "notice ok";
    } catch (error) {
      status.textContent = error.message;
      status.className = "notice error";
    }
  });

  document.querySelector("[data-commit-import]")?.addEventListener("click", async () => {
    const status = document.querySelector("[data-import-status]");
    const submit = document.querySelector("[data-commit-import]");
    if (!state.candidateImportId) return;
    status.textContent = "Submitting employees into database...";
    status.className = "notice";
    submit.disabled = true;
    startImportProgress(submit);

    try {
      const payload = await api("/api/import/employees/commit", {
        method: "POST",
        body: { importId: state.candidateImportId }
      });
      await finishImportProgress(submit);
      renderImportCommitResult(payload);
      const summary = payload.summary;
      state.hrImportConfirmation = `${summary.created} inserted, ${summary.updated} updated, ${summary.duplicates || summary.duplicateCount || 0} duplicate rows skipped, ${summary.invalid || summary.invalidCount || 0} invalid rows skipped`;
      state.candidateImportId = "";
      status.textContent = "Employees uploaded successfully. Database updated and employee list is refreshing.";
      status.className = "notice ok";
      await new Promise(resolve => setTimeout(resolve, 900));
      document.querySelector(".import-backdrop")?.remove();
      if (window.location.pathname !== "/hr/dashboard") {
        history.pushState({}, "", "/hr/dashboard");
      }
      renderHrDashboard(document.querySelector("#app"));
      document.querySelector(".employee-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      stopImportProgress();
      status.textContent = error.message;
      status.className = "notice error";
      submit.disabled = false;
      submit.textContent = "Submit to database";
    }
  });
}

function renderHrImportConfirmation(message) {
  return `
    <div class="saved-confirmation" role="status">
      <span class="saved-confirmation-icon">${icon("checkCircle")}</span>
      <div>
        <strong>Submitted and saved in database</strong>
        <p>${escapeHtml(message)}. Employee home page refreshed.</p>
      </div>
    </div>
  `;
}

function bindCandidateAdd() {
  document.querySelectorAll("[data-add-candidate-close]").forEach(button => {
    button.addEventListener("click", () => document.querySelector(".candidate-add-backdrop")?.remove());
  });

  const form = document.querySelector("[data-add-candidate-form]");
  form?.addEventListener("submit", async event => {
    event.preventDefault();
    const status = document.querySelector("[data-add-candidate-status]");
    const submit = form.querySelector('button[type="submit"]');
    status.textContent = "Saving candidate...";
    status.className = "notice";
    submit.disabled = true;
    try {
      const payload = await apiUpload("/api/candidates", new FormData(form));
      status.textContent = payload.message || "Candidate saved successfully.";
      status.className = "notice ok";
      form.reset();
    } catch (error) {
      status.textContent = error.message;
      status.className = "notice error";
    } finally {
      submit.disabled = false;
    }
  });
}

function bindEmployeeAdd() {
  document.querySelectorAll("[data-add-employee-close]").forEach(button => {
    button.addEventListener("click", () => document.querySelector(".employee-add-backdrop")?.remove());
  });

  const form = document.querySelector("[data-add-employee-form]");
  form?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const status = document.querySelector("[data-add-employee-status]");
    const submit = form.querySelector('button[type="submit"]');
    status.textContent = "Submitting employee...";
    status.className = "notice";
    submit.disabled = true;
    submit.textContent = "Submitting...";
    try {
      const payload = await apiUpload("/api/hr/employees", new FormData(form));
      status.textContent = payload.message || "Employee saved successfully.";
      status.className = "notice ok";
      submit.textContent = "Saved";
      form.reset();
      state.hrImportConfirmation = "Employee saved successfully.";
      if (window.location.pathname !== "/hr/dashboard") {
        history.pushState({}, "", "/hr/dashboard");
        renderHrDashboard(document.querySelector("#app"));
      }
      await loadHrEmployees();
      loadPublicProfileCount();
      document.querySelector(".employee-add-backdrop")?.remove();
    } catch (error) {
      status.textContent = error.message;
      status.className = "notice error";
      submit.textContent = "Submit";
      submit.disabled = false;
      return;
    } finally {
      if (document.body.contains(submit)) {
        submit.disabled = false;
        submit.textContent = "Submit";
      }
    }
  });
}

async function loadHrEmployees() {
  const target = document.querySelector("[data-hr-employees]");
  if (!target) return;
  try {
    const items = await fetchHrEmployees();
    if (items === null) return;
    if (!document.querySelector(".talent-app")) state.hrEmployeeVisibleCount = 50;
    renderHrEmployees();
  } catch (error) {
    target.innerHTML = `<div class="security-empty">${escapeHtml(error.message)}</div>`;
  }
}

function employeeListSignature(items = state.hrEmployees) {
  return items
    .map((employee, index) => [
      employeeRecordId(employee, index),
      employee.name,
      employee.email,
      employee.phone,
      employee.updatedAt,
      employee.last_edited_at,
      employee.audit_at
    ].map(value => String(value || "")).join(":"))
    .join("|");
}

async function refreshHrEmployeesLive() {
  if (hrEmployeesLiveLoading || !document.querySelector("[data-hr-employees]")) return;
  hrEmployeesLiveLoading = true;
  const before = employeeListSignature();
  try {
    const previousVisibleCount = state.hrEmployeeVisibleCount;
    const items = await fetchHrEmployees();
    if (items === null) return;
    if (!document.querySelector(".talent-app")) state.hrEmployeeVisibleCount = Math.max(previousVisibleCount, Math.min(50, state.hrEmployees.length || previousVisibleCount));
    updateTalentSummary();
    if (employeeListSignature() !== before) renderHrEmployees();
  } catch {
  } finally {
    hrEmployeesLiveLoading = false;
  }
}

function startHrEmployeesLive() {
  if (hrEmployeesLiveTimer) return;
  hrEmployeesLiveTimer = setInterval(refreshHrEmployeesLive, 4000);
}

function stopHrEmployeesLive() {
  if (!hrEmployeesLiveTimer) return;
  clearInterval(hrEmployeesLiveTimer);
  hrEmployeesLiveTimer = null;
  hrEmployeesLiveLoading = false;
}

async function fetchHrEmployees() {
  const requestId = ++hrEmployeeRequestId;
  const isTalentWorkspace = Boolean(document.querySelector(".talent-app"));
  const params = new URLSearchParams({
    page: String(isTalentWorkspace ? state.hrTalentPage : 1),
    limit: String(state.hrEmployeeVisibleCount || 50)
  });
  if (isTalentWorkspace) {
    if (state.hrAdvancedApplied) params.set("advanced", JSON.stringify(state.hrAdvancedSearch));
    for (const [key, value] of Object.entries(state.hrTalentFilters)) {
      if (Array.isArray(value) ? value.length : Boolean(value)) params.set(key, Array.isArray(value) ? value.join(",") : value);
    }
    const pipeline = loadRoleWorkspace(talentStorageKey("pipeline"), {});
    if (state.hrTalentStage === "active") params.set("excludeIds", JSON.stringify(Object.keys(pipeline)));
    else if (state.hrTalentStage !== "all") params.set("ids", JSON.stringify(Object.keys(pipeline).filter(id => pipeline[id].stage === state.hrTalentStage)));
  }
  const query = state.hrEmployeeSearchQuery.trim();
  if (query && !state.hrAdvancedApplied) params.set("q", query);
  const payload = await api(`/api/hr/employees/search?${params.toString()}`);
  if (requestId !== hrEmployeeRequestId) return null;
  state.hrEmployees = payload.items || [];
  state.hrEmployeePagination = payload.pagination || {
    page: 1,
    limit: state.hrEmployeeVisibleCount,
    total: state.hrEmployees.length,
    totalPages: 1
  };
  const hasFilters = isTalentWorkspace && (state.hrAdvancedApplied || state.hrTalentStage !== "all" || Object.entries(state.hrTalentFilters).some(([key, value]) => key !== "sort" && (Array.isArray(value) ? value.length : Boolean(value))));
  if (!query && !hasFilters) {
    state.profileCount = state.hrEmployeePagination.total;
    localStorage.setItem("talme_profile_count", String(state.profileCount));
    document.querySelectorAll("[data-hr-total-employees]").forEach(element => {
      element.textContent = `${profileCountLabel()} employees`;
    });
    const countStatus = document.querySelector(".hr-portal-shell [data-profile-count]");
    if (countStatus) countStatus.innerHTML = `${icon("users")} ${profileCountLabel()} employees`;
  }
  return state.hrEmployees;
}


function mergeHrEmployeeLists(importedItems, dbItems) {
  const merged = [];
  const seen = new Set();
  for (const employee of [...importedItems, ...dbItems]) {
    const key = `${String(employee.email || "").toLowerCase()}|${String(employee.phone || "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(employee);
  }
  return merged;
}

function renderHrEmployees(items = state.hrEmployees) {
  if (document.querySelector(".talent-app")) return renderTalentRecords(items);
  const target = document.querySelector("[data-hr-employees]");
  if (!target) return;
  if (!items.length) {
    target.innerHTML = `<div class="security-empty">No employees added yet.</div>`;
    return;
  }
  const query = state.hrEmployeeSearchQuery.trim();
  const sourceItems = state.hrShowDuplicates ? duplicateHrEmployees(items) : items;
  if (state.hrShowDuplicates && !sourceItems.length) {
    target.innerHTML = `<div class="security-empty">No duplicate employee records found.</div>`;
    return;
  }
  const matchedItems = sourceItems;
  const totalMatches = state.hrEmployeePagination?.total || matchedItems.length;
  if (!matchedItems.length) {
    target.innerHTML = `<div class="security-empty">No employees match "${escapeHtml(query)}".</div>`;
    return;
  }
  const visibleItems = matchedItems.slice(0, state.hrEmployeeVisibleCount);
  target.innerHTML = `
    <div class="employee-list-summary">
      <span class="employee-live-dot" aria-hidden="true"></span>
      <span class="live-label">Live</span>
      <span><strong>${visibleItems.length}</strong> of <strong>${totalMatches}</strong> ${state.hrShowDuplicates ? "duplicate " : ""}employees shown${query ? ` for <strong>${escapeHtml(query)}</strong>` : ""}</span>
    </div>
    ${visibleItems.map((employee, index) => `
      <section class="candidate-result-card employee-result-card">
        <div class="candidate-select"></div>
        <div class="candidate-result-main">
          <div class="candidate-result-head">
            <label class="candidate-check" aria-label="Select employee">
              <input type="checkbox">
              <button class="candidate-name-link" type="button" data-employee-profile data-employee-id="${escapeHtml(employeeRecordId(employee, index))}">${highlightSearch(employee.name, query)}</button>
            </label>
            <div class="candidate-meta">
              <span>${icon("key")} ${escapeHtml(formatExperience(employee.experience))}</span>
              <span>${icon("shield")} ${highlightSearch(employee.phone || "Phone not added", query)}</span>
              <span>${icon("search")} ${highlightSearch(employee.location || "Location not added", query)}</span>
            </div>
          </div>
          <div class="candidate-info-grid">
            <span>Current</span>
            <strong>${highlightSearch(employee.current_designation || employee.designation || "Employee", query)}${employee.current_company ? ` at ${highlightSearch(employee.current_company, query)}` : ""}</strong>
            <span>Email</span>
            <strong>${highlightSearch(employee.email, query)}</strong>
            <span>Experience</span>
            <strong>${escapeHtml(formatExperience(employee.experience))}</strong>
            <span>Key skills</span>
            <div class="skill-line">
              ${employeeSkillChips(employee.keywords, employeeRecordId(employee, index), query)}
            </div>
          </div>
          <div class="candidate-bottom">
            <button type="button" data-employee-profile data-employee-id="${escapeHtml(employeeRecordId(employee, index))}">Employee profile</button>
            <span>${icon("eye")} Active</span>
            <span>${icon("arrow")} HR</span>
          </div>
          ${employeeAuditLine(employee) ? `<div class="employee-audit-line">${escapeHtml(employeeAuditLine(employee))}</div>` : ""}
        </div>
        <aside class="candidate-result-side">
          <div class="candidate-avatar-placeholder">${profileInitials(employee.name)}</div>
          <p>${highlightSearch(employee.current_designation || employee.designation || "Employee", query)}${employee.current_company ? ` at ${highlightSearch(employee.current_company, query)}` : ""} in ${highlightSearch(employee.location || "the selected location", query)}.</p>
          <button class="btn" type="button" data-employee-email="${escapeHtml(employee.email)}">${icon("shield")} Email employee</button>
          <small>Employee record</small>
          <div class="candidate-actions-row">
            <a href="#comment">Comment</a>
            <a href="#save">Save</a>
          </div>
        </aside>
      </section>
    `).join("")}
    ${visibleItems.length < totalMatches ? `
      <div class="employee-list-actions">
        <button class="btn" type="button" data-load-more-employees>Load more</button>
      </div>
    ` : ""}
  `;
  bindEmployeeCardActions();
  document.querySelector("[data-load-more-employees]")?.addEventListener("click", async () => {
    state.hrEmployeeVisibleCount += 50;
    await loadHrEmployees();
  });
}

function talentStorageKey(name) {
  return `talme_hr_${name}_${state.user?.id || state.user?.email || "workspace"}`;
}

function updateTalentSummary() {
  if (!document.querySelector(".talent-app")) return;
  const pipeline = loadRoleWorkspace(talentStorageKey("pipeline"), {});
  const stages = Object.values(pipeline);
  const counts = { all: state.profileCount, active: Math.max(0, state.profileCount - stages.length) };
  for (const stage of ["shortlisted", "process", "interview", "hired"]) counts[stage] = stages.filter(item => item.stage === stage).length;
  document.querySelectorAll("[data-talent-stage-count]").forEach(element => {
    element.textContent = `(${formatNumber(counts[element.dataset.talentStageCount] || 0)})`;
  });
  const found = document.querySelector("[data-talent-found]");
  const total = state.hrEmployeePagination.total;
  if (found) found.innerHTML = `<b>${formatNumber(total)}</b> candidates found`;
  const first = total ? (state.hrTalentPage - 1) * 20 + 1 : 0;
  const range = document.querySelector("[data-talent-range]");
  if (range) range.textContent = `${first} - ${Math.min(state.hrTalentPage * 20, total)} of ${formatNumber(total)}`;
  document.querySelectorAll("[data-talent-page]").forEach(button => {
    button.disabled = Number(button.dataset.talentPage) < 0 ? state.hrTalentPage <= 1 : state.hrTalentPage >= state.hrEmployeePagination.totalPages;
  });
  const report = document.querySelector("[data-talent-report]");
  if (report) report.innerHTML = [["Total employees", counts.all], ["Shortlisted", counts.shortlisted], ["Interviews", counts.interview], ["Hired", counts.hired]].map(([label, count]) => `<div><span>${label}</span><strong>${formatNumber(count)}</strong></div>`).join("");
}

function renderTalentRecords(items) {
  const target = document.querySelector("[data-hr-employees]");
  if (!target) return;
  updateTalentSummary();
  const pipeline = loadRoleWorkspace(talentStorageKey("pipeline"), {});
  const query = state.hrEmployeeSearchQuery.trim();
  const stages = { active: "Active", shortlisted: "Shortlisted", process: "In Process", interview: "Interview", hired: "Hired" };
  const actions = { active: ["shortlisted", "Shortlist"], shortlisted: ["process", "Move to Interview"], process: ["interview", "Schedule Interview"], interview: ["hired", "Mark Hired"], hired: ["active", "Reopen"] };
  const records = state.hrShowDuplicates ? duplicateHrEmployees(items) : items;
  target.classList.toggle("grid-view", state.hrTalentView === "grid");
  if (!records.length) {
    target.innerHTML = `<div class="talent-empty">${icon("SearchX")}<h2>No candidates found</h2><p>${state.hrShowDuplicates ? "No duplicate records on this page." : "No records match the current search and filters."}</p><button class="talent-button" type="button" data-empty-clear-filters>Clear filters</button></div>`;
    target.querySelector("[data-empty-clear-filters]")?.addEventListener("click", clearTalentFilters);
    updateTalentSelection();
    return;
  }
  target.innerHTML = records.map((employee, index) => {
    const id = employeeRecordId(employee, index);
    const workflow = pipeline[id] || {};
    const stage = workflow.stage || "active";
    const [nextStage, action] = actions[stage] || actions.active;
    const skills = Array.isArray(employee.skills) && employee.skills.length ? employee.skills : employeeSkills(employee.keywords);
    const expanded = state.expandedEmployeeSkills.has(id);
    const shownSkills = expanded ? skills : skills.slice(0, 4);
    const updated = employee.updatedAt || employee.updated_at || employee.last_edited_at;
    const date = updated && !Number.isNaN(new Date(updated).getTime()) ? new Date(updated).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
    return `<article class="talent-record">
      <label class="talent-record-check"><input type="checkbox" aria-label="Select ${escapeHtml(employee.name || "candidate")}" data-talent-select="${escapeHtml(id)}" ${state.hrTalentSelected.has(id) ? "checked" : ""}></label>
      <div class="talent-record-avatar">${escapeHtml(profileInitials(employee.name || "Employee"))}</div>
      <div class="talent-record-identity"><div class="talent-record-name"><button type="button" data-employee-profile data-employee-id="${escapeHtml(id)}">${highlightSearch(employee.name || "Employee", query)}</button><span class="talent-status ${stage}">${stages[stage] || "Active"}</span></div>
        <p>${highlightSearch(employee.current_designation || employee.currentDesignation || employee.designation || "Employee", query)}${employee.current_company || employee.currentCompany ? ` at ${highlightSearch(employee.current_company || employee.currentCompany, query)}` : ""}</p>
        <div class="talent-record-meta"><span>${icon("BriefcaseBusiness")}${escapeHtml(formatExperience(employee.experience))}</span><span>${icon("MapPin")}${highlightSearch(employee.location || "Not provided", query)}</span></div>
        <div class="talent-record-contact">${icon("Mail")}<span>${highlightSearch(employee.email || employee.phone || "Contact not provided", query)}</span></div>
      </div>
      <div class="talent-record-details"><div class="talent-record-facts"><div><small>Current CTC</small><strong>${escapeHtml(employee.current_ctc || "--")}</strong></div><div><small>Expected CTC</small><strong>${escapeHtml(employee.expected_ctc || "--")}</strong></div><div><small>Notice Period</small><strong>${escapeHtml(employee.notice_period || "--")}</strong></div></div>
        <div class="talent-skill-tags">${shownSkills.map(skill => `<span>${highlightSearch(skill, query)}</span>`).join("")}${skills.length > 4 ? `<button type="button" data-talent-skills="${escapeHtml(id)}" aria-label="${expanded ? "Show fewer" : "Show more"} skills">${expanded ? "Less" : `+${skills.length - 4}`}</button>` : ""}${!skills.length ? `<small>Skills not provided</small>` : ""}</div>
      </div>
      <div class="talent-record-actions"><div class="talent-record-updated"><small>${workflow.interviewAt ? `Interview ${escapeHtml(new Date(workflow.interviewAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }))}` : date ? `Updated ${date}` : "Employee record"}</small><details class="talent-record-menu"><summary class="talent-icon-button" title="Candidate actions" aria-label="Candidate actions">${icon("EllipsisVertical")}</summary><div class="talent-menu-content"><button type="button" data-employee-email="${escapeHtml(employee.email)}" ${!employee.email ? "disabled" : ""}>${icon("Mail")}Email candidate</button><button type="button" data-talent-reopen="${escapeHtml(id)}">${icon("RotateCcw")}Set active</button></div></details></div>
        <div class="talent-record-buttons"><button class="talent-button" type="button" data-employee-profile data-employee-id="${escapeHtml(id)}">View Profile</button><button class="talent-button primary" type="button" data-talent-transition="${nextStage}" data-employee-id="${escapeHtml(id)}">${action}</button></div>
      </div>
    </article>`;
  }).join("");
  bindEmployeeCardActions();
  target.querySelectorAll("[data-talent-select]").forEach(input => input.addEventListener("change", () => {
    if (input.checked) state.hrTalentSelected.add(input.dataset.talentSelect);
    else state.hrTalentSelected.delete(input.dataset.talentSelect);
    updateTalentSelection();
  }));
  target.querySelectorAll("[data-talent-transition]").forEach(button => button.addEventListener("click", () => {
    if (button.dataset.talentTransition === "interview") return openTalentInterview(button.dataset.employeeId);
    setTalentStage(button.dataset.employeeId, button.dataset.talentTransition);
  }));
  target.querySelectorAll("[data-talent-reopen]").forEach(button => button.addEventListener("click", () => setTalentStage(button.dataset.talentReopen, "active")));
  target.querySelectorAll("[data-talent-skills]").forEach(button => button.addEventListener("click", () => {
    const id = button.dataset.talentSkills;
    if (state.expandedEmployeeSkills.has(id)) state.expandedEmployeeSkills.delete(id);
    else state.expandedEmployeeSkills.add(id);
    renderTalentRecords(state.hrEmployees);
  }));
  updateTalentSelection();
}

function setTalentStage(id, stage, interviewAt = "") {
  const pipeline = loadRoleWorkspace(talentStorageKey("pipeline"), {});
  if (stage === "active") delete pipeline[id];
  else pipeline[id] = { stage, interviewAt, updatedAt: new Date().toISOString() };
  saveRoleWorkspace(talentStorageKey("pipeline"), pipeline);
  if (state.hrTalentStage !== "all") reloadTalentRecords();
  else renderTalentRecords(state.hrEmployees);
}

function openTalentInterview(id) {
  const employee = findHrEmployeeById(id);
  const dialog = document.createElement("dialog");
  dialog.className = "talent-interview-dialog";
  dialog.innerHTML = `<form><h2>Schedule Interview</h2><p>${escapeHtml(employee?.name || "Candidate")}</p><label>Interview date and time<input type="datetime-local" required name="interviewAt"></label><div><button class="talent-button" type="button" data-cancel>Cancel</button><button class="talent-button primary" type="submit">Schedule Interview</button></div></form>`;
  document.body.append(dialog);
  dialog.querySelector("input").min = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector("form").addEventListener("submit", event => {
    event.preventDefault();
    setTalentStage(id, "interview", dialog.querySelector("input").value);
    dialog.close();
  });
  dialog.showModal();
}

function updateTalentSelection() {
  const bar = document.querySelector("[data-talent-selection]");
  if (!bar) return;
  bar.hidden = !state.hrTalentSelected.size;
  bar.querySelector("span").textContent = `${state.hrTalentSelected.size} selected`;
}

function reloadTalentRecords() {
  ++hrEmployeeRequestId;
  state.hrTalentPage = 1;
  state.hrTalentSelected.clear();
  updateTalentSelection();
  loadHrEmployees();
}

function clearTalentFilters() {
  clearTimeout(hrEmployeeSearchTimer);
  state.hrEmployeeSearchQuery = "";
  state.hrAdvancedSearch = null;
  state.hrCandidateSearchDraft = null;
  state.hrAdvancedApplied = false;
  state.hrTalentFilters = { locations: [], skills: [], experiences: [], company: "", designation: "", cv: "", sort: "relevance" };
  state.hrTalentStage = "all";
  state.hrShowDuplicates = false;
  state.hrTalentPage = 1;
  state.hrTalentSelected.clear();
  renderHrDashboard(document.querySelector("#app"));
}

function bindTalentWorkspace() {
  document.querySelectorAll("[data-open-candidate-search]").forEach(button => button.addEventListener("click", openAdvancedCandidateSearch));
  document.querySelectorAll("[data-talent-view]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.talentView === state.hrTalentView)));
  document.querySelectorAll("[data-talent-section]").forEach(button => button.addEventListener("click", () => {
    clearTimeout(hrEmployeeSearchTimer);
    if (state.hrTalentSection === "experienced") state.hrTalentFilters.experiences = [];
    state.hrTalentSection = button.dataset.talentSection;
    state.hrTalentStage = { shortlist: "shortlisted", interviews: "interview", offers: "hired" }[state.hrTalentSection] || "all";
    if (state.hrTalentSection === "experienced") state.hrTalentFilters.experiences = ["2-*"];
    state.hrTalentPage = 1;
    state.hrTalentSelected.clear();
    if (window.location.pathname !== "/hr/dashboard") history.pushState({}, "", "/hr/dashboard");
    renderHrDashboard(document.querySelector("#app"));
  }));
  document.querySelector("[data-hr-search]")?.addEventListener("click", openAdvancedCandidateSearch);
  document.querySelector("[data-hr-search]")?.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openAdvancedCandidateSearch();
    }
  });
  document.querySelector(".talent-search-form")?.addEventListener("submit", event => {
    event.preventDefault();
    clearTimeout(hrEmployeeSearchTimer);
    openAdvancedCandidateSearch();
  });
  document.querySelectorAll("[data-talent-checkbox]").forEach(input => input.addEventListener("change", () => {
    const key = input.dataset.talentCheckbox;
    state.hrTalentFilters[key] = [...document.querySelectorAll(`[data-talent-checkbox="${key}"]:checked`)].map(item => item.value);
    const quick = document.querySelector(`[data-talent-quick-filter="${key}"]`);
    if (quick) quick.value = state.hrTalentFilters[key].length === 1 ? state.hrTalentFilters[key][0] : "";
    reloadTalentRecords();
  }));
  document.querySelectorAll("[data-talent-quick-filter]").forEach(select => select.addEventListener("change", () => {
    const key = select.dataset.talentQuickFilter;
    state.hrTalentFilters[key] = select.value ? [select.value] : [];
    document.querySelectorAll(`[data-talent-checkbox="${key}"]`).forEach(input => { input.checked = input.value === select.value; });
    reloadTalentRecords();
  }));
  document.querySelectorAll("[data-talent-filter]").forEach(input => input.addEventListener(input.tagName === "SELECT" ? "change" : "input", () => {
    state.hrTalentFilters[input.dataset.talentFilter] = input.value;
    ++hrEmployeeRequestId;
    clearTimeout(hrEmployeeSearchTimer);
    hrEmployeeSearchTimer = setTimeout(reloadTalentRecords, input.tagName === "SELECT" ? 0 : 300);
  }));
  document.querySelectorAll("[data-filter-options]").forEach(input => input.addEventListener("input", () => {
    document.querySelectorAll(`[data-filter-option-list="${input.dataset.filterOptions}"] label`).forEach(label => { label.hidden = !label.textContent.toLowerCase().includes(input.value.toLowerCase()); });
  }));
  document.querySelectorAll("[data-clear-talent-filters]").forEach(button => button.addEventListener("click", clearTalentFilters));
  document.querySelectorAll("[data-talent-stage]").forEach(button => button.addEventListener("click", () => {
    state.hrTalentStage = button.dataset.talentStage;
    document.querySelectorAll("[data-talent-stage]").forEach(item => item.classList.toggle("active", item === button));
    reloadTalentRecords();
  }));
  document.querySelectorAll("[data-talent-page]").forEach(button => button.addEventListener("click", () => {
    clearTimeout(hrEmployeeSearchTimer);
    state.hrTalentPage += Number(button.dataset.talentPage);
    state.hrTalentSelected.clear();
    updateTalentSelection();
    loadHrEmployees();
    document.querySelector(".talent-results-toolbar")?.scrollIntoView({ block: "nearest" });
  }));
  document.querySelectorAll("[data-talent-view]").forEach(button => button.addEventListener("click", () => {
    state.hrTalentView = button.dataset.talentView;
    document.querySelectorAll("[data-talent-view]").forEach(item => {
      item.classList.toggle("active", item === button);
      item.setAttribute("aria-pressed", String(item === button));
    });
    renderTalentRecords(state.hrEmployees);
  }));
  document.querySelector("[data-more-talent-filters]")?.addEventListener("click", () => {
    const panel = document.querySelector(".talent-more-filters");
    panel.hidden = !panel.hidden;
  });
  document.querySelector("[data-toggle-talent-filters]")?.addEventListener("click", () => document.querySelector(".talent-layout").classList.toggle("show-filters"));
  document.querySelector("[data-clear-talent-selection]")?.addEventListener("click", () => {
    state.hrTalentSelected.clear();
    renderTalentRecords(state.hrEmployees);
  });
  document.querySelector("[data-bulk-shortlist]")?.addEventListener("click", () => {
    const pipeline = loadRoleWorkspace(talentStorageKey("pipeline"), {});
    for (const id of state.hrTalentSelected) pipeline[id] = { stage: "shortlisted", updatedAt: new Date().toISOString() };
    saveRoleWorkspace(talentStorageKey("pipeline"), pipeline);
    state.hrTalentSelected.clear();
    if (state.hrTalentStage !== "all") reloadTalentRecords();
    else renderTalentRecords(state.hrEmployees);
  });
  document.querySelector("[data-export-talent]")?.addEventListener("click", () => {
    const rows = [["Name", "Email", "Phone", "Location", "Experience", "Skills"], ...state.hrEmployees.filter((employee, index) => state.hrTalentSelected.has(employeeRecordId(employee, index))).map(employee => [employee.name, employee.email, employee.phone, employee.location, employee.experience, employee.keywords])];
    const csv = rows.map(row => row.map(value => `"${String(value ?? "").replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "talme-candidates.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.querySelector("[data-save-talent-search]")?.addEventListener("click", () => {
    const saved = loadRoleWorkspace(talentStorageKey("searches"), []);
    saved.push({ name: state.hrEmployeeSearchQuery || [...state.hrTalentFilters.skills, ...state.hrTalentFilters.locations].join(", ") || `Search ${saved.length + 1}`, query: state.hrEmployeeSearchQuery, filters: structuredClone(state.hrTalentFilters), advanced: state.hrAdvancedApplied ? structuredClone(state.hrAdvancedSearch) : null });
    saveRoleWorkspace(talentStorageKey("searches"), saved.slice(-15));
    renderHrDashboard(document.querySelector("#app"));
  });
  document.querySelectorAll("[data-saved-talent-search]").forEach(button => button.addEventListener("click", () => {
    const saved = loadRoleWorkspace(talentStorageKey("searches"), [])[Number(button.dataset.savedTalentSearch)];
    if (!saved) return;
    state.hrEmployeeSearchQuery = saved.query;
    state.hrAdvancedApplied = Boolean(saved.advanced);
    state.hrAdvancedSearch = saved.advanced ? structuredClone(saved.advanced) : null;
    state.hrCandidateSearchDraft = saved.advanced ? structuredClone(saved.advanced) : null;
    state.hrTalentFilters = structuredClone(saved.filters);
    state.hrTalentPage = 1;
    state.hrTalentStage = "all";
    renderHrDashboard(document.querySelector("#app"));
  }));
  document.querySelector("[data-talent-theme]")?.addEventListener("change", event => {
    state.theme = event.target.value;
    localStorage.setItem("talme_theme", state.theme);
    document.body.classList.toggle("dark", state.theme === "dark");
  });
  updateTalentSummary();
}

function duplicateHrEmployees(items) {
  const buckets = new Map();
  const addKey = (key, employee) => {
    const normalized = String(key || "").trim().toLowerCase();
    if (!normalized) return;
    if (!buckets.has(normalized)) buckets.set(normalized, []);
    buckets.get(normalized).push(employee);
  };

  items.forEach(employee => {
    addKey(`email:${employee.email}`, employee);
    addKey(`phone:${employee.phone}`, employee);
    addKey(`name:${employee.name}`, employee);
  });

  const duplicates = [];
  const seen = new Set();
  for (const group of buckets.values()) {
    if (group.length < 2) continue;
    group.forEach(employee => {
      const key = `${String(employee.email || "").toLowerCase()}|${String(employee.phone || "")}|${String(employee.name || "").toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      duplicates.push(employee);
    });
  }
  return duplicates;
}

function employeeSkillChips(keywords, employeeId, query = "") {
  const skills = employeeSkills(keywords);
  if (!skills.length) return "<strong>--</strong>";
  const isExpanded = state.expandedEmployeeSkills.has(String(employeeId));
  const visibleSkills = isExpanded || query ? skills : skills.slice(0, 18);
  const remaining = skills.length - visibleSkills.length;
  return `
    ${visibleSkills.map(skill => `<mark>${highlightSearch(skill, query)}</mark>`).join("")}
    ${remaining > 0 ? `<button class="skill-more" type="button" data-expand-skills="${escapeHtml(employeeId)}">+${remaining} more</button>` : ""}
    ${isExpanded && skills.length > 18 ? `<button class="skill-more" type="button" data-collapse-skills="${escapeHtml(employeeId)}">Show less</button>` : ""}
  `;
}

function bindEmployeeCardActions() {
  const employeeList = document.querySelector("[data-hr-employees]");
  if (employeeList && !employeeList.dataset.skillToggleBound) {
    employeeList.dataset.skillToggleBound = "true";
    employeeList.addEventListener("click", event => {
      const clickTarget = event.target instanceof Element ? event.target : event.target.parentElement;
      const expandButton = clickTarget?.closest("[data-expand-skills]");
      const collapseButton = clickTarget?.closest("[data-collapse-skills]");
      if (!expandButton && !collapseButton) return;
      const employeeId = String((expandButton || collapseButton).dataset.expandSkills || collapseButton?.dataset.collapseSkills || "");
      if (!employeeId) return;
      event.preventDefault();
      if (expandButton) {
        state.expandedEmployeeSkills.add(employeeId);
      } else {
        state.expandedEmployeeSkills.delete(employeeId);
      }
      renderHrEmployees();
    });
  }

  document.querySelectorAll("[data-employee-profile]").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      const employee = findHrEmployeeById(button.dataset.employeeId);
      if (employee) navigateHrEmployeeProfile(employee, button.dataset.employeeId);
    });
  });
  document.querySelectorAll("[data-employee-email]").forEach(button => {
    button.addEventListener("click", () => {
      window.location.href = `mailto:${button.dataset.employeeEmail}`;
    });
  });
}

function employeeSkills(keywords) {
  return String(keywords || "").split(",").map(skill => skill.trim()).filter(Boolean);
}

function searchTokens(query) {
  return String(query || "").trim().split(/\s+/).filter(Boolean);
}

function employeeSearchText(employee) {
  return [
    employee.name,
    employee.email,
    employee.phone,
    employee.location,
    employee.keywords,
    employee.employee_code,
    employee.employeeCode,
    employee.designation,
    employee.department,
    employee.current_company,
    employee.currentCompany,
    employee.current_designation,
    employee.currentDesignation
  ].filter(Boolean).join(" ").toLowerCase();
}

function employeeMatchesSearch(employee, query) {
  const haystack = employeeSearchText(employee);
  const phoneDigits = String(employee.phone || "").replace(/\D/g, "");
  return searchTokens(query).every(token => {
    const normalizedToken = token.toLowerCase();
    const tokenDigits = normalizedToken.replace(/\D/g, "");
    return haystack.includes(normalizedToken) || Boolean(tokenDigits && phoneDigits.includes(tokenDigits));
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightSearch(value, query) {
  const text = String(value ?? "");
  const tokens = [...new Set(searchTokens(query))]
    .map(escapeRegExp)
    .sort((left, right) => right.length - left.length);
  if (!tokens.length) return escapeHtml(text);
  const pattern = new RegExp(`(${tokens.join("|")})`, "gi");
  return text.split(pattern).map(part => {
    const isMatch = searchTokens(query).some(token => part.toLowerCase() === token.toLowerCase());
    return isMatch ? `<span class="search-hit">${escapeHtml(part)}</span>` : escapeHtml(part);
  }).join("");
}

function employeeRecordId(employee, fallbackIndex = 0) {
  return String(employee.id ?? employee.employee_code ?? employee.email ?? employee.phone ?? fallbackIndex);
}

function defaultEmployeeCode(employee) {
  const existingCode = String(employee.employee_code || employee.employeeCode || "");
  const existingNumber = existingCode.match(/\d+/g)?.at(-1);
  const sourceNumber = existingNumber || employee.rowNumber || employee.id || "";
  return sourceNumber ? String(sourceNumber).padStart(5, "0") : "";
}

function findHrEmployeeById(employeeId) {
  const normalizedId = decodeURIComponent(String(employeeId || "")).toLowerCase();
  return state.hrEmployees.find((employee, index) => {
    const keys = [
      employeeRecordId(employee, index),
      employee.employee_code,
      employee.email,
      employee.phone
    ];
    return keys.some(key => String(key || "").toLowerCase() === normalizedId);
  });
}

function navigateHrEmployeeProfile(employee, employeeId = employeeRecordId(employee)) {
  const routeId = encodeURIComponent(employeeId || employeeRecordId(employee));
  history.pushState({}, "", `/hr/employees/${routeId}`);
  renderHrEmployeeRoute(window.location.pathname);
}

async function renderHrEmployeeRoute(pathname) {
  const root = document.querySelector("#app");
  if (!state.accessToken || !state.user) return renderLandingPage();
  if (!state.user.permissions?.includes("employees.manage") && !state.user.permissions?.includes("*")) return renderForbidden("403 Forbidden");
  const employeeId = decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "");
  renderEmployeeProfileLoading(root);
  stopHrEmployeesLive();
  try {
    const payload = await api(`/api/hr/employees/${encodeURIComponent(employeeId)}`);
    if (window.location.pathname !== pathname) return;
    if (!payload.employee) throw new Error("Employee details were not found.");
    const index = state.hrEmployees.findIndex(employee => employeeRecordId(employee) === employeeRecordId(payload.employee));
    if (index >= 0) state.hrEmployees[index] = payload.employee;
    else state.hrEmployees.push(payload.employee);
    renderHrEmployeeProfile(root, payload.employee);
  } catch (error) {
    if (window.location.pathname === pathname) renderEmployeeProfileLoading(root, error.message, true);
  }
}

function renderHrEmployeeProfile(root, employee, options = {}) {
  renderEmployeeProfileWorkspace(root, employee, options);
}


function employeeEditForm(employee) {
  const value = field => escapeHtml(employee[field] || "");
  const currentCompany = employee.current_company || employee.currentCompany || "";
  const currentDesignation = employee.current_designation || employee.currentDesignation || employee.designation || "";
  const employeeCode = defaultEmployeeCode(employee);
  return `
    <form class="employee-edit-form" data-employee-edit-form>
      <section class="profile-section">
        <h2>Edit information</h2>
        <div class="candidate-add-grid employee-edit-grid">
          <label class="field">
            <span>Full name</span>
            <input name="name" autocomplete="name" value="${escapeHtml(employee.name || employee.fullName || "")}" required>
          </label>
          <label class="field">
            <span>Email</span>
            <input name="email" type="email" autocomplete="email" value="${value("email")}">
          </label>
          <label class="field">
            <span>Phone number</span>
            <input name="phone" inputmode="tel" autocomplete="tel" value="${value("phone")}">
            <small class="field-hint">Edit this number and click Save changes.</small>
          </label>
          <label class="field">
            <span>Employee code</span>
            <input name="employeeCode" value="${escapeHtml(employeeCode)}" readonly>
            <small class="field-hint">Generated automatically as numbers only.</small>
          </label>
          <label class="field">
            <span>Designation</span>
            <input name="designation" value="${escapeHtml(employee.designation || "")}">
          </label>
          <label class="field">
            <span>Department</span>
            <input name="department" value="${value("department")}">
          </label>
          <label class="field">
            <span>Location</span>
            <input name="location" value="${value("location")}">
          </label>
          <label class="field">
            <span>Experience</span>
            <input name="experience" type="number" min="0" step="0.1" value="${escapeHtml(employee.experience ?? "")}">
          </label>
          <label class="field">
            <span>Current company</span>
            <input name="currentCompany" value="${escapeHtml(currentCompany)}">
          </label>
          <label class="field">
            <span>Current designation</span>
            <input name="currentDesignation" value="${escapeHtml(currentDesignation)}">
          </label>
          <label class="field candidate-add-wide">
            <span>Key skills</span>
            <textarea name="keywords" rows="4">${value("keywords")}</textarea>
          </label>
          <label class="field candidate-add-wide">
            <span>Upload CV</span>
            <input name="cv" type="file" accept=".pdf,.doc,.docx">
            <small class="field-hint">Current CV: ${escapeHtml(employee.cv_file_name || employee.cvFileName || "No CV attached")}</small>
          </label>
          <label class="field">
            <span>Source</span>
            <input value="${escapeHtml(employee.source || "Database")}" disabled>
          </label>
          <label class="field">
            <span>Row number</span>
            <input value="${escapeHtml(employee.rowNumber || "")}" disabled>
          </label>
        </div>
        <p class="notice" data-employee-edit-status></p>
        <div class="employee-edit-actions">
          <button class="btn" type="button" data-employee-edit-cancel>Cancel</button>
          <button class="btn primary" type="submit">${icon("shield")}Save changes</button>
        </div>
      </section>
    </form>
  `;
}

function updateHrEmployeeInState(employeeId, updatedEmployee) {
  const index = state.hrEmployees.findIndex((employee, rowIndex) => {
    const keys = [employeeRecordId(employee, rowIndex), employee.employee_code, employee.email, employee.phone];
    return keys.some(key => String(key || "").toLowerCase() === String(employeeId || "").toLowerCase());
  });
  if (index >= 0) {
    state.hrEmployees[index] = { ...state.hrEmployees[index], ...updatedEmployee };
  }
}


function bindEmployeeProfileActions(employee, isEditing = false, activeTab = "profile") {
  const phone = String(employee.phone || "").trim();
  const email = String(employee.email || "").trim();
  const revealPhone = button => {
    const value = phone || "Phone not added";
    document.querySelectorAll("[data-employee-profile-phone]").forEach(node => {
      node.hidden = false;
      node.textContent = value;
      node.classList.add("visible");
    });
    if (button) {
      button.textContent = value;
      button.classList.add("revealed");
    }
  };

  document.querySelectorAll("[data-employee-profile-call]").forEach(button => button.addEventListener("click", event => {
    if (!document.querySelector(".employee-profile-workspace")) revealPhone(event.currentTarget);
    if (phone) window.location.href = `tel:${phone}`;
  }));
  document.querySelectorAll("[data-employee-profile-email]").forEach(button => button.addEventListener("click", () => {
    if (email) window.location.href = `mailto:${email}?subject=${encodeURIComponent(`Regarding your profile, ${employee.name || "employee"}`)}`;
  }));
  document.querySelectorAll("[data-employee-edit]").forEach(button => button.addEventListener("click", () => {
    const field = button.dataset.employeeEditFocus;
    renderHrEmployeeProfile(document.querySelector("#app"), employee, { edit: !isEditing, tab: activeTab });
    if (field && !isEditing) document.querySelector(`[data-employee-edit-form] [name="${field}"]`)?.focus();
  }));
  document.querySelectorAll("[data-employee-tab]").forEach(button => {
    button.addEventListener("click", () => {
      renderHrEmployeeProfile(document.querySelector("#app"), employee, { tab: button.dataset.employeeTab || "profile" });
    });
  });
  document.querySelector("[data-employee-edit-cancel]")?.addEventListener("click", () => {
    renderHrEmployeeProfile(document.querySelector("#app"), employee, { tab: activeTab });
  });
  document.querySelector("[data-employee-edit-form]")?.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = document.querySelector("[data-employee-edit-status]");
    const submit = form.querySelector('button[type="submit"]');
    const employeeId = employeeRecordId(employee);
    status.textContent = "Saving employee details...";
    status.className = "notice";
    submit.disabled = true;
    try {
      const payload = await apiUpload(`/api/hr/employees/${encodeURIComponent(employeeId)}`, new FormData(form), { method: "PUT" });
      const updatedEmployee = { ...employee, ...(payload.employee || {}) };
      updateHrEmployeeInState(employeeId, updatedEmployee);
      renderHrEmployeeProfile(document.querySelector("#app"), updatedEmployee, { status: payload.message || "Employee updated successfully." });
    } catch (error) {
      status.textContent = error.message;
      status.className = "notice error";
      submit.disabled = false;
    }
  });
}

function bindRoleDashboard(scope, options = {}) {
  if (scope !== "admin" && securityMonitorTimer) {
    clearInterval(securityMonitorTimer);
    securityMonitorTimer = null;
  }
  if (scope !== "hr" || !document.querySelector("[data-hr-employees]")) {
    stopHrEmployeesLive();
  }
  bindLanding();
  bindCandidateContactActions();
  document.querySelector("[data-role-home]")?.addEventListener("click", event => {
    navigate(event.currentTarget.dataset.roleHome || state.user?.redirectTo || "/");
  });
  document.querySelector("[data-candidate-profile]")?.addEventListener("click", () => renderHrCandidateProfile(document.querySelector("#app")));
  document.querySelectorAll("[data-open-add-employee]").forEach(button => button.addEventListener("click", openEmployeeAdd));
  document.querySelector("[data-show-duplicates]")?.addEventListener("click", async event => {
    state.hrShowDuplicates = !state.hrShowDuplicates;
    state.hrEmployeeVisibleCount = document.querySelector(".talent-app") ? 20 : 50;
    event.currentTarget.classList.toggle("active", state.hrShowDuplicates);
    if (!state.hrEmployees.length) await fetchHrEmployees();
    renderHrEmployees();
  });
  document.querySelector("[data-open-import]")?.addEventListener("click", openCandidateImport);
  document.querySelector('[data-security-action="registeredDevices"]')?.addEventListener("click", loadRegisteredDevices);
  document.querySelector("[data-hr-search]")?.addEventListener("input", event => {
    if (document.querySelector(".talent-app")) return;
    state.hrEmployeeSearchQuery = event.target.value;
    state.hrEmployeeVisibleCount = 50;
    clearTimeout(hrEmployeeSearchTimer);
    if (document.querySelector("[data-hr-employees]")) {
      hrEmployeeSearchTimer = setTimeout(loadHrEmployees, 250);
    } else {
      navigate("/hr/dashboard");
    }
  });
  document.querySelector("[data-activity]")?.addEventListener("click", () => loadPanel("/api/auth/login-activity", "Login Activity"));
  document.querySelector("[data-devices]")?.addEventListener("click", () => loadPanel("/api/auth/devices", "Device History"));
  document.querySelector(`[data-save-workspace="${scope}"]`)?.addEventListener("click", () => {
    const form = document.querySelector(".workspace-form");
    if (!form) return;
    const data = {
      priority: form.querySelector('[name="priority"]').value,
      announcement: form.querySelector('[name="announcement"]').value,
      ticketStatus: scope === "admin" ? "12 open" : "18 pending"
    };
    saveRoleWorkspace(scope === "admin" ? "talme_admin_workspace" : "talme_hr_workspace", data);
    const notice = document.querySelector("[data-workspace-notice]");
    notice.textContent = `${scope === "admin" ? "Admin" : "HR"} changes saved only in this workspace.`;
    notice.className = "notice ok";
  });
  if (scope === "hr" && document.querySelector("[data-hr-employees]")) {
    if (!options.skipEmployeeLoad) loadHrEmployees();
    startHrEmployeesLive();
  }
}

async function loadRegisteredDevices() {
  const panel = document.querySelector("[data-registered-devices-panel]");
  const target = document.querySelector("[data-registered-devices]");
  if (!panel || !target) return;
  panel.hidden = false;
  target.innerHTML = `<div class="security-empty">Loading registered devices...</div>`;
  try {
    const payload = await api("/api/admin/registered-devices");
    renderRegisteredDevices(payload.items || []);
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    target.innerHTML = `<div class="security-empty">${escapeHtml(error.message)}</div>`;
  }
}

function renderRegisteredDevices(items) {
  const target = document.querySelector("[data-registered-devices]");
  if (!target) return;
  if (!items.length) {
    target.innerHTML = `<div class="security-empty">No registered devices found yet.</div>`;
    return;
  }
  target.innerHTML = `
    <div class="security-row device-row head">
      <span>User</span><span>Role</span><span>Device</span><span>Browser</span><span>IP</span><span>Sessions</span><span>Registered</span><span>Last Seen</span>
    </div>
    ${items.map(item => `
      <div class="security-row device-row">
        <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.email)}${item.phone ? ` | ${escapeHtml(item.phone)}` : ""}</small></span>
        <span>${escapeHtml(item.roles || "User")}</span>
        <span>${escapeHtml(item.device || "Unknown")}</span>
        <span>${escapeHtml(item.browser || "Unknown")}</span>
        <span>${escapeHtml(item.ip_address || "Unknown")}</span>
        <span><strong>${formatNumber(item.active_sessions || 0)}</strong><small>${formatNumber(item.sessions || 0)} total</small></span>
        <span>${formatDateTime(item.created_at)}</span>
        <span>${formatDateTime(item.last_seen_at)}</span>
      </div>
    `).join("")}
  `;
}

function startSecurityMonitor() {
  if (securityMonitorTimer) clearInterval(securityMonitorTimer);
  loadSecurityMonitor();
  securityMonitorTimer = setInterval(loadSecurityMonitor, 5000);
}

async function loadSecurityMonitor() {
  if (document.querySelector(".admin-control")) return loadAdminControlMonitor();
  try {
    const payload = await api("/api/admin/security/live");
    for (const [key, value] of Object.entries(payload.stats || {})) {
      const node = document.querySelector(`[data-security-stat="${key}"]`);
      if (node) node.textContent = formatNumber(value);
    }
    const refreshed = document.querySelector("[data-security-refresh]");
    if (refreshed) refreshed.textContent = `Last refreshed ${new Date(payload.refreshedAt).toLocaleTimeString()}`;
    renderLiveOnlineUsers(payload.liveOnlineUsers || payload.onlineUsers || []);
    renderSessionDetails(payload.sessionDetails || payload.onlineUsers || []);
  } catch (error) {
    const refreshed = document.querySelector("[data-security-refresh]");
    if (refreshed) refreshed.textContent = error.status === 403 ? "Forbidden: Super Admin or Platform Admin only" : error.message;
  }
}

function renderLiveOnlineUsers(users) {
  const target = document.querySelector("[data-live-online-users]");
  if (!target) return;
  renderSecurityUsersTable(target, users, "No users are live right now.");
}

function renderSessionDetails(users) {
  const target = document.querySelector("[data-online-users]");
  if (!target) return;
  renderSecurityUsersTable(target, users, "No stored login details found yet.");
}

function renderSecurityUsersTable(target, users, emptyMessage) {
  if (!users.length) {
    target.innerHTML = `<div class="security-empty">${escapeHtml(emptyMessage)}</div>`;
    return;
  }
  target.innerHTML = `
    <div class="security-row head">
      <span>User</span><span>Role</span><span>Device</span><span>Browser</span><span>IP</span><span>Status</span><span>Session Time</span><span>Last Seen</span>
    </div>
    ${users.map(user => `
      <div class="security-row">
        <span><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.email)}${user.phone ? ` | ${escapeHtml(user.phone)}` : ""}</small></span>
        <span>${escapeHtml(user.roles || "User")}</span>
        <span>${escapeHtml(user.device || "Unknown")}</span>
        <span>${escapeHtml(user.browser || "Unknown")}</span>
        <span>${escapeHtml(user.ip_address || "Unknown")}</span>
        <span><b class="session-status ${sessionStatusClass(user.session_status)}">${escapeHtml(user.session_status || "Unknown")}</b></span>
        <span><strong>Login</strong><small>${formatDateTime(user.created_at)}</small><strong>Logout</strong><small>${user.revoked_at ? formatDateTime(user.revoked_at) : "--"}</small></span>
        <span>${formatDateTime(user.last_seen_at)}</span>
      </div>
    `).join("")}
  `;
}

function formatDateTime(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatEmployeeAuditDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const datePart = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(date);
  const timePart = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
  return `${datePart}, ${timePart}`;
}

function employeeAuditLine(employee) {
  const action = employee.audit_action === "created" ? "Created by" : "Last edited by";
  const name = employee.audit_user_name || employee.last_edited_by_name || employee.created_by_name;
  const at = employee.audit_at || employee.last_edited_at || employee.created_at_audit;
  const formatted = formatEmployeeAuditDate(at);
  if (!name || !formatted) return "";
  return `${action} ${name} • ${formatted}`;
}

function sessionStatusClass(value = "") {
  return String(value).toLowerCase().replace(/\s+/g, "-");
}

function employeeAuditLine(employee) {
  const name = employee.last_edited_by_name || employee.audit_user_name || employee.created_by_name;
  const email = employee.last_edited_by_email || employee.audit_user_email || employee.created_by_email;
  const at = employee.last_edited_at || employee.audit_at || employee.created_at_audit;
  const formatted = formatEmployeeAuditDate(at);
  if (!name || !formatted) return "";
  const account = employeeAuditAccount(name, email);
  return `Last updated by ${account} on ${formatted}`;
}

function employeeAuditAccount(name, email) {
  if (!name && !email) return "";
  if (name && email && email !== name) return `${name} (${email})`;
  return name || email;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-IN");
}

function formatExperience(value) {
  if (value == null || value === "") return "Experience not added";
  const years = Number(value);
  if (Number.isNaN(years)) return String(value);
  const label = Number.isInteger(years) ? String(years) : years.toFixed(1).replace(/\.0$/, "");
  return `${label} ${years === 1 ? "year" : "years"}`;
}

function renderCandidateDashboard(root) {
  const firstName = (state.user?.name || "harshitha").split(" ")[0];
  root.innerHTML = h`
    <main class="site candidate-app">
      <header class="candidate-topbar">
        <div class="candidate-brand">
          <img src="/talme-logo.png" alt="Talme Technologies Pvt Ltd">
          <div><strong>Talme</strong><span>Candidate Home</span></div>
        </div>
        <nav class="candidate-tabs" aria-label="Candidate navigation">
          <a class="active" href="/candidate/dashboard">Dashboard</a>
          <a href="#jobs">Jobs</a>
          <a href="#applications">Applications</a>
          <a href="#resume">Resume</a>
          <a href="#profile">Profile</a>
        </nav>
        <div class="candidate-actions">
          <button class="btn" data-activity>Login Activity</button>
          <button class="btn primary" data-logout>${icon("logout")}Logout</button>
        </div>
      </header>
      <section class="candidate-home">
        <div class="candidate-shell">
          <h1>Welcome, ${firstName}!</h1>
          <div class="candidate-layout">
            <div class="candidate-main">
              <section class="quota-panel">
                <div class="panel-title">
                  <h2>Quota usage</h2>
                  <p>Track your and your company's quota</p>
                </div>
                <div class="quota-grid">
                  ${quotaCard("13,000 CV Access", "1,114 used by all", "11,886 left", "190 used by you", 9)}
                  ${quotaCard("1,30,000 NVite", "1,362 used by all", "1,28,638 left", "None used by you", 2)}
                </div>
              </section>

              <section class="search-panel">
                <div class="panel-title">
                  <h2>Resdex Searches</h2>
                </div>
                <div class="recent-row">
                  <span>Recently searched for</span>
                  <div class="search-chips">
                    <button>Teradyne, Advantest, Uflex...</button>
                    <button>Post Silicon Validation Eng...</button>
                    <button>9080514889</button>
                    <button>88612...</button>
                    <button class="chip-next">${icon("arrow")}</button>
                  </div>
                </div>
                <div class="saved-head">
                  <span>Saved Searches</span>
                  <span>New profiles</span>
                </div>
                <div class="saved-list">
                  ${[
                    "ATE - Teradyne, Advantest, Uflex, Ultra Flex, IFlex, UltraFlex +, V 93K, ETS 88, ETS 36...",
                    "product engineer - Ate Test, V93k, New product development, Product Engineer, At...",
                    "Tessolve - Ate Test, V93k, New product development, Product Engineer, Ate Testing...",
                    "labview - NI Hardware, Teststand, Labview Developer, IEC 60601, ISO 13485, ISO 14..."
                  ].map((item, index) => `<div class="saved-row ${index % 2 ? "soft" : ""}"><span>${item}</span><strong>0</strong></div>`).join("")}
                </div>
              </section>
            </div>

            <aside class="candidate-side">
              <section class="webinar-card">
                <h2>Upcoming Webinars</h2>
                <div class="webinar-event">
                  <time><strong>30 Jul</strong><span>10:15 AM</span></time>
                  <span>Resdex - Basics</span>
                </div>
                <button class="btn primary">View all webinars</button>
              </section>
            </aside>
          </div>
        </div>
        <button class="help-bubble">${icon("users")} Talme help</button>
      </section>
    </main>
  `;
  document.querySelector("[data-logout]")?.addEventListener("click", logout);
  document.querySelector("[data-activity]")?.addEventListener("click", () => loadPanel("/api/auth/login-activity", "Login Activity"));
}

function quotaCard(title, used, left, self, percent) {
  return `
    <article class="quota-card">
      <div class="quota-top">
        <strong>RESDEX</strong>
        <span>FULL QUOTA</span>
      </div>
      <h3>${icon("shield")} ${title}</h3>
      <div class="quota-meta">
        <span>${used}</span>
        <span>${left}</span>
      </div>
      <div class="quota-bar"><span style="width:${percent}%"></span></div>
      <p>${icon("users")} ${self}</p>
    </article>
  `;
}

function formatPermission(value) {
  return value.split(".").join(" ").replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

async function loadPanel(path, title) {
  openDataPanel(title, `<div class="security-empty">Loading ${escapeHtml(title)}...</div>`);
  try {
    const payload = await api(path);
    openDataPanel(title, dataPanelTable(payload.items || []));
  } catch (error) {
    openDataPanel(title, `<div class="security-empty">${escapeHtml(error.message)}</div>`);
  }
}

function openDataPanel(title, content) {
  document.querySelector(".data-panel-backdrop")?.remove();
  document.body.insertAdjacentHTML("beforeend", `
    <div class="data-panel-backdrop">
      <section class="data-panel-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="modal-top">
          <div>
            <h2>${escapeHtml(title)}</h2>
            <p>Recent account activity from the backend.</p>
          </div>
          <button class="icon-btn" type="button" data-data-panel-close>${icon("x")}</button>
        </div>
        <div class="data-panel-body">
          ${content}
        </div>
      </section>
    </div>
  `);
  document.querySelectorAll("[data-data-panel-close], .data-panel-backdrop").forEach(node => {
    node.addEventListener("click", event => {
      if (event.target === node || event.currentTarget.hasAttribute("data-data-panel-close")) {
        document.querySelector(".data-panel-backdrop")?.remove();
      }
    });
  });
  document.addEventListener("keydown", closeDataPanelOnEscape, { once: true });
}

function closeDataPanelOnEscape(event) {
  if (event.key === "Escape") document.querySelector(".data-panel-backdrop")?.remove();
}

function dataPanelTable(items) {
  if (!items.length) return `<div class="security-empty">No records found.</div>`;
  const columns = Object.keys(items[0]);
  return `
    <div class="data-panel-table" style="--panel-columns:${columns.length}">
      ${columns.map(column => `<div class="head">${escapeHtml(formatPanelLabel(column))}</div>`).join("")}
      ${items.map(item => columns.map(column => `<div>${formatPanelValue(item[column])}</div>`).join("")).join("")}
    </div>
  `;
}

function formatPanelLabel(value) {
  return String(value).replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function formatPanelValue(value) {
  if (value == null || value === "") return "<span class=\"muted-value\">--</span>";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return escapeHtml(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return escapeHtml(formatDateTime(value));
  return escapeHtml(value);
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
  } finally {
    clearStoredAuth();
    navigate("/");
  }
}

async function logoutAll() {
  try {
    await api("/api/auth/logout-all", { method: "POST" });
    await logout();
  } catch (error) {
    alert(error.message);
  }
}

function renderForbidden(message) {
  document.querySelector("#app").innerHTML = h`
    <main class="site">
      ${nav()}
      <section class="forbidden">
        <div>
          <h1>${message}</h1>
          <p class="notice">This page requires a role with the matching permission.</p>
          <button class="btn primary" data-open-login>${icon("lock")}Login</button>
        </div>
      </section>
    </main>
  `;
  bindLanding();
}

function renderLandingPage() {
  if (window.location.pathname !== "/") {
    history.replaceState({}, "", "/");
  }
  document.querySelector("#app").innerHTML = landing();
  bindLanding();
}

window.addEventListener("popstate", render);
bindTabCloseLogout();
hydrate();
