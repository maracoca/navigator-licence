import type {
  HealthResponse,
  PlanRequest,
  PlanResponse,
  UnderstandRequest,
  UnderstandResponse,
} from './types';
import { MOCK_HEALTH, mockPlan, mockUnderstand } from './mock';

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
export const MOCK = process.env.EXPO_PUBLIC_MOCK === '1';

// Planning queries several place sources and a street graph, so allow a generous wait.
const TIMEOUT_MS = 90_000;

export class ApiRequestError extends Error {}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  if (!API_URL) {
    throw new ApiRequestError(
      'No server configured. Set EXPO_PUBLIC_API_URL (e.g. http://192.168.1.20:3000) or EXPO_PUBLIC_MOCK=1.',
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    throw new ApiRequestError(
      aborted
        ? 'The server took too long to answer.'
        : `Cannot reach the server at ${API_URL}. Is it running, and are the phone and computer on the same Wi-Fi?`,
    );
  } finally {
    clearTimeout(timer);
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body; handled below.
  }
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Server error (HTTP ${res.status}).`;
    throw new ApiRequestError(msg);
  }
  if (data === null) throw new ApiRequestError('The server sent an invalid response.');
  return data as T;
}

export function health(): Promise<HealthResponse> {
  return MOCK ? Promise.resolve(MOCK_HEALTH) : request('GET', '/api/health');
}

export function understand(body: UnderstandRequest): Promise<UnderstandResponse> {
  return MOCK ? mockUnderstand(body) : request('POST', '/api/understand', body);
}

export function plan(body: PlanRequest): Promise<PlanResponse> {
  return MOCK ? mockPlan(body) : request('POST', '/api/plan', body);
}
