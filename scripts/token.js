'use strict';

// Prints a signed JWT for testing the endpoint.
//
//   npm run token            -> user 2, role customer
//   npm run token 1 admin    -> user 1, role admin
//   npm run token 42         -> user 42, role customer

require('dotenv').config();
const jwt = require('jsonwebtoken');

const userId = process.argv[2] || '2';
const role = process.argv[3] || 'customer';

const secret = process.env.JWT_SECRET;
if (!secret) {
  console.error('JWT_SECRET is not set — copy .env.example to .env first');
  process.exit(1);
}

const token = jwt.sign({ sub: String(userId), role }, secret, {
  algorithm: 'HS256',
  expiresIn: '2h',
});

console.log(`\nuser id : ${userId}\nrole    : ${role}\n`);
console.log(token);
console.log(`\nExample:\n  curl -H "Authorization: Bearer ${token}" \\\n    http://localhost:${process.env.PORT || 3000}/api/users/${userId}/orders\n`);
