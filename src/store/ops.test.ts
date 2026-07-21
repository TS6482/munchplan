import { describe, expect, it } from 'vitest';
import type { Extras, Pantry, Plans, Recipe, SaleItem, Settings, WeekExtras, WeekPlan } from '../types';
import { makeRecipe } from '../testing/fixtures';
import { emptyWeekPlan } from '../engine/planModel';
import {
  activateSlot,
  addExtraItem,
  addMealEntry,
  addPantryItem,
  applyExtrasOp,
  applyPantryOp,
  applyPlansOp,
  applyRecipesOp,
  applySalesOp,
  applySettingsOp,
  clearSales,
  deactivateSlot,
  deleteRecipe,
  normalizePantry,
  normalizePlans,
  normalizeRecipes,
  removeMealEntry,
  removePantryItem,
  replaceAutoEntries,
  setBlockedList,
  setCheck,
  setPersonName,
  setRotationWeeks,
  upsertDietRule,
  upsertRecipe,
  upsertSaleItem,
} from './ops';

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    persons: [
      { name: 'Osoba 1', blocked: [] },
      { name: 'Osoba 2', blocked: [] },
    ],
    dietRules: [],
    rotationWeeks: 2,
    ...overrides,
  };
}

function makeWeekExtras(overrides: Partial<WeekExtras> = {}): WeekExtras {
  return { checks: {}, extraItems: [], homeOverrides: {}, ...overrides };
}

describe('pantry ops', () => {
  it('removePantryItem re-applied on remote that meanwhile gained an item: deletion sticks AND the new item survives', () => {
    const remote: Pantry = [{ name: 'sůl' }, { name: 'cibule' }, { name: 'nová položka' }];
    const result = applyPantryOp(removePantryItem('sůl'), remote);
    const names = result.map((i) => i.name);
    expect(names).not.toContain('sůl');
    expect(names).toContain('cibule');
    expect(names).toContain('nová položka');
  });

  it('addPantryItem appends a new item with amount/unit when the name is new', () => {
    const remote: Pantry = [{ name: 'Sůl' }];
    const result = applyPantryOp(addPantryItem('rýže', 500, 'g'), remote);
    expect(result).toEqual([{ name: 'Sůl' }, { name: 'rýže', amount: 500, unit: 'g' }]);
  });

  it('addPantryItem on an existing normalized name UPDATES amount/unit, preserving the stored name spelling', () => {
    const remote: Pantry = [{ name: 'Sůl' }];
    const result = applyPantryOp(addPantryItem('sul', 2, 'kg'), remote);
    expect(result).toEqual([{ name: 'Sůl', amount: 2, unit: 'kg' }]);
  });

  it('addPantryItem with amount/unit omitted on an existing item CLEARS its stored amount/unit (newer wins)', () => {
    const remote: Pantry = [{ name: 'Sůl', amount: 2, unit: 'kg' }];
    const result = applyPantryOp(addPantryItem('sul'), remote);
    expect(result).toEqual([{ name: 'Sůl' }]);
  });

  it('does not mutate the input array', () => {
    const remote: Pantry = [{ name: 'sůl' }];
    const frozen = JSON.parse(JSON.stringify(remote)) as Pantry;
    applyPantryOp(removePantryItem('sůl'), remote);
    applyPantryOp(addPantryItem('cukr'), remote);
    expect(remote).toEqual(frozen);
  });
});

describe('normalizePantry', () => {
  it('converts legacy string entries to {name}', () => {
    expect(normalizePantry(['sůl', 'mouka'])).toEqual([{ name: 'sůl' }, { name: 'mouka' }]);
  });

  it('passes through well-formed object entries with amount/unit', () => {
    const data = [{ name: 'rýže', amount: 500, unit: 'g' }];
    expect(normalizePantry(data)).toEqual(data);
  });

  it('drops unparseable entries (non-string, missing/non-string name)', () => {
    expect(normalizePantry([{ name: 'ok' }, 42, null, { foo: 'bar' }])).toEqual([{ name: 'ok' }]);
  });

  it('non-array input returns an empty array', () => {
    expect(normalizePantry(null)).toEqual([]);
    expect(normalizePantry(undefined)).toEqual([]);
    expect(normalizePantry({})).toEqual([]);
  });
});

