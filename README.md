# Order History Service

`GET /api/users/:id/orders` — returns a user's order history, newest first.

Built for the Luminous Labs Senior Node.js take-home. Read **[DECISIONS.md](DECISIONS.md)** first.

---

## Setup (under 5 minutes)

Requires Docker and Node.js 20+.

```bash
cp .env.example .env
docker compose up -d            # Postgres on :5432, plus an empty orders_test db
npm install                     # runs `prisma generate` automatically
npm run db:setup                # prisma migrate deploy + seeds ~5k users / ~50k orders
npm start                       # http://localhost:3000
```

If your machine already runs Postgres on 5432, set `POSTGRES_HOST_PORT` in `.env`
to a free port and update the `*_DATABASE_URL` values to match.

Data access is [Prisma](https://www.prisma.io/) (`prisma/schema.prisma`).
Migrations live in `prisma/migrations/`; the CHECK constraints Prisma cannot
express are in a hand-written follow-up migration.

Health check:

```bash
curl localhost:3000/health
```

---

## Trying the endpoint

The endpoint needs a `Bearer` token that says who is calling (`sub` = user id,
`role` = `customer` or `admin`). In the seed data, **user 1 is an admin** and
everyone else is a normal customer.

### Step 1 — get a token

```bash
npm run token 2          # token for normal user 2
npm run token 1 admin    # token for the admin
```

Each command prints the token and a ready-to-run `curl` line.

### Step 2 — call the endpoint

Copy a token from step 1 into `TOKEN=...`, then:

```bash
TOKEN=<paste token here>

# user 2's orders, newest first
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/users/2/orders

# 5 per page
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/users/2/orders?limit=5"

# next page: take "next_cursor" from the previous response and pass it back
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/users/2/orders?limit=5&cursor=PASTE_NEXT_CURSOR"
```

### Easier: click-to-run in VS Code

Open **[api.http](api.http)**, install the "REST Client" extension when prompted,
paste your two tokens at the top, and click **Send Request** above any request.
It covers every case — own orders, paging, admin access, 403, empty user, 401.

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
api.http          click-to-run requests for VS Code REST Client
prisma/
  schema.prisma   models (mapped to snake_case tables)
  migrations/     init + hand-written CHECK constraints
db/
  seed.js         ~5k users / ~50k orders, skewed order counts
  migrate-test.js  pretest hook: migrate the test database
scripts/
  token.js        prints a test JWT (`npm run token`)
src/
  app.js          express app factory (imported by tests)
  server.js       listen + graceful shutdown
  db.js           PrismaClient singleton, statement_timeout via connection string
  auth.js         Bearer JWT -> req.caller
  errors.js       AppError + central handler
  orders/
    routes.js     GET /users/:id/orders
    controller.js  authz, validation, serialization
    repository.js  keyset pagination via Prisma
    cursor.js     (created_at, id) <-> opaque token
test/     node:test + supertest
```
