const { Readable } = require("node:stream");

require("../src/load-env").loadLocalEnv();

if (!process.env.DATABASE_URL) {
  console.log("Employee audit test skipped: DATABASE_URL is required to verify PostgreSQL-backed employee audit persistence.");
  process.exit(0);
}

const { requestHandler } = require("../src/server");
const { deleteAuthUserByEmail, closeAuthStore } = require("../src/auth-store");
const { db } = require("../src/db");

function call(method, url, payload, headers = {}) {
  const body = payload == null ? "" : JSON.stringify(payload);
  const req = Readable.from(body ? [body] : []);
  Object.assign(req, {
    method,
    url,
    headers: {
      host: "localhost",
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
      "user-agent": "employee-audit-test",
      ...headers
    },
    socket: { remoteAddress: "127.0.0.1" }
  });

  return new Promise((resolve, reject) => {
    const responseHeaders = {};
    const res = {
      statusCode: 200,
      setHeader(key, value) {
        responseHeaders[key.toLowerCase()] = value;
      },
      getHeader(key) {
        return responseHeaders[key.toLowerCase()];
      },
      writeHead(code, headers = {}) {
        this.statusCode = code;
        for (const [key, value] of Object.entries(headers)) this.setHeader(key, value);
      },
      end(chunk = "") {
        const text = String(chunk);
        resolve({
          status: this.statusCode,
          headers: responseHeaders,
          body: text ? JSON.parse(text) : {}
        });
      }
    };
    requestHandler(req, res).catch(reject);
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function registerHrUser({ name, email, phone, password }) {
  const response = await call("POST", "/api/auth/register", {
    type: "talme_hr",
    name,
    email,
    phone,
    password,
    confirmPassword: password
  });
  assert(response.status === 201, `Expected register ${name} 201, got ${response.status}: ${response.body.message || response.body.error}`);
}

async function loginHrUser({ email, password }) {
  const response = await call("POST", "/api/auth/login", {
    email,
    password,
    role: "hr_manager"
  });
  assert(response.status === 200, `Expected login 200, got ${response.status}: ${response.body.message || response.body.error}`);
  return {
    authorization: `Bearer ${response.body.accessToken}`,
    "x-csrf-token": response.body.csrfToken
  };
}

function employeePayload({ email, phone, name = "Audit Test Employee", location = "Bengaluru", keywords = "Java, Spring", designation = "Engineer" }) {
  return {
    fullName: name,
    name,
    email,
    phone,
    location,
    keywords,
    experience: 4,
    currentCompany: "Talme",
    currentDesignation: designation,
    designation,
    department: "Engineering"
  };
}

async function main() {
  const stamp = Date.now();
  const userA = {
    name: "Audit User A",
    email: `audit-user-a-${stamp}@talme.test`,
    phone: `31${String(stamp).slice(-8)}`,
    password: `AuditA-${stamp}-Aa1!`
  };
  const userB = {
    name: "Audit User B",
    email: `audit-user-b-${stamp}@talme.test`,
    phone: `32${String(stamp).slice(-8)}`,
    password: `AuditB-${stamp}-Aa1!`
  };
  const employee = {
    email: `employee-audit-${stamp}@talme.test`,
    phone: `33${String(stamp).slice(-8)}`
  };

  try {
    await registerHrUser(userA);
    await registerHrUser(userB);
    const headersA = await loginHrUser(userA);
    const headersB = await loginHrUser(userB);

    const create = await call("POST", "/api/hr/employees", employeePayload(employee), headersA);
    assert(create.status === 201, `Expected employee create 201, got ${create.status}: ${create.body.message || create.body.error}`);
    assert(create.body.employee.audit_action === "created", "Expected create audit action");
    assert(create.body.employee.audit_user_name === userA.name, "Expected Created by User A");
    assert(Boolean(create.body.employee.audit_at), "Expected create audit timestamp");

    const employeeId = create.body.employee.id;
    const editA = await call("PUT", `/api/hr/employees/${encodeURIComponent(employeeId)}`, employeePayload({
      ...employee,
      name: "Audit Test Employee A",
      designation: "Senior Engineer"
    }), headersA);
    assert(editA.status === 200, `Expected User A edit 200, got ${editA.status}: ${editA.body.message || editA.body.error}`);
    assert(editA.body.employee.audit_action === "edited", "Expected User A edit action");
    assert(editA.body.employee.audit_user_name === userA.name, "Expected Last edited by User A");

    const editB = await call("PUT", `/api/hr/employees/${encodeURIComponent(employeeId)}`, employeePayload({
      ...employee,
      name: "Audit Test Employee B",
      designation: "Principal Engineer"
    }), headersB);
    assert(editB.status === 200, `Expected User B edit 200, got ${editB.status}: ${editB.body.message || editB.body.error}`);
    assert(editB.body.employee.audit_action === "edited", "Expected User B edit action");
    assert(editB.body.employee.audit_user_name === userB.name, "Expected Last edited by User B");
    assert(Date.parse(editB.body.employee.audit_at) >= Date.parse(editA.body.employee.audit_at), "Expected newer User B audit timestamp");

    const refreshed = await call("GET", "/api/hr/employees", null, headersB);
    assert(refreshed.status === 200, `Expected employee list 200, got ${refreshed.status}: ${refreshed.body.message || refreshed.body.error}`);
    const refreshedEmployee = (refreshed.body.items || []).find(item => item.email === employee.email);
    assert(refreshedEmployee, "Expected employee after refresh");
    assert(refreshedEmployee.audit_action === "edited", "Expected persisted edited action after refresh");
    assert(refreshedEmployee.audit_user_name === userB.name, "Expected persisted Last edited by User B after refresh");
    assert(refreshedEmployee.audit_at === editB.body.employee.audit_at, "Expected persisted User B edit timestamp after refresh");

    console.log("Employee audit test passed: User A create/edit, User B edit, PostgreSQL-backed audit persisted after refresh.");
  } finally {
    await deleteAuthUserByEmail(userA.email).catch(() => {});
    await deleteAuthUserByEmail(userB.email).catch(() => {});
    db.prepare("DELETE FROM users WHERE lower(email) IN (lower(?), lower(?), lower(?))").run(userA.email, userB.email, employee.email);
    await closeAuthStore().catch(() => {});
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
