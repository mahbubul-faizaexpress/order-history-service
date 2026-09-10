# DECISIONS

`GET /api/users/:id/orders` — user order history.

The spec was four lines and four requirements. Everything below is where I had to
fill a gap, and why I filled it the way I did.

---

## 1. What the requirements did not tell me

### Assumptions

1. **How the caller's identity arrives.** I assumed a verified HS256 JWT in
   `Authorization: Bearer <token>` with `sub` = user id and `role` in
   `{customer, admin}`. The endpoint verifies the signature itself so it is
   self-contained, but in a real deployment an upstream gateway would do that and
   this code would only read claims. **← This is the assumption I am least
   confident about.** If identity actually comes from a session cookie, an opaque
   token introspected against an auth service, or an `X-User-Id` header set by a
   trusted proxy, the `auth.js` middleware changes completely. Nothing else does —
   the controller only depends on `req.caller = { id, role }`.

2. **"Newest" means `orders.created_at`.** I did not assume an `updated_at` or a
   business "order date" distinct from row creation. If orders can be back-dated
   or have a separate `placed_at`, the sort column and the index both change.

3. **Pagination is required, and it is keyset, not page numbers.** Requirement #2
   ("must stay responsive as the number of orders grows") only means something if
   the response is bounded. I return at most `limit` orders (default 20, max 100)
   with an opaque `next_cursor`. I did not build `?page=N` — see §3 and §4.

4. **No-orders is `200 { "data": [] }`, not `404`.** The user resource exists; the
   collection is empty. A `404` would be for the user, and requirement #3 frames
   this as a normal case to handle, not an error.

5. **An admin asking about a non-existent user gets `404`.** This is the one place
   an existence check earns its keep. A caller asking about *themselves* skips the
   check — a valid token implies the row exists (or existed when issued).

6. **Response fields.** `id, status, total_amount, currency, created_at`. I
   excluded anything I would have to guess at (line items, addresses, payment
   refs). `total_amount` is returned as a **string** because it is `NUMERIC` —
   serializing through a JS `number` would silently round large or fractional
   amounts.

7. **Tiebreak on equal `created_at` is `id` descending.** Seeded/imported data
   routinely shares timestamps to the second. Without a unique tiebreak the sort
   is non-deterministic and keyset pagination drops or repeats rows at page
   boundaries.

8. **Data size.** The handout says a schema and seed are "provided"; they were not
   in the package I received. `db/schema.sql` and `db/seed.js` are my
   reconstruction at the stated size (~5k users, ~50k orders, order counts
   deliberately skewed). If the real schema differs, only column names need
   reconciling.

9. **Currency is a plain column, single-currency per order.** No FX, no minor-unit
   integer storage. Fine at this scale; called out in §4.

---

## 2. What I used AI for, and where I overrode it

I used Claude (Claude Code) to generate the scaffold end to end, then corrected it.
Specific overrides:

1. **Cursor key.** The first cut encoded the cursor as just the last row's `id`
   and paginated with `WHERE id < $cursor`. That is wrong for a `created_at`-
   ordered list: `id` order and `created_at` order are not the same, so pages
   would skip and repeat rows. I changed the cursor to carry **both**
   `(created_at, id)` and the query to the row-value comparison
   `(created_at, id) < ($ts, $id)`, which matches the composite index exactly.

2. **`OFFSET` vs keyset.** The initial repository used `LIMIT $n OFFSET $m`. That
   is O(offset) — page 5,000 of a whale account scans and discards a million rows.
   Replaced with keyset (constant cost per page). This is the whole point of
   requirement #2, so it was not a detail to leave to the generator.

3. **`COUNT(*)` for a total.** The generated response included
   `page.total = SELECT count(*) WHERE user_id`. On a large account that is an
   index-only scan of every matching row on every request. I removed it; the
   response exposes `has_more` (derived from fetching `limit + 1` rows) and
   nothing that requires counting.

4. **Existence check on every request.** The draft ran
   `SELECT 1 FROM users WHERE id = $1` unconditionally. I scoped it to the only
   case that needs it (caller ≠ target), removing one round trip from the hot path
   (a user reading their own history).

5. **Seed script.** Generated as a `for` loop of single-row `INSERT`s — ~50,000
   network round trips, minutes of runtime. Rewrote as batched 1,000-row
   multi-`VALUES` inserts inside one transaction, plus an `ANALYZE` at the end so
   the planner has stats immediately.

6. **`statement_timeout`.** Not in the generated code. Added it per pooled
   connection so a pathological query cannot pin a pool slot forever (see §3).

7. **Float money.** The generated serializer did `Number(row.total_amount)`. Left
   it as the `NUMERIC` string instead.

---

## 3. What breaks first at 100× this data

100× ≈ **5,000,000 orders, ~500,000 users**.

