'use strict';

const { badRequest } = require('../errors');

// A cursor is the sort key of the last row already returned: (created_at, id).
// We keep BOTH parts. Keying on id alone would skip rows that share a timestamp
// when the boundary falls between them; keying on created_at alone is not unique.
// Encoded as base64url of "<iso timestamp>|<id>" — opaque to clients.

function encodeCursor(row) {
  if (!row) return null;
  const raw = `${new Date(row.createdAt).toISOString()}|${row.id}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

function decodeCursor(value) {
  if (value === undefined || value === null || value === '') return null;

  let raw;
  try {
    raw = Buffer.from(String(value), 'base64url').toString('utf8');
  } catch {
    throw badRequest('Malformed cursor');
  }

  const sep = raw.lastIndexOf('|');
  if (sep === -1) throw badRequest('Malformed cursor');

  const ts = raw.slice(0, sep);
  const id = Number(raw.slice(sep + 1));
  const date = new Date(ts);

  if (Number.isNaN(date.getTime()) || !Number.isInteger(id) || id <= 0) {
    throw badRequest('Malformed cursor');
  }

  return { createdAt: date.toISOString(), id };
}

module.exports = { encodeCursor, decodeCursor };
