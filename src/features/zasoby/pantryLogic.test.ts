import { describe, expect, it } from 'vitest';
import type { Pantry } from '../../types';
import { sortedPantry, validatePantryName } from './pantryLogic';

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

  it('accepts a new name', () => {
    const pantry: Pantry = ['Sůl'];
    expect(validatePantryName('Pepř', pantry)).toEqual({ ok: true });
  });

  it('rejects a normalized-duplicate name', () => {
    const pantry: Pantry = ['Sůl'];
    const result = validatePantryName('sůl', pantry);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('Už je ve spíži');
  });
});

describe('sortedPantry', () => {
  it('sorts using cs-locale collation', () => {
    const names = ['Chleba', 'cibule', 'Česnek', 'Banán'];
    const expectedOrder = names.slice().sort((a, b) => a.localeCompare(b, 'cs'));

    expect(sortedPantry(names)).toEqual(expectedOrder);
  });

  it('does not mutate the input array', () => {
    const pantry: Pantry = ['b', 'a'];
    const copy = pantry.slice();
    sortedPantry(pantry);
    expect(pantry).toEqual(copy);
  });
});
