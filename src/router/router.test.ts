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
});

describe('routeHash', () => {
  const routes: Route[] = [
    { name: 'plan' },
    { name: 'recipes' },
    { name: 'recipe', id: 'abc' },
    { name: 'shopping' },
    { name: 'zasoby' },
    { name: 'settings' },
  ];

  it.each(routes)('round-trips through parseRoute: $name', (route) => {
    expect(parseRoute(routeHash(route))).toEqual(route);
  });
});
