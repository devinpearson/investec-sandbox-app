'use client';

import { useLive } from './LiveUpdates';
import ServerLogs from './ServerLogs';

// The API's live request log, from the dashboard's shared connection.
export default function RequestLog() {
  const { logs, connected, clearLogs } = useLive();
  return <ServerLogs logs={logs} connected={connected} onClear={clearLogs} />;
}
