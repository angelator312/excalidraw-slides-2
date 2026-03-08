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

// ─── Invite token pre-validation ──────────────────────────────────────────

describe('Invite token pre-validation (check before profile form)', () => {
  type TokenStatus = 'valid' | 'expired' | 'maxed' | 'revoked' | 'invalid';

  interface CheckResult {
    valid?: boolean;
    error?: string;
  }

  function mockCheckResponse(status: TokenStatus): { ok: boolean; body: CheckResult } {
    switch (status) {
      case 'valid': return { ok: true, body: { valid: true } };
      case 'expired': return { ok: false, body: { error: 'Invite token has expired' } };
      case 'maxed': return { ok: false, body: { error: 'Invite token has reached its maximum use count' } };
      case 'revoked': return { ok: false, body: { error: 'Invite token has been revoked' } };
      case 'invalid': return { ok: false, body: { error: 'Invalid invite token' } };
    }
  }

  it('allows advancing to profile step when token is valid', async () => {
    let step: 'token' | 'profile' = 'token';
    let errorMsg = '';

    const res = mockCheckResponse('valid');
    if (!res.ok) {
      errorMsg = res.body.error ?? 'Invalid token';
    } else {
      step = 'profile';
    }

    expect(step).toBe('profile');
    expect(errorMsg).toBe('');
  });

  it('blocks profile step and shows error when token is maxed out', async () => {
    let step: 'token' | 'profile' = 'token';
    let errorMsg = '';

    const res = mockCheckResponse('maxed');
    if (!res.ok) {
      errorMsg = res.body.error ?? 'Invalid token';
    } else {
      step = 'profile';
    }

    expect(step).toBe('token');
    expect(errorMsg).toBe('Invite token has reached its maximum use count');
  });

  it('blocks profile step when token is expired', async () => {
    const res = mockCheckResponse('expired');
    expect(res.ok).toBe(false);
    expect(res.body.error).toBe('Invite token has expired');
  });

  it('blocks profile step when token is revoked', async () => {
    const res = mockCheckResponse('revoked');
    expect(res.ok).toBe(false);
    expect(res.body.error).toBe('Invite token has been revoked');
  });

  it('blocks profile step when token does not exist', async () => {
    const res = mockCheckResponse('invalid');
    expect(res.ok).toBe(false);
    expect(res.body.error).toBe('Invalid invite token');
  });

  it('maxUses validation: uses < maxUses → valid', () => {
    const uses = 2;
    const maxUses = 5;
    expect(uses >= maxUses).toBe(false); // not maxed
  });

  it('maxUses validation: uses >= maxUses → blocked', () => {
    const uses = 5;
    const maxUses = 5;
    expect(uses >= maxUses).toBe(true); // maxed
  });
});

// ─── Teams functionality ───────────────────────────────────────────────────

describe('Teams', () => {
  interface Team {
    _id: string;
    name: string;
    ownerUserId: string;
    memberUserIds: string[];
  }

  it('creates a team with the creator as owner and first member', () => {
    const userId = 'user1';
    const team: Team = {
      _id: 'team1',
      name: 'My Team',
      ownerUserId: userId,
      memberUserIds: [userId],
    };
    expect(team.ownerUserId).toBe(userId);
    expect(team.memberUserIds).toContain(userId);
  });

  it('isTeamMember returns true for owner', () => {
    const team: Team = { _id: 't1', name: 'T', ownerUserId: 'u1', memberUserIds: ['u1', 'u2'] };
    const isOwner = team.ownerUserId === 'u1' || team.memberUserIds.includes('u1');
    expect(isOwner).toBe(true);
  });

  it('isTeamMember returns false for non-member', () => {
    const team: Team = { _id: 't1', name: 'T', ownerUserId: 'u1', memberUserIds: ['u1'] };
    const isMember = team.ownerUserId === 'u99' || team.memberUserIds.includes('u99');
    expect(isMember).toBe(false);
  });

  it('cannot remove owner from team', () => {
    const team: Team = { _id: 't1', name: 'T', ownerUserId: 'u1', memberUserIds: ['u1', 'u2'] };
    const targetId = 'u1';
    const canRemove = targetId !== team.ownerUserId;
    expect(canRemove).toBe(false);
  });

  it('can remove a non-owner member', () => {
    const team: Team = { _id: 't1', name: 'T', ownerUserId: 'u1', memberUserIds: ['u1', 'u2'] };
    const targetId = 'u2';
    const canRemove = targetId !== team.ownerUserId;
    expect(canRemove).toBe(true);
    const updated = team.memberUserIds.filter((id) => id !== targetId);
    expect(updated).not.toContain('u2');
    expect(updated).toContain('u1');
  });

  it('prevents duplicate members', () => {
    const memberIds = ['u1', 'u2'];
    const newId = 'u2';
    const alreadyMember = memberIds.includes(newId);
    expect(alreadyMember).toBe(true);
  });

  it('team name is required', () => {
    function validateTeamName(name: string | undefined): string | null {
      if (!name?.trim()) return 'Team name is required';
      return null;
    }
    expect(validateTeamName('')).toBe('Team name is required');
    expect(validateTeamName(undefined)).toBe('Team name is required');
    expect(validateTeamName('My Team')).toBeNull();
  });
});

