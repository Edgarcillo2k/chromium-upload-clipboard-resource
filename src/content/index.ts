/**
 * Isolated-world content script: settings, the popover, reading the clipboard.
 * The MAIN-world script (src/main-world.ts) owns the page's file input.
 */
import { post, isOurs, type ToIsolated, type BypassKey } from '../shared/messages.ts';
import { loadSettings, isEnabledFor, DEFAULT_SETTINGS, type Settings } from '../shared/settings.ts';
import { Popover } from './popover.ts';
import { fromDataTransfer, fromAsyncClipboard, canReadSilently, type ClipboardResult } from './clipboard.ts';
import { parseAccept, fileMatches, describeAccept, convertImageIfNeeded } from './accept.ts';

type Request = Extract<ToIsolated, { type: 'open' }>;

let settings: Settings = DEFAULT_SETTINGS;
let enabledHere = true;
let loaded = false;
let current: Request | null = null;
/** Bumped on every open/close so stale async clipboard reads are ignored. */
let generation = 0;

const BYPASS_LABEL: Record<BypassKey, string> = {
  shift: 'Shift+click skips this',
  alt: 'Alt+click skips this',
  ctrl: 'Ctrl+click skips this',
  none: '',
};

function relevantHosts(): string[] {
  const hosts = [location.hostname];
  // Embedded upload widgets: the embedding site's list applies too.
  for (const origin of Array.from(location.ancestorOrigins ?? [])) {
    try {
      hosts.push(new URL(origin).hostname);
    } catch {
      /* opaque origin */
    }
  }
  return hosts.filter(Boolean);
}

function sendConfig(): void {
  if (!loaded) return;
  post({ type: 'config', enabled: enabledHere, bypassKey: settings.bypassKey });
}

async function refreshSettings(): Promise<void> {
  try {
    settings = await loadSettings();
  } catch {
    settings = DEFAULT_SETTINGS; // e.g. extension context invalidated
  }
  enabledHere = isEnabledFor(settings, relevantHosts());
  loaded = true;
  sendConfig();
}

const popover = new Popover({
  onPasteClick: () => void pasteViaButton(),
  onBrowse: () => finish('browse'),
  onCancel: () => finish('cancel'),
});

function finish(type: 'browse' | 'cancel', restoreFocus = true): void {
  if (!current) return;
  const id = current.id;
  current = null;
  generation++;
  popover.close(restoreFocus && type === 'cancel');
  detachListeners();
  post({ type, id });
}

function insert(files: File[]): void {
  if (!current) return;
  const id = current.id;
  current = null;
  generation++;
  popover.close(true);
  detachListeners();
  post({ type: 'insert', id, files });
}

/** Validates the clipboard result against the input and inserts it (or explains why not). */
async function handleResult(result: ClipboardResult, gen: number): Promise<void> {
  if (!current || gen !== generation) return;
  switch (result.kind) {
    case 'empty':
      popover.setStatus('Nothing to paste: copy an image, screenshot or text first.', 'error');
      return;
    case 'copied-files':
      popover.setStatus(
        "Files copied in a file manager can't be pasted (the browser only receives their path). Use Browse files…",
        'error',
      );
      return;
    case 'text-disabled':
      popover.setStatus('The clipboard only has text. Turning text into .txt files is off in the settings.', 'error');
      return;
  }

  const tokens = parseAccept(current.accept);
  let files = current.multiple ? result.files : result.files.slice(0, 1);
  // Convert images to an accepted format when possible (e.g. PNG screenshot -> JPEG-only input).
  files = await Promise.all(
    files.map(async (f) => (fileMatches(f, tokens) ? f : ((await convertImageIfNeeded(f, tokens)) ?? f))),
  );
  if (!current || gen !== generation) return;

  const rejected = files.filter((f) => !fileMatches(f, tokens));
  if (rejected.length) {
    popover.setPreview(files[0] ?? null);
    const what = rejected.map((f) => f.type || f.name).join(', ');
    popover.setStatus(`This upload expects ${describeAccept(tokens)}, but the clipboard has ${what}.`, 'warn', {
      label: 'Upload anyway',
      run: () => insert(files),
    });
    return;
  }
  insert(files);
}

// ---- Clipboard reading -------------------------------------------------------------

function onPaste(e: ClipboardEvent): void {
  if (!current || !e.clipboardData) return;
  e.preventDefault();
  e.stopImmediatePropagation(); // the page must not also handle this paste
  void handleResult(fromDataTransfer(e.clipboardData, settings.pasteText), generation);
}

async function pasteViaButton(): Promise<void> {
  if (!current) return;
  const gen = generation;
  popover.setBusy(true);
  popover.setStatus('Reading clipboard…');
  try {
    const result = await fromAsyncClipboard(settings.pasteText);
    if (gen !== generation) return;
    popover.setStatus(null);
    await handleResult(result, gen);
  } catch (err) {
    if (gen !== generation) return;
    const denied = err instanceof DOMException && err.name === 'NotAllowedError';
    popover.setStatus(
      denied
        ? 'Clipboard access was blocked for this site. Press Ctrl+V instead, or allow clipboard access in the site settings.'
        : `Couldn't read the clipboard (${(err as Error)?.message ?? err}). Try Ctrl+V.`,
      'error',
    );
  } finally {
    if (gen === generation) popover.setBusy(false);
  }
}

/** If clipboard permission was already granted, show what would be pasted. */
async function preview(gen: number): Promise<void> {
  if (!(await canReadSilently()) || gen !== generation) return;
  try {
    const result = await fromAsyncClipboard(settings.pasteText);
    if (gen !== generation) return;
    if (result.kind === 'files') popover.setPreview(result.files[0]!);
  } catch {
    /* preview is best-effort */
  }
}

// ---- Popover lifetime --------------------------------------------------------------

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    finish('cancel');
  }
}

function onPointerDown(e: PointerEvent): void {
  if (!popover.contains(e)) finish('cancel', false);
}

function attachListeners(): void {
  window.addEventListener('paste', onPaste, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('pointerdown', onPointerDown, true);
}

function detachListeners(): void {
  window.removeEventListener('paste', onPaste, true);
  window.removeEventListener('keydown', onKeyDown, true);
  window.removeEventListener('pointerdown', onPointerDown, true);
}

function open(req: Request): void {
  if (!enabledHere) {
    post({ type: 'browse', id: req.id });
    return;
  }
  post({ type: 'ack', id: req.id });
  if (current) popover.close(false);
  current = req;
  const gen = ++generation;
  const tokens = parseAccept(req.accept);
  popover.open({
    anchor: req.anchor,
    acceptLabel: describeAccept(tokens),
    multiple: req.multiple,
    bypassHint: BYPASS_LABEL[settings.bypassKey],
  });
  attachListeners();
  void preview(gen);
}

window.addEventListener('message', (e) => {
  if (!isOurs<ToIsolated>(e)) return;
  const msg = e.data;
  switch (msg.type) {
    case 'hello':
      sendConfig();
      break;
    case 'open':
      open(msg);
      break;
    case 'close':
      if (current?.id === msg.id) {
        current = null;
        generation++;
        popover.close(false);
        detachListeners();
      }
      break;
  }
});

try {
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'sync') void refreshSettings();
  });
} catch {
  /* context invalidated */
}
void refreshSettings();
