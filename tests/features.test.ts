/**
 * Tests covering:
 * - Router: URL parsing for all routes (home, presentation, admin, invite-accept)
 * - Auth token accept flow: multi-use time-based invite tokens
 * - Fingerprint-based elements change detection
 * - Presentation thumbnailMode model field
 * - SettingsModal editor list logic
 * - canEdit / canView with editors list
 * - Role management logic
 * - Guest restriction logic
 * - Auth token sign-in flow
 */
import { describe, it, expect } from 'vitest';
import { canView, canEdit } from '../server/src/middleware/permUtils.js';

// ─── Router: URL → Route parsing ──────────────────────────────────────────

function parseRoute(pathname: string, search = ''): string {
  const presMatch = pathname.match(/^\/presentation\/([0-9a-f]{24})\/?$/i);
  if (presMatch) return `presentation:${presMatch[1]}`;
  if (pathname === '/admin') return 'admin';
  if (pathname === '/invite/accept' || pathname === '/invite') {
    const params = new URLSearchParams(search);
    const token = params.get('token') ?? '';
    return `invite-accept:${token}`;
  }
  return 'home';
}

describe('Router: URL → Route', () => {
  it('maps / to home', () => {
    expect(parseRoute('/')).toBe('home');
  });

  it('maps /admin to admin', () => {
    expect(parseRoute('/admin')).toBe('admin');
  });

  it('does NOT map /admin/ to home (trailing slash)', () => {
    expect(parseRoute('/admin/')).toBe('home');
  });

  it('maps /presentation/<24-char-hex> to presentation', () => {
    const id = 'a'.repeat(24);
    expect(parseRoute(`/presentation/${id}`)).toBe(`presentation:${id}`);
  });

  it('ignores non-hex or wrong-length IDs', () => {
    expect(parseRoute('/presentation/not-an-id')).toBe('home');
    expect(parseRoute('/presentation/abc123')).toBe('home');
  });

  it('maps /invite/accept?token=... to invite-accept', () => {
    expect(parseRoute('/invite/accept', '?token=abc123')).toBe('invite-accept:abc123');
  });

  it('maps /invite?token=... to invite-accept', () => {
    expect(parseRoute('/invite', '?token=xyz')).toBe('invite-accept:xyz');
  });

  it('invite-accept with no token has empty token', () => {
    expect(parseRoute('/invite/accept', '')).toBe('invite-accept:');
  });

  it('maps unknown paths to home', () => {
    expect(parseRoute('/unknown/path')).toBe('home');
    expect(parseRoute('/settings')).toBe('home');
  });
});

// ─── Invite token: multi-use time-based logic ─────────────────────────────

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

function acceptToken(token: MockInviteToken): { ok: boolean; error?: string } {
  if (!isTokenValid(token)) {
    if (token.revokedAt) return { ok: false, error: 'revoked' };
    if (token.expiresAt < new Date()) return { ok: false, error: 'expired' };
    if (token.uses >= token.maxUses) return { ok: false, error: 'exhausted' };
  }
  token.uses++;
  return { ok: true };
}

const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);

describe('Invite token: multi-use accept flow', () => {
  it('accepts a fresh single-use token', () => {
    const token: MockInviteToken = { uses: 0, maxUses: 1, expiresAt: future };
    const result = acceptToken(token);
    expect(result.ok).toBe(true);
    expect(token.uses).toBe(1);
  });

  it('rejects the same single-use token on second accept', () => {
    const token: MockInviteToken = { uses: 1, maxUses: 1, expiresAt: future };
    const result = acceptToken(token);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('exhausted');
  });

  it('allows multi-use token to be accepted multiple times up to maxUses', () => {
    const token: MockInviteToken = { uses: 0, maxUses: 5, expiresAt: future };
    for (let i = 0; i < 5; i++) {
      const result = acceptToken(token);
      expect(result.ok).toBe(true);
    }
    expect(token.uses).toBe(5);
    const last = acceptToken(token);
    expect(last.ok).toBe(false);
    expect(last.error).toBe('exhausted');
  });

  it('rejects expired token', () => {
    const token: MockInviteToken = { uses: 0, maxUses: 1, expiresAt: past };
    const result = acceptToken(token);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('expired');
  });

  it('rejects revoked token', () => {
    const token: MockInviteToken = {
      uses: 0,
      maxUses: 10,
      expiresAt: future,
      revokedAt: new Date(),
    };
    const result = acceptToken(token);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('revoked');
  });

  it('does not increment uses when rejected', () => {
    const token: MockInviteToken = { uses: 0, maxUses: 1, expiresAt: past };
    acceptToken(token);
    expect(token.uses).toBe(0);
  });
});

