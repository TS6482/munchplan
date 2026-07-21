import { describe, expect, it, vi } from 'vitest';
import type { MealEntry, Recipe, SaleItem, Settings } from '../types';
import { makeRecipe } from '../testing/fixtures';
import { swapSide } from '../features/plan/mealDetailLogic';
import { fromRecipe, pairingChips, pairingPools } from '../features/recipes/recipeFormLogic';
import { composeEntry, isBlockedForAnyone, pairedSalads, pairedSides, pickPairedSide, validPairedSides } from './composition';
import { rankSuggestions } from './suggest';

function recipe(overrides: Partial<Recipe> & { id: string }): Recipe {
  return makeRecipe({
    ingredients: [{ name: 'ingredience' }],
    ...overrides,
  });
}

function settings(overrides?: Partial<Settings>): Settings {
  return {
    persons: [
      { name: 'Petr', blocked: [] },
      { name: 'Jana', blocked: [] },
    ],
    dietRules: [],
    rotationWeeks: 2,
    ...overrides,
  };
}

describe('pairedSides', () => {
  it('resolves pairings.sides ids in stored order', () => {
    const sideA = recipe({ id: 'sideA', componentType: 'side' });
    const sideB = recipe({ id: 'sideB', componentType: 'side' });
    const main = recipe({ id: 'main', componentType: 'main', pairings: { sides: ['sideB', 'sideA'], salads: [] } });
    expect(pairedSides(main, [main, sideA, sideB]).map((r) => r.id)).toEqual(['sideB', 'sideA']);
  });

  it('skips a deleted (missing) id', () => {
    const sideA = recipe({ id: 'sideA', componentType: 'side' });
    const main = recipe({ id: 'main', componentType: 'main', pairings: { sides: ['sideA', 'gone'], salads: [] } });
    expect(pairedSides(main, [main, sideA]).map((r) => r.id)).toEqual(['sideA']);
  });

  it('skips a referent whose componentType is no longer side', () => {
    const retyped = recipe({ id: 'retyped', componentType: 'full' });
    const main = recipe({ id: 'main', componentType: 'main', pairings: { sides: ['retyped'], salads: [] } });
    expect(pairedSides(main, [main, retyped])).toEqual([]);
  });

  it('returns [] for empty pairings', () => {
    const main = recipe({ id: 'main', componentType: 'main', pairings: { sides: [], salads: [] } });
    expect(pairedSides(main, [main])).toEqual([]);
  });

  it('dedupes duplicated ids, keeping the first', () => {
    const sideA = recipe({ id: 'sideA', componentType: 'side' });
    const main = recipe({ id: 'main', componentType: 'main', pairings: { sides: ['sideA', 'sideA'], salads: [] } });
    expect(pairedSides(main, [main, sideA]).map((r) => r.id)).toEqual(['sideA']);
  });

  it('filters a main listing its own id', () => {
    const main = recipe({ id: 'main', componentType: 'main', pairings: { sides: ['main'], salads: [] } });
    expect(pairedSides(main, [main])).toEqual([]);
  });
});

describe('pairedSalads', () => {
  it('resolves pairings.salads ids in stored order, skipping deleted/retyped/duplicate/self', () => {
    const saladA = recipe({ id: 'saladA', componentType: 'salad' });
    const retyped = recipe({ id: 'retyped', componentType: 'full' });
    const main = recipe({
      id: 'main',
      componentType: 'main',
      pairings: { sides: [], salads: ['saladA', 'gone', 'retyped', 'saladA', 'main'] },
    });
    expect(pairedSalads(main, [main, saladA, retyped]).map((r) => r.id)).toEqual(['saladA']);
  });
});

describe('validPairedSides', () => {
  it('excludes sides blocked for either person', () => {
    const okSide = recipe({ id: 'ok', componentType: 'side', ingredients: [{ name: 'rýže' }] });
    const blockedSide = recipe({ id: 'blocked', componentType: 'side', ingredients: [{ name: 'houby' }] });
    const main = recipe({
      id: 'main',
      componentType: 'main',
      pairings: { sides: ['ok', 'blocked'], salads: [] },
    });
    const s = settings({ persons: [{ name: 'Petr', blocked: ['houby'] }, { name: 'Jana', blocked: [] }] });
    expect(validPairedSides(main, [main, okSide, blockedSide], s).map((r) => r.id)).toEqual(['ok']);
  });

  it('returns [] when all paired sides are blocked or deleted', () => {
    const blockedSide = recipe({ id: 'blocked', componentType: 'side', ingredients: [{ name: 'houby' }] });
    const main = recipe({
      id: 'main',
      componentType: 'main',
      pairings: { sides: ['blocked', 'gone'], salads: [] },
    });
    const s = settings({ persons: [{ name: 'Petr', blocked: ['houby'] }, { name: 'Jana', blocked: [] }] });
    expect(validPairedSides(main, [main, blockedSide], s)).toEqual([]);
  });
});

