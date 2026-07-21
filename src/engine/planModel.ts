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
 * Duplicates are preserved on purpose — quota counting and shopping-list
 * aggregation both need multiplicity (a recipe planned twice counts twice).
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

/** True when the slot holds no entries — including when the week isn't stored yet. */
export function slotIsEmpty(weekPlan: WeekPlan | undefined, day: IsoDay, slot: MealSlotKey): boolean {
  if (!weekPlan) return true;
  return weekPlan.days[day][slot].length === 0;
}
