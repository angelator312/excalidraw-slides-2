import { rtcClient } from './rtc';

export interface LaserPointerState {
  active: boolean;
  x: number;
  y: number;
  userId: string;
  displayName: string;
  color: string;
}

/** Broadcast laser pointer position to all viewers */
export function broadcastPointer(x: number, y: number): void {
  rtcClient.sendPointerMove(x, y, true);
}

/** Hide the laser pointer for all viewers */
export function hidePointer(): void {
  rtcClient.sendPointerMove(0, 0, false);
}

/**
 * Attach mouse/touch listeners to a container element and broadcast pointer events.
 * Returns a cleanup function.
 */
export function attachPointerListeners(
  container: HTMLElement,
  onMove?: (x: number, y: number) => void,
): () => void {
  let active = false;

  const onMouseMove = (e: MouseEvent): void => {
    if (!active) return;
    const rect = container.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    broadcastPointer(x, y);
    onMove?.(x, y);
  };

  const onTouchMove = (e: TouchEvent): void => {
    if (!active) return;
    const touch = e.touches[0];
    if (!touch) return;
    const rect = container.getBoundingClientRect();
    const x = (touch.clientX - rect.left) / rect.width;
    const y = (touch.clientY - rect.top) / rect.height;
    broadcastPointer(x, y);
    onMove?.(x, y);
  };

  const onMouseDown = (): void => { active = true; };
  const onMouseUp = (): void => {
    active = false;
    hidePointer();
  };

  container.addEventListener('mousemove', onMouseMove);
  container.addEventListener('touchmove', onTouchMove);
  container.addEventListener('mousedown', onMouseDown);
  container.addEventListener('mouseup', onMouseUp);
  container.addEventListener('mouseleave', onMouseUp);

  return () => {
    container.removeEventListener('mousemove', onMouseMove);
    container.removeEventListener('touchmove', onTouchMove);
    container.removeEventListener('mousedown', onMouseDown);
    container.removeEventListener('mouseup', onMouseUp);
    container.removeEventListener('mouseleave', onMouseUp);
    hidePointer();
  };
}
