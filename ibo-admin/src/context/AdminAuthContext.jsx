import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { adminLogin, adminFetch, clearAdminToken, getStoredToken } from '@/lib/api';

const Ctx = createContext(null);

export function AdminAuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setAdmin(null);
      setLoading(false);
      return;
    }
    const res = await adminFetch('/api/admin/auth/me');
    if (!res.ok) {
      clearAdminToken();
      setAdmin(null);
      setLoading(false);
      return;
    }
    setAdmin(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  const login = useCallback(async (email, password) => {
    const data = await adminLogin(email, password);
    setAdmin(data.admin);
    return data;
  }, []);

  const logout = useCallback(() => {
    clearAdminToken();
    setAdmin(null);
  }, []);

  return (
    <Ctx.Provider value={{ admin, loading, login, logout, refreshMe }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAdminAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAdminAuth outside provider');
  return v;
}
