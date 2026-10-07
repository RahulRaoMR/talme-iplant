const adminControl = { view: "dashboard", days: 7, search: "", payload: null, charts: [], request: 0, tables: {}, page: 1, userId: null, registrationFilter: "ALL", reviewing: false, recordsRequests: {}, reviewNotice: null };

function destroyAdminCharts() {
  adminControl.charts.forEach(chart => chart.destroy());
  adminControl.charts = [];
}

function adminButton(symbol, label, attributes = "") {
  return `<button type="button" class="admin-button" ${attributes}>${icon(symbol)}<span>${label}</span></button>`;
}

function renderAdminControlCenter(root, title, role) {
  destroyAdminCharts();
  if (adminControl.userId !== state.user?.id) {
    Object.assign(adminControl, { userId: state.user?.id, view: "dashboard", search: "", payload: null, tables: {}, page: 1, registrationFilter: "ALL", reviewing: false, recordsRequests: {}, reviewNotice: null });
  }
  const navigation = [
    ["dashboard", "LayoutDashboard", "Dashboard"], ["users", "UsersRound", "Users", null, "admin.users.manage"],
    ["jobs", "BriefcaseBusiness", "Jobs", "/employer/dashboard", "company.dashboard"],
    ["applications", "ClipboardList", "Applications", "/candidate/dashboard", "applications.track"],
    ["talent", "Users", "Talent Pool", "/hr/dashboard", "employees.manage"],
    ["attendance", "CalendarCheck", "Attendance", null, "unavailable"],
    ["devices", "Monitor", "Device Monitoring"], ["security", "ShieldCheck", "Security"],
    ["reports", "ChartNoAxesCombined", "Reports"], ["settings", "Settings", "Settings"]
  ];
  root.innerHTML = `<main class="admin-control">
    <aside class="admin-sidebar">
      <button type="button" class="admin-icon admin-mobile-close" title="Close navigation" aria-label="Close navigation" data-admin-close>${icon("X")}</button>
      <a class="admin-brand" href="${escapeHtml(state.user?.redirectTo || "/admin/dashboard")}"><img src="/talme-logo.png" alt="Talme"><span><strong>${escapeHtml(title)}</strong><small>TALME TECHNOLOGIES</small></span></a>
      <nav aria-label="Admin navigation">${navigation.map(([key, symbol, label, path, permission]) => {
        const allowed = !permission || (permission !== "unavailable" && (state.user?.permissions?.includes(permission) || state.user?.permissions?.includes("*")));
        return `<button type="button" data-admin-view="${key}" ${path ? `data-admin-path="${path}"` : ""} ${allowed ? "" : 'disabled title="Not available in this workspace"'}>${icon(symbol)}<span>${label}</span>${["security", "reports"].includes(key) ? icon("ChevronDown") : ""}</button>`;
      }).join("")}</nav>
      <div class="admin-access">${icon("Crown")}<span><strong>${escapeHtml(role)}</strong><small>${role === "Super Admin" ? "Full access" : "Platform access"}</small></span>${icon("ChevronDown")}</div>
      <div class="admin-sidebar-footer"><span class="admin-support">${icon("CircleHelp")}<span>Need help?<small>Contact administrator</small></span></span><small>v1.0.0</small></div>
    </aside>
    <button type="button" class="admin-navigation-backdrop" aria-label="Close navigation" data-admin-close></button>
    <div class="admin-main">
      <header class="admin-topbar">
        <button type="button" class="admin-icon admin-mobile-menu" title="Open navigation" aria-label="Open navigation" aria-expanded="false" data-admin-menu>${icon("Menu")}</button>
        <label class="admin-search">${icon("Search")}<input type="search" data-admin-search placeholder="Search users, devices, IP addresses..." aria-label="Search monitoring records" value="${escapeHtml(adminControl.search)}"></label>
        <div class="admin-top-actions"><button type="button" class="admin-icon" data-theme title="Toggle theme" aria-label="Toggle theme">${icon(state.theme === "dark" ? "Sun" : "Moon")}</button>
          <details class="admin-notifications"><summary class="admin-icon" aria-label="Security notifications" title="Security notifications">${icon("Bell")}<span data-admin-notification-count hidden></span></summary><div><strong>Security notifications</strong><p data-admin-notifications>Loading security status...</p><button type="button" data-admin-view="security">Review failed attempts ${icon("ArrowRight")}</button></div></details>
          <details class="admin-account"><summary><span class="admin-avatar">${escapeHtml(profileInitials(state.user?.name || role))}</span><strong>${escapeHtml(role)}</strong>${icon("ChevronDown")}</summary><div><strong>${escapeHtml(state.user?.name || role)}</strong><small>${escapeHtml(state.user?.email || "")}</small><button type="button" data-logout>${icon("LogOut")}Logout</button></div></details>
        </div>
      </header>
      <section class="admin-content">
        <div class="admin-heading"><div><span class="admin-eyebrow">${icon("LockKeyhole")}Admin only</span><h1 data-admin-title>Live device and login monitoring</h1><p data-admin-description>Monitor registered users, active sessions, devices, and login events across the platform.</p></div>
          <div class="admin-monitor-controls"><div class="admin-status"><span class="live-dot" data-admin-status-dot></span><div><strong data-admin-status>Connecting to live monitoring</strong><small data-security-refresh>Loading live data...</small></div></div>${adminButton("RefreshCw", "Refresh", "data-admin-refresh")}
            <label class="admin-range">${icon("CalendarDays")}<select data-admin-range aria-label="Monitoring date range"><option value="1">Today (IST)</option><option value="7">Last 7 days (IST)</option><option value="30">Last 30 days (IST)</option><option value="90">Last 90 days (IST)</option></select></label>
          </div>
        </div>
        <div class="admin-error" role="alert" data-admin-error hidden></div>
        <div data-admin-dashboard>
          <section class="admin-metrics" aria-label="Platform security metrics">${[
            ["Total Registered Users", "totalRegisteredUsers", "UsersRound", "blue", "All time", "users"],
            ["Total Active Users", "totalActiveUsers", "UserRound", "green", "Active", "users"],
            ["Total Logged In Today", "totalLoggedInToday", "ChartNoAxesColumnIncreasing", "blue", "Today", "activity"],
            ["Total Logged Out Today", "totalLoggedOutToday", "LogOut", "red", "Today", "activity"],
            ["Desktop Devices", "desktopDevices", "Monitor", "blue", "In use", "devices"],
            ["Mobile Devices", "mobileDevices", "Smartphone", "violet", "In use", "devices"],
            ["Tablet Devices", "tabletDevices", "Tablet", "violet", "In use", "devices"],
            ["Failed Login Attempts", "failedLoginAttempts", "ShieldAlert", "red", "Today", "security"]
          ].map(([label, key, symbol, color, badge, view]) => `<button type="button" class="admin-metric" data-admin-view="${view}"><span class="admin-metric-icon ${color}">${icon(symbol)}</span><span class="admin-metric-main"><span class="admin-metric-label">${label}</span><strong data-security-stat="${key}">--</strong><small>Live platform value</small></span><span class="admin-metric-badge ${color}">${badge}</span></button>`).join("")}</section>
          <section class="admin-charts" aria-label="Monitoring charts">
            <article class="admin-panel admin-activity-chart"><div class="admin-panel-heading"><div>${icon("ChartNoAxesColumnIncreasing")}<span><h2>Login Activity</h2><small>Login and logout events over time (IST)</small></span></div></div><div class="admin-chart-legend"><span><i class="blue"></i>Logins</span><span><i class="red"></i>Logouts</span></div><div class="admin-chart-canvas"><canvas data-admin-activity-chart role="img" aria-label="Daily login and logout counts"></canvas></div></article>
            <article class="admin-panel"><div class="admin-panel-heading"><div>${icon("Monitor")}<span><h2>Device Distribution</h2><small>Devices with active sessions</small></span></div></div><div class="admin-distribution"><div class="admin-donut"><canvas data-admin-device-chart role="img" aria-label="Active device distribution"></canvas><div><strong data-admin-device-total>--</strong><small>Total devices</small></div></div><div class="admin-device-legend" data-admin-device-legend></div></div></article>
            <article class="admin-panel"><div class="admin-panel-heading"><div>${icon("MapPin")}<span><h2>User Locations</h2><small>Approximate login locations</small></span></div><span class="admin-muted">Selected range</span></div><div data-admin-locations></div></article>
          </section>
          <section class="admin-tables"><article class="admin-panel"><div class="admin-panel-heading"><div>${icon("ClipboardClock")}<span><h2>Recent Login Activity</h2><small>Latest user login and logout events</small></span></div><button type="button" class="admin-link" data-admin-view="activity">View all ${icon("ArrowRight")}</button></div><div data-admin-recent class="admin-table-wrap"></div></article>
          <article class="admin-panel"><div class="admin-panel-heading"><div>${icon("ShieldAlert")}<span><h2>Failed Login Attempts</h2><small>Recent failures for security monitoring</small></span></div><button type="button" class="admin-link" data-admin-view="security">View all ${icon("ArrowRight")}</button></div><div data-admin-failed class="admin-table-wrap"></div></article></section>
        </div>
        <section class="admin-detail" data-admin-detail hidden></section>
      </section>
    </div>
  </main>`;
  root.querySelector("[data-admin-range]").value = String(adminControl.days);
  bindLanding();
  root.querySelectorAll("[data-admin-view]").forEach(button => button.addEventListener("click", () => {
    if (button.dataset.adminPath) return navigate(button.dataset.adminPath);
    setAdminView(button.dataset.adminView);
  }));
  root.querySelector("[data-admin-menu]").addEventListener("click", event => {
    const open = root.querySelector(".admin-control").classList.toggle("navigation-open");
    event.currentTarget.setAttribute("aria-expanded", String(open));
    if (open) root.querySelector(".admin-mobile-close").focus();
  });
  const closeNavigation = () => { root.querySelector(".admin-control").classList.remove("navigation-open"); root.querySelector("[data-admin-menu]").setAttribute("aria-expanded", "false"); root.querySelector("[data-admin-menu]").focus(); };
  root.querySelectorAll("[data-admin-close]").forEach(button => button.addEventListener("click", closeNavigation));
  root.querySelector(".admin-control").addEventListener("keydown", event => { if (event.key === "Escape" && root.querySelector(".navigation-open")) closeNavigation(); });
  root.querySelector("[data-admin-refresh]").addEventListener("click", loadSecurityMonitor);
  root.querySelector("[data-admin-locations]").addEventListener("click", event => {
    if (event.target.closest("[data-admin-location-all]")) return setAdminView("locations");
    const button = event.target.closest("[data-admin-location-index]");
    const location = adminControl.payload?.locations?.[Number(button?.dataset.adminLocationIndex)];
    if (!button || !location) return;
    adminControl.search = location.location;
    root.querySelector("[data-admin-search]").value = adminControl.search;
    updateAdminTables(); setAdminView("activity");
  });
  root.querySelector("[data-admin-range]").addEventListener("change", event => {
    adminControl.days = Number(event.target.value); loadSecurityMonitor();
  });
  root.querySelector("[data-admin-search]").addEventListener("input", event => {
    adminControl.search = event.target.value; adminControl.page = 1; updateAdminTables(); renderAdminDetail();
  });
  setAdminView(adminControl.view);
  updateAdminLocations();
  startSecurityMonitor();
}