describe('pickPairedSide', () => {
  const sales: SaleItem[] = [{ name: 'kuřecí' }];

  it('prefers the sale-matched group regardless of rng', () => {
    const plain1 = recipe({ id: 'plain1', componentType: 'side', ingredients: [{ name: 'rýže' }] });
    const plain2 = recipe({ id: 'plain2', componentType: 'side', ingredients: [{ name: 'brambory' }] });
    const onSale = recipe({ id: 'onSale', componentType: 'side', ingredients: [{ name: 'kuřecí prsa' }] });
    const main = recipe({
      id: 'main',
      componentType: 'main',
      pairings: { sides: ['plain1', 'plain2', 'onSale'], salads: [] },
    });
    const recipes = [main, plain1, plain2, onSale];
    // rng near 1 would pick the last item of a 3-item pool, but the sale
    // group only has one member -- it must win regardless.
    const result = pickPairedSide(main, recipes, sales, settings(), () => 0.999);
    expect(result?.id).toBe('onSale');
  });

  it('draws uniformly within the sale-matched group: rng 0 -> first', () => {
    const saleA = recipe({ id: 'saleA', componentType: 'side', ingredients: [{ name: 'kuřecí prsa' }] });
    const saleB = recipe({ id: 'saleB', componentType: 'side', ingredients: [{ name: 'kuřecí stehna' }] });
    const main = recipe({ id: 'main', componentType: 'main', pairings: { sides: ['saleA', 'saleB'], salads: [] } });
    const result = pickPairedSide(main, [main, saleA, saleB], sales, settings(), () => 0);
    expect(result?.id).toBe('saleA');
  });

  it('draws uniformly within the sale-matched group: rng just-under-1 -> last', () => {
    const saleA = recipe({ id: 'saleA', componentType: 'side', ingredients: [{ name: 'kuřecí prsa' }] });
    const saleB = recipe({ id: 'saleB', componentType: 'side', ingredients: [{ name: 'kuřecí stehna' }] });
    const main = recipe({ id: 'main', componentType: 'main', pairings: { sides: ['saleA', 'saleB'], salads: [] } });
    const result = pickPairedSide(main, [main, saleA, saleB], sales, settings(), () => 0.999999);
    expect(result?.id).toBe('saleB');
  });

  it('pins the boundary at k/n: rng exactly 0.5 of 2 -> second item', () => {
    const saleA = recipe({ id: 'saleA', componentType: 'side', ingredients: [{ name: 'kuřecí prsa' }] });
    const saleB = recipe({ id: 'saleB', componentType: 'side', ingredients: [{ name: 'kuřecí stehna' }] });
    const main = recipe({ id: 'main', componentType: 'main', pairings: { sides: ['saleA', 'saleB'], salads: [] } });
    const result = pickPairedSide(main, [main, saleA, saleB], sales, settings(), () => 0.5);
    expect(result?.id).toBe('saleB');
  });

  it('draws uniformly over all valid sides when none match a sale', () => {
    const plain1 = recipe({ id: 'plain1', componentType: 'side', ingredients: [{ name: 'rýže' }] });
    const plain2 = recipe({ id: 'plain2', componentType: 'side', ingredients: [{ name: 'brambory' }] });
    const main = recipe({ id: 'main', componentType: 'main', pairings: { sides: ['plain1', 'plain2'], salads: [] } });
    const result = pickPairedSide(main, [main, plain1, plain2], [], settings(), () => 0.999999);
    expect(result?.id).toBe('plain2');
  });

  it('returns null when there are no valid sides', () => {
    const main = recipe({ id: 'main', componentType: 'main', pairings: { sides: [], salads: [] } });
    const result = pickPairedSide(main, [main], [], settings(), () => 0);
    expect(result).toBeNull();
  });

  it('makes exactly one rng call', () => {
    const plain1 = recipe({ id: 'plain1', componentType: 'side', ingredients: [{ name: 'rýže' }] });
    const main = recipe({ id: 'main', componentType: 'main', pairings: { sides: ['plain1'], salads: [] } });
    const rng = vi.fn(() => 0);
    pickPairedSide(main, [main, plain1], [], settings(), rng);
    expect(rng).toHaveBeenCalledTimes(1);
  });
});

