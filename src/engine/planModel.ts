/**
 * Pure plan-model helpers (feature 002, step 3) — no React, no store, no
 * fetch. Building blocks for empty/derived shapes; the conflict-merge logic
 * that mutates them lives in `src/store/ops.ts`.
 */

import type { DayPlan, IsoDay, MealEntry, MealSlotKey, WeekPlan } from '../types';
import { SLOT_ORDER } from '../types';
import { ISO_DAYS } from './week';

/** A day with every slot empty. */
export function emptyDayPlan(): DayPlan {
  return { breakfast: [], lunch: [], dinner: [], snack: [] };
}

/** A week with all 7 days empty. */
export function emptyWeekPlan(): WeekPlan {
  const days = {} as Record<IsoDay, DayPlan>;
  for (const day of ISO_DAYS) days[day] = emptyDayPlan();
  return { days };
}

/** Every entry of a day, across all four slots, in `SLOT_ORDER`. */
export function entriesOfDay(dayPlan: DayPlan): MealEntry[] {
  return SLOT_ORDER.flatMap((slot) => dayPlan[slot]);
}

/**
 * Every recipeId of every entry of every slot of every day in the week.
 * Duplicates are preserved on purpose — rotation and shopping-list
 * aggregation both need multiplicity (a recipe planned twice counts twice;
 * a composed entry's side/salad counts as cooked too, once planned). Diet
 * quotas do NOT use this — see `weekPrimaryRecipeIds` (feature 004 plan,
 * design decision 1: a meal's category is judged by its main, not its
 * side/salad components).
 */
export function weekRecipeIds(weekPlan: WeekPlan): string[] {
  const ids: string[] = [];
  for (const day of ISO_DAYS) {
    for (const entry of entriesOfDay(weekPlan.days[day])) {
      ids.push(...entry.recipeIds);
    }
  }
  return ids;
}

/**
 * The FIRST recipeId of every entry of every slot of every day in the week —
 * each entry's primary/meal-identity recipe (feature 004 plan, design
 * decision 1: overrides the 002 step-5 "count all recipeIds" pin for quota
 * purposes — diet quotas judge the main a composed entry places, not its
 * side/salad). Duplicates are preserved (the same main planned twice still
 * counts twice). Entries with an empty `recipeIds` array are skipped
 * defensively (the UI never creates one, but this stays crash-safe).
 */
export function weekPrimaryRecipeIds(weekPlan: WeekPlan): string[] {
  const ids: string[] = [];
  for (const day of ISO_DAYS) {
    for (const entry of entriesOfDay(weekPlan.days[day])) {
      if (entry.recipeIds.length > 0) ids.push(entry.recipeIds[0]);
    }
  }
  return ids;
}

/** True when the slot holds no entries — including when the week isn't stored yet. */
export function slotIsEmpty(weekPlan: WeekPlan | undefined, day: IsoDay, slot: MealSlotKey): boolean {
  if (!weekPlan) return true;
  return weekPlan.days[day][slot].length === 0;
}
