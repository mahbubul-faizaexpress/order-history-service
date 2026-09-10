# Order History Service

`GET /api/users/:id/orders` — returns a user's order history, newest first.

Built for the Luminous Labs Senior Node.js take-home. Read **[DECISIONS.md](DECISIONS.md)** first.

---

## Setup (under 5 minutes)

Requires Docker and Node.js 20+.

```bash
cp .env.example .env
docker compose up -d            # Postgres on :5432, plus an empty orders_test db
npm install
npm run db:setup                # applies db/schema.sql and seeds ~5k users / ~50k orders
npm start                       # http://localhost:3000
```

Health check:

```bash
curl localhost:3000/health
```

---

## Trying the endpoint

The endpoint expects a verified `Bearer` JWT (`sub` = user id, `role` = `customer` | `admin`).
Signing secret is `JWT_SECRET` in `.env`. Mint sample tokens:

```bash
node -e "console.log(require('jsonwebtoken').sign({sub:'2',role:'customer'}, process.env.JWT_SECRET || require('dotenv').config().parsed.JWT_SECRET, {algorithm:'HS256'}))"
```

Or use these helpers (user 1 is the seeded admin):

```bash
SELF=$(node -e "require('dotenv').config();console.log(require('jsonwebtoken').sign({sub:'2',role:'customer'},process.env.JWT_SECRET))")
ADMIN=$(node -e "require('dotenv').config();console.log(require('jsonwebtoken').sign({sub:'1',role:'admin'},process.env.JWT_SECRET))")

# user 2 viewing their own orders
curl -s "localhost:3000/api/users/2/orders" -H "Authorization: Bearer $SELF" | jq

# next page
curl -s "localhost:3000/api/users/2/orders?limit=5" -H "Authorization: Bearer $SELF" | jq
curl -s "localhost:3000/api/users/2/orders?limit=5&cursor=<next_cursor>" -H "Authorization: Bearer $SELF" | jq

# admin viewing user 2
curl -s "localhost:3000/api/users/2/orders" -H "Authorization: Bearer $ADMIN" | jq

# user 2 trying to view user 3 -> 403
curl -s -o /dev/null -w "%{http_code}\n" "localhost:3000/api/users/3/orders" -H "Authorization: Bearer $SELF"
```

---

## Response shape

```json
{
  "data": [
    {
      "id": 5012,
      "status": "delivered",
      "total_amount": "1450.00",
      "currency": "BDT",
      "created_at": "2026-09-01T10:20:00.000Z"
    }
  ],
  "page": {
    "next_cursor": "MjAyNi0wOS0wMVQxMDoyMDowMC4wMDBafDUwMTI",
    "has_more": true
  }
}
```

Pass `next_cursor` back as `?cursor=` for the following page. `has_more: false` and
`next_cursor: null` mean the end has been reached. Users with no orders return
`data: []` with a `200`.

| Status | When |
|--------|------|
| 200 | orders returned (possibly empty) |
| 400 | `:id` not a positive integer, or malformed `cursor` |
| 401 | missing or invalid Bearer token |
| 403 | caller is neither the target user nor an admin |
| 404 | admin requested a user that does not exist |

---

## Tests

```bash
npm test
```

Runs against `TEST_DATABASE_URL` (the `orders_test` database created by
`docker compose up`). The suite rebuilds the schema and inserts its own fixtures;
it does not touch the seeded development data.

---

## Layout

```
db/       schema.sql, seed, one-shot setup script
src/
  app.js          express app factory (imported by tests)
  server.js       listen + graceful shutdown
  db.js           pg pool, per-connection statement_timeout
  auth.js         Bearer JWT -> req.caller
  errors.js       AppError + central handler
  orders/
    routes.js     GET /users/:id/orders
    controller.js  authz, validation, serialization
    repository.js  keyset SQL
    cursor.js     (created_at, id) <-> opaque token
test/     node:test + supertest
```
