import { describe, expect, it } from 'vitest';
import { parseRoute, routeHash, type Route } from './router';

describe('parseRoute', () => {
  it('maps empty hash to plan (home)', () => {
    expect(parseRoute('')).toEqual({ name: 'plan' });
  });

  it('maps bare "#" to plan', () => {
    expect(parseRoute('#')).toEqual({ name: 'plan' });
  });

  it('maps "#/" to plan', () => {
    expect(parseRoute('#/')).toEqual({ name: 'plan' });
  });

  it('maps "#/plan" to plan', () => {
    expect(parseRoute('#/plan')).toEqual({ name: 'plan' });
  });

  it('maps "#/recepty" to the recipes list', () => {
    expect(parseRoute('#/recepty')).toEqual({ name: 'recipes' });
  });

  it('extracts the id from "#/recepty/<id>"', () => {
    expect(parseRoute('#/recepty/abc')).toEqual({ name: 'recipe', id: 'abc' });
  });

  it('maps "#/recepty/novy" to recipeNew, not a recipe detail', () => {
    expect(parseRoute('#/recepty/novy')).toEqual({ name: 'recipeNew' });
  });

  it('maps "#/nakup" to shopping', () => {
    expect(parseRoute('#/nakup')).toEqual({ name: 'shopping' });
  });

  it('maps "#/zasoby" to zasoby', () => {
    expect(parseRoute('#/zasoby')).toEqual({ name: 'zasoby' });
  });

  it('maps "#/nastaveni" to settings', () => {
    expect(parseRoute('#/nastaveni')).toEqual({ name: 'settings' });
  });

  it('maps an unknown hash to plan (default)', () => {
    expect(parseRoute('#/xyz')).toEqual({ name: 'plan' });
  });

  // Step 8 (feature 002): optional week segment on the plan route, and the
  // meal detail route (week, day, slot).
  describe('plan route week segment', () => {
    it('"#/plan/2026-W30" -> plan with week (back-navigation keeps the viewed week)', () => {
      expect(parseRoute('#/plan/2026-W30')).toEqual({ name: 'plan', week: '2026-W30' });
    });

    it('"#/plan" alone still maps to plan with no week', () => {
      expect(parseRoute('#/plan')).toEqual({ name: 'plan' });
    });
  });

  describe('meal detail route', () => {
    it('"#/plan/2026-W30/wed/dinner" -> mealDetail', () => {
      expect(parseRoute('#/plan/2026-W30/wed/dinner')).toEqual({
        name: 'mealDetail',
        week: '2026-W30',
        day: 'wed',
        slot: 'dinner',
      });
    });

    it.each(['2026-W3', 'abc'])('falls back to plan (no week) for a malformed week key "%s"', (week) => {
      expect(parseRoute(`#/plan/${week}/wed/dinner`)).toEqual({ name: 'plan' });
    });

    it('falls back to plan for an unknown day', () => {
      expect(parseRoute('#/plan/2026-W30/xyz/dinner')).toEqual({ name: 'plan' });
    });

    it('falls back to plan for an unknown slot', () => {
      expect(parseRoute('#/plan/2026-W30/wed/brunch')).toEqual({ name: 'plan' });
    });

    it('falls back to plan for missing segments (day present, slot missing)', () => {
      expect(parseRoute('#/plan/2026-W30/wed')).toEqual({ name: 'plan' });
    });
  });
});

describe('routeHash', () => {
  const routes: Route[] = [
    { name: 'plan' },
    { name: 'plan', week: '2026-W30' },
    { name: 'mealDetail', week: '2026-W30', day: 'wed', slot: 'dinner' },
    { name: 'recipes' },
    { name: 'recipe', id: 'abc' },
    { name: 'recipeNew' },
    { name: 'shopping' },
    { name: 'zasoby' },
    { name: 'settings' },
  ];

  it.each(routes)('round-trips through parseRoute: $name', (route) => {
    expect(parseRoute(routeHash(route))).toEqual(route);
  });

  it('plan with week produces "#/plan/2026-W30"', () => {
    expect(routeHash({ name: 'plan', week: '2026-W30' })).toBe('#/plan/2026-W30');
  });

  it('plan without week produces "#/plan"', () => {
    expect(routeHash({ name: 'plan' })).toBe('#/plan');
  });

  it('mealDetail produces "#/plan/2026-W30/wed/dinner"', () => {
    expect(routeHash({ name: 'mealDetail', week: '2026-W30', day: 'wed', slot: 'dinner' })).toBe(
      '#/plan/2026-W30/wed/dinner',
    );
  });
});
