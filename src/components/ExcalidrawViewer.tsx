import { useEffect, useRef, useState } from 'preact/hooks';
import '@excalidraw/excalidraw/index.css';
import type { SlideRef } from '../presentation/slideModel';

// Lazy-load Excalidraw to keep initial bundle size small.
// We use a dynamic import so it's code-split away from the main bundle.
type ExcalidrawModule = typeof import('@excalidraw/excalidraw');

interface LibraryItem {
  id: string;
  status: 'published' | 'unpublished';
  elements: unknown[];
}

export interface ExcalidrawViewerProps {
  /** Slide to display */
  slide: SlideRef | null;
  /** Optional library items to load into the viewer */
  libraryItems?: LibraryItem[];
  /** Class name to apply to the container */
  className?: string;
}

/**
 * Read-only Excalidraw viewer.
 *
 * Renders an Excalidraw scene (elements + appState) in view mode.
 * The component lazy-loads @excalidraw/excalidraw so it doesn't bloat
 * the initial bundle.
 */
export function ExcalidrawViewer({ slide, libraryItems = [], className }: ExcalidrawViewerProps) {
  const [ExcalidrawComponent, setExcalidrawComponent] = useState<ExcalidrawModule['Excalidraw'] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load Excalidraw once on mount
  useEffect(() => {
    let cancelled = false;

    import('@excalidraw/excalidraw')
      .then((mod) => {
        if (!cancelled) setExcalidrawComponent(() => mod.Excalidraw);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(String(err));
      });

    return () => { cancelled = true; };
  }, []);

  if (loadError) {
    return (
      <div class={`excalidraw-viewer excalidraw-viewer--error ${className ?? ''}`} role="alert">
        <p>Failed to load Excalidraw viewer: {loadError}</p>
      </div>
    );
  }

  if (!ExcalidrawComponent || !slide) {
    return (
      <div class={`excalidraw-viewer excalidraw-viewer--loading ${className ?? ''}`} aria-busy="true" aria-label="Loading viewer…">
        <div class="spinner" />
      </div>
    );
  }

  const elements = slide.sceneJSON?.elements ?? [];
  const appState = {
    ...(slide.sceneJSON?.appState ?? {}),
    // Force read-only / view mode
    viewModeEnabled: true,
    zenModeEnabled: false,
    gridSize: null,
  };

  return (
    <div
      ref={containerRef}
      class={`excalidraw-viewer ${className ?? ''}`}
      style={{ width: '100%', height: '100%', minHeight: '400px' }}
      aria-label={`Excalidraw viewer — ${slide.title}`}
    >
      <ExcalidrawComponent
        initialData={{
          elements,
          appState,
          libraryItems,
          scrollToContent: true,
        }}
        viewModeEnabled
        zenModeEnabled={false}
        gridModeEnabled={false}
        isCollaborating={false}
        detectScroll={false}
        handleKeyboardGlobally={false}
        autoFocus={false}
      />
    </div>
  );
}