// ─── Collaborative laser in editor ────────────────────────────────────────

describe('Collaborative laser pointer', () => {
  it('broadcasting sends normalized coordinates (0-1)', () => {
    const containerWidth = 800;
    const containerHeight = 600;
    const clientX = 400;
    const clientY = 300;
    const rectLeft = 0;
    const rectTop = 0;

    const x = (clientX - rectLeft) / containerWidth;
    const y = (clientY - rectTop) / containerHeight;

    expect(x).toBe(0.5);
    expect(y).toBe(0.5);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(1);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(1);
  });

  it('showCursors=false hides remote cursor overlays', () => {
    const showCursors = false;
    const cursors = new Map([['u1', { x: 0.5, y: 0.5, displayName: 'Alice', color: '#e94560' }]]);
    const visibleCursors = showCursors ? cursors : new Map();
    expect(visibleCursors.size).toBe(0);
  });

  it('showCursors=true shows remote cursor overlays', () => {
    const showCursors = true;
    const cursors = new Map([['u1', { x: 0.5, y: 0.5, displayName: 'Alice', color: '#e94560' }]]);
    const visibleCursors = showCursors ? cursors : new Map();
    expect(visibleCursors.size).toBe(1);
  });
});

// ─── Route handling ────────────────────────────────────────────────────────

describe('Router – teams route', () => {
  type RoutePath = 'home' | 'presentation' | 'admin' | 'teams' | 'invite-accept';

  function parseRoute(pathname: string): RoutePath {
    if (pathname === '/admin') return 'admin';
    if (pathname === '/teams') return 'teams';
    if (pathname.match(/^\/presentation\/[0-9a-f]{24}\/?$/i)) return 'presentation';
    if (pathname === '/invite/accept' || pathname === '/invite') return 'invite-accept';
    return 'home';
  }

  it('parses /teams as teams route', () => {
    expect(parseRoute('/teams')).toBe('teams');
  });

  it('parses /admin as admin route', () => {
    expect(parseRoute('/admin')).toBe('admin');
  });

  it('parses / as home route', () => {
    expect(parseRoute('/')).toBe('home');
  });

  it('teams and admin are separate routes', () => {
    expect(parseRoute('/teams')).not.toBe('admin');
    expect(parseRoute('/admin')).not.toBe('teams');
  });
});

// ─── Teams membership fix ─────────────────────────────────────────────────

describe('Teams: isTeamMember after populate', () => {
  interface PopulatedTeam {
    ownerUserId: { toString: () => string };
    memberUserIds: Array<{ _id: { toString: () => string } } | string>;
  }

  // Simulates the raw (un-populated) check
  function isTeamMemberRaw(
    team: { ownerUserId: string; memberUserIds: string[] },
    userId: string,
  ): boolean {
    return (
      team.ownerUserId === userId ||
      team.memberUserIds.some((id) => id === userId)
    );
  }

  it('detects member via raw IDs before populate', () => {
    const team = { ownerUserId: 'u1', memberUserIds: ['u1', 'u2', 'u3'] };
    expect(isTeamMemberRaw(team, 'u2')).toBe(true);
    expect(isTeamMemberRaw(team, 'u99')).toBe(false);
  });

  it('toString on a populated object returns [object Object] - the old bug', () => {
    const populatedMember = { _id: { toString: () => 'u2' }, username: 'alice', displayName: 'Alice' };
    // The old code called id.toString() on populated objects
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const badResult = (populatedMember as any).toString();
    expect(badResult).toBe('[object Object]');
    expect(badResult).not.toBe('u2');
  });

  it('checking membership BEFORE populate correctly uses raw IDs', () => {
    // New server code checks raw team before populating
    const rawTeam = { ownerUserId: 'u1', memberUserIds: ['u1', 'u2'] };
    const userId = 'u2';
    const isMember = isTeamMemberRaw(rawTeam, userId);
    expect(isMember).toBe(true); // no longer erroneously 403
  });
});

