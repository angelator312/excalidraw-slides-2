/**
 * Shared server configuration.
 * JWT_SECRET is read once here so all modules use the same value.
 */
export const JWT_SECRET: string = process.env.JWT_SECRET ?? 'change-me-in-development-only';
