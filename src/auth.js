'use strict';

const jwt = require('jsonwebtoken');
const config = require('./config');
const { unauthorized } = require('./errors');

// ASSUMPTION (DECISIONS.md Q1, least confident): the caller's identity arrives as
// a verified HS256 JWT in `Authorization: Bearer <token>`, with:
//   sub  -> user id (string or number)
//   role -> 'customer' | 'admin'
// In a fuller system an upstream gateway / auth service would verify this and we
// would only read claims. We verify here so the endpoint is self-contained.
function requireAuth(req, _res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(unauthorized('Missing Bearer token'));
  }

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return next(unauthorized('Invalid or expired token'));
  }

  const id = Number(payload.sub);
  if (!Number.isInteger(id) || id <= 0) {
    return next(unauthorized('Token has no valid subject'));
  }

  req.caller = { id, role: payload.role === 'admin' ? 'admin' : 'customer' };
  return next();
}

module.exports = { requireAuth };
