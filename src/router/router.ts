export type Route =
  | { name: 'plan' }
  | { name: 'recipes' }
  | { name: 'recipeNew' }
  | { name: 'recipe'; id: string }
  | { name: 'shopping' }
  | { name: 'zasoby' }
  | { name: 'settings' };

const PLAN_ROUTE: Route = { name: 'plan' };

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
    case 'plan':
      return PLAN_ROUTE;
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
      return '#/plan';
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