describe('composeEntry', () => {
  it('gates on componentType === "main" BEFORE any rng call: a full recipe makes ZERO rng calls', () => {
    const full = recipe({ id: 'full1', componentType: 'full' });
    const rng = vi.fn(() => 0);
    const idFn = () => 'e1';
    const entry = composeEntry(full, [full], [], settings(), rng, idFn, 'auto');
    expect(rng).not.toHaveBeenCalled();
    expect(entry).toEqual({ id: 'e1', recipeIds: ['full1'], source: 'auto' });
  });

  it('a main with a valid side composes [main, side] via pickPairedSide', () => {
    const side = recipe({ id: 'side1', componentType: 'side', ingredients: [{ name: 'rýže' }] });
    const main = recipe({ id: 'main1', componentType: 'main', pairings: { sides: ['side1'], salads: [] } });
    const idFn = () => 'e1';
    const entry = composeEntry(main, [main, side], [], settings(), () => 0, idFn, 'manual');
    expect(entry).toEqual({ id: 'e1', recipeIds: ['main1', 'side1'], source: 'manual' });
  });

  it('a main with no valid sides (pickPairedSide -> null) composes [main] alone', () => {
    const main = recipe({ id: 'main1', componentType: 'main', pairings: { sides: [], salads: [] } });
    const idFn = () => 'e1';
    const entry = composeEntry(main, [main], [], settings(), () => 0, idFn, 'auto');
    expect(entry).toEqual({ id: 'e1', recipeIds: ['main1'], source: 'auto' });
  });
});

describe('stale-pairing sweep (feature 004 step 10): one fixture (deleted + retyped + valid id) through every consumer, none throw', () => {
  const validSide = recipe({ id: 'valid-side', name: 'Rýže', componentType: 'side', ingredients: [{ name: 'rýže' }] });
  const retyped = recipe({ id: 'retyped-side', name: 'Bývalá příloha', componentType: 'full' }); // was a side, re-typed away
  const main = recipe({
    id: 'main1',
    name: 'Kuřecí prsa',
    componentType: 'main',
    pairings: { sides: ['deleted-side', 'retyped-side', 'valid-side'], salads: [] },
  });
  const recipes = [main, retyped, validSide];

  it('pickPairedSide only ever draws the valid side, regardless of rng', () => {
    expect(pickPairedSide(main, recipes, [], settings(), () => 0)?.id).toBe('valid-side');
    expect(pickPairedSide(main, recipes, [], settings(), () => 0.999)?.id).toBe('valid-side');
  });

  it('rankSuggestions ranks the main (eligible via the one valid side) without throwing', () => {
    expect(() =>
      rankSuggestions({ recipes, plans: {}, sales: [], settings: settings(), targetWeek: '2026-W30' }),
    ).not.toThrow();
    const result = rankSuggestions({ recipes, plans: {}, sales: [], settings: settings(), targetWeek: '2026-W30' });
    expect(result.map((s) => s.recipe.id)).toContain('main1');
  });

  it('pairingChips lists only the valid side name', () => {
    expect(() => pairingChips(main, recipes)).not.toThrow();
    expect(pairingChips(main, recipes)).toEqual({ sides: ['Rýže'], salads: [] });
  });

  it('pairingPools + fromRecipe round-trip: stale ids preserved in form values, pool lists only the currently-valid side', () => {
    expect(() => pairingPools(recipes, main.id)).not.toThrow();
    const pools = pairingPools(recipes, main.id);
    expect(pools.sides.map((r) => r.id)).toEqual(['valid-side']);
    const values = fromRecipe(main);
    expect(values.pairings.sides).toEqual(['deleted-side', 'retyped-side', 'valid-side']);
  });

  it('mealDetailLogic swapSide options list only the valid side', () => {
    const entry: MealEntry = { id: 'e1', recipeIds: ['main1'], source: 'manual' };
    expect(() => swapSide(entry, recipes, settings())).not.toThrow();
    const options = swapSide(entry, recipes, settings());
    expect(options.map((o) => o.id)).toEqual(['valid-side']);
  });
});

describe('isBlockedForAnyone (moved from suggest.ts)', () => {
  it('is true when blocked for one of the two persons', () => {
    const r = recipe({ id: 'r1', ingredients: [{ name: 'houby' }] });
    const s = settings({ persons: [{ name: 'Petr', blocked: ['houby'] }, { name: 'Jana', blocked: [] }] });
    expect(isBlockedForAnyone(r, s)).toBe(true);
  });

  it('is false when blocked for neither person', () => {
    const r = recipe({ id: 'r1', ingredients: [{ name: 'rýže' }] });
    const s = settings();
    expect(isBlockedForAnyone(r, s)).toBe(false);
  });
});
