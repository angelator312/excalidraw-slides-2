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
  slide: SlideRef | null;
  viewMode?: boolean;
  onChange?: (scene: ExcalidrawScene) => void;
  /** Called with a PNG data URL shortly after a scene change */
  onThumbnailChange?: (slideId: string, dataUrl: string) => void;
  presentationId?: string;
  className?: string;
  /** When set, temporarily display this scene (history hover preview) */
  previewScene?: ExcalidrawScene | null;
  /**
   * Increment to force scene refresh when slide content changes from an external
   * source (remote WebSocket diff) without slide.id changing.
   */
  remoteVersion?: number;
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
