import type { IsoDay, MealSlotKey, WeekKey } from '../../types';
import { SLOT_LABELS } from '../../components/slotLabels';
import { routeHash } from '../../router/router';

interface MealDetailPageProps {
  week: WeekKey;
  day: IsoDay;
  slot: MealSlotKey;
}

/**
 * Placeholder for the meal detail route (feature 002, step 8). Renders just
 * enough to confirm the route wiring; entries, add flow, and reroll arrive
 * in step 9.
 */
function MealDetailPage({ week, day, slot }: MealDetailPageProps) {
  return (
    <div>
      <a href={routeHash({ name: 'plan', week })}>Zpět na plán</a>
      <h1>{SLOT_LABELS[slot]}</h1>
      <p>
        {day} · {week}
      </p>
    </div>
  );
}

export default MealDetailPage;
