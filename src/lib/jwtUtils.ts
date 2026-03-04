/**
 * Pure helpers for working with JWT payloads in a format that's testable
 * without a real JWT library (used in unit tests).
 */

export interface ImpersonationPayload {
  sub: string;
  role: string;
  impersonatedBy?: string;
  exp?: number;
  iat?: number;
}

/**
 * Decode a JWT payload (base64url decode, no verification).
 * Used in tests to inspect token claims without a server.
 */
export function decodeJwtPayload(token: string): ImpersonationPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = parts[1];
  // base64url → base64
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  return JSON.parse(atob(padded)) as ImpersonationPayload;
}

/**
 * Build an impersonation JWT payload object (without signing).
 * This reflects exactly what the server's admin endpoint puts into the token.
 */
export function buildImpersonationPayload(
  targetUserId: string,
  targetRole: string,
  adminUserId: string,
): Omit<ImpersonationPayload, 'exp' | 'iat'> {
  return {
    sub: targetUserId,
    role: targetRole,
    impersonatedBy: adminUserId,
  };
}

/**
 * Returns true if the payload includes an impersonatedBy claim.
 */
export function isImpersonationPayload(
  payload: ImpersonationPayload,
): boolean {
  return typeof payload.impersonatedBy === 'string' && payload.impersonatedBy.length > 0;
}
