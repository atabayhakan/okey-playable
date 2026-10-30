/**
 * The daily deal: one hand a day, the same for everyone who plays on that day.
 * A day is a number, YYYYMMDD in the player's own calendar, so a deal does not
 * change in the middle of someone's evening.
 */

export const dayNumber = (date: Date): number => date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();

/** The day before `day`, over month and year ends: 20260301 -> 20260228. */
export function previousDay(day: number): number {
  const y = Math.floor(day / 10000);
  const m = Math.floor((day % 10000) / 100);
  const d = day % 100;
  return dayNumber(new Date(y, m - 1, d - 1));
}

/** The seed of a day's deal: a spread of the day number, so neighbouring days do not deal alike. */
export function dailySeed(day: number): number {
  let h = (day ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  // A seed of 0 is not a seed anyone can ask for (`?seed=`), so avoid it.
  return ((h ^ (h >>> 16)) >>> 0) || 1;
}
