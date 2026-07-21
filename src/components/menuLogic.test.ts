import { describe, expect, it } from 'vitest';
import { menuItemsFor } from './menuLogic';

describe('menuItemsFor', () => {
  it('plan route: Nový recept then Nastavení', () => {
    expect(menuItemsFor({ name: 'plan' })).toEqual([
      { label: 'Nový recept', route: { name: 'recipeNew' } },
      { label: 'Nastavení', route: { name: 'settings' } },
    ]);
  });

  it('recipes route: Nový recept then Nastavení', () => {
    expect(menuItemsFor({ name: 'recipes' })).toEqual([
      { label: 'Nový recept', route: { name: 'recipeNew' } },
      { label: 'Nastavení', route: { name: 'settings' } },
    ]);
  });

  it('recipe detail route: Nový recept then Nastavení', () => {
    expect(menuItemsFor({ name: 'recipe', id: 'abc' })).toEqual([
      { label: 'Nový recept', route: { name: 'recipeNew' } },
      { label: 'Nastavení', route: { name: 'settings' } },
    ]);
  });

  it('recipeNew route: Nový recept then Nastavení', () => {
    expect(menuItemsFor({ name: 'recipeNew' })).toEqual([
      { label: 'Nový recept', route: { name: 'recipeNew' } },
      { label: 'Nastavení', route: { name: 'settings' } },
    ]);
  });

  it('mealDetail route: Nový recept then Nastavení (step 8, decision 9)', () => {
    expect(menuItemsFor({ name: 'mealDetail', week: '2026-W30', day: 'wed', slot: 'dinner' })).toEqual([
      { label: 'Nový recept', route: { name: 'recipeNew' } },
      { label: 'Nastavení', route: { name: 'settings' } },
    ]);
  });

  it('settings route: only Nastavení', () => {
    expect(menuItemsFor({ name: 'settings' })).toEqual([{ label: 'Nastavení', route: { name: 'settings' } }]);
  });
});