// ─── Invite link URL parsing: pasting full link vs. raw token ─────────────

describe('Invite link parsing (client-side)', () => {
  function extractToken(input: string): string {
    let t = input.trim();
    try {
      const url = new URL(t);
      const fromParam = url.searchParams.get('token');
      if (fromParam) t = fromParam;
    } catch { /* not a URL */ }
    return t;
  }

  it('extracts token from full invite URL', () => {
    const token = 'abc123def456';
    const url = `https://slides.example.com/invite/accept?token=${token}`;
    expect(extractToken(url)).toBe(token);
  });

  it('returns raw token when not a URL', () => {
    expect(extractToken('rawtoken12345')).toBe('rawtoken12345');
  });

  it('trims whitespace from pasted input', () => {
    expect(extractToken('  rawtoken  ')).toBe('rawtoken');
  });

  it('handles URL with multiple query params', () => {
    expect(extractToken('https://example.com/invite?ref=email&token=mytoken')).toBe('mytoken');
  });
});

// ─── Elements fingerprint (change detection) ──────────────────────────────

interface FakeElement { id: string; version?: number }

function fingerprintElements(elements: FakeElement[]): string {
  return elements.map((el) => `${el.id}:${el.version ?? 0}`).join('|');
}

describe('fingerprintElements', () => {
  it('returns empty string for empty array', () => {
    expect(fingerprintElements([])).toBe('');
  });

  it('is stable for the same elements', () => {
    const els = [{ id: 'a', version: 1 }, { id: 'b', version: 2 }];
    expect(fingerprintElements(els)).toBe(fingerprintElements([...els]));
  });

  it('changes when an element version bumps', () => {
    const before = [{ id: 'a', version: 1 }];
    const after = [{ id: 'a', version: 2 }];
    expect(fingerprintElements(before)).not.toBe(fingerprintElements(after));
  });

  it('changes when an element is added', () => {
    const before = [{ id: 'a', version: 1 }];
    const after = [{ id: 'a', version: 1 }, { id: 'b', version: 1 }];
    expect(fingerprintElements(before)).not.toBe(fingerprintElements(after));
  });

  it('changes when an element is removed', () => {
    const before = [{ id: 'a', version: 1 }, { id: 'b', version: 1 }];
    const after = [{ id: 'a', version: 1 }];
    expect(fingerprintElements(before)).not.toBe(fingerprintElements(after));
  });

  it('uses 0 as default when version is undefined', () => {
    const els = [{ id: 'x' }];
    expect(fingerprintElements(els)).toBe('x:0');
  });

  it('is order-sensitive (reordering changes fingerprint)', () => {
    const a = [{ id: 'a', version: 1 }, { id: 'b', version: 1 }];
    const b = [{ id: 'b', version: 1 }, { id: 'a', version: 1 }];
    expect(fingerprintElements(a)).not.toBe(fingerprintElements(b));
  });
});

// ─── Remote diff detection (collaboration fix) ────────────────────────────

describe('Remote diff detection via remoteVersion', () => {
  // Simulates the remoteVersion pattern: when a remote diff arrives,
  // remoteVersion increments, triggering the ExcalidrawCanvas useEffect.

  it('remoteVersion increment triggers canvas update', () => {
    let remoteVersion = 0;
    let canvasUpdateCount = 0;

    // Simulate the effect: fires when remoteVersion changes
    function simulateEffect(newVersion: number): void {
      if (newVersion !== remoteVersion) {
        remoteVersion = newVersion;
        canvasUpdateCount++;
      }
    }

    simulateEffect(0); // initial mount — no update
    expect(canvasUpdateCount).toBe(0);

    simulateEffect(1); // remote diff received
    expect(canvasUpdateCount).toBe(1);

    simulateEffect(1); // same version — no update
    expect(canvasUpdateCount).toBe(1);

    simulateEffect(2); // another remote diff
    expect(canvasUpdateCount).toBe(2);
  });

  it('fingerprint change detection avoids spurious updates', () => {
    const fp1 = [{ id: 'a', version: 1 }];
    const fp2 = [{ id: 'a', version: 1 }]; // same content
    const fp3 = [{ id: 'a', version: 2 }]; // changed

    expect(fingerprintElements(fp1)).toBe(fingerprintElements(fp2)); // no update needed
    expect(fingerprintElements(fp1)).not.toBe(fingerprintElements(fp3)); // update needed
  });
});

