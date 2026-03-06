import { useRef, useEffect, useState, useCallback } from 'preact/hooks';
import type { SlideRef } from './slideModel';
import { rtcClient } from './rtc';
import type { Presence } from './rtc';
import { broadcastPointer, hidePointer } from './laserPointer';
import { ExcalidrawViewer } from '../components/ExcalidrawViewer';

interface Props {
  slides: SlideRef[];
  currentIndex: number;
  onSlideChange: (index: number) => void;
  onExit: () => void;
  canControl: boolean;
  onNotesSave: (notes: string) => Promise<void>;
  slideElementRefs: { current: Map<number, HTMLElement> };
  presentationId?: string;
  thumbnails?: Map<string, string>;
  /** Current user's ID to filter self from cursor overlays */
  currentUserId?: string;
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
  currentUserId,
}: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [notes, setNotes] = useState(slides[currentIndex]?.notes ?? '');
  const [laserActive, setLaserActive] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showPeople, setShowPeople] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [presence, setPresence] = useState<Presence[]>([]);
  /** userId → {x, y, displayName, color} for named laser/pointer overlays */
  const [remotePointers, setRemotePointers] = useState<
    Map<string, { x: number; y: number; displayName: string; color: string }>
  >(new Map());
  const slideAreaRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hudHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presenceRef = useRef<Presence[]>([]);
  presenceRef.current = presence;

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

  // RTC: presence + remote laser pointers
  useEffect(() => {
    const unsubPresence = rtcClient.on('presence', (users) => {
      setPresence(users);
      setRemotePointers((prev) => {
        const next = new Map(prev);
        for (const [uid, ptr] of prev.entries()) {
          const u = users.find((p) => p.userId === uid);
          if (u) next.set(uid, { ...ptr, displayName: u.displayName, color: u.color });
        }
        return next;
      });
    });
    const unsubPointer = rtcClient.on('pointerMove', ({ userId, x, y, visible }) => {
      // Filter out own cursor
      if (currentUserId && userId === currentUserId) return;
      setRemotePointers((prev) => {
        const next = new Map(prev);
        if (visible) {
          const existing = prev.get(userId);
          const pUser = presenceRef.current.find((p) => p.userId === userId);
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
    });
    return () => { unsubPresence(); unsubPointer(); };
  }, [currentUserId]);

  // Local laser pointer broadcasting
  useEffect(() => {
    if (!laserActive || !slideAreaRef.current) return;
    const el = slideAreaRef.current;
    let active = false;

    const onMouseMove = (e: MouseEvent) => {
      if (!active) return;
      const rect = el.getBoundingClientRect();
      broadcastPointer((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
    };
    const onMouseDown = () => { active = true; };
    const onMouseUp = () => { active = false; hidePointer(); };
    const onMouseLeave = () => { active = false; hidePointer(); };

    el.addEventListener('mousemove', onMouseMove);
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('mouseup', onMouseUp);
    el.addEventListener('mouseleave', onMouseLeave);
    return () => {
      el.removeEventListener('mousemove', onMouseMove);
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('mouseleave', onMouseLeave);
      hidePointer();
    };
  }, [laserActive]);

  // HUD auto-hide: show on mouse move, hide after 3s of inactivity
  const resetHudTimer = useCallback(() => {
    setHudVisible(true);
    if (hudHideTimer.current) clearTimeout(hudHideTimer.current);
    hudHideTimer.current = setTimeout(() => setHudVisible(false), 3000);
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', resetHudTimer);
    window.addEventListener('keydown', resetHudTimer);
    resetHudTimer();
    return () => {
      window.removeEventListener('mousemove', resetHudTimer);
      window.removeEventListener('keydown', resetHudTimer);
      if (hudHideTimer.current) clearTimeout(hudHideTimer.current);
    };
  }, [resetHudTimer]);

  // Keyboard navigation
  const currentIndexRef = useRef(currentIndex);
  const slidesLenRef = useRef(slides.length);
  currentIndexRef.current = currentIndex;
  slidesLenRef.current = slides.length;

  useEffect(() => {
    if (!canControl) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        onSlideChange(Math.min(currentIndexRef.current + 1, slidesLenRef.current - 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        onSlideChange(Math.max(currentIndexRef.current - 1, 0));
      } else if (e.key === 'Escape') {
        onExit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
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

  return (
    <div class="pv-root" aria-label="Presenter view">
      {/* ── Full-screen slide canvas ── */}
      <div
        class={`pv-slide-area ${laserActive ? 'pv-laser-cursor' : ''}`}
        ref={slideAreaRef}
      >
        {currentSlide && (
          <ExcalidrawViewer
            key={`present-main-${currentSlide.id}`}
            slide={currentSlide}
            viewMode={true}
            presentationId={presentationId}
            className="pv-excalidraw"
          />
        )}

        {/* Named remote laser/cursor pointers */}
        {Array.from(remotePointers.entries()).map(([uid, ptr]) => (
          <div
            key={uid}
            class="pv-laser"
            style={{ left: `${ptr.x * 100}%`, top: `${ptr.y * 100}%`, '--laser-color': ptr.color } as Record<string, string>}
            aria-hidden="true"
          >
            <span class="pv-laser-dot" />
            <span class="pv-laser-name">{ptr.displayName}</span>
          </div>
        ))}
      </div>

      {/* ── Auto-hide HUD overlay ── */}
      <div class={`pv-hud ${hudVisible ? 'pv-hud--visible' : ''}`} role="toolbar" aria-label="Presentation controls">
        {/* Slide thumbnail strip */}
        <div class="pv-thumbstrip" role="listbox" aria-label="Slides">
          {slides.map((s, i) => {
            const thumb = thumbnails?.get(s.id);
            return (
              <button
                key={s.id}
                class={`pv-thumb ${i === currentIndex ? 'pv-thumb--active' : ''}`}
                onClick={() => canControl && onSlideChange(i)}
                aria-selected={i === currentIndex}
                aria-label={`Slide ${i + 1}: ${s.title}`}
                role="option"
                title={s.title || `Slide ${i + 1}`}
              >
                {thumb ? (
                  <img src={thumb} alt="" class="pv-thumb-img" />
                ) : (
                  <span class="pv-thumb-num">{i + 1}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Controls bar */}
        <div class="pv-controls">
          <div class="pv-controls-left">
            <button class="pv-btn pv-btn--exit" onClick={onExit} title="Exit (Esc)">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
              Exit
            </button>
          </div>

          <div class="pv-controls-center">
            {canControl && (
              <button class="pv-btn pv-btn--nav" onClick={prevSlide} disabled={currentIndex === 0} aria-label="Previous slide">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            )}
            <span class="pv-counter" aria-live="polite">{currentIndex + 1} / {slides.length}</span>
            {canControl && (
              <button class="pv-btn pv-btn--nav" onClick={nextSlide} disabled={currentIndex === slides.length - 1} aria-label="Next slide">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            )}
          </div>

          <div class="pv-controls-right">
            {canControl && (
              <button
                class={`pv-btn pv-btn--icon ${laserActive ? 'pv-btn--active' : ''}`}
                onClick={() => setLaserActive((v) => !v)}
                title="Laser pointer"
                aria-pressed={laserActive}
              >
                🔴
              </button>
            )}
            <button
              class={`pv-btn pv-btn--icon ${timerRunning ? 'pv-btn--active' : ''}`}
              onClick={() => setTimerRunning((v) => !v)}
              title={timerRunning ? 'Pause timer' : 'Start timer'}
            >
              ⏱ {formatTime(elapsed)}
            </button>
            <button class="pv-btn pv-btn--icon" onClick={resetTimer} title="Reset timer">↺</button>
            <button
              class={`pv-btn pv-btn--icon ${showNotes ? 'pv-btn--active' : ''}`}
              onClick={() => setShowNotes((v) => !v)}
              title="Speaker notes"
              aria-pressed={showNotes}
            >
              📝
            </button>
            <button
              class={`pv-btn pv-btn--icon ${showPeople ? 'pv-btn--active' : ''}`}
              onClick={() => setShowPeople((v) => !v)}
              title={`People (${presence.length})`}
              aria-pressed={showPeople}
            >
              👥{presence.length > 0 && <span class="pv-people-count">{presence.length}</span>}
            </button>
          </div>
        </div>
      </div>

      {/* ── Notes panel (floating, bottom-left) ── */}
      {showNotes && (
        <div class="pv-panel pv-panel--notes" role="complementary" aria-label="Speaker notes">
          <div class="pv-panel-header">
            <span>Speaker notes</span>
            <button class="pv-btn pv-btn--icon pv-panel-close" onClick={() => setShowNotes(false)} aria-label="Close notes">✕</button>
          </div>
          <textarea
            class="pv-notes-editor"
            value={notes}
            onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
            onBlur={() => void onNotesSave(notes)}
            placeholder="Add speaker notes here…"
            aria-label="Speaker notes"
          />
        </div>
      )}

      {/* ── People panel (floating, bottom-right) ── */}
      {showPeople && (
        <div class="pv-panel pv-panel--people" role="complementary" aria-label="People in presentation">
          <div class="pv-panel-header">
            <span>In this presentation ({presence.length})</span>
            <button class="pv-btn pv-btn--icon pv-panel-close" onClick={() => setShowPeople(false)} aria-label="Close people">✕</button>
          </div>
          <ul class="pv-people-list">
            {presence.map((p) => (
              <li key={p.userId} class="pv-people-item">
                <span class="pv-people-dot" style={{ background: p.color }} aria-hidden="true" />
                <span>{p.displayName}</span>
                {p.slideIndex !== currentIndex && (
                  <span class="pv-people-slide"> (slide {p.slideIndex + 1})</span>
                )}
              </li>
            ))}
            {presence.length === 0 && <li class="pv-people-empty">Only you</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

