import { describe, expect, it } from 'vitest';
import type { SaleItem } from '../../types';
import { sortedSales, validateSaleName } from './salesLogic';

describe('validateSaleName', () => {
  it('rejects an empty name', () => {
    const result = validateSaleName('', []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
  });

  it('rejects a whitespace-only name', () => {
    const result = validateSaleName('   ', []);
    expect(result.ok).toBe(false);
  });

  it('accepts a new name (not an update)', () => {
    const existing: SaleItem[] = [{ name: 'Mléko' }];
    const result = validateSaleName('Kuřecí', existing);
    expect(result).toEqual({ ok: true, isUpdate: false });
  });

  it('treats a normalized-duplicate name as an update (upsert merges, newer note wins)', () => {
    const existing: SaleItem[] = [{ name: 'Kuřecí', note: 'Lidl 89 Kč' }];
    const result = validateSaleName('kuřecí', existing);
    expect(result).toEqual({ ok: true, isUpdate: true });
  });
});

describe('sortedSales', () => {
  it('sorts by name using cs-locale collation', () => {
    const names = ['Chleba', 'cibule', 'Česnek', 'Banán'];
    const sales: SaleItem[] = names.map((name) => ({ name }));
    const expectedOrder = names.slice().sort((a, b) => a.localeCompare(b, 'cs'));

    expect(sortedSales(sales).map((s) => s.name)).toEqual(expectedOrder);
  });

  it('does not mutate the input array', () => {
    const sales: SaleItem[] = [{ name: 'b' }, { name: 'a' }];
    const copy = sales.slice();
    sortedSales(sales);
    expect(sales).toEqual(copy);
  });
});
