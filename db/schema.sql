-- Assumed schema. The assignment says a schema is "provided" but it was not in
-- the handout; if the real one differs, only column names need reconciling.

DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id          BIGSERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id),
  status        TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'shipped', 'delivered', 'cancelled')),
  total_amount  NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
  currency      TEXT NOT NULL DEFAULT 'BDT',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Requirement #2: serves the WHERE + ORDER BY of the history query directly,
-- so pagination cost is independent of how many orders the user has.
CREATE INDEX idx_orders_user_created
  ON orders (user_id, created_at DESC, id DESC);
