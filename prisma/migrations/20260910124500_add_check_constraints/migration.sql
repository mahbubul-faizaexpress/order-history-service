-- Prisma's schema language cannot express CHECK constraints, so they live in a
-- hand-written migration. They are real invariants of the data, not app-level
-- validation, so they belong in the database.

ALTER TABLE "users"
  ADD CONSTRAINT "users_role_check"
  CHECK ("role" IN ('customer', 'admin'));

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_status_check"
  CHECK ("status" IN ('pending', 'paid', 'shipped', 'delivered', 'cancelled'));

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_total_amount_check"
  CHECK ("total_amount" >= 0);