function adminMatches(item) {
  const query = adminControl.search.trim().toLowerCase();
  return !query || Object.values(item).some(value => String(value ?? "").toLowerCase().includes(query));
}

function adminTable(columns, rows, empty = "No records in this date range.") {
  if (!rows.length) return `<div class="admin-empty">${icon("Inbox")}<span>${escapeHtml(adminControl.search ? "No matching records." : empty)}</span></div>`;
  return `<table class="admin-table"><thead><tr>${columns.map(column => `<th scope="col">${column}</th>`).join("")}</tr></thead><tbody>${rows.map(cells => `<tr>${cells.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function adminUserCell(item) {
  const name = item.name || item.email || "Unknown user";
  return `<div class="admin-user-cell"><span class="admin-avatar small">${escapeHtml(profileInitials(name))}</span><span><strong>${escapeHtml(name)}</strong>${item.name && item.email ? `<small>${escapeHtml(item.email)}</small>` : ""}</span></div>`;
}

function adminEventTable(items, limit = 100) {
  return adminTable(["User", "Action", "Device", "Location", "IP Address", "Time"], items.filter(adminMatches).slice(0, limit).map(item => [
    adminUserCell(item), `<span class="admin-event ${item.action?.includes("Logout") ? "logout" : "login"}">${item.action?.includes("Logout") ? "Logout" : "Login"}</span>`,
    `<span class="admin-device-cell">${icon(/tablet|ipad/i.test(item.device) ? "Tablet" : /mobile|iphone|android|ios/i.test(item.device) ? "Smartphone" : "Monitor")}${escapeHtml(item.device || "Unknown")}</span>`,
    escapeHtml(item.location || "Unknown"), escapeHtml(item.ip_address || "Unknown"), `<time title="${escapeHtml(formatDateTime(item.timestamp))}">${escapeHtml(new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</time>`
  ]));
}

function adminFailuresTable(items, limit = 100) {
  return adminTable(["User / Email", "IP Address", "Location", "Attempts", "Latest attempt"], items.filter(adminMatches).slice(0, limit).map(item => [
    `<span class="admin-failure-user">${icon("ShieldAlert")}${escapeHtml(item.email || "Unknown")}</span>`, escapeHtml(item.ip_address || "Unknown"), escapeHtml(item.location || "Unknown"), `<strong class="admin-danger">${formatNumber(item.attempts)}</strong>`, escapeHtml(formatDateTime(item.timestamp))
  ]), "No failed login attempts in this date range.");
}

function updateAdminTables() {
  const payload = adminControl.payload;
  const recent = document.querySelector("[data-admin-recent]");
  const failed = document.querySelector("[data-admin-failed]");
  if (recent) recent.innerHTML = payload ? adminEventTable(payload.recentActivity || [], 5) : '<div class="admin-empty">Loading activity...</div>';
  if (failed) failed.innerHTML = payload ? adminFailuresTable(payload.failedAttempts || [], 5) : '<div class="admin-empty">Loading failures...</div>';
}

function updateAdminLocations() {
  const target = document.querySelector("[data-admin-locations]");
  if (!target) return;
  const payload = adminControl.payload;
  const locations = payload?.locations || [];
  const summary = payload?.locationSummary || {};
  const title = !payload ? "Location data unavailable" : summary.localNetworkLogins ? "Local network" : summary.reservedIpLogins ? "Reserved IP" : summary.totalLogins ? "Location unavailable" : "No login activity";
  const description = !payload ? "Waiting for monitoring data." : summary.localNetworkLogins ? "Localhost and private IPs have no city location." : summary.reservedIpLogins ? "Reserved addresses have no geographic location." : summary.totalLogins ? "No location match for the recorded IPs." : "No logins in the selected range.";
  const points = locations.map((item, index) => {
    if (!Number.isFinite(item.mapX) || !Number.isFinite(item.mapY) || item.mapX < 0 || item.mapX > 100 || item.mapY < 0 || item.mapY > 100) return "";
    return `<button type="button" class="admin-location-marker" data-admin-location-index="${index}" style="left:${item.mapX}%;top:${item.mapY}%" title="${escapeHtml(item.location)}: ${formatNumber(item.logins)} logins" aria-label="${escapeHtml(item.location)}: ${formatNumber(item.logins)} logins">${icon("MapPin")}</button>`;
  }).join("");
  const rows = locations.slice(0, 4).map((item, index) => `<button type="button" class="admin-location-row" data-admin-location-index="${index}">${icon("MapPin")}<span>${escapeHtml(item.location)}</span><strong>${formatNumber(item.logins)}</strong></button>`).join("");
  const totals = [summary.localNetworkLogins ? `Local network: ${formatNumber(summary.localNetworkLogins)}` : "", summary.reservedIpLogins ? `Reserved IP: ${formatNumber(summary.reservedIpLogins)}` : "", summary.unavailableLogins ? `Unmatched IP: ${formatNumber(summary.unavailableLogins)}` : ""].filter(Boolean);
  target.innerHTML = `<div class="admin-location-map"><img src="/admin-world-map.png" alt="World map">${points}${locations.length ? "" : `<div class="admin-location-empty"><span class="admin-map-pin">${icon("MapPinOff")}</span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></div>`}</div>${locations.length ? `<div class="admin-location-legend">${rows}</div>` : ""}${totals.length ? `<div class="admin-location-summary">${totals.map(text => `<span>${text}</span>`).join("")}</div>` : ""}${locations.length ? '<button type="button" class="admin-link" data-admin-location-all>View all locations ' + icon("ArrowRight") + "</button>" : ""}`;
}

function setAdminView(view) {
  adminControl.view = view;
  adminControl.page = 1;
  document.querySelector(".admin-control")?.classList.remove("navigation-open");
  document.querySelector("[data-admin-menu]")?.setAttribute("aria-expanded", "false");
  document.querySelectorAll(".admin-sidebar [data-admin-view]").forEach(button => {
    const selected = button.dataset.adminView === view || (view === "activity" && button.dataset.adminView === "dashboard") || (view === "sessions" && button.dataset.adminView === "devices");
    button.classList.toggle("active", selected); button.setAttribute("aria-current", selected ? "page" : "false");
  });
  const titles = { dashboard: "Live device and login monitoring", activity: "Recent login activity", locations: "User login locations", users: "Registered users", devices: "Device monitoring", sessions: "Device monitoring", security: "Failed login attempts", reports: "Security reports", settings: "Admin settings" };
  document.querySelector("[data-admin-title]").textContent = titles[view] || titles.dashboard;
  document.querySelector("[data-admin-dashboard]").hidden = view !== "dashboard";
  document.querySelector("[data-admin-detail]").hidden = view === "dashboard";
  document.querySelector("[data-admin-description]").hidden = view !== "dashboard";
  document.querySelector(".admin-notifications").open = false;
  renderAdminDetail();
  if (["users", "devices"].includes(view)) loadAdminRecords(view);
  if (view === "dashboard") adminControl.charts.forEach(chart => chart.resize());
}

async function loadAdminRecords(view, quiet = false) {
  const root = document.querySelector(".admin-control");
  const request = (adminControl.recordsRequests[view] || 0) + 1;
  adminControl.recordsRequests[view] = request;
  if (!quiet) { adminControl.tables[view] = { loading: true }; renderAdminDetail(); }
  try {
    const result = await api(view === "users" ? "/api/admin/registered-users" : "/api/admin/registered-devices");
    if (root !== document.querySelector(".admin-control") || request !== adminControl.recordsRequests[view]) return;
    adminControl.tables[view] = { items: result.items || [] };
  } catch (error) {
    if (root !== document.querySelector(".admin-control") || request !== adminControl.recordsRequests[view]) return;
    adminControl.tables[view] = { error: error.message };
  }
  if (root === document.querySelector(".admin-control")) renderAdminDetail();
}

function registrationStatus(item) {
  return String(item.approval_status || item.status || "UNKNOWN").toUpperCase();
}

function registrationActions(item) {
  const status = registrationStatus(item);
  if (status === "DELETED") return '<span class="admin-muted">Access blocked</span>';
  const self = String(item.id) === String(state.user?.authUserId);
  const disabled = adminControl.reviewing ? "disabled" : "";
  const action = (key, symbol, label) => adminButton(symbol, label, `${disabled} data-registration-action="${key}" data-registration-id="${escapeHtml(item.id)}" title="${label} registration"`);
  return `<div class="admin-registration-actions">${status !== "APPROVED" ? action("approve", "Check", "Approve") : ""}${!self && status !== "REJECTED" ? action("reject", "X", "Reject") : ""}${!self ? action("delete", "Trash2", "Delete") : '<span class="admin-muted">Your account</span>'}</div>`;
}

async function reviewAdminRegistration(button) {
  if (adminControl.reviewing) return;
  const id = button.dataset.registrationId;
  const action = button.dataset.registrationAction;
  const user = adminControl.tables.users?.items?.find(item => String(item.id) === id);
  if (!user || !["approve", "reject", "delete"].includes(action)) return;
  let confirmation = { confirmed: true };
  if (action === "delete") {
    confirmation = await confirmAdminDeletion(user, button);
    if (!confirmation) return;
  } else if (!window.confirm(`${action === "approve" ? "Approve" : "Reject"} ${user.name || user.email}?\n\n${action === "approve" ? "This account will be allowed to log in and access its assigned workspace." : "The user will be unable to log in and existing sessions will end."}`)) return;
  const root = document.querySelector(".admin-control");
  adminControl.reviewing = true;
  adminControl.recordsRequests.users = (adminControl.recordsRequests.users || 0) + 1;
  adminControl.reviewNotice = null;
  renderAdminDetail();
  try {
    const result = await api(`/api/admin/registered-users/${encodeURIComponent(id)}${action === "delete" ? "" : `/${action}`}`, { method: action === "delete" ? "DELETE" : "POST", body: confirmation });
    if (root !== document.querySelector(".admin-control")) return;
    adminControl.reviewNotice = { message: result.message, error: false };
    // Remove stale approval controls immediately before refreshing the authoritative list.
    adminControl.tables.users.items = adminControl.tables.users.items.map(item => String(item.id) === id ? result.user : item);
  } catch (error) {
    if (root !== document.querySelector(".admin-control")) return;
    adminControl.reviewNotice = { message: error.message, error: true };
    if (error.status === 401 || (error.status === 403 && error.payload?.code !== "PASSWORD_INVALID")) adminControl.tables = {};
  } finally {
    delete confirmation.currentPassword;
    if (root === document.querySelector(".admin-control")) {
      adminControl.reviewing = false;
      renderAdminDetail();
      await loadAdminRecords("users", true);
      loadSecurityMonitor();
    }
  }
}

function confirmAdminDeletion(user, trigger) {
  if (document.querySelector("[data-admin-delete-dialog]")) return Promise.resolve(null);
  return new Promise(resolve => {
    const backdrop = document.createElement("div");
    backdrop.className = "admin-confirm-backdrop";
    backdrop.innerHTML = `<section class="admin-confirm-dialog" data-admin-delete-dialog role="dialog" aria-modal="true" aria-labelledby="admin-delete-title">
      <header><h2 id="admin-delete-title">Delete account</h2><button type="button" class="admin-icon" data-delete-cancel title="Cancel" aria-label="Cancel deletion">${icon("X")}</button></header>
      <p>Login and existing sessions will be blocked permanently for this registration. Its blocked record will be retained.</p>
      <dl><dt>Account</dt><dd>${escapeHtml(user.name || "--")}</dd><dt>Email</dt><dd>${escapeHtml(user.email)}</dd><dt>Role</dt><dd>${escapeHtml(formatRole(user.roles))}</dd></dl>
      <form data-delete-form>
        <label>Confirm account email<input type="email" name="confirmationEmail" required autocomplete="off" spellcheck="false"></label>
        <label>Your admin password<input type="password" name="currentPassword" required autocomplete="current-password"></label>
        <p data-delete-error role="alert" hidden></p>
        <footer>${adminButton("X", "Cancel", "data-delete-cancel")}${adminButton("Trash2", "Delete account", 'data-delete-submit')}</footer>
      </form>
    </section>`;
    const submit = backdrop.querySelector("[data-delete-submit]");
    submit.classList.add("admin-delete-submit"); submit.type = "submit"; submit.disabled = true;
    document.body.append(backdrop);
    const form = backdrop.querySelector("[data-delete-form]");
    const email = form.elements.confirmationEmail;
    const password = form.elements.currentPassword;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = value => {
      form.reset(); backdrop.remove(); document.body.style.overflow = previousOverflow;
      if (trigger.isConnected) trigger.focus();
      resolve(value);
    };
    form.addEventListener("input", () => { submit.disabled = email.value.trim().toLowerCase() !== String(user.email).toLowerCase() || !password.value.trim(); });
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (email.value.trim().toLowerCase() !== String(user.email).toLowerCase() || !password.value.trim()) {
        const notice = backdrop.querySelector("[data-delete-error]"); notice.hidden = false; notice.textContent = "Enter the account's email and your admin password."; return;
      }
      close({ confirmed: true, confirmationEmail: email.value.trim(), currentPassword: password.value });
    });
    backdrop.querySelectorAll("[data-delete-cancel]").forEach(button => button.addEventListener("click", () => close(null)));
    backdrop.addEventListener("click", event => { if (event.target === backdrop) close(null); });
    backdrop.addEventListener("admin-confirm-cancel", () => close(null), { once: true });
    backdrop.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); close(null); }
      if (event.key !== "Tab") return;
      const controls = [...backdrop.querySelectorAll("button:not(:disabled), input")];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    email.focus();
  });
}

