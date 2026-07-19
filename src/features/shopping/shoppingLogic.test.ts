import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GithubConfig } from '../../api/github';
import { itemKey } from '../../engine/match';
import type { ShoppingItem } from '../../engine/shoppingList';
import type { Extras, IsoDay, Plans, Recipe, WeekPlan } from '../../types';
import { itemAmountText, newExtraItem, shoppingView, toggleHomeTarget, validateExtraName, weekExtrasFor } from './shoppingLogic';

function emptyDays(): Record<IsoDay, string | null> {
  return { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
}

function planWith(days: Partial<Record<IsoDay, string | null>>): WeekPlan {
  return { days: { ...emptyDays(), ...days } };
}

function recipe(overrides: Partial<Recipe> & { id: string; name: string }): Recipe {
  return {
    ingredients: [],
    category: 'jine',
    effort: 'normal',
    untried: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function shoppingItem(overrides: Partial<ShoppingItem> = {}): ShoppingItem {
  return {
    key: 'sul|',
    label: 'sůl',
    onSale: false,
    checked: false,
    fromRecipes: ['Recept A'],
    ...overrides,
  };
}

describe('weekExtrasFor', () => {
  it('returns an empty WeekExtras for a week not present in the file (nothing leaks across weeks)', () => {
    const extras: Extras = { weeks: {} };
    expect(weekExtrasFor(extras, '2026-W30')).toEqual({ checks: {}, extraItems: [], homeOverrides: {} });
  });

  it('returns the stored WeekExtras verbatim for a week that exists', () => {
    const extras: Extras = { weeks: { '2026-W30': { checks: { 'sul|': true }, extraItems: [], homeOverrides: {} } } };
    expect(weekExtrasFor(extras, '2026-W30')).toEqual({ checks: { 'sul|': true }, extraItems: [], homeOverrides: {} });
  });
});

describe('shoppingView', () => {
  it('produces independent results for two different weeks (AC8 week-scoping fixture)', () => {
    const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'mouka', amount: 200, unit: 'g' }] });
    const b = recipe({ id: 'b', name: 'Recept B', ingredients: [{ name: 'cukr', amount: 100, unit: 'g' }] });
    const plans: Plans = {
      '2026-W30': planWith({ mon: 'a' }),
      '2026-W31': planWith({ mon: 'b' }),
    };
    const extras: Extras = {
      weeks: { '2026-W30': { checks: { 'mouka|g': true }, extraItems: [], homeOverrides: {} } },
    };

    const view30 = shoppingView({ recipes: [a, b], plans, pantry: [], sales: [], extras, week: '2026-W30' });
    const view31 = shoppingView({ recipes: [a, b], plans, pantry: [], sales: [], extras, week: '2026-W31' });

    expect(view30.buy).toHaveLength(1);
    expect(view30.buy[0]).toMatchObject({ label: 'mouka', checked: true });
    expect(view31.buy).toHaveLength(1);
    expect(view31.buy[0]).toMatchObject({ label: 'cukr', checked: false });
  });

  it('rebuilding after a plan edit keeps checks of unchanged items (reuse of engine behavior)', () => {
    const a = recipe({ id: 'a', name: 'Recept A', ingredients: [{ name: 'mouka', amount: 200, unit: 'g' }] });
    const b = recipe({ id: 'b', name: 'Recept B', ingredients: [{ name: 'cukr', amount: 100, unit: 'g' }] });
    const extras: Extras = {
      weeks: { '2026-W30': { checks: { 'mouka|g': true }, extraItems: [], homeOverrides: {} } },
    };

    const before = shoppingView({
      recipes: [a, b],
      plans: { '2026-W30': planWith({ mon: 'a' }) },
      pantry: [],
      sales: [],
      extras,
      week: '2026-W30',
    });
    const after = shoppingView({
      recipes: [a, b],
      plans: { '2026-W30': planWith({ mon: 'a', tue: 'b' }) },
      pantry: [],
      sales: [],
      extras,
      week: '2026-W30',
    });

    expect(before.buy.find((i) => i.key === 'mouka|g')?.checked).toBe(true);
    expect(after.buy.find((i) => i.key === 'mouka|g')?.checked).toBe(true);
    expect(after.buy.some((i) => i.key === 'cukr|g')).toBe(true);
  });
});

describe('itemAmountText', () => {
  it('formats amount + unit', () => {
    expect(itemAmountText(shoppingItem({ amount: 500, unit: 'g' }))).toBe('500 g');
  });

  it('formats comma decimals', () => {
    expect(itemAmountText(shoppingItem({ amount: 0.5, unit: 'kg' }))).toBe('0,5 kg');
  });

  it('formats an amount with no unit (trims the trailing space)', () => {
    expect(itemAmountText(shoppingItem({ amount: 3, unit: undefined }))).toBe('3');
  });

  it('returns "dle receptu" when the amount is undefined', () => {
    expect(itemAmountText(shoppingItem({ amount: undefined, unit: undefined }))).toBe('dle receptu');
  });
});