describe('sales ops', () => {
  it('clearSales re-applied on remote with a concurrently added item ends empty (clear wins)', () => {
    const remote: SaleItem[] = [{ name: 'kuřecí' }, { name: 'nová sleva' }];
    const result = applySalesOp(clearSales(), remote);
    expect(result).toEqual([]);
  });

  it('upsertSaleItem dedupes by normalized name, keeping newer note', () => {
    const remote: SaleItem[] = [{ name: 'Kuřecí', note: 'stará poznámka' }];
    const result = applySalesOp(upsertSaleItem('kuřecí', 'Albert -20%'), remote);
    expect(result).toEqual([{ name: 'Kuřecí', note: 'Albert -20%' }]);
  });

  it('does not mutate the input array', () => {
    const remote: SaleItem[] = [{ name: 'kuřecí' }];
    const frozen = JSON.parse(JSON.stringify(remote)) as SaleItem[];
    applySalesOp(clearSales(), remote);
    expect(remote).toEqual(frozen);
  });
});

describe('recipes ops', () => {
  it('deleteRecipe applied to remote where another recipe was edited: both effects survive', () => {
    const editedOther = makeRecipe({ id: 'r2', name: 'Edited elsewhere' });
    const remote: Recipe[] = [makeRecipe({ id: 'r1' }), editedOther];
    const result = applyRecipesOp(deleteRecipe('r1'), remote);
    expect(result.find((r) => r.id === 'r1')).toBeUndefined();
    expect(result.find((r) => r.id === 'r2')).toEqual(editedOther);
  });

  it('upsertRecipe with the same id over a remote edit: local (re-applied) wins (documented last-write)', () => {
    const remoteEdited = makeRecipe({ id: 'r1', name: 'Remote edited name' });
    const remote: Recipe[] = [remoteEdited];
    const local = makeRecipe({ id: 'r1', name: 'Local edited name' });
    const result = applyRecipesOp(upsertRecipe(local), remote);
    expect(result).toEqual([local]);
  });

  it('does not mutate the input array', () => {
    const remote: Recipe[] = [makeRecipe()];
    const frozen = JSON.parse(JSON.stringify(remote)) as Recipe[];
    applyRecipesOp(deleteRecipe('r1'), remote);
    applyRecipesOp(upsertRecipe(makeRecipe({ id: 'r1', name: 'changed' })), remote);
    expect(remote).toEqual(frozen);
  });

  it('applyRecipesOp on a legacy-shape remote normalizes it first, so the merged result is fully new-shape', () => {
    const legacyRemote = [
      {
        id: 'r1',
        name: 'Stará polévka',
        ingredients: [{ name: 'zelenina' }],
        category: 'polévka',
        effort: 'quick',
        untried: false,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
        // no suitableFor / componentType / pairings
      },
    ] as unknown as Recipe[];
    const local = makeRecipe({ id: 'r2', name: 'New recipe' });
    const result = applyRecipesOp(upsertRecipe(local), legacyRemote);

    const migrated = result.find((r) => r.id === 'r1');
    expect(migrated?.suitableFor).toEqual(['lunch', 'dinner']);
    expect(migrated?.componentType).toBe('full');
    expect(migrated?.pairings).toEqual({ sides: [], salads: [] });
    expect(result.find((r) => r.id === 'r2')).toEqual(local);
  });
});

