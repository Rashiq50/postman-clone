const UNIT_MS = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
} as const;

const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d)$/;

/**
 * Parses a `ms`-style duration string (`'15m'`, `'30d'`, `'500ms'`) into
 * milliseconds.
 *
 * Deliberately not `import ms from 'ms'`: that package is present only
 * transitively through `jsonwebtoken`, so depending on it here is a phantom
 * dependency that disappears on the next `@nestjs/jwt` bump.
 *
 * Throws rather than returning `NaN` or a default. A malformed session
 * lifetime is a security parameter, and silently substituting a guess for it
 * is how a 12-hour window becomes a 12-day one.
 */
export function parseDuration(value: string): number {
  const match = DURATION_PATTERN.exec(value);

  if (!match) {
    throw new Error(
      `Invalid duration "${value}": expected a number followed by ms, s, m, h or d (e.g. "30d").`,
    );
  }

  const [, amount, unit] = match;

  return Number(amount) * UNIT_MS[unit as keyof typeof UNIT_MS];
}
