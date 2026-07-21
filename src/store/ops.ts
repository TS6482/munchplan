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
 *   (`upsertSaleItem`'s `note` field and `addPantryItem`'s `amount`/`unit`
 *   fields are replaced by the newer op's values — undefined clears them —
 *   since updating those fields is the whole point of upserting again).
 * - `upsertDietRule` is one-rule-per-category: re-applying it replaces any
 *   existing rule for that normalized category rather than duplicating it.
 */

import type {
  ComponentType,
  DayPlan,
  DietRule,
  Extras,
  ExtraItem,
  IsoDay,
  ItemKey,
  MealEntry,
  MealSlotKey,
  Pantry,
  PantryItem,
  Person,
  Plans,
  Recipe,
  SaleItem,
  Settings,
  WeekExtras,
  WeekKey,
  WeekPlan,
} from '../types';
import { SLOT_ORDER } from '../types';
import { normalizeName } from '../engine/normalize';
import { emptyDayPlan, emptyWeekPlan } from '../engine/planModel';
import { ISO_DAYS } from '../engine/week';

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
  const recipes = normalizeRecipes(data);
  switch (op.type) {
    case 'upsertRecipe': {
      const idx = recipes.findIndex((r) => r.id === op.recipe.id);
      if (idx === -1) return [...recipes, op.recipe];
      return recipes.map((r, i) => (i === idx ? op.recipe : r));
    }
    case 'deleteRecipe':
      return recipes.filter((r) => r.id !== op.id);
  }
}

const DEFAULT_SUITABLE_FOR: MealSlotKey[] = ['lunch', 'dinner'];
const VALID_SLOTS: MealSlotKey[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const VALID_COMPONENT_TYPES: ComponentType[] = ['full', 'main', 'side', 'salad'];

function normalizeSuitableFor(raw: unknown): MealSlotKey[] {
  if (!Array.isArray(raw)) return [...DEFAULT_SUITABLE_FOR];
  const valid = raw.filter((v): v is MealSlotKey => VALID_SLOTS.includes(v as MealSlotKey));
  return valid.length > 0 ? valid : [...DEFAULT_SUITABLE_FOR];
}

function normalizeComponentType(raw: unknown): ComponentType {
  return VALID_COMPONENT_TYPES.includes(raw as ComponentType) ? (raw as ComponentType) : 'full';
}

function normalizePairings(raw: unknown): Recipe['pairings'] {
  const obj = raw && typeof raw === 'object' ? (raw as Partial<Recipe['pairings']>) : {};
  return {
    sides: Array.isArray(obj.sides) ? obj.sides : [],
    salads: Array.isArray(obj.salads) ? obj.salads : [],
  };
}

/**
 * Migrates raw (possibly legacy) recipe data into `Recipe[]`: a missing or
 * invalid `suitableFor` (empty, or containing only unknown slot strings)
 * falls back to `['lunch', 'dinner']`; a mixed array keeps the valid subset.
 * An unknown/missing `componentType` becomes `'full'`; missing/partial
 * `pairings` lists default to `[]` each. Non-array input yields `[]`.
 */
export function normalizeRecipes(data: unknown): Recipe[] {
  if (!Array.isArray(data)) return [];
  return data.map((raw) => {
    const recipe = (raw ?? {}) as Partial<Recipe>;
    return {
      ...recipe,
      suitableFor: normalizeSuitableFor(recipe.suitableFor),
      componentType: normalizeComponentType(recipe.componentType),
      pairings: normalizePairings(recipe.pairings),
    } as Recipe;
  });
}

// ---------------------------------------------------------------------------
// plans.json
// ---------------------------------------------------------------------------

/** One targeted (day, slot)'s replacement auto entries for `replaceAutoEntries`. */
export interface MealPlacement {
  day: IsoDay;
  slot: MealSlotKey;
  entries: MealEntry[];
}

export type PlansOp =
  | { type: 'activateSlot'; week: WeekKey; slot: MealSlotKey }
  | { type: 'deactivateSlot'; week: WeekKey; slot: MealSlotKey }
  | { type: 'addMealEntry'; week: WeekKey; day: IsoDay; slot: MealSlotKey; entry: MealEntry }
  | { type: 'removeMealEntry'; week: WeekKey; day: IsoDay; slot: MealSlotKey; entryId: string }
  | { type: 'replaceAutoEntries'; week: WeekKey; placements: MealPlacement[] };

/** Adds `slot` to the week's `activeSlots` (idempotent). Creates the week if missing. */
export function activateSlot(week: WeekKey, slot: MealSlotKey): PlansOp {
  return { type: 'activateSlot', week, slot };
}

/** Removes `slot` from `activeSlots` and deletes that slot's entries across all seven days. */
export function deactivateSlot(week: WeekKey, slot: MealSlotKey): PlansOp {
  return { type: 'deactivateSlot', week, slot };
}

/** Appends `entry` to (week, day, slot); idempotent by `entry.id` (replaces an existing entry with the same id). */
export function addMealEntry(week: WeekKey, day: IsoDay, slot: MealSlotKey, entry: MealEntry): PlansOp {
  return { type: 'addMealEntry', week, day, slot, entry };
}

/** Filters (week, day, slot) by `entryId`; a missing id is a no-op. */
export function removeMealEntry(week: WeekKey, day: IsoDay, slot: MealSlotKey, entryId: string): PlansOp {
  return { type: 'removeMealEntry', week, day, slot, entryId };
}

/** One PUT for a whole auto-fill/reroll pass: per targeted slot, keeps manual entries and replaces auto entries. */
export function replaceAutoEntries(week: WeekKey, placements: MealPlacement[]): PlansOp {
  return { type: 'replaceAutoEntries', week, placements };
}

/** Slot list in display order, deduplicated. */
function sortSlots(slots: MealSlotKey[]): MealSlotKey[] {
  const set = new Set(slots);
  return SLOT_ORDER.filter((s) => set.has(s));
}

function normalizeMealEntry(raw: unknown): MealEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Partial<MealEntry>;
  if (typeof entry.id !== 'string') return null;
  if (!Array.isArray(entry.recipeIds) || !entry.recipeIds.every((id) => typeof id === 'string')) return null;
  if (entry.source !== 'auto' && entry.source !== 'manual') return null;
  return { id: entry.id, recipeIds: [...entry.recipeIds], source: entry.source };
}