describe('normalizeRecipes', () => {
  it('legacy recipe without the new fields gets full defaults', () => {
    const legacy = {
      id: 'r1',
      name: 'Stará polévka',
      ingredients: [{ name: 'zelenina' }],
      category: 'polévka',
      effort: 'quick',
      untried: false,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    const [result] = normalizeRecipes([legacy]);
    expect(result.suitableFor).toEqual(['lunch', 'dinner']);
    expect(result.componentType).toBe('full');
    expect(result.pairings).toEqual({ sides: [], salads: [] });
    // Untouched fields pass through unchanged.
    expect(result.id).toBe('r1');
    expect(result.name).toBe('Stará polévka');
  });

  it('a recipe already carrying valid fields passes through unchanged', () => {
    const recipe = makeRecipe({
      suitableFor: ['breakfast'],
      componentType: 'main',
      pairings: { sides: ['r-side'], salads: ['r-salad'] },
    });
    const [result] = normalizeRecipes([recipe]);
    expect(result).toEqual(recipe);
  });

  it('suitableFor: [] falls back to the default (must never be unsuggestable everywhere)', () => {
    const recipe = makeRecipe({ suitableFor: [] });
    const [result] = normalizeRecipes([recipe]);
    expect(result.suitableFor).toEqual(['lunch', 'dinner']);
  });

  it('suitableFor with only unknown slot strings falls back to the default', () => {
    const recipe = { ...makeRecipe(), suitableFor: ['brunch', 'elevenses'] };
    const [result] = normalizeRecipes([recipe]);
    expect(result.suitableFor).toEqual(['lunch', 'dinner']);
  });

  it('a mixed suitableFor array keeps the valid subset', () => {
    const recipe = { ...makeRecipe(), suitableFor: ['lunch', 'bogus'] };
    const [result] = normalizeRecipes([recipe]);
    expect(result.suitableFor).toEqual(['lunch']);
  });

  it('an unknown componentType falls back to "full"', () => {
    const recipe = { ...makeRecipe(), componentType: 'dessert' };
    const [result] = normalizeRecipes([recipe]);
    expect(result.componentType).toBe('full');
  });

  it('pairings missing one list defaults just that list to []', () => {
    const recipe = { ...makeRecipe(), pairings: { sides: ['r-side'] } };
    const [result] = normalizeRecipes([recipe]);
    expect(result.pairings).toEqual({ sides: ['r-side'], salads: [] });
  });

  it('pairings missing entirely defaults both lists to []', () => {
    const legacy = { ...makeRecipe() } as Partial<Recipe>;
    delete legacy.pairings;
    const [result] = normalizeRecipes([legacy]);
    expect(result.pairings).toEqual({ sides: [], salads: [] });
  });

  it('non-array input returns an empty array', () => {
    expect(normalizeRecipes(null)).toEqual([]);
    expect(normalizeRecipes(undefined)).toEqual([]);
    expect(normalizeRecipes({})).toEqual([]);
  });
});

describe('normalizePlans', () => {
  it('old-shape week: each non-null day becomes a manual dinner entry with a deterministic legacy id', () => {
    const raw = {
      '2026-W30': { days: { mon: 'r1', tue: null, wed: 'r2', thu: null, fri: null, sat: null, sun: null } },
    };
    const result = normalizePlans(raw);
    const week = result['2026-W30'];
    expect(week.activeSlots).toEqual(['dinner']);
    expect(week.days.mon.dinner).toEqual([{ id: 'legacy-2026-W30-mon', recipeIds: ['r1'], source: 'manual' }]);
    expect(week.days.wed.dinner).toEqual([{ id: 'legacy-2026-W30-wed', recipeIds: ['r2'], source: 'manual' }]);
    expect(week.days.tue.dinner).toEqual([]);
    expect(week.days.mon.breakfast).toEqual([]);
    expect(week.days.mon.lunch).toEqual([]);
    expect(week.days.mon.snack).toEqual([]);
  });

  it('already-new-shape week passes through unchanged', () => {
    const week: WeekPlan = emptyWeekPlan(['lunch', 'dinner']);
    week.days.mon.lunch = [{ id: 'e1', recipeIds: ['r1'], source: 'manual' }];
    const result = normalizePlans({ '2026-W30': week });
    expect(result['2026-W30']).toEqual(week);
  });

  it('missing activeSlots on an object week derives the union of slots-with-entries', () => {
    const raw = {
      '2026-W30': {
        days: {
          mon: { breakfast: [{ id: 'e1', recipeIds: ['r1'], source: 'manual' }], lunch: [], dinner: [], snack: [] },
          tue: { breakfast: [], lunch: [], dinner: [{ id: 'e2', recipeIds: ['r2'], source: 'auto' }], snack: [] },
          wed: null,
          thu: null,
          fri: null,
          sat: null,
          sun: null,
        },
      },
    };
    expect(normalizePlans(raw)['2026-W30'].activeSlots).toEqual(['breakfast', 'dinner']);
  });

  it('mixed week (object days + one string day, as an old device would write post-migration) normalizes per day', () => {
    const raw = {
      '2026-W30': {
        activeSlots: ['lunch'],
        days: {
          mon: { breakfast: [], lunch: [{ id: 'e1', recipeIds: ['r1'], source: 'manual' }], dinner: [], snack: [] },
          tue: 'r-legacy',
          wed: null,
          thu: null,
          fri: null,
          sat: null,
          sun: null,
        },
      },
    };
    const result = normalizePlans(raw);
    expect(result['2026-W30'].days.mon.lunch).toEqual([{ id: 'e1', recipeIds: ['r1'], source: 'manual' }]);
    expect(result['2026-W30'].days.tue.dinner).toEqual([
      { id: 'legacy-2026-W30-tue', recipeIds: ['r-legacy'], source: 'manual' },
    ]);
    // Stored activeSlots is respected verbatim when non-empty/valid, not re-derived.
    expect(result['2026-W30'].activeSlots).toEqual(['lunch']);
  });

  it('drops malformed entries (bad id/recipeIds/source types, non-object entries)', () => {
    const raw = {
      '2026-W30': {
        activeSlots: ['dinner'],
        days: {
          mon: {
            breakfast: [],
            lunch: [],
            dinner: [
              { id: 'ok', recipeIds: ['r1'], source: 'manual' },
              { id: 'bad-source', recipeIds: ['r1'], source: 'nonsense' },
              { id: 123, recipeIds: ['r1'], source: 'manual' },
              { id: 'bad-ids', recipeIds: ['r1', 5], source: 'manual' },
              'not-an-object',
            ],
            snack: [],
          },
          tue: null,
          wed: null,
          thu: null,
          fri: null,
          sat: null,
          sun: null,
        },
      },
    };
    expect(normalizePlans(raw)['2026-W30'].days.mon.dinner).toEqual([
      { id: 'ok', recipeIds: ['r1'], source: 'manual' },
    ]);
  });

  it('an explicitly stored empty activeSlots passes through (valid "away week", decision 6)', () => {
    const week = emptyWeekPlan([]);
    expect(normalizePlans({ '2026-W30': week })['2026-W30'].activeSlots).toEqual([]);
  });

  it('non-object input returns {}', () => {
    expect(normalizePlans(null)).toEqual({});
    expect(normalizePlans(undefined)).toEqual({});
    expect(normalizePlans([1, 2])).toEqual({});
    expect(normalizePlans('garbage')).toEqual({});
  });
});

describe('activateSlot / deactivateSlot', () => {
  it('activateSlot adds the slot to activeSlots, creating the week if missing', () => {
    const result = applyPlansOp(activateSlot('2026-W30', 'breakfast'), {});
    expect(result['2026-W30'].activeSlots).toEqual(['breakfast']);
  });

  it('activateSlot is idempotent and keeps SLOT_ORDER regardless of call order', () => {
    let plans: Plans = applyPlansOp(activateSlot('2026-W30', 'snack'), {});
    plans = applyPlansOp(activateSlot('2026-W30', 'dinner'), plans);
    plans = applyPlansOp(activateSlot('2026-W30', 'dinner'), plans); // repeat, must not duplicate
    expect(plans['2026-W30'].activeSlots).toEqual(['dinner', 'snack']);
  });

  it('concurrent activateSlot of DIFFERENT slots both survive sequential (re-)application', () => {
    const remoteAfterA: Plans = { '2026-W30': emptyWeekPlan(['lunch']) };
    const result = applyPlansOp(activateSlot('2026-W30', 'breakfast'), remoteAfterA);
    expect(result['2026-W30'].activeSlots).toEqual(['breakfast', 'lunch']);
  });

  it('deactivateSlot removes the slot from activeSlots and deletes its entries across all seven days', () => {
    let plans: Plans = { '2026-W30': emptyWeekPlan(['dinner', 'lunch']) };
    plans = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'dinner', { id: 'e1', recipeIds: ['r1'], source: 'manual' }),
      plans,
    );
    plans = applyPlansOp(
      addMealEntry('2026-W30', 'wed', 'dinner', { id: 'e2', recipeIds: ['r2'], source: 'manual' }),
      plans,
    );
    const result = applyPlansOp(deactivateSlot('2026-W30', 'dinner'), plans);
    expect(result['2026-W30'].activeSlots).toEqual(['lunch']);
    expect(result['2026-W30'].days.mon.dinner).toEqual([]);
    expect(result['2026-W30'].days.wed.dinner).toEqual([]);
  });

  it('deactivateSlot re-applied on a remote that concurrently gained an entry: the deletion still sticks', () => {
    const plans: Plans = { '2026-W30': emptyWeekPlan(['dinner']) };
    const remoteWithNewEntry = applyPlansOp(
      addMealEntry('2026-W30', 'tue', 'dinner', { id: 'e2', recipeIds: ['r2'], source: 'manual' }),
      plans,
    );
    const reapplied = applyPlansOp(deactivateSlot('2026-W30', 'dinner'), remoteWithNewEntry);
    expect(reapplied['2026-W30'].days.tue.dinner).toEqual([]);
    expect(reapplied['2026-W30'].activeSlots).toEqual([]);
  });

  it('concurrent toggles of DIFFERENT slots (activate one, deactivate another) both survive sequential application', () => {
    let plans: Plans = { '2026-W30': emptyWeekPlan(['dinner', 'lunch']) };
    plans = applyPlansOp(activateSlot('2026-W30', 'breakfast'), plans);
    plans = applyPlansOp(deactivateSlot('2026-W30', 'lunch'), plans);
    expect(plans['2026-W30'].activeSlots).toEqual(['breakfast', 'dinner']);
  });

  it('deactivateSlot on a week that does not exist is a no-op, never throws', () => {
    expect(applyPlansOp(deactivateSlot('2026-W30', 'dinner'), {})).toEqual({});
  });
});

