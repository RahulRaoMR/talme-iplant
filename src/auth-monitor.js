const { monitoringRange } = require("./admin-monitor");
const { resolveIpLocation } = require("./ip-location");
const { getDeviceName, getBrowser, getDeviceType, sha256 } = require("./security");
const { sessionTimeoutSeconds } = require("./config");

const sessionSelect = `SELECT s.id AS session_id, u.id::text AS id, u.full_name AS name,
  s.email, s.role AS roles, s.ip_address, s.user_agent, s.created_at, s.last_seen_at,
  s.expires_at, s.revoked_at, s.logout_reason, s.location_json,
  LEAST(s.expires_at, CASE WHEN s.remember_me THEN s.expires_at
    ELSE s.last_seen_at + ($5 * INTERVAL '1 second') END) AS effective_expires_at
  FROM auth_sessions s CROSS JOIN (SELECT $1::timestamptz AS range_start, $2::timestamptz AS range_end,
    $3::timestamptz AS observed_at, $4::timestamptz AS live_cutoff) clock
  LEFT JOIN auth_users u ON LOWER(u.email)=LOWER(s.email) AND u.role=s.role`;
const eventsSelect = `SELECT 'login:' || session_id AS event_id, name, email, roles, 'Login'::text AS action,
  'login'::text AS event_type, ip_address, user_agent, location_json, created_at AS timestamp FROM member_sessions
  UNION ALL SELECT 'logout:' || session_id, name, email, roles, COALESCE(logout_reason, 'Session ended'),
  'logout', ip_address, user_agent, location_json, revoked_at FROM member_sessions WHERE revoked_at IS NOT NULL`;

function locationDetails(row) {
  const location = row.location_json && typeof row.location_json === "object" ? row.location_json : resolveIpLocation(row.ip_address);
  return { location: location.location, locationStatus: location.status };
}

function sessionDetails(row, at) {
  const { user_agent, location_json, effective_expires_at, ...safe } = row;
  const expired = new Date(effective_expires_at) <= at;
  return { ...safe, device: getDeviceName(user_agent), browser: getBrowser(user_agent), ...locationDetails(row),
    session_status: row.revoked_at ? "Logged out" : expired ? "Expired" : new Date(row.last_seen_at).getTime() >= at.getTime() - 300000 ? "Online" : "Active",
    expired_at: !row.revoked_at && expired ? effective_expires_at : null };
}

async function recordLoginAttempt(pool, event) {
  if (!pool) return;
  await pool.query(`INSERT INTO auth_login_attempts(email,role,reason,ip_address,device,browser,location_json,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::timestamptz)`, [event.email || null, event.role || null, event.reason || null,
    event.ip, event.device, event.browser, JSON.stringify(event.location), event.timestamp || new Date().toISOString()]);
}

