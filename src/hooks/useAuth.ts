import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import {
  login as apiLogin,
  logout as apiLogout,
  getAuthData,
  isTokenExpired,
  refreshToken,
  type AuthData,
} from '../api/auth';

interface AuthContextValue {
  user: AuthData | null;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function useAuthProvider(): { value: AuthContextValue } {
  const [user, setUser] = useState<AuthData | null>(() => {
    const stored = getAuthData();
    if (stored && !isTokenExpired()) return stored;
    return null;
  });

  // Try refreshing on mount if token exists but is expired
  useEffect(() => {
    const stored = getAuthData();
    if (stored && isTokenExpired()) {
      refreshToken().then((refreshed) => {
        if (refreshed) setUser(refreshed);
        else {
          apiLogout();
          setUser(null);
        }
      });
    }
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const auth = await apiLogin(username, password);
    setUser(auth);
  }, []);

  const logout = useCallback(() => {
    apiLogout();
    setUser(null);
  }, []);

  return {
    value: {
      user,
      isAuthenticated: user !== null,
      login,
      logout,
    },
  };
}

// Re-export for convenience in App.tsx
export function createAuthProvider(children: ReactNode) {
  return { AuthContext, children };
}
