import { useState, useCallback, useMemo } from 'react';

/**
 * @param {string} defaultKey
 * @param {'asc'|'desc'} defaultDir
 */
export function useListSort(defaultKey = 'created_at', defaultDir = 'desc') {
  const [sortBy, setSortBy] = useState(defaultKey);
  const [sortDir, setSortDir] = useState(defaultDir);

  const toggleSort = useCallback((key) => {
    setSortBy((prevKey) => {
      if (prevKey === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prevKey;
      }
      setSortDir('desc');
      return key;
    });
  }, []);

  const sortParams = useMemo(
    () => ({ sort_by: sortBy, sort_dir: sortDir }),
    [sortBy, sortDir],
  );

  const resetSort = useCallback(() => {
    setSortBy(defaultKey);
    setSortDir(defaultDir);
  }, [defaultKey, defaultDir]);

  return { sortBy, sortDir, setSortBy, setSortDir, toggleSort, sortParams, resetSort };
}
