'use strict';

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const config = require('./config');

// Prisma 7 talks to Postgres through a driver adapter. The `pg` pool config is
// ours to own here:
//   - `max`                     : bounds concurrency (see DECISIONS.md, scale)
//   - `statement_timeout`        : a runaway query cannot hold a connection forever
//   - `connectionTimeoutMillis`  : fail fast instead of queueing forever
const adapter = new PrismaPg(
  {
    connectionString: config.databaseUrl,
    max: config.dbPoolMax,
    statement_timeout: config.dbStatementTimeoutMs,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  },
  {
    onPoolError: (err) => {
      // eslint-disable-next-line no-console
      console.error('pg pool error', err.message);
    },
  },
);

const prisma = new PrismaClient({
  adapter,
  log: config.logLevel === 'silent' ? [] : ['warn', 'error'],
});

// A cheap round trip for readiness checks. Kept here so callers do not reach
// into Prisma internals.
async function ping() {
  await prisma.$queryRaw`SELECT 1`;
}

async function disconnect() {
  await prisma.$disconnect();
}

module.exports = { prisma, ping, disconnect };
