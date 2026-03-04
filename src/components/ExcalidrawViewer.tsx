/**
 * ExcalidrawViewer — public API wrapper that lazy-loads ExcalidrawCanvas.
 *
 * Keeping the heavy @excalidraw/excalidraw imports inside ExcalidrawCanvas.tsx
 * (a default export) lets Vite code-split them into a separate chunk, keeping
 * the initial page load lean.  The Suspense fallback renders a spinner while
 * the chunk downloads.
 */
import { lazy, Suspense } from 'preact/compat';
import type { ExcalidrawScene } from '../presentation/slideModel';
import type { SlideRef } from '../presentation/slideModel';

// Lazy-load the inner canvas — Vite will put this in a separate async chunk
const ExcalidrawCanvas = lazy(
  () => import('./ExcalidrawCanvas'),
);

export interface ExcalidrawViewerProps {
  /** Slide to display */
  slide: SlideRef | null;
  /**
   * When true (default), renders in read-only view mode.
   * When false, renders in full edit mode and calls onChange on every scene change.
   */
  viewMode?: boolean;
  /**
   * Called (debounced ~800 ms) when the scene changes in edit mode.
   */
  onChange?: (scene: ExcalidrawScene) => void;
  /**
   * Presentation ID used to fetch and auto-load server-side libraries into the
   * Excalidraw panel via useHandleLibrary.
   */
  presentationId?: string;
  /** Class name applied to the outer wrapper div */
  className?: string;
}

/**
 * Excalidraw slide viewer / editor with automatic library loading.
 *
 * - In view mode (viewMode=true, default) the canvas is fully read-only.
 * - In edit mode (viewMode=false) it is an interactive Excalidraw editor;
 *   onChange is fired ~800 ms after the last canvas change.
 * - When presentationId is provided, libraries attached to the presentation
 *   are automatically fetched from the server and loaded into the Excalidraw
 *   library panel via useHandleLibrary + mergeLibraryItems.
 * - When slide.id changes, updateScene() + scrollToContent() are called on
 *   the Excalidraw imperative API so the canvas refreshes without remounting.
 */
export function ExcalidrawViewer(props: ExcalidrawViewerProps) {
  return (
    <Suspense
      fallback={
        <div
          class={`excalidraw-viewer excalidraw-viewer--loading ${props.className ?? ''}`}
          aria-busy="true"
          aria-label="Loading Excalidraw…"
        >
          <div class="spinner" />
        </div>
      }
    >
      <ExcalidrawCanvas {...props} />
    </Suspense>
  );
}
