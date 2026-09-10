'use strict';

const { badRequest } = require('../errors');

// A cursor is the sort key of the last row already returned: (created_at, id).
// Both parts are kept — keying on id alone skips rows that share a timestamp when
// the page boundary falls between them; created_at alone is not unique.
//
// Wire format: base64url of "<ISO-8601 timestamp>|<id>". Opaque to clients, but
// deliberately not signed — see DECISIONS.md ("Cursor tamper-proofing").

const SEPARATOR = '|';

function encode({ createdAt, id }) {
  const iso = createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString();
  return Buffer.from(`${iso}${SEPARATOR}${id}`, 'utf8').toString('base64url');
}

function decode(value) {
  if (value === undefined || value === null || value === '') return null;

  const raw = Buffer.from(String(value), 'base64url').toString('utf8');
  const sep = raw.lastIndexOf(SEPARATOR);
  if (sep === -1) throw badRequest('Malformed cursor');

  const createdAt = new Date(raw.slice(0, sep));
  const id = Number(raw.slice(sep + 1));

  if (Number.isNaN(createdAt.getTime()) || !Number.isSafeInteger(id) || id <= 0) {
    throw badRequest('Malformed cursor');
  }

  // Reject anything that is not the exact canonical encoding of what we parsed:
  // trailing bytes, non-canonical timestamps, tampering that changes the string
  // but not the parse. A valid cursor can only have come from a previous response.
  if (encode({ createdAt, id }) !== String(value)) {
    throw badRequest('Malformed cursor');
  }

  return { createdAt, id };
}

module.exports = { encode, decode };
