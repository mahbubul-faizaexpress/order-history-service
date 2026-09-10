'use strict';

// Applies schema.sql then runs the seed. Idempotent: schema.sql drops first.
// Usage: node db/setup.js            -> uses DATABASE_URL
//        node db/setup.js --test     -> uses TEST_DATABASE_URL, skips seed

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

const useTest = process.argv.includes('--test');
const connectionString = useTest
  ? process.env.TEST_DATABASE_URL
  : process.env.DATABASE_URL;

async function main() {
  if (!connectionString) {
    throw new Error(
      `Missing ${useTest ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} — copy .env.example to .env`,
    );
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(schema);
    console.log(`schema applied to ${useTest ? 'test' : 'primary'} database`);
  } finally {
    await client.end();
  }

  if (!useTest) {
    await require('./seed').seed(connectionString);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
