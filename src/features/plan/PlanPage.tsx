import { useMemo, useState } from 'react';
import { useDataStore } from '../../store/data';
import { routeHash } from '../../router/router';
import type { IsoDay } from '../../types';
import { plannedCategories, type RankSuggestionsInput } from '../../engine/suggest';
import { dayRows, getSuggestions, quotaSummaryLine, weekChoices } from './planLogic';
import SuggestionsPanel from './SuggestionsPanel';
import RecipePicker from './RecipePicker';
import styles from './PlanPage.module.css';

function PlanPage() {
  const recipes = useDataStore((s) => s.files.recipes.data);
  const plans = useDataStore((s) => s.files.plans.data);
  const sales = useDataStore((s) => s.files.sales.data);
  const settings = useDataStore((s) => s.files.settings.data);
  const assignDay = useDataStore((s) => s.assignDay);

  const choices = useMemo(() => weekChoices(new Date()), []);
  const [weekKey, setWeekKey] = useState(choices[1].key); // default: příští týden

  const [pickerDay, setPickerDay] = useState<IsoDay | null>(null);

  const rows = dayRows(weekKey, plans, recipes);
  const categoriesPlanned = plannedCategories(recipes, plans, weekKey);
  const summary = quotaSummaryLine(settings.dietRules, categoriesPlanned);

  const suggestionsInput: RankSuggestionsInput = { recipes, plans, sales, settings, targetWeek: weekKey };
  const suggestions = getSuggestions(suggestionsInput);

  function handleAssignSuggestion(recipeId: string) {
    const firstEmpty = rows.find((r) => r.recipeId === null);
    if (!firstEmpty) {
      window.alert('Týden je plný');
      return;
    }
    void assignDay(weekKey, firstEmpty.day, recipeId);
  }

  return (
    <div className={styles.page}>
      <h1>Plán</h1>

      <div className="segmented">
        {choices.map((choice) => (
          <button
            key={choice.key}
            type="button"
            className={choice.key === weekKey ? 'segment segmentActive' : 'segment'}
            onClick={() => setWeekKey(choice.key)}
          >
            {choice.label}
          </button>
        ))}
      </div>

      {summary && <p className={styles.summary}>{summary}</p>}

      <div className={styles.days}>
        {rows.map((row) => (
          <div key={row.day} className={styles.dayRow}>
            <div className={styles.dayInfo}>
              <span className={styles.dayLabel}>{row.dayLabel}</span>
              <span className={styles.dayDate}>{row.date}</span>
            </div>

            {row.recipeId === null ? (
              <button type="button" className={styles.emptySlot} onClick={() => setPickerDay(row.day)}>
                — Přidat —
              </button>
            ) : (
              <div className={styles.filledSlot}>
                {row.deleted ? (
                  <span className={styles.deletedName}>{row.recipeName}</span>
                ) : (
                  <a href={routeHash({ name: 'recipe', id: row.recipeId })} className={styles.recipeName}>
                    {row.recipeName}
                  </a>
                )}
                <button
                  type="button"
                  className={styles.clearButton}
                  onClick={() => void assignDay(weekKey, row.day, null)}
                  aria-label={`Odebrat ${row.dayLabel}`}
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <SuggestionsPanel recipesEmpty={recipes.length === 0} suggestions={suggestions} onAssign={handleAssignSuggestion} />

      {pickerDay && (
        <RecipePicker
          input={suggestionsInput}
          onSelect={(recipeId) => {
            void assignDay(weekKey, pickerDay, recipeId);
            setPickerDay(null);
          }}
          onCancel={() => setPickerDay(null)}
        />
      )}
    </div>
  );
}

export default PlanPage;
