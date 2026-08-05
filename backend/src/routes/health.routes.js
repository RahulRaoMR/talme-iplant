const router = require("express").Router();
const { healthCheck } = require("../controllers/health.controller");

router.get("/health", healthCheck);

module.exports = router;
