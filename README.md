# Order History Service

A single endpoint that returns a user's order history:

```
GET /api/users/:id/orders
```

Newest orders first, cursor-paginated so the response stays flat as an account
grows, and readable only by the user themselves or an admin.

> Built for the Luminous Labs Senior Node.js take-home.
> **[DECISIONS.md](DECISIONS.md) is the main document** — assumptions, where AI was
> overridden, what breaks at scale, and what was deliberately left out.

---

## Contents

- [How the requirements are met](#how-the-requirements-are-met)
- [Prerequisites](#prerequisites)
- [Quickstart](#quickstart)
- [Configuration](#configuration)
- [Trying the endpoint](#trying-the-endpoint)
- [API reference](#api-reference)
- [How pagination works](#how-pagination-works)
- [Tests](#tests)
- [Project structure](#project-structure)
- [Tech stack](#tech-stack)
- [Design decisions](#design-decisions)

---

## How the requirements are met

| Requirement | Approach |
| --- | --- |
| Orders, newest first | `ORDER BY created_at DESC, id DESC` (`id` breaks ties so paging is stable) |
| Stays responsive as orders grow | Composite index `(user_id, created_at DESC, id DESC)`, **keyset** pagination (not offset-based), no `COUNT(*)`, `limit` capped at 100 |
| Users with no orders | `200` with `{ "data": [], "page": { "next_cursor": null, "has_more": false } }` — not a `404` |
| Only the user, or an admin | `Bearer` JWT → `req.caller`; `401` without a valid token, `403` when the caller is neither the target user nor an admin |

---

## Prerequisites

- **Node.js 20+**
- **Docker** (for Postgres — nothing else needs installing)

---

## Quickstart

```bash
cp .env.example .env       # 1. config (defaults work as-is)
docker compose up -d       # 2. Postgres on :5432, plus an empty orders_test db
npm install                # 3. deps (+ prisma generate)
npm run db:setup           # 4. migrate + seed ~5k users / ~50k orders
npm start                  # 5. http://localhost:3000
```

Check it is up:

```bash
curl localhost:3000/health          # {"status":"ok"}
```

> **Port 5432 already in use?** Set `POSTGRES_HOST_PORT` in `.env` to a free port
> and change the `5432` in both `*_DATABASE_URL` values to match.

---

## Configuration

All configuration is environment variables (`.env`, copied from `.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `POSTGRES_HOST_PORT` | `5432` | Host port the Postgres container binds to |
| `DATABASE_URL` | points at the `orders` db | Application database |
| `TEST_DATABASE_URL` | points at the `orders_test` db | Database used by `npm test` |
| `JWT_SECRET` | `dev-only-change-me` | HS256 secret used to verify incoming tokens |
| `DB_STATEMENT_TIMEOUT_MS` | `5000` | Per-connection statement timeout (ms) |
| `DB_POOL_MAX` | `10` | Connection pool size |
| `LOG_LEVEL` | `info` | `pino` log level (`silent` during tests) |

---

## Trying the endpoint

Every request needs a `Bearer` token identifying the caller (`sub` = user id,
`role` = `customer` or `admin`). **In the seed data, user 1 is an admin**;
everyone else is a customer.

### 1. Mint a token

```bash
npm run token 2          # a normal user
npm run token 1 admin    # the admin
```

Each command prints the token plus a ready-to-run `curl` line.

### 2. Call the endpoint

```bash
TOKEN=PASTE_A_TOKEN_FROM_STEP_1

# user 2's most recent orders
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/users/2/orders

# five per page
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/users/2/orders?limit=5"

# the next page — pass back next_cursor from the previous response
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/users/2/orders?limit=5&cursor=PASTE_NEXT_CURSOR"
```

### Or: click-to-run in VS Code

Open **[api.http](api.http)**, install the **REST Client** extension when
prompted, paste your two tokens at the top, and click **Send Request** above any
request. It walks through every case: own orders, paging, admin access, `403`,
empty user, `401`.

---

## API reference

### `GET /api/users/:id/orders`

**Headers**

| Header | Required | Notes |
| --- | --- | --- |
| `Authorization: Bearer <jwt>` | yes | HS256, signed with `JWT_SECRET` |

**Query parameters**

| Param | Type | Default | Notes |
| --- | --- | --- | --- |
| `limit` | integer | `20` | clamped to the range 1 to 100 |
| `cursor` | string | — | opaque value from a previous `next_cursor` |

**`200` response**

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

- `total_amount` is a **string** — it is a `DECIMAL`, never sent through a float.
- `has_more: false` / `next_cursor: null` means the end has been reached.

**Status codes**

| Status | When |
| --- | --- |
| `200` | orders returned (the list may be empty) |
| `400` | `:id` is not a positive integer, or `cursor` is malformed |
| `401` | missing or invalid `Bearer` token |
| `403` | caller is neither the target user nor an admin |
| `404` | an admin requested a user that does not exist |

Error bodies are uniform:

```json
{ "error": { "code": "FORBIDDEN", "message": "You may not view these orders" } }
```

---

## How pagination works

Pages are **keyset** ("seek"), not offset-based. The cursor encodes the sort key
of the last row returned — `(created_at, id)`, base64url of `"<iso>|<id>"` — and
the next page asks for everything strictly after it:

```sql
WHERE user_id = $1
  AND (created_at < $cursorTs OR (created_at = $cursorTs AND id < $cursorId))
ORDER BY created_at DESC, id DESC
LIMIT $limit + 1        -- the extra row tells us has_more
```

This maps straight onto `idx_orders_user_created`, so page 1 and page 10,000 cost
the same. Skipping rows with `OFFSET` would re-scan and discard everything before
the current page. There is no total count in the response for the same reason —
counting a large account's orders on every request is the thing that gets slow
first (see [DECISIONS.md](DECISIONS.md) → *What breaks first at 100×*).

> The query is built with Prisma's query API, not its built-in `cursor`/`skip`
> helper — that helper keys on a single field and would skip or repeat rows that
> share a timestamp. Prisma still appends a constant `OFFSET 0` to the SQL; it is
> a no-op. Full reasoning in [DECISIONS.md](DECISIONS.md) → *What I used AI for*.

---

## Tests

```bash
npm test
```

`node:test` + `supertest`, run against `TEST_DATABASE_URL`. The suite migrates
that database, inserts its own small fixtures, and never touches the seeded
development data. Coverage:

- orders come back newest-first
- a user with no orders → `200` + `[]`
- keyset paging visits every order exactly once, in order, across pages
- caller views own orders → `200`; another user → `403`; admin → `200`
- missing / invalid token → `401`
- non-integer `:id` → `400`; oversized `limit` → clamped; bad `cursor` → `400`
- admin views a non-existent user → `404`

---

## Project structure

```
src/
  server.js          listen + graceful shutdown (SIGTERM → drain pool)
  app.js             buildApp() → Express instance (imported by tests)
  config.js          env parsing / validation
  db.js              PrismaClient + pg adapter (pool size, statement_timeout)
  auth.js            Bearer JWT → req.caller { id, role }
  errors.js          AppError + central error handler
  orders/
    routes.js        GET /users/:id/orders
    controller.js    authorization, validation, serialization
    repository.js    keyset query
    cursor.js        encodes / decodes the (created_at, id) cursor token

prisma/
  schema.prisma      User / Order models, mapped to snake_case tables
  migrations/         init + hand-written CHECK constraints
prisma.config.mjs    Prisma 7 CLI connection URL (kept out of the schema)

db/
  seed.js            ~5k users / ~50k orders, order counts deliberately skewed
  migrate-test.js    pretest hook — migrates the test database
scripts/
  token.js           npm run token [id] [role]
api.http             click-to-run requests for the VS Code REST Client
test/                node:test + supertest
```

---

## Tech stack

| Area | Choice |
| --- | --- |
| Runtime | Node.js 20+, Express 4 |
| Database | PostgreSQL 16 (Docker) |
| Data access | Prisma 7 over the `pg` driver adapter — models typed, migrations versioned |
| Auth | `jsonwebtoken` (HS256 Bearer) |
| Validation | `zod` (path + query only) |
| Logging | `pino` / `pino-http` |
| Tests | `node:test` + `supertest` |

---

## Design decisions

The reasoning behind the choices above — and the ones the spec left open — is in
**[DECISIONS.md](DECISIONS.md)**, which answers four questions:

1. **What the requirements did not tell me** — every assumption, with the riskiest one flagged.
2. **What I used AI for, and where I overrode it** — including why the data layer is Prisma and why the keyset predicate is written by hand.
3. **What breaks first at 100× the data** — the specific failure, and how to catch it before a customer does.
4. **What I deliberately did not build** — and why each omission was a choice.
