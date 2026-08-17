import { describe, it, expect, beforeEach, vi } from 'vitest';

const session: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: {
    session: {
      get: async (k: string) => ({ [k]: session[k] }),
      set: async (o: Record<string, unknown>) => { Object.assign(session, o); },
      remove: async (k: string) => { delete session[k]; },
    },
  },
});

const { rememberPendingResume, takePendingResume } = await import('./pending-resume');

describe('pending-resume', () => {
  beforeEach(() => {
    for (const k of Object.keys(session)) delete session[k];
  });

  it("returns null when nothing is pending", async () => {
    expect(await takePendingResume()).toBeNull();
  });

  it('stores and reads back {videoId, tabId}', async () => {
    await rememberPendingResume({ videoId: 'v1', tabId: 42 });
    expect(await takePendingResume()).toEqual({ videoId: 'v1', tabId: 42 });
  });

  it('reading deletes the entry: a second call returns null and storage is empty', async () => {
    await rememberPendingResume({ videoId: 'v1', tabId: 42 });
    await takePendingResume();
    expect(await takePendingResume()).toBeNull();
    expect(session).toEqual({});
  });

  it('a new call overwrites the previous resume rather than accumulating', async () => {
    await rememberPendingResume({ videoId: 'v1', tabId: 1 });
    await rememberPendingResume({ videoId: 'v2', tabId: 2 });
    expect(await takePendingResume()).toEqual({ videoId: 'v2', tabId: 2 });
  });
});
