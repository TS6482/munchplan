import { useState } from 'react';
import type { MealSlotKey } from '../../types';
import type { RankSuggestionsInput } from '../../engine/suggest';
import { normalizeName } from '../../engine/normalize';
import { pickerEntries } from './planLogic';
import styles from './RecipePicker.module.css';

interface RecipePickerProps {
  input: RankSuggestionsInput;
  /** When given, warnings include the "unsuitable for this slot" line (AC5); the recipe stays pickable. */
  slot?: MealSlotKey;
  onSelect: (recipeId: string) => void;
  onCancel: () => void;
}

/** Direct-assignment picker: search/browse the whole collection, bypassing suggestions. */
function RecipePicker({ input, slot, onSelect, onCancel }: RecipePickerProps) {
  const [query, setQuery] = useState('');
  const entries = pickerEntries(slot ? { ...input, slot } : input);
  const normalizedQuery = normalizeName(query);
  const filtered = normalizedQuery
    ? entries.filter((e) => normalizeName(e.recipe.name).includes(normalizedQuery))
    : entries;

  return (
    <div className={styles.overlay}>
      <div className={`${styles.panel} glass`}>
        <h2>Vybrat recept</h2>
        <input
          className={styles.search}
          placeholder="Hledat recept…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {filtered.length === 0 ? (
          <p className={styles.empty}>Žádný recept nenalezen</p>
        ) : (
          <ul className={styles.list}>
            {filtered.map((entry) => (
              <li key={entry.recipe.id} className={styles.row}>
                <button
                  type="button"
                  className={styles.rowButton}
                  disabled={!entry.plannable}
                  onClick={() => onSelect(entry.recipe.id)}
                >
                  <span className={styles.name}>{entry.recipe.name}</span>
                  {!entry.plannable && <span className={styles.hint}>Nejdřív doplň ingredience</span>}
                  {entry.warnings.map((w) => (
                    <span key={w} className={styles.warning}>
                      ⚠ {w}
                    </span>
                  ))}
                </button>
              </li>
            ))}
          </ul>
        )}

        <button type="button" className="btn btnNeutral btnBlock" onClick={onCancel}>
          Zrušit
        </button>
      </div>
    </div>
  );
}

export default RecipePicker;
