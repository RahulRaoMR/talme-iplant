function emptyCandidateSearch() {
  return {
    clientName: "", keywords: "", booleanMode: false, mandatory: "", exclude: "",
    minExperience: "", maxExperience: "", locations: "", preferredLocations: "", includeRelocating: false, relocation: "",
    minSalary: "", maxSalary: "", includeUnknownSalary: false, company: "", designation: "", department: "", employmentType: "",
    degree: "", institution: "", graduationYear: "", gender: "", minAge: "", maxAge: "", disability: "",
    noticePeriod: "", cv: "", activeIn: ""
  };
}

function openAdvancedCandidateSearch() {
  clearTimeout(hrEmployeeSearchTimer);
  ++hrEmployeeRequestId;
  if (!state.hrCandidateSearchDraft) {
    state.hrCandidateSearchDraft = state.hrAdvancedSearch ? structuredClone(state.hrAdvancedSearch) : { ...emptyCandidateSearch(), keywords: state.hrEmployeeSearchQuery, locations: state.hrTalentFilters.locations, company: state.hrTalentFilters.company, designation: state.hrTalentFilters.designation, cv: state.hrTalentFilters.cv };
    if (!state.hrAdvancedSearch && state.hrTalentFilters.experiences.length === 1) {
      const [minimum, maximum] = state.hrTalentFilters.experiences[0].split("-");
      state.hrCandidateSearchDraft.minExperience = minimum;
      state.hrCandidateSearchDraft.maxExperience = maximum === "*" ? "" : maximum;
    }
  }
  if (window.location.pathname !== "/hr/search") history.pushState({}, "", "/hr/search");
  renderAdvancedCandidateSearch(document.querySelector("#app"));
  window.scrollTo({ top: 0 });
  document.querySelector('[name="keywords"]')?.focus({ preventScroll: true });
}

