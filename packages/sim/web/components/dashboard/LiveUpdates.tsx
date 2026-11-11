'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useLiveUpdates } from '@/hooks/useSandbox';

type Live = ReturnType<typeof useLiveUpdates>;

const LiveContext = createContext<Live | null>(null);

// One connection to the API's live updates for every dashboard page: it
// refreshes data changed elsewhere (e.g. from Postman) and collects the
// request log while you move between pages.
export function LiveUpdatesProvider({ children }: { children: ReactNode }) {
  const live = useLiveUpdates();
  return <LiveContext.Provider value={live}>{children}</LiveContext.Provider>;
}

export function useLive(): Live {
  const live = useContext(LiveContext);
  if (!live) throw new Error('useLive must be used inside LiveUpdatesProvider');
  return live;
}
