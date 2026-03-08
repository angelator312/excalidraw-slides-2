import { describe, it, expect } from 'vitest';
import { canView, canEdit } from '../server/src/middleware/permUtils.js';

// Minimal mock of an ObjectId-like value
function makeId(n: string) {
  return {
    toString: () => n,
  };
}

const ownerId = 'user-owner';
const editor1Id = 'user-editor1';
const viewer1Id = 'user-viewer1';
const strangerId = 'user-stranger';

const makePresentation = (
  visibility: 'public' | 'private' | 'team-only',
  editors: string[] = [],
  viewers: string[] = [],
) => ({
  ownerUserId: makeId(ownerId),
  visibility,
  editorUserIds: editors.map(makeId),
  viewerUserIds: viewers.map(makeId),
  teamId: undefined,
});

describe('canView', () => {
  it('allows anyone to view a public presentation', () => {
    const pres = makePresentation('public');
    expect(canView(pres, undefined)).toBe(true);
    expect(canView(pres, strangerId)).toBe(true);
  });

  it('allows owner to view a private presentation', () => {
    expect(canView(makePresentation('private'), ownerId)).toBe(true);
  });

  it('allows explicit editor to view a private presentation', () => {
    const pres = makePresentation('private', [editor1Id]);
    expect(canView(pres, editor1Id)).toBe(true);
  });

  it('allows explicit viewer to view a private presentation', () => {
    const pres = makePresentation('private', [], [viewer1Id]);
    expect(canView(pres, viewer1Id)).toBe(true);
  });

  it('denies stranger from viewing a private presentation', () => {
    const pres = makePresentation('private', [], [viewer1Id]);
    expect(canView(pres, strangerId)).toBe(false);
  });

  it('denies unauthenticated user from viewing a private presentation', () => {
    expect(canView(makePresentation('private'), undefined)).toBe(false);
  });

  it('allows view share link holder to view a private presentation', () => {
    const pres = makePresentation('private');
    expect(canView(pres, strangerId, 'view')).toBe(true);
  });

  it('allows edit share link holder to view any presentation', () => {
    const pres = makePresentation('private');
    expect(canView(pres, strangerId, 'edit')).toBe(true);
  });
});

describe('canEdit', () => {
  it('allows owner to edit', () => {
    expect(canEdit(makePresentation('private'), ownerId)).toBe(true);
  });

  it('allows explicit editor to edit', () => {
    const pres = makePresentation('private', [editor1Id]);
    expect(canEdit(pres, editor1Id)).toBe(true);
  });

  it('denies viewer from editing', () => {
    const pres = makePresentation('private', [], [viewer1Id]);
    expect(canEdit(pres, viewer1Id)).toBe(false);
  });

  it('denies stranger from editing', () => {
    expect(canEdit(makePresentation('public'), strangerId)).toBe(false);
  });

  it('denies unauthenticated user from editing', () => {
    expect(canEdit(makePresentation('public'), undefined)).toBe(false);
  });

  it('allows edit share link holder to edit', () => {
    const pres = makePresentation('private');
    expect(canEdit(pres, strangerId, 'edit')).toBe(true);
  });

  it('denies view share link holder from editing', () => {
    const pres = makePresentation('private');
    expect(canEdit(pres, strangerId, 'view')).toBe(false);
  });
});
