import { useState, type FormEvent } from 'react';
import { useDataStore } from '../../store/data';
import { navigate } from '../../router/router';
import type { Effort, Recipe } from '../../types';
import {
  fromRecipe,
  toRecipe,
  unitOptions,
  validateFullForm,
  type FormValues,
  type FullFormErrors,
  type IngredientFormRow,
} from './recipeFormLogic';
import styles from './RecipeForm.module.css';

const KNOWN_CATEGORIES = ['maso', 'ryba', 'vege', 'těstoviny', 'polévka', 'jiné'] as const;
const CUSTOM_CATEGORY = '__custom__';

const EFFORTS: { value: Effort; label: string }[] = [
  { value: 'quick', label: 'rychlé' },
  { value: 'normal', label: 'normální' },
  { value: 'hard', label: 'náročné' },
];

function emptyRow(): IngredientFormRow {
  return { name: '', amountStr: '', unit: '' };
}

function emptyForm(): FormValues {
  return { name: '', category: 'jiné', effort: 'normal', source: '', notes: '', ingredients: [emptyRow()] };
}

interface RecipeFormProps {
  /** Present when editing an existing recipe; absent when creating a new one. */
  existing?: Recipe;
  onCancel: () => void;
}

/** Full recipe form, used both for creating a new recipe and editing an existing one. */
function RecipeForm({ existing, onCancel }: RecipeFormProps) {
  const addRecipe = useDataStore((s) => s.addRecipe);
  const [values, setValues] = useState<FormValues>(() => (existing ? fromRecipe(existing) : emptyForm()));
  const [categoryMode, setCategoryMode] = useState<'known' | 'custom'>(() =>
    (KNOWN_CATEGORIES as readonly string[]).includes(values.category) ? 'known' : 'custom',
  );
  const [errors, setErrors] = useState<FullFormErrors>({});

  function updateRow(idx: number, patch: Partial<IngredientFormRow>) {
    setValues((v) => ({ ...v, ingredients: v.ingredients.map((row, i) => (i === idx ? { ...row, ...patch } : row)) }));
  }

  function addRow() {
    setValues((v) => ({ ...v, ingredients: [...v.ingredients, emptyRow()] }));
  }

  function removeRow(idx: number) {
    setValues((v) => ({ ...v, ingredients: v.ingredients.filter((_, i) => i !== idx) }));
  }

  function handleCategorySelect(value: string) {
    if (value === CUSTOM_CATEGORY) {
      setCategoryMode('custom');
      setValues((v) => ({ ...v, category: '' }));
    } else {
      setCategoryMode('known');
      setValues((v) => ({ ...v, category: value }));
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const result = validateFullForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    const recipe = toRecipe(result.recipe, existing, new Date().toISOString());
    void addRecipe(recipe).then(() => navigate({ name: 'recipe', id: recipe.id }));
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <label className={styles.field}>
        Název
        <input value={values.name} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} />
      </label>
      {errors.name && <p className={styles.error}>{errors.name}</p>}

      <label className={styles.field}>
        Kategorie
        <select value={categoryMode === 'known' ? values.category : CUSTOM_CATEGORY} onChange={(e) => handleCategorySelect(e.target.value)}>
          {KNOWN_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value={CUSTOM_CATEGORY}>vlastní…</option>
        </select>
      </label>
      {categoryMode === 'custom' && (
        <input
          className={styles.customCategory}
          placeholder="Vlastní kategorie"
          value={values.category}
          onChange={(e) => setValues((v) => ({ ...v, category: e.target.value }))}
        />
      )}

      <label className={styles.field}>
        Náročnost
        <select value={values.effort} onChange={(e) => setValues((v) => ({ ...v, effort: e.target.value as Effort }))}>
          {EFFORTS.map((ef) => (
            <option key={ef.value} value={ef.value}>
              {ef.label}
            </option>
          ))}
        </select>
      </label>

      <label className={styles.field}>
        Zdroj
        <input value={values.source} onChange={(e) => setValues((v) => ({ ...v, source: e.target.value }))} />
      </label>

      <label className={styles.field}>
        Poznámky
        <textarea value={values.notes} onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))} />
      </label>

      <div className={styles.ingredients}>
        <h2>Ingredience</h2>
        {errors.ingredients && <p className={styles.error}>{errors.ingredients}</p>}
        {values.ingredients.map((row, i) => (
          <div key={i} className={styles.ingredientRow}>
            <input placeholder="Název" value={row.name} onChange={(e) => updateRow(i, { name: e.target.value })} />
            <input placeholder="Množství" value={row.amountStr} onChange={(e) => updateRow(i, { amountStr: e.target.value })} />
            <select
              aria-label="Jednotka"
              value={row.unit}
              onChange={(e) => updateRow(i, { unit: e.target.value })}
            >
              {unitOptions(row.unit).map((u) => (
                <option key={u} value={u}>
                  {u === '' ? '— bez jednotky' : u}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => removeRow(i)} aria-label="Odebrat ingredienci">
              ×
            </button>
            {errors.ingredientErrors?.[i] && <p className={styles.error}>{errors.ingredientErrors[i]}</p>}
          </div>
        ))}
        <button type="button" className="btn btnSecondary btnBlock" onClick={addRow}>
          Přidat ingredienci
        </button>
      </div>

      <div className={styles.actions}>
        <button type="submit" className="btn btnPrimary">
          Uložit
        </button>
        <button type="button" className="btn btnNeutral" onClick={onCancel}>
          Zrušit
        </button>
      </div>
    </form>
  );
}

export default RecipeForm;
