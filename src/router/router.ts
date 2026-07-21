import type { IsoDay, MealSlotKey, WeekKey } from '../types';
import { SLOT_ORDER } from '../types';
import { ISO_DAYS, WEEK_KEY_RE } from '../engine/week';

export type Route =
  | { name: 'plan'; week?: WeekKey }
  | { name: 'mealDetail'; week: WeekKey; day: IsoDay; slot: MealSlotKey }
  | { name: 'recipes' }
  | { name: 'recipeNew' }
  | { name: 'recipe'; id: string }
  | { name: 'shopping' }
  | { name: 'zasoby' }
  | { name: 'settings' };

const PLAN_ROUTE: Route = { name: 'plan' };

function isIsoDay(value: string): value is IsoDay {
  return (ISO_DAYS as string[]).includes(value);
}

function isMealSlotKey(value: string): value is MealSlotKey {
  return (SLOT_ORDER as string[]).includes(value);
}

/** Pure hash parsing — no DOM/window access here so it stays unit-testable in node. */
export function parseRoute(hash: string): Route {
  const segments = hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean);

  if (segments.length === 0) {
    return PLAN_ROUTE;
  }

  switch (segments[0]) {
    case 'plan': {
      if (segments.length === 1) return PLAN_ROUTE;
      const week = segments[1];
      if (!WEEK_KEY_RE.test(week)) return PLAN_ROUTE;
      if (segments.length === 2) return { name: 'plan', week };
      const day = segments[2];
      const slot = segments[3];
      if (!slot || !isIsoDay(day) || !isMealSlotKey(slot)) return PLAN_ROUTE;
      return { name: 'mealDetail', week, day, slot };
    }
    case 'recepty':
      if (!segments[1]) return { name: 'recipes' };
      return segments[1] === 'novy' ? { name: 'recipeNew' } : { name: 'recipe', id: segments[1] };
    case 'nakup':
      return { name: 'shopping' };
    case 'zasoby':
      return { name: 'zasoby' };
    case 'nastaveni':
      return { name: 'settings' };
    default:
      return PLAN_ROUTE;
  }
}

/** Inverse of parseRoute, for building links. */
export function routeHash(route: Route): string {
  switch (route.name) {
    case 'plan':
      return route.week ? `#/plan/${route.week}` : '#/plan';
    case 'mealDetail':
      return `#/plan/${route.week}/${route.day}/${route.slot}`;
    case 'recipes':
      return '#/recepty';
    case 'recipeNew':
      return '#/recepty/novy';
    case 'recipe':
      return `#/recepty/${route.id}`;
    case 'shopping':
      return '#/nakup';
    case 'zasoby':
      return '#/zasoby';
    case 'settings':
      return '#/nastaveni';
  }
}

/** Touches window — kept separate from the pure parsing above. */
export function navigate(route: Route): void {
  window.location.hash = routeHash(route);
}
