import { useState, useEffect, useRef } from 'preact/hooks';
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

export function PresentationEditor({ presentationId, onBack }: Props) {
  const { user } = useAuth();
  const [pres, setPres] = useState<PresentationDetail | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'edit' | 'present'>('edit');
  const [showHistory, setShowHistory] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showExport, setShowExport] = useState(false);

  const slideRefs = useRef<Map<number, HTMLElement>>(new Map());

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

  /** Persist a scene change coming from the Excalidraw editor canvas */
  const handleSceneChange = async (sceneJSON: ExcalidrawScene) => {
    if (!pres) return;
    const slide = pres.slides[currentIndex];
    if (!slide) return;

    // Optimistically update local state
    setPres((prev) => {
      if (!prev) return prev;
      const slides = prev.slides.map((s, i) =>
        i === currentIndex ? { ...s, sceneJSON } : s,
      );
      return { ...prev, slides };
    });

    // Broadcast to other participants via WebSocket
    rtcClient.sendDiff(slide.id, sceneJSON);

    try {
      await apiFetch(`/api/presentations/${presentationId}/slides/${slide.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ sceneJSON }),
      });
    } catch {
      // non-critical — local state is still updated
    }
  };

  if (loading) return <div class="loading-placeholder">Loading presentation…</div>;
  if (error) return <div class="error-msg">{error} <button onClick={onBack}>Back</button></div>;
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
      <div class="editor-topbar">
        <button class="btn-icon" onClick={onBack} aria-label="Back to presentations">←</button>
        <h2 class="editor-title">{pres.title}</h2>
        <div class="editor-actions">
          {pres.canEdit && (
            <button class="btn-secondary" onClick={() => setShowHistory(true)}>
              History
            </button>
          )}
          <button class="btn-secondary" onClick={() => setShowShare(true)}>Share</button>
          <button class="btn-secondary" onClick={() => setShowExport(true)}>Export</button>
          <button class="btn-secondary" onClick={() => setShowSettings(true)}>Settings</button>
          <button class="btn-primary" onClick={() => setMode('present')}>▶ Present</button>
        </div>
      </div>

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
            <div class="empty-state">No slides yet</div>
          )}
        </div>
      </div>

      {showHistory && (
        <HistoryPanel
          presentationId={presentationId}
          slideId={currentSlide?.id ?? ''}
          onClose={() => setShowHistory(false)}
          onRestore={() => { setShowHistory(false); void loadPresentation(); }}
        />
      )}
      {showShare && (
        <ShareModal presentationId={presentationId} onClose={() => setShowShare(false)} />
      )}
      {showSettings && (
        <SettingsModal
          presentation={pres}
          onClose={() => setShowSettings(false)}
          onSave={() => { setShowSettings(false); void loadPresentation(); }}
        />
      )}
      {showExport && (
        <ExportModal
          slides={pres.slides}
          slideElementRefs={slideRefs}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}
