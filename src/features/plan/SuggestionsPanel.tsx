import type { Suggestion } from '../../engine/suggest';
import { suggestionView } from './planLogic';
import styles from './SuggestionsPanel.module.css';

interface SuggestionsPanelProps {
  recipesEmpty: boolean;
  suggestions: Suggestion[];
  onAssign: (recipeId: string) => void;
}

/** Ranked suggestions list, verbatim from `rankSuggestions` — tap "Přidat" to assign to the first empty day of the shown week. */
function SuggestionsPanel({ recipesEmpty, suggestions, onAssign }: SuggestionsPanelProps) {
  return (
    <section className={styles.panel}>
      <h2>Návrhy</h2>

      {recipesEmpty ? (
        <p className={styles.empty}>Zatím nemáš žádné recepty — přidej ho přes ⋯ vpravo nahoře.</p>
      ) : suggestions.length === 0 ? (
        <p className={styles.empty}>Žádné návrhy pro tento týden.</p>
      ) : (
        <ul className={styles.list}>
          {suggestions.map((s) => {
            const view = suggestionView(s);
            return (
              <li key={view.id} className={styles.row}>
                <div className={styles.info}>
                  <span className={styles.name}>
                    {view.name}
                    {view.untriedBadge && <span className={styles.badge}>nevyzkoušené</span>}
                  </span>
                  {view.saleText && <span className={styles.sale}>{view.saleText}</span>}
                  <span className={styles.fresh}>{view.freshText}</span>
                </div>
                <button type="button" className="btn btnSecondary" onClick={() => onAssign(view.id)}>
                  Přidat
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default SuggestionsPanel;