function renderAdvancedCandidateSearch(root) {
  if (!state.accessToken || !state.user) return renderLandingPage();
  if (!state.user.permissions?.includes("employees.manage") && !state.user.permissions?.includes("*")) return renderForbidden("403 Forbidden");
  stopHrEmployeesLive();
  clearTimeout(hrEmployeeSearchTimer);
  ++hrEmployeeRequestId;
  const criteria = { ...emptyCandidateSearch(), ...(state.hrCandidateSearchDraft || state.hrAdvancedSearch || {}) };
  const input = (key, label, placeholder = "", attributes = "") => `<label class="candidate-search-field"><span>${label}</span><input name="${key}" value="${escapeHtml(criteria[key])}" placeholder="${placeholder}" ${attributes}></label>`;
  const select = (key, label, options) => `<label class="candidate-search-field"><span>${label}</span><select name="${key}">${options.map(([value, title]) => `<option value="${value}" ${String(criteria[key]) === String(value) ? "selected" : ""}>${title}</option>`).join("")}</select></label>`;
  const checkbox = (key, label, className = "") => `<label class="candidate-search-check ${className}"><input type="checkbox" name="${key}" ${criteria[key] ? "checked" : ""}><span>${label}</span></label>`;
  const range = (minimum, maximum, label, max = 60, step = ".5") => `<fieldset class="candidate-search-range"><legend>${label}</legend><div>${input(minimum, "Minimum", "Min", `type="number" min="0" max="${max}" step="${step}"`)}<span class="candidate-range-to">to</span>${input(maximum, "Maximum", "Max", `type="number" min="0" max="${max}" step="${step}"`)}</div></fieldset>`;
  const expanded = keys => keys.some(key => criteria[key] !== "" && criteria[key] !== false) ? "open" : "";
  root.innerHTML = `
    <main class="site hr-app talent-app candidate-search-app">
      ${talentWorkspaceHeader("new")}
      <div class="candidate-search-workspace">
        <nav class="candidate-search-breadcrumb" aria-label="Breadcrumb"><button type="button" data-candidate-search-back>${icon("ChevronLeft")}Talent search</button><span>/</span><span>Advanced search</span></nav>
        <div class="candidate-search-heading"><div><span class="candidate-search-eyebrow">CANDIDATE SEARCH</span><h1>Search Candidates</h1></div><button class="talent-button" type="button" data-candidate-search-save>${icon("BookmarkPlus")}Save Search</button></div>
        <div class="candidate-search-layout">
          <form class="candidate-search-form">
            <section class="candidate-search-section">
              ${input("clientName", "Client / company name", "Enter client or company name", 'maxlength="120"')}
            </section>
            <section class="candidate-search-section">
              <div class="candidate-keyword-heading"><label for="candidate-keywords">Keywords</label>${checkbox("booleanMode", "Boolean search", "candidate-boolean-toggle")}</div>
              <textarea id="candidate-keywords" name="keywords" rows="2" maxlength="2000" placeholder="${criteria.booleanMode ? "Java AND (Spring OR React) NOT Python" : "Java, Spring Boot, React"}">${escapeHtml(criteria.keywords)}</textarea>
              <div class="candidate-search-two-columns">${input("mandatory", "Mandatory keywords", "Keywords required in every profile", 'maxlength="2000"')}${input("exclude", "Exclude keywords", "Keywords to exclude", 'maxlength="2000"')}</div>
            </section>
            <section class="candidate-search-section">
              ${range("minExperience", "maxExperience", "Work experience (years)")}
              <div class="candidate-search-field candidate-location-picker" data-candidate-location-picker>
                <label for="candidate-current-location">Current location</label>
                <div class="candidate-location-control"><div class="candidate-location-tags" data-location-tags></div><div class="candidate-location-input-row"><input id="candidate-current-location" name="locations" type="search" placeholder="Search all locations" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="candidate-location-list"><button type="button" class="candidate-location-expand" title="Show all locations" aria-label="Show all locations">${icon("ChevronDown")}</button></div></div>
                <div class="candidate-location-dropdown" hidden><div class="candidate-location-list-heading" data-location-list-heading>Loading locations...</div><div id="candidate-location-list" role="listbox" aria-label="Current locations" aria-multiselectable="true"></div></div>
              </div>
              <datalist id="candidate-location-options"></datalist>
              ${checkbox("includeRelocating", "Include candidates willing to relocate to these locations")}
              <div class="candidate-search-two-columns">${input("preferredLocations", "Preferred location", "Any preferred location", 'list="candidate-location-options" maxlength="500"')}${select("relocation", "Relocation preference", [["", "Any preference"], ["yes", "Willing to relocate"], ["no", "Not willing to relocate"]])}</div>
              ${range("minSalary", "maxSalary", "Annual salary (INR, lakhs)", 1000, ".1")}
              ${checkbox("includeUnknownSalary", "Include candidates with undisclosed salary")}
            </section>
            <details class="candidate-search-expander" ${expanded(["company", "designation", "department", "employmentType"])}><summary><span>${icon("BriefcaseBusiness")}Employment</span>${icon("ChevronDown")}</summary><div class="candidate-search-two-columns">${input("company", "Current company", "Any company", 'maxlength="200"')}${input("designation", "Designation", "Any designation", 'maxlength="200"')}${input("department", "Department", "Any department", 'maxlength="200"')}${select("employmentType", "Employment type", [["", "Any employment type"], ["permanent", "Permanent"], ["contract", "Contract"], ["temporary", "Temporary"], ["internship", "Internship"]])}</div></details>
            <details class="candidate-search-expander" ${expanded(["degree", "institution", "graduationYear"])}><summary><span>${icon("GraduationCap")}Education</span>${icon("ChevronDown")}</summary><div class="candidate-search-two-columns">${input("degree", "Qualification / degree", "Any qualification", 'list="candidate-degree-options" maxlength="200"')}${input("institution", "College / university", "Any institution", 'maxlength="200"')}${input("graduationYear", "Graduation year", "Any year", 'type="number" min="1950" max="2100" step="1"')}<datalist id="candidate-degree-options"><option>B.Tech</option><option>B.E.</option><option>B.Sc.</option><option>M.Tech</option><option>MBA</option><option>MCA</option><option>Diploma</option></datalist></div></details>
            <details class="candidate-search-expander" ${expanded(["gender", "minAge", "maxAge", "disability"])}><summary><span>${icon("UsersRound")}Diversity Hiring</span>${icon("ChevronDown")}</summary><div class="candidate-search-two-columns">${select("gender", "Gender", [["", "Any gender"], ["female", "Female"], ["male", "Male"], ["non-binary", "Non-binary"]])}${select("disability", "Persons with disabilities", [["", "Any"], ["yes", "Yes"], ["no", "No"]])}</div>${range("minAge", "maxAge", "Age (years)", 100, "1")}</details>
            <details class="candidate-search-expander" ${expanded(["noticePeriod", "cv"])}><summary><span>${icon("ListFilter")}Additional Details</span>${icon("ChevronDown")}</summary><div class="candidate-search-two-columns">${select("noticePeriod", "Maximum notice period", [["", "Any notice period"], ["0", "Immediate"], ["15", "15 days"], ["30", "30 days"], ["60", "60 days"], ["90", "90 days"]])}${select("cv", "Resume availability", [["", "All profiles"], ["attached", "With resume"], ["missing", "Without resume"]])}</div></details>
            <div class="candidate-search-notice" role="alert" data-candidate-search-notice hidden></div>
            <footer class="candidate-search-footer">${select("activeIn", "Active in", [["", "Any time"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 3 months"], ["180", "Last 6 months"], ["365", "Last year"]])}<div><button type="button" class="candidate-clear-button" data-candidate-search-clear>Clear All</button><button class="talent-button primary" type="submit">${icon("search")}Search Candidates</button></div></footer>
          </form>
          <aside class="candidate-search-history" aria-label="Search history">
            <section><div class="candidate-history-heading"><h2>${icon("History")}Recent Searches</h2><button class="talent-icon-button" type="button" title="Clear recent searches" aria-label="Clear recent searches" data-clear-recent-searches>${icon("Trash2")}</button></div><div data-candidate-recent-searches></div></section>
            <section><div class="candidate-history-heading"><h2>${icon("Bookmark")}Saved Searches</h2></div><div data-candidate-saved-searches></div></section>
            <div class="candidate-search-total"><span class="employee-live-dot"></span><div><strong data-hr-total-employees>${profileCountLabel()} employees</strong><small>Total employees</small></div><span data-profile-count hidden></span></div>
          </aside>
        </div>
      </div>
    </main>`;
  bindRoleDashboard("hr");
  bindTalentWorkspace();
  bindAdvancedCandidateSearch();
  bindCandidateLocationPicker(criteria.locations);
  renderCandidateSearchHistory();
}

