const state = {
  accessToken: sessionStorage.getItem("talme_access") || "",
  csrfToken: sessionStorage.getItem("talme_csrf") || "",
  user: null,
  authMode: "login",
  selectedRole: "super_admin",
  theme: localStorage.getItem("talme_theme") || "light",
  candidateImportId: "",
  hrEmployees: [],
  hrEmployeeVisibleCount: 50,
  hrEmployeeSearchQuery: "",
  hrShowDuplicates: false,
  expandedEmployeeSkills: new Set(),
  hrImportConfirmation: "",
  skipUnloadLogout: false,
  unloadLogoutSent: false
};

localStorage.removeItem("talme_access");
localStorage.removeItem("talme_csrf");
localStorage.removeItem("talme_accounts");

const roleTabs = [
  ["super_admin", "Admin"],
  ["hr_manager", "Talme HR"]
];

const registerTypes = [
  ["candidate", "Candidate Registration"],
  ["employer", "Employer Registration"],
  ["recruiter", "Recruiter Registration"],
  ["employee", "Employee Registration (Invite Only)"],
  ["company", "Company Registration"]
];

const roleCards = [
  ["Candidate", ["Search Jobs", "Apply Jobs", "Upload Resume", "Track Applications", "AI Resume Builder"]],
  ["Employer", ["Post Jobs", "Search Candidates", "Resume Database", "ATS", "Company Dashboard", "Reports"]],
  ["Recruiter", ["Candidate Pipeline", "Interview Management", "Schedule Interviews", "Candidate Notes", "Email Candidates"]],
  ["HR Manager", ["Employees", "Attendance", "Payroll", "Leaves", "Performance", "Documents", "Shifts"]],
  ["Employee", ["Dashboard", "Punch In", "Punch Out", "Attendance", "Salary Slips", "Leave Requests", "Profile", "Documents"]],
  ["Company Admin", ["Employees", "Recruiters", "Jobs", "Payroll", "Attendance", "Leaves", "Reports", "Billing"]],
  ["Platform Admin", ["Companies", "Subscriptions", "Approvals", "Analytics", "Support Tickets"]],
  ["Super Admin", ["Complete access to everything"]]
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

const demoCandidateContact = {
  name: "Vayalpadu Nirupa",
  email: "nirupa@gmail.com",
  phone: "9876543210",
  countryCode: "91"
};

let securityMonitorTimer = null;

document.body.classList.toggle("dark", state.theme === "dark");

function h(strings, ...values) {
  return strings.reduce((out, string, index) => out + string + (values[index] ?? ""), "");
}

function icon(name) {
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

  window.addEventListener("pagehide", event => {
    if (!event.persisted) sendTabCloseLogout();
  });
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
      headers: retryHeaders,
      body
    });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || "Request failed"), { status: response.status, payload });
  return payload;
}

async function apiUpload(path, formData, options = {}) {
  const headers = {};
  if (state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;
  if (state.csrfToken) headers["X-CSRF-Token"] = state.csrfToken;
  let response = await fetch(path, {
    method: options.method || "POST",
    cache: "no-store",
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
      headers: retryHeaders,
      body: formData
    });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || "Upload failed"), { status: response.status, payload });
  return payload;
}

