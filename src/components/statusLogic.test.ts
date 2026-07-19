import { describe, expect, it } from 'vitest';
import { bannerFor } from './statusLogic';

describe('bannerFor', () => {
  it('shows loading banner', () => {
    expect(bannerFor({ status: 'loading', offline: false, saveError: null })).toEqual({
      kind: 'loading',
      message: 'Načítám…',
    });
  });

  it('shows offline banner', () => {
    expect(bannerFor({ status: 'ready', offline: true, saveError: null })).toEqual({
      kind: 'offline',
      message: 'Offline — zobrazuji poslední načtená data',
    });
  });

  it('shows auth error banner', () => {
    expect(bannerFor({ status: 'authError', offline: false, saveError: null })).toEqual({
      kind: 'authError',
      message: 'Token vypršel nebo nemá přístup k datovému repozitáři',
    });
  });

  it('shows generic load error banner', () => {
    expect(bannerFor({ status: 'error', offline: false, saveError: null })).toEqual({
      kind: 'error',
      message: 'Data se nepodařilo načíst',
    });
  });

  it('shows save error banner with the underlying message', () => {
    expect(bannerFor({ status: 'ready', offline: false, saveError: 'Conflict' })).toEqual({
      kind: 'saveError',
      message: 'Uložení selhalo: Conflict',
    });
  });

  it('shows nothing when everything is fine', () => {
    expect(bannerFor({ status: 'ready', offline: false, saveError: null })).toEqual({ kind: null, message: null });
  });

  it('shows nothing when idle', () => {
    expect(bannerFor({ status: 'idle', offline: false, saveError: null })).toEqual({ kind: null, message: null });
  });

  it('prioritizes authError over everything else', () => {
    expect(bannerFor({ status: 'authError', offline: true, saveError: 'x' })).toEqual({
      kind: 'authError',
      message: 'Token vypršel nebo nemá přístup k datovému repozitáři',
    });
  });

  it('prioritizes error over loading, saveError, and offline', () => {
    expect(bannerFor({ status: 'error', offline: true, saveError: 'x' })).toEqual({
      kind: 'error',
      message: 'Data se nepodařilo načíst',
    });
  });

  it('prioritizes loading over saveError and offline', () => {
    expect(bannerFor({ status: 'loading', offline: true, saveError: 'x' })).toEqual({
      kind: 'loading',
      message: 'Načítám…',
    });
  });

  it('prioritizes saveError over offline', () => {
    expect(bannerFor({ status: 'ready', offline: true, saveError: 'x' })).toEqual({
      kind: 'saveError',
      message: 'Uložení selhalo: x',
    });
  });
});
