'use strict';

process.env.NODE_ENV = 'test';

const jwt = require('jsonwebtoken');
const config = require('../src/config');
const { prisma, disconnect } = require('../src/db');

// Wipe both tables and reset identity sequences. Cheap — the suite seeds its own
// small fixtures and never touches the development data.
async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "orders", "users" RESTART IDENTITY CASCADE',
  );
}

async function createUser(id, role = 'customer') {
  await prisma.user.create({
    data: { id: BigInt(id), email: `user${id}@example.com`, role },
  });
}

// N orders for a user, oldest first, one minute apart, so "newest first" is
// exactly the reverse of insertion order.
async function createOrders(userId, count, startAt = new Date('2026-01-01T00:00:00Z')) {
  const ids = [];
  for (let i = 0; i < count; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const row = await prisma.order.create({
      data: {
        userId: BigInt(userId),
        status: 'paid',
        totalAmount: (100 + i).toFixed(2),
        createdAt: new Date(startAt.getTime() + i * 60000),
      },
      select: { id: true },
    });
    ids.push(Number(row.id));
  }
  return ids;
}

function token(userId, role = 'customer') {
  return jwt.sign({ sub: String(userId), role }, config.jwtSecret, { algorithm: 'HS256' });
}

async function closeDb() {
  await disconnect();
}

module.exports = { resetDb, createUser, createOrders, token, closeDb };
