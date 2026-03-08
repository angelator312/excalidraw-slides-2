/** Represents one Excalidraw scene stored as a slide */
export interface Slide {
  id: string;
  presentationId: string;
  index: number;
  sceneJSON: ExcalidrawScene;
  notes: string;
  updatedAt: string;
}

/** Minimal shape of an Excalidraw scene used by this plugin */
export interface ExcalidrawScene {
  type: 'excalidraw';
  version: number;
  source?: string;
  elements: ExcalidrawElement[];
  appState?: Record<string, unknown>;
  files?: Record<string, unknown>;
}

export interface ExcalidrawElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  [key: string]: unknown;
}

/** A lightweight in-memory slide representation for the client */
export interface SlideRef {
  id: string;
  index: number;
  title: string;
  notes: string;
  sceneJSON: ExcalidrawScene;
  thumbnailUrl?: string;
}

/**
 * Parse a raw Excalidraw JSON file (possibly a multi-scene export) into slides.
 * Convention: each scene is separated by a "frame" element whose label becomes the slide title.
 * If no frames exist, the entire scene becomes a single slide.
 */
export function getSlidesFromFile(fileContent: string): SlideRef[] {
  let parsed: ExcalidrawScene;
  try {
    parsed = JSON.parse(fileContent) as ExcalidrawScene;
  } catch {
    throw new Error('Invalid Excalidraw file: could not parse JSON');
  }

  if (!parsed || !Array.isArray(parsed.elements)) {
    throw new Error('Invalid Excalidraw file: missing elements array');
  }

  const frames = parsed.elements.filter((el) => el.type === 'frame');

  if (frames.length === 0) {
    // Single slide
    return [
      {
        id: `slide-0`,
        index: 0,
        title: 'Slide 1',
        notes: '',
        sceneJSON: parsed,
      },
    ];
  }

  // Sort frames by vertical position (top to bottom)
  const sorted = [...frames].sort((a, b) => a.y - b.y);

  return sorted.map((frame, i) => {
    const frameId = String(frame.id);
    // Elements that belong to this frame
    const frameElements = parsed.elements.filter(
      (el) => el.id === frameId || (el as { frameId?: string }).frameId === frameId,
    );

    const slideScene: ExcalidrawScene = {
      type: 'excalidraw',
      version: parsed.version,
      elements: frameElements,
      appState: parsed.appState,
      files: parsed.files,
    };

    const label = typeof frame.label === 'string' ? frame.label : '';
    const title = label.trim() || `Slide ${i + 1}`;

    return {
      id: `slide-${i}`,
      index: i,
      title,
      notes: '',
      sceneJSON: slideScene,
    };
  });
}

/**
 * Serialize a SlideRef to a JSON string ready for persistence.
 */
export function serializeSlide(slide: SlideRef): string {
  return JSON.stringify({
    id: slide.id,
    index: slide.index,
    title: slide.title,
    notes: slide.notes,
    sceneJSON: slide.sceneJSON,
  });
}

/**
 * Deserialize a JSON string (from server) back to a SlideRef.
 */
export function deserializeSlide(json: string): SlideRef {
  const raw = JSON.parse(json) as SlideRef;
  if (typeof raw.index !== 'number' || !raw.sceneJSON) {
    throw new Error('Invalid slide data');
  }
  return raw;
}

/**
 * Return the slide at `index`, wrapping around if out of bounds.
 */
export function gotoSlide(slides: SlideRef[], index: number): SlideRef {
  if (slides.length === 0) throw new Error('No slides available');
  const clamped = ((index % slides.length) + slides.length) % slides.length;
  return slides[clamped];
}

/**
 * Merge an updated scene into an existing SlideRef immutably.
 */
export function updateSlideScene(slide: SlideRef, sceneJSON: ExcalidrawScene): SlideRef {
  return { ...slide, sceneJSON };
}
