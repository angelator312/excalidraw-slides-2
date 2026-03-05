import { Router } from 'express';
import { Library, validateLibraryData, MAX_LIBRARY_SIZE_BYTES } from '../models/library.js';
import { Presentation } from '../models/presentation.js';
import { canView, canEdit } from '../middleware/perm.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router({ mergeParams: true });

/**
 * GET /api/presentations/:id/libraries
 * List all libraries attached to a presentation.
 */
router.get('/', optionalAuth, async (req: AuthenticatedRequest, res) => {
  const pres = await Presentation.findById(req.params['id']).lean();
  if (!pres) { res.status(404).json({ error: 'Presentation not found' }); return; }

  if (!canView(pres, req.user?._id?.toString(), req.shareRole)) {
    res.status(403).json({ error: 'Access denied' }); return;
  }

  const libraries = await Library.find({ presentationId: pres._id })
    .select('-libraryData') // omit heavy data in list view
    .sort({ createdAt: -1 })
    .lean();

  res.json(libraries);
});

/**
 * GET /api/presentations/:id/libraries/:libraryId
 * Fetch full library data (including elements).
 */
router.get('/:libraryId', optionalAuth, async (req: AuthenticatedRequest, res) => {
  const pres = await Presentation.findById(req.params['id']).lean();
  if (!pres) { res.status(404).json({ error: 'Presentation not found' }); return; }

  if (!canView(pres, req.user?._id?.toString(), req.shareRole)) {
    res.status(403).json({ error: 'Access denied' }); return;
  }

  const library = await Library.findOne({
    _id: req.params['libraryId'],
    presentationId: pres._id,
  }).lean();

  if (!library) { res.status(404).json({ error: 'Library not found' }); return; }

  res.json(library);
});

/**
 * PUT /api/presentations/:id/libraries/user
 * Upsert the per-presentation "user library" — automatically called when the
 * user modifies the Excalidraw library panel.  Uses a fixed slug `__user__`
 * so repeated saves update the same document instead of creating new ones.
 * Body: { libraryData: Record<string, unknown> }
 */
router.put('/user', requireAuth, async (req: AuthenticatedRequest, res) => {
  const pres = await Presentation.findById(req.params['id']).lean();
  if (!pres) { res.status(404).json({ error: 'Presentation not found' }); return; }

  if (!canEdit(pres, req.user!._id.toString(), req.shareRole)) {
    res.status(403).json({ error: 'Access denied' }); return;
  }

  const { libraryData } = req.body as { libraryData?: unknown };

  if (!validateLibraryData(libraryData)) {
    res.status(400).json({
      error: 'Invalid library format. Expected { type: "excalidrawlib", version: number, library: [...] } or { libraryItems: [...] }',
    });
    return;
  }

  const serialized = JSON.stringify(libraryData);
  if (serialized.length > MAX_LIBRARY_SIZE_BYTES) {
    res.status(413).json({ error: 'Library exceeds maximum size' });
    return;
  }

  const library = await Library.findOneAndUpdate(
    { presentationId: pres._id, name: '__user__' },
    {
      presentationId: pres._id,
      name: '__user__',
      libraryData,
      sizeBytes: serialized.length,
      createdBy: req.user!._id,
    },
    { upsert: true, new: true },
  );

  res.json({ _id: library._id, name: library.name, sizeBytes: library.sizeBytes });
});

/**
 * POST /api/presentations/:id/libraries
 * Upload / save a new library for a presentation.
 * Body: { name: string, libraryData: Record<string, unknown> }
 */
router.post('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  const pres = await Presentation.findById(req.params['id']).lean();
  if (!pres) { res.status(404).json({ error: 'Presentation not found' }); return; }

  if (!canEdit(pres, req.user!._id.toString(), req.shareRole)) {
    res.status(403).json({ error: 'Access denied' }); return;
  }

  const { name, libraryData } = req.body as {
    name?: string;
    libraryData?: unknown;
  };

  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' }); return;
  }

  // Validate library JSON shape
  if (!validateLibraryData(libraryData)) {
    res.status(400).json({
      error:
        'Invalid library format. Expected { type: "excalidrawlib", version: number, library: [...] } or { libraryItems: [...] }',
    });
    return;
  }

  // Enforce size limit
  const serialized = JSON.stringify(libraryData);
  if (serialized.length > MAX_LIBRARY_SIZE_BYTES) {
    res.status(413).json({
      error: `Library JSON exceeds maximum size of ${MAX_LIBRARY_SIZE_BYTES / (1024 * 1024)} MB`,
    });
    return;
  }

  const library = await Library.create({
    presentationId: pres._id,
    name: name.trim(),
    libraryData,
    sizeBytes: serialized.length,
    createdBy: req.user!._id,
  });

  res.status(201).json({
    _id: library._id,
    presentationId: library.presentationId,
    name: library.name,
    sizeBytes: library.sizeBytes,
    createdAt: library.createdAt,
  });
});

/**
 * DELETE /api/presentations/:id/libraries/:libraryId
 * Remove a library.
 */
router.delete('/:libraryId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const pres = await Presentation.findById(req.params['id']).lean();
  if (!pres) { res.status(404).json({ error: 'Presentation not found' }); return; }

  if (!canEdit(pres, req.user!._id.toString(), req.shareRole)) {
    res.status(403).json({ error: 'Access denied' }); return;
  }

  await Library.deleteOne({ _id: req.params['libraryId'], presentationId: pres._id });
  res.json({ message: 'Library deleted' });
});

export default router;
