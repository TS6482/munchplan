/**
 * Czech label maps for the four meal slots (feature 002), shared by the
 * recipe form/detail, plan, and meal detail screens. `SLOT_ORDER` (data
 * order) lives in src/types/index.ts.
 */

import type { MealSlotKey } from '../types';

export const SLOT_LABELS: Record<MealSlotKey, string> = {
  breakfast: 'snídaně',
  lunch: 'oběd',
  dinner: 'večeře',
  snack: 'svačiny',
};

/** Accusative form for warning copy ("Recept není označen jako vhodný pro snídani"). */
export const SLOT_ACCUSATIVE: Record<MealSlotKey, string> = {
  breakfast: 'pro snídani',
  lunch: 'pro oběd',
  dinner: 'pro večeři',
  snack: 'pro svačinu',
};
