'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { resetDb, createUser, createOrders, token, closeDb } = require('./helpers');
const { buildApp } = require('../src/app');

const app = buildApp();

// ids: 1 = admin, 10 = alice (has orders), 20 = bob (no orders), 30 = carol (other)
test.before(async () => {
  await resetDb();
  await createUser(1, 'admin');
  await createUser(10);
  await createUser(20);
  await createUser(30);
  await createOrders(10, 25); // alice: 25 orders
});

test.after(async () => {
  await closeDb();
});

test('returns a user\'s own orders, newest first', async () => {
  const res = await request(app)
    .get('/api/users/10/orders')
    .set('Authorization', `Bearer ${token(10)}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 20); // default limit
  const dates = res.body.data.map((o) => o.created_at);
  const sorted = [...dates].sort().reverse();
  assert.deepEqual(dates, sorted, 'orders must be in descending created_at order');
});

test('a user with no orders gets 200 and an empty list', async () => {
  const res = await request(app)
    .get('/api/users/20/orders')
    .set('Authorization', `Bearer ${token(20)}`);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, []);
  assert.equal(res.body.page.has_more, false);
  assert.equal(res.body.page.next_cursor, null);
});

test('keyset pagination walks every order exactly once, in order', async () => {
  const seen = [];
  let cursor;
  for (let guard = 0; guard < 10; guard += 1) {
    const res = await request(app)
      .get('/api/users/10/orders')
      .query({ limit: 10, ...(cursor ? { cursor } : {}) })
      .set('Authorization', `Bearer ${token(10)}`);

    assert.equal(res.status, 200);
    seen.push(...res.body.data.map((o) => o.id));
    if (!res.body.page.has_more) break;
    cursor = res.body.page.next_cursor;
  }

  assert.equal(seen.length, 25, 'all 25 orders returned');
  assert.equal(new Set(seen).size, 25, 'no order returned twice');
  const strictlyDescending = seen.every((id, i) => i === 0 || seen[i - 1] > id);
  assert.ok(strictlyDescending, 'ids strictly descending across pages');
});

test('admin may view another user\'s orders', async () => {
  const res = await request(app)
    .get('/api/users/10/orders')
    .set('Authorization', `Bearer ${token(1, 'admin')}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.length, 20);
});

test('a non-admin may not view another user\'s orders', async () => {
  const res = await request(app)
    .get('/api/users/10/orders')
    .set('Authorization', `Bearer ${token(30)}`);
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('missing token is 401', async () => {
  const res = await request(app).get('/api/users/10/orders');
  assert.equal(res.status, 401);
});

test('invalid token is 401', async () => {
  const res = await request(app)
    .get('/api/users/10/orders')
    .set('Authorization', 'Bearer not-a-jwt');
  assert.equal(res.status, 401);
});

test('non-integer :id is 400', async () => {
  const res = await request(app)
    .get('/api/users/abc/orders')
    .set('Authorization', `Bearer ${token(1, 'admin')}`);
  assert.equal(res.status, 400);
});

test('limit above the max is clamped', async () => {
  const res = await request(app)
    .get('/api/users/10/orders')
    .query({ limit: 500 })
    .set('Authorization', `Bearer ${token(10)}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.data.length <= 100);
});

test('admin viewing a non-existent user is 404', async () => {
  const res = await request(app)
    .get('/api/users/999999/orders')
    .set('Authorization', `Bearer ${token(1, 'admin')}`);
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'USER_NOT_FOUND');
});

test('a malformed cursor is 400', async () => {
  const res = await request(app)
    .get('/api/users/10/orders')
    .query({ cursor: '!!!not-base64!!!' })
    .set('Authorization', `Bearer ${token(10)}`);
  assert.equal(res.status, 400);
});

test('admin viewing an existing user with no orders is 200, not 404', async () => {
  const res = await request(app)
    .get('/api/users/20/orders')
    .set('Authorization', `Bearer ${token(1, 'admin')}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, []);
});

test('every response carries an x-request-id header', async () => {
  const res = await request(app)
    .get('/api/users/10/orders')
    .set('Authorization', `Bearer ${token(10)}`);
  assert.ok(res.headers['x-request-id']);
});

test('liveness is up without touching the database; readiness checks it', async () => {
  assert.equal((await request(app).get('/health')).status, 200);
  assert.equal((await request(app).get('/health/ready')).status, 200);
});

test('unknown routes return a structured 404', async () => {
  const res = await request(app).get('/api/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');
});
