'use strict';

const db = require('../db');

async function userExists(userId) {
  const { rowCount } = await db.query('SELECT 1 FROM users WHERE id = $1', [userId]);
  return rowCount > 0;
}

// Keyset pagination. The (created_at, id) < (cursor) comparison is a single
// range scan on idx_orders_user_created regardless of how deep the page is.
// We fetch limit + 1 rows: the extra row, if present, means there is a next page.
async function listOrders({ userId, limit, cursor }) {
  const params = [
    userId,
    cursor ? cursor.createdAt : null,
    cursor ? cursor.id : null,
    limit + 1,
  ];

  const { rows } = await db.query(
    `SELECT id, status, total_amount, currency, created_at
       FROM orders
      WHERE user_id = $1
        AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::bigint))
      ORDER BY created_at DESC, id DESC
      LIMIT $4`,
    params,
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return { rows: page, hasMore };
}

module.exports = { userExists, listOrders };