async function persistentMonitoring(pool, query = {}, at = new Date()) {
  if (!pool) return null;
  const range = monitoringRange(query.days || 7, at);
  const parameters = [range.start, range.end, at, new Date(at.getTime() - 300000), sessionTimeoutSeconds];
  const cte = `WITH member_sessions AS (${sessionSelect}), events AS (${eventsSelect})`;
  const match = `((created_at >= $1 AND created_at < $2) OR (revoked_at >= $1 AND revoked_at < $2))
    AND ($6 = '' OR POSITION(LOWER($6) IN LOWER(concat_ws(' ',name,email,roles,ip_address,user_agent,location_json::text))) > 0)`;
  const search = String(query.search || "").trim().slice(0, 200);
  const limit = Math.min(100, Math.max(1, Math.floor(Number(query.limit) || 50)));
  const count = await pool.query(`WITH member_sessions AS (${sessionSelect}) SELECT COUNT(*)::int AS total FROM member_sessions WHERE ${match}`,
    [...parameters, search]);
  const total = count.rows[0].total;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(totalPages, Math.max(1, Math.floor(Number(query.page) || 1)));
  const results = await Promise.all([
    pool.query(`${cte} SELECT to_char(timestamp AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS date,
      COUNT(*) FILTER(WHERE event_type='login')::int AS logins, COUNT(*) FILTER(WHERE event_type='logout')::int AS logouts
      FROM events WHERE timestamp >= $1 AND timestamp < $2 GROUP BY 1 ORDER BY 1`, parameters),
    pool.query(`${cte} SELECT * FROM events WHERE timestamp >= $1 AND timestamp < $2 ORDER BY timestamp DESC,event_id DESC LIMIT 100`, parameters),
    pool.query(`WITH member_sessions AS (${sessionSelect}) SELECT * FROM member_sessions WHERE ${match}
      ORDER BY created_at DESC,session_id DESC LIMIT $7 OFFSET $8`, [...parameters, search, limit, (page - 1) * limit]),
    pool.query(`SELECT email,ip_address,COUNT(*)::int AS attempts,MAX(created_at) AS timestamp,
      (array_agg(location_json ORDER BY created_at DESC,id DESC))[1] AS location_json
      FROM auth_login_attempts WHERE created_at >= $1 AND created_at < $2 GROUP BY email,ip_address ORDER BY timestamp DESC LIMIT 100`, parameters.slice(0, 2)),
    pool.query(`WITH member_sessions AS (${sessionSelect}) SELECT * FROM member_sessions
      WHERE revoked_at IS NULL AND effective_expires_at > $3`, parameters),
    pool.query(`WITH member_sessions AS (${sessionSelect}) SELECT ip_address,location_json,COUNT(*)::int AS logins,
      array_agg(DISTINCT LOWER(email) || ':' || COALESCE(roles,'')) AS user_ids FROM member_sessions
      WHERE created_at >= $1 AND created_at < $2 GROUP BY ip_address,location_json`, parameters),
    pool.query(`${cte} SELECT COUNT(*) FILTER(WHERE event_type='login')::int AS "totalLoggedInToday",
      COUNT(*) FILTER(WHERE event_type='logout')::int AS "totalLoggedOutToday" FROM events WHERE timestamp >= $6 AND timestamp < $2`,
      [...parameters, monitoringRange(1, at).start]),
    pool.query("SELECT COUNT(*)::int AS total FROM auth_login_attempts WHERE created_at >= $1 AND created_at < $2", [monitoringRange(1, at).start, range.end])
  ]);
  const [daily, recent, sessions, failures, active, locations, today, failedToday] = results;
  const days = new Map(daily.rows.map(row => [row.date, row]));
  const activity = Array.from({ length: range.days }, (_, index) => {
    const date = new Date(range.start.getTime() + 330 * 60000 + index * 86400000).toISOString().slice(0, 10);
    return days.get(date) || { date, logins: 0, logouts: 0 };
  });
  const deviceGroups = new Map(active.rows.map(row => [JSON.stringify([row.email.toLowerCase(), row.roles, row.ip_address, row.user_agent]), row]));
  const deviceStats = { activeDevices: deviceGroups.size, desktopDevices: 0, mobileDevices: 0, tabletDevices: 0 };
  for (const device of deviceGroups.values()) {
    const type = getDeviceType(device.user_agent);
    if (type !== "other") deviceStats[`${type}Devices`]++;
  }
  const groups = new Map();
  const locationSummary = { totalLogins: 0, locatedLogins: 0, localNetworkLogins: 0, reservedIpLogins: 0, unavailableLogins: 0 };
  for (const row of locations.rows) {
    const location = row.location_json || resolveIpLocation(row.ip_address);
    locationSummary.totalLogins += row.logins;
    if (location.status !== "resolved") {
      locationSummary[location.status === "local" ? "localNetworkLogins" : location.status === "reserved" ? "reservedIpLogins" : "unavailableLogins"] += row.logins;
      continue;
    }
    locationSummary.locatedLogins += row.logins;
    const key = JSON.stringify([location.city,location.region,location.countryCode]);
    if (!groups.has(key)) {
      const { ip, ...safe } = location;
      groups.set(key, { ...safe, logins: 0, userIds: new Set() });
    }
    const group = groups.get(key); group.logins += row.logins;
    row.user_ids.forEach(id => group.userIds.add(id));
  }
  const groupedLocations = [...groups.values()].map(({ userIds, ...row }) => ({ ...row, users: userIds.size })).sort((a,b) => b.logins-a.logins);
  const liveOnlineUsers = active.rows.filter(row => new Date(row.last_seen_at).getTime() >= at.getTime() - 300000).map(row => sessionDetails(row, at));
  return { activity, recentActivity: recent.rows.map(({ user_agent, location_json, ...row }) => ({ ...row,
    device: getDeviceName(user_agent), browser: getBrowser(user_agent), ...locationDetails({ ip_address: row.ip_address, location_json }) })),
    sessionDetails: sessions.rows.map(row => sessionDetails(row, at)),
    activityPagination: { page, limit, total, totalPages },
    failedAttempts: failures.rows.map(({ location_json, ...row }) => ({ ...row, ...locationDetails({ ip_address: row.ip_address, location_json }) })),
    liveOnlineUsers, onlineUsers: liveOnlineUsers,
    stats: { ...deviceStats, ...today.rows[0], failedLoginAttempts: failedToday.rows[0].total,
      liveOnlineUsers: new Set(liveOnlineUsers.map(row => `${row.email.toLowerCase()}:${row.roles}`)).size },
    locations: groupedLocations, locationSummary, locationAvailable: groupedLocations.length > 0,
    range: { days: range.days, start: range.startDate, end: range.endDate, timezone: range.timezone }, source: "persistent-auth-sessions" };
}

async function persistentDevices(pool) {
  if (!pool) return null;
  const rows = await pool.query(`SELECT s.email,s.role AS roles,u.full_name AS name,s.ip_address,s.user_agent,
    MIN(s.created_at) AS created_at, MAX(s.last_seen_at) AS last_seen_at,
    COUNT(*) FILTER(WHERE s.revoked_at IS NULL AND s.expires_at > NOW()
      AND (s.remember_me OR s.last_seen_at > NOW() - ($1 * INTERVAL '1 second')))::int AS active_sessions
    FROM auth_sessions s LEFT JOIN auth_users u ON LOWER(u.email)=LOWER(s.email) AND u.role=s.role
    GROUP BY s.email,s.role,u.full_name,s.ip_address,s.user_agent ORDER BY last_seen_at DESC LIMIT 200`, [sessionTimeoutSeconds]);
  return rows.rows.map(({ user_agent, ...row }) => ({ ...row, id: sha256(JSON.stringify([row.email,row.roles,row.ip_address,user_agent])),
    device: getDeviceName(user_agent), browser: getBrowser(user_agent) }));
}

module.exports = { recordLoginAttempt, persistentMonitoring, persistentDevices };
