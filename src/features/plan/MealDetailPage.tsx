import { useState } from 'react';
import { useDataStore } from '../../store/data';
import type { IsoDay, MealSlotKey, WeekKey } from '../../types';
import type { RankSuggestionsInput } from '../../engine/suggest';
import { routeHash } from '../../router/router';
import { getSuggestions, seedOpsForUnstoredWeek, suggestionView } from './planLogic';
import { entryRows, mealHeader, newManualEntry, rerollSlot } from './mealDetailLogic';
import RecipePicker from './RecipePicker';
import styles from './MealDetailPage.module.css';

interface MealDetailPageProps {
  week: WeekKey;
  day: IsoDay;
  slot: MealSlotKey;
}

const SUGGESTION_LIMIT = 5;
const REROLL_NOTICE = 'Slot nemá automaticky doplněná jídla';

/** Meal detail page (feature 002, step 9): lists a slot's entries, adds via slot-aware suggestions or the full picker, and rerolls its auto entries. Thin over `mealDetailLogic.ts`. */
function MealDetailPage({ week, day, slot }: MealDetailPageProps) {
  const recipes = useDataStore((s) => s.files.recipes.data);
  const plans = useDataStore((s) => s.files.plans.data);
  const sales = useDataStore((s) => s.files.sales.data);
  const settings = useDataStore((s) => s.files.settings.data);
  const addMealEntry = useDataStore((s) => s.addMealEntry);
  const removeMealEntry = useDataStore((s) => s.removeMealEntry);
  const replaceAutoEntries = useDataStore((s) => s.replaceAutoEntries);
  const activateSlot = useDataStore((s) => s.activateSlot);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [rerollNotice, setRerollNotice] = useState(false);

  const weekPlan = plans[week];
  const header = mealHeader(week, day, slot);
  const rows = entryRows(weekPlan, day, slot, recipes);
  const hasAutoEntry = rows.some((row) => row.source === 'auto');

  const suggestionsInput: RankSuggestionsInput = { recipes, plans, sales, settings, targetWeek: week };
  const suggestions = getSuggestions({ ...suggestionsInput, slot }).slice(0, SUGGESTION_LIMIT);

  async function handleAdd(recipeId: string) {
    // Unstored week: seed the inherited defaults before activating the
    // tapped slot (decision 6 / MAJOR 1) — seeding first means a tapped slot
    // outside those defaults joins them instead of replacing them.
    const seedOps = seedOpsForUnstoredWeek(plans, week);
    for (const op of seedOps) {
      await activateSlot(op.week, op.slot);
    }
    if (!seedOps.some((op) => op.slot === slot) && !(weekPlan?.activeSlots.includes(slot) ?? false)) {
      await activateSlot(week, slot);
    }
    await addMealEntry(week, day, slot, newManualEntry(recipeId, () => crypto.randomUUID()));
  }

  function handleReroll() {
    const result = rerollSlot(
      { recipes, plans, sales, settings, week, activeSlots: weekPlan?.activeSlots ?? [slot] },
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
          rows.map((row) => (
            <div key={row.entryId} className={styles.entryRow}>
              <div className={styles.entryInfo}>
                <span className={styles.name}>
                  {row.displayName}
                  {row.untriedBadge && <span className={styles.badge}>nevyzkoušené</span>}
                  {row.source === 'auto' && <span className={styles.autoBadge}>auto</span>}
                </span>
                {row.portionsText && <span className={styles.portions}>{row.portionsText}</span>}
                <div className={styles.links}>
                  {row.recipeLinks.map((link) =>
                    link.deleted ? (
                      <span key={link.id} className={styles.deletedLink}>
                        {link.name}
                      </span>
                    ) : (
                      <a key={link.id} href={routeHash({ name: 'recipe', id: link.id })} className={styles.link}>
                        {link.name}
                      </a>
                    ),
                  )}
                </div>
              </div>
              <button
                type="button"
                className={styles.removeButton}
                onClick={() => void removeMealEntry(week, day, slot, row.entryId)}
                aria-label="Odebrat jídlo"
              >
                ✕
              </button>
            </div>
          ))
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
                    </span>
                    {view.saleText && <span className={styles.sale}>{view.saleText}</span>}
                    <span className={styles.fresh}>{view.freshText}</span>
                  </div>
                  <button type="button" className="btn btnSecondary" onClick={() => void handleAdd(view.id)}>
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
    </div>
  );
}

export default MealDetailPage;
