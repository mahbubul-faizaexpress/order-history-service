'use strict';

const cursor = require('./cursor');

// The single place that knows the wire shape of an order. Prisma hands back
// `BigInt` ids and `Decimal` amounts; both need deliberate conversion.
function toOrder(row) {
  return {
    id: Number(row.id),
    status: row.status,
    total_amount: row.totalAmount.toFixed(2), // Decimal -> string; never a float
    currency: row.currency,
    created_at: row.createdAt.toISOString(),
  };
}

// `rows` is the page (already trimmed to `limit`); `hasMore` says whether a
// further page exists.
function toOrderPage(rows, hasMore) {
  const last = rows[rows.length - 1];
  return {
    data: rows.map(toOrder),
    page: {
      next_cursor: hasMore && last ? cursor.encode(last) : null,
      has_more: hasMore,
    },
  };
}

module.exports = { toOrder, toOrderPage };
