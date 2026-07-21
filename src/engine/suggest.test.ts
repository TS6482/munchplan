import { describe, expect, it } from 'vitest';
import type { IsoDay, Plans, Recipe, SaleItem, Settings, WeekPlan } from '../types';
import { dinnerWeek, makeRecipe, weekPlanWith } from '../testing/fixtures';
import { emptyWeekPlan } from './planModel';
import { plannedCategories, rankSuggestions, warningsFor } from './suggest';

const TARGET: string = '2026-W30';

function planWith(days: Partial<Record<IsoDay, string | null>>): WeekPlan {
  const filtered: Partial<Record<IsoDay, string>> = {};
  for (const [day, id] of Object.entries(days)) {
    if (id != null) filtered[day as IsoDay] = id;
  }
  return dinnerWeek(filtered);
}

function recipe(overrides: Partial<Recipe> & { id: string; name: string }): Recipe {
  return makeRecipe({
    ingredients: [{ name: 'ingredience' }],
    category: 'jine',
    effort: 'normal',
    untried: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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

describe('rankSuggestions', () => {
  describe('exclusions', () => {
    it('excludes a recipe with zero ingredients', () => {
      const r = recipe({ id: 'r1', name: 'Prazdny', ingredients: [] });
      const result = rankSuggestions({ recipes: [r], plans: {}, sales: [], settings: settings(), targetWeek: TARGET });
      expect(result).toEqual([]);
    });

    it('excludes a recipe blocked for person A', () => {
      const r = recipe({ id: 'r1', name: 'Houbovy rizek', ingredients: [{ name: 'houby' }] });
      const s = settings({ persons: [{ name: 'Petr', blocked: ['houby'] }, { name: 'Jana', blocked: [] }] });
      const result = rankSuggestions({ recipes: [r], plans: {}, sales: [], settings: s, targetWeek: TARGET });
      expect(result).toEqual([]);
    });

    it('excludes a recipe blocked for person B', () => {
      const r = recipe({ id: 'r1', name: 'Houbovy rizek', ingredients: [{ name: 'houby' }] });
      const s = settings({ persons: [{ name: 'Petr', blocked: [] }, { name: 'Jana', blocked: ['houby'] }] });
      const result = rankSuggestions({ recipes: [r], plans: {}, sales: [], settings: s, targetWeek: TARGET });
      expect(result).toEqual([]);
    });

    it('excludes via compound-name substring match (blocked "houby" excludes ingredient "susene houby")', () => {
      const r = recipe({ id: 'r1', name: 'Rizoto', ingredients: [{ name: 'sušené houby' }] });
      const s = settings({ persons: [{ name: 'Petr', blocked: ['houby'] }, { name: 'Jana', blocked: [] }] });
      const result = rankSuggestions({ recipes: [r], plans: {}, sales: [], settings: s, targetWeek: TARGET });
      expect(result).toEqual([]);
    });

    it('excludes a recipe cooked inside the rotation window', () => {
      const r = recipe({ id: 'r1', name: 'Guláš' });
      const plans: Plans = { '2026-W29': planWith({ mon: 'r1' }) };
      const result = rankSuggestions({ recipes: [r], plans, sales: [], settings: settings(), targetWeek: TARGET });
      expect(result).toEqual([]);
    });

    it('excludes a recipe that would exceed a max diet rule', () => {
      const planned = recipe({ id: 'planned', name: 'Planned maso', category: 'maso' });
      const candidate = recipe({ id: 'r1', name: 'Another maso', category: 'maso' });
      const plans: Plans = { [TARGET]: planWith({ mon: 'planned', tue: 'other-max' }) };
      const s = settings({ dietRules: [{ category: 'maso', max: 1 }] });
      const result = rankSuggestions({
        recipes: [planned, candidate],
        plans,
        sales: [],
        settings: s,
        targetWeek: TARGET,
      });
      // "planned" is excluded because it's already assigned to the target week;
      // "candidate" is excluded because maso is already at its max of 1.
      expect(result).toEqual([]);
    });

    it('excludes a recipe already assigned to any day of the target week (not just Monday)', () => {
      const r = recipe({ id: 'r1', name: 'Uz naplanovano' });
      const plans: Plans = { [TARGET]: planWith({ wed: 'r1' }) };
      const result = rankSuggestions({ recipes: [r], plans, sales: [], settings: settings(), targetWeek: TARGET });
      expect(result).toEqual([]);
    });

    it('includes an untried recipe with ingredients, flagged untried: true', () => {
      const r = recipe({ id: 'r1', name: 'Nove jidlo', untried: true });
      const result = rankSuggestions({ recipes: [r], plans: {}, sales: [], settings: settings(), targetWeek: TARGET });
      expect(result).toHaveLength(1);
      expect(result[0].untried).toBe(true);
    });
  });

  describe('fields', () => {
    it('reports matchedSaleIngredients and saleMatchCount', () => {
      const r = recipe({
        id: 'r1',
        name: 'Kureci stehna',
        ingredients: [{ name: 'kuřecí stehna' }, { name: 'sůl' }],
      });
      const sales: SaleItem[] = [{ name: 'kuřecí' }];
      const result = rankSuggestions({ recipes: [r], plans: {}, sales, settings: settings(), targetWeek: TARGET });
      expect(result[0].matchedSaleIngredients).toEqual(['kuřecí stehna']);
      expect(result[0].saleMatchCount).toBe(1);
    });

    it('reports weeksSinceCooked as Infinity for a never-cooked recipe', () => {
      const r = recipe({ id: 'r1', name: 'Nove' });
      const result = rankSuggestions({ recipes: [r], plans: {}, sales: [], settings: settings(), targetWeek: TARGET });
      expect(result[0].weeksSinceCooked).toBe(Infinity);
    });

    it('reports boostsUnmetMin true when the recipe helps an unmet min quota', () => {
      const r = recipe({ id: 'r1', name: 'Ryba na parou', category: 'ryba' });
      const s = settings({ dietRules: [{ category: 'ryba', min: 1 }] });
      const result = rankSuggestions({ recipes: [r], plans: {}, sales: [], settings: s, targetWeek: TARGET });
      expect(result[0].boostsUnmetMin).toBe(true);
    });

    it('reports boostsUnmetMin false when there is no unmet min for the category', () => {
      const r = recipe({ id: 'r1', name: 'Vegeta', category: 'vege' });
      const s = settings({ dietRules: [{ category: 'ryba', min: 1 }] });
      const result = rankSuggestions({ recipes: [r], plans: {}, sales: [], settings: s, targetWeek: TARGET });
      expect(result[0].boostsUnmetMin).toBe(false);
    });
  });

  describe('ranking', () => {
    it('orders by saleMatchCount descending', () => {
      const low = recipe({ id: 'low', name: 'Bez slevy' });
      const high = recipe({ id: 'high', name: 'Se slevou', ingredients: [{ name: 'kuřecí stehna' }] });
      const sales: SaleItem[] = [{ name: 'kuřecí' }];
      const result = rankSuggestions({ recipes: [low, high], plans: {}, sales, settings: settings(), targetWeek: TARGET });
      expect(result.map((s) => s.recipe.id)).toEqual(['high', 'low']);
    });

    it('orders by weeksSinceCooked descending when saleMatchCount ties, never-cooked ranks first', () => {
      const neverCooked = recipe({ id: 'never', name: 'B nikdy' });
      const cookedLongAgo = recipe({ id: 'long-ago', name: 'A davno' });
      const cookedRecently = recipe({ id: 'recent', name: 'C nedavno' });
      const plans: Plans = {
        '2026-W25': planWith({ mon: 'long-ago' }),
        '2026-W29': planWith({ tue: 'recent' }),
      };
      const s = settings({ rotationWeeks: 0 });
      const result = rankSuggestions({
        recipes: [neverCooked, cookedLongAgo, cookedRecently],
        plans,
        sales: [],
        settings: s,
        targetWeek: TARGET,
      });
      expect(result.map((r) => r.recipe.id)).toEqual(['never', 'long-ago', 'recent']);
    });

    it('orders by boostsUnmetMin descending when saleMatchCount and weeksSinceCooked tie', () => {
      const boosted = recipe({ id: 'boosted', name: 'B ryba', category: 'ryba' });
      const notBoosted = recipe({ id: 'plain', name: 'A vege', category: 'vege' });
      const s = settings({ dietRules: [{ category: 'ryba', min: 1 }] });
      const result = rankSuggestions({
        recipes: [notBoosted, boosted],
        plans: {},
        sales: [],
        settings: s,
        targetWeek: TARGET,
      });
      expect(result.map((r) => r.recipe.id)).toEqual(['boosted', 'plain']);
    });

    it('ties break by normalized recipe name ascending', () => {
      const zeta = recipe({ id: 'z', name: 'Žampiony' });
      const alfa = recipe({ id: 'a', name: 'Ančovičky' });
      const result = rankSuggestions({ recipes: [zeta, alfa], plans: {}, sales: [], settings: settings(), targetWeek: TARGET });
      expect(result.map((r) => r.recipe.id)).toEqual(['a', 'z']);
    });

    it('ranks rotation freshness (weeksSinceCooked) above an unmet-min boost', () => {
      // Both recipes have saleMatchCount 0. "fresher" was cooked 5 weeks ago
      // (weeksSinceCooked=5) but does not boost any unmet min. "boosted" was
      // cooked more recently (3 weeks ago, weeksSinceCooked=3) and DOES boost
      // the unmet "ryba" min. Per the lexicographic tuple, weeksSinceCooked
      // (level 2) outranks boostsUnmetMin (level 3), so "fresher" must win
      // even though "boosted" helps the diet quota.
      const fresher = recipe({ id: 'fresher', name: 'Z maso', category: 'maso' });
      const boosted = recipe({ id: 'boosted', name: 'A ryba', category: 'ryba' });
      const planned = recipe({ id: 'planned', name: 'Planned maso', category: 'maso' });
      const plans: Plans = {
        '2026-W25': planWith({ mon: 'fresher' }), // 5 weeks before 2026-W30
        '2026-W27': planWith({ tue: 'boosted' }), // 3 weeks before 2026-W30
        [TARGET]: planWith({ wed: 'planned' }), // occupies "maso" without touching "ryba"
      };
      const s = settings({ rotationWeeks: 1, dietRules: [{ category: 'ryba', min: 1 }] });
      const result = rankSuggestions({
        recipes: [fresher, boosted, planned],
        plans,
        sales: [],
        settings: s,
        targetWeek: TARGET,
      });
      expect(result.map((r) => r.recipe.id)).toEqual(['fresher', 'boosted']);
      expect(result[0].weeksSinceCooked).toBe(5);
      expect(result[0].boostsUnmetMin).toBe(false);
      expect(result[1].weeksSinceCooked).toBe(3);
      expect(result[1].boostsUnmetMin).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns [] when there are no recipes', () => {
      const result = rankSuggestions({ recipes: [], plans: {}, sales: [], settings: settings(), targetWeek: TARGET });
      expect(result).toEqual([]);
    });

    it('with no sales and no diet rules, orders by weeksSinceCooked then name', () => {
      const b = recipe({ id: 'b', name: 'B nikdy' });
      const a = recipe({ id: 'a', name: 'A nikdy' });
      const cooked = recipe({ id: 'cooked', name: 'C uz bylo' });
      const plans: Plans = { '2026-W28': planWith({ mon: 'cooked' }) };
      const s = settings({ rotationWeeks: 0, dietRules: [] });
      const result = rankSuggestions({ recipes: [b, a, cooked], plans, sales: [], settings: s, targetWeek: TARGET });
      expect(result.map((r) => r.recipe.id)).toEqual(['a', 'b', 'cooked']);
    });

    it('with empty sales, saleMatchCount is 0 for every suggestion', () => {
      const r1 = recipe({ id: 'r1', name: 'Prvni', ingredients: [{ name: 'kuřecí stehna' }] });
      const r2 = recipe({ id: 'r2', name: 'Druhy' });
      const result = rankSuggestions({ recipes: [r1, r2], plans: {}, sales: [], settings: settings(), targetWeek: TARGET });
      expect(result.every((s) => s.saleMatchCount === 0)).toBe(true);
      expect(result.every((s) => s.matchedSaleIngredients.length === 0)).toBe(true);
    });
  });
});

describe('rankSuggestions with slot filter (feature 002 step 5)', () => {
  it('excludes a recipe whose suitableFor lacks the given slot (AC6)', () => {
    const r = recipe({ id: 'r1', name: 'Ovesna kase', suitableFor: ['breakfast'] });
    const result = rankSuggestions({
      recipes: [r],
      plans: {},
      sales: [],
      settings: settings(),
      targetWeek: TARGET,
      slot: 'dinner',
    });
    expect(result).toEqual([]);
  });

  it('applies no suitability filter when no slot is given', () => {
    const r = recipe({ id: 'r1', name: 'Ovesna kase', suitableFor: ['breakfast'] });
    const result = rankSuggestions({ recipes: [r], plans: {}, sales: [], settings: settings(), targetWeek: TARGET });
    expect(result.map((s) => s.recipe.id)).toEqual(['r1']);
  });

  it('includes the recipe when the given slot is in its suitableFor', () => {
    const r = recipe({ id: 'r1', name: 'Ovesna kase', suitableFor: ['breakfast'] });
    const result = rankSuggestions({
      recipes: [r],
      plans: {},
      sales: [],
      settings: settings(),
      targetWeek: TARGET,
      slot: 'breakfast',
    });
    expect(result.map((s) => s.recipe.id)).toEqual(['r1']);
  });

  it('excludes a recipe already assigned to any slot of the target week, not just the given slot', () => {
    const r = recipe({ id: 'r1', name: 'Zapekanka' });
    const plans: Plans = { [TARGET]: weekPlanWith([{ day: 'wed', slot: 'lunch', recipeId: 'r1' }]) };
    const result = rankSuggestions({
      recipes: [r],
      plans,
      sales: [],
      settings: settings(),
      targetWeek: TARGET,
      slot: 'dinner',
    });
    expect(result).toEqual([]);
  });

  it('a recipe cooked in any slot last week is rotation-hidden this week regardless of the queried slot (AC7 second half)', () => {
    const r = recipe({ id: 'r1', name: 'Svacinka' });
    const plans: Plans = { '2026-W29': weekPlanWith([{ day: 'mon', slot: 'snack', recipeId: 'r1' }]) };
    const result = rankSuggestions({
      recipes: [r],
      plans,
      sales: [],
      settings: settings({ rotationWeeks: 2 }),
      targetWeek: TARGET,
      slot: 'dinner',
    });
    expect(result).toEqual([]);
  });

  it('a "max 2x maso" rule consumed by oběd + večeře on the same day blocks further maso anywhere (AC7 first half)', () => {
    const plannedLunch = recipe({ id: 'planned-lunch', name: 'Obedove maso', category: 'maso' });
    const plannedDinner = recipe({ id: 'planned-dinner', name: 'Vecerni maso', category: 'maso' });
    const candidate = recipe({ id: 'r1', name: 'Dalsi maso', category: 'maso' });
    const plans: Plans = {
      [TARGET]: weekPlanWith([
        { day: 'mon', slot: 'lunch', recipeId: 'planned-lunch' },
        { day: 'mon', slot: 'dinner', recipeId: 'planned-dinner' },
      ]),
    };
    const s = settings({ dietRules: [{ category: 'maso', max: 2 }] });
    const result = rankSuggestions({
      recipes: [plannedLunch, plannedDinner, candidate],
      plans,
      sales: [],
      settings: s,
      targetWeek: TARGET,
    });
    expect(result).toEqual([]);
  });
});

describe('plannedCategories multiplicity (feature 002 step 5)', () => {
  it('counts both categories of a multi-recipe entry (recipeIds: [a, b])', () => {
    const a = recipe({ id: 'a', name: 'Maso jidlo', category: 'maso' });
    const b = recipe({ id: 'b', name: 'Rybi jidlo', category: 'ryba' });
    const week = emptyWeekPlan();
    week.days.mon.dinner = [{ id: 'e1', recipeIds: ['a', 'b'], source: 'manual' }];
    const plans: Plans = { [TARGET]: week };
    const categories = plannedCategories([a, b], plans, TARGET);
    expect(categories.slice().sort()).toEqual(['maso', 'ryba']);
  });
});

describe('warningsFor', () => {
  it('returns no warnings for a clean recipe', () => {
    const r = recipe({ id: 'r1', name: 'Cisty recept' });
    const warnings = warningsFor(r, { recipes: [r], plans: {}, sales: [], settings: settings(), targetWeek: TARGET });
    expect(warnings).toEqual([]);
  });

  it('returns a blocked warning per person with the offending ingredient names', () => {
    const r = recipe({
      id: 'r1',
      name: 'Houbovy rizek',
      ingredients: [{ name: 'sušené houby' }, { name: 'sůl' }],
    });
    const s = settings({ persons: [{ name: 'Petr', blocked: ['houby'] }, { name: 'Jana', blocked: [] }] });
    const warnings = warningsFor(r, { recipes: [r], plans: {}, sales: [], settings: s, targetWeek: TARGET });
    expect(warnings).toEqual([{ kind: 'blocked', person: 'Petr', ingredients: ['sušené houby'] }]);
  });

  it('returns a blocked warning for both persons when both have a matching block', () => {
    const r = recipe({ id: 'r1', name: 'Houbovy rizek', ingredients: [{ name: 'houby' }] });
    const s = settings({
      persons: [{ name: 'Petr', blocked: ['houby'] }, { name: 'Jana', blocked: ['houby'] }],
    });
    const warnings = warningsFor(r, { recipes: [r], plans: {}, sales: [], settings: s, targetWeek: TARGET });
    expect(warnings).toEqual([
      { kind: 'blocked', person: 'Petr', ingredients: ['houby'] },
      { kind: 'blocked', person: 'Jana', ingredients: ['houby'] },
    ]);
  });

  it('returns a maxExceeded warning when the pick would break a max quota', () => {
    const planned = recipe({ id: 'planned', name: 'Planned maso', category: 'maso' });
    const candidate = recipe({ id: 'r1', name: 'Dalsi maso', category: 'maso' });
    const plans: Plans = { [TARGET]: planWith({ mon: 'planned' }) };
    const s = settings({ dietRules: [{ category: 'maso', max: 1 }] });
    const warnings = warningsFor(candidate, {
      recipes: [planned, candidate],
      plans,
      sales: [],
      settings: s,
      targetWeek: TARGET,
    });
    expect(warnings).toEqual([{ kind: 'maxExceeded', category: 'maso' }]);
  });

  it('returns a rotation warning with weeksSinceCooked when in the rotation window', () => {
    const r = recipe({ id: 'r1', name: 'Nedavno vareno' });
    const plans: Plans = { '2026-W29': planWith({ mon: 'r1' }) };
    const s = settings({ rotationWeeks: 2 });
    const warnings = warningsFor(r, { recipes: [r], plans, sales: [], settings: s, targetWeek: TARGET });
    expect(warnings).toEqual([{ kind: 'rotation', weeksSinceCooked: 1 }]);
  });

  it('combines multiple warnings when several conditions apply', () => {
    const planned = recipe({ id: 'planned', name: 'Planned maso', category: 'maso' });
    const r = recipe({ id: 'r1', name: 'Houbove maso', category: 'maso', ingredients: [{ name: 'houby' }] });
    const plans: Plans = {
      [TARGET]: planWith({ mon: 'planned' }),
      '2026-W29': planWith({ tue: 'r1' }),
    };
    const s = settings({
      persons: [{ name: 'Petr', blocked: ['houby'] }, { name: 'Jana', blocked: [] }],
      dietRules: [{ category: 'maso', max: 1 }],
      rotationWeeks: 2,
    });
    const warnings = warningsFor(r, { recipes: [planned, r], plans, sales: [], settings: s, targetWeek: TARGET });
    expect(warnings).toEqual([
      { kind: 'blocked', person: 'Petr', ingredients: ['houby'] },
      { kind: 'maxExceeded', category: 'maso' },
      { kind: 'rotation', weeksSinceCooked: 1 },
    ]);
  });

  it('adds an unsuitable warning when the recipe is not suitableFor the given slot', () => {
    const r = recipe({ id: 'r1', name: 'Ovesna kase', suitableFor: ['breakfast'] });
    const warnings = warningsFor(r, {
      recipes: [r],
      plans: {},
      sales: [],
      settings: settings(),
      targetWeek: TARGET,
      slot: 'dinner',
    });
    expect(warnings).toEqual([{ kind: 'unsuitable', slot: 'dinner' }]);
  });

  it('does not warn when the recipe is suitableFor the given slot', () => {
    const r = recipe({ id: 'r1', name: 'Polevka', suitableFor: ['lunch', 'dinner'] });
    const warnings = warningsFor(r, {
      recipes: [r],
      plans: {},
      sales: [],
      settings: settings(),
      targetWeek: TARGET,
      slot: 'dinner',
    });
    expect(warnings).toEqual([]);
  });

  it('does not warn about suitability when no slot is given', () => {
    const r = recipe({ id: 'r1', name: 'Ovesna kase', suitableFor: ['breakfast'] });
    const warnings = warningsFor(r, { recipes: [r], plans: {}, sales: [], settings: settings(), targetWeek: TARGET });
    expect(warnings).toEqual([]);
  });

  it('appends the unsuitable warning after blocked/maxExceeded/rotation (placement pin)', () => {
    const planned = recipe({ id: 'planned', name: 'Planned maso', category: 'maso' });
    const r = recipe({
      id: 'r1',
      name: 'Houbove maso',
      category: 'maso',
      suitableFor: ['breakfast'],
      ingredients: [{ name: 'houby' }],
    });
    const plans: Plans = {
      [TARGET]: planWith({ mon: 'planned' }),
      '2026-W29': planWith({ tue: 'r1' }),
    };
    const s = settings({
      persons: [{ name: 'Petr', blocked: ['houby'] }, { name: 'Jana', blocked: [] }],
      dietRules: [{ category: 'maso', max: 1 }],
      rotationWeeks: 2,
    });
    const warnings = warningsFor(r, {
      recipes: [planned, r],
      plans,
      sales: [],
      settings: s,
      targetWeek: TARGET,
      slot: 'dinner',
    });
    expect(warnings).toEqual([
      { kind: 'blocked', person: 'Petr', ingredients: ['houby'] },
      { kind: 'maxExceeded', category: 'maso' },
      { kind: 'rotation', weeksSinceCooked: 1 },
      { kind: 'unsuitable', slot: 'dinner' },
    ]);
  });
});
