/**
 * Pure helpers for the recipe CRUD + "vyzkoušet" inbox screens (step 11) —
 * no React, no store, no fetch. Kept in a plain `.ts` module so it stays
 * testable under Vitest's node environment.
 */

import type { ComponentType, Effort, Ingredient, MealSlotKey, Pairings, Recipe, RecipeCategory } from '../../types';
import { SLOT_ORDER } from '../../types';
import { normalizeName } from '../../engine/normalize';
import { pairedSalads, pairedSides } from '../../engine/composition';

// ---------------------------------------------------------------------------
// Form shape
// ---------------------------------------------------------------------------

export interface IngredientFormRow {
  name: string;
  amountStr: string;
  unit: string;
}

export interface FormValues {
  name: string;
  category: string;
  effort: Effort;
  source: string;
  notes: string;
  portionsStr: string;
  ingredients: IngredientFormRow[];
  suitableFor: MealSlotKey[];
  componentType: ComponentType;
  pairings: Pairings;
}

/** Default form values for a brand-new recipe: samostatné jídlo, no pairings. */
export function emptyForm(): FormValues {
  return {
    name: '',
    category: 'jiné',
    effort: 'normal',
    source: '',
    notes: '',
    portionsStr: '2',
    ingredients: [{ name: '', amountStr: '', unit: '' }],
    suitableFor: ['lunch', 'dinner'],
    componentType: 'full',
    pairings: { sides: [], salads: [] },
  };
}

/** A validated recipe payload, still missing the persistence fields id/createdAt/updatedAt. */
export const EFFORT_LABELS: Record<Effort, string> = {
  quick: 'rychlé',
  normal: 'normální',
  hard: 'náročné',
};

export interface RecipeDraft {
  name: string;
  category: RecipeCategory;
  effort: Effort;
  source?: string;
  notes?: string;
  portions?: number;
  ingredients: Ingredient[];
  untried: boolean;
  suitableFor: MealSlotKey[];
  componentType: ComponentType;
  pairings: Pairings;
}

export interface FullFormErrors {
  name?: string;
  portions?: string;
  ingredients?: string;
  ingredientErrors?: Record<number, string>;
  suitableFor?: string;
}

export type FullFormResult = { ok: true; recipe: RecipeDraft } | { ok: false; errors: FullFormErrors };

// ---------------------------------------------------------------------------
// Amount parsing / formatting
// ---------------------------------------------------------------------------

/**
 * `''` → no amount given; a positive number (Czech comma or dot decimal
 * accepted) → that number; anything else (non-numeric, negative, zero) →
 * `'invalid'` (zero is meaningless as an ingredient amount).
 */
export function parseAmount(raw: string): number | undefined | 'invalid' {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const normalized = trimmed.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return 'invalid';
  const n = Number(normalized);
  if (n <= 0) return 'invalid';
  return n;
}

/** Czech display: dot → comma, floating-point noise rounded away. */
export function formatAmount(n: number): string {
  const rounded = Math.round(n * 1000) / 1000;
  return rounded.toString().replace('.', ',');
}

/** Portion counts offered by the dropdown. */
export const PORTION_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);

/**
 * `''` → no portion count given; a whole number 1–10 → that number;
 * anything else (zero, negative, decimal, text, >10) → `'invalid'`.
 */
export function parsePortions(raw: string): number | undefined | 'invalid' {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  if (!/^\d+$/.test(trimmed)) return 'invalid';
  const n = Number(trimmed);
  if (n < 1 || n > 10) return 'invalid';
  return n;
}