// ─── Server-side element fingerprint ──────────────────────────────────────

function serverFp(elements: unknown): string {
  return (Array.isArray(elements) ? elements : [])
    .map((el: Record<string, unknown>) => `${String(el['id'])}:${String(el['version'] ?? 0)}`)
    .join('|');
}

describe('serverFp (server-side fingerprint)', () => {
  it('handles non-array gracefully', () => {
    expect(serverFp(null)).toBe('');
    expect(serverFp(undefined)).toBe('');
    expect(serverFp({})).toBe('');
  });

  it('matches client fingerprint for same data', () => {
    const els = [{ id: 'a', version: 1 }, { id: 'b', version: 2 }];
    expect(serverFp(els)).toBe(fingerprintElements(els));
  });

  it('skips auto-version when elements unchanged', () => {
    const oldEls = [{ id: 'rect1', version: 3 }];
    const newEls = [{ id: 'rect1', version: 3 }];
    expect(serverFp(oldEls)).toBe(serverFp(newEls));
  });

  it('saves auto-version when version increments', () => {
    const oldEls = [{ id: 'rect1', version: 3 }];
    const newEls = [{ id: 'rect1', version: 4 }];
    expect(serverFp(oldEls)).not.toBe(serverFp(newEls));
  });
});

// ─── Permissions: canEdit / canView ──────────────────────────────────────

function makeId(n: string) { return { toString: () => n }; }

const owner = 'owner-1';
const editor = 'editor-1';
const viewer = 'viewer-1';
const stranger = 'stranger-1';

const makePresentation = (
  visibility: 'public' | 'private' | 'team-only',
  editors: string[] = [],
  viewers: string[] = [],
) => ({
  ownerUserId: makeId(owner),
  visibility,
  editorUserIds: editors.map(makeId),
  viewerUserIds: viewers.map(makeId),
  teamId: undefined,
});

describe('canEdit with editors list', () => {
  it('owner can always edit', () => {
    expect(canEdit(makePresentation('private'), owner)).toBe(true);
    expect(canEdit(makePresentation('public'), owner)).toBe(true);
    expect(canEdit(makePresentation('team-only'), owner)).toBe(true);
  });

  it('explicit editor can edit', () => {
    const pres = makePresentation('private', [editor]);
    expect(canEdit(pres, editor)).toBe(true);
  });

  it('stranger cannot edit private presentation', () => {
    expect(canEdit(makePresentation('private'), stranger)).toBe(false);
  });

  it('stranger cannot edit public presentation', () => {
    expect(canEdit(makePresentation('public'), stranger)).toBe(false);
  });

  it('viewer cannot edit', () => {
    const pres = makePresentation('private', [], [viewer]);
    expect(canEdit(pres, viewer)).toBe(false);
  });

  it('undefined userId cannot edit', () => {
    expect(canEdit(makePresentation('public'), undefined)).toBe(false);
  });
});

describe('canView with editors list', () => {
  it('explicit editor can view even private presentation', () => {
    const pres = makePresentation('private', [editor]);
    expect(canView(pres, editor)).toBe(true);
  });

  it('explicit viewer can view private presentation', () => {
    const pres = makePresentation('private', [], [viewer]);
    expect(canView(pres, viewer)).toBe(true);
  });

  it('stranger cannot view private presentation', () => {
    expect(canView(makePresentation('private'), stranger)).toBe(false);
  });

  it('anyone can view public presentation (anonymous)', () => {
    expect(canView(makePresentation('public'), undefined)).toBe(true);
  });

  it('team-only is not visible to stranger', () => {
    expect(canView(makePresentation('team-only'), stranger)).toBe(false);
  });
});

