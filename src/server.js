'use strict';

const { buildApp } = require('./app');
const config = require('./config');
const db = require('./db');

const app = buildApp();
const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`listening on :${config.port}`);
});

// Graceful shutdown: stop accepting connections, drain the pool, then exit.
function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`${signal} received — shutting down`);
  server.close(async () => {
    await db.pool.end();
    process.exit(0);
  });
  // hard limit if connections refuse to drain
  setTimeout(() => process.exit(1), 10000).unref();
}

['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => shutdown(sig)));