function positionCandidateLocationDropdown(picker) {
  const bounds = picker.getBoundingClientRect();
  picker.querySelector(".candidate-location-dropdown").classList.toggle("opens-up", innerHeight - bounds.bottom < 280 && bounds.top > 280);
}

window.addEventListener("resize", () => {
  const picker = document.querySelector("[data-candidate-location-picker]");
  if (picker && !picker.querySelector(".candidate-location-dropdown").hidden) positionCandidateLocationDropdown(picker);
});

function bindCandidateLocationPicker(initialValue) {
  const picker = document.querySelector("[data-candidate-location-picker]");
  const input = picker.querySelector("input");
  const form = picker.closest("form");
  const dropdown = picker.querySelector(".candidate-location-dropdown");
  const list = picker.querySelector('[role="listbox"]');
  const heading = picker.querySelector("[data-location-list-heading]");
  const tags = picker.querySelector("[data-location-tags]");
  let selected = (Array.isArray(initialValue) ? initialValue : String(initialValue || "").split(",")).map(value => String(value).trim()).filter(Boolean);
  let locations = [];
  let loaded = false;
  const selectedValue = value => selected.some(item => item.toLowerCase() === value.toLowerCase());
  const setOpen = open => {
    if (open) positionCandidateLocationDropdown(picker);
    dropdown.hidden = !open;
    input.setAttribute("aria-expanded", String(open));
  };
  const renderTags = () => {
    input.dataset.selectedLocations = JSON.stringify(selected);
    tags.innerHTML = selected.map(value => `<span class="candidate-location-tag">${escapeHtml(value)}<button type="button" data-remove-location="${escapeHtml(value)}" title="Remove ${escapeHtml(value)}" aria-label="Remove ${escapeHtml(value)}">${icon("x")}</button></span>`).join("");
    tags.hidden = !selected.length;
    tags.querySelectorAll("[data-remove-location]").forEach(button => button.addEventListener("click", () => {
      selected = selected.filter(value => value !== button.dataset.removeLocation);
      renderTags();
      renderOptions();
      form.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    }));
  };
  const renderOptions = () => {
    const query = input.value.trim().toLowerCase();
    const matches = locations.filter(item => item.value.toLowerCase().includes(query));
    if (!loaded) return;
    heading.textContent = query ? `${matches.length} matching locations` : `All locations (${locations.length})`;
    list.innerHTML = matches.length ? matches.map(item => `<label class="candidate-location-option" role="option" aria-selected="${selectedValue(item.value)}"><input type="checkbox" value="${escapeHtml(item.value)}" ${selectedValue(item.value) ? "checked" : ""}><span>${escapeHtml(item.value)}</span><small>${formatNumber(item.count)}</small></label>`).join("") : '<p class="candidate-location-empty">No matching locations</p>';
    list.querySelectorAll("input").forEach(checkbox => {
      checkbox.addEventListener("change", () => {
        if (checkbox.checked && !selectedValue(checkbox.value)) selected.push(checkbox.value);
        else if (!checkbox.checked) selected = selected.filter(value => value.toLowerCase() !== checkbox.value.toLowerCase());
        input.value = "";
        renderTags();
        renderOptions();
        form.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      });
      checkbox.addEventListener("keydown", event => {
        if (event.key === "Escape") {
          input.focus();
          setOpen(false);
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const options = [...list.querySelectorAll("input")];
          options[(options.indexOf(checkbox) + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus();
        }
      });
    });
  };
  const loadLocations = async () => {
    loaded = false;
    heading.textContent = "Loading locations...";
    list.innerHTML = "";
    try {
      const payload = await api("/api/hr/employees/locations");
      if (!picker.isConnected) return;
      locations = (payload.items || []).sort((a, b) => Number(!/^\p{L}/u.test(a.value)) - Number(!/^\p{L}/u.test(b.value)) || a.value.localeCompare(b.value));
      loaded = true;
      renderOptions();
      document.querySelector("#candidate-location-options").innerHTML = locations.map(item => `<option value="${escapeHtml(item.value)}"></option>`).join("");
    } catch {
      if (!picker.isConnected) return;
      heading.textContent = "Could not load locations";
      list.innerHTML = `<button type="button" class="candidate-location-retry">${icon("RotateCw")}Retry</button>`;
      list.querySelector("button").addEventListener("click", () => {
        input.focus();
        setOpen(true);
        loadLocations();
      });
    }
  };
  renderTags();
  input.addEventListener("focus", () => setOpen(true));
  input.addEventListener("input", () => { renderOptions(); setOpen(true); });
  input.addEventListener("keydown", event => {
    if (event.key === "Escape") setOpen(false);
    else if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      list.querySelector("input")?.focus();
    } else if (event.key === "Enter" && !dropdown.hidden && list.querySelector("input")) {
      event.preventDefault();
      list.querySelector("input").click();
    }
  });
  picker.querySelector(".candidate-location-expand").addEventListener("click", () => {
    const open = dropdown.hidden;
    if (open) input.focus();
    setOpen(open);
  });
  picker.addEventListener("focusout", event => {
    if (!picker.contains(event.relatedTarget)) setOpen(false);
  });
  loadLocations();
}

document.addEventListener("pointerdown", event => {
  const picker = document.querySelector("[data-candidate-location-picker]");
  if (picker && !picker.contains(event.target)) {
    picker.querySelector(".candidate-location-dropdown").hidden = true;
    picker.querySelector("input").setAttribute("aria-expanded", "false");
  }
});

function readCandidateSearch(form) {
  const criteria = emptyCandidateSearch();
  for (const key of Object.keys(criteria)) {
    const input = form.elements.namedItem(key);
    if (input) criteria[key] = input.type === "checkbox" ? input.checked : input.value.trim();
  }
  const locationInput = form.elements.locations;
  criteria.locations = JSON.parse(locationInput.dataset.selectedLocations || "[]");
  if (locationInput.value.trim() && !criteria.locations.some(value => value.toLowerCase() === locationInput.value.trim().toLowerCase())) criteria.locations.push(locationInput.value.trim());
  return criteria;
}

function candidateSearchRangeError(criteria) {
  for (const [minimum, maximum, label] of [["minExperience", "maxExperience", "experience"], ["minSalary", "maxSalary", "salary"], ["minAge", "maxAge", "age"]]) {
    if (criteria[minimum] !== "" && criteria[maximum] !== "" && Number(criteria[minimum]) > Number(criteria[maximum])) return `Minimum ${label} must not exceed maximum ${label}.`;
  }
  return "";
}

function candidateSearchNotice(message) {
  const notice = document.querySelector("[data-candidate-search-notice]");
  if (!notice) return;
  notice.hidden = !message;
  notice.textContent = message;
  if (message) notice.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function candidateSearchFromHistory(entry) {
  return { ...emptyCandidateSearch(), ...(entry.advanced || { keywords: entry.query || "", company: entry.filters?.company || "", designation: entry.filters?.designation || "", locations: entry.filters?.locations || [], cv: entry.filters?.cv || "" }) };
}

function renderCandidateSearchHistory() {
  const render = (target, entries, type) => {
    if (!target) return;
    target.innerHTML = entries.length ? entries.map((entry, index) => {
      const criteria = candidateSearchFromHistory(entry);
      const summary = [Array.isArray(criteria.locations) ? criteria.locations.join(" | ") : criteria.locations, criteria.minExperience !== "" || criteria.maxExperience !== "" ? `${criteria.minExperience || "0"} - ${criteria.maxExperience || "Any"} years` : "", criteria.company].filter(Boolean).join(" | ");
      return `<div class="candidate-history-item"><button type="button" data-candidate-history="${type}" data-history-index="${index}"><strong>${escapeHtml(entry.name || criteria.keywords || "All candidates")}</strong>${summary ? `<span>${escapeHtml(summary)}</span>` : ""}<small>${entry.createdAt ? escapeHtml(new Date(entry.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })) : ""}</small></button>${type === "searches" ? `<button type="button" class="candidate-history-delete" title="Delete saved search" aria-label="Delete ${escapeHtml(entry.name || "saved search")}" data-delete-candidate-search="${index}">${icon("Trash2")}</button>` : ""}</div>`;
    }).join("") : `<p class="candidate-history-empty">${type === "recent_searches" ? "No recent searches" : "No saved searches"}</p>`;
  };
  render(document.querySelector("[data-candidate-recent-searches]"), loadRoleWorkspace(talentStorageKey("recent_searches"), []), "recent_searches");
  render(document.querySelector("[data-candidate-saved-searches]"), loadRoleWorkspace(talentStorageKey("searches"), []), "searches");
  document.querySelectorAll("[data-candidate-history]").forEach(button => button.addEventListener("click", () => {
    const entry = loadRoleWorkspace(talentStorageKey(button.dataset.candidateHistory), [])[Number(button.dataset.historyIndex)];
    if (!entry) return;
    state.hrCandidateSearchDraft = candidateSearchFromHistory(entry);
    renderAdvancedCandidateSearch(document.querySelector("#app"));
  }));
  document.querySelectorAll("[data-delete-candidate-search]").forEach(button => button.addEventListener("click", () => {
    const entries = loadRoleWorkspace(talentStorageKey("searches"), []);
    entries.splice(Number(button.dataset.deleteCandidateSearch), 1);
    saveRoleWorkspace(talentStorageKey("searches"), entries);
    renderCandidateSearchHistory();
  }));
}

function bindAdvancedCandidateSearch() {
  const form = document.querySelector(".candidate-search-form");
  form.addEventListener("input", () => { state.hrCandidateSearchDraft = readCandidateSearch(form); });
  form.elements.booleanMode.addEventListener("change", () => {
    form.elements.keywords.placeholder = form.elements.booleanMode.checked ? "Java AND (Spring OR React) NOT Python" : "Java, Spring Boot, React";
  });
  document.querySelector("[data-candidate-search-back]").addEventListener("click", () => navigate("/hr/dashboard"));
  document.querySelector("[data-candidate-search-clear]").addEventListener("click", () => {
    state.hrCandidateSearchDraft = emptyCandidateSearch();
    renderAdvancedCandidateSearch(document.querySelector("#app"));
  });
  document.querySelector("[data-clear-recent-searches]").addEventListener("click", () => {
    saveRoleWorkspace(talentStorageKey("recent_searches"), []);
    renderCandidateSearchHistory();
  });
  document.querySelector("[data-candidate-search-save]").addEventListener("click", () => {
    if (!form.reportValidity()) return;
    const criteria = readCandidateSearch(form);
    const error = candidateSearchRangeError(criteria);
    if (error) return candidateSearchNotice(error);
    const dialog = document.createElement("dialog");
    dialog.className = "talent-interview-dialog";
    dialog.innerHTML = `<form><h2>Save Search</h2><label>Search name<input name="searchName" required maxlength="120" value="${escapeHtml(criteria.clientName || criteria.keywords || criteria.company || "Candidate search")}"></label><div><button type="button" class="talent-button" data-cancel>Cancel</button><button type="submit" class="talent-button primary">Save Search</button></div></form>`;
    document.body.append(dialog);
    dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => dialog.remove());
    dialog.querySelector("form").addEventListener("submit", event => {
      event.preventDefault();
      const name = dialog.querySelector("input").value.trim();
      if (!name) return;
      const entries = loadRoleWorkspace(talentStorageKey("searches"), []);
      entries.unshift({ name, advanced: criteria, query: criteria.keywords, filters: { locations: [], skills: [], experiences: [], company: "", designation: "", cv: "", sort: "relevance" }, createdAt: new Date().toISOString() });
      saveRoleWorkspace(talentStorageKey("searches"), entries.slice(0, 15));
      dialog.close();
      renderCandidateSearchHistory();
    });
    dialog.showModal();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const criteria = readCandidateSearch(form);
    const rangeError = candidateSearchRangeError(criteria);
    if (rangeError) return candidateSearchNotice(rangeError);
    candidateSearchNotice("");
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Searching...";
    try {
      const params = new URLSearchParams({ advanced: JSON.stringify(criteria), page: "1", limit: "20" });
      const payload = await api(`/api/hr/employees/search?${params}`);
      if (!form.isConnected) return;
      state.hrAdvancedSearch = criteria;
      state.hrCandidateSearchDraft = structuredClone(criteria);
      state.hrAdvancedApplied = true;
      state.hrEmployeeSearchQuery = criteria.keywords;
      state.hrTalentPage = 1;
      state.hrTalentStage = "all";
      state.hrTalentSection = "new";
      state.hrShowDuplicates = false;
      state.hrTalentSelected.clear();
      state.hrTalentFilters = { locations: [], skills: [], experiences: [], company: "", designation: "", cv: "", sort: "relevance" };
      state.hrEmployees = payload.items || [];
      state.hrEmployeePagination = payload.pagination || { page: 1, limit: 20, total: state.hrEmployees.length, totalPages: 1 };
      const recent = loadRoleWorkspace(talentStorageKey("recent_searches"), []).filter(entry => JSON.stringify(entry.advanced) !== JSON.stringify(criteria));
      recent.unshift({ name: criteria.clientName || criteria.keywords || criteria.company || "All candidates", advanced: structuredClone(criteria), createdAt: new Date().toISOString() });
      saveRoleWorkspace(talentStorageKey("recent_searches"), recent.slice(0, 10));
      history.pushState({}, "", "/hr/dashboard");
      renderHrDashboard(document.querySelector("#app"), { preloaded: true });
      window.scrollTo({ top: 0 });
    } catch (error) {
      if (form.isConnected) candidateSearchNotice(error.message);
    } finally {
      if (form.isConnected) {
        submit.disabled = false;
        submit.innerHTML = `${icon("search")}Search Candidates`;
      }
    }
  });
}
