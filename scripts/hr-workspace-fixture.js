const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

async function createHrWorkspaceFixture() {
  const fixture = await require("./auth-test-database").createAuthTestDatabase();
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), "talme-hr-check-"));
  process.env.CV_UPLOAD_DIR = uploadDir;
  let server;
  try {
    const namespace = (await fixture.pool.query("SELECT current_schema() AS name")).rows[0].name;
    assert.match(namespace, /^auth_test_[a-f0-9]+$/);
    const extension = (await fixture.pool.query("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_trgm'")).rows[0];
    assert(extension, "The search database must have pg_trgm installed");
    const operator = `"${extension.nspname.replaceAll('"', '""')}".gin_trgm_ops`;
    for (const name of ["20260810133000_create_employee_record_audits", "20260813110000_create_hr_employee_records", "20260814100000_add_hr_employee_resume_s3_key", "20260918110000_add_hr_employee_resume_search"]) {
      const sql = fs.readFileSync(path.join(__dirname, "../backend/prisma/migrations", name, "migration.sql"), "utf8")
        .replace("CREATE EXTENSION IF NOT EXISTS pg_trgm;", "")
        .replaceAll(" gin_trgm_ops", ` ${operator}`);
      await fixture.pool.query(sql);
    }
    for (const role of ["hr_manager", "candidate"]) {
      await fixture.pool.query(`INSERT INTO auth_users (full_name,email,phone,password_hash,role,is_active,approval_status)
        SELECT $1,$2,$3,password_hash,$4,true,'APPROVED' FROM auth_users WHERE email=$5`,
      [role, `${role}@workspace-check.example.test`, role === "hr_manager" ? "9000000012" : "9000000013", role, fixture.admin.email]);
    }
    server = require("../src/server");
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    async function request(url, { method = "GET", body, session, headers = {} } = {}) {
      const multipart = body instanceof FormData;
      const response = await fetch(`${baseUrl}${url}`, { method, headers: {
        ...(body && !multipart ? { "Content-Type": "application/json" } : {}),
        ...(session ? { Authorization: `Bearer ${session.accessToken}`, "X-CSRF-Token": session.csrfToken } : {}), ...headers
      }, body: body == null ? undefined : multipart ? body : JSON.stringify(body) });
      const data = await response.json();
      return { status: response.status, body: data };
    }
    async function login(role) {
      const result = await request("/api/auth/login", { method: "POST", body: { email: `${role}@workspace-check.example.test`, password: fixture.admin.password, role } });
      assert.equal(result.status, 200, JSON.stringify(result.body));
      return result.body;
    }
    const hr = await login("hr_manager");
    const candidate = await login("candidate");
    const items = Array.from({ length: 45 }, (_, index) => {
      const kind = index % 5;
      return {
        source_id: `fixture-${String(index + 1).padStart(3, "0")}`, name: ["Asha Java", "Bala Python", "Chitra Fresher", "Deepa Frontend", "Esha Unknown"][kind] + ` ${index + 1}`,
        email: `fixture-${index + 1}@workspace-check.example.test`, phone: `811000${String(index + 1).padStart(4, "0")}`,
        location: ["Bangalore", "Pune", "Hyderabad", "Chennai", "Mumbai"][kind],
        keywords: ["Java, Spring Boot, SQL", "Python, SQL", "Java, SQL", "React, JavaScript", "Node.js, AWS"][kind],
        experience: [3.5, 8, 0, 2, null][kind], company: ["TCS", "Infosys", "TCS", "Wipro", "Unknown"][kind],
        designation: ["Software Engineer", "Data Analyst", "Trainee", "Frontend Developer", "Employee"][kind],
        cv: kind % 2 === 0 ? "fixture.pdf" : null,
        metadata: { data: { salary_lpa: [8, 15, 0, 7, null][kind], employment_type: "permanent", notice_period_days: 30,
          willing_to_relocate: true, preferred_locations: "Delhi, Pune", degree: "B.Tech", institution: "VTU", graduation_year: 2020,
          gender: kind % 2 ? "female" : "male", disability_status: false, age: 27, last_active_at: new Date().toISOString() } }
      };
    });
    await fixture.pool.query(`INSERT INTO hr_employee_records
      (record_key,source_type,source_id,employee_code,name,email,phone,location,keywords,experience,current_company,current_designation,department,cv_file_name,source_payload)
      SELECT 'test:'||source_id,'imported',source_id,source_id,name,email,phone,location,keywords,experience,company,designation,'Engineering',cv,metadata
      FROM jsonb_to_recordset($1::jsonb) AS x(source_id text,name text,email text,phone text,location text,keywords text,experience float,company text,designation text,cv text,metadata jsonb)`, [JSON.stringify(items)]);
    return { ...fixture, server, baseUrl, request, hr, candidate, items, uploadDir, async close() {
      await new Promise(resolve => server.close(resolve));
      await require("../src/employee-store").closeEmployeeStore();
      await require("../src/auth-store").closeAuthStore();
      require("../src/db").db.close();
      for (const file of fs.readdirSync(uploadDir)) fs.unlinkSync(path.join(uploadDir, file));
      fs.rmdirSync(uploadDir);
      await fixture.close();
    } };
  } catch (error) {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (server) {
      await require("../src/employee-store").closeEmployeeStore();
      await require("../src/auth-store").closeAuthStore();
      require("../src/db").db.close();
    }
    fs.rmdirSync(uploadDir);
    await fixture.close();
    throw error;
  }
}

module.exports = { createHrWorkspaceFixture };
