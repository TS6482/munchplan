/**
 * Czech label map for the four recipe component types (feature 004),
 * shared by the recipe form and detail pages.
 */

import type { ComponentType } from '../types';

export const COMPONENT_TYPE_LABELS: Record<ComponentType, string> = {
  full: 'samostatné jídlo',
  main: 'hlavní jídlo',
  side: 'příloha',
  salad: 'salát',
};
