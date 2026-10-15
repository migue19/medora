'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Session } from './api';

export function useSession<T>(session: Session<T>) {
  const data = useSyncExternalStore(
    (cb) => session.subscribe(cb),
    () => session.data,
    () => null,
  );
  const [ready, setReady] = useState(Boolean(session.data));
  useEffect(() => {
    if (session.data) { setReady(true); return; }
    session.refresh().finally(() => setReady(true));
  }, [session]);
  return { data, ready };
}
