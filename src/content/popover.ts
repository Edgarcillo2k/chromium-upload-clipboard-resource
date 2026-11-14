/** The "Paste from clipboard / Browse files…" popover, rendered in a closed shadow root. */
import css from './popover.css?inline';
import type { Rect } from '../shared/messages.ts';

const ICON_CLIPBOARD = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>`;
const ICON_FOLDER = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
const ICON_CLOSE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

export type Tone = 'info' | 'warn' | 'error';

export interface PopoverHandlers {
  onPasteClick(): void;
  onBrowse(): void;
  onCancel(): void;
}

export interface OpenOptions {
  anchor: Rect | null;
  acceptLabel: string;
  multiple: boolean;
  bypassHint: string;
}

const MARGIN = 8;
const GAP = 6;

export class Popover {
  readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly pasteBtn: HTMLButtonElement;
  private readonly browseBtn: HTMLButtonElement;
  private readonly thumb: HTMLElement;
  private readonly pasteSub: HTMLElement;
  private readonly status: HTMLElement;
  private readonly foot: HTMLElement;
  private previewUrl: string | null = null;
  private previousFocus: Element | null = null;
  isOpen = false;

  constructor(private readonly handlers: PopoverHandlers) {
    this.host = document.createElement('paste-to-upload-popover');
    this.root = this.host.attachShadow({ mode: 'closed' });
    this.root.innerHTML = `
      <style>${css}</style>
      <div class="card" role="dialog" aria-label="Upload a file">
        <div class="head">
          <span class="title">Upload file</span>
          <button class="close" type="button" title="Cancel (Esc)" aria-label="Cancel">${ICON_CLOSE}</button>
        </div>
        <button class="option primary paste" type="button">
          <span class="thumb">${ICON_CLIPBOARD}</span>
          <span class="label"><strong>Paste from clipboard</strong><span class="sub">Press <kbd>Ctrl</kbd>+<kbd>V</kbd> or click</span></span>
        </button>
        <button class="option browse" type="button">
          <span class="thumb">${ICON_FOLDER}</span>
          <span class="label"><strong>Browse files…</strong><span>Open the normal file picker</span></span>
        </button>
        <div class="status" role="status" aria-live="polite" hidden></div>
        <div class="foot"></div>
      </div>`;
    const $ = <T extends Element>(sel: string) => this.root.querySelector<T>(sel)!;
    this.pasteBtn = $('.paste');
    this.browseBtn = $('.browse');
    this.thumb = $('.paste .thumb');
    this.pasteSub = $('.paste .sub');
    this.status = $('.status');
    this.foot = $('.foot');

    this.pasteBtn.addEventListener('click', () => this.handlers.onPasteClick());
    this.browseBtn.addEventListener('click', () => this.handlers.onBrowse());
    $<HTMLButtonElement>('.close').addEventListener('click', () => this.handlers.onCancel());
    // Arrow keys move between the two options.
    this.root.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'ArrowDown' || ke.key === 'ArrowUp') {
        ke.preventDefault();
        (this.root.activeElement === this.pasteBtn ? this.browseBtn : this.pasteBtn).focus();
      }
    });
  }

  /** True if the event happened inside the popover. */
  contains(e: Event): boolean {
    return e.composedPath().includes(this.host);
  }

  open(opts: OpenOptions): void {
    this.previousFocus = document.activeElement;
    this.setStatus(null);
    this.setPreview(null);
    this.setBusy(false);
    const hints = [opts.acceptLabel && `Accepts ${opts.acceptLabel}`, opts.multiple && 'multiple files', opts.bypassHint]
      .filter(Boolean)
      .join(' · ');
    this.foot.textContent = hints;
    this.foot.hidden = !hints;

    // Attach to <html>, not <body>: SPAs sometimes replace <body>.
    if (!this.host.isConnected) document.documentElement.appendChild(this.host);
    // Top layer, so we sit above modal <dialog>s and other popovers.
    this.host.setAttribute('popover', 'manual');
    try {
      if (this.host.matches(':popover-open')) this.host.hidePopover();
      this.host.showPopover();
    } catch {
      /* Popover API unavailable: z-index fallback in CSS. */
    }
    this.isOpen = true;
    this.position(opts.anchor);
    this.pasteBtn.focus({ preventScroll: true });
  }

  close(restoreFocus = true): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    try {
      this.host.hidePopover();
    } catch {
      /* ignore */
    }
    this.host.remove();
    this.setPreview(null);
    if (restoreFocus && this.previousFocus instanceof HTMLElement && this.previousFocus.isConnected) {
      this.previousFocus.focus({ preventScroll: true });
    }
    this.previousFocus = null;
  }

  private position(anchor: Rect | null): void {
    const box = this.host.getBoundingClientRect();
    const w = box.width || 300;
    const h = box.height || 160;
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = document.documentElement.clientHeight || innerHeight;
    let left: number;
    let top: number;
    if (anchor) {
      left = anchor.x;
      top = anchor.y + anchor.height + GAP;
      if (top + h > vh - MARGIN) {
        const above = anchor.y - GAP - h;
        top = above >= MARGIN ? above : Math.max(MARGIN, vh - MARGIN - h);
      }
    } else {
      left = (vw - w) / 2;
      top = (vh - h) / 3;
    }
    left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, vw - w - MARGIN));
    top = Math.max(MARGIN, top);
    this.host.style.setProperty('left', `${Math.round(left)}px`, 'important');
    this.host.style.setProperty('top', `${Math.round(top)}px`, 'important');
  }

  setPreview(file: File | null): void {
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = null;
    this.thumb.classList.remove('has-image');
    if (!file) {
      this.thumb.innerHTML = ICON_CLIPBOARD;
      this.pasteSub.innerHTML = 'Press <kbd>Ctrl</kbd>+<kbd>V</kbd> or click';
      return;
    }
    if (file.type.startsWith('image/')) {
      this.previewUrl = URL.createObjectURL(file);
      const img = document.createElement('img');
      img.alt = '';
      img.src = this.previewUrl;
      this.thumb.replaceChildren(img);
      this.thumb.classList.add('has-image');
    }
    this.pasteSub.textContent = `${file.name} · ${formatSize(file.size)}`;
  }

  setBusy(busy: boolean): void {
    this.pasteBtn.setAttribute('aria-busy', String(busy));
  }

  setStatus(message: string | null, tone: Tone = 'info', action?: { label: string; run: () => void }): void {
    if (!message) {
      this.status.hidden = true;
      this.status.replaceChildren();
      return;
    }
    this.status.hidden = false;
    this.status.className = `status ${tone}`;
    this.status.textContent = message;
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = action.label;
      btn.addEventListener('click', action.run);
      this.status.append(btn);
    }
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
