import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GithubConfig } from '../../api/github';
import type { IsoDay, Plans, Recipe, Settings, WeekPlan } from '../../types';
import type { Suggestion, Warning } from '../../engine/suggest';
import {
  czechWarnings,
  dayRows,
  getSuggestions,
  pickerEntries,
  quotaSummaryLine,
  suggestionView,
  weekChoices,
} from './planLogic';

const TARGET = '2026-W30';

function emptyDays(): Record<IsoDay, string | null> {
  return { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
}

function planWith(days: Partial<Record<IsoDay, string | null>>): WeekPlan {
  return { days: { ...emptyDays(), ...days } };
}

function recipe(overrides: Partial<Recipe> & { id: string; name: string }): Recipe {
  return {
    ingredients: [{ name: 'ingredience' }],
    category: 'jine',
    effort: 'normal',
    untried: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
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

function suggestion(overrides: Partial<Suggestion> & { recipe: Recipe }): Suggestion {
  return {
    matchedSaleIngredients: [],
    saleMatchCount: 0,
    weeksSinceCooked: Infinity,
    boostsUnmetMin: false,
    untried: false,
    ...overrides,
  };
}

describe('weekChoices', () => {
  it('returns Tento/Příští týden labels for the current/next ISO week of the injected date', () => {
    const now = new Date(Date.UTC(2026, 6, 20, 12, 0, 0)); // Monday 2026-07-20 -> 2026-W30
    expect(weekChoices(now)).toEqual([
      { key: '2026-W30', label: 'Tento týden' },
      { key: '2026-W31', label: 'Příští týden' },
    ]);
  });
});

describe('dayRows', () => {
  it('returns 7 empty rows for a week with no plan entry', () => {
    const rows = dayRows(TARGET, {}, []);
    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.day)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    expect(rows.map((r) => r.dayLabel)).toEqual(['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']);
    expect(rows.map((r) => r.date)).toEqual(['20.7.', '21.7.', '22.7.', '23.7.', '24.7.', '25.7.', '26.7.']);
    for (const row of rows) {
      expect(row.recipeId).toBeNull();
      expect(row.recipeName).toBeNull();
      expect(row.deleted).toBe(false);
    }
  });

  it('resolves the recipe name for an assigned day', () => {
    const r = recipe({ id: 'r1', name: 'Kuřecí na paprice' });
    const plans: Plans = { [TARGET]: planWith({ mon: 'r1' }) };
    const rows = dayRows(TARGET, plans, [r]);
    const mon = rows.find((row) => row.day === 'mon')!;
    expect(mon.recipeId).toBe('r1');
    expect(mon.recipeName).toBe('Kuřecí na paprice');
    expect(mon.deleted).toBe(false);
  });

  it('renders a "smazaný recept" row for a recipeId that no longer exists', () => {
    const plans: Plans = { [TARGET]: planWith({ tue: 'gone' }) };
    const rows = dayRows(TARGET, plans, []);
    const tue = rows.find((row) => row.day === 'tue')!;
    expect(tue.recipeId).toBe('gone');
    expect(tue.recipeName).toBe('smazaný recept');
    expect(tue.deleted).toBe(true);
  });
});

describe('czechWarnings', () => {
  it('formats a blocked warning', () => {
    const warnings: Warning[] = [{ kind: 'blocked', person: 'Petr', ingredients: ['houby', 'žampiony'] }];
    expect(czechWarnings(warnings)).toEqual(['Obsahuje blokované ingredience pro Petr: houby, žampiony']);
  });

  it('formats a maxExceeded warning', () => {
    const warnings: Warning[] = [{ kind: 'maxExceeded', category: 'maso' }];
    expect(czechWarnings(warnings)).toEqual(['Překročí týdenní limit pro kategorii maso']);
  });

  it('formats a rotation warning with singular "před 1 týdnem"', () => {
    const warnings: Warning[] = [{ kind: 'rotation', weeksSinceCooked: 1 }];
    expect(czechWarnings(warnings)).toEqual(['Vařeno před 1 týdnem']);
  });

  it('formats a rotation warning with plural "před N týdny"', () => {
    const warnings: Warning[] = [{ kind: 'rotation', weeksSinceCooked: 3 }];
    expect(czechWarnings(warnings)).toEqual(['Vařeno před 3 týdny']);
  });

  it('returns an empty array for no warnings', () => {
    expect(czechWarnings([])).toEqual([]);
  });
});

describe('suggestionView', () => {
  it('builds sale text, untried badge, and fresh text for a matched/untried/never-cooked suggestion', () => {
    const r = recipe({ id: 'r1', name: 'Kuřecí stehna' });
    const s = suggestion({ recipe: r, matchedSaleIngredients: ['kuřecí'], untried: true, weeksSinceCooked: Infinity });
    expect(suggestionView(s)).toEqual({
      id: 'r1',
      name: 'Kuřecí stehna',
      untriedBadge: true,
      saleText: 'Ve slevě: kuřecí',
      freshText: 'Nevařeno',
    });
  });

  it('renders no sale text when nothing matched', () => {
    const r = recipe({ id: 'r1', name: 'Cokoliv' });
    const s = suggestion({ recipe: r, matchedSaleIngredients: [], weeksSinceCooked: 3 });
    const view = suggestionView(s);
    expect(view.saleText).toBeNull();
    expect(view.freshText).toBe('Před 3 týdny');
  });

  it('uses singular "před 1 týdnem" freshText', () => {
    const r = recipe({ id: 'r1', name: 'Cokoliv' });
    const s = suggestion({ recipe: r, weeksSinceCooked: 1 });
    expect(suggestionView(s).freshText).toBe('Před 1 týdnem');
  });

  it('untriedBadge is false when the recipe is not untried', () => {
    const r = recipe({ id: 'r1', name: 'Cokoliv' });
    const s = suggestion({ recipe: r, untried: false });
    expect(suggestionView(s).untriedBadge).toBe(false);
  });
});

describe('pickerEntries', () => {
  it('marks a recipe with no ingredients as not plannable', () => {
    const r = recipe({ id: 'r1', name: 'Bez ingredienci', ingredients: [] });
    const entries = pickerEntries({ recipes: [r], plans: {}, sales: [], settings: settings(), targetWeek: TARGET });
    expect(entries).toHaveLength(1);
    expect(entries[0].plannable).toBe(false);
    expect(entries[0].warnings).toEqual([]);
  });

  it('marks a plannable recipe with no warnings as selectable and warning-free', () => {
    const r = recipe({ id: 'r1', name: 'Normální recept' });
    const entries = pickerEntries({ recipes: [r], plans: {}, sales: [], settings: settings(), targetWeek: TARGET });
    expect(entries[0].plannable).toBe(true);
    expect(entries[0].warnings).toEqual([]);
  });

  it('passes through Czech warnings for a blocked ingredient but keeps the recipe selectable', () => {
    const r = recipe({ id: 'r1', name: 'Houbovy rizek', ingredients: [{ name: 'houby' }] });
    const s = settings({ persons: [{ name: 'Petr', blocked: ['houby'] }, { name: 'Jana', blocked: [] }] });
    const entries = pickerEntries({ recipes: [r], plans: {}, sales: [], settings: s, targetWeek: TARGET });
    expect(entries[0].plannable).toBe(true);
    expect(entries[0].warnings).toEqual(['Obsahuje blokované ingredience pro Petr: houby']);
  });

  it('sorts entries by Czech-locale recipe name', () => {
    const a = recipe({ id: 'a', name: 'Žampiónové rizoto' });
    const b = recipe({ id: 'b', name: 'Boloňské špagety' });
    const entries = pickerEntries({ recipes: [a, b], plans: {}, sales: [], settings: settings(), targetWeek: TARGET });
    expect(entries.map((e) => e.recipe.id)).toEqual(['b', 'a']);
  });
});

describe('getSuggestions', () => {
  it('wraps rankSuggestions verbatim', () => {
    const r = recipe({ id: 'r1', name: 'Cokoliv' });
    const input = { recipes: [r], plans: {}, sales: [], settings: settings(), targetWeek: TARGET };
    expect(getSuggestions(input)).toEqual([
      suggestion({ recipe: r, weeksSinceCooked: Infinity }),
    ]);
  });
});

describe('quotaSummaryLine', () => {
  it('returns null when there are no diet rules', () => {
    expect(quotaSummaryLine([], [])).toBeNull();
  });

  it('formats a max rule as count/max', () => {
    expect(quotaSummaryLine([{ category: 'maso', max: 2 }], ['maso', 'maso'])).toBe('maso 2/2');
  });

  it('formats a min rule as count/min and joins multiple rules', () => {
    expect(
      quotaSummaryLine(
        [
          { category: 'maso', max: 2 },
          { category: 'ryba', min: 1 },
        ],
        ['maso', 'maso'],
      ),
    ).toBe('maso 2/2 · ryba 0/1');
  });
});

// ---------------------------------------------------------------------------
// Integration: real useDataStore + mocked src/api/github (AC4 end-to-end at
// the logic level: assign two maso dinners, verify a third maso recipe is
// excluded from suggestions once "max 2x maso" is hit).
// ---------------------------------------------------------------------------

vi.mock('../../api/github', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/github')>();
  return {
    ...actual,
    probeRepo: vi.fn(),
    getFile: vi.fn(),
    putFile: vi.fn(),
    saveWithRetry: vi.fn(),
  };
});

const { probeRepo, getFile, saveWithRetry } = await import('../../api/github');
const { useDataStore } = await import('../../store/data');

const probeRepoMock = vi.mocked(probeRepo);
const getFileMock = vi.mocked(getFile);
const saveWithRetryMock = vi.mocked(saveWithRetry);

const cfg: GithubConfig = { owner: 'ts6482', repo: 'munchplan-data', token: 'pat-123' };

function makeLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => (store.has(key) ? (store.get(key) as string) : null)),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
  };
}

