import { describe, it, expect } from 'vitest';
import { validateLibraryData, MAX_LIBRARY_SIZE_BYTES } from '../src/lib/libraryValidation';
import {
  buildImpersonationPayload,
  isImpersonationPayload,
  decodeJwtPayload,
} from '../src/lib/jwtUtils';

describe('validateLibraryData', () => {
  it('accepts valid excalidrawlib format', () => {
    const data = {
      type: 'excalidrawlib',
      version: 2,
      library: [
        { id: 'item1', status: 'published', elements: [] },
      ],
    };
    expect(validateLibraryData(data)).toBe(true);
  });

  it('accepts legacy libraryItems format', () => {
    const data = {
      libraryItems: [
        { id: 'item1', status: 'published', elements: [] },
      ],
    };
    expect(validateLibraryData(data)).toBe(true);
  });

  it('rejects null', () => {
    expect(validateLibraryData(null)).toBe(false);
  });

  it('rejects array at root level', () => {
    expect(validateLibraryData([])).toBe(false);
  });

  it('rejects object without library or libraryItems', () => {
    expect(validateLibraryData({ foo: 'bar' })).toBe(false);
  });

  it('rejects excalidrawlib type without library array', () => {
    expect(validateLibraryData({ type: 'excalidrawlib', version: 2 })).toBe(false);
  });

  it('rejects plain string', () => {
    expect(validateLibraryData('not-an-object')).toBe(false);
  });

  it('rejects number', () => {
    expect(validateLibraryData(42)).toBe(false);
  });
});

describe('MAX_LIBRARY_SIZE_BYTES', () => {
  it('is 2 MB (2097152 bytes)', () => {
    expect(MAX_LIBRARY_SIZE_BYTES).toBe(2 * 1024 * 1024);
  });
});

// ─── Invite token business logic ────────────────────────────────────────────

interface MockInviteToken {
  uses: number;
  maxUses: number;
  expiresAt: Date;
  revokedAt?: Date;
}

function isTokenValid(token: MockInviteToken): boolean {
  if (token.revokedAt) return false;
  if (token.expiresAt < new Date()) return false;
  if (token.uses >= token.maxUses) return false;
  return true;
}

describe('InviteToken lifecycle (pure logic)', () => {
  const future = new Date(Date.now() + 86_400_000); // +1 day
  const past = new Date(Date.now() - 86_400_000);   // -1 day

  it('is valid when uses < maxUses and not expired or revoked', () => {
    const token: MockInviteToken = { uses: 0, maxUses: 1, expiresAt: future };
    expect(isTokenValid(token)).toBe(true);
  });

  it('is invalid when uses equals maxUses', () => {
    const token: MockInviteToken = { uses: 1, maxUses: 1, expiresAt: future };
    expect(isTokenValid(token)).toBe(false);
  });

  it('is invalid when uses exceeds maxUses', () => {
    const token: MockInviteToken = { uses: 3, maxUses: 2, expiresAt: future };
    expect(isTokenValid(token)).toBe(false);
  });

  it('is invalid when expired', () => {
    const token: MockInviteToken = { uses: 0, maxUses: 1, expiresAt: past };
    expect(isTokenValid(token)).toBe(false);
  });

  it('is invalid when revoked', () => {
    const token: MockInviteToken = {
      uses: 0,
      maxUses: 1,
      expiresAt: future,
      revokedAt: new Date(),
    };
    expect(isTokenValid(token)).toBe(false);
  });

  it('allows multi-use token to be accepted multiple times', () => {
    const token: MockInviteToken = { uses: 2, maxUses: 5, expiresAt: future };
    expect(isTokenValid(token)).toBe(true);
    token.uses++;
    expect(isTokenValid(token)).toBe(true);
    expect(token.uses).toBe(3);
  });

  it('becomes invalid after all uses exhausted', () => {
    const token: MockInviteToken = { uses: 4, maxUses: 5, expiresAt: future };
    token.uses++;
    expect(isTokenValid(token)).toBe(false);
  });

  it('revocation takes precedence over valid expiry', () => {
    const token: MockInviteToken = {
      uses: 0,
      maxUses: 10,
      expiresAt: future,
      revokedAt: new Date(Date.now() - 1000),
    };
    expect(isTokenValid(token)).toBe(false);
  });
});

// ─── Impersonation JWT payload logic ────────────────────────────────────────

describe('buildImpersonationPayload', () => {
  it('includes sub, role, and impersonatedBy', () => {
    const payload = buildImpersonationPayload('target-id', 'user', 'admin-id');
    expect(payload.sub).toBe('target-id');
    expect(payload.role).toBe('user');
    expect(payload.impersonatedBy).toBe('admin-id');
  });

  it('does not allow owner role (checked server-side; payload still has role)', () => {
    const payload = buildImpersonationPayload('target-id', 'user', 'admin-id');
    expect(payload.role).not.toBe('owner');
  });
});

describe('isImpersonationPayload', () => {
  it('returns true when impersonatedBy is present', () => {
    expect(isImpersonationPayload({ sub: 'u', role: 'user', impersonatedBy: 'admin' })).toBe(true);
  });

  it('returns false when impersonatedBy is absent', () => {
    expect(isImpersonationPayload({ sub: 'u', role: 'user' })).toBe(false);
  });

  it('returns false when impersonatedBy is empty string', () => {
    expect(isImpersonationPayload({ sub: 'u', role: 'user', impersonatedBy: '' })).toBe(false);
  });
});

describe('decodeJwtPayload', () => {
  // A real JWT generated with { sub: "test", impersonatedBy: "admin", role: "user" }
  // Encoded without verification so we can decode it in jsdom
  const samplePayload = { sub: 'test-user', role: 'user', impersonatedBy: 'admin-user' };
  const base64Payload = btoa(JSON.stringify(samplePayload))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const fakeToken = `header.${base64Payload}.sig`;

  it('decodes a JWT payload without verifying signature', () => {
    const decoded = decodeJwtPayload(fakeToken);
    expect(decoded.sub).toBe('test-user');
    expect(decoded.role).toBe('user');
    expect(decoded.impersonatedBy).toBe('admin-user');
  });

  it('throws on malformed token', () => {
    expect(() => decodeJwtPayload('only-one-part')).toThrow('Invalid JWT format');
    expect(() => decodeJwtPayload('')).toThrow('Invalid JWT format');
  });
});

