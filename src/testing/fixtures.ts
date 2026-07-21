/**
 * Shared test fixtures (step 1, feature 002). `makeRecipe` returns a complete,
 * valid `Recipe` so tests don't have to keep every required field in sync by
 * hand as the type grows; pass `overrides` for whatever the test cares about.
 */

import type { IsoDay, MealSlotKey, Recipe, WeekPlan } from '../types';
import { SLOT_ORDER } from '../types';
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
 */
export function dinnerWeek(days: Partial<Record<IsoDay, string>>): WeekPlan {
  const base = emptyWeekPlan(['dinner']);
  const newDays = { ...base.days };
  for (const [day, recipeId] of Object.entries(days) as [IsoDay, string][]) {
    newDays[day] = { ...newDays[day], dinner: [{ id: `fx-${day}`, recipeIds: [recipeId], source: 'manual' }] };
  }
  return { ...base, days: newDays };
}

/**
 * Builds a new-shape `WeekPlan` with one entry per given (day, slot,
 * recipeId) — the multi-slot fixture helper for rules that must consider
 * every slot, not just dinner (e.g. a "max 2x maso" rule consumed by both
 * oběd and večeře, or a recipe cooked as a snack counting for rotation).
 * `activeSlots` is derived as the slots referenced, in `SLOT_ORDER`
 * (falling back to `['dinner']` for an empty entry list).
 */
export function weekPlanWith(
  entries: { day: IsoDay; slot: MealSlotKey; recipeId: string; source?: 'auto' | 'manual'; id?: string }[],
): WeekPlan {
  const usedSlots = SLOT_ORDER.filter((slot) => entries.some((e) => e.slot === slot));
  const base = emptyWeekPlan(usedSlots.length > 0 ? usedSlots : ['dinner']);
  const newDays = { ...base.days };
  for (const e of entries) {
    const entry = { id: e.id ?? `fx-${e.day}-${e.slot}-${e.recipeId}`, recipeIds: [e.recipeId], source: e.source ?? ('manual' as const) };
    newDays[e.day] = { ...newDays[e.day], [e.slot]: [...newDays[e.day][e.slot], entry] };
  }
  return { ...base, days: newDays };
}
