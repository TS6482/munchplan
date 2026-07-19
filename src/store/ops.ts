/**
 * Operation types + pure `apply(op, data)` functions — one discriminated
 * union and one apply function per data file (step 9, the conflict-merge
 * contract's core: see plan.md "Conflict-merge contract").
 *
 * Every `apply*` function is pure and immutable: it never mutates its `data`
 * argument, always returning a new value. This is what makes the retry
 * contract in `saveWithRetry` safe — `apply(op, remoteData)` re-derives the
 * local intent on top of whatever the remote turned out to be, instead of
 * unioning two whole-file snapshots.
 *
 * Design decisions (documented merge semantics, not bugs):
 * - `upsertRecipe` is last-write-wins on the same id: re-applying it after a
 *   conflict replaces whatever the remote has for that id with the local
 *   version in full.
 * - `clearSales` always yields `[]`, even re-applied on a remote that
 *   concurrently gained an item — "clear" was the later local intent.
 * - `addPantryItem`/`upsertSaleItem` dedupe by normalized name but preserve
 *   the *already-stored* display spelling when an entry already exists
 *   (only `upsertSaleItem`'s `note` field is replaced by the newer op's
 *   value, since editing the note is the whole point of upserting again).
 * - `upsertDietRule` is one-rule-per-category: re-applying it replaces any
 *   existing rule for that normalized category rather than duplicating it.
 */

import type {
  DietRule,
  Extras,
  ExtraItem,
  IsoDay,
  ItemKey,
  Pantry,
  Person,
  Plans,
  Recipe,
  SaleItem,
  Settings,
  WeekExtras,
  WeekKey,
} from '../types';
import { normalizeName } from '../engine/normalize';

// ---------------------------------------------------------------------------
// recipes.json
// ---------------------------------------------------------------------------

export type RecipeOp = { type: 'upsertRecipe'; recipe: Recipe } | { type: 'deleteRecipe'; id: string };

export function upsertRecipe(recipe: Recipe): RecipeOp {
  return { type: 'upsertRecipe', recipe };
}

export function deleteRecipe(id: string): RecipeOp {
  return { type: 'deleteRecipe', id };
}

export function applyRecipesOp(op: RecipeOp, data: Recipe[]): Recipe[] {
  switch (op.type) {
    case 'upsertRecipe': {
      const idx = data.findIndex((r) => r.id === op.recipe.id);
      if (idx === -1) return [...data, op.recipe];
      return data.map((r, i) => (i === idx ? op.recipe : r));
    }
    case 'deleteRecipe':
      return data.filter((r) => r.id !== op.id);
  }
}

// ---------------------------------------------------------------------------
// plans.json
// ---------------------------------------------------------------------------

export type PlansOp = { type: 'assignDay'; week: WeekKey; day: IsoDay; recipeId: string | null };

export function assignDay(week: WeekKey, day: IsoDay, recipeId: string | null): PlansOp {
  return { type: 'assignDay', week, day, recipeId };
}

const EMPTY_WEEK_DAYS: Record<IsoDay, string | null> = {
  mon: null,
  tue: null,
  wed: null,
  thu: null,
  fri: null,
  sat: null,
  sun: null,
};

export function applyPlansOp(op: PlansOp, data: Plans): Plans {
  const existing = data[op.week];
  const days = { ...(existing ? existing.days : EMPTY_WEEK_DAYS), [op.day]: op.recipeId };
  return { ...data, [op.week]: { days } };
}

// ---------------------------------------------------------------------------
// pantry.json
// ---------------------------------------------------------------------------

export type PantryOp =
  | { type: 'addPantryItem'; name: string }
  | { type: 'removePantryItem'; name: string }
  | { type: 'setPantry'; items: Pantry };

export function addPantryItem(name: string): PantryOp {
  return { type: 'addPantryItem', name };
}

export function removePantryItem(name: string): PantryOp {
  return { type: 'removePantryItem', name };
}