describe('addMealEntry / removeMealEntry', () => {
  it('appends an entry to an empty slot, creating the week with activeSlots [slot]', () => {
    const result = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'lunch', { id: 'e1', recipeIds: ['r1'], source: 'manual' }),
      {},
    );
    expect(result['2026-W30'].activeSlots).toEqual(['lunch']);
    expect(result['2026-W30'].days.mon.lunch).toEqual([{ id: 'e1', recipeIds: ['r1'], source: 'manual' }]);
  });

  it('concurrent addMealEntry on the SAME slot: both entries kept (a slot is a list)', () => {
    const remote: Plans = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'dinner', { id: 'e-remote', recipeIds: ['r2'], source: 'manual' }),
      {},
    );
    const result = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'dinner', { id: 'e-local', recipeIds: ['r1'], source: 'manual' }),
      remote,
    );
    expect(result['2026-W30'].days.mon.dinner.map((e) => e.id)).toEqual(['e-remote', 'e-local']);
  });

  it('re-applying addMealEntry with the SAME id twice is idempotent (replaces in place, no duplicate)', () => {
    let plans: Plans = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'dinner', { id: 'e1', recipeIds: ['r1'], source: 'manual' }),
      {},
    );
    plans = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'dinner', { id: 'e1', recipeIds: ['r1'], source: 'manual' }),
      plans,
    );
    expect(plans['2026-W30'].days.mon.dinner).toEqual([{ id: 'e1', recipeIds: ['r1'], source: 'manual' }]);
  });

  it('removeMealEntry filters by id and sticks against a remote that meanwhile re-added other entries', () => {
    let plans: Plans = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'dinner', { id: 'e1', recipeIds: ['r1'], source: 'manual' }),
      {},
    );
    plans = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'dinner', { id: 'e2', recipeIds: ['r2'], source: 'manual' }),
      plans,
    );
    const remoteWithThird = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'dinner', { id: 'e3', recipeIds: ['r3'], source: 'manual' }),
      plans,
    );
    const result = applyPlansOp(removeMealEntry('2026-W30', 'mon', 'dinner', 'e1'), remoteWithThird);
    expect(result['2026-W30'].days.mon.dinner.map((e) => e.id)).toEqual(['e2', 'e3']);
  });

  it('removeMealEntry re-applied on a remote lacking the id is a no-op (no resurrection)', () => {
    const plans: Plans = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'dinner', { id: 'e1', recipeIds: ['r1'], source: 'manual' }),
      {},
    );
    const result = applyPlansOp(removeMealEntry('2026-W30', 'mon', 'dinner', 'already-gone'), plans);
    expect(result['2026-W30'].days.mon.dinner).toEqual([{ id: 'e1', recipeIds: ['r1'], source: 'manual' }]);
  });

  it('removeMealEntry against a missing week is a no-op, never throws', () => {
    expect(applyPlansOp(removeMealEntry('2026-W30', 'mon', 'dinner', 'e1'), {})).toEqual({});
  });

  it('does not mutate the input object', () => {
    const remote: Plans = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'dinner', { id: 'e1', recipeIds: ['r1'], source: 'manual' }),
      {},
    );
    const frozen = JSON.parse(JSON.stringify(remote)) as Plans;
    applyPlansOp(addMealEntry('2026-W30', 'mon', 'dinner', { id: 'e2', recipeIds: ['r2'], source: 'manual' }), remote);
    applyPlansOp(removeMealEntry('2026-W30', 'mon', 'dinner', 'e1'), remote);
    expect(remote).toEqual(frozen);
  });
});

