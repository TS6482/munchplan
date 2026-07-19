import { describe, expect, it } from 'vitest';
import type { Extras, Pantry, Plans, Recipe, SaleItem, Settings, WeekExtras } from '../types';
import {
  addExtraItem,
  addPantryItem,
  applyExtrasOp,
  applyPantryOp,
  applyPlansOp,
  applyRecipesOp,
  applySalesOp,
  applySettingsOp,
  assignDay,
  clearSales,
  deleteRecipe,
  normalizePantry,
  removePantryItem,
  setBlockedList,
  setCheck,
  setPersonName,
  setRotationWeeks,
  upsertDietRule,
  upsertRecipe,
  upsertSaleItem,
} from './ops';

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    name: 'Kuřecí stehna',
    ingredients: [{ name: 'kuřecí stehna', amount: 500, unit: 'g' }],
    category: 'maso',
    effort: 'normal',
    untried: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

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
});

describe('plans ops', () => {
  it('assignDay applied to remote with a different day/week changed: both survive', () => {
    const remote: Plans = {
      '2026-W30': { days: { mon: null, tue: 'r9', wed: null, thu: null, fri: null, sat: null, sun: null } },
    };
    const result = applyPlansOp(assignDay('2026-W30', 'mon', 'r1'), remote);
    expect(result['2026-W30'].days.mon).toBe('r1');
    expect(result['2026-W30'].days.tue).toBe('r9');
  });

  it('creates a fresh week entry when assigning into a week the remote does not have', () => {
    const remote: Plans = {};
    const result = applyPlansOp(assignDay('2026-W31', 'wed', 'r5'), remote);
    expect(result['2026-W31'].days.wed).toBe('r5');
    expect(result['2026-W31'].days.mon).toBeNull();
  });

  it('does not mutate the input object', () => {
    const remote: Plans = {
      '2026-W30': { days: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } },
    };
    const frozen = JSON.parse(JSON.stringify(remote)) as Plans;
    applyPlansOp(assignDay('2026-W30', 'mon', 'r1'), remote);
    expect(remote).toEqual(frozen);
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
