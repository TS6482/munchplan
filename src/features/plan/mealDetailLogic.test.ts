import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GithubConfig } from '../../api/github';
import type { MealEntry, Plans, Settings, WeekPlan } from '../../types';
import { makeRecipe, weekPlanWith } from '../../testing/fixtures';
import { emptyWeekPlan } from '../../engine/planModel';
import { mealHeader, entryRows, newManualEntry, rerollSlot } from './mealDetailLogic';

const WEEK = '2026-W30';

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

/** Builds a WeekPlan with the given entries placed directly into (day, slot) — supports multi-recipe entries, unlike the fixtures' single-recipeId helpers. */
function planWithEntries(entries: { day: keyof WeekPlan['days']; slot: keyof WeekPlan['days']['mon']; entries: MealEntry[] }[]): WeekPlan {
  const activeSlots = [...new Set(entries.map((e) => e.slot))];
  const base = emptyWeekPlan(activeSlots.length > 0 ? activeSlots : ['dinner']);
  const days = { ...base.days };
  for (const e of entries) {
    days[e.day] = { ...days[e.day], [e.slot]: e.entries };
  }
  return { ...base, days };
}

describe('mealHeader', () => {
  it('builds Czech day/date/slot header with a week-scoped back link', () => {
    expect(mealHeader(WEEK, 'wed', 'dinner')).toEqual({
      dayLabel: 'St',
      dateText: '22.7.',
      slotLabel: 'večeře',
      backHash: '#/plan/2026-W30',
    });
  });

  it('reflects the requested slot label', () => {
    expect(mealHeader(WEEK, 'mon', 'breakfast').slotLabel).toBe('snídaně');
  });
});

describe('entryRows', () => {
  it('returns [] for a missing week', () => {
    expect(entryRows(undefined, 'wed', 'dinner', [])).toEqual([]);
  });

  it('returns [] for an empty slot on a stored week', () => {
    const plan = emptyWeekPlan(['dinner']);
    expect(entryRows(plan, 'wed', 'dinner', [])).toEqual([]);
  });

  it('renders two rows for two entries in the same slot', () => {
    const r1 = makeRecipe({ id: 'r1', name: 'Guláš' });
    const r2 = makeRecipe({ id: 'r2', name: 'Rizoto' });
    const plan = planWithEntries([
      {
        day: 'wed',
        slot: 'dinner',
        entries: [
          { id: 'e1', recipeIds: ['r1'], source: 'manual' },
          { id: 'e2', recipeIds: ['r2'], source: 'auto' },
        ],
      },
    ]);

    const rows = entryRows(plan, 'wed', 'dinner', [r1, r2]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      entryId: 'e1',
      displayName: 'Guláš',
      recipeLinks: [{ id: 'r1', name: 'Guláš', deleted: false }],
      untriedBadge: false,
      portionsText: null,
      source: 'manual',
    });
    expect(rows[1]).toEqual({
      entryId: 'e2',
      displayName: 'Rizoto',
      recipeLinks: [{ id: 'r2', name: 'Rizoto', deleted: false }],
      untriedBadge: false,
      portionsText: null,
      source: 'auto',
    });
  });

  it('falls back to "smazaný recept" for a deleted recipeId', () => {
    const plan = planWithEntries([
      { day: 'wed', slot: 'dinner', entries: [{ id: 'e1', recipeIds: ['gone'], source: 'manual' }] },
    ]);
    const rows = entryRows(plan, 'wed', 'dinner', []);
    expect(rows[0].displayName).toBe('smazaný recept');
    expect(rows[0].recipeLinks).toEqual([{ id: 'gone', name: 'smazaný recept', deleted: true }]);
  });

  it('joins multi-recipe entry names with " + " and keeps per-recipe links', () => {
    const main = makeRecipe({ id: 'r1', name: 'Kuře', untried: true });
    const side = makeRecipe({ id: 'r2', name: 'Brambory' });
    const plan = planWithEntries([
      { day: 'wed', slot: 'dinner', entries: [{ id: 'e1', recipeIds: ['r1', 'r2'], source: 'manual' }] },
    ]);
    const rows = entryRows(plan, 'wed', 'dinner', [main, side]);
    expect(rows[0].displayName).toBe('Kuře + Brambory');
    expect(rows[0].recipeLinks).toEqual([
      { id: 'r1', name: 'Kuře', deleted: false },
      { id: 'r2', name: 'Brambory', deleted: false },
    ]);
    expect(rows[0].untriedBadge).toBe(true);
    expect(rows[0].portionsText).toBeNull();
  });

  it('sets portionsText for a single-recipe entry with portions set', () => {
    const r = makeRecipe({ id: 'r1', name: 'Guláš', portions: 4 });
    const plan = planWithEntries([
      { day: 'wed', slot: 'dinner', entries: [{ id: 'e1', recipeIds: ['r1'], source: 'manual' }] },
    ]);
    expect(entryRows(plan, 'wed', 'dinner', [r])[0].portionsText).toBe('4 porce');
  });

  it('leaves portionsText null when the recipe has no portions set', () => {
    const r = makeRecipe({ id: 'r1', name: 'Guláš' });
    const plan = planWithEntries([
      { day: 'wed', slot: 'dinner', entries: [{ id: 'e1', recipeIds: ['r1'], source: 'manual' }] },
    ]);
    expect(entryRows(plan, 'wed', 'dinner', [r])[0].portionsText).toBeNull();
  });

  it('sets untriedBadge true when any recipe in the entry is untried', () => {
    const r = makeRecipe({ id: 'r1', name: 'Guláš', untried: true });
    const plan = planWithEntries([
      { day: 'wed', slot: 'dinner', entries: [{ id: 'e1', recipeIds: ['r1'], source: 'manual' }] },
    ]);
    expect(entryRows(plan, 'wed', 'dinner', [r])[0].untriedBadge).toBe(true);
  });
});

