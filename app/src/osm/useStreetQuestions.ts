import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Vibration } from 'react-native';
import * as Location from 'expo-location';
import * as api from '../api/client';
import type { StreetAnswer, StreetQuestion, StreetQuestions, UploadResult } from '../api/types';
import { isDark, meters, metersToLine, type Pt } from './geo';

/** A question on screen: which street, and how it is worded (depends on daylight). */
export interface ActiveQuestion {
  street: StreetQuestion;
  text: string;
}

export type WalkStatus =
  | { kind: 'idle' }
  | { kind: 'walking' }
  | { kind: 'no-permission' }
  | { kind: 'sending' }
  | { kind: 'sent'; result: UploadResult }
  | { kind: 'error'; message: string };

/** Fixes worse than this (metres) are ignored: too vague to say which street the user is on. */
const MAX_ACCURACY_M = 40;

/**
 * Follows the walk by GPS and asks about streets whose lighting is unknown, Waze-style:
 * only once the user has walked part of the street, at most a few per walk, with a pause between them.
 * Answers are kept until the walk ends (or the app goes to the background) and then sent in one go.
 */
export function useStreetQuestions(opts: {
  questions: StreetQuestions | undefined;
  token: string | null;
  onLoginExpired: () => void;
}) {
  const { questions, token, onLoginExpired } = opts;
  const [walking, setWalking] = useState(false);
  const [active, setActive] = useState<ActiveQuestion | null>(null);
  const [status, setStatus] = useState<WalkStatus>({ kind: 'idle' });
  const [answeredCount, setAnsweredCount] = useState(0);

  const pending = useRef<StreetAnswer[]>([]);
  const walked = useRef(new Map<number, number>());
  const asked = useRef(new Set<number>());
  const lastAskedAt = useRef(0);
  const lastFix = useRef<{ p: Pt; ways: Set<number> } | null>(null);
  /** The question on screen, readable from the GPS callback without re-subscribing. */
  const activeRef = useRef<ActiveQuestion | null>(null);

  const canAsk = !!token && !!questions && questions.streets.length > 0;

  const send = useCallback(async (): Promise<void> => {
    if (!token || pending.current.length === 0) return;
    const batch = pending.current;
    pending.current = [];
    setStatus({ kind: 'sending' });
    try {
      const result = await api.osmAnswers(token, batch);
      setStatus({ kind: 'sent', result });
    } catch (e) {
      const err = e as api.ApiRequestError;
      if (err.osmLogin) {
        onLoginExpired();
        setStatus({ kind: 'error', message: 'Your OpenStreetMap login has expired. Log in again to send your answers.' });
      } else {
        setStatus({ kind: 'error', message: err.message ?? 'Could not send your answers.' });
      }
      // Keep them for the next try.
      pending.current = [...batch, ...pending.current];
    }
  }, [token, onLoginExpired]);

  const onFix = useCallback(
    (loc: Location.LocationObject) => {
      if (!questions) return;
      const { latitude, longitude, accuracy } = loc.coords;
      if (accuracy != null && accuracy > MAX_ACCURACY_M) return;
      const p = { lat: latitude, lng: longitude };
      const rules = questions.rules;

      // Streets the user is on now; distance walked counts when the previous fix was on the same street.
      const onWays = new Set<number>();
      for (const s of questions.streets) {
        if (s.segments.some((seg) => metersToLine(p, seg) <= rules.nearWayMeters)) onWays.add(s.wayId);
      }
      const prev = lastFix.current;
      if (prev) {
        const step = meters(prev.p, p);
        for (const w of onWays) if (prev.ways.has(w)) walked.current.set(w, (walked.current.get(w) ?? 0) + step);
      }
      lastFix.current = { p, ways: onWays };

      const now = Date.now();
      if (activeRef.current) return;
      if (asked.current.size >= rules.maxPerWalk) return;
      if (now - lastAskedAt.current < rules.minGapSeconds * 1000) return;
      const street = questions.streets.find(
        (s) => onWays.has(s.wayId) && !asked.current.has(s.wayId) && (walked.current.get(s.wayId) ?? 0) >= rules.minWalkedMeters,
      );
      if (!street) return;
      asked.current.add(street.wayId);
      lastAskedAt.current = now;
      // At night the lights can be seen; by day only the lamps (lit=yes means "lights installed" on the OSM wiki).
      const text = isDark(new Date(now), p) ? 'Is this street lit?' : 'Are there street lamps here?';
      Vibration.vibrate(200);
      activeRef.current = { street, text };
      setActive(activeRef.current);
    },
    [questions],
  );

  // GPS only while walking, and only in the foreground (Expo Go has no background location).
  useEffect(() => {
    if (!walking) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        if (!cancelled) {
          setWalking(false);
          setStatus({ kind: 'no-permission' });
        }
        return;
      }
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 5 }, onFix);
      if (cancelled) sub.remove();
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [walking, onFix]);

  // Leaving the result screen ends the walk: send what we have.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);
  useEffect(() => () => void sendRef.current(), []);

  // Leaving the app may end it: send what we have.
  useEffect(() => {
    const s = AppState.addEventListener('change', (state) => {
      if (state === 'background') void send();
    });
    return () => s.remove();
  }, [send]);

  const answer = useCallback((value: 'yes' | 'no' | null) => {
    const q = activeRef.current;
    activeRef.current = null;
    setActive(null);
    if (!q || value === null) return;
    pending.current.push({ wayId: q.street.wayId, property: 'lit', value, answeredAt: new Date().toISOString() });
    setAnsweredCount((n) => n + 1);
  }, []);

  const start = useCallback(() => {
    walked.current.clear();
    asked.current.clear();
    lastFix.current = null;
    lastAskedAt.current = 0;
    setAnsweredCount(0);
    setStatus({ kind: 'walking' });
    setWalking(true);
  }, []);

  const stop = useCallback(async () => {
    setWalking(false);
    activeRef.current = null;
    setActive(null);
    if (pending.current.length > 0) await send();
    else setStatus({ kind: 'idle' });
  }, [send]);

  return { canAsk, walking, active, status, answeredCount, start, stop, answer, retry: send, hasPending: () => pending.current.length > 0 };
}
