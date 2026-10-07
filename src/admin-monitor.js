const LOGIN_ACTIONS = "('Login', 'Registration Login', 'google Login', 'Google Login')";
const LOGOUT_ACTIONS = "('Logout', 'Logout from All Devices', 'Tab Closed Logout')";
const SESSION_ACTIONS = "('Login', 'Registration Login', 'google Login', 'Google Login', 'Logout', 'Logout from All Devices', 'Tab Closed Logout')";
const { backfillHistoryLocations, historyLocation } = require("./ip-location");
const { getDeviceType } = require("./security");
const DAY_MS = 86400000;
const IST_OFFSET_MS = 330 * 60000;

function monitoringRange(days = 7, at = new Date()) {
  days = Number(days);
  if (![1, 7, 30, 90].includes(days)) throw new RangeError("Choose a valid monitoring range.");
  const indiaDay = new Date(new Date(at).getTime() + IST_OFFSET_MS);
  indiaDay.setUTCHours(0, 0, 0, 0);
  const end = new Date(indiaDay.getTime() + DAY_MS - IST_OFFSET_MS);
  const start = new Date(end.getTime() - days * DAY_MS);
  return { start, end, days, timezone: "Asia/Kolkata",
    startDate: new Date(start.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10),
    endDate: indiaDay.toISOString().slice(0, 10) };
}

function adminTodayStats(db, at = new Date()) {
  const { start, end } = monitoringRange(1, at);
  const stats = db.prepare(`SELECT
    SUM(CASE WHEN success = 1 AND action IN ${LOGIN_ACTIONS} THEN 1 ELSE 0 END) AS totalLoggedInToday,
    SUM(CASE WHEN success = 1 AND action IN ${LOGOUT_ACTIONS} THEN 1 ELSE 0 END) AS totalLoggedOutToday,
    SUM(CASE WHEN success = 0 AND action = 'Failed Login' THEN 1 ELSE 0 END) AS failedLoginAttempts
    FROM login_history WHERE timestamp >= ? AND timestamp < ?`).get(start.toISOString(), end.toISOString());
  return Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, value || 0]));
}

function adminDeviceStats(db, at = new Date()) {
  const devices = db.prepare(`SELECT DISTINCT d.id, d.device, COALESCE(d.user_agent, s.user_agent, '') AS user_agent
    FROM sessions s JOIN devices d ON d.id = s.device_id
    WHERE s.revoked_at IS NULL AND s.expires_at > ?`).all(new Date(at).toISOString());
  const counts = { activeDevices: devices.length, desktopDevices: 0, mobileDevices: 0, tabletDevices: 0 };
  for (const device of devices) {
    const type = getDeviceType(device.user_agent, device.device);
    if (type !== "other") counts[`${type}Devices`]++;
  }
  return counts;
}

function adminActivity(db, days = 7, at = new Date()) {
  const { start, end, startDate, endDate, timezone, days: rangeDays } = monitoringRange(days, at);
  days = rangeDays;
  const parameters = [start.toISOString(), end.toISOString()];
  backfillHistoryLocations(db, ...parameters);
  const rows = db.prepare(`
    SELECT date(timestamp, '+330 minutes') AS day,
      SUM(CASE WHEN success = 1 AND action IN ${LOGIN_ACTIONS} THEN 1 ELSE 0 END) AS logins,
      SUM(CASE WHEN success = 1 AND action IN ${LOGOUT_ACTIONS} THEN 1 ELSE 0 END) AS logouts
    FROM login_history WHERE timestamp >= ? AND timestamp < ? GROUP BY date(timestamp, '+330 minutes')
  `).all(...parameters);
  const counts = new Map(rows.map(row => [row.day, row]));
  const activity = Array.from({ length: days }, (_, index) => {
    const day = new Date(`${startDate}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + index);
    const date = day.toISOString().slice(0, 10);
    return { date, logins: counts.get(date)?.logins || 0, logouts: counts.get(date)?.logouts || 0 };
  });
  const recentActivity = db.prepare(`
    SELECT h.id, u.name, COALESCE(h.email, u.email) AS email, h.action,
      h.device, h.browser, h.ip_address, h.timestamp, h.location_json
    FROM login_history h LEFT JOIN users u ON u.id = h.user_id
    WHERE h.timestamp >= ? AND h.timestamp < ? AND h.success = 1
      AND h.action IN ${SESSION_ACTIONS}
    ORDER BY h.timestamp DESC, h.id DESC LIMIT 100
  `).all(...parameters).map(({ location_json, ...row }) => ({ ...row, location: historyLocation(location_json).location, locationStatus: historyLocation(location_json).status }));
  const failedAttempts = db.prepare(`
    WITH failures AS (
      SELECT *, row_number() OVER (PARTITION BY email, ip_address ORDER BY timestamp DESC, id DESC) AS latest
      FROM login_history WHERE timestamp >= ? AND timestamp < ? AND success = 0 AND action = 'Failed Login'
    )
    SELECT email, ip_address, MAX(CASE WHEN latest = 1 THEN location_json END) AS location_json,
      COUNT(*) AS attempts, MAX(timestamp) AS timestamp
    FROM failures GROUP BY email, ip_address ORDER BY timestamp DESC LIMIT 100
  `).all(...parameters).map(({ location_json, ...row }) => ({ ...row, location: historyLocation(location_json).location, locationStatus: historyLocation(location_json).status }));
  const locationGroups = new Map();
  const locationSummary = { totalLogins: 0, locatedLogins: 0, localNetworkLogins: 0, reservedIpLogins: 0, unavailableLogins: 0 };
  const loginLocations = db.prepare(`SELECT location_json, COUNT(*) AS logins, group_concat(DISTINCT user_id) AS user_ids
    FROM login_history WHERE timestamp >= ? AND timestamp < ? AND success = 1 AND action IN ${LOGIN_ACTIONS}
    GROUP BY location_json`).all(...parameters);
  for (const row of loginLocations) {
    const location = historyLocation(row.location_json);
    locationSummary.totalLogins += row.logins;
    if (location.status !== "resolved") {
      locationSummary[location.status === "local" ? "localNetworkLogins" : location.status === "reserved" ? "reservedIpLogins" : "unavailableLogins"] += row.logins;
      continue;
    }
    locationSummary.locatedLogins += row.logins;
    const key = JSON.stringify([location.city, location.region, location.countryCode]);
    if (!locationGroups.has(key)) {
      const { ip, ...details } = location;
      locationGroups.set(key, { ...details, logins: 0, userIds: new Set() });
    }
    const group = locationGroups.get(key);
    group.logins += row.logins;
    String(row.user_ids || "").split(",").filter(Boolean).forEach(id => group.userIds.add(id));
  }
  const locations = [...locationGroups.values()].map(({ userIds, ...group }) => ({ ...group, users: userIds.size }))
    .sort((a, b) => b.logins - a.logins || a.location.localeCompare(b.location));
  return {
    activity, recentActivity, failedAttempts,
    range: { days, start: startDate, end: endDate, timezone },
    locations: locations.slice(0, 50), locationAvailable: locations.length > 0, locationSummary
  };
}

module.exports = { adminActivity, adminTodayStats, adminDeviceStats, monitoringRange, LOGIN_ACTIONS, LOGOUT_ACTIONS };
