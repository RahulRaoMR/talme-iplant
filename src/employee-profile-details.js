const WORK_DETAIL_FIELDS = {
  employmentType: "employment_type",
  joiningDate: "joining_date",
  noticePeriod: "notice_period",
  reportingManager: "reporting_manager",
  currentCtc: "current_ctc",
  expectedCtc: "expected_ctc"
};

function employeeProfileDetails(record = {}) {
  record = record || {};
  record = { ...record, ...record.data, ...record.body, profile_details: record.profile_details };
  let details = record.profile_details || {};
  if (typeof details === "string") {
    try { details = JSON.parse(details); } catch { details = {}; }
  }
  return Object.fromEntries(Object.entries(WORK_DETAIL_FIELDS).map(([alias, key]) => {
    const legacy = key === "current_ctc" ? record.current_ctc_lpa ?? record.salary_lpa
      : key === "notice_period" ? record.notice_period_days ?? record.noticePeriodDays : null;
    const value = Object.hasOwn(details || {}, key) ? details[key] : record[key] ?? record[alias] ?? legacy;
    return [key, value == null ? null : String(value).trim() || null];
  }));
}

module.exports = { WORK_DETAIL_FIELDS, employeeProfileDetails };
