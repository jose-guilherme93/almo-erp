-- Garante no banco o que a aplicação promete em regra de negócio:
-- saldo e reserva nunca negativos, e reserva nunca maior que o saldo.
-- Sem isso, a única barreira contra saldo inconsistente é o código.

ALTER TABLE "stock_levels"
  ADD CONSTRAINT "stock_levels_quantity_nonnegative" CHECK ("quantity" >= 0);

ALTER TABLE "stock_levels"
  ADD CONSTRAINT "stock_levels_reserved_nonnegative" CHECK ("reserved_quantity" >= 0);

ALTER TABLE "stock_levels"
  ADD CONSTRAINT "stock_levels_reserved_lte_quantity" CHECK ("reserved_quantity" <= "quantity");
