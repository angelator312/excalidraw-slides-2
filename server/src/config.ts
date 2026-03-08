/**
 * Shared server configuration.
 * JWT_SECRET is read once here so all modules use the same value.
 */
export const JWT_SECRET: string = process.env.JWT_SECRET ?? 'change-me-in-development-only';

/**
 * Site origin used for constructing invite links.
 */
export const SITE_ORIGIN: string = process.env.SITE_ORIGIN ?? 'http://localhost:3000';

/**
 * Impersonation is disabled by default in production.
 * Set ALLOW_IMPERSONATION=true to enable it explicitly.
 */
export const ALLOW_IMPERSONATION: boolean =
  process.env.ALLOW_IMPERSONATION?.toLowerCase() === 'true';

/** Default invite token validity in days */
export const DEFAULT_INVITE_EXPIRY_DAYS = 7;

/** Default maximum uses per invite token */
export const DEFAULT_INVITE_MAX_USES = 1;

/** Impersonation JWT expiry (1 hour) */
export const IMPERSONATION_JWT_EXPIRY = '1h';
