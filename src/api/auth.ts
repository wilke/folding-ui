const AUTH_BASE = '/folding/auth';
const TOKEN_KEY = 'tokenstring';
const AUTH_KEY = 'auth';
const USERID_KEY = 'userid';

export interface AuthData {
  username: string;
  token: string;
  expiry: number;
}

/** Parse the pipe-delimited BV-BRC token string into structured data. */
function parseToken(tokenString: string): AuthData {
  const parts: Record<string, string> = {};
  for (const segment of tokenString.split('|')) {
    const eq = segment.indexOf('=');
    if (eq > 0) {
      parts[segment.slice(0, eq)] = segment.slice(eq + 1);
    }
  }
  return {
    username: parts['un'] ?? '',
    token: tokenString,
    expiry: Number(parts['expiry'] ?? 0),
  };
}

/** Authenticate with BV-BRC user service. */
export async function login(username: string, password: string): Promise<AuthData> {
  const res = await fetch(`${AUTH_BASE}/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password }),
  });

  if (!res.ok) {
    throw new Error(res.status === 401 ? 'Invalid username or password' : `Login failed: ${res.status}`);
  }

  const tokenString = await res.text();
  const auth = parseToken(tokenString.trim());

  localStorage.setItem(TOKEN_KEY, auth.token);
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  localStorage.setItem(USERID_KEY, auth.username);

  return auth;
}

/** Refresh an existing token. */
export async function refreshToken(): Promise<AuthData | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const res = await fetch(`${AUTH_BASE}/authenticate/refresh/`, {
      headers: { Authorization: token },
    });
    if (!res.ok) return null;

    const tokenString = await res.text();
    const auth = parseToken(tokenString.trim());
    localStorage.setItem(TOKEN_KEY, auth.token);
    localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    return auth;
  } catch {
    return null;
  }
}

/** Get the stored token, or null if not logged in. */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/** Get stored auth data. */
export function getAuthData(): AuthData | null {
  const raw = localStorage.getItem(AUTH_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthData;
  } catch {
    return null;
  }
}

/** Check if the stored token is expired. */
export function isTokenExpired(): boolean {
  const auth = getAuthData();
  if (!auth) return true;
  return Date.now() / 1000 > auth.expiry;
}

/** Clear all auth state. */
export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(USERID_KEY);
}