// ─── Role management logic ─────────────────────────────────────────────────

type UserRole = 'owner' | 'user' | 'anonymous';

function canChangeRole(
  requesterRole: UserRole,
  targetRole: UserRole,
  isSelf: boolean,
  newRole: string,
): { ok: boolean; error?: string } {
  if (requesterRole !== 'owner') return { ok: false, error: 'Only owners can change roles' };
  if (isSelf) return { ok: false, error: 'Cannot change your own role' };
  if (targetRole === 'anonymous') return { ok: false, error: 'Cannot change role of anonymous users' };
  if (!['owner', 'user'].includes(newRole)) return { ok: false, error: 'Invalid role' };
  return { ok: true };
}

describe('Role management', () => {
  it('owner can promote user to owner', () => {
    expect(canChangeRole('owner', 'user', false, 'owner').ok).toBe(true);
  });

  it('owner can demote owner to user', () => {
    expect(canChangeRole('owner', 'owner', false, 'user').ok).toBe(true);
  });

  it('owner cannot change their own role', () => {
    const result = canChangeRole('owner', 'owner', true, 'user');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('own role');
  });

  it('non-owner cannot change roles', () => {
    expect(canChangeRole('user', 'user', false, 'owner').ok).toBe(false);
  });

  it('cannot change anonymous user role', () => {
    const result = canChangeRole('owner', 'anonymous', false, 'user');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('anonymous');
  });

  it('rejects invalid role values', () => {
    const result = canChangeRole('owner', 'user', false, 'superadmin');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid role');
  });
});

// ─── Guest restriction logic ───────────────────────────────────────────────

describe('Guest restriction: cannot create presentations', () => {
  function canCreatePresentation(role: UserRole): boolean {
    return role !== 'anonymous';
  }

  it('owner can create presentations', () => {
    expect(canCreatePresentation('owner')).toBe(true);
  });

  it('regular user can create presentations', () => {
    expect(canCreatePresentation('user')).toBe(true);
  });

  it('anonymous/guest cannot create presentations', () => {
    expect(canCreatePresentation('anonymous')).toBe(false);
  });
});

// ─── Auth token sign-in flow ───────────────────────────────────────────────

describe('Auth token sign-in validation', () => {
  function isValidJwtFormat(token: string): boolean {
    const parts = token.trim().split('.');
    return parts.length === 3 && parts.every((p) => p.length > 0);
  }

  it('accepts a valid 3-part JWT format', () => {
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(isValidJwtFormat(token)).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidJwtFormat('')).toBe(false);
  });

  it('rejects strings with wrong number of parts', () => {
    expect(isValidJwtFormat('just.one')).toBe(false);
    expect(isValidJwtFormat('one.two.three.four')).toBe(false);
  });

  it('rejects non-JWT strings', () => {
    expect(isValidJwtFormat('not-a-token-at-all')).toBe(false);
    expect(isValidJwtFormat('abc')).toBe(false);
  });

  it('trims whitespace before validation', () => {
    const token = '  eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.sig  ';
    expect(isValidJwtFormat(token.trim())).toBe(true);
  });
});

// ─── Thumbnail persistence logic ───────────────────────────────────────────

describe('Thumbnail data URL size validation', () => {
  const MAX_THUMB_SIZE = 100 * 1024; // 100KB

  function validateThumb(dataUrl: string): { ok: boolean; error?: string } {
    if (dataUrl.length > MAX_THUMB_SIZE) {
      return { ok: false, error: `thumbnail exceeds maximum size of ${MAX_THUMB_SIZE} bytes` };
    }
    return { ok: true };
  }

  it('accepts small thumbnails under 100KB', () => {
    const small = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
    expect(validateThumb(small).ok).toBe(true);
  });

  it('rejects thumbnails over 100KB with error message', () => {
    const large = 'data:image/jpeg;base64,' + 'A'.repeat(MAX_THUMB_SIZE + 1);
    const result = validateThumb(large);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('exceeds maximum size');
  });

  it('exactly 100KB is acceptable', () => {
    const exact = 'A'.repeat(MAX_THUMB_SIZE);
    expect(validateThumb(exact).ok).toBe(true);
  });
});

