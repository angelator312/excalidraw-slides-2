import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { apiFetch } from '../lib/api';
import { PresenterView } from '../presentation/PresenterView';
import type { SlideRef, ExcalidrawScene } from '../presentation/slideModel';
import { SlideNav } from '../presentation/SlideNav';
import { HistoryPanel } from '../presentation/HistoryPanel';
import { ShareModal } from './ShareModal';
import { SettingsModal } from '../presentation/SettingsModal';
import { ExportModal } from '../presentation/ExportModal';
import { ExcalidrawViewer } from './ExcalidrawViewer';
import { rtcClient } from '../presentation/rtc';
import type { Presence } from '../presentation/rtc';
import { useAuth } from '../hooks/useAuth';

interface Props {
  presentationId: string;
  onBack: () => void;
}

export interface PresentationDetail {
  _id: string;
  title: string;
  visibility: 'public' | 'private' | 'team-only';
  ownerUsername: string;
  canEdit: boolean;
  editors: Array<{ _id: string; username: string; displayName: string }>;
  /** All collaborators with their role */
  collaborators?: Array<{ _id: string; username: string; displayName: string; role: 'editor' | 'viewer' }>;
  thumbnailMode?: 'first-slide' | 'grid';
  teamId?: string;
  slides: SlideRef[];
}

type Panel = 'history' | 'share' | 'settings' | 'export' | null;

