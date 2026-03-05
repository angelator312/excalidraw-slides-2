import { useRef, useEffect, useState, useCallback } from 'preact/hooks';
import type { RefObject } from 'preact';
import type { SlideRef } from './slideModel';
import { rtcClient } from './rtc';
import type { Presence } from './rtc';
import { attachPointerListeners } from './laserPointer';
import { ExcalidrawViewer } from '../components/ExcalidrawViewer';

interface Props {
  slides: SlideRef[];
  currentIndex: number;
  onSlideChange: (index: number) => void;
  onExit: () => void;
  canControl: boolean;
  onNotesSave: (notes: string) => Promise<void>;
  slideElementRefs: RefObject<Map<number, HTMLElement>>;
  presentationId?: string;
  thumbnails?: Map<string, string>;
}

export function PresenterView({
  slides,
  currentIndex,
  onSlideChange,
  onExit,
  canControl,
  onNotesSave,
  presentationId,
  thumbnails,
}: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [notes, setNotes] = useState(slides[currentIndex]?.notes ?? '');
  const [laserActive, setLaserActive] = useState(false);
  const [remotePointers, setRemotePointers] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [presence, setPresence] = useState<Presence[]>([]);
  const slideAreaRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync notes when slide changes
  useEffect(() => {
    setNotes(slides[currentIndex]?.notes ?? '');
  }, [currentIndex, slides]);

  // Timer
  useEffect(() => {
    if (timerRunning) {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning]);

  // Remote pointers via RTC
  useEffect(() => {
    const unsubPresence = rtcClient.on('presence', (users) => setPresence(users));
    const unsubPointer = rtcClient.on('pointerMove', ({ userId, x, y, visible }) => {
      setRemotePointers((prev) => {
        const next = new Map(prev);
        if (visible) next.set(userId, { x, y });
        else next.delete(userId);
        return next;
      });
    });
    return () => { unsubPresence(); unsubPointer(); };
  }, []);

  // Laser pointer attachment
  useEffect(() => {
    if (!laserActive || !slideAreaRef.current) return;
    return attachPointerListeners(slideAreaRef.current);
  }, [laserActive]);

  // Keyboard navigation — stable deps, isolated from parent re-renders
  const currentIndexRef = useRef(currentIndex);
  const slidesLenRef = useRef(slides.length);
  currentIndexRef.current = currentIndex;
  slidesLenRef.current = slides.length;

  useEffect(() => {
    if (!canControl) return;
    const handler = (e: KeyboardEvent) => {
      // Don't steal keys from text inputs / textareas
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') {
        onSlideChange(Math.min(currentIndexRef.current + 1, slidesLenRef.current - 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        onSlideChange(Math.max(currentIndexRef.current - 1, 0));
      } else if (e.key === 'Escape') {
        onExit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // onSlideChange and onExit are stable useCallback refs from PresentationEditor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canControl, onSlideChange, onExit]);

  const prevSlide = useCallback(() => {
    onSlideChange(Math.max(0, currentIndex - 1));
  }, [onSlideChange, currentIndex]);

  const nextSlide = useCallback(() => {
    onSlideChange(Math.min(slides.length - 1, currentIndex + 1));
  }, [onSlideChange, currentIndex, slides.length]);

  const resetTimer = useCallback(() => {
    setElapsed(0);
    setTimerRunning(false);
  }, []);

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const currentSlide = slides[currentIndex];
  const nextSlideObj = slides[currentIndex + 1];

  const colorForUser = (idx: number) => {
    const colors = ['#e94560', '#4fc3f7', '#81c784', '#ffb74d', '#ce93d8', '#80cbc4'];
    return colors[idx % colors.length];
  };

  return (
    <div class="presenter-view" aria-label="Presenter view">
      {/* Top bar */}
      <div class="presenter-topbar">
        <button class="btn-icon" onClick={onExit} aria-label="Exit presentation">✕ Exit</button>
        <span class="slide-counter" aria-live="polite">
          {currentIndex + 1} / {slides.length}
        </span>
        <div class="presenter-controls">
          <button
            class={`btn-icon ${laserActive ? 'active' : ''}`}
            onClick={() => setLaserActive((v) => !v)}
            aria-pressed={laserActive}
            aria-label="Toggle laser pointer"
            title="Laser pointer"
          >
            🔴
          </button>
          <button
            class={`btn-icon ${timerRunning ? 'active' : ''}`}
            onClick={() => setTimerRunning((v) => !v)}
            aria-pressed={timerRunning}
            aria-label={timerRunning ? 'Pause timer' : 'Start timer'}
          >
            ⏱ {formatTime(elapsed)}
          </button>
          <button class="btn-icon" onClick={resetTimer} aria-label="Reset timer">↺</button>
        </div>
      </div>

      {/* Main presenter area */}
      <div class="presenter-body">
        {/* Current slide */}
        <div class="presenter-main">
          <div
            class="presenter-slide-area"
            ref={slideAreaRef}
            style={{ position: 'relative' }}
            aria-label="Current slide"
          >
            {currentSlide && (
              <ExcalidrawViewer
                key={`present-main-${currentSlide.id}`}
                slide={currentSlide}
                viewMode={true}
                presentationId={presentationId}
                className="presenter-excalidraw"
              />
            )}
            {/* Remote laser pointers */}
            {Array.from(remotePointers.entries()).map(([uid, pos]) => (
              <div
                key={uid}
                class="laser-pointer"
                style={{ left: `${pos.x * 100}%`, top: `${pos.y * 100}%` }}
                aria-hidden="true"
              />
            ))}
          </div>

          {/* Navigation */}
          {canControl && (
            <div class="presenter-nav-btns">
              <button
                class="btn-secondary"
                onClick={prevSlide}
                disabled={currentIndex === 0}
                aria-label="Previous slide"
              >
                ← Prev
              </button>
              <button
                class="btn-primary"
                onClick={nextSlide}
                disabled={currentIndex === slides.length - 1}
                aria-label="Next slide"
              >
                Next →
              </button>
            </div>
          )}
        </div>

        {/* Sidebar: next slide + notes + presence */}
        <div class="presenter-sidebar">
          <div class="next-slide-preview">
            <h4>Next slide</h4>
            {nextSlideObj ? (
              <div class="slide-thumb-small" aria-label={`Next: ${nextSlideObj.title}`}>
                {thumbnails?.get(nextSlideObj.id) ? (
                  <img
                    src={thumbnails.get(nextSlideObj.id)}
                    alt={nextSlideObj.title}
                    class="thumb-img-full"
                  />
                ) : (
                  <ExcalidrawViewer
                    key={`present-next-${nextSlideObj.id}`}
                    slide={nextSlideObj}
                    viewMode={true}
                    className="presenter-excalidraw-thumb"
                  />
                )}
                <span class="thumb-label">{nextSlideObj.title}</span>
              </div>
            ) : (
              <p class="text-muted">Last slide</p>
            )}
          </div>

          <div class="notes-area">
            <h4>Speaker notes</h4>
            <textarea
              class="notes-editor"
              value={notes}
              onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
              onBlur={() => void onNotesSave(notes)}
              placeholder="Add speaker notes here…"
              aria-label="Speaker notes"
              rows={6}
            />
          </div>

          <div class="presence-area">
            <h4>In this presentation ({presence.length})</h4>
            <ul class="presence-list">
              {presence.map((p, i) => (
                <li key={p.userId} class="presence-item">
                  <span
                    class="presence-dot"
                    style={{ background: colorForUser(i) }}
                    aria-hidden="true"
                  />
                  <span>{p.displayName}</span>
                  {p.slideIndex !== currentIndex && (
                    <span class="text-muted"> (slide {p.slideIndex + 1})</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Thumbnail strip */}
      <div class="presenter-thumbstrip" role="listbox" aria-label="Slides">
        {slides.map((s, i) => {
          const thumb = thumbnails?.get(s.id);
          return (
            <button
              key={s.id}
              class={`thumb-item ${i === currentIndex ? 'active' : ''}`}
              onClick={() => canControl && onSlideChange(i)}
              aria-selected={i === currentIndex}
              aria-label={`Slide ${i + 1}: ${s.title}`}
              role="option"
            >
              {thumb ? (
                <img src={thumb} alt="" class="thumb-item-img" />
              ) : (
                <span class="thumb-number">{i + 1}</span>
              )}
              <span class="thumb-title">{s.title || `Slide ${i + 1}`}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
