/**
 * Protocol between the MAIN-world script (owns the page's <input type=file>)
 * and the isolated content script (owns the popover and chrome.* APIs).
 *
 * Both live in the same window, so they talk with window.postMessage. That
 * keeps it simple and lets File objects be structured-cloned across worlds.
 * The page can see (and forge) these messages, which is acceptable: the page
 * already fully controls its own file inputs.
 */
export const CHANNEL = '__paste-to-upload__';

export type BypassKey = 'shift' | 'alt' | 'ctrl' | 'none';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Isolated -> MAIN */
export type ToMain =
  | { channel: typeof CHANNEL; type: 'config'; enabled: boolean; bypassKey: BypassKey }
  | { channel: typeof CHANNEL; type: 'ack'; id: number }
  | { channel: typeof CHANNEL; type: 'insert'; id: number; files: File[] }
  | { channel: typeof CHANNEL; type: 'browse'; id: number }
  | { channel: typeof CHANNEL; type: 'cancel'; id: number };

/** MAIN -> isolated */
export type ToIsolated =
  | { channel: typeof CHANNEL; type: 'hello' }
  | {
      channel: typeof CHANNEL;
      type: 'open';
      id: number;
      accept: string;
      multiple: boolean;
      existing: number;
      anchor: Rect | null;
    }
  | { channel: typeof CHANNEL; type: 'inserted'; id: number; count: number }
  | { channel: typeof CHANNEL; type: 'close'; id: number };

type Distribute<T> = T extends unknown ? Omit<T, 'channel'> : never;

export function post(msg: Distribute<ToMain> | Distribute<ToIsolated>): void {
  window.postMessage({ channel: CHANNEL, ...msg }, '*');
}

export function isOurs<T extends { channel: string }>(e: MessageEvent): e is MessageEvent<T> {
  return e.source === window && typeof e.data === 'object' && e.data !== null && e.data.channel === CHANNEL;
}