async function refreshSession() {
  try {
    const response = await fetch("/api/auth/refresh", { method: "POST" });
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
  return `+${demoCandidateContact.countryCode}${demoCandidateContact.phone}`;
}

function candidateWhatsAppHref() {
  return `https://wa.me/${demoCandidateContact.countryCode}${demoCandidateContact.phone}`;
}

function revealCandidatePhone(button) {
  const phone = demoCandidateContact.phone;
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
      window.location.href = `mailto:${demoCandidateContact.email}?subject=${encodeURIComponent(`Regarding your profile, ${demoCandidateContact.name}`)}`;
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
  document.body.classList.toggle("dark", state.theme === "dark");
  const pathname = window.location.pathname;
  if (pathname.startsWith("/hr/employees/")) return renderHrEmployeeRoute(pathname);
  if (pathname.includes("/dashboard")) return renderDashboard(pathname);
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
              <div class="shot-status">${icon("users")} 1,501 profiles</div>
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
      <section class="section" id="products">
        <div class="section-head">
          <span class="eyebrow">${icon("key")} Role based access control</span>
          <h2>Every workspace opens only what the role is allowed to use.</h2>
        </div>
        <div class="role-matrix">
          ${roleCards.map(([title, modules], index) => `
            <article class="role-card">
              <div class="role-top"><span>${String(index + 1).padStart(2, "0")}</span><h3>${title}</h3></div>
              <ul>${modules.map(module => `<li>${icon("shield")}${module}</li>`).join("")}</ul>
            </article>
          `).join("")}
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

function openAuth(mode = "login", role = state.selectedRole) {
  state.authMode = mode;
  state.selectedRole = role;
  const existing = document.querySelector(".modal-backdrop");
  if (existing) existing.remove();
  document.body.insertAdjacentHTML("beforeend", authModal());
  bindAuth();
}

function authModal(message = "") {
  return h`
    <div class="modal-backdrop">
      <section class="auth-shell" role="dialog" aria-modal="true" aria-label="Authentication">
        <aside class="auth-left">
          <div class="brand brand-on-dark"><img class="brand-logo full" src="/talme-logo.png" alt="Talme Technologies Pvt Ltd"></div>
          <h2>Secure identity for hiring and workforce operations.</h2>
          <p>Authenticate candidates, employers, recruiters, employees, HR managers, company admins, platform admins, and super admins through one role-aware system.</p>
          <div class="mini-list">
            <div>${icon("shield")} Permission middleware on every API</div>
            <div>${icon("key")} JWT, refresh tokens, CSRF protection</div>
            <div>${icon("users")} Device history, login activity, audit logs</div>
          </div>
          <img src="/illustration.svg" alt="Authentication illustration">
        </aside>
        <section class="auth-right">
          <div class="modal-top">
            <h2>${state.authMode === "login" ? "Welcome back" : "Create account"}</h2>
            <button class="btn icon" title="Close" data-close>${icon("x")}</button>
          </div>
          <div class="tabs">
            ${roleTabs.map(([role, label]) => `<button class="tab ${state.selectedRole === role ? "active" : ""}" data-tab="${role}">${label}</button>`).join("")}
          </div>
          ${state.authMode === "login" ? loginForm(message) : registerForm(message)}
        </section>
      </section>
    </div>
  `;
}

function loginForm(message) {
  const suggestedEmail = demoEmail(state.selectedRole);
  return h`
    <form class="form" data-login-form>
      <input type="hidden" name="role" value="${state.selectedRole}">
      <div class="field">
        <label>Email</label>
        <input name="email" type="email" placeholder="${suggestedEmail}" autocomplete="off" required>
        <small class="field-hint">Enter manually: ${suggestedEmail}</small>
      </div>
      <div class="field">
        <label>Password</label>
        <input name="password" type="password" placeholder="Enter password manually" autocomplete="off" required>
      </div>
      <div class="field">
        <label>Two-Factor Authentication (2FA)</label>
        <input name="twoFactorCode" inputmode="numeric" placeholder="Enter 2FA code manually if required">
      </div>
      <div class="form-row">
        <label class="check"><input name="rememberMe" type="checkbox"> Remember Me</label>
        <button type="button" class="link-button" data-forgot>Forgot Password</button>
      </div>
      <button class="btn primary" type="submit">${icon("lock")}Login using Email + Password</button>
      <div class="form-row">
        <input name="otpContact" placeholder="Mobile or email for OTP" aria-label="Mobile or email for OTP">
        <button class="btn" type="button" data-otp>Login using Mobile OTP</button>
      </div>
      <p class="notice ${message ? "ok" : ""}" data-notice>${message}</p>
      <button class="link-button" type="button" data-switch-register>Need registration?</button>
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
        <input name="phone" inputmode="tel">
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

function demoEmail(role) {
  const map = {
    candidate: "candidate@talme.test",
    employer: "employer@talme.test",
    recruiter: "recruiter@talme.test",
    employee: "employee@talme.test",
    hr_manager: "hr@talme.test",
    company_admin: "company.admin@talme.test",
    platform_admin: "platform.admin@talme.test",
    super_admin: "saidarshaan@talme.in"
  };
  return map[role] || map.super_admin;
}

function demoPassword(role) {
  const map = {
    super_admin: "talme123",
    hr_manager: "Password123!"
  };
  return map[role] || "Password123!";
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
  document.querySelector("[data-otp]")?.addEventListener("click", requestOtp);
  document.querySelector("[data-forgot]")?.addEventListener("click", forgotPassword);
  document.querySelectorAll("[data-toggle-password]").forEach(button => button.addEventListener("click", togglePasswordVisibility));
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setNotice(text, ok = false) {
  const notice = document.querySelector("[data-notice]");
  if (!notice) return;
  notice.textContent = text;
  notice.className = `notice ${ok ? "ok" : "error"}`;
}

async function submitLogin(event) {
  event.preventDefault();
  const body = formData(event.currentTarget);
  body.role = state.selectedRole;
  body.rememberMe = event.currentTarget.rememberMe.checked;
  try {
    const payload = await api("/api/auth/login", { method: "POST", body });
    if (payload.requires2fa) return setNotice(payload.message);
    setTokens(payload);
    document.querySelector(".modal-backdrop")?.remove();
    navigate(payload.user.redirectTo);
  } catch (error) {
    setNotice(error.message);
  }
}

async function submitRegister(event) {
  event.preventDefault();
  const body = formData(event.currentTarget);
  if (body.password !== body.confirmPassword) {
    return setNotice("Password and Confirm Password must match");
  }
  if (!isStrongPassword(body.password)) {
    return setNotice("Password must be at least 8 characters and include uppercase, lowercase, number, and special character");
  }
  try {
    const payload = await api("/api/auth/register", { method: "POST", body });
    setTokens(payload);
    document.querySelector(".modal-backdrop")?.remove();
    navigate(payload.user.redirectTo);
  } catch (error) {
    setNotice(error.message);
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

async function socialLogin(provider) {
  try {
    const payload = await api("/api/auth/social", {
      method: "POST",
      body: {
        provider,
        role: state.selectedRole,
        email: `${provider}.${state.selectedRole}@talme.test`,
        name: `${provider} ${state.selectedRole}`.replaceAll("_", " ")
      }
    });
    setTokens(payload);
    document.querySelector(".modal-backdrop")?.remove();
    navigate(payload.user.redirectTo);
  } catch (error) {
    setNotice(error.message);
  }
}

async function requestOtp() {
  const form = document.querySelector("[data-login-form]");
  const contact = form.otpContact.value || form.email.value;
  try {
    const payload = await api("/api/auth/otp/request", { method: "POST", body: { contact } });
    const code = prompt(`OTP sent. Demo code: ${payload.devCode}`);
    if (!code) return;
    const verified = await api("/api/auth/otp/verify", { method: "POST", body: { contact, code, rememberMe: form.rememberMe.checked } });
    if (verified.accessToken) {
      setTokens(verified);
      document.querySelector(".modal-backdrop")?.remove();
      navigate(verified.user.redirectTo);
    } else {
      setNotice(verified.message, true);
    }
  } catch (error) {
    setNotice(error.message);
  }
}

async function forgotPassword() {
  const email = document.querySelector("[data-login-form] [name=email]")?.value;
  try {
    const payload = await api("/api/auth/forgot-password", { method: "POST", body: { email } });
    setNotice(`${payload.message}${payload.devResetToken ? ` Demo token: ${payload.devResetToken}` : ""}`, true);
  } catch (error) {
    setNotice(error.message);
  }
}

function navigate(path) {
  history.pushState({}, "", path);
  render();
}

async function renderDashboard(pathname) {
  const root = document.querySelector("#app");
  if (!state.accessToken || !state.user) {
    return renderForbidden("Authentication required");
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
  const workspace = loadRoleWorkspace("talme_admin_workspace", {
    announcement: "Review company approvals and platform audit activity.",
    priority: "Security review",
    ticketStatus: "12 open"
  });
  root.innerHTML = h`
    <main class="site role-app admin-app">
      ${roleTopbar(title, role, state.user?.redirectTo || "/admin/dashboard")}
      <section class="role-workspace">
        <div class="role-hero">
          <div>
            <span class="eyebrow">${icon("shield")} Admin only</span>
            <h1>Live device and login monitoring</h1>
            <p>Monitor registered users, active sessions, logged-in users, device types, logout events, and failed login attempts across the platform.</p>
          </div>
          <button class="btn" data-activity>Login Activity</button>
        </div>
        <div class="security-status">
          <span class="live-dot"></span>
          <strong>Real-time security dashboard</strong>
          <small data-security-refresh>Loading live data...</small>
        </div>
        <div class="role-grid security-grid">
          ${securityMetric("Total Registered Users", "totalRegisteredUsers", "registeredDevices")}
          ${securityMetric("Total Active Users", "totalActiveUsers")}
          ${securityMetric("Live Online Users", "liveOnlineUsers")}
          ${securityMetric("Total Logged In Today", "totalLoggedInToday")}
          ${securityMetric("Total Logged Out Today", "totalLoggedOutToday")}
          ${securityMetric("Active Devices", "activeDevices")}
          ${securityMetric("Mobile Devices", "mobileDevices")}
          ${securityMetric("Desktop Devices", "desktopDevices")}
          ${securityMetric("Tablet Devices", "tabletDevices")}
          ${securityMetric("Failed Login Attempts", "failedLoginAttempts")}
        </div>
        <section class="workspace-panel security-table-panel" data-registered-devices-panel hidden>
          <div class="panel-title">
            <h2>Registered Devices</h2>
            <p>All backend-stored devices registered by users.</p>
          </div>
          <div class="security-table" data-registered-devices>
            <div class="security-empty">Click Total Registered Users to load registered devices.</div>
          </div>
        </section>
        <section class="workspace-panel security-table-panel">
          <div class="panel-title">
            <h2>Live Online Users</h2>
            <p>Users with activity in the last 5 minutes.</p>
          </div>
          <div class="security-table" data-live-online-users>
            <div class="security-empty">Loading live online users...</div>
          </div>
        </section>
        <section class="workspace-panel security-table-panel">
          <div class="panel-title">
            <h2>User Login Details</h2>
            <p>Stored backend session details visible only to Super Admin and Platform Admin.</p>
          </div>
          <div class="security-table" data-online-users>
            <div class="security-empty">Loading online users...</div>
          </div>
        </section>
      </section>
    </main>
  `;
  bindRoleDashboard("admin");
  startSecurityMonitor();
}

function renderHrDashboard(root) {
  const workspace = loadRoleWorkspace("talme_hr_workspace", {
    announcement: "Payroll verification and attendance follow-up for this week.",
    priority: "Payroll cutoff",
    ticketStatus: "18 pending"
  });
  root.innerHTML = h`
    <main class="site role-app hr-app">
      ${roleTopbar("Talme HR Workspace", "HR Manager", "/hr/dashboard")}
      <section class="role-workspace">
        <section class="employee-panel">
          <div class="employee-panel-head">
            <div>
              <h2>Employees</h2>
              <p>Employee records appear one by one below.</p>
            </div>
            <div class="employee-panel-actions">
              <button class="btn ${state.hrShowDuplicates ? "active" : ""}" type="button" data-show-duplicates>${icon("users")}Duplicate</button>
              <button class="btn" type="button" data-open-add-employee>${icon("plus")}Add employee</button>
            </div>
          </div>
          <div data-hr-import-confirmation>
            ${state.hrImportConfirmation ? renderHrImportConfirmation(state.hrImportConfirmation) : ""}
          </div>
          <div class="employee-card-list" data-hr-employees>
            <div class="security-empty">Loading employees...</div>
          </div>
        </section>
      </section>
    </main>
  `;
  bindRoleDashboard("hr");
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
              <span>${demoCandidateContact.email}</span>
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
  const addEmployeeAction = role === "HR Manager"
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
          <input type="search" placeholder="Search jobs, talent, companies" ${role === "HR Manager" ? `data-hr-search value="${escapeHtml(state.hrEmployeeSearchQuery)}"` : ""}>
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
            <button class="btn primary" type="submit">${icon("plus")}Add employee</button>
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
    <article><strong>${summary.validRows || 0}</strong><span>Valid rows</span></article>
    <article><strong>${summary.failed || 0}</strong><span>Failed rows</span></article>
  `;

  const rows = payload.preview || [];
  const failedRows = payload.failedRows || [];
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
    <h3>Employee preview</h3>
    <div class="import-preview-note">Showing ${escapeHtml(rows.length)} sample employees. Submit saves all ${escapeHtml(summary.validRows || 0)} valid rows.</div>
    <div class="import-card-list">${employeeCards || `<div class="security-empty">No valid employee rows found.</div>`}</div>
    ${failedRows.length ? `
      <h3>Rows needing fix</h3>
      <div class="failed-list">
        ${failedRows.slice(0, 12).map(row => `<p><b>Row ${escapeHtml(row.rowNumber)}</b> ${escapeHtml((row.reasons || []).join(", "))}</p>`).join("")}
      </div>
    ` : ""}
  `;
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
    document.querySelector("[data-commit-import]").disabled = true;

    try {
      const payload = await apiUpload("/api/import/employees/preview", formData);
      state.candidateImportId = payload.importId;
      renderImportPreview(payload);
      document.querySelector("[data-commit-import]").disabled = false;
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
    status.textContent = "Saving employees into database...";
    status.className = "notice";
    submit.disabled = true;

    try {
      const payload = await api("/api/import/employees/commit", {
        method: "POST",
        body: { importId: state.candidateImportId }
      });
      const summary = payload.summary;
      state.hrImportConfirmation = `${summary.created} created, ${summary.updated} updated, ${summary.failed} failed`;
      state.candidateImportId = "";
      document.querySelector(".import-backdrop")?.remove();
      if (window.location.pathname !== "/hr/dashboard") {
        history.pushState({}, "", "/hr/dashboard");
      }
      renderHrDashboard(document.querySelector("#app"));
      document.querySelector(".employee-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      status.textContent = error.message;
      status.className = "notice error";
      submit.disabled = false;
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
    const status = document.querySelector("[data-add-employee-status]");
    const submit = form.querySelector('button[type="submit"]');
    status.textContent = "Saving employee...";
    status.className = "notice";
    submit.disabled = true;
    try {
      const payload = await apiUpload("/api/hr/employees", new FormData(form));
      status.textContent = payload.message || "Employee added successfully.";
      status.className = "notice ok";
      form.reset();
      await loadHrEmployees();
      document.querySelector(".employee-add-backdrop")?.remove();
    } catch (error) {
      status.textContent = error.message;
      status.className = "notice error";
    } finally {
      submit.disabled = false;
    }
  });
}

async function loadHrEmployees() {
  const target = document.querySelector("[data-hr-employees]");
  if (!target) return;
  try {
    await fetchHrEmployees();
    state.hrEmployeeVisibleCount = 50;
    renderHrEmployees();
  } catch (error) {
    target.innerHTML = `<div class="security-empty">${escapeHtml(error.message)}</div>`;
  }
}

async function fetchHrEmployees() {
  const [payload, importedPayload] = await Promise.all([
    api("/api/hr/employees"),
    api("/api/hr/imported-employees").catch(() => ({ items: [] }))
  ]);
  state.hrEmployees = mergeHrEmployeeLists(payload.items || [], importedPayload.items || []);
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
  const matchedItems = query ? sourceItems.filter(employee => employeeMatchesSearch(employee, query)) : sourceItems;
  if (!matchedItems.length) {
    target.innerHTML = `<div class="security-empty">No employees match "${escapeHtml(query)}".</div>`;
    return;
  }
  const visibleItems = matchedItems.slice(0, state.hrEmployeeVisibleCount);
  target.innerHTML = `
    <div class="employee-list-summary">
      <strong>${visibleItems.length}</strong> of <strong>${matchedItems.length}</strong> ${state.hrShowDuplicates ? "duplicate " : ""}employees shown${query ? ` for <strong>${escapeHtml(query)}</strong>` : ""}
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
    ${visibleItems.length < matchedItems.length ? `
      <div class="employee-list-actions">
        <button class="btn" type="button" data-load-more-employees>Load more</button>
      </div>
    ` : ""}
  `;
  bindEmployeeCardActions();
  document.querySelector("[data-load-more-employees]")?.addEventListener("click", () => {
    state.hrEmployeeVisibleCount += 50;
    renderHrEmployees();
  });
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
  renderHrEmployeeProfile(document.querySelector("#app"), employee);
}

async function renderHrEmployeeRoute(pathname) {
  const root = document.querySelector("#app");
  if (!state.accessToken || !state.user) {
    return renderForbidden("Authentication required");
  }
  if (!state.user?.permissions?.includes("employees.manage") && !state.user?.permissions?.includes("*")) {
    return renderForbidden("403 Forbidden");
  }

  const employeeId = decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "");
  root.innerHTML = h`
    <main class="site role-app hr-app">
      ${roleTopbar("Talme HR Workspace", "HR Manager", "/hr/dashboard")}
      <section class="candidate-profile-wrap">
        <div class="security-empty">Loading employee details...</div>
      </section>
    </main>
  `;
  bindRoleDashboard("hr");

  try {
    if (!state.hrEmployees.length) await fetchHrEmployees();
    const employee = findHrEmployeeById(employeeId);
    if (!employee) {
      root.querySelector(".candidate-profile-wrap").innerHTML = `
        <button class="btn candidate-back" data-back-hr>${icon("arrow")} Back to results</button>
        <div class="security-empty">Employee details were not found.</div>
      `;
      document.querySelector("[data-back-hr]")?.addEventListener("click", () => navigate("/hr/dashboard"));
      return;
    }
    renderHrEmployeeProfile(root, employee);
  } catch (error) {
    root.querySelector(".candidate-profile-wrap").innerHTML = `
      <button class="btn candidate-back" data-back-hr>${icon("arrow")} Back to results</button>
      <div class="security-empty">${escapeHtml(error.message)}</div>
    `;
    document.querySelector("[data-back-hr]")?.addEventListener("click", () => navigate("/hr/dashboard"));
  }
}

function renderHrEmployeeProfile(root, employee, options = {}) {
  const isEditing = Boolean(options.edit);
  const activeTab = options.tab || "profile";
  const statusMessage = options.status || "";
  const name = employee.name || employee.fullName || "Employee";
  const email = employee.email || "";
  const phone = employee.phone || "";
  const location = employee.location || "Location not added";
  const designation = employee.current_designation || employee.currentDesignation || employee.designation || "Employee";
  const company = employee.current_company || employee.currentCompany || "";
  const currentRole = `${designation}${company ? ` at ${company}` : ""}`;
  const skills = employeeSkills(employee.keywords);
  const topSkills = skills.slice(0, 4);
  const summarySkills = topSkills.length ? ` with ${topSkills.join(", ")}` : "";
  const detailRows = [
    ["Employee code", employee.employee_code || employee.employeeCode],
    ["Name", name],
    ["Email", email],
    ["Phone", phone],
    ["Location", employee.location],
    ["Experience", formatExperience(employee.experience)],
    ["Designation", designation],
    ["Department", employee.department],
    ["Current company", company],
    ["CV file", employee.cv_file_name || employee.cvFileName],
    ["Source", employee.source],
    ["Row number", employee.rowNumber]
  ];

  root.innerHTML = h`
    <main class="site role-app hr-app candidate-profile-page">
      ${roleTopbar("Talme HR Workspace", "HR Manager", "/hr/dashboard")}
      <section class="candidate-profile-wrap">
        <button class="btn candidate-back" data-back-hr>${icon("arrow")} Back to results</button>

        <article class="candidate-profile-card">
          <div class="candidate-profile-avatar">${escapeHtml(profileInitials(name))}</div>
          <div class="candidate-profile-main">
            <div class="candidate-profile-title">
              <h1>${escapeHtml(name)}</h1>
              <button class="link-button" type="button" data-employee-edit>${isEditing ? "Cancel" : "Edit"}</button>
            </div>
            <div class="candidate-profile-meta">
              <span>${icon("key")} ${escapeHtml(formatExperience(employee.experience))}</span>
              <span>${icon("shield")} ${escapeHtml(phone || "Phone not added")}</span>
              <span>${icon("search")} ${escapeHtml(location)}</span>
            </div>
            <div class="candidate-profile-facts">
              <span>Current</span>
              <strong>${escapeHtml(currentRole)}</strong>
              <small>${escapeHtml(company || "Current company not added")}</small>
              <span>Department</span>
              <strong>${escapeHtml(employee.department || "Department not added")}</strong>
              <small>${escapeHtml(employee.employee_code || employee.employeeCode || "Employee code not added")}</small>
              <span>Email</span>
              <strong>${escapeHtml(email || "Email not added")}</strong>
              <small></small>
            </div>
            <div class="profile-actions">
              <button class="btn" type="button" data-employee-profile-call>${icon("shield")} Call employee</button>
              <button class="btn success" type="button" data-employee-profile-email>Email employee</button>
            </div>
            <div class="profile-contact">
              <span>${escapeHtml(email || "Email not added")}</span>
              <span class="candidate-phone-value" data-employee-profile-phone hidden></span>
              <b>Employee record</b>
            </div>
          </div>
          <div class="profile-timeline">
            <span>Profile</span>
            <span>${escapeHtml(employee.source || "Database")}</span>
            <span>${escapeHtml(employee.rowNumber ? `Row ${employee.rowNumber}` : "Active")}</span>
            <span>HR</span>
          </div>
        </article>

        <div class="candidate-profile-stats">
          <span>${icon("eye")} Active</span>
          <span>${icon("arrow")} HR</span>
          <span>CV</span>
          <span>${escapeHtml(employee.cv_file_name || employee.cvFileName || "No CV attached")}</span>
          <span>${escapeHtml(location)}</span>
        </div>

        <section class="profile-detail-card">
          <div class="profile-tabs">
            <button class="${activeTab === "profile" ? "active" : ""}" type="button" data-employee-tab="profile">Profile detail</button>
            <button class="${activeTab === "cv" ? "active" : ""}" type="button" data-employee-tab="cv">Attached CV</button>
          </div>
          ${statusMessage ? `<p class="notice ok employee-edit-notice">${escapeHtml(statusMessage)}</p>` : ""}
          ${isEditing ? employeeEditForm(employee) : activeTab === "cv" ? employeeAttachedCv(employee) : employeeProfileDetails(employee, { name, email, phone, location, designation, company, currentRole, skills, summarySkills, detailRows })}
        </section>
      </section>
    </main>
  `;

  bindRoleDashboard("hr");
  document.querySelector("[data-back-hr]")?.addEventListener("click", () => navigate("/hr/dashboard"));
  bindEmployeeProfileActions(employee, isEditing, activeTab);
  if (!isEditing && activeTab === "cv") loadEmployeeCvPreview(employee);
}

function employeeProfileDetails(employee, view) {
  return `
          <div class="profile-summary-note">
            ${escapeHtml(view.currentRole)}${escapeHtml(view.summarySkills)}
          </div>

          <section class="profile-section">
            <h2>Key skills</h2>
            <div class="profile-chip-list">
              ${view.skills.length ? view.skills.map(skill => `<span>${escapeHtml(skill)}</span>`).join("") : "<span>Skills not added</span>"}
            </div>
          </section>

          <section class="profile-section">
            <h2>Work summary</h2>
            <p>${escapeHtml(view.name)} is listed as ${escapeHtml(view.currentRole)} with ${escapeHtml(formatExperience(employee.experience))} of experience in ${escapeHtml(view.location)}.</p>
            <div class="profile-detail-grid">
              <span>Industry</span><strong>${escapeHtml(employee.department || "Not added")}</strong>
              <span>Role</span><strong>${escapeHtml(view.designation)}</strong>
              <span>Company</span><strong>${escapeHtml(view.company || "Not added")}</strong>
            </div>
          </section>

          <section class="profile-section">
            <h2>Employee details</h2>
            <div class="profile-detail-grid">
              ${view.detailRows.map(([label, value]) => `
                <span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "Not added")}</strong>
              `).join("")}
            </div>
          </section>

          <section class="profile-section">
            <h2>Contact details</h2>
            <div class="profile-detail-grid">
              <span>Email</span><strong>${escapeHtml(view.email || "Not added")}</strong>
              <span>Phone</span><strong>${escapeHtml(view.phone || "Not added")}</strong>
              <span>Location</span><strong>${escapeHtml(view.location)}</strong>
            </div>
          </section>

  `;
}

function employeeAttachedCv(employee) {
  const fileName = employee.cv_file_name || employee.cvFileName || "";
  const hasStoredFile = Boolean(employee.cv_stored_name || employee.cvStoredName);
  return `
    <section class="profile-section">
      <h2>Attached CV</h2>
      ${fileName ? `<p>${escapeHtml(fileName)}</p>` : "<p>No attached CV was uploaded for this employee.</p>"}
      ${hasStoredFile ? `
        <div class="cv-preview" data-cv-preview>
          <div class="security-empty">Loading CV...</div>
        </div>
      ` : `
        <div class="cv-preview empty">
          <div class="security-empty">No CV file is available to preview.</div>
        </div>
      `}
    </section>
  `;
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

async function loadEmployeeCvPreview(employee) {
  const target = document.querySelector("[data-cv-preview]");
  if (!target) return;
  const employeeId = employeeRecordId(employee);
  try {
    const response = await fetch(`/api/hr/employees/${encodeURIComponent(employeeId)}/cv`, {
      headers: state.accessToken ? { Authorization: `Bearer ${state.accessToken}` } : {}
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Unable to load CV");
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const fileName = employee.cv_file_name || employee.cvFileName || "employee-cv";
    const extension = fileName.split(".").pop().toLowerCase();
    if (extension === "pdf") {
      target.innerHTML = `
        <iframe class="cv-frame" src="${objectUrl}" title="${escapeHtml(fileName)}"></iframe>
        <div class="cv-actions">
          <a class="btn primary" href="${objectUrl}" download="${escapeHtml(fileName)}">${icon("arrow")}Download CV</a>
        </div>
      `;
      return;
    }
    const previewResponse = extension === "docx"
      ? await fetch(`/api/hr/employees/${encodeURIComponent(employeeId)}/cv-preview`, {
        headers: state.accessToken ? { Authorization: `Bearer ${state.accessToken}` } : {}
      })
      : null;
    const previewPayload = previewResponse?.ok ? await previewResponse.json() : null;
    const previewText = previewPayload?.text || "Preview is not available for this file type.";
    target.innerHTML = `
      <div class="cv-document-preview">
        <div class="cv-document-head">
          <strong>${escapeHtml(fileName)}</strong>
        </div>
        <pre>${escapeHtml(previewText)}</pre>
      </div>
      <div class="cv-actions">
        <a class="btn" href="${objectUrl}" target="_blank" rel="noopener">${icon("arrow")}Open CV</a>
        <a class="btn primary" href="${objectUrl}" download="${escapeHtml(fileName)}">${icon("arrow")}Download CV</a>
      </div>
    `;
  } catch (error) {
    target.innerHTML = `<div class="security-empty">${escapeHtml(error.message)}</div>`;
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

  document.querySelector("[data-employee-profile-call]")?.addEventListener("click", event => {
    revealPhone(event.currentTarget);
    if (phone) window.location.href = `tel:${phone}`;
  });
  document.querySelector("[data-employee-profile-email]")?.addEventListener("click", () => {
    if (email) window.location.href = `mailto:${email}?subject=${encodeURIComponent(`Regarding your profile, ${employee.name || "employee"}`)}`;
  });
  document.querySelector("[data-employee-edit]")?.addEventListener("click", () => {
    renderHrEmployeeProfile(document.querySelector("#app"), employee, { edit: !isEditing, tab: activeTab });
  });
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

function bindRoleDashboard(scope) {
  if (scope !== "admin" && securityMonitorTimer) {
    clearInterval(securityMonitorTimer);
    securityMonitorTimer = null;
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
    state.hrEmployeeVisibleCount = 50;
    event.currentTarget.classList.toggle("active", state.hrShowDuplicates);
    if (!state.hrEmployees.length) await fetchHrEmployees();
    renderHrEmployees();
  });
  document.querySelector("[data-open-import]")?.addEventListener("click", openCandidateImport);
  document.querySelector('[data-security-action="registeredDevices"]')?.addEventListener("click", loadRegisteredDevices);
  document.querySelector("[data-hr-search]")?.addEventListener("input", event => {
    state.hrEmployeeSearchQuery = event.target.value;
    state.hrEmployeeVisibleCount = 50;
    if (document.querySelector("[data-hr-employees]")) {
      renderHrEmployees();
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
  if (scope === "hr") loadHrEmployees();
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

function sessionStatusClass(value = "") {
  return String(value).toLowerCase().replace(/\s+/g, "-");
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

window.addEventListener("popstate", render);
bindTabCloseLogout();
hydrate();
