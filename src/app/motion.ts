/**
 * What just happened on the table.
 *
 * The controller fills this in before the state changes and the view reads it
 * while it redraws, so the tile can be seen travelling from where it was to
 * where it ended up. Without it a hand is a series of stills: the tile is
 * simply somewhere else now and the eye cannot follow it.
 */
export type Motion =
  /** A tile came off the middle pile. */
  | { kind: 'draw'; tileId: number; seat: number }
  /** A tile was taken off a discard pile. */
  | { kind: 'take'; tileId: number; seat: number; from: number }
  /** A tile was thrown onto a discard pile. */
  | { kind: 'throw'; tileId: number; seat: number; to: number }
  /** A set or a run is now complete. */
  | { kind: 'meld'; tileIds: number[] }
  /** The gösterge was shown. */
  | { kind: 'indicator'; seat: number }
  /** A hand was finished. */
  | { kind: 'win'; seat: number };
