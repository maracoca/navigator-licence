import { useCallback, useEffect, useState } from 'react';
import * as api from '../api/client';
import type { OsmConfig } from '../api/types';
import { clearSession, loadSession, saveSession, type OsmSession } from './session';

/** Whether the server can take street answers, and the user's OpenStreetMap login (kept on the phone). */
export function useOsmAccount() {
  const [config, setConfig] = useState<OsmConfig | null>(null);
  const [session, setSession] = useState<OsmSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cfg, saved] = await Promise.all([api.osmConfig().catch(() => ({ enabled: false }) as OsmConfig), loadSession()]);
      if (cancelled) return;
      setConfig(cfg);
      // A token from another OSM server (test vs real) does not work here.
      setSession(cfg.enabled && saved && saved.server === cfg.server ? saved : null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (code: string) => {
      if (!config?.enabled) return;
      const res = await api.osmLogin(code);
      const s = { token: res.token, user: res.user, server: config.server };
      await saveSession(s);
      setSession(s);
    },
    [config],
  );

  const logout = useCallback(async () => {
    await clearSession();
    setSession(null);
  }, []);

  return { config, session, login, logout };
}
