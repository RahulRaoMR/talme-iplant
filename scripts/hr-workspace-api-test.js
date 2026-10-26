const assert = require("node:assert/strict");
const { createHrWorkspaceFixture } = require("./hr-workspace-fixture");

(async () => {
  const fixture = await createHrWorkspaceFixture();
  const { request, hr, candidate } = fixture;
  const checks = [];
  async function search(query = {}) {
    const response = await request(`/api/hr/employees/search?${new URLSearchParams({ limit: "100", ...query })}`, { session: hr });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body;
  }
  try {
    assert.equal((await request("/api/hr/employees/search")).status, 401);
    assert.equal((await request("/api/hr/employees/search", { session: candidate })).status, 403);
    checks.push("permissions"); console.log("Passed: permissions");
    const cases = [
      [{}, 45], [{ locations: "Bangalore" }, 9], [{ locations: "Bangalore,Pune" }, 18],
      [{ skills: "React" }, 9], [{ skills: "Java,Python" }, 27], [{ experiences: "0-0" }, 9],
      [{ experiences: "0-2" }, 9], [{ experiences: "2-5" }, 18], [{ experiences: "5-10" }, 9], [{ experiences: "10-*" }, 0],
      [{ company: "tcs" }, 18], [{ designation: "Analyst" }, 9], [{ cv: "attached" }, 27], [{ cv: "missing" }, 18],
      [{ locations: "Bangalore", skills: "Java", experiences: "2-5", company: "TCS" }, 9],
      [{ q: "Asha Java 1" }, 3], [{ q: "fixture-1@workspace-check.example.test" }, 1], [{ q: "8110000001" }, 1]
    ];
    for (const [query, expected] of cases) assert.equal((await search(query)).pagination.total, expected, JSON.stringify(query));
    checks.push("all basic filters, combinations, and keyword/contact searches"); console.log("Passed: basic filters and keyword/contact searches");
    const first = await search({ page: "1", limit: "20", sort: "name" });
    const second = await search({ page: "2", limit: "20", sort: "name" });
    assert.equal(first.items.length, 20); assert.equal(second.items.length, 20);
    assert(!second.items.some(item => first.items.some(previous => previous.id === item.id)));
    assert.equal((await search({ page: "3", limit: "20" })).items.length, 5);
    const experienceSorted = (await search({ sort: "experience" })).items.map(item => item.experience);
    assert.equal(experienceSorted[0], 8); assert.equal(experienceSorted.at(-1), null);
    checks.push("pagination and sorting"); console.log("Passed: pagination and sorting");
    const advancedCases = [
      [{ keywords: 'Java AND "Spring Boot" NOT Python', booleanMode: true }, 9],
      [{ mandatory: "Java, SQL", exclude: "Spring" }, 9],
      [{ minExperience: 3, maxExperience: 4, minSalary: 7, maxSalary: 9 }, 9],
      [{ locations: ["Delhi"], includeRelocating: true }, 45],
      [{ company: "TCS", department: "Engineering", employmentType: "permanent" }, 18],
      [{ degree: "B.Tech", institution: "VTU", graduationYear: 2020 }, 45],
      [{ gender: "female", minAge: 25, maxAge: 30, disability: "no" }, 18],
      [{ noticePeriod: 30, cv: "attached", activeIn: 7 }, 27],
      [{ minSalary: 100 }, 0], [{ minSalary: 100, includeUnknownSalary: true }, 9]
    ];
    for (const [criteria, expected] of advancedCases) assert.equal((await search({ advanced: JSON.stringify(criteria) })).pagination.total, expected, JSON.stringify(criteria));
    for (const criteria of [{ minExperience: 10, maxExperience: 2 }, { keywords: "Java AND (", booleanMode: true }]) {
      assert.equal((await request(`/api/hr/employees/search?${new URLSearchParams({ advanced: JSON.stringify(criteria) })}`, { session: hr })).status, 400);
    }
    checks.push("advanced search sections, Boolean syntax and range validation"); console.log("Passed: advanced search and validation");
    const added = { fullName: "Added Employee Fixture", email: "added@workspace-check.example.test", phone: "8990000011", location: "Bangalore", keywords: "Rust, SQL", experience: 0, currentCompany: "Fixture Company", currentDesignation: "Engineer", employeeCode: "FIX-009" };
    const result = await request("/api/hr/employees", { method: "POST", body: added, session: hr });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    const employeeId = result.body.employee.id;
    assert.equal((await search({ q: added.email })).pagination.total, 1);
    assert.equal((await request(`/api/hr/employees/${employeeId}`, { session: hr })).body.employee.experience, 0);
    assert.equal((await fixture.pool.query("SELECT COUNT(*)::int AS n FROM employee_record_audits WHERE employee_email=$1", [added.email])).rows[0].n, 1);
    for (const invalid of [{ fullName: "" }, { email: "bad-email" }, { phone: "letters" }, { experience: -1 }, { experience: "Infinity" }]) {
      assert.equal((await request("/api/hr/employees", { method: "POST", body: { ...added, ...invalid }, session: hr })).status, 400, JSON.stringify(invalid));
    }
    assert.equal((await request("/api/hr/employees", { method: "POST", body: added, session: candidate })).status, 403);
    checks.push("add employee, search visibility, profile refresh, audit, and validation"); console.log("Passed: add employee and validation");
    const updates = { name: added.fullName, email: added.email, phone: added.phone, employeeCode: "00009", location: added.location, keywords: added.keywords,
      currentCompany: added.currentCompany, currentDesignation: added.currentDesignation, department: "Engineering", experience: 0,
      currentCtc: "6.5", expectedCtc: "9", employmentType: "Contract", noticePeriod: "15 days" };
    const edited = await request(`/api/hr/employees/${employeeId}`, { method: "PUT", body: updates, session: hr });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.employee.profile_details.current_ctc, "6.5");
    assert.equal((await search({ advanced: JSON.stringify({ keywords: "Rust", minSalary: 6, maxSalary: 7, employmentType: "Contract", noticePeriod: 15 }) })).pagination.total, 1);
    const repeated = await request("/api/hr/employees", { method: "POST", body: { ...added, employeeCode: "00009" }, session: hr });
    assert.equal(repeated.status, 200, JSON.stringify(repeated.body));
    assert.equal((await search({ q: added.email })).pagination.total, 1);
    assert.equal((await request(`/api/hr/employees/${employeeId}`, { session: hr })).body.employee.profile_details.current_ctc, "6.5");
    checks.push("edited CTC, employment type and notice period participate in search");
    const cvForm = new FormData();
    for (const [key, value] of Object.entries({ ...added, email: "cv@workspace-check.example.test", phone: "8990000012", employeeCode: "FIX-CV" })) cvForm.set(key, String(value));
    cvForm.set("cv", new Blob(["%PDF-1.4\n%%EOF"], { type: "application/pdf" }), "fixture-resume.pdf");
    const cvResult = await request("/api/hr/employees", { method: "POST", body: cvForm, session: hr });
    assert.equal(cvResult.status, 201, JSON.stringify(cvResult.body));
    const cvResponse = await fetch(`${fixture.baseUrl}/api/hr/employees/${encodeURIComponent(cvResult.body.employee.id)}/cv`, { headers: { Authorization: `Bearer ${hr.accessToken}` } });
    assert.equal(cvResponse.status, 200); assert((await cvResponse.text()).startsWith("%PDF"));
    checks.push("CV upload and authenticated download");
    console.log(JSON.stringify({ passed: checks }, null, 2));
  } finally { await fixture.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
