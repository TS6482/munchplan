/**
 * Pure view-model for the meal detail page (feature 002, step 9) — no React,
 * no store, no fetch. Wraps engine functions (week/autoFill) and recipe
 * lookups into shapes MealDetailPage renders directly.
 */

import type { IsoDay, MealEntry, MealSlotKey, Plans, Recipe, SaleItem, Settings, WeekKey, WeekPlan } from '../../types';
import { dateOfDay } from '../../engine/week';
import { buildAutoFill, type AutoFillPlacement } from '../../engine/autoFill';
import { composeEntry, isBlockedForAnyone, pairedSides, pairedSalads, validPairedSides } from '../../engine/composition';
import { COMPONENT_TYPE_LABELS } from '../../components/componentTypeLabels';
import { formatPortions } from '../recipes/recipeFormLogic';
import { SLOT_LABELS } from '../../components/slotLabels';
import { routeHash } from '../../router/router';
import { DAY_LABELS, UNPAIRED_MAIN_HINT, czechDate } from './planLogic';

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export interface MealHeader {
  dayLabel: string;
  dateText: string;
  slotLabel: string;
  backHash: string;
}

/** Czech day/date/slot header for the meal detail page, with a week-scoped back link. */
export function mealHeader(week: WeekKey, day: IsoDay, slot: MealSlotKey): MealHeader {
  return {
    dayLabel: DAY_LABELS[day],
    dateText: czechDate(dateOfDay(week, day)),
    slotLabel: SLOT_LABELS[slot],
    backHash: routeHash({ name: 'plan', week }),
  };
}

// ---------------------------------------------------------------------------
// Entry rows
// ---------------------------------------------------------------------------

export interface RecipeLink {
  id: string;
  name: string;
  deleted: boolean;
}

/** index 0 removal deletes the whole entry; a non-primary component's removal narrows `recipeIds`. */
export type ComponentRemoval = { kind: 'entry' } | { kind: 'component'; nextRecipeIds: string[] };

export interface ComponentRow {
  id: string;
  name: string;
  deleted: boolean;
  /** Czech component-type label (role of the RESOLVED recipe, not position); `null` for a deleted or opaque (re-typed away from side/salad) non-primary component. */
  roleLabel: string | null;
  removal: ComponentRemoval;
}

export interface EntryRow {
  entryId: string;
  displayName: string;
  recipeLinks: RecipeLink[];
  components: ComponentRow[];
  untriedBadge: boolean;
  portionsText: string | null;
  source: 'auto' | 'manual';
}

/**
 * Classifies a non-primary component by its RESOLVED recipe's current
 * `componentType` (plan step 7, pinned classification rule): a recipeId that
 * doesn't resolve (deleted) or resolves to neither `side` nor `salad`
 * (re-typed) is `'opaque'` — the escape hatch, no role label.
 */
function classifyComponent(recipeId: string, recipes: Recipe[]): 'side' | 'salad' | 'opaque' {
  const recipe = recipes.find((r) => r.id === recipeId);
  if (!recipe) return 'opaque';
  if (recipe.componentType === 'side' || recipe.componentType === 'salad') return recipe.componentType;
  return 'opaque';
}

function buildComponents(recipeIds: string[], byId: Map<string, Recipe>): ComponentRow[] {
  return recipeIds.map((id, index) => {
    const recipe = byId.get(id);
    const deleted = !recipe;
    const name = recipe ? recipe.name : 'smazaný recept';

    let roleLabel: string | null = null;
    if (recipe) {
      if (index === 0) {
        // "samostatné jídlo" on every plain entry is noise — label the primary only when it says something.
        roleLabel = recipe.componentType === 'full' ? null : COMPONENT_TYPE_LABELS[recipe.componentType];
      } else if (recipe.componentType === 'side' || recipe.componentType === 'salad') {
        roleLabel = COMPONENT_TYPE_LABELS[recipe.componentType];
      }
    }

    const removal: ComponentRemoval =
      index === 0 ? { kind: 'entry' } : { kind: 'component', nextRecipeIds: recipeIds.filter((_, i) => i !== index) };

    return { id, name, deleted, roleLabel, removal };
  });
}

