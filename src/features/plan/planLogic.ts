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
import { activateSlot, type PlansOp } from '../../store/ops';

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
// Slot activation (step 10)
// ---------------------------------------------------------------------------

/**
 * Which slots render for `week`: the stored week's `activeSlots` wins
 * (including an explicitly stored empty array — a "we're away" week is
 * valid); otherwise the nearest *earlier* stored week's `activeSlots`
 * (compared via `mondayOf`, never string sort, so year boundaries compare
 * correctly); otherwise `['dinner']` (first-ever-week default).
 */
export function defaultActiveSlots(plans: Plans, week: WeekKey): MealSlotKey[] {
  const stored = plans[week];
  if (stored) return stored.activeSlots;

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

  return nearestKey ? plans[nearestKey].activeSlots : ['dinner'];
}

/**
 * The `activateSlot` ops that persist a not-yet-stored week's inherited
 * defaults (decision 6) — `[]` once `week` is stored, since its `activeSlots`
 * is then the source of truth and needs no seeding. Every first-interaction
 * path (toggling a chip, adding a meal from the detail page, running
 * auto-fill) must issue these before its own op, so the displayed defaults
 * become the persisted `activeSlots` instead of silently reverting on
 * reload.
 */
export function seedOpsForUnstoredWeek(plans: Plans, week: WeekKey): Extract<PlansOp, { type: 'activateSlot' }>[] {
  if (plans[week]) return [];
  return defaultActiveSlots(plans, week).map(
    (slot) => activateSlot(week, slot) as Extract<PlansOp, { type: 'activateSlot' }>,
  );
}

export interface ToggleSlotResult {
  op: 'activate' | 'deactivate';
  needsConfirm: boolean;
  entryCount: number;
  confirmText?: string;
}

const DEACTIVATE_CONFIRM_TEXT = 'Slot obsahuje jídla — odebrat je?';

/**
 * What toggling `slot` should do, judged from `displayedSlots` (the chips the
 * user actually sees — a not-yet-stored week's inherited defaults, or the
 * stored week's `activeSlots`), not from `weekPlan` alone: activating never
 * confirms; deactivating an empty slot doesn't either; deactivating a slot
 * holding entries (summed across all 7 days of a *stored* week; an unstored
 * week has none) needs confirmation with Czech copy — the caller shows it
 * (`window.confirm`) and only then issues `deactivateSlot`.
 */
export function toggleSlotResult(
  weekPlan: WeekPlan | undefined,
  displayedSlots: MealSlotKey[],
  slot: MealSlotKey,
): ToggleSlotResult {
  const isActive = displayedSlots.includes(slot);
  if (!isActive) {
    return { op: 'activate', needsConfirm: false, entryCount: 0 };
  }

  const entryCount = weekPlan ? ISO_DAYS.reduce((sum, day) => sum + weekPlan.days[day][slot].length, 0) : 0;
  if (entryCount === 0) {
    return { op: 'deactivate', needsConfirm: false, entryCount: 0 };
  }
  return { op: 'deactivate', needsConfirm: true, entryCount, confirmText: DEACTIVATE_CONFIRM_TEXT };
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
 * 7 Mon->Sun cards for `week`, one line per slot in `activeSlots` (in
 * `SLOT_ORDER`) — inactive slots are simply absent from the card; their
 * entries stay intact in `plans`, just unrendered. Entry display reuses
 * `entryRows` (deleted-recipe fallback, multi-recipe name join, untried
 * badge) so the plan and meal detail screens never drift apart.
 */
export function dayCards(week: WeekKey, plans: Plans, recipes: Recipe[], activeSlots: MealSlotKey[]): DayCard[] {
  const weekPlan = plans[week];
  const active = new Set(activeSlots);

  return ISO_DAYS.map((day) => ({
    day,
    dayLabel: DAY_LABELS[day],
    dateText: czechDate(dateOfDay(week, day)),
    lines: SLOT_ORDER.filter((slot) => active.has(slot)).map((slot) => ({
      slot,
      slotLabel: SLOT_LABELS[slot],
      entries: entryRows(weekPlan, day, slot, recipes).map((row) => ({
        entryId: row.entryId,
        displayName: row.displayName,
        untriedBadge: row.untriedBadge,
      })),
      emptyText: '—',
      mealDetailHash: routeHash({ name: 'mealDetail', week, day, slot }),
    })),
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
  activeSlots: MealSlotKey[];
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
 * "Doplnit návrhy": fill-mode `buildAutoFill` over `input`'s active slots,
 * mapped to a single `replaceAutoEntries`-shaped op (`null` when the pass
 * placed nothing — no pointless PUT). `hints` are the (day, slot) pairs with
 * no eligible candidate, for the transient "Žádný vhodný recept" UI hint.
 */
export function runAutoFill(input: AutoFillRunInput, rng: () => number, idFn: () => string): AutoFillRunResult {
  const { placements, emptySlots } = buildAutoFill({ ...input, mode: { kind: 'fill' }, rng, idFn });
  return {
    op: placements.length > 0 ? { week: input.week, placements } : null,
    hints: emptySlots,
  };
}

/**
 * "Přegenerovat" for the whole week: reroll-mode `buildAutoFill` (targets
 * every active slot holding >=1 auto entry; manual entries are never
 * touched). `op` is `null` when the week has no auto entries to reroll.
 */
export function runWeekReroll(input: AutoFillRunInput, rng: () => number, idFn: () => string): AutoFillRunResult {
  const { placements, emptySlots } = buildAutoFill({ ...input, mode: { kind: 'reroll' }, rng, idFn });
  return {
    op: placements.length > 0 ? { week: input.week, placements } : null,
    hints: emptySlots,
  };
}

/** True when any *active* slot of `weekPlan` holds a `source: 'auto'` entry — drives the "Přegenerovat" button's visibility. */
export function hasAutoEntries(weekPlan: WeekPlan | undefined, activeSlots: MealSlotKey[]): boolean {
  if (!weekPlan) return false;
  const active = new Set(activeSlots);
  return ISO_DAYS.some((day) =>
    SLOT_ORDER.some((slot) => active.has(slot) && weekPlan.days[day][slot].some((e) => e.source === 'auto')),
  );
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
