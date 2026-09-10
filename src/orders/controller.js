'use strict';

const { z } = require('zod');
const config = require('../config');
const { badRequest, forbidden, notFound } = require('../errors');
const { encodeCursor, decodeCursor } = require('./cursor');
const repository = require('./repository');

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const querySchema = z.object({
  limit: z.coerce.number().int().catch(config.defaultLimit),
  cursor: z.string().optional(),
});

function serializeOrder(row) {
  return {
    id: Number(row.id), // BigInt -> Number; safe well past any realistic order id
    status: row.status,
    // Prisma Decimal -> string, so exact cents survive (never through a JS float)
    total_amount: row.totalAmount.toFixed(2),
    currency: row.currency,
    created_at: row.createdAt.toISOString(),
  };
}

async function getUserOrders(req, res, next) {
  try {
    const params = paramsSchema.safeParse(req.params);
    if (!params.success) {
      throw badRequest('User id must be a positive integer');
    }
    const targetId = params.data.id;

    const q = querySchema.parse(req.query);
    const limit = Math.min(Math.max(q.limit, 1), config.maxLimit);
    const cursor = decodeCursor(q.cursor);

    // Requirement #4: self, or an admin.
    const caller = req.caller;
    if (caller.id !== targetId && caller.role !== 'admin') {
      throw forbidden();
    }

    // Requirement #3: a user with no orders is a 200 with an empty list.
    // Only pay for the existence check when it can actually matter: an admin
    // (or the rare token whose subject no longer exists) asking about someone
    // else. A caller asking about themselves exists by construction.
    if (caller.id !== targetId) {
      const exists = await repository.userExists(targetId);
      if (!exists) throw notFound('USER_NOT_FOUND', 'No such user');
    }

    const { rows, hasMore } = await repository.listOrders({ userId: targetId, limit, cursor });

    res.json({
      data: rows.map(serializeOrder),
      page: {
        next_cursor: hasMore ? encodeCursor(rows[rows.length - 1]) : null,
        has_more: hasMore,
      },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { getUserOrders };
