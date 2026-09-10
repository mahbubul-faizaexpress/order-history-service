# DECISIONS

`GET /api/users/:id/orders` — a user's order history.

The brief was four lines and four requirements, "deliberately incomplete". This
document is where I made it complete: the assumptions I closed, the trade-offs I
took, and the things I chose not to do. It is written to be argued with.

---

## The shape, in one paragraph

One read endpoint. Express in front, a thin controller that does
**authorize → fetch → serialize**, a repository that owns the one SQL access
pattern, and Prisma 7 (over the `pg` driver adapter) as the data layer. Pagination
is keyset. Auth is a Bearer JWT reduced to `req.caller = { id, role }` at the
edge so nothing downstream knows how identity arrived. The interesting decisions
are all about the second requirement — *stay responsive as orders grow* — because
that is the one with teeth.

```
request
  │  requireAuth ........... JWT → req.caller { id, role }        (src/auth.js)
  ▼
orders/controller ......... validate params, authorize,          (src/orders/)
  │                          decode cursor, shape the response
  ▼
orders/repository ......... the single keyset query
  ▼
Prisma 7 + pg adapter ..... pool size + statement_timeout owned here (src/db.js)
  ▼
Postgres ................. idx_orders_user_created does the work
```

---

## 1. What the requirements did not tell me

### Assumptions (riskiest one flagged)

1. **How the caller's identity arrives.** I assumed a verified HS256 JWT in
   `Authorization: Bearer <token>` with `sub` = user id and `role` ∈
   `{customer, admin}`. `auth.js` verifies the signature so the service runs
   standalone, but in a real deployment an API gateway owns verification and this
   code reads trusted claims.
   **→ This is the assumption I am least confident about.** If identity actually
   comes from a session cookie, an opaque token introspected against an auth
   service, or an `X-User-Id` header set by a trusted proxy, `auth.js` is
   rewritten. Nothing else moves — every layer below depends only on the shape
   `req.caller`. I made the blast radius of being wrong here exactly one file.

2. **"Newest" means `orders.created_at`.** No `updated_at`, no business "placed
   at" distinct from row creation. If orders can be back-dated, both the sort
   column and the index change.

3. **Pagination is mandatory, and keyset — not page numbers.** Requirement #2
   only means something if the response is bounded. Default `limit` 20, max 100,
   opaque `next_cursor`. Rationale for keyset over `?page=N` is in §3.

4. **"No orders" is `200` with `{ "data": [] }`, not `404`.** The user resource
   exists; the collection is empty. `404` is about the user, and requirement #3
   frames the empty case as normal, not an error.

5. **An admin asking about a non-existent user gets `404`.** The only place an
   existence check earns its cost. A caller asking about *themselves* skips it — a
   valid token implies the row exists.

6. **Response fields:** `id, status, total_amount, currency, created_at`. I did
   not invent line items, addresses or payment references. `total_amount` is
   returned as a **string** (`DECIMAL(12,2)` in the DB, `Prisma.Decimal` at
   runtime) — routing money through a JS `number` silently rounds.

7. **Tiebreak on equal `created_at` is `id` descending.** Imported/seeded data
   routinely shares timestamps to the second. Without a unique tiebreak the sort
   is non-deterministic and keyset pagination drops or repeats rows at page
   boundaries. The index carries the tiebreak column for this reason.

8. **Schema and seed.** The brief says both are "provided"; they were not in the
   package I received. `prisma/schema.prisma` and `db/seed.js` are my
   reconstruction at the stated size (~5k users, ~50k orders, order counts
   deliberately skewed so a handful of accounts are large). If the real schema
   differs, only the model names need reconciling — the migration regenerates.

9. **Single currency per order, stored as a plain column.** No FX, no minor-unit
   integers. Fine at this scale; flagged in §4.

10. **`limit` is a hint, `id` and `cursor` are contracts.** A garbage `limit`
    falls back to the default; a garbage `id` or `cursor` is a `400`. The former
    is a client convenience knob, the latter two are load-bearing.

---

## 2. What I used AI for, and where I overrode it

I generated the whole scaffold with Claude Code, then reworked it. The overrides
that mattered:

1. **Raw `pg` → Prisma 7.** The first scaffold was `pg` with hand-written SQL.
   I moved the data layer to Prisma so the schema is one typed source of truth and
   migrations are generated and version-controlled. Prisma 7 splits the
   connection: the CLI URL lives in `prisma.config.mjs`, and the app hands its own
   `pg` pool to `new PrismaClient({ adapter })`. That is more parts than Prisma
   6's `datasource.url`, but it hands pool size and `statement_timeout` back to
   `src/db.js` where I want them. **Honest position:** for *one* endpoint I would
   normally reach for raw `pg` with a query builder or tagged-template SQL —
   Prisma earns its keep at three or four read models, or on a team that has
   standardised on it. I have kept it disciplined: one repository, one query, the
   pool under my control, and a documented exit to `$queryRaw` (below).

