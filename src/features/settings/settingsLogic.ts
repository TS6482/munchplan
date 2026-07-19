/**
 * Pure helpers for the settings screens (step 10) — no React, no store, no
 * fetch. Kept in a plain `.ts` module so it stays testable under Vitest's
 * node environment.
 */

import { normalizeName } from '../../engine/normalize';

// ---------------------------------------------------------------------------
// Data-repo config form
// ---------------------------------------------------------------------------

export interface ConfigInput {
  owner: string;
  repo: string;
  token: string;
}

export interface ConfigErrors {
  owner?: string;
  repo?: string;
  token?: string;
}

export type ConfigValidation = { ok: true } | { ok: false; errors: ConfigErrors };

/** Validates a config form: all three fields required (trimmed, non-empty). */
export function validateConfig(input: ConfigInput): ConfigValidation {
  const errors: ConfigErrors = {};
  if (!input.owner.trim()) errors.owner = 'Vyplňte vlastníka repozitáře';
  if (!input.repo.trim()) errors.repo = 'Vyplňte název repozitáře';
  if (!input.token.trim()) errors.token = 'Vyplňte token';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true };
}

/**
 * Splits a repo-field value that may be a plain repo name or a combined
 * "owner/repo" paste. No slash → repo only, owner left for the user to fill.
 */
export function parseRepoInput(input: string): { owner?: string; repo: string } {
  const trimmed = input.trim();
  const slashIdx = trimmed.indexOf('/');
  if (slashIdx === -1) return { repo: trimmed };
  const owner = trimmed.slice(0, slashIdx).trim();
  const repo = trimmed.slice(slashIdx + 1).trim();
  return owner ? { owner, repo } : { repo };
}

// ---------------------------------------------------------------------------
// Diet rule form
// ---------------------------------------------------------------------------

export type DietRuleParseResult = { ok: true; min?: number; max?: number } | { ok: false; error: string };

/** `"5"` → 5, rejects negatives, decimals, and non-numeric input. */
function parseNonNegativeInt(s: string): number | null {
  if (!/^\d+$/.test(s)) return null;
  return parseInt(s, 10);
}

export function validateDietRule(category: string, minStr: string, maxStr: string): DietRuleParseResult {
  if (!category.trim()) return { ok: false, error: 'Vyplňte kategorii' };

  const minTrim = minStr.trim();
  const maxTrim = maxStr.trim();
  if (!minTrim && !maxTrim) return { ok: false, error: 'Zadejte alespoň min nebo max' };

  let min: number | undefined;
  let max: number | undefined;

  if (minTrim) {
    const parsed = parseNonNegativeInt(minTrim);
    if (parsed === null) return { ok: false, error: 'Min musí být celé číslo ≥ 0' };
    min = parsed;
  }
  if (maxTrim) {
    const parsed = parseNonNegativeInt(maxTrim);
    if (parsed === null) return { ok: false, error: 'Max musí být celé číslo ≥ 0' };
    max = parsed;
  }
  if (min !== undefined && max !== undefined && min > max) {
    return { ok: false, error: 'Min nesmí být větší než max' };
  }
  return { ok: true, min, max };
}

// ---------------------------------------------------------------------------
// Rotation weeks
// ---------------------------------------------------------------------------

export type RotationParseResult = { ok: true; weeks: number } | { ok: false; error: string };

export function parseRotationWeeks(str: string): RotationParseResult {
  const trimmed = str.trim();
  const parsed = parseNonNegativeInt(trimmed);
  if (parsed === null) return { ok: false, error: 'Zadejte celé číslo ≥ 0' };
  return { ok: true, weeks: parsed };
}

// ---------------------------------------------------------------------------
// Blocked-ingredients list
// ---------------------------------------------------------------------------

/** Adds `name`, deduping by normalized name; keeps the existing display spelling on a duplicate. */
export function blockedListAdd(list: string[], name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return list;
  const norm = normalizeName(trimmed);
  if (list.some((item) => normalizeName(item) === norm)) return list;
  return [...list, trimmed];
}

/** Removes any entry matching `name` by normalized comparison. */
export function blockedListRemove(list: string[], name: string): string[] {
  const norm = normalizeName(name);
  return list.filter((item) => normalizeName(item) !== norm);
}
