import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GithubConfig } from '../api/github';
import type { Recipe } from '../types';
import { DEFAULT_PANTRY } from './seed';
import { upsertRecipe } from './ops';

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

function makeRecipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: 'r1',
    name: 'Kuřecí stehna',
    ingredients: [{ name: 'kuřecí stehna', amount: 500, unit: 'g' }],
    category: 'maso',
    effort: 'normal',
    untried: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

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
        'pantry.json': { data: ['sůl'], sha: 'pa-sha' },
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
    expect(state.files.pantry).toEqual({ data: ['sůl'], sha: 'pa-sha' });
    expect(state.files.sales).toEqual({ data: [{ name: 'kuřecí' }], sha: 's-sha' });
    expect(state.files.extras).toEqual({ data: { weeks: {} }, sha: 'e-sha' });
    expect(saveWithRetryMock).not.toHaveBeenCalled();
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
      const merged = (apply as (op: unknown, remote: string[]) => string[])(op, remoteAfterRace);
      return { data: merged, sha: 'seed-sha-after-race' };
    });

    await useDataStore.getState().loadAll(cfg);

    const pantry = useDataStore.getState().files.pantry;
    expect(pantry.data).toEqual(DEFAULT_PANTRY);
    expect(new Set(pantry.data).size).toBe(pantry.data.length);
    expect(pantry.sha).toBe('seed-sha-after-race');
  });

  it('NetworkError during load hydrates from localStorage cache and sets offline true', async () => {
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
    expect(state.files.pantry.data).toEqual(['sůl']);
    expect(saveWithRetryMock).not.toHaveBeenCalled();
  });

  it('NetworkError during load with no cache sets status error', async () => {
    probeRepoMock.mockResolvedValue(undefined);
    getFileMock.mockRejectedValue(new NetworkError());
    // localStorage mock stubbed in beforeEach is empty.

    await useDataStore.getState().loadAll(cfg);

    expect(useDataStore.getState().status).toBe('error');
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

  it('double-conflict: ConflictError rolls back to the pre-op snapshot and sets saveError', async () => {
    seedRecipesFile();
    const before = useDataStore.getState().files.recipes;
    saveWithRetryMock.mockRejectedValue(new ConflictError('still conflicting'));

    await useDataStore.getState().mutate('recipes', upsertRecipe(makeRecipe()));

    const state = useDataStore.getState();
    expect(state.files.recipes).toEqual(before);
    expect(state.saveError).toBeTruthy();
  });

  it('NetworkError rolls back and sets saveError', async () => {
    seedRecipesFile();
    const before = useDataStore.getState().files.recipes;
    saveWithRetryMock.mockRejectedValue(new NetworkError('offline'));

    await useDataStore.getState().mutate('recipes', upsertRecipe(makeRecipe()));

    const state = useDataStore.getState();
    expect(state.files.recipes).toEqual(before);
    expect(state.saveError).toBeTruthy();
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