/**
 * Per-entry rows for (day, slot) of `weekPlan` — resolves recipe names,
 * per-recipe detail links (a deleted recipeId falls back to "smazaný
 * recept"), an untried badge (true if any recipe in the entry is untried),
 * and portions text (single-recipe entries only; multi-recipe entries keep
 * it `null` — kept simple per plan). A missing week or empty slot yields [].
 */
export function entryRows(weekPlan: WeekPlan | undefined, day: IsoDay, slot: MealSlotKey, recipes: Recipe[]): EntryRow[] {
  const entries = weekPlan?.days[day][slot] ?? [];
  const byId = new Map(recipes.map((r) => [r.id, r]));

  return entries.map((entry) => {
    const recipeLinks: RecipeLink[] = entry.recipeIds.map((id) => {
      const recipe = byId.get(id);
      return recipe ? { id, name: recipe.name, deleted: false } : { id, name: 'smazaný recept', deleted: true };
    });

    const untriedBadge = entry.recipeIds.some((id) => byId.get(id)?.untried === true);

    let portionsText: string | null = null;
    if (entry.recipeIds.length === 1) {
      const recipe = byId.get(entry.recipeIds[0]);
      if (recipe?.portions) portionsText = formatPortions(recipe.portions);
    }

    return {
      entryId: entry.id,
      displayName: recipeLinks.map((l) => l.name).join(' + '),
      recipeLinks,
      components: buildComponents(entry.recipeIds, byId),
      untriedBadge,
      portionsText,
      source: entry.source,
    };
  });
}

// ---------------------------------------------------------------------------
// New manual entry
// ---------------------------------------------------------------------------

/** A manual single-recipe entry; id from the injected `idFn` (default `crypto.randomUUID` in the component layer). */
export function newManualEntry(recipeId: string, idFn: () => string): MealEntry {
  return { id: idFn(), recipeIds: [recipeId], source: 'manual' };
}

/**
 * Composes a new entry from a ranked suggestion pick (decision 5: the
 * suggestion "Přidat" path, unlike the bare picker path above): delegates to
 * `composeEntry` — a paired main lands `[main, side]`, anything else lands
 * bare, single-recipe, `source: 'manual'`. A `recipeId` absent from `recipes`
 * (defensive) also lands bare.
 */
export function newPlannedEntry(
  recipeId: string,
  recipes: Recipe[],
  sales: SaleItem[],
  settings: Settings,
  rng: () => number,
  idFn: () => string,
): MealEntry {
  const recipe = recipes.find((r) => r.id === recipeId);
  if (!recipe) return { id: idFn(), recipeIds: [recipeId], source: 'manual' };
  return composeEntry(recipe, recipes, sales, settings, rng, idFn, 'manual');
}

// ---------------------------------------------------------------------------
// Composition controls: swap side / add salad / unpaired-main hint
// ---------------------------------------------------------------------------

/**
 * The non-primary component `recipeIds` index a side swap should replace:
 * the first `side`-classified component; else the first `opaque` one
 * (positional fallback, per the `[main, side, salad?]` invariant); else
 * `null` (append — "add side" when nothing is replaceable). A `salad`
 * classified component is never a replacement target.
 */
function findSwapTargetIndex(recipeIds: string[], recipes: Recipe[]): number | null {
  let opaqueIndex: number | null = null;
  for (let i = 1; i < recipeIds.length; i++) {
    const cls = classifyComponent(recipeIds[i], recipes);
    if (cls === 'side') return i;
    if (cls === 'opaque' && opaqueIndex === null) opaqueIndex = i;
  }
  return opaqueIndex;
}

export interface SwapSideOption {
  id: string;
  name: string;
  current: boolean;
  blocked: boolean;
  nextRecipeIds: string[];
}

/**
 * "Vyměnit přílohu" options: only when `recipeIds[0]` resolves to a `main`
 * with >=1 paired side (`pairedSides`, unfiltered by blocked — blocked ones
 * are flagged, not hidden, same as any manual pick). Each option carries the
 * `recipeIds` the entry would become if picked (`findSwapTargetIndex`); the
 * option matching the entry's current side-classified component (if any) is
 * marked `current` — a stale current (deleted/re-typed) leaves none marked,
 * since that component no longer classifies as `'side'`.
 */