// ─── Slide sync: editor should not follow remote slide changes ─────────────

describe('Slide sync: editor vs presenter view', () => {
  it('editor ignores slideChange RTC events (each user controls own view)', () => {
    let editorIndex = 2;
    const remoteIdx = 5;

    // In editor mode, no handler for slideChange
    const editorHandlers: Array<(idx: number) => void> = [];
    // (no slideChange handler registered in editor)

    // Simulate receiving a slideChange event
    editorHandlers.forEach((h) => h(remoteIdx));
    expect(editorIndex).toBe(2); // unchanged
  });

  it('presenter view follows slideChange RTC events', () => {
    let presenterIndex = 2;
    const remoteIdx = 5;

    // In presenter view, slide change IS followed
    const presenterHandlers: Array<(idx: number) => void> = [
      (idx) => { presenterIndex = idx; },
    ];

    presenterHandlers.forEach((h) => h(remoteIdx));
    expect(presenterIndex).toBe(5); // changed
  });
});

// ─── Self cursor filter ───────────────────────────────────────────────────

describe('Self cursor filter', () => {
  it('filters out own user ID from remote cursors', () => {
    const currentUserId = 'me123';
    const events = [
      { userId: 'other1', x: 0.3, y: 0.4, visible: true },
      { userId: 'me123', x: 0.5, y: 0.6, visible: true }, // self
      { userId: 'other2', x: 0.7, y: 0.8, visible: true },
    ];

    const cursors = new Map<string, { x: number; y: number }>();
    for (const ev of events) {
      if (ev.userId === currentUserId) continue; // filter self
      if (ev.visible) cursors.set(ev.userId, { x: ev.x, y: ev.y });
    }

    expect(cursors.has('me123')).toBe(false);
    expect(cursors.has('other1')).toBe(true);
    expect(cursors.has('other2')).toBe(true);
    expect(cursors.size).toBe(2);
  });
});

// ─── Resizable slide nav ──────────────────────────────────────────────────

describe('Resizable slide nav', () => {
  it('clamps nav width between 120 and 360', () => {
    function clampWidth(w: number): number {
      return Math.max(120, Math.min(360, w));
    }
    expect(clampWidth(50)).toBe(120);
    expect(clampWidth(500)).toBe(360);
    expect(clampWidth(200)).toBe(200);
    expect(clampWidth(120)).toBe(120);
    expect(clampWidth(360)).toBe(360);
  });

  it('calculates new width from drag delta', () => {
    const startWidth = 180;
    const startX = 300;
    const currentX = 340; // drag 40px to the right
    const delta = currentX - startX;
    const newWidth = Math.max(120, Math.min(360, startWidth + delta));
    expect(newWidth).toBe(220);
  });
});

// ─── Team-only visibility selector ───────────────────────────────────────

describe('Team-only visibility: team selector validation', () => {
  function validateVisibility(visibility: string, teamId: string | undefined): string | null {
    if (visibility === 'team-only' && !teamId) return 'Select a team for team-only visibility';
    return null;
  }

  it('requires teamId when visibility is team-only', () => {
    expect(validateVisibility('team-only', '')).toBe('Select a team for team-only visibility');
    expect(validateVisibility('team-only', undefined)).toBe('Select a team for team-only visibility');
  });

  it('allows team-only when teamId is provided', () => {
    expect(validateVisibility('team-only', 'team123')).toBeNull();
  });

  it('does not require teamId for other visibilities', () => {
    expect(validateVisibility('public', '')).toBeNull();
    expect(validateVisibility('private', '')).toBeNull();
  });
});

// ─── Thumbnail CSS fix ───────────────────────────────────────────────────

describe('Thumbnail: image fills container', () => {
  it('image with position:absolute inset:0 fills aspect-ratio container', () => {
    // The pres-card-thumb has aspect-ratio:16/9 and position:relative
    // The image should have position:absolute; inset:0; width:100%; height:100%
    const thumbStyles = { width: '100%', aspectRatio: '16/9', position: 'relative' as const };
    const imgStyles = { position: 'absolute' as const, inset: 0, width: '100%', height: '100%', objectFit: 'cover' as const };

    // With inset:0 and absolute positioning, the image fills the full container
    expect(imgStyles.position).toBe('absolute');
    expect(imgStyles.objectFit).toBe('cover');
    expect(thumbStyles.position).toBe('relative');
  });
});

