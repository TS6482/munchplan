/**
 * Per-file data store: session-configured GitHub data files, loaded through
 * `probeRepo`/`getFile`, mutated through operation-based `saveWithRetry`
 * calls (see `src/store/ops.ts` for the merge contract), with a localStorage
 * offline read-cache.
 *
 * Design decisions:
 * - `FILES` is a small internal registry (path + apply function + empty
 *   value) keyed by `FileKey`; it is intentionally loosely typed
 *   (`unknown`-erased) at the registry boundary so `loadAll`/`mutate` can
 *   loop over all six files generically. Type safety is restored at the
 *   public API boundary: `mutate<K extends FileKey>` still only accepts the
 *   op type that matches the file it targets.
 * - `cfg` is stored in state (set by `loadAll`) so `mutate` doesn't need it
 *   re-passed on every call.
 * - Pantry seeding only happens when `pantry.json` is literally missing
 *   (404 → `getFile` returns `null`), never when it exists but is empty —
 *   a deliberate "clear the pantry" edit must not be resurrected.
 * - The seed write goes through the *same* `saveWithRetry` + `applyPantryOp`
 *   path as any other mutation; `setPantry` fully replaces the array, so a
 *   conflict-retry race against another device's seed is naturally
 *   idempotent (no duplicates), without any special-case code here.
 * - Offline cache is a read fallback only (per plan.md): it hydrates
 *   `loadAll` when fetches fail, but `mutate` still fails visibly offline
 *   (no write queue).
 */

import { create } from 'zustand';
import { AuthError, NetworkError, getFile, probeRepo, saveWithRetry, type GithubConfig } from '../api/github';
import type { Extras, ExtraItem, IsoDay, ItemKey, Pantry, Recipe, SaleItem, Settings, WeekKey } from '../types';
import * as ops from './ops';
import type { FileDataMap, FileKey, FileOpMap } from './ops';
import { DEFAULT_PANTRY } from './seed';

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'authError' | 'error';

export interface FileState<T> {
  data: T;
  sha?: string;
}

export interface DataFiles {
  recipes: FileState<Recipe[]>;
  plans: FileState<FileDataMap['plans']>;
  pantry: FileState<Pantry>;
  sales: FileState<SaleItem[]>;
  settings: FileState<Settings>;
  extras: FileState<Extras>;
}

const DEFAULT_SETTINGS: Settings = {
  persons: [
    { name: 'Osoba 1', blocked: [] },
    { name: 'Osoba 2', blocked: [] },
  ],
  dietRules: [],
  rotationWeeks: 2,
};

/** Type-erased at the registry boundary; restored generically at call sites. */
interface AnyFileEntry {
  path: string;
  emptyData: unknown;
  apply: (op: unknown, data: unknown) => unknown;
}

const FILES: Record<FileKey, AnyFileEntry> = {
  recipes: { path: 'recipes.json', emptyData: [] as Recipe[], apply: ops.applyRecipesOp as AnyFileEntry['apply'] },
  plans: { path: 'plans.json', emptyData: {}, apply: ops.applyPlansOp as AnyFileEntry['apply'] },
  pantry: { path: 'pantry.json', emptyData: [] as Pantry, apply: ops.applyPantryOp as AnyFileEntry['apply'] },
  sales: { path: 'sales.json', emptyData: [] as SaleItem[], apply: ops.applySalesOp as AnyFileEntry['apply'] },
  settings: { path: 'settings.json', emptyData: DEFAULT_SETTINGS, apply: ops.applySettingsOp as AnyFileEntry['apply'] },
  extras: { path: 'extras.json', emptyData: { weeks: {} }, apply: ops.applyExtrasOp as AnyFileEntry['apply'] },
};

const FILE_KEYS = Object.keys(FILES) as FileKey[];

function cacheKey(path: string): string {
  return `munchplan.cache.${path}`;
}

