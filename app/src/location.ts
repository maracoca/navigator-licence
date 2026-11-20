import { Linking } from 'react-native';
import * as Location from 'expo-location';

/** Why location cannot be used, in words the user can act on. */
export interface LocationProblem {
  message: string;
  /** The fix is in the phone's Settings (permission denied for good, or location services off). */
  openSettings: boolean;
}

/**
 * Makes sure the app may read the location, asking for permission when it still can.
 * Returns null when location can be used.
 */
export async function ensureLocation(): Promise<LocationProblem | null> {
  try {
    if (!(await Location.hasServicesEnabledAsync())) {
      return {
        message: 'Location Services are off on this phone. Turn them on in Settings → Privacy & Security → Location Services.',
        openSettings: true,
      };
    }
    let perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted' && perm.canAskAgain) perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      // After one "Don't Allow" the phone does not ask again; only Settings can change it.
      return {
        message: 'Location access is off for Expo Go. In Settings → Expo Go → Location, choose "While Using the App" and turn on Precise Location.',
        openSettings: true,
      };
    }
    return null;
  } catch (e) {
    return { message: `Could not use location: ${e instanceof Error ? e.message : 'unknown error'}`, openSettings: false };
  }
}

/** The current position; falls back to a recent known one when a fresh fix takes too long (e.g. indoors). */
export async function currentPosition(timeoutMs = 15_000): Promise<Location.LocationObject> {
  const fresh = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const pos = await Promise.race([fresh, timeout]);
  if (pos) return pos;
  const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 });
  if (last) return last;
  throw new Error('No GPS fix yet. Go outside or near a window and try again.');
}

export function openSettings(): void {
  void Linking.openSettings();
}
