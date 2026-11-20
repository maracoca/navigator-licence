import * as SecureStore from 'expo-secure-store';

/** The OpenStreetMap login, kept on the phone so the user logs in only once. */
export interface OsmSession {
  token: string;
  user: string;
  /** The OSM server the token belongs to (test server or the real one). */
  server: string;
}

const KEY = 'osm-session';

export async function loadSession(): Promise<OsmSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    return raw ? (JSON.parse(raw) as OsmSession) : null;
  } catch {
    return null;
  }
}

export async function saveSession(s: OsmSession): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(s));
}

export async function clearSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // Nothing stored.
  }
}
