'use strict';

// Single error type carried to the central handler. `code` is a stable string
// clients can branch on; `message` is human-facing and safe to expose.
class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const badRequest = (msg) => new AppError(400, 'BAD_REQUEST', msg);
const unauthorized = (msg = 'Authentication required') =>
  new AppError(401, 'UNAUTHORIZED', msg);
const forbidden = (msg = 'You may not view these orders') =>
  new AppError(403, 'FORBIDDEN', msg);
const notFound = (code, msg) => new AppError(404, code, msg);

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message },
    });
  }
  req.log?.error({ err }, 'unhandled error');
  return res.status(500).json({
    error: { code: 'INTERNAL', message: 'Something went wrong' },
  });
}

module.exports = {
  AppError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  errorHandler,
};
