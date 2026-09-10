'use strict';

// `npm pretest` hook: applies migrations to the test database before the suite
// runs. Prisma reads DATABASE_URL, so we point it at TEST_DATABASE_URL here.

const { execFileSync } = require('child_process');
require('dotenv').config();

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) {
  console.error('Missing TEST_DATABASE_URL — copy .env.example to .env');
  process.exit(1);
}

// Invoke the Prisma CLI entry point with the current node binary, so this works
// the same on Windows and POSIX without a shell.
const prismaCli = require.resolve('prisma/build/index.js');
execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: testUrl },
});
