/**
 * Stay minutes from labels. The LLM says how long people usually stay at this
 * kind of place (brief/short/medium/long) and how the person phrased it
 * (quick/normal/long); the numbers come from params.ts.
 */
import { PARAMS } from "../params.js";
import type { Pace, TypicalVisit } from "../types.js";

const TYPICAL: Record<TypicalVisit, () => number> = {
  brief: () => PARAMS.stayBriefMinutes.value,
  short: () => PARAMS.stayShortMinutes.value,
  medium: () => PARAMS.stayMediumMinutes.value,
  long: () => PARAMS.stayLongMinutes.value,
};

export function roundStay(minutes: number): number {
  const step = PARAMS.stayStepMinutes.value;
  return Math.max(step, Math.round(minutes / step) * step);
}

export function defaultStay(typical: TypicalVisit, pace: Pace): number {
  const factor =
    pace === "quick" ? PARAMS.paceQuickFactor.value : pace === "long" ? PARAMS.paceLongFactor.value : 1;
  return roundStay(TYPICAL[typical]() * factor);
}

/**
 * The least a stay may be shortened to when time is short. A stay the user
 * stated or marked quick/long is kept; an unmarked one may go down to half.
 */
export function minimumStay(stayMinutes: number, fixed: boolean): number {
  return fixed ? stayMinutes : roundStay(stayMinutes * PARAMS.paceQuickFactor.value);
}
