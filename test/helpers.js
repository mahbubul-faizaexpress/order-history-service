'use strict';

process.env.NODE_ENV = 'test';

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const db = require('../src/db');

const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

// Rebuild the test schema from scratch. Cheap — two tables, no data yet.
async function resetDb() {
  await db.query(schema);
}

// Insert a user with an explicit id so tests can reason about ownership.
async function createUser(id, role = 'customer') {
  await db.query(
    `INSERT INTO users (id, email, role) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
    [id, `user${id}@example.com`, role],
  );
}

// Insert N orders for a user, oldest first, one minute apart, so the expected
// "newest first" order is simply the reverse of insertion order.
async function createOrders(userId, count, startAt = new Date('2026-01-01T00:00:00Z')) {
  const ids = [];
  for (let i = 0; i < count; i += 1) {
    const createdAt = new Date(startAt.getTime() + i * 60000).toISOString();
    const { rows } = await db.query(
      `INSERT INTO orders (user_id, status, total_amount, created_at)
       VALUES ($1, 'paid', $2, $3) RETURNING id`,
      [userId, (100 + i).toFixed(2), createdAt],
    );
    ids.push(Number(rows[0].id));
  }
  return ids;
}

function token(userId, role = 'customer') {
  return jwt.sign({ sub: String(userId), role }, config.jwtSecret, { algorithm: 'HS256' });
}

async function closeDb() {
  await db.pool.end();
}

module.exports = { resetDb, createUser, createOrders, token, closeDb };
