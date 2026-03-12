// ============================================================
// CivicAI - Rate Limiting
//
// NOTE: This file is intentionally minimal.
// All rate limiting is applied directly in server.js using
// the express-rate-limit package:
//
//   globalLimiter  — 300 req / 15 min on all /api/* routes
//   aiLimiter      — 20 req / min on AI-heavy endpoints
//   authLimiter    — 10 req / 15 min on /api/auth/login
//
// This in-memory implementation was replaced because it
// duplicated express-rate-limit and lacked proper IP trust
// configuration (x-forwarded-for behind proxies).
// ============================================================
