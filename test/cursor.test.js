'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const cursor = require('../src/orders/cursor');

test('encode → decode round-trips the sort key', () => {
  const createdAt = new Date('2026-09-01T10:20:00.000Z');
  const token = cursor.encode({ createdAt, id: 5012n });

  const decoded = cursor.decode(token);
  assert.equal(decoded.createdAt.toISOString(), createdAt.toISOString());
  assert.equal(decoded.id, 5012);
});

test('decode returns null for an absent cursor', () => {
  assert.equal(cursor.decode(undefined), null);
  assert.equal(cursor.decode(''), null);
});

test('decode rejects a value that is not our encoding', () => {
  for (const bad of ['not-base64!!!', Buffer.from('garbage').toString('base64url'), Buffer.from('2026-01-01T00:00:00.000Z|0').toString('base64url'), Buffer.from('|123').toString('base64url')]) {
    assert.throws(() => cursor.decode(bad), /Malformed cursor/);
  }
});

test('decode rejects a tampered cursor (trailing bytes)', () => {
  const token = cursor.encode({ createdAt: new Date('2026-09-01T10:20:00.000Z'), id: 10n });
  const tampered = Buffer.concat([Buffer.from(token, 'base64url'), Buffer.from('x')]).toString('base64url');
  assert.throws(() => cursor.decode(tampered), /Malformed cursor/);
});

test('decode rejects a non-canonical timestamp', () => {
  // same instant, different string — must not be accepted
  const sneaky = Buffer.from('2026-09-01T10:20:00Z|10', 'utf8').toString('base64url');
  assert.throws(() => cursor.decode(sneaky), /Malformed cursor/);
});
