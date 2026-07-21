import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GithubConfig } from '../api/github';
import type { Pantry, Plans } from '../types';
import { makeRecipe } from '../testing/fixtures';
import { DEFAULT_PANTRY } from './seed';
import { addMealEntry, normalizePlans, upsertRecipe } from './ops';

vi.mock('../api/github', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/github')>();
  return {
    ...actual,
    probeRepo: vi.fn(),
    getFile: vi.fn(),
    putFile: vi.fn(),
    saveWithRetry: vi.fn(),
  };
});

const { probeRepo, getFile, saveWithRetry, AuthError, ConflictError, NetworkError } = await import('../api/github');
const { useDataStore } = await import('./data');

const probeRepoMock = vi.mocked(probeRepo);
const getFileMock = vi.mocked(getFile);
const saveWithRetryMock = vi.mocked(saveWithRetry);

const cfg: GithubConfig = { owner: 'ts6482', repo: 'munchplan-data', token: 'pat-123' };

function makeLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => (store.has(key) ? (store.get(key) as string) : null)),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => store.clear()),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useDataStore.setState(useDataStore.getInitialState(), true);
  vi.stubGlobal('localStorage', makeLocalStorageMock());
});

describe('loadAll', () => {
  it('unconfigured guard: loadAll(null) fires no fetches', async () => {
    await useDataStore.getState().loadAll(null);
    expect(probeRepoMock).not.toHaveBeenCalled();
    expect(getFileMock).not.toHaveBeenCalled();
    expect(useDataStore.getState().status).toBe('idle');
  });

  it('happy path populates all six files with data + sha', async () => {
    probeRepoMock.mockResolvedValue(undefined);
    getFileMock.mockImplementation(async (_cfg, path: string) => {
      const shas: Record<string, { data: unknown; sha: string }> = {
        'recipes.json': { data: [makeRecipe()], sha: 'r-sha' },
        'plans.json': { data: { '2026-W30': { days: { mon: null, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } } }, sha: 'p-sha' },
        'pantry.json': { data: [{ name: 'sůl' }], sha: 'pa-sha' },
        'sales.json': { data: [{ name: 'kuřecí' }], sha: 's-sha' },
        'settings.json': { data: { persons: [{ name: 'A', blocked: [] }, { name: 'B', blocked: [] }], dietRules: [], rotationWeeks: 2 }, sha: 'se-sha' },
        'extras.json': { data: { weeks: {} }, sha: 'e-sha' },
      };
      return shas[path];
    });

    await useDataStore.getState().loadAll(cfg);

    expect(probeRepoMock).toHaveBeenCalledWith(cfg);
    expect(getFileMock).toHaveBeenCalledTimes(6);
    const state = useDataStore.getState();
    expect(state.status).toBe('ready');
    expect(state.files.recipes).toEqual({ data: [makeRecipe()], sha: 'r-sha' });
    expect(state.files.pantry).toEqual({ data: [{ name: 'sůl' }], sha: 'pa-sha' });
    expect(state.files.sales).toEqual({ data: [{ name: 'kuřecí' }], sha: 's-sha' });
    expect(state.files.extras).toEqual({ data: { weeks: {} }, sha: 'e-sha' });
    expect(saveWithRetryMock).not.toHaveBeenCalled();
  });

  it('migrates legacy string[] pantry data (from getFile) into PantryItem[] on load', async () => {
    probeRepoMock.mockResolvedValue(undefined);
    getFileMock.mockImplementation(async (_cfg, path: string) => {
      if (path === 'pantry.json') return { data: ['sůl', 'mouka'], sha: 'pa-sha-legacy' };
      return null;
    });

    await useDataStore.getState().loadAll(cfg);

    expect(useDataStore.getState().files.pantry).toEqual({
      data: [{ name: 'sůl' }, { name: 'mouka' }],
      sha: 'pa-sha-legacy',
    });
  });

  it('migrates legacy recipes.json (missing suitableFor/componentType/pairings) into the new shape on load, and writes the cache normalized', async () => {
    const legacyRecipe = {
      id: 'r1',
      name: 'Stará polévka',
      ingredients: [{ name: 'zelenina' }],
      category: 'polévka',
      effort: 'quick',
      untried: false,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    probeRepoMock.mockResolvedValue(undefined);
    getFileMock.mockImplementation(async (_cfg, path: string) => {
      if (path === 'recipes.json') return { data: [legacyRecipe], sha: 'r-sha-legacy' };
      return null;
    });

    await useDataStore.getState().loadAll(cfg);

    const state = useDataStore.getState();
    expect(state.files.recipes.data).toEqual([
      { ...legacyRecipe, suitableFor: ['lunch', 'dinner'], componentType: 'full', pairings: { sides: [], salads: [] } },
    ]);
    expect(state.files.recipes.sha).toBe('r-sha-legacy');

    const cached = JSON.parse(
      (localStorage as unknown as { getItem: (k: string) => string }).getItem('munchplan.cache.recipes.json'),
    );
    expect(cached[0].suitableFor).toEqual(['lunch', 'dinner']);
    expect(cached[0].componentType).toBe('full');
    expect(cached[0].pairings).toEqual({ sides: [], salads: [] });
  });

  it('authError path: probeRepo AuthError stops before any file fetch, no seeding', async () => {
    probeRepoMock.mockRejectedValue(new AuthError());

    await useDataStore.getState().loadAll(cfg);

    expect(useDataStore.getState().status).toBe('authError');
    expect(getFileMock).not.toHaveBeenCalled();
    expect(saveWithRetryMock).not.toHaveBeenCalled();
  });

  it('first-run seeding: pantry.json 404 seeds DEFAULT_PANTRY and writes it via saveWithRetry', async () => {
    probeRepoMock.mockResolvedValue(undefined);
    getFileMock.mockResolvedValue(null);
    saveWithRetryMock.mockResolvedValue({ data: DEFAULT_PANTRY, sha: 'seed-sha' });

    await useDataStore.getState().loadAll(cfg);

    const state = useDataStore.getState();
    expect(state.status).toBe('ready');
    expect(state.files.pantry).toEqual({ data: DEFAULT_PANTRY, sha: 'seed-sha' });
    // Other 404'd files fall back to empty defaults, unseeded.
    expect(state.files.recipes).toEqual({ data: [], sha: undefined });
    expect(state.files.sales).toEqual({ data: [], sha: undefined });

    expect(saveWithRetryMock).toHaveBeenCalledTimes(1);
    const [savedCfg, savedPath, , , savedBase, savedEmptyData] = saveWithRetryMock.mock.calls[0];
    expect(savedCfg).toBe(cfg);
    expect(savedPath).toBe('pantry.json');
    expect(savedBase).toBeNull();
    expect(savedEmptyData).toEqual([]);
  });

  it('does not seed pantry when pantry.json exists but is an empty array (deliberate clearing respected)', async () => {
    probeRepoMock.mockResolvedValue(undefined);
    getFileMock.mockImplementation(async (_cfg, path: string) => {
      if (path === 'pantry.json') return { data: [], sha: 'pa-sha-empty' };
      return null;
    });

    await useDataStore.getState().loadAll(cfg);

    expect(useDataStore.getState().files.pantry).toEqual({ data: [], sha: 'pa-sha-empty' });
    expect(saveWithRetryMock).not.toHaveBeenCalled();
  });

  it('seed 422-race: conflict resolves via the provided apply function without duplicating items', async () => {
    probeRepoMock.mockResolvedValue(undefined);
    getFileMock.mockResolvedValue(null);

    saveWithRetryMock.mockImplementation(async (_cfg, _path, op, apply) => {
      // Simulates saveWithRetry's real behavior: first PUT hit 422 because another
      // device's seed landed first; remote already holds the same staples; apply(op, remote)
      // re-applies setPantry (idempotent full-replace) on top of it.
      const remoteAfterRace = [...DEFAULT_PANTRY];
      const merged = (apply as (op: unknown, remote: Pantry) => Pantry)(op, remoteAfterRace);
      return { data: merged, sha: 'seed-sha-after-race' };
    });

    await useDataStore.getState().loadAll(cfg);

    const pantry = useDataStore.getState().files.pantry;
    expect(pantry.data).toEqual(DEFAULT_PANTRY);
    expect(new Set((pantry.data as Pantry).map((i) => i.name)).size).toBe(pantry.data.length);
    expect(pantry.sha).toBe('seed-sha-after-race');
  });

  it('NetworkError during load hydrates from localStorage cache and sets offline true (migrates legacy pantry cache)', async () => {
    probeRepoMock.mockResolvedValue(undefined);
    getFileMock.mockRejectedValue(new NetworkError());

    vi.stubGlobal(
      'localStorage',
      makeLocalStorageMock({
        'munchplan.cache.recipes.json': JSON.stringify([makeRecipe()]),
        'munchplan.cache.plans.json': JSON.stringify({}),
        'munchplan.cache.pantry.json': JSON.stringify(['sůl']),
        'munchplan.cache.sales.json': JSON.stringify([{ name: 'kuřecí' }]),
        'munchplan.cache.settings.json': JSON.stringify({
          persons: [{ name: 'A', blocked: [] }, { name: 'B', blocked: [] }],
          dietRules: [],
          rotationWeeks: 2,
        }),
        'munchplan.cache.extras.json': JSON.stringify({ weeks: {} }),
      }),
    );

    await useDataStore.getState().loadAll(cfg);

    const state = useDataStore.getState();
    expect(state.status).toBe('ready');
    expect(state.offline).toBe(true);
    expect(state.files.recipes.data).toEqual([makeRecipe()]);
    expect(state.files.pantry.data).toEqual([{ name: 'sůl' }]);
    expect(saveWithRetryMock).not.toHaveBeenCalled();
  });

  it('NetworkError during load hydrates a legacy-shape cached recipes.json snapshot into the new shape', async () => {
    const legacyRecipe = {
      id: 'r1',
      name: 'Stará polévka',
      ingredients: [{ name: 'zelenina' }],
      category: 'polévka',
      effort: 'quick',
      untried: false,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    probeRepoMock.mockResolvedValue(undefined);
    getFileMock.mockRejectedValue(new NetworkError());

    vi.stubGlobal(
      'localStorage',
      makeLocalStorageMock({
        'munchplan.cache.recipes.json': JSON.stringify([legacyRecipe]),
      }),
    );

    await useDataStore.getState().loadAll(cfg);

    const state = useDataStore.getState();
    expect(state.status).toBe('ready');
    expect(state.offline).toBe(true);
    expect(state.files.recipes.data).toEqual([
      { ...legacyRecipe, suitableFor: ['lunch', 'dinner'], componentType: 'full', pairings: { sides: [], salads: [] } },
    ]);
  });

  it('NetworkError during load with no cache sets status error', async () => {
    probeRepoMock.mockResolvedValue(undefined);
    getFileMock.mockRejectedValue(new NetworkError());
    // localStorage mock stubbed in beforeEach is empty.

    await useDataStore.getState().loadAll(cfg);

    expect(useDataStore.getState().status).toBe('error');
  });

  it('seed-write AuthError (pantry 404, saveWithRetry rejects with AuthError) sets status authError', async () => {
    probeRepoMock.mockResolvedValue(undefined);
    getFileMock.mockResolvedValue(null);
    saveWithRetryMock.mockRejectedValue(new AuthError('token expired'));

    await useDataStore.getState().loadAll(cfg);

    expect(useDataStore.getState().status).toBe('authError');
  });
});

describe('plans.json migration hardening (step 4)', () => {
  const oldShapePlans = {
    '2026-W30': {
      days: { mon: 'r1', tue: null, wed: 'r2', thu: null, fri: 'r3', sat: null, sun: null },
    },
  };

  it('full old-shape plans.json through loadAll -> state is new-shape: non-null days become vecere entries with legacy ids, activeSlots [dinner], nothing lost (AC1)', async () => {
    probeRepoMock.mockResolvedValue(undefined);
    getFileMock.mockImplementation(async (_cfg, path: string) => {
      if (path === 'plans.json') return { data: oldShapePlans, sha: 'p-sha-legacy' };
      return null;
    });

    await useDataStore.getState().loadAll(cfg);

    const state = useDataStore.getState();
    const week = (state.files.plans.data as Plans)['2026-W30'];
    expect(week.activeSlots).toEqual(['dinner']);
    expect(week.days.mon.dinner).toEqual([{ id: 'legacy-2026-W30-mon', recipeIds: ['r1'], source: 'manual' }]);
    expect(week.days.wed.dinner).toEqual([{ id: 'legacy-2026-W30-wed', recipeIds: ['r2'], source: 'manual' }]);
    expect(week.days.fri.dinner).toEqual([{ id: 'legacy-2026-W30-fri', recipeIds: ['r3'], source: 'manual' }]);
    // Empty legacy days: nothing lost, nothing invented.
    expect(week.days.tue.dinner).toEqual([]);
    expect(week.days.thu.dinner).toEqual([]);
    expect(week.days.sat.dinner).toEqual([]);
    expect(week.days.sun.dinner).toEqual([]);
    // Other slots present and empty (nothing lost, nothing extra).
    expect(week.days.mon.breakfast).toEqual([]);
    expect(week.days.mon.lunch).toEqual([]);
    expect(week.days.mon.snack).toEqual([]);
    expect(state.files.plans.sha).toBe('p-sha-legacy');
  });

  it('after loading an old-shape plans.json, the NEXT plan mutation persists the new shape (no string day values in the resulting body)', async () => {
    probeRepoMock.mockResolvedValue(undefined);
    getFileMock.mockImplementation(async (_cfg, path: string) => {
      if (path === 'plans.json') return { data: oldShapePlans, sha: 'p-sha-legacy' };
      return null;
    });
    await useDataStore.getState().loadAll(cfg);

    // Generic stand-in mirroring saveWithRetry's real no-conflict path
    // (`apply(op, base.data)`) — this is the actual PUT-body contract.
    saveWithRetryMock.mockImplementation(async (_apiCfg, _path, op, apply, base, emptyData) => ({
      data: (apply as (o: unknown, remote: unknown) => unknown)(op, base?.data ?? emptyData),
      sha: 'p-sha-next',
    }));

    const newEntry = { id: 'e-new', recipeIds: ['r-new'], source: 'manual' as const };
    await useDataStore.getState().addMealEntry('2026-W30', 'tue', 'lunch', newEntry);

    const body = useDataStore.getState().files.plans.data as Plans;
    // The migrated legacy entries survive the round trip...
    expect(body['2026-W30'].days.mon.dinner).toEqual([
      { id: 'legacy-2026-W30-mon', recipeIds: ['r1'], source: 'manual' },
    ]);
    expect(body['2026-W30'].days.tue.lunch).toEqual([newEntry]);
    // ...and every day value in the body is a new-shape object, never a raw legacy string.
    for (const day of Object.values(body['2026-W30'].days)) {
      expect(typeof day).toBe('object');
      expect(Array.isArray((day as { dinner: unknown }).dinner)).toBe(true);
    }
  });

  it('writes the plans.json cache normalized after loading an old-shape file', async () => {
    probeRepoMock.mockResolvedValue(undefined);
    getFileMock.mockImplementation(async (_cfg, path: string) => {
      if (path === 'plans.json') return { data: oldShapePlans, sha: 'p-sha-legacy' };
      return null;
    });

    await useDataStore.getState().loadAll(cfg);

    const cached = JSON.parse(
      (localStorage as unknown as { getItem: (k: string) => string }).getItem('munchplan.cache.plans.json'),
    ) as Plans;
    expect(cached['2026-W30'].activeSlots).toEqual(['dinner']);
    expect(cached['2026-W30'].days.mon.dinner).toEqual([
      { id: 'legacy-2026-W30-mon', recipeIds: ['r1'], source: 'manual' },
    ]);
    expect(typeof cached['2026-W30'].days.mon).toBe('object');
  });

  it('NetworkError during load hydrates an old-shape cached plans.json snapshot into the new shape (cache-path half of AC1)', async () => {
    probeRepoMock.mockResolvedValue(undefined);
    getFileMock.mockRejectedValue(new NetworkError());

    vi.stubGlobal(
      'localStorage',
      makeLocalStorageMock({
        'munchplan.cache.plans.json': JSON.stringify(oldShapePlans),
      }),
    );

    await useDataStore.getState().loadAll(cfg);

    const state = useDataStore.getState();
    expect(state.status).toBe('ready');
    expect(state.offline).toBe(true);
    const week = (state.files.plans.data as Plans)['2026-W30'];
    expect(week.activeSlots).toEqual(['dinner']);
    expect(week.days.mon.dinner).toEqual([{ id: 'legacy-2026-W30-mon', recipeIds: ['r1'], source: 'manual' }]);
    expect(week.days.wed.dinner).toEqual([{ id: 'legacy-2026-W30-wed', recipeIds: ['r2'], source: 'manual' }]);
  });

  it('conflict retry: refetched remote is old-shape -> merged write is new-shape and the local op survives', async () => {
    useDataStore.setState({
      cfg,
      files: { ...useDataStore.getState().files, plans: { data: {}, sha: 'p-sha-1' } },
    });

    saveWithRetryMock.mockImplementation(async (_apiCfg, _path, op, apply) => ({
      // Simulates saveWithRetry's real conflict path: first PUT 409s, refetch
      // returns an old-shape remote (a not-yet-updated device's write),
      // apply() re-derives the local intent on top of it (normalizing internally).
      data: (apply as (o: unknown, remote: unknown) => unknown)(op, oldShapePlans),
      sha: 'p-sha-after-conflict',
    }));

    const newEntry = { id: 'e-new', recipeIds: ['r-new'], source: 'manual' as const };
    await useDataStore.getState().mutate('plans', addMealEntry('2026-W30', 'wed', 'lunch', newEntry));

    const state = useDataStore.getState().files.plans.data as Plans;
    // Local op's effect survives...
    expect(state['2026-W30'].days.wed.lunch).toEqual([newEntry]);
    // ...alongside the old-shape remote's data, fully migrated (new shape).
    expect(state['2026-W30'].days.mon.dinner).toEqual([
      { id: 'legacy-2026-W30-mon', recipeIds: ['r1'], source: 'manual' },
    ]);
    expect(state['2026-W30'].days.fri.dinner).toEqual([
      { id: 'legacy-2026-W30-fri', recipeIds: ['r3'], source: 'manual' },
    ]);
    expect(typeof state['2026-W30'].days.mon).toBe('object');
  });

  it('two-device double migration: device A loads+saves the old-shape file, device B (stale old-shape base) conflicts and re-applies -- no duplicated meals, both effects present', async () => {
    // --- Device A: loads the old-shape file, then saves a meal edit. ---
    useDataStore.setState({
      cfg,
      files: { ...useDataStore.getState().files, plans: { data: normalizePlans(oldShapePlans), sha: 'p-sha-remote-1' } },
    });
    const aEntry = { id: 'e-a', recipeIds: ['r-a'], source: 'manual' as const };
    saveWithRetryMock.mockImplementationOnce(async (_apiCfg, _path, op, apply, base) => ({
      data: (apply as (o: unknown, remote: unknown) => unknown)(op, base?.data),
      sha: 'p-sha-after-a',
    }));
    await useDataStore.getState().addMealEntry('2026-W30', 'tue', 'lunch', aEntry);
    const remoteAfterA = useDataStore.getState().files.plans.data as Plans;

    // --- Device B: separately, still holds the STALE raw old-shape file as its local base. ---
    useDataStore.setState({
      cfg,
      files: { ...useDataStore.getState().files, plans: { data: oldShapePlans as unknown as Plans, sha: 'p-sha-stale' } },
    });
    const bEntry = { id: 'e-b', recipeIds: ['r-b'], source: 'manual' as const };
    saveWithRetryMock.mockImplementationOnce(async (_apiCfg, _path, op, apply) => ({
      // Simulates: B's first PUT 409s against the stale sha; refetch returns
      // A's already-normalized remote; apply() re-derives B's op on top of it.
      data: (apply as (o: unknown, remote: unknown) => unknown)(op, remoteAfterA),
      sha: 'p-sha-after-b',
    }));
    await useDataStore.getState().addMealEntry('2026-W30', 'fri', 'lunch', bEntry);

    const final = useDataStore.getState().files.plans.data as Plans;
    // No duplication of the migrated legacy entries (deterministic ids).
    expect(final['2026-W30'].days.mon.dinner).toEqual([
      { id: 'legacy-2026-W30-mon', recipeIds: ['r1'], source: 'manual' },
    ]);
    expect(final['2026-W30'].days.wed.dinner).toEqual([
      { id: 'legacy-2026-W30-wed', recipeIds: ['r2'], source: 'manual' },
    ]);
    // Both devices' effects present.
    expect(final['2026-W30'].days.tue.lunch).toEqual([aEntry]);
    expect(final['2026-W30'].days.fri.lunch).toEqual([bEntry]);
  });
});

describe('mutate', () => {
  function seedRecipesFile(): void {
    useDataStore.setState({
      cfg,
      files: {
        ...useDataStore.getState().files,
        recipes: { data: [], sha: 'r-sha-1' },
      },
    });
  }

  it('happy path: optimistic apply, saveWithRetry called for recipes.json only, state adopts result', async () => {
    seedRecipesFile();
    const recipe = makeRecipe();
    saveWithRetryMock.mockResolvedValue({ data: [recipe], sha: 'r-sha-2' });

    await useDataStore.getState().mutate('recipes', upsertRecipe(recipe));

    const state = useDataStore.getState();
    expect(state.files.recipes).toEqual({ data: [recipe], sha: 'r-sha-2' });
    expect(saveWithRetryMock).toHaveBeenCalledTimes(1);
    const [savedCfg, savedPath, , , savedBase] = saveWithRetryMock.mock.calls[0];
    expect(savedCfg).toBe(cfg);
    expect(savedPath).toBe('recipes.json');
    expect(savedBase).toEqual({ data: [], sha: 'r-sha-1' });
    // Per-file independence: no other file's state changed.
    expect(state.files.pantry).toEqual({ data: [], sha: undefined });
  });

  it('conflict-retry success: final state matches the MERGED remote-based result saveWithRetry returns, not the local optimistic guess', async () => {
    seedRecipesFile();
    const localRecipe = makeRecipe({ name: 'Local edit' });
    const mergedResult = [makeRecipe({ id: 'other', name: 'Concurrently added on remote' }), localRecipe];
    saveWithRetryMock.mockResolvedValue({ data: mergedResult, sha: 'r-sha-merged' });

    await useDataStore.getState().mutate('recipes', upsertRecipe(localRecipe));

    expect(useDataStore.getState().files.recipes).toEqual({ data: mergedResult, sha: 'r-sha-merged' });
  });

  it('double-conflict: ConflictError rolls back to the pre-op snapshot and sets saveError to "conflict"', async () => {
    seedRecipesFile();
    const before = useDataStore.getState().files.recipes;
    saveWithRetryMock.mockRejectedValue(new ConflictError('still conflicting'));

    await useDataStore.getState().mutate('recipes', upsertRecipe(makeRecipe()));

    const state = useDataStore.getState();
    expect(state.files.recipes).toEqual(before);
    expect(state.saveError).toBe('conflict');
  });

  it('NetworkError rolls back and sets saveError to "network"', async () => {
    seedRecipesFile();
    const before = useDataStore.getState().files.recipes;
    saveWithRetryMock.mockRejectedValue(new NetworkError('offline'));

    await useDataStore.getState().mutate('recipes', upsertRecipe(makeRecipe()));

    const state = useDataStore.getState();
    expect(state.files.recipes).toEqual(before);
    expect(state.saveError).toBe('network');
  });

  it('an unrecognized error rolls back and sets saveError to "unknown"', async () => {
    seedRecipesFile();
    const before = useDataStore.getState().files.recipes;
    saveWithRetryMock.mockRejectedValue(new Error('boom'));

    await useDataStore.getState().mutate('recipes', upsertRecipe(makeRecipe()));

    const state = useDataStore.getState();
    expect(state.files.recipes).toEqual(before);
    expect(state.saveError).toBe('unknown');
  });

  it('AuthError rolls back and sets status authError', async () => {
    seedRecipesFile();
    const before = useDataStore.getState().files.recipes;
    saveWithRetryMock.mockRejectedValue(new AuthError('token expired'));

    await useDataStore.getState().mutate('recipes', upsertRecipe(makeRecipe()));

    const state = useDataStore.getState();
    expect(state.files.recipes).toEqual(before);
    expect(state.status).toBe('authError');
  });

  it('mutate without a configured cfg is a no-op (no fetches)', async () => {
    await useDataStore.getState().mutate('recipes', upsertRecipe(makeRecipe()));
    expect(saveWithRetryMock).not.toHaveBeenCalled();
  });

  it('serializes two rapid mutations to the same file: the second save reads the first save\'s resulting sha/data', async () => {
    useDataStore.setState({
      cfg,
      files: { ...useDataStore.getState().files, extras: { data: { weeks: {} }, sha: 'e-sha-1' } },
    });

    let resolveFirst!: (value: { data: unknown; sha: string }) => void;
    const firstSave = new Promise<{ data: unknown; sha: string }>((resolve) => {
      resolveFirst = resolve;
    });
    let resolveSecond!: (value: { data: unknown; sha: string }) => void;
    const secondSave = new Promise<{ data: unknown; sha: string }>((resolve) => {
      resolveSecond = resolve;
    });
    saveWithRetryMock.mockImplementationOnce(() => firstSave);
    saveWithRetryMock.mockImplementationOnce(() => secondSave);

    const afterFirstSave = {
      weeks: { '2026-W30': { checks: { 'mouka|g': true }, extraItems: [], homeOverrides: {} } },
    };
    const afterSecondSave = {
      weeks: { '2026-W30': { checks: { 'mouka|g': true, 'cukr|g': true }, extraItems: [], homeOverrides: {} } },
    };

    const p1 = useDataStore.getState().setCheck('2026-W30', 'mouka|g', true);
    const p2 = useDataStore.getState().setCheck('2026-W30', 'cukr|g', true);

    // Let both mutate() calls enqueue before the first save resolves.
    await Promise.resolve();
    await Promise.resolve();

    resolveFirst({ data: afterFirstSave, sha: 'e-sha-2' });
    await p1;

    // The second save must have been invoked with a base derived from the
    // FIRST save's result (fresh sha/data), proving it waited its turn.
    expect(saveWithRetryMock).toHaveBeenCalledTimes(2);
    const secondCallBase = saveWithRetryMock.mock.calls[1][4];
    expect(secondCallBase).toEqual({ data: afterFirstSave, sha: 'e-sha-2' });

    resolveSecond({ data: afterSecondSave, sha: 'e-sha-3' });
    await p2;

    expect(useDataStore.getState().files.extras.data).toEqual(afterSecondSave);
  });
});

describe('convenience actions', () => {
  it('addRecipe wraps mutate("recipes", upsertRecipe(...))', async () => {
    useDataStore.setState({ cfg, files: { ...useDataStore.getState().files, recipes: { data: [], sha: 'r-sha' } } });
    const recipe = makeRecipe();
    saveWithRetryMock.mockResolvedValue({ data: [recipe], sha: 'r-sha-2' });

    await useDataStore.getState().addRecipe(recipe);

    expect(useDataStore.getState().files.recipes.data).toEqual([recipe]);
    const [, savedPath] = saveWithRetryMock.mock.calls[0];
    expect(savedPath).toBe('recipes.json');
  });

  it('activateSlot wraps mutate("plans", ops.activateSlot(...))', async () => {
    useDataStore.setState({ cfg, files: { ...useDataStore.getState().files, plans: { data: {}, sha: 'p-sha' } } });
    saveWithRetryMock.mockResolvedValue({ data: {}, sha: 'p-sha-2' });

    await useDataStore.getState().activateSlot('2026-W30', 'breakfast');

    const [, savedPath, savedOp] = saveWithRetryMock.mock.calls[0];
    expect(savedPath).toBe('plans.json');
    expect(savedOp).toEqual({ type: 'activateSlot', week: '2026-W30', slot: 'breakfast' });
  });

  it('deactivateSlot wraps mutate("plans", ops.deactivateSlot(...))', async () => {
    useDataStore.setState({ cfg, files: { ...useDataStore.getState().files, plans: { data: {}, sha: 'p-sha' } } });
    saveWithRetryMock.mockResolvedValue({ data: {}, sha: 'p-sha-2' });

    await useDataStore.getState().deactivateSlot('2026-W30', 'dinner');

    const [, savedPath, savedOp] = saveWithRetryMock.mock.calls[0];
    expect(savedPath).toBe('plans.json');
    expect(savedOp).toEqual({ type: 'deactivateSlot', week: '2026-W30', slot: 'dinner' });
  });

  it('addMealEntry wraps mutate("plans", ops.addMealEntry(...))', async () => {
    useDataStore.setState({ cfg, files: { ...useDataStore.getState().files, plans: { data: {}, sha: 'p-sha' } } });
    const entry = { id: 'e1', recipeIds: ['r1'], source: 'manual' as const };
    saveWithRetryMock.mockResolvedValue({ data: {}, sha: 'p-sha-2' });

    await useDataStore.getState().addMealEntry('2026-W30', 'mon', 'dinner', entry);

    const [, savedPath, savedOp] = saveWithRetryMock.mock.calls[0];
    expect(savedPath).toBe('plans.json');
    expect(savedOp).toEqual({ type: 'addMealEntry', week: '2026-W30', day: 'mon', slot: 'dinner', entry });
  });

  it('removeMealEntry wraps mutate("plans", ops.removeMealEntry(...))', async () => {
    useDataStore.setState({ cfg, files: { ...useDataStore.getState().files, plans: { data: {}, sha: 'p-sha' } } });
    saveWithRetryMock.mockResolvedValue({ data: {}, sha: 'p-sha-2' });

    await useDataStore.getState().removeMealEntry('2026-W30', 'mon', 'dinner', 'e1');

    const [, savedPath, savedOp] = saveWithRetryMock.mock.calls[0];
    expect(savedPath).toBe('plans.json');
    expect(savedOp).toEqual({ type: 'removeMealEntry', week: '2026-W30', day: 'mon', slot: 'dinner', entryId: 'e1' });
  });

  it('replaceAutoEntries wraps mutate("plans", ops.replaceAutoEntries(...))', async () => {
    useDataStore.setState({ cfg, files: { ...useDataStore.getState().files, plans: { data: {}, sha: 'p-sha' } } });
    const placements = [{ day: 'mon' as const, slot: 'dinner' as const, entries: [] }];
    saveWithRetryMock.mockResolvedValue({ data: {}, sha: 'p-sha-2' });

    await useDataStore.getState().replaceAutoEntries('2026-W30', placements);

    const [, savedPath, savedOp] = saveWithRetryMock.mock.calls[0];
    expect(savedPath).toBe('plans.json');
    expect(savedOp).toEqual({ type: 'replaceAutoEntries', week: '2026-W30', placements });
  });

  it('setCheck wraps mutate("extras", setCheck(...))', async () => {
    useDataStore.setState({ cfg, files: { ...useDataStore.getState().files, extras: { data: { weeks: {} }, sha: 'e-sha' } } });
    const checkedExtras = { weeks: { '2026-W30': { checks: { 'mouka|g': true as const }, extraItems: [], homeOverrides: {} } } };
    saveWithRetryMock.mockResolvedValue({ data: checkedExtras, sha: 'e-sha-2' });

    await useDataStore.getState().setCheck('2026-W30', 'mouka|g', true);

    expect(useDataStore.getState().files.extras.data).toEqual(checkedExtras);
    const [, savedPath] = saveWithRetryMock.mock.calls[0];
    expect(savedPath).toBe('extras.json');
  });
});

describe('reset', () => {
  it('restores files/cfg/status/offline/saveError to their initial values', () => {
    useDataStore.setState({
      cfg,
      status: 'ready',
      offline: true,
      saveError: 'network',
      files: { ...useDataStore.getState().files, recipes: { data: [makeRecipe()], sha: 'r-sha' } },
    });

    useDataStore.getState().reset();

    const state = useDataStore.getState();
    const initial = useDataStore.getInitialState();
    expect(state.files).toEqual(initial.files);
    expect(state.cfg).toBeNull();
    expect(state.status).toBe('idle');
    expect(state.offline).toBe(false);
    expect(state.saveError).toBeNull();
  });
});
