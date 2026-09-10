'use strict';

const { buildApp } = require('./app');
const config = require('./config');
const db = require('./db');

const app = buildApp();
const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`listening on :${config.port} (${config.nodeEnv})`);
});

let shuttingDown = false;

// Graceful shutdown: stop accepting connections, drain the pool, then exit.
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  // eslint-disable-next-line no-console
  console.log(`${signal} received — shutting down`);

  const hardExit = setTimeout(() => process.exit(1), 10000).unref();
  server.close(async () => {
    await db.disconnect();
    clearTimeout(hardExit);
    process.exit(0);
  });
}

['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => shutdown(sig)));

// A rejected promise or thrown error that reaches here means an invariant we did
// not anticipate is broken; log it and let the orchestrator restart us.
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('unhandledRejection', reason);
  shutdown('unhandledRejection');
});
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('uncaughtException', err);
  shutdown('uncaughtException');
});
