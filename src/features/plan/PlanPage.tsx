import { useMemo, useState } from 'react';
import { useDataStore } from '../../store/data';
import type { IsoDay, MealSlotKey, WeekKey } from '../../types';
import { plannedCategories } from '../../engine/suggest';
import { dayCards, hasAutoEntries, quotaSummaryLine, runAutoFill, runWeekReroll, weekChoices } from './planLogic';
import styles from './PlanPage.module.css';

/** Transient "Žádný vhodný recept" hints, keyed by "day/slot" — never persisted. */
type Hints = Set<string>;

function hintKey(day: IsoDay, slot: MealSlotKey): string {
  return `${day}/${slot}`;
}

interface PlanPageProps {
  /** Seeds the shown week from the route (back-navigation from mealDetail); undefined uses the Příští týden default. */
  week?: WeekKey;
}

function PlanPage({ week }: PlanPageProps) {
  const recipes = useDataStore((s) => s.files.recipes.data);
  const plans = useDataStore((s) => s.files.plans.data);
  const sales = useDataStore((s) => s.files.sales.data);
  const settings = useDataStore((s) => s.files.settings.data);
  const replaceAutoEntries = useDataStore((s) => s.replaceAutoEntries);
  const clearDaySlot = useDataStore((s) => s.clearDaySlot);

  const choices = useMemo(() => weekChoices(new Date()), []);
  // Mount-only seed: in-app flows (route push, back-navigation) always remount
  // this component, so `week` is re-read fresh each time. A manual hash edit
  // while already mounted won't retrigger this useState — out of scope.
  const [weekKey, setWeekKey] = useState(week ?? choices[1].key); // default: příští týden

  const [hints, setHints] = useState<Hints>(new Set());

  const weekPlan = plans[weekKey];

  const cards = dayCards(weekKey, plans, recipes);
  const categoriesPlanned = plannedCategories(recipes, plans, weekKey);
  const summary = quotaSummaryLine(settings.dietRules, categoriesPlanned);
  const showReroll = hasAutoEntries(weekPlan);

  function selectWeek(key: string) {
    setWeekKey(key);
    setHints(new Set());
  }

  async function handleAutoFill() {
    const result = runAutoFill({ recipes, plans, sales, settings, week: weekKey }, Math.random, () =>
      crypto.randomUUID(),
    );
    if (result.op) await replaceAutoEntries(result.op.week, result.op.placements);
    setHints(new Set(result.hints.map((t) => hintKey(t.day, t.slot))));
  }

  async function handleReroll() {
    const result = runWeekReroll({ recipes, plans, sales, settings, week: weekKey }, Math.random, () =>
      crypto.randomUUID(),
    );
    if (result.op) await replaceAutoEntries(result.op.week, result.op.placements);
    setHints(new Set(result.hints.map((t) => hintKey(t.day, t.slot))));
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
            onClick={() => selectWeek(choice.key)}
          >
            {choice.label}
          </button>
        ))}
      </div>

      {summary && <p className={styles.summary}>{summary}</p>}

      <div className={styles.days}>
        {cards.map((card) => (
          <div key={card.day} className={styles.dayCard}>
            <div className={styles.dayInfo}>
              <span className={styles.dayLabel}>{card.dayLabel}</span>
              <span className={styles.dayDate}>{card.dateText}</span>
            </div>

            <div className={styles.lines}>
              {card.lines.map((line) => (
                <div key={line.slot} className={styles.line}>
                  <a href={line.mealDetailHash} className={styles.lineLink}>
                    <span className={styles.slotLabel}>{line.slotLabel}</span>
                    <span className={styles.lineContent}>
                      {line.entries.length === 0 ? (
                        <>
                          <span className={styles.emptyText}>{line.emptyText}</span>
                          {hints.has(hintKey(card.day, line.slot)) && (
                            <span className={styles.hint}>Žádný vhodný recept</span>
                          )}
                        </>
                      ) : (
                        line.entries.map((entry) => (
                          <span key={entry.entryId} className={styles.entryName}>
                            {entry.displayName}
                            {entry.untriedBadge && <span className={styles.badge}>nevyzkoušené</span>}
                          </span>
                        ))
                      )}
                    </span>
                  </a>
                  {line.hasEntries && (
                    <button
                      type="button"
                      className={styles.clearButton}
                      aria-label="Vymazat slot"
                      onClick={() => void clearDaySlot(weekKey, card.day, line.slot)}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button type="button" className="btn btnPrimary btnBlock" onClick={() => void handleAutoFill()}>
        Doplnit návrhy
      </button>

      {showReroll && (
        <button type="button" className="btn btnSecondary btnBlock" onClick={() => void handleReroll()}>
          Přegenerovat
        </button>
      )}
    </div>
  );
}

export default PlanPage;