The paginated query itself does **not** break — keyset + `idx_orders_user_created`
keeps every page a bounded index range scan regardless of account size or page
depth. That was the design goal and it holds. On the seeded data (`EXPLAIN
ANALYZE` on a whale account):

```
Limit  (actual time=0.022..0.035 rows=21 loops=1)
  ->  Index Scan using idx_orders_user_created on orders
        Index Cond: ((user_id = 2) AND (ROW(created_at, id) < ROW(now(), ...)))
Execution Time: 0.124 ms
```

No sort node, no heap scan beyond the 21 rows returned.

**What breaks first: pg connection-pool saturation, and the timeout cascade behind
it.**

The pool is fixed (`DB_POOL_MAX`, default 10). At 100× the same endpoint is also
serving 100× the traffic, and it now shares the database with 100× everyone
else's load — reporting queries, backfills, an unindexed query someone shipped
last week. Mean latency on *our* query drifts from ~2 ms to ~30–50 ms under that
contention. At that point:

- in-flight requests × latency exceeds the 10 pool slots,
- new requests queue on `connectionTimeoutMillis` (5 s), then error,
- the load balancer retries, adding load,
- p95 goes from 40 ms to multiple seconds, then 503s.

The endpoint's own code is unchanged and looks innocent in isolation. This is the
classic "it was fine in staging" failure.

**How I would detect it before a customer reports it:**

- **p95/p99 latency alert per route** (not just an average) — the average stays
  fine long after the tail has broken.
- **Pool telemetry**: `pool.waitingCount` and `pool.idleCount` exported to
  metrics; alert when `waitingCount > 0` for more than a few seconds.
- **`pg_stat_statements`** — watch `mean_exec_time` and `stddev_exec_time` for the
  history query specifically; a rising stddev is the early signal that the DB is
  contended even before our mean moves much.
- **Slow-query log** at 100 ms so a regression in the query plan (e.g. the index
  silently not being used after a schema change) surfaces on the first slow call,
  not the thousandth.
- **Load test at 100× before shipping** — replay realistic traffic against a
  100×-seeded database, not a fresh one, so planner stats and buffer-cache
  behaviour are representative.

Secondary failure modes, in rough order:

- A single "whale" account (say 2M orders) whose client paginates to the very
  tail. Keyset stays cheap per page, but thousands of sequential requests is its
  own load pattern; a `max_pages` guard or a hard "history older than N months
  requires an export" rule would bound it.
- Write amplification: `idx_orders_user_created` is a wide index; at 100× the
  order-insert path pays more per write. Detect via insert latency on the orders
  table and index bloat monitoring.

---

## 4. What I deliberately did not build

Each of these was a conscious cut, not an oversight.

- **Page-number pagination (`?page=5`).** Keyset cannot random-access to page 5,
  and the requirement is "stay responsive", which keyset serves and `OFFSET` does
  not. If product genuinely needs jump-to-page, that is a different endpoint with
  a different cost profile and should be argued for explicitly. *(This is also the
  "requirement just changed to include pagination" answer: it already has it —
  cursor in, `next_cursor` out, in the repository and controller only.)*

- **Redis / any caching.** Pointless at 50k orders. At 100× it would sit in
  `repository.js` keyed by `(user_id, cursor, limit)` with a short TTL, invalidated
  on new-order events for that user. Not built because caching an incorrect or
  slow query just serves it faster.

- **Order filtering** (by status, date range) and **field selection**. No
  requirement, and each adds index and validation surface. Easy to add to the
  querystring schema later.

- **Rate limiting.** Belongs at the gateway, not in this service. Noted so the
  reviewer knows it is not assumed to be absent in production.

- **A real auth service / token refresh / RBAC beyond `admin`.** The spec has
  exactly two roles and one rule. `auth.js` is deliberately the thinnest thing
  that satisfies it and is the first file to be replaced in a real system.

- **Migration tooling.** One table set; `schema.sql` applied once is enough. A
  second table would justify `node-pg-migrate`.

- **OpenAPI spec, request tracing (OTel), Dockerfile for the app itself.** Time
  budget. The README covers the run path; the response shapes are small enough to
  document by hand.

- **Cursor tamper-proofing.** The cursor is base64, not signed. A client can forge
  one, but the worst outcome is seeing *their own* orders from an arbitrary
  offset — the `user_id` filter and the authz check are not in the cursor. If
  cursors ever encoded anything trust-sensitive, they would need an HMAC.

---

### If I had to cut this in half

Drop the `cursor.js` module and `has_more` machinery, ship a hard `LIMIT 50`
newest-first with no pagination at all, and write one paragraph in this file
saying pagination is the known next step and where it goes. Requirements 1, 3 and
4 stay fully met; requirement 2 is met for the 99% of accounts under 50 orders and
explicitly deferred for the rest. Everything else here — the authz split, the
index, the money handling, the graceful shutdown — is already the minimum.
