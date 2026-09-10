'use strict';

// Express 4 does not forward rejections from async route handlers to the error
// middleware. This wrapper does, so handlers can be written as plain async
// functions without a try/catch whose only job is `next(err)`.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { asyncHandler };
