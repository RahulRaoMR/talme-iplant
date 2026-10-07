module.exports = function health(req, res) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ status: "ok", release: "20261007-dashboard-release" }));
};
