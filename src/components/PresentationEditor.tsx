import { useState, useEffect, useRef } from 'preact/hooks';
import { apiFetch } from '../lib/api';
import { PresenterView } from '../presentation/PresenterView';
import type { SlideRef, ExcalidrawScene } from '../presentation/slideModel';
import { SlideNav } from '../presentation/SlideNav';
import { HistoryPanel } from '../presentation/HistoryPanel';
import { ShareModal } from './ShareModal';
import { SettingsModal } from '../presentation/SettingsModal';
import { ExportModal } from '../presentation/ExportModal';
import { LibraryUploader } from './LibraryUploader';
import { ExcalidrawViewer } from './ExcalidrawViewer';
import { rtcClient } from '../presentation/rtc';
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
  slides: SlideRef[];
}

type Panel = 'history' | 'share' | 'settings' | 'export' | 'libraries' | null;

export function PresentationEditor({ presentationId, onBack }: Props) {
  const { user } = useAuth();
  const [pres, setPres] = useState<PresentationDetail | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'edit' | 'present'>('edit');
  const [openPanel, setOpenPanel] = useState<Panel>(null);

  const slideRefs = useRef<Map<number, HTMLElement>>(new Map());

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
      rtcClient.on('slideChange', (idx) => setCurrentIndex(idx)),
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
      }),
    ];
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

  const handleSlideSelect = (index: number) => {
    setCurrentIndex(index);
    rtcClient.sendSlideChange(index);
  };

  const handleNotesSave = async (notes: string) => {
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
  };

  const handleSceneChange = async (sceneJSON: ExcalidrawScene) => {
    if (!pres) return;
    const slide = pres.slides[currentIndex];
    if (!slide) return;

    setPres((prev) => {
      if (!prev) return prev;
      const slides = prev.slides.map((s, i) =>
        i === currentIndex ? { ...s, sceneJSON } : s,
      );
      return { ...prev, slides };
    });

    rtcClient.sendDiff(slide.id, sceneJSON);

    try {
      await apiFetch(`/api/presentations/${presentationId}/slides/${slide.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ sceneJSON }),
      });
    } catch {
      // non-critical
    }
  };

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
        onExit={() => setMode('edit')}
        canControl={pres.canEdit || user?.role === 'owner'}
        onNotesSave={handleNotesSave}
        slideElementRefs={slideRefs}
        presentationId={presentationId}
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
          {pres.canEdit && (
            <button
              class={`btn-toolbar ${openPanel === 'libraries' ? 'active' : ''}`}
              onClick={() => togglePanel('libraries')}
              title="Manage libraries"
              aria-pressed={openPanel === 'libraries'}
            >
              Libraries
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
          <button
            class={`btn-toolbar ${openPanel === 'settings' ? 'active' : ''}`}
            onClick={() => togglePanel('settings')}
            title="Settings"
            aria-pressed={openPanel === 'settings'}>
            ⚙
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
        <SlideNav
          slides={pres.slides}
          currentIndex={currentIndex}
          onSelect={handleSlideSelect}
          canEdit={pres.canEdit}
          presentationId={presentationId}
          onSlidesChange={(slides) => setPres((p) => p ? { ...p, slides } : p)}
        />

        <div class="slide-canvas-area">
          {currentSlide ? (
            <div
              class="slide-excalidraw-wrap"
              ref={(el) => { if (el) slideRefs.current.set(currentIndex, el); }}
            >
              <ExcalidrawViewer
                slide={currentSlide}
                viewMode={!pres.canEdit}
                onChange={pres.canEdit ? handleSceneChange : undefined}
                presentationId={presentationId}
              />
            </div>
          ) : (
            <div class="empty-state">No slides yet. Add one in the panel on the left.</div>
          )}
        </div>

        {/* ── Right side panels ── */}
        {openPanel === 'history' && (
          <HistoryPanel
            presentationId={presentationId}
            slideId={currentSlide?.id ?? ''}
            onClose={() => setOpenPanel(null)}
            onRestore={() => { setOpenPanel(null); void loadPresentation(); }}
          />
        )}
        {openPanel === 'libraries' && (
          <aside class="side-panel" aria-label="Library management">
            <div class="side-panel-header">
              <h2>Libraries</h2>
              <button class="panel-close-btn" onClick={() => setOpenPanel(null)} aria-label="Close">✕</button>
            </div>
            <div class="side-panel-body">
              <LibraryUploader
                presentationId={presentationId}
                onLibraryUploaded={() => {
                  // Library saved to server — Excalidraw will reload it via
                  // useHandleLibrary on the next mount (when the editor re-opens).
                  // No in-place refresh needed; users can reopen to pick it up.
                }}
              />
            </div>
          </aside>
        )}
      </div>

      {/* ── Modal panels (share, export, settings) ── */}
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
