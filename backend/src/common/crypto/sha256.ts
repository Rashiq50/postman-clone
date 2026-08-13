import { createHash, timingSafeEqual } from 'node:crypto';

/** SHA-256 hex digest of `value`. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time compare for stored SHA-256 hex digests. */
export function verifySha256(value: string, expectedHex: string): boolean {
  const actual = createHash('sha256').update(value, 'utf8').digest();
  const expected = Buffer.from(expectedHex, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