describe('replaceAutoEntries', () => {
  it('preserves remote manual entries and replaces remote auto entries in targeted slots', () => {
    let plans: Plans = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'dinner', { id: 'manual-1', recipeIds: ['r1'], source: 'manual' }),
      {},
    );
    plans = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'dinner', { id: 'auto-old', recipeIds: ['r9'], source: 'auto' }),
      plans,
    );
    const result = applyPlansOp(
      replaceAutoEntries('2026-W30', [
        { day: 'mon', slot: 'dinner', entries: [{ id: 'auto-new', recipeIds: ['r2'], source: 'auto' }] },
      ]),
      plans,
    );
    expect(result['2026-W30'].days.mon.dinner).toEqual([
      { id: 'manual-1', recipeIds: ['r1'], source: 'manual' },
      { id: 'auto-new', recipeIds: ['r2'], source: 'auto' },
    ]);
  });

  it('entries: [] clears stale autos in a targeted slot', () => {
    const plans: Plans = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'dinner', { id: 'auto-old', recipeIds: ['r9'], source: 'auto' }),
      {},
    );
    const result = applyPlansOp(replaceAutoEntries('2026-W30', [{ day: 'mon', slot: 'dinner', entries: [] }]), plans);
    expect(result['2026-W30'].days.mon.dinner).toEqual([]);
  });

  it('creates a missing week with activeSlots = union of targeted slots (SLOT_ORDER-sorted)', () => {
    const result = applyPlansOp(
      replaceAutoEntries('2026-W30', [
        { day: 'mon', slot: 'snack', entries: [{ id: 'a1', recipeIds: ['r1'], source: 'auto' }] },
        { day: 'tue', slot: 'breakfast', entries: [{ id: 'a2', recipeIds: ['r2'], source: 'auto' }] },
      ]),
      {},
    );
    expect(result['2026-W30'].activeSlots).toEqual(['breakfast', 'snack']);
  });

  it('applyPlansOp on a raw old-shape remote normalizes before applying', () => {
    const legacyRemote = {
      '2026-W30': { days: { mon: 'r1', tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } },
    } as unknown as Plans;
    const result = applyPlansOp(
      addMealEntry('2026-W30', 'wed', 'lunch', { id: 'e1', recipeIds: ['r2'], source: 'manual' }),
      legacyRemote,
    );
    expect(result['2026-W30'].days.mon.dinner).toEqual([
      { id: 'legacy-2026-W30-mon', recipeIds: ['r1'], source: 'manual' },
    ]);
    expect(result['2026-W30'].days.wed.lunch).toEqual([{ id: 'e1', recipeIds: ['r2'], source: 'manual' }]);
  });

  it('does not mutate the input object', () => {
    const remote: Plans = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'dinner', { id: 'manual-1', recipeIds: ['r1'], source: 'manual' }),
      {},
    );
    const frozen = JSON.parse(JSON.stringify(remote)) as Plans;
    applyPlansOp(
      replaceAutoEntries('2026-W30', [
        { day: 'mon', slot: 'dinner', entries: [{ id: 'a1', recipeIds: ['r9'], source: 'auto' }] },
      ]),
      remote,
    );
    expect(remote).toEqual(frozen);
  });
});

