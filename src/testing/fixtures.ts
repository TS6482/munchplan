/**
 * Shared test fixtures (step 1, feature 002). `makeRecipe` returns a complete,
 * valid `Recipe` so tests don't have to keep every required field in sync by
 * hand as the type grows; pass `overrides` for whatever the test cares about.
 */

import type { Recipe } from '../types';

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