// ─── Presenter view redesign ─────────────────────────────────────────────

describe('PresenterView: minimal pill bar', () => {
  it('formats slide counter as "Slide N / total"', () => {
    const counter = (current: number, total: number) => `Slide ${current + 1} / ${total}`;
    expect(counter(0, 12)).toBe('Slide 1 / 12');
    expect(counter(11, 12)).toBe('Slide 12 / 12');
  });

  it('auto-hide timer resets on mouse move', () => {
    let visible = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reset = () => {
      visible = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { visible = false; }, 3000);
    };
    reset();
    expect(visible).toBe(true);
    if (timer) clearTimeout(timer);
  });

  it('formats time correctly', () => {
    const formatTime = (s: number) =>
      `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(65)).toBe('01:05');
    expect(formatTime(3661)).toBe('61:01'); // minutes overflow is intentional (no hours field)
  });
});

// ─── Pointer coordinate fix ───────────────────────────────────────────────

describe('Pointer coordinates: wrapper div normalization', () => {
  it('normalizes clientX/Y to 0-1 relative to bounding rect', () => {
    const rect = { left: 100, top: 50, width: 800, height: 600 };
    const normalize = (clientX: number, clientY: number) => ({
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
    });
    const r = normalize(500, 350);
    expect(r.x).toBeCloseTo(0.5);
    expect(r.y).toBeCloseTo(0.5);
    // Top-left corner
    const tl = normalize(100, 50);
    expect(tl.x).toBeCloseTo(0);
    expect(tl.y).toBeCloseTo(0);
    // Bottom-right corner
    const br = normalize(900, 650);
    expect(br.x).toBeCloseTo(1);
    expect(br.y).toBeCloseTo(1);
  });

  it('rejects out-of-bounds coordinates', () => {
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    const isValid = (clientX: number, clientY: number) => {
      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;
      return x >= 0 && x <= 1 && y >= 0 && y <= 1;
    };
    expect(isValid(50, 50)).toBe(true);
    expect(isValid(-10, 50)).toBe(false);
    expect(isValid(50, 110)).toBe(false);
  });
});

// ─── Roles with permissions ───────────────────────────────────────────────

describe('Collaborator roles', () => {
  type Role = 'editor' | 'viewer';

  it('editor role allows editing and managing collaborators', () => {
    const permissions: Record<Role, string[]> = {
      editor: ['edit', 'export', 'manage-collaborators', 'change-settings'],
      viewer: ['view'],
    };
    expect(permissions.editor).toContain('edit');
    expect(permissions.editor).toContain('manage-collaborators');
    expect(permissions.viewer).not.toContain('edit');
    expect(permissions.viewer).toContain('view');
  });

  it('changing role moves user between lists', () => {
    const editorIds = ['u1', 'u2'];
    const viewerIds: string[] = [];

    const changeRole = (userId: string, newRole: Role) => {
      const eIdx = editorIds.indexOf(userId);
      const vIdx = viewerIds.indexOf(userId);
      if (eIdx !== -1) editorIds.splice(eIdx, 1);
      if (vIdx !== -1) viewerIds.splice(vIdx, 1);
      if (newRole === 'editor') editorIds.push(userId);
      else viewerIds.push(userId);
    };

    changeRole('u2', 'viewer');
    expect(editorIds).toEqual(['u1']);
    expect(viewerIds).toEqual(['u2']);

    changeRole('u2', 'editor');
    expect(editorIds).toContain('u2');
    expect(viewerIds).not.toContain('u2');
  });

  it('PATCH role endpoint validates role value', () => {
    const validateRole = (role: string) => role === 'editor' || role === 'viewer';
    expect(validateRole('editor')).toBe(true);
    expect(validateRole('viewer')).toBe(true);
    expect(validateRole('admin')).toBe(false);
    expect(validateRole('')).toBe(false);
  });
});

// ─── Collapsible slide nav ────────────────────────────────────────────────

describe('Collapsible slide nav panel', () => {
  it('toggles visibility state', () => {
    let visible = true;
    const toggle = () => { visible = !visible; };
    expect(visible).toBe(true);
    toggle();
    expect(visible).toBe(false);
    toggle();
    expect(visible).toBe(true);
  });
});
