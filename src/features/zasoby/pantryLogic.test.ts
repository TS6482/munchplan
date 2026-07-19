import { describe, expect, it } from 'vitest';
import type { Pantry } from '../../types';
import { pantryItemText, sortedPantry, validatePantryName } from './pantryLogic';

describe('validatePantryName', () => {
  it('rejects an empty name', () => {
    const result = validatePantryName('', []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
  });

  it('rejects a whitespace-only name', () => {
    const result = validatePantryName('   ', []);
    expect(result.ok).toBe(false);
  });

  it('accepts a new name (not an update)', () => {
    const pantry: Pantry = [{ name: 'Sůl' }];
    expect(validatePantryName('Pepř', pantry)).toEqual({ ok: true, isUpdate: false });
  });

  it('treats a normalized-duplicate name as an update (upsert merges amount/unit, mirrors salesLogic)', () => {
    const pantry: Pantry = [{ name: 'Sůl' }];
    const result = validatePantryName('sůl', pantry);
    expect(result).toEqual({ ok: true, isUpdate: true });
  });
});

describe('sortedPantry', () => {
  it('sorts using cs-locale collation', () => {
    const names = ['Chleba', 'cibule', 'Česnek', 'Banán'];
    const pantry: Pantry = names.map((name) => ({ name }));
    const expectedOrder = names.slice().sort((a, b) => a.localeCompare(b, 'cs'));

    expect(sortedPantry(pantry).map((i) => i.name)).toEqual(expectedOrder);
  });

  it('does not mutate the input array', () => {
    const pantry: Pantry = [{ name: 'b' }, { name: 'a' }];
    const copy = pantry.slice();
    sortedPantry(pantry);
    expect(pantry).toEqual(copy);
  });
});

describe('pantryItemText', () => {
  it('shows just the name when no amount is known', () => {
    expect(pantryItemText({ name: 'hladká mouka' })).toBe('hladká mouka');
  });

  it('shows name — amount unit when both are known', () => {
    expect(pantryItemText({ name: 'hladká mouka', amount: 2, unit: 'kg' })).toBe('hladká mouka — 2 kg');
    expect(pantryItemText({ name: 'rýže', amount: 500, unit: 'g' })).toBe('rýže — 500 g');
  });

  it('shows name — amount with no trailing unit when unit is absent', () => {
    expect(pantryItemText({ name: 'vejce', amount: 6 })).toBe('vejce — 6');
  });

  it('formats comma decimals via formatAmount', () => {
    expect(pantryItemText({ name: 'mléko', amount: 0.5, unit: 'l' })).toBe('mléko — 0,5 l');
  });
});
