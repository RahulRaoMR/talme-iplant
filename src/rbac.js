const ROLE_SLUGS = {
  SUPER_ADMIN: "super_admin",
  PLATFORM_ADMIN: "platform_admin",
  COMPANY_ADMIN: "company_admin",
  HR_MANAGER: "hr_manager",
  RECRUITER: "recruiter",
  TEAM_LEAD: "team_lead",
  EMPLOYEE: "employee",
  EMPLOYER: "employer",
  CANDIDATE: "candidate",
  GUEST: "guest"
};

const MODULES = {
  candidate: [
    ["jobs.search", "Search Jobs"],
    ["jobs.apply", "Apply Jobs"],
    ["resume.upload", "Upload Resume"],
    ["applications.track", "Track Applications"],
    ["ai.resume_builder", "AI Resume Builder"]
  ],
  employer: [
    ["jobs.post", "Post Jobs"],
    ["candidates.search", "Search Candidates"],
    ["resume_database.view", "Resume Database"],
    ["ats.access", "ATS"],
    ["company.dashboard", "Company Dashboard"],
    ["reports.view", "Reports"]
  ],
  recruiter: [
    ["pipeline.manage", "Candidate Pipeline"],
    ["interviews.manage", "Interview Management"],
    ["interviews.schedule", "Schedule Interviews"],
    ["candidate_notes.manage", "Candidate Notes"],
    ["email_candidates.send", "Email Candidates"]
  ],
  hr: [
    ["employees.manage", "Employees"],
    ["attendance.manage", "Attendance"],
    ["payroll.manage", "Payroll"],
    ["leaves.manage", "Leaves"],
    ["performance.manage", "Performance"],
    ["documents.manage", "Documents"],
    ["shifts.manage", "Shifts"]
  ],
  employee: [
    ["employee.dashboard", "Dashboard"],
    ["attendance.punch_in", "Punch In"],
    ["attendance.punch_out", "Punch Out"],
    ["attendance.view_self", "Attendance"],
    ["salary_slips.view_self", "Salary Slips"],
    ["leaves.request", "Leave Requests"],
    ["profile.view_self", "Profile"],
    ["documents.view_self", "Documents"]
  ],
  companyAdmin: [
    ["company.full_access", "Full Company Data Access"],
    ["employees.manage", "Employees"],
    ["recruiters.manage", "Recruiters"],
    ["jobs.manage", "Jobs"],
    ["payroll.manage", "Payroll"],
    ["attendance.manage", "Attendance"],
    ["leaves.manage", "Leaves"],
    ["reports.view", "Reports"],
    ["billing.manage", "Billing"]
  ],
  platformAdmin: [
    ["platform.companies.manage", "Manage Companies"],
    ["subscriptions.manage", "Manage Subscriptions"],
    ["companies.approve", "Approve Companies"],
    ["recruiters.approve", "Approve Recruiters"],
    ["analytics.view", "View Analytics"],
    ["support_tickets.manage", "Support Tickets"]
  ],
  security: [
    ["auth.device_history.view", "Device History"],
    ["auth.login_activity.view", "Login Activity"],
    ["auth.logout_all", "Logout From All Devices"],
    ["auth.two_factor.manage", "Two-Factor Authentication"],
    ["auth.password_reset", "Password Reset"],
    ["auth.email_verify", "Email Verification"],
    ["auth.phone_verify", "Phone Verification"]
  ],
  admin: [
    ["admin.users.manage", "Manage Users"],
    ["admin.roles.manage", "Manage Roles"],
    ["admin.permissions.manage", "Manage Permissions"],
    ["audit_logs.view", "Audit Logs"]
  ]
};

const PERMISSIONS = Object.values(MODULES)
  .flat()
  .reduce((unique, [key, description]) => {
    unique.set(key, { key, description, module: key.split(".")[0] });
    return unique;
  }, new Map());

