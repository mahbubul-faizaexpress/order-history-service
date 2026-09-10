'use strict';

require('dotenv').config();
const { z } = require('zod');

// Validate the environment once, at boot. A missing or malformed variable should
// stop the process with a readable message — not surface as a confusing runtime
// error on the first request.

const isTest = process.env.NODE_ENV === 'test';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().url(),
    TEST_DATABASE_URL: z.string().url().optional(),
    JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    DB_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((env, ctx) => {
    if (isTest && !env.TEST_DATABASE_URL) {
      ctx.addIssue({ code: 'custom', path: ['TEST_DATABASE_URL'], message: 'required when NODE_ENV=test' });
    }
    if (env.NODE_ENV === 'production' && env.JWT_SECRET === 'dev-only-change-me') {
      ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'must not be the development default in production' });
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${lines.join('\n')}\n\nCopy .env.example to .env and adjust.`);
  process.exit(1);
}

const env = parsed.data;

module.exports = {
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  port: env.PORT,
  databaseUrl: isTest ? env.TEST_DATABASE_URL : env.DATABASE_URL,
  jwtSecret: env.JWT_SECRET,
  dbStatementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
  dbPoolMax: env.DB_POOL_MAX,
  logLevel: isTest ? 'silent' : env.LOG_LEVEL,

  // Pagination contract — kept here so the route, the repository and the docs
  // cannot drift apart.
  pagination: {
    defaultLimit: 20,
    maxLimit: 100,
  },
};
