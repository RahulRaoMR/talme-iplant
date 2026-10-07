const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
require("../src/load-env").loadLocalEnv();
process.env.DB_PATH = ":memory:";
process.env.DATABASE_URL = "";
const { requestHandler } = require("../src/server");
const { db, createUser, now } = require("../src/db");
const { signJwt } = require("../src/security");
const employeeStore = require("../src/employee-store");

function call(url, token) {
  const request = Readable.from([]);
  Object.assign(request, { method: "GET", url, headers: { host: "localhost", ...(token ? { authorization: `Bearer ${token}` } : {}) }, socket: { remoteAddress: "192.0.2.15" } });
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
    // Persistent data uses the same protected response contract without consulting paginated search results.
    employeeStore.hasEmployeeDatabase = () => true;
    employeeStore.hasEmployeeTables = async () => true;
    employeeStore.findEmployeeByIdentifier = async identifier => identifier === "persistent-fixture" ? {
      id: identifier, name: "Persistent Fixture", status: "inactive", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-05T00:00:00Z", cv_file_name: "Resume.pdf", cv_stored_name: "resume.pdf", latest_resume: { uploaded_at: "2026-10-05T00:00:00Z" }, skills: ["Java"], source: "imported", rowNumber: 12
    } : null;
    const persistent = await call("/api/hr/employees/persistent-fixture", hr.token);
    assert.equal(persistent.status, 200);
    assert.equal(persistent.body.employee.status, "inactive");
    assert.equal(persistent.body.employee.latest_resume.uploaded_at, "2026-10-05T00:00:00Z");
    assert.deepEqual(persistent.body.employee.skills, ["Java"]);
    assert.equal(persistent.body.employee.createdAt, "2026-10-01T00:00:00Z");
    assert.equal((await call("/api/hr/employees/PROFILE-API-MISSING", hr.token)).status, 404);
    console.log("Employee profile API tests passed: authentication, permission checks, direct identifier lookup, missing records, status, creation dates, zero experience, safe fields, and persistent CV metadata.");
  } finally { db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
