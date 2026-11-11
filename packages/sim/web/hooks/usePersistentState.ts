'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * useState that's remembered between visits (in localStorage), e.g. a page's
 * filters. Starts from `initial` on the server and the first render, then
 * picks up the stored value.
 */
export function usePersistentState<T>(key: string, initial: T): [T, (value: T) => void] {
  const storageKey = `sandbox-state-${key}`;
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) setValue(JSON.parse(stored) as T);
    } catch {
      // Storage blocked or bad JSON: keep the initial value.
    }
  }, [storageKey]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Storage blocked: only this visit remembers.
      }
    },
    [storageKey],
  );

  return [value, update];
}
