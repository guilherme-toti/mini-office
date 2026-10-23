import { useEffect, useState } from 'react';
import {
  API_EVENTS_PATH,
  OfficeSnapshotSchema,
  SNAPSHOT_EVENT,
  type SourceName,
} from '../../shared/protocol.ts';
import type { OfficeEngine } from '../game/engine.ts';

export type ConnectionStatus = 'connecting' | 'live' | 'offline';

/** Streams office snapshots from the server into the engine. EventSource reconnects by itself. */
export function useOfficeFeed(engine: OfficeEngine, source: SourceName): ConnectionStatus {
  // Status is tracked per source, so switching sources reads as "connecting" without a reset.
  const [state, setState] = useState<{ source: SourceName; status: ConnectionStatus }>({
    source,
    status: 'connecting',
  });

  useEffect(() => {
    const setStatus = (status: ConnectionStatus) => setState({ source, status });
    engine.reset();
    const events = new EventSource(`${API_EVENTS_PATH}?source=${source}`);
    const onSnapshot = (event: MessageEvent<string>) => {
      const parsed = OfficeSnapshotSchema.safeParse(parseJson(event.data));
      if (!parsed.success) {
        console.warn(
          '[mini-office] ignored a snapshot that does not match the protocol',
          parsed.error,
        );
        return;
      }
      engine.applySnapshot(parsed.data);
      setStatus('live');
    };
    events.addEventListener(SNAPSHOT_EVENT, onSnapshot);
    events.onerror = () => {
      setStatus('offline');
    };
    return () => {
      events.removeEventListener(SNAPSHOT_EVENT, onSnapshot);
      events.close();
    };
  }, [engine, source]);

  return state.source === source ? state.status : 'connecting';
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
