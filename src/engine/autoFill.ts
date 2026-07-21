/**
 * Weighted-random auto-fill engine (feature 002, step 6) — pure, no React, no
 * store, no `Math.random`/`Date` (rng/idFn injected). Computes placements
 * only; the caller issues the single `replaceAutoEntries` op (steps 9-10).
 */

import type { IsoDay, MealEntry, MealSlotKey, Plans, Recipe, SaleItem, Settings, WeekKey, WeekPlan } from '../types';
import { SLOT_ORDER } from '../types';
import { emptyWeekPlan, slotIsEmpty } from './planModel';
import { rankSuggestions } from './suggest';
import { ISO_DAYS } from './week';

/**
 * Draws an index in `[0, rankedLength)` with harmonic weights `1 / (i + 1)`
 * (rank 0 = strongest draw probability), or `null` for an empty ranking.
 *
 * Thresholds are computed as `1 - remaining/total` (`remaining` = the weight
 * still unaccounted for after index `i`) rather than the more obvious
 * `cumulative/total`: both are mathematically the running-sum fraction, but
 * under IEEE-754 rounding only this form lands the 3-candidate boundaries
 * exactly on `6/11` and `9/11` (pinned by tests). Compared with `<` against
 * running totals, never equality.
 */
export function pickWeighted(rankedLength: number, rng: () => number): number | null {
  if (rankedLength <= 0) return null;
  const weights = Array.from({ length: rankedLength }, (_, i) => 1 / (i + 1));
  const total = weights.reduce((sum, w) => sum + w, 0);
  const r = rng();
  let remaining = total;
  for (let i = 0; i < rankedLength; i++) {
    remaining -= weights[i];
    if (r < 1 - remaining / total) return i;
  }
  return rankedLength - 1;
}

/** A single (day, slot) auto-fill/reroll target. */
export interface AutoFillTarget {
  day: IsoDay;
  slot: MealSlotKey;
}

/** One targeted (day, slot)'s replacement entries — shaped exactly as `replaceAutoEntries`'s `MealPlacement` input. */
export interface AutoFillPlacement {
  day: IsoDay;
  slot: MealSlotKey;
  entries: MealEntry[];
}

export type AutoFillMode = { kind: 'fill' } | { kind: 'reroll'; only?: AutoFillTarget };

export interface BuildAutoFillInput {
  recipes: Recipe[];
  plans: Plans;
  sales: SaleItem[];
  settings: Settings;
  week: WeekKey;
  activeSlots: MealSlotKey[];
  mode: AutoFillMode;
  rng: () => number;
  idFn: () => string;
}

export interface AutoFillResult {
  placements: AutoFillPlacement[];
  emptySlots: AutoFillTarget[];
}

/** Fill-mode targets: every (day, slot) with slot active and currently empty, day-major then SLOT_ORDER. */
function fillTargets(plans: Plans, week: WeekKey, activeSlots: MealSlotKey[]): AutoFillTarget[] {
  const weekPlan = plans[week];
  const active = new Set(activeSlots);
  const targets: AutoFillTarget[] = [];
  for (const day of ISO_DAYS) {
    for (const slot of SLOT_ORDER) {
      if (!active.has(slot)) continue;
      if (slotIsEmpty(weekPlan, day, slot)) targets.push({ day, slot });
    }
  }
  return targets;
}

/** True when (day, slot) is active and holds >=1 `source: 'auto'` entry. */
function hasAutoEntry(weekPlan: WeekPlan | undefined, active: Set<MealSlotKey>, day: IsoDay, slot: MealSlotKey): boolean {
  if (!active.has(slot)) return false;
  return weekPlan?.days[day][slot].some((e) => e.source === 'auto') ?? false;
}

/** Reroll-mode targets: slots holding >=1 auto entry, restricted to `activeSlots`; `only` narrows to one candidate. */
function rerollTargets(
  plans: Plans,
  week: WeekKey,
  activeSlots: MealSlotKey[],
  only: AutoFillTarget | undefined,
): AutoFillTarget[] {
  const weekPlan = plans[week];
  const active = new Set(activeSlots);

  if (only) {
    return hasAutoEntry(weekPlan, active, only.day, only.slot) ? [only] : [];
  }

  const targets: AutoFillTarget[] = [];
  for (const day of ISO_DAYS) {
    for (const slot of SLOT_ORDER) {
      if (hasAutoEntry(weekPlan, active, day, slot)) targets.push({ day, slot });
    }
  }
  return targets;
}

/**
 * The simulation's starting `WeekPlan`. Fill mode reuses the stored week
 * as-is (targets are already empty). Reroll mode strips `source: 'auto'`
 * entries from the targeted slots only, so their categories/ids don't block
 * their own replacements, while manual entries (in targeted or untargeted
 * slots) stay and keep consuming quotas.
 */
function baselineWeek(plans: Plans, week: WeekKey, mode: AutoFillMode, targets: AutoFillTarget[], activeSlots: MealSlotKey[]): WeekPlan {
  const existing = plans[week] ?? emptyWeekPlan(activeSlots);
  if (mode.kind === 'fill') return existing;

  const days = { ...existing.days };
  for (const { day, slot } of targets) {
    days[day] = { ...days[day], [slot]: days[day][slot].filter((e) => e.source === 'manual') };
  }
  return { ...existing, days };
}

/**
 * Computes weighted-random placements for every empty active slot (fill) or
 * every auto-holding active slot (reroll). Each pick re-ranks via
 * `rankSuggestions` against the simulated plan including all earlier picks
 * in this pass, so quota consumption and "no recipe twice" apply
 * progressively. Zero targets -> `{ placements: [], emptySlots: [] }` (the
 * caller then issues no op).
 */
export function buildAutoFill(input: BuildAutoFillInput): AutoFillResult {
  const { recipes, plans, sales, settings, week, activeSlots, mode, rng, idFn } = input;

  const targets =
    mode.kind === 'fill' ? fillTargets(plans, week, activeSlots) : rerollTargets(plans, week, activeSlots, mode.only);

  if (targets.length === 0) return { placements: [], emptySlots: [] };

  let workingWeek = baselineWeek(plans, week, mode, targets, activeSlots);
  const placements: AutoFillPlacement[] = [];
  const emptySlots: AutoFillTarget[] = [];

  for (const { day, slot } of targets) {
    const simulatedPlans: Plans = { ...plans, [week]: workingWeek };
    const ranked = rankSuggestions({ recipes, plans: simulatedPlans, sales, settings, targetWeek: week, slot });
    const idx = pickWeighted(ranked.length, rng);

    if (idx === null) {
      emptySlots.push({ day, slot });
      if (mode.kind === 'reroll') placements.push({ day, slot, entries: [] });
      continue;
    }

    const entry: MealEntry = { id: idFn(), recipeIds: [ranked[idx].recipe.id], source: 'auto' };
    placements.push({ day, slot, entries: [entry] });
    workingWeek = {
      ...workingWeek,
      days: {
        ...workingWeek.days,
        [day]: { ...workingWeek.days[day], [slot]: [...workingWeek.days[day][slot], entry] },
      },
    };
  }

  return { placements, emptySlots };
}
