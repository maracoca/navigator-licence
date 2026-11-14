import type { Coverage, Skipped } from './api/types';

export function coverageSentence(c: Coverage): string {
  return `${Math.round(c.goodPercent)}% ${c.goodWord}, ${Math.round(c.badPercent)}% ${c.badWord}, ${Math.round(
    c.unknownPercent,
  )}% unknown`;
}

export function skippedSentence(s: Skipped): string {
  if (s.cityCount === null) return s.message;
  const n = s.cityCount;
  const tail =
    n === 0
      ? 'None are mapped in the whole city.'
      : n === 1
        ? 'Only 1 is mapped in the whole city.'
        : `Only ${n} are mapped in the whole city.`;
  return `${s.message} ${tail}`;
}

export function minutes(m: number): string {
  const r = Math.round(m);
  if (r < 60) return `${r} min`;
  const h = Math.floor(r / 60);
  const rest = r % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}