2. **Prisma's built-in cursor pagination is wrong here — kept an explicit
   predicate.** `findMany({ cursor, skip: 1 })` keys on a single unique field, so
   with a compound `(created_at, id)` sort it walks `id` order and skips or
   repeats rows that share a timestamp. AI's first Prisma pass used it. I replaced
   it with an explicit `WHERE created_at < $ts OR (created_at = $ts AND id < $id)`
   built through the query API, and a cursor carrying **both** parts. `EXPLAIN`
   confirms it still rides `idx_orders_user_created` (§3).

3. **`OFFSET` / `skip`.** The raw-SQL draft paginated with `LIMIT/OFFSET`;
   Prisma's `skip` is the same trap. `O(offset)` — page 5,000 of a large account
   reads and discards a million rows. Keyset is flat per page. This *is*
   requirement #2.

4. **`COUNT(*)` for a total.** The generated response carried `page.total`. On a
   large account that scans every matching row on every request. Removed;
   `has_more` comes free from fetching `limit + 1` rows.

5. **Existence check moved off the hot path.** The draft queried the user row on
   every non-self request, before fetching orders. I reordered it: fetch orders
   first; only when the result is empty *and* the caller is not the target do we
   spend a second query to tell "no orders" from "no such user". The common admin
   case — asking about an active account — is now one round trip, not two.

6. **CHECK constraints.** Prisma's schema language can't express them and AI just
   dropped `role` / `status` / `total_amount >= 0`. They are data invariants, not
   app validation, so they belong in the database — restored in a hand-written
   migration (`20260910124500_add_check_constraints`).

7. **Seed.** Generated as a 50,000-iteration loop of single-row inserts. Rewrote
   with `createMany` in 5,000-row chunks and an `ANALYZE` at the end so the
   planner has statistics before the first request.

8. **`statement_timeout`, pool bounds, connect timeout.** None were in the
   generated code. Set on the `pg` pool in `src/db.js` (§3).

9. **Environment validation.** The generated `config.js` read `process.env`
   ad hoc and would fail on the first request with a vague error. Replaced with a
   zod schema parsed once at boot: missing/invalid vars stop the process with a
   list of exactly what is wrong, and the dev-default `JWT_SECRET` is refused when
   `NODE_ENV=production`.

10. **`Decimal` / `BigInt` serialization.** Prisma returns `id` as `BigInt`
    (`JSON.stringify` throws) and `total_amount` as `Decimal` (the draft coerced
    it through a float). The serializer now does `Number(id)` and
    `decimal.toFixed(2)` in one place — `src/orders/serializer.js`.

11. **Cursor hardening.** The draft decoder accepted anything that base64-decoded
    to a string containing `|`. It now re-encodes what it parsed and rejects the
    input unless it is the exact canonical form — trailing bytes, non-canonical
    timestamps and casual tampering all become `400`.

---

## 3. What breaks first at 100× this data

100× ≈ **5,000,000 orders, ~500,000 users.**

**The query does not break.** Keyset + `idx_orders_user_created` keeps every page
a bounded index scan, independent of account size or page depth. `EXPLAIN ANALYZE`
on the SQL Prisma emits, mid-pagination on a large account:

```
Limit  (actual time=0.041..0.051 rows=21 loops=1)
  ->  Index Scan using idx_orders_user_created on orders
        Index Cond: (user_id = 2)
        Filter: ((created_at < now()) OR ((created_at = now()) AND (id < 999999)))
Execution Time: 0.109 ms
```

No sort node, no heap access beyond the rows returned. The boundary is a `Filter`
rather than part of the `Index Cond` because Prisma's API cannot emit the
row-value form `(created_at, id) < ($ts, $id)`; the scan still walks the index in
order and stops at `LIMIT`, so a few extra index tuples are touched at the page
boundary and nothing more. If that ever showed up in a profile, this one query
drops to `$queryRaw` with the tuple comparison — a five-line change in one file.

**What breaks first: the connection pool, and the timeout cascade behind it.**

The `pg` pool is fixed at `DB_POOL_MAX` (default 10). At 100× this endpoint serves
100× the traffic *and* shares Postgres with 100× of everyone else's load —
reporting queries, a backfill, an unindexed query someone shipped last week. Mean
latency on *our* query drifts from ~2 ms to ~30–50 ms under that contention, and
then:

- in-flight requests × latency exceeds the 10 pool slots;
- new checkouts wait, hit `connectionTimeoutMillis`, and error;
- the load balancer retries, adding load;
- p95 goes from 40 ms to seconds, then 503s.

The endpoint's own code never changed. This is the classic "fine in staging"
failure — it is a property of the system under load, not of a line of code.

**How I would catch it before a customer does:**

| Signal | What it tells you |
| --- | --- |
| p95 / p99 latency **per route**, alerted | the mean stays healthy long after the tail has broken |
| `pg` pool `waitingCount` > 0 for more than a few seconds | the pool is the bottleneck, right now |
| `pg_stat_statements`: `mean_exec_time` **and** `stddev_exec_time` for this query | rising stddev is the earliest sign the DB is contended, before the mean moves |
| slow-query log at 100 ms | a plan regression (e.g. the index silently unused after a migration) shows on the first slow call, not the thousandth |
| load test against a **100×-seeded** DB before shipping | planner stats and cache behaviour are only representative at real size |

