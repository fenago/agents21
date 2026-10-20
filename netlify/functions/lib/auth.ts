// Shared-password gate (PRD §7.4).
//
// When APP_PASSWORD is set (non-empty), every gated function requires a matching
// `x-app-password` header. Both values are SHA-256 hashed before comparing, so
// timingSafeEqual always sees equal-length buffers and the comparison time does not
// reveal the password length or a matching prefix.
import { createHash, timingSafeEqual } from 'node:crypto';
import { errorResponse } from './http';

export const PASSWORD_HEADER = 'x-app-password';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function passwordMatches(supplied: string, expected: string): boolean {
  return timingSafeEqual(digest(supplied), digest(expected));
}

/**
 * Returns a 401 response when the gate is on and the header is missing or wrong;
 * undefined when the request may proceed. APP_PASSWORD is read per call.
 */
export function checkPassword(req: Request, expected: string | undefined = process.env.APP_PASSWORD): Response | undefined {
  if (!expected) return undefined;
  const supplied = req.headers.get(PASSWORD_HEADER);
  if (supplied !== null && passwordMatches(supplied, expected)) return undefined;
  return errorResponse(401, { error: 'unauthorized' });
}
