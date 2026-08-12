const { requestHandler } = require("../src/server");

module.exports = async function handler(req, res) {
  const rewritePath = req.query?.path;
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (rewritePath && (pathname === "/api" || pathname === "/api/index")) {
    const segments = Array.isArray(rewritePath) ? rewritePath : String(rewritePath).split("/");
    const url = new URL(req.url, "http://localhost");
    url.searchParams.delete("path");
    const query = url.searchParams.toString();
    req.url = `/api/${segments.map(segment => encodeURIComponent(segment)).join("/")}${query ? `?${query}` : ""}`;
  }
  return requestHandler(req, res);
};
