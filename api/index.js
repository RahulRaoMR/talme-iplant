const { requestHandler } = require("../src/server");

module.exports = async function handler(req, res) {
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