/** Used only by first-run seeding (see src/store/data.ts). */
export function setPantry(items: Pantry): PantryOp {
  return { type: 'setPantry', items };
}

export function applyPantryOp(op: PantryOp, data: Pantry): Pantry {
  switch (op.type) {
    case 'addPantryItem': {
      const norm = normalizeName(op.name);
      if (data.some((item) => normalizeName(item) === norm)) return data;
      return [...data, op.name];
    }
    case 'removePantryItem': {
      const norm = normalizeName(op.name);
      return data.filter((item) => normalizeName(item) !== norm);
    }
    case 'setPantry':
      return [...op.items];
  }
}

// ---------------------------------------------------------------------------
// sales.json
// ---------------------------------------------------------------------------

export type SalesOp =
  | { type: 'upsertSaleItem'; name: string; note?: string }
  | { type: 'removeSaleItem'; name: string }
  | { type: 'clearSales' };

export function upsertSaleItem(name: string, note?: string): SalesOp {
  return { type: 'upsertSaleItem', name, note };
}

export function removeSaleItem(name: string): SalesOp {
  return { type: 'removeSaleItem', name };
}

export function clearSales(): SalesOp {
  return { type: 'clearSales' };
}

export function applySalesOp(op: SalesOp, data: SaleItem[]): SaleItem[] {
  switch (op.type) {
    case 'upsertSaleItem': {
      const norm = normalizeName(op.name);
      const idx = data.findIndex((s) => normalizeName(s.name) === norm);
      if (idx === -1) {
        return [...data, op.note !== undefined ? { name: op.name, note: op.note } : { name: op.name }];
      }
      return data.map((s, i) =>
        i === idx ? (op.note !== undefined ? { name: s.name, note: op.note } : { name: s.name }) : s,
      );
    }
    case 'removeSaleItem': {
      const norm = normalizeName(op.name);
      return data.filter((s) => normalizeName(s.name) !== norm);
    }
    case 'clearSales':
      return [];
  }
}

// ---------------------------------------------------------------------------
// settings.json
// ---------------------------------------------------------------------------

export type SettingsOp =
  | { type: 'setPersonName'; idx: 0 | 1; name: string }
  | { type: 'setBlockedList'; idx: 0 | 1; blocked: string[] }
  | { type: 'upsertDietRule'; category: string; min?: number; max?: number }
  | { type: 'removeDietRule'; category: string }
  | { type: 'setRotationWeeks'; weeks: number };

export function setPersonName(idx: 0 | 1, name: string): SettingsOp {
  return { type: 'setPersonName', idx, name };
}

export function setBlockedList(idx: 0 | 1, blocked: string[]): SettingsOp {
  return { type: 'setBlockedList', idx, blocked };
}

export function upsertDietRule(category: string, min?: number, max?: number): SettingsOp {
  return { type: 'upsertDietRule', category, min, max };
}

export function removeDietRule(category: string): SettingsOp {
  return { type: 'removeDietRule', category };
}

export function setRotationWeeks(weeks: number): SettingsOp {
  return { type: 'setRotationWeeks', weeks };
}

function withPerson(persons: [Person, Person], idx: 0 | 1, patch: Partial<Person>): [Person, Person] {
  const next: [Person, Person] = [{ ...persons[0] }, { ...persons[1] }];
  next[idx] = { ...next[idx], ...patch };
  return next;
}

export function applySettingsOp(op: SettingsOp, data: Settings): Settings {
  switch (op.type) {
    case 'setPersonName':
      return { ...data, persons: withPerson(data.persons, op.idx, { name: op.name }) };
    case 'setBlockedList':
      return { ...data, persons: withPerson(data.persons, op.idx, { blocked: [...op.blocked] }) };
    case 'upsertDietRule': {
      const norm = normalizeName(op.category);
      const rule: DietRule = { category: op.category, min: op.min, max: op.max };
      const idx = data.dietRules.findIndex((r) => normalizeName(r.category) === norm);
      const dietRules = idx === -1 ? [...data.dietRules, rule] : data.dietRules.map((r, i) => (i === idx ? rule : r));
      return { ...data, dietRules };
    }
    case 'removeDietRule': {
      const norm = normalizeName(op.category);
      return { ...data, dietRules: data.dietRules.filter((r) => normalizeName(r.category) !== norm) };
    }
    case 'setRotationWeeks':
      return { ...data, rotationWeeks: op.weeks };
  }
}

