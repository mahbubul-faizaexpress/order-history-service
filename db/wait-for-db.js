'use strict';

// Blocks until Postgres accepts a connection, so `db:setup` and the test harness
// work even if run immediately after `docker compose up` (before the container
// finishes booting). Give up after ~30s.

const { Client } = require('pg');
require('dotenv').config();

const url = process.argv.includes('--test')
  ? process.env.TEST_DATABASE_URL
  : process.env.DATABASE_URL;

const DEADLINE = Date.now() + 30_000;

async function attempt() {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

(async () => {
  if (!url) {
    console.error('No database URL in the environment — copy .env.example to .env');
    process.exit(1);
  }
  for (let i = 1; ; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await attempt()) {
      if (i > 1) console.log('database is ready');
      return;
    }
    if (Date.now() > DEADLINE) {
      console.error('database did not become ready in 30s — is `docker compose up -d` running?');
      process.exit(1);
    }
    process.stdout.write('waiting for database...\r');
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 1000));
  }
})();