export function swapSide(entry: MealEntry, recipes: Recipe[], settings: Settings): SwapSideOption[] {
  const main = recipes.find((r) => r.id === entry.recipeIds[0]);
  if (!main || main.componentType !== 'main') return [];
  const sides = pairedSides(main, recipes);
  if (sides.length === 0) return [];

  const targetIndex = findSwapTargetIndex(entry.recipeIds, recipes);
  const currentSideId =
    targetIndex !== null && classifyComponent(entry.recipeIds[targetIndex], recipes) === 'side'
      ? entry.recipeIds[targetIndex]
      : undefined;

  return sides.map((side) => ({
    id: side.id,
    name: side.name,
    current: side.id === currentSideId,
    blocked: isBlockedForAnyone(side, settings),
    nextRecipeIds:
      targetIndex !== null
        ? entry.recipeIds.map((id, i) => (i === targetIndex ? side.id : id))
        : // Insert at index 1, not append — keeps the documented [main, side, salad?] order
          // when a side is added to an entry that already holds a salad.
          [entry.recipeIds[0], side.id, ...entry.recipeIds.slice(1)],
  }));
}

export interface AddSaladOption {
  id: string;
  name: string;
  nextRecipeIds: string[];
}

/**
 * "Přidat salát" options: only when `recipeIds[0]` resolves to a `main` with
 * >=1 paired salad and the entry doesn't already hold a `salad`-classified
 * component (an opaque component never suppresses the offer). One-tap:
 * always appends.
 */
export function addSalad(entry: MealEntry, recipes: Recipe[]): AddSaladOption[] {
  const main = recipes.find((r) => r.id === entry.recipeIds[0]);
  if (!main || main.componentType !== 'main') return [];
  const salads = pairedSalads(main, recipes);
  if (salads.length === 0) return [];
  const hasSalad = entry.recipeIds.slice(1).some((id) => classifyComponent(id, recipes) === 'salad');
  if (hasSalad) return [];

  return salads.map((salad) => ({ id: salad.id, name: salad.name, nextRecipeIds: [...entry.recipeIds, salad.id] }));
}

export interface UnpairedMainHint {
  text: string;
  editHref: string;
}

/**
 * Planned-entry hint for a `main` with zero valid paired sides — same
 * predicate (`validPairedSides`) as the ranking exclusion and the picker's
 * `unpairedMain` warning (design decision 4), so they can never disagree. A
 * deleted primary yields no hint (no composition controls at all).
 */
export function unpairedMainHint(entry: MealEntry, recipes: Recipe[], settings: Settings): UnpairedMainHint | null {
  const main = recipes.find((r) => r.id === entry.recipeIds[0]);
  if (!main || main.componentType !== 'main') return null;
  if (validPairedSides(main, recipes, settings).length > 0) return null;
  return { text: UNPAIRED_MAIN_HINT, editHref: routeHash({ name: 'recipe', id: main.id }) };
}

// ---------------------------------------------------------------------------
// Reroll this slot
// ---------------------------------------------------------------------------

export interface RerollInput {
  recipes: Recipe[];
  plans: Plans;
  sales: SaleItem[];
  settings: Settings;
  week: WeekKey;
}

export interface RerollResult {
  placements: AutoFillPlacement[];
  hasTargets: boolean;
}

/**
 * Rerolls a single (day, slot) via `buildAutoFill`'s single-target reroll
 * mode. A slot holding only manual entries (no `source: 'auto'` entries) is
 * not a reroll target -> `hasTargets: false`, `placements: []` — the UI shows
 * a Czech notice ("Slot nemá automaticky doplněná jídla") instead of issuing
 * a `replaceAutoEntries` op.
 */
export function rerollSlot(input: RerollInput, day: IsoDay, slot: MealSlotKey, rng: () => number, idFn: () => string): RerollResult {
  const { placements } = buildAutoFill({
    ...input,
    mode: { kind: 'reroll', only: { day, slot } },
    rng,
    idFn,
  });
  return { placements, hasTargets: placements.length > 0 };
}
