import { io, Socket } from 'socket.io-client';

export interface CursorPosition {
  x: number;
  y: number;
}

export interface Presence {
  userId: string;
  displayName: string;
  color: string;
  cursor?: CursorPosition;
  slideIndex: number;
  pointerVisible: boolean;
  pointerX?: number;
  pointerY?: number;
}

export interface DiffPayload {
  slideId: string;
  sceneJSON: unknown;
  userId: string;
}

export type RTCEventMap = {
  presence: (users: Presence[]) => void;
  diff: (payload: DiffPayload) => void;
  slideChange: (index: number) => void;
  pointerMove: (data: { userId: string; x: number; y: number; visible: boolean }) => void;
  connected: () => void;
  disconnected: () => void;
  error: (msg: string) => void;
};

type Listeners = {
  [K in keyof RTCEventMap]?: RTCEventMap[K][];
};

export class RTCClient {
  private socket: Socket | null = null;
  private presentationId: string | null = null;
  private listeners: Listeners = {};

  connect(serverUrl: string, presentationId: string, token: string): void {
    if (this.socket?.connected) {
      this.socket.disconnect();
    }

    this.presentationId = presentationId;

    this.socket = io(serverUrl, {
      auth: { token },
      transports: ['websocket'],
    });

    this.socket.on('connect', () => {
      this.socket!.emit('joinRoom', { presentationId, token });
      this.emit('connected');
    });

    this.socket.on('disconnect', () => {
      this.emit('disconnected');
    });

    this.socket.on('presence', (users: Presence[]) => {
      this.emit('presence', users);
    });

    this.socket.on('diff', (payload: DiffPayload) => {
      this.emit('diff', payload);
    });

    this.socket.on('slideChange', ({ index }: { index: number }) => {
      this.emit('slideChange', index);
    });

    this.socket.on('pointerMove', (data: { userId: string; x: number; y: number; visible: boolean }) => {
      this.emit('pointerMove', data);
    });

    this.socket.on('error', (msg: string) => {
      this.emit('error', msg);
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.presentationId = null;
  }

  sendDiff(slideId: string, sceneJSON: unknown): void {
    if (!this.socket?.connected) return;
    this.socket.emit('diff', { slideId, sceneJSON, presentationId: this.presentationId });
  }

  sendSlideChange(index: number): void {
    if (!this.socket?.connected) return;
    this.socket.emit('slideChange', { presentationId: this.presentationId, index });
  }

  sendPresence(presence: Omit<Presence, 'userId'>): void {
    if (!this.socket?.connected) return;
    this.socket.emit('presence', { ...presence, presentationId: this.presentationId });
  }

  sendPointerMove(x: number, y: number, visible: boolean): void {
    if (!this.socket?.connected) return;
    this.socket.emit('pointerMove', { presentationId: this.presentationId, x, y, visible });
  }

  on<K extends keyof RTCEventMap>(event: K, cb: RTCEventMap[K]): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = [] as RTCEventMap[K][];
    }
    (this.listeners[event] as RTCEventMap[K][]).push(cb);
    return () => this.off(event, cb);
  }

  off<K extends keyof RTCEventMap>(event: K, cb: RTCEventMap[K]): void {
    const list = this.listeners[event] as RTCEventMap[K][] | undefined;
    if (!list) return;
    const idx = list.indexOf(cb);
    if (idx !== -1) list.splice(idx, 1);
  }

  private emit<K extends keyof RTCEventMap>(event: K, ...args: Parameters<RTCEventMap[K]>): void {
    const list = this.listeners[event] as ((...a: Parameters<RTCEventMap[K]>) => void)[] | undefined;
    if (!list) return;
    list.forEach((cb) => cb(...args));
  }

  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
}

export const rtcClient = new RTCClient();
