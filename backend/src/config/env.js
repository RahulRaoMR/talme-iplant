require("dotenv").config({ path: require("node:path").resolve(__dirname, "../../../.env") });

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.BACKEND_PORT || process.env.PORT || 5000),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "1d",
  corsOrigin: process.env.CORS_ORIGIN || "*",
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 100)
};

module.exports = env;