function renderAdminDetail() {
  const target = document.querySelector("[data-admin-detail]");
  if (!target || adminControl.view === "dashboard") return;
  const view = adminControl.view;
  const payload = adminControl.payload;
  let content = "";
  if (["users", "devices"].includes(view)) {
    const records = adminControl.tables[view];
    if (!records || records.loading) content = '<div class="admin-empty">Loading records...</div>';
    else if (records.error) content = `<div class="admin-empty" role="alert">${escapeHtml(records.error)}</div>`;
    else {
      const matching = records.items.filter(adminMatches).filter(item => view !== "users" ||
        (adminControl.registrationFilter === "ALL" ? registrationStatus(item) !== "DELETED" : registrationStatus(item) === adminControl.registrationFilter));
      const pages = Math.max(1, Math.ceil(matching.length / 50));
      adminControl.page = Math.min(adminControl.page, pages);
      const start = (adminControl.page - 1) * 50;
      const items = matching.slice(start, start + 50);
      const columns = view === "users" ? ["User", "Phone", "Role", "Status", "Registered", "Actions"] : ["User", "Device", "Browser", "IP Address", "Active Sessions", "Last Seen"];
      const rows = items.map(item => view === "users" ? [adminUserCell(item), escapeHtml(item.phone || "--"), escapeHtml(formatRole(item.roles || "User")), `<span class="admin-registration-status ${escapeHtml(registrationStatus(item).toLowerCase())}">${escapeHtml(registrationStatus(item) === "PENDING" ? "Pending approval" : registrationStatus(item).toLowerCase())}</span>`, escapeHtml(formatDateTime(item.created_at)), registrationActions(item)] : [adminUserCell(item), escapeHtml(item.device || "Unknown"), escapeHtml(item.browser || "Unknown"), escapeHtml(item.ip_address || "Unknown"), formatNumber(item.active_sessions || 0), escapeHtml(formatDateTime(item.last_seen_at))]);
      content = `<div class="admin-record-pagination"><span>${formatNumber(matching.length)} records${view === "devices" ? " (latest 200)" : ""}</span><span>Page ${adminControl.page} of ${pages}</span><button type="button" class="admin-icon" title="Previous page" aria-label="Previous page" data-admin-page="-1" ${adminControl.page === 1 ? "disabled" : ""}>${icon("ChevronLeft")}</button><button type="button" class="admin-icon" title="Next page" aria-label="Next page" data-admin-page="1" ${adminControl.page === pages ? "disabled" : ""}>${icon("ChevronRight")}</button></div>${adminTable(columns, rows)}`;
    }
  } else if (view === "sessions") {
    content = payload ? `<div class="admin-session-summary">${formatNumber(payload.stats.liveOnlineUsers || 0)} live online users</div>${adminTable(["User", "Device", "IP Address", "Status", "Login", "Logout", "Last Seen"], (payload.sessionDetails || []).filter(adminMatches).map(item => [adminUserCell(item), escapeHtml(item.device || "Unknown"), escapeHtml(item.ip_address || "Unknown"), escapeHtml(item.session_status || "Unknown"), escapeHtml(formatDateTime(item.created_at)), item.revoked_at ? escapeHtml(formatDateTime(item.revoked_at)) : "--", escapeHtml(formatDateTime(item.last_seen_at))]))}` : '<div class="admin-empty">Session data unavailable.</div>';
  } else if (view === "locations") content = payload ? adminTable(["Location", "Logins", "Users"], (payload.locations || []).filter(adminMatches).map(item => [escapeHtml(item.location), formatNumber(item.logins), formatNumber(item.users)]), "No public-IP locations in the selected range.") : '<div class="admin-empty">Location data unavailable.</div>';
  else if (view === "activity") content = payload ? `<div class="admin-session-summary">Latest ${formatNumber((payload.recentActivity || []).length)} events in selected range</div>${adminEventTable(payload.recentActivity || [])}` : '<div class="admin-empty">Activity unavailable.</div>';
  else if (view === "security") content = payload ? `<div class="admin-session-summary">Latest ${formatNumber((payload.failedAttempts || []).length)} user / IP groups in selected range</div>${adminFailuresTable(payload.failedAttempts || [])}` : '<div class="admin-empty">Security data unavailable.</div>';
  else if (view === "reports") content = `<div class="admin-detail-toolbar"><h2>Daily activity (IST)</h2>${adminButton("Download", "Export CSV", "data-admin-export")}</div>${payload ? adminTable(["Date (IST)", "Logins", "Logouts"], (payload.activity || []).filter(adminMatches).map(item => [escapeHtml(item.date), formatNumber(item.logins), formatNumber(item.logouts)])) : '<div class="admin-empty">Report unavailable.</div>'}`;
  else if (view === "settings") content = `<div class="admin-settings"><h2>Account</h2><dl><dt>Name</dt><dd>${escapeHtml(state.user?.name || "--")}</dd><dt>Email</dt><dd>${escapeHtml(state.user?.email || "--")}</dd><dt>Role</dt><dd>${escapeHtml(formatRole(state.user?.primaryRole || "super_admin"))}</dd></dl><label>Appearance<select data-admin-theme><option value="light" ${state.theme === "light" ? "selected" : ""}>Light</option><option value="dark" ${state.theme === "dark" ? "selected" : ""}>Dark</option></select></label>${adminButton("LogOut", "Logout", "data-admin-settings-logout")}</div>`;
  const tabs = ["devices", "sessions"].includes(view) ? `<div class="admin-device-tabs" role="group" aria-label="Device monitoring view"><button type="button" class="${view === "devices" ? "active" : ""}" data-admin-detail-view="devices">Registered devices</button><button type="button" class="${view === "sessions" ? "active" : ""}" data-admin-detail-view="sessions">User sessions</button></div>` : "";
  const registrationTabs = view === "users" ? `<div class="admin-registration-filters" role="group" aria-label="Registration status">${[["ALL", "All users"], ["PENDING", "Pending approval"], ["APPROVED", "Approved"], ["REJECTED", "Rejected"], ["DELETED", "Deleted"]].map(([key, label]) => `<button type="button" data-registration-filter="${key}" aria-pressed="${adminControl.registrationFilter === key}" ${adminControl.reviewing ? "disabled" : ""}>${label}${key === "PENDING" && adminControl.tables.users?.items ? ` (${adminControl.tables.users.items.filter(item => registrationStatus(item) === key).length})` : ""}</button>`).join("")}</div>` : "";
  const notice = view === "users" && adminControl.reviewNotice ? `<p class="admin-review-notice ${adminControl.reviewNotice.error ? "error" : ""}" role="${adminControl.reviewNotice.error ? "alert" : "status"}">${escapeHtml(adminControl.reviewNotice.message)}</p>` : "";
  target.innerHTML = `${tabs}${registrationTabs}${notice}<div class="admin-panel admin-table-wrap">${content}</div>`;
  target.querySelectorAll("[data-registration-filter]").forEach(button => button.addEventListener("click", () => { adminControl.registrationFilter = button.dataset.registrationFilter; adminControl.page = 1; renderAdminDetail(); }));
  target.querySelectorAll("[data-registration-action]").forEach(button => button.addEventListener("click", () => reviewAdminRegistration(button)));
  target.querySelectorAll("[data-admin-detail-view]").forEach(button => button.addEventListener("click", () => setAdminView(button.dataset.adminDetailView)));
  target.querySelectorAll("[data-admin-page]").forEach(button => button.addEventListener("click", () => { adminControl.page += Number(button.dataset.adminPage); renderAdminDetail(); }));
  target.querySelector("[data-admin-settings-logout]")?.addEventListener("click", logout);
  target.querySelector("[data-admin-theme]")?.addEventListener("change", event => { state.theme = event.target.value; localStorage.setItem("talme_theme", state.theme); render(); });
  target.querySelector("[data-admin-export]")?.addEventListener("click", () => {
    const csv = ["Date (IST),Logins,Logouts", ...(payload?.activity || []).map(item => `${item.date},${item.logins},${item.logouts}`)].join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "talme-security-activity.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

function updateAdminCharts(payload) {
  if (!window.Chart) return;
  const muted = state.theme === "dark" ? "#a1adbd" : "#64748b";
  const grid = state.theme === "dark" ? "#344050" : "#edf1f6";
  const activity = payload.activity || [];
  const deviceCounts = [payload.stats.desktopDevices || 0, payload.stats.mobileDevices || 0, payload.stats.tabletDevices || 0];
  const other = Math.max(0, (payload.stats.activeDevices || 0) - deviceCounts.reduce((a, b) => a + b, 0));
  const deviceNames = ["Desktop", "Mobile", "Tablet", ...(other ? ["Other"] : [])];
  if (other) deviceCounts.push(other);
  const colors = ["#0964f7", "#19bd8e", "#ffba36", "#9aaaca"];
  const total = deviceCounts.reduce((a, b) => a + b, 0);
  document.querySelector("[data-admin-device-total]").textContent = formatNumber(total);
  document.querySelector("[data-admin-device-legend]").innerHTML = deviceNames.map((name, index) => `<div><i style="background:${colors[index]}"></i><span>${name}</span><strong>${formatNumber(deviceCounts[index])}</strong><small>(${total ? Math.round(deviceCounts[index] / total * 100) : 0}%)</small></div>`).join("");
  const datasets = [
    { label: "Logins", data: activity.map(day => day.logins), borderColor: "#0864f7", backgroundColor: "#0864f716", fill: true, tension: 0.35, pointRadius: 2.5, borderWidth: 2 },
    { label: "Logouts", data: activity.map(day => day.logouts), borderColor: "#f0526d", backgroundColor: "#f0526d0c", fill: true, tension: 0.35, pointRadius: 2.5, borderWidth: 1.5 }
  ];
  const labels = activity.map(day => new Date(`${day.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }));
  if (adminControl.charts.length) {
    adminControl.charts[0].data = { labels, datasets };
    adminControl.charts[1].data = { labels: total ? deviceNames : ["No active devices"], datasets: [{ data: total ? deviceCounts : [1], backgroundColor: total ? colors.slice(0, deviceCounts.length) : [grid], borderWidth: 0 }] };
    adminControl.charts.forEach(chart => chart.update("none"));
    return;
  }
  Chart.defaults.font.family = "Inter, system-ui, sans-serif";
  adminControl.charts = [
    new Chart(document.querySelector("[data-admin-activity-chart]"), { type: "line", data: { labels, datasets }, options: { maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: muted, maxTicksLimit: 6, font: { size: 10 } }, border: { display: false } }, y: { beginAtZero: true, ticks: { color: muted, precision: 0, maxTicksLimit: 5, font: { size: 10 } }, grid: { color: grid }, border: { display: false } } } } }),
    new Chart(document.querySelector("[data-admin-device-chart]"), { type: "doughnut", data: { labels: total ? deviceNames : ["No active devices"], datasets: [{ data: total ? deviceCounts : [1], backgroundColor: total ? colors.slice(0, deviceCounts.length) : [grid], borderWidth: 0 }] }, options: { maintainAspectRatio: false, animation: false, cutout: "68%", plugins: { legend: { display: false }, tooltip: { enabled: total > 0 } } } })
  ];
}

async function loadAdminControlMonitor() {
  const root = document.querySelector(".admin-control");
  if (!root) return;
  const request = ++adminControl.request;
  const button = root.querySelector("[data-admin-refresh]");
  button.disabled = true;
  try {
    const payload = await api(`/api/admin/security/live?days=${adminControl.days}`);
    if (root !== document.querySelector(".admin-control") || request !== adminControl.request) return;
    adminControl.payload = payload;
    root.querySelector("[data-admin-error]").hidden = true;
    root.querySelector("[data-admin-status-dot]").classList.remove("offline");
    root.querySelector("[data-admin-status]").textContent = "Real-time monitoring active";
    root.querySelector("[data-security-refresh]").textContent = `Last updated: ${formatDateTime(payload.refreshedAt)}`;
    for (const [key, value] of Object.entries(payload.stats || {})) {
      const node = root.querySelector(`[data-security-stat="${key}"]`);
      if (node) node.textContent = formatNumber(value);
    }
    const count = payload.stats?.failedLoginAttempts || 0;
    const badge = root.querySelector("[data-admin-notification-count]"); badge.hidden = !count; badge.textContent = count > 99 ? "99+" : String(count);
    root.querySelector("[data-admin-notifications]").textContent = count ? `${formatNumber(count)} failed login attempts today.` : "No failed login attempts today.";
    updateAdminTables(); updateAdminCharts(payload); updateAdminLocations();
    if (adminControl.view === "users" && !adminControl.reviewing) await loadAdminRecords("users", true);
    if (["activity", "security", "reports", "sessions", "locations"].includes(adminControl.view)) renderAdminDetail();
  } catch (error) {
    if (root !== document.querySelector(".admin-control") || request !== adminControl.request) return;
    // Never retain privileged metrics after the user's access is rejected.
    adminControl.payload = null;
    updateAdminLocations();
    if ([401, 403].includes(error.status)) {
      adminControl.tables = {};
      document.querySelector(".admin-confirm-backdrop")?.dispatchEvent(new Event("admin-confirm-cancel"));
    }
    destroyAdminCharts();
    root.querySelectorAll("[data-security-stat], [data-admin-device-total]").forEach(node => { node.textContent = "--"; });
    root.querySelector("[data-admin-device-legend]").innerHTML = "";
    root.querySelector("[data-admin-notification-count]").hidden = true;
    root.querySelector("[data-admin-notifications]").textContent = "Monitoring unavailable.";
    root.querySelector("[data-admin-status-dot]").classList.add("offline");
    root.querySelector("[data-admin-status]").textContent = "Monitoring unavailable";
    root.querySelector("[data-security-refresh]").textContent = "Unable to update live data";
    const message = error.status === 403 ? "Security monitoring requires a Super Admin or Platform Admin account." : error.message;
    const notice = root.querySelector("[data-admin-error]"); notice.hidden = false; notice.textContent = message;
    root.querySelectorAll("[data-admin-recent], [data-admin-failed]").forEach(node => { node.innerHTML = '<div class="admin-empty">Monitoring data unavailable.</div>'; });
    renderAdminDetail();
  } finally { if (request === adminControl.request) button.disabled = false; }
}