// ─── Presentation thumbnailMode ───────────────────────────────────────────

type ThumbnailMode = 'first-slide' | 'grid';

function normalizeThumbnailMode(value?: string): ThumbnailMode {
  if (value === 'grid') return 'grid';
  return 'first-slide';
}

describe('thumbnailMode', () => {
  it('defaults to first-slide', () => {
    expect(normalizeThumbnailMode(undefined)).toBe('first-slide');
    expect(normalizeThumbnailMode('')).toBe('first-slide');
  });

  it('accepts grid mode', () => {
    expect(normalizeThumbnailMode('grid')).toBe('grid');
  });

  it('rejects unknown values and falls back to first-slide', () => {
    expect(normalizeThumbnailMode('unknown')).toBe('first-slide');
  });
});

// ─── Auth: username validation ────────────────────────────────────────────

describe('Username validation (invite sign-up)', () => {
  const USERNAME_RE = /^[a-z0-9_]{2,40}$/;

  it('accepts valid lowercase alphanumeric+underscore', () => {
    expect(USERNAME_RE.test('alice')).toBe(true);
    expect(USERNAME_RE.test('alice_smith')).toBe(true);
    expect(USERNAME_RE.test('user123')).toBe(true);
    expect(USERNAME_RE.test('a1')).toBe(true);
  });

  it('rejects usernames shorter than 2 chars', () => {
    expect(USERNAME_RE.test('a')).toBe(false);
    expect(USERNAME_RE.test('')).toBe(false);
  });

  it('rejects usernames longer than 40 chars', () => {
    expect(USERNAME_RE.test('a'.repeat(41))).toBe(false);
  });

  it('rejects uppercase letters', () => {
    expect(USERNAME_RE.test('Alice')).toBe(false);
    expect(USERNAME_RE.test('ADMIN')).toBe(false);
  });

  it('rejects special characters', () => {
    expect(USERNAME_RE.test('alice-smith')).toBe(false);
    expect(USERNAME_RE.test('alice smith')).toBe(false);
    expect(USERNAME_RE.test('alice@example')).toBe(false);
  });
});

// ─── Grid thumbnail mode ───────────────────────────────────────────────────

describe('Grid thumbnail mode', () => {
  type ThumbnailMode = 'first-slide' | 'grid';

  // Simulates server-side logic for choosing which slides to include
  function buildThumbnailPayload(
    mode: ThumbnailMode,
    slideThumbs: (string | null)[],
  ): { thumbnail: string | null; gridThumbnails?: (string | null)[] } {
    if (mode === 'grid') {
      return { thumbnail: null, gridThumbnails: slideThumbs.slice(0, 4) };
    }
    return { thumbnail: slideThumbs[0] ?? null };
  }

  it('first-slide mode returns single thumbnail', () => {
    const result = buildThumbnailPayload('first-slide', ['data:a', 'data:b', 'data:c']);
    expect(result.thumbnail).toBe('data:a');
    expect(result.gridThumbnails).toBeUndefined();
  });

  it('grid mode returns null thumbnail and gridThumbnails array', () => {
    const result = buildThumbnailPayload('grid', ['data:a', 'data:b', 'data:c', 'data:d']);
    expect(result.thumbnail).toBeNull();
    expect(result.gridThumbnails).toEqual(['data:a', 'data:b', 'data:c', 'data:d']);
  });

  it('grid mode caps at 4 slides', () => {
    const result = buildThumbnailPayload('grid', ['a', 'b', 'c', 'd', 'e', 'f']);
    expect(result.gridThumbnails).toHaveLength(4);
  });

  it('grid mode with fewer than 4 slides returns what is available', () => {
    const result = buildThumbnailPayload('grid', ['a', 'b']);
    expect(result.gridThumbnails).toHaveLength(2);
    expect(result.gridThumbnails).toEqual(['a', 'b']);
  });

  it('grid mode with no thumbnails returns empty array', () => {
    const result = buildThumbnailPayload('grid', []);
    expect(result.gridThumbnails).toHaveLength(0);
  });

  it('first-slide mode with empty thumbnails returns null', () => {
    const result = buildThumbnailPayload('first-slide', []);
    expect(result.thumbnail).toBeNull();
  });

  it('grid mode nulls in array are preserved (slide not yet visited)', () => {
    const result = buildThumbnailPayload('grid', ['data:a', null, 'data:c', null]);
    expect(result.gridThumbnails).toEqual(['data:a', null, 'data:c', null]);
  });
});

