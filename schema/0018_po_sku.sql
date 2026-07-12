-- Migration 0018: SKU (base-unit) quantity + unit on PO lines.
--
-- SAP ALV PO exports now carry a SECOND "Quantity" column (total units in the
-- article's SKU / base unit, e.g. 24 EA) and a "SKU" unit code, alongside the
-- order Quantity (in the order/price unit, e.g. 3 CS) and its OPU code.
--
-- net_price_cents is per ORDER unit (per case), so unit price on Article
-- Analysis was overstated by the case pack size. The true unit price is derived
-- (NOT by mutating stored lines): unit_price = line_value_cents / sku_qty.
--
-- Nullable on purpose: older exports had no SKU columns, so historical lines
-- stay NULL and their unit price falls back to the per-order-unit figure
-- (clearly labelled). Re-uploading a period's export with the SKU columns
-- corrects that period going forward.
ALTER TABLE po_lines ADD COLUMN sku_qty REAL;
ALTER TABLE po_lines ADD COLUMN sku_uom TEXT;
