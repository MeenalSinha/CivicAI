// ============================================================
// CivicAI - Authentication
//
// NOTE: This file is intentionally minimal.
// All authentication is handled directly in server.js via JWT:
//   - requireAuth() middleware uses jsonwebtoken + JWT_SECRET
//   - Issued via POST /api/auth/login (bcrypt password check)
//
// The plain API key approach (OFFICER_API_KEY) was removed
// because it provided no expiry, rotation, or per-user identity.
// ============================================================

// Re-export nothing — auth is in server.js.
// This file is kept to avoid breaking any future imports.
