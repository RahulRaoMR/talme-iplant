const lucene = require("lucene");

function searchError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function list(value) {
  return (Array.isArray(value) ? value : String(value || "").split(",")).map(term => String(term).trim()).filter(Boolean).slice(0, 30);
}

function number(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseBooleanKeywords(value) {
  if (!value.trim()) return null;
  if (value.length > 2000) throw searchError("Keywords must be fewer than 2,000 characters.");
  let tree;
  try { tree = lucene.parse(value); } catch { throw searchError("Check the Boolean keywords, operators and parentheses."); }
  let count = 0;
  function validate(node, depth = 0) {
    if (++count > 200 || depth > 40) throw searchError("Simplify the Boolean keyword expression.");
    if (node.term !== undefined) {
      if (node.field !== "<implicit>" || node.regex || node.similarity || node.boost || (!node.quoted && /[*?]/.test(node.term))) throw searchError("Use keywords, quoted phrases, AND, OR, NOT and parentheses.");
      return;
    }
    if (!node.left || (node.operator && !["AND", "OR", "NOT", "AND NOT", "OR NOT", "<implicit>"].includes(node.operator))) throw searchError("Check the Boolean keyword expression.");
    validate(node.left, depth + 1);
    if (node.right) validate(node.right, depth + 1);
  }
  validate(tree);
  return tree;
}

function parseAdvancedSearch(value) {
  if (!value) return null;
  let input;
  try { input = typeof value === "string" ? JSON.parse(value) : value; } catch { throw searchError("Invalid advanced search criteria."); }
  if (!input || Array.isArray(input) || typeof input !== "object") throw searchError("Invalid advanced search criteria.");
  const text = key => String(input[key] || "").trim().slice(0, 2000);
  const numericFields = ["noticePeriod", "minExperience", "maxExperience", "minSalary", "maxSalary", "graduationYear", "minAge", "maxAge"];
  for (const key of numericFields) {
    if (input[key] !== undefined && input[key] !== null && input[key] !== "" && number(input[key]) === null) throw searchError("Enter valid, non-negative numeric ranges.");
  }
  const filters = {
    keywords: text("keywords"), booleanMode: input.booleanMode === true,
    mandatory: list(input.mandatory), exclude: list(input.exclude), skills: list(input.skills),
    locations: list(input.locations), preferredLocations: list(input.preferredLocations), includeRelocating: input.includeRelocating === true,
    relocation: ["yes", "no"].includes(input.relocation) ? input.relocation : "",
    company: text("company"), designation: text("designation"), department: text("department"),
    employmentType: text("employmentType"), degree: text("degree"), institution: text("institution"),
    gender: text("gender"), disability: ["yes", "no"].includes(input.disability) ? input.disability : "",
    noticePeriod: number(input.noticePeriod), minExperience: number(input.minExperience), maxExperience: number(input.maxExperience),
    minSalary: number(input.minSalary), maxSalary: number(input.maxSalary), includeUnknownSalary: input.includeUnknownSalary === true,
    graduationYear: number(input.graduationYear), minAge: number(input.minAge), maxAge: number(input.maxAge),
    activeIn: [7, 30, 90, 180, 365].includes(Number(input.activeIn)) ? Number(input.activeIn) : null,
    cv: ["attached", "missing"].includes(input.cv) ? input.cv : ""
  };
  for (const [minimum, maximum, label] of [["minExperience", "maxExperience", "experience"], ["minSalary", "maxSalary", "salary"], ["minAge", "maxAge", "age"]]) {
    if (filters[minimum] !== null && filters[maximum] !== null && filters[minimum] > filters[maximum]) throw searchError(`Minimum ${label} must not exceed maximum ${label}.`);
  }
  filters.keywordTree = filters.booleanMode ? parseBooleanKeywords(filters.keywords) : null;
  filters.keywordTerms = filters.booleanMode ? [] : list(filters.keywords).map(term => term.replace(/^"|"$/g, ""));
  return filters;
}

function candidateSearchDetails(employee) {
  const source = employee.source_payload || employee.sourcePayload || {};
  const details = { ...source, ...(source.data || {}), ...employee };
  return {
    preferredLocations: details.preferred_locations ?? details.preferredLocations ?? "",
    willingToRelocate: details.willing_to_relocate ?? details.willingToRelocate,
    salary: number(details.current_ctc_lpa ?? details.salary_lpa ?? details.current_ctc),
    employmentType: details.employment_type ?? details.employmentType ?? "",
    degree: details.degree ?? details.education?.degree ?? (typeof details.education === "string" ? details.education : ""),
    institution: details.institution ?? details.education?.institution ?? "",
    graduationYear: number(details.graduation_year ?? details.graduationYear ?? details.education?.graduationYear),
    gender: details.gender ?? "", disability: details.disability_status ?? details.disabilityStatus,
    age: number(details.age), noticePeriod: number(details.notice_period_days ?? details.noticePeriodDays),
    lastActiveAt: details.last_active_at ?? details.lastActiveAt ?? ""
  };
}

function booleanExpression(node, term, and, or, not) {
  if (node.term !== undefined) {
    const result = term(node.term);
    return node.prefix === "-" ? not(result) : result;
  }
  let result = booleanExpression(node.left, term, and, or, not);
  if (node.right) {
    const right = booleanExpression(node.right, term, and, or, not);
    if (["NOT", "AND NOT"].includes(node.operator)) result = and(result, not(right));
    else if (node.operator === "OR NOT") result = or(result, not(right));
    else result = node.operator === "OR" ? or(result, right) : and(result, right);
  }
  return node.start === "NOT" ? not(result) : result;
}

function matchesAdvancedSearch(employee, filters, now = Date.now()) {
  if (!filters) return true;
  const details = candidateSearchDetails(employee);
  const contains = (field, value) => String(field ?? "").toLowerCase().includes(value.toLowerCase());
  const text = [employee.name, employee.email, employee.phone, employee.location, employee.keywords, employee.designation, employee.current_designation, employee.current_company, employee.department, details.degree, details.institution, employee.latest_resume?.extracted_text].filter(Boolean).join(" ");
  if (filters.keywordTree && !booleanExpression(filters.keywordTree, term => contains(text, term), (a, b) => a && b, (a, b) => a || b, a => !a)) return false;
  if (filters.keywordTerms.length && !filters.keywordTerms.some(term => contains(text, term))) return false;
  if (!filters.mandatory.every(term => contains(text, term)) || filters.exclude.some(term => contains(text, term))) return false;
  if (filters.skills.length && !filters.skills.every(term => contains(employee.keywords || (employee.skills || []).join(","), term))) return false;
  const yes = value => ["yes", "true", "1"].includes(String(value).toLowerCase());
  const no = value => ["no", "false", "0"].includes(String(value).toLowerCase());
  if (filters.locations.length && !filters.locations.some(term => contains(employee.location, term) || (filters.includeRelocating && yes(details.willingToRelocate) && contains(details.preferredLocations, term)))) return false;
  if (filters.preferredLocations.length && !filters.preferredLocations.some(term => contains(details.preferredLocations, term))) return false;
  for (const [value, expected] of [[details.willingToRelocate, filters.relocation], [details.disability, filters.disability]]) {
    if (expected && !(expected === "yes" ? yes(value) : no(value))) return false;
  }
  for (const [field, value] of [[employee.current_company, filters.company], [employee.current_designation || employee.designation, filters.designation], [employee.department, filters.department], [details.employmentType, filters.employmentType], [details.degree, filters.degree], [details.institution, filters.institution]]) {
    if (value && !contains(field, value)) return false;
  }
  if (filters.gender && String(details.gender).toLowerCase() !== filters.gender.toLowerCase()) return false;
  const range = (value, min, max) => min === null && max === null || value !== null && value !== undefined && value !== "" && (min === null || Number(value) >= min) && (max === null || Number(value) <= max);
  if (!range(employee.experience, filters.minExperience, filters.maxExperience)) return false;
  if (!range(details.salary, filters.minSalary, filters.maxSalary) && !(filters.includeUnknownSalary && details.salary === null)) return false;
  if (!range(details.age, filters.minAge, filters.maxAge)) return false;
  if (!range(details.noticePeriod, null, filters.noticePeriod)) return false;
  if (filters.graduationYear !== null && details.graduationYear !== filters.graduationYear) return false;
  if (filters.activeIn) {
    const date = String(details.lastActiveAt);
    const cutoff = new Date(now - filters.activeIn * 86400000).toISOString().slice(0, 10);
    if (!/^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])(T|$)/.test(date) || date.slice(0, 10) < cutoff) return false;
  }
  const cv = Boolean(employee.cv_file_name || employee.latest_resume);
  if (filters.cv && (filters.cv === "attached") !== cv) return false;
  return true;
}

