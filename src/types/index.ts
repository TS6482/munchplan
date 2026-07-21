/**
 * Domain types (established here in step 3, consumed by every later step).
 *
 * Design decisions:
 * - `RecipeCategory` is typed as a string union of the six known Czech
 *   category tags widened with `(string & {})` so TypeScript still offers
 *   autocomplete for the known values while remaining extensible to
 *   user-defined categories (spec: "Category list extensible").
 * - `Effort` is stored as ASCII keys (`'quick' | 'normal' | 'hard'`) rather
 *   than the Czech labels ("rychlé" / "normální" / "náročné") used in the
 *   spec/UI copy. Storing ASCII keys keeps stored JSON stable if Czech
 *   copy is ever reworded; the UI layer maps keys to Czech labels.
 */

export type RecipeCategory = 'maso' | 'ryba' | 'vege' | 'těstoviny' | 'polévka' | 'jiné' | (string & {});

export type Effort = 'quick' | 'normal' | 'hard';

/** ASCII slot keys (feature 002); Czech UI labels live in src/components/slotLabels.ts. */
export type MealSlotKey = 'breakfast' | 'lunch' | 'dinner' | 'snack';

/** Display/iteration order for the four meal slots. */
export const SLOT_ORDER: MealSlotKey[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/**
 * Whether a recipe is a complete meal (`full`), a main needing accompaniment
 * (`main`), a side (`side`), or a salad (`salad`). Persisted from feature 002
 * onward but only consumed by the mix-and-match UI in feature 003.
 */
export type ComponentType = 'full' | 'main' | 'side' | 'salad';

/** For `main` recipes: the specific sides/salads (by recipeId) that pair with it. */
export interface Pairings {
  sides: string[];
  salads: string[];
}

export interface Ingredient {
  name: string;
  amount?: number;
  unit?: string;
}

export interface Recipe {
  id: string;
  name: string;
  ingredients: Ingredient[];
  category: RecipeCategory;
  effort: Effort;
  source?: string;
  notes?: string;
  /** Number of servings the ingredient amounts are written for. */
  portions?: number;
  untried: boolean;
  createdAt: string;
  updatedAt: string;
  /** Which meal slots this recipe fits; normalization guarantees this is never empty. */
  suitableFor: MealSlotKey[];
  componentType: ComponentType;
  pairings: Pairings;
}

/** ISO-8601 day-of-week key, Monday-first. */
export type IsoDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** ISO-8601 week string, e.g. "2026-W30". */
export type WeekKey = string;

export interface WeekPlan {
  days: Record<IsoDay, string | null>;
}

export type Plans = Record<WeekKey, WeekPlan>;

export interface Person {
  name: string;
  blocked: string[];
}

export interface DietRule {
  category: RecipeCategory;
  min?: number;
  max?: number;
}

export interface Settings {
  persons: [Person, Person];
  dietRules: DietRule[];
  rotationWeeks: number;
}

export interface SaleItem {
  name: string;
  note?: string;
}

/** An ingredient the household currently has at home, with an optional known quantity. */
export interface PantryItem {
  name: string;
  amount?: number;
  unit?: string;
}

/** Ingredients the household currently has at home. */
export type Pantry = PantryItem[];

/**
 * Stable identity for a shopping-list line: `normalize(name) + "|" +
 * normalize(unit ?? "")` (see src/engine/match.ts#itemKey). Never includes
 * amount, so check states and overrides survive plan rebuilds.
 */
export type ItemKey = string;

export interface ExtraItem {
  id: string;
  name: string;
  checked: boolean;
}

export interface WeekExtras {
  checks: Record<ItemKey, true>;
  extraItems: ExtraItem[];
  homeOverrides: Record<ItemKey, 'toHome' | 'toBuy'>;
}

export interface Extras {
  weeks: Record<WeekKey, WeekExtras>;
}

/** Every persisted data file is wrapped in this versioned envelope. */
export interface VersionedFile<T> {
  schemaVersion: 1;
  data: T;
}
