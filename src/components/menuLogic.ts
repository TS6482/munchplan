import type { Route } from '../router/router';

export interface MenuItem {
  label: string;
  route: Route;
}

const SETTINGS_ITEM: MenuItem = { label: 'Nastavení', route: { name: 'settings' } };
const NEW_RECIPE_ITEM: MenuItem = { label: 'Nový recept', route: { name: 'recipeNew' } };

/** Contents of the floating "more options" menu, driven by the current route. */
export function menuItemsFor(route: Route): MenuItem[] {
  const items: MenuItem[] = [];
  if (
    route.name === 'plan' ||
    route.name === 'mealDetail' ||
    route.name === 'recipes' ||
    route.name === 'recipe' ||
    route.name === 'recipeNew'
  ) {
    items.push(NEW_RECIPE_ITEM);
  }
  items.push(SETTINGS_ITEM);
  return items;
}
