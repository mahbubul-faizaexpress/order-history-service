'use strict';

const { z } = require('zod');
const config = require('../config');
const { badRequest, forbidden, notFound } = require('../errors');
const { asyncHandler } = require('../lib/async-handler');
const cursor = require('./cursor');
const repository = require('./repository');
const serializer = require('./serializer');

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const querySchema = z.object({
  // A malformed `limit` falls back to the default rather than 400-ing — it is a
  // hint, not a resource identifier. Out-of-range values are clamped below.
  limit: z.coerce.number().int().catch(config.pagination.defaultLimit),
  cursor: z.string().optional(),
});

function authorize(caller, targetId) {
  if (caller.id !== targetId && caller.role !== 'admin') {
    throw forbidden();
  }
}

const getUserOrders = asyncHandler(async (req, res) => {
  const params = paramsSchema.safeParse(req.params);
  if (!params.success) throw badRequest('User id must be a positive integer');
  const targetId = params.data.id;

  const query = querySchema.safeParse(req.query);
  if (!query.success) throw badRequest('Invalid query parameters');
  const limit = Math.min(Math.max(query.data.limit, 1), config.pagination.maxLimit);
  const pageCursor = cursor.decode(query.data.cursor);

  authorize(req.caller, targetId); // requirement #4

  const { rows, hasMore } = await repository.listOrders({ userId: targetId, limit, cursor: pageCursor });

  // Requirement #3: "no orders" is a 200 with an empty list, not a 404.
  // Distinguishing "no orders" from "no such user" needs an extra query, so only
  // pay for it when it can change the answer: an empty result for someone other
  // than the caller. A non-empty result proves the user exists; a caller asking
  // about themselves exists by virtue of holding a valid token.
  if (rows.length === 0 && req.caller.id !== targetId) {
    if (!(await repository.userExists(targetId))) {
      throw notFound('USER_NOT_FOUND', 'No such user');
    }
  }

  res.json(serializer.toOrderPage(rows, hasMore));
});

module.exports = { getUserOrders };
