import { describe, it, expect } from 'vitest';
import {
  getSlidesFromFile,
  serializeSlide,
  deserializeSlide,
  gotoSlide,
  updateSlideScene,
  type ExcalidrawScene,
  type SlideRef,
} from '../src/presentation/slideModel';

const emptyScene: ExcalidrawScene = {
  type: 'excalidraw',
  version: 2,
  elements: [],
};

const singleSceneFile = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  elements: [
    { id: 'el1', type: 'rectangle', x: 10, y: 20, width: 100, height: 50 },
  ],
});

const multiFrameFile = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  elements: [
    { id: 'f1', type: 'frame', x: 0, y: 0, width: 800, height: 600, label: 'Introduction' },
    { id: 'el1', type: 'rectangle', x: 10, y: 10, width: 50, height: 50, frameId: 'f1' },
    { id: 'f2', type: 'frame', x: 0, y: 700, width: 800, height: 600, label: 'Conclusion' },
    { id: 'el2', type: 'text', x: 10, y: 710, width: 100, height: 30, frameId: 'f2' },
  ],
});

describe('getSlidesFromFile', () => {
  it('throws on invalid JSON', () => {
    expect(() => getSlidesFromFile('not-json')).toThrow('Invalid Excalidraw file');
  });

  it('throws on missing elements', () => {
    expect(() => getSlidesFromFile(JSON.stringify({ type: 'excalidraw', version: 2 }))).toThrow('missing elements array');
  });

  it('returns a single slide when no frames exist', () => {
    const slides = getSlidesFromFile(singleSceneFile);
    expect(slides).toHaveLength(1);
    expect(slides[0].index).toBe(0);
    expect(slides[0].title).toBe('Slide 1');
    expect(slides[0].sceneJSON.elements).toHaveLength(1);
  });

  it('returns one slide per frame, sorted by y position', () => {
    const slides = getSlidesFromFile(multiFrameFile);
    expect(slides).toHaveLength(2);
    expect(slides[0].title).toBe('Introduction');
    expect(slides[1].title).toBe('Conclusion');
  });

  it('assigns correct indices', () => {
    const slides = getSlidesFromFile(multiFrameFile);
    expect(slides[0].index).toBe(0);
    expect(slides[1].index).toBe(1);
  });

  it('uses fallback title when frame has no label', () => {
    const noLabelFile = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      elements: [
        { id: 'f1', type: 'frame', x: 0, y: 0, width: 800, height: 600 },
      ],
    });
    const slides = getSlidesFromFile(noLabelFile);
    expect(slides[0].title).toBe('Slide 1');
  });

  it('only includes elements belonging to each frame', () => {
    const slides = getSlidesFromFile(multiFrameFile);
    // Introduction frame: the frame element itself + el1
    const introIds = slides[0].sceneJSON.elements.map((e) => e.id);
    expect(introIds).toContain('f1');
    expect(introIds).toContain('el1');
    expect(introIds).not.toContain('f2');
    expect(introIds).not.toContain('el2');
  });
});

describe('serializeSlide / deserializeSlide', () => {
  const sample: SlideRef = {
    id: 'slide-0',
    index: 0,
    title: 'Test Slide',
    notes: 'Some notes',
    sceneJSON: emptyScene,
  };

  it('round-trips correctly', () => {
    const json = serializeSlide(sample);
    const restored = deserializeSlide(json);
    expect(restored.id).toBe(sample.id);
    expect(restored.index).toBe(sample.index);
    expect(restored.title).toBe(sample.title);
    expect(restored.notes).toBe(sample.notes);
    expect(restored.sceneJSON.type).toBe('excalidraw');
  });

  it('throws on invalid JSON', () => {
    expect(() => deserializeSlide('not-json')).toThrow();
  });

  it('throws when index is missing', () => {
    expect(() => deserializeSlide(JSON.stringify({ id: 'x', sceneJSON: emptyScene }))).toThrow('Invalid slide data');
  });
});

describe('gotoSlide', () => {
  const slides: SlideRef[] = [0, 1, 2].map((i) => ({
    id: `slide-${i}`,
    index: i,
    title: `Slide ${i + 1}`,
    notes: '',
    sceneJSON: emptyScene,
  }));

  it('returns the correct slide by index', () => {
    expect(gotoSlide(slides, 1).index).toBe(1);
  });

  it('wraps negative indices', () => {
    expect(gotoSlide(slides, -1).index).toBe(2);
  });

  it('wraps beyond last index', () => {
    expect(gotoSlide(slides, 3).index).toBe(0);
  });

  it('throws on empty array', () => {
    expect(() => gotoSlide([], 0)).toThrow('No slides available');
  });
});

describe('updateSlideScene', () => {
  it('returns a new object with updated sceneJSON', () => {
    const slide: SlideRef = {
      id: 'slide-0',
      index: 0,
      title: 'T',
      notes: '',
      sceneJSON: emptyScene,
    };
    const newScene: ExcalidrawScene = { ...emptyScene, version: 3 };
    const updated = updateSlideScene(slide, newScene);
    expect(updated.sceneJSON.version).toBe(3);
    expect(updated).not.toBe(slide); // immutable
  });
});