**Secondary failure modes, roughly in order:**

- A single very large account whose client paginates to the tail — thousands of
  sequential requests is its own load pattern even though each page is cheap. A
  `max_pages` guard, or "history older than N months is an async export", bounds
  it.
- Write amplification: `idx_orders_user_created` is a wide index; at 100× the
  insert path pays more per write. Watch insert latency and index bloat.
- The `orders` table itself: at 5M rows, still fine; the moment archival or
  multi-tenant isolation enters the picture, this is where **range partitioning by
  `created_at`** (or hash by `user_id`) goes, and the keyset query is already
  partition-friendly.

**What the SLO should be:** this is a read of the user's own data behind a login —
p99 < 150 ms, availability 99.9%, error budget spent mostly on deploys. The
alerting above is sized to that, not to a number pulled from the air.

---

## 4. What I deliberately did not build

Each of these is a cut, not an oversight.

- **Page-number pagination (`?page=5`).** Keyset can't random-access, and the
  requirement is "responsive", which keyset serves and `OFFSET` does not. Real
  jump-to-page is a different endpoint with a different cost profile and needs its
  own justification. *(This is also the answer to "the requirement just changed to
  add pagination": it is already here — `cursor` in, `next_cursor` out — and it
  lives entirely in the controller and repository.)*

- **Caching (Redis or otherwise).** Nothing to cache at 50k orders. At 100× it
  sits in the repository keyed by `(user_id, cursor, limit)` with a short TTL,
  invalidated on that user's new-order event. Not built now, because caching a
  query I haven't load-tested just serves the wrong thing faster.

- **Order filtering (status, date range) and sparse field selection.** No
  requirement; each adds index and validation surface. The query schema is the
  place to add it.

- **Rate limiting.** A gateway concern. Called out so its absence here reads as a
  decision, not a gap.

- **A real auth service — refresh tokens, RBAC beyond one `admin` bit, scopes.**
  The spec has two roles and one rule. `auth.js` is the thinnest thing that
  satisfies it and is explicitly the first file to be replaced.

- **Signed / encrypted cursors.** The cursor is opaque and validated for
  integrity but not authenticated. Forging one only lets a caller page through
  *their own* orders from an arbitrary offset — `user_id` and the authz check are
  not in the cursor. An HMAC is a two-line addition if a cursor ever carries
  something trust-sensitive.

- **Prisma extras:** `$transaction` for the seed (chunked `createMany` is enough
  and faster), Prisma Migrate as a CI gate, `relationMode` (Postgres enforces the
  FK directly).

- **OpenAPI document, distributed tracing (OTel), an app Dockerfile,
  Prometheus wiring.** Time budget. The README is the API contract; §3 says
  exactly which metrics matter when it is time to add them.

---

## Architecture notes

**Why the layers.** Three responsibilities that change for different reasons:
*how identity arrives* (`auth.js`), *what the rule is* (`controller.js`), *how the
data is fetched* (`repository.js`). Each seam is where a plausible requirement
change lands — new auth mechanism, new role rule, new access pattern — and none of
them ripple. The serializer is a fourth seam: the wire shape of an order is one
file, so adding a field or versioning the response is a contained change.

**Where it bends under the likely next tickets:**

| Next ticket | Where it goes |
| --- | --- |
| add pagination | already done — `cursor` param, `next_cursor` in the envelope |
| filter by status / date | `querySchema` + `where` clause in the repository; may need a second index |
| "orders for my whole org" (admin) | new repository method, same keyset shape, index becomes `(org_id, created_at, id)` |
| another resource (`/invoices`) | copy the `orders/` folder; `auth`, `errors`, `cursor`, `async-handler` are already shared |
| move hot reads off Prisma | repository is the only file that imports the client |

**Operational shape.** `/health` is liveness (process only — a failing DB must not
get a healthy pod killed); `/health/ready` is readiness (pings Postgres). Every
response carries `x-request-id`, reusing an upstream one if the gateway set it.
Shutdown is graceful: stop accepting, drain the pool, hard-exit after 10s.
`statement_timeout` and a bounded pool mean one bad query degrades this service
rather than taking Postgres with it.

**Data model at scale.** The single composite index is the whole performance
story today. The first structural change at real volume is range-partitioning
`orders` by `created_at`; the keyset query already includes `created_at` in the
predicate, so it stays partition-pruned without a rewrite.

---

### If I had to cut this in half

Drop `cursor.js`, the serializer's paging logic, and `has_more`. Ship a hard
`LIMIT 50`, newest first, no pagination, and one paragraph here saying pagination
is the known next step and exactly where it slots in. Requirements 1, 3 and 4 stay
fully met; requirement 2 is met for the ~99% of accounts under 50 orders and
consciously deferred for the rest. Everything else — the authz split, the index,
the money handling, the bounded pool, graceful shutdown — is already the floor,
not the polish.