describe('newManualEntry', () => {
  it('builds a manual single-recipe entry using the injected id function', () => {
    expect(newManualEntry('r5', () => 'new-1')).toEqual({ id: 'new-1', recipeIds: ['r5'], source: 'manual' });
  });
});

describe('rerollSlot', () => {
  const recipe = makeRecipe({ id: 'r1', name: 'A' });

  it('rerolls a slot holding an auto entry into a new placement', () => {
    const plans: Plans = {
      [WEEK]: weekPlanWith([{ day: 'wed', slot: 'dinner', recipeId: 'r1', source: 'auto', id: 'auto-1' }]),
    };
    const result = rerollSlot(
      { recipes: [recipe], plans, sales: [], settings: settings(), week: WEEK, activeSlots: ['dinner'] },
      'wed',
      'dinner',
      () => 0,
      () => 'new-id',
    );
    expect(result).toEqual({
      hasTargets: true,
      placements: [{ day: 'wed', slot: 'dinner', entries: [{ id: 'new-id', recipeIds: ['r1'], source: 'auto' }] }],
    });
  });

  it('is a no-op for a slot holding only manual entries (hasTargets false)', () => {
    const plans: Plans = {
      [WEEK]: weekPlanWith([{ day: 'wed', slot: 'dinner', recipeId: 'r1', source: 'manual' }]),
    };
    const result = rerollSlot(
      { recipes: [recipe], plans, sales: [], settings: settings(), week: WEEK, activeSlots: ['dinner'] },
      'wed',
      'dinner',
      () => 0,
      () => 'new-id',
    );
    expect(result).toEqual({ hasTargets: false, placements: [] });
  });
});

// ---------------------------------------------------------------------------
// Integration: real useDataStore + mocked src/api/github — addMealEntry and
// removeMealEntry round-trip through mutate('plans', ...), mirroring
// planLogic.test.ts's integration-test pattern.
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

describe('store integration: addMealEntry/removeMealEntry round-trip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDataStore.setState(useDataStore.getInitialState(), true);
    vi.stubGlobal('localStorage', makeLocalStorageMock());

    probeRepoMock.mockResolvedValue(undefined);
    getFileMock.mockResolvedValue(null);
    saveWithRetryMock.mockImplementation(async (_cfg, _path, op, apply, base, emptyData) => ({
      data: apply(op, base ? base.data : emptyData),
      sha: 'fake-sha',
    }));
  });

  it('adds then removes a meal entry through mutate("plans", ...)', async () => {
    await useDataStore.getState().loadAll(cfg);

    await useDataStore.getState().addMealEntry(WEEK, 'wed', 'lunch', { id: 'e1', recipeIds: ['r1'], source: 'manual' });
    expect(useDataStore.getState().files.plans.data[WEEK].days.wed.lunch).toEqual([
      { id: 'e1', recipeIds: ['r1'], source: 'manual' },
    ]);

    await useDataStore.getState().removeMealEntry(WEEK, 'wed', 'lunch', 'e1');
    expect(useDataStore.getState().files.plans.data[WEEK].days.wed.lunch).toEqual([]);
  });
});
