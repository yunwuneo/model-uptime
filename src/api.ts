let csrf: string | null = null;
export function setCsrf(value: string | null) {
  csrf = value;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const response = await fetch('/api' + path, {
    method: options.method ?? 'GET',
    signal: options.signal,
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
      ...options.headers,
    },
    credentials: 'same-origin',
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(result.error ?? '请求失败', response.status);
  return result as T;
}
