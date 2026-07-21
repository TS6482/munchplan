/**
 * Weighted-random auto-fill engine (feature 002, step 6) — pure, no React, no
 * store, no `Math.random`/`Date` (rng/idFn injected). Computes placements
 * only; the caller issues the single `replaceAutoEntries` op (steps 9-10).
 */

import type { IsoDay, MealEntry, MealSlotKey, Plans, Recipe, SaleItem, Settings, WeekKey, WeekPlan } from '../types';
import { SLOT_ORDER } from '../types';
import { composeEntry } from './composition';
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

export type AutoFillMode = { kind: 'fill'; targets: AutoFillTarget[] } | { kind: 'reroll'; only?: AutoFillTarget };

export interface BuildAutoFillInput {
  recipes: Recipe[];
  plans: Plans;
  sales: SaleItem[];
  settings: Settings;
  week: WeekKey;
  mode: AutoFillMode;
  rng: () => number;
  idFn: () => string;
}

export interface AutoFillResult {
  placements: AutoFillPlacement[];
  emptySlots: AutoFillTarget[];
}

/** Day-major, then `SLOT_ORDER` — deterministic regardless of the caller's input order. */
function sortTargets(targets: AutoFillTarget[]): AutoFillTarget[] {
  const dayIndex = new Map(ISO_DAYS.map((d, i) => [d, i]));
  const slotIndex = new Map(SLOT_ORDER.map((s, i) => [s, i]));
  return [...targets].sort((a, b) => {
    const dayDiff = dayIndex.get(a.day)! - dayIndex.get(b.day)!;
    return dayDiff !== 0 ? dayDiff : slotIndex.get(a.slot)! - slotIndex.get(b.slot)!;
  });
}

/** Fill-mode targets: the caller-given targets, re-sorted day-major/SLOT_ORDER, restricted to currently-empty slots. */
function fillTargets(plans: Plans, week: WeekKey, given: AutoFillTarget[]): AutoFillTarget[] {
  const weekPlan = plans[week];
  return sortTargets(given).filter((t) => slotIsEmpty(weekPlan, t.day, t.slot));
}

/** True when (day, slot) holds >=1 `source: 'auto'` entry. */
function hasAutoEntry(weekPlan: WeekPlan | undefined, day: IsoDay, slot: MealSlotKey): boolean {
  return weekPlan?.days[day][slot].some((e) => e.source === 'auto') ?? false;
}

/** Reroll-mode targets: every (day, slot) holding >=1 auto entry; `only` narrows to one candidate. */
function rerollTargets(plans: Plans, week: WeekKey, only: AutoFillTarget | undefined): AutoFillTarget[] {
  const weekPlan = plans[week];

  if (only) {
    return hasAutoEntry(weekPlan, only.day, only.slot) ? [only] : [];
  }

  const targets: AutoFillTarget[] = [];
  for (const day of ISO_DAYS) {
    for (const slot of SLOT_ORDER) {
      if (hasAutoEntry(weekPlan, day, slot)) targets.push({ day, slot });
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
function baselineWeek(plans: Plans, week: WeekKey, mode: AutoFillMode, targets: AutoFillTarget[]): WeekPlan {
  const existing = plans[week] ?? emptyWeekPlan();
  if (mode.kind === 'fill') return existing;

  const days = { ...existing.days };
  for (const { day, slot } of targets) {
    days[day] = { ...days[day], [slot]: days[day][slot].filter((e) => e.source === 'manual') };
  }
  return { ...existing, days };
}

/**
 * Computes weighted-random placements for every empty targeted slot (fill) or
 * every auto-holding slot (reroll). Each pick re-ranks via `rankSuggestions`
 * against the simulated plan including all earlier picks in this pass, so
 * quota consumption and "no recipe twice" apply progressively. Zero targets
 * -> `{ placements: [], emptySlots: [] }` (the caller then issues no op).
 *
 * Placement composes via `composeEntry` (feature 004 step 5): per target, rng
 * is called once for `pickWeighted` (choosing the ranked candidate) and, only
 * when that candidate is a `main`, once more inside `composeEntry` for
 * `pickPairedSide` — this fixed call order is what makes a pinned rng
 * sequence reproduce the whole pass byte-identically. The FULL composed
 * entry (main + side, when present) is appended to `workingWeek` so later
 * targets in the same pass see it; quota still counts only the primary
 * recipe (step 3 semantics), while a side may be redrawn into another meal
 * in the same pass (sides are not no-twice-constrained).
 */
export function buildAutoFill(input: BuildAutoFillInput): AutoFillResult {
  const { recipes, plans, sales, settings, week, mode, rng, idFn } = input;

  const targets = mode.kind === 'fill' ? fillTargets(plans, week, mode.targets) : rerollTargets(plans, week, mode.only);

  if (targets.length === 0) return { placements: [], emptySlots: [] };

  let workingWeek = baselineWeek(plans, week, mode, targets);
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

    const entry = composeEntry(ranked[idx].recipe, recipes, sales, settings, rng, idFn, 'auto');
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
