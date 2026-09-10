'use strict';

// Seeds ~5,000 users and ~50,000 orders, matching the assignment's data size.
// Order counts are deliberately skewed: most users have a handful, a few have
// hundreds. That skew is what makes the pagination requirement real.
//
// Usage: node db/seed.js        (uses DATABASE_URL)

require('dotenv').config();
const { prisma } = require('../src/db');

const USER_COUNT = 5000;
const TARGET_ORDERS = 50000;
const STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'cancelled'];
const CHUNK = 5000;

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// user 1 is admin, users 2-20 are "whales", ~1/7 of the rest have no orders.
function ordersForUser(i) {
  if (i <= 20) return 500 + Math.floor(Math.random() * 500);
  if (i % 7 === 0) return 0;
  return 1 + Math.floor(Math.random() * 18);
}

async function insertInChunks(model, rows) {
  for (let i = 0; i < rows.length; i += CHUNK) {
    // eslint-disable-next-line no-await-in-loop
    await model.createMany({ data: rows.slice(i, i + CHUNK) });
  }
}

async function main() {
  const existing = await prisma.user.count();
  if (existing > 0) {
    console.log('users table not empty — skipping seed');
    return;
  }

  const users = [];
  for (let i = 1; i <= USER_COUNT; i += 1) {
    users.push({ email: `user${i}@example.com`, role: i === 1 ? 'admin' : 'customer' });
  }
  await insertInChunks(prisma.user, users);

  const now = Date.now();
  const orders = [];
  for (let userId = 1; userId <= USER_COUNT && orders.length < TARGET_ORDERS; userId += 1) {
    const count = ordersForUser(userId);
    for (let k = 0; k < count && orders.length < TARGET_ORDERS; k += 1) {
      orders.push({
        userId,
        status: pick(STATUSES),
        totalAmount: (Math.random() * 9900 + 100).toFixed(2),
        createdAt: new Date(now - Math.floor(Math.random() * 365 * 864e5)),
      });
    }
  }
  await insertInChunks(prisma.order, orders);

  await prisma.$executeRawUnsafe('ANALYZE users, orders');
  console.log(`seeded ${USER_COUNT} users and ${orders.length} orders`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