function normalizeDayPlan(raw: unknown): DayPlan {
  const obj = raw && typeof raw === 'object' ? (raw as Partial<Record<MealSlotKey, unknown>>) : {};
  const day = {} as DayPlan;
  for (const slot of SLOT_ORDER) {
    const rawEntries = obj[slot];
    day[slot] = Array.isArray(rawEntries)
      ? rawEntries.map(normalizeMealEntry).filter((e): e is MealEntry => e !== null)
      : [];
  }
  return day;
}

/** A migrated legacy day: its one recipeId becomes a manual dinner entry with a deterministic id. */
function legacyDinnerDay(week: WeekKey, day: IsoDay, recipeId: string): DayPlan {
  return {
    ...emptyDayPlan(),
    dinner: [{ id: `legacy-${week}-${day}`, recipeIds: [recipeId], source: 'manual' }],
  };
}

/** Union of slots holding at least one entry, SLOT_ORDER-sorted, falling back to `['dinner']`. */
function unionActiveSlots(days: Record<IsoDay, DayPlan>): MealSlotKey[] {
  const withEntries = new Set<MealSlotKey>();
  for (const day of ISO_DAYS) {
    for (const slot of SLOT_ORDER) {
      if (days[day][slot].length > 0) withEntries.add(slot);
    }
  }
  const union = sortSlots([...withEntries]);
  return union.length > 0 ? union : ['dinner'];
}

function normalizeWeek(raw: unknown, week: WeekKey): WeekPlan {
  const weekObj = raw && typeof raw === 'object' ? (raw as { activeSlots?: unknown; days?: unknown }) : {};
  const rawDays = weekObj.days && typeof weekObj.days === 'object' ? (weekObj.days as Record<string, unknown>) : {};

  const days = {} as Record<IsoDay, DayPlan>;
  for (const day of ISO_DAYS) {
    const rawDay = rawDays[day];
    if (typeof rawDay === 'string') {
      days[day] = legacyDinnerDay(week, day, rawDay);
    } else if (rawDay == null) {
      days[day] = emptyDayPlan();
    } else {
      days[day] = normalizeDayPlan(rawDay);
    }
  }

  let activeSlots: MealSlotKey[];
  if (Array.isArray(weekObj.activeSlots)) {
    if (weekObj.activeSlots.length === 0) {
      // An explicitly stored empty selection is a valid "away week" (decision 6) — respected, not re-derived.
      activeSlots = [];
    } else {
      const valid = sortSlots(weekObj.activeSlots.filter((s): s is MealSlotKey => SLOT_ORDER.includes(s as MealSlotKey)));
      activeSlots = valid.length > 0 ? valid : unionActiveSlots(days);
    }
  } else {
    activeSlots = unionActiveSlots(days);
  }

  return { activeSlots, days };
}

/**
 * Migrates raw (possibly legacy, possibly per-day mixed-shape) plan data into
 * `Plans`. Old-shape detection happens per **day value**, not per file: a
 * `string` day -> one deterministic-id (`legacy-{week}-{day}`) manual dinner
 * entry; `null`/missing -> empty slots; an object -> a validated `DayPlan`
 * (missing slot keys -> `[]`, malformed entries dropped: an entry needs a
 * string `id`, an array of string `recipeIds`, and `source` `'auto'` or
 * `'manual'`, else it's dropped). A week missing (or invalid) `activeSlots`
 * derives it as the union of slots holding entries, falling back to
 * `['dinner']`. Never throws on garbage; a non-object file yields `{}`.
 */
