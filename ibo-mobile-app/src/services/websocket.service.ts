/**
 * WebSocket Manager — mirrors the 3-second reconnect pattern used
 * across all WS components in the web exchange and futures context.
 */
import { WS_RECONNECT_DELAY_MS } from '../config/constants';

type MessageHandler = (data: unknown) => void;

interface WSChannel {
  url: string;
  ws: WebSocket | null;
  timer: ReturnType<typeof setTimeout> | null;
  closed: boolean;
  handlers: Set<MessageHandler>;
  /** Last parsed frame — replayed to new subscribers for instant UI (web sends snapshot on connect). */
  lastMessage?: unknown;
}

class WebSocketManager {
  private channels = new Map<string, WSChannel>();

  subscribe(key: string, url: string, handler: MessageHandler): () => void {
    let channel = this.channels.get(key);

    if (!channel) {
      channel = { url, ws: null, timer: null, closed: false, handlers: new Set() };
      this.channels.set(key, channel);
      this._connect(key, channel);
    }

    channel.handlers.add(handler);
    if (channel.lastMessage !== undefined) {
      try {
        handler(channel.lastMessage);
      } catch {
        /* ignore replay errors */
      }
    }

    // Return unsubscribe function
    return () => {
      channel!.handlers.delete(handler);
      if (channel!.handlers.size === 0) {
        this.disconnect(key);
      }
    };
  }

  private _connect(key: string, channel: WSChannel): void {
    if (channel.closed) return;

    try {
      const ws = new WebSocket(channel.url);

      ws.onopen = () => {
        // Connection established
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ws.onmessage = (event: any) => {
        try {
          const data = JSON.parse(event.data as string);
          if (data && typeof data === 'object' && (data as { type?: string }).type !== 'ping') {
            channel.lastMessage = data;
          }
          channel.handlers.forEach((h) => h(data));
        } catch {
          // Invalid JSON — ignore
        }
      };

      ws.onerror = () => {
        // Will trigger onclose
      };

      ws.onclose = () => {
        if (channel.closed) return;
        // Mirrors: setTimeout(connect, 3000) from web codebase
        channel.timer = setTimeout(() => this._connect(key, channel), WS_RECONNECT_DELAY_MS);
      };

      channel.ws = ws;
    } catch {
      if (!channel.closed) {
        channel.timer = setTimeout(() => this._connect(key, channel), WS_RECONNECT_DELAY_MS);
      }
    }
  }

  disconnect(key: string): void {
    const channel = this.channels.get(key);
    if (!channel) return;
    channel.closed = true;
    if (channel.timer) clearTimeout(channel.timer);
    channel.ws?.close();
    this.channels.delete(key);
  }

  disconnectAll(): void {
    this.channels.forEach((_, key) => this.disconnect(key));
  }

  /** Re-enable closed channels (call on app foreground resume). */
  resumeAll(): void {
    this.channels.forEach((channel) => {
      channel.closed = false;
    });
  }

  send(key: string, data: unknown): void {
    const channel = this.channels.get(key);
    if (channel?.ws?.readyState === WebSocket.OPEN) {
      channel.ws.send(JSON.stringify(data));
    }
  }
}

export const wsManager = new WebSocketManager();
export default wsManager;

/**
 * Simplified service interface for component-level use:
 * subscribe(url, handler) / unsubscribe(url)
 * Uses the URL itself as the channel key.
 */
export const wsService = {
  subscribe(url: string, handler: MessageHandler): void {
    wsManager.subscribe(url, url, handler);
  },
  unsubscribe(url: string): void {
    wsManager.disconnect(url);
  },
  send(url: string, data: unknown): void {
    wsManager.send(url, data);
  },
};
