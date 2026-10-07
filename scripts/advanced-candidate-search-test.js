const assert = require("node:assert/strict");
const { parseAdvancedSearch, candidateSearchDetails, matchesAdvancedSearch, advancedSearchSql } = require("../src/advanced-candidate-search");

const employee = {
  name: "Candidate", location: "Bangalore", keywords: "Java, Spring Boot, SQL", experience: 3.5,
  current_company: "TCS", current_designation: "Software Engineer", department: "Engineering", cv_file_name: "resume.pdf",
  source_payload: { data: { salary_lpa: 8, willing_to_relocate: true, preferred_locations: ["Pune", "Hyderabad"], gender: "female", age: 27, disability_status: false, degree: "B.Tech", institution: "VTU", graduation_year: 2020, employment_type: "permanent", notice_period_days: 30, last_active_at: new Date().toISOString() } }
};
const match = criteria => matchesAdvancedSearch(employee, parseAdvancedSearch(criteria));
assert(match({ keywords: "Java AND (Spring OR React) NOT Python", booleanMode: true }));
assert(match({ keywords: 'Java AND "Spring Boot"', booleanMode: true }));
assert(match({ keywords: "NOT Python", booleanMode: true }));
assert(!match({ keywords: "Java AND Python", booleanMode: true }));
assert(!match({ keywords: "Java AND NOT SQL", booleanMode: true }));
assert(match({ keywords: "Python, Java" }));
assert(match({ mandatory: "Java, SQL", exclude: "Python" }));
assert(!match({ mandatory: "Java, React" }));
assert(!match({ exclude: "Spring Boot" }));
assert(match({ skills: "Java, SQL", minExperience: 3, maxExperience: 3.5 }));
assert(!match({ minExperience: 4 }));
assert(!matchesAdvancedSearch({ experience: null }, parseAdvancedSearch({ minExperience: 0 })));
assert(!match({ locations: "Pune" }));
assert(matchesAdvancedSearch({ ...employee, location: "Bangalore, Karnataka" }, parseAdvancedSearch({ locations: ["Bangalore, Karnataka"] })));
assert(!matchesAdvancedSearch({ ...employee, location: "Bangalore, Tamil Nadu" }, parseAdvancedSearch({ locations: ["Bangalore, Karnataka"] })));
assert(match({ locations: "Pune", includeRelocating: true, preferredLocations: "Hyderabad", relocation: "yes" }));
assert(!match({ relocation: "no" }));
assert(match({ minSalary: 8, maxSalary: 8 }));
assert(!match({ minSalary: 9 }));
assert(!matchesAdvancedSearch({}, parseAdvancedSearch({ minSalary: 0 })));
assert(matchesAdvancedSearch({}, parseAdvancedSearch({ minSalary: 10, includeUnknownSalary: true })));
assert(match({ company: "TCS", designation: "Engineer", department: "Engineering", employmentType: "permanent" }));
assert(match({ degree: "B.Tech", institution: "VTU", graduationYear: 2020 }));
assert(match({ gender: "female", minAge: 25, maxAge: 30, disability: "no" }));
assert(!matchesAdvancedSearch({ disability_status: "unknown" }, parseAdvancedSearch({ disability: "no" })));
assert(match({ noticePeriod: 30, cv: "attached", activeIn: 7 }));
assert(!match({ noticePeriod: 15 }));
assert(!matchesAdvancedSearch({}, parseAdvancedSearch({ activeIn: 7 })));
assert.equal(candidateSearchDetails(employee).salary, 8);
for (const criteria of [{ minExperience: 5, maxExperience: 2 }, { minSalary: -1 }, { keywords: "Java AND (", booleanMode: true }, { keywords: "name:Java", booleanMode: true }]) assert.throws(() => parseAdvancedSearch(criteria), error => error.statusCode === 400);
assert.throws(() => parseAdvancedSearch("broken JSON"), error => error.statusCode === 400);

const params = ["", "%%", [], 20, 0];
const malicious = "TCS' OR true --";
const filters = parseAdvancedSearch({ ...Object.fromEntries(Object.entries(employee.source_payload.data)), keywords: "Java OR Python", booleanMode: true, mandatory: "SQL", exclude: "React", locations: "Pune", includeRelocating: true, relocation: "yes", company: malicious, minExperience: 1, maxExperience: 5, minSalary: 5, maxSalary: 10, degree: "B.Tech", minAge: 20, maxAge: 30, activeIn: 7 });
const sql = advancedSearchSql(filters, params).join(" AND ");
assert(!sql.includes(malicious));
assert(params.includes(malicious));
assert(sql.includes("latest_resume.extracted_text"));
const placeholders = [...sql.matchAll(/\$(\d+)/g)].map(match => Number(match[1]));
assert.equal(Math.min(...placeholders), 6);
assert.equal(Math.max(...placeholders), params.length);
console.log("Advanced keywords, Boolean queries, ranges, relocation, metadata, missing data, validation and SQL parameters passed.");