describe('validateExtraName', () => {
  it('rejects an empty/whitespace name with a Czech error', () => {
    expect(validateExtraName('   ')).toEqual({ ok: false, error: 'Vyplňte název položky' });
  });

  it('accepts a non-empty name', () => {
    expect(validateExtraName('Toaletní papír')).toEqual({ ok: true });
  });
});

describe('newExtraItem', () => {
  it('builds an ExtraItem via the injected id function, unchecked', () => {
    expect(newExtraItem('Toaletní papír', () => 'id-1')).toEqual({ id: 'id-1', name: 'Toaletní papír', checked: false });
  });

  it('trims the name', () => {
    expect(newExtraItem('  Chleba  ', () => 'id-2').name).toBe('Chleba');
  });
});

describe('toggleHomeTarget', () => {
  it('buy -> home with no prior override sets "toHome"', () => {
    expect(toggleHomeTarget({}, 'sul|', 'toHome')).toBe('toHome');
  });

  it('buy -> home when a "toBuy" override already forced it to buy clears the override (reverts to natural pantry match)', () => {
    expect(toggleHomeTarget({ 'sul|': 'toBuy' }, 'sul|', 'toHome')).toBeNull();
  });

  it('home -> buy with no prior override sets "toBuy"', () => {
    expect(toggleHomeTarget({}, 'sul|', 'toBuy')).toBe('toBuy');
  });

  it('home -> buy when a "toHome" override already forced it home clears the override (reverts to natural not-in-pantry state)', () => {
    expect(toggleHomeTarget({ 'sul|': 'toHome' }, 'sul|', 'toBuy')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration: real useDataStore + mocked src/api/github (mirrors
// planLogic.test.ts's mock setup) — round-trips a recipe + plan + check
// through the store, verifies per-week scoping, and simulates a reload by
// re-running loadAll against a "remote" that now holds the persisted extras.
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

describe('store integration: per-week checks persist and scope correctly (AC8)', () => {
  let remote: Map<string, { data: unknown; sha: string }>;
  let shaCounter: number;

  beforeEach(() => {
    vi.clearAllMocks();
    useDataStore.setState(useDataStore.getInitialState(), true);
    vi.stubGlobal('localStorage', makeLocalStorageMock());

    remote = new Map();
    shaCounter = 0;

    probeRepoMock.mockResolvedValue(undefined);
    getFileMock.mockImplementation(async (_cfg, path) => remote.get(path) ?? null);
    saveWithRetryMock.mockImplementation(async (_cfg, path, op, apply, base, emptyData) => {
      const current = remote.get(path);
      const baseData = base ? base.data : (current ? current.data : emptyData);
      const data = apply(op, baseData);
      const sha = `sha-${++shaCounter}`;
      remote.set(path, { data, sha });
      return { data, sha };
    });
  });

  it('checked state is scoped per plan week and survives a simulated app reload', async () => {
    await useDataStore.getState().loadAll(cfg);

    const flour: Recipe = recipe({ id: 'r1', name: 'Chlebíčky', ingredients: [{ name: 'mouka', amount: 200, unit: 'g' }] });
    await useDataStore.getState().addRecipe(flour);
    await useDataStore.getState().assignDay('2026-W30', 'mon', 'r1');
    await useDataStore.getState().assignDay('2026-W31', 'mon', 'r1');

    const key = itemKey('mouka', 'g');
    await useDataStore.getState().setCheck('2026-W30', key, true);

    let state = useDataStore.getState();
    const view30 = shoppingView({
      recipes: state.files.recipes.data,
      plans: state.files.plans.data,
      pantry: state.files.pantry.data,
      sales: state.files.sales.data,
      extras: state.files.extras.data,
      week: '2026-W30',
    });
    const view31 = shoppingView({
      recipes: state.files.recipes.data,
      plans: state.files.plans.data,
      pantry: state.files.pantry.data,
      sales: state.files.sales.data,
      extras: state.files.extras.data,
      week: '2026-W31',
    });
    expect(view30.buy[0].checked).toBe(true);
    expect(view31.buy[0].checked).toBe(false);

    // Reload simulation: fresh store, fetch from the same "remote" (which now
    // holds the persisted recipes/plans/extras) restores the W30 check.
    useDataStore.setState(useDataStore.getInitialState(), true);
    await useDataStore.getState().loadAll(cfg);
    state = useDataStore.getState();
    const reloaded = shoppingView({
      recipes: state.files.recipes.data,
      plans: state.files.plans.data,
      pantry: state.files.pantry.data,
      sales: state.files.sales.data,
      extras: state.files.extras.data,
      week: '2026-W30',
    });
    expect(reloaded.buy[0].checked).toBe(true);
  });
});
