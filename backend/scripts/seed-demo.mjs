// Reload the SYNTHETIC demonstration dataset into the configured database.
// Usage: DB_PATH=./civicai.db node scripts/seed-demo.mjs
import dotenv from 'dotenv'; dotenv.config();
const { initDatabase, persistNow } = await import('../database/db.js');
const dev = await import('../database/devdb.js');
const { ensureDemoData } = await import('../demo/loadDemo.js');
await initDatabase(); dev.initDevSchema();
const r = await ensureDemoData({ force: true });
persistNow();
console.log('Demo dataset loaded:', JSON.stringify(r));
setTimeout(() => process.exit(0), 600);
