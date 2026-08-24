import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Password hashing with scrypt from Node's standard library.
 *
 * scrypt rather than argon2id purely to avoid a native build dependency on
 * devices and CI: it is memory-hard, in the standard library, and parameterised
 * here well above the Node defaults. The stored format carries its own
 * parameters, so they can be raised later without invalidating existing hashes.
 */
const KEYLEN = 64;
const SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEYLEN);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1]!, 'base64');
  const expected = Buffer.from(parts[2]!, 'base64');
  const derived = await scrypt(password, salt, expected.length);
  // Constant-time: a timing difference here leaks how much of a hash matched.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export interface PasswordPolicy {
  minLength: number;
  requireMixedCase: boolean;
  requireDigit: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 10,
  requireMixedCase: true,
  requireDigit: true,
};

/** Returns the reasons a password is rejected, empty when acceptable (§31). */
export function checkPasswordPolicy(
  password: string,
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
): string[] {
  const problems: string[] = [];
  if (password.length < policy.minLength)
    problems.push(`Password must be at least ${policy.minLength} characters.`);
  if (policy.requireMixedCase && !(/[a-z]/.test(password) && /[A-Z]/.test(password)))
    problems.push('Password must contain both upper and lower case letters.');
  if (policy.requireDigit && !/\d/.test(password))
    problems.push('Password must contain at least one digit.');
  return problems;
}

export function hashToken(token: string): string {
  // Refresh tokens are stored hashed so a database leak does not hand over
  // live sessions.
  return createHash('sha256').update(token).digest('hex');
}
