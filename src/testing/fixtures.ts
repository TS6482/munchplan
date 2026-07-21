/**
 * Shared test fixtures (step 1, feature 002). `makeRecipe` returns a complete,
 * valid `Recipe` so tests don't have to keep every required field in sync by
 * hand as the type grows; pass `overrides` for whatever the test cares about.
 */

import type { IsoDay, Recipe, WeekPlan } from '../types';
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
