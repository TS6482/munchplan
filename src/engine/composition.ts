/**
 * Pure composition engine (feature 004, steps 1 + 5) — no React, no store.
 * Owns every "which side pairs with this main" lookup: `pairedSides`/
 * `pairedSalads` (the raw pairing lists, for UI display), `validPairedSides`
 * (filtered to usable candidates, for ranking eligibility and auto-pick), and
 * `pickPairedSide` (the deterministic draw); `composeEntry` builds the full
 * `MealEntry` a ranked placement produces. Import direction is
 * `suggest -> composition -> match` (no cycle) — `isBlockedForAnyone` moved
 * here from `suggest.ts` because `validPairedSides` needs it too.
 */

import type { ComponentType, MealEntry, Recipe, SaleItem, Settings } from '../types';
import { blockedMatch, saleMatch } from './match';

/** The recipe's ingredient names blocked for `person` (empty if none). */
export function blockedIngredientsFor(recipe: Recipe, blocked: string[]): string[] {
  return recipe.ingredients
    .filter((ing) => blocked.some((term) => blockedMatch(term, ing.name)))
    .map((ing) => ing.name);
}

/** True when `recipe` is blocked for at least one person in `settings`. */
export function isBlockedForAnyone(recipe: Recipe, settings: Settings): boolean {
  return settings.persons.some((person) => blockedIngredientsFor(recipe, person.blocked).length > 0);
}

/**
 * Resolves `ids` against `recipes`, in stored order, keeping only referents
 * that (a) still exist and (b) still have `componentType: type`. Skips a
 * main referencing its own id and dedupes repeated ids (keeping the first
 * occurrence) — both guard against hand-edited/stale stored data.
 */
function resolvePaired(main: Recipe, recipes: Recipe[], ids: string[], type: ComponentType): Recipe[] {
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const result: Recipe[] = [];
  for (const id of ids) {
    if (id === main.id || seen.has(id)) continue;
    seen.add(id);
    const referent = byId.get(id);
    if (referent && referent.componentType === type) result.push(referent);
  }
  return result;
}

/** `main`'s paired přílohy: existing recipes still typed `side`, in stored order. */
export function pairedSides(main: Recipe, recipes: Recipe[]): Recipe[] {
  return resolvePaired(main, recipes, main.pairings.sides, 'side');
}

/** `main`'s paired saláty: existing recipes still typed `salad`, in stored order. */
export function pairedSalads(main: Recipe, recipes: Recipe[]): Recipe[] {
  return resolvePaired(main, recipes, main.pairings.salads, 'salad');
}

/**
 * `pairedSides` further filtered to sides not blocked for either person —
 * the "valid paired side" definition used by ranking eligibility, the
 * unpaired-main hint, and `pickPairedSide`. Blocked sides are excluded here
 * (not merely flagged): manual picks warn, but auto-composition never
 * silently attaches a blocked side.
 */
export function validPairedSides(main: Recipe, recipes: Recipe[], settings: Settings): Recipe[] {
  return pairedSides(main, recipes).filter((side) => !isBlockedForAnyone(side, settings));
}

/** True when any of `recipe`'s ingredients matches a sale item. */
function hasSaleMatch(recipe: Recipe, sales: SaleItem[]): boolean {
  return recipe.ingredients.some((ing) => sales.some((sale) => saleMatch(sale.name, ing.name)));
}

/**
 * Draws one of `main`'s valid paired sides: sale-matched sides are preferred
 * as a group (drawn uniformly within it) over the rest (also drawn
 * uniformly — sides carry no ranking, unlike `pickWeighted`'s harmonic main
 * draw); `null` when there are no valid sides. Exactly one `rng()` call.
 */
export function pickPairedSide(
  main: Recipe,
  recipes: Recipe[],
  sales: SaleItem[],
  settings: Settings,
  rng: () => number,
): Recipe | null {
  const valid = validPairedSides(main, recipes, settings);
  if (valid.length === 0) return null;

  const saleMatched = valid.filter((side) => hasSaleMatch(side, sales));
  const pool = saleMatched.length > 0 ? saleMatched : valid;
  const index = Math.floor(rng() * pool.length);
  return pool[index];
}

/**
 * Composes one `MealEntry` for `recipe`: gates on `componentType === 'main'`
 * BEFORE calling `rng` at all — a `full` (or `side`/`salad`, defensively)
 * recipe places bare with zero rng calls, keeping step 10's AC7
 * byte-identical claim true for all-`full` collections. A `main` draws one
 * paired side via `pickPairedSide`; `null` (no valid sides) places the main
 * alone, same as a `full` recipe.
 */
export function composeEntry(
  recipe: Recipe,
  recipes: Recipe[],
  sales: SaleItem[],
  settings: Settings,
  rng: () => number,
  idFn: () => string,
  source: 'auto' | 'manual',
): MealEntry {
  if (recipe.componentType !== 'main') {
    return { id: idFn(), recipeIds: [recipe.id], source };
  }
  const side = pickPairedSide(recipe, recipes, sales, settings, rng);
  const recipeIds = side ? [recipe.id, side.id] : [recipe.id];
  return { id: idFn(), recipeIds, source };
}
