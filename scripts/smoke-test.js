const { spawn } = require("node:child_process");

require("../src/load-env").loadLocalEnv();

const baseUrl = `http://localhost:${process.env.PORT || 4000}`;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(proc) {
  for (let index = 0; index < 60; index += 1) {
    if (proc.exitCode != null) throw new Error("Server exited before becoming ready");
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      await wait(250);
    }
  }
  throw new Error("Server did not start in time");
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log("Smoke test skipped: DATABASE_URL is required to verify Neon-backed authentication.");
    return;
  }
  const email = `smoke-${Date.now()}@talme.test`;
  const password = `Smoke-${Date.now()}-Aa1!`;
  const proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/server.js"], {
    stdio: "inherit",
    env: { ...process.env, PORT: process.env.PORT || "4000" }
  });

  try {
    await waitForServer(proc);

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
    proc.kill();
    const { deleteAuthUserByEmail, closeAuthStore } = require("../src/auth-store");
    await deleteAuthUserByEmail(email);
    await closeAuthStore();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