function readCache<T>(path: string): T | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKey(path));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeCache(path: string, data: unknown): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(cacheKey(path), JSON.stringify(data));
  } catch {
    // Storage unavailable (private mode, quota) — cache just won't update.
  }
}

function defaultFiles(): DataFiles {
  return {
    recipes: { data: [], sha: undefined },
    plans: { data: {}, sha: undefined },
    pantry: { data: [], sha: undefined },
    sales: { data: [], sha: undefined },
    settings: { data: DEFAULT_SETTINGS, sha: undefined },
    extras: { data: { weeks: {} }, sha: undefined },
  };
}

export interface DataState {
  status: LoadStatus;
  offline: boolean;
  saveError: string | null;
  cfg: GithubConfig | null;
  files: DataFiles;

  loadAll: (cfg: GithubConfig | null) => Promise<void>;
  mutate: <K extends FileKey>(fileKey: K, op: FileOpMap[K]) => Promise<void>;

  addRecipe: (recipe: Recipe) => Promise<void>;
  removeRecipe: (id: string) => Promise<void>;
  assignDay: (week: WeekKey, day: IsoDay, recipeId: string | null) => Promise<void>;
  addPantryItem: (name: string) => Promise<void>;
  removePantryItem: (name: string) => Promise<void>;
  upsertSaleItem: (name: string, note?: string) => Promise<void>;
  removeSaleItem: (name: string) => Promise<void>;
  clearSales: () => Promise<void>;
  setPersonName: (idx: 0 | 1, name: string) => Promise<void>;
  setBlockedList: (idx: 0 | 1, blocked: string[]) => Promise<void>;
  upsertDietRule: (category: string, min?: number, max?: number) => Promise<void>;
  removeDietRule: (category: string) => Promise<void>;
  setRotationWeeks: (weeks: number) => Promise<void>;
  setCheck: (week: WeekKey, itemKey: ItemKey, checked: boolean) => Promise<void>;
  addExtraItem: (week: WeekKey, item: ExtraItem) => Promise<void>;
  removeExtraItem: (week: WeekKey, id: string) => Promise<void>;
  setExtraChecked: (week: WeekKey, id: string, checked: boolean) => Promise<void>;
  setHomeOverride: (week: WeekKey, itemKey: ItemKey, override: 'toHome' | 'toBuy' | null) => Promise<void>;
}

