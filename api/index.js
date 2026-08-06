const { requestHandler } = require("../src/server");

module.exports = async function handler(req, res) {
  const rewritePath = req.query?.path;
  if (rewritePath && new URL(req.url, "http://localhost").pathname === "/api") {
    const segments = Array.isArray(rewritePath) ? rewritePath : String(rewritePath).split("/");
    const url = new URL(req.url, "http://localhost");
    url.searchParams.delete("path");
    const query = url.searchParams.toString();
    req.url = `/api/${segments.map(segment => encodeURIComponent(segment)).join("/")}${query ? `?${query}` : ""}`;
  }
  return requestHandler(req, res);
};
