'use strict';

const crypto = require('node:crypto');
const express = require('express');
const pinoHttp = require('pino-http');
const config = require('./config');
const db = require('./db');
const { errorHandler, notFound } = require('./errors');
const ordersRoutes = require('./orders/routes');

function buildApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', true); // behind a load balancer / gateway in any real deploy

  app.use(
    pinoHttp({
      level: config.logLevel,
      // Reuse an upstream correlation id when the gateway already set one.
      genReqId: (req, res) => {
        const existing = req.headers['x-request-id'];
        const id = existing || crypto.randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
    }),
  );

  // No body parser: this service is read-only. Adding one would just be attack
  // surface with nothing to parse.

  // Liveness: is the process up? (no dependencies — a failing DB must not cause
  // the orchestrator to kill an otherwise healthy pod).
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // Readiness: can it actually serve traffic? (checks the database).
  app.get('/health/ready', async (_req, res) => {
    try {
      await db.ping();
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.use('/api', ordersRoutes);

  app.use((_req, _res, next) => next(notFound('ROUTE_NOT_FOUND', 'Route not found')));
  app.use(errorHandler);

  return app;
}

module.exports = { buildApp };
