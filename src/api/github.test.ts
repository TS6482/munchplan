import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthError,
  ConflictError,
  NetworkError,
  SchemaError,
  getFile,
  probeRepo,
  putFile,
  saveWithRetry,
  type GithubConfig,
} from './github';

const cfg: GithubConfig = { owner: 'ts6482', repo: 'munchplan-data', token: 'test-pat-123' };

/** Test-local base64 encoder, independent of the implementation's own helper. */
function encodeBase64Utf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Test-local base64 decoder, independent of the implementation's own helper. */
function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

/** Inserts a newline every `width` chars, mimicking GitHub's wrapped base64 content field. */
function withEmbeddedNewlines(b64: string, width = 20): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += width) {
    lines.push(b64.slice(i, i + width));
  }
  return lines.join('\n');
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('probeRepo', () => {
  it('resolves on 200', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await expect(probeRepo(cfg)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}`);
    expect((options.headers as Record<string, string>).Authorization).toBe(`Bearer ${cfg.token}`);
    expect((options.headers as Record<string, string>).Accept).toBe('application/vnd.github+json');
  });

  it('throws AuthError on 404 (masked private repo, never treated as first-run)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));
    await expect(probeRepo(cfg)).rejects.toBeInstanceOf(AuthError);
  });

  it('throws AuthError on 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    await expect(probeRepo(cfg)).rejects.toBeInstanceOf(AuthError);
  });

  it('throws AuthError on 403', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, {}));
    await expect(probeRepo(cfg)).rejects.toBeInstanceOf(AuthError);
  });

  it('throws NetworkError when fetch itself rejects', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(probeRepo(cfg)).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('getFile', () => {
  const path = 'recipes.json';
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;

  it('requests the correct URL and headers', async () => {
    const wrapped = { schemaVersion: 1, data: { name: 'kuřecí stehna' } };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { content: encodeBase64Utf8(JSON.stringify(wrapped)), sha: 'abc123' }),
    );
    await getFile(cfg, path);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, options] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(url);
    expect((options.headers as Record<string, string>).Authorization).toBe(`Bearer ${cfg.token}`);
    expect((options.headers as Record<string, string>).Accept).toBe('application/vnd.github+json');
  });

  it('decodes base64 content with embedded newlines, UTF-8 safe (Czech round-trip)', async () => {
    const wrapped = { schemaVersion: 1, data: { name: 'kuřecí stehna' } };
    const b64 = withEmbeddedNewlines(encodeBase64Utf8(JSON.stringify(wrapped)));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { content: b64, sha: 'sha-1' }));

    const result = await getFile<{ name: string }>(cfg, path);

    expect(result).toEqual({ data: { name: 'kuřecí stehna' }, sha: 'sha-1' });
  });

  it('returns null on 404 (file not yet created)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));
    const result = await getFile(cfg, path);
    expect(result).toBeNull();
  });

  it('throws AuthError on 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    await expect(getFile(cfg, path)).rejects.toBeInstanceOf(AuthError);
  });

  it('throws AuthError on 403', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, {}));
    await expect(getFile(cfg, path)).rejects.toBeInstanceOf(AuthError);
  });

  it('throws SchemaError when schemaVersion is greater than 1', async () => {
    const wrapped = { schemaVersion: 2, data: { name: 'x' } };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { content: encodeBase64Utf8(JSON.stringify(wrapped)), sha: 'sha-2' }),
    );
    await expect(getFile(cfg, path)).rejects.toBeInstanceOf(SchemaError);
  });

  it('throws SchemaError on malformed JSON content (decision: treated as schema error, not a crash)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { content: encodeBase64Utf8('not json{{{'), sha: 'sha-3' }));
    await expect(getFile(cfg, path)).rejects.toBeInstanceOf(SchemaError);
  });

  it('throws NetworkError when fetch itself rejects', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(getFile(cfg, path)).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('putFile', () => {
  const path = 'recipes.json';
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;

  function decodeRequestBodyContent(options: { body?: string }): { schemaVersion: number; data: unknown } {
    const parsedBody = JSON.parse(options.body ?? '{}') as { content: string };
    return JSON.parse(decodeBase64Utf8(parsedBody.content)) as { schemaVersion: number; data: unknown };
  }

  it('sends base64 UTF-8 body with schemaVersion 1 and the Czech string intact, and includes sha when passed', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { content: { sha: 'new-sha-1' } }));

    const sha = await putFile(cfg, path, { name: 'kuřecí stehna' }, 'old-sha');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, options] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(url);
    expect(options.method).toBe('PUT');
    expect((options.headers as Record<string, string>).Authorization).toBe(`Bearer ${cfg.token}`);
    expect((options.headers as Record<string, string>).Accept).toBe('application/vnd.github+json');

    const parsedBody = JSON.parse(options.body as string) as { content: string; sha?: string; message: string };
    expect(parsedBody.content).toBeDefined();
    expect(parsedBody.sha).toBe('old-sha');
    expect(parsedBody.message).toContain(path);

    const decoded = decodeRequestBodyContent(options);
    expect(decoded).toEqual({ schemaVersion: 1, data: { name: 'kuřecí stehna' } });

    expect(sha).toBe('new-sha-1');
  });

  it('omits sha from the request body when not passed (file creation)', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { content: { sha: 'created-sha' } }));

    await putFile(cfg, path, { name: 'x' });

    const [, options] = fetchMock.mock.calls[0];
    const parsedBody = JSON.parse(options.body as string) as { sha?: string };
    expect(parsedBody.sha).toBeUndefined();
  });

  it('returns the new sha on 201', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { content: { sha: 'created-sha' } }));
    const sha = await putFile(cfg, path, { name: 'x' });
    expect(sha).toBe('created-sha');
  });

  it('throws ConflictError on 409', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(409, {}));
    await expect(putFile(cfg, path, { name: 'x' }, 'sha')).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws ConflictError on 422', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(422, {}));
    await expect(putFile(cfg, path, { name: 'x' }, 'sha')).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws AuthError on 401', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    await expect(putFile(cfg, path, { name: 'x' }, 'sha')).rejects.toBeInstanceOf(AuthError);
  });

  it('throws NetworkError when fetch itself rejects', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(putFile(cfg, path, { name: 'x' })).rejects.toBeInstanceOf(NetworkError);
  });
});

describe('saveWithRetry', () => {
  const path = 'pantry.json';
  interface TestData {
    items: string[];
  }
  interface AddOp {
    add: string;
  }

  const apply = vi.fn((op: AddOp, remote: TestData): TestData => ({ items: [...remote.items, op.add] }));

  beforeEach(() => {
    apply.mockClear();
  });

  it('happy path: one PUT, returns local result with new sha', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { content: { sha: 'sha-2' } }));

    const base = { data: { items: ['a'] }, sha: 'sha-1' };
    const result = await saveWithRetry<TestData, AddOp>(cfg, path, { add: 'b' }, apply, base, { items: [] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ data: { items: ['a', 'b'] }, sha: 'sha-2' });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ add: 'b' }, { items: ['a'] });
  });

  it('conflict path: PUT 409 -> GET returns newer remote -> apply(op, remote) -> retry PUT succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(409, {})) // first PUT
      .mockResolvedValueOnce(
        jsonResponse(200, {
          content: encodeBase64Utf8(JSON.stringify({ schemaVersion: 1, data: { items: ['a', 'x'] } })),
          sha: 'sha-remote',
        }),
      ) // GET refetch
      .mockResolvedValueOnce(jsonResponse(200, { content: { sha: 'sha-final' } })); // retry PUT

    const base = { data: { items: ['a'] }, sha: 'sha-1' };
    const result = await saveWithRetry<TestData, AddOp>(cfg, path, { add: 'b' }, apply, base, { items: [] });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ data: { items: ['a', 'x', 'b'] }, sha: 'sha-final' });

    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenNthCalledWith(1, { add: 'b' }, { items: ['a'] });
    // Second call must use REMOTE data, not the stale local base.
    expect(apply).toHaveBeenNthCalledWith(2, { add: 'b' }, { items: ['a', 'x'] });

    // The retry PUT must be sent against the remote's sha, not the stale local sha.
    const [, retryOptions] = fetchMock.mock.calls[2];
    const retryBody = JSON.parse(retryOptions.body as string) as { sha?: string };
    expect(retryBody.sha).toBe('sha-remote');
  });

  it('double conflict: second PUT also 409 -> rethrows ConflictError', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(409, {})) // first PUT
      .mockResolvedValueOnce(
        jsonResponse(200, {
          content: encodeBase64Utf8(JSON.stringify({ schemaVersion: 1, data: { items: ['a', 'x'] } })),
          sha: 'sha-remote',
        }),
      ) // GET refetch
      .mockResolvedValueOnce(jsonResponse(409, {})); // retry PUT also conflicts

    const base = { data: { items: ['a'] }, sha: 'sha-1' };
    await expect(
      saveWithRetry<TestData, AddOp>(cfg, path, { add: 'b' }, apply, base, { items: [] }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('NetworkError on first PUT propagates immediately without retry', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    const base = { data: { items: ['a'] }, sha: 'sha-1' };
    await expect(
      saveWithRetry<TestData, AddOp>(cfg, path, { add: 'b' }, apply, base, { items: [] }),
    ).rejects.toBeInstanceOf(NetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('AuthError on first PUT propagates immediately without retry', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));

    const base = { data: { items: ['a'] }, sha: 'sha-1' };
    await expect(
      saveWithRetry<TestData, AddOp>(cfg, path, { add: 'b' }, apply, base, { items: [] }),
    ).rejects.toBeInstanceOf(AuthError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('base null (file creation): applies op to emptyData and calls putFile without sha', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { content: { sha: 'sha-new' } }));

    const result = await saveWithRetry<TestData, AddOp>(cfg, path, { add: 'a' }, apply, null, { items: [] });

    expect(result).toEqual({ data: { items: ['a'] }, sha: 'sha-new' });
    const [, options] = fetchMock.mock.calls[0];
    const parsedBody = JSON.parse(options.body as string) as { sha?: string };
    expect(parsedBody.sha).toBeUndefined();
  });
});
