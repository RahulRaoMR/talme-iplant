const { isIP } = require("node:net");
const ipaddr = require("ipaddr.js");
const { geoNaturalEarth1 } = require("d3-geo");
const countryNames = new Intl.DisplayNames(["en"], { type: "region" });
// Match the projection used to render public/admin-world-map.png (960 x 420).
const projection = geoNaturalEarth1().scale(146.36956152777995).translate([480, 206.8053252085659]);
const localRanges = new Set(["private", "loopback", "linkLocal", "uniqueLocal", "carrierGradeNat", "unspecified"]);

function normalizeIp(value) {
  const text = String(value || "").trim().replace(/^\[([^\]]+)\]$/, "$1").split("%")[0];
  return isIP(text) ? ipaddr.process(text).toString() : null;
}

function trustedProxy(value, networks) {
  return networks.some(network => {
    try {
      const address = ipaddr.parse(value);
      const [range, prefix] = ipaddr.parseCIDR(network.includes("/") ? network : `${network}/${isIP(network) === 6 ? 128 : 32}`);
      return address.kind() === range.kind() && address.match(range, prefix);
    } catch { return false; }
  });
}

function getClientIp(req, trust = process.env.TRUST_PROXY || "") {
  const peer = normalizeIp(req.socket?.remoteAddress);
  if (!peer) return "unknown";
  const networks = String(trust).split(",").map(value => value.trim()).filter(Boolean)
    .flatMap(value => value === "loopback" ? ["127.0.0.0/8", "::1/128"] : [value]);
  if (!trustedProxy(peer, networks)) return peer;
  // Walk from the socket toward the client; do not trust the leftmost header blindly.
  const chain = String(req.headers?.["x-forwarded-for"] || "").split(",").map(normalizeIp);
  let current = peer;
  for (let index = chain.length - 1; index >= 0 && trustedProxy(current, networks); index--) {
    if (!chain[index]) return peer;
    current = chain[index];
  }
  return current;
}

function resolveIpLocation(value, lookup = ip => require("geoip-lite").lookup(ip)) {
  const ip = normalizeIp(value);
  const empty = { ip, location: "Unknown", status: "unavailable", city: null, region: null, country: null, countryCode: null,
    latitude: null, longitude: null, mapX: null, mapY: null, source: "geoip-lite" };
  if (!ip) return { ...empty, status: "invalid" };
  const range = ipaddr.parse(ip).range();
  if (localRanges.has(range)) return { ...empty, location: "Local network", status: "local", source: "network" };
  if (range !== "unicast") return { ...empty, location: "Reserved IP", status: "reserved", source: "network" };
  let geo;
  try { geo = lookup(ip); } catch { return empty; }
  if (!geo || !/^[A-Z]{2}$/.test(geo.country || "")) return empty;
  const country = countryNames.of(geo.country);
  const city = String(geo.city || "").trim() || null;
  const [latitude, longitude] = geo.ll || [];
  const validCoordinates = Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180 && (latitude !== 0 || longitude !== 0);
  const point = validCoordinates ? projection([longitude, latitude]) : null;
  return { ...empty, status: "resolved", city, region: String(geo.region || "").trim() || null, country, countryCode: geo.country,
    location: [city, country].filter(Boolean).join(", "), latitude: validCoordinates ? latitude : null, longitude: validCoordinates ? longitude : null,
    mapX: point ? point[0] / 960 * 100 : null, mapY: point ? point[1] / 420 * 100 : null };
}

function ensureIpLocationTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ip_geolocations (
    ip_address TEXT PRIMARY KEY, location_json TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
}

function recordIpLocation(db, value, lookup) {
  const ip = normalizeIp(value);
  if (!ip) return resolveIpLocation(value, lookup);
  const cached = db.prepare("SELECT location_json, updated_at FROM ip_geolocations WHERE ip_address = ?").get(ip);
  if (cached) {
    try {
      const location = JSON.parse(cached.location_json);
      const ttl = location.status === "unavailable" ? 3600000 : 7 * 86400000;
      if (Date.now() - new Date(cached.updated_at).getTime() < ttl) return location;
    } catch { /* Refresh an invalid cached entry. */ }
  }
  const location = resolveIpLocation(ip, lookup);
  db.prepare("INSERT INTO ip_geolocations(ip_address,location_json,updated_at) VALUES(?,?,?) ON CONFLICT(ip_address) DO UPDATE SET location_json=excluded.location_json,updated_at=excluded.updated_at")
    .run(ip, JSON.stringify(location), new Date().toISOString());
  return location;
}

function backfillHistoryLocations(db, start, end) {
  ensureIpLocationTable(db);
  const ips = db.prepare("SELECT DISTINCT ip_address FROM login_history WHERE location_json IS NULL AND timestamp >= ? AND timestamp < ?").all(start, end);
  const update = db.prepare("UPDATE login_history SET location_json = ? WHERE location_json IS NULL AND ip_address IS ? AND timestamp >= ? AND timestamp < ?");
  for (const row of ips) update.run(JSON.stringify(recordIpLocation(db, row.ip_address)), row.ip_address, start, end);
}

function historyLocation(value) {
  try {
    const location = JSON.parse(value);
    if (location && typeof location.location === "string" && typeof location.status === "string") return location;
  } catch { /* Missing history remains explicitly unavailable. */ }
  return resolveIpLocation(null);
}

module.exports = { normalizeIp, getClientIp, resolveIpLocation, ensureIpLocationTable, recordIpLocation, backfillHistoryLocations, historyLocation };
