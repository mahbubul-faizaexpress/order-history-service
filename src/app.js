'use strict';

const express = require('express');
const pinoHttp = require('pino-http');
const config = require('./config');
const { errorHandler } = require('./errors');
const ordersRoutes = require('./orders/routes');
const { prisma } = require('./db');

function buildApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(pinoHttp({ level: config.logLevel }));
  app.use(express.json());

  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'degraded' });
    }
  });

  app.use('/api', ordersRoutes);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
  app.use(errorHandler);

  return app;
}

module.exports = { buildApp };
