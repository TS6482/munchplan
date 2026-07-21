/**
 * Pure view-model for the meal detail page (feature 002, step 9) — no React,
 * no store, no fetch. Wraps engine functions (week/autoFill) and recipe
 * lookups into shapes MealDetailPage renders directly.
 */

import type { IsoDay, MealEntry, MealSlotKey, Plans, Recipe, SaleItem, Settings, WeekKey, WeekPlan } from '../../types';
import { dateOfDay } from '../../engine/week';
import { buildAutoFill, type AutoFillPlacement } from '../../engine/autoFill';
import { formatPortions } from '../recipes/recipeFormLogic';
import { SLOT_LABELS } from '../../components/slotLabels';
import { routeHash } from '../../router/router';
import { DAY_LABELS, czechDate } from './planLogic';

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export interface MealHeader {
  dayLabel: string;
  dateText: string;
  slotLabel: string;
  backHash: string;
}

/** Czech day/date/slot header for the meal detail page, with a week-scoped back link. */
export function mealHeader(week: WeekKey, day: IsoDay, slot: MealSlotKey): MealHeader {
  return {
    dayLabel: DAY_LABELS[day],
    dateText: czechDate(dateOfDay(week, day)),
    slotLabel: SLOT_LABELS[slot],
    backHash: routeHash({ name: 'plan', week }),
  };
}

// ---------------------------------------------------------------------------
// Entry rows
// ---------------------------------------------------------------------------

export interface RecipeLink {
  id: string;
  name: string;
  deleted: boolean;
}

export interface EntryRow {
  entryId: string;
  displayName: string;
  recipeLinks: RecipeLink[];
  untriedBadge: boolean;
  portionsText: string | null;
  source: 'auto' | 'manual';
}

/**
 * Per-entry rows for (day, slot) of `weekPlan` — resolves recipe names,
 * per-recipe detail links (a deleted recipeId falls back to "smazaný
 * recept"), an untried badge (true if any recipe in the entry is untried),
 * and portions text (single-recipe entries only; multi-recipe entries keep
 * it `null` — kept simple per plan). A missing week or empty slot yields [].
 */
export function entryRows(weekPlan: WeekPlan | undefined, day: IsoDay, slot: MealSlotKey, recipes: Recipe[]): EntryRow[] {
  const entries = weekPlan?.days[day][slot] ?? [];
  const byId = new Map(recipes.map((r) => [r.id, r]));

  return entries.map((entry) => {
    const recipeLinks: RecipeLink[] = entry.recipeIds.map((id) => {
      const recipe = byId.get(id);
      return recipe ? { id, name: recipe.name, deleted: false } : { id, name: 'smazaný recept', deleted: true };
    });

    const untriedBadge = entry.recipeIds.some((id) => byId.get(id)?.untried === true);

    let portionsText: string | null = null;
    if (entry.recipeIds.length === 1) {
      const recipe = byId.get(entry.recipeIds[0]);
      if (recipe?.portions) portionsText = formatPortions(recipe.portions);
    }

    return {
      entryId: entry.id,
      displayName: recipeLinks.map((l) => l.name).join(' + '),
      recipeLinks,
      untriedBadge,
      portionsText,
      source: entry.source,
    };
  });
}

// ---------------------------------------------------------------------------
// New manual entry
// ---------------------------------------------------------------------------

/** A manual single-recipe entry; id from the injected `idFn` (default `crypto.randomUUID` in the component layer). */
export function newManualEntry(recipeId: string, idFn: () => string): MealEntry {
  return { id: idFn(), recipeIds: [recipeId], source: 'manual' };
}

// ---------------------------------------------------------------------------
// Reroll this slot
// ---------------------------------------------------------------------------

export interface RerollInput {
  recipes: Recipe[];
  plans: Plans;
  sales: SaleItem[];
  settings: Settings;
  week: WeekKey;
  activeSlots: MealSlotKey[];
}

export interface RerollResult {
  placements: AutoFillPlacement[];
  hasTargets: boolean;
}

/**
 * Rerolls a single (day, slot) via `buildAutoFill`'s single-target reroll
 * mode. A slot holding only manual entries (no `source: 'auto'` entries) is
 * not a reroll target -> `hasTargets: false`, `placements: []` — the UI shows
 * a Czech notice ("Slot nemá automaticky doplněná jídla") instead of issuing
 * a `replaceAutoEntries` op.
 */
export function rerollSlot(input: RerollInput, day: IsoDay, slot: MealSlotKey, rng: () => number, idFn: () => string): RerollResult {
  const { placements } = buildAutoFill({
    ...input,
    mode: { kind: 'reroll', only: { day, slot } },
    rng,
    idFn,
  });
  return { placements, hasTargets: placements.length > 0 };
}
