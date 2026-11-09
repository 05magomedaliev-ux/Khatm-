import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

export function useApi<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    const id = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const result = await load();
      if (id === latest.current) setData(result);
    } catch (e) {
      if (id === latest.current) setError(e instanceof ApiError ? e : new ApiError(0, 'unknown', 'Не удалось загрузить данные.'));
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}
