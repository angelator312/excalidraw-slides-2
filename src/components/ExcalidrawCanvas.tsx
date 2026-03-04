/**
 * ExcalidrawCanvas — inner component that statically imports @excalidraw/excalidraw.
 *
 * This file is intentionally **not** imported directly from the main bundle.
 * It is lazily loaded by ExcalidrawViewer.tsx via preact/compat's `lazy()` so
 * that Vite code-splits the large Excalidraw package into a separate chunk.
 *
 * Patterns taken from the RichFreeExcalidraw reference:
 *  - useState for excalidrawAPI (so useHandleLibrary can react to it being set)
 *  - useHandleLibrary to auto-load per-presentation server libraries + handle
 *    library install URLs
 *  - mergeLibraryItems to combine multiple library sources without duplicates
 *  - CaptureUpdateAction.NEVER for slide transitions (keeps undo history clean)
 */
import { useState, useEffect, useRef } from 'preact/hooks';
import {
  Excalidraw,
  useHandleLibrary,
  mergeLibraryItems,
  CaptureUpdateAction,
} from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type {
  ExcalidrawImperativeAPI,
  LibraryItems,
  AppState,
  BinaryFiles,
} from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { SlideRef, ExcalidrawScene } from '../presentation/slideModel';
import { apiFetch } from '../lib/api';

export interface ExcalidrawCanvasProps {
  slide: SlideRef | null;
  /** true = read-only view mode (default); false = interactive editor */
  viewMode?: boolean;
  /** Fired (debounced 800 ms) in edit mode when the scene changes */
  onChange?: (scene: ExcalidrawScene) => void;
  /** Presentation ID used to fetch server-side libraries for this presentation */
  presentationId?: string;
  /** Additional CSS class applied to the wrapper div */
  className?: string;
}

/**
 * Fetches all library items for a presentation from the server and returns
 * them merged into a single LibraryItems array.
 */
async function fetchPresentationLibraries(presentationId: string): Promise<LibraryItems> {
  try {
    // Step 1: get list of library metadata (no heavy elements in the list)
    const metas = await apiFetch<Array<{ _id: string; name: string }>>(
      `/api/presentations/${presentationId}/libraries`,
    );
    if (!metas?.length) return [];

    // Step 2: fetch full library data for each entry in parallel
    const responses = await Promise.all(
      metas.map((m) =>
        apiFetch<{ libraryData: Record<string, unknown> }>(
          `/api/presentations/${presentationId}/libraries/${m._id}`,
        ).catch(() => null),
      ),
    );

    // Step 3: normalise both Excalidraw library formats and merge them
    // v2 format: { type: "excalidrawlib", version: 2, library: [...] }
    // v1 format: { libraryItems: [...] }
    let merged: LibraryItems = [];
    for (const resp of responses) {
      if (!resp?.libraryData) continue;
      const raw = resp.libraryData;
      const items = (raw['library'] ?? raw['libraryItems'] ?? []) as LibraryItems;
      if (items.length) {
        merged = mergeLibraryItems(merged, items);
      }
    }
    return merged;
  } catch {
    return [];
  }
}

// Default export — required for preact/compat lazy() to work.
export default function ExcalidrawCanvas({
  slide,
  viewMode = true,
  onChange,
  presentationId,
  className,
}: ExcalidrawCanvasProps) {
  /**
   * Store the API in STATE (not just a ref) so that:
   * 1. useHandleLibrary can react to it being set
   * 2. the slide-update effect re-runs the first time the API becomes available
   *
   * We additionally keep a ref for synchronous access inside callbacks.
   */
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);

  // Track which slide is currently displayed to skip redundant updateScene calls
  const renderedSlideIdRef = useRef<string | null>(null);

  // Debounce timer for the onChange prop
  const changeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * useHandleLibrary (from @excalidraw/excalidraw)
   *
   * Automatically:
   * - Calls getInitialLibraryItems() when excalidrawAPI first becomes available
   *   and loads the returned items into the Excalidraw library panel.
   * - Handles excalidraw.com library install deep-links so users can add items
   *   from the public library directly from the browser URL.
   */
  useHandleLibrary({
    excalidrawAPI,
    getInitialLibraryItems: async (): Promise<LibraryItems> => {
      if (!presentationId) return [];
      return fetchPresentationLibraries(presentationId);
    },
  });

  // Keep the ref in sync with the state so callbacks can use it synchronously
  const handleExcalidrawAPI = (api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
    setExcalidrawAPI(api);
  };

  /**
   * Slide transition effect
   *
   * Fires whenever:
   *  - excalidrawAPI first becomes available (after mount)
   *  - slide.id changes (user navigates to a different slide)
   *  - viewMode toggles (presenter ↔ editor)
   *
   * Uses CaptureUpdateAction.NEVER so slide transitions do NOT pollute the
   * undo/redo stack — undoing an edit should not jump back to the previous
   * slide's content.
   */
  useEffect(() => {
    if (!excalidrawAPI || !slide) return;
    if (renderedSlideIdRef.current === slide.id) {
      // Same slide but viewMode may have toggled — push an appState-only update
      excalidrawAPI.updateScene({
        appState: {
          viewModeEnabled: viewMode,
          zenModeEnabled: false,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      return;
    }
    renderedSlideIdRef.current = slide.id;

    excalidrawAPI.updateScene({
      elements: slide.sceneJSON?.elements ?? [],
      appState: {
        ...(slide.sceneJSON?.appState ?? {}),
        viewModeEnabled: viewMode,
        zenModeEnabled: false,
        gridSize: null,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });

    // After the DOM updates, fit the viewport to the slide's content
    requestAnimationFrame(() => {
      apiRef.current?.scrollToContent(undefined, { fitToContent: true, animate: false });
    });
  // excalidrawAPI is state, so the effect correctly re-runs when it gets set.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excalidrawAPI, slide?.id, viewMode]);

  // Clean up debounce timer on unmount
  useEffect(() => () => {
    if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
  }, []);

  const handleChange = (
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (viewMode || !onChange) return;
    if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
    changeTimerRef.current = setTimeout(() => {
      onChange({
        type: 'excalidraw',
        version: 2,
        elements: [...elements] as ExcalidrawScene['elements'],
        appState: appState as ExcalidrawScene['appState'],
        files: files as ExcalidrawScene['files'],
      });
    }, 800);
  };

  if (!slide) {
    return (
      <div
        class={`excalidraw-viewer excalidraw-viewer--loading ${className ?? ''}`}
        aria-busy="true"
        aria-label="Loading slide…"
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
      <Excalidraw
        excalidrawAPI={handleExcalidrawAPI}
        initialData={{
          elements,
          appState,
          scrollToContent: true,
        }}
        viewModeEnabled={viewMode}
        zenModeEnabled={false}
        gridModeEnabled={false}
        isCollaborating={false}
        detectScroll={false}
        handleKeyboardGlobally={false}
        autoFocus={!viewMode}
        onChange={viewMode ? undefined : handleChange}
      />
    </div>
  );
}
