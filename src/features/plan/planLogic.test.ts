import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GithubConfig } from '../../api/github';
import type { IsoDay, MealSlotKey, Plans, Recipe, Settings, WeekPlan } from '../../types';
import { dinnerWeek, makeRecipe, weekPlanWith } from '../../testing/fixtures';
import { emptyWeekPlan } from '../../engine/planModel';
import type { Suggestion, Warning } from '../../engine/suggest';
import { applyPlansOp, normalizePlans, replaceAutoEntries } from '../../store/ops';
import {
  czechWarnings,
  dayCards,
  defaultActiveSlots,
  getSuggestions,
  hasAutoEntries,
  pickerEntries,
  quotaSummaryLine,
  runAutoFill,
  runWeekReroll,
  seedOpsForUnstoredWeek,
  suggestionView,
  toggleSlotResult,
  weekChoices,
} from './planLogic';

const TARGET = '2026-W30';

function planWith(days: Partial<Record<IsoDay, string | null>>): WeekPlan {
  const filtered: Partial<Record<IsoDay, string>> = {};
  for (const [day, id] of Object.entries(days)) {
    if (id != null) filtered[day as IsoDay] = id;
  }
  return dinnerWeek(filtered);
}

function recipe(overrides: Partial<Recipe> & { id: string; name: string }): Recipe {
  return makeRecipe({
    ingredients: [{ name: 'ingredience' }],
    category: 'jine',
    effort: 'normal',
    untried: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });
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

// ---------------------------------------------------------------------------
// defaultActiveSlots
// ---------------------------------------------------------------------------

describe('defaultActiveSlots', () => {
  it('returns the stored week\'s activeSlots when present', () => {
    const plans: Plans = { [TARGET]: emptyWeekPlan(['breakfast', 'snack']) };
    expect(defaultActiveSlots(plans, TARGET)).toEqual(['breakfast', 'snack']);
  });

  it('returns an explicitly stored empty activeSlots (a "we\'re away" week), not a fallback', () => {
    const plans: Plans = { [TARGET]: emptyWeekPlan([]) };
    expect(defaultActiveSlots(plans, TARGET)).toEqual([]);
  });

  it('falls back to the nearest earlier stored week\'s activeSlots', () => {
    const plans: Plans = {
      '2026-W28': emptyWeekPlan(['breakfast']),
      '2026-W29': emptyWeekPlan(['snack']),
    };
    expect(defaultActiveSlots(plans, TARGET)).toEqual(['snack']);
  });

  it('ignores stored weeks that are not earlier than the target', () => {
    const plans: Plans = {
      '2026-W31': emptyWeekPlan(['snack']),
    };
    expect(defaultActiveSlots(plans, TARGET)).toEqual(['dinner']);
  });

  it('compares weeks by mondayOf, not string sort, across a year boundary', () => {
    const plans: Plans = {
      '2025-W51': emptyWeekPlan(['breakfast', 'lunch']),
    };
    expect(defaultActiveSlots(plans, '2026-W01')).toEqual(['breakfast', 'lunch']);
  });

  it('falls back to ["dinner"] when no earlier week is stored', () => {
    expect(defaultActiveSlots({}, TARGET)).toEqual(['dinner']);
  });

  it('does not throw over normalizePlans output for a garbage key alongside a valid old-shape week (MINOR 4)', () => {
    const plans = normalizePlans({ garbage: { some: 'nonsense' }, '2026-W29': emptyWeekPlan(['snack']) });
    expect(() => defaultActiveSlots(plans, TARGET)).not.toThrow();
    expect(defaultActiveSlots(plans, TARGET)).toEqual(['snack']);
  });
});

// ---------------------------------------------------------------------------
// toggleSlotResult
// ---------------------------------------------------------------------------

describe('toggleSlotResult', () => {
  it('deactivates a displayed slot on an unstored week (inherited defaults), never confirming (no stored entries)', () => {
    expect(toggleSlotResult(undefined, ['lunch', 'dinner'], 'dinner')).toEqual({
      op: 'deactivate',
      needsConfirm: false,
      entryCount: 0,
    });
  });

  it('activates a slot not among the displayed defaults on an unstored week', () => {
    expect(toggleSlotResult(undefined, ['lunch', 'dinner'], 'breakfast')).toEqual({
      op: 'activate',
      needsConfirm: false,
      entryCount: 0,
    });
  });

  it('activates an inactive slot on a stored week, never confirming', () => {
    const plan = emptyWeekPlan(['dinner']);
    expect(toggleSlotResult(plan, plan.activeSlots, 'breakfast')).toEqual({
      op: 'activate',
      needsConfirm: false,
      entryCount: 0,
    });
  });

  it('deactivates an empty active slot without confirmation', () => {
    const plan = emptyWeekPlan(['dinner']);
    expect(toggleSlotResult(plan, plan.activeSlots, 'dinner')).toEqual({
      op: 'deactivate',
      needsConfirm: false,
      entryCount: 0,
    });
  });

  it('requires confirmation to deactivate a slot holding entries, counting across all 7 days', () => {
    const plan = weekPlanWith([
      { day: 'mon', slot: 'dinner', recipeId: 'r1' },
      { day: 'wed', slot: 'dinner', recipeId: 'r2' },
    ]);
    expect(toggleSlotResult(plan, plan.activeSlots, 'dinner')).toEqual({
      op: 'deactivate',
      needsConfirm: true,
      entryCount: 2,
      confirmText: 'Slot obsahuje jídla — odebrat je?',
    });
  });

  it('allows deactivating the last remaining active slot (an all-unticked week is valid)', () => {
    const plan = emptyWeekPlan(['snack']);
    expect(toggleSlotResult(plan, plan.activeSlots, 'snack')).toEqual({
      op: 'deactivate',
      needsConfirm: false,
      entryCount: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// seedOpsForUnstoredWeek
// ---------------------------------------------------------------------------

describe('seedOpsForUnstoredWeek', () => {
  it('returns [] when the week is already stored', () => {
    const plans: Plans = { [TARGET]: emptyWeekPlan(['lunch']) };
    expect(seedOpsForUnstoredWeek(plans, TARGET)).toEqual([]);
  });

  it('returns activateSlot ops for the inherited defaults when the week is unstored', () => {
    const plans: Plans = { '2026-W28': emptyWeekPlan(['lunch', 'dinner']) };
    expect(seedOpsForUnstoredWeek(plans, TARGET)).toEqual([
      { type: 'activateSlot', week: TARGET, slot: 'lunch' },
      { type: 'activateSlot', week: TARGET, slot: 'dinner' },
    ]);
  });

  it('returns one activateSlot op for the first-ever-week ["dinner"] default', () => {
    expect(seedOpsForUnstoredWeek({}, TARGET)).toEqual([{ type: 'activateSlot', week: TARGET, slot: 'dinner' }]);
  });
});

// ---------------------------------------------------------------------------
// dayCards
// ---------------------------------------------------------------------------

describe('dayCards', () => {
  it('returns 7 Mon->Sun cards with a line per active slot, in SLOT_ORDER, for an unstored week', () => {
    const cards = dayCards(TARGET, {}, [], ['snack', 'breakfast']);
    expect(cards).toHaveLength(7);
    expect(cards.map((c) => c.day)).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    expect(cards[0].dayLabel).toBe('Po');
    expect(cards[0].dateText).toBe('20.7.');
    expect(cards[0].lines.map((l) => l.slot)).toEqual(['breakfast', 'snack']);
    for (const line of cards[0].lines) {
      expect(line.entries).toEqual([]);
      expect(line.emptyText).toBe('—');
    }
  });

  it('renders only active slots as lines, hiding inactive ones', () => {
    const cards = dayCards(TARGET, {}, [], ['dinner']);
    expect(cards[0].lines).toHaveLength(1);
    expect(cards[0].lines[0].slot).toBe('dinner');
  });

  it('lists entry summaries with displayName and untried badge for an active slot', () => {
    const r = recipe({ id: 'r1', name: 'Kuřecí na paprice', untried: true });
    const plans: Plans = { [TARGET]: planWith({ mon: 'r1' }) };
    const cards = dayCards(TARGET, plans, [r], ['dinner']);
    const monLine = cards[0].lines.find((l) => l.slot === 'dinner')!;
    expect(monLine.entries).toEqual([{ entryId: 'fx-mon', displayName: 'Kuřecí na paprice', untriedBadge: true }]);
  });

  it('falls back to "smazaný recept" for a deleted recipeId', () => {
    const plans: Plans = { [TARGET]: planWith({ tue: 'gone' }) };
    const cards = dayCards(TARGET, plans, [], ['dinner']);
    const tueLine = cards[1].lines.find((l) => l.slot === 'dinner')!;
    expect(tueLine.entries).toEqual([{ entryId: 'fx-tue', displayName: 'smazaný recept', untriedBadge: false }]);
  });

  it('hides entries in inactive slots from the card, without touching the underlying data', () => {
    const plan = weekPlanWith([{ day: 'mon', slot: 'lunch', recipeId: 'r1' }]);
    const plans: Plans = { [TARGET]: plan };
    const cards = dayCards(TARGET, plans, [], ['dinner']);
    expect(cards[0].lines.map((l) => l.slot)).toEqual(['dinner']);
    // Data is untouched: the lunch entry is still there in the raw plan.
    expect(plans[TARGET].days.mon.lunch).toHaveLength(1);
  });

  it('builds a mealDetailHash targeting the (week, day, slot) route', () => {
    const cards = dayCards(TARGET, {}, [], ['dinner']);
    expect(cards[2].lines[0].mealDetailHash).toBe(`#/plan/${TARGET}/wed/dinner`);
  });
});

// ---------------------------------------------------------------------------
// czechWarnings
// ---------------------------------------------------------------------------

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

  it('formats an unsuitable warning with the slot accusative form (feature 002 step 5)', () => {
    const warnings: Warning[] = [{ kind: 'unsuitable', slot: 'breakfast' }];
    expect(czechWarnings(warnings)).toEqual(['Recept není označen jako vhodný pro snídani']);
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

  it('formats a max-only rule as count/max', () => {
    expect(quotaSummaryLine([{ category: 'maso', max: 2 }], ['maso', 'maso'])).toBe('maso 2/max 2');
  });

  it('formats a min-only rule as count/min and joins multiple rules', () => {
    expect(
      quotaSummaryLine(
        [
          { category: 'maso', max: 2 },
          { category: 'ryba', min: 1 },
        ],
        ['maso', 'maso'],
      ),
    ).toBe('maso 2/max 2 · ryba 0/min 1');
  });

  it('formats a rule with both min and max', () => {
    expect(quotaSummaryLine([{ category: 'zelenina', min: 1, max: 3 }], ['zelenina'])).toBe(
      'zelenina 1 (min 1, max 3)',
    );
  });
});

// ---------------------------------------------------------------------------
// runAutoFill / runWeekReroll / hasAutoEntries
// ---------------------------------------------------------------------------

function autoFillRecipe(id: string, name: string): Recipe {
  return recipe({ id, name, suitableFor: ['dinner'] });
}

describe('runAutoFill', () => {
  it('maps zero placements to op: null (no eligible recipe anywhere)', () => {
    const result = runAutoFill(
      { recipes: [], plans: {}, sales: [], settings: settings(), week: TARGET, activeSlots: ['dinner'] },
      () => 0,
      () => 'id',
    );
    expect(result.op).toBeNull();
    expect(result.hints).toHaveLength(7);
  });

  it('maps non-empty placements to a single replaceAutoEntries-shaped op', () => {
    const recipes = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'].map((id) => autoFillRecipe(id, id));
    let counter = 0;
    const result = runAutoFill(
      { recipes, plans: {}, sales: [], settings: settings(), week: TARGET, activeSlots: ['dinner'] },
      () => 0,
      () => `auto-${counter++}`,
    );
    expect(result.op).not.toBeNull();
    expect(result.op!.week).toBe(TARGET);
    expect(result.op!.placements).toHaveLength(7);
    expect(result.hints).toEqual([]);
  });
});

// MAJOR 2: applying runAutoFill's op alone on an unstored week would derive
// activeSlots from the placements only, silently dropping a displayed
// default slot that happened to get zero placements. Seeding first (decision
// 6) must keep it.
describe('runAutoFill composition: seeding an unstored week before applying the op', () => {
  it('keeps a displayed default slot with zero placements once the seed ops are applied before the auto-fill op', () => {
    const dinnerOnlyRecipes = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'].map((id) => autoFillRecipe(id, id));
    const plans: Plans = { '2026-W29': emptyWeekPlan(['breakfast', 'dinner']) };
    const activeSlots: MealSlotKey[] = ['breakfast', 'dinner']; // inherited from '2026-W29'
    let counter = 0;

    const seedOps = seedOpsForUnstoredWeek(plans, TARGET);
    expect(seedOps).toEqual([
      { type: 'activateSlot', week: TARGET, slot: 'breakfast' },
      { type: 'activateSlot', week: TARGET, slot: 'dinner' },
    ]);

    const result = runAutoFill(
      { recipes: dinnerOnlyRecipes, plans, sales: [], settings: settings(), week: TARGET, activeSlots },
      () => 0,
      () => `auto-${counter++}`,
    );
    expect(result.op).not.toBeNull();
    expect(result.hints).toHaveLength(7); // no breakfast-suitable recipe -> every day hints
    expect(result.hints.every((t) => t.slot === 'breakfast')).toBe(true);

    let seededPlans = plans;
    for (const op of seedOps) seededPlans = applyPlansOp(op, seededPlans);
    const finalPlans = applyPlansOp(replaceAutoEntries(result.op!.week, result.op!.placements), seededPlans);

    expect(finalPlans[TARGET].activeSlots).toEqual(['breakfast', 'dinner']);
  });
});

describe('runWeekReroll', () => {
  it('maps zero targets to op: null for a manual-only week', () => {
    const plans: Plans = {
      [TARGET]: weekPlanWith([{ day: 'wed', slot: 'dinner', recipeId: 'r1', source: 'manual' }]),
    };
    const result = runWeekReroll(
      { recipes: [autoFillRecipe('r1', 'r1')], plans, sales: [], settings: settings(), week: TARGET, activeSlots: ['dinner'] },
      () => 0,
      () => 'id',
    );
    expect(result.op).toBeNull();
    expect(result.hints).toEqual([]);
  });

  it('maps auto entries needing reroll to a replaceAutoEntries-shaped op', () => {
    const plans: Plans = {
      [TARGET]: weekPlanWith([{ day: 'wed', slot: 'dinner', recipeId: 'r1', source: 'auto', id: 'auto-1' }]),
    };
    const result = runWeekReroll(
      { recipes: [autoFillRecipe('r1', 'r1')], plans, sales: [], settings: settings(), week: TARGET, activeSlots: ['dinner'] },
      () => 0,
      () => 'new-id',
    );
    expect(result.op).toEqual({
      week: TARGET,
      placements: [{ day: 'wed', slot: 'dinner', entries: [{ id: 'new-id', recipeIds: ['r1'], source: 'auto' }] }],
    });
  });
});

describe('hasAutoEntries', () => {
  const activeSlots: MealSlotKey[] = ['dinner'];

  it('is false for an undefined week', () => {
    expect(hasAutoEntries(undefined, activeSlots)).toBe(false);
  });

  it('is false when the only auto entry is in an inactive slot', () => {
    const plan = weekPlanWith([{ day: 'mon', slot: 'lunch', recipeId: 'r1', source: 'auto' }]);
    expect(hasAutoEntries(plan, activeSlots)).toBe(false);
  });

  it('is true when an active slot holds an auto entry', () => {
    const plan = weekPlanWith([{ day: 'mon', slot: 'dinner', recipeId: 'r1', source: 'auto' }]);
    expect(hasAutoEntries(plan, activeSlots)).toBe(true);
  });

  it('is false when active slots only hold manual entries', () => {
    const plan = weekPlanWith([{ day: 'mon', slot: 'dinner', recipeId: 'r1', source: 'manual' }]);
    expect(hasAutoEntries(plan, activeSlots)).toBe(false);
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

describe('store integration: addMealEntry + suggestion recompute (AC4)', () => {
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

  it('addMealEntry persists into files.plans.data, and a maxed-out category excludes further suggestions', async () => {
    await useDataStore.getState().loadAll(cfg);

    const r1 = recipe({ id: 'r1', name: 'Kuřecí steak', category: 'maso' });
    const r2 = recipe({ id: 'r2', name: 'Vepřová panenka', category: 'maso' });
    const r3 = recipe({ id: 'r3', name: 'Hovězí guláš', category: 'maso' });
    await useDataStore.getState().addRecipe(r1);
    await useDataStore.getState().addRecipe(r2);
    await useDataStore.getState().addRecipe(r3);
    await useDataStore.getState().upsertDietRule('maso', undefined, 2);

    await useDataStore.getState().addMealEntry(TARGET, 'mon', 'dinner', { id: 'e1', recipeIds: ['r1'], source: 'manual' });
    expect(useDataStore.getState().files.plans.data[TARGET].days.mon.dinner).toEqual([
      { id: 'e1', recipeIds: ['r1'], source: 'manual' },
    ]);

    await useDataStore.getState().addMealEntry(TARGET, 'tue', 'dinner', { id: 'e2', recipeIds: ['r2'], source: 'manual' });
    expect(useDataStore.getState().files.plans.data[TARGET].days.tue.dinner).toEqual([
      { id: 'e2', recipeIds: ['r2'], source: 'manual' },
    ]);

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
