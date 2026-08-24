import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_CONVENTION, type MeasurementConvention, type RefList, type ConfigurableRule } from '@geotech/core';
import { api, type ReferenceBundle, type ReferenceWorkplace } from '../api/client.js';
import { db, type StoredSession } from '../db/database.js';
import { getPreferences, savePreferences } from '../db/repository.js';
import { syncEngine, type SyncStatus } from '../sync/engine.js';

/* ── navigation ───────────────────────────────────────────────────────
   A stack, not a URL router. Underground the only navigation that matters
   is "forward through the task" and "back one step", and a stack models
   that exactly — with no deep trees to get lost in (§32).
   ─────────────────────────────────────────────────────────────────────── */

export type Route =
  | { name: 'home' }
  | { name: 'newFaceLog' }
  | { name: 'faceLog'; localId: string }
  | { name: 'observation'; faceLogLocalId: string }
  | { name: 'offset'; faceLogLocalId: string }
  | { name: 'sample'; faceLogLocalId: string }
  | { name: 'hazard'; faceLogLocalId: string }
  | { name: 'photo'; faceLogLocalId: string }
  | { name: 'myLogs' }
  | { name: 'pending' }
  | { name: 'search' }
  | { name: 'settings' };

interface Toast {
  message: string;
  tone: 'normal' | 'danger';
}

interface AppState {
  session: StoredSession | null;
  ready: boolean;
  reference: {
    workplaces: ReferenceWorkplace[];
    lists: RefList[];
    convention: MeasurementConvention;
    rules: ConfigurableRule[];
    fetchedAt: string | null;
  };
  sync: SyncStatus;
  route: Route;
  stack: Route[];
  theme: 'dark' | 'light';
  contrast: 'normal' | 'high';
  toast: Toast | null;

  signIn: (identifier: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  push: (route: Route) => void;
  pop: () => void;
  reset: (route?: Route) => void;
  showToast: (message: string, tone?: 'normal' | 'danger') => void;
  refreshReference: () => Promise<void>;
  setTheme: (theme: 'dark' | 'light') => Promise<void>;
  setContrast: (contrast: 'normal' | 'high') => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

/** Stable per install, so records can be attributed to a device (§21). */
function deviceId(): string {
  const key = 'geotech.deviceId';
  let id = localStorage.getItem(key);
  if (!id) {
    id = `dev-${crypto.randomUUID()}`;
    localStorage.setItem(key, id);
  }
  return id;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<StoredSession | null>(null);
  const [ready, setReady] = useState(false);
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [theme, setThemeState] = useState<'dark' | 'light'>('dark');
  const [contrast, setContrastState] = useState<'normal' | 'high'>('normal');
  const [sync, setSync] = useState<SyncStatus>({
    online: navigator.onLine,
    running: false,
    pending: 0,
    failed: 0,
    blocked: 0,
    conflicts: 0,
    lastSyncedAt: null,
    lastMessage: null,
  });
  const [reference, setReference] = useState<AppState['reference']>({
    workplaces: [],
    lists: [],
    convention: DEFAULT_CONVENTION,
    rules: [],
    fetchedAt: null,
  });

  const applyBundle = useCallback((bundle: ReferenceBundle) => {
    setReference({
      workplaces: bundle.workplaces,
      lists: bundle.referenceLists,
      convention: bundle.convention,
      rules: bundle.validationRules,
      fetchedAt: bundle.fetchedAt,
    });
  }, []);

  // Boot from the device, not from the network: everything needed to start
  // capturing is already here (§5).
  useEffect(() => {
    (async () => {
      const stored = await db.session.get('session');
      if (stored) setSession(stored);

      const cached = await db.reference.get('bundle');
      if (cached) applyBundle(cached.payload as ReferenceBundle);

      const prefs = await getPreferences();
      setThemeState(prefs.theme);
      setContrastState(prefs.contrast);
      document.documentElement.dataset['theme'] = prefs.theme;
      document.documentElement.dataset['contrast'] = prefs.contrast;

      setReady(true);
    })();
  }, [applyBundle]);

  useEffect(() => {
    if (!session) return;
    const unsubscribe = syncEngine.subscribe(setSync);
    syncEngine.start();
    return () => {
      unsubscribe();
      syncEngine.stop();
    };
  }, [session]);

  const refreshReference = useCallback(async () => {
    const bundle = await api.reference();
    await db.reference.put({ key: 'bundle', fetchedAt: bundle.fetchedAt, payload: bundle });
    applyBundle(bundle);
  }, [applyBundle]);

  const signIn = useCallback(
    async (identifier: string, password: string) => {
      const id = deviceId();
      const result = await api.login(identifier, password, id);
      const stored: StoredSession = {
        key: 'session',
        userId: result.user.id,
        name: result.user.name,
        employeeNo: result.user.employeeNo,
        role: result.user.role,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        offlineGrant: result.offlineGrant,
        offlineGrantExpiresAt: result.offlineGrant
          ? new Date(Date.now() + result.offlineGrantExpiresInHours * 3600_000).toISOString()
          : null,
        deviceId: id,
        savedAt: new Date().toISOString(),
      };
      await db.session.put(stored);
      setSession(stored);
      // Fill the offline cache while there is still a connection to fill it from.
      await refreshReference().catch(() => undefined);
    },
    [refreshReference],
  );

  const signOut = useCallback(async () => {
    const outstanding = await db.queue.count();
    if (outstanding > 0) {
      throw new Error(
        `${outstanding} record${outstanding === 1 ? '' : 's'} still to sync. Signing out now would leave them on this device — connect and let them sync first.`,
      );
    }
    await db.session.clear();
    setSession(null);
    setStack([{ name: 'home' }]);
  }, []);

  const push = useCallback((route: Route) => setStack((s) => [...s, route]), []);
  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = useCallback((route: Route = { name: 'home' }) => setStack([route]), []);

  const showToast = useCallback((message: string, tone: 'normal' | 'danger' = 'normal') => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 4500);
  }, []);

  const setTheme = useCallback(async (next: 'dark' | 'light') => {
    setThemeState(next);
    document.documentElement.dataset['theme'] = next;
    await savePreferences({ theme: next });
  }, []);

  const setContrast = useCallback(async (next: 'normal' | 'high') => {
    setContrastState(next);
    document.documentElement.dataset['contrast'] = next;
    await savePreferences({ contrast: next });
  }, []);

  const value = useMemo<AppState>(
    () => ({
      session,
      ready,
      reference,
      sync,
      route: stack[stack.length - 1]!,
      stack,
      theme,
      contrast,
      toast,
      signIn,
      signOut,
      push,
      pop,
      reset,
      showToast,
      refreshReference,
      setTheme,
      setContrast,
    }),
    [session, ready, reference, sync, stack, theme, contrast, toast, signIn, signOut, push, pop, reset, showToast, refreshReference, setTheme, setContrast],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
