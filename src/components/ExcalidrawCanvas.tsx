/**
 * ExcalidrawCanvas — inner component that statically imports @excalidraw/excalidraw.
 *
 * Key behaviours:
 *  - useHandleLibrary auto-loads per-presentation server libraries on mount and
 *    handles library install deep-links from excalidraw.com.
 *  - onLibraryChange saves the full library state back to the server via the
 *    PUT /libraries/user upsert endpoint so changes survive a page refresh.
 *  - onChange only fires when the *elements* change (not just appState), so
 *    auto-versioning is only triggered by real content edits.
 *  - CaptureUpdateAction.NEVER on slide transitions keeps undo history clean.
 *  - restoreElements (with repairBindings:true) is called before every updateScene
 *    so that arrow↔shape bindings and other normalized fields are fully resolved,
 *    matching what Excalidraw's initialData path does via restore().
 */
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import {
  Excalidraw,
  useHandleLibrary,
  mergeLibraryItems,
  CaptureUpdateAction,
  exportToBlob,
  restoreElements,
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
import { broadcastPointer, hidePointer } from '../presentation/laserPointer';

export interface ExcalidrawCanvasProps {
  slide: SlideRef | null;
  /** true = read-only view mode (default); false = interactive editor */
  viewMode?: boolean;
  /** Fired (debounced 800 ms) when elements actually change in edit mode */
  onChange?: (scene: ExcalidrawScene) => void;
  /** Called with a PNG data URL shortly after a scene change */
  onThumbnailChange?: (slideId: string, dataUrl: string) => void;
  /** Presentation ID used to fetch + auto-save server-side libraries */
  presentationId?: string;
  /** Additional CSS class applied to the wrapper div */
  className?: string;
  /** When set, temporarily display this scene (history hover preview) */
  previewScene?: ExcalidrawScene | null;
  /**
   * Increment this to force a scene refresh when the slide content changes
   * from an external source (e.g. a remote WebSocket diff) without slide.id changing.
   */
  remoteVersion?: number;
  /** When true, broadcast Excalidraw's built-in laser pointer to all viewers */
  enableCollabLaser?: boolean;
}

/** Compute a fast fingerprint of an elements array (id + version pairs). */
function fingerprintElements(elements: readonly { id: string; version?: number }[]): string {
  return elements.map((el) => `${el.id}:${el.version ?? 0}`).join('|');
}

/**
 * Normalise raw scene elements (from server / clipboard) and repair arrow↔shape
 * bindings before passing them to `updateScene`.  This mirrors what Excalidraw
 * does internally via `restore()` when using `initialData`.
 */
function normaliseElements(
  elements: { id: string; [key: string]: unknown }[],
): ReturnType<typeof restoreElements> {
  return restoreElements(
    elements as unknown as Parameters<typeof restoreElements>[0],
    null,
    { repairBindings: true },
  );
}

async function fetchPresentationLibraries(presentationId: string): Promise<LibraryItems> {
  try {
    const metas = await apiFetch<Array<{ _id: string; name: string }>>(
      `/api/presentations/${presentationId}/libraries`,
    );
    if (!metas?.length) return [];

    const responses = await Promise.all(
      metas.map((m) =>
        apiFetch<{ libraryData: Record<string, unknown> }>(
          `/api/presentations/${presentationId}/libraries/${m._id}`,
        ).catch(() => null),
      ),
    );

    let merged: LibraryItems = [];
    for (const resp of responses) {
      if (!resp?.libraryData) continue;
      const raw = resp.libraryData;
      const items = (raw['library'] ?? raw['libraryItems'] ?? []) as LibraryItems;
      if (items.length) merged = mergeLibraryItems(merged, items);
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
  onThumbnailChange,
  presentationId,
  className,
  previewScene,
  remoteVersion = 0,
  enableCollabLaser = false,
}: ExcalidrawCanvasProps) {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Track which slide is currently displayed to skip redundant updateScene calls
  const renderedSlideIdRef = useRef<string | null>(null);

  // Debounce timers
  const changeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track the last elements fingerprint so onChange only fires on real edits
  const lastElementsFpRef = useRef<string>('');

  // Track whether we're showing a preview (to restore on mouse-leave)
  const inPreviewRef = useRef(false);

  // Flag: suppress onChange during programmatic remote scene updates
  const isApplyingRemoteRef = useRef(false);

  useHandleLibrary({
    excalidrawAPI,
    getInitialLibraryItems: async (): Promise<LibraryItems> => {
      if (!presentationId) return [];
      return fetchPresentationLibraries(presentationId);
    },
  });

  // BroadcastChannel: listen for library updates from other tabs and reload
  useEffect(() => {
    if (!presentationId || !excalidrawAPI) return;
    const channel = new BroadcastChannel(`excalidraw-lib-${presentationId}`);
    channel.onmessage = async () => {
      const items = await fetchPresentationLibraries(presentationId);
      // Update the library in Excalidraw with the fresh items from server
      const api = apiRef.current;
      if (api && typeof (api as { updateLibrary?: unknown }).updateLibrary === 'function') {
        (api as { updateLibrary: (opts: { libraryItems: LibraryItems; merge: boolean }) => void })
          .updateLibrary({ libraryItems: items, merge: false });
      }
    };
    return () => channel.close();
  }, [excalidrawAPI, presentationId]);

  // ResizeObserver: re-fit content when the canvas container is resized
  useEffect(() => {
    const el = wrapperRef.current;
    if (!excalidrawAPI || !el) return;
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        apiRef.current?.scrollToContent(undefined, { fitToContent: true, animate: false });
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [excalidrawAPI]);

  const handleExcalidrawAPI = (api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
    setExcalidrawAPI(api);
  };

  /** Persist library changes back to the server so they survive refresh. */
  const handleLibraryChange = useCallback(
    async (items: LibraryItems) => {
      if (!presentationId || viewMode) return;
      const libraryData = { type: 'excalidrawlib', version: 2, library: items };
      try {
        await apiFetch(`/api/presentations/${presentationId}/libraries/user`, {
          method: 'PUT',
          body: JSON.stringify({ libraryData }),
        });
        // Notify other tabs to reload their library
        const channel = new BroadcastChannel(`excalidraw-lib-${presentationId}`);
        channel.postMessage({ type: 'library-updated' });
        channel.close();
      } catch {
        // non-critical — library is still in Excalidraw's local state
      }
    },
    [presentationId, viewMode],
  );

  /** Slide transition / preview effect */
  useEffect(() => {
    if (!excalidrawAPI) return;

    // If a preview scene is provided, show it temporarily
    if (previewScene !== undefined && previewScene !== null) {
      inPreviewRef.current = true;
      excalidrawAPI.updateScene({
        elements: normaliseElements(previewScene.elements ?? []),
        appState: {
          ...(previewScene.appState ?? {}),
          viewModeEnabled: true,
          zenModeEnabled: false,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      requestAnimationFrame(() => {
        apiRef.current?.scrollToContent(undefined, { fitToContent: true, animate: false });
      });
      return;
    }

    // Restore normal slide when preview ends
    if (inPreviewRef.current && previewScene === null) {
      inPreviewRef.current = false;
      // fall through to normal slide update below
    }

    if (!slide) return;

    const incomingElements = slide.sceneJSON?.elements ?? [];
    const incomingFp = fingerprintElements(incomingElements);

    if (renderedSlideIdRef.current === slide.id && !inPreviewRef.current) {
      // Same slide — check if elements changed from a remote diff
      if (incomingFp !== lastElementsFpRef.current) {
        // Remote change: update elements without triggering local onChange
        lastElementsFpRef.current = incomingFp;
        isApplyingRemoteRef.current = true;
        excalidrawAPI.updateScene({
          elements: normaliseElements(incomingElements),
          appState: { viewModeEnabled: viewMode, zenModeEnabled: false },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        requestAnimationFrame(() => {
          apiRef.current?.scrollToContent(undefined, { fitToContent: true, animate: false });
        });
        return;
      }
      excalidrawAPI.updateScene({
        appState: { viewModeEnabled: viewMode, zenModeEnabled: false },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      return;
    }
    renderedSlideIdRef.current = slide.id;
    // Seed the elements fingerprint to avoid a spurious onChange on first load
    lastElementsFpRef.current = incomingFp;
    isApplyingRemoteRef.current = true;

    excalidrawAPI.updateScene({
      elements: normaliseElements(incomingElements),
      appState: {
        ...(slide.sceneJSON?.appState ?? {}),
        viewModeEnabled: viewMode,
        zenModeEnabled: false,
        gridSize: null,
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });

    requestAnimationFrame(() => {
      apiRef.current?.scrollToContent(undefined, { fitToContent: true, animate: false });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excalidrawAPI, slide?.id, viewMode, previewScene, remoteVersion]);

  // Generate thumbnail after slide loads (even in view mode, for dashboard cards)
  useEffect(() => {
    if (!excalidrawAPI || !slide?.id || !onThumbnailChange) return;
    const slideId = slide.id;
    let cancelled = false;

    // Helper: try to generate a thumbnail. Retries up to `retries` times if
    // the scene is still empty (canvas hasn't finished rendering yet).
    const tryGenerate = async (retries: number): Promise<void> => {
      if (cancelled) return;
      const elements = excalidrawAPI.getSceneElements();
      if (!elements.length) {
        if (retries > 0) {
          await new Promise((r) => setTimeout(r, 400));
          return tryGenerate(retries - 1);
        }
        return; // give up — slide really is empty
      }
      const appState = excalidrawAPI.getAppState();
      const files = excalidrawAPI.getFiles();
      try {
        const blob = await exportToBlob({
          elements: [...elements],
          appState: { ...appState, exportBackground: true, exportWithDarkMode: false } as AppState,
          files,
          mimeType: 'image/jpeg',
          quality: 0.6,
          scale: 0.4,
        });
        if (cancelled) return;
        const reader = new FileReader();
        reader.onloadend = () => {
          if (!cancelled) onThumbnailChange(slideId, reader.result as string);
        };
        reader.readAsDataURL(blob);
      } catch { /* non-critical */ }
    };

    // Short initial delay so the scene has time to render
    const timer = setTimeout(() => void tryGenerate(3), 600);
    return () => { cancelled = true; clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [excalidrawAPI, slide?.id]);

  // Cleanup debounce timers on unmount
  useEffect(() => () => {
    if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
    if (thumbTimerRef.current) clearTimeout(thumbTimerRef.current);
  }, []);

  // Broadcast cursor/laser position via wrapper div mousemove (no scene-coordinate conversion).
  // When enableCollabLaser=true, always broadcasts visible=true while hovering; hides on leave.
  // When enableCollabLaser=false, broadcasts visible=true on every mousemove (for named cursors).
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      broadcastPointer(x, y);
    };
    const onLeave = () => hidePointer();

    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
      hidePointer();
    };
  }, [enableCollabLaser]);

  const handleChange = (
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (viewMode || !onChange) return;

    // If we're in the middle of applying a remote scene update, absorb onChange
    // to prevent re-broadcasting remote changes back to the server.
    if (isApplyingRemoteRef.current) {
      isApplyingRemoteRef.current = false;
      // Update the fingerprint to the actual post-update state from Excalidraw
      lastElementsFpRef.current = fingerprintElements(elements);
      return;
    }

    // Only fire onChange when elements actually changed
    const fp = fingerprintElements(elements);
    if (fp === lastElementsFpRef.current) return;
    lastElementsFpRef.current = fp;

    // Capture snapshot for thumbnail generation (before setTimeout closure)
    const elementsSnap = [...elements];
    const appStateSnap = appState;
    const filesSnap = files;

    if (changeTimerRef.current) clearTimeout(changeTimerRef.current);
    changeTimerRef.current = setTimeout(() => {
      const scene: ExcalidrawScene = {
        type: 'excalidraw',
        version: 2,
        elements: elementsSnap as ExcalidrawScene['elements'],
        appState: appStateSnap as ExcalidrawScene['appState'],
        files: filesSnap as ExcalidrawScene['files'],
      };
      onChange(scene);

      // Generate thumbnail asynchronously (debounced separately so it doesn't delay saves)
      if (onThumbnailChange && slide?.id) {
        const slideId = slide.id;
        if (thumbTimerRef.current) clearTimeout(thumbTimerRef.current);
        thumbTimerRef.current = setTimeout(async () => {
          try {
            const blob = await exportToBlob({
              elements: elementsSnap,
              appState: { ...appStateSnap, exportBackground: true, exportWithDarkMode: false } as AppState,
              files: filesSnap,
              mimeType: 'image/jpeg',
              quality: 0.6,
              scale: 0.4,
            });
            const reader = new FileReader();
            reader.onloadend = () => onThumbnailChange(slideId, reader.result as string);
            reader.readAsDataURL(blob);
          } catch { /* non-critical */ }
        }, 1200);
      }
    }, 50); // 50ms debounce — fires onChange which triggers RTC broadcast;
           // API saves are debounced separately at 800ms in PresentationEditor
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
      ref={wrapperRef}
      class={`excalidraw-viewer ${className ?? ''}`}
      style={{ width: '100%', height: '100%' }}
      aria-label={viewMode ? `Slide: ${slide.title}` : `Edit slide: ${slide.title}`}
    >
      <Excalidraw
        excalidrawAPI={handleExcalidrawAPI}
        initialData={{ elements, appState, scrollToContent: true }}
        viewModeEnabled={viewMode}
        zenModeEnabled={false}
        gridModeEnabled={false}
        isCollaborating={false}
        detectScroll={false}
        handleKeyboardGlobally={false}
        autoFocus={!viewMode}
        onChange={viewMode ? undefined : handleChange}
        onLibraryChange={viewMode ? undefined : handleLibraryChange}
        onPointerUpdate={enableCollabLaser ? (payload) => {
          // Only use onPointerUpdate to detect when the laser tool deactivates.
          // Actual coordinate broadcasting is done via the wrapper mousemove listener above.
          const { pointer } = payload as { pointer: { tool: string } };
          if (pointer.tool !== 'laser') {
            hidePointer();
          }
        } : undefined}
      />
    </div>
  );
}
