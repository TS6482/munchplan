import { describe, expect, it } from 'vitest';
import type { DietRule } from '../types';
import { evaluateQuotas, unmetMinCategories, wouldExceedMax } from './quota';

describe('evaluateQuotas', () => {
  it('reports count against a max rule', () => {
    const rules: DietRule[] = [{ category: 'maso', max: 2 }];
    expect(evaluateQuotas(['maso', 'maso'], rules)).toEqual([
      { category: 'maso', count: 2, min: undefined, max: 2, metMin: true, atMax: true },
    ]);
  });

  it('reports metMin true when the rule has no min', () => {
    const rules: DietRule[] = [{ category: 'maso', max: 2 }];
    expect(evaluateQuotas([], rules)[0].metMin).toBe(true);
  });

  it('reports metMin false when count is below min', () => {
    const rules: DietRule[] = [{ category: 'ryba', min: 1 }];
    expect(evaluateQuotas([], rules)[0]).toMatchObject({ count: 0, metMin: false, atMax: false });
  });

  it('reports metMin true once min is reached', () => {
    const rules: DietRule[] = [{ category: 'ryba', min: 1 }];
    expect(evaluateQuotas(['ryba'], rules)[0].metMin).toBe(true);
  });

  it('handles multiple rules simultaneously', () => {
    const rules: DietRule[] = [
      { category: 'maso', max: 2 },
      { category: 'ryba', min: 1 },
    ];
    const result = evaluateQuotas(['maso', 'maso', 'vege'], rules);
    expect(result).toEqual([
      { category: 'maso', count: 2, min: undefined, max: 2, metMin: true, atMax: true },
      { category: 'ryba', count: 0, min: 1, max: undefined, metMin: false, atMax: false },
    ]);
  });

  it('returns an empty array for empty rules', () => {
    expect(evaluateQuotas(['maso'], [])).toEqual([]);
  });

  it('returns zero counts for an empty plan', () => {
    const rules: DietRule[] = [{ category: 'maso', max: 2 }];
    expect(evaluateQuotas([], rules)[0].count).toBe(0);
  });

  it('normalizes category comparison (case/diacritics insensitive)', () => {
    const rules: DietRule[] = [{ category: 'maso', max: 2 }];
    expect(evaluateQuotas(['Maso', 'MASO'], rules)[0].count).toBe(2);
  });
});

describe('wouldExceedMax', () => {
  const rules: DietRule[] = [{ category: 'maso', max: 2 }];

  it('is true when already at max', () => {
    expect(wouldExceedMax('maso', ['maso', 'maso'], rules)).toBe(true);
  });

  it('is false when below max', () => {
    expect(wouldExceedMax('maso', ['maso'], rules)).toBe(false);
  });

  it('is false (unconstrained) for a category with no rule', () => {
    expect(wouldExceedMax('vege', ['vege', 'vege', 'vege'], rules)).toBe(false);
  });

  it('is false for a rule that has no max', () => {
    const minOnly: DietRule[] = [{ category: 'ryba', min: 1 }];
    expect(wouldExceedMax('ryba', ['ryba', 'ryba', 'ryba'], minOnly)).toBe(false);
  });

  it('is false against an empty plan', () => {
    expect(wouldExceedMax('maso', [], rules)).toBe(false);
  });

  it('is false against empty rules', () => {
    expect(wouldExceedMax('maso', ['maso', 'maso'], [])).toBe(false);
  });

  it('normalizes category comparison', () => {
    expect(wouldExceedMax('Maso', ['maso', 'maso'], rules)).toBe(true);
  });
});

describe('unmetMinCategories', () => {
  const rules: DietRule[] = [{ category: 'ryba', min: 1 }];

  it('lists a category whose min is not yet met', () => {
    expect(unmetMinCategories([], rules)).toEqual(['ryba']);
  });

  it('excludes a category once its min is met', () => {
    expect(unmetMinCategories(['ryba'], rules)).toEqual([]);
  });

  it('is unconstrained (empty) for a category with no rule', () => {
    expect(unmetMinCategories(['vege'], [])).toEqual([]);
  });

  it('is empty against empty rules', () => {
    expect(unmetMinCategories(['maso'], [])).toEqual([]);
  });

  it('is empty against an empty plan when there is no min rule', () => {
    const maxOnly: DietRule[] = [{ category: 'maso', max: 2 }];
    expect(unmetMinCategories([], maxOnly)).toEqual([]);
  });

  it('handles multiple rules simultaneously', () => {
    const multi: DietRule[] = [
      { category: 'ryba', min: 1 },
      { category: 'vege', min: 2 },
    ];
    expect(unmetMinCategories(['vege'], multi)).toEqual(['ryba', 'vege']);
  });
});
