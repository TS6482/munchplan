/**
 * Pure view-model for the shopping list screen (step 14) — no React, no
 * store, no fetch. Wraps `buildShoppingList` (step 7) with the selected
 * plan week's `WeekExtras`, and provides the small display/edit helpers
 * ShoppingPage renders directly.
 */

import type { ExtraItem, Extras, ItemKey, Pantry, Plans, Recipe, SaleItem, WeekExtras, WeekKey } from '../../types';
import { buildShoppingList, type ShoppingItem, type ShoppingList } from '../../engine/shoppingList';
import { formatAmount } from '../recipes/recipeFormLogic';

const EMPTY_WEEK_EXTRAS: WeekExtras = { checks: {}, extraItems: [], homeOverrides: {} };

/** The stored WeekExtras for `week`, or an empty one — weeks are never leaked into each other. */
export function weekExtrasFor(extras: Extras, week: WeekKey): WeekExtras {
  return extras.weeks[week] ?? EMPTY_WEEK_EXTRAS;
}

export interface ShoppingViewInput {
  recipes: Recipe[];
  plans: Plans;
  pantry: Pantry;
  sales: SaleItem[];
  extras: Extras;
  week: WeekKey;
}

/** Builds the shopping list for `week`'s plan, scoped to that week's checks/extras/overrides. */
export function shoppingView(input: ShoppingViewInput): ShoppingList {
  const { recipes, plans, pantry, sales, extras, week } = input;
  return buildShoppingList({
    recipes,
    plan: plans[week],
    pantry,
    sales,
    weekExtras: weekExtrasFor(extras, week),
  });
}

/** '500 g' / '3' (no unit) when an amount is known, else 'dle receptu'. */
export function itemAmountText(item: ShoppingItem): string {
  if (item.amount !== undefined) return `${formatAmount(item.amount)} ${item.unit ?? ''}`.trim();
  return 'dle receptu';
}

export type ValidateExtraNameResult = { ok: true } | { ok: false; error: string };

/** Manual extra items only need a non-empty name. */
export function validateExtraName(name: string): ValidateExtraNameResult {
  if (!name.trim()) return { ok: false, error: 'Vyplňte název položky' };
  return { ok: true };
}

/** Builds a fresh, unchecked ExtraItem (idFn injectable for tests). */
export function newExtraItem(name: string, idFn: () => string = () => crypto.randomUUID()): ExtraItem {
  return { id: idFn(), name: name.trim(), checked: false };
}

/**
 * The next `homeOverrides[key]` value for a "move to home"/"move to buy"
 * row action. Moving a row in `direction` clears an existing override that
 * already pointed the opposite way (reverting to the item's natural
 * pantry-driven placement) rather than stacking overrides; otherwise it sets
 * the override for `direction`. Symmetric for both row actions.
 */
export function toggleHomeTarget(
  overrides: Record<ItemKey, 'toHome' | 'toBuy'>,
  key: ItemKey,
  direction: 'toHome' | 'toBuy',
): 'toHome' | 'toBuy' | null {
  const opposite = direction === 'toHome' ? 'toBuy' : 'toHome';
  return overrides[key] === opposite ? null : direction;
}
