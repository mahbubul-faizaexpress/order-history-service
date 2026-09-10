'use strict';

const { Pool } = require('pg');
const config = require('./config');

// One shared pool for the process. statement_timeout is applied to every
// connection so a runaway query cannot hold a pool slot forever (DECISIONS.md Q3).
const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: config.dbStatementTimeoutMs,
});

pool.on('error', (err) => {
  // an idle client threw — log, do not crash the process
  // eslint-disable-next-line no-console
  console.error('idle pg client error', err.message);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
