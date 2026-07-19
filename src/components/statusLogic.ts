/**
 * Pure state → global-status-banner mapping (step 10). No React, no store
 * writes here — `StatusBanner.tsx` just reads `useDataStore` and renders
 * whatever this returns.
 */

import type { LoadStatus } from '../store/data';

export type BannerKind = 'loading' | 'offline' | 'authError' | 'error' | 'saveError' | null;

export interface BannerInput {
  status: LoadStatus;
  offline: boolean;
  saveError: string | null;
}

export interface BannerOutput {
  kind: BannerKind;
  message: string | null;
}

/** Priority: authError > error > loading > saveError > offline > none. */
export function bannerFor({ status, offline, saveError }: BannerInput): BannerOutput {
  if (status === 'authError') {
    return { kind: 'authError', message: 'Token vypršel nebo nemá přístup k datovému repozitáři' };
  }
  if (status === 'error') {
    return { kind: 'error', message: 'Data se nepodařilo načíst' };
  }
  if (status === 'loading') {
    return { kind: 'loading', message: 'Načítám…' };
  }
  if (saveError) {
    return { kind: 'saveError', message: `Uložení selhalo: ${saveError}` };
  }
  if (offline) {
    return { kind: 'offline', message: 'Offline — zobrazuji poslední načtená data' };
  }
  return { kind: null, message: null };
}
