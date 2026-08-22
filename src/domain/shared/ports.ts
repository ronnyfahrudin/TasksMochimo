/**
 * Ports the domain needs from the outside world but refuses to depend on
 * directly. Implementations live in `src/infrastructure`.
 */

/** Cryptographically secure randomness. */
export interface RandomSource {
  /** Opaque token, hex-encoded, `bytes` long before encoding. */
  token(bytes: number): string;
  /** Uniformly distributed integer in [min, max]. */
  int(min: number, max: number): number;
}

/** Injectable clock, so time-dependent invariants stay testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
