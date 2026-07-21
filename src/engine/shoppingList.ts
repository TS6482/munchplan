import type { ExtraItem, ItemKey, Pantry, Recipe, SaleItem, WeekExtras, WeekPlan } from '../types';
import { exactMatch, itemKey, saleMatch } from './match';
import { normalizeName } from './normalize';
import { weekRecipeIds } from './planModel';

export interface ShoppingItem {
  key: ItemKey;
  /** First-seen original spelling among merged contributors. */
  label: string;
  /** Summed amount, or undefined when any contributor to this key lacks one. */
  amount?: number;
  unit?: string;
  onSale: boolean;
  matchedSale?: string;
  checked: boolean;
  fromRecipes: string[];
}

export interface ShoppingList {
  buy: ShoppingItem[];
  home: ShoppingItem[];
  extras: ExtraItem[];
}

export interface BuildShoppingListInput {
  recipes: Recipe[];
  plan: WeekPlan | undefined;
  pantry: Pantry;
  sales: SaleItem[];
  weekExtras: WeekExtras;
}

interface Occurrence {
  name: string;
  amount?: number;
  unit?: string;
  recipeName: string;
}

interface Group {
  key: ItemKey;
  label: string;
  unit?: string;
  amounts: (number | undefined)[];
  fromRecipes: string[];
}

/**
 * Ingredient occurrences for every recipe assigned to any slot of any day of
 * `plan`. A recipe appearing twice in the week (any slots) contributes its
 * ingredients twice. Unknown/deleted recipeIds are skipped silently (recipe
 * deletion never crashes an old plan).
 */
function collectOccurrences(recipes: Recipe[], plan: WeekPlan | undefined): Occurrence[] {
  if (!plan) return [];
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const occurrences: Occurrence[] = [];
  for (const recipeId of weekRecipeIds(plan)) {
    const recipe = byId.get(recipeId);
    if (!recipe) continue;
    for (const ing of recipe.ingredients) {
      occurrences.push({ name: ing.name, amount: ing.amount, unit: ing.unit, recipeName: recipe.name });
    }
  }
  return occurrences;
}

/** Groups occurrences by ItemKey (name+unit, never amount). */
function groupOccurrences(occurrences: Occurrence[]): Group[] {
  const groups = new Map<ItemKey, Group>();
  for (const occ of occurrences) {
    const key = itemKey(occ.name, occ.unit);
    let group = groups.get(key);
    if (!group) {
      group = { key, label: occ.name, unit: occ.unit, amounts: [], fromRecipes: [] };
      groups.set(key, group);
    }
    group.amounts.push(occ.amount);
    if (!group.fromRecipes.includes(occ.recipeName)) group.fromRecipes.push(occ.recipeName);
  }
  return [...groups.values()];
}

/**
 * Sums a group's amounts. If any contributor lacks an amount, the total is
 * unknown (undefined) rather than a partial sum, so the list never shows a
 * misleadingly-low total for a partially-quantified ingredient.
 */
function mergedAmount(amounts: (number | undefined)[]): number | undefined {
  if (amounts.some((a) => a === undefined)) return undefined;
  return (amounts as number[]).reduce((sum, a) => sum + a, 0);
}

function sortByLabel(a: ShoppingItem, b: ShoppingItem): number {
  return normalizeName(a.label).localeCompare(normalizeName(b.label));
}

/**
 * Builds the shopping list for a plan week: merges recipe ingredients by
 * ItemKey, splits pantry-matched items into `home`, marks sale matches, and
 * attaches per-item check state from `weekExtras`. `extras` is passed through
 * from `weekExtras.extraItems` unchanged.
 */
export function buildShoppingList(input: BuildShoppingListInput): ShoppingList {
  const { recipes, plan, pantry, sales, weekExtras } = input;
  const groups = groupOccurrences(collectOccurrences(recipes, plan));

  const buy: ShoppingItem[] = [];
  const home: ShoppingItem[] = [];

  for (const group of groups) {
    const matchedSaleItem = sales.find((sale) => saleMatch(sale.name, group.label));
    const item: ShoppingItem = {
      key: group.key,
      label: group.label,
      amount: mergedAmount(group.amounts),
      unit: group.unit,
      onSale: matchedSaleItem !== undefined,
      matchedSale: matchedSaleItem?.name,
      checked: weekExtras.checks[group.key] === true,
      fromRecipes: group.fromRecipes,
    };

    const override = weekExtras.homeOverrides[group.key];
    const isPantryMatch = pantry.some((entry) => exactMatch(entry.name, group.label));
    const goesHome = override === 'toHome' || (override !== 'toBuy' && isPantryMatch);

    (goesHome ? home : buy).push(item);
  }

  buy.sort(sortByLabel);
  home.sort(sortByLabel);

  return { buy, home, extras: weekExtras.extraItems };
}
