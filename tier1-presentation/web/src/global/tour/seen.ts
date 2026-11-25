import { TOUR_VERSION } from './steps';

export const SEEN_KEY = 'glidepath.tour.seen';

/** Per-viewer convenience only (it sets the Tour button's dot). Blocked storage reads as unseen. */
export function readSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === TOUR_VERSION;
  } catch {
    return false;
  }
}

export function writeSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, TOUR_VERSION);
  } catch {
    /* blocked storage: the tour still runs */
  }
}
