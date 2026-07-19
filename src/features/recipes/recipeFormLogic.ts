/**
 * Pure helpers for the recipe CRUD + "vyzkoušet" inbox screens (step 11) —
 * no React, no store, no fetch. Kept in a plain `.ts` module so it stays
 * testable under Vitest's node environment.
 */

import type { Effort, Ingredient, Recipe, RecipeCategory } from '../../types';

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
}

export interface FullFormErrors {
  name?: string;
  portions?: string;
  ingredients?: string;
  ingredientErrors?: Record<number, string>;
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
    },
  };
}

/** Minimal inbox form: name required only (~15 s flow); no ingredients, untried. */
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
