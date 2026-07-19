import { describe, expect, it } from 'vitest';
import type { Recipe } from '../../types';
import {
  canBePlanned,
  formatAmount,
  fromRecipe,
  parseAmount,
  promoteRecipe,
  sourceHref,
  toRecipe,
  validateFullForm,
  validateQuickAdd,
  type FormValues,
} from './recipeFormLogic';

function emptyForm(overrides: Partial<FormValues> = {}): FormValues {
  return {
    name: '',
    category: 'jiné',
    effort: 'normal',
    source: '',
    notes: '',
    ingredients: [],
    ...overrides,
  };
}

describe('parseAmount', () => {
  it('empty string is undefined (no amount given)', () => {
    expect(parseAmount('')).toBeUndefined();
  });

  it('accepts Czech decimal comma', () => {
    expect(parseAmount('0,5')).toBe(0.5);
  });

  it('accepts a plain integer', () => {
    expect(parseAmount('2')).toBe(2);
  });

  it('accepts a dot decimal too', () => {
    expect(parseAmount('1.5')).toBe(1.5);
  });

  it('rejects non-numeric input', () => {
    expect(parseAmount('abc')).toBe('invalid');
  });

  it('rejects negative numbers', () => {
    expect(parseAmount('-1')).toBe('invalid');
  });

  it('rejects zero (meaningless amount)', () => {
    expect(parseAmount('0')).toBe('invalid');
  });

  it('trims whitespace', () => {
    expect(parseAmount('  2  ')).toBe(2);
  });
});

