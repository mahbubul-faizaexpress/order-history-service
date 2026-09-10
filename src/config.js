'use strict';

require('dotenv').config();

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const isTest = process.env.NODE_ENV === 'test';

const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: isTest
    ? required('TEST_DATABASE_URL')
    : required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  dbStatementTimeoutMs: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 5000),
  dbPoolMax: Number(process.env.DB_POOL_MAX || 10),
  logLevel: isTest ? 'silent' : (process.env.LOG_LEVEL || 'info'),
  // pagination
  defaultLimit: 20,
  maxLimit: 100,
};

module.exports = config;
