import type { Plans, Recipe, RecipeCategory, SaleItem, Settings, WeekKey } from '../types';
import { blockedMatch, saleMatch } from './match';
import { normalizeName } from './normalize';
import { weekRecipeIds } from './planModel';
import { unmetMinCategories, wouldExceedMax } from './quota';
import { isInRotationWindow, weeksSinceCooked } from './rotation';

export interface RankSuggestionsInput {
  recipes: Recipe[];
  plans: Plans;
  sales: SaleItem[];
  settings: Settings;
  targetWeek: WeekKey;
}

export interface Suggestion {
  recipe: Recipe;
  matchedSaleIngredients: string[];
  saleMatchCount: number;
  weeksSinceCooked: number;
  boostsUnmetMin: boolean;
  untried: boolean;
}

export type Warning =
  | { kind: 'blocked'; person: string; ingredients: string[] }
  | { kind: 'maxExceeded'; category: RecipeCategory }
  | { kind: 'rotation'; weeksSinceCooked: number };

/**
 * Categories of recipes currently assigned to any slot of any day of
 * `targetWeek`. Duplicates count multiple times (a multi-recipe entry
 * contributes each recipe's category; the same recipe in two slots counts
 * twice). Unknown recipeIds are skipped.
 */
export function plannedCategories(recipes: Recipe[], plans: Plans, targetWeek: WeekKey): RecipeCategory[] {
  const plan = plans[targetWeek];
  if (!plan) return [];
  const byId = new Map(recipes.map((r) => [r.id, r]));
  return weekRecipeIds(plan)
    .map((id) => byId.get(id))
    .filter((r): r is Recipe => r != null)
    .map((r) => r.category);
}

/** recipeIds already assigned to any slot of any day of `targetWeek` (deduped). */
function assignedRecipeIds(plans: Plans, targetWeek: WeekKey): Set<string> {
  const plan = plans[targetWeek];
  if (!plan) return new Set();
  return new Set(weekRecipeIds(plan));
}

/** The recipe's ingredient names blocked for `person` (empty if none). */
function blockedIngredientsFor(recipe: Recipe, blocked: string[]): string[] {
  return recipe.ingredients
    .filter((ing) => blocked.some((term) => blockedMatch(term, ing.name)))
    .map((ing) => ing.name);
}

function isBlockedForAnyone(recipe: Recipe, settings: Settings): boolean {
  return settings.persons.some((person) => blockedIngredientsFor(recipe, person.blocked).length > 0);
}

/** The recipe's ingredient names that match any sale item. */
function matchedSaleIngredients(recipe: Recipe, sales: SaleItem[]): string[] {
  return recipe.ingredients
    .filter((ing) => sales.some((sale) => saleMatch(sale.name, ing.name)))
    .map((ing) => ing.name);
}

/**
 * Ranked, filtered suggestions for `targetWeek`. Excludes recipes with no
 * ingredients, blocked ingredients (either person), recipes inside the
 * rotation window, recipes that would exceed a max diet quota, and recipes
 * already assigned to the target week. Untried recipes with ingredients are
 * included (flagged `untried: true`).
 *
 * Ranked by the lexicographic tuple (saleMatchCount desc, weeksSinceCooked
 * desc [never cooked = Infinity], boostsUnmetMin desc, normalized name asc).
 */
export function rankSuggestions(input: RankSuggestionsInput): Suggestion[] {
  const { recipes, plans, sales, settings, targetWeek } = input;
  const planned = plannedCategories(recipes, plans, targetWeek);
  const assignedIds = assignedRecipeIds(plans, targetWeek);
  const unmetMin = new Set(unmetMinCategories(planned, settings.dietRules).map((c) => normalizeName(c)));

  const suggestions: Suggestion[] = [];
  for (const recipe of recipes) {
    if (recipe.ingredients.length === 0) continue;
    if (assignedIds.has(recipe.id)) continue;
    if (isBlockedForAnyone(recipe, settings)) continue;
    if (isInRotationWindow(recipe.id, plans, targetWeek, settings.rotationWeeks)) continue;
    if (wouldExceedMax(recipe.category, planned, settings.dietRules)) continue;

    const matched = matchedSaleIngredients(recipe, sales);
    suggestions.push({
      recipe,
      matchedSaleIngredients: matched,
      saleMatchCount: matched.length,
      weeksSinceCooked: weeksSinceCooked(recipe.id, plans, targetWeek),
      boostsUnmetMin: unmetMin.has(normalizeName(recipe.category)),
      untried: recipe.untried,
    });
  }

  suggestions.sort((a, b) => {
    if (a.saleMatchCount !== b.saleMatchCount) return b.saleMatchCount - a.saleMatchCount;
    if (a.weeksSinceCooked !== b.weeksSinceCooked) return b.weeksSinceCooked - a.weeksSinceCooked;
    if (a.boostsUnmetMin !== b.boostsUnmetMin) return a.boostsUnmetMin ? -1 : 1;
    return normalizeName(a.recipe.name).localeCompare(normalizeName(b.recipe.name));
  });

  return suggestions;
}

/**
 * Warnings for manually assigning `recipe` to `input.targetWeek`, for the
 * direct-assignment picker (blocked ingredients don't prevent the pick, they
 * just warn). Same underlying checks as `rankSuggestions`' exclusions, minus
 * the zero-ingredients/already-assigned cases (irrelevant to a direct pick).
 */
export function warningsFor(recipe: Recipe, input: RankSuggestionsInput): Warning[] {
  const { recipes, plans, settings, targetWeek } = input;
  const warnings: Warning[] = [];

  for (const person of settings.persons) {
    const ingredients = blockedIngredientsFor(recipe, person.blocked);
    if (ingredients.length > 0) {
      warnings.push({ kind: 'blocked', person: person.name, ingredients });
    }
  }

  const planned = plannedCategories(recipes, plans, targetWeek);
  if (wouldExceedMax(recipe.category, planned, settings.dietRules)) {
    warnings.push({ kind: 'maxExceeded', category: recipe.category });
  }

  if (isInRotationWindow(recipe.id, plans, targetWeek, settings.rotationWeeks)) {
    warnings.push({ kind: 'rotation', weeksSinceCooked: weeksSinceCooked(recipe.id, plans, targetWeek) });
  }

  return warnings;
}
