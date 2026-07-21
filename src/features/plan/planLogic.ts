/**
 * Pure view-model for the weekly plan screen (steps 3, 10), shared with the
 * meal detail page — no React, no store, no fetch. Wraps engine functions
 * (week/suggest/quota/autoFill) and recipe lookups into shapes the thin
 * PlanPage/MealDetailPage/RecipePicker components render directly.
 */

import type { DietRule, IsoDay, MealSlotKey, Plans, Recipe, SaleItem, Settings, WeekKey, WeekPlan } from '../../types';
import { SLOT_ORDER } from '../../types';
import { ISO_DAYS, currentWeek, dateOfDay, mondayOf, nextWeek } from '../../engine/week';
import { evaluateQuotas } from '../../engine/quota';
import { normalizeName } from '../../engine/normalize';
import {
  rankSuggestions,
  warningsFor,
  type RankSuggestionsInput,
  type Suggestion,
  type Warning,
} from '../../engine/suggest';
import { buildAutoFill, type AutoFillPlacement, type AutoFillTarget } from '../../engine/autoFill';
import { canBePlanned } from '../recipes/recipeFormLogic';
import { SLOT_ACCUSATIVE, SLOT_LABELS } from '../../components/slotLabels';
import { routeHash } from '../../router/router';
import { entryRows } from './mealDetailLogic';

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
// Day labels / dates (shared with mealDetailLogic)
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

/** 'YYYY-MM-DD' -> Czech short date 'D.M.' (no leading zeros). */
export function czechDate(isoDate: string): string {
  const [, month, day] = isoDate.split('-');
  return `${Number(day)}.${Number(month)}.`;
}

// ---------------------------------------------------------------------------
// Auto-fill targets from last week's per-weekday pattern (feature 003)
// ---------------------------------------------------------------------------

/**
 * Fill targets = the per-weekday pattern of the nearest *earlier* stored week
 * (compared via `mondayOf`, never string sort, so year boundaries compare
 * correctly): for each weekday, the slots that held >=1 entry on that same
 * weekday in the pattern week. No earlier week -> večeře on every day.
 * Result is day-major/`SLOT_ORDER`-ordered.
 */
export function weekdayPatternTargets(plans: Plans, week: WeekKey): AutoFillTarget[] {
  const targetMonday = mondayOf(week).getTime();
  let nearestKey: WeekKey | null = null;
  let nearestMonday = -Infinity;

  for (const key of Object.keys(plans)) {
    const monday = mondayOf(key).getTime();
    if (monday < targetMonday && monday > nearestMonday) {
      nearestMonday = monday;
      nearestKey = key;
    }
  }

  const patternWeek = nearestKey ? plans[nearestKey] : undefined;
  const targets: AutoFillTarget[] = [];
  for (const day of ISO_DAYS) {
    if (!patternWeek) {
      targets.push({ day, slot: 'dinner' });
      continue;
    }
    for (const slot of SLOT_ORDER) {
      if (patternWeek.days[day][slot].length > 0) targets.push({ day, slot });
    }
  }
  return targets;
}

// ---------------------------------------------------------------------------
// Day cards (step 10; supersedes dayRows)
// ---------------------------------------------------------------------------

export interface DayCardEntry {
  entryId: string;
  displayName: string;
  untriedBadge: boolean;
}

export interface DayCardLine {
  slot: MealSlotKey;
  slotLabel: string;
  entries: DayCardEntry[];
  hasEntries: boolean;
  emptyText: string;
  mealDetailHash: string;
}

export interface DayCard {
  day: IsoDay;
  dayLabel: string;
  dateText: string;
  lines: DayCardLine[];
}

/**
 * 7 Mon->Sun cards for `week`, every card always rendering all four slot
 * lines in `SLOT_ORDER` (feature 003: no week-level slot activation).
 * `hasEntries` per line drives the instant-clear ✕. Entry display reuses
 * `entryRows` (deleted-recipe fallback, multi-recipe name join, untried
 * badge) so the plan and meal detail screens never drift apart.
 */
export function dayCards(week: WeekKey, plans: Plans, recipes: Recipe[]): DayCard[] {
  const weekPlan = plans[week];

  return ISO_DAYS.map((day) => ({
    day,
    dayLabel: DAY_LABELS[day],
    dateText: czechDate(dateOfDay(week, day)),
    lines: SLOT_ORDER.map((slot) => {
      const entries = entryRows(weekPlan, day, slot, recipes).map((row) => ({
        entryId: row.entryId,
        displayName: row.displayName,
        untriedBadge: row.untriedBadge,
      }));
      return {
        slot,
        slotLabel: SLOT_LABELS[slot],
        entries,
        hasEntries: entries.length > 0,
        emptyText: '—',
        mealDetailHash: routeHash({ name: 'mealDetail', week, day, slot }),
      };
    }),
  }));
}

// ---------------------------------------------------------------------------
// Auto-fill / reroll wiring (step 10)
// ---------------------------------------------------------------------------

export interface AutoFillRunInput {
  recipes: Recipe[];
  plans: Plans;
  sales: SaleItem[];
  settings: Settings;
  week: WeekKey;
}

export interface ReplaceAutoEntriesOp {
  week: WeekKey;
  placements: AutoFillPlacement[];
}

export interface AutoFillRunResult {
  op: ReplaceAutoEntriesOp | null;
  hints: AutoFillTarget[];
}

/**
 * "Doplnit návrhy": fill-mode `buildAutoFill`, targeting the per-weekday
 * pattern of the nearest earlier stored week (`weekdayPatternTargets`),
 * mapped to a single `replaceAutoEntries`-shaped op (`null` when the pass
 * placed nothing — no pointless PUT). `hints` are the (day, slot) pairs with
 * no eligible candidate, for the transient "Žádný vhodný recept" UI hint.
 */
export function runAutoFill(input: AutoFillRunInput, rng: () => number, idFn: () => string): AutoFillRunResult {
  const targets = weekdayPatternTargets(input.plans, input.week);
  const { placements, emptySlots } = buildAutoFill({ ...input, mode: { kind: 'fill', targets }, rng, idFn });
  return {
    op: placements.length > 0 ? { week: input.week, placements } : null,
    hints: emptySlots,
  };
}

/**
 * "Přegenerovat" for the whole week: reroll-mode `buildAutoFill` (targets
 * every slot holding >=1 auto entry; manual entries are never touched). `op`
 * is `null` when the week has no auto entries to reroll.
 */
export function runWeekReroll(input: AutoFillRunInput, rng: () => number, idFn: () => string): AutoFillRunResult {
  const { placements, emptySlots } = buildAutoFill({ ...input, mode: { kind: 'reroll' }, rng, idFn });
  return {
    op: placements.length > 0 ? { week: input.week, placements } : null,
    hints: emptySlots,
  };
}

/** True when any slot of `weekPlan` holds a `source: 'auto'` entry — drives the "Přegenerovat" button's visibility. */
export function hasAutoEntries(weekPlan: WeekPlan | undefined): boolean {
  if (!weekPlan) return false;
  return ISO_DAYS.some((day) => SLOT_ORDER.some((slot) => weekPlan.days[day][slot].some((e) => e.source === 'auto')));
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
