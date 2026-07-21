import { useState } from 'react';
import { useDataStore } from '../../store/data';
import { navigate } from '../../router/router';
import type { Ingredient, Recipe } from '../../types';
import { SLOT_LABELS } from '../../components/slotLabels';
import { EFFORT_LABELS, canBePlanned, formatAmount, formatPortions, promoteRecipe, sourceHref } from './recipeFormLogic';
import RecipeForm from './RecipeForm';
import styles from './RecipeDetailPage.module.css';

function ingredientLine(ing: Ingredient): string {
  const parts: string[] = [];
  if (ing.amount !== undefined) parts.push(formatAmount(ing.amount));
  if (ing.unit) parts.push(ing.unit);
  return parts.length > 0 ? `${ing.name} — ${parts.join(' ')}` : ing.name;
}

function RecipeDetailPage({ id }: { id: string }) {
  const recipes = useDataStore((s) => s.files.recipes.data);
  const addRecipe = useDataStore((s) => s.addRecipe);
  const removeRecipe = useDataStore((s) => s.removeRecipe);
  const [editing, setEditing] = useState(false);

  const recipe = recipes.find((r) => r.id === id);

  if (!recipe) {
    return <p>Recept nenalezen</p>;
  }

  if (editing) {
    return (
      <div className={styles.page}>
        <h1>Upravit recept</h1>
        <RecipeForm existing={recipe} onCancel={() => setEditing(false)} />
      </div>
    );
  }

  const href = sourceHref(recipe.source);
  // Rebound with an explicit non-optional type: TS narrowing from the guard
  // above doesn't extend into the function declarations below.
  const current: Recipe = recipe;

  function handlePromote() {
    void addRecipe(promoteRecipe(current, new Date().toISOString()));
  }

  function handleDelete() {
    if (window.confirm(`Opravdu smazat recept „${current.name}“?`)) {
      void removeRecipe(current.id).then(() => navigate({ name: 'recipes' }));
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>{recipe.name}</h1>
        {recipe.untried && <span className={styles.badge}>nevyzkoušené</span>}
      </div>

      <div className={styles.chips}>
        <span className={styles.chip}>{recipe.category}</span>
        <span className={styles.chip}>{EFFORT_LABELS[recipe.effort]}</span>
        {recipe.portions !== undefined && <span className={styles.chip}>{formatPortions(recipe.portions)}</span>}
        {recipe.suitableFor.map((slot) => (
          <span key={slot} className={styles.chip}>
            {SLOT_LABELS[slot]}
          </span>
        ))}
      </div>

      {!canBePlanned(recipe) && (
        <p className={styles.hint}>Recept zatím nemá žádné ingredience — nelze naplánovat.</p>
      )}

      <section className={styles.section}>
        <h2>Ingredience</h2>
        {recipe.ingredients.length === 0 ? (
          <p className={styles.empty}>Zatím žádné ingredience</p>
        ) : (
          <ul className={styles.ingredientList}>
            {recipe.ingredients.map((ing, i) => (
              <li key={i}>{ingredientLine(ing)}</li>
            ))}
          </ul>
        )}
      </section>

      {recipe.source && (
        <section className={styles.section}>
          <h2>Zdroj</h2>
          {href ? (
            <a href={href} target="_blank" rel="noreferrer">
              {recipe.source}
            </a>
          ) : (
            <p>{recipe.source}</p>
          )}
        </section>
      )}

      {recipe.notes && (
        <section className={styles.section}>
          <h2>Poznámky</h2>
          <p className={styles.notes}>{recipe.notes}</p>
        </section>
      )}

      <div className={styles.actions}>
        {recipe.untried && (
          <button type="button" className="btn btnPrimary" onClick={handlePromote}>
            Vyzkoušeno ✓
          </button>
        )}
        <button type="button" className="btn btnSecondary" onClick={() => setEditing(true)}>
          Upravit
        </button>
        <button type="button" className="btn btnDanger" onClick={handleDelete}>
          Smazat
        </button>
      </div>
    </div>
  );
}

export default RecipeDetailPage;
