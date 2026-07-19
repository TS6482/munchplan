/**
 * GitHub Contents API storage layer (step 8).
 *
 * Design decisions:
 * - `probeRepo` gates every load (step 9): GitHub masks inaccessible private
 *   repos as 404, so 401/403/404 are all treated as `AuthError` here — a
 *   blanket 404 must never be read as "first run".
 * - Base64 content is always bridged through `TextEncoder`/`TextDecoder`,
 *   never bare `atob`/`btoa` on a JS string, so Czech diacritics round-trip
 *   correctly (UTF-8, not Latin-1).
 * - Any HTTP response GitHub returns that isn't explicitly handled (e.g. a
 *   5xx) is treated as `NetworkError` — a deliberate catch-all so callers
 *   only ever deal with the four typed errors below, never a raw `Error`.
 * - Malformed JSON in a stored file (and `schemaVersion !== 1`, including
 *   both older/missing and newer versions) is reported as `SchemaError`
 *   rather than crashing — a corrupt or unreadable file should never trigger
 *   a destructive write.
 */

export interface GithubConfig {
  owner: string;
  repo: string;
  token: string;
}

export class AuthError extends Error {
  constructor(message = 'Authentication failed or repo inaccessible') {
    super(message);
    this.name = 'AuthError';
  }
}

export class ConflictError extends Error {
  constructor(message = 'Write conflict') {
    super(message);
    this.name = 'ConflictError';
  }
}

export class NetworkError extends Error {
  constructor(message = 'Network request failed') {
    super(message);
    this.name = 'NetworkError';
  }
}

export class SchemaError extends Error {
  constructor(message = 'Unsupported or invalid file schema') {
    super(message);
    this.name = 'SchemaError';
  }
}

const API_BASE = 'https://api.github.com';

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
}

/** Wraps `fetch` so a rejected fetch promise (offline/DNS/etc.) becomes a typed `NetworkError`. */
async function request(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new NetworkError(`Network request failed: ${url}`);
  }
}

/** Base64-encodes a string via its UTF-8 byte representation (never a bare `btoa(str)`). */
function encodeBase64Utf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/** Decodes base64 (possibly line-wrapped) back to a UTF-8 string (never a bare `atob` result). */
function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Probes repo access before any load. 200 resolves; 401/403/404 all mean
 * "no usable access" (GitHub masks private-repo-not-found as 404) and throw
 * `AuthError`; anything else unexpected is a `NetworkError`.
 */
export async function probeRepo(cfg: GithubConfig): Promise<void> {
  const url = `${API_BASE}/repos/${cfg.owner}/${cfg.repo}`;
  const res = await request(url, { headers: authHeaders(cfg.token) });

  if (res.ok) return;
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    throw new AuthError(`No access to ${cfg.owner}/${cfg.repo} (status ${res.status})`);
  }
  throw new NetworkError(`Unexpected response probing ${cfg.owner}/${cfg.repo} (status ${res.status})`);
}

interface GithubGetContentResponse {
  content: string;
  sha: string;
}

interface StoredFile<T> {
  schemaVersion: number;
  data: T;
}

/**
 * Fetches a data file. Returns `null` when the file doesn't exist yet (404 —
 * a legitimate "not created" state, distinct from `AuthError`).
 */
export async function getFile<T>(cfg: GithubConfig, path: string): Promise<{ data: T; sha: string } | null> {
  const url = `${API_BASE}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;
  const res = await request(url, { headers: authHeaders(cfg.token) });

  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) throw new AuthError(`Not authorized to read ${path}`);
  if (!res.ok) throw new NetworkError(`Unexpected response reading ${path} (status ${res.status})`);

  const body = (await res.json()) as GithubGetContentResponse;
  const jsonText = decodeBase64Utf8(body.content);

  let parsed: StoredFile<T>;
  try {
    parsed = JSON.parse(jsonText) as StoredFile<T>;
  } catch {
    throw new SchemaError(`Malformed JSON in ${path}`);
  }

  if (parsed.schemaVersion !== 1) {
    throw new SchemaError(`Unsupported schemaVersion ${parsed.schemaVersion} in ${path}`);
  }

  return { data: parsed.data, sha: body.sha };
}

/**
 * Writes a data file wrapped in the `{schemaVersion: 1, data}` envelope.
 * `sha` is included only when provided (update); omitted creates the file.
 * Returns the new sha on success; 409/422 (GitHub uses either for a sha
 * mismatch) becomes `ConflictError`.
 */
export async function putFile<T>(cfg: GithubConfig, path: string, data: T, sha?: string): Promise<string> {
  const url = `${API_BASE}/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;
  const jsonText = JSON.stringify({ schemaVersion: 1, data }, null, 2);
  const content = encodeBase64Utf8(jsonText);

  const requestBody: Record<string, unknown> = { message: `update ${path}`, content };
  if (sha !== undefined) requestBody.sha = sha;

  const res = await request(url, {
    method: 'PUT',
    headers: { ...authHeaders(cfg.token), 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (res.status === 409 || res.status === 422) throw new ConflictError(`Conflict writing ${path}`);
  if (res.status === 401 || res.status === 403) throw new AuthError(`Not authorized to write ${path}`);
  if (!res.ok) throw new NetworkError(`Unexpected response writing ${path} (status ${res.status})`);

  const responseBody = (await res.json()) as { content: { sha: string } };
  return responseBody.content.sha;
}

/**
 * Applies a named operation to a file with exactly one conflict retry: on
 * `ConflictError`, refetch remote and re-apply the operation on top of it
 * (never a state union), then retry the write once. A second conflict
 * rethrows `ConflictError`; `AuthError`/`NetworkError` from the first write
 * propagate immediately with no retry.
 */
export async function saveWithRetry<T, Op>(
  cfg: GithubConfig,
  path: string,
  op: Op,
  apply: (op: Op, remote: T) => T,
  base: { data: T; sha: string } | null,
  emptyData: T,
): Promise<{ data: T; sha: string }> {
  const localResult = apply(op, base?.data ?? emptyData);

  try {
    const sha = await putFile(cfg, path, localResult, base?.sha);
    return { data: localResult, sha };
  } catch (err) {
    if (!(err instanceof ConflictError)) throw err;
  }

  const remote = await getFile<T>(cfg, path);
  const merged = apply(op, remote?.data ?? emptyData);
  const sha = await putFile(cfg, path, merged, remote?.sha);
  return { data: merged, sha };
}
