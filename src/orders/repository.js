'use strict';

const { prisma } = require('../db');

async function userExists(userId) {
  const found = await prisma.user.findUnique({
    where: { id: BigInt(userId) },
    select: { id: true },
  });
  return found !== null;
}

// Keyset ("seek") pagination.
//
// Prisma's built-in `cursor` + `skip: 1` is deliberately NOT used: it keys on a
// single unique field, so with a compound (created_at, id) sort it walks id
// order rather than date order and drops or repeats rows at page boundaries.
// The boundary here is an explicit predicate — everything strictly after the
// (created_at, id) of the last row already returned — which the planner serves
// from idx_orders_user_created as a bounded range scan (DECISIONS.md, scale).
//
// `limit + 1` rows are fetched; the extra row, if present, means "has more".
async function listOrders({ userId, limit, cursor }) {
  const where = { userId: BigInt(userId) };

  if (cursor) {
    where.OR = [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: BigInt(cursor.id) } },
    ];
  }

  const rows = await prisma.order.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: {
      id: true,
      status: true,
      totalAmount: true,
      currency: true,
      createdAt: true,
    },
  });

  const hasMore = rows.length > limit;
  return { rows: hasMore ? rows.slice(0, limit) : rows, hasMore };
}

module.exports = { userExists, listOrders };
