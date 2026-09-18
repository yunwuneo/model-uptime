import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
export const AdminContext = createContext<{
  toast: (message: string, error?: boolean) => void;
  refreshSession: () => Promise<void>;
}>({ toast: () => {}, refreshSession: async () => {} });
export const useAdmin = () => useContext(AdminContext);
export function useLoad<T>(path: string, poll = 0) {
  const [data, setData] = useState<T | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const { refreshSession } = useAdmin();
  const reload = useCallback(async () => {
    try {
      const result = await api<T>(path);
      setData(result);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      if (e instanceof ApiError && e.status === 401) await refreshSession();
    } finally {
      setLoading(false);
    }
  }, [path, refreshSession]);
  useEffect(() => {
    void reload();
    if (poll) {
      const timer = setInterval(() => {
        void reload();
      }, poll);
      return () => clearInterval(timer);
    }
  }, [reload, poll]);
  return { data, loading, error, reload, setData };
}
