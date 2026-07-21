import { useMemo, useState } from 'react';
import { useDataStore } from '../../store/data';
import type { IsoDay, MealSlotKey, WeekKey } from '../../types';
import { SLOT_ORDER } from '../../types';
import { plannedCategories } from '../../engine/suggest';
import { SLOT_LABELS } from '../../components/slotLabels';
import {
  dayCards,
  defaultActiveSlots,
  hasAutoEntries,
  quotaSummaryLine,
  runAutoFill,
  runWeekReroll,
  toggleSlotResult,
  weekChoices,
} from './planLogic';
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
  const activateSlot = useDataStore((s) => s.activateSlot);
  const deactivateSlot = useDataStore((s) => s.deactivateSlot);
  const replaceAutoEntries = useDataStore((s) => s.replaceAutoEntries);

  const choices = useMemo(() => weekChoices(new Date()), []);
  const [weekKey, setWeekKey] = useState(week ?? choices[1].key); // default: příští týden

  const [hints, setHints] = useState<Hints>(new Set());

  const weekPlan = plans[weekKey];
  const activeSlots = weekPlan ? weekPlan.activeSlots : defaultActiveSlots(plans, weekKey);

  const cards = dayCards(weekKey, plans, recipes, activeSlots);
  const categoriesPlanned = plannedCategories(recipes, plans, weekKey);
  const summary = quotaSummaryLine(settings.dietRules, categoriesPlanned);
  const showReroll = hasAutoEntries(weekPlan, activeSlots);

  function selectWeek(key: string) {
    setWeekKey(key);
    setHints(new Set());
  }

  async function handleToggleSlot(slot: MealSlotKey) {
    const result = toggleSlotResult(weekPlan, slot);
    if (result.op === 'deactivate') {
      if (result.needsConfirm && !window.confirm(result.confirmText)) return;
      await deactivateSlot(weekKey, slot);
      return;
    }

    // First touch on a not-yet-stored week: persist the inherited defaults
    // before/with the toggled slot (decision 6), so future auto-fills and
    // reloads see the same activeSlots the chips already showed.
    if (!weekPlan) {
      for (const defaultSlot of defaultActiveSlots(plans, weekKey)) {
        await activateSlot(weekKey, defaultSlot);
      }
    }
    await activateSlot(weekKey, slot);
  }

  async function handleAutoFill() {
    const result = runAutoFill(
      { recipes, plans, sales, settings, week: weekKey, activeSlots },
      Math.random,
      () => crypto.randomUUID(),
    );
    if (result.op) await replaceAutoEntries(result.op.week, result.op.placements);
    setHints(new Set(result.hints.map((t) => hintKey(t.day, t.slot))));
  }

  async function handleReroll() {
    const result = runWeekReroll(
      { recipes, plans, sales, settings, week: weekKey, activeSlots },
      Math.random,
      () => crypto.randomUUID(),
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

      <div className="segmented">
        {SLOT_ORDER.map((slot) => (
          <button
            key={slot}
            type="button"
            className={activeSlots.includes(slot) ? 'segment segmentActive' : 'segment'}
            onClick={() => void handleToggleSlot(slot)}
          >
            {SLOT_LABELS[slot]}
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
                <a key={line.slot} href={line.mealDetailHash} className={styles.line}>
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
