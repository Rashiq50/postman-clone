import * as argon2 from 'argon2';

/**
 * Password hashing, deliberately separate from `sha256.ts`.
 *
 * SHA-256 is the right tool for hashing a refresh token — that value is 32
 * bytes of `randomBytes`, so there is nothing to guess and speed is a feature.
 * It is the wrong tool for a password: users pick from a small, predictable
 * space, and a fast hash lets an attacker who steals the table test billions of
 * candidates per second offline. Argon2id is deliberately slow and
 * memory-hungry, which is what makes that search expensive.
 *
 * Argon2 also salts every hash and encodes the salt and parameters into the
 * output string, so `verify` needs nothing but the stored value.
 */
const HASH_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  // OWASP's baseline: 19 MiB of memory, 2 passes, 1 lane. Raise `timeCost`
  // first if you want more margin — and if you change any of these, existing
  // hashes still verify, because the parameters travel with each hash.
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/** Argon2id hash of `password`, salt and parameters included in the string. */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, HASH_OPTIONS);
}

/**
 * Constant-time check of `password` against a stored Argon2 hash.
 *
 * Returns false rather than throwing when the stored value is not a well-formed
 * Argon2 string — a corrupt or legacy row is a failed login, not a 500.
 */
export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(storedHash, password);
  } catch {
    return false;
  }
}
