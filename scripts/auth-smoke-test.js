const { Readable } = require("node:stream");
let requestHandler;

require("../src/load-env").loadLocalEnv();

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
      "user-agent": "auth-smoke-test",
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

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("Auth smoke test skipped: DATABASE_URL is required to verify Neon-backed authentication.");
    return;
  }
  ({ requestHandler } = require("../src/server"));
  const { deleteAuthUserByEmail, closeAuthStore } = require("../src/auth-store");
  const email = `auth-test-${Date.now()}@talme.test`;
  const adminEmail = email;
  const phone = `9${String(Date.now()).slice(-9)}`;
  const adminPhone = `7${String(Date.now()).slice(-9)}`;
  const password = `Smoke-${Date.now()}-Aa1!`;

  try {
    const registration = await call("POST", "/api/auth/register", {
      type: "talme_hr",
      name: "Auth Test User",
      email,
      phone,
      password,
      confirmPassword: password
    });
    assert(registration.status === 201, `Expected registration 201, got ${registration.status}`);
    assert(registration.body.success === true, "Expected registration success true");

    const adminRegistration = await call("POST", "/api/auth/register", {
      type: "admin",
      name: "Auth Admin Test User",
      email: adminEmail,
      phone: adminPhone,
      password,
      confirmPassword: password
    });
    assert(adminRegistration.status === 201, `Expected admin registration 201, got ${adminRegistration.status}`);
    assert(adminRegistration.body.success === true, "Expected admin registration success true");

    const duplicate = await call("POST", "/api/auth/register", {
      type: "talme_hr",
      name: "Auth Test User",
      email: email.toUpperCase(),
      phone: `8${String(Date.now()).slice(-9)}`,
      password,
      confirmPassword: password
    });
    assert(duplicate.status === 409, `Expected duplicate 409, got ${duplicate.status}`);
    assert(duplicate.body.message === "This email is already registered for the selected login page.", "Expected duplicate email message");

    const login = await call("POST", "/api/auth/login", {
      email,
      password: ` ${password} `,
      role: "hr_manager",
      rememberMe: true
    });
    assert(login.status === 200, `Expected login 200, got ${login.status}`);
    assert(login.body.success === true, "Expected login success true");
    assert(Boolean(login.body.accessToken), "Expected JWT accessToken after login");
    assert(login.body.user?.redirectTo === "/hr/dashboard", "Expected HR dashboard redirect");

    const adminLogin = await call("POST", "/api/auth/login", {
      email: adminEmail,
      password: ` ${password} `,
      role: "super_admin"
    });
    assert(adminLogin.status === 200, `Expected admin login 200, got ${adminLogin.status}`);
    assert(adminLogin.body.user?.redirectTo === "/admin/dashboard", "Expected admin dashboard redirect");

    const missing = await call("POST", "/api/auth/login", {
      email: `missing-${Date.now()}@talme.test`,
      password,
      role: "hr_manager"
    });
    assert(missing.status === 404, `Expected missing account 404, got ${missing.status}`);
    assert(missing.body.message === "Account not found. Please register first.", "Expected missing account message");

    const wrongPassword = await call("POST", "/api/auth/login", {
      email,
      password: `Wrong-${Date.now()}-Aa1!`,
      role: "hr_manager"
    });
    assert(wrongPassword.status === 401, `Expected wrong password 401, got ${wrongPassword.status}`);
    assert(wrongPassword.body.message === "Invalid password.", "Expected wrong password message");

    const invalidJwt = await call("GET", "/api/me", null, {
      authorization: "Bearer invalid.jwt.token"
    });
    assert(invalidJwt.status === 401, `Expected invalid JWT 401, got ${invalidJwt.status}`);

    console.log("Auth smoke test passed: same-email HR/Admin registration, same-role duplicate rejection, role-specific login, missing account, wrong password, JWT rejection.");
  } finally {
    await deleteAuthUserByEmail(email);
    await closeAuthStore();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
