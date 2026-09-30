// Thin bridge so views.js can read legacy complaint outcomes without importing officer PII.
// Only status + timestamps leave this function.
import { getAllComplaints } from '../database/db.js';
export function getComplaintsForOutcomes() {
  return getAllComplaints().map(c => ({ status: c.status, timestamp: c.timestamp, updatedAt: c.updatedAt || c.timestamp }));
}
