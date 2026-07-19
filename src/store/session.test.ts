import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `session.ts` reads localStorage at module load time, so every test needs a
 * fresh module instance imported *after* the localStorage stub for that test
 * is in place (`vi.resetModules()` + dynamic `import`).
 */

function makeLocalStorageMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => (store.has(key) ? (store.get(key) as string) : null)),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => store.clear()),
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('session store', () => {
  it('setConfig persists to localStorage and sets configured true', async () => {
    const storage = makeLocalStorageMock();
    vi.stubGlobal('localStorage', storage);

    const { useSessionStore } = await import('./session');
    useSessionStore.getState().setConfig('ts6482', 'munchplan-data', 'pat-123');

    const state = useSessionStore.getState();
    expect(state).toMatchObject({ owner: 'ts6482', repo: 'munchplan-data', token: 'pat-123', configured: true });
    expect(storage.setItem).toHaveBeenCalledWith(
      'munchplan.session',
      JSON.stringify({ owner: 'ts6482', repo: 'munchplan-data', token: 'pat-123' }),
    );
  });

  it('clearConfig resets state and removes the localStorage entry', async () => {
    const storage = makeLocalStorageMock();
    vi.stubGlobal('localStorage', storage);

    const { useSessionStore } = await import('./session');
    useSessionStore.getState().setConfig('ts6482', 'munchplan-data', 'pat-123');
    useSessionStore.getState().clearConfig();

    const state = useSessionStore.getState();
    expect(state).toMatchObject({ owner: '', repo: '', token: '', configured: false });
    expect(storage.removeItem).toHaveBeenCalledWith('munchplan.session');
  });

  it('loads pre-populated localStorage on module init and marks configured', async () => {
    const storage = makeLocalStorageMock({
      'munchplan.session': JSON.stringify({ owner: 'device-b', repo: 'munchplan-data', token: 'pat-b' }),
    });
    vi.stubGlobal('localStorage', storage);

    const { useSessionStore } = await import('./session');
    const state = useSessionStore.getState();

    expect(state).toMatchObject({ owner: 'device-b', repo: 'munchplan-data', token: 'pat-b', configured: true });
  });

  it('is resilient when localStorage does not exist (node test env default)', async () => {
    vi.stubGlobal('localStorage', undefined);

    const { useSessionStore } = await import('./session');
    expect(() => useSessionStore.getState().setConfig('a', 'b', 'c')).not.toThrow();
    expect(useSessionStore.getState().configured).toBe(true);
  });
});
