-- Suporte a lote nos fluxos que antes não o carregavam:
--  * a reserva guarda o lote escolhido na aprovação (FEFO);
--  * a linha de transferência guarda o lote enviado, para receber/devolver o mesmo.

ALTER TABLE "stock_reservations" ADD COLUMN "item_lot_id" TEXT;
ALTER TABLE "transfer_lines" ADD COLUMN "item_lot_id" TEXT;

ALTER TABLE "stock_reservations"
  ADD CONSTRAINT "stock_reservations_item_lot_id_fkey"
  FOREIGN KEY ("item_lot_id") REFERENCES "item_lots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transfer_lines"
  ADD CONSTRAINT "transfer_lines_item_lot_id_fkey"
  FOREIGN KEY ("item_lot_id") REFERENCES "item_lots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "stock_reservations_item_lot_id_idx" ON "stock_reservations"("item_lot_id");
CREATE INDEX "transfer_lines_item_lot_id_idx" ON "transfer_lines"("item_lot_id");
