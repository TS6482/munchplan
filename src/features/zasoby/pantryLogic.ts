/**
 * Pure helpers for the Zásoby screen's "Spíž" (pantry) segment (step 12) —
 * no React, no store, no fetch.
 */

import type { Pantry, PantryItem } from '../../types';
import { normalizeName } from '../../engine/normalize';
import { formatAmount } from '../recipes/recipeFormLogic';

export type ValidatePantryNameResult = { ok: true; isUpdate: boolean } | { ok: false; error: string };

/**
 * A normalized-duplicate name is not an error: the store's `addPantryItem`
 * upserts (newer amount/unit wins), so callers get `isUpdate: true` to
 * reflect that intent, not a validation failure (mirrors salesLogic).
 */
export function validatePantryName(name: string, pantry: Pantry): ValidatePantryNameResult {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Vyplňte název' };

  const norm = normalizeName(trimmed);
  const isUpdate = pantry.some((item) => normalizeName(item.name) === norm);
  return { ok: true, isUpdate };
}

/** Czech-locale alphabetical sort by name; does not mutate the input. */
export function sortedPantry(pantry: Pantry): Pantry {
  return pantry.slice().sort((a, b) => a.name.localeCompare(b.name, 'cs'));
}

/** Display text for a pantry row: 'name', or 'name — amount unit' when an amount is known. */
export function pantryItemText(item: PantryItem): string {
  if (item.amount === undefined) return item.name;
  const amountText = item.unit ? `${formatAmount(item.amount)} ${item.unit}` : formatAmount(item.amount);
  return `${item.name} — ${amountText}`;
}
