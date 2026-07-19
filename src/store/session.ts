/**
 * Device-local session config (owner/repo/PAT), persisted to localStorage.
 *
 * `localStorage` access is wrapped defensively: node-env unit tests run
 * without a `localStorage` global at all, and even in a browser it can throw
 * (private mode, quota). Both cases degrade to "no persisted session"
 * rather than crashing the store.
 */

import { create } from 'zustand';

const STORAGE_KEY = 'munchplan.session';

interface StoredSession {
  owner: string;
  repo: string;
  token: string;
}

function readStoredSession(): StoredSession | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredSession | null): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (session === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage unavailable (private mode, quota) — session just won't persist.
  }
}

function isConfigured(owner: string, repo: string, token: string): boolean {
  return owner !== '' && repo !== '' && token !== '';
}

export interface SessionState {
  owner: string;
  repo: string;
  token: string;
  configured: boolean;
  setConfig: (owner: string, repo: string, token: string) => void;
  clearConfig: () => void;
}

const initial = readStoredSession();

export const useSessionStore = create<SessionState>()((set) => ({
  owner: initial?.owner ?? '',
  repo: initial?.repo ?? '',
  token: initial?.token ?? '',
  configured: initial !== null && isConfigured(initial.owner, initial.repo, initial.token),
  setConfig: (owner, repo, token) => {
    writeStoredSession({ owner, repo, token });
    set({ owner, repo, token, configured: isConfigured(owner, repo, token) });
  },
  clearConfig: () => {
    writeStoredSession(null);
    set({ owner: '', repo: '', token: '', configured: false });
  },
}));