export function PresentationEditor({ presentationId, onBack }: Props) {
  const { user } = useAuth();
  const [pres, setPres] = useState<PresentationDetail | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'edit' | 'present'>('edit');
  const [openPanel, setOpenPanel] = useState<Panel>(null);
  /** scene to show as a temporary hover preview in the canvas (null = current slide) */
  const [previewScene, setPreviewScene] = useState<ExcalidrawScene | null | undefined>(undefined);
  /** slideId → PNG thumbnail data URL */
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  /** Incremented whenever a remote diff is received to trigger ExcalidrawCanvas update */
  const [remoteVersion, setRemoteVersion] = useState(0);
  /** Live presence (collaborators) in this presentation */
  const [presence, setPresence] = useState<Presence[]>([]);
  /** Ref to latest presence so pointer handlers can look up display names without a stale closure */
  const presenceRef = useRef<Presence[]>([]);
  presenceRef.current = presence;
  /** Remote pointer positions (userId → {x, y, displayName, color}) for cursor overlay in editor */
  const [remoteCursors, setRemoteCursors] = useState<Map<string, { x: number; y: number; displayName: string; color: string }>>(new Map());
  /** Whether to show remote cursors in the editor */
  const [showCursors, setShowCursors] = useState(true);
  /** Whether collaborative laser pointer is active in the editor */
  const [collabLaser, setCollabLaser] = useState(false);

  /** Slide nav panel width (resizable via drag handle) */
  const [slideNavWidth, setSlideNavWidth] = useState(180);
  /** Whether the slide nav panel is visible */
  const [slideNavVisible, setSlideNavVisible] = useState(true);
  const slideNavResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleNavResizeMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    slideNavResizeRef.current = { startX: e.clientX, startWidth: slideNavWidth };
    const onMouseMove = (ev: MouseEvent) => {
      if (!slideNavResizeRef.current) return;
      const delta = ev.clientX - slideNavResizeRef.current.startX;
      setSlideNavWidth(Math.max(120, Math.min(360, slideNavResizeRef.current.startWidth + delta)));
    };
    const onMouseUp = () => {
      slideNavResizeRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const slideRefs = useRef<Map<number, HTMLElement>>(new Map());
  const thumbPersistTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /** Debounced API save timer — keyed by slideId so rapid edits don't flood the server */
  const apiSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Ref to the slide canvas wrapper for collab laser hit-testing */
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  // Cursor broadcasting is now handled inside ExcalidrawCanvas via its wrapper mousemove listener.
  // The collabLaser state is passed as the `enableCollabLaser` prop to ExcalidrawViewer/Canvas.

  // Close panel on Escape
  useEffect(() => {
    if (!openPanel) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenPanel(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openPanel]);

  useEffect(() => {
    void loadPresentation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentationId]);

  useEffect(() => {
    const token = localStorage.getItem('sessionToken') ?? '';
    rtcClient.connect(window.location.origin, presentationId, token);
    const unsubs = [
      // Do NOT auto-follow remote slide changes in the editor — each user controls their own view.
      // (Slide sync is only used in PresenterView for presenter-controlled navigation.)
      rtcClient.on('diff', (payload) => {
        setPres((prev) => {
          if (!prev) return prev;
          const slides = prev.slides.map((s) =>
            s.id === payload.slideId
              ? { ...s, sceneJSON: payload.sceneJSON as SlideRef['sceneJSON'] }
              : s,
          );
          return { ...prev, slides };
        });
        // Increment remoteVersion so ExcalidrawCanvas picks up the new elements
        setRemoteVersion((v) => v + 1);
      }),
      rtcClient.on('presence', (users) => {
        setPresence(users);
      }),
      rtcClient.on('pointerMove', ({ userId, x, y, visible }) => {
        // Filter out own cursor — only show others' cursors
        if (userId === user?._id) return;
        // Update cursor position for the collaborator overlay in the editor
        setRemoteCursors((prev) => {
          const next = new Map(prev);
          if (visible) {
            const existing = prev.get(userId);
            // Look up the user's display name from the current presence list
            const pUser = presenceRef.current.find((u) => u.userId === userId);
            next.set(userId, {
              x, y,
              displayName: existing?.displayName ?? pUser?.displayName ?? userId.slice(0, 6),
              color: existing?.color ?? pUser?.color ?? '#6965db',
            });
          } else {
            next.delete(userId);
          }
          return next;
        });
      }),
    ];
    // Sync pointer cursor display names from presence updates
    const presenceSub = rtcClient.on('presence', (users) => {
      setRemoteCursors((prev) => {
        const next = new Map(prev);
        for (const [uid, cursor] of prev.entries()) {
          const found = users.find((u) => u.userId === uid);
          if (found) {
            next.set(uid, { ...cursor, displayName: found.displayName, color: found.color });
          }
        }
        return next;
      });
    });
    unsubs.push(presenceSub);
    return () => {
      unsubs.forEach((u) => u());
      rtcClient.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentationId]);

  const loadPresentation = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<PresentationDetail>(`/api/presentations/${presentationId}`);
      setPres(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  const handleSlideSelect = useCallback((index: number) => {
    setCurrentIndex(index);
    rtcClient.sendSlideChange(index);
  }, []);

  const handleNotesSave = useCallback(async (notes: string) => {
    if (!pres) return;
    const slide = pres.slides[currentIndex];
    if (!slide) return;
    try {
      await apiFetch(`/api/presentations/${presentationId}/slides/${slide.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ notes }),
      });
      setPres((prev) => {
        if (!prev) return prev;
        const slides = prev.slides.map((s, i) => (i === currentIndex ? { ...s, notes } : s));
        return { ...prev, slides };
      });
    } catch {
      // non-critical
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pres, currentIndex, presentationId]);

  const handleSceneChange = useCallback(async (sceneJSON: ExcalidrawScene) => {
    if (!pres) return;
    const slide = pres.slides[currentIndex];
    if (!slide) return;

    // 1. Update local state immediately (no wait)
    setPres((prev) => {
      if (!prev) return prev;
      const slides = prev.slides.map((s, i) =>
        i === currentIndex ? { ...s, sceneJSON } : s,
      );
      return { ...prev, slides };
    });

    // 2. Broadcast via RTC immediately for instant collaboration
    rtcClient.sendDiff(slide.id, sceneJSON);

    // 3. Debounce API save at 800 ms to avoid flooding the server on rapid strokes
    if (apiSaveTimer.current) clearTimeout(apiSaveTimer.current);
    const slideIdForSave = slide.id;
    const sceneForSave = sceneJSON;
    apiSaveTimer.current = setTimeout(async () => {
      try {
        await apiFetch(`/api/presentations/${presentationId}/slides/${slideIdForSave}`, {
          method: 'PATCH',
          body: JSON.stringify({ sceneJSON: sceneForSave }),
        });
      } catch {
        // non-critical
      }
    }, 800);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pres, currentIndex, presentationId]);

  const handleThumbnailChange = useCallback((slideId: string, dataUrl: string) => {
    setThumbnails((prev) => {
      const next = new Map(prev);
      // Revoke the old object URL to free memory
      const old = prev.get(slideId);
      if (old?.startsWith('blob:')) URL.revokeObjectURL(old);
      next.set(slideId, dataUrl);
      return next;
    });
    // Debounce thumbnail persistence to avoid excessive API calls during rapid edits
    const existing = thumbPersistTimers.current.get(slideId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      thumbPersistTimers.current.delete(slideId);
      void apiFetch(`/api/presentations/${presentationId}/slides/${slideId}`, {
        method: 'PATCH',
        body: JSON.stringify({ thumbnail: dataUrl }),
      }).catch(() => { /* non-critical */ });
    }, 3000); // wait 3 s after last thumbnail change before persisting
    thumbPersistTimers.current.set(slideId, timer);
  }, [presentationId]);

  const handleSlideRename = useCallback(async (slideId: string, title: string) => {
    try {
      await apiFetch(`/api/presentations/${presentationId}/slides/${slideId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      });
      setPres((prev) => {
        if (!prev) return prev;
        const slides = prev.slides.map((s) => (s.id === slideId ? { ...s, title } : s));
        return { ...prev, slides };
      });
    } catch {
      // non-critical
    }
  }, [presentationId]);

  const handleExitPresent = useCallback(() => setMode('edit'), []);

  const togglePanel = (panel: Panel) =>
    setOpenPanel((prev) => (prev === panel ? null : panel));

  if (loading) return <div class="loading-placeholder"><div class="spinner"/></div>;
  if (error) return <div class="error-msg">{error} <button class="btn-ghost" onClick={onBack}>Back</button></div>;
  if (!pres) return null;

  const currentSlide = pres.slides[currentIndex] ?? pres.slides[0];

  if (mode === 'present') {
    return (
      <PresenterView
        slides={pres.slides}
        currentIndex={currentIndex}
        onSlideChange={handleSlideSelect}
        onExit={handleExitPresent}
        canControl={pres.canEdit || user?.role === 'owner'}
        onNotesSave={handleNotesSave}
        slideElementRefs={slideRefs}
        presentationId={presentationId}
        thumbnails={thumbnails}
        currentUserId={user?._id}
      />
    );
  }

  return (
    <div class="editor-layout">
      {/* ── Top bar ── */}
      <div class="editor-topbar">
        <button class="btn-icon editor-back-btn" onClick={onBack} aria-label="Back to presentations">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M10.5 3L5.5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          </svg>
        </button>
        <h1 class="editor-title">{pres.title}</h1>
        <div class="editor-actions">
          {pres.canEdit && (
            <button
              class={`btn-toolbar ${openPanel === 'history' ? 'active' : ''}`}
              onClick={() => togglePanel('history')}
              title="Slide history"
              aria-pressed={openPanel === 'history'}
            >
              History
            </button>
          )}
          <button
            class={`btn-toolbar ${openPanel === 'share' ? 'active' : ''}`}
            onClick={() => togglePanel('share')}
            title="Share"
            aria-pressed={openPanel === 'share'}>
            Share
          </button>
          <button
            class={`btn-toolbar ${openPanel === 'export' ? 'active' : ''}`}
            onClick={() => togglePanel('export')}
            title="Export"
            aria-pressed={openPanel === 'export'}>
            Export
          </button>
          {/* Collaborative laser pointer — visible to all viewers */}
          <button
            class={`btn-toolbar btn-toolbar--icon ${collabLaser ? 'active' : ''}`}
            onClick={() => setCollabLaser((v) => !v)}
            title={collabLaser ? 'Stop laser (visible to all)' : 'Collaborative laser (visible to all)'}
            aria-pressed={collabLaser}
            aria-label="Collaborative laser pointer"
          >
            🔴
          </button>
          {/* Toggle remote cursors */}
          <button
            class={`btn-toolbar btn-toolbar--icon ${showCursors ? 'active' : ''}`}
            onClick={() => setShowCursors((v) => !v)}
            title={showCursors ? 'Hide collaborator cursors' : 'Show collaborator cursors'}
            aria-pressed={showCursors}
            aria-label="Toggle collaborator cursors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 2 L2 12 L5 9 L7 13 L9 12 L7 8 L11 8 Z" fill="currentColor" stroke="currentColor" stroke-width="0.5" stroke-linejoin="round"/>
            </svg>
          </button>
          <button
            class={`btn-toolbar btn-toolbar--icon ${openPanel === 'settings' ? 'active' : ''}`}
            onClick={() => togglePanel('settings')}
            title="Settings"
            aria-pressed={openPanel === 'settings'}
            aria-label="Settings"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="10" cy="10" r="2.5" stroke="currentColor" stroke-width="1.6"/>
              <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="btn-present" onClick={() => setMode('present')}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
              <polygon points="2,1 13,7 2,13"/>
            </svg>
            Present
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div class="editor-body">
        {slideNavVisible && (
          <SlideNav
            slides={pres.slides}
            currentIndex={currentIndex}
            onSelect={handleSlideSelect}
            canEdit={pres.canEdit}
            presentationId={presentationId}
            onSlidesChange={(slides) => setPres((p) => p ? { ...p, slides } : p)}
            onRename={handleSlideRename}
            thumbnails={thumbnails}
            style={{ width: `${slideNavWidth}px`, flexShrink: 0 }}
          />
        )}
        {slideNavVisible && (
          /* Drag handle to resize the slide nav panel */
          <div
            class="slide-nav-resize-handle"
            onMouseDown={handleNavResizeMouseDown}
            aria-label="Resize slide panel"
            title="Drag to resize"
            role="separator"
            aria-orientation="vertical"
          />
        )}
        {/* Toggle button to show/hide slide panel */}
        <button
          class="slide-nav-toggle"
          onClick={() => setSlideNavVisible((v) => !v)}
          aria-label={slideNavVisible ? 'Hide slides panel' : 'Show slides panel'}
          title={slideNavVisible ? 'Hide slides panel' : 'Show slides panel'}
          aria-pressed={slideNavVisible}
        >
          {slideNavVisible ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M9 2L4 7l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M5 2l5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          )}
        </button>

        <div class="slide-canvas-area">
          {currentSlide ? (
            <div
              class={`slide-excalidraw-wrap ${collabLaser ? 'slide-excalidraw-wrap--laser' : ''}`}
              ref={(el) => {
                if (el) slideRefs.current.set(currentIndex, el);
                (canvasWrapRef as { current: HTMLDivElement | null }).current = el;
              }}
              style={{ position: 'relative' }}
            >
              <ExcalidrawViewer
                slide={currentSlide}
                viewMode={!pres.canEdit || openPanel === 'history'}
                onChange={pres.canEdit ? handleSceneChange : undefined}
                onThumbnailChange={handleThumbnailChange}
                presentationId={presentationId}
                previewScene={previewScene}
                remoteVersion={remoteVersion}
                enableCollabLaser={collabLaser}
              />
              {/* Collaborator cursor overlay (gated by showCursors) */}
              {showCursors && remoteCursors.size > 0 && Array.from(remoteCursors.entries()).map(([uid, cur]) => (
                <div
                  key={uid}
                  class="collab-cursor"
                  style={{
                    left: `${cur.x * 100}%`,
                    top: `${cur.y * 100}%`,
                    '--cursor-color': cur.color,
                  } as Record<string, string>}
                  aria-hidden="true"
                >
                  <svg width="16" height="20" viewBox="0 0 16 20" fill="none">
                    <path d="M0 0 L0 16 L4 12 L7 18 L9 17 L6 11 L12 11 Z" fill={cur.color} stroke="white" stroke-width="1"/>
                  </svg>
                  <span class="collab-cursor-label">{cur.displayName}</span>
                </div>
              ))}
            </div>
          ) : (
            <div class="empty-state">No slides yet. Add one in the panel on the left.</div>
          )}
        </div>

        {/* ── History side panel ── */}
        {openPanel === 'history' && (
          <HistoryPanel
            presentationId={presentationId}
            slideId={currentSlide?.id ?? ''}
            onClose={() => setOpenPanel(null)}
            onRestore={() => { setOpenPanel(null); void loadPresentation(); }}
            onPreviewScene={setPreviewScene}
          />
        )}
      </div>

      {/* ── Modal panels ── */}
      {openPanel === 'share' && (
        <ShareModal presentationId={presentationId} onClose={() => setOpenPanel(null)} />
      )}
      {openPanel === 'settings' && (
        <SettingsModal
          presentation={pres}
          onClose={() => setOpenPanel(null)}
          onSave={() => { setOpenPanel(null); void loadPresentation(); }}
        />
      )}
      {openPanel === 'export' && (
        <ExportModal
          slides={pres.slides}
          slideElementRefs={slideRefs}
          onClose={() => setOpenPanel(null)}
        />
      )}
    </div>
  );
}
