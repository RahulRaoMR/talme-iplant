module.exports = async function handler(req, res) {
  let requestHandler;
  try {
    ({ requestHandler } = require("../src/server"));
  } catch (error) {
    console.error("API startup failed", error);
    const knownErrors = ["MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND", "ERR_REQUIRE_ESM", "ERR_REQUIRE_ASYNC_MODULE", "EROFS", "EACCES"];
    let code = knownErrors.includes(error.code) ? error.code : "STARTUP_FAILED";
    if (/geoNaturalEarth1/.test(error.message)) code = "MAP_PROJECTION_UNAVAILABLE";
    if (/JWT_SECRET/.test(error.message)) code = "AUTH_CONFIGURATION_REQUIRED";
    res.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ error: "Service temporarily unavailable", code }));
    return;
  }
  const requestUrl = new URL(req.url, "http://localhost");
  const rewritePath = req.query?.path || requestUrl.searchParams.get("path");
  if (rewritePath) {
    const segments = Array.isArray(rewritePath) ? rewritePath : String(rewritePath).split("/");
    requestUrl.searchParams.delete("path");
    const query = requestUrl.searchParams.toString();
    req.url = `/api/${segments.map(segment => encodeURIComponent(segment)).join("/")}${query ? `?${query}` : ""}`;
  }
  return requestHandler(req, res);
};