describe('store integration: assignDay + suggestion recompute (AC4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDataStore.setState(useDataStore.getInitialState(), true);
    vi.stubGlobal('localStorage', makeLocalStorageMock());

    probeRepoMock.mockResolvedValue(undefined);
    getFileMock.mockResolvedValue(null); // first run: everything 404s
    saveWithRetryMock.mockImplementation(async (_cfg, _path, op, apply, base, emptyData) => ({
      data: apply(op, base ? base.data : emptyData),
      sha: 'fake-sha',
    }));
  });

  it('assignDay persists into files.plans.data, and a maxed-out category excludes further suggestions', async () => {
    await useDataStore.getState().loadAll(cfg);

    const r1 = recipe({ id: 'r1', name: 'Kuřecí steak', category: 'maso' });
    const r2 = recipe({ id: 'r2', name: 'Vepřová panenka', category: 'maso' });
    const r3 = recipe({ id: 'r3', name: 'Hovězí guláš', category: 'maso' });
    await useDataStore.getState().addRecipe(r1);
    await useDataStore.getState().addRecipe(r2);
    await useDataStore.getState().addRecipe(r3);
    await useDataStore.getState().upsertDietRule('maso', undefined, 2);

    await useDataStore.getState().assignDay(TARGET, 'mon', 'r1');
    expect(useDataStore.getState().files.plans.data[TARGET].days.mon).toBe('r1');

    await useDataStore.getState().assignDay(TARGET, 'tue', 'r2');
    expect(useDataStore.getState().files.plans.data[TARGET].days.tue).toBe('r2');

    const state = useDataStore.getState();
    const result = getSuggestions({
      recipes: state.files.recipes.data,
      plans: state.files.plans.data,
      sales: state.files.sales.data,
      settings: state.files.settings.data,
      targetWeek: TARGET,
    });

    // r1/r2 excluded because already assigned to the target week; r3 excluded
    // because "max 2x maso" is already met by r1+r2.
    expect(result.map((s) => s.recipe.id)).not.toContain('r3');
    expect(result).toEqual([]);
  });
});