describe('validateFullForm', () => {
  it('rejects a missing name', () => {
    const result = validateFullForm(
      emptyForm({ ingredients: [{ name: 'mouka', amountStr: '', unit: '' }] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.name).toBeTruthy();
  });

  it('rejects zero ingredients', () => {
    const result = validateFullForm(emptyForm({ name: 'Guláš' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.ingredients).toBeTruthy();
  });

  it('silently drops a trailing blank ingredient row', () => {
    const result = validateFullForm(
      emptyForm({
        name: 'Guláš',
        ingredients: [
          { name: 'maso', amountStr: '500', unit: 'g' },
          { name: '', amountStr: '', unit: '' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.recipe.ingredients).toHaveLength(1);
  });

  it('errors when a non-blank row is missing a name', () => {
    const result = validateFullForm(
      emptyForm({
        name: 'Guláš',
        ingredients: [{ name: '', amountStr: '500', unit: 'g' }],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('errors when an amount is unparseable', () => {
    const result = validateFullForm(
      emptyForm({
        name: 'Guláš',
        ingredients: [{ name: 'maso', amountStr: 'abc', unit: 'g' }],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('accepts a valid full form, mapping comma amounts and dropping blank rows', () => {
    const result = validateFullForm(
      emptyForm({
        name: '  Guláš  ',
        category: 'maso',
        effort: 'hard',
        source: 'https://example.com',
        notes: 'Vařit dlouho',
        ingredients: [
          { name: 'maso', amountStr: '0,5', unit: 'kg' },
          { name: 'sůl', amountStr: '', unit: '' },
          { name: '', amountStr: '', unit: '' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipe).toEqual({
        name: 'Guláš',
        category: 'maso',
        effort: 'hard',
        source: 'https://example.com',
        notes: 'Vařit dlouho',
        ingredients: [
          { name: 'maso', amount: 0.5, unit: 'kg' },
          { name: 'sůl' },
        ],
        untried: false,
      });
    }
  });

  it('omits empty source/notes', () => {
    const result = validateFullForm(
      emptyForm({ name: 'Guláš', ingredients: [{ name: 'maso', amountStr: '', unit: '' }] }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipe.source).toBeUndefined();
      expect(result.recipe.notes).toBeUndefined();
    }
  });
});

describe('validateQuickAdd', () => {
  it('rejects a missing name', () => {
    const result = validateQuickAdd('', 'https://instagram.com/x');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.name).toBeTruthy();
  });

  it('accepts name only, producing an untried draft with no ingredients', () => {
    const result = validateQuickAdd('Rychlé rizoto', '');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipe.name).toBe('Rychlé rizoto');
      expect(result.recipe.ingredients).toEqual([]);
      expect(result.recipe.untried).toBe(true);
      expect(result.recipe.source).toBeUndefined();
    }
  });

  it('accepts name + source', () => {
    const result = validateQuickAdd('  Rychlé rizoto  ', '  https://instagram.com/x  ');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipe.name).toBe('Rychlé rizoto');
      expect(result.recipe.source).toBe('https://instagram.com/x');
    }
  });
});

describe('toRecipe', () => {
  const draft = {
    name: 'Guláš',
    category: 'maso' as const,
    effort: 'normal' as const,
    source: undefined,
    notes: undefined,
    ingredients: [{ name: 'maso' }],
    untried: false,
  };

  it('creates a new recipe with a generated id and createdAt=updatedAt=now', () => {
    const recipe = toRecipe(draft, undefined, '2026-07-19T10:00:00.000Z', () => 'fixed-id');
    expect(recipe.id).toBe('fixed-id');
    expect(recipe.createdAt).toBe('2026-07-19T10:00:00.000Z');
    expect(recipe.updatedAt).toBe('2026-07-19T10:00:00.000Z');
    expect(recipe.untried).toBe(false);
  });

  it('quick-add draft creates an untried recipe', () => {
    const recipe = toRecipe({ ...draft, untried: true, ingredients: [] }, undefined, '2026-07-19T10:00:00.000Z', () => 'id-2');
    expect(recipe.untried).toBe(true);
  });

  it('preserves id/createdAt/untried on edit, updates updatedAt', () => {
    const existing: Recipe = {
      id: 'existing-id',
      name: 'Guláš stará',
      category: 'jiné',
      effort: 'quick',
      ingredients: [],
      untried: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    const recipe = toRecipe(draft, existing, '2026-07-19T10:00:00.000Z');
    expect(recipe.id).toBe('existing-id');
    expect(recipe.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(recipe.untried).toBe(true);
    expect(recipe.updatedAt).toBe('2026-07-19T10:00:00.000Z');
    expect(recipe.name).toBe('Guláš');
  });
});

describe('promoteRecipe', () => {
  it('sets untried false and updates updatedAt', () => {
    const recipe: Recipe = {
      id: 'r1',
      name: 'Rizoto',
      category: 'jiné',
      effort: 'quick',
      ingredients: [],
      untried: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const promoted = promoteRecipe(recipe, '2026-07-19T10:00:00.000Z');
    expect(promoted.untried).toBe(false);
    expect(promoted.updatedAt).toBe('2026-07-19T10:00:00.000Z');
    expect(promoted.id).toBe('r1');
  });
});

describe('canBePlanned', () => {
  it('is false with zero ingredients', () => {
    expect(canBePlanned({ ingredients: [] } as unknown as Recipe)).toBe(false);
  });

  it('is true with at least one ingredient', () => {
    expect(canBePlanned({ ingredients: [{ name: 'sůl' }] } as unknown as Recipe)).toBe(true);
  });
});

describe('sourceHref', () => {
  it('accepts an https URL', () => {
    expect(sourceHref('https://instagram.com/p/x')).toBe('https://instagram.com/p/x');
  });

  it('accepts an http URL', () => {
    expect(sourceHref('http://example.com')).toBe('http://example.com');
  });

  it('rejects a javascript: URL', () => {
    expect(sourceHref('javascript:alert(1)')).toBeNull();
  });

  it('renders plain text (non-URL) as null', () => {
    expect(sourceHref('recept od mámy')).toBeNull();
  });

  it('returns null for undefined/empty', () => {
    expect(sourceHref(undefined)).toBeNull();
    expect(sourceHref('')).toBeNull();
  });
});

describe('formatAmount', () => {
  it('formats a half with a comma', () => {
    expect(formatAmount(0.5)).toBe('0,5');
  });

  it('formats a whole number with no decimal', () => {
    expect(formatAmount(500)).toBe('500');
  });

  it('rounds floating point noise from summed decimals', () => {
    expect(formatAmount(0.1 + 0.2)).toBe('0,3');
  });
});

describe('fromRecipe', () => {
  it('maps a recipe back into form values, formatting amounts with a comma', () => {
    const recipe: Recipe = {
      id: 'r1',
      name: 'Guláš',
      category: 'maso',
      effort: 'hard',
      source: 'https://example.com',
      notes: 'Vařit dlouho',
      ingredients: [
        { name: 'maso', amount: 0.5, unit: 'kg' },
        { name: 'sůl' },
      ],
      untried: false,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(fromRecipe(recipe)).toEqual({
      name: 'Guláš',
      category: 'maso',
      effort: 'hard',
      source: 'https://example.com',
      notes: 'Vařit dlouho',
      ingredients: [
        { name: 'maso', amountStr: '0,5', unit: 'kg' },
        { name: 'sůl', amountStr: '', unit: '' },
      ],
    });
  });

  it('maps missing optional fields to empty strings', () => {
    const recipe: Recipe = {
      id: 'r1',
      name: 'Rizoto',
      category: 'jiné',
      effort: 'quick',
      ingredients: [],
      untried: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    expect(fromRecipe(recipe)).toEqual({
      name: 'Rizoto',
      category: 'jiné',
      effort: 'quick',
      source: '',
      notes: '',
      ingredients: [],
    });
  });
});