export const useDataStore = create<DataState>()((set, get) => {
  function hydrateFromCache(): void {
    const cached = FILE_KEYS.map((key) => ({ key, data: readCache<unknown>(FILES[key].path) }));
    const anyCache = cached.some((c) => c.data !== null);
    if (!anyCache) {
      set({ status: 'error' });
      return;
    }
    const files = defaultFiles();
    for (const { key, data } of cached) {
      if (data !== null) (files as Record<FileKey, FileState<unknown>>)[key] = { data, sha: undefined };
    }
    set({ files, status: 'ready', offline: true });
  }

  async function loadAll(cfg: GithubConfig | null): Promise<void> {
    if (!cfg) return;
    set({ status: 'loading', saveError: null, cfg });

    try {
      await probeRepo(cfg);
    } catch (err) {
      if (err instanceof AuthError) {
        set({ status: 'authError' });
        return;
      }
      if (err instanceof NetworkError) {
        hydrateFromCache();
        return;
      }
      set({ status: 'error' });
      return;
    }

    let fetched: ({ data: unknown; sha: string } | null)[];
    try {
      fetched = await Promise.all(FILE_KEYS.map((key) => getFile<unknown>(cfg, FILES[key].path)));
    } catch (err) {
      if (err instanceof NetworkError) {
        hydrateFromCache();
        return;
      }
      if (err instanceof AuthError) {
        set({ status: 'authError' });
        return;
      }
      set({ status: 'error' });
      return;
    }

    const files = defaultFiles();
    let pantryIsFirstRun = false;
    FILE_KEYS.forEach((key, i) => {
      const result = fetched[i];
      if (result) {
        (files as Record<FileKey, FileState<unknown>>)[key] = { data: result.data, sha: result.sha };
        writeCache(FILES[key].path, result.data);
      } else if (key === 'pantry') {
        pantryIsFirstRun = true;
        files.pantry = { data: DEFAULT_PANTRY, sha: undefined };
      }
    });

    set({ files, status: 'ready', offline: false });

    if (pantryIsFirstRun) {
      try {
        const saved = await saveWithRetry(
          cfg,
          FILES.pantry.path,
          ops.setPantry(DEFAULT_PANTRY),
          FILES.pantry.apply,
          null,
          FILES.pantry.emptyData,
        );
        writeCache(FILES.pantry.path, saved.data);
        set((s) => ({ files: { ...s.files, pantry: { data: saved.data as Pantry, sha: saved.sha } } }));
      } catch {
        // Non-fatal: pantry stays seeded locally without a sha; the next
        // mutation or load attempt will retry persisting it.
      }
    }
  }

  async function mutate<K extends FileKey>(fileKey: K, op: FileOpMap[K]): Promise<void> {
    const state = get();
    const cfg = state.cfg;
    if (!cfg) return;

    const entry = FILES[fileKey];
    const prev = state.files[fileKey] as FileState<unknown>;
    const optimistic = entry.apply(op, prev.data);
    set((s) => ({ files: { ...s.files, [fileKey]: { data: optimistic, sha: prev.sha } }, saveError: null }));

    try {
      const base = prev.sha !== undefined ? { data: prev.data, sha: prev.sha } : null;
      const result = await saveWithRetry(cfg, entry.path, op, entry.apply, base, entry.emptyData);
      set((s) => ({ files: { ...s.files, [fileKey]: { data: result.data, sha: result.sha } } }));
      writeCache(entry.path, result.data);
    } catch (err) {
      set((s) => ({ files: { ...s.files, [fileKey]: prev } }));
      if (err instanceof AuthError) {
        set({ status: 'authError' });
      } else {
        set({ saveError: err instanceof Error ? err.message : 'Unknown error' });
      }
    }
  }

  return {
    status: 'idle',
    offline: false,
    saveError: null,
    cfg: null,
    files: defaultFiles(),

    loadAll,
    mutate,

    addRecipe: (recipe) => mutate('recipes', ops.upsertRecipe(recipe)),
    removeRecipe: (id) => mutate('recipes', ops.deleteRecipe(id)),
    assignDay: (week, day, recipeId) => mutate('plans', ops.assignDay(week, day, recipeId)),
    addPantryItem: (name) => mutate('pantry', ops.addPantryItem(name)),
    removePantryItem: (name) => mutate('pantry', ops.removePantryItem(name)),
    upsertSaleItem: (name, note) => mutate('sales', ops.upsertSaleItem(name, note)),
    removeSaleItem: (name) => mutate('sales', ops.removeSaleItem(name)),
    clearSales: () => mutate('sales', ops.clearSales()),
    setPersonName: (idx, name) => mutate('settings', ops.setPersonName(idx, name)),
    setBlockedList: (idx, blocked) => mutate('settings', ops.setBlockedList(idx, blocked)),
    upsertDietRule: (category, min, max) => mutate('settings', ops.upsertDietRule(category, min, max)),
    removeDietRule: (category) => mutate('settings', ops.removeDietRule(category)),
    setRotationWeeks: (weeks) => mutate('settings', ops.setRotationWeeks(weeks)),
    setCheck: (week, itemKey, checked) => mutate('extras', ops.setCheck(week, itemKey, checked)),
    addExtraItem: (week, item) => mutate('extras', ops.addExtraItem(week, item)),
    removeExtraItem: (week, id) => mutate('extras', ops.removeExtraItem(week, id)),
    setExtraChecked: (week, id, checked) => mutate('extras', ops.setExtraChecked(week, id, checked)),
    setHomeOverride: (week, itemKey, override) => mutate('extras', ops.setHomeOverride(week, itemKey, override)),
  };
});
