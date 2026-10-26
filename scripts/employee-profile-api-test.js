const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const fs = require("node:fs");
const path = require("node:path");
const env = require("../src/load-env");
env.loadLocalEnv();
env.loadLocalEnv = () => {};
process.env.DB_PATH = ":memory:";
process.env.DATABASE_URL = "";
// Audit persistence has its own PostgreSQL suite; keep these API fixtures in memory.
require("../src/auth-store").upsertEmployeeRecordAudit = async () => null;
const { requestHandler } = require("../src/server");
const { db, createUser, now } = require("../src/db");
const { signJwt } = require("../src/security");
const employeeStore = require("../src/employee-store");

function call(url, token, payload) {
  const body = payload ? JSON.stringify(payload) : "";
  const request = Readable.from(body ? [body] : []);
  Object.assign(request, { method: payload ? "PUT" : "GET", url, headers: {
    host: "localhost", "content-type": "application/json", "content-length": Buffer.byteLength(body),
    "x-csrf-token": "csrf", ...(token ? { authorization: `Bearer ${token}` } : {})
  }, socket: { remoteAddress: "192.0.2.15" } });
  return new Promise((resolve, reject) => {
    const headers = {};
    const response = { statusCode: 200, setHeader(key, value) { headers[key] = value; }, getHeader(key) { return headers[key]; }, writeHead(code) { this.statusCode = code; }, end(text) { resolve({ status: this.statusCode, body: JSON.parse(String(text)) }); } };
    requestHandler(request, response).catch(reject);
  });
}

function session(role) {
  const userId = createUser({ name: role, email: `profile-test-${role}@example.test`, password: "Test-password-123!", roleSlug: role });
  const id = Number(db.prepare("INSERT INTO sessions(user_id,refresh_token_hash,csrf_token,expires_at,last_seen_at,created_at) VALUES (?,?,?,?,?,?)").run(userId, role, "csrf", new Date(Date.now() + 3600000).toISOString(), now(), now()).lastInsertRowid);
  return { userId, token: signJwt({ sub: userId, sid: id }) };
}

