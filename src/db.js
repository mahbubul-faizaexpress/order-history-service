'use strict';

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const config = require('./config');

// Prisma 7 talks to Postgres through a driver adapter. We own the underlying
// `pg` pool config here:
//   - `max`               : bound concurrency (see DECISIONS.md Q3)
//   - `statement_timeout`  : a runaway query cannot hold a connection forever
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

module.exports = { prisma };
