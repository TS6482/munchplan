import { describe, expect, it } from 'vitest';
import type { Plans, Recipe, Settings } from '../types';
import { makeRecipe, weekPlanWith } from '../testing/fixtures';
import { buildAutoFill, pickWeighted } from './autoFill';

const WEEK = '2026-W30';

function recipe(overrides: Partial<Recipe> & { id: string; name: string }): Recipe {
  return makeRecipe({
    ingredients: [{ name: `ingredience-${overrides.id}` }],
    category: 'jine',
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

/** Sequential id generator, e.g. idFnFrom('auto') -> 'auto-0', 'auto-1', ... */
function idFnFrom(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${n++}`;
}

/** rng() => 0 always lands pickWeighted on rank 0 (the top-ranked candidate). */
const TOP: () => number = () => 0;

describe('pickWeighted', () => {
  it('returns null for an empty ranking', () => {
    expect(pickWeighted(0, () => 0)).toBeNull();
  });

  it('returns index 0 when rng() returns 0', () => {
    expect(pickWeighted(5, () => 0)).toBe(0);
  });

  it('returns the last index when rng() returns just under 1', () => {
    expect(pickWeighted(5, () => 1 - 1e-12)).toBe(4);
  });

  describe('3-candidate cumulative boundaries (weights 1, 1/2, 1/3; total 11/6)', () => {
    // Thresholds: 1/(11/6) = 6/11 ~= 0.545454...; (1+1/2)/(11/6) = 9/11 ~= 0.818181...
    const FIRST = 6 / 11;
    const SECOND = 9 / 11;

    it('picks index 0 just below the first threshold', () => {
      expect(pickWeighted(3, () => FIRST - 1e-9)).toBe(0);
    });

    it('picks index 1 exactly at the first threshold (boundary belongs to the upper bucket)', () => {
      expect(pickWeighted(3, () => FIRST)).toBe(1);
    });

    it('picks index 1 just above the first threshold', () => {
      expect(pickWeighted(3, () => FIRST + 1e-9)).toBe(1);
    });

    it('picks index 1 just below the second threshold', () => {
      expect(pickWeighted(3, () => SECOND - 1e-9)).toBe(1);
    });

    it('picks index 2 exactly at the second threshold', () => {
      expect(pickWeighted(3, () => SECOND)).toBe(2);
    });

    it('picks index 2 just above the second threshold', () => {
      expect(pickWeighted(3, () => SECOND + 1e-9)).toBe(2);
    });
  });
});

describe('buildAutoFill', () => {
  describe('fill mode', () => {
    it('targets only empty active slots, in day-major order with SLOT_ORDER inner, and never targets an occupied slot', () => {
      // 7 distinct breakfast-only and 7 distinct dinner-only recipes so every
      // target has a fresh eligible candidate (no "already assigned this week"
      // gaps) -- isolates the ordering/occupied-exclusion behavior being tested.
      const breakfastRecipes = Array.from({ length: 7 }, (_, i) =>
        recipe({ id: `b${i}`, name: `Breakfast ${i}`, suitableFor: ['breakfast'] }),
      );
      const dinnerRecipes = Array.from({ length: 7 }, (_, i) =>
        recipe({ id: `d${i}`, name: `Dinner ${i}`, suitableFor: ['dinner'] }),
      );
      const plans: Plans = {
        [WEEK]: weekPlanWith([{ day: 'mon', slot: 'dinner', recipeId: 'occupied', source: 'manual' }]),
      };
      const result = buildAutoFill({
        recipes: [...breakfastRecipes, ...dinnerRecipes],
        plans,
        sales: [],
        settings: settings(),
        week: WEEK,
        activeSlots: ['breakfast', 'dinner'],
        mode: { kind: 'fill' },
        rng: TOP,
        idFn: idFnFrom('auto'),
      });

      // mon/dinner is occupied and must be excluded; every other (day, slot) among
      // the two active slots is empty and must be targeted, breakfast before dinner
      // per day (SLOT_ORDER), days in mon..sun order.
      expect(result.emptySlots).toEqual([]);
      const targeted = result.placements.map((p) => ({ day: p.day, slot: p.slot }));
      // Occupied slot never targeted:
      expect(targeted).not.toContainEqual({ day: 'mon', slot: 'dinner' });
      // First target is mon/breakfast (mon/dinner is skipped because occupied):
      expect(targeted[0]).toEqual({ day: 'mon', slot: 'breakfast' });
      expect(targeted[1]).toEqual({ day: 'tue', slot: 'breakfast' });
      expect(targeted[2]).toEqual({ day: 'tue', slot: 'dinner' });
      expect(targeted).toHaveLength(13); // 7 breakfast + 6 dinner (mon/dinner occupied)
    });

    it('respects suitableFor: a breakfast-only recipe is never placed into dinner', () => {
      const breakfastOnly = recipe({ id: 'bfast', name: 'Kase', suitableFor: ['breakfast'] });
      const dinnerOnly = recipe({ id: 'din', name: 'Guláš', suitableFor: ['dinner'] });
      const result = buildAutoFill({
        recipes: [breakfastOnly, dinnerOnly],
        plans: {},
        sales: [],
        settings: settings(),
        week: WEEK,
        activeSlots: ['breakfast', 'dinner'],
        mode: { kind: 'fill' },
        rng: TOP,
        idFn: idFnFrom('auto'),
      });

      const monBreakfast = result.placements.find((p) => p.day === 'mon' && p.slot === 'breakfast');
      const monDinner = result.placements.find((p) => p.day === 'mon' && p.slot === 'dinner');
      expect(monBreakfast?.entries[0].recipeIds).toEqual(['bfast']);
      expect(monDinner?.entries[0].recipeIds).toEqual(['din']);

      // The breakfast-only recipe never ends up in any dinner placement.
      for (const p of result.placements) {
        if (p.slot === 'dinner') {
          expect(p.entries.some((e) => e.recipeIds.includes('bfast'))).toBe(false);
        }
      }
    });

    it('consumes a max quota progressively within one pass (max 2x maso: the third maso is never placed)', () => {
      const masoA = recipe({ id: 'masoA', name: 'Maso A', category: 'maso', suitableFor: ['dinner'] });
      const masoB = recipe({ id: 'masoB', name: 'Maso B', category: 'maso', suitableFor: ['dinner'] });
      const masoC = recipe({ id: 'masoC', name: 'Maso C', category: 'maso', suitableFor: ['dinner'] });
      const result = buildAutoFill({
        recipes: [masoA, masoB, masoC],
        plans: {},
        sales: [],
        settings: settings({ dietRules: [{ category: 'maso', max: 2 }] }),
        week: WEEK,
        activeSlots: ['dinner'],
        mode: { kind: 'fill' },
        rng: TOP,
        idFn: idFnFrom('auto'),
      });

      // Only 2 of the 7 dinner targets get filled (max 2x maso); masoC is never placed.
      expect(result.placements).toHaveLength(2);
      const placedIds = result.placements.flatMap((p) => p.entries.flatMap((e) => e.recipeIds));
      expect(placedIds).toEqual(['masoA', 'masoB']);
      expect(placedIds).not.toContain('masoC');

      // The remaining 5 dinner days have no eligible candidate left.
      expect(result.emptySlots).toHaveLength(5);
    });

    it('never places the same recipe twice in one week', () => {
      const r = recipe({ id: 'only', name: 'Jedine jidlo', suitableFor: ['dinner'] });
      const result = buildAutoFill({
        recipes: [r],
        plans: {},
        sales: [],
        settings: settings(),
        week: WEEK,
        activeSlots: ['dinner'],
        mode: { kind: 'fill' },
        rng: TOP,
        idFn: idFnFrom('auto'),
      });

      expect(result.placements).toHaveLength(1);
      expect(result.placements[0].entries[0].recipeIds).toEqual(['only']);
      // The other 6 dinner days find no eligible candidate (recipe already assigned).
      expect(result.emptySlots).toHaveLength(6);
    });

    it('lists a slot with no eligible candidate in emptySlots and omits it from placements', () => {
      const result = buildAutoFill({
        recipes: [],
        plans: {},
        sales: [],
        settings: settings(),
        week: WEEK,
        activeSlots: ['dinner'],
        mode: { kind: 'fill' },
        rng: TOP,
        idFn: idFnFrom('auto'),
      });

      expect(result.placements).toEqual([]);
      expect(result.emptySlots).toHaveLength(7);
      expect(result.emptySlots).toContainEqual({ day: 'mon', slot: 'dinner' });
    });

    it('returns an empty result when activeSlots is empty', () => {
      const r = recipe({ id: 'r1', name: 'Jidlo' });
      const result = buildAutoFill({
        recipes: [r],
        plans: {},
        sales: [],
        settings: settings(),
        week: WEEK,
        activeSlots: [],
        mode: { kind: 'fill' },
        rng: TOP,
        idFn: idFnFrom('auto'),
      });

      expect(result).toEqual({ placements: [], emptySlots: [] });
    });

    it('is deterministic: the same rng/idFn sequences produce identical output', () => {
      const masoA = recipe({ id: 'masoA', name: 'Maso A', category: 'maso', suitableFor: ['dinner'] });
      const masoB = recipe({ id: 'masoB', name: 'Maso B', category: 'maso', suitableFor: ['dinner'] });
      const run = () =>
        buildAutoFill({
          recipes: [masoA, masoB],
          plans: {},
          sales: [],
          settings: settings(),
          week: WEEK,
          activeSlots: ['dinner'],
          mode: { kind: 'fill' },
          rng: TOP,
          idFn: idFnFrom('auto'),
        });

      expect(run()).toEqual(run());
    });

    it('two different rng sequences can produce different valid fills', () => {
      const recipeA = recipe({ id: 'ra', name: 'Recept A', suitableFor: ['dinner'] });
      const recipeB = recipe({ id: 'rb', name: 'Recept B', suitableFor: ['dinner'] });
      const run = (rng: () => number) =>
        buildAutoFill({
          recipes: [recipeA, recipeB],
          plans: {},
          sales: [],
          settings: settings(),
          week: WEEK,
          activeSlots: ['dinner'],
          mode: { kind: 'fill' },
          rng,
          idFn: idFnFrom('auto'),
        });

      // rng() = 0 always lands on rank 0; for 2 candidates (weights 1, 1/2) the
      // threshold is 2/3, so rng() = 0.99 lands on rank 1 instead.
      const resultTop = run(() => 0);
      const resultOther = run(() => 0.99);

      const firstPickTop = resultTop.placements[0].entries[0].recipeIds;
      const firstPickOther = resultOther.placements[0].entries[0].recipeIds;
      expect(firstPickTop).not.toEqual(firstPickOther);
    });
  });

  describe('reroll mode', () => {
    it('targets slots with >=1 auto entry, restricted to activeSlots; every targeted slot appears in placements', () => {
      const r = recipe({ id: 'r1', name: 'Jidlo', suitableFor: ['dinner'] });
      const plans: Plans = {
        [WEEK]: weekPlanWith([
          { day: 'mon', slot: 'dinner', recipeId: 'old-auto', source: 'auto' },
          { day: 'tue', slot: 'breakfast', recipeId: 'old-auto-2', source: 'auto' }, // breakfast not active -> not targeted
          { day: 'wed', slot: 'dinner', recipeId: 'manual-only', source: 'manual' }, // manual-only -> not targeted
        ]),
      };
      const result = buildAutoFill({
        recipes: [r],
        plans,
        sales: [],
        settings: settings(),
        week: WEEK,
        activeSlots: ['dinner'],
        mode: { kind: 'reroll' },
        rng: TOP,
        idFn: idFnFrom('auto'),
      });

      const targeted = result.placements.map((p) => ({ day: p.day, slot: p.slot }));
      expect(targeted).toEqual([{ day: 'mon', slot: 'dinner' }]);
      expect(result.placements[0].entries[0].recipeIds).toEqual(['r1']);
    });

    it('strips only stale auto entries; manual entries stay and keep consuming quota (manual maso + max 1 -> reroll cannot place maso)', () => {
      const masoManual = recipe({ id: 'masoManual', name: 'Maso Manual', category: 'maso', suitableFor: ['dinner'] });
      const masoCandidate = recipe({
        id: 'masoCandidate',
        name: 'Maso Candidate',
        category: 'maso',
        suitableFor: ['dinner'],
      });
      const plans: Plans = {
        [WEEK]: weekPlanWith([
          { day: 'mon', slot: 'dinner', recipeId: 'masoManual', source: 'manual' },
          { day: 'tue', slot: 'dinner', recipeId: 'stale-auto', source: 'auto' },
        ]),
      };
      const result = buildAutoFill({
        recipes: [masoManual, masoCandidate],
        plans,
        sales: [],
        settings: settings({ dietRules: [{ category: 'maso', max: 1 }] }),
        week: WEEK,
        activeSlots: ['dinner'],
        mode: { kind: 'reroll' },
        rng: TOP,
        idFn: idFnFrom('auto'),
      });

      // mon/dinner (manual-only) is never targeted -- it doesn't appear at all.
      expect(result.placements.find((p) => p.day === 'mon')).toBeUndefined();
      // tue/dinner (the stale auto slot) is targeted but nothing eligible: the
      // manual maso from Monday already consumes the max-1 quota.
      expect(result.placements).toEqual([{ day: 'tue', slot: 'dinner', entries: [] }]);
      expect(result.emptySlots).toEqual([{ day: 'tue', slot: 'dinner' }]);
    });

    it('`only` narrows to a single (day, slot)', () => {
      const r = recipe({ id: 'r1', name: 'Jidlo', suitableFor: ['dinner'] });
      const plans: Plans = {
        [WEEK]: weekPlanWith([
          { day: 'tue', slot: 'dinner', recipeId: 'old-1', source: 'auto' },
          { day: 'wed', slot: 'dinner', recipeId: 'old-2', source: 'auto' },
        ]),
      };
      const result = buildAutoFill({
        recipes: [r],
        plans,
        sales: [],
        settings: settings(),
        week: WEEK,
        activeSlots: ['dinner'],
        mode: { kind: 'reroll', only: { day: 'tue', slot: 'dinner' } },
        rng: TOP,
        idFn: idFnFrom('auto'),
      });

      expect(result.placements).toHaveLength(1);
      expect(result.placements[0]).toMatchObject({ day: 'tue', slot: 'dinner' });
    });

    it('`only` on a manual-only slot yields zero targets', () => {
      const r = recipe({ id: 'r1', name: 'Jidlo', suitableFor: ['dinner'] });
      const plans: Plans = {
        [WEEK]: weekPlanWith([{ day: 'mon', slot: 'dinner', recipeId: 'manual-1', source: 'manual' }]),
      };
      const result = buildAutoFill({
        recipes: [r],
        plans,
        sales: [],
        settings: settings(),
        week: WEEK,
        activeSlots: ['dinner'],
        mode: { kind: 'reroll', only: { day: 'mon', slot: 'dinner' } },
        rng: TOP,
        idFn: idFnFrom('auto'),
      });

      expect(result).toEqual({ placements: [], emptySlots: [] });
    });

    it('lists an unfillable targeted slot as entries: [] (not omitted, unlike fill mode)', () => {
      const plans: Plans = {
        [WEEK]: weekPlanWith([{ day: 'mon', slot: 'dinner', recipeId: 'old-1', source: 'auto' }]),
      };
      const result = buildAutoFill({
        recipes: [], // nothing eligible to replace the stale auto entry
        plans,
        sales: [],
        settings: settings(),
        week: WEEK,
        activeSlots: ['dinner'],
        mode: { kind: 'reroll' },
        rng: TOP,
        idFn: idFnFrom('auto'),
      });

      expect(result.placements).toEqual([{ day: 'mon', slot: 'dinner', entries: [] }]);
      expect(result.emptySlots).toEqual([{ day: 'mon', slot: 'dinner' }]);
    });
  });
});
