import { useState } from 'react';
import { useDataStore } from '../../store/data';
import { routeHash } from '../../router/router';
import type { Recipe } from '../../types';
import { EFFORT_LABELS } from './recipeFormLogic';
import QuickAddForm from './QuickAddForm';
import RecipeForm from './RecipeForm';
import styles from './RecipeListPage.module.css';

function RecipeRow({ recipe }: { recipe: Recipe }) {
  return (
    <a href={routeHash({ name: 'recipe', id: recipe.id })} className={styles.row}>
      <span className={styles.rowName}>{recipe.name}</span>
      <span className={styles.chips}>
        <span className={styles.chip}>{recipe.category}</span>
        <span className={styles.chip}>{EFFORT_LABELS[recipe.effort]}</span>
      </span>
    </a>
  );
}

function RecipeListPage() {
  const recipes = useDataStore((s) => s.files.recipes.data);
  const [tab, setTab] = useState<'collection' | 'inbox'>('collection');
  const [showNewForm, setShowNewForm] = useState(false);

  const collection = recipes
    .filter((r) => !r.untried)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'));
  const inbox = recipes.filter((r) => r.untried);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Recepty</h1>
      </div>

      <div className="segmented">
        <button
          type="button"
          className={tab === 'collection' ? 'segment segmentActive' : 'segment'}
          onClick={() => setTab('collection')}
        >
          Sbírka
        </button>
        <button
          type="button"
          className={tab === 'inbox' ? 'segment segmentActive' : 'segment'}
          onClick={() => setTab('inbox')}
        >
          Vyzkoušet
        </button>
      </div>

      {tab === 'collection' ? (
        <div className={styles.list}>
          {collection.length === 0 ? (
            <p className={styles.empty}>Zatím žádné recepty.</p>
          ) : (
            collection.map((r) => <RecipeRow key={r.id} recipe={r} />)
          )}
        </div>
      ) : (
        <div className={styles.list}>
          <QuickAddForm />
          {showNewForm ? (
            <RecipeForm untried onCancel={() => setShowNewForm(false)} />
          ) : (
            <button type="button" className="btn btnSecondary btnBlock" onClick={() => setShowNewForm(true)}>
              Vytvořit celý recept
            </button>
          )}
          {inbox.length === 0 ? (
            <p className={styles.empty}>Žádné recepty k vyzkoušení.</p>
          ) : (
            inbox.map((r) => <RecipeRow key={r.id} recipe={r} />)
          )}
        </div>
      )}
    </div>
  );
}

export default RecipeListPage;
