const assert = require("node:assert/strict");
require("../src/load-env").loadLocalEnv();
process.env.DATABASE_URL = "postgresql://fixture.invalid/registered-users-test";
const pg = require("pg");
const OriginalPool = pg.Pool;
const queries = [];
pg.Pool = class {
  async query(sql) {
    queries.push(sql);
    assert.match(sql, /FROM auth_users/);
    assert.doesNotMatch(sql, /password_hash|hr_employee_records/);
    return sql.includes("COUNT(*)")
      ? { rows: [{ totalRegisteredUsers: 10, totalActiveUsers: 8 }] }
      : { rows: [{ id: 1, name: "Test User", email: "test@example.test", roles: "hr_manager", status: "active", created_at: "2026-10-05T00:00:00Z" }] };
  }
  async end() {}
};
const store = require("../src/auth-store");
pg.Pool = OriginalPool;

(async () => {
  try {
    assert.deepEqual(await store.getRegisteredUserCounts(), { totalRegisteredUsers: 10, totalActiveUsers: 8 });
    assert.match(queries[0], /COUNT\(\*\)::int AS "totalRegisteredUsers"/);
    assert.match(queries[0], /FILTER \(WHERE is_active AND approval_status = 'APPROVED'\)/);
    assert.match(queries[0], /WHERE approval_status <> 'DELETED'/);
    assert.doesNotMatch(queries[0], /DISTINCT|LIMIT/);
    const items = await store.listRegisteredUsers();
    assert.equal(items.length, 1);
    assert.equal(items[0].status, "active");
    assert.match(queries[1], /full_name AS name/);
    assert.match(queries[1], /approval_status AS status/);
    assert.match(queries[1], /ORDER BY created_at DESC, id DESC/);
    console.log("Registered-user store tests passed: authoritative auth_users counts, enabled accounts, safe list fields, and role-specific registrations.");
  } finally { await store.closeAuthStore(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
