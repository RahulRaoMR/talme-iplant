require("../src/load-env").loadLocalEnv();

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("Smoke test skipped: DATABASE_URL is required to verify PostgreSQL-backed authentication.");
    return;
  }
  const email = `smoke-${Date.now()}@talme.test`;
  const password = `Smoke-${Date.now()}-Aa1!`;
  const fixture = await require("./auth-test-database").createAuthTestDatabase();
  const server = require("../src/server");
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const registration = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "candidate",
        name: "Smoke Test User",
        email,
        phone: `7${String(Date.now()).slice(-9)}`,
        password,
        confirmPassword: password
      })
    });
    if (!registration.ok) throw new Error(`Registration failed: ${registration.status} ${await registration.text()}`);
    const pendingLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, role: "candidate" })
    });
    if (pendingLogin.status !== 403) throw new Error("Pending registration must not be able to log in");
    await fixture.pool.query("UPDATE auth_users SET approval_status = 'APPROVED', is_active = true WHERE email = $1 AND role = 'candidate'", [email]);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        password,
        role: "candidate",
        rememberMe: true
      })
    });
    if (!login.ok) throw new Error(`Login failed: ${login.status} ${await login.text()}`);
    const loginPayload = await login.json();

    const candidatePage = await fetch(`${baseUrl}/candidate/dashboard`, {
      headers: { Authorization: `Bearer ${loginPayload.accessToken}`, Accept: "application/json" }
    });
    if (!candidatePage.ok) throw new Error(`Candidate dashboard failed: ${candidatePage.status}`);

    const hrPage = await fetch(`${baseUrl}/hr/dashboard`, {
      headers: { Authorization: `Bearer ${loginPayload.accessToken}`, Accept: "application/json" }
    });
    if (hrPage.status !== 403) throw new Error(`Expected HR dashboard 403, got ${hrPage.status}`);

    const logoutAll = await fetch(`${baseUrl}/api/auth/logout-all`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${loginPayload.accessToken}`,
        "X-CSRF-Token": loginPayload.csrfToken,
        "Content-Type": "application/json"
      }
    });
    if (logoutAll.status !== 403) throw new Error(`Expected candidate logout-all 403, got ${logoutAll.status}`);

    console.log("Smoke test passed: login, allowed dashboard, forbidden dashboard, and permission middleware.");
  } finally {
    await new Promise(resolve => server.close(resolve));
    const { deleteAuthUserByEmail, closeAuthStore } = require("../src/auth-store");
    await deleteAuthUserByEmail(email);
    await closeAuthStore();
    require("../src/db").db.close();
    await fixture.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