describe('AC9 concurrency matrix (step 4)', () => {
  it('concurrent addMealEntry on the SAME week, DIFFERENT days: both survive sequential (re-)application', () => {
    const remoteAfterA: Plans = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'dinner', { id: 'e-a', recipeIds: ['r-a'], source: 'manual' }),
      {},
    );
    const result = applyPlansOp(
      addMealEntry('2026-W30', 'wed', 'dinner', { id: 'e-b', recipeIds: ['r-b'], source: 'manual' }),
      remoteAfterA,
    );
    expect(result['2026-W30'].days.mon.dinner).toEqual([{ id: 'e-a', recipeIds: ['r-a'], source: 'manual' }]);
    expect(result['2026-W30'].days.wed.dinner).toEqual([{ id: 'e-b', recipeIds: ['r-b'], source: 'manual' }]);
  });

  it('concurrent addMealEntry on the SAME day, DIFFERENT slots: both survive sequential (re-)application', () => {
    const remoteAfterA: Plans = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'lunch', { id: 'e-a', recipeIds: ['r-a'], source: 'manual' }),
      {},
    );
    const result = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'dinner', { id: 'e-b', recipeIds: ['r-b'], source: 'manual' }),
      remoteAfterA,
    );
    expect(result['2026-W30'].days.mon.lunch).toEqual([{ id: 'e-a', recipeIds: ['r-a'], source: 'manual' }]);
    expect(result['2026-W30'].days.mon.dinner).toEqual([{ id: 'e-b', recipeIds: ['r-b'], source: 'manual' }]);
  });

  it('same (week, day, slot), DIFFERENT entries (two adds): both kept, none dropped', () => {
    const remoteAfterA: Plans = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'snack', { id: 'e-a', recipeIds: ['r-a'], source: 'manual' }),
      {},
    );
    const result = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'snack', { id: 'e-b', recipeIds: ['r-b'], source: 'manual' }),
      remoteAfterA,
    );
    expect(result['2026-W30'].days.mon.snack.map((e) => e.id)).toEqual(['e-a', 'e-b']);
  });

  it('remove-vs-add interleaving, applied remove-then-add: X gone, Y present', () => {
    const base: Plans = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'dinner', { id: 'x', recipeIds: ['r-x'], source: 'manual' }),
      {},
    );
    // Device A removes X; device B adds Y — re-applied in this order.
    let result = applyPlansOp(removeMealEntry('2026-W30', 'mon', 'dinner', 'x'), base);
    result = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'dinner', { id: 'y', recipeIds: ['r-y'], source: 'manual' }),
      result,
    );
    expect(result['2026-W30'].days.mon.dinner).toEqual([{ id: 'y', recipeIds: ['r-y'], source: 'manual' }]);
  });

  it('remove-vs-add interleaving, applied add-then-remove (reversed order): X still gone, Y still present', () => {
    const base: Plans = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'dinner', { id: 'x', recipeIds: ['r-x'], source: 'manual' }),
      {},
    );
    let result = applyPlansOp(
      addMealEntry('2026-W30', 'mon', 'dinner', { id: 'y', recipeIds: ['r-y'], source: 'manual' }),
      base,
    );
    result = applyPlansOp(removeMealEntry('2026-W30', 'mon', 'dinner', 'x'), result);
    expect(result['2026-W30'].days.mon.dinner).toEqual([{ id: 'y', recipeIds: ['r-y'], source: 'manual' }]);
  });
});

