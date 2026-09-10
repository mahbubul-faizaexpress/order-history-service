'use strict';

const jwt = require('jsonwebtoken');
const config = require('./config');
const { unauthorized } = require('./errors');

// ASSUMPTION (DECISIONS.md, assumptions — the one I am least sure of): the
// caller's identity arrives as a verified HS256 JWT in
// `Authorization: Bearer <token>`, carrying:
//   sub  -> user id
//   role -> 'admin' | anything else is treated as an ordinary customer
//
// In a fuller system an API gateway / auth service verifies the token and this
// service only reads trusted claims. Verifying here keeps the endpoint
// self-contained and testable. Everything downstream depends only on the shape
// `req.caller = { id, role }`, so swapping this out is a one-file change.

const ROLES = new Set(['customer', 'admin']);

function requireAuth(req, _res, next) {
  const [scheme, token] = (req.get('authorization') || '').split(' ');

  if (!token || scheme.toLowerCase() !== 'bearer') {
    return next(unauthorized('Missing Bearer token'));
  }

  let claims;
  try {
    claims = jwt.verify(token, config.jwtSecret, {
      algorithms: ['HS256'],
      clockTolerance: 5,
    });
  } catch {
    return next(unauthorized('Invalid or expired token'));
  }

  const id = Number(claims.sub);
  if (!Number.isInteger(id) || id <= 0) {
    return next(unauthorized('Token subject is not a valid user id'));
  }

  req.caller = { id, role: ROLES.has(claims.role) ? claims.role : 'customer' };
  return next();
}

module.exports = { requireAuth };