export function normalizePlans(data: unknown): Plans {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const result: Plans = {};
  for (const [week, rawWeek] of Object.entries(data as Record<string, unknown>)) {
    result[week] = normalizeWeek(rawWeek, week);
  }
  return result;
}

export function applyPlansOp(op: PlansOp, data: Plans): Plans {
  const plans = normalizePlans(data);

  switch (op.type) {
    case 'activateSlot': {
      const base = plans[op.week] ?? emptyWeekPlan([]);
      const activeSlots = sortSlots([...base.activeSlots, op.slot]);
      return { ...plans, [op.week]: { ...base, activeSlots } };
    }
    case 'deactivateSlot': {
      const base = plans[op.week];
      if (!base) return plans;
      const activeSlots = base.activeSlots.filter((s) => s !== op.slot);
      const days = { ...base.days };
      for (const day of ISO_DAYS) {
        days[day] = { ...days[day], [op.slot]: [] };
      }
      return { ...plans, [op.week]: { activeSlots, days } };
    }
    case 'addMealEntry': {
      const base = plans[op.week] ?? emptyWeekPlan([op.slot]);
      const slotEntries = base.days[op.day][op.slot];
      const idx = slotEntries.findIndex((e) => e.id === op.entry.id);
      const newSlotEntries =
        idx === -1 ? [...slotEntries, op.entry] : slotEntries.map((e, i) => (i === idx ? op.entry : e));
      const days = { ...base.days, [op.day]: { ...base.days[op.day], [op.slot]: newSlotEntries } };
      return { ...plans, [op.week]: { ...base, days } };
    }
    case 'removeMealEntry': {
      const base = plans[op.week];
      if (!base) return plans;
      const slotEntries = base.days[op.day][op.slot];
      const filtered = slotEntries.filter((e) => e.id !== op.entryId);
      const days = { ...base.days, [op.day]: { ...base.days[op.day], [op.slot]: filtered } };
      return { ...plans, [op.week]: { ...base, days } };
    }
    case 'replaceAutoEntries': {
      const targetedSlots = sortSlots(op.placements.map((p) => p.slot));
      const base = plans[op.week] ?? emptyWeekPlan(targetedSlots);
      let days = base.days;
      for (const placement of op.placements) {
        const manual = days[placement.day][placement.slot].filter((e) => e.source === 'manual');
        days = {
          ...days,
          [placement.day]: { ...days[placement.day], [placement.slot]: [...manual, ...placement.entries] },
        };
      }
      return { ...plans, [op.week]: { ...base, days } };
    }
  }
}

// ---------------------------------------------------------------------------
// pantry.json
// ---------------------------------------------------------------------------

export type PantryOp =
  | { type: 'addPantryItem'; name: string; amount?: number; unit?: string }
  | { type: 'removePantryItem'; name: string }
  | { type: 'setPantry'; items: Pantry };

export function addPantryItem(name: string, amount?: number, unit?: string): PantryOp {
  return { type: 'addPantryItem', name, amount, unit };
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
      const idx = data.findIndex((item) => normalizeName(item.name) === norm);
      // Newer op wins on amount/unit (an undefined value clears the field);
      // the already-stored display spelling is kept on update.
      const updated: PantryItem = { name: idx === -1 ? op.name : data[idx].name };
      if (op.amount !== undefined) updated.amount = op.amount;
      if (op.unit !== undefined) updated.unit = op.unit;
      if (idx === -1) return [...data, updated];
      return data.map((item, i) => (i === idx ? updated : item));
    }
    case 'removePantryItem': {
      const norm = normalizeName(op.name);
      return data.filter((item) => normalizeName(item.name) !== norm);
    }
    case 'setPantry':
      return [...op.items];
  }
}

/**
 * Migrates raw (possibly legacy) pantry data into `PantryItem[]`: legacy
 * string entries become `{ name }`, well-formed objects pass through
 * unchanged, and anything else unparseable (not a string, missing/non-string
 * `name`) is dropped. Non-array input yields an empty pantry.
 */
export function normalizePantry(data: unknown): PantryItem[] {
  if (!Array.isArray(data)) return [];
  const result: PantryItem[] = [];
  for (const entry of data) {
    if (typeof entry === 'string') {
      result.push({ name: entry });
      continue;
    }
    if (entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string') {
      const { name, amount, unit } = entry as { name: string; amount?: unknown; unit?: unknown };
      const item: PantryItem = { name };
      if (typeof amount === 'number') item.amount = amount;
      if (typeof unit === 'string') item.unit = unit;
      result.push(item);
    }
  }
  return result;
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

export const EMPTY_WEEK_EXTRAS: WeekExtras = { checks: {}, extraItems: [], homeOverrides: {} };

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