describe('extras ops', () => {
  it('setCheck(false) applied to remote where the item is checked: unchecked, no resurrection', () => {
    const remote: Extras = { weeks: { '2026-W30': makeWeekExtras({ checks: { 'mouka|g': true } }) } };
    const result = applyExtrasOp(setCheck('2026-W30', 'mouka|g', false), remote);
    expect(result.weeks['2026-W30'].checks['mouka|g']).toBeUndefined();
  });

  it('ops on different weeks both survive sequential application', () => {
    let extras: Extras = { weeks: {} };
    extras = applyExtrasOp(setCheck('2026-W30', 'mouka|g', true), extras);
    extras = applyExtrasOp(setCheck('2026-W31', 'cukr|g', true), extras);
    expect(extras.weeks['2026-W30'].checks['mouka|g']).toBe(true);
    expect(extras.weeks['2026-W31'].checks['cukr|g']).toBe(true);
  });

  it('ops on a missing week create the week entry', () => {
    const remote: Extras = { weeks: {} };
    const item = { id: 'e1', name: 'drogerie', checked: false };
    const result = applyExtrasOp(addExtraItem('2026-W30', item), remote);
    expect(result.weeks['2026-W30'].extraItems).toEqual([item]);
    expect(result.weeks['2026-W30'].checks).toEqual({});
  });

  it('does not mutate the input object', () => {
    const remote: Extras = { weeks: { '2026-W30': makeWeekExtras({ checks: { 'mouka|g': true } }) } };
    const frozen = JSON.parse(JSON.stringify(remote)) as Extras;
    applyExtrasOp(setCheck('2026-W30', 'mouka|g', false), remote);
    applyExtrasOp(addExtraItem('2026-W30', { id: 'e1', name: 'x', checked: false }), remote);
    expect(remote).toEqual(frozen);
  });
});