(async () => {
  try {
    const hr = session("hr_manager");
    const admin = session("super_admin");
    const candidate = session("candidate");
    const employeeId = createUser({ name: "Profile Fixture", email: "profile-fixture@example.test", password: "Test-password-123!", roleSlug: "employee" });
    db.prepare("INSERT INTO employee_accounts(user_id,employee_code,department,location,experience,keywords,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(employeeId, "PROFILE-API-TEST-01", "Engineering", "Bangalore", 0, "Java, React", now());
    assert.equal((await call("/api/hr/employees/PROFILE-API-TEST-01")).status, 401);
    assert.equal((await call("/api/hr/employees/PROFILE-API-TEST-01", candidate.token)).status, 403);
    for (const token of [hr.token, admin.token]) {
      for (const identifier of ["PROFILE-API-TEST-01", "PROFILE-FIXTURE@example.test"]) {
        const response = await call(`/api/hr/employees/${encodeURIComponent(identifier)}`, token);
        assert.equal(response.status, 200);
        assert.equal(response.body.employee.name, "Profile Fixture");
        assert.equal(response.body.employee.status, "active");
        assert.equal(response.body.employee.experience, 0);
        assert.equal(response.body.employee.keywords, "Java, React");
        assert(response.body.employee.createdAt);
        assert.equal(response.body.employee.password_hash, undefined);
      }
      assert.equal((await call("/api/hr/employees/PROFILE-API-MISSING", token)).status, 404);
    }
    const profileUrl = `/api/hr/employees/${employeeId}`;
    const changes = {
      name: "Profile Fixture", email: "profile-fixture@example.test", employeeCode: "00001",
      currentDesignation: "Senior Engineer", department: "Engineering", location: "Bengaluru / Bangalore",
      experience: 6, employmentType: "Permanent", joiningDate: "2020-06-15", noticePeriod: "30 days", reportingManager: "Team Lead", currentCtc: "6.5", expectedCtc: "9"
    };
    assert.equal((await call(profileUrl, candidate.token, changes)).status, 403);
    const saved = await call(profileUrl, hr.token, changes);
    assert.equal(saved.status, 200);
    const expectedDetails = { employment_type: "Permanent", joining_date: "2020-06-15", notice_period: "30 days", reporting_manager: "Team Lead", current_ctc: "6.5", expected_ctc: "9" };
    assert.deepEqual(saved.body.employee.profile_details, expectedDetails);
    const refreshed = await call(profileUrl, hr.token);
    assert.deepEqual(refreshed.body.employee.profile_details, expectedDetails);
    assert.equal(refreshed.body.employee.current_designation, "Senior Engineer");
    assert.equal(refreshed.body.employee.experience, 6);
    assert.equal(refreshed.body.employee.location, "Bengaluru / Bangalore");
    const filtered = await call(`/api/hr/employees/search?${new URLSearchParams({ q: changes.email, advanced: JSON.stringify({ minSalary: 6, maxSalary: 7, employmentType: "Permanent", noticePeriod: 30 }) })}`, hr.token);
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.pagination.total, 1);
    assert.equal(filtered.body.items[0].profile_details.expected_ctc, "9");
    for (const joiningDate of ["2026-02-30", "not-a-date"]) {
      assert.equal((await call(profileUrl, hr.token, { ...changes, joiningDate })).status, 400);
    }
    for (const key of ["currentCtc", "expectedCtc"]) {
      for (const amount of ["-1", "not-a-number", "Infinity"]) {
        assert.equal((await call(profileUrl, hr.token, { ...changes, [key]: amount })).status, 400);
      }
    }
    assert.deepEqual((await call(profileUrl, hr.token)).body.employee.profile_details, expectedDetails);
    const { employmentType, joiningDate, noticePeriod, reportingManager, currentCtc, expectedCtc, ...legacyChanges } = changes;
    assert.equal((await call(profileUrl, hr.token, legacyChanges)).status, 200);
    assert.deepEqual((await call(profileUrl, hr.token)).body.employee.profile_details, expectedDetails);
    assert.equal((await call(profileUrl, hr.token, { ...changes, currentCtc: 0, expectedCtc: 0 })).status, 200);
    assert.equal((await call(profileUrl, hr.token)).body.employee.profile_details.current_ctc, "0");
    assert.equal((await call(profileUrl, hr.token)).body.employee.profile_details.expected_ctc, "0");
    assert.equal((await call(profileUrl, hr.token, { ...changes, experience: 0, employmentType: "", joiningDate: "", noticePeriod: "", reportingManager: "", currentCtc: "", expectedCtc: "" })).status, 200);
    const cleared = await call(profileUrl, hr.token);
    assert.equal(cleared.body.employee.experience, 0);
    assert.deepEqual(cleared.body.employee.profile_details, { employment_type: null, joining_date: null, notice_period: null, reporting_manager: null, current_ctc: null, expected_ctc: null });
    // Exercise imported-record persistence without changing the user's import file.
    const importedPath = path.join(__dirname, "../data/imported-employees.json");
    const originalFs = { existsSync: fs.existsSync, readFileSync: fs.readFileSync, writeFileSync: fs.writeFileSync };
    let importedPayload = JSON.stringify({ items: [{ id: "work-details-imported-fixture", name: "Imported Fixture", employment_type: "Contract", source: "imported" }] });
    fs.existsSync = file => file === importedPath || originalFs.existsSync(file);
    fs.readFileSync = (file, ...args) => file === importedPath ? importedPayload : originalFs.readFileSync(file, ...args);
    fs.writeFileSync = (file, value, ...args) => file === importedPath ? (importedPayload = String(value)) : originalFs.writeFileSync(file, value, ...args);
    try {
      const importedUrl = "/api/hr/employees/work-details-imported-fixture";
      assert.equal((await call(importedUrl, hr.token)).body.employee.profile_details.employment_type, "Contract");
      assert.equal((await call(importedUrl, hr.token, changes)).status, 200);
      assert.deepEqual((await call(importedUrl, hr.token)).body.employee.profile_details, expectedDetails);
      assert.deepEqual(JSON.parse(importedPayload).items[0].profile_details, expectedDetails);
      assert.equal((await call(importedUrl, hr.token, { ...changes, employmentType: "" })).status, 200);
      assert.equal((await call(importedUrl, hr.token)).body.employee.profile_details.employment_type, null);
    } finally { Object.assign(fs, originalFs); }
    // Persistent data uses the same protected response contract without consulting paginated search results.
    employeeStore.hasEmployeeDatabase = () => true;
    employeeStore.hasEmployeeTables = async () => true;
    employeeStore.findEmployeeByIdentifier = async identifier => identifier === "persistent-fixture" ? {
      id: identifier, name: "Persistent Fixture", status: "inactive", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-05T00:00:00Z", cv_file_name: "Resume.pdf", cv_stored_name: "resume.pdf", latest_resume: { uploaded_at: "2026-10-05T00:00:00Z" }, skills: ["Java"], source: "imported", rowNumber: 12,
      profile_details: { ...expectedDetails, private_metadata: "must not be returned" }
    } : null;
    const persistent = await call("/api/hr/employees/persistent-fixture", hr.token);
    assert.equal(persistent.status, 200);
    assert.equal(persistent.body.employee.status, "inactive");
    assert.equal(persistent.body.employee.latest_resume.uploaded_at, "2026-10-05T00:00:00Z");
    assert.deepEqual(persistent.body.employee.skills, ["Java"]);
    assert.equal(persistent.body.employee.createdAt, "2026-10-01T00:00:00Z");
    assert.deepEqual(persistent.body.employee.profile_details, expectedDetails);
    assert.equal((await call("/api/hr/employees/PROFILE-API-MISSING", hr.token)).status, 404);
    console.log("Employee profile API tests passed: authentication, permissions, lookup, local/imported work details save/refresh/clear, legacy updates, date validation, zero experience, safe fields, and persistent CV metadata.");
  } finally { db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
