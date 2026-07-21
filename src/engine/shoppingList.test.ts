import { describe, expect, it } from 'vitest';
import type { Ingredient, IsoDay, MealSlotKey, Recipe, SaleItem, WeekExtras, WeekPlan } from '../types';
import { dinnerWeek, makeRecipe, weekPlanWith } from '../testing/fixtures';
import { emptyWeekPlan } from './planModel';
import { buildShoppingList } from './shoppingList';

/** A single manual entry with multiple recipeIds in one (day, slot) — weekPlanWith only builds single-recipe entries, so multi-recipe fixtures are assembled directly here. */
function multiRecipeEntryWeek(day: IsoDay, slot: MealSlotKey, recipeIds: string[]): WeekPlan {
  const base = emptyWeekPlan();
  return {
    ...base,
    days: {
      ...base.days,
      [day]: { ...base.days[day], [slot]: [{ id: 'entry-1', recipeIds, source: 'manual' }] },
    },
  };
}

function planWith(days: Partial<Record<IsoDay, string | null>>): WeekPlan {
  const filtered: Partial<Record<IsoDay, string>> = {};
  for (const [day, id] of Object.entries(days)) {
    if (id != null) filtered[day as IsoDay] = id;
  }
  return dinnerWeek(filtered);
}

function recipe(overrides: { id: string; name: string; ingredients: Ingredient[] }): Recipe {
  return makeRecipe({
    category: 'jine',
    effort: 'normal',
    untried: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
}

function extras(overrides?: Partial<WeekExtras>): WeekExtras {
  return {
    checks: {},
    extraItems: [],
    homeOverrides: {},
    ...overrides,
  };
}

describe('buildShoppingList', () => {
  describe('plan resolution', () => {
    it('skips a plan day referencing an unknown/deleted recipeId without crashing', () => {
      const plan = planWith({ mon: 'ghost' });
      const result = buildShoppingList({ recipes: [], plan, pantry: [], sales: [], weekExtras: extras() });
      expect(result.buy).toEqual([]);
      expect(result.home).toEqual([]);
    });
  });

  describe('merging', () => {
    it('merges same name+unit ingredients by summing amounts, keeping first-seen spelling', () => {
      const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'Mouka', amount: 200, unit: 'g' }] });
      const b = recipe({ id: 'b', name: 'Recept B', ingredients: [{ name: 'mouka', amount: 300, unit: 'g' }] });
      const plan = planWith({ mon: 'a', tue: 'b' });
      const result = buildShoppingList({ recipes: [a, b], plan, pantry: [], sales: [], weekExtras: extras() });
      expect(result.buy).toHaveLength(1);
      expect(result.buy[0]).toMatchObject({ key: 'mouka|g', label: 'Mouka', amount: 500, unit: 'g' });
      expect(result.buy[0].fromRecipes).toEqual(['Recept A', 'Recept B']);
    });

    it('keeps unit-mismatched same-name ingredients as two distinct lines', () => {
      const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'cibule', amount: 1, unit: 'ks' }] });
      const b = recipe({ id: 'b', name: 'Recept B', ingredients: [{ name: 'cibule', amount: 200, unit: 'g' }] });
      const plan = planWith({ mon: 'a', tue: 'b' });
      const result = buildShoppingList({ recipes: [a, b], plan, pantry: [], sales: [], weekExtras: extras() });
      expect(result.buy).toHaveLength(2);
      expect(result.buy.map((i) => i.key).sort()).toEqual(['cibule|g', 'cibule|ks']);
    });

    it('merges amount-less duplicates into a single line with no amount', () => {
      const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'sůl' }] });
      const b = recipe({ id: 'b', name: 'Recept B', ingredients: [{ name: 'sůl' }] });
      const plan = planWith({ mon: 'a', tue: 'b' });
      const result = buildShoppingList({ recipes: [a, b], plan, pantry: [], sales: [], weekExtras: extras() });
      expect(result.buy).toHaveLength(1);
      expect(result.buy[0].key).toBe('sul|');
      expect(result.buy[0].amount).toBeUndefined();
    });

    it('splits an amount line from an amount-less line for the same name (distinct units "g" vs "")', () => {
      const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'mouka', amount: 500, unit: 'g' }] });
      const b = recipe({ id: 'b', name: 'Recept B', ingredients: [{ name: 'mouka' }] });
      const plan = planWith({ mon: 'a', tue: 'b' });
      const result = buildShoppingList({ recipes: [a, b], plan, pantry: [], sales: [], weekExtras: extras() });
      expect(result.buy).toHaveLength(2);
      const withAmount = result.buy.find((i) => i.key === 'mouka|g');
      const withoutAmount = result.buy.find((i) => i.key === 'mouka|');
      expect(withAmount?.amount).toBe(500);
      expect(withoutAmount?.amount).toBeUndefined();
    });

    // Decision: within a single key, if ANY contributor lacks an amount, the
    // merged amount is undefined (unknown total) rather than silently summing
    // only the known contributors - a partial sum would misrepresent what's
    // actually needed. The line still lists every contributing recipe.
    it('decision: amount + amount-less contributors under the SAME key merge to an undefined amount, not a partial sum', () => {
      const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'mouka', amount: 200, unit: 'g' }] });
      const b = recipe({ id: 'b', name: 'Recept B', ingredients: [{ name: 'mouka', unit: 'g' }] });
      const plan = planWith({ mon: 'a', tue: 'b' });
      const result = buildShoppingList({ recipes: [a, b], plan, pantry: [], sales: [], weekExtras: extras() });
      expect(result.buy).toHaveLength(1);
      expect(result.buy[0].key).toBe('mouka|g');
      expect(result.buy[0].amount).toBeUndefined();
      expect(result.buy[0].fromRecipes).toEqual(['Recept A', 'Recept B']);
    });
  });

  describe('pantry', () => {
    it('moves a pantry-matched item to home instead of buy', () => {
      const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'sůl' }] });
      const plan = planWith({ mon: 'a' });
      const result = buildShoppingList({ recipes: [a], plan, pantry: [{ name: 'Sůl' }], sales: [], weekExtras: extras() });
      expect(result.buy).toEqual([]);
      expect(result.home).toHaveLength(1);
      expect(result.home[0].key).toBe('sul|');
    });

    it('empty pantry leaves items in buy, home stays empty', () => {
      const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'sůl' }] });
      const plan = planWith({ mon: 'a' });
      const result = buildShoppingList({ recipes: [a], plan, pantry: [], sales: [], weekExtras: extras() });
      expect(result.home).toEqual([]);
      expect(result.buy).toHaveLength(1);
    });

    it('homeOverride "toBuy" forces a pantry-matched item into buy', () => {
      const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'sůl' }] });
      const plan = planWith({ mon: 'a' });
      const result = buildShoppingList({
        recipes: [a],
        plan,
        pantry: [{ name: 'sůl' }],
        sales: [],
        weekExtras: extras({ homeOverrides: { 'sul|': 'toBuy' } }),
      });
      expect(result.buy).toHaveLength(1);
      expect(result.home).toEqual([]);
    });

    it('homeOverride "toHome" forces a non-pantry-matched item into home', () => {
      const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'sůl' }] });
      const plan = planWith({ mon: 'a' });
      const result = buildShoppingList({
        recipes: [a],
        plan,
        pantry: [],
        sales: [],
        weekExtras: extras({ homeOverrides: { 'sul|': 'toHome' } }),
      });
      expect(result.home).toHaveLength(1);
      expect(result.buy).toEqual([]);
    });

    it('homeOverrides survive across a rebuild keyed by ItemKey', () => {
      const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'cukr', amount: 100, unit: 'g' }] });
      const b = recipe({ id: 'b', name: 'Recept B', ingredients: [{ name: 'kmín', amount: 1, unit: 'lžička' }] });
      const p1 = planWith({ mon: 'a' });
      const p2 = planWith({ mon: 'a', tue: 'b' });
      const weekExtras = extras({ homeOverrides: { 'cukr|g': 'toHome' } });
      const r1 = buildShoppingList({ recipes: [a, b], plan: p1, pantry: [], sales: [], weekExtras });
      const r2 = buildShoppingList({ recipes: [a, b], plan: p2, pantry: [], sales: [], weekExtras });
      expect(r1.home.map((i) => i.key)).toEqual(['cukr|g']);
      expect(r2.home.map((i) => i.key)).toEqual(['cukr|g']);
    });
  });

  describe('sales', () => {
    it('marks onSale true with matchedSale when a sale substring-matches', () => {
      const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'kuřecí stehna' }] });
      const plan = planWith({ mon: 'a' });
      const sales: SaleItem[] = [{ name: 'kuřecí' }];
      const result = buildShoppingList({ recipes: [a], plan, pantry: [], sales, weekExtras: extras() });
      expect(result.buy[0].onSale).toBe(true);
      expect(result.buy[0].matchedSale).toBe('kuřecí');
    });

    it('empty sales -> no item marked onSale', () => {
      const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'kuřecí stehna' }] });
      const plan = planWith({ mon: 'a' });
      const result = buildShoppingList({ recipes: [a], plan, pantry: [], sales: [], weekExtras: extras() });
      expect(result.buy[0].onSale).toBe(false);
      expect(result.buy[0].matchedSale).toBeUndefined();
    });
  });

  describe('checked state', () => {
    it('reflects weekExtras.checks for the item key', () => {
      const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'sůl' }] });
      const plan = planWith({ mon: 'a' });
      const result = buildShoppingList({
        recipes: [a],
        plan,
        pantry: [],
        sales: [],
        weekExtras: extras({ checks: { 'sul|': true } }),
      });
      expect(result.buy[0].checked).toBe(true);
    });

    it('defaults to unchecked when the key is absent from checks', () => {
      const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'sůl' }] });
      const plan = planWith({ mon: 'a' });
      const result = buildShoppingList({ recipes: [a], plan, pantry: [], sales: [], weekExtras: extras() });
      expect(result.buy[0].checked).toBe(false);
    });
  });

  describe('stability across plan edits (AC8)', () => {
    it('adding a recipe to the plan keeps existing keys unchanged and adds the new ones', () => {
      const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'mouka', amount: 200, unit: 'g' }] });
      const b = recipe({ id: 'b', name: 'Recept B', ingredients: [{ name: 'cukr', amount: 100, unit: 'g' }] });
      const c = recipe({ id: 'c', name: 'Recept C', ingredients: [{ name: 'sůl' }] });
      const p1 = planWith({ mon: 'a', tue: 'b' });
      const p2 = planWith({ mon: 'a', tue: 'b', wed: 'c' });
      const r1 = buildShoppingList({ recipes: [a, b, c], plan: p1, pantry: [], sales: [], weekExtras: extras() });
      const r2 = buildShoppingList({ recipes: [a, b, c], plan: p2, pantry: [], sales: [], weekExtras: extras() });
      const keys1 = [...r1.buy, ...r1.home].map((i) => i.key);
      const keys2 = new Set([...r2.buy, ...r2.home].map((i) => i.key));
      for (const key of keys1) expect(keys2.has(key)).toBe(true);
      expect(keys2.has('sul|')).toBe(true);
    });

    it('removing a recipe drops its unique items but keeps shared keys', () => {
      const a = recipe({
        id: 'a',
        name: 'Recept A',
        ingredients: [
          { name: 'mouka', amount: 200, unit: 'g' },
          { name: 'cukr', amount: 50, unit: 'g' },
        ],
      });
      const b = recipe({
        id: 'b',
        name: 'Recept B',
        ingredients: [
          { name: 'cukr', amount: 100, unit: 'g' },
          { name: 'kmín', amount: 1, unit: 'lžička' },
        ],
      });
      const withB = planWith({ mon: 'a', tue: 'b' });
      const withoutB = planWith({ mon: 'a' });
      const resultWithB = buildShoppingList({ recipes: [a, b], plan: withB, pantry: [], sales: [], weekExtras: extras() });
      const resultWithoutB = buildShoppingList({
        recipes: [a, b],
        plan: withoutB,
        pantry: [],
        sales: [],
        weekExtras: extras(),
      });
      expect(resultWithB.buy.some((i) => i.key === 'kmin|lzicka')).toBe(true);
      expect(resultWithoutB.buy.some((i) => i.key === 'kmin|lzicka')).toBe(false);
      expect(resultWithoutB.buy.some((i) => i.key === 'cukr|g')).toBe(true);
      expect(resultWithoutB.buy.some((i) => i.key === 'mouka|g')).toBe(true);
    });
  });

  describe('ordering', () => {
    it('sorts buy and home items by normalized label ascending', () => {
      const a = recipe({
        id: 'a',
        name: 'Recept A',
        ingredients: [{ name: 'Žampiony' }, { name: 'Ančovičky' }, { name: 'Cibule' }],
      });
      const plan = planWith({ mon: 'a' });
      const result = buildShoppingList({ recipes: [a], plan, pantry: [], sales: [], weekExtras: extras() });
      expect(result.buy.map((i) => i.label)).toEqual(['Ančovičky', 'Cibule', 'Žampiony']);
    });
  });

  describe('empty states', () => {
    it('undefined plan returns only extras (no recipe items)', () => {
      const extraItems = [{ id: 'e1', name: 'Toaletní papír', checked: false }];
      const result = buildShoppingList({
        recipes: [],
        plan: undefined,
        pantry: [],
        sales: [],
        weekExtras: extras({ extraItems }),
      });
      expect(result.buy).toEqual([]);
      expect(result.home).toEqual([]);
      expect(result.extras).toEqual(extraItems);
    });

    it('empty plan (all days null) returns only extras', () => {
      const plan = planWith({});
      const result = buildShoppingList({ recipes: [], plan, pantry: [], sales: [], weekExtras: extras() });
      expect(result.buy).toEqual([]);
      expect(result.home).toEqual([]);
    });
  });

  // Step 7 (feature 002): pins AC8 across the meal-slot model. The iteration
  // layer (weekRecipeIds, walking days -> slots -> entries -> recipeIds)
  // landed in step 3 — these tests guard it doesn't regress.
  describe('multi-slot aggregation (AC8, step 7)', () => {
    it('includes ingredients from entries in different slots of the same day', () => {
      const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'mouka', amount: 200, unit: 'g' }] });
      const b = recipe({ id: 'b', name: 'Recept B', ingredients: [{ name: 'cukr', amount: 100, unit: 'g' }] });
      const plan = weekPlanWith([
        { day: 'mon', slot: 'lunch', recipeId: 'a' },
        { day: 'mon', slot: 'dinner', recipeId: 'b' },
      ]);
      const result = buildShoppingList({ recipes: [a, b], plan, pantry: [], sales: [], weekExtras: extras() });
      expect(result.buy.map((i) => i.key).sort()).toEqual(['cukr|g', 'mouka|g']);
    });

    it('a recipe planned twice in the week (any slots) contributes its ingredients twice, merged into one line with the recipe name deduped in fromRecipes', () => {
      const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'mouka', amount: 200, unit: 'g' }] });
      const plan = weekPlanWith([
        { day: 'mon', slot: 'lunch', recipeId: 'a' },
        { day: 'wed', slot: 'dinner', recipeId: 'a' },
      ]);
      const result = buildShoppingList({ recipes: [a], plan, pantry: [], sales: [], weekExtras: extras() });
      expect(result.buy).toHaveLength(1);
      expect(result.buy[0]).toMatchObject({ key: 'mouka|g', amount: 400 });
      expect(result.buy[0].fromRecipes).toEqual(['Recept A']);
    });

    it('a multi-recipe entry contributes each recipe\'s ingredients', () => {
      const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'mouka', amount: 200, unit: 'g' }] });
      const b = recipe({ id: 'b', name: 'Recept B', ingredients: [{ name: 'cukr', amount: 100, unit: 'g' }] });
      const plan = multiRecipeEntryWeek('mon', 'dinner', ['a', 'b']);
      const result = buildShoppingList({ recipes: [a, b], plan, pantry: [], sales: [], weekExtras: extras() });
      expect(result.buy.map((i) => i.key).sort()).toEqual(['cukr|g', 'mouka|g']);
    });

    it('a deleted recipeId inside a multi-recipe entry is skipped silently; the surviving recipe still contributes', () => {
      const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'mouka', amount: 200, unit: 'g' }] });
      const plan = multiRecipeEntryWeek('mon', 'dinner', ['a', 'ghost']);
      const result = buildShoppingList({ recipes: [a], plan, pantry: [], sales: [], weekExtras: extras() });
      expect(result.buy).toHaveLength(1);
      expect(result.buy[0].key).toBe('mouka|g');
    });

    it('produces a literal, stable ItemKey ("mouka|g") — checks survive the plan-model change', () => {
      const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'mouka', amount: 200, unit: 'g' }] });
      const plan = dinnerWeek({ mon: 'a' });
      const result = buildShoppingList({ recipes: [a], plan, pantry: [], sales: [], weekExtras: extras() });
      expect(result.buy[0].key).toBe('mouka|g');
    });

    it('check state re-attaches after adding a second entry to a slot (checks keyed by ItemKey, unaffected)', () => {
      const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'mouka', amount: 200, unit: 'g' }] });
      const b = recipe({ id: 'b', name: 'Recept B', ingredients: [{ name: 'cukr', amount: 100, unit: 'g' }] });
      const weekExtras = extras({ checks: { 'mouka|g': true } });
      const before = buildShoppingList({
        recipes: [a, b],
        plan: weekPlanWith([{ day: 'mon', slot: 'dinner', recipeId: 'a' }]),
        pantry: [],
        sales: [],
        weekExtras,
      });
      const after = buildShoppingList({
        recipes: [a, b],
        plan: weekPlanWith([
          { day: 'mon', slot: 'dinner', recipeId: 'a' },
          { day: 'mon', slot: 'dinner', recipeId: 'b' },
        ]),
        pantry: [],
        sales: [],
        weekExtras,
      });
      expect(before.buy.find((i) => i.key === 'mouka|g')?.checked).toBe(true);
      expect(after.buy.find((i) => i.key === 'mouka|g')?.checked).toBe(true);
    });
  });
});
