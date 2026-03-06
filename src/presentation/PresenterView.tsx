import { useRef, useEffect, useState, useCallback } from 'preact/hooks';
import type { SlideRef } from './slideModel';
import { rtcClient } from './rtc';
import type { Presence } from './rtc';
import { hidePointer } from './laserPointer';
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
  const [showNotes, setShowNotes] = useState(false);
  const [barVisible, setBarVisible] = useState(true);
  const [presence, setPresence] = useState<Presence[]>([]);
  /** userId → {x, y, displayName, color} for named laser/pointer overlays */
  const [remotePointers, setRemotePointers] = useState<
    Map<string, { x: number; y: number; displayName: string; color: string }>
  >(new Map());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const barHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    return () => {
      unsubPresence();
      unsubPointer();
      hidePointer();
    };
  }, [currentUserId]);

  // Bar auto-hide: show on mouse move, hide after 3s of inactivity
  const resetBarTimer = useCallback(() => {
    setBarVisible(true);
    if (barHideTimer.current) clearTimeout(barHideTimer.current);
    barHideTimer.current = setTimeout(() => setBarVisible(false), 3000);
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', resetBarTimer);
    window.addEventListener('keydown', resetBarTimer);
    resetBarTimer();
    return () => {
      window.removeEventListener('mousemove', resetBarTimer);
      window.removeEventListener('keydown', resetBarTimer);
      if (barHideTimer.current) clearTimeout(barHideTimer.current);
    };
  }, [resetBarTimer]);

  // Keyboard navigation
  const currentIndexRef = useRef(currentIndex);
  const slidesLenRef = useRef(slides.length);
  currentIndexRef.current = currentIndex;
  slidesLenRef.current = slides.length;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (canControl && (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown')) {
        e.preventDefault();
        onSlideChange(Math.min(currentIndexRef.current + 1, slidesLenRef.current - 1));
      } else if (canControl && (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp')) {
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

  const enterFullscreen = () => {
    const el = document.documentElement;
    if (el.requestFullscreen) void el.requestFullscreen();
  };

  return (
    <div class="pv-root" aria-label="Presentation viewer">
      {/* ── Full-screen slide canvas ── */}
      <div class="pv-slide-area">
        {currentSlide && (
          <ExcalidrawViewer
            key={`present-main-${currentSlide.id}`}
            slide={currentSlide}
            viewMode={true}
            presentationId={presentationId}
            className="pv-excalidraw"
            enableCollabLaser={true}
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

      {/* ── Minimal floating control bar (Excalidraw-style) ── */}
      <div class={`pv-bar ${barVisible ? 'pv-bar--visible' : ''}`} role="toolbar" aria-label="Presentation controls">
        {canControl && (
          <button
            class="pv-bar-btn"
            onClick={prevSlide}
            disabled={currentIndex === 0}
            aria-label="Previous slide"
            title="Previous slide (←)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        )}

        <span class="pv-bar-counter" aria-live="polite">
          Slide {currentIndex + 1} / {slides.length}
        </span>

        {canControl && (
          <button
            class="pv-bar-btn"
            onClick={nextSlide}
            disabled={currentIndex === slides.length - 1}
            aria-label="Next slide"
            title="Next slide (→)"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        )}

        <div class="pv-bar-sep" aria-hidden="true" />

        {/* Timer */}
        <button
          class={`pv-bar-btn ${timerRunning ? 'pv-bar-btn--active' : ''}`}
          onClick={() => setTimerRunning((v) => !v)}
          title={timerRunning ? `Pause timer (${formatTime(elapsed)})` : `Start timer${elapsed > 0 ? ` (${formatTime(elapsed)})` : ''}`}
          aria-label={timerRunning ? 'Pause timer' : 'Start timer'}
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <circle cx="7.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="1.5"/>
            <path d="M7.5 5.5v3l2 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M5.5 1.5h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          {elapsed > 0 && <span class="pv-bar-time">{formatTime(elapsed)}</span>}
        </button>

        {elapsed > 0 && (
          <button class="pv-bar-btn" onClick={resetTimer} title="Reset timer" aria-label="Reset timer">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 7a5 5 0 1 0 1.5-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M2 2v3h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        )}

        {/* Notes */}
        <button
          class={`pv-bar-btn ${showNotes ? 'pv-bar-btn--active' : ''}`}
          onClick={() => setShowNotes((v) => !v)}
          title="Speaker notes"
          aria-pressed={showNotes}
          aria-label="Toggle speaker notes"
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <rect x="1.5" y="1.5" width="12" height="12" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
            <path d="M4 5h7M4 7.5h5M4 10h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>

        {/* People count */}
        {presence.length > 0 && (
          <span class="pv-bar-people" aria-label={`${presence.length} people watching`} title={`${presence.length} people watching`}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
              <circle cx="5" cy="4" r="2.5" stroke="currentColor" stroke-width="1.3"/>
              <path d="M1 11c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              <circle cx="10" cy="4.5" r="1.8" stroke="currentColor" stroke-width="1.3"/>
              <path d="M11.5 10c0-1.6-1-2.8-2.5-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            </svg>
            {presence.length}
          </span>
        )}

        <div class="pv-bar-sep" aria-hidden="true" />

        {/* Fullscreen */}
        <button class="pv-bar-btn" onClick={enterFullscreen} title="Fullscreen" aria-label="Enter fullscreen">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M1 4V1h3M10 1h3v3M13 10v3h-3M4 13H1v-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>

        {/* Exit */}
        <button class="pv-bar-btn pv-bar-btn--exit" onClick={onExit} title="Exit presentation (Esc)" aria-label="Exit presentation">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      {/* ── Speaker notes panel ── */}
      {showNotes && (
        <div class="pv-notes-panel" role="complementary" aria-label="Speaker notes">
          <div class="pv-notes-header">
            <span>Speaker notes</span>
            <button class="pv-bar-btn" onClick={() => setShowNotes(false)} aria-label="Close notes">✕</button>
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
    </div>
  );
}