const ROLE_DEFINITIONS = [
  {
    slug: ROLE_SLUGS.SUPER_ADMIN,
    name: "Super Admin",
    description: "Complete access to everything.",
    permissions: ["*"]
  },
  {
    slug: ROLE_SLUGS.PLATFORM_ADMIN,
    name: "Platform Admin",
    description: "Manage all companies, subscriptions, approvals, analytics, and support.",
    permissions: [
      ...MODULES.platformAdmin.map(([key]) => key),
      ...MODULES.security.map(([key]) => key),
      "audit_logs.view"
    ]
  },
  {
    slug: ROLE_SLUGS.COMPANY_ADMIN,
    name: "Company Admin",
    description: "Full access to company data.",
    permissions: [
      ...MODULES.companyAdmin.map(([key]) => key),
      ...MODULES.recruiter.map(([key]) => key),
      ...MODULES.hr.map(([key]) => key),
      ...MODULES.security.map(([key]) => key)
    ]
  },
  {
    slug: ROLE_SLUGS.HR_MANAGER,
    name: "HR Manager",
    description: "Manage HRMS modules.",
    permissions: [
      ...MODULES.hr.map(([key]) => key),
      ...MODULES.employee.map(([key]) => key),
      "reports.view",
      "auth.login_activity.view"
    ]
  },
  {
    slug: ROLE_SLUGS.RECRUITER,
    name: "Recruiter",
    description: "Manage hiring pipeline and candidate communication.",
    permissions: [
      ...MODULES.recruiter.map(([key]) => key),
      "candidates.search",
      "resume_database.view",
      "jobs.post"
    ]
  },
  {
    slug: ROLE_SLUGS.TEAM_LEAD,
    name: "Team Lead",
    description: "View team attendance, leaves, performance, and documents.",
    permissions: [
      "employee.dashboard",
      "attendance.view_self",
      "leaves.request",
      "performance.manage",
      "documents.view_self"
    ]
  },
  {
    slug: ROLE_SLUGS.EMPLOYEE,
    name: "Employee",
    description: "Employee self-service dashboard.",
    permissions: MODULES.employee.map(([key]) => key)
  },
  {
    slug: ROLE_SLUGS.EMPLOYER,
    name: "Employer",
    description: "Post jobs, search candidates, use ATS, and view company reports.",
    permissions: MODULES.employer.map(([key]) => key)
  },
  {
    slug: ROLE_SLUGS.CANDIDATE,
    name: "Candidate",
    description: "Find and apply to jobs.",
    permissions: MODULES.candidate.map(([key]) => key)
  },
  {
    slug: ROLE_SLUGS.GUEST,
    name: "Guest",
    description: "Unauthenticated visitor.",
    permissions: []
  }
];

const ROLE_REDIRECTS = {
  candidate: "/candidate/dashboard",
  employer: "/employer/dashboard",
  recruiter: "/recruiter/dashboard",
  employee: "/employee/dashboard",
  hr_manager: "/hr/dashboard",
  company_admin: "/company/dashboard",
  platform_admin: "/platform/dashboard",
  super_admin: "/admin/dashboard",
  team_lead: "/employee/dashboard",
  guest: "/"
};

const DASHBOARD_PERMISSIONS = {
  "/candidate/dashboard": "applications.track",
  "/employer/dashboard": "company.dashboard",
  "/recruiter/dashboard": "pipeline.manage",
  "/employee/dashboard": "employee.dashboard",
  "/hr/dashboard": "employees.manage",
  "/company/dashboard": "company.full_access",
  "/platform/dashboard": "platform.companies.manage",
  "/admin/dashboard": "admin.users.manage"
};

module.exports = {
  ROLE_SLUGS,
  ROLE_DEFINITIONS,
  PERMISSIONS: [...PERMISSIONS.values()],
  ROLE_REDIRECTS,
  DASHBOARD_PERMISSIONS
};