describe('settings ops', () => {
  it('setBlockedList(person0) applied to remote with changed diet rules: both survive (disjoint-field merge)', () => {
    const remote: Settings = makeSettings({ dietRules: [{ category: 'maso', max: 2 }] });
    const result = applySettingsOp(setBlockedList(0, ['houby']), remote);
    expect(result.persons[0].blocked).toEqual(['houby']);
    expect(result.dietRules).toEqual([{ category: 'maso', max: 2 }]);
    expect(result.persons[1]).toEqual(remote.persons[1]);
  });

  it('setPersonName updates only the targeted person', () => {
    const remote: Settings = makeSettings();
    const result = applySettingsOp(setPersonName(1, 'Nové jméno'), remote);
    expect(result.persons[1].name).toBe('Nové jméno');
    expect(result.persons[0]).toEqual(remote.persons[0]);
  });

  it('upsertDietRule replaces an existing rule for the same category, adds a new one otherwise', () => {
    const remote: Settings = makeSettings({ dietRules: [{ category: 'maso', max: 2 }] });
    const withReplaced = applySettingsOp(upsertDietRule('maso', undefined, 3), remote);
    expect(withReplaced.dietRules).toEqual([{ category: 'maso', min: undefined, max: 3 }]);

    const withAdded = applySettingsOp(upsertDietRule('ryba', 1, undefined), remote);
    expect(withAdded.dietRules).toEqual([{ category: 'maso', max: 2 }, { category: 'ryba', min: 1, max: undefined }]);
  });

  it('setRotationWeeks updates rotationWeeks only', () => {
    const remote: Settings = makeSettings();
    const result = applySettingsOp(setRotationWeeks(4), remote);
    expect(result.rotationWeeks).toBe(4);
  });

  it('does not mutate the input object', () => {
    const remote: Settings = makeSettings({ dietRules: [{ category: 'maso', max: 2 }] });
    const frozen = JSON.parse(JSON.stringify(remote)) as Settings;
    applySettingsOp(setBlockedList(0, ['houby']), remote);
    applySettingsOp(setPersonName(1, 'x'), remote);
    expect(remote).toEqual(frozen);
  });
});
