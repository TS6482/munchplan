import type { Plans, WeekKey } from '../types';
import { mondayOf } from './week';

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Most recent week strictly before `beforeWeek` where any day references
 * `recipeId`, or `null` if it was never cooked before then. Weeks are
 * compared chronologically via `mondayOf` timestamps (never string sort),
 * so lookback across a year boundary is correct.
 */
export function lastCookedWeek(recipeId: string, plans: Plans, beforeWeek: WeekKey): WeekKey | null {
  const beforeMs = mondayOf(beforeWeek).getTime();
  let best: { week: WeekKey; ms: number } | null = null;
  for (const [week, plan] of Object.entries(plans)) {
    const ms = mondayOf(week).getTime();
    if (ms >= beforeMs) continue;
    const cooked = Object.values(plan.days).some((id) => id === recipeId);
    if (!cooked) continue;
    if (best === null || ms > best.ms) {
      best = { week, ms };
    }
  }
  return best?.week ?? null;
}

/**
 * Number of whole weeks between `targetWeek` and the last time `recipeId`
 * was cooked before it, or `Infinity` if never cooked before then.
 */
export function weeksSinceCooked(recipeId: string, plans: Plans, targetWeek: WeekKey): number {
  const lastWeek = lastCookedWeek(recipeId, plans, targetWeek);
  if (lastWeek === null) return Infinity;
  const targetMs = mondayOf(targetWeek).getTime();
  const lastMs = mondayOf(lastWeek).getTime();
  return Math.round((targetMs - lastMs) / MS_PER_WEEK);
}

/**
 * True when `recipeId` should be hidden from suggestions for `targetWeek`
 * because it was cooked within the last `rotationWeeks` weeks. Pinned
 * boundary: cooked exactly `rotationWeeks` weeks ago -> hidden; cooked
 * `rotationWeeks + 1` weeks ago -> visible; never cooked -> visible;
 * `rotationWeeks` 0 -> always visible. The target week's own assignments
 * never count (lastCookedWeek only looks strictly before it).
 */
export function isInRotationWindow(
  recipeId: string,
  plans: Plans,
  targetWeek: WeekKey,
  rotationWeeks: number,
): boolean {
  if (rotationWeeks <= 0) return false;
  return weeksSinceCooked(recipeId, plans, targetWeek) <= rotationWeeks;
}
