const assert = require("node:assert/strict");
const { employeeFilters, matchesEmployeeFilters, employeeFilterSql, employeeOrderSql, sortEmployees } = require("../src/employee-search");

const employees = [
  { id: "1", name: "Asha", location: "Bangalore, Karnataka", keywords: "Java, Spring Boot", experience: 3, current_company: "TCS", current_designation: "Software Engineer", cv_file_name: "asha.pdf", updatedAt: "2026-10-01" },
  { id: "2", name: "Bala", location: "Pune", keywords: "Python, SQL", experience: 8, current_company: "Infosys", designation: "Analyst", updatedAt: "2026-10-04" },
  { id: "3", name: "Chitra", location: "Mumbai", experience: 0 },
  { id: "4", name: "Deepa", location: "Mumbai", experience: null }
];

function matching(query) {
  const filters = employeeFilters(query);
  return employees.filter(employee => matchesEmployeeFilters(employee, filters)).map(employee => employee.id);
}

assert.deepEqual(matching({}), ["1", "2", "3", "4"]);
assert.deepEqual(matching({ locations: "bangalore", skills: "java", experiences: "2-5", company: "tcs", cv: "attached" }), ["1"]);
assert.deepEqual(matching({ locations: "Bangalore,Pune", skills: "Python" }), ["2"]);
assert.deepEqual(matching({ experiences: "0-0" }), ["3"]);
assert.deepEqual(matching({ experiences: "0-2" }), ["3"]);
assert.deepEqual(matching({ experiences: "5-10,10-*" }), ["2"]);
assert.deepEqual(matching({ designation: "analyst", cv: "missing" }), ["2"]);
assert.deepEqual(matching({ ids: '["1","3"]' }), ["1", "3"]);
assert.deepEqual(matching({ ids: "[]" }), []);
assert.deepEqual(matching({ ids: "not JSON" }), []);
assert.deepEqual(matching({ excludeIds: '["1","3"]' }), ["2", "4"]);
assert.deepEqual(sortEmployees([...employees], "experience").map(employee => employee.id), ["2", "1", "3", "4"]);
assert.deepEqual(sortEmployees([...employees], "recent").map(employee => employee.id), ["2", "1", "3", "4"]);

const params = ["", "%%", [], 20, 0];
const maliciousCompany = "TCS' OR 1=1 --";
const sql = employeeFilterSql(employeeFilters({ locations: "Bangalore,Pune", skills: "Java", company: maliciousCompany, experiences: "0-0,2-5,10-*", ids: '["1"]', excludeIds: '["2"]', cv: "attached" }), params).join(" AND ");
assert(!sql.includes(maliciousCompany));
assert(params.includes(maliciousCompany));
const placeholders = [...sql.matchAll(/\$(\d+)/g)].map(match => Number(match[1]));
assert.equal(Math.max(...placeholders), params.length);
assert.equal(Math.min(...placeholders), 6);
assert.equal(employeeOrderSql("experience"), "e.experience DESC NULLS LAST, e.name ASC, e.id ASC");
assert.equal(employeeOrderSql("untrusted SQL"), "search_rank DESC, e.name ASC, e.id ASC");
console.log("Employee search filters, ranges, workflow IDs, sorting and SQL parameters passed.");