function advancedSearchSql(filters, params) {
  if (!filters) return [];
  const where = [];
  const parameter = value => { params.push(value); return `$${params.length}`; };
  const metadata = (keys, fallback = "''") => `COALESCE(${keys.flatMap(key => [`e.source_payload #>> '{data,${key}}'`, `e.source_payload ->> '${key}'`]).map(expression => `NULLIF(${expression}, '')`).join(", ")}, ${fallback})`;
  const numeric = expression => `(CASE WHEN ${expression} ~ '^[0-9]+([.][0-9]+)?$' THEN (${expression})::numeric END)`;
  const preferred = metadata(["preferred_locations", "preferredLocations"]);
  const relocating = metadata(["willing_to_relocate", "willingToRelocate"], "NULL");
  const educationField = key => `COALESCE(e.source_payload #>> '{data,education,${key}}', e.source_payload #>> '{education,${key}}')`;
  const educationText = "COALESCE(CASE WHEN jsonb_typeof(e.source_payload #> '{data,education}') = 'string' THEN e.source_payload #>> '{data,education}' END, CASE WHEN jsonb_typeof(e.source_payload -> 'education') = 'string' THEN e.source_payload ->> 'education' END)";
  const degree = metadata(["degree"], `COALESCE(${educationField("degree")}, ${educationText}, '')`);
  const institution = metadata(["institution"], `COALESCE(${educationField("institution")}, '')`);
  const text = `concat_ws(' ', e.name, e.email, e.phone, e.location, e.keywords, e.designation, e.current_designation, e.current_company, e.department, ${degree}, ${institution}, latest_resume.extracted_text)`;
  const contains = (field, value) => `(POSITION(LOWER(${parameter(value)}) IN LOWER(COALESCE(${field}, ''))) > 0)`;
  if (filters.keywordTree) where.push(booleanExpression(filters.keywordTree, term => contains(text, term), (a, b) => `(${a} AND ${b})`, (a, b) => `(${a} OR ${b})`, a => `(NOT ${a})`));
  if (filters.keywordTerms.length) where.push(`(${filters.keywordTerms.map(term => contains(text, term)).join(" OR ")})`);
  filters.mandatory.forEach(term => where.push(contains(text, term)));
  filters.exclude.forEach(term => where.push(`NOT ${contains(text, term)}`));
  filters.skills.forEach(term => where.push(contains("concat_ws(' ', e.keywords, array_to_string(skill_set.skills, ','))", term)));
  if (filters.locations.length) where.push(`(${filters.locations.map(term => `(${contains("e.location", term)}${filters.includeRelocating ? ` OR (LOWER(${relocating}) IN ('true', 'yes', '1') AND ${contains(preferred, term)})` : ""})`).join(" OR ")})`);
  if (filters.preferredLocations.length) where.push(`(${filters.preferredLocations.map(term => contains(preferred, term)).join(" OR ")})`);
  for (const [field, value] of [["e.current_company", filters.company], ["COALESCE(e.current_designation, e.designation)", filters.designation], ["e.department", filters.department], [metadata(["employment_type", "employmentType"]), filters.employmentType], [degree, filters.degree], [institution, filters.institution]]) {
    if (value) where.push(contains(field, value));
  }
  if (filters.gender) where.push(`LOWER(${metadata(["gender"])}) = LOWER(${parameter(filters.gender)})`);
  for (const [field, value] of [[relocating, filters.relocation], [metadata(["disability_status", "disabilityStatus"], "NULL"), filters.disability]]) {
    if (value) where.push(`LOWER(${field}) ${value === "yes" ? "IN ('true', 'yes', '1')" : "IN ('false', 'no', '0')"}`);
  }
  const range = (field, minimum, maximum) => {
    const clauses = [];
    if (minimum !== null) clauses.push(`${field} >= ${parameter(minimum)}`);
    if (maximum !== null) clauses.push(`${field} <= ${parameter(maximum)}`);
    return clauses.join(" AND ");
  };
  const salary = numeric(metadata(["current_ctc_lpa", "salary_lpa", "current_ctc"]));
  for (const [field, min, max] of [["e.experience", filters.minExperience, filters.maxExperience], [salary, filters.minSalary, filters.maxSalary], [numeric(metadata(["age"])), filters.minAge, filters.maxAge], [numeric(metadata(["notice_period_days", "noticePeriodDays"])), null, filters.noticePeriod]]) {
    const clause = range(field, min, max);
    if (clause) where.push(`(${clause}${field === salary && filters.includeUnknownSalary ? ` OR ${salary} IS NULL` : ""})`);
  }
  if (filters.graduationYear !== null) where.push(`${numeric(metadata(["graduation_year", "graduationYear"], `COALESCE(${educationField("graduationYear")}, '')`))} = ${parameter(filters.graduationYear)}`);
  if (filters.activeIn) {
    const date = metadata(["last_active_at", "lastActiveAt"]);
    // JSON imports may contain invalid dates; compare validated ISO dates without casting them.
    where.push(`(${date} ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])(T|$)' AND LEFT(${date}, 10) >= ${parameter(new Date(Date.now() - filters.activeIn * 86400000).toISOString().slice(0, 10))})`);
  }
  if (filters.cv) where.push(`${filters.cv === "missing" ? "NOT " : ""}(NULLIF(e.cv_file_name, '') IS NOT NULL OR latest_resume.id IS NOT NULL)`);
  return where;
}

module.exports = { parseAdvancedSearch, candidateSearchDetails, matchesAdvancedSearch, advancedSearchSql };
