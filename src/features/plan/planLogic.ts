/**
 * Pure view-model for the weekly plan screen (step 13) — no React, no store,
 * no fetch. Wraps engine functions (week/suggest/quota) and recipe lookups
 * into shapes the thin PlanPage/SuggestionsPanel/RecipePicker components
 * render directly.
 */

import type { DietRule, IsoDay, Plans, Recipe, WeekKey } from '../../types';
import { ISO_DAYS, currentWeek, dateOfDay, nextWeek } from '../../engine/week';
import { evaluateQuotas } from '../../engine/quota';
import { normalizeName } from '../../engine/normalize';
import {
  rankSuggestions,
  warningsFor,
  type RankSuggestionsInput,
  type Suggestion,
  type Warning,
} from '../../engine/suggest';
import { canBePlanned } from '../recipes/recipeFormLogic';
import { SLOT_ACCUSATIVE } from '../../components/slotLabels';

// ---------------------------------------------------------------------------
// Week toggle
// ---------------------------------------------------------------------------

export interface WeekChoice {
  key: WeekKey;
  label: string;
}

/** Current + next week, labelled for the Tento/Příští týden toggle. */
export function weekChoices(now: Date): WeekChoice[] {
  return [
    { key: currentWeek(now), label: 'Tento týden' },
    { key: nextWeek(now), label: 'Příští týden' },
  ];
}

// ---------------------------------------------------------------------------
// Day rows
// ---------------------------------------------------------------------------

export const DAY_LABELS: Record<IsoDay, string> = {
  mon: 'Po',
  tue: 'Út',
  wed: 'St',
  thu: 'Čt',
  fri: 'Pá',
  sat: 'So',
  sun: 'Ne',
};

export interface DayRow {
  day: IsoDay;
  dayLabel: string;
  date: string;
  /** Id of the day's first dinner-slot entry, if any — target for the ✕ remove action. */
  entryId: string | null;
  recipeId: string | null;
  recipeName: string | null;
  deleted: boolean;
}

/** 'YYYY-MM-DD' -> Czech short date 'D.M.' (no leading zeros). */
export function czechDate(isoDate: string): string {
  const [, month, day] = isoDate.split('-');
  return `${Number(day)}.${Number(month)}.`;
}

/**
 * 7 Mon->Sun rows for `weekKey`, each rendering the dinner slot's first entry
 * (interim wiring pinned by step 3's plan — the meal detail page in step 9
 * shows every entry of every slot; this row stays a one-line summary).
 */
export function dayRows(weekKey: WeekKey, plans: Plans, recipes: Recipe[]): DayRow[] {
  const plan = plans[weekKey];
  const byId = new Map(recipes.map((r) => [r.id, r]));

  return ISO_DAYS.map((day) => {
    const entry = plan?.days[day]?.dinner[0];
    const recipeId = entry?.recipeIds[0] ?? null;
    let recipeName: string | null = null;
    let deleted = false;

    if (recipeId !== null) {
      const found = byId.get(recipeId);
      if (found) {
        recipeName = found.name;
      } else {
        recipeName = 'smazaný recept';
        deleted = true;
      }
    }

    return {
      day,
      dayLabel: DAY_LABELS[day],
      date: czechDate(dateOfDay(weekKey, day)),
      entryId: entry?.id ?? null,
      recipeId,
      recipeName,
      deleted,
    };
  });
}

// ---------------------------------------------------------------------------
// Warnings -> Czech
// ---------------------------------------------------------------------------

function rotationText(weeksSinceCooked: number): string {
  return weeksSinceCooked === 1 ? 'Vařeno před 1 týdnem' : `Vařeno před ${weeksSinceCooked} týdny`;
}

/** Renders `warningsFor` output as Czech strings for the direct-assignment picker. */
export function czechWarnings(warnings: Warning[]): string[] {
  return warnings.map((w) => {
    switch (w.kind) {
      case 'blocked':
        return `Obsahuje blokované ingredience pro ${w.person}: ${w.ingredients.join(', ')}`;
      case 'maxExceeded':
        return `Překročí týdenní limit pro kategorii ${w.category}`;
      case 'rotation':
        return rotationText(w.weeksSinceCooked);
      case 'unsuitable':
        return `Recept není označen jako vhodný ${SLOT_ACCUSATIVE[w.slot]}`;
    }
  });
}

// ---------------------------------------------------------------------------
// Suggestions panel view-model
// ---------------------------------------------------------------------------

export interface SuggestionView {
  id: string;
  name: string;
  untriedBadge: boolean;
  saleText: string | null;
  freshText: string;
}

function freshText(weeksSinceCooked: number): string {
  if (weeksSinceCooked === Infinity) return 'Nevařeno';
  return weeksSinceCooked === 1 ? 'Před 1 týdnem' : `Před ${weeksSinceCooked} týdny`;
}

export function suggestionView(s: Suggestion): SuggestionView {
  return {
    id: s.recipe.id,
    name: s.recipe.name,
    untriedBadge: s.untried,
    saleText: s.matchedSaleIngredients.length > 0 ? `Ve slevě: ${s.matchedSaleIngredients.join(', ')}` : null,
    freshText: freshText(s.weeksSinceCooked),
  };
}

/** Re-export of `rankSuggestions` verbatim — no re-ranking in the view layer. */
export function getSuggestions(input: RankSuggestionsInput): Suggestion[] {
  return rankSuggestions(input);
}

// ---------------------------------------------------------------------------
// Direct-assignment recipe picker
// ---------------------------------------------------------------------------

export interface PickerEntry {
  recipe: Recipe;
  plannable: boolean;
  warnings: string[];
}

/**
 * All recipes (Czech-sorted by name) for the direct-assignment picker, each
 * flagged with `canBePlanned` and the Czech warnings `warningsFor` would show
 * for a manual pick. Unplannable recipes are still listed (UI disables them);
 * recipes with warnings remain selectable.
 */
export function pickerEntries(input: RankSuggestionsInput): PickerEntry[] {
  return input.recipes
    .slice()
    .sort((a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name), 'cs'))
    .map((recipe) => ({
      recipe,
      plannable: canBePlanned(recipe),
      warnings: czechWarnings(warningsFor(recipe, input)),
    }));
}

// ---------------------------------------------------------------------------
// Quota summary line
// ---------------------------------------------------------------------------

/** One rule's status as 'maso 2/max 2' / 'ryba 0/min 1' / 'zelenina 1 (min 1, max 3)'. */
function formatQuotaStatus(status: { category: string; count: number; min?: number; max?: number }): string {
  const { category, count, min, max } = status;
  if (min !== undefined && max !== undefined) return `${category} ${count} (min ${min}, max ${max})`;
  if (min !== undefined) return `${category} ${count}/min ${min}`;
  return `${category} ${count}/max ${max}`;
}

/** 'maso 2/max 2 · ryba 0/min 1' style summary; null when there are no diet rules. */
export function quotaSummaryLine(rules: DietRule[], plannedCategories: string[]): string | null {
  if (rules.length === 0) return null;
  return evaluateQuotas(plannedCategories, rules).map(formatQuotaStatus).join(' · ');
}
