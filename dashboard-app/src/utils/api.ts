const CW_TOKEN_KEY = 'cw_token';
const LEGACY_TOKEN_KEY = 'cw-auth-token';

export const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export function getCwToken(): string {
  const raw = String(
    localStorage.getItem(CW_TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY) || '',
  ).trim();

  if (!raw) return '';

  if (raw.toLowerCase().startsWith('bearer ')) {
    return raw.slice(7).trim();
  }

  return raw;
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

export async function authFetch(input: string, options: RequestInit = {}): Promise<Response> {
  const token = getCwToken();
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(apiUrl(input), { ...options, headers });
}
