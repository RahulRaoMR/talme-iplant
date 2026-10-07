const { parseAdvancedSearch, matchesAdvancedSearch, advancedSearchSql } = require("./advanced-candidate-search");

function values(value) {
  return String(value || "").split(",").map(item => item.trim()).filter(Boolean).slice(0, 30);
}

function ids(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String).slice(0, 2000) : [];
  } catch {
    return [];
  }
}

function employeeFilters(query = {}) {
  return {
    advanced: parseAdvancedSearch(query.advanced),
    locations: values(query.locations),
    skills: values(query.skills),
    experiences: values(query.experiences).filter(value => /^(\d+)-(\d+|\*)$/.test(value)),
    company: String(query.company || "").trim(),
    designation: String(query.designation || "").trim(),
    cv: ["attached", "missing"].includes(query.cv) ? query.cv : "",
    ids: ids(query.ids),
    restrictIds: Boolean(query.ids),
    excludeIds: ids(query.excludeIds),
    sort: ["name", "experience", "recent"].includes(query.sort) ? query.sort : "relevance"
  };
}

function experienceRange(value) {
  const [minimum, maximum] = value.split("-");
  return [Number(minimum), maximum === "*" ? Infinity : Number(maximum)];
}

function matchesEmployeeFilters(employee, filters) {
  if (!matchesAdvancedSearch(employee, filters.advanced)) return false;
  const contains = (field, value) => String(field || "").toLowerCase().includes(value.toLowerCase());
  const employeeId = String(employee.id ?? employee.employee_code ?? employee.email ?? employee.phone ?? "");
  if (filters.restrictIds && !filters.ids.includes(employeeId)) return false;
  if (filters.excludeIds.includes(employeeId)) return false;
  if (filters.locations.length && !filters.locations.some(value => contains(employee.location, value))) return false;
  if (filters.skills.length && !filters.skills.some(value => contains(employee.keywords, value))) return false;
  if (filters.company && !contains(employee.current_company || employee.currentCompany, filters.company)) return false;
  if (filters.designation && !contains(employee.current_designation || employee.designation, filters.designation)) return false;
  if (filters.experiences.length) {
    const experience = employee.experience == null || employee.experience === "" ? NaN : Number.parseFloat(employee.experience);
    if (!filters.experiences.some(value => {
      const [minimum, maximum] = experienceRange(value);
      return experience >= minimum && (minimum === maximum ? experience === maximum : experience < maximum);
    })) return false;
  }
  const hasCv = Boolean(employee.cv_file_name || employee.cvFileName || employee.latest_resume);
  if (filters.cv === "attached" && !hasCv) return false;
  if (filters.cv === "missing" && hasCv) return false;
  return true;
}

function employeeFilterSql(filters, params) {
  const where = advancedSearchSql(filters.advanced, params);
  const parameter = value => {
    params.push(value);
    return `$${params.length}`;
  };
  for (const [column, selected] of [["e.location", filters.locations], ["e.keywords", filters.skills]]) {
    if (selected.length) where.push(`(${selected.map(value => `POSITION(LOWER(${parameter(value)}) IN LOWER(COALESCE(${column}, ''))) > 0`).join(" OR ")})`);
  }
  for (const [column, value] of [["e.current_company", filters.company], ["COALESCE(e.current_designation, e.designation)", filters.designation]]) {
    if (value) where.push(`POSITION(LOWER(${parameter(value)}) IN LOWER(COALESCE(${column}, ''))) > 0`);
  }
  if (filters.experiences.length) {
    where.push(`(${filters.experiences.map(value => {
      const [minimum, maximum] = experienceRange(value);
      const low = parameter(minimum);
      return minimum === maximum ? `e.experience = ${low}` : `e.experience >= ${low}${Number.isFinite(maximum) ? ` AND e.experience < ${parameter(maximum)}` : ""}`;
    }).map(clause => `(${clause})`).join(" OR ")})`);
  }
  const identifier = "COALESCE(e.source_id::text, e.employee_code, e.email, e.phone, '')";
  if (filters.restrictIds) where.push(`${identifier} = ANY(${parameter(filters.ids)}::text[])`);
  if (filters.excludeIds.length) where.push(`NOT (${identifier} = ANY(${parameter(filters.excludeIds)}::text[]))`);
  if (filters.cv) {
    const cv = "(NULLIF(e.cv_file_name, '') IS NOT NULL OR latest_resume.id IS NOT NULL)";
    where.push(filters.cv === "attached" ? cv : `NOT ${cv}`);
  }
  return where;
}

function employeeOrderSql(sort) {
  if (sort === "experience") return "e.experience DESC NULLS LAST, e.name ASC, e.id ASC";
  if (sort === "recent") return "COALESCE(e.source_updated_at, e.updated_at) DESC NULLS LAST, e.id DESC";
  if (sort === "name") return "e.name ASC, e.id ASC";
  return "search_rank DESC, e.name ASC, e.id ASC";
}

function sortEmployees(items, sort) {
  if (sort === "relevance") return items;
  return items.sort((left, right) => {
    if (sort === "experience") {
      const difference = (Number.parseFloat(right.experience) || 0) - (Number.parseFloat(left.experience) || 0);
      if (difference) return difference;
    }
    if (sort === "recent") {
      const timestamp = employee => new Date(employee.updatedAt || employee.updated_at || employee.last_edited_at || 0).getTime() || 0;
      const difference = timestamp(right) - timestamp(left);
      if (difference) return difference;
    }
    return String(left.name || "").localeCompare(String(right.name || ""));
  });
}

module.exports = { employeeFilters, matchesEmployeeFilters, employeeFilterSql, employeeOrderSql, sortEmployees };