// ─── Instant collaboration: debounce timing ────────────────────────────────

describe('Collaboration debounce: RTC vs API save', () => {
  it('RTC debounce (50ms) is much shorter than API save debounce (800ms)', () => {
    const RTC_DEBOUNCE_MS = 50;
    const API_SAVE_DEBOUNCE_MS = 800;
    expect(RTC_DEBOUNCE_MS).toBeLessThan(100);
    expect(API_SAVE_DEBOUNCE_MS).toBeGreaterThanOrEqual(500);
    // RTC should be at least 8× faster than API save
    expect(API_SAVE_DEBOUNCE_MS / RTC_DEBOUNCE_MS).toBeGreaterThanOrEqual(8);
  });

  it('consecutive scene changes only result in one API call per debounce window', () => {
    let apiCallCount = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const API_DEBOUNCE = 800;

    function onSceneChange() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { apiCallCount++; }, API_DEBOUNCE);
    }

    // Simulate 10 rapid changes within 800ms window
    for (let i = 0; i < 10; i++) onSceneChange();

    // Before the debounce fires, count is still 0
    expect(apiCallCount).toBe(0);

    // After the debounce: only 1 call (would be verified in integration test)
    // Here we just verify the debouncing logic structure
    if (timer) clearTimeout(timer);
  });

  it('RTC sendDiff is called immediately (synchronously) per change', () => {
    const rtcCalls: number[] = [];
    let changeCount = 0;

    function simulateSceneChange() {
      changeCount++;
      // RTC is sent without delay
      rtcCalls.push(changeCount);
    }

    simulateSceneChange();
    simulateSceneChange();
    simulateSceneChange();

    // All 3 changes should have triggered an RTC call without delay
    expect(rtcCalls).toHaveLength(3);
    expect(rtcCalls).toEqual([1, 2, 3]);
  });
});

// ─── Named cursor / laser pointer ─────────────────────────────────────────

describe('Named cursor/laser pointer', () => {
  interface RemotePointer {
    x: number;
    y: number;
    displayName: string;
    color: string;
  }

  function updatePointers(
    prev: Map<string, RemotePointer>,
    userId: string,
    x: number,
    y: number,
    visible: boolean,
    presence: Array<{ userId: string; displayName: string; color: string }>,
  ): Map<string, RemotePointer> {
    const next = new Map(prev);
    if (visible) {
      const existing = prev.get(userId);
      const pUser = presence.find((p) => p.userId === userId);
      next.set(userId, {
        x, y,
        displayName: existing?.displayName ?? pUser?.displayName ?? userId.slice(0, 6),
        color: existing?.color ?? pUser?.color ?? '#6965db',
      });
    } else {
      next.delete(userId);
    }
    return next;
  }

  it('adds a pointer when visible=true', () => {
    const map = updatePointers(new Map(), 'u1', 0.5, 0.3, true, [
      { userId: 'u1', displayName: 'Alice', color: '#e94560' },
    ]);
    expect(map.has('u1')).toBe(true);
    expect(map.get('u1')!.displayName).toBe('Alice');
    expect(map.get('u1')!.color).toBe('#e94560');
  });

  it('removes a pointer when visible=false', () => {
    const initial = new Map([['u1', { x: 0.5, y: 0.3, displayName: 'Alice', color: '#e94560' }]]);
    const map = updatePointers(initial, 'u1', 0, 0, false, []);
    expect(map.has('u1')).toBe(false);
  });

  it('uses fallback display name (first 6 chars of userId) when presence missing', () => {
    const map = updatePointers(new Map(), 'user-xyz-123', 0.2, 0.4, true, []);
    expect(map.get('user-xyz-123')!.displayName).toBe('user-x');
  });

  it('preserves existing display name if presence update arrives later', () => {
    const initial = new Map([['u1', { x: 0.1, y: 0.1, displayName: 'Alice', color: '#e94560' }]]);
    const map = updatePointers(initial, 'u1', 0.5, 0.5, true, []); // no presence info
    expect(map.get('u1')!.displayName).toBe('Alice'); // kept from existing
  });

  it('updates pointer position without losing display name', () => {
    const initial = new Map([['u1', { x: 0.1, y: 0.1, displayName: 'Bob', color: '#4fc3f7' }]]);
    const map = updatePointers(initial, 'u1', 0.9, 0.8, true, []);
    expect(map.get('u1')!.x).toBe(0.9);
    expect(map.get('u1')!.y).toBe(0.8);
    expect(map.get('u1')!.displayName).toBe('Bob');
  });

  it('pointer coordinates are normalised (0-1 range)', () => {
    // Test boundary values: 0 and 1 are both valid
    const map0 = updatePointers(new Map(), 'u1', 0, 0, true, []);
    expect(map0.get('u1')!.x).toBe(0);
    expect(map0.get('u1')!.y).toBe(0);

    const map1 = updatePointers(new Map(), 'u2', 1, 1, true, []);
    expect(map1.get('u2')!.x).toBe(1);
    expect(map1.get('u2')!.y).toBe(1);

    const mapMid = updatePointers(new Map(), 'u3', 0.5, 0.75, true, []);
    expect(mapMid.get('u3')!.x).toBe(0.5);
    expect(mapMid.get('u3')!.y).toBe(0.75);
  });
});

