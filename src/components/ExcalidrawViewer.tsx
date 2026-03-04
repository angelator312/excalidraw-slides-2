import { useEffect, useRef, useState } from 'preact/hooks';
import '@excalidraw/excalidraw/index.css';
import type { SlideRef, ExcalidrawScene } from '../presentation/slideModel';

// Lazy-load Excalidraw to keep initial bundle size small.
type ExcalidrawModule = typeof import('@excalidraw/excalidraw');
type ExcalidrawImperativeAPI = import('@excalidraw/excalidraw').ExcalidrawImperativeAPI;

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
  /**
   * When true (default), renders in read-only view mode.
   * When false, renders in full edit mode and calls onChange on every scene change.
   */
  viewMode?: boolean;
  /**
   * Called (debounced) when the scene changes in edit mode.
   */
  onChange?: (scene: ExcalidrawScene) => void;
  /** Class name applied to the outer wrapper div */
  className?: string;
}

/**
 * Excalidraw slide viewer / editor.
 *
 * - In view mode (viewMode=true, default) it is fully read-only.
 * - In edit mode (viewMode=false) it is an interactive editor; onChange is fired
 *   ~800 ms after the last change to avoid flooding the server.
 * - When the `slide` prop changes the component uses the Excalidraw imperative
 *   API to call updateScene() + scrollToContent() so the canvas refreshes without
 *   unmounting/remounting (which would be slow).
 */
export function ExcalidrawViewer({
  slide,
  libraryItems = [],
  viewMode = true,
  onChange,
  className,
}: ExcalidrawViewerProps) {
  const [ExcalidrawComponent, setExcalidrawComponent] = useState<ExcalidrawModule['Excalidraw'] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Imperative API — set via the excalidrawAPI callback prop
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  // Debounce timer for onChange
  const changeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the slide id that is currently rendered so we only updateScene on an actual slide switch
  const renderedSlideIdRef = useRef<string | null>(null);

  // Load Excalidraw once on mount
  useEffect(() => {
    let cancelled = false;
    import('@excalidraw/excalidraw')
      .then((mod) => { if (!cancelled) setExcalidrawComponent(() => mod.Excalidraw); })
      .catch((err) => { if (!cancelled) setLoadError(String(err)); });
    return () => { cancelled = true; };
  }, []);

  // When slide changes AND Excalidraw is already mounted, update the scene via
  // the imperative API instead of remounting the whole component.
  useEffect(() => {
    if (!apiRef.current || !slide) return;
    // Only push an update if the slide actually changed
    if (renderedSlideIdRef.current === slide.id) return;
    renderedSlideIdRef.current = slide.id;

    apiRef.current.updateScene({
      elements: slide.sceneJSON?.elements ?? [],
      appState: {
        ...(slide.sceneJSON?.appState ?? {}),
        viewModeEnabled: viewMode,
        zenModeEnabled: false,
        gridSize: null,
      },
    });
    // Let Excalidraw lay out first then fit the view to content
    requestAnimationFrame(() => {
      apiRef.current?.scrollToContent(undefined, { fitToContent: true, animate: false });
    });
    // apiRef is a ref (mutable object), not state — it does not need to be in the
    // dependency array. Only slide.id and viewMode should trigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide?.id, viewMode]);

  // Cleanup debounce on unmount
  useEffect(() => () => {
    if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
  }, []);

  const handleExcalidrawAPI = (api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
    if (slide) renderedSlideIdRef.current = slide.id;
  };

  const handleChange = (
    elements: readonly unknown[],
    appState: Record<string, unknown>,
    files: unknown,
  ) => {
    if (viewMode || !onChange) return;
    if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
    changeTimerRef.current = setTimeout(() => {
      onChange({
        type: 'excalidraw',
        version: 2,
        elements: elements as ExcalidrawScene['elements'],
        appState: appState as ExcalidrawScene['appState'],
        files: files as ExcalidrawScene['files'],
      });
    }, 800);
  };

  if (loadError) {
    return (
      <div class={`excalidraw-viewer excalidraw-viewer--error ${className ?? ''}`} role="alert">
        <p>Failed to load Excalidraw: {loadError}</p>
      </div>
    );
  }

  if (!ExcalidrawComponent || !slide) {
    return (
      <div
        class={`excalidraw-viewer excalidraw-viewer--loading ${className ?? ''}`}
        aria-busy="true"
        aria-label="Loading viewer…"
      >
        <div class="spinner" />
      </div>
    );
  }

  const elements = slide.sceneJSON?.elements ?? [];
  const appState = {
    ...(slide.sceneJSON?.appState ?? {}),
    viewModeEnabled: viewMode,
    zenModeEnabled: false,
    gridSize: null,
  };

  return (
    <div
      class={`excalidraw-viewer ${className ?? ''}`}
      style={{ width: '100%', height: '100%' }}
      aria-label={viewMode ? `Slide: ${slide.title}` : `Edit slide: ${slide.title}`}
    >
      <ExcalidrawComponent
        excalidrawAPI={handleExcalidrawAPI}
        initialData={{
          elements,
          appState,
          libraryItems,
          scrollToContent: true,
        }}
        viewModeEnabled={viewMode}
        zenModeEnabled={false}
        gridModeEnabled={false}
        isCollaborating={false}
        detectScroll={false}
        handleKeyboardGlobally={false}
        autoFocus={!viewMode}
        onChange={viewMode ? undefined : (handleChange as Parameters<typeof ExcalidrawComponent>[0]['onChange'])}
      />
    </div>
  );
}
