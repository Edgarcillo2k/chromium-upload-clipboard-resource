/** Turning clipboard contents into File objects. */

export type ClipboardResult =
  | { kind: 'files'; files: File[] }
  | { kind: 'copied-files' } // a file copied in the file manager: we only get its path
  | { kind: 'text-disabled' }
  | { kind: 'empty' };

const pad = (n: number) => String(n).padStart(2, '0');

/** pasted-YYYY-MM-DD-HHmmss */
export function timestampName(d = new Date()): string {
  return (
    `pasted-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'text/plain': 'txt',
  'text/html': 'html',
};

export function extensionFor(type: string): string {
  return EXT[type] ?? type.split('/')[1]?.replace(/[^a-z0-9]/gi, '') ?? 'bin';
}

/** Browsers name raw clipboard images "image.png"; give them a useful, unique name. */
function nameFile(file: File, index: number, total: number): File {
  const generic = !file.name || /^image\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name);
  if (!generic) return file;
  const suffix = total > 1 ? `-${index + 1}` : '';
  return new File([file], `${timestampName()}${suffix}.${extensionFor(file.type)}`, {
    type: file.type,
    lastModified: Date.now(),
  });
}

/**
 * Text that is really a reference to files copied in a file manager
 * (text/uri-list with file:// URLs, or Nautilus' "x-special/nautilus-clipboard").
 * A web page can't read local paths, so these can't be turned into uploads.
 */
export function looksLikeCopiedFiles(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith('x-special/nautilus-clipboard')) return true;
  const lines = t.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
  return lines.length > 0 && lines.every((l) => /^file:\/\//i.test(l.trim()));
}

function textFile(text: string): File {
  return new File([text], `${timestampName()}.txt`, { type: 'text/plain', lastModified: Date.now() });
}

/** From a `paste` event (Ctrl+V). No permission needed. */
export function fromDataTransfer(dt: DataTransfer, pasteText: boolean): ClipboardResult {
  const files = Array.from(dt.files);
  if (files.length) return { kind: 'files', files: files.map((f, i) => nameFile(f, i, files.length)) };

  // Some sources expose blobs only through items.
  const itemFiles = Array.from(dt.items)
    .filter((it) => it.kind === 'file')
    .map((it) => it.getAsFile())
    .filter((f): f is File => !!f);
  if (itemFiles.length) return { kind: 'files', files: itemFiles.map((f, i) => nameFile(f, i, itemFiles.length)) };

  const uriList = dt.getData('text/uri-list');
  const text = dt.getData('text/plain');
  if ((uriList && looksLikeCopiedFiles(uriList)) || looksLikeCopiedFiles(text)) return { kind: 'copied-files' };
  if (dt.types.includes('x-special/gnome-copied-files')) return { kind: 'copied-files' };
  if (text) return pasteText ? { kind: 'files', files: [textFile(text)] } : { kind: 'text-disabled' };
  return { kind: 'empty' };
}

/** From navigator.clipboard.read() (the "Paste" button). May prompt for permission. */
export async function fromAsyncClipboard(pasteText: boolean): Promise<ClipboardResult> {
  const items = await navigator.clipboard.read();
  const files: File[] = [];
  let text = '';
  for (const item of items) {
    const imageType = item.types.find((t) => t.startsWith('image/'));
    if (imageType) {
      const blob = await item.getType(imageType);
      files.push(new File([blob], `image.${extensionFor(imageType)}`, { type: imageType }));
    } else if (item.types.includes('text/plain') && !text) {
      text = await (await item.getType('text/plain')).text();
    }
  }
  if (files.length) return { kind: 'files', files: files.map((f, i) => nameFile(f, i, files.length)) };
  if (looksLikeCopiedFiles(text)) return { kind: 'copied-files' };
  if (text) return pasteText ? { kind: 'files', files: [textFile(text)] } : { kind: 'text-disabled' };
  return { kind: 'empty' };
}

/** Clipboard state for the preview, read silently only when permission is already granted. */
export async function canReadSilently(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName });
    return status.state === 'granted';
  } catch {
    return false;
  }
}