/** Czech plural: 1 porce, 2–4 porce, 5+ porcí. */
export function formatPortions(n: number): string {
  return `${n} ${n >= 5 ? 'porcí' : 'porce'}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Full recipe form: name required, at least one named ingredient, all amounts parseable. */
export function validateFullForm(values: FormValues): FullFormResult {
  const errors: FullFormErrors = {};
  const name = values.name.trim();
  if (!name) errors.name = 'Vyplňte název receptu';

  const portions = parsePortions(values.portionsStr);
  if (portions === 'invalid') errors.portions = 'Počet porcí musí být celé číslo od 1 do 10';
  else if (portions === undefined) errors.portions = 'Vyberte počet porcí';

  const ingredients: Ingredient[] = [];
  const ingredientErrors: Record<number, string> = {};

  values.ingredients.forEach((row, i) => {
    const rowName = row.name.trim();
    const amountStr = row.amountStr.trim();
    const unit = row.unit.trim();
    if (!rowName && !amountStr && !unit) return; // trailing blank row — drop silently

    if (!rowName) {
      ingredientErrors[i] = 'Vyplňte název ingredience';
      return;
    }
    const amount = parseAmount(row.amountStr);
    if (amount === 'invalid') {
      ingredientErrors[i] = 'Neplatné množství';
      return;
    }
    const ingredient: Ingredient = { name: rowName };
    if (amount !== undefined) ingredient.amount = amount;
    if (unit) ingredient.unit = unit;
    ingredients.push(ingredient);
  });

  if (ingredients.length === 0) errors.ingredients = 'Přidejte alespoň jednu ingredienci';
  if (Object.keys(ingredientErrors).length > 0) errors.ingredientErrors = ingredientErrors;

  if (values.suitableFor.length === 0) errors.suitableFor = 'Vyberte alespoň jeden typ jídla';

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    recipe: {
      name,
      category: values.category.trim(),
      effort: values.effort,
      source: values.source.trim() || undefined,
      notes: values.notes.trim() || undefined,
      portions: typeof portions === 'number' ? portions : undefined,
      ingredients,
      untried: false,
      suitableFor: values.suitableFor,
      componentType: values.componentType,
      pairings: values.pairings,
    },
  };
}

/** Minimal inbox form: name required only (~15 s flow); no ingredients, untried, always full. */
export function validateQuickAdd(name: string, source: string): FullFormResult {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, errors: { name: 'Vyplňte název receptu' } };
  return {
    ok: true,
    recipe: {
      name: trimmed,
      category: 'jiné',
      effort: 'normal',
      source: source.trim() || undefined,
      notes: undefined,
      ingredients: [],
      untried: true,
      suitableFor: ['lunch', 'dinner'],
      componentType: 'full',
      pairings: { sides: [], salads: [] },
    },
  };
}

// ---------------------------------------------------------------------------
// Draft <-> Recipe / form mapping
// ---------------------------------------------------------------------------

/**
 * Builds a persistable `Recipe` from a validated draft. On create, generates
 * a new id/createdAt (idFn injectable for tests). On edit, preserves the
 * existing id/createdAt/untried — a full-form edit never un-promotes or
 * re-promotes a recipe; only `promoteRecipe` changes `untried`.
 */
export function toRecipe(
  draft: RecipeDraft,
  existing: Recipe | undefined,
  now: string,
  idFn: () => string = () => crypto.randomUUID(),
): Recipe {
  if (existing) {
    return {
      ...existing,
      name: draft.name,
      category: draft.category,
      effort: draft.effort,
      source: draft.source,
      notes: draft.notes,
      portions: draft.portions,
      ingredients: draft.ingredients,
      updatedAt: now,
      suitableFor: draft.suitableFor,
      componentType: draft.componentType,
      pairings: draft.pairings,
    };
  }
  return {
    id: idFn(),
    name: draft.name,
    category: draft.category,
    effort: draft.effort,
    source: draft.source,
    notes: draft.notes,
    portions: draft.portions,
    ingredients: draft.ingredients,
    untried: draft.untried,
    createdAt: now,
    updatedAt: now,
    suitableFor: draft.suitableFor,
    componentType: draft.componentType,
    pairings: draft.pairings,
  };
}

/** Inverse of toRecipe, for populating the edit form. */
export function fromRecipe(recipe: Recipe): FormValues {
  return {
    name: recipe.name,
    category: recipe.category,
    effort: recipe.effort,
    source: recipe.source ?? '',
    notes: recipe.notes ?? '',
    portionsStr: recipe.portions !== undefined ? String(recipe.portions) : '2',
    ingredients: recipe.ingredients.map((ing) => ({
      name: ing.name,
      amountStr: ing.amount !== undefined ? formatAmount(ing.amount) : '',
      unit: ing.unit ?? '',
    })),
    suitableFor: recipe.suitableFor,
    componentType: recipe.componentType,
    pairings: recipe.pairings,
  };
}

/** Toggles `slot`'s membership in `current`, keeping the result ordered by `SLOT_ORDER`. */
export function toggleSlotSelection(current: MealSlotKey[], slot: MealSlotKey): MealSlotKey[] {
  const next = current.includes(slot) ? current.filter((s) => s !== slot) : [...current, slot];
  return SLOT_ORDER.filter((s) => next.includes(s));
}

// ---------------------------------------------------------------------------
// Pairing selection (feature 004 step 6)
// ---------------------------------------------------------------------------

/** Toggles `id`'s membership in `current`, keeping insertion order (unlike `toggleSlotSelection` there is no canonical sort). */
export function togglePairing(current: string[], id: string): string[] {
  return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
}

export interface PairingPools {
  sides: Recipe[];
  salads: Recipe[];
}

/**
 * Candidate pools for the Typ receptu = main form's pairing sections:
 * recipes currently typed `side`/`salad`, Czech-sorted by name, excluding
 * `editedId` (a recipe can't pair with itself).
 */
export function pairingPools(recipes: Recipe[], editedId: string | undefined): PairingPools {
  const byName = (a: Recipe, b: Recipe) => a.name.localeCompare(b.name, 'cs');
  return {
    sides: recipes.filter((r) => r.componentType === 'side' && r.id !== editedId).sort(byName),
    salads: recipes.filter((r) => r.componentType === 'salad' && r.id !== editedId).sort(byName),
  };
}

/** Filters a pairing pool to names containing `query` (diacritic/case-insensitive); empty query returns the pool unchanged. */
export function filterPool(pool: Recipe[], query: string): Recipe[] {
  const q = normalizeName(query);
  if (!q) return pool;
  return pool.filter((r) => normalizeName(r.name).includes(q));
}

/** Names of `recipe`'s current paired sides/salads, for the detail-page chip lines. Stale (deleted/re-typed) ids are skipped. */
export function pairingChips(recipe: Recipe, recipes: Recipe[]): { sides: string[]; salads: string[] } {
  return {
    sides: pairedSides(recipe, recipes).map((r) => r.name),
    salads: pairedSalads(recipe, recipes).map((r) => r.name),
  };
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** Marks an untried recipe as tried. */
export function promoteRecipe(recipe: Recipe, now: string): Recipe {
  return { ...recipe, untried: false, updatedAt: now };
}

/** Spec: a recipe needs at least one ingredient before it can be assigned to a weekly plan. */
export function canBePlanned(recipe: Recipe): boolean {
  return recipe.ingredients.length > 0;
}

/** Standardized units of measure offered by the ingredient unit dropdown. */
export const STANDARD_UNITS = [
  'g',
  'kg',
  'ml',
  'l',
  'ks',
  'lžíce',
  'lžička',
  'hrnek',
  'špetka',
  'balení',
  'plátek',
  'stroužek',
  'konzerva',
] as const;

/**
 * Options for the unit dropdown: empty ("bez jednotky") first, then the
 * standard units, plus the edited recipe's current unit when it predates the
 * dropdown (legacy free-text units must not be silently lost on edit).
 */
export function unitOptions(current: string): string[] {
  const options: string[] = ['', ...STANDARD_UNITS];
  if (current !== '' && !options.includes(current)) {
    options.push(current);
  }
  return options;
}

/**
 * Only http/https URLs render as a link; anything else (plain text notes,
 * `javascript:` etc.) renders as plain text instead.
 */
export function sourceHref(source: string | undefined): string | null {
  if (!source) return null;
  try {
    const url = new URL(source);
    return url.protocol === 'http:' || url.protocol === 'https:' ? source : null;
  } catch {
    return null;
  }
}
