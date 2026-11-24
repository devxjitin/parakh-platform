import type { AuthResponse } from '@parakh/shared';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

// The access token lives only in memory. The refresh token is an httpOnly cookie the browser
// sends automatically, so no token is ever readable by page scripts or stored in localStorage.
let accessToken: string | null = null;
let refreshing: Promise<AuthResponse | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** JSON-serialised unless it is FormData (file uploads). */
  body?: unknown;
  /** Send the access token (default true). */
  auth?: boolean;
}

/**
 * A random id for this browser, kept in localStorage. The server ties a running exam attempt to
 * it, so the attempt cannot be carried on from a second device by accident or on purpose.
 */
export function deviceId(): string {
  try {
    let id = localStorage.getItem('aiq-device');
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      id = crypto.randomUUID();
      localStorage.setItem('aiq-device', id);
    }
    return id;
  } catch {
    return '';
  }
}

async function send(path: string, { method = 'GET', body, auth = true }: Options) {
  const headers: Record<string, string> = {};
  const device = typeof window === 'undefined' ? '' : deviceId();
  if (device) headers['X-Device-Id'] = device;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(`${API_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
  });
}

async function toError(res: Response): Promise<ApiError> {
  let data: { message?: string | string[]; code?: string; errors?: Record<string, string[]> } = {};
  try {
    data = await res.json();
  } catch {
    // not JSON
  }
  const message = Array.isArray(data.message) ? data.message.join(', ') : data.message;
  return new ApiError(message ?? 'Something went wrong', res.status, data.code, data.errors);
}

/** Exchanges the refresh cookie for a new access token. Resolves to null when signed out. */
export function refreshSession(): Promise<AuthResponse | null> {
  // Share one in-flight refresh: refresh tokens rotate, so two parallel calls would clash.
  refreshing ??= (async () => {
    try {
      const res = await send('/auth/refresh', { method: 'POST', auth: false });
      if (!res.ok) {
        accessToken = null;
        return null;
      }
      const data = (await res.json()) as AuthResponse;
      accessToken = data.accessToken;
      return data;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Fetches a private file (needs the access token, so it cannot be a plain <img src>). */
export async function apiBlob(path: string, options: Options = {}): Promise<Blob> {
  let res = await send(path, options);
  if (res.status === 401) {
    const renewed = await refreshSession();
    if (renewed) res = await send(path, options);
  }
  if (!res.ok) throw await toError(res);
  return res.blob();
}

export async function api<T = unknown>(path: string, options: Options = {}): Promise<T> {
  let res = await send(path, options);

  if (res.status === 401 && options.auth !== false && !path.startsWith('/auth/')) {
    const renewed = await refreshSession();
    if (renewed) res = await send(path, options);
  }

  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  // A route that returns null sends an empty body, which is not valid JSON.
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}
