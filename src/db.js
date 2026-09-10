'use strict';

const { PrismaClient } = require('@prisma/client');
const config = require('./config');

// One PrismaClient per process (it owns its own connection pool).
// statement_timeout is pushed down via the connection string so a runaway query
// cannot hold a pool connection forever (see DECISIONS.md Q3).
const url = new URL(config.databaseUrl);
url.searchParams.set('connection_limit', String(config.dbPoolMax));
url.searchParams.set(
  'options',
  `-c statement_timeout=${config.dbStatementTimeoutMs}`,
);

const prisma = new PrismaClient({
  datasources: { db: { url: url.toString() } },
  log: config.logLevel === 'silent' ? [] : ['warn', 'error'],
});

module.exports = { prisma };