// ---------------------------------------------------------------------------
// extras.json
// ---------------------------------------------------------------------------

export type ExtrasOp =
  | { type: 'setCheck'; week: WeekKey; itemKey: ItemKey; checked: boolean }
  | { type: 'addExtraItem'; week: WeekKey; item: ExtraItem }
  | { type: 'removeExtraItem'; week: WeekKey; id: string }
  | { type: 'setExtraChecked'; week: WeekKey; id: string; checked: boolean }
  | { type: 'setHomeOverride'; week: WeekKey; itemKey: ItemKey; override: 'toHome' | 'toBuy' | null };

export function setCheck(week: WeekKey, itemKey: ItemKey, checked: boolean): ExtrasOp {
  return { type: 'setCheck', week, itemKey, checked };
}

export function addExtraItem(week: WeekKey, item: ExtraItem): ExtrasOp {
  return { type: 'addExtraItem', week, item };
}

export function removeExtraItem(week: WeekKey, id: string): ExtrasOp {
  return { type: 'removeExtraItem', week, id };
}

export function setExtraChecked(week: WeekKey, id: string, checked: boolean): ExtrasOp {
  return { type: 'setExtraChecked', week, id, checked };
}

export function setHomeOverride(week: WeekKey, itemKey: ItemKey, override: 'toHome' | 'toBuy' | null): ExtrasOp {
  return { type: 'setHomeOverride', week, itemKey, override };
}

const EMPTY_WEEK_EXTRAS: WeekExtras = { checks: {}, extraItems: [], homeOverrides: {} };

function withWeek(data: Extras, week: WeekKey, weekExtras: WeekExtras): Extras {
  return { weeks: { ...data.weeks, [week]: weekExtras } };
}

export function applyExtrasOp(op: ExtrasOp, data: Extras): Extras {
  const weekExtras = data.weeks[op.week] ?? EMPTY_WEEK_EXTRAS;
  switch (op.type) {
    case 'setCheck': {
      const checks = { ...weekExtras.checks };
      if (op.checked) checks[op.itemKey] = true;
      else delete checks[op.itemKey];
      return withWeek(data, op.week, { ...weekExtras, checks });
    }
    case 'addExtraItem':
      return withWeek(data, op.week, { ...weekExtras, extraItems: [...weekExtras.extraItems, op.item] });
    case 'removeExtraItem':
      return withWeek(data, op.week, {
        ...weekExtras,
        extraItems: weekExtras.extraItems.filter((i) => i.id !== op.id),
      });
    case 'setExtraChecked':
      return withWeek(data, op.week, {
        ...weekExtras,
        extraItems: weekExtras.extraItems.map((i) => (i.id === op.id ? { ...i, checked: op.checked } : i)),
      });
    case 'setHomeOverride': {
      const homeOverrides = { ...weekExtras.homeOverrides };
      if (op.override === null) delete homeOverrides[op.itemKey];
      else homeOverrides[op.itemKey] = op.override;
      return withWeek(data, op.week, { ...weekExtras, homeOverrides });
    }
  }
}

// ---------------------------------------------------------------------------
// Per-file registry (consumed by src/store/data.ts)
// ---------------------------------------------------------------------------

export interface FileDataMap {
  recipes: Recipe[];
  plans: Plans;
  pantry: Pantry;
  sales: SaleItem[];
  settings: Settings;
  extras: Extras;
}

export interface FileOpMap {
  recipes: RecipeOp;
  plans: PlansOp;
  pantry: PantryOp;
  sales: SalesOp;
  settings: SettingsOp;
  extras: ExtrasOp;
}

export type FileKey = keyof FileDataMap;
