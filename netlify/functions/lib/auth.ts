// Shared-password gate (PRD §7.4).
//
// When APP_PASSWORD is set (non-empty), every gated function requires a matching
// `x-app-password` header. Both values are SHA-256 hashed before comparing, so
// timingSafeEqual always sees equal-length buffers and the comparison time does not
// reveal the password length or a matching prefix.
//
// Brute-force throttle (best effort): a request that sends a WRONG password gets its 401
// only after a fixed FAILED_PASSWORD_DELAY_MS. Functions are stateless, so there is no
// per-client counter or lockout; the delay just makes each guess slower for a sequential
// client. A request with no header at all (the SPA's first call, before it knows the gate
// is on) is answered immediately, since it is not a guess.
import { createHash, timingSafeEqual } from 'node:crypto';
import { errorResponse } from './http';

export const PASSWORD_HEADER = 'x-app-password';
export const FAILED_PASSWORD_DELAY_MS = 300;

export type Sleep = (ms: number) => Promise<void>;

export const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function passwordMatches(supplied: string, expected: string): boolean {
  return timingSafeEqual(digest(supplied), digest(expected));
}

export type CheckPasswordOptions = {
  /** Defaults to process.env.APP_PASSWORD, read per call. */
  expected?: string;
  /** Injectable for tests. */
  sleep?: Sleep;
};

/**
 * Resolves to a 401 response when the gate is on and the header is missing or wrong;
 * undefined when the request may proceed. A wrong (not missing) password is answered
 * after FAILED_PASSWORD_DELAY_MS.
 */
export async function checkPassword(req: Request, opts: CheckPasswordOptions = {}): Promise<Response | undefined> {
  const expected = 'expected' in opts ? opts.expected : process.env.APP_PASSWORD;
  if (!expected) return undefined;
  const supplied = req.headers.get(PASSWORD_HEADER);
  if (supplied !== null && passwordMatches(supplied, expected)) return undefined;
  if (supplied !== null) await (opts.sleep ?? defaultSleep)(FAILED_PASSWORD_DELAY_MS);
  return errorResponse(401, { error: 'unauthorized' });
}
