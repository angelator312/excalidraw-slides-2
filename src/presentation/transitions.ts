/** CSS transition presets for slide changes */
export type TransitionType = 'none' | 'fade' | 'slide-left' | 'slide-right' | 'zoom' | 'flip';

export interface TransitionConfig {
  type: TransitionType;
  durationMs: number;
}

export const DEFAULT_TRANSITION: TransitionConfig = {
  type: 'fade',
  durationMs: 300,
};

const TRANSITION_CLASSES: Record<TransitionType, { enter: string; exit: string }> = {
  none: { enter: '', exit: '' },
  fade: { enter: 'transition-fade-enter', exit: 'transition-fade-exit' },
  'slide-left': { enter: 'transition-slide-left-enter', exit: 'transition-slide-left-exit' },
  'slide-right': { enter: 'transition-slide-right-enter', exit: 'transition-slide-right-exit' },
  zoom: { enter: 'transition-zoom-enter', exit: 'transition-zoom-exit' },
  flip: { enter: 'transition-flip-enter', exit: 'transition-flip-exit' },
};

/**
 * Apply a CSS transition to a container element when switching slides.
 * Returns a promise that resolves when the transition completes.
 */
export async function applyTransition(
  container: HTMLElement,
  config: TransitionConfig = DEFAULT_TRANSITION,
  direction: 'forward' | 'backward' = 'forward',
): Promise<void> {
  if (config.type === 'none') return;

  const resolvedType =
    direction === 'backward' && config.type === 'slide-left'
      ? 'slide-right'
      : direction === 'backward' && config.type === 'slide-right'
      ? 'slide-left'
      : config.type;

  const classes = TRANSITION_CLASSES[resolvedType];
  if (!classes.exit) return;

  // Exit phase
  container.classList.add(classes.exit);
  await delay(config.durationMs / 2);
  container.classList.remove(classes.exit);

  // Enter phase
  container.classList.add(classes.enter);
  await delay(config.durationMs / 2);
  container.classList.remove(classes.enter);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
