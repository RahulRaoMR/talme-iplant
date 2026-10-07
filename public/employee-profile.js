const employeeProfileResources = { urls: new Set(), generation: 0 };

function releaseEmployeeProfileResources() {
  employeeProfileResources.generation += 1;
  employeeProfileResources.urls.forEach(url => URL.revokeObjectURL(url));
  employeeProfileResources.urls.clear();
  document.querySelector(".employee-cv-dialog")?.remove();
}

function employeeProfileRows(rows) {
  return `<dl class="employee-info-list">${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd class="${value == null || value === "" ? "missing" : ""}">${escapeHtml(value == null || value === "" ? "Not added" : String(value))}</dd>`).join("")}</dl>`;
}

function employeeProfileSection(title, symbol, content, field = "", extraClass = "") {
  return `<section class="employee-info-panel ${extraClass}"><header><h2>${icon(symbol)}${title}</h2>${field ? `<button type="button" class="employee-inline-edit" data-employee-edit data-employee-edit-focus="${field}" title="Edit ${title.toLowerCase()}">${icon("Pencil")}Edit</button>` : ""}</header>${content}</section>`;
}

function employeeProfileModel(employee) {
  const first = (...values) => values.find(value => value != null && value !== "");
  const details = employee.profile_details || {};
  const skills = [...new Set([...(Array.isArray(employee.skills) ? employee.skills : []), ...employeeSkills(employee.keywords)])];
  return {
    name: first(employee.name, employee.fullName, "Employee"), email: employee.email || "", phone: employee.phone || "",
    code: first(employee.employee_code, employee.employeeCode), location: employee.location || "", department: employee.department,
    role: first(employee.current_designation, employee.currentDesignation, employee.designation, "Employee"),
    company: first(employee.current_company, employee.currentCompany),
    experience: employee.experience == null || employee.experience === "" ? "Not added" : formatExperience(employee.experience), skills,
    status: employee.status ? String(employee.status).toLowerCase() : "unknown",
    dob: first(employee.date_of_birth, details.date_of_birth), gender: first(employee.gender, details.gender),
    address: first(employee.address, details.address, employee.location),
    employmentType: first(employee.employment_type, details.employment_type), joiningDate: first(employee.joining_date, details.joining_date),
    noticePeriod: first(employee.notice_period, details.notice_period), reportingManager: first(employee.reporting_manager, details.reporting_manager),
    bloodGroup: first(employee.blood_group, details.blood_group), maritalStatus: first(employee.marital_status, details.marital_status),
    emergencyContact: first(employee.emergency_contact, details.emergency_contact), linkedin: first(employee.linkedin, details.linkedin), website: first(employee.website, details.website)
  };
}

function employeeProfileHistory(employee) {
  const events = [];
  const created = employee.created_at_audit || employee.createdAt;
  if (created) events.push({ title: "Profile created", at: created, actor: employeeAuditAccount(employee.created_by_name, employee.created_by_email), type: "created" });
  const edited = employee.last_edited_at || (employee.audit_action === "edited" ? employee.audit_at : null);
  if (edited) events.push({ title: "Profile updated", at: edited, actor: employeeAuditAccount(employee.last_edited_by_name || employee.audit_user_name, employee.last_edited_by_email || employee.audit_user_email), type: "edited" });
  return events.sort((a, b) => new Date(b.at) - new Date(a.at));
}

function employeeProfileTimeline(employee) {
  const events = employeeProfileHistory(employee);
  return events.length ? `<ol class="employee-update-timeline">${events.map(event => `<li class="${event.type}"><div><strong>${event.title}</strong><time>${escapeHtml(formatEmployeeAuditDate(event.at))}</time></div><small>${escapeHtml(event.actor ? `By ${event.actor}` : "Actor not recorded")}</small></li>`).join("")}</ol>` : '<div class="employee-history-empty">No update history recorded yet.</div>';
}

function employeeProfileCvCard(employee) {
  const filename = employee.cv_file_name || employee.cvFileName || employee.latest_resume?.file_name;
  const available = Boolean(employee.cv_stored_name || employee.cvStoredName);
  const uploaded = employee.latest_resume?.uploaded_at;
  return `<div class="employee-cv-file"><span class="employee-file-symbol">${icon("FileText")}<small>${escapeHtml(filename?.split(".").pop()?.toUpperCase() || "CV")}</small></span><div><strong>${escapeHtml(filename || "No CV attached")}</strong><small>${uploaded ? `Uploaded ${escapeHtml(formatEmployeeAuditDate(uploaded))}` : filename ? available ? "Attached document" : "File unavailable" : "Not uploaded"}</small></div></div>
    <div class="employee-cv-controls"><button type="button" class="employee-profile-button primary" data-profile-cv-preview ${available ? "" : "disabled"}>${icon("Eye")}Preview</button><button type="button" class="employee-profile-button" data-profile-cv-download ${available ? "" : "disabled"}>${icon("Download")}Download</button></div>
    ${available ? "" : '<button type="button" class="employee-add-cv" data-employee-edit data-employee-edit-focus="cv">' + icon("Upload") + 'Upload CV</button>'}<p class="employee-cv-status" role="status" data-profile-cv-status></p>`;
}

function employeeProfileWorkSummary(view) {
  return `<div class="employee-work-facts">${[
    ["CalendarDays", view.experience, "Total experience", "violet"], ["UserRound", view.role, "Current role", "green"],
    ["Network", view.department || "Not added", "Department", "blue"], ["Building2", view.company || "Not added", "Company", "amber"]
  ].map(([symbol, value, label, color]) => `<div><span class="employee-fact-icon ${color}">${icon(symbol)}</span><span><strong>${escapeHtml(value)}</strong><small>${label}</small></span></div>`).join("")}</div>`;
}

function employeeProfileContact(view) {
  return `<div class="employee-contact-list"><div>${icon("Mail")}<span>${escapeHtml(view.email || "Not added")}</span><button type="button" data-employee-profile-email ${view.email ? "" : "disabled"}>Send email</button></div><div>${icon("Phone")}<span>${escapeHtml(view.phone || "Not added")}</span><button type="button" data-employee-profile-call ${view.phone ? "" : "disabled"}>Call</button></div><div>${icon("MapPin")}<span>${escapeHtml(view.location || "Not added")}</span>${view.location ? `<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(view.location)}" target="_blank" rel="noopener noreferrer">View on map</a>` : ""}</div></div>`;
}

function employeeProfileOverview(employee, view) {
  const personal = employeeProfileSection("Personal Information", "UserRound", employeeProfileRows([
    ["Full name", view.name], ["Employee code", view.code], ["Email", view.email], ["Phone", view.phone],
    ["Date of birth", view.dob], ["Gender", view.gender], ["Address", view.address]
  ]), "name", "employee-personal");
  const employment = employeeProfileSection("Employment Information", "BriefcaseBusiness", employeeProfileRows([
    ["Current role", view.role], ["Department", view.department], ["Employment type", view.employmentType],
    ["Joining date", view.joiningDate], ["Experience", view.experience], ["Notice period", view.noticePeriod], ["Reporting manager", view.reportingManager], ["Work location", view.location]
  ]), "department", "employee-employment");
  const skills = `<div class="employee-skill-list">${view.skills.length ? view.skills.map(skill => `<span>${escapeHtml(skill)}</span>`).join("") : '<span class="missing">Skills not added yet</span>'}</div>${view.skills.length ? "" : '<button type="button" class="employee-profile-button primary employee-add-skills" data-employee-edit data-employee-edit-focus="keywords">' + icon("Plus") + 'Add skills</button>'}`;
  return `<div class="employee-profile-grid">${personal}${employment}<aside class="employee-profile-sidebar">${employeeProfileSection("Attached CV", "FileText", employeeProfileCvCard(employee))}${employeeProfileSection("Update History", "History", `<button type="button" class="employee-history-all" data-employee-tab="activity">View all</button>${employeeProfileTimeline(employee)}`)}</aside>
    ${employeeProfileSection("Work Summary", "BriefcaseBusiness", employeeProfileWorkSummary(view), "currentDesignation", "employee-work-summary")}
    ${employeeProfileSection("Key Skills", "Star", skills, "keywords", "employee-skills")}
    ${employeeProfileSection("Contact Information", "Phone", employeeProfileContact(view), "phone", "employee-contact")}
    ${employeeProfileSection("Additional Information", "Info", employeeProfileRows([["Blood group", view.bloodGroup], ["Marital status", view.maritalStatus], ["Emergency contact", view.emergencyContact], ["LinkedIn", view.linkedin], ["Personal website", view.website]]), "", "employee-additional")}</div>`;
}

function renderEmployeeProfileWorkspace(root, employee, options = {}) {
  releaseEmployeeProfileResources();
  const view = employeeProfileModel(employee);
  const editing = Boolean(options.edit);
  const aliases = { profile: "overview", cv: "documents" };
  const requestedTab = aliases[options.tab] || options.tab || "overview";
  const tabs = [["overview", "UserRound", "Profile Overview"], ["work", "BriefcaseBusiness", "Work Details"], ["skills", "ChartNoAxesColumnIncreasing", "Skills"], ["documents", "Files", "Documents"], ["activity", "History", "Activity"]];
  const tab = tabs.some(([key]) => key === requestedTab) ? requestedTab : "overview";
  let content = "";
  if (editing) content = `<section class="employee-profile-editor">${employeeEditForm(employee)}</section>`;
  else if (tab === "overview") content = employeeProfileOverview(employee, view);
  else if (tab === "work") content = `<div class="employee-work-detail-grid">${employeeProfileSection("Employment Information", "BriefcaseBusiness", employeeProfileRows([["Current role", view.role], ["Company", view.company], ["Department", view.department], ["Work location", view.location], ["Employment type", view.employmentType], ["Joining date", view.joiningDate], ["Notice period", view.noticePeriod], ["Reporting manager", view.reportingManager]]), "currentDesignation")}${employeeProfileSection("Work Summary", "BriefcaseBusiness", employeeProfileWorkSummary(view), "experience")}</div>`;
  else if (tab === "skills") content = employeeProfileSection("Key Skills", "Star", `<div class="employee-skill-list">${view.skills.length ? view.skills.map(skill => `<span>${escapeHtml(skill)}</span>`).join("") : '<span class="missing">Skills not added yet</span>'}</div>`, "keywords");
  else if (tab === "documents") content = `<div class="employee-documents-layout">${employeeProfileSection("Attached CV", "FileText", employeeProfileCvCard(employee))}</div>`;
  else if (tab === "activity") content = `<div class="employee-work-detail-grid">${employeeProfileSection("Update History", "History", employeeProfileTimeline(employee))}${employeeProfileSection("Record Details", "Database", employeeProfileRows([["Source", employee.source], ["Source row", employee.rowNumber], ["Employee code", view.code], ["Last update", employeeAuditLine(employee) || null]]))}</div>`;
  const status = view.status === "unknown" ? "Status not recorded" : view.status.charAt(0).toUpperCase() + view.status.slice(1);
  root.innerHTML = `<main class="employee-profile-workspace">
    <header class="employee-profile-toolbar"><nav aria-label="Breadcrumb"><button type="button" data-back-hr>Employees</button>${icon("ChevronRight")}<span>Employee Profile</span></nav>
      <div class="employee-profile-actions"><button type="button" class="employee-profile-button primary" data-employee-edit>${icon(editing ? "X" : "Pencil")}${editing ? "Cancel editing" : "Edit profile"}</button><button type="button" class="employee-profile-button" data-employee-profile-call ${view.phone ? "" : "disabled"}>${icon("Phone")}Call</button><button type="button" class="employee-profile-button" data-employee-profile-email ${view.email ? "" : "disabled"}>${icon("Mail")}Email</button>
        <details class="employee-profile-more"><summary class="employee-profile-button">${icon("Ellipsis")}More</summary><div><button type="button" data-profile-copy>${icon("Link")}Copy profile link</button><button type="button" data-employee-edit data-employee-edit-focus="cv">${icon("Upload")}Upload CV</button><button type="button" data-theme>${icon(state.theme === "dark" ? "Sun" : "Moon")}Toggle theme</button><button type="button" data-logout>${icon("LogOut")}Logout</button></div></details>
      </div></header>
    <section class="employee-profile-identity" aria-label="Employee summary"><div class="employee-profile-avatar">${escapeHtml(profileInitials(view.name))}</div><div class="employee-profile-person"><div class="employee-profile-name"><h1>${escapeHtml(view.name)}</h1><span class="employee-profile-status ${view.status === "active" ? "active" : ""}">${icon(view.status === "active" ? "CircleCheck" : "CircleHelp")}${escapeHtml(status)}</span></div><p>${escapeHtml(view.role)}</p><div class="employee-profile-secondary"><span>${icon("BriefcaseBusiness")}${escapeHtml(view.department || "Department not added")}</span><span>${icon("Badge")}${escapeHtml(view.code || "Employee code not added")}</span></div><div class="employee-profile-contact-meta"><span>${icon("Phone")}${escapeHtml(view.phone || "Phone not added")}</span><span>${icon("Mail")}${escapeHtml(view.email || "Email not added")}</span><span>${icon("MapPin")}${escapeHtml(view.location || "Location not added")}</span></div></div>
      <div class="employee-profile-summary">${[["CalendarDays", view.experience, "Experience", "blue"], ["UsersRound", view.role, "Role", "amber"], ["Building2", view.company || "Not added", "Company", "violet"]].map(([symbol, value, label, color]) => `<div><span class="employee-fact-icon ${color}">${icon(symbol)}</span><span><strong>${escapeHtml(value)}</strong><small>${label}</small></span></div>`).join("")}</div>
    </section>
    ${options.status ? `<p class="employee-profile-notice" role="status">${escapeHtml(options.status)}</p>` : ""}<p class="employee-profile-copy-status" data-profile-copy-status role="status" hidden></p>
    <nav class="employee-profile-tabs" role="tablist" aria-label="Employee profile sections">${tabs.map(([key, symbol, label]) => `<button id="employee-tab-${key}" type="button" role="tab" aria-selected="${tab === key}" aria-controls="employee-profile-panel" class="${tab === key ? "active" : ""}" data-employee-tab="${key}" tabindex="${tab === key ? 0 : -1}" ${editing ? "disabled" : ""}>${icon(symbol)}${label}</button>`).join("")}</nav>
    <div id="employee-profile-panel" class="employee-profile-content" role="tabpanel" aria-labelledby="employee-tab-${tab}">${content}</div>
  </main>`;
  bindRoleDashboard("hr");
  root.querySelector("[data-back-hr]").addEventListener("click", () => navigate("/hr/dashboard"));
  bindEmployeeProfileActions(employee, editing, tab);
  root.querySelector("[data-profile-copy]").addEventListener("click", async () => {
    const message = root.querySelector("[data-profile-copy-status]");
    try { await navigator.clipboard.writeText(window.location.href); message.textContent = "Profile link copied."; }
    catch { message.textContent = "Unable to copy the profile link."; }
    message.hidden = false; root.querySelector(".employee-profile-more").open = false;
  });
  root.querySelectorAll("[data-profile-cv-preview]").forEach(button => button.addEventListener("click", () => openEmployeeProfileCv(employee)));
  root.querySelectorAll("[data-profile-cv-download]").forEach(button => button.addEventListener("click", () => downloadEmployeeProfileCv(employee, button)));
  root.querySelectorAll('.employee-profile-tabs [role="tab"]').forEach(button => button.addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...root.querySelectorAll('.employee-profile-tabs [role="tab"]')];
    const index = buttons.indexOf(button);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].click(); document.querySelector(`[data-employee-tab="${tabs[next][0]}"]`)?.focus();
  }));
}

function renderEmployeeProfileLoading(root, message = "Loading employee details...", error = false) {
  releaseEmployeeProfileResources();
  root.innerHTML = `<main class="employee-profile-workspace"><header class="employee-profile-toolbar"><nav aria-label="Breadcrumb"><button type="button" data-back-hr>Employees</button>${icon("ChevronRight")}<span>Employee Profile</span></nav></header><div class="employee-profile-empty" ${error ? 'role="alert"' : 'role="status"'}>${icon(error ? "CircleAlert" : "UserRound")}<p>${escapeHtml(message)}</p>${error ? '<button type="button" class="employee-profile-button" data-profile-retry>' + icon("RefreshCw") + 'Retry</button>' : ""}</div></main>`;
  root.querySelector("[data-back-hr]").addEventListener("click", () => navigate("/hr/dashboard"));
  root.querySelector("[data-profile-retry]")?.addEventListener("click", () => renderHrEmployeeRoute(window.location.pathname));
}

async function fetchEmployeeProfileCv(employee) {
  const response = await fetch(`/api/hr/employees/${encodeURIComponent(employeeRecordId(employee))}/cv`, { headers: state.accessToken ? { Authorization: `Bearer ${state.accessToken}` } : {} });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || error.message || "Unable to load CV.");
  }
  return response.blob();
}

async function downloadEmployeeProfileCv(employee, button) {
  const generation = employeeProfileResources.generation;
  button.disabled = true;
  const status = button.closest(".employee-info-panel, .employee-cv-dialog")?.querySelector("[data-profile-cv-status]");
  if (status) status.textContent = "Preparing download...";
  try {
    const blob = await fetchEmployeeProfileCv(employee);
    if (generation !== employeeProfileResources.generation || !button.isConnected) return;
    const url = URL.createObjectURL(blob);
    employeeProfileResources.urls.add(url);
    const link = document.createElement("a"); link.href = url; link.download = employee.cv_file_name || employee.cvFileName || "employee-cv"; link.click();
    if (status) status.textContent = "";
    setTimeout(() => { URL.revokeObjectURL(url); employeeProfileResources.urls.delete(url); }, 1000);
  } catch (error) { if (status?.isConnected) status.textContent = error.message; }
  finally { if (button.isConnected) button.disabled = false; }
}

async function openEmployeeProfileCv(employee) {
  document.querySelector(".employee-cv-dialog")?.close();
  const filename = employee.cv_file_name || employee.cvFileName || "Employee CV";
  const generation = employeeProfileResources.generation;
  const dialog = document.createElement("dialog");
  dialog.className = "employee-cv-dialog";
  dialog.setAttribute("aria-label", "CV preview");
  dialog.innerHTML = `<header><h2>${icon("FileText")}${escapeHtml(filename)}</h2><button type="button" class="employee-profile-button" title="Close CV preview" aria-label="Close CV preview" data-profile-cv-close>${icon("X")}</button></header><div class="employee-cv-view" role="status">Loading CV...</div><footer><button type="button" class="employee-profile-button" data-profile-cv-download>${icon("Download")}Download</button><p data-profile-cv-status role="status"></p></footer>`;
  document.body.append(dialog); dialog.showModal();
  const urls = new Set();
  dialog.querySelector("[data-profile-cv-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { urls.forEach(url => { URL.revokeObjectURL(url); employeeProfileResources.urls.delete(url); }); dialog.remove(); });
  dialog.querySelector("[data-profile-cv-download]").addEventListener("click", event => downloadEmployeeProfileCv(employee, event.currentTarget));
  const target = dialog.querySelector(".employee-cv-view");
  try {
    const blob = await fetchEmployeeProfileCv(employee);
    if (!dialog.isConnected || generation !== employeeProfileResources.generation) return;
    const url = URL.createObjectURL(blob); urls.add(url); employeeProfileResources.urls.add(url);
    const extension = filename.split(".").pop().toLowerCase();
    if (extension === "pdf") target.innerHTML = `<iframe src="${url}" title="${escapeHtml(filename)}"></iframe>`;
    else if (extension === "docx") {
      const payload = await api(`/api/hr/employees/${encodeURIComponent(employeeRecordId(employee))}/cv-preview`);
      if (!dialog.isConnected || generation !== employeeProfileResources.generation) return;
      target.innerHTML = `<pre>${escapeHtml(payload.text || "No readable text found in this document.")}</pre>`;
    } else target.innerHTML = `<p>Preview unavailable for this document type.</p><a class="employee-profile-button" href="${url}" download="${escapeHtml(filename)}">${icon("Download")}Download document</a>`;
  } catch (error) { if (dialog.isConnected) target.textContent = error.message; }
}
