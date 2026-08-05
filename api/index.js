const { requestHandler } = require("../src/server");

module.exports = async function handler(req, res) {
  return requestHandler(req, res);
};
