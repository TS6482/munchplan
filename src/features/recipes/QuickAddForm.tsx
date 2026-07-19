import { useState, type FormEvent } from 'react';
import { useDataStore } from '../../store/data';
import { toRecipe, validateQuickAdd } from './recipeFormLogic';
import styles from './QuickAddForm.module.css';

/** The ~15-second inbox flow: name (+ optional source), one tap to add. */
function QuickAddForm() {
  const addRecipe = useDataStore((s) => s.addRecipe);
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const result = validateQuickAdd(name, source);
    if (!result.ok) {
      setError(result.errors.name ?? null);
      return;
    }
    setError(null);
    const recipe = toRecipe(result.recipe, undefined, new Date().toISOString());
    void addRecipe(recipe);
    setName('');
    setSource('');
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <input placeholder="Název receptu" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="Zdroj (nepovinné)" value={source} onChange={(e) => setSource(e.target.value)} />
      <button type="submit" className="btn btnPrimary">
        Přidat
      </button>
      {error && <p className={styles.error}>{error}</p>}
    </form>
  );
}

export default QuickAddForm;
