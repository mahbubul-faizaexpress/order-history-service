'use strict';

const { buildApp } = require('./app');
const config = require('./config');
const { prisma } = require('./db');

const app = buildApp();
const server = app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`listening on :${config.port}`);
});

// Graceful shutdown: stop accepting connections, disconnect Prisma, then exit.
function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`${signal} received — shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => shutdown(sig)));
