// Minimal shared test harness (no external test runner required).
export function createHarness(title) {
  let passed = 0, failed = 0; const failures = [];
  const results = [];
  return {
    async test(name, fn) {
      try { await fn(); console.log(`  PASS  ${name}`); passed++; results.push({ name, ok: true }); }
      catch (e) { console.error(`  FAIL  ${name}\n        ${e.message}`); failed++; failures.push(name); results.push({ name, ok: false, error: e.message }); }
    },
    section(t) { console.log(`\n[${t}]`); },
    summary() {
      console.log(`\n${title}: ${passed} passed, ${failed} failed`);
      if (failed) console.log('Failed:', failures.join(', '));
      return { passed, failed, results };
    }
  };
}
export const assert = {
  ok(v, msg = 'expected truthy') { if (!v) throw new Error(msg); },
  eq(a, b, msg) { if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
  near(a, b, eps = 1e-6, msg) { if (Math.abs(a - b) > eps) throw new Error(msg || `expected ~${b}, got ${a}`); },
  gt(a, b, msg) { if (!(a > b)) throw new Error(msg || `expected ${a} > ${b}`); },
  gte(a, b, msg) { if (!(a >= b)) throw new Error(msg || `expected ${a} >= ${b}`); },
  lt(a, b, msg) { if (!(a < b)) throw new Error(msg || `expected ${a} < ${b}`); },
  includes(s, sub, msg) { if (!String(s).includes(sub)) throw new Error(msg || `expected "${s}" to include "${sub}"`); },
  notIncludes(s, sub, msg) { if (String(s).includes(sub)) throw new Error(msg || `expected text not to include "${sub}"`); },
  async throws(fn, msg) { try { await fn(); } catch { return; } throw new Error(msg || 'expected function to throw'); }
};
