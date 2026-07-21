import { describe, expect, it } from 'vitest';
import type { MealSlotKey, Recipe } from '../../types';
import { makeRecipe } from '../../testing/fixtures';
import {
  canBePlanned,
  emptyForm as productionEmptyForm,
  filterPool,
  formatAmount,
  fromRecipe,
  pairingChips,
  pairingPools,
  parseAmount,
  promoteRecipe,
  sourceHref,
  togglePairing,
  toggleSlotSelection,
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
    portionsStr: '2',
    ingredients: [],
    suitableFor: ['lunch', 'dinner'],
    componentType: 'full',
    pairings: { sides: [], salads: [] },
    ...overrides,
  };
}

describe('emptyForm (production default)', () => {
  it('defaults new recipes to full component type with no pairings', () => {
    const values = productionEmptyForm();
    expect(values.componentType).toBe('full');
    expect(values.pairings).toEqual({ sides: [], salads: [] });
    expect(values.suitableFor).toEqual(['lunch', 'dinner']);
  });
});

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
        portions: 2,
        untried: false,
        suitableFor: ['lunch', 'dinner'],
        componentType: 'full',
        pairings: { sides: [], salads: [] },
      });
    }
  });

  it('passes componentType/pairings through unchanged — an unpaired main is valid (no new validation errors)', () => {
    const result = validateFullForm(
      emptyForm({
        name: 'Kuře pečené',
        ingredients: [{ name: 'kuře', amountStr: '1', unit: 'ks' }],
        componentType: 'main',
        pairings: { sides: [], salads: [] },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipe.componentType).toBe('main');
      expect(result.recipe.pairings).toEqual({ sides: [], salads: [] });
    }
  });

  it('rejects an empty slot selection', () => {
    const result = validateFullForm(
      emptyForm({
        name: 'Guláš',
        ingredients: [{ name: 'maso', amountStr: '500', unit: 'g' }],
        suitableFor: [],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.suitableFor).toBe('Vyberte alespoň jeden typ jídla');
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

  it('defaults suitableFor to oběd + večeře', () => {
    const result = validateQuickAdd('Rychlé rizoto', '');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.recipe.suitableFor).toEqual(['lunch', 'dinner']);
  });

  it('always emits componentType full with empty pairings (quick-add stays full)', () => {
    const result = validateQuickAdd('Rychlé rizoto', '');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipe.componentType).toBe('full');
      expect(result.recipe.pairings).toEqual({ sides: [], salads: [] });
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
    suitableFor: ['lunch', 'dinner'] as MealSlotKey[],
    componentType: 'full' as const,
    pairings: { sides: [], salads: [] },
  };

  it('creates a new recipe with a generated id and createdAt=updatedAt=now', () => {
    const recipe = toRecipe(draft, undefined, '2026-07-19T10:00:00.000Z', () => 'fixed-id');
    expect(recipe.id).toBe('fixed-id');
    expect(recipe.createdAt).toBe('2026-07-19T10:00:00.000Z');
    expect(recipe.updatedAt).toBe('2026-07-19T10:00:00.000Z');
    expect(recipe.untried).toBe(false);
  });

  it('creates with componentType full and empty pairings, suitableFor from draft', () => {
    const recipe = toRecipe(draft, undefined, '2026-07-19T10:00:00.000Z', () => 'fixed-id');
    expect(recipe.componentType).toBe('full');
    expect(recipe.pairings).toEqual({ sides: [], salads: [] });
    expect(recipe.suitableFor).toEqual(['lunch', 'dinner']);
  });

  it('quick-add draft creates an untried recipe', () => {
    const recipe = toRecipe({ ...draft, untried: true, ingredients: [] }, undefined, '2026-07-19T10:00:00.000Z', () => 'id-2');
    expect(recipe.untried).toBe(true);
  });

  it('preserves id/createdAt/untried on edit, updates updatedAt', () => {
    const existing: Recipe = makeRecipe({
      id: 'existing-id',
      name: 'Guláš stará',
      category: 'jiné',
      effort: 'quick',
      ingredients: [],
      untried: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    const recipe = toRecipe(draft, existing, '2026-07-19T10:00:00.000Z');
    expect(recipe.id).toBe('existing-id');
    expect(recipe.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(recipe.untried).toBe(true);
    expect(recipe.updatedAt).toBe('2026-07-19T10:00:00.000Z');
    expect(recipe.name).toBe('Guláš');
  });

  it('edit writes componentType/pairings from the draft, not the existing recipe (the feature — no longer preserved via ...existing)', () => {
    const existing: Recipe = makeRecipe({
      id: 'existing-id',
      componentType: 'main',
      pairings: { sides: ['side-1'], salads: [] },
      suitableFor: ['breakfast'],
    });
    const recipe = toRecipe(
      {
        ...draft,
        suitableFor: ['breakfast', 'snack'],
        componentType: 'side',
        pairings: { sides: [], salads: ['salad-9'] },
      },
      existing,
      '2026-07-19T10:00:00.000Z',
    );
    expect(recipe.suitableFor).toEqual(['breakfast', 'snack']);
    expect(recipe.componentType).toBe('side');
    expect(recipe.pairings).toEqual({ sides: [], salads: ['salad-9'] });
  });
});

describe('promoteRecipe', () => {
  it('sets untried false and updates updatedAt', () => {
    const recipe: Recipe = makeRecipe({
      id: 'r1',
      name: 'Rizoto',
      category: 'jiné',
      effort: 'quick',
      ingredients: [],
      untried: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
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
    const recipe: Recipe = makeRecipe({
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
    });
    expect(fromRecipe(recipe)).toEqual({
      name: 'Guláš',
      category: 'maso',
      effort: 'hard',
      source: 'https://example.com',
      notes: 'Vařit dlouho',
      portionsStr: '2',
      ingredients: [
        { name: 'maso', amountStr: '0,5', unit: 'kg' },
        { name: 'sůl', amountStr: '', unit: '' },
      ],
      suitableFor: ['lunch', 'dinner'],
      componentType: 'full',
      pairings: { sides: [], salads: [] },
    });
  });

  it('maps missing optional fields to empty strings', () => {
    const recipe: Recipe = makeRecipe({
      id: 'r1',
      name: 'Rizoto',
      category: 'jiné',
      effort: 'quick',
      ingredients: [],
      untried: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(fromRecipe(recipe)).toEqual({
      name: 'Rizoto',
      category: 'jiné',
      effort: 'quick',
      source: '',
      notes: '',
      portionsStr: '2',
      ingredients: [],
      suitableFor: ['lunch', 'dinner'],
      componentType: 'full',
      pairings: { sides: [], salads: [] },
    });
  });

  it('round-trips a non-default suitableFor', () => {
    const recipe: Recipe = makeRecipe({ suitableFor: ['breakfast', 'snack'] });
    expect(fromRecipe(recipe).suitableFor).toEqual(['breakfast', 'snack']);
  });

  it('round-trips componentType and pairings, including stale (deleted/re-typed) ids (decision 7)', () => {
    const recipe: Recipe = makeRecipe({
      componentType: 'main',
      pairings: { sides: ['deleted-side', 'side-1'], salads: ['retyped-salad'] },
    });
    const values = fromRecipe(recipe);
    expect(values.componentType).toBe('main');
    expect(values.pairings).toEqual({ sides: ['deleted-side', 'side-1'], salads: ['retyped-salad'] });
  });

  it('a stale pairing id survives open -> save unchanged (decision 7 pin)', () => {
    const existing: Recipe = makeRecipe({
      id: 'main-1',
      componentType: 'main',
      pairings: { sides: ['deleted-side'], salads: [] },
      ingredients: [{ name: 'kuře' }],
    });
    const opened = fromRecipe(existing);
    const result = validateFullForm(opened);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const saved = toRecipe(result.recipe, existing, '2026-07-20T00:00:00.000Z');
    expect(saved.pairings.sides).toEqual(['deleted-side']);
  });
});

describe('togglePairing', () => {
  it('adds an id not yet present, keeping insertion order', () => {
    expect(togglePairing(['a'], 'b')).toEqual(['a', 'b']);
  });

  it('removes an id already present', () => {
    expect(togglePairing(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('pairingPools', () => {
  it('filters by componentType and Czech-sorts sides/salads separately', () => {
    const recipes = [
      makeRecipe({ id: 'side-b', name: 'Brambory', componentType: 'side' }),
      makeRecipe({ id: 'side-a', name: 'Ančovičky', componentType: 'side' }),
      makeRecipe({ id: 'salad-b', name: 'Coleslaw', componentType: 'salad' }),
      makeRecipe({ id: 'salad-a', name: 'Bramborový salát', componentType: 'salad' }),
      makeRecipe({ id: 'main-1', name: 'Kuře', componentType: 'main' }),
      makeRecipe({ id: 'full-1', name: 'Guláš', componentType: 'full' }),
    ];
    const pools = pairingPools(recipes, undefined);
    expect(pools.sides.map((r) => r.id)).toEqual(['side-a', 'side-b']);
    expect(pools.salads.map((r) => r.id)).toEqual(['salad-a', 'salad-b']);
  });

  it('excludes the edited recipe id (a recipe cannot pair with itself)', () => {
    const recipes = [
      makeRecipe({ id: 'self', name: 'Brambory', componentType: 'side' }),
      makeRecipe({ id: 'other', name: 'Rýže', componentType: 'side' }),
    ];
    const pools = pairingPools(recipes, 'self');
    expect(pools.sides.map((r) => r.id)).toEqual(['other']);
  });

  it('undefined editedId (creating a new recipe) excludes nothing', () => {
    const recipes = [makeRecipe({ id: 's1', name: 'Rýže', componentType: 'side' })];
    expect(pairingPools(recipes, undefined).sides).toHaveLength(1);
  });
});

describe('filterPool', () => {
  it('filters by normalized (diacritic/case-insensitive) name substring', () => {
    const pool = [
      makeRecipe({ id: '1', name: 'Bramborová kaše' }),
      makeRecipe({ id: '2', name: 'Rýže' }),
    ];
    expect(filterPool(pool, 'bramb').map((r) => r.id)).toEqual(['1']);
    expect(filterPool(pool, 'RYZE').map((r) => r.id)).toEqual(['2']);
  });

  it('an empty query returns the pool unchanged', () => {
    const pool = [makeRecipe({ id: '1' }), makeRecipe({ id: '2' })];
    expect(filterPool(pool, '')).toEqual(pool);
  });
});

describe('pairingChips', () => {
  it('returns names of currently paired sides/salads, skipping stale ids', () => {
    const side = makeRecipe({ id: 'side-1', name: 'Brambory', componentType: 'side' });
    const salad = makeRecipe({ id: 'salad-1', name: 'Coleslaw', componentType: 'salad' });
    const main = makeRecipe({
      id: 'main-1',
      componentType: 'main',
      pairings: { sides: ['side-1', 'deleted'], salads: ['salad-1'] },
    });
    expect(pairingChips(main, [main, side, salad])).toEqual({ sides: ['Brambory'], salads: ['Coleslaw'] });
  });

  it('returns empty arrays for an unpaired main', () => {
    const main = makeRecipe({ id: 'main-1', componentType: 'main' });
    expect(pairingChips(main, [main])).toEqual({ sides: [], salads: [] });
  });
});

describe('toggleSlotSelection', () => {
  it('adds a slot not yet selected, ordered by SLOT_ORDER', () => {
    expect(toggleSlotSelection(['lunch'], 'breakfast')).toEqual(['breakfast', 'lunch']);
    expect(toggleSlotSelection(['breakfast'], 'snack')).toEqual(['breakfast', 'snack']);
  });

  it('removes a slot already selected', () => {
    expect(toggleSlotSelection(['lunch', 'dinner'], 'lunch')).toEqual(['dinner']);
  });

  it('may produce an empty selection (validation catches it at submit)', () => {
    expect(toggleSlotSelection(['lunch'], 'lunch')).toEqual([]);
  });
});

describe('unitOptions', () => {
  it('starts with the empty option and contains standard czech units', async () => {
    const { unitOptions, STANDARD_UNITS } = await import('./recipeFormLogic');
    const options = unitOptions('');
    expect(options[0]).toBe('');
    expect(options).toEqual(['', ...STANDARD_UNITS]);
    for (const u of ['g', 'kg', 'ml', 'l', 'ks', 'lžíce', 'lžička', 'špetka']) {
      expect(options).toContain(u);
    }
  });

  it('includes a legacy non-standard unit of the edited recipe so it is not lost', async () => {
    const { unitOptions } = await import('./recipeFormLogic');
    expect(unitOptions('hrst')).toEqual(expect.arrayContaining(['hrst', 'g', 'ks']));
    expect(unitOptions('hrst')[0]).toBe('');
  });

  it('does not duplicate a current unit that is already standard', async () => {
    const { unitOptions } = await import('./recipeFormLogic');
    const options = unitOptions('g');
    expect(options.filter((u) => u === 'g')).toHaveLength(1);
  });
});

describe('portions', () => {
  it('parsePortions: empty is undefined, whole numbers 1-10 accepted', async () => {
    const { parsePortions } = await import('./recipeFormLogic');
    expect(parsePortions('')).toBeUndefined();
    expect(parsePortions('4')).toBe(4);
    expect(parsePortions('1')).toBe(1);
    expect(parsePortions('10')).toBe(10);
  });

  it('parsePortions: zero, negative, decimal, text, and >10 are invalid', async () => {
    const { parsePortions } = await import('./recipeFormLogic');
    expect(parsePortions('0')).toBe('invalid');
    expect(parsePortions('-2')).toBe('invalid');
    expect(parsePortions('2,5')).toBe('invalid');
    expect(parsePortions('2.5')).toBe('invalid');
    expect(parsePortions('abc')).toBe('invalid');
    expect(parsePortions('11')).toBe('invalid');
  });

  it('PORTION_OPTIONS is 1 through 10', async () => {
    const { PORTION_OPTIONS } = await import('./recipeFormLogic');
    expect(PORTION_OPTIONS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('validateFullForm: invalid or missing portions produce a czech error', () => {
    const base = { name: 'Guláš', ingredients: [{ name: 'maso', amountStr: '500', unit: 'g' }] };
    const invalid = validateFullForm(emptyForm({ ...base, portionsStr: 'x' }));
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.errors.portions).toBeTruthy();
    const missing = validateFullForm(emptyForm({ ...base, portionsStr: '' }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.portions).toBeTruthy();
  });

  it('portions survive the draft -> recipe -> form round trip', () => {
    const values = emptyForm({
      name: 'Guláš',
      portionsStr: '4',
      ingredients: [{ name: 'maso', amountStr: '500', unit: 'g' }],
    });
    const result = validateFullForm(values);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const recipe = toRecipe(result.recipe, undefined, '2026-07-19T00:00:00Z', () => 'id1');
    expect(recipe.portions).toBe(4);
    expect(fromRecipe(recipe).portionsStr).toBe('4');
  });

  it('a legacy recipe without portions opens in the edit form with the default of 2', () => {
    const recipe: Recipe = makeRecipe({
      id: 'r1',
      name: 'Rizoto',
      category: 'jiné',
      effort: 'quick',
      ingredients: [],
      untried: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(fromRecipe(recipe).portionsStr).toBe('2');
  });
});

describe('formatPortions', () => {
  it('uses czech plural forms', async () => {
    const { formatPortions } = await import('./recipeFormLogic');
    expect(formatPortions(1)).toBe('1 porce');
    expect(formatPortions(4)).toBe('4 porce');
    expect(formatPortions(5)).toBe('5 porcí');
    expect(formatPortions(12)).toBe('12 porcí');
  });
});
