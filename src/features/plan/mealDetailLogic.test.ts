import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GithubConfig } from '../../api/github';
import type { MealEntry, Plans, Settings, WeekPlan } from '../../types';
import { makeRecipe, weekPlanWith } from '../../testing/fixtures';
import { emptyWeekPlan } from '../../engine/planModel';
import {
  mealHeader,
  entryRows,
  newManualEntry,
  newPlannedEntry,
  swapSide,
  addSalad,
  unpairedMainHint,
  rerollSlot,
} from './mealDetailLogic';

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
  const base = emptyWeekPlan();
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
    const plan = emptyWeekPlan();
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
      components: [{ id: 'r1', name: 'Guláš', deleted: false, roleLabel: null, removal: { kind: 'entry' } }],
      untriedBadge: false,
      portionsText: null,
      source: 'manual',
    });
    expect(rows[1]).toEqual({
      entryId: 'e2',
      displayName: 'Rizoto',
      recipeLinks: [{ id: 'r2', name: 'Rizoto', deleted: false }],
      components: [{ id: 'r2', name: 'Rizoto', deleted: false, roleLabel: null, removal: { kind: 'entry' } }],
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

// ---------------------------------------------------------------------------
// entryRows: component classification rule (feature 004 step 7)
// ---------------------------------------------------------------------------

describe('entryRows components (classification rule)', () => {
  it('labels a composed [main, side] entry: main -> "hlavní jídlo", side -> "příloha"', () => {
    const main = makeRecipe({ id: 'm1', name: 'Kuře', componentType: 'main', pairings: { sides: ['s1'], salads: [] } });
    const side = makeRecipe({ id: 's1', name: 'Rýže', componentType: 'side' });
    const plan = planWithEntries([
      { day: 'wed', slot: 'dinner', entries: [{ id: 'e1', recipeIds: ['m1', 's1'], source: 'manual' }] },
    ]);
    const row = entryRows(plan, 'wed', 'dinner', [main, side])[0];
    expect(row.components).toEqual([
      { id: 'm1', name: 'Kuře', deleted: false, roleLabel: 'hlavní jídlo', removal: { kind: 'entry' } },
      { id: 's1', name: 'Rýže', deleted: false, roleLabel: 'příloha', removal: { kind: 'component', nextRecipeIds: ['m1'] } },
    ]);
  });

  it('a deleted non-primary component is opaque: deleted fallback name, no role label, escape-hatch removal', () => {
    const main = makeRecipe({ id: 'm1', name: 'Kuře', componentType: 'main', pairings: { sides: ['gone'], salads: [] } });
    const plan = planWithEntries([
      { day: 'wed', slot: 'dinner', entries: [{ id: 'e1', recipeIds: ['m1', 'gone'], source: 'manual' }] },
    ]);
    const row = entryRows(plan, 'wed', 'dinner', [main])[0];
    expect(row.components[1]).toEqual({
      id: 'gone',
      name: 'smazaný recept',
      deleted: true,
      roleLabel: null,
      removal: { kind: 'component', nextRecipeIds: ['m1'] },
    });
  });

  it('a re-typed non-primary component is opaque: real name kept, no role label', () => {
    const main = makeRecipe({ id: 'm1', name: 'Kuře', componentType: 'main', pairings: { sides: [], salads: [] } });
    const retyped = makeRecipe({ id: 'r1', name: 'Rýže', componentType: 'full' }); // was side, now re-typed
    const plan = planWithEntries([
      { day: 'wed', slot: 'dinner', entries: [{ id: 'e1', recipeIds: ['m1', 'r1'], source: 'manual' }] },
    ]);
    const row = entryRows(plan, 'wed', 'dinner', [main, retyped])[0];
    expect(row.components[1]).toEqual({
      id: 'r1',
      name: 'Rýže',
      deleted: false,
      roleLabel: null,
      removal: { kind: 'component', nextRecipeIds: ['m1'] },
    });
  });

  it('a deleted primary shows the fallback, no role label, and removal is still entry-kind', () => {
    const plan = planWithEntries([
      { day: 'wed', slot: 'dinner', entries: [{ id: 'e1', recipeIds: ['gone'], source: 'manual' }] },
    ]);
    const row = entryRows(plan, 'wed', 'dinner', [])[0];
    expect(row.components).toEqual([
      { id: 'gone', name: 'smazaný recept', deleted: true, roleLabel: null, removal: { kind: 'entry' } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// swapSide (feature 004 step 7)
// ---------------------------------------------------------------------------

describe('swapSide', () => {
  it('returns [] when the primary is not a main', () => {
    const full = makeRecipe({ id: 'f1', componentType: 'full' });
    const entry: MealEntry = { id: 'e1', recipeIds: ['f1'], source: 'manual' };
    expect(swapSide(entry, [full], settings())).toEqual([]);
  });

  it('returns [] when the main has no paired sides', () => {
    const main = makeRecipe({ id: 'm1', componentType: 'main', pairings: { sides: [], salads: [] } });
    const entry: MealEntry = { id: 'e1', recipeIds: ['m1'], source: 'manual' };
    expect(swapSide(entry, [main], settings())).toEqual([]);
  });

  it('lists paired sides, marks the current one, flags a blocked one, and replaces it in nextRecipeIds', () => {
    const main = makeRecipe({ id: 'm1', componentType: 'main', pairings: { sides: ['s1', 's2'], salads: [] } });
    const s1 = makeRecipe({ id: 's1', name: 'Rýže', componentType: 'side', ingredients: [{ name: 'rýže' }] });
    const s2 = makeRecipe({ id: 's2', name: 'Houbová omáčka', componentType: 'side', ingredients: [{ name: 'houby' }] });
    const blockedSettings = settings({ persons: [{ name: 'Petr', blocked: ['houby'] }, { name: 'Jana', blocked: [] }] });
    const entry: MealEntry = { id: 'e1', recipeIds: ['m1', 's1'], source: 'manual' };

    expect(swapSide(entry, [main, s1, s2], blockedSettings)).toEqual([
      { id: 's1', name: 'Rýže', current: true, blocked: false, nextRecipeIds: ['m1', 's1'] },
      { id: 's2', name: 'Houbová omáčka', current: false, blocked: true, nextRecipeIds: ['m1', 's2'] },
    ]);
  });

  it('marks no option current when the current side component is stale (opaque)', () => {
    const main = makeRecipe({ id: 'm1', componentType: 'main', pairings: { sides: ['s1'], salads: [] } });
    const s1 = makeRecipe({ id: 's1', name: 'Rýže', componentType: 'side' });
    // 'stale' occupies the accompaniment slot but no longer resolves to 'side'.
    const entry: MealEntry = { id: 'e1', recipeIds: ['m1', 'stale'], source: 'manual' };

    const options = swapSide(entry, [main, s1], settings());
    expect(options).toEqual([{ id: 's1', name: 'Rýže', current: false, blocked: false, nextRecipeIds: ['m1', 's1'] }]);
  });

  it('replaces the FIRST side component when two side components exist', () => {
    const main = makeRecipe({ id: 'm1', componentType: 'main', pairings: { sides: ['s1', 's2'], salads: [] } });
    const s1 = makeRecipe({ id: 's1', name: 'Rýže', componentType: 'side' });
    const s2 = makeRecipe({ id: 's2', name: 'Brambory', componentType: 'side' });
    const entry: MealEntry = { id: 'e1', recipeIds: ['m1', 's1', 's2'], source: 'manual' };

    const options = swapSide(entry, [main, s1, s2], settings());
    expect(options.find((o) => o.id === 's2')?.nextRecipeIds).toEqual(['m1', 's2', 's2']);
  });

  it('appends when the entry has no side/opaque component to replace', () => {
    const main = makeRecipe({ id: 'm1', componentType: 'main', pairings: { sides: ['s1'], salads: [] } });
    const s1 = makeRecipe({ id: 's1', name: 'Rýže', componentType: 'side' });
    const entry: MealEntry = { id: 'e1', recipeIds: ['m1'], source: 'manual' };

    const options = swapSide(entry, [main, s1], settings());
    expect(options).toEqual([{ id: 's1', name: 'Rýže', current: false, blocked: false, nextRecipeIds: ['m1', 's1'] }]);
  });
});

// ---------------------------------------------------------------------------
// addSalad (feature 004 step 7)
// ---------------------------------------------------------------------------

describe('addSalad', () => {
  it('returns [] when the primary is not a main', () => {
    const full = makeRecipe({ id: 'f1', componentType: 'full' });
    const entry: MealEntry = { id: 'e1', recipeIds: ['f1'], source: 'manual' };
    expect(addSalad(entry, [full])).toEqual([]);
  });

  it('returns [] when the main has no paired salads', () => {
    const main = makeRecipe({ id: 'm1', componentType: 'main', pairings: { sides: [], salads: [] } });
    const entry: MealEntry = { id: 'e1', recipeIds: ['m1'], source: 'manual' };
    expect(addSalad(entry, [main])).toEqual([]);
  });

  it('returns [] when a salad-classified component is already present', () => {
    const main = makeRecipe({ id: 'm1', componentType: 'main', pairings: { sides: [], salads: ['sal1'] } });
    const sal1 = makeRecipe({ id: 'sal1', name: 'Salát', componentType: 'salad' });
    const entry: MealEntry = { id: 'e1', recipeIds: ['m1', 'sal1'], source: 'manual' };
    expect(addSalad(entry, [main, sal1])).toEqual([]);
  });

  it('lists paired salads as one-tap options that append', () => {
    const main = makeRecipe({ id: 'm1', componentType: 'main', pairings: { sides: [], salads: ['sal1'] } });
    const sal1 = makeRecipe({ id: 'sal1', name: 'Salát', componentType: 'salad' });
    const entry: MealEntry = { id: 'e1', recipeIds: ['m1'], source: 'manual' };
    expect(addSalad(entry, [main, sal1])).toEqual([{ id: 'sal1', name: 'Salát', nextRecipeIds: ['m1', 'sal1'] }]);
  });
});

// ---------------------------------------------------------------------------
// unpairedMainHint (feature 004 step 7)
// ---------------------------------------------------------------------------

describe('unpairedMainHint', () => {
  it('returns null when the primary is not a main', () => {
    const full = makeRecipe({ id: 'f1', componentType: 'full' });
    const entry: MealEntry = { id: 'e1', recipeIds: ['f1'], source: 'manual' };
    expect(unpairedMainHint(entry, [full], settings())).toBeNull();
  });

  it('returns null when the main has >=1 valid paired side', () => {
    const main = makeRecipe({ id: 'm1', componentType: 'main', pairings: { sides: ['s1'], salads: [] } });
    const s1 = makeRecipe({ id: 's1', componentType: 'side' });
    const entry: MealEntry = { id: 'e1', recipeIds: ['m1'], source: 'manual' };
    expect(unpairedMainHint(entry, [main, s1], settings())).toBeNull();
  });

  it('returns the hint text and edit link when the main has zero valid paired sides', () => {
    const main = makeRecipe({ id: 'm1', componentType: 'main', pairings: { sides: [], salads: [] } });
    const entry: MealEntry = { id: 'e1', recipeIds: ['m1'], source: 'manual' };
    expect(unpairedMainHint(entry, [main], settings())).toEqual({
      text: 'Recept nemá přiřazené přílohy',
      editHref: '#/recepty/m1',
    });
  });

  it('returns null for a deleted primary', () => {
    const entry: MealEntry = { id: 'e1', recipeIds: ['gone'], source: 'manual' };
    expect(unpairedMainHint(entry, [], settings())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// newPlannedEntry (feature 004 step 7)
// ---------------------------------------------------------------------------

describe('newPlannedEntry', () => {
  it('places a full recipe bare, making zero rng calls', () => {
    const full = makeRecipe({ id: 'f1', componentType: 'full' });
    const rng = vi.fn(() => 0);
    const entry = newPlannedEntry('f1', [full], [], settings(), rng, () => 'new-1');
    expect(entry).toEqual({ id: 'new-1', recipeIds: ['f1'], source: 'manual' });
    expect(rng).not.toHaveBeenCalled();
  });

  it('composes a paired main into [main, side]', () => {
    const main = makeRecipe({ id: 'm1', componentType: 'main', pairings: { sides: ['s1'], salads: [] } });
    const s1 = makeRecipe({ id: 's1', componentType: 'side' });
    const entry = newPlannedEntry('m1', [main, s1], [], settings(), () => 0, () => 'new-1');
    expect(entry).toEqual({ id: 'new-1', recipeIds: ['m1', 's1'], source: 'manual' });
  });

  it('places an unpaired main bare', () => {
    const main = makeRecipe({ id: 'm1', componentType: 'main', pairings: { sides: [], salads: [] } });
    const entry = newPlannedEntry('m1', [main], [], settings(), () => 0, () => 'new-1');
    expect(entry).toEqual({ id: 'new-1', recipeIds: ['m1'], source: 'manual' });
  });

  it('places an unknown recipeId bare (defensive)', () => {
    const entry = newPlannedEntry('ghost', [], [], settings(), () => 0, () => 'new-1');
    expect(entry).toEqual({ id: 'new-1', recipeIds: ['ghost'], source: 'manual' });
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
      { recipes: [recipe], plans, sales: [], settings: settings(), week: WEEK },
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
      { recipes: [recipe], plans, sales: [], settings: settings(), week: WEEK },
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
