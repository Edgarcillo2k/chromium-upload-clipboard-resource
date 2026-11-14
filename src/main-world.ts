/**
 * MAIN-world content script (runs in the page's own JS context at document_start).
 *
 * Catches every attempt to open a file picker:
 *   1. a click event reaching an <input type=file> (user clicks, <label>s,
 *      keyboard activation, synthetic dispatchEvent clicks), via a capture-phase
 *      listener on window that uses composedPath() so open shadow DOM works;
 *   2. programmatic HTMLElement.prototype.click() / HTMLInputElement.prototype.showPicker()
 *      on (often hidden or detached) inputs, via prototype patches.
 *
 * Instead of the native picker it asks the isolated content script to show the
 * popover. When the user pastes, the isolated script sends back File objects and
 * this script puts them into the input with a DataTransfer, exactly like a real
 * pick. "Browse files…" calls the saved, unpatched click().
 */
import { post, isOurs, type BypassKey, type Rect, type ToMain } from './shared/messages.ts';

declare global {
  interface Window {
    __pasteToUploadInstalled?: boolean;
  }
}

(() => {
  // Guard against double injection (e.g. about:blank frames that inherit scripts).
  if (window.__pasteToUploadInstalled) return;
  Object.defineProperty(window, '__pasteToUploadInstalled', { value: true });

  const origClick = HTMLElement.prototype.click;
  const origShowPicker = HTMLInputElement.prototype.showPicker;

  /** How long to wait for the isolated script to confirm it is showing the popover. */
  const ACK_TIMEOUT_MS = 500;
  /** A modifier/pointer recorded this recently counts for a programmatic click(). */
  const GESTURE_WINDOW_MS = 1500;

  let ready = false; // set once the isolated script has sent its config
  let enabled = true;
  let bypassKey: BypassKey = 'shift';
  let bypassing = false; // true while we deliberately open the native picker

  let nextId = 1;
  let pending: {
    id: number;
    input: HTMLInputElement;
    append: boolean;
    ackTimer: number;
  } | null = null;

  /** Last user gesture, used to position the popover and detect the bypass key. */
  let lastGesture = { time: 0, target: null as Element | null, shift: false, alt: false, ctrl: false };

  function isFileInput(el: unknown): el is HTMLInputElement {
    return (
      !!el &&
      typeof el === 'object' &&
      (el as Element).localName === 'input' &&
      (el as HTMLInputElement).type === 'file'
    );
  }

  function recordGesture(e: MouseEvent | KeyboardEvent): void {
    if (e instanceof KeyboardEvent && ['Shift', 'Alt', 'Control', 'Meta'].includes(e.key)) {
      // Holding the modifier itself: remember the state, keep the old target.
      lastGesture = { ...lastGesture, time: performance.now(), shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey };
      return;
    }
    const target = e.composedPath()[0];
    lastGesture = {
      time: performance.now(),
      target: target instanceof Element ? target : null,
      shift: e.shiftKey,
      alt: e.altKey,
      ctrl: e.ctrlKey || e.metaKey,
    };
  }

  function bypassHeld(e: MouseEvent | null): boolean {
    if (bypassKey === 'none') return false;
    let mods: { shift: boolean; alt: boolean; ctrl: boolean } | null = null;
    if (e) mods = { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey };
    else if (performance.now() - lastGesture.time < GESTURE_WINDOW_MS) mods = lastGesture;
    if (!mods) return false;
    return bypassKey === 'shift' ? mods.shift : bypassKey === 'alt' ? mods.alt : mods.ctrl;
  }

  function shouldIntercept(input: HTMLInputElement, e: MouseEvent | null): boolean {
    if (!ready || !enabled || bypassing) return false;
    if (input.disabled) return false;
    // Without user activation the browser would refuse to open a picker anyway;
    // don't pop up UI the user didn't ask for.
    if (navigator.userActivation && !navigator.userActivation.isActive) return false;
    if (bypassHeld(e)) return false;
    return true;
  }

  function visibleRect(el: Element | null): Rect | null {
    if (!el || !el.isConnected) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return null;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return null;
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  function openNative(input: HTMLInputElement, how: 'click' | 'showPicker' = 'click'): void {
    bypassing = true;
    try {
      if (how === 'showPicker' && origShowPicker) origShowPicker.call(input);
      else origClick.call(input);
    } finally {
      bypassing = false;
    }
  }

  function intercept(input: HTMLInputElement, how: 'click' | 'showPicker', directClick: boolean): void {
    if (pending) {
      clearTimeout(pending.ackTimer);
      post({ type: 'close', id: pending.id });
    }
    const id = nextId++;
    const ownRect = visibleRect(input);
    const recentTarget = performance.now() - lastGesture.time < 5000 ? lastGesture.target : null;
    const anchor = ownRect ?? visibleRect(recentTarget);
    const ackTimer = window.setTimeout(() => {
      // The isolated script never answered (extension reloaded/disabled?):
      // fall back to the normal picker while the user activation is still valid.
      if (pending?.id === id) {
        pending = null;
        openNative(input, how);
      }
    }, ACK_TIMEOUT_MS);
    pending = {
      id,
      input,
      // A plain, visible <input multiple> the user clicked keeps accumulating files.
      // Hidden dropzone inputs behave like a native pick (replace), otherwise
      // libraries that read input.files on every change would re-upload old files.
      append: directClick && !!ownRect && input.multiple,
      ackTimer,
    };
    post({
      type: 'open',
      id,
      accept: input.accept || '',
      multiple: input.multiple,
      existing: input.files?.length ?? 0,
      anchor,
    });
  }

  function insertFiles(input: HTMLInputElement, files: File[], append: boolean): number {
    const dt = new DataTransfer();
    if (append && input.files) for (const f of Array.from(input.files)) dt.items.add(f);
    for (const f of input.multiple ? files : files.slice(0, 1)) dt.items.add(f);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return dt.files.length;
  }

  // ---- Hook 1: click events reaching a file input --------------------------------
  window.addEventListener(
    'click',
    (e) => {
      if (bypassing) return;
      const target = e.composedPath()[0];
      if (!isFileInput(target)) {
        recordGesture(e);
        return;
      }
      if (!shouldIntercept(target, e)) return;
      e.preventDefault(); // stops the native picker; page handlers still run
      intercept(target, 'click', true);
    },
    true,
  );
  window.addEventListener('pointerdown', recordGesture, true);
  window.addEventListener('keydown', recordGesture, true);
  window.addEventListener('keyup', recordGesture, true);

  // ---- Hook 2: programmatic click() / showPicker() -------------------------------
  function patch<T extends object>(proto: T, key: keyof T & string, impl: (this: HTMLElement, ...args: unknown[]) => unknown) {
    const desc = Object.getOwnPropertyDescriptor(proto, key);
    if (!desc || typeof desc.value !== 'function') return;
    const original = desc.value as (...args: unknown[]) => unknown;
    // Keep the native-looking name/length; some sites sniff them.
    Object.defineProperty(impl, 'name', { value: original.name });
    Object.defineProperty(impl, 'length', { value: original.length });
    const nativeString = Function.prototype.toString.call(original);
    Object.defineProperty(impl, 'toString', { value: () => nativeString, configurable: true, writable: true });
    Object.defineProperty(proto, key, { ...desc, value: impl });
  }

  patch(HTMLElement.prototype, 'click', function (this: HTMLElement) {
    if (isFileInput(this) && !bypassing) {
      if (shouldIntercept(this, null)) {
        intercept(this, 'click', false);
        return undefined;
      }
      // Passing through: make sure the resulting click event isn't caught again.
      openNative(this as HTMLInputElement, 'click');
      return undefined;
    }
    return origClick.call(this);
  });

  if (origShowPicker) {
    patch(HTMLInputElement.prototype, 'showPicker', function (this: HTMLElement) {
      const input = this as HTMLInputElement;
      if (input.type === 'file' && !bypassing && shouldIntercept(input, null)) {
        intercept(input, 'showPicker', false);
        return undefined;
      }
      return origShowPicker.call(input);
    });
  }

  // ---- Messages from the isolated content script ---------------------------------
  window.addEventListener('message', (e) => {
    if (!isOurs<ToMain>(e)) return;
    const msg = e.data;
    switch (msg.type) {
      case 'config':
        ready = true;
        enabled = msg.enabled;
        bypassKey = msg.bypassKey;
        return;
      case 'ack':
        if (pending?.id === msg.id) clearTimeout(pending.ackTimer);
        return;
    }
    if (!pending || pending.id !== msg.id) return;
    const { input, append } = pending;
    clearTimeout(pending.ackTimer);
    pending = null;
    switch (msg.type) {
      case 'insert': {
        const count = insertFiles(input, msg.files, append);
        post({ type: 'inserted', id: msg.id, count });
        break;
      }
      case 'browse':
        openNative(input, 'click');
        break;
      case 'cancel':
        // Same event the browser fires when the user dismisses the real picker.
        input.dispatchEvent(new Event('cancel', { bubbles: true }));
        break;
    }
  });

  // Ask for the config in case the isolated script loaded first.
  post({ type: 'hello' });
})();