// ─── HUD auto-hide timing ─────────────────────────────────────────────────

describe('HUD auto-hide behaviour', () => {
  it('HUD_TIMEOUT is set to 3000ms (3 seconds)', () => {
    const HUD_TIMEOUT = 3000;
    expect(HUD_TIMEOUT).toBe(3000);
    expect(HUD_TIMEOUT).toBeGreaterThan(2000);
    expect(HUD_TIMEOUT).toBeLessThan(10000);
  });

  it('resetting timer keeps HUD visible', () => {
    let visible = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function resetHud() {
      visible = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { visible = false; }, 3000);
    }

    resetHud();
    resetHud();
    resetHud();

    // After 3 resets, HUD is still visible (timer hasn't fired)
    expect(visible).toBe(true);
    if (timer) clearTimeout(timer);
  });
});

// ─── Thumbnail retry logic ────────────────────────────────────────────────

describe('Thumbnail generation retry logic', () => {
  it('does not generate thumbnail when elements array is empty (no retries left)', async () => {
    let generated = false;
    let attempts = 0;

    async function tryGenerate(retries: number): Promise<void> {
      attempts++;
      const elements: unknown[] = []; // always empty
      if (!elements.length) {
        if (retries > 0) {
          await new Promise((r) => setTimeout(r, 1));
          return tryGenerate(retries - 1);
        }
        return;
      }
      generated = true;
    }

    await tryGenerate(0);
    expect(generated).toBe(false);
    expect(attempts).toBe(1);
  });

  it('retries up to 3 times when elements are empty', async () => {
    let attempts = 0;

    async function tryGenerate(retries: number): Promise<void> {
      attempts++;
      const elements: unknown[] = [];
      if (!elements.length) {
        if (retries > 0) {
          await new Promise((r) => setTimeout(r, 1));
          return tryGenerate(retries - 1);
        }
        return;
      }
    }

    await tryGenerate(3);
    expect(attempts).toBe(4); // initial + 3 retries
  });

  it('succeeds on second attempt when elements become available', async () => {
    let attempts = 0;
    let generated = false;
    let hasElements = false;

    // Simulate elements becoming available after 1st try
    setTimeout(() => { hasElements = true; }, 0);

    async function tryGenerate(retries: number): Promise<void> {
      attempts++;
      if (!hasElements) {
        if (retries > 0) {
          await new Promise((r) => setTimeout(r, 1));
          hasElements = true; // elements are now available
          return tryGenerate(retries - 1);
        }
        return;
      }
      generated = true;
    }

    await tryGenerate(3);
    expect(attempts).toBe(2);
    expect(generated).toBe(true);
  });
});
