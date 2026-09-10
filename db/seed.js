'use strict';

// Seeds ~5,000 users and ~50,000 orders, matching the assignment's data size.
// Order counts are deliberately skewed: most users have a handful of orders,
// a few have hundreds. That skew is what makes the pagination requirement real.
//
// Usage: node db/seed.js   (uses DATABASE_URL)

const { Client } = require('pg');
require('dotenv').config();

const USER_COUNT = 5000;
const TARGET_ORDERS = 50000;
const STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];
const BATCH = 1000;

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Deterministic-ish skew: user 1 is admin, users 2-20 are "whales".
function ordersForUser(i) {
  if (i <= 20) return 500 + Math.floor(Math.random() * 500); // whales
  if (i % 7 === 0) return 0; // ~1/7 have no orders -> exercises requirement #3
  return 1 + Math.floor(Math.random() * 18);
}

async function insertUsers(client) {
  const rows = [];
  const params = [];
  for (let i = 1; i <= USER_COUNT; i += 1) {
    const role = i === 1 ? 'admin' : 'customer';
    params.push(`user${i}@example.com`, role);
    rows.push(`($${params.length - 1}, $${params.length})`);
  }
  await client.query(
    `INSERT INTO users (email, role) VALUES ${rows.join(', ')}`,
    params,
  );
}

async function insertOrders(client) {
  const now = Date.now();
  let pending = [];
  let inserted = 0;

  const flush = async () => {
    if (pending.length === 0) return;
    const values = [];
    const params = [];
    for (const o of pending) {
      params.push(o.user_id, o.status, o.total_amount, o.created_at);
      const n = params.length;
      values.push(`($${n - 3}, $${n - 2}, $${n - 1}, $${n})`);
    }
    await client.query(
      `INSERT INTO orders (user_id, status, total_amount, created_at)
       VALUES ${values.join(', ')}`,
      params,
    );
    inserted += pending.length;
    pending = [];
  };

  for (let userId = 1; userId <= USER_COUNT && inserted < TARGET_ORDERS; userId += 1) {
    const count = ordersForUser(userId);
    for (let k = 0; k < count && inserted + pending.length < TARGET_ORDERS; k += 1) {
      pending.push({
        user_id: userId,
        status: pick(STATUSES),
        total_amount: (Math.random() * 9900 + 100).toFixed(2),
        // spread across the last ~365 days
        created_at: new Date(now - Math.floor(Math.random() * 365 * 864e5)).toISOString(),
      });
      if (pending.length >= BATCH) await flush();
    }
  }
  await flush();
  return inserted;
}

async function seed(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) throw new Error('Missing DATABASE_URL');

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const existing = await client.query('SELECT count(*)::int AS n FROM users');
    if (existing.rows[0].n > 0) {
      console.log('users table not empty — skipping seed');
      return;
    }
    await client.query('BEGIN');
    await insertUsers(client);
    const n = await insertOrders(client);
    await client.query('COMMIT');
    await client.query('ANALYZE users, orders');
    console.log(`seeded ${USER_COUNT} users and ${n} orders`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

module.exports = { seed };

if (require.main === module) {
  seed().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
