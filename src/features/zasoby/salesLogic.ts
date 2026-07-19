/**
 * Pure helpers for the Zásoby screen's "Slevy" (sale list) segment (step 12)
 * — no React, no store, no fetch.
 */

import type { SaleItem } from '../../types';
import { normalizeName } from '../../engine/normalize';

export type ValidateSaleNameResult = { ok: true; isUpdate: boolean } | { ok: false; error: string };

/**
 * A normalized-duplicate name is not an error: the store's `upsertSaleItem`
 * merges into the existing entry (newer note wins), so callers get
 * `isUpdate: true` to reflect that intent, not a validation failure.
 */
export function validateSaleName(name: string, existing: SaleItem[]): ValidateSaleNameResult {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Vyplňte název' };

  const norm = normalizeName(trimmed);
  const isUpdate = existing.some((item) => normalizeName(item.name) === norm);
  return { ok: true, isUpdate };
}

/** Czech-locale alphabetical sort by name; does not mutate the input. */
export function sortedSales(sales: SaleItem[]): SaleItem[] {
  return sales.slice().sort((a, b) => a.name.localeCompare(b.name, 'cs'));
}
