import { useState } from 'react';
import { useDataStore } from '../../store/data';
import type { IsoDay, MealEntry, MealSlotKey, WeekKey } from '../../types';
import type { RankSuggestionsInput } from '../../engine/suggest';
import { routeHash } from '../../router/router';
import { getSuggestions, suggestionView } from './planLogic';
import {
  addSalad,
  entryRows,
  mealHeader,
  newManualEntry,
  newPlannedEntry,
  rerollSlot,
  swapSide,
  unpairedMainHint,
  type ComponentRemoval,
} from './mealDetailLogic';
import RecipePicker from './RecipePicker';
import styles from './MealDetailPage.module.css';

interface MealDetailPageProps {
  week: WeekKey;
  day: IsoDay;
  slot: MealSlotKey;
}

const SUGGESTION_LIMIT = 5;
const REROLL_NOTICE = 'Slot nemá automaticky doplněná jídla';

/** Meal detail page (feature 002, step 9; composition controls added feature 004, step 8): lists a slot's entries, adds via slot-aware suggestions or the full picker, and rerolls its auto entries. Thin over `mealDetailLogic.ts`. */
function MealDetailPage({ week, day, slot }: MealDetailPageProps) {
  const recipes = useDataStore((s) => s.files.recipes.data);
  const plans = useDataStore((s) => s.files.plans.data);
  const sales = useDataStore((s) => s.files.sales.data);
  const settings = useDataStore((s) => s.files.settings.data);
  const addMealEntry = useDataStore((s) => s.addMealEntry);
  const removeMealEntry = useDataStore((s) => s.removeMealEntry);
  const replaceAutoEntries = useDataStore((s) => s.replaceAutoEntries);
  const setEntryRecipes = useDataStore((s) => s.setEntryRecipes);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [rerollNotice, setRerollNotice] = useState(false);
  const [swapEntryId, setSwapEntryId] = useState<string | null>(null);

  const weekPlan = plans[week];
  const header = mealHeader(week, day, slot);
  const rows = entryRows(weekPlan, day, slot, recipes);
  const rawEntries: MealEntry[] = weekPlan?.days[day][slot] ?? [];
  const hasAutoEntry = rows.some((row) => row.source === 'auto');

  const suggestionsInput: RankSuggestionsInput = { recipes, plans, sales, settings, targetWeek: week };
  const suggestions = getSuggestions({ ...suggestionsInput, slot }).slice(0, SUGGESTION_LIMIT);

  /** Bare picker path (decision 5): places exactly the tapped recipe, never composes. */
  async function handleAdd(recipeId: string) {
    await addMealEntry(week, day, slot, newManualEntry(recipeId, () => crypto.randomUUID()));
  }

  /** Suggestion "Přidat" path (decision 5): composes a paired main into `[main, side]`. */
  async function handleAddPlanned(recipeId: string) {
    await addMealEntry(week, day, slot, newPlannedEntry(recipeId, recipes, sales, settings, Math.random, () => crypto.randomUUID()));
  }

  function handleComponentRemove(entryId: string, removal: ComponentRemoval) {
    if (removal.kind === 'entry') {
      void removeMealEntry(week, day, slot, entryId);
    } else {
      void setEntryRecipes(week, day, slot, entryId, removal.nextRecipeIds);
    }
  }

  function handleReroll() {
    const result = rerollSlot(
      { recipes, plans, sales, settings, week },
      day,
      slot,
      Math.random,
      () => crypto.randomUUID(),
    );
    if (!result.hasTargets) {
      setRerollNotice(true);
      return;
    }
    setRerollNotice(false);
    void replaceAutoEntries(week, result.placements);
  }

  const swapEntry = swapEntryId ? rawEntries.find((e) => e.id === swapEntryId) : undefined;
  const swapOptions = swapEntry ? swapSide(swapEntry, recipes, settings) : [];

  return (
    <div className={styles.page}>
      <a href={header.backHash} className={styles.back}>
        ← Plán
      </a>
      <h1 className={styles.title}>
        {header.dayLabel} {header.dateText} · {header.slotLabel}
      </h1>

      <div className={styles.entries}>
        {rows.length === 0 ? (
          <p className={styles.empty}>Zatím žádné jídlo</p>
        ) : (
          rows.map((row, i) => {
            const rawEntry = rawEntries[i];
            const sideOptions = rawEntry ? swapSide(rawEntry, recipes, settings) : [];
            const saladOptions = rawEntry ? addSalad(rawEntry, recipes) : [];
            const hint = rawEntry ? unpairedMainHint(rawEntry, recipes, settings) : null;

            return (
              <div key={row.entryId} className={styles.entryRow}>
                <div className={styles.entryInfo}>
                  <span className={styles.name}>
                    {row.displayName}
                    {row.untriedBadge && <span className={styles.badge}>nevyzkoušené</span>}
                    {row.source === 'auto' && <span className={styles.autoBadge}>auto</span>}
                  </span>
                  {row.portionsText && <span className={styles.portions}>{row.portionsText}</span>}

                  <div className={styles.components}>
                    {row.components.map((component) => (
                      <div key={component.id} className={styles.componentRow}>
                        {component.deleted ? (
                          <span className={styles.deletedLink}>{component.name}</span>
                        ) : (
                          <a href={routeHash({ name: 'recipe', id: component.id })} className={styles.link}>
                            {component.name}
                          </a>
                        )}
                        {component.roleLabel && <span className={styles.roleLabel}>{component.roleLabel}</span>}
                        <button
                          type="button"
                          className={styles.removeButton}
                          onClick={() => handleComponentRemove(row.entryId, component.removal)}
                          aria-label="Odebrat součást"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>

                  {sideOptions.length > 0 && (
                    <button
                      type="button"
                      className="btn btnSecondary"
                      onClick={() => setSwapEntryId(row.entryId)}
                    >
                      Vyměnit přílohu
                    </button>
                  )}

                  {saladOptions.length > 0 && (
                    <div className={styles.saladOptions}>
                      {saladOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className="btn btnSecondary"
                          onClick={() => void setEntryRecipes(week, day, slot, row.entryId, option.nextRecipeIds)}
                        >
                          Přidat salát: {option.name}
                        </button>
                      ))}
                    </div>
                  )}

                  {hint && (
                    <p className={styles.hint}>
                      ⚠ {hint.text}{' '}
                      <a href={hint.editHref} className={styles.link}>
                        Upravit recept
                      </a>
                    </p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {hasAutoEntry && (
        <button type="button" className="btn btnNeutral btnBlock" onClick={handleReroll}>
          Přegenerovat
        </button>
      )}
      {rerollNotice && <p className={styles.notice}>{REROLL_NOTICE}</p>}

      <section className={styles.addSection}>
        <h2 className={styles.sectionTitle}>Přidat jídlo</h2>

        {suggestions.length > 0 && (
          <ul className={styles.suggestionList}>
            {suggestions.map((s) => {
              const view = suggestionView(s);
              return (
                <li key={view.id} className={styles.suggestionRow}>
                  <div className={styles.suggestionInfo}>
                    <span className={styles.name}>
                      {view.name}
                      {view.untriedBadge && <span className={styles.badge}>nevyzkoušené</span>}
                      {view.compositionBadge && <span className={styles.compositionBadge}>{view.compositionBadge}</span>}
                    </span>
                    {view.saleText && <span className={styles.sale}>{view.saleText}</span>}
                    <span className={styles.fresh}>{view.freshText}</span>
                  </div>
                  <button type="button" className="btn btnSecondary" onClick={() => void handleAddPlanned(view.id)}>
                    Přidat
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <button type="button" className="btn btnNeutral btnBlock" onClick={() => setPickerOpen(true)}>
          Vybrat ze všech receptů
        </button>
      </section>

      {pickerOpen && (
        <RecipePicker
          input={suggestionsInput}
          slot={slot}
          onSelect={(recipeId) => {
            void handleAdd(recipeId);
            setPickerOpen(false);
          }}
          onCancel={() => setPickerOpen(false)}
        />
      )}

      {swapEntryId && (
        <div className={styles.overlay}>
          <div className={`${styles.panel} glass`}>
            <h2>Vyměnit přílohu</h2>
            {swapOptions.length === 0 ? (
              <p className={styles.empty}>Žádná příloha k výběru</p>
            ) : (
              <ul className={styles.optionList}>
                {swapOptions.map((option) => (
                  <li key={option.id}>
                    <button
                      type="button"
                      className={styles.optionButton}
                      onClick={() => {
                        void setEntryRecipes(week, day, slot, swapEntryId, option.nextRecipeIds);
                        setSwapEntryId(null);
                      }}
                    >
                      <span className={styles.name}>{option.name}</span>
                      {option.current && <span className={styles.autoBadge}>aktuální</span>}
                      {option.blocked && <span className={styles.warning}>⚠ obsahuje blokovanou ingredienci</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="btn btnNeutral btnBlock" onClick={() => setSwapEntryId(null)}>
              Zrušit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default MealDetailPage;
