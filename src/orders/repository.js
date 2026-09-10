'use strict';

const { prisma } = require('../db');

async function userExists(userId) {
  const found = await prisma.user.findUnique({
    where: { id: BigInt(userId) },
    select: { id: true },
  });
  return found !== null;
}

// Keyset pagination expressed through Prisma's query builder.
//
// Prisma's built-in `cursor` + `skip: 1` is NOT used: it keys on a single unique
// field, so with a compound `created_at, id` sort it walks id order, not date
// order, and drops/repeats rows at page boundaries. Instead the boundary is an
// explicit predicate: everything strictly after (created_at, id) of the last row
// already returned. That maps onto idx_orders_user_created as a range scan.
//
// We take limit + 1 rows; the extra one, if present, means a next page exists.
async function listOrders({ userId, limit, cursor }) {
  const where = { userId: BigInt(userId) };

  if (cursor) {
    const at = new Date(cursor.createdAt);
    where.OR = [
      { createdAt: { lt: at } },
      { createdAt: at, id: { lt: BigInt(cursor.id) } },
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
