import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { apiRequest } from '../lib/api';
import { deriveMonitoringView, type MonitoringView } from '../lib/monitoring-state';
import { useLiveRefresh } from '../lib/use-live-refresh';
import { useAuth } from './auth';
import type { WhatsAppCollectorStatus } from '../types';

type MonitoringActionPath =
  | '/collectors/whatsapp/start'
  | '/collectors/whatsapp/stop'
  | '/collectors/whatsapp/reset-session'
  | '/collectors/whatsapp/fresh-profile';

interface MonitoringContextValue {
  status: WhatsAppCollectorStatus | null;
  view: MonitoringView;
  lastFetchedAt: Date | null;
  lastStateUpdateAt: string | null;
  isLoading: boolean;
  error: string | null;
  pollIntervalMs: number;
  refresh: () => Promise<void>;
  isBusy: boolean;
  runAction: (path: MonitoringActionPath) => Promise<WhatsAppCollectorStatus | null>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  resetSession: () => Promise<void>;
  createFreshProfile: () => Promise<void>;
}

const MonitoringContext = createContext<MonitoringContextValue | null>(null);

const MONITORING_POLL_IDLE_MS = 60_000;
const MONITORING_POLL_LINKING_MS = 5_000;

export function MonitoringProvider({ children }: PropsWithChildren): JSX.Element {
  const { token, user } = useAuth();
  const [status, setStatus] = useState<WhatsAppCollectorStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const enabled = Boolean(token) && user?.role !== 'GUARD';

  const view = useMemo(() => deriveMonitoringView(status), [status]);

  const pollIntervalMs = view.isLinking && !view.isLive ? MONITORING_POLL_LINKING_MS : MONITORING_POLL_IDLE_MS;

  const loadStatus = useCallback(async () => {
    if (!enabled) {
      setStatus(null);
      return;
    }

    try {
      const nextStatus = await apiRequest<WhatsAppCollectorStatus>(
        '/collectors/whatsapp/status',
        {},
        token ?? undefined,
      );
      setStatus(nextStatus);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load monitoring status');
    }
  }, [enabled, token]);

  const { lastUpdated, isLoading, refresh } = useLiveRefresh(loadStatus, pollIntervalMs, enabled);

  const runAction = useCallback(
    async (path: MonitoringActionPath): Promise<WhatsAppCollectorStatus | null> => {
      if (!enabled) {
        return null;
      }

      setIsBusy(true);
      setError(null);

      try {
        const nextStatus = await apiRequest<WhatsAppCollectorStatus>(path, { method: 'POST' }, token ?? undefined);
        setStatus(nextStatus);
        return nextStatus;
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : 'Monitoring action failed');
        return null;
      } finally {
        setIsBusy(false);
      }
    },
    [enabled, token],
  );

  const start = useCallback(async () => {
    await runAction('/collectors/whatsapp/start');
  }, [runAction]);

  const stop = useCallback(async () => {
    await runAction('/collectors/whatsapp/stop');
  }, [runAction]);

  const resetSession = useCallback(async () => {
    await runAction('/collectors/whatsapp/reset-session');
  }, [runAction]);

  const createFreshProfile = useCallback(async () => {
    await runAction('/collectors/whatsapp/fresh-profile');
  }, [runAction]);

  const value = useMemo<MonitoringContextValue>(
    () => ({
      status,
      view,
      lastFetchedAt: lastUpdated,
      lastStateUpdateAt: status?.lastEventAt ?? null,
      isLoading,
      error,
      pollIntervalMs,
      refresh,
      isBusy,
      runAction,
      start,
      stop,
      resetSession,
      createFreshProfile,
    }),
    [
      createFreshProfile,
      error,
      isBusy,
      isLoading,
      lastUpdated,
      pollIntervalMs,
      refresh,
      resetSession,
      runAction,
      start,
      status,
      stop,
      view,
    ],
  );

  return <MonitoringContext.Provider value={value}>{children}</MonitoringContext.Provider>;
}

export function useMonitoring(): MonitoringContextValue {
  const context = useContext(MonitoringContext);
  if (!context) {
    throw new Error('useMonitoring must be used within MonitoringProvider');
  }

  return context;
}

/** Safe for optional UI outside the provider (returns offline view). */
export function useMonitoringOptional(): MonitoringContextValue | null {
  return useContext(MonitoringContext);
}
