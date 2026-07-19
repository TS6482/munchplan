/**
 * Pure helpers for the Zásoby screen's "Spíž" (pantry) segment (step 12) —
 * no React, no store, no fetch.
 */

import type { Pantry } from '../../types';
import { normalizeName } from '../../engine/normalize';

export type ValidatePantryNameResult = { ok: true } | { ok: false; error: string };

export function validatePantryName(name: string, pantry: Pantry): ValidatePantryNameResult {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: 'Vyplňte název' };

  const norm = normalizeName(trimmed);
  if (pantry.some((item) => normalizeName(item) === norm)) return { ok: false, error: 'Už je ve spíži' };

  return { ok: true };
}

/** Czech-locale alphabetical sort; does not mutate the input. */
export function sortedPantry(pantry: Pantry): Pantry {
  return pantry.slice().sort((a, b) => a.localeCompare(b, 'cs'));
}
