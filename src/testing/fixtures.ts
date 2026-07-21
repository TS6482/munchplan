/**
 * Shared test fixtures (step 1, feature 002). `makeRecipe` returns a complete,
 * valid `Recipe` so tests don't have to keep every required field in sync by
 * hand as the type grows; pass `overrides` for whatever the test cares about.
 */

import type { IsoDay, MealSlotKey, Recipe, WeekPlan } from '../types';
import { emptyWeekPlan } from '../engine/planModel';

export function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    name: 'Kuřecí stehna',
    ingredients: [{ name: 'kuřecí stehna', amount: 500, unit: 'g' }],
    category: 'maso',
    effort: 'normal',
    untried: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    suitableFor: ['lunch', 'dinner'],
    componentType: 'full',
    pairings: { sides: [], salads: [] },
    ...overrides,
  };
}

/**
 * Builds a new-shape `WeekPlan` (step 3, feature 002) with one manual dinner
 * entry per given day, e.g. `dinnerWeek({ mon: 'r1', wed: 'r2' })` — the
 * fixture equivalent of the old `{ days: { mon: 'r1' } }` one-dinner-per-day
 * literal used before the meal-slot model. Entry ids are deterministic
 * (`fx-{day}`) so fixture-based assertions stay stable across re-builds.
 *
 * A day's value may also be an array (feature 004 step 3) to build a
 * composed entry, e.g. `dinnerWeek({ mon: ['main1', 'side1'] })` —
 * `recipeIds` in array order, primary first.
 */
export function dinnerWeek(days: Partial<Record<IsoDay, string | string[]>>): WeekPlan {
  const base = emptyWeekPlan();
  const newDays = { ...base.days };
  for (const [day, recipeId] of Object.entries(days) as [IsoDay, string | string[]][]) {
    const recipeIds = Array.isArray(recipeId) ? recipeId : [recipeId];
    newDays[day] = { ...newDays[day], dinner: [{ id: `fx-${day}`, recipeIds, source: 'manual' }] };
  }
  return { ...base, days: newDays };
}

/**
 * Builds a new-shape `WeekPlan` with one entry per given (day, slot,
 * recipeId) — the multi-slot fixture helper for rules that must consider
 * every slot, not just dinner (e.g. a "max 2x maso" rule consumed by both
 * oběd and večeře, or a recipe cooked as a snack counting for rotation).
 *
 * `recipeId` may also be an array (feature 004 step 3) to build a composed
 * entry, e.g. `{ day: 'mon', slot: 'dinner', recipeId: ['main1', 'side1'] }`
 * — `recipeIds` in array order, primary first.
 */
export function weekPlanWith(
  entries: { day: IsoDay; slot: MealSlotKey; recipeId: string | string[]; source?: 'auto' | 'manual'; id?: string }[],
): WeekPlan {
  const base = emptyWeekPlan();
  const newDays = { ...base.days };
  for (const e of entries) {
    const recipeIds = Array.isArray(e.recipeId) ? e.recipeId : [e.recipeId];
    const idSuffix = recipeIds.join('-');
    const entry = { id: e.id ?? `fx-${e.day}-${e.slot}-${idSuffix}`, recipeIds, source: e.source ?? ('manual' as const) };
    newDays[e.day] = { ...newDays[e.day], [e.slot]: [...newDays[e.day][e.slot], entry] };
  }
  return { ...base, days: newDays };
}
